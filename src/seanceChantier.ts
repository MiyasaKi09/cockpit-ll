// C3 — LE RELEVÉ DE SÉANCE (retour d'usage du 06/08/2026).
//
// CE QUI A ÉTÉ REFUSÉ, ET POURQUOI L'AGENCE A RAISON
// ---------------------------------------------------
// Le lot C avait livré un bloc « Préparer la réunion » : une belle synthèse,
// EN LECTURE, qui assemblait les chiffres des registres lot par lot. Verdict
// de l'agence : « je ne vois pas où créer ça, le modifier, etc. Il faudrait
// que ça soit à la limite une version du CR précédent, ajusté. Il faudrait
// pouvoir faire une sorte de to-do améliorée, où on garde tout mais où tout
// se range en fonction de ce qui est fait ou non. »
//
// Autrement dit : un tableau de bord n'est pas un ordre du jour. On ne
// « lit » pas une réunion de chantier, on la TIENT — point par point, et
// chaque point avance ou n'avance pas. Une séance ne part jamais d'une page
// blanche : elle repart du relevé précédent.
//
// CE QUE CE MODULE FAIT
// ----------------------
// · `preparerSeance` — l'ordre du jour de la prochaine réunion : les points
//   NON RÉSOLUS repris tels quels (le « CR précédent ajusté »), plus ce que
//   la machine sait déjà et qu'elle PROPOSE (visas en retard, pénalités
//   encourues non décidées, désordres GPA ouverts, entreprises à confirmer,
//   lots en retard d'avancement). Proposé, jamais inscrit : rien n'entre à
//   l'ordre du jour sans un geste humain (§15).
// · `rangerPoints` — « on garde tout mais tout se range en fonction de ce
//   qui est fait ou non ». Un RANGEMENT, pas un filtre : rien ne disparaît.
// · `ancienneteEnSeances` — depuis combien de séances un point traîne.
//   C'est ce chiffre-là qui fait la « to-do améliorée » : sans lui, la
//   liste ne dit pas qu'un point est repoussé pour la quatrième fois.
//
// UNE SEULE AUTORITÉ PAR NOTION — rien n'est recalculé ici. L'avancement
// d'un lot et le prédicat « entreprise à confirmer » viennent de
// `src/chantier.ts`, les échéances et retards de visa de `src/visas.ts`,
// les montants encourus et la prolongation de délai de `src/penalites.ts`,
// les désordres ouverts et la fin de GPA de `src/gpa.ts`. Ce module les
// IMPORTE et les met en phrases ; il ne redécide d'aucun seuil.
//
// Logique PURE : aucun store, aucune horloge, aucun réseau. `maintenant`
// est un argument — c'est lui qui date les retards, l'ancienneté et les
// résolutions, et c'est ce qui rend ce producteur rejouable à l'identique.

import type {
  AppState,
  EtatPointSeance,
  MarcheTravaux,
  OriginePointSeance,
  PointSeance,
  ReunionChantier,
} from './types'
import { avancementLot, tacheAConfirmer } from './chantier'
import { echeanceVisa, visasEnRetard } from './visas'
import { desordresOuverts, finGPA } from './gpa'
import { LIBELLE_EVENEMENT, penaliteEncourue, prolongationDelai } from './penalites'
import { addDays, diffDays, fmtDate, fmtMoney } from './util'

const DATE_VALIDE = /^\d{4}-\d{2}-\d{2}$/

/** l'ordre de rangement, et rien d'autre : ce qui reste à faire d'abord,
 *  ce qui est réglé ensuite. Il est PUBLIC parce que l'écran et le papier
 *  affichent leurs groupes dans cet ordre — deux listes écrites à la main
 *  finiraient par diverger. */
export const ORDRE_ETATS_POINT: EtatPointSeance[] = ['a_traiter', 'en_cours', 'fait', 'sans_suite']

export const LIBELLE_ETAT_POINT: Record<EtatPointSeance, string> = {
  a_traiter: 'à traiter',
  en_cours: 'en cours',
  fait: 'fait',
  sans_suite: 'sans suite',
}

/** un point est RÉSOLU quand il ne réclame plus rien de personne — fait, ou
 *  écarté en connaissance de cause. C'est la seule frontière qui compte :
 *  elle décide de ce qui se reporte à la séance suivante, de ce qui se
 *  range en haut ou en bas, et de ce que l'ancienneté continue de compter. */
export function pointResolu(p: Pick<PointSeance, 'etat'>): boolean {
  return p.etat === 'fait' || p.etat === 'sans_suite'
}

/** « 1re séance », « 3ᵉ séance » — l'accord se fait ici, une fois, pour
 *  l'écran comme pour le papier. */
export function libelleAnciennete(n: number): string {
  return n <= 1 ? '1re séance' : `${n}ᵉ séance`
}

/** au-delà de ce nombre de séances, un point ne « suit son cours » plus :
 *  il TRAÎNE, et l'écran le dit. Trois séances de chantier, c'est trois
 *  semaines à un mois et demi selon le rythme — le moment où un point cesse
 *  d'avancer tout seul et où quelqu'un doit décider de le débloquer. */
export const SEUIL_POINT_QUI_TRAINE = 3

// ============================================================
// 1. LE RANGEMENT — « on garde tout, mais tout se range »
// ============================================================

/** rang de l'état dans le rangement. Un état inconnu (import JSON, version
 *  future) passe en dernier plutôt que de disparaître : un point qu'on ne
 *  sait pas classer reste un point, et le perdre en silence serait le seul
 *  vrai défaut possible ici. */
function rangEtat(p: PointSeance): number {
  const i = ORDRE_ETATS_POINT.indexOf(p.etat)
  return i < 0 ? ORDRE_ETATS_POINT.length : i
}

/**
 * LE RANGEMENT DEMANDÉ. Dans l'ordre :
 *   1. « à traiter »   — LES PLUS ANCIENS EN TÊTE. C'est l'inversion qui
 *      fait tout : un point inscrit il y a quatre séances est plus urgent
 *      qu'un point d'aujourd'hui, précisément parce qu'il a déjà été
 *      repoussé quatre fois. Une liste antéchronologique enterre chaque
 *      semaine un peu plus ce qu'il fallait traiter en premier.
 *   2. « en cours »    — même règle, les plus anciens d'abord.
 *   3. « fait »        — les résolutions les plus RÉCENTES en tête : ce
 *      sont celles de la séance, celles qu'on annonce.
 *   4. « sans suite »  — idem, en fin de relevé.
 *
 * RIEN N'EST MASQUÉ, rien n'est supprimé, rien n'est agrégé : c'est un
 * rangement, pas un filtre. Un relevé qui cacherait les points faits ne
 * serait plus le document qu'on envoie après la séance.
 */
export function rangerPoints(points: PointSeance[]): PointSeance[] {
  const liste = (Array.isArray(points) ? points : []).filter((p): p is PointSeance => Boolean(p))
  return liste.slice().sort((a, b) => {
    const ra = rangEtat(a)
    const rb = rangEtat(b)
    if (ra !== rb) return ra - rb
    if (!pointResolu(a) || !pointResolu(b)) {
      // ouverts : le plus ancien en tête — celui qui traîne passe devant
      const c = (a.inscritLe || '').localeCompare(b.inscritLe || '')
      if (c !== 0) return c
    } else {
      // réglés : la décision la plus fraîche en tête de son groupe
      const da = a.resoluLe || a.majLe || a.inscritLe || ''
      const db = b.resoluLe || b.majLe || b.inscritLe || ''
      const c = db.localeCompare(da)
      if (c !== 0) return c
    }
    // dernier départage : stable d'un affichage à l'autre, sinon deux
    // impressions du même relevé ne donneraient pas le même papier
    return (a.id || '').localeCompare(b.id || '')
  })
}

export interface GroupePoints<T> {
  etat: EtatPointSeance
  libelle: string
  entrees: T[]
}

/** partitionne un relevé DÉJÀ rangé en groupes d'état, dans l'ordre du
 *  rangement. Ne trie rien : `rangerPoints` reste la seule autorité de
 *  l'ordre — ici on ne fait que poser les intertitres. Les groupes vides
 *  ne sortent pas : un intertitre sans ligne n'apprend rien. */
export function grouperPoints<T>(
  entrees: T[],
  etatDe: (e: T) => EtatPointSeance,
): GroupePoints<T>[] {
  const groupes: GroupePoints<T>[] = []
  for (const etat of ORDRE_ETATS_POINT) {
    const dedans = entrees.filter((e) => etatDe(e) === etat)
    if (dedans.length > 0) groupes.push({ etat, libelle: LIBELLE_ETAT_POINT[etat], entrees: dedans })
  }
  // un état hors liste (import JSON) ne doit pas s'évaporer du relevé
  const connus = new Set<string>(ORDRE_ETATS_POINT)
  const orphelins = entrees.filter((e) => !connus.has(etatDe(e)))
  if (orphelins.length > 0) {
    groupes.push({ etat: 'a_traiter', libelle: 'état inconnu — à reprendre', entrees: orphelins })
  }
  return groupes
}

// ============================================================
// 2. L'ANCIENNETÉ — « ce point traîne depuis trois séances »
// ============================================================

/** les dates des réunions d'un projet, propres et triées */
function datesSeances(reunions: ReunionChantier[], projetId: string): string[] {
  return (Array.isArray(reunions) ? reunions : [])
    .filter((r) => r && r.projetId === projetId && typeof r.date === 'string' && DATE_VALIDE.test(r.date))
    .map((r) => r.date)
    .sort()
}

/**
 * Depuis combien de SÉANCES ce point est à l'ordre du jour — la séance en
 * préparation comprise. 1 = il apparaît pour la première fois.
 *
 * Compté, jamais stocké : un compteur incrémenté à chaque séance mentirait
 * dès qu'une réunion est reprogrammée, ajoutée après coup ou supprimée. On
 * compte donc les réunions du projet qui tombent entre l'apparition du
 * point et `jusquA` — et la réponse suit toujours l'agenda réel.
 *
 * `jusquA` est la date de la séance qu'on prépare (ou le jour même quand
 * aucune n'est programmée) : elle vient de l'appelant, jamais d'une horloge
 * lue ici.
 *
 * Un point né hors séance compte à partir de son inscription : la première
 * réunion qui suit est sa 1re séance, exactement comme s'il y était né.
 */
export function ancienneteEnSeances(
  point: Pick<PointSeance, 'projetId' | 'reunionOrigineId' | 'inscritLe'>,
  reunions: ReunionChantier[],
  jusquA: string,
): number {
  if (!point) return 1
  const origineReunion = (Array.isArray(reunions) ? reunions : []).find(
    (r) => r && r.id === point.reunionOrigineId,
  )
  const depuis =
    origineReunion && DATE_VALIDE.test(origineReunion.date)
      ? origineReunion.date
      : typeof point.inscritLe === 'string' && DATE_VALIDE.test(point.inscritLe)
        ? point.inscritLe
        : null
  if (!depuis) return 1
  const compte = datesSeances(reunions, point.projetId).filter((d) => d >= depuis && d <= jusquA).length
  // au moins 1 : le point figure au relevé qu'on est en train de tenir,
  // même si aucune réunion n'est encore posée à l'agenda
  return Math.max(1, compte)
}

// ============================================================
// 3. CE QUE LA MACHINE PROPOSE — et qu'un humain inscrit
// ============================================================

/** une proposition : ce que les registres savent déjà, mis en une phrase
 *  d'ordre du jour. Elle n'est PAS un point — elle le devient si, et
 *  seulement si, quelqu'un l'inscrit (§15). */
export interface PropositionSeance {
  /** clé STABLE de la proposition (`visa:v-12`). C'est elle qui se pose sur
   *  le point inscrit (`origineRef`) et qui empêche de reproposer demain ce
   *  qui est déjà au relevé aujourd'hui — accepté COMME écarté. */
  cle: string
  origine: OriginePointSeance
  /** la ligne d'ordre du jour telle qu'elle s'inscrira */
  libelle: string
  /** pourquoi la machine le propose : dates, montants, contacts. C'est ce
   *  qui rend la proposition VÉRIFIABLE avant d'être acceptée — et c'est ce
   *  qu'on lit en séance quand le point est discuté. */
  detail: string
  marcheId: string | null
  lot: string
  responsable: string | null
  echeance: string | null
}

/** « null n'est pas 0 » : un montant absent s'écrit « ? », jamais « 0 € » —
 *  un zéro affirmerait que le CCAP a été lu et que la pénalité est nulle */
const euros = (v: number | null | undefined): string =>
  v === null || v === undefined ? '?' : fmtMoney(v, true)

/** un délai se lit en mots : c'est le signe du nombre de jours qu'on rate
 *  quand on lit vite, et c'est justement celui-là qui compte */
function delaiEnMots(j: number | null): string {
  if (j === null) return 'échéance inconnue'
  if (j < 0) return `en retard de ${-j} j`
  if (j === 0) return "échéance aujourd'hui"
  return `dans ${j} j`
}

/** « Lot 02 — Charpente · Charpentes Leroy », ou la vérité quand rien n'est
 *  rattaché : quelqu'un doit le dire, ce n'est pas à la machine de choisir */
function rattachement(marche: MarcheTravaux | null | undefined, lotTexte?: string): string {
  const parts = [marche?.lot || lotTexte || '', marche?.entreprise || ''].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'lot non rattaché'
}

/**
 * Un lot « en retard d'avancement ». Aucun seuil n'est inventé ici : le
 * délai contractuel du marché (`dateFin`) est PROLONGÉ des jours
 * d'intempéries reconnues — `prolongationDelai` (src/penalites.ts, 5.3),
 * la même autorité qui déduit ces jours des pénalités. Annoncer un retard
 * que la pluie excuse serait réclamer en séance ce que le CCAG accorde.
 *
 * Le marché doit être ACTIF et la réception non prononcée : un lot
 * réceptionné n'est plus en retard, il est fini.
 *
 * L'avancement CONSTATÉ vient d'`avancementLot` (src/chantier.ts) et peut
 * valoir null — aucune tâche de planning rattachée. Le retard de DÉLAI, lui,
 * est un fait de calendrier : on le porte à l'ordre du jour et on dit que
 * l'avancement reste à constater, plutôt que de se taire.
 */
function lotEnRetard(
  m: MarcheTravaux,
  state: AppState,
  maintenant: string,
): { jours: number; finProlongee: string; prolongation: number; avancement: number | null } | null {
  if (!m || !m.actif || m.dateReception) return null
  if (typeof m.dateFin !== 'string' || !DATE_VALIDE.test(m.dateFin)) return null
  const prolongation = prolongationDelai(m, state.intemperies)
  const finProlongee = prolongation > 0 ? addDays(m.dateFin, prolongation) : m.dateFin
  if (finProlongee >= maintenant) return null
  const avancement = avancementLot(state.tachesChantier, m.id)
  // 100 % constaté : le délai est dépassé mais le travail est fait — c'est
  // la réception qui manque, et elle a sa propre carte
  if (avancement !== null && avancement >= 100) return null
  return { jours: -diffDays(maintenant, finProlongee), finProlongee, prolongation, avancement }
}

/**
 * Ce que la machine sait déjà, mis à l'ordre du jour — PROPOSÉ, jamais
 * inscrit. Cinq familles, toutes lues des autorités existantes :
 *
 *   · visas en retard (src/visas.ts) — la responsabilité de la MOE court ;
 *   · pénalités encourues NON DÉCIDÉES (src/penalites.ts) — une pénalité
 *     appliquée est une décision déjà signifiée, elle n'a plus sa place à
 *     un ordre du jour ;
 *   · désordres GPA ouverts (src/gpa.ts) ;
 *   · entreprises à confirmer (src/chantier.ts, même prédicat que l'alerte
 *     de l'accueil et que l'écran planning) ;
 *   · lots en retard d'avancement (ci-dessus).
 *
 * Une proposition DÉJÀ inscrite au relevé ne revient pas : la question vit
 * désormais à un seul endroit, avec son état et son ancienneté. C'est vrai
 * qu'elle ait été acceptée ou écartée — « écarter », ici, c'est inscrire le
 * point directement « sans suite », ce qui laisse la trace de la décision
 * au lieu de la faire disparaître.
 */
function propositionsSeance(state: AppState, projetId: string, maintenant: string): PropositionSeance[] {
  const marches = state.marches.filter((m) => m.projetId === projetId)
  const marcheDe = (id: string | null | undefined) => (id ? marches.find((m) => m.id === id) ?? null : null)
  const props: PropositionSeance[] = []

  // --- visas en retard : le délai du CCAP est dépassé, la MOE est engagée
  for (const v of visasEnRetard(state.visas.filter((x) => x.projetId === projetId), maintenant)) {
    const m = marcheDe(v.marcheId)
    const echeance = echeanceVisa(v)
    props.push({
      cle: `visa:${v.id}`,
      origine: 'visa',
      libelle: `Visa à rendre — ${v.document}`,
      detail:
        `${rattachement(m, v.lot)} · reçu le ${fmtDate(v.recuLe)} · échéance CCAP ` +
        `${echeance ? fmtDate(echeance) : '?'} (${delaiEnMots(echeance ? diffDays(maintenant, echeance) : null)})`,
      marcheId: v.marcheId ?? null,
      lot: m?.lot || v.lot || '',
      // le visa est un geste de la MAÎTRISE D'ŒUVRE : c'est nous qui devons
      // agir, et c'est pour ça qu'un visa en retard est le pire des points
      responsable: 'MOE',
      echeance,
    })
  }

  // --- pénalités encourues non décidées
  for (const e of state.evenementsMarche) {
    if (e.projetId !== projetId || e.penaliteAppliquee) continue
    const m = marcheDe(e.marcheId)
    const calcul = m ? penaliteEncourue(e, m.penalites, prolongationDelai(m, state.intemperies)) : null
    props.push({
      cle: `penalite:${e.id}`,
      origine: 'penalite',
      libelle: `Pénalité encourue à annoncer — ${LIBELLE_EVENEMENT[e.type] || e.type}`,
      detail:
        `${rattachement(m)} · constat du ${fmtDate(e.date)}` +
        (e.document ? ` · ${e.document}` : '') +
        ` · encouru ${euros(calcul === null ? null : calcul.montantHT)} HT` +
        (calcul === null ? ' (taux du CCAP non saisi)' : '') +
        (calcul && calcul.joursDeduits > 0 ? ` (− ${calcul.joursDeduits} j d’intempéries)` : ''),
      marcheId: e.marcheId ?? null,
      lot: m?.lot || '',
      // appliquer une pénalité est une décision de maîtrise d'œuvre, signée :
      // le point porte l'annonce en séance, jamais l'application
      responsable: 'MOE',
      echeance: null,
    })
  }

  // --- désordres de l'année de parfait achèvement
  for (const d of desordresOuverts(state.desordresGPA.filter((x) => x.projetId === projetId))) {
    const m = marcheDe(d.marcheId)
    const fin = m ? finGPA(m.dateReception) : null
    props.push({
      cle: `gpa:${d.id}`,
      origine: 'gpa',
      libelle: `Désordre à lever (parfait achèvement) — ${d.description}`,
      detail:
        `${rattachement(m, d.lot)} · signalé le ${fmtDate(d.signaleLe)}` +
        (d.signalePar ? ` par ${d.signalePar}` : '') +
        ` · fin de GPA ${fin ? fmtDate(fin) : 'inconnue (réception non saisie)'}` +
        (Array.isArray(d.relances) && d.relances.length > 0 ? ` · ${d.relances.length} relance(s) tracée(s)` : ''),
      marcheId: d.marcheId ?? null,
      lot: m?.lot || d.lot || '',
      responsable: m?.entreprise || null,
      echeance: fin,
    })
  }

  // --- entreprises à confirmer (même prédicat que l'accueil et le planning)
  for (const t of state.tachesChantier) {
    if (t.projetId !== projetId) continue
    const m = marcheDe(t.marcheId)
    if (!tacheAConfirmer(t, m, maintenant)) continue
    props.push({
      cle: `confirmation:${t.id}`,
      origine: 'confirmation',
      libelle: `Confirmer l’intervention — ${t.designation}`,
      detail:
        `${rattachement(m, t.lot)} · début prévu le ${fmtDate(t.debut)} ` +
        `(${delaiEnMots(t.debut ? diffDays(maintenant, t.debut) : null)})` +
        (m?.contactNom ? ` · ${m.contactNom}` : '') +
        (m?.contactEmail ? ` · ${m.contactEmail}` : ''),
      marcheId: t.marcheId ?? null,
      lot: m?.lot || t.lot || '',
      responsable: m?.entreprise || null,
      echeance: t.debut,
    })
  }

  // --- lots en retard d'avancement
  for (const m of marches) {
    const retard = lotEnRetard(m, state, maintenant)
    if (!retard) continue
    props.push({
      cle: `avancement:${m.id}`,
      origine: 'avancement',
      libelle: `Retard d’exécution — ${m.lot}`,
      detail:
        `${rattachement(m)} · délai contractuel au ${fmtDate(retard.finProlongee)}` +
        (retard.prolongation > 0
          ? ` (${fmtDate(m.dateFin)} + ${retard.prolongation} j d’intempéries reconnues)`
          : '') +
        ` · dépassé de ${retard.jours} j · réception non prononcée · avancement constaté ` +
        (retard.avancement === null ? '? (aucune tâche de planning rattachée)' : `${retard.avancement} %`),
      marcheId: m.id,
      lot: m.lot,
      responsable: m.entreprise || null,
      echeance: null,
    })
  }

  return props
}

// ============================================================
// 4. L'ORDRE DU JOUR — le « CR précédent, ajusté »
// ============================================================

export interface EntreeSeance {
  point: PointSeance
  /** depuis combien de séances il est à l'ordre du jour (1 = aujourd'hui) */
  anciennete: number
  /** repris d'une séance antérieure — c'est exactement le « CR précédent
   *  ajusté » que l'agence demande, et il ne coûte aucune recopie : le
   *  point n'a jamais appartenu à la séance d'avant */
  reporte: boolean
  /** il ne « suit plus son cours » : il traîne, et l'écran doit le dire */
  traine: boolean
}

export interface OrdreDuJour {
  /** la séance visée : la plus proche à venir, aujourd'hui compris. null =
   *  aucune date posée — on prépare quand même, et l'écran le dit */
  seance: ReunionChantier | null
  /** celle d'avant : le relevé qu'on « ajuste » */
  seancePrecedente: ReunionChantier | null
  /** la date à laquelle l'ancienneté est comptée (la séance, ou le jour même) */
  jusquA: string
  /** TOUS les points du projet, rangés — rien n'est masqué */
  entrees: EntreeSeance[]
  /** les mêmes, avec leurs intertitres */
  groupes: GroupePoints<EntreeSeance>[]
  /** ce que la machine propose et qui n'est pas encore au relevé */
  propositions: PropositionSeance[]
  nbParEtat: Record<EtatPointSeance, number>
  /** combien de points non résolus sont repris de séances antérieures */
  reportes: number
  /** combien traînent depuis SEUIL_POINT_QUI_TRAINE séances ou plus */
  quiTrainent: number
}

/**
 * L'ORDRE DU JOUR DE LA PROCHAINE SÉANCE.
 *
 * Il ne se construit pas : il se CONSTATE. Les points non résolus sont déjà
 * là — ils appartiennent au projet, pas à la réunion précédente — et c'est
 * précisément ce qui rend le report automatique et gratuit. La seule chose
 * qui s'ajoute, ce sont les PROPOSITIONS de la machine, qui restent hors du
 * relevé tant que personne ne les a inscrites.
 *
 * `maintenant` est un argument (aucune horloge ici) : il date les retards
 * proposés et sert de repère quand aucune séance n'est programmée.
 */
export function preparerSeance(
  state: AppState,
  projetId: string,
  options: { maintenant: string },
): OrdreDuJour {
  const maintenant = options.maintenant
  const reunions = (state.reunions || []).filter((r) => r && r.projetId === projetId)

  // la séance visée : la plus PROCHE à venir, aujourd'hui compris — la même
  // règle qu'affiche l'en-tête de la carte Réunions
  const seance =
    reunions
      .filter((r) => r.date >= maintenant)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  const bornePrecedente = seance ? seance.date : maintenant
  const seancePrecedente =
    reunions
      .filter((r) => r.date < bornePrecedente)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  const jusquA = seance ? seance.date : maintenant

  const points = rangerPoints((state.pointsSeance || []).filter((p) => p && p.projetId === projetId))
  const entrees: EntreeSeance[] = points.map((point) => {
    const anciennete = ancienneteEnSeances(point, reunions, jusquA)
    return {
      point,
      anciennete,
      reporte: !pointResolu(point) && anciennete > 1,
      traine: !pointResolu(point) && anciennete >= SEUIL_POINT_QUI_TRAINE,
    }
  })

  const nbParEtat: Record<EtatPointSeance, number> = {
    a_traiter: 0,
    en_cours: 0,
    fait: 0,
    sans_suite: 0,
  }
  for (const e of entrees) if (e.point.etat in nbParEtat) nbParEtat[e.point.etat]++

  // une proposition déjà portée au relevé ne se repropose pas — quel que
  // soit son état : c'est le relevé qui porte la question, désormais
  const dejaInscrites = new Set(
    (state.pointsSeance || [])
      .filter((p) => p && p.projetId === projetId && p.origineRef)
      .map((p) => p.origineRef as string),
  )
  const propositions = propositionsSeance(state, projetId, maintenant).filter((p) => !dejaInscrites.has(p.cle))

  return {
    seance,
    seancePrecedente,
    jusquA,
    entrees,
    groupes: grouperPoints(entrees, (e) => e.point.etat),
    propositions,
    nbParEtat,
    reportes: entrees.filter((e) => e.reporte).length,
    quiTrainent: entrees.filter((e) => e.traine).length,
  }
}

// ============================================================
// 5. LES TROIS FABRIQUES — un point naît, change d'état, se corrige
// ============================================================

/** ce que l'écran sait au moment du geste : l'identifiant à donner, la
 *  séance en cours de préparation, et le jour. Rien d'autre — surtout pas
 *  une horloge lue ici. */
export interface ContexteGeste {
  id: string
  projetId: string
  maintenant: string
  /** la séance à laquelle le point apparaît — null s'il naît entre deux
   *  réunions, ce qui est le cas courant */
  reunionId: string | null
}

export interface ChampsPoint {
  libelle: string
  marcheId: string | null
  lot?: string
  responsable: string | null
  echeance: string | null
  notes?: string
}

/** un point saisi à la main. Naît « à traiter » : un point qu'on écrit est
 *  un point qu'on n'a pas encore traité — le contraire serait une drôle de
 *  façon de commencer. */
export function pointNouveau(champs: ChampsPoint, ctx: ContexteGeste): PointSeance {
  return {
    id: ctx.id,
    projetId: ctx.projetId,
    marcheId: champs.marcheId,
    lot: champs.lot || undefined,
    libelle: champs.libelle.trim(),
    responsable: champs.responsable?.trim() || null,
    echeance: champs.echeance || null,
    etat: 'a_traiter',
    inscritLe: ctx.maintenant,
    reunionOrigineId: ctx.reunionId,
    resoluLe: null,
    notes: champs.notes || undefined,
    majLe: ctx.maintenant,
  }
}

/**
 * Un point né d'une PROPOSITION acceptée — ou écartée.
 *
 * `etat` vaut normalement « à traiter » (la proposition est inscrite à
 * l'ordre du jour) ; « sans suite » quand on l'écarte. Écarter n'efface
 * donc rien : la proposition entre au relevé, rangée tout en bas, avec la
 * date à laquelle on a décidé de ne pas la suivre — et elle peut être
 * rouverte d'un geste. C'est ce qui distingue « vu et écarté » de « jamais
 * vu », six mois plus tard.
 *
 * `origineRef` porte la clé : c'est elle qui fait que la machine ne
 * repropose pas demain ce qui a été tranché aujourd'hui.
 */
export function pointDepuisProposition(
  proposition: PropositionSeance,
  ctx: ContexteGeste,
  etat: EtatPointSeance = 'a_traiter',
): PointSeance {
  const resolu = etat === 'fait' || etat === 'sans_suite'
  return {
    id: ctx.id,
    projetId: ctx.projetId,
    marcheId: proposition.marcheId,
    lot: proposition.lot || undefined,
    libelle: proposition.libelle,
    responsable: proposition.responsable,
    echeance: proposition.echeance,
    etat,
    inscritLe: ctx.maintenant,
    reunionOrigineId: ctx.reunionId,
    resoluLe: resolu ? ctx.maintenant : null,
    origine: proposition.origine,
    origineRef: proposition.cle,
    // le « pourquoi » de la machine reste attaché au point : sans lui, la
    // ligne devient un libellé orphelin qu'il faut re-vérifier à la main
    notes: proposition.detail,
    majLe: ctx.maintenant,
  }
}

/**
 * LE GESTE DE LA RÉUNION : changer l'état d'un point.
 *
 * La date de résolution se pose en entrant dans « fait » / « sans suite »,
 * et se RETIRE en sortant : un point rouvert n'est plus résolu, et laisser
 * traîner sa date le rangerait entre deux points réglés à la prochaine
 * impression. La date de première inscription, elle, ne bouge jamais —
 * c'est elle qui porte l'ancienneté, et la réécrire remettrait à zéro le
 * compteur du point qui traîne le plus, exactement au moment où quelqu'un
 * s'en occupe enfin.
 *
 * Copie, jamais mutation : l'appelant range le résultat dans son écriture,
 * ce qui laisse un seul « Annuler » pour le geste entier.
 */
export function pointAvecEtat(p: PointSeance, etat: EtatPointSeance, maintenant: string): PointSeance {
  const resolu = etat === 'fait' || etat === 'sans_suite'
  return {
    ...p,
    etat,
    resoluLe: resolu ? p.resoluLe || maintenant : null,
    majLe: maintenant,
  }
}

/** correction d'un point : libellé, rattachement, responsable, échéance.
 *  L'état ne passe PAS par ici — il a son geste, plus rapide (`pointAvecEtat`). */
export function pointCorrige(p: PointSeance, champs: ChampsPoint, maintenant: string): PointSeance {
  return {
    ...p,
    libelle: champs.libelle.trim(),
    marcheId: champs.marcheId,
    lot: champs.lot || undefined,
    responsable: champs.responsable?.trim() || null,
    echeance: champs.echeance || null,
    notes: champs.notes ?? p.notes,
    majLe: maintenant,
  }
}
