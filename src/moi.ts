// ============================================================
// Qui est devant l'écran — identité à DEUX ÉTAGES.
//
// Étage 1 — la session Supabase : si elle est ouverte, la personne de
// l'équipe dont l'adresse correspond à celle du compte connecté.
// Étage 2 — le repli PAR POSTE : un choix « je suis X » mémorisé dans le
// localStorage du navigateur. Ce repli n'est pas une facilité : la
// synchronisation est optionnelle et revendiquée comme telle, le Cockpit
// s'utilise hors ligne et sans session, et il doit rester utilisable.
// À défaut des deux : `null`, et chaque écran garde exactement son
// comportement actuel — aucune régression.
//
// Le choix par poste ne va JAMAIS dans `settings` : settings part dans le
// document partagé, et les deux postes s'écraseraient mutuellement — Julien
// deviendrait Zoé au premier aller-retour de synchronisation.
//
// La clé de rattachement reste le NOM (c'est ce que portent les heures
// pointées, les responsabilités, les champs `pour` — voir personnes.ts).
// L'adresse n'est qu'un pont entre un compte et une personne.
// ============================================================

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { Personne } from './types'
import { useStore } from './store'
import { abonnerSession, instantaneSession, type InstantaneSession } from './sync'

/** choix « je suis X » — propre à ce navigateur, jamais synchronisé */
const CLE_MOI = 'cockpit-ll-moi'

/** d'où vient l'identité affichée */
export type SourceIdentite = 'session' | 'poste' | 'aucune'

export interface Moi {
  /** la personne reconnue, ou null si l'application ne sait pas qui est là */
  personne: Personne | null
  /** son nom — la clé de rattachement dans tout l'état */
  nom: string | null
  source: SourceIdentite
  /** adresse de la session Supabase ouverte, s'il y en a une */
  emailSession: string | null
  /** une session est ouverte mais aucune personne ne porte cette adresse :
   *  l'écran doit pouvoir le dire et renvoyer vers les Paramètres */
  sessionOrpheline: boolean
  /** mémorise « je suis X » sur CE poste (null pour oublier) */
  choisir: (nom: string | null) => void
}

/** Normalise une adresse pour la comparaison. Une adresse est insensible à
 *  la casse : « Prenom@Agence-LL.fr » doit reconnaître « prenom@agence-ll.fr ».
 *  Aucun domaine n'est présumé — le futur `prenom@agence-ll.fr` comme les
 *  adresses actuelles passent par le même chemin. */
export function normaliserEmail(valeur: string | null | undefined): string {
  return (valeur || '').trim().toLowerCase()
}

/**
 * Résolution pure des deux étages, sans React ni stockage : c'est ici que
 * vit la règle, et c'est elle que le test statique exerce.
 * Ordre : session reconnue, puis choix du poste, puis rien.
 */
export function resoudreMoi(
  equipe: Personne[],
  emailSession: string | null,
  choixPoste: string | null,
): { personne: Personne | null; source: SourceIdentite } {
  const liste = Array.isArray(equipe) ? equipe : []
  const cible = normaliserEmail(emailSession)
  if (cible) {
    const parSession = liste.find((p) => normaliserEmail(p.email) === cible)
    if (parSession) return { personne: parSession, source: 'session' }
  }
  const nomChoisi = (choixPoste || '').trim()
  if (nomChoisi) {
    // un choix devenu introuvable (personne partie, renommée) ne doit pas
    // désigner quelqu'un d'autre : on préfère ne rien affirmer
    const parPoste = liste.find((p) => p.nom.trim() === nomChoisi)
    if (parPoste) return { personne: parPoste, source: 'poste' }
  }
  return { personne: null, source: 'aucune' }
}

// ----- étage 2 : le choix mémorisé sur le poste (observable) -----

const abonnesPoste = new Set<() => void>()

function lireChoixPoste(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const brut = localStorage.getItem(CLE_MOI)
    return brut && brut.trim() ? brut.trim() : null
  } catch {
    return null
  }
}

let choixPosteCourant: string | null = lireChoixPoste()

/** choix « je suis X » de ce poste (hors React) */
export function identitePoste(): string | null {
  return choixPosteCourant
}

/** enregistre le choix de ce poste et prévient les écrans */
export function definirIdentitePoste(nom: string | null): void {
  const valeur = (nom || '').trim() || null
  if (valeur === choixPosteCourant) return
  choixPosteCourant = valeur
  try {
    if (typeof localStorage !== 'undefined') {
      if (valeur) localStorage.setItem(CLE_MOI, valeur)
      else localStorage.removeItem(CLE_MOI)
    }
  } catch {
    /* stockage indisponible : le choix vivra le temps de la session */
  }
  for (const abonne of [...abonnesPoste]) {
    try {
      abonne()
    } catch {
      /* un abonné en échec ne prive pas les autres de la notification */
    }
  }
}

function abonnerPoste(ecouteur: () => void): () => void {
  abonnesPoste.add(ecouteur)
  return () => {
    abonnesPoste.delete(ecouteur)
  }
}

// ----- hooks -----

/** Session Supabase, RÉACTIVE : le composant se re-rend à la connexion
 *  comme à la déconnexion, sans rechargement de page. */
export function useSessionSupabase(): InstantaneSession {
  return useSyncExternalStore(abonnerSession, instantaneSession, instantaneSession)
}

/** choix « je suis X » de ce poste, réactif */
export function useIdentitePoste(): string | null {
  return useSyncExternalStore(abonnerPoste, identitePoste, identitePoste)
}

/**
 * Qui est devant l'écran. Ne devine jamais : sans session reconnue et sans
 * choix de poste, renvoie `null` plutôt que le premier de la liste.
 */
export function useMoi(): Moi {
  const { state } = useStore()
  const session = useSessionSupabase()
  const choixPoste = useIdentitePoste()
  const equipe = state.settings.equipe
  const choisir = useCallback((nom: string | null) => definirIdentitePoste(nom), [])

  return useMemo(() => {
    const emailSession = session.connecte ? session.email : null
    const { personne, source } = resoudreMoi(equipe, emailSession, choixPoste)
    return {
      personne,
      nom: personne?.nom ?? null,
      source,
      emailSession,
      sessionOrpheline: !!emailSession && source !== 'session',
      choisir,
    }
  }, [equipe, session.connecte, session.email, choixPoste, choisir])
}
