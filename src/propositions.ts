// ============================================================
// Couche d'accès à `public.propositions` — livrable A.9.
//
// Le versant navigateur de la table à QUATRE GENRES (migration
// 20260731190000) : tâches, échéances, décisions et risques détectés
// dans un message (CDC §12.3 pts 5-8). Calquée sur `src/entrants.ts`
// pour la forme — colonnes nommées une par une, ligne SQL traduite en
// objet français — et branchée sur le cache et la file de
// `src/horsLigne.ts`, mutualisés avec `communications` (A.3) et
// `pointages` (B.4). Un second cache écrit ici serait le doublon que
// le §3.3 nomme d'avance.
//
// UNE PROPOSITION N'EST JAMAIS L'OBJET QU'ELLE PROPOSE
// ----------------------------------------------------
// C'est la doctrine du §15, et elle n'est pas tenue par ce module :
// elle est tenue par le schéma, ce qui est tout l'intérêt du livrable.
// `statut` ne connaît que `proposee` / `acceptee` / `ignoree` ;
// « acceptée » équivaut, par contrainte, à « désigne un objet créé »
// (`objet_cree_type`, `objet_cree_id`) ; et rien ne quitte l'état
// proposé sans signature, ce qui rend l'expiration impossible plutôt
// qu'interdite. Ici on ne fait qu'offrir les trois gestes — accepter,
// ignorer, rouvrir — et refuser les signatures vides avant de partir.
//
// LES QUATRE LISTES FERMÉES SE DÉCLARENT ICI, ET NULLE PART AILLEURS
// ------------------------------------------------------------------
// Genres, statuts, destinations, natures de risque : c'est le même
// partage que `src/categorisation.ts` pour les trois axes du §5.2. Les
// quatre domaines SQL en sont la transcription, et
// `scripts/test-propositions-modifiables.cjs` les compare valeur par
// valeur. Les détecteurs du livrable A.10 tournent dans Deno et ne
// peuvent pas importer `src/` : ils ÉMETTENT ces valeurs, et leur test
// les compare à ce module — exactement comme
// `_shared/classement-echanges.ts` le fait pour les axes. Une valeur
// inventée serait refusée par le domaine, et la détection perdue sans
// autre trace que les journaux Supabase.
//
// LE PROJET N'EST PAS DANS CETTE TABLE
// ------------------------------------
// Il vit sur `communications`, où `projet_id` est une colonne GÉNÉRÉE
// qu'une correction humaine de rattachement fait basculer. Le recopier
// ici l'aurait figé au jour de la détection : un message rerattaché
// aurait laissé ses propositions sur l'ancien projet, sans erreur. Il
// est donc lu PAR JOINTURE, avec l'objet du message et sa date — c'est
// la seule raison pour laquelle ce module lit une seconde table.
//
// CE QUE CE MODULE NE FAIT PAS
// ----------------------------
//   * il ne détecte rien : les deux étages de détection (marqueurs
//     déterministes, puis modèle dans la réponse de l'Edge Function de
//     résumé) sont le livrable A.10, et ils écrivent côté serveur —
//     l'`insert` est réservé au `service_role` ;
//   * il n'insère ni ne supprime : un écran ne fabrique pas une
//     proposition, il la tranche ;
//   * il ne crée pas l'objet accepté. Créer la tâche est un geste de
//     l'écran (B.10) ; ce module enregistre ensuite que la proposition
//     désigne cet objet. Les deux ne se confondent pas, et c'est
//     précisément ce que le §15 demande ;
//   * il n'assemble aucun libellé d'affichage : la file de revue du
//     §8.7 est le livrable B.11.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ecrireCache,
  enfiler,
  enregistrerExecuteur,
  exigerSignataire,
  lireCache,
  patcherCache,
} from './horsLigne'
import { abonnerSession, clientSupabase } from './sync'
import { gmailMessageUrl } from './util'

/** nom du magasin dans le cache et la file — une seule chaîne, ici */
export const MAGASIN_PROPOSITIONS = 'propositions'

/** taille de page par défaut ; l'écran peut la réduire, jamais l'annuler */
export const TAILLE_PAGE = 50

// ------------------------------------------------------------
// 1. Les quatre listes fermées
// ------------------------------------------------------------

/** les quatre genres du §12.3 (points 5 à 8) — une seule table, §3.14 décision 3 */
export type GenreProposition = 'tache' | 'echeance' | 'decision' | 'risque'
export const GENRES_PROPOSITION: GenreProposition[] = ['tache', 'echeance', 'decision', 'risque']
export const LIBELLES_GENRE: Record<GenreProposition, string> = {
  tache: 'Tâche',
  echeance: 'Échéance',
  decision: 'Décision',
  risque: 'Risque',
}

/**
 * Le statut d'une PROPOSITION, et rien d'autre.
 *
 * Aucun statut métier : les cinq statuts de décision du §6.2 (proposée, à
 * vérifier, confirmée, contestée, annulée) appartiennent à l'entité
 * `decisions`, qui est le livrable 2.1 et n'existe pas. Les faire entrer ici
 * ferait de la table des détections la mémoire des décisions de l'agence.
 */
export type StatutProposition = 'proposee' | 'acceptee' | 'ignoree'
export const STATUTS_PROPOSITION: StatutProposition[] = ['proposee', 'acceptee', 'ignoree']
export const LIBELLES_STATUT: Record<StatutProposition, string> = {
  proposee: 'Proposée',
  acceptee: 'Acceptée',
  ignoree: 'Ignorée',
}

/**
 * Les deux SEULES destinations d'une proposition acceptée (§3.14, décision 4).
 *
 * Ni `Obligation` — qui déclenche le rappel réglementaire de gravité 3 de
 * `src/alerts.ts` — ni `EcheanceFacturation`, qui commande l'émission d'une
 * facture : ce sont des échéances juridiques et financières, et le §15 interdit
 * d'en créer sans confirmation. La liste sert deux fois : la cible d'une
 * échéance proposée, et le type de l'objet réellement créé.
 */
export type TypeObjetPropose = 'tache' | 'contact'
export const OBJETS_PROPOSABLES: TypeObjetPropose[] = ['tache', 'contact']
export const LIBELLES_OBJET_PROPOSE: Record<TypeObjetPropose, string> = {
  tache: 'Tâche',
  contact: 'Contact',
}

/**
 * Les quatre natures de risque que `computeAlertes()` ne peut PAS voir.
 *
 * Le §6.3 en liste neuf ; cinq sont déjà produites par `src/alerts.ts` — retard
 * potentiel et échéance imminente (`echeance_rendu`, `obligation`), budget
 * dépassé (`derive_heures`), absence de validation (`situation_a_verifier`),
 * dépendance à un tiers (`situation_manquante`). Les redétecter depuis les
 * mails doublerait chaque risque dans la fiche projet.
 */
export type NatureRisque =
  | 'demande_contradictoire'
  | 'modification_de_programme'
  | 'reserve_technique'
  | 'responsabilite_non_attribuee'
export const NATURES_RISQUE: NatureRisque[] = [
  'demande_contradictoire',
  'modification_de_programme',
  'reserve_technique',
  'responsabilite_non_attribuee',
]
export const LIBELLES_NATURE_RISQUE: Record<NatureRisque, string> = {
  demande_contradictoire: 'Demande contradictoire',
  modification_de_programme: 'Modification de programme',
  reserve_technique: 'Réserve technique',
  responsabilite_non_attribuee: 'Responsabilité non attribuée',
}

/** quel étage a détecté (§3.14, décision 5) */
export type OrigineDetection = 'lexique' | 'modele'
export const ORIGINES_DETECTION: OrigineDetection[] = ['lexique', 'modele']

function dansListe<T extends string>(liste: T[], valeur: unknown): T | null {
  return typeof valeur === 'string' && (liste as string[]).includes(valeur) ? (valeur as T) : null
}

// ------------------------------------------------------------
// 2. La charge utile, typée par genre
// ------------------------------------------------------------
//
// Les clés sont celles de la BASE, et non une traduction : la charge utile est
// écrite par le détecteur (A.10), contrainte en SQL genre par genre, et lue
// ici. Une seconde orthographe côté navigateur serait justement celle que la
// contrainte refuse — et l'erreur n'apparaîtrait qu'à l'insertion, côté
// serveur, sur une détection qu'on ne reverra pas.

/**
 * §8.7 : « Tâche proposée », « Responsable suggéré », « Échéance détectée ».
 *
 * `responsable` est un nom de personne, et il n'entre PAS dans l'inventaire de
 * `src/personnes.ts` : c'est la trace de ce qu'une machine a suggéré, pas la
 * désignation de quelqu'un. Un renommage dans les Paramètres ne doit pas
 * réécrire ce qui a été proposé — c'est la tâche créée à l'acceptation, dans
 * `state.taches` (livrable B.1), qui portera la désignation vivante et devra,
 * elle, entrer dans l'inventaire.
 */
export interface ChargeTache {
  titre: string
  responsable?: string | null
  /** date ISO `AAAA-MM-JJ` */
  echeance?: string | null
}

/** §3.14 décision 4 : une échéance proposée ne vise qu'une tâche ou un contact */
export interface ChargeEcheance {
  cible: TypeObjetPropose
  /** date ISO `AAAA-MM-JJ` */
  date: string
  libelle?: string | null
}

/** §6.1 : ce qui a été décidé, par qui, quand */
export interface ChargeDecision {
  objet: string
  date?: string | null
  validee_par?: string | null
}

/** §6.3, restreint aux quatre natures du §3.14 */
export interface ChargeRisque {
  nature: NatureRisque
  detail?: string | null
}

function texte(brut: unknown): string {
  return typeof brut === 'string' ? brut : ''
}

function texteOuNul(brut: unknown): string | null {
  const v = texte(brut).trim()
  return v ? v : null
}

function objet(brut: unknown): Record<string, unknown> {
  return brut && typeof brut === 'object' && !Array.isArray(brut) ? (brut as Record<string, unknown>) : {}
}

function listeTexte(brut: unknown): string[] {
  return Array.isArray(brut) ? brut.filter((v): v is string => typeof v === 'string') : []
}

// ------------------------------------------------------------
// 3. La proposition, vue du navigateur
// ------------------------------------------------------------

/**
 * Ce que la proposition emprunte à son message — lu PAR JOINTURE, jamais
 * recopié dans la table. `projetId` est la colonne générée
 * `communications.projet_id` : corriger le rattachement d'un message vaut
 * aussitôt pour toutes les propositions qui en sont issues.
 */
export interface MessageSource {
  communicationId: string
  gmailMessageId: string
  /** lien de réouverture dans Gmail — `null` si l'identifiant est malformé */
  urlGmail: string | null
  objet: string
  envoyeLe: string | null
  projetId: string | null
}

interface PropositionBase {
  id: string
  /** LA PHRASE du message qui porte la détection (§13.3, §4.2) — jamais vide */
  extrait: string
  confiance: number | null
  raisons: string[]
  origine: OrigineDetection
  statut: StatutProposition
  /** ce qu'un humain a créé, et que la proposition se contente de DÉSIGNER */
  objetCreeType: TypeObjetPropose | null
  objetCreeId: string | null
  traitePar: string | null
  traiteLe: string | null
  creeLe: string
  message: MessageSource
}

export interface PropositionTache extends PropositionBase {
  genre: 'tache'
  chargeUtile: ChargeTache
}
export interface PropositionEcheance extends PropositionBase {
  genre: 'echeance'
  chargeUtile: ChargeEcheance
}
export interface PropositionDecision extends PropositionBase {
  genre: 'decision'
  chargeUtile: ChargeDecision
}
export interface PropositionRisque extends PropositionBase {
  genre: 'risque'
  chargeUtile: ChargeRisque
}

/** une détection en attente de décision humaine (§8.7) */
export type Proposition =
  | PropositionTache
  | PropositionEcheance
  | PropositionDecision
  | PropositionRisque

/** la ligne SQL, telle qu'elle arrive — avec son message joint */
interface LigneProposition {
  id: string
  communication_id: string
  genre: string | null
  charge_utile: unknown
  extrait: string | null
  confiance: number | null
  raisons: unknown
  origine: string | null
  statut: string | null
  objet_cree_type: string | null
  objet_cree_id: string | null
  traite_par: string | null
  traite_le: string | null
  cree_le: string
  communications: LigneMessageJoint | LigneMessageJoint[] | null
}

interface LigneMessageJoint {
  projet_id: string | null
  gmail_message_id: string | null
  objet: string | null
  envoye_le: string | null
}

/** Les colonnes lues, nommées une par une comme dans `src/entrants.ts` : un
 *  `select('*')` ferait entrer sans bruit toute colonne ajoutée demain.
 *  La jointure est `!inner` parce que `communication_id` est `not null` : une
 *  proposition privée de son message serait une affirmation sans source, et le
 *  schéma l'interdit déjà (`on delete cascade`). */
const COLONNES = [
  'id',
  'communication_id',
  'genre',
  'charge_utile',
  'extrait',
  'confiance',
  'raisons',
  'origine',
  'statut',
  'objet_cree_type',
  'objet_cree_id',
  'traite_par',
  'traite_le',
  'cree_le',
  'communications!inner(projet_id,gmail_message_id,objet,envoye_le)',
].join(',')

function messageDe(l: LigneProposition): MessageSource {
  const joint = (Array.isArray(l.communications) ? l.communications[0] : l.communications) || null
  const gmailMessageId = texte(joint?.gmail_message_id)
  return {
    communicationId: l.communication_id,
    gmailMessageId,
    urlGmail: gmailMessageUrl(gmailMessageId),
    objet: texte(joint?.objet),
    envoyeLe: joint?.envoye_le ?? null,
    projetId: joint?.projet_id ?? null,
  }
}

/**
 * Ligne SQL → proposition, ou `null`.
 *
 * `null` quand le genre ou la charge utile ne correspond à rien de connu. Les
 * contraintes de la migration rendent ce cas impossible en base ; s'il se
 * présente, c'est que ce module et le schéma ont divergé, et afficher une
 * proposition à moitié lue — un risque sans nature, une échéance sans date —
 * serait pire que ne pas l'afficher : elle serait tranchée sur un contenu
 * incomplet. `listerPropositions` compte ces lignes et le dit (`illisibles`),
 * plutôt que de les faire disparaître en silence.
 */
export function depuisLigne(l: LigneProposition): Proposition | null {
  const genre = dansListe(GENRES_PROPOSITION, l.genre)
  const statut = dansListe(STATUTS_PROPOSITION, l.statut)
  const extrait = texte(l.extrait).trim()
  if (!genre || !statut || !extrait) return null

  const commun: PropositionBase = {
    id: l.id,
    extrait,
    confiance: l.confiance,
    raisons: listeTexte(l.raisons),
    origine: dansListe(ORIGINES_DETECTION, l.origine) ?? 'lexique',
    statut,
    objetCreeType: dansListe(OBJETS_PROPOSABLES, l.objet_cree_type),
    objetCreeId: l.objet_cree_id,
    traitePar: l.traite_par,
    traiteLe: l.traite_le,
    creeLe: l.cree_le,
    message: messageDe(l),
  }

  const charge = objet(l.charge_utile)
  if (genre === 'tache') {
    const titre = texte(charge.titre).trim()
    if (!titre) return null
    return {
      ...commun,
      genre,
      chargeUtile: {
        titre,
        responsable: texteOuNul(charge.responsable),
        echeance: texteOuNul(charge.echeance),
      },
    }
  }
  if (genre === 'echeance') {
    const cible = dansListe(OBJETS_PROPOSABLES, charge.cible)
    const date = texte(charge.date).trim()
    if (!cible || !date) return null
    return { ...commun, genre, chargeUtile: { cible, date, libelle: texteOuNul(charge.libelle) } }
  }
  if (genre === 'decision') {
    const objetDecide = texte(charge.objet).trim()
    if (!objetDecide) return null
    return {
      ...commun,
      genre,
      chargeUtile: {
        objet: objetDecide,
        date: texteOuNul(charge.date),
        validee_par: texteOuNul(charge.validee_par),
      },
    }
  }
  const nature = dansListe(NATURES_RISQUE, charge.nature)
  if (!nature) return null
  return { ...commun, genre, chargeUtile: { nature, detail: texteOuNul(charge.detail) } }
}

// ------------------------------------------------------------
// 4. Le filtre — déclaré UNE fois, appliqué des deux côtés
// ------------------------------------------------------------
//
// Même patron que `src/communications.ts` : chaque champ porte SES DEUX
// traductions, la SQL et celle du cache, côte à côte. Écrites à deux endroits
// sans lien, elles divergent au premier ajout — et la divergence est
// invisible : hors ligne, la même question rend simplement d'autres lignes.

export interface FiltrePropositions {
  /** la file de revue du §8.7 : `statut: 'proposee'` */
  statut?: StatutProposition
  genre?: GenreProposition
  /** toutes les propositions d'un projet — via le message, §6.3 fiche projet */
  projetId?: string
  /** toutes les propositions issues d'un message */
  communicationId?: string
  /** borne basse sur la date de détection (ISO) */
  depuis?: string
}

type Contrainte =
  | { op: 'eq'; colonne: string; valeur: string }
  | { op: 'depuis'; colonne: string; valeur: string }

interface Critere<C> {
  contraintes: (valeur: C) => Contrainte[]
  correspond: (p: Proposition, valeur: C) => boolean
}

const CRITERES: { [K in keyof Required<FiltrePropositions>]: Critere<NonNullable<FiltrePropositions[K]>> } = {
  statut: {
    contraintes: (v) => [{ op: 'eq', colonne: 'statut', valeur: v }],
    correspond: (p, v) => p.statut === v,
  },
  genre: {
    contraintes: (v) => [{ op: 'eq', colonne: 'genre', valeur: v }],
    correspond: (p, v) => p.genre === v,
  },
  // le projet vit sur le message : PostgREST filtre la ressource jointe, et le
  // cache lit la même valeur, celle qui a été rapportée par la jointure
  projetId: {
    contraintes: (v) => [{ op: 'eq', colonne: 'communications.projet_id', valeur: v }],
    correspond: (p, v) => p.message.projetId === v,
  },
  communicationId: {
    contraintes: (v) => [{ op: 'eq', colonne: 'communication_id', valeur: v }],
    correspond: (p, v) => p.message.communicationId === v,
  },
  depuis: {
    contraintes: (v) => [{ op: 'depuis', colonne: 'cree_le', valeur: v }],
    correspond: (p, v) => p.creeLe >= v,
  },
}

function contraintesDe(filtre: FiltrePropositions): Contrainte[] {
  const sortie: Contrainte[] = []
  for (const champ of Object.keys(CRITERES) as (keyof FiltrePropositions)[]) {
    const valeur = filtre[champ]
    if (valeur === undefined || valeur === null) continue
    const critere = CRITERES[champ] as Critere<unknown>
    sortie.push(...critere.contraintes(valeur))
  }
  return sortie
}

/** le même filtre, appliqué au cache */
export function correspondAuFiltre(p: Proposition, filtre: FiltrePropositions): boolean {
  for (const champ of Object.keys(CRITERES) as (keyof FiltrePropositions)[]) {
    const valeur = filtre[champ]
    if (valeur === undefined || valeur === null) continue
    const critere = CRITERES[champ] as Critere<unknown>
    if (!critere.correspond(p, valeur)) return false
  }
  return true
}

// ------------------------------------------------------------
// 5. La pagination — par curseur, jamais par décalage
// ------------------------------------------------------------
//
// Les détecteurs tournent derrière le cron : une pagination par `offset`
// décalerait les pages sous les doigts de la personne qui revoit sa file. Le
// curseur (date de détection, identifiant) est stable par construction.

export interface CurseurPropositions {
  creeLe: string
  id: string
}

export interface PagePropositions {
  lignes: Proposition[]
  /** d'où vient cette page — `cache` signifie « ce que ce poste connaît » */
  source: 'reseau' | 'cache'
  /** à passer à la lecture suivante ; `null` quand il n'y a pas de suite */
  curseur: CurseurPropositions | null
  /** lignes reçues que ce module n'a pas su lire : jamais escamotées */
  illisibles: number
}

function rangTemps(creeLe: string): number {
  const t = Date.parse(creeLe)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

/** du plus récent au plus ancien, l'identifiant départageant les ex æquo */
function comparerDecroissant(a: Proposition, b: Proposition): number {
  const ta = rangTemps(a.creeLe)
  const tb = rangTemps(b.creeLe)
  if (ta !== tb) return tb - ta
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** vrai si `p` vient strictement après le curseur dans cet ordre */
function apresCurseur(p: Proposition, curseur: CurseurPropositions): boolean {
  const tp = rangTemps(p.creeLe)
  const tk = rangTemps(curseur.creeLe)
  if (tp !== tk) return tp < tk
  return p.id < curseur.id
}

function curseurDe(p: Proposition): CurseurPropositions {
  return { creeLe: p.creeLe, id: p.id }
}

// ------------------------------------------------------------
// 6. La lecture
// ------------------------------------------------------------

export interface OptionsLecture extends FiltrePropositions {
  taille?: number
  suiteDe?: CurseurPropositions | null
}

/**
 * Une page de propositions — ou `null`.
 *
 * `null` veut dire « on ne sait pas » : ni session, ni cache pour cette cible.
 * Il ne veut jamais dire « aucune proposition ». Un tableau vide, lui, est une
 * réponse : le serveur a répondu, il n'y a rien à revoir. Les deux ne
 * s'affichent pas pareil — « rien à valider » annoncé à quelqu'un qui n'est pas
 * connecté est un mensonge sur lequel on organise sa journée.
 */
export async function listerPropositions(
  options: OptionsLecture = {},
): Promise<PagePropositions | null> {
  const taille = Math.max(1, options.taille ?? TAILLE_PAGE)
  const sb = clientSupabase()
  if (!sb) return depuisLeCache(options, taille)

  try {
    let requete = sb.from(MAGASIN_PROPOSITIONS).select(COLONNES)
    for (const contrainte of contraintesDe(options)) {
      if (contrainte.op === 'eq') requete = requete.eq(contrainte.colonne, contrainte.valeur)
      else requete = requete.gte(contrainte.colonne, contrainte.valeur)
    }
    const curseur = options.suiteDe
    if (curseur) {
      requete = requete.or(
        `cree_le.lt."${curseur.creeLe}",and(cree_le.eq."${curseur.creeLe}",id.lt.${curseur.id})`,
      )
    }
    const { data, error } = await requete
      .order('cree_le', { ascending: false })
      .order('id', { ascending: false })
      .limit(taille + 1)
    if (error) throw new Error(error.message)

    const brutes = (data || []) as unknown as LigneProposition[]
    const lues = brutes.map(depuisLigne).filter((p): p is Proposition => p !== null)
    void ecrireCache<Proposition>(
      MAGASIN_PROPOSITIONS,
      lues,
      (p) => p.id,
      (p) => p.creeLe,
    )
    const lignes = lues.slice(0, taille)
    return {
      lignes,
      source: 'reseau',
      curseur: lues.length > taille && lignes.length > 0 ? curseurDe(lignes[lignes.length - 1]) : null,
      illisibles: brutes.length - lues.length,
    }
  } catch (e) {
    // Réseau tombé en cours de route : le cache répond s'il peut, et l'appelant
    // voit `source: 'cache'`. S'il ne peut pas, l'erreur remonte — elle est plus
    // honnête qu'une liste vide.
    const repli = await depuisLeCache(options, taille)
    if (repli) return repli
    throw new Error(`Propositions illisibles : ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function depuisLeCache(
  options: OptionsLecture,
  taille: number,
): Promise<PagePropositions | null> {
  const cache = await lireCache<Proposition>(MAGASIN_PROPOSITIONS)
  if (!cache) return null
  const retenues = cache.lignes
    .filter((p) => correspondAuFiltre(p, options))
    .sort(comparerDecroissant)
    .filter((p) => !options.suiteDe || apresCurseur(p, options.suiteDe))
  const lignes = retenues.slice(0, taille)
  return {
    lignes,
    source: 'cache',
    curseur: retenues.length > taille && lignes.length > 0 ? curseurDe(lignes[lignes.length - 1]) : null,
    illisibles: 0,
  }
}

// ------------------------------------------------------------
// 7. Les trois gestes — par la file, donc hors ligne compris
// ------------------------------------------------------------

async function ecrire(
  p: Proposition,
  valeurs: Record<string, unknown>,
  champs: Partial<PropositionBase>,
): Promise<void> {
  await patcherCache<Proposition>(
    MAGASIN_PROPOSITIONS,
    p.id,
    (courant) => ({ ...courant, ...champs }) as Proposition,
  )
  const enfilee = await enfiler(MAGASIN_PROPOSITIONS, p.id, valeurs)
  if (!enfilee)
    throw new Error(
      'Aucun espace partagé n’est configuré : cette décision n’a nulle part où partir (Paramètres → Synchronisation).',
    )
}

/**
 * « Accepter » (§8.7) — la proposition DÉSIGNE l'objet qu'un humain a créé.
 *
 * Elle ne le devient pas, et ne peut pas le devenir : le schéma pose
 * l'équivalence « acceptée ⟺ un objet est désigné ». D'où la signature de
 * cette fonction, qui exige l'objet plutôt que de l'accepter facultatif —
 * accepter « en attendant de créer la tâche » produirait exactement l'état que
 * le §15 interdit, une proposition tenue pour faite sans rien derrière.
 *
 * L'écran crée l'objet AVANT d'appeler ceci (B.10) : c'est là que le
 * « modifiées » du critère 11 s'exerce, sur le formulaire pré-rempli par la
 * charge utile. Ce qui est enregistré est donc le choix humain, et la
 * proposition reste la trace intacte de ce qui avait été proposé.
 */
export async function accepter(
  p: Proposition,
  objetCree: { type: TypeObjetPropose; id: string },
  par: string,
): Promise<void> {
  const nom = exigerSignataire(par)
  const cible = (objetCree.id || '').trim()
  if (!cible)
    throw new Error(
      'Accepter une proposition suppose d’avoir créé l’objet qu’elle propose : sans lui, la proposition serait tenue pour faite sans rien derrière.',
    )
  const le = new Date().toISOString()
  await ecrire(
    p,
    {
      statut: 'acceptee',
      objet_cree_type: objetCree.type,
      objet_cree_id: cible,
      traite_par: nom,
      traite_le: le,
    },
    {
      statut: 'acceptee',
      objetCreeType: objetCree.type,
      objetCreeId: cible,
      traitePar: nom,
      traiteLe: le,
    },
  )
}

/** « Ignorer » (§8.7) — geste enregistré, jamais destructif : la proposition
 *  reste lisible avec son extrait, sa confiance et ses raisons, et ne revient
 *  plus dans la file de revue. C'est aussi le seul geste disponible pour un
 *  genre sans destination : décisions (livrable 2.1) et risques qualifiés
 *  (2.3) n'ont pas encore d'entité à créer, et le §3.14 l'assume — la
 *  proposition n'est pas perdue, rien n'est promu sans destination. */
export async function ignorer(p: Proposition, par: string): Promise<void> {
  const nom = exigerSignataire(par)
  const le = new Date().toISOString()
  await ecrire(
    p,
    { statut: 'ignoree', objet_cree_type: null, objet_cree_id: null, traite_par: nom, traite_le: le },
    { statut: 'ignoree', objetCreeType: null, objetCreeId: null, traitePar: nom, traiteLe: le },
  )
}

/** Rouvrir une proposition tranchée par erreur : elle revient dans la file et
 *  perd sa signature avec son statut — la contrainte du schéma lie les deux.
 *  Le geste reste réservé à quelqu'un d'identifié ; c'est le journal d'audit
 *  (livrable A.13) qui en gardera la trace, pas cette colonne. */
export async function rouvrir(p: Proposition, par: string): Promise<void> {
  exigerSignataire(par)
  await ecrire(
    p,
    { statut: 'proposee', objet_cree_type: null, objet_cree_id: null, traite_par: null, traite_le: null },
    { statut: 'proposee', objetCreeType: null, objetCreeId: null, traitePar: null, traiteLe: null },
  )
}

/** L'exécuteur : comment une écriture de la file s'applique réellement.
 *
 *  Enregistré à l'import du module, parce que la file ne connaît aucune table
 *  par elle-même. L'`update` vise la clé primaire et porte des valeurs
 *  absolues : le rejouer deux fois donne le même état — c'est l'idempotence du
 *  §24, obtenue sans rien demander au schéma. Le navigateur n'insère jamais
 *  ici, d'où l'absence d'`ecriture_id` : il n'y a pas de doublon possible à
 *  créer, seulement une ligne existante à repositionner. */
enregistrerExecuteur(MAGASIN_PROPOSITIONS, async (ecriture) => {
  const sb = clientSupabase()
  if (!sb) throw new Error('Espace partagé non connecté.')
  const { error } = await sb
    .from(MAGASIN_PROPOSITIONS)
    .update(ecriture.valeurs)
    .eq('id', ecriture.cle)
  if (error) throw new Error(`Décision refusée par le serveur : ${error.message}`)
})

// ------------------------------------------------------------
// 8. Le hook
// ------------------------------------------------------------

export interface EtatPropositions {
  /** `null` = on ne sait pas encore. JAMAIS `[]` par défaut. */
  lignes: Proposition[] | null
  source: 'reseau' | 'cache' | null
  chargement: boolean
  erreur: string | null
  /** lignes reçues que ce module n'a pas su lire */
  illisibles: number
  /** vrai s'il reste des pages */
  suite: boolean
  chargerSuite: () => void
  recharger: () => void
}

/**
 * Lecture paginée réactive — jumelle de `useCommunications`. Trois relectures
 * automatiques, et pas une de plus : à l'ouverture, 2,5 s après (la session du
 * lien magique s'ouvre en asynchrone), et à chaque changement de session. Le
 * retour du réseau est déjà branché sur la file par `src/horsLigne.ts`.
 */
export function usePropositions(filtre: FiltrePropositions, taille = TAILLE_PAGE): EtatPropositions {
  const cle = JSON.stringify({ filtre, taille })
  const options = useMemo<OptionsLecture>(() => ({ ...JSON.parse(cle).filtre, taille }), [cle, taille])
  const [lignes, setLignes] = useState<Proposition[] | null>(null)
  const [source, setSource] = useState<'reseau' | 'cache' | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [illisibles, setIllisibles] = useState(0)
  const [chargement, setChargement] = useState(false)
  const [curseur, setCurseur] = useState<CurseurPropositions | null>(null)
  const [generation, setGeneration] = useState(0)
  const vivant = useRef(true)

  useEffect(() => {
    vivant.current = true
    return () => {
      vivant.current = false
    }
  }, [])

  const lire = useCallback(
    async (suiteDe: CurseurPropositions | null) => {
      setChargement(true)
      try {
        const page = await listerPropositions({ ...options, suiteDe })
        if (!vivant.current) return
        setErreur(null)
        if (!page) {
          // ni session ni cache : on ne sait pas, et on le dit en ne
          // remplaçant rien par une liste vide
          if (!suiteDe) {
            setLignes(null)
            setSource(null)
            setCurseur(null)
            setIllisibles(0)
          }
          return
        }
        setSource(page.source)
        setCurseur(page.curseur)
        setIllisibles((avant) => (suiteDe ? avant + page.illisibles : page.illisibles))
        setLignes((avant) => (suiteDe && avant ? [...avant, ...page.lignes] : page.lignes))
      } catch (e) {
        if (!vivant.current) return
        setErreur(e instanceof Error ? e.message : String(e))
      } finally {
        if (vivant.current) setChargement(false)
      }
    },
    [options],
  )

  useEffect(() => {
    void lire(null)
    const differe = setTimeout(() => void lire(null), 2500)
    const desabonner = abonnerSession(() => void lire(null))
    return () => {
      clearTimeout(differe)
      desabonner()
    }
  }, [lire, generation])

  const chargerSuite = useCallback(() => {
    if (curseur) void lire(curseur)
  }, [curseur, lire])

  const recharger = useCallback(() => setGeneration((g) => g + 1), [])

  return { lignes, source, chargement, erreur, illisibles, suite: curseur !== null, chargerSuite, recharger }
}
