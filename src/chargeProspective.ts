// 5.13 — plan de charge prospectif (retour 03/08/2026, §11).
//
// La vue « qui bosse sur quoi, quelle semaine » existe (Planning.tsx) mais
// regarde le présent. La question qui motive tout arrive AVANT : « un
// projet de X heures démarrant en juin — qui peut le prendre, et ça
// passe ? ». Y répondre de tête, c'est signer un marché qu'on ne peut pas
// tenir, et le découvrir en juin.
//
// Deux fonctions :
//
//   · `chargeProjetee` — pour une personne et des semaines données (3 à
//     6 mois en pratique), les heures planifiées des phases à venir face à
//     la capacité congés déduits. Rien de neuf n'est calculé : ce sont
//     `chargePlanifieeSemaine` et `capacitePersonneSemaine` (derive.ts),
//     EXACTEMENT le modèle du plan de charge actuel — un second modèle de
//     répartition divergerait du tableau que l'agence a sous les yeux ;
//   · `simulerProjet` — le projet hypothétique réparti uniformément sur sa
//     fenêtre (même règle que les phases réelles : heures ÷ semaines), et
//     pour chaque personne ACTIVE le verdict CHIFFRÉ, semaine par semaine
//     et au total : heures disponibles contre heures demandées.
//
// Ce que le verdict N'EST PAS : une recommandation d'attribution. L'ordre
// des personnes est celui de l'équipe des réglages, jamais un classement
// par disponibilité — désigner « la meilleure » serait décider à la place
// de l'humain (§15). Les chiffres disent si ça passe ; QUI le prend reste
// une décision d'agence. Et rien n'est écrit : la simulation vit dans
// l'écran, l'état ressort intact.
//
// Logique PURE : l'état et la fenêtre sont des arguments — aucune horloge,
// « à venir » est défini par la fenêtre demandée, pas par le jour où l'on
// regarde.

import type { AppState } from './types'
import { capacitePersonneSemaine, chargePlanifieeSemaine } from './derive'
import { personnesActives } from './depart'
import { EPSILON_HEURES } from './conges'
import { addDays, mondayOf } from './util'

/** une semaine de la projection : le déjà-planifié face à la capacité */
export interface SemaineProjetee {
  /** lundi ISO */
  lundi: string
  /** heures planifiées (phases datées réparties — modèle du plan de charge) */
  planifie: number
  /** capacité réelle, congés déduits */
  capacite: number
  /** capacite − planifie : négatif = déjà en surcharge cette semaine-là */
  restant: number
}

/** les lundis couvrant [debut, fin] — la grille commune de la projection */
export function lundisFenetre(debut: string, fin: string): string[] {
  const lundis: string[] = []
  for (let lundi = mondayOf(debut); lundi <= mondayOf(fin); lundi = addDays(lundi, 7)) lundis.push(lundi)
  return lundis
}

/** La charge projetée d'une personne sur des semaines données : heures
 *  planifiées des phases à venir contre capacité, congés déduits. */
export function chargeProjetee(state: AppState, personne: string, lundis: string[]): SemaineProjetee[] {
  return lundis.map((lundi) => {
    const planifie = chargePlanifieeSemaine(state, personne, lundi)
    const capacite = capacitePersonneSemaine(state, personne, lundi)
    return { lundi, planifie, capacite, restant: capacite - planifie }
  })
}

/** le projet hypothétique : X heures sur une fenêtre, éventuellement
 *  restreint à une personne. Nommé « SimulationCharge » et pas
 *  « SimulationProjet » : ce dernier existe déjà dans types.ts (F9 —
 *  simulation FINANCIÈRE sauvegardée dans AppState.simulations) et un
 *  homonyme exporté ferait importer l'un pour l'autre sans que rien ne
 *  le signale — celui-ci est jetable, jamais persisté. */
export interface SimulationCharge {
  heures: number
  debut: string
  fin: string
  /** limiter la simulation à une personne (sinon : toute l'équipe active) */
  personne?: string | null
}

/** une semaine simulée : la projection PLUS la part du projet demandée */
export interface SemaineSimulee extends SemaineProjetee {
  /** part du projet cette semaine (heures ÷ nombre de semaines) */
  demande: number
  /** restant − demande : négatif = il manque des heures cette semaine-là */
  solde: number
}

/** le verdict chiffré d'une personne — des nombres, pas un conseil */
export interface VerdictPersonne {
  personne: string
  semaines: SemaineSimulee[]
  /** Σ des restants POSITIFS sur la fenêtre : ce qu'elle peut absorber.
   *  Les semaines déjà en surcharge comptent 0, pas négatif — une semaine
   *  pleine n'enlève pas des heures aux autres, elle n'en offre juste pas */
  heuresDisponibles: number
  heuresDemandees: number
  /** chaque semaine absorbe sa part telle quelle, sans rien bouger */
  passeChaqueSemaine: boolean
  /** ça tient si les heures du projet glissent à l'intérieur de la fenêtre
   *  (Σ disponibles ≥ demandées) — vrai dès que passeChaqueSemaine l'est */
  passeAuTotal: boolean
  /** ce qui manque au total (0 si ça passe) — le chiffre à négocier :
   *  élargir la fenêtre, réduire le périmètre, ou refuser */
  manque: number
}

export interface ResultatSimulation {
  lundis: string[]
  demandeParSemaine: number
  /** dans l'ordre de l'équipe des réglages — JAMAIS classé par
   *  disponibilité : recommander une attribution serait décider (§15) */
  parPersonne: VerdictPersonne[]
}

/** « Un projet de X heures démarrant en juin : qui peut le prendre, et ça
 *  passe ? » — la réponse en chiffres, personne par personne, semaine par
 *  semaine. Ne recommande rien, n'écrit rien : simuler n'est pas engager. */
export function simulerProjet(
  state: AppState,
  sim: SimulationCharge,
): ResultatSimulation | { erreur: string } {
  if (!(sim.heures > 0)) return { erreur: 'Indiquer un nombre d’heures positif : un projet de 0 h n’occupe personne.' }
  if (!sim.debut || !sim.fin) return { erreur: 'Indiquer le début et la fin de la fenêtre du projet.' }
  if (sim.fin < sim.debut) return { erreur: 'La fenêtre est à l’envers : la fin précède le début.' }

  // seule l'équipe ACTIVE se simule (B.14) : proposer des heures à une
  // personne désactivée, même en hypothèse, c'est planifier sur un fantôme
  const actives = personnesActives(state)
  let personnes = actives
  if (sim.personne) {
    if (!actives.includes(sim.personne))
      return { erreur: `« ${sim.personne} » n’est pas dans l’équipe active — un projet ne se simule que sur les personnes actives (B.14).` }
    personnes = [sim.personne]
  }

  const lundis = lundisFenetre(sim.debut, sim.fin)
  // répartition uniforme, la même règle que les phases réelles du plan de
  // charge : un profil de montée en charge inventé ici serait une précision
  // que personne n'a demandée et que rien ne pourrait vérifier
  const demandeParSemaine = sim.heures / lundis.length

  const parPersonne: VerdictPersonne[] = personnes.map((personne) => {
    const semaines: SemaineSimulee[] = chargeProjetee(state, personne, lundis).map((s) => ({
      ...s,
      demande: demandeParSemaine,
      solde: s.restant - demandeParSemaine,
    }))
    const heuresDisponibles = semaines.reduce((t, s) => t + Math.max(0, s.restant), 0)
    const passeChaqueSemaine = semaines.every((s) => s.solde >= -EPSILON_HEURES)
    const passeAuTotal = heuresDisponibles + EPSILON_HEURES >= sim.heures
    return {
      personne,
      semaines,
      heuresDisponibles,
      heuresDemandees: sim.heures,
      passeChaqueSemaine,
      passeAuTotal,
      manque: passeAuTotal ? 0 : sim.heures - heuresDisponibles,
    }
  })

  return { lundis, demandeParSemaine, parPersonne }
}
