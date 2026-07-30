// ============================================================
// Moteur de facturation — audit finance F0 (intégrité) :
// - le numéro LÉGAL n'existe qu'à l'émission (séquence continue
//   par année) — une échéance de 2028 n'occupe aucun numéro ;
// - la facture émise est FIGÉE : copie complète + empreinte
//   SHA-256, le PDF se régénère depuis ce bloc, jamais depuis
//   l'état courant ;
// - pas de modification/suppression après émission : la
//   correction passe par un AVOIR qui référence l'origine ;
// - le statut de paiement se DÉRIVE du solde (paiements
//   partiels, multi-factures), il ne se choisit pas.
// ============================================================

import type {
  AppState,
  Facture,
  FactureFigee,
  LigneFacture,
  Paiement,
  Projet,
  VentilationTVAFigee,
} from './types'
import { uid } from './util'

/** Tolérance réservée aux imprécisions de calcul flottant, inférieure à un centime. */
export const TOLERANCE_MONETAIRE = 0.005

function arrondirCentimes(montant: number): number {
  if (montant === 0) return 0
  return Math.sign(montant) * Math.round((Math.abs(montant) + Number.EPSILON) * 100) / 100
}

function montantLisible(montant: number): string {
  return `${arrondirCentimes(montant).toFixed(2).replace('.', ',')} €`
}

// ---------- numérotation (unique, chronologique, continue) ----------

/** numéros légaux déjà pris pour une année (factures émises + héritage) */
function numerosDeLAnnee(state: AppState, annee: string): number[] {
  const ns: number[] = []
  for (const f of state.factures) {
    const numero = f.numero || (f.statut !== 'prevue' ? f.id : '')
    const m = new RegExp(`^${annee}-(\\d{1,4})$`).exec(numero)
    if (m) ns.push(Number(m[1]))
  }
  return ns.sort((a, b) => a - b)
}

/** prochain numéro disponible — attribué UNIQUEMENT au moment d'émettre */
export function prochainNumero(state: AppState, dateEmission: string): string {
  const annee = dateEmission.slice(0, 4)
  const ns = numerosDeLAnnee(state, annee)
  const suivant = ns.length > 0 ? ns[ns.length - 1] + 1 : 1
  return `${annee}-${String(suivant).padStart(3, '0')}`
}

/** trous dans la séquence de l'année (contrôle de continuité, affiché) */
export function trousNumerotation(state: AppState, annee: string): string[] {
  const ns = numerosDeLAnnee(state, annee)
  const trous: string[] = []
  for (let i = 1; i < ns.length; i++) {
    for (let n = ns[i - 1] + 1; n < ns[i]; n++) trous.push(`${annee}-${String(n).padStart(3, '0')}`)
  }
  return trous
}

/** Dernière garde avant insertion d'une pièce : l'id interne et le numéro
 * légal sont tous deux uniques, y compris lorsqu'une autre émission a abouti
 * pendant le calcul asynchrone de l'empreinte. */
export function erreurInsertionFacture(state: AppState, candidate: Facture): string | null {
  if (state.factures.some((f) => f.id === candidate.id)) {
    return `Une pièce portant l’identifiant interne « ${candidate.id} » existe déjà. Rechargez la facturation avant de réessayer.`
  }
  const numero = candidate.numero?.trim()
  if (
    numero &&
    state.factures.some((f) => {
      const numeroExistant = f.numero?.trim() || (f.statut !== 'prevue' ? f.id.trim() : '')
      return numeroExistant === numero
    })
  ) {
    return `Le numéro ${numero} vient déjà d’être attribué à une autre pièce. Le prochain numéro sera recalculé.`
  }
  return null
}

// ---------- lignes & totaux ----------

export function montantLigne(l: LigneFacture): number {
  return Math.round(l.quantite * l.prixUnitaireHT * 100) / 100
}

export function totauxLignes(lignes: LigneFacture[]): { ht: number; tva: number; ttc: number } {
  let ht = 0
  let tva = 0
  for (const l of lignes) {
    const m = montantLigne(l)
    ht += m
    // tauxTVA est une FRACTION (0.2 = 20 %) — convention du modèle existant
    tva += m * l.tauxTVA
  }
  ht = Math.round(ht * 100) / 100
  tva = Math.round(tva * 100) / 100
  return { ht, tva, ttc: Math.round((ht + tva) * 100) / 100 }
}

/** TTC d'une facture : depuis la copie figée si présente, sinon héritage
 *  (tauxTVA est une fraction : 0.2 = 20 %) */
export function ttcFacture(f: Facture): number {
  if (f.figee) return f.figee.totalTTC
  return Math.round(f.montantHT * (1 + f.tauxTVA) * 100) / 100
}

// ---------- contrôles avant émission (bloquants + alertes) ----------

export interface BrouillonFacture {
  projetId: string
  clientNom: string
  clientAdresse: string
  dateEmission: string
  datePrestation?: string
  lignes: LigneFacture[]
  numeroEngagement?: string
  /** dépassement du contrat assumé et justifié */
  horsContratJustifie?: string
}

export interface ControleEmission {
  bloquants: string[]
  alertes: string[]
}

/** les contrôles DÉTERMINISTES qui gardent la porte de l'émission —
 *  chaque blocage est une phrase lisible (audit §5.3) */
export function controlerAvantEmission(
  state: AppState,
  projet: Projet | undefined,
  b: BrouillonFacture,
): ControleEmission {
  const bloquants: string[] = []
  const alertes: string[] = []

  if (!projet) bloquants.push('Projet introuvable.')
  if (!b.clientNom.trim()) bloquants.push('Le client facturé est obligatoire (mentions légales).')
  if (!b.clientAdresse.trim())
    bloquants.push('L’adresse de facturation du client est obligatoire — à renseigner sur la fiche projet.')
  if (!b.dateEmission) bloquants.push('La date d’émission est obligatoire.')
  const lignesPrecises = b.lignes.filter((l) => l.designation.trim().length >= 3 && montantLigne(l) !== 0)
  if (lignesPrecises.length === 0)
    bloquants.push('Au moins une ligne précise (désignation, quantité, prix) est obligatoire.')
  if (
    b.lignes.some(
      (ligne) =>
        !Number.isFinite(ligne.quantite) ||
        !Number.isFinite(ligne.prixUnitaireHT) ||
        !Number.isFinite(ligne.tauxTVA) ||
        ligne.tauxTVA < 0 ||
        ligne.tauxTVA > 1,
    )
  )
    bloquants.push('Chaque ligne doit contenir des montants finis et un taux de TVA compris entre 0 et 100 %.')
  const basesNegatives = montantsParTaux(b.lignes, false).filter(
    (groupe) => groupe.ht < -TOLERANCE_MONETAIRE,
  )
  if (basesNegatives.length > 0) {
    bloquants.push(
      `La base HT nette doit rester positive ou nulle pour chaque taux de TVA ` +
        `(${basesNegatives.map((groupe) => `${groupe.tauxTVA * 100} %`).join(', ')}).`,
    )
  }
  const t = totauxLignes(b.lignes)
  if (!(t.ht > 0)) bloquants.push('Le total HT d’une facture ordinaire doit être strictement positif.')
  if (!(t.ttc > 0)) bloquants.push('Le total TTC d’une facture ordinaire doit être strictement positif.')
  const s = state.settings
  if (!s.siretAgence || !s.adresseAgence)
    bloquants.push('Coordonnées légales de l’agence incomplètes (SIRET, adresse) — Paramètres.')

  // client public : numéro d'engagement attendu
  if (projet && projet.typeMO === 'Public' && !b.numeroEngagement) {
    alertes.push('Client public sans numéro d’engagement — vérifier si le marché l’exige (Chorus).')
  }
  // dépassement du montant contractuel : bloquant SAUF justification
  const contrat = state.contrats.find((c) => c.type === 'client' && c.projetId === b.projetId)
  if (contrat) {
    const totalContrat = contrat.lignes
      .filter((l) => l.etat === 'active')
      .reduce((somme, l) => somme + l.quantite * l.prixUnitaireHT, 0)
    const dejaFacture = state.factures
      .filter((f) => f.projetId === b.projetId && f.statut !== 'prevue' && f.type !== 'avoir')
      .reduce((somme, f) => somme + (f.figee?.totalHT ?? f.montantHT), 0)
    const avoirs = state.factures
      .filter((f) => f.projetId === b.projetId && f.type === 'avoir')
      .reduce((somme, f) => somme + (f.figee?.totalHT ?? f.montantHT), 0)
    const apres = dejaFacture + avoirs + t.ht
    if (apres > totalContrat + 0.01) {
      if (b.horsContratJustifie?.trim()) {
        alertes.push(
          `Dépassement du contrat assumé (+${Math.round((apres - totalContrat) * 100) / 100} € HT) : ${b.horsContratJustifie}`,
        )
      } else {
        bloquants.push(
          `La facture dépasse le total contractuel (${Math.round(apres * 100) / 100} € HT facturés pour ${Math.round(totalContrat * 100) / 100} € au contrat${contrat.provisoire ? ' — contrat provisoire à contrôler' : ''}) — ajouter un avenant ou justifier « hors contrat ».`,
        )
      }
    }
  }
  return { bloquants, alertes }
}

// ---------- gel à l'émission ----------

export const MENTION_TVA_DEFAUT = 'TVA sur les encaissements'

/** construit la copie FIGÉE — tout ce que le PDF imprimera, capturé
 *  au moment de l'émission (l'état courant ne compte plus ensuite) */
export function construireFigee(
  state: AppState,
  b: BrouillonFacture,
  numero: string,
  objet?: string,
  delaiJours = 30,
): FactureFigee {
  const s = state.settings
  const t = totauxLignes(b.lignes)
  return {
    numero,
    dateEmission: b.dateEmission,
    datePrestation: b.datePrestation,
    clientNom: b.clientNom,
    clientAdresse: b.clientAdresse,
    numeroEngagement: b.numeroEngagement,
    objet,
    agence: {
      nom: s.nomAgence,
      adresse: s.adresseAgence,
      siret: s.siretAgence,
      tva: s.numeroTVA,
      rcs: s.rcs,
      capital: s.capitalSocial,
      iban: s.iban,
      bic: s.bic,
      banque: s.banque,
    },
    lignes: b.lignes.map((l) => ({ ...l })),
    totalHT: t.ht,
    totalTVA: t.tva,
    totalTTC: t.ttc,
    mentionTVA: s.mentionTVA || MENTION_TVA_DEFAUT,
    delaiJours,
  }
}

/** empreinte SHA-256 du bloc figé (hex) — '' si l'API crypto manque */
export async function empreinteFigee(figee: FactureFigee): Promise<string> {
  try {
    const sans = { ...figee, empreinte: undefined }
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(sans)))
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
  } catch {
    return ''
  }
}

// ---------- paiements : le statut se dérive du solde ----------

/** total réglé sur une facture (affectations de tous les paiements) */
export function regleSurFacture(state: AppState, factureId: string): number {
  let total = 0
  for (const p of state.paiements) {
    for (const a of p.affectations) if (a.factureId === factureId) total += a.montant
  }
  return Math.round(total * 100) / 100
}

/** Total TTC des avoirs émis qui corrigent cette facture. */
export function avoirsLiesTTC(state: AppState, factureId: string): number {
  const total = state.factures
    .filter(
      (piece) =>
        piece.type === 'avoir' &&
        piece.statut !== 'prevue' &&
        piece.factureOrigineId === factureId,
    )
    .reduce((somme, avoir) => somme + Math.abs(ttcFacture(avoir)), 0)
  return arrondirCentimes(total)
}

/** Créance client après déduction des avoirs liés, avant paiements. */
export function creanceFactureTTC(state: AppState, f: Facture): number {
  if (f.type === 'avoir') return ttcFacture(f)
  return Math.max(0, arrondirCentimes(ttcFacture(f) - avoirsLiesTTC(state, f.id)))
}

export function soldeFacture(state: AppState, f: Facture): number {
  if (f.type === 'avoir') {
    return arrondirCentimes(ttcFacture(f) - regleSurFacture(state, f.id))
  }
  return Math.max(0, arrondirCentimes(creanceFactureTTC(state, f) - regleSurFacture(state, f.id)))
}

export type EtatPaiement = 'payee' | 'partielle' | 'attente'

/** dérivé, jamais choisi : payée si le solde est nul, partielle si un
 *  règlement existe, en attente sinon (l'héritage « encaissée » = payée) */
export function etatPaiement(state: AppState, f: Facture): EtatPaiement {
  if (f.statut === 'encaissee' && regleSurFacture(state, f.id) === 0) return 'payee'
  const regle = regleSurFacture(state, f.id)
  const solde = soldeFacture(state, f)
  if (solde <= 0.01 && (regle > 0 || creanceFactureTTC(state, f) <= 0.01)) return 'payee'
  if (regle > 0) return 'partielle'
  return 'attente'
}

export interface ControlePaiement {
  valide: boolean
  erreurs: string[]
}

/** Contrôle central de tout paiement client. Les affectations répétées vers
 * une même facture sont regroupées afin qu'elles ne puissent pas contourner
 * le contrôle du solde restant. */
export function validerPaiement(
  state: AppState,
  montant: number,
  affectations: { factureId: string; montant: number }[],
): ControlePaiement {
  const erreurs: string[] = []
  const montantValide = Number.isFinite(montant) && montant > 0
  if (!montantValide) erreurs.push('Le montant du paiement doit être strictement positif.')
  if (affectations.length === 0) erreurs.push('Le paiement doit être affecté à au moins une facture.')

  let somme = 0
  const parFacture = new Map<string, number>()
  for (const affectation of affectations) {
    const factureId = affectation.factureId.trim()
    if (!factureId) {
      erreurs.push('Chaque affectation doit désigner une facture.')
      continue
    }
    if (!Number.isFinite(affectation.montant) || affectation.montant <= 0) {
      erreurs.push(`L’affectation à la facture ${factureId} doit être strictement positive.`)
      continue
    }
    somme += affectation.montant
    parFacture.set(factureId, (parFacture.get(factureId) || 0) + affectation.montant)
  }

  if (
    montantValide &&
    Number.isFinite(somme) &&
    Math.abs(arrondirCentimes(somme) - arrondirCentimes(montant)) > TOLERANCE_MONETAIRE
  ) {
    erreurs.push(
      `La somme des affectations (${montantLisible(somme)}) doit être égale au montant reçu (${montantLisible(montant)}).`,
    )
  }

  for (const [factureId, montantAffecte] of parFacture) {
    const facture = state.factures.find((f) => f.id === factureId)
    if (!facture) {
      erreurs.push(`La facture ${factureId} est introuvable.`)
      continue
    }
    if (facture.type === 'avoir') {
      erreurs.push(`Un paiement client ne peut pas être affecté à l’avoir ${facture.numero || facture.id}.`)
      continue
    }
    const solde = Math.max(0, soldeFacture(state, facture))
    if (arrondirCentimes(montantAffecte) - arrondirCentimes(solde) > TOLERANCE_MONETAIRE) {
      erreurs.push(
        `L’affectation à la facture ${facture.numero || facture.id} (${montantLisible(montantAffecte)}) dépasse son solde restant (${montantLisible(solde)}).`,
      )
    }
  }

  return { valide: erreurs.length === 0, erreurs }
}

/** prépare un paiement affecté à une ou plusieurs factures (montants
 * proposés = soldes, ajustables) — à construire AVANT update(). Une
 * validation identique doit être rejouée dans la mutation finale. */
export function nouveauPaiement(
  state: AppState,
  date: string,
  montant: number,
  affectations: { factureId: string; montant: number }[],
  reference?: string,
  moyen?: string,
): Paiement {
  const montantCentimes = arrondirCentimes(montant)
  const affectationsCentimes = affectations.map((affectation) => ({
    ...affectation,
    montant: arrondirCentimes(affectation.montant),
  }))
  const controle = validerPaiement(state, montantCentimes, affectationsCentimes)
  if (!controle.valide) throw new Error(controle.erreurs.join(' '))
  return {
    id: uid('pay'),
    date,
    montant: montantCentimes,
    moyen,
    reference,
    affectations: affectationsCentimes,
  }
}

/** Une pièce historique peut être rapprochée tant qu'aucune écriture
 * ultérieure ne s'appuie sur ses anciens montants. Le paiement technique de
 * migration est le seul lien que le rapprochement sait réaligner. */
export function erreurRapprochementHistorique(
  state: AppState,
  factureId: string,
): string | null {
  const facture = state.factures.find((piece) => piece.id === factureId)
  if (facture?.statutComptable || facture?.lotComptableId) {
    return 'Cette facture historique a déjà été exportée en comptabilité. Ses montants ne peuvent plus être modifiés.'
  }
  if ((facture?.transmissions || []).length > 0) {
    return 'Cette facture historique possède déjà un suivi de transmission. Ses montants ne peuvent plus être modifiés.'
  }
  const avoirLie = state.factures.some(
    (piece) =>
      piece.type === 'avoir' &&
      piece.statut !== 'prevue' &&
      piece.factureOrigineId === factureId,
  )
  const paiementMigrationId = `pay-migr-${factureId}`
  const paiementNonMigration = state.paiements.some((paiement) => {
    const affecteFacture = paiement.affectations.some(
      (affectation) => affectation.factureId === factureId,
    )
    if (!affecteFacture) return false
    return !(
      paiement.id === paiementMigrationId &&
      paiement.affectations.length === 1 &&
      paiement.affectations[0].factureId === factureId
    )
  })
  if (avoirLie && paiementNonMigration) {
    return 'Cette facture historique possède déjà un avoir et un paiement réel. Ses montants ne peuvent plus être modifiés.'
  }
  if (avoirLie) {
    return 'Cette facture historique possède déjà un avoir. Ses montants ne peuvent plus être modifiés.'
  }
  if (paiementNonMigration) {
    return 'Cette facture historique possède déjà un paiement réel. Ses montants ne peuvent plus être modifiés.'
  }
  return null
}

// ---------- avoirs : la correction TRAÇABLE ----------

function montantHTFacture(f: Facture): number {
  return arrondirCentimes(f.figee?.totalHT ?? f.montantHT)
}

export interface SoldeAvoirParTaux {
  tauxTVA: number
  ht: number
  tva: number
  ttc: number
}

interface MontantsParTaux extends SoldeAvoirParTaux {
  cle: string
}

function lignesComptables(f: Facture): LigneFacture[] {
  return (
    f.figee?.lignes ||
    f.lignes || [
      {
        id: `ligne-${f.id}`,
        designation: f.libelle,
        quantite: 1,
        unite: 'forfait',
        prixUnitaireHT: f.montantHT,
        tauxTVA: f.tauxTVA,
      },
    ]
  )
}

function cleTaux(tauxTVA: number): string {
  return Number.isFinite(tauxTVA) ? tauxTVA.toFixed(6) : String(tauxTVA)
}

/** Regroupe une pièce par taux sans perdre les règles d'arrondi du moteur. */
function montantsParTaux(lignes: LigneFacture[], annulation: boolean): MontantsParTaux[] {
  const groupes = new Map<string, { tauxTVA: number; lignes: LigneFacture[] }>()
  for (const ligne of lignes) {
    const cle = cleTaux(ligne.tauxTVA)
    const groupe = groupes.get(cle)
    if (groupe) groupe.lignes.push(ligne)
    else groupes.set(cle, { tauxTVA: ligne.tauxTVA, lignes: [ligne] })
  }
  return [...groupes.entries()].map(([cle, groupe]) => {
    const total = totauxLignes(groupe.lignes)
    const signe = annulation ? -1 : 1
    return {
      cle,
      tauxTVA: groupe.tauxTVA,
      ht: arrondirCentimes(total.ht * signe),
      tva: arrondirCentimes(total.tva * signe),
      ttc: arrondirCentimes(total.ttc * signe),
    }
  })
}

/** Réconcilie les groupes avec les totaux figés de la pièce. L'écart
 * d'arrondi global (souvent un centime) est porté par le plus grand groupe,
 * afin que la somme des plafonds par taux reste exactement égale à la pièce. */
function montantsPieceParTaux(f: Facture, annulation: boolean): MontantsParTaux[] {
  if (f.figee?.ventilationTVA?.length) {
    const signe = annulation ? -1 : 1
    return f.figee.ventilationTVA.map((ventilation) => ({
      cle: cleTaux(ventilation.tauxTVA),
      tauxTVA: ventilation.tauxTVA,
      ht: arrondirCentimes(ventilation.baseHT * signe),
      tva: arrondirCentimes(ventilation.montantTVA * signe),
      ttc: arrondirCentimes(ventilation.montantTTC * signe),
    }))
  }
  const lignes = lignesComptables(f)
  const groupes = montantsParTaux(lignes, annulation)
  if (groupes.length === 0) return groupes
  const totauxPiece = f.figee
    ? {
        ht: f.figee.totalHT,
        tva: f.figee.totalTVA,
        ttc: f.figee.totalTTC,
      }
    : totauxLignes(lignes)
  const signe = annulation ? -1 : 1
  const cible = {
    ht: arrondirCentimes(totauxPiece.ht * signe),
    tva: arrondirCentimes(totauxPiece.tva * signe),
    ttc: arrondirCentimes(totauxPiece.ttc * signe),
  }
  const principal = groupes.reduce((plusGrand, groupe) =>
    Math.abs(groupe.ht) > Math.abs(plusGrand.ht) ? groupe : plusGrand,
  )
  principal.ht = arrondirCentimes(
    principal.ht + cible.ht - groupes.reduce((somme, groupe) => somme + groupe.ht, 0),
  )
  principal.tva = arrondirCentimes(
    principal.tva + cible.tva - groupes.reduce((somme, groupe) => somme + groupe.tva, 0),
  )
  principal.ttc = arrondirCentimes(
    principal.ttc + cible.ttc - groupes.reduce((somme, groupe) => somme + groupe.ttc, 0),
  )
  return groupes
}

interface TotauxPiece {
  ht: number
  tva: number
  ttc: number
  ventilationTVA?: VentilationTVAFigee[]
}

function totaliserVentilationTVA(
  ventilationTVA: VentilationTVAFigee[],
): TotauxPiece {
  const total = ventilationTVA.reduce(
    (somme, ventilation) => ({
      ht: somme.ht + ventilation.baseHT,
      tva: somme.tva + ventilation.montantTVA,
      ttc: somme.ttc + ventilation.montantTTC,
    }),
    { ht: 0, tva: 0, ttc: 0 },
  )
  return {
    ht: arrondirCentimes(total.ht),
    tva: arrondirCentimes(total.tva),
    ttc: arrondirCentimes(total.ttc),
  }
}

function totauxComptablesFacture(f: Facture): TotauxPiece {
  const ht = montantHTFacture(f)
  const ttc = arrondirCentimes(ttcFacture(f))
  const tva = arrondirCentimes(f.figee?.totalTVA ?? ttc - ht)
  return { ht, tva, ttc }
}

/** Plafond global défensif. Il reste nécessaire même avec le suivi par taux :
 * une ancienne pièce incohérente ne doit jamais permettre de créditer plus
 * que ses totaux HT, TVA ou TTC d'origine. */
function soldesAvoirGlobaux(state: AppState, origine: Facture): TotauxPiece {
  const original = totauxComptablesFacture(origine)
  let annuleHT = 0
  let annuleTVA = 0
  let annuleTTC = 0
  for (const avoir of state.factures) {
    if (
      avoir.type !== 'avoir' ||
      avoir.statut === 'prevue' ||
      avoir.factureOrigineId !== origine.id
    ) {
      continue
    }
    const total = totauxComptablesFacture(avoir)
    annuleHT += Math.abs(total.ht)
    annuleTVA += Math.abs(total.tva)
    annuleTTC += Math.abs(total.ttc)
  }
  return {
    ht: Math.max(0, arrondirCentimes(original.ht - annuleHT)),
    tva: Math.max(0, arrondirCentimes(original.tva - annuleTVA)),
    ttc: Math.max(0, arrondirCentimes(original.ttc - annuleTTC)),
  }
}

/** Soldes encore annulables, séparés par taux. Cette séparation empêche un
 * avoir partiel de consommer par erreur toute la base au premier taux de TVA. */
export function soldesAvoirParTaux(state: AppState, origine: Facture): SoldeAvoirParTaux[] {
  const origineParTaux = montantsPieceParTaux(origine, false)
  const dejaAnnule = new Map<string, MontantsParTaux>()

  for (const avoir of state.factures) {
    if (
      avoir.type !== 'avoir' ||
      avoir.statut === 'prevue' ||
      avoir.factureOrigineId !== origine.id
    ) {
      continue
    }
    for (const groupe of montantsPieceParTaux(avoir, true)) {
      const courant = dejaAnnule.get(groupe.cle)
      if (courant) {
        courant.ht = arrondirCentimes(courant.ht + groupe.ht)
        courant.tva = arrondirCentimes(courant.tva + groupe.tva)
        courant.ttc = arrondirCentimes(courant.ttc + groupe.ttc)
      } else {
        dejaAnnule.set(groupe.cle, { ...groupe })
      }
    }
  }

  const soldes = origineParTaux
    .map((origineTaux) => {
      const annule = dejaAnnule.get(origineTaux.cle)
      return {
        tauxTVA: origineTaux.tauxTVA,
        ht: Math.max(0, arrondirCentimes(origineTaux.ht - (annule?.ht || 0))),
        tva: Math.max(0, arrondirCentimes(origineTaux.tva - (annule?.tva || 0))),
        ttc: Math.max(0, arrondirCentimes(origineTaux.ttc - (annule?.ttc || 0))),
      }
    })
  const globaux = soldesAvoirGlobaux(state, origine)
  const alignerSurPlafondGlobal = (champ: 'ht' | 'tva', cible: number) => {
    let ecart = arrondirCentimes(
      cible - soldes.reduce((somme, solde) => somme + solde[champ], 0),
    )
    if (Math.abs(ecart) <= TOLERANCE_MONETAIRE || soldes.length === 0) return
    if (ecart > 0) {
      const principal = soldes.reduce((plusGrand, solde) =>
        solde.ht > plusGrand.ht ? solde : plusGrand,
      )
      principal[champ] = arrondirCentimes(principal[champ] + ecart)
      return
    }
    for (const solde of [...soldes].sort((a, b) => b[champ] - a[champ])) {
      if (ecart >= -TOLERANCE_MONETAIRE) break
      const retrait = Math.min(solde[champ], -ecart)
      solde[champ] = arrondirCentimes(solde[champ] - retrait)
      ecart = arrondirCentimes(ecart + retrait)
    }
  }
  // Les arrondis documentaires successifs peuvent créer un écart d'un
  // centime entre la somme des taux et le plafond global. Le taux principal
  // porte cet écart, sans jamais dépasser les totaux de la pièce.
  alignerSurPlafondGlobal('ht', globaux.ht)
  alignerSurPlafondGlobal('tva', globaux.tva)
  return soldes
    .map((solde) => ({
      ...solde,
      ttc: arrondirCentimes(solde.ht + solde.tva),
    }))
    .filter((solde) => solde.ht > TOLERANCE_MONETAIRE || solde.tva > TOLERANCE_MONETAIRE)
}

/** Montant HT encore annulable sur la facture d'origine, après déduction de
 * tous les avoirs déjà émis et en respectant chacun de ses taux de TVA. */
export function montantRestantAnnulableHT(state: AppState, origine: Facture): number {
  const restantParTaux = arrondirCentimes(
    soldesAvoirParTaux(state, origine).reduce((somme, solde) => somme + solde.ht, 0),
  )
  return Math.min(restantParTaux, soldesAvoirGlobaux(state, origine).ht)
}

/** Ventilation fiscale d'un nouvel avoir. Une série d'avoirs partiels peut
 * épuiser le centime de TVA d'un taux avant sa base HT. Dans ce cas, la pièce
 * suivante reprend au plus la TVA encore disponible ; quand elle consomme
 * toute la base d'un taux, elle absorbe exactement son dernier centime. */
function ventilationAvoirCalculee(
  soldes: SoldeAvoirParTaux[],
  lignes: LigneFacture[],
): VentilationTVAFigee[] {
  const soldesParTaux = new Map(
    soldes.map((solde) => [cleTaux(solde.tauxTVA), solde]),
  )
  return montantsParTaux(lignes, true).map((demande) => {
    const solde = soldesParTaux.get(demande.cle)
    const tvaDemandee = Math.max(0, arrondirCentimes(demande.tva))
    const tvaAAnnuler = solde
      ? Math.abs(demande.ht - solde.ht) <= TOLERANCE_MONETAIRE
        ? solde.tva
        : Math.min(solde.tva, tvaDemandee)
      : tvaDemandee
    const baseHT = arrondirCentimes(-demande.ht)
    const montantTVA = arrondirCentimes(-tvaAAnnuler)
    return {
      tauxTVA: demande.tauxTVA,
      baseHT,
      montantTVA,
      montantTTC: arrondirCentimes(baseHT + montantTVA),
    }
  })
}

export interface ControleAvoir {
  valide: boolean
  erreurs: string[]
  montantRestantHT: number
}

/** Contrôle central d'un avoir, rejoué juste avant son insertion pour
 * empêcher deux modales concurrentes d'annuler deux fois la même facture. */
export function validerAvoir(
  state: AppState,
  origine: Facture,
  montantAAnnulerHT: number,
  lignesCandidate?: LigneFacture[],
  totauxCandidats?: TotauxPiece,
): ControleAvoir {
  const erreurs: string[] = []
  const factureCourante = state.factures.find((f) => f.id === origine.id)
  if (!factureCourante) {
    erreurs.push(`La facture d’origine ${origine.numero || origine.id} est introuvable.`)
    return { valide: false, erreurs, montantRestantHT: 0 }
  }
  if (factureCourante.type === 'avoir') erreurs.push('Un avoir ne peut pas être créé à partir d’un autre avoir.')
  if (factureCourante.statut === 'prevue') erreurs.push('Un avoir ne peut corriger qu’une facture déjà émise.')

  const montantOrigine = Math.max(0, montantHTFacture(factureCourante))
  if (montantOrigine <= TOLERANCE_MONETAIRE) {
    erreurs.push('La facture d’origine ne présente aucun montant HT annulable.')
  }

  const montantRestantHT = montantRestantAnnulableHT(state, factureCourante)
  if (montantRestantHT <= TOLERANCE_MONETAIRE) {
    erreurs.push(`La facture ${factureCourante.numero || factureCourante.id} est déjà entièrement annulée par un avoir.`)
  }
  if (!Number.isFinite(montantAAnnulerHT) || montantAAnnulerHT <= 0) {
    erreurs.push('Le montant HT de l’avoir doit être strictement positif.')
  } else if (
    arrondirCentimes(montantAAnnulerHT) - arrondirCentimes(montantRestantHT) >
    TOLERANCE_MONETAIRE
  ) {
    erreurs.push(
      `Le montant de l’avoir (${montantLisible(montantAAnnulerHT)} HT) dépasse le montant encore annulable (${montantLisible(montantRestantHT)} HT).`,
    )
  }

  if (lignesCandidate) {
    if (lignesCandidate.length === 0) {
      erreurs.push('Un avoir doit comporter au moins une ligne.')
    } else if (
      lignesCandidate.some(
        (ligne) =>
          !Number.isFinite(ligne.tauxTVA) ||
          ligne.tauxTVA < 0 ||
          ligne.tauxTVA > 1,
      )
    ) {
      erreurs.push('Chaque ligne de l’avoir doit porter un taux de TVA compris entre 0 % et 100 %.')
    } else {
      const totauxLignesCandidate = totauxLignes(lignesCandidate)
      const totalCandidate: TotauxPiece = totauxCandidats || totauxLignesCandidate
      const soldes = soldesAvoirParTaux(state, factureCourante)
      const soldesGlobaux = soldesAvoirGlobaux(state, factureCourante)
      const ventilationAttendue = ventilationAvoirCalculee(
        soldes,
        lignesCandidate,
      )
      const ventilationAttendueParTaux = new Map(
        ventilationAttendue.map((ventilation) => [
          cleTaux(ventilation.tauxTVA),
          ventilation,
        ]),
      )
      const totalVentilationCandidate = totalCandidate.ventilationTVA?.length
        ? totaliserVentilationTVA(totalCandidate.ventilationTVA)
        : null
      const ventilationEgaleAuxTotaux =
        totalVentilationCandidate !== null &&
        Math.abs(totalVentilationCandidate.ht - totalCandidate.ht) <= TOLERANCE_MONETAIRE &&
        Math.abs(totalVentilationCandidate.tva - totalCandidate.tva) <= TOLERANCE_MONETAIRE &&
        Math.abs(totalVentilationCandidate.ttc - totalCandidate.ttc) <=
          TOLERANCE_MONETAIRE &&
        Math.abs(totalCandidate.ttc - totalCandidate.ht - totalCandidate.tva) <=
          TOLERANCE_MONETAIRE &&
        totalCandidate.ventilationTVA!.every(
          (ventilation) =>
            Math.abs(
              ventilation.montantTTC -
                ventilation.baseHT -
                ventilation.montantTVA,
            ) <= TOLERANCE_MONETAIRE,
        )
      const ventilationEgaleAuCalcul =
        totalCandidate.ventilationTVA?.length === ventilationAttendue.length &&
        totalCandidate.ventilationTVA.every((ventilation) => {
          const attendue = ventilationAttendueParTaux.get(
            cleTaux(ventilation.tauxTVA),
          )
          return (
            !!attendue &&
            Math.abs(ventilation.baseHT - attendue.baseHT) <=
              TOLERANCE_MONETAIRE &&
            Math.abs(ventilation.montantTVA - attendue.montantTVA) <=
              TOLERANCE_MONETAIRE &&
            Math.abs(ventilation.montantTTC - attendue.montantTTC) <=
              TOLERANCE_MONETAIRE
          )
        })
      const totauxEgauxAuxLignes =
        Math.abs(totalCandidate.ht - totauxLignesCandidate.ht) <= TOLERANCE_MONETAIRE &&
        Math.abs(totalCandidate.tva - totauxLignesCandidate.tva) <= TOLERANCE_MONETAIRE &&
        Math.abs(totalCandidate.ttc - totauxLignesCandidate.ttc) <= TOLERANCE_MONETAIRE
      if (
        totalCandidate.ventilationTVA?.length
          ? !ventilationEgaleAuxTotaux || !ventilationEgaleAuCalcul
          : !totauxEgauxAuxLignes
      ) {
        erreurs.push('Les totaux figés de l’avoir ne correspondent pas à ses lignes et aux soldes fiscaux par taux.')
      }
      if (!(totalCandidate.ht < 0) || !(totalCandidate.ttc < 0)) {
        erreurs.push('Les totaux HT et TTC de l’avoir doivent être strictement négatifs.')
      }
      if (
        Math.abs(Math.abs(totalCandidate.ht) - arrondirCentimes(montantAAnnulerHT)) >
        TOLERANCE_MONETAIRE
      ) {
        erreurs.push('Le total HT des lignes de l’avoir ne correspond pas au montant demandé.')
      }

      const demandesLignes = montantsParTaux(lignesCandidate, true)
      let demandesParTaux = demandesLignes
      if (totalCandidate.ventilationTVA?.length) {
        const cles = new Set<string>()
        const ventilationValide = totalCandidate.ventilationTVA.every((ventilation) => {
          const cle = cleTaux(ventilation.tauxTVA)
          if (cles.has(cle)) return false
          cles.add(cle)
          return (
            Number.isFinite(ventilation.tauxTVA) &&
            ventilation.tauxTVA >= 0 &&
            ventilation.tauxTVA <= 1 &&
            Number.isFinite(ventilation.baseHT) &&
            Number.isFinite(ventilation.montantTVA) &&
            Number.isFinite(ventilation.montantTTC)
          )
        })
        if (!ventilationValide) {
          erreurs.push('La ventilation de TVA figée de l’avoir est invalide ou contient un taux en double.')
        } else {
          if (!ventilationEgaleAuxTotaux) {
            erreurs.push('La ventilation par taux ne correspond pas aux totaux figés de l’avoir.')
          }

          demandesParTaux = totalCandidate.ventilationTVA.map((ventilation) => ({
            cle: cleTaux(ventilation.tauxTVA),
            tauxTVA: ventilation.tauxTVA,
            ht: -arrondirCentimes(ventilation.baseHT),
            tva: -arrondirCentimes(ventilation.montantTVA),
            ttc: -arrondirCentimes(ventilation.montantTTC),
          }))
          const lignesParTaux = new Map(
            demandesLignes.map((demande) => [demande.cle, demande]),
          )
          for (const demande of demandesParTaux) {
            const lignesDuTaux = lignesParTaux.get(demande.cle)
            if (
              !lignesDuTaux ||
              Math.abs(demande.ht - lignesDuTaux.ht) > TOLERANCE_MONETAIRE
            ) {
              erreurs.push(
                `La base HT figée au taux ${(demande.tauxTVA * 100).toLocaleString('fr-FR')} % ne correspond pas aux lignes de l’avoir.`,
              )
              continue
            }
            if (
              Math.abs(demande.ttc - demande.ht - demande.tva) >
              TOLERANCE_MONETAIRE
            ) {
              erreurs.push(
                `Les montants HT, TVA et TTC figés au taux ${(demande.tauxTVA * 100).toLocaleString('fr-FR')} % sont incohérents.`,
              )
            }
          }
          if (
            demandesLignes.some(
              (demande) => !demandesParTaux.some((figee) => figee.cle === demande.cle),
            )
          ) {
            erreurs.push('Chaque taux présent dans les lignes doit figurer dans la ventilation de TVA.')
          }
        }
      }

      const soldeParTaux = new Map(soldes.map((solde) => [cleTaux(solde.tauxTVA), solde]))
      for (const demande of demandesParTaux) {
        const solde = soldeParTaux.get(demande.cle)
        if (
          demande.ht < -TOLERANCE_MONETAIRE ||
          demande.tva < -TOLERANCE_MONETAIRE ||
          demande.ttc < -TOLERANCE_MONETAIRE
        ) {
          erreurs.push(
            `Les lignes au taux ${(demande.tauxTVA * 100).toLocaleString('fr-FR')} % augmentent la facture au lieu de l’annuler.`,
          )
          continue
        }
        if (!solde) {
          erreurs.push(
            `Aucun montant ne reste annulable au taux ${(demande.tauxTVA * 100).toLocaleString('fr-FR')} %.`,
          )
          continue
        }
        if (
          demande.ht - solde.ht > TOLERANCE_MONETAIRE ||
          demande.tva - solde.tva > TOLERANCE_MONETAIRE
        ) {
          erreurs.push(
            `L’avoir dépasse le solde annulable au taux ${(demande.tauxTVA * 100).toLocaleString('fr-FR')} % ` +
              `(${montantLisible(solde.ht)} HT et ${montantLisible(solde.tva)} de TVA).`,
          )
        }
      }

      const restantTVA = soldesGlobaux.tva
      const restantTTC = soldesGlobaux.ttc
      if (
        Math.abs(totalCandidate.tva) - restantTVA > TOLERANCE_MONETAIRE ||
        Math.abs(totalCandidate.ttc) - restantTTC > TOLERANCE_MONETAIRE
      ) {
        erreurs.push(
          `L’avoir dépasse les montants encore annulables (${montantLisible(restantTVA)} de TVA et ${montantLisible(restantTTC)} TTC).`,
        )
      }
    }
  }

  return { valide: erreurs.length === 0, erreurs, montantRestantHT }
}

/** Totaux à figer. Chaque avoir reprend au plus la TVA encore disponible par
 * taux ; le dernier absorbe exactement le reliquat fiscal. Cela évite qu'une
 * base HT résiduelle recrée un centime de TVA déjà annulé par un avoir
 * précédent. */
export function totauxAvoirPourEmission(
  state: AppState,
  origine: Facture,
  lignes: LigneFacture[],
  soldeComplet: boolean,
): TotauxPiece {
  const totaux = totauxLignes(lignes)
  const annulationComplete =
    soldeComplet ||
    Math.abs(
      Math.abs(totaux.ht) - montantRestantAnnulableHT(state, origine),
    ) <= TOLERANCE_MONETAIRE
  const soldes = soldesAvoirParTaux(state, origine)
  const ventilationLignes = ventilationAvoirCalculee(soldes, lignes)
  if (!annulationComplete) {
    return {
      ...totaliserVentilationTVA(ventilationLignes),
      ventilationTVA: ventilationLignes,
    }
  }
  const soldesGlobaux = soldesAvoirGlobaux(state, origine)
  const ventilationTVA = soldes.map((solde) => ({
    tauxTVA: solde.tauxTVA,
    baseHT: arrondirCentimes(-solde.ht),
    montantTVA: arrondirCentimes(-solde.tva),
    montantTTC: arrondirCentimes(-solde.ht - solde.tva),
  }))
  const exacts = {
    ht: -soldesGlobaux.ht,
    tva: -soldesGlobaux.tva,
    ttc: -soldesGlobaux.ttc,
    ventilationTVA,
  }
  const sommeVentilation = totaliserVentilationTVA(ventilationTVA)
  const nombreAvoirsLies =
    state.factures.filter(
      (piece) =>
        piece.type === 'avoir' &&
        piece.statut !== 'prevue' &&
        piece.factureOrigineId === origine.id,
    ).length + 1
  const ecartArrondiMax = Math.max(
    0.011,
    soldes.length * nombreAvoirsLies * 0.011,
  )
  if (
    Math.abs(sommeVentilation.ht - exacts.ht) >
      TOLERANCE_MONETAIRE ||
    Math.abs(sommeVentilation.tva - exacts.tva) >
      TOLERANCE_MONETAIRE ||
    Math.abs(sommeVentilation.ttc - sommeVentilation.ht - sommeVentilation.tva) >
      TOLERANCE_MONETAIRE ||
    Math.abs(exacts.ht - totaux.ht) > TOLERANCE_MONETAIRE ||
    Math.abs(exacts.tva - totaux.tva) > ecartArrondiMax ||
    Math.abs(exacts.ttc - totaux.ttc) > ecartArrondiMax
  ) {
    throw new Error('Le solde de l’avoir ne peut pas être représenté sans incohérence d’arrondi.')
  }
  return exacts
}

function repartirCentimes(montantCentimes: number, soldes: SoldeAvoirParTaux[]): number[] {
  const capacites = soldes.map((solde) => Math.max(0, Math.round(solde.ht * 100)))
  const capaciteTotale = capacites.reduce((somme, capacite) => somme + capacite, 0)
  if (montantCentimes > capaciteTotale) {
    throw new Error('Le montant demandé dépasse le montant encore annulable.')
  }
  if (montantCentimes === capaciteTotale) return capacites

  const repartition = capacites.map((capacite) =>
    Math.min(capacite, Math.floor((montantCentimes * capacite) / capaciteTotale)),
  )
  let manque = montantCentimes - repartition.reduce((somme, montant) => somme + montant, 0)
  const ordre = capacites
    .map((capacite, index) => ({
      index,
      reste: (montantCentimes * capacite) % capaciteTotale,
    }))
    .sort((a, b) => b.reste - a.reste || a.index - b.index)

  while (manque > 0) {
    let distribue = false
    for (const { index } of ordre) {
      if (manque === 0) break
      if (repartition[index] >= capacites[index]) continue
      repartition[index]++
      manque--
      distribue = true
    }
    if (!distribue) throw new Error('Le montant de l’avoir ne peut pas être réparti sans dépasser la facture.')
  }
  return repartition
}

/** brouillon d'avoir (total ou partiel) depuis une facture émise — les
 *  lignes sont négatives et l'origine est référencée ; l'avoir suit le
 *  même parcours d'émission (numéro, gel, empreinte) */
export function brouillonAvoir(
  state: AppState,
  f: Facture,
  montantPartielHT?: number,
): LigneFacture[] {
  const numeroOrigine = f.figee?.numero || f.numero || f.id
  const soldes = soldesAvoirParTaux(state, f)
  const restantHT = montantRestantAnnulableHT(state, f)
  const demandeHT = montantPartielHT == null ? restantHT : arrondirCentimes(montantPartielHT)
  if (!Number.isFinite(demandeHT) || demandeHT <= 0) {
    throw new Error('Le montant HT de l’avoir doit être strictement positif.')
  }
  if (demandeHT - restantHT > TOLERANCE_MONETAIRE) {
    throw new Error(
      `Le montant de l’avoir (${montantLisible(demandeHT)} HT) dépasse le montant encore annulable (${montantLisible(restantHT)} HT).`,
    )
  }

  const centimes = repartirCentimes(Math.round(demandeHT * 100), soldes)
  return soldes.flatMap((solde, index) => {
    if (centimes[index] === 0) return []
    return [
      {
        id: uid('lig'),
        designation:
          `Avoir ${montantPartielHT == null ? 'du solde' : 'partiel'} sur facture ${numeroOrigine}` +
          ` — TVA ${(solde.tauxTVA * 100).toLocaleString('fr-FR')} %`,
        quantite: 1,
        unite: 'forfait',
        prixUnitaireHT: -centimes[index] / 100,
        tauxTVA: solde.tauxTVA,
      },
    ]
  })
}
