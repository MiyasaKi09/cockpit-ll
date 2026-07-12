// ============================================================
// Facturation électronique — audit finance F5 (§11.4).
// - EXPORT : XML CII (syntaxe UN/CEFACT, profil EN 16931) généré
//   depuis la copie FIGÉE de la facture — la version transmise est
//   par construction identique à la version archivée. C'est le
//   cœur de données d'un Factur-X ; l'enveloppe PDF/A-3 et le
//   dépôt sur la plateforme agréée se règlent avec le cabinet.
// - RÉCEPTION : lecture d'un XML CII ou UBL fournisseur pour
//   préremplir une facture d'achat (validation humaine ensuite).
// ============================================================

import type { Facture, FactureFigee } from './types'

function x(s: string | undefined | null): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function d102(iso: string | undefined): string {
  return (iso || '').replace(/-/g, '')
}

function m(v: number): string {
  return v.toFixed(2)
}

/** SIREN depuis un SIRET (9 premiers chiffres) */
function siren(siret: string | undefined): string | undefined {
  const n = (siret || '').replace(/\D/g, '')
  return n.length >= 9 ? n.slice(0, 9) : undefined
}

/** XML CII (profil EN 16931) depuis la copie figée — audit F5.
 *  380 = facture, 381 = avoir (montants portés en positif). */
export function genererCII(f: Facture): string {
  const fg = f.figee
  if (!fg) throw new Error('Seule une facture ÉMISE (figée) peut être exportée en CII.')
  const avoir = f.type === 'avoir'
  const signe = avoir ? -1 : 1
  // un avoir CII (381) porte des montants positifs — les lignes figées sont négatives
  const lignes = fg.lignes.map((l) => ({
    designation: l.designation,
    quantite: l.quantite,
    prixUnitaire: signe * l.prixUnitaireHT,
    tauxTVA: l.tauxTVA,
    totalHT: Math.round(signe * l.quantite * l.prixUnitaireHT * 100) / 100,
  }))
  const totalHT = Math.round(signe * fg.totalHT * 100) / 100
  const totalTVA = Math.round(signe * fg.totalTVA * 100) / 100
  const totalTTC = Math.round(signe * fg.totalTTC * 100) / 100
  // ventilation de TVA par taux (BG-23)
  const parTaux = new Map<number, { base: number; tva: number }>()
  for (const l of lignes) {
    const cur = parTaux.get(l.tauxTVA) || { base: 0, tva: 0 }
    cur.base = Math.round((cur.base + l.totalHT) * 100) / 100
    parTaux.set(l.tauxTVA, cur)
  }
  // la TVA par taux se déduit de la base ; l'écart d'arrondi va sur le taux principal
  let tvaCumul = 0
  const tauxTries = [...parTaux.entries()].sort((a, b) => b[1].base - a[1].base)
  tauxTries.forEach(([taux, v], i) => {
    v.tva = i === tauxTries.length - 1 ? Math.round((totalTVA - tvaCumul) * 100) / 100 : Math.round(v.base * taux * 100) / 100
    tvaCumul = Math.round((tvaCumul + v.tva) * 100) / 100
  })

  const sirenVendeur = siren(fg.agence.siret)
  const sirenClient = siren(fg.clientSiret)
  const echeance = d102(ajouterJours(fg.dateEmission, fg.delaiJours))

  const lignesXml = lignes
    .map(
      (l, i) => `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${x(l.designation)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${m(l.prixUnitaire)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${l.quantite}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${(l.tauxTVA * 100).toFixed(2)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${m(l.totalHT)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join('\n')

  const taxesXml = tauxTries
    .map(
      ([taux, v]) => `      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${m(v.tva)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${m(v.base)}</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:DueDateTypeCode>72</ram:DueDateTypeCode>
        <ram:RateApplicablePercent>${(taux * 100).toFixed(2)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${x(fg.numero)}</ram:ID>
    <ram:TypeCode>${avoir ? 381 : 380}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${d102(fg.dateEmission)}</udt:DateTimeString></ram:IssueDateTime>${fg.mentionTVA ? `\n    <ram:IncludedNote><ram:Content>${x(fg.mentionTVA)}</ram:Content></ram:IncludedNote>` : ''}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${lignesXml}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${x(fg.agence.nom)}</ram:Name>${sirenVendeur ? `\n        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${sirenVendeur}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}
        <ram:PostalTradeAddress><ram:LineOne>${x(fg.agence.adresse)}</ram:LineOne><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>${fg.agence.tva ? `\n        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(fg.agence.tva)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${x(fg.clientNom)}</ram:Name>${sirenClient ? `\n        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${sirenClient}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}
        <ram:PostalTradeAddress><ram:LineOne>${x(fg.clientAdresse)}</ram:LineOne><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>
      </ram:BuyerTradeParty>${fg.numeroEngagement ? `\n      <ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${x(fg.numeroEngagement)}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>` : ''}
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>${fg.agence.iban ? `\n      <ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>30</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${x(fg.agence.iban.replace(/\s/g, ''))}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>` : ''}
${taxesXml}
      <ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${echeance}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${m(totalHT)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${m(totalHT)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${m(totalTVA)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${m(totalTTC)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${m(totalTTC)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
}

function ajouterJours(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function nomFichierCII(fg: FactureFigee): string {
  return `facture-${fg.numero.replace(/[^\w-]/g, '_')}.xml`
}

// ------------------------------------------------------------------
// RÉCEPTION : lecture d'un XML fournisseur (CII ou UBL) — préremplit
// une facture d'achat, la validation reste humaine (audit §5.4).
// ------------------------------------------------------------------

export interface FactureXmlLue {
  syntaxe: 'cii' | 'ubl'
  fournisseur?: string
  numero?: string
  dateFacture?: string
  dateEcheance?: string
  totalHT?: number
  totalTVA?: number
  totalTTC?: number
}

function premierParNom(racine: Element | Document, nom: string): Element | undefined {
  const tous = (racine as Element).getElementsByTagName('*')
  for (let i = 0; i < tous.length; i++) if (tous[i].localName === nom) return tous[i]
  return undefined
}

function texteDe(racine: Element | Document, nom: string): string | undefined {
  return premierParNom(racine, nom)?.textContent?.trim() || undefined
}

function nombreDe(racine: Element | Document, nom: string): number | undefined {
  const t = texteDe(racine, nom)
  if (t == null) return undefined
  const v = Number(t.replace(',', '.'))
  return Number.isFinite(v) ? v : undefined
}

function iso102(s: string | undefined): string | undefined {
  if (!s) return undefined
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
  return undefined
}

/** lit un XML CII ou UBL — retourne null si ce n'en est pas un */
export function lireFactureXML(xml: string): FactureXmlLue | null {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml')
  } catch {
    return null
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return null
  const racine = doc.documentElement
  if (!racine) return null

  if (racine.localName === 'CrossIndustryInvoice') {
    const vendeur = premierParNom(doc, 'SellerTradeParty')
    const totaux = premierParNom(doc, 'SpecifiedTradeSettlementHeaderMonetarySummation')
    const echeance = premierParNom(doc, 'SpecifiedTradePaymentTerms')
    const docu = premierParNom(doc, 'ExchangedDocument')
    return {
      syntaxe: 'cii',
      fournisseur: vendeur ? texteDe(vendeur, 'Name') : undefined,
      numero: docu ? texteDe(docu, 'ID') : undefined,
      dateFacture: iso102(docu ? texteDe(docu, 'DateTimeString') : undefined),
      dateEcheance: iso102(echeance ? texteDe(echeance, 'DateTimeString') : undefined),
      totalHT: totaux ? nombreDe(totaux, 'TaxBasisTotalAmount') ?? nombreDe(totaux, 'LineTotalAmount') : undefined,
      totalTVA: totaux ? nombreDe(totaux, 'TaxTotalAmount') : undefined,
      totalTTC: totaux ? nombreDe(totaux, 'GrandTotalAmount') : undefined,
    }
  }
  if (racine.localName === 'Invoice' || racine.localName === 'CreditNote') {
    const vendeur = premierParNom(doc, 'AccountingSupplierParty')
    const totaux = premierParNom(doc, 'LegalMonetaryTotal')
    // numéro = premier cbc:ID à la racine (pas celui des sous-blocs)
    let numero: string | undefined
    for (let i = 0; i < racine.children.length; i++) {
      if (racine.children[i].localName === 'ID') {
        numero = racine.children[i].textContent?.trim() || undefined
        break
      }
    }
    let dateFacture: string | undefined
    for (let i = 0; i < racine.children.length; i++) {
      if (racine.children[i].localName === 'IssueDate') {
        dateFacture = iso102(racine.children[i].textContent?.trim())
        break
      }
    }
    return {
      syntaxe: 'ubl',
      fournisseur: vendeur ? texteDe(vendeur, 'RegistrationName') || texteDe(vendeur, 'Name') : undefined,
      numero,
      dateFacture,
      dateEcheance: iso102(texteDe(doc, 'DueDate')),
      totalHT: totaux ? nombreDe(totaux, 'TaxExclusiveAmount') : undefined,
      totalTVA: nombreDe(doc, 'TaxAmount'),
      totalTTC: totaux ? nombreDe(totaux, 'TaxInclusiveAmount') ?? nombreDe(totaux, 'PayableAmount') : undefined,
    }
  }
  return null
}
