// ============================================================
// GoCardless Bank Account Data — la partie SANS `Deno.serve`.
//
// POURQUOI CE FICHIER EXISTE, ET PAS UN BLOC DANS index.ts
// ---------------------------------------------------------
// Le dépôt a déjà tranché deux fois dans ce sens (`_shared/rattachement.ts`,
// `_shared/classement-echanges.ts`) : un fichier qui appelle `Deno.serve`
// n'est exécutable par aucun test. Ce qu'il y a de délicat ici — la LECTURE
// DES ERREURS — se met donc dans un module qu'on peut interroger.
//
// LE PIÈGE QUE CE FICHIER FERME
// ------------------------------
// Deux erreurs différentes portent le MÊME code HTTP 401 :
//   · `{"summary": "Invalid token"}`            → le jeton d'API a 24 h, il
//     est périmé : on le rafraîchit et on rejoue. Rien à demander à personne.
//   · `{"type": "AccessExpiredError", …}`       → le CONSENTEMENT DSP2 a
//     expiré (90 jours) : aucun rafraîchissement ne le réparera, il faut que
//     la personne se ré-authentifie chez sa banque.
// Un relais qui traite tout 401 comme « rafraîchir le jeton » boucle
// indéfiniment sur le second cas, et la trésorerie se fige EN SILENCE. Le
// champ `type` est le seul discriminant exploitable ; `detail` est du texte
// libre et ne doit pas être analysé.
//
// CE QUI EST VÉRIFIÉ, CE QUI NE L'EST PAS
// ----------------------------------------
// Les chemins et les formats viennent de la spec OpenAPI officielle
// (https://bankaccountdata.gocardless.com/api/v2/swagger.json), sondée sans
// identifiants : l'existence des chemins est confirmée, les corps de réponse
// en situation réelle ne le sont pas. Tout ce qui est incertain est traité
// comme incertain — champ optionnel, repli explicite, jamais de valeur
// inventée.
// ============================================================

/** Base confirmée par le champ `servers` de la spec OpenAPI. */
export const BASE_GOCARDLESS = 'https://bankaccountdata.gocardless.com'

/**
 * ATTENTION — le Quickstart officiel publie `/v2/token/refresh/` (sans
 * `/api/`). Cette URL rend un 404 : le seul chemin déclaré par la spec est
 * `/api/v2/token/refresh/`. Le préfixe est donc écrit UNE fois, ici.
 */
const PREFIXE = '/api/v2'

export const CHEMINS = {
  jetonNouveau: `${PREFIXE}/token/new/`,
  jetonRafraichi: `${PREFIXE}/token/refresh/`,
  institutions: `${PREFIXE}/institutions/`,
  accords: `${PREFIXE}/agreements/enduser/`,
  demandes: `${PREFIXE}/requisitions/`,
  accord: (id: string) => `${PREFIXE}/agreements/enduser/${encodeURIComponent(id)}/`,
  demande: (id: string) => `${PREFIXE}/requisitions/${encodeURIComponent(id)}/`,
  compte: (id: string) => `${PREFIXE}/accounts/${encodeURIComponent(id)}/`,
  soldes: (id: string) => `${PREFIXE}/accounts/${encodeURIComponent(id)}/balances/`,
  operations: (id: string) => `${PREFIXE}/accounts/${encodeURIComponent(id)}/transactions/`,
} as const

/** Durées annoncées par la spec, en secondes — repli si la réponse les tait. */
export const DUREE_ACCES_DEFAUT = 86_400 // 24 h
export const DUREE_RAFRAICHISSEMENT_DEFAUT = 2_592_000 // 30 jours

/** Bornes du schéma `EndUserAgreementRequest`. */
export const HISTORIQUE_MAX_JOURS = 730
/**
 * La spec accepte 730 jours d'accès continu, mais l'overview officiel
 * n'annonce que « up to 90 days of continuous access » et la DSP2 impose la
 * ré-authentification. On ne demande donc jamais plus de 90 jours : demander
 * deux ans et se croire tranquille est exactement la façon de découvrir
 * l'expiration le jour où elle arrive.
 */
export const ACCES_MAX_JOURS = 90
export const ACCES_DEFAUT_JOURS = 90

/** Le statut nominal d'une demande : la banque a rendu les comptes. */
export const STATUT_DEMANDE_LIEE = 'LN'
/** Demande expirée — l'un des trois signaux de reconnexion. */
export const STATUT_DEMANDE_EXPIREE = 'EX'
/** Compte prêt à être lu. */
export const STATUT_COMPTE_PRET = 'READY'

export function borner(valeur: unknown, min: number, max: number, defaut: number): number {
  const n = typeof valeur === 'number' ? valeur : Number(valeur)
  if (!Number.isFinite(n)) return defaut
  return Math.min(max, Math.max(min, Math.round(n)))
}

// ------------------------------------------------------------------
// Lecture des erreurs — LE cœur du sujet
// ------------------------------------------------------------------

/**
 * Ce qu'une réponse GoCardless demande de FAIRE. Le genre, pas le code :
 * c'est le genre qui décide entre « rejouer », « prévenir quelqu'un » et
 * « attendre », et deux codes identiques n'ont pas le même genre.
 */
export type GenreReponse =
  /** tout va bien */
  | 'ok'
  /** 401 « Invalid token » — jeton d'API périmé (24 h) : rafraîchir, RIEN à demander à l'utilisateur */
  | 'jeton_invalide'
  /** consentement expiré / révoqué / compte inactif ou suspendu : la personne doit se reconnecter */
  | 'reconnexion'
  /** portée insuffisante : recréer un accord avec le bon `access_scope` */
  | 'portee'
  /** traitement en cours côté GoCardless (compte `PROCESSING`) : réessayer plus tard */
  | 'patienter'
  /** 429 — quota de la banque atteint (jusqu'à 4 appels/jour/endpoint/compte) */
  | 'quota'
  /** 503 / erreur réseau côté banque */
  | 'indisponible'
  /** tout le reste — on ne devine pas */
  | 'autre'

export interface LectureReponse {
  genre: GenreReponse
  /** message en français, affichable tel quel */
  message: string
  /** le `type` renvoyé par GoCardless, conservé pour le diagnostic */
  type: string | null
  status: number
}

/** Les `type` qui veulent dire « la personne doit refaire le parcours banque ». */
const TYPES_RECONNEXION = new Set([
  'AccessExpiredError',
  'AccountInactiveError',
  'AccountValidEUAError',
  'AccountSuspendedError',
])

function champTexte(corps: unknown, nom: string): string | null {
  if (!corps || typeof corps !== 'object') return null
  const valeur = (corps as Record<string, unknown>)[nom]
  return typeof valeur === 'string' ? valeur : null
}

/**
 * Traduit une réponse HTTP en décision. Pure : aucun appel réseau, aucune
 * horloge — elle se teste avec les exemples de la spec.
 */
export function lireReponseGoCardless(status: number, corps: unknown): LectureReponse {
  const type = champTexte(corps, 'type')
  const resume = champTexte(corps, 'summary') || ''

  if (status >= 200 && status < 300) {
    return { genre: 'ok', message: '', type, status }
  }

  // 401 ≠ 401 : le `type` sépare le jeton périmé du consentement expiré.
  if (type && TYPES_RECONNEXION.has(type)) {
    return {
      genre: 'reconnexion',
      message:
        'L’autorisation donnée à votre banque n’est plus valable (elle expire tous les 90 jours). ' +
        'Reconnectez le compte : rien d’autre ne la rétablit.',
      type,
      status,
    }
  }
  if (type === 'AccountEUAScopeError') {
    return {
      genre: 'portee',
      message: 'L’autorisation ne couvre pas les soldes ou les opérations : reconnectez le compte.',
      type,
      status,
    }
  }
  if (type === 'IPAccessDenied') {
    return {
      genre: 'autre',
      message:
        'GoCardless refuse l’adresse IP de la fonction. Déclarez-la dans le portail Bank Account Data ' +
        '(ou retirez le filtrage d’IP).',
      type,
      status,
    }
  }
  if (status === 401) {
    // Pas de `type` reconnu : c'est le jeton d'API, pas le consentement.
    // « Invalid token » est le libellé observé ; on ne l'exige pas, parce
    // qu'un libellé qui change ne doit pas transformer un rafraîchissement
    // en demande de reconnexion.
    return {
      genre: 'jeton_invalide',
      message: resume || 'Jeton d’API expiré.',
      type,
      status,
    }
  }
  if (status === 409) {
    return {
      genre: 'patienter',
      message: resume || 'GoCardless prépare encore ce compte : réessayez dans quelques minutes.',
      type,
      status,
    }
  }
  if (status === 429) {
    return {
      genre: 'quota',
      message:
        'Quota atteint : les banques limitent les appels (jusqu’à 4 par jour et par compte). ' +
        'Réessayez plus tard — une ou deux synchronisations par jour suffisent.',
      type,
      status,
    }
  }
  if (status === 503 || status === 502 || status === 504) {
    return { genre: 'indisponible', message: resume || 'La banque est momentanément indisponible.', type, status }
  }
  return { genre: 'autre', message: resume || `Réponse inattendue (HTTP ${status}).`, type, status }
}

/**
 * Le statut d'une demande ou d'un compte peut, à lui seul, annoncer la
 * reconnexion — c'est le deuxième et le troisième des trois signaux
 * corroborants (l'erreur 401 étant le premier). On les surveille tous les
 * trois : celui qui manque est celui qui ne préviendra pas.
 */
export function statutDemandeExigeReconnexion(statut: string | null | undefined): boolean {
  return statut === STATUT_DEMANDE_EXPIREE || statut === 'RJ' || statut === 'SU' || statut === 'ER'
}

export function statutCompteExigeReconnexion(statut: string | null | undefined): boolean {
  return statut === 'EXPIRED' || statut === 'SUSPENDED'
}

// ------------------------------------------------------------------
// Soldes et opérations — normalisation MINIMALE, côté serveur
// ------------------------------------------------------------------

/** Un solde publié par la banque, réduit à ce dont le Cockpit a besoin. */
export interface SoldeBerlin {
  montant: number
  type: string
  /** date de référence — souvent absente : seuls `balanceAmount` et
   *  `balanceType` sont garantis par le schéma */
  date: string | null
}

/**
 * Les soldes exploitables, dans l'ordre où la banque les a publiés. Le CHOIX
 * (quel type fait foi) ne se fait pas ici : il appartient au Cockpit, qui
 * l'explique à l'écran. Ce qui se fait ici est mécanique — lire ce qui est
 * lisible, et ne rien inventer de ce qui ne l'est pas.
 */
export function soldesLisibles(corps: unknown): SoldeBerlin[] {
  const brut = (corps as { balances?: unknown })?.balances
  if (!Array.isArray(brut)) return []
  const sortie: SoldeBerlin[] = []
  for (const ligne of brut) {
    if (!ligne || typeof ligne !== 'object') continue
    const l = ligne as Record<string, unknown>
    const montantBrut = (l.balanceAmount as Record<string, unknown> | undefined)?.amount
    const montant = Number(montantBrut)
    const type = typeof l.balanceType === 'string' ? l.balanceType : ''
    if (!type || !Number.isFinite(montant)) continue
    const date =
      (typeof l.referenceDate === 'string' && l.referenceDate.slice(0, 10)) ||
      (typeof l.lastChangeDateTime === 'string' && l.lastChangeDateTime.slice(0, 10)) ||
      null
    sortie.push({ montant: Math.round(montant * 100) / 100, type, date: date || null })
  }
  return sortie
}

/**
 * Les opérations COMPTABILISÉES, telles quelles.
 *
 * `pending` est volontairement ignoré : une opération en attente n'a pas de
 * date de comptabilisation définitive et reparaîtra plus tard sous une autre
 * forme — elle produirait deux lignes pour un seul mouvement, et le
 * rapprochement du dépôt (date + montant + libellé) ne peut pas les
 * reconnaître comme une seule.
 */
export function operationsComptabilisees(corps: unknown): Record<string, unknown>[] {
  const tx = (corps as { transactions?: { booked?: unknown } })?.transactions
  const booked = tx?.booked
  if (!Array.isArray(booked)) return []
  return booked.filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === 'object')
}

/** Quatre derniers caractères d'un IBAN — de quoi reconnaître le compte. */
export function masquerIban(iban: unknown): string | null {
  if (typeof iban !== 'string') return null
  const propre = iban.replace(/\s+/g, '')
  if (propre.length < 4) return null
  return `…${propre.slice(-4)}`
}

// ------------------------------------------------------------------
// Consentement
// ------------------------------------------------------------------

/**
 * Fin du consentement = acceptation + `access_valid_for_days`.
 *
 * `maintenant` est un paramètre : la date d'expiration ne doit pas dépendre
 * de l'horloge au moment où on la relit. Sans acceptation connue, on rend
 * `null` — et `null` veut dire « inconnue », jamais « lointaine ».
 */
export function expirationConsentement(
  accepteLe: string | null | undefined,
  jours: number | null | undefined,
): string | null {
  if (!accepteLe || !jours || jours <= 0) return null
  const depart = Date.parse(accepteLe)
  if (!Number.isFinite(depart)) return null
  return new Date(depart + jours * 86_400_000).toISOString()
}

// ------------------------------------------------------------------
// Appel HTTP borné
// ------------------------------------------------------------------

const DELAI_MS = 20_000
const TAILLE_MAX = 4 * 1024 * 1024

export interface ReponseGoCardless {
  status: number
  corps: unknown
  /** entêtes de quota, quand la banque les renvoie */
  quotaRestant: string | null
}

/**
 * Appel JSON borné en temps ET en taille, sur le modèle de
 * `requeteJsonGoogle` (gmail-oauth) : une réponse qui ne s'arrête jamais est
 * une fonction Edge qui ne rend jamais la main.
 */
export async function appelGoCardless(
  chemin: string,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<ReponseGoCardless> {
  const controleur = new AbortController()
  const chrono = setTimeout(() => controleur.abort(), DELAI_MS)
  try {
    const reponse = await fetcher(`${BASE_GOCARDLESS}${chemin}`, {
      ...init,
      redirect: 'error',
      signal: controleur.signal,
    })
    const lecteur = reponse.body?.getReader()
    const morceaux: Uint8Array[] = []
    let taille = 0
    if (lecteur) {
      try {
        while (true) {
          const { done, value } = await lecteur.read()
          if (done) break
          if (!value?.byteLength) continue
          taille += value.byteLength
          if (taille > TAILLE_MAX) {
            await lecteur.cancel()
            throw new Error('Réponse GoCardless trop volumineuse.')
          }
          morceaux.push(value)
        }
      } finally {
        lecteur.releaseLock()
      }
    }
    const octets = new Uint8Array(taille)
    let position = 0
    for (const morceau of morceaux) {
      octets.set(morceau, position)
      position += morceau.byteLength
    }
    const texte = new TextDecoder().decode(octets)
    let corps: unknown = null
    if (texte) {
      try {
        corps = JSON.parse(texte)
      } catch {
        // Un corps illisible n'est pas une raison de perdre le code HTTP :
        // c'est lui qui porte le sens (401, 429…).
        corps = { summary: texte.slice(0, 300) }
      }
    }
    return {
      status: reponse.status,
      corps,
      quotaRestant:
        reponse.headers.get('http_x_ratelimit_account_success_remaining') ||
        reponse.headers.get('x-ratelimit-account-success-remaining') ||
        reponse.headers.get('http_x_ratelimit_remaining') ||
        reponse.headers.get('x-ratelimit-remaining'),
    }
  } finally {
    // Le délai couvre l'appel ET la lecture du corps.
    clearTimeout(chrono)
  }
}
