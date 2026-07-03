// ============================================================
// Intelligence locale du journal — deux étages, zéro API payante :
// 1. suggestion de tags DÉTERMINISTE (lexique métier + entités
//    connues de la base : entreprises, lots, phases, personnes) ;
// 2. reconnaissance d'image LOCALE (CLIP zero-shot dans le
//    navigateur via transformers.js — gratuit, en cache, l'image
//    ne quitte pas la machine), avec repli sur le nom du fichier.
// ============================================================

import type { AppState } from './types'
import { fold } from './util'

/** lexique métier : mot détecté (foldé) → tags proposés */
const LEXIQUE: [string, string[]][] = [
  // technique / lots
  ['ascenseur', ['ascenseur', 'lot-technique']],
  ['etancheite', ['etancheite', 'toiture']],
  ['acrotere', ['etancheite', 'toiture']],
  ['toiture', ['toiture']],
  ['charpente', ['charpente', 'bois']],
  ['fissure', ['structure', 'desordre']],
  ['structure', ['structure']],
  ['fondation', ['structure', 'gros-oeuvre']],
  ['beton', ['beton', 'gros-oeuvre']],
  ['gros oeuvre', ['gros-oeuvre']],
  ['maconnerie', ['gros-oeuvre']],
  ['menuiserie', ['menuiseries']],
  ['fenetre', ['menuiseries']],
  ['isolation', ['isolation', 'thermique']],
  ['chauffage', ['cvc', 'lot-technique']],
  ['ventilation', ['cvc', 'lot-technique']],
  ['vmc', ['cvc', 'lot-technique']],
  ['plomberie', ['plomberie', 'lot-technique']],
  ['electricite', ['electricite', 'lot-technique']],
  ['peinture', ['finitions']],
  ['carrelage', ['finitions']],
  ['bardage', ['facade']],
  ['facade', ['facade']],
  ['zinc', ['zinc', 'toiture']],
  ['chanvre', ['biosource', 'chanvre']],
  ['bois', ['bois']],
  ['meleze', ['bois', 'facade']],
  // administratif / phases
  ['permis', ['permis']],
  ['pc ', ['permis']],
  ['urbanisme', ['permis']],
  ['abf', ['permis', 'abf']],
  ['dce', ['dce']],
  ['cctp', ['dce', 'cctp']],
  ['appel d offre', ['ao']],
  ['consultation', ['ao']],
  ['marche', ['marche']],
  ['avenant', ['marche', 'avenant']],
  ['situation', ['situation', 'facturation']],
  ['facture', ['facturation']],
  ['honoraire', ['facturation']],
  ['devis', ['devis']],
  ['assurance', ['assurance']],
  ['decennale', ['assurance']],
  ['reception', ['reception']],
  ['reserve', ['reception', 'reserves']],
  ['reunion', ['reunion']],
  ['chantier', ['chantier']],
  ['visite', ['visite']],
  ['moa', ['moa']],
  ['client', ['moa']],
  ['bet', ['bet']],
  ['planning', ['planning']],
  ['retard', ['planning', 'alerte']],
  ['budget', ['budget']],
  ['sol', ['geotechnique']],
  ['amiante', ['diagnostic', 'amiante']],
  ['diagnostic', ['diagnostic']],
]

/** marqueurs « action à faire » */
const MARQUEURS_ACTION = ['penser a', 'a faire', 'ne pas oublier', 'rappeler', 'relancer', 'verifier', 'prevoir', 'demander', 'envoyer', 'appeler']

export interface SuggestionTags {
  tags: string[]
  /** vrai si la note ressemble à une action à faire */
  action: boolean
}

/** suggestions déterministes : lexique + entités connues de la base */
export function suggererTags(texte: string, state: AppState, projetId?: string): SuggestionTags {
  const t = ' ' + fold(texte) + ' '
  const tags = new Set<string>()

  for (const [mot, ts] of LEXIQUE) {
    if (t.includes(mot)) ts.forEach((x) => tags.add(x))
  }

  // phases mentionnées (ESQ, APS, APD, PRO, DCE, DET, AOR…)
  for (const code of ['esq', 'aps', 'apd', 'pro', 'det', 'aor', 'visa', 'exe', 'opr']) {
    if (new RegExp(`(^|[^a-z])${code}([^a-z]|$)`).test(t)) tags.add(code)
  }

  // entités connues : entreprises des marchés, artisans, personnes de l'équipe
  for (const m of state.marches) {
    if (projetId && m.projetId !== projetId) continue
    if (t.includes(fold(m.entreprise))) tags.add(fold(m.entreprise).replace(/\s+/g, '-'))
  }
  for (const a of state.artisans) {
    if (t.includes(fold(a.nom))) tags.add(fold(a.nom).replace(/\s+/g, '-'))
  }
  for (const materiau of state.materiaux) {
    if (t.includes(fold(materiau.nom))) tags.add('materiau')
  }

  const action = MARQUEURS_ACTION.some((m) => t.includes(m))
  if (action) tags.add('a-faire')

  return { tags: [...tags].slice(0, 8), action }
}

// ------------------------------------------------------------------
// Reconnaissance d'image locale (CLIP zero-shot)
// ------------------------------------------------------------------

/** libellés anglais (CLIP comprend mieux l'anglais) → tags français */
const LABELS_CLIP: [string, string[]][] = [
  ['a construction site', ['chantier']],
  ['a building facade', ['facade']],
  ['a roof under construction', ['toiture', 'chantier']],
  ['exposed concrete structure', ['beton', 'structure']],
  ['brick or masonry wall', ['gros-oeuvre']],
  ['timber or wood construction', ['bois']],
  ['wood cladding on a building', ['bois', 'facade']],
  ['a window or glazing detail', ['menuiseries']],
  ['thermal insulation material', ['isolation']],
  ['a crack in a wall', ['desordre', 'structure']],
  ['water damage or damp stain', ['desordre', 'humidite']],
  ['an architectural drawing or floor plan', ['plan', 'document']],
  ['a technical document or invoice', ['document']],
  ['an interior room', ['interieur']],
  ['a staircase or elevator shaft', ['circulations']],
  ['scaffolding on a building', ['chantier', 'facade']],
  ['a landscape or building exterior', ['exterieur']],
  ['electrical or plumbing installation', ['lot-technique']],
]

let clipCharge: Promise<unknown> | null = null

async function getClip() {
  if (!clipCharge) {
    clipCharge = (async () => {
      const { pipeline } = await import('@huggingface/transformers')
      const webgpu = 'gpu' in navigator
      return pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', {
        device: webgpu ? 'webgpu' : 'wasm',
      })
    })()
    clipCharge.catch(() => {
      clipCharge = null
    })
  }
  return clipCharge
}

/** repli déterministe : tags depuis le nom du fichier */
export function tagsDepuisNomFichier(nom: string): string[] {
  const { tags } = suggererTags(nom.replace(/[-_.]/g, ' '), { marches: [], artisans: [], materiaux: [] } as unknown as AppState)
  return tags
}

/**
 * Tags automatiques d'une image, en local (CLIP zero-shot). Retourne les
 * tags français des 3 meilleurs libellés au-dessus du seuil, ou le repli
 * « nom de fichier » si le modèle n'est pas chargeable (hors-ligne).
 */
export async function taggerImage(file: File, onEtat?: (m: string) => void): Promise<{ tags: string[]; via: 'clip' | 'nom' }> {
  try {
    onEtat?.('Chargement du modèle de reconnaissance (1er usage : ~150 Mo, puis en cache)…')
    const clip = (await getClip()) as (
      image: string,
      labels: string[],
    ) => Promise<{ label: string; score: number }[]>
    onEtat?.("Analyse de l'image en local…")
    const url = URL.createObjectURL(file)
    try {
      const sorties = await clip(url, LABELS_CLIP.map(([l]) => l))
      const tags = new Set<string>()
      for (const s of sorties.slice(0, 3)) {
        if (s.score < 0.12) continue
        const entree = LABELS_CLIP.find(([l]) => l === s.label)
        entree?.[1].forEach((x) => tags.add(x))
      }
      tags.add('photo')
      return { tags: [...tags], via: 'clip' }
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return { tags: [...new Set(['photo', ...tagsDepuisNomFichier(file.name)])], via: 'nom' }
  }
}
