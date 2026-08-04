// 5.11 — ordre d'appel des contacts du projet (retour d'usage du
// 03/08/2026, §12.1).
//
// Qui appeler en premier chez le client se savait de tête : `Contact`
// n'avait aucun champ d'ordre. Le rang est désormais un nombre (1 = à
// appeler d'abord), saisi dans la fiche projet, et la liste s'affiche triée.
//
// Trois choses tenues ici :
//
//   1. les non-classés (null, absent, illisible) vont en DERNIER — un
//      contact sans rang n'est pas le premier venu, et un rang inventé
//      ferait appeler la mauvaise personne ;
//   2. à rang égal, le NOM départage (plié : les accents ne font pas deux
//      alphabets) ; à rang ET nom égaux, l'ordre d'origine tient — un tri
//      instable ferait sauter les lignes à chaque rendu ;
//   3. la liste reçue n'est JAMAIS mutée : elle vient du store, la trier en
//      place réordonnerait l'état sans passer par update.

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

const { trierContactsAppel } = charger('src/organisations.ts')

const contact = (id, nom, ordreAppel) => ({ id, nom, ordreAppel })

// --- 1. le rang gouverne, les non-classés ferment la marche -----------------

{
  const tri = trierContactsAppel([
    contact('c3', 'Charles', 3),
    contact('c1', 'Alice', 1),
    contact('c2', 'Bruno', 2),
  ])
  assert.deepEqual(tri.map((c) => c.id), ['c1', 'c2', 'c3'], '1 s’appelle d’abord, puis 2, puis 3')
}

{
  // « AAA » sans rang ne double personne : l'alphabet ne bat pas le rang
  const tri = trierContactsAppel([
    contact('sans', 'AAA Assurances', null),
    contact('deux', 'Zoé', 2),
    contact('un', 'Yann', 1),
  ])
  assert.deepEqual(
    tri.map((c) => c.id),
    ['un', 'deux', 'sans'],
    'null va en DERNIER, même avec un nom en tête d’alphabet — un contact sans rang n’est pas le premier venu',
  )

  // absent et illisible (import JSON) valent null : en dernier, pas en tête
  const defensif = trierContactsAppel([
    { id: 'nan', nom: 'Broken', ordreAppel: NaN },
    { id: 'absent', nom: 'Sans champ' },
    contact('un', 'Alice', 1),
  ])
  assert.equal(defensif[0].id, 'un', 'un rang illisible (NaN, champ absent) vaut null : en fin de liste, jamais devant un rang saisi')
}

// --- 2. à rang égal le nom départage, à égalité totale le tri est stable ----

{
  const tri = trierContactsAppel([
    contact('z', 'Zoé', 1),
    contact('e', 'Émile', 1),
  ])
  assert.deepEqual(
    tri.map((c) => c.id),
    ['e', 'z'],
    'à rang égal, le nom départage — et « Émile » se plie en « emile » : les accents ne font pas deux alphabets',
  )

  // deux non-classés : le nom départage aussi (la fin de liste reste lisible)
  const nuls = trierContactsAppel([contact('b', 'Mairie', null), contact('a', 'Bureau de contrôle', null)])
  assert.deepEqual(nuls.map((c) => c.id), ['a', 'b'], 'les non-classés se rangent entre eux par nom')

  // à rang ET nom égaux : l'ordre d'origine tient (tri stable) — un tri
  // instable ferait sauter les lignes à chaque rendu
  const stable = trierContactsAppel([
    contact('premier', 'Dupont', 1),
    contact('second', 'Dupont', 1),
  ])
  assert.deepEqual(stable.map((c) => c.id), ['premier', 'second'], 'à égalité totale, l’ordre d’origine est conservé : le tri est STABLE')
}

// --- 3. la liste reçue n'est jamais mutée -----------------------------------

{
  const origine = [contact('c3', 'Charles', 3), contact('c1', 'Alice', 1)]
  const tri = trierContactsAppel(origine)
  assert.notEqual(tri, origine, 'le tri rend une NOUVELLE liste')
  assert.deepEqual(
    origine.map((c) => c.id),
    ['c3', 'c1'],
    'la liste reçue garde son ordre : elle vient du store, la trier en place réordonnerait l’état sans passer par update',
  )
  assert.deepEqual(tri.map((c) => c.id), ['c1', 'c3'])
}

// --- câblage : le champ est déclaré, l'écran trie et saisit le rang ---------

{
  const types = lire('src/types.ts')
  assert.match(types, /ordreAppel\?: number \| null/, 'Contact.ordreAppel est déclaré, optionnel : les contacts existants n’ont simplement pas de rang')

  const ecran = lire('src/modules/ProjetRessources.tsx')
  assert.match(
    ecran,
    /trierContactsAppel\(state\.contacts\.filter\(\(c\) => c\.projetsIds\?\.includes\(p\.id\)\)\)/,
    'la liste des contacts du projet passe par trierContactsAppel — l’écran ne redit pas la règle de tri',
  )
  assert.match(ecran, /x\.ordreAppel = v/, 'le rang se SAISIT dans la fiche projet (NumInput) : réordonner est un geste, pas une migration')
}

// --- le module de tri reste pur ---------------------------------------------

{
  const source = lire('src/organisations.ts')
  const fonction = /export function trierContactsAppel[\s\S]*?\n\}/.exec(source)
  assert.ok(fonction, 'trierContactsAppel vit dans src/organisations.ts (la logique CRM)')
  assert.doesNotMatch(fonction[0], /useStore|localStorage|fetch\(|Date\.now|todayISO/, 'le tri ne lit ni l’état ni l’horloge')
}

console.log(
  'Ordre d’appel : rang croissant (1 d’abord), non-classés et rangs illisibles en dernier, nom plié en ' +
    'départage, tri stable et sans mutation — et l’écran projet trie et saisit par la même fonction.',
)
