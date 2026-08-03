// ============================================================
// B.13 — les modèles de tâches (§12.1 pt 10, §19.1 pt 7, §8.4).
//
// Une mission de base MOE produit toujours à peu près les mêmes tâches.
// Les ressaisir à chaque projet est du travail perdu ; les générer sans
// rien demander est pire.
//
// LA RÈGLE : RIEN N'EST APPLIQUÉ EN SILENCE
// ------------------------------------------
// `appliquerModele()` ne crée AUCUNE tâche. Elle rend un APERÇU —
// une ligne par tâche envisagée, avec sa date calculée — que l'écran
// affiche décochable ligne à ligne. Ce n'est qu'ensuite, sur les lignes
// retenues, que `tachesDepuisApercu()` fabrique. Générer d'abord et
// laisser supprimer reviendrait à décider pour l'agence, et à lui laisser
// le travail de défaire.
//
// CE QUI N'EST PAS EN CAUSE ICI
// ------------------------------
// Un modèle est un texte écrit par l'agence, pas une proposition de
// machine : il est HORS du champ de validation du §15. La confirmation
// qu'on demande n'est pas une garde contre l'IA, c'est le respect d'une
// décision d'organisation — laquelle change d'un projet à l'autre.
// ============================================================

import type { PhaseCode, TacheInterne } from './types'
import { type PrioriteTache, creerTache } from './taches'

export interface LigneModele {
  id: string
  libelle: string
  /** phase de mission à laquelle la ligne se rattache */
  phase: PhaseCode | null
  /** décalage en JOURS, relatif au début de la phase. Négatif = avant.
   *  Relatif et non absolu : un modèle avec des dates fixes serait périmé
   *  au second projet. */
  decalageJours: number
  /** rôle destinataire — « responsable » ou « coResponsable ». Jamais un
   *  NOM : un modèle qui nommerait quelqu'un survivrait à son départ, et
   *  attribuerait des tâches à une personne qui n'est plus là. */
  role: 'responsable' | 'coResponsable' | null
  priorite: PrioriteTache
  /** heures */
  tempsEstime: number | null
}

export interface ModeleTaches {
  id: string
  nom: string
  /** à quoi il s'applique, en clair — c'est ce que l'agence lit pour
   *  choisir, pas un code de périmètre */
  perimetre: string
  lignes: LigneModele[]
}

/** une ligne d'aperçu : ce qui SERAIT créé, et rien de plus */
export interface LigneApercu {
  ligneId: string
  libelle: string
  phase: PhaseCode | null
  echeance: string | null
  responsable: string | null
  priorite: PrioriteTache
  tempsEstime: number | null
  /** décoché d'avance quand la ligne n'a pas de date calculable : sans
   *  date de début de phase, le décalage ne veut rien dire, et une tâche
   *  sans échéance créée en lot se perd dans la file */
  retenueParDefaut: boolean
}

export interface ContexteApplication {
  projetId: string
  /** début de chaque phase, quand il est connu */
  debutDePhase: Partial<Record<PhaseCode, string>>
  responsable: string | null
  coResponsable: string | null
}

function ajouterJours(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * L'aperçu — ce que le modèle PROPOSE, sans rien créer.
 *
 * Les dates se calculent depuis le début de la phase. Quand ce début est
 * inconnu, la ligne reste dans l'aperçu mais DÉCOCHÉE : la créer sans
 * échéance la ferait entrer dans « sans date » et personne ne lui en
 * donnerait jamais une. La montrer décochée dit qu'il manque quelque
 * chose ; la cacher laisserait croire que le modèle est incomplet.
 */
export function appliquerModele(modele: ModeleTaches, ctx: ContexteApplication): LigneApercu[] {
  return (modele.lignes || []).map((l) => {
    const debut = l.phase ? ctx.debutDePhase[l.phase] : undefined
    const echeance = debut ? ajouterJours(debut, l.decalageJours) : null
    return {
      ligneId: l.id,
      libelle: l.libelle,
      phase: l.phase,
      echeance,
      // Le rôle se résout ICI, au moment de l'application : le modèle
      // nomme une place, le projet dit qui l'occupe aujourd'hui.
      responsable: l.role === 'responsable' ? ctx.responsable : l.role === 'coResponsable' ? ctx.coResponsable : null,
      priorite: l.priorite,
      tempsEstime: l.tempsEstime,
      retenueParDefaut: echeance !== null,
    }
  })
}

/**
 * Fabrique les tâches des lignes RETENUES.
 *
 * Le second temps, séparé du premier — c'est toute la garantie du
 * livrable. Une ligne non retenue ne produit rien : pas une tâche
 * annulée, pas une tâche masquée. Rien.
 */
export function tachesDepuisApercu(
  apercu: LigneApercu[],
  retenues: Set<string>,
  ctx: ContexteApplication,
  par: string | null,
): TacheInterne[] {
  return apercu
    .filter((l) => retenues.has(l.ligneId))
    .map((l) =>
      creerTache({
        titre: l.libelle,
        projetId: ctx.projetId,
        phase: l.phase,
        responsable: l.responsable,
        createur: par,
        echeance: l.echeance,
        priorite: l.priorite,
        tempsEstime: l.tempsEstime,
        // Un modèle n'est pas une proposition de machine : la tâche naît
        // « à faire », pas « à qualifier ». C'est l'agence qui a écrit le
        // modèle, et l'appliquer EST la qualification.
        source: { type: 'manuelle', id: null },
      }),
    )
}

// ------------------------------------------------------------
// Deux gabarits d'amorce
// ------------------------------------------------------------
//
// Ils sont volontairement COURTS. Un modèle de trente lignes se décoche
// ligne à ligne au premier usage, puis on cesse de l'utiliser. Mieux vaut
// six lignes justes que l'agence complète elle-même.

export const MODELES_AMORCE: ModeleTaches[] = [
  {
    id: 'modele-moe-base',
    nom: 'Mission de base MOE',
    perimetre: 'Projet neuf avec mission complète, de l’esquisse à la réception',
    lignes: [
      { id: 'l1', libelle: 'Relevé et visite du site', phase: 'ESQ', decalageJours: 2, role: 'responsable', priorite: 'haute', tempsEstime: 7 },
      { id: 'l2', libelle: 'Note de faisabilité et premiers volumes', phase: 'ESQ', decalageJours: 10, role: 'responsable', priorite: 'normale', tempsEstime: 14 },
      { id: 'l3', libelle: 'Dépôt du permis de construire', phase: 'APD', decalageJours: 30, role: 'responsable', priorite: 'critique', tempsEstime: 21 },
      { id: 'l4', libelle: 'Consultation des entreprises', phase: 'ACT-DCE', decalageJours: 5, role: 'coResponsable', priorite: 'haute', tempsEstime: 10 },
      { id: 'l5', libelle: 'Analyse des offres et rapport', phase: 'ACT-DCE', decalageJours: 35, role: 'responsable', priorite: 'haute', tempsEstime: 14 },
    ],
  },
  {
    id: 'modele-chantier',
    nom: 'Phase chantier',
    perimetre: 'À appliquer au démarrage du DET, une fois les marchés signés',
    lignes: [
      { id: 'c1', libelle: 'Réunion de lancement de chantier', phase: 'DET', decalageJours: 0, role: 'responsable', priorite: 'haute', tempsEstime: 4 },
      { id: 'c2', libelle: 'Mise en place du compte prorata', phase: 'DET', decalageJours: 7, role: 'coResponsable', priorite: 'normale', tempsEstime: 3 },
      { id: 'c3', libelle: 'Préparation des OPR', phase: 'AOR', decalageJours: -14, role: 'responsable', priorite: 'haute', tempsEstime: 7 },
      { id: 'c4', libelle: 'Levée des réserves et DOE', phase: 'AOR', decalageJours: 30, role: 'responsable', priorite: 'normale', tempsEstime: 10 },
    ],
  },
]
