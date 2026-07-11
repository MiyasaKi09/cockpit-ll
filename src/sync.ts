// ============================================================
// Synchronisation Supabase (offre gratuite) — couche « sans React »,
// calquée sur google.ts : un singleton module, aucun import React,
// des messages d'erreur français. On branche Supabase DERRIÈRE la
// persistance du store : un seul document JSON = tout l'état de
// l'agence, partagé entre les 2 postes en temps réel.
//
// Local-first préservé : si non connecté / hors-ligne, tout continue
// en localStorage (les échecs de push sont avalés, jamais bloquants).
// ============================================================

import type { RealtimeChannel, Session, SupabaseClient } from '@supabase/supabase-js'
import type { AppState } from './types'

const TABLE = 'workspace'

// ----- état module (aucun état React ici) -----
let clientPromise: Promise<SupabaseClient> | null = null
let client: SupabaseClient | null = null
let session: Session | null = null
let workspaceId = ''
let channel: RealtimeChannel | null = null
let onRemoteCourant: ((s: AppState) => void) | null = null
let authListenerAttache = false
let derniereSync: string | null = null
let derniereErreur: string | null = null
let envoiEnCours = false

/** identifiant stable de CE poste — clé anti-écho (on ignore nos propres écritures) */
const CLE_CLIENT = 'cockpit-ll-sync-client'
const MON_ID = (() => {
  try {
    let v = localStorage.getItem(CLE_CLIENT)
    if (!v) {
      v = (crypto.randomUUID?.() ?? `c-${Date.now()}-${Math.floor(Math.random() * 1e9)}`)
      localStorage.setItem(CLE_CLIENT, v)
    }
    return v
  } catch {
    return `c-${Date.now()}`
  }
})()

// ----- helpers -----

/** client Supabase mémoïsé (import dynamique, comme xlsx) — rejoue si l'import échoue */
async function obtenirClient(url: string, anonKey: string): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }),
    )
    clientPromise.catch(() => {
      clientPromise = null // permet une nouvelle tentative
    })
  }
  return clientPromise
}

/** retire la config machine-locale (settings.sync) du document partagé */
function sansConfigLocale(state: AppState): AppState {
  const { sync: _local, ...restSettings } = state.settings
  return { ...state, settings: restSettings }
}

// ----- API exportée -----

export function syncActif(): boolean {
  return client !== null && session !== null
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
} {
  return {
    connecte: syncActif(),
    email: session?.user?.email ?? null,
    derniereSync,
    erreur: derniereErreur,
  }
}

/** crée le client, restaure une session existante (reprise après reload) et
 *  branche le ré-abonnement automatique au retour du lien magique */
export async function connecterSync(url: string, anonKey: string, ws: string): Promise<void> {
  if (!url.trim() || !anonKey.trim() || !ws.trim()) {
    throw new Error('Renseignez l’URL du projet, la clé publique et l’identifiant d’espace.')
  }
  derniereErreur = null
  try {
    client = await obtenirClient(url.trim(), anonKey.trim())
  } catch {
    throw new Error('Impossible de charger le client Supabase (connexion ?).')
  }
  workspaceId = ws.trim()

  const { data } = await client.auth.getSession()
  session = data.session

  if (!authListenerAttache) {
    authListenerAttache = true
    client.auth.onAuthStateChange((_evt, s) => {
      session = s
      // au retour du lien magique (SIGNED_IN), on (re)branche le temps réel
      if (s && onRemoteCourant && !channel) souscrire()
    })
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
  try {
    if (channel && client) await client.removeChannel(channel)
  } catch {
    /* ignore */
  }
  channel = null
  onRemoteCourant = null
  if (client) {
    try {
      await client.auth.signOut()
    } catch {
      /* ignore */
    }
  }
  session = null
}

/** (ré)abonnement temps réel à la ligne de l'espace partagé */
function souscrire(): void {
  if (!client) return
  if (channel) {
    // idempotence : on retire l'abonnement existant avant d'en recréer un
    client.removeChannel(channel)
    channel = null
  }
  channel = client
    .channel(`ws-${workspaceId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE, filter: `id=eq.${workspaceId}` },
      (payload) => {
        const row = payload.new as { data?: AppState; updated_by?: string } | null
        if (!row) return
        // anti-écho A : on ignore NOS propres écritures (comparé au contenu, robuste)
        if (row.updated_by === MON_ID) return
        derniereSync = new Date().toISOString()
        if (row.data) {
          onRemoteCourant?.(row.data)
        } else {
          // payload tronqué (blob volumineux) → on refait un tirage complet
          void tirerEtat().then((r) => r && onRemoteCourant?.(r.data))
        }
      },
    )
    .subscribe()
}

/** démarre le temps réel ; retourne la fonction d'arrêt (cleanup d'effet) */
export function demarrerRealtime(onRemote: (s: AppState) => void): () => void {
  onRemoteCourant = onRemote
  if (session) souscrire()
  // sinon : le listener onAuthStateChange s'en chargera à la connexion
  return () => {
    if (channel && client) client.removeChannel(channel)
    channel = null
    onRemoteCourant = null
  }
}

/** pousse l'état complet (débounce côté appelant). N'échoue JAMAIS : les
 *  erreurs deviennent un statut doux, la prochaine écriture rattrapera. */
export async function pousserEtat(state: AppState): Promise<void> {
  if (!client || !session) return
  try {
    const { error } = await client.from(TABLE).upsert({
      id: workspaceId,
      data: sansConfigLocale(state),
      version: state.version,
      updated_at: new Date().toISOString(),
      updated_by: MON_ID,
    })
    if (error) {
      derniereErreur = error.message
      return
    }
    derniereSync = new Date().toISOString()
    derniereErreur = null
  } catch (e) {
    derniereErreur = e instanceof Error ? e.message : String(e)
  }
}

/** lit la ligne partagée courante (null si absente ou erreur) */
export async function tirerEtat(): Promise<{ data: AppState; version: number; updated_at: string } | null> {
  if (!client) return null
  try {
    const { data, error } = await client
      .from(TABLE)
      .select('data,version,updated_at')
      .eq('id', workspaceId)
      .maybeSingle()
    if (error || !data) return null
    return data as { data: AppState; version: number; updated_at: string }
  } catch {
    return null
  }
}
