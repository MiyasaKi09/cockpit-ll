// Client de l'assistant (api/assistant.js) — la clé Anthropic vit
// côté serveur (variable ANTHROPIC_API_KEY sur Vercel), jamais dans
// le navigateur. En local sans déploiement, l'assistant est absent :
// tout le reste du Cockpit fonctionne normalement.

import { jetonAccesSync } from './sync'

/** document envoyé à l'assistant (extrait du corpus ou CR de réunion) */
export interface DocPourAssistant {
  titre: string
  source?: string
  texte: string
  /** garde supplémentaire : un document local privé est refusé avant le réseau */
  prive?: boolean
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
  'Assistant non configuré : vérifiez les variables ANTHROPIC_API_KEY, SUPABASE_URL, clé publique et AGENCE_EMAILS dans Vercel. ' +
  'L’assistant ne fonctionne que sur le site déployé (jamais de clé dans le navigateur).'

let dispo: boolean | null = null
let jetonTeste: string | null = null

/** l'assistant répond-il ? Les succès sont mémorisés ; un échec transitoire est retenté. */
export async function assistantDisponible(): Promise<boolean> {
  const jeton = await jetonAccesSync()
  if (!jeton) {
    dispo = false
    jetonTeste = null
    return false
  }
  if (dispo === true && jetonTeste === jeton) return true
  try {
    const r = await fetch('/api/assistant?ping=1', {
      headers: { Authorization: `Bearer ${jeton}` },
    })
    const j = (await r.json()) as { ok?: boolean }
    dispo = r.ok && j.ok === true
    jetonTeste = jeton
  } catch {
    dispo = null
    jetonTeste = jeton
    return false
  }
  return dispo === true
}

/** pose une question à l'assistant ; lève une Error au message lisible */
export async function interrogerAssistant(demande: DemandeAssistant): Promise<ReponseAssistant> {
  if (demande.documents.some((document) => document.prive)) {
    throw new Error('Les documents privés restent locaux et ne peuvent pas être envoyés à l’assistant.')
  }
  const jeton = await jetonAccesSync()
  if (!jeton) {
    throw new Error(
      'Connectez d’abord ce poste à Supabase dans Paramètres → Branchements : l’assistant exige une session vérifiée.',
    )
  }
  let r: Response
  try {
    r = await fetch('/api/assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jeton}`,
      },
      body: JSON.stringify(demande),
    })
  } catch {
    throw new Error('Assistant injoignable — vérifiez la connexion (site déployé uniquement).')
  }
  if (r.status === 404 || r.status === 501) throw new Error(MESSAGE_NON_CONFIGURE)
  if (r.status === 401)
    throw new Error('Session expirée : reconnectez ce poste à Supabase avant d’utiliser l’assistant.')
  if (r.status === 403)
    throw new Error('Ce compte n’est pas autorisé à utiliser l’assistant de l’agence.')
  const json = (await r.json().catch(() => null)) as { reponse?: string; modele?: string; erreur?: string } | null
  if (!r.ok || !json || typeof json.reponse !== 'string') {
    throw new Error(json?.erreur || `Assistant : HTTP ${r.status}.`)
  }
  return { reponse: json.reponse, modele: json.modele }
}
