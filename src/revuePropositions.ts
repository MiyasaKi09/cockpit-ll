// ============================================================
// B.10 / B.11 — accepter, modifier, attribuer ou ignorer une proposition.
//
// A.9 a créé la table, A.10 la remplit. Sans cet étage, les détections
// s'empilent : le §8.7 énumère quatre gestes, et ce module les rend
// possibles SANS que l'écran ait à décider ce qu'accepter veut dire.
//
// CE QUI SE JOUE ICI, ET QUI N'EST PAS UNE QUESTION D'ERGONOMIE
// --------------------------------------------------------------
// Accepter une proposition ne la TRANSFORME pas : cela crée un objet et
// fait pointer la proposition vers lui. La différence paraît subtile ;
// elle est tout le §15. Une proposition qui deviendrait la tâche qu'elle
// propose serait une décision prise par une machine — et la contrainte
// SQL `(statut = 'acceptee') = (objet_cree_type is not null)` rend
// l'inverse structurellement impossible.
//
// D'où la forme des fonctions : elles rendent CE QU'IL FAUT ÉCRIRE des
// deux côtés, et n'écrivent rien elles-mêmes. Les deux écritures vivent
// dans deux mémoires différentes — la tâche dans le document JSONB, la
// signature dans la table — et un module qui prétendrait les faire
// atomiquement mentirait.
// ============================================================

import type { TacheInterne } from './types'
import { creerTache } from './taches'

/** ce qu'une proposition doit porter pour être revue. Volontairement
 *  minimal : ce module ne doit pas dépendre de la couche d'accès. */
export interface PropositionARevoir {
  id: string
  genre: string
  chargeUtile: Record<string, unknown>
  extrait: string
  confiance: number | null
  raisons: string[]
  /** projet du message d'origine, lu PAR JOINTURE (A.9) */
  projetId?: string | null
}

/** ce que l'acceptation écrit sur la proposition elle-même */
export interface SignatureAcceptation {
  statut: 'acceptee'
  objet_cree_type: 'tache' | 'contact'
  objet_cree_id: string
  traite_par: string
  traite_le: string
}

export interface SignatureRefus {
  statut: 'ignoree'
  traite_par: string
  traite_le: string
  /** motif court — il alimente la mémoire des corrections (§19.2) */
  motif: string
}

/** les quatre gestes du §8.7, littéralement */
export const GESTES_REVUE = ['accepter', 'modifier', 'attribuer', 'ignorer'] as const
export type GesteRevue = (typeof GESTES_REVUE)[number]

/**
 * Accepter une proposition de TÂCHE.
 *
 * Rend la tâche à créer ET la signature à écrire. Le responsable est
 * celui que l'humain a choisi — jamais celui que la machine avait
 * « suggéré » : le §3.15 pose qu'aucun modèle ne décide qui est notifié,
 * et une suggestion acceptée sans être regardée resterait une décision de
 * la machine.
 *
 * La tâche naît « à faire », pas « à qualifier » : elle vient d'être
 * qualifiée, précisément.
 */
export function accepterTache(
  p: PropositionARevoir,
  choix: { titre?: string; responsable: string | null; echeance?: string | null; par: string },
): { tache: TacheInterne; signature: SignatureAcceptation } {
  const charge = p.chargeUtile || {}
  const tache = creerTache({
    titre: (choix.titre ?? String(charge.titre ?? '')).trim() || p.extrait.slice(0, 120),
    projetId: p.projetId ?? null,
    responsable: choix.responsable,
    createur: choix.par,
    echeance: choix.echeance ?? (typeof charge.echeance === 'string' ? charge.echeance : null),
    statut: 'a_faire',
    // La source dit d'où vient la tâche, et l'identifiant de la
    // proposition permet de remonter à l'extrait cité (§4.2).
    source: { type: 'proposition', id: p.id },
  })
  return {
    tache,
    signature: {
      statut: 'acceptee',
      objet_cree_type: 'tache',
      objet_cree_id: tache.id,
      traite_par: choix.par,
      traite_le: new Date().toISOString(),
    },
  }
}

/**
 * B.11 — accepter une proposition d'ÉCHÉANCE.
 *
 * Elle n'écrit QUE `TacheInterne.echeance` ou `Contact.dateProchaineAction`.
 * Jamais une `Obligation`, jamais une `EcheanceFacturation` : ce sont des
 * échéances juridiques et financières, et le §15 interdit d'en créer sans
 * confirmation. La première déclenche un rappel réglementaire de gravité 3,
 * la seconde commande l'émission d'une facture.
 *
 * La garantie n'est pas ici : elle est dans le CHECK SQL sur
 * `charge_utile->>'cible'`, borné à `tache` / `contact`. Ce module ne
 * fabrique même pas la valeur interdite — c'est une ceinture, la
 * contrainte est la bretelle, et B.17 vérifie que la bretelle tient.
 */
export function cibleEcheance(p: PropositionARevoir): 'tache' | 'contact' | null {
  const cible = (p.chargeUtile || {}).cible
  return cible === 'tache' || cible === 'contact' ? cible : null
}

export function dateEcheance(p: PropositionARevoir): string | null {
  const date = (p.chargeUtile || {}).date
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

/**
 * Ignorer. Le motif est COURT et obligatoire : il alimente la mémoire des
 * corrections. « Pas une tâche » et « déjà fait » n'apprennent pas la même
 * chose au détecteur, et sans motif on ne peut plus rien apprendre.
 */
export function ignorer(motif: string, par: string): SignatureRefus | { erreur: string } {
  const texte = (motif || '').trim()
  if (!texte) return { erreur: 'Un motif, même court, est nécessaire : il alimente la mémoire des corrections.' }
  return { statut: 'ignoree', traite_par: par, traite_le: new Date().toISOString(), motif: texte.slice(0, 200) }
}

/**
 * Ce que « Modifier » NE fait pas.
 *
 * Le §8.7 distingue « Accepter » et « Modifier », et la distinction n'est
 * pas cosmétique : modifier ouvre le formulaire pré-rempli et ne crée
 * RIEN tant que l'humain n'a pas enregistré. Créer d'abord puis laisser
 * corriger reviendrait à accepter par défaut — c'est-à-dire ce que le
 * §15 interdit, obtenu par l'ergonomie plutôt que par le schéma.
 */
export function brouillonDepuis(p: PropositionARevoir): {
  titre: string
  echeance: string | null
  responsable: null
} {
  const charge = p.chargeUtile || {}
  return {
    titre: String(charge.titre ?? '').trim() || p.extrait.slice(0, 120),
    echeance: typeof charge.echeance === 'string' ? charge.echeance : dateEcheance(p),
    // Jamais pré-rempli : le §3.15 pose qu'aucune machine ne choisit qui
    // est notifié. Un champ pré-rempli se valide sans être lu.
    responsable: null,
  }
}
