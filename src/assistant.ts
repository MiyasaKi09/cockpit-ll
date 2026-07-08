// Client de l'assistant (api/assistant.js) — la clé Anthropic vit
// côté serveur (variable ANTHROPIC_API_KEY sur Vercel), jamais dans
// le navigateur. En local sans déploiement, l'assistant est absent :
// tout le reste du Cockpit fonctionne normalement.

/** document envoyé à l'assistant (extrait du corpus ou CR de réunion) */
export interface DocPourAssistant {
  titre: string
  source?: string
  texte: string
}

export interface DemandeAssistant {
  mode: 'qa' | 'cr' | 'doc'
  question: string
  documents: DocPourAssistant[]
  /** contexte additionnel (fiche projet…) préfixé à la question */
  contexte?: string
  /** 'difficile' → modèle renforcé (plus cher, à réserver aux cas durs) */
  niveau?: 'standard' | 'difficile'
}

export interface ReponseAssistant {
  reponse: string
  modele?: string
}

const MESSAGE_NON_CONFIGURE =
  'Assistant non configuré : ajoutez la variable ANTHROPIC_API_KEY dans les réglages Vercel. ' +
  'L’assistant ne fonctionne que sur le site déployé (jamais de clé dans le navigateur).'

let dispo: boolean | null = null

/** l'assistant répond-il ? (mémorisé pour la session) */
export async function assistantDisponible(): Promise<boolean> {
  if (dispo !== null) return dispo
  try {
    const r = await fetch('/api/assistant?ping=1')
    const j = (await r.json()) as { ok?: boolean }
    dispo = r.ok && j.ok === true
  } catch {
    dispo = false
  }
  return dispo
}

/** pose une question à l'assistant ; lève une Error au message lisible */
export async function interrogerAssistant(demande: DemandeAssistant): Promise<ReponseAssistant> {
  let r: Response
  try {
    r = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(demande),
    })
  } catch {
    throw new Error('Assistant injoignable — vérifiez la connexion (site déployé uniquement).')
  }
  if (r.status === 404 || r.status === 501) throw new Error(MESSAGE_NON_CONFIGURE)
  const json = (await r.json().catch(() => null)) as { reponse?: string; modele?: string; erreur?: string } | null
  if (!r.ok || !json || typeof json.reponse !== 'string') {
    throw new Error(json?.erreur || `Assistant : HTTP ${r.status}.`)
  }
  return { reponse: json.reponse, modele: json.modele }
}
