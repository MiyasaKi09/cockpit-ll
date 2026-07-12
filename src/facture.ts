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
} from './types'
import { uid } from './util'

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
  const t = totauxLignes(b.lignes)
  if (!(t.ttc > 0) && !(t.ttc < 0)) bloquants.push('Le total de la facture est nul.')
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

export function soldeFacture(state: AppState, f: Facture): number {
  return Math.round((ttcFacture(f) - regleSurFacture(state, f.id)) * 100) / 100
}

export type EtatPaiement = 'payee' | 'partielle' | 'attente'

/** dérivé, jamais choisi : payée si le solde est nul, partielle si un
 *  règlement existe, en attente sinon (l'héritage « encaissée » = payée) */
export function etatPaiement(state: AppState, f: Facture): EtatPaiement {
  if (f.statut === 'encaissee' && regleSurFacture(state, f.id) === 0) return 'payee'
  const regle = regleSurFacture(state, f.id)
  const solde = soldeFacture(state, f)
  if (regle > 0 && solde <= 0.01) return 'payee'
  if (regle > 0) return 'partielle'
  return 'attente'
}

/** prépare un paiement affecté à une ou plusieurs factures (montants
 *  proposés = soldes, ajustables) — à construire AVANT update() */
export function nouveauPaiement(
  date: string,
  montant: number,
  affectations: { factureId: string; montant: number }[],
  reference?: string,
  moyen?: string,
): Paiement {
  return { id: uid('pay'), date, montant, moyen, reference, affectations }
}

// ---------- avoirs : la correction TRAÇABLE ----------

/** brouillon d'avoir (total ou partiel) depuis une facture émise — les
 *  lignes sont négatives et l'origine est référencée ; l'avoir suit le
 *  même parcours d'émission (numéro, gel, empreinte) */
export function brouillonAvoir(f: Facture, montantPartielHT?: number): LigneFacture[] {
  const numeroOrigine = f.figee?.numero || f.numero || f.id
  if (montantPartielHT != null) {
    return [
      {
        id: uid('lig'),
        designation: `Avoir partiel sur facture ${numeroOrigine}`,
        quantite: 1,
        unite: 'forfait',
        prixUnitaireHT: -Math.abs(montantPartielHT),
        tauxTVA: f.figee?.lignes[0]?.tauxTVA ?? f.tauxTVA,
      },
    ]
  }
  const lignes = f.figee?.lignes || [
    {
      id: uid('lig'),
      designation: f.libelle,
      quantite: 1,
      unite: 'forfait',
      prixUnitaireHT: f.montantHT,
      tauxTVA: f.tauxTVA,
    },
  ]
  return lignes.map((l) => ({
    ...l,
    id: uid('lig'),
    designation: `Avoir — ${l.designation} (facture ${numeroOrigine})`,
    prixUnitaireHT: -l.prixUnitaireHT,
  }))
}
