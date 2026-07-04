// ============================================================
// TED — les marchés européens (Tenders Electronic Daily), via le
// relais Vercel : l'API officielle de l'UE est gratuite mais
// n'accepte pas les appels directs depuis un navigateur (CORS).
// France entière : au-dessus des seuils européens, la zone de
// chalandise dépasse de toute façon les départements voisins.
// ============================================================

import type { AnnonceExterne, CriteresBoamp } from './boamp'
import { viaRelais } from './relais'

const API = 'https://api.ted.europa.eu/v3/notices/search'

interface NoticeTed {
  'publication-number'?: string
  'notice-title'?: Record<string, string | string[]>
  'buyer-name'?: Record<string, string | string[]>
  'publication-date'?: string
  'deadline-receipt-tender-date-lot'?: string[]
}

function premierTexte(v: Record<string, string | string[]> | undefined): string {
  if (!v) return ''
  const brut = v['fra'] ?? Object.values(v)[0]
  const x = Array.isArray(brut) ? brut[0] : brut
  return x || ''
}

/** interroge TED via le relais — mêmes critères que le BOAMP (les départements ne s'y appliquent pas) */
export async function rechercherTed(
  criteres: CriteresBoamp,
  aujourdhui: string,
  limite = 15,
): Promise<AnnonceExterne[]> {
  const mots = criteres.motsCles.split(',').map((m) => m.trim()).filter(Boolean)
  if (mots.length === 0) return []
  const d = new Date(`${aujourdhui}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - Math.max(1, criteres.depuisJours || 30))
  const depuis = d.toISOString().slice(0, 10).replaceAll('-', '')

  const query =
    `(notice-title ~ (${mots.map((m) => `"${m.replace(/"/g, '')}"`).join(' OR ')}))` +
    ` AND buyer-country IN (FRA) AND publication-date > ${depuis} SORT BY publication-date DESC`

  const brut = await viaRelais(API, {
    method: 'POST',
    body: JSON.stringify({
      query,
      fields: ['publication-number', 'notice-title', 'buyer-name', 'publication-date', 'deadline-receipt-tender-date-lot'],
      limit: limite,
    }),
  })
  const data = JSON.parse(brut) as { notices?: NoticeTed[] }

  return (data.notices || [])
    .filter((n) => n['publication-number'])
    .map((n) => {
      const num = n['publication-number']!
      const lim = n['deadline-receipt-tender-date-lot']?.[0]
      return {
        idweb: num,
        objet: premierTexte(n['notice-title']) || '(sans titre)',
        acheteur: premierTexte(n['buyer-name']),
        dateParution: (n['publication-date'] || '').slice(0, 10),
        dateLimite: lim ? lim.slice(0, 10) : null,
        departements: [],
        typeMarche: '',
        nature: 'Avis TED',
        url: `https://ted.europa.eu/fr/notice/${num}`,
        plateforme: 'TED' as const,
      }
    })
    .filter((a) => !a.dateLimite || a.dateLimite >= aujourdhui)
}
