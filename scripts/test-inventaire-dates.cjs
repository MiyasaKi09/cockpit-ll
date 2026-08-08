// Refonte de la navigation, contrôle n°3 (docs/REFONTE_NAVIGATION.md §2.1, §6).
//
// L'INVENTAIRE DES DATES NE DOIT PLUS ÊTRE AVEUGLE.
// --------------------------------------------------------------------------
// `derive.evenements()` est l'inventaire unique des dates qui comptent : le
// calendrier mensuel le lit, la file du matin le lit, et depuis la tranche 1 la
// bande « ce qui tombe » de la semaine le lit aussi. Il ignorait la moitié du
// temps de l'agence — les périodes d'intervention des entreprises, les congés,
// les visas, les situations attendues, les limites contractuelles de
// vérification, les points de séance et les échéances fournisseurs.
//
// C'est cette incomplétude, et elle seule, qui obligeait à ouvrir huit écrans
// pour lire une semaine.
//
// LE MODE DE PANNE QUE CE TEST FERME EST SILENCIEUX. Si une famille redevenait
// invisible — un import perdu au refactoring, une autorité qu'un écran cesse de
// passer, une condition retournée —, il n'y aurait ni erreur, ni écran cassé,
// ni chiffre faux : juste une ligne qui manque. Le lundi matin, la semaine
// paraîtrait complète et le visa qu'on devait rendre le jeudi n'y serait pas.
// Rien, dans l'outil, ne dirait qu'il manque quelque chose.
//
// D'où la forme du test : un état posé à la main, une cause par famille, et
// pour chacune la vérification dans les DEUX SENS — l'événement paraît quand
// la cause existe, il disparaît quand elle cesse. Vérifier seulement la
// présence laisserait passer un `push` inconditionnel, qui « voit » tout et ne
// mesure rien.
//
// TROIS RÉGIMES, ET LE TEST LES DISTINGUE
// --------------------------------------------------------------------------
// Quatre familles s'appuient sur des modules que `derive.ts` NE PEUT PAS
// importer : cinq chargeurs de test bornent son graphe à `./miqcp`, `./facture`,
// `./util` et `./gpa`. Elles reçoivent donc leur autorité en argument
// (`AutoritesDatees`) — la fonction elle-même, pas une valeur recopiée. Sans
// elle, la famille SE TAIT plutôt que d'approximer : une famille silencieuse se
// répare, une famille approximative ment sans le dire. Ce test vérifie les deux
// moitiés de ce contrat.
//
// Les trois autres familles lisent l'état directement et parlent toujours.
//
// Et comme une autorité qu'aucun écran ne passe ne sert à rien, le test relit
// `AUTORITES_DATEES` dans `Cockpit.tsx` et exige qu'elle couvre l'interface
// entière : une famille ajoutée à `derive` et oubliée à l'écran serait un
// inventaire complet que personne n'affiche.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')

// Chargeur de graphe : les vraies autorités, jamais des doublures. Un test qui
// stubberait `visasEnAttente` prouverait que `evenements` sait appeler une
// fonction, pas que le visa tombe le bon jour.
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

const derive = charger('src/derive.ts')
const { evenements, prochainesEcheances } = derive
const { interventionsDe, chevauchementsEntreprise, periodesEnConflit, clePeriode } = charger('src/planningTravaux.ts')
const { visasEnAttente, echeanceVisa } = charger('src/visas.ts')
const { situationAttendueNonRecue } = charger('src/entreprise.ts')
const { pointResolu } = charger('src/seanceChantier.ts')
// `fmtDate` et `fmtMois` sont attendus DEPUIS l'autorité et non recopiés :
// changer la présentation des dates est une décision de src/util.ts, et ce
// test n'a pas à la figer une seconde fois.
const { fmtDate, fmtMois } = charger('src/util.ts')

const AUJOURDHUI = '2026-08-12' // un mercredi, après le 10 : la situation du mois est attendue

const AUTORITES = {
  today: AUJOURDHUI,
  interventionsDe,
  clePeriode,
  periodesEnConflit: (marches) => periodesEnConflit(chevauchementsEntreprise(marches)),
  visasEnAttente,
  echeanceVisa,
  situationAttendueNonRecue,
  pointResolu,
}

// ==========================================================================
// L'état d'essai — une cause, une seule, par famille
// ==========================================================================
//
// Les collections se lisent dans `AppState` plutôt que d'être recopiées : une
// collection ajoutée demain ne doit pas faire échouer ce test sur un
// `undefined` qui n'est pas son sujet (même méthode que test-entreprise).

const COLLECTIONS = (() => {
  const types = lire('src/types.ts')
  const debut = types.indexOf('export interface AppState')
  const bloc = types.slice(debut, types.indexOf('\n}', debut))
  return [...bloc.matchAll(/^  ([a-zA-Z_]+)\??:\s*[A-Za-z]+\[\]/gm)].map((m) => m[1])
})()
for (const attendue of ['marches', 'situations', 'absences', 'visas', 'pointsSeance', 'facturesAchat']) {
  assert.ok(
    COLLECTIONS.includes(attendue),
    `AppState ne porte plus \`${attendue}\` : une famille entière de l’inventaire n’a plus de source.`,
  )
}

function etat(over = {}) {
  const vide = {}
  for (const c of COLLECTIONS) vide[c] = []
  return {
    version: 21,
    ...vide,
    settings: { nomAgence: 'Atelier L&L', personnes: ['Julien', 'Zoé'], equipe: [], snoozes: {}, vus: {} },
    projets: [
      { id: 'P01', nom: 'Groupe scolaire', statut: 'En cours', typeMO: 'public', montantTravaux: 1000000, responsable: 'Julien', journal: [], phases: [] },
    ],
    marches: [
      {
        id: 'M1',
        projetId: 'P01',
        entreprise: 'Gros œuvre SA',
        lot: '01 — Gros œuvre',
        montantInitialHT: 400000,
        avenantsHT: 0,
        tauxRG: 0.05,
        revision: false,
        delaiVerifJours: 15,
        actif: true,
        // deux passages : celui de la semaine, confirmé ; le retour de
        // septembre, que personne n'a confirmé — c'est justement le retour
        // qu'on oublie de confirmer
        interventions: [
          { id: 'i1', debut: '2026-08-10', fin: '2026-08-14', libelle: 'fondations', confirmeLe: '2026-07-01' },
          { id: 'i2', debut: '2026-09-07', fin: '2026-09-18', libelle: 'reprises', confirmeLe: null },
        ],
      },
    ],
    // situation de JUILLET reçue et pas encore vérifiée : elle donne la limite
    // contractuelle de vérification (reçue le 05/08 + 15 j = 20/08) sans
    // éteindre l'attente du mois d'AOÛT, qui est une autre famille
    situations: [
      { id: 'S1', projetId: 'P01', marcheId: 'M1', entreprise: 'Gros œuvre SA', mois: '2026-07', statut: 'a_verifier', dateReception: '2026-08-05', montantMoisHT: 42000 },
    ],
    absences: [{ id: 'A1', personne: 'Zoé', debut: '2026-08-17', fin: '2026-08-21', motif: 'congés' }],
    visas: [
      { id: 'V1', projetId: 'P01', marcheId: 'M1', lot: '02 — Charpente', document: 'Plans EXE R+1 indice B', recuLe: '2026-08-03', delaiJours: 15, statut: 'a_viser' },
    ],
    pointsSeance: [
      { id: 'PS1', projetId: 'P01', marcheId: 'M1', libelle: 'Reprendre l’étanchéité du local vélos', responsable: 'Gros œuvre SA', echeance: '2026-08-19', etat: 'a_traiter', inscritLe: '2026-08-05', majLe: '2026-08-05' },
    ],
    facturesAchat: [
      { id: 'FA1', fournisseur: 'Reprographie du Centre', dateFacture: '2026-07-28', dateEcheance: '2026-08-27', montantHT: 200, montantTTC: 240, ventilations: [], statut: 'a_valider', source: 'manuel' },
    ],
    ...over,
  }
}

const BASE = etat()
const inventaire = (e = BASE, autorites = AUTORITES) => evenements(e, autorites)
const titres = (e, autorites) => inventaire(e, autorites).map((x) => x.titreLong)
const aLaDate = (e, autorites, date) =>
  inventaire(e, autorites).filter((x) => x.date === date).map((x) => x.titreLong)

/** l'événement d'une famille, retrouvé par son libellé — les libellés sont
 *  ce que l'agence LIT, ils vieillissent moins vite qu'un index */
const trouver = (liste, motif) => liste.filter((t) => motif.test(t))

// ==========================================================================
// 1. Les sept familles paraissent, chacune sur SA date
// ==========================================================================

const TOUS = titres(BASE, AUTORITES)

// --- a. périodes d'intervention -------------------------------------------
// Une entrée par PÉRIODE, jamais l'enveloppe du lot : un lot en trois passages
// recouvre ses propres trous, et l'entrée en chantier de son retour de
// septembre est justement la date qu'on oublie.
assert.deepEqual(
  aLaDate(BASE, AUTORITES, '2026-08-10'),
  ['Entrée en chantier — 01 — Gros œuvre · Gros œuvre SA (fondations)'],
  'le début de la période d’août doit tomber le 10, avec le lot et l’entreprise',
)
assert.deepEqual(
  aLaDate(BASE, AUTORITES, '2026-08-14'),
  ["Fin d'intervention — 01 — Gros œuvre · Gros œuvre SA (fondations)"],
  'la fin de la même période doit tomber le 14',
)
assert.equal(
  trouver(TOUS, /^Entrée en chantier/).length,
  2,
  'DEUX entrées en chantier : le lot revient en septembre, et ce retour est une date en soi',
)
assert.ok(
  trouver(TOUS, /^Entrée en chantier/).some((t) => /venue NON confirmée/.test(t)),
  'le retour de septembre n’est pas confirmé : l’inventaire doit le DIRE, pas le supposer venu',
)
assert.ok(
  !trouver(TOUS, /\(fondations\)/).some((t) => /venue NON confirmée/.test(t)),
  'la période confirmée ne doit pas porter l’avertissement — sinon il ne veut plus rien dire',
)

// --- b. congés --------------------------------------------------------------
assert.deepEqual(
  aLaDate(BASE, AUTORITES, '2026-08-17'),
  [`Congé — Zoé, du ${fmtDate('2026-08-17')} au ${fmtDate('2026-08-21')} · congés`],
  'le congé tombe sur son PREMIER jour, la période entière dans le titre',
)

// --- c. visas à rendre ------------------------------------------------------
// reçu le 03/08 + 15 jours de CCAP = 18/08. Le délai vient de `echeanceVisa`
// (src/visas.ts) : le recopier ici ferait deux règles pour un seul CCAP.
assert.deepEqual(
  aLaDate(BASE, AUTORITES, '2026-08-18'),
  ['Visa à rendre — Plans EXE R+1 indice B (02 — Charpente)'],
  'le visa tombe à l’échéance du CCAP, pas à sa réception',
)
assert.equal(
  echeanceVisa(BASE.visas[0]),
  '2026-08-18',
  'la date de l’inventaire est celle de l’autorité, sans second calcul',
)

// --- d. situations attendues et non reçues ---------------------------------
// L'autorité rend un VERDICT, pas une date : « au jour dit, la situation du
// mois manque ». L'événement porte donc `today`.
assert.ok(
  aLaDate(BASE, AUTORITES, AUJOURDHUI).includes(
    `Situation ${fmtMois('2026-08')} non reçue — 01 — Gros œuvre · Gros œuvre SA`,
  ),
  'la situation du mois en cours manque : elle tombe aujourd’hui',
)

// --- e. limites contractuelles de vérification -----------------------------
// reçue le 05/08 + `delaiVerifJours` du marché (15) = 20/08. Passé ce jour, le
// délai global de paiement court contre l'agence.
assert.deepEqual(
  aLaDate(BASE, AUTORITES, '2026-08-20'),
  [`Limite de vérification — Gros œuvre SA (${fmtMois('2026-07')})`],
  'la limite de vérification suit le délai du MARCHÉ, pas un défaut global',
)

// --- f. points de séance ----------------------------------------------------
assert.deepEqual(
  aLaDate(BASE, AUTORITES, '2026-08-19'),
  ['Point de séance — Reprendre l’étanchéité du local vélos (Gros œuvre SA)'],
  'un point de séance daté est une échéance comme une autre',
)

// --- g. échéances fournisseurs ---------------------------------------------
assert.equal(
  trouver(aLaDate(BASE, AUTORITES, '2026-08-27'), /^Facture fournisseur à payer/).length,
  1,
  'la facture d’achat porte sa date d’échéance depuis le lot F ; personne ne la voyait venir',
)

// ==========================================================================
// 2. Chaque famille DISPARAÎT quand sa cause disparaît
// ==========================================================================
//
// Sans ce second sens, un `push` inconditionnel passerait le contrôle n°1
// entier : il « verrait » les sept familles et n'en mesurerait aucune.

const SANS_CAUSE = [
  [
    'période d’intervention',
    /chantier|d'intervention/,
    { marches: [{ ...BASE.marches[0], actif: false }] },
  ],
  ['congé', /^Congé —/, { absences: [] }],
  ['visa à rendre', /^Visa à rendre/, { visas: [{ ...BASE.visas[0], statut: 'vise', viseLe: '2026-08-06' }] }],
  [
    'situation attendue',
    /non reçue/,
    // la situation d'août arrive : l'attente s'éteint, et c'est bien
    // `situationAttendueNonRecue` qui le décide
    {
      situations: [
        ...BASE.situations,
        { id: 'S2', projetId: 'P01', marcheId: 'M1', entreprise: 'Gros œuvre SA', mois: '2026-08', statut: 'recue', dateReception: AUJOURDHUI, montantMoisHT: 31000 },
      ],
    },
  ],
  ['limite de vérification', /^Limite de vérification/, { situations: [{ ...BASE.situations[0], statut: 'validee' }] }],
  ['point de séance', /^Point de séance/, { pointsSeance: [{ ...BASE.pointsSeance[0], etat: 'fait', resoluLe: '2026-08-11' }] }],
  ['échéance fournisseur', /^Facture fournisseur/, { facturesAchat: [{ ...BASE.facturesAchat[0], payeLe: '2026-08-14' }] }],
]

for (const [nom, motif, sansCause] of SANS_CAUSE) {
  assert.ok(
    trouver(TOUS, motif).length > 0,
    `« ${nom} » : le motif ${motif} ne retrouve rien dans l’état de départ — le test se contrôle lui-même.`,
  )
  assert.deepEqual(
    trouver(titres(etat(sansCause), AUTORITES), motif),
    [],
    `« ${nom} » paraît encore alors que sa cause a disparu : l’inventaire pousse la ligne sans la juger.\n` +
      'Une échéance qui reste après avoir été traitée se lit comme un retard, et on la traite deux fois.',
  )
}

// ==========================================================================
// 3. Sans son autorité, une famille se TAIT — elle n'approxime pas
// ==========================================================================

const NUES = titres(BASE, {}) // exactement ce que rend `evenements(state)` seul

const INJECTEES = [
  ['période d’intervention', /chantier|d'intervention/, 'interventionsDe (src/planningTravaux.ts)'],
  ['visa à rendre', /^Visa à rendre/, 'visasEnAttente + echeanceVisa (src/visas.ts)'],
  ['situation attendue', /non reçue/, 'situationAttendueNonRecue (src/entreprise.ts)'],
  ['point de séance', /^Point de séance/, 'pointResolu (src/seanceChantier.ts)'],
]
for (const [nom, motif, autorite] of INJECTEES) {
  assert.deepEqual(
    trouver(NUES, motif),
    [],
    `« ${nom} » paraît sans que ${autorite} ait été passée.\n` +
      'Un calcul de secours vient d’apparaître dans derive.ts : c’est une SECONDE règle pour la même\n' +
      'notion, et elle divergera de la première sans que rien ne le signale. Sans son autorité, la\n' +
      'famille doit se taire — une famille silencieuse se répare, une famille approximative ment.',
  )
}

// … et les trois autres parlent toujours : elles lisent l'état directement.
for (const [nom, motif] of [
  ['congé', /^Congé —/],
  ['limite de vérification', /^Limite de vérification/],
  ['échéance fournisseur', /^Facture fournisseur/],
]) {
  assert.ok(
    trouver(NUES, motif).length > 0,
    `« ${nom} » ne dépend d’aucune autorité injectée : elle doit paraître même sans argument.\n` +
      'Si elle s’est mise à en demander une, `Calendrier.tsx` — qui appelle `evenements(state)` nu —\n' +
      'vient de perdre une famille en silence.',
  )
}

// L'appel nu doit rendre EXACTEMENT ce qu'il rendait : c'est la condition pour
// que les écrans non encore migrés (le calendrier mensuel) ne changent pas.
assert.ok(
  NUES.length < TOUS.length,
  'l’inventaire complété doit rendre STRICTEMENT plus que l’inventaire nu',
)

// ==========================================================================
// 4. La file du matin voit ce que la semaine voit
// ==========================================================================
//
// `prochainesEcheances` est le rail « Repères » de l'accueil. S'il n'avait pas
// reçu les autorités, la semaine et le rail auraient répondu différemment le
// même jour, sur le même écran.

const RAIL = prochainesEcheances(BASE, AUJOURDHUI, 14, AUTORITES).map((e) => e.titreLong)
for (const [nom, motif] of [
  ['visa à rendre', /^Visa à rendre/],
  ['situation attendue', /non reçue/],
  ['point de séance', /^Point de séance/],
  ['congé', /^Congé —/],
  ['limite de vérification', /^Limite de vérification/],
]) {
  assert.ok(
    trouver(RAIL, motif).length > 0,
    `« ${nom} » manque à la file du matin : les autorités ne traversent pas prochainesEcheances.`,
  )
}
assert.deepEqual(
  trouver(RAIL, /^Facture fournisseur/),
  [],
  'l’échéance fournisseur du 27/08 est à quinze jours : hors de la fenêtre de quatorze, elle ne doit pas y être',
)
assert.deepEqual(
  trouver(prochainesEcheances(BASE, AUJOURDHUI, 14).map((e) => e.titreLong), /^Visa à rendre/),
  [],
  'sans autorités, la file du matin reste aveugle aux familles injectées — le contrat est le même partout',
)

// ==========================================================================
// 5. Une autorité qu'aucun écran ne passe ne sert à rien
// ==========================================================================
//
// Le scénario redouté : quelqu'un ajoute une huitième famille à `derive`, avec
// son autorité, et oublie `AUTORITES_DATEES` dans le Cockpit. Le test ci-dessus
// passerait — il construit son propre objet — et l'écran resterait aveugle.

const CLES_INTERFACE = (() => {
  const source = lire('src/derive.ts')
  const debut = source.indexOf('export interface AutoritesDatees')
  assert.ok(debut > 0, 'l’interface AutoritesDatees a disparu de derive.ts')
  const bloc = source.slice(debut, source.indexOf('\n}', debut))
  return [...bloc.matchAll(/^  ([a-zA-Z]+)\??:/gm)].map((m) => m[1]).filter((k) => k !== 'today')
})()

const CLES_COCKPIT = (() => {
  const sf = ts.createSourceFile(
    'src/modules/Cockpit.tsx',
    lire('src/modules/Cockpit.tsx'),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  )
  let cles = null
  const visiter = (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'AUTORITES_DATEES' &&
      n.initializer &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      cles = n.initializer.properties.map((p) => (p.name ? p.name.getText(sf) : '?'))
    }
    ts.forEachChild(n, visiter)
  }
  visiter(sf)
  return cles
})()

assert.ok(CLES_COCKPIT, 'AUTORITES_DATEES est introuvable dans Cockpit.tsx : la semaine ne passe plus rien à derive.')
assert.deepEqual(
  [...CLES_COCKPIT].sort(),
  [...CLES_INTERFACE].sort(),
  'Cockpit.tsx ne passe pas les mêmes autorités que `AutoritesDatees` déclare.\n' +
    'Une autorité déclarée et jamais passée, c’est une famille que l’inventaire sait voir et que\n' +
    'l’écran ne verra jamais — le défaut d’origine, remis en place à l’identique.',
)

// Et elles viennent bien du module qui fait autorité, pas d'une reprise locale.
const cockpit = lire('src/modules/Cockpit.tsx')
for (const [fonction, module] of [
  ['interventionsDe', '../planningTravaux'],
  ['periodesEnConflit', '../planningTravaux'],
  ['clePeriode', '../planningTravaux'],
  ['visasEnAttente', '../visas'],
  ['echeanceVisa', '../visas'],
  ['situationAttendueNonRecue', '../entreprise'],
  ['pointResolu', '../seanceChantier'],
]) {
  const importe = [...cockpit.matchAll(/import \{([\s\S]*?)\} from '([^']+)'/g)].some(
    ([, noms, source]) => source === module && new RegExp(`\\b${fonction}\\b`).test(noms),
  )
  assert.ok(
    importe,
    `Cockpit.tsx doit IMPORTER ${fonction} depuis ${module} : une notion, une autorité.\n` +
      'Recopiée dans l’écran, elle divergerait du module sans que rien ne le signale.',
  )
  assert.ok(
    !new RegExp(`(function|const) ${fonction}\\b`).test(cockpit),
    `Cockpit.tsx redéfinit ${fonction} : c’est le second calcul que la refonte cherche à supprimer.`,
  )
}

// … et RIEN D'AUTRE ne vient de ces quatre modules.
//
// C'est la borne de l'exception que `test-accueil.cjs` accorde à l'accueil.
// Le contrat des modules interdit à l'écran de consommer un module de calcul ;
// ces quatre-là y échappent parce qu'ils sont TRANSMIS à derive, pas
// consommés. Sans ce contrôle, la dérogation s'élargirait d'elle-même : il
// suffirait d'ajouter `syntheseEntreprise` à une ligne d'import déjà présente
// — un mot dans des accolades, invisible en revue — pour que l'accueil se
// remette à calculer, et la refonte aurait rendu la porte plus large.
const AUTORISES_PAR_MODULE = {
  '../planningTravaux': ['chevauchementsEntreprise', 'clePeriode', 'interventionsDe', 'periodesEnConflit'],
  '../visas': ['echeanceVisa', 'visasEnAttente'],
  '../entreprise': ['situationAttendueNonRecue'],
  '../seanceChantier': ['pointResolu'],
}
for (const [module, permis] of Object.entries(AUTORISES_PAR_MODULE)) {
  const importes = [...cockpit.matchAll(/^import (?:type )?\{([\s\S]*?)\} from '([^']+)'/gm)]
    .filter(([, , source]) => source === module)
    .flatMap(([, noms]) => noms.split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean))
  assert.deepEqual(
    importes.sort(),
    [...permis].sort(),
    `Cockpit.tsx importe de ${module} autre chose que les autorités qu’il transmet.\n` +
      'L’accueil AFFICHE, il ne calcule pas : un symbole de plus venu d’un module de calcul, et le\n' +
      'second calcul est de retour dans l’écran. S’il s’agit d’une nouvelle autorité pour la semaine,\n' +
      'ajoutez-la à `AutoritesDatees`, à `AUTORITES_DATEES` et ici — dans cet ordre.',
  )
}

console.log(
  `Inventaire des dates : ${TOUS.length} événements sur l’état d’essai, ${SANS_CAUSE.length} familles ` +
    `vérifiées dans les deux sens (elles paraissent, elles disparaissent), ${INJECTEES.length} muettes sans ` +
    `leur autorité, ${CLES_COCKPIT.length} autorités réellement passées par l’écran — ` +
    'les vraies fonctions, jamais des doublures.',
)
