// Logique partagée autour des consultations (pipeline commercial) —
// réutilisée par la page Développement (Kanban) et par Veille AO.

import type { AppState, Consultation, Projet } from './types'
import { calculHonoraires, phasesParDefaut } from './miqcp'
import { tauxVente } from './derive'

/** prochain identifiant projet libre (P01, P02…) */
export function prochainIdProjet(ids: string[]): string {
  let max = 0
  for (const id of ids) {
    const m = /^P(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `P${String(max + 1).padStart(2, '0')}`
}

/** crée le projet depuis une consultation gagnée (mutation du draft) — renvoie son id */
export function creerProjetDepuisConsultation(d: AppState, c: Consultation): string {
  const id = prochainIdProjet(d.projets.map((p) => p.id))
  const projet: Projet = {
    id,
    nom: c.intitule.length > 120 ? c.intitule.slice(0, 120) + '…' : c.intitule,
    typeMO: 'Public',
    statut: 'Signé',
    moa: c.acheteur || undefined,
    adresse: c.lieu || undefined,
    ouvrage: null,
    montantTravauxHT: c.budgetTravaux ?? null,
    notesComplexite: {},
    coefManuel: null,
    tauxRetenu: null,
    missionsComplHT: 0,
    notes: `Créé automatiquement — consultation gagnée${c.source ? ` (${c.source})` : ''}.${c.notes ? `\n${c.notes}` : ''}`,
    phases: [],
    liens: [],
    materiauxIds: [],
    artisanIds: [],
    journal: [],
  }
  // budget connu → répartition des honoraires par phase déjà posée ; sans type
  // d'ouvrage choisi, le taux barème seul sert de repère de départ
  if (projet.montantTravauxHT) {
    const h = calculHonoraires(projet, d.settings)
    const base = h.honorairesBaseHT > 0 ? h.honorairesBaseHT : h.tauxBareme !== null ? projet.montantTravauxHT * h.tauxBareme : 0
    if (base > 0) projet.phases = phasesParDefaut(base, tauxVente(d))
  }
  d.projets.push(projet)
  return id
}
