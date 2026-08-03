// ============================================================
// A.7 — la boîte « À traiter », pendant la bascule de mémoire.
//
// Ce module est TEMPORAIRE, et il le dit : il n'existe que le temps où
// les deux mémoires du courrier cohabitent. `state.courriers`, écrit par
// la surveillance navigateur (`src/surveillance.ts`), et la table
// `communications` (A.2), écrite par le cron serveur, décrivent le même
// courrier pendant toute la transition. B.15 supprime la première — pas
// avant sept jours consécutifs de parité mesurée en production.
//
// Couper l'ancienne source avant que la nouvelle soit prouvée ne casserait
// pas la file quotidienne : elle la viderait en silence. Une file vide ne
// ressemble pas à une panne, elle ressemble à une journée calme — c'est
// précisément ce qui la rend dangereuse.
//
// La fusion vit ici, hors de React, parce qu'elle porte les deux seules
// décisions qui peuvent faire perdre un mail : le dédoublonnage et l'ordre.
// ============================================================

import type { Courrier } from './types'
import type { Communication } from './communications'
import { estImportance, graviteDe } from './categorisation'
import { identifiantGmailDe, lienGmail } from './util'

// ------------------------------------------------------------
// B.18 — mesurer la parité entre les deux mémoires
// ------------------------------------------------------------
//
// B.15 coupe l'ingestion navigateur sous condition de « sept jours
// consécutifs en production sans écart entre les deux mémoires ». Cette
// phrase est citée trois fois dans le plan comme non négociable — et rien
// ne la mesurait. Une condition qu'on ne mesure pas n'est pas une
// condition : c'est une intention, et elle cède le jour où quelqu'un est
// pressé.
//
// Ce que l'outil compare, et ce qu'il refuse de comparer :
//
//   * seuls les `Courrier` PORTANT UN IDENTIFIANT GMAIL entrent dans la
//     comparaison. La moitié du dépôt n'en a pas — routines importées,
//     saisies à la main — et les compter comme manquants côté relationnel
//     produirait un écart permanent qui masquerait les vrais ;
//   * la fenêtre est donnée par l'appelant. Avant le déploiement du cron,
//     chaque jour montrerait « absent du relationnel » pour tout : le
//     signal se noierait dans son propre bruit.

export type GenreEcart =
  | 'absent_du_relationnel'
  | 'absent_de_l_ancien'
  | 'projet_divergent'
  | 'expediteur_divergent'

export const LIBELLES_ECART: Record<GenreEcart, string> = {
  absent_du_relationnel: 'Vu par le navigateur, absent de la table',
  absent_de_l_ancien: 'Indexé par le serveur, jamais vu par le navigateur',
  projet_divergent: 'Rattaché à deux projets différents',
  expediteur_divergent: 'Expéditeur différent d’une mémoire à l’autre',
}

export interface Ecart {
  genre: GenreEcart
  gmailId: string
  objet: string
  detail: string
}

export interface PariteJour {
  jour: string
  nbAncien: number
  nbRelationnel: number
  ecarts: Ecart[]
}

/** le jour d'un horodatage ISO, ou null */
function jourDe(iso: string | null | undefined): string | null {
  const v = (iso || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

/** adresse comparable : casse, espaces et forme « Nom <adresse> » */
function adresse(valeur: string | null | undefined): string {
  const brut = (valeur || '').trim().toLowerCase()
  const chevrons = /<([^>]+)>/.exec(brut)
  return (chevrons ? chevrons[1] : brut).trim()
}

/**
 * Compare les deux mémoires, jour par jour, sur la fenêtre donnée.
 *
 * Le jour retenu est celui de RÉCEPTION des deux côtés — `dateReception`
 * pour l'ancienne, `recuLe` à défaut `envoyeLe` pour la nouvelle. Comparer
 * une date de réception à une date d'envoi ferait apparaître un écart à
 * chaque message retenu par un relais, c'est-à-dire régulièrement, et
 * l'outil deviendrait illisible au bout d'une semaine.
 */
export function comparerMemoires(
  courriers: Courrier[],
  messages: Communication[],
  fenetre: { debut: string; fin: string },
): PariteJour[] {
  const anciens = new Map<string, { courrier: Courrier; jour: string }>()
  for (const c of courriers || []) {
    // `identifiantGmailDe` rend le dernier segment de N'IMPORTE QUEL texte :
    // « routine tri du matin » en ressort comme un identifiant. Pour le
    // dédoublonnage d'affichage c'est sans conséquence — aucun message ne
    // porte cet identifiant-là. Pour une MESURE, c'est un écart permanent
    // qui masquerait les vrais. On exige donc la forme réelle, et
    // `lienGmail` en est le seul juge du dépôt.
    const id = lienGmail(c.source) ? identifiantGmailDe(c.source) : null
    const jour = jourDe(c.dateReception)
    if (!id || !jour) continue
    if (jour < fenetre.debut || jour > fenetre.fin) continue
    if (!anciens.has(id)) anciens.set(id, { courrier: c, jour })
  }

  const neufs = new Map<string, { message: Communication; jour: string }>()
  for (const m of messages || []) {
    const id = m.gmailMessageId
    const jour = jourDe(m.recuLe) || jourDe(m.envoyeLe)
    if (!id || !jour) continue
    if (jour < fenetre.debut || jour > fenetre.fin) continue
    if (!neufs.has(id)) neufs.set(id, { message: m, jour })
  }

  const parJour = new Map<string, PariteJour>()
  const jour = (j: string): PariteJour => {
    let entree = parJour.get(j)
    if (!entree) {
      entree = { jour: j, nbAncien: 0, nbRelationnel: 0, ecarts: [] }
      parJour.set(j, entree)
    }
    return entree
  }

  for (const [id, { courrier, jour: j }] of anciens) {
    jour(j).nbAncien++
    const cote = neufs.get(id)
    if (!cote) {
      jour(j).ecarts.push({
        genre: 'absent_du_relationnel',
        gmailId: id,
        objet: courrier.objet || '(sans objet)',
        detail: 'Le cron serveur ne l’a pas indexé. C’est l’écart qui interdit la coupure.',
      })
      continue
    }
    // Rattachement : `null` d'un côté n'est pas une divergence — c'est
    // « pas encore rattaché », et les deux mémoires n'apprennent pas au
    // même rythme. Deux projets DIFFÉRENTS, en revanche, en est une.
    if (courrier.projetId && cote.message.projetId && courrier.projetId !== cote.message.projetId) {
      jour(j).ecarts.push({
        genre: 'projet_divergent',
        gmailId: id,
        objet: courrier.objet || '(sans objet)',
        detail: `${courrier.projetId} d’un côté, ${cote.message.projetId} de l’autre.`,
      })
    }
    const de = adresse(courrier.de)
    const deCote = adresse(cote.message.expediteurAdresse || cote.message.expediteur)
    if (de && deCote && de !== deCote) {
      jour(j).ecarts.push({
        genre: 'expediteur_divergent',
        gmailId: id,
        objet: courrier.objet || '(sans objet)',
        detail: `${de} d’un côté, ${deCote} de l’autre.`,
      })
    }
  }

  for (const [id, { message, jour: j }] of neufs) {
    jour(j).nbRelationnel++
    if (anciens.has(id)) continue
    // Pas un défaut en soi : le serveur voit plus large que le navigateur
    // (il ne dépend pas d'un onglet ouvert). On le montre quand même —
    // c'est ce qui permet de constater que la nouvelle mémoire est
    // effectivement plus complète, au lieu de l'espérer.
    jour(j).ecarts.push({
      genre: 'absent_de_l_ancien',
      gmailId: id,
      objet: message.objet || '(sans objet)',
      detail: 'Attendu : le serveur ne dépend pas d’un onglet ouvert.',
    })
  }

  return [...parJour.values()].sort((a, b) => b.jour.localeCompare(a.jour))
}

/** les genres d'écart qui INTERDISENT la coupure de B.15.
 *
 *  « Indexé par le serveur et pas par le navigateur » n'en fait pas
 *  partie : c'est le gain attendu, pas une perte. Le compter bloquerait la
 *  coupure pour la raison même qui la justifie. */
export const ECARTS_BLOQUANTS = new Set<GenreEcart>([
  'absent_du_relationnel',
  'projet_divergent',
  'expediteur_divergent',
])

/**
 * Le nombre de jours CONSÉCUTIFS sans écart bloquant, en partant du plus
 * récent — c'est-à-dire la réponse exacte à la condition de B.15.
 *
 * Un jour sans aucun message des deux côtés n'est pas « sans écart » : il
 * est sans information. Le compter offrirait sept jours de congés comme
 * preuve de parité, ce qui est précisément l'inverse d'une mesure.
 */
export function joursConsecutifsSansEcart(parite: PariteJour[]): number {
  let n = 0
  for (const j of parite) {
    if (j.nbAncien === 0 && j.nbRelationnel === 0) break
    if (j.ecarts.some((e) => ECARTS_BLOQUANTS.has(e.genre))) break
    n++
  }
  return n
}

/** le seuil du plan, cité trois fois comme non négociable */
export const JOURS_DE_PARITE_EXIGES = 7

/** une entrée de la boîte, avec la mémoire dont elle vient */
export type EntreeBoite =
  | {
      genre: 'message'
      message: Communication
      /** l'ancien `Courrier` qui décrit le même mail, s'il en reste un */
      jumeau: Courrier | null
    }
  | { genre: 'courrier'; courrier: Courrier }

/** l'urgence d'une entrée, sur l'échelle 0-3 commune aux deux mémoires.
 *
 *  Les deux sources partagent bien UNE échelle : `graviteDe` est la
 *  réciproque exacte d'`importanceDepuisUrgence`, qui a rempli les axes
 *  des anciens `Courrier` au palier v19. Sans cela, trier ensemble
 *  reviendrait à comparer des unités différentes. */
export function urgenceDe(e: EntreeBoite): number {
  if (e.genre === 'courrier') return e.courrier.urgence || 0
  const i = e.message.importance
  return estImportance(i) ? graviteDe(i) : 0
}

/** la date qui sert au tri — celle où le mail nous est parvenu */
export function dateDe(e: EntreeBoite): string {
  if (e.genre === 'courrier') return e.courrier.dateReception || ''
  return e.message.envoyeLe || e.message.recuLe || ''
}

/**
 * Fusionne les deux mémoires en une seule file, triée comme avant :
 * urgence décroissante, puis date de réception croissante.
 *
 * Deux décisions, et ce sont les seules qui comptent ici.
 *
 * **Le dédoublonnage.** Le même mail existe des deux côtés ; l'identifiant
 * Gmail les réconcilie. C'est la ligne RELATIONNELLE qui l'emporte : elle
 * porte le projet, les trois axes du §5.2 et une signature nominative,
 * là où `Courrier.statut` n'a qu'un booléen anonyme. Le `Courrier` jumeau
 * n'est pas jeté pour autant — il voyage avec le message, parce que le
 * traiter doit marquer les DEUX. Marquer le seul message laisserait le
 * vieux `Courrier` ressortir dès que la table est hors de portée (hors
 * ligne, cache froid), et le mail réapparaîtrait après avoir été réglé.
 *
 * **L'ordre.** Un seul tri sur la file entière, pas deux listes empilées :
 * empiler aurait classé l'urgent d'une source derrière l'ordinaire de
 * l'autre, ce que personne ne remarque et que tout le monde subit.
 *
 * Un `Courrier` sans identifiant Gmail — la moitié du dépôt : routines
 * importées, saisies à la main — n'a pas de jumeau possible et reste donc
 * toujours affiché. C'est voulu : l'absence d'identifiant n'est pas une
 * preuve de doublon.
 */
export function fusionnerBoite(courriers: Courrier[], messages: Communication[]): EntreeBoite[] {
  const jumeauParId = new Map<string, Courrier>()
  for (const c of courriers) {
    const id = identifiantGmailDe(c.source)
    // le premier gagne : deux `Courrier` sur un même identifiant sont déjà
    // une anomalie, en apparier un seul évite d'en marquer un au hasard
    if (id && !jumeauParId.has(id)) jumeauParId.set(id, c)
  }

  const repris = new Set<string>()
  const entrees: EntreeBoite[] = []
  for (const m of messages) {
    const jumeau = m.gmailMessageId ? jumeauParId.get(m.gmailMessageId) : undefined
    if (m.gmailMessageId) repris.add(m.gmailMessageId)
    entrees.push({ genre: 'message', message: m, jumeau: jumeau ?? null })
  }
  for (const c of courriers) {
    const id = identifiantGmailDe(c.source)
    if (id && repris.has(id)) continue
    entrees.push({ genre: 'courrier', courrier: c })
  }

  return entrees.sort(
    (a, b) => urgenceDe(b) - urgenceDe(a) || dateDe(a).localeCompare(dateDe(b)),
  )
}
