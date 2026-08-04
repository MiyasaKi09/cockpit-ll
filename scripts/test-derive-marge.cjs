// 5.14 — audit de la dérive de marge : la chaîne baseline → prévu → réel,
// recalculée À LA MAIN et vérifiée contre les fonctions réelles.
//
// Un calcul de marge qui dérive ne se voit pas à l'écran — il se voit au
// bilan, un an plus tard, quand plus rien n'est corrigeable. D'où cette
// recette : chaque cas est posé en commentaire avec son arithmétique
// complète, et l'assertion compare la fonction du dépôt au chiffre fait à
// la main. Si l'un des deux bouge, on sait lequel croire : la main.
//
// L'ÉCART RÉEL TROUVÉ PAR CET AUDIT (et corrigé avec lui)
// --------------------------------------------------------
// `margeFinale` (economie.ts) calculait sa « marge initiale » sur les
// heures prévues COURANTES — celles que « Recalculer la répartition »
// remplace. Or la baseline de 0.13 existe précisément parce que cette
// cible bouge : sur le cas du §1 ci-dessous, un recalcul qui porte la
// prévision de 500 h à 600 h faisait passer la dérive affichée de
// −5 500 € à −500 € — 5 000 € de dérive (100 h × 50 €/h de coût moyen)
// effacés par un geste d'écran qui n'est PAS un acte contractuel. La
// référence d'heures est désormais la baseline FIGÉE dès qu'elle existe.
// Les honoraires restent ceux d'aujourd'hui DES DEUX CÔTÉS : un avenant
// déplace la marge et sa référence ensemble (§4) — la dérive mesure
// l'exécution, pas la renégociation.
//
// Quatre cas au programme, ceux des retours du 03/08 :
//   1. baseline posée à la signature puis répartition recalculée en cours
//      de phase ;
//   2. coûts externes de phase : budget, réel, reste à faire — sans double
//      compte ;
//   3. temps non facturable : il COÛTE (il pèse sur la marge), il ne se
//      facture pas — deux questions différentes ;
//   4. avenant modifiant les honoraires.

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

const D = charger('src/derive.ts')
const E = charger('src/economie.ts')
const C = charger('src/contrats.ts')
const P = charger('src/pointages.ts')

// ---------------------------------------------------------------------------
// L'équipe de référence — coûts horaires choisis pour se calculer de tête :
//   Julien : 6 000 € × 12 × 1,5 de charges = 108 000 € / 1 800 h = 60 €/h
//   Zoé    : 4 000 € × 12 × 1,5            =  72 000 € / 1 800 h = 40 €/h
//   moyen  : 180 000 € / 3 600 h = 50 €/h
// ---------------------------------------------------------------------------

function etatBase() {
  return {
    settings: {
      equipe: [
        { id: 'p1', nom: 'Julien', remuMensuelle: 6000, modeRemu: 'brut', statut: 'dirigeant', coefCharges: 1.5, heuresAnnuelles: 1800, facturablePct: 0.6 },
        { id: 'p2', nom: 'Zoé', remuMensuelle: 4000, modeRemu: 'brut', statut: 'salarie', coefCharges: 1.5, heuresAnnuelles: 1800, facturablePct: 0.6 },
      ],
      coutHoraireRevient: 65, // fallback historique — ne doit PAS servir ici
      heuresParJour: 8,
      fraisGenerauxAnnuels: 0,
    },
    projets: [],
    contrats: [],
    factures: [],
    facturesAchat: [],
    temps: [],
    revisionsResteAFaire: [],
  }
}

assert.equal(D.coutHoraireDe(etatBase(), 'Julien'), 60)
assert.equal(D.coutHoraireDe(etatBase(), 'Zoé'), 40)
assert.equal(D.coutHoraireMoyen(etatBase()), 50)

// ---------------------------------------------------------------------------
// §1 — baseline posée à la signature, répartition RECALCULÉE en cours de phase
//
// Signé : 50 000 € HT d'honoraires, 500 h prévues (APD 200 + PRO 300),
// 5 000 € de budget externe sur l'APD. Baseline figée à la signature.
// Puis « Recalculer la répartition » porte les phases à 250 + 350 = 600 h.
// Réel à ce jour : Julien 100 h et Zoé 50 h sur l'APD ; 15 000 € facturés ;
// un achat BET de 2 000 € validé et payé, ventilé sur P1/APD.
//
// La main :
//   coût du temps      = 100×60 + 50×40                   =  8 000 €
//   marge à date       = 15 000 − 8 000 − 2 000           =  5 000 €
//   écart d'heures     : référence FIGÉE 500 h, réel 150 h → écart −350 h
//   dérive de PRÉVISION: 600 − 500                        =   +100 h
//   reste à faire      : APD max(0, 250−150) = 100 h ; PRO 350 h → 450 h
//                        externe restant APD : 5 000 − 2 000 = 3 000 €
//                        coût RAF = 450×50 + 3 000        = 25 500 €
//   coût final         = (8 000 + 2 000) + 25 500         = 35 500 €
//   marge finale       = 50 000 − 35 500                  = 14 500 €
//   marge initiale     = 50 000 − 500×50 − 5 000          = 20 000 €  (FIGÉE)
//   dérive             = 14 500 − 20 000                  = −5 500 €
//
// AVANT la correction de cet audit, la marge initiale se calculait sur les
// 600 h recalculées : 50 000 − 600×50 − 5 000 = 15 000 €, dérive −500 € —
// le recalcul effaçait 5 000 € de dérive.
// ---------------------------------------------------------------------------

function projetP1() {
  return {
    id: 'P1',
    nom: 'Maison B',
    typeMO: 'Particulier',
    statut: 'Signé',
    missionsComplHT: 0,
    phases: [
      { code: 'APD', pctBase: 0.4, montantHT: 20000, debut: null, fin: null, heuresPrevues: 250, coutExterneHT: 5000 },
      { code: 'PRO', pctBase: 0.6, montantHT: 30000, debut: null, fin: null, heuresPrevues: 350, coutExterneHT: 0 },
    ],
    // la prévision FIGÉE à la signature — celle que le recalcul ne touche pas
    baselineHeures: {
      le: '2026-01-10',
      par: 'Julien',
      origine: 'signature',
      honorairesBaseHT: 50000,
      parPhase: { APD: 200, PRO: 300 },
    },
  }
}

{
  const etat = etatBase()
  const p = projetP1()
  etat.projets = [p]
  etat.temps = [
    { id: 't1', semaine: '2026-03-02', personne: 'Julien', projetId: 'P1', phase: 'APD', heures: 100 },
    { id: 't2', semaine: '2026-03-09', personne: 'Zoé', projetId: 'P1', phase: 'APD', heures: 50 },
  ]
  etat.factures = [
    { id: 'F1', numero: '2026-001', type: 'facture', projetId: 'P1', phase: 'APD', libelle: 'APD', montantHT: 15000, tauxTVA: 0.2, emission: '2026-04-01', delaiJours: 30, statut: 'emise' },
  ]
  etat.facturesAchat = [
    {
      id: 'FA1', fournisseur: 'BET Bois', dateFacture: '2026-03-15', montantHT: 2000, montantTVA: 400, montantTTC: 2400,
      ventilations: [{ id: 'v1', montantHT: 2000, projetId: 'P1', phase: 'APD', categorie: 'BET' }],
      statut: 'validee', payeLe: '2026-04-02', paiementAConfirmer: false, source: 'manuel',
    },
  ]

  // le coût du temps valorise CHAQUE personne à SON coût, pas au coût moyen —
  // 150 h au moyen feraient 7 500 €, et 500 € de coût disparaîtraient
  assert.equal(D.coutReelTemps(etat, 'P1'), 8000, 'coût réel du temps : Σ heures × coût horaire DE LA personne (100×60 + 50×40)')
  assert.equal(D.heuresReelles(etat, 'P1'), 150)
  assert.equal(D.heuresPrevues(p), 600)
  assert.equal(D.heuresBaseline(p), 500)

  const ecart = D.ecartHeures(etat, p)
  assert.equal(ecart.reference, 500, 'l\'écart prévu/réel se mesure sur la prévision FIGÉE — mesuré sur la courante, il repart de zéro à chaque recalcul')
  assert.equal(ecart.ecart, -350)
  assert.equal(ecart.surBaseline, true)
  assert.equal(ecart.derivePrevision, 100, 'la dérive de prévision dit de combien la répartition courante s\'est éloignée de la signature')
  const ecartAPD = D.ecartHeures(etat, p, 'APD')
  assert.equal(ecartAPD.baseline, 200)
  assert.equal(ecartAPD.ecart, -50)
  assert.equal(ecartAPD.derivePrevision, 50)

  const md = E.margeADate(etat, 'P1')
  assert.equal(md.marge, 5000, 'marge à date = facturé − temps réel − achats validés (15 000 − 8 000 − 2 000)')

  const rf = E.resteAFaireProjet(etat, p)
  assert.equal(rf.heures, 450)
  assert.equal(rf.coutExterne, 3000, 'l\'externe restant déduit les achats déjà ventilés sur la phase (5 000 − 2 000)')
  assert.equal(rf.cout, 25500)

  const mf = E.margeFinale(etat, p)
  assert.equal(mf.coutFinal, 35500)
  assert.equal(mf.marge, 14500)
  assert.equal(
    mf.margeInitiale,
    20000,
    'écart 5.14 : la marge initiale doit se calculer sur la prévision FIGÉE (500 h), pas sur la répartition recalculée (600 h) — sinon « Recalculer la répartition » efface 5 000 € de dérive sans trace',
  )
  assert.equal(mf.derive, -5500, 'dérive de marge = finale − initiale figée : −5 500 €, pas les −500 € que le recalcul laissait voir')
}

// ---------------------------------------------------------------------------
// §2 — coûts externes de phase : les cinq états, sans double compte
//
// Même projet. Budget externe 5 000 € (phases, pas de contrat), un achat
// validé et payé de 2 000 € ventilé P1/APD.
// La main : budget 5 000 · engagé 0 · facturé 2 000 · payé 2 000 ·
// final prévu = 2 000 (réel) + 3 000 (restant) = 5 000 = budget. Si le
// restant ne déduisait pas l'achat ventilé, le final « prévu » monterait à
// 7 000 € pour un budget tenu — 2 000 € de coût comptés deux fois.
// ---------------------------------------------------------------------------

{
  const etat = etatBase()
  const p = projetP1()
  etat.projets = [p]
  etat.temps = [
    { id: 't1', semaine: '2026-03-02', personne: 'Julien', projetId: 'P1', phase: 'APD', heures: 100 },
    { id: 't2', semaine: '2026-03-09', personne: 'Zoé', projetId: 'P1', phase: 'APD', heures: 50 },
  ]
  etat.facturesAchat = [
    {
      id: 'FA1', fournisseur: 'BET Bois', dateFacture: '2026-03-15', montantHT: 2000, montantTVA: 400, montantTTC: 2400,
      ventilations: [{ id: 'v1', montantHT: 2000, projetId: 'P1', phase: 'APD', categorie: 'BET' }],
      statut: 'validee', payeLe: '2026-04-02', paiementAConfirmer: false, source: 'manuel',
    },
  ]
  const cinq = E.cinqEtatsExterne(etat, p)
  assert.deepEqual(
    cinq,
    { budget: 5000, engage: 0, facture: 2000, paye: 2000, finalPrevu: 5000 },
    'cinq états des coûts externes : final prévu = réel + restant = budget tenu, l\'achat ventilé sur la phase n\'est pas compté deux fois',
  )
}

// ---------------------------------------------------------------------------
// §3 — temps non facturable : il coûte, il ne se facture pas
//
// Journée de Julien sur P1/APD : 480 min de conception facturables + 120 min
// de déplacement non facturables. La main :
//   projection hebdo : 600 min = 10 h — le déplacement Y EST, car il a
//     coûté 2 h de Julien ; l'exclure embellirait la marge de 2×60 = 120 €
//   coût réel : 10 × 60 = 600 €
//   minutes facturables : 480 — la distinction EXISTE, elle sert à la part
//     facturable, pas à faire disparaître un coût
// ---------------------------------------------------------------------------

{
  const base = { personne: 'Julien', projetId: 'P1', phase: 'APD', tacheId: null, activite: 'conception', commentaire: '', validee: false, source: 'saisie', creeLe: '2026-03-02T18:00:00.000Z', majLe: '2026-03-02T18:00:00.000Z' }
  const pointages = [
    { ...base, id: 'pt1', debut: '2026-03-02T08:00:00.000Z', fin: '2026-03-02T16:00:00.000Z', minutes: 480, facturable: true },
    { ...base, id: 'pt2', debut: '2026-03-02T16:00:00.000Z', fin: '2026-03-02T18:00:00.000Z', minutes: 120, facturable: false, activite: 'deplacement' },
  ]
  const lignes = P.projeterVersTemps(pointages)
  assert.equal(lignes.length, 1)
  assert.equal(
    lignes[0].heures,
    10,
    'le temps non facturable reste dans la projection : il a coûté 2 h de Julien, et un coût qu\'on cache embellit la marge au lieu de la mesurer',
  )
  assert.equal(P.minutesFacturables(pointages), 480, 'la part facturable reste mesurable À CÔTÉ — c\'est une autre question que le coût')

  const etat = etatBase()
  etat.projets = [projetP1()]
  etat.temps = lignes
  assert.equal(D.coutReelTemps(etat, 'P1'), 600, 'le coût réel valorise les 10 h projetées, déplacement compris (10 × 60)')
}

// ---------------------------------------------------------------------------
// §4 — avenant modifiant les honoraires
//
// P2 : contrat signé 40 000 €, 400 h prévues (= baseline), aucun temps passé.
// La main, avant l'avenant :
//   marge finale   = 40 000 − 400×50 = 20 000 €
//   marge initiale = 40 000 − 400×50 = 20 000 €   → dérive 0
// Avenant « mission OPC » : +8 000 € d'honoraires, sans heures ajoutées.
//   marge finale   = 48 000 − 20 000 = 28 000 €
//   marge initiale = 48 000 − 20 000 = 28 000 €   → dérive 0
// L'avenant déplace la marge ET sa référence : la dérive mesure
// l'EXÉCUTION, pas la renégociation. Si l'avenant ajoute aussi des heures,
// c'est le geste « figer la référence » (origine 'revision') qui re-pose la
// baseline — jamais tout seul : tant qu'il n'est pas fait, les heures
// d'avenant se lisent en dérive, et c'est le comportement voulu (la
// référence ne bouge que par décision humaine).
// ---------------------------------------------------------------------------

{
  const etat = etatBase()
  const p2 = {
    id: 'P2',
    nom: 'École R',
    typeMO: 'Public',
    statut: 'Signé',
    missionsComplHT: 0,
    phases: [{ code: 'PRO', pctBase: 1, montantHT: 40000, debut: null, fin: null, heuresPrevues: 400 }],
    baselineHeures: { le: '2026-02-01', par: 'Zoé', origine: 'signature', honorairesBaseHT: 40000, parPhase: { PRO: 400 } },
  }
  etat.projets = [p2]
  const contrat = {
    id: 'C2', type: 'client', projetId: 'P2', intitule: 'MOE — École R', tiers: 'Commune',
    dateSignature: '2026-02-01', provisoire: false, avenants: [],
    lignes: [{ id: 'l1', nature: 'base', designation: 'Mission de base', quantite: 1, unite: 'forfait', prixUnitaireHT: 40000, etat: 'active' }],
  }
  etat.contrats = [contrat]

  const avant = E.margeFinale(etat, p2)
  assert.equal(avant.honorairesSignes, 40000)
  assert.equal(avant.marge, 20000)
  assert.equal(avant.derive, 0, 'sans temps passé ni recalcul, rien ne dérive')

  // l'avenant passe par la fonction RÉELLE : ligne ajoutée, jamais réécrite
  etat.contrats = [
    C.appliquerAvenant(
      contrat,
      { id: 'AV1', numero: 1, date: '2026-06-01', motif: 'Mission OPC ajoutée' },
      { ajouter: [{ nature: 'complementaire', designation: 'OPC', quantite: 1, unite: 'forfait', prixUnitaireHT: 8000, etat: 'active' }] },
    ),
  ]
  assert.equal(C.totalContratHT(etat.contrats[0]), 48000)

  const apres = E.margeFinale(etat, p2)
  assert.equal(apres.honorairesSignes, 48000, 'les honoraires signés suivent le contrat, avenant compris')
  assert.equal(apres.marge, 28000)
  assert.equal(apres.margeInitiale, 28000)
  assert.equal(
    apres.derive,
    0,
    'un avenant d\'honoraires sans travail ajouté ne doit pas se lire en dérive d\'exécution : il déplace la marge et sa référence ensemble',
  )
}

console.log(
  'Dérive de marge : marge initiale sur la prévision FIGÉE (le recalcul de répartition n\'efface plus 5 000 € de dérive), ' +
    'coût du temps par personne (8 000 € et pas 7 500 au coût moyen), externes sans double compte (final prévu = budget tenu), ' +
    'temps non facturable compté dans le coût et mesuré à part, avenant qui déplace la marge et sa référence ensemble.',
)
