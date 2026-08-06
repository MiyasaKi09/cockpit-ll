// Audit d'usage, action 8 (constat S2) — la pénalité n'est pas payée deux fois.
//
// LE MODE DE PANNE QUE CE TEST FERME
// ------------------------------------
// Deux moitiés justes qui, mises bout à bout, faisaient une facture fausse :
//
//   · `certificat.ts` déduit AUTOMATIQUEMENT les pénalités appliquées du
//     prochain état d'acompte (ligne D) ;
//   · l'écran de décision (`ProjetChantier.tsx`, carte « Pénalités de
//     marché ») disait à l'humain de la « reporter à la main » sur la
//     situation de l'entreprise.
//
// Suivre la consigne affichée revenait donc à retirer la pénalité DEUX fois
// à l'entreprise : une fois à la main sur la situation, une fois par le
// certificat. Une pénalité de 500 € en coûtait 1 000 au titulaire, sur un
// document contractuel signé, adressé à un maître d'ouvrage public. Et rien
// dans l'application ne le signalait : les deux moitiés sont chacune
// cohérente avec elle-même.
//
// C'est pourquoi ce test ATTACHE le texte de l'écran au comportement du
// moteur. Ce ne sont pas deux vérifications, c'en est une : tant que le
// certificat déduit tout seul, l'écran doit dire de ne pas déduire ailleurs.
// Si un jour le moteur cessait de déduire, la partie « fonctionnelle » ci-
// dessous tomberait la première, et c'est le message qu'il faudrait alors
// réécrire — dans ce sens-là, jamais l'inverse.

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

const C = charger('src/certificat.ts')

// --- 1. la PRÉMISSE du message : le certificat déduit tout seul -------------
//
// Un marché de 40 000 €, une situation du mois, et UNE absence à réunion de
// chantier dont la pénalité de 500 € a été appliquée par un humain (décidée,
// datée, signée). Personne ne touche à la situation : le certificat retire
// les 500 € de lui-même.

const etat = () => ({
  settings: { nomAgence: 'Agence LL', personnes: ['Julien', 'Zoé'] },
  projets: [{ id: 'P-01', nom: 'Groupe scolaire', moa: 'Ville de Beauvais', phases: [] }],
  marches: [
    {
      id: 'M-01',
      projetId: 'P-01',
      entreprise: 'Martin BTP',
      lot: 'Lot 03 — Charpente',
      montantInitialHT: 40000,
      avenantsHT: 0,
      tauxRG: 0.05,
      garantie: 'retenue',
      revision: false,
      penalites: { retardParJourHT: 200, absenceReunionHT: 500, documentRetardParJourHT: 100 },
      delaiVerifJours: 15,
      actif: true,
    },
  ],
  situations: [
    {
      id: 'sit-1',
      projetId: 'P-01',
      marcheId: 'M-01',
      entreprise: 'Martin BTP',
      mois: '2026-06',
      numero: 1,
      montantMoisHT: null,
      montantCumulHT: 20000,
      revisionHT: null,
      statut: 'validee',
      dateReception: '2026-07-02',
    },
  ],
  indicesBTP: [],
  evenementsMarche: [
    {
      id: 'ev-1',
      marcheId: 'M-01',
      projetId: 'P-01',
      type: 'absence_reunion',
      date: '2026-06-12',
      commentaire: 'absence CR n° 7',
      penaliteAppliquee: true,
      penaliteMontantHT: 500,
      decidePar: 'Julien',
      decideLe: '2026-06-13',
    },
  ],
  certificats: [],
})

{
  const sansPenalite = etat()
  sansPenalite.evenementsMarche = []
  const nu = C.construireCertificat(sansPenalite, 'sit-1')
  const avec = C.construireCertificat(etat(), 'sit-1')

  assert.equal(
    avec.proposition.penalitesHT,
    500,
    'la pénalité APPLIQUÉE entre seule dans le certificat : aucun geste humain supplémentaire n’est attendu',
  )
  assert.equal(
    Math.round((nu.proposition.netAPayerTTC - avec.proposition.netAPayerTTC) * 100) / 100,
    500,
    'le net à payer baisse EXACTEMENT une fois de 500 € — c’est ce fait qui rend fausse toute consigne de report manuel',
  )

  // ce que coûtait la consigne d'avant : l'humain retirait 500 € du cumul de
  // la situation ET le certificat en retirait 500 de plus
  const doublement = etat()
  doublement.situations[0].montantCumulHT = 19500 // « report à la main » sur la situation
  const deuxFois = C.construireCertificat(doublement, 'sit-1')
  assert.equal(
    Math.round((nu.proposition.netAPayerTTC - deuxFois.proposition.netAPayerTTC) * 100) / 100,
    1070,
    'en suivant l’ancienne consigne, l’entreprise perdait 1 070 € pour une pénalité de 500 : 570 par le report à la main (600 TTC de cumul en moins, dont 30 de RG qui suit) PLUS les 500 que le certificat déduit tout seul',
  )
}

// --- 2. le TEXTE de l'écran, aux trois endroits où la pénalité se dit -------

const chantier = lire('src/modules/ProjetChantier.tsx')

/**
 * Ce que la personne LIT, et rien d'autre.
 *
 * Le compilateur, pas une expression régulière sur le fichier — pour la
 * raison qui a déjà servi à `test-tableaux.cjs`, et qui se vérifie ici de
 * façon amusante : le commentaire qui documente cette correction contient
 * lui-même les mots « report à la main ». Une recherche sur le texte brut
 * échouerait donc à l'instant de son écriture, on la relâcherait, et elle ne
 * protégerait plus rien. L'arbre, lui, distingue une phrase affichée d'une
 * phrase expliquée.
 */
function textesAffiches(chemin) {
  const sf = ts.createSourceFile(chemin, lire(chemin), ts.ScriptTarget.ES2022, true)
  const sortie = []
  const parcourir = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) sortie.push(n.text)
    else if (ts.isTemplateExpression(n)) {
      sortie.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text))
    } else if (ts.isJsxText(n)) sortie.push(n.text)
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)
  // les fragments se recollent : une phrase coupée par une interpolation ne
  // doit pas échapper au contrôle par le seul fait de sa coupure
  return sortie.join(' • ')
}

const affiche = textesAffiches('src/modules/ProjetChantier.tsx')

// Le contrôle se fait PHRASE PAR PHRASE, et non sur le texte entier — parce
// que la bonne formulation et la mauvaise emploient les mêmes mots. « ne la
// déduisez pas aussi de la situation » et « déduisez-la de la situation »
// diffèrent d'une négation, pas d'un vocabulaire. Un motif interdit dans une
// phrase NIÉE est un motif tenu ; c'est dans une phrase affirmative qu'il
// rouvre le défaut.
const CONSIGNES_INTERDITES = [
  [/report(er|ez|é)?\s+(à|a)\s+la\s+main/i, '« report à la main » : c’est la phrase exacte qui faisait payer deux fois'],
  [/(déduire|déduis|déduisez|retirez|retirer|reporter|reportez|report)[^•]{0,60}?\b(de|sur|dans)\s+(la|cette|sa)\s+situation/i, 'demander de reporter ou de déduire la pénalité sur la situation double la déduction du certificat'],
]
const NEGATIONS = /\bne\b|\bn['’]|\bpas\b|\bjamais\b|\bsans\b/i

const phrases = affiche.split(/[.!?•\n]+/)
for (const [motif, pourquoi] of CONSIGNES_INTERDITES) {
  const fautives = phrases.filter((p) => motif.test(p) && !NEGATIONS.test(p)).map((p) => p.trim())
  assert.deepEqual(
    fautives,
    [],
    `${pourquoi} — or le certificat (ligne D) déduit DÉJÀ, tout seul :\n  « ${fautives.join(' » / « ')} »`,
  )
}

// La confirmation, le toast de succès et la note sous le journal : chacun des
// trois doit dire la même chose, parce que chacun des trois est lu seul.
{
  const confirmation = chantier.match(/Appliquer la pénalité de[\s\S]{0,700}?confirmerLabel/)
  assert.ok(confirmation, 'la confirmation avant application doit exister (une pénalité est un acte contractuel)')
  assert.match(
    confirmation[0],
    /ligne D/,
    'la confirmation doit nommer la ligne D du certificat : c’est là que la déduction se produira',
  )
  assert.match(
    confirmation[0],
    /ne la déduisez pas aussi de la situation/i,
    'la confirmation doit interdire explicitement la seconde déduction — c’est le geste que l’ancienne consigne réclamait',
  )

  const toast = chantier.match(/toast\(\s*\n?\s*'Pénalité appliquée[\s\S]{0,300}?\)/)
  assert.ok(toast, 'un toast confirme l’application (patron du dépôt : chaque geste se dit)')
  assert.match(
    toast[0],
    /ligne D/,
    'le toast aussi dit où la déduction aura lieu : c’est souvent la seule phrase relue',
  )

  const note = chantier.match(/Une pénalité appliquée est proposée en déduction[\s\S]{0,300}?<\/p>/)
  assert.ok(note, 'le journal des pénalités porte une note permanente sous le tableau')
  assert.match(
    note[0],
    /une seule fois/i,
    'la note dit « une seule fois » — la règle tient en trois mots et doit rester lisible sans ouvrir de modale',
  )
}

// --- 3. et la déduction reste unique d'un état à l'autre --------------------
//
// Le pendant côté moteur : une pénalité déjà déduite par un certificat ÉMIS
// ne revient pas sur le suivant. Sans cette garde, l'écran aurait beau dire
// la vérité, l'entreprise paierait quand même deux fois — au mois d'après.

{
  const suite = etat()
  suite.certificats = [
    {
      id: 'cert-1',
      marcheId: 'M-01',
      projetId: 'P-01',
      situationId: 'sit-0',
      numero: 1,
      mois: '2026-05',
      entete: {},
      lignes: { cumulHT: 10000, penalitesHT: 500 },
      netAPayerTTC: 0,
      emisLe: '2026-06-10',
      emisPar: 'Julien',
    },
  ]
  const c = C.construireCertificat(suite, 'sit-1')
  assert.equal(
    c.proposition.penalitesHT,
    0,
    'une pénalité déduite sur l’état précédent ne se re-déduit pas : le mois suivant est l’autre chemin vers la double peine',
  )
}

console.log(
  'Double pénalité : le certificat déduit seul (500 € une fois, 1 070 si l’on suit l’ancienne consigne), ' +
    'les trois messages de l’écran nomment la ligne D et interdisent la seconde déduction, ' +
    'et un état émis ne re-déduit jamais ce qu’il a déjà retenu.',
)
