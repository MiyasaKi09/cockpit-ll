// Valeurs dérivées — une seule source de vérité par donnée :
// le facturé vient des factures, les heures réelles du pointage.

import type { AppState, BaselineHeures, Consultation, EcheanceFacturation, Facture, MarcheTravaux, Phase, PhaseCode, Projet, Situation, StatutConsultation } from './types'
import { PHASES_ORDRE, calculHonoraires } from './miqcp'
import {
  creanceFactureTTC,
  montantRestantAnnulableHT,
  regleSurFacture,
  soldeFacture,
  ttcFacture,
} from './facture'
import { addDays, diffDays, fmtDate, fmtMoney, fold } from './util'

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

/** HT encaissé pour un projet — dérivé des PAIEMENTS (audit F0) :
 *  part HT de chaque facture au prorata de ce qui est réellement réglé */
export function encaisseHT(state: AppState, projetId: string, phase?: PhaseCode): number {
  let total = 0
  for (const f of state.factures) {
    if (f.projetId !== projetId || (phase !== undefined && f.phase !== phase)) continue
    const t = ttcFacture(f)
    if (t <= 0) continue
    const regle = regleSurFacture(state, f.id)
    total += f.montantHT * Math.min(1, regle / t)
  }
  return total
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

// ------------------------------------------------------------------
// Baseline des heures — la prévision FIGÉE (CDC §11.3, critère 15)
//
// `heuresPrevues` ci-dessus lit la répartition COURANTE, celle que
// « Recalculer la répartition » écrase sans retour. Mesurer l'écart
// prévu / réel dessus, c'est mesurer contre une cible qui bouge : au
// premier recalcul l'écart repart de zéro, et la semaine de mesure
// perdue ne se rattrape pas. D'où une donnée de référence distincte —
// et rien du moteur existant ne change : aucune fonction ci-dessus
// n'est modifiée, ce bloc n'est qu'additif.
// ------------------------------------------------------------------

/** heures arrondies au dixième — même précision que `fmtHeures` */
function arrondiHeures(h: number): number {
  return Math.round(h * 10) / 10
}

const ORIGINES_BASELINE: BaselineHeures['origine'][] = ['signature', 'creation', 'reprise', 'revision']

/** construit une baseline à partir d'une répartition de phases. Pure : elle
 *  dit à quoi ressemble une référence, l'appelant décide QUAND figer.
 *  Une phase à 0 h est conservée — « 0 h prévue » est une prévision, pas une
 *  absence de prévision, et la distinction porte l'écart. */
export function baselineDepuisPhases(
  phases: Phase[],
  meta: {
    le: string
    par?: string | null
    origine: BaselineHeures['origine']
    honorairesBaseHT?: number | null
  },
): BaselineHeures {
  const parPhase: Partial<Record<PhaseCode, number>> = {}
  for (const ph of phases || []) {
    if (!ph || !PHASES_ORDRE.includes(ph.code)) continue
    parPhase[ph.code] = arrondiHeures(typeof ph.heuresPrevues === 'number' ? ph.heuresPrevues : 0)
  }
  return {
    le: meta.le,
    par: meta.par || undefined,
    origine: meta.origine,
    parPhase,
    honorairesBaseHT: meta.honorairesBaseHT ?? null,
  }
}

/** ramène une baseline lue d'un JSON (import, état distant, version future) à
 *  une valeur sûre : phase inconnue écartée — comptée dans le total, elle
 *  gonflerait la référence sans jamais apparaître dans aucune ligne — et
 *  origine hors liste ramenée à « reprise », qui ne surpromet rien.
 *  `undefined` quand il n'y a rien d'exploitable. */
export function normaliserBaselineHeures(valeur: unknown): BaselineHeures | undefined {
  if (!valeur || typeof valeur !== 'object') return undefined
  const brut = valeur as Partial<BaselineHeures>
  if (typeof brut.le !== 'string' || !brut.le) return undefined
  const parPhase: Partial<Record<PhaseCode, number>> = {}
  const source = (brut.parPhase || {}) as Record<string, unknown>
  for (const code of PHASES_ORDRE) {
    const h = source[code]
    if (typeof h === 'number' && Number.isFinite(h)) parPhase[code] = arrondiHeures(h)
  }
  return {
    le: brut.le,
    par: typeof brut.par === 'string' && brut.par.trim() ? brut.par.trim() : undefined,
    origine: ORIGINES_BASELINE.includes(brut.origine as BaselineHeures['origine'])
      ? (brut.origine as BaselineHeures['origine'])
      : 'reprise',
    parPhase,
    honorairesBaseHT: typeof brut.honorairesBaseHT === 'number' ? brut.honorairesBaseHT : null,
  }
}

/** valeur de `Projet.baselineHeures` après migration (palier v20).
 *  - une baseline déjà posée est seulement NORMALISÉE ;
 *  - `null` — « volontairement sans référence » — est respecté ;
 *  - la reprise ne se déclenche qu'au FRANCHISSEMENT du palier (`reprendre`),
 *    jamais à chaque chargement : rejouée, elle réécrirait une référence que
 *    l'utilisateur vient de redéfinir ou d'effacer, et personne ne le verrait.
 *  La reprise est étiquetée `reprise`, jamais `signature` : la répartition
 *  trouvée en place n'est pas la prévision du contrat, c'est seulement la
 *  meilleure approximation encore disponible. */
export function baselineApresMigration(
  projet: Projet,
  reprendre: boolean,
  le: string,
): BaselineHeures | null | undefined {
  if (projet.baselineHeures === null) return null
  const existante = normaliserBaselineHeures(projet.baselineHeures)
  if (existante) return existante
  if (!reprendre) return undefined
  const phases = Array.isArray(projet.phases) ? projet.phases : []
  const total = phases.reduce((s, ph) => s + (typeof ph?.heuresPrevues === 'number' ? ph.heuresPrevues : 0), 0)
  if (total <= 0) return undefined
  return baselineDepuisPhases(phases, { le, origine: 'reprise' })
}

/** heures de la prévision figée, option par phase. `null` — et jamais 0 —
 *  quand il n'y a pas de référence : un 0 se lirait comme « rien n'était
 *  prévu », donc comme un dépassement intégral. */
export function heuresBaseline(projet: Projet, phase?: PhaseCode): number | null {
  const b = projet.baselineHeures
  if (!b || !b.parPhase) return null
  if (phase !== undefined) {
    const h = b.parPhase[phase]
    return typeof h === 'number' && Number.isFinite(h) ? h : null
  }
  let total = 0
  let trouve = false
  for (const code of PHASES_ORDRE) {
    const h = b.parPhase[code]
    if (typeof h === 'number' && Number.isFinite(h)) {
      total += h
      trouve = true
    }
  }
  return trouve ? arrondiHeures(total) : null
}

/** comparaison prévu / réel du §11.3, en heures et signée */
export interface EcartHeuresPhase {
  /** prévision FIGÉE — `null` si le projet n'en a pas, ou si la phase est née
   *  après le figeage */
  baseline: number | null
  /** répartition COURANTE : ce qu'un recalcul remplace */
  prevu: number
  reel: number
  /** référence retenue pour l'écart : la baseline dès qu'elle existe */
  reference: number
  /** réel − référence, signé (le « +28 h » du §11.3) */
  ecart: number
  /** l'écart est-il mesuré sur la prévision figée ? Sinon il se remet à zéro
   *  au prochain recalcul, et l'écran doit pouvoir le dire. */
  surBaseline: boolean
  /** courant − figé : de combien la PRÉVISION elle-même a bougé depuis la
   *  signature. C'est la valeur que la baseline seule rend visible. */
  derivePrevision: number | null
}

export function ecartHeures(state: AppState, projet: Projet, phase?: PhaseCode): EcartHeuresPhase {
  const baseline = heuresBaseline(projet, phase)
  const prevu = arrondiHeures(heuresPrevues(projet, phase))
  const reel = arrondiHeures(heuresReelles(state, projet.id, phase))
  const reference = baseline ?? prevu
  return {
    baseline,
    prevu,
    reel,
    reference,
    ecart: arrondiHeures(reel - reference),
    surBaseline: baseline !== null,
    derivePrevision: baseline === null ? null : arrondiHeures(prevu - baseline),
  }
}

export function coutEngage(state: AppState, projetId: string): number {
  return coutReelTemps(state, projetId)
}

/** HT encaissé sur une période — part HT des paiements datés [debut, fin] */
export function encaisseHTPeriode(state: AppState, debut: string, fin: string): number {
  const parId = new Map(state.factures.map((f) => [f.id, f]))
  let total = 0
  for (const p of state.paiements) {
    if (p.date < debut || p.date > fin) continue
    for (const a of p.affectations) {
      const f = parId.get(a.factureId)
      if (!f) continue
      const t = ttcFacture(f)
      if (t !== 0) total += f.montantHT * (a.montant / t)
    }
  }
  return total
}

/** date d'encaissement prévue d'une facture */
export function encaissementPrevu(f: Facture): string {
  return addDays(f.emission, f.delaiJours)
}

/** date d'encaissement prévue d'une échéance (si facturée à la date prévue) */
export function encaissementPrevuEcheance(e: EcheanceFacturation): string {
  return addDays(e.datePrevue, e.delaiJours)
}

/** jours de retard d'une facture émise non encaissée (0 si pas en retard) */
export function retardFacture(state: AppState, f: Facture, today: string): number {
  if (f.type === 'avoir' || f.statut !== 'emise' || soldeFacture(state, f) <= 0.01) return 0
  const r = diffDays(encaissementPrevu(f), today)
  return Math.max(0, r)
}

export function ttc(f: Facture): number {
  // pièce émise figée : le TTC est celui du bloc gelé (audit F0)
  if (f.figee) return f.figee.totalTTC
  return f.montantHT * (1 + f.tauxTVA)
}

/** statuts considérés comme « au carnet » */
export const STATUTS_ACTIFS: Projet['statut'][] = ['Signé', 'En cours']

export interface Meteo {
  /** trésorerie disponible (saisie Paramètres / relevé) */
  tresorerie: number | null
  tresorerieMajLe: string | null
  /** HT restant à encaisser ou à facturer sous 90 jours */
  facturable90j: number
  /** carnet de commandes : honoraires restant à facturer, projets signés/en cours */
  carnetHT: number
}

export function meteoFinanciere(state: AppState, today: string): Meteo {
  const horizon = addDays(today, 90)
  // Créances nettes des paiements et avoirs + échéances à facturer sous 90 j.
  const aEncaisserHT = state.factures
    .filter((f) => f.type !== 'avoir' && f.statut !== 'prevue' && f.emission <= horizon)
    .reduce((somme, facture) => {
      const creanceTTC = creanceFactureTTC(state, facture)
      const soldeTTC = soldeFacture(state, facture)
      if (creanceTTC <= 0.01 || soldeTTC <= 0.01) return somme
      const creanceHT = montantRestantAnnulableHT(state, facture)
      return somme + creanceHT * Math.min(1, soldeTTC / creanceTTC)
    }, 0)
  const facturable90j =
    aEncaisserHT +
    state.echeancesFacturation
      .filter((e) => e.datePrevue <= horizon)
      .reduce((s, e) => s + e.montantHT, 0)
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

/** délai moyen de paiement constaté (jours), par type de MO ou global —
 *  depuis les PAIEMENTS : date du dernier règlement qui solde la facture */
export function delaiMoyenPaiement(state: AppState, typeMO?: string): number | null {
  const delais: number[] = []
  for (const f of state.factures) {
    if (typeMO) {
      const p = projetById(state, f.projetId)
      if (p?.typeMO !== typeMO) continue
    }
    const t = ttcFacture(f)
    if (t <= 0) continue
    if (regleSurFacture(state, f.id) < t - 0.01) continue // pas soldée
    let dernier = ''
    for (const p of state.paiements) {
      if (p.affectations.some((a) => a.factureId === f.id) && p.date > dernier) dernier = p.date
    }
    if (dernier) delais.push(diffDays(f.emission, dernier))
  }
  if (delais.length === 0) return null
  return Math.round(delais.reduce((s, d) => s + d, 0) / delais.length)
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

/** Personnes affectées à un projet (équipe explicite + responsables).
 *  **Seule définition** de « qui travaille sur ce projet » : elle décide
 *  à la fois du plan de charge, des lignes pré-remplies du tableau de
 *  temps et de l'équipe montrée sur la fiche. Recopiée sur un écran, elle
 *  divergerait sans bruit — un projet visible au planning et absent de la
 *  feuille de temps de la personne, ou l'inverse.
 *  `scripts/test-equipe-projet.cjs` le vérifie. */
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

/** heures d'absence (congés) d'une personne sur la semaine du lundi donné */
export function heuresAbsenceSemaine(state: AppState, personne: string, lundi: string): number {
  const abs = (state.absences || []).filter((a) => a.personne === personne)
  if (abs.length === 0) return 0
  let jours = 0
  for (let i = 0; i < 5; i++) {
    const jour = addDays(lundi, i)
    if (abs.some((a) => a.debut <= jour && a.fin >= jour)) jours++
  }
  return jours * state.settings.heuresParJour
}

/** capacité RÉELLE d'une personne pour la semaine, congés déduits (heures) */
export function capacitePersonneSemaine(state: AppState, personne: string, lundi: string): number {
  return Math.max(0, capaciteSemaine(state) - heuresAbsenceSemaine(state, personne, lundi))
}

/** CA HT facturé (émis ou encaissé) sur une année civile — confronté à la cible */
export function caRealiseAnnee(state: AppState, annee: number): number {
  const prefixe = String(annee)
  return state.factures
    .filter((f) => f.statut !== 'prevue' && f.emission.slice(0, 4) === prefixe)
    .reduce((s, f) => s + f.montantHT, 0)
}

/** Objectif de chiffre d'affaires. Si une marge nette est visée, le CA cible
 *  se déduit des coûts : pour dégager une marge m sur le CA, il faut
 *  CA = coûts ÷ (1 − m). Sinon on retient la cible saisie à la main.
 *  Les coûts (équipe chargée + frais généraux) incluent déjà la rémunération
 *  des dirigeants : le « résultat visé » est le bénéfice APRÈS s'être payés. */
export function objectifCA(state: AppState): {
  marge: number | null
  coutsAnnuels: number
  caCible: number
  resultatVise: number
  auto: boolean
} {
  const coutsAnnuels = coutAgenceAnnuel(state)
  const marge = state.settings.margeCiblePct ?? null
  if (marge != null && marge > 0 && marge < 1) {
    const caCible = coutsAnnuels / (1 - marge)
    return { marge, coutsAnnuels, caCible, resultatVise: caCible - coutsAnnuels, auto: true }
  }
  const caCible = state.settings.caCibleHT
  return { marge: null, coutsAnnuels, caCible, resultatVise: caCible - coutsAnnuels, auto: false }
}

/** CA cible retenu (calculé depuis la marge visée, sinon saisi) */
export function caCible(state: AppState): number {
  return objectifCA(state).caCible
}

/** heures facturables de l'équipe sur l'année (Σ heures annuelles × part facturable) */
export function heuresFacturablesAnnuelles(state: AppState): number {
  return state.settings.equipe.reduce((s, p) => s + p.heuresAnnuelles * p.facturablePct, 0)
}

/** Taux horaire de vente « objectif » déduit des coûts et des marges :
 *  1) coût au seuil = coûts d'agence ÷ heures facturables (couvre salaires + frais) ;
 *  2) marge nette visée : ÷ (1 − marge) pour dégager le bénéfice ;
 *  3) marge supplémentaire : × (1 + coussin) pour absorber négos et imprévus. */
export function tauxVenteObjectif(state: AppState): {
  base: number
  marge: number
  margeSupp: number
  taux: number
  heuresFac: number
} {
  const heuresFac = heuresFacturablesAnnuelles(state)
  const couts = coutAgenceAnnuel(state)
  const base = heuresFac > 0 ? couts / heuresFac : 0
  const marge = Math.min(0.95, Math.max(0, state.settings.margeCiblePct ?? 0))
  const margeSupp = Math.max(0, state.settings.margeSecuritePct ?? 0)
  const taux = (base / (1 - marge)) * (1 + margeSupp)
  return { base, marge, margeSupp, taux, heuresFac }
}

/** taux horaire de vente retenu : calculé (mode auto) ou saisi à la main */
export function tauxVente(state: AppState): number {
  if (state.settings.tauxHoraireAuto) return Math.round(tauxVenteObjectif(state).taux)
  return state.settings.tauxHoraireVente
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

// ------------------------------------------------------------------
// Retenue de garantie — cycle de vie par marché : cumul retenu,
// réception, levée à réception + 1 an (garantie de parfait achèvement).
// ------------------------------------------------------------------

export type StatutRG = 'en_cours' | 'retenue' | 'a_liberer' | 'liberee'

export interface RGMarche {
  travauxCumulHT: number
  retenueHT: number
  dateReception: string | null
  dateLevee: string | null
  caution: boolean
  statut: StatutRG
}

/** cumul des travaux HT validés d'un marché (dernière situation validée) */
export function travauxCumulMarche(state: AppState, marcheId: string): number {
  return state.situations
    .filter((s) => s.marcheId === marcheId && s.statut === 'validee')
    .reduce((m, s) => Math.max(m, s.montantCumulHT ?? s.montantMoisHT ?? 0), 0)
}

/** état de la retenue de garantie d'un marché */
export function retenueGarantieMarche(state: AppState, marche: MarcheTravaux, today: string): RGMarche {
  const travauxCumulHT = travauxCumulMarche(state, marche.id)
  const retenueHT = travauxCumulHT * (marche.tauxRG || 0)
  const dateReception = marche.dateReception || null
  // réception + 1 an (même jour l'année suivante) — garantie de parfait achèvement
  const dateLevee = dateReception ? `${Number(dateReception.slice(0, 4)) + 1}${dateReception.slice(4)}` : null
  const statut: StatutRG = marche.rgLibere
    ? 'liberee'
    : !dateReception
      ? 'en_cours'
      : dateLevee && today >= dateLevee
        ? 'a_liberer'
        : 'retenue'
  return { travauxCumulHT, retenueHT, dateReception, dateLevee, caution: !!marche.cautionRG, statut }
}

// ------------------------------------------------------------------
// Pipeline commercial — probabilité par étape, prévisionnel pondéré,
// vieillissement des cartes.
// ------------------------------------------------------------------

/** probabilité de succès par défaut selon l'étape du pipeline */
export const PROBA_ETAPE: Record<StatutConsultation, number> = {
  a_etudier: 0.1,
  go: 0.3,
  deposee: 0.5,
  gagnee: 1,
  perdue: 0,
  no_go: 0,
}

/** probabilité retenue : saisie sur la consultation, sinon barème d'étape */
export function probaConsultation(c: Consultation): number {
  return c.probabilite != null ? c.probabilite : PROBA_ETAPE[c.statut]
}

/** prévisionnel pondéré = Σ budget travaux × probabilité, sur les étapes actives */
export function previsionnelPondere(consultations: Consultation[]): number {
  return consultations
    .filter((c) => c.statut === 'a_etudier' || c.statut === 'go' || c.statut === 'deposee')
    .reduce((s, c) => s + (c.budgetTravaux || 0) * probaConsultation(c), 0)
}

/** jours écoulés depuis le dernier mouvement d'étape (null si inconnu) */
export function ageCarte(c: Consultation, today: string): number | null {
  return c.dernierMouvement ? Math.max(0, diffDays(c.dernierMouvement, today)) : null
}

// ------------------------------------------------------------------
// Grille Go/No-Go pondérée — décision aidée mais déterministe.
// Chaque critère est noté 0 (rédhibitoire) à 4 (idéal), pondéré ;
// le score normalisé donne une recommandation. La décision reste humaine.
// ------------------------------------------------------------------

export interface CritereGoNoGo {
  code: string
  label: string
  poids: number
  aide: string
}

export const CRITERES_GO_NOGO: CritereGoNoGo[] = [
  { code: 'references', label: 'Adéquation avec nos références', poids: 3, aide: 'a-t-on des références proches (typologie, montant) ?' },
  { code: 'charge', label: 'Disponibilité / plan de charge', poids: 2, aide: 'a-t-on la capacité de produire dans les délais ?' },
  { code: 'honoraires', label: 'Honoraires vs effort', poids: 2, aide: 'le budget justifie-t-il le temps de montage et de production ?' },
  { code: 'distance', label: 'Proximité / déplacements', poids: 1, aide: 'le chantier est-il accessible sans trop de trajets ?' },
  { code: 'concurrence', label: 'Concurrence / chances', poids: 1, aide: 'la concurrence attendue laisse-t-elle une vraie chance ?' },
]

export interface EvaluationGoNoGo {
  note: number | null // 0-1, null si non évaluée
  reco: 'Plutôt Go' | 'À étudier' | 'Plutôt No-Go' | null
  tone: 'ok' | 'warn' | 'danger' | 'muted'
  complet: boolean
}

/** évalue la grille : score pondéré normalisé (0-1) + recommandation */
export function evaluerGoNoGo(scores: Record<string, number> | undefined): EvaluationGoNoGo {
  if (!scores || Object.keys(scores).length === 0) {
    return { note: null, reco: null, tone: 'muted', complet: false }
  }
  let obtenu = 0
  let max = 0
  for (const c of CRITERES_GO_NOGO) {
    const s = scores[c.code]
    if (s == null) continue
    obtenu += s * c.poids
    max += 4 * c.poids
  }
  if (max === 0) return { note: null, reco: null, tone: 'muted', complet: false }
  const note = obtenu / max
  const complet = CRITERES_GO_NOGO.every((c) => scores[c.code] != null)
  const reco = note >= 0.65 ? 'Plutôt Go' : note >= 0.4 ? 'À étudier' : 'Plutôt No-Go'
  const tone = note >= 0.65 ? 'ok' : note >= 0.4 ? 'warn' : 'danger'
  return { note, reco, tone, complet }
}

// ------------------------------------------------------------------
// Synthèses de période (Analyse & Revue de pilotage) — CA facturé,
// temps et coûts réels agrégés par projet, par mois, par personne.
// ------------------------------------------------------------------

export interface LigneAnalyse {
  projetId: string
  ca: number
  coutTemps: number
  coutExterne: number
  margeReelle: number
  jours: number
  parJour: number | null
  partCA: number
  partTemps: number
}

export interface SyntheseAnalyse {
  lignes: LigneAnalyse[]
  totalCA: number
  totalJours: number
  totalCoutTemps: number
  totalCoutExterne: number
  joursHorsProjet: number
  parJourMoyen: number | null
}

/** CA facturé (émis/encaissé), temps et coûts réels par projet sur [debut, fin] */
export function analyserPeriode(state: AppState, debut: string, fin: string): SyntheseAnalyse {
  const parProjet = new Map<string, LigneAnalyse>()
  const ligne = (id: string): LigneAnalyse => {
    if (!parProjet.has(id))
      parProjet.set(id, { projetId: id, ca: 0, coutTemps: 0, coutExterne: 0, margeReelle: 0, jours: 0, parJour: null, partCA: 0, partTemps: 0 })
    return parProjet.get(id)!
  }

  for (const f of state.factures) {
    if (f.statut === 'prevue') continue
    if (f.emission < debut || f.emission > fin) continue
    ligne(f.projetId).ca += f.montantHT
  }
  for (const t of state.temps) {
    if (t.semaine < debut || t.semaine > fin) continue
    const l = ligne(t.projetId)
    l.jours += enJours(state, t.heures)
    l.coutTemps += t.heures * coutHoraireDe(state, t.personne)
  }

  let joursHorsProjet = 0
  for (const t of state.tempsHorsProjet) {
    if (t.semaine < debut || t.semaine > fin) continue
    joursHorsProjet += enJours(state, t.heures)
  }

  const lignes = [...parProjet.values()].filter((l) => l.ca > 0 || l.jours > 0)
  const totalCA = lignes.reduce((s, l) => s + l.ca, 0)
  const totalJours = lignes.reduce((s, l) => s + l.jours, 0)
  const totalCoutTemps = lignes.reduce((s, l) => s + l.coutTemps, 0)
  for (const l of lignes) {
    // marge sur coûts DIRECTS de la période : CA − coût du temps pointé.
    // Le budget externe (non daté, saisi sur les phases) reste affiché à
    // titre indicatif mais n'est plus soustrait : il faussait la marge de
    // toute période courte (audit finance §12 — un budget n'est pas un coût
    // daté ; les achats réels arriveront avec le lot F2).
    l.coutExterne = coutsExternes(state, l.projetId)
    l.margeReelle = l.ca - l.coutTemps
    l.parJour = l.jours > 0.05 ? l.ca / l.jours : null
    l.partCA = totalCA > 0 ? l.ca / totalCA : 0
    l.partTemps = totalJours > 0 ? l.jours / totalJours : 0
  }
  lignes.sort((a, b) => b.ca - a.ca)

  return {
    lignes,
    totalCA,
    totalJours,
    totalCoutTemps,
    totalCoutExterne: lignes.reduce((s, l) => s + l.coutExterne, 0),
    joursHorsProjet,
    parJourMoyen: totalJours > 0.05 ? totalCA / totalJours : null,
  }
}

export interface CAMensuel {
  lignes: { projetId: string; mois: number[]; total: number }[]
  emisParMois: number[]
  encaisseParMois: number[]
  prevuParMois: number[]
}

/** Matrice CA facturé projets × 12 mois pour une année (émis / encaissé / prévu).
 *  L'encaissé vient des PAIEMENTS (part HT au prorata du réglé), le prévu
 *  des échéances de facturation — audit finance F0. */
export function caParMois(state: AppState, annee: number): CAMensuel {
  const parProjet = new Map<string, number[]>()
  const emisParMois = Array(12).fill(0) as number[]
  const encaisseParMois = Array(12).fill(0) as number[]
  const prevuParMois = Array(12).fill(0) as number[]

  const parId = new Map(state.factures.map((f) => [f.id, f]))
  for (const f of state.factures) {
    if (f.emission.slice(0, 4) === String(annee)) {
      const m = Number(f.emission.slice(5, 7)) - 1
      if (!parProjet.has(f.projetId)) parProjet.set(f.projetId, Array(12).fill(0))
      parProjet.get(f.projetId)![m] += f.montantHT
      emisParMois[m] += f.montantHT
    }
  }
  for (const p of state.paiements) {
    if (p.date.slice(0, 4) !== String(annee)) continue
    const m = Number(p.date.slice(5, 7)) - 1
    for (const a of p.affectations) {
      const f = parId.get(a.factureId)
      if (!f) continue
      const t = ttcFacture(f)
      encaisseParMois[m] += t !== 0 ? f.montantHT * (a.montant / t) : 0
    }
  }
  for (const e of state.echeancesFacturation) {
    if (e.datePrevue.slice(0, 4) !== String(annee)) continue
    prevuParMois[Number(e.datePrevue.slice(5, 7)) - 1] += e.montantHT
  }

  const lignes = [...parProjet.entries()]
    .map(([projetId, mois]) => ({ projetId, mois, total: mois.reduce((s, x) => s + x, 0) }))
    .sort((a, b) => b.total - a.total)
  return { lignes, emisParMois, encaisseParMois, prevuParMois }
}

export interface LigneTempsPersonne {
  personne: string
  heures: number
  jours: number
  cout: number
}

/** Temps pointé agrégé par personne (projets + hors-projet) sur [debut, fin] */
export function tempsParPersonne(state: AppState, debut: string, fin: string): LigneTempsPersonne[] {
  const par = new Map<string, { heures: number; cout: number }>()
  const ajouter = (personne: string, heures: number) => {
    const cur = par.get(personne) || { heures: 0, cout: 0 }
    cur.heures += heures
    cur.cout += heures * coutHoraireDe(state, personne)
    par.set(personne, cur)
  }
  for (const t of state.temps) {
    if (t.semaine < debut || t.semaine > fin) continue
    ajouter(t.personne, t.heures)
  }
  for (const t of state.tempsHorsProjet) {
    if (t.semaine < debut || t.semaine > fin) continue
    ajouter(t.personne, t.heures)
  }
  return [...par.entries()]
    .map(([personne, v]) => ({ personne, heures: v.heures, jours: enJours(state, v.heures), cout: v.cout }))
    .filter((l) => l.heures > 0)
    .sort((a, b) => b.heures - a.heures)
}

// ==================================================================
// ACCUEIL PERSONNEL (CDC §8.1) — ce que le Cockpit AFFICHE.
//
// « L'accueil n'invente aucun calcul » : chaque bloc de la page
// d'accueil lit une fonction de ce fichier plutôt que de refiltrer
// l'état pour son compte. La règle a déjà été contournée une fois —
// les factures à émettre étaient recalculées à la fois par le Cockpit
// et par `financeActions.actionsATraiter`, deux boucles sur les mêmes
// `echeancesFacturation`, deux libellés écrits séparément. Les deux
// gravités coïncidaient à la main : rien n'aurait signalé le jour où
// l'une aurait bougé. `scripts/test-accueil.cjs` verrouille le retour
// de ce genre de doublon.
//
// Aucun modèle de données neuf ici : tout se dérive de `AppState`, de
// la liste d'actions produite par `financeActions` et du flux Google
// Agenda déjà capté par `surveillance.ts`.
// ==================================================================

import type { DocumentRecord, ReunionChantier, StatutDocument } from './types'
// imports de TYPE uniquement (effacés à la compilation) : ce module
// reste exécutable hors navigateur, sans React ni session Google.
import type { EvenementAgenda } from './google'
import type { ActionFinance } from './financeActions'
import type { IconName } from './ui'

// ---------- validations attendues ----------

/** statuts d'un document qui appellent encore un geste humain */
export const STATUTS_DOCUMENT_A_TRAITER: StatutDocument[] = ['recu', 'a_classer', 'a_valider']

/** documents du registre en attente d'un geste humain — le compteur du
 *  menu Documents comme le bloc « validations attendues » de l'accueil
 *  lisent CETTE liste : recopié, le triplet de statuts diverge en silence */
export function documentsATraiter(state: AppState): DocumentRecord[] {
  return (state.registreDocuments || []).filter((d) => STATUTS_DOCUMENT_A_TRAITER.includes(d.statut))
}

/** situations déposées par la routine et pas encore vérifiées */
export function situationsAVerifier(state: AppState): Situation[] {
  return state.situations.filter((s) => s.statut === 'a_verifier')
}

/** une famille de validations en attente, telle qu'affichée sur l'accueil */
export interface GroupeValidation {
  cle: 'facture_achat' | 'document' | 'situation' | 'entrant'
  titre: string
  nombre: number
  detail: string
  lien: string
  gravite: 1 | 2 | 3
}

const pluriel = (n: number) => (n > 1 ? 's' : '')

/**
 * Validations attendues (CDC §8.1) — factures fournisseurs, documents du
 * registre, situations de travaux et pièces arrivées côté serveur.
 *
 * Les factures fournisseurs ne sont PAS refiltrées ici : elles arrivent
 * par `actionsFinance`, la liste que `financeActions.actionsATraiter`
 * produit déjà pour le badge Finance. `entrantsDistants` est passé par
 * l'appelant parce qu'il vient d'une requête réseau (index partagé
 * Supabase) et non de l'état local ; `null` = espace partagé non lu.
 */
export function validationsAttendues(
  state: AppState,
  today: string,
  actionsFinance: readonly ActionFinance[],
  entrantsDistants?: number | null,
): GroupeValidation[] {
  const groupes: GroupeValidation[] = []

  const achats = actionsFinance.filter((a) => a.kind === 'facture_achat')
  if (achats.length > 0) {
    const ancienne = achats.reduce((min, a) => ((a.date || '9999') < (min.date || '9999') ? a : min))
    groupes.push({
      cle: 'facture_achat',
      titre: `${achats.length} facture${pluriel(achats.length)} fournisseur${pluriel(achats.length)} à valider`,
      nombre: achats.length,
      detail: ancienne.date
        ? `la plus ancienne reçue le ${fmtDate(ancienne.date)} — à contrôler avant paiement`
        : 'à contrôler avant paiement',
      lien: achats[0].lien,
      gravite: 2,
    })
  }

  const docs = documentsATraiter(state)
  if (docs.length > 0) {
    const ancien = docs.reduce((min, d) => (d.recuLe < min.recuLe ? d : min))
    groupes.push({
      cle: 'document',
      titre: `${docs.length} document${pluriel(docs.length)} à classer ou à valider`,
      nombre: docs.length,
      detail: `le plus ancien reçu le ${fmtDate(ancien.recuLe.slice(0, 10))}`,
      lien: '#/documents',
      gravite: 2,
    })
  }

  const sits = situationsAVerifier(state)
  if (sits.length > 0) {
    const enRetard = sits.filter((s) => dateLimiteVerif(state, s) < today).length
    groupes.push({
      cle: 'situation',
      titre: `${sits.length} situation${pluriel(sits.length)} de travaux à vérifier`,
      nombre: sits.length,
      detail: enRetard > 0
        ? `dont ${enRetard} au-delà du délai contractuel de vérification`
        : 'délai de vérification en cours — la MOE porte le risque du délai global',
      lien: '#/situations',
      gravite: 3,
    })
  }

  if (entrantsDistants && entrantsDistants > 0) {
    groupes.push({
      cle: 'entrant',
      titre: `${entrantsDistants} pièce${pluriel(entrantsDistants)} arrivée${pluriel(entrantsDistants)} dans la boîte partagée`,
      nombre: entrantsDistants,
      detail: 'captée côté serveur — classement à confirmer à la main',
      lien: '#/documents',
      gravite: 2,
    })
  }

  return groupes.sort((a, b) => b.gravite - a.gravite || b.nombre - a.nombre)
}

// ---------- réunions du jour ----------

/** une réunion d'aujourd'hui, quelle que soit sa provenance */
export interface ReunionDuJour {
  id: string
  titre: string
  /** « HH:MM » quand l'heure est connue, sinon null (journée entière) */
  heure: string | null
  detail: string
  /** lien interne, absent pour un rendez-vous purement Google */
  lien: string | null
  source: 'chantier' | 'agenda'
}

/**
 * Réunions du jour (CDC §8.1) : les `ReunionChantier` datées d'aujourd'hui
 * et les rendez-vous Google Agenda BORNÉS À LA JOURNÉE.
 *
 * Le flux Google est passé en argument : seul le chemin navigateur a la
 * portée calendrier (src/google.ts, jeton OAuth en mémoire) — le jeton
 * serveur ne l'a pas. Sans session Google ouverte, `agenda` est vide et
 * l'écran doit le DIRE : une liste courte et muette se lit comme
 * « rien aujourd'hui », ce qui est faux et se paie en rendez-vous manqué.
 */
export function reunionsDuJour(
  state: AppState,
  today: string,
  agenda: readonly EvenementAgenda[] = [],
): ReunionDuJour[] {
  const lignes: ReunionDuJour[] = []

  for (const r of state.reunions.filter((x: ReunionChantier) => x.date === today)) {
    const participants = (r.participants || '').trim()
    lignes.push({
      id: `reunion-${r.id}`,
      titre: r.titre,
      heure: r.heure || null,
      detail: [r.projetId, participants.length > 70 ? `${participants.slice(0, 70)}…` : participants]
        .filter(Boolean)
        .join(' · '),
      lien: `#/projets/${r.projetId}/chantier`,
      source: 'chantier',
    })
  }

  for (const e of agenda) {
    if (!e.debut || e.debut.slice(0, 10) !== today) continue
    lignes.push({
      id: `agenda-${e.id}`,
      titre: e.titre,
      heure: e.journee ? null : e.debut.slice(11, 16) || null,
      detail: [e.lieu, 'Google Agenda'].filter(Boolean).join(' · '),
      lien: null,
      source: 'agenda',
    })
  }

  return lignes.sort(
    (a, b) => (a.heure || '99:99').localeCompare(b.heure || '99:99') || a.titre.localeCompare(b.titre),
  )
}

// ---------- toutes les dates qui comptent ----------

/** un événement daté de l'état — pastille du calendrier, ligne de l'accueil */
export interface EvtCal {
  date: string // ISO
  label: string
  lien: string
  /** couleur de la pastille */
  couleur: string
  titreLong: string
  /** icône optionnelle (sinon, une pastille ronde) */
  icon?: IconName
}

export const COULEURS_ECHEANCE = {
  rendu: 'var(--danger)',
  facture: 'var(--warn)',
  encaissement: 'var(--ok)',
  ao: 'var(--cat-purple)',
  reunion: 'var(--accent)',
  obligation: 'var(--cat-amber)',
  crm: 'var(--ink-3)',
  projet: 'var(--cat-teal)',
}

/**
 * Tous les événements datés de l'état — calculé, jamais stocké.
 *
 * Vivait dans `modules/Calendrier.tsx`, où il ne servait qu'à la grille
 * mensuelle. L'accueil en a besoin pour ses « prochaines échéances » :
 * la fonction remonte donc au module de calcul plutôt que d'être
 * recopiée sur un second écran.
 */
export function evenements(state: AppState): EvtCal[] {
  const evts: EvtCal[] = []

  for (const p of state.projets) {
    if (STATUTS_ACTIFS.includes(p.statut)) {
      for (const ph of p.phases) {
        if (ph.fin && ph.montantHT > 0)
          evts.push({
            date: ph.fin,
            label: `◀ ${p.id} ${ph.code}`,
            lien: `#/projets/${p.id}`,
            couleur: COULEURS_ECHEANCE.rendu,
            titreLong: `Rendu ${ph.code} — ${p.nom}`,
          })
        if (ph.debut && ph.montantHT > 0)
          evts.push({
            date: ph.debut,
            label: `▶ ${p.id} ${ph.code}`,
            lien: `#/projets/${p.id}`,
            couleur: COULEURS_ECHEANCE.projet,
            titreLong: `Début ${ph.code} — ${p.nom}`,
          })
      }
    }
    if (p.dateLancement)
      evts.push({ date: p.dateLancement, label: p.id, icon: 'rocket', lien: `#/projets/${p.id}`, couleur: COULEURS_ECHEANCE.projet, titreLong: `Lancement — ${p.nom}` })
    if (p.dateCloture)
      evts.push({ date: p.dateCloture, label: p.id, icon: 'flag', lien: `#/projets/${p.id}`, couleur: COULEURS_ECHEANCE.projet, titreLong: `Clôture — ${p.nom}` })
  }

  for (const e of state.echeancesFacturation) {
    evts.push({
      date: e.datePrevue,
      label: `€ ${e.projetId}`,
      lien: '#/facturation',
      couleur: COULEURS_ECHEANCE.facture,
      titreLong: `Facture à émettre — ${e.libelle}`,
    })
  }
  for (const f of state.factures) {
    if (f.statut === 'emise')
      evts.push({
        date: encaissementPrevu(f),
        label: `⬇ ${f.projetId}`,
        lien: '#/facturation',
        couleur: COULEURS_ECHEANCE.encaissement,
        titreLong: `Encaissement attendu — ${f.numero || f.id} · ${f.libelle}`,
      })
  }

  for (const c of state.consultations) {
    if (c.dateLimite && ['a_etudier', 'go'].includes(c.statut))
      evts.push({
        date: c.dateLimite,
        label: `AO remise`,
        lien: '#/ao',
        couleur: COULEURS_ECHEANCE.ao,
        titreLong: `Remise des offres — ${c.intitule}`,
      })
  }

  for (const r of state.reunions) {
    evts.push({
      date: r.date,
      label: r.projetId,
      icon: 'hardhat',
      lien: `#/projets/${r.projetId}/chantier`,
      couleur: COULEURS_ECHEANCE.reunion,
      titreLong: `Réunion — ${r.titre}`,
    })
  }

  for (const o of state.obligations) {
    evts.push({
      date: o.echeance,
      label: `${o.libelle.slice(0, 14)}${o.libelle.length > 14 ? '…' : ''}`,
      icon: 'scale',
      lien: '#/agenda',
      couleur: COULEURS_ECHEANCE.obligation,
      titreLong: `Obligation — ${o.libelle}${o.organisme ? ` (${o.organisme})` : ''}`,
    })
  }

  for (const c of state.contacts) {
    if (c.dateProchaineAction)
      evts.push({
        date: c.dateProchaineAction,
        label: c.nom.split(' ')[0],
        icon: 'user',
        lien: '#/agenda',
        couleur: COULEURS_ECHEANCE.crm,
        titreLong: `CRM — ${c.nom} : ${c.prochaineAction || 'action prévue'}`,
      })
  }

  for (const a of state.artisans) {
    if (a.decennaleFin)
      evts.push({
        date: a.decennaleFin,
        label: a.nom.slice(0, 12),
        icon: 'shield',
        lien: '#/ressources',
        couleur: COULEURS_ECHEANCE.crm,
        titreLong: `Décennale expire — ${a.nom}`,
      })
  }

  return evts
}

/** échéances datées entre aujourd'hui et aujourd'hui + `jours` (bornes incluses) */
export function prochainesEcheances(state: AppState, today: string, jours = 14): EvtCal[] {
  const fin = addDays(today, jours)
  return evenements(state)
    .filter((e) => e.date >= today && e.date <= fin)
    .sort((a, b) => a.date.localeCompare(b.date) || a.titreLong.localeCompare(b.titreLong))
}

// ---------- repères du jour ----------

export interface PhaseEnCours {
  projet: Projet
  phase: Phase
}

/** phases des projets actifs dont la fenêtre encadre la date du jour */
export function phasesEnCours(state: AppState, today: string): PhaseEnCours[] {
  return state.projets
    .filter((p) => STATUTS_ACTIFS.includes(p.statut))
    .flatMap((p) =>
      p.phases
        .filter((ph) => ph.debut && ph.fin && ph.debut <= today && today <= ph.fin)
        .map((ph) => ({ projet: p, phase: ph })),
    )
}

// ---------- la semaine d'une personne ----------

/** temps enregistré ET charge prévisionnelle d'une personne, même semaine */
export interface LigneSemainePersonne {
  personne: string
  /** heures pointées sur la semaine (projets + hors-projet) */
  heures: number
  jours: number
  cout: number
  /** heures PLANIFIÉES par les phases actives de ses projets */
  charge: number
  /** capacité de la semaine, congés déduits */
  capacite: number
  absence: number
}

/**
 * Les blocs « temps enregistré » et « charge prévisionnelle » du §8.1,
 * pour la semaine du lundi donné. Rien de neuf n'est calculé ici : les
 * heures viennent de `tempsParPersonne`, la charge de
 * `chargePlanifieeSemaine` et la capacité de `capacitePersonneSemaine`.
 * Le seul apport est de les mettre en regard, personne par personne —
 * y compris celles qui n'ont rien pointé (charge sans pointage) et
 * celles qui ont pointé sans figurer dans l'équipe (nom renommé).
 */
export function semaineParPersonne(
  state: AppState,
  lundi: string,
  personnes?: readonly string[],
): LigneSemainePersonne[] {
  const roster =
    personnes && personnes.length > 0
      ? [...personnes]
      : [
          ...new Set(
            [
              ...(state.settings.equipe || []).map((p) => p.nom),
              ...(state.settings.personnes || []),
            ].filter(Boolean),
          ),
        ]
  const pointe = new Map(tempsParPersonne(state, lundi, lundi).map((l) => [l.personne, l]))
  const noms = [...new Set([...roster, ...pointe.keys()])]
  return noms.map((nom) => {
    const t = pointe.get(nom)
    return {
      personne: nom,
      heures: t?.heures ?? 0,
      jours: t?.jours ?? 0,
      cout: t?.cout ?? 0,
      charge: chargePlanifieeSemaine(state, nom, lundi),
      capacite: capacitePersonneSemaine(state, nom, lundi),
      absence: heuresAbsenceSemaine(state, nom, lundi),
    }
  })
}
