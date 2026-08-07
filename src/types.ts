// ============================================================
// Cockpit L&L — modèle de données (architecture v2 « sans API »)
// L'intranet est 100 % déterministe : aucune donnée ici n'est
// produite par un modèle — les routines Claude écrivent via
// import JSON, toujours avec statut « à vérifier ».
// ============================================================

// Les trois axes de catégorisation des échanges (CDC §5.2) vivent dans
// leur propre module : `PhaseEchange` est un superset SÉPARÉ de
// `PhaseCode`, qui ne bouge pas (il porte la chaîne d'honoraires).
// Import de types seul — aucune dépendance à l'exécution.
import type { NiveauImportance, PhaseEchange, TypeEchange } from './categorisation'
// La règle de rattachement mémorisée (CDC §5.1 pt 5) est déclarée avec LA
// cascade qui l'applique, dans le module partagé avec l'ingestion serveur :
// deux déclarations divergeraient, et c'est ce que le livrable A.4 referme.
import type { RegleRattachement } from '../supabase/functions/_shared/rattachement'

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

/** Prévision d'heures FIGÉE — la référence de la comparaison prévu / réel
 *  (CDC §11.3, critère 15).
 *
 *  Elle vit à côté de `Projet.phases`, jamais DEDANS, et c'est là toute la
 *  garantie : « Recalculer la répartition » remplace le tableau `phases` en
 *  entier (`pr.phases = phasesParDefaut(…)`), donc une baseline rangée dans
 *  une `Phase` disparaîtrait avec lui — silencieusement, et sans que l'écart
 *  mesuré la semaine suivante puisse être reconstitué. La séparation
 *  structurelle vaut mieux qu'une précaution dans le bouton : un futur
 *  producteur de phases n'a rien à savoir de la baseline pour la respecter.
 *  `scripts/test-baseline-heures.cjs` le vérifie.
 *
 *  Elle ne se réécrit que par une action humaine explicite (figer à la
 *  signature, redéfinir depuis la fiche projet). */
export interface BaselineHeures {
  /** date ISO du figeage */
  le: string
  /** qui l'a figée. Trace DATÉE, au sens de `DocumentRecord.validePar` : elle
   *  dit qui a agi ce jour-là, pas qui travaille sur le projet aujourd'hui —
   *  elle n'entre donc pas dans l'inventaire de src/personnes.ts et un
   *  renommage ne la réécrit pas (même doctrine, même motif). */
  par?: string
  /** d'où viennent ces heures. Une REPRISE (répartition trouvée en place au
   *  franchissement du palier v20) n'est pas une signature : l'écran doit le
   *  dire, sinon le chiffre se lit comme un engagement contractuel. */
  origine: 'signature' | 'creation' | 'reprise' | 'revision'
  /** heures prévues par phase à cet instant (code de phase → heures).
   *  Une phase absente n'existait pas au figeage — ce n'est pas 0 h. */
  parPhase: Partial<Record<PhaseCode, number>>
  /** honoraires de base HT qui justifiaient cette répartition : la source du
   *  chiffre, pas seulement le chiffre */
  honorairesBaseHT?: number | null
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
  /** trace du message d'origine quand la note vient d'un mail archivé
   *  (« → Journal » du Cockpit) — même forme que `Courrier.source`, lue par
   *  `lienGmail` (`src/util.ts`). CDC §4.2 : l'objet issu d'un e-mail garde
   *  le chemin de retour vers l'e-mail. */
  source?: string
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
  /** prévision d'heures figée à la signature (CDC §11.3). Trois états, et le
   *  troisième compte : `undefined` = jamais figée (la reprise du palier v20
   *  peut la poser) ; `null` = délibérément sans référence, la reprise n'y
   *  touche pas ; un objet = la référence. */
  baselineHeures?: BaselineHeures | null
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
  /** 5.8 — délai de visa des documents d'exécution du CCAP (jours
   *  calendaires) : pré-remplit chaque nouveau visa du registre ; absent =
   *  15 j (DELAI_VISA_DEFAUT). Sur le PROJET et non le marché : le CCAP
   *  fixe le plus souvent un délai unique pour toute l'opération */
  delaiVisaJours?: number | null
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
  // --- ancrages externes (CDC §3.10, §12.1, §18) — TOUS optionnels et
  // saisis à la main : `id` (P01) reste la clé interne, rien ne dépend de
  // ces valeurs, et rien ne les produit automatiquement à ce stade.
  /** code lisible côté client, porté par les échanges (ex. « 2026-034 ») —
   *  l'identifiant interne P01 ne bouge pas : renommer casserait les liens,
   *  les journaux et `entrants.projet_id_propose` déjà en base */
  codeExterne?: string
  /** adresse dédiée du projet, format [code-projet]@agence-ll.fr — le
   *  domaine n'est pas présumé (il n'est pas acheté) : c'est une donnée
   *  saisie, jamais une adresse créée par le Cockpit */
  adresseProjet?: string
  /** identifiant du dossier Drive du projet (Lot 3 — aujourd'hui saisi à
   *  la main ; le rangement local passe toujours par `cheminDrive`) */
  driveFolderId?: string
  /** identifiant de l'agenda secondaire du projet (Lot 3, export .ics) —
   *  créé à la main : le Cockpit ne demande le calendrier qu'en lecture */
  calendarId?: string
}

/** courrier trié par la routine mail du matin — rangé au bon projet */
export interface Courrier {
  id: string
  projetId: string | null
  de: string
  objet: string
  resume: string
  /** question / document / administratif / commercial / autre — texte
   *  libre historique. CONSERVÉ tel quel : c'est la trace de ce qui a
   *  été écrit, et donc la source dont `typeEchange` se re-dérive. */
  type: string
  actionProposee?: string
  urgence?: 1 | 2 | 3
  pour?: string
  statut: 'a_traiter' | 'traite'
  dateReception: string // ISO
  source?: string
  // --- axes de catégorisation du CDC §5.2 (src/categorisation.ts) ---
  // Optionnels et nullables : `null` veut dire « non renseigné, à
  // choisir », jamais « sans importance ». Renseignés une fois par le
  // palier v19 depuis `type` et `urgence`, corrigeables ensuite.
  // Ils ne portent PAS la séparation proposé / validé du §3.14 : dans
  // le document JSONB il n'y a pas de GRANT au niveau colonne pour la
  // tenir. La table `communications` (A.2) la portera ; ici, la garantie
  // est plus faible et se limite à la re-dérivabilité depuis `type`.
  phaseEchange?: PhaseEchange | null
  typeEchange?: TypeEchange | null
  importance?: NiveauImportance | null
}

// ---------- la tâche interne (CDC §8.5) — livrable B.1 ----------
//
// Les dix-huit champs du §8.5, dans son ordre. Les référentiels — statuts,
// priorités, origines — vivent dans `src/taches.ts`, avec les fonctions qui
// les consomment ; ici il n'y a que la forme.

/** un commentaire de tâche : horodaté et attribué, comme les événements du
 *  registre documentaire dont il reprend le patron (§19.3 pt 5) */
export interface CommentaireTache {
  id: string
  date: string // ISO
  auteur: string | null
  texte: string
}

/** une sous-tâche : une case à cocher, pas une tâche à part entière. En
 *  faire une `TacheInterne` complète imposerait un projet, un statut sur
 *  neuf et une échéance à ce qui est une étape de trois mots. */
export interface SousTache {
  id: string
  titre: string
  faite: boolean
}

/** d'où vient la tâche (§8.4). `id` désigne l'objet d'origine — `null`
 *  pour une saisie manuelle, qui ne vient de rien. */
export interface SourceTache {
  type: string
  id: string | null
}

export interface TacheInterne {
  id: string
  titre: string
  description: string
  projetId: string | null
  phase: PhaseCode | null
  /** qui la porte. Entre dans l'inventaire de `src/personnes.ts`. */
  responsable: string | null
  /** qui l'a créée. Y entre aussi : c'est le filtre « créées par moi » du §8.3. */
  createur: string | null
  participants: string[]
  /** `basse` | `normale` | `haute` | `critique` — voir `src/taches.ts` */
  priorite: string
  /** l'un des neuf du §8.6 — voir `STATUTS_TACHE` */
  statut: string
  debut: string | null
  echeance: string | null
  /** en heures */
  tempsEstime: number | null
  /** en heures. PROJETÉ depuis les pointages (B.9), jamais saisi : le
   *  calculer à deux endroits le ferait diverger de la marge (§7.3). */
  tempsEnregistre: number
  source: SourceTache
  documentIds: string[]
  commentaires: CommentaireTache[]
  sousTaches: SousTache[]
  /** identifiants d'autres tâches qui doivent être finies avant celle-ci */
  dependances: string[]
  creeLe: string
  majLe: string
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

/** C3 — état d'un point de séance. QUATRE états, pas cinq : au-delà, plus
 *  personne ne sait lequel choisir en réunion, et le geste le plus fréquent
 *  du chantier cesse d'être instantané.
 *
 *  « sans suite » n'est pas « fait » : un point abandonné (l'entreprise a
 *  eu raison, la MOA a tranché autrement, le point n'avait pas lieu d'être)
 *  se RANGE, il ne se supprime pas — six mois plus tard, la question de
 *  savoir si on l'avait vu et écarté, ou jamais vu, est exactement celle
 *  qu'on se pose. */
export type EtatPointSeance = 'a_traiter' | 'en_cours' | 'fait' | 'sans_suite'

/** C3 — d'où vient un point que la MACHINE a proposé et qu'un humain a
 *  inscrit. Sert à deux choses, et à rien d'autre : dire à l'écran d'où
 *  sort la ligne, et empêcher de reproposer indéfiniment ce qui est déjà au
 *  relevé (`PointSeance.origineRef`). Un point saisi à la main n'a pas
 *  d'origine — c'est le cas ordinaire. */
export type OriginePointSeance = 'visa' | 'penalite' | 'gpa' | 'confirmation' | 'avancement'

/** C3 — POINT DE SÉANCE : la ligne d'ordre du jour d'une réunion de
 *  chantier, et le retour d'usage du 06/08/2026 (« il faudrait que ça soit
 *  à la limite une version du CR précédent, ajusté ; une sorte de to-do
 *  améliorée, où on garde tout mais où tout se range en fonction de ce qui
 *  est fait ou non »).
 *
 *  POURQUOI RATTACHÉ AU PROJET, ET NON À LA RÉUNION — c'est toute la
 *  question, et c'est ce qui sépare ce modèle d'une liste de tâches par
 *  réunion. Une réunion de chantier ne part JAMAIS d'une page blanche :
 *  elle reprend le relevé précédent, point par point, et chaque point
 *  avance ou n'avance pas. Un point qui appartiendrait à UNE réunion
 *  devrait être RECOPIÉ à la suivante — et une recopie, c'est deux objets
 *  pour une seule question, donc deux histoires possibles, donc la
 *  disparition silencieuse de la seule information que personne n'a
 *  aujourd'hui : « ce point traîne depuis trois séances ».
 *
 *  Le point traverse donc les réunions et ne garde d'elles que celle où il
 *  est APPARU (`reunionOrigineId`). Son ancienneté se COMPTE
 *  (`ancienneteEnSeances`, src/seanceChantier.ts) au lieu de se stocker :
 *  un compteur incrémenté à chaque séance se désynchroniserait le jour où
 *  une réunion est reprogrammée ou supprimée.
 *
 *  Le CR (`ReunionChantier.cr`) reste ce qu'il est : le compte rendu d'UNE
 *  séance, rédigé, diffusé, figé dans le temps. Le relevé le PRÉPARE et lui
 *  SURVIT. Les deux ne se remplacent pas. */
export interface PointSeance {
  id: string
  projetId: string
  /** marché (lot + entreprise) concerné — null : point général de
   *  l'opération (MOA, MOE, bureau de contrôle…) */
  marcheId?: string | null
  /** lot ou entreprise écrit à la main, quand aucun marché ne porte le
   *  point (bureau de contrôle, concessionnaire, lot pas encore attribué) */
  lot?: string
  libelle: string
  /** qui doit AGIR — texte libre : c'est ce qui s'écrit au CR (« SARL
   *  Martin BTP », « MOE », « MOA »). null/absent = personne n'a été
   *  désigné, et l'écran le dit : « ? », jamais un nom par défaut. */
  responsable?: string | null
  /** échéance FACULTATIVE (ISO) — beaucoup de points n'en ont pas, et
   *  inventer une date au motif qu'il en faut une transformerait le relevé
   *  en fabrique d'échéances fausses */
  echeance?: string | null
  etat: EtatPointSeance
  /** date de PREMIÈRE inscription à l'ordre du jour (ISO) — jamais
   *  réécrite : c'est elle qui fait l'ancienneté et le rangement */
  inscritLe: string
  /** réunion où le point est APPARU. Le « n° » de la séance est celui de
   *  son titre (« Réunion de chantier n°18 ») ; null = point inscrit hors
   *  séance, entre deux réunions, ce qui est fréquent. */
  reunionOrigineId?: string | null
  /** date de résolution (ISO) : posée en passant à « fait » ou « sans
   *  suite », retirée si le point est rouvert (src/seanceChantier.ts) */
  resoluLe?: string | null
  /** proposition de la machine acceptée : sa nature… */
  origine?: OriginePointSeance
  /** … et sa clé stable (`visa:v-12`, `gpa:d-3`…). Un point qui la porte
   *  ne sera plus reproposé : la question vit désormais au relevé, à un
   *  seul endroit. */
  origineRef?: string | null
  notes?: string
  majLe: string
}

/** Garantie d'un marché de travaux (CCAG Travaux art. 33) :
 *  - 'retenue' : la retenue de garantie est prélevée sur chaque situation (défaut) ;
 *  - 'caution' : caution bancaire de substitution — rien n'est retenu ;
 *  - 'gpd' : garantie à première demande — rien n'est retenu non plus.
 *  Retenir 5 % à une entreprise qui a fourni caution ou GPD lui ferait payer
 *  sa garantie deux fois — c'était le défaut 5.1. */
export type TypeGarantie = 'retenue' | 'caution' | 'gpd'

/** 5.23 — une PÉRIODE d'intervention d'un lot sur le chantier.
 *
 *  L'agence : « sur le planning chantier, il faut qu'une entreprise puisse
 *  intervenir PLUSIEURS FOIS ». C'est le cas NORMAL d'un chantier, et le
 *  modèle d'avant l'interdisait : un seul couple `dateDebut`/`dateFin` par
 *  marché, donc un lot = une intervention continue. Or le gros œuvre revient
 *  après le clos-couvert, le plaquiste passe avant puis après l'électricien.
 *  On ne pouvait représenter que la première période, ou une seule barre qui
 *  recouvre les trous — et le planning mentait dans les deux cas.
 *
 *  L'AUTORITÉ DE LECTURE EST `interventionsDe` (src/planningTravaux.ts), pas
 *  ce champ : elle rend les périodes si elles existent, sinon replie
 *  `dateDebut`/`dateFin` en une période unique. Rien ici ne réécrit les
 *  marchés déjà saisis — le repli se fait à la LECTURE. */
export interface PeriodeIntervention {
  id: string
  /** bornes INCLUSES, comme partout dans le planning travaux. Une seule des
   *  deux suffit — « ça commence là, sans durée connue » — et la période
   *  reste alors visible et déplaçable, donc corrigeable d'un geste. Aucune
   *  des deux : la période existe (elle a été ajoutée) mais ne se dessine
   *  pas ; « null n'est pas 0 », une date inventée ferait entrer le lot dans
   *  les calculs de retard avec des jours que personne n'a décidés. */
  debut?: string | null
  fin?: string | null
  /** libellé court facultatif — « reprises », « seconde phase ». C'est LUI
   *  qui rend le planning lisible quand un lot porte trois barres : sans
   *  lui, trois rectangles de la même couleur sur la même ligne ne se
   *  distinguent que par leur position. */
  libelle?: string
  /** 5.7 — l'entreprise a confirmé sa venue POUR CETTE PÉRIODE. La
   *  confirmation ne s'hérite jamais d'une période à la suivante : c'est
   *  précisément quand une entreprise revient qu'on oublie de la confirmer,
   *  et une confirmation obtenue en février ne dit rien du retour de juin. */
  confirmeLe?: string | null
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
  /** 5.4 — série de référence de la révision, telle qu'écrite au CCAP
   *  (BT01, BT02, TP08…) : chaque entreprise a la sienne. Texte libre
   *  court plutôt que liste fermée — l'INSEE publie des dizaines de séries
   *  et un CCAP peut en citer n'importe laquelle ; une liste serait fausse
   *  dès le premier marché qui en sortirait. */
  indiceRevision?: string
  /** mois d'établissement des prix ('AAAA-MM') — le I0 de la formule */
  moisZero?: string
  /** partie fixe de la formule du CCAP « partFixe + (1 − partFixe) × In/I0 »,
   *  en fraction comme tauxRG (0,15 par défaut si absent — l'usage CCAG) */
  partFixe?: number
  /** délai contractuel de vérification des situations par la MOE (jours) */
  delaiVerifJours: number
  contactNom?: string
  contactEmail?: string
  /** chantier en cours → une situation mensuelle est attendue */
  actif: boolean
  /** intervention du lot sur le chantier — alimente le planning travaux.
   *
   *  5.23 — CES DEUX CHAMPS RESTENT, et deviennent L'ENVELOPPE du lot :
   *  premier début et dernière fin de `interventions`, maintenus
   *  automatiquement à chaque écriture des périodes
   *  (`synchroniserEnveloppe`, src/planningTravaux.ts). C'est ce qui fait
   *  qu'aucun des dix endroits qui les lisent aujourd'hui ne casse — le
   *  Gantt de la fiche projet, les filtres, l'impression, la prolongation
   *  par intempéries (src/penalites.ts), la date de fin prolongée du relevé
   *  de séance (src/seanceChantier.ts) — et qu'un écran non encore migré
   *  affiche l'ÉTENDUE du lot au lieu d'un trou.
   *
   *  Sur un marché sans `interventions` (tout marché saisi avant 5.23), ils
   *  restent la seule source, et `interventionsDe` les replie en une période
   *  unique. Ce qui DESSINE ou COMPARE passe par `interventionsDe` — jamais
   *  par ces deux champs directement, sinon un lot en trois passages
   *  redevient une barre qui recouvre ses propres trous. */
  dateDebut?: string | null
  dateFin?: string | null
  /** 5.23 — les périodes d'intervention du lot, quand il en a plusieurs (ou
   *  quand l'une d'elles porte un libellé). ABSENT sur tout marché antérieur
   *  et sur tout marché à période unique jamais rouvert : l'absence n'est
   *  pas un manque, c'est l'état d'origine, et `interventionsDe` sait le
   *  lire. Un tableau VIDE, lui, est un choix humain — un lot attribué dont
   *  les dates ne sont pas connues, ce qui est le cas au moment de la
   *  signature : il ne se replie alors sur rien. */
  interventions?: PeriodeIntervention[]
  /** date de réception des travaux — point de départ de la garantie de parfait achèvement */
  dateReception?: string | null
  /** type de garantie — absent sur les documents d'avant le Lot 5 : c'est
   *  alors `cautionRG` qui tranche. `garantieDuMarche` (derive.ts) est la
   *  SEULE lecture autorisée de ces deux champs ensemble : lire l'un sans
   *  l'autre recrée le défaut 5.1 (décompte et cycle de vie divergents). */
  garantie?: TypeGarantie
  /** date de réception du document de garantie (caution ou GPD) */
  garantieRecueLe?: string | null
  /** [hérité] retenue remplacée par une caution bancaire — conservé pour les
   *  documents existants ; `garantie` le remplace et prime quand il est posé */
  cautionRG?: boolean
  /** retenue de garantie libérée à l'entreprise (levée effectuée) */
  rgLibere?: boolean
  /** 5.2 — taux de pénalités du CCAP, propres au marché (chaque CCAP écrit
   *  les siens). `null`/absent = non saisi : le calcul répond alors null,
   *  jamais 0 — un « 0 € de pénalité » affirmerait que le CCAP a été lu */
  penalites?: {
    /** € HT par jour de retard d'exécution */
    retardParJourHT?: number | null
    /** € HT par absence à une réunion de chantier */
    absenceReunionHT?: number | null
    /** € HT par jour de retard d'un document contractuel (DOE, PPSPS…) */
    documentRetardParJourHT?: number | null
  }
  /** 5.19 — avance forfaitaire du marché HT (CCAG Travaux art. 13, souvent
   *  5 % du montant initial). `null`/absent = pas d'avance : le certificat
   *  de paiement n'a alors rien à résorber */
  avanceForfaitaireHT?: number | null
  /** 5.19 — part de l'avance déjà remboursée HT (cumul des résorptions
   *  ÉMISES). Avancé par le geste « Émettre » du certificat, jamais
   *  recalculé : c'est un fait contractuel, pas une dérivation */
  avanceRembourseeHT?: number | null
  notes?: string
}

/** 5.4/5.18 — valeur mensuelle d'un indice de révision BTP (BT01, TP08…).
 *  Depuis 5.18, l'historique COMPLET des séries se récupère TOUT SEUL depuis
 *  l'API SDMX publique de l'INSEE (src/indicesInsee.ts, src/majIndices.ts) —
 *  la décision « saisie à la main seulement » de 5.4 est annulée par
 *  l'agence. La saisie manuelle reste possible (une valeur attendue avant
 *  publication), mais la valeur INSEE du même (code, mois) l'écrase : l'INSEE
 *  est la source, la saisie n'était que l'attente. Le rapprochement avec
 *  `Marche.indiceRevision` se fait sans casse ni espaces
 *  (src/revisionPrix.ts) : « bt01 » saisi ici et « BT01 » au marché
 *  désignent la même série. */
export interface IndiceBTP {
  id: string
  /** code de la série, tel que publié (BT01, TP08…) */
  indice: string
  /** mois de la valeur ('AAAA-MM') */
  mois: string
  valeur: number
}

/** 5.2 — les trois faits générateurs de pénalité du CCAG Travaux (art. 19-20) */
export type TypeEvenementMarche = 'retard_execution' | 'absence_reunion' | 'document_retard'

/** 5.2 — événement du journal de pénalités d'un marché. L'événement CONSTATE
 *  (un retard, une absence, un document manquant) ; il n'applique rien :
 *  une pénalité est un acte contractuel, pas un calcul. Le montant encouru
 *  se recalcule à l'affichage (src/penalites.ts) ; seule la décision humaine
 *  « Appliquer » fige `penaliteMontantHT` et la signe (decidePar/decideLe). */
export interface EvenementMarche {
  id: string
  marcheId: string
  projetId: string
  type: TypeEvenementMarche
  /** date du constat (retard, réunion manquée, échéance du document) */
  date: string // ISO 'AAAA-MM-JJ'
  /** jours de retard constatés (retard d'exécution, document en retard) —
   *  sans objet pour une absence de réunion */
  jours?: number | null
  /** document concerné quand type = 'document_retard' (DOE, PPSPS, agrément…) */
  document?: string
  commentaire: string
  /** décision humaine prise — jamais posée par le module de calcul */
  penaliteAppliquee: boolean
  /** montant HT FIGÉ à la décision : un taux corrigé ou une intempérie
   *  saisie après coup ne réécrit pas ce qui a été signifié à l'entreprise */
  penaliteMontantHT?: number | null
  decidePar?: string | null
  decideLe?: string | null
}

/** 5.3 — natures d'intempéries reconnues (CCAG art. 19.2.3 ; chaleur : code du travail) */
export type NatureIntemperie = 'pluie' | 'neige' | 'vent' | 'chaleur' | 'gel'

/** 5.3 — un jour d'intempérie constaté sur un chantier. Double effet, lu
 *  par src/penalites.ts : prolongation du délai contractuel du marché ET
 *  déduction des jours de retard (5.2) — les deux registres se lisent
 *  ensemble, sinon on pénalise un retard que la pluie excuse. Le décompte
 *  se fait en jours OUVRÉS DISTINCTS : deux natures le même jour font un
 *  seul jour d'arrêt. */
export interface Intemperie {
  id: string
  projetId: string
  date: string // ISO 'AAAA-MM-JJ'
  nature: NatureIntemperie
  /** le constat opposable : seuil du CCAP atteint, CR de chantier, relevé météo… */
  commentaire: string
}

/** 5.8 — statuts d'un document d'exécution au registre des visas. Trois
 *  issues possibles du geste (CCAG MOE) : visé, visé avec observations,
 *  refusé — « à viser » est l'état d'attente, celui qui engage la MOE si
 *  le délai du CCAP passe. */
export type StatutVisa = 'a_viser' | 'vise' | 'vise_observations' | 'refuse'

/** 5.8 — un document d'exécution reçu d'une entreprise en phase VISA.
 *  Le registre CONSTATE (reçu le, délai du CCAP) ; viser reste un geste
 *  humain, daté (`viseLe`) et signé (`visePar`) : un visa en retard engage
 *  la responsabilité de la MOE, il faut pouvoir dire qui a visé quoi et
 *  quand — un statut changé sans date ni signature ne prouverait rien. */
export interface Visa {
  id: string
  projetId: string
  /** marché émetteur — le lot en texte reste pour l'affichage et pour les
   *  documents reçus avant la signature du marché */
  marcheId?: string | null
  lot: string
  /** le document lui-même (ex. « Plans EXE R+1 — indice B ») */
  document: string
  recuLe: string // ISO 'AAAA-MM-JJ'
  /** délai contractuel de visa du CCAP, en jours CALENDAIRES — pré-rempli
   *  par le défaut du projet (`Projet.delaiVisaJours`), ajustable visa par
   *  visa : un CCAP peut prévoir un délai propre à certains documents */
  delaiJours: number
  statut: StatutVisa
  /** date du geste (visé / visé avec observations / refusé) */
  viseLe?: string | null
  /** qui a visé — la responsabilité se signe, comme la décision de pénalité */
  visePar?: string | null
  /** observations du visa, ou motif du refus */
  observations?: string
  /** lien au registre documentaire, quand le document y est classé */
  documentId?: string | null
}

/** 5.9 — statuts d'un désordre signalé pendant l'année de parfait
 *  achèvement (CCAG Travaux art. 44.1). « Contesté » reste OUVERT : une
 *  contestation ne lève rien — seule la levée constatée ferme le désordre. */
export type StatutDesordreGPA = 'signale' | 'notifie_entreprise' | 'leve' | 'conteste'

/** 5.9 — une relance tracée sur un désordre : quand, et par quel canal.
 *  `mode` en texte libre court (e-mail, téléphone, courrier RAR…) — c'est
 *  la chronologie qui compte le jour de la mise en demeure, pas une
 *  taxonomie de canaux. */
export interface RelanceDesordre {
  date: string // ISO 'AAAA-MM-JJ'
  mode: string
}

/** 5.9 — un désordre signalé pendant l'année de parfait achèvement.
 *  Le registre CONSTATE et trace (signalement, notification, relances,
 *  levée) : c'est cette chronologie datée qui rend la mise en demeure
 *  opposable avant la fin de GPA — après, il est trop tard. */
export interface DesordreGPA {
  id: string
  projetId: string
  /** marché concerné — le lot en texte reste pour l'affichage et pour un
   *  désordre dont l'entreprise n'est pas encore identifiée */
  marcheId?: string | null
  lot?: string
  signaleLe: string // ISO 'AAAA-MM-JJ'
  /** qui a signalé (MOA, occupant, visite MOE…) */
  signalePar?: string
  description: string
  statut: StatutDesordreGPA
  /** date de notification à l'entreprise (le point de départ de son délai) */
  notifieLe?: string | null
  /** date de levée constatée */
  leveLe?: string | null
  relances: RelanceDesordre[]
}

/** 5.10 — nature d'un partenaire de maîtrise d'œuvre (chaîne d'honoraires
 *  ENTRANTE : c'est lui qui facture l'agence, pas l'inverse) */
export type TypeCotraitant = 'bet' | 'agence' | 'autre'

/** 5.10 — cotraitant ou sous-traitant de maîtrise d'œuvre d'un projet (BET,
 *  autre agence). Porte le CONVENU (honoraires de la convention de
 *  groupement) ; le RÉEL se lit dans ses notes d'honoraires mensuelles
 *  (`NoteHonoraires`) — les deux chiffres s'affichent face à face, jamais
 *  confondus : le budget externe des phases (`Phase.coutExterneHT`) reste la
 *  base de la marge (audit 5.14 : on n'étend pas un calcul tout juste
 *  vérifié, on met le réel à côté). */
export interface Cotraitant {
  id: string
  projetId: string
  nom: string
  type: TypeCotraitant
  /** mission confiée (structure, fluides, économie, OPC…) */
  mission: string
  /** honoraires convenus HT (convention de groupement / contrat) —
   *  null = pas encore contractualisé : le reste à payer répond alors null,
   *  jamais 0, un « 0 € restant » affirmerait qu'un contrat a été lu */
  honorairesConvenusHT: number | null
  email?: string
  notes?: string
  /** mission en cours : seuls les cotraitants actifs attendent une note
   *  chaque mois — relancer une mission terminée serait du bruit */
  actif: boolean
}

/** 5.10 — note d'honoraires MENSUELLE d'un cotraitant : une attendue par
 *  mois actif. La note peut être consignée avant réception (`recueLe` null =
 *  attendue, elle compte manquante) ; `reglee` suit le paiement, pas la
 *  réception — une note reçue non payée n'est pas une note manquante. */
export interface NoteHonoraires {
  id: string
  cotraitantId: string
  projetId: string
  /** mois de la prestation ('AAAA-MM') */
  mois: string
  montantHT: number | null
  /** date de réception effective — null tant que la note n'est pas arrivée */
  recueLe: string | null
  reglee: boolean
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
  /** 5.6 — avancement constaté en réunion de chantier (0–100 %). Absent =
   *  jamais saisi : `avancementTache` (src/chantier.ts) retombe alors sur le
   *  statut — c'est LA saisie que la vérification des situations (5.5) lit,
   *  elle se fait une fois, au chantier, et sert deux fois */
  avancement?: number
  /** 5.6 — tâche d'origine quand celle-ci est une intervention de reprise
   *  (« faire revenir l'entreprise ») : dupliquer en gardant le lien évite de
   *  ressaisir la ligne ET garde la trace de ce qui a dû être refait */
  repriseDeId?: string | null
  /** 5.7 — date à laquelle l'entreprise a confirmé sa venue. Absent/null =
   *  pas confirmé : à l'approche de `debut` (SEUIL_CONFIRMATION_JOURS,
   *  src/chantier.ts), l'alerte « entreprise à confirmer » se lève — une
   *  entreprise qui découvre sa date deux semaines avant ne vient pas */
  confirmeLe?: string | null
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
  /** B1 — copie FIGÉE du décompte, prise AU MOMENT DE LA VALIDATION. Absente
   *  tant que la situation n'est pas validée, et absente sur les situations
   *  validées AVANT B1 : le PDF le DIT au lieu de faire croire à une pièce
   *  stable (voir DecompteFige). Elle disparaît si la situation repasse « à
   *  vérifier » — un décompte figé qui ne correspond plus à rien est pire
   *  qu'aucun décompte. */
  decompteFige?: DecompteFige
}

/** B1 — en-tête FIGÉ du décompte de situation : ce que le papier remis à
 *  l'entreprise NOMMAIT au moment de la validation. Même raison d'être que
 *  EnteteCertificat : réimprimer dans deux ans doit redonner l'agence, le
 *  chantier et le marché D'ALORS — renommer l'agence ou saisir un avenant
 *  ne doit pas réécrire un papier déjà parti. */
export interface EnteteDecompte {
  /** l'agence telle qu'elle se nommait — le papier porte sa signature */
  agence: { nom: string; personnes: string[]; siret?: string }
  /** l'opération, déjà libellée par `nomProjet` (une seule autorité) */
  projetLibelle: string
  projetAdresse?: string
  entreprise: string
  lot?: string
  mois: string // 'AAAA-MM'
  /** n° de situation — `null` quand l'entreprise n'en donne pas : « null n'est pas 0 » */
  numero: number | null
  dateReception: string // ISO
  /** montant du marché avenants compris au jour de la validation — `null`
   *  quand la situation n'est rattachée à AUCUN marché : le papier dit alors
   *  qu'il ne retient rien parce qu'il n'y a pas de marché, pas parce que le
   *  marché vaudrait 0 € */
  marcheTotalHT: number | null
  /** marché révisable — dit pourquoi une ligne de révision peut exister */
  marcheRevisable: boolean
}

/** B1 — les lignes RETENUES du décompte au moment de la validation. Mêmes
 *  rubriques que `DecompteSituation` (src/derive.ts, la SEULE autorité du
 *  calcul) : ce bloc n'est pas un second calcul, c'en est la PHOTO. */
export interface LignesDecompte {
  travauxCumulHT: number
  revisionHT: number
  /** travaux + révision */
  baseHT: number
  /** taux EFFECTIF appliqué (0 dès qu'une caution ou une GPD couvrait le marché) */
  tauxRG: number
  /** type de garantie au jour de la validation — dit POURQUOI le taux vaut ce qu'il vaut */
  garantie: TypeGarantie
  retenueGarantieHT: number
  /** base − retenue */
  cumulNetHT: number
  /** cumul net des situations antérieures, déjà réglé */
  precedentNetHT: number
  netAPayerHT: number
  tauxTVA: number
  netAPayerTTC: number
}

/** B1 — copie FIGÉE du décompte de situation (constat S6, lot B).
 *
 *  Trois pièces se ressemblent à l'écran : la facture, le certificat de
 *  paiement et ce décompte. Les deux premières se réimprimaient depuis leur
 *  copie figée ; celui-ci se RECALCULAIT depuis l'état courant — l'entreprise
 *  recevait un décompte le 3 juillet, l'agence saisissait un avenant le 10,
 *  réimprimait le 12 pour classer, et rangeait un papier qui ne portait plus
 *  les mêmes chiffres que celui qui avait été envoyé.
 *
 *  Le bloc se pose À LA VALIDATION (src/decompte.ts, `figerDecompte`), jamais
 *  à l'impression : ce qui fait foi est l'état validé, pas l'état de la
 *  première impression — sinon deux personnes qui impriment le même jour
 *  figeraient deux vérités. Le PDF ne lit ensuite QUE ce bloc. */
export interface DecompteFige {
  entete: EnteteDecompte
  /** les lignes retenues — ce que le papier envoyé portait */
  lignes: LignesDecompte
  /** points à vérifier relevés au figeage : le papier envoyé les portait,
   *  les taire à la réimpression donnerait un document plus propre que
   *  l'original */
  coherences: string[]
  /** date du FIGEAGE = date de la validation (jamais celle de l'impression) */
  figeLe: string // ISO
  /** qui a validé — `null` quand le poste ne sait pas qui est là (`useMoi()`,
   *  §identité) : un décompte ne se signe pas au nom du premier de la liste */
  validePar: string | null
  /** empreinte SHA-256 du bloc (audit, comme FactureFigee) — absente ou vide
   *  si l'API crypto manque : une empreinte inventée ne prouverait rien */
  empreinte?: string
}

/** 5.19 — les lignes d'un certificat de paiement (état d'acompte), toutes
 *  les rubriques A-E du document réel, en euros arrondis au centime. Cette
 *  forme est celle qui se FIGE à l'émission : chaque valeur y est la valeur
 *  RETENUE (proposition machine ou correction humaine — le document imprimé
 *  ne dit pas la différence, et c'est voulu : c'est l'architecte qui signe). */
export interface LignesCertificat {
  // -- le marché --
  baseHT: number
  avenantsHT: number
  totalMarcheHT: number
  // -- avance forfaitaire (CCAG art. 13) --
  avanceInitialeHT: number
  /** avance versée AU PRÉSENT ÉTAT (0 en général : l'avance se mandate à la
   *  notification, hors état mensuel — proposée à 0, corrigeable) */
  avanceVerseePresentHT: number
  avanceRembourseeAnterieureHT: number
  /** résorption du présent état (proposée par la règle CCAG 65 % → 80 %) */
  resorptionHT: number
  avanceRembourseeTotaleHT: number
  avanceResteHT: number
  // -- A. acompte en prix de base --
  cumulHT: number
  anterieurHT: number
  /** acompte du présent état = cumulé − antérieur */
  acompteHT: number
  // -- B. révision de prix --
  revisionHT: number
  revisionAnterieureHT: number
  revisionOrigineHT: number
  // -- C. TVA (présent état, puis cumuls depuis l'origine) --
  tauxTVA: number
  tvaAvanceHT: number
  tvaAcompteHT: number
  tvaRevisionHT: number
  tvaAvanceCumulHT: number
  tvaAcompteCumulHT: number
  tvaRevisionCumulHT: number
  /** total TTC du présent état, avant pénalités et retenue */
  totalTTC: number
  /** acomptes TTC cumulés depuis l'origine (avance comprise, résorptions déduites) */
  acompteTTCCumul: number
  // -- D. pénalités appliquées (5.2) à déduire — hors champ TVA --
  penalitesHT: number
  // -- E. retenue de garantie (0 si caution/GPD couvre le marché) --
  retenueGarantieTTC: number
  /** net à payer TTC du présent état */
  netAPayerTTC: number
  /** reste à exécuter HT (marché avenants compris − cumulé) */
  resteHT: number
}

/** 5.19 — en-tête FIGÉ du certificat : le document réimprimé dans deux ans
 *  doit porter le nom du MO et de l'agence D'ALORS, pas ceux d'aujourd'hui
 *  (même règle que FactureFigee, audit F0) */
export interface EnteteCertificat {
  /** n° d'engagement / marché (numeroEngagement du projet) */
  marcheNumero: string
  objet: string
  lot: string
  moa: string
  titulaire: string
  /** type de garantie au moment de l'émission — dit POURQUOI la ligne E vaut ce qu'elle vaut */
  garantie: TypeGarantie
  agence: { nom: string; adresse?: string; siret?: string }
}

/** 5.19 — certificat de paiement ÉMIS vers le maître d'ouvrage, depuis une
 *  situation validée. Un certificat émis est FIGÉ (comme FactureFigee) : le
 *  recalculer plus tard avec d'autres indices ou un autre cumul changerait
 *  un document déjà signé et transmis. La réouverture est une RÉIMPRESSION. */
export interface CertificatPaiement {
  id: string
  marcheId: string
  projetId: string
  situationId: string
  numero: number
  mois: string // 'AAAA-MM'
  entete: EnteteCertificat
  /** toutes les rubriques A-E, valeurs retenues, figées à l'émission */
  lignes: LignesCertificat
  /** copie de lignes.netAPayerTTC — le chiffre des listes, sans déplier */
  netAPayerTTC: number
  emisLe: string // ISO
  emisPar: string
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

/** Ventilation fiscale figée par taux. Elle devient indispensable lorsqu'un
 * centime d'arrondi d'un avoir final ne peut pas être retrouvé depuis ses
 * seules bases HT (notamment après plusieurs avoirs partiels). */
export interface VentilationTVAFigee {
  tauxTVA: number
  baseHT: number
  montantTVA: number
  montantTTC: number
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
  /** vérité fiscale par taux ; optionnelle pour les anciennes pièces */
  ventilationTVA?: VentilationTVAFigee[]
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
  /** contrat récurrent : ancrage sur la PREMIÈRE échéance réelle et arrêt à
   *  la date de fin — la prévision ne décaisse ni avant ni après (F6) */
  premiereEcheance?: string | null
  dateFin?: string | null
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
  /** paiement saisi HORS banque (à la main) : « à confirmer » tant qu'un
   *  rapprochement bancaire n'en apporte pas la preuve (F6) */
  paiementAConfirmer?: boolean
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

/** déclaration de TVA d'un mois échu, marquée par un GESTE humain (§15) :
 *  le solde (collectée − déductible) est FIGÉ au moment du geste — le
 *  « dû à l'État » de src/tva.ts ne recompte plus ce mois, même si une
 *  pièce bouge ensuite. L'écart éventuel se VOIT alors face au solde
 *  recalculé (CarteTVA) au lieu de déplacer en silence un montant déjà
 *  déclaré au SIE. */
export interface TvaDeclaration {
  id: string
  /** mois déclaré, 'AAAA-MM' */
  mois: string
  /** solde figé au moment du geste (euros — négatif : crédit de TVA) */
  montant: number
  declareLe: string // ISO
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

// --- Connexion bancaire directe (GoCardless Bank Account Data, lecture seule) ---
//
// CE QUI VIT ICI, ET CE QUI N'Y VIT PAS
// --------------------------------------
// L'AUTORITÉ est la table `banque_connexions` (Supabase, `service_role`
// seul) : c'est elle qui tient la demande, l'accord et les identifiants de
// compte GoCardless. Ce qui suit en est un MIROIR daté, rapatrié par la
// fonction Edge `banque-sync` — de quoi afficher un état et produire une
// alerte SANS réseau, puisque le fil d'urgences (`src/alerts.ts`) est pur et
// que le Cockpit doit rester lisible hors ligne.
//
// Aucun identifiant d'API tiers n'entre ici : ni secret GoCardless, ni jeton,
// ni identifiant de compte GoCardless. Un compte se désigne par
// l'identifiant de NOTRE ligne, et se reconnaît à quatre chiffres d'IBAN.
export interface CompteBancaireConnecte {
  /** identifiant de la ligne `banque_comptes` — jamais l'identifiant GoCardless */
  id: string
  libelle: string | null
  /** quatre derniers caractères de l'IBAN, précédés d'une ellipse */
  ibanMasque: string | null
  devise: string | null
  /** DISCOVERED · PROCESSING · READY · ERROR · EXPIRED · SUSPENDED */
  statut: string | null
  /** dernier solde relevé — `null` quand la banque n'en publie aucun
   *  d'exploitable. `null` n'est pas 0, et l'écran le dit. */
  dernierSolde: number | null
  /** `closingBooked`, `interimAvailable`… — le type FAIT partie du solde :
   *  un disponible et un comptable ne se comparent pas */
  dernierSoldeType: string | null
  dernierSoldeDate: string | null
  /** les types de solde que CETTE banque publie réellement, relevés au fil
   *  des synchronisations : ils ne se devinent pas d'un établissement à l'autre */
  typesSoldeVus: string[]
}

export interface ConnexionBancaire {
  /** identifiant de la ligne `banque_connexions` */
  id: string
  /** nom lisible de l'établissement */
  banque: string
  /** en_attente (parcours banque non terminé) · liee · expiree · erreur */
  statut: 'en_attente' | 'liee' | 'expiree' | 'erreur'
  /** statut brut de GoCardless (CR ID GC UA RJ SA GA LN SU ER EX), conservé
   *  tel quel pour le diagnostic — on ne le traduit pas de force */
  statutGocardless: string | null
  /** durée d'accès accordée, en jours (90 en pratique — DSP2) */
  accesJours: number | null
  consentementAccepteLe: string | null
  /** ISO — fin de l'accès continu. `null` = inconnue, jamais « lointaine ». */
  consentementExpireLe: string | null
  /** dernière synchronisation RÉELLEMENT INTÉGRÉE au Cockpit ('AAAA-MM-JJ').
   *  `null` veut dire « jamais » : une synchronisation morte depuis trois
   *  semaines doit se voir, pas se deviner. */
  derniereSyncLe: string | null
  derniereSyncResultat: string | null
  /** date à laquelle ce miroir a été rafraîchi depuis le serveur */
  vuLe: string
  comptes: CompteBancaireConnecte[]
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
  /**
   * Le code du portail, TEL QU'IL L'A ÉCRIT (`REJETEE`, `SUSPENDUE`,
   * `MISE_EN_PAIEMENT`…). Optionnel : une saisie manuelle et l'import CSV n'en
   * portent pas, et rien ne dépend de sa présence.
   *
   * POURQUOI CE CHAMP EXISTE. Chorus Pro déclare une quinzaine de statuts
   * quand `statut` ci-dessus en compte cinq — liste FERMÉE qui pilote le badge
   * rouge, l'action « à traiter » et l'alerte du fil d'urgences. Quatre codes
   * non nominaux (`REJETEE`, `SUSPENDUE`, `A_RECYCLER`, `A_COMPLETER`) se
   * projettent donc sur « rejetée » : pour l'agence, ils ont la même
   * conséquence — la facture est revenue et ne sera pas payée. Ce qui serait
   * malhonnête, c'est d'AFFICHER « rejetée » quand le portail a dit
   * « suspendue » : le code exact voyage ici, et c'est LUI que l'écran et
   * l'alerte prononcent. La liste fermée décide du comportement, le mot du
   * portail décide des mots (`src/chorusApi.ts`).
   */
  statutPortail?: string
}

/**
 * Une facture VUE SUR CHORUS PRO dont le numéro ne correspond à aucune facture
 * du Cockpit (§ le rattachement se fait par numéro, comme l'import CSV).
 *
 * Elle est SIGNALÉE, jamais rattachée « au plus proche ». Un rapprochement
 * approximatif écrirait un rejet sur la facture du voisin, se propagerait à
 * toute la pièce et ne se verrait jamais ; un rattachement absent coûte un
 * clic. Les causes légitimes sont nombreuses : facture déposée hors Cockpit,
 * numéro saisi autrement sur le portail, pièce d'un cotraitant, ou lecture de
 * l'environnement de QUALIFICATION (jeu de données de l'AIFE).
 */
export interface FactureChorusInconnue {
  /** le numéro tel que le portail l'écrit — la clé qui n'a rien trouvé */
  numero: string
  /** identifiant interne Chorus, pour retrouver la pièce sur le portail */
  idFacture?: string | null
  /** code de statut du portail, tel quel */
  statutPortail: string
  dateStatut?: string | null
  destinataire?: string | null
  montantTTC?: number | null
  /** `null` veut dire « le portail n'a pas rendu de motif », jamais « aucun » */
  motif?: string | null
  /** date à laquelle la synchronisation l'a vue pour la dernière fois */
  vueLe: string
}

// ============================================================
// Finance F6-F10 — pilotage unique. Le moteur src/economie.ts
// compose contrats/temps/achats/banque/pièces/consultations ;
// ces cinq collections ne stockent QUE des décisions humaines —
// jamais une détection promue seule en engagement contractuel
// ni en facture légale.
// ============================================================

/** F6 — reste à faire révisé par phase : base de la marge FINALE
 *  (honoraires signés − réel − reste à faire), révision humaine */
export interface RevisionResteAFaire {
  id: string
  projetId: string
  phase: PhaseCode
  heuresRestantes?: number | null
  coutExterneRestantHT?: number | null
  majLe: string // ISO
  par?: string
  notes?: string
}

/** F7 — demande hors-périmètre repérée dans un courrier / CR / journal,
 *  promue À LA MAIN au pipeline. Ce n'est qu'à la confirmation de l'avenant
 *  SIGNÉ qu'une ligne active est ajoutée au contrat. */
export type StatutPisteAvenant = 'au_pipeline' | 'chiffree' | 'confirmee' | 'ecartee'

export interface PisteAvenant {
  id: string
  projetId?: string | null
  contratId?: string | null
  /** extrait qui a déclenché la piste (courrier, CR, note de journal) */
  origine: string
  origineType?: 'courrier' | 'cr' | 'journal' | 'manuel'
  libelle: string
  montantEstimeHT?: number | null
  statut: StatutPisteAvenant
  /** avenant créé quand la piste est confirmée signée */
  avenantId?: string | null
  creeLe: string // ISO
  notes?: string
}

/** F8 — décision de direction (responsable, échéance, statut) */
export type StatutDecision = 'a_faire' | 'en_cours' | 'faite'

export interface DecisionDirection {
  id: string
  sujet: string
  responsable?: string
  echeance?: string | null
  statut: StatutDecision
  origine?: string
  creeLe: string // ISO
  faiteLe?: string | null
}

/** F9 — simulation de projet sauvegardable (aide à la décision, jamais
 *  versée dans les projets réels) */
export interface SimulationProjet {
  id: string
  nom: string
  honorairesHT: number
  /** probabilité de signature (0..1) */
  probabilite: number
  /** délai d'encaissement estimé (jours) */
  delaiEncaissementJours: number
  heures: number
  coutsExternesHT: number
  /** embauche simulée : coût mensuel chargé à partir d'un mois */
  embauche?: { moisApres: number; coutMensuel: number } | null
  /** investissement ponctuel simulé */
  investissement?: { moisApres: number; montant: number } | null
  creeLe: string // ISO
}

/** F10 — connecteur direct : URL de passerelle SERVEUR HTTPS + healthcheck.
 *  Aucun secret n'est stocké dans le navigateur ni dans AppState. */
export type TypeConnecteur = 'banque' | 'mail' | 'drive' | 'cabinet' | 'chorus' | 'pdp'

export interface Connecteur {
  id: string
  type: TypeConnecteur
  libelle: string
  /** URL HTTPS de la passerelle serveur — jamais de secret ici */
  urlPasserelle?: string
  actif?: boolean
  dernierHealthcheck?: { date: string; ok: boolean; detail?: string } | null
}

/** M.3 — chrono en cours. Une entrée par personne : c'est la règle que la
 *  clé primaire de `chrono_actif` tient en base, et que l'état local doit
 *  tenir seul tant que la synchronisation des pointages n'est pas branchée. */
/** Miroir local de `public.pointages` (B.4). Les noms suivent le TypeScript
 *  du dépôt ; la correspondance avec les colonnes SQL se fait à l'envoi. */
export interface PointageLocal {
  id: string
  personne: string
  debut: string
  fin: string | null
  minutes: number
  projetId: string | null
  phase: PhaseCode | null
  tacheId: string | null
  activite: string
  commentaire: string
  facturable: boolean
  validee: boolean
  source: string
  creeLe: string
  majLe: string
}

export interface ChronoEnCours {
  personne: string
  debut: string
  projetId: string | null
  phase: PhaseCode | null
  tacheId: string | null
  activite: string
  commentaire: string
  libelle: string
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
  /** adresse de connexion de la personne — le pont entre un compte
   *  (session Supabase) et la personne référencée par son nom dans tout
   *  l'état. Optionnelle : le Cockpit s'utilise hors ligne et sans session,
   *  et l'agence n'a pas encore son domaine. Comparée sans tenir compte de
   *  la casse (voir `normaliserEmail` dans src/moi.ts). */
  email?: string
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
  /** B.14 — une personne partie est DÉSACTIVÉE, jamais supprimée. Son nom
   *  reste référencé par les pointages, les heures, les notes de journal et
   *  les documents déposés : l'effacer orphelinerait tout cela, ce que
   *  `src/personnes.ts` existe pour empêcher. `undefined` vaut « active » —
   *  les états antérieurs à B.14 n'ont pas le champ. */
  actif?: boolean
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
  /** 5.11 — ordre d'appel : 1 = à appeler d'abord, null/absent = pas classé
   *  (affiché en fin de liste). Le rang suit le CONTACT, pas le projet — un
   *  contact partagé entre deux projets garde le même rang partout : c'est
   *  le prix d'un champ simple, assumé pour une agence de deux personnes
   *  dont les contacts sont presque tous propres à un projet. */
  ordreAppel?: number | null
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
  // 5.7 — tâche de chantier démarrant sous ~30 jours sans confirmation de
  // l'entreprise : le mode de retard le plus courant, et le plus prévisible
  | 'entreprise_a_confirmer'
  // 5.8 — document d'exécution non visé à J−3 de l'échéance du CCAP : un
  // visa en retard engage la responsabilité de la MOE
  | 'visa_a_rendre'
  // 5.10 — note d'honoraires de cotraitance attendue et non reçue pour un
  // mois échu : sans elle, le réel de la chaîne entrante s'écarte du convenu
  // sans que personne ne le voie avant le bilan
  | 'note_honoraires_manquante'
  // A.11 — les trois producteurs de la mémoire des échanges (§12.3 pt 10).
  // Ils ne sortent rien de l'application : ni e-mail, ni notification
  // poussée. Notifier, ici, c'est faire apparaître dans le fil de la
  // personne concernée (divergence déclarée, plan §3.15).
  | 'mail_a_traiter'
  | 'reponse_attendue'
  | 'proposition_ia'
  // Connexion bancaire directe — les deux façons dont une trésorerie se fige
  // en silence, et qui doivent donc se voir AVANT :
  //   · le consentement DSP2 arrive à échéance (90 jours) et il faut
  //     retourner s'authentifier chez sa banque ;
  //   · plus aucune synchronisation n'aboutit depuis des jours, sans erreur
  //     visible — le cas le plus traître, parce qu'un écran muet ressemble à
  //     un écran calme.
  | 'banque_consentement'
  | 'banque_sync_muette'
  // 5.16 — facture rejetée par le portail (Chorus Pro, plateforme agréée).
  // Ce n'est pas un retard qui finira par se résorber : une facture rejetée
  // ne sera JAMAIS payée tant que personne ne la corrige et ne la redépose.
  // Le motif voyage avec l'alerte — sans lui, il faut rouvrir le portail
  // pour savoir quoi corriger, et le geste se remet à demain.
  | 'facture_rejetee_portail'

/** Alerte du fil d'urgences — calculée, jamais stockée (hors snooze) */
/** action rapide attachée à une alerte, réalisable depuis le fil */
export type ActionAlerte =
  | { kind: 'emettre_facture'; refId: string; label: string }
  | { kind: 'valider_situation'; refId: string; label: string }
  | { kind: 'obligation_faite'; refId: string; label: string }
  // 5.7 — pose `confirmeLe` sur la tâche de chantier : l'humain confirme,
  // l'alerte s'éteint d'elle-même au recalcul
  | { kind: 'confirmer_tache'; refId: string; label: string }
  // 5.23 — pose `confirmeLe` sur UNE PÉRIODE d'intervention du marché
  // (`refId` = le marché, `periodeId` = la période, comme `mois` accompagne
  // `relancer_cotraitant` : la confirmation vise UN passage, pas le lot).
  //
  // Elle existe parce que la question se repose à chaque retour de
  // l'entreprise : celle de février est confirmée et tout le monde l'a en
  // tête ; celle de juin, personne n'y pense avant de la voir manquer. Le
  // producteur de l'alerte est `periodesAConfirmer` (src/planningTravaux.ts)
  // — même seuil (`SEUIL_CONFIRMATION_JOURS`, src/chantier.ts) que la
  // confirmation des tâches, importé et non recopié.
  | { kind: 'confirmer_periode'; refId: string; periodeId: string; label: string }
  // 5.10 — ouvre un BROUILLON Gmail de relance (gmailComposeUrl) pour la
  // note d'honoraires du mois manquant : n'écrit rien dans l'état, n'envoie
  // rien (§15) — `mois` accompagne refId parce que la relance vise UN mois,
  // pas le cotraitant en général
  | { kind: 'relancer_cotraitant'; refId: string; mois: string; label: string }

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
  /** à qui elle s'adresse — vide = à l'agence. Le fil se filtre dessus,
   *  il ne se scinde pas : une alerte non attribuée reste visible de tous. */
  pour?: string
  /** le projet concerné, quand il y en a un : permet de rassembler le fil
   *  d'un projet sans redécouper chaque titre à la recherche d'un code */
  projetId?: string
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
  /** dernière synchronisation Chorus Pro INTÉGRÉE au Cockpit — la trace vit
   *  ici (donc dans l'état partagé, donc lisible hors ligne et sur les deux
   *  postes) et non seulement dans le journal serveur. `environnement` en fait
   *  partie : lire la qualification en croyant lire la structure est le
   *  contresens que ce mot rend impossible à commettre en silence. */
  chorusSync?: { le: string; environnement: string; resultat: string } | null
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
  /** régime d'exigibilité de la TVA collectée pour la POSITION CALCULÉE
   *  (src/tva.ts) : 'encaissements' — droit commun des prestations de
   *  services, la TVA d'un paiement reçu devient due — ou 'debits' (option
   *  formulée au SIE : la TVA naît à l'ÉMISSION de la facture). Défaut
   *  'encaissements' ; à valider avec le cabinet
   *  (docs/QUESTIONS_CABINET_TVA.md). Distinct de `mentionTVA` (la phrase
   *  IMPRIMÉE sur les pièces) et de `profilComptable.regimeTVA` (champ libre
   *  de mémoire) : celui-ci pilote un CALCUL, pas un texte. */
  regimeTVA?: 'encaissements' | 'debits'
  /** alerteId → ISO « en sommeil jusqu'au » */
  snoozes: Record<string, string>
  /** jumeau de `snoozes` : identifiant d'alerte → date où on l'a VUE.
   *  Mettre en sommeil, c'est dire « pas maintenant » ; marquer vu, c'est
   *  dire « j'ai lu ». Confondre les deux ferait réapparaître ce qu'on a
   *  lu, ou disparaître ce qu'on a seulement reporté. */
  vus: Record<string, string>
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
  /** corrections de rattachement mémorisées (CDC §5.1 pt 5, livrable A.4) :
   *  adresse ou domaine → projet. Elles vivent dans les réglages PARTAGÉS,
   *  et pas dans une table : l'ingestion serveur lit déjà `workspace.data`,
   *  donc les deux moteurs apprennent de la même correction sans qu'on
   *  ouvre une seconde source. Une règle PROPOSE (`projet_id_propose`) ;
   *  elle ne signe jamais à la place d'un humain. Le type vit dans
   *  `supabase/functions/_shared/rattachement.ts`, avec la cascade qui
   *  l'applique — il doit rester lisible du Deno de l'ingestion. */
  reglesRattachement?: RegleRattachement[]
  /** critères de la veille BOAMP intégrée (API DILA gratuite) */
  veilleBoamp?: {
    motsCles: string
    departements: string
    typeMarche: string
    depuisJours: number
  }
  /** dernier import par routine (« situations », « consultations », « courriers ») → date ISO */
  derniersImports?: Record<string, string>
  /** 5.18 — dernière récupération RÉUSSIE des indices INSEE (horodatage ISO).
   *  C'est l'anti-marteau : au plus un appel par 24 h
   *  (src/indicesInsee.ts, `doitRafraichirIndices`). Partagé entre les 2
   *  postes — l'un a récupéré, l'autre n'appelle pas. Jamais posé sur un
   *  échec : le prochain démarrage doit pouvoir réessayer. */
  indicesMajLe?: string | null
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
  /** identifiant du fichier côté Google Drive (Lot 4) — distinct de
   *  `sourceId`, qui garde l'identifiant de la source d'ORIGINE (pièce
   *  jointe Gmail…) : les deux traces coexistent (CDC §7.3) */
  driveFileId?: string
  /** catégorie contrôlée (CCTP, DPGF, CR, SITU, PLAN, ADM, PHOTO…) */
  categorie: string
  sousType?: string
  /** phase de la mission à laquelle le document se rattache (CDC §7.3).
   *  Même référentiel que `Phase.code` — aucune nomenclature nouvelle : le
   *  sous-dossier du Drive en porte déjà la correspondance
   *  (`ARBORESCENCE[].phases`, src/fsdrive.ts), qui sert de proposition. */
  phase?: PhaseCode | null
  /** qui a déposé / produit le document (nom d'un membre de l'équipe).
   *  Distinct de `validePar` (qui a contrôlé le classement) et de
   *  l'auteur des `evenements` (qui a fait ce geste-là). */
  auteur?: string
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
  /** C3 — points de séance : l'ordre du jour qui TRAVERSE les réunions.
   *  Rattachés au projet, jamais à une réunion (voir `PointSeance`) : c'est
   *  ce qui fait qu'une séance repart du relevé précédent au lieu d'une
   *  page blanche, et que « ce point traîne depuis trois séances » se lit
   *  au lieu de se deviner. */
  pointsSeance: PointSeance[]
  courriers: Courrier[]
  /** B.1 — les tâches internes du §8.5. Restent dans le document JSONB :
   *  le volume est borné et la fréquence d'écriture est HUMAINE (§3.1). */
  taches: TacheInterne[]
  /** M.3 — au plus un chrono par personne (cf. `poserChrono`) */
  chronos: ChronoEnCours[]
  /** M.3 — pointages produits par le chrono, EN LOCAL.
   *
   *  Le plan (§3.1) sort les pointages du document JSONB : leur place est la
   *  table relationnelle `pointages`, livrée par B.4 avec sa file d'envoi.
   *  Cette file n'est PAS branchée — B.4 a livré la table et la logique pure,
   *  jamais le chemin d'écriture depuis le navigateur.
   *
   *  Un chrono qui perdrait son temps au rechargement serait pire que pas de
   *  chrono : on ne s'aperçoit pas d'un temps qui n'a jamais été écrit. Cette
   *  collection est donc le magasin d'aujourd'hui et deviendra la CORBEILLE
   *  DE SORTIE le jour où la file sera branchée — les identifiants sont déjà
   *  des uuid générés ici, donc un rejeu est idempotent par la clé primaire. */
  pointages: PointageLocal[]
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
  /** miroir daté des connexions bancaires directes — l'autorité reste la
   *  table `banque_connexions` côté Supabase. Il est ici pour que le fil
   *  d'urgences puisse annoncer la reconnexion des 90 jours sans réseau. */
  connexionsBancaires: ConnexionBancaire[]
  /** 5.16 — factures vues sur Chorus Pro dont le numéro ne correspond à
   *  AUCUNE facture du Cockpit. Elles sont signalées ici, jamais rattachées
   *  au plus proche : c'est une liste à relire, pas une donnée métier. */
  chorusInconnues: FactureChorusInconnue[]
  /** lots d'export comptable versionnés (F4) */
  lotsComptables: LotComptable[]
  /** mois de TVA marqués « déclarée » — un geste humain fige le solde et
   *  sort le mois du « dû à l'État » calculé (src/tva.ts, §15) */
  tvaDeclarations: TvaDeclaration[]
  // --- Finance F6-F10 : pilotage unique ---
  /** reste à faire révisé par phase (base de la marge finale, F6) */
  revisionsResteAFaire: RevisionResteAFaire[]
  /** pistes d'avenant hors-périmètre (F7) — pipeline avant l'avenant signé */
  pistesAvenant: PisteAvenant[]
  /** décisions de direction (F8) */
  decisionsDirection: DecisionDirection[]
  /** simulations de projet sauvegardées (F9) */
  simulations: SimulationProjet[]
  /** connecteurs directs (F10) — passerelles serveur, sans secret */
  connecteurs: Connecteur[]
  /** 5.4 — valeurs mensuelles des indices de révision BTP : référentiel
   *  NATIONAL, transverse aux projets (une valeur BT01 sert tous les
   *  marchés qui citent cette série) — saisi en Paramètres */
  indicesBTP: IndiceBTP[]
  /** 5.2 — journal des événements de pénalité par marché : la machine
   *  calcule l'ENCOURU, l'humain décide l'application (§15) */
  evenementsMarche: EvenementMarche[]
  /** 5.3 — registre des intempéries par chantier : prolonge les délais et
   *  neutralise les retards de 5.2 — trace opposable pour le décompte général */
  intemperies: Intemperie[]
  /** 5.8 — registre des visas : documents d'exécution reçus en phase VISA,
   *  délai du CCAP, geste de visa daté et signé — la phase VISA existait
   *  partout (échéancier, catégorisation) sans qu'aucun registre ne suive
   *  ce qui est à viser */
  visas: Visa[]
  /** 5.9 — registre des désordres de l'année de parfait achèvement (GPA) :
   *  signalement, notification, relances tracées, levée. La fin de GPA se
   *  dérive de la réception du marché — UNE autorité, src/gpa.ts */
  desordresGPA: DesordreGPA[]
  /** 5.10 — partenaires de maîtrise d'œuvre (BET, agences) par projet :
   *  le CONVENU de la chaîne d'honoraires entrante */
  cotraitants: Cotraitant[]
  /** 5.10 — notes d'honoraires mensuelles des cotraitants : le RÉEL reçu,
   *  affiché FACE au convenu et au budget externe des phases — jamais versé
   *  dans le calcul de marge (audit 5.14) */
  notesHonoraires: NoteHonoraires[]
  /** 5.19 — certificats de paiement ÉMIS (états d'acompte vers le MO),
   *  figés à l'émission : la machine propose (src/certificat.ts), l'humain
   *  corrige et émet, le document ne se recalcule plus jamais */
  certificats: CertificatPaiement[]
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
