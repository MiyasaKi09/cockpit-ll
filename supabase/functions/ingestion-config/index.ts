// ============================================================
// ingestion-config — configuration de l'ingestion Gmail côté
// serveur, PILOTÉE DEPUIS LE COCKPIT (Paramètres → Branchements).
// JWT vérifié par la plateforme + liste blanche des e-mails de
// l'agence. Les identifiants OAuth vivent dans la table privée
// ingestion_config (RLS sans policy : service role uniquement) —
// jamais dans l'état partagé, jamais renvoyés au client.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

const AGENCE = ['julenglet@gmail.com', 'zoefhebert@gmail.com']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
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
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const email = await emailAppelant(req)
  if (!email || !AGENCE.includes(email)) {
    return json({ erreur: 'Accès réservé à l’agence.' }, 403)
  }

  const sb = admin()
  const { data: cfg } = await sb.from('ingestion_config').select('*').eq('id', 'google').maybeSingle()

  if (req.method === 'GET') {
    // statut SANS les secrets — de quoi afficher la carte de Paramètres
    return json({
      configure: Boolean(cfg?.client_id && cfg?.client_secret && cfg?.compte_email),
      connecte: Boolean(cfg?.refresh_token),
      compteEmail: cfg?.compte_email ?? '',
      dernierScan: cfg?.dernier_scan ?? null,
      dernierResultat: cfg?.dernier_resultat ?? null,
      urlOauth: `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-oauth`,
    })
  }

  if (req.method === 'POST') {
    const corps = (await req.json().catch(() => ({}))) as {
      clientId?: string
      clientSecret?: string
      compteEmail?: string
    }
    const patch: Record<string, unknown> = { maj_le: new Date().toISOString() }
    if (typeof corps.clientId === 'string') patch.client_id = corps.clientId.trim()
    if (typeof corps.clientSecret === 'string' && corps.clientSecret.trim()) {
      patch.client_secret = corps.clientSecret.trim()
    }
    if (typeof corps.compteEmail === 'string') patch.compte_email = corps.compteEmail.trim().toLowerCase()
    // identifiants changés → l'ancien refresh token ne vaut plus rien
    if (patch.client_id && patch.client_id !== cfg?.client_id) patch.refresh_token = null
    const { error } = await sb.from('ingestion_config').update(patch).eq('id', 'google')
    if (error) return json({ erreur: error.message }, 500)
    return json({ ok: true })
  }

  if (req.method === 'DELETE') {
    // déconnecter Gmail (le consentement peut aussi être retiré côté Google)
    const { error } = await sb
      .from('ingestion_config')
      .update({ refresh_token: null, dernier_resultat: 'Déconnecté depuis le Cockpit.', maj_le: new Date().toISOString() })
      .eq('id', 'google')
    if (error) return json({ erreur: error.message }, 500)
    return json({ ok: true })
  }

  return json({ erreur: 'Méthode non prise en charge.' }, 405)
})
