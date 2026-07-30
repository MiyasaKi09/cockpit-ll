// ============================================================
// Relais Vercel — la seule pièce « serveur » du cockpit, et elle
// tient en un fichier. Rôle : aller chercher les plateformes
// d'appels d'offres qui refusent les navigateurs (pas de CORS) :
// TED, AWS/marches-publics.info… Fonction serverless GRATUITE
// (offre hobby Vercel), aucune donnée stockée, aucun secret.
//
// Garde-fous : liste blanche de domaines (pas un proxy ouvert),
// méthodes GET/POST seulement, délai 15 s, réponse plafonnée.
// ============================================================

const DOMAINES_AUTORISES = new Set([
  'api.ted.europa.eu',
  'ted.europa.eu',
  'www.marches-publics.info',
  'marches-publics.info',
  'www.boamp.fr',
  'boamp-datadila.opendatasoft.com',
  'centraledesmarches.com',
  'www.centraledesmarches.com',
  'www.klekoon.com',
  'www.e-marchespublics.com',
])

const TAILLE_MAX = 3 * 1024 * 1024 // 3 Mo
const TAILLE_REQUETE_MAX = 512 * 1024
const REDIRECTIONS_MAX = 5
const STATUTS_REDIRECTION = new Set([301, 302, 303, 307, 308])

function entete(valeur) {
  return Array.isArray(valeur) ? valeur[0] : typeof valeur === 'string' ? valeur : ''
}

function origineAutorisee(req, res) {
  const origine = entete(req.headers.origin)
  if (!origine) return true
  const autorisees = new Set(
    String(process.env.APP_ORIGIN || '')
      .split(',')
      .map((valeur) => valeur.trim().replace(/\/$/, ''))
      .filter(Boolean),
  )
  const host = entete(req.headers['x-forwarded-host']) || entete(req.headers.host)
  const protocole =
    (entete(req.headers['x-forwarded-proto']).split(',')[0] ||
      (host.startsWith('localhost') ? 'http' : 'https')).trim()
  if (host) autorisees.add(`${protocole}://${host}`)
  if (!autorisees.has(origine.replace(/\/$/, ''))) return false
  res.setHeader('Access-Control-Allow-Origin', origine)
  res.setHeader('Vary', 'Origin')
  return true
}

export function urlRelaisAutorisee(valeur) {
  try {
    const url = valeur instanceof URL ? valeur : new URL(valeur)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !DOMAINES_AUTORISES.has(url.hostname.toLowerCase())
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

class UrlRelaisInterditeError extends Error {
  constructor(url) {
    super(`URL HTTPS hors liste blanche : ${url}`)
    this.name = 'UrlRelaisInterditeError'
    this.url = String(url)
  }
}

class TropDeRedirectionsError extends Error {
  constructor() {
    super('Trop de redirections.')
    this.name = 'TropDeRedirectionsError'
  }
}

export async function suivreRedirections(urlInitiale, init, fetcher = fetch) {
  let courante = urlRelaisAutorisee(urlInitiale)
  if (!courante) throw new UrlRelaisInterditeError(urlInitiale)

  let methode = String(init.method || 'GET').toUpperCase()
  let corps = init.body
  const headers = new Headers(init.headers)

  for (let redirections = 0; ; redirections++) {
    const reponse = await fetcher(courante, {
      ...init,
      method: methode,
      headers,
      body: corps,
      redirect: 'manual',
    })
    if (!STATUTS_REDIRECTION.has(reponse.status)) return reponse

    const location = reponse.headers.get('location')
    if (!location) return reponse

    const suivante = new URL(location, courante)
    if (!urlRelaisAutorisee(suivante)) {
      await reponse.body?.cancel()
      throw new UrlRelaisInterditeError(suivante.href)
    }
    if (redirections >= REDIRECTIONS_MAX) {
      await reponse.body?.cancel()
      throw new TropDeRedirectionsError()
    }
    await reponse.body?.cancel()

    // Même sémantique que fetch pour les redirections POST usuelles.
    if (reponse.status === 303 || ((reponse.status === 301 || reponse.status === 302) && methode === 'POST')) {
      methode = 'GET'
      corps = undefined
      headers.delete('content-type')
    }
    courante = suivante
  }
}

export async function lireTexteLimite(reponse, limite) {
  if (!reponse.body) return { texte: '', tronquee: false }
  const lecteur = reponse.body.getReader()
  const morceaux = []
  let taille = 0
  let tronquee = false
  try {
    while (true) {
      const { done, value } = await lecteur.read()
      if (done) break
      if (!value?.byteLength) continue
      const restante = limite - taille
      if (value.byteLength > restante) {
        if (restante > 0) morceaux.push(value.subarray(0, restante))
        taille += Math.max(0, restante)
        tronquee = true
        await lecteur.cancel()
        break
      }
      morceaux.push(value)
      taille += value.byteLength
      if (taille === limite) {
        // Lire une fois de plus distingue une réponse exactement à la limite
        // d'une réponse dont on masquerait silencieusement la fin.
        let suite
        do {
          suite = await lecteur.read()
        } while (!suite.done && !suite.value?.byteLength)
        if (!suite.done) {
          tronquee = true
          await lecteur.cancel()
        }
        break
      }
    }
  } finally {
    lecteur.releaseLock()
  }
  const donnees = new Uint8Array(taille)
  let position = 0
  for (const morceau of morceaux) {
    donnees.set(morceau, position)
    position += morceau.byteLength
  }
  return { texte: new TextDecoder().decode(donnees), tronquee }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (!origineAutorisee(req, res))
    return res.status(403).json({ erreur: 'Origine non autorisée.' })
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.query.ping !== undefined) {
    return res.status(200).json({ ok: true, service: 'relais cockpit-ll' })
  }

  const cible = typeof req.query.url === 'string' ? req.query.url : ''
  let url
  try {
    url = new URL(cible)
  } catch {
    return res.status(400).json({ erreur: 'Paramètre « url » manquant ou invalide.' })
  }
  if (!urlRelaisAutorisee(url)) {
    return res.status(403).json({ erreur: `Domaine non autorisé : ${url.hostname}` })
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ erreur: 'Méthode non autorisée.' })
  }
  const tailleDeclaree = Number(entete(req.headers['content-length']))
  if (Number.isFinite(tailleDeclaree) && tailleDeclaree > TAILLE_REQUETE_MAX)
    return res.status(413).json({ erreur: 'Requête trop volumineuse.' })

  const controleur = new AbortController()
  const minuteur = setTimeout(() => controleur.abort(), 15_000)
  try {
    const corps =
      req.method === 'POST'
        ? typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body ?? {})
        : undefined
    if (corps && Buffer.byteLength(corps, 'utf8') > TAILLE_REQUETE_MAX)
      return res.status(413).json({ erreur: 'Requête trop volumineuse.' })
    const r = await suivreRedirections(url, {
      method: req.method,
      headers: {
        'User-Agent': 'cockpit-ll (intranet agence, veille AO)',
        ...(corps ? { 'Content-Type': req.headers['content-type'] || 'application/json' } : {}),
      },
      body: corps,
      signal: controleur.signal,
    })
    const { texte, tronquee } = await lireTexteLimite(r, TAILLE_MAX)
    if (tronquee) {
      return res.status(502).json({
        erreur: `La plateforme cible a renvoyé plus de ${TAILLE_MAX / (1024 * 1024)} Mo.`,
      })
    }
    // Une réponse distante ne doit jamais devenir du contenu actif same-origin :
    // le relais est aussi navigable directement, donc on neutralise HTML/SVG/JS.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="relais.txt"')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    return res.status(r.status).send(texte)
  } catch (e) {
    if (e instanceof UrlRelaisInterditeError) {
      return res.status(403).json({ erreur: 'Une redirection a quitté la liste des domaines autorisés.' })
    }
    if (e instanceof TropDeRedirectionsError) {
      return res.status(502).json({ erreur: 'La plateforme cible a effectué trop de redirections.' })
    }
    const delai = e instanceof Error && e.name === 'AbortError'
    return res.status(delai ? 504 : 502).json({ erreur: delai ? 'La plateforme cible n’a pas répondu en 15 s.' : 'Récupération impossible.' })
  } finally {
    clearTimeout(minuteur)
  }
}
