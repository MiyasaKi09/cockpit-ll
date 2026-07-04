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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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
  if (url.protocol !== 'https:' || !DOMAINES_AUTORISES.has(url.hostname)) {
    return res.status(403).json({ erreur: `Domaine non autorisé : ${url.hostname}` })
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ erreur: 'Méthode non autorisée.' })
  }

  const controleur = new AbortController()
  const minuteur = setTimeout(() => controleur.abort(), 15_000)
  try {
    const corps =
      req.method === 'POST'
        ? typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body ?? {})
        : undefined
    const r = await fetch(url, {
      method: req.method,
      headers: {
        'User-Agent': 'cockpit-ll (intranet agence, veille AO)',
        ...(corps ? { 'Content-Type': req.headers['content-type'] || 'application/json' } : {}),
      },
      body: corps,
      signal: controleur.signal,
      redirect: 'follow',
    })
    const texte = await r.text()
    res.setHeader('Content-Type', r.headers.get('content-type') || 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=300')
    return res.status(r.status).send(texte.length > TAILLE_MAX ? texte.slice(0, TAILLE_MAX) : texte)
  } catch (e) {
    const delai = e instanceof Error && e.name === 'AbortError'
    return res.status(504).json({ erreur: delai ? 'La plateforme cible n’a pas répondu en 15 s.' : 'Récupération impossible.' })
  } finally {
    clearTimeout(minuteur)
  }
}
