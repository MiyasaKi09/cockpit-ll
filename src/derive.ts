// Valeurs dérivées — une seule source de vérité par donnée :
// le facturé vient des factures, les heures réelles du pointage.

import type { AppState, Facture, PhaseCode, Projet, Situation } from './types'
import { calculHonoraires } from './miqcp'
import { addDays, diffDays } from './util'

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

/** CA HT facturé (émis ou encaissé) sur une année civile — confronté à la cible */
export function caRealiseAnnee(state: AppState, annee: number): number {
  const prefixe = String(annee)
  return state.factures
    .filter((f) => f.statut !== 'prevue' && f.emission.slice(0, 4) === prefixe)
    .reduce((s, f) => s + f.montantHT, 0)
}
