// 5.19 — le certificat de paiement mensuel (état d'acompte) : le document
// que la MOE émet vers le maître d'ouvrage depuis une situation validée.
//
// Tout existait déjà — cumul/antérieur (decompteSituation, 5.1), révision
// théorique (5.4/5.18), pénalités appliquées (5.2), garantie du marché
// (5.1) — il manquait l'ASSEMBLEUR. Ce module assemble, et il ne fait que
// PROPOSER : le document réel de l'agence (état n° 4, MAM de Chamant) prouve
// qu'aucune règle générale ne suffit — sur cet état, la GPD couvre le marché
// de BASE mais la retenue de garantie s'applique à l'AVENANT, à 5 % de son
// montant TTC (2 407,30 × 1,20 × 5 % = 144,44). C'est une lecture
// contractuelle, pas un calcul. D'où `surcharges` : chaque ligne calculée
// est corrigeable, et le PDF imprime la valeur RETENUE (§15 — la machine
// propose, l'humain décide).
//
// Un certificat ÉMIS est FIGÉ (src/types.ts, CertificatPaiement) : le
// recalculer plus tard avec d'autres indices changerait un document déjà
// signé. Ce module construit et fige ; il ne relit jamais un certificat émis.
//
// Logique PURE : aucun store, aucune horloge — l'état est un argument,
// la date d'émission aussi.

import type {
  AppState,
  CertificatPaiement,
  EnteteCertificat,
  LignesCertificat,
  MarcheTravaux,
  Situation,
} from './types'
import { garantieDuMarche, marcheDeSituation, projetById, situationPrecedente } from './derive'
import { revisionTheorique } from './revisionPrix'
import { totalAppliqueMarche } from './penalites'

/** règle CCAG (art. 13.2.2) : la résorption de l'avance commence quand le
 *  cumul atteint 65 % du marché et doit être soldée à 80 % — une PROPOSITION,
 *  toujours corrigeable (le CCAP peut écrire d'autres seuils) */
export const SEUIL_DEBUT_RESORPTION = 0.65
export const SEUIL_FIN_RESORPTION = 0.8

/** taux de TVA proposé par défaut (travaux au taux normal) — corrigeable */
export const TAUX_TVA_CERTIFICAT = 0.2

/** arrondi au centime — chaque ligne part sur un document contractuel */
const arr = (x: number) => Math.round(x * 100) / 100

/** un montant exploitable est un nombre fini ; le reste vaut null */
const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** résorption PROPOSÉE pour le présent état : rien avant 65 % d'avancement,
 *  tout soldé à 80 %, linéaire entre les deux — moins ce qui est déjà
 *  remboursé, jamais plus que le reste. Exportée seule : la règle se teste
 *  sans construire un certificat entier. */
export function resorptionProposee(
  avanceInitialeHT: number,
  avanceRembourseeHT: number,
  avancement: number,
): number {
  const initiale = Math.max(0, num(avanceInitialeHT) ?? 0)
  const remboursee = Math.max(0, num(avanceRembourseeHT) ?? 0)
  const reste = arr(initiale - remboursee)
  if (initiale <= 0 || reste <= 0) return 0
  if (!Number.isFinite(avancement) || avancement < SEUIL_DEBUT_RESORPTION) return 0
  const cible =
    avancement >= SEUIL_FIN_RESORPTION
      ? initiale
      : arr(
          (initiale * (avancement - SEUIL_DEBUT_RESORPTION)) /
            (SEUIL_FIN_RESORPTION - SEUIL_DEBUT_RESORPTION),
        )
  return arr(Math.min(reste, Math.max(0, arr(cible - remboursee))))
}

/** toute ligne du certificat est corrigeable — y compris le numéro : le
 *  document réel a prouvé qu'aucune règle générale ne couvre la lecture
 *  contractuelle (RG sur le seul avenant d'un marché couvert par GPD) */
export type SurchargesCertificat = Partial<LignesCertificat> & { numero?: number }

export interface CertificatConstruit {
  situation: Situation
  marche: MarcheTravaux
  mois: string
  /** numéro RETENU (surcharge, sinon proposition) */
  numero: number
  numeroPropose: number
  entete: EnteteCertificat
  /** les valeurs PROPOSÉES, sans aucune surcharge — l'écran les affiche face aux corrections */
  proposition: LignesCertificat
  /** les valeurs RETENUES (surcharges appliquées, dérivés recalculés) — ce que le PDF imprime */
  lignes: LignesCertificat
  /** ce que la machine a fait et pourquoi — l'écran doit pouvoir le dire */
  mentions: string[]
}

/** certificats émis du marché, hors situation en cours (une réimpression ne
 *  doit jamais servir d'« antérieur » à elle-même) */
function certificatsDuMarche(state: AppState, marcheId: string): CertificatPaiement[] {
  return (Array.isArray(state.certificats) ? state.certificats : []).filter(
    (c) => c && c.marcheId === marcheId,
  )
}

/** certificat déjà émis pour une situation — la réouverture est une RÉIMPRESSION */
export function certificatDeSituation(
  state: AppState,
  situationId: string,
): CertificatPaiement | undefined {
  return (Array.isArray(state.certificats) ? state.certificats : []).find(
    (c) => c && c.situationId === situationId,
  )
}

/** numérotation proposée : max(numero des certificats émis du marché) + 1 ;
 *  sans certificat, le n° du décompte (situation) sert de proposition — le
 *  document réel numérote l'état comme le décompte qu'il certifie */
export function numeroProposeCertificat(state: AppState, marcheId: string, s: Situation): number {
  const emis = certificatsDuMarche(state, marcheId)
  if (emis.length > 0) return Math.max(...emis.map((c) => num(c.numero) ?? 0)) + 1
  return num(s.numero) ?? 1
}

/** relit une valeur : la surcharge (nombre fini) prime, sinon la proposition */
function retenir(surcharges: SurchargesCertificat, cle: keyof LignesCertificat, propose: number): number {
  const v = num(surcharges[cle] as number | undefined)
  return v === null ? propose : v
}

/** construit le certificat de paiement d'une situation : toutes les rubriques
 *  du document réel, chaque ligne étant une PROPOSITION que `surcharges`
 *  corrige — les dérivés (acompte, TVA, totaux, net) se recalculent depuis
 *  les valeurs retenues, sauf s'ils sont eux-mêmes surchargés.
 *
 *  Répond null sans marché rattaché : un certificat sans marché n'a ni
 *  montant de base, ni avance, ni garantie — rien à certifier. */
export function construireCertificat(
  state: AppState,
  situationId: string,
  surcharges: SurchargesCertificat = {},
): CertificatConstruit | null {
  const s = (Array.isArray(state.situations) ? state.situations : []).find(
    (x) => x && x.id === situationId,
  )
  if (!s) return null
  const marche = marcheDeSituation(state, s)
  if (!marche) return null
  const projet = projetById(state, s.projetId)
  const garantie = garantieDuMarche(marche)
  const mentions: string[] = []

  // ---- propositions « primaires » (les faits, avant tout dérivé) ----------
  const baseHT = num(marche.montantInitialHT) ?? 0
  const avenantsHT = num(marche.avenantsHT) ?? 0
  const totalMarcheHT = arr(baseHT + avenantsHT)
  const cumulHT = num(s.montantCumulHT) ?? num(s.montantMoisHT) ?? 0

  // antérieur : le dernier certificat ÉMIS d'un mois antérieur prime — c'est
  // le cumul réellement certifié au MO ; à défaut, la situation précédente
  const anterieursEmis = certificatsDuMarche(state, marche.id)
    .filter((c) => c.mois < s.mois)
    .sort((a, b) => b.mois.localeCompare(a.mois) || (num(b.numero) ?? 0) - (num(a.numero) ?? 0))
  const certPrecedent = anterieursEmis[0]
  const prec = situationPrecedente(state, s)
  const anterieurHT = certPrecedent
    ? num(certPrecedent.lignes?.cumulHT) ?? 0
    : prec
      ? num(prec.montantCumulHT) ?? num(prec.montantMoisHT) ?? 0
      : 0

  // avance forfaitaire : les compteurs du marché, résorption proposée CCAG
  const avanceInitialeHT = Math.max(0, num(marche.avanceForfaitaireHT) ?? 0)
  const avanceRembourseeAnterieureHT = Math.max(0, num(marche.avanceRembourseeHT) ?? 0)
  const avancement = totalMarcheHT > 0 ? cumulHT / totalMarcheHT : 0
  const resorptionHT = resorptionProposee(avanceInitialeHT, avanceRembourseeAnterieureHT, avancement)
  if (resorptionHT > 0) {
    mentions.push(
      'Résorption de l’avance proposée par la règle CCAG (démarre à 65 % d’avancement, soldée à 80 %) — le CCAP peut prévoir d’autres seuils : corrigez si besoin.',
    )
  }

  // révision : la valeur SAISIE sur la situation prime (c'est la demande de
  // l'entreprise, vérifiée en 5.5) ; sinon le théorique 5.4 sur l'acompte du
  // mois si calculable ; sinon 0 — et la mention dit lequel a servi
  const acomptePourRevision = arr(cumulHT - anterieurHT)
  const revisionSaisie = num(s.revisionHT)
  const theorique = revisionTheorique(marche, state.indicesBTP, s.mois, acomptePourRevision)
  let revisionHT = 0
  if (revisionSaisie !== null) {
    revisionHT = arr(revisionSaisie)
    mentions.push('Révision : montant saisi sur la situation (demande de l’entreprise).')
  } else if (theorique) {
    revisionHT = theorique.montant
    mentions.push(
      `Révision théorique 5.4 : coefficient ${theorique.coefficient} — indice de ${theorique.indiceUtilise.mois}${theorique.approximatif ? ' (approximatif : dernier publié, le chiffre bougera à la publication)' : ''}.`,
    )
  } else if (marche.revision) {
    mentions.push(
      'Marché révisable mais révision incalculable (série ou indices manquants) : proposée à 0, à corriger.',
    )
  }
  // antérieure : le dernier certificat émis porte son cumul figé ; à défaut,
  // la somme des révisions saisies sur les situations antérieures
  const revisionAnterieureHT = certPrecedent
    ? num(certPrecedent.lignes?.revisionOrigineHT) ?? 0
    : arr(
        (Array.isArray(state.situations) ? state.situations : [])
          .filter(
            (x) =>
              x &&
              x.id !== s.id &&
              x.mois < s.mois &&
              x.statut !== 'rejetee' &&
              (s.marcheId ? x.marcheId === s.marcheId : x.projetId === s.projetId),
          )
          .reduce((t, x) => t + (num(x.revisionHT) ?? 0), 0),
      )

  // pénalités : les APPLIQUÉES (5.2), moins ce que les certificats émis ont
  // déjà déduit — une pénalité déduite sur l'état 3 ne se re-déduit pas sur
  // l'état 4, sinon l'entreprise la paierait deux fois
  const dejaDeduites = arr(
    certificatsDuMarche(state, marche.id)
      .filter((c) => c.situationId !== s.id)
      .reduce((t, c) => t + (num(c.lignes?.penalitesHT) ?? 0), 0),
  )
  const penalitesHT = Math.max(
    0,
    arr(totalAppliqueMarche(state.evenementsMarche, marche.id) - dejaDeduites),
  )

  if (garantie !== 'retenue') {
    mentions.push(
      'Garantie fournie (caution ou première demande) : aucune retenue proposée — vérifiez sa couverture des AVENANTS : sur le document réel de l’agence, la GPD couvrait la base et la RG s’appliquait à l’avenant (lecture contractuelle).',
    )
  }

  const proposition = deriverLignes(
    {
      baseHT,
      avenantsHT,
      cumulHT,
      anterieurHT,
      avanceInitialeHT,
      avanceVerseePresentHT: 0,
      avanceRembourseeAnterieureHT,
      resorptionHT,
      revisionHT,
      revisionAnterieureHT,
      tauxTVA: TAUX_TVA_CERTIFICAT,
      penalitesHT,
    },
    garantie,
    marche.tauxRG,
    {},
  )
  const lignes = deriverLignes(
    {
      baseHT: retenir(surcharges, 'baseHT', baseHT),
      avenantsHT: retenir(surcharges, 'avenantsHT', avenantsHT),
      cumulHT: retenir(surcharges, 'cumulHT', cumulHT),
      anterieurHT: retenir(surcharges, 'anterieurHT', anterieurHT),
      avanceInitialeHT: retenir(surcharges, 'avanceInitialeHT', avanceInitialeHT),
      avanceVerseePresentHT: retenir(surcharges, 'avanceVerseePresentHT', 0),
      avanceRembourseeAnterieureHT: retenir(
        surcharges,
        'avanceRembourseeAnterieureHT',
        avanceRembourseeAnterieureHT,
      ),
      resorptionHT: retenir(surcharges, 'resorptionHT', resorptionHT),
      revisionHT: retenir(surcharges, 'revisionHT', revisionHT),
      revisionAnterieureHT: retenir(surcharges, 'revisionAnterieureHT', revisionAnterieureHT),
      tauxTVA: retenir(surcharges, 'tauxTVA', TAUX_TVA_CERTIFICAT),
      penalitesHT: retenir(surcharges, 'penalitesHT', penalitesHT),
    },
    garantie,
    marche.tauxRG,
    surcharges,
  )

  const numeroPropose = numeroProposeCertificat(state, marche.id, s)
  const numeroSurcharge = num(surcharges.numero)

  const entete: EnteteCertificat = {
    marcheNumero: projet?.numeroEngagement || '',
    objet: projet ? projet.nom : s.projetId,
    lot: marche.lot || s.lot || '',
    moa: projet?.moa || '',
    titulaire: marche.entreprise || s.entreprise,
    garantie,
    agence: {
      nom: state.settings.nomAgence,
      adresse: state.settings.adresseAgence,
      siret: state.settings.siretAgence,
    },
  }

  return {
    situation: s,
    marche,
    mois: s.mois,
    numero: numeroSurcharge === null ? numeroPropose : numeroSurcharge,
    numeroPropose,
    entete,
    proposition,
    lignes,
    mentions,
  }
}

/** valeurs primaires retenues → toutes les lignes du certificat. Les dérivés
 *  se recalculent depuis les valeurs RETENUES (corriger un cumul doit faire
 *  bouger l'acompte, la TVA et le net), puis les surcharges de dérivés
 *  s'appliquent en dernier — corriger directement un total reste possible. */
function deriverLignes(
  p: Pick<
    LignesCertificat,
    | 'baseHT'
    | 'avenantsHT'
    | 'cumulHT'
    | 'anterieurHT'
    | 'avanceInitialeHT'
    | 'avanceVerseePresentHT'
    | 'avanceRembourseeAnterieureHT'
    | 'resorptionHT'
    | 'revisionHT'
    | 'revisionAnterieureHT'
    | 'tauxTVA'
    | 'penalitesHT'
  >,
  garantie: EnteteCertificat['garantie'],
  tauxRG: number | undefined,
  surcharges: SurchargesCertificat,
): LignesCertificat {
  const t = p.tauxTVA
  // étage 1 — dérivés intermédiaires
  const totalMarcheHT = retenir(surcharges, 'totalMarcheHT', arr(p.baseHT + p.avenantsHT))
  const acompteHT = retenir(surcharges, 'acompteHT', arr(p.cumulHT - p.anterieurHT))
  const revisionOrigineHT = retenir(
    surcharges,
    'revisionOrigineHT',
    arr(p.revisionHT + p.revisionAnterieureHT),
  )
  const avanceRembourseeTotaleHT = retenir(
    surcharges,
    'avanceRembourseeTotaleHT',
    arr(p.avanceRembourseeAnterieureHT + p.resorptionHT),
  )
  const avanceResteHT = retenir(
    surcharges,
    'avanceResteHT',
    arr(Math.max(0, p.avanceInitialeHT - avanceRembourseeTotaleHT)),
  )
  const tvaAvanceHT = retenir(surcharges, 'tvaAvanceHT', arr(t * p.avanceVerseePresentHT))
  const tvaAcompteHT = retenir(surcharges, 'tvaAcompteHT', arr(t * acompteHT))
  const tvaRevisionHT = retenir(surcharges, 'tvaRevisionHT', arr(t * p.revisionHT))
  const tvaAvanceCumulHT = retenir(surcharges, 'tvaAvanceCumulHT', arr(t * p.avanceInitialeHT))
  const tvaAcompteCumulHT = retenir(surcharges, 'tvaAcompteCumulHT', arr(t * p.cumulHT))
  const tvaRevisionCumulHT = retenir(surcharges, 'tvaRevisionCumulHT', arr(t * revisionOrigineHT))
  // étage 2 — totaux TTC : la résorption se déduit TTC (l'avance a été
  // versée TTC, elle se rembourse TTC)
  const totalTTC = retenir(
    surcharges,
    'totalTTC',
    arr(
      acompteHT +
        p.revisionHT +
        p.avanceVerseePresentHT +
        tvaAcompteHT +
        tvaRevisionHT +
        tvaAvanceHT -
        arr(p.resorptionHT * (1 + t)),
    ),
  )
  const acompteTTCCumul = retenir(
    surcharges,
    'acompteTTCCumul',
    arr(
      p.cumulHT +
        revisionOrigineHT +
        tvaAcompteCumulHT +
        tvaRevisionCumulHT +
        p.avanceInitialeHT +
        tvaAvanceCumulHT -
        arr(avanceRembourseeTotaleHT * (1 + t)),
    ),
  )
  // étage 3 — retenue : 0 dès qu'une caution ou une GPD couvre le marché
  // (même autorité que decompteSituation, 5.1) ; sinon tauxRG sur le TTC du
  // présent état. Le document réel prouve que la lecture contractuelle peut
  // dire autre chose (RG sur le seul avenant) : c'est la surcharge.
  const retenueGarantieTTC = retenir(
    surcharges,
    'retenueGarantieTTC',
    garantie === 'retenue' ? arr(Math.max(0, totalTTC) * (num(tauxRG) ?? 0)) : 0,
  )
  // étage 4 — le net
  const netAPayerTTC = retenir(
    surcharges,
    'netAPayerTTC',
    arr(totalTTC - p.penalitesHT - retenueGarantieTTC),
  )
  const resteHT = retenir(surcharges, 'resteHT', arr(totalMarcheHT - p.cumulHT))

  return {
    ...p,
    totalMarcheHT,
    acompteHT,
    revisionOrigineHT,
    avanceRembourseeTotaleHT,
    avanceResteHT,
    tvaAvanceHT,
    tvaAcompteHT,
    tvaRevisionHT,
    tvaAvanceCumulHT,
    tvaAcompteCumulHT,
    tvaRevisionCumulHT,
    totalTTC,
    acompteTTCCumul,
    penalitesHT: p.penalitesHT,
    retenueGarantieTTC,
    netAPayerTTC,
    resteHT,
  }
}

/** compteur d'avance remboursée du marché APRÈS l'émission d'un certificat :
 *  la résorption émise s'y ajoute, pour que l'état suivant propose la suite
 *  et non la même résorption. C'est le geste « Émettre » qui l'écrit — un
 *  fait contractuel avancé par un humain, jamais une dérivation. */
export function avanceRembourseeApresEmission(
  m: Pick<MarcheTravaux, 'avanceRembourseeHT'>,
  cert: Pick<CertificatPaiement, 'lignes'>,
): number {
  return arr((num(m.avanceRembourseeHT) ?? 0) + Math.max(0, num(cert.lignes?.resorptionHT) ?? 0))
}

/** FIGE un certificat construit : copie profonde des lignes et de l'en-tête
 *  — l'objet émis ne partage plus rien avec l'état courant, c'est ce qui
 *  rend la réimpression stable quand les indices ou le marché changent.
 *  L'identifiant et la date viennent de l'appelant (producteur rejouable,
 *  aucune horloge ici). */
export function figerCertificat(
  construit: CertificatConstruit,
  emission: { id: string; emisLe: string; emisPar: string },
): CertificatPaiement {
  return {
    id: emission.id,
    marcheId: construit.marche.id,
    projetId: construit.situation.projetId,
    situationId: construit.situation.id,
    numero: construit.numero,
    mois: construit.mois,
    entete: { ...construit.entete, agence: { ...construit.entete.agence } },
    lignes: { ...construit.lignes },
    netAPayerTTC: construit.lignes.netAPayerTTC,
    emisLe: emission.emisLe,
    emisPar: emission.emisPar,
  }
}
