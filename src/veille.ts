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
  niveau_analyse?: 'alerte' | 'fiche' | 'dce' | null
  reference?: string | null
  url_canonique?: string | null
  detail?: { description?: string; dceAccess?: string; dceUrl?: string; lieu?: string } | null
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
      'source,source_id,type,type_avis,objet,acheteur,date_parution,date_limite,departements,procedure,descripteurs,annonces_liees,url,cle_canonique,niveau_analyse,reference,url_canonique,detail',
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
      url: l.url_canonique || l.url || '',
      plateforme: label,
      plateformes: [label],
      typeAvis: l.type_avis,
      procedure: l.procedure || undefined,
      descripteurs: l.descripteurs || [],
      sourceBrute: l.source,
      reference: l.reference || undefined,
      niveauAnalyse: l.niveau_analyse || undefined,
      description: l.detail?.description || undefined,
      dceAccess: (l.detail?.dceAccess as AnnonceExterne['dceAccess']) || undefined,
      dceUrl: l.detail?.dceUrl || undefined,
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
      // l'enrichissement le plus profond gagne (alerte < fiche < dce)
      const rang = (n?: string) => (n === 'dce' ? 2 : n === 'fiche' ? 1 : 0)
      if (rang(autre.niveauAnalyse) > rang(base.niveauAnalyse)) {
        base.niveauAnalyse = autre.niveauAnalyse
        base.reference = autre.reference ?? base.reference
        base.description = autre.description ?? base.description
        base.dceAccess = autre.dceAccess ?? base.dceAccess
        base.dceUrl = autre.dceUrl ?? base.dceUrl
      }
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

/** signaux récents mentionnant un acheteur — la fiche organisation
 *  montre ce que la veille a vu passer (null = espace non connecté) */
export async function signauxPourAcheteur(
  nomAcheteur: string,
): Promise<{ objet: string; source: string; dateParution: string | null; dateLimite: string | null; url: string | null }[] | null> {
  const sb = clientSupabase()
  if (!sb) return null
  const nom = nomAcheteur.replace(/[%_(),]/g, ' ').trim()
  if (!nom) return []
  const { data, error } = await sb
    .from('veille_signaux')
    .select('source,objet,acheteur,date_parution,date_limite,url')
    .ilike('acheteur', `%${nom}%`)
    .order('date_parution', { ascending: false })
    .limit(8)
  if (error) throw new Error(`Signaux illisibles : ${error.message}`)
  return (data || []).map((l) => ({
    objet: l.objet as string,
    source: labelSource(l.source as string),
    dateParution: (l.date_parution as string | null) || null,
    dateLimite: (l.date_limite as string | null) || null,
    url: (l.url as string | null) || null,
  }))
}

// ---------- Lot 0 ter : file d'enrichissement ----------

export interface JobVeille {
  id: string
  source: string
  kind: string
  status: string
  url: string | null
  error_code: string | null
  error_detail: string | null
  signal_source_id: string | null
}

/** jobs qui attendent une décision ou signalent un problème —
 *  needs_login (action humaine), needs_browser, blocked, failed */
export async function jobsEnAttente(): Promise<JobVeille[] | null> {
  const sb = clientSupabase()
  if (!sb) return null
  const { data, error } = await sb
    .from('veille_jobs')
    .select('id,source,kind,status,url,error_code,error_detail,signal_source_id')
    .in('status', ['needs_login', 'needs_browser', 'blocked', 'failed'])
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(`File illisible : ${error.message}`)
  return (data || []) as JobVeille[]
}

/** relance ciblée d'un job (repasse en file — le prochain cycle le reprend) */
export async function relancerJob(id: string): Promise<void> {
  const sb = clientSupabase()
  if (!sb) return
  const { error } = await sb
    .from('veille_jobs')
    .update({ status: 'queued', attempts: 0, next_attempt_at: new Date().toISOString(), error_code: null, error_detail: null })
    .eq('id', id)
  if (error) throw new Error(`Relance impossible : ${error.message}`)
}

/** après VALIDATION d'une opportunité : demande la récupération du DCE
 *  (retrait public seulement — sinon la file marquera l'action humaine) */
export async function demanderDce(source: string, sourceId: string, url?: string | null): Promise<boolean> {
  const sb = clientSupabase()
  if (!sb) return false
  const { error } = await sb.from('veille_jobs').insert({
    signal_source: source,
    signal_source_id: sourceId,
    source,
    kind: 'fetch_dce',
    url: url || null,
  })
  return !error
}

/** déclenche une collecte immédiate côté serveur (jeton agence) */
export async function collecterMaintenant(): Promise<{ statut: string } | null> {
  const sb = clientSupabase()
  if (!sb) return null
  const { data, error } = await sb.functions.invoke('veille-collecte', { method: 'POST', body: {} })
  if (error) throw new Error(`Collecte impossible : ${error.message}`)
  return data as { statut: string }
}
