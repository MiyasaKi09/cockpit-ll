// ============================================================
// Hors-ligne des entités SORTIES du document JSONB — plan §3.3,
// CDC §24 (« synchronisation rejouable », « actions idempotentes »).
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// Le patron relationnel du dépôt (`entrants`, `veille_*`) est bon pour
// le schéma et INSUFFISANT pour le client : `clientSupabase()` renvoie
// `null` sans session, et toutes les lectures de `src/veille.ts`
// échouent alors. Ces tables sont purement en ligne. Recopier ce patron
// tel quel pour les communications, les propositions, les pointages —
// les trois entités les plus utilisées au quotidien — supprimerait le
// hors-ligne exactement là où il sert : le chrono en déplacement, les
// tâches sur chantier. C'est le piège principal de la migration
// relationnelle, et le plan le nomme comme tel.
//
// D'où deux mécaniques, et une seule paire indissociable :
//   * un CACHE de lecture sur une fenêtre utile (90 jours) — pour que
//     lire sans réseau montre ce que ce poste a déjà vu ;
//   * une FILE D'ÉCRITURES idempotentes — pour qu'une correction faite
//     hors ligne reparte seule, sans que personne la ressaisisse.
//
// CE MODULE NE CONNAÎT AUCUNE TABLE
// ---------------------------------
// Il est délibérément générique : `communications` (A.3) s'en sert,
// `propositions` (A.9) et `pointages` (B.4) s'en serviront — le plan
// écrit « branchée sur le cache et la file d'A.3 » et « file
// mutualisée ». Un second cache écrit pour la deuxième table serait
// exactement le doublon que la vague A a déjà eu à supprimer. Chaque
// table déclare son EXÉCUTEUR (`enregistrerExecuteur`) ; la file, elle,
// ne sait que rejouer.
//
// LES DEUX INVARIANTS QUI COMPTENT, ET POURQUOI
// ---------------------------------------------
// 1. UNE LECTURE SANS SESSION NE REND JAMAIS UN ZÉRO AFFIRMATIF.
//    `lireCache` renvoie `null` — « on ne sait pas » — tant que ce
//    magasin n'a jamais été rempli pour cette cible. `[]` est une
//    réponse : « il n'y a rien ». Les deux ne s'affichent pas pareil, et
//    `src/entrants.ts` tient déjà cette distinction (`useNbEntrantsDistants`
//    renvoie `null`, jamais `0`, quand la boîte partagée est illisible).
// 2. UNE ÉCRITURE EN FILE PORTE DES VALEURS ABSOLUES, JAMAIS UN DELTA.
//    C'est ce qui rend le rejeu idempotent sans rien demander au
//    serveur : réappliquer deux fois `{traite_par: 'Julien', traite_le:
//    '…T09:12Z'}` donne le même état. Un incrément, lui, compterait
//    deux fois. Corollaire : l'HORODATAGE EST CELUI DU GESTE HUMAIN,
//    figé à l'enfilement, jamais recalculé au moment de l'envoi — sinon
//    la même écriture rejouée dirait autre chose, et « rejouable »
//    cesserait d'être vrai. Les tables qui INSÈRENT (A.9, B.4) portent
//    en plus `ecriture_id` en clé d'unicité serveur, sur le patron
//    d'`entrants_source_unq` ; celles qui ne font que corriger une ligne
//    existante — c'est le cas de `communications` — sont idempotentes
//    par construction, l'`update` visant une clé primaire.
//
// La partie qui décide (fenêtre, ordre, idempotence, cloisonnement des
// cibles) est écrite en fonctions PURES, testables sans navigateur —
// même partage que `resoudreMoi()` dans `src/moi.ts`. IndexedDB n'est
// que la persistance, et son absence (Safari privé, test, rendu hors
// navigateur) dégrade sans jamais faire perdre une écriture de la
// session en cours.
// ============================================================

import { useSyncExternalStore } from 'react'
import { abonnerSession, cibleSyncCourante, syncActif } from './sync'

/** fenêtre de conservation du cache de lecture, en jours (plan §3.3) :
 *  « messages, propositions et tâches des 90 derniers jours ». Au-delà, la
 *  consultation exige le réseau — personne ne relit un mail de l'an dernier
 *  en déplacement, et un cache non borné finirait par peser plus lourd que
 *  le document qu'on a justement sorti du JSONB. */
export const FENETRE_CACHE_JOURS = 90

/** au-delà, l'écriture est déclarée BLOQUÉE : elle reste dans la file (on ne
 *  jette pas le travail de quelqu'un en silence), elle cesse de retenir les
 *  suivantes, et l'écran doit la signaler — c'est le garde-fou « alertes en
 *  cas d'échec » du §24. Une erreur permanente (rôle en lecture seule, ligne
 *  supprimée côté serveur) bloquerait sinon la file pour toujours. */
export const MAX_TENTATIVES = 5

// ------------------------------------------------------------
// 1. L'identifiant client — la clé d'idempotence
// ------------------------------------------------------------

/** Identifiant généré côté navigateur, sur le modèle de `MON_ID`
 *  (`src/sync.ts`). Il voyage avec l'écriture : c'est lui qui permet de
 *  reconnaître une écriture déjà enfilée, et c'est lui que les tables à
 *  insertion (A.9, B.4) porteront en clé d'unicité serveur. */
export function identifiantClient(): string {
  return crypto.randomUUID?.() ?? `e-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

// ------------------------------------------------------------
// 2. Les règles pures — fenêtre de cache
// ------------------------------------------------------------

/** vrai si cette date entre dans la fenêtre de conservation.
 *
 *  Une ligne SANS date reste : elle n'est pas datable, donc pas élaguable
 *  sans arbitrage, et une anomalie d'ingestion ne doit pas se solder par une
 *  disparition silencieuse. Le cas est rare (l'ingestion date tous les
 *  messages) et son coût est borné. */
export function dansLaFenetre(
  date: string | null | undefined,
  maintenant: string,
  jours: number = FENETRE_CACHE_JOURS,
): boolean {
  if (!date) return true
  const t = Date.parse(date)
  if (Number.isNaN(t)) return true
  const reference = Date.parse(maintenant)
  if (Number.isNaN(reference)) return true
  return t >= reference - jours * 86_400_000
}

/** ne garde que les lignes de la fenêtre — appliqué à l'écriture du cache
 *  comme à sa lecture : une ligne conservée après coup par un ancien cache
 *  ne doit pas ressortir plus vieille que ce que la fenêtre annonce */
export function elaguer<T>(
  lignes: T[],
  dateDe: (ligne: T) => string | null,
  maintenant: string,
  jours: number = FENETRE_CACHE_JOURS,
): T[] {
  return lignes.filter((l) => dansLaFenetre(dateDe(l), maintenant, jours))
}

// ------------------------------------------------------------
// 3. Les règles pures — file d'écritures
// ------------------------------------------------------------

/** une écriture locale en attente d'envoi */
export interface EcritureEnAttente {
  /** identifiant client — clé d'idempotence, jamais réattribué */
  id: string
  /** cible de synchronisation au moment du geste. Une file préparée pour un
   *  projet Supabase ne se rejoue JAMAIS sur un autre : c'est déjà la règle
   *  de `cibleSynchronisation()` (`src/syncState.ts`) pour le document
   *  partagé, et elle vaut mot pour mot ici. */
  cible: string
  /** table visée — la file ne sait rien d'elle, l'exécuteur si */
  magasin: string
  /** clé de la ligne visée (son identifiant serveur) */
  cle: string
  /** VALEURS ABSOLUES, jamais un delta : c'est ce qui rend le rejeu sûr */
  valeurs: Record<string, unknown>
  /** instant du GESTE humain, figé ici et jamais recalculé à l'envoi */
  faitLe: string
  /** rang d'enfilement — l'ordre des corrections est leur sens */
  ordre: number
  tentatives: number
  derniereErreur: string | null
  /** au-delà de MAX_TENTATIVES : conservée, signalée, ne retient plus rien */
  bloquee: boolean
}

/** fabrique une écriture — les valeurs par défaut sont injectables pour que
 *  la règle reste testable sans horloge ni tirage aléatoire */
export function nouvelleEcriture(
  magasin: string,
  cle: string,
  valeurs: Record<string, unknown>,
  cible: string,
  options?: { id?: string; faitLe?: string; ordre?: number },
): EcritureEnAttente {
  return {
    id: options?.id ?? identifiantClient(),
    cible,
    magasin,
    cle,
    valeurs,
    faitLe: options?.faitLe ?? new Date().toISOString(),
    ordre: options?.ordre ?? prochainOrdre(),
    tentatives: 0,
    derniereErreur: null,
    bloquee: false,
  }
}

/** ajoute une écriture à la file. Réenfiler la MÊME (même identifiant
 *  client) ne la duplique pas — un double clic, un rechargement pendant
 *  l'envoi ou un rejeu concurrent ne produisent qu'une écriture. */
export function fusionnerFile(
  file: EcritureEnAttente[],
  ecriture: EcritureEnAttente,
): EcritureEnAttente[] {
  if (file.some((e) => e.id === ecriture.id)) return file
  return [...file, ecriture].sort((a, b) => a.ordre - b.ordre)
}

export type Executeur = (ecriture: EcritureEnAttente) => Promise<void>

export interface ResultatRejeu {
  /** la file après passage — ce qui reste à envoyer */
  file: EcritureEnAttente[]
  envoyees: number
  erreur: string | null
}

/**
 * Rejoue la file, dans l'ordre. Fonction PURE au regard du stockage : elle
 * reçoit la file et rend la file. C'est elle que le test exerce.
 *
 * Quatre décisions, toutes visibles ici :
 *  - une écriture destinée à une AUTRE cible n'est ni envoyée ni jetée. Elle
 *    attend son projet. Rejouer sur le mauvais espace Supabase est le seul
 *    accident irrattrapable de cette mécanique ;
 *  - une écriture dont le magasin n'a pas encore d'exécuteur attend aussi :
 *    le module qui la porte n'est peut-être pas encore chargé ;
 *  - le premier échec ARRÊTE la passe. Deux corrections successives de la
 *    même ligne doivent s'appliquer dans l'ordre où elles ont été faites,
 *    sinon la plus ancienne gagne ;
 *  - une écriture bloquée est sautée : elle a déjà eu ses cinq tentatives,
 *    et elle ne doit pas retenir le travail des autres indéfiniment.
 */
export async function rejouer(
  file: EcritureEnAttente[],
  cible: string | null,
  executeurDe: (magasin: string) => Executeur | null,
): Promise<ResultatRejeu> {
  const sortie: EcritureEnAttente[] = []
  let envoyees = 0
  let erreur: string | null = null

  for (const ecriture of [...file].sort((a, b) => a.ordre - b.ordre)) {
    if (erreur || ecriture.bloquee || !cible || ecriture.cible !== cible) {
      sortie.push(ecriture)
      continue
    }
    const executer = executeurDe(ecriture.magasin)
    if (!executer) {
      sortie.push(ecriture)
      continue
    }
    try {
      await executer(ecriture)
      envoyees++
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const tentatives = ecriture.tentatives + 1
      sortie.push({
        ...ecriture,
        tentatives,
        derniereErreur: message,
        bloquee: tentatives >= MAX_TENTATIVES,
      })
      erreur = message
    }
  }

  return { file: sortie, envoyees, erreur }
}

// ------------------------------------------------------------
// 4. La persistance — IndexedDB, et son absence
// ------------------------------------------------------------
//
// IndexedDB est déjà une dépendance du dépôt (`src/fsdrive.ts`, base
// `cockpit-ll-fs`) : rien de nouveau n'entre ici. Une base SÉPARÉE, parce
// que celle-là garde des poignées de dossier dont la durée de vie n'a rien à
// voir avec un cache de 90 jours.

const NOM_BASE = 'cockpit-ll-hors-ligne'
const VERSION_BASE = 1
const STORE_LIGNES = 'lignes'
const STORE_META = 'meta'
const STORE_FILE = 'file'

interface LigneCache {
  cle: string
  cible: string
  magasin: string
  id: string
  date: string | null
  ligne: unknown
}

let basePromesse: Promise<IDBDatabase | null> | null = null

function base(): Promise<IDBDatabase | null> {
  if (basePromesse) return basePromesse
  basePromesse = new Promise<IDBDatabase | null>((res) => {
    try {
      if (typeof indexedDB === 'undefined') return res(null)
      const req = indexedDB.open(NOM_BASE, VERSION_BASE)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_LIGNES)) {
          const store = db.createObjectStore(STORE_LIGNES, { keyPath: 'cle' })
          store.createIndex('parMagasin', ['cible', 'magasin'])
        }
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'cle' })
        if (!db.objectStoreNames.contains(STORE_FILE)) db.createObjectStore(STORE_FILE, { keyPath: 'id' })
      }
      req.onsuccess = () => res(req.result)
      req.onerror = () => res(null)
    } catch {
      res(null)
    }
  })
  return basePromesse
}

function attendre<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}

function cleLigne(cible: string, magasin: string, id: string): string {
  return `${cible}\u0000${magasin}\u0000${id}`
}

function cleMeta(cible: string, magasin: string): string {
  return `${cible}\u0000${magasin}`
}

// ------------------------------------------------------------
// 5. Le cache de lecture
// ------------------------------------------------------------

export interface CacheLu<T> {
  lignes: T[]
  /** date de la dernière lecture réseau qui a alimenté ce magasin */
  luLe: string
}

/**
 * Ce que ce poste connaît de ce magasin — ou `null`.
 *
 * `null` veut dire « on ne sait pas » : pas de cible, pas d'IndexedDB, ou
 * magasin jamais rempli. Il ne veut JAMAIS dire « il n'y a rien » : un écran
 * qui afficherait « 0 message » à quelqu'un qui n'a simplement pas encore
 * synchronisé lui mentirait, et c'est le genre de zéro sur lequel on prend
 * des décisions.
 */
export async function lireCache<T>(magasin: string): Promise<CacheLu<T> | null> {
  const cible = cibleSyncCourante()
  if (!cible) return null
  const db = await base()
  if (!db) return null
  try {
    const tx = db.transaction([STORE_LIGNES, STORE_META], 'readonly')
    const meta = await attendre<{ cle: string; luLe: string } | undefined>(
      tx.objectStore(STORE_META).get(cleMeta(cible, magasin)) as IDBRequest<
        { cle: string; luLe: string } | undefined
      >,
    )
    if (!meta) return null
    const brutes = await attendre<LigneCache[]>(
      tx.objectStore(STORE_LIGNES).index('parMagasin').getAll(IDBKeyRange.only([cible, magasin])) as IDBRequest<
        LigneCache[]
      >,
    )
    const maintenant = new Date().toISOString()
    return {
      luLe: meta.luLe,
      lignes: brutes.filter((b) => dansLaFenetre(b.date, maintenant)).map((b) => b.ligne as T),
    }
  } catch {
    return null
  }
}

/**
 * Range des lignes lues sur le réseau. Les lignes déjà connues sont
 * remplacées (une correction distante gagne sur la copie locale), les
 * autres s'ajoutent : une page ne doit pas effacer les précédentes.
 * L'élagage de la fenêtre est fait ici, à chaque écriture — un cache qui
 * ne s'élague qu'au démarrage grossit tout l'été.
 */
export async function ecrireCache<T>(
  magasin: string,
  lignes: T[],
  cleDe: (ligne: T) => string,
  dateDe: (ligne: T) => string | null,
): Promise<void> {
  const cible = cibleSyncCourante()
  if (!cible) return
  const db = await base()
  if (!db) return
  const maintenant = new Date().toISOString()
  try {
    const tx = db.transaction([STORE_LIGNES, STORE_META], 'readwrite')
    const store = tx.objectStore(STORE_LIGNES)
    for (const ligne of elaguer(lignes, dateDe, maintenant)) {
      const enregistrement: LigneCache = {
        cle: cleLigne(cible, magasin, cleDe(ligne)),
        cible,
        magasin,
        id: cleDe(ligne),
        date: dateDe(ligne),
        ligne,
      }
      store.put(enregistrement)
    }
    // élagage des lignes sorties de la fenêtre depuis la dernière écriture
    const anciennes = await attendre<LigneCache[]>(
      store.index('parMagasin').getAll(IDBKeyRange.only([cible, magasin])) as IDBRequest<LigneCache[]>,
    )
    for (const a of anciennes) if (!dansLaFenetre(a.date, maintenant)) store.delete(a.cle)
    tx.objectStore(STORE_META).put({ cle: cleMeta(cible, magasin), luLe: maintenant })
  } catch {
    /* un cache qui n'a pas pu s'écrire n'empêche pas la lecture réseau */
  }
}

/**
 * Applique localement une correction qu'on vient d'enfiler, pour que l'écran
 * montre tout de suite ce que la personne a décidé — même sans réseau. La
 * ligne sera réécrite telle que le serveur la rend à la prochaine lecture.
 */
export async function patcherCache<T>(
  magasin: string,
  cle: string,
  patch: (ligne: T) => T,
): Promise<void> {
  const cible = cibleSyncCourante()
  if (!cible) return
  const db = await base()
  if (!db) return
  try {
    const tx = db.transaction(STORE_LIGNES, 'readwrite')
    const store = tx.objectStore(STORE_LIGNES)
    const actuel = await attendre<LigneCache | undefined>(
      store.get(cleLigne(cible, magasin, cle)) as IDBRequest<LigneCache | undefined>,
    )
    if (!actuel) return
    store.put({ ...actuel, ligne: patch(actuel.ligne as T) })
  } catch {
    /* la correction reste dans la file : rien n'est perdu, seul l'affichage attend */
  }
}

/** oublie un magasin (déconnexion, changement d'espace, maintenance) */
export async function viderCache(magasin: string): Promise<void> {
  const cible = cibleSyncCourante()
  if (!cible) return
  const db = await base()
  if (!db) return
  try {
    const tx = db.transaction([STORE_LIGNES, STORE_META], 'readwrite')
    const store = tx.objectStore(STORE_LIGNES)
    const lignes = await attendre<LigneCache[]>(
      store.index('parMagasin').getAll(IDBKeyRange.only([cible, magasin])) as IDBRequest<LigneCache[]>,
    )
    for (const l of lignes) store.delete(l.cle)
    tx.objectStore(STORE_META).delete(cleMeta(cible, magasin))
  } catch {
    /* rien à rattraper : le cache est un cache */
  }
}

// ------------------------------------------------------------
// 6. La file — mémoire de session, persistance de confort
// ------------------------------------------------------------
//
// La file vit EN MÉMOIRE et se persiste au mieux. L'ordre est délibéré :
// perdre IndexedDB (navigation privée, quota, base corrompue) ne doit pas
// faire perdre une correction faite il y a dix secondes. L'inverse — ne
// vivre qu'en IndexedDB — aurait rendu chaque écriture dépendante d'une
// couche qui, elle, a le droit d'être absente.

let fileMemoire: EcritureEnAttente[] = []
let fileChargee: Promise<void> | null = null
let rejeuEnCours: Promise<ResultatRejeu> | null = null
let rejeuDemande = false
let ordreCourant = 0
const executeurs = new Map<string, Executeur>()
const abonnesFile = new Set<() => void>()

/** instantané STABLE entre deux changements : `useSyncExternalStore` compare
 *  par référence et boucle si on lui rend un objet neuf à chaque appel */
let instantaneFile = { enAttente: 0, bloquees: 0, erreur: null as string | null }

function prochainOrdre(): number {
  return ++ordreCourant
}

function publierFile(): void {
  const enAttente = fileMemoire.filter((e) => !e.bloquee).length
  const bloquees = fileMemoire.filter((e) => e.bloquee).length
  const erreur = fileMemoire.find((e) => e.bloquee)?.derniereErreur ?? null
  if (
    instantaneFile.enAttente === enAttente &&
    instantaneFile.bloquees === bloquees &&
    instantaneFile.erreur === erreur
  )
    return
  instantaneFile = { enAttente, bloquees, erreur }
  for (const abonne of abonnesFile) {
    try {
      abonne()
    } catch {
      /* un abonné en échec ne prive pas les autres de la notification */
    }
  }
}

async function persisterFile(): Promise<void> {
  const db = await base()
  if (!db) return
  try {
    const tx = db.transaction(STORE_FILE, 'readwrite')
    const store = tx.objectStore(STORE_FILE)
    const existantes = await attendre<EcritureEnAttente[]>(store.getAll() as IDBRequest<EcritureEnAttente[]>)
    const gardees = new Set(fileMemoire.map((e) => e.id))
    for (const e of existantes) if (!gardees.has(e.id)) store.delete(e.id)
    for (const e of fileMemoire) store.put(e)
  } catch {
    /* la file reste en mémoire pour cette session */
  }
}

/** charge la file persistée, une seule fois — et réarme les écouteurs */
export function chargerFile(): Promise<void> {
  if (fileChargee) return fileChargee
  fileChargee = (async () => {
    armer()
    const db = await base()
    if (!db) return
    try {
      const tx = db.transaction(STORE_FILE, 'readonly')
      const stockees = await attendre<EcritureEnAttente[]>(
        tx.objectStore(STORE_FILE).getAll() as IDBRequest<EcritureEnAttente[]>,
      )
      for (const e of stockees) fileMemoire = fusionnerFile(fileMemoire, e)
      // l'ordre reprend au-dessus de tout ce qui existe : deux sessions
      // successives ne doivent pas réattribuer le même rang
      ordreCourant = fileMemoire.reduce((max, e) => Math.max(max, e.ordre), ordreCourant)
      publierFile()
    } catch {
      /* file illisible : on repart de la mémoire, vide */
    }
  })()
  return fileChargee
}

/** Déclare comment une table applique ses écritures. Appelé à l'import du
 *  module qui porte la table — la file ne connaît aucune table par elle-même.
 *
 *  C'est aussi ce qui RÉVEILLE la file : une correction faite hier soir dans
 *  le train, dans un onglet fermé depuis, attend dans IndexedDB. Sans ce
 *  chargement, elle ne repartirait qu'à la prochaine écriture — c'est-à-dire
 *  peut-être jamais, et « une écriture faite hors ligne repart seule »
 *  cesserait d'être vrai au premier rechargement de page. */
export function enregistrerExecuteur(magasin: string, executeur: Executeur): void {
  executeurs.set(magasin, executeur)
  void chargerFile().then(() => rejouerFile())
}

/**
 * Enfile une écriture et tente de l'envoyer tout de suite.
 *
 * Renvoie l'écriture enfilée, ou `null` si aucune cible n'est configurée —
 * auquel cas il n'y a pas d'espace partagé du tout, et l'appelant doit le
 * dire plutôt que de laisser croire à un envoi différé.
 */
export async function enfiler(
  magasin: string,
  cle: string,
  valeurs: Record<string, unknown>,
): Promise<EcritureEnAttente | null> {
  const cible = cibleSyncCourante()
  if (!cible) return null
  await chargerFile()
  const ecriture = nouvelleEcriture(magasin, cle, valeurs, cible)
  fileMemoire = fusionnerFile(fileMemoire, ecriture)
  publierFile()
  void persisterFile()
  void rejouerFile()
  return ecriture
}

/**
 * Rejoue la file (retour du réseau, ouverture de session, geste manuel).
 *
 * Deux décisions, et les deux ont coûté un bogue avant d'être écrites.
 *
 * Sans session, on ne tente RIEN. Un essai voué à l'échec consommerait une
 * des cinq tentatives, et rester trois jours hors ligne suffirait à déclarer
 * bloquée une correction parfaitement valide. Le compteur ne doit
 * s'incrémenter que sur un refus réellement reçu.
 *
 * Et les passes sont SÉRIALISÉES. Le réarmement a trois déclencheurs — retour
 * du réseau, ouverture de session, enfilement — qui arrivent volontiers
 * ensemble : deux passes concurrentes liraient la même file et enverraient
 * deux fois chaque écriture, la seconde affectation écrasant la première.
 * L'idempotence sauverait l'état du serveur, pas le compte des tentatives.
 * Une demande arrivée pendant une passe déclenche donc une passe SUIVANTE,
 * jamais une passe parallèle — c'est exactement ce que fait `pousserEnSerie`
 * (`src/store.tsx`) pour le document partagé.
 */
export async function rejouerFile(): Promise<ResultatRejeu> {
  if (rejeuEnCours) {
    rejeuDemande = true
    return rejeuEnCours
  }
  const execution = (async (): Promise<ResultatRejeu> => {
    try {
      let dernier: ResultatRejeu = { file: fileMemoire, envoyees: 0, erreur: null }
      do {
        rejeuDemande = false
        await chargerFile()
        if (fileMemoire.length === 0) {
          dernier = { file: [], envoyees: 0, erreur: null }
          break
        }
        if (!syncActif()) {
          dernier = { file: fileMemoire, envoyees: 0, erreur: null }
          break
        }
        dernier = await rejouer(fileMemoire, cibleSyncCourante(), (m) => executeurs.get(m) ?? null)
        fileMemoire = dernier.file
        publierFile()
        void persisterFile()
      } while (rejeuDemande)
      return dernier
    } finally {
      rejeuEnCours = null
    }
  })()
  rejeuEnCours = execution
  return execution
}

/** redonne ses chances à une écriture bloquée — « possibilité de corriger
 *  manuellement » (§24). Le refus venait peut-être d'un droit rétabli depuis. */
export async function reprendreEcriture(id: string): Promise<void> {
  await chargerFile()
  fileMemoire = fileMemoire.map((e) =>
    e.id === id ? { ...e, tentatives: 0, derniereErreur: null, bloquee: false } : e,
  )
  publierFile()
  void persisterFile()
  void rejouerFile()
}

/** abandonne une écriture bloquée — geste humain explicite, jamais automatique */
export async function oublierEcriture(id: string): Promise<void> {
  await chargerFile()
  fileMemoire = fileMemoire.filter((e) => e.id !== id)
  publierFile()
  void persisterFile()
}

/** les écritures encore en attente, pour l'écran qui les liste */
export function ecrituresEnAttente(): EcritureEnAttente[] {
  return fileMemoire
}

// ------------------------------------------------------------
// 7. Le réarmement — « une écriture faite hors ligne repart seule »
// ------------------------------------------------------------

let arme = false

/** branche le rejeu sur le retour du réseau et sur l'ouverture de session.
 *  Idempotent : appelé par `chargerFile()`, donc par le premier usage. */
export function armer(): void {
  if (arme || typeof window === 'undefined') return
  arme = true
  window.addEventListener('online', () => void rejouerFile())
  // la session s'ouvre en asynchrone au démarrage (lien magique, reprise de
  // session) : une correction saisie avant elle attend cet instant précis
  abonnerSession(() => void rejouerFile())
}

// ------------------------------------------------------------
// 8. Les hooks
// ------------------------------------------------------------

export interface EtatFile {
  enAttente: number
  bloquees: number
  erreur: string | null
}

function abonnerFile(ecouteur: () => void): () => void {
  abonnesFile.add(ecouteur)
  void chargerFile()
  return () => {
    abonnesFile.delete(ecouteur)
  }
}

function lireInstantaneFile(): EtatFile {
  return instantaneFile
}

/** « 2 corrections en attente d'envoi » — l'écran doit pouvoir le dire */
export function useFileEcritures(): EtatFile {
  return useSyncExternalStore(abonnerFile, lireInstantaneFile, lireInstantaneFile)
}
