// 5.9 — l'année de parfait achèvement (retour d'usage du 03/08/2026).
//
// Pendant l'année qui suit la réception, l'entreprise doit lever tout
// désordre signalé (CCAG Travaux art. 44.1, art. 1792-6 du code civil).
// Passé la fin de GPA, la garantie s'éteint et la retenue (ou la caution)
// se libère : un désordre signalé tard, relancé sans trace, mis en demeure
// après l'échéance, c'est un désordre payé par la MOA — ou par la MOE.
//
// LA fin de GPA a UNE autorité : `finGPA` ci-dessous. `derive.ts` la
// consomme pour le cycle de vie de la retenue de garantie (`dateLevee`),
// l'écran GPA pour le compte à rebours. Deux formules divergeraient un jour
// (année bissextile, arrondi) sans que rien ne le signale — c'est le défaut
// 5.1 appliqué au temps.
//
// Logique PURE : aucun store, aucune horloge — `today` est un argument.
// Les gestes (notifier, relancer, lever) vivent à l'écran, datés et tracés.

import type { DesordreGPA, StatutDesordreGPA } from './types'
import { diffDays } from './util'

export const LIBELLE_STATUT_DESORDRE: Record<StatutDesordreGPA, string> = {
  signale: 'signalé',
  notifie_entreprise: 'notifié à l’entreprise',
  leve: 'levé',
  conteste: 'contesté',
}

const DATE_VALIDE = /^\d{4}-\d{2}-\d{2}$/

/** fin de la garantie de parfait achèvement : réception + 1 an, MÊME JOUR
 *  l'année suivante — arithmétique de chaîne, identique à ce que le cycle
 *  de vie de la RG a toujours calculé (les comparaisons du dépôt sont
 *  lexicographiques, un « 2025-02-29 » issu d'une réception au 29 février
 *  reste correctement ordonné entre le 28/02 et le 01/03). Null sans
 *  réception lisible : pas de fin inventée. */
export function finGPA(dateReception: string | null | undefined): string | null {
  if (typeof dateReception !== 'string' || !DATE_VALIDE.test(dateReception)) return null
  return `${Number(dateReception.slice(0, 4)) + 1}${dateReception.slice(4)}`
}

/** jours restants avant la fin de GPA (négatif : GPA échue depuis N jours).
 *  Null sans réception : « on ne sait pas » n'est pas « c'est fini ». */
export function joursAvantFinGPA(dateReception: string | null | undefined, today: string): number | null {
  const fin = finGPA(dateReception)
  return fin === null ? null : diffDays(today, fin)
}

/** les désordres encore à la charge de l'entreprise. « Contesté » reste
 *  OUVERT — une contestation ne lève rien, seule la levée constatée ferme
 *  le désordre : le sortir de la liste ferait disparaître du registre
 *  exactement ceux qui finissent en mise en demeure. */
export function desordresOuverts(desordres: DesordreGPA[]): DesordreGPA[] {
  return (Array.isArray(desordres) ? desordres : []).filter((d) => d && d.statut !== 'leve')
}

/** trace une relance sur un désordre — copie, jamais mutation : la
 *  chronologie des relances est la pièce du dossier de mise en demeure,
 *  elle s'ajoute en fin de liste et ne réécrit rien. */
export function avecRelance(desordre: DesordreGPA, date: string, mode: string): DesordreGPA {
  return {
    ...desordre,
    relances: [...(Array.isArray(desordre.relances) ? desordre.relances : []), { date, mode }],
  }
}
