// 5.20 — la fiche entreprise TRANSVERSE (complément du 04/08/2026 au Lot 5).
//
// « Où en est-on avec HORIZONS ? » demandait six écrans : les marchés dans
// la fiche projet, les situations et la RG dans Situations, les pénalités,
// visas et désordres GPA dans les blocs du chantier, le certificat dans
// l'historique. Ce module RASSEMBLE ces lectures par entreprise — il
// n'invente AUCUN calcul : chaque chiffre vient de la fonction qui fait déjà
// autorité (retenueGarantieMarche, totalEncouruMarche, desordresOuverts,
// visasEnAttente…). Un agrégat qui recalculerait ferait deux vérités pour le
// même marché — exactement la complexification que l'agence refuse.
//
// La fiche est une LECTURE : rien ici ne produit d'écriture, et l'écran qui
// la montre (src/modules/FicheEntreprise.tsx) renvoie vers les écrans où
// l'on AGIT. Le seul « geste » préparé ici est le TEXTE du brouillon de
// relance — via gmailComposeUrl côté écran, jamais un envoi (§15).
//
// Rapprochement : entrepriseId d'abord (le registre canonique amorcé par le
// store), le NOM en repli — plié par `fold`, casse et espaces tolérés, la
// même règle que le registre : « sarl  martin btp » et « SARL Martin BTP »
// sont la même entreprise, pas deux fiches.
//
// Logique PURE : aucun store, aucune horloge — `today` est un argument.

import type {
  AppState,
  CertificatPaiement,
  DesordreGPA,
  Entreprise,
  MarcheTravaux,
  Projet,
  Situation,
  Visa,
} from './types'
import { projetById, retenueGarantieMarche, type RGMarche } from './derive'
import { prolongationDelai, totalAppliqueMarche, totalEncouruMarche } from './penalites'
import { visasEnAttente } from './visas'
import { desordresOuverts } from './gpa'
import { fmtMois, fold, monthKey } from './util'

const arrondiCentimes = (x: number) => Math.round(x * 100) / 100

// ------------------------------------------------------------
// Rapprochement — id d'abord, nom plié en repli
// ------------------------------------------------------------

/** l'entreprise canonique du registre, par id ou par nom (plié) — null si
 *  le registre ne la connaît pas (la fiche marche quand même : par nom) */
export function entrepriseDe(state: AppState, nomOuId: string): Entreprise | null {
  const entreprises = Array.isArray(state.entreprises) ? state.entreprises : []
  const parId = entreprises.find((e) => e && e.id === nomOuId)
  if (parId) return parId
  const cle = fold(nomOuId)
  if (!cle) return null
  return (
    entreprises.find(
      (e) => e && (fold(e.raisonSociale) === cle || (e.nomCommercial && fold(e.nomCommercial) === cle)),
    ) || null
  )
}

/** les marchés de l'entreprise, TOUS projets : entrepriseId d'abord, nom en
 *  repli — même double lecture que la cascade de rattachement (A.4), sinon
 *  un marché saisi avant l'amorce du registre disparaîtrait de la fiche */
export function marchesDe(state: AppState, nomOuId: string): MarcheTravaux[] {
  const ent = entrepriseDe(state, nomOuId)
  const cles = new Set<string>()
  const brute = fold(nomOuId)
  if (brute) cles.add(brute)
  if (ent) {
    cles.add(fold(ent.raisonSociale))
    if (ent.nomCommercial) cles.add(fold(ent.nomCommercial))
  }
  return (Array.isArray(state.marches) ? state.marches : []).filter(
    (m) => m && ((ent && m.entrepriseId === ent.id) || cles.has(fold(m.entreprise))),
  )
}

// ------------------------------------------------------------
// LE critère « situation du mois » — un seul, partagé
// ------------------------------------------------------------

/** la situation d'un marché pour un mois donné : par marcheId, sinon par
 *  (projet + entreprise pliée). Vivait dans l'écran Situations ; le critère
 *  remonte ICI parce que trois consommateurs le lisent désormais — l'onglet
 *  « Attendues », le producteur d'alertes et la fiche entreprise — et que
 *  deux définitions divergeraient sans bruit (une situation reçue sans
 *  marcheId ferait crier l'alerte pendant que l'écran la montre reçue). */
export function situationDuMois(
  state: AppState,
  m: MarcheTravaux,
  mois: string,
): Situation | undefined {
  return (Array.isArray(state.situations) ? state.situations : []).find(
    (s) =>
      s &&
      s.mois === mois &&
      (s.marcheId === m.id || (s.projetId === m.projetId && fold(s.entreprise) === fold(m.entreprise))),
  )
}

/** avant ce jour du mois, une situation qui manque n'est pas un retard :
 *  l'entreprise facture à terme échu, elle a le début du mois pour l'envoyer */
export const JOUR_ATTENTE_SITUATION = 10
/** passé ce jour, la relance devient urgente : la vérification (délai
 *  contractuel) puis le paiement se décalent d'autant */
export const JOUR_RELANCE_SITUATION = 20

export interface AttenteSituation {
  /** mois attendu ('AAAA-MM') — le mois courant : les entreprises situent
   *  chaque mois de chantier, la relance porte sur le mois en cours */
  mois: string
  gravite: 2 | 3
}

/** LE critère « situation attendue non reçue » — extrait du producteur
 *  d'alertes (qui le consomme désormais ici) pour que la fiche entreprise
 *  et le fil d'urgences disent la MÊME chose le même jour. Null tant que
 *  rien n'est attendu : marché inactif, ou mois trop jeune (< le 10). */
export function situationAttendueNonRecue(
  state: AppState,
  m: MarcheTravaux,
  today: string,
): AttenteSituation | null {
  if (!m || !m.actif) return null
  const jourDuMois = Number(today.slice(8, 10))
  if (!Number.isFinite(jourDuMois) || jourDuMois < JOUR_ATTENTE_SITUATION) return null
  const mois = monthKey(today)
  if (situationDuMois(state, m, mois)) return null
  return { mois, gravite: jourDuMois >= JOUR_RELANCE_SITUATION ? 3 : 2 }
}

// ------------------------------------------------------------
// Relance — le TEXTE du brouillon est défini ICI, une fois : l'onglet
// « Attendues » et la fiche entreprise ouvrent le même brouillon (via
// ouvrirGmail → gmailComposeUrl, seul constructeur d'envoi autorisé, §15) ;
// deux rédactions divergeraient sans que rien ne le signale — le même
// verrou que la relance des notes d'honoraires (src/cotraitants.ts).
// ------------------------------------------------------------

export function sujetRelanceSituation(m: Pick<MarcheTravaux, 'lot'>, mois: string): string {
  return `Situation de travaux ${fmtMois(mois)} — ${m.lot}`
}

export function corpsRelanceSituation(
  m: Pick<MarcheTravaux, 'lot'>,
  mois: string,
  nomAgence: string,
): string {
  return (
    `Bonjour,\n\nSauf erreur de notre part, nous n'avons pas reçu votre situation de travaux du mois de ${fmtMois(mois)} (${m.lot}) sur l'adresse dédiée situations@agence-ll.fr, prévue contractuellement chaque mois.\n\n` +
    `Merci de nous la transmettre sous 5 jours ouvrés — le retard de transmission décale d'autant la vérification et le paiement.\n\nCordialement,\n${nomAgence}`
  )
}

// ------------------------------------------------------------
// La synthèse — l'agrégat en lecture de la fiche
// ------------------------------------------------------------

export interface LigneMarcheFiche {
  marche: MarcheTravaux
  /** undefined si le projet a été supprimé — la ligne se montre quand même :
   *  la RG d'un marché orphelin reste de l'argent de l'entreprise */
  projet: Projet | undefined
  /** cycle de vie de la retenue de garantie — l'autorité de derive.ts (5.1) */
  rg: RGMarche
  /** dernier certificat de paiement ÉMIS (5.19) — null si rien n'est émis */
  dernierCertificat: CertificatPaiement | null
  /** marché actif : la situation du mois courant est-elle arrivée ?
   *  null pour un marché inactif — rien n'est attendu, « non » serait faux */
  situationDuMoisRecue: boolean | null
}

export interface PenalitesMarche {
  marche: MarcheTravaux
  /** exposition contractuelle complète (encouru + appliqué figé) — le total
   *  de src/penalites.ts, intempéries déduites comme à l'écran chantier */
  encouruHT: number
  /** uniquement les montants figés par une décision humaine */
  appliqueHT: number
}

export interface SyntheseEntreprise {
  /** la fiche canonique du registre — null si l'entreprise n'y est pas */
  entreprise: Entreprise | null
  /** nom d'affichage : registre d'abord, sinon le nom des marchés */
  nom: string
  contactNom: string | null
  /** e-mail de contact : registre d'abord, sinon le premier marché qui en
   *  porte un — c'est l'adresse des brouillons de la fiche */
  contactEmail: string | null
  marches: LigneMarcheFiche[]
  totaux: {
    /** Σ montants de marché HT, avenants inclus, tous projets */
    montantMarchesHT: number
    /** argent RÉELLEMENT retenu et pas encore libéré (0 dès qu'une caution
     *  ou une GPD couvre — l'autorité 5.1, jamais relue ici) */
    rgRetenueHT: number
    /** part de la RG dont la GPA est échue : à rendre à l'entreprise */
    aLibererHT: number
  }
  penalitesEncourues: PenalitesMarche[]
  /** désordres GPA encore à la charge de CE titulaire (marché identifié) */
  desordresGPAOuverts: DesordreGPA[]
  /** documents d'exécution de ses marchés encore à viser */
  visasEnAttente: Visa[]
  /** marchés actifs dont la situation du mois manque — même critère que le
   *  fil d'urgences, avec le brouillon de relance à un clic */
  situationsAttendues: { marche: MarcheTravaux; mois: string; gravite: 2 | 3 }[]
}

/** dernier certificat émis d'un marché : mois le plus récent, puis numéro —
 *  simple sélection dans la collection figée, aucun recalcul (un certificat
 *  émis ne se recalcule jamais, 5.19) */
function dernierCertificatDe(state: AppState, marcheId: string): CertificatPaiement | null {
  let dernier: CertificatPaiement | null = null
  for (const c of Array.isArray(state.certificats) ? state.certificats : []) {
    if (!c || c.marcheId !== marcheId) continue
    if (!dernier || c.mois > dernier.mois || (c.mois === dernier.mois && c.numero > dernier.numero)) {
      dernier = c
    }
  }
  return dernier
}

/** TOUT ce que l'agence sait d'une entreprise, en une lecture — l'agrégat
 *  de la fiche. Chaque champ RÉUTILISE la fonction qui fait déjà autorité ;
 *  ce module n'ajoute que le rapprochement et l'addition. */
export function syntheseEntreprise(
  state: AppState,
  nomOuId: string,
  today: string,
): SyntheseEntreprise {
  const entreprise = entrepriseDe(state, nomOuId)
  const marches = [...marchesDe(state, nomOuId)].sort(
    (a, b) =>
      Number(b.actif) - Number(a.actif) ||
      a.projetId.localeCompare(b.projetId) ||
      a.lot.localeCompare(b.lot),
  )
  const ids = new Set(marches.map((m) => m.id))
  const moisCourant = monthKey(today)

  const lignes: LigneMarcheFiche[] = marches.map((m) => ({
    marche: m,
    projet: projetById(state, m.projetId),
    // la RG passe par l'autorité 5.1 (garantie relue DANS retenueGarantieMarche)
    rg: retenueGarantieMarche(state, m, today),
    dernierCertificat: dernierCertificatDe(state, m.id),
    situationDuMoisRecue: m.actif ? Boolean(situationDuMois(state, m, moisCourant)) : null,
  }))

  let montantMarchesHT = 0
  let rgRetenueHT = 0
  let aLibererHT = 0
  for (const l of lignes) {
    montantMarchesHT += l.marche.montantInitialHT + l.marche.avenantsHT
    // « libérée » : l'argent est rendu, il ne se compte plus nulle part ;
    // retenueHT vaut déjà 0 quand une caution/GPD couvre (autorité 5.1)
    if (l.rg.statut !== 'liberee') rgRetenueHT += l.rg.retenueHT
    if (l.rg.statut === 'a_liberer') aLibererHT += l.rg.retenueHT
  }

  const penalitesEncourues: PenalitesMarche[] = []
  for (const m of marches) {
    // même déduction d'intempéries que l'écran chantier : la fenêtre du
    // marché, via prolongationDelai — une seule source (5.2/5.3)
    const deduction = prolongationDelai(m, state.intemperies)
    const encouruHT = totalEncouruMarche(state.evenementsMarche, m.id, m.penalites, deduction)
    const appliqueHT = totalAppliqueMarche(state.evenementsMarche, m.id)
    if (encouruHT > 0 || appliqueHT > 0) penalitesEncourues.push({ marche: m, encouruHT, appliqueHT })
  }

  // seuls les désordres au marché identifié s'attribuent : un désordre sans
  // marcheId n'a pas encore de titulaire — l'afficher sur la mauvaise fiche
  // serait pire que ne pas l'afficher
  const desordres = desordresOuverts(state.desordresGPA)
    .filter((d) => d.marcheId && ids.has(d.marcheId))
    .sort((a, b) => a.signaleLe.localeCompare(b.signaleLe))

  const visas = visasEnAttente(state.visas)
    .filter((v) => v.marcheId && ids.has(v.marcheId))
    .sort((a, b) => a.recuLe.localeCompare(b.recuLe))

  const situationsAttendues: SyntheseEntreprise['situationsAttendues'] = []
  for (const m of marches) {
    const attente = situationAttendueNonRecue(state, m, today)
    if (attente) situationsAttendues.push({ marche: m, ...attente })
  }

  const porteur = marches.find((m) => m.contactEmail)
  return {
    entreprise,
    nom: entreprise?.raisonSociale || marches[0]?.entreprise || nomOuId,
    contactNom: entreprise?.contactNom || porteur?.contactNom || null,
    contactEmail: entreprise?.contactEmail || porteur?.contactEmail || null,
    marches: lignes,
    totaux: {
      montantMarchesHT: arrondiCentimes(montantMarchesHT),
      rgRetenueHT: arrondiCentimes(rgRetenueHT),
      aLibererHT: arrondiCentimes(aLibererHT),
    },
    penalitesEncourues,
    desordresGPAOuverts: desordres,
    visasEnAttente: visas,
    situationsAttendues,
  }
}
