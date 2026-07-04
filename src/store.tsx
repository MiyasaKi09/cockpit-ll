// Store applicatif — état unique persisté en localStorage.
// `update(fn)` clone l'état, applique la mutation, persiste.

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppState } from './types'
import { seedState, STATE_VERSION } from './seed'

const STORAGE_KEY = 'cockpit-ll-v1'

/** migration sans perte : complète les champs apparus depuis la v1 */
function migrate(parsed: AppState): AppState {
  const etat: AppState = { ...seedState(), ...parsed, version: STATE_VERSION }
  etat.reunions = Array.isArray(parsed.reunions) ? parsed.reunions : []
  etat.courriers = Array.isArray(parsed.courriers) ? parsed.courriers : []
  etat.tempsHorsProjet = Array.isArray(parsed.tempsHorsProjet) ? parsed.tempsHorsProjet : []
  // v3 → v4 : l'équipe réelle remplace le coût horaire forfaitaire
  if (!Array.isArray(parsed.settings?.equipe) || parsed.settings.equipe.length === 0) {
    const noms = parsed.settings?.personnes?.length ? parsed.settings.personnes : ['Julien', 'Zoé']
    etat.settings.equipe = noms.map((nom, i) => ({
      id: `pers-${i}-${nom.toLowerCase()}`,
      nom,
      brutMensuel: 3000,
      coefCharges: 1.45,
      heuresAnnuelles: 1720,
      facturablePct: 0.6,
    }))
  }
  if (typeof parsed.settings?.fraisGenerauxAnnuels !== 'number') etat.settings.fraisGenerauxAnnuels = 30040
  etat.projets = (parsed.projets || []).map((p) => ({
    ...p,
    liens: Array.isArray(p.liens) ? p.liens : [],
    materiauxIds: Array.isArray(p.materiauxIds) ? p.materiauxIds : [],
    artisanIds: Array.isArray(p.artisanIds) ? p.artisanIds : [],
    journal: Array.isArray(p.journal) ? p.journal : [],
  }))
  return etat
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (parsed && parsed.version === STATE_VERSION) return parsed
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.projets)) {
        return migrate(parsed)
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
    // une sauvegarde d'une version antérieure passe par la migration
    const withVersion = next.version === STATE_VERSION ? next : migrate(next)
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
