// Accès au dossier Drive local (File System Access API) — partagé
// entre l'onglet Documents et le Journal (rangement des photos).

import type { PhaseCode, Projet } from './types'
import { empreinteSha256 } from './registre'
import { fold, todayISO } from './util'

export interface FSFileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
}
export interface FSDirHandle {
  kind: 'directory'
  name: string
  values(): AsyncIterable<FSFileHandle | FSDirHandle>
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FSDirHandle>
  getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FSFileHandle & { createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> }>
  queryPermission?(d: { mode: string }): Promise<string>
  requestPermission?(d: { mode: string }): Promise<string>
  removeEntry?(name: string): Promise<void>
}

export const supporteFS = typeof window !== 'undefined' && 'showDirectoryPicker' in window

/** boîte d'arrivée à la racine du Drive : on y jette les fichiers reçus,
 *  la page Documents propose leur classement puis les range au projet */
export const DOSSIER_ENTRANTS = '_A_CLASSER'

/** arborescence normalisée d'un dossier projet (partagée par l'onglet
 *  Documents du projet et la page Documents globale) */
export const ARBORESCENCE: { dossier: string; description: string; phases?: PhaseCode[] }[] = [
  { dossier: '00_ADMIN', description: 'contrat, assurances, courriers officiels' },
  { dossier: '01_DIAG', description: 'diagnostics, relevés, existant', phases: ['DIAG'] },
  { dossier: '02_ESQ', description: 'esquisse', phases: ['ESQ'] },
  { dossier: '03_APS-APD_PC', description: 'avant-projets, dossier PC', phases: ['APS', 'APD'] },
  { dossier: '04_PRO-DCE', description: 'projet, CCTP, DCE', phases: ['PRO', 'ACT-DCE'] },
  { dossier: '05_ACT_MARCHES', description: 'offres, analyses, marchés signés', phases: ['ACT-DCE'] },
  { dossier: '06_EXE-VISA', description: 'plans EXE, visas', phases: ['VISA'] },
  { dossier: '07_CHANTIER', description: 'CR de chantier, situations, OS', phases: ['DET'] },
  { dossier: '08_AOR', description: 'réception, réserves, DOE', phases: ['AOR'] },
  { dossier: '09_FACTURES', description: 'factures émises et justificatifs' },
  { dossier: '10_PHOTOS', description: 'photos chantier et références' },
]

/** phase de la mission déduite du sous-dossier de rangement — la
 *  correspondance existe depuis l'origine dans `ARBORESCENCE`, on se
 *  contente de la lire. Retourne `null` dès qu'elle est AMBIGUË
 *  (03_APS-APD_PC couvre APS et APD) ou absente : une phase proposée au
 *  hasard vaudrait moins que pas de phase du tout. */
export function phaseDuDossier(dossier: string): PhaseCode | null {
  const entree = ARBORESCENCE.find((a) => a.dossier === dossier)
  return entree?.phases?.length === 1 ? entree.phases[0] : null
}

const DB = 'cockpit-ll-fs'

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('handles')
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}

export async function sauverRacine(h: FSDirHandle): Promise<void> {
  const db = await idb()
  await new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readwrite')
    tx.objectStore('handles').put(h, 'racine')
    tx.oncomplete = () => res(null)
    tx.onerror = () => rej(tx.error)
  })
}

export async function lireRacine(): Promise<FSDirHandle | null> {
  try {
    const db = await idb()
    return await new Promise((res, rej) => {
      const tx = db.transaction('handles', 'readonly')
      const req = tx.objectStore('handles').get('racine')
      req.onsuccess = () => res((req.result as FSDirHandle) || null)
      req.onerror = () => rej(req.error)
    })
  } catch {
    return null
  }
}

export async function choisirRacine(): Promise<FSDirHandle | null> {
  try {
    const h = await (
      window as unknown as { showDirectoryPicker(o?: object): Promise<FSDirHandle> }
    ).showDirectoryPicker({ mode: 'readwrite' })
    await sauverRacine(h)
    return h
  } catch {
    return null
  }
}

export async function verifierPermission(h: FSDirHandle): Promise<boolean> {
  if (!h.requestPermission) return true
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted'
}

export function slugProjet(p: Projet): string {
  return `${p.id}_${fold(p.nom).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)}`
}

/** compte rendu d'une création d'arborescence — de quoi dire ce qui a été
 *  fait sans relire le disque, et distinguer « créé » de « déjà là » */
export interface ResultatArborescence {
  /** nom du dossier projet à la racine (= `slugProjet(p)`) */
  dossierProjet: string
  /** sous-dossiers créés par CET appel */
  crees: string[]
  /** sous-dossiers déjà présents, laissés intacts avec leur contenu */
  existants: string[]
}

/** crée `<racine>/<slugProjet(p)>/` puis les sous-dossiers d'`ARBORESCENCE`
 *  (CDC §12.1, points 6 « créer le dossier Drive » et 7 « créer
 *  l'arborescence »).
 *
 *  Idempotente et non destructive : un dossier déjà là est laissé tel quel
 *  avec son contenu, rien n'est renommé ni supprimé — c'est ce qui autorise
 *  à la rejouer sur un projet ancien pour le compléter.
 *
 *  Elle LÈVE sur permission refusée ou écriture impossible, et c'est
 *  l'appelant qui décide du sens de l'échec : blocage pour le bouton manuel
 *  de l'onglet Documents, simple signalement à la fin de l'assistant
 *  « Nouveau projet », où le projet est déjà enregistré.
 *
 *  Point d'entrée UNIQUE : dupliquer la boucle ailleurs ferait diverger
 *  l'arborescence réelle de celle que lit l'onglet Documents.
 *  `scripts/test-arborescence-projet.cjs` le vérifie. */
export async function creerArborescenceProjet(racine: FSDirHandle, p: Projet): Promise<ResultatArborescence> {
  if (!(await verifierPermission(racine))) throw new Error('Accès au dossier refusé.')
  const dossierProjet = slugProjet(p)
  const dossier = await racine.getDirectoryHandle(dossierProjet, { create: true })
  const crees: string[] = []
  const existants: string[] = []
  for (const a of ARBORESCENCE) {
    const dejaLa = await dossier
      .getDirectoryHandle(a.dossier, { create: false })
      .then(() => true)
      .catch(() => false)
    await dossier.getDirectoryHandle(a.dossier, { create: true })
    ;(dejaLa ? existants : crees).push(a.dossier)
  }
  return { dossierProjet, crees, existants }
}

export function nomConforme(p: Projet, type: string, objet: string, nomFichier: string): string {
  const date = todayISO().replaceAll('-', '')
  const o = fold(objet || nomFichier.replace(/\.[^.]+$/, ''))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const ext = nomFichier.includes('.') ? nomFichier.slice(nomFichier.lastIndexOf('.')) : ''
  return `${date}_${p.id}_${type}_${o}${ext}`
}

/** résultat d'un rangement sûr — de quoi tracer le fichier ET alimenter le registre */
export interface ResultatRangement {
  /** chemin relatif depuis la racine du Drive */
  chemin: string
  /** nom réellement écrit (peut porter un suffixe _vNN) */
  nomFinal: string
  /** un fichier au même contenu existait déjà sous ce nom — rien n'a été réécrit */
  dejaPresent: boolean
  /** empreinte SHA-256 du contenu ('' si Web Crypto indisponible) */
  empreinte: string
  /** version du nom retenu (1 = nom demandé tel quel, 2 = _v02…) */
  version: number
}

/** insère (ou remplace) le suffixe _vNN avant l'extension */
export function nomVersionne(nom: string, n: number): string {
  const i = nom.lastIndexOf('.')
  const base = (i > 0 ? nom.slice(0, i) : nom).replace(/_v\d{2,}$/, '')
  const ext = i > 0 ? nom.slice(i) : ''
  return `${base}_v${String(n).padStart(2, '0')}${ext}`
}

/** écrit `file` sous `nomFinal` dans `dossier` SANS JAMAIS écraser :
 *  - le nom est libre → écriture directe ;
 *  - même nom + même contenu → on ne réécrit rien (dejaPresent) ;
 *  - même nom + contenu différent → version suivante (_v02, _v03…). */
async function ecrireSansEcraser(
  dossier: FSDirHandle,
  file: File,
  nomFinal: string,
): Promise<Omit<ResultatRangement, 'chemin'>> {
  const empreinte = await empreinteSha256(file)
  for (let n = 1; n <= 99; n++) {
    const nom = n === 1 ? nomFinal : nomVersionne(nomFinal, n)
    const existant = await dossier.getFileHandle(nom).catch(() => null)
    if (!existant) {
      const fh = await dossier.getFileHandle(nom, { create: true })
      const w = await fh.createWritable()
      await w.write(file)
      await w.close()
      return { nomFinal: nom, dejaPresent: false, empreinte, version: n }
    }
    // nom déjà pris : même contenu → rien à écrire ; sinon on tente la version suivante
    if (empreinte && (await empreinteSha256(await existant.getFile())) === empreinte) {
      return { nomFinal: nom, dejaPresent: true, empreinte, version: n }
    }
  }
  throw new Error(`Impossible de ranger « ${nomFinal} » : trop de versions homonymes.`)
}

/** écrit un fichier dans <racine>/<sousDossier>/ (hors arborescence projet — ex. candidatures AO) */
export async function ecrireFichierRacine(
  racine: FSDirHandle,
  sousDossier: string,
  file: File,
): Promise<ResultatRangement> {
  if (!(await verifierPermission(racine))) throw new Error('Accès au dossier refusé.')
  const sous = await racine.getDirectoryHandle(sousDossier, { create: true })
  const r = await ecrireSansEcraser(sous, file, file.name)
  return { ...r, chemin: `${sousDossier}/${r.nomFinal}` }
}

/** test de bout en bout : écrit, relit puis supprime un fichier témoin à la racine */
export async function testerEcriture(racine: FSDirHandle): Promise<void> {
  if (!(await verifierPermission(racine))) throw new Error('Accès au dossier refusé — recliquez et acceptez.')
  const nom = '_test-cockpit.tmp'
  const fh = await racine.getFileHandle(nom, { create: true })
  const w = await fh.createWritable()
  await w.write(new Blob(['cockpit-ok']))
  await w.close()
  const relu = await (await fh.getFile()).text()
  await racine.removeEntry?.(nom).catch(() => undefined)
  if (relu !== 'cockpit-ok') throw new Error('Le fichier relu diffère de ce qui a été écrit.')
}

/** liste les fichiers de <racine>/<dossierProjet>/<sousDossier> (dossier absent →
 *  liste vide) — lit le contenu du Drive (ex. les CCTP déposés dans 04_PRO-DCE).
 *  `nomDossierProjet` = slugProjet(p) : passer la chaîne évite de dépendre de
 *  l'objet Projet (identité instable côté React). */
export async function listerFichiersProjet(
  racine: FSDirHandle,
  nomDossierProjet: string,
  sousDossier: string,
): Promise<FSFileHandle[]> {
  if (!(await verifierPermission(racine))) throw new Error('Accès au dossier refusé.')
  const dossierProjet = await racine.getDirectoryHandle(nomDossierProjet, { create: false }).catch(() => null)
  if (!dossierProjet) return []
  const sous = await dossierProjet.getDirectoryHandle(sousDossier, { create: false }).catch(() => null)
  if (!sous) return []
  const fichiers: FSFileHandle[] = []
  for await (const entree of sous.values()) {
    if (entree.kind === 'file') fichiers.push(entree)
  }
  return fichiers.sort((a, b) => a.name.localeCompare(b.name))
}

/** pourquoi une pièce du registre n'a pas pu être ouverte. Quatre causes,
 *  quatre GESTES différents — les confondre en un « erreur » unique ferait
 *  chercher le fichier alors que c'est le dossier qui n'est pas branché.
 *  Le texte montré à la personne appartient à l'écran, pas à ce module. */
export type CauseEchecOuverture =
  /** l'API n'existe pas ici (Safari iOS, Firefox Android) — limite actée, §4.12 du plan d'usage */
  | 'navigateur'
  /** aucune racine Drive branchée sur ce poste (ou le handle a été perdu) */
  | 'racine'
  /** le navigateur a refusé l'accès au dossier */
  | 'permission'
  /** le chemin ne mène plus à rien : fichier déplacé, renommé ou supprimé */
  | 'introuvable'

export type Ouverture = { ok: true; fichier: File } | { ok: false; cause: CauseEchecOuverture }

/** relit une pièce du Drive à partir du `cheminDrive` gardé par le registre
 *  (`<projet>/<sousDossier>/<nom>`, tel que rendu par `rangerFichier`).
 *
 *  LECTURE SEULE et non créatrice : chaque segment est ouvert en
 *  `create: false`, si bien qu'un chemin périmé ne fabrique jamais le
 *  dossier manquant — il DIT que la pièce a bougé. C'est le pendant du
 *  rangement qui n'écrase jamais.
 *
 *  Ne lève pas : rend la cause, l'appelant choisit son message et son geste. */
export async function lireFichierDuDrive(racine: FSDirHandle | null, chemin: string): Promise<Ouverture> {
  if (!supporteFS) return { ok: false, cause: 'navigateur' }
  if (!racine) return { ok: false, cause: 'racine' }
  const segments = chemin.split('/').map((s) => s.trim()).filter(Boolean)
  if (segments.length === 0) return { ok: false, cause: 'introuvable' }
  if (!(await verifierPermission(racine))) return { ok: false, cause: 'permission' }
  let dossier = racine
  for (const nom of segments.slice(0, -1)) {
    const suivant = await dossier.getDirectoryHandle(nom, { create: false }).catch(() => null)
    if (!suivant) return { ok: false, cause: 'introuvable' }
    dossier = suivant
  }
  const fh = await dossier.getFileHandle(segments[segments.length - 1]).catch(() => null)
  if (!fh) return { ok: false, cause: 'introuvable' }
  const fichier = await fh.getFile().catch(() => null)
  if (!fichier) return { ok: false, cause: 'introuvable' }
  return { ok: true, fichier }
}

/** liste les fichiers de <racine>/<sousDossier> (dossier absent → liste vide) —
 *  ex. la boîte d'arrivée _A_CLASSER */
export async function listerFichiersRacine(racine: FSDirHandle, sousDossier: string): Promise<FSFileHandle[]> {
  if (!(await verifierPermission(racine))) throw new Error('Accès au dossier refusé.')
  const sous = await racine.getDirectoryHandle(sousDossier, { create: false }).catch(() => null)
  if (!sous) return []
  const fichiers: FSFileHandle[] = []
  for await (const entree of sous.values()) {
    if (entree.kind === 'file') fichiers.push(entree)
  }
  return fichiers.sort((a, b) => a.name.localeCompare(b.name))
}

/** retire un fichier de <racine>/<sousDossier> (après rangement au projet) */
export async function supprimerFichierRacine(racine: FSDirHandle, sousDossier: string, nom: string): Promise<void> {
  const sous = await racine.getDirectoryHandle(sousDossier, { create: false }).catch(() => null)
  await sous?.removeEntry?.(nom)
}

/** écrit le fichier dans <racine>/<projet>/<sousDossier>/ — rangement SÛR :
 *  jamais d'écrasement silencieux (contenu identique → rien à réécrire,
 *  contenu différent sous le même nom → suffixe _v02, _v03…) */
export async function rangerFichier(
  racine: FSDirHandle,
  p: Projet,
  sousDossier: string,
  file: File,
  nomFinal: string,
): Promise<ResultatRangement> {
  if (!(await verifierPermission(racine))) throw new Error('Accès au dossier refusé.')
  const dossierProjet = await racine.getDirectoryHandle(slugProjet(p), { create: true })
  const sous = await dossierProjet.getDirectoryHandle(sousDossier, { create: true })
  const r = await ecrireSansEcraser(sous, file, nomFinal)
  return { ...r, chemin: `${slugProjet(p)}/${sousDossier}/${r.nomFinal}` }
}
