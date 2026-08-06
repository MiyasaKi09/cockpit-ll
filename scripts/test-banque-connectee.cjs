// Connexion bancaire directe (GoCardless Bank Account Data) — les trois
// façons dont ce branchement peut mentir SANS jamais produire d'erreur.
//
// LE DÉFAUT N° 1 QU'IL FERME — LE MÊME MOUVEMENT COMPTÉ DEUX FOIS
// ----------------------------------------------------------------
// Le Cockpit sait déjà lire un relevé (CAMT.053, OFX, QIF, CSV). L'API en
// apporte désormais les mêmes mouvements par un second tuyau. L'idempotence
// du dépôt tient sur UNE clé — `date + montant + libellé` replié
// (`idsTransactions`, src/banque.ts) : si le libellé fabriqué par l'API
// diffère d'un caractère de celui du fichier, le même virement entre DEUX
// FOIS, la trésorerie double, et rien ne le dit. C'est le cas de panne le
// plus probable de cette livraison, et il ne ressemble pas à une panne.
//
// Ce test le rejoue avec le VRAI code des deux côtés : `lireCAMT053` /
// `lireOFX` (src/imports.ts) pour le fichier, `operationsVersLignes`
// (src/banqueApi.ts) pour l'API, `preparerImport` (src/banque.ts) pour le
// dépôt. Les deux chemins doivent produire la MÊME ligne — pas une ligne
// « équivalente ».
//
// LE DÉFAUT N° 2 — LE SOLDE ABSENT ÉCRIT 0 (le défaut exact du lot D2)
// ---------------------------------------------------------------------
// Berlin Group ne définit pas « le » solde : `balances` est un TABLEAU, et
// chaque banque publie les types qu'elle veut. Une synchronisation qui ne
// trouve rien d'exploitable doit écrire `null` — jamais 0, qui afficherait
// une trésorerie à zéro euro, et jamais « rien », qui laisserait le solde
// d'avant passer pour frais. Et elle doit le DIRE.
//
// LE DÉFAUT N° 3 — LA TRÉSORERIE QUI SE FIGE EN SILENCE
// -------------------------------------------------------
// L'autorisation DSP2 meurt à 90 jours, à date connue d'avance. Une
// connexion expirée ne produit pas d'écran rouge : elle produit un écran
// CALME et un solde qui vieillit. On vérifie donc les deux mécanismes — la
// date (annoncée à J−7) et le filet (le 401 `AccessExpiredError`, qu'un
// relais naïf confondrait avec un jeton d'API périmé et rejouerait en
// boucle).

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')
const arbre = (f) => ts.createSourceFile(f, lire(f), ts.ScriptTarget.ES2022, true)

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

/** le texte d'une fonction de premier niveau OU d'un `const … = (…) => …`,
 *  isolé par le compilateur : découper au `indexOf` ferait dépendre le test
 *  de l'ordre des déclarations dans le fichier */
function corpsDe(chemin, nom) {
  const sf = arbre(chemin)
  let trouve = null
  const parcourir = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.name.text === nom) trouve = n
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === nom && n.initializer) {
      trouve = n
    }
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)
  assert.ok(trouve, `${chemin} : ${nom} est introuvable — ce test parle d’un code qui n’existe plus`)
  return trouve.getText()
}

const BANQUE = 'src/modules/Banque.tsx'
/** l'intégration d'une synchronisation, isolée par le compilateur — c'est le
 *  seul endroit du Cockpit où des mouvements rapatriés entrent */
const integrer = corpsDe(BANQUE, 'integrer')

// ============================================================
// 0. LES DEUX FICHIERS DENO SE COMPILENT, ET LA MOITIÉ TESTABLE S'EXÉCUTE
// ============================================================

for (const f of ['supabase/functions/banque-sync/gocardless.ts', 'supabase/functions/banque-sync/index.ts']) {
  const r = ts.transpileModule(lire(f), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: f,
    reportDiagnostics: true,
  })
  const erreurs = (r.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error)
  assert.equal(
    erreurs.length,
    0,
    `${f}: ${erreurs.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`,
  )
}

const G = charger('supabase/functions/banque-sync/gocardless.ts')

// --- 0.1 le préfixe `/api/` : le Quickstart officiel publie une URL morte ---
assert.equal(G.CHEMINS.jetonRafraichi, '/api/v2/token/refresh/', 'sans `/api/`, GoCardless rend un 404')
assert.equal(G.CHEMINS.jetonNouveau, '/api/v2/token/new/')
assert.equal(G.BASE_GOCARDLESS, 'https://bankaccountdata.gocardless.com')

// --- 0.2 DEUX 401 QUI NE VEULENT PAS DIRE LA MÊME CHOSE ----------------------
//
// C'est LE piège de ce raccordement. Les confondre donne l'un des deux
// silences : soit on rejoue à l'infini un consentement mort, soit on demande
// à quelqu'un de se reconnecter alors qu'il suffisait de rafraîchir un jeton.
assert.equal(
  G.lireReponseGoCardless(401, { summary: 'Invalid token', detail: 'Token is invalid or expired' }).genre,
  'jeton_invalide',
  '401 sans `type` = jeton d’API périmé (24 h) : on rafraîchit, on ne dérange personne',
)
assert.equal(
  G.lireReponseGoCardless(401, {
    summary: 'Access expired',
    detail: "The end user's access to this account has expired",
    type: 'AccessExpiredError',
  }).genre,
  'reconnexion',
  '401 `AccessExpiredError` = consentement DSP2 mort : aucun rafraîchissement ne le répare',
)
// `detail` est du texte libre : il ne doit JAMAIS servir de discriminant.
assert.equal(
  G.lireReponseGoCardless(401, { detail: 'access expired, please reconnect' }).genre,
  'jeton_invalide',
  'seul le champ `type` discrimine — analyser `detail` ferait dépendre la trésorerie d’une phrase anglaise',
)
assert.equal(G.lireReponseGoCardless(403, { type: 'IPAccessDenied' }).genre, 'autre')
assert.match(G.lireReponseGoCardless(403, { type: 'IPAccessDenied' }).message, /adresse IP/)
assert.equal(G.lireReponseGoCardless(429, {}).genre, 'quota')
assert.equal(G.lireReponseGoCardless(409, {}).genre, 'patienter')
assert.equal(G.lireReponseGoCardless(503, {}).genre, 'indisponible')
assert.equal(G.lireReponseGoCardless(200, { any: 1 }).genre, 'ok')

// --- 0.3 les deux autres signaux de reconnexion ------------------------------
// L'erreur 401 n'arrive qu'au moment où tout est déjà cassé. Le statut de la
// demande et celui du compte, eux, se lisent AVANT.
for (const statut of ['EX', 'RJ', 'SU', 'ER']) {
  assert.equal(G.statutDemandeExigeReconnexion(statut), true, `demande ${statut}`)
}
assert.equal(G.statutDemandeExigeReconnexion('LN'), false)
assert.equal(G.statutCompteExigeReconnexion('EXPIRED'), true)
assert.equal(G.statutCompteExigeReconnexion('SUSPENDED'), true)
assert.equal(G.statutCompteExigeReconnexion('READY'), false)

// --- 0.4 on ne demande JAMAIS plus de 90 jours d'accès -----------------------
// Le schéma accepte 730. Demander deux ans et se croire tranquille est la
// façon exacte de découvrir l'expiration le jour où elle tombe.
assert.equal(G.ACCES_MAX_JOURS, 90)
assert.equal(G.borner(730, 1, G.ACCES_MAX_JOURS, G.ACCES_DEFAUT_JOURS), 90)
assert.equal(G.borner(undefined, 1, G.ACCES_MAX_JOURS, G.ACCES_DEFAUT_JOURS), 90)

// --- 0.5 le consentement se DATE, il ne se suppose pas ----------------------
assert.equal(
  G.expirationConsentement('2026-05-10T09:00:00Z', 90).slice(0, 10),
  '2026-08-08',
  'fin = acceptation + access_valid_for_days',
)
assert.equal(G.expirationConsentement(null, 90), null, 'sans acceptation connue : null, pas une date rassurante')
assert.equal(G.expirationConsentement('2026-05-10T09:00:00Z', null), null)

// --- 0.6 les opérations `pending` n'entrent pas ------------------------------
// Elles n'ont pas de date de comptabilisation définitive : elles
// reparaîtraient plus tard sous une autre forme, et la clé date+montant+libellé
// ne peut pas reconnaître les deux comme un seul mouvement.
{
  const corps = {
    transactions: {
      booked: [{ bookingDate: '2026-08-03', transactionAmount: { amount: '10.00' } }],
      pending: [{ valueDate: '2026-08-05', transactionAmount: { amount: '20.00' } }],
    },
  }
  const lues = G.operationsComptabilisees(corps)
  assert.equal(lues.length, 1, 'seules les opérations comptabilisées entrent')
  assert.equal(G.masquerIban('FR76 3000 4000 0312 3456 7890 143'), '…0143')
  assert.equal(G.masquerIban(null), null)
}

console.log('OK — gocardless.ts : chemins, 401 ≠ 401, signaux de reconnexion, bornes, soldes et opérations.')

// ============================================================
// 1. LE MÊME MOUVEMENT PAR L'API ET PAR UN FICHIER — UNE SEULE LIGNE
// ============================================================

const B = charger('src/banque.ts')
const I = charger('src/imports.ts')
const BA = charger('src/banqueApi.ts')

// --- un DOM minimal pour que `lireCAMT053` s'exécute réellement -------------
// Le libellé de l'API a été copié champ par champ sur celui du CAMT.053 : la
// seule façon honnête de le vérifier est de faire tourner le VRAI lecteur
// CAMT. Les résultats du lecteur sont contrôlés un à un juste après, pour
// qu'un défaut de ce bac à sable se voie au lieu de faire passer le test.
function installerDOM() {
  const analyser = (xml) => {
    const racineDoc = { localName: '#document', enfants: [], propre: '' }
    const pile = [racineDoc]
    const source = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    const jeton = /<\s*(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)\s*>|([^<]+)/g
    let m
    while ((m = jeton.exec(source)) !== null) {
      if (m[5] != null) {
        pile[pile.length - 1].propre += m[5]
        continue
      }
      const nom = m[2].includes(':') ? m[2].split(':').pop() : m[2]
      if (m[1] === '/') {
        pile.pop()
        continue
      }
      const noeud = { localName: nom, enfants: [], propre: '' }
      pile[pile.length - 1].enfants.push(noeud)
      if (m[4] !== '/') pile.push(noeud)
    }
    const equiper = (n) => {
      const descendants = []
      const collecter = (x) => {
        for (const e of x.enfants) {
          descendants.push(e)
          collecter(e)
        }
      }
      collecter(n)
      n.getElementsByTagName = (sel) => (sel === '*' ? descendants : descendants.filter((e) => e.localName === sel))
      Object.defineProperty(n, 'textContent', {
        get() {
          let t = n.propre
          for (const e of n.enfants) t += e.textContent
          return t
        },
        configurable: true,
      })
      for (const e of n.enfants) equiper(e)
    }
    equiper(racineDoc)
    return racineDoc
  }
  global.DOMParser = class {
    parseFromString(xml) {
      return analyser(xml)
    }
  }
}
installerDOM()

// Un virement encaissé, un loyer prélevé — le même jour, dans les deux
// tuyaux. Le CAMT porte le sens par `CdtDbtInd`, l'API par le SIGNE du
// montant : c'est déjà une occasion de produire deux lignes pour un fait.
const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt><Stmt>
    <Ntry>
      <Amt Ccy="EUR">4800.00</Amt>
      <CdtDbtInd>CRDT</CdtDbtInd>
      <BookgDt><Dt>2026-08-03</Dt></BookgDt>
      <ValDt><Dt>2026-08-04</Dt></ValDt>
      <NtryDtls><TxDtls><RmtInf>
        <Ustrd>VIR COMMUNE DE CHAMANT   FACT 2026-050</Ustrd>
      </RmtInf></TxDtls></NtryDtls>
    </Ntry>
    <Ntry>
      <Amt Ccy="EUR">1200.00</Amt>
      <CdtDbtInd>DBIT</CdtDbtInd>
      <BookgDt><Dt>2026-08-03</Dt></BookgDt>
      <NtryDtls><TxDtls><RmtInf><Ustrd>PRLV LOYER AGENCE</Ustrd></RmtInf></TxDtls></NtryDtls>
    </Ntry>
  </Stmt></BkToCstmrStmt>
</Document>`

const OPERATIONS_API = [
  {
    transactionId: 'gc-1',
    bookingDate: '2026-08-03',
    valueDate: '2026-08-04',
    transactionAmount: { amount: '4800.00', currency: 'EUR' },
    remittanceInformationUnstructured: 'VIR COMMUNE DE CHAMANT   FACT 2026-050',
    creditorName: 'COMMUNE DE CHAMANT',
  },
  {
    transactionId: 'gc-2',
    bookingDate: '2026-08-03',
    transactionAmount: { amount: '-1200.00', currency: 'EUR' },
    remittanceInformationUnstructured: 'PRLV LOYER AGENCE',
  },
]

const duFichier = I.lireCAMT053(CAMT)
// Le bac à sable XML est contrôlé ici, pas supposé : si ces trois lignes
// tombent, c'est le harnais qu'il faut corriger, pas le Cockpit.
assert.deepEqual(
  duFichier,
  [
    { date: '2026-08-03', montant: 4800, libelle: 'VIR COMMUNE DE CHAMANT FACT 2026-050' },
    { date: '2026-08-03', montant: -1200, libelle: 'PRLV LOYER AGENCE' },
  ],
  'lecture CAMT.053 : date de comptabilisation, sens par CdtDbtInd, libellé Ustrd aux espaces écrasés',
)

const deLAPI = BA.operationsVersLignes(OPERATIONS_API)
assert.equal(deLAPI.ignorées, 0)
assert.deepEqual(
  deLAPI.lignes,
  duFichier,
  'L’API et le fichier doivent produire la MÊME LigneRelevee, au caractère près.\n' +
    'Sinon la clé d’idempotence (date + montant + libellé) ne les reconnaît pas comme un seul\n' +
    'mouvement : le virement entre deux fois, la trésorerie double, et AUCUN message ne le dit.',
)

// … et jusqu'à l'identifiant de dépôt, qui est la clé réelle.
assert.deepEqual(
  B.idsTransactions(deLAPI.lignes),
  B.idsTransactions(duFichier),
  'les identifiants de dépôt doivent coïncider : c’est EUX qui dédoublonnent, pas le libellé affiché',
)

// --- 1.1 le scénario redouté : API le matin, fichier l'après-midi -----------
{
  let etat = { transactionsBancaires: [], importsBancaires: [] }

  const api = B.preparerImport(etat, BA.operationsVersLignes(OPERATIONS_API).lignes, 'imp-api')
  assert.equal(api.nouvelles.length, 2)
  assert.equal(api.doublons, 0)
  etat = { ...etat, transactionsBancaires: [...etat.transactionsBancaires, ...api.nouvelles] }

  const fichier = B.preparerImport(etat, I.lireCAMT053(CAMT), 'imp-camt')
  assert.equal(
    fichier.nouvelles.length,
    0,
    'le relevé CAMT du même jour ne doit RIEN ajouter : ces mouvements sont déjà entrés par l’API',
  )
  assert.equal(fichier.doublons, 2)

  // et dans l'autre sens — c'est l'ordre le plus fréquent en vrai
  let inverse = { transactionsBancaires: [], importsBancaires: [] }
  const camt = B.preparerImport(inverse, I.lireCAMT053(CAMT), 'imp-camt')
  inverse = { ...inverse, transactionsBancaires: [...inverse.transactionsBancaires, ...camt.nouvelles] }
  const apres = B.preparerImport(inverse, BA.operationsVersLignes(OPERATIONS_API).lignes, 'imp-api')
  assert.equal(apres.nouvelles.length, 0, 'la synchronisation qui suit un import de relevé n’ajoute rien')
  assert.equal(apres.doublons, 2)
}

// --- 1.2 le même mouvement par OFX (second lecteur, sans DOM) ---------------
{
  const ofx = [
    '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>',
    '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260803<TRNAMT>4800.00',
    '<NAME>VIR COMMUNE DE CHAMANT   FACT 2026-050</STMTTRN>',
    '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
  ].join('\n')
  let etat = { transactionsBancaires: [], importsBancaires: [] }
  const dep = B.preparerImport(etat, I.lireOFX(ofx), 'imp-ofx')
  assert.equal(dep.nouvelles.length, 1)
  etat = { ...etat, transactionsBancaires: dep.nouvelles }
  const parApi = B.preparerImport(etat, BA.operationsVersLignes([OPERATIONS_API[0]]).lignes, 'imp-api')
  assert.equal(parApi.nouvelles.length, 0, 'OFX puis API : un seul mouvement, comme pour le CAMT')
}

// --- 1.3 resynchroniser ne réécrit rien -------------------------------------
{
  let etat = { transactionsBancaires: [], importsBancaires: [] }
  const un = B.preparerImport(etat, BA.operationsVersLignes(OPERATIONS_API).lignes, 'i1')
  etat = { ...etat, transactionsBancaires: un.nouvelles }
  const deux = B.preparerImport(etat, BA.operationsVersLignes(OPERATIONS_API).lignes, 'i2')
  assert.equal(deux.nouvelles.length, 0, 'synchroniser deux fois de suite n’ajoute AUCUNE ligne')
}

// --- 1.4 deux paiements IDENTIQUES le même jour restent DEUX ----------------
//
// C'est la raison pour laquelle la fenêtre de synchronisation est FIXE
// (90 jours) et non glissante : une fenêtre qui bouge couperait la paire en
// deux lots, et le second passerait pour un doublon. Un vrai encaissement
// disparaîtrait, sans un mot.
{
  const jumeaux = [
    { bookingDate: '2026-08-03', transactionAmount: { amount: '150.00' }, remittanceInformationUnstructured: 'CB FOURNITURES' },
    { bookingDate: '2026-08-03', transactionAmount: { amount: '150.00' }, remittanceInformationUnstructured: 'CB FOURNITURES' },
  ]
  const lignes = BA.operationsVersLignes(jumeaux).lignes
  const dep = B.preparerImport({ transactionsBancaires: [], importsBancaires: [] }, lignes, 'i')
  assert.equal(dep.nouvelles.length, 2, 'deux paiements identiques le même jour sont deux mouvements')
  const rejeu = B.preparerImport({ transactionsBancaires: dep.nouvelles, importsBancaires: [] }, lignes, 'i2')
  assert.equal(rejeu.nouvelles.length, 0, '… et les revoir n’en crée pas deux de plus')
}

// --- 1.5 une opération illisible est COMPTÉE, jamais devinée ---------------
{
  const r = BA.operationsVersLignes([
    { transactionAmount: { amount: '10.00' } }, // sans date
    { bookingDate: '2026-08-03', transactionAmount: { amount: 'abc' } }, // montant illisible
    null,
    { bookingDate: '2026-08-03T10:12:00Z', transactionAmount: { amount: 12 } }, // horodatage toléré
  ])
  assert.equal(r.lignes.length, 1)
  assert.equal(r.ignorées, 3, 'ce qui n’a pas pu être lu se compte — le silence ferait croire à un relevé vide')
  assert.equal(r.lignes[0].date, '2026-08-03')
  assert.equal(r.lignes[0].libelle, 'Mouvement', 'sans libellé publié : le même repli que le lecteur CAMT')
}

// --- 1.6 la cascade de libellés, dans l'ordre du lecteur CAMT ---------------
{
  const l = (o) => BA.operationsVersLignes([{ bookingDate: '2026-08-03', transactionAmount: { amount: '1' }, ...o }]).lignes[0].libelle
  assert.equal(l({ remittanceInformationUnstructured: 'A', additionalInformation: 'B', creditorName: 'C' }), 'A')
  assert.equal(l({ additionalInformation: 'B', creditorName: 'C' }), 'B')
  assert.equal(l({ creditorName: 'C' }), 'C')
  assert.equal(l({ debtorName: 'D' }), 'D')
  assert.equal(l({ remittanceInformationUnstructuredArray: ['X', 'Y'] }), 'X Y')
  assert.equal(l({ remittanceInformationUnstructured: `${'z'.repeat(200)}` }).length, 140, 'troncature à 140, comme le CAMT')
}

// --- 1.7 PLUSIEURS COMPTES DANS LE MÊME PASSAGE ---------------------------
//
// Une banque peut rendre le même mouvement sur deux comptes du même lot (un
// virement interne, un compte joint relu deux fois). Si chaque compte est
// dédoublonné contre l'état d'AVANT le passage, les deux entrent — et pire,
// avec le MÊME identifiant, puisque le compteur de doublons repart à zéro à
// chaque appel. Deux lignes qui portent une seule identité : le « Annuler »
// en retire deux, la trésorerie en compte deux.
{
  const mouvement = [
    { bookingDate: '2026-08-03', transactionAmount: { amount: '250.00' }, remittanceInformationUnstructured: 'VIR INTERNE' },
  ]
  const lignes = BA.operationsVersLignes(mouvement).lignes
  const depart = { transactionsBancaires: [], importsBancaires: [] }

  // ce qui se passerait si chaque compte regardait l'état d'avant le passage
  const compteA = B.preparerImport(depart, lignes, 'impA')
  const compteBPerime = B.preparerImport(depart, lignes, 'impB')
  assert.equal(
    compteA.nouvelles[0].id,
    compteBPerime.nouvelles[0].id,
    'un état de comparaison périmé produit DEUX mouvements portant le MÊME identifiant',
  )

  // ce que fait l'écran : la vue avance d'un compte au suivant
  const vue = { ...depart, transactionsBancaires: [...depart.transactionsBancaires, ...compteA.nouvelles] }
  const compteBaJour = B.preparerImport(vue, lignes, 'impB')
  assert.equal(compteBaJour.nouvelles.length, 0)
  assert.equal(compteBaJour.doublons, 1, 'avec la vue à jour, le second compte reconnaît le mouvement déjà pris')
}
assert.match(
  integrer,
  /preparerImport\(vue,/,
  'chaque compte doit se dédoublonner contre la vue DÉJÀ enrichie par les comptes précédents du même passage,\n' +
    'jamais contre l’état d’avant la synchronisation (cf. 1.7 : deux lignes, un seul identifiant)',
)
assert.match(
  integrer,
  /vue = \{ \.\.\.vue, transactionsBancaires: \[\.\.\.vue\.transactionsBancaires, \.\.\.prepare\.nouvelles\] \}/,
  '… et cette vue doit effectivement avancer',
)

console.log('OK — rapprochement : API et fichier produisent la même ligne, dans les deux ordres, et se dédoublonnent.')

// ============================================================
// 2. LE SOLDE — « null n'est pas 0 », et l'absence se DIT
// ============================================================

// --- 2.1 rien d'exploitable ⇒ null ------------------------------------------
assert.equal(BA.choisirSolde([]), null, 'aucun solde publié : null')
assert.equal(
  BA.choisirSolde([{ type: 'information', montant: 0, date: null }]),
  null,
  '`information` n’est pas un solde de compte : le retenir afficherait un montant qui ne veut rien dire',
)
assert.equal(BA.choisirSolde([{ type: 'nonInvoiced', montant: 12, date: null }]), null)
assert.equal(BA.choisirSolde([{ type: 'closingBooked', montant: Number.NaN, date: null }]), null)
assert.equal(BA.choisirSolde(undefined), null)

// --- 2.2 la cascade, indépendante de l'ordre du tableau ---------------------
{
  const choisi = BA.choisirSolde([
    { type: 'interimAvailable', montant: 9999, date: '2026-08-05' },
    { type: 'closingBooked', montant: 12345.67, date: '2026-08-04' },
  ])
  assert.equal(choisi.montant, 12345.67, 'le comptable prime sur le disponible : c’est lui qui se compare au relevé')
  assert.equal(choisi.type, 'closingBooked')
  assert.equal(choisi.attendu, true)
}
// un type hors cascade est RETENU (il vaut mieux qu'une perte) mais SIGNALÉ
{
  const choisi = BA.choisirSolde([{ type: 'soldeMaison', montant: 42, date: null }])
  assert.equal(choisi.montant, 42)
  assert.equal(choisi.attendu, false, 'un type inconnu s’affiche avec sa réserve, il ne se fait pas passer pour normal')
  assert.equal(choisi.date, null, 'une date absente reste absente')
}

// --- 2.3 la conséquence, en chiffres : sans solde, la trésorerie NE BOUGE PAS
//
// C'est le défaut du lot D2, rejoué avec le vrai `soldeBancaire`. Écrire 0
// afficherait « 0,00 € » ; écrire la date sans le solde ferait passer un
// vieux montant pour frais. La seule réponse honnête est de ne rien poser.
{
  const sansSolde = {
    transactionsBancaires: [{ id: 't1', date: '2026-08-03', montant: 4800, libelle: 'VIR' }],
    importsBancaires: [
      { id: 'imp-1', date: '2026-08-06', nomFichier: 'Banque — synchronisation', nbLignes: 1, nbNouvelles: 1, soldeFinal: null, dateSolde: null },
    ],
  }
  assert.equal(B.soldeBancaire(sansSolde), null, 'sans solde publié, aucune trésorerie n’est affirmée')

  const avecZero = {
    ...sansSolde,
    importsBancaires: [{ ...sansSolde.importsBancaires[0], soldeFinal: 0, dateSolde: '2026-08-06' }],
  }
  assert.equal(
    B.soldeBancaire(avecZero).solde,
    0,
    'et si la synchronisation écrivait 0 « pour ne pas laisser vide », le Cockpit afficherait une agence à zéro euro',
  )
}

// --- 2.4 l'écran écrit `null` et le DIT ------------------------------------
assert.match(
  integrer,
  /const soldeFinal = choisi \? choisi\.montant : null/,
  'la synchronisation doit écrire null quand la banque ne publie rien — jamais 0, jamais « on garde l’ancien »',
)
assert.doesNotMatch(
  integrer,
  /soldeFinal\s*(\?\?|\|\|)\s*0|soldeFinal:\s*0\b/,
  'aucun repli à 0 : c’est exactement le défaut du lot D2',
)
assert.match(
  integrer,
  /SANS solde publié/,
  'l’absence de solde doit être DITE à l’écran : un silence se lit comme « tout va bien »',
)
assert.match(
  integrer,
  /typesVus/,
  'les `balanceType` réellement reçus doivent être nommés — ils ne se devinent pas d’une banque à l’autre',
)
assert.match(
  lire(BANQUE),
  /aucun solde publié/,
  'la carte de connexion doit dire, compte par compte, qu’aucun solde n’a été publié',
)

console.log('OK — solde : null quand la banque ne publie rien, cascade explicite, absence annoncée.')

// ============================================================
// 3. L'EXPIRATION SE VOIT AVANT DE CASSER, ET LE SILENCE SE MESURE
// ============================================================

const connexion = (o) => ({
  id: 'c1',
  banque: 'Crédit Agricole',
  statut: 'liee',
  statutGocardless: 'LN',
  accesJours: 90,
  consentementAccepteLe: '2026-05-10T09:00:00Z',
  consentementExpireLe: '2026-08-08T09:00:00Z',
  derniereSyncLe: '2026-08-05',
  derniereSyncResultat: '2 mouvement(s) intégré(s)',
  vuLe: '2026-08-06',
  comptes: [],
  ...o,
})

// --- 3.1 J−7 : on prévient une semaine avant, pas le jour du blocage --------
assert.equal(BA.SEUIL_RECONNEXION_JOURS, 7)
assert.equal(BA.etatConsentement(connexion(), '2026-08-01').alerter, true, 'J−7 : on prévient')
assert.equal(BA.etatConsentement(connexion(), '2026-07-31').alerter, false, 'J−8 : rien à dire encore')
assert.equal(BA.etatConsentement(connexion(), '2026-08-01').jours, 7)
assert.equal(BA.etatConsentement(connexion(), '2026-08-09').expire, true)
assert.equal(BA.etatConsentement(connexion({ statut: 'expiree' }), '2026-06-01').expire, true)

// --- 3.2 une expiration INCONNUE n'est pas une expiration lointaine ---------
{
  const inconnue = BA.etatConsentement(connexion({ consentementExpireLe: null }), '2026-08-06')
  assert.equal(inconnue.connu, false)
  assert.equal(inconnue.jours, null, 'null, jamais un nombre de jours inventé')
  assert.equal(inconnue.expire, false)
}

// --- 3.3 la synchronisation muette : le silence se compte en jours ----------
assert.equal(BA.etatSynchronisation(connexion(), '2026-08-06').jours, 1)
assert.equal(BA.etatSynchronisation(connexion(), '2026-08-06').alerter, false)
assert.equal(BA.etatSynchronisation(connexion(), '2026-08-14').alerter, true, 'plus de 7 jours sans rien : on le dit')
assert.equal(BA.etatSynchronisation(connexion(), '2026-08-14').morte, false)
assert.equal(
  BA.etatSynchronisation(connexion(), '2026-08-28').morte,
  true,
  'trois semaines de silence : la trésorerie affichée n’a plus de rapport avec la banque',
)
// jamais synchronisée : on part de l'acceptation du consentement, sinon rien
// ne se compterait et l'écran resterait calme indéfiniment.
{
  const jamais = BA.etatSynchronisation(connexion({ derniereSyncLe: null }), '2026-08-06')
  assert.equal(jamais.jamais, true)
  assert.equal(jamais.jours, 88)
  assert.equal(jamais.alerter, true)
}

// --- 3.4 le fil d'urgences dit les deux, et jamais les deux à la fois -------
const A = charger('src/alerts.ts')
const etatBase = {
  settings: { snoozes: {}, vus: {}, seuilDeriveHeures: 0.9, nomAgence: 'L&L', delaisPaiement: {}, personnes: [], equipe: [] },
  projets: [],
  factures: [],
  echeancesFacturation: [],
  paiements: [],
  situations: [],
  marches: [],
  tachesChantier: [],
  visas: [],
  cotraitants: [],
  notesHonoraires: [],
  obligations: [],
  contacts: [],
  organisations: [],
  reunions: [],
  artisans: [],
  temps: [],
  connexionsBancaires: [],
  chorusInconnues: [],
}
const alertesPour = (c, jour) => A.computeAlertes({ ...etatBase, connexionsBancaires: [c] }, jour)

{
  const a = alertesPour(connexion(), '2026-08-03').find((x) => x.type === 'banque_consentement')
  assert.ok(a, 'à J−5, l’autorisation à renouveler doit apparaître au fil d’urgences')
  assert.equal(a.gravite, 2, 'à venir : orange — il reste le temps de faire le geste tranquillement')
  assert.match(a.titre, /autorisation à renouveler sous 5 j/)
  assert.equal(
    a.lien,
    '#/finance/banque/c1',
    'le lien doit mener à LA connexion concernée, là où « Reconnecter » attend — pas en haut d’une liste',
  )
}
{
  const a = alertesPour(connexion(), '2026-08-20').find((x) => x.type === 'banque_consentement')
  assert.equal(a.gravite, 3, 'expirée : plus rien n’entre, c’est rouge')
  assert.match(a.titre, /plus aucun mouvement n'entre/)
}
{
  // Consentement encore valable, mais plus de trois semaines sans rien.
  const c = connexion({ consentementExpireLe: '2026-12-01T09:00:00Z', derniereSyncLe: '2026-07-10' })
  const a = alertesPour(c, '2026-08-06').find((x) => x.type === 'banque_sync_muette')
  assert.ok(a, 'une synchronisation morte doit se voir : elle ne produit AUCUNE erreur, seulement du calme')
  assert.equal(a.gravite, 3)
  assert.match(a.titre, /aucune synchronisation depuis 27 j/)
  assert.equal(a.lien, '#/finance/banque/c1')
}
{
  // Les deux faits à la fois : une seule nouvelle. Le silence de la
  // synchronisation est la CONSÉQUENCE du consentement mort, pas une
  // seconde information.
  const c = connexion({ consentementExpireLe: '2026-08-08T09:00:00Z', derniereSyncLe: '2026-07-01' })
  const alertes = alertesPour(c, '2026-08-06')
  assert.equal(alertes.filter((x) => x.type === 'banque_consentement').length, 1)
  assert.equal(
    alertes.filter((x) => x.type === 'banque_sync_muette').length,
    0,
    'pas deux alertes pour un seul fait',
  )
}
{
  // Une connexion en attente de la banque n'alerte pas : rien n'a encore été
  // promis, il n'y a donc rien qui expire.
  const alertes = alertesPour(connexion({ statut: 'en_attente', consentementExpireLe: null }), '2026-08-06')
  assert.equal(alertes.filter((x) => x.type.startsWith('banque_')).length, 0)
}

// --- 3.5 l'écran montre la date de dernière synchronisation RÉUSSIE ---------
const source = lire(BANQUE)
assert.match(source, /connexion\.derniereSyncLe \?/, 'la carte doit afficher la dernière synchronisation…')
assert.match(source, />jamais</, '… et dire « jamais » quand il n’y en a eu aucune')
assert.match(source, /il y a \$\{synchro\.jours\} j/, '… avec l’ancienneté en clair, pas seulement une date')

// « Réussie » veut dire INTÉGRÉE au Cockpit. Un passage où aucun compte n'a
// été lisible ne pose pas la date : sinon l'écran afficherait « synchronisé
// aujourd'hui » sur une trésorerie qui n'a rien reçu.
{
  const brancheVide = /if \(metas\.length === 0\) \{[\s\S]*?\n    \}/.exec(integrer)
  assert.ok(brancheVide, 'la branche « aucun compte lisible » doit exister')
  assert.doesNotMatch(
    brancheVide[0],
    /derniereSyncLe/,
    'aucun compte lu = aucune synchronisation réussie : la date ne se pose pas',
  )
}

console.log('OK — consentement : annoncé à J−7, expiration rouge, silence mesuré, lien vers LA connexion.')

// ============================================================
// 4. UN SEUL CHEMIN D'ENTRÉE POUR LES MOUVEMENTS
// ============================================================
//
// Le lot D2 s'est produit parce que DEUX écrans importaient des relevés. La
// synchronisation est un troisième tuyau : elle doit déboucher sur le même
// entonnoir, sinon l'idempotence vérifiée plus haut ne garantit plus rien.

{
  const fichiers = []
  ;(function balayer(dossier) {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
      const complet = path.join(dossier, e.name)
      if (e.isDirectory()) balayer(complet)
      else if (/\.tsx?$/.test(e.name)) fichiers.push(path.relative(racine, complet))
    }
  })(path.join(racine, 'src'))

  const depots = []
  const entonnoirs = []
  for (const f of fichiers) {
    const texte = lire(f)
    for (const _ of texte.matchAll(/\btransactionsBancaires\.push\(/g)) depots.push(f)
    // les mentions en commentaire ne comptent pas : on veut des APPELS
    for (const m of texte.matchAll(/(^|[^.\w])preparerImport\(/gm)) {
      if (!/^\s*(\/\/|\*)/.test(texte.slice(texte.lastIndexOf('\n', m.index) + 1, m.index))) entonnoirs.push(f)
    }
  }
  assert.ok(depots.length > 0, 'aucun dépôt de mouvement trouvé : ce test ne garde plus rien')
  for (const f of depots) {
    assert.equal(
      f,
      BANQUE,
      `${f} dépose des mouvements bancaires. Un second point d’entrée rouvre le lot D2 :\n` +
        'la même notion codée deux fois, deux résultats possibles, et personne pour dire lequel regarder.',
    )
  }
  assert.equal(
    depots.length,
    entonnoirs.filter((f) => f === BANQUE).length,
    'chaque dépôt de mouvements doit venir d’un `preparerImport` — c’est LUI qui dédoublonne',
  )
}

// La fenêtre de synchronisation est FIXE. Une fenêtre glissante couperait en
// deux lots une paire de mouvements identiques du même jour, et le second
// passerait pour un doublon (cf. 1.4).
assert.match(source, /FENETRE_SYNCHRO_JOURS = 90/, 'la fenêtre rapatriée doit être fixe, et écrite une seule fois')

console.log(
  'Connexion bancaire : un seul entonnoir de dépôt, API et fichier indiscernables, solde null jamais 0, ' +
    'consentement annoncé avant de casser.',
)
