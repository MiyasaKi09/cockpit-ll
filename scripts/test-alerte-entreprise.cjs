// 5.7 — alerte « entreprise à confirmer » à M−1 (retour d'usage du 03/08/2026).
//
// Une entreprise qui découvre sa date deux semaines avant ne vient pas :
// c'est le mode de retard le plus courant, et il est entièrement prévisible.
// Le producteur (A.11) lève l'alerte quand une tâche de chantier démarre
// sous SEUIL_CONFIRMATION_JOURS sans que l'entreprise ait confirmé, marché
// actif — et l'humain décide : « Confirmé » pose la date, « Relancer »
// ouvre un BROUILLON Gmail, jamais un envoi (§15).
//
// Quatre choses tenues ici :
//
//   1. la fenêtre : alerte à J−25, rien à J−45, rien après la date — la
//      confirmation n'a plus d'objet, le suivi de retard prend le relais ;
//   2. le silence des cas réglés : tâche confirmée, marché inactif, tâche
//      sans marché — relancer un marché soldé serait du bruit, et un fil
//      d'urgences bruyant cesse d'être lu ;
//   3. le seuil est UNE constante nommée, partagée entre le producteur et
//      l'écran : deux littéraux divergeraient sans que rien ne le signale ;
//   4. les gestes : l'action de l'alerte pose confirmeLe (Cockpit), l'écran
//      planning porte « Relancer » en brouillon via ouvrirGmail.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

/** charge un module de `src/` en résolvant RÉELLEMENT ses imports relatifs
 *  (même chargeur que test-notifications) : bouchonner un module du dépôt
 *  reviendrait à tester le bouchon plutôt que le code. */
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

const { computeAlertes } = charger('src/alerts.ts')
const chantier = charger('src/chantier.ts')
const { addDays } = charger('src/util.ts')

const { SEUIL_CONFIRMATION_JOURS, tacheAConfirmer, tacheDeReprise } = chantier
assert.equal(typeof SEUIL_CONFIRMATION_JOURS, 'number', 'le seuil est une constante nommée, exportée — pas un littéral enfoui')

// jour < 10 pour que « situation mensuelle manquante » ne se mêle pas au tri
const AUJOURDHUI = '2026-08-04'

// L'état minimal : collections lues dans AppState plutôt que recopiées —
// une collection ajoutée demain ne doit pas faire échouer ce test sur un
// `undefined` qui n'est pas son sujet.
const COLLECTIONS = (() => {
  const types = lire('src/types.ts')
  const debut = types.indexOf('export interface AppState')
  const bloc = types.slice(debut, types.indexOf('\n}', debut))
  return [...bloc.matchAll(/^  ([a-zA-Z_]+)\??:\s*[A-Za-z]+\[\]/gm)].map((m) => m[1])
})()
assert.ok(COLLECTIONS.includes('tachesChantier'), 'AppState doit porter tachesChantier — le producteur lit cette collection')

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

const marche = (over = {}) => ({
  id: 'm1',
  projetId: 'P01',
  entreprise: 'Batidur',
  lot: 'Lot 02 — Gros œuvre',
  montantInitialHT: 100000,
  avenantsHT: 0,
  tauxRG: 0.05,
  revision: false,
  delaiVerifJours: 15,
  actif: true,
  ...over,
})

const tache = (over = {}) => ({
  id: 't1',
  projetId: 'P01',
  lotDceId: null,
  elementId: null,
  marcheId: 'm1',
  lot: 'Lot 02 — Gros œuvre',
  designation: 'Dallage du hall',
  debut: addDays(AUJOURDHUI, 25),
  fin: addDays(AUJOURDHUI, 30),
  statut: 'prevu',
  ...over,
})

const produites = (s) => computeAlertes(s, AUJOURDHUI).filter((a) => a.type === 'entreprise_a_confirmer')

// --- 1. la fenêtre : J−25 alerte, J−45 non, date passée non ------------------

{
  const s = etat({ marches: [marche()], tachesChantier: [tache()] })
  const [a, ...reste] = produites(s)
  assert.ok(a, 'à J−25, une tâche non confirmée d’un marché actif DOIT alerter')
  assert.equal(reste.length, 0, 'une tâche, une alerte — pas de doublon')
  assert.equal(a.id, 'confirme:t1', 'identifiant stable : le snooze doit retrouver la même alerte demain')
  assert.match(a.titre, /Batidur/, 'l’entreprise à relancer est dans le titre')
  assert.match(a.titre, /Lot 02/, 'le lot concerné est dans le titre')
  assert.equal(a.projetId, 'P01', 'l’alerte porte son projet (A.11) : le fil d’un projet se rassemble sans redécouper les titres')
  assert.equal(a.lien, '#/projets/P01/planning', 'le lien mène là où les gestes existent : le planning travaux du projet')
  assert.deepEqual(
    a.action,
    { kind: 'confirmer_tache', refId: 't1', label: '✓ Confirmé' },
    'l’action rapide pose confirmeLe sur LA tâche — l’humain confirme, la machine n’écrit rien seule',
  )
}

{
  const s = etat({ marches: [marche()], tachesChantier: [tache({ debut: addDays(AUJOURDHUI, 45), fin: addDays(AUJOURDHUI, 50) })] })
  assert.equal(produites(s).length, 0, 'à J−45, rien : alerter deux mois avant noierait le fil, et un fil bruyant cesse d’être lu')
}

{
  const s = etat({ marches: [marche()], tachesChantier: [tache({ debut: addDays(AUJOURDHUI, -2) })] })
  assert.equal(produites(s).length, 0, 'date de début passée : confirmer n’a plus d’objet, le suivi de retard prend le relais')
}

// --- le seuil exact : la constante fait foi, à un jour près ------------------

{
  const limite = etat({ marches: [marche()], tachesChantier: [tache({ debut: addDays(AUJOURDHUI, SEUIL_CONFIRMATION_JOURS), fin: null })] })
  assert.equal(produites(limite).length, 1, `à J−${SEUIL_CONFIRMATION_JOURS} exactement, l’alerte se lève`)

  const apres = etat({ marches: [marche()], tachesChantier: [tache({ debut: addDays(AUJOURDHUI, SEUIL_CONFIRMATION_JOURS + 1), fin: null })] })
  assert.equal(produites(apres).length, 0, `à J−${SEUIL_CONFIRMATION_JOURS + 1}, pas encore — le producteur suit la constante, pas un littéral`)
}

// --- la gravité monte quand on entre dans le mode de défaillance connu ------

{
  const proche = etat({ marches: [marche()], tachesChantier: [tache({ debut: addDays(AUJOURDHUI, 10), fin: null })] })
  assert.equal(produites(proche)[0].gravite, 3, 'sous deux semaines, on est DANS le cas « elle ne viendra pas » : rouge')
  const loin = etat({ marches: [marche()], tachesChantier: [tache()] })
  assert.equal(produites(loin)[0].gravite, 2, 'à J−25, à surveiller — pas encore rouge')
}

// --- 2. le silence des cas réglés -------------------------------------------

{
  const s = etat({ marches: [marche()], tachesChantier: [tache({ confirmeLe: '2026-08-01' })] })
  assert.equal(produites(s).length, 0, 'une fois confirmeLe posé, l’alerte s’éteint — sinon confirmer ne servirait à rien')
}

{
  const s = etat({ marches: [marche({ actif: false })], tachesChantier: [tache()] })
  assert.equal(produites(s).length, 0, 'marché inactif : relancer une entreprise dont le marché est soldé serait du bruit')
}

{
  const s = etat({ marches: [marche()], tachesChantier: [tache({ marcheId: null })] })
  assert.equal(produites(s).length, 0, 'tâche sans marché : pas d’entreprise à relancer, pas d’alerte dans le vide')
}

{
  const s = etat({ marches: [marche()], tachesChantier: [tache({ statut: 'fait' })] })
  assert.equal(produites(s).length, 0, 'tâche déjà faite : il n’y a plus rien à confirmer')
}

// --- une reprise (5.6) redemande sa confirmation ----------------------------

{
  // La tâche d'origine était confirmée ; sa reprise repart SANS confirmeLe :
  // une nouvelle date est un nouveau oui à obtenir de l'entreprise.
  const origine = tache({ confirmeLe: '2026-07-01' })
  const r = tacheDeReprise(origine, 't-reprise')
  assert.equal(r.confirmeLe, undefined, 'la confirmation ne s’hérite pas : elle portait sur les dates d’origine')
  assert.equal(tacheAConfirmer(r, marche(), AUJOURDHUI), false, 'sans date posée, pas encore d’alerte — on ne relance pas dans le vide')
  const datee = { ...r, debut: addDays(AUJOURDHUI, 10) }
  assert.equal(tacheAConfirmer(datee, marche(), AUJOURDHUI), true, 'la date de reprise posée sous le seuil : la confirmation se redemande')
}

// --- 3. un seul prédicat, une seule constante -------------------------------

{
  const srcAlerts = lire('src/alerts.ts')
  assert.match(srcAlerts, /tacheAConfirmer/, 'le producteur passe par le prédicat partagé — une seconde définition divergerait de l’écran')
  const srcChantier = lire('src/chantier.ts')
  assert.match(srcChantier, /SEUIL_CONFIRMATION_JOURS/, 'le seuil vit dans une constante nommée de src/chantier.ts')
  const srcEcran = lire('src/modules/ProjetPlanning.tsx')
  assert.match(srcEcran, /tacheAConfirmer/, 'l’écran planning lit le MÊME prédicat que le producteur d’alertes')
}

// --- 4. les gestes : confirmer écrit une date, relancer ouvre un brouillon --

{
  const cockpit = lire('src/modules/Cockpit.tsx')
  assert.match(cockpit, /confirmer_tache/, 'le fil d’urgences sait exécuter l’action « ✓ Confirmé »')
  assert.match(cockpit, /confirmeLe = today/, 'confirmer pose une DATE, pas une case : quand l’entreprise a dit oui compte si elle se dédit')

  const ecran = lire('src/modules/ProjetPlanning.tsx')
  assert.match(ecran, /Relancer l’entreprise/, 'le geste « Relancer » existe à l’écran planning')
  assert.match(ecran, /ouvrirGmail\(/, 'la relance passe par ouvrirGmail → gmailComposeUrl : un brouillon, jamais un envoi (§15)')
  assert.match(ecran, /confirmeLe = today/, '« Entreprise confirmée » pose confirmeLe depuis l’écran aussi, pas seulement depuis le fil')
  assert.match(
    ecran,
    /contactEmail/,
    'le brouillon part vers le contact du marché — entreprise, lot et dates pré-remplis',
  )

  const types = lire('src/types.ts')
  assert.match(types, /'entreprise_a_confirmer'/, 'le type d’alerte est déclaré dans TypeAlerte (les types sont effacés à la transpilation : on le vérifie à la source)')
  assert.match(types, /kind: 'confirmer_tache'/, 'l’action est déclarée dans ActionAlerte')
}

console.log(
  'Alerte entreprise : levée à J−25 (rouge sous 14 j), silencieuse à J−45, après confirmation, ' +
    'marché inactif ou date passée ; seuil en constante partagée producteur/écran ; « Confirmé » pose une date, ' +
    '« Relancer » ouvre un brouillon Gmail — l’envoi reste un clic humain.',
)
