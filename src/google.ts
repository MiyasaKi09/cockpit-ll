// ============================================================
// Surveillance en direct — Gmail & Google Agenda, via les API
// Google GRATUITES (OAuth lecture seule, quotas largement au-delà
// des besoins d'une agence de 2 personnes). Aucun serveur : le
// navigateur interroge directement Google tant que l'onglet est
// ouvert (~1 min de latence). Le jeton reste en mémoire, rien
// n'est envoyé ailleurs.
//
// POURQUOI LE JETON N'EST PAS CONSERVÉ, ET CE QU'ON FAIT À LA PLACE
// -------------------------------------------------------------------
// `token` est une variable de MODULE. Un rechargement de page ré-évalue
// le module, donc le jeton disparaît — et la connexion Google paraissait
// se défaire à chaque F5.
//
// Le réflexe serait de le ranger dans `localStorage`. Ce serait un mauvais
// échange : un jeton d'accès y est lisible par n'importe quel script de la
// page, il survit à la fermeture de l'onglet sur un poste partagé, et il
// expire de toute façon au bout d'une heure — on aurait donc à la fois le
// risque ET la coupure.
//
// La bonne réponse est ailleurs. Google sait RÉ-ÉMETTRE un jeton sans
// aucune interaction quand le consentement a déjà été accordé et qu'une
// session Google est ouverte dans le navigateur : c'est `prompt: ''`.
// `assurerJeton()` l'appelle en silence. Rien n'est stocké, et la
// connexion se rétablit toute seule — au rechargement comme à l'expiration
// horaire, qui coupait la surveillance de la même façon.
//
// Quand la reprise silencieuse échoue (jamais consenti, session Google
// fermée, consentement révoqué), il FAUT un geste humain : c'est le bouton
// « Connecter Google » des Paramètres. On ne réessaie alors qu'espacé —
// marteler Google toutes les minutes ne ferait pas apparaître une session
// qui n'existe pas.
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
        error_callback?: (e: { type?: string }) => void
      }): TokenClient
    }
  }
}

let token: string | null = null
let expireA = 0
let scriptCharge: Promise<void> | null = null

/** Reprise silencieuse en cours — partagée, pour ne pas la lancer deux fois. */
let repriseEnCours: Promise<boolean> | null = null
/** Instant du dernier échec silencieux : on ne réessaie pas en boucle. */
let dernierEchecSilencieux = 0
const DELAI_AVANT_NOUVEL_ESSAI_MS = 5 * 60 * 1000
/** Si Google ne rappelle jamais, la promesse doit quand même se résoudre —
 *  sinon la boucle de surveillance resterait suspendue pour de bon. */
const DELAI_REPRISE_MS = 8000

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
        // Une connexion réussie efface la mémoire de l'échec : sans ça, la
        // reprise silencieuse resterait bridée cinq minutes après un
        // rétablissement, et l'agence croirait le bouton sans effet.
        dernierEchecSilencieux = 0
        res()
      },
    })
    client.requestAccessToken()
  })
}

/**
 * Tente de retrouver un jeton SANS rien demander à personne.
 *
 * Ne rejette jamais : un échec est une réponse normale (« pas de session
 * Google ici »), pas une panne. L'appelant lit le booléen.
 */
function repriseSilencieuse(clientId: string): Promise<boolean> {
  if (repriseEnCours) return repriseEnCours

  repriseEnCours = (async () => {
    try {
      await chargerGIS()
      const google = (window as unknown as { google: GoogleGis }).google
      return await new Promise<boolean>((res) => {
        let repondu = false
        const finir = (ok: boolean) => {
          if (repondu) return
          repondu = true
          if (!ok) dernierEchecSilencieux = Date.now()
          res(ok)
        }
        // Google ne garantit pas de rappeler : sans ce minuteur, la boucle de
        // surveillance resterait suspendue sur une promesse éternelle, et le
        // badge afficherait « en direct » pendant que plus rien n'est scruté.
        const minuteur = setTimeout(() => finir(false), DELAI_REPRISE_MS)
        const client = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: (r) => {
            clearTimeout(minuteur)
            if (r.error || !r.access_token) return finir(false)
            token = r.access_token
            expireA = Date.now() + (r.expires_in || 3600) * 1000
            finir(true)
          },
          error_callback: () => {
            clearTimeout(minuteur)
            finir(false)
          },
        })
        // `prompt: ''` = aucune fenêtre, aucun clic. Google rend un jeton si
        // le consentement est déjà donné et qu'une session est ouverte ;
        // sinon il rend une erreur, et c'est très bien.
        client.requestAccessToken({ prompt: '' })
      })
    } catch {
      dernierEchecSilencieux = Date.now()
      return false
    } finally {
      repriseEnCours = null
    }
  })()

  return repriseEnCours
}

/**
 * Un jeton valide, quitte à le redemander en silence.
 *
 * C'est le point d'entrée de la surveillance : il referme d'un coup les
 * deux coupures visibles — celle du rechargement de page et celle de
 * l'expiration horaire.
 */
export async function assurerJeton(clientId: string | null | undefined): Promise<boolean> {
  if (estConnecte()) return true
  const id = (clientId || '').trim()
  if (!id) return false
  // Réessayer chaque minute ne ferait pas apparaître une session Google qui
  // n'existe pas : après un échec, on laisse passer du temps.
  if (dernierEchecSilencieux && Date.now() - dernierEchecSilencieux < DELAI_AVANT_NOUVEL_ESSAI_MS) return false
  return repriseSilencieuse(id)
}

export function deconnecter(): void {
  token = null
  expireA = 0
  // Se déconnecter volontairement doit TENIR : sans ce marqueur, la reprise
  // silencieuse rebrancherait la surveillance au tick suivant, et le bouton
  // « Déconnecter » n'aurait aucun effet visible.
  dernierEchecSilencieux = Date.now()
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
