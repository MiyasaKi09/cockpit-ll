// ============================================================
// Livrable 0.2 — le registre des membres est la seule autorité
// de contrôle d'accès, et il n'est jamais vide.
//
// Ce test est statique : il lit les fichiers, il ne se connecte à
// aucune base. Il verrouille trois choses.
//
// 1. L'AMORCE ET LA RÉÉCRITURE SONT DANS LE MÊME FICHIER. Une
//    migration qui remplacerait la liste d'adresses littérales par
//    une table vide verrouillerait l'agence hors de son outil. La
//    seule protection qui tienne est l'atomicité : amorce et
//    politiques dans la même transaction, plus un contrôle final qui
//    lève une exception — donc annule tout — si le registre est vide.
// 2. AUCUNE POLITIQUE N'EST OUBLIÉE. La RLS est permissive : une
//    ancienne politique laissée en place n'interdit rien, elle
//    ÉLARGIT l'accès en silence. Chaque politique « agence … » des
//    migrations antérieures doit donc être explicitement supprimée
//    ET recréée par la migration du registre.
// 3. PLUS AUCUNE ADRESSE DE CONNEXION EN DUR, sauf dans le bloc
//    d'amorce, qui est le point d'entrée légitime d'une identité.
//
// Il ne remplace pas `scripts/test-adresses-en-dur.cjs` (livrable
// 0.14), qui garde le point de non-retour du §2.1 à l'échelle du
// dépôt entier.
// ============================================================

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

const MIGRATION = 'supabase/migrations/20260730180000_registre_des_membres.sql'
const migration = lire(MIGRATION)

// Les migrations antérieures : de l'histoire, immuable par construction.
// C'est d'elles que viennent les politiques à réécrire.
const ANCIENNES = [
  'supabase/migrations/20260729170200_workspace_revision_et_permissions.sql',
  'supabase/migrations/20260730085155_ingestion_veille_schema_reproductible.sql',
]

// ------------------------------------------------------------------
// 1. Le registre existe, avec ses quatre dimensions
// ------------------------------------------------------------------

assert.match(migration, /create table if not exists public\.membres/, 'la table membres doit être créée')
for (const colonne of ['email', 'compte_id', 'personne', 'role', 'actif']) {
  assert.match(
    migration,
    new RegExp(`^\\s*${colonne}\\s`, 'm'),
    `membres doit porter la colonne ${colonne} (compte ↔ personne ↔ rôle ↔ actif)`,
  )
}
assert.match(
  migration,
  /check \(\s*role in \(([\s\S]*?)\)\s*\);/,
  'les rôles doivent être bornés par une contrainte',
)
for (const role of [
  'administrateur_agence',
  'direction',
  'chef_de_projet',
  'collaborateur',
  'assistant_administratif',
  'comptabilite',
  'intervenant_externe',
  'lecture_seule',
]) {
  assert.match(migration, new RegExp(`'${role}'`), `le rôle ${role} du §14.1 doit être connu du registre`)
}

// L'adresse est normalisée, et aucun domaine n'est présumé : le domaine de
// l'agence n'est pas acheté, et une adresse projet doit passer aussi.
assert.match(
  migration,
  /check \(\s*\n?\s*email = lower\(email\)/,
  'le registre doit refuser une adresse non normalisée',
)
const contrainteAdresse = /add constraint membres_email_normalise[\s\S]*?\);/.exec(migration)
assert.ok(contrainteAdresse, 'la contrainte de format d’adresse doit exister')
assert.doesNotMatch(
  contrainteAdresse[0],
  /agence-ll|gmail/,
  'la contrainte de format ne doit présumer aucun domaine',
)

// ------------------------------------------------------------------
// 2. Les deux fonctions d'autorisation
// ------------------------------------------------------------------

for (const fonction of ['est_membre_actif', 'role_courant']) {
  const definition = new RegExp(
    `create or replace function public\\.${fonction}\\(\\)[\\s\\S]*?\\$\\$;`,
  ).exec(migration)
  assert.ok(definition, `${fonction}() doit être définie par la migration`)
  assert.match(definition[0], /security definer/, `${fonction}() doit être security definer`)
  assert.match(definition[0], /set search_path = ''/, `${fonction}() doit verrouiller son search_path`)
  assert.match(definition[0], /from public\.membres/, `${fonction}() doit lire le registre`)
  assert.match(
    definition[0],
    /m\.actif/,
    `${fonction}() doit ignorer les membres désactivés`,
  )
  assert.match(
    migration,
    new RegExp(`grant execute on function public\\.${fonction}\\(\\)[\\s\\S]{0,80}authenticated`),
    `${fonction}() doit être exécutable par une session du navigateur`,
  )
}

// `force row level security` sur membres ferait boucler les fonctions sur
// elles-mêmes : le propriétaire ne serait plus exempté de ses propres
// politiques. L'absence est un choix, pas un oubli.
assert.doesNotMatch(
  migration,
  /force row level security/,
  'force row level security rendrait les fonctions d’autorisation récursives',
)
assert.match(
  migration,
  /alter table public\.membres enable row level security/,
  'le registre lui-même doit être protégé par RLS',
)
assert.doesNotMatch(
  migration,
  /grant [^;]*\b(insert|update|delete)\b[^;]*on table public\.membres to authenticated/,
  'le registre ne doit jamais être modifiable depuis le navigateur',
)

// ------------------------------------------------------------------
// 3. L'amorce est dans la même transaction que la réécriture
// ------------------------------------------------------------------

const debutAmorce = migration.indexOf('-- [AMORCE-REGISTRE:DEBUT]')
const finAmorce = migration.indexOf('-- [AMORCE-REGISTRE:FIN]')
assert.ok(debutAmorce >= 0 && finAmorce > debutAmorce, 'le bloc d’amorce doit être délimité')
const amorce = migration.slice(debutAmorce, finAmorce)

assert.match(amorce, /insert into public\.membres/, 'l’amorce doit insérer dans le registre')
for (const compte of ['julenglet@gmail.com', 'zoefhebert@gmail.com']) {
  assert.ok(
    amorce.includes(compte),
    `le compte ${compte} doit être amorcé : sans lui la migration verrouille l’agence`,
  )
}
assert.match(
  amorce,
  /where not exists \(select 1 from public\.membres\)/,
  'l’amorce ne doit avoir lieu que si le registre est vide, sinon un rejeu ressuscite un membre retiré',
)
assert.ok(
  debutAmorce < migration.indexOf('create policy'),
  'l’amorce doit précéder la réécriture des politiques dans le même fichier',
)

// Le contrôle final : c'est lui qui rend le scénario « table vide »
// impossible, en annulant la transaction entière.
const controle = /do \$\$[\s\S]*?v_total\s+integer[\s\S]*?end \$\$;/.exec(migration)
assert.ok(controle, 'la migration doit se terminer par un contrôle du registre')
assert.match(
  controle[0],
  /if v_total = 0 then[\s\S]*?raise exception/,
  'un registre vide doit lever une exception, donc annuler la réécriture des politiques',
)
assert.match(
  controle[0],
  /if v_actifs = 0 then[\s\S]*?raise exception/,
  'un registre sans membre actif doit lever une exception',
)
assert.match(
  controle[0],
  /pg_policies[\s\S]*?like '%@%'[\s\S]*?raise exception/,
  'une politique comparant encore à une adresse doit annuler la migration',
)

// ------------------------------------------------------------------
// 4. Aucune politique « agence » oubliée
// ------------------------------------------------------------------

const politiquesDe = (source) => {
  const trouvees = []
  const motif = /create policy\s+"([^"]+)"\s*(?:\n\s*)?on\s+((?:public|storage)\.\w+)/g
  let m
  while ((m = motif.exec(source))) trouvees.push({ nom: m[1], table: m[2] })
  return trouvees
}

const aReprendre = ANCIENNES.flatMap((fichier) => politiquesDe(lire(fichier))).filter((p) =>
  p.nom.startsWith('agence'),
)
assert.ok(aReprendre.length >= 14, `recensement inattendu : ${aReprendre.length} politiques trouvées`)

const echappe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
for (const { nom, table } of aReprendre) {
  assert.match(
    migration,
    new RegExp(`drop policy if exists\\s+"${echappe(nom)}"\\s+on\\s+${echappe(table)};`),
    `la politique « ${nom} » de ${table} doit être supprimée : laissée en place, elle élargit l’accès`,
  )
  assert.match(
    migration,
    new RegExp(`create policy\\s+"${echappe(nom)}"\\s*\\n?\\s*on\\s+${echappe(table)}`),
    `la politique « ${nom} » de ${table} doit être recréée`,
  )
}

// Toute politique créée par la migration passe par le registre.
for (const bloc of migration.split(/create policy/).slice(1)) {
  const corps = bloc.slice(0, bloc.indexOf(';'))
  assert.match(
    corps,
    /public\.est_membre_actif\(\)/,
    `une politique de la migration n’interroge pas le registre :\n${corps.slice(0, 200)}`,
  )
  assert.doesNotMatch(
    corps,
    /@/,
    `une politique de la migration compare encore à une adresse :\n${corps.slice(0, 200)}`,
  )
}

// ------------------------------------------------------------------
// 5. La RPC d'écriture passe elle aussi par le registre
// ------------------------------------------------------------------

const rpc = /create or replace function public\.enregistrer_workspace[\s\S]*?\$\$;/.exec(migration)
assert.ok(rpc, 'la migration doit redéfinir enregistrer_workspace')
assert.match(rpc[0], /public\.est_membre_actif\(\)/, 'la RPC doit interroger le registre')
assert.match(
  rpc[0],
  /raise exception 'Compte non autorisé\.'/,
  'le message reconnu par le front ne doit pas changer',
)
assert.match(
  rpc[0],
  /p_id text[\s\S]*?p_data jsonb[\s\S]*?p_version integer[\s\S]*?p_updated_by text[\s\S]*?p_expected_revision bigint/,
  'la signature de la RPC doit rester celle qu’appelle le front déjà déployé',
)

// ------------------------------------------------------------------
// 6. `schema.sql` amorce un projet neuf sans écrire une seule adresse
// ------------------------------------------------------------------

const schema = lire('supabase/schema.sql')
assert.match(schema, /create table if not exists public\.membres/, 'schema.sql doit créer le registre')
assert.match(schema, /create or replace function public\.est_membre_actif/, 'schema.sql doit définir est_membre_actif')
assert.match(schema, /create or replace function public\.role_courant/, 'schema.sql doit définir role_courant')
for (const bloc of schema.split(/create policy/).slice(1)) {
  const corps = bloc.slice(0, bloc.indexOf(';'))
  assert.match(
    corps,
    /public\.est_membre_actif\(\)/,
    `schema.sql : une politique n’interroge pas le registre :\n${corps.slice(0, 200)}`,
  )
  assert.doesNotMatch(
    corps,
    /@/,
    `schema.sql : une politique compare encore à une adresse :\n${corps.slice(0, 200)}`,
  )
}
const rpcSchema = /create or replace function public\.enregistrer_workspace[\s\S]*?\$\$;/.exec(schema)
assert.ok(rpcSchema, 'schema.sql doit définir enregistrer_workspace')
assert.match(rpcSchema[0], /public\.est_membre_actif\(\)/, 'la RPC de schema.sql doit interroger le registre')
assert.doesNotMatch(rpcSchema[0], /@/, 'la RPC de schema.sql ne doit comparer à aucune adresse')
assert.match(
  schema,
  /insert into public\.membres[\s\S]*?from auth\.users/,
  'schema.sql doit amorcer le registre depuis les comptes existants, sans écrire d’adresse',
)

// ------------------------------------------------------------------
// 7. Plus une seule adresse de connexion hors du bloc d'amorce
// ------------------------------------------------------------------

const COMPTES = ['julenglet@gmail.com', 'zoefhebert@gmail.com']

const parcourir = (dossier, acc = []) => {
  for (const entree of fs.readdirSync(path.join(racine, dossier), { withFileTypes: true })) {
    const relatif = `${dossier}/${entree.name}`
    if (entree.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(entree.name)) continue
      parcourir(relatif, acc)
    } else if (/\.(ts|tsx|js|cjs|mjs|sql|json|md|html|css|toml)$/.test(entree.name)) {
      acc.push(relatif)
    }
  }
  return acc
}

const surveilles = [
  ...parcourir('src'),
  ...parcourir('api'),
  ...parcourir('scripts'),
  ...parcourir('supabase/functions'),
  'supabase/schema.sql',
  'scraper-worker/src/worker.ts',
]

for (const fichier of surveilles) {
  if (fichier === `scripts/${path.basename(__filename)}`) continue
  const contenu = lire(fichier)
  for (const compte of COMPTES) {
    assert.ok(
      !contenu.includes(compte),
      `${fichier} : adresse de connexion en dur (${compte}). Le registre public.membres fait autorité.`,
    )
  }
}

// Dans la migration elle-même, elles n'existent que dans l'amorce.
const migrationHorsAmorce = migration.slice(0, debutAmorce) + migration.slice(finAmorce)
for (const compte of COMPTES) {
  assert.ok(
    !migrationHorsAmorce.includes(compte),
    `${MIGRATION} : ${compte} apparaît hors du bloc d’amorce`,
  )
}

// ------------------------------------------------------------------
// 8. Edge Functions : registre interrogé, panne = refus
// ------------------------------------------------------------------

const partage = lire('supabase/functions/_shared/membres.ts')
// Chaque fonction exportée est examinée séparément : une seule d'entre elles
// qui autoriserait sur erreur suffirait à ouvrir la porte.
const corpsExporte = (nom) => {
  const debut = partage.indexOf(`export async function ${nom}(`)
  assert.ok(debut >= 0, `${nom}() doit être exportée par le module partagé`)
  const suivante = partage.indexOf('export ', debut + 1)
  return partage.slice(debut, suivante < 0 ? undefined : suivante)
}

const corpsEstMembre = corpsExporte('estMembreActif')
assert.match(corpsEstMembre, /from\('membres'\)/, 'le module partagé doit interroger la table membres')
assert.match(corpsEstMembre, /\.eq\('actif', true\)/, 'un membre désactivé ne doit pas être autorisé')
assert.match(corpsEstMembre, /if \(!adresse\) return false/, 'une adresse vide doit être refusée')

for (const nom of ['estMembreActif', 'jetonDeMembreActif']) {
  const corps = corpsExporte(nom)
  assert.match(
    corps,
    /if \(error\)[^}]{0,200}\breturn false\b/,
    `${nom}() : registre injoignable = refus. Autoriser par défaut serait une porte ouverte permanente.`,
  )
  assert.doesNotMatch(
    corps,
    /if \(error\)[^}]{0,200}\breturn true\b/,
    `${nom}() ne doit jamais autoriser sur une erreur`,
  )
}

for (const nom of ['gmail-ingestion', 'ingestion-config', 'veille-collecte', 'veille-enrichir', 'veille-mails']) {
  const source = lire(`supabase/functions/${nom}/index.ts`)
  assert.doesNotMatch(
    source,
    /const AGENCE\s*=/,
    `${nom} : la constante AGENCE est remplacée par le registre`,
  )
  assert.match(
    source,
    /from '\.\.\/_shared\/membres\.ts'/,
    `${nom} doit interroger le registre partagé`,
  )
  assert.match(
    source,
    /(jetonDeMembreActif|estMembreActif)\(/,
    `${nom} doit appeler le contrôle du registre`,
  )
}

console.log(
  `Registre des membres : ${aReprendre.length} politiques reprises, amorce et réécriture dans la même transaction, contrôle final présent, aucune adresse de connexion en dur hors amorce.`,
)
