// ============================================================
// B.4, B.5, B.7, B.9 — le temps horodaté, et ses deux projections.
//
// Aujourd'hui le temps se saisit à la semaine : une ligne par (semaine,
// personne, projet, phase). Le §9.5 demande des pointages HORODATÉS —
// début, fin, durée — et le critère 8 exige qu'un temps soit rattaché
// « à un projet OU à une tâche ».
//
// POURQUOI LES POINTAGES SORTENT DU DOCUMENT JSONB
// -------------------------------------------------
// C'est la fréquence, pas la taille (§3.1). Un pointage pèse quelques
// octets, mais une vingtaine par jour et par personne deviennent autant de
// cycles compare-and-swap sur un document que tout le reste utilise. La
// grille hebdomadaire, elle, reste dans le JSONB — DÉRIVÉE des pointages.
//
// LA RÈGLE QUI GOUVERNE TOUT CE FICHIER
// --------------------------------------
// `state.temps` cesse d'être saisi et devient une PROJECTION. `derive.ts`
// n'est pas touché : `heuresReelles`, la marge, le plan de charge et la
// chaîne financière continuent de lire `state.temps` sans savoir d'où il
// vient. C'est ce qui rend la bascule sûre — et c'est aussi ce qui rend
// `scripts/test-conservation-totaux.cjs` indispensable : si la projection
// perd un centième d'heure, la marge se met à mentir sans qu'aucune
// erreur ne se produise.
// ============================================================

import type { PhaseCode, TempsEntry } from './types'

// ------------------------------------------------------------
// 1. Le pointage
// ------------------------------------------------------------

/** §9.5 : ce que fait la personne pendant ce temps-là */
export type TypeActivite =
  | 'conception'
  | 'reunion'
  | 'chantier'
  | 'administratif'
  | 'deplacement'
  | 'echange'
  | 'autre'

export const TYPES_ACTIVITE: TypeActivite[] = [
  'conception',
  'reunion',
  'chantier',
  'administratif',
  'deplacement',
  'echange',
  'autre',
]

export const LIBELLES_ACTIVITE: Record<TypeActivite, string> = {
  conception: 'Conception',
  reunion: 'Réunion',
  chantier: 'Chantier',
  administratif: 'Administratif',
  deplacement: 'Déplacement',
  echange: 'Échange / mail',
  autre: 'Autre',
}

export interface Pointage {
  id: string
  personne: string
  /** ISO complet — c'est lui qui décide du JOUR et de la SEMAINE */
  debut: string
  /** ISO complet. `null` = pointage en cours (le chrono tourne). */
  fin: string | null
  /** minutes. Stockée plutôt que recalculée : une reprise d'historique ou
   *  une correction manuelle peut donner une durée qui ne se déduit pas
   *  des bornes, et la déduire effacerait la correction. */
  minutes: number
  projetId: string | null
  phase: PhaseCode | null
  /** critère 8 : « rattaché à un projet OU À UNE TÂCHE » */
  tacheId: string | null
  activite: TypeActivite
  commentaire: string
  /** B.7 — initialisé par la règle actuelle (projet = facturable) et
   *  modifiable. Un déplacement ou une reprise de dossier ne se facturent
   *  pas toujours, et la marge se calcule sur ce qui l'est. */
  facturable: boolean
  /** une saisie relue n'est plus corrigeable sans trace (B.16) */
  validee: boolean
  /** d'où vient le pointage : 'chrono' | 'saisie' | 'reprise' */
  source: string
  creeLe: string
  majLe: string
}

// ------------------------------------------------------------
// 2. Le temps, compté en MINUTES jusqu'au dernier moment
// ------------------------------------------------------------
//
// C'est la décision technique qui protège la marge, et elle tient en une
// phrase : on additionne des entiers, on ne divise qu'à la fin.
//
// Arrondir chaque pointage en heures puis les sommer perd jusqu'à un
// demi-centième par pointage. À vingt pointages par jour et par personne,
// cela fait plusieurs heures par an — sur la seule grandeur dont l'agence
// tire sa marge, et sans qu'aucune erreur ne se produise nulle part.

/** LA GARANTIE, énoncée exactement — parce qu'une garantie exagérée se
 *  désactive au premier échec, et qu'on perd alors les deux.
 *
 *  `TempsEntry.heures` stocke des heures : un arrondi par LIGNE AGRÉGÉE
 *  est donc inévitable, et la somme de N lignes peut s'écarter du total
 *  vrai d'au plus N demi-centièmes. Sur une semaine de deux personnes et
 *  deux projets, N vaut huit ; l'écart plafonne à 0,04 h.
 *
 *  Ce qui est INTERDIT, c'est l'arrondi par POINTAGE : même ordre de
 *  grandeur, mais multiplié par le nombre de pointages — vingt par jour et
 *  par personne au lieu de huit par semaine, soit deux ordres de grandeur.
 *  D'où la règle : on additionne des entiers, on ne divise qu'à la fin.
 *
 *  `scripts/test-conservation-totaux.cjs` tient les deux bornes. */

/** minutes → heures, arrondi au centième. LE SEUL endroit qui divise. */
export function heuresDepuisMinutes(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

/** lundi de la semaine d'un horodatage ISO */
export function lundiDe(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  const jour = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() - ((jour + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/**
 * Le jour d'un pointage : celui de son DÉBUT.
 *
 * Un pointage qui franchit minuit — 23 h 40 → 00 h 20 — appartient à la
 * journée où il a commencé. Le découper en deux ferait apparaître deux
 * saisies là où la personne se souvient d'une seule, et déplacerait une
 * partie de son dimanche soir dans la semaine suivante. On choisit la
 * lisibilité, et on le DIT plutôt que de laisser deviner.
 */
export function jourDuPointage(p: Pointage): string {
  return p.debut.slice(0, 10)
}

// ------------------------------------------------------------
// 3. Première projection : vers `state.temps` (B.5)
// ------------------------------------------------------------

/** clé d'agrégation de la grille hebdomadaire existante */
function cleTemps(p: Pointage, semaine: string): string {
  return `${semaine}|${p.personne}|${p.projetId}|${p.phase}`
}

/**
 * Projette les pointages vers la grille hebdomadaire.
 *
 * Ce que la projection IGNORE, et pourquoi :
 *
 *   * un pointage sans projet ne peut pas entrer dans `state.temps`, dont
 *     la clé contient le projet. Il n'est pas perdu — il reste un
 *     pointage, et il alimente la tâche s'il en porte une (B.9) ;
 *   * un pointage sans phase non plus : `TempsEntry.phase` n'est pas
 *     nullable, et inventer une phase fausserait la répartition
 *     d'honoraires, donc la marge par phase ;
 *   * un pointage EN COURS (`fin === null`) ne compte pas. Le chrono qui
 *     tourne n'est pas du temps passé, c'est du temps en train de passer :
 *     le compter ferait bouger la marge à chaque rendu.
 *
 * Les identifiants sont DÉTERMINISTES : rejouer la projection sur les
 * mêmes pointages rend exactement les mêmes lignes. Sans cela, chaque
 * recalcul produirait un état différent, et la synchronisation croirait à
 * une modification à chaque ouverture.
 */
export function projeterVersTemps(pointages: Pointage[]): TempsEntry[] {
  const par = new Map<string, { entree: TempsEntry; minutes: number }>()
  for (const p of pointages || []) {
    if (!p.fin) continue
    if (!p.projetId || !p.phase) continue
    if (!p.personne) continue
    const semaine = lundiDe(p.debut)
    const cle = cleTemps(p, semaine)
    const connu = par.get(cle)
    if (connu) {
      connu.minutes += p.minutes || 0
      continue
    }
    par.set(cle, {
      minutes: p.minutes || 0,
      entree: {
        id: `tp-${cle}`,
        semaine,
        personne: p.personne,
        projetId: p.projetId,
        phase: p.phase,
        heures: 0,
      },
    })
  }
  // La division vient ICI, une fois par ligne agrégée, jamais par pointage.
  return [...par.values()]
    .map(({ entree, minutes }) => ({ ...entree, heures: heuresDepuisMinutes(minutes) }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

// ------------------------------------------------------------
// 4. Seconde projection : vers `Tache.tempsEnregistre` (B.9)
// ------------------------------------------------------------

/**
 * Le temps enregistré par tâche, en heures.
 *
 * La version 1 du plan avait oublié cette projection : arrêter un chrono
 * démarré depuis une tâche laissait la tâche inchangée, alors que le §8.5
 * la prévoit et que le critère 8 exige le rattachement « à un projet ou à
 * une tâche ».
 *
 * Un pointage sans `tacheId` alimente le projet seul — aucune régression
 * sur les saisies qui n'ont jamais désigné de tâche.
 */
export function tempsParTache(pointages: Pointage[]): Map<string, number> {
  const minutes = new Map<string, number>()
  for (const p of pointages || []) {
    if (!p.fin || !p.tacheId) continue
    minutes.set(p.tacheId, (minutes.get(p.tacheId) || 0) + (p.minutes || 0))
  }
  const heures = new Map<string, number>()
  for (const [id, m] of minutes) heures.set(id, heuresDepuisMinutes(m))
  return heures
}

// ------------------------------------------------------------
// 5. B.7 — le caractère facturable
// ------------------------------------------------------------

/**
 * La règle ACTUELLE, reconduite telle quelle : ce qui porte un projet est
 * facturable, le reste ne l'est pas. Elle n'est pas juste dans tous les
 * cas — un déplacement, une reprise après erreur — d'où B.7 : la valeur
 * est un DÉFAUT, et elle se corrige par pointage.
 *
 * Changer la règle par défaut en même temps qu'on la rend modifiable
 * aurait déplacé la marge historique sans que personne l'ait demandé.
 */
export function facturableParDefaut(projetId: string | null): boolean {
  return !!projetId
}

/** minutes facturables d'un ensemble de pointages — ce sur quoi la marge
 *  se calcule une fois B.7 en service */
export function minutesFacturables(pointages: Pointage[]): number {
  return (pointages || [])
    .filter((p) => p.fin && p.facturable)
    .reduce((s, p) => s + (p.minutes || 0), 0)
}

// ------------------------------------------------------------
// 6. Créer un pointage
// ------------------------------------------------------------

let compteur = 0

export function idPointage(): string {
  compteur += 1
  return `pt-${Date.now().toString(36)}-${compteur.toString(36)}`
}

export interface NouveauPointage {
  personne: string
  debut: string
  fin?: string | null
  minutes?: number
  projetId?: string | null
  phase?: PhaseCode | null
  tacheId?: string | null
  activite?: TypeActivite
  commentaire?: string
  facturable?: boolean
  source?: string
}

/** minutes entre deux bornes ISO, jamais négatif */
export function minutesEntre(debut: string, fin: string): number {
  const d = Date.parse(debut)
  const f = Date.parse(fin)
  if (!Number.isFinite(d) || !Number.isFinite(f)) return 0
  return Math.max(0, Math.round((f - d) / 60000))
}

export function creerPointage(champs: NouveauPointage): Pointage {
  const maintenant = new Date().toISOString()
  const fin = champs.fin ?? null
  return {
    id: idPointage(),
    personne: champs.personne,
    debut: champs.debut,
    fin,
    // La durée fournie l'emporte : une correction manuelle ne doit pas
    // être écrasée par le calcul des bornes.
    minutes: typeof champs.minutes === 'number' ? Math.max(0, Math.round(champs.minutes)) : fin ? minutesEntre(champs.debut, fin) : 0,
    projetId: champs.projetId ?? null,
    phase: champs.phase ?? null,
    tacheId: champs.tacheId ?? null,
    activite: champs.activite ?? 'autre',
    commentaire: champs.commentaire?.trim() || '',
    facturable: champs.facturable ?? facturableParDefaut(champs.projetId ?? null),
    validee: false,
    source: champs.source || 'saisie',
    creeLe: maintenant,
    majLe: maintenant,
  }
}
