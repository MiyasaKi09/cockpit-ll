// « Ouvrir dans Gmail », partout — critères 2, 3 et 10 du §22 (CDC §4.2).
//
// Trois exigences, une seule mécanique.
//
//   critère 10 : « une pièce jointe conserve le lien vers son e-mail » ;
//   critère  3 : « chaque message Cockpit peut être rouvert dans Gmail » ;
//   §4.2       : « chaque tâche, décision, document ou échéance issue d'un
//                 e-mail doit également conserver ce lien ».
//
// LA LEÇON DU LIVRABLE 0.6, ET POURQUOI CE TEST REND LE HTML.
// La première version du lien était vérifiée sur son STOCKAGE : la colonne
// `source_id` demandée au serveur, propagée jusqu'au registre. Tout cela
// pouvait rester vert avec un écran qui n'affichait rien — un lien rangé et
// jamais montré ne ramène personne à son e-mail. On rend donc réellement le
// composant (react-dom/server) et on lit le `<a>` produit, plutôt que de
// faire confiance à une expression régulière posée sur du JSX.
//
// L'INVARIANT QUI TIENT LE RESTE : un seul composant. Le lien existait déjà
// deux fois — sur la pièce jointe classée, et dans l'onglet « À rattacher »,
// avec deux libellés différents pour le même geste. Ce test refuse qu'un
// troisième naisse : hors de `src/ui.tsx`, aucun fichier ne prononce
// « Ouvrir dans Gmail ». C'est le pendant, côté rendu, de la règle que
// `test-oauth-lecture-seule.cjs` tient côté URL (un seul constructeur).

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

/** transpile puis exécute un module du dépôt, dépendances injectées à la main */
function charger(fichier, dependances = {}) {
  const compile = ts.transpileModule(lire(fichier), {
    fileName: fichier,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (id in dependances) return dependances[id]
    throw new Error(`Import runtime inattendu dans ${fichier} : ${id}`)
  })
  return mod.exports
}

/** le fichier, sans ses commentaires — pour ne chercher que dans le CODE */
function sansCommentaires(fichier) {
  return ts.transpileModule(lire(fichier), {
    fileName: fichier,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      removeComments: true,
    },
  }).outputText
}

function parcourir(dossier) {
  const res = []
  for (const e of fs.readdirSync(path.join(racine, dossier), { withFileTypes: true })) {
    const rel = `${dossier}/${e.name}`
    if (e.isDirectory()) res.push(...parcourir(rel))
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) res.push(rel)
  }
  return res
}

// ============================================================
// 1. La règle de lecture d'une source — `lienGmail` (src/util.ts)
// ============================================================

const util = charger('src/util.ts')
const { gmailMessageUrl, lienGmail } = util

const URL_ATTENDUE = 'https://mail.google.com/mail/u/0/#all/18f2a3b4c5d6e7f8'

assert.equal(
  gmailMessageUrl('18f2a3b4c5d6e7f8'),
  URL_ATTENDUE,
  'un identifiant Gmail valide doit produire un lien `#all/` — la pièce peut avoir été archivée',
)
for (const invalide of ['', '   ', 'abc', 'pas-un-id', 'zzzzzzzz', '18f2a3b4c5d6e7f8/../evil']) {
  assert.equal(
    gmailMessageUrl(invalide),
    null,
    `« ${invalide} » ne doit pas produire de lien : un lien mort est pire que pas de lien`,
  )
}

// Les QUATRE formes sous lesquelles le dépôt garde la trace d'un message.
// Elles viennent de quatre écritures différentes, et aucune ne se convertit
// en une autre : c'est `lienGmail` qui les réconcilie, une fois.
const formes = [
  ['18f2a3b4c5d6e7f8', 'identifiant nu — EntrantDistant.sourceMessageId, Communication.gmailMessageId'],
  ['gmail:18f2a3b4c5d6e7f8', 'préfixé — Courrier.source, écrit par src/surveillance.ts'],
  [URL_ATTENDUE, 'URL déjà construite — DocumentRecord.sourceUrl, NoteJournal.source'],
  ['  gmail:18f2a3b4c5d6e7f8  ', 'entourée d’espaces — une source recopiée à la main reste lisible'],
]
for (const [source, quoi] of formes)
  assert.equal(lienGmail(source), URL_ATTENDUE, `lienGmail doit lire la forme « ${quoi} »`)

// Et ce qui n'est pas un message n'en devient pas un. La moitié des
// `Courrier` du dépôt arrivent par une routine, sans identifiant : leur
// inventer un lien enverrait l'utilisateur sur une page Gmail vide.
for (const rien of [
  null,
  undefined,
  '',
  'routine tri du matin',
  'situations@agence-ll.fr',
  '/Drive/P03/00_ADMIN/mail.pdf',
  'gmail:',
  'gmail:pas-un-id',
])
  assert.equal(
    lienGmail(rien),
    null,
    `« ${rien} » ne désigne aucun message : lienGmail doit rendre null, pas un lien mort`,
  )

// Le préfixe est un contrat entre celui qui écrit et celui qui lit : le jour
// où `surveillance.ts` écrirait autre chose, TOUS les liens du Cockpit
// mourraient en silence, sans qu'aucun écran ne change d'apparence.
assert.match(
  lire('src/surveillance.ts'),
  /source: `gmail:\$\{m\.id\}`/,
  'src/surveillance.ts doit continuer d’écrire `gmail:<id>` dans Courrier.source — c’est ce que lienGmail sait lire',
)

// ============================================================
// 2. Le composant, RENDU — pas seulement présent dans le source
// ============================================================

const ui = charger('src/ui.tsx', {
  react: require('react'),
  'react/jsx-runtime': require('react/jsx-runtime'),
  './prompts': { copier: async () => true },
  './util': util,
  // A.8 : `AxesMessage` (kit UI) lit les libellés des trois axes du §5.2 dans
  // le référentiel fermé, plutôt que d'en recopier une seconde table
  './categorisation': charger('src/categorisation.ts', {
    './util': util,
    './miqcp': charger('src/miqcp.ts'),
  }),
})
const { LienGmail } = ui
assert.ok(LienGmail, 'src/ui.tsx doit exporter LienGmail — le seul « Ouvrir dans Gmail » du dépôt')

const rendu = (props) => renderToStaticMarkup(createElement(LienGmail, props))

for (const [source, quoi] of formes) {
  const html = rendu({ source })
  assert.match(html, /^<a /, `LienGmail doit rendre un lien pour « ${quoi} »`)
  assert.match(html, /href="https:\/\/mail\.google\.com\/mail\/u\/0\/#all\//, `href attendu pour « ${quoi} »`)
  assert.match(html, />Ouvrir dans Gmail</, `le libellé du §4.2 est littéral, pour « ${quoi} »`)
  assert.match(html, /target="_blank"/, 'le message s’ouvre à côté : le Cockpit ne remplace pas Gmail (§4.1)')
  assert.match(html, /rel="noreferrer"/, 'un lien en nouvel onglet sans rel="noreferrer" fuit la page d’origine')
}

// Sans identifiant, on ne se tait pas : une absence muette se lit « ce
// message n'existe plus », alors qu'il est dans Gmail — c'est le Cockpit
// qui ne sait pas lequel.
const sansSource = rendu({ source: 'routine tri du matin' })
assert.doesNotMatch(sansSource, /<a /, 'sans identifiant, aucun lien ne doit être rendu')
assert.match(
  sansSource,
  /non identifié/,
  'sans identifiant, l’écran doit DIRE que la source manque plutôt que de n’afficher rien',
)

// …sauf là où la mention serait du bruit (lignes de tableau, notes de
// journal écrites à la main) : `muet` ne rend rien du tout.
assert.equal(
  rendu({ source: 'routine tri du matin', muet: true }),
  '',
  '`muet` doit supprimer la mention, et elle seule — jamais le lien',
)
assert.match(
  rendu({ source: '18f2a3b4c5d6e7f8', muet: true }),
  />Ouvrir dans Gmail</,
  '`muet` ne doit jamais faire disparaître un lien qui existe',
)

// La variante « barre d'actions » reste un lien, avec l'apparence d'un bouton.
const bouton = rendu({ source: '18f2a3b4c5d6e7f8', bouton: true })
assert.match(bouton, /^<a /, '`bouton` change l’apparence, pas la nature : c’est un lien, pas un <button>')
assert.match(bouton, /class="btn btn-ghost btn-small"/, '`bouton` doit reprendre les classes du kit')
assert.match(
  lire('src/styles.css'),
  /a\.btn\s*\{[^}]*text-decoration:\s*none/,
  'src/styles.css doit dé-souligner a.btn, sinon le bouton d’action porte un soulignement de lien',
)

// ============================================================
// 3. Le lien est RENDU sur chaque surface qui affiche un message
// ============================================================
//
// Vérifié sur l'arbre syntaxique, pas par une expression régulière : ce
// qu'on veut savoir est « ce composant-là est-il monté dans cette
// fonction-là », question qu'une regex sur du JSX ne sait pas poser.

function fonction(fichier, nom) {
  const src = ts.createSourceFile(fichier, lire(fichier), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  let trouvee = null
  const visiter = (n) => {
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) && n.name && n.name.text === nom) trouvee = n
    ts.forEachChild(n, visiter)
  }
  visiter(src)
  assert.ok(trouvee, `${fichier} : la fonction ${nom} a disparu — la surface a été renommée ou supprimée`)
  return trouvee
}

function monte(noeud, composant) {
  let n = 0
  const visiter = (x) => {
    const tag = ts.isJsxSelfClosingElement(x) || ts.isJsxOpeningElement(x) ? x.tagName.getText() : null
    if (tag === composant) n++
    ts.forEachChild(x, visiter)
  }
  visiter(noeud)
  return n
}

const SURFACES = [
  ['src/modules/Cockpit.tsx', 'LigneCourrier', 'la file quotidienne : le premier écran où un mail s’affiche (critère 3)'],
  ['src/modules/Documents.tsx', 'CarteArriveesServeur', 'les pièces jointes captées : on classe d’après le message, pas d’après son nom de fichier'],
  ['src/modules/Documents.tsx', 'CarteMessagesARattacher', 'la file « à rattacher » côté table communications'],
  ['src/modules/Documents.tsx', 'CarteCourriersARattacher', 'la file « à rattacher » côté courriers locaux (seconde mémoire, jusqu’à B.15)'],
  ['src/modules/Documents.tsx', 'ModalDocument', 'la fiche d’une pièce classée (critère 10)'],
  ['src/modules/Documents.tsx', 'CarteTous', 'le registre : un document issu d’un mail garde son retour (§4.2)'],
  ['src/modules/ProjetJournal.tsx', 'ProjetJournal', 'la note archivée depuis un mail — elle en devient la seule trace'],
]
for (const [fichier, nom, pourquoi] of SURFACES)
  assert.ok(
    monte(fonction(fichier, nom), 'LienGmail') > 0,
    `${fichier} › ${nom} : plus aucun « Ouvrir dans Gmail » — ${pourquoi}`,
  )

// ============================================================
// 4. Un seul composant, un seul libellé
// ============================================================

const auteurs = parcourir('src').filter((f) => sansCommentaires(f).includes('Ouvrir dans Gmail'))
assert.deepEqual(
  auteurs,
  ['src/ui.tsx'],
  'seul src/ui.tsx écrit « Ouvrir dans Gmail » ; ailleurs, on monte <LienGmail/> — deux copies, c’est déjà deux libellés',
)

// ============================================================
// 5. Ce qui est STOCKÉ pour que le lien existe encore demain
// ============================================================
//
// Le rendu ne suffit pas : il n'a rien à afficher si la référence au message
// n'est ni demandée au serveur, ni propagée, ni conservée au classement.
// Aucun de ces trois oublis ne produit d'erreur.

const entrants = lire('src/entrants.ts')
const select = /\.select\(\s*'([^']+)'/.exec(entrants)
assert.ok(select, 'le select de listerEntrantsDistants doit rester lisible statiquement')
assert.ok(
  select[1].split(',').map((c) => c.trim()).includes('source_id'),
  'src/entrants.ts : `source_id` a disparu du select — la pièce jointe perdrait son lien Gmail',
)
assert.match(
  entrants,
  /sourceMessageId:\s*l\.source_id/,
  'src/entrants.ts : `source_id` doit être propagé dans EntrantDistant.sourceMessageId',
)

assert.match(
  lire('src/modules/Documents.tsx'),
  /sourceUrl:\s*lienGmail\(/,
  'src/modules/Documents.tsx : le document classé doit figer l’URL de son message d’origine',
)

// Le message indexé porte son lien dès la traduction de la ligne SQL —
// aucun écran n'a donc à connaître la forme d'un identifiant Gmail.
assert.match(
  lire('src/communications.ts'),
  /urlGmail:\s*gmailMessageUrl\(l\.gmail_message_id\)/,
  'src/communications.ts : chaque message doit porter son lien de réouverture (critère 3)',
)

// « → Journal » archive le mail ET le fait disparaître de la file : la note
// devient la seule trace. Sans la source, c'est une citation sans référence.
//
// Depuis A.7 la boîte a DEUX mémoires, donc deux chemins vers le journal :
// l'ancien `Courrier` et la `communication`. Les deux doivent porter la
// source — en oublier un ne casserait rien de visible, il produirait des
// notes orphelines sur la moitié des mails archivés.
const boite = fonction('src/modules/Cockpit.tsx', 'useBoiteATraiter').getText()
assert.match(
  boite,
  /source:\s*c\.source\b/,
  'src/modules/Cockpit.tsx : la note issue d’un ancien `Courrier` doit conserver sa source (§4.2)',
)
assert.match(
  boite,
  /source:\s*c\.gmailMessageId\b/,
  'src/modules/Cockpit.tsx : la note issue d’une `communication` doit conserver sa source, elle aussi (§4.2)',
)
assert.equal(
  (boite.match(/p\.journal\.push\(/g) || []).length,
  2,
  'exactement deux chemins écrivent dans le journal depuis la boîte : un par mémoire. ' +
    'Un troisième aurait échappé aux deux contrôles ci-dessus',
)
assert.match(
  lire('src/rattachement.ts'),
  /source:\s*c\.source/,
  'src/rattachement.ts : la file « à rattacher » doit porter la source du courrier, sinon son lien ne peut pas être rendu',
)

console.log(
  `Lien Gmail : ${formes.length} formes de source lues, ${SURFACES.length} surfaces d’affichage vérifiées ` +
    'sur l’arbre syntaxique, composant rendu en HTML, un seul libellé dans tout le dépôt, ' +
    'et les quatre écritures qui le rendent possible (colonne, propagation, URL figée, source de la note).',
)
