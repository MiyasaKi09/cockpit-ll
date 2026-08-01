// ============================================================
// B.1 — la collection `taches`, racine de la vague B.
//
// Ce module tient le RÉFÉRENTIEL de la tâche interne : ses neuf statuts
// (§8.6), ses quatre priorités, ses sept origines (§8.4), et les quelques
// fonctions pures que tout le reste de la vague consomme. Il ne rend rien
// et n'écrit rien : les écrans sont B.2 et B.8, la revue des propositions
// est B.10, le temps est B.4 à B.9.
//
// POURQUOI LA TÂCHE RESTE DANS LE DOCUMENT JSONB
// -----------------------------------------------
// Le §3.1 du plan a tranché contre l'une des analyses, et la raison tient
// en une phrase : ce qui tue le verrou compare-and-swap, c'est l'écriture
// MACHINE — le chrono qui tique à la seconde, l'ingestion qui écrit à la
// minute — pas quelques dizaines d'écritures humaines par jour. Une agence
// de deux personnes produit quelques centaines de tâches par an ; le
// hors-ligne et les vingt paliers de `migrate()` fonctionnent déjà, et on
// les gagne sans écrire une ligne de couche IndexedDB.
//
// Les seuils de sortie sont posés et se mesurent : document au-delà de
// 3 Mo, plus de 5 000 tâches, ou l'arrivée d'un troisième collaborateur
// avec un vrai besoin de droits par projet.
//
// CE QUI EST DÉLIBÉRÉMENT ABSENT
// ------------------------------
// `tempsEnregistre` n'est pas écrit ici. C'est une PROJECTION des
// pointages (B.9), et la calculer à deux endroits la ferait diverger de
// la marge — ce que le §7.3 tient pour le défaut le plus coûteux du
// dépôt. Ici, le champ existe et vaut 0 tant que B.4 n'est pas livré.
// ============================================================

import type { PhaseCode, Projet, TacheInterne } from './types'
import { todayISO } from './util'

// ------------------------------------------------------------
// 1. Les neuf statuts du §8.6
// ------------------------------------------------------------
//
// Neuf sont STOCKÉS, cinq seront exposés au menu de la fiche (B.8). Ce
// n'est pas une contradiction : « à qualifier » est l'état d'une tâche
// proposée non encore revue, « annulée » et « bloquée » se posent depuis
// des gestes précis. Un menu à neuf entrées se lit moins bien qu'un menu
// à cinq, mais un statut absent du modèle ne se rattrape pas.

export type StatutTache =
  | 'a_qualifier'
  | 'a_faire'
  | 'planifiee'
  | 'en_cours'
  | 'en_attente'
  | 'bloquee'
  | 'a_valider'
  | 'terminee'
  | 'annulee'

/** l'ordre est celui du cycle de vie, et il est significatif : les écrans
 *  trient dessus plutôt que de réinventer un classement */
export const STATUTS_TACHE: StatutTache[] = [
  'a_qualifier',
  'a_faire',
  'planifiee',
  'en_cours',
  'en_attente',
  'bloquee',
  'a_valider',
  'terminee',
  'annulee',
]

export const LIBELLES_STATUT_TACHE: Record<StatutTache, string> = {
  a_qualifier: 'À qualifier',
  a_faire: 'À faire',
  planifiee: 'Planifiée',
  en_cours: 'En cours',
  en_attente: 'En attente',
  bloquee: 'Bloquée',
  a_valider: 'À valider',
  terminee: 'Terminée',
  annulee: 'Annulée',
}

/** Les statuts qui pèsent encore sur quelqu'un.
 *
 *  « Terminée » et « annulée » sortent des files, des compteurs et de
 *  l'écran de départ d'un membre (B.14). Définir cet ensemble UNE fois
 *  évite que chaque écran choisisse ses propres exclusions — et qu'une
 *  tâche annulée réapparaisse dans un seul d'entre eux. */
export const STATUTS_TACHE_OUVERTS = new Set<StatutTache>([
  'a_qualifier',
  'a_faire',
  'planifiee',
  'en_cours',
  'en_attente',
  'bloquee',
  'a_valider',
])

export function estOuverte(t: TacheInterne): boolean {
  return STATUTS_TACHE_OUVERTS.has(t.statut as StatutTache)
}

/** Vrai si la valeur est un statut du référentiel.
 *
 *  `TacheInterne.statut` est un `string` : le document JSONB traverse un
 *  export, un import et une synchronisation, et rien ne garantit qu'il en
 *  revienne avec une valeur connue. Un statut inventé ferait disparaître la
 *  tâche de TOUS les filtres à la fois, sans erreur — le seul mode de perte
 *  qui ne se voit pas. */
export function estStatutTache(valeur: unknown): valeur is StatutTache {
  return typeof valeur === 'string' && (STATUTS_TACHE as string[]).includes(valeur)
}

export function estPrioriteTache(valeur: unknown): valeur is PrioriteTache {
  return typeof valeur === 'string' && (PRIORITES_TACHE as string[]).includes(valeur)
}

// ------------------------------------------------------------
// 2. Les priorités, et leur projection sur l'échelle des alertes
// ------------------------------------------------------------

export type PrioriteTache = 'basse' | 'normale' | 'haute' | 'critique'

/** du plus faible au plus fort — l'ordre commande la projection */
export const PRIORITES_TACHE: PrioriteTache[] = ['basse', 'normale', 'haute', 'critique']

export const LIBELLES_PRIORITE_TACHE: Record<PrioriteTache, string> = {
  basse: 'Basse',
  normale: 'Normale',
  haute: 'Haute',
  critique: 'Critique',
}

/** Projection sur la gravité 1-3 de `Alerte`, comme `graviteDe()` le fait
 *  pour l'importance d'un message.
 *
 *  L'échelle des alertes a UN propriétaire, `src/alerts.ts`, et personne
 *  d'autre ne doit décider qu'une priorité « haute » vaut 3 : le fil
 *  d'urgences se remplirait de tâches ordinaires, et cesserait d'être lu.
 *  C'est ce que B.12 consomme pour les « tâches urgentes » du §8.2. */
const GRAVITES_PRIORITE: Record<PrioriteTache, 1 | 2 | 3> = {
  basse: 1,
  normale: 1,
  haute: 2,
  critique: 3,
}

export function graviteDePriorite(priorite: PrioriteTache): 1 | 2 | 3 {
  return GRAVITES_PRIORITE[priorite]
}

// ------------------------------------------------------------
// 3. Les sept origines du §8.4, plus celle de la reprise
// ------------------------------------------------------------
//
// Le §8.4 énumère sept façons de créer une tâche. La reprise du palier
// v21 en ajoute une huitième — `note_journal` — et c'est délibéré : une
// tâche née d'une note reprise n'a pas été créée à la main, et le dire
// « manuelle » ferait mentir sa source. Le §4.2 exige qu'un objet issu
// d'autre chose conserve ce lien ; une source inventée est pire qu'une
// source absente, parce qu'elle a l'air vraie.

export type TypeSourceTache =
  | 'manuelle'
  | 'message'
  | 'compte_rendu'
  | 'decision'
  | 'reunion'
  | 'document'
  | 'proposition'
  | 'note_journal'

export const TYPES_SOURCE_TACHE: TypeSourceTache[] = [
  'manuelle',
  'message',
  'compte_rendu',
  'decision',
  'reunion',
  'document',
  'proposition',
  'note_journal',
]

export const LIBELLES_SOURCE_TACHE: Record<TypeSourceTache, string> = {
  manuelle: 'Saisie manuelle',
  message: 'E-mail',
  compte_rendu: 'Compte rendu',
  decision: 'Décision',
  reunion: 'Réunion',
  document: 'Document',
  proposition: 'Proposition acceptée',
  note_journal: 'Note de journal reprise',
}

// ------------------------------------------------------------
// 4. Créer une tâche
// ------------------------------------------------------------

let compteur = 0

/** identifiant stable et lisible. Le compteur évite la collision de deux
 *  créations dans la même milliseconde — le cas se produit à l'application
 *  d'un modèle (B.13), qui en crée dix d'un coup. */
export function idTache(): string {
  compteur += 1
  return `tache-${Date.now().toString(36)}-${compteur.toString(36)}`
}

export interface NouvelleTache {
  titre: string
  source: TacheInterne['source']
  description?: string
  projetId?: string | null
  phase?: PhaseCode | null
  responsable?: string | null
  createur?: string | null
  participants?: string[]
  priorite?: PrioriteTache
  statut?: StatutTache
  debut?: string | null
  echeance?: string | null
  tempsEstime?: number | null
}

/**
 * La SEULE fabrique de tâche du dépôt.
 *
 * Elle existe pour que les dix-huit champs du §8.5 soient toujours tous
 * présents : une tâche construite à la main quelque part finirait sans
 * `participants`, et le premier écran qui ferait `t.participants.length`
 * planterait — sur cette tâche-là seulement, donc longtemps après.
 *
 * `tempsEnregistre` naît à 0 et n'est jamais renseigné ici : c'est une
 * projection des pointages (B.9).
 */
export function creerTache(champs: NouvelleTache): TacheInterne {
  const maintenant = new Date().toISOString()
  return {
    id: idTache(),
    titre: champs.titre.trim(),
    description: champs.description?.trim() || '',
    projetId: champs.projetId ?? null,
    phase: champs.phase ?? null,
    responsable: champs.responsable ?? null,
    createur: champs.createur ?? null,
    participants: champs.participants ? [...champs.participants] : [],
    priorite: champs.priorite ?? 'normale',
    // Une tâche née d'une machine arrive « à qualifier », jamais « à
    // faire » : c'est la différence entre proposer et décider (§15).
    statut: champs.statut ?? (champs.source.type === 'proposition' ? 'a_qualifier' : 'a_faire'),
    debut: champs.debut ?? null,
    echeance: champs.echeance ?? null,
    tempsEstime: champs.tempsEstime ?? null,
    tempsEnregistre: 0,
    source: champs.source,
    documentIds: [],
    commentaires: [],
    sousTaches: [],
    dependances: [],
    creeLe: maintenant,
    majLe: maintenant,
  }
}

// ------------------------------------------------------------
// 5. Les onze filtres du §8.3 — livrable B.2
// ------------------------------------------------------------
//
// Ils vivent ici, purs, et non dans l'écran : c'est ce qui les rend
// vérifiables en CI sans navigateur. Le §8.3 en énumère onze ; la version
// 1 du plan en déclarait dix et tenait quand même le critère 6 pour
// satisfait — « Proposées par l'IA » manquait.
//
// Trois d'entre eux sont PARAMÉTRÉS (projet, priorité, statut) et huit
// sont des prédicats simples. Les mélanger dans une seule énumération
// ferait de « par projet » un booléen, ce qu'il n'est pas.

export type FiltreTemporel = 'aujourdhui' | 'en_retard' | 'cette_semaine' | 'a_venir' | 'sans_date'

export interface FiltreTaches {
  /** la personne devant l'écran — filtre par DÉFAUT de la vue (§8.3) */
  personne?: string | null
  temporel?: FiltreTemporel | null
  projetId?: string | null
  priorite?: PrioriteTache | null
  statut?: StatutTache | null
  /** « Créées par moi » */
  creeesParMoi?: boolean
  /** « Assignées par un tiers » : quelqu'un d'autre me l'a confiée */
  assigneesParUnTiers?: boolean
  /** « Proposées par l'IA » — lit la SOURCE, pas un champ à part */
  proposeesParIA?: boolean
  /** inclure ce qui est terminé ou annulé. Faux par défaut : une file qui
   *  montre l'histoire complète cesse d'être une file. */
  inclureClos?: boolean
}

/** lundi de la semaine d'une date ISO — la semaine commence lundi en France */
function lundiDe(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const jour = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() - ((jour + 6) % 7))
  return d.toISOString().slice(0, 10)
}

function ajouterJours(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Le prédicat temporel, sur l'ÉCHÉANCE.
 *
 * Une tâche sans échéance n'est ni en retard, ni pour aujourd'hui, ni pour
 * cette semaine : elle est « sans date », et c'est un filtre à part entière
 * du §8.3. La faire tomber dans « à venir » la noierait parmi des tâches
 * datées, et personne ne lui en donnerait jamais une.
 *
 * « En retard » se juge STRICTEMENT avant aujourd'hui : une échéance du
 * jour n'est pas en retard, elle est pour aujourd'hui. Confondre les deux
 * ferait paraître en retard tout ce qui est simplement à faire ce matin.
 */
export function correspondAuTemporel(t: TacheInterne, filtre: FiltreTemporel, aujourdhui: string): boolean {
  const echeance = t.echeance ? t.echeance.slice(0, 10) : null
  if (filtre === 'sans_date') return !echeance
  if (!echeance) return false
  if (filtre === 'en_retard') return echeance < aujourdhui
  if (filtre === 'aujourdhui') return echeance === aujourdhui
  if (filtre === 'cette_semaine') {
    const lundi = lundiDe(aujourdhui)
    // Bornes incluses des deux côtés : une échéance au dimanche appartient
    // à la semaine, et une échéance en retard de mardi y appartient aussi —
    // « cette semaine » répond « ce sur quoi porte ma semaine », pas
    // « ce qui reste ».
    return echeance >= lundi && echeance <= ajouterJours(lundi, 6)
  }
  // « à venir » : strictement après aujourd'hui. Le jour même a son filtre.
  return echeance > aujourdhui
}

/**
 * Applique les onze filtres du §8.3.
 *
 * Ils se COMBINENT : « mes tâches en retard sur P01 » est une question
 * légitime, et la poser demande trois filtres à la fois. Un sélecteur par
 * filtre obligerait l'écran à les composer lui-même, donc à réimplémenter
 * la combinaison — mal, et différemment de la fois suivante.
 */
export function filtrerTaches(
  taches: TacheInterne[],
  filtre: FiltreTaches,
  aujourdhui: string,
): TacheInterne[] {
  const moi = (filtre.personne || '').trim()
  return (taches || []).filter((t) => {
    if (!filtre.inclureClos && !estOuverte(t)) return false

    // Le filtre par personne est celui par DÉFAUT de la vue. Sans personne
    // reconnue, on montre tout plutôt que de choisir quelqu'un au hasard —
    // même règle que la boîte « À traiter » (A.7).
    if (moi && !filtre.creeesParMoi && t.responsable !== moi) return false

    if (filtre.temporel && !correspondAuTemporel(t, filtre.temporel, aujourdhui)) return false
    if (filtre.projetId && t.projetId !== filtre.projetId) return false
    if (filtre.priorite && t.priorite !== filtre.priorite) return false
    if (filtre.statut && t.statut !== filtre.statut) return false

    if (filtre.creeesParMoi && (!moi || t.createur !== moi)) return false

    // « Assignées par un tiers » : je la porte, quelqu'un d'autre l'a
    // créée. Une tâche que je me suis donnée n'a pas été assignée — et
    // c'est toute la question que ce filtre pose.
    if (filtre.assigneesParUnTiers) {
      if (!moi || t.responsable !== moi) return false
      if (!t.createur || t.createur === moi) return false
    }

    // « Proposées par l'IA » lit la SOURCE. Un champ booléen à part
    // finirait par dire autre chose que la source, et c'est la source qui
    // fait foi (§4.2).
    if (filtre.proposeesParIA && t.source?.type !== 'proposition') return false

    return true
  })
}

/**
 * L'ordre de la vue : ce qui presse d'abord.
 *
 * Retard, puis échéance, puis priorité décroissante, puis date de création.
 * Les tâches sans échéance viennent APRÈS les datées — elles n'ont pas de
 * rendez-vous, elles ne peuvent pas en réclamer un.
 */
export function trierTaches(a: TacheInterne, b: TacheInterne): number {
  const ea = a.echeance ? a.echeance.slice(0, 10) : '9999-99-99'
  const eb = b.echeance ? b.echeance.slice(0, 10) : '9999-99-99'
  if (ea !== eb) return ea < eb ? -1 : 1
  const pa = estPrioriteTache(a.priorite) ? graviteDePriorite(a.priorite) : 0
  const pb = estPrioriteTache(b.priorite) ? graviteDePriorite(b.priorite) : 0
  if (pa !== pb) return pb - pa
  return (a.creeLe || '').localeCompare(b.creeLe || '')
}

// ------------------------------------------------------------
// 6. Reprise des notes « à faire » (palier v20 → v21)
// ------------------------------------------------------------

/** le tag qui, depuis toujours, fait d'une note de journal une action */
export const TAG_A_FAIRE = 'a-faire'

/**
 * Les tâches à créer depuis les notes de journal non réglées.
 *
 * Fonction PURE, et c'est ce qui la rend vérifiable : le palier de
 * `migrate()` s'exécute à chaque chargement et sur tout état distant reçu.
 * Une reprise qui se tromperait de condition ne planterait pas — elle
 * dupliquerait les tâches une fois par ouverture de l'application.
 *
 * Trois protections, dans l'ordre où elles comptent :
 *
 *   1. **La note n'est pas touchée.** Elle reste dans le journal du projet,
 *      qui est la mémoire de ce projet. La tâche est un objet NOUVEAU qui
 *      la désigne ; supprimer la note ferait disparaître son horodatage,
 *      son auteur et son contexte au profit d'un titre ;
 *   2. **Le lien est porté par `source`** — `{type:'note_journal', id}`.
 *      C'est lui qui rend la reprise rejouable sans doublon, et c'est aussi
 *      le §4.2 : un objet issu d'autre chose conserve ce lien ;
 *   3. **Une note déjà reprise ne l'est pas deux fois**, quelle que soit la
 *      raison pour laquelle on repasse ici.
 *
 * `fait` non coché est la seule condition d'éligibilité : une note réglée
 * appartient à l'historique du projet, pas à la file de quelqu'un.
 */
export function tachesDepuisNotes(
  projets: Projet[],
  dejaReprises: TacheInterne[],
): TacheInterne[] {
  const connues = new Set(
    dejaReprises
      .filter((t) => t.source.type === 'note_journal' && t.source.id)
      .map((t) => t.source.id as string),
  )
  const sorties: TacheInterne[] = []
  for (const projet of projets || []) {
    for (const note of projet.journal || []) {
      if (!Array.isArray(note.tags) || !note.tags.includes(TAG_A_FAIRE)) continue
      if (note.fait) continue
      if (connues.has(note.id)) continue
      connues.add(note.id)
      const texte = (note.texte || '').trim()
      if (!texte) continue
      sorties.push({
        ...creerTache({
          // Le titre d'une tâche se lit d'un coup d'œil dans une liste ; le
          // texte entier de la note, non. On coupe, et la coupe se voit —
          // la note reste consultable, ce n'est pas une perte.
          titre: texte.length > 120 ? `${texte.slice(0, 119).trimEnd()}…` : texte,
          description: texte.length > 120 ? texte : '',
          projetId: projet.id,
          // L'auteur de la note devient le responsable : c'est lui qui
          // l'avait écrite pour lui-même. Rien n'est deviné quand il manque.
          responsable: note.auteur || null,
          createur: note.auteur || null,
          echeance: null,
          source: { type: 'note_journal', id: note.id },
        }),
        // La date de la note, pas celle de la migration : une tâche reprise
        // qui naîtrait « aujourd'hui » perdrait son ancienneté, et c'est
        // précisément ce qui la rendait urgente.
        creeLe: note.date || todayISO(),
      })
    }
  }
  return sorties
}
