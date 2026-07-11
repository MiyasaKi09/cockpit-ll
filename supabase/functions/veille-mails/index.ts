// ============================================================
// veille-mails — les ALERTES E-MAIL des plateformes de marchés
// (AWS/marches-publics.info, PLACE, Maximilien, e-marchespublics,
// Klekoon, MarchésOnline/Achatpublic, Mégalis, Ternum BFC,
// Marchés Sécurisés) deviennent des signaux du Radar.
//
// C'est la voie CONFORME recommandée par l'audit V3 (§7.4) : pas
// de scraping de plateforme privée — l'agence s'abonne aux alertes
// gratuites de chaque site, le Cockpit lit la boîte Gmail déjà
// connectée (lecture seule) et extrait objet / acheteur / date
// limite / lien par un parseur DÉTERMINISTE de famille. Un mail =
// un signal (conservateur) ; idempotent par identifiant de message.
//
// Accès : x-cron-secret (planificateur, toutes les heures) OU
// jeton d'une personne de l'agence.
// ============================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const AGENCE = ['julenglet@gmail.com', 'zoefhebert@gmail.com']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** familles de plateformes reconnues par le domaine de l'expéditeur */
const PLATEFORMES: { id: string; nom: string; domaines: string[] }[] = [
  { id: 'aws', nom: 'AWS', domaines: ['marches-publics.info', 'aws-france.com'] },
  { id: 'place', nom: 'PLACE', domaines: ['marches-publics.gouv.fr'] },
  { id: 'maximilien', nom: 'Maximilien', domaines: ['maximilien.fr'] },
  { id: 'emp', nom: 'e-marchespublics', domaines: ['e-marchespublics.com', 'dematis.com'] },
  { id: 'klekoon', nom: 'Klekoon', domaines: ['klekoon.com'] },
  { id: 'marchesonline', nom: 'MarchésOnline', domaines: ['marchesonline.com', 'achatpublic.com'] },
  { id: 'megalis', nom: 'Mégalis', domaines: ['megalis.bretagne.bzh', 'megalisbretagne.org'] },
  { id: 'ternum', nom: 'Ternum BFC', domaines: ['ternum-bfc.fr'] },
  { id: 'marchessecurises', nom: 'Marchés Sécurisés', domaines: ['marches-securises.fr'] },
]

function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

function json(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

/** clé de rapprochement multi-source : l'objet normalisé */
function cleCanonique(objet: string): string {
  return fold(objet).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120)
}

// ---------- Gmail (mêmes primitives que gmail-ingestion) ----------

async function gmail<T>(jeton: string, chemin: string): Promise<T> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${chemin}`, {
    headers: { Authorization: `Bearer ${jeton}` },
  })
  if (!r.ok) throw new Error(`Gmail a répondu ${r.status}.`)
  return (await r.json()) as T
}

function depuisBase64Url(b64u: string): string {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return decodeURIComponent(escape(atob(b64)))
  } catch {
    return atob(b64)
  }
}

interface PartieGmail {
  mimeType?: string
  body?: { data?: string }
  parts?: PartieGmail[]
}

/** texte du mail : text/plain de préférence, sinon HTML débalisé */
function texteDuCorps(p: PartieGmail | undefined): string {
  if (!p) return ''
  if (p.mimeType === 'text/plain' && p.body?.data) return depuisBase64Url(p.body.data)
  if (p.mimeType === 'text/html' && p.body?.data) {
    return depuisBase64Url(p.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
  }
  for (const enfant of p.parts || []) {
    const t = texteDuCorps(enfant)
    if (t) return t
  }
  return ''
}

// ---------- parseur de famille (déterministe, conservateur) ----------

/** « 12/09/2026 », « 12-09-26 », « 12.09.2026 » → ISO (ou null) */
function dateFrVersISO(s: string): string | null {
  const m = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(s)
  if (!m) return null
  const [, j, mo, a] = m
  const annee = a.length === 2 ? `20${a}` : a
  const mois = mo.padStart(2, '0')
  const jour = j.padStart(2, '0')
  if (Number(mois) < 1 || Number(mois) > 12 || Number(jour) < 1 || Number(jour) > 31) return null
  return `${annee}-${mois}-${jour}`
}

interface ExtraitAlerte {
  objet: string
  acheteur: string
  dateLimite: string | null
  url: string
  concours: boolean
}

/** extraction commune à toutes les familles : sujet nettoyé, acheteur,
 *  date limite et premier lien de la plateforme. On ne devine JAMAIS :
 *  ce qui n'est pas trouvé reste vide et sera complété à la main. */
function extraireAlerte(sujet: string, corps: string, domaines: string[]): ExtraitAlerte {
  const objet = sujet
    .replace(/^\s*(re\s*:|tr\s*:|fwd?\s*:)/i, '')
    .replace(/^\s*\[[^\]]{0,40}\]\s*/, '') // préfixes [Alerte…]
    .replace(/^(alerte|notification|nouvelle?s? (consultations?|annonces?|avis))\s*[:—-]?\s*/i, '')
    .trim()

  const mAcheteur = /(?:organisme|acheteur|client|collectivit[ée]|entit[ée] adjudicatrice)\s*:?\s*([^\n\r]{3,90})/i.exec(corps)
  const acheteur = mAcheteur ? mAcheteur[1].replace(/\s{2,}/g, ' ').trim() : ''

  const mLimite = /(?:date (?:et heure )?limite|remise des (?:offres|plis|candidatures)|r[ée]ponse attendue|cl[ôo]ture)[^\n\r]{0,60}?(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i.exec(corps)
  const dateLimite = mLimite ? dateFrVersISO(mLimite[1]) : null

  let url = ''
  const liens = corps.match(/https?:\/\/[^\s"'<>)\]]+/g) || []
  for (const l of liens) {
    if (domaines.some((d) => l.includes(d))) {
      url = l
      break
    }
  }

  const concours = /concours/i.test(`${sujet} ${corps.slice(0, 2000)}`)
  return { objet, acheteur, dateLimite, url, concours }
}

// ---------- point d'entrée ----------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const sb = admin()
  const { data: cfg } = await sb.from('ingestion_config').select('*').eq('id', 'google').maybeSingle()
  if (!cfg) return json({ erreur: 'Configuration absente.' }, 500)

  const secretRecu = req.headers.get('x-cron-secret')
  let autorise = Boolean(secretRecu && cfg.cron_secret && secretRecu === cfg.cron_secret)
  if (!autorise) {
    const jeton = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (jeton) {
      const { data } = await sb.auth.getUser(jeton)
      autorise = AGENCE.includes(data.user?.email?.toLowerCase() || '')
    }
  }
  if (!autorise) return json({ erreur: 'Accès refusé.' }, 401)

  if (!cfg.refresh_token) return json({ statut: 'non-connecte' })

  // jeton d'accès Gmail depuis le refresh token
  const rJeton = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      refresh_token: cfg.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const acces = (await rJeton.json()) as { access_token?: string; error?: string }
  if (!rJeton.ok || !acces.access_token) return json({ statut: 'erreur', detail: acces.error }, 502)
  const jetonGmail = acces.access_token

  const { data: collecte } = await sb.from('veille_collectes').insert({ source: 'mails' }).select('id').single()

  let nouveaux = 0
  let examines = 0
  try {
    const fromClause = PLATEFORMES.flatMap((p) => p.domaines).map((d) => `from:${d}`).join(' OR ')
    const q = encodeURIComponent(`newer_than:7d (${fromClause})`)
    const liste = await gmail<{ messages?: { id: string }[] }>(jetonGmail, `messages?q=${q}&maxResults=40`)
    const ids = (liste.messages || []).map((m) => m.id)
    examines = ids.length

    // idempotence : les messages déjà transformés en signal ne sont pas relus
    const dejaVus = new Set<string>()
    if (ids.length > 0) {
      const { data: existants } = await sb
        .from('veille_signaux')
        .select('source_id')
        .in('source_id', ids.map((id) => `mail-${id}`))
      for (const e of existants || []) dejaVus.add(e.source_id as string)
    }

    for (const id of ids) {
      if (dejaVus.has(`mail-${id}`)) continue
      const m = await gmail<{
        internalDate?: string
        payload?: PartieGmail & { headers?: { name: string; value: string }[] }
      }>(jetonGmail, `messages/${id}?format=full`)
      const entete = (nom: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === nom)?.value || ''
      const de = entete('from')
      const plateforme = PLATEFORMES.find((p) => p.domaines.some((d) => de.includes(d)))
      if (!plateforme) continue

      const sujet = entete('subject') || '(sans objet)'
      const corps = texteDuCorps(m.payload)
      const ex = extraireAlerte(sujet, corps, plateforme.domaines)
      if (!ex.objet) continue

      const { error } = await sb.from('veille_signaux').insert({
        source: plateforme.id,
        source_id: `mail-${id}`,
        type: 'initial',
        type_avis: ex.concours ? 'concours' : 'marche',
        objet: ex.objet,
        acheteur: ex.acheteur,
        date_parution: m.internalDate ? new Date(Number(m.internalDate)).toISOString().slice(0, 10) : null,
        date_limite: ex.dateLimite,
        departements: [],
        procedure: null,
        descripteurs: [],
        annonces_liees: [],
        url: ex.url || null,
        cle_canonique: cleCanonique(ex.objet),
        collecte_id: collecte?.id,
      })
      if (!error) nouveaux++
    }

    await sb
      .from('veille_collectes')
      .update({ termine_le: new Date().toISOString(), statut: 'ok', nb_nouveaux: nouveaux })
      .eq('id', collecte?.id)
  } catch (e) {
    await sb
      .from('veille_collectes')
      .update({ termine_le: new Date().toISOString(), statut: 'erreur', erreur: e instanceof Error ? e.message : String(e) })
      .eq('id', collecte?.id)
    throw e
  }

  return json({ statut: 'ok', examines, nouveaux })
})
