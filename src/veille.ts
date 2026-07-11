// ============================================================
// Veille serveur — le versant navigateur de veille-collecte :
// le Radar lit les signaux collectés toutes les 4 h (BOAMP + TED)
// dans la table partagée, même si aucun onglet n'était ouvert à
// la parution. Accès via la session du lien magique (RLS agence).
// ============================================================

import type { AnnonceExterne, EvenementBoamp } from './boamp'
import { clientSupabase } from './sync'

/** libellé d'affichage par identifiant de source */
const LABELS: Record<string, string> = {
  boamp: 'BOAMP',
  ted: 'TED',
  aws: 'AWS',
  place: 'PLACE',
  maximilien: 'MAXIMILIEN',
  emp: 'E-MARCHESPUBLICS',
  klekoon: 'KLEKOON',
  marchesonline: 'MARCHÉSONLINE',
  megalis: 'MÉGALIS',
  ternum: 'TERNUM BFC',
  marchessecurises: 'M. SÉCURISÉS',
  mails: 'ALERTES MAIL',
}

export function labelSource(source: string): string {
  return LABELS[source] || source.toUpperCase()
}

interface LigneSignal {
  source: string
  source_id: string
  type: 'initial' | 'rectificatif' | 'modification' | 'annulation' | 'resultat'
  type_avis: 'marche' | 'concours'
  objet: string
  acheteur: string | null
  date_parution: string | null
  date_limite: string | null
  departements: string[] | null
  procedure: string | null
  descripteurs: string[] | null
  annonces_liees: string[] | null
  url: string | null
}

export interface CollecteVeille {
  source: string
  termineLe: string | null
  statut: string
  nbNouveaux: number
  nbMaj: number
}

/** signaux du serveur → annonces du Radar + événements de cycle de vie.
 *  null = espace partagé non connecté (le Radar retombe sur la recherche directe). */
export async function listerSignauxVeille(
  aujourdhui: string,
): Promise<{ annonces: AnnonceExterne[]; evenements: EvenementBoamp[] } | null> {
  const sb = clientSupabase()
  if (!sb) return null
  const { data, error } = await sb
    .from('veille_signaux')
    .select(
      'source,source_id,type,type_avis,objet,acheteur,date_parution,date_limite,departements,procedure,descripteurs,annonces_liees,url,cle_canonique',
    )
    .order('date_parution', { ascending: false })
    .limit(250)
  if (error) throw new Error(`Signaux illisibles : ${error.message}`)
  const lignes = (data || []) as LigneSignal[]

  // FUSION multi-source : une même consultation vue sur plusieurs
  // plateformes = UNE carte, BOAMP/TED servant de pivot (audit V3 §7)
  const parCle = new Map<string, AnnonceExterne>()
  for (const l of lignes) {
    if (l.type !== 'initial') continue
    if (l.date_limite && l.date_limite < aujourdhui) continue
    const label = labelSource(l.source)
    const pivot = l.source === 'boamp' || l.source === 'ted'
    const a: AnnonceExterne = {
      idweb: l.source_id,
      objet: l.objet,
      acheteur: l.acheteur || '',
      dateParution: l.date_parution || '',
      dateLimite: l.date_limite,
      departements: l.departements || [],
      typeMarche: '',
      nature: l.source === 'ted' ? 'Avis TED' : 'Avis de marché',
      url: l.url || '',
      plateforme: label,
      plateformes: [label],
      typeAvis: l.type_avis,
      procedure: l.procedure || undefined,
      descripteurs: l.descripteurs || [],
    }
    const cle = (l as LigneSignal & { cle_canonique?: string }).cle_canonique || `${l.source}:${l.source_id}`
    const existante = parCle.get(cle)
    if (!existante) {
      parCle.set(cle, a)
    } else {
      const labels = [...new Set([...(existante.plateformes || []), label])]
      // le pivot officiel (BOAMP/TED) porte la carte ; les autres complètent
      const base = pivot && !['BOAMP', 'TED'].includes(existante.plateforme) ? a : existante
      const autre = base === a ? existante : a
      base.plateformes = labels
      base.dateLimite = base.dateLimite ?? autre.dateLimite
      base.acheteur = base.acheteur || autre.acheteur
      if (base.departements.length === 0) base.departements = autre.departements
      parCle.set(cle, base)
    }
  }
  const annonces = [...parCle.values()]

  const evenements: EvenementBoamp[] = lignes
    .filter((l) => l.type !== 'initial')
    .map((l) => ({
      idweb: l.source_id,
      type: l.type as EvenementBoamp['type'],
      objet: l.objet,
      acheteur: l.acheteur || '',
      dateParution: l.date_parution || '',
      nouvelleDateLimite: l.date_limite,
      annoncesLiees: l.annonces_liees || [],
      url: l.url || '',
    }))

  return { annonces, evenements }
}

/** dernière collecte par source — la santé du service de fond */
export async function dernieresCollectes(): Promise<CollecteVeille[]> {
  const sb = clientSupabase()
  if (!sb) return []
  const { data } = await sb
    .from('veille_collectes')
    .select('source,termine_le,statut,nb_nouveaux,nb_maj,demarre_le')
    .order('demarre_le', { ascending: false })
    .limit(10)
  const parSource = new Map<string, CollecteVeille>()
  for (const c of data || []) {
    if (!parSource.has(c.source)) {
      parSource.set(c.source, {
        source: c.source,
        termineLe: c.termine_le,
        statut: c.statut,
        nbNouveaux: c.nb_nouveaux,
        nbMaj: c.nb_maj,
      })
    }
  }
  return [...parSource.values()]
}

/** déclenche une collecte immédiate côté serveur (jeton agence) */
export async function collecterMaintenant(): Promise<{ statut: string } | null> {
  const sb = clientSupabase()
  if (!sb) return null
  const { data, error } = await sb.functions.invoke('veille-collecte', { method: 'POST', body: {} })
  if (error) throw new Error(`Collecte impossible : ${error.message}`)
  return data as { statut: string }
}
