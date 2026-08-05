// 5.18 — les indices INSEE : historique complet, récupération automatique.
//
// L'agence a annulé la décision « geste volontaire » de 5.4 : « un stockage
// des données historiques des indices pour que l'appli pioche comme elle veut
// dedans » et « une récupération automatique et non pas volontaire ».
//
// CE QUE CE TEST GARDE, ET POURQUOI
// -----------------------------------
// 1. Le parse lit le CODE dans le TITRE de la série — jamais dans une table
//    idbank→code écrite de mémoire. La raison est un fait vécu : l'idbank
//    « de mémoire » essayé le 04/08 pointait sur un indice d'ÉLECTRICITÉ.
//    Une révision calculée sur le mauvais indice est fausse en silence,
//    pendant des années, sur des documents contractuels.
// 2. L'INSEE écrase la saisie manuelle du même mois — la saisie n'était que
//    l'attente de la publication.
// 3. L'anti-marteau 24 h est une fonction pure, donc sabotable ici.
// 4. Le branchement racine ne bloque jamais le démarrage (M.1).

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

const I = charger('src/indicesInsee.ts')

// --- l'échantillon : la FORME RÉELLE du flux, piège compris -----------------
//
// Trois séries : BT01 (mois décroissants, comme le vrai flux), TP01, et le
// vrai piège rencontré — l'indice d'ÉLECTRICITÉ, sans code BT/TP dans son
// titre, qui doit être ignoré sans erreur. Le titre de TP01 emploie le tiret
// cadratin « – » : les deux variantes coexistent dans le flux réel.

const XML = `<?xml version='1.0' encoding='UTF-8'?><message:StructureSpecificData>
<message:DataSet>
<Series IDBANK="001710986" TITLE_FR="Index du bâtiment - BT01 - Tous corps d'état - Base 2010" FREQ="M">
<Obs TIME_PERIOD="2026-05" OBS_VALUE="137.9"/>
<Obs TIME_PERIOD="2026-04" OBS_VALUE="137.4"/>
<Obs TIME_PERIOD="2026-03" OBS_VALUE="137.1"/>
</Series>
<Series IDBANK="001711007" TITLE_FR="Index Travaux Publics – TP01 – Index g&#xE9;n&#xE9;ral tous travaux – Base 2010" FREQ="M">
<Obs TIME_PERIOD="2026-05" OBS_VALUE="140.4"/>
<Obs TIME_PERIOD="2026-04" OBS_VALUE="0"/>
</Series>
<Series IDBANK="010534766" TITLE_FR="Indice de prix de production de l'industrie française pour le marché français − CPF 35.11 − Électricité vendue" FREQ="M">
<Obs TIME_PERIOD="2026-05" OBS_VALUE="209.5"/>
</Series>
</message:DataSet>
</message:StructureSpecificData>`

// --- 1. le parse : le titre fait foi ---------------------------------------

{
  const series = I.parseSeriesSdmx(XML)
  assert.equal(series.length, 3, 'les trois séries sont lues')

  const bt01 = series.find((s) => s.idbank === '001710986')
  assert.equal(bt01.code, 'BT01', 'le code se lit dans le TITRE')
  assert.deepEqual(
    bt01.observations,
    [
      { mois: '2026-03', valeur: 137.1 },
      { mois: '2026-04', valeur: 137.4 },
      { mois: '2026-05', valeur: 137.9 },
    ],
    'le flux publie décroissant, le module rend CROISSANT — l’ordre que valeursSerie attend',
  )

  const tp01 = series.find((s) => s.idbank === '001711007')
  assert.equal(tp01.code, 'TP01', 'le tiret cadratin du flux réel est accepté')
  assert.equal(tp01.titre.includes('général'), true, 'les entités numériques (&#xE9;) sont décodées')
  assert.equal(tp01.observations.length, 1, 'une valeur à 0 n’est pas un indice — écartée comme dans valeursSerie')

  const elec = series.find((s) => s.idbank === '010534766')
  assert.equal(
    elec.code,
    null,
    'l’indice d’ÉLECTRICITÉ n’a pas de code BT/TP : code null, jamais une erreur.\n' +
      'C’est le vrai piège du 04/08 — un idbank « de mémoire » pointait sur cette série.',
  )

  assert.deepEqual(I.parseSeriesSdmx(''), [], 'un flux vide rend une liste vide, pas une exception')
}

// --- 2. les codes voulus ----------------------------------------------------

{
  const codes = I.codesVoulus(
    [{ indiceRevision: ' bt02 ' }, { indiceRevision: null }],
    [{ id: 'x', indice: 'TP01', mois: '2026-01', valeur: 139 }],
  )
  assert.deepEqual(
    codes,
    ['BT01', 'BT02', 'TP01'],
    'marchés ∪ existants ∪ BT01 toujours — l’index de référence sert avant même le premier marché révisable',
  )
}

// --- 3. la fusion : l'INSEE est la source ----------------------------------

{
  const existants = [
    // saisie manuelle en ATTENTE de publication : une valeur estimée
    { id: 'm1', indice: 'BT01', mois: '2026-05', valeur: 137.0 },
    { id: 'm2', indice: 'BT01', mois: '2026-02', valeur: 136.8 },
  ]
  const series = I.parseSeriesSdmx(XML)
  const fusion = I.fusionnerIndices(existants, series, ['BT01'])

  const bt0526 = fusion.indices.filter((i) => i.indice === 'BT01' && i.mois === '2026-05')
  assert.equal(bt0526.length, 1, 'pas de doublon de mois')
  assert.equal(
    bt0526[0].valeur,
    137.9,
    'la valeur INSEE ÉCRASE la saisie manuelle du même mois — la saisie n’était que l’attente',
  )
  assert.equal(fusion.remplaces.BT01, 1)
  // le flux porte 03, 04, 05 ; 05 existait (remplacé), 02 est manuel hors
  // flux (conservé) — donc DEUX mois ajoutés, comptés à la main
  assert.equal(fusion.ajoutes.BT01, 2, 'l’historique s’ajoute en entier : 2026-03 et 2026-04')
  assert.ok(fusion.indices.some((i) => i.indice === 'BT01' && i.mois === '2026-02'), 'la saisie hors flux reste')

  assert.equal(
    fusion.indices.some((i) => i.indice === 'TP01'),
    false,
    'série hors codesVoulus : ignorée — le flux en porte 84, l’agence en suit quelques-unes',
  )

  // même flux rejoué ⇒ rien ne change : c'est ce qui permet au réveil
  // quotidien de se taire quand il n'y a rien de nouveau
  const rejoue = I.fusionnerIndices(fusion.indices, series, ['BT01'])
  assert.deepEqual(rejoue.ajoutes, {}, 'rejouer le même flux n’ajoute rien')
  assert.deepEqual(rejoue.remplaces, {}, 'ni ne remplace')
  assert.equal(I.messageMajIndices(rejoue.ajoutes, rejoue.remplaces), null, 'rien de nouveau ⇒ PAS UN MOT')

  const idsInsee = fusion.indices.filter((i) => i.id.startsWith('idx-insee-'))
  assert.ok(idsInsee.length >= 2, 'identifiants déterministes : deux postes écrivent les MÊMES lignes')
}

// --- 4. l'anti-marteau 24 h -------------------------------------------------

{
  const T = '2026-08-05T10:00:00.000Z'
  assert.equal(I.doitRafraichirIndices(null, T), true, 'jamais récupéré ⇒ oui')
  assert.equal(I.doitRafraichirIndices('2026-08-05T02:00:00.000Z', T), false, 'il y a 8 h ⇒ non')
  assert.equal(I.doitRafraichirIndices('2026-08-04T09:00:00.000Z', T), true, 'il y a 25 h ⇒ oui')
  assert.equal(
    I.doitRafraichirIndices('2026-08-09T10:00:00.000Z', T),
    true,
    'horodatage FUTUR de plus de 24 h = horloge déréglée d’un poste : le respecter bloquerait à jamais',
  )
}

// --- 5. la péremption d'une série -------------------------------------------

{
  const indices = [{ id: 'a', indice: 'BT01', mois: '2026-01', valeur: 137 }]
  assert.deepEqual(I.serieEnRetard(indices, 'BT01', '2026-04'), { dernierMois: '2026-01', enRetard: false }, '3 mois : l’INSEE publie à ~3 mois, c’est normal')
  assert.deepEqual(I.serieEnRetard(indices, 'BT01', '2026-06'), { dernierMois: '2026-01', enRetard: true }, '5 mois : la récupération échoue, le badge doit le dire')
  assert.equal(I.serieEnRetard([], 'BT01', '2026-06').enRetard, true, 'aucune valeur = en retard aussi')
}

// --- 6. le branchement : automatique, jamais bloquant ----------------------

{
  const maj = lire('src/majIndices.ts')
  assert.match(maj, /setTimeout/, 'la tentative est DIFFÉRÉE : l’écran d’abord, le réseau ensuite')
  assert.match(maj, /console\.warn/, 'échec réseau ⇒ console, pas l’écran')
  assert.doesNotMatch(
    maj,
    /toast\([^)]*erreur/i,
    'JAMAIS de toast d’erreur au réveil automatique : une application locale qui affiche une erreur\n' +
      'réseau au démarrage ressemble à une panne — le manuel des Paramètres, lui, parle toujours',
  )
  assert.match(maj, /doitRafraichirIndices/, 'l’anti-marteau est consulté avant l’appel')

  const app = lire('src/App.tsx')
  assert.match(app, /useMajIndicesInsee\(state, update\)/, 'branché à la racine, comme la surveillance')

  const parametres = lire('src/modules/Parametres.tsx')
  assert.match(parametres, /rafraichirIndicesInsee/, 'le geste manuel reste possible — il cesse d’être nécessaire')
  assert.match(parametres, /indicesMajLe/, 'la date de dernière récupération se voit')

  const relais = lire('api/relais.js')
  assert.match(relais, /'bdm\.insee\.fr'/, 'le domaine INSEE est au relais')
  const listeBlanche = /DOMAINES_AUTORISES = new Set\(\[([\s\S]*?)\]\)/.exec(relais)[1]
  assert.ok(!/\*|\bhttp:/.test(listeBlanche), 'la liste blanche reste fermée : pas de joker, pas de http')

  const chantier = lire('src/modules/ProjetChantier.tsx')
  assert.match(chantier, /serieEnRetard/, 'le badge du chantier couvre aussi la série périmée')
}

console.log(
  'Indices INSEE : le code se lit dans le titre (l’électricité du 04/08 est ignorée sans erreur), ' +
    'historique complet fusionné avec l’INSEE en autorité, anti-marteau 24 h robuste aux horloges déréglées, ' +
    'récupération automatique différée et silencieuse sur échec — le geste manuel reste, il n’est plus nécessaire.',
)
