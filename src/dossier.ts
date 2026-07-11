// ============================================================
// Dossier de poursuite — le moteur des lots 3 & 4 de l'audit V3.
// La checklist n'est plus générique : elle part d'une base agence
// par parcours (AO / concours phase candidature / phase projet),
// puis s'enrichit d'exigences EXTRAITES du RC collé — extraction
// 100 % déterministe et conservatrice : chaque proposition cite
// sa ligne d'origine, rien n'est inventé, l'humain accepte.
// « Prêt à déposer » est un ÉTAT CONTRÔLÉ : tant qu'une exigence
// obligatoire n'est pas faite, le dépôt reste bloqué (explicable).
// ============================================================

import type {
  AppState,
  CategorieExigence,
  Consultation,
  DocumentRecord,
  EtapeConcours,
  ExigenceDossier,
  StatutConsultation,
} from './types'
import { coutHoraireMoyen } from './derive'
import { diffDays, uid } from './util'

// ---------- référentiels ----------

export const CATEGORIES_EXIGENCE: { id: CategorieExigence; label: string }[] = [
  { id: 'admin', label: 'Candidature administrative' },
  { id: 'capacites', label: 'Capacités & références' },
  { id: 'equipe', label: 'Équipe & cotraitants' },
  { id: 'technique', label: 'Offre technique' },
  { id: 'financiere', label: 'Offre financière' },
  { id: 'depot', label: 'Pièces de dépôt' },
  { id: 'controle', label: 'Contrôles de conformité' },
]

export const LIBELLE_CATEGORIE: Record<CategorieExigence, string> = Object.fromEntries(
  CATEGORIES_EXIGENCE.map((c) => [c.id, c.label]),
) as Record<CategorieExigence, string>

export const ETAPES_CONCOURS: { id: EtapeConcours; label: string; aide: string }[] = [
  { id: 'candidature', label: 'Candidature', aide: 'dossier de candidature en préparation' },
  { id: 'candidature_deposee', label: 'Candidature déposée', aide: 'en attente de la sélection' },
  { id: 'selectionne', label: 'Sélectionné', aide: 'admis à concourir — production du projet' },
  { id: 'non_selectionne', label: 'Non sélectionné', aide: 'arrêt à la phase candidature' },
  { id: 'rendu', label: 'Projet rendu', aide: 'en attente du jury' },
  { id: 'jury', label: 'Jury passé', aide: 'en attente du classement' },
]

/** statut de pipeline cohérent avec chaque étape concours — le concours
 *  suit ses propres étapes SANS détourner les statuts d'un AO classique */
export function statutPourEtapeConcours(etape: EtapeConcours): StatutConsultation {
  switch (etape) {
    case 'candidature':
    case 'selectionne':
      return 'go' // l'agence produit
    case 'candidature_deposee':
    case 'rendu':
    case 'jury':
      return 'deposee' // l'agence attend
    case 'non_selectionne':
      return 'perdue'
  }
}

// ---------- checklist de base (par parcours) ----------

interface ModeleExigence {
  categorie: CategorieExigence
  texte: string
  obligatoire: boolean
}

const BASE_AO: ModeleExigence[] = [
  { categorie: 'admin', texte: 'DC1 — lettre de candidature (ou DUME)', obligatoire: true },
  { categorie: 'admin', texte: 'DC2 — déclaration du candidat (ou DUME)', obligatoire: true },
  { categorie: 'admin', texte: 'Attestation d’assurance décennale et RCP en cours de validité', obligatoire: true },
  { categorie: 'admin', texte: 'Attestations fiscales et sociales à jour', obligatoire: true },
  { categorie: 'admin', texte: 'Attestation d’inscription à l’Ordre des architectes', obligatoire: true },
  { categorie: 'capacites', texte: 'Références similaires (typologie, échelle, mission)', obligatoire: true },
  { categorie: 'capacites', texte: 'Moyens humains et matériels de l’agence', obligatoire: true },
  { categorie: 'equipe', texte: 'Cotraitants / BET identifiés et accord de groupement', obligatoire: false },
  { categorie: 'equipe', texte: 'Répartition des missions et habilitation du mandataire', obligatoire: false },
  { categorie: 'technique', texte: 'Mémoire technique selon le plan demandé au RC', obligatoire: true },
  { categorie: 'technique', texte: 'Méthodologie et calendrier d’exécution de la mission', obligatoire: false },
  { categorie: 'financiere', texte: 'Acte d’engagement complété (montant, délais)', obligatoire: true },
  { categorie: 'financiere', texte: 'Décomposition du forfait d’honoraires par phase et cotraitant', obligatoire: true },
  { categorie: 'depot', texte: 'Signature électronique valide (certificat non expiré)', obligatoire: true },
  { categorie: 'depot', texte: 'Dépôt sur le profil acheteur AVANT l’heure limite (prévoir 2 h de marge)', obligatoire: true },
  { categorie: 'controle', texte: 'Relecture croisée du dossier par l’autre associé·e', obligatoire: true },
  { categorie: 'controle', texte: 'Contrôle : chaque pièce demandée au RC est présente et signée', obligatoire: true },
]

const BASE_CONCOURS_CANDIDATURE: ModeleExigence[] = [
  { categorie: 'admin', texte: 'DC1 / DC2 (ou DUME) du groupement complet', obligatoire: true },
  { categorie: 'admin', texte: 'Attestations d’assurance et d’inscription à l’Ordre', obligatoire: true },
  { categorie: 'capacites', texte: 'Références illustrées adaptées au programme du concours', obligatoire: true },
  { categorie: 'capacites', texte: 'Moyens et compétences (dont exigences particulières du règlement)', obligatoire: true },
  { categorie: 'equipe', texte: 'Composition du groupement conforme au règlement (BET requis…)', obligatoire: true },
  { categorie: 'technique', texte: 'Note de motivation / intentions si demandée au règlement', obligatoire: false },
  { categorie: 'depot', texte: 'Dépôt de la candidature avant l’heure limite', obligatoire: true },
  { categorie: 'controle', texte: 'Contrôle : conformité au règlement de la consultation', obligatoire: true },
]

const BASE_CONCOURS_PROJET: ModeleExigence[] = [
  { categorie: 'technique', texte: 'Planches graphiques au format imposé par le règlement', obligatoire: true },
  { categorie: 'technique', texte: 'Notice architecturale, urbaine et environnementale', obligatoire: true },
  { categorie: 'technique', texte: 'Notice économique / estimation du coût des travaux', obligatoire: true },
  { categorie: 'financiere', texte: 'Cadre de décomposition des honoraires si demandé', obligatoire: false },
  { categorie: 'depot', texte: 'ANONYMAT : aucun logo, nom ou signe distinctif sur les rendus', obligatoire: true },
  { categorie: 'depot', texte: 'Rendu déposé avant l’heure limite (formats et poids conformes)', obligatoire: true },
  { categorie: 'controle', texte: 'Relecture croisée : chaque livrable du règlement est couvert', obligatoire: true },
]

/** la checklist de départ, selon le parcours — chaque élément dit sa source */
export function checklistDeBase(c: Consultation): ExigenceDossier[] {
  const modeles =
    c.typeAvis === 'concours'
      ? c.concours?.etape === 'selectionne' || c.concours?.etape === 'rendu' || c.concours?.etape === 'jury'
        ? BASE_CONCOURS_PROJET
        : BASE_CONCOURS_CANDIDATURE
      : BASE_AO
  return modeles.map((m) => ({
    id: uid('exi'),
    categorie: m.categorie,
    texte: m.texte,
    source: 'base agence',
    obligatoire: m.obligatoire,
    statut: 'a_faire' as const,
  }))
}

// ---------- extraction déterministe du RC collé ----------

export interface CritereJugement {
  libelle: string
  poids: number // en %
}

export interface ExtractionRC {
  exigences: ExigenceDossier[]
  criteres: CritereJugement[]
  /** dates repérées (visite, questions) — à reporter à la main */
  reperes: string[]
  lignesLues: number
}

/** mots-clés → catégorie de checklist (déterministe, ordre = priorité) */
const CLASSEMENT_RC: { motif: RegExp; categorie: CategorieExigence }[] = [
  { motif: /dc1|dc2|dc4|dume|kbis|attestation|certificat|assurance|fiscal|social|ordre des architectes|pouvoir|habilitation/i, categorie: 'admin' },
  { motif: /r[ée]f[ée]rence|chiffre d.affaires|effectif|capacit[ée]|qualification|moyens (humains|mat[ée]riels)/i, categorie: 'capacites' },
  { motif: /groupement|cotraitan|co-traitan|mandataire|sous-traitan|bet |bureau d.[ée]tudes|paysagiste|[ée]conomiste/i, categorie: 'equipe' },
  { motif: /m[ée]moire|note m[ée]thodologique|planche|notice|maquette|perspective|planning|calendrier|organisation de la mission/i, categorie: 'technique' },
  { motif: /acte d.engagement|honoraire|d[ée]composition|dpgf|bpu|prix|forfait|offre financi[èe]re/i, categorie: 'financiere' },
  { motif: /signature|d[ée]p[ôo]t|plateforme|profil acheteur|copie de sauvegarde|format|transmission/i, categorie: 'depot' },
]

/** une ligne du RC parle-t-elle d'une pièce à produire ? (conservateur) */
const MOTIF_PIECE = /pi[èe]ce|fourni|produir|produit|joindre|joint|remettre|remis|transmettre|transmis|composer|contenir|comport|présent|present|dossier de candidature|dossier d.offre/i

/** extraction DÉTERMINISTE des exigences d'un règlement de consultation
 *  collé en texte. Conservatrice : ne retient que des lignes courtes qui
 *  parlent explicitement de pièces/livrables, chaque proposition cite sa
 *  ligne d'origine — rien n'est deviné, l'utilisateur accepte ou écarte. */
export function extraireExigencesRC(texte: string): ExtractionRC {
  const lignes = texte
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-–—•·*◦▪]\s*/, '').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)

  const exigences: ExigenceDossier[] = []
  const criteres: CritereJugement[] = []
  const reperes: string[] = []
  const dejaVu = new Set<string>()

  for (const ligne of lignes) {
    // critères de jugement pondérés : « Valeur technique : 60 % »
    const mCritere = /^([^:;]{4,60}?)\s*[:—-]\s*(\d{1,3})\s*(?:%|points?\b)/i.exec(ligne)
    if (mCritere && /technique|prix|honoraire|d[ée]lai|qualit|architectural|environnement|co[ûu]t|insertion/i.test(mCritere[1])) {
      const poids = Number(mCritere[2])
      if (poids >= 5 && poids <= 100) {
        criteres.push({ libelle: mCritere[1].trim(), poids })
        continue
      }
    }

    // repères de calendrier : visite, questions — signalés, jamais devinés
    if (/visite/i.test(ligne) && /obligatoire|facultative|organis[ée]e|sur rendez/i.test(ligne) && ligne.length < 220) {
      reperes.push(ligne)
      continue
    }
    if (/date limite/i.test(ligne) && /question/i.test(ligne) && ligne.length < 220) {
      reperes.push(ligne)
      continue
    }

    // exigences : lignes courtes qui parlent explicitement d'une pièce
    if (ligne.length < 8 || ligne.length > 200) continue
    if (!MOTIF_PIECE.test(ligne)) continue
    const classement = CLASSEMENT_RC.find((r) => r.motif.test(ligne))
    if (!classement) continue // pas de catégorie sûre → on n'invente pas
    const cle = ligne.toLowerCase().slice(0, 80)
    if (dejaVu.has(cle)) continue
    dejaVu.add(cle)
    const extrait = ligne.length > 90 ? `${ligne.slice(0, 90)}…` : ligne
    exigences.push({
      id: uid('exi'),
      categorie: classement.categorie,
      texte: ligne,
      source: `RC : « ${extrait} »`,
      obligatoire: /obligatoire|impérativement|imperativement|sous peine|à peine de|doit|devra/i.test(ligne),
      statut: 'a_faire',
    })
  }

  return { exigences, criteres, reperes, lignesLues: lignes.length }
}

// ---------- avancement & contrôle avant dépôt ----------

export interface AvancementDossier {
  faits: number
  total: number
  pct: number // 0..1
}

export function avancementDossier(c: Consultation): AvancementDossier {
  const actives = (c.exigences || []).filter((e) => e.statut !== 'sans_objet')
  const faits = actives.filter((e) => e.statut === 'fait').length
  return { faits, total: actives.length, pct: actives.length > 0 ? faits / actives.length : 0 }
}

export interface ControleDepot {
  pret: boolean
  bloquants: string[]
  avertissements: string[]
}

/** le contrôle déterministe qui garde la porte du « prêt à déposer » :
 *  chaque blocage est une phrase lisible, jamais un refus muet */
export function controleAvantDepot(state: AppState, c: Consultation, today: string): ControleDepot {
  const bloquants: string[] = []
  const avertissements: string[] = []

  const actives = (c.exigences || []).filter((e) => e.statut !== 'sans_objet')
  if (actives.length === 0) {
    bloquants.push('La checklist du dossier est vide — générez la base puis complétez-la depuis le RC.')
  }
  const obligatoiresRestantes = actives.filter((e) => e.obligatoire && e.statut !== 'fait')
  if (obligatoiresRestantes.length > 0) {
    const exemples = obligatoiresRestantes.slice(0, 3).map((e) => e.texte).join(' · ')
    bloquants.push(
      `${obligatoiresRestantes.length} exigence(s) obligatoire(s) non faite(s) : ${exemples}${obligatoiresRestantes.length > 3 ? '…' : ''}`,
    )
  }
  if (c.dateLimite && diffDays(today, c.dateLimite) < 0) {
    bloquants.push(`La date limite (${c.dateLimite}) est dépassée.`)
  }

  const facultativesRestantes = actives.filter((e) => !e.obligatoire && e.statut !== 'fait')
  if (facultativesRestantes.length > 0) {
    avertissements.push(`${facultativesRestantes.length} élément(s) facultatif(s) encore ouvert(s).`)
  }
  if (!c.pour) avertissements.push('Aucun·e responsable du dossier — désignez qui porte la réponse.')
  if (c.dateLimite && diffDays(today, c.dateLimite) <= 2 && diffDays(today, c.dateLimite) >= 0) {
    avertissements.push('Moins de 48 h avant la limite — déposez avec une marge (plateforme saturée = hors délai).')
  }
  // pièces administratives anciennes : les attestations vivent ~6 mois
  const liees = (c.exigences || [])
    .map((e) => e.documentId)
    .filter(Boolean)
    .map((id) => state.registreDocuments.find((d) => d.id === id))
    .filter(Boolean) as DocumentRecord[]
  for (const d of liees) {
    const age = diffDays(d.recuLe.slice(0, 10), today)
    if (age > 180) {
      avertissements.push(`« ${d.titre} » a plus de 6 mois (reçu le ${d.recuLe.slice(0, 10)}) — vérifier sa validité.`)
    }
  }
  if (c.typeAvis === 'concours' && !c.concours?.dateJury && (c.concours?.etape === 'rendu' || c.concours?.etape === 'jury')) {
    avertissements.push('Date de jury non renseignée.')
  }

  return { pret: bloquants.length === 0, bloquants, avertissements }
}

// ---------- réutilisation des pièces administratives ----------

export interface PieceReutilisable {
  document: DocumentRecord
  ageJours: number
  /** au-delà de 6 mois, une attestation se re-demande */
  aVerifier: boolean
}

/** les pièces administratives déjà dans le registre (DC1/DC2, assurances,
 *  attestations…) — réutilisables d'un dossier à l'autre, avec leur âge */
export function piecesAdminReutilisables(state: AppState, today: string): PieceReutilisable[] {
  return state.registreDocuments
    .filter((d) => d.categorie === 'ADM' && d.statut !== 'remplace' && d.statut !== 'rejete')
    .map((d) => {
      const ageJours = diffDays(d.recuLe.slice(0, 10), today)
      return { document: d, ageJours, aVerifier: ageJours > 180 }
    })
    .sort((a, b) => a.ageJours - b.ageJours)
}

// ---------- coût de production & valeur attendue (Lot 4) ----------

export interface CoutDossier {
  heures: number
  cout: number
}

/** heures « Prospection / AO » pointées sur CE dossier × coût horaire réel */
export function coutDossier(state: AppState, consultationId: string): CoutDossier {
  const heures = state.tempsHorsProjet
    .filter((t) => t.consultationId === consultationId)
    .reduce((s, t) => s + t.heures, 0)
  return { heures, cout: heures * coutHoraireMoyen(state) }
}

export interface ValeurAttendue {
  /** lignes lisibles du calcul — la transparence avant le chiffre */
  lignes: { libelle: string; valeur: number | null }[]
  /** proba × gains − coût engagé (null si les honoraires manquent) */
  solde: number | null
}

/** valeur attendue du dossier, 100 % transparente : chaque terme est
 *  affiché, rien n'est caché dans une formule magique */
export function valeurAttendue(state: AppState, c: Consultation, proba: number): ValeurAttendue {
  const { cout } = coutDossier(state, c.id)
  const honoraires = c.honorairesEstimes ?? null
  const prime = c.typeAvis === 'concours' ? c.concours?.prime ?? null : null
  const lignes: { libelle: string; valeur: number | null }[] = [
    { libelle: 'Honoraires estimés si gagné', valeur: honoraires },
    ...(c.typeAvis === 'concours' ? [{ libelle: 'Prime si sélectionné (non lauréat)', valeur: prime }] : []),
    { libelle: `Probabilité retenue (${Math.round(proba * 100)} %) × honoraires`, valeur: honoraires != null ? proba * honoraires : null },
    { libelle: 'Coût de réponse déjà engagé', valeur: cout > 0 ? -cout : 0 },
  ]
  const solde = honoraires != null ? proba * honoraires + (prime ?? 0) * (c.typeAvis === 'concours' ? 1 - proba : 0) - cout : null
  return { lignes, solde }
}
