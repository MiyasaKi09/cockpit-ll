// 5.2 + 5.3 — pénalités de marché et registre des intempéries (retours
// d'usage du 03/08/2026). Les deux vivent dans le MÊME fichier parce qu'ils
// se lisent ensemble : les jours d'intempéries reconnues se déduisent des
// jours de retard — pénaliser un retard que la pluie excuse, c'est réclamer
// à l'entreprise un argent que le CCAG (art. 19.2.3) lui accorde.
//
// Tout ici est ENCOURU, jamais appliqué : une pénalité est un acte
// contractuel, pas un calcul (§15). Ce module ne pose donc JAMAIS
// `penaliteAppliquee` — la décision se prend à l'écran, datée et signée
// (decidePar/decideLe), et elle FIGE le montant : un taux corrigé ou une
// intempérie saisie après coup ne réécrit pas ce qui a été signifié.
//
// Logique PURE : aucun store, aucune horloge — les dates sont des arguments.

import type {
  EvenementMarche,
  Intemperie,
  MarcheTravaux,
  NatureIntemperie,
  TypeEvenementMarche,
} from './types'

/** libellés d'affichage des faits générateurs (CCAG Travaux art. 19-20) */
export const LIBELLE_EVENEMENT: Record<TypeEvenementMarche, string> = {
  retard_execution: 'retard d’exécution',
  absence_reunion: 'absence à une réunion de chantier',
  document_retard: 'document contractuel en retard',
}

/** un taux du CCAP est exploitable s'il est un nombre fini ≥ 0. Zéro est un
 *  taux VALIDE (un CCAP peut écrire « sans pénalité ») ; absent ou illisible
 *  ne l'est pas — la différence entre « 0 € » et « pas calculable » est
 *  exactement celle que ce module doit tenir. */
function tauxExploitable(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

/** jours saisis exploitables : un nombre fini ≥ 0. Négatif ou illisible =
 *  erreur de saisie, pas une information — on refuse de calculer plutôt que
 *  de produire un montant plausible et faux. */
function joursExploitables(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

/** arrondi au centime — le montant part sur un décompte, pas dans un float */
const arrondiCentimes = (x: number) => Math.round(x * 100) / 100

export interface PenaliteEncourue {
  /** montant HT ENCOURU — jamais appliqué seul : l'application est un geste
   *  humain qui fige `penaliteMontantHT` sur l'événement */
  montantHT: number
  /** taux unitaire du CCAP qui a servi (€/jour ou €/absence) */
  tauxHT: number
  /** jours effectivement comptés après déduction — null pour une absence de
   *  réunion, qui ne se compte pas en jours */
  joursRetenus: number | null
  /** jours d'intempéries déduits (retard d'exécution uniquement) : l'écran
   *  doit pouvoir écrire « 10 j − 3 j d'intempéries », pas juste le résultat */
  joursDeduits: number
}

/** montant HT encouru par un événement, d'après les taux du CCAP du marché.
 *
 *  `joursIntemperies` : jours d'intempéries reconnues sur la période du
 *  retard — un ARGUMENT, calculé par `joursIntemperies()` /
 *  `prolongationDelai()` ci-dessous (5.3) : c'est le lien entre les deux
 *  livrables. Ils ne se déduisent QUE du retard d'exécution : la pluie
 *  excuse
 *  un chantier à l'arrêt, pas un DOE ou un PPSPS en retard — ces documents
 *  s'écrivent au bureau.
 *
 *  Répond null — pas 0 — dès que rien ne peut se calculer : taux non saisi
 *  au marché, jours absents ou négatifs. Un « 0 € » affirmerait que le CCAP
 *  a été lu et que la pénalité est nulle ; null dit qu'il reste à le saisir. */
export function penaliteEncourue(
  evenement: Pick<EvenementMarche, 'type' | 'jours'>,
  taux: MarcheTravaux['penalites'],
  joursIntemperies: number,
): PenaliteEncourue | null {
  if (!evenement) return null
  const deduction =
    typeof joursIntemperies === 'number' && Number.isFinite(joursIntemperies)
      ? Math.max(0, joursIntemperies)
      : 0

  if (evenement.type === 'absence_reunion') {
    const t = tauxExploitable(taux?.absenceReunionHT)
    if (t === null) return null
    return { montantHT: arrondiCentimes(t), tauxHT: t, joursRetenus: null, joursDeduits: 0 }
  }

  const jours = joursExploitables(evenement.jours)
  if (jours === null) return null

  if (evenement.type === 'retard_execution') {
    const t = tauxExploitable(taux?.retardParJourHT)
    if (t === null) return null
    // jamais négatif : plus d'intempéries que de retard, c'est un retard
    // entièrement excusé, pas une créance de l'entreprise sur la MOE
    const joursDeduits = Math.min(jours, deduction)
    const joursRetenus = jours - joursDeduits
    return { montantHT: arrondiCentimes(joursRetenus * t), tauxHT: t, joursRetenus, joursDeduits }
  }

  if (evenement.type === 'document_retard') {
    const t = tauxExploitable(taux?.documentRetardParJourHT)
    if (t === null) return null
    return { montantHT: arrondiCentimes(jours * t), tauxHT: t, joursRetenus: jours, joursDeduits: 0 }
  }

  // type inconnu (import JSON, version future) : ne rien inventer
  return null
}

/** total HT encouru sur un marché — l'exposition contractuelle complète.
 *
 *  Un événement APPLIQUÉ compte pour son montant FIGÉ (`penaliteMontantHT`),
 *  pas pour le recalcul : la décision a été signifiée à l'entreprise, un taux
 *  corrigé ensuite ne la réécrit pas. Les autres comptent pour leur encouru
 *  calculable ; ce qui ne se calcule pas (taux non saisi) compte 0 ICI — le
 *  total reste une somme honnête de ce qui est chiffrable, et l'écran montre
 *  ligne par ligne ce qui reste à paramétrer.
 *
 *  `joursIntemperies` sert à chaque retard du marché : si deux retards se
 *  chevauchent sur la même période, la déduction joue deux fois — au
 *  bénéfice de l'entreprise, jamais l'inverse. */
export function totalEncouruMarche(
  evenements: EvenementMarche[],
  marcheId: string,
  taux: MarcheTravaux['penalites'],
  joursIntemperies: number,
): number {
  let total = 0
  for (const e of Array.isArray(evenements) ? evenements : []) {
    if (!e || e.marcheId !== marcheId) continue
    if (e.penaliteAppliquee) {
      total += typeof e.penaliteMontantHT === 'number' && Number.isFinite(e.penaliteMontantHT) ? e.penaliteMontantHT : 0
    } else {
      total += penaliteEncourue(e, taux, joursIntemperies)?.montantHT ?? 0
    }
  }
  return arrondiCentimes(total)
}

/** total HT des pénalités APPLIQUÉES d'un marché — uniquement les montants
 *  figés par une décision humaine. C'est ce chiffre-là, et lui seul, qui a
 *  vocation à se retrouver sur une situation. */
export function totalAppliqueMarche(evenements: EvenementMarche[], marcheId: string): number {
  let total = 0
  for (const e of Array.isArray(evenements) ? evenements : []) {
    if (!e || e.marcheId !== marcheId || !e.penaliteAppliquee) continue
    total += typeof e.penaliteMontantHT === 'number' && Number.isFinite(e.penaliteMontantHT) ? e.penaliteMontantHT : 0
  }
  return arrondiCentimes(total)
}

// ------------------------------------------------------------
// 5.3 — registre des intempéries : jours OUVRÉS distincts, et
// leurs deux effets — déduction des retards (ci-dessus) et
// prolongation du délai contractuel.
// ------------------------------------------------------------

/** libellés des natures d'intempéries (CCAG art. 19.2.3 ; chaleur : code du travail) */
export const LIBELLE_INTEMPERIE: Record<NatureIntemperie, string> = {
  pluie: 'pluie',
  neige: 'neige',
  vent: 'vent',
  chaleur: 'chaleur',
  gel: 'gel',
}

const DATE_VALIDE = /^\d{4}-\d{2}-\d{2}$/

/** jour ouvré (lundi-vendredi). Arithmétique sur l'époque plutôt qu'un
 *  objet Date et son getDay() : la date est un ARGUMENT et le résultat ne
 *  dépend ni de l'horloge ni du fuseau du poste — un samedi doit rester un
 *  samedi sur les deux machines de l'agence. */
export function estJourOuvre(iso: string): boolean {
  if (typeof iso !== 'string' || !DATE_VALIDE.test(iso)) return false
  const jours = Math.floor(Date.parse(iso + 'T12:00:00Z') / 86400000)
  const jourSemaine = (jours + 4) % 7 // le 1er janvier 1970 est un jeudi (4) ; 0 = dimanche
  return jourSemaine >= 1 && jourSemaine <= 5
}

/** jours d'intempéries reconnues d'un chantier sur une période : jours
 *  OUVRÉS DISTINCTS. Distincts, parce que pluie et vent le même jour font
 *  UN jour d'arrêt, pas deux ; ouvrés, parce qu'un samedi ne se déduit pas
 *  d'un délai qui ne le compte pas — les deux gonfleraient la déduction et
 *  excuseraient des retards réels. Bornes incluses ; `debut`/`fin` à null =
 *  période ouverte de ce côté. */
export function joursIntemperies(
  intemperies: Intemperie[],
  projetId: string,
  debut: string | null,
  fin: string | null,
): number {
  if (!projetId) return 0
  const jours = new Set<string>()
  for (const i of Array.isArray(intemperies) ? intemperies : []) {
    if (!i || i.projetId !== projetId) continue
    if (typeof i.date !== 'string' || !DATE_VALIDE.test(i.date)) continue
    if (debut && i.date < debut) continue
    if (fin && i.date > fin) continue
    if (!estJourOuvre(i.date)) continue
    jours.add(i.date)
  }
  return jours.size
}

/** prolongation du délai contractuel d'un marché : les jours d'intempéries
 *  reconnues pendant sa fenêtre d'intervention (CCAG art. 19.2.3) — la
 *  trace opposable du décompte général. C'est ce MÊME chiffre que l'écran
 *  passe à `penaliteEncourue` pour déduire les retards : deux effets, une
 *  seule source, sinon la prolongation affichée et la déduction appliquée
 *  divergeraient sur le même marché. */
export function prolongationDelai(
  marche: Pick<MarcheTravaux, 'projetId' | 'dateDebut' | 'dateFin'>,
  intemperies: Intemperie[],
): number {
  if (!marche) return 0
  return joursIntemperies(intemperies, marche.projetId, marche.dateDebut ?? null, marche.dateFin ?? null)
}
