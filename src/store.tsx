// Store applicatif — état unique persisté en localStorage.
// `update(fn)` clone l'état, applique la mutation, persiste.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppState, DocumentCorpus, Entreprise, Personne } from './types'
import { fold, uid } from './util'
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
  // v9 → v10 : corpus de l'assistant — repris par le bloc v11 → v12 ci-dessous
  // (l'ancien champ « documents » est migré vers corpusDocuments)
  // v10 → v11 : DCE/CCTP structurés + planning travaux détaillé
  etat.lotsDce = Array.isArray(parsed.lotsDce) ? parsed.lotsDce : []
  etat.tachesChantier = Array.isArray(parsed.tachesChantier) ? parsed.tachesChantier : []
  // v11 → v12 : registre documentaire + entreprises canoniques ;
  // l'ancien « documents » (corpus de l'assistant) devient corpusDocuments
  etat.corpusDocuments = Array.isArray(parsed.corpusDocuments)
    ? parsed.corpusDocuments
    : Array.isArray((parsed as AppState & { documents?: DocumentCorpus[] }).documents)
      ? (parsed as AppState & { documents?: DocumentCorpus[] }).documents!
      : []
  etat.registreDocuments = Array.isArray(parsed.registreDocuments) ? parsed.registreDocuments : []
  etat.entreprises = Array.isArray(parsed.entreprises) ? parsed.entreprises : []
  // v12 → v13 : CRM organisations (clients & acheteurs, audit V3 Lot 5)
  etat.organisations = Array.isArray(parsed.organisations) ? parsed.organisations : []
  amorcerEntreprises(etat)
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

/** amorce les entreprises CANONIQUES depuis les artisans et les marchés
 *  (idempotent) : une identité par nom normalisé, et les objets existants
 *  reçoivent leur entrepriseId — le nom libre reste pour l'affichage */
function amorcerEntreprises(etat: AppState): void {
  const parNom = new Map<string, Entreprise>()
  for (const e of etat.entreprises) parNom.set(fold(e.raisonSociale), e)
  const obtenir = (nom: string): Entreprise => {
    const cle = fold(nom)
    let e = parNom.get(cle)
    if (!e) {
      e = { id: uid('ent'), raisonSociale: nom, domaines: [], lots: [] }
      parNom.set(cle, e)
      etat.entreprises.push(e)
    }
    return e
  }
  for (const a of etat.artisans) {
    if (!a.nom.trim()) continue
    const e = obtenir(a.nom)
    a.entrepriseId = a.entrepriseId || e.id
    e.lots = [...new Set([...e.lots, ...a.lots])]
    e.zone = e.zone || a.zone
    e.contactNom = e.contactNom || a.contactNom
    e.contactEmail = e.contactEmail || a.contactEmail
    e.tel = e.tel || a.tel
    e.decennaleFin = e.decennaleFin ?? a.decennaleFin ?? null
    const domaine = a.contactEmail?.split('@')[1]
    if (domaine && !e.domaines.includes(domaine)) e.domaines.push(domaine)
  }
  for (const m of etat.marches) {
    if (!m.entreprise.trim()) continue
    const e = obtenir(m.entreprise)
    m.entrepriseId = m.entrepriseId || e.id
    if (m.lot && !e.lots.includes(m.lot)) e.lots.push(m.lot)
    const domaine = m.contactEmail?.split('@')[1]
    if (domaine && !e.domaines.includes(domaine)) e.domaines.push(domaine)
    e.contactNom = e.contactNom || m.contactNom
    e.contactEmail = e.contactEmail || m.contactEmail
  }
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
  const frais = seedState()
  amorcerEntreprises(frais)
  return frais
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
  const refEtat = useRef(state) // dernier état local (fusion des réceptions distantes)
  refEtat.current = state
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
          // un poste pas encore à jour envoie un document qui ignore les
          // collections récentes : on garde alors les données locales au lieu
          // de les effacer (schéma additif — v10 → v11 : lotsDce, tachesChantier)
          const distant = { ...next }
          const local = refEtat.current
          if (!Array.isArray(distant.lotsDce)) distant.lotsDce = local.lotsDce
          if (!Array.isArray(distant.tachesChantier)) distant.tachesChantier = local.tachesChantier
          // v11 → v12 : registre documentaire, entreprises, corpus renommé
          if (!Array.isArray(distant.corpusDocuments)) distant.corpusDocuments = local.corpusDocuments
          if (!Array.isArray(distant.registreDocuments)) distant.registreDocuments = local.registreDocuments
          if (!Array.isArray(distant.entreprises)) distant.entreprises = local.entreprises
          // v12 → v13 : organisations (CRM acheteurs)
          if (!Array.isArray(distant.organisations)) distant.organisations = local.organisations
          // re-fusionne la config machine-locale (jamais synchronisée)
          replace({ ...distant, settings: { ...distant.settings, sync } })
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
