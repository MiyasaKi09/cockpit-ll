// ============================================================
// gmail-ingestion — le scan serveur de la boîte Gmail (lecture
// seule), planifié toutes les 10 minutes par pg_cron. Pour chaque
// pièce jointe récente : empreinte SHA-256, classement DÉTERMINISTE
// (même lexique que src/registre.ts — à garder synchronisés),
// contenu dans le bucket privé « entrants », une ligne d'index
// « à valider ». RIEN n'entre dans les données de l'agence sans
// validation humaine dans le Cockpit.
//
// Accès : en-tête x-cron-secret (planificateur) OU jeton d'une
// personne de l'agence (bouton « Scanner maintenant »).
// ============================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const AGENCE = ['julenglet@gmail.com', 'zoefhebert@gmail.com']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TAILLE_MAX = 20 * 1024 * 1024 // 20 Mo par pièce
const TAILLE_MIN_IMAGE = 20 * 1024 // sous 20 Ko, une image est une signature

function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

function json(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ---------- classement déterministe (miroir de src/registre.ts) ----------

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

const LEXIQUE: { categorie: string; motif: RegExp; libelle: string; poids: number }[] = [
  { categorie: 'CCTP', motif: /cctp|cahier des clauses techniques/, libelle: 'contient « CCTP »', poids: 0.5 },
  { categorie: 'DPGF', motif: /dpgf|decomposition du prix|bordereau des? prix|\bbpu\b|\bdqe\b/, libelle: 'contient « DPGF » (ou BPU/DQE)', poids: 0.5 },
  { categorie: 'SITU', motif: /situation|\bsitu\b|etat d.avancement/, libelle: 'contient « situation »', poids: 0.45 },
  { categorie: 'CR', motif: /compte[ -]?rendu|proces[ -]?verbal|(^|[^a-z])cr([^a-z]|$)|(^|[^a-z])pv([^a-z]|$)/, libelle: 'contient « CR » ou « compte-rendu »', poids: 0.4 },
  { categorie: 'FACT', motif: /facture|(^|[^a-z])fact([^a-z]|$)/, libelle: 'contient « facture »', poids: 0.45 },
  { categorie: 'DEVIS', motif: /devis/, libelle: 'contient « devis »', poids: 0.45 },
  { categorie: 'ADM', motif: /decennale|attestation|assurance|kbis|urssaf|qualibat|\brib\b|vigilance/, libelle: 'document administratif (attestation, assurance…)', poids: 0.4 },
  { categorie: 'PC', motif: /permis de construire|cerfa|(^|[^a-z])pc[0-9]/, libelle: 'permis de construire / CERFA', poids: 0.4 },
  { categorie: 'DCE', motif: /(^|[^a-z])dce([^a-z]|$)|reglement de consultation|\brc\b.*consult|ccap/, libelle: 'pièce du DCE', poids: 0.35 },
  { categorie: 'PLAN', motif: /(^|[^a-z])plan(s)?([^a-z]|$)|\.dwg$|\.ifc$|coupe|facade/, libelle: 'plan (nom ou format DWG/IFC)', poids: 0.35 },
  { categorie: 'PHOTO', motif: /photo|img[_-]|dsc[_-]|\.(jpe?g|png|heic|webp)$/, libelle: 'photo (nom ou format image)', poids: 0.35 },
]

interface Reperes {
  projets: { id: string; nom: string }[]
  entreprises: { raisonSociale: string; domaines: string[] }[]
}

function classer(reperes: Reperes, nomFichier: string, objet: string, expediteur: string) {
  const texte = fold(`${nomFichier} ${objet}`)
  const raisons: string[] = []
  let confiance = 0

  let categorie = 'AUTRE'
  const entree = LEXIQUE.find((l) => l.motif.test(texte))
  if (entree) {
    categorie = entree.categorie
    confiance += entree.poids
    raisons.push(`Le nom ou l'objet ${entree.libelle}.`)
  } else {
    raisons.push('Aucun mot du lexique reconnu — catégorie à choisir.')
  }

  let projetId: string | null = null
  const parId = reperes.projets.find((p) =>
    new RegExp(`(^|[^a-z0-9])${fold(p.id)}([^a-z0-9]|$)`).test(texte),
  )
  if (parId) {
    projetId = parId.id
    confiance += 0.35
    raisons.push(`Contient l'identifiant du projet ${parId.id} (${parId.nom}).`)
  } else {
    const parNom = reperes.projets.find((p) => {
      const nom = fold(p.nom)
      return nom.length >= 5 && texte.includes(nom)
    })
    if (parNom) {
      projetId = parNom.id
      confiance += 0.25
      raisons.push(`Contient le nom du projet « ${parNom.nom} ».`)
    }
  }

  const domaine = fold(expediteur.split('@')[1]?.replace(/>.*$/, '') || '')
  const parDomaine = domaine
    ? reperes.entreprises.find((e) => e.domaines.some((d) => fold(d) === domaine))
    : undefined
  if (parDomaine) {
    confiance += 0.25
    raisons.push(`L'expéditeur (@${domaine}) correspond à « ${parDomaine.raisonSociale} ».`)
  }

  return { categorie, projetId, confiance: Math.min(confiance, 0.95), raisons }
}

// ---------- Gmail ----------

interface PartieGmail {
  filename?: string
  mimeType?: string
  body?: { attachmentId?: string; size?: number }
  parts?: PartieGmail[]
}

function piecesDe(p: PartieGmail | undefined, acc: PartieGmail[] = []): PartieGmail[] {
  if (!p) return acc
  if (p.filename && p.body?.attachmentId) acc.push(p)
  for (const enfant of p.parts || []) piecesDe(enfant, acc)
  return acc
}

async function gmail<T>(jeton: string, chemin: string): Promise<T> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${chemin}`, {
    headers: { Authorization: `Bearer ${jeton}` },
  })
  if (!r.ok) throw new Error(`Gmail a répondu ${r.status} sur ${chemin.split('?')[0]}.`)
  return (await r.json()) as T
}

function depuisBase64Url(b64u: string): Uint8Array {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/')
  const brut = atob(b64)
  const octets = new Uint8Array(brut.length)
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i)
  return octets
}

async function sha256Hex(octets: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', octets.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------- point d'entrée ----------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const sb = admin()
  const { data: cfg } = await sb.from('ingestion_config').select('*').eq('id', 'google').maybeSingle()
  if (!cfg) return json({ erreur: 'Configuration absente.' }, 500)

  // --- accès : planificateur (secret) ou personne de l'agence (jeton) ---
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

  const noter = (resultat: string) =>
    sb
      .from('ingestion_config')
      .update({ dernier_scan: new Date().toISOString(), dernier_resultat: resultat, maj_le: new Date().toISOString() })
      .eq('id', 'google')

  if (!cfg.refresh_token) {
    await noter('En attente : Gmail n’est pas connecté (Paramètres → Branchements).')
    return json({ statut: 'non-connecte' })
  }

  // --- jeton d'accès depuis le refresh token ---
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
  if (!rJeton.ok || !acces.access_token) {
    if (acces.error === 'invalid_grant') {
      // consentement retiré → on efface et on demande une reconnexion
      await sb.from('ingestion_config').update({ refresh_token: null }).eq('id', 'google')
      await noter('Reconnexion requise : Google a révoqué l’accès.')
      return json({ statut: 'reconnexion-requise' })
    }
    await noter(`Erreur Google : ${acces.error || rJeton.status}.`)
    return json({ statut: 'erreur', detail: acces.error }, 502)
  }
  const jetonGmail = acces.access_token

  // --- repères de classement : l'état partagé du Cockpit ---
  const { data: ws } = await sb.from('workspace').select('data').limit(1).maybeSingle()
  const etat = (ws?.data ?? {}) as {
    projets?: { id: string; nom: string }[]
    entreprises?: { raisonSociale: string; domaines?: string[] }[]
  }
  const reperes: Reperes = {
    projets: (etat.projets || []).map((p) => ({ id: p.id, nom: p.nom })),
    entreprises: (etat.entreprises || []).map((e) => ({
      raisonSociale: e.raisonSociale,
      domaines: e.domaines || [],
    })),
  }

  // --- messages récents avec pièces jointes ---
  const q = encodeURIComponent('in:inbox has:attachment newer_than:7d')
  const liste = await gmail<{ messages?: { id: string }[] }>(jetonGmail, `messages?q=${q}&maxResults=25`)
  const ids = (liste.messages || []).map((m) => m.id)

  // messages déjà indexés (au moins une pièce) → on ne les rouvre pas
  const dejaVus = new Set<string>()
  if (ids.length > 0) {
    const { data: existants } = await sb.from('entrants').select('source_id').eq('source', 'gmail').in('source_id', ids)
    for (const e of existants || []) dejaVus.add(e.source_id as string)
  }

  let nouvelles = 0
  let ignorees = 0
  for (const id of ids) {
    if (dejaVus.has(id)) continue
    const m = await gmail<{
      internalDate?: string
      payload?: PartieGmail & { headers?: { name: string; value: string }[] }
    }>(jetonGmail, `messages/${id}?format=full`)
    const entete = (nom: string) =>
      m.payload?.headers?.find((h) => h.name.toLowerCase() === nom)?.value || ''
    const expediteur = entete('from')
    const objet = entete('subject') || '(sans objet)'
    const recuLe = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString()

    const pieces = piecesDe(m.payload)
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]
      const nom = piece.filename!
      const taille = piece.body?.size ?? 0
      const mime = piece.mimeType || ''
      if (taille > TAILLE_MAX) continue
      if (mime.startsWith('image/') && taille < TAILLE_MIN_IMAGE) continue // signatures de mail

      const contenu = await gmail<{ data?: string }>(jetonGmail, `messages/${id}/attachments/${piece.body!.attachmentId}`)
      if (!contenu.data) continue
      const octets = depuisBase64Url(contenu.data)
      const empreinte = await sha256Hex(octets)

      // contenu déjà connu de la boîte d'arrivée → trace « ignorée », pas de stockage
      const { data: doublon } = await sb
        .from('entrants')
        .select('id')
        .eq('empreinte_sha256', empreinte)
        .limit(1)
        .maybeSingle()
      const proposition = classer(reperes, nom, objet, expediteur)
      if (doublon) {
        ignorees++
        await sb.from('entrants').insert({
          source: 'gmail',
          source_id: id,
          piece_index: i,
          expediteur,
          objet,
          recu_le: recuLe,
          nom_fichier: nom,
          type_mime: mime,
          taille,
          empreinte_sha256: empreinte,
          statut: 'ignore',
          raisons: ['Contenu identique à une pièce déjà reçue — non re-proposée.'],
        })
        continue
      }

      const chemin = `gmail/${id}/${i}_${nom.replace(/[^\w.\-]+/g, '_').slice(0, 120)}`
      const depot = await sb.storage.from('entrants').upload(chemin, octets.buffer as ArrayBuffer, {
        contentType: mime || 'application/octet-stream',
        upsert: true,
      })
      if (depot.error) continue // pièce suivante ; le message sera re-tenté au prochain scan

      await sb.from('entrants').insert({
        source: 'gmail',
        source_id: id,
        piece_index: i,
        expediteur,
        objet,
        recu_le: recuLe,
        nom_fichier: nom,
        type_mime: mime,
        taille,
        empreinte_sha256: empreinte,
        chemin_storage: chemin,
        projet_id_propose: proposition.projetId,
        categorie_proposee: proposition.categorie,
        confiance: proposition.confiance,
        raisons: proposition.raisons,
        statut: 'a_valider',
      })
      nouvelles++
    }
  }

  await noter(
    nouvelles > 0
      ? `${nouvelles} pièce(s) proposée(s) dans la boîte d'arrivée (${ids.length} message(s) examiné(s)).`
      : `Rien de nouveau (${ids.length} message(s) examiné(s)${ignorees ? `, ${ignorees} doublon(s) ignoré(s)` : ''}).`,
  )
  return json({ statut: 'ok', nouvelles, messages: ids.length, ignorees })
})
