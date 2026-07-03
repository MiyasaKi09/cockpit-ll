// ============================================================
// Cockpit L&L — modèle de données (architecture v2 « sans API »)
// L'intranet est 100 % déterministe : aucune donnée ici n'est
// produite par un modèle — les routines Claude écrivent via
// import JSON, toujours avec statut « à vérifier ».
// ============================================================

export type TypeMO = 'Public' | 'Privé pro' | 'Particulier'

export type StatutProjet = 'Prospect' | 'Offre remise' | 'Signé' | 'En cours' | 'Livré' | 'Perdu'

export type PhaseCode =
  | 'DIAG' | 'ESQ' | 'APS' | 'APD' | 'PRO' | 'ACT-DCE' | 'VISA' | 'DET' | 'AOR' | 'MC'

export interface Phase {
  code: PhaseCode
  /** % de la mission de base (null pour DIAG et MC, hors mission de base) */
  pctBase: number | null
  montantHT: number
  debut: string | null // ISO 'AAAA-MM-JJ'
  fin: string | null
  heuresPrevues: number
}

/** lien utile rattaché au projet (Drive, plateforme, DCE…) */
export interface LienProjet {
  id: string
  titre: string
  url: string
}

/** note datée du journal de projet (détails, solutions, décisions) */
export interface NoteJournal {
  id: string
  date: string // ISO
  auteur?: string
  texte: string
  tags: string[]
}

export interface Projet {
  id: string // 'P01'…
  nom: string
  typeMO: TypeMO
  statut: StatutProjet
  moa?: string
  adresse?: string
  /** clé du référentiel OUVRAGES (ex. '12- Logements collectifs') */
  ouvrage: string | null
  montantTravauxHT: number | null
  /** notation des 27 critères MIQCP : libellé critère → note −2..+2 */
  notesComplexite: Record<string, number>
  /** coefficient saisi à la main (prioritaire sur le calcul par critères) */
  coefManuel?: number | null
  /** taux d'honoraires négocié (prioritaire sur le taux MIQCP ajusté) */
  tauxRetenu?: number | null
  missionsComplHT: number
  notes?: string
  phases: Phase[]
  /** rattachements de l'espace projet — tout s'ajoute au fil de l'eau */
  liens: LienProjet[]
  materiauxIds: string[]
  artisanIds: string[]
  journal: NoteJournal[]
}

export type StatutReunion = 'a_preparer' | 'cr_a_generer' | 'cr_a_relire' | 'diffuse'

/** réunion de chantier — support du circuit audio → transcription → CR */
export interface ReunionChantier {
  id: string
  projetId: string
  date: string // ISO
  titre: string
  /** liste des convoqués, pré-remplie depuis les marchés + MOA */
  participants: string
  statut: StatutReunion
  notes?: string
}

/** Marché de travaux (une entreprise, un lot) — support des situations */
export interface MarcheTravaux {
  id: string
  projetId: string
  entreprise: string
  lot: string
  montantInitialHT: number
  avenantsHT: number
  /** retenue de garantie (0.05 par défaut) */
  tauxRG: number
  revision: boolean
  /** délai contractuel de vérification des situations par la MOE (jours) */
  delaiVerifJours: number
  contactNom?: string
  contactEmail?: string
  /** chantier en cours → une situation mensuelle est attendue */
  actif: boolean
  notes?: string
}

export type StatutSituation = 'a_verifier' | 'validee' | 'rejetee'

/** Situation de travaux — écrite par la routine (import JSON) ou à la main */
export interface Situation {
  id: string
  projetId: string
  /** rattachement facultatif ; l'entreprise/lot sont portés par la situation */
  marcheId: string | null
  entreprise: string
  lot?: string
  mois: string // 'AAAA-MM'
  numero?: number | null
  montantMoisHT: number | null
  montantCumulHT?: number | null
  statut: StatutSituation
  /** niveau de confiance fourni par la routine (0..1) — absent si saisie manuelle */
  confiance?: number | null
  /** traçabilité : mail source, routine, date */
  source?: string
  dateReception: string // ISO
  /** personne concernée (facultatif — fourni par la routine ou à la main) */
  pour?: string
  notes?: string
}

export type StatutFacture = 'prevue' | 'emise' | 'encaissee'

export interface Facture {
  id: string // numéro '2026-001'
  projetId: string
  phase: PhaseCode
  libelle: string
  montantHT: number
  tauxTVA: number
  /** date d'émission (prévisionnelle tant que statut = prevue) */
  emission: string
  /** délai de paiement client en jours */
  delaiJours: number
  statut: StatutFacture
  encaissementReel?: string | null
}

export interface TempsEntry {
  id: string
  /** lundi de la semaine, ISO */
  semaine: string
  personne: string
  projetId: string
  phase: PhaseCode
  heures: number
}

export interface Reference {
  id: string
  nom: string
  lieu?: string
  annee?: number | null
  typeMO?: TypeMO
  moa?: string
  montantTravauxHT?: number | null
  surfaceM2?: number | null
  mission?: string
  motsCles: string[]
  attestation?: boolean
  /** chemin Drive du dossier photos */
  photosDossier?: string
  notes?: string
}

export interface Obligation {
  id: string
  libelle: string
  organisme?: string
  echeance: string // prochaine échéance ISO
  /** null = ponctuelle ; sinon reconduite de N mois quand marquée faite */
  periodiciteMois?: number | null
  rappelJours: number
  notes?: string
}

export type TypeContact = 'MOA' | 'Prospect' | 'Entreprise' | 'BET' | 'Autre'

export interface Contact {
  id: string
  nom: string
  organisme?: string
  role?: string
  type: TypeContact
  email?: string
  tel?: string
  derniereInteraction?: string | null
  prochaineAction?: string
  dateProchaineAction?: string | null
  notes?: string
}

export interface Artisan {
  id: string
  nom: string
  lots: string[]
  zone?: string
  fourchette?: string
  /** date de fin de validité de la décennale */
  decennaleFin?: string | null
  contactNom?: string
  contactEmail?: string
  tel?: string
  notes?: string
}

export interface Materiau {
  id: string
  nom: string
  fournisseur?: string
  coutM2?: number | null
  /** lien FDES (base INIES) — l'argument carbone dès l'esquisse */
  lienFDES?: string
  tags: string[]
  notes?: string
}

export type StatutConsultation = 'a_etudier' | 'go' | 'no_go' | 'deposee' | 'gagnee' | 'perdue'

export interface Consultation {
  id: string
  intitule: string
  acheteur?: string
  source?: string
  lieu?: string
  typologie?: string
  budgetTravaux?: number | null
  dateLimite?: string | null
  statut: StatutConsultation
  avisGoNoGo?: string
  classement?: number | null
  motifsResultat?: string
  /** personne concernée (facultatif) */
  pour?: string
  notes?: string
}

export type ContextePrompt = 'projet' | 'marche' | 'facture' | 'consultation' | 'libre'

/** Gabarit de pré-prompt, versionné — la pièce maîtresse du sans-API */
export interface PromptTemplate {
  id: string
  titre: string
  domaine: string
  /** le Projet Claude où coller le prompt assemblé */
  projetClaude: string
  contexte: ContextePrompt
  /** corps avec {{placeholders}} remplis depuis la base */
  corps: string
  version: number
  majLe: string // ISO
}

export type TypeAlerte =
  | 'echeance_rendu'
  | 'facture_a_emettre'
  | 'facture_retard'
  | 'situation_a_verifier'
  | 'situation_manquante'
  | 'derive_heures'
  | 'obligation'
  | 'crm'
  | 'decennale'
  | 'cr_en_attente'

/** Alerte du fil d'urgences — calculée, jamais stockée (hors snooze) */
export interface Alerte {
  /** identifiant stable (sert au snooze) */
  id: string
  type: TypeAlerte
  gravite: 1 | 2 | 3 // 3 = rouge
  titre: string
  detail?: string
  /** route hash vers la source — toute alerte est traçable */
  lien: string
  date?: string
}

export interface ImportExcelMeta {
  fichier: string
  date: string
  carnetHT?: number | null
  factureHT?: number | null
  resteAFacturerHT?: number | null
  pointBas?: number | null
  pointBasMois?: string | null
}

export interface Settings {
  nomAgence: string
  /** trésorerie disponible — saisie ou relevé (source : banque / Excel maître) */
  tresorerieDispo: number | null
  tresorerieMajLe: string | null
  bt01Actuel: number
  bt01Ref1994: number
  tauxHoraireVente: number
  coutHoraireRevient: number
  heuresParJour: number
  caCibleHT: number
  /** seuil de dérive heures (0.9 = alerte à 90 % du budget) */
  seuilDeriveHeures: number
  delaisPaiement: Record<TypeMO, number>
  personnes: string[]
  /** modèle de nomenclature documentaire */
  nomenclature: string
  /** alerteId → ISO « en sommeil jusqu'au » */
  snoozes: Record<string, string>
  dernierImportExcel?: ImportExcelMeta | null
  /** étapes cochées du guide « Bien démarrer » */
  onboarding?: Record<string, boolean>
}

export interface AppState {
  version: number
  settings: Settings
  projets: Projet[]
  marches: MarcheTravaux[]
  situations: Situation[]
  factures: Facture[]
  temps: TempsEntry[]
  references: Reference[]
  obligations: Obligation[]
  contacts: Contact[]
  artisans: Artisan[]
  materiaux: Materiau[]
  consultations: Consultation[]
  prompts: PromptTemplate[]
  reunions: ReunionChantier[]
}
