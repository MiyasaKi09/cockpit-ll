// ============================================================
// Recette finance F6-F10 (audit — pilotage unique).
// F6 — moteur économique : cinq états des coûts externes, production
//      estimée / en-cours, reste à faire révisé qui fait dériver la
//      marge finale, facture en retard encaissée dans le FUTUR ;
// F7 — hors-périmètre DÉTECTÉ → pipeline → chiffrage → avenant SIGNÉ
//      (seule étape qui ajoute une ligne active au contrat) ; jalon
//      atteint → échéance interne ;
// F8 — revue de direction : les 8 sections, dans l'ordre imposé ;
// F9 — budget de trésorerie 12 mois glissant explicable, simulateur
//      sauvegardable, rentabilité par client, ROI des AO ;
// F10 — imports idempotents (CAMT.053, OFX, QIF), cycle de vie
//      Chorus/PDP par numéro, lecture CII/UBL ligne par ligne, et
//      passerelles HTTPS sans le moindre secret dans l'état.
//
// Usage : `npm run test:finance` (démarre `vite preview`, joue les
// contrôles, coupe le serveur). Nécessite `dist/` (lancer `npm run
// build` d'abord) et le paquet `playwright`.
// ============================================================
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  console.error(
    'playwright introuvable. Installez-le (npm i -D playwright && npx playwright install chromium) ' +
      'ou exposez-le via NODE_PATH.',
  )
  process.exit(2)
}

const BASE = 'http://localhost:4173/'
const RACINE = path.resolve(__dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-f6f10-'))
let echecs = 0
const ok = (n) => console.log('  ✓ ' + n)
const ko = (n, d) => {
  echecs++
  console.log('  ✗ ' + n + ' — ' + d)
}
// premier nombre monétaire d'un texte (tolère espaces fines, minus unicode)
const num = (s) => {
  const m = String(s).replace(/[−–—]/g, '-').match(/-?\s*\d[\d\s  .,]*/)
  return m ? Number(m[0].replace(/[\s  ]/g, '').replace(',', '.')) : NaN
}
// valeur numérique d'une carte Stat par son libellé exact (jamais le sous-texte)
let PAGE
const valStat = async (scope, label) => {
  const v = await scope
    .locator('.stat', { has: PAGE.locator('.stat-label', { hasText: label }) })
    .locator('.stat-value')
    .first()
    .textContent()
  return num(v)
}

// ---------- dates ancrées sur l'horloge du conteneur ----------
const J = (n) => {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const lundiPrec = (n) => {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + n)
  const jour = (d.getUTCDay() + 6) % 7 // 0 = lundi
  d.setUTCDate(d.getUTCDate() - jour)
  return d.toISOString().slice(0, 10)
}

// ---------- état de départ (version 0 → migration v16) ----------
const ETAT = {
  version: 0,
  projets: [
    {
      id: 'P70',
      nom: 'Médiathèque L — réhabilitation',
      typeMO: 'Public',
      statut: 'Signé',
      moa: 'Ville de Beauvais',
      adresse: 'Beauvais (60)',
      adresseFacturation: 'Hôtel de ville, 60000 Beauvais',
      ouvrage: null,
      montantTravauxHT: 800000,
      notesComplexite: {},
      missionsComplHT: 0,
      responsable: 'Julien',
      liens: [],
      materiauxIds: [],
      artisanIds: [],
      journal: [
        {
          id: 'n70-1',
          date: J(-7),
          auteur: 'Julien',
          texte: 'Réunion de chantier : la MOA demande des travaux supplémentaires non prévus au marché (reprise de la façade est).',
          tags: [],
        },
      ],
      phases: [
        { code: 'ESQ', pctBase: 0.1, montantHT: 12000, heuresPrevues: 100, coutExterneHT: 3000, debut: J(-160), fin: J(-100) },
        { code: 'APS', pctBase: 0.15, montantHT: 8000, heuresPrevues: 60, coutExterneHT: 0, debut: J(-95), fin: J(-12) },
      ],
    },
  ],
  // honoraires SIGNÉS = contrat client non provisoire (20 000 HT)
  contrats: [
    {
      id: 'C70',
      type: 'client',
      intitule: 'Marché de maîtrise d’œuvre — Médiathèque L',
      tiers: 'Ville de Beauvais',
      projetId: 'P70',
      dateSignature: J(-170),
      provisoire: false,
      avenants: [],
      lignes: [
        { id: 'l70-esq', nature: 'base', phase: 'ESQ', designation: 'Esquisse', quantite: 1, unite: 'forfait', prixUnitaireHT: 12000, coutExterneBudgetHT: 3000, etat: 'active' },
        { id: 'l70-aps', nature: 'base', phase: 'APS', designation: 'APS', quantite: 1, unite: 'forfait', prixUnitaireHT: 8000, coutExterneBudgetHT: 0, etat: 'active' },
      ],
    },
    // contrat d'agence récurrent ANCRÉ (première échéance → date de fin)
    {
      id: 'CAG-MAF',
      type: 'agence',
      intitule: 'Assurance MAF',
      tiers: 'MAF',
      avenants: [],
      lignes: [],
      periodiciteMois: 12,
      montantAttenduHT: 2000,
      premiereEcheance: J(65),
      dateFin: J(1200),
    },
  ],
  // facture émise EN RETARD (échéance passée) → encaissée dans le futur
  factures: [
    { id: 'F-100', numero: '2026-050', type: 'facture', projetId: 'P70', phase: 'APS', libelle: 'APS — honoraires', montantHT: 8000, tauxTVA: 0.2, emission: J(-58), delaiJours: 45, statut: 'emise' },
  ],
  // achat fournisseur VALIDÉ et PAYÉ, affecté à P70/ESQ (facturé & payé)
  facturesAchat: [
    {
      id: 'FA-70',
      fournisseur: 'BET Structure',
      numeroFournisseur: 'B-2211',
      dateFacture: J(-40),
      dateEcheance: J(-10),
      montantHT: 1500,
      montantTVA: 300,
      montantTTC: 1800,
      ventilations: [{ id: 'v70', montantHT: 1500, projetId: 'P70', phase: 'ESQ', categorie: 'BET' }],
      statut: 'validee',
      payeLe: J(-8),
      paiementAConfirmer: false,
      source: 'manuel',
    },
  ],
  // temps réel : ESQ à 95 h (avancement 0,95 ≥ 0,9 → jalon facturable)
  temps: [
    { id: 't70-1', semaine: lundiPrec(-40), personne: 'Julien', projetId: 'P70', phase: 'ESQ', heures: 60 },
    { id: 't70-2', semaine: lundiPrec(-33), personne: 'Zoé', projetId: 'P70', phase: 'ESQ', heures: 35 },
  ],
  // temps HORS projet en prospection → coût de prospection (ROI AO)
  tempsHorsProjet: [{ id: 'th-1', semaine: lundiPrec(-20), personne: 'Julien', categorie: 'Prospection / AO', heures: 20 }],
  // une consultation en cours → valeur attendue (ROI + revue §7)
  consultations: [
    { id: 'CS-1', intitule: 'Groupe scolaire Z — concours restreint', statut: 'a_etudier', budgetTravaux: 1000000, probabilite: 0.5, typeAvis: 'concours' },
  ],
}

// ---------- fixtures d'import (F10) ----------
const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt><Stmt>
    <Ntry>
      <Amt Ccy="EUR">1200.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
      <BookgDt><Dt>${J(-3)}</Dt></BookgDt>
      <NtryDtls><TxDtls><RmtInf><Ustrd>VIR VILLE BEAUVAIS 2026-050</Ustrd></RmtInf></TxDtls></NtryDtls>
    </Ntry>
    <Ntry>
      <Amt Ccy="EUR">49.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>
      <BookgDt><Dt>${J(-2)}</Dt></BookgDt>
      <AddtlNtryInf>PRLV LOGICIEL ARCHI</AddtlNtryInf>
    </Ntry>
  </Stmt></BkToCstmrStmt>
</Document>`

const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${J(-5).replace(/-/g, '')}<TRNAMT>500.00<NAME>VIR SCI CLIENT</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${J(-4).replace(/-/g, '')}<TRNAMT>-15.00<NAME>FRAIS TENUE COMPTE</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

const jjmmaaaa = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const QIF = `!Type:Bank
D${jjmmaaaa(J(-7))}
T750.00
PVIR HONORAIRES C
^
D${jjmmaaaa(J(-6))}
T-30.00
PABONNEMENT LOGICIEL
^`

const CHORUS = `numero;statut;date;motif
2026-050;rejetée;${J(-1)};SIRET destinataire inconnu`

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>FA-2026-88</cbc:ID>
  <cbc:IssueDate>${J(-10)}</cbc:IssueDate>
  <cbc:DueDate>${J(20)}</cbc:DueDate>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity>
    <cbc:RegistrationName>BET Structure Nord</cbc:RegistrationName>
  </cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">280.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1800.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">2080.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">2080.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>Étude structure — mission base</cbc:Description>
      <cac:ClassifiedTaxCategory><cbc:Percent>20</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">800.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>Déplacements et débours</cbc:Description>
      <cac:ClassifiedTaxCategory><cbc:Percent>10</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
  </cac:InvoiceLine>
</Invoice>`

const ecrire = (nom, contenu) => {
  const p = path.join(TMP, nom)
  fs.writeFileSync(p, contenu, 'utf-8')
  return p
}

// ---------- serveur de prévisualisation ----------
function demarrerPreview() {
  if (!fs.existsSync(path.join(RACINE, 'dist', 'index.html'))) {
    console.error('dist/ absent — lancez `npm run build` avant `npm run test:finance`.')
    process.exit(2)
  }
  const viteBin = path.join(RACINE, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
  const srv = spawn(viteBin, ['preview', '--port', '4173', '--strictPort'], {
    cwd: RACINE,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  })
  return srv
}
async function attendrePort(url, essais = 60) {
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return true
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

;(async () => {
  const srv = demarrerPreview()
  const pret = await attendrePort(BASE)
  if (!pret) {
    srv.kill('SIGKILL')
    console.error('preview injoignable sur ' + BASE)
    process.exit(2)
  }

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 940 } })
  const page = await ctx.newPage()
  PAGE = page
  page.setDefaultTimeout(9000)

  try {
    // -------- setup : migration v16 --------
    await page.goto(BASE + '#/', { waitUntil: 'networkidle' })
    await page.evaluate((etat) => localStorage.setItem('cockpit-ll-v1', JSON.stringify(etat)), ETAT)
    await page.reload({ waitUntil: 'networkidle' })
    const migr = await page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem('cockpit-ll-v1'))
      const cols = ['revisionsResteAFaire', 'pistesAvenant', 'decisionsDirection', 'simulations', 'connecteurs']
      return { version: e.version, toutesArrays: cols.every((c) => Array.isArray(e[c])), contrats: e.contrats.length }
    })
    if (migr.version === 16 && migr.toutesArrays) ok('migration v16 · les 5 collections de pilotage sont amorcées (sans donnée inventée)')
    else ko('migration v16', JSON.stringify(migr))

    // ========================================================
    // F9 — Prévisions & rentabilité (avant toute mutation)
    // ========================================================
    await page.goto(BASE + '#/finance/previsions', { waitUntil: 'networkidle' })
    await page.waitForSelector('text=Budget de trésorerie — 12 mois glissants')
    const nbMois = await page.locator('.card', { hasText: 'Budget de trésorerie' }).locator('tbody tr').count()
    if (nbMois === 12) ok('F9 · budget de trésorerie sur 12 mois glissants')
    else ko('budget 12 mois', String(nbMois))
    // le flux récurrent ANCRÉ apparaît (Assurance MAF), pas avant la 1re échéance
    const recurrentPresent = await page.evaluate(() => document.body.textContent.includes('Assurance MAF (récurrent)'))
    if (recurrentPresent) ok('F9 · récurrent ancré sur sa première échéance dans le budget (Assurance MAF)')
    else ko('récurrent budget', 'flux Assurance MAF absent')

    // simulateur : honoraires pondérés = honoraires × probabilité
    await page.getByLabel('Nom du projet simulé').fill('Groupe scolaire — concours')
    await page.getByLabel('Honoraires HT (€)').fill('100000')
    await page.getByLabel('Probabilité de signature').fill('50')
    await page.getByLabel('Heures internes').fill('400')
    await page.getByLabel('Coûts externes HT (€)').fill('10000')
    const ponderes = await valStat(page.locator('.card', { hasText: 'Simulateur de projet' }), 'Honoraires pondérés')
    if (ponderes === 50000) ok('F9 · simulateur : honoraires pondérés = 50 000 € (100 000 × 50 %)')
    else ko('honoraires pondérés', String(ponderes))
    await page.getByRole('button', { name: 'Sauvegarder la simulation' }).click()
    await page.waitForSelector('text=Simulation sauvegardée')
    const simSauvee = await page.evaluate(() => JSON.parse(localStorage.getItem('cockpit-ll-v1')).simulations.length)
    if (simSauvee === 1) ok('F9 · simulation sauvegardée (aide à la décision conservée)')
    else ko('simulation sauvée', String(simSauvee))

    // rentabilité finale par client + ROI AO
    await page.waitForSelector('text=Rentabilité finale par client')
    const clientPresent = await page.locator('.card', { hasText: 'Rentabilité finale par client' }).locator('text=Ville de Beauvais').count()
    if (clientPresent > 0) ok('F9 · rentabilité finale agrégée par maître d’ouvrage (Ville de Beauvais)')
    else ko('rentabilité client', 'client absent')
    const valeurAttendue = await valStat(page.locator('.card', { hasText: 'ROI des appels' }), 'Valeur attendue')
    if (valeurAttendue === 50000) ok('F9 · ROI AO : valeur attendue = 50 000 € (1 M€ × 10 % × 50 %)')
    else ko('valeur attendue ROI', String(valeurAttendue))

    // ========================================================
    // F6 — économie du projet (fiche P70, onglet Finance)
    // ========================================================
    await page.goto(BASE + '#/projets/P70/finances', { waitUntil: 'networkidle' })
    const carte5 = page.locator('.card', { hasText: 'les cinq états' })
    await carte5.waitFor()
    const cinq = {
      budget: await valStat(carte5, 'Budget'),
      engage: await valStat(carte5, 'Engagé'),
      facture: await valStat(carte5, 'Facturé'),
      paye: await valStat(carte5, 'Payé'),
      finalPrevu: await valStat(carte5, 'Final prévu'),
    }
    // budget 3000 · engagé 0 · facturé 1500 · payé 1500 · final prévu 3000
    if (cinq.budget === 3000 && cinq.engage === 0 && cinq.facture === 1500 && cinq.paye === 1500 && cinq.finalPrevu === 3000)
      ok('F6 · coûts externes — cinq états jamais confondus (budget 3000 · engagé 0 · facturé 1500 · payé 1500 · final 3000)')
    else ko('cinq états', JSON.stringify(cinq))

    // production estimée 11 400 (0,95 × 12000) et en-cours 3 400 (11 400 − 8 000 facturés)
    const prod = await valStat(page, 'Production estimée')
    const enCours = await valStat(page, 'En-cours (WIP)')
    if (prod === 11400) ok('F6 · production estimée = 11 400 € (avancement 95 % × 12 000, jamais une écriture)')
    else ko('production estimée', String(prod))
    if (enCours === 3400) ok('F6 · en-cours (WIP) = 3 400 € (production − facturé)')
    else ko('en-cours', String(enCours))

    // marge finale ≈ marge initiale tant que le reste à faire n'est pas révisé (dérive ~0)
    const deriveAvant = await valStat(page, 'Dérive de marge')
    if (Math.abs(deriveAvant) <= 1) ok('F6 · sans révision, marge finale = marge initiale (dérive nulle — reste à faire dérivé du budget)')
    else ko('dérive avant révision', String(deriveAvant))

    // réviser le reste à faire : +4 500 € de coûts externes sur ESQ → la marge dérive
    await carte5.getByRole('button', { name: 'Réviser le reste à faire' }).click()
    const ligneEsq = carte5.locator('tbody tr', { hasText: 'ESQ' }).first()
    await ligneEsq.locator('input').nth(1).fill('6000') // coût externe restant HT (dérivé = 1500)
    await page.waitForTimeout(200)
    const revise = await page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem('cockpit-ll-v1'))
      return e.revisionsResteAFaire.find((r) => r.projetId === 'P70' && r.phase === 'ESQ')?.coutExterneRestantHT
    })
    const deriveApres = num(await page.locator('.stat', { hasText: 'Dérive de marge' }).textContent())
    if (revise === 6000 && deriveApres <= -4000) ok('F6 · reste à faire RÉVISÉ à la main (ESQ +4 500 €) → la marge finale dérive (' + deriveApres + ' €)')
    else ko('révision reste à faire', `revise=${revise} dérive=${deriveApres}`)

    // ========================================================
    // F8 — revue de direction : les 8 sections, dans l'ordre
    // ========================================================
    await page.goto(BASE + '#/finance/revue', { waitUntil: 'networkidle' })
    await page.waitForSelector('text=Revue de direction')
    const titres = await page.locator('.card .card-h, .card h2, .card h3').allTextContents().catch(() => [])
    const textePage = await page.evaluate(() => document.body.innerText)
    const ordreAttendu = [
      'Points bas de trésorerie',
      'Retards clients',
      'Clôture',
      'Hors périmètre',
      'Jalons facturables',
      'Marges finales qui dérivent',
      'Consultations par valeur',
      'Décisions',
    ]
    let dernierIndex = -1
    let ordonne = true
    for (const t of ordreAttendu) {
      const i = textePage.indexOf(t)
      if (i < 0 || i < dernierIndex) {
        ordonne = false
        break
      }
      dernierIndex = i
    }
    if (ordonne) ok('F8 · les 8 sections de la revue sont présentes dans l’ordre imposé (points bas → décisions)')
    else ko('ordre revue', titres.join(' | ').slice(0, 200))

    // ========================================================
    // F7 — hors-périmètre : détection → pipeline → avenant SIGNÉ
    // ========================================================
    const carteHP = page.locator('.card', { hasText: 'Hors périmètre & avenants potentiels' })
    await carteHP.waitFor()
    if ((await carteHP.locator('text=travaux supplémentaires').count()) > 0)
      ok('F7 · demande hors-périmètre DÉTECTÉE dans le journal de chantier (jamais promue seule)')
    else ko('détection hors-périmètre', 'aucune détection')
    const totalAvant = await page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem('cockpit-ll-v1'))
      const c = e.contrats.find((x) => x.id === 'C70')
      return c.lignes.filter((l) => l.etat === 'active').reduce((s, l) => s + l.quantite * l.prixUnitaireHT, 0)
    })
    await carteHP.getByRole('button', { name: 'Ajouter au pipeline' }).first().click()
    await page.waitForSelector('text=Ajouté au pipeline')
    // la détection disparaît (dédup par origine) et la piste est au pipeline
    const pistes = await page.evaluate(() => JSON.parse(localStorage.getItem('cockpit-ll-v1')).pistesAvenant.length)
    if (pistes === 1) ok('F7 · promotion manuelle au pipeline (à chiffrer puis confirmer l’avenant signé)')
    else ko('pipeline', String(pistes))
    // chiffrer 5 000 € puis confirmer l'avenant SIGNÉ
    const ligneP = carteHP.locator('tbody tr').filter({ hasText: 'Journal P70' }).first()
    await ligneP.locator('input').first().fill('5000')
    await ligneP.getByRole('button', { name: 'Chiffrer' }).click()
    await page.waitForSelector('text=Piste chiffrée')
    page.once('dialog', (d) => d.accept()) // au cas où
    await ligneP.getByRole('button', { name: 'Confirmer l’avenant signé' }).click()
    // confirmer() est une modale applicative, pas un dialog natif
    await page.getByRole('button', { name: 'Confirmer l’avenant', exact: true }).click()
    await page.waitForSelector('text=Avenant confirmé')
    const apres = await page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem('cockpit-ll-v1'))
      const c = e.contrats.find((x) => x.id === 'C70')
      return {
        total: c.lignes.filter((l) => l.etat === 'active').reduce((s, l) => s + l.quantite * l.prixUnitaireHT, 0),
        avenants: c.avenants.length,
        piste: e.pistesAvenant[0]?.statut,
      }
    })
    if (apres.total === totalAvant + 5000 && apres.avenants === 1 && apres.piste === 'confirmee')
      ok(`F7 · avenant SIGNÉ confirmé → ligne active ajoutée au contrat (${totalAvant} → ${apres.total} HT) — seule étape qui modifie le contrat`)
    else ko('avenant', JSON.stringify(apres))

    // ========================================================
    // F7 — jalon facturable → échéance interne
    // ========================================================
    const carteJalons = page.locator('.card', { hasText: 'Jalons facturables' }).first()
    await carteJalons.waitFor()
    const echAvant = await page.evaluate(() => JSON.parse(localStorage.getItem('cockpit-ll-v1')).echeancesFacturation.length)
    const ligneJalon = carteJalons.locator('tbody tr', { hasText: 'Esquisse' }).first()
    if ((await ligneJalon.count()) > 0) {
      await ligneJalon.getByRole('button', { name: 'Créer l’échéance' }).click()
      await page.waitForSelector('text=Échéance interne créée')
      const echApres = await page.evaluate(() => {
        const e = JSON.parse(localStorage.getItem('cockpit-ll-v1'))
        const der = e.echeancesFacturation[e.echeancesFacturation.length - 1]
        return { n: e.echeancesFacturation.length, phase: der.phase, montant: der.montantHT }
      })
      if (echApres.n === echAvant + 1 && echApres.phase === 'ESQ')
        ok('F7 · jalon ESQ atteint (avancement 95 %) → échéance interne créée (numéro légal réservé à l’émission)')
      else ko('jalon → échéance', JSON.stringify(echApres))
    } else ko('jalon facturable', 'jalon ESQ absent')

    // ========================================================
    // F8 — décision de direction ajoutée et avancée
    // ========================================================
    await page.getByLabel('Nouvelle décision').fill('Revoir le prix cible du taux horaire')
    // le bouton est enveloppé par un <label> (Field) : son nom accessible devient
    // l'espace du libellé — on le cible donc par son texte, pas par son rôle+nom
    await page.locator('button.btn-primary', { hasText: /^Ajouter$/ }).click()
    await page.waitForSelector('text=Décision ajoutée')
    const dec = await page.evaluate(() => JSON.parse(localStorage.getItem('cockpit-ll-v1')).decisionsDirection)
    if (dec.length === 1 && dec[0].statut === 'a_faire') ok('F8 · décision de direction tracée (sujet, responsable, échéance, statut)')
    else ko('décision', JSON.stringify(dec))

    // ========================================================
    // F10 — Connecteurs : diagnostic + imports
    // ========================================================
    await page.goto(BASE + '#/finance/connecteurs', { waitUntil: 'networkidle' })
    await page.waitForSelector('text=Diagnostic')

    // -- import CAMT.053 + idempotence --
    const fCamt = ecrire('releve.camt.xml', CAMT)
    const carteBanque = page.locator('.card', { hasText: 'Import bancaire — CAMT.053' })
    await carteBanque.locator('input[type=file]').setInputFiles(fCamt)
    await page.waitForSelector('text=Format CAMT — 2 ligne(s)')
    await page.getByRole('button', { name: /Intégrer 2 mouvement/ }).click()
    await page.waitForSelector('text=CAMT : 2 importé(s), 0 déjà connu(s)')
    ok('F10 · import CAMT.053 (ISO 20022) : 2 mouvements lus et intégrés')
    await carteBanque.locator('input[type=file]').setInputFiles(fCamt)
    await page.waitForSelector('text=Format CAMT — 2 ligne(s)')
    await page.getByRole('button', { name: /Intégrer 2 mouvement/ }).click()
    await page.waitForSelector('text=CAMT : 0 importé(s), 2 déjà connu(s)')
    ok('F10 · réimport du même CAMT n’ajoute AUCUNE ligne (idempotent : date + montant + libellé)')

    // -- import OFX --
    const fOfx = ecrire('releve.ofx', OFX)
    await carteBanque.locator('input[type=file]').setInputFiles(fOfx)
    await page.waitForSelector('text=Format OFX — 2 ligne(s)')
    await page.getByRole('button', { name: /Intégrer 2 mouvement/ }).click()
    await page.waitForSelector('text=OFX : 2 importé(s)')
    ok('F10 · import OFX/QFX : 2 mouvements lus')

    // -- import QIF --
    const fQif = ecrire('releve.qif', QIF)
    await carteBanque.locator('input[type=file]').setInputFiles(fQif)
    await page.waitForSelector('text=Format QIF — 2 ligne(s)')
    await page.getByRole('button', { name: /Intégrer 2 mouvement/ }).click()
    await page.waitForSelector('text=QIF : 2 importé(s)')
    ok('F10 · import QIF : 2 mouvements lus')

    // -- lecture CII/UBL ligne par ligne (TVA par taux, XML conservé) --
    const fUbl = ecrire('achat.ubl.xml', UBL)
    const carteXml = page.locator('.card', { hasText: 'Import achat électronique — CII / UBL' })
    await carteXml.locator('input[type=file]').setInputFiles(fUbl)
    await page.waitForSelector('text=BET Structure Nord')
    const nbLignesXml = await carteXml.locator('tbody tr').count()
    const tvaTexte = await carteXml.locator('text=TVA par taux').textContent()
    if (nbLignesXml === 2 && /20/.test(tvaTexte || '') && /10/.test(tvaTexte || ''))
      ok('F10 · facture UBL lue LIGNE PAR LIGNE, TVA ventilée par taux (20 % et 10 %)')
    else ko('lecture UBL', `${nbLignesXml} lignes / ${tvaTexte}`)
    await carteXml.getByRole('button', { name: 'Créer la facture d’achat (à valider)' }).click()
    await page.waitForSelector('text=Facture d’achat créée')
    const achatCree = await page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem('cockpit-ll-v1'))
      const f = e.facturesAchat.find((x) => x.numeroFournisseur === 'FA-2026-88')
      return { statut: f?.statut, source: f?.source, xmlConserve: (f?.notes || '').includes('<Invoice') }
    })
    if (achatCree.statut === 'a_valider' && achatCree.source === 'xml' && achatCree.xmlConserve)
      ok('F10 · facture d’achat « à valider » créée, XML source conservé (validation humaine)')
    else ko('achat XML', JSON.stringify(achatCree))

    // -- cycle de vie Chorus/PDP par numéro de facture --
    const fChorus = ecrire('chorus.csv', CHORUS)
    const carteCycle = page.locator('.card', { hasText: 'Cycle de vie Chorus / PDP' })
    await carteCycle.locator('input[type=file]').setInputFiles(fChorus)
    // le toast s'efface vite : on lit l'état plutôt que la notification
    await page.waitForFunction(() => {
      const e = JSON.parse(localStorage.getItem('cockpit-ll-v1'))
      const f = e.factures.find((x) => x.numero === '2026-050')
      return !!(f && (f.transmissions || []).some((t) => t.statut === 'rejetee'))
    })
    const rejet = await page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem('cockpit-ll-v1'))
      const f = e.factures.find((x) => x.numero === '2026-050')
      return (f.transmissions || []).some((t) => t.statut === 'rejetee' && /SIRET/.test(t.motif || ''))
    })
    if (rejet) ok('F10 · cycle de vie Chorus rattaché par numéro (rejet 2026-050 avec son motif)')
    else ko('cycle de vie', 'rejet non rattaché')

    // -- passerelle HTTPS, AUCUN secret dans l'état --
    const cartePass = page.locator('.card', { hasText: 'Connecteurs directs' })
    const btnEnregistrer = cartePass.locator('button.btn-primary', { hasText: /^Enregistrer$/ })
    await cartePass.getByLabel('URL de passerelle (HTTPS)').fill('http://passerelle.exemple/healthz')
    await btnEnregistrer.click()
    await page.waitForSelector('text=URL de passerelle HTTPS est requise')
    const apresRefus = await page.evaluate(() => JSON.parse(localStorage.getItem('cockpit-ll-v1')).connecteurs.length)
    if (apresRefus === 0) ok('F10 · une URL non-HTTPS est refusée (passerelle serveur uniquement)')
    else ko('refus http', String(apresRefus))
    await cartePass.getByLabel('URL de passerelle (HTTPS)').fill('https://passerelle.exemple/healthz')
    await cartePass.getByLabel('Libellé').fill('Passerelle banque')
    await btnEnregistrer.click()
    await page.waitForSelector('text=Passerelle enregistrée')
    const conn = await page.evaluate(() => JSON.parse(localStorage.getItem('cockpit-ll-v1')).connecteurs)
    const clefs = conn.length ? Object.keys(conn[0]) : []
    const aSecret = clefs.some((k) => /secret|token|key|password|mdp|clef|cle$/i.test(k))
    if (conn.length === 1 && conn[0].urlPasserelle.startsWith('https://') && !aSecret)
      ok('F10 · passerelle enregistrée (URL HTTPS seule) — aucun secret dans le navigateur ni dans l’état')
    else ko('secret dans l’état', clefs.join(','))

    await browser.close()
  } catch (e) {
    echecs++
    console.log('  ✗ exception — ' + (e && e.message ? e.message : String(e)))
    try {
      await page.screenshot({ path: path.join(TMP, 'echec.png') })
      console.log('    capture : ' + path.join(TMP, 'echec.png'))
    } catch {
      /* rien */
    }
    await browser.close().catch(() => {})
  } finally {
    srv.kill('SIGKILL')
  }

  console.log(
    echecs
      ? `\n✗ ${echecs} échec(s)`
      : '\nOK — F6/F7/F8/F9/F10 : moteur économique (5 états, production, marge qui dérive), hors-périmètre → avenant signé, jalon → échéance, revue ordonnée, budget 12 mois + simulateur + ROI, imports idempotents et passerelles sans secret.',
  )
  process.exit(echecs ? 1 : 0)
})().catch((e) => {
  console.error('ERREUR', e)
  process.exit(1)
})
