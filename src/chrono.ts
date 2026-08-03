// ============================================================
// M.3 — le chrono, logique pure (§9.2, §9.3, §9.4, critère 7).
//
// B.6 a livré la table `chrono_actif` et sa clé primaire — UNE ligne par
// personne, parce que deux chronos simultanés compteraient le même temps
// deux fois et qu'un écran ne peut pas s'en prémunir. Ce qui manquait est
// l'écran lui-même : le §3.5 note qu'il n'y a pas de barre supérieure au
// bureau, et les deux emplacements étaient renvoyés à M.3.
//
// CE MODULE NE TOUCHE À RIEN
// ---------------------------
// Il ne lit ni le magasin, ni l'horloge, ni le réseau : `maintenant` est
// toujours passé en argument. Un chrono qui lit `Date.now()` au fond de sa
// logique est intestable — et un défaut de comptage du temps ne se voit
// pas à l'œil, il se voit sur la facture, trois mois plus tard.
//
// LA BASCULE, ET POURQUOI ELLE EST UN SEUL GESTE
// ------------------------------------------------
// Démarrer un chrono alors qu'un autre tourne ARRÊTE le premier et
// enregistre son pointage. Le §9.2 le demande, mais la vraie raison est
// ailleurs : sans cette règle, la personne qui passe d'une tâche à l'autre
// doit se souvenir d'arrêter avant de démarrer. Elle oubliera, et deux
// chronos compteront la même heure — ou, si la clé primaire les en
// empêche, le second démarrage échouera en silence et le temps sera perdu.
// Un geste, deux effets, aucune mémoire à avoir.
// ============================================================

import type { ChronoEnCours, PhaseCode } from './types'
import type { Pointage, TypeActivite } from './pointages'
import { creerPointage, facturableParDefaut, minutesEntre } from './pointages'

// La forme est déclarée UNE fois, dans `types.ts`, parce que c'est elle qui
// est persistée dans l'état. Ici on ne fait que resserrer `activite` sur le
// référentiel de `pointages.ts` : `types.ts` ne peut pas l'importer sans
// créer un cycle, et un chrono dont l'activité sort du référentiel serait
// refusé par `pointages_activite_chk` au moment de l'arrêt — donc à la
// seconde où le temps compte.
export type ChronoActif = ChronoEnCours & { activite: TypeActivite }

/** Ce qu'il faut pour démarrer : tout est facultatif sauf la personne. */
export interface CibleChrono {
  projetId?: string | null
  phase?: PhaseCode | null
  tacheId?: string | null
  activite?: TypeActivite
  commentaire?: string
  libelle?: string
}

/**
 * Sous cette durée, l'arrêt n'enregistre rien.
 *
 * Un chrono démarré par erreur et arrêté aussitôt produirait un pointage à
 * zéro minute — la base l'accepte (`minutes >= 0`), et c'est justement le
 * problème : la feuille de temps se remplirait de lignes vides qu'il
 * faudrait ensuite supprimer une à une. Moins d'une minute de travail réel
 * n'existe pas ; moins d'une minute de fausse manœuvre, si.
 */
export const SECONDES_MINIMUM = 60

/** Secondes écoulées, jamais négatives — une horloge peut reculer. */
export function secondesEcoulees(chrono: ChronoActif, maintenant: string): number {
  const t0 = Date.parse(chrono.debut)
  const t1 = Date.parse(maintenant)
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 0
  return Math.max(0, Math.floor((t1 - t0) / 1000))
}

/**
 * La durée telle qu'elle défile sur le bouton.
 *
 * Sous l'heure on montre les secondes : c'est ce qui prouve que le chrono
 * tourne. Au-delà, elles deviennent du bruit et on passe à `1 h 07` —
 * personne ne surveille la seconde d'une réunion de deux heures.
 */
export function formaterDuree(secondes: number): string {
  const s = Math.max(0, Math.floor(secondes))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** Le nom affiché, tronqué — un bouton ne s'élargit pas. */
export function libelleCourt(libelle: string, max = 22): string {
  const t = (libelle || '').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1).trimEnd()}…`
}

export function demarrerChrono(personne: string, cible: CibleChrono, maintenant: string): ChronoActif {
  return {
    personne,
    debut: maintenant,
    projetId: cible.projetId ?? null,
    phase: cible.phase ?? null,
    tacheId: cible.tacheId ?? null,
    activite: cible.activite ?? 'autre',
    commentaire: cible.commentaire ?? '',
    libelle: cible.libelle ?? '',
  }
}

export interface ResultatArret {
  /** `null` quand la durée est sous le seuil : rien n'est enregistré */
  pointage: Pointage | null
  /** ce qu'on dit à l'écran — jamais de silence sur un temps non gardé */
  message: string
}

/**
 * Arrête le chrono et rend le pointage correspondant.
 *
 * `facturable` reprend la règle de B.7 (projet ⇒ facturable) plutôt que de
 * demander : au moment où l'on arrête un chrono, on veut arrêter le chrono,
 * pas répondre à une question. La valeur se corrige dans la fiche.
 */
export function arreterChrono(chrono: ChronoActif, maintenant: string): ResultatArret {
  const secondes = secondesEcoulees(chrono, maintenant)
  if (secondes < SECONDES_MINIMUM) {
    return {
      pointage: null,
      message: `Chrono arrêté avant la minute (${formaterDuree(secondes)}) — rien n’est enregistré.`,
    }
  }
  const pointage = creerPointage({
    personne: chrono.personne,
    debut: chrono.debut,
    fin: maintenant,
    minutes: minutesEntre(chrono.debut, maintenant),
    projetId: chrono.projetId,
    phase: chrono.phase,
    tacheId: chrono.tacheId,
    activite: chrono.activite,
    commentaire: chrono.commentaire,
    facturable: facturableParDefaut(chrono.projetId),
    source: 'chrono',
  })
  return { pointage, message: `${formaterDuree(secondes)} enregistrées.` }
}

/**
 * La bascule : un seul geste qui arrête l'un et démarre l'autre.
 *
 * Rendre les deux effets ensemble est délibéré. Si l'appelant devait
 * enchaîner `arreterChrono` puis `demarrerChrono`, il existerait un chemin
 * où le second échoue après le premier — chrono perdu, personne prévenue.
 */
export function basculerChrono(
  actuel: ChronoActif | null,
  personne: string,
  cible: CibleChrono,
  maintenant: string,
): { chrono: ChronoActif; arret: ResultatArret | null } {
  const arret = actuel ? arreterChrono(actuel, maintenant) : null
  return { chrono: demarrerChrono(personne, cible, maintenant), arret }
}

/** Le chrono de cette personne, ou `null`. Une seule ligne par personne. */
export function chronoDe(chronos: ChronoActif[] | null | undefined, personne: string): ChronoActif | null {
  if (!personne) return null
  return (chronos || []).find((c) => c.personne === personne) || null
}

/**
 * Pose le chrono d'une personne en garantissant l'unicité côté client.
 *
 * La clé primaire de `chrono_actif` la garantit en base. Tant que la
 * synchronisation des pointages n'est pas branchée, l'état local doit tenir
 * la même règle tout seul — sinon deux onglets sur le même poste
 * produiraient exactement le double comptage que la table interdit.
 */
export function poserChrono(
  chronos: ChronoActif[] | null | undefined,
  chrono: ChronoActif | null,
  personne: string,
): ChronoActif[] {
  const autres = (chronos || []).filter((c) => c.personne !== personne)
  return chrono ? [...autres, chrono] : autres
}
