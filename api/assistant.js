// ============================================================
// Assistant du Cockpit — fonction serverless qui parle à l'API
// Anthropic. La clé vit dans la variable d'environnement
// ANTHROPIC_API_KEY (réglages Vercel) et ne touche JAMAIS le
// navigateur : le téléphone parle au Cockpit, le Cockpit parle
// à Claude.
//
// Trois usages (champ `mode`) :
//   - 'qa'  : question réglementaire sur le corpus fourni
//   - 'cr'  : recherche / question sur les comptes-rendus fournis
//   - 'doc' : rédaction d'un document depuis un modèle + contexte projet
//
// Maîtrise du coût :
//   - cache de prompt sur le corpus (les questions répétées relisent
//     les textes à −90 %) ;
//   - modèle standard économique, escalade uniquement si demandée.
// Garde-fous : réponse UNIQUEMENT à partir des textes fournis (sinon
// « pas trouvé dans les sources »), tout est « brouillon à relire ».
// ============================================================

const MODELE_STANDARD = process.env.ASSISTANT_MODELE || 'claude-sonnet-5'
const MODELE_DIFFICILE = process.env.ASSISTANT_MODELE_DIFFICILE || 'claude-opus-4-8'
const MAX_DOCS = 24
const MAX_CARACTERES_DOC = 120000

/** consigne système selon l'usage */
function consigne(mode) {
  const socle =
    'Tu es l’assistant interne d’une agence d’architecture française de deux personnes. ' +
    'Tu réponds en français, de façon précise et sobre. ' +
    'RÈGLE ABSOLUE : tu ne t’appuies QUE sur les documents fournis dans ce prompt. ' +
    'Si la réponse ne s’y trouve pas, tu réponds exactement : « Pas trouvé dans les sources fournies. » ' +
    'Tout ce que tu produis est un BROUILLON que l’architecte relit avant usage.'
  if (mode === 'qa')
    return (
      socle +
      ' Pour chaque affirmation réglementaire, CITE le document source : nom du document et passage exact entre guillemets, sous la forme « Source : [nom] — “extrait” ». ' +
      'Termine par la liste des sources utilisées.'
    )
  if (mode === 'cr')
    return (
      socle +
      ' Les documents fournis sont des comptes-rendus de chantier. Réponds à la question en citant le CR source (titre + date) et le passage concerné.'
    )
  return (
    socle +
    ' On te fournit un document MODÈLE et le contexte d’un projet. Rédige le document demandé en suivant la structure du modèle, adapté aux données du projet. ' +
    'Là où une information manque, écris ⟦à compléter : …⟧ plutôt que d’inventer.'
  )
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.query && req.query.ping !== undefined) {
    return res.status(200).json({ ok: Boolean(process.env.ANTHROPIC_API_KEY), service: 'assistant cockpit-ll' })
  }
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'POST attendu.' })

  const cle = process.env.ANTHROPIC_API_KEY
  if (!cle) {
    return res.status(501).json({
      erreur:
        'Assistant non configuré : ajoutez la variable d’environnement ANTHROPIC_API_KEY dans les réglages Vercel du projet.',
    })
  }

  const corps = req.body || {}
  const mode = corps.mode === 'cr' || corps.mode === 'doc' ? corps.mode : 'qa'
  const question = typeof corps.question === 'string' ? corps.question.trim() : ''
  const documents = Array.isArray(corps.documents) ? corps.documents.slice(0, MAX_DOCS) : []
  const contexte = typeof corps.contexte === 'string' ? corps.contexte : ''
  const difficile = corps.niveau === 'difficile'

  if (!question) return res.status(400).json({ erreur: 'Question vide.' })
  if (documents.length === 0)
    return res.status(400).json({ erreur: 'Aucun document fourni — l’assistant ne répond qu’à partir de sources.' })

  // corpus en blocs système : le dernier bloc porte le cache (préfixe stable → −90 % aux questions suivantes)
  const blocs = documents.map((d, i) => ({
    type: 'text',
    text:
      `[DOCUMENT ${i + 1} — ${String(d.titre || 'sans titre')}` +
      (d.source ? ` | Source : ${String(d.source)}` : '') +
      `]\n${String(d.texte || '').slice(0, MAX_CARACTERES_DOC)}`,
  }))
  blocs[blocs.length - 1].cache_control = { type: 'ephemeral' }

  let reponseApi
  try {
    reponseApi = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cle,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: difficile ? MODELE_DIFFICILE : MODELE_STANDARD,
        max_tokens: 3500,
        system: [{ type: 'text', text: consigne(mode) }, ...blocs],
        messages: [{ role: 'user', content: contexte ? `${contexte}\n\n---\n\n${question}` : question }],
      }),
    })
  } catch {
    return res.status(502).json({ erreur: 'API Anthropic injoignable depuis le serveur.' })
  }

  const json = await reponseApi.json().catch(() => null)
  if (!reponseApi.ok) {
    const detail = json && json.error && json.error.message ? json.error.message : `HTTP ${reponseApi.status}`
    return res.status(502).json({ erreur: `API Anthropic : ${detail}` })
  }

  const texte = (json.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
  return res.status(200).json({ reponse: texte, modele: json.model, usage: json.usage })
}
