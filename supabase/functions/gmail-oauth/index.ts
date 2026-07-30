// ============================================================
// gmail-oauth — consentement Google « offline » (refresh token).
// Endpoint public au niveau de la plateforme (Google redirige le navigateur) :
// - sans ?code : démarre uniquement avec un lien court signé par
//   ingestion-config après authentification de la session agence ;
//   le state anti-CSRF est lié à un cookie HttpOnly du navigateur ;
// - avec ?code : échange le code, vérifie que le compte connecté
//   est EXACTEMENT celui configuré dans le Cockpit, stocke le
//   refresh token dans la table privée. Lecture seule (gmail.readonly).
// Un compte non configuré ne peut jamais se brancher.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2.110.0'
import { verifierJetonInitiationOAuth } from '../_shared/oauth-init.ts'

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly openid email'
const COOKIE_ETAT = '__Host-cockpit_gmail_oauth_state'
const DUREE_ETAT_SECONDES = 15 * 60
const DELAI_GOOGLE_MS = 15_000
const TAILLE_MAX_REPONSE_GOOGLE = 64 * 1024

const ENTETES_SECURITE = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

function echapperHtml(valeur: unknown): string {
  return String(valeur)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function lireCookie(req: Request, nom: string): string | null {
  for (const partie of (req.headers.get('cookie') || '').split(';')) {
    const separateur = partie.indexOf('=')
    if (separateur < 0 || partie.slice(0, separateur).trim() !== nom) continue
    try {
      return decodeURIComponent(partie.slice(separateur + 1).trim())
    } catch {
      return null
    }
  }
  return null
}

function definirCookieEtat(state: string): string {
  return `${COOKIE_ETAT}=${encodeURIComponent(state)}; Max-Age=${DUREE_ETAT_SECONDES}; Path=/; Secure; HttpOnly; SameSite=Lax`
}

function effacerCookieEtat(): string {
  return `${COOKIE_ETAT}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`
}

function secretInitiationOAuth(): string {
  return Deno.env.get('GMAIL_OAUTH_INIT_SECRET')?.trim() || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
}

async function requeteJsonGoogle<T extends Record<string, unknown>>(
  url: string,
  init: RequestInit,
): Promise<{ reponse: Response; corps: T }> {
  const controleur = new AbortController()
  const chrono = setTimeout(() => controleur.abort(), DELAI_GOOGLE_MS)
  try {
    const reponse = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controleur.signal,
    })
    const longueurAnnoncee = Number(reponse.headers.get('content-length'))
    if (Number.isFinite(longueurAnnoncee) && longueurAnnoncee > TAILLE_MAX_REPONSE_GOOGLE) {
      await reponse.body?.cancel()
      throw new Error('Réponse Google trop volumineuse.')
    }

    const lecteur = reponse.body?.getReader()
    const morceaux: Uint8Array[] = []
    let taille = 0
    if (lecteur) {
      try {
        while (true) {
          const { done, value } = await lecteur.read()
          if (done) break
          if (!value?.byteLength) continue
          taille += value.byteLength
          if (taille > TAILLE_MAX_REPONSE_GOOGLE) {
            await lecteur.cancel()
            throw new Error('Réponse Google trop volumineuse.')
          }
          morceaux.push(value)
        }
      } finally {
        lecteur.releaseLock()
      }
    }

    const octets = new Uint8Array(taille)
    let position = 0
    for (const morceau of morceaux) {
      octets.set(morceau, position)
      position += morceau.byteLength
    }
    const texte = new TextDecoder().decode(octets)
    const decode = texte ? JSON.parse(texte) : {}
    if (!decode || typeof decode !== 'object' || Array.isArray(decode)) {
      throw new Error('Réponse Google invalide.')
    }
    return { reponse, corps: decode as T }
  } finally {
    // Le délai reste actif pendant fetch ET pendant la lecture du corps.
    clearTimeout(chrono)
  }
}

function page(
  titre: string,
  corps: string,
  status = 200,
  headersSupplementaires: Record<string, string> = {},
): Response {
  const titreSain = echapperHtml(titre)
  const corpsSain = echapperHtml(corps)
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${titreSain}</title></head>
<body><main><h1>${titreSain}</h1><p>${corpsSain}</p>
<p>Vous pouvez fermer cet onglet et revenir au Cockpit.</p></main></body></html>`,
    {
      status,
      headers: {
        ...ENTETES_SECURITE,
        ...headersSupplementaires,
        'Content-Type': 'text/html; charset=utf-8',
      },
    },
  )
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return page('Méthode refusée', 'Cette adresse accepte uniquement les retours OAuth en lecture.', 405)
  }

  const url = new URL(req.url)
  const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-oauth`
  const sb = admin()
  const { data: cfg, error: erreurConfig } = await sb
    .from('ingestion_config')
    .select('*')
    .eq('id', 'google')
    .maybeSingle()
  if (erreurConfig) {
    console.error('Lecture ingestion_config impossible :', erreurConfig.message)
    return page('Service indisponible', 'La configuration Google ne peut pas être lue pour le moment.', 500)
  }

  if (!cfg?.client_id || !cfg?.client_secret || !cfg?.compte_email) {
    return page(
      'Ingestion non configurée',
      'Renseignez d’abord l’identifiant client Google, son secret et le compte Gmail à surveiller dans le Cockpit (Paramètres → Branchements).',
      400,
    )
  }

  const code = url.searchParams.get('code')
  const erreurGoogle = url.searchParams.get('error')
  const retourGoogle = code !== null || erreurGoogle !== null || url.searchParams.has('state')

  // --- départ du flux : redirection vers le consentement Google ---
  if (!retourGoogle) {
    const initiationValide = await verifierJetonInitiationOAuth(
      url.searchParams.get('init'),
      cfg.compte_email,
      secretInitiationOAuth(),
    )
    if (!initiationValide) {
      return page(
        'Lien de connexion expiré',
        'Revenez dans le Cockpit, actualisez le statut puis cliquez de nouveau sur « Connecter Gmail ».',
        403,
      )
    }

    const state = crypto.randomUUID()
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
    return new Response(null, {
      status: 302,
      headers: {
        ...ENTETES_SECURITE,
        Location: `https://accounts.google.com/o/oauth2/v2/auth?${p}`,
        'Set-Cookie': definirCookieEtat(state),
      },
    })
  }

  // --- retour de Google : état lié au navigateur, puis échange du code ---
  const state = url.searchParams.get('state')
  const stateNavigateur = lireCookie(req, COOKIE_ETAT)
  const headersFin = { 'Set-Cookie': effacerCookieEtat() }
  if (!state || !stateNavigateur || state !== stateNavigateur) {
    return page(
      'Lien expiré',
      'Relancez la connexion depuis le Cockpit (le jeton de sécurité ne correspond pas).',
      400,
      headersFin,
    )
  }

  if (erreurGoogle) {
    return page('Connexion refusée', `Google a répondu : ${erreurGoogle}.`, 400, headersFin)
  }
  if (!code) {
    return page('Retour incomplet', 'Google n’a pas fourni de code de connexion.', 400, headersFin)
  }

  let echange: {
    reponse: Response
    corps: { refresh_token?: string; access_token?: string; error?: string }
  }
  try {
    echange = await requeteJsonGoogle<{
      refresh_token?: string
      access_token?: string
      error?: string
    }>('https://oauth2.googleapis.com/token', {
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
  } catch (e) {
    console.error('Échange OAuth Google impossible :', e)
    return page(
      'Google indisponible',
      'La réponse de Google a expiré ou était invalide. Relancez la connexion depuis le Cockpit.',
      502,
      headersFin,
    )
  }
  const jeton = echange.corps
  if (!echange.reponse.ok || !jeton.refresh_token || !jeton.access_token) {
    return page(
      'Échange impossible',
      `Google n’a pas fourni de jeton durable (${jeton.error || echange.reponse.status}). Retirez l’accès existant sur myaccount.google.com/permissions puis recommencez.`,
      400,
      headersFin,
    )
  }

  // L'identité n'est pas déduite d'un JWT simplement décodé : elle est
  // relue auprès de Google avec le jeton d'accès fraîchement échangé.
  let identite: {
    reponse: Response
    corps: { email?: string; email_verified?: boolean }
  }
  try {
    identite = await requeteJsonGoogle<{
      email?: string
      email_verified?: boolean
    }>('https://openidconnect.googleapis.com/v1/userinfo', {
      method: 'GET',
      headers: { Authorization: `Bearer ${jeton.access_token}` },
    })
  } catch (e) {
    console.error('Lecture de l’identité Google impossible :', e)
    return page(
      'Compte invérifiable',
      'Google n’a pas permis de vérifier le compte connecté. Relancez la connexion depuis le Cockpit.',
      502,
      headersFin,
    )
  }
  const email = identite.corps.email?.trim().toLowerCase() || null
  if (
    !identite.reponse.ok ||
    identite.corps.email_verified !== true ||
    !email ||
    email !== cfg.compte_email.toLowerCase()
  ) {
    return page(
      'Mauvais compte Google',
      `Le compte connecté (${email || 'inconnu'}) n’est pas celui configuré (${cfg.compte_email}). Rien n’a été enregistré.`,
      403,
      headersFin,
    )
  }

  const { data: configMaj, error: erreurMaj } = await sb
    .from('ingestion_config')
    .update({
      refresh_token: jeton.refresh_token,
      dernier_resultat: 'Gmail connecté — premier scan dans les 10 minutes.',
      maj_le: new Date().toISOString(),
    })
    .eq('id', 'google')
    .eq('compte_email', cfg.compte_email)
    .eq('client_id', cfg.client_id)
    .select('id')
    .maybeSingle()
  if (erreurMaj || !configMaj) {
    console.error('Enregistrement du refresh token impossible :', erreurMaj?.message || 'configuration modifiée')
    return page(
      'Enregistrement impossible',
      'La configuration a changé pendant la connexion. Actualisez le Cockpit puis recommencez.',
      409,
      headersFin,
    )
  }

  return page(
    'Gmail connecté',
    `Le Cockpit lit désormais les pièces jointes de ${cfg.compte_email} (lecture seule) et les proposera dans la boîte d’arrivée, avec ses raisons, sans jamais rien classer tout seul.`,
    200,
    headersFin,
  )
})
