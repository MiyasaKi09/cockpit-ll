// L'essentiel — l'écran d'entrée de la Finance (commande du 04/08 :
// « clair et simple visuellement, précis dans ce que ça montre »).
//
// Le danger de ce genre d'écran n'est pas visuel, il est arithmétique :
// une tuile qui refait son propre calcul finit par afficher un chiffre
// différent de l'onglet où l'on agit, et le jour où les deux divergent,
// plus personne ne croit ni l'un ni l'autre. Quatre choses tenues ici :
//
//   1. les sélecteurs de L'essentiel (aEncaisser, aFacturer, achatsAPayer)
//      donnent les montants posés à la main, et « à facturer » est LA même
//      liste que les actions « Émettre la facture » de financeActions ;
//   2. Finance.tsx ne calcule RIEN : il importe meteoFinanciere / derive,
//      financeActions et tva — et ne touche jamais state.factures ni un
//      .reduce local ;
//   3. les six tuiles existent, chacune est un lien vers l'onglet où l'on
//      agit, et le chiffre TVA est celui de la carte (positionTVA) ou la
//      carte elle-même montée ;
//   4. les NEUF destinations de FinanceNav restent accessibles — la barre
//      se hiérarchise (4 principales + 5 secondaires AFFICHÉES), elle ne
//      supprime rien (décision du 04/08, docs/INVENTAIRE_FINANCE.md).

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')

/** charge un module TypeScript pur (sans React ni DOM) pour l'exercer —
 *  même chargeur à injection que test-accueil : le graphe suit les VRAIS
 *  imports, chaque dépendance est fournie explicitement */
function charger(fichier, dependances = {}) {
  const compile = ts.transpileModule(lire(fichier), {
    fileName: fichier,
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
const gpa = charger('src/gpa.ts', { './util': util })
const derive = charger('src/derive.ts', { './miqcp': miqcp, './facture': facture, './util': util, './gpa': gpa })
const achats = charger('src/achats.ts', { './util': util })
// `controlesCloture` traîne fflate (l'export du lot comptable) derrière
// elle : la clôture n'est pas l'invariant testé ici — seuls les montants
// des tuiles et la liste des échéances dues le sont.
const FA = charger('src/financeActions.ts', {
  './achats': achats,
  './comptable': { controlesCloture: () => ({ bloquants: 0 }) },
  './facture': facture,
  './derive': derive,
  './util': util,
})

// --- 1. les sélecteurs, sur des montants posés à la main --------------------

const today = '2026-08-04'
const etat = {
  factures: [
    // émise il y a deux mois, jamais réglée : 1 200 TTC, échéance dépassée
    { id: 'F1', type: 'facture', statut: 'emise', projetId: 'P1', libelle: 'ESQ', montantHT: 1000, tauxTVA: 0.2, emission: '2026-06-01', delaiJours: 30 },
    // émise récemment, réglée pour 400 : solde 2 000 TTC, pas en retard
    { id: 'F2', type: 'facture', statut: 'emise', projetId: 'P1', libelle: 'APS', montantHT: 2000, tauxTVA: 0.2, emission: '2026-07-30', delaiJours: 30 },
    // PRÉVUE : n'existe pas légalement, rien n'est dû
    { id: 'F3', type: 'facture', statut: 'prevue', projetId: 'P1', libelle: 'APD', montantHT: 500, tauxTVA: 0.2, emission: '2026-08-01', delaiJours: 30 },
    // avoir : jamais une créance
    { id: 'A1', type: 'avoir', statut: 'emise', projetId: 'P1', libelle: 'geste', montantHT: -120, tauxTVA: 0.2, emission: '2026-07-01', delaiJours: 0 },
  ],
  paiements: [
    { id: 'p1', date: '2026-08-01', montant: 400, affectations: [{ factureId: 'F2', montant: 400 }] },
  ],
  echeancesFacturation: [
    // due depuis trois jours → à facturer
    { id: 'E1', projetId: 'P1', libelle: 'solde APS', montantHT: 3000, tauxTVA: 0.2, datePrevue: '2026-08-01', delaiJours: 30 },
    // future → pas encore due
    { id: 'E2', projetId: 'P1', libelle: 'APD', montantHT: 999, tauxTVA: 0.2, datePrevue: '2026-09-15', delaiJours: 30 },
    // due AUJOURD'HUI — le cas de bord qui sépare `<=` de `<` : une échéance
    // du jour est due des deux côtés (tuile ET action), ou nulle part
    { id: 'E3', projetId: 'P1', libelle: 'acompte PRO', montantHT: 500, tauxTVA: 0.2, datePrevue: today, delaiJours: 30 },
  ],
  facturesAchat: [
    // validée, non payée, échéance dépassée → à payer, en retard
    { id: 'FA1', fournisseur: 'BET Structure', dateFacture: '2026-06-20', dateEcheance: '2026-07-20', montantHT: 500, montantTVA: 100, montantTTC: 600, ventilations: [], statut: 'validee', source: 'manuel' },
    // validée et payée → sortie du champ
    { id: 'FA2', fournisseur: 'Repro', dateFacture: '2026-06-05', montantHT: 200, montantTVA: 40, montantTTC: 240, ventilations: [], statut: 'validee', payeLe: '2026-07-15', source: 'manuel' },
    // boîte d'arrivée : pas encore une dette certaine, comptée À PART
    { id: 'FA3', fournisseur: 'Géomètre', dateFacture: '2026-08-01', montantHT: 100, montantTVA: 20, montantTTC: 120, ventilations: [], statut: 'a_valider', source: 'gmail' },
  ],
  contrats: [],
  attendusFinanciers: [],
  transactionsBancaires: [],
  notesFrais: [],
  lotsComptables: [],
  settings: {},
}

{
  const e = FA.aEncaisser(etat, today)
  assert.equal(e.totalTTC, 3200, 'à encaisser = 1 200 (F1) + 2 000 (F2 après acompte de 400) TTC')
  assert.equal(e.nb, 2, 'deux factures émises non soldées — la prévue et l’avoir sont hors champ')
  assert.equal(e.retardTTC, 1200, 'seule F1 a dépassé son échéance contractuelle : le retard, c’est elle')
  assert.equal(e.nbRetard, 1, 'une seule facture en retard')

  // la facture prévue ne doit JAMAIS entrer dans « à encaisser » : émise,
  // elle y entre — même état, seul le statut change
  const etatEmis = {
    ...etat,
    factures: etat.factures.map((f) => (f.id === 'F3' ? { ...f, statut: 'emise' } : f)),
  }
  assert.equal(
    FA.aEncaisser(etatEmis, today).totalTTC,
    3800,
    'la même pièce passée « émise » ajoute ses 600 TTC : l’exclusion tenait bien au statut « prevue »',
  )
}

{
  const f = FA.aFacturer(etat, today)
  assert.equal(f.totalHT, 3500, 'à facturer = 3 000 (E1, échue) + 500 (E3, due AUJOURD’HUI) — E2 est future')
  assert.equal(f.nb, 2, 'deux échéances dues : une échéance du jour est due, pas « presque due »')

  // LA règle de l'écran : « à facturer » et les actions « Émettre la
  // facture » sont la même liste (echeancesDues). Si l'une bouge sans
  // l'autre — même d'un seul jour de borne —, la tuile promet un montant
  // que l'onglet Ventes ne réclame pas.
  const emissions = FA.actionsATraiter(etat, today).filter((a) => a.kind === 'emettre_facture')
  assert.deepEqual(
    emissions.map((a) => a.id),
    ['emettre:E1', 'emettre:E3'],
    'la tuile « À facturer » et les actions « Émettre la facture » doivent porter les MÊMES échéances dues (E3, due aujourd’hui, comprise)',
  )
  assert.deepEqual(
    FA.echeancesDues(etat, today).map((x) => x.id),
    ['E1', 'E3'],
    'echeancesDues est la source unique : E1 échue et E3 due ce jour, E2 future',
  )
}

{
  const a = FA.achatsAPayer(etat, today)
  assert.equal(a.totalTTC, 600, 'achats à payer = FA1 seule (FA2 est payée, FA3 pas validée)')
  assert.equal(a.nb, 1)
  assert.equal(a.retardTTC, 600, 'l’échéance du 20/07 est dépassée : FA1 est en retard')
  assert.equal(a.nbRetard, 1)
  assert.equal(a.aValiderTTC, 120, 'la boîte d’arrivée est comptée À PART — pas encore une dette certaine')
  assert.equal(a.nbAValider, 1)
}

// --- 2. Finance.tsx n'invente aucun calcul ----------------------------------

const finance = lire('src/modules/Finance.tsx')

assert.match(
  finance,
  /import \{[^}]*meteoFinanciere[^}]*\} from '\.\.\/derive'/,
  'la tuile Trésorerie doit lire meteoFinanciere (le sélecteur que le Cockpit lit déjà), pas state.settings en direct',
)
assert.match(
  finance,
  /import \{[^}]*analyserPeriode[^}]*\} from '\.\.\/derive'/,
  'la marge de l’année doit venir d’analyserPeriode — la définition partagée avec Pilotage et la Revue / PDF',
)
for (const selecteur of ['aEncaisser', 'aFacturer', 'achatsAPayer']) {
  assert.match(
    finance,
    new RegExp(`import \\{[^}]*\\b${selecteur}\\b[^}]*\\} from '\\.\\.\\/financeActions'`),
    `la tuile correspondante doit importer ${selecteur} depuis financeActions : recalculé sur place, le chiffre divergerait de l'onglet d'action`,
  )
}

// TVA : la tuile reprend LE chiffre de la carte (positionTVA) et mène à la
// carte (vue Comptable) — ou la carte elle-même est montée sur l'écran
const tuileTVA =
  /import \{[^}]*positionTVA[^}]*\} from '\.\.\/tva'/.test(finance) &&
  finance.includes('#/finance/comptable')
const carteMontee = /import CarteTVA from '\.\/CarteTVA'/.test(finance) && /<CarteTVA\s*\/?>/.test(finance)
assert.ok(
  tuileTVA || carteMontee,
  'le chiffre TVA de L’essentiel doit être celui de la carte : positionTVA (src/tva.ts) + lien vers la vue Comptable, ou CarteTVA montée',
)

// interdiction du recalcul local : l'écran ne touche pas les collections,
// il lit des sélecteurs. Un `state.factures` ou un `.reduce(` réapparu ici
// est le début de la double vérité que cet écran doit précisément éviter.
assert.ok(
  !/state\.factures\b/.test(finance),
  'Finance.tsx repointe state.factures : « à encaisser » appartient à financeActions.aEncaisser',
)
assert.ok(
  !/state\.facturesAchat\b/.test(finance),
  'Finance.tsx repointe state.facturesAchat : « achats à payer » appartient à financeActions.achatsAPayer',
)
assert.ok(
  !/state\.echeancesFacturation\b/.test(finance),
  'Finance.tsx repointe state.echeancesFacturation : « à facturer » appartient à financeActions.aFacturer',
)
assert.ok(
  !/\.reduce\(/.test(finance),
  'Finance.tsx contient un .reduce( : un agrégat local recalcule ce qu’un sélecteur doit fournir',
)

// --- 3. six tuiles, chacune un LIEN vers l'onglet où l'on agit --------------

const nbTuiles = (finance.match(/<Tuile\b/g) || []).length
assert.equal(nbTuiles, 6, `six tuiles attendues sur L'essentiel, ${nbTuiles} trouvée(s) — ni tableau-fleuve, ni chiffre orphelin`)

for (const libelle of ['Trésorerie disponible', 'À encaisser', 'À facturer', 'Achats à payer', "TVA due à l'État", 'Marge ']) {
  assert.ok(finance.includes(libelle), `tuile « ${libelle.trim()} » absente de L'essentiel`)
}
for (const lien of ['#/finance/banque', '#/facturation', '#/finance/achats', '#/finance/comptable', '#/pilotage']) {
  assert.ok(finance.includes(`"${lien}"`), `la destination ${lien} doit être le lien d'une tuile : un chiffre sans porte de sortie ne fait pas agir`)
}
assert.ok(
  /className="tuile-lien"[\s\S]{0,120}href=\{href\}/.test(finance) || /<a[^>]*className="tuile-lien"/.test(finance),
  'la tuile entière doit être un lien (<a class="tuile-lien">), pas un simple bloc',
)

// --- 4. FinanceNav : neuf destinations, deux rangs, zéro suppression --------

const nav = lire('src/modules/FinanceNav.tsx')
const entrees = [...nav.matchAll(/\{ id: '(\w+)', label: .+?, route: '([^']+)', rang: '(principal|secondaire)' \}/g)].map(
  (m) => ({ id: m[1], route: m[2], rang: m[3] }),
)
assert.equal(entrees.length, 9, 'les NEUF destinations de la sphère Finance doivent rester déclarées (inventaire 5.17 non coché : rien ne se supprime)')

const routesAttendues = [
  '/finance',
  '/contrats',
  '/facturation',
  '/finance/achats',
  '/finance/banque',
  '/finance/comptable',
  '/finance/revue',
  '/finance/previsions',
  '/finance/connecteurs',
]
for (const route of routesAttendues) {
  assert.ok(
    entrees.some((e) => e.route === route),
    `la destination ${route} a disparu de FinanceNav : on hiérarchise, on ne supprime pas`,
  )
}
assert.deepEqual(
  entrees.filter((e) => e.rang === 'principal').map((e) => e.id),
  ['ensemble', 'ventes', 'achats', 'banque'],
  'rang principal attendu : L’essentiel · Ventes · Achats & frais · Banque',
)
assert.equal(
  entrees.filter((e) => e.rang === 'secondaire').length,
  5,
  'les cinq autres vues restent au rang secondaire — visibles, jamais retirées',
)
assert.match(nav, /label: "L'essentiel"/, 'l’onglet d’entrée s’appelle « L’essentiel »')
// le rang secondaire doit être RENDU (une déclaration sans rendu serait un
// masquage de fait — exactement ce que la décision du 04/08 s'interdit)
assert.match(nav, /tabs-secondaires/, 'le rang secondaire doit être affiché (classe tabs-secondaires), pas seulement déclaré')
assert.match(nav, /secondaires\.map/, 'chaque destination secondaire doit être rendue en bouton cliquable')

// --- 5. la décision est écrite là où l'inventaire vit -----------------------

const inventaire = lire('docs/INVENTAIRE_FINANCE.md')
assert.ok(
  inventaire.includes('## Décision du 04/08'),
  'docs/INVENTAIRE_FINANCE.md doit porter la section « Décision du 04/08 » (regroupement visuel, zéro suppression, cochage à faire)',
)
assert.ok(
  /zéro suppression/i.test(inventaire),
  'la décision doit dire explicitement : zéro suppression',
)

console.log(
  'L’essentiel : sélecteurs exacts sur cas posés à la main, « à facturer » = les actions « Émettre » (une seule liste), ' +
    'Finance.tsx sans aucun recalcul local, six tuiles-liens, neuf destinations conservées sur deux rangs, décision documentée.',
)
