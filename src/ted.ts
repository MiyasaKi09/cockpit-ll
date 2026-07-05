// ============================================================
// TED — les marchés européens (Tenders Electronic Daily), via le
// relais Vercel : l'API officielle de l'UE est gratuite mais
// n'accepte pas les appels directs depuis un navigateur (CORS).
// Localisé sur les MÊMES départements que le BOAMP grâce aux
// codes NUTS 3 (place-of-performance). Les rares avis déclarés
// « France entière » sans localisation sont écartés — c'est le
// prix d'une liste sans bruit.
// ============================================================

import type { AnnonceExterne, CriteresBoamp } from './boamp'
import { viaRelais } from './relais'

const API = 'https://api.ted.europa.eu/v3/notices/search'

/** département français → code NUTS 3 (nomenclature 2021, celle de TED) */
export const NUTS3_PAR_DEPT: Record<string, string> = {
  '01': 'FRK21', '02': 'FRE21', '03': 'FRK11', '04': 'FRL01', '05': 'FRL02',
  '06': 'FRL03', '07': 'FRK22', '08': 'FRF21', '09': 'FRJ21', '10': 'FRF22',
  '11': 'FRJ11', '12': 'FRJ22', '13': 'FRL04', '14': 'FRD11', '15': 'FRK12',
  '16': 'FRI31', '17': 'FRI32', '18': 'FRB01', '19': 'FRI21', '21': 'FRC11',
  '22': 'FRH01', '23': 'FRI22', '24': 'FRI11', '25': 'FRC21', '26': 'FRK23',
  '27': 'FRD21', '28': 'FRB02', '29': 'FRH02', '2A': 'FRM01', '2B': 'FRM02',
  '30': 'FRJ12', '31': 'FRJ23', '32': 'FRJ24', '33': 'FRI12', '34': 'FRJ13',
  '35': 'FRH03', '36': 'FRB03', '37': 'FRB04', '38': 'FRK24', '39': 'FRC22',
  '40': 'FRI13', '41': 'FRB05', '42': 'FRK25', '43': 'FRK13', '44': 'FRG01',
  '45': 'FRB06', '46': 'FRJ25', '47': 'FRI14', '48': 'FRJ14', '49': 'FRG02',
  '50': 'FRD12', '51': 'FRF23', '52': 'FRF24', '53': 'FRG03', '54': 'FRF31',
  '55': 'FRF32', '56': 'FRH04', '57': 'FRF33', '58': 'FRC12', '59': 'FRE11',
  '60': 'FRE22', '61': 'FRD13', '62': 'FRE12', '63': 'FRK14', '64': 'FRI15',
  '65': 'FRJ26', '66': 'FRJ15', '67': 'FRF11', '68': 'FRF12', '69': 'FRK26',
  '70': 'FRC23', '71': 'FRC13', '72': 'FRG04', '73': 'FRK27', '74': 'FRK28',
  '75': 'FR101', '76': 'FRD22', '77': 'FR102', '78': 'FR103', '79': 'FRI33',
  '80': 'FRE23', '81': 'FRJ27', '82': 'FRJ28', '83': 'FRL05', '84': 'FRL06',
  '85': 'FRG05', '86': 'FRI34', '87': 'FRI23', '88': 'FRF34', '89': 'FRC14',
  '90': 'FRC24', '91': 'FR104', '92': 'FR105', '93': 'FR106', '94': 'FR107',
  '95': 'FR108', '971': 'FRY10', '972': 'FRY20', '973': 'FRY30', '974': 'FRY40', '976': 'FRY50',
}

/** « 60, 80, 02 » → codes NUTS 3 connus */
export function nutsDepuisDepartements(departements: string): string[] {
  return departements
    .split(',')
    .map((d) => d.trim().toUpperCase().replace(/^0?(\d)$/, '0$1'))
    .filter(Boolean)
    .map((d) => NUTS3_PAR_DEPT[d])
    .filter(Boolean)
}

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

/** interroge TED via le relais — mêmes critères que le BOAMP, départements inclus (NUTS 3) */
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
  const nuts = nutsDepuisDepartements(criteres.departements)

  const query =
    `(notice-title ~ (${mots.map((m) => `"${m.replace(/"/g, '')}"`).join(' OR ')}))` +
    ` AND buyer-country IN (FRA)` +
    (nuts.length > 0 ? ` AND place-of-performance IN (${nuts.join(' ')})` : '') +
    ` AND publication-date > ${depuis} SORT BY publication-date DESC`

  const brut = await viaRelais(API, {
    method: 'POST',
    body: JSON.stringify({
      query,
      fields: ['publication-number', 'notice-title', 'buyer-name', 'publication-date', 'deadline-receipt-tender-date-lot'],
      limit: limite,
    }),
  })
  let data: { notices?: NoticeTed[] }
  try {
    data = JSON.parse(brut) as { notices?: NoticeTed[] }
  } catch {
    throw new Error('Réponse TED illisible — service momentanément indisponible ?')
  }

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
        url: `https://ted.europa.eu/fr/notice/-/detail/${num}`,
        plateforme: 'TED' as const,
      }
    })
    .filter((a) => !a.dateLimite || a.dateLimite >= aujourdhui)
}
