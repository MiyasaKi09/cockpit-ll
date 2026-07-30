// ============================================================
// Synchronisation Supabase (offre gratuite) — couche « sans React »,
// calquée sur google.ts : un singleton module, aucun import React,
// des messages d'erreur français. On branche Supabase DERRIÈRE la
// persistance du store : un seul document JSON = tout l'état de
// l'agence, partagé entre les 2 postes en temps réel.
//
// Local-first préservé : si non connecté / hors-ligne, tout continue
// en localStorage. Les échecs restent visibles et rejouables, sans bloquer
// les saisies locales.
// ============================================================

import type { RealtimeChannel, Session, SupabaseClient } from '@supabase/supabase-js'
import type { AppState } from './types'
import {
  cibleSynchronisation,
  etatPartageable,
  namespaceSynchronisation,
  type ConfigSyncMinimale,
} from './syncState'
import {
  MESSAGE_RECUPERATION_LOCALE,
  marquerRecuperationLocaleRequise,
  recuperationLocaleRequise,
} from './syncSafety'

const TABLE = 'workspace'

// ----- état module (aucun état React ici) -----
let clientPromise: Promise<SupabaseClient> | null = null
let client: SupabaseClient | null = null
let clientConfig = ''
let session: Session | null = null
let workspaceId = ''
let namespaceLocale = ''
let channel: RealtimeChannel | null = null
let onRemoteCourant: ((s: AppState) => boolean | void) | null = null
let authSubscription: { unsubscribe: () => void } | null = null
let revisionCourante: number | null = null
let derniereSync: string | null = null
let derniereErreur: string | null = null
let envoiEnCours = false
let generationConnexion = 0
let generationConfiguration = 0
let configurationSync = ''
let refetchRealtimeEnCours: Promise<void> | null = null
let refetchRealtimeARejouer = false
let onStatutCourant: ((erreur: string | null) => void) | null = null
let deconnexionEnCours: Promise<void> | null = null

// ----- session observable -----
// La session existait déjà, mais seulement en lecture ponctuelle : une
// connexion par lien magique ne re-rendait aucun écran. On publie donc un
// instantané immuable, et tout écrivain de `session` passe par
// `definirSession` — sinon l'interface cesse d'être avertie, en silence.
export interface InstantaneSession {
  connecte: boolean
  email: string | null
}
/** l'objet est remplacé, jamais muté : `useSyncExternalStore` compare
 *  les références et bouclerait à l'infini sur un objet neuf à chaque appel */
let instantaneCourant: InstantaneSession = { connecte: false, email: null }
const abonnesSession = new Set<() => void>()

/** unique point d'écriture de la session — publie l'instantané et prévient */
function definirSession(s: Session | null): void {
  session = s
  publierSession()
}

/** recalcule l'instantané (la session ET le client comptent) et notifie */
function publierSession(): void {
  const connecte = client !== null && session !== null
  const email = session?.user?.email ?? null
  if (connecte === instantaneCourant.connecte && email === instantaneCourant.email) return
  instantaneCourant = { connecte, email }
  for (const abonne of [...abonnesSession]) {
    try {
      abonne()
    } catch {
      /* un abonné en échec ne doit pas priver les autres de la notification */
    }
  }
}

/** état de session pour les composants — référence stable entre deux changements */
export function instantaneSession(): InstantaneSession {
  return instantaneCourant
}

/** s'abonner aux changements de session (connexion, déconnexion, expiration).
 *  Renvoie la fonction de désabonnement. */
export function abonnerSession(ecouteur: () => void): () => void {
  abonnesSession.add(ecouteur)
  return () => {
    abonnesSession.delete(ecouteur)
  }
}

/** identifiant de CETTE instance de page — deux onglets doivent rester distincts. */
const CLE_CONFLIT = 'cockpit-ll-sync-conflit'
const CLE_EN_ATTENTE = 'cockpit-ll-sync-en-attente'
const CLE_REVISION = 'cockpit-ll-sync-revision'
const MESSAGE_CONFLIT =
  'Conflit de synchronisation : un autre poste a modifié les données. Vos changements restent locaux ; exportez-les avant de choisir une version.'
const MON_ID =
  crypto.randomUUID?.() ?? `c-${Date.now()}-${Math.floor(Math.random() * 1e9)}`

function cleConflitCourante(): string {
  return cleLocale(CLE_CONFLIT)
}

function cleLocale(prefixe: string): string {
  return `${prefixe}:${namespaceLocale || 'inconnu'}`
}

function cleLocalePour(prefixe: string, config: ConfigSyncMinimale): string | null {
  const espace = namespaceSynchronisation(config)
  return espace ? `${prefixe}:${espace}` : null
}

function lireRevisionLocale(): number | null {
  if (!workspaceId) return null
  try {
    const brute = localStorage.getItem(cleLocale(CLE_REVISION))
    if (brute === null) return null
    const valeur = Number(brute)
    return Number.isSafeInteger(valeur) && valeur >= 0 ? valeur : null
  } catch {
    return null
  }
}

function ecrireRevisionLocale(revision: number | null): void {
  try {
    if (revision === null) localStorage.removeItem(cleLocale(CLE_REVISION))
    else localStorage.setItem(cleLocale(CLE_REVISION), String(revision))
  } catch {
    /* la révision reste au moins disponible en mémoire */
  }
}

function etatLocalEnAttente(): boolean {
  if (!workspaceId) return false
  try {
    return localStorage.getItem(cleLocale(CLE_EN_ATTENTE)) !== null
  } catch {
    return false
  }
}

export function marquerEtatLocalEnAttente(config?: ConfigSyncMinimale | null): void {
  const cle = config ? cleLocalePour(CLE_EN_ATTENTE, config) : cleLocale(CLE_EN_ATTENTE)
  if (!cle || (!config && !workspaceId)) return
  try {
    localStorage.setItem(cle, new Date().toISOString())
  } catch {
    /* le statut en mémoire signalera encore l'échec de push */
  }
}

export function etatLocalEnAttentePour(config: ConfigSyncMinimale | null | undefined): boolean {
  if (!config) return false
  const cle = cleLocalePour(CLE_EN_ATTENTE, config)
  if (!cle) return false
  try {
    return localStorage.getItem(cle) !== null
  } catch {
    return false
  }
}

function effacerEtatLocalEnAttente(): void {
  try {
    localStorage.removeItem(cleLocale(CLE_EN_ATTENTE))
  } catch {
    /* rien d'autre à effacer */
  }
}

function conflitSyncPersistant(): boolean {
  if (!workspaceId) return false
  try {
    return localStorage.getItem(cleConflitCourante()) !== null
  } catch {
    return false
  }
}

function marquerConflitSync(): void {
  try {
    localStorage.setItem(cleConflitCourante(), new Date().toISOString())
  } catch {
    /* la bannière en mémoire reste active même si le marqueur local échoue */
  }
}

export function effacerConflitSync(): void {
  try {
    localStorage.removeItem(cleConflitCourante())
  } catch {
    /* rien d'autre à effacer */
  }
  derniereErreur = null
}

export function signalerConflitSync(): string {
  marquerEtatLocalEnAttente()
  marquerConflitSync()
  derniereErreur = MESSAGE_CONFLIT
  return MESSAGE_CONFLIT
}

export function signalerRecuperationLocaleRequise(): string {
  marquerRecuperationLocaleRequise()
  marquerEtatLocalEnAttente()
  marquerConflitSync()
  derniereErreur = MESSAGE_RECUPERATION_LOCALE
  return MESSAGE_RECUPERATION_LOCALE
}

// ----- helpers -----

/** client Supabase mémoïsé (import dynamique, comme xlsx) — rejoue si l'import échoue.
 *  La mémoïsation tient compte du projet : changer URL ou clé ne doit jamais
 *  réutiliser silencieusement la session du projet précédent. */
async function obtenirClient(url: string, anonKey: string): Promise<SupabaseClient> {
  const config = `${url}\u0000${anonKey}`
  if (clientPromise && clientConfig !== config) {
    try {
      if (channel && client) await client.removeChannel(channel)
    } catch {
      /* l'ancien canal peut déjà être fermé */
    }
    authSubscription?.unsubscribe()
    clientPromise = null
    client = null
    definirSession(null)
    channel = null
    authSubscription = null
    workspaceId = ''
    namespaceLocale = ''
    revisionCourante = null
  }
  if (!clientPromise) {
    clientConfig = config
    const promesse = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }),
    )
    clientPromise = promesse
    promesse.catch(() => {
      if (clientPromise === promesse) {
        clientPromise = null // permet une nouvelle tentative
        clientConfig = ''
      }
    })
  }
  return clientPromise
}

export interface ResultatPush {
  ok: boolean
  conflit?: boolean
  erreur?: string
  revision?: number
}

// ----- API exportée -----

export function syncActif(): boolean {
  return instantaneCourant.connecte
}

/** client Supabase courant (null tant que la session n'est pas ouverte) —
 *  pour les modules qui portent leurs propres tables (boîte d'arrivée
 *  partagée, fonctions d'ingestion). L'accès reste verrouillé par RLS. */
export function clientSupabase(): SupabaseClient | null {
  return syncActif() ? client : null
}

export function syncEtat(): {
  connecte: boolean
  email: string | null
  derniereSync: string | null
  erreur: string | null
  conflit: boolean
  localEnAttente: boolean
  recuperationLocaleRequise: boolean
} {
  return {
    connecte: syncActif(),
    email: instantaneCourant.email,
    derniereSync,
    erreur: derniereErreur,
    conflit: conflitSyncPersistant(),
    localEnAttente: etatLocalEnAttente(),
    recuperationLocaleRequise: recuperationLocaleRequise(),
  }
}

export function cibleSyncCourante(): string | null {
  return configurationSync || null
}

export function adopterRevisionDistante(
  revision: number | null,
  updatedAt?: string | null,
): void {
  memoriserRevision(revision, updatedAt)
  effacerEtatLocalEnAttente()
  derniereErreur = null
}

/** Avance le verrou local sans déclarer que le dernier état métier est envoyé.
 *  C'est notamment nécessaire quand l'accusé d'un push arrive alors qu'une
 *  seconde modification locale attend encore dans la file. */
function memoriserRevision(revision: number | null, updatedAt?: string | null): void {
  revisionCourante =
    revision !== null && Number.isSafeInteger(revision) && revision >= 0 ? revision : null
  ecrireRevisionLocale(revisionCourante)
  if (updatedAt) derniereSync = updatedAt
}

/** crée le client, restaure une session existante (reprise après reload) et
 *  branche le ré-abonnement automatique au retour du lien magique */
export async function connecterSync(url: string, anonKey: string, ws: string): Promise<void> {
  if (!url.trim() || !anonKey.trim() || !ws.trim()) {
    throw new Error('Renseignez l’URL du projet, la clé publique et l’identifiant d’espace.')
  }
  if (deconnexionEnCours) await deconnexionEnCours
  derniereErreur = null
  const configDemandee = {
    url: url.trim(),
    anonKey: anonKey.trim(),
    workspaceId: ws.trim(),
  }
  const configurationDemandee = cibleSynchronisation(configDemandee)
  if (!configurationDemandee)
    throw new Error('La configuration Supabase est incomplète.')
  if (configurationDemandee !== configurationSync) {
    configurationSync = configurationDemandee
    generationConfiguration++
  }
  const generationConfig = generationConfiguration
  const generation = ++generationConnexion
  const prochainWorkspace = ws.trim()
  let nouveauClient: SupabaseClient
  try {
    nouveauClient = await obtenirClient(url.trim(), anonKey.trim())
  } catch {
    throw new Error('Impossible de charger le client Supabase (connexion ?).')
  }
  if (
    generation !== generationConnexion ||
    generationConfig !== generationConfiguration
  )
    throw new Error('La configuration Supabase a changé pendant la connexion.')

  if (workspaceId && workspaceId !== prochainWorkspace) {
    try {
      if (channel && client) await client.removeChannel(channel)
    } catch {
      /* le canal peut déjà être fermé */
    }
    channel = null
  }
  client = nouveauClient
  // le client compte dans « connecté » : republier tout de suite, sinon
  // l'instantané resterait faux jusqu'au prochain changement de session
  publierSession()
  workspaceId = prochainWorkspace
  // Les révisions/conflits appartiennent à un projet Supabase précis, pas
  // seulement au libellé d'espace qui peut être réutilisé ailleurs.
  namespaceLocale = namespaceSynchronisation(configDemandee) || ''
  revisionCourante = lireRevisionLocale()

  const { data, error } = await nouveauClient.auth.getSession()
  if (
    generation !== generationConnexion ||
    generationConfig !== generationConfiguration
  )
    throw new Error('La configuration Supabase a changé pendant la connexion.')
  if (error) throw new Error(`Session Supabase illisible : ${error.message}`)
  definirSession(data.session)

  if (!authSubscription) {
    const generationAbonnement = generationConfiguration
    const clientAbonne = nouveauClient
    const { data: abonnement } = nouveauClient.auth.onAuthStateChange((_evt, s) => {
      if (
        generationAbonnement !== generationConfiguration ||
        client !== clientAbonne
      )
        return
      definirSession(s)
      // au retour du lien magique (SIGNED_IN), on (re)branche le temps réel
      if (s && onRemoteCourant && !channel) souscrire()
    })
    authSubscription = abonnement.subscription
  }
}

/** envoie le lien magique (OTP e-mail) — geste utilisateur */
export async function envoyerLienMagique(email: string): Promise<void> {
  if (!client) throw new Error('Connectez d’abord le projet Supabase (URL + clé).')
  if (envoiEnCours) return
  if (!email.trim()) throw new Error('Renseignez votre adresse e-mail.')
  envoiEnCours = true
  try {
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    })
    if (error) throw new Error(`Envoi impossible : ${error.message}`)
  } finally {
    envoiEnCours = false
  }
}

export async function deconnecterSync(): Promise<void> {
  if (deconnexionEnCours) return deconnexionEnCours
  const ancienClient = client
  const ancienCanal = channel
  generationConnexion++
  generationConfiguration++
  channel = null
  client = null
  definirSession(null)
  revisionCourante = null
  refetchRealtimeARejouer = false
  authSubscription?.unsubscribe()
  authSubscription = null

  const travail = (async () => {
    try {
      if (ancienCanal && ancienClient) await ancienClient.removeChannel(ancienCanal)
    } catch {
      /* ignore */
    }
    if (ancienClient) {
      try {
        await ancienClient.auth.signOut()
      } catch {
        /* ignore */
      }
    }
  })()
  deconnexionEnCours = travail
  try {
    await travail
  } finally {
    if (deconnexionEnCours === travail) deconnexionEnCours = null
  }
}

/** Jeton de la session courante, destiné uniquement aux routes serveur du Cockpit.
 *  Le serveur le revalide auprès de Supabase avant chaque appel sensible. */
export async function jetonAccesSync(): Promise<string | null> {
  if (!client) return null
  const clientAuDepart = client
  const generationAuDepart = generationConfiguration
  const { data, error } = await clientAuDepart.auth.getSession()
  if (
    generationAuDepart !== generationConfiguration ||
    client !== clientAuDepart
  )
    return null
  if (error || !data.session) {
    definirSession(null)
    return null
  }
  definirSession(data.session)
  return data.session.access_token
}

function demanderRefetchRealtime(): void {
  if (refetchRealtimeEnCours) {
    refetchRealtimeARejouer = true
    return
  }
  const generation = generationConfiguration
  const espace = workspaceId
  refetchRealtimeEnCours = (async () => {
    do {
      refetchRealtimeARejouer = false
      const resultat = await tirerEtat(false)
      if (generation !== generationConfiguration || espace !== workspaceId || !resultat) return
      const revision = Number(resultat.revision)
      if (
        !Number.isSafeInteger(revision) ||
        revision < 0 ||
        (revisionCourante !== null && revision <= revisionCourante)
      )
        continue
      const recevoir = onRemoteCourant
      if (!recevoir) return
      const accepte = recevoir(resultat.data)
      if (accepte !== false) adopterRevisionDistante(revision, resultat.updated_at)
    } while (refetchRealtimeARejouer)
  })()
    .catch((e) => {
      const erreur = e instanceof Error ? e.message : String(e)
      derniereErreur = erreur
      onStatutCourant?.(erreur)
    })
    .finally(() => {
      refetchRealtimeEnCours = null
      if (refetchRealtimeARejouer && onRemoteCourant) demanderRefetchRealtime()
    })
}

/** (ré)abonnement temps réel à la ligne de l'espace partagé */
function souscrire(): void {
  if (!client) return
  if (channel) {
    // idempotence : on retire l'abonnement existant avant d'en recréer un
    client.removeChannel(channel)
    channel = null
  }
  const generationAbonnement = generationConfiguration
  const espaceAbonnement = workspaceId
  channel = client
    .channel(`ws-${espaceAbonnement}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE, filter: `id=eq.${espaceAbonnement}` },
      (payload) => {
        if (
          generationAbonnement !== generationConfiguration ||
          espaceAbonnement !== workspaceId
        )
          return
        const row = payload.new as { data?: AppState; updated_by?: string; revision?: number } | null
        if (!row) return
        const revision = Number(row.revision)
        if (!Number.isSafeInteger(revision) || revision < 0) {
          demanderRefetchRealtime()
          return
        }
        // anti-écho A : on ignore NOS propres écritures (comparé au contenu, robuste)
        if (row.updated_by === MON_ID) {
          if (revisionCourante === null || revision > revisionCourante)
            memoriserRevision(revision, new Date().toISOString())
          return
        }
        // Une livraison tardive ne doit jamais faire régresser l'état accepté.
        if (revisionCourante !== null && revision <= revisionCourante) return
        if (row.data) {
          const recevoir = onRemoteCourant
          if (!recevoir) return
          const accepte = recevoir(row.data)
          if (accepte !== false) {
            adopterRevisionDistante(revision, new Date().toISOString())
          }
        } else {
          // payload tronqué (blob volumineux) → on refait un tirage complet
          demanderRefetchRealtime()
        }
      },
    )
    .subscribe((statut) => {
      if (
        generationAbonnement !== generationConfiguration ||
        espaceAbonnement !== workspaceId
      )
        return
      if (statut === 'SUBSCRIBED') {
        derniereErreur = null
        onStatutCourant?.(null)
        // Rattrape les changements survenus pendant une coupure Realtime.
        demanderRefetchRealtime()
        return
      }
      if (statut === 'CHANNEL_ERROR' || statut === 'TIMED_OUT') {
        const erreur = `Synchronisation temps réel indisponible (${statut}).`
        derniereErreur = erreur
        onStatutCourant?.(erreur)
      }
    })
}

/** démarre le temps réel ; retourne la fonction d'arrêt (cleanup d'effet) */
export function demarrerRealtime(
  onRemote: (s: AppState) => boolean | void,
  onStatut?: (erreur: string | null) => void,
): () => void {
  onRemoteCourant = onRemote
  onStatutCourant = onStatut ?? null
  if (session) souscrire()
  // sinon : le listener onAuthStateChange s'en chargera à la connexion
  return () => {
    onRemoteCourant = null
    onStatutCourant = null
    refetchRealtimeARejouer = false
    if (channel && client) client.removeChannel(channel)
    channel = null
  }
}

/** Réactive le canal après une reconnexion manuelle, une fois la
 *  réconciliation pull/CAS terminée. */
export function relancerRealtime(): void {
  if (session && onRemoteCourant) souscrire()
}

/** Pousse l'état complet avec verrou optimiste. Une révision distante plus
 *  récente provoque un conflit explicite au lieu d'être écrasée. */
export async function pousserEtat(
  state: AppState,
  cibleAttendue: string,
): Promise<ResultatPush> {
  if (recuperationLocaleRequise()) {
    const erreur = signalerRecuperationLocaleRequise()
    return { ok: false, conflit: true, erreur }
  }
  if (
    !cibleAttendue ||
    cibleAttendue !== configurationSync ||
    cibleSynchronisation(state.settings.sync) !== cibleAttendue
  ) {
    const erreur =
      'La cible de synchronisation a changé : cet envoi local a été annulé pour protéger les deux espaces.'
    derniereErreur = erreur
    return { ok: false, erreur }
  }
  if (!client || !session) {
    const erreur = 'Aucune session Supabase active.'
    derniereErreur = erreur
    return { ok: false, erreur }
  }
  marquerEtatLocalEnAttente(state.settings.sync)
  const clientAuDepart = client
  const espaceAuDepart = workspaceId
  const generationAuDepart = generationConfiguration
  const revisionAttendue = revisionCourante ?? -1
  try {
    const { data, error } = await clientAuDepart.rpc('enregistrer_workspace', {
      p_id: espaceAuDepart,
      p_data: etatPartageable(state),
      p_version: state.version,
      p_updated_by: MON_ID,
      p_expected_revision: revisionAttendue,
    })
    if (
      generationAuDepart !== generationConfiguration ||
      espaceAuDepart !== workspaceId ||
      cibleAttendue !== configurationSync
    ) {
      const erreur = 'La configuration de synchronisation a changé pendant l’envoi.'
      derniereErreur = erreur
      return { ok: false, erreur }
    }
    if (error) {
      derniereErreur = error.message
      return { ok: false, erreur: error.message }
    }
    const ligne = Array.isArray(data) ? data[0] : data
    if (!ligne) {
      const erreur = signalerConflitSync()
      return { ok: false, conflit: true, erreur }
    }
    const revision = Number(ligne.revision)
    if (!Number.isSafeInteger(revision) || revision < 0) {
      const erreur = 'Révision de synchronisation invalide renvoyée par le serveur.'
      derniereErreur = erreur
      return { ok: false, erreur }
    }
    memoriserRevision(
      revision,
      typeof ligne.updated_at === 'string' ? ligne.updated_at : new Date().toISOString(),
    )
    effacerConflitSync()
    derniereErreur = null
    return { ok: true, revision: revisionCourante ?? undefined }
  } catch (e) {
    const erreur = e instanceof Error ? e.message : String(e)
    derniereErreur = erreur
    return { ok: false, erreur }
  }
}

/** lit la ligne partagée courante (null uniquement si elle n'existe pas). */
export async function tirerEtat(memoriserRevision = true): Promise<{
  data: AppState
  version: number
  updated_at: string
  revision: number
} | null> {
  if (!client || !session) throw new Error('Aucune session Supabase active.')
  const clientAuDepart = client
  const espaceAuDepart = workspaceId
  const generationAuDepart = generationConfiguration
  try {
    const { data, error } = await clientAuDepart
      .from(TABLE)
      .select('data,version,updated_at,revision')
      .eq('id', espaceAuDepart)
      .maybeSingle()
    if (generationAuDepart !== generationConfiguration || espaceAuDepart !== workspaceId)
      throw new Error('La configuration de synchronisation a changé pendant la lecture.')
    if (error) {
      derniereErreur = error.message
      throw new Error(`Lecture Supabase impossible : ${error.message}`)
    }
    if (!data) {
      if (memoriserRevision) adopterRevisionDistante(null)
      return null
    }
    const resultat = data as {
      data: AppState
      version: number
      updated_at: string
      revision: number
    }
    if (memoriserRevision)
      adopterRevisionDistante(Number(resultat.revision), resultat.updated_at)
    derniereErreur = null
    return resultat
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Lecture Supabase impossible')) throw e
    const erreur = e instanceof Error ? e.message : String(e)
    derniereErreur = erreur
    throw new Error(`Lecture Supabase impossible : ${erreur}`)
  }
}
