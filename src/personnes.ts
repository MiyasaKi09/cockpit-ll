// ============================================================
// Les personnes sont référencées PAR LEUR NOM dans tout l'état :
// les heures pointées, les absences, les responsables de projet,
// les destinataires de courrier… Renommer quelqu'un dans les
// Paramètres sans réécrire ces références orpheline ses heures —
// elles disparaissent du Pilotage et de la marge sans erreur.
//
// Ce module tient l'inventaire exhaustif de ces références. Toute
// nouvelle collection portant un nom de personne doit être ajoutée
// ici, et le test scripts/test-renommage-personne.cjs vérifie que
// l'inventaire ne se démode pas.
// ============================================================

import type { AppState } from './types'

/** un endroit de l'état qui porte un nom de personne */
interface Reference {
  /** libellé lisible, utilisé par les messages d'avertissement */
  libelle: string
  /** réécrit les occurrences de `ancien` en `nouveau`, renvoie le nombre touché */
  reecrire: (state: AppState, ancien: string, nouveau: string) => number
  /** compte les occurrences de `nom` sans rien modifier */
  compter: (state: AppState, nom: string) => number
}

/** fabrique une référence sur un champ texte simple d'une collection */
function champTexte<T>(
  libelle: string,
  collection: (state: AppState) => T[] | undefined,
  lire: (item: T) => string | undefined,
  ecrire: (item: T, valeur: string) => void,
): Reference {
  return {
    libelle,
    compter: (state, nom) => (collection(state) || []).filter((i) => lire(i) === nom).length,
    reecrire: (state, ancien, nouveau) => {
      let touches = 0
      for (const item of collection(state) || []) {
        if (lire(item) !== ancien) continue
        ecrire(item, nouveau)
        touches++
      }
      return touches
    },
  }
}

/** fabrique une référence sur un champ tableau-de-noms d'une collection */
function champListe<T>(
  libelle: string,
  collection: (state: AppState) => T[] | undefined,
  lire: (item: T) => string[] | undefined,
  ecrire: (item: T, valeur: string[]) => void,
): Reference {
  return {
    libelle,
    compter: (state, nom) =>
      (collection(state) || []).filter((i) => (lire(i) || []).includes(nom)).length,
    reecrire: (state, ancien, nouveau) => {
      let touches = 0
      for (const item of collection(state) || []) {
        const liste = lire(item)
        if (!liste || !liste.includes(ancien)) continue
        // dédoublonne : renommer vers un nom déjà présent ne doit pas
        // laisser la personne deux fois dans la même équipe
        ecrire(item, [...new Set(liste.map((n) => (n === ancien ? nouveau : n)))])
        touches++
      }
      return touches
    },
  }
}

/** l'inventaire exhaustif — treize sites au 31 juillet 2026 */
export const REFERENCES_PERSONNE: Reference[] = [
  {
    // la fiche de l'équipe elle-même : l'appelant de l'interface l'a en général
    // déjà réécrite, mais la fonction doit rester correcte depuis n'importe
    // quel appelant — la réécriture est idempotente
    libelle: 'fiche de l’équipe',
    compter: (state, nom) => (state.settings.equipe || []).filter((p) => p.nom === nom).length,
    reecrire: (state, ancien, nouveau) => {
      let touches = 0
      for (const p of state.settings.equipe || []) {
        if (p.nom !== ancien) continue
        p.nom = nouveau
        touches++
      }
      return touches
    },
  },
  champTexte<{ personne: string }>(
    'heures pointées',
    (s) => s.temps,
    (t) => t.personne,
    (t, v) => {
      t.personne = v
    },
  ),
  champTexte<{ personne: string }>(
    'heures hors projet',
    (s) => s.tempsHorsProjet,
    (t) => t.personne,
    (t, v) => {
      t.personne = v
    },
  ),
  champTexte<{ personne: string }>(
    'absences',
    (s) => s.absences,
    (a) => a.personne,
    (a, v) => {
      a.personne = v
    },
  ),
  champTexte<{ responsable?: string }>(
    'projets dont la personne est responsable',
    (s) => s.projets,
    (p) => p.responsable,
    (p, v) => {
      p.responsable = v
    },
  ),
  champTexte<{ coResponsable?: string }>(
    'projets dont la personne est co-responsable',
    (s) => s.projets,
    (p) => p.coResponsable,
    (p, v) => {
      p.coResponsable = v
    },
  ),
  champListe<{ equipeProjet?: string[] }>(
    'équipes de projet',
    (s) => s.projets,
    (p) => p.equipeProjet,
    (p, v) => {
      p.equipeProjet = v
    },
  ),
  champTexte<{ pour?: string }>(
    'courriers à traiter',
    (s) => s.courriers,
    (c) => c.pour,
    (c, v) => {
      c.pour = v
    },
  ),
  champTexte<{ pour?: string }>(
    'situations de travaux',
    (s) => s.situations,
    (x) => x.pour,
    (x, v) => {
      x.pour = v
    },
  ),
  champTexte<{ pour?: string }>(
    'dossiers de poursuite',
    (s) => s.consultations,
    (c) => c.pour,
    (c, v) => {
      c.pour = v
    },
  ),
  champTexte<{ responsable?: string }>(
    'décisions de direction',
    (s) => s.decisionsDirection,
    (d) => d.responsable,
    (d, v) => {
      d.responsable = v
    },
  ),
  {
    // les exigences vivent DANS les dossiers de poursuite : un aplatissement
    // suffit, la mutation porte sur l'objet et non sur la copie
    libelle: 'exigences de dossier',
    compter: (state, nom) =>
      (state.consultations || [])
        .flatMap((c) => c.exigences || [])
        .filter((e) => e.responsable === nom).length,
    reecrire: (state, ancien, nouveau) => {
      let touches = 0
      for (const dossier of state.consultations || []) {
        for (const exigence of dossier.exigences || []) {
          if (exigence.responsable !== ancien) continue
          exigence.responsable = nouveau
          touches++
        }
      }
      return touches
    },
  },
  {
    libelle: 'liste des personnes',
    compter: (state, nom) => (state.settings.personnes || []).filter((p) => p === nom).length,
    reecrire: (state, ancien, nouveau) => {
      const liste = state.settings.personnes || []
      if (!liste.includes(ancien)) return 0
      state.settings.personnes = [...new Set(liste.map((p) => (p === ancien ? nouveau : p)))]
      return 1
    },
  },
]

/** combien d'objets de l'état citent cette personne, et où */
export function referencesDe(state: AppState, nom: string): { libelle: string; nb: number }[] {
  if (!nom) return []
  return REFERENCES_PERSONNE.map((r) => ({ libelle: r.libelle, nb: r.compter(state, nom) })).filter(
    (r) => r.nb > 0,
  )
}

/**
 * Renomme une personne PARTOUT dans l'état, en une seule passe.
 * À appeler dans un `update()` : la fonction mute l'ébauche reçue.
 * Renvoie le nombre total de références réécrites.
 */
export function renommerPersonne(state: AppState, ancien: string, nouveau: string): number {
  const avant = (ancien || '').trim()
  const apres = (nouveau || '').trim()
  // un nom vide effacerait des références sans possibilité de les retrouver
  if (!avant || !apres || avant === apres) return 0
  return REFERENCES_PERSONNE.reduce((total, r) => total + r.reecrire(state, avant, apres), 0)
}
