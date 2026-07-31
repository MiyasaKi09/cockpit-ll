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
import { identifiantGmailDe } from './util'

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
