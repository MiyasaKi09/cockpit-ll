// ============================================================
// veille-mails v2 (Lot 0 ter A) — les ALERTES E-MAIL des plateformes
// deviennent des signaux EXPLOITABLES :
//
// - un digest de 12 consultations produit 12 signaux (parseur
//   multi-items par famille, découpage par liens candidats) ;
// - l'identité du signal est MÉTIER (identifiant plateforme dans
//   l'URL > référence > clé provisoire) — « mail-xxx » n'est plus
//   qu'une OBSERVATION : deux mails sur la même consultation font
//   deux observations et une seule opportunité ;
// - liens parasites exclus (désinscription, compte, réseaux…) ;
// - lecture Gmail INCRÉMENTALE : curseur de dernière lecture +
//   pagination (plus de fenêtre fixe 7 j / 40 messages) ;
// - chaque signal avec URL crée un job d'enrichissement
//   (veille-enrichir lira la fiche publique) ;
// - un mail de plateforme connue qui ne produit RIEN est signalé
//   (« format modifié ? ») au lieu de disparaître en silence.
//
// Voie conforme (audit §7.4) : pas de scraping authentifié — on lit
// la boîte Gmail de l'agence (lecture seule).
// Accès : x-cron-secret (planificateur horaire) OU jeton agence.
// ============================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const VERSION_PARSEUR = 'mails-2.0'
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

async function sha1Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------- Gmail ----------

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

/** première partie d'un type donné (récursif) */
function partieDeType(p: PartieGmail | undefined, type: string): string {
  if (!p) return ''
  if (p.mimeType === type && p.body?.data) return depuisBase64Url(p.body.data)
  for (const enfant of p.parts || []) {
    const t = partieDeType(enfant, type)
    if (t) return t
  }
  return ''
}

// ---------- HTML → texte & liens ----------

function decoderEntites(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&eacute;/gi, 'é')
    .replace(/&egrave;/gi, 'è')
    .replace(/&agrave;/gi, 'à')
    .replace(/&ccedil;/gi, 'ç')
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n)
      return c > 31 && c < 65536 ? String.fromCharCode(c) : ' '
    })
}

function debaliser(html: string): string {
  return decoderEntites(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

interface LienMail {
  url: string
  texte: string
  /** contexte débalisé autour du lien (titre voisin, acheteur, dates…) */
  avant: string
  apres: string
}

/** tous les liens du HTML avec leur texte et leur voisinage */
function extraireLiens(html: string): LienMail[] {
  const liens: LienMail[] = []
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const url = decoderEntites(m[1]).trim()
    if (!/^https?:\/\//i.test(url)) continue
    liens.push({
      url,
      texte: debaliser(m[2]).replace(/\s+/g, ' ').trim(),
      avant: debaliser(html.slice(Math.max(0, m.index - 700), m.index)),
      apres: debaliser(html.slice(m.index + m[0].length, m.index + m[0].length + 400)),
    })
  }
  return liens
}

/** liens PARASITES : jamais des consultations (recette 0 ter A §4.3) */
const URL_PARASITE =
  /unsubscribe|desinscri|d%C3%A9sinscri|desabo|preference|profil|mon-?compte|login|connexion|password|mot-?de-?passe|inscription|creer-?un-?compte|facebook|twitter|linkedin|youtube|instagram|\.(png|jpe?g|gif|svg|ico)(\?|$)|mailto:|\/aide|\/faq|\/cgu|mentions-?legales|\/contact$|\/blog|matomo|analytics|doubleclick/i
const TEXTE_PARASITE =
  /d[ée]sinscri|d[ée]sabonn|pr[ée]f[ée]rence|se connecter|cr[ée]er (un|votre) compte|mentions l[ée]gales|^aide$|assistance|cgu|voir en ligne|version en ligne/i

function estParasite(l: LienMail): boolean {
  if (URL_PARASITE.test(l.url)) return true
  if (TEXTE_PARASITE.test(l.texte)) return true
  // page d'accueil sans identifiant de consultation
  try {
    const u = new URL(l.url)
    if ((u.pathname === '/' || u.pathname === '') && !u.search) return true
  } catch {
    return true
  }
  return false
}

// ---------- identités plateforme dans les URLs ----------

/** extrait l'identifiant MÉTIER d'une URL de consultation, par famille.
 *  null = URL sans identifiant reconnaissable (pas forcément parasite). */
function idDepuisUrl(plateforme: string, url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const q = u.search
  if (plateforme === 'aws') {
    const idm = /IDM=(\d{3,})/i.exec(q) || /IDM=(\d{3,})/i.exec(u.pathname)
    if (idm) return `idm-${idm[1]}`
    const ann = /\/annonces?\/(?:detail\/)?(\d{4,})/i.exec(u.pathname)
    if (ann) return `annonce-${ann[1]}`
    return null
  }
  // portails Atexo (PLACE, Maximilien, Mégalis, Ternum) : id + orgAcronyme
  if (['place', 'maximilien', 'megalis', 'ternum'].includes(plateforme)) {
    const id = /[?&](?:id|refConsultation)=(\d{3,})/i.exec(q)
    const org = /[?&]orgAcronyme=([a-z0-9_-]+)/i.exec(q)
    if (id) return org ? `${id[1]}-${org[1]}` : id[1]
    return null
  }
  if (plateforme === 'emp') {
    const id = /(?:consultation|appel-?offre|detail)[^0-9]{0,20}(\d{5,})/i.exec(u.pathname + q)
    return id ? id[1] : null
  }
  if (plateforme === 'marchesonline') {
    const id = /(?:^|[-/])((?:ao|avis)[-a-z0-9]*\d{5,}|\d{6,})(?:\.htm|$|[/?])/i.exec(u.pathname)
    return id ? id[1] : null
  }
  if (plateforme === 'klekoon') {
    const id = /(\d{4,})/.exec(u.pathname)
    return id ? id[1] : null
  }
  if (plateforme === 'marchessecurises') {
    const id = /[?&](?:ref|reference|cons(?:ultation)?)=([a-z0-9_-]{4,})/i.exec(q) || /(\d{5,})/.exec(u.pathname)
    return id ? id[1] : null
  }
  return null
}

/** le lien ressemble-t-il à une CONSULTATION de cette famille ? */
function estLienConsultation(plateforme: string, l: LienMail): boolean {
  if (idDepuisUrl(plateforme, l.url) !== null) return true
  let u: URL
  try {
    u = new URL(l.url)
  } catch {
    return false
  }
  const cible = `${u.pathname}${u.search}`
  // pages de navigation Atexo sans identifiant (accueil, recherche, aide…)
  if (/page=Entreprise\./i.test(cible)) return false
  // motifs « avis/consultation » dans le CHEMIN (pas le domaine — les
  // domaines de ces plateformes contiennent tous « marches ») : on garde,
  // l'enrichissement suivra les redirections de suivi
  return /avis|consult|annonce|appel|offre|dce|detail/i.test(cible) && !URL_PARASITE.test(l.url)
}

// ---------- extraction d'un item ----------

export interface ExtraitAlerte {
  plateforme: string
  sourceMessageId: string
  sourceItemId?: string
  titre: string
  acheteur?: string
  reference?: string
  dateLimite?: string
  lieu?: string
  urlCandidate: string
  concours: boolean
  confiance: number
}

/** « 12/09/2026 », « 12-09-26 » → ISO (ou null) */
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

const TEXTE_LIEN_GENERIQUE =
  /^(voir|consulter|acc[ée]der|d[ée]tail|lien|cliquez|en savoir plus|ouvrir|t[ée]l[ée]charger|ici|l'avis|la consultation|acc[eè]s direct)/i

/** lignes-CHAMPS d'un bloc d'alerte (jamais des titres) */
const LIGNE_CHAMP =
  /^(organisme|acheteur|client|collectivit|ma[îi]tre d.ouvrage|date|lieu|localisation|r[ée]f[ée]rence|proc[ée]dure|d[ée]partement|cl[ôo]ture|limite|remise|publi[ée]|parution)\b/i

/** titre depuis le voisinage quand le texte du lien est générique :
 *  la dernière ligne substantielle qui précède le lien, hors lignes-champs */
function titreDepuisContexte(avant: string): string | null {
  const lignes = avant
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) => l.length >= 12 && !TEXTE_PARASITE.test(l) && !/^https?:/.test(l) && !LIGNE_CHAMP.test(l),
    )
  const c = lignes[lignes.length - 1]
  return c ? c.slice(0, 220) : null
}

function champsDuContexte(contexte: string): {
  acheteur?: string
  dateLimite?: string
  lieu?: string
  reference?: string
} {
  const mAcheteur = /(?:organisme|acheteur|client|collectivit[ée]|entit[ée] adjudicatrice|ma[îi]tre d.ouvrage)\s*:?\s*([^\n]{3,90})/i.exec(contexte)
  const mLimite = /(?:date (?:et heure )?limite|remise des (?:offres|plis|candidatures)|r[ée]pondre avant|cl[ôo]ture|avant le)[^\n]{0,50}?(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i.exec(contexte)
  const mLieu = /(?:lieu|d[ée]partement|localisation)\s*:?\s*([^\n]{2,60})/i.exec(contexte)
  const mRef = /r[ée]f(?:[ée]rence)?\s*[:.]?\s*([A-Z0-9][A-Z0-9_\/-]{3,24})/i.exec(contexte)
  return {
    acheteur: mAcheteur ? mAcheteur[1].replace(/\s{2,}/g, ' ').trim() : undefined,
    dateLimite: mLimite ? dateFrVersISO(mLimite[1]) || undefined : undefined,
    lieu: mLieu ? mLieu[1].trim() : undefined,
    reference: mRef ? mRef[1].trim() : undefined,
  }
}

interface MessageVeille {
  id: string
  sujet: string
  de: string
  internalDate: number
  html: string
  texte: string
}

/** LE parseur multi-items : un digest → N alertes, chaque intitulé
 *  associé à SON lien. Déterministe et conservateur : un lien sans
 *  titre exploitable retombe sur le sujet avec une confiance basse. */
export function extraireAlertesPlateforme(
  plateforme: { id: string; nom: string; domaines: string[] },
  msg: MessageVeille,
): ExtraitAlerte[] {
  const sujetPropre = msg.sujet
    .replace(/^\s*(re\s*:|tr\s*:|fwd?\s*:)/i, '')
    .replace(/^\s*\[[^\]]{0,40}\]\s*/, '')
    .trim()

  const liens = extraireLiens(msg.html).filter((l) => !estParasite(l))
  const candidats = liens.filter((l) => estLienConsultation(plateforme.id, l))

  const items: ExtraitAlerte[] = []
  const vues = new Set<string>()
  for (const l of candidats) {
    const itemId = idDepuisUrl(plateforme.id, l.url)
    const cle = itemId || l.url
    if (vues.has(cle)) continue
    vues.add(cle)

    let titre = l.texte
    let confiance = 0.9
    if (!titre || titre.length < 12 || TEXTE_LIEN_GENERIQUE.test(titre)) {
      const voisin = titreDepuisContexte(l.avant)
      if (voisin) {
        titre = voisin
        confiance = 0.7
      } else {
        titre = sujetPropre
        confiance = 0.35
      }
    }
    if (!itemId) confiance = Math.min(confiance, 0.6)

    const contexte = `${l.avant}\n${l.texte}\n${l.apres}`
    const champs = champsDuContexte(contexte)
    items.push({
      plateforme: plateforme.id,
      sourceMessageId: msg.id,
      sourceItemId: itemId || undefined,
      titre: titre.slice(0, 250),
      acheteur: champs.acheteur,
      reference: champs.reference,
      dateLimite: champs.dateLimite,
      lieu: champs.lieu,
      urlCandidate: l.url,
      concours: /concours/i.test(`${titre} ${contexte.slice(0, 600)}`),
      confiance,
    })
  }

  // mail sans HTML exploitable : repli une-alerte-par-mail (texte brut)
  if (items.length === 0 && candidats.length === 0) {
    const texteComplet = msg.texte || debaliser(msg.html)
    const lienTexte = (texteComplet.match(/https?:\/\/[^\s"'<>)\]]+/g) || []).find(
      (u) => plateforme.domaines.some((d) => u.includes(d)) && !URL_PARASITE.test(u),
    )
    if (lienTexte && sujetPropre) {
      const champs = champsDuContexte(texteComplet.slice(0, 3000))
      items.push({
        plateforme: plateforme.id,
        sourceMessageId: msg.id,
        sourceItemId: idDepuisUrl(plateforme.id, lienTexte) || undefined,
        titre: sujetPropre.slice(0, 250),
        acheteur: champs.acheteur,
        reference: champs.reference,
        dateLimite: champs.dateLimite,
        lieu: champs.lieu,
        urlCandidate: lienTexte,
        concours: /concours/i.test(`${sujetPropre} ${texteComplet.slice(0, 2000)}`),
        confiance: 0.35,
      })
    }
  }
  return items
}

/** identité MÉTIER du signal (recette §4.4) : id plateforme > référence
 *  > clé provisoire acheteur+titre+date (rapprochée ensuite par la fiche) */
async function identiteSignal(item: ExtraitAlerte): Promise<string> {
  if (item.sourceItemId) return item.sourceItemId
  if (item.reference) return `ref-${fold(item.reference).replace(/[^a-z0-9]+/g, '-')}`
  const h = await sha1Hex(`${fold(item.acheteur || '')}|${fold(item.titre)}|${item.dateLimite || ''}`)
  return `prov-${h.slice(0, 16)}`
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

  let examines = 0
  let signauxNouveaux = 0
  let signauxMaj = 0
  let observations = 0
  let jobs = 0
  const formatsSuspects: string[] = []

  try {
    // ---- lecture INCRÉMENTALE : libellé « Veille AO » si présent,
    //      sinon filtre expéditeurs ; curseur = dernier internalDate lu
    const { data: etatCurseur } = await sb.from('veille_etat').select('valeur').eq('cle', 'gmail_veille_curseur').maybeSingle()
    const curseurMs = etatCurseur?.valeur ? Number(etatCurseur.valeur) : Date.now() - 14 * 864e5
    const apresSec = Math.floor(curseurMs / 1000)

    let clause = ''
    try {
      const labels = await gmail<{ labels?: { id: string; name: string }[] }>(jetonGmail, 'labels')
      const veilleLabel = (labels.labels || []).find((l) => fold(l.name) === 'veille ao')
      if (veilleLabel) clause = `label:"${veilleLabel.name}"`
    } catch {
      // liste des libellés inaccessible → filtre expéditeurs
    }
    if (!clause) {
      clause = `(${PLATEFORMES.flatMap((p) => p.domaines).map((d) => `from:${d}`).join(' OR ')})`
    }
    const q = encodeURIComponent(`${clause} after:${apresSec}`)

    // pagination bornée (4 pages × 50) — le curseur reprend au prochain run
    const ids: string[] = []
    let pageToken = ''
    for (let page = 0; page < 4; page++) {
      const liste = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(
        jetonGmail,
        `messages?q=${q}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`,
      )
      ids.push(...(liste.messages || []).map((m) => m.id))
      if (!liste.nextPageToken) break
      pageToken = liste.nextPageToken
    }

    // idempotence par message : déjà observé = déjà traité
    const dejaObserves = new Set<string>()
    if (ids.length > 0) {
      const { data: obs } = await sb
        .from('veille_observations')
        .select('message_id')
        .eq('canal', 'mail')
        .in('message_id', ids)
      for (const o of obs || []) dejaObserves.add(o.message_id as string)
    }

    // traite du plus ancien au plus récent pour avancer le curseur sûrement
    const messages: MessageVeille[] = []
    for (const id of ids) {
      if (dejaObserves.has(id)) continue
      if (messages.length >= 120) break // borne par run
      const m = await gmail<{
        internalDate?: string
        payload?: PartieGmail & { headers?: { name: string; value: string }[] }
      }>(jetonGmail, `messages/${id}?format=full`)
      const entete = (nom: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === nom)?.value || ''
      messages.push({
        id,
        sujet: entete('subject') || '(sans objet)',
        de: entete('from'),
        internalDate: Number(m.internalDate || 0),
        html: partieDeType(m.payload, 'text/html'),
        texte: partieDeType(m.payload, 'text/plain'),
      })
    }
    messages.sort((a, b) => a.internalDate - b.internalDate)

    let curseurSuivant = curseurMs
    for (const msg of messages) {
      const plateforme = PLATEFORMES.find((p) => p.domaines.some((d) => msg.de.includes(d)))
      if (!plateforme) {
        curseurSuivant = Math.max(curseurSuivant, msg.internalDate)
        continue
      }
      examines++

      // brut conservé pour diagnostic et fixtures (best effort, temporaire)
      if (msg.html) {
        const mois = new Date(msg.internalDate || Date.now()).toISOString().slice(0, 7)
        await sb.storage
          .from('veille')
          .upload(`mails/${mois}/${msg.id}.html`, new Blob([msg.html], { type: 'text/html' }), { upsert: true })
          .catch(() => undefined)
      }

      const items = extraireAlertesPlateforme(plateforme, msg)
      if (items.length === 0) {
        // recette : un changement de format = une erreur VISIBLE
        formatsSuspects.push(`${plateforme.nom} : « ${msg.sujet.slice(0, 60)} » n'a produit aucun item`)
        curseurSuivant = Math.max(curseurSuivant, msg.internalDate)
        continue
      }

      for (const item of items) {
        const sourceId = await identiteSignal(item)
        const dateParution = msg.internalDate ? new Date(msg.internalDate).toISOString().slice(0, 10) : null

        const { data: existant } = await sb
          .from('veille_signaux')
          .select('source_id, acheteur, date_limite, url')
          .eq('source', plateforme.id)
          .eq('source_id', sourceId)
          .maybeSingle()

        if (!existant) {
          const { error } = await sb.from('veille_signaux').insert({
            source: plateforme.id,
            source_id: sourceId,
            type: 'initial',
            type_avis: item.concours ? 'concours' : 'marche',
            objet: item.titre,
            acheteur: item.acheteur || '',
            date_parution: dateParution,
            date_limite: item.dateLimite || null,
            departements: [],
            procedure: null,
            descripteurs: [],
            annonces_liees: [],
            url: item.urlCandidate,
            reference: item.reference || null,
            niveau_analyse: 'alerte',
          })
          if (!error) signauxNouveaux++
        } else {
          // même consultation revue : on COMPLÈTE (jamais d'écrasement)
          const patch: Record<string, unknown> = {}
          if (!existant.acheteur && item.acheteur) patch.acheteur = item.acheteur
          if (!existant.date_limite && item.dateLimite) patch.date_limite = item.dateLimite
          if (Object.keys(patch).length > 0) {
            await sb.from('veille_signaux').update(patch).eq('source', plateforme.id).eq('source_id', sourceId)
            signauxMaj++
          }
        }

        const { error: eObs } = await sb.from('veille_observations').insert({
          signal_source: plateforme.id,
          signal_source_id: sourceId,
          canal: 'mail',
          message_id: msg.id,
          sujet: msg.sujet,
          recu_le: msg.internalDate ? new Date(msg.internalDate).toISOString() : null,
          extrait: item,
        })
        if (!eObs) observations++

        // chaque signal avec URL crée son job d'enrichissement
        const { error: eJob } = await sb.from('veille_jobs').insert({
          signal_source: plateforme.id,
          signal_source_id: sourceId,
          source: plateforme.id,
          kind: 'fetch_detail',
          url: item.urlCandidate,
          parser_version: VERSION_PARSEUR,
        })
        if (!eJob) jobs++
      }
      curseurSuivant = Math.max(curseurSuivant, msg.internalDate)
    }

    await sb.from('veille_etat').upsert({ cle: 'gmail_veille_curseur', valeur: String(curseurSuivant), maj_le: new Date().toISOString() })

    await sb
      .from('veille_collectes')
      .update({
        termine_le: new Date().toISOString(),
        statut: formatsSuspects.length > 0 ? 'ok-avec-avertissements' : 'ok',
        nb_nouveaux: signauxNouveaux,
        nb_maj: signauxMaj,
        erreur: formatsSuspects.length > 0 ? `Format modifié ? ${formatsSuspects.slice(0, 3).join(' · ')}` : null,
      })
      .eq('id', collecte?.id)
  } catch (e) {
    await sb
      .from('veille_collectes')
      .update({ termine_le: new Date().toISOString(), statut: 'erreur', erreur: e instanceof Error ? e.message : String(e) })
      .eq('id', collecte?.id)
    throw e
  }

  return json({
    statut: 'ok',
    examines,
    signauxNouveaux,
    signauxMaj,
    observations,
    jobs,
    formatsSuspects,
    version: VERSION_PARSEUR,
  })
})
