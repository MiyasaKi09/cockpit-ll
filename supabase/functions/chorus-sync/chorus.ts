// ============================================================
// Chorus Pro via PISTE — la partie SANS `Deno.serve`.
//
// POURQUOI CE FICHIER EXISTE, ET PAS UN BLOC DANS index.ts
// ---------------------------------------------------------
// Le dépôt a déjà tranché trois fois dans ce sens (`_shared/rattachement.ts`,
// `_shared/classement-echanges.ts`, `banque-sync/gocardless.ts`) : un fichier
// qui appelle `Deno.serve` n'est exécutable par aucun test. Ce qu'il y a de
// délicat ici — LA LECTURE DES RÉPONSES et LA LISTE FERMÉE DES CHEMINS — se
// met donc dans un module qu'on peut interroger.
//
// LES DEUX PIÈGES DU BRANCHEMENT, FERMÉS ICI
// -------------------------------------------
// 1. LES DOMAINES `aife.economie.gouv.fr` N'EXISTENT PLUS (NXDOMAIN). Ils
//    figurent encore dans la version ANGLAISE de la doc Chorus Pro. Un agent
//    qui les suit perd des heures sur des erreurs DNS incompréhensibles.
//    Seul `piste.gouv.fr` est actif, et il est écrit UNE fois, ci-dessous.
// 2. L'AUTHENTIFICATION EST DOUBLE. `Authorization: Bearer <jeton PISTE>`
//    identifie L'APPLICATION ; `cpro-account: base64("login:motdepasse")`
//    identifie LA STRUCTURE Chorus Pro dont on lit les factures. Mettre le
//    second dans `Authorization` (le réflexe « Basic Auth ») écrase le
//    premier : c'est le contresens classique de ce raccordement.
//
// LA MACHINE NE CORRIGE RIEN — ET CE N'EST PAS UNE INTENTION
// -----------------------------------------------------------
// `CHEMINS_LECTURE` est une liste FERMÉE, et `appelChorus` refuse tout chemin
// qui n'y figure pas. `soumettreFacture`, `deposerFluxFacture` et
// `traiterFactureRecue` existent sur la même passerelle, aux chemins voisins
// d'une lettre près ; les nommer dans `CHEMINS_INTERDITS` documente qu'ils ont
// été vus et écartés, et le refus est mécanique, pas moral. Une facture
// rejetée se corrige et se redépose À LA MAIN sur le portail (§15).
//
// CE QUI EST VÉRIFIÉ, CE QUI NE L'EST PAS
// ----------------------------------------
// Les CHEMINS ont été sondés en direct sur la passerelle réelle (une API
// enregistrée répond `www-authenticate: Bearer realm="PISTE"`, un chemin
// inconnu répond `realm="DefaultRealm"`). Les NOMS DE CHAMPS d'entrée et de
// sortie, eux, viennent du Dossier de Spécifications Externes V3.2 — daté de
// 2017 — et n'ont PAS pu être confrontés au Swagger PISTE, qui exige un
// compte. Tout ce qui est incertain est donc lu de façon TOLÉRANTE (plusieurs
// noms candidats), et ce qui n'a pas pu être lu est NOMMÉ dans la réponse
// (`diagnostic`) plutôt que rendu par un silence : une liste vide et une
// liste illisible se ressemblent trop.
// ============================================================

/** Les deux environnements PISTE. Domaines vérifiés par résolution DNS et par
 *  appels réels ; les `*.rie.gouv.fr` (Réseau Interministériel de l'État) sont
 *  volontairement absents — ils sont injoignables depuis une agence privée. */
export const ENVIRONNEMENTS = {
  qualification: {
    oauth: 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token',
    api: 'https://sandbox-api.piste.gouv.fr',
    libelle: 'qualification (jeu de données de l’AIFE — PAS les factures de l’agence)',
  },
  production: {
    oauth: 'https://oauth.piste.gouv.fr/api/oauth/token',
    api: 'https://api.piste.gouv.fr',
    libelle: 'production (factures réelles de la structure)',
  },
} as const

export type NomEnvironnement = keyof typeof ENVIRONNEMENTS

/**
 * Le défaut est la QUALIFICATION, et c'est délibéré.
 *
 * Une bascule ratée vers la production lit de vraies factures — sans danger.
 * Une bascule ratée dans l'autre sens ferait entrer le « matelas de données »
 * de l'AIFE dans un Cockpit réel : des numéros inconnus, donc une liste de
 * factures « signalées » qui n'existent pas. Le défaut le moins coûteux est
 * donc celui qui ne ressemble à rien de familier, et l'écran nomme
 * l'environnement en toutes lettres.
 */
export const ENVIRONNEMENT_DEFAUT: NomEnvironnement = 'qualification'

export function lireEnvironnement(valeur: string | null | undefined): NomEnvironnement {
  const propre = (valeur || '').trim().toLowerCase()
  if (propre === 'production' || propre === 'prod') return 'production'
  if (propre === 'qualification' || propre === 'sandbox' || propre === 'qualif') return 'qualification'
  return ENVIRONNEMENT_DEFAUT
}

// ------------------------------------------------------------------
// Chemins — liste FERMÉE, lecture seule
// ------------------------------------------------------------------

/** Les seuls chemins que cette fonction a le droit d'appeler. Tous en POST,
 *  corps JSON (services de type RPC). Vérifiés sur la passerelle en 2026. */
export const CHEMINS_LECTURE = {
  /** liste les factures ÉMISES par la structure, avec leur statut courant */
  rechercherFournisseur: '/cpro/factures/v1/rechercher/fournisseur',
  /** l'historique daté des statuts d'UNE facture — le service qui remplace le CSV */
  historique: '/cpro/factures/v1/consulter/historique',
  /** le détail d'UNE facture émise — second endroit possible du motif de rejet */
  consulterFournisseur: '/cpro/factures/v1/consulter/fournisseur',
  /** les structures rattachées au compte technique (diagnostic de raccordement) */
  rechercherStructure: '/cpro/structures/v1/rechercher',
} as const

/**
 * Vus, et écartés. Ils existent sur la même passerelle et ne diffèrent des
 * chemins de lecture que par un mot. Les écrire ici sert à deux choses : dire
 * qu'on ne s'est pas contenté de ne pas les appeler, et donner au garde-fou
 * ci-dessous une raison d'exister le jour où quelqu'un les copiera.
 */
export const CHEMINS_INTERDITS = [
  '/cpro/factures/v1/soumettre',
  '/cpro/factures/v1/deposer/flux',
  '/cpro/factures/v1/traiter/recue',
  '/cpro/factures/v1/telecharger/groupe',
] as const

const CHEMINS_AUTORISES = new Set<string>(Object.values(CHEMINS_LECTURE))

/** Un chemin est appelable s'il figure dans la liste fermée. Le reste — y
 *  compris un chemin d'écriture arrivé par copier-coller — est refusé avant
 *  le moindre octet sur le réseau. */
export function estCheminDeLecture(chemin: string): boolean {
  return CHEMINS_AUTORISES.has(chemin)
}

// ------------------------------------------------------------------
// Authentification — DEUX éléments superposés
// ------------------------------------------------------------------

/**
 * `cpro-account` = base64("logintechnique:password").
 *
 * Même construction qu'un Basic Auth, mais dans un en-tête PROPRIÉTAIRE :
 * `Authorization` est déjà pris par le jeton PISTE. Les deux sont
 * indispensables — le jeton identifie l'application, celui-ci la structure.
 *
 * `btoa` ne sait pas encoder au-delà de Latin-1 : on passe par UTF-8, sinon
 * un mot de passe accentué lèverait une exception au moment le plus inutile.
 */
export function enteteCompteTechnique(login: string, motDePasse: string): string {
  const octets = new TextEncoder().encode(`${login}:${motDePasse}`)
  let binaire = ''
  for (const octet of octets) binaire += String.fromCharCode(octet)
  return btoa(binaire)
}

// ------------------------------------------------------------------
// Lecture des réponses — ce qu'elles demandent de FAIRE
// ------------------------------------------------------------------

export type GenreReponseChorus =
  /** tout va bien */
  | 'ok'
  /** identifiants d'application refusés (client_id / client_secret) */
  | 'identifiants'
  /** compte technique refusé (login / mot de passe de la structure) */
  | 'compte_technique'
  /** l'application n'est pas habilitée sur cette API, ou la structure ne l'est pas */
  | 'habilitation'
  /** le chemin n'existe pas sur cet environnement : domaine ou version */
  | 'chemin'
  /** quota atteint */
  | 'quota'
  /** passerelle ou Chorus momentanément indisponible */
  | 'indisponible'
  /** réponse HTTP 200 mais code de retour métier non nul */
  | 'metier'
  /** tout le reste — on ne devine pas */
  | 'autre'

export interface LectureReponseChorus {
  genre: GenreReponseChorus
  /** message en français, affichable tel quel */
  message: string
  /** `codeRetour` de Chorus quand il y en a un — conservé pour le diagnostic */
  codeRetour: number | null
  status: number
}

function champ(corps: unknown, nom: string): unknown {
  if (!corps || typeof corps !== 'object') return undefined
  return (corps as Record<string, unknown>)[nom]
}

function texteDe(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.trim() ? valeur.trim() : null
}

/**
 * Traduit une réponse en décision. Pure : aucun réseau, aucune horloge.
 *
 * Le point délicat : Chorus répond **HTTP 200 avec un `codeRetour` non nul**
 * pour les erreurs métier. Un relais qui ne regarderait que le code HTTP
 * prendrait « structure non habilitée » pour un succès, rendrait zéro facture,
 * et l'écran afficherait « aucune facture sur la période » — un silence qui
 * ressemble à du calme.
 */
export function lireReponseChorus(status: number, corps: unknown): LectureReponseChorus {
  const codeBrut = champ(corps, 'codeRetour')
  const codeRetour = typeof codeBrut === 'number' ? codeBrut : null
  const libelle = texteDe(champ(corps, 'libelle')) || texteDe(champ(corps, 'message'))
  const erreurOauth = texteDe(champ(corps, 'error'))
  const descriptionOauth = texteDe(champ(corps, 'error_description'))

  if (status >= 200 && status < 300) {
    if (codeRetour !== null && codeRetour !== 0) {
      return {
        genre: 'metier',
        message: libelle || `Chorus Pro a refusé la demande (code ${codeRetour}).`,
        codeRetour,
        status,
      }
    }
    return { genre: 'ok', message: '', codeRetour, status }
  }

  if (status === 400 && erreurOauth === 'invalid_client') {
    return {
      genre: 'identifiants',
      message:
        'PISTE refuse les identifiants de l’application (client_id / client_secret). ' +
        'Vérifiez les secrets CHORUS_CLIENT_ID et CHORUS_CLIENT_SECRET, et que l’application vise bien ' +
        'le même environnement que CHORUS_ENVIRONNEMENT.',
      codeRetour,
      status,
    }
  }
  if (status === 400 || status === 422) {
    return {
      genre: 'autre',
      message: libelle || descriptionOauth || 'Chorus Pro n’a pas accepté la requête (paramètres refusés).',
      codeRetour,
      status,
    }
  }
  if (status === 401) {
    return {
      genre: 'compte_technique',
      message:
        'Chorus Pro refuse le compte technique (en-tête cpro-account). Vérifiez ' +
        'CHORUS_TECHNIQUE_LOGIN / CHORUS_TECHNIQUE_MOTDEPASSE — un compte technique n’est actif ' +
        'que 30 minutes après sa création.',
      codeRetour,
      status,
    }
  }
  if (status === 403) {
    return {
      genre: 'habilitation',
      message:
        'Accès refusé : l’application PISTE n’est pas rattachée à cette API, ou la structure n’est pas ' +
        'habilitée. Le raccordement se déclare dans l’espace « Raccordement EDI / API » de Chorus Pro.',
      codeRetour,
      status,
    }
  }
  if (status === 404) {
    return {
      genre: 'chemin',
      message:
        'Chemin inconnu de la passerelle : l’API n’est pas ouverte sur cet environnement, ou le service a ' +
        'changé de version. Rien n’a été lu.',
      codeRetour,
      status,
    }
  }
  if (status === 429) {
    return { genre: 'quota', message: 'Quota PISTE atteint : réessayez plus tard.', codeRetour, status }
  }
  if (status >= 500) {
    return {
      genre: 'indisponible',
      message: libelle || 'Chorus Pro est momentanément indisponible.',
      codeRetour,
      status,
    }
  }
  return { genre: 'autre', message: libelle || `Réponse inattendue (HTTP ${status}).`, codeRetour, status }
}

// ------------------------------------------------------------------
// Dates — Chorus écrit JJ/MM/AAAA, le Cockpit AAAA-MM-JJ
// ------------------------------------------------------------------

/** `AAAA-MM-JJ` → `JJ/MM/AAAA`, la forme que le dossier de spécifications
 *  emploie pour les critères de recherche. Écrite UNE fois : si le Swagger
 *  dit l'inverse, c'est ici que ça se corrige, pas dans cinq corps de requête. */
export function jourChorus(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

/**
 * Toute date rendue par Chorus, ramenée à `AAAA-MM-JJ`, ou `null`.
 *
 * Tolérante aux deux écritures ET à l'horodatage : le dossier de
 * spécifications date de 2017, et les services ne sont pas homogènes. `null`
 * veut dire « pas de date lisible », jamais « aujourd'hui » — une date
 * inventée se rangerait dans l'historique comme si elle avait été observée.
 */
export function dateChorus(valeur: unknown): string | null {
  const texte = texteDe(valeur)
  if (!texte) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(texte)) return texte.slice(0, 10)
  const jjmmaaaa = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(texte)
  if (jjmmaaaa) {
    return `${jjmmaaaa[3]}-${jjmmaaaa[2].padStart(2, '0')}-${jjmmaaaa[1].padStart(2, '0')}`
  }
  return null
}

// ------------------------------------------------------------------
// Normalisation d'une facture — noms de champs TOLÉRANTS
// ------------------------------------------------------------------

/** Une facture du portail, réduite à ce dont le Cockpit a besoin. Aucun champ
 *  n'est inventé : ce qui n'a pas été lu vaut `null`, et l'écran le dit. */
export interface FactureChorusBrute {
  /** le numéro tel que la structure l'a déposé — c'est LUI qui rattache */
  numero: string
  /** identifiant interne Chorus, pour retrouver la pièce sur le portail */
  idFacture: string | null
  /** le code de statut, TEL QUEL — jamais traduit ici (§ la traduction est
   *  une règle métier, elle vit dans src/chorusApi.ts) */
  statutPortail: string
  dateStatut: string | null
  destinataire: string | null
  montantTTC: number | null
  /** motif de rejet, quand le portail le rend — `null` n'est pas « aucun » */
  motif: string | null
  /** historique daté des statuts, quand `consulterHistoriqueFacture` a répondu */
  historique: { code: string; date: string | null }[]
}

function premierTexte(objet: Record<string, unknown>, noms: string[]): string | null {
  for (const nom of noms) {
    const valeur = texteDe(objet[nom])
    if (valeur) return valeur
  }
  return null
}

function premiereDate(objet: Record<string, unknown>, noms: string[]): string | null {
  for (const nom of noms) {
    const valeur = dateChorus(objet[nom])
    if (valeur) return valeur
  }
  return null
}

function premierNombre(objet: Record<string, unknown>, noms: string[]): number | null {
  for (const nom of noms) {
    const brut = objet[nom]
    const n = typeof brut === 'number' ? brut : typeof brut === 'string' ? Number(brut.replace(',', '.')) : NaN
    if (Number.isFinite(n)) return n
  }
  return null
}

const NOMS_NUMERO = ['numeroFacture', 'numeroFactureOrigine', 'numero', 'numeroDocument', 'numeroFluxDepot']
const NOMS_ID = ['idFacture', 'identifiantFactureCPP', 'idFactureCpp', 'id']
const NOMS_STATUT = ['statutCourantCode', 'codeStatutFacture', 'statutFacture', 'statut', 'codeStatut']
const NOMS_DATE = ['dateHeureEtatCourant', 'dateDernierStatut', 'dateDerniereMaj', 'dateDepot', 'dateFacture']
const NOMS_DESTINATAIRE = [
  'designationDestinataire',
  'nomDestinataire',
  'raisonSocialeDestinataire',
  'libelleDestinataire',
  'destinataire',
]
const NOMS_MONTANT = ['montantATtc', 'montantTtcApresRemise', 'montantTTC', 'montantTtc', 'montantAPayer']
const NOMS_MOTIF = ['motifRefus', 'libelleMotifRefus', 'motifRejet', 'libelleMotif', 'motif', 'commentaire']

/** le motif de rejet, cherché sous tous ses noms connus, à la racine comme
 *  dans un sous-objet : la note technique n'a PAS pu confirmer lequel des
 *  services le restitue ni sous quel nom exact (réserve §3.9) */
export function motifChorus(corps: unknown): string | null {
  if (!corps || typeof corps !== 'object') return null
  const objet = corps as Record<string, unknown>
  const direct = premierTexte(objet, NOMS_MOTIF)
  if (direct) return direct
  for (const valeur of Object.values(objet)) {
    if (Array.isArray(valeur)) {
      for (const element of valeur) {
        const trouve = motifChorus(element)
        if (trouve) return trouve
      }
    } else if (valeur && typeof valeur === 'object') {
      const trouve = motifChorus(valeur)
      if (trouve) return trouve
    }
  }
  return null
}

/** l'historique daté des statuts, quand il est là */
export function historiqueChorus(corps: unknown): { code: string; date: string | null }[] {
  const brut = champ(corps, 'historiquesDesStatuts') ?? champ(corps, 'historiqueDesStatuts')
  if (!Array.isArray(brut)) return []
  const sortie: { code: string; date: string | null }[] = []
  for (const ligne of brut) {
    if (!ligne || typeof ligne !== 'object') continue
    const objet = ligne as Record<string, unknown>
    const code = premierTexte(objet, ['statut', 'codeStatut', 'statutCode', 'libelleStatut'])
    if (!code) continue
    sortie.push({ code, date: dateChorus(objet.dateStatut ?? objet.dateHeureEtat ?? objet.date) })
  }
  return sortie
}

/**
 * Le tableau de factures d'une réponse de recherche.
 *
 * Les noms de conteneurs viennent d'un document de 2017 : on essaie les
 * candidats connus, PUIS on retombe sur le premier tableau d'objets trouvé à
 * la racine. Ce repli n'est pas de la devinette — c'est la différence entre
 * « aucune facture » et « je n'ai pas su lire la réponse », et l'appelant
 * reçoit les clés réellement vues pour trancher.
 */
export function listeFacturesChorus(corps: unknown): {
  liste: Record<string, unknown>[]
  clesVues: string[]
} {
  if (!corps || typeof corps !== 'object') return { liste: [], clesVues: [] }
  const objet = corps as Record<string, unknown>
  const clesVues = Object.keys(objet)
  const candidats = [
    'listeFactures',
    'factures',
    'listeFacturesFournisseur',
    'listeFactureFournisseur',
    'listeResultat',
    'resultats',
  ]
  for (const nom of candidats) {
    const valeur = objet[nom]
    if (Array.isArray(valeur)) {
      return { liste: valeur.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object'), clesVues }
    }
  }
  for (const valeur of Object.values(objet)) {
    if (Array.isArray(valeur) && valeur.some((x) => x && typeof x === 'object')) {
      return { liste: valeur.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object'), clesVues }
    }
  }
  return { liste: [], clesVues }
}

/** Une ligne de facture normalisée, ou `null` quand elle ne porte ni numéro
 *  ni statut : sans l'un des deux elle ne rattache rien et ne dit rien. */
export function normaliserFactureChorus(brut: Record<string, unknown>): FactureChorusBrute | null {
  const numero = premierTexte(brut, NOMS_NUMERO)
  const statutPortail = premierTexte(brut, NOMS_STATUT)
  if (!numero || !statutPortail) return null
  return {
    numero,
    idFacture: premierTexte(brut, NOMS_ID),
    statutPortail: statutPortail.toUpperCase().replace(/[\s-]+/g, '_'),
    dateStatut: premiereDate(brut, NOMS_DATE),
    destinataire: premierTexte(brut, NOMS_DESTINATAIRE),
    montantTTC: premierNombre(brut, NOMS_MONTANT),
    motif: motifChorus(brut),
    historique: [],
  }
}

/**
 * Les codes de statut NOMINAUX — ceux qui n'appellent aucun geste.
 *
 * Cette liste ne dit pas ce qu'un statut SIGNIFIE : elle sert uniquement à
 * décider s'il vaut la peine de dépenser un appel de détail pour aller
 * chercher un motif. L'autorité sur le sens vit dans `src/chorusApi.ts`, et
 * un code inconnu d'ici est détaillé plutôt qu'ignoré : mieux vaut un appel
 * de trop qu'un rejet sans motif.
 */
const CODES_SANS_DETAIL = new Set([
  'DEPOSEE',
  'MISE_A_DISPOSITION',
  'MISE_A_DISPOSITION_COMPTABLE',
  'MISE_A_DISPOSITION_MOE',
  'SERVICE_FAIT',
  'VALIDEE',
  'MANDATEE',
  'MISE_EN_PAIEMENT',
  'COMPTABILISEE',
])

export function meriteUnDetail(statutPortail: string): boolean {
  return !CODES_SANS_DETAIL.has(statutPortail)
}

// ------------------------------------------------------------------
// Corps de requête — écrits UNE fois, à confronter au Swagger PISTE
// ------------------------------------------------------------------

/**
 * ⚠ RÉSERVE ASSUMÉE. Les noms de champs ci-dessous viennent du Dossier de
 * Spécifications Externes V3.2 (2017). Les CHEMINS sont vérifiés en 2026, les
 * CHAMPS ne le sont pas : le Swagger PISTE exige un compte, que l'agence n'a
 * pas encore. Ils sont donc rassemblés ici, dans deux fonctions, pour qu'une
 * correction au premier appel réel tienne en une relecture — et non dans une
 * chasse à travers le fichier.
 *
 * `idUtilisateurCourant` et `idEspace` sont OPTIONNELS : leur obtention
 * concrète pour un compte technique n'est documentée nulle part. Absents, ils
 * ne sont pas envoyés (plutôt qu'envoyés à 0, qui serait une valeur inventée)
 * et le message d'erreur de Chorus dira s'ils manquent.
 */
export function corpsRechercheFournisseur(options: {
  debut: string
  fin: string
  page: number
  parPage: number
  idUtilisateur: number | null
  idEspace: number | null
}): Record<string, unknown> {
  const corps: Record<string, unknown> = {
    restreindreStructures: false,
    facture: {
      dateDepotDu: jourChorus(options.debut),
      dateDepotAu: jourChorus(options.fin),
    },
    parametres: {
      pageResultatDemandee: options.page,
      nbResultatsParPage: options.parPage,
      triColonne: 'DateDepot',
      triSens: 'Descendant',
    },
  }
  if (options.idUtilisateur !== null) corps.idUtilisateurCourant = options.idUtilisateur
  if (options.idEspace !== null) corps.idEspace = options.idEspace
  return corps
}

export function corpsHistorique(options: {
  idFacture: string
  idUtilisateur: number | null
  idEspace: number | null
}): Record<string, unknown> {
  const corps: Record<string, unknown> = { idFacture: options.idFacture }
  if (options.idUtilisateur !== null) corps.idUtilisateurCourant = options.idUtilisateur
  if (options.idEspace !== null) corps.idEspace = options.idEspace
  return corps
}

// ------------------------------------------------------------------
// Appel HTTP borné
// ------------------------------------------------------------------

const DELAI_MS = 20_000
const TAILLE_MAX = 4 * 1024 * 1024

export interface ReponseChorus {
  status: number
  corps: unknown
}

async function lireCorpsBorne(reponse: Response): Promise<unknown> {
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
          throw new Error('Réponse Chorus Pro trop volumineuse.')
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
  if (!texte) return null
  try {
    return JSON.parse(texte)
  } catch {
    // Un corps illisible n'est pas une raison de perdre le code HTTP : c'est
    // lui qui porte le sens (401, 403, 404…).
    return { libelle: texte.slice(0, 300) }
  }
}

/**
 * Appel JSON borné en temps ET en taille, sur le modèle de `appelGoCardless`.
 *
 * Le garde-fou d'écriture est ICI, avant le réseau : un chemin hors de la
 * liste fermée ne part pas. Une fonction qui « ne fait que lire » parce que
 * personne n'a écrit l'appel d'écriture n'est pas une garantie ; celle-ci en
 * est une.
 */
export async function appelChorus(
  base: string,
  chemin: string,
  corps: unknown,
  entetes: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<ReponseChorus> {
  if (!estCheminDeLecture(chemin)) {
    throw new Error(`Chemin Chorus non autorisé : ${chemin}. Cette fonction est en LECTURE SEULE.`)
  }
  const controleur = new AbortController()
  const chrono = setTimeout(() => controleur.abort(), DELAI_MS)
  try {
    const reponse = await fetcher(`${base}${chemin}`, {
      method: 'POST',
      headers: { ...entetes, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corps),
      redirect: 'error',
      signal: controleur.signal,
    })
    return { status: reponse.status, corps: await lireCorpsBorne(reponse) }
  } finally {
    // Le délai couvre l'appel ET la lecture du corps.
    clearTimeout(chrono)
  }
}

/**
 * Jeton PISTE — `client_credentials`, scope `openid`, corps form-encodé.
 *
 * Pas de cache, et c'est un choix : la durée de validité n'est PAS confirmée
 * par la documentation officielle (une source communautaire dit une heure),
 * une synchronisation a lieu une ou deux fois par jour, et un jeton mis en
 * cache est un secret de plus au repos. Un jeton par passage coûte un appel
 * et ne peut pas être servi périmé. `expires_in` est renvoyé à l'appelant
 * pour que la valeur RÉELLE finisse par être connue, au lieu d'être supposée.
 */
export async function demanderJetonPiste(
  environnement: NomEnvironnement,
  clientId: string,
  clientSecret: string,
  fetcher: typeof fetch = fetch,
): Promise<{ jeton: string | null; dureeSecondes: number | null; lecture: LectureReponseChorus }> {
  const controleur = new AbortController()
  const chrono = setTimeout(() => controleur.abort(), DELAI_MS)
  try {
    const reponse = await fetcher(ENVIRONNEMENTS[environnement].oauth, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'openid',
      }).toString(),
      redirect: 'error',
      signal: controleur.signal,
    })
    const corps = await lireCorpsBorne(reponse)
    const lecture = lireReponseChorus(reponse.status, corps)
    if (lecture.genre !== 'ok') return { jeton: null, dureeSecondes: null, lecture }
    const jeton = texteDe(champ(corps, 'access_token'))
    const duree = champ(corps, 'expires_in')
    if (!jeton) {
      return {
        jeton: null,
        dureeSecondes: null,
        lecture: { genre: 'autre', message: 'PISTE n’a pas fourni de jeton d’accès.', codeRetour: null, status: reponse.status },
      }
    }
    return { jeton, dureeSecondes: typeof duree === 'number' ? duree : null, lecture }
  } finally {
    clearTimeout(chrono)
  }
}

export function borner(valeur: unknown, min: number, max: number, defaut: number): number {
  const n = typeof valeur === 'number' ? valeur : Number(valeur)
  if (!Number.isFinite(n)) return defaut
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** un entier de secret (idUtilisateurCourant, idEspace), ou `null` s'il est
 *  absent : `null` ne s'envoie pas, contrairement à 0 qui serait une valeur */
export function entierOuNull(valeur: string | null | undefined): number | null {
  const propre = (valeur || '').trim()
  if (!propre) return null
  const n = Number(propre)
  return Number.isFinite(n) ? Math.round(n) : null
}
