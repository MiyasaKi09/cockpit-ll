// ============================================================
// Achats & frais — audit finance F2 : connaître les charges
// réelles sans confondre les cinq montants (budget / engagé /
// facturé / payé / prévision finale) et détecter ce qui MANQUE.
// Règles :
// - la somme des ventilations = le HT de la pièce (bloquant) ;
// - tiers + numéro fournisseur déjà connus = doublon bloquant ;
// - un attendu absent n'est pas une erreur : c'est une exception
//   à confirmer (non reçue, contrat terminé, reporté, doublon).
// ============================================================

import type {
  AppState,
  AttenduFinancier,
  Contrat,
  FactureAchat,
  TransactionBancaire,
  VentilationAchat,
} from './types'
import { addMonths, fold, monthKey } from './util'

/** catégories proposées — coûts directs de projet (§7.1) puis agence (§7.2) */
export const CATEGORIES_ACHAT: string[] = [
  'BET / cotraitant',
  'Sous-traitance',
  'Économiste / OPC / spécialiste',
  'Géomètre / diagnostics',
  'Maquette / image / reprographie',
  'Déplacements / hébergement',
  'Débours refacturables',
  'Frais de concours / AO',
  'Loyer & charges',
  'Assurances',
  'Logiciels & abonnements',
  'Comptable & juridique',
  'Banque',
  'Télécoms',
  'Matériel & mobilier',
  'Communication',
  'Formation',
  'Impôts & taxes',
  'Autre',
]

export function sommeVentilations(vs: VentilationAchat[]): number {
  return Math.round(vs.reduce((s, v) => s + v.montantHT, 0) * 100) / 100
}

export interface BrouillonAchat {
  fournisseur: string
  numeroFournisseur?: string
  dateFacture: string
  montantHT: number
  montantTVA?: number | null
  montantTTC: number
  ventilations: VentilationAchat[]
  empreinte?: string
}

/** contrôles avant validation d'une facture fournisseur (audit §8.2) */
export function controlerAchat(
  state: AppState,
  b: BrouillonAchat,
  idEnCours?: string,
): { bloquants: string[]; alertes: string[] } {
  const bloquants: string[] = []
  const alertes: string[] = []
  if (!b.fournisseur.trim()) bloquants.push('Le fournisseur est obligatoire.')
  if (!b.dateFacture) bloquants.push('La date de facture est obligatoire.')
  const somme = sommeVentilations(b.ventilations)
  if (b.ventilations.length === 0) bloquants.push('Au moins une ligne de ventilation (projet/phase/catégorie).')
  else if (Math.abs(somme - b.montantHT) > 0.01)
    bloquants.push(
      `La somme des ventilations (${somme.toFixed(2)} €) doit égaler le HT de la pièce (${b.montantHT.toFixed(2)} €).`,
    )
  if (b.montantTVA != null && Math.abs(b.montantHT + b.montantTVA - b.montantTTC) > 0.02)
    bloquants.push('HT + TVA ≠ TTC — vérifier les montants saisis.')
  // doublon DUR : même tiers + même numéro fournisseur (audit §8.2 — bloquant)
  if (b.numeroFournisseur?.trim()) {
    const doublon = state.facturesAchat.find(
      (f) =>
        f.id !== idEnCours &&
        f.statut !== 'ecartee' &&
        fold(f.fournisseur) === fold(b.fournisseur) &&
        (f.numeroFournisseur || '').trim().toLowerCase() === b.numeroFournisseur!.trim().toLowerCase(),
    )
    if (doublon)
      bloquants.push(
        `Une facture ${b.numeroFournisseur} de ${b.fournisseur} existe déjà (${doublon.dateFacture}, ${doublon.montantTTC.toFixed(2)} € TTC) — comparer les deux pièces.`,
      )
  }
  return { bloquants, alertes }
}

/** doublon PROBABLE (empreinte de fichier, ou tiers + montant + date proche) */
export function doublonProbable(state: AppState, b: BrouillonAchat, idEnCours?: string): FactureAchat | undefined {
  if (b.empreinte) {
    const parEmpreinte = state.facturesAchat.find(
      (f) => f.id !== idEnCours && f.statut !== 'ecartee' && f.empreinte && f.empreinte === b.empreinte,
    )
    if (parEmpreinte) return parEmpreinte
  }
  return state.facturesAchat.find(
    (f) =>
      f.id !== idEnCours &&
      f.statut !== 'ecartee' &&
      fold(f.fournisseur) === fold(b.fournisseur) &&
      Math.abs(f.montantTTC - b.montantTTC) < 0.01 &&
      f.dateFacture.slice(0, 7) === b.dateFacture.slice(0, 7),
  )
}

// ------------------------------------------------------------------
// Attendus financiers DÉRIVÉS (audit §8.1) — la liste de ce qui était
// attendu se calcule ; on ne stocke que les décisions humaines.
// ------------------------------------------------------------------

export interface AttenduOuvert {
  /** clé stable : contratId × période, ou transactionId */
  cle: string
  type: 'facture_fournisseur' | 'justificatif_banque' | 'montant_anormal'
  libelle: string
  detail: string
  montant?: number
  date: string
  contratId?: string
  periode?: string
  transactionId?: string
}

function decisionPour(state: AppState, a: { contratId?: string; periode?: string; transactionId?: string }): AttenduFinancier | undefined {
  return state.attendusFinanciers.find((d) =>
    a.transactionId
      ? d.transactionId === a.transactionId
      : d.contratId === a.contratId && d.periode === a.periode,
  )
}

/** contrats récurrents à échéance : périodes écoulées (3 derniers mois + courante)
 *  sans facture fournisseur rattachée ni exception confirmée */
function attendusRecurrents(state: AppState, today: string): AttenduOuvert[] {
  const res: AttenduOuvert[] = []
  const moisCourant = monthKey(today)
  for (const c of state.contrats) {
    if (c.type !== 'agence' && c.type !== 'fournisseur') continue
    const periodicite = c.periodiciteMois || 0
    if (periodicite <= 0 || c.montantAttenduHT == null) continue
    // « contrat terminé / résilié » éteint TOUTES les périodes du contrat
    if (state.attendusFinanciers.some((d) => d.contratId === c.id && d.exception === 'contrat_termine')) continue
    // périodes à contrôler : 3 mois en arrière (pas plus — le passé lointain
    // relève du comptable), au pas de la périodicité
    for (let n = 3; n >= 0; n--) {
      const periode = addMonths(moisCourant, -n)
      // au pas de la périodicité : un contrat annuel n'attend pas 12 factures
      const moisDansAnnee = Number(periode.slice(5, 7))
      if (periodicite > 1 && (moisDansAnnee - 1) % periodicite !== 0) continue
      const recue = state.facturesAchat.some(
        (f) => f.contratId === c.id && f.statut !== 'ecartee' && monthKey(f.dateFacture) === periode,
      )
      if (recue) continue
      if (decisionPour(state, { contratId: c.id, periode })) continue
      res.push({
        cle: `rec:${c.id}:${periode}`,
        type: 'facture_fournisseur',
        libelle: `Facture attendue — ${c.intitule}`,
        detail: `${c.tiers || 'fournisseur'} · période ${periode} · contrat récurrent (${periodicite} mois)`,
        montant: c.montantAttenduHT ?? undefined,
        date: `${periode}-28`,
        contratId: c.id,
        periode,
      })
    }
  }
  return res
}

/** débits bancaires sans pièce : chaque sortie non rapprochée devient une
 *  demande de justificatif (jamais bloquée silencieusement) */
function attendusBanque(state: AppState): AttenduOuvert[] {
  return state.transactionsBancaires
    .filter((t) => t.montant < 0 && !t.rapprochement)
    .filter((t) => !decisionPour(state, { transactionId: t.id }))
    .map((t) => ({
      cle: `bq:${t.id}`,
      type: 'justificatif_banque' as const,
      libelle: `Justificatif manquant — ${t.libelle.slice(0, 60)}`,
      detail: `débit de ${Math.abs(t.montant).toFixed(2)} € le ${t.date}`,
      montant: Math.abs(t.montant),
      date: t.date,
      transactionId: t.id,
    }))
}

/** dérive de montant sur un contrat récurrent (tolérance du contrat) */
function attendusMontantsAnormaux(state: AppState): AttenduOuvert[] {
  const res: AttenduOuvert[] = []
  for (const f of state.facturesAchat) {
    if (!f.contratId || f.statut === 'ecartee') continue
    const c = state.contrats.find((x) => x.id === f.contratId)
    if (!c || c.montantAttenduHT == null) continue
    const tolerance = c.tolerancePct ?? 0.15
    const ecart = Math.abs(f.montantHT - c.montantAttenduHT)
    if (ecart <= c.montantAttenduHT * tolerance) continue
    const periode = monthKey(f.dateFacture)
    if (decisionPour(state, { contratId: c.id, periode: `anormal:${periode}` })) continue
    res.push({
      cle: `an:${c.id}:${periode}`,
      type: 'montant_anormal',
      libelle: `Montant inhabituel — ${c.intitule}`,
      detail: `${f.montantHT.toFixed(2)} € HT facturés pour ${c.montantAttenduHT.toFixed(2)} € attendus (±${Math.round(tolerance * 100)} %)`,
      montant: f.montantHT,
      date: f.dateFacture,
      contratId: c.id,
      periode: `anormal:${periode}`,
    })
  }
  return res
}

/** tous les attendus encore OUVERTS (à traiter) — dérivé, jamais stocké */
export function attendusOuverts(state: AppState, today: string): AttenduOuvert[] {
  return [...attendusRecurrents(state, today), ...attendusBanque(state), ...attendusMontantsAnormaux(state)].sort(
    (a, b) => a.date.localeCompare(b.date),
  )
}

// ------------------------------------------------------------------
// Balance fournisseurs & échéancier de décaissement
// ------------------------------------------------------------------

export interface LigneBalanceFournisseur {
  fournisseur: string
  nb: number
  totalTTC: number
  enRetardTTC: number
  prochaineEcheance?: string
}

/** achats validés non payés, groupés par fournisseur (balance âgée) */
export function balanceFournisseurs(state: AppState, today: string): LigneBalanceFournisseur[] {
  const par = new Map<string, LigneBalanceFournisseur>()
  for (const f of state.facturesAchat) {
    if (f.statut !== 'validee' || f.payeLe) continue
    const cle = fold(f.fournisseur)
    const cur = par.get(cle) || { fournisseur: f.fournisseur, nb: 0, totalTTC: 0, enRetardTTC: 0 }
    cur.nb++
    cur.totalTTC += f.montantTTC
    const echeance = f.dateEcheance || f.dateFacture
    if (echeance < today) cur.enRetardTTC += f.montantTTC
    if (!cur.prochaineEcheance || echeance < cur.prochaineEcheance) cur.prochaineEcheance = echeance
    par.set(cle, cur)
  }
  return [...par.values()].sort((a, b) => b.totalTTC - a.totalTTC)
}

// ------------------------------------------------------------------
// Les CINQ montants par projet (audit §7.3) — jamais confondus
// ------------------------------------------------------------------

export interface CinqMontants {
  budget: number
  engage: number
  facture: number
  paye: number
}

/** part HT d'une facture achat affectée à un projet (ou à l'agence si null) */
export function achatAffecteHT(f: FactureAchat, projetId: string | null, phase?: string | null): number {
  return (
    Math.round(
      f.ventilations
        .filter((v) => (v.projetId ?? null) === projetId && (phase === undefined || (v.phase ?? null) === phase))
        .reduce((s, v) => s + v.montantHT, 0) * 100,
    ) / 100
  )
}

/** budget / engagé / facturé / payé des coûts EXTERNES d'un projet */
export function cinqMontantsProjet(state: AppState, projetId: string): CinqMontants {
  const contratClient = state.contrats.find((c) => c.type === 'client' && c.projetId === projetId)
  const budget =
    contratClient?.lignes
      .filter((l) => l.etat === 'active')
      .reduce((s, l) => s + (l.coutExterneBudgetHT || 0), 0) ??
    state.projets.find((p) => p.id === projetId)?.phases.reduce((s, ph) => s + (ph.coutExterneHT || 0), 0) ??
    0
  const engage = state.contrats
    .filter((c) => c.type === 'fournisseur' && c.projetId === projetId)
    .reduce((s, c) => s + c.lignes.filter((l) => l.etat === 'active').reduce((x, l) => x + l.quantite * l.prixUnitaireHT, 0), 0)
  let facture = 0
  let paye = 0
  for (const f of state.facturesAchat) {
    if (f.statut !== 'validee') continue
    const part = achatAffecteHT(f, projetId)
    facture += part
    if (f.payeLe) paye += part
  }
  return {
    budget: Math.round(budget * 100) / 100,
    engage: Math.round(engage * 100) / 100,
    facture: Math.round(facture * 100) / 100,
    paye: Math.round(paye * 100) / 100,
  }
}

/** coûts externes RÉELS (achats validés) d'un projet sur une période — la
 *  marge périodique ne soustrait plus que des coûts datés (audit §9.3) */
export function achatsProjetPeriode(state: AppState, projetId: string, debut: string, fin: string): number {
  let total = 0
  for (const f of state.facturesAchat) {
    if (f.statut !== 'validee') continue
    if (f.dateFacture < debut || f.dateFacture > fin) continue
    total += achatAffecteHT(f, projetId)
  }
  return Math.round(total * 100) / 100
}

/** rapproche une transaction débit d'un achat : suggestions triées (jamais
 *  appliquées sans validation humaine — audit §10.3) */
export function suggestionsAchatPourDebit(state: AppState, t: TransactionBancaire): { f: FactureAchat; raisons: string[] }[] {
  const montant = Math.abs(t.montant)
  const libelle = fold(t.libelle)
  const res: { f: FactureAchat; raisons: string[]; score: number }[] = []
  for (const f of state.facturesAchat) {
    if (f.statut !== 'validee' || f.payeLe) continue
    const raisons: string[] = []
    let score = 0
    if (Math.abs(f.montantTTC - montant) < 0.01) {
      raisons.push(`montant exact ${montant.toFixed(2)} €`)
      score += 2
    }
    if (f.fournisseur && libelle.includes(fold(f.fournisseur).slice(0, 8))) {
      raisons.push(`« ${f.fournisseur} » dans le libellé`)
      score += 2
    }
    if (f.numeroFournisseur && libelle.includes(fold(f.numeroFournisseur))) {
      raisons.push(`référence ${f.numeroFournisseur}`)
      score += 2
    }
    if (score >= 2) res.push({ f, raisons, score })
  }
  return res.sort((a, b) => b.score - a.score).slice(0, 3)
}

/** somme annuelle des lignes budgétaires de frais généraux (audit §5.9) */
export function fraisGenerauxDetail(state: AppState): { total: number; lignes: { id: string; libelle: string; montantAnnuel: number }[] } {
  const lignes = state.settings.fraisGenerauxLignes || []
  return { total: Math.round(lignes.reduce((s, l) => s + l.montantAnnuel, 0) * 100) / 100, lignes }
}

/** contrat récurrent lié à un débit bancaire (suggestion de rattachement) */
export function contratsPourDebit(state: AppState, t: TransactionBancaire): Contrat[] {
  const libelle = fold(t.libelle)
  return state.contrats.filter(
    (c) =>
      (c.type === 'agence' || c.type === 'fournisseur') &&
      c.tiers &&
      libelle.includes(fold(c.tiers).slice(0, 6)),
  )
}
