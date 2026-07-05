// ============================================================
// Veille BOAMP intégrée — l'API OUVERTE et GRATUITE de la DILA
// (annonces officielles de marchés publics, opendatasoft).
// Le navigateur interroge directement le jeu de données « boamp » :
// pas de clé, pas de serveur, CORS ouvert, quota très large.
// La routine Claude reste utile pour TED / sources privées.
// ============================================================

const BASE = 'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records'

/** une annonce, quelle que soit la plateforme (BOAMP direct, TED via relais…) */
export interface AnnonceExterne {
  idweb: string
  objet: string
  acheteur: string
  dateParution: string
  /** ISO date limite de réponse, ou null si non renseignée */
  dateLimite: string | null
  departements: string[]
  /** Travaux / Services / Fournitures */
  typeMarche: string
  nature: string
  url: string
  plateforme: 'BOAMP' | 'TED'
}

export type AnnonceBoamp = AnnonceExterne

export interface CriteresBoamp {
  /** mots-clés séparés par des virgules — un OU entre chaque */
  motsCles: string
  /** départements séparés par des virgules (ex. « 60, 80, 02 ») — vide = France entière */
  departements: string
  /** '' = tous, sinon Services (MOE) ou Travaux */
  typeMarche: string
  /** fenêtre de parution en jours */
  depuisJours: number
}

/** zone de chalandise par défaut : Hauts-de-France + Normandie + Île-de-France, au complet */
export const DEPARTEMENTS_DEFAUT =
  '02, 59, 60, 62, 80, 14, 27, 50, 61, 76, 75, 77, 78, 91, 92, 93, 94, 95'

export const CRITERES_DEFAUT: CriteresBoamp = {
  motsCles: "maîtrise d'oeuvre, réhabilitation, architecte",
  departements: DEPARTEMENTS_DEFAUT,
  typeMarche: 'Services',
  depuisJours: 30,
}

/** échappe une valeur pour une chaîne ODSQL entre guillemets doubles */
function q(v: string): string {
  return `"${v.replace(/"/g, '\\"')}"`
}

function clauseWhere(c: CriteresBoamp, aujourdhui: string): string {
  // uniquement les vrais avis de marché : les « résultats », rectificatifs
  // et annulations sont du bruit pour la prospection
  const clauses: string[] = ['nature_libelle = "Avis de marché"']

  // mots-clés cherchés dans l'OBJET seulement — le plein-texte global
  // remontait n'importe quoi (un cahier des charges qui cite « architecte »…)
  const mots = c.motsCles.split(',').map((m) => m.trim()).filter(Boolean)
  if (mots.length > 0) clauses.push(`(${mots.map((m) => `search(objet,${q(m)})`).join(' OR ')})`)

  const deps = c.departements
    .split(',')
    .map((d) => d.trim().replace(/^0?(\d)$/, '0$1'))
    .filter(Boolean)
  if (deps.length > 0) clauses.push(`code_departement IN (${deps.map(q).join(',')})`)

  if (c.typeMarche) clauses.push(`type_marche_facette = ${q(c.typeMarche)}`)

  const d = new Date(`${aujourdhui}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - Math.max(1, c.depuisJours || 30))
  clauses.push(`dateparution >= date'${d.toISOString().slice(0, 10)}'`)

  return clauses.join(' AND ')
}

interface RecordBoamp {
  idweb?: string
  objet?: string
  nomacheteur?: string
  dateparution?: string
  datelimitereponse?: string
  code_departement?: string[] | string
  type_marche_facette?: string[] | string
  nature_libelle?: string
  url_avis?: string
}

const CLE_DERNIERE = 'cockpit-ll-boamp-derniere'

export interface DerniereRechercheBoamp {
  date: string // ISO datetime
  nb: number
  erreur?: string
}

export function derniereRechercheBoamp(): DerniereRechercheBoamp | null {
  try {
    return JSON.parse(localStorage.getItem(CLE_DERNIERE) || 'null')
  } catch {
    return null
  }
}

function memoriser(r: DerniereRechercheBoamp): void {
  try {
    localStorage.setItem(CLE_DERNIERE, JSON.stringify(r))
  } catch {
    // stockage plein : sans gravité
  }
}

/** interroge le BOAMP — lève une Error au message lisible en cas de panne */
export async function rechercherBoamp(
  criteres: CriteresBoamp,
  aujourdhui: string,
  limite = 30,
): Promise<AnnonceBoamp[]> {
  const params = new URLSearchParams({
    where: clauseWhere(criteres, aujourdhui),
    order_by: 'dateparution desc',
    limit: String(limite),
    select:
      'idweb,objet,nomacheteur,dateparution,datelimitereponse,code_departement,type_marche_facette,nature_libelle,url_avis',
  })
  let r: Response
  try {
    r = await fetch(`${BASE}?${params}`)
  } catch {
    memoriser({ date: new Date().toISOString(), nb: 0, erreur: 'réseau injoignable' })
    throw new Error('BOAMP injoignable — vérifiez la connexion internet.')
  }
  if (!r.ok) {
    const corps = (await r.json().catch(() => null)) as { message?: string } | null
    memoriser({ date: new Date().toISOString(), nb: 0, erreur: `HTTP ${r.status}` })
    throw new Error(corps?.message ? `BOAMP : ${corps.message}` : `BOAMP a répondu ${r.status}.`)
  }
  let data: { results?: RecordBoamp[] }
  try {
    data = (await r.json()) as { results?: RecordBoamp[] }
  } catch {
    memoriser({ date: new Date().toISOString(), nb: 0, erreur: 'réponse illisible' })
    throw new Error('Réponse BOAMP illisible — service momentanément indisponible ?')
  }
  const annonces = (data.results || [])
    .filter((x) => x.idweb && x.objet)
    // date limite dépassée = plus la peine d'y penser
    .filter((x) => !x.datelimitereponse || x.datelimitereponse.slice(0, 10) >= aujourdhui)
    .map((x) => ({
      idweb: x.idweb!,
      objet: x.objet!,
      acheteur: x.nomacheteur || '',
      dateParution: x.dateparution || '',
      dateLimite: x.datelimitereponse ? x.datelimitereponse.slice(0, 10) : null,
      departements: Array.isArray(x.code_departement)
        ? x.code_departement
        : x.code_departement
          ? [x.code_departement]
          : [],
      typeMarche: Array.isArray(x.type_marche_facette)
        ? x.type_marche_facette.join(', ')
        : x.type_marche_facette || '',
      nature: x.nature_libelle || '',
      url: x.url_avis || `https://www.boamp.fr/pages/avis/?q=idweb:${x.idweb}`,
      plateforme: 'BOAMP' as const,
    }))
  memoriser({ date: new Date().toISOString(), nb: annonces.length })
  return annonces
}
