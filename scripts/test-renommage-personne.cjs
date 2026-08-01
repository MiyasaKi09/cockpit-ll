// Renommer une personne dans les Paramètres doit réécrire TOUTES les
// références qui la citent par son nom. Le risque couvert est silencieux :
// une référence oubliée ne produit aucune erreur, elle fait simplement
// disparaître des heures pointées du Pilotage et de la marge.
//
// Deux vérifications, et la seconde est la plus utile dans six mois :
//   1. le renommage ne laisse aucune occurrence de l'ancien nom ;
//   2. l'inventaire de src/personnes.ts n'a pas pris de retard sur
//      src/types.ts — toute nouvelle collection portant un nom de personne
//      doit y être ajoutée, sinon ce test échoue.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

// --- 1. l'inventaire suit-il les types ? ------------------------------------

const types = lire('src/types.ts')
const personnes = lire('src/personnes.ts')

// les champs qui, par convention du dépôt, portent un nom de personne
const CHAMPS_PERSONNE = ['personne', 'responsable', 'coResponsable', 'equipeProjet', 'pour']

/** interface -> champs de personne qu'elle déclare */
const parInterface = new Map()
let courante = null
for (const ligne of types.split('\n')) {
  const debut = /^export interface (\w+)/.exec(ligne)
  if (debut) {
    courante = debut[1]
    continue
  }
  if (!courante) continue
  const champ = /^ {2}(\w+)\??:/.exec(ligne)
  if (!champ || !CHAMPS_PERSONNE.includes(champ[1])) continue
  if (!parInterface.has(courante)) parInterface.set(courante, new Set())
  parInterface.get(courante).add(champ[1])
}

assert.ok(
  parInterface.size >= 8,
  `inventaire suspect : ${parInterface.size} interfaces portant un nom de personne, au moins 8 attendues`,
)

// chaque interface concernée doit être atteignable depuis src/personnes.ts.
// On ne vérifie pas le chemin exact — trop fragile — mais que le nom du champ
// et celui de l'interface apparaissent tous deux dans le module d'inventaire.
for (const [nomInterface, champs] of parInterface) {
  for (const champ of champs) {
    assert.match(
      personnes,
      new RegExp(`\\b${champ}\\b`),
      `src/types.ts déclare ${nomInterface}.${champ} (un nom de personne) mais src/personnes.ts ne le connaît pas : ` +
        `un renommage orphelinerait ces données en silence`,
    )
  }
}

// --- 2. le renommage est-il complet ? ---------------------------------------

const javascript = ts.transpileModule(personnes, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module_ = { exports: {} }
new Function('module', 'exports', 'require', javascript)(module_, module_.exports, require)
const { renommerPersonne, referencesDe, REFERENCES_PERSONNE } = module_.exports

const ANCIEN = 'Julien'
const NOUVEAU = 'Julien Martin'

const etat = () => ({
  settings: { personnes: [ANCIEN, 'Zoé'], equipe: [{ id: 'p1', nom: ANCIEN }] },
  temps: [
    { id: 't1', semaine: '2026-07-27', personne: ANCIEN, projetId: 'P1', phase: 'APD', heures: 7 },
    { id: 't2', semaine: '2026-07-27', personne: 'Zoé', projetId: 'P1', phase: 'APD', heures: 3 },
  ],
  tempsHorsProjet: [{ id: 'h1', semaine: '2026-07-27', personne: ANCIEN, categorie: 'Interne', heures: 2 }],
  absences: [{ id: 'a1', personne: ANCIEN, debut: '2026-08-01', fin: '2026-08-15' }],
  projets: [
    {
      id: 'P1',
      responsable: ANCIEN,
      coResponsable: 'Zoé',
      equipeProjet: [ANCIEN, 'Zoé'],
      // même valeur que registreDocuments[].auteur : ProjetJournal écrit le nom
      // choisi dans la note ET dans le document de la photo qu'elle porte
      journal: [
        { id: 'n1', date: '2026-07-28', auteur: ANCIEN, texte: 'visite', tags: [] },
        { id: 'n2', date: '2026-07-29', auteur: 'Zoé', texte: 'relance', tags: [] },
      ],
    },
    { id: 'P2', responsable: 'Zoé', coResponsable: ANCIEN, equipeProjet: ['Zoé'], journal: [] },
  ],
  registreDocuments: [{ id: 'doc1', auteur: ANCIEN, statut: 'classe' }],
  courriers: [{ id: 'c1', pour: ANCIEN }],
  situations: [{ id: 's1', pour: ANCIEN }],
  consultations: [
    { id: 'd1', pour: ANCIEN, exigences: [{ id: 'e1', responsable: ANCIEN }, { id: 'e2', responsable: 'Zoé' }] },
  ],
  decisionsDirection: [{ id: 'dd1', responsable: ANCIEN }],
  taches: [
    { id: 't1', responsable: ANCIEN, createur: 'Zoé', participants: ['Zoé'] },
    { id: 't2', responsable: 'Zoé', createur: ANCIEN, participants: [ANCIEN, 'Zoé'] },
  ],
})

const avant = etat()
const trouvees = referencesDe(avant, ANCIEN)

// L'assertion se mesure à l'INVENTAIRE, pas à un nombre écrit ici. Avec un
// seuil (« au moins 15 »), ajouter une seizième référence sans l'exercer
// dans le jeu d'essai laisse le test au vert : il valide alors à vide, et
// c'est exactement ce qui vient de se produire en ajoutant les tâches.
// L'égalité oblige le jeu d'essai à couvrir chaque site inventorié.
const manquants = REFERENCES_PERSONNE.map((r) => r.libelle).filter(
  (libelle) => !trouvees.some((t) => t.libelle === libelle),
)
assert.deepEqual(
  manquants,
  [],
  'le jeu d’essai n’exerce pas ces références : elles seraient déclarées correctes sans avoir été testées',
)
assert.equal(trouvees.length, REFERENCES_PERSONNE.length)

const apres = etat()
const reecrites = renommerPersonne(apres, ANCIEN, NOUVEAU)
assert.ok(
  reecrites >= REFERENCES_PERSONNE.length,
  `renommage incomplet : ${reecrites} références réécrites pour ${REFERENCES_PERSONNE.length} sites inventoriés`,
)

const restant = JSON.stringify(apres).split(`"${ANCIEN}"`).length - 1
assert.equal(restant, 0, `${restant} référence(s) à « ${ANCIEN} » ont survécu au renommage`)
assert.equal(referencesDe(apres, ANCIEN).length, 0, 'plus aucune référence ne doit citer l’ancien nom')

// les autres personnes ne bougent pas
assert.equal(apres.temps[1].personne, 'Zoé', 'renommer une personne ne doit pas toucher les autres')
assert.deepEqual(apres.projets[1].equipeProjet, ['Zoé'], 'les équipes sans la personne sont intactes')
assert.equal(apres.consultations[0].exigences[1].responsable, 'Zoé', 'les exigences des autres sont intactes')
assert.equal(apres.projets[0].journal[1].auteur, 'Zoé', 'les notes de journal des autres sont intactes')
// la note et le document que le même geste a produits doivent porter le même nom
assert.equal(
  apres.projets[0].journal[0].auteur,
  apres.registreDocuments[0].auteur,
  'la note de journal et le document de sa photo portent un seul et même auteur',
)

// --- 3. les garde-fous du renommage ----------------------------------------

const vide = etat()
assert.equal(renommerPersonne(vide, ANCIEN, '  '), 0, 'un nom vide ne doit rien réécrire')
assert.equal(vide.temps[0].personne, ANCIEN, 'un nom vide laisse les références intactes')

const identique = etat()
assert.equal(renommerPersonne(identique, ANCIEN, ANCIEN), 0, 'renommer à l’identique ne fait rien')

// renommer vers un nom déjà présent dans une équipe ne doit pas le dupliquer
const fusion = etat()
renommerPersonne(fusion, ANCIEN, 'Zoé')
assert.deepEqual(
  fusion.projets[0].equipeProjet,
  ['Zoé'],
  'une équipe ne doit jamais contenir deux fois la même personne après renommage',
)

console.log('Renommage d’une personne : inventaire à jour et réécriture complète.')
