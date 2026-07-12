// ============================================================
// Moteur économique unique — audit finance F6 (+ projections F9).
// Une SEULE source pour les vues agence et projet. Règles :
// - marge À DATE = facturé HT − temps réel − achats validés (rien
//   d'estimé) ;
// - marge FINALE = honoraires signés − réel − reste à faire révisé
//   par phase ;
// - les coûts externes gardent CINQ états distincts : budget,
//   engagé, facturé, payé, final prévu ;
// - la production estimée et l'en-cours sont affichés SANS être
//   présentés comme une écriture comptable ;
// - une facture en retard n'est plus « encaissée fictivement
//   aujourd'hui » : date estimée + délai de recouvrement +
//   probabilité ;
// - les contrats récurrents sont ancrés sur leur première échéance
//   réelle et s'arrêtent à leur date de fin.
// Flux de trésorerie en TTC ; honoraires, coûts directs et marges
// en HT.
// ============================================================

import type { AppState, Consultation, Contrat, Facture, Projet } from './types'
import {
  STATUTS_ACTIFS,
  coutHoraireMoyen,
  coutReelTemps,
  delaiMoyenPaiement,
  encaissementPrevu,
  enJours,
  factureHT,
  heuresPrevues,
  heuresReelles,
  probaConsultation,
  projetById,
} from './derive'
import { achatAffecteHT } from './achats'
import { contratDuProjet, honorairesProjetHT, totalContratHT } from './contrats'
import { soldeFacture } from './facture'
import { addDays, addMonths, clamp, diffDays, monthKey } from './util'

// ------------------------------------------------------------------
// Réel à date
// ------------------------------------------------------------------

/** achats fournisseurs RÉELS (validés) affectés à un projet — toutes dates */
export function achatsReelsProjet(state: AppState, projetId: string): number {
  let total = 0
  for (const f of state.facturesAchat) {
    if (f.statut !== 'validee') continue
    total += achatAffecteHT(f, projetId)
  }
  return Math.round(total * 100) / 100
}

/** honoraires SIGNÉS : le contrat client fait foi, sinon la fiche projet */
export function honorairesSignes(state: AppState, projet: Projet): number {
  const c = contratDuProjet(state, projet.id)
  return c ? totalContratHT(c) : honorairesProjetHT(projet)
}

/** marge À DATE sur coûts directs : facturé HT − temps réel − achats validés */
export function margeADate(state: AppState, projetId: string): {
  facture: number
  coutTemps: number
  achats: number
  marge: number
} {
  const facture = factureHT(state, projetId)
  const coutTemps = Math.round(coutReelTemps(state, projetId) * 100) / 100
  const achats = achatsReelsProjet(state, projetId)
  return { facture, coutTemps, achats, marge: Math.round((facture - coutTemps - achats) * 100) / 100 }
}

// ------------------------------------------------------------------
// Reste à faire révisé (base de la marge finale)
// ------------------------------------------------------------------

export function revisionResteAFaire(state: AppState, projetId: string, phase: string) {
  return state.revisionsResteAFaire.find((r) => r.projetId === projetId && r.phase === phase)
}

/** reste à faire d'un projet : heures internes + coûts externes encore à
 *  engager. Révision humaine si présente, sinon dérivé (budget − consommé). */
export function resteAFaireProjet(state: AppState, projet: Projet): {
  heures: number
  coutExterne: number
  cout: number
  revise: boolean
} {
  const coutHoraire = coutHoraireMoyen(state)
  let heures = 0
  let coutExterne = 0
  let revise = false
  for (const ph of projet.phases) {
    const rev = revisionResteAFaire(state, projet.id, ph.code)
    if (rev) revise = true
    const hRestantes =
      rev?.heuresRestantes != null ? rev.heuresRestantes : Math.max(0, ph.heuresPrevues - heuresReelles(state, projet.id, ph.code))
    const extRestant =
      rev?.coutExterneRestantHT != null
        ? rev.coutExterneRestantHT
        : Math.max(0, (ph.coutExterneHT || 0) - achatAffecteHT4Phase(state, projet.id, ph.code))
    heures += hRestantes
    coutExterne += extRestant
  }
  const cout = Math.round((heures * coutHoraire + coutExterne) * 100) / 100
  return { heures: Math.round(heures * 10) / 10, coutExterne: Math.round(coutExterne * 100) / 100, cout, revise }
}

function achatAffecteHT4Phase(state: AppState, projetId: string, phase: string): number {
  let total = 0
  for (const f of state.facturesAchat) {
    if (f.statut !== 'validee') continue
    total += achatAffecteHT(f, projetId, phase)
  }
  return total
}

/** marge FINALE prévisionnelle : honoraires signés − coût final estimé
 *  (réel à date + reste à faire révisé) */
export function margeFinale(state: AppState, projet: Projet): {
  honorairesSignes: number
  coutReel: number
  resteAFaire: number
  coutFinal: number
  marge: number
  margeInitiale: number
  derive: number
} {
  const hs = honorairesSignes(state, projet)
  const md = margeADate(state, projet.id)
  const coutReel = Math.round((md.coutTemps + md.achats) * 100) / 100
  const rf = resteAFaireProjet(state, projet)
  const coutFinal = Math.round((coutReel + rf.cout) * 100) / 100
  const marge = Math.round((hs - coutFinal) * 100) / 100
  // marge initiale : honoraires signés − budget prévu (temps prévu valorisé + budget externe)
  const budgetInterne = heuresPrevues(projet) * coutHoraireMoyen(state)
  const budgetExterne = projet.phases.reduce((s, ph) => s + (ph.coutExterneHT || 0), 0)
  const margeInitiale = Math.round((hs - budgetInterne - budgetExterne) * 100) / 100
  return {
    honorairesSignes: hs,
    coutReel,
    resteAFaire: rf.cout,
    coutFinal,
    marge,
    margeInitiale,
    derive: Math.round((marge - margeInitiale) * 100) / 100,
  }
}

// ------------------------------------------------------------------
// Les CINQ états des coûts externes (jamais confondus)
// ------------------------------------------------------------------

export interface CinqEtatsExterne {
  budget: number
  engage: number
  facture: number
  paye: number
  finalPrevu: number
}

/** budget / engagé / facturé / payé / final prévu des coûts externes */
export function cinqEtatsExterne(state: AppState, projet: Projet): CinqEtatsExterne {
  const contrat = contratDuProjet(state, projet.id)
  const budget =
    contrat?.lignes.filter((l) => l.etat === 'active').reduce((s, l) => s + (l.coutExterneBudgetHT || 0), 0) ??
    projet.phases.reduce((s, ph) => s + (ph.coutExterneHT || 0), 0)
  const engage = state.contrats
    .filter((c) => c.type === 'fournisseur' && c.projetId === projet.id)
    .reduce((s, c) => s + c.lignes.filter((l) => l.etat === 'active').reduce((x, l) => x + l.quantite * l.prixUnitaireHT, 0), 0)
  let facture = 0
  let paye = 0
  for (const f of state.facturesAchat) {
    if (f.statut !== 'validee') continue
    const part = achatAffecteHT(f, projet.id)
    facture += part
    if (f.payeLe && !f.paiementAConfirmer) paye += part
  }
  const rf = resteAFaireProjet(state, projet)
  // final prévu = déjà facturé par les fournisseurs + reste externe à engager
  const finalPrevu = Math.round((facture + rf.coutExterne) * 100) / 100
  return {
    budget: Math.round(budget * 100) / 100,
    engage: Math.round(engage * 100) / 100,
    facture: Math.round(facture * 100) / 100,
    paye: Math.round(paye * 100) / 100,
    finalPrevu,
  }
}

// ------------------------------------------------------------------
// Production économique estimée / en-cours (jamais une écriture)
// ------------------------------------------------------------------

/** avancement d'une phase (0..1) : heures réelles / prévues, sinon facturé/honoraires */
export function avancementPhase(state: AppState, projet: Projet, phaseCode: string): number {
  const ph = projet.phases.find((p) => p.code === phaseCode)
  if (!ph) return 0
  if (ph.heuresPrevues > 0) return clamp(heuresReelles(state, projet.id, ph.code) / ph.heuresPrevues, 0, 1)
  if (ph.montantHT > 0) return clamp(factureHT(state, projet.id, ph.code) / ph.montantHT, 0, 1)
  return 0
}

/** production économique estimée + en-cours (travaux en cours non facturés).
 *  Affiché à titre indicatif — JAMAIS présenté comme une écriture comptable. */
export function productionEstimee(state: AppState, projet: Projet): { production: number; facture: number; enCours: number } {
  let production = 0
  for (const ph of projet.phases) {
    if (ph.montantHT <= 0) continue
    production += avancementPhase(state, projet, ph.code) * ph.montantHT
  }
  production = Math.round(production * 100) / 100
  const facture = factureHT(state, projet.id)
  return { production, facture, enCours: Math.round((production - facture) * 100) / 100 }
}

// ------------------------------------------------------------------
// Encaissement probabilisé (fin de « l'encaissée fictive aujourd'hui »)
// ------------------------------------------------------------------

export interface EncaissementEstime {
  factureId: string
  numero: string
  soldeTTC: number
  dateEstimee: string
  retardJours: number
  delaiRecouvrementJours: number
  probabilite: number
}

/** probabilité d'encaissement selon le retard (0..1) */
export function probabiliteEncaissement(retardJours: number): number {
  if (retardJours <= 0) return 0.95
  if (retardJours <= 30) return 0.9
  if (retardJours <= 60) return 0.8
  if (retardJours <= 90) return 0.6
  return 0.45
}

/** estimation d'encaissement d'une facture émise non soldée : une facture en
 *  retard reçoit une date FUTURE (aujourd'hui + délai de recouvrement), jamais
 *  « encaissée aujourd'hui » (audit F6) */
export function encaissementEstime(state: AppState, f: Facture, today: string): EncaissementEstime | null {
  const solde = soldeFacture(state, f)
  if (f.type === 'avoir' || solde <= 0.01) return null
  const projet = projetById(state, f.projetId)
  const echeance = encaissementPrevu(f)
  const retardJours = Math.max(0, diffDays(echeance, today))
  const delaiRecouvrement = retardJours > 0 ? (projet ? delaiMoyenPaiement(state, projet.typeMO) ?? 30 : 30) : 0
  // pas en retard → échéance contractuelle ; en retard → aujourd'hui + recouvrement
  const dateEstimee = retardJours > 0 ? addDays(today, Math.max(15, Math.round(delaiRecouvrement / 2))) : echeance
  return {
    factureId: f.id,
    numero: f.numero || f.id,
    soldeTTC: solde,
    dateEstimee,
    retardJours,
    delaiRecouvrementJours: delaiRecouvrement,
    probabilite: probabiliteEncaissement(retardJours),
  }
}

// ------------------------------------------------------------------
// Contrats récurrents ancrés (première échéance → date de fin)
// ------------------------------------------------------------------

/** occurrences de décaissement d'un contrat récurrent entre [debut, fin],
 *  ancrées sur la première échéance réelle et arrêtées à la date de fin */
export function occurrencesRecurrentes(c: Contrat, debut: string, fin: string): string[] {
  const pas = c.periodiciteMois || 0
  if (pas <= 0 || c.montantAttenduHT == null) return []
  const borneFin = c.dateFin && c.dateFin < fin ? c.dateFin : fin
  // ancre : première échéance réelle, sinon renouvellement, sinon début de fenêtre
  const ancre = c.premiereEcheance || c.dateRenouvellement || debut
  const res: string[] = []
  const ancreMois = monthKey(ancre)
  const jour = ancre.slice(8, 10) || '15'
  // on part de l'ancre puis on avance/recule au pas jusqu'à couvrir [debut, borneFin]
  let n = 0
  // reculer si l'ancre est après le début (trouver la 1re occurrence >= debut)
  while (moisPlus(ancreMois, jour, n - pas) >= monthKey(debut) + '-01') n -= pas
  let cur = moisPlus(ancreMois, jour, n)
  let garde = 0
  while (cur <= borneFin && garde < 60) {
    if (cur >= debut) res.push(cur)
    n += pas
    cur = moisPlus(ancreMois, jour, n)
    garde++
  }
  return res
}

function moisPlus(ancreMois: string, jour: string, deltaMois: number): string {
  const base = addMonths(ancreMois, deltaMois) // 'AAAA-MM'
  const j = String(Math.min(Number(jour) || 15, 28)).padStart(2, '0')
  return `${base}-${j}`
}

// ------------------------------------------------------------------
// Synthèse agence + rentabilité par client (F9)
// ------------------------------------------------------------------

export interface LigneRentabiliteClient {
  client: string
  projets: number
  honorairesSignes: number
  coutFinal: number
  margeFinale: number
  tauxMarge: number | null
}

/** rentabilité FINALE par client (regroupe les projets par maître d'ouvrage) */
export function rentabiliteParClient(state: AppState): LigneRentabiliteClient[] {
  const par = new Map<string, LigneRentabiliteClient>()
  for (const p of state.projets) {
    if (!STATUTS_ACTIFS.includes(p.statut) && p.statut !== 'Livré') continue
    const client = (p.moa || 'Client non précisé').trim()
    const mf = margeFinale(state, p)
    const cur = par.get(client) || { client, projets: 0, honorairesSignes: 0, coutFinal: 0, margeFinale: 0, tauxMarge: null }
    cur.projets++
    cur.honorairesSignes += mf.honorairesSignes
    cur.coutFinal += mf.coutFinal
    cur.margeFinale += mf.marge
    par.set(client, cur)
  }
  const lignes = [...par.values()].map((l) => ({
    ...l,
    honorairesSignes: Math.round(l.honorairesSignes * 100) / 100,
    coutFinal: Math.round(l.coutFinal * 100) / 100,
    margeFinale: Math.round(l.margeFinale * 100) / 100,
    tauxMarge: l.honorairesSignes > 0 ? l.margeFinale / l.honorairesSignes : null,
  }))
  return lignes.sort((a, b) => b.margeFinale - a.margeFinale)
}

// ------------------------------------------------------------------
// ROI des appels d'offres / concours (depuis le temps hors projet)
// ------------------------------------------------------------------

export interface RoiAO {
  coutProspection: number
  joursProspection: number
  valeurAttendue: number
  nbEnCours: number
  roi: number | null
}

/** coût de la prospection (temps hors projet catégorie AO) vs valeur attendue
 *  des consultations en cours (budget travaux × probabilité × taux honoraires) */
export function roiAppelsOffres(state: AppState, tauxHonoraires = 0.1): RoiAO {
  let jours = 0
  let cout = 0
  for (const t of state.tempsHorsProjet) {
    if (!/prospection|ao|concours|appel/i.test(t.categorie)) continue
    jours += enJours(state, t.heures)
    cout += t.heures * coutHoraireMoyen(state)
  }
  const enCours = state.consultations.filter((c) => c.statut === 'a_etudier' || c.statut === 'go' || c.statut === 'deposee')
  const valeurAttendue = enCours.reduce((s, c) => s + (c.budgetTravaux || 0) * tauxHonoraires * probaConsultation(c), 0)
  return {
    coutProspection: Math.round(cout * 100) / 100,
    joursProspection: Math.round(jours * 10) / 10,
    valeurAttendue: Math.round(valeurAttendue * 100) / 100,
    nbEnCours: enCours.length,
    roi: cout > 0 ? Math.round((valeurAttendue / cout) * 100) / 100 : null,
  }
}

// ------------------------------------------------------------------
// Consultations par valeur attendue (revue de direction, F8 §7)
// ------------------------------------------------------------------

export function consultationsParValeur(state: AppState, tauxHonoraires = 0.1): {
  c: Consultation
  valeurAttendue: number
  proba: number
}[] {
  return state.consultations
    .filter((c) => c.statut === 'a_etudier' || c.statut === 'go' || c.statut === 'deposee')
    .map((c) => ({ c, proba: probaConsultation(c), valeurAttendue: Math.round((c.budgetTravaux || 0) * tauxHonoraires * probaConsultation(c) * 100) / 100 }))
    .sort((a, b) => b.valeurAttendue - a.valeurAttendue)
}

// ------------------------------------------------------------------
// Budget de trésorerie glissant 12 mois (F9) — explicable mois par mois
// ------------------------------------------------------------------

export interface FluxMois {
  montant: number // TTC signé
  libelle: string
  source: string
}

export interface MoisTresorerie {
  mois: string // 'AAAA-MM'
  entrees: FluxMois[]
  sorties: FluxMois[]
  variation: number
  solde: number
}

export interface Budget12Mois {
  soldeDepart: number
  sourceSolde: 'banque' | 'manuel' | 'aucun'
  mois: MoisTresorerie[]
  pointBas: { mois: string; solde: number }
}

/** budget de trésorerie mensuel sur 12 mois (TTC), chaque mois explicable.
 *  Encaissements probabilisés (plus de facture « encaissée aujourd'hui »),
 *  récurrents ancrés, salaires + frais généraux + TVA paramétrée. */
export function budget12Mois(
  state: AppState,
  today: string,
  soldeDepart: number,
  sourceSolde: Budget12Mois['sourceSolde'],
): Budget12Mois {
  const moisCourant = monthKey(today)
  const buckets = new Map<string, MoisTresorerie>()
  const listeMois: string[] = []
  for (let i = 0; i < 12; i++) {
    const m = addMonths(moisCourant, i)
    listeMois.push(m)
    buckets.set(m, { mois: m, entrees: [], sorties: [], variation: 0, solde: 0 })
  }
  const finFenetre = addMonths(moisCourant, 11) + '-31'
  const pousser = (date: string, flux: FluxMois) => {
    const m = monthKey(date)
    const b = buckets.get(m)
    if (!b) return
    ;(flux.montant >= 0 ? b.entrees : b.sorties).push(flux)
  }

  // entrées : factures émises non soldées (encaissement PROBABILISÉ)
  for (const f of state.factures) {
    const est = encaissementEstime(state, f, today)
    if (!est || est.dateEstimee > finFenetre) continue
    const attendu = Math.round(est.soldeTTC * est.probabilite * 100) / 100
    pousser(est.dateEstimee, { montant: attendu, libelle: `Encaissement ${est.numero}${est.probabilite < 0.95 ? ` (proba ${Math.round(est.probabilite * 100)} %)` : ''}`, source: 'facture' })
  }
  // entrées : échéances de facturation (pondérées 80 % — pas encore émises)
  for (const e of state.echeancesFacturation) {
    const date = addDays(e.datePrevue < today ? today : e.datePrevue, e.delaiJours)
    if (date > finFenetre) continue
    pousser(date, { montant: Math.round(e.montantHT * (1 + e.tauxTVA) * 0.8 * 100) / 100, libelle: `Échéance ${e.projetId} — ${e.libelle} (pondérée 80 %)`, source: 'echeance' })
  }
  // sorties : achats fournisseurs validés non payés
  for (const f of state.facturesAchat) {
    if (f.statut !== 'validee' || (f.payeLe && !f.paiementAConfirmer)) continue
    const date = f.dateEcheance || addDays(f.dateFacture, 30)
    if (date < today || date > finFenetre) continue
    pousser(date, { montant: -f.montantTTC, libelle: `Fournisseur ${f.fournisseur}`, source: 'achat' })
  }
  // sorties : contrats récurrents ANCRÉS (première échéance → date de fin)
  let annuelRecurrent = 0
  for (const c of state.contrats) {
    if ((c.type !== 'agence' && c.type !== 'fournisseur') || !(c.periodiciteMois || 0) || c.montantAttenduHT == null) continue
    annuelRecurrent += (c.montantAttenduHT * 12) / c.periodiciteMois!
    for (const date of occurrencesRecurrentes(c, today, finFenetre)) {
      pousser(date, { montant: -Math.round(c.montantAttenduHT * 1.2 * 100) / 100, libelle: `${c.intitule} (récurrent)`, source: 'recurrent' })
    }
  }
  // sorties : salaires chargés + frais généraux mensualisés + TVA paramétrée
  const salaires = state.settings.equipe.reduce((s, p) => s + p.remuMensuelle * p.coefCharges, 0)
  const fgAnnuel = Math.max(
    0,
    ((state.settings.fraisGenerauxLignes && state.settings.fraisGenerauxLignes.length > 0
      ? state.settings.fraisGenerauxLignes.reduce((s, l) => s + l.montantAnnuel, 0)
      : state.settings.fraisGenerauxAnnuels) || 0) - annuelRecurrent,
  )
  const tva = state.settings.tvaMensuelleEstimee
  for (const m of listeMois) {
    if (salaires > 0) pousser(`${m}-28`, { montant: -Math.round(salaires * 100) / 100, libelle: 'Salaires + charges', source: 'salaires' })
    if (fgAnnuel > 0) pousser(`${m}-28`, { montant: -Math.round((fgAnnuel / 12) * 100) / 100, libelle: 'Frais généraux (hors récurrents)', source: 'fg' })
    if (tva != null && tva > 0) pousser(`${m}-20`, { montant: -tva, libelle: 'TVA / impôts prévisionnels', source: 'tva' })
  }

  let solde = soldeDepart
  const mois: MoisTresorerie[] = []
  for (const m of listeMois) {
    const b = buckets.get(m)!
    b.variation = Math.round([...b.entrees, ...b.sorties].reduce((s, f) => s + f.montant, 0) * 100) / 100
    solde = Math.round((solde + b.variation) * 100) / 100
    b.solde = solde
    mois.push(b)
  }
  const pointBas = mois.reduce((min, b) => (b.solde < min.solde ? { mois: b.mois, solde: b.solde } : min), {
    mois: mois[0]?.mois || moisCourant,
    solde: mois[0]?.solde ?? soldeDepart,
  })
  return { soldeDepart, sourceSolde, mois, pointBas }
}

// ------------------------------------------------------------------
// Simulateur de projet (F9)
// ------------------------------------------------------------------

export interface ResultatSimulation {
  honorairesPonderes: number
  coutInterne: number
  coutExterne: number
  coutEmbauche: number
  investissement: number
  coutTotal: number
  margeAttendue: number
  tauxMarge: number | null
}

/** évalue une simulation : espérance = honoraires × probabilité − coûts */
export function evaluerSimulation(state: AppState, sim: {
  honorairesHT: number
  probabilite: number
  heures: number
  coutsExternesHT: number
  embauche?: { moisApres: number; coutMensuel: number } | null
  investissement?: { moisApres: number; montant: number } | null
}): ResultatSimulation {
  const honorairesPonderes = Math.round(sim.honorairesHT * sim.probabilite * 100) / 100
  const coutInterne = Math.round(sim.heures * coutHoraireMoyen(state) * 100) / 100
  const coutExterne = Math.round(sim.coutsExternesHT * 100) / 100
  // une embauche pèse sur ~12 mois de contribution au projet (indicatif)
  const coutEmbauche = sim.embauche ? Math.round(sim.embauche.coutMensuel * 12 * 100) / 100 : 0
  const investissement = sim.investissement ? Math.round(sim.investissement.montant * 100) / 100 : 0
  const coutTotal = Math.round((coutInterne + coutExterne + coutEmbauche + investissement) * 100) / 100
  const margeAttendue = Math.round((honorairesPonderes - coutTotal) * 100) / 100
  return {
    honorairesPonderes,
    coutInterne,
    coutExterne,
    coutEmbauche,
    investissement,
    coutTotal,
    margeAttendue,
    tauxMarge: honorairesPonderes > 0 ? margeAttendue / honorairesPonderes : null,
  }
}
