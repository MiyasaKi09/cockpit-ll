// M.4 — aucun tableau JSX brut hors des fichiers recensés (§17, §22).
//
// `docs/CONTRAT_MODULES.md` impose depuis longtemps que tout tableau affiché
// passe par le composant `Table` (`src/ui.tsx`). Rien ne le vérifiait. Une
// règle écrite que personne ne contrôle n'est pas une règle : c'est un
// souhait, et la preuve est là — huit fichiers portent aujourd'hui un
// `<table>` à la main.
//
// CE QUE ÇA COÛTE, CONCRÈTEMENT
// ------------------------------
// `Table` porte la colonne figée (`.col-figee`), le défilement horizontal
// encapsulé et le comportement sous 700 px. Un `<table>` posé à la main ne
// les a pas. Au bureau ça ne se voit pas ; au téléphone, sur un chantier, la
// première colonne part hors écran et on ne sait plus de quelle ligne on lit
// les chiffres. C'est le mode de panne que ce test ferme — pas une question
// de style.
//
// POURQUOI LE COMPILATEUR ET PAS UNE EXPRESSION RÉGULIÈRE
// ---------------------------------------------------------
// Le dépôt produit aussi du HTML d'IMPRESSION, dans des gabarits en
// accents graves : `src/pdf.ts` en contient sept, `Planning.tsx` trois. Ces
// `<table>`-là sont du texte, jamais montés à l'écran, et n'ont donc rien à
// voir avec la règle. Une expression régulière ne fait pas la différence
// entre un élément JSX et une chaîne qui lui ressemble : elle échouerait le
// jour de son écriture, on la relâcherait, et elle ne servirait plus à rien.
//
// Le compilateur TypeScript, lui, rend un arbre : un `JsxOpeningElement`
// nommé `table` EST un tableau monté, une chaîne n'en est pas un. Aucune
// heuristique, donc aucune tolérance à inventer.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')

// L'inventaire de l'existant, à la date de M.4. Il n'autorise pas : il
// CONSTATE. Chaque entrée est une dette identifiée, pas une permission
// accordée pour l'avenir.
const RECENSES = new Set([
  'src/ui.tsx', // le composant `Table` lui-même — c'est ici que le <table> doit vivre
  'src/modules/Analyse.tsx',
  'src/modules/Planning.tsx',
  'src/modules/Prompts.tsx',
  'src/modules/Revue.tsx',
  'src/modules/Situations.tsx',
  'src/modules/Temps.tsx',
  'src/modules/VeilleAO.tsx',
])

function fichiersTsx(dossier) {
  const trouves = []
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, entree.name)
    if (entree.isDirectory()) trouves.push(...fichiersTsx(complet))
    else if (entree.name.endsWith('.tsx')) trouves.push(path.relative(racine, complet))
  }
  return trouves.sort()
}

/** Les lignes où un `<table>` est réellement monté à l'écran. */
function tablesJsx(chemin) {
  const source = ts.createSourceFile(
    chemin,
    fs.readFileSync(path.join(racine, chemin), 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  )
  const lignes = []
  const visiter = (noeud) => {
    const estOuvrant = ts.isJsxOpeningElement(noeud) || ts.isJsxSelfClosingElement(noeud)
    if (estOuvrant && noeud.tagName.getText(source) === 'table') {
      lignes.push(source.getLineAndCharacterOfPosition(noeud.getStart(source)).line + 1)
    }
    ts.forEachChild(noeud, visiter)
  }
  visiter(source)
  return lignes
}

const fichiers = fichiersTsx(path.join(racine, 'src'))
const porteurs = new Map()
for (const fichier of fichiers) {
  const lignes = tablesJsx(fichier)
  if (lignes.length) porteurs.set(fichier, lignes)
}

// --- 1. rien de nouveau -----------------------------------------------------

for (const [fichier, lignes] of porteurs) {
  assert.ok(
    RECENSES.has(fichier),
    `${fichier} (ligne${lignes.length > 1 ? 's' : ''} ${lignes.join(', ')}) : tableau JSX brut.\n` +
      'Passez par `Table` (src/ui.tsx) — il porte la colonne figée, le défilement encapsulé et\n' +
      'le comportement sous 700 px, qu’un `<table>` à la main n’a pas. `docs/CONTRAT_MODULES.md`\n' +
      'l’impose ; ce test est ce qui le rend opposable.',
  )
}

// --- 2. l'inventaire ne pourrit pas -----------------------------------------
//
// Un inventaire figé se périme en silence : le fichier migre vers `Table`,
// l'entrée reste, et elle couvre désormais un tableau que personne n'a
// examiné. C'est exactement ainsi que le test de renommage a validé à vide
// pendant toute une vague. Il se compare donc à la réalité, dans les deux
// sens.

for (const fichier of RECENSES) {
  assert.ok(
    fs.existsSync(path.join(racine, fichier)),
    `${fichier} est recensé mais n’existe plus : retirez-le de RECENSES.`,
  )
  assert.ok(
    porteurs.has(fichier),
    `${fichier} est recensé mais ne porte plus aucun tableau JSX.\n` +
      'C’est une bonne nouvelle : retirez-le de RECENSES pour qu’il ne puisse plus en reprendre un.',
  )
}

// --- 3. le HTML d'impression n'est pas concerné, et on le prouve -------------
//
// Sans ce contrôle, quelqu'un « corrigerait » un jour le test en scrutant le
// texte brut, et il tomberait sur les gabarits d'impression. Ces deux
// assertions disent noir sur blanc pourquoi ils sont hors sujet : `pdf.ts`
// n'est pas un `.tsx` et ne peut pas contenir de JSX ; les `<table>` de
// `Planning.tsx` en accents graves ne sont pas comptés par l'arbre.

{
  const pdf = fs.readFileSync(path.join(racine, 'src/pdf.ts'), 'utf8')
  assert.ok(
    (pdf.match(/<table/g) || []).length >= 7,
    'src/pdf.ts a cessé de produire du HTML d’impression : le commentaire ci-dessus est à revoir.',
  )
  assert.ok(!fichiers.includes('src/pdf.ts'), 'src/pdf.ts n’est pas un .tsx : hors périmètre par construction.')

  const planning = fs.readFileSync(path.join(racine, 'src/modules/Planning.tsx'), 'utf8')
  const brutes = (planning.match(/<table/g) || []).length
  const montees = porteurs.get('src/modules/Planning.tsx').length
  assert.ok(
    brutes > montees,
    'Planning.tsx : le compte brut devrait dépasser le compte JSX (ses gabarits d’impression).\n' +
      'S’ils sont égaux, l’arbre compte des chaînes — le test ne vaut plus rien.',
  )
}

const total = [...porteurs.values()].reduce((n, l) => n + l.length, 0)
console.log(
  `Tableaux : ${fichiers.length} fichiers .tsx analysés par le compilateur, ${porteurs.size} porteurs recensés ` +
    `(${total} tableaux montés), aucun ailleurs ; les gabarits d’impression de pdf.ts et Planning.tsx ` +
    'restent hors périmètre, et le test le vérifie au lieu de le supposer.',
)
