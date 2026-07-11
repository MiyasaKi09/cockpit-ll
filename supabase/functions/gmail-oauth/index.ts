// ============================================================
// gmail-oauth — consentement Google « offline » (refresh token).
// Appelée SANS jeton (c'est Google qui redirige le navigateur) :
// - sans ?code : démarre le flux (state anti-CSRF stocké côté
//   serveur, login_hint sur le compte configuré) ;
// - avec ?code : échange le code, vérifie que le compte connecté
//   est EXACTEMENT celui configuré dans le Cockpit, stocke le
//   refresh token dans la table privée. Lecture seule (gmail.readonly).
// Un compte non configuré ne peut jamais se brancher.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly openid email'

function page(titre: string, corps: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="fr"><meta charset="utf-8"><title>${titre}</title>
<body style="font-family:system-ui;max-width:560px;margin:80px auto;padding:0 20px;line-height:1.5">
<h1 style="font-size:22px">${titre}</h1><p>${corps}</p>
<p style="color:#6b6655">Vous pouvez fermer cet onglet et revenir au Cockpit.</p></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

/** e-mail porté par l'id_token Google (signature déjà vérifiée par
 *  l'échange direct serveur ↔ Google sur le canal TLS) */
function emailDuIdToken(idToken: string): string | null {
  try {
    const brut = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(brut)) as { email?: string }
    return payload.email?.toLowerCase() ?? null
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-oauth`
  const sb = admin()
  const { data: cfg } = await sb.from('ingestion_config').select('*').eq('id', 'google').maybeSingle()

  if (url.searchParams.get('error')) {
    return page('Connexion refusée', `Google a répondu : ${url.searchParams.get('error')}.`, 400)
  }

  if (!cfg?.client_id || !cfg?.client_secret || !cfg?.compte_email) {
    return page(
      'Ingestion non configurée',
      'Renseignez d’abord l’identifiant client Google, son secret et le compte Gmail à surveiller dans le Cockpit (Paramètres → Branchements).',
      400,
    )
  }

  const code = url.searchParams.get('code')

  // --- départ du flux : redirection vers le consentement Google ---
  if (!code) {
    const state = crypto.randomUUID()
    await sb.from('ingestion_config').update({ oauth_state: state }).eq('id', 'google')
    const p = new URLSearchParams({
      client_id: cfg.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      login_hint: cfg.compte_email,
      state,
    })
    return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`, 302)
  }

  // --- retour de Google : vérification anti-CSRF puis échange du code ---
  const state = url.searchParams.get('state')
  if (!state || state !== cfg.oauth_state) {
    return page('Lien expiré', 'Relancez la connexion depuis le Cockpit (le jeton de sécurité ne correspond pas).', 400)
  }
  await sb.from('ingestion_config').update({ oauth_state: null }).eq('id', 'google')

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const jeton = (await r.json()) as { refresh_token?: string; id_token?: string; error?: string }
  if (!r.ok || !jeton.refresh_token) {
    return page(
      'Échange impossible',
      `Google n’a pas fourni de jeton durable (${jeton.error || r.status}). Retirez l’accès existant sur myaccount.google.com/permissions puis recommencez.`,
      400,
    )
  }

  // seule l'adresse configurée dans le Cockpit a le droit de se brancher
  const email = jeton.id_token ? emailDuIdToken(jeton.id_token) : null
  if (!email || email !== cfg.compte_email.toLowerCase()) {
    return page(
      'Mauvais compte Google',
      `Le compte connecté (${email || 'inconnu'}) n’est pas celui configuré (${cfg.compte_email}). Rien n’a été enregistré.`,
      403,
    )
  }

  await sb
    .from('ingestion_config')
    .update({
      refresh_token: jeton.refresh_token,
      dernier_resultat: 'Gmail connecté — premier scan dans les 10 minutes.',
      maj_le: new Date().toISOString(),
    })
    .eq('id', 'google')

  return page(
    'Gmail connecté',
    `Le Cockpit lit désormais les pièces jointes de ${cfg.compte_email} (lecture seule) et les proposera dans la boîte d’arrivée, avec ses raisons, sans jamais rien classer tout seul.`,
  )
})
