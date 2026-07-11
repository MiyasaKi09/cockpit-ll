// ============================================================
// Radar — présélection EXPLICABLE des annonces (audit V3, Lot 2).
// Score 0-100 100 % déterministe : chaque point vient d'une règle
// lisible (références, mission, délai, zone, qualité de l'info),
// chaque carte porte ses raisons, son risque et ses inconnues.
// Une inconnue ne produit JAMAIS un rejet — elle est affichée.
// ============================================================

import type { AnnonceExterne } from './boamp'
import type { AppState, Reference } from './types'
import { diffDays, fold } from './util'

export interface ScoreRadar {
  /** 0-100 — plus c'est haut, plus l'affaire mérite l'attention */
  score: number
  confiance: 'élevée' | 'moyenne' | 'faible'
  /** raisons positives (3 max affichées) */
  raisons: string[]
  /** le risque principal, s'il y en a un */
  risque?: string
  /** ce qu'on ne sait pas encore — jamais transformé en malus caché */
  inconnues: string[]
}

/** mots significatifs d'un texte (≥ 4 lettres, sans articles) */
function motsDe(texte: string): Set<string> {
  const VIDES = new Set(['dans', 'pour', 'avec', 'sans', 'sous', 'chez', 'leur', 'dont', 'ainsi', 'travaux', 'marche'])
  return new Set(
    fold(texte)
      .split(/[^a-z0-9]+/)
      .filter((m) => m.length >= 4 && !VIDES.has(m)),
  )
}

/** références de l'agence proches de l'annonce (mots-clés ⇄ objet) */
function referencesProches(refs: Reference[], a: AnnonceExterne): Reference[] {
  const texte = motsDe(`${a.objet} ${(a.descripteurs || []).join(' ')}`)
  return refs.filter((r) => {
    const cles = [...(r.motsCles || []), r.nom]
    return cles.some((c) => {
      const mc = motsDe(c)
      for (const m of mc) if (texte.has(m)) return true
      return false
    })
  })
}

/** score déterministe d'une annonce pour L'AGENCE (règles lisibles) */
export function scorerAnnonce(state: AppState, a: AnnonceExterne, today: string): ScoreRadar {
  const raisons: string[] = []
  const inconnues: string[] = []
  let risque: string | undefined
  let score = 0

  // --- références (0-30) : le premier critère de crédibilité d'une candidature
  const refs = referencesProches(state.references, a)
  if (refs.length >= 3) {
    score += 30
    raisons.push(`${refs.length} références proches (${refs.slice(0, 2).map((r) => r.nom).join(', ')}…)`)
  } else if (refs.length > 0) {
    score += 12 + refs.length * 6
    raisons.push(`${refs.length} référence(s) proche(s) : ${refs.map((r) => r.nom).join(', ')}`)
  } else {
    inconnues.push('aucune référence évidente — vérifier la base références')
  }

  // --- mission (0-25) : maîtrise d'œuvre explicite > mots du métier
  const descripteurs = (a.descripteurs || []).join(' ')
  const texteMission = fold(`${a.objet} ${descripteurs}`)
  if (/maitrise d.oeuvre|maitrise d oeuvre/.test(fold(descripteurs))) {
    score += 25
    raisons.push('descripteur officiel « Maîtrise d\'œuvre »')
  } else if (/architecte|maitrise d.oeuvre|moe\b/.test(texteMission)) {
    score += 18
    raisons.push('mission de maîtrise d\'œuvre / architecte citée dans l\'objet')
  } else if (/rehabilitation|restructuration|extension|construction/.test(texteMission)) {
    score += 10
    raisons.push('opération de bâtiment dans le périmètre de l\'agence')
  }

  // --- délai (0-20) : un dossier se prépare, pas se bâcle
  const dj = a.dateLimite ? diffDays(today, a.dateLimite) : null
  if (dj === null) {
    score += 8
    inconnues.push('date limite non publiée dans l\'avis')
  } else if (dj >= 21) {
    score += 20
    raisons.push(`${dj} jours pour répondre`)
  } else if (dj >= 10) {
    score += 12
  } else {
    score += 4
    risque = `délai court : J−${dj}`
  }

  // --- zone (0-15) : les annonces sont déjà filtrées sur la zone de chalandise
  if (a.departements.length > 0) {
    score += 15
    raisons.push(`département ${a.departements.join(', ')} — zone de l'agence`)
  } else {
    score += 8
    inconnues.push('localisation précise à vérifier (avis TED)')
  }

  // --- qualité de l'info (0-10)
  if (a.dateLimite) score += 5
  if (a.acheteur) score += 5
  else inconnues.push('acheteur non identifié')
  inconnues.push('budget non publié dans l\'avis') // BOAMP/TED ne le donnent presque jamais

  // --- concours : parcours différent, à lire dans le règlement
  if (a.typeAvis === 'concours') {
    raisons.push(`concours (${a.procedure || 'procédure à vérifier'})`)
    inconnues.push('prime, nombre de candidats et livrables à lire dans le règlement')
  }

  const confiance = inconnues.length <= 1 ? 'élevée' : inconnues.length <= 3 ? 'moyenne' : 'faible'
  return { score: Math.min(100, score), confiance, raisons, risque, inconnues }
}

/** seuils de lecture du score (audit V3 §6.3) */
export function toneScore(score: number): 'ok' | 'info' | 'warn' | 'muted' {
  if (score >= 75) return 'ok'
  if (score >= 60) return 'info'
  if (score >= 40) return 'warn'
  return 'muted'
}
