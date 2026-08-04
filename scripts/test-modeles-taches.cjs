// B.13 — les modèles de tâches (§12.1 pt 10, §19.1 pt 7, §8.4).
//
// Une mission de base MOE produit toujours à peu près les mêmes tâches.
// Les ressaisir à chaque projet est du travail perdu ; les générer sans
// rien demander est pire — l'agence se retrouve à défaire.
//
// Ce test tient la garantie du livrable : RIEN N'EST APPLIQUÉ EN SILENCE.
// L'aperçu et la création sont deux temps séparés, et une ligne non
// retenue ne produit rien du tout.

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

const M = charger('src/modelesTaches.ts')
const { PHASES_ORDRE } = charger('src/miqcp.ts')

const ctx = {
  projetId: 'P01',
  debutDePhase: { ESQ: '2026-09-01', APD: '2026-10-01' },
  responsable: 'Julien',
  coResponsable: 'Zoé',
}

const modele = {
  id: 'm1',
  nom: 'Essai',
  perimetre: 'test',
  lignes: [
    { id: 'a', libelle: 'Relevé', phase: 'ESQ', decalageJours: 2, role: 'responsable', priorite: 'haute', tempsEstime: 7 },
    { id: 'b', libelle: 'Avant OPR', phase: 'APD', decalageJours: -10, role: 'coResponsable', priorite: 'normale', tempsEstime: 3 },
    { id: 'c', libelle: 'Sans phase connue', phase: 'DET', decalageJours: 5, role: 'responsable', priorite: 'basse', tempsEstime: null },
  ],
}

// --- l'aperçu ne crée RIEN --------------------------------------------------

{
  const apercu = M.appliquerModele(modele, ctx)
  assert.equal(apercu.length, 3, 'toutes les lignes sont montrées, y compris celles qu’on ne retiendra pas')
  for (const l of apercu) {
    assert.equal(l.id, undefined, 'un aperçu n’a pas d’identifiant de tâche : rien n’a été créé')
    assert.equal(l.statut, undefined, 'ni de statut')
    assert.equal(l.source, undefined, 'ni de source')
  }
}

// --- les dates sont RELATIVES au début de phase ------------------------------

{
  const apercu = M.appliquerModele(modele, ctx)
  assert.equal(apercu[0].echeance, '2026-09-03', 'ESQ + 2 jours')
  assert.equal(apercu[1].echeance, '2026-09-21', 'APD − 10 jours : un décalage négatif recule')
  assert.equal(
    apercu[2].echeance,
    null,
    'phase dont le début est inconnu : pas de date inventée',
  )
  assert.equal(
    apercu[2].retenueParDefaut,
    false,
    'et la ligne est DÉCOCHÉE : la créer sans échéance la ferait tomber dans « sans date », ' +
      'où personne ne lui en donnerait jamais une. La montrer décochée dit qu’il manque quelque chose',
  )
  assert.ok(apercu[0].retenueParDefaut && apercu[1].retenueParDefaut)
}

// --- le rôle se résout à l'application, pas dans le modèle -------------------

{
  const apercu = M.appliquerModele(modele, ctx)
  assert.equal(apercu[0].responsable, 'Julien', 'le modèle nomme une PLACE, le projet dit qui l’occupe')
  assert.equal(apercu[1].responsable, 'Zoé')

  const source = lire('src/modelesTaches.ts')
  assert.doesNotMatch(
    source,
    /role: '(?!responsable|coResponsable|null)/,
    'un modèle ne nomme jamais quelqu’un : il survivrait à son départ et attribuerait des tâches ' +
      'à une personne qui n’est plus là',
  )
  for (const g of M.MODELES_AMORCE)
    for (const l of g.lignes)
      assert.ok(
        l.role === null || l.role === 'responsable' || l.role === 'coResponsable',
        `${g.nom} / ${l.libelle} : le rôle doit être une place, pas un nom`,
      )
}

// --- LA garantie : une ligne non retenue ne produit RIEN --------------------

{
  const apercu = M.appliquerModele(modele, ctx)
  const taches = M.tachesDepuisApercu(apercu, new Set(['a']), ctx, 'Julien')

  assert.equal(taches.length, 1, 'seules les lignes retenues fabriquent — pas une tâche annulée, pas une masquée : rien')
  assert.equal(taches[0].titre, 'Relevé')
  assert.equal(taches[0].projetId, 'P01')
  assert.equal(taches[0].echeance, '2026-09-03')
  assert.equal(taches[0].responsable, 'Julien')
  assert.equal(taches[0].createur, 'Julien')
  assert.equal(taches[0].tempsEstime, 7)
  assert.equal(
    taches[0].statut,
    'a_faire',
    'un modèle est un texte écrit par l’AGENCE, pas une proposition de machine : la tâche naît ' +
      '« à faire », et l’appliquer EST la qualification',
  )

  assert.equal(M.tachesDepuisApercu(apercu, new Set(), ctx, 'Julien').length, 0, 'rien coché, rien créé')
  assert.equal(M.tachesDepuisApercu(apercu, new Set(['a', 'b', 'c']), ctx, 'Julien').length, 3)
}

// --- les gabarits d'amorce sont utilisables tels quels ----------------------

{
  // livrable 5.9 : le gabarit « Année de parfait achèvement » rejoint les
  // deux d'origine — l'exigence passe de deux à trois, et le gabarit GPA
  // doit être PRÉSENT (c'est le support du registre des désordres)
  assert.equal(M.MODELES_AMORCE.length, 3, 'trois gabarits : MOE de base, chantier, et GPA (livrable 5.9)')
  assert.ok(
    M.MODELES_AMORCE.some((g) => g.id === 'modele-gpa'),
    'le gabarit « Année de parfait achèvement » fait partie de l’amorce (livrable 5.9)',
  )
  for (const g of M.MODELES_AMORCE) {
    assert.ok(g.nom && g.perimetre, `${g.id} : un modèle se choisit sur son nom ET son périmètre`)
    assert.ok(g.lignes.length > 0 && g.lignes.length <= 8,
      `${g.nom} : ${g.lignes.length} lignes. Un modèle de trente lignes se décoche au premier usage, ` +
        'puis on cesse de l’utiliser')
    for (const l of g.lignes) {
      assert.ok(l.libelle && l.id, 'chaque ligne a un libellé et un identifiant')
      assert.ok(
        l.phase === null || PHASES_ORDRE.includes(l.phase),
        `${g.nom} / ${l.libelle} : « ${l.phase} » n’est pas une phase de mission — la ligne n’aurait ` +
          'jamais de date, et resterait décochée pour toujours',
      )
    }
  }
}

// --- le module reste pur ----------------------------------------------------

{
  const source = lire('src/modelesTaches.ts')
  assert.doesNotMatch(source, /useStore|localStorage|fetch\(/, 'le module ne lit ni n’écrit l’état')
  assert.match(source, /creerTache\(/, 'la fabrique des 18 champs est celle de src/taches.ts')
}

console.log(
  'Modèles de tâches : aperçu séparé de la création, dates relatives au début de phase, ' +
    'rôles et non noms, et une ligne non retenue ne produit rien.',
)
