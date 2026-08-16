// 2.8 — le récapitulatif de fin de journée (§12.4), et l'estimateur UNIQUE
// du temps non enregistré (§3.4 du plan CDC).
//
// CE QUE CE TEST GARDE
// ---------------------
// 1. L'ESTIMATEUR : capacité du jour (heures/jour, congés déduits, week-end
//    à zéro) moins les pointages ARRÊTÉS du jour — jamais négatif, et le
//    chrono en cours ne compte pas : c'est du temps en train de passer.
// 2. LA DÉCISION D'AFFICHAGE, pure et exercée cas par cas : jamais avant
//    l'heure paramétrée, jamais deux fois (« Ignorer » ne repose pas la
//    question), jamais quand le chrono tourne, jamais un jour sans
//    capacité — et le RATTRAPAGE du dernier jour ouvré manqué (le vendredi
//    se rattrape le lundi), sans draguer plus loin qu'un jour déjà traité.
// 3. LA PORTE : l'écran rend la décision au pied du Cockpit, écrit des
//    pointages `source: 'recap_fin_journee'` par geste humain, marque la
//    réponse — et l'état migre. « Livré sans porte » est le mode de panne
//    dominant du dépôt.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')

const cache = new Map()
function charger(chemin) {
  const fichier = chemin.endsWith('.ts') ? chemin : `${chemin}.ts`
  if (cache.has(fichier)) return cache.get(fichier)
  const compile = ts.transpileModule(lire(fichier), {
    fileName: fichier,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  cache.set(fichier, mod.exports)
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (id.startsWith('.')) return charger(path.posix.join(path.posix.dirname(fichier), id))
    throw new Error(`Dépendance externe inattendue dans ${fichier} : ${id}`)
  })
  cache.set(fichier, mod.exports)
  return mod.exports
}

const R = charger('src/recapJournee.ts')
const P = charger('src/pointages.ts')

/** un état minimal — seuls les champs que le module lit */
const etat = (over = {}) => ({
  settings: { heuresParJour: 7, ...(over.settings || {}) },
  absences: over.absences || [],
  pointages: over.pointages || [],
  courriers: over.courriers || [],
  taches: over.taches || [],
  chronos: over.chronos || [],
  recapsJournee: over.recapsJournee || [],
})

const pt = (over) =>
  P.creerPointage({
    personne: over.personne ?? 'Julien',
    debut: over.debut,
    fin: over.fin === undefined ? over.debut : over.fin,
    minutes: over.minutes,
    projetId: over.projetId === undefined ? 'P01' : over.projetId,
    phase: over.phase === undefined ? 'APD' : over.phase,
  })

// Le jeu de dates : la semaine du lundi 10 août 2026.
const MARDI = '2026-08-11'
const VENDREDI = '2026-08-14'
const SAMEDI = '2026-08-15'
const LUNDI_SUIVANT = '2026-08-17'

// ============================================================
// 1. La capacité d'UN jour — heures/jour, congés déduits, week-end nul
// ============================================================

{
  assert.equal(R.capaciteJour(etat(), 'Julien', MARDI), 7, 'un mardi ouvré travaillé : heuresParJour')
  assert.equal(R.capaciteJour(etat(), 'Julien', SAMEDI), 0, 'un samedi n’attend aucune heure — même règle que la capacité de semaine (5 jours ouvrés)')
  assert.equal(
    R.capaciteJour(
      etat({ absences: [{ id: 'a1', personne: 'Julien', debut: MARDI, fin: MARDI, motif: 'congés' }] }),
      'Julien',
      MARDI,
    ),
    0,
    'un jour de congé n’attend aucune heure : le calendrier des congés est lu par `joursAbsents`, la seule autorité',
  )
  assert.equal(
    R.capaciteJour(
      etat({ absences: [{ id: 'a1', personne: 'Zoé', debut: MARDI, fin: MARDI, motif: 'congés' }] }),
      'Julien',
      MARDI,
    ),
    7,
    'le congé de Zoé n’ampute pas la journée de Julien',
  )
}

// ============================================================
// 2. L'estimateur unique : capacité moins pointages, jamais négatif
// ============================================================

{
  const e = etat({
    pointages: [
      pt({ debut: `${MARDI}T09:00:00Z`, minutes: 180 }),
      pt({ debut: `${MARDI}T14:00:00Z`, minutes: 80 }),
      // un chrono EN COURS (fin null) : du temps en train de passer
      { ...pt({ debut: `${MARDI}T16:00:00Z`, minutes: 0 }), fin: null },
      // le pointage d'un AUTRE jour ne compte pas ici
      pt({ debut: `2026-08-10T09:00:00Z`, minutes: 300 }),
    ],
  })
  // 7 h − (180 + 80 min = 4,33 h) = 2,67 — la division vient à la fin
  assert.equal(R.tempsNonEnregistre(e, 'Julien', MARDI), 2.67, 'capacité moins pointages ARRÊTÉS du jour, au centième')
  assert.equal(
    R.tempsNonEnregistre(etat({ pointages: [pt({ debut: `${MARDI}T08:00:00Z`, minutes: 9 * 60 })] }), 'Julien', MARDI),
    0,
    'plus pointé que la capacité ⇒ 0, jamais négatif : un manque négatif s’ajouterait au total de quelqu’un',
  )
  assert.equal(R.tempsNonEnregistre(etat(), 'Julien', SAMEDI), 0, 'capacité nulle ⇒ rien à réclamer')
}

// ============================================================
// 3. Les projets touchés : pointages d'abord, à défaut messages + tâches
// ============================================================

{
  const avecPointages = etat({
    pointages: [
      pt({ debut: `${MARDI}T09:00:00Z`, minutes: 60, projetId: 'P02' }),
      pt({ debut: `${MARDI}T11:00:00Z`, minutes: 60, projetId: 'P01' }),
      pt({ debut: `${MARDI}T14:00:00Z`, minutes: 60, projetId: 'P02' }),
      pt({ debut: `${MARDI}T15:00:00Z`, minutes: 30, projetId: null, phase: null }),
    ],
    courriers: [{ id: 'c1', projetId: 'P09', dateReception: `${MARDI}T10:00:00Z` }],
  })
  assert.deepEqual(
    R.projetsTouches(avecPointages, 'Julien', MARDI),
    ['P02', 'P01'],
    'les pointages sont la trace la plus sûre : quand il y en a, EUX SEULS listent les projets — sans doublon, sans les sans-projet',
  )

  const sansPointages = etat({
    courriers: [
      { id: 'c1', projetId: 'P03', dateReception: `${MARDI}T10:00:00Z` },
      { id: 'c2', projetId: null, dateReception: `${MARDI}T11:00:00Z` },
      { id: 'c3', projetId: 'P03', dateReception: `2026-08-10T09:00:00Z` },
    ],
    taches: [
      { id: 't1', statut: 'terminee', majLe: `${MARDI}T17:00:00Z`, projetId: 'P04', responsable: 'Julien', participants: [] },
      { id: 't2', statut: 'terminee', majLe: `${MARDI}T17:00:00Z`, projetId: 'P05', responsable: 'Zoé', participants: [] },
      { id: 't3', statut: 'en_cours', majLe: `${MARDI}T17:00:00Z`, projetId: 'P06', responsable: 'Julien', participants: [] },
    ],
  })
  assert.deepEqual(
    R.projetsTouches(sansPointages, 'Julien', MARDI),
    ['P03', 'P04'],
    'à défaut : messages rattachés DU jour + tâches passées « terminée » ce jour par la personne — pas celles de l’autre, pas les en-cours',
  )
}

// ============================================================
// 4. La décision d'affichage, cas par cas
// ============================================================

{
  // la veille (lundi 10) est TRAITÉE dans ces cas-ci : on isole la décision
  // « du jour même » — le rattrapage a ses propres cas plus bas
  const LUNDI = '2026-08-10'
  const veilleTraitee = { id: 'r0', personne: 'Julien', jour: LUNDI, etat: 'complete', le: `${LUNDI}T18:00:00Z` }
  const manque = (over = {}) =>
    etat({
      pointages: [pt({ debut: `${MARDI}T09:00:00Z`, minutes: 120 })],
      recapsJournee: [veilleTraitee, ...(over.recapsJournee || [])],
      ...over,
      ...(over.recapsJournee ? { recapsJournee: [veilleTraitee, ...over.recapsJournee] } : {}),
    })

  assert.equal(
    R.recapAPresenter(manque(), 'Julien', `${MARDI}T16:59`),
    null,
    'JAMAIS avant l’heure : en journée, « temps non enregistré » est un faux signal',
  )
  assert.deepEqual(
    R.recapAPresenter(manque(), 'Julien', `${MARDI}T17:30`),
    { jour: MARDI, veille: false },
    'à l’heure dite, avec du temps manquant : le bandeau paraît',
  )
  assert.deepEqual(
    R.recapAPresenter(
      manque({ settings: { heuresParJour: 7, heureRecap: '18:45' } }),
      'Julien',
      `${MARDI}T17:30`,
    ),
    null,
    'l’heure est PARAMÉTRABLE : à 18 h 45 réglé, 17 h 30 se tait',
  )
  assert.equal(
    R.recapAPresenter(
      manque({ recapsJournee: [{ id: 'r1', personne: 'Julien', jour: MARDI, etat: 'ignore', le: `${MARDI}T18:00:00Z` }] }),
      'Julien',
      `${MARDI}T19:00`,
    ),
    null,
    '« Ignorer » ferme sans rien écrire et NE REPOSE PAS la question (§12.4)',
  )
  assert.equal(
    R.recapAPresenter(
      manque({ chronos: [{ personne: 'Julien', debut: `${MARDI}T16:00:00Z`, projetId: 'P01', phase: null, tacheId: null, activite: 'autre', commentaire: '', libelle: '' }] }),
      'Julien',
      `${MARDI}T18:00`,
    ),
    null,
    'un chrono qui TOURNE suspend la question : la journée n’est pas finie',
  )
  assert.equal(
    R.recapAPresenter(
      etat({ pointages: [pt({ debut: `${MARDI}T08:00:00Z`, minutes: 7 * 60 })], recapsJournee: [veilleTraitee] }),
      'Julien',
      `${MARDI}T18:00`,
    ),
    null,
    'journée complète ⇒ silence : un bandeau qui crie pour rien finit ignoré',
  )
  assert.equal(
    R.recapAPresenter(
      etat({ recapsJournee: [{ id: 'r2', personne: 'Julien', jour: VENDREDI, etat: 'complete', le: `${VENDREDI}T18:00:00Z` }] }),
      'Julien',
      `${SAMEDI}T18:00`,
    ),
    null,
    'un samedi n’a rien à récapituler (le vendredi, lui, était traité)',
  )
  assert.equal(R.recapAPresenter(etat(), '', `${MARDI}T18:00`), null, 'sans identité reconnue, à qui poser la question ?')

  // — le RATTRAPAGE : le vendredi manqué se présente le lundi matin
  assert.deepEqual(
    R.recapAPresenter(etat(), 'Julien', `${LUNDI_SUIVANT}T09:00`),
    { jour: VENDREDI, veille: true },
    'au premier chargement du lundi, le vendredi non récapitulé se rattrape — le samedi que personne n’ouvre ne compte pas',
  )
  assert.equal(
    R.recapAPresenter(
      etat({ recapsJournee: [{ id: 'r1', personne: 'Julien', jour: VENDREDI, etat: 'complete', le: `${VENDREDI}T18:00:00Z` }] }),
      'Julien',
      `${LUNDI_SUIVANT}T09:00`,
    ),
    null,
    'vendredi traité ⇒ lundi matin se tait, et on ne drague pas plus loin : le passé lointain n’est plus un récapitulatif',
  )
}

// ============================================================
// 5. La réponse s'écrit par un geste — et une seule par (personne, jour)
// ============================================================

{
  const r = R.marquerRecap('Julien', MARDI, 'ignore', `${MARDI}T18:00:00Z`)
  assert.equal(r.personne, 'Julien')
  assert.equal(r.jour, MARDI)
  assert.equal(r.etat, 'ignore')
  assert.ok(r.id.startsWith('rcp-'), 'identifiant préfixé, comme les autres collections du dépôt')
  assert.equal(
    R.recapDejaTraite(etat({ recapsJournee: [r] }), 'Julien', MARDI),
    true,
    'la réponse posée, la question est close pour ce jour',
  )
  assert.equal(R.recapDejaTraite(etat({ recapsJournee: [r] }), 'Zoé', MARDI), false, 'chacun répond pour soi')
}

// ============================================================
// 6. LA PORTE : l'écran rend la décision, écrit par geste, et l'état migre
// ============================================================

{
  const cockpit = lire('src/modules/Cockpit.tsx')
  assert.match(
    cockpit,
    /import \{ marquerRecap, projetsTouches, recapAPresenter, tempsNonEnregistre \} from '\.\.\/recapJournee'/,
    'le Cockpit IMPORTE la décision et l’estimateur — il ne les recalcule pas : un seul estimateur, deux formulations (§3.4)',
  )
  assert.match(cockpit, /<RecapFinJournee today=\{today\} \/>/, 'le bandeau est RENDU en pied du Cockpit — livré sans porte ne compte pas')
  assert.match(
    cockpit,
    /source: 'recap_fin_journee'/,
    'chaque ligne acceptée crée un pointage tracé `recap_fin_journee` — un pointage normal, daté, attribué',
  )
  assert.match(
    cockpit,
    /marquerRecap\(moi, jour, 'complete'/,
    '« Compléter » clôt la question du jour en plus d’écrire les pointages',
  )
  assert.match(cockpit, /marquerRecap\(moi, jour, 'ignore'/, '« Ignorer » clôt la question SANS rien écrire d’autre')
  assert.doesNotMatch(
    cockpit.slice(cockpit.indexOf('function RecapFinJournee'), cockpit.indexOf('export default function Cockpit')),
    /<Modal|window\.confirm/,
    'PAS de fenêtre modale pour le déclencheur : une journée finit souvent en fermant l’onglet, un bloqueur serait ignoré puis désactivé',
  )
  // le geste laisse un « Annuler » — patron du dépôt
  const bloc = cockpit.slice(cockpit.indexOf('function RecapFinJournee'), cockpit.indexOf('export default function Cockpit'))
  assert.equal(
    (bloc.match(/undo: \(\) => replace\(snap\)/g) || []).length,
    2,
    'Compléter ET Ignorer laissent chacun un « Annuler »',
  )

  const store = lire('src/store.tsx')
  assert.match(
    store,
    /etat\.recapsJournee = Array\.isArray\(parsed\.recapsJournee\) \? parsed\.recapsJournee : \[\]/,
    'migrate() : champ ajouté sans palier — un état antérieur n’a répondu à aucun récapitulatif, ce qui est la vérité',
  )

  const parametres = lire('src/modules/Parametres.tsx')
  assert.match(
    parametres,
    /heureRecap/,
    'l’heure du bandeau est PARAMÉTRABLE dans Paramètres — « à partir d’une heure paramétrable » (2.8)',
  )
  assert.match(
    parametres,
    /HEURE_RECAP_DEFAUT/,
    'le défaut affiché vient du module (HEURE_RECAP_DEFAUT) — un littéral local divergerait du vrai défaut',
  )
}

console.log(
  'Récapitulatif de fin de journée : un estimateur unique (capacité du jour moins pointages arrêtés, ' +
    'jamais négatif), une décision pure (jamais avant l’heure, jamais deux fois, chrono en cours suspend, ' +
    'vendredi rattrapé le lundi), un bandeau sans fenêtre modale, des pointages tracés recap_fin_journee ' +
    'écrits par geste seulement — et l’état migre.',
)
