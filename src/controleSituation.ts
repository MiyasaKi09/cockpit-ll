// 5.5 — contrôle d'une situation d'entreprise contre le réel (retour 03/08/2026).
//
// Deux comparaisons, côte à côte :
//   · le % que l'entreprise demande (cumul / marché + avenants) FACE À
//     l'avancement constaté au planning travaux (avancementLot, 5.6) ;
//   · la révision qu'elle chiffre FACE À la révision théorique des
//     indices (revisionTheorique, 5.4).
//
// Et AUCUNE conclusion : ce module produit des nombres et des constats de
// données manquantes, jamais un adjectif sur la situation — viser ou non
// est un acte contractuel, la machine propose, l'humain décide (§15). Le
// test scripts/test-controle-situation.cjs vérifie ce silence mot à mot.
//
// Quand un terme manque, le contrôle le DIT (`manques`) au lieu de se
// taire : un bloc muet ressemble à un bloc qui a vérifié. Et il ne
// fabrique jamais un 0 à la place d'un « on ne sait pas » — pctChantier
// null vient de 5.6 (lot sans tâches), le théorique null de 5.4 (indices
// ou paramètres absents) ; les écarts ne se calculent que quand leurs deux
// termes existent, un écart sur un terme inventé serait un chiffre
// plausible et faux.
//
// Logique PURE : l'état est un argument, le mois est celui de la
// situation. Le `today?` esquissé au plan n'a trouvé aucun usage — rien
// ici ne dépend du jour où l'on regarde, seulement du mois contrôlé.

import type { AppState, MarcheTravaux, Situation } from './types'
import { marcheDeSituation } from './derive'
import { avancementLot } from './chantier'
import type { RevisionTheorique } from './revisionPrix'
import { cleSerie, revisionTheorique } from './revisionPrix'

/** écart d'avancement (en points) au-delà duquel l'écran pose un badge —
 *  ~10 pts : en dessous, c'est le grain d'une estimation de réunion de
 *  chantier ; au-delà, l'équivalent d'un mois de travaux sur un gros lot.
 *  Le badge SIGNALE l'écart, il ne le qualifie pas. */
export const SEUIL_ECART_AVANCEMENT_PTS = 10

const MOIS_VALIDE = /^\d{4}-\d{2}$/

/** arrondi au dixième de point — même grain que avancementLot (5.6) :
 *  deux précisions différentes fabriqueraient des écarts fantômes */
const dixieme = (x: number) => Math.round(x * 10) / 10

export interface ControleSituation {
  /** cumul demandé / (marché + avenants), en points 0–100 — peut dépasser
   *  100 : c'est une information (avenant à prévoir ?), pas une erreur.
   *  null si le cumul n'est pas saisi ou le montant du marché nul. */
  pctDemande: number | null
  /** avancement du lot au planning travaux (5.6) — null si aucune tâche :
   *  « on ne sait pas » n'est pas « rien n'est fait » */
  pctChantier: number | null
  /** pctDemande − pctChantier (positif = la demande devance le chantier),
   *  null dès que l'un des deux manque */
  ecartPts: number | null
  /** révision théorique du mois de la situation (5.4), assise sur le même
   *  cumul que pctDemande — null si non calculable */
  revisionTheorique: RevisionTheorique | null
  /** la révision portée par l'entreprise sur sa situation (saisie libre) —
   *  null si rien n'est saisi ; un 0 explicite est une saisie */
  revisionDemandee: number | null
  /** revisionDemandee − théorique (€, positif = demande au-dessus),
   *  null dès que l'un des deux manque */
  ecartRevision: number | null
  /** ce qui empêche un terme de se calculer, en clair, au niveau où
   *  l'utilisateur peut corriger — l'écran l'affiche tel quel */
  manques: string[]
}

/** contrôle vide : sans marché, ni plafond, ni lot, ni formule — rien à
 *  comparer et rien à dire. L'écran ne montre pas le bloc dans ce cas ;
 *  le rattachement est déjà proposé dans la fiche de la situation. */
const vide = (): ControleSituation => ({
  pctDemande: null,
  pctChantier: null,
  ecartPts: null,
  revisionTheorique: null,
  revisionDemandee: null,
  ecartRevision: null,
  manques: [],
})

/** POURQUOI le théorique ne se calcule pas — dit à l'endroit où ça se
 *  corrige : les paramètres du marché, ou le référentiel d'indices.
 *  5.4 répond null sans motif ; redonner le motif ici évite à
 *  l'utilisatrice de deviner lequel des trois réglages manque. */
function manqueRevision(marche: MarcheTravaux): string {
  if (!cleSerie(marche.indiceRevision) || !MOIS_VALIDE.test(marche.moisZero || ''))
    return "série d'indices ou mois zéro absents du marché — révision théorique incalculable (fiche marché)"
  if (
    marche.partFixe != null &&
    !(typeof marche.partFixe === 'number' && marche.partFixe >= 0 && marche.partFixe <= 1)
  )
    return 'partie fixe du marché hors de [0 ; 1] — à corriger sur la fiche marché'
  return `aucun indice ${cleSerie(marche.indiceRevision)} exploitable (I0 de ${marche.moisZero} et dernier mois publié) — Paramètres → Indices BTP`
}

/** la situation face au réel : avancement demandé contre constaté,
 *  révision demandée contre théorique — des chiffres côte à côte,
 *  la décision reste humaine. */
export function controleSituation(state: AppState, s: Situation): ControleSituation {
  const marche = marcheDeSituation(state, s)
  if (!marche) return vide()

  const manques: string[] = []

  // — l'avancement : le % demandé face au % constaté ————————————————
  // le cumul est celui du décompte (mêmes champs que decompteSituation),
  // mais son ABSENCE se dit ici au lieu de valoir 0 : « 0 % demandé »
  // affirmerait une lecture qui n'a pas eu lieu
  const cumul = s.montantCumulHT ?? s.montantMoisHT ?? null
  const plafond = marche.montantInitialHT + marche.avenantsHT
  let pctDemande: number | null = null
  if (cumul === null) manques.push('pas de cumul saisi sur la situation — le % demandé ne se calcule pas')
  else if (!(plafond > 0)) manques.push('montant du marché à 0 € — le % demandé ne se calcule pas')
  else pctDemande = dixieme((cumul / plafond) * 100)

  const pctChantier = avancementLot(state.tachesChantier, marche.id)
  if (pctChantier === null) manques.push("pas d'avancement saisi au planning travaux")

  const ecartPts =
    pctDemande !== null && pctChantier !== null ? dixieme(pctDemande - pctChantier) : null

  // — la révision : le chiffre demandé face au théorique ————————————
  const revisionDemandee = s.revisionHT ?? null
  let theorique: RevisionTheorique | null = null
  if (!marche.revision) {
    // marché non révisable : pas de théorique. Le constat ne se lève que
    // si un montant est tout de même demandé — sinon il n'y a ni terme
    // ni comparaison, donc rien à dire
    if (revisionDemandee !== null)
      manques.push('marché non révisable — pas de révision théorique en face du montant demandé')
  } else if (cumul !== null) {
    // la base du théorique est le cumul de travaux : c'est sur lui que
    // l'entreprise assoit son propre chiffre — deux bases différentes ne
    // compareraient rien. Cumul absent : le manque est déjà dit plus
    // haut, il bloque AUSSI ce calcul.
    if (!MOIS_VALIDE.test(s.mois)) {
      manques.push('mois de la situation illisible (attendu AAAA-MM) — révision théorique incalculable')
    } else {
      theorique = revisionTheorique(marche, state.indicesBTP, s.mois, cumul)
      if (theorique === null) manques.push(manqueRevision(marche))
    }
  }
  if (theorique !== null && revisionDemandee === null)
    manques.push('pas de révision saisie sur la situation — le théorique est là, la comparaison attend le chiffre demandé')

  const ecartRevision =
    theorique !== null && revisionDemandee !== null
      ? Math.round((revisionDemandee - theorique.montant) * 100) / 100
      : null

  return {
    pctDemande,
    pctChantier,
    ecartPts,
    revisionTheorique: theorique,
    revisionDemandee,
    ecartRevision,
    manques,
  }
}
