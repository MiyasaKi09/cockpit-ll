// ============================================================
// planningTravaux — LA GÉOMÉTRIE ET LES RÈGLES DU GANTT CHANTIER
//
// L'agence : « Par chantier mais il faut une gestion plus fine de ce qu'on
// peut faire, UN VRAI GANTT ». Un vrai Gantt n'est pas un dessin : c'est un
// outil sur lequel on AGIT. On attrape une barre, on la pousse de trois
// semaines, et la date du marché suit.
//
// POURQUOI TOUT CELA VIT ICI, ET PAS DANS L'ÉCRAN
// ------------------------------------------------
// Un glissement de barre est une conversion : des pixels vers une date. Si
// cette conversion est écrite au milieu d'un `onPointerMove`, personne ne
// peut la vérifier — il faudrait un navigateur, une souris et un œil. Elle
// se casse alors en silence, et le seul symptôme est un planning décalé
// d'un jour que l'on met des mois à remarquer, parce qu'un jour d'écart
// ressemble à une erreur de saisie.
//
// Toute la géométrie (position d'une barre, échelle, graduations,
// pixel → jour) et toutes les règles (retard, décrochage, chevauchement,
// prolongation par intempéries, propagation d'un décalage) sont donc des
// fonctions PURES, ici, avec `today` en paramètre. `Planning.tsx` ne fait
// que rendre et capter les gestes.
//
// CE QUE CE MODULE NE RECALCULE JAMAIS
// -------------------------------------
// · l'avancement d'un lot — `avancementLot` (src/chantier.ts) fait autorité,
//   parce que c'est le chiffre constaté en réunion de chantier et celui que
//   lit le contrôle des situations (5.5). Un Gantt qui le recalculerait à sa
//   façon afficherait un pourcentage différent de celui du CR, et l'écart se
//   découvrirait devant l'entreprise ;
// · la prolongation de délai par intempéries — `prolongationDelai`
//   (src/penalites.ts) fait autorité, parce que c'est le même chiffre qui
//   déduit les jours de retard des pénalités. Deux lectures divergentes, et
//   le planning excuserait un retard que le décompte facture.
//
// Les deux sont IMPORTÉS. C'est la règle, et c'est le défaut n°1 de l'audit.
// ============================================================

import type { Intemperie, MarcheTravaux, Projet, ReunionChantier, TacheChantier } from './types'
import { addDays, clamp, diffDays, fmtDate, mondayOf } from './util'
import { avancementLot } from './chantier'
import { prolongationDelai } from './penalites'

// ------------------------------------------------------------
// 1. L'ÉCHELLE ET LA FENÊTRE
// ------------------------------------------------------------
//
// « Un chantier de dix-huit mois et une semaine de gel ne se lisent pas à la
// même échelle » : deux échelles, et une seule fenêtre pour les deux, parce
// que tout le reste (position d'une barre, conversion d'un glissement) ne
// dépend que de `debut` et `jours`.

/** Les deux zooms. `semaine` pour conduire le mois en cours (on y distingue
 *  un lundi d'un vendredi) ; `mois` pour lire une année de chantier d'un
 *  coup d'œil. */
export type Echelle = 'semaine' | 'mois'

export interface FenetrePlanning {
  /** premier jour visible, INCLUS (un lundi en échelle semaine, un 1er du
   *  mois en échelle mois — l'ancrage est ce qui rend les graduations
   *  régulières) */
  debut: string
  /** premier jour NON visible — borne exclusive. Une borne incluse
   *  obligerait chaque appelant à se souvenir du +1, et l'un d'eux
   *  l'oublierait */
  fin: string
  /** nombre de jours couverts — le dénominateur de toute la géométrie */
  jours: number
  echelle: Echelle
  /** nombre de pas d'échelle (semaines ou mois) demandés */
  pas: number
}

/** premier jour du mois d'une date ISO */
export function debutMoisDe(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

/** ajoute n mois à un 1er du mois ISO (arithmétique sur les composantes :
 *  passer par un objet Date ferait dépendre le résultat du fuseau du poste) */
export function ajouterMois(premierDuMois: string, n: number): string {
  const a = Number(premierDuMois.slice(0, 4))
  const m = Number(premierDuMois.slice(5, 7)) - 1 + n
  const annee = a + Math.floor(m / 12)
  const mois = ((m % 12) + 12) % 12
  return `${annee}-${String(mois + 1).padStart(2, '0')}-01`
}

/** construit la fenêtre visible : `pas` semaines ou `pas` mois à partir de
 *  la date d'ancrage, ALIGNÉE sur le pas (lundi / 1er du mois). L'alignement
 *  n'est pas cosmétique : sans lui, les graduations tombent au milieu des
 *  semaines et deux fenêtres consécutives ne se recouvrent pas exactement,
 *  si bien qu'un aller-retour ‹ › ne revient pas au même endroit. */
export function fenetrePlanning(ancre: string, echelle: Echelle, pas: number): FenetrePlanning {
  const n = Math.max(1, Math.round(Number.isFinite(pas) ? pas : 1))
  if (echelle === 'semaine') {
    const debut = mondayOf(ancre)
    const fin = addDays(debut, n * 7)
    return { debut, fin, jours: n * 7, echelle, pas: n }
  }
  const debut = debutMoisDe(ancre)
  const fin = ajouterMois(debut, n)
  return { debut, fin, jours: diffDays(debut, fin), echelle, pas: n }
}

/** décale la fenêtre d'un pas d'échelle (le bouton ‹ / ›). Décaler d'un
 *  nombre de JOURS fixe désalignerait la fenêtre du mois au bout de deux
 *  clics — février et mars n'ont pas la même longueur. */
export function decalerFenetre(f: FenetrePlanning, pas: number): FenetrePlanning {
  const ancre =
    f.echelle === 'semaine' ? addDays(f.debut, pas * 7) : ajouterMois(f.debut, pas)
  return fenetrePlanning(ancre, f.echelle, f.pas)
}

const NOMS_MOIS_COURTS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

export interface Graduation {
  /** date de la graduation (bord GAUCHE de la colonne) */
  date: string
  /** position en % de la largeur de la fenêtre */
  gauche: number
  label: string
  /** graduation forte : un 1er du mois en échelle semaine, un janvier en
   *  échelle mois. C'est elle qui donne le repère de lecture quand les
   *  colonnes deviennent nombreuses */
  majeure: boolean
}

/** numéro de semaine ISO-8601 — celui qu'écrivent les entreprises sur leurs
 *  plannings d'atelier (« livraison S12 »). Calculé sur l'époque plutôt que
 *  par `getDay()` : le résultat ne doit dépendre ni de l'horloge ni du fuseau
 *  du poste, sinon les deux machines de l'agence n'affichent pas la même
 *  semaine. */
export function numeroSemaine(iso: string): number {
  const jeudi = addDays(mondayOf(iso), 3) // la semaine ISO appartient à l'année de son jeudi
  const an = jeudi.slice(0, 4)
  const premierJeudi = addDays(mondayOf(`${an}-01-04`), 3)
  return Math.round(diffDays(premierJeudi, jeudi) / 7) + 1
}

/** les graduations de l'échelle courante — l'écran n'en calcule aucune */
export function graduations(f: FenetrePlanning): Graduation[] {
  const g: Graduation[] = []
  if (f.echelle === 'semaine') {
    for (let d = f.debut; d < f.fin; d = addDays(d, 7)) {
      const debutDeMois = Number(d.slice(8, 10)) <= 7 // le lundi qui ouvre le mois
      g.push({
        date: d,
        gauche: pourcent(f, d),
        label: debutDeMois
          ? `${NOMS_MOIS_COURTS[Number(d.slice(5, 7)) - 1]} · S${numeroSemaine(d)}`
          : `S${numeroSemaine(d)}`,
        majeure: debutDeMois,
      })
    }
    return g
  }
  for (let m = f.debut; m < f.fin; m = ajouterMois(m, 1)) {
    const janvier = m.slice(5, 7) === '01'
    g.push({
      date: m,
      gauche: pourcent(f, m),
      label: `${NOMS_MOIS_COURTS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`,
      majeure: janvier,
    })
  }
  return g
}

// ------------------------------------------------------------
// 2. LA GÉOMÉTRIE : DATE ↔ POSITION, DANS LES DEUX SENS
// ------------------------------------------------------------

/** position d'une date en % de la fenêtre, BORNÉE à [0 ; 100] : une barre
 *  qui commence avant la fenêtre s'affiche collée au bord gauche, elle ne
 *  déborde pas sur la ligne précédente */
export function pourcent(f: FenetrePlanning, date: string): number {
  if (f.jours <= 0) return 0
  return clamp((diffDays(f.debut, date) / f.jours) * 100, 0, 100)
}

/** arrondi au plus proche, les demis s'éloignant de zéro.
 *
 *  PAS `Math.round`, et c'est tout l'objet de cette fonction :
 *  `Math.round(36.5)` vaut 37 mais `Math.round(-36.5)` vaut −36, parce que
 *  JavaScript arrondit les demis vers +∞. Un glissement de 100 px vers la
 *  droite avancerait donc de 37 jours, et le MÊME glissement de 100 px vers
 *  la gauche n'en reculerait que de 36 : la barre ne reviendrait pas où on
 *  l'a prise. Un jour d'écart ressemble à une faute de frappe — on le
 *  corrigerait à la main pendant des mois sans jamais soupçonner la
 *  conversion. */
function arrondiSymetrique(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x)
}

/** conversion d'un déplacement en pixels vers un nombre de JOURS entiers.
 *
 *  Arrondi (et non troncature) : un glissement de 3,6 jours est un
 *  glissement de 4 jours, pas de 3. Tronquer ferait qu'une barre poussée
 *  « jusque là » atterrit systématiquement un cran trop tôt, et l'utilisateur
 *  corrigerait à la main chaque fois — c'est-à-dire qu'il cesserait de se
 *  servir du glissement.
 *
 *  Symétrique : voir `arrondiSymetrique`. Aller puis revenir ramène la barre
 *  exactement à sa date de départ, et c'est vérifiable.
 *
 *  `largeurPx <= 0` (piste pas encore mesurée, rendu hors écran) rend 0 :
 *  on ne bouge rien plutôt que de diviser par zéro et de proposer une date
 *  aberrante. */
export function joursDepuisPixels(f: FenetrePlanning, deltaPx: number, largeurPx: number): number {
  if (!Number.isFinite(deltaPx) || !Number.isFinite(largeurPx) || largeurPx <= 0 || f.jours <= 0) return 0
  return arrondiSymetrique((deltaPx / largeurPx) * f.jours)
}

/** largeur d'un jour en pixels — sert à l'écran pour décider si le
 *  glissement est praticable : sous ~3 px par jour, viser une date au doigt
 *  relève du hasard, et c'est la saisie clavier qui doit primer */
export function pixelsParJour(f: FenetrePlanning, largeurPx: number): number {
  if (f.jours <= 0 || !Number.isFinite(largeurPx) || largeurPx <= 0) return 0
  return largeurPx / f.jours
}

/** en dessous de ce nombre de pixels par jour, on ne propose plus le
 *  glissement comme geste principal : sur un téléphone tenu d'une main au
 *  milieu d'un chantier, un pouce couvre une semaine entière */
export const PIXELS_PAR_JOUR_MINIMUM = 3

// ------------------------------------------------------------
// 3. L'INTERVENTION D'UN LOT
// ------------------------------------------------------------

export interface Intervention {
  debut: string
  fin: string
}

/** fenêtre d'intervention d'un marché, ou `null`.
 *
 *  `null`, PAS une période d'un jour à aujourd'hui : un lot dont personne
 *  n'a saisi les dates n'a pas d'intervention, il a une saisie à faire. Lui
 *  inventer une barre le ferait entrer dans les calculs de retard et de
 *  chevauchement avec des dates que personne n'a décidées.
 *
 *  Une seule des deux dates saisie donne une intervention d'UN jour : c'est
 *  ce que l'information dit — « ça commence là », sans durée connue — et
 *  cela reste visible et déplaçable, donc corrigeable d'un geste. */
export function interventionDe(
  m: Pick<MarcheTravaux, 'dateDebut' | 'dateFin'>,
): Intervention | null {
  const d = m.dateDebut || null
  const f = m.dateFin || null
  if (!d && !f) return null
  const debut = d || f!
  const fin = f || d!
  // dates inversées par une saisie ratée : on les remet dans l'ordre pour
  // dessiner, sans corriger la donnée — c'est à l'humain de trancher
  return debut <= fin ? { debut, fin } : { debut: fin, fin: debut }
}

/** durée en jours, bornes incluses (debut = fin → 1 jour, jamais 0) —
 *  la même convention que `poidsTache` (src/chantier.ts) */
export function dureeJours(i: Intervention): number {
  return Math.max(1, diffDays(i.debut, i.fin) + 1)
}

export interface BarreLot {
  /** faux quand l'intervention est entièrement hors de la fenêtre : la ligne
   *  reste (le lot existe) mais ne porte aucune barre */
  visible: boolean
  /** bord gauche, en % de la fenêtre */
  gauche: number
  /** largeur, en % de la fenêtre */
  largeur: number
  /** l'intervention déborde à gauche / à droite de la fenêtre — l'écran
   *  dessine alors un bord en pointe plutôt qu'un bord franc, pour qu'on ne
   *  lise pas la coupure comme une date */
  coupeGauche: boolean
  coupeDroite: boolean
}

/** largeur minimale d'une barre, en % de la fenêtre : sous ce seuil une
 *  intervention d'un jour sur douze mois deviendrait invisible, donc
 *  inattrapable */
export const LARGEUR_MINIMUM_PCT = 0.9

/** géométrie d'une barre. La fin est rendue INCLUSE : une intervention du 3
 *  au 3 occupe la journée du 3 entière, pas un trait d'épaisseur nulle. */
export function barreLot(f: FenetrePlanning, i: Intervention): BarreLot {
  const finExclusive = addDays(i.fin, 1)
  if (finExclusive <= f.debut || i.debut >= f.fin) {
    return { visible: false, gauche: 0, largeur: 0, coupeGauche: false, coupeDroite: false }
  }
  const gauche = pourcent(f, i.debut)
  const largeur = Math.max(LARGEUR_MINIMUM_PCT, pourcent(f, finExclusive) - gauche)
  return {
    visible: true,
    gauche,
    largeur: Math.min(largeur, 100 - gauche),
    coupeGauche: i.debut < f.debut,
    coupeDroite: finExclusive > f.fin,
  }
}

// ------------------------------------------------------------
// 4. LE GESTE : DÉPLACER, ALLONGER, RACCOURCIR
// ------------------------------------------------------------

/** les trois prises d'une barre. `deplacer` = le corps (l'intervention
 *  glisse en gardant sa durée) ; `debut` / `fin` = les poignées de bord
 *  (l'intervention s'allonge ou se raccourcit d'un seul côté). */
export type Prise = 'deplacer' | 'debut' | 'fin'

/** résultat d'un geste : les deux dates proposées, jamais écrites d'ici.
 *  `change` dit si quelque chose a réellement bougé — l'écran s'en sert pour
 *  ne pas empiler un « Annuler » sur un geste nul (relâcher au même endroit,
 *  ou pousser une poignée contre sa butée). */
export interface GesteApplique {
  debut: string
  fin: string
  change: boolean
  /** vrai quand le geste a été retenu par la butée : la poignée de début ne
   *  peut pas dépasser la fin, et réciproquement. L'écran le dit plutôt que
   *  d'ignorer le geste en silence — sinon on croit l'outil bloqué */
  bute: boolean
}

/** applique un geste de `jours` (signé) sur une intervention.
 *
 *  RÈGLE DE BUTÉE : une intervention ne peut pas devenir vide ni inversée.
 *  Tirer la poignée de début au-delà de la fin ne « retourne » pas la barre
 *  — ce serait un lot qui finit avant de commencer, que rien en aval ne sait
 *  lire. Elle s'arrête sur un jour, et le geste est signalé `bute`. */
export function appliquerGeste(i: Intervention, prise: Prise, jours: number): GesteApplique {
  const n = Number.isFinite(jours) ? Math.round(jours) : 0
  if (prise === 'deplacer') {
    const debut = addDays(i.debut, n)
    const fin = addDays(i.fin, n)
    return { debut, fin, change: n !== 0, bute: false }
  }
  if (prise === 'debut') {
    const vise = addDays(i.debut, n)
    const debut = vise > i.fin ? i.fin : vise
    return { debut, fin: i.fin, change: debut !== i.debut, bute: vise > i.fin }
  }
  const vise = addDays(i.fin, n)
  const fin = vise < i.debut ? i.debut : vise
  return { debut: i.debut, fin, change: fin !== i.fin, bute: vise < i.debut }
}

/** pas du clavier / des boutons — « au doigt sur un téléphone, le glissement
 *  est imprécis, et l'outil sert SUR le chantier ». Un jour pour ajuster, une
 *  semaine parce que c'est l'unité dans laquelle un chantier prend du retard. */
export const PAS_JOUR = 1
export const PAS_SEMAINE = 7

// ------------------------------------------------------------
// 5. LA PROPAGATION D'UN DÉCALAGE
// ------------------------------------------------------------

/** une écriture proposée sur un marché — l'écran l'applique, ce module ne
 *  touche à rien. Les deux dates sont ABSOLUES (et non un delta) : rejouer
 *  la liste deux fois donne le même planning, ce qu'un delta ne garantit
 *  pas si l'écran hoquette. */
export interface ReportLot {
  marcheId: string
  debut: string | null
  fin: string | null
}

/** décale un lot, et — si `propager` — tout ce qui démarre à partir de lui
 *  SUR LE MÊME CHANTIER.
 *
 *  Propagation par DATE et non par ordre de saisie : c'est le réel du
 *  chantier qui commande, et l'ordre dans lequel les marchés ont été créés
 *  n'a rien à voir avec celui dans lequel les entreprises interviennent.
 *
 *  Ne franchit JAMAIS la frontière du chantier : deux chantiers qui
 *  partagent une entreprise n'ont pas à glisser ensemble — c'est justement
 *  le conflit que `chevauchementsEntreprise` fait voir, pour qu'un humain
 *  tranche. Décaler l'autre chantier « pour arranger » serait décider à sa
 *  place.
 *
 *  Un lot sans aucune date n'est jamais touché : il n'a rien à décaler, et
 *  lui poser des dates ici les ferait naître d'un geste qui ne le visait pas. */
export function reporterLots(
  marches: MarcheTravaux[],
  marcheId: string,
  jours: number,
  propager: boolean,
): ReportLot[] {
  const n = Number.isFinite(jours) ? Math.round(jours) : 0
  if (n === 0) return []
  const liste = Array.isArray(marches) ? marches : []
  const ref = liste.find((m) => m.id === marcheId)
  if (!ref) return []
  const seuilInt = interventionDe(ref)
  const seuil = seuilInt ? seuilInt.debut : null

  const reports: ReportLot[] = []
  for (const m of liste) {
    const vise =
      m.id === marcheId ||
      (propager &&
        seuil !== null &&
        m.projetId === ref.projetId &&
        (() => {
          const i = interventionDe(m)
          return i !== null && i.debut >= seuil
        })())
    if (!vise) continue
    if (!m.dateDebut && !m.dateFin) continue
    reports.push({
      marcheId: m.id,
      debut: m.dateDebut ? addDays(m.dateDebut, n) : null,
      fin: m.dateFin ? addDays(m.dateFin, n) : null,
    })
  }
  return reports
}

/** l'écriture d'un geste de barre : le lot visé prend ses dates du geste,
 *  les suivants (si propagation) glissent du même nombre de jours.
 *
 *  Une poignée de bord ne propage RIEN, même case cochée : allonger un lot
 *  de trois jours ne repousse pas mécaniquement les autres — un
 *  chevauchement peut être exactement ce que l'on veut constater, et c'est
 *  ce que le Gantt sert à voir. Seul un DÉPLACEMENT propage. */
export function reportsDuGeste(
  marches: MarcheTravaux[],
  marcheId: string,
  prise: Prise,
  geste: GesteApplique,
  propager: boolean,
): ReportLot[] {
  const liste = Array.isArray(marches) ? marches : []
  const ref = liste.find((m) => m.id === marcheId)
  if (!ref || !geste.change) return []

  const propre: ReportLot = {
    marcheId,
    // on ne fait naître aucune date : un lot qui n'avait que sa fin garde
    // une seule date après le geste
    debut: ref.dateDebut ? geste.debut : null,
    fin: ref.dateFin ? geste.fin : null,
  }
  if (prise !== 'deplacer' || !propager) return [propre]

  const jours = diffDays(interventionDe(ref)!.debut, geste.debut)
  const suivants = reporterLots(liste, marcheId, jours, true).filter((r) => r.marcheId !== marcheId)
  return [propre, ...suivants]
}

// ------------------------------------------------------------
// 6. CE QUI NE VA PAS — SANS AVOIR À LE CHERCHER
// ------------------------------------------------------------

/** écart, en points, à partir duquel l'avancement constaté « décroche » du
 *  temps écoulé. Quinze points : en dessous, l'écart relève du grain de la
 *  saisie (un avancement se constate à la dizaine, en réunion) et une alerte
 *  se lèverait sur presque tous les lots, presque tout le temps — c'est-à-dire
 *  sur aucun. */
export const SEUIL_DECROCHAGE_POINTS = 15

export interface EtatLot {
  /** l'intervention contractuelle telle que saisie — `null` si le lot n'est
   *  pas daté */
  intervention: Intervention | null
  /** jours de prolongation acquis par intempéries reconnues
   *  (`prolongationDelai`, src/penalites.ts — AUTORITÉ IMPORTÉE) */
  prolongationJours: number
  /** fin défendable = fin contractuelle + intempéries reconnues. C'est à
   *  cette date-là que l'entreprise est réellement tenue (CCAG 19.2.3) :
   *  juger sur la fin contractuelle reviendrait à réclamer des jours que le
   *  CCAG accorde */
  finDefendable: string | null
  /** part du délai défendable écoulée au jour `today`, en % — `null` quand
   *  le lot n'est pas daté. Bornée à [0 ; 100] */
  tempsEcoulePct: number | null
  /** avancement constaté (`avancementLot`, src/chantier.ts — AUTORITÉ
   *  IMPORTÉE). `null` — jamais 0 — quand aucune tâche n'est rattachée : le
   *  planning de tâches n'est pas construit, ce n'est pas que rien n'est fait */
  avancementPct: number | null
  /** avancement − temps écoulé, en points. `null` si l'un des deux manque —
   *  un écart calculé sur une inconnue serait une opinion */
  ecartPoints: number | null
  /** la fin DÉFENDABLE est passée, le marché est actif et la réception n'est
   *  pas prononcée */
  enRetard: boolean
  /** jours au-delà de la fin défendable (0 si pas en retard) */
  joursDeRetard: number
  /** l'avancement décroche du temps écoulé au-delà du seuil */
  decroche: boolean
  receptionne: boolean
  /** 0 rien à signaler · 1 à surveiller · 2 en retard */
  gravite: 0 | 1 | 2
  /** ce qu'on dirait à voix haute en réunion — en français, prêt à afficher.
   *  Vit ici plutôt qu'à l'écran pour que la phrase soit vérifiable et ne
   *  puisse pas dire autre chose que le calcul */
  raisons: string[]
}

/** l'état d'un lot au jour `today` : tout ce qu'il faut pour peindre une
 *  barre et dire ce qui cloche, en un seul passage.
 *
 *  N'INVENTE RIEN : `avancementLot` et `prolongationDelai` sont importés, et
 *  ce qui n'est pas connu reste `null`. */
export function etatLot(
  m: MarcheTravaux,
  taches: TacheChantier[],
  intemperies: Intemperie[],
  today: string,
): EtatLot {
  const intervention = interventionDe(m)
  const prolongationJours = prolongationDelai(m, intemperies)
  const avancementPct = avancementLot(taches, m.id)
  const receptionne = Boolean(m.dateReception)

  const finDefendable = intervention ? addDays(intervention.fin, prolongationJours) : null

  let tempsEcoulePct: number | null = null
  if (intervention && finDefendable) {
    const duree = Math.max(1, diffDays(intervention.debut, finDefendable) + 1)
    const ecoules = diffDays(intervention.debut, today) + 1
    tempsEcoulePct = Math.round(clamp((ecoules / duree) * 100, 0, 100) * 10) / 10
  }

  const ecartPoints =
    avancementPct !== null && tempsEcoulePct !== null
      ? Math.round((avancementPct - tempsEcoulePct) * 10) / 10
      : null

  const enRetard = Boolean(
    m.actif && finDefendable && finDefendable < today && !receptionne,
  )
  const joursDeRetard = enRetard && finDefendable ? diffDays(finDefendable, today) : 0

  // un décrochage ne se constate que sur un lot COMMENCÉ et non réceptionné :
  // avant le début, l'avancement est nul et le temps écoulé aussi ; après la
  // réception, la question ne se pose plus
  const commence = Boolean(intervention && today >= intervention.debut)
  const decroche = Boolean(
    m.actif &&
      commence &&
      !receptionne &&
      ecartPoints !== null &&
      ecartPoints <= -SEUIL_DECROCHAGE_POINTS,
  )

  const raisons: string[] = []
  if (!intervention) raisons.push('Lot non daté — aucune intervention au planning.')
  if (enRetard) {
    raisons.push(
      `Fin dépassée de ${joursDeRetard} j (${fmtDate(finDefendable)}) sans réception prononcée.`,
    )
  }
  if (decroche && ecartPoints !== null && avancementPct !== null && tempsEcoulePct !== null) {
    raisons.push(
      `Avancement ${avancementPct} % pour ${tempsEcoulePct} % du délai écoulé — ${Math.abs(ecartPoints)} points de retard.`,
    )
  }
  if (prolongationJours > 0) {
    raisons.push(
      `${prolongationJours} j d'intempéries reconnues : fin défendable reportée au ${fmtDate(finDefendable)}.`,
    )
  }
  if (avancementPct === null && intervention && m.actif && !receptionne) {
    raisons.push('Avancement jamais constaté — aucune tâche de chantier rattachée à ce lot.')
  }
  if (receptionne) raisons.push(`Réception prononcée le ${fmtDate(m.dateReception)}.`)

  const gravite: 0 | 1 | 2 = enRetard ? 2 : decroche ? 1 : 0
  return {
    intervention,
    prolongationJours,
    finDefendable,
    tempsEcoulePct,
    avancementPct,
    ecartPoints,
    enRetard,
    joursDeRetard,
    decroche,
    receptionne,
    gravite,
    raisons,
  }
}

// ------------------------------------------------------------
// 7. LES CHEVAUCHEMENTS QUI NE PEUVENT PAS COEXISTER
// ------------------------------------------------------------
//
// Deux lots qui se chevauchent sur un chantier, c'est la règle et non
// l'exception — c'est même à cela que sert un Gantt. Ce qui ne peut PAS
// coexister, et que la donnée sait prouver, c'est la MÊME ENTREPRISE
// attendue à deux endroits en même temps. Une entreprise ne se dédouble pas.
//
// Personne ne le voit aujourd'hui, et pour une raison mécanique : les deux
// lots sont sur deux chantiers différents, donc dans deux onglets différents,
// et le planning n'a jamais été regardé par entreprise. C'est exactement le
// « planning des entreprises » que l'agence réclame — et la promesse de
// livraison qu'on donne à la MOA en réunion tient à cela.
//
// On ne DEVINE aucune autre incompatibilité : décréter que la couverture ne
// peut pas chevaucher le gros œuvre demanderait un ordre des corps d'état
// que la base ne porte pas, et une règle inventée produirait des faux
// positifs jusqu'à ce que plus personne ne regarde les vrais.

export interface Chevauchement {
  /** identifiants des deux marchés, `a` étant celui qui commence en premier */
  aId: string
  bId: string
  /** l'entreprise attendue des deux côtés — c'est elle, le conflit */
  entreprise: string
  /** période commune, bornes incluses */
  debut: string
  fin: string
  jours: number
  /** vrai quand les deux lots sont sur le MÊME chantier : c'est alors le cas
   *  bénin (une entreprise peut enchaîner deux lots voisins chez elle) ;
   *  faux = deux chantiers à la fois, le conflit dur */
  memeChantier: boolean
}

/** période commune à deux interventions, bornes incluses — `null` si elles
 *  ne se touchent pas. Se toucher d'un seul jour EST un chevauchement : ce
 *  jour-là, l'entreprise doit être aux deux endroits. */
export function periodeCommune(a: Intervention, b: Intervention): Intervention | null {
  const debut = a.debut > b.debut ? a.debut : b.debut
  const fin = a.fin < b.fin ? a.fin : b.fin
  return debut <= fin ? { debut, fin } : null
}

/** clé de rapprochement d'une entreprise : l'identifiant canonique du
 *  registre quand il existe, le nom normalisé sinon. Deux marchés qui
 *  écrivent « SARL Dupont » et « sarl dupont  » désignent la même entreprise
 *  et doivent entrer en conflit ; sans normalisation, le conflit le plus
 *  fréquent — celui d'une entreprise saisie deux fois à la main — passerait
 *  inaperçu. */
function cleEntreprise(m: MarcheTravaux): string {
  if (m.entrepriseId) return `id:${m.entrepriseId}`
  const nom = (m.entreprise || '').trim().toLowerCase()
  return nom ? `nom:${nom}` : ''
}

/** tous les conflits « même entreprise, deux interventions à la fois », sur
 *  l'ensemble des marchés fournis.
 *
 *  Ne regarde que les marchés ACTIFS et non réceptionnés : un lot soldé ne
 *  mobilise plus personne, et le signaler serait du bruit permanent sur
 *  l'historique. */
export function chevauchementsEntreprise(marches: MarcheTravaux[]): Chevauchement[] {
  const liste = (Array.isArray(marches) ? marches : []).filter(
    (m) => m && m.actif && !m.dateReception && interventionDe(m) !== null && cleEntreprise(m) !== '',
  )
  const conflits: Chevauchement[] = []
  for (let i = 0; i < liste.length; i++) {
    for (let j = i + 1; j < liste.length; j++) {
      const a = liste[i]
      const b = liste[j]
      if (cleEntreprise(a) !== cleEntreprise(b)) continue
      const commune = periodeCommune(interventionDe(a)!, interventionDe(b)!)
      if (!commune) continue
      const premier = interventionDe(a)!.debut <= interventionDe(b)!.debut ? a : b
      const second = premier === a ? b : a
      conflits.push({
        aId: premier.id,
        bId: second.id,
        entreprise: premier.entreprise,
        debut: commune.debut,
        fin: commune.fin,
        jours: dureeJours(commune),
        memeChantier: a.projetId === b.projetId,
      })
    }
  }
  return conflits.sort((x, y) => x.debut.localeCompare(y.debut) || x.entreprise.localeCompare(y.entreprise))
}

/** les identifiants de marchés engagés dans au moins un conflit — l'écran
 *  s'en sert pour marquer les barres concernées sans reparcourir la liste */
export function marchesEnConflit(conflits: Chevauchement[]): Set<string> {
  const s = new Set<string>()
  for (const c of conflits) {
    s.add(c.aId)
    s.add(c.bId)
  }
  return s
}

// ------------------------------------------------------------
// 8. LES JALONS
// ------------------------------------------------------------

/** ce qui structure un chantier dans le temps, et qui n'est pas une durée */
export type GenreJalon = 'reunion' | 'debut' | 'fin' | 'fin_defendable' | 'reception'

export interface Jalon {
  /** identifiant stable pour la clé de rendu React */
  id: string
  date: string
  genre: GenreJalon
  libelle: string
  projetId: string
  /** marché concerné — absent pour une réunion de chantier, qui porte sur
   *  tout le chantier et non sur un lot */
  marcheId: string | null
  /** position en % de la fenêtre — calculée ici pour que l'écran ne fasse
   *  aucune géométrie */
  gauche: number
  /** dans la fenêtre visible ? un jalon hors fenêtre reste dans la liste
   *  (l'écran peut vouloir dire « prochaine réunion le … ») mais ne se
   *  dessine pas */
  visible: boolean
}

/** les jalons d'un chantier sur la fenêtre : réunions de chantier
 *  (`state.reunions` — elles ont une date) et échéances des marchés.
 *
 *  Les réunions PASSÉES sont conservées : en conduite de chantier, la
 *  question « qu'a-t-on dit à la réunion d'avant » se pose autant que la
 *  suivante, et un jalon qui disparaît le jour même se cherche ensuite dans
 *  un autre écran. */
export function jalonsChantier(
  f: FenetrePlanning,
  projetId: string,
  marches: MarcheTravaux[],
  reunions: ReunionChantier[],
  intemperies: Intemperie[],
): Jalon[] {
  const jalons: Jalon[] = []
  const poser = (
    id: string,
    date: string | null | undefined,
    genre: GenreJalon,
    libelle: string,
    marcheId: string | null,
  ) => {
    if (!date) return
    jalons.push({
      id,
      date,
      genre,
      libelle,
      projetId,
      marcheId,
      gauche: pourcent(f, date),
      visible: date >= f.debut && date < f.fin,
    })
  }

  for (const r of Array.isArray(reunions) ? reunions : []) {
    if (!r || r.projetId !== projetId) continue
    poser(
      `reunion-${r.id}`,
      r.date,
      'reunion',
      `${r.titre || 'Réunion de chantier'}${r.heure ? ` · ${r.heure}` : ''}`,
      null,
    )
  }

  for (const m of Array.isArray(marches) ? marches : []) {
    if (!m || m.projetId !== projetId) continue
    const i = interventionDe(m)
    if (!i) continue
    poser(`fin-${m.id}`, m.dateFin || null, 'fin', `Fin contractuelle — ${m.lot}`, m.id)
    poser(`reception-${m.id}`, m.dateReception || null, 'reception', `Réception — ${m.lot}`, m.id)
    const prolongation = prolongationDelai(m, intemperies)
    if (prolongation > 0 && m.dateFin) {
      poser(
        `finprol-${m.id}`,
        addDays(m.dateFin, prolongation),
        'fin_defendable',
        `Fin + ${prolongation} j d'intempéries — ${m.lot}`,
        m.id,
      )
    }
  }

  return jalons.sort((a, b) => a.date.localeCompare(b.date))
}

// ------------------------------------------------------------
// 9. CADRER LA FENÊTRE SUR CE QU'IL Y A À VOIR
// ------------------------------------------------------------

/** la fenêtre qui contient toutes les interventions fournies, à l'échelle
 *  demandée, plus une marge d'un pas de chaque côté (une barre collée au
 *  bord se lit mal, et on ne voit pas ce qui la précède).
 *
 *  `null` quand rien n'est daté : l'écran garde alors sa fenêtre courante
 *  plutôt que de sauter à une date arbitraire. */
export function fenetreSurLots(
  marches: MarcheTravaux[],
  echelle: Echelle,
): FenetrePlanning | null {
  const interventions = (Array.isArray(marches) ? marches : [])
    .map((m) => interventionDe(m))
    .filter((i): i is Intervention => i !== null)
  if (interventions.length === 0) return null

  const premier = interventions.reduce((a, i) => (i.debut < a ? i.debut : a), interventions[0].debut)
  const dernier = interventions.reduce((a, i) => (i.fin > a ? i.fin : a), interventions[0].fin)

  if (echelle === 'semaine') {
    const debut = addDays(mondayOf(premier), -7)
    const semaines = Math.ceil((diffDays(debut, dernier) + 1) / 7) + 1
    return fenetrePlanning(debut, 'semaine', semaines)
  }
  const debut = ajouterMois(debutMoisDe(premier), -1)
  const finMois = ajouterMois(debutMoisDe(dernier), 1)
  const mois = Math.max(1, Math.round(diffDays(debut, finMois) / 30.4)) + 1
  return fenetrePlanning(debut, 'mois', mois)
}

/** l'échelle de lecture d'un chantier : au-delà d'un trimestre, la semaine
 *  produit trop de colonnes pour tenir sur un écran ; en deçà, le mois est
 *  trop grossier pour conduire quoi que ce soit. Sert de valeur de départ —
 *  le choix humain l'emporte ensuite et n'est jamais réécrit. */
export function echelleSuggeree(marches: MarcheTravaux[]): Echelle {
  const f = fenetreSurLots(marches, 'semaine')
  if (!f) return 'mois'
  return f.jours <= 130 ? 'semaine' : 'mois'
}

/** libellé de la fenêtre, pour l'en-tête et le pied de page d'impression —
 *  écrit ici pour que l'écran et le papier disent exactement la même chose */
export function libelleFenetre(f: FenetrePlanning): string {
  return `${fmtDate(f.debut)} → ${fmtDate(addDays(f.fin, -1))}`
}

/** projets ayant au moins un lot daté, dans l'ordre d'entrée en chantier —
 *  le groupement par chantier est CONSERVÉ (l'agence l'a demandé), mais
 *  l'ordre suit le calendrier plutôt que l'ordre de création */
export function chantiersDuPlanning(projets: Projet[], marches: MarcheTravaux[]): Projet[] {
  const premierJour = new Map<string, string>()
  for (const m of Array.isArray(marches) ? marches : []) {
    const i = interventionDe(m)
    if (!i) continue
    const actuel = premierJour.get(m.projetId)
    if (!actuel || i.debut < actuel) premierJour.set(m.projetId, i.debut)
  }
  return (Array.isArray(projets) ? projets : [])
    .filter((p) => premierJour.has(p.id))
    .sort((a, b) => (premierJour.get(a.id) || '').localeCompare(premierJour.get(b.id) || ''))
}
