// 5.12 — congés × heures planifiées (retour 03/08/2026).
//
// Les absences existent et la capacité les déduit (`heuresAbsenceSemaine`,
// `capacitePersonneSemaine`, src/derive.ts) — mais rien ne CONFRONTAIT un
// congé posé aux heures déjà planifiées cette semaine-là. Poser deux jours
// de congé une semaine à 35 h planifiées ne faisait ni bruit ni chiffre :
// on le découvrait la semaine même, quand il n'y a plus rien à replacer.
//
// Deux fonctions, et une règle :
//
//   · `conflitsConges` — les semaines où un congé rend la charge intenable
//     (planifié > capacité congés déduits), avec l'excédent d'heures. Elle
//     ne regarde QUE les semaines touchées par un congé de la personne : la
//     surcharge ordinaire (trop de phases, pas de congé) est déjà rouge
//     dans le plan de charge ; redire ici la même chose noierait la
//     question que ce module pose — « ce congé crée-t-il un trou ? » ;
//   · `propositionsReport` — où l'excédent POURRAIT aller : les semaines
//     voisines de la même personne, et l'autre personne (active) la même
//     semaine, chacune avec sa capacité restante.
//
// La règle (§15) : la machine PROPOSE, l'humain DÉCIDE. Ce module ne rend
// que des nombres — il n'écrit jamais dans l'état, ne décale aucune phase,
// ne réaffecte personne. Le report effectif reste un geste d'écran sur les
// données existantes (décaler la phase, ajuster l'équipe du projet). Le
// test scripts/test-conges-report.cjs vérifie ce silence par instantané.
//
// Logique PURE : l'état est un argument, aucune horloge — les semaines
// viennent des congés posés, pas du jour où l'on regarde.

import type { AppState } from './types'
import { capacitePersonneSemaine, chargePlanifieeSemaine, heuresAbsenceSemaine } from './derive'
import { personnesActives } from './depart'
import { addDays, mondayOf } from './util'

/** en dessous de 3 minutes, l'écart est la poussière des divisions de
 *  `chargePlanifieeSemaine` (heures ÷ semaines ÷ équipe) — lever un
 *  conflit pour 0,0000001 h ferait sonner chaque congé, et un badge qui
 *  sonne toujours n'est plus lu */
export const EPSILON_HEURES = 0.05

/** jusqu'où chercher une semaine d'accueil autour du conflit — deux
 *  semaines de chaque côté : au-delà, on n'est plus « voisin », on
 *  replanifie, et ça se fait dans le Gantt, pas depuis une proposition */
export const RAYON_REPORT_SEMAINES = 2

/** une semaine où un congé posé rend la charge planifiée intenable */
export interface ConflitConge {
  personne: string
  /** lundi ISO de la semaine en conflit */
  lundi: string
  /** heures planifiées cette semaine (phases datées réparties) */
  planifie: number
  /** capacité réelle, congés déduits */
  capacite: number
  /** heures de congé cette semaine */
  absence: number
  /** planifie − capacite : ce qui ne tiendra pas, à replacer ailleurs */
  excedent: number
}

/** Les semaines en conflit d'une personne : congé posé ET charge planifiée
 *  au-delà de la capacité restante. Triées chronologiquement. */
export function conflitsConges(state: AppState, personne: string): ConflitConge[] {
  // les semaines candidates sont celles que ses congés touchent — pas
  // besoin de balayer le calendrier : sans congé, pas de conflit DE CONGÉ
  const semaines = new Set<string>()
  for (const a of state.absences || []) {
    if (a.personne !== personne || !a.debut || !a.fin || a.fin < a.debut) continue
    for (let lundi = mondayOf(a.debut); lundi <= a.fin; lundi = addDays(lundi, 7)) semaines.add(lundi)
  }

  const conflits: ConflitConge[] = []
  for (const lundi of [...semaines].sort()) {
    const absence = heuresAbsenceSemaine(state, personne, lundi)
    // un congé posé sur un week-end touche la semaine sans lui retirer
    // d'heures ouvrées : rien à confronter
    if (absence <= 0) continue
    const planifie = chargePlanifieeSemaine(state, personne, lundi)
    const capacite = capacitePersonneSemaine(state, personne, lundi)
    const excedent = planifie - capacite
    if (excedent > EPSILON_HEURES) conflits.push({ personne, lundi, planifie, capacite, absence, excedent })
  }
  return conflits
}

/** une destination POSSIBLE pour l'excédent — jamais appliquée seule */
export interface PropositionReport {
  /** semaine voisine de la même personne, ou autre personne la même semaine */
  cible: 'semaine-voisine' | 'autre-personne'
  /** qui reprendrait les heures */
  personne: string
  /** lundi ISO de la semaine d'accueil */
  lundi: string
  /** heures encore libres cette semaine-là (capacité − déjà planifié) */
  capaciteRestante: number
  /** heures proposées : min(excédent, capacité restante) — proposer plus
   *  que la place disponible ne replacerait rien, ça déplacerait le trou */
  heures: number
}

/** Où l'excédent d'un conflit pourrait aller. Deux familles de pistes,
 *  les plus proches d'abord :
 *    1. les semaines voisines de la même personne (± RAYON_REPORT_SEMAINES),
 *       congés et charge déjà planifiée déduits ;
 *    2. les AUTRES personnes actives, la même semaine — une personne
 *       désactivée (B.14) ne se voit rien confier, même en proposition.
 *  Aucune n'est appliquée : le module rend des chiffres, l'écran les
 *  montre, le geste reste humain (§15). */
export function propositionsReport(state: AppState, conflit: ConflitConge): PropositionReport[] {
  const propositions: PropositionReport[] = []

  // marge réelle d'une personne sur une semaine : capacité (congés déduits)
  // moins ce qui y est déjà planifié — une semaine elle-même pleine ou en
  // congé n'accueille rien
  const restante = (personne: string, lundi: string) =>
    capacitePersonneSemaine(state, personne, lundi) - chargePlanifieeSemaine(state, personne, lundi)

  // 1. les semaines voisines de la même personne — distance croissante,
  //    l'avant avant l'après (finir avant le congé vaut mieux que rattraper)
  for (let d = 1; d <= RAYON_REPORT_SEMAINES; d++) {
    for (const sens of [-1, 1] as const) {
      const lundi = addDays(conflit.lundi, sens * d * 7)
      const marge = restante(conflit.personne, lundi)
      if (marge <= EPSILON_HEURES) continue
      propositions.push({
        cible: 'semaine-voisine',
        personne: conflit.personne,
        lundi,
        capaciteRestante: marge,
        heures: Math.min(conflit.excedent, marge),
      })
    }
  }

  // 2. l'autre personne, la même semaine — si elle a de la marge
  for (const autre of personnesActives(state)) {
    if (autre === conflit.personne) continue
    const marge = restante(autre, conflit.lundi)
    if (marge <= EPSILON_HEURES) continue
    propositions.push({
      cible: 'autre-personne',
      personne: autre,
      lundi: conflit.lundi,
      capaciteRestante: marge,
      heures: Math.min(conflit.excedent, marge),
    })
  }

  return propositions
}
