// ============================================================
// Livrable A.2 — `public.communications`, l'index des messages.
//
// Ce test est statique : il lit les fichiers et exécute le module de
// catégorisation, il ne se connecte à aucune base. Il verrouille cinq
// choses, dont aucune ne produirait d'erreur visible si elle cédait.
//
// 1. LES TROIS LISTES FERMÉES DU §5.2 SONT IDENTIQUES EN BASE ET DANS
//    `src/categorisation.ts`. C'est LE risque du livrable : une valeur
//    ajoutée d'un seul côté ne se voit qu'au premier INSERT refusé, en
//    production, sur un message qu'on ne reverra pas. Les trois
//    domaines SQL sont donc comparés valeur par valeur au module, dans
//    les deux sens.
// 2. LA SÉPARATION PROPOSÉ / VALIDÉ EST PORTÉE PAR LE SCHÉMA (§3.14).
//    Chaque colonne `*_propos*` a sa colonne humaine et sa colonne
//    effective GÉNÉRÉE ; le GRANT au niveau colonne n'accorde au
//    navigateur que les colonnes humaines ; un trigger refuse le reste.
//    Trois garde-fous, vérifiés séparément : un GRANT élargi par
//    inadvertance ne doit pas suffire à ouvrir la porte.
// 3. LA RÈGLE D'EFFECTIVITÉ EST ÉCRITE UNE FOIS, EN BASE. Un écran qui
//    recalculerait `coalesce(phase, phase_proposee)` de son côté
//    divergerait le jour où la règle bouge — et elle a déjà une
//    subtilité : après signature humaine, un axe VIDE reste vide.
// 4. L'ACCÈS PASSE PAR LE REGISTRE DES MEMBRES, jamais par une adresse
//    littérale (livrable 0.2).
// 5. L'INGESTION REMPLIT CET INDEX, ET NE PEUT PAS ÉCRASER UNE
//    CORRECTION HUMAINE. C'est le critère 2 du §22 : un message sans
//    pièce jointe doit exister quelque part. L'`upsert` n'emporte
//    aucune colonne humaine, et la portée du curseur a été
//    incrémentée — sans quoi l'élargissement de la requête ferait
//    sauter en silence tout l'historique sans pièce jointe.
//
// Ce test ne couvre PAS `propositions` ni `charge_utile->>'cible'` :
// la table d'A.9 existe désormais, et c'est
// `test-propositions-modifiables.cjs` qui la prend — partie II, avec le
// reste du critère 11, plutôt que dans un troisième fichier qui aurait
// fait relire deux fois la même doctrine.
// ============================================================

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

const CHEMIN_MIGRATION = 'supabase/migrations/20260731150000_communications_index_des_messages.sql'
const migration = lire(CHEMIN_MIGRATION)
const index = lire('supabase/functions/gmail-ingestion/index.ts')

/** charge un module TypeScript pur (sans React ni DOM) pour l'exercer */
function charger(fichier, dependances = {}) {
  const compile = ts.transpileModule(lire(fichier), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (dependances[id]) return dependances[id]
    throw new Error(`Import runtime inattendu dans ${fichier} : ${id}`)
  })
  return mod.exports
}

const util = charger('src/util.ts')
const miqcp = charger('src/miqcp.ts')
const cat = charger('src/categorisation.ts', { './util': util, './miqcp': miqcp })

// ------------------------------------------------------------------
// 0. La migration s'applique après celles dont elle dépend
// ------------------------------------------------------------------

const nomMigration = path.basename(CHEMIN_MIGRATION)
const migrations = fs
  .readdirSync(path.join(racine, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
assert.ok(migrations.includes(nomMigration), 'la migration de `communications` doit être présente')
for (const anterieure of [
  '20260730180000_registre_des_membres.sql',
  '20260731103000_ingestion_gmail_enrichie.sql',
]) {
  assert.ok(
    nomMigration > anterieure,
    `elle doit s’appliquer après ${anterieure} : elle en réutilise les fonctions d’autorisation et le curseur`,
  )
}

// ------------------------------------------------------------------
// 1. Les trois axes du §5.2 : base et module, valeur par valeur
// ------------------------------------------------------------------

const debutAxes = migration.indexOf('-- [AXES-CDC-5.2:DEBUT]')
const finAxes = migration.indexOf('-- [AXES-CDC-5.2:FIN]')
assert.ok(debutAxes >= 0 && finAxes > debutAxes, 'le bloc des trois axes doit être délimité par ses repères')
const blocAxes = migration.slice(debutAxes, finAxes)

/** valeurs littérales d'un `create domain … check (value in (…))` */
function valeursDuDomaine(nom) {
  const motif = new RegExp(
    `create domain public\\.${nom} as text\\s*\\n\\s*check \\(value in \\(([\\s\\S]*?)\\)\\);`,
  )
  const trouve = motif.exec(blocAxes)
  assert.ok(trouve, `${CHEMIN_MIGRATION} : le domaine public.${nom} est introuvable dans le bloc des axes`)
  return trouve[1]
    .split(',')
    .map((v) => v.replace(/--[^\n]*/g, '').trim())
    .filter(Boolean)
    .map((v) => {
      assert.match(v, /^'[^']*'$/, `public.${nom} : « ${v} » n’est pas une valeur littérale`)
      return v.slice(1, -1)
    })
}

const AXES = [
  ['phase_echange', cat.PHASES_ECHANGE, 'PHASES_ECHANGE', 14],
  ['type_echange', cat.TYPES_ECHANGE, 'TYPES_ECHANGE', 15],
  ['niveau_importance', cat.NIVEAUX_IMPORTANCE, 'NIVEAUX_IMPORTANCE', 6],
]

for (const [domaine, listeModule, nomListe, cardinal] of AXES) {
  const enBase = valeursDuDomaine(domaine)
  assert.equal(
    enBase.length,
    cardinal,
    `public.${domaine} doit compter ${cardinal} valeurs (CDC §5.2), lu ${enBase.length}`,
  )
  assert.equal(new Set(enBase).size, enBase.length, `public.${domaine} contient un doublon`)
  assert.deepEqual(
    [...enBase].sort(),
    [...listeModule].sort(),
    `public.${domaine} et src/categorisation.ts::${nomListe} ont divergé. ` +
      `Une valeur présente d’un seul côté ne se voit qu’au premier INSERT refusé, en production.`,
  )
}

// La liste des phases n'est pas recopiée à la main dans le module : elle est
// construite avec `...PHASES_ORDRE`. On vérifie donc aussi que la transcription
// SQL suit bien la chaîne d'honoraires, pas une copie figée d'il y a six mois.
for (const code of miqcp.PHASES_ORDRE) {
  assert.ok(
    valeursDuDomaine('phase_echange').includes(code),
    `public.phase_echange : la phase de mission ${code} manque — un échange de cette phase serait refusé en base`,
  )
}

// ------------------------------------------------------------------
// 2. Proposé / validé / effectif : les trois colonnes, les trois verrous
// ------------------------------------------------------------------

const definition = /create table if not exists public\.communications \(([\s\S]*?)\n\);/.exec(migration)
assert.ok(definition, 'la table communications doit être créée par cette migration')
const colonnes = definition[1]

// Le recensement part du schéma lui-même : une colonne proposée ajoutée demain
// entre automatiquement dans le périmètre de ce test.
const colonnesProposees = [...colonnes.matchAll(/^\s{2}([a-z_]*propos[a-z_]*)\s/gm)].map((m) => m[1])
assert.deepEqual(
  colonnesProposees.sort(),
  ['importance_proposee', 'phase_proposee', 'projet_id_propose', 'type_echange_propose'],
  'recensement inattendu des colonnes de proposition de public.communications',
)

// À chaque proposition, sa commande humaine et sa colonne effective générée.
const TRIADES = [
  { propose: 'phase_proposee', humain: 'phase', effectif: 'phase_effective', signature: 'categorise_par' },
  { propose: 'type_echange_propose', humain: 'type_echange', effectif: 'type_echange_effectif', signature: 'categorise_par' },
  { propose: 'importance_proposee', humain: 'importance', effectif: 'importance_effective', signature: 'categorise_par' },
  { propose: 'projet_id_propose', humain: 'projet_id_valide', effectif: 'projet_id', signature: 'rattache_par' },
]
assert.equal(
  TRIADES.length,
  colonnesProposees.length,
  'une colonne de proposition a été ajoutée sans pendant humain déclaré ici',
)

for (const { propose, humain, effectif, signature } of TRIADES) {
  assert.match(
    colonnes,
    new RegExp(`^\\s{2}${humain}\\s`, 'm'),
    `public.communications doit porter ${humain} : une proposition qu’on ne peut pas corriger est une décision déguisée (critère 11)`,
  )

  // La colonne effective est GÉNÉRÉE, et elle porte la bascule : après
  // signature humaine, la valeur humaine seule compte — vide comprise.
  const generee = new RegExp(
    `add column ${effectif} text\\s*\\n\\s*generated always as \\(([\\s\\S]*?)\\) stored`,
  ).exec(migration)
  assert.ok(
    generee,
    `${effectif} doit être une colonne GÉNÉRÉE : écrite à la main, elle dirait un jour autre chose que la règle`,
  )
  assert.ok(
    generee[1].includes(`${signature} is not null`),
    `${effectif} doit basculer sur ${signature} : sans cela, un axe délibérément vidé se remplirait à nouveau avec la proposition`,
  )
  assert.ok(
    generee[1].includes(humain) && generee[1].includes(propose),
    `${effectif} doit composer ${humain} et ${propose}`,
  )
}

// Le GRANT au niveau colonne : le navigateur ne reçoit QUE les colonnes
// humaines. C'est ce qui fait de « la machine ne peut pas écrire un axe
// validé » un droit, et non un comportement d'écran contournable.
const grantColonnes = /grant update \(([\s\S]*?)\)\s*\n\s*on table public\.communications\s*\n\s*to authenticated;/.exec(
  migration,
)
assert.ok(grantColonnes, 'le GRANT au niveau colonne du §3.14 est introuvable')
const ecrivables = grantColonnes[1]
  .split(',')
  .map((c) => c.replace(/--[^\n]*/g, '').trim())
  .filter(Boolean)
assert.deepEqual(
  [...ecrivables].sort(),
  [
    'categorise_le',
    'categorise_par',
    'importance',
    'phase',
    'projet_id_valide',
    'rattache_le',
    'rattache_par',
    'traite_le',
    'traite_par',
    'type_echange',
  ],
  'le GRANT de colonnes a changé : toute colonne ajoutée ici devient écrivable depuis le navigateur',
)
for (const colonne of ecrivables) {
  assert.ok(
    !/propos/.test(colonne),
    `grant update (${colonne}) à authenticated — une proposition ne se réécrit pas depuis le navigateur`,
  )
}
assert.ok(
  !/grant\s+[a-z, ]*\b(insert|delete)\b[^;]*on table public\.communications to authenticated/.test(migration),
  'le navigateur ne fabrique ni ne supprime de message : il corrige, ou il ne fait rien',
)
assert.doesNotMatch(
  migration,
  /grant\s+(select\s*,\s*)?update\s+on table public\.communications to authenticated/,
  'un GRANT au niveau TABLE annulerait le GRANT au niveau colonne : toutes les propositions redeviendraient écrivables',
)

// Le second verrou : le trigger de refus. Il survit à un GRANT élargi.
const refus = /create or replace function public\.communications_refus_proposition\(\)[\s\S]*?\$\$;/.exec(migration)
assert.ok(refus, 'le trigger de refus du §3.14 doit être défini')
assert.match(
  refus[0],
  /security invoker/,
  'le refus doit être `security invoker` : en `security definer`, `current_user` serait le propriétaire de la fonction et le contrôle ne contrôlerait plus rien',
)
assert.match(refus[0], /current_user in \('service_role'/, 'seul le serveur écrit une proposition')
for (const colonne of [...colonnesProposees, 'confiance_categorisation', 'raisons_categorisation', 'confiance_rattachement', 'raisons_rattachement', 'resume']) {
  assert.ok(
    new RegExp(`new\\.${colonne}\\s+is distinct from old\\.${colonne}`).test(refus[0]),
    `le trigger de refus doit couvrir ${colonne} : une trace de ce que la machine a proposé qu’on peut réécrire n’est plus une trace`,
  )
}
assert.match(
  migration,
  /create trigger communications_propositions_intactes\s*\n\s*before update on public\.communications/,
  'le trigger de refus doit être branché en `before update`',
)

// ------------------------------------------------------------------
// 3. La règle d'effectivité n'est écrite qu'en base
// ------------------------------------------------------------------

const parcourir = (dossier, acc = []) => {
  for (const entree of fs.readdirSync(path.join(racine, dossier), { withFileTypes: true })) {
    const relatif = `${dossier}/${entree.name}`
    if (entree.isDirectory()) parcourir(relatif, acc)
    else if (/\.tsx?$/.test(entree.name)) acc.push(relatif)
  }
  return acc
}
for (const fichier of [...parcourir('src'), ...parcourir('supabase/functions')]) {
  const source = lire(fichier)
  for (const { humain, propose } of TRIADES) {
    assert.ok(
      !new RegExp(`${humain}\\s*(\\?\\?|\\|\\|)\\s*${propose}`).test(source),
      `${fichier} recalcule « ${humain} sinon ${propose} » : cette règle est une colonne générée, et elle a une subtilité (un axe signé et vide reste vide) qu’une reprise à la main perd`,
    )
  }
}

// ------------------------------------------------------------------
// 4. L'accès passe par le registre des membres
// ------------------------------------------------------------------

assert.match(
  migration,
  /alter table public\.communications enable row level security/,
  'la table doit être protégée par RLS',
)
const politiques = migration.split(/create policy/).slice(1)
assert.ok(politiques.length >= 2, 'lecture et correction doivent être deux politiques distinctes')
for (const bloc of politiques) {
  const corps = bloc.slice(0, bloc.indexOf(';'))
  assert.match(
    corps,
    /public\.est_membre_actif\(\)/,
    `une politique n’interroge pas le registre des membres :\n${corps.slice(0, 200)}`,
  )
  assert.doesNotMatch(corps, /@/, `une politique compare à une adresse littérale :\n${corps.slice(0, 200)}`)
}
assert.match(
  migration,
  /for update[\s\S]{0,200}role_courant\(\)\) is distinct from 'lecture_seule'/,
  'un membre en lecture seule lit les échanges et ne les corrige pas',
)
assert.match(
  migration,
  /grant select, insert, update, delete on table public\.communications to service_role/,
  'l’écriture des messages revient au serveur',
)

// ------------------------------------------------------------------
// 5. Les index que lisent §4.3, §8.1, §8.2, §13.1 et A.12
// ------------------------------------------------------------------

const INDEX_ATTENDUS = [
  ['communications_gmail_message_unq', /unique index if not exists communications_gmail_message_unq\s*\n\s*on public\.communications \(gmail_message_id\)/, 'l’unicité qui rend l’ingestion idempotente'],
  ['communications_projet_envoi_idx', /on public\.communications \(projet_id, envoye_le desc\)/, 'la mémoire projet du §4.3'],
  ['communications_thread_idx', /on public\.communications \(gmail_thread_id/, 'le fil : §4.2 et le « en attente de réponse » du §8.2'],
  ['communications_projet_importance_idx', /on public\.communications \(projet_id, importance_effective, envoye_le desc\)/, 'l’urgent du §8.2'],
  ['communications_projet_phase_idx', /on public\.communications \(projet_id, phase_effective\)/, 'la recherche par phase du §13.1'],
]
for (const [nom, motif, usage] of INDEX_ATTENDUS) {
  assert.match(migration, motif, `l’index ${nom} manque — ${usage}`)
}

// ------------------------------------------------------------------
// 6. La migration se vérifie elle-même
// ------------------------------------------------------------------

assert.match(
  migration,
  /raise exception[\s\S]{0,200}colonnes absentes après migration/,
  'la migration doit contrôler son propre effet : une colonne manquante produirait une Edge Function dont chaque insertion échoue, sans autre trace que les journaux',
)
assert.match(
  migration,
  /is_generated <> 'ALWAYS'/,
  'le contrôle final doit vérifier que les colonnes effectives sont bien générées',
)
assert.match(
  migration,
  /column_privileges[\s\S]{0,400}grantee = 'authenticated'[\s\S]{0,400}raise exception/,
  'le contrôle final doit refuser tout droit d’écriture accordé au navigateur sur une colonne de proposition',
)

// ------------------------------------------------------------------
// 7. L'ingestion remplit l'index, sans jamais écraser une correction
// ------------------------------------------------------------------

// Le curseur : sa portée DOIT avoir été incrémentée en même temps que la
// requête. C'est précisément le piège différé que `curseur_gmail_portee`
// (livrable A.1) a été écrite pour désamorcer.
const requete = /const REQUETE_GMAIL = '([^']*)'/.exec(index)
assert.ok(requete, 'la requête Gmail doit rester une constante nommée')
assert.ok(
  !/has:attachment/.test(requete[1]),
  'la requête ne doit plus se limiter aux messages porteurs d’une pièce : un message sans pièce jointe n’existerait nulle part (critère 2)',
)
assert.match(
  index,
  /const PORTEE_CURSEUR = `\$\{REQUETE_GMAIL\}\|v2`/,
  'la portée du curseur doit avoir été incrémentée avec l’élargissement : un curseur hérité de la requête étroite ferait sauter, sans erreur ni trace, tout l’historique sans pièce jointe',
)

// L'index des messages est alimenté, avant toute borne qui pourrait l'éviter.
const upsert = /\.from\('communications'\)\s*\.upsert\(([\s\S]*?)\)\n/.exec(index)
assert.ok(upsert, 'gmail-ingestion doit alimenter public.communications')
assert.ok(
  upsert[1].includes("onConflict: 'gmail_message_id'"),
  'l’écriture doit être idempotente sur gmail_message_id : rejouer une tranche ne doit pas créer de doublon',
)
assert.ok(
  index.indexOf(".from('communications')") < index.indexOf('if (dejaVus.has(id)) continue'),
  'l’index des messages doit être écrit AVANT la borne « pièces déjà vues » : sinon un message dont les pièces sont déjà validées n’entrerait jamais dans la mémoire du projet',
)

const ligne = /function ligneCommunication\([\s\S]*?\n\}/.exec(index)
assert.ok(ligne, 'ligneCommunication() doit rester le constructeur unique de la ligne de message')
for (const colonne of [
  'gmail_message_id',
  'gmail_thread_id',
  'message_id_rfc',
  'en_reponse_a',
  'references_rfc',
  'expediteur',
  'destinataires',
  'copies',
  'objet',
  'corps_extrait',
  'libelles',
  'direction',
  'envoye_le',
  'recu_le',
]) {
  assert.ok(ligne[0].includes(`${colonne}:`), `ligneCommunication() doit porter ${colonne} (§4.1, §18)`)
}
// …et AUCUNE colonne humaine : c'est ce qui garantit qu'un re-scan ne peut pas
// effacer un rattachement corrigé, un axe choisi ou un message marqué traité.
for (const colonne of ecrivables) {
  assert.ok(
    !new RegExp(`\\b${colonne}:`).test(ligne[0]),
    `ligneCommunication() écrit ${colonne} : un re-scan effacerait la correction humaine, en silence`,
  )
}
// Les trois axes proposés sont renseignés depuis A.8 — et c'est la COLONNE
// PROPOSÉE, jamais la colonne humaine, qui les reçoit (la boucle ci-dessus sur
// `ecrivables` le vérifie déjà, celle-ci vérifie la réciproque : qu'ils ne
// soient pas restés vides). Le détail du classifieur est exercé par
// `scripts/test-classement-echanges.cjs`, qui l'exécute.
for (const { propose } of TRIADES) {
  if (propose === 'projet_id_propose') continue
  assert.ok(
    new RegExp(`\\b${propose}:`).test(ligne[0]),
    `ligneCommunication() n’écrit plus ${propose} : la table porte l’axe depuis A.2 et son classifieur existe depuis A.8 — une colonne vide ne se voit pas`,
  )
}

// Un seul moteur de rattachement, appelé pour le message comme pour la pièce
// (§3.7 : trois moteurs divergents répondaient trois choses différentes).
//
// A.4 l'a sorti d'ici : la cascade vit dans `_shared/rattachement.ts`, partagée
// avec le navigateur. A.2 vérifiait la FORME de la fonction locale ; ce qui
// compte désormais est qu'elle ne soit plus écrite ici du tout — le détail de
// la cascade est vérifié par `scripts/test-rattachement.cjs`, qui l'exécute.
assert.match(
  index,
  /from '\.\.\/_shared\/rattachement\.ts'/,
  'le rattachement doit être IMPORTÉ du module partagé, jamais réécrit ici (§3.7)',
)
assert.ok(
  !/reperes\.projets\.find/.test(index) && !/function rattacher\(/.test(index),
  'la cascade de rattachement ne doit plus être écrite dans l’ingestion : un quatrième moteur rouvrirait la divergence du §3.7',
)
const classement = /function classer\(reperes: ReperesRattachement[\s\S]*?\n\}/.exec(index)
assert.ok(classement, 'classer() doit exister')
assert.match(
  classement[0],
  /rattacherEnCascade\(reperes, \{/,
  'classer() doit appeler la cascade partagée, et non en recopier les barreaux',
)

// Les deux formats Gmail du §3.6, et le repli quand la seconde liste est
// tronquée : mieux vaut une réponse lourde qu’une pièce jointe jamais vue.
assert.match(index, /format=metadata/, 'le §3.6 demande `format=metadata` pour les messages sans pièce jointe')
assert.match(
  index,
  /const complet = !listingPieces\.complet \|\| avecPiece\.has\(id\)/,
  'liste des pièces tronquée : tous les messages repassent en `format=full`, sinon une pièce jointe serait ignorée sans trace',
)

console.log(
  'Communications : trois axes identiques en base et dans src/categorisation.ts (14/15/6), ' +
    `${TRIADES.length} triades proposé/humain/effectif générées, ${ecrivables.length} colonnes écrivables par le navigateur ` +
    'et aucune proposition parmi elles, RLS par le registre, ingestion idempotente sans écrasement humain.',
)
