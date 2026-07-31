// ============================================================
// gmail-ingestion — le scan serveur de la boîte Gmail (lecture
// seule), planifié toutes les 10 minutes par pg_cron.
//
// Pour chaque message porteur d'une pièce jointe : le message est
// NORMALISÉ (fil, destinataires, en-têtes RFC, libellés, date d'envoi
// distincte de la réception, sens entrant/sortant, extrait du corps —
// voir `message.ts`), puis chaque pièce reçue reçoit son empreinte
// SHA-256, son classement DÉTERMINISTE (même lexique que
// src/registre.ts — à garder synchronisés), son contenu dans le
// bucket privé « entrants » et une ligne d'index « à valider ».
// RIEN n'entre dans les données de l'agence sans validation humaine
// dans le Cockpit.
//
// LIVRABLE A.1 — CE QUI A CHANGÉ, ET POURQUOI
// -------------------------------------------
// 1. LA FENÊTRE FIXE EST REMPLACÉE PAR UN CURSEUR. La requête
//    `in:inbox has:attachment newer_than:7d` avec `maxResults=25`
//    perdait des messages en silence dès qu'il en arrivait plus de 25
//    en sept jours, et ne les redemandait jamais. Le curseur
//    `internalDate` est repris de `veille-mails` (lecture
//    incrémentale + pagination bornée + traitement du plus ancien au
//    plus récent), avec deux corrections que ce patron demandait :
//      · une FENÊTRE GLISSANTE bornée (`after:` ET `before:`), qui
//        garantit que la page listée est complète — sans quoi, le
//        listing Gmail étant du plus récent au plus ancien, borner à
//        N messages par passage traite les plus RÉCENTS et fait
//        avancer le curseur par-dessus les plus anciens, qui sont
//        alors perdus. C'est exactement le défaut que ce livrable
//        devait corriger : le reproduire aurait été le déplacer ;
//      · le curseur n'avance jamais jusqu'à `now` mais s'arrête une
//        minute avant, parce qu'un message reçu pendant le passage
//        peut porter un `internalDate` déjà dépassé.
// 2. LE CURSEUR PORTE SA PORTÉE. `curseur_gmail_portee` mémorise la
//    requête que le curseur a parcourue. Le jour où A.2 élargira
//    l'ingestion à TOUS les messages, un curseur hérité d'une requête
//    plus étroite ferait sauter tout l'historique sans pièce jointe,
//    sans erreur ni trace. Portée différente ⇒ le curseur repart de
//    la fenêtre initiale.
// 3. `in:inbox` DISPARAÎT. La recherche Gmail couvre par défaut tout
//    le courrier hors spam et corbeille, donc aussi les messages
//    ENVOYÉS et ceux déjà archivés. Sans les envoyés, la « direction »
//    du message serait une constante, et le sélecteur
//    `mailsEnAttenteDeReponse()` d'A.12 — dernier message du fil
//    entrant, sans sortant postérieur — n'aurait aucune définition.
//    Une pièce SORTANTE est indexée pour la mémoire du projet mais
//    n'est ni téléchargée ni proposée à la validation : la boîte
//    d'arrivée ne liste que `a_valider`, elle ne bouge pas d'un iota.
//
// Accès : en-tête x-cron-secret (planificateur) OU jeton d'une
// personne de l'agence (bouton « Scanner maintenant »).
//
// ORDRE DE DÉPLOIEMENT : la migration
// `20260731103000_ingestion_gmail_enrichie` s'applique AVANT ce code.
// Sans elle, les colonnes enrichies n'existent pas et chaque
// insertion échoue.
// ============================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2.110.0'
import { adressesMembresActifs, adresseNormalisee, jetonDeMembreActif } from '../_shared/membres.ts'
import {
  depuisBase64UrlOctets,
  enrichir,
  estIndexable,
  type MessageEnrichi,
  type MessageGmail,
  type PartieGmail,
} from './message.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TAILLE_MAX = 20 * 1024 * 1024 // 20 Mo par pièce
const TAILLE_MIN_IMAGE = 20 * 1024 // sous 20 Ko, une image est une signature

/** La requête que le curseur parcourt. Elle fait partie de l'IDENTITÉ du
 *  curseur (`curseur_gmail_portee`) : l'élargir sans le dire ferait sauter
 *  tout ce qui précède le curseur et n'entrait pas dans l'ancienne requête. */
const REQUETE_GMAIL = 'has:attachment'
/** Version de la portée : à incrémenter si le SENS de la requête change
 *  sans que son texte change (nouveau filtrage côté code, par exemple). */
const PORTEE_CURSEUR = `${REQUETE_GMAIL}|v1`

const JOUR_MS = 86_400_000
/** premier passage : on reprend la fenêtre de l'ancienne requête, ni plus ni moins */
const RETOUR_INITIAL_MS = 7 * JOUR_MS
/** largeur maximale d'une tranche traitée par passage */
const FENETRE_MS = JOUR_MS
/** on ne resserre jamais en dessous : sous cette largeur, le volume n'est plus l'explication */
const FENETRE_MIN_MS = 3 * 3_600_000
/** marge de sûreté : un message reçu pendant le passage porte une date déjà dépassée */
const MARGE_MS = 60_000
const PAGES_MAX = 4
const PAR_PAGE = 50
/** budget de temps d'une Edge Function : autant de messages ouverts qu'avant */
const MESSAGES_PAR_RUN = 25

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

async function gmail<T>(jeton: string, chemin: string): Promise<T> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${chemin}`, {
    headers: { Authorization: `Bearer ${jeton}` },
  })
  if (!r.ok) throw new Error(`Gmail a répondu ${r.status} sur ${chemin.split('?')[0]}.`)
  return (await r.json()) as T
}

/**
 * Liste les identifiants d'une tranche de temps, pagination bornée.
 *
 * `complet` dit si la tranche a été listée jusqu'au bout. C'est la garantie
 * qui rend l'ordre exploitable : Gmail rend le plus récent d'abord, donc
 * seule une tranche complète permet d'en déduire le plus ancien.
 */
async function listerTranche(
  jeton: string,
  apresSec: number,
  avantSec: number,
): Promise<{ ids: string[]; complet: boolean }> {
  const q = encodeURIComponent(`${REQUETE_GMAIL} after:${apresSec} before:${avantSec}`)
  const ids: string[] = []
  let pageToken = ''
  for (let page = 0; page < PAGES_MAX; page++) {
    const liste = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(
      jeton,
      `messages?q=${q}&maxResults=${PAR_PAGE}${pageToken ? `&pageToken=${pageToken}` : ''}`,
    )
    ids.push(...(liste.messages || []).map((m) => m.id))
    if (!liste.nextPageToken) return { ids, complet: true }
    pageToken = liste.nextPageToken
  }
  return { ids, complet: false }
}

async function sha256Hex(octets: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', octets.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------- la ligne d'index ----------

/** Le contexte du MESSAGE, identique pour toutes ses pièces. C'est lui qui
 *  porte le fil, le sens et les destinataires : le §7.3 demande qu'une pièce
 *  classée puisse toujours remonter à l'échange qui l'explique. */
function contexteMessage(msg: MessageEnrichi) {
  return {
    source: 'gmail',
    source_id: msg.id,
    expediteur: msg.expediteur,
    objet: msg.objet,
    recu_le: msg.recuLe,
    envoye_le: msg.envoyeLe,
    thread_id: msg.threadId,
    message_id_rfc: msg.messageIdRfc,
    en_reponse_a: msg.enReponseA,
    references_rfc: msg.references,
    destinataires: msg.destinataires,
    copies: msg.copies,
    libelles: msg.libelles,
    direction: msg.direction,
    corps_extrait: msg.corpsExtrait,
  }
}

/** Le descripteur de la PIÈCE, sans son contenu. */
function descripteurPiece(piece: PartieGmail, index: number) {
  return {
    piece_index: index,
    nom_fichier: piece.filename || `piece_${index}`,
    type_mime: piece.mimeType || '',
    taille: piece.body?.size ?? 0,
  }
}

/** une pièce trop lourde, ou une image trop légère pour être autre chose
 *  qu'une signature de courriel */
function pieceRetenue(piece: PartieGmail): boolean {
  const taille = piece.body?.size ?? 0
  const mime = piece.mimeType || ''
  if (taille > TAILLE_MAX) return false
  if (mime.startsWith('image/') && taille < TAILLE_MIN_IMAGE) return false
  return true
}

// ---------- point d'entrée ----------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erreur: 'Méthode non prise en charge.' }, 405)

  const sb = admin()
  const { data: cfg, error: erreurConfig } = await sb
    .from('ingestion_config')
    .select('*')
    .eq('id', 'google')
    .maybeSingle()
  if (erreurConfig) return json({ erreur: `Configuration illisible : ${erreurConfig.message}` }, 500)
  if (!cfg) return json({ erreur: 'Configuration absente.' }, 500)

  // --- accès : planificateur (secret) ou personne de l'agence (jeton) ---
  const secretRecu = req.headers.get('x-cron-secret')
  let autorise = Boolean(secretRecu && cfg.cron_secret && secretRecu === cfg.cron_secret)
  if (!autorise) {
    const jeton = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    autorise = await jetonDeMembreActif(sb, jeton)
  }
  if (!autorise) return json({ erreur: 'Accès refusé.' }, 401)

  /** Le résultat lisible du passage, et le curseur, s'écrivent ensemble :
   *  un curseur avancé sans trace de ce qu'il a couvert est indébogable. */
  const noter = (resultat: string, curseur?: number) =>
    sb
      .from('ingestion_config')
      .update({
        dernier_scan: new Date().toISOString(),
        dernier_resultat: resultat,
        maj_le: new Date().toISOString(),
        ...(curseur === undefined
          ? {}
          : { curseur_gmail: String(curseur), curseur_gmail_portee: PORTEE_CURSEUR }),
      })
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
  const { data: ws, error: erreurWorkspace } = await sb
    .from('workspace')
    .select('data')
    .eq('id', cfg.workspace_id || 'agence-ll')
    .maybeSingle()
  if (erreurWorkspace) return json({ erreur: `Workspace illisible : ${erreurWorkspace.message}` }, 500)
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

  // --- qui est « l'agence » ? le registre, jamais une adresse écrite ici ---
  const adressesAgence = await adressesMembresActifs(sb)
  const compte = adresseNormalisee(cfg.compte_email)
  if (compte) adressesAgence.add(compte)

  // --- la tranche de temps à traiter ---
  const maintenant = Date.now()
  const memePortee = cfg.curseur_gmail_portee === PORTEE_CURSEUR
  const curseurEnregistre = memePortee ? Number(cfg.curseur_gmail) : Number.NaN
  const repartDeZero = !Number.isFinite(curseurEnregistre) || curseurEnregistre <= 0
  const borneBasse = repartDeZero ? maintenant - RETOUR_INITIAL_MS : curseurEnregistre

  const plafond = maintenant - MARGE_MS
  if (borneBasse >= plafond) {
    await noter('Rien de nouveau (curseur à jour).')
    return json({ statut: 'ok', nouvelles: 0, messages: 0, ignorees: 0, sortants: 0 })
  }
  let borneHaute = Math.min(plafond, borneBasse + FENETRE_MS)

  // Tranche listée jusqu'au bout, ou resserrée jusqu'à ce qu'elle le soit :
  // c'est la seule façon de savoir quels sont les PLUS ANCIENS messages d'une
  // liste que Gmail rend du plus récent au plus ancien.
  let listing = await listerTranche(jetonGmail, Math.floor(borneBasse / 1000), Math.ceil(borneHaute / 1000))
  let resserrages = 0
  while (!listing.complet && borneHaute - borneBasse > FENETRE_MIN_MS && resserrages < 3) {
    borneHaute = borneBasse + Math.max(FENETRE_MIN_MS, Math.floor((borneHaute - borneBasse) / 2))
    listing = await listerTranche(jetonGmail, Math.floor(borneBasse / 1000), Math.ceil(borneHaute / 1000))
    resserrages++
  }

  // Gmail liste du plus récent au plus ancien : on remonte le temps pour
  // traiter les plus anciens d'abord et n'avancer le curseur qu'après eux.
  const idsAnciensDabord = [...listing.ids].reverse()
  const ids = idsAnciensDabord.slice(0, MESSAGES_PAR_RUN)
  const trancheEntiere = ids.length === idsAnciensDabord.length

  // messages déjà indexés (au moins une pièce) → on ne rouvre pas leurs pièces
  const dejaVus = new Set<string>()
  if (ids.length > 0) {
    const { data: existants } = await sb.from('entrants').select('source_id').eq('source', 'gmail').in('source_id', ids)
    for (const e of existants || []) dejaVus.add(e.source_id as string)
  }

  let nouvelles = 0
  let ignorees = 0
  let sortants = 0
  let echecs = 0
  let curseurAtteint = borneBasse

  for (const id of ids) {
    let msg: MessageEnrichi
    try {
      const brut = await gmail<MessageGmail>(jetonGmail, `messages/${id}?format=full`)
      msg = enrichir({ ...brut, id }, adressesAgence, maintenant)
    } catch {
      // un message illisible ne doit pas bloquer le curseur : il serait
      // redemandé toutes les dix minutes, indéfiniment, et rien d'autre
      // n'entrerait. On le compte, il apparaît dans le dernier résultat.
      echecs++
      continue
    }

    // le curseur avance sur TOUT message ouvert, y compris déjà indexé :
    // sinon un lot déjà traité le retiendrait à chaque passage
    curseurAtteint = Math.max(curseurAtteint, msg.recuMs)

    if (!estIndexable(msg.libelles)) continue
    if (dejaVus.has(id)) continue

    const pieces = msg.pieces.filter(pieceRetenue)

    // --- message SORTANT : indexé, jamais téléchargé, jamais à valider ---
    if (msg.direction === 'sortant') {
      for (let i = 0; i < pieces.length; i++) {
        const { error } = await sb.from('entrants').insert({
          ...contexteMessage(msg),
          ...descripteurPiece(pieces[i], i),
          statut: 'ignore',
          raisons: ['Pièce envoyée par l’agence — indexée pour la mémoire du fil, jamais proposée à la validation.'],
        })
        if (!error) sortants++
      }
      continue
    }

    // --- message ENTRANT : le circuit de validation, inchangé ---
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]
      const nom = piece.filename!
      const mime = piece.mimeType || ''

      const contenu = await gmail<{ data?: string }>(jetonGmail, `messages/${id}/attachments/${piece.body!.attachmentId}`)
      if (!contenu.data) continue
      const octets = depuisBase64UrlOctets(contenu.data)
      const empreinte = await sha256Hex(octets)

      // contenu déjà connu de la boîte d'arrivée → trace « ignorée », pas de stockage
      const { data: doublon } = await sb
        .from('entrants')
        .select('id')
        .eq('empreinte_sha256', empreinte)
        .limit(1)
        .maybeSingle()
      const proposition = classer(reperes, nom, msg.objet, msg.expediteur)
      if (doublon) {
        ignorees++
        await sb.from('entrants').insert({
          ...contexteMessage(msg),
          ...descripteurPiece(piece, i),
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
        ...contexteMessage(msg),
        ...descripteurPiece(piece, i),
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

  // La tranche entièrement traitée fait avancer le curseur jusqu'à sa borne
  // haute, y compris quand elle était vide : sans cela, une période sans
  // courrier retiendrait le curseur pour toujours.
  const curseurSuivant = trancheEntiere && listing.complet ? Math.max(curseurAtteint, borneHaute) : curseurAtteint

  const reste = idsAnciensDabord.length - ids.length
  const details = [
    `${ids.length} message(s) examiné(s) jusqu'au ${new Date(curseurSuivant).toISOString().slice(0, 16).replace('T', ' ')}`,
    ignorees ? `${ignorees} doublon(s) ignoré(s)` : '',
    sortants ? `${sortants} pièce(s) sortante(s) indexée(s)` : '',
    reste > 0 ? `${reste} en attente du prochain passage` : '',
    echecs ? `${echecs} message(s) illisible(s)` : '',
    listing.complet ? '' : 'ATTENTION : tranche non listée en entier, des messages peuvent être sautés',
  ].filter(Boolean)

  await noter(
    nouvelles > 0
      ? `${nouvelles} pièce(s) proposée(s) dans la boîte d'arrivée (${details.join(', ')}).`
      : `Rien de nouveau (${details.join(', ')}).`,
    curseurSuivant,
  )
  return json({
    statut: 'ok',
    nouvelles,
    messages: ids.length,
    ignorees,
    sortants,
    echecs,
    reste,
    curseur: new Date(curseurSuivant).toISOString(),
    trancheComplete: listing.complet,
  })
})
