// Constat R3 de l'audit d'usage — LA MÊME NOTION CODÉE DEUX FOIS, AVEC DEUX
// RÉSULTATS POSSIBLES.
//
// C'est le défaut n° 1 trouvé par l'audit, et il ne ressemble jamais à une
// panne : les deux codes marchent, chacun de son côté, et l'écart entre eux
// ne se voit que le jour où quelqu'un compare. Les lots E2 et D2 en ont
// fermé deux instances. Ce test garde les deux portes.
//
// INSTANCE 1 — DEUX FICHES POUR UNE ENTREPRISE (E2, constat R2)
// --------------------------------------------------------------
// L'annuaire éditait `state.artisans` ; le rattachement des mails, la fiche
// transverse, les factures fournisseurs et les marchés lisaient
// `state.entreprises`. Les deux collections n'étaient recopiées l'une vers
// l'autre qu'à l'amorce du chargement. Corriger la date de décennale sur la
// fiche d'annuaire ne changeait donc rien à l'alerte qui la surveille — et
// personne ne pouvait dire laquelle des deux fiches regarder.
//
// INSTANCE 2 — DEUX IMPORTS DE RELEVÉ (D2)
// -----------------------------------------
// Deux écrans importaient des relevés bancaires. Celui de Banque demandait
// le « solde de fin » ; celui de Connecteurs enregistrait `soldeFinal: null`
// en dur. Un OFX déposé du mauvais côté entrait bien en mouvements et ne
// mettait JAMAIS à jour la trésorerie affichée — sans un mot à l'écran. Le
// geste était le même, l'écran disait la même chose, le résultat non.
//
// Ce qui est vérifié ici est de deux natures, et c'est voulu : ce qui
// s'exécute s'exécute (les autorités pures, avec de vrais chiffres), et ce
// qui ne s'exécute pas — un écran React — se lit dans l'arbre syntaxique du
// compilateur, jamais par recherche de texte.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')
const arbre = (f) => ts.createSourceFile(f, lire(f), ts.ScriptTarget.ES2022, true)

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

/** le corps d'une fonction de premier niveau, isolé par le compilateur —
 *  découper au `indexOf` ferait dépendre le test de l'ordre des fonctions
 *  dans le fichier */
function corpsDe(chemin, nom) {
  const sf = arbre(chemin)
  let trouve = null
  const parcourir = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.name.text === nom) trouve = n
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)
  assert.ok(trouve, `${chemin} : la fonction ${nom}() est introuvable — le test parle d’un code qui n’existe plus`)
  return trouve.getText()
}

// ============================================================
// INSTANCE 1 — UNE SEULE VÉRITÉ D'ENTREPRISE
// ============================================================

const E = charger('src/entreprise.ts')
const RESSOURCES = 'src/modules/Ressources.tsx'

// --- 1.1 l'autorité du rapprochement, avec de vrais cas ---------------------
//
// C'est `entrepriseDe` qui décide « cette fiche et cette entreprise sont la
// même ». Elle lit l'IDENTIFIANT d'abord, le nom seulement en repli : c'est
// tout l'intérêt d'avoir posé `entrepriseId` sur la fiche d'annuaire.

{
  const etat = {
    entreprises: [
      { id: 'ent-1', raisonSociale: 'Gros œuvre du Valois', nomCommercial: 'GO Valois', domaines: ['govalois.fr'], lots: ['Gros œuvre'] },
      { id: 'ent-2', raisonSociale: 'Menuiseries Picardes', domaines: [], lots: ['Menuiserie'] },
    ],
  }

  // `null` plutôt qu'une exception : sans cela, une régression du
  // rapprochement rendrait « Cannot read properties of null » au lieu de
  // dire lequel des quatre chemins vient de se rompre
  const trouve = (cle) => (E.entrepriseDe(etat, cle) || { id: 'AUCUNE ENTREPRISE TROUVÉE' }).id

  assert.equal(trouve('ent-1'), 'ent-1', 'par identifiant')
  assert.equal(trouve('Gros œuvre du Valois'), 'ent-1', 'par raison sociale')
  assert.equal(trouve('  GROS ŒUVRE DU VALOIS  '), 'ent-1', 'casse et espaces de bord tolérés (règle `fold` du registre)')
  assert.equal(trouve('GO Valois'), 'ent-1', 'par nom commercial — celui qu’on tape dans un mail')
  assert.equal(E.entrepriseDe(etat, 'Inconnue SARL'), null, 'une entreprise absente rend null, jamais la première venue')
  assert.equal(E.entrepriseDe(etat, ''), null, 'une clé vide ne rapproche rien — sinon toute fiche sans nom tomberait sur la même entreprise')

  // LE cas qui justifie `entrepriseId` : l'entreprise est renommée (fusion,
  // changement de raison sociale, faute de frappe corrigée). Rapprochée par
  // le nom, la fiche d'annuaire se détacherait en silence et on
  // recréerait une seconde entreprise au premier enregistrement.
  etat.entreprises[0].raisonSociale = 'Valois Construction'
  assert.equal(
    trouve('ent-1'),
    'ent-1',
    'après renommage, l’identifiant tient encore : c’est POUR ÇA que la fiche d’annuaire porte `entrepriseId`',
  )
  assert.equal(
    E.entrepriseDe(etat, 'Gros œuvre du Valois'),
    null,
    '… alors que l’ancien nom ne rapproche plus rien — un rattachement par nom seul aurait fabriqué un doublon',
  )
}

// --- 1.2 la fiche d'annuaire écrit l'entreprise CANONIQUE -------------------

{
  const source = lire(RESSOURCES)
  const enregistrer = corpsDe(RESSOURCES, 'enregistrerArtisan')

  assert.match(
    source,
    /import \{ entrepriseDe \} from '\.\.\/entreprise'/,
    'l’écran doit IMPORTER l’autorité du rapprochement — la refaire ici (comparaison de noms, minuscules) ' +
      'est le défaut R3 lui-même',
  )
  assert.doesNotMatch(
    source,
    /function entrepriseDe|raisonSociale\.toLowerCase\(\)/,
    'et ne pas en écrire une seconde version',
  )

  // les DEUX écritures, du même geste
  assert.match(enregistrer, /entrepriseDe\(d, a\.entrepriseId \|\| a\.nom\)/, 'l’entreprise se retrouve par identifiant, nom en repli')
  assert.match(enregistrer, /d\.entreprises\.push\(e\)/, 'une entreprise inconnue du registre y ENTRE — sinon la fiche resterait seule avec ses données')
  assert.match(enregistrer, /entrepriseId: e\.id/, 'et la fiche repart avec l’identifiant : le rapprochement ne dépendra plus de l’orthographe')
  assert.match(enregistrer, /d\.artisans\[i\] = fiche/, 'la fiche d’annuaire est mise à jour…')
  assert.match(enregistrer, /d\.artisans\.push\(fiche\)/, '… ou créée')

  // chaque champ que la fiche affiche doit atterrir sur l'entreprise, sinon
  // il continue de vivre à un seul endroit — et le suivant est le bon
  for (const champ of ['raisonSociale', 'lots', 'zone', 'contactNom', 'contactEmail', 'tel', 'decennaleFin'])
    assert.match(
      enregistrer,
      new RegExp(`e\\.${champ} =`),
      `« ${champ} » doit s’écrire sur l’entreprise canonique : sinon la fiche d’annuaire le montre, et les ` +
        'marchés, le rattachement et l’alerte continuent de lire l’ancienne valeur sans que rien ne le dise',
    )

  // et la fiche RELIT la canonique — écrire des deux côtés sans relire
  // laisserait l'écran afficher sa propre copie
  const vue = corpsDe(RESSOURCES, 'vueCanonique')
  assert.match(vue, /entrepriseDe\(state, a\.entrepriseId \|\| a\.nom\)/, 'la vue passe par la même autorité que l’écriture')
  for (const champ of ['lots', 'zone', 'contactNom', 'contactEmail', 'tel', 'decennaleFin'])
    assert.match(vue, new RegExp(`${champ}:`), `« ${champ} » se LIT sur l’entreprise canonique`)
  assert.match(
    source,
    /const a = fiche \? vueCanonique\(state, fiche\) : undefined/,
    'la fiche affichée est la vue canonique, pas la ligne brute de l’annuaire',
  )

  // le domaine e-mail S'AJOUTE, il ne remplace pas : c'est par lui que la
  // cascade rattache un mail, et écraser la liste connue ferait perdre des
  // rattachements déjà appris
  assert.match(
    enregistrer,
    /if \(domaine && !e\.domaines\.includes\(domaine\)\) e\.domaines\.push\(domaine\)/,
    'le domaine e-mail s’ajoute aux domaines connus — l’écraser ferait perdre des rattachements déjà appris',
  )
}

// --- 1.3 retirer de l'annuaire ne supprime PAS l'entreprise -----------------

{
  const supprimer = corpsDe(RESSOURCES, 'supprimerArtisan')
  assert.match(supprimer, /d\.artisans = d\.artisans\.filter/, 'le retrait porte sur l’annuaire…')
  assert.doesNotMatch(
    supprimer,
    /d\.entreprises\s*=|d\.entreprises\.splice/,
    '… et JAMAIS sur l’entreprise canonique : des marchés, des factures et des documents la référencent par ' +
      'identifiant, et les rendre orphelins pour une décision qui ne portait que sur l’annuaire serait ' +
      'une perte silencieuse',
  )
  assert.match(supprimer, /confirmer\(/, 'et le retrait se confirme — il touche les rattachements de projet')
}

// --- 1.4 INVENTAIRE : les fiches d'annuaire créées SANS entreprise ----------
//
// Sur le modèle de `test-tableaux.cjs` : la liste ci-dessous ne PERMET pas,
// elle CONSTATE. Chacune de ces lignes crée une fiche d'annuaire sans poser
// `entrepriseId` — une seconde vérité peut donc encore naître, simplement
// plus depuis l'écran de l'annuaire. Une entrée qui disparaît est une bonne
// nouvelle : retirez-la. Une entrée EN TROP est un chemin de création qu'on
// vient de rouvrir.

const CREENT_SANS_ENTREPRISE = ['src/modules/ProjetRessources.tsx']

{
  const modules = fs
    .readdirSync(path.join(racine, 'src/modules'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `src/modules/${f}`)
    .sort()

  /** la fonction qui contient ce nœud — c'est à son échelle qu'on juge, et
   *  pas à celle de l'argument : `d.artisans.push(fiche)` est parfaitement
   *  correct quand `fiche` a reçu son `entrepriseId` deux lignes plus haut */
  function fonctionEnglobante(noeud) {
    let n = noeud.parent
    while (n && !ts.isFunctionDeclaration(n) && !ts.isArrowFunction(n) && !ts.isFunctionExpression(n)) n = n.parent
    return n
  }

  const creations = []
  for (const chemin of modules) {
    const sf = arbre(chemin)
    const parcourir = (n) => {
      // `d.artisans.push(…)` / `s.artisans.push(…)`
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === 'push' &&
        ts.isPropertyAccessExpression(n.expression.expression) &&
        n.expression.expression.name.text === 'artisans'
      ) {
        const portee = fonctionEnglobante(n)
        if (!portee || !/entrepriseId/.test(portee.getText())) creations.push(chemin)
      }
      ts.forEachChild(n, parcourir)
    }
    parcourir(sf)
  }

  assert.deepEqual(
    [...new Set(creations)].sort(),
    [...CREENT_SANS_ENTREPRISE].sort(),
    'INVENTAIRE des chemins qui créent une fiche d’annuaire SANS entreprise canonique.\n' +
      '  · une entrée EN TROP = un chemin de création vient de rouvrir la double vérité de R2 : la fiche ' +
      'existera dans l’annuaire et nulle part ailleurs, et le premier enregistrement en fera un doublon ;\n' +
      '  · une entrée MANQUANTE = bonne nouvelle, retirez-la de CREENT_SANS_ENTREPRISE.\n' +
      `  constaté : [${[...new Set(creations)].join(', ')}]`,
  )
}

// ============================================================
// INSTANCE 2 — UN SEUL POINT D'IMPORT, QUI CONSERVE LE SOLDE
// ============================================================

/** les endroits où `soldeFinal` reçoit `null` EN DUR — vus par le
 *  compilateur, jamais par recherche de texte : les deux écrans citent
 *  `soldeFinal: null` dans le commentaire qui raconte le défaut, et un
 *  `grep` ne saurait pas les distinguer d'une écriture */
function soldeFinalEcritANull(chemin) {
  const sf = arbre(chemin)
  const trouves = []
  const parcourir = (n) => {
    if (
      ts.isPropertyAssignment(n) &&
      n.name.getText() === 'soldeFinal' &&
      n.initializer.kind === ts.SyntaxKind.NullKeyword
    ) {
      trouves.push(`${chemin}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`)
    }
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)
  return trouves
}

const B = charger('src/banque.ts')
const I = charger('src/imports.ts')
const BANQUE = 'src/modules/Banque.tsx'
const CONNECTEURS = 'src/modules/Connecteurs.tsx'

// --- 2.1 le défaut, en chiffres : sans solde de fin, RIEN ne bouge ----------
//
// C'est exactement ce que faisait l'import de Connecteurs, à chaque fois, en
// silence. On le rejoue ici pour que la règle ne soit pas une croyance.

{
  const releve = [
    { date: '2026-07-01', montant: -1200, libelle: 'VIR LOYER' },
    { date: '2026-07-03', montant: 4800, libelle: 'VIR COMMUNE DE CHAMANT' },
  ]

  const sansSolde = {
    transactionsBancaires: releve.map((l, i) => ({ id: `t${i}`, ...l })),
    importsBancaires: [{ id: 'imp-1', date: '2026-07-05', nomFichier: 'releve.ofx', nbLignes: 2, nbNouvelles: 2, soldeFinal: null, dateSolde: null }],
  }
  assert.equal(
    B.soldeBancaire(sansSolde),
    null,
    'LE DÉFAUT DE D2 : deux mouvements sont bien entrés, et la trésorerie reste INCONNUE. `null`, pas 0 — et ' +
      'l’ancien import de Connecteurs écrivait `soldeFinal: null` en dur, à chaque fois, sans le dire',
  )

  const avecSolde = {
    ...sansSolde,
    importsBancaires: [{ ...sansSolde.importsBancaires[0], soldeFinal: 12345.67, dateSolde: '2026-07-05' }],
  }
  const solde = B.soldeBancaire(avecSolde)
  assert.equal(solde.solde, 12345.67, 'avec le solde de fin, la trésorerie se cale sur le relevé')
  assert.equal(solde.date, '2026-07-05')

  // et les mouvements POSTÉRIEURS au solde s'y ajoutent (ceux d'avant sont
  // déjà dedans : les compter deux fois doublerait la moitié du relevé)
  const apres = {
    ...avecSolde,
    transactionsBancaires: [...avecSolde.transactionsBancaires, { id: 't9', date: '2026-07-08', montant: -300, libelle: 'CB CARBURANT' }],
  }
  assert.equal(B.soldeBancaire(apres).solde, 12045.67, 'les mouvements postérieurs au solde s’y ajoutent — ceux d’avant y sont déjà')
}

// --- 2.2 les quatre formats passent par le même chemin ----------------------

{
  const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260701<TRNAMT>-1200.00<NAME>VIR LOYER</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260703<TRNAMT>4800.00<NAME>VIR COMMUNE DE CHAMANT</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

  assert.equal(I.detecterFormatBancaire(OFX, 'releve.ofx'), 'ofx', 'le format se reconnaît tout seul — la personne dépose son fichier, c’est tout')
  const lignes = I.lireOFX(OFX)
  assert.equal(lignes.length, 2, 'les deux mouvements du relevé OFX sont lus')
  assert.equal(lignes[0].date, '2026-07-01')
  assert.equal(lignes[1].montant, 4800)

  // idempotence : réimporter le même relevé n'ajoute rien. C'est la règle qui
  // permet de déposer sans réfléchir, et elle ne dépend pas du format.
  const etat = { transactionsBancaires: [], importsBancaires: [] }
  const premier = B.preparerImport(etat, lignes, 'imp-1')
  assert.equal(premier.nouvelles.length, 2)
  assert.equal(premier.doublons, 0)
  const second = B.preparerImport({ ...etat, transactionsBancaires: premier.nouvelles }, lignes, 'imp-2')
  assert.equal(second.nouvelles.length, 0, 'réimporter le même relevé n’ajoute AUCUNE ligne')
  assert.equal(second.doublons, 2, '… et le dit : « 2 déjà connu(s) », plutôt qu’un silence qu’on prend pour un échec')
}

// --- 2.3 UN SEUL écran importe ----------------------------------------------

{
  const modules = fs
    .readdirSync(path.join(racine, 'src/modules'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `src/modules/${f}`)
    .sort()
  assert.ok(modules.length > 30, 'le balayage doit voir tous les écrans')

  /** les écrans qui APPELLENT le producteur d'import (l'arbre, pas le texte :
   *  `preparerImport` est cité dans les commentaires des deux fichiers) */
  const importateurs = modules.filter((chemin) => {
    const sf = arbre(chemin)
    let trouve = false
    const parcourir = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'preparerImport') trouve = true
      ts.forEachChild(n, parcourir)
    }
    parcourir(sf)
    return trouve
  })

  assert.deepEqual(
    importateurs,
    [BANQUE],
    'UN SEUL écran a le droit d’intégrer un relevé. Deux points d’import, c’est deux façons de traiter le ' +
      'solde de fin — et celui qui l’oublie ne le dit pas.\n' +
      `  constaté : [${importateurs.join(', ')}]`,
  )

  // le champ fichier suit le producteur : un second champ ailleurs ferait
  // croire qu'on peut déposer là, pour un résultat différent
  const champsFichier = modules.filter((chemin) => /accept="[^"]*\.(ofx|qif)/.test(lire(chemin)))
  assert.deepEqual(
    champsFichier,
    [BANQUE],
    'le champ de dépôt d’un relevé bancaire n’existe qu’à un endroit — sinon on dépose au mauvais et rien ne le dit',
  )

  // et Connecteurs RENVOIE plutôt que de disparaître : un écran qui perd une
  // entrée sans la remplacer fait chercher longtemps
  const connecteurs = lire(CONNECTEURS)
  assert.match(connecteurs, /Import bancaire/, 'la carte reste en place dans Connecteurs — c’est là qu’on vient chercher les imports')
  assert.match(connecteurs, /#\/finance\/banque/, '… et elle renvoie au point unique')
  assert.match(connecteurs, /solde de fin de relevé/i, '… en disant POURQUOI c’est là-bas : c’est le seul endroit qui porte le solde')

  // `soldeFinal: null` est CITÉ dans le commentaire qui explique le défaut —
  // une recherche de texte échouerait ici le jour de son écriture, on la
  // relâcherait, et elle ne servirait plus à rien. On demande donc au
  // compilateur : un littéral de code EST une écriture, un commentaire non.
  assert.deepEqual(
    soldeFinalEcritANull(CONNECTEURS),
    [],
    'Connecteurs ne doit plus JAMAIS écrire `soldeFinal: null` : c’était ça, le défaut — un relevé intégré ' +
      'sans solde, donc une trésorerie qui ne bouge pas, sans un mot',
  )
}

// --- 2.4 le point unique porte le solde, et dit quand il ne l'a pas ---------

{
  const source = lire(BANQUE)

  assert.match(source, /const \[soldeFinal, setSoldeFinal\] = useState<number \| null>\(null\)/, 'le solde de fin est un champ SAISI — la machine ne l’invente pas')
  assert.match(source, /soldeFinal,\n/, 'et il part dans la trace de l’import — la valeur saisie, en propriété abrégée')
  assert.deepEqual(
    soldeFinalEcritANull(BANQUE),
    [],
    'le point unique lui-même ne doit pas se remettre à écrire `soldeFinal: null` en dur : ce serait le défaut ' +
      'de D2 déplacé plutôt que fermé',
  )
  assert.match(
    source,
    /dateSolde: soldeFinal != null \? dateSolde \|\| derniereDate : null/,
    'une date de solde sans solde n’a pas de sens ; et à défaut de date saisie, la dernière ligne du relevé sert — ' +
      'elle est juste dans l’immense majorité des cas et se corrige',
  )

  // « null n'est pas 0 » : le silence était le vrai défaut
  assert.match(
    source,
    /sans solde de fin, la trésorerie affichée ne bouge pas/,
    'quand aucun solde n’est saisi, le message de fin d’import le DIT — c’est le silence qui coûtait cher',
  )
  assert.match(
    source,
    /AUCUN ne porte de solde de fin : le solde réel reste inconnu/,
    'et l’écran le redit tant que ça dure, au lieu d’afficher une valeur manuelle comme si elle venait du relevé',
  )

  // le mapping de colonnes ne concerne QUE le CSV : le mémoriser depuis un
  // OFX écraserait un réglage utile par une valeur qui n'a jamais servi
  assert.match(
    source,
    /if \(format === 'csv'\) d\.settings\.banqueMapping = mapping/,
    'seul le CSV mémorise son mapping de colonnes — les trois formats structurés n’en ont pas',
  )
}

console.log(
  'Une seule autorité par notion : le rapprochement d’entreprise tient au renommage (identifiant d’abord), la ' +
    'fiche d’annuaire écrit les sept champs sur l’entreprise canonique et les relit, le retrait de l’annuaire ' +
    `ne supprime pas l’entreprise (${CREENT_SANS_ENTREPRISE.length} chemin de création encore sans entreprise, recensé) ; ` +
    'et un seul écran intègre un relevé — sans solde de fin la trésorerie reste NULLE et le dit, avec solde elle se cale.',
)
