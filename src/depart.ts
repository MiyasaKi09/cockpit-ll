// ============================================================
// B.14 — le départ d'un membre (§12.2 « transfert des tâches ouvertes »).
//
// Le plan v1 n'en parlait pas : zéro occurrence. Or `retirer()` supprime
// aujourd'hui la personne de `settings.equipe` et de `settings.personnes`,
// avertit que ses heures restent, et s'arrête là. Elle demeure
// `responsable` de ses projets — et depuis B.1, ses tâches ouvertes
// deviennent orphelines sans que personne le voie.
//
// « Sans que personne le voie » est le point. Une tâche dont le
// responsable n'existe plus ne disparaît pas de l'état : elle disparaît
// de « mes tâches » de TOUT LE MONDE, et du plan de charge. Elle est là,
// et plus personne ne la regarde.
//
// DEUX DÉCISIONS
// --------------
// 1. **Désactiver, pas supprimer.** L'historique et les pointages restent
//    valorisés : un an de temps passé ne s'efface pas parce que quelqu'un
//    est parti. `Personne.actif = false` retire les droits et la sort des
//    listes de choix, sans toucher à ce qu'elle a produit.
// 2. **Rien n'est réattribué en silence.** L'écran LISTE ce qui doit être
//    repris et demande à qui. Réattribuer d'office au premier de la liste
//    ferait apparaître dans la file de quelqu'un des tâches dont il n'a
//    jamais entendu parler.
// ============================================================

import type { AppState, TacheInterne } from './types'
import { estOuverte } from './taches'

export interface AReprendre {
  /** tâches ouvertes dont la personne est responsable */
  taches: TacheInterne[]
  /** projets où elle est responsable ou co-responsable */
  projets: { id: string; role: 'responsable' | 'coResponsable' }[]
  /** projets où elle figure dans l'équipe — à retirer, pas à réattribuer */
  equipes: string[]
  /** vrai si un chrono tourne encore à son nom (B.6) */
  chronoEnCours: boolean
}

/**
 * Ce qui doit être repris avant qu'une personne parte.
 *
 * Les tâches TERMINÉES et ANNULÉES sont exclues : elles appartiennent à
 * l'historique, et les faire réattribuer donnerait à quelqu'un la charge
 * de travaux déjà faits. C'est `estOuverte` qui tranche — la même
 * définition que partout ailleurs, pour qu'une tâche annulée ne
 * réapparaisse pas ici seulement.
 */
export function aReprendre(state: AppState, personne: string, chronoEnCours = false): AReprendre {
  const nom = (personne || '').trim()
  if (!nom) return { taches: [], projets: [], equipes: [], chronoEnCours: false }

  const taches = (state.taches || []).filter((t) => t.responsable === nom && estOuverte(t))

  const projets: AReprendre['projets'] = []
  const equipes: string[] = []
  for (const p of state.projets || []) {
    if (p.responsable === nom) projets.push({ id: p.id, role: 'responsable' })
    if (p.coResponsable === nom) projets.push({ id: p.id, role: 'coResponsable' })
    if ((p.equipeProjet || []).includes(nom)) equipes.push(p.id)
  }

  return { taches, projets, equipes, chronoEnCours }
}

/** rien à reprendre ⇒ le départ peut se faire sans réattribution */
export function departSansReprise(a: AReprendre): boolean {
  return a.taches.length === 0 && a.projets.length === 0 && a.equipes.length === 0 && !a.chronoEnCours
}

export interface ResultatReprise {
  taches: number
  projets: number
  equipes: number
}

/**
 * Réattribue tout ce qui doit l'être, en une fois.
 *
 * `vers` est obligatoire et doit être quelqu'un d'AUTRE : réattribuer à
 * la personne qui part ne serait pas une erreur détectable plus tard,
 * juste un départ qui n'a rien transféré.
 *
 * Ce que la fonction NE fait pas : elle ne désactive pas la personne. Le
 * départ et la reprise sont deux gestes, et les enchaîner d'office
 * empêcherait de reprendre les tâches en plusieurs fois — ce qui est le
 * cas normal quand deux personnes se partagent le travail de la troisième.
 */
export function reattribuer(state: AppState, de: string, vers: string): ResultatReprise | { erreur: string } {
  const source = (de || '').trim()
  const cible = (vers || '').trim()
  if (!source || !cible) return { erreur: 'Il faut désigner qui part et qui reprend.' }
  if (source === cible) return { erreur: 'Un départ ne peut pas se transférer à lui-même.' }

  let taches = 0
  for (const t of state.taches || []) {
    if (t.responsable !== source || !estOuverte(t)) continue
    t.responsable = cible
    t.majLe = new Date().toISOString()
    taches++
  }

  let projets = 0
  let equipes = 0
  for (const p of state.projets || []) {
    if (p.responsable === source) {
      p.responsable = cible
      projets++
    }
    if (p.coResponsable === source) {
      // Si la cible est déjà responsable, on ne la met pas AUSSI
      // co-responsable : le projet aurait la même personne aux deux
      // places, et `equipeDuProjet()` la compterait deux fois dans le
      // plan de charge.
      p.coResponsable = p.responsable === cible ? undefined : cible
      projets++
    }
    if ((p.equipeProjet || []).includes(source)) {
      // L'équipe est une LISTE : on remplace sans doublonner.
      const sansElle = p.equipeProjet!.filter((n) => n !== source)
      p.equipeProjet = sansElle.includes(cible) ? sansElle : [...sansElle, cible]
      equipes++
    }
  }

  return { taches, projets, equipes }
}

/**
 * Désactive la personne — sans rien supprimer.
 *
 * Le nom reste dans `settings.personnes` : il est référencé par les
 * pointages, les heures, les notes de journal et les documents déposés.
 * L'en retirer orphelinerait tout cela, ce que `src/personnes.ts` existe
 * précisément pour empêcher.
 *
 * Ce qui change : `actif = false`. Elle sort des listes de choix, ne
 * compte plus dans la capacité, et ne peut plus se connecter — mais son
 * année de travail reste dans la marge.
 */
export function desactiver(state: AppState, personne: string): { erreur: string } | { ok: true } {
  const nom = (personne || '').trim()
  const cible = (state.settings.equipe || []).find((p) => p.nom === nom)
  if (!cible) return { erreur: 'Personne introuvable dans l’équipe.' }

  const actifsRestants = (state.settings.equipe || []).filter((p) => p.nom !== nom && p.actif !== false).length
  if (actifsRestants === 0)
    return {
      erreur:
        'C’est la dernière personne active : la désactiver laisserait l’agence sans personne à qui ' +
        'attribuer quoi que ce soit.',
    }

  cible.actif = false
  return { ok: true }
}

/** les personnes à qui l'on peut confier quelque chose aujourd'hui */
export function personnesActives(state: AppState): string[] {
  return (state.settings.equipe || []).filter((p) => p.actif !== false).map((p) => p.nom)
}
