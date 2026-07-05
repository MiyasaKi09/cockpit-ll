// Valeurs dérivées — une seule source de vérité par donnée :
// le facturé vient des factures, les heures réelles du pointage.

import type { AppState, Facture, MarcheTravaux, PhaseCode, Projet, Situation } from './types'
import { calculHonoraires } from './miqcp'
import { addDays, diffDays, fmtMoney, fold } from './util'

export function projetById(state: AppState, id: string): Projet | undefined {
  return state.projets.find((p) => p.id === id)
}

export function nomProjet(state: AppState, id: string): string {
  const p = projetById(state, id)
  return p ? `${p.id} — ${p.nom}` : id
}

/** HT facturé (émis ou encaissé) pour un projet, option par phase */
export function factureHT(state: AppState, projetId: string, phase?: PhaseCode): number {
  return state.factures
    .filter(
      (f) =>
        f.projetId === projetId &&
        f.statut !== 'prevue' &&
        (phase === undefined || f.phase === phase),
    )
    .reduce((s, f) => s + f.montantHT, 0)
}

/** HT encaissé pour un projet */
export function encaisseHT(state: AppState, projetId: string): number {
  return state.factures
    .filter((f) => f.projetId === projetId && f.statut === 'encaissee')
    .reduce((s, f) => s + f.montantHT, 0)
}

export function heuresReelles(state: AppState, projetId: string, phase?: PhaseCode): number {
  return state.temps
    .filter((t) => t.projetId === projetId && (phase === undefined || t.phase === phase))
    .reduce((s, t) => s + t.heures, 0)
}

export function heuresPrevues(projet: Projet, phase?: PhaseCode): number {
  return projet.phases
    .filter((ph) => phase === undefined || ph.code === phase)
    .reduce((s, ph) => s + ph.heuresPrevues, 0)
}

export function coutEngage(state: AppState, projetId: string): number {
  return coutReelTemps(state, projetId)
}

/** date d'encaissement prévue d'une facture */
export function encaissementPrevu(f: Facture): string {
  return addDays(f.emission, f.delaiJours)
}

/** jours de retard d'une facture émise non encaissée (0 si pas en retard) */
export function retardFacture(f: Facture, today: string): number {
  if (f.statut !== 'emise') return 0
  const r = diffDays(encaissementPrevu(f), today)
  return Math.max(0, r)
}

export function ttc(f: Facture): number {
  return f.montantHT * (1 + f.tauxTVA)
}

/** statuts considérés comme « au carnet » */
export const STATUTS_ACTIFS: Projet['statut'][] = ['Signé', 'En cours']

export interface Meteo {
  /** trésorerie disponible (saisie Paramètres / relevé) */
  tresorerie: number | null
  tresorerieMajLe: string | null
  /** HT des factures à émettre ou en attente d'encaissement sous 90 jours */
  facturable90j: number
  /** carnet de commandes : honoraires restant à facturer, projets signés/en cours */
  carnetHT: number
}

export function meteoFinanciere(state: AppState, today: string): Meteo {
  const horizon = addDays(today, 90)
  const facturable90j = state.factures
    .filter((f) => f.statut !== 'encaissee' && f.emission <= horizon)
    .reduce((s, f) => s + f.montantHT, 0)
  const carnetHT = state.projets
    .filter((p) => STATUTS_ACTIFS.includes(p.statut))
    .reduce((s, p) => {
      const h = calculHonoraires(p, state.settings)
      return s + Math.max(0, h.honorairesTotauxHT - factureHT(state, p.id))
    }, 0)
  return {
    tresorerie: state.settings.tresorerieDispo,
    tresorerieMajLe: state.settings.tresorerieMajLe,
    facturable90j,
    carnetHT,
  }
}

/** date limite contractuelle de vérification d'une situation */
export function dateLimiteVerif(state: AppState, s: Situation): string {
  const marche = s.marcheId ? state.marches.find((m) => m.id === s.marcheId) : undefined
  const delai = marche?.delaiVerifJours ?? 15
  return addDays(s.dateReception, delai)
}

/** délai moyen de paiement constaté (jours), par type de MO ou global */
export function delaiMoyenPaiement(state: AppState, typeMO?: string): number | null {
  const encaissees = state.factures.filter((f) => {
    if (f.statut !== 'encaissee' || !f.encaissementReel) return false
    if (!typeMO) return true
    const p = projetById(state, f.projetId)
    return p?.typeMO === typeMO
  })
  if (encaissees.length === 0) return null
  const total = encaissees.reduce((s, f) => s + diffDays(f.emission, f.encaissementReel!), 0)
  return Math.round(total / encaissees.length)
}

// ------------------------------------------------------------------
// Coûts RÉELS par personne — plus de forfait : le coût horaire de
// chacun découle de sa rémunération réelle (brut × charges / heures).
// ------------------------------------------------------------------

import type { ModeRemu, Personne, StatutRemu } from './types'

/** SAS — coefficients indicatifs : montant saisi × coef ≈ coût employeur
 *  complet. Sur le brut : ~1,55 président (pas de chômage mais tranches
 *  cadres), ~1,42 salarié. Sur le net versé : ~2,05 président, ~1,82 salarié. */
export const COEFS_SAS: Record<StatutRemu, Record<ModeRemu, number>> = {
  dirigeant: { brut: 1.55, net: 2.05 },
  salarie: { brut: 1.42, net: 1.82 },
}

export function coefSuggere(statut: StatutRemu, mode: ModeRemu): number {
  return COEFS_SAS[statut][mode]
}

/** coût annuel chargé d'une personne (le coef s'applique au montant saisi,
 *  net ou brut — il est suggéré en conséquence) */
export function coutAnnuelPersonne(p: Personne): number {
  return p.remuMensuelle * 12 * p.coefCharges
}

/** coût horaire réel d'une personne (rémunération chargée / heures annuelles) */
export function coutHorairePersonne(p: Personne): number {
  return p.heuresAnnuelles > 0 ? coutAnnuelPersonne(p) / p.heuresAnnuelles : 0
}

/** coût horaire d'un nom (fallback : coût moyen de l'équipe, puis réglage historique) */
export function coutHoraireDe(state: AppState, nom: string): number {
  const p = state.settings.equipe.find((x) => x.nom === nom)
  if (p) return coutHorairePersonne(p)
  return coutHoraireMoyen(state)
}

/** coût horaire moyen pondéré de l'équipe (remplace l'ancien forfait) */
export function coutHoraireMoyen(state: AppState): number {
  const eq = state.settings.equipe
  if (eq.length === 0) return state.settings.coutHoraireRevient
  const total = eq.reduce((s, p) => s + coutAnnuelPersonne(p), 0)
  const heures = eq.reduce((s, p) => s + p.heuresAnnuelles, 0)
  return heures > 0 ? total / heures : state.settings.coutHoraireRevient
}

/** coût RÉEL du temps passé sur un projet : Σ heures × coût horaire de LA personne */
export function coutReelTemps(state: AppState, projetId: string, phase?: PhaseCode): number {
  return state.temps
    .filter((t) => t.projetId === projetId && (phase === undefined || t.phase === phase))
    .reduce((s, t) => s + t.heures * coutHoraireDe(state, t.personne), 0)
}

/** coûts externes saisis sur les phases (BET, sous-traitance, débours) */
export function coutsExternes(state: AppState, projetId: string, phase?: PhaseCode): number {
  const p = projetById(state, projetId)
  if (!p) return 0
  return p.phases
    .filter((ph) => phase === undefined || ph.code === phase)
    .reduce((s, ph) => s + (ph.coutExterneHT || 0), 0)
}

/** coût complet engagé sur un projet = temps réel valorisé + coûts externes */
export function coutCompletProjet(state: AppState, projetId: string): number {
  return coutReelTemps(state, projetId) + coutsExternes(state, projetId)
}

/** coût d'agence complet par an (équipe chargée + frais généraux) */
export function coutAgenceAnnuel(state: AppState): number {
  const equipe = state.settings.equipe.reduce((s, p) => s + coutAnnuelPersonne(p), 0)
  return equipe + state.settings.fraisGenerauxAnnuels
}

/** seuil de rentabilité : € de marge à produire par JOUR facturable
 *  pour payer tous les coûts fixes (l'« objectif » de la feuille Analyse) */
export function coutJourObjectif(state: AppState): number {
  const s = state.settings
  const joursFacturables = s.equipe.reduce(
    (t, p) => t + (p.heuresAnnuelles * p.facturablePct) / s.heuresParJour,
    0,
  )
  return joursFacturables > 0 ? coutAgenceAnnuel(state) / joursFacturables : 0
}

/** heures → jours (heuresParJour des réglages) */
export function enJours(state: AppState, heures: number): number {
  return state.settings.heuresParJour > 0 ? heures / state.settings.heuresParJour : 0
}

// ------------------------------------------------------------------
// Plan de charge — « qui travaille sur quoi, quelle semaine » et
// surcharge. La charge planifiée d'une personne une semaine donnée
// vient des heures PRÉVUES des phases actives cette semaine, réparties
// sur la durée de la phase puis entre les personnes affectées.
// ------------------------------------------------------------------

/** personnes affectées à un projet (équipe explicite + responsables) */
export function equipeDuProjet(p: Projet): string[] {
  return [...new Set([p.responsable, p.coResponsable, ...(p.equipeProjet || [])].filter(Boolean) as string[])]
}

/** capacité hebdomadaire d'une personne (heures) */
export function capaciteSemaine(state: AppState): number {
  return state.settings.heuresParJour * 5
}

/** nombre de semaines (ISO, ≥ 1) couvertes par [debut, fin] inclus */
function nbSemaines(debut: string, fin: string): number {
  return Math.max(1, Math.round(diffDays(debut, fin) / 7) + 1)
}

/** charge PLANIFIÉE d'une personne pour la semaine du lundi donné (heures) */
export function chargePlanifieeSemaine(state: AppState, personne: string, lundi: string): number {
  const dimanche = addDays(lundi, 6)
  let heures = 0
  for (const p of state.projets) {
    if (!STATUTS_ACTIFS.includes(p.statut)) continue
    const equipe = equipeDuProjet(p)
    if (!equipe.includes(personne)) continue
    const nb = equipe.length || 1
    for (const ph of p.phases) {
      if (!ph.debut || !ph.fin || ph.heuresPrevues <= 0) continue
      // la phase chevauche-t-elle la semaine ?
      if (ph.debut > dimanche || ph.fin < lundi) continue
      const parSemaine = ph.heuresPrevues / nbSemaines(ph.debut, ph.fin)
      heures += parSemaine / nb
    }
  }
  return heures
}

/** CA HT facturé (émis ou encaissé) sur une année civile — confronté à la cible */
export function caRealiseAnnee(state: AppState, annee: number): number {
  const prefixe = String(annee)
  return state.factures
    .filter((f) => f.statut !== 'prevue' && f.emission.slice(0, 4) === prefixe)
    .reduce((s, f) => s + f.montantHT, 0)
}

// ------------------------------------------------------------------
// Situations de travaux — décompte « net à payer » à certifier à
// l'entreprise : cumul des travaux (+ révision) − retenue de garantie
// − ce qui a déjà été réglé (situations précédentes). 100 % déterministe,
// le taux de RG est lu sur le marché rattaché.
// ------------------------------------------------------------------

/** marché rattaché à une situation (par id explicite, sinon par projet + entreprise) */
export function marcheDeSituation(state: AppState, s: Situation): MarcheTravaux | undefined {
  if (s.marcheId) return state.marches.find((m) => m.id === s.marcheId)
  return state.marches.find(
    (m) => m.projetId === s.projetId && fold(m.entreprise) === fold(s.entreprise),
  )
}

/** situation précédente du même marché/entreprise (mois strictement antérieur, non rejetée) */
export function situationPrecedente(state: AppState, s: Situation): Situation | undefined {
  return state.situations
    .filter(
      (x) =>
        x.id !== s.id &&
        x.mois < s.mois &&
        x.statut !== 'rejetee' &&
        (s.marcheId
          ? x.marcheId === s.marcheId
          : x.projetId === s.projetId && fold(x.entreprise) === fold(s.entreprise)),
    )
    .sort((a, b) => b.mois.localeCompare(a.mois))[0]
}

/** base HT d'une situation : travaux cumulés + révision saisie */
function baseSituation(s: Situation): number {
  const cumul = s.montantCumulHT ?? s.montantMoisHT ?? 0
  return cumul + (s.revisionHT || 0)
}

export interface DecompteSituation {
  /** travaux cumulés HT (montantCumulHT, à défaut montantMoisHT) */
  travauxCumulHT: number
  revisionHT: number
  /** travaux + révision */
  baseHT: number
  tauxRG: number
  retenueGarantieHT: number
  /** base − RG */
  cumulNetHT: number
  /** cumul net déjà réglé (situations précédentes) */
  precedentNetHT: number
  /** net à payer ce mois HT = cumulNet − précédent */
  netAPayerHT: number
  tauxTVA: number
  netAPayerTTC: number
  marche?: MarcheTravaux
  /** messages d'incohérence détectés (vide = cohérent) */
  coherences: string[]
}

/** décompte complet « net à payer » d'une situation (certificat de paiement) */
export function decompteSituation(state: AppState, s: Situation, tauxTVA = 0.2): DecompteSituation {
  const marche = marcheDeSituation(state, s)
  const tauxRG = marche?.tauxRG ?? 0
  const travauxCumulHT = s.montantCumulHT ?? s.montantMoisHT ?? 0
  const revisionHT = s.revisionHT || 0
  const baseHT = travauxCumulHT + revisionHT
  const retenueGarantieHT = baseHT * tauxRG
  const cumulNetHT = baseHT - retenueGarantieHT
  const prec = situationPrecedente(state, s)
  const precedentNetHT = prec ? baseSituation(prec) * (1 - tauxRG) : 0
  const netAPayerHT = cumulNetHT - precedentNetHT
  const netAPayerTTC = netAPayerHT * (1 + tauxTVA)

  const coherences: string[] = []
  // cohérence : cumul mois = cumul précédent + montant du mois
  if (prec && s.montantMoisHT != null && s.montantCumulHT != null && prec.montantCumulHT != null) {
    const attendu = prec.montantCumulHT + s.montantMoisHT
    if (Math.abs(attendu - s.montantCumulHT) > 1) {
      coherences.push(
        `Cumul incohérent : ${fmtMoney(prec.montantCumulHT)} (préc.) + ${fmtMoney(s.montantMoisHT)} (mois) = ${fmtMoney(attendu)} ≠ ${fmtMoney(s.montantCumulHT)} saisi`,
      )
    }
  }
  // dépassement du montant du marché (avenants inclus)
  if (marche) {
    const plafond = marche.montantInitialHT + marche.avenantsHT
    if (plafond > 0 && travauxCumulHT > plafond * 1.0001) {
      coherences.push(
        `Cumul travaux ${fmtMoney(travauxCumulHT)} > marché ${fmtMoney(plafond)} — avenant à prévoir ?`,
      )
    }
  }
  return {
    travauxCumulHT,
    revisionHT,
    baseHT,
    tauxRG,
    retenueGarantieHT,
    cumulNetHT,
    precedentNetHT,
    netAPayerHT,
    tauxTVA,
    netAPayerTTC,
    marche,
    coherences,
  }
}

/** honoraires DET du mois proposés depuis une situation validée : quote-part
 *  d'avancement (montant du mois / travaux de l'opération) × honoraires DET */
export function honorairesDETduMois(state: AppState, s: Situation): number {
  const p = projetById(state, s.projetId)
  if (!p) return 0
  const det = p.phases.find((ph) => ph.code === 'DET')
  if (!det || det.montantHT <= 0) return 0
  const travauxOp = p.montantTravauxHT || 0
  const mois = s.montantMoisHT || 0
  if (travauxOp <= 0 || mois <= 0) return 0
  return Math.round(det.montantHT * (mois / travauxOp))
}
