// Store applicatif — état unique persisté en localStorage.
// `update(fn)` clone l'état, applique la mutation, persiste.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppState, Personne } from './types'
import { seedState, STATE_VERSION } from './seed'
import { DEPARTEMENTS_DEFAUT } from './boamp'
import { connecterSync, demarrerRealtime, pousserEtat, syncActif } from './sync'

const STORAGE_KEY = 'cockpit-ll-v1'

/** migration sans perte : complète les champs apparus depuis la v1 */
function migrate(parsed: AppState): AppState {
  const etat: AppState = { ...seedState(), ...parsed, version: STATE_VERSION }
  etat.reunions = Array.isArray(parsed.reunions) ? parsed.reunions : []
  etat.courriers = Array.isArray(parsed.courriers) ? parsed.courriers : []
  etat.tempsHorsProjet = Array.isArray(parsed.tempsHorsProjet) ? parsed.tempsHorsProjet : []
  // v7 → v8 : congés / absences par personne (plan de charge)
  etat.absences = Array.isArray(parsed.absences) ? parsed.absences : []
  // v8 → v9 : notation des entreprises par chantier
  etat.evaluations = Array.isArray(parsed.evaluations) ? parsed.evaluations : []
  // v9 → v10 : corpus de l'assistant (textes réglementaires + modèles)
  etat.documents = Array.isArray(parsed.documents) ? parsed.documents : []
  // v5 → v6 : journal d'interactions CRM. On amorce depuis les
  // derniereInteraction existantes pour ne rien perdre de l'historique.
  if (Array.isArray(parsed.interactions)) {
    etat.interactions = parsed.interactions
  } else {
    etat.interactions = (parsed.contacts || [])
      .filter((c) => c.derniereInteraction)
      .map((c) => ({
        id: `int-migr-${c.id}`,
        contactId: c.id,
        date: c.derniereInteraction!,
        canal: 'autre' as const,
        resume: 'Interaction reprise de l’ancienne fiche.',
      }))
  }
  // v3 → v4 : l'équipe réelle remplace le coût horaire forfaitaire
  if (!Array.isArray(parsed.settings?.equipe) || parsed.settings.equipe.length === 0) {
    const noms = parsed.settings?.personnes?.length ? parsed.settings.personnes : ['Julien', 'Zoé']
    etat.settings.equipe = noms.map((nom, i) => ({
      id: `pers-${i}-${nom.toLowerCase()}`,
      nom,
      remuMensuelle: 3000,
      modeRemu: 'brut',
      statut: 'dirigeant',
      heuresAnnuelles: 1720,
      facturablePct: 0.6,
      coefCharges: 1.55,
    }))
  }
  // v4 → v5 : saisie net OU brut + statut SAS — l'ancien brutMensuel devient
  // remuMensuelle en mode brut, coefficient conservé (aucun coût ne bouge)
  etat.settings.equipe = etat.settings.equipe.map((p) => {
    const ancien = p as Personne & { brutMensuel?: number }
    return {
      id: p.id,
      nom: p.nom,
      remuMensuelle: typeof p.remuMensuelle === 'number' ? p.remuMensuelle : ancien.brutMensuel ?? 0,
      modeRemu: p.modeRemu === 'net' ? 'net' : 'brut',
      statut: p.statut === 'salarie' ? 'salarie' : 'dirigeant',
      coefCharges: typeof p.coefCharges === 'number' ? p.coefCharges : 1.55,
      heuresAnnuelles: p.heuresAnnuelles,
      facturablePct: p.facturablePct,
    }
  })
  if (typeof parsed.settings?.fraisGenerauxAnnuels !== 'number') etat.settings.fraisGenerauxAnnuels = 30040
  // veille AO : l'ancien défaut « 60, 80, 02 » s'élargit aux 3 régions complètes
  if (etat.settings.veilleBoamp && etat.settings.veilleBoamp.departements.replace(/\s/g, '') === '60,80,02') {
    etat.settings.veilleBoamp = { ...etat.settings.veilleBoamp, departements: DEPARTEMENTS_DEFAUT }
  }
  etat.projets = (parsed.projets || []).map((p) => ({
    ...p,
    liens: Array.isArray(p.liens) ? p.liens : [],
    materiauxIds: Array.isArray(p.materiauxIds) ? p.materiauxIds : [],
    artisanIds: Array.isArray(p.artisanIds) ? p.artisanIds : [],
    journal: Array.isArray(p.journal) ? p.journal : [],
  }))
  // v6 → v7 : facturation & situations pro (révision/RG sur les situations,
  // lien situation↔facture DET, suivi des relances). Uniquement des champs
  // optionnels : les situations et factures existantes sont conservées telles
  // quelles (spread de `parsed`), rien à amorcer.
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

  // --- Synchronisation Supabase (opt-in) — branchée DERRIÈRE la persistance ---
  const appliquerDistant = useRef(false) // anti-écho B : une écriture distante ne se re-pousse pas
  const refPush = useRef<AppState | null>(null) // baseline + garde StrictMode
  const sync = state.settings.sync

  // (a) connexion + temps réel. Deps PRIMITIVES : ne se relance qu'au changement de config.
  useEffect(() => {
    if (!sync?.url || !sync.anonKey || !sync.workspaceId) return
    let vivant = true
    let arreter: (() => void) | undefined
    void (async () => {
      try {
        await connecterSync(sync.url, sync.anonKey, sync.workspaceId)
        if (!vivant) return
        arreter = demarrerRealtime((next) => {
          appliquerDistant.current = true
          // re-fusionne la config machine-locale (jamais synchronisée)
          replace({ ...next, settings: { ...next.settings, sync } })
        })
      } catch {
        // mauvaise config / hors-ligne → mode localStorage pur (jamais bloquant)
      }
    })()
    return () => {
      vivant = false
      arreter?.()
    }
  }, [sync?.url, sync?.anonKey, sync?.workspaceId, replace])

  // (b) push débouncé de l'état local vers l'espace partagé
  useEffect(() => {
    if (!syncActif()) return
    if (appliquerDistant.current) {
      // ce changement vient d'une réception distante → ne pas le renvoyer
      appliquerDistant.current = false
      refPush.current = state
      return
    }
    if (refPush.current === null || refPush.current === state) {
      // première activation ou re-montage StrictMode (même référence d'état)
      refPush.current = state
      return
    }
    const id = setTimeout(() => {
      refPush.current = state
      void pousserEtat(state)
    }, 700)
    return () => clearTimeout(id)
  }, [state])

  const value = useMemo(() => ({ state, update, replace }), [state, update, replace])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore hors StoreProvider')
  return ctx
}
