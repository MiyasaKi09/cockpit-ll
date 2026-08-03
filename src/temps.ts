// ============================================================
// M.2 — le total d'une semaine, calculé à UN seul endroit.
//
// POURQUOI CE FICHIER EXISTE
// ---------------------------
// La grille 6 semaines de l'Historique est illisible sous 700 px : six
// colonnes de saisie numérique, sans colonne figée, sur un écran de
// téléphone. `styles.css` prévoyait depuis longtemps un échange
// `.temps-desktop` ↔ `.temps-mobile` — déclaré, jamais posé par un `.tsx`.
//
// En le posant, on crée un risque neuf : DEUX vues qui affichent les mêmes
// heures. Si chacune les recompte à sa façon, elles finiront par ne plus
// dire la même chose — et sur un écran de temps, deux chiffres différents
// pour la même semaine, c'est la confiance dans la feuille entière qui
// tombe. Personne ne saura lequel croire, et l'usage se reportera sur le
// tableur.
//
// Le total vivait en fermeture dans `TableauPersonne` (`totalColonne`),
// donc inatteignable pour une seconde vue et pour un test. Il vit
// désormais ici : les deux vues appellent la MÊME fonction, et
// `scripts/test-temps-mobile.cjs` vérifie qu'aucune n'en recopie une
// variante.
//
// CE QUI EST COMPTÉ, ET CE QUI NE L'EST PAS
// -------------------------------------------
// Les heures projet et les heures hors projet, additionnées — c'est ce que
// la personne a travaillé cette semaine-là. Les heures hors projet
// rattachées à un dossier de poursuite (`consultationId`) sont incluses
// ici : elles ont bien été travaillées. Elles ne sont exclues que des
// CELLULES de saisie du tableau, qui refusent de les écraser parce
// qu'elles se saisissent depuis le dossier — deux questions différentes,
// et les confondre ferait disparaître du temps réel du total.
// ============================================================

import type { TempsEntry, TempsHorsProjet } from './types'

/** Ce que les deux vues lisent — rien de plus que ces deux collections. */
export interface SourceTemps {
  temps: TempsEntry[]
  tempsHorsProjet: TempsHorsProjet[]
}

/**
 * Heures travaillées par une personne sur une semaine, projet et hors
 * projet confondus. Le total que montrent la grille du bureau et la fiche
 * du téléphone — le même, par construction.
 */
export function totalSemaine(source: SourceTemps, personne: string, semaine: string): number {
  let total = 0
  for (const t of source.temps || []) {
    if (t.personne === personne && t.semaine === semaine) total += t.heures || 0
  }
  for (const t of source.tempsHorsProjet || []) {
    if (t.personne === personne && t.semaine === semaine) total += t.heures || 0
  }
  return total
}

/** Une semaine telle que les deux vues la rendent : le total et son verdict. */
export interface BilanSemaine {
  semaine: string
  heures: number
  etat: EtatSemaine
}

export type EtatSemaine = 'vide' | 'incomplete' | 'complete' | 'surcharge'

/** Marge d'appréciation, en heures. Une demi-heure d'écart sur une semaine
 *  n'est pas une anomalie : c'est un arrondi de saisie. Sans elle, une
 *  semaine à 34,75 h passerait « incomplète » et le badge crierait pour
 *  rien — après quoi plus personne ne le regarde. */
export const TOLERANCE_HEURES = 0.5

/**
 * L'état d'une semaine — UNE règle, dont se déduisent le mot ET la couleur.
 *
 * UNE DIVERGENCE ASSUMÉE, ET POURQUOI
 * -------------------------------------
 * L'écran portait deux règles concurrentes sur la même pastille : la
 * couleur tolérait un demi-écart des DEUX côtés
 * (`Math.abs(total - theorique) < 0.5 ? 'ok' : 'warn'`), le mot ne le
 * tolérait qu'au-dessus (`total < theorique ? 'incomplète'`). Entre
 * `theorique - 0,5` et `theorique`, on obtenait donc une pastille VERTE
 * portant le mot « incomplète ».
 *
 * En extrayant un état unique pour les deux vues, il fallait trancher :
 * garder les deux règles aurait consisté à recopier la contradiction sur
 * un second écran. C'est la règle de la COULEUR qui est retenue —
 * symétrique — parce qu'une semaine à 34,8 h sur 35 n'est pas incomplète,
 * c'est une semaine saisie à la demi-heure près.
 *
 * Effet visible, et il est étroit : dans la seule bande
 * `theorique - 0,5 < total < theorique`, le mot passe de « incomplète » à
 * « complète ». La couleur, elle, ne change nulle part.
 */
export function etatSemaine(heures: number, theorique: number): EtatSemaine {
  if (heures === 0) return 'vide'
  if (heures > theorique + TOLERANCE_HEURES) return 'surcharge'
  if (Math.abs(heures - theorique) < TOLERANCE_HEURES) return 'complete'
  return 'incomplete'
}

/** Le mot affiché — un par état, sans second calcul. */
export const LIBELLES_ETAT: Record<EtatSemaine, string> = {
  vide: 'à saisir',
  incomplete: 'incomplète',
  complete: 'complète',
  surcharge: 'surcharge',
}

/** La couleur affichée — dérivée du MÊME état que le mot. */
export const TONS_ETAT: Record<EtatSemaine, 'muted' | 'ok' | 'warn'> = {
  vide: 'muted',
  incomplete: 'warn',
  complete: 'ok',
  surcharge: 'warn',
}

/**
 * Le récapitulatif que lit la vue mobile : une ligne par semaine, dans
 * l'ordre reçu.
 */
export function bilanSemaines(
  source: SourceTemps,
  personne: string,
  semaines: string[],
  theorique: number,
): BilanSemaine[] {
  return (semaines || []).map((semaine) => {
    const heures = totalSemaine(source, personne, semaine)
    return { semaine, heures, etat: etatSemaine(heures, theorique) }
  })
}

/**
 * Les projets touchés dans la semaine, du plus chargé au moins chargé.
 *
 * C'est le seul détail qui vaille sur un téléphone. La grille du bureau
 * montre projet × semaine ; la reproduire au doigt donnerait un tableau de
 * la taille d'un timbre. Savoir « 32 h, surtout sur P07 » répond à la
 * question qu'on se pose sur un chantier ; le détail phase par phase
 * attend le retour au poste.
 */
export function projetsDeLaSemaine(
  source: SourceTemps,
  personne: string,
  semaine: string,
): Array<{ projetId: string; heures: number }> {
  const parProjet = new Map<string, number>()
  for (const t of source.temps || []) {
    if (t.personne !== personne || t.semaine !== semaine) continue
    parProjet.set(t.projetId, (parProjet.get(t.projetId) || 0) + (t.heures || 0))
  }
  return [...parProjet.entries()]
    .map(([projetId, heures]) => ({ projetId, heures }))
    .sort((a, b) => b.heures - a.heures || a.projetId.localeCompare(b.projetId))
}
