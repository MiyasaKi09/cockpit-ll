// Critère 10 du §22 : « une pièce jointe conserve le lien vers son e-mail ».
//
// Ce critère tient à trois détails qu'une réécriture de requête ou un
// nettoyage d'import fait disparaître sans bruit : la colonne `source_id`
// dans le `select` de l'index partagé, sa propagation jusqu'au registre
// documentaire, et le rendu du lien. Aucun de ces trois oublis ne produit
// d'erreur — la pièce se classe normalement, elle perd juste le chemin de
// retour vers l'échange qui l'explique.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

// --- 1. la colonne est demandée au serveur ----------------------------------

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

// --- 2. le lien est construit et stocké au classement -----------------------

const documents = lire('src/modules/Documents.tsx')
assert.match(
  documents,
  /sourceUrl:\s*gmailMessageUrl\(/,
  'src/modules/Documents.tsx : le document classé doit porter l’URL de son message d’origine',
)
assert.match(
  documents,
  /doc\.sourceUrl &&[\s\S]{0,400}Ouvrir dans Gmail/,
  'src/modules/Documents.tsx : le lien doit être RENDU — stocké sans être affiché, le critère 10 n’est pas satisfait',
)

// --- 3. la construction de l'URL elle-même ----------------------------------

const util = ts.transpileModule(lire('src/util.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', 'require', util)(mod, mod.exports, require)
const { gmailMessageUrl } = mod.exports

assert.equal(
  gmailMessageUrl('18f2a3b4c5d6e7f8'),
  'https://mail.google.com/mail/u/0/#all/18f2a3b4c5d6e7f8',
  'un identifiant Gmail valide doit produire un lien `#all/` — la pièce peut avoir été archivée',
)
for (const invalide of ['', '   ', 'abc', 'pas-un-id', 'zzzzzzzz', '18f2a3b4c5d6e7f8/../evil']) {
  assert.equal(
    gmailMessageUrl(invalide),
    null,
    `« ${invalide} » ne doit pas produire de lien : un lien mort est pire que pas de lien`,
  )
}

console.log('Lien Gmail des pièces jointes : colonne, propagation, rendu et URL vérifiés.')
