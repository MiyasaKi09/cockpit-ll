// Tests unitaires Node des invariants de src/facture.ts.
// Usage : node scripts/test-facture-invariants.cjs
//
// Le compilateur TypeScript est déjà une devDependency du projet. On transpile
// le module en mémoire pour tester le vrai moteur sans navigateur ni écriture
// dans dist/.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'facture.ts'), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2021,
  },
  fileName: 'facture.ts',
}).outputText

let uidSuivant = 0
const moduleFacture = { exports: {} }
const chargeur = (id) => {
  if (id === './util') return { uid: (prefixe) => `${prefixe}-test-${++uidSuivant}` }
  throw new Error(`Import inattendu dans facture.ts : ${id}`)
}
const enveloppe = vm.runInNewContext(
  `(function (exports, require, module) { ${javascript}\n})`,
  { console, crypto: globalThis.crypto, TextEncoder },
)
enveloppe(moduleFacture.exports, chargeur, moduleFacture)

const {
  brouillonAvoir,
  controlerAvantEmission,
  creanceFactureTTC,
  etatPaiement,
  erreurInsertionFacture,
  erreurRapprochementHistorique,
  montantRestantAnnulableHT,
  nouveauPaiement,
  soldeFacture,
  soldesAvoirParTaux,
  totauxAvoirPourEmission,
  totauxLignes,
  validerAvoir,
  validerPaiement,
} = moduleFacture.exports

const sourceDerive = fs.readFileSync(path.join(__dirname, '..', 'src', 'derive.ts'), 'utf8')
const javascriptDerive = ts.transpileModule(sourceDerive, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2021,
  },
  fileName: 'derive.ts',
}).outputText
const moduleDerive = { exports: {} }
const chargeurDerive = (id) => {
  if (id === './facture') return moduleFacture.exports
  if (id === './miqcp') return { calculHonoraires: () => ({ honorairesTotauxHT: 0 }) }
  if (id === './util') {
    return {
      addDays: (iso, jours) => {
        const date = new Date(`${iso}T00:00:00Z`)
        date.setUTCDate(date.getUTCDate() + jours)
        return date.toISOString().slice(0, 10)
      },
      diffDays: () => 0,
      fmtMoney: String,
      fold: String,
    }
  }
  throw new Error(`Import inattendu dans derive.ts : ${id}`)
}
const enveloppeDerive = vm.runInNewContext(
  `(function (exports, require, module) { ${javascriptDerive}\n})`,
  { console },
)
enveloppeDerive(moduleDerive.exports, chargeurDerive, moduleDerive)
const { encaisseHT, meteoFinanciere } = moduleDerive.exports

const sourceAchats = fs.readFileSync(path.join(__dirname, '..', 'src', 'achats.ts'), 'utf8')
const javascriptAchats = ts.transpileModule(sourceAchats, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2021,
  },
  fileName: 'achats.ts',
}).outputText
const moduleAchats = { exports: {} }
const chargeurAchats = (id) => {
  if (id === './util') {
    return {
      addMonths: (iso) => iso,
      monthKey: (iso) => String(iso).slice(0, 7),
      fold: (texte) =>
        String(texte)
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase(),
    }
  }
  throw new Error(`Import inattendu dans achats.ts : ${id}`)
}
const enveloppeAchats = vm.runInNewContext(
  `(function (exports, require, module) { ${javascriptAchats}\n})`,
  { console },
)
enveloppeAchats(moduleAchats.exports, chargeurAchats, moduleAchats)
const {
  erreurRapprochementAchat,
  suggestionsAchatPourDebit,
} = moduleAchats.exports

const facture = (patch = {}) => ({
  id: 'fac-1',
  numero: '2026-001',
  projetId: 'P1',
  phase: 'ESQ',
  libelle: 'Honoraires',
  montantHT: 100,
  tauxTVA: 0.2,
  emission: '2026-07-01',
  delaiJours: 30,
  statut: 'emise',
  type: 'facture',
  ...patch,
})

const etat = (factures, paiements = []) => ({ factures, paiements })
const origine = facture()

const etatEmission = {
  settings: { siretAgence: '12345678900000', adresseAgence: '1 rue Test' },
  contrats: [],
  factures: [],
}
const projet = { id: 'P1', typeMO: 'Privé pro' }
const brouillonEmission = (lignes) => ({
  projetId: projet.id,
  clientNom: 'Client test',
  clientAdresse: '2 rue Client',
  dateEmission: '2026-07-01',
  lignes,
})
assert.equal(
  controlerAvantEmission(
    etatEmission,
    projet,
    brouillonEmission([
      {
        id: 'ligne-negative',
        designation: 'Correction négative',
        quantite: 1,
        unite: 'forfait',
        prixUnitaireHT: -100,
        tauxTVA: 0.2,
      },
    ]),
  ).bloquants.some((message) => message.includes('total HT') && message.includes('strictement positif')),
  true,
  'une facture ordinaire de total HT négatif doit être refusée',
)
assert.equal(
  controlerAvantEmission(
    etatEmission,
    projet,
    brouillonEmission([
      {
        id: 'ligne-ttc-negatif',
        designation: 'TVA incohérente',
        quantite: 1,
        unite: 'forfait',
        prixUnitaireHT: 100,
        tauxTVA: -2,
      },
    ]),
  ).bloquants.some((message) => message.includes('total TTC') && message.includes('strictement positif')),
  true,
  'une facture ordinaire de total TTC négatif doit être refusée même si son HT est positif',
)
assert.equal(
  controlerAvantEmission(
    etatEmission,
    projet,
    brouillonEmission([
      {
        id: 'ligne-tva-negative',
        designation: 'TVA invalide',
        quantite: 1,
        unite: 'forfait',
        prixUnitaireHT: 100,
        tauxTVA: -0.1,
      },
    ]),
  ).bloquants.some((message) => message.includes('taux de TVA compris')),
  true,
  'un taux de TVA négatif doit être refusé même si le TTC reste positif',
)
const lignesBaseNegativeParTaux = [
  {
    id: 'ligne-positive-20',
    designation: 'Prestation à 20 %',
    quantite: 1,
    unite: 'forfait',
    prixUnitaireHT: 100,
    tauxTVA: 0.2,
  },
  {
    id: 'ligne-negative-10',
    designation: 'Remise mal ventilée à 10 %',
    quantite: 1,
    unite: 'forfait',
    prixUnitaireHT: -10,
    tauxTVA: 0.1,
  },
]
assert.equal(
  controlerAvantEmission(
    etatEmission,
    projet,
    brouillonEmission(lignesBaseNegativeParTaux),
  ).bloquants.some((message) => message.includes('base HT nette')),
  true,
  'la base nette de chaque taux doit rester positive même si les totaux globaux le sont',
)

assert.equal(
  validerPaiement(etat([origine]), 120, [{ factureId: origine.id, montant: 120 }]).valide,
  true,
  'un paiement égal au solde doit être accepté',
)
assert.equal(
  validerPaiement(etat([origine]), 0, [{ factureId: origine.id, montant: 0 }]).valide,
  false,
  'un paiement nul doit être refusé',
)
assert.equal(
  validerPaiement(etat([origine]), 120, [{ factureId: origine.id, montant: -120 }]).valide,
  false,
  'une affectation négative doit être refusée',
)
assert.equal(
  validerPaiement(etat([origine]), 120, [{ factureId: origine.id, montant: 100 }]).valide,
  false,
  'la somme des affectations doit égaler le montant reçu',
)
assert.equal(
  validerPaiement(
    etat([origine]),
    0.3,
    [
      { factureId: origine.id, montant: 0.1 },
      { factureId: origine.id, montant: 0.2 },
    ],
  ).valide,
  true,
  'les imprécisions flottantes inférieures au centime doivent être tolérées',
)

const paiementExistant = {
  id: 'pay-1',
  date: '2026-07-10',
  montant: 50,
  affectations: [{ factureId: origine.id, montant: 50 }],
}
assert.equal(
  validerPaiement(
    etat([origine], [paiementExistant]),
    70.01,
    [
      { factureId: origine.id, montant: 35.01 },
      { factureId: origine.id, montant: 35 },
    ],
  ).valide,
  false,
  'des affectations répétées ne doivent pas permettre de dépasser le solde',
)
assert.throws(
  () => nouveauPaiement(etat([origine], [paiementExistant]), '2026-07-20', 71, [{ factureId: origine.id, montant: 71 }]),
  /dépasse son solde restant/,
  'le constructeur doit lui-même refuser un surpaiement',
)
assert.equal(
  nouveauPaiement(etat([origine]), '2026-07-20', 10.005, [
    { factureId: origine.id, montant: 10.005 },
  ]).montant,
  10.01,
  'les paiements doivent être normalisés au centime avant stockage',
)

const avoirPartiel = facture({
  id: 'av-1',
  numero: '2026-002',
  montantHT: -30,
  type: 'avoir',
  factureOrigineId: origine.id,
})
const etatAvoirPartiel = etat([origine, avoirPartiel])
const paiementPartiel = {
  id: 'pay-partiel',
  date: '2026-07-15',
  montant: 60,
  affectations: [{ factureId: origine.id, montant: 60 }],
}
const etatIndicateurs = {
  settings: { tresorerieDispo: null, tresorerieMajLe: null },
  projets: [],
  factures: [origine, avoirPartiel],
  paiements: [paiementPartiel],
  echeancesFacturation: [
    {
      id: 'ech-90j',
      projetId: origine.projetId,
      phase: 'ESQ',
      libelle: 'Solde mission',
      montantHT: 40,
      tauxTVA: 0.2,
      datePrevue: '2026-08-15',
      delaiJours: 30,
    },
  ],
}
assert.equal(
  encaisseHT(etatIndicateurs, origine.projetId, origine.phase),
  50,
  'l’encaissé par phase doit suivre le paiement partiel, pas le statut de la facture',
)
assert.equal(
  meteoFinanciere(etatIndicateurs, '2026-07-30').facturable90j,
  60,
  'la météo doit additionner 20 € HT nets à encaisser et 40 € HT à facturer',
)
assert.equal(
  montantRestantAnnulableHT(etatAvoirPartiel, origine),
  70,
  'un avoir partiel doit réduire le montant encore annulable',
)
assert.equal(validerAvoir(etatAvoirPartiel, origine, 70).valide, true, 'le solde annulable exact doit être accepté')
assert.equal(
  validerAvoir(etatAvoirPartiel, origine, 70.01).valide,
  false,
  'le cumul des avoirs ne doit pas dépasser la facture d’origine',
)
const avoirDuSolde = facture({
  id: 'av-solde',
  numero: '2026-003',
  montantHT: -70,
  type: 'avoir',
  factureOrigineId: origine.id,
})
assert.equal(
  validerAvoir(etat([origine, avoirPartiel, avoirDuSolde]), origine, 1).valide,
  false,
  'un avoir partiel suivi de l’avoir du solde doit interdire toute nouvelle annulation',
)

const avoirTotal = facture({
  id: 'av-total',
  numero: '2026-004',
  montantHT: -100,
  type: 'avoir',
  factureOrigineId: origine.id,
})
assert.equal(
  validerAvoir(etat([origine, avoirTotal]), origine, 100).valide,
  false,
  'un second avoir total doit être refusé',
)

const totauxBaseNegativeParTaux = totauxLignes(lignesBaseNegativeParTaux)
const origineHistoriqueIncoherente = facture({
  id: 'fac-historique-incoherente',
  numero: '2025-099',
  montantHT: totauxBaseNegativeParTaux.ht,
  figee: {
    numero: '2025-099',
    lignes: lignesBaseNegativeParTaux,
    totalHT: totauxBaseNegativeParTaux.ht,
    totalTVA: totauxBaseNegativeParTaux.tva,
    totalTTC: totauxBaseNegativeParTaux.ttc,
  },
})
const etatHistoriqueIncoherent = etat([origineHistoriqueIncoherente])
assert.equal(
  montantRestantAnnulableHT(etatHistoriqueIncoherent, origineHistoriqueIncoherente),
  90,
  'le plafond global HT doit protéger une ancienne pièce incohérente par taux',
)
assert.equal(
  validerAvoir(etatHistoriqueIncoherent, origineHistoriqueIncoherente, 100).valide,
  false,
  'un avoir ne doit jamais dépasser le total HT global de la facture d’origine',
)

const factureHistoriqueAvecDependances = facture({
  id: 'fac-historique-dependances',
  numero: '2025-100',
  figee: undefined,
})
const avoirHistoriqueLie = facture({
  id: 'av-historique-lie',
  numero: '2026-005',
  type: 'avoir',
  factureOrigineId: factureHistoriqueAvecDependances.id,
  montantHT: -10,
})
assert.match(
  erreurRapprochementHistorique(
    etat([factureHistoriqueAvecDependances, avoirHistoriqueLie]),
    factureHistoriqueAvecDependances.id,
  ),
  /avoir/,
  'une facture historique ayant déjà un avoir ne doit plus être modifiable',
)
assert.match(
  erreurRapprochementHistorique(
    etat(
      [factureHistoriqueAvecDependances],
      [{
        id: 'pay-reel',
        date: '2026-01-01',
        montant: 10,
        affectations: [{ factureId: factureHistoriqueAvecDependances.id, montant: 10 }],
      }],
    ),
    factureHistoriqueAvecDependances.id,
  ),
  /paiement réel/,
  'une facture historique ayant un paiement réel ne doit plus être modifiable',
)
assert.equal(
  erreurRapprochementHistorique(
    etat(
      [factureHistoriqueAvecDependances],
      [{
        id: `pay-migr-${factureHistoriqueAvecDependances.id}`,
        date: '2025-01-01',
        montant: 120,
        affectations: [{ factureId: factureHistoriqueAvecDependances.id, montant: 120 }],
      }],
    ),
    factureHistoriqueAvecDependances.id,
  ),
  null,
  'le seul paiement technique de migration doit pouvoir être réaligné',
)

const lignesMultiTVA = [
  {
    id: 'lig-20',
    designation: 'Honoraires à 20 %',
    quantite: 1,
    unite: 'forfait',
    prixUnitaireHT: 100,
    tauxTVA: 0.2,
  },
  {
    id: 'lig-10',
    designation: 'Débours à 10 %',
    quantite: 1,
    unite: 'forfait',
    prixUnitaireHT: 50,
    tauxTVA: 0.1,
  },
]
const totauxMultiTVA = totauxLignes(lignesMultiTVA)
const origineMultiTVA = facture({
  id: 'fac-multi',
  numero: '2026-010',
  montantHT: totauxMultiTVA.ht,
  figee: {
    numero: '2026-010',
    lignes: lignesMultiTVA,
    totalHT: totauxMultiTVA.ht,
    totalTVA: totauxMultiTVA.tva,
    totalTTC: totauxMultiTVA.ttc,
  },
})
const etatMultiTVA = etat([origineMultiTVA])
const lignesAvoirPartiel = brouillonAvoir(etatMultiTVA, origineMultiTVA, 75)
const totauxAvoirPartiel = totauxAvoirPourEmission(
  etatMultiTVA,
  origineMultiTVA,
  lignesAvoirPartiel,
  false,
)
assert.deepEqual(
  Array.from(lignesAvoirPartiel, (ligne) => [ligne.tauxTVA, Math.abs(ligne.prixUnitaireHT)]),
  [
    [0.2, 50],
    [0.1, 25],
  ],
  'un avoir partiel doit répartir son HT proportionnellement entre les taux restants',
)
assert.deepEqual(
  { ht: totauxAvoirPartiel.ht, tva: totauxAvoirPartiel.tva, ttc: totauxAvoirPartiel.ttc },
  { ht: -75, tva: -12.5, ttc: -87.5 },
  'la répartition multi-TVA doit conserver des totaux HT, TVA et TTC cohérents',
)
assert.equal(
  validerAvoir(etatMultiTVA, origineMultiTVA, 75, lignesAvoirPartiel).valide,
  true,
  'un avoir multi-TVA réparti dans les limites de chaque taux doit être accepté',
)

const avoirMultiPartiel = facture({
  id: 'av-multi-1',
  numero: '2026-011',
  type: 'avoir',
  factureOrigineId: origineMultiTVA.id,
  montantHT: totauxAvoirPartiel.ht,
  tauxTVA: 0,
  figee: {
    numero: '2026-011',
    lignes: lignesAvoirPartiel,
    totalHT: totauxAvoirPartiel.ht,
    totalTVA: totauxAvoirPartiel.tva,
    totalTTC: totauxAvoirPartiel.ttc,
    ventilationTVA: totauxAvoirPartiel.ventilationTVA,
  },
})
const etatApresAvoirPartiel = etat([origineMultiTVA, avoirMultiPartiel])
assert.deepEqual(
  Array.from(soldesAvoirParTaux(etatApresAvoirPartiel, origineMultiTVA), (solde) => ({
    tauxTVA: solde.tauxTVA,
    ht: solde.ht,
    tva: solde.tva,
    ttc: solde.ttc,
  })),
  [
    { tauxTVA: 0.2, ht: 50, tva: 10, ttc: 60 },
    { tauxTVA: 0.1, ht: 25, tva: 2.5, ttc: 27.5 },
  ],
  'les soldes HT, TVA et TTC doivent être suivis séparément pour chaque taux',
)
assert.equal(soldeFacture(etatApresAvoirPartiel, origineMultiTVA), 87.5, 'l’avoir doit réduire le solde client TTC')
assert.equal(
  validerPaiement(
    etatApresAvoirPartiel,
    87.51,
    [{ factureId: origineMultiTVA.id, montant: 87.51 }],
  ).valide,
  false,
  'un paiement supérieur à la créance nette après avoir doit être refusé',
)

const lignesMauvaisTaux = [
  {
    id: 'depasse-20',
    designation: 'Dépassement 20 %',
    quantite: 1,
    unite: 'forfait',
    prixUnitaireHT: -51,
    tauxTVA: 0.2,
  },
  {
    id: 'sous-10',
    designation: 'Sous-consommation 10 %',
    quantite: 1,
    unite: 'forfait',
    prixUnitaireHT: -24,
    tauxTVA: 0.1,
  },
]
const controleMauvaisTaux = validerAvoir(
  etatApresAvoirPartiel,
  origineMultiTVA,
  75,
  lignesMauvaisTaux,
)
assert.equal(
  controleMauvaisTaux.valide,
  false,
  'un HT globalement correct ne doit pas masquer un dépassement de base/TVA/TTC sur un taux',
)
assert.match(
  controleMauvaisTaux.erreurs.join(' '),
  /taux 20/,
  'le contrôle doit identifier le taux de TVA dépassé',
)

const lignesAvoirSolde = brouillonAvoir(etatApresAvoirPartiel, origineMultiTVA)
const totauxAvoirSolde = totauxAvoirPourEmission(
  etatApresAvoirPartiel,
  origineMultiTVA,
  lignesAvoirSolde,
  true,
)
assert.deepEqual(
  { ht: totauxAvoirSolde.ht, tva: totauxAvoirSolde.tva, ttc: totauxAvoirSolde.ttc },
  { ht: -75, tva: -12.5, ttc: -87.5 },
  'l’avoir du solde doit annuler exactement les bases et taxes restantes',
)
assert.equal(
  validerAvoir(etatApresAvoirPartiel, origineMultiTVA, 75, lignesAvoirSolde).valide,
  true,
  'l’avoir du solde multi-TVA doit être accepté',
)
const avoirMultiSolde = facture({
  id: 'av-multi-2',
  numero: '2026-012',
  type: 'avoir',
  factureOrigineId: origineMultiTVA.id,
  montantHT: totauxAvoirSolde.ht,
  tauxTVA: 0,
  figee: {
    numero: '2026-012',
    lignes: lignesAvoirSolde,
    totalHT: totauxAvoirSolde.ht,
    totalTVA: totauxAvoirSolde.tva,
    totalTTC: totauxAvoirSolde.ttc,
    ventilationTVA: totauxAvoirSolde.ventilationTVA,
  },
})
const etatEntierementAvoir = etat([origineMultiTVA, avoirMultiPartiel, avoirMultiSolde])
assert.equal(creanceFactureTTC(etatEntierementAvoir, origineMultiTVA), 0, 'les avoirs doivent annuler la créance TTC')
assert.equal(soldeFacture(etatEntierementAvoir, origineMultiTVA), 0, 'une créance totalement annulée doit avoir un solde nul')
assert.equal(etatPaiement(etatEntierementAvoir, origineMultiTVA), 'payee', 'une créance annulée doit être considérée soldée')
assert.equal(
  validerPaiement(
    etatEntierementAvoir,
    0.01,
    [{ factureId: origineMultiTVA.id, montant: 0.01 }],
  ).valide,
  false,
  'aucun nouveau paiement ne doit être accepté après annulation totale de la créance',
)

const ligneArrondie = {
  id: 'lig-arrondi',
  designation: 'Base avec arrondi de TVA',
  quantite: 1,
  unite: 'forfait',
  prixUnitaireHT: 33.33,
  tauxTVA: 0.2,
}
const totauxArrondis = totauxLignes([ligneArrondie])
const origineArrondie = facture({
  id: 'fac-arrondi',
  numero: '2026-020',
  montantHT: totauxArrondis.ht,
  figee: {
    numero: '2026-020',
    lignes: [ligneArrondie],
    totalHT: totauxArrondis.ht,
    totalTVA: totauxArrondis.tva,
    totalTTC: totauxArrondis.ttc,
  },
})
const lignesPremierArrondi = brouillonAvoir(etat([origineArrondie]), origineArrondie, 16.67)
const totauxPremierArrondi = totauxAvoirPourEmission(
  etat([origineArrondie]),
  origineArrondie,
  lignesPremierArrondi,
  false,
)
const premierAvoirArrondi = facture({
  id: 'av-arrondi-1',
  numero: '2026-021',
  type: 'avoir',
  factureOrigineId: origineArrondie.id,
  montantHT: totauxPremierArrondi.ht,
  figee: {
    numero: '2026-021',
    lignes: lignesPremierArrondi,
    totalHT: totauxPremierArrondi.ht,
    totalTVA: totauxPremierArrondi.tva,
    totalTTC: totauxPremierArrondi.ttc,
    ventilationTVA: totauxPremierArrondi.ventilationTVA,
  },
})
const etatArrondiPartiel = etat([origineArrondie, premierAvoirArrondi])
const lignesSoldeArrondi = brouillonAvoir(etatArrondiPartiel, origineArrondie)
const totauxSoldeArrondi = totauxAvoirPourEmission(
  etatArrondiPartiel,
  origineArrondie,
  lignesSoldeArrondi,
  true,
)
assert.deepEqual(
  {
    ht: totauxSoldeArrondi.ht,
    tva: totauxSoldeArrondi.tva,
    ttc: totauxSoldeArrondi.ttc,
  },
  { ht: -16.66, tva: -3.34, ttc: -20 },
  'le dernier avoir doit absorber exactement le centime de TVA restant',
)
assert.equal(
  validerAvoir(
    etatArrondiPartiel,
    origineArrondie,
    16.66,
    lignesSoldeArrondi,
    totauxSoldeArrondi,
  ).valide,
  true,
  'l’ajustement final d’un centime doit être admis uniquement lorsqu’il égale le solde fiscal exact',
)
const avoirSoldeArrondi = facture({
  id: 'av-arrondi-2',
  numero: '2026-022',
  type: 'avoir',
  factureOrigineId: origineArrondie.id,
  montantHT: totauxSoldeArrondi.ht,
  figee: {
    numero: '2026-022',
    lignes: lignesSoldeArrondi,
    totalHT: totauxSoldeArrondi.ht,
    totalTVA: totauxSoldeArrondi.tva,
    totalTTC: totauxSoldeArrondi.ttc,
    ventilationTVA: totauxSoldeArrondi.ventilationTVA,
  },
})
assert.equal(
  creanceFactureTTC(
    etat([origineArrondie, premierAvoirArrondi, avoirSoldeArrondi]),
    origineArrondie,
  ),
  0,
  'deux avoirs successifs doivent solder la créance malgré l’arrondi de TVA',
)

function ajouterAvoirCalcule(state, origineFacture, montantPartielHT, soldeComplet, id) {
  const lignes = brouillonAvoir(state, origineFacture, montantPartielHT)
  let totaux
  try {
    totaux = totauxAvoirPourEmission(
      state,
      origineFacture,
      lignes,
      soldeComplet,
    )
  } catch (e) {
    throw new Error(
      `${id}: ${e instanceof Error ? e.message : String(e)} — ` +
        `${JSON.stringify({ lignes, soldes: soldesAvoirParTaux(state, origineFacture) })}`,
    )
  }
  const controle = validerAvoir(
    state,
    origineFacture,
    Math.abs(totaux.ht),
    lignes,
    totaux,
  )
  assert.equal(
    controle.valide,
    true,
    `l’avoir calculé ${id} doit être accepté : ${controle.erreurs.join(' ')} — ` +
      JSON.stringify({
        montantPartielHT,
        soldeComplet,
        lignes,
        totaux,
        soldes: soldesAvoirParTaux(state, origineFacture),
      }),
  )
  const avoirCalcule = facture({
    id,
    numero: id,
    type: 'avoir',
    factureOrigineId: origineFacture.id,
    montantHT: totaux.ht,
    tauxTVA: 0,
    figee: {
      numero: id,
      lignes,
      totalHT: totaux.ht,
      totalTVA: totaux.tva,
      totalTTC: totaux.ttc,
      ventilationTVA: totaux.ventilationTVA,
    },
  })
  state.factures.push(avoirCalcule)
  return { avoir: avoirCalcule, lignes, totaux }
}

// Régression : deux bases de 0,10 € à 5,5 % et 10 % produisent chacune un
// centime de TVA sur la facture. Deux avoirs de 0,10 € doivent répartir ces
// centimes sur les bons taux, même si les lignes du dernier avoir ne suffisent
// plus à retrouver seules l'arrondi fiscal restant.
const lignesReproCentimeMultiTVA = [
  {
    id: 'repro-55',
    designation: 'Base minime à 5,5 %',
    quantite: 1,
    unite: 'forfait',
    prixUnitaireHT: 0.1,
    tauxTVA: 0.055,
  },
  {
    id: 'repro-10',
    designation: 'Base minime à 10 %',
    quantite: 1,
    unite: 'forfait',
    prixUnitaireHT: 0.1,
    tauxTVA: 0.1,
  },
]
const totauxReproCentime = totauxLignes(lignesReproCentimeMultiTVA)
const origineReproCentime = facture({
  id: 'fac-repro-centime',
  numero: '2026-030',
  montantHT: totauxReproCentime.ht,
  figee: {
    numero: '2026-030',
    lignes: lignesReproCentimeMultiTVA,
    totalHT: totauxReproCentime.ht,
    totalTVA: totauxReproCentime.tva,
    totalTTC: totauxReproCentime.ttc,
  },
})
const etatReproCentime = etat([origineReproCentime])
ajouterAvoirCalcule(
  etatReproCentime,
  origineReproCentime,
  0.1,
  false,
  '2026-031',
)
const dernierAvoirCentime = ajouterAvoirCalcule(
  etatReproCentime,
  origineReproCentime,
  undefined,
  true,
  '2026-032',
)
assert.deepEqual(
  Array.from(dernierAvoirCentime.totaux.ventilationTVA, (ventilation) => ({
    tauxTVA: ventilation.tauxTVA,
    baseHT: ventilation.baseHT,
    montantTVA: ventilation.montantTVA,
    montantTTC: ventilation.montantTTC,
  })),
  [
    { tauxTVA: 0.055, baseHT: -0.05, montantTVA: -0.01, montantTTC: -0.06 },
    { tauxTVA: 0.1, baseHT: -0.05, montantTVA: 0, montantTTC: -0.05 },
  ],
  'le dernier centime de TVA doit rester rattaché au taux qui le porte',
)
assert.deepEqual(
  Array.from(soldesAvoirParTaux(etatReproCentime, origineReproCentime)),
  [],
  'les soldes par taux doivent être entièrement consommés après le dernier avoir',
)
assert.equal(
  creanceFactureTTC(etatReproCentime, origineReproCentime),
  0,
  'la séquence multi-taux doit solder exactement la créance TTC',
)

// Fuzz déterministe : plusieurs taux et plusieurs avoirs partiels successifs,
// puis un avoir final. La graine fixe rend toute régression reproductible.
let graineAvoir = 0x5eed1234
const aleatoireAvoir = () => {
  graineAvoir = (1664525 * graineAvoir + 1013904223) >>> 0
  return graineAvoir / 2 ** 32
}
const tauxFuzz = [0, 0.055, 0.1, 0.2]
for (let cas = 0; cas < 180; cas++) {
  const lignes = Array.from({ length: 2 + Math.floor(aleatoireAvoir() * 5) }, (_, index) => ({
    id: `fuzz-ligne-${cas}-${index}`,
    designation: `Ligne fuzz ${index}`,
    quantite: 1,
    unite: 'forfait',
    prixUnitaireHT: (1 + Math.floor(aleatoireAvoir() * 100000)) / 100,
    tauxTVA: tauxFuzz[Math.floor(aleatoireAvoir() * tauxFuzz.length)],
  }))
  const totaux = totauxLignes(lignes)
  const origineFuzz = facture({
    id: `fuzz-facture-${cas}`,
    numero: `FZ-${cas}`,
    montantHT: totaux.ht,
    figee: {
      numero: `FZ-${cas}`,
      lignes,
      totalHT: totaux.ht,
      totalTVA: totaux.tva,
      totalTTC: totaux.ttc,
    },
  })
  const etatFuzz = etat([origineFuzz])
  for (let etape = 0; etape < 7; etape++) {
    const restantCentimes = Math.round(
      montantRestantAnnulableHT(etatFuzz, origineFuzz) * 100,
    )
    if (restantCentimes <= 0) break
    const dernier = etape === 6 || restantCentimes === 1
    const montantPartiel = dernier
      ? undefined
      : (1 + Math.floor(aleatoireAvoir() * Math.max(1, restantCentimes - 1))) / 100
    ajouterAvoirCalcule(
      etatFuzz,
      origineFuzz,
      montantPartiel,
      dernier,
      `FZ-${cas}-A${etape}`,
    )
    if (dernier) break
  }
  assert.equal(
    montantRestantAnnulableHT(etatFuzz, origineFuzz),
    0,
    `le fuzz ${cas} doit solder tout le HT`,
  )
  assert.deepEqual(
    Array.from(soldesAvoirParTaux(etatFuzz, origineFuzz)),
    [],
    `le fuzz ${cas} ne doit laisser aucun solde fiscal par taux`,
  )
  assert.equal(
    creanceFactureTTC(etatFuzz, origineFuzz),
    0,
    `le fuzz ${cas} doit solder tout le TTC`,
  )
}

assert.match(
  erreurInsertionFacture(etat([origine]), facture({ id: origine.id, numero: '2026-099' })),
  /identifiant interne/,
  'un identifiant de pièce dupliqué doit être refusé',
)
assert.match(
  erreurInsertionFacture(etat([origine]), facture({ id: 'fac-2', numero: origine.numero })),
  /déjà d’être attribué/,
  'un numéro légal dupliqué doit être refusé',
)
const factureHistorique = facture({ id: '2026-004', numero: undefined })
assert.match(
  erreurInsertionFacture(etat([factureHistorique]), facture({ id: 'fac-4', numero: '2026-004' })),
  /déjà d’être attribué/,
  'le numéro hérité dans l’identifiant d’une facture historique doit rester réservé',
)

const factureAchatRapprochement = {
  id: 'achat-rapprochement',
  fournisseur: 'Fournisseur Exact',
  dateFacture: '2026-07-01',
  montantHT: 83.33,
  montantTVA: 16.67,
  montantTTC: 100,
  ventilations: [],
  statut: 'validee',
  source: 'manuel',
}
const transactionMontantIncorrect = {
  id: 'tx-montant-incorrect',
  date: '2026-07-10',
  montant: -10,
  libelle: 'VIREMENT FOURNISSEUR EXACT',
  importId: 'import-test',
  rapprochement: null,
}
const etatRapprochementAchat = {
  facturesAchat: [factureAchatRapprochement],
  transactionsBancaires: [transactionMontantIncorrect],
}
assert.deepEqual(
  Array.from(suggestionsAchatPourDebit(etatRapprochementAchat, transactionMontantIncorrect)),
  [],
  'un nom ou une référence ne doit pas suggérer une facture si le débit diffère du TTC',
)
assert.match(
  erreurRapprochementAchat(
    etatRapprochementAchat,
    transactionMontantIncorrect.id,
    factureAchatRapprochement.id,
  ),
  /doit être égal au TTC/,
  'la garde de mutation doit refuser un débit différent du TTC fournisseur',
)
const transactionMontantExact = {
  ...transactionMontantIncorrect,
  id: 'tx-montant-exact',
  montant: -100,
}
const etatRapprochementExact = {
  facturesAchat: [factureAchatRapprochement],
  transactionsBancaires: [transactionMontantExact],
}
assert.equal(
  suggestionsAchatPourDebit(etatRapprochementExact, transactionMontantExact).length,
  1,
  'un débit égal au centime doit rester proposé',
)
assert.equal(
  erreurRapprochementAchat(
    etatRapprochementExact,
    transactionMontantExact.id,
    factureAchatRapprochement.id,
  ),
  null,
  'un débit exact et une facture validée doivent pouvoir être rapprochés',
)

console.log('OK — émission positive, paiements nets, avoirs multi-TVA, historiques et rapprochements fournisseurs sont protégés.')
