// 5.4 — révision de prix des marchés : la formule du CCAP, calculée au lieu
// d'être refaite à la calculette chaque mois.
//
// Un coefficient de révision faux ne se voit pas : 1,085 et 1,058 se
// ressemblent, et l'écart part dans un certificat de paiement. C'est pour ça
// que la formule est vérifiée ici CONTRE DES CAS FAITS À LA MAIN, et que
// toute la logique est pure — le mois est un argument, jamais une horloge.
//
// Cinq garanties tenues :
//
//   1. la formule « partFixe + (1 − partFixe) × In/I0 », chiffres posés à la
//      main, partie fixe paramétrable — et l'arrondi au dix-millième ;
//   2. indice du mois absent ⇒ le DERNIER publié au plus tard ce mois-là
//      sert, et le calcul LE DIT (`approximatif: true`) — jamais en silence,
//      et jamais un indice postérieur au mois demandé ;
//   3. marché non révisable, série ou mois zéro absents, I0 non saisi ⇒
//      null, pas 0 — un « 0 € de révision » affirmerait qu'une vérification
//      a eu lieu ;
//   4. les codes de série se rapprochent sans casse ni espaces, et une
//      double saisie d'un même mois se résout par la dernière (correction) ;
//   5. la collection `indicesBTP` est normalisée au chargement, amorcée
//      vide dans le seed, saisie en Paramètres via `Table`, et les champs
//      du marché s'éditent là où vivent les marchés.

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

const R = charger('src/revisionPrix.ts')

// --- 1. la formule, chiffres posés à la main --------------------------------

{
  // I0 = 110, In = 121 : In/I0 = 1,1 ; 0,15 + 0,85 × 1,1 = 0,15 + 0,935 = 1,085
  assert.equal(R.coefficientRevision(0.15, 110, 121), 1.085, 'le cas de référence du plan (Lot 5.4)')
  // partie fixe paramétrable : 0,125 + 0,875 × 1,1 = 0,125 + 0,9625 = 1,0875
  assert.equal(R.coefficientRevision(0.125, 100, 110), 1.0875, 'la partie fixe vient du CCAP, pas d’une constante')
  // la révision joue aussi à la baisse : 0,15 + 0,85 × 104,5/110 = 0,9575
  assert.equal(R.coefficientRevision(0.15, 110, 104.5), 0.9575, 'un indice qui baisse révise en moins')
  // 0,15 + 0,85 × 1/3 = 0,43333… : sans arrondi au dix-millième, le bruit
  // flottant s'afficherait tel quel sur un certificat de paiement
  assert.equal(R.coefficientRevision(0.15, 3, 1), 0.4333, 'arrondi au dix-millième — l’usage des CCAP')

  assert.equal(R.coefficientRevision(0.15, 0, 121), null, 'I0 nul : diviser fabriquerait Infinity')
  assert.equal(R.coefficientRevision(0.15, -110, 121), null, 'un indice négatif n’est pas un indice')
  assert.equal(R.coefficientRevision(0.15, 110, NaN), null, 'NaN ne traverse pas la formule')

  assert.equal(R.PART_FIXE_DEFAUT, 0.15, 'le défaut annoncé partout (types, écran) est bien 0,15')
}

// --- le jeu d'indices des cas suivants --------------------------------------

const INDICES = [
  { id: 'i1', indice: 'BT01', mois: '2025-10', valeur: 110 },
  { id: 'i2', indice: 'BT01', mois: '2026-01', valeur: 115.5 },
  // saisi en minuscules EXPRÈS : le rapprochement doit ignorer la casse
  { id: 'i3', indice: 'bt01', mois: '2026-03', valeur: 121 },
  // une autre série, même mois : elle ne doit jamais contaminer BT01
  { id: 'i4', indice: 'TP08', mois: '2026-03', valeur: 300 },
]
const MARCHE = { revision: true, indiceRevision: 'BT01', moisZero: '2025-10' }

// --- 2. mois publié, mois absent : le calcul dit ce qu'il a fait ------------

{
  const exact = R.revisionTheorique(MARCHE, INDICES, '2026-03', 100000)
  assert.ok(exact, 'marché paramétré + série alimentée : le théorique se calcule')
  assert.equal(exact.coefficient, 1.085, 'In = 121 (mars, saisi « bt01 »), I0 = 110 : 0,15 + 0,85 × 1,1')
  assert.equal(exact.montant, 8500, 'la révision est le SUPPLÉMENT : 100 000 × (1,085 − 1)')
  assert.equal(exact.approximatif, false, 'l’indice du mois demandé existe : rien d’approximatif')
  assert.deepEqual(exact.indiceUtilise, { mois: '2026-03', valeur: 121 })

  // juin demandé, dernier publié : mars — l'approximation est DITE, avec le
  // mois qui a réellement servi, pour que l'écran puisse l'afficher
  const approx = R.revisionTheorique(MARCHE, INDICES, '2026-06', 100000)
  assert.ok(approx, 'l’INSEE publie à ~3 mois : le calcul ne doit pas attendre la publication')
  assert.equal(approx.approximatif, true, 'indice du mois absent ⇒ le calcul LE DIT — jamais en silence')
  assert.equal(approx.indiceUtilise.mois, '2026-03', 'le dernier indice publié a servi, et on sait lequel')
  assert.equal(approx.coefficient, 1.085)

  // février demandé : janvier sert (115,5), PAS mars — réviser un mois avec
  // un indice postérieur, ce serait antidater une hausse
  const fevrier = R.revisionTheorique(MARCHE, INDICES, '2026-02', 100000)
  assert.equal(fevrier.indiceUtilise.mois, '2026-01', 'jamais un indice postérieur au mois demandé')
  assert.equal(fevrier.coefficient, 1.0425, '0,15 + 0,85 × 115,5/110')
  assert.equal(fevrier.montant, 4250)
  assert.equal(fevrier.approximatif, true)
}

// --- 3. quand rien ne peut se calculer, c'est null — pas 0 ------------------

{
  assert.equal(
    R.revisionTheorique({ ...MARCHE, revision: false }, INDICES, '2026-03', 100000),
    null,
    'marché non révisable ⇒ null : il n’y a RIEN à vérifier, pas « 0 € »',
  )
  assert.equal(
    R.revisionTheorique({ revision: true, moisZero: '2025-10' }, INDICES, '2026-03', 100000),
    null,
    'sans série au marché, aucun In possible',
  )
  assert.equal(
    R.revisionTheorique({ revision: true, indiceRevision: 'BT01' }, INDICES, '2026-03', 100000),
    null,
    'sans mois zéro, aucun I0 possible',
  )
  assert.equal(
    R.revisionTheorique({ ...MARCHE, moisZero: '2025-09' }, INDICES, '2026-03', 100000),
    null,
    'I0 est CONTRACTUEL : le mois zéro non saisi dans la série ne s’approxime pas',
  )
  assert.equal(
    R.revisionTheorique(MARCHE, [], '2026-03', 100000),
    null,
    'série vide : rien ne se calcule — et l’écran Paramètres le dit',
  )
  assert.equal(
    R.revisionTheorique(MARCHE, INDICES, '2025-09', 100000),
    null,
    'aucun indice publié au plus tard le mois demandé ⇒ null, pas le premier venu',
  )
}

// --- la partie fixe du marché : paramétrable, mais pas n'importe quoi -------

{
  const surMesure = R.revisionTheorique({ ...MARCHE, partFixe: 0.125 }, INDICES, '2026-03', 100000)
  assert.equal(surMesure.coefficient, 1.0875, 'la partie fixe du marché prime sur le défaut')
  assert.equal(surMesure.montant, 8750)

  const defaut = R.revisionTheorique({ ...MARCHE, partFixe: undefined }, INDICES, '2026-03', 100000)
  assert.equal(defaut.coefficient, 1.085, 'partie fixe absente ⇒ le défaut 0,15 s’applique')

  assert.equal(
    R.revisionTheorique({ ...MARCHE, partFixe: 15 }, INDICES, '2026-03', 100000),
    null,
    '15 saisi au lieu de 0,15 : calculer donnerait un montant absurde, retomber sur le défaut cacherait l’erreur — null',
  )
}

// --- 4. rapprochement des séries et double saisie ---------------------------

{
  assert.equal(R.cleSerie(' bt 01 '), 'BT01', 'casse et espaces ignorés : le CCAP et la saisie se rejoignent')

  // ressaisir un mois est une correction : la DERNIÈRE valeur l'emporte,
  // sinon « le dernier indice connu » serait ambigu
  const corriges = [...INDICES, { id: 'i5', indice: 'BT01', mois: '2026-03', valeur: 132 }]
  const r = R.revisionTheorique(MARCHE, corriges, '2026-03', 100000)
  assert.equal(r.indiceUtilise.valeur, 132, 'la correction remplace la première saisie')
  assert.equal(r.coefficient, 1.17, '0,15 + 0,85 × 1,2')

  // TP08 (300 en mars) n'a jamais servi dans les cas BT01 ci-dessus : si une
  // série contaminait l'autre, les coefficients auraient explosé — mais on le
  // vérifie aussi de face
  const tp = R.revisionTheorique({ revision: true, indiceRevision: 'TP08', moisZero: '2026-03' }, INDICES, '2026-03', 1000)
  assert.equal(tp.coefficient, 1, 'chaque marché lit SA série, au mois près')
}

// --- 5. le câblage dans l'application ---------------------------------------

{
  // logique PURE (règle du dépôt) : pas de store, pas d'horloge, pas de réseau
  const src = lire('src/revisionPrix.ts')
  assert.doesNotMatch(
    src,
    /useStore|localStorage|fetch\(|Date\.now|new Date\(/,
    'revisionPrix.ts doit rester pur : le mois est un ARGUMENT, jamais une horloge lue au fond du calcul',
  )

  // normalisation au chargement, sur le modèle des autres collections : sans
  // elle, un état d'avant le Lot 5 ferait planter le premier .filter()
  assert.match(
    lire('src/store.tsx'),
    /etat\.indicesBTP = Array\.isArray\(parsed\.indicesBTP\) \? parsed\.indicesBTP : \[\]/,
    'indicesBTP doit être normalisée dans migrate() comme chronos/pointages',
  )
  assert.match(lire('src/seed.ts'), /indicesBTP: \[\]/, 'le seed amorce la collection — VIDE : une valeur inventée ressemblerait à une vraie publication INSEE')

  // l'écran de saisie vit en Paramètres (référentiel national) et passe par
  // `Table` — test-tableaux interdit de toute façon un <table> brut
  const parametres = lire('src/modules/Parametres.tsx')
  assert.match(parametres, /CarteIndicesBTP/, 'la carte de saisie des indices doit exister en Paramètres')
  assert.match(parametres, /d\.indicesBTP\.push/, 'la saisie écrit dans la collection normalisée')

  // les champs du marché s'éditent là où vivent les marchés
  const chantier = lire('src/modules/ProjetChantier.tsx')
  for (const champ of ['indiceRevision', 'moisZero', 'partFixe']) {
    assert.match(chantier, new RegExp(champ), `le modal du marché doit exposer « ${champ} »`)
  }
}

console.log(
  'Révision de prix : formule du CCAP vérifiée à la main (partie fixe paramétrable, arrondi au dix-millième), ' +
    'indice manquant ⇒ dernier publié ET approximatif dit, non révisable ou non paramétré ⇒ null jamais 0, ' +
    'séries rapprochées sans casse, saisie en Paramètres via Table et champs du marché dans le modal.',
)
