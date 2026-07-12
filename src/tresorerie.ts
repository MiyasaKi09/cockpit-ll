// ============================================================
// Prévision de trésorerie à TREIZE SEMAINES — audit finance F3.
// Chaque point de la courbe est EXPLICABLE : une semaine porte la
// liste des flux qui la composent (audit §5.5 : « la courbe doit
// permettre d'ouvrir chaque montant »).
// Trois scénarios : prudent / probable / favorable — ils ne jouent
// que sur les délais et la pondération des recettes non émises.
// ============================================================

import type { AppState } from './types'
import { delaiMoyenPaiement, encaissementPrevu, projetById } from './derive'
import { soldeFacture } from './facture'
import { soldeBancaire } from './banque'
import { fraisGenerauxDetail } from './achats'
import { addDays, mondayOf } from './util'

export type Scenario = 'prudent' | 'probable' | 'favorable'

export interface FluxPrevision {
  date: string
  montant: number // signé (+ entrée, − sortie)
  libelle: string
  source:
    | 'facture_client'
    | 'echeance_client'
    | 'facture_fournisseur'
    | 'contrat_recurrent'
    | 'salaires'
    | 'frais_generaux'
    | 'tva'
    | 'note_frais'
  lien?: string
}

export interface SemainePrevision {
  lundi: string
  entrees: FluxPrevision[]
  sorties: FluxPrevision[]
  variation: number
  solde: number
}

export interface Prevision13 {
  soldeDepart: number
  sourceSolde: 'banque' | 'manuel' | 'aucun'
  semaines: SemainePrevision[]
  pointBas: { lundi: string; solde: number }
}

const PARAMS: Record<Scenario, { retardEncaissement: number; ponderationEcheances: number }> = {
  // prudent : les clients paient 15 j en retard, 70 % des échéances non
  // émises se réalisent ; favorable : tout arrive à l'échéance contractuelle
  prudent: { retardEncaissement: 15, ponderationEcheances: 0.7 },
  probable: { retardEncaissement: 0, ponderationEcheances: 1 },
  favorable: { retardEncaissement: -5, ponderationEcheances: 1 },
}

function borner(date: string, min: string): string {
  return date < min ? min : date
}

/** tous les flux prévisionnels datés entre aujourd'hui et J+91 */
export function fluxPrevisionnels(state: AppState, today: string, scenario: Scenario): FluxPrevision[] {
  const p = PARAMS[scenario]
  const fin = addDays(today, 13 * 7)
  const flux: FluxPrevision[] = []

  // --- entrées : factures ÉMISES non soldées (montant = solde restant)
  for (const f of state.factures) {
    if (f.type === 'avoir') continue
    const solde = soldeFacture(state, f)
    if (solde <= 0.01) continue
    const projet = projetById(state, f.projetId)
    const delaiConstate = projet ? delaiMoyenPaiement(state, projet.typeMO) : null
    // probable : délai réellement constaté sur ce type de client, sinon contractuel
    const base =
      scenario === 'probable' && delaiConstate != null ? addDays(f.emission, delaiConstate) : encaissementPrevu(f)
    // audit F6 : une facture en retard n'est PLUS « encaissée aujourd'hui » —
    // elle reçoit une date FUTURE (recouvrement) au lieu d'être bornée à today
    const enRetard = encaissementPrevu(f) < today
    const date = enRetard
      ? addDays(today, p.retardEncaissement > 0 ? p.retardEncaissement + 15 : 15)
      : addDays(base, p.retardEncaissement)
    if (date < today || date > fin) continue
    flux.push({
      date,
      montant: solde,
      libelle: `Encaissement ${f.numero || f.id} — ${f.libelle}${enRetard ? ' (en retard — estimé)' : ''}`,
      source: 'facture_client',
      lien: '#/facturation',
    })
  }
  // --- entrées : échéances de facturation (pondérées : pas encore émises)
  for (const e of state.echeancesFacturation) {
    const dateEmission = borner(e.datePrevue, today)
    const date = borner(addDays(addDays(dateEmission, e.delaiJours), p.retardEncaissement), today)
    if (date > fin) continue
    const montant = Math.round(e.montantHT * (1 + e.tauxTVA) * p.ponderationEcheances * 100) / 100
    flux.push({
      date,
      montant,
      libelle: `Échéance ${e.projetId} — ${e.libelle}${p.ponderationEcheances < 1 ? ` (pondérée ${Math.round(p.ponderationEcheances * 100)} %)` : ''}`,
      source: 'echeance_client',
      lien: '#/facturation',
    })
  }
  // --- sorties : factures fournisseurs validées non payées
  for (const f of state.facturesAchat) {
    if (f.statut !== 'validee' || f.payeLe) continue
    const date = borner(f.dateEcheance || addDays(f.dateFacture, 30), today)
    if (date > fin) continue
    flux.push({
      date,
      montant: -f.montantTTC,
      libelle: `Fournisseur ${f.fournisseur}${f.numeroFournisseur ? ` (${f.numeroFournisseur})` : ''}`,
      source: 'facture_fournisseur',
      lien: '#/finance/achats',
    })
  }
  // --- sorties : notes de frais à rembourser (sous quinzaine)
  for (const n of state.notesFrais) {
    if (n.statut !== 'a_rembourser' || n.moyen !== 'perso') continue
    const date = borner(addDays(today, 14), today)
    flux.push({
      date,
      montant: -n.montantTTC,
      libelle: `Remboursement ${n.personne} — ${n.libelle}`,
      source: 'note_frais',
      lien: '#/finance/achats',
    })
  }
  // --- sorties : contrats récurrents (prochaines occurrences, TTC estimé)
  const contratsRecurrents = state.contrats.filter(
    (c) =>
      (c.type === 'agence' || c.type === 'fournisseur') &&
      (c.periodiciteMois || 0) > 0 &&
      c.montantAttenduHT != null &&
      // un contrat confirmé « terminé / résilié » ne décaisse plus rien
      !state.attendusFinanciers.some((d) => d.contratId === c.id && d.exception === 'contrat_termine'),
  )
  let annuelRecurrent = 0
  for (const c of contratsRecurrents) {
    const pas = c.periodiciteMois!
    annuelRecurrent += (c.montantAttenduHT! * 12) / pas
    for (let mois = 0; mois < 4; mois++) {
      const m = Number(today.slice(5, 7)) - 1 + mois
      const annee = Number(today.slice(0, 4)) + Math.floor(m / 12)
      const moisIdx = (m % 12) + 1
      if (pas > 1 && (moisIdx - 1) % pas !== 0) continue
      const date = `${annee}-${String(moisIdx).padStart(2, '0')}-15`
      if (date < today || date > fin) continue
      flux.push({
        date,
        montant: -Math.round(c.montantAttenduHT! * 1.2 * 100) / 100, // TTC estimé
        libelle: `${c.intitule} (récurrent)`,
        source: 'contrat_recurrent',
        lien: '#/contrats',
      })
    }
  }
  // --- sorties : salaires + charges (équipe chargée, posés le 28)
  const salairesMensuels = state.settings.equipe.reduce((s, pers) => s + pers.remuMensuelle * pers.coefCharges, 0)
  // --- sorties : autres frais généraux mensualisés — on retire les contrats
  // récurrents déjà comptés pour ne rien compter deux fois
  const fgAnnuel = Math.max(
    0,
    (fraisGenerauxDetail(state).lignes.length > 0 ? fraisGenerauxDetail(state).total : state.settings.fraisGenerauxAnnuels) -
      annuelRecurrent,
  )
  for (let mois = 0; mois < 4; mois++) {
    const m = Number(today.slice(5, 7)) - 1 + mois
    const annee = Number(today.slice(0, 4)) + Math.floor(m / 12)
    const moisIdx = (m % 12) + 1
    const date28 = `${annee}-${String(moisIdx).padStart(2, '0')}-28`
    if (date28 >= today && date28 <= fin) {
      if (salairesMensuels > 0)
        flux.push({ date: date28, montant: -Math.round(salairesMensuels * 100) / 100, libelle: 'Salaires + charges (équipe)', source: 'salaires', lien: '#/parametres' })
      if (fgAnnuel > 0)
        flux.push({ date: date28, montant: -Math.round((fgAnnuel / 12) * 100) / 100, libelle: 'Frais généraux mensualisés (hors contrats récurrents)', source: 'frais_generaux', lien: '#/parametres' })
    }
    const date20 = `${annee}-${String(moisIdx).padStart(2, '0')}-20`
    const tva = state.settings.tvaMensuelleEstimee
    if (tva != null && tva > 0 && date20 >= today && date20 <= fin) {
      flux.push({ date: date20, montant: -tva, libelle: 'TVA / impôts prévisionnels (paramétré)', source: 'tva', lien: '#/parametres' })
    }
  }
  return flux.sort((a, b) => a.date.localeCompare(b.date))
}

/** courbe 13 semaines : solde de départ (banque importée sinon solde manuel)
 *  + flux agrégés par semaine, point bas repéré */
export function prevision13Semaines(state: AppState, today: string, scenario: Scenario): Prevision13 {
  const banque = soldeBancaire(state)
  const soldeDepart = banque ? banque.solde : state.settings.tresorerieDispo ?? 0
  const sourceSolde: Prevision13['sourceSolde'] = banque ? 'banque' : state.settings.tresorerieDispo != null ? 'manuel' : 'aucun'

  const flux = fluxPrevisionnels(state, today, scenario)
  const premierLundi = mondayOf(today)
  const semaines: SemainePrevision[] = []
  let solde = soldeDepart
  for (let i = 0; i < 13; i++) {
    const lundi = addDays(premierLundi, i * 7)
    const dimanche = addDays(lundi, 6)
    const duSegment = flux.filter((f) => f.date >= (i === 0 ? '0000' : lundi) && f.date <= dimanche)
    const entrees = duSegment.filter((f) => f.montant > 0)
    const sorties = duSegment.filter((f) => f.montant < 0)
    const variation = Math.round(duSegment.reduce((s, f) => s + f.montant, 0) * 100) / 100
    solde = Math.round((solde + variation) * 100) / 100
    semaines.push({ lundi, entrees, sorties, variation, solde })
  }
  const pointBas = semaines.reduce(
    (min, s) => (s.solde < min.solde ? { lundi: s.lundi, solde: s.solde } : min),
    { lundi: semaines[0]?.lundi || premierLundi, solde: semaines[0]?.solde ?? soldeDepart },
  )
  return { soldeDepart, sourceSolde, semaines, pointBas }
}
