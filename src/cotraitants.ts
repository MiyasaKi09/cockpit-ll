// 5.10 — cotraitants et BET : la chaîne d'honoraires ENTRANTE (retour
// d'usage du 03/08/2026).
//
// L'agence est mandataire de groupements de maîtrise d'œuvre : chaque mois,
// les cotraitants (BET structure, fluides, économie…) lui envoient leur note
// d'honoraires. Jusqu'ici, seul le coût PRÉVISIONNEL existait
// (`Phase.coutExterneHT`, un chiffre libre par phase) : rien ne suivait ce
// qui était convenu par cotraitant, rien ne comptait ce qui était reçu, et
// une note oubliée deux mois ne se voyait qu'au bilan.
//
// Trois règles tenues ici :
//
//   1. les mois ÉCHUS se comptent depuis la PREMIÈRE note consignée du
//      cotraitant — le type n'a pas de date de début de mission, et c'est
//      voulu : le registre ne connaît que ce qu'il a observé. Tant qu'aucune
//      note n'est consignée, aucun mois ne manque (on ne relance pas sur une
//      mission dont on ignore quand elle a commencé) ;
//   2. le mois COURANT n'est jamais échu : une note de juin ne se relance
//      pas en juin — l'entreprise facture à terme échu ;
//   3. un cotraitant INACTIF ne se relance jamais : sa mission est terminée,
//      relancer serait du bruit, et un fil bruyant cesse d'être lu.
//
// Le réel reçu s'AFFICHE face au convenu et au budget des phases ; il
// n'entre pas dans le calcul de marge : l'audit 5.14 vient de vérifier cette
// chaîne, on ne l'étend pas dans la foulée.
//
// Logique PURE : aucun store, aucune horloge — `moisCourant` est un argument.

import type { Cotraitant, NoteHonoraires, TypeCotraitant } from './types'
import { addMonths, fmtMois } from './util'

export const LIBELLE_TYPE_COTRAITANT: Record<TypeCotraitant, string> = {
  bet: 'BET',
  agence: 'Agence',
  autre: 'Autre',
}

const MOIS_VALIDE = /^\d{4}-\d{2}$/

/** une note « reçue » porte une date de réception — `reglee` suit le
 *  paiement, pas la réception, et n'entre jamais dans ce prédicat */
function estRecue(n: NoteHonoraires): boolean {
  return typeof n.recueLe === 'string' && n.recueLe.trim() !== ''
}

function notesDe(cotraitantId: string, notes: NoteHonoraires[]): NoteHonoraires[] {
  return (Array.isArray(notes) ? notes : []).filter(
    (n) => n && n.cotraitantId === cotraitantId && MOIS_VALIDE.test(n.mois || ''),
  )
}

/** les mois échus SANS note reçue d'un cotraitant, du plus ancien au plus
 *  récent. Vide pour un inactif (règle 3), vide sans aucune note consignée
 *  (règle 1), et le mois courant n'y entre jamais (règle 2). Une note
 *  consignée mais non reçue (`recueLe` null) compte MANQUANTE : elle est
 *  attendue, pas arrivée. */
export function moisManquants(
  cotraitant: Cotraitant,
  notes: NoteHonoraires[],
  moisCourant: string,
): string[] {
  if (!cotraitant || !cotraitant.actif) return []
  if (!MOIS_VALIDE.test(moisCourant || '')) return []
  const siennes = notesDe(cotraitant.id, notes)
  if (siennes.length === 0) return []
  const premier = siennes.reduce((min, n) => (n.mois < min ? n.mois : min), siennes[0].mois)
  const recus = new Set(siennes.filter(estRecue).map((n) => n.mois))
  const manquants: string[] = []
  // `addMonths` avance strictement : la boucle se termine dès que `premier`
  // est antérieur à `moisCourant`, et ne fait rien sinon
  for (let m = premier; m < moisCourant; m = addMonths(m, 1)) {
    if (!recus.has(m)) manquants.push(m)
  }
  return manquants
}

/** toutes les notes manquantes des cotraitants ACTIFS, aplaties par couple
 *  (cotraitant, mois) — la forme que le producteur d'alertes consomme :
 *  une alerte par mois échu, à l'identifiant stable */
export function notesManquantes(
  cotraitants: Cotraitant[],
  notes: NoteHonoraires[],
  moisCourant: string,
): { cotraitant: Cotraitant; mois: string }[] {
  const sortie: { cotraitant: Cotraitant; mois: string }[] = []
  for (const c of Array.isArray(cotraitants) ? cotraitants : []) {
    for (const mois of moisManquants(c, notes, moisCourant)) sortie.push({ cotraitant: c, mois })
  }
  return sortie
}

/** cumul HT effectivement REÇU d'un cotraitant : seules les notes arrivées
 *  comptent — une note attendue au montant estimé gonflerait le réel */
export function cumulRecuHT(cotraitantId: string, notes: NoteHonoraires[]): number {
  const total = notesDe(cotraitantId, notes)
    .filter(estRecue)
    .reduce((s, n) => s + (typeof n.montantHT === 'number' && Number.isFinite(n.montantHT) ? n.montantHT : 0), 0)
  return Math.round(total * 100) / 100
}

/** reste à payer = convenu − reçu. Répond null quand les honoraires
 *  convenus ne sont pas saisis : un « 0 € restant » affirmerait qu'une
 *  convention a été lue, un négatif dit que le convenu est dépassé — les
 *  deux informations se perdent si on invente un zéro. */
export function resteAPayer(cotraitant: Cotraitant, notes: NoteHonoraires[]): number | null {
  const convenu = cotraitant?.honorairesConvenusHT
  if (typeof convenu !== 'number' || !Number.isFinite(convenu)) return null
  return Math.round((convenu - cumulRecuHT(cotraitant.id, notes)) * 100) / 100
}

/** total convenu HT d'un projet — inactifs COMPRIS : le convenu est
 *  contractuel, une mission terminée reste due */
export function convenuProjetHT(cotraitants: Cotraitant[], projetId: string): number {
  const total = (Array.isArray(cotraitants) ? cotraitants : [])
    .filter((c) => c && c.projetId === projetId)
    .reduce((s, c) => s + (typeof c.honorairesConvenusHT === 'number' && Number.isFinite(c.honorairesConvenusHT) ? c.honorairesConvenusHT : 0), 0)
  return Math.round(total * 100) / 100
}

/** total HT reçu sur un projet (toutes notes reçues confondues) */
export function recuProjetHT(notes: NoteHonoraires[], projetId: string): number {
  const total = (Array.isArray(notes) ? notes : [])
    .filter((n) => n && n.projetId === projetId && estRecue(n))
    .reduce((s, n) => s + (typeof n.montantHT === 'number' && Number.isFinite(n.montantHT) ? n.montantHT : 0), 0)
  return Math.round(total * 100) / 100
}

/** écart en mois entiers entre un mois manquant et le mois courant — sert à
 *  graduer l'alerte : un mois de retard est un oubli, deux sont un signal */
export function ecartMois(mois: string, moisCourant: string): number {
  if (!MOIS_VALIDE.test(mois || '') || !MOIS_VALIDE.test(moisCourant || '')) return 0
  const [a, b] = [mois, moisCourant].map((m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)))
  return b - a
}

// ------------------------------------------------------------------
// Relance — le TEXTE du brouillon est défini ICI, une fois : l'écran
// projet et l'action rapide du fil d'urgences ouvrent le même brouillon
// (via ouvrirGmail → gmailComposeUrl, seul constructeur d'envoi autorisé) ;
// deux rédactions divergeraient sans que rien ne le signale.
// ------------------------------------------------------------------

export function sujetRelanceNote(c: Cotraitant, mois: string): string {
  return `Note d'honoraires ${fmtMois(mois)}${c.mission ? ` — ${c.mission}` : ''}`
}

export function corpsRelanceNote(c: Cotraitant, mois: string, nomProjet: string, nomAgence: string): string {
  return (
    `Bonjour,\n\n` +
    `Sauf erreur de notre part, nous n'avons pas reçu votre note d'honoraires de ${fmtMois(mois)}` +
    `${c.mission ? ` pour la mission « ${c.mission} »` : ''} sur l'opération ${nomProjet}.\n\n` +
    `Pourriez-vous nous la transmettre, pour que nous l'intégrions au décompte du groupement ?\n\n` +
    `Cordialement,\n${nomAgence}`
  )
}
