// A.13 — journal d'audit, premier étage (§14.4, critère 13).
//
// Une trace d'audit ne vaut que par ce qu'elle interdit. Ce test porte donc
// sur les quatre propriétés dont la perte rendrait le journal décoratif :
//
//   1. l'acteur et l'instant ne sont pas des paramètres — une trace qu'on
//      peut signer du nom d'un autre ne prouve rien ;
//   2. les comptes applicatifs n'écrivent pas directement — la seule porte
//      est la RPC `security definer` et les déclencheurs ;
//   3. personne ne réécrit l'histoire, service compris — un journal
//      modifiable est un brouillon ;
//   4. la liste blanche ne laisse pas entrer le contenu des messages dans
//      une table en ajout seul, et elle ne DÉRIVE pas des colonnes que le
//      navigateur peut réellement écrire.
//
// Le contrôle 4 est le plus utile des quatre : c'est celui qu'une évolution
// ordinaire — une colonne ajoutée à `communications` — casse sans le vouloir.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const racine = path.resolve(__dirname, '..')
const migrations = path.join(racine, 'supabase/migrations')
const lire = (f) => fs.readFileSync(path.join(migrations, f), 'utf8')

const FICHIER = '20260731210000_journal_audit_premier_etage.sql'
const sql = lire(FICHIER)

// --- 0. l'ordre d'application ------------------------------------------------

// Un déclencheur ne se pose pas sur une table qui n'existe pas encore.
const toutes = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()
for (const dependance of [
  '20260730180000_registre_des_membres.sql',
  '20260731150000_communications_index_des_messages.sql',
  '20260731190000_propositions_quatre_genres.sql',
]) {
  assert.ok(toutes.includes(dependance), `migration attendue absente : ${dependance}`)
  assert.ok(
    toutes.indexOf(dependance) < toutes.indexOf(FICHIER),
    `${FICHIER} pose un déclencheur sur une table créée par ${dependance} : il doit s’appliquer APRÈS`,
  )
}

// --- 1. l'acteur et l'instant ne se fournissent pas --------------------------

const signature = /create or replace function public\.journaliser\(([\s\S]*?)\)\s*\nreturns/.exec(sql)
assert.ok(signature, 'la RPC `journaliser` doit être définie')
for (const interdit of ['acteur', 'auteur', 'survenu', 'quand', 'horodat']) {
  assert.doesNotMatch(
    signature[1],
    new RegExp(`p_[a-z_]*${interdit}`, 'i'),
    `« ${interdit} » ne doit pas être un paramètre de journaliser() : une trace forgeable ne prouve rien`,
  )
}
assert.match(sql, /auth\.uid\(\)/, 'l’acteur est lu de la session')
assert.match(
  sql,
  /survenu_le\s+timestamptz not null default now\(\)/,
  'l’instant est estampillé par l’horloge serveur, avec un défaut — pas par l’appelant',
)

// Les fonctions qui écrivent au nom du serveur doivent l'être délibérément,
// et sans laisser le `search_path` décider de ce qu'elles appellent.
for (const fonction of ['journaliser', 'tracer_mutation', 'acteur_courant', 'journal_audit_refus_reecriture']) {
  const bloc = new RegExp(
    `create or replace function public\\.${fonction}\\([\\s\\S]*?\\nas \\$\\$`,
  ).exec(sql)
  assert.ok(bloc, `fonction attendue : ${fonction}`)
  assert.match(bloc[0], /security definer/, `${fonction} doit être en security definer`)
  assert.match(bloc[0], /set search_path = ''/, `${fonction} doit figer son search_path`)
}

// --- 2. les comptes applicatifs n'écrivent pas directement -------------------

assert.doesNotMatch(
  sql,
  /grant[^;]*insert[^;]*on table public\.journal_audit to [^;]*authenticated/,
  'aucun `grant insert` à authenticated : la seule porte est journaliser()',
)
assert.match(
  sql,
  /grant select on table public\.journal_audit to authenticated/,
  'les membres doivent pouvoir LIRE le journal — un audit que personne ne consulte ne corrige rien',
)
assert.match(
  sql,
  /create policy "agence lecture"[\s\S]*?est_membre_actif\(\)/,
  'la lecture passe par le registre des membres, pas par une liste d’adresses',
)

// --- 3. personne ne réécrit l'histoire --------------------------------------

assert.doesNotMatch(
  sql,
  /grant[^;]*\b(update|delete)\b[^;]*on table public\.journal_audit/,
  'aucun droit de modification sur le journal, pour aucun rôle — service_role compris',
)
assert.match(
  sql,
  /before update or delete on public\.journal_audit/,
  'un déclencheur refuse la réécriture : un `revoke` se contourne avec le bon rôle, une exception non',
)
assert.match(
  sql,
  /grant select, insert on table public\.journal_audit to service_role/,
  'le serveur ajoute et lit, il ne modifie pas',
)

// --- 4. la liste blanche, et sa cohérence avec ce qui est écrivable ----------

const liste = (table) => {
  const bloc = new RegExp(`when '${table}' then array\\[([\\s\\S]*?)\\]`).exec(sql)
  assert.ok(bloc, `liste blanche attendue pour ${table}`)
  return [...bloc[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

const CONTENU_DE_MESSAGE = [
  'objet', 'corps_extrait', 'resume', 'expediteur', 'expediteur_adresse',
  'destinataires', 'copies', 'libelles', 'message_id_rfc',
]
for (const colonne of CONTENU_DE_MESSAGE) {
  assert.ok(
    !liste('communications').includes(colonne),
    `« ${colonne} » porte le contenu d’un message : le recopier dans une table en AJOUT SEUL créerait ` +
      'une seconde mémoire du courrier, indestructible, alors que Gmail est la source de vérité (§4.1)',
  )
}

// La cohérence entre fichiers : la liste blanche doit être EXACTEMENT les
// colonnes que le navigateur peut écrire. Plus large, elle journalise ce que
// personne ne décide ; plus étroite, elle laisse une décision humaine sans
// trace. C'est le contrôle qu'une évolution ordinaire casse sans le vouloir.
const ecrivables = (fichier, table) => {
  const bloc = new RegExp(`grant update \\(([\\s\\S]*?)\\)\\s*\\n\\s*on table public\\.${table}`).exec(lire(fichier))
  assert.ok(bloc, `grant update attendu sur ${table}`)
  return [...bloc[1].matchAll(/([a-z_]+)/g)].map((m) => m[1])
}

assert.deepEqual(
  liste('communications').slice().sort(),
  ecrivables('20260731150000_communications_index_des_messages.sql', 'communications').slice().sort(),
  'la liste blanche de `communications` doit couvrir exactement les colonnes que le navigateur peut écrire : ' +
    'une colonne écrivable hors liste serait une décision humaine sans trace',
)
assert.deepEqual(
  liste('propositions').slice().sort(),
  ecrivables('20260731190000_propositions_quatre_genres.sql', 'propositions').slice().sort(),
  'même exigence pour `propositions` : accepter ou ignorer une détection est un acte humain (§15)',
)
// Les colonnes de `membres` sont lues DANS SA MIGRATION, pas recopiées ici.
// La première version de ce test comparait à une liste écrite à la main, où
// figurait « nom » : la table déclare `personne`. Le test passait, et la
// migration échouait à l'application — c'est la base qui a trouvé le défaut,
// pas la CI. Une liste recopiée ne vérifie que sa propre copie.
const colonnesMembres = (() => {
  const src = lire('20260730180000_registre_des_membres.sql')
  const bloc = /create table if not exists public\.membres \(([\s\S]*?)\n\);/.exec(src)
  assert.ok(bloc, 'la table membres doit être déclarée dans sa migration')
  return [...bloc[1].matchAll(/^\s{2}([a-z_]+)\s+\S/gm)].map((m) => m[1])
})()

// Ce que le journal ne retient PAS : l'horodatage technique et les notes
// libres. Tout le reste d'un membre est un droit, et se journalise.
const HORS_AUDIT_MEMBRES = ['cree_le', 'maj_le', 'notes']
assert.deepEqual(
  liste('membres').slice().sort(),
  colonnesMembres.filter((c) => !HORS_AUDIT_MEMBRES.includes(c)).sort(),
  'un changement de droits se journalise en entier — c’était la seule action sensible que le dépôt ne traçait nulle part. ' +
    'Les colonnes viennent de la migration de `membres` : une colonne renommée doit casser ici, pas à l’application.',
)

// Et la fonction qui lit le nom de l'acteur doit interroger une colonne qui
// existe. `security definer` + `language sql` : PostgreSQL valide le corps à
// la création, donc l'erreur arrive au `db push`, en production, à l'instant
// où l'on croyait avoir fini.
for (const colonne of [...sql.matchAll(/select m\.([a-z_]+) from public\.membres m/g)].map((m) => m[1]))
  assert.ok(
    colonnesMembres.includes(colonne),
    `acteur_courant() lit public.membres.${colonne}, qui n’existe pas : la migration échouerait à l’application`,
  )

// --- 5. les trois déclencheurs, et leurs opérations -------------------------

const declencheur = (nom) => {
  const bloc = new RegExp(`create trigger ${nom}\\n([\\s\\S]*?);`).exec(sql)
  assert.ok(bloc, `déclencheur attendu : ${nom}`)
  return bloc[1]
}

assert.match(
  declencheur('membres_audit'),
  /after insert or update or delete on public\.membres/,
  'sur `membres`, TOUT se journalise : créer ou retirer un membre EST le changement de droits',
)
for (const [nom, table, pourquoi] of [
  ['communications_audit', 'communications', 'l’insertion, c’est l’arrivée d’un mail — des milliers par an, aucune décision'],
  ['propositions_audit', 'propositions', 'l’insertion, c’est la machine qui propose ; l’acte humain est l’`update`'],
]) {
  const corps = declencheur(nom)
  assert.match(corps, new RegExp(`after update or delete on public\\.${table}`), `${nom} : ${pourquoi}`)
  assert.doesNotMatch(corps, /after insert/, `${nom} ne doit pas journaliser les insertions : ${pourquoi}`)
}

// Le bruit machine ne doit pas noyer les décisions humaines : une
// réingestion qui ne touche aucune colonne suivie n'écrit rien.
assert.match(
  sql,
  /if not \(v_champs && v_suivies\) then\s*\n\s*return null;/,
  'une mise à jour qui ne touche aucune colonne suivie ne doit RIEN écrire — ' +
    'un journal illisible n’est pas relu, et un journal non relu ne sert à rien',
)

// --- 6. la migration se contrôle elle-même ----------------------------------

const controle = sql.slice(sql.lastIndexOf('do $$'))
assert.ok(
  (controle.match(/raise exception/g) || []).length >= 4,
  'le bloc de contrôle final doit refuser d’appliquer une version dégradée — au moins quatre garde-fous',
)
assert.match(controle, /has_table_privilege\('authenticated', 'public\.journal_audit', 'insert'\)/)
assert.match(controle, /pg_trigger/, 'le contrôle vérifie que les déclencheurs sont réellement posés')

console.log(
  'Journal d’audit : acteur et instant non forgeables, écriture directe refusée, ajout seul pour tous, ' +
    'liste blanche alignée sur les colonnes écrivables.',
)
