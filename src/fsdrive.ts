// Accès au dossier Drive local (File System Access API) — partagé
// entre l'onglet Documents et le Journal (rangement des photos).

import type { Projet } from './types'
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
}

export const supporteFS = typeof window !== 'undefined' && 'showDirectoryPicker' in window

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

/** écrit le fichier dans <racine>/<projet>/<sousDossier>/<nomFinal> */
export async function rangerFichier(
  racine: FSDirHandle,
  p: Projet,
  sousDossier: string,
  file: File,
  nomFinal: string,
): Promise<string> {
  if (!(await verifierPermission(racine))) throw new Error('Accès au dossier refusé.')
  const dossierProjet = await racine.getDirectoryHandle(slugProjet(p), { create: true })
  const sous = await dossierProjet.getDirectoryHandle(sousDossier, { create: true })
  const fh = await sous.getFileHandle(nomFinal, { create: true })
  const w = await fh.createWritable()
  await w.write(file)
  await w.close()
  return `${slugProjet(p)}/${sousDossier}/${nomFinal}`
}
