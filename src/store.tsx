// Store applicatif — état unique persisté en localStorage.
// `update(fn)` clone l'état, applique la mutation, persiste.

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppState } from './types'
import { seedState, STATE_VERSION } from './seed'

const STORAGE_KEY = 'cockpit-ll-v1'

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (parsed && parsed.version === STATE_VERSION) return parsed
      // version différente : on repart du seed en conservant ce qui matche
      if (parsed && typeof parsed === 'object') {
        return { ...seedState(), ...parsed, version: STATE_VERSION }
      }
    }
  } catch {
    // stockage corrompu → seed
  }
  return seedState()
}

function persist(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // quota dépassé : on continue en mémoire
  }
}

interface StoreCtx {
  state: AppState
  /** mutation via producteur : update(d => { d.projets.push(...) }) */
  update: (fn: (draft: AppState) => void) => void
  /** remplacement complet (import JSON, réinitialisation) */
  replace: (next: AppState) => void
}

const Ctx = createContext<StoreCtx | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load)

  const update = useCallback((fn: (draft: AppState) => void) => {
    setState((prev) => {
      const draft = structuredClone(prev)
      fn(draft)
      persist(draft)
      return draft
    })
  }, [])

  const replace = useCallback((next: AppState) => {
    const withVersion = { ...next, version: STATE_VERSION }
    persist(withVersion)
    setState(withVersion)
  }, [])

  const value = useMemo(() => ({ state, update, replace }), [state, update, replace])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore hors StoreProvider')
  return ctx
}
