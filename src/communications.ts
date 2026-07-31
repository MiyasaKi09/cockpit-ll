// ============================================================
// Couche d'accès à `public.communications` — livrable A.3.
//
// Le versant navigateur de l'index des MESSAGES (table A.2, migration
// 20260731150000). Écrite sur le modèle de `src/veille.ts` : colonnes
// nommées une par une, ligne SQL traduite en objet français, `null`
// quand l'espace partagé n'est pas là. Avec deux ajouts que le §3.3
// rend obligatoires pour toute entité sortie du document JSONB — un
// cache de 90 jours et une file d'écritures — tous deux tenus par
// `src/horsLigne.ts`, mutualisés avec `propositions` (A.9) et
// `pointages` (B.4).
//
// CE QU'ON LIT, ET CE QU'ON NE LIT PAS
// ------------------------------------
// Les quatre colonnes GÉNÉRÉES — `projet_id`, `phase_effective`,
// `type_echange_effectif`, `importance_effective` — et jamais un
// `coalesce(phase, phase_proposee)` recalculé ici. La règle « proposé /
// validé » a une subtilité que personne ne réécrit sans la perdre :
// après signature humaine, un axe VIDE reste vide. Elle est écrite une
// fois, en base ; `scripts/test-communications.cjs` interdit sa
// recopie, et `scripts/test-hors-ligne.cjs` vérifie qu'on lit bien les
// colonnes générées.
//
// Les colonnes humaines brutes (`phase`, `type_echange`, `importance`)
// ne sont volontairement PAS sélectionnées : un écran qui les aurait
// sous la main finirait par les composer lui-même avec la proposition.
// Ce qu'il faut afficher est la valeur effective ; ce qu'il faut savoir
// d'elle est si un humain l'a signée — `categorisePar` le dit.
//
// LE PIÈGE DE LA SIGNATURE, ET POURQUOI `corrigerAxes` PREND LA LIGNE
// -------------------------------------------------------------------
// `categorise_par` commande les TROIS axes à la fois : dès qu'il est
// renseigné, chaque axe effectif vaut la colonne humaine, et rien
// d'autre. Corriger la seule importance en n'écrivant que
// `importance` + `categorise_par` viderait donc la phase et le type
// proposés, sans erreur ni trace. `corrigerAxes` reçoit la ligne
// entière et réécrit les trois colonnes humaines, en reprenant les
// valeurs effectives courantes pour les axes qu'on ne touche pas.
// C'est la raison d'être de cette signature, et elle ne se devine pas.
//
// CE QUE CE MODULE NE FAIT PAS
// ----------------------------
//   * il ne définit aucun sélecteur métier : `mailsATraiter(personne)`,
//     `mailsEnAttenteDeReponse()` et `echangesParPhase(projetId)` sont
//     le livrable A.12, et leur définition est du domaine, pas de
//     l'accès. Ici il n'y a que des primitives de requête ;
//   * il ne classe rien : le classifieur déterministe des trois axes
//     (A.8) vit côté serveur, dans
//     `supabase/functions/_shared/classement-echanges.ts`, et n'écrit
//     que les colonnes proposées. Ici on lit les colonnes effectives et
//     on signe une correction — jamais l'inverse ;
//   * il ne construit pas d'URL de source : `gmailMessageUrl()`
//     (`src/util.ts`) est le seul constructeur du dépôt, et il refuse
//     les identifiants malformés (critère 10).
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NiveauImportance, PhaseEchange, TypeEchange } from './categorisation'
import { normaliserImportance, normaliserPhaseEchange, normaliserTypeEchange } from './categorisation'
import {
  ecrireCache,
  enfiler,
  enregistrerExecuteur,
  lireCache,
  patcherCache,
} from './horsLigne'
import { abonnerSession, clientSupabase } from './sync'
import { gmailMessageUrl } from './util'

/** nom du magasin dans le cache et la file — une seule chaîne, ici */
export const MAGASIN_COMMUNICATIONS = 'communications'

/** taille de page par défaut ; l'écran peut la réduire, jamais l'annuler */
export const TAILLE_PAGE = 50

// ------------------------------------------------------------
// 1. Le message, vu du navigateur
// ------------------------------------------------------------

/** ce que la MACHINE a proposé — conservé tel quel, affiché comme tel,
 *  jamais réécrit depuis l'écran (le GRANT au niveau colonne l'interdit) */
export interface PropositionsCommunication {
  projetId: string | null
  phase: PhaseEchange | null
  typeEchange: TypeEchange | null
  importance: NiveauImportance | null
  confianceRattachement: number | null
  raisonsRattachement: string[]
  confianceCategorisation: number | null
  raisonsCategorisation: string[]
}

/** un message de l'index (§4.1, §18) */
export interface Communication {
  id: string
  gmailMessageId: string
  gmailThreadId: string
  /** lien de réouverture dans Gmail — `null` si l'identifiant est malformé */
  urlGmail: string | null
  messageIdRfc: string | null
  enReponseA: string | null
  referencesRfc: string[]
  expediteur: string
  expediteurAdresse: string
  destinataires: string[]
  copies: string[]
  objet: string
  corpsExtrait: string
  libelles: string[]
  direction: 'entrant' | 'sortant'
  nbPiecesJointes: number
  envoyeLe: string | null
  recuLe: string | null
  /** résumé du §5.3 — BROUILLON produit par l'Edge Function d'A.6 */
  resume: string | null
  resumeLe: string | null

  // --- valeurs EFFECTIVES : les colonnes générées, jamais recomposées ici ---
  projetId: string | null
  phase: PhaseEchange | null
  typeEchange: TypeEchange | null
  importance: NiveauImportance | null

  // --- signatures : qui a tranché, et quand ---
  rattachePar: string | null
  rattacheLe: string | null
  categorisePar: string | null
  categoriseLe: string | null
  traitePar: string | null
  traiteLe: string | null

  propose: PropositionsCommunication
}

/** la ligne SQL, telle qu'elle arrive */
interface LigneCommunication {
  id: string
  gmail_message_id: string
  gmail_thread_id: string
  message_id_rfc: string | null
  en_reponse_a: string | null
  references_rfc: unknown
  expediteur: string | null
  expediteur_adresse: string | null
  destinataires: unknown
  copies: unknown
  objet: string | null
  corps_extrait: string | null
  libelles: unknown
  direction: string | null
  nb_pieces_jointes: number | null
  envoye_le: string | null
  recu_le: string | null
  resume: string | null
  resume_le: string | null
  projet_id: string | null
  projet_id_propose: string | null
  confiance_rattachement: number | null
  raisons_rattachement: unknown
  rattache_par: string | null
  rattache_le: string | null
  phase_effective: string | null
  phase_proposee: string | null
  type_echange_effectif: string | null
  type_echange_propose: string | null
  importance_effective: string | null
  importance_proposee: string | null
  confiance_categorisation: number | null
  raisons_categorisation: unknown
  categorise_par: string | null
  categorise_le: string | null
  traite_par: string | null
  traite_le: string | null
}

/** Les colonnes lues, nommées une par une comme dans `src/entrants.ts` :
 *  un `select('*')` ferait entrer sans bruit toute colonne ajoutée demain,
 *  y compris une colonne de proposition qu'aucun écran ne doit composer. */
const COLONNES = [
  'id',
  'gmail_message_id',
  'gmail_thread_id',
  'message_id_rfc',
  'en_reponse_a',
  'references_rfc',
  'expediteur',
  'expediteur_adresse',
  'destinataires',
  'copies',
  'objet',
  'corps_extrait',
  'libelles',
  'direction',
  'nb_pieces_jointes',
  'envoye_le',
  'recu_le',
  'resume',
  'resume_le',
  'projet_id',
  'projet_id_propose',
  'confiance_rattachement',
  'raisons_rattachement',
  'rattache_par',
  'rattache_le',
  'phase_effective',
  'phase_proposee',
  'type_echange_effectif',
  'type_echange_propose',
  'importance_effective',
  'importance_proposee',
  'confiance_categorisation',
  'raisons_categorisation',
  'categorise_par',
  'categorise_le',
  'traite_par',
  'traite_le',
].join(',')

function listeTexte(brut: unknown): string[] {
  return Array.isArray(brut) ? brut.filter((v): v is string => typeof v === 'string') : []
}

/** ligne SQL → message. Les trois axes repassent par `src/categorisation.ts` :
 *  une valeur que la base accepterait et que le référentiel ne connaît pas
 *  ressort `null` plutôt qu'en transtypage aveugle. */
function depuisLigne(l: LigneCommunication): Communication {
  return {
    id: l.id,
    gmailMessageId: l.gmail_message_id,
    gmailThreadId: l.gmail_thread_id,
    urlGmail: gmailMessageUrl(l.gmail_message_id),
    messageIdRfc: l.message_id_rfc,
    enReponseA: l.en_reponse_a,
    referencesRfc: listeTexte(l.references_rfc),
    expediteur: l.expediteur || '',
    expediteurAdresse: l.expediteur_adresse || '',
    destinataires: listeTexte(l.destinataires),
    copies: listeTexte(l.copies),
    objet: l.objet || '',
    corpsExtrait: l.corps_extrait || '',
    libelles: listeTexte(l.libelles),
    direction: l.direction === 'sortant' ? 'sortant' : 'entrant',
    nbPiecesJointes: l.nb_pieces_jointes ?? 0,
    envoyeLe: l.envoye_le,
    recuLe: l.recu_le,
    resume: l.resume,
    resumeLe: l.resume_le,
    projetId: l.projet_id,
    phase: normaliserPhaseEchange(l.phase_effective),
    typeEchange: normaliserTypeEchange(l.type_echange_effectif),
    importance: normaliserImportance(l.importance_effective),
    rattachePar: l.rattache_par,
    rattacheLe: l.rattache_le,
    categorisePar: l.categorise_par,
    categoriseLe: l.categorise_le,
    traitePar: l.traite_par,
    traiteLe: l.traite_le,
    propose: {
      projetId: l.projet_id_propose,
      phase: normaliserPhaseEchange(l.phase_proposee),
      typeEchange: normaliserTypeEchange(l.type_echange_propose),
      importance: normaliserImportance(l.importance_proposee),
      confianceRattachement: l.confiance_rattachement,
      raisonsRattachement: listeTexte(l.raisons_rattachement),
      confianceCategorisation: l.confiance_categorisation,
      raisonsCategorisation: listeTexte(l.raisons_categorisation),
    },
  }
}

// ------------------------------------------------------------
// 2. Le filtre — déclaré UNE fois, appliqué des deux côtés
// ------------------------------------------------------------
//
// Un filtre vit deux vies : en SQL quand le réseau répond, en mémoire
// quand c'est le cache qui répond. Écrites à deux endroits sans lien,
// les deux versions divergent au premier ajout — et la divergence est
// invisible : hors ligne, la même question rend simplement d'autres
// lignes. D'où une table de critères où chaque champ porte SES DEUX
// traductions, côte à côte. `scripts/test-hors-ligne.cjs` vérifie que
// tout champ du filtre y figure.

export interface FiltreCommunications {
  /** tous les échanges de ce projet (§4.3) */
  projetId?: string
  /** la file « à rattacher » du §5.1 : aucun projet, ni proposé ni validé */
  sansProjet?: boolean
  /** tout ce fil (§4.2) */
  threadId?: string
  phase?: PhaseEchange
  /** plusieurs niveaux à la fois — « urgent ou bloquant », §8.2 */
  importances?: NiveauImportance[]
  direction?: 'entrant' | 'sortant'
  /** ce qui n'a pas encore été traité (§3.12 : `traite_le` nul) */
  nonTraite?: boolean
  /** borne basse sur la date d'envoi (ISO) */
  depuis?: string
}

type Contrainte =
  | { op: 'eq'; colonne: string; valeur: string }
  | { op: 'nul'; colonne: string }
  | { op: 'dans'; colonne: string; valeurs: string[] }
  | { op: 'depuis'; colonne: string; valeur: string }

interface Critere<C> {
  contraintes: (valeur: C) => Contrainte[]
  correspond: (c: Communication, valeur: C) => boolean
}

/** un critère par champ du filtre — les deux traductions au même endroit */
const CRITERES: { [K in keyof Required<FiltreCommunications>]: Critere<NonNullable<FiltreCommunications[K]>> } = {
  projetId: {
    contraintes: (v) => [{ op: 'eq', colonne: 'projet_id', valeur: v }],
    correspond: (c, v) => c.projetId === v,
  },
  sansProjet: {
    contraintes: (v) => (v ? [{ op: 'nul', colonne: 'projet_id' }] : []),
    correspond: (c, v) => !v || c.projetId === null,
  },
  threadId: {
    contraintes: (v) => [{ op: 'eq', colonne: 'gmail_thread_id', valeur: v }],
    correspond: (c, v) => c.gmailThreadId === v,
  },
  phase: {
    contraintes: (v) => [{ op: 'eq', colonne: 'phase_effective', valeur: v }],
    correspond: (c, v) => c.phase === v,
  },
  importances: {
    contraintes: (v) => (v.length ? [{ op: 'dans', colonne: 'importance_effective', valeurs: v }] : []),
    correspond: (c, v) => v.length === 0 || (c.importance !== null && v.includes(c.importance)),
  },
  direction: {
    contraintes: (v) => [{ op: 'eq', colonne: 'direction', valeur: v }],
    correspond: (c, v) => c.direction === v,
  },
  nonTraite: {
    contraintes: (v) => (v ? [{ op: 'nul', colonne: 'traite_le' }] : []),
    correspond: (c, v) => !v || c.traiteLe === null,
  },
  depuis: {
    contraintes: (v) => [{ op: 'depuis', colonne: 'envoye_le', valeur: v }],
    correspond: (c, v) => c.envoyeLe !== null && c.envoyeLe >= v,
  },
}

function contraintesDe(filtre: FiltreCommunications): Contrainte[] {
  const sortie: Contrainte[] = []
  for (const champ of Object.keys(CRITERES) as (keyof FiltreCommunications)[]) {
    const valeur = filtre[champ]
    if (valeur === undefined || valeur === null) continue
    const critere = CRITERES[champ] as Critere<unknown>
    sortie.push(...critere.contraintes(valeur))
  }
  return sortie
}

/** le même filtre, appliqué au cache */
export function correspondAuFiltre(c: Communication, filtre: FiltreCommunications): boolean {
  for (const champ of Object.keys(CRITERES) as (keyof FiltreCommunications)[]) {
    const valeur = filtre[champ]
    if (valeur === undefined || valeur === null) continue
    const critere = CRITERES[champ] as Critere<unknown>
    if (!critere.correspond(c, valeur)) return false
  }
  return true
}

// ------------------------------------------------------------
// 3. La pagination — par curseur, jamais par décalage
// ------------------------------------------------------------
//
// Le cron ingère toutes les dix minutes. Une pagination par `offset`
// décalerait les pages sous les doigts de la personne qui feuillette :
// un message arrivé entre deux pages en fait sauter un autre, sans
// erreur. Le curseur (date d'envoi, identifiant) est stable par
// construction, et il utilise l'index `(projet_id, envoye_le desc)` que
// la migration A.2 a posé pour exactement cette lecture.

export interface CurseurCommunications {
  envoyeLe: string | null
  id: string
}

export interface PageCommunications {
  lignes: Communication[]
  /** d'où vient cette page — `cache` signifie « ce que ce poste connaît »,
   *  et l'écran doit le dire : ce n'est pas « ce qui existe » */
  source: 'reseau' | 'cache'
  /** à passer à la lecture suivante ; `null` quand il n'y a pas de suite */
  curseur: CurseurCommunications | null
}

/** rang d'un message dans l'ordre d'affichage. Les messages sans date
 *  d'envoi passent en dernier — même règle que `nullsFirst: false` en SQL. */
function rangTemps(c: Pick<Communication, 'envoyeLe'>): number {
  if (!c.envoyeLe) return Number.NEGATIVE_INFINITY
  const t = Date.parse(c.envoyeLe)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

/** du plus récent au plus ancien, l'identifiant départageant les ex æquo */
function comparerDecroissant(a: Communication, b: Communication): number {
  const ta = rangTemps(a)
  const tb = rangTemps(b)
  if (ta !== tb) return tb - ta
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** vrai si `c` vient strictement après le curseur dans cet ordre */
function apresCurseur(c: Communication, curseur: CurseurCommunications): boolean {
  const tc = rangTemps(c)
  const tk = rangTemps(curseur)
  if (tc !== tk) return tc < tk
  return c.id < curseur.id
}

function curseurDe(c: Communication): CurseurCommunications {
  return { envoyeLe: c.envoyeLe, id: c.id }
}

// ------------------------------------------------------------
// 4. La lecture
// ------------------------------------------------------------

export interface OptionsLecture extends FiltreCommunications {
  taille?: number
  suiteDe?: CurseurCommunications | null
}

/**
 * Une page de messages — ou `null`.
 *
 * `null` veut dire « on ne sait pas » : ni session, ni cache pour cette
 * cible. Il ne veut jamais dire « aucun message ». Un tableau vide, lui,
 * est une réponse : le serveur a répondu, il n'y a rien. L'écran affiche
 * ces deux cas différemment, et c'est tout l'objet de la distinction — un
 * « 0 mail à traiter » affiché à quelqu'un qui n'est pas connecté est un
 * mensonge sur lequel on organise sa journée.
 *
 * `source: 'cache'` signale une réponse partielle par nature : ce que ce
 * poste a déjà vu, dans la fenêtre de 90 jours.
 */
export async function listerCommunications(
  options: OptionsLecture = {},
): Promise<PageCommunications | null> {
  const taille = Math.max(1, options.taille ?? TAILLE_PAGE)
  const sb = clientSupabase()
  if (!sb) return depuisLeCache(options, taille)

  try {
    let requete = sb.from(MAGASIN_COMMUNICATIONS).select(COLONNES)
    for (const contrainte of contraintesDe(options)) {
      if (contrainte.op === 'eq') requete = requete.eq(contrainte.colonne, contrainte.valeur)
      else if (contrainte.op === 'nul') requete = requete.is(contrainte.colonne, null)
      else if (contrainte.op === 'dans') requete = requete.in(contrainte.colonne, contrainte.valeurs)
      else requete = requete.gte(contrainte.colonne, contrainte.valeur)
    }
    const curseur = options.suiteDe
    if (curseur) {
      if (curseur.envoyeLe) {
        // …et la queue des messages sans date d'envoi, qui viennent après tout
        // le reste : l'oublier tronquerait la liste sans le dire.
        requete = requete.or(
          `envoye_le.lt."${curseur.envoyeLe}",and(envoye_le.eq."${curseur.envoyeLe}",id.lt.${curseur.id}),envoye_le.is.null`,
        )
      } else {
        requete = requete.is('envoye_le', null).lt('id', curseur.id)
      }
    }
    const { data, error } = await requete
      .order('envoye_le', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(taille + 1)
    if (error) throw new Error(error.message)

    const lues = ((data || []) as unknown as LigneCommunication[]).map(depuisLigne)
    void ecrireCache<Communication>(
      MAGASIN_COMMUNICATIONS,
      lues,
      (c) => c.id,
      (c) => c.envoyeLe,
    )
    const lignes = lues.slice(0, taille)
    return {
      lignes,
      source: 'reseau',
      curseur: lues.length > taille && lignes.length > 0 ? curseurDe(lignes[lignes.length - 1]) : null,
    }
  } catch (e) {
    // Réseau tombé en cours de route : le cache répond s'il peut, et l'appelant
    // voit `source: 'cache'`. S'il ne peut pas, l'erreur remonte — elle est
    // plus honnête qu'une liste vide.
    const repli = await depuisLeCache(options, taille)
    if (repli) return repli
    throw new Error(`Messages illisibles : ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function depuisLeCache(
  options: OptionsLecture,
  taille: number,
): Promise<PageCommunications | null> {
  const cache = await lireCache<Communication>(MAGASIN_COMMUNICATIONS)
  if (!cache) return null
  const retenues = cache.lignes
    .filter((c) => correspondAuFiltre(c, options))
    .sort(comparerDecroissant)
    .filter((c) => !options.suiteDe || apresCurseur(c, options.suiteDe))
  const lignes = retenues.slice(0, taille)
  return {
    lignes,
    source: 'cache',
    curseur: retenues.length > taille && lignes.length > 0 ? curseurDe(lignes[lignes.length - 1]) : null,
  }
}

// ------------------------------------------------------------
// 5. Les écritures — par la file, donc hors ligne comprises
// ------------------------------------------------------------

/** Aucune signature anonyme.
 *
 *  `useMoi()` rend `null` quand l'application ne sait pas qui est devant
 *  l'écran, et le contrat des modules est explicite : « null veut dire null —
 *  un écran qui ne sait pas qui est là ne doit rien signer ». Ici la
 *  conséquence est mécanique et non morale : c'est la signature
 *  (`categorise_par`, `rattache_par`) qui fait basculer les colonnes
 *  générées. Une correction non signée ne s'appliquerait tout simplement
 *  pas — elle serait perdue en paraissant faite. */
function exigerSignataire(par: string): string {
  const nom = (par || '').trim()
  if (!nom)
    throw new Error(
      'Impossible de signer cette correction : l’application ne sait pas qui est connecté. Choisissez « je suis… » dans les Paramètres.',
    )
  return nom
}

async function ecrire(
  c: Communication,
  valeurs: Record<string, unknown>,
  patch: (courant: Communication) => Communication,
): Promise<void> {
  await patcherCache<Communication>(MAGASIN_COMMUNICATIONS, c.id, patch)
  const enfilee = await enfiler(MAGASIN_COMMUNICATIONS, c.id, valeurs)
  if (!enfilee)
    throw new Error(
      'Aucun espace partagé n’est configuré : cette correction n’a nulle part où partir (Paramètres → Synchronisation).',
    )
}

/** « ✓ Fait » du §3.12 — nominatif et daté, à la place du statut binaire de
 *  `Courrier`. Réversible : rouvrir efface la marque et signe la réouverture. */
export async function marquerTraite(c: Communication, par: string, fait = true): Promise<void> {
  const nom = exigerSignataire(par)
  const le = new Date().toISOString()
  await ecrire(
    c,
    { traite_par: fait ? nom : null, traite_le: fait ? le : null },
    (courant) => ({
      ...courant,
      traitePar: fait ? nom : null,
      traiteLe: fait ? le : null,
    }),
  )
}

/** corrige le rattachement au projet (§5.1 : « doit être modifiable »).
 *  `null` détache explicitement : le message retourne dans la file
 *  « à rattacher », et la proposition de la machine ne le reprend pas —
 *  c'est `rattache_par` qui commande la colonne générée. */
export async function corrigerRattachement(
  c: Communication,
  projetId: string | null,
  par: string,
): Promise<void> {
  const nom = exigerSignataire(par)
  const le = new Date().toISOString()
  await ecrire(
    c,
    { projet_id_valide: projetId, rattache_par: nom, rattache_le: le },
    (courant) => ({ ...courant, projetId, rattachePar: nom, rattacheLe: le }),
  )
}

/** les trois axes du §5.2 — voir l'en-tête : les TROIS colonnes humaines
 *  sont réécrites, parce que `categorise_par` les commande toutes. */
export async function corrigerAxes(
  c: Communication,
  axes: {
    phase?: PhaseEchange | null
    typeEchange?: TypeEchange | null
    importance?: NiveauImportance | null
  },
  par: string,
): Promise<void> {
  const nom = exigerSignataire(par)
  const le = new Date().toISOString()
  const phase = axes.phase === undefined ? c.phase : axes.phase
  const typeEchange = axes.typeEchange === undefined ? c.typeEchange : axes.typeEchange
  const importance = axes.importance === undefined ? c.importance : axes.importance
  await ecrire(
    c,
    {
      phase,
      type_echange: typeEchange,
      importance,
      categorise_par: nom,
      categorise_le: le,
    },
    (courant) => ({
      ...courant,
      phase,
      typeEchange,
      importance,
      categorisePar: nom,
      categoriseLe: le,
    }),
  )
}

/** L'exécuteur : comment une écriture de la file s'applique réellement.
 *
 *  Enregistré à l'import du module, parce que la file ne connaît aucune
 *  table par elle-même. L'`update` vise la clé primaire et porte des valeurs
 *  absolues : le rejouer deux fois donne le même état — c'est l'idempotence
 *  du §24, obtenue sans rien demander au schéma. */
enregistrerExecuteur(MAGASIN_COMMUNICATIONS, async (ecriture) => {
  const sb = clientSupabase()
  if (!sb) throw new Error('Espace partagé non connecté.')
  const { error } = await sb
    .from(MAGASIN_COMMUNICATIONS)
    .update(ecriture.valeurs)
    .eq('id', ecriture.cle)
  if (error) throw new Error(`Correction refusée par le serveur : ${error.message}`)
})

// ------------------------------------------------------------
// 6. Le hook
// ------------------------------------------------------------

export interface EtatCommunications {
  /** `null` = on ne sait pas encore. JAMAIS `[]` par défaut. */
  lignes: Communication[] | null
  source: 'reseau' | 'cache' | null
  chargement: boolean
  erreur: string | null
  /** vrai s'il reste des pages */
  suite: boolean
  chargerSuite: () => void
  recharger: () => void
}

/**
 * Lecture paginée réactive. Trois relectures automatiques, et pas une de
 * plus : à l'ouverture, 2,5 s après (la session du lien magique s'ouvre en
 * asynchrone — c'est déjà le motif de `useNbEntrantsDistants`), et à chaque
 * changement de session. Le retour du réseau, lui, est déjà branché sur la
 * file d'écritures par `src/horsLigne.ts`.
 */
export function useCommunications(filtre: FiltreCommunications, taille = TAILLE_PAGE): EtatCommunications {
  const cle = JSON.stringify({ filtre, taille })
  const options = useMemo<OptionsLecture>(() => ({ ...JSON.parse(cle).filtre, taille }), [cle, taille])
  const [lignes, setLignes] = useState<Communication[] | null>(null)
  const [source, setSource] = useState<'reseau' | 'cache' | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(false)
  const [curseur, setCurseur] = useState<CurseurCommunications | null>(null)
  const [generation, setGeneration] = useState(0)
  const vivant = useRef(true)

  useEffect(() => {
    vivant.current = true
    return () => {
      vivant.current = false
    }
  }, [])

  const lire = useCallback(
    async (suiteDe: CurseurCommunications | null) => {
      setChargement(true)
      try {
        const page = await listerCommunications({ ...options, suiteDe })
        if (!vivant.current) return
        setErreur(null)
        if (!page) {
          // ni session ni cache : on ne sait pas, et on le dit en ne
          // remplaçant rien par une liste vide
          if (!suiteDe) {
            setLignes(null)
            setSource(null)
            setCurseur(null)
          }
          return
        }
        setSource(page.source)
        setCurseur(page.curseur)
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

  return { lignes, source, chargement, erreur, suite: curseur !== null, chargerSuite, recharger }
}
