// ============================================================
// veille-enrichir (Lot 0 ter B/D) — le moteur d'enrichissement :
// prend les jobs de la file (veille_jobs), lit les FICHES PUBLIQUES
// des plateformes en HTTP simple, extrait les champs par adaptateur
// déterministe, conserve le brut + la PROVENANCE de chaque champ,
// et marque honnêtement ce qu'il ne sait pas faire :
//   needs_browser (page pilotée en JS) · needs_login (compte requis)
//   · blocked (domaine hors liste / refus) · failed (avec raison).
//
// Après validation d'une opportunité, le job fetch_dce tente le
// RETRAIT PUBLIC du DCE (niveau 1) — un retrait avec formulaire ou
// compte devient une action humaine unique, jamais un contournement.
// check_updates surveille les fiches des consultations suivies
// (re-lecture, comparaison d'empreinte, rectificatif si la date
// limite change — jamais de doublon).
//
// Garde-fous (audit §14) : domaines en liste blanche, User-Agent
// honnête, quotas par run, aucun compte, aucun CAPTCHA, aucune
// soumission. Accès : x-cron-secret (cron 10 min) OU jeton agence.
// ============================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const VERSION_PARSEUR = 'enrichir-1.0'
const AGENCE = ['julenglet@gmail.com', 'zoefhebert@gmail.com']
const UA = 'CockpitLL-Veille/1.0 (agence architecture ; contact : julenglet@gmail.com)'
const JOBS_PAR_RUN = 6
const TAILLE_MAX_PAGE = 2 * 1024 * 1024 // 2 Mo de HTML
const TAILLE_MAX_DCE = 40 * 1024 * 1024 // 40 Mo

/** seuls domaines FINAUX autorisés (les redirections de suivi des mails
 *  peuvent transiter ailleurs, mais la destination doit être ici) */
const DOMAINES_AUTORISES = [
  'marches-publics.info',
  'aws-france.com',
  'marches-publics.gouv.fr',
  'maximilien.fr',
  'megalis.bretagne.bzh',
  'megalisbretagne.org',
  'ternum-bfc.fr',
  'e-marchespublics.com',
  'dematis.com',
  'klekoon.com',
  'marchesonline.com',
  'achatpublic.com',
  'marches-securises.fr',
  'boamp.fr',
  'ted.europa.eu',
]

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

async function sha256Hex(donnees: ArrayBuffer | string): Promise<string> {
  const buf = typeof donnees === 'string' ? new TextEncoder().encode(donnees) : new Uint8Array(donnees)
  const h = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function domaineAutorise(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return DOMAINES_AUTORISES.some((d) => h === d || h.endsWith(`.${d}`))
  } catch {
    return false
  }
}

// ---------- HTML → texte ----------

function decoderEntites(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&eacute;/gi, 'é')
    .replace(/&egrave;/gi, 'è')
    .replace(/&agrave;/gi, 'à')
    .replace(/&ccedil;/gi, 'ç')
    .replace(/&ocirc;/gi, 'ô')
    .replace(/&icirc;/gi, 'î')
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n)
      return c > 31 && c < 65536 ? String.fromCharCode(c) : ' '
    })
}

/** HTML → lignes de texte propres (une par bloc) */
function lignesDe(html: string): string[] {
  const texte = decoderEntites(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/tr|\/td|\/li|\/h[1-6]|\/span)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
  return texte
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').trim())
    .filter(Boolean)
}

/** valeur qui suit un libellé (« Objet : … » sur la ligne ou la suivante) */
function valeurApresLibelle(lignes: string[], motif: RegExp, maxLg = 300): string | undefined {
  for (let i = 0; i < lignes.length; i++) {
    const m = motif.exec(lignes[i])
    if (!m) continue
    const reste = lignes[i].slice(m.index + m[0].length).replace(/^\s*:?\s*/, '').trim()
    if (reste && reste.length >= 2) return reste.slice(0, maxLg)
    for (let j = i + 1; j <= i + 2 && j < lignes.length; j++) {
      const v = lignes[j].trim()
      if (v && v.length >= 2 && !/^[:\-–—]+$/.test(v)) return v.slice(0, maxLg)
    }
  }
  return undefined
}

/** « 15/02/2026 12:00 » ou « 15 février 2026 » → ISO (date seule) */
function versISO(s: string | undefined): string | undefined {
  if (!s) return undefined
  const m = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(s)
  if (m) {
    const a = m[3].length === 2 ? `20${m[3]}` : m[3]
    const mois = m[2].padStart(2, '0')
    const jour = m[1].padStart(2, '0')
    if (Number(mois) >= 1 && Number(mois) <= 12) return `${a}-${mois}-${jour}`
  }
  const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']
  const plein = /(\d{1,2})(?:er)?\s+([a-z]+)\s+(\d{4})/i.exec(s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  if (plein) {
    const idx = MOIS.indexOf(plein[2].toLowerCase())
    if (idx >= 0) return `${plein[3]}-${String(idx + 1).padStart(2, '0')}-${plein[1].padStart(2, '0')}`
  }
  return undefined
}

/** codes départements repérés dans un lieu (« (75) Paris », « 60 - Oise ») */
function departementsDe(lieu: string | undefined): string[] {
  if (!lieu) return []
  const codes = new Set<string>()
  for (const m of lieu.matchAll(/\((\d{2,3})\)|\b(\d{2,3})\s*[-–]\s*[A-ZÉÈ]/g)) {
    const c = m[1] || m[2]
    if (c && Number(c) >= 1 && Number(c) <= 989) codes.add(c.padStart(2, '0'))
  }
  return [...codes]
}

// ---------- contrat des adaptateurs ----------

interface FicheExtraite {
  reference?: string
  titre?: string
  objet?: string
  acheteur?: string
  procedure?: string
  lieu?: string
  dateLimite?: string
  cpv?: string[]
  dceAccess?: 'public' | 'form' | 'login' | 'unknown'
  dceUrl?: string
  /** extraits de preuve par champ (provenance) */
  preuves: Record<string, string>
}

interface Adaptateur {
  id: string
  canHandle(url: string): boolean
  parseDetail(html: string, urlFinale: string): FicheExtraite
}

/** la page est-elle une coquille JavaScript sans contenu serveur ? */
function coquilleJs(html: string): boolean {
  const lignes = lignesDe(html)
  const texteUtile = lignes.join(' ')
  return texteUtile.length < 400 || /vous devez activer javascript|enable javascript/i.test(texteUtile)
}

/** la page exige-t-elle une connexion ? */
function exigeConnexion(html: string): boolean {
  const t = lignesDe(html).join(' ').toLowerCase()
  return /identifiez-vous pour|connectez-vous pour|acc[eè]s r[ée]serv[ée]|veuillez vous connecter|session expir[ée]e/.test(t)
}

function preuve(lignes: string[], motif: RegExp): string {
  const l = lignes.find((x) => motif.test(x))
  return l ? l.slice(0, 160) : ''
}

// --- Atexo MPE (PLACE, Maximilien, Mégalis, Ternum BFC) — calibré sur
//     les pages réelles : libellés stables, DCE via DemandeTelechargementDce
const adaptateurAtexo: Adaptateur = {
  id: 'atexo',
  canHandle: (url) =>
    /page=Entreprise\./i.test(url) ||
    ['marches-publics.gouv.fr', 'maximilien.fr', 'megalis.bretagne.bzh', 'ternum-bfc.fr'].some((d) =>
      url.includes(d),
    ),
  parseDetail(html, urlFinale) {
    const lignes = lignesDe(html)
    const f: FicheExtraite = { preuves: {} }
    f.reference = valeurApresLibelle(lignes, /^R[ée]f[ée]rence\s*(:|$)/i, 60)
    f.titre = valeurApresLibelle(lignes, /^Intitul[ée]\s*(:|$)/i)
    f.objet = valeurApresLibelle(lignes, /^Objet\s*(:|$)/i, 500)
    f.acheteur =
      valeurApresLibelle(lignes, /^(Organisme|Entit[ée] publique|Entit[ée] d.achat)\s*(:|$)/i, 160)
    f.procedure = valeurApresLibelle(lignes, /^(Proc[ée]dure|Type de proc[ée]dure)\s*(:|$)/i, 120)
    f.lieu = valeurApresLibelle(lignes, /^Lieu d.ex[ée]cution\s*(:|$)/i, 160)
    f.dateLimite = versISO(
      valeurApresLibelle(lignes, /^Date (et heure )?limite de remise des plis\s*(:|$)/i, 60),
    )
    const dce = /href="([^"]*page=Entreprise\.EntrepriseDemandeTelechargementDce[^"]*)"/i.exec(html)
    if (dce) {
      f.dceAccess = 'form' // retrait avec identification (ou anonyme selon portail)
      f.dceUrl = new URL(decoderEntites(dce[1]), urlFinale).href
    }
    f.preuves = {
      reference: preuve(lignes, /^R[ée]f[ée]rence\s*:?/i),
      titre: preuve(lignes, /^Intitul[ée]\s*:?/i),
      acheteur: preuve(lignes, /^(Organisme|Entit[ée] publique)/i),
      dateLimite: preuve(lignes, /limite de remise des plis/i),
      procedure: preuve(lignes, /^Proc[ée]dure/i),
      lieu: preuve(lignes, /^Lieu d.ex[ée]cution/i),
    }
    return f
  },
}

// --- AWS / marches-publics.info — pages ColdFusion rendues serveur ;
//     la recherche est pilotée en JS (→ needs_browser), pas les fiches
const adaptateurAws: Adaptateur = {
  id: 'aws',
  canHandle: (url) => /marches-publics\.info|aws-france\.com/i.test(url),
  parseDetail(html, urlFinale) {
    const lignes = lignesDe(html)
    const f: FicheExtraite = { preuves: {} }
    f.objet = valeurApresLibelle(lignes, /^Objet( du march[ée])?\s*(:|$)/i, 500)
    f.titre = f.objet ? f.objet.slice(0, 220) : undefined
    f.acheteur = valeurApresLibelle(lignes, /^(Organisme|Acheteur|Client|Collectivit[ée])\s*(:|$)/i, 160)
    f.reference = valeurApresLibelle(lignes, /^R[ée]f[ée]rence( de la consultation)?\s*(:|$)/i, 60)
    f.procedure = valeurApresLibelle(lignes, /^(Proc[ée]dure|Type de proc[ée]dure|Mode de passation)\s*(:|$)/i, 120)
    f.lieu = valeurApresLibelle(lignes, /^(Lieu d.ex[ée]cution|D[ée]partement)\s*(:|$)/i, 160)
    f.dateLimite = versISO(
      valeurApresLibelle(lignes, /(date (et heure )?limite|remise des (offres|plis|candidatures))/i, 80),
    )
    const dce = /href="([^"]*(?:fuseaction=(?:demat|dce)[^"]*|\.zip))"/i.exec(html)
    if (dce) {
      f.dceUrl = new URL(decoderEntites(dce[1]), urlFinale).href
      f.dceAccess = /\.zip$/i.test(f.dceUrl) ? 'public' : 'form'
    }
    f.preuves = {
      titre: preuve(lignes, /^Objet/i),
      acheteur: preuve(lignes, /^(Organisme|Acheteur|Client|Collectivit)/i),
      dateLimite: preuve(lignes, /(limite|remise des)/i),
      reference: preuve(lignes, /^R[ée]f[ée]rence/i),
    }
    return f
  },
}

// --- générique (e-marchespublics, Klekoon, MarchésOnline, M. Sécurisés) :
//     libellés français usuels + balises og: ; sinon needs_browser
const adaptateurGenerique: Adaptateur = {
  id: 'generique',
  canHandle: () => true,
  parseDetail(html, _urlFinale) {
    const lignes = lignesDe(html)
    const f: FicheExtraite = { preuves: {} }
    const og = (prop: string) => {
      const m = new RegExp(`<meta[^>]+property="og:${prop}"[^>]+content="([^"]+)"`, 'i').exec(html)
      return m ? decoderEntites(m[1]).trim() : undefined
    }
    f.titre = valeurApresLibelle(lignes, /^(Intitul[ée]|Objet)( du march[ée])?\s*(:|$)/i, 250) || og('title')
    f.objet = valeurApresLibelle(lignes, /^Objet( du march[ée])?\s*(:|$)/i, 500) || og('description')
    f.acheteur = valeurApresLibelle(lignes, /^(Organisme|Acheteur|Client|Collectivit[ée]|Ma[îi]tre d.ouvrage)\s*(:|$)/i, 160)
    f.reference = valeurApresLibelle(lignes, /^R[ée]f[ée]rence\s*(:|$)/i, 60)
    f.procedure = valeurApresLibelle(lignes, /^(Proc[ée]dure|Type de (proc[ée]dure|march[ée]))\s*(:|$)/i, 120)
    f.lieu = valeurApresLibelle(lignes, /^(Lieu d.ex[ée]cution|D[ée]partement|Localisation)\s*(:|$)/i, 160)
    f.dateLimite = versISO(
      valeurApresLibelle(lignes, /(date (et heure )?limite|remise des (offres|plis|candidatures)|cl[ôo]ture)/i, 80),
    )
    f.preuves = {
      titre: preuve(lignes, /^(Intitul[ée]|Objet)/i) || (og('title') ? 'balise og:title' : ''),
      acheteur: preuve(lignes, /^(Organisme|Acheteur|Client|Collectivit)/i),
      dateLimite: preuve(lignes, /(limite|remise des|cl[ôo]ture)/i),
    }
    return f
  },
}

const ADAPTATEURS: Adaptateur[] = [adaptateurAtexo, adaptateurAws, adaptateurGenerique]

// ---------- chargement HTTP (redirections contrôlées) ----------

interface PageChargee {
  urlFinale: string
  status: number
  contentType: string
  corps: string
  binaire?: ArrayBuffer
}

async function chargerUrl(url: string, binaire = false): Promise<PageChargee> {
  let courante = url
  for (let saut = 0; saut < 6; saut++) {
    const ctl = new AbortController()
    const chrono = setTimeout(() => ctl.abort(), 25000)
    let r: Response
    try {
      r = await fetch(courante, {
        redirect: 'manual',
        signal: ctl.signal,
        headers: { 'User-Agent': UA, Accept: binaire ? '*/*' : 'text/html,application/xhtml+xml' },
      })
    } finally {
      clearTimeout(chrono)
    }
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const suivante = r.headers.get('location')
      await r.body?.cancel()
      if (!suivante) return { urlFinale: courante, status: r.status, contentType: '', corps: '' }
      courante = new URL(suivante, courante).href
      continue
    }
    const contentType = r.headers.get('content-type') || ''
    if (binaire) {
      const buf = await r.arrayBuffer()
      if (buf.byteLength > TAILLE_MAX_DCE) throw new Error(`Fichier trop volumineux (${buf.byteLength} octets).`)
      return { urlFinale: courante, status: r.status, contentType, corps: '', binaire: buf }
    }
    const texte = (await r.text()).slice(0, TAILLE_MAX_PAGE)
    return { urlFinale: courante, status: r.status, contentType, corps: texte }
  }
  throw new Error('Trop de redirections.')
}

// ---------- traitement des jobs ----------

interface Job {
  id: string
  signal_source: string | null
  signal_source_id: string | null
  source: string
  kind: string
  url: string | null
  attempts: number
  max_attempts: number
}

interface ResultatJob {
  status: 'complete' | 'needs_browser' | 'needs_login' | 'blocked' | 'failed' | 'requeue'
  error_code?: string
  error_detail?: string
}

async function finirJob(sb: SupabaseClient, job: Job, r: ResultatJob): Promise<void> {
  if (r.status === 'requeue') {
    await sb
      .from('veille_jobs')
      .update({
        status: job.attempts >= job.max_attempts ? 'failed' : 'queued',
        next_attempt_at: new Date(Date.now() + job.attempts * 30 * 60_000).toISOString(),
        error_code: r.error_code || null,
        error_detail: r.error_detail || null,
        parser_version: VERSION_PARSEUR,
      })
      .eq('id', job.id)
    return
  }
  await sb
    .from('veille_jobs')
    .update({
      status: r.status,
      finished_at: new Date().toISOString(),
      error_code: r.error_code || null,
      error_detail: r.error_detail || null,
      parser_version: VERSION_PARSEUR,
    })
    .eq('id', job.id)
}

/** enregistre la page + son empreinte (brut au bucket, best effort) */
async function memoriserPage(
  sb: SupabaseClient,
  jobId: string,
  page: PageChargee,
  completude: number,
  statut: string,
): Promise<string> {
  const empreinte = await sha256Hex(page.corps)
  const chemin = `pages/${empreinte.slice(0, 2)}/${empreinte}.html`
  await sb.storage
    .from('veille')
    .upload(chemin, new Blob([page.corps], { type: 'text/html' }), { upsert: true })
    .catch(() => undefined)
  await sb.from('veille_pages').insert({
    job_id: jobId,
    canonical_url: page.urlFinale,
    http_status: page.status,
    content_type: page.contentType,
    content_hash: empreinte,
    raw_storage_path: chemin,
    parser_version: VERSION_PARSEUR,
    parse_completeness: completude,
    parse_status: statut,
  })
  return empreinte
}

/** champs déjà VALIDÉS à la main — jamais écrasés (audit §5.4) */
async function champsValides(sb: SupabaseClient, source: string, sourceId: string): Promise<Set<string>> {
  const { data } = await sb
    .from('veille_field_evidence')
    .select('field_name')
    .eq('signal_source', source)
    .eq('signal_source_id', sourceId)
    .eq('validation_status', 'validee')
  return new Set((data || []).map((x) => x.field_name as string))
}

async function enregistrerPreuves(
  sb: SupabaseClient,
  source: string,
  sourceId: string,
  urlPage: string,
  fiche: FicheExtraite,
  valides: Set<string>,
): Promise<void> {
  const lignes: Record<string, string | undefined> = {
    reference: fiche.reference,
    titre: fiche.titre,
    acheteur: fiche.acheteur,
    procedure: fiche.procedure,
    lieu: fiche.lieu,
    date_limite: fiche.dateLimite,
  }
  const inserts = Object.entries(lignes)
    .filter(([, v]) => v)
    .map(([champ, v]) => ({
      signal_source: source,
      signal_source_id: sourceId,
      field_name: champ,
      value: String(v),
      source_connector_id: 'veille-enrichir',
      page_url: urlPage,
      evidence_excerpt: fiche.preuves[champ === 'date_limite' ? 'dateLimite' : champ] || null,
      confidence: 0.85,
      // une valeur qui CONTREDIT un champ validé passe « à vérifier »
      validation_status: valides.has(champ) ? 'a_verifier' : 'automatique',
    }))
  if (inserts.length > 0) await sb.from('veille_field_evidence').insert(inserts)
}

/** applique la fiche au signal SANS écraser les champs validés ;
 *  retourne l'ancienne date limite si elle change (rectificatif) */
async function appliquerFiche(
  sb: SupabaseClient,
  source: string,
  sourceId: string,
  fiche: FicheExtraite,
  urlFinale: string,
): Promise<{ dateAvant: string | null; dateApres: string | null } | null> {
  const { data: signal } = await sb
    .from('veille_signaux')
    .select('objet,acheteur,date_limite,procedure,departements,reference,detail')
    .eq('source', source)
    .eq('source_id', sourceId)
    .maybeSingle()
  if (!signal) return null

  const valides = await champsValides(sb, source, sourceId)
  await enregistrerPreuves(sb, source, sourceId, urlFinale, fiche, valides)

  const patch: Record<string, unknown> = {
    niveau_analyse: 'fiche',
    enrichi_le: new Date().toISOString(),
    url_canonique: urlFinale,
    detail: {
      ...((signal.detail as Record<string, unknown>) || {}),
      description: fiche.objet || undefined,
      lieu: fiche.lieu || undefined,
      dceAccess: fiche.dceAccess || undefined,
      dceUrl: fiche.dceUrl || undefined,
      parseur: VERSION_PARSEUR,
    },
  }
  // la fiche publique fait AUTORITÉ sur l'alerte, sauf champ validé à la main
  if (fiche.titre && !valides.has('titre')) patch.objet = fiche.titre
  if (fiche.acheteur && !valides.has('acheteur')) patch.acheteur = fiche.acheteur
  if (fiche.procedure && !valides.has('procedure')) patch.procedure = fiche.procedure
  if (fiche.reference && !valides.has('reference')) patch.reference = fiche.reference
  const deps = departementsDe(fiche.lieu)
  if (deps.length > 0 && (!signal.departements || (signal.departements as string[]).length === 0)) {
    patch.departements = deps
  }
  const dateAvant = (signal.date_limite as string | null) || null
  let dateApres = dateAvant
  if (fiche.dateLimite && !valides.has('date_limite')) {
    patch.date_limite = fiche.dateLimite
    dateApres = fiche.dateLimite
  }
  await sb.from('veille_signaux').update(patch).eq('source', source).eq('source_id', sourceId)
  return { dateAvant, dateApres }
}

/** rectificatif si la date limite a bougé — UN événement, jamais un doublon */
async function signalerChangementDate(
  sb: SupabaseClient,
  source: string,
  sourceId: string,
  objet: string,
  nouvelleDate: string,
): Promise<void> {
  const idRect = `${sourceId}-rect-${nouvelleDate}`
  const { data: deja } = await sb
    .from('veille_signaux')
    .select('source_id')
    .eq('source', source)
    .eq('source_id', idRect)
    .maybeSingle()
  if (deja) return
  await sb.from('veille_signaux').insert({
    source,
    source_id: idRect,
    type: 'rectificatif',
    type_avis: 'marche',
    objet: `Mise à jour de la fiche — ${objet.slice(0, 180)}`,
    acheteur: '',
    date_parution: new Date().toISOString().slice(0, 10),
    date_limite: nouvelleDate,
    departements: [],
    descripteurs: [],
    annonces_liees: [sourceId],
    url: null,
    niveau_analyse: 'fiche',
  })
}

/** fetch_detail / resolve_link / check_updates : lire la fiche publique */
async function traiterFiche(sb: SupabaseClient, job: Job): Promise<ResultatJob> {
  if (!job.url) return { status: 'failed', error_code: 'sans_url' }

  let page: PageChargee
  try {
    page = await chargerUrl(job.url)
  } catch (e) {
    return { status: 'requeue', error_code: 'reseau', error_detail: e instanceof Error ? e.message : String(e) }
  }
  if (!domaineAutorise(page.urlFinale)) {
    return { status: 'blocked', error_code: 'domaine_hors_liste', error_detail: page.urlFinale }
  }
  if (page.status === 401 || page.status === 403) {
    return { status: 'needs_login', error_code: `http_${page.status}` }
  }
  if (page.status === 404 || page.status === 410) {
    return { status: 'failed', error_code: 'page_disparue' }
  }
  if (page.status >= 500) {
    return { status: 'requeue', error_code: `http_${page.status}` }
  }
  if (exigeConnexion(page.corps)) {
    await memoriserPage(sb, job.id, page, 0, 'needs_login')
    return { status: 'needs_login', error_code: 'connexion_requise' }
  }
  if (coquilleJs(page.corps)) {
    await memoriserPage(sb, job.id, page, 0, 'needs_browser')
    return { status: 'needs_browser', error_code: 'page_pilotee_js' }
  }

  const adaptateur = ADAPTATEURS.find((a) => a.canHandle(page.urlFinale))!
  const fiche = adaptateur.parseDetail(page.corps, page.urlFinale)
  const champs = [fiche.titre, fiche.acheteur, fiche.dateLimite, fiche.reference]
  const completude = champs.filter(Boolean).length / champs.length

  // check_updates : ne re-parser que si le contenu a bougé
  if (job.kind === 'check_updates') {
    const empreinte = await sha256Hex(page.corps)
    const { data: derniere } = await sb
      .from('veille_pages')
      .select('content_hash')
      .eq('canonical_url', page.urlFinale)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (derniere && derniere.content_hash === empreinte) {
      return { status: 'complete' } // rien n'a changé — pas de bruit
    }
  }

  await memoriserPage(sb, job.id, page, completude, fiche.titre ? 'ok' : 'incomplet')

  // recette §5.5 : un 200 sans les champs minimaux n'est PAS un succès
  if (!fiche.titre) {
    return job.attempts >= job.max_attempts
      ? { status: 'failed', error_code: 'extraction_incomplete', error_detail: `adaptateur ${adaptateur.id}` }
      : { status: 'requeue', error_code: 'extraction_incomplete', error_detail: `adaptateur ${adaptateur.id}` }
  }

  const source = job.signal_source || job.source
  const sourceId = job.signal_source_id
  if (sourceId) {
    const dates = await appliquerFiche(sb, source, sourceId, fiche, page.urlFinale)
    if (dates && dates.dateAvant && dates.dateApres && dates.dateAvant !== dates.dateApres) {
      await signalerChangementDate(sb, source, sourceId, fiche.titre, dates.dateApres)
    }
  }
  return { status: 'complete' }
}

/** fetch_dce : NIVEAU 1 uniquement (téléchargement public direct).
 *  Formulaire ou compte → action humaine unique, jamais de contournement. */
async function traiterDce(sb: SupabaseClient, job: Job): Promise<ResultatJob> {
  const source = job.signal_source || job.source
  const sourceId = job.signal_source_id
  if (!sourceId) return { status: 'failed', error_code: 'sans_signal' }

  const { data: signal } = await sb
    .from('veille_signaux')
    .select('objet,detail,url_canonique,url')
    .eq('source', source)
    .eq('source_id', sourceId)
    .maybeSingle()
  if (!signal) return { status: 'failed', error_code: 'signal_inconnu' }

  const detail = (signal.detail as Record<string, unknown>) || {}
  const dceUrl = (job.url || (detail.dceUrl as string) || '').trim()
  const dceAccess = (detail.dceAccess as string) || 'unknown'

  if (!dceUrl) {
    // pas de lien DCE connu → action humaine (retrait sur la plateforme)
    await sb.from('veille_documents').insert({
      signal_source: source,
      signal_source_id: sourceId,
      source_url: (signal.url_canonique as string) || (signal.url as string) || null,
      access_mode: 'unknown',
      last_checked_at: new Date().toISOString(),
    })
    return { status: 'needs_login', error_code: 'retrait_manuel', error_detail: 'Lien DCE non publié — retirer sur la plateforme puis déposer le ZIP.' }
  }
  if (!domaineAutorise(dceUrl)) return { status: 'blocked', error_code: 'domaine_hors_liste' }
  if (dceAccess !== 'public') {
    await sb.from('veille_documents').insert({
      signal_source: source,
      signal_source_id: sourceId,
      source_url: (signal.url_canonique as string) || null,
      download_url: dceUrl,
      access_mode: dceAccess === 'login' ? 'login' : 'form',
      last_checked_at: new Date().toISOString(),
    })
    return {
      status: 'needs_login',
      error_code: 'retrait_identifie_ou_compte',
      error_detail: 'Le retrait passe par un formulaire ou un compte — action humaine unique, puis déposer le ZIP dans Documents.',
    }
  }

  let fichier: PageChargee
  try {
    fichier = await chargerUrl(dceUrl, true)
  } catch (e) {
    return { status: 'requeue', error_code: 'reseau', error_detail: e instanceof Error ? e.message : String(e) }
  }
  if (fichier.status !== 200 || !fichier.binaire) {
    return { status: 'requeue', error_code: `http_${fichier.status}` }
  }
  const empreinte = await sha256Hex(fichier.binaire)

  // versions : même empreinte = rien de neuf ; sinon version suivante
  const { data: versions } = await sb
    .from('veille_documents')
    .select('content_hash,version')
    .eq('signal_source', source)
    .eq('signal_source_id', sourceId)
    .order('version', { ascending: false })
  const derniere = (versions || [])[0]
  if (derniere && derniere.content_hash === empreinte) {
    await sb
      .from('veille_documents')
      .update({ last_checked_at: new Date().toISOString() })
      .eq('signal_source', source)
      .eq('signal_source_id', sourceId)
      .eq('version', derniere.version)
    return { status: 'complete' }
  }
  const version = derniere ? Number(derniere.version) + 1 : 1

  const nomFichier = decodeURIComponent((new URL(dceUrl).pathname.split('/').pop() || 'dce.zip').slice(-80)) || 'dce.zip'
  const chemin = `plateformes/${source}-${sourceId}/v${version}-${nomFichier}`
  const { error: eUpload } = await sb.storage
    .from('entrants')
    .upload(chemin, new Blob([fichier.binaire], { type: fichier.contentType || 'application/octet-stream' }), {
      upsert: true,
    })
  if (eUpload) return { status: 'failed', error_code: 'stockage', error_detail: eUpload.message }

  await sb.from('veille_documents').insert({
    signal_source: source,
    signal_source_id: sourceId,
    source_url: (signal.url_canonique as string) || null,
    download_url: dceUrl,
    file_name: nomFichier,
    mime_type: fichier.contentType || null,
    content_hash: empreinte,
    version,
    access_mode: 'public',
    storage_path: chemin,
    fetched_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
  })

  // le DCE arrive dans la boîte « Arrivées serveur » de l'app (table entrants)
  await sb.from('entrants').insert({
    source: 'plateforme',
    expediteur: source,
    objet: `DCE — ${(signal.objet as string) || sourceId}${version > 1 ? ` (version ${version})` : ''}`,
    recu_le: new Date().toISOString(),
    nom_fichier: nomFichier,
    type_mime: fichier.contentType || null,
    taille: fichier.binaire.byteLength,
    empreinte_sha256: empreinte,
    chemin_storage: chemin,
    categorie_proposee: 'DCE',
    confiance: 0.9,
    raisons: [`DCE téléchargé automatiquement (retrait public) — ${dceUrl}`, `version ${version}`],
    statut: 'a_valider',
  })

  await sb.from('veille_signaux').update({ niveau_analyse: 'dce' }).eq('source', source).eq('source_id', sourceId)
  return { status: 'complete' }
}

/** planifie check_updates pour les consultations SUIVIES (validées / Go)
 *  d'après l'état partagé de l'agence — une fois par ~20 h et par fiche */
async function planifierSurveillance(sb: SupabaseClient): Promise<number> {
  const { data: espaces } = await sb.from('workspace').select('data').limit(1)
  const etat = (espaces || [])[0]?.data as
    | { consultations?: { statut?: string; sourceId?: string; sourceUrl?: string; intitule?: string }[] }
    | undefined
  if (!etat?.consultations) return 0
  const suivies = etat.consultations
    .filter((c) => ['a_etudier', 'go', 'deposee'].includes(c.statut || '') && c.sourceId && c.sourceUrl)
    .slice(0, 20)
  let crees = 0
  for (const c of suivies) {
    if (!domaineAutorise(c.sourceUrl!) ) continue // BOAMP/TED gérés par veille-collecte
    const { data: dernier } = await sb
      .from('veille_jobs')
      .select('finished_at,status')
      .eq('kind', 'check_updates')
      .eq('signal_source_id', c.sourceId!)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (dernier && ['queued', 'fetching'].includes(dernier.status as string)) continue
    if (dernier?.finished_at && Date.now() - new Date(dernier.finished_at as string).getTime() < 20 * 3600_000) continue
    const { data: signal } = await sb
      .from('veille_signaux')
      .select('source,url_canonique,url')
      .eq('source_id', c.sourceId!)
      .limit(1)
      .maybeSingle()
    const { error } = await sb.from('veille_jobs').insert({
      signal_source: signal?.source || 'suivi',
      signal_source_id: c.sourceId,
      source: signal?.source || 'suivi',
      kind: 'check_updates',
      url: (signal?.url_canonique as string) || (signal?.url as string) || c.sourceUrl,
      parser_version: VERSION_PARSEUR,
    })
    if (!error) crees++
  }
  return crees
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

  const surveillance = await planifierSurveillance(sb).catch(() => 0)

  const { data: jobs, error: eClaim } = await sb.rpc('reclamer_veille_jobs', { nb: JOBS_PAR_RUN })
  if (eClaim) return json({ erreur: `File illisible : ${eClaim.message}` }, 500)

  const resultats: Record<string, number> = {}
  for (const job of (jobs || []) as Job[]) {
    let r: ResultatJob
    try {
      r = job.kind === 'fetch_dce' ? await traiterDce(sb, job) : await traiterFiche(sb, job)
    } catch (e) {
      r = { status: 'failed', error_code: 'exception', error_detail: e instanceof Error ? e.message : String(e) }
    }
    await finirJob(sb, job, r)
    resultats[r.status] = (resultats[r.status] || 0) + 1
  }

  return json({
    statut: 'ok',
    jobs: (jobs || []).length,
    resultats,
    surveillanceProgrammee: surveillance,
    version: VERSION_PARSEUR,
  })
})
