// ============================================================
// Référentiel de catégorisation des échanges — CDC §5.2.
//
// Trois axes fermés, et rien d'autre. Ce module ne classe pas, ne
// stocke rien, n'appelle aucun modèle : il DIT quelles valeurs
// existent, comment elles se nomment en français, et comment le
// niveau d'importance se projette sur l'échelle de gravité 1-3 déjà
// utilisée par `src/alerts.ts`. Le classifieur déterministe (vague A)
// et les contraintes CHECK de la table `communications` (A.2) se
// servent ICI : deux listes recopiées divergeraient au premier ajout,
// et l'écart ne se verrait qu'en base.
//
// Ce que ce module N'EST PAS :
//  - il ne remplace pas `PhaseCode` (src/types.ts) — voir plus bas ;
//  - il ne remplace pas `Courrier.type`, qui reste le texte d'origine
//    et donc la source re-dérivable de l'axe « type d'échange » ;
//  - il n'invente aucune valeur : ce qui n'est pas déductible reste
//    vide. Un axe faux coûte plus cher qu'un axe à choisir, parce
//    qu'un axe faux ne se voit pas.
// ============================================================

import type { PhaseCode } from './types'
import { LIBELLES_PHASES, PHASES_ORDRE } from './miqcp'
import { fold } from './util'

// ------------------------------------------------------------
// Axe 1 — phase du projet (CDC §5.2, 14 valeurs)
// ------------------------------------------------------------
//
// `PhaseCode` n'est PAS étendu, et ce n'est pas une commodité : il
// porte la chaîne d'honoraires (REPARTITION_PHASES et PHASES_ORDRE de
// src/miqcp.ts, les répartitions de src/echeancier.ts, la
// correspondance dossier ↔ phase de src/fsdrive.ts, et tous les
// projets de src/seed.ts). Y ajouter PROSPECTION, CONCOURS, DOE ou SAV
// — quatre phases sans montant ni pourcentage de mission — ferait
// entrer des phases fantômes dans l'échéancier de facturation.
//
// L'axe des échanges est donc un type SÉPARÉ, défini comme un superset
// STRUCTUREL : `PhaseCode | PhaseHorsMission`. Une phase ajoutée
// demain à la mission entre d'elle-même dans l'axe des échanges ; la
// réciproque est impossible, et c'est exactement ce qu'on veut.
//
// Deux divergences avec le vocabulaire du CDC, déclarées et assumées :
//  - la « Faisabilité » du CDC est le `DIAG` du dépôt (libellé
//    « Diagnostic ») — même phase, deux noms ;
//  - « DCE » et « ACT » du CDC sont le seul `ACT-DCE` du dépôt, qui les
//    facture ensemble. L'axe accepte les deux mots, la valeur stockée
//    reste unique : deux valeurs pour une phase facturée une fois
//    couperaient en deux les recherches par phase du §13.1.
// `MC` (missions complémentaires) reste, sans équivalent CDC.

/** les quatre phases d'échange qui ne sont pas des phases de mission */
export type PhaseHorsMission = 'PROSPECTION' | 'CONCOURS' | 'DOE' | 'SAV'

/** phase d'un échange — superset de `PhaseCode`, jamais l'inverse */
export type PhaseEchange = PhaseCode | PhaseHorsMission

/** dans l'ordre du CDC ; les phases de mission viennent de PHASES_ORDRE
 *  (source unique) — d'où `MC` juste après `AOR`, à sa place de liste et
 *  non à sa place chronologique */
export const PHASES_ECHANGE: PhaseEchange[] = ['PROSPECTION', 'CONCOURS', ...PHASES_ORDRE, 'DOE', 'SAV']

export const LIBELLES_PHASE_ECHANGE: Record<PhaseEchange, string> = {
  ...LIBELLES_PHASES,
  PROSPECTION: 'Prospection',
  CONCOURS: 'Concours',
  // les deux divergences déclarées portent le mot du CDC dans le libellé,
  // pour que l'écran ne laisse personne chercher une valeur qui n'existe pas
  DIAG: 'Faisabilité / diagnostic',
  'ACT-DCE': 'DCE / ACT — consultation des entreprises',
  DOE: 'DOE — dossier des ouvrages exécutés',
  SAV: 'SAV — année de parfait achèvement',
}

/** mots du CDC (et abréviations d'usage) → valeur stockée */
const ALIAS_PHASE_ECHANGE: Record<string, PhaseEchange> = {
  faisabilite: 'DIAG',
  diagnostic: 'DIAG',
  esquisse: 'ESQ',
  'avant-projet sommaire': 'APS',
  'avant-projet definitif': 'APD',
  projet: 'PRO',
  dce: 'ACT-DCE',
  act: 'ACT-DCE',
  'missions complementaires': 'MC',
  doe: 'DOE',
  sav: 'SAV',
}

/** vrai si cette phase d'échange est aussi une phase de la mission —
 *  seul cas où elle peut être rapprochée d'honoraires (src/miqcp.ts) */
export function estPhaseDeMission(phase: PhaseEchange): phase is PhaseCode {
  return (PHASES_ORDRE as string[]).includes(phase)
}

// ------------------------------------------------------------
// Axe 2 — type d'échange (CDC §5.2, 15 valeurs)
// ------------------------------------------------------------
//
// L'axe reprend `Courrier.type` (src/types.ts), qui est aujourd'hui du
// texte libre documenté « question / document / administratif /
// commercial / autre » et alimenté aussi par `src/surveillance.ts`
// (« mail reçu ») et par les retours de routine. Ce champ n'est ni
// supprimé ni contraint : il reste la trace de ce qui a été écrit, et
// donc la source dont l'axe se re-dérive.

export type TypeEchange =
  | 'client'
  | 'administration'
  | 'urbanisme'
  | 'bet'
  | 'bureau_de_controle'
  | 'csps'
  | 'entreprise'
  | 'fournisseur'
  | 'interne'
  | 'contractuel'
  | 'financier'
  | 'planning'
  | 'chantier'
  | 'reclamation'
  | 'validation'

export const TYPES_ECHANGE: TypeEchange[] = [
  'client',
  'administration',
  'urbanisme',
  'bet',
  'bureau_de_controle',
  'csps',
  'entreprise',
  'fournisseur',
  'interne',
  'contractuel',
  'financier',
  'planning',
  'chantier',
  'reclamation',
  'validation',
]

export const LIBELLES_TYPE_ECHANGE: Record<TypeEchange, string> = {
  client: 'Client',
  administration: 'Administration',
  urbanisme: 'Urbanisme',
  bet: 'BET',
  bureau_de_controle: 'Bureau de contrôle',
  csps: 'CSPS',
  entreprise: 'Entreprise',
  fournisseur: 'Fournisseur',
  interne: 'Interne',
  contractuel: 'Contractuel',
  financier: 'Financier',
  planning: 'Planning',
  chantier: 'Chantier',
  reclamation: 'Réclamation',
  validation: 'Validation',
}

/** anciens libellés de `Courrier.type` dont la traduction est CERTAINE.
 *  « question », « document », « autre » et « mail reçu » décrivent la
 *  FORME du message, pas son interlocuteur : rien à en tirer sur cet
 *  axe, ils restent vides. « commercial » n'est pas traduit non plus —
 *  il désigne aussi bien un client qu'un fournisseur en prospection,
 *  et deviner ici classerait durablement de travers. */
const TYPES_HISTORIQUES: Record<string, TypeEchange> = {
  administratif: 'administration',
  'controleur technique': 'bureau_de_controle',
  moa: 'client',
  sps: 'csps',
}

// ------------------------------------------------------------
// Axe 3 — niveau d'importance (CDC §5.2, 6 valeurs) et gravité
// ------------------------------------------------------------

export type NiveauImportance =
  | 'information'
  | 'a_traiter'
  | 'important'
  | 'urgent'
  | 'bloquant'
  | 'contractuel'

/** du plus faible au plus fort — l'ordre est significatif : la
 *  projection sur la gravité doit être croissante (jamais décroissante) */
export const NIVEAUX_IMPORTANCE: NiveauImportance[] = [
  'information',
  'a_traiter',
  'important',
  'urgent',
  'bloquant',
  'contractuel',
]

export const LIBELLES_IMPORTANCE: Record<NiveauImportance, string> = {
  information: 'Information',
  a_traiter: 'À traiter',
  important: 'Important',
  urgent: 'Urgent',
  bloquant: 'Bloquant',
  contractuel: 'Contractuel',
}

/** Projection sur l'échelle de gravité de `Alerte.gravite` (1-3, 3 = rouge).
 *
 *  Écrite en `Record` et non en `switch` volontairement : ajouter un
 *  septième niveau sans lui donner de gravité ne compile pas. Une
 *  gravité oubliée retomberait sinon sur un `default` silencieux, et le
 *  fil d'urgences classerait un bloquant avec les informations.
 *
 *  « contractuel » est en 3 : le contrat des modules tient le financier,
 *  le contractuel et le sortant pour ce qui ne se rattrape pas. */
const GRAVITES: Record<NiveauImportance, 1 | 2 | 3> = {
  information: 1,
  a_traiter: 1,
  important: 2,
  urgent: 3,
  bloquant: 3,
  contractuel: 3,
}

/** gravité 1-3 d'un niveau d'importance, dans l'échelle de src/alerts.ts */
export function graviteDe(niveau: NiveauImportance): 1 | 2 | 3 {
  return GRAVITES[niveau]
}

/** Vrai si la valeur est un niveau du référentiel. À utiliser sur tout ce
 *  qui vient de la base : `importance_effective` est un `text` contraint
 *  par un domaine, donc du texte pour TypeScript. Sans ce filtre, une
 *  comparaison sur une valeur mal orthographiée est simplement fausse,
 *  en silence. */
export function estImportance(valeur: unknown): valeur is NiveauImportance {
  return typeof valeur === 'string' && (NIVEAUX_IMPORTANCE as string[]).includes(valeur)
}

// ------------------------------------------------------------
// Normalisation — tolérante en entrée, fermée en sortie
// ------------------------------------------------------------

/** index { forme repliée → valeur } d'une liste fermée et de ses libellés */
function index<T extends string>(valeurs: T[], libelles: Record<T, string>): Map<string, T> {
  const m = new Map<string, T>()
  for (const v of valeurs) {
    m.set(fold(v), v)
    m.set(fold(v).replace(/_/g, ' '), v)
    m.set(fold(libelles[v]), v)
  }
  return m
}

const INDEX_PHASE = index(PHASES_ECHANGE, LIBELLES_PHASE_ECHANGE)
const INDEX_TYPE = index(TYPES_ECHANGE, LIBELLES_TYPE_ECHANGE)
const INDEX_IMPORTANCE = index(NIVEAUX_IMPORTANCE, LIBELLES_IMPORTANCE)

function chercher<T extends string>(
  brut: unknown,
  index: Map<string, T>,
  alias: Record<string, T> = {},
): T | null {
  if (typeof brut !== 'string') return null
  const cle = fold(brut)
  if (!cle) return null
  return index.get(cle) ?? alias[cle] ?? null
}

/** phase d'échange reconnue, sinon `null` (jamais une valeur approchée) */
export function normaliserPhaseEchange(brut: unknown): PhaseEchange | null {
  return chercher(brut, INDEX_PHASE, ALIAS_PHASE_ECHANGE)
}

/** type d'échange reconnu, sinon `null` — accepte les anciens libellés
 *  de `Courrier.type` dont la traduction est certaine */
export function normaliserTypeEchange(brut: unknown): TypeEchange | null {
  return chercher(brut, INDEX_TYPE, TYPES_HISTORIQUES)
}

/** niveau d'importance reconnu, sinon `null` */
export function normaliserImportance(brut: unknown): NiveauImportance | null {
  return chercher(brut, INDEX_IMPORTANCE)
}

/** Ancienne urgence 1-3 (`Courrier.urgence`) → niveau d'importance.
 *  Réciproque exacte de `graviteDe` : `graviteDe(importanceDepuisUrgence(u)) === u`.
 *  On ne remonte pas plus haut que ce que l'urgence disait — « bloquant »
 *  et « contractuel » sont des jugements que personne n'a portés. */
export function importanceDepuisUrgence(urgence: unknown): NiveauImportance | null {
  if (urgence === 1) return 'a_traiter'
  if (urgence === 2) return 'important'
  if (urgence === 3) return 'urgent'
  return null
}

// ------------------------------------------------------------
// Reprise d'un échange déjà stocké sur les trois axes
// ------------------------------------------------------------

/** les trois axes d'un échange (§5.2) — `null` = non renseigné, à choisir */
export interface AxesEchange {
  phaseEchange: PhaseEchange | null
  typeEchange: TypeEchange | null
  importance: NiveauImportance | null
}

/** un échange déjà stocké, vu par le référentiel. Les champs sont
 *  `unknown` à dessein : ils arrivent d'une sauvegarde locale ou d'un
 *  import JSON, où rien ne garantit le type annoncé. */
export interface SourceEchange {
  /** `Courrier.type` — texte libre historique, reste la source */
  type?: unknown
  /** `Courrier.urgence` — 1 à 3 */
  urgence?: unknown
  phaseEchange?: unknown
  typeEchange?: unknown
  importance?: unknown
}

/** Reprend un échange existant sur les trois axes.
 *
 *  Règle du coup unique : un axe ABSENT (`undefined`) est dérivé de ce
 *  qui existe déjà ; un axe PRÉSENT est seulement normalisé — `null`
 *  reste `null`. Sans cette distinction, un axe qu'une personne aurait
 *  délibérément vidé se remplirait à nouveau au rechargement suivant,
 *  et la correction humaine ne tiendrait pas une nuit.
 *
 *  La phase ne se dérive de rien : un courrier ne porte pas de phase, et
 *  un projet en a plusieurs qui se chevauchent. Elle reste à choisir. */
export function reprendreAxes(source: SourceEchange): AxesEchange {
  return {
    phaseEchange:
      source.phaseEchange === undefined ? null : normaliserPhaseEchange(source.phaseEchange),
    typeEchange:
      source.typeEchange === undefined
        ? normaliserTypeEchange(source.type)
        : normaliserTypeEchange(source.typeEchange),
    importance:
      source.importance === undefined
        ? importanceDepuisUrgence(source.urgence)
        : normaliserImportance(source.importance),
  }
}
