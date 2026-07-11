// ============================================================
// veille-collecte — la veille AO devient un SERVICE DE FOND :
// toutes les 4 h (pg_cron), le serveur interroge BOAMP (avis
// initiaux, concours inclus, + rectificatifs/résultats) et TED
// (en direct — pas de CORS côté serveur), normalise vers la
// table veille_signaux (upsert idempotent par source+source_id,
// empreinte pour détecter les mises à jour) et journalise chaque
// exécution dans veille_collectes. Le Radar du Cockpit lit ces
// signaux même si aucun onglet n'était ouvert à la parution.
//
// Critères : ceux de l'agence, lus dans workspace.data.settings
// (veilleBoamp) — mêmes réglages que la recherche manuelle.
// Accès : x-cron-secret (planificateur) OU jeton de l'agence
// (bouton « Collecter maintenant »).
// ============================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const AGENCE = ['julenglet@gmail.com', 'zoefhebert@gmail.com']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BOAMP = 'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records'
const TED = 'https://api.ted.europa.eu/v3/notices/search'

const CRITERES_DEFAUT = {
  motsCles: "maîtrise d'oeuvre, réhabilitation, architecte",
  departements: '02, 59, 60, 62, 80, 14, 27, 50, 61, 76, 75, 77, 78, 91, 92, 93, 94, 95',
  typeMarche: 'Services',
  depuisJours: 30,
}
type Criteres = typeof CRITERES_DEFAUT

interface Signal {
  source: 'boamp' | 'ted'
  source_id: string
  type: 'initial' | 'rectificatif' | 'modification' | 'annulation' | 'resultat'
  type_avis: 'marche' | 'concours'
  objet: string
  acheteur: string
  date_parution: string | null
  date_limite: string | null
  departements: string[]
  procedure: string | null
  descripteurs: string[]
  annonces_liees: string[]
  url: string
}

function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

function json(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function q(v: string): string {
  return `"${v.replace(/"/g, '\\"')}"`
}

async function sha256Hex(texte: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte))
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** clé de rapprochement multi-source : l'objet normalisé (fold) */
function cleCanonique(objet: string): string {
  return objet
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 120)
}

/** empreinte du contenu utile — si elle change, le signal a été mis à jour */
function contenuUtile(s: Signal): string {
  return JSON.stringify([s.objet, s.date_limite, s.acheteur, s.type, s.url])
}

// ---------- BOAMP ----------

interface RecBoamp {
  idweb?: string
  objet?: string
  nomacheteur?: string
  dateparution?: string
  datelimitereponse?: string
  code_departement?: string[] | string
  nature_libelle?: string
  url_avis?: string
  procedure_libelle?: string
  sousnature_libelle?: string[] | string
  descripteur_libelle?: string[] | string
  annonce_lie?: string[] | string
}

function enListe(v: string[] | string | undefined): string[] {
  return Array.isArray(v) ? v : v ? [v] : []
}

const NATURES_EVENEMENT: Record<string, Signal['type']> = {
  Rectificatif: 'rectificatif',
  Modification: 'modification',
  "Avis d'annulation": 'annulation',
  'Résultat de marché': 'resultat',
}

async function collecterBoamp(c: Criteres, aujourdhui: string): Promise<Signal[]> {
  const mots = c.motsCles.split(',').map((m) => m.trim()).filter(Boolean)
  const deps = c.departements.split(',').map((d) => d.trim().replace(/^0?(\d)$/, '0$1')).filter(Boolean)
  const d = new Date(`${aujourdhui}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - Math.max(1, c.depuisJours || 30))
  const fenetre = `dateparution >= date'${d.toISOString().slice(0, 10)}'`
  const motsClause = mots.length ? `(${mots.map((m) => `search(objet,${q(m)})`).join(' OR ')})` : ''
  const depsClause = deps.length ? `code_departement IN (${deps.map(q).join(',')})` : ''
  const select =
    'idweb,objet,nomacheteur,dateparution,datelimitereponse,code_departement,nature_libelle,url_avis,procedure_libelle,sousnature_libelle,descripteur_libelle,annonce_lie'

  const interroger = async (natureClause: string, limite: number): Promise<RecBoamp[]> => {
    const clauses = [natureClause, motsClause, depsClause, fenetre].filter(Boolean)
    if (natureClause.includes('Avis de marché') && c.typeMarche) clauses.push(`type_marche_facette = ${q(c.typeMarche)}`)
    const params = new URLSearchParams({
      where: clauses.join(' AND '),
      order_by: 'dateparution desc',
      limit: String(limite),
      select,
    })
    const r = await fetch(`${BOAMP}?${params}`)
    if (!r.ok) throw new Error(`BOAMP ${r.status}`)
    return ((await r.json()) as { results?: RecBoamp[] }).results || []
  }

  // avis initiaux (marchés + concours) puis événements de cycle de vie
  const initiaux = await interroger('(nature_libelle = "Avis de marché" OR sousnature_libelle = "Concours")', 60)
  const evenements = await interroger(
    `nature_libelle IN (${Object.keys(NATURES_EVENEMENT).map(q).join(',')})`,
    40,
  )

  const versSignal = (x: RecBoamp, type: Signal['type']): Signal => ({
    source: 'boamp',
    source_id: x.idweb!,
    type,
    type_avis: /concours/i.test(`${x.procedure_libelle || ''} ${enListe(x.sousnature_libelle).join(' ')}`)
      ? 'concours'
      : 'marche',
    objet: x.objet!,
    acheteur: x.nomacheteur || '',
    date_parution: x.dateparution ? x.dateparution.slice(0, 10) : null,
    date_limite: x.datelimitereponse ? x.datelimitereponse.slice(0, 10) : null,
    departements: enListe(x.code_departement),
    procedure: x.procedure_libelle || null,
    descripteurs: enListe(x.descripteur_libelle),
    annonces_liees: enListe(x.annonce_lie),
    url: x.url_avis || `https://www.boamp.fr/pages/avis/?q=idweb:${x.idweb}`,
  })

  return [
    ...initiaux.filter((x) => x.idweb && x.objet).map((x) => versSignal(x, 'initial')),
    ...evenements
      .filter((x) => x.idweb && x.objet && x.nature_libelle && NATURES_EVENEMENT[x.nature_libelle])
      .map((x) => versSignal(x, NATURES_EVENEMENT[x.nature_libelle!])),
  ]
}

// ---------- TED (appel direct : pas de CORS côté serveur) ----------

const NUTS3: Record<string, string> = {
  '02': 'FRE21', '14': 'FRD11', '27': 'FRD21', '50': 'FRD12', '59': 'FRE11', '60': 'FRE22',
  '61': 'FRD13', '62': 'FRE12', '75': 'FR101', '76': 'FRD22', '77': 'FR102', '78': 'FR103',
  '80': 'FRE23', '91': 'FR104', '92': 'FR105', '93': 'FR106', '94': 'FR107', '95': 'FR108',
}

interface NoticeTed {
  'publication-number'?: string
  'notice-title'?: Record<string, string | string[]>
  'buyer-name'?: Record<string, string | string[]>
  'publication-date'?: string
  'deadline-receipt-tender-date-lot'?: string[]
  'notice-type'?: string
  'procedure-type'?: string
  'classification-cpv'?: string[] | string
}

function premierTexte(v: Record<string, string | string[]> | undefined): string {
  if (!v) return ''
  const brut = v['fra'] ?? Object.values(v)[0]
  const x = Array.isArray(brut) ? brut[0] : brut
  return x || ''
}

async function collecterTed(c: Criteres, aujourdhui: string): Promise<Signal[]> {
  const mots = c.motsCles.split(',').map((m) => m.trim()).filter(Boolean)
  if (mots.length === 0) return []
  const d = new Date(`${aujourdhui}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - Math.max(1, c.depuisJours || 30))
  const depuis = d.toISOString().slice(0, 10).replaceAll('-', '')
  const nuts = c.departements
    .split(',')
    .map((x) => x.trim().replace(/^0?(\d)$/, '0$1'))
    .map((x) => NUTS3[x])
    .filter(Boolean)

  const query =
    `(notice-title ~ (${mots.map((m) => `"${m.replace(/"/g, '')}"`).join(' OR ')}))` +
    ` AND buyer-country IN (FRA)` +
    (nuts.length > 0 ? ` AND place-of-performance IN (${nuts.join(' ')})` : '') +
    ` AND publication-date > ${depuis} SORT BY publication-date DESC`

  const r = await fetch(TED, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      fields: [
        'publication-number',
        'notice-title',
        'buyer-name',
        'publication-date',
        'deadline-receipt-tender-date-lot',
        'notice-type',
        'procedure-type',
        'classification-cpv',
      ],
      limit: 30,
    }),
  })
  if (!r.ok) throw new Error(`TED ${r.status}`)
  const data = (await r.json()) as { notices?: NoticeTed[] }
  return (data.notices || [])
    .filter((n) => n['publication-number'])
    .map((n) => {
      const num = n['publication-number']!
      const lim = n['deadline-receipt-tender-date-lot']?.[0]
      const cpv = n['classification-cpv']
      return {
        source: 'ted' as const,
        source_id: num,
        type: 'initial' as const,
        type_avis: /desg|design/i.test(`${n['notice-type'] || ''} ${n['procedure-type'] || ''}`)
          ? ('concours' as const)
          : ('marche' as const),
        objet: premierTexte(n['notice-title']) || '(sans titre)',
        acheteur: premierTexte(n['buyer-name']),
        date_parution: (n['publication-date'] || '').slice(0, 10) || null,
        date_limite: lim ? lim.slice(0, 10) : null,
        departements: [],
        procedure: n['procedure-type'] || null,
        descripteurs: Array.isArray(cpv) ? cpv : cpv ? [cpv] : [],
        annonces_liees: [],
        url: `https://ted.europa.eu/fr/notice/-/detail/${num}`,
      }
    })
}

// ---------- upsert idempotent + journal ----------

async function enregistrer(sb: SupabaseClient, source: 'boamp' | 'ted', signaux: Signal[]): Promise<{ nouveaux: number; maj: number }> {
  const { data: collecte } = await sb
    .from('veille_collectes')
    .insert({ source })
    .select('id')
    .single()

  let nouveaux = 0
  let maj = 0
  try {
    const ids = signaux.map((s) => s.source_id)
    const { data: existants } = ids.length
      ? await sb.from('veille_signaux').select('source_id,empreinte').eq('source', source).in('source_id', ids)
      : { data: [] as { source_id: string; empreinte: string | null }[] }
    const parId = new Map((existants || []).map((e) => [e.source_id, e.empreinte]))

    for (const s of signaux) {
      const empreinte = await sha256Hex(contenuUtile(s))
      const connue = parId.get(s.source_id)
      if (connue === undefined) {
        const { error } = await sb.from('veille_signaux').insert({ ...s, empreinte, cle_canonique: cleCanonique(s.objet), collecte_id: collecte?.id })
        if (!error) nouveaux++
      } else if (connue !== empreinte) {
        const { error } = await sb
          .from('veille_signaux')
          .update({ ...s, empreinte, cle_canonique: cleCanonique(s.objet), maj_le: new Date().toISOString() })
          .eq('source', source)
          .eq('source_id', s.source_id)
        if (!error) maj++
      }
    }
    await sb
      .from('veille_collectes')
      .update({ termine_le: new Date().toISOString(), statut: 'ok', nb_nouveaux: nouveaux, nb_maj: maj })
      .eq('id', collecte?.id)
  } catch (e) {
    await sb
      .from('veille_collectes')
      .update({ termine_le: new Date().toISOString(), statut: 'erreur', erreur: e instanceof Error ? e.message : String(e) })
      .eq('id', collecte?.id)
    throw e
  }
  return { nouveaux, maj }
}

// ---------- point d'entrée ----------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const sb = admin()
  const { data: cfg } = await sb.from('ingestion_config').select('cron_secret').eq('id', 'google').maybeSingle()

  const secretRecu = req.headers.get('x-cron-secret')
  let autorise = Boolean(secretRecu && cfg?.cron_secret && secretRecu === cfg.cron_secret)
  if (!autorise) {
    const jeton = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (jeton) {
      const { data } = await sb.auth.getUser(jeton)
      autorise = AGENCE.includes(data.user?.email?.toLowerCase() || '')
    }
  }
  if (!autorise) return json({ erreur: 'Accès refusé.' }, 401)

  // critères de l'agence — les mêmes que la recherche manuelle du Radar
  const { data: ws } = await sb.from('workspace').select('data').limit(1).maybeSingle()
  const criteres: Criteres = {
    ...CRITERES_DEFAUT,
    ...(((ws?.data as { settings?: { veilleBoamp?: Partial<Criteres> } })?.settings?.veilleBoamp) || {}),
  }
  const aujourdhui = new Date().toISOString().slice(0, 10)

  const [boamp, ted] = await Promise.allSettled([
    collecterBoamp(criteres, aujourdhui).then((s) => enregistrer(sb, 'boamp', s)),
    collecterTed(criteres, aujourdhui).then((s) => enregistrer(sb, 'ted', s)),
  ])

  return json({
    statut: 'ok',
    boamp: boamp.status === 'fulfilled' ? boamp.value : { erreur: String(boamp.reason) },
    ted: ted.status === 'fulfilled' ? ted.value : { erreur: String(ted.reason) },
  })
})
