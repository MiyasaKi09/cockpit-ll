// 5.10 — cotraitants et BET : la chaîne d'honoraires ENTRANTE (retour
// d'usage du 03/08/2026).
//
// Chaque mois, les partenaires de maîtrise d'œuvre (BET structure, fluides,
// économiste…) envoient leur note d'honoraires à l'agence mandataire. Une
// note oubliée deux mois ne se voyait qu'au bilan : rien ne suivait le
// convenu par cotraitant, rien ne comptait le reçu.
//
// Cinq choses tenues ici :
//
//   1. les mois échus se comptent À LA MAIN : actif depuis mars (première
//      note consignée), on est en juin, notes reçues mars et mai — AVRIL
//      manque, et seulement avril : juin n'est pas échu, mai est reçue ;
//   2. jamais de relance pour un INACTIF : sa mission est terminée, le
//      relancer serait du bruit — et un fil bruyant cesse d'être lu ;
//   3. le cumul reçu ne compte que les notes ARRIVÉES : une note attendue
//      au montant estimé gonflerait le réel affiché face au convenu ;
//   4. le reste à payer répond null sans convenu saisi — un « 0 € restant »
//      affirmerait qu'une convention a été lue ;
//   5. le réel s'AFFICHE face au convenu, il n'entre pas dans la marge :
//      l'audit 5.14 vient de vérifier cette chaîne, on ne l'étend pas.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

/** charge un module de `src/` en résolvant RÉELLEMENT ses imports relatifs
 *  (même chargeur que test-visas) : bouchonner un module du dépôt
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

const C = charger('src/cotraitants.ts')
const { computeAlertes } = charger('src/alerts.ts')

const cotraitant = (over = {}) => ({
  id: 'ct1',
  projetId: 'P01',
  nom: 'BET Structure Nord',
  type: 'bet',
  mission: 'Structure',
  honorairesConvenusHT: 12000,
  email: 'contact@bet-nord.example',
  actif: true,
  ...over,
})

const note = (mois, over = {}) => ({
  id: `nh-${mois}`,
  cotraitantId: 'ct1',
  projetId: 'P01',
  mois,
  montantHT: 4000,
  recueLe: `${mois}-28`,
  reglee: false,
  ...over,
})

// --- 1. les mois échus, calculés à la main ----------------------------------

{
  // actif depuis mars (première note consignée), on est en juin,
  // notes reçues mars et mai ⇒ AVRIL manque, et seulement avril
  const notes = [note('2026-03'), note('2026-05')]
  assert.deepEqual(
    C.moisManquants(cotraitant(), notes, '2026-06'),
    ['2026-04'],
    'mars reçue, mai reçue, juin pas échu : seul avril manque',
  )

  // le mois courant n'est JAMAIS échu : l'entreprise facture à terme échu
  assert.deepEqual(
    C.moisManquants(cotraitant(), [note('2026-03')], '2026-06'),
    ['2026-04', '2026-05'],
    'juin (mois courant) n’est pas échu — une note de juin ne se relance pas en juin',
  )

  // une note consignée mais NON reçue (recueLe null) compte manquante :
  // elle est attendue, pas arrivée
  assert.deepEqual(
    C.moisManquants(cotraitant(), [note('2026-03'), note('2026-04', { recueLe: null })], '2026-06'),
    ['2026-04', '2026-05'],
    'une note attendue (recueLe null) n’est pas une note reçue : le mois manque toujours',
  )

  // sans aucune note consignée, le début de mission est inconnu : rien ne
  // manque — on ne relance pas sur une mission dont on ignore le début
  assert.deepEqual(C.moisManquants(cotraitant(), [], '2026-06'), [], 'aucune note consignée : aucun mois échu')

  // le changement d'année se franchit
  assert.deepEqual(
    C.moisManquants(cotraitant(), [note('2025-11'), note('2026-01')], '2026-02'),
    ['2025-12'],
    'novembre reçue, janvier reçue : décembre manque — le passage d’année se compte',
  )

  // un mois courant illisible ne fabrique pas de relance
  assert.deepEqual(C.moisManquants(cotraitant(), [note('2026-03')], 'n’importe quoi'), [], 'mois courant illisible : rien, pas une boucle folle')
}

// --- 2. jamais de relance pour un inactif -----------------------------------

{
  const notes = [note('2026-03'), note('2026-05')]
  assert.deepEqual(
    C.moisManquants(cotraitant({ actif: false }), notes, '2026-06'),
    [],
    'un cotraitant INACTIF ne se relance jamais : sa mission est terminée, relancer serait du bruit',
  )
  assert.deepEqual(
    C.notesManquantes([cotraitant({ actif: false })], notes, '2026-06'),
    [],
    'l’aplati par (cotraitant, mois) applique la même règle : inactif = silence',
  )
}

// --- 3. les cumuls : seules les notes reçues comptent -----------------------

{
  const notes = [
    note('2026-03', { montantHT: 4000 }),
    note('2026-04', { montantHT: 9999, recueLe: null }), // attendue : ne compte pas
    note('2026-05', { montantHT: 3000 }),
    note('2026-06', { montantHT: null }), // reçue sans montant saisi : 0, pas NaN
  ]
  assert.equal(C.cumulRecuHT('ct1', notes), 7000, 'cumul reçu = 4000 + 3000 : la note attendue (9999) ne gonfle pas le réel')
  assert.equal(C.cumulRecuHT('autre', notes), 0, 'les notes d’un autre cotraitant ne comptent pas')

  assert.equal(C.resteAPayer(cotraitant(), notes), 5000, 'reste = 12000 convenus − 7000 reçus')
  assert.equal(
    C.resteAPayer(cotraitant({ honorairesConvenusHT: null }), notes),
    null,
    'sans convenu saisi, le reste répond null — un « 0 € restant » affirmerait qu’une convention a été lue',
  )
  assert.equal(
    C.resteAPayer(cotraitant({ honorairesConvenusHT: 5000 }), notes),
    -2000,
    'reçu au-delà du convenu : le reste est NÉGATIF et le dit — avenant à régulariser, pas un zéro',
  )

  // les totaux projet du rapprochement : convenu (inactifs compris — le
  // convenu est contractuel) face au reçu
  const deux = [cotraitant(), cotraitant({ id: 'ct2', nom: 'BET Fluides', honorairesConvenusHT: 8000, actif: false })]
  assert.equal(C.convenuProjetHT(deux, 'P01'), 20000, 'le convenu du projet somme actifs ET inactifs : une mission terminée reste due')
  assert.equal(C.recuProjetHT(notes, 'P01'), 7000, 'le reçu du projet ne compte que les notes arrivées')
}

// --- 4. le producteur d'alertes : une par cotraitant et mois échu -----------

// jour < 10 pour que « situation mensuelle manquante » ne se mêle pas au tri
const AUJOURDHUI = '2026-06-04'

// collections lues dans AppState plutôt que recopiées : une collection
// ajoutée demain ne doit pas faire échouer ce test sur un `undefined`
const COLLECTIONS = (() => {
  const types = lire('src/types.ts')
  const debut = types.indexOf('export interface AppState')
  const bloc = types.slice(debut, types.indexOf('\n}', debut))
  return [...bloc.matchAll(/^  ([a-zA-Z_]+)\??:\s*[A-Za-z]+\[\]/gm)].map((m) => m[1])
})()
assert.ok(COLLECTIONS.includes('cotraitants'), 'AppState doit porter la collection cotraitants — le producteur d’alertes la lit')
assert.ok(COLLECTIONS.includes('notesHonoraires'), 'AppState doit porter la collection notesHonoraires')

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

const produites = (s) => computeAlertes(s, AUJOURDHUI).filter((a) => a.type === 'note_honoraires_manquante')

{
  // le scénario de référence : avril manque en juin (écart de 2 mois → rouge)
  const s = etat({ cotraitants: [cotraitant()], notesHonoraires: [note('2026-03'), note('2026-05')] })
  const [a, ...reste] = produites(s)
  assert.ok(a, 'un mois échu sans note reçue DOIT alerter')
  assert.equal(reste.length, 0, 'un seul mois manque : une seule alerte')
  assert.equal(a.id, 'noteh:ct1:2026-04', 'identifiant stable par (cotraitant, mois) : le snooze doit retrouver la même alerte demain')
  assert.match(a.titre, /BET Structure Nord/, 'le cotraitant est dans le titre')
  assert.match(a.titre, /avr\. 2026/, 'le mois manquant est dans le titre, en clair')
  assert.equal(a.gravite, 3, 'avril manquant en juin : deux mois d’écart, ce n’est plus un oubli de fin de mois — rouge')
  assert.equal(a.lien, '#/projets/P01/finances', 'le lien mène là où la note se consigne : le bloc Cotraitance de l’onglet Finance')
  assert.equal(a.projetId, 'P01', 'l’alerte porte son projet')
  assert.deepEqual(
    a.action,
    { kind: 'relancer_cotraitant', refId: 'ct1', mois: '2026-04', label: 'Relancer' },
    'l’action « Relancer » ouvre un BROUILLON pour CE mois — la machine propose, l’envoi reste un clic humain (§15)',
  )
}

{
  // un seul mois d'écart : à traiter, pas encore rouge
  const s = etat({ cotraitants: [cotraitant()], notesHonoraires: [note('2026-04')] })
  const [a] = produites(s)
  assert.equal(a.id, 'noteh:ct1:2026-05', 'mai manque')
  assert.equal(a.gravite, 2, 'un mois d’écart est un oubli de fin de mois : orange, pas rouge')
}

{
  // sans adresse : pas d'action — un brouillon sans destinataire n'irait nulle part
  const s = etat({ cotraitants: [cotraitant({ email: undefined })], notesHonoraires: [note('2026-03'), note('2026-05')] })
  const [a] = produites(s)
  assert.ok(a, 'l’alerte se lève même sans adresse : le manque existe')
  assert.equal(a.action, undefined, 'mais sans adresse, pas d’action « Relancer » — le brouillon n’aurait pas de destinataire')
}

{
  // inactif : silence total du producteur
  const s = etat({ cotraitants: [cotraitant({ actif: false })], notesHonoraires: [note('2026-03')] })
  assert.equal(produites(s).length, 0, 'JAMAIS de relance pour un cotraitant inactif — même avec des mois non reçus derrière lui')
}

{
  // deux mois manquants = deux alertes distinctes, chacune relançable
  const s = etat({ cotraitants: [cotraitant()], notesHonoraires: [note('2026-03')] })
  const deux = produites(s)
  assert.equal(deux.length, 2, 'avril et mai manquent : deux alertes, une par mois — chaque relance vise UN mois')
  assert.deepEqual(deux.map((a) => a.id).sort(), ['noteh:ct1:2026-04', 'noteh:ct1:2026-05'])
}

// --- 5. le brouillon de relance : un texte, deux écrans ----------------------

{
  const sujet = C.sujetRelanceNote(cotraitant(), '2026-04')
  assert.match(sujet, /avr\. 2026/, 'le sujet nomme le mois en clair')
  assert.match(sujet, /Structure/, 'le sujet nomme la mission')

  const corps = C.corpsRelanceNote(cotraitant(), '2026-04', 'P01 — Maison L.', 'Agence L&L')
  assert.match(corps, /avr\. 2026/, 'le corps nomme le mois manquant')
  assert.match(corps, /P01 — Maison L\./, 'le corps nomme l’opération')
  assert.match(corps, /Agence L&L/, 'le corps se signe du nom de l’agence')
  assert.doesNotMatch(corps, /https?:\/\//, 'le corps ne construit aucune URL : gmailComposeUrl (src/util.ts) reste le seul constructeur d’envoi')

  const cockpit = lire('src/modules/Cockpit.tsx')
  assert.match(cockpit, /relancer_cotraitant/, 'le fil d’urgences exécute l’action « Relancer »')
  assert.match(
    cockpit,
    /relancer_cotraitant[\s\S]{0,600}?ouvrirGmail\(\s*c\.email,\s*sujetRelanceNote\(c, action\.mois\),\s*corpsRelanceNote\(/,
    'l’action ouvre un BROUILLON (ouvrirGmail → gmailComposeUrl) avec le texte de src/cotraitants.ts — le même que l’écran projet',
  )

  const ecran = lire('src/modules/Projets.tsx')
  assert.match(ecran, /CarteCotraitance/, 'le bloc « Cotraitance » existe dans la fiche projet (onglet Finance)')
  assert.match(ecran, /moisManquants\(/, 'l’écran lit les mois manquants au MÊME prédicat que le producteur d’alertes')
  assert.match(
    ecran,
    /ouvrirGmail\(\s*c\.email \|\| '',\s*sujetRelanceNote\(c, mois\),\s*corpsRelanceNote\(/,
    'la relance de l’écran ouvre le même brouillon que le fil d’urgences — deux rédactions divergeraient sans que rien ne le signale',
  )
}

// --- le réel s'affiche FACE au convenu, la marge ne bouge pas ----------------

{
  const ecran = lire('src/modules/Projets.tsx')
  assert.match(
    ecran,
    /reçu \{fmtMoney\(recuCotraitance\)\} \/ convenu \{fmtMoney\(convenuCotraitance\)\}/,
    'le réel reçu s’affiche FACE au convenu, là où la marge lit le budget externe',
  )
  assert.match(
    ecran,
    /const margeReelle = factTotal - coutTemps - externes/,
    'le calcul de marge de l’onglet Finance ne bouge PAS : l’audit 5.14 vient de le vérifier, le réel de la cotraitance s’AFFICHE (5.10), il ne s’y substitue pas',
  )

  const derive = lire('src/derive.ts')
  const economie = lire('src/economie.ts')
  assert.doesNotMatch(derive, /notesHonoraires|cumulRecuHT|recuProjetHT/, 'derive.ts ne lit pas les notes d’honoraires : le calcul de marge reste celui que 5.14 a vérifié')
  assert.doesNotMatch(economie, /notesHonoraires|cumulRecuHT|recuProjetHT/, 'economie.ts non plus — le rapprochement est un AFFICHAGE, pas un nouveau calcul')
}

// --- câblage : collection normalisée, seed vide, types déclarés --------------

{
  const types = lire('src/types.ts')
  assert.match(types, /export interface Cotraitant/, 'l’entité Cotraitant est déclarée')
  assert.match(types, /export interface NoteHonoraires/, 'l’entité NoteHonoraires est déclarée')
  assert.match(types, /'note_honoraires_manquante'/, 'le type d’alerte est déclaré dans TypeAlerte (les types sont effacés à la transpilation : on le vérifie à la source)')
  assert.match(types, /kind: 'relancer_cotraitant'; refId: string; mois: string/, 'l’action porte le MOIS visé : une relance vise un mois, pas le cotraitant en général')

  const store = lire('src/store.tsx')
  assert.match(store, /etat\.cotraitants = Array\.isArray\(parsed\.cotraitants\) \? parsed\.cotraitants : \[\]/, 'la collection cotraitants se normalise au chargement — un état antérieur naît vide')
  assert.match(store, /etat\.notesHonoraires = Array\.isArray\(parsed\.notesHonoraires\) \? parsed\.notesHonoraires : \[\]/, 'la collection notesHonoraires aussi')

  const seed = lire('src/seed.ts')
  assert.match(seed, /cotraitants: \[\]/, 'le seed amorce cotraitants VIDE — un cotraitant d’exemple déclencherait des relances sur un partenaire qui n’existe pas')
  assert.match(seed, /notesHonoraires: \[\]/, 'le seed amorce notesHonoraires VIDE — une note inventée fausserait le reçu affiché face au convenu')
}

// --- le module reste pur -----------------------------------------------------

{
  const source = lire('src/cotraitants.ts')
  assert.doesNotMatch(source, /useStore|localStorage|fetch\(|Date\.now|todayISO/, 'la logique des cotraitants ne lit ni l’état ni l’horloge : moisCourant est un argument')
}

console.log(
  'Cotraitants : mois échus comptés depuis la première note consignée (avril manque quand mars et mai ' +
    'sont reçues en juin), jamais de relance pour un inactif, cumul reçu sur les seules notes arrivées, ' +
    'reste null sans convenu, une alerte par (cotraitant, mois) avec brouillon partagé écran/fil — et la ' +
    'marge ne bouge pas : le réel s’affiche face au convenu.',
)
