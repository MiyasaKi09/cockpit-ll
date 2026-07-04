// ============================================================
// Surveillance en direct — Gmail & Google Agenda, via les API
// Google GRATUITES (OAuth lecture seule, quotas largement au-delà
// des besoins d'une agence de 2 personnes). Aucun serveur : le
// navigateur interroge directement Google tant que l'onglet est
// ouvert (~1 min de latence). Le jeton reste en mémoire, rien
// n'est envoyé ailleurs.
// ============================================================

const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly'

interface TokenClient {
  requestAccessToken(opts?: { prompt?: string }): void
}
interface GoogleGis {
  accounts: {
    oauth2: {
      initTokenClient(cfg: {
        client_id: string
        scope: string
        callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void
      }): TokenClient
    }
  }
}

let token: string | null = null
let expireA = 0
let scriptCharge: Promise<void> | null = null

function chargerGIS(): Promise<void> {
  if (!scriptCharge) {
    scriptCharge = new Promise((res, rej) => {
      if ((window as unknown as { google?: GoogleGis }).google?.accounts) return res()
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.onload = () => res()
      s.onerror = () => rej(new Error('Impossible de charger le script Google (connexion ?).'))
      document.head.appendChild(s)
    })
    scriptCharge.catch(() => {
      scriptCharge = null
    })
  }
  return scriptCharge
}

export function estConnecte(): boolean {
  return token !== null && Date.now() < expireA - 60_000
}

/** demande le jeton (geste utilisateur requis la première fois) */
export async function connecterGoogle(clientId: string): Promise<void> {
  await chargerGIS()
  const google = (window as unknown as { google: GoogleGis }).google
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (r) => {
        if (r.error || !r.access_token) {
          rej(new Error(r.error || 'Connexion refusée.'))
          return
        }
        token = r.access_token
        expireA = Date.now() + (r.expires_in || 3600) * 1000
        res()
      },
    })
    client.requestAccessToken()
  })
}

export function deconnecter(): void {
  token = null
  expireA = 0
}

async function apiGet<T>(url: string): Promise<T> {
  if (!estConnecte()) throw new Error('Session Google expirée — reconnectez-vous (Paramètres).')
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (r.status === 401) {
    deconnecter()
    throw new Error('Session Google expirée — reconnectez-vous (Paramètres).')
  }
  if (!r.ok) throw new Error(`Google a répondu ${r.status}.`)
  return (await r.json()) as T
}

// ---------- Gmail ----------

export interface MailRecu {
  id: string
  de: string
  objet: string
  extrait: string
  date: string // ISO
}

/** mails des dernières 48 h vers l'adresse surveillée (ou toute la boîte si vide) */
export async function listerMailsRecents(adresse: string): Promise<MailRecu[]> {
  const q = encodeURIComponent(`in:inbox newer_than:2d${adresse ? ` to:${adresse}` : ''}`)
  const liste = await apiGet<{ messages?: { id: string }[] }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=15`,
  )
  const ids = (liste.messages || []).map((m) => m.id)
  const mails: MailRecu[] = []
  for (const id of ids) {
    const m = await apiGet<{
      snippet?: string
      internalDate?: string
      payload?: { headers?: { name: string; value: string }[] }
    }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
    )
    const h = (nom: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === nom)?.value || ''
    mails.push({
      id,
      de: h('from'),
      objet: h('subject') || '(sans objet)',
      extrait: m.snippet || '',
      date: m.internalDate ? new Date(Number(m.internalDate)).toISOString().slice(0, 10) : '',
    })
  }
  return mails
}

// ---------- Google Agenda ----------

export interface EvenementAgenda {
  id: string
  titre: string
  debut: string // ISO datetime ou date
  lieu?: string
  journee: boolean
}

/** événements des prochaines 72 h du calendrier principal du compte connecté */
export async function listerEvenements(): Promise<EvenementAgenda[]> {
  const min = new Date().toISOString()
  const max = new Date(Date.now() + 72 * 3600 * 1000).toISOString()
  const r = await apiGet<{
    items?: { id: string; summary?: string; location?: string; start?: { dateTime?: string; date?: string } }[]
  }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}&singleEvents=true&orderBy=startTime&maxResults=10`,
  )
  return (r.items || []).map((e) => ({
    id: e.id,
    titre: e.summary || '(sans titre)',
    debut: e.start?.dateTime || e.start?.date || '',
    lieu: e.location,
    journee: !e.start?.dateTime,
  }))
}

// ---------- mémoire des mails déjà vus (hors état exporté) ----------

const CLE_VUS = 'cockpit-ll-gmail-vus'

export function mailsDejaVus(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLE_VUS) || '[]') as string[])
  } catch {
    return new Set()
  }
}

export function marquerVus(ids: string[]): void {
  const vus = [...mailsDejaVus(), ...ids].slice(-500)
  localStorage.setItem(CLE_VUS, JSON.stringify(vus))
}
