// 5.8 — registre des visas par projet (retour d'usage du 03/08/2026).
//
// En phase VISA, la MOE vise les documents d'exécution des entreprises dans
// le délai du CCAP. Un visa en retard engage sa responsabilité : l'entreprise
// exécute sans visa, et le retard du visa devient l'excuse de tous les
// retards du lot. La phase VISA existait partout (échéancier, catégorisation)
// sans qu'aucun registre ne suive ce qui est à viser.
//
// Quatre choses tenues ici :
//
//   1. l'échéance = reçu le + délai du CCAP, en jours CALENDAIRES — compter
//      en ouvrés offrirait à la MOE un délai qu'aucun contrat ne lui donne ;
//   2. le retard : échéance strictement dépassée (le délai court jusqu'à son
//      dernier jour inclus), et seuls les visas EN ATTENTE comptent — un
//      document visé, même tardivement, ne s'alerte plus ;
//   3. l'alerte à J−3, pas à J−10 : assez tôt pour viser dans le délai,
//      assez tard pour que le fil ne liste pas tout le courrier de la
//      semaine — un fil bruyant cesse d'être lu ;
//   4. le geste est un acte : daté (viseLe) ET signé (visePar) en une seule
//      écriture — un statut changé sans date ni signature ne prouverait
//      rien le jour où on demande qui a visé quoi et quand.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

/** charge un module de `src/` en résolvant RÉELLEMENT ses imports relatifs
 *  (même chargeur que test-alerte-entreprise) : bouchonner un module du
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

const V = charger('src/visas.ts')
const { computeAlertes } = charger('src/alerts.ts')

// --- 1. l'échéance, calculée à la main --------------------------------------

{
  assert.equal(V.DELAI_VISA_DEFAUT, 15, 'le délai par défaut est celui de l’usage courant des CCAP : 15 jours')

  assert.equal(V.echeanceVisa({ recuLe: '2026-08-01', delaiJours: 15 }), '2026-08-16', '1er août + 15 jours = 16 août')
  assert.equal(V.echeanceVisa({ recuLe: '2026-07-25', delaiJours: 15 }), '2026-08-09', 'le changement de mois se franchit : 25 juillet + 15 = 9 août')
  assert.equal(
    V.echeanceVisa({ recuLe: '2026-08-03', delaiJours: 5 }),
    '2026-08-08',
    'jours CALENDAIRES : lundi 3 + 5 = samedi 8 — compter en ouvrés offrirait un délai qu’aucun contrat ne donne',
  )
  assert.equal(V.echeanceVisa({ recuLe: '2026-08-01', delaiJours: null }), '2026-08-16', 'délai non saisi : le défaut s’applique, l’échéance existe quand même')
  assert.equal(V.echeanceVisa({ recuLe: '2026-08-01', delaiJours: -3 }), '2026-08-16', 'délai négatif (import raté) : le défaut, pas une échéance antérieure à la réception')
  assert.equal(V.echeanceVisa({ recuLe: 'n’importe quoi', delaiJours: 15 }), null, 'réception illisible : null, pas une échéance inventée')
}

// --- 2. le retard : échéance dépassée, visas en attente seulement ------------

const visa = (over = {}) => ({
  id: 'v1',
  projetId: 'P01',
  marcheId: null,
  lot: 'Lot 03 — Charpente',
  document: 'Plans EXE R+1 — indice B',
  recuLe: '2026-08-01',
  delaiJours: 15,
  statut: 'a_viser',
  ...over,
})

{
  const today = '2026-08-20'
  // échéance 16/08 < 20/08 : en retard
  assert.equal(V.visasEnRetard([visa()], today).length, 1, 'échéance du 16 dépassée le 20 : le visa est en retard')
  // le jour J n'est pas un retard : le délai court jusqu'à son dernier jour inclus
  const jourJ = visa({ id: 'v2', recuLe: '2026-08-05' }) // échéance 20/08
  assert.equal(V.visasEnRetard([jourJ], today).length, 0, 'échéance au jour J : pas encore un retard — le délai court jusqu’à son dernier jour inclus')
  assert.equal(V.visasSousHuitaine([jourJ], today).length, 1, 'mais il est bien « sous huitaine » (J−0)')

  for (const statut of ['vise', 'vise_observations', 'refuse']) {
    assert.equal(
      V.visasEnRetard([visa({ statut })], today).length,
      0,
      `un document « ${statut} » ne compte plus : le geste a été fait, même tardivement — c’est lui qui compte`,
    )
  }

  // la huitaine : J+7 inclus, J+8 exclus, et disjointe du retard
  const j7 = visa({ id: 'v7', recuLe: '2026-08-12' }) // échéance 27/08, dj = 7
  const j8 = visa({ id: 'v8', recuLe: '2026-08-13' }) // échéance 28/08, dj = 8
  assert.equal(V.visasSousHuitaine([j7], today).length, 1, 'J−7 : sous huitaine')
  assert.equal(V.visasSousHuitaine([j8], today).length, 0, 'J−8 : pas encore')
  assert.equal(V.visasSousHuitaine([visa()], today).length, 0, 'un visa en retard n’est pas AUSSI « sous huitaine » : le compter deux fois gonflerait le registre')
}

// --- 3. l'alerte à J−3, pas à J−10 ------------------------------------------

// jour < 10 pour que « situation mensuelle manquante » ne se mêle pas au tri
const AUJOURDHUI = '2026-08-04'

// collections lues dans AppState plutôt que recopiées : une collection
// ajoutée demain ne doit pas faire échouer ce test sur un `undefined`
const COLLECTIONS = (() => {
  const types = lire('src/types.ts')
  const debut = types.indexOf('export interface AppState')
  const bloc = types.slice(debut, types.indexOf('\n}', debut))
  return [...bloc.matchAll(/^  ([a-zA-Z_]+)\??:\s*[A-Za-z]+\[\]/gm)].map((m) => m[1])
})()
assert.ok(COLLECTIONS.includes('visas'), 'AppState doit porter la collection visas — le producteur d’alertes la lit')

const etat = (over = {}) => {
  const vide = {}
  for (const c of COLLECTIONS) vide[c] = []
  return {
    version: 21,
    ...vide,
    settings: { snoozes: {}, vus: {}, personnes: ['Julien'], equipe: [], ...(over.settings || {}) },
    ...over,
  }
}

const produites = (s) => computeAlertes(s, AUJOURDHUI).filter((a) => a.type === 'visa_a_rendre')

{
  assert.equal(typeof V.SEUIL_ALERTE_VISA_JOURS, 'number', 'le seuil est une constante nommée, exportée — pas un littéral enfoui dans le producteur')
  assert.equal(V.SEUIL_ALERTE_VISA_JOURS, 3, 'l’alerte se lève à J−3 de l’échéance')

  // échéance au 07/08 (reçu le 23/07 + 15 j) : J−3 aujourd'hui 04/08 → alerte
  const s = etat({ visas: [visa({ recuLe: '2026-07-23' })] })
  const [a, ...reste] = produites(s)
  assert.ok(a, 'à J−3 de l’échéance, un visa non traité DOIT alerter')
  assert.equal(reste.length, 0, 'un visa, une alerte — pas de doublon')
  assert.equal(a.id, 'visa:v1', 'identifiant stable : le snooze doit retrouver la même alerte demain')
  assert.equal(a.gravite, 2, 'à J−3, à traiter — pas encore rouge : le délai n’est pas dépassé')
  assert.equal(a.date, '2026-08-07', 'l’alerte porte l’échéance du CCAP, celle que le registre affiche')
  assert.equal(a.projetId, 'P01', 'l’alerte porte son projet : le fil d’un projet se rassemble sans redécouper les titres')
  assert.equal(a.lien, '#/projets/P01/chantier', 'le lien mène là où le geste existe : le registre des visas de l’onglet Chantier')
  assert.match(a.titre, /Plans EXE R\+1/, 'le document à viser est dans le titre')
  assert.match(a.titre, /Lot 03/, 'le lot concerné est dans le titre')
  assert.equal(a.action, undefined, 'pas d’action rapide : viser demande de LIRE le document — un « ✓ Visé » depuis le fil inviterait à signer sans lire')
}

{
  // échéance au 14/08 (reçu le 30/07 + 15 j) : J−10 → silence
  const s = etat({ visas: [visa({ recuLe: '2026-07-30' })] })
  assert.equal(produites(s).length, 0, 'à J−10, silence : alerter dix jours avant noierait le fil, et un fil bruyant cesse d’être lu')
}

{
  // la borne exacte suit la constante : J−3 alerte, J−4 pas encore
  const j4 = etat({ visas: [visa({ recuLe: '2026-07-24' })] }) // échéance 08/08, dj = 4
  assert.equal(produites(j4).length, 0, `à J−${V.SEUIL_ALERTE_VISA_JOURS + 1}, pas encore — le producteur suit la constante, pas un littéral`)
}

{
  // échéance dépassée : la responsabilité court, rouge, et le retard est dit
  const s = etat({ visas: [visa({ recuLe: '2026-07-01' })] }) // échéance 16/07, 19 j de retard
  const [a] = produites(s)
  assert.ok(a, 'un visa en retard reste alertant tant que rien n’est visé — le silence serait le défaut que le registre corrige')
  assert.equal(a.gravite, 3, 'échéance dépassée : rouge')
  assert.match(a.titre, /retard de 19 j/, 'le retard se chiffre dans le titre')
}

{
  // un visa traité ne s'alerte plus, même signé après l'échéance
  const s = etat({ visas: [visa({ recuLe: '2026-07-01', statut: 'vise_observations', viseLe: '2026-08-01', visePar: 'Julien' })] })
  assert.equal(produites(s).length, 0, 'visé (même avec observations, même tardivement) : l’alerte s’éteint — le geste a été fait')
}

{
  // réception illisible : pas d'échéance, pas d'alerte inventée
  const s = etat({ visas: [visa({ recuLe: '01/08/2026' })] })
  assert.equal(produites(s).length, 0, 'sans date de réception lisible, pas d’échéance — on n’alerte pas sur du vide')
}

// --- 4. le geste est daté ET signé ; le registre passe par Table -------------

{
  const ecran = lire('src/modules/ProjetChantier.tsx')
  assert.match(ecran, /CarteVisas/, 'le bloc « Visas » existe dans l’onglet Chantier du projet')
  assert.match(ecran, /Viser avec observations/, 'le geste « Viser avec observations » existe')
  assert.match(ecran, /Refuser le document/, 'le geste « Refuser » existe')
  assert.match(ecran, /x\.viseLe = todayISO\(\)/, 'le geste pose une DATE : quand la MOE a visé compte si le délai est contesté')
  assert.match(ecran, /x\.visePar = signataire/, 'le geste se SIGNE : la responsabilité du visa a un nom')
  assert.match(ecran, /statut: 'a_viser'/, 'un document consigné naît « à viser » : consigner la réception n’est pas viser')
  assert.match(ecran, /delaiVisaJours \?\? DELAI_VISA_DEFAUT/, 'le délai du projet pré-remplit chaque visa, le défaut de src/visas.ts ferme la marche')

  const alertes = lire('src/alerts.ts')
  assert.match(alertes, /SEUIL_ALERTE_VISA_JOURS/, 'le producteur lit la constante nommée de src/visas.ts — un littéral divergerait sans que rien ne le signale')
  assert.match(alertes, /echeanceVisa/, 'le producteur calcule l’échéance avec la MÊME fonction que l’écran')

  const types = lire('src/types.ts')
  assert.match(types, /'visa_a_rendre'/, 'le type d’alerte est déclaré dans TypeAlerte (les types sont effacés à la transpilation : on le vérifie à la source)')
  assert.match(types, /export interface Visa/, 'l’entité Visa est déclarée')

  const store = lire('src/store.tsx')
  assert.match(store, /etat\.visas = Array\.isArray\(parsed\.visas\) \? parsed\.visas : \[\]/, 'la collection se normalise au chargement, sur le modèle des autres — un état antérieur naît vide')
  const seed = lire('src/seed.ts')
  assert.match(seed, /visas: \[\]/, 'la collection est amorcée VIDE dans le seed — un visa d’exemple lèverait une alerte de responsabilité sur du faux')
}

// --- le module reste pur ----------------------------------------------------

{
  const source = lire('src/visas.ts')
  assert.doesNotMatch(source, /useStore|localStorage|fetch\(|Date\.now|todayISO/, 'la logique des visas ne lit ni l’état ni l’horloge : today est un argument')
}

console.log(
  'Visas : échéance = réception + délai CCAP en jours calendaires ; retard strictement après ' +
    'l’échéance et seulement en attente ; alerte à J−3 (rouge une fois dépassée), silencieuse à J−10 ' +
    'et sur les visas traités ; le geste est daté, signé, et naît « à viser ».',
)
