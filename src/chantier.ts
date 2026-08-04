// 5.6 — avancement du planning travaux (retour d'usage du 03/08/2026).
//
// L'avancement d'un lot se constate en réunion de chantier, tâche par tâche,
// et sert DEUX fois : dans la barre du Gantt (ProjetPlanning) et face à la
// situation que l'entreprise envoie (5.5 : « elle demande 60 %, le chantier
// dit 40 % »). C'est pour cette seconde lecture que `avancementLot` vit ici,
// en logique pure — aucun store, aucune horloge : le contrôle des situations
// doit pouvoir recalculer le même chiffre sur le même état, sans surprise.
//
// La moyenne est PONDÉRÉE PAR LA DURÉE : trois jours de peinture finis ne
// compensent pas trois semaines de gros œuvre à l'arrêt. Une moyenne simple
// dirait 50 % — un chiffre plausible et faux, le pire des deux.

import type { MarcheTravaux, TacheChantier } from './types'
import { diffDays } from './util'

/** borne un pourcentage dans [0 ; 100] — une saisie à 150 ou à −20 est une
 *  erreur de frappe, pas une information : la propager fausserait la moyenne
 *  du lot et, derrière elle, le contrôle des situations */
export function clampPourcent(x: number): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return 0
  return Math.min(100, Math.max(0, x))
}

/** avancement effectif d'une tâche : la saisie explicite prime ; sans elle,
 *  le statut répond — une tâche « fait » d'avant le Lot 5 EST terminée, la
 *  compter 0 dirait au contrôle des situations qu'un lot fini n'a pas
 *  commencé. Tout le reste (prévu, en cours, sans saisie) vaut 0 : on ne
 *  devine pas un pourcentage qu'aucun humain n'a constaté. */
export function avancementTache(t: Pick<TacheChantier, 'avancement' | 'statut'>): number {
  if (typeof t.avancement === 'number' && Number.isFinite(t.avancement)) return clampPourcent(t.avancement)
  return t.statut === 'fait' ? 100 : 0
}

/** poids d'une tâche dans la moyenne du lot : sa durée en jours, bornes
 *  incluses (debut = fin → un jour, pas zéro). Une tâche sans dates — ou aux
 *  dates inversées par une saisie ratée — pèse 1 : elle compte, faiblement,
 *  plutôt que de disparaître de la moyenne ou de la faire diviser par zéro. */
export function poidsTache(t: Pick<TacheChantier, 'debut' | 'fin'>): number {
  if (!t.debut || !t.fin) return 1
  return Math.max(1, diffDays(t.debut, t.fin) + 1)
}

/** avancement d'un marché (lot de travaux) : moyenne des tâches rattachées,
 *  pondérée par leur durée, arrondie au dixième (le bruit flottant n'a rien
 *  à faire sur un certificat de paiement).
 *
 *  Répond null — PAS 0 — quand aucune tâche n'est rattachée au marché :
 *  « on ne sait pas » n'est pas « rien n'est fait ». Un 0 pousserait le
 *  contrôle des situations (5.5) à contester une situation légitime au seul
 *  motif que le planning n'est pas encore construit. */
export function avancementLot(taches: TacheChantier[], marcheId: string): number | null {
  if (!marcheId) return null
  const duLot = (Array.isArray(taches) ? taches : []).filter((t) => t && t.marcheId === marcheId)
  if (duLot.length === 0) return null
  let poids = 0
  let somme = 0
  for (const t of duLot) {
    const p = poidsTache(t)
    poids += p
    somme += p * avancementTache(t)
  }
  return Math.round(clampPourcent(somme / poids) * 10) / 10
}

/** « faire revenir l'entreprise » : duplique une tâche en intervention de
 *  reprise, liée à l'originale par `repriseDeId`, plutôt que ressaisir la
 *  ligne. Les dates sont VIDES — la date de reprise se négocie avec
 *  l'entreprise, la recopier programmerait un retour à une date passée — et
 *  rien n'est hérité de l'exécution : ni l'avancement (une reprise repart de
 *  zéro), ni `elementId` (le lien DPGF afficherait le montant du poste une
 *  seconde fois, or la reprise est aux frais de l'entreprise). */
export function tacheDeReprise(origine: TacheChantier, id: string): TacheChantier {
  return {
    id,
    projetId: origine.projetId,
    lotDceId: origine.lotDceId ?? null,
    elementId: null,
    marcheId: origine.marcheId ?? null,
    lot: origine.lot,
    designation: `${origine.designation} — reprise`,
    debut: null,
    fin: null,
    statut: 'prevu',
    repriseDeId: origine.id,
  }
}

// ------------------------------------------------------------
// 5.7 — « entreprise à confirmer » : le prédicat, pur, partagé
// entre le producteur d'alertes (alerts.ts) et l'écran planning
// — deux définitions divergeraient sans que rien ne le signale
// ------------------------------------------------------------

/** fenêtre de confirmation avant l'intervention (~1 mois). Une entreprise qui
 *  découvre sa date deux semaines avant ne vient pas : à M−1 il reste le
 *  temps de caler l'approvisionnement — ou de replanifier le lot. */
export const SEUIL_CONFIRMATION_JOURS = 30

/** vrai quand la tâche appelle une confirmation d'entreprise : elle démarre
 *  sous `SEUIL_CONFIRMATION_JOURS`, personne n'a posé `confirmeLe`, et son
 *  marché est ACTIF — relancer l'entreprise d'un marché soldé serait du
 *  bruit. Une date déjà passée ne compte plus : la confirmation n'a plus
 *  d'objet, c'est le suivi de retard qui prend le relais. Sans date ni
 *  marché, rien — on ne relance pas dans le vide. */
export function tacheAConfirmer(
  t: Pick<TacheChantier, 'debut' | 'statut' | 'confirmeLe'>,
  marche: Pick<MarcheTravaux, 'actif'> | null | undefined,
  today: string,
): boolean {
  if (!t.debut || t.statut === 'fait') return false
  if (t.confirmeLe) return false
  if (!marche || !marche.actif) return false
  const dj = diffDays(today, t.debut)
  return dj >= 0 && dj <= SEUIL_CONFIRMATION_JOURS
}
