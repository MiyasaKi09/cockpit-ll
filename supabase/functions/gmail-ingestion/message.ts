// ============================================================
// gmail-ingestion / message.ts — LA LECTURE d'un message Gmail.
//
// POURQUOI CE FICHIER EXISTE À PART
// ---------------------------------
// `index.ts` importe `jsr:@supabase/supabase-js` et appelle
// `Deno.serve()` au chargement : il n'est ni importable ni
// exécutable hors Deno, donc rien de ce qu'il contient n'est
// testable autrement qu'en relisant son texte. Or la normalisation
// d'un message — quelles adresses, quel fil, quelle date, quel sens
// — est précisément la partie qu'il faut EXERCER sur des exemples,
// parce qu'elle a des cas tordus (un nom d'affichage qui contient
// une virgule, un en-tête `Date` absent ou illisible, un corps
// encodé en base64url UTF-8, un `References` sur plusieurs lignes).
//
// Ce module n'importe rien, ne touche ni au réseau ni à la base, et
// n'utilise aucune API propre à Deno : `scripts/test-ingestion-gmail.cjs`
// le transpile et l'appelle pour de vrai.
//
// CE QU'IL CAPTE, ET POURQUOI MAINTENANT (§3.6, §4.1 du plan)
// ------------------------------------------------------------
// `threadId` et la DIRECTION du message ne se reconstituent pas
// après coup : le §3.7 en fait le signal de rattachement le plus
// fort, et le sélecteur `mailsEnAttenteDeReponse()` d'A.12 — « le
// dernier message du fil est entrant, aucun sortant ne lui succède »
// — n'a aucune définition sans eux. Un message ingéré sans son fil
// est un message qu'il faudra ré-ingérer.
//
// DÉVIATION ASSUMÉE SUR `format=metadata` (§3.6)
// ----------------------------------------------
// Le §3.6 recommande `format=metadata` avec des `metadataHeaders`
// ciblés : même coût de quota, réponse dix à cinquante fois plus
// légère. C'est juste pour A.2, qui indexera TOUS les messages. Ici
// l'ingestion n'ouvre que des messages qui portent une pièce jointe,
// et `format=metadata` ne renvoie ni `payload.parts` ni
// `body.attachmentId` : il ne permet donc ni de nommer la pièce ni
// de la télécharger. L'intention du §3.6 — capter les métadonnées
// dès maintenant — est tenue ; son moyen ne l'est pas, faute d'être
// applicable à ce périmètre. A.2 reprendra `format=metadata` pour
// les messages sans pièce.
// ============================================================

/** un en-tête RFC 5322 tel que l'API Gmail le rend */
export interface EnteteGmail {
  name: string
  value: string
}

/** une partie MIME telle que l'API Gmail la rend (arbre récursif) */
export interface PartieGmail {
  partId?: string
  filename?: string
  mimeType?: string
  headers?: EnteteGmail[]
  body?: { attachmentId?: string; size?: number; data?: string }
  parts?: PartieGmail[]
}

/** la ressource `users.messages.get?format=full`, réduite à ce qu'on lit */
export interface MessageGmail {
  id: string
  threadId?: string
  labelIds?: string[]
  internalDate?: string
  payload?: PartieGmail
}

/** entrant : reçu par l'agence. sortant : émis par elle. */
export type Direction = 'entrant' | 'sortant'

/** un participant : le nom d'affichage quand il existe, l'adresse toujours */
export interface AdresseNommee {
  nom: string
  adresse: string
}

/** un message Gmail normalisé — la forme que l'ingestion enregistre */
export interface MessageEnrichi {
  id: string
  /** fil de discussion : le signal de rattachement le plus fort (§3.7) */
  threadId: string
  /** libellés Gmail (`INBOX`, `SENT`, `IMPORTANT`, identifiants d'étiquettes) */
  libelles: string[]
  /** `Message-ID` RFC 5322 — l'identité du message hors de Gmail */
  messageIdRfc: string | null
  /** `In-Reply-To` — le message auquel celui-ci répond */
  enReponseA: string | null
  /** `References` — la chaîne complète du fil, du plus ancien au plus récent */
  references: string[]
  /** `From` brut, tel qu'il s'affiche (nom + adresse) */
  expediteur: string
  /** `From` réduit à son adresse, en minuscules */
  expediteurAdresse: string
  destinataires: AdresseNommee[]
  copies: AdresseNommee[]
  objet: string
  /** en-tête `Date` : quand l'expéditeur dit avoir écrit */
  envoyeLe: string
  /** `internalDate` : quand Gmail a reçu. Les deux diffèrent, parfois de jours. */
  recuLe: string
  /** `internalDate` en millisecondes — le curseur incrémental avance dessus */
  recuMs: number
  direction: Direction
  /** début du corps, en texte : le contexte que lit l'humain qui valide */
  corpsExtrait: string
  /** parties MIME portant un fichier joint */
  pieces: PartieGmail[]
}

/** au-delà, l'extrait de corps cesse d'être un extrait */
export const EXTRAIT_MAX = 2000

// ---------- en-têtes ----------

/** valeur d'un en-tête, insensible à la casse (Gmail varie : `Message-Id`
 *  et `Message-ID` cohabitent d'un expéditeur à l'autre) */
export function valeurEntete(payload: PartieGmail | undefined, nom: string): string {
  const cible = nom.toLowerCase()
  return payload?.headers?.find((h) => h.name.toLowerCase() === cible)?.value || ''
}

/**
 * Découpe une liste d'adresses en respectant guillemets et chevrons.
 *
 * Un simple `split(',')` casse sur `"Dupont, Jean" <j@x.fr>` : il produit
 * deux destinataires dont aucun n'a d'adresse. Ce cas n'est pas exotique —
 * c'est la forme par défaut d'un carnet d'adresses Outlook.
 */
export function separerAdresses(valeur: string): string[] {
  const morceaux: string[] = []
  let courant = ''
  let dansGuillemets = false
  let dansChevrons = false
  for (const c of valeur) {
    if (c === '"' && !dansChevrons) {
      dansGuillemets = !dansGuillemets
      courant += c
      continue
    }
    if (!dansGuillemets && c === '<') dansChevrons = true
    else if (!dansGuillemets && c === '>') dansChevrons = false
    if (c === ',' && !dansGuillemets && !dansChevrons) {
      if (courant.trim()) morceaux.push(courant.trim())
      courant = ''
      continue
    }
    courant += c
  }
  if (courant.trim()) morceaux.push(courant.trim())
  return morceaux
}

/** `"Zoé Hébert" <zoe@x.fr>` → `{nom: 'Zoé Hébert', adresse: 'zoe@x.fr'}` */
export function adresseNommee(morceau: string): AdresseNommee {
  const brut = morceau.trim()
  const chevrons = /<([^<>]+)>\s*$/.exec(brut)
  if (chevrons) {
    const nom = brut
      .slice(0, chevrons.index)
      .trim()
      .replace(/^"(.*)"$/s, '$1')
      .trim()
    return { nom, adresse: chevrons[1].trim().toLowerCase() }
  }
  return { nom: '', adresse: brut.toLowerCase() }
}

/** liste d'adresses d'un en-tête `To` / `Cc`, vides écartées */
export function listeAdresses(valeur: string): AdresseNommee[] {
  return separerAdresses(valeur)
    .map(adresseNommee)
    .filter((a) => a.adresse.includes('@'))
}

/** adresse seule d'un en-tête mono-destinataire (`From`, `Reply-To`) */
export function adresseSeule(valeur: string): string {
  const premiere = separerAdresses(valeur)[0]
  return premiere ? adresseNommee(premiere).adresse : ''
}

/** `References` : des identifiants `<…>` séparés par des espaces ou des
 *  retours à la ligne — l'API Gmail rend l'en-tête déplié, pas toujours propre */
export function listeReferences(valeur: string): string[] {
  return (valeur.match(/<[^<>\s]+>/g) || []).map((r) => r.trim())
}

/** premier identifiant d'un `Message-ID` / `In-Reply-To`, ou `null` */
export function identifiantMessage(valeur: string): string | null {
  const trouve = /<[^<>\s]+>/.exec(valeur)
  if (trouve) return trouve[0]
  const nu = valeur.trim()
  return nu ? nu : null
}

// ---------- corps ----------

/** base64url → octets (le transport de Gmail pour tout contenu binaire) */
export function depuisBase64UrlOctets(b64u: string): Uint8Array {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/')
  const brut = atob(b64)
  const octets = new Uint8Array(brut.length)
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i)
  return octets
}

/** base64url → texte UTF-8. `atob` seul rendrait « Ã© » pour « é ». */
export function depuisBase64UrlTexte(b64u: string): string {
  try {
    return new TextDecoder('utf-8').decode(depuisBase64UrlOctets(b64u))
  } catch {
    return ''
  }
}

/** première partie d'un type MIME donné, en profondeur */
export function partieDeType(p: PartieGmail | undefined, type: string): string {
  if (!p) return ''
  if (p.mimeType === type && p.body?.data && !p.filename) return depuisBase64UrlTexte(p.body.data)
  for (const enfant of p.parts || []) {
    const t = partieDeType(enfant, type)
    if (t) return t
  }
  return ''
}

/** HTML → texte lisible, sans dépendance : on ne rend pas la page, on
 *  en garde de quoi comprendre de quoi parle le message */
export function debaliser(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n)
      return c > 31 && c < 65536 ? String.fromCharCode(c) : ' '
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

/** l'extrait de corps : `text/plain` d'abord, `text/html` débalisé à défaut */
export function extraitDuCorps(payload: PartieGmail | undefined, max = EXTRAIT_MAX): string {
  const texte = partieDeType(payload, 'text/plain')
  const brut = texte || debaliser(partieDeType(payload, 'text/html'))
  return brut.replace(/\r\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim().slice(0, max)
}

/** parties portant un fichier joint (nom + identifiant de téléchargement) */
export function piecesDe(p: PartieGmail | undefined, acc: PartieGmail[] = []): PartieGmail[] {
  if (!p) return acc
  if (p.filename && p.body?.attachmentId) acc.push(p)
  for (const enfant of p.parts || []) piecesDe(enfant, acc)
  return acc
}

// ---------- dates ----------

/** en-tête `Date` (RFC 2822) → ISO, ou `null` s'il est absent ou illisible.
 *  Un expéditeur mal réglé envoie « Thu, 32 Jul 2026 » : on préfère le repli
 *  explicite sur la date de réception à une date fantaisiste. */
export function dateEnteteVersISO(valeur: string): string | null {
  if (!valeur.trim()) return null
  const t = Date.parse(valeur)
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString()
}

// ---------- direction ----------

/** un brouillon n'est pas un message : il n'a pas été envoyé, et son
 *  contenu changera encore. Les fils de discussion Chat non plus. */
export function estIndexable(libelles: string[]): boolean {
  return !libelles.includes('DRAFT') && !libelles.includes('CHAT')
}

/**
 * Sens du message. Deux signaux, dans cet ordre :
 *
 * 1. le libellé `SENT` de Gmail — l'autorité pour la boîte ingérée ;
 * 2. l'expéditeur appartient au registre des membres — c'est le cas du
 *    message que l'autre associée a envoyé au client en nous mettant en
 *    copie : il arrive dans notre boîte sans libellé `SENT`, et il est
 *    pourtant sortant. Sans ce second signal, `mailsEnAttenteDeReponse()`
 *    (A.12) tiendrait pour « sans réponse » un fil auquel l'agence a
 *    répondu.
 *
 * Aucune adresse n'est écrite ici : `adressesAgence` vient de
 * `public.membres` et de `ingestion_config.compte_email`.
 */
export function directionDe(
  libelles: string[],
  expediteurAdresse: string,
  adressesAgence: Set<string>,
): Direction {
  if (libelles.includes('SENT')) return 'sortant'
  if (expediteurAdresse && adressesAgence.has(expediteurAdresse)) return 'sortant'
  return 'entrant'
}

// ---------- normalisation complète ----------

/**
 * Un message Gmail brut → la forme que l'ingestion enregistre.
 *
 * `maintenantMs` n'est là que pour le repli : un message sans
 * `internalDate` n'existe pas en pratique, mais s'il existait, il ne doit
 * pas produire une date invalide qui casserait l'insertion.
 */
export function enrichir(
  m: MessageGmail,
  adressesAgence: Set<string>,
  maintenantMs: number = Date.now(),
): MessageEnrichi {
  const payload = m.payload
  const libelles = m.labelIds || []
  const recuMs = Number(m.internalDate || 0) || maintenantMs
  const recuLe = new Date(recuMs).toISOString()
  const expediteur = valeurEntete(payload, 'from')
  const expediteurAdresse = adresseSeule(expediteur)

  return {
    id: m.id,
    threadId: m.threadId || m.id,
    libelles,
    messageIdRfc: identifiantMessage(valeurEntete(payload, 'message-id')),
    enReponseA: identifiantMessage(valeurEntete(payload, 'in-reply-to')),
    references: listeReferences(valeurEntete(payload, 'references')),
    expediteur,
    expediteurAdresse,
    destinataires: listeAdresses(valeurEntete(payload, 'to')),
    copies: listeAdresses(valeurEntete(payload, 'cc')),
    objet: valeurEntete(payload, 'subject') || '(sans objet)',
    envoyeLe: dateEnteteVersISO(valeurEntete(payload, 'date')) || recuLe,
    recuLe,
    recuMs,
    direction: directionDe(libelles, expediteurAdresse, adressesAgence),
    corpsExtrait: extraitDuCorps(payload),
    pieces: piecesDe(payload),
  }
}
