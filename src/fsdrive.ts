// Accès au dossier Drive local (File System Access API) — partagé
// entre l'onglet Documents et le Journal (rangement des photos).

import type { Projet } from './types'
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
export const ARBORESCENCE: { dossier: string; description: string; phases?: string[] }[] = [
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
