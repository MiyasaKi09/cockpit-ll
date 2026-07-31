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
// LIVRABLE A.2 — CE QUI A CHANGÉ, ET POURQUOI
// -------------------------------------------
// 4. LA REQUÊTE S'ÉLARGIT À TOUT LE COURRIER. `has:attachment` faisait
//    de `entrants` l'unique mémoire des échanges, donc un message sans
//    pièce jointe n'existait NULLE PART — c'est le critère 2 du §22
//    qui tombait. Chaque message indexable alimente désormais
//    `public.communications` : un message, une ligne. `entrants` ne
//    bouge pas d'un iota : elle reste l'index des PIÈCES à valider.
//    `PORTEE_CURSEUR` passe donc en v2, et c'est exactement ce pour
//    quoi elle a été écrite en A.1 : un curseur hérité de la requête
//    étroite ferait sauter tout l'historique sans pièce jointe.
// 5. DEUX FORMATS GMAIL, SELON LE MESSAGE (§3.6). `format=metadata`
//    coûte le même quota que `format=full` pour une réponse dix à
//    cinquante fois plus légère, mais il ne rend ni `payload.parts` ni
//    `attachmentId` : inapplicable à un message porteur d'une pièce.
//    On liste donc la tranche DEUX fois — une fois en entier, une fois
//    filtrée sur `has:attachment` — et la seconde liste ne sert qu'à
//    savoir quel format demander. L'ORDRE, lui, vient toujours de la
//    liste complète : c'est de lui que dépend la monotonie du curseur,
//    et fusionner deux listes triées par date sans connaître les dates
//    la détruirait. Si la liste filtrée est tronquée, on retombe sur
//    `full` pour tout le monde : mieux vaut une réponse lourde qu'une
//    pièce jointe jamais vue.
// 6. LE RATTACHEMENT N'A QU'UN MOTEUR. `classer()` est scindé en
//    `rattacher()` (projet + domaine de l'expéditeur) et le classement
//    documentaire qui l'appelle : le message et la pièce reçoivent la
//    même réponse à la même question. Ses résultats à l'identique —
//    c'est une extraction, pas une seconde implémentation. Les trois
//    axes du §5.2, eux, restent VIDES ici : leur classifieur est le
//    livrable A.8, et un axe faux coûte plus cher qu'un axe à choisir.
//
// LIVRABLE A.4 — CE QUI A CHANGÉ, ET POURQUOI
// -------------------------------------------
// 7. LE MOTEUR DE RATTACHEMENT SORT D'ICI. A.2 l'avait extrait en
//    notant qu'il attendait sa fusion avec ceux du navigateur : c'est
//    faite. La cascade du §3.7 vit dans `../_shared/rattachement.ts`,
//    importée telle quelle par `src/rattachement.ts` — donc par
//    `src/surveillance.ts`, `src/importRoutines.ts` et
//    `src/registre.ts`, les trois moteurs divergents que le §3.7
//    décrivait. Un seul fichier à corriger le jour où la règle change.
// 8. LE FIL DEVIENT LE SIGNAL LE PLUS FORT, ce que A.1 avait rendu
//    possible en captant `threadId` mais que personne ne lisait. Avant
//    d'indexer un message, on demande à `communications` si son fil est
//    déjà rattaché — colonne GÉNÉRÉE `projet_id`, donc le choix humain
//    dès qu'il y en a eu un. C'est la phrase du §3.7 rendue vraie :
//    « un seul rattachement humain propage tout le fil ».
// 9. LES CORRECTIONS HUMAINES SONT APPLIQUÉES. Les règles adresse →
//    projet mémorisées par le Cockpit vivent dans
//    `settings.reglesRattachement`, donc dans `workspace.data`, que
//    cette fonction lit déjà. Elles ne renseignent que
//    `projet_id_propose` : une règle propose, elle ne signe pas — la
//    colonne humaine et `rattache_par` restent hors de toute écriture
//    machine, et le GRANT au niveau colonne d'A.2 le garantit.
//
// Accès : en-tête x-cron-secret (planificateur) OU jeton d'une
// personne de l'agence (bouton « Scanner maintenant »).
//
// ORDRE DE DÉPLOIEMENT : les migrations
// `20260731103000_ingestion_gmail_enrichie` et
// `20260731150000_communications_index_des_messages` s'appliquent
// AVANT ce code. Sans elles, les colonnes enrichies et la table des
// messages n'existent pas, et chaque insertion échoue.
// ============================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2.110.0'
import { adressesMembresActifs, adresseNormalisee, jetonDeMembreActif } from '../_shared/membres.ts'
import {
  fold,
  normaliserAdresse,
  rattacher as rattacherEnCascade,
  rattacherMessage,
  type Rattachement,
  type ReperesRattachement,
} from '../_shared/rattachement.ts'
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
 *  tout ce qui précède le curseur et n'entrait pas dans l'ancienne requête.
 *
 *  A.2 l'élargit de `has:attachment` à TOUT le courrier : un message sans
 *  pièce jointe n'existait nulle part, et c'est le critère 2 du §22. La
 *  recherche Gmail couvre par défaut tout sauf spam et corbeille ; seuls les
 *  fils Chat sont écartés ici, les brouillons l'étant par `estIndexable()`. */
const REQUETE_GMAIL = '-in:chats'
/** Le filtre qui distingue les messages à ouvrir en `format=full` (une pièce
 *  jointe s'y trouve, il faut la nommer et la télécharger) de ceux qui se
 *  contentent de `format=metadata`. */
const REQUETE_PIECES = 'has:attachment'
/** Version de la portée : à incrémenter si le SENS de la requête change
 *  sans que son texte change (nouveau filtrage côté code, par exemple). */
const PORTEE_CURSEUR = `${REQUETE_GMAIL}|v2`
/** Les en-têtes demandés en `format=metadata` — ceux du §3.6, plus `Date` et
 *  `Subject` sans lesquels un message n'a ni date d'envoi ni objet. */
const ENTETES_METADATA = ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', 'References']

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

// `fold` n'est plus redéfini ici : il vient de `../_shared/rattachement.ts`,
// avec la cascade qui s'en sert. C'était la quatrième copie de la même
// normalisation dans le dépôt.

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

/**
 * A.4 — LE MOTEUR DE RATTACHEMENT N'EST PLUS ÉCRIT ICI.
 *
 * A.1 en avait extrait une version locale en notant qu'elle attendait sa
 * fusion : c'est ce livrable. La cascade du §3.7 vit désormais dans
 * `../_shared/rattachement.ts`, importée telle quelle par le navigateur
 * (`src/rattachement.ts`) — un seul fichier à corriger le jour où la règle
 * change, au lieu des trois moteurs divergents que le §3.7 décrivait.
 *
 * Ce qui reste ici est ce qui n'appartient qu'au serveur : le LEXIQUE
 * documentaire (catégorie d'une pièce) et la traduction de `workspace.data`
 * en repères.
 */

/** l'état partagé, réduit à ce que la cascade a le droit de connaître.
 *  Le §3.7 fait de l'adresse d'un participant déclaré le deuxième signal :
 *  ce sont `Projet.emailMOA`, `Contact.email` et `MarcheTravaux.contactEmail`
 *  — les mêmes trois gisements que côté navigateur, sinon les deux moteurs
 *  divergeraient de nouveau, cette fois par leurs ENTRÉES. */
interface EtatPartage {
  projets?: {
    id: string
    nom: string
    codeExterne?: string
    adresseProjet?: string
    emailMOA?: string
  }[]
  contacts?: { nom?: string; email?: string; projetsIds?: string[] }[]
  marches?: { projetId: string; lot?: string; entreprise?: string; entrepriseId?: string | null; contactEmail?: string }[]
  entreprises?: { id: string; raisonSociale: string; domaines?: string[] }[]
  settings?: {
    equipe?: { email?: string }[]
    surveillance?: { email?: string }
    reglesRattachement?: ReperesRattachement['regles']
  }
}

function reperesDepuisEtat(etat: EtatPartage): ReperesRattachement {
  const internes = new Set<string>()
  for (const p of etat.settings?.equipe || []) {
    const email = normaliserAdresse(p.email)
    if (email) internes.add(email)
  }
  const surveillee = normaliserAdresse(etat.settings?.surveillance?.email)
  if (surveillee) internes.add(surveillee)

  const parAdresse = new Map<string, { projetIds: Set<string>; origine: string }>()
  const ajouter = (brut: string | undefined, projetId: string | undefined, origine: string) => {
    const email = normaliserAdresse(brut)
    if (!email || internes.has(email) || !projetId) return
    const courant = parAdresse.get(email)
    if (courant) courant.projetIds.add(projetId)
    else parAdresse.set(email, { projetIds: new Set([projetId]), origine })
  }
  for (const p of etat.projets || []) ajouter(p.emailMOA, p.id, 'La maîtrise d’ouvrage')
  for (const c of etat.contacts || [])
    for (const projetId of c.projetsIds || []) ajouter(c.email, projetId, `Le contact ${c.nom || ''}`.trim())
  for (const m of etat.marches || []) ajouter(m.contactEmail, m.projetId, `Le contact du marché « ${m.lot || ''} »`)

  return {
    projets: (etat.projets || []).map((p) => ({
      id: p.id,
      nom: p.nom,
      codeExterne: p.codeExterne,
      adresseProjet: p.adresseProjet,
    })),
    participants: [...parAdresse.entries()].map(([email, v]) => ({
      email,
      projetIds: [...v.projetIds],
      origine: v.origine,
    })),
    entreprises: (etat.entreprises || []).map((e) => ({
      id: e.id,
      raisonSociale: e.raisonSociale,
      domaines: e.domaines || [],
      projetIds: [
        ...new Set(
          (etat.marches || [])
            .filter((m) => m.entrepriseId === e.id || fold(m.entreprise || '') === fold(e.raisonSociale))
            .map((m) => m.projetId),
        ),
      ],
    })),
    regles: etat.settings?.reglesRattachement || [],
  }
}

/** classement documentaire d'une PIÈCE : le lexique — qui n'appartient qu'ici
 *  — puis la cascade partagée pour le projet. Le nom de fichier entre dans le
 *  texte fouillé : c'est lui qui porte la nomenclature `AAAAMMJJ_P01_…`. */
function classer(reperes: ReperesRattachement, nomFichier: string, objet: string, expediteur: string, projetDuFil: string | null) {
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

  const projet = rattacherEnCascade(reperes, { nomFichier, objet, expediteur, projetDuFil })

  return {
    categorie,
    projetId: projet.projetId,
    confiance: Math.min(confiance + projet.confiance, 0.95),
    raisons: [...raisons, ...projet.raisons],
  }
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
  requete: string,
  apresSec: number,
  avantSec: number,
): Promise<{ ids: string[]; complet: boolean }> {
  const q = encodeURIComponent(`${requete} after:${apresSec} before:${avantSec}`)
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

/** La ligne de `public.communications` : le message lui-même, une fois, qu'il
 *  porte une pièce jointe ou non.
 *
 *  Ce qu'elle n'écrit PAS est aussi important que ce qu'elle écrit. Les
 *  colonnes humaines (`projet_id_valide`, `phase`, `type_echange`,
 *  `importance`, `traite_le`…) sont absentes : l'`upsert` ne les touche donc
 *  jamais, et un re-scan ne peut pas effacer une correction. Les trois axes
 *  PROPOSÉS restent vides — leur classifieur est le livrable A.8 ; les
 *  remplir à l'aveugle ici donnerait un classement faux, c'est-à-dire un
 *  classement qui ne se voit pas. */
function ligneCommunication(msg: MessageEnrichi, projet: Rattachement, nbPieces: number) {
  return {
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId,
    message_id_rfc: msg.messageIdRfc,
    en_reponse_a: msg.enReponseA,
    references_rfc: msg.references,
    expediteur: msg.expediteur,
    expediteur_adresse: msg.expediteurAdresse,
    destinataires: msg.destinataires,
    copies: msg.copies,
    objet: msg.objet,
    corps_extrait: msg.corpsExtrait,
    libelles: msg.libelles,
    direction: msg.direction,
    nb_pieces_jointes: nbPieces,
    envoye_le: msg.envoyeLe,
    recu_le: msg.recuLe,
    projet_id_propose: projet.projetId,
    confiance_rattachement: projet.projetId ? projet.confiance : null,
    raisons_rattachement: projet.raisons,
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
  const reperes = reperesDepuisEtat((ws?.data ?? {}) as EtatPartage)

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
    return json({ statut: 'ok', nouvelles: 0, messages: 0, messagesIndexes: 0, ignorees: 0, sortants: 0 })
  }
  let borneHaute = Math.min(plafond, borneBasse + FENETRE_MS)

  // Tranche listée jusqu'au bout, ou resserrée jusqu'à ce qu'elle le soit :
  // c'est la seule façon de savoir quels sont les PLUS ANCIENS messages d'une
  // liste que Gmail rend du plus récent au plus ancien.
  let listing = await listerTranche(jetonGmail, REQUETE_GMAIL, Math.floor(borneBasse / 1000), Math.ceil(borneHaute / 1000))
  let resserrages = 0
  while (!listing.complet && borneHaute - borneBasse > FENETRE_MIN_MS && resserrages < 3) {
    borneHaute = borneBasse + Math.max(FENETRE_MIN_MS, Math.floor((borneHaute - borneBasse) / 2))
    listing = await listerTranche(jetonGmail, REQUETE_GMAIL, Math.floor(borneBasse / 1000), Math.ceil(borneHaute / 1000))
    resserrages++
  }

  // Seconde liste, sur la MÊME tranche : elle ne sert qu'à savoir quel format
  // demander message par message. L'ordre, lui, reste celui de la liste
  // complète ci-dessus — fusionner deux listes triées par date sans connaître
  // les dates détruirait la monotonie du curseur. Tronquée, elle ne sert plus
  // à rien : on repasse tout le monde en `full` plutôt que de risquer une
  // pièce jointe jamais vue.
  const listingPieces = await listerTranche(
    jetonGmail,
    `${REQUETE_GMAIL} ${REQUETE_PIECES}`,
    Math.floor(borneBasse / 1000),
    Math.ceil(borneHaute / 1000),
  )
  const avecPiece = new Set(listingPieces.ids)

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

  // --- A.4 : le fil déjà rattaché, signal le plus fort du §3.7 ---
  //
  // `projet_id` est la colonne GÉNÉRÉE : le choix humain dès qu'il y en a eu
  // un, la proposition sinon. C'est ce qui donne son sens à la phrase du
  // §3.7 — « un seul rattachement humain propage tout le fil ».
  //
  // Une requête par FIL, pas par message, et le résultat est mémorisé pour
  // le passage entier — y compris la réponse « ce fil n'est rattaché à
  // rien », sans quoi un long fil non rattaché coûterait une requête par
  // message à chaque scan. La carte se complète pendant la boucle : le
  // premier message d'un fil neuf rattache les suivants du même passage,
  // sans repasser par la base. Le threadId n'est connu qu'après l'ouverture
  // du message : le pré-charger pour toute la tranche est impossible.
  const projetDuFilParThread = new Map<string, string | null>()
  const projetDuFil = async (threadId: string): Promise<string | null> => {
    if (!threadId) return null
    const connu = projetDuFilParThread.get(threadId)
    if (connu !== undefined) return connu
    const { data } = await sb
      .from('communications')
      .select('projet_id')
      .eq('gmail_thread_id', threadId)
      .not('projet_id', 'is', null)
      .limit(1)
      .maybeSingle()
    const trouve = (data?.projet_id as string | undefined) ?? null
    projetDuFilParThread.set(threadId, trouve)
    return trouve
  }

  let nouvelles = 0
  let ignorees = 0
  let sortants = 0
  let echecs = 0
  let messagesIndexes = 0
  let curseurAtteint = borneBasse

  for (const id of ids) {
    let msg: MessageEnrichi
    try {
      // `format=metadata` coûte le même quota pour une réponse dix à cinquante
      // fois plus légère (§3.6) — mais il ne rend ni les parties MIME ni les
      // identifiants de téléchargement : réservé aux messages sans pièce.
      const complet = !listingPieces.complet || avecPiece.has(id)
      const chemin = complet
        ? `messages/${id}?format=full`
        : `messages/${id}?format=metadata&${ENTETES_METADATA.map((h) => `metadataHeaders=${h}`).join('&')}`
      const brut = await gmail<MessageGmail>(jetonGmail, chemin)
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

    const pieces = msg.pieces.filter(pieceRetenue)

    // --- L'INDEX DES MESSAGES (§4.3, critère 2) ---
    // Avant tout traitement de pièce, et pour TOUS les messages — entrants
    // comme sortants, avec pièce ou sans. C'est ce qui fait exister dans
    // Cockpit un message qui n'apporte aucun fichier, c'est-à-dire la grande
    // majorité du courrier d'un projet.
    //
    // `upsert` sur `gmail_message_id` : rejouer une tranche ou redescendre le
    // curseur ne crée pas de doublon. Et parce que la ligne n'emporte AUCUNE
    // colonne humaine, un re-scan ne peut pas effacer un rattachement corrigé,
    // un axe choisi ni un message marqué traité.
    const filRattacheA = await projetDuFil(msg.threadId)
    const projet = rattacherMessage(reperes, {
      objet: msg.objet,
      expediteur: msg.expediteurAdresse || msg.expediteur,
      // le §5.1 pt 1 : l'adresse du projet peut n'apparaître qu'en
      // destinataire ou en copie, jamais chez l'expéditeur
      destinataires: [...msg.destinataires, ...msg.copies].map((d) => d.adresse),
      projetDuFil: filRattacheA,
    })
    const { error: erreurIndex } = await sb
      .from('communications')
      .upsert(ligneCommunication(msg, projet, pieces.length), { onConflict: 'gmail_message_id' })
    if (!erreurIndex) messagesIndexes++
    // ce que ce message vient d'apprendre au fil sert aux suivants du même
    // passage — un fil neuf se rattache d'un coup, pas message par message
    if (!filRattacheA && projet.projetId) projetDuFilParThread.set(msg.threadId, projet.projetId)

    // Les pièces, elles, ne se rouvrent pas : le message est déjà passé par la
    // boîte d'arrivée. Cette borne vient APRÈS l'index des messages — sinon un
    // message dont les pièces sont déjà validées n'entrerait jamais dans la
    // mémoire du projet.
    if (dejaVus.has(id)) continue

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
      const proposition = classer(
        reperes,
        nom,
        msg.objet,
        msg.expediteurAdresse || msg.expediteur,
        projetDuFilParThread.get(msg.threadId) ?? null,
      )
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
    `${messagesIndexes} indexé(s) dans la mémoire des échanges`,
    ignorees ? `${ignorees} doublon(s) ignoré(s)` : '',
    sortants ? `${sortants} pièce(s) sortante(s) indexée(s)` : '',
    reste > 0 ? `${reste} en attente du prochain passage` : '',
    echecs ? `${echecs} message(s) illisible(s)` : '',
    listing.complet ? '' : 'ATTENTION : tranche non listée en entier, des messages peuvent être sautés',
  ].filter(Boolean)

  await noter(
    nouvelles > 0
      ? `${nouvelles} pièce(s) proposée(s) dans la boîte d'arrivée (${details.join(', ')}).`
      : messagesIndexes > 0
        ? `Aucune pièce à valider, mais la mémoire des échanges a avancé (${details.join(', ')}).`
        : `Rien de nouveau (${details.join(', ')}).`,
    curseurSuivant,
  )
  return json({
    statut: 'ok',
    nouvelles,
    messages: ids.length,
    messagesIndexes,
    ignorees,
    sortants,
    echecs,
    reste,
    curseur: new Date(curseurSuivant).toISOString(),
    trancheComplete: listing.complet,
  })
})
