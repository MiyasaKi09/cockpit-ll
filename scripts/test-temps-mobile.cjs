// M.2 — la saisie du temps sous 700 px, et l'unicité du total.
//
// Ce que M.2 livre tient en une phrase : la grille 6 semaines cède la place,
// au téléphone, à une fiche lisible. Le risque que ça introduit tient en une
// autre : DEUX vues qui affichent les mêmes heures.
//
// Deux chiffres différents pour la même semaine, sur une feuille de temps,
// ce n'est pas un défaut d'affichage — c'est la feuille entière qu'on cesse
// de croire, et le travail repart sur un tableur. Le test porte donc moins
// sur la mise en page que sur l'impossibilité de la divergence.
//
// Quatre choses tenues ici :
//
//   1. le total compte ce qui a été travaillé, y compris le temps rattaché
//      à un dossier de poursuite — l'exclure ferait disparaître du temps réel ;
//   2. le mot et la couleur du badge sortent du MÊME état, ce qui n'était pas
//      le cas avant ce livrable ;
//   3. l'écran pose bien les deux classes, et la CSS les échange vraiment ;
//   4. aucune vue ne recopie le verdict ni le total.

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

const T = charger('src/temps.ts')

// --- 1. ce que le total compte ----------------------------------------------

const source = {
  temps: [
    { id: 't1', semaine: '2026-08-03', personne: 'Julien', projetId: 'P01', phase: 'APD', heures: 12 },
    { id: 't2', semaine: '2026-08-03', personne: 'Julien', projetId: 'P07', phase: 'DET', heures: 18.5 },
    { id: 't3', semaine: '2026-08-03', personne: 'Zoé', projetId: 'P01', phase: 'APD', heures: 30 },
    { id: 't4', semaine: '2026-08-10', personne: 'Julien', projetId: 'P01', phase: 'APD', heures: 7 },
  ],
  tempsHorsProjet: [
    { id: 'h1', semaine: '2026-08-03', personne: 'Julien', categorie: 'Administratif', heures: 3 },
    // rattaché à un dossier de poursuite : il a bien été travaillé
    { id: 'h2', semaine: '2026-08-03', personne: 'Julien', categorie: 'Prospection / AO', heures: 1.5, consultationId: 'C9' },
  ],
}

{
  assert.equal(
    T.totalSemaine(source, 'Julien', '2026-08-03'),
    35,
    'projet + hors projet, dossier de poursuite COMPRIS : 12 + 18,5 + 3 + 1,5. ' +
      'Le filtre `consultationId` des cellules de saisie sert à ne pas les écraser, ' +
      'pas à les retirer du temps travaillé',
  )
  assert.equal(T.totalSemaine(source, 'Zoé', '2026-08-03'), 30, 'chaque personne son total')
  assert.equal(T.totalSemaine(source, 'Julien', '2026-01-05'), 0, 'une semaine sans rien vaut zéro, pas NaN')
  assert.equal(T.totalSemaine({ temps: [], tempsHorsProjet: [] }, 'Julien', '2026-08-03'), 0)
  assert.equal(T.totalSemaine({}, 'Julien', '2026-08-03'), 0, 'un état incomplet ne fait pas tomber l’écran')
}

// --- 2. le mot et la couleur sortent du même état ---------------------------
//
// AVANT ce livrable, l'écran portait deux règles concurrentes : la couleur
// tolérait un demi-écart des deux côtés, le mot ne le tolérait qu'au-dessus.
// Entre `theorique - 0,5` et `theorique`, la pastille était VERTE et portait
// le mot « incomplète ». C'est la contradiction que l'état unique referme.

{
  const th = 35
  assert.equal(T.etatSemaine(0, th), 'vide')
  assert.equal(T.etatSemaine(20, th), 'incomplete')
  assert.equal(T.etatSemaine(35, th), 'complete')
  assert.equal(T.etatSemaine(40, th), 'surcharge')

  assert.equal(
    T.etatSemaine(34.8, th),
    'complete',
    'la bande qui portait la contradiction : 34,8 h sur 35 n’est pas une semaine incomplète, ' +
      'c’est une semaine saisie à la demi-heure près — et la couleur le disait déjà',
  )
  assert.equal(T.etatSemaine(35.4, th), 'complete', 'symétrique : la tolérance vaut des deux côtés')
  assert.equal(T.etatSemaine(34.4, th), 'incomplete', 'au-delà de la tolérance, le mot revient')

  // Le point qui compte : plus aucun état ne peut porter un mot et une
  // couleur qui se contredisent, puisque les deux sortent de la même clé.
  for (const etat of ['vide', 'incomplete', 'complete', 'surcharge']) {
    assert.ok(T.LIBELLES_ETAT[etat], `${etat} a un mot`)
    assert.ok(T.TONS_ETAT[etat], `${etat} a une couleur`)
  }
  assert.equal(T.TONS_ETAT.complete, 'ok')
  assert.equal(T.TONS_ETAT.incomplete, 'warn')
  assert.equal(
    Object.keys(T.LIBELLES_ETAT).sort().join(','),
    Object.keys(T.TONS_ETAT).sort().join(','),
    'un état sans mot ou sans couleur rendrait une pastille vide',
  )
}

// --- le bilan et le détail ---------------------------------------------------

{
  const bilans = T.bilanSemaines(source, 'Julien', ['2026-08-03', '2026-08-10'], 35)
  assert.deepEqual(
    bilans.map((b) => [b.semaine, b.heures, b.etat]),
    [
      ['2026-08-03', 35, 'complete'],
      ['2026-08-10', 7, 'incomplete'],
    ],
    'une ligne par semaine, dans l’ordre reçu',
  )
  assert.deepEqual(T.bilanSemaines(source, 'Julien', [], 35), [], 'aucune semaine, aucune ligne')

  const projets = T.projetsDeLaSemaine(source, 'Julien', '2026-08-03')
  assert.deepEqual(
    projets,
    [
      { projetId: 'P07', heures: 18.5 },
      { projetId: 'P01', heures: 12 },
    ],
    'du plus chargé au moins chargé : c’est ce qu’on lit sur un téléphone',
  )
  assert.deepEqual(
    T.projetsDeLaSemaine(source, 'Julien', '2026-08-03').map((p) => p.projetId).length,
    2,
    'le hors projet ne crée pas de faux projet dans le détail',
  )
}

// --- 3. l'écran pose les deux classes, et la CSS les échange ----------------

{
  const ecran = lire('src/modules/Temps.tsx')
  assert.match(ecran, /className="temps-desktop"/, 'la grille est marquée « bureau »')
  assert.match(ecran, /className="temps-mobile"/, 'la fiche est marquée « téléphone »')

  const css = lire('src/styles.css')
  assert.match(css, /\.temps-mobile\s*\{\s*display:\s*none/, 'la fiche est cachée par défaut')

  // La feuille porte TROIS blocs « ≤ 700 px » ; le navigateur les applique
  // tous. Le test lit donc leur union, et non le premier trouvé — un test
  // qui n’en lirait qu’un échouerait sur une réorganisation de la feuille
  // qui n’a rien cassé.
  const blocs700 = [...css.matchAll(/@media \(max-width: 700px\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1])
  assert.ok(blocs700.length > 0, 'au moins un bloc 700 px existe')
  const sous700 = blocs700.join('\n')
  assert.match(sous700, /\.temps-mobile\s*\{\s*display:\s*block/, 'sous 700 px la fiche paraît')
  assert.match(sous700, /\.temps-desktop\s*\{\s*display:\s*none/, 'sous 700 px la grille disparaît')
  // Les deux règles vont par paire : n'en garder qu'une afficherait les deux
  // vues en même temps, donc les mêmes heures deux fois sur le même écran.
}

// --- 4. aucune vue ne recopie le total ni le verdict ------------------------

{
  const ecran = lire('src/modules/Temps.tsx')

  assert.ok(
    (ecran.match(/totalSemaine\(/g) || []).length >= 2,
    'les deux vues passent par la fonction partagée — grille ET saisie de la semaine',
  )
  assert.match(ecran, /bilanSemaines\(/, 'la fiche mobile lit le bilan partagé')

  // Les mots du badge n'ont qu'une source. S'ils réapparaissent en dur dans
  // l'écran, c'est qu'un second verdict a été écrit à côté du premier — et
  // c'est exactement ce qui a produit la pastille verte « incomplète ».
  for (const mot of ['incomplète', 'surcharge', 'à saisir']) {
    assert.ok(
      !ecran.includes(`'${mot}'`) && !ecran.includes(`>${mot}<`),
      `« ${mot} » est écrit en dur dans Temps.tsx : le verdict se lit dans LIBELLES_ETAT, pas deux fois`,
    )
    assert.ok(lire('src/temps.ts').includes(mot), `« ${mot} » doit vivre dans src/temps.ts`)
  }

  // Le module reste pur : il ne lit ni le magasin ni le navigateur.
  const module = lire('src/temps.ts')
  assert.doesNotMatch(module, /useStore|localStorage|window\.|fetch\(/, 'src/temps.ts est calculable en test')
}

console.log(
  'Temps au téléphone : un seul calcul de total pour les deux vues (dossiers de poursuite compris), ' +
    'mot et couleur du badge issus du même état — la pastille verte « incomplète » ne peut plus revenir —, ' +
    'et l’échange bureau/téléphone vérifié des deux côtés, écran et CSS.',
)
