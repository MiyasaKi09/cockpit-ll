// Refonte de la navigation, contrôles n°1 et n°2 (docs/REFONTE_NAVIGATION.md §6).
//
// LE DÉFAUT QUE CE TEST FERME N'EST PAS UN BOGUE : C'EST UNE DÉRIVE.
// --------------------------------------------------------------------------
// L'agence, le 07/08/2026 : « c'est super compliqué, y a plein de clics pour
// faire plein de choses, rien n'est vraiment homogène. On se perd dans le
// site. » Elle a raison, et le décompte le dit : soixante-deux endroits
// recensés à la main pour DEUX personnes.
//
// On n'y est pas arrivé par négligence. Environ cent cinquante corrections ont
// été livrées, chacune raccourcissant un parcours, chacune ajoutant une carte,
// un onglet ou une alerte. La consigne « simplifier, pas complexifier » figurait
// dans chaque prompt et dans chaque message de commit. Elle n'a servi à rien,
// pour une seule raison : LA SURFACE N'ÉTAIT MESURÉE NULLE PART. On ne corrige
// que ce qu'on mesure ; un parcours plus court dans un outil plus vaste est un
// gain local payé par une perte globale, et la perte globale ne figurait sur
// aucun tableau de bord.
//
// Ce fichier est ce tableau de bord. Il ne juge pas la qualité d'un écran : il
// COMPTE, et il refuse que le compte monte.
//
// DESCENDRE LE PLAFOND APRÈS CHAQUE TRANCHE, C'EST LE TRAVAIL.
// --------------------------------------------------------------------------
// Ce n'est pas l'entretien du test, c'est la livraison. Une tranche qui retire
// sept endroits et laisse le plafond à soixante-quinze n'a rien rendu
// irréversible : elle a fait de la place. Les sept endroits regagneront cette
// place en six mois, un par correction raisonnable, et le tableau de bord
// restera vert du début à la fin — c'est mot pour mot l'histoire des cent
// cinquante corrections qui ont produit les soixante-quinze.
//
// La règle est donc : la tranche n'est finie que quand le plafond vaut le
// nouveau constat, AU CHIFFRE PRÈS. Pas arrondi vers le haut « pour se laisser
// une marge » — un plafond avec du mou n'est pas un plafond, c'est un endroit
// déjà accordé à celui qui viendra.
//
// LES CONSTATS SONT DONC UNE SUITE, PAS QUATRE NOMBRES MODIFIABLES.
// --------------------------------------------------------------------------
// Les plafonds en vigueur sont LUS dans la dernière ligne de l'historique
// ci-dessous, et l'historique est vérifié : les comptes qu'une refonte doit
// faire baisser ne peuvent pas remonter d'une ligne à la suivante.
//
// Pourquoi cette forme plutôt que quatre `const` : un nombre seul se relève en
// un caractère, et le diff est illisible (« 68 → 75 » ressemble à un
// ajustement). Une LIGNE d'historique, il faut l'écrire, la dater, la nommer et
// dire ce qu'elle apporte — et si elle remonte un compte, le contrôle de
// monotonie la refuse et nomme la ligne précédente. Relever un plafond reste
// possible : c'est une décision, elle s'écrit, et elle se voit.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')

// ==========================================================================
// L'HISTORIQUE DES CONSTATS — la dernière ligne fait les plafonds
// ==========================================================================

const CONSTATS = [
  {
    quand: '08/08/2026',
    tranche: 'tranches 1 et 2 — la semaine devient vraie, le menu se replie',
    // 16 + 59. Replier ne retire pas du COMPTE (§3.3) : la tranche 2 n'a fait
    // bouger que `visibles`, de seize à cinq.
    destinations: 16,
    visibles: 5,
    endroits: 75,
    ecransAOnglets: 14,
    // 183 et non 182 : la tranche 1 a monté `CarteLaSemaine` au Cockpit le
    // jour même où deux blocs y passaient sous un `<details>`. Ce compteur
    // voit la carte qui arrive, pas le pli qui se ferme (dit plus bas).
    cartes: 183,
    apporte: 'la mesure elle-même : avant ce fichier, la surface n’était comptée nulle part.',
  },
  {
    quand: '08/08/2026',
    tranche: 'tranche 3 — Situations devient une vue d’Entreprises, le registre rejoint le projet',
    // −2 destinations : « Situations » et « Documents » quittent `NAV`. Ce ne
    // sont pas deux entrées repliées de plus — les deux lignes ne sont plus
    // dans le tableau. Leurs ROUTES, elles, répondent toujours : c'est
    // scripts/test-navigation-repliee.cjs qui le tient.
    destinations: 14,
    visibles: 5,
    // −7 endroits : les 2 destinations, les 4 onglets de Situations
    // (« À vérifier · Attendues · Historique · Retenues de garantie ») et
    // l'onglet « Tous les documents ». 54 onglets sur 13 écrans.
    endroits: 68,
    // Situations.tsx n'a plus d'export par défaut : il n'est plus un écran,
    // il est le module des vues de situation. Un écran à onglets en moins.
    ecransAOnglets: 13,
    // −1 : `CarteRegistreProjet` (ProjetDocuments.tsx) était un SECOND
    // registre — même table, sans recherche, sans filtre, sans « Ouvrir »,
    // sans fiche. Deux réponses possibles à « qu'a-t-on reçu sur ce
    // chantier » : il n'en reste qu'une, et c'est celle qui a les gestes.
    cartes: 182,
    apporte:
      'la première baisse de DETTE : des endroits qui cessent d’exister, pas seulement d’être vus. ' +
      'Aucun écran, aucun onglet, aucune carte ajoutés en échange — les quatre vues de situation ' +
      'sont montées en repli, et un repli n’est pas un endroit.',
  },
]

// Un historique dont la lecture serait cassée rendrait des plafonds `undefined`,
// et `x <= undefined` est faux : le test échouerait, mais en accusant l'écran.
assert.ok(CONSTATS.length >= 2, 'CONSTATS doit garder au moins le constat d’origine et le constat en vigueur')
for (const c of CONSTATS) {
  for (const cle of ['destinations', 'visibles', 'endroits', 'ecransAOnglets', 'cartes']) {
    assert.equal(
      typeof c[cle],
      'number',
      `CONSTATS[« ${c.tranche} »].${cle} n’est pas un nombre : les plafonds seraient \`undefined\`.`,
    )
  }
  assert.ok(c.apporte, `le constat « ${c.tranche} » ne dit pas ce qu’il apporte : un chiffre sans raison se relève sans raison.`)
}

// LE CONTRÔLE QUI REND LA BAISSE IRRÉVERSIBLE. Trois des cinq comptes ne
// peuvent que descendre : ce sont ceux que la refonte existe pour faire
// descendre. `cartes` en est exclu, et il faut le dire au lieu de le taire —
// la tranche 1 en a monté une (`CarteLaSemaine`) en repliant deux blocs le
// même jour, donc l'exception est réelle ; `ecransAOnglets` en est exclu aussi,
// c'est un plancher de lecture (« le compteur voit-il encore quelque chose »),
// pas un compte de surface.
for (let i = 1; i < CONSTATS.length; i++) {
  const avant = CONSTATS[i - 1]
  const apres = CONSTATS[i]
  for (const [cle, quoi] of [
    ['destinations', 'les destinations déclarées au menu'],
    ['visibles', 'les entrées de menu visibles sans rien déplier'],
    ['endroits', 'les endroits mesurés — LA mesure de succès de la refonte'],
  ]) {
    assert.ok(
      apres[cle] <= avant[cle],
      `CONSTATS remonte ${quoi} : ${avant[cle]} (« ${avant.tranche} ») → ${apres[cle]} (« ${apres.tranche} »).\n\n` +
        'C’EST LA SEULE MESURE DE SUCCÈS DE LA REFONTE, ET ELLE NE MONTE PAS. Descendre le plafond après\n' +
        'chaque tranche est le travail ; le remonter est l’annuler. Si l’endroit neuf est vraiment\n' +
        'irremplaçable, il faut le dire ici en clair — ce que l’endroit porte que l’existant ne pouvait pas\n' +
        'porter, et quel endroit il remplace — et assumer que la ligne restera dans l’historique.\n' +
        '« Il fallait bien le mettre quelque part » est le raisonnement qui a produit les soixante-quinze.',
    )
  }
}

const EN_VIGUEUR = CONSTATS[CONSTATS.length - 1]

/** destinations du menu (`NAV`, src/App.tsx) + jeux d'onglets (`<Tabs`).
 *  Constat en vigueur : 14 + 54. La tranche 4 ramènera la fiche projet de 9 à
 *  4 moments, et cette ligne redescendra encore. */
const PLAFOND_ENDROITS = EN_VIGUEUR.endroits

/** les destinations à elles seules. Sous-plafond volontaire : sans lui, on
 *  pourrait ajouter une DESTINATION (le plus coûteux des endroits — elle
 *  s'impose à l'œil en permanence) en retirant un onglet ailleurs, et le
 *  total ne bougerait pas. */
const PLAFOND_DESTINATIONS = EN_VIGUEUR.destinations

/** LES ENTRÉES DE MENU QU'ON VOIT SANS RIEN DÉPLIER.
 *
 *  Le §3.3 du plan a dû introduire cette distinction, et elle n'est pas
 *  cosmétique : « replier retire de la VUE, pas du COMPTE ». La tranche 2 met
 *  onze des seize entrées dans un groupe « Agence » fermé. Le compte total ne
 *  bouge pas d'une ligne — la route existe, le code aussi, et c'est voulu
 *  puisqu'on ne supprime rien — mais ce que l'agence VOIT en permanence passe
 *  de seize à cinq. C'est de ce chiffre-là qu'elle se plaint (« on se perd
 *  dans le site »), et il n'était mesuré nulle part.
 *
 *  Sans ce second plafond, la tranche 2 serait intégralement réversible en
 *  silence : il suffirait de retirer `repliable: true` d'un groupe, ou de
 *  remonter trois entrées dans le groupe visible, pour que le menu regrimpe
 *  sans qu'aucun test ne bronche — PLAFOND_DESTINATIONS, lui, resterait tenu.
 *  C'est exactement la forme de rechute que ce fichier existe pour empêcher.
 *
 *  Le contrôle jumeau vit dans scripts/test-navigation-repliee.cjs : celui-ci
 *  compte ce qui disparaît de la vue, celui-là vérifie que ce qui disparaît
 *  reste trouvable. L'un sans l'autre serait nuisible. */
const PLAFOND_DESTINATIONS_VISIBLES = EN_VIGUEUR.visibles

/** Les deux ancres du §2, nommées par leur adresse : elles ne peuvent PAS être
 *  repliées. Un plafond de visibles se tient aussi en repliant tout — un menu
 *  vide passe n'importe quel plafond, et ce serait la pire des simplifications.
 *  Ces deux-là sont le plancher, et il est nommé plutôt que chiffré : « au
 *  moins deux entrées » n'aurait pas dit LESQUELLES. */
const ANCRES_TOUJOURS_VISIBLES = { '': 'La semaine', projets: 'Projets' }

/** cartes montées dans UN fichier d'écran. Le détenteur est nommé plus bas
 *  et vérifié : c'est celui qui débordera en premier. */
const PLAFOND_CARTES_PAR_ECRAN = 12

/** toutes les cartes de src/, tous écrans confondus. Un plafond par écran
 *  seul laisse passer la croissance étalée : douze écrans qui prennent une
 *  carte chacun ne déclenchent rien et font pourtant douze cartes de plus.
 *
 *  182 depuis la tranche 3, qui a retiré `CarteRegistreProjet` — un second
 *  registre du même chantier, sans recherche, sans filtre, sans « Ouvrir » et
 *  sans fiche. Ce n'est pas une carte repliée : elle n'existe plus, et LA
 *  carte du registre (`CarteTous`) est montée à sa place, avec tous ses
 *  gestes. On revient donc au 182 de l'inventaire du plan (compté contre
 *  `f8f5677`) après le 183 de la tranche 1, qui avait monté `CarteLaSemaine`
 *  au Cockpit — le même jour où la météo financière et le tableau
 *  heures/charge/capacité y passaient sous deux `<details>` « Voir plus ».
 *  C'est le sur-comptage annoncé plus bas : ce compteur voit la carte qui
 *  arrive, pas le pli qui se ferme. Le constat est écrit tel quel plutôt
 *  qu'arrondi vers le haut — un plafond avec du mou n'est pas un plafond. */
const PLAFOND_CARTES_TOTAL = EN_VIGUEUR.cartes

/** l'écran qui détient le maximum de cartes. Vérifié, pas seulement écrit :
 *  le jour où un autre le dépasse, c'est LUI qu'il faut regarder, et un nom
 *  périmé dans un message d'erreur envoie chercher au mauvais endroit. */
const DETENTEUR_CARTES = 'src/modules/Projets.tsx'

// ==========================================================================
// Outillage — le compilateur, jamais une expression régulière
// ==========================================================================
//
// `<Tabs` et `<Card` apparaissent aussi dans les commentaires de ce dépôt (le
// présent fichier en est plein) et dans des chaînes. Une expression régulière
// les compterait ; un `JsxOpeningElement` est un élément réellement monté, et
// rien d'autre. Même raison que pour test-tableaux.cjs.

const arbres = new Map()
function arbre(rel) {
  if (!arbres.has(rel)) {
    arbres.set(
      rel,
      ts.createSourceFile(
        rel,
        fs.readFileSync(path.join(racine, rel), 'utf8'),
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.TSX,
      ),
    )
  }
  return arbres.get(rel)
}

function fichiersTsx(dossier) {
  const trouves = []
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, entree.name)
    if (entree.isDirectory()) trouves.push(...fichiersTsx(complet))
    else if (entree.name.endsWith('.tsx')) trouves.push(path.relative(racine, complet))
  }
  return trouves.sort()
}

const FICHIERS = fichiersTsx(path.join(racine, 'src'))
const ligneDe = (sf, noeud) => sf.getLineAndCharacterOfPosition(noeud.getStart(sf)).line + 1

/** tous les éléments JSX d'un nom donné, montés à l'écran */
function elements(rel, nom) {
  const sf = arbre(rel)
  const trouves = []
  const visiter = (n) => {
    const ouvrant = ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)
    if (ouvrant && n.tagName.getText(sf) === nom) trouves.push(n)
    ts.forEachChild(n, visiter)
  }
  visiter(sf)
  return trouves
}

// ==========================================================================
// CONTRÔLE N°1 — le plafond d'endroits
// ==========================================================================

// --- 1a. les destinations du menu ------------------------------------------
//
// UNE seule lecture de `NAV` pour les DEUX comptes. La tentation était d'en
// écrire une seconde, plus simple, pour le compte des visibles ; deux lectures
// du même tableau sont deux autorités libres de diverger, et c'est justement
// entre ces deux chiffres que le plan demande de faire la différence.

function groupesDeNav() {
  const sf = arbre('src/App.tsx')
  const groupes = []
  const litteral = (noeud) => noeud.getText(sf).replace(/^['"`]|['"`]$/g, '')
  const champ = (objet, nom) =>
    objet.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === nom)

  const visiter = (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'NAV' &&
      n.initializer &&
      ts.isArrayLiteralExpression(n.initializer)
    ) {
      for (const g of n.initializer.elements) {
        if (!ts.isObjectLiteralExpression(g)) continue
        const nom = champ(g, 'groupe')
        const repliable = champ(g, 'repliable')
        const items = champ(g, 'items')
        const entrees = []
        if (items && ts.isArrayLiteralExpression(items.initializer)) {
          for (const it of items.initializer.elements) {
            // `{ path: 'projets', label: 'Projets' }` — une entrée = un `path`
            if (!ts.isObjectLiteralExpression(it)) continue
            const p = champ(it, 'path')
            const l = champ(it, 'label')
            entrees.push({
              path: p ? litteral(p.initializer) : null,
              label: l ? litteral(l.initializer) : null,
              ligne: ligneDe(sf, it),
            })
          }
        }
        groupes.push({
          groupe: nom ? litteral(nom.initializer) : '(groupe sans nom)',
          // un groupe sans `repliable` est visible : c'est le défaut du menu
          repliable: !!repliable && repliable.initializer.getText(sf) === 'true',
          items: entrees,
        })
      }
    }
    ts.forEachChild(n, visiter)
  }
  visiter(sf)
  return groupes
}

const GROUPES = groupesDeNav()
const ENTREES = GROUPES.flatMap((g) => g.items)
const DESTINATIONS = ENTREES.map((e) => e.label)
/** ce qu'on voit sans rien déplier : les entrées des groupes non repliables */
const VISIBLES = GROUPES.filter((g) => !g.repliable).flatMap((g) => g.items)

// Un test qui ne voit rien passe toujours. `NAV` renommé, déplacé dans un
// autre fichier ou construit dynamiquement, et le compteur rendrait 0 — le
// plafond serait « tenu » par un tableau de bord débranché. C'est très
// exactement le mode de panne que la refonte répare : la mesure absente.
assert.ok(
  DESTINATIONS.length >= 5,
  'Aucune destination lisible dans le tableau `NAV` de src/App.tsx.\n' +
    'Le compteur d’endroits est débranché : il rendra « 0 endroit » et le plafond sera tenu par du vide.\n' +
    'Si `NAV` a changé de forme ou de fichier, c’est CE test qu’il faut suivre, pas contourner.',
)

// Une entrée dont le `path` ou le `label` ne se lit pas serait comptée comme
// les autres tout en étant invisible aux contrôles qui la suivent (le repli,
// la recherche, la route). Mieux vaut échouer ici que compter un fantôme.
for (const e of ENTREES) {
  assert.ok(
    e.path !== null && e.label !== null,
    `src/App.tsx:${e.ligne} — entrée de menu illisible (path=${e.path}, label=${e.label}).\n` +
      'Une entrée qui ne se lit pas sort de tous les contrôles qui suivent : elle serait repliée sans\n' +
      'être indexée dans la recherche, et personne ne le saurait.',
  )
}

// Deux entrées pour la même adresse, c'est deux portes vers le même endroit :
// de la surface pure, celle qui ne se voit pas dans un total.
{
  const vus = new Map()
  for (const e of ENTREES) {
    assert.ok(
      !vus.has(e.path),
      `Deux entrées de menu mènent à « #/${e.path} » : « ${vus.get(e.path)} » et « ${e.label} ».\n` +
        'Deux portes vers le même écran, c’est une ligne de menu à balayer pour rien.',
    )
    vus.set(e.path, e.label)
  }
}

// Un groupe repliable vide est un bouton qui ne mène nulle part — et il ferait
// baisser le compte des visibles sans rien replier du tout.
for (const g of GROUPES) {
  assert.ok(
    g.items.length > 0,
    `Le groupe de menu « ${g.groupe} » ne contient aucune entrée : c’est un bouton qui ne mène nulle part.`,
  )
}

// --- 1b. les jeux d'onglets -------------------------------------------------
//
// COMMENT SE COMPTE UN JEU D'ONGLETS. Le nombre d'endroits d'un écran est le
// nombre d'onglets DÉCLARÉS, pas le nombre affiché à un instant donné :
//
//   • `tabs={principales.map(…)}` (FinanceNav) où `principales` vaut
//     `VUES.filter(v => v.rang === 'principal')` compte les NEUF vues de
//     Finance, pas les quatre du premier rang. Les cinq autres sont sur un
//     rang discret juste en dessous — discret n'est pas absent : ce sont
//     bien neuf endroits où l'on peut se trouver.
//   • `tabs={ongletsVisibles.map(…)}` (Projets) où `ongletsVisibles` vaut
//     `[...ONGLETS_PRINCIPAUX, ...ONGLETS_PLUS.filter(…)]` compte SEPT
//     onglets : les cinq visibles plus les deux du menu « Plus ».
//
// D'où la règle de résolution : `.filter()` / `.map()` / `.slice()` se
// traversent jusqu'au tableau déclaré. Un endroit qu'on n'atteint que sous
// condition reste un endroit.

function longueurTableau(noeud, sf, portee, vus = new Set()) {
  if (!noeud) return null
  if (ts.isParenthesizedExpression(noeud) || ts.isAsExpression(noeud) || ts.isSatisfiesExpression(noeud))
    return longueurTableau(noeud.expression, sf, portee, vus)
  if (ts.isArrayLiteralExpression(noeud)) {
    let total = 0
    for (const el of noeud.elements) {
      if (ts.isSpreadElement(el)) {
        const n = longueurTableau(el.expression, sf, portee, vus)
        if (n === null) return null
        total += n
      } else total += 1
    }
    return total
  }
  if (ts.isIdentifier(noeud)) {
    if (vus.has(noeud.text)) return null // cycle : on préfère échouer que boucler
    const decl = portee.get(noeud.text)
    return decl ? longueurTableau(decl, sf, portee, new Set([...vus, noeud.text])) : null
  }
  if (ts.isCallExpression(noeud) && ts.isPropertyAccessExpression(noeud.expression)) {
    const methode = noeud.expression.name.text
    if (['map', 'filter', 'slice', 'concat', 'sort', 'reverse'].includes(methode))
      return longueurTableau(noeud.expression.expression, sf, portee, vus)
  }
  return null
}

function jeuxDOnglets(rel) {
  const sf = arbre(rel)
  const portee = new Map()
  const collecter = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer)
      portee.set(n.name.text, n.initializer)
    ts.forEachChild(n, collecter)
  }
  collecter(sf)

  return elements(rel, 'Tabs').map((n) => {
    const attr = n.attributes.properties.find(
      (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'tabs',
    )
    const expr = attr && attr.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : null
    return {
      ligne: ligneDe(sf, n),
      nombre: longueurTableau(expr, sf, portee),
      texte: expr ? expr.getText(sf).replace(/\s+/g, ' ').slice(0, 60) : '(pas de prop `tabs`)',
    }
  })
}

const ONGLETS_PAR_ECRAN = []
for (const fichier of FICHIERS) {
  const jeux = jeuxDOnglets(fichier)
  if (jeux.length) ONGLETS_PAR_ECRAN.push([fichier, jeux])
}

// Le jour où un jeu d'onglets prend une forme que ce résolveur ne sait pas
// lire, il ne doit PAS être compté zéro en silence : un écran entier
// disparaîtrait du décompte et la surface pourrait doubler sans rien
// déclencher. Le test échoue et demande d'apprendre la forme au résolveur.
for (const [fichier, jeux] of ONGLETS_PAR_ECRAN) {
  for (const jeu of jeux) {
    assert.ok(
      jeu.nombre !== null,
      `${fichier}:${jeu.ligne} — impossible de compter les onglets de \`tabs={${jeu.texte}}\`.\n` +
        'Ce jeu vaudrait 0 dans le décompte des endroits, et un écran entier sortirait de la mesure.\n' +
        'Apprenez cette forme à `longueurTableau` (ou déclarez les onglets dans une constante de module\n' +
        'ou un tableau littéral, les deux formes que la moitié des écrans emploie déjà).',
    )
    assert.ok(jeu.nombre > 0, `${fichier}:${jeu.ligne} — un jeu d’onglets vide n’a pas de sens.`)
  }
}

// CE NOMBRE-CI EST UN PLANCHER, PAS UN PLAFOND, et il ne mesure pas la
// surface : il mesure que le COMPTEUR VOIT ENCORE. `Tabs` renommé, et les 54
// onglets tomberaient à zéro sans qu'une seule assertion de plafond bronche.
// Il descend donc quand un écran à onglets disparaît pour de bon — la tranche 3
// en a retiré un, Situations.tsx n'ayant plus d'export par défaut : il n'est
// plus un écran, il est le module des vues de situation.
assert.ok(
  ONGLETS_PAR_ECRAN.length >= EN_VIGUEUR.ecransAOnglets,
  `Seuls ${ONGLETS_PAR_ECRAN.length} écrans à onglets trouvés (${EN_VIGUEUR.ecransAOnglets} attendus au minimum).\n` +
    'Soit la refonte a supprimé des écrans — descendez ce plancher dans le même commit, en ajoutant la\n' +
    'ligne correspondante à CONSTATS : c’est là que la baisse se déclare —,\n' +
    'soit `Tabs` a changé de nom et le compteur ne voit plus rien.',
)

const NB_ONGLETS = ONGLETS_PAR_ECRAN.reduce(
  (n, [, jeux]) => n + jeux.reduce((m, j) => m + j.nombre, 0),
  0,
)
const NB_ENDROITS = DESTINATIONS.length + NB_ONGLETS

// --- 1c. les plafonds -------------------------------------------------------

const detailOnglets = ONGLETS_PAR_ECRAN.map(
  ([f, jeux]) => `  ${path.basename(f)} : ${jeux.reduce((m, j) => m + j.nombre, 0)}`,
).join('\n')

assert.ok(
  DESTINATIONS.length <= PLAFOND_DESTINATIONS,
  `${DESTINATIONS.length} destinations au menu, le plafond est ${PLAFOND_DESTINATIONS}.\n` +
    `Menu actuel : ${DESTINATIONS.join(' · ')}\n\n` +
    'Une DESTINATION est l’endroit le plus cher de l’outil : elle est visible en permanence, pour tout le\n' +
    'monde, sur tous les écrans. La refonte en promet 5 visibles + un groupe replié (tranche 2), et la\n' +
    'tranche 3 a retiré du TABLEAU les deux dont le contenu a déménagé — « Situations » (vue\n' +
    'd’Entreprises) et « Documents » (le registre vit dans la fiche projet). Leurs routes répondent\n' +
    'toujours : c’est scripts/test-navigation-repliee.cjs qui le tient, et une entrée de menu n’est pas\n' +
    'le seul chemin vers un écran — la palette « / » en est un.\n' +
    'Le plafond se lit dans la dernière ligne de CONSTATS. Le relever demande d’y ajouter une ligne\n' +
    'datée, nommée, qui dit ce qu’elle apporte — pas de changer un chiffre pour faire passer la CI.',
)

// LE COMPTE QUI A BAISSÉ. Les deux assertions se lisent ensemble : la
// précédente dit que le menu ne DÉCLARE pas plus de seize entrées, celle-ci
// qu'il n'en MONTRE pas plus de cinq. Le plan (§3.3) tient les deux chiffres
// séparés parce qu'ils ne disent pas la même chose — l'un mesure la dette,
// l'autre la gêne, et la tranche 2 ne fait baisser que la seconde.
assert.ok(
  VISIBLES.length <= PLAFOND_DESTINATIONS_VISIBLES,
  `${VISIBLES.length} entrées de menu visibles sans rien déplier, le plafond est ${PLAFOND_DESTINATIONS_VISIBLES}.\n` +
    `Visibles : ${VISIBLES.map((e) => e.label).join(' · ')}\n` +
    `Repliées : ${GROUPES.filter((g) => g.repliable)
      .map((g) => `${g.groupe} (${g.items.length})`)
      .join(' · ') || '(aucune)'}\n\n` +
    'C’est LE chiffre dont l’agence se plaint — « on se perd dans le site » —, et il était mesuré nulle\n' +
    'part avant la tranche 2 : seize entrées visibles en permanence, sur tous les écrans, pour deux\n' +
    'personnes. La cible du plan (§3.1) est cinq : les deux ancres (la semaine, les projets) et les trois\n' +
    'questions insolubles dans un projet (une entreprise sur plusieurs chantiers, l’argent de l’agence,\n' +
    'un dossier qui n’a pas encore de projet).\n\n' +
    'Rien n’oblige à supprimer une entrée pour repasser sous le plafond : mettez-la dans le groupe\n' +
    'repliable (`repliable: true`, src/App.tsx) — elle reste à un clic, sa route ne bouge pas, et elle se\n' +
    'retrouve par la recherche « / ». Mais alors AJOUTEZ-LA AUSSI à `ECRANS`\n' +
    '(src/modules/RechercheOverlay.tsx) : sans quoi « replié » veut dire « perdu », et\n' +
    'scripts/test-navigation-repliee.cjs vous le dira.',
)

assert.ok(
  NB_ENDROITS <= PLAFOND_ENDROITS,
  `${NB_ENDROITS} endroits (${DESTINATIONS.length} destinations + ${NB_ONGLETS} onglets), ` +
    `le plafond est ${PLAFOND_ENDROITS}.\n\n` +
    `Onglets par écran :\n${detailOnglets}\n\n` +
    'C’EST LA SEULE MESURE DE SUCCÈS DE LA REFONTE : le nombre d’endroits, à fonctions constantes.\n' +
    'Une livraison qui ajoute un écran ou un onglet est un échec même si elle raccourcit un parcours —\n' +
    'c’est ainsi qu’on est passé à soixante-deux endroits pour deux personnes.\n\n' +
    'Rien n’oblige à supprimer pour autant : on REPLIE (un `<details>`, un groupe de menu, un « Voir\n' +
    'plus »), on regroupe, on retrouve par la recherche « / ». Les données et le code restent — c’est ce\n' +
    'qu’a fait la tranche 3 : les quatre vues de situation sont montées en repli chez Entreprises, et un\n' +
    'repli n’est pas un endroit.\n' +
    'Si l’endroit neuf est vraiment irremplaçable, ajoutez une ligne à CONSTATS et écrivez-y ce qu’il\n' +
    'porte que l’existant ne pouvait pas porter, et quel endroit il remplace. Le contrôle de monotonie\n' +
    'refusera la ligne : c’est voulu, et c’est le moment de se demander si l’endroit valait la refonte.',
)

// Le plafond des visibles se tient aussi en repliant TOUT — et un menu vide
// passerait n'importe quel plafond. Les deux ancres du §2 sont donc nommées :
// ce sont les seules dont le repli serait une régression et non un progrès.
for (const [chemin, libelle] of Object.entries(ANCRES_TOUJOURS_VISIBLES)) {
  const entree = VISIBLES.find((e) => e.path === chemin)
  assert.ok(
    entree,
    `L’ancre « ${libelle} » (#/${chemin}) n’est plus une entrée de menu VISIBLE.\n` +
      `Visibles : ${VISIBLES.map((e) => e.label).join(' · ') || '(aucune)'}\n\n` +
      'Le §2 du plan pose deux ancres — le temps qui passe et le travail qu’on fait — et tout le reste\n' +
      'est une vue de recoupement. Replier une ancre ferait baisser le compte des visibles sans rien\n' +
      'simplifier : ce serait passer le contrôle en cachant ce qu’on ouvre tous les matins.\n' +
      'Si l’ancre a changé d’adresse ou de libellé, c’est ANCRES_TOUJOURS_VISIBLES qu’il faut suivre.',
  )
}

// ==========================================================================
// CONTRÔLE N°2 — le plafond de cartes
// ==========================================================================
//
// CE QUE CE COMPTEUR MESURE, ET CE QU'IL NE MESURE PAS. Il faut le dire net,
// parce qu'un contrôle qui prétend mesurer plus qu'il ne mesure est pire que
// pas de contrôle : on lui fait confiance.
//
// Il compte les `<Card>` MONTÉS DANS UN FICHIER. Il ne sait pas lesquels
// s'affichent ensemble, et il ne peut pas le savoir sans exécuter l'écran :
//
//   • il SUR-compte les écrans à onglets — les douze cartes de Projets.tsx se
//     répartissent entre la liste des projets et les sept onglets de la fiche ;
//     on n'en voit jamais douze à la fois ;
//   • il SOUS-compte les écrans composés — l'onglet « Chantier & CR » de la
//     fiche projet monte `ProjetChantier.tsx` et ses sept cartes EN PLUS de
//     celles de Projets.tsx. C'est l'onglet que le plan désigne comme celui
//     qui a débordé, et aucun fichier pris seul ne le montre ;
//   • une carte repliée sous un `<details>` fermé (les deux « Voir plus » du
//     Cockpit) est comptée comme les autres : le repli se fait le plus souvent
//     autour d'un COMPOSANT, pas d'un `<Card>`, et l'analyse lexicale ne le
//     suit pas.
//
// Ce qu'il garantit, en revanche, est exact et suffit à son rôle : il est
// MONOTONE. Un `<Card>` de plus dans un fichier fait monter le compte de ce
// fichier et le compte global. C'est tout ce qu'on lui demande — empêcher la
// hausse, pas arbitrer une mise en page.

const CARTES = FICHIERS.map((f) => [f, elements(f, 'Card').length])
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

assert.ok(CARTES.length > 20, 'Le compteur de cartes ne voit presque rien : `Card` a-t-il changé de nom ?')

const [pireEcran, pireNombre] = CARTES[0]
const totalCartes = CARTES.reduce((n, [, c]) => n + c, 0)

assert.ok(
  pireNombre <= PLAFOND_CARTES_PAR_ECRAN,
  `${pireEcran} monte ${pireNombre} cartes, le plafond par écran est ${PLAFOND_CARTES_PAR_ECRAN}.\n` +
    `Les cinq plus chargés : ${CARTES.slice(0, 5).map(([f, n]) => `${path.basename(f)} ${n}`).join(' · ')}\n\n` +
    'Une carte de plus, c’est un bloc de plus à balayer des yeux avant de trouver. Regroupez-la dans une\n' +
    'carte existante, ou repliez-la sous un `<details>` « Voir plus » — rien n’est supprimé, tout reste\n' +
    'à un clic. Relever le plafond est une décision qui s’explique dans le commit.',
)

// Le détenteur est nommé DANS le test, et vérifié. S'il change, c'est une
// information : l'écran qui débordera en premier n'est plus le même.
assert.equal(
  pireEcran,
  DETENTEUR_CARTES,
  `L’écran le plus chargé n’est plus ${DETENTEUR_CARTES} mais ${pireEcran} (${pireNombre} cartes).\n` +
    'Mettez DETENTEUR_CARTES à jour : c’est le nom qui dit où regarder en premier, et un nom périmé\n' +
    'envoie chercher au mauvais endroit.',
)

assert.ok(
  totalCartes <= PLAFOND_CARTES_TOTAL,
  `${totalCartes} cartes dans src/, le plafond global est ${PLAFOND_CARTES_TOTAL}.\n\n` +
    'Le plafond PAR ÉCRAN ne suffit pas : douze écrans qui prennent une carte chacun ne le déclenchent\n' +
    'jamais et font pourtant douze cartes de plus. C’est la forme exacte qu’a prise la dérive — cent\n' +
    'cinquante corrections dont aucune, prise seule, n’était déraisonnable.',
)

// LES DEUX CHIFFRES SONT DITS, TOUJOURS, ET DANS CET ORDRE. Le premier est
// celui que l'agence ressent, le second celui que la refonte doit encore
// faire baisser. N'en afficher qu'un laisserait croire qu'il n'y en a qu'un —
// et c'est en confondant les deux qu'on prendrait un menu replié pour une
// dette remboursée.
const replies = ENTREES.length - VISIBLES.length
console.log(
  `Menu VU : ${VISIBLES.length} entrées visibles / ${PLAFOND_DESTINATIONS_VISIBLES}` +
    (replies > 0
      ? ` (+ ${replies} repliées dans ${GROUPES.filter((g) => g.repliable).map((g) => `« ${g.groupe} »`).join(', ')})`
      : '') +
    `. Menu MESURÉ : ${DESTINATIONS.length} destinations / ${PLAFOND_DESTINATIONS} — replier retire de la vue, ` +
    'pas du compte (§3.3).\n' +
    `Surface : ${NB_ENDROITS} endroits / ${PLAFOND_ENDROITS} ` +
    `(${DESTINATIONS.length} destinations / ${PLAFOND_DESTINATIONS} + ${NB_ONGLETS} onglets sur ` +
    `${ONGLETS_PAR_ECRAN.length} écrans), ${totalCartes} cartes / ${PLAFOND_CARTES_TOTAL} ` +
    `dont ${pireNombre} / ${PLAFOND_CARTES_PAR_ECRAN} au maximum par écran (${path.basename(pireEcran)}). ` +
    '\n' +
    `Plafonds lus dans la dernière ligne de CONSTATS (${EN_VIGUEUR.tranche}) : ` +
    `${CONSTATS[0].endroits} endroits au premier constat, ${EN_VIGUEUR.endroits} aujourd’hui, ` +
    `soit ${EN_VIGUEUR.endroits - CONSTATS[0].endroits}. Comptés par le compilateur ; un plafond est un ` +
    'constat et non un objectif, et le DESCENDRE après chaque tranche est le travail — pas son entretien : ' +
    'un plafond qu’on ne descend pas laisse la place libre pour regrimper demain.',
)
