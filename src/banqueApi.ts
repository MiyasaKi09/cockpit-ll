// ============================================================
// Connexion bancaire directe — le versant navigateur de la fonction
// Edge `banque-sync` (GoCardless Bank Account Data, lecture seule).
//
// DEUX MOITIÉS, ET UNE RAISON DE LES SÉPARER
// -------------------------------------------
// 1. LA LOGIQUE PURE — normaliser les opérations, choisir un solde, dire
//    où en est un consentement. Aucun réseau, aucune horloge : `maintenant`
//    est un paramètre. `src/alerts.ts` l'importe pour annoncer la
//    reconnexion des 90 jours, et le fil d'urgences doit rester calculable
//    hors ligne, sur un état chargé du localStorage.
// 2. LE TRANSPORT — les appels à la fonction Edge. Ils reçoivent le client
//    Supabase EN PARAMÈTRE et ne vont pas le chercher : ce fichier reste
//    ainsi chargeable sans la pile réseau, ce qui est la condition pour que
//    le point 1 soit vrai.
//
// AUCUN SECRET NE PASSE ICI. Les identifiants GoCardless vivent dans les
// secrets de la fonction Edge (`Deno.env.get`) ; le navigateur ne connaît ni
// jeton, ni identifiant de compte GoCardless — il désigne un compte par
// l'identifiant de notre propre ligne.
//
// CE QU'IL N'Y A PAS ICI, ET C'EST VOULU : aucune intégration de mouvement.
// Les opérations rapatriées passent par `preparerImport` (src/banque.ts),
// déjà idempotent sur date + montant + libellé, appelé depuis le SEUL écran
// qui intègre un relevé (Banque & trésorerie). Un second chemin
// d'intégration serait le défaut D2 rouvert.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LigneRelevee } from './banque'
import type { CompteBancaireConnecte, ConnexionBancaire } from './types'
import { diffDays } from './util'

// ------------------------------------------------------------------
// Ce que la fonction Edge renvoie (aucun secret, aucun identifiant tiers)
// ------------------------------------------------------------------

export interface BanqueDisponible {
  id: string
  nom: string
  logo: string | null
}

/** un solde publié par la banque, tel quel */
export interface SoldePublie {
  montant: number
  /** `closingBooked`, `interimAvailable`… — la banque choisit ce qu'elle publie */
  type: string
  date: string | null
}

/** une opération au format Berlin Group, telle que la banque l'a rendue */
export type OperationBrute = Record<string, unknown>

export interface CompteSynchronise {
  id: string
  libelle: string | null
  ibanMasque: string | null
  devise?: string | null
  genre: 'ok' | 'reconnexion' | 'patienter' | 'quota' | 'portee' | 'indisponible' | 'autre'
  message: string
  quotaRestant?: string | null
  typesSoldeVus?: string[]
  soldes: SoldePublie[]
  operations: OperationBrute[]
  fenetre?: { debut: string; fin: string }
}

export interface ResultatConnexion {
  connexionId: string
  banque: string
  genre: 'ok' | 'reconnexion' | 'autre'
  message: string
  comptes: CompteSynchronise[]
}

/** la connexion vue par le serveur — miroir avant fusion avec le local */
export interface ConnexionDistante {
  id: string
  banque: string
  statut: string
  statutGocardless: string | null
  accesJours: number | null
  consentementAccepteLe: string | null
  consentementExpireLe: string | null
  derniereLectureLe: string | null
  derniereLectureOk: boolean | null
  derniereLectureResultat: string | null
  comptes: {
    id: string
    libelle: string | null
    ibanMasque: string | null
    devise: string | null
    statut: string | null
    dernierSolde: number | null
    dernierSoldeType: string | null
    dernierSoldeDate: string | null
    typesSoldeVus: string[]
  }[]
}

export interface StatutBanque {
  /** les identifiants GoCardless sont-ils posés dans les secrets de la fonction ? */
  configure: boolean
  connexions: ConnexionDistante[]
}

// ==================================================================
// 1. LOGIQUE PURE
// ==================================================================

// ------------------------------------------------------------------
// Le solde : il n'existe pas de champ « le solde »
// ------------------------------------------------------------------

/**
 * L'ordre de préférence des types de solde.
 *
 * Berlin Group en définit une quinzaine et CHAQUE banque décide de ceux
 * qu'elle publie : `balances` est un tableau, jamais une valeur. Pour un
 * solde de fin de relevé — celui qui cale la trésorerie du Cockpit — le
 * comptable prime sur le disponible : `closingBooked` d'abord, le disponible
 * seulement en repli, parce qu'il inclut découvert et opérations non
 * comptabilisées et ne se compare donc pas au relevé.
 */
export const ORDRE_SOLDES = [
  'closingBooked',
  'interimBooked',
  'closingCleared',
  'interimCleared',
  'closingAvailable',
  'interimAvailable',
  'expected',
  'forwardAvailable',
  'openingBooked',
  'openingCleared',
  'openingAvailable',
] as const

/** Ces deux-là ne sont pas des soldes de compte : les prendre pour tels
 *  afficherait un montant qui ne veut rien dire. */
const TYPES_NON_SOLDE = new Set(['information', 'nonInvoiced'])

export interface SoldeChoisi {
  montant: number
  type: string
  /** `null` quand la banque ne date pas son solde — seuls `balanceAmount` et
   *  `balanceType` sont garantis par le schéma */
  date: string | null
  /** faux quand le type ne figure pas dans la cascade connue : le montant
   *  reste affiché, mais l'écran dit qu'il vient d'un type inhabituel */
  attendu: boolean
}

/**
 * Le solde retenu parmi ceux que la banque publie — ou `null`.
 *
 * `null` veut dire « la banque n'a rien publié d'exploitable », jamais 0.
 * C'est exactement le défaut corrigé au lot D2 : un import qui enregistrait
 * un solde absent laissait la trésorerie sur une valeur ancienne, sans un mot.
 */
export function choisirSolde(soldes: SoldePublie[]): SoldeChoisi | null {
  const utilisables = (Array.isArray(soldes) ? soldes : []).filter(
    (s) => s && typeof s.type === 'string' && Number.isFinite(s.montant) && !TYPES_NON_SOLDE.has(s.type),
  )
  if (utilisables.length === 0) return null
  for (const type of ORDRE_SOLDES) {
    const trouve = utilisables.find((s) => s.type === type)
    if (trouve) return { montant: trouve.montant, type: trouve.type, date: trouve.date ?? null, attendu: true }
  }
  // Type inconnu de la cascade : on prend le premier publié plutôt que de
  // perdre un solde réel, et on le SIGNALE — l'écran affiche le type.
  const premier = utilisables[0]
  return { montant: premier.montant, type: premier.type, date: premier.date ?? null, attendu: false }
}

// ------------------------------------------------------------------
// Les opérations : le même libellé que le fichier, sinon rien ne dédoublonne
// ------------------------------------------------------------------

function texte(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.trim() ? valeur : null
}

function premierTexte(operation: OperationBrute, noms: string[]): string | null {
  for (const nom of noms) {
    const brut = operation[nom]
    const direct = texte(brut)
    if (direct) return direct
    if (Array.isArray(brut)) {
      const joint = brut.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).join(' ')
      if (joint.trim()) return joint
    }
    if (brut && typeof brut === 'object') {
      // `remittanceInformationStructured` peut arriver sous forme d'objet
      const reference = texte((brut as Record<string, unknown>).reference)
      if (reference) return reference
    }
  }
  return null
}

function nomDeTiers(operation: OperationBrute): string | null {
  return texte(operation.creditorName) || texte(operation.debtorName)
}

/**
 * Berlin Group → `LigneRelevee`, EXACTEMENT comme `lireCAMT053`.
 *
 * C'EST LE POINT DE RUPTURE LE PLUS PROBABLE DE CETTE LIVRAISON, et il ne
 * ressemble pas à une panne : l'idempotence du dépôt tient sur la clé
 * `date + montant + libellé` (`idsTransactions`, src/banque.ts). Si l'API
 * fabrique un libellé différent de celui du fichier CAMT.053 de la même
 * banque, le même mouvement entre DEUX FOIS et rien ne le dit.
 *
 * D'où l'ordre ci-dessous, copié sur `lireCAMT053` champ par champ :
 *   · date    : `bookingDate` (= BookgDt) puis `valueDate` (= ValDt) ;
 *   · montant : `transactionAmount.amount`, signé, arrondi au centime ;
 *   · libellé : `remittanceInformationUnstructured` (= Ustrd), puis
 *     `additionalInformation` (= AddtlNtryInf / AddtlTxInf), puis le nom du
 *     tiers, puis « Mouvement » — même repli, même normalisation des
 *     espaces, même troncature à 140 caractères.
 *
 * `transactionId` n'entre PAS dans la clé : le schéma ne le garantit pas, et
 * une clé qui disparaît un jour sur deux ne dédoublonne rien.
 */
export function operationsVersLignes(operations: OperationBrute[]): {
  lignes: LigneRelevee[]
  ignorées: number
} {
  const lignes: LigneRelevee[] = []
  let ignorées = 0
  for (const operation of Array.isArray(operations) ? operations : []) {
    if (!operation || typeof operation !== 'object') {
      ignorées++
      continue
    }
    const dateBrute =
      texte(operation.bookingDate) ||
      texte(operation.bookingDateTime) ||
      texte(operation.valueDate) ||
      texte(operation.valueDateTime)
    const date = dateBrute ? dateBrute.slice(0, 10) : ''
    const montantSource = (operation.transactionAmount as Record<string, unknown> | undefined)?.amount
    const montant = Number(montantSource)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(montant)) {
      ignorées++
      continue
    }
    const libelle = (
      premierTexte(operation, [
        'remittanceInformationUnstructured',
        'remittanceInformationUnstructuredArray',
        'additionalInformation',
        'remittanceInformationStructured',
        'remittanceInformationStructuredArray',
      ]) ||
      nomDeTiers(operation) ||
      'Mouvement'
    )
      .replace(/\s+/g, ' ')
      .trim()
    lignes.push({ date, montant: Math.round(montant * 100) / 100, libelle: libelle.slice(0, 140) })
  }
  return { lignes, ignorées }
}

// ------------------------------------------------------------------
// Consentement et fraîcheur — les deux façons de figer une trésorerie
// ------------------------------------------------------------------

/** On prévient une semaine avant, pas le jour où tout est déjà bloqué. */
export const SEUIL_RECONNEXION_JOURS = 7

/** Au-delà, une connexion « active » qui n'a rien rapporté n'est plus du
 *  calme : c'est un silence. */
export const SEUIL_SYNCHRO_MUETTE_JOURS = 7

/** Et au-delà de trois semaines, c'est le scénario que le lot voulait rendre
 *  impossible : la trésorerie affichée n'a plus aucun rapport avec la banque. */
export const SEUIL_SYNCHRO_MORTE_JOURS = 21

export interface EtatConsentement {
  /** la date d'expiration est-elle connue ? `null` n'est pas « lointaine » */
  connu: boolean
  /** jours restants (négatif = dépassé) ; `null` quand inconnue */
  jours: number | null
  /** l'accès est perdu : plus rien ne rentrera sans reconnexion */
  expire: boolean
  /** faut-il le dire dans le fil d'urgences ? */
  alerter: boolean
}

/**
 * Où en est le consentement DSP2 d'une connexion.
 *
 * Pure : `aujourdhui` en paramètre. C'est LA seule autorité sur cette
 * question — l'écran de Banque et le fil d'urgences l'appellent tous les
 * deux, et ne comptent pas les jours chacun de leur côté.
 */
export function etatConsentement(connexion: ConnexionBancaire, aujourdhui: string): EtatConsentement {
  if (connexion.statut === 'expiree') return { connu: true, jours: 0, expire: true, alerter: true }
  if (connexion.statut !== 'liee') return { connu: false, jours: null, expire: false, alerter: false }
  const echeance = connexion.consentementExpireLe ? connexion.consentementExpireLe.slice(0, 10) : null
  if (!echeance) {
    // Expiration inconnue : on ne fabrique pas de date rassurante, et on
    // n'alerte pas non plus — l'écran, lui, le dit noir sur blanc.
    return { connu: false, jours: null, expire: false, alerter: false }
  }
  const jours = diffDays(aujourdhui, echeance)
  return { connu: true, jours, expire: jours <= 0, alerter: jours <= SEUIL_RECONNEXION_JOURS }
}

export interface EtatSynchronisation {
  /** jours depuis la dernière synchronisation intégrée ; `null` si la
   *  connexion n'est pas encore établie */
  jours: number | null
  /** aucune synchronisation n'a jamais abouti */
  jamais: boolean
  alerter: boolean
  /** silence de plus de trois semaines */
  morte: boolean
}

/**
 * Depuis combien de temps cette connexion n'a-t-elle rien rapporté ?
 *
 * Une synchronisation morte ne produit aucune erreur : elle produit un écran
 * calme. C'est pour ça qu'on la mesure au lieu de l'attendre.
 */
export function etatSynchronisation(connexion: ConnexionBancaire, aujourdhui: string): EtatSynchronisation {
  if (connexion.statut !== 'liee') return { jours: null, jamais: !connexion.derniereSyncLe, alerter: false, morte: false }
  const depart =
    connexion.derniereSyncLe ||
    (connexion.consentementAccepteLe ? connexion.consentementAccepteLe.slice(0, 10) : null) ||
    connexion.vuLe
  if (!depart) return { jours: null, jamais: true, alerter: false, morte: false }
  const jours = diffDays(depart, aujourdhui)
  return {
    jours,
    jamais: !connexion.derniereSyncLe,
    alerter: jours > SEUIL_SYNCHRO_MUETTE_JOURS,
    morte: jours > SEUIL_SYNCHRO_MORTE_JOURS,
  }
}

/** libellé français d'un statut de connexion — un seul endroit le décide */
export function libelleStatutConnexion(statut: ConnexionBancaire['statut']): string {
  if (statut === 'liee') return 'connectée'
  if (statut === 'expiree') return 'à reconnecter'
  if (statut === 'en_attente') return 'en attente de votre banque'
  return 'en erreur'
}

// ------------------------------------------------------------------
// Fusion serveur → miroir local
// ------------------------------------------------------------------

function statutLocal(statut: string): ConnexionBancaire['statut'] {
  return statut === 'liee' || statut === 'expiree' || statut === 'en_attente' ? statut : 'erreur'
}

function compteLocal(
  c: ConnexionDistante['comptes'][number],
  locale: CompteBancaireConnecte | undefined,
): CompteBancaireConnecte {
  // Le solde retenu est un CHOIX du Cockpit (cascade de types) : il remonte
  // au serveur par `confirmerSynchronisation`. Si cette confirmation n'a pas
  // pu partir — hors ligne, onglet fermé — le serveur n'a rien, et rafraîchir
  // le miroir effacerait un solde parfaitement valable. On garde donc le
  // local tant que le serveur ne dit rien ; sa date part avec lui, personne
  // ne peut le prendre pour frais.
  const solde = c.dernierSolde ?? locale?.dernierSolde ?? null
  const memeSource = c.dernierSolde != null
  return {
    id: c.id,
    libelle: c.libelle ?? null,
    ibanMasque: c.ibanMasque ?? null,
    devise: c.devise ?? null,
    statut: c.statut ?? null,
    dernierSolde: solde,
    dernierSoldeType: memeSource ? c.dernierSoldeType ?? null : locale?.dernierSoldeType ?? null,
    dernierSoldeDate: memeSource ? c.dernierSoldeDate ?? null : locale?.dernierSoldeDate ?? null,
    typesSoldeVus: Array.isArray(c.typesSoldeVus) && c.typesSoldeVus.length > 0
      ? c.typesSoldeVus
      : locale?.typesSoldeVus ?? [],
  }
}

/**
 * Le miroir local, rafraîchi depuis le serveur.
 *
 * `derniereSyncLe` est CONSERVÉ depuis le local : côté serveur, la date dit
 * « la banque a répondu » ; ici, elle dit « les mouvements sont entrés dans
 * le Cockpit ». Ce n'est pas la même chose, et c'est la seconde qui compte
 * pour savoir si la trésorerie affichée vaut quelque chose.
 */
export function fusionnerConnexions(
  locales: ConnexionBancaire[],
  distantes: ConnexionDistante[],
  vuLe: string,
): ConnexionBancaire[] {
  const parId = new Map((Array.isArray(locales) ? locales : []).map((c) => [c.id, c]))
  return (Array.isArray(distantes) ? distantes : []).map((d) => {
    const locale = parId.get(d.id)
    const comptesLocaux = new Map((locale?.comptes || []).map((c) => [c.id, c]))
    return {
      id: d.id,
      banque: d.banque,
      statut: statutLocal(d.statut),
      statutGocardless: d.statutGocardless ?? null,
      accesJours: d.accesJours ?? null,
      consentementAccepteLe: d.consentementAccepteLe ?? null,
      consentementExpireLe: d.consentementExpireLe ?? null,
      derniereSyncLe: locale?.derniereSyncLe ?? null,
      derniereSyncResultat: locale?.derniereSyncResultat ?? d.derniereLectureResultat ?? null,
      vuLe,
      comptes: (Array.isArray(d.comptes) ? d.comptes : []).map((c) => compteLocal(c, comptesLocaux.get(c.id))),
    }
  })
}

// ==================================================================
// 2. TRANSPORT — le client Supabase est PASSÉ, jamais importé
// ==================================================================

/** Message d'erreur LISIBLE : sans cela, une fonction qui répond 502 avec
 *  une phrase en français fait afficher « Edge Function returned a non-2xx
 *  status code », et on cherche la panne partout sauf là où elle est. */
async function messageDeLaFonction(erreur: unknown, defaut: string): Promise<string> {
  const contexte = (erreur as { context?: { json?: () => Promise<unknown> } } | null)?.context
  if (contexte && typeof contexte.json === 'function') {
    try {
      const corps = (await contexte.json()) as { erreur?: string } | null
      if (corps && typeof corps.erreur === 'string' && corps.erreur) return corps.erreur
    } catch {
      /* le corps n'est pas du JSON : le message par défaut reste plus utile */
    }
  }
  return erreur instanceof Error && erreur.message ? erreur.message : defaut
}

async function appeler<T>(sb: SupabaseClient, corps: Record<string, unknown>, defaut: string): Promise<T> {
  const { data, error } = await sb.functions.invoke('banque-sync', { method: 'POST', body: corps })
  if (error) throw new Error(await messageDeLaFonction(error, defaut))
  return data as T
}

/** état des connexions, sans aucun secret */
export function lireStatutBanque(sb: SupabaseClient): Promise<StatutBanque> {
  return appeler<StatutBanque>(sb, { action: 'statut' }, 'Statut bancaire illisible.')
}

/** les établissements d'un pays (ISO 3166 à deux lettres) */
export function listerBanques(sb: SupabaseClient, pays = 'FR'): Promise<{ banques: BanqueDisponible[] }> {
  return appeler<{ banques: BanqueDisponible[] }>(sb, { action: 'banques', pays }, 'Liste des banques indisponible.')
}

/** crée la demande et rend l'adresse vers laquelle la personne part
 *  s'authentifier chez sa banque */
export function demarrerConnexionBancaire(
  sb: SupabaseClient,
  institution: BanqueDisponible,
  jours = 90,
): Promise<{ connexionId: string; lien: string; connexions: ConnexionDistante[] }> {
  return appeler(
    sb,
    { action: 'connecter', institutionId: institution.id, institutionNom: institution.nom, jours },
    'Connexion bancaire impossible.',
  )
}

/**
 * Relance le parcours banque sur une connexion existante.
 *
 * La DSP2 n'offre aucune prolongation exploitable pour des banques
 * françaises : se reconnecter, c'est refaire le parcours. La connexion garde
 * son identifiant — c'est celui que porte l'alerte du fil d'urgences.
 */
export function reconnecterBanque(
  sb: SupabaseClient,
  connexionId: string,
  jours = 90,
): Promise<{ connexionId: string; lien: string; connexions: ConnexionDistante[] }> {
  return appeler(sb, { action: 'reconnecter', connexionId, jours }, 'Reconnexion impossible.')
}

/** relit les demandes en attente : c'est le retour de la banque */
export function finaliserConnexions(
  sb: SupabaseClient,
  connexionId?: string,
): Promise<{ connexions: ConnexionDistante[] }> {
  return appeler(sb, { action: 'finaliser', connexionId }, 'Finalisation impossible.')
}

/** rapatrie opérations ET soldes (la fenêtre est fixe : voir Banque.tsx) */
export function synchroniserBanque(
  sb: SupabaseClient,
  connexionId?: string,
  jours = 90,
): Promise<{ resultats: ResultatConnexion[]; connexions: ConnexionDistante[] }> {
  return appeler(sb, { action: 'synchroniser', connexionId, jours }, 'Synchronisation bancaire impossible.')
}

/** un solde retenu par le Cockpit, renvoyé au serveur pour que l'autre poste
 *  le voie sans avoir synchronisé */
export interface SoldeRetenu {
  /** identifiant de la ligne `banque_comptes` */
  id: string
  solde: number | null
  type: string | null
  date: string | null
}

/** dit au serveur ce qui est RÉELLEMENT entré au Cockpit */
export function confirmerSynchronisation(
  sb: SupabaseClient,
  connexionId: string,
  resultat: string,
  comptes: SoldeRetenu[] = [],
): Promise<{ connexions: ConnexionDistante[] }> {
  return appeler(sb, { action: 'confirmer', connexionId, resultat, comptes }, 'Confirmation impossible.')
}

/** supprime la demande chez GoCardless et la connexion ici */
export function deconnecterBanque(
  sb: SupabaseClient,
  connexionId: string,
): Promise<{ connexions: ConnexionDistante[] }> {
  return appeler(sb, { action: 'deconnecter', connexionId }, 'Déconnexion impossible.')
}
