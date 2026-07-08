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
  /** coûts externes de la phase (BET cotraitants, sous-traitance, débours) */
  coutExterneHT?: number
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
  /** pour les notes « à faire » (tag a-faire) : cochée quand c'est réglé */
  fait?: boolean
  /** chemin du fichier rangé dans le Drive (photos importées) */
  fichier?: string
}

export interface Projet {
  id: string // 'P01'…
  nom: string
  typeMO: TypeMO
  statut: StatutProjet
  moa?: string
  /** e-mail de facturation / contact MOA (pré-remplit les e-mails sortants) */
  emailMOA?: string
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
  /** surface plancher (m²) → ratios €/m² travaux et honoraires */
  surfacePlancher?: number | null
  /** responsable interne du projet (nom d'un membre de l'équipe) */
  responsable?: string
  /** co-responsable interne */
  coResponsable?: string
  /** personnes qui travaillent sur le projet — pré-remplit leur tableau de temps */
  equipeProjet?: string[]
  /** plaisir à travailler sur ce projet, note sur 5 — l'idée est bonne */
  plaisir?: number | null
  /** n° de marché / acte d'engagement (facturation publique) */
  numeroEngagement?: string
  /** dates de vie du projet (fiche) */
  dateLancement?: string | null
  dateCloture?: string | null
  /** durées mémorisées pour la datation auto des phases (planning) */
  dureeEtudesMois?: number | null
  dureeChantierMois?: number | null
  /** objet à rappeler sur les factures (ex. « Création d'une pension de famille au… ») */
  objetFacture?: string
  siretClient?: string
  /** chargé·e d'opération côté client */
  chargeOperation?: string
  /** comment la commande est arrivée : AO / Gré à gré / Concours / Bouche à oreille… */
  accesCommande?: string
  /** typologie (Logement, Enseignement, Tertiaire…) */
  typologie?: string
  /** Neuf / Réhabilitation / Extension / Mixte */
  typeConstruction?: string
  /** surface extérieure aménagée (m²) */
  surfaceExterieure?: number | null
  /** trajet aller agence → site (repère logistique) */
  trajetAller?: string
}

/** courrier trié par la routine mail du matin — rangé au bon projet */
export interface Courrier {
  id: string
  projetId: string | null
  de: string
  objet: string
  resume: string
  /** question / document / administratif / commercial / autre */
  type: string
  actionProposee?: string
  urgence?: 1 | 2 | 3
  pour?: string
  statut: 'a_traiter' | 'traite'
  dateReception: string // ISO
  source?: string
}

export type StatutReunion = 'a_preparer' | 'cr_a_generer' | 'cr_a_relire' | 'diffuse'

/** réunion de chantier — support du circuit audio → transcription → CR */
export interface ReunionChantier {
  id: string
  projetId: string
  date: string // ISO
  /** heure de la réunion (HH:MM) — reprogrammable en un geste */
  heure?: string
  titre: string
  /** liste des convoqués, pré-remplie depuis les marchés + MOA */
  participants: string
  statut: StatutReunion
  /** texte du compte-rendu, conservé sur la réunion (généré par l'assistant ou collé) */
  cr?: string
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
  /** intervention du lot sur le chantier — alimente le planning travaux */
  dateDebut?: string | null
  dateFin?: string | null
  /** date de réception des travaux — point de départ de la garantie de parfait achèvement */
  dateReception?: string | null
  /** retenue de garantie remplacée par une caution bancaire (pas d'argent retenu) */
  cautionRG?: boolean
  /** retenue de garantie libérée à l'entreprise (levée effectuée) */
  rgLibere?: boolean
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
  /** révision de prix HT saisie (si le marché est révisable) — s'ajoute au décompte */
  revisionHT?: number | null
  /** facture d'honoraires DET générée depuis cette situation validée (anti-doublon + lien) */
  factureId?: string | null
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
  /** situation de travaux validée à l'origine de cette facture d'avancement DET */
  situationId?: string | null
  /** suivi des relances : date de la dernière relance envoyée */
  derniereRelance?: string | null
  /** niveau de la dernière relance (0 courtoise · 1 ferme · 2 mise en demeure) */
  niveauRelance?: number | null
  /** historique des relances passées (date + niveau) */
  relances?: { date: string; niveau: number }[]
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

export const CATEGORIES_HORS_PROJET = [
  'Prospection / AO',
  'Administratif agence',
  'Communication / réseaux',
  'Vie d’agence / orga',
  'Formation',
  'CIR / R&D',
  'Divers mail / tél',
] as const

/** temps non facturable (prospection, admin, formation…) — indispensable
 *  pour le coût réel par jour et la part de temps facturable */
export interface TempsHorsProjet {
  id: string
  semaine: string // lundi ISO
  personne: string
  categorie: string
  heures: number
}

/** le montant saisi est-il le brut ou le net versé ? */
export type ModeRemu = 'brut' | 'net'
/** statut social en SAS : président·e assimilé salarié, ou salarié·e */
export type StatutRemu = 'dirigeant' | 'salarie'

/** membre de l'équipe — le coût horaire RÉEL se calcule depuis sa
 *  rémunération, plus aucun forfait */
export interface Personne {
  id: string
  nom: string
  /** montant mensuel saisi — brut ou net selon modeRemu */
  remuMensuelle: number
  /** ce que représente le montant saisi */
  modeRemu: ModeRemu
  /** statut social (SAS) — pilote le coefficient suggéré */
  statut: StatutRemu
  /** coefficient de charges : montant saisi × coef = coût employeur complet */
  coefCharges: number
  /** heures travaillées par an (1720 ≈ temps plein) */
  heuresAnnuelles: number
  /** part facturable visée (0,6 = 60 %) */
  facturablePct: number
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
  // --- champs contrat (optionnels — une obligation ordinaire les ignore) ---
  /** true = contrat de l'agence (assurance, licences, bail…) — onglet Contrats */
  contrat?: boolean
  /** coût annuel du contrat — donne le total des frais fixes contractuels */
  montantAnnuel?: number | null
  /** date limite pour résilier / renégocier avant reconduction tacite */
  dateRenouvellement?: string
  /** lien vers le contrat signé (Drive…) */
  documentUrl?: string
}

export type TypeContact = 'MOA' | 'Prospect' | 'Entreprise' | 'BET' | 'Autre'

export type CanalInteraction = 'appel' | 'mail' | 'rdv' | 'visite' | 'autre'

/** échange daté avec un contact — historique (ne s'écrase jamais) */
export interface Interaction {
  id: string
  contactId: string
  date: string // ISO
  canal: CanalInteraction
  resume: string
  /** rattachements facultatifs */
  projetId?: string | null
  consultationId?: string | null
}

export interface Contact {
  id: string
  nom: string
  organisme?: string
  role?: string
  type: TypeContact
  email?: string
  tel?: string
  /** dernière interaction — dérivée du journal d'interactions (conservée pour compat.) */
  derniereInteraction?: string | null
  prochaineAction?: string
  /** relance récurrente : la prochaine action se re-décale de N jours quand elle est faite */
  relanceJours?: number | null
  /** valeur estimée de l'opportunité (prospect) — alimente le pipeline commercial */
  valeurEstimee?: number | null
  /** projets rattachés (liens manuels, en plus des liens dérivés des interactions) */
  projetsIds?: string[]
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
  /** notes de la grille Go/No-Go pondérée, par code de critère (0-4) */
  scoresGoNoGo?: Record<string, number>
  classement?: number | null
  motifsResultat?: string
  /** projet créé automatiquement quand la consultation est gagnée */
  projetId?: string | null
  /** personne concernée (facultatif) */
  pour?: string
  /** probabilité de succès saisie (0-1) — sinon déduite de l'étape */
  probabilite?: number | null
  /** date ISO du dernier changement d'étape — pour le vieillissement des cartes */
  dernierMouvement?: string
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
  | 'contrat_renouvellement'
  | 'crm'
  | 'decennale'
  | 'cr_en_attente'
  | 'sauvegarde'
  | 'rg_a_liberer'

/** Alerte du fil d'urgences — calculée, jamais stockée (hors snooze) */
/** action rapide attachée à une alerte, réalisable depuis le fil */
export type ActionAlerte =
  | { kind: 'emettre_facture'; refId: string; label: string }
  | { kind: 'valider_situation'; refId: string; label: string }
  | { kind: 'obligation_faite'; refId: string; label: string }

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
  /** action rapide contextuelle (émettre, valider, cocher…) */
  action?: ActionAlerte
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
  /** coordonnées légales & bancaires — imprimées sur les factures PDF */
  adresseAgence?: string
  siretAgence?: string
  rcs?: string
  capitalSocial?: string
  numeroTVA?: string
  iban?: string
  bic?: string
  banque?: string
  /** trésorerie disponible — saisie ou relevé (source : banque / Excel maître) */
  tresorerieDispo: number | null
  tresorerieMajLe: string | null
  bt01Actuel: number
  bt01Ref1994: number
  tauxHoraireVente: number
  /** si vrai, le taux horaire de vente est calculé (coûts + marges) au lieu d'être saisi */
  tauxHoraireAuto?: boolean
  /** marge supplémentaire (coussin) appliquée au taux de vente calculé (0,10 = +10 %) */
  margeSecuritePct?: number | null
  coutHoraireRevient: number
  heuresParJour: number
  /** objectif de CA saisi à la main (utilisé si margeCiblePct est vide) */
  caCibleHT: number
  /** marge nette visée (0,20 = 20 %) : si renseignée, le CA cible est calculé
   *  automatiquement = coût d'agence annuel ÷ (1 − marge) */
  margeCiblePct?: number | null
  /** seuil de dérive heures (0.9 = alerte à 90 % du budget) */
  seuilDeriveHeures: number
  delaisPaiement: Record<TypeMO, number>
  /** noms (dérivés de l'équipe — gardés pour les listes déroulantes) */
  personnes: string[]
  /** l'équipe avec rémunérations réelles → coûts horaires par personne */
  equipe: Personne[]
  /** frais généraux annuels HT (loyer, logiciels, assurances…) */
  fraisGenerauxAnnuels: number
  /** modèle de nomenclature documentaire */
  nomenclature: string
  /** alerteId → ISO « en sommeil jusqu'au » */
  snoozes: Record<string, string>
  dernierImportExcel?: ImportExcelMeta | null
  /** étapes cochées du guide « Bien démarrer » */
  onboarding?: Record<string, boolean>
  /** surveillance en direct Gmail/Agenda (API Google gratuites, lecture seule) */
  surveillance?: {
    /** adresse surveillée (vide = toute la boîte de réception) */
    email: string
    /** identifiant OAuth « Web » créé sur console.cloud.google.com (gratuit) */
    clientId: string
  }
  /** critères de la veille BOAMP intégrée (API DILA gratuite) */
  veilleBoamp?: {
    motsCles: string
    departements: string
    typeMarche: string
    depuisJours: number
  }
  /** dernier import par routine (« situations », « consultations », « courriers ») → date ISO */
  derniersImports?: Record<string, string>
  /** dernier export JSON de sauvegarde (date ISO) */
  derniereSauvegarde?: string | null
  /** synchronisation Supabase (opt-in, offre gratuite) — config MACHINE-LOCALE :
   *  jamais poussée dans le document partagé (retirée à l'envoi, re-fusionnée à la réception) */
  sync?: {
    url: string
    anonKey: string
    /** clé de l'espace partagé (une ligne = tout l'état de l'agence) */
    workspaceId: string
    /** dernière adresse du lien magique (affichage) */
    email?: string
  }
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
  interactions: Interaction[]
  artisans: Artisan[]
  materiaux: Materiau[]
  consultations: Consultation[]
  prompts: PromptTemplate[]
  reunions: ReunionChantier[]
  courriers: Courrier[]
  tempsHorsProjet: TempsHorsProjet[]
  absences: Absence[]
  evaluations: EvaluationEntreprise[]
  documents: DocumentCorpus[]
}

/** document du corpus de l'assistant : texte réglementaire (Légifrance,
 *  Licence Ouverte — TOUJOURS avec sa source et sa version) ou modèle de
 *  document servant à la génération. Jamais de texte AFNOR/CSTB protégé. */
export interface DocumentCorpus {
  id: string
  titre: string
  type: 'reglementaire' | 'modele'
  /** provenance exacte : nom du texte, identifiant Légifrance, date de version */
  source?: string
  url?: string
  texte: string
  ajouteLe: string // ISO
  /** thème de sélection (Sécurité incendie, Accessibilité PMR…) — on coche par thème */
  groupe?: string
  /** document acheté (DTU, norme…) : reste dans le Cockpit, jamais publié ni partagé */
  prive?: boolean
}

/** note d'une entreprise sur UN chantier — l'historique multi-chantiers
 *  se lit sur la fiche entreprise (une évaluation par couple artisan × projet) */
export interface EvaluationEntreprise {
  id: string
  artisanId: string
  projetId: string
  /** 1 (à éviter) → 5 (excellente) */
  note: number
  commentaire?: string
  date: string // ISO
}

/** congé / absence d'une personne — réduit sa capacité dans le plan de charge */
export interface Absence {
  id: string
  personne: string
  debut: string
  fin: string
  motif?: string
}
