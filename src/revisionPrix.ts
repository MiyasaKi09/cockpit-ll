// 5.4 — révision de prix des marchés de travaux (retour d'usage du 03/08/2026).
//
// La formule des CCAP : coefficient = partFixe + (1 − partFixe) × In / I0,
// où I0 est l'indice du mois d'établissement des prix (`Marche.moisZero`) et
// In celui du mois de la situation. Jusqu'ici `Marche.revision` n'était qu'un
// booléen et `Situation.revisionHT` une saisie libre : la vérification de ce
// qu'une entreprise demande se faisait à la calculette, chaque mois.
//
// L'INSEE publie ses indices à ~3 mois : au moment où la situation arrive,
// l'indice de son mois n'existe presque jamais. Le calcul prend alors le
// DERNIER indice publié et LE DIT (`approximatif: true`) — une approximation
// silencieuse deviendrait une vérité au moment du paiement, et personne ne
// reviendrait la corriger à la publication.
//
// Logique PURE : aucun store, aucune horloge — le mois demandé est un
// argument. Ce module calcule le THÉORIQUE ; le poser face à ce que
// l'entreprise demande est le livrable 5.5, et la décision reste humaine.

import type { IndiceBTP, MarcheTravaux } from './types'

/** partie fixe par défaut de la formule (l'usage CCAG / CCAP) */
export const PART_FIXE_DEFAUT = 0.15

const MOIS_VALIDE = /^\d{4}-\d{2}$/

/** clé de rapprochement d'un code de série : « bt 01 » saisi au référentiel
 *  et « BT01 » écrit au marché désignent la même série INSEE */
export function cleSerie(code: string | null | undefined): string {
  return (code || '').replace(/\s+/g, '').toUpperCase()
}

/** arrondi au dix-millième — l'usage des CCAP, et sans lui le bruit flottant
 *  afficherait 1,0850000000000002 sur un certificat de paiement */
const arrondiCoef = (x: number) => Math.round(x * 10000) / 10000

/** coefficient de révision « partFixe + (1 − partFixe) × In/I0 ».
 *  null si un terme n'est pas exploitable : un I0 nul ou négatif n'est pas
 *  un indice, et diviser fabriquerait un Infinity qui traverserait tous les
 *  affichages sans jamais lever d'erreur. */
export function coefficientRevision(partFixe: number, i0: number, iN: number): number | null {
  if (!Number.isFinite(partFixe) || !Number.isFinite(i0) || !Number.isFinite(iN)) return null
  if (i0 <= 0 || iN <= 0) return null
  return arrondiCoef(partFixe + (1 - partFixe) * (iN / i0))
}

/** valeurs exploitables d'une série, triées par mois croissant. Une double
 *  saisie du même mois se résout par la DERNIÈRE de la collection : c'est la
 *  correction — garder les deux rendrait « le dernier indice connu » ambigu. */
export function valeursSerie(
  indices: IndiceBTP[],
  code: string,
): { mois: string; valeur: number }[] {
  const cle = cleSerie(code)
  if (!cle) return []
  const parMois = new Map<string, number>()
  for (const i of Array.isArray(indices) ? indices : []) {
    if (!i || cleSerie(i.indice) !== cle) continue
    if (typeof i.mois !== 'string' || !MOIS_VALIDE.test(i.mois)) continue
    if (typeof i.valeur !== 'number' || !Number.isFinite(i.valeur) || i.valeur <= 0) continue
    parMois.set(i.mois, i.valeur)
  }
  return [...parMois.entries()]
    .map(([mois, valeur]) => ({ mois, valeur }))
    .sort((a, b) => a.mois.localeCompare(b.mois))
}

/** dernier indice publié AU PLUS TARD le mois demandé — jamais un indice
 *  postérieur : réviser mars avec l'indice de juin, ce serait antidater une
 *  hausse. null si la série n'a rien avant ce mois. */
export function dernierIndiceConnu(
  indices: IndiceBTP[],
  code: string,
  mois: string,
): { mois: string; valeur: number } | null {
  const connues = valeursSerie(indices, code).filter((v) => v.mois <= mois)
  return connues.length > 0 ? connues[connues.length - 1] : null
}

export interface RevisionTheorique {
  /** montant HT de la RÉVISION seule — base × (coefficient − 1), le chiffre
   *  comparable au `revisionHT` demandé par l'entreprise (5.5) */
  montant: number
  coefficient: number
  /** l'indice qui a réellement servi de In, avec son mois : l'affichage doit
   *  pouvoir dire « calculé sur mars », pas seulement « approximatif » */
  indiceUtilise: { mois: string; valeur: number }
  /** true = l'indice du mois demandé n'est pas publié, le dernier connu a
   *  servi — le chiffre bougera à la publication, et il faut le dire */
  approximatif: boolean
}

/** révision théorique d'un montant HT pour un mois donné ('AAAA-MM').
 *
 *  Répond null — plutôt que 0 — dès que rien ne peut se calculer : marché
 *  non révisable, série ou mois zéro absents du marché, I0 non saisi, série
 *  vide avant le mois demandé. Un « 0 € de révision » affirmerait qu'une
 *  vérification a eu lieu ; null dit qu'elle n'est pas possible. */
export function revisionTheorique(
  marche: Pick<MarcheTravaux, 'revision' | 'indiceRevision' | 'moisZero' | 'partFixe'>,
  indices: IndiceBTP[],
  mois: string,
  montantHT: number,
): RevisionTheorique | null {
  if (!marche || !marche.revision) return null
  if (!cleSerie(marche.indiceRevision)) return null
  const moisZero = marche.moisZero || ''
  if (!MOIS_VALIDE.test(moisZero) || typeof mois !== 'string' || !MOIS_VALIDE.test(mois)) return null
  if (typeof montantHT !== 'number' || !Number.isFinite(montantHT)) return null

  const serie = valeursSerie(indices, marche.indiceRevision!)
  // I0 est CONTRACTUEL : c'est la valeur du mois d'établissement des prix,
  // pas « la plus proche » — approximer la base, ce serait réécrire le CCAP.
  const i0 = serie.find((v) => v.mois === moisZero)
  if (!i0) return null
  const iN = dernierIndiceConnu(indices, marche.indiceRevision!, mois)
  if (!iN) return null

  let partFixe = PART_FIXE_DEFAUT
  if (marche.partFixe != null) {
    // une partie fixe hors [0 ; 1] n'est pas un paramètre, c'est une erreur
    // de saisie (15 au lieu de 0,15). Calculer avec produirait un montant
    // absurde ; retomber en silence sur le défaut produirait un montant
    // plausible ET faux — pire. Donc null : le marché est à corriger.
    if (
      typeof marche.partFixe !== 'number' ||
      !Number.isFinite(marche.partFixe) ||
      marche.partFixe < 0 ||
      marche.partFixe > 1
    )
      return null
    partFixe = marche.partFixe
  }

  const coefficient = coefficientRevision(partFixe, i0.valeur, iN.valeur)
  if (coefficient === null) return null
  const montant = Math.round(montantHT * (coefficient - 1) * 100) / 100
  return { montant, coefficient, indiceUtilise: iN, approximatif: iN.mois !== mois }
}
