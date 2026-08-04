// Livrable 0.11 — les cinq blocs d'accueil du CDC §8.1.
//
// Le défaut couvert ne lève aucune erreur et ne s'affiche nulle part :
// c'est un chiffre juste sur un écran et faux sur l'autre. Les factures
// à émettre étaient construites DEUX FOIS — une boucle dans le Cockpit,
// une autre dans `financeActions.actionsATraiter` — sur les mêmes
// `echeancesFacturation`, avec deux libellés écrits séparément, deux
// liens et deux gravités qui coïncidaient à la main. Rien n'aurait
// signalé le jour où l'une des deux aurait bougé ; l'écart se serait
// découvert en réunion, une fois la facture oubliée.
//
// Ce que ce test verrouille :
//   1. l'accueil n'invente aucun calcul : `Cockpit.tsx` ne refiltre plus
//      les collections dont l'agrégation vit dans un module de calcul,
//      et les factures à émettre n'ont plus qu'un seul constructeur ;
//   2. les cinq blocs du §8.1 lisent bien une fonction de calcul —
//      validations attendues, réunions du jour, échéances à 14 jours,
//      temps enregistré, charge prévisionnelle ;
//   3. la recette de chacun, exécutée sur un état d'exemple ;
//   4. `evenements()` n'existe qu'une fois : sortie de Calendrier.tsx
//      vers derive.ts, elle est LUE par les deux écrans, pas recopiée ;
//   5. aucune balise <table> brute dans les écrans de l'accueil —
//      c'est `Table` qui porte le repli en cartes sous 700 px ;
//   6. le filtre par personne part de `useMoi()`, jamais du premier de
//      la liste.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

/** charge un module TypeScript pur (sans React ni DOM) pour l'exercer */
function charger(fichier, dependances = {}) {
  const compile = ts.transpileModule(lire(fichier), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (dependances[id]) return dependances[id]
    throw new Error(`Import runtime inattendu dans ${fichier} : ${id}`)
  })
  return mod.exports
}

const util = charger('src/util.ts')
const miqcp = charger('src/miqcp.ts')
const facture = charger('src/facture.ts', { './util': util })
// 5.9 — derive consomme la fin de GPA de src/gpa.ts (une seule formule)
const gpa = charger('src/gpa.ts', { './util': util })
const derive = charger('src/derive.ts', { './miqcp': miqcp, './facture': facture, './util': util, './gpa': gpa })
const achats = charger('src/achats.ts', { './util': util })
// `controlesCloture` traîne fflate et facturx derrière elle : la clôture
// n'est pas l'invariant testé ici, seules les familles d'actions le sont.
const financeActions = charger('src/financeActions.ts', {
  './achats': achats,
  './comptable': { controlesCloture: () => ({ bloquants: 0 }) },
  './util': util,
})

const { mondayOf, addDays } = util
const {
  actionsATraiter,
  badgeFinance,
} = financeActions
const {
  documentsATraiter,
  evenements,
  phasesEnCours,
  prochainesEcheances,
  reunionsDuJour,
  semaineParPersonne,
  situationsAVerifier,
  validationsAttendues,
} = derive

const cockpit = lire('src/modules/Cockpit.tsx')
const calendrier = lire('src/modules/Calendrier.tsx')
const app = lire('src/App.tsx')

// ==========================================================================
// 1. L'accueil n'invente aucun calcul
// ==========================================================================

// Chacune de ces collections a désormais son agrégateur dans derive.ts ou
// financeActions.ts. La citer depuis le Cockpit, c'est rouvrir la porte au
// second calcul — celui qui diverge sans que personne ne le voie.
const COLLECTIONS_INTERDITES = [
  ['echeancesFacturation', 'financeActions.actionsATraiter / derive.evenements'],
  ['facturesAchat', 'financeActions.actionsATraiter'],
  ['registreDocuments', 'derive.documentsATraiter'],
  ['obligations', 'derive.evenements'],
  ['contacts', 'derive.evenements'],
  ['artisans', 'derive.evenements'],
  ['tempsHorsProjet', 'derive.tempsParPersonne'],
  ['absences', 'derive.capacitePersonneSemaine'],
  ['transactionsBancaires', 'financeActions.actionsATraiter'],
  ['lotsComptables', 'financeActions.actionsATraiter'],
]

// Seule la LECTURE est interdite : écrire dans le brouillon (`d.obligations`
// quand une obligation est reconduite) reste le geste normal d'une action.
for (const [collection, proprietaire] of COLLECTIONS_INTERDITES) {
  assert.ok(
    !new RegExp(`\\bstate\\.${collection}\\b`).test(cockpit),
    `Cockpit.tsx lit state.${collection} en direct : cette agrégation appartient à ${proprietaire}`,
  )
}

// state.temps est le cas le plus insidieux : `tempsParPersonne` existe
// depuis toujours et n'était simplement jamais rendu à l'accueil.
assert.ok(
  !/\bstate\.temps\b/.test(cockpit),
  'Cockpit.tsx repointe state.temps : les heures de la semaine viennent de derive.semaineParPersonne',
)

// le doublon du §3.13, nommément
assert.ok(
  !cockpit.includes('Émettre la facture'),
  "le libellé « Émettre la facture » est construit par financeActions.actionsATraiter : le Cockpit le RÉAFFICHE, il ne le réécrit pas",
)
const constructeursEmission = ['src/financeActions.ts', 'src/modules/Cockpit.tsx'].filter((f) =>
  lire(f).includes('Émettre la facture — '),
)
assert.deepEqual(
  constructeursEmission,
  ['src/financeActions.ts'],
  'une seule et unique construction de la ligne « facture à émettre »',
)

assert.ok(
  /import \{ actionsATraiter \} from '\.\.\/financeActions'/.test(cockpit),
  "le Cockpit doit LIRE actionsATraiter plutôt que reconstruire la file finance",
)

// les modules de calcul autorisés à l'accueil (contrat des modules)
const importsCockpit = [...cockpit.matchAll(/^import[\s\S]*?from '(\.\.?\/[^']+)'/gm)].map((m) => m[1])
const MODULES_CALCUL_AUTORISES = new Set(['../derive', '../economie', '../alerts', '../financeActions'])
const CALCULS_METIER = [
  '../achats', '../banque', '../comptable', '../facture', '../tresorerie', '../echeancier',
  '../miqcp', '../revue', '../radar', '../veille', '../boamp', '../candidature', '../dossier',
]
for (const mod of importsCockpit) {
  assert.ok(
    !CALCULS_METIER.includes(mod) || MODULES_CALCUL_AUTORISES.has(mod),
    `Cockpit.tsx importe ${mod} : l'accueil ne consomme que derive / economie / alerts / financeActions`,
  )
}

// ==========================================================================
// 2. Les cinq blocs du §8.1 lisent une fonction de calcul
// ==========================================================================

const BLOCS = [
  ['validationsAttendues', 'validations attendues'],
  ['reunionsDuJour', 'réunions du jour'],
  ['prochainesEcheances', 'prochaines échéances sur 14 jours'],
  ['semaineParPersonne', 'temps enregistré et charge prévisionnelle'],
]
for (const [fn, libelle] of BLOCS) {
  assert.equal(typeof derive[fn], 'function', `derive.${fn} doit exister (bloc « ${libelle} »)`)
  assert.ok(cockpit.includes(fn), `le bloc « ${libelle} » doit passer par derive.${fn}`)
}
// la charge prévisionnelle et le temps transitent par semaineParPersonne,
// qui doit elle-même s'appuyer sur les fonctions déjà en place
const sourceDerive = lire('src/derive.ts')
const corpsSemaine = sourceDerive.slice(sourceDerive.indexOf('export function semaineParPersonne'))
for (const appel of ['tempsParPersonne(', 'chargePlanifieeSemaine(', 'capacitePersonneSemaine(']) {
  assert.ok(
    corpsSemaine.includes(appel),
    `semaineParPersonne doit s'appuyer sur ${appel} plutôt que refaire le calcul`,
  )
}

// ==========================================================================
// 3. La recette : un état d'exemple, cinq blocs qui parlent
// ==========================================================================

const today = '2026-07-31'
const lundi = mondayOf(today)

const personne = (nom, email) => ({
  id: `p-${nom}`,
  nom,
  email,
  remuMensuelle: 2500,
  coefCharges: 1.55,
  heuresAnnuelles: 1600,
  facturablePct: 0.7,
})

const settings = {
  nomAgence: 'L&L',
  personnes: ['Julien', 'Zoé'],
  equipe: [personne('Julien', 'julien@exemple.test'), personne('Zoé', 'zoe@exemple.test')],
  heuresParJour: 7,
  tauxHoraireVente: 75,
  coutHoraireRevient: 40,
  fraisGenerauxAnnuels: 20000,
  caCibleHT: 0,
  bt01Actuel: 137.5,
  delaisPaiement: {},
  snoozes: {},
}

const etat = {
  settings,
  projets: [
    {
      id: 'P01',
      nom: 'Groupe scolaire',
      statut: 'En cours',
      typeMO: 'public',
      montantTravaux: 1000000,
      responsable: 'Julien',
      journal: [],
      dateLancement: addDays(today, 3),
      phases: [
        { code: 'PRO', montantHT: 20000, debut: '2026-07-20', fin: '2026-08-14', heuresPrevues: 80 },
      ],
    },
  ],
  phases: [],
  marches: [{ id: 'M1', projetId: 'P01', entreprise: 'Gros œuvre SA', lot: '01', delaiVerifJours: 15, actif: true }],
  situations: [
    { id: 'S1', projetId: 'P01', marcheId: 'M1', entreprise: 'Gros œuvre SA', mois: '2026-06', statut: 'a_verifier', dateReception: '2026-06-20', montantMoisHT: 42000 },
    { id: 'S2', projetId: 'P01', marcheId: 'M1', entreprise: 'Gros œuvre SA', mois: '2026-07', statut: 'a_verifier', dateReception: today, montantMoisHT: 31000 },
    { id: 'S3', projetId: 'P01', marcheId: 'M1', entreprise: 'Gros œuvre SA', mois: '2026-05', statut: 'validee', dateReception: '2026-05-20', montantMoisHT: 12000 },
  ],
  factures: [],
  paiements: [],
  echeancesFacturation: [
    { id: 'E1', projetId: 'P01', libelle: 'PRO — acompte', montantHT: 8000, datePrevue: '2026-07-28' },
    { id: 'E2', projetId: 'P01', libelle: 'PRO — solde', montantHT: 6000, datePrevue: addDays(today, 5) },
    { id: 'E3', projetId: 'P01', libelle: 'DET — acompte', montantHT: 4000, datePrevue: addDays(today, 40) },
  ],
  facturesAchat: [
    { id: 'FA1', fournisseur: 'Reprographie du Centre', montantTTC: 240, dateFacture: '2026-07-10', statut: 'a_valider', source: 'gmail' },
    { id: 'FA2', fournisseur: 'Assurance', montantTTC: 900, dateFacture: '2026-07-02', statut: 'valide', source: 'manuel' },
  ],
  registreDocuments: [
    { id: 'D1', titre: 'CCTP lot 3', statut: 'a_classer', recuLe: '2026-07-29T09:00:00.000Z', categorie: 'CCTP', source: 'gmail', nomOriginal: 'cctp.pdf', version: 1, evenements: [] },
    { id: 'D2', titre: 'Attestation', statut: 'recu', recuLe: '2026-07-30T09:00:00.000Z', categorie: 'ADM', source: 'depot', nomOriginal: 'att.pdf', version: 1, evenements: [] },
    { id: 'D3', titre: 'Plan validé', statut: 'classe', recuLe: '2026-07-01T09:00:00.000Z', categorie: 'PLAN', source: 'drive', nomOriginal: 'plan.pdf', version: 1, evenements: [] },
  ],
  transactionsBancaires: [],
  lotsComptables: [],
  contrats: [],
  attendusFinanciers: [],
  consultations: [],
  reunions: [
    { id: 'R1', projetId: 'P01', date: today, heure: '14:30', titre: 'Réunion de chantier n°7', participants: 'MOA, Gros œuvre SA', statut: 'a_preparer' },
    { id: 'R2', projetId: 'P01', date: addDays(today, 1), heure: '09:00', titre: 'Réunion de chantier n°8', participants: 'MOA', statut: 'a_preparer' },
  ],
  obligations: [{ id: 'O1', libelle: 'Décennale MOE', organisme: 'AXA', echeance: addDays(today, 9), periodiciteMois: 12, rappelJours: 30 }],
  contacts: [],
  artisans: [],
  temps: [{ id: 'T1', semaine: lundi, personne: 'Zoé', projetId: 'P01', phase: 'PRO', heures: 12 }],
  tempsHorsProjet: [{ id: 'H1', semaine: lundi, personne: 'Zoé', categorie: 'agence', heures: 3 }],
  absences: [],
  courriers: [],
}

// --- 3a. validations attendues : quatre familles, un seul constructeur ----

const actions = actionsATraiter(etat, today)
const validations = validationsAttendues(etat, today, actions, 2)
const parCle = Object.fromEntries(validations.map((v) => [v.cle, v]))

assert.deepEqual(
  validations.map((v) => v.cle).sort(),
  ['document', 'entrant', 'facture_achat', 'situation'],
  'les quatre familles du §8.1 doivent être agrégées',
)
assert.equal(parCle.facture_achat.nombre, 1, 'une seule facture fournisseur est à valider')
assert.equal(parCle.document.nombre, 2, 'deux documents sont reçus ou à classer, le troisième est classé')
assert.equal(parCle.situation.nombre, 2, 'deux situations attendent leur vérification')
assert.equal(parCle.entrant.nombre, 2, 'le compteur des pièces distantes est celui qui est passé')
assert.equal(parCle.situation.gravite, 3, 'une situation non vérifiée engage le délai global de paiement')

// une pièce distante non lue (session fermée) ne doit pas devenir un zéro
// affirmatif : la famille disparaît, elle ne se met pas à « 0 pièce »
assert.ok(
  !validationsAttendues(etat, today, actions, null).some((v) => v.cle === 'entrant'),
  'sans espace partagé connecté, aucune ligne « pièces arrivées » ne doit être affirmée',
)

// le lien avec financeActions est RÉEL : valider la facture fournisseur
// doit faire disparaître la ligne des deux côtés en même temps
const etatValide = { ...etat, facturesAchat: etat.facturesAchat.map((f) => ({ ...f, statut: 'valide' })) }
const actionsValide = actionsATraiter(etatValide, today)
assert.ok(
  !actionsValide.some((a) => a.kind === 'facture_achat'),
  'valider les factures fournisseurs vide la famille dans actionsATraiter',
)
assert.ok(
  !validationsAttendues(etatValide, today, actionsValide, 0).some((v) => v.cle === 'facture_achat'),
  'et la vide du même coup dans le bloc de l’accueil — un seul filtre, pas deux',
)

// la sélection par famille est typée, elle ne se déduit pas d'un préfixe d'id
for (const a of actions) {
  assert.ok(a.kind, `l'action ${a.id} doit porter sa famille (kind)`)
}
assert.equal(
  actions.filter((a) => a.kind === 'emettre_facture').length,
  1,
  'une seule échéance de facturation est arrivée à terme',
)
assert.equal(badgeFinance(etat, today), actions.length, 'le badge Finance reste le compte des actions')

assert.deepEqual(
  documentsATraiter(etat).map((d) => d.id).sort(),
  ['D1', 'D2'],
  'documentsATraiter retient recu / a_classer / a_valider',
)
assert.deepEqual(situationsAVerifier(etat).map((s) => s.id).sort(), ['S1', 'S2'])

// le triplet de statuts ne se déclare qu'une fois
const copiesTriplet = fs
  .readdirSync(path.join(racine, 'src/modules'))
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => `src/modules/${f}`)
  .concat(['src/App.tsx'])
  .filter((f) => /\['recu', 'a_classer', 'a_valider'\]/.test(lire(f)))
assert.deepEqual(
  copiesTriplet,
  [],
  'le triplet « recu / a_classer / a_valider » se déclare dans derive.ts et nulle part ailleurs',
)

// --- 3b. réunions du jour : bornées à la journée, repli explicite ---------

const agenda = [
  { id: 'g1', titre: 'Rendez-vous MOA', debut: `${today}T10:00:00+02:00`, lieu: 'Mairie', journee: false },
  { id: 'g2', titre: 'Salon', debut: `${addDays(today, 1)}T10:00:00+02:00`, lieu: '', journee: false },
  { id: 'g3', titre: 'Congé', debut: today, lieu: '', journee: true },
]
const reunions = reunionsDuJour(etat, today, agenda)
assert.deepEqual(
  reunions.map((r) => r.id),
  ['agenda-g1', 'reunion-R1', 'agenda-g3'],
  'agenda et chantier fondus, triés par heure, la journée entière en dernier',
)
assert.ok(
  !reunions.some((r) => r.id === 'agenda-g2'),
  "un rendez-vous de demain n'a rien à faire dans les réunions DU JOUR",
)
assert.equal(reunions.find((r) => r.id === 'agenda-g1').heure, '10:00')
assert.equal(reunions.find((r) => r.id === 'reunion-R1').lien, '#/projets/P01/chantier')
assert.equal(reunions.find((r) => r.id === 'agenda-g3').heure, null, 'une journée entière n’a pas d’heure')

// session Google coupée : les réunions saisies restent, et l'écran le DIT
const sansGoogle = reunionsDuJour(etat, today)
assert.deepEqual(sansGoogle.map((r) => r.id), ['reunion-R1'])
assert.ok(
  /Agenda Google non connecté/.test(cockpit),
  "sans session Google, l'accueil doit dire pourquoi la liste est courte — muette, elle se lit « rien aujourd'hui »",
)
assert.ok(
  /googleEnDirect/.test(cockpit),
  "le repli doit s'appuyer sur l'état réel de la session, pas sur une liste vide",
)

// --- 3c. prochaines échéances : quatorze jours, bornes incluses ----------

const echeances = prochainesEcheances(etat, today, 14)
const dates = echeances.map((e) => e.date)
assert.ok(dates.every((d) => d >= today && d <= addDays(today, 14)), 'fenêtre strictement respectée')
assert.deepEqual(dates, [...dates].sort(), 'les échéances sortent triées par date')
assert.ok(
  echeances.some((e) => e.titreLong.includes('Facture à émettre')),
  'la facture prévue dans 5 jours doit figurer parmi les échéances',
)
assert.ok(
  echeances.some((e) => e.titreLong.includes('Obligation')),
  "l'obligation à 9 jours doit figurer parmi les échéances",
)
assert.ok(
  !echeances.some((e) => e.titreLong.includes('DET — acompte')),
  "l'échéance à 40 jours est hors fenêtre",
)
assert.ok(
  echeances.some((e) => e.titreLong.includes('Lancement')),
  'le lancement de projet daté dans 3 jours doit figurer',
)
assert.ok(
  evenements(etat).length > echeances.length,
  'la fenêtre de 14 jours est bien un sous-ensemble de tous les événements',
)

// --- 3d + 3e. temps enregistré et charge prévisionnelle ------------------

const semaine = semaineParPersonne(etat, lundi)
const julien = semaine.find((l) => l.personne === 'Julien')
const zoe = semaine.find((l) => l.personne === 'Zoé')

assert.ok(julien && zoe, "l'équipe entière figure, y compris qui n'a rien pointé")
assert.equal(zoe.heures, 15, 'temps enregistré = pointage projet + hors-projet de la semaine')
assert.equal(julien.heures, 0, 'Julien n’a rien pointé cette semaine')
assert.ok(julien.charge > 0, '0.12 : un projet neuf porte son responsable — la charge cesse d’être nulle')
assert.equal(zoe.charge, 0, 'Zoé ne figure pas sur le projet : aucune charge planifiée')
assert.equal(julien.capacite, settings.heuresParJour * 5, 'capacité pleine sans congé')

// congés : la capacité baisse, la charge ne bouge pas
const etatConges = { ...etat, absences: [{ id: 'A1', personne: 'Julien', debut: lundi, fin: addDays(lundi, 1) }] }
const julienConges = semaineParPersonne(etatConges, lundi).find((l) => l.personne === 'Julien')
assert.equal(julienConges.capacite, settings.heuresParJour * 3, 'deux jours de congé retirent deux jours de capacité')
assert.equal(julienConges.charge, julien.charge, 'les congés ne modifient pas la charge planifiée')

// une personne qui a pointé sans figurer dans l'équipe reste visible :
// sinon un renommage fait disparaître des heures sans le moindre message
const etatOrphelin = {
  ...etat,
  temps: [...etat.temps, { id: 'T2', semaine: lundi, personne: 'Stagiaire', projetId: 'P01', phase: 'PRO', heures: 4 }],
}
assert.ok(
  semaineParPersonne(etatOrphelin, lundi).some((l) => l.personne === 'Stagiaire'),
  'des heures pointées par un nom hors équipe ne doivent pas disparaître de l’écran',
)

// --- 3f. repères du jour -------------------------------------------------

assert.deepEqual(
  phasesEnCours(etat, today).map((x) => `${x.projet.id}/${x.phase.code}`),
  ['P01/PRO'],
  'la phase PRO encadre la date du jour',
)
assert.deepEqual(phasesEnCours(etat, '2026-09-01'), [], 'hors fenêtre, aucune phase en cours')

// ==========================================================================
// 4. `evenements()` n'existe qu'une fois
// ==========================================================================

assert.ok(
  !/function evenements\(/.test(calendrier),
  'evenements() a quitté Calendrier.tsx pour derive.ts — la recopier annulerait le livrable',
)
assert.ok(
  /import \{ evenements \} from '\.\.\/derive'/.test(calendrier),
  'Calendrier.tsx doit LIRE derive.evenements',
)
const definitions = ['src/derive.ts', 'src/modules/Calendrier.tsx', 'src/modules/Cockpit.tsx'].filter((f) =>
  /export function evenements\(|^function evenements\(/m.test(lire(f)),
)
assert.deepEqual(definitions, ['src/derive.ts'], 'une seule définition de l’inventaire des dates')

// ==========================================================================
// 5. Aucune balise <table> brute dans les écrans de l'accueil
// ==========================================================================

// C'est `Table` qui porte le repli en cartes empilées sous 700 px : une
// table brute est illisible sur un téléphone, et c'est ainsi que le
// responsive s'est perdu dans sept modules.
for (const [nom, source] of [
  ['Cockpit.tsx', cockpit],
  ['Calendrier.tsx', calendrier],
  ['App.tsx', app],
]) {
  for (const balise of ['<table', '<thead', '<tbody']) {
    assert.ok(
      !source.includes(balise),
      `${nom} contient une balise ${balise}> brute : tout tableau passe par le composant Table`,
    )
  }
}
assert.ok(
  /<Table head=\{\[/.test(cockpit),
  'la semaine de l’équipe se rend avec le composant Table',
)

// ==========================================================================
// 6. Le filtre par personne part de useMoi()
// ==========================================================================

assert.ok(
  /import \{ useMoi \} from '\.\.\/moi'/.test(cockpit),
  "l'accueil est personnel : le filtre part de l'identité courante",
)
assert.ok(
  /moi\.nom \?\? ''/.test(cockpit),
  "sans identité reconnue, le filtre retombe sur « Tout » — null veut dire null",
)
assert.ok(
  !/settings\.personnes\[0\]/.test(cockpit),
  "le Cockpit ne doit jamais désigner le premier de la liste comme personne courante",
)
// le choix explicite de l'utilisateur doit primer sur l'identité déduite,
// sinon le filtre se remet tout seul sur « moi » au premier re-rendu
assert.ok(
  /choixFiltre \?\? moi\.nom/.test(cockpit),
  'un filtre choisi à la main l’emporte sur l’identité déduite',
)

console.log(
  `Accueil §8.1 : ${validations.length} familles de validations, ${reunions.length} réunions du jour, ` +
    `${echeances.length} échéances à 14 j, ${semaine.length} personnes en semaine — aucun calcul recopié.`,
)
