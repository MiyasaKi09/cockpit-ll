// ============================================================
// scraper-worker — navigateur serveur de REPLI (Lot 0 ter C).
// Ne traite QUE les jobs `needs_browser` : pages PUBLIQUES dont le
// contenu n'existe qu'après exécution de JavaScript. Tout le reste
// est déjà couvert par veille-enrichir (HTTP simple).
//
// GARDE-FOUS CÂBLÉS (audit §6.3/§14) — ne pas les retirer :
// liste blanche de domaines, quota par domaine et par heure, délai
// max par job, session neuve sans cookies, aucun compte, aucun
// CAPTCHA contourné (→ blocked), aucune soumission, circuit ouvert
// après erreurs consécutives, User-Agent honnête.
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { ADAPTATEURS, type FicheExtraite } from './adaptateurs.ts'

const UA = 'CockpitLL-Veille/1.0 (agence architecture ; contact : julenglet@gmail.com)'
const VERSION = 'worker-0.1'
const DELAI_MAX_JOB_MS = 45_000
const PAGES_MAX_PAR_DOMAINE_HEURE = 20
const ERREURS_CONSECUTIVES_MAX = 5
const PAUSE_ENTRE_CYCLES_MS = 60_000

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
]

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const compteurDomaine = new Map<string, { fenetre: number; n: number }>()
let erreursConsecutives = 0

function domaineAutorise(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase()
    const ok = DOMAINES_AUTORISES.some((d) => h === d || h.endsWith(`.${d}`))
    return ok ? h : null
  } catch {
    return null
  }
}

function quotaAtteint(domaine: string): boolean {
  const heure = Math.floor(Date.now() / 3600_000)
  const c = compteurDomaine.get(domaine)
  if (!c || c.fenetre !== heure) {
    compteurDomaine.set(domaine, { fenetre: heure, n: 1 })
    return false
  }
  c.n++
  return c.n > PAGES_MAX_PAR_DOMAINE_HEURE
}

async function finirJob(id: string, status: string, code?: string, detail?: string): Promise<void> {
  await sb
    .from('veille_jobs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      error_code: code || null,
      error_detail: detail || null,
      parser_version: VERSION,
    })
    .eq('id', id)
}

async function traiterJob(job: {
  id: string
  url: string | null
  signal_source: string | null
  signal_source_id: string | null
}): Promise<void> {
  if (!job.url) return finirJob(job.id, 'failed', 'sans_url')
  const domaine = domaineAutorise(job.url)
  if (!domaine) return finirJob(job.id, 'blocked', 'domaine_hors_liste')
  if (quotaAtteint(domaine)) {
    // repasse en file pour l'heure suivante — jamais de martèlement
    await sb
      .from('veille_jobs')
      .update({ status: 'needs_browser', next_attempt_at: new Date(Date.now() + 3600_000).toISOString() })
      .eq('id', job.id)
    return
  }

  // session NEUVE par job : aucun cookie conservé, aucun stockage
  const navigateur = await chromium.launch({ headless: true })
  const contexte = await navigateur.newContext({ userAgent: UA })
  try {
    const page = await contexte.newPage()
    await page.goto(job.url, { timeout: DELAI_MAX_JOB_MS, waitUntil: 'domcontentloaded' })

    const adaptateur = ADAPTATEURS.find((a) => a.canHandle(page.url()))!
    // état MÉTIER précis (sélecteur de l'adaptateur), pas un délai arbitraire
    await page.waitForSelector(adaptateur.selecteurPret, { timeout: DELAI_MAX_JOB_MS })

    const html = await page.content()
    // CAPTCHA ou mur de connexion : on s'arrête PROPREMENT, sans insister
    if (/captcha|hcaptcha|recaptcha/i.test(html)) return finirJob(job.id, 'blocked', 'captcha')
    if (/identifiez-vous|veuillez vous connecter|acc[eè]s r[ée]serv[ée]/i.test(html)) {
      return finirJob(job.id, 'needs_login', 'connexion_requise')
    }

    const fiche: FicheExtraite = adaptateur.parseDetail(html, page.url())
    if (!fiche.titre) return finirJob(job.id, 'failed', 'extraction_incomplete', `adaptateur ${adaptateur.id}`)

    // même contrat de sortie que veille-enrichir : signal + provenance
    if (job.signal_source && job.signal_source_id) {
      await sb
        .from('veille_signaux')
        .update({
          objet: fiche.titre,
          acheteur: fiche.acheteur || undefined,
          date_limite: fiche.dateLimite || undefined,
          procedure: fiche.procedure || undefined,
          reference: fiche.reference || undefined,
          niveau_analyse: 'fiche',
          enrichi_le: new Date().toISOString(),
          url_canonique: page.url(),
          detail: { description: fiche.objet, dceAccess: fiche.dceAccess, dceUrl: fiche.dceUrl, parseur: VERSION },
        })
        .eq('source', job.signal_source)
        .eq('source_id', job.signal_source_id)
      const preuves = Object.entries({
        titre: fiche.titre,
        acheteur: fiche.acheteur,
        date_limite: fiche.dateLimite,
        reference: fiche.reference,
      })
        .filter(([, v]) => v)
        .map(([champ, v]) => ({
          signal_source: job.signal_source,
          signal_source_id: job.signal_source_id,
          field_name: champ,
          value: String(v),
          source_connector_id: 'scraper-worker',
          page_url: page.url(),
          confidence: 0.8,
          validation_status: 'automatique',
        }))
      if (preuves.length > 0) await sb.from('veille_field_evidence').insert(preuves)
    }
    await finirJob(job.id, 'complete')
    erreursConsecutives = 0
  } catch (e) {
    erreursConsecutives++
    await finirJob(job.id, 'failed', 'exception', e instanceof Error ? e.message : String(e))
  } finally {
    await contexte.close()
    await navigateur.close()
  }
}

async function cycle(): Promise<void> {
  const { data: jobs } = await sb
    .from('veille_jobs')
    .select('id,url,signal_source,signal_source_id')
    .eq('status', 'needs_browser')
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at')
    .limit(3)
  for (const job of jobs || []) {
    if (erreursConsecutives >= ERREURS_CONSECUTIVES_MAX) {
      console.error(`Circuit OUVERT après ${erreursConsecutives} erreurs consécutives — arrêt du worker.`)
      process.exit(1)
    }
    await traiterJob(job)
  }
}

console.log(`scraper-worker ${VERSION} — repli navigateur (needs_browser uniquement)`)
for (;;) {
  await cycle().catch((e) => console.error('cycle en erreur :', e))
  await new Promise((r) => setTimeout(r, PAUSE_ENTRE_CYCLES_MS))
}
