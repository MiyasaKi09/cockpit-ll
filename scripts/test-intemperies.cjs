// 5.3 — registre des intempéries : les jours qui excusent et qui prolongent.
//
// Un jour d'intempérie mal compté se paie deux fois : une pénalité réclamée
// à tort (le retard était excusé) ou un délai prolongé à tort (le décompte
// général devient contestable). Et l'erreur est silencieuse — pluie et vent
// le même jour comptés deux, un samedi déduit d'un délai en jours ouvrés :
// des chiffres plausibles, faux. D'où les quatre garanties tenues ici :
//
//   1. jours OUVRÉS DISTINCTS : deux natures le même jour font UN jour,
//      samedi et dimanche ne comptent jamais, bornes incluses ;
//   2. chaque chantier lit SON registre, et une date illisible est écartée
//      plutôt que comptée ;
//   3. la prolongation du délai d'un marché se calcule sur SA fenêtre
//      d'intervention — et c'est le MÊME chiffre que la déduction des
//      retards lit (`penaliteEncourue`), visible dans le montant ;
//   4. le calcul du jour ouvré ne lit AUCUNE horloge : la date est un
//      argument, le résultat est le même sur les deux postes de l'agence.

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

const P = charger('src/penalites.ts')

// --- 4. le jour ouvré, sans horloge -----------------------------------------

{
  // la semaine du 6 juillet 2026 : lundi 6 … vendredi 10, samedi 11, dimanche 12
  assert.equal(P.estJourOuvre('2026-07-06'), true, 'lundi')
  assert.equal(P.estJourOuvre('2026-07-10'), true, 'vendredi')
  assert.equal(P.estJourOuvre('2026-07-11'), false, 'samedi')
  assert.equal(P.estJourOuvre('2026-07-12'), false, 'dimanche')
  assert.equal(P.estJourOuvre('n’importe quoi'), false, 'une date illisible n’est pas un jour ouvré')
  assert.equal(P.estJourOuvre(''), false)
}

// --- le registre des cas suivants -------------------------------------------

const REGISTRE = [
  // pluie ET vent le lundi 6 : le chantier n'est arrêté qu'UNE fois
  { id: 'i1', projetId: 'P03', date: '2026-07-06', nature: 'pluie', commentaire: '' },
  { id: 'i2', projetId: 'P03', date: '2026-07-06', nature: 'vent', commentaire: '' },
  { id: 'i3', projetId: 'P03', date: '2026-07-07', nature: 'neige', commentaire: '' },
  // samedi 11 : consigné (le constat est vrai) mais jamais compté
  { id: 'i4', projetId: 'P03', date: '2026-07-11', nature: 'pluie', commentaire: '' },
  // un AUTRE chantier le même jour : il ne contamine pas P03
  { id: 'i5', projetId: 'P01', date: '2026-07-07', nature: 'gel', commentaire: '' },
  // une date illisible (import JSON) : écartée, pas comptée
  { id: 'i6', projetId: 'P03', date: 'juillet', nature: 'pluie', commentaire: '' },
]

// --- 1 + 2. jours ouvrés distincts, par chantier ----------------------------

{
  assert.equal(
    P.joursIntemperies(REGISTRE, 'P03', '2026-07-01', '2026-07-31'),
    2,
    'lundi 6 (pluie + vent = UN jour) + mardi 7 — le samedi 11 ne compte pas',
  )
  assert.equal(
    P.joursIntemperies(REGISTRE, 'P01', '2026-07-01', '2026-07-31'),
    1,
    'chaque chantier lit SON registre',
  )
  assert.equal(
    P.joursIntemperies(REGISTRE, 'P03', '2026-07-07', '2026-07-31'),
    1,
    'borne de début incluse : le lundi 6 sort, le mardi 7 reste',
  )
  assert.equal(
    P.joursIntemperies(REGISTRE, 'P03', '2026-07-01', '2026-07-06'),
    1,
    'borne de fin incluse',
  )
  assert.equal(
    P.joursIntemperies(REGISTRE, 'P03', null, null),
    2,
    'bornes null = période ouverte : tout le registre du chantier',
  )
  assert.equal(P.joursIntemperies(REGISTRE, '', null, null), 0, 'sans chantier, rien — pas le registre du premier venu')
  assert.equal(P.joursIntemperies(null, 'P03', null, null), 0, 'un état incomplet ne fait pas tomber l’écran')
}

// --- 3. la prolongation lit la fenêtre du marché ----------------------------

{
  const marche = { projetId: 'P03', dateDebut: '2026-07-01', dateFin: '2026-07-31' }
  assert.equal(P.prolongationDelai(marche, REGISTRE), 2, 'la fenêtre d’intervention borne le décompte')
  assert.equal(
    P.prolongationDelai({ projetId: 'P03', dateDebut: '2026-07-07', dateFin: null }, REGISTRE),
    1,
    'fin absente : la fenêtre reste ouverte à droite',
  )
  assert.equal(
    P.prolongationDelai({ projetId: 'P02', dateDebut: null, dateFin: null }, REGISTRE),
    0,
    'un chantier sans intempéries ne se prolonge pas',
  )

  // le lien avec 5.2, de bout en bout : le MÊME chiffre excuse le retard.
  // 10 jours de retard à 200 €/j, 2 jours ouvrés d'intempéries sur la
  // fenêtre → (10 − 2) × 200 = 1 600 €, et la déduction est DITE.
  const excuse = P.penaliteEncourue(
    { type: 'retard_execution', jours: 10 },
    { retardParJourHT: 200 },
    P.prolongationDelai(marche, REGISTRE),
  )
  assert.equal(excuse.montantHT, 1600, 'la déduction traverse jusqu’au montant : (10 − 2) × 200')
  assert.equal(excuse.joursDeduits, 2, 'et elle se lit — l’écran affiche « 10 − 2 = 8 j »')
  assert.equal(excuse.joursRetenus, 8)
}

// --- le câblage dans l'application ------------------------------------------

{
  // pureté : le jour ouvré se calcule sur la date ARGUMENT, jamais sur
  // l'horloge ou le fuseau du poste
  const src = lire('src/penalites.ts')
  assert.doesNotMatch(
    src,
    /useStore|localStorage|fetch\(|Date\.now|new Date\(/,
    'penalites.ts doit rester pur — pas d’horloge, pas de fuseau : un samedi doit rester un samedi sur les deux postes',
  )

  assert.match(
    lire('src/store.tsx'),
    /etat\.intemperies = Array\.isArray\(parsed\.intemperies\) \? parsed\.intemperies : \[\]/,
    'intemperies doit être normalisée dans migrate() comme chronos/pointages',
  )
  assert.match(
    lire('src/seed.ts'),
    /intemperies: \[\]/,
    'le seed amorce la collection — VIDE : un jour inventé prolongerait un délai contractuel réel',
  )

  // l'écran : saisie simple dans le bloc chantier, et l'effet affiché LÀ où
  // il agit — prolongation sur la carte, déduction dans le journal 5.2
  const chantier = lire('src/modules/ProjetChantier.tsx')
  assert.match(chantier, /CarteIntemperies/, 'la carte de saisie doit exister dans l’onglet Chantier')
  assert.match(chantier, /<CarteIntemperies projet=\{projet\} \/>/, 'et être MONTÉE — un registre jamais rendu ne consigne rien')
  assert.match(chantier, /prolongationDelai\(/, 'la prolongation du délai s’affiche là où elle agit')
  // chaque branchement se vérifie SÉPARÉMENT : débrancher la déduction des
  // lignes en laissant celle du total passerait un simple /deductionDe/
  assert.match(
    chantier,
    /penaliteEncourue\(e, m\?\.penalites, deductionDe\(m\)\)/,
    'chaque ligne du journal déduit les jours du marché — pas un 0 ni une constante',
  )
  assert.match(
    chantier,
    /totalEncouruMarche\(evenements, m\.id, m\.penalites, deductionDe\(m\)\)/,
    'le total par marché déduit le MÊME chiffre que les lignes',
  )
  assert.match(
    chantier,
    /joursDeduits/,
    'la déduction se LIT dans le journal (« 10 − 2 = 8 j »), pas seulement dans le montant',
  )
  assert.match(chantier, /estJourOuvre/, 'un jour non ouvré consigné est marqué « non compté » à l’écran')
}

console.log(
  'Intempéries : jours ouvrés distincts (deux natures le même jour = un jour, week-end jamais compté, ' +
    'bornes incluses), chaque chantier lit son registre, prolongation calculée sur la fenêtre du marché ' +
    'et MÊME chiffre déduit des retards de 5.2 jusque dans le montant — collection normalisée, amorcée ' +
    'vide, saisie et effets affichés dans l’onglet Chantier.',
)
