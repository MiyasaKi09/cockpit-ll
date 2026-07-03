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
  return heuresReelles(state, projetId) * state.settings.coutHoraireRevient
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
