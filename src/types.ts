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
  /** documents du registre rattachés à la note */
  documentIds?: string[]
}

export interface Projet {
  id: string // 'P01'…
  nom: string
  typeMO: TypeMO
  statut: StatutProjet
  moa?: string
  /** e-mail de facturation / contact MOA (pré-remplit les e-mails sortants) */
  emailMOA?: string
  /** adresse de FACTURATION du client (≠ adresse du chantier) — exigée
   *  avant l'émission d'une facture (mentions légales) */
  adresseFacturation?: string
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
  /** DOCX du CR dans le registre documentaire */
  crDocumentId?: string | null
  notes?: string
}

/** Marché de travaux (une entreprise, un lot) — support des situations */
export interface MarcheTravaux {
  id: string
  projetId: string
  entreprise: string
  /** entreprise canonique (registre) — le nom reste pour l'affichage */
  entrepriseId?: string | null
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

/** élément d'ouvrage prévu au CCTP d'un lot — un article numéroté du document */
export interface ElementCCTP {
  id: string
  /** numéro d'article tel qu'écrit dans le CCTP (ex. '2.3.1') */
  article?: string
  designation: string
  /** localisation dans l'ouvrage (ex. 'RDC — hall') */
  localisation?: string
}

/** ligne de prix d'une DPGF — un ouvrage chiffré du DCE */
export interface LigneDPGF {
  id: string
  /** numéro d'article tel qu'écrit dans la DPGF (souvent aligné sur le CCTP) */
  article?: string
  designation: string
  unite?: string
  quantite?: number | null
  prixUnitaireHT?: number | null
  totalHT?: number | null
}

/** DPGF d'un lot — les prix du DCE, structurés et traçables jusqu'au fichier */
export interface DpgfLot {
  /** chemin du fichier source dans le Drive (ou nom du fichier déposé) */
  fichier?: string
  /** document source dans le registre documentaire */
  documentId?: string | null
  importeLe: string // ISO
  /** total HT lu sur le document (contrôle de cohérence avec la somme des lignes) */
  totalHT?: number | null
  lignes: LigneDPGF[]
}

/** lot du DCE avec son CCTP structuré — la source du planning travaux détaillé.
 *  Créé par l'analyse déterministe d'un CCTP (PDF/texte), par le retour JSON
 *  d'un Projet Claude, ou à la main. Toujours traçable jusqu'au fichier. */
export interface LotDCE {
  id: string
  projetId: string
  /** numéro du lot dans l'allotissement (ex. '02') */
  numero: string
  intitule: string
  /** marché de travaux rattaché quand le lot est attribué */
  marcheId?: string | null
  /** chemin du fichier CCTP dans le Drive (traçabilité de l'extraction) */
  fichier?: string
  /** document source dans le registre documentaire */
  cctpDocumentId?: string | null
  /** provenance : 'analyse' (déterministe) · 'claude' (retour JSON) · 'manuel' */
  source?: string
  importeLe: string // ISO
  /** éléments d'ouvrage prévus au CCTP */
  elements: ElementCCTP[]
  /** prix du lot (DPGF importée) — null/absent tant que rien n'est chiffré */
  dpgf?: DpgfLot | null
}

export type StatutTache = 'prevu' | 'en_cours' | 'fait'

/** tâche datée du planning travaux — un élément du DCE posé sur le calendrier */
export interface TacheChantier {
  id: string
  projetId: string
  /** lot DCE d'origine (traçabilité) — null pour une tâche ajoutée à la main */
  lotDceId?: string | null
  /** élément CCTP d'origine (anti-doublon à la génération) */
  elementId?: string | null
  /** marché de travaux rattaché (hérité du lot) */
  marcheId?: string | null
  /** libellé du lot pour l'affichage et le groupement (ex. 'Lot 02 — Gros œuvre') */
  lot: string
  designation: string
  debut: string | null // ISO 'AAAA-MM-JJ'
  fin: string | null
  statut: StatutTache
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

/** ligne d'une facture de vente — la précision exigée par les mentions
 *  légales (désignation, quantité, unité, prix unitaire, TVA) */
export interface LigneFacture {
  id: string
  designation: string
  quantite: number
  unite: string // forfait · h · j · % · u
  prixUnitaireHT: number
  /** FRACTION (0.2 = 20 %) — même convention que Facture.tauxTVA */
  tauxTVA: number
  phase?: PhaseCode | null
}

/** copie FIGÉE de la facture au moment de l'émission (audit finance F0) :
 *  le PDF se régénère depuis CE bloc, jamais depuis l'état courant —
 *  changer l'adresse du client ne modifie plus une facture historique */
export interface FactureFigee {
  numero: string
  dateEmission: string
  datePrestation?: string
  clientNom: string
  clientAdresse?: string
  clientSiret?: string
  numeroEngagement?: string
  objet?: string
  agence: {
    nom: string
    adresse?: string
    siret?: string
    tva?: string
    rcs?: string
    capital?: string
    iban?: string
    bic?: string
    banque?: string
  }
  lignes: LigneFacture[]
  totalHT: number
  totalTVA: number
  totalTTC: number
  mentionTVA: string
  delaiJours: number
  /** empreinte SHA-256 du bloc figé (audit, unicité) */
  empreinte?: string
}

export interface Facture {
  id: string // identifiant INTERNE (les anciennes factures gardent leur numéro comme id)
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
  // --- Audit finance F0 : intégrité de la pièce ---
  /** numéro LÉGAL, attribué uniquement à l'émission (séquence continue) */
  numero?: string
  /** facture ordinaire ou avoir (correction — jamais de modification silencieuse) */
  type?: 'facture' | 'avoir'
  /** pour un avoir : la facture d'origine corrigée */
  factureOrigineId?: string | null
  /** lignes détaillées (mentions légales) — les anciennes factures n'en ont pas */
  lignes?: LigneFacture[]
  /** copie figée à l'émission — la vérité du PDF */
  figee?: FactureFigee
  /** journal d'audit : émission, paiement, avoir, relance… */
  evenements?: { date: string; type: string; detail?: string }[]
  /** facture migrée : la version PDF réellement envoyée n'a pas été rapprochée */
  historiqueAControler?: boolean
  /** ligne de contrat qui justifie la facture (F1) */
  contratLigneId?: string | null
  /** cycle de vie de transmission (Chorus/PDP) — mémorisé, jamais inventé (F5) */
  transmissions?: EvenementTransmission[]
  statutComptable?: StatutComptable
  lotComptableId?: string | null
  motifRejetComptable?: string
}

// --- Audit finance F0 : la PRÉVISION n'est pas la PIÈCE ---

/** échéance de facturation : prévision modifiable, SANS numéro légal.
 *  Les anciennes références '2027-D01' deviennent des identifiants internes. */
export interface EcheanceFacturation {
  id: string
  projetId: string
  phase: PhaseCode
  libelle: string
  montantHT: number
  tauxTVA: number
  /** date d'émission prévue */
  datePrevue: string
  delaiJours: number
  /** ligne de contrat qui justifie l'échéance (F1) */
  contratLigneId?: string | null
  /** situation de travaux à l'origine (honoraires DET) */
  situationId?: string | null
  notes?: string
}

/** paiement reçu — un paiement peut régler PLUSIEURS factures, une facture
 *  peut recevoir plusieurs paiements ; le statut se DÉRIVE du solde */
export interface Paiement {
  id: string
  date: string // ISO
  montant: number // TTC
  moyen?: string // virement, chèque…
  reference?: string
  affectations: { factureId: string; montant: number }[]
  statutComptable?: StatutComptable
  lotComptableId?: string | null
  notes?: string
}

// --- Audit finance F1 : le CONTRAT devient la racine du chiffre ---

export type TypeContrat = 'client' | 'fournisseur' | 'agence'
export type NatureLigneContrat = 'base' | 'complementaire' | 'option' | 'debours' | 'revision'
export type EtatLigneContrat = 'active' | 'option' | 'supprimee'

export interface LigneContrat {
  id: string
  nature: NatureLigneContrat
  phase?: PhaseCode | null
  designation: string
  quantite: number
  unite: string // forfait · h · j · % · u
  prixUnitaireHT: number
  tauxTVA?: number | null
  /** budget de production interne (heures) */
  heuresBudget?: number | null
  /** budget de coûts externes (BET, sous-traitance, débours) — un BUDGET,
   *  pas un coût réel tant qu'aucune facture fournisseur ne le justifie */
  coutExterneBudgetHT?: number | null
  /** ce qui déclenche la facture : signature, remise, jalon, avancement */
  declencheur?: string
  etat: EtatLigneContrat
  /** avenant qui a créé ou supprimé la ligne (traçabilité avant/après) */
  avenantId?: string | null
}

/** avenant : un contrat ne se réécrit JAMAIS silencieusement — l'avenant
 *  ajoute des lignes et en désactive, l'historique reste lisible */
export interface AvenantContrat {
  id: string
  date: string // ISO
  motif: string
  documentId?: string | null
  /** résumé avant/après lisible */
  detail?: string
}

export interface Contrat {
  id: string
  type: TypeContrat
  intitule: string
  /** tiers en clair + liens canoniques facultatifs */
  tiers: string
  organisationId?: string | null
  entrepriseId?: string | null
  projetId?: string | null
  dateSignature?: string | null
  dateNotification?: string | null
  /** document signé (registre) */
  documentId?: string | null
  lignes: LigneContrat[]
  avenants: AvenantContrat[]
  // --- contrat d'agence récurrent (bail, logiciels, assurance…) ---
  periodiciteMois?: number | null
  /** montant attendu PAR période (détection d'oubli / de dérive) */
  montantAttenduHT?: number | null
  tolerancePct?: number | null
  dateRenouvellement?: string | null
  /** obligation d'origine (Échéances agence) — les deux vues restent liées */
  obligationId?: string | null
  /** contrat provisoire migré des phases — à contrôler face au document signé */
  provisoire?: boolean
  notes?: string
  evenements?: { date: string; type: string; detail?: string }[]
}

// --- Audit finance F2 : achats, frais et complétude ---

/** ventilation d'une dépense sur projet/phase/catégorie — la somme des
 *  ventilations doit égaler le HT de la pièce (contrôle bloquant §8.2) */
export interface VentilationAchat {
  id: string
  montantHT: number
  projetId?: string | null
  phase?: PhaseCode | null
  categorie: string
  refacturable?: boolean
  compteComptable?: string
}

export type StatutAchat = 'a_valider' | 'validee' | 'ecartee'
/** statut COMPTABLE d'une pièce — mis à jour par l'export et le retour du
 *  cabinet, sans jamais écraser la pièce opérationnelle (audit §5.6) */
export type StatutComptable = 'exporte' | 'comptabilise' | 'rejete'

export interface FactureAchat {
  id: string
  fournisseur: string
  entrepriseId?: string | null
  /** numéro porté par la pièce du fournisseur — unicité tiers+numéro contrôlée */
  numeroFournisseur?: string
  dateFacture: string
  dateEcheance?: string | null
  montantHT: number
  montantTVA?: number | null
  montantTTC: number
  ventilations: VentilationAchat[]
  statut: StatutAchat
  /** payée le — renseigné par le rapprochement bancaire ou à la main */
  payeLe?: string | null
  transactionId?: string | null
  /** pièce au registre documentaire (empreinte SHA-256 = dédoublonnage) */
  documentId?: string | null
  empreinte?: string
  source: 'manuel' | 'gmail' | 'drive' | 'import' | 'xml'
  confiance?: number | null
  raisons?: string[]
  doublonDeId?: string | null
  /** engagement fournisseur ou contrat récurrent honoré par cette pièce */
  contratId?: string | null
  statutComptable?: StatutComptable
  lotComptableId?: string | null
  motifRejetComptable?: string
  notes?: string
  evenements?: { date: string; type: string; detail?: string }[]
}

export type StatutNoteFrais = 'a_rembourser' | 'remboursee'

/** dépense payée personnellement (parcours allégé — audit §5.4) */
export interface NoteFrais {
  id: string
  personne: string
  date: string
  fournisseur?: string
  libelle: string
  montantTTC: number
  tauxTVA?: number | null
  moyen: 'perso' | 'agence'
  projetId?: string | null
  phase?: PhaseCode | null
  categorie: string
  /** indemnités kilométriques (séparées d'une facture classique) */
  kilometres?: number | null
  documentId?: string | null
  statut: StatutNoteFrais
  statutComptable?: StatutComptable
  lotComptableId?: string | null
  evenements?: { date: string; type: string; detail?: string }[]
}

// --- moteur de complétude (audit §8) : une absence attendue devient une
// exception à confirmer, jamais une erreur silencieuse.
// La liste des attendus se DÉRIVE (contrats récurrents, banque, historique) ;
// on ne stocke que les décisions humaines (exception confirmée, reçu manuel).
export type ExceptionAttendu = 'non_recue' | 'contrat_termine' | 'reporte' | 'doublon' | 'justifie'

export interface AttenduFinancier {
  id: string
  type: 'facture_fournisseur' | 'justificatif_banque'
  /** contrat récurrent × période ('AAAA-MM') ou transaction bancaire */
  contratId?: string | null
  periode?: string | null
  transactionId?: string | null
  libelle: string
  exception: ExceptionAttendu
  date: string // décision ISO
  notes?: string
}

// --- Audit finance F3 : banque & trésorerie ---

export interface TransactionBancaire {
  /** idempotence : identifiant banque si présent, sinon empreinte
   *  date|montant|libellé (réimporter le même relevé n'ajoute rien) */
  id: string
  date: string
  /** signé : crédit positif, débit négatif */
  montant: number
  libelle: string
  reference?: string
  importId: string
  /** rapprochement VALIDÉ par l'utilisateur (le Cockpit propose seulement) */
  rapprochement?: {
    type: 'paiement_client' | 'facture_achat' | 'note_frais' | 'interne' | 'justifie'
    paiementId?: string
    factureAchatId?: string
    noteFraisId?: string
    detail?: string
    valideLe: string
  } | null
}

export interface ImportBancaire {
  id: string
  date: string
  nomFichier: string
  nbLignes: number
  nbNouvelles: number
  /** solde de fin de relevé (si présent dans le fichier ou saisi) */
  soldeFinal?: number | null
  dateSolde?: string | null
}

/** mapping CSV bancaire mémorisé (audit §5.5 — phase initiale) */
export interface MappingBancaire {
  separateur: string
  entete: boolean
  formatDate: 'JJ/MM/AAAA' | 'AAAA-MM-JJ'
  colDate: number
  colLibelle: number
  /** soit une colonne montant signé, soit débit/crédit séparés */
  colMontant?: number | null
  colDebit?: number | null
  colCredit?: number | null
}

// --- Audit finance F4 : pont expert-comptable ---

export interface ProfilComptable {
  logiciel?: string
  separateur: ';' | ',' | 'tab'
  formatDate: 'JJ/MM/AAAA' | 'AAAA-MM-JJ'
  journaux: { ventes: string; achats: string; banque: string; od: string }
  comptes: {
    produits: string
    clients: string
    fournisseurs: string
    tvaCollectee: string
    tvaDeductible: string
    banque: string
    /** compte de remboursement des notes de frais (ex. 421 ou 467) */
    notesFrais: string
    /** compte de charge par défaut quand la ventilation n'en précise pas */
    chargesDefaut: string
  }
  /** dimensions analytiques projet/phase dans l'export */
  analytique?: boolean
  /** règle de création des comptes tiers (préfixe + nom replié) */
  prefixeClient?: string
  prefixeFournisseur?: string
  /** régime de TVA confirmé par le cabinet */
  regimeTVA?: string
  notes?: string
}

export interface LotComptable {
  id: string
  periode: string // 'AAAA-MM'
  version: number
  dateExport: string
  par?: string
  /** empreinte SHA-256 du zip exporté */
  empreinte?: string
  nomFichier: string
  /** identifiants exportés — le diff V1/V2 et l'anti double-export s'appuient dessus */
  factureIds: string[]
  achatIds: string[]
  fraisIds: string[]
  paiementIds: string[]
  controles: string[]
  statut: 'exporte' | 'retour_recu'
  retour?: { date: string; acceptees: number; rejets: { pieceId: string; motif: string }[] }
}

// --- Audit finance F5 : facturation électronique ---

/** statut de cycle de vie mémorisé (Chorus Pro / PDP / e-mail) — audit §11.4 */
export interface EvenementTransmission {
  date: string
  plateforme: 'chorus' | 'pdp' | 'email' | 'autre'
  statut: 'deposee' | 'rejetee' | 'mise_a_disposition' | 'approuvee' | 'payee'
  reference?: string
  motif?: string
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
  /** dossier de poursuite rattaché (catégorie « Prospection / AO ») —
   *  donne le coût réel de chaque réponse (audit V3, Lot 4) */
  consultationId?: string | null
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
  /** organisation canonique (CRM acheteurs) — l'organisme libre reste pour l'affichage */
  organisationId?: string | null
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
  /** entreprise canonique (registre) */
  entrepriseId?: string | null
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
  // --- V3 développement : source structurée + cycle de vie de l'avis ---
  /** identifiant côté source (idweb BOAMP, numéro TED…) */
  sourceId?: string
  /** lien officiel de l'avis */
  sourceUrl?: string
  /** appel d'offres classique ou concours (parcours différents) */
  typeAvis?: 'marche' | 'concours'
  /** rectificatifs, reports, annulations, résultats — JAMAIS des doublons */
  evenements?: { date: string; type: string; detail?: string }[]
  // --- V3 Lots 3/4/5 : dossier de poursuite, concours, CRM ---
  /** checklist dynamique du dossier — chaque exigence garde sa source */
  exigences?: ExigenceDossier[]
  /** partenaires de groupement (BET, paysagiste…) pressentis ou confirmés */
  partenaires?: PartenaireDossier[]
  /** volet concours (typeAvis = 'concours') : étapes, prime, jury, livrables */
  concours?: VoletConcours
  /** honoraires ou prime attendus si l'affaire est gagnée (valeur attendue) */
  honorairesEstimes?: number | null
  /** organisation acheteuse canonique (CRM) */
  organisationId?: string | null
}

// --- V3 Lot 3 : dossier de poursuite ---

export type CategorieExigence =
  | 'admin' | 'capacites' | 'equipe' | 'technique' | 'financiere' | 'depot' | 'controle'

export type StatutExigence = 'a_faire' | 'en_cours' | 'fait' | 'sans_objet'

/** un élément de la checklist dynamique du dossier — jamais générique :
 *  chaque exigence dit d'où elle vient (base agence, RC collé, manuel) */
export interface ExigenceDossier {
  id: string
  categorie: CategorieExigence
  texte: string
  /** provenance : 'base agence' · 'RC : « extrait »' · 'manuel' */
  source: string
  /** une exigence obligatoire non faite bloque « prêt à déposer » */
  obligatoire: boolean
  statut: StatutExigence
  responsable?: string
  echeance?: string | null
  /** document du registre qui satisfait l'exigence */
  documentId?: string | null
}

/** partenaire du groupement (BET structure, fluides, paysagiste, économiste…) */
export interface PartenaireDossier {
  id: string
  nom: string
  role: string
  statut: 'pressenti' | 'confirme'
}

// --- V3 Lot 4 : parcours concours (distinct de l'AO classique) ---

export type EtapeConcours =
  | 'candidature'          // dossier de candidature en préparation
  | 'candidature_deposee'  // en attente de la sélection
  | 'selectionne'          // admis à concourir → production du projet
  | 'non_selectionne'      // arrêt (résultat de la phase 1)
  | 'rendu'                // projet rendu, en attente du jury
  | 'jury'                 // jury passé, en attente du classement

export interface VoletConcours {
  etape: EtapeConcours
  /** nombre de candidats admis à concourir (souvent 3 ou 4) */
  nbCandidats?: number | null
  /** prime versée aux concurrents non lauréats (indemnité de concours) */
  prime?: number | null
  anonymat?: boolean
  /** livrables demandés (planches, notice, maquette…) — du règlement */
  livrables?: string
  dateJury?: string | null
  /** remise des candidatures (phase 1) — dateLimite porte l'échéance courante */
  dateCandidature?: string | null
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
  /** frais généraux annuels HT (loyer, logiciels, assurances…) — override
   *  global conservé pendant la migration ; la référence devient la somme
   *  des lignes budgétaires ci-dessous (audit §5.9) */
  fraisGenerauxAnnuels: number
  /** frais généraux détaillés en lignes budgétaires annuelles */
  fraisGenerauxLignes?: { id: string; libelle: string; montantAnnuel: number }[]
  /** profil d'échange avec le cabinet comptable (F4) — configuré une fois */
  profilComptable?: ProfilComptable
  /** mapping du CSV bancaire, mémorisé après le premier import (F3) */
  banqueMapping?: MappingBancaire
  /** seuil d'alerte de point bas de trésorerie (€) */
  seuilTresorerie?: number | null
  /** décaissement mensuel prévisionnel de TVA/impôts (paramétré avec le cabinet) */
  tvaMensuelleEstimee?: number | null
  /** modèle de nomenclature documentaire */
  nomenclature: string
  /** mention d'exigibilité TVA imprimée sur les factures — à CONFIRMER avec
   *  le cabinet (encaissements par défaut pour les prestations de services,
   *  option possible sur les débits) ; un réglage, pas une phrase codée en dur */
  mentionTVA?: string
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
  /** décisions du Radar par identifiant d'avis : écartée ou surveillée
   *  (partagées entre les 2 postes — l'un écarte, l'autre ne revoit pas) */
  veilleDecisions?: Record<string, 'ignoree' | 'surveillee'>
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

// ============================================================
// REGISTRE DOCUMENTAIRE — le document devient une entité métier :
// identité stable, empreinte, source, version, statut, liens vers
// les objets qu'il alimente, et journal d'événements. Les chemins
// Drive restent utiles à l'affichage mais ne sont plus l'identité.
// ============================================================

export type StatutDocument =
  | 'recu'
  | 'a_classer'
  | 'classe'
  | 'a_valider'
  | 'valide'
  | 'exploite'
  | 'remplace'
  | 'rejete'

export type SourceDocument = 'gmail' | 'drive' | 'depot' | 'genere' | 'plateforme'

/** trace d'un événement de la vie du document (import, classement,
 *  validation, remplacement, action métier déclenchée…) */
export interface EvenementDocument {
  date: string // ISO
  type: string // 'recu' | 'classe' | 'valide' | 'remplace' | 'action' | …
  detail?: string
  auteur?: string
}

/** un document du registre — TOUT fichier métier qui compte */
export interface DocumentRecord {
  id: string
  titre: string
  nomOriginal: string
  typeMime?: string
  taille?: number
  /** empreinte SHA-256 du contenu — dédoublonnage et versions sûres */
  empreinteSha256?: string
  source: SourceDocument
  /** identifiant côté source (id Gmail de pièce jointe, id Drive…) */
  sourceId?: string
  sourceUrl?: string
  /** chemin dans le Drive local (affichage / ouverture) */
  cheminDrive?: string
  projetId?: string | null
  entrepriseId?: string | null
  marcheId?: string | null
  lotDceId?: string | null
  reunionId?: string | null
  /** dossier de poursuite (consultation) alimenté par ce document */
  consultationId?: string | null
  /** organisation acheteuse (CRM) */
  organisationId?: string | null
  /** contrat signé / avenant justifié par ce document (finance F1) */
  contratId?: string | null
  /** facture de vente dont ce document est la copie figée envoyée */
  factureId?: string | null
  /** facture fournisseur justifiée par ce document (F2) */
  factureAchatId?: string | null
  noteFraisId?: string | null
  lotComptableId?: string | null
  /** catégorie contrôlée (CCTP, DPGF, CR, SITU, PLAN, ADM, PHOTO…) */
  categorie: string
  sousType?: string
  /** date portée par le document (quand elle est fiable) */
  dateDocument?: string | null
  recuLe: string // ISO
  version: number
  /** version précédente que ce document remplace */
  remplaceDocumentId?: string | null
  statut: StatutDocument
  /** confiance de la classification automatique (0..1) — null si manuel */
  confiance?: number | null
  /** raisons lisibles de la proposition (« Voir pourquoi ») */
  raisons?: string[]
  /** données extraites rattachées (ex. résumé CCTP/DPGF) */
  donneesExtraites?: Record<string, unknown>
  validePar?: string
  valideLe?: string
  evenements: EvenementDocument[]
}

/** entreprise CANONIQUE — l'identité unique derrière les artisans,
 *  les marchés et les documents administratifs mutualisés */
export interface Entreprise {
  id: string
  raisonSociale: string
  nomCommercial?: string
  siret?: string
  /** domaines e-mail connus (rattachement des mails/documents) */
  domaines: string[]
  contactNom?: string
  contactEmail?: string
  tel?: string
  lots: string[]
  zone?: string
  /** date de fin de validité de la décennale (vue simple — le document
   *  complet vit dans le registre, rattaché par entrepriseId) */
  decennaleFin?: string | null
  notes?: string
}

// --- V3 Lot 5 : CRM organisations (clients & acheteurs) ---

/** étape du pipeline RELATIONNEL — décrit la relation, pas une procédure
 *  (il ne double pas le pipeline des consultations) */
export type EtapeRelation =
  | 'identifie'
  | 'a_comprendre'
  | 'relation_a_creer'
  | 'relation_active'
  | 'projet_potentiel'
  | 'consultation_attendue'
  | 'client'

/** organisation CLIENTE ou ACHETEUSE (commune, EPCI, bailleur, promoteur…) —
 *  le CRM passe du carnet de contacts au radar de relations (audit V3 §6.5).
 *  Distincte d'`Entreprise` (les entreprises de travaux des chantiers). */
export interface Organisation {
  id: string
  nom: string
  /** Commune, EPCI, Bailleur social, État / établissement public, Privé… */
  type?: string
  siren?: string
  /** territoire d'action (ville, département, région) */
  territoire?: string
  /** profil acheteur habituel (URL de la plateforme de dépôt) */
  profilAcheteur?: string
  relation: EtapeRelation
  /** intérêt stratégique pour l'agence : 1 (faible) → 3 (prioritaire) */
  interet?: 1 | 2 | 3
  prochaineAction?: string
  dateProchaineAction?: string | null
  notes?: string
  creeLe: string // ISO
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
  /** corpus de l'assistant (textes réglementaires + modèles) — ex-« documents » */
  corpusDocuments: DocumentCorpus[]
  lotsDce: LotDCE[]
  tachesChantier: TacheChantier[]
  /** registre documentaire central — chaque fichier métier, traçable */
  registreDocuments: DocumentRecord[]
  /** entreprises canoniques (identité unique artisans/marchés/documents) */
  entreprises: Entreprise[]
  /** organisations clientes / acheteuses — le CRM par client (audit V3) */
  organisations: Organisation[]
  /** prévisions de facturation (audit finance F0 : la prévision n'est pas la pièce) */
  echeancesFacturation: EcheanceFacturation[]
  /** paiements reçus — le statut d'une facture se dérive de son solde */
  paiements: Paiement[]
  /** contrats clients, engagements fournisseurs et contrats d'agence (F1) */
  contrats: Contrat[]
  /** factures fournisseurs et leurs ventilations (F2) */
  facturesAchat: FactureAchat[]
  /** notes de frais (F2) */
  notesFrais: NoteFrais[]
  /** décisions sur les attendus financiers — exceptions confirmées (F2, §8) */
  attendusFinanciers: AttenduFinancier[]
  /** lignes de relevés bancaires importées (F3) */
  transactionsBancaires: TransactionBancaire[]
  importsBancaires: ImportBancaire[]
  /** lots d'export comptable versionnés (F4) */
  lotsComptables: LotComptable[]
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
