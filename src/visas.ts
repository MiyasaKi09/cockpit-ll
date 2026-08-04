// 5.8 — registre des visas (retour d'usage du 03/08/2026, cité deux fois).
//
// En phase VISA, la MOE vise les documents d'exécution des entreprises dans
// le délai du CCAP. Un visa en retard n'est pas un oubli sans conséquence :
// il ENGAGE LA RESPONSABILITÉ de la MOE — l'entreprise exécute sans visa, et
// le retard du visa devient l'excuse de tous les retards du lot. La phase
// VISA existait partout dans le Cockpit (échéancier, catégorisation) sans
// qu'aucun registre ne suive ce qui est à viser : c'est ce trou que ce
// module ferme.
//
// L'échéance se compte en jours CALENDAIRES : le CCAG MOE écrit les délais
// de visa en jours, pas en jours ouvrés — compter en ouvrés ici offrirait à
// la MOE un délai qu'aucun contrat ne lui donne, et l'alerte se tairait
// pendant que la responsabilité court.
//
// Logique PURE : aucun store, aucune horloge — `today` est un argument.
// Le geste de visa (daté, signé) vit à l'écran : la machine calcule les
// échéances, l'humain vise (§15).

import type { StatutVisa, Visa } from './types'
import { addDays, diffDays } from './util'

/** délai de visa à défaut de saisie (jours calendaires) — l'usage courant
 *  des CCAP. Le défaut du PROJET (`Projet.delaiVisaJours`) le remplace, et
 *  chaque visa peut porter le sien. */
export const DELAI_VISA_DEFAUT = 15

/** l'alerte se lève à J−3 de l'échéance : assez tôt pour viser dans le
 *  délai, assez tard pour que le fil d'urgences ne liste pas tous les
 *  documents reçus de la semaine — un fil bruyant cesse d'être lu. */
export const SEUIL_ALERTE_VISA_JOURS = 3

/** fenêtre « sous huitaine » : l'échéance approche, sans être passée */
export const FENETRE_HUITAINE_JOURS = 7

export const LIBELLE_STATUT_VISA: Record<StatutVisa, string> = {
  a_viser: 'à viser',
  vise: 'visé',
  vise_observations: 'visé avec observations',
  refuse: 'refusé',
}

const DATE_VALIDE = /^\d{4}-\d{2}-\d{2}$/

/** délai exploitable : un nombre fini ≥ 0 — sinon le défaut. Un délai
 *  négatif ou illisible (import JSON) rendrait une échéance antérieure à la
 *  réception, et l'alerte crierait sur un document reçu la veille. */
function delaiExploitable(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DELAI_VISA_DEFAUT
}

/** échéance du visa : reçu le + délai du CCAP, en jours CALENDAIRES.
 *  Répond null quand la date de réception est illisible : une échéance
 *  inventée déclencherait (ou tairait) l'alerte sur du vide. */
export function echeanceVisa(v: Pick<Visa, 'recuLe' | 'delaiJours'>): string | null {
  if (!v || typeof v.recuLe !== 'string' || !DATE_VALIDE.test(v.recuLe)) return null
  return addDays(v.recuLe, delaiExploitable(v.delaiJours))
}

/** les visas encore en attente d'un geste — seuls eux portent un délai qui
 *  court : un document visé, même tardivement, ne s'alerte plus */
export function visasEnAttente(visas: Visa[]): Visa[] {
  return (Array.isArray(visas) ? visas : []).filter((v) => v && v.statut === 'a_viser')
}

/** visas dont l'échéance du CCAP est DÉPASSÉE — la responsabilité de la MOE
 *  est engagée. Le jour J n'est pas un retard : le délai court jusqu'à son
 *  dernier jour inclus. */
export function visasEnRetard(visas: Visa[], today: string): Visa[] {
  return visasEnAttente(visas).filter((v) => {
    const echeance = echeanceVisa(v)
    return echeance !== null && echeance < today
  })
}

/** visas à traiter sous huitaine : l'échéance tombe entre aujourd'hui et
 *  J+7 inclus. Disjoint de `visasEnRetard` — l'écran les colore autrement,
 *  les compter deux fois gonflerait le registre. */
export function visasSousHuitaine(visas: Visa[], today: string): Visa[] {
  return visasEnAttente(visas).filter((v) => {
    const echeance = echeanceVisa(v)
    if (echeance === null) return false
    const dj = diffDays(today, echeance)
    return dj >= 0 && dj <= FENETRE_HUITAINE_JOURS
  })
}
