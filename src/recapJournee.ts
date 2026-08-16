// ============================================================
// 2.8 — le récapitulatif de fin de journée (§12.4), et l'estimateur
// UNIQUE du temps non enregistré (§3.4 du plan, réservé par B.12).
//
// CE QUE LE §12.4 DEMANDE, MOT À MOT
// -----------------------------------
//   « Vous avez travaillé aujourd'hui sur : …
//     Temps non enregistré estimé : 1 h 20 »
//   Le collaborateur peut compléter ou ignorer.
//
// LES TROIS RÈGLES QUI GOUVERNENT CE FICHIER
// -------------------------------------------
// 1. UN SEUL ESTIMATEUR. Le « temps restant estimé » lu en journée (§8.2)
//    et le « temps non enregistré estimé » lu le soir (§12.4) sont la même
//    soustraction : capacité du jour moins pointages du jour. Deux
//    implémentations divergeraient en silence — exactement le défaut que
//    la conservation des totaux refuse pour la marge.
// 2. L'ESTIMATION N'ÉCRIT JAMAIS. Elle s'affiche comme estimation ; chaque
//    pointage créé l'est par un geste humain, ligne par ligne, avec la
//    source `recap_fin_journee` — sinon la doctrine « la machine propose,
//    l'humain décide » tombe sur le poste de coût le plus sensible.
// 3. PAS DE FENÊTRE MODALE. Une journée finit souvent en fermant l'onglet :
//    un déclencheur bloquant serait ignoré puis désactivé. Le bandeau est
//    discret, en pied du Cockpit, et « Ignorer » ne repose pas la question.
//
// Tout est PUR : `maintenant` et `jour` arrivent en paramètre, aucune
// horloge n'est lue ici — la règle des modules de src/*.ts.
// ============================================================

import type { AppState, RecapJournee } from './types'
import { joursAbsents } from './derive'
import { heuresDepuisMinutes } from './pointages'
import { addDays } from './util'

/** l'heure à partir de laquelle le bandeau a le droit de paraître —
 *  paramétrable (`settings.heureRecap`), avec un défaut raisonnable :
 *  avant la fin d'après-midi, « temps non enregistré » est un faux signal */
export const HEURE_RECAP_DEFAUT = '17:30'

/** en dessous d'un quart d'heure manquant, le bandeau se tait : un
 *  indicateur qui crie pour des poussières finit ignoré — la leçon du
 *  badge de semaine (audit d'usage, action 28) */
export const SEUIL_RECAP_HEURES = 0.25

/** samedi ou dimanche — la capacité ne compte que les jours ouvrés,
 *  même règle que `heuresAbsenceSemaine` (5 jours) */
function estWeekend(jour: string): boolean {
  const j = new Date(`${jour}T00:00:00Z`).getUTCDay()
  return j === 0 || j === 6
}

/**
 * Capacité d'UN jour, congés déduits : `heuresParJour` un jour ouvré
 * travaillé, 0 le week-end et les jours d'absence. La lecture du calendrier
 * des congés passe par `joursAbsents` — la SEULE autorité de ce prédicat.
 */
export function capaciteJour(state: AppState, personne: string, jour: string): number {
  if (estWeekend(jour)) return 0
  if (joursAbsents(state, personne, jour, 1)[0]) return 0
  return state.settings.heuresParJour
}

/** minutes des pointages ARRÊTÉS d'une personne ce jour-là. Un chrono en
 *  cours n'est pas du temps passé — la règle de `projeterVersTemps`. On
 *  additionne des entiers ; la division vient à la fin, une fois. */
function minutesPointeesJour(state: AppState, personne: string, jour: string): number {
  return (state.pointages || [])
    .filter((p) => p.personne === personne && p.fin && p.debut.slice(0, 10) === jour)
    .reduce((s, p) => s + (p.minutes || 0), 0)
}

/**
 * L'ESTIMATEUR UNIQUE (§3.4) : capacité du jour moins pointages du jour,
 * jamais négatif. Le chiffre est une ESTIMATION — il s'affiche comme telle
 * et ne devient un pointage que par un geste humain.
 */
export function tempsNonEnregistre(state: AppState, personne: string, jour: string): number {
  const capacite = capaciteJour(state, personne, jour)
  if (capacite <= 0) return 0
  const pointees = heuresDepuisMinutes(minutesPointeesJour(state, personne, jour))
  return Math.max(0, Math.round((capacite - pointees) * 100) / 100)
}

/**
 * Les projets touchés ce jour-là (§12.4) : d'abord les pointages — la
 * trace la plus sûre — et, à défaut seulement, les messages rattachés du
 * jour et les tâches passées « terminée » ce jour. Un identifiant par
 * projet, sans doublon, dans l'ordre de rencontre.
 */
export function projetsTouches(state: AppState, personne: string, jour: string): string[] {
  const desPointages = (state.pointages || [])
    .filter((p) => p.personne === personne && p.debut.slice(0, 10) === jour && p.projetId)
    .map((p) => p.projetId as string)
  if (desPointages.length > 0) return [...new Set(desPointages)]

  const desCourriers = (state.courriers || [])
    .filter((c) => c.projetId && (c.dateReception || '').slice(0, 10) === jour)
    .map((c) => c.projetId as string)
  const desTaches = (state.taches || [])
    .filter(
      (t) =>
        t.statut === 'terminee' &&
        (t.majLe || '').slice(0, 10) === jour &&
        t.projetId &&
        (t.responsable === personne || (t.participants || []).includes(personne)),
    )
    .map((t) => t.projetId as string)
  return [...new Set([...desCourriers, ...desTaches])]
}

/** vrai si la question de ce jour a déjà reçu une réponse — « Ignorer »
 *  ferme sans rien écrire et NE REPOSE PAS la question (§12.4) */
export function recapDejaTraite(state: AppState, personne: string, jour: string): boolean {
  return (state.recapsJournee || []).some((r) => r.personne === personne && r.jour === jour)
}

/**
 * LA décision d'affichage. Rendue ici, en pur, pour être testée — l'écran
 * ne fait que la rendre. Dans l'ordre :
 *
 *   1. le RATTRAPAGE : au premier chargement, le dernier jour ouvré non
 *      récapitulé (jusqu'à trois jours en arrière — le vendredi manqué se
 *      rattrape le lundi, pas le samedi que personne n'ouvre). Dès qu'un
 *      jour ouvré a été traité, on ne drague pas plus loin : le passé
 *      lointain n'est plus un récapitulatif, c'est de l'archéologie.
 *   2. le JOUR MÊME, à partir de l'heure paramétrée — jamais avant : en
 *      matinée « temps non enregistré » est un faux signal. Un chrono qui
 *      TOURNE suspend la question : la journée n'est pas finie.
 *
 * Dans tous les cas : capacité nulle (week-end, congé) ⇒ rien à réclamer,
 * manque sous le seuil ⇒ silence, déjà traité ⇒ silence.
 */
export function recapAPresenter(
  state: AppState,
  personne: string,
  maintenant: string,
): { jour: string; veille: boolean } | null {
  if (!personne) return null
  const jour = maintenant.slice(0, 10)

  // 1. le rattrapage — le dernier jour ouvré, et lui seul
  for (let i = 1; i <= 3; i++) {
    const j = addDays(jour, -i)
    if (capaciteJour(state, personne, j) <= 0) continue
    if (!recapDejaTraite(state, personne, j) && tempsNonEnregistre(state, personne, j) > SEUIL_RECAP_HEURES) {
      return { jour: j, veille: true }
    }
    break
  }

  // 2. le jour même, à partir de l'heure paramétrée
  const heure = maintenant.slice(11, 16)
  if (heure < (state.settings.heureRecap || HEURE_RECAP_DEFAUT)) return null
  if (recapDejaTraite(state, personne, jour)) return null
  if ((state.chronos || []).some((c) => c && c.personne === personne)) return null
  if (capaciteJour(state, personne, jour) <= 0) return null
  if (tempsNonEnregistre(state, personne, jour) <= SEUIL_RECAP_HEURES) return null
  return { jour, veille: false }
}

let compteur = 0

/** la réponse à la question du jour — écrite par le geste, jamais d'office */
export function marquerRecap(
  personne: string,
  jour: string,
  etat: RecapJournee['etat'],
  le: string,
): RecapJournee {
  compteur += 1
  return { id: `rcp-${jour}-${personne}-${compteur.toString(36)}`, personne, jour, etat, le }
}
