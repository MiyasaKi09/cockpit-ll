// ============================================================
// ingestion-config — configuration de l'ingestion Gmail côté
// serveur, PILOTÉE DEPUIS LE COCKPIT (Paramètres → Branchements).
// JWT vérifié par la plateforme + liste blanche des e-mails de
// l'agence. Les identifiants OAuth vivent dans la table privée
// ingestion_config (RLS sans policy : service role uniquement) —
// jamais dans l'état partagé, jamais renvoyés au client.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2.110.0'
import { creerJetonInitiationOAuth } from '../_shared/oauth-init.ts'

const AGENCE = ['julenglet@gmail.com', 'zoefhebert@gmail.com']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

function secretInitiationOAuth(): string {
  return Deno.env.get('GMAIL_OAUTH_INIT_SECRET')?.trim() || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
}

/** e-mail du jeton utilisateur (vérifié par la plateforme, relu ici) */
async function emailAppelant(req: Request): Promise<string | null> {
  const jeton = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!jeton) return null
  const { data } = await admin().auth.getUser(jeton)
  return data.user?.email?.toLowerCase() ?? null
}

function json(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: {
      ...CORS,
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const email = await emailAppelant(req)
  if (!email || !AGENCE.includes(email)) {
    return json({ erreur: 'Accès réservé à l’agence.' }, 403)
  }

  const sb = admin()
  const { data: cfg, error: erreurConfig } = await sb
    .from('ingestion_config')
    .select('*')
    .eq('id', 'google')
    .maybeSingle()
  if (erreurConfig) {
    console.error('Lecture ingestion_config impossible :', erreurConfig.message)
    return json({ erreur: 'Configuration serveur momentanément indisponible.' }, 500)
  }

  if (req.method === 'GET') {
    const urlOauth = `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-oauth`
    let urlConnexion: string | null = null
    if (cfg?.client_id && cfg?.client_secret && cfg?.compte_email) {
      try {
        const jeton = await creerJetonInitiationOAuth(
          email,
          cfg.compte_email,
          secretInitiationOAuth(),
        )
        urlConnexion = `${urlOauth}?init=${encodeURIComponent(jeton)}`
      } catch (e) {
        console.error('Signature de l’initiation OAuth impossible :', e)
        return json({ erreur: 'Connexion Google momentanément indisponible.' }, 500)
      }
    }

    // statut SANS les secrets — de quoi afficher la carte de Paramètres
    return json({
      configure: Boolean(cfg?.client_id && cfg?.client_secret && cfg?.compte_email),
      connecte: Boolean(cfg?.refresh_token),
      compteEmail: cfg?.compte_email ?? '',
      workspaceId: cfg?.workspace_id ?? 'agence-ll',
      dernierScan: cfg?.dernier_scan ?? null,
      dernierResultat: cfg?.dernier_resultat ?? null,
      // urlOauth = URI fixe à déclarer chez Google ; urlConnexion =
      // départ court et signé, délivré uniquement à une session agence.
      urlOauth,
      urlConnexion,
    })
  }

  if (req.method === 'POST') {
    const corps = (await req.json().catch(() => ({}))) as {
      clientId?: string
      clientSecret?: string
      compteEmail?: string
      workspaceId?: string
    }
    const clientId = typeof corps.clientId === 'string' ? corps.clientId.trim() : ''
    const clientSecret =
      typeof corps.clientSecret === 'string' ? corps.clientSecret.trim() : ''
    const compteEmail =
      typeof corps.compteEmail === 'string' ? corps.compteEmail.trim().toLowerCase() : ''
    if (corps.compteEmail !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(compteEmail)) {
      return json({ erreur: 'Adresse Gmail invalide.' }, 400)
    }
    if (clientId && clientId !== cfg?.client_id && !clientSecret) {
      return json(
        { erreur: 'Un nouveau Client ID doit être enregistré avec son secret client.' },
        400,
      )
    }
    if (
      !(clientId || cfg?.client_id) ||
      !(clientSecret || cfg?.client_secret) ||
      !(compteEmail || cfg?.compte_email)
    ) {
      return json({ erreur: 'Client ID, secret client et compte Gmail sont obligatoires.' }, 400)
    }
    const patch: Record<string, unknown> = { maj_le: new Date().toISOString() }
    // Les champs secrets vides signifient « conserver l'existant » : l'UI
    // ne relit jamais les valeurs déjà enregistrées côté serveur.
    if (clientId) patch.client_id = clientId
    if (clientSecret) patch.client_secret = clientSecret
    if (compteEmail) patch.compte_email = compteEmail
    if (typeof corps.workspaceId === 'string') {
      const workspaceId = corps.workspaceId.trim()
      if (!workspaceId || workspaceId.length > 120) {
        return json({ erreur: 'Identifiant de workspace invalide.' }, 400)
      }
      patch.workspace_id = workspaceId
    }
    // identifiants changés → l'ancien refresh token ne vaut plus rien
    if (
      (patch.client_id && patch.client_id !== cfg?.client_id) ||
      (patch.client_secret && patch.client_secret !== cfg?.client_secret) ||
      (patch.compte_email && patch.compte_email !== cfg?.compte_email)
    )
      patch.refresh_token = null
    const { data: configurationMaj, error } = await sb
      .from('ingestion_config')
      .update(patch)
      .eq('id', 'google')
      .select('id')
      .maybeSingle()
    if (error) return json({ erreur: error.message }, 500)
    if (!configurationMaj) {
      return json({ erreur: 'Configuration serveur absente : appliquez les migrations Supabase.' }, 409)
    }
    return json({ ok: true })
  }

  if (req.method === 'DELETE') {
    // déconnecter Gmail (le consentement peut aussi être retiré côté Google)
    const { data: configurationMaj, error } = await sb
      .from('ingestion_config')
      .update({ refresh_token: null, dernier_resultat: 'Déconnecté depuis le Cockpit.', maj_le: new Date().toISOString() })
      .eq('id', 'google')
      .select('id')
      .maybeSingle()
    if (error) return json({ erreur: error.message }, 500)
    if (!configurationMaj) {
      return json({ erreur: 'Configuration serveur absente : appliquez les migrations Supabase.' }, 409)
    }
    return json({ ok: true })
  }

  return json({ erreur: 'Méthode non prise en charge.' }, 405)
})
