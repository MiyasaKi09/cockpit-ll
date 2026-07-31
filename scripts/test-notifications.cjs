// A.11 — notifier les personnes concernées (§12.3 pt 10).
//
// Trois producteurs entrent dans le fil d'urgences. Le risque n'est pas
// qu'ils ne produisent rien : c'est qu'ils produisent TROP, ou qu'ils
// cassent les cinq écrans qui appelaient déjà `computeAlertes`.
//
// Ce test tient donc quatre choses :
//
//   1. la rétrocompatibilité — sans contexte, la sortie est identique à
//      l'ancienne, au sens strict : mêmes alertes, mêmes identifiants ;
//   2. le fil ne se remplit pas de courrier ordinaire — seuls les niveaux
//      que l'agence a qualifiés d'urgents, bloquants ou contractuels ;
//   3. une proposition n'est JAMAIS urgente. La présenter comme telle
//      pousserait à l'accepter pour faire taire l'alerte, c'est-à-dire
//      exactement ce que le §15 interdit ;
//   4. « vu » et « en sommeil » ne se confondent pas, et « vu » ne peut
//      pas faire taire une facture en retard.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

/** charge un module de `src/` en résolvant RÉELLEMENT ses imports relatifs.
 *  Seules les dépendances externes sont coupées : bouchonner un module du
 *  dépôt reviendrait à tester le bouchon plutôt que le code. */
const cache = new Map()
const EXTERNES = {
  react: { useCallback: (f) => f, useEffect: () => {}, useMemo: (f) => f(), useRef: () => ({}), useState: () => [] },
  'react/jsx-runtime': {},
  '@supabase/supabase-js': { createClient: () => null },
}

function charger(chemin) {
  const fichier = chemin.endsWith('.ts') || chemin.endsWith('.tsx') ? chemin : `${chemin}.ts`
  const reel = fs.existsSync(path.join(racine, fichier))
    ? fichier
    : fichier.replace(/\.ts$/, '.tsx')
  if (cache.has(reel)) return cache.get(reel)
  const compile = ts.transpileModule(lire(reel), {
    fileName: reel,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const mod = { exports: {} }
  cache.set(reel, mod.exports)
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (id in EXTERNES) return EXTERNES[id]
    if (id.startsWith('.')) return charger(path.posix.join(path.posix.dirname(reel), id))
    throw new Error(`Dépendance externe inattendue dans ${reel} : ${id}`)
  })
  cache.set(reel, mod.exports)
  return mod.exports
}

const alerts = charger('src/alerts.ts')
const categorisation = charger('src/categorisation.ts')

const { computeAlertes, alertesActives } = alerts
const AUJOURDHUI = '2026-07-31'

// Les niveaux d'importance sont un référentiel fermé, partagé avec le
// domaine SQL `niveau_importance`. Ce test l'a d'abord recopié à la main,
// en majuscules — et il passait, en vert, sur un producteur qui ne pouvait
// produire AUCUNE alerte en production : l'ensemble des niveaux alertants
// n'intersectait jamais les valeurs réelles. Un fil d'urgences vide ne
// ressemble pas à une panne, il ressemble à du calme.
//
// Les fixtures lisent donc le référentiel. Une valeur inventée ici échoue
// tout de suite, au lieu de valider un producteur mort.
const { NIVEAUX_IMPORTANCE } = categorisation
const IMPORTANCE = Object.fromEntries(NIVEAUX_IMPORTANCE.map((n) => [n, n]))
for (const attendu of ['information', 'a_traiter', 'urgent', 'bloquant', 'contractuel'])
  assert.ok(IMPORTANCE[attendu], `« ${attendu} » doit exister dans NIVEAUX_IMPORTANCE`)

// Un état minimal : toutes les collections vides, pour qu'AUCUNE alerte
// historique ne se produise et que seules les nouvelles soient observées.
// La liste des collections est lue dans AppState plutôt que recopiée : une
// collection ajoutée demain ferait échouer ce test sur un `undefined`
// obscur, alors que ce n'est pas son sujet.
const COLLECTIONS = (() => {
  const types = lire('src/types.ts')
  const debut = types.indexOf('export interface AppState')
  const bloc = types.slice(debut, types.indexOf('\n}', debut))
  return [...bloc.matchAll(/^  ([a-zA-Z_]+)\??:\s*[A-Za-z]+\[\]/gm)].map((m) => m[1])
})()

const etat = (over = {}) => {
  const vide = {}
  for (const c of COLLECTIONS) vide[c] = []
  return {
    version: 20,
    ...vide,
    settings: { snoozes: {}, vus: {}, personnes: ['Julien'], equipe: [], ...(over.settings || {}) },
    ...over,
  }
}
assert.ok(COLLECTIONS.length >= 30, `inventaire des collections suspect : ${COLLECTIONS.length}`)

const message = (over) => ({
  id: over.id,
  objet: over.objet ?? 'Validation façade sud',
  expediteur: over.expediteur ?? 'client@example.com',
  projetId: over.projetId ?? 'P01',
  importance: over.importance ?? null,
  envoyeLe: over.envoyeLe ?? '2026-07-31T09:00:00Z',
  urlGmail: null,
})

// --- 1. rétrocompatibilité, au sens strict ----------------------------------

{
  const base = etat()
  const sans = computeAlertes(base, AUJOURDHUI)
  const avecVide = computeAlertes(base, AUJOURDHUI, {})
  assert.deepEqual(
    avecVide.map((a) => a.id),
    sans.map((a) => a.id),
    'un contexte vide ne doit rien ajouter : les cinq écrans historiques rendent la même chose',
  )
  assert.equal(typeof alertesActives(base, AUJOURDHUI), 'object', 'alertesActives garde sa signature à deux arguments')
}

// --- 2. le fil ne se remplit pas de courrier ordinaire ----------------------

{
  const ctx = {
    moi: 'Julien',
    aTraiter: [
      message({ id: 'm1', importance: null }),
      message({ id: 'm2', importance: IMPORTANCE.information }),
      message({ id: 'm3', importance: IMPORTANCE.a_traiter }),
      message({ id: 'm4', importance: IMPORTANCE.urgent }),
      message({ id: 'm5', importance: IMPORTANCE.bloquant }),
      message({ id: 'm6', importance: IMPORTANCE.contractuel }),
      // une valeur hors référentiel — la casse d'un autre système, une
      // colonne mal remplie : elle ne doit RIEN produire, et surtout pas
      // planter `graviteDe` sur un niveau qu'il ne connaît pas
      message({ id: 'm7', importance: 'URGENT' }),
    ],
  }
  const produites = computeAlertes(etat(), AUJOURDHUI, ctx).filter((a) => a.type === 'mail_a_traiter')
  assert.deepEqual(
    produites.map((a) => a.id).sort(),
    ['mail-m4', 'mail-m5', 'mail-m6'],
    'seuls urgent, bloquant et contractuel entrent dans un fil d’URGENCES — le reste se lit dans l’accueil, ' +
      'et une valeur hors référentiel n’entre nulle part',
  )
  assert.ok(
    produites.every((a) => a.pour === 'Julien' && a.projetId === 'P01'),
    'chaque alerte porte à qui elle s’adresse et de quel projet elle parle',
  )
  assert.equal(
    produites.find((a) => a.id === 'mail-m6').gravite,
    categorisation.graviteDe('contractuel'),
    'la gravité vient de `graviteDe` — l’échelle des alertes a un seul propriétaire (§14.3)',
  )
  for (const a of produites)
    assert.doesNotMatch(a.titre, /[A-Z]{3,}/, 'le titre affiche le libellé humain, pas la valeur brute de la base')
}

// --- 3. l'attente de réponse a un seuil, et il est franchissable ------------

{
  const ctx = {
    enAttenteDeReponse: [
      message({ id: 'r1', envoyeLe: '2026-07-30T09:00:00Z' }), // 1 jour
      message({ id: 'r2', envoyeLe: '2026-07-27T09:00:00Z' }), // 4 jours
      message({ id: 'r3', envoyeLe: '2026-07-20T09:00:00Z' }), // 11 jours
    ],
  }
  const produites = computeAlertes(etat(), AUJOURDHUI, ctx).filter((a) => a.type === 'reponse_attendue')
  assert.deepEqual(
    produites.map((a) => a.id).sort(),
    ['reponse-r2', 'reponse-r3'],
    'un fil sans réponse depuis moins de trois jours n’est pas encore un oubli',
  )
  assert.equal(
    produites.find((a) => a.id === 'reponse-r3').gravite,
    3,
    'au-delà d’une semaine, quelqu’un attend vraiment',
  )
}

// --- 4. une proposition n'est jamais urgente --------------------------------

{
  const ctx = { propositions: [{ id: 'p1', genre: 'tache', projetId: 'P01' }, { id: 'p2', genre: 'echeance', projetId: null }] }
  const produites = computeAlertes(etat(), AUJOURDHUI, ctx).filter((a) => a.type === 'proposition_ia')
  assert.equal(produites.length, 1, 'les propositions sont AGRÉGÉES : une ligne, pas une par détection')
  assert.equal(
    produites[0].gravite,
    1,
    'gravité 1, toujours : une alerte urgente pousserait à accepter pour la faire taire — le §15 l’interdit',
  )
  assert.match(produites[0].titre, /2 propositions à revoir/, 'le compte est dans le titre')
  assert.equal(
    computeAlertes(etat(), AUJOURDHUI, { propositions: [] }).filter((a) => a.type === 'proposition_ia').length,
    0,
    'aucune proposition, aucune alerte — pas un « 0 à revoir »',
  )
}

// --- 5. « vu » et « en sommeil » ne se confondent pas -----------------------

{
  const ctx = { aTraiter: [message({ id: 'm4', importance: IMPORTANCE.urgent })] }

  const neuf = alertesActives(etat(), AUJOURDHUI, ctx)
  assert.ok(neuf.some((a) => a.id === 'mail-m4'), 'sans marquage, l’alerte est visible')

  const lu = alertesActives(etat({ settings: { snoozes: {}, vus: { 'mail-m4': AUJOURDHUI } } }), AUJOURDHUI, ctx)
  assert.ok(!lu.some((a) => a.id === 'mail-m4'), 'marquée vue, elle ne revient pas')

  const endormie = alertesActives(
    etat({ settings: { snoozes: { 'mail-m4': '2026-08-07' }, vus: {} } }),
    AUJOURDHUI,
    ctx,
  )
  assert.ok(!endormie.some((a) => a.id === 'mail-m4'), 'mise en sommeil, elle se tait jusqu’à l’échéance')

  const reveillee = alertesActives(
    etat({ settings: { snoozes: { 'mail-m4': '2026-07-25' }, vus: {} } }),
    AUJOURDHUI,
    ctx,
  )
  assert.ok(reveillee.some((a) => a.id === 'mail-m4'), 'le sommeil expiré, elle revient — c’est tout l’intérêt')
}

// --- 6. « vu » ne doit pas pouvoir faire taire n'importe quoi ---------------

const source = lire('src/alerts.ts')
assert.match(
  source,
  /TYPES_MARQUABLES_VUS/,
  'le marquage « vu » doit être borné à une liste explicite de types',
)
for (const type of ['facture_retard', 'obligation', 'decennale', 'situation_a_verifier']) {
  assert.ok(
    !new RegExp(`TYPES_MARQUABLES_VUS[^)]*'${type}'`).test(source),
    `« ${type} » ne doit pas être marquable « vu » : elle se règle en agissant, pas en lisant`,
  )
}

// --- 7. rien ne sort de l'application ---------------------------------------

assert.doesNotMatch(
  source,
  /fetch\(|sendMail|webpush|Notification\(/,
  'A.11 ne notifie qu’À L’ÉCRAN : ni e-mail sortant, ni notification poussée (divergence déclarée, plan §3.15)',
)

console.log('Notifications : trois producteurs bornés, rétrocompatibles, et rien ne sort de l’application.')
