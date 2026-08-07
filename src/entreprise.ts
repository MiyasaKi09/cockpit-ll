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
// CE MODULE reste une LECTURE — c'est la règle qui n'a pas bougé. Ce qui a
// bougé (5.21), c'est l'écran : `src/modules/FicheEntreprise.tsx` PORTE
// désormais des gestes, parce que l'agence a demandé de « gérer », pas de
// contempler. La distinction tient en une phrase :
//   · un CALCUL n'a qu'une autorité — ici, ou dans derive/penalites/visas/gpa
//     qu'on appelle. Rien ne se recalcule à l'écran ;
//   · un GESTE (relancer, lever une RG, viser, décider) peut se déclencher
//     depuis plusieurs écrans sans créer de seconde vérité, tant qu'il écrit
//     le même champ à partir du même calcul.
// Le seul « geste » préparé ici est le TEXTE du brouillon de relance — via
// gmailComposeUrl côté écran, jamais un envoi (§15).
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
import { visasEnAttente, visasEnRetard } from './visas'
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

// ------------------------------------------------------------
// 5.21 — LA LISTE : l'entreprise a enfin une adresse
// ------------------------------------------------------------
//
// `syntheseEntreprise` savait déjà tout d'UNE entreprise, mais il fallait
// déjà être dans un projet pour l'ouvrir : l'agence n'avait aucun endroit
// où poser la question « qui me doit quoi, aujourd'hui, tous chantiers
// confondus ? ». Ce sélecteur est cet endroit — et il n'ajoute AUCUN
// calcul : il APPELLE `syntheseEntreprise` par entreprise et se contente de
// compter ce qu'elle rend. Un compteur qui relirait les collections lui-même
// (« les visas à viser de ses marchés ») serait une seconde définition de
// chaque notion, libre de diverger de la fiche qu'elle prétend résumer.
//
// Le seul motif lu ailleurs qu'à travers la synthèse est le RETARD d'un
// visa — `visasEnRetard` (src/visas.ts, 5.8), appliqué à la liste que la
// synthèse a déjà filtrée. C'est l'autorité, pas une comparaison de dates
// réécrite ici.

/** ce qui CRIE aujourd'hui chez une entreprise — des COMPTES, pris sur la
 *  synthèse, jamais recalculés depuis les collections */
export interface UrgencesEntreprise {
  /** marchés actifs dont la situation du mois manque (critère partagé) */
  situationsAttendues: number
  /** la pire gravité de ces attentes — 0 quand il n'y en a aucune */
  graviteSituation: 0 | 2 | 3
  /** marchés portant une exposition de pénalité qu'aucune décision n'a figée */
  penalitesADecider: number
  /** … et le montant HT correspondant : encouru total − déjà appliqué */
  penalitesADeciderHT: number
  /** documents d'exécution encore à viser */
  visasEnAttente: number
  /** … dont l'échéance du CCAP est DÉPASSÉE : c'est NOTRE retard, pas le sien */
  visasEnRetard: number
  /** désordres GPA ouverts à la charge de ce titulaire */
  desordresGPA: number
  /** retenue de garantie dont la GPA est échue : de l'argent à rendre */
  rgALibererHT: number
  /** nombre de MOTIFS distincts qui crient — ce que la ligne affiche en tête */
  motifs: number
}

/** un lot du portefeuille de l'entreprise, avec son chantier — « ses lots et
 *  sur quels chantiers » tient dans une ligne */
export interface LotEntreprise {
  marcheId: string
  lot: string
  projetId: string
  /** null si le projet a disparu — la ligne se montre quand même */
  projetNom: string | null
  actif: boolean
}

export interface LigneEntreprise {
  /** ADRESSE de la fiche : l'id du registre quand il existe, sinon le nom
   *  plié. C'est la clé que `#/entreprises/<id>` transporte, et elle se
   *  redonne telle quelle à `syntheseEntreprise` — `fold` est idempotent,
   *  un nom plié re-plié reste le même nom. */
  cle: string
  nom: string
  entreprise: Entreprise | null
  /** la synthèse COMPLÈTE — l'écran de liste n'a rien à recalculer, et la
   *  fiche qu'on ouvre ensuite dira exactement la même chose */
  synthese: SyntheseEntreprise
  lots: LotEntreprise[]
  /** nombre de chantiers distincts où elle intervient */
  nbProjets: number
  /** Σ montants de marché HT, avenants inclus (recopié de la synthèse) */
  montantMarchesHT: number
  urgences: UrgencesEntreprise
  /** score de tri décroissant — voir POIDS_MOTIF */
  poids: number
}

/** Le tri met en tête CE QUI DEMANDE UNE ACTION. L'ordre des poids est un
 *  choix de conduite, écrit ici pour qu'il se discute :
 *
 *   · un visa en retard passe devant tout : le délai du CCAP est dépassé,
 *     c'est la responsabilité de la MOE qui court — notre retard, pas le sien ;
 *   · une situation attendue passé le 20 décale la vérification ET le
 *     paiement : elle vaut plus qu'une situation attendue depuis le 10 ;
 *   · une RG échue est de l'argent de l'entreprise qu'on garde sans droit ;
 *   · une pénalité encourue non décidée est une décision qu'on n'a pas prise
 *     — ni appliquée, ni renoncée ;
 *   · un désordre GPA ouvert et un visa encore dans les délais ferment la
 *     marche : ils ont du temps devant eux.
 *
 *  Le montant de marché n'entre PAS dans ce score : il départage seulement
 *  deux entreprises qui crient pareil. Trier par l'argent mettrait le gros
 *  lot silencieux devant le petit lot qui bloque le chantier. */
export const POIDS_MOTIF = {
  visaEnRetard: 100,
  situationUrgente: 80,
  rgALiberer: 70,
  penaliteADecider: 50,
  situationAttendue: 40,
  desordreGPA: 30,
  visaEnAttente: 20,
} as const

/** les entreprises que l'agence SUIT réellement : celles qui portent un
 *  marché (même saisi avant l'amorce du registre, donc rattaché par le nom)
 *  PLUS celles du registre — une entreprise consultée sans marché encore
 *  signé a sa place dans la liste, avec une ligne vide qui le dit.
 *
 *  Dédoublonnage par la clé canonique : un marché portant `entrepriseId` et
 *  un marché ne portant que le nom tombent sur la MÊME ligne dès que
 *  `entrepriseDe` les rapproche — sinon la liste montrerait deux fois
 *  HORIZONS BTP, ce que la fiche, elle, ne fait pas.
 *
 *  Logique PURE : `today` est un argument. */
export function entreprisesSuivies(state: AppState, today: string): LigneEntreprise[] {
  const cles: string[] = []
  const vues = new Set<string>()
  const retenir = (cle: string) => {
    if (!cle || vues.has(cle)) return
    vues.add(cle)
    cles.push(cle)
  }

  // les porteuses de marché d'abord — ce sont elles qui font le suivi
  for (const m of Array.isArray(state.marches) ? state.marches : []) {
    if (!m) continue
    const brut = m.entrepriseId || m.entreprise || ''
    if (!brut) continue
    const ent = entrepriseDe(state, brut)
    retenir(ent ? ent.id : fold(m.entreprise || ''))
  }
  // puis le registre : une entreprise sans marché existe quand même
  for (const e of Array.isArray(state.entreprises) ? state.entreprises : []) {
    if (e && e.id) retenir(e.id)
  }

  const lignes = cles.map((cle) => {
    const synthese = syntheseEntreprise(state, cle, today)

    const lots: LotEntreprise[] = synthese.marches.map((l) => ({
      marcheId: l.marche.id,
      lot: l.marche.lot,
      projetId: l.marche.projetId,
      projetNom: l.projet?.nom ?? null,
      actif: l.marche.actif,
    }))

    // gravité : la PIRE des attentes — une entreprise qui doit deux
    // situations dont une depuis le 20 se traite comme la plus urgente
    let graviteSituation: 0 | 2 | 3 = 0
    let situationsUrgentes = 0
    for (const a of synthese.situationsAttendues) {
      if (a.gravite > graviteSituation) graviteSituation = a.gravite
      if (a.gravite === 3) situationsUrgentes += 1
    }

    // « à décider » = l'exposition qu'aucune décision humaine n'a figée :
    // l'encouru TOTAL moins ce qui est déjà appliqué (les deux chiffres
    // viennent de src/penalites.ts via la synthèse — rien n'est refait)
    let penalitesADecider = 0
    let penalitesADeciderHT = 0
    for (const p of synthese.penalitesEncourues) {
      const reste = p.encouruHT - p.appliqueHT
      if (reste > 0) {
        penalitesADecider += 1
        penalitesADeciderHT += reste
      }
    }

    // le RETARD passe par l'autorité 5.8, appliquée à la liste que la
    // synthèse a déjà restreinte aux marchés de CETTE entreprise
    const enRetard = visasEnRetard(synthese.visasEnAttente, today).length

    const urgences: UrgencesEntreprise = {
      situationsAttendues: synthese.situationsAttendues.length,
      graviteSituation,
      penalitesADecider,
      penalitesADeciderHT: arrondiCentimes(penalitesADeciderHT),
      visasEnAttente: synthese.visasEnAttente.length,
      visasEnRetard: enRetard,
      desordresGPA: synthese.desordresGPAOuverts.length,
      rgALibererHT: synthese.totaux.aLibererHT,
      motifs: 0,
    }
    urgences.motifs =
      (urgences.situationsAttendues > 0 ? 1 : 0) +
      (urgences.penalitesADecider > 0 ? 1 : 0) +
      (urgences.visasEnAttente > 0 ? 1 : 0) +
      (urgences.desordresGPA > 0 ? 1 : 0) +
      (urgences.rgALibererHT > 0 ? 1 : 0)

    const poids =
      enRetard * POIDS_MOTIF.visaEnRetard +
      situationsUrgentes * POIDS_MOTIF.situationUrgente +
      (urgences.situationsAttendues - situationsUrgentes) * POIDS_MOTIF.situationAttendue +
      (urgences.rgALibererHT > 0 ? POIDS_MOTIF.rgALiberer : 0) +
      penalitesADecider * POIDS_MOTIF.penaliteADecider +
      urgences.desordresGPA * POIDS_MOTIF.desordreGPA +
      (urgences.visasEnAttente - enRetard) * POIDS_MOTIF.visaEnAttente

    return {
      cle,
      nom: synthese.nom,
      entreprise: synthese.entreprise,
      synthese,
      lots,
      nbProjets: new Set(lots.map((l) => l.projetId)).size,
      montantMarchesHT: synthese.totaux.montantMarchesHT,
      urgences,
      poids,
    }
  })

  // ce qui crie d'abord ; à égalité de cri, le plus gros engagement ; puis
  // le nom, pour que deux lignes muettes ne dansent pas d'un rendu à l'autre
  return lignes.sort(
    (a, b) =>
      b.poids - a.poids ||
      b.montantMarchesHT - a.montantMarchesHT ||
      a.nom.localeCompare(b.nom, 'fr'),
  )
}
