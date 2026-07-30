// Store applicatif — état unique persisté en localStorage.
// `update(fn)` clone l'état, applique la mutation, persiste.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppState, DocumentCorpus, Entreprise, Personne } from './types'
import { fold, uid } from './util'
import { seedState, STATE_VERSION } from './seed'
import { amorcerFinance } from './amorceFinance'
import { DEPARTEMENTS_DEFAUT } from './boamp'
import {
  changementCibleInterdit,
  cibleSynchronisation,
  fusionnerEtatDistant,
} from './syncState'
import {
  effacerRecuperationLocaleRequise,
  marquerRecuperationLocaleRequise,
  MESSAGE_RECUPERATION_LOCALE,
  recuperationLocaleRequise,
} from './syncSafety'
import {
  adopterRevisionDistante,
  cibleSyncCourante,
  connecterSync,
  demarrerRealtime,
  effacerConflitSync,
  etatLocalEnAttentePour,
  marquerEtatLocalEnAttente,
  pousserEtat,
  relancerRealtime,
  signalerConflitSync,
  signalerRecuperationLocaleRequise,
  syncActif,
  syncEtat,
  tirerEtat,
  type ResultatPush,
} from './sync'

const STORAGE_KEY = 'cockpit-ll-v1'
let erreurPersistanceInitiale: string | null = null

/** migration sans perte : complète les champs apparus depuis la v1 */
function migrate(parsed: AppState): AppState {
  const base = seedState()
  const etat: AppState = {
    ...base,
    ...parsed,
    settings: { ...base.settings, ...(parsed.settings || {}) },
    version: STATE_VERSION,
  }
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
  // v13 → v14 : finance F0/F1 — la prévision (échéance) se sépare de la
  // pièce (facture) ; paiements et contrats deviennent des collections.
  // Toujours depuis `parsed` : le spread du seed ne doit pas injecter ses
  // échéances d'exemple dans un état réel qui n'a pas encore la clé.
  etat.echeancesFacturation = Array.isArray(parsed.echeancesFacturation) ? parsed.echeancesFacturation : []
  etat.paiements = Array.isArray(parsed.paiements) ? parsed.paiements : []
  etat.contrats = Array.isArray(parsed.contrats) ? parsed.contrats : []
  // v14 → v15 : achats & frais, banque, pont comptable (F2/F3/F4)
  etat.facturesAchat = Array.isArray(parsed.facturesAchat) ? parsed.facturesAchat : []
  etat.notesFrais = Array.isArray(parsed.notesFrais) ? parsed.notesFrais : []
  etat.attendusFinanciers = Array.isArray(parsed.attendusFinanciers) ? parsed.attendusFinanciers : []
  etat.transactionsBancaires = Array.isArray(parsed.transactionsBancaires) ? parsed.transactionsBancaires : []
  etat.importsBancaires = Array.isArray(parsed.importsBancaires) ? parsed.importsBancaires : []
  etat.lotsComptables = Array.isArray(parsed.lotsComptables) ? parsed.lotsComptables : []
  // v15 → v16 : finance F6-F10 — pilotage unique (5 collections additives)
  etat.revisionsResteAFaire = Array.isArray(parsed.revisionsResteAFaire) ? parsed.revisionsResteAFaire : []
  etat.pistesAvenant = Array.isArray(parsed.pistesAvenant) ? parsed.pistesAvenant : []
  etat.decisionsDirection = Array.isArray(parsed.decisionsDirection) ? parsed.decisionsDirection : []
  etat.simulations = Array.isArray(parsed.simulations) ? parsed.simulations : []
  etat.connecteurs = Array.isArray(parsed.connecteurs) ? parsed.connecteurs : []
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
  amorcerFinance(etat)
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

function messageErreurPersistance(e: unknown): string {
  const detail = e instanceof Error ? e.message : String(e)
  return `Les données n’ont pas pu être enregistrées dans ce navigateur (${detail}). Exportez une sauvegarde JSON avant de fermer l’onglet.`
}

function persist(state: AppState): string | null {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return null
  } catch (e) {
    return messageErreurPersistance(e)
  }
}

function load(): AppState {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch (e) {
    marquerRecuperationLocaleRequise()
    erreurPersistanceInitiale = messageErreurPersistance(e)
  }

  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as AppState
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.projets)) {
        // Même à version courante, normaliser les collections manquantes :
        // une sauvegarde partielle ne doit pas casser l'interface.
        const migre = migrate(parsed)
        // persisté tout de suite : l'amorçage (v14) crée des identifiants —
        // sans écriture, chaque rechargement en régénérerait de nouveaux
        const erreur = persist(migre)
        if (erreur) erreurPersistanceInitiale = erreur
        return migre
      }
      throw new Error('format de sauvegarde invalide')
    } catch (e) {
      marquerRecuperationLocaleRequise()
      const cleSecours = `${STORAGE_KEY}-corrompu-${Date.now()}`
      try {
        localStorage.setItem(cleSecours, raw)
        // La copie datée devient la preuve à conserver. Retirer ensuite la
        // valeur primaire illisible évite de dupliquer le même gros document
        // à chaque rechargement ; le verrou de récupération reste persistant.
        try {
          localStorage.removeItem(STORAGE_KEY)
        } catch {
          /* la copie de secours existe déjà ; le verrou empêche tout envoi */
        }
        erreurPersistanceInitiale =
          `La sauvegarde locale était illisible et a été conservée sous « ${cleSecours} ». Les données d’exemple sont affichées : restaurez un export JSON avant toute saisie.`
      } catch {
        erreurPersistanceInitiale =
          `La sauvegarde locale est illisible (${e instanceof Error ? e.message : String(e)}) et sa copie de secours a échoué. N’effectuez aucune saisie avant d’avoir restauré un export JSON.`
      }
    }
  }
  const frais = seedState()
  amorcerEntreprises(frais)
  return frais
}

type ConfigSync = NonNullable<AppState['settings']['sync']>

interface ResultatSynchronisation {
  ok: boolean
  action?: 'authentification' | 'recupere' | 'initialise' | 'pousse'
  erreur?: string
}

interface StoreCtx {
  state: AppState
  /** mutation via producteur : update(d => { d.projets.push(...) }) */
  update: (fn: (draft: AppState) => void) => void
  /** remplacement complet (import JSON, réinitialisation) */
  replace: (
    next: AppState,
    options?: { localSeulement?: boolean; restaurationSure?: boolean },
  ) => boolean
  /** erreur durable visible tant qu'une écriture locale n'a pas réussi */
  persistenceError: string | null
  clearPersistenceError: () => void
  /** erreur de connexion, de lecture ou de conflit de synchronisation */
  syncError: string | null
  /** connexion + réconciliation atomique avec les refs internes du store */
  synchroniserMaintenant: (
    config: ConfigSync,
    options?: { recupererConflit?: boolean },
  ) => Promise<ResultatSynchronisation>
  /** sérialise un envoi manuel avec les envois automatiques */
  pousserMaintenant: () => Promise<ResultatPush>
}

const Ctx = createContext<StoreCtx | null>(null)

interface EnvoiEnAttente {
  state: AppState
  cible: string
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load)
  const [persistenceError, setPersistenceError] = useState<string | null>(
    () => erreurPersistanceInitiale,
  )
  const [syncError, setSyncError] = useState<string | null>(() =>
    recuperationLocaleRequise() ? MESSAGE_RECUPERATION_LOCALE : null,
  )
  // --- Synchronisation Supabase (opt-in) — branchée DERRIÈRE la persistance ---
  const appliquerDistant = useRef(false) // anti-écho B : une écriture distante ne se re-pousse pas
  const etatLocalSeulement = useRef<AppState | null>(null) // config machine : persistée, jamais envoyée
  const refPush = useRef<AppState | null>(null) // dernière version confirmée distante
  const refEtat = useRef(state) // dernier état local, y compris avant le prochain rendu
  const pushEnCours = useRef<Promise<ResultatPush> | null>(null)
  const ciblePushEnCours = useRef<string | null>(null)
  const pushEnAttente = useRef<EnvoiEnAttente | null>(null)
  refEtat.current = state

  const update = useCallback((fn: (draft: AppState) => void) => {
    setState((prev) => {
      const draft = structuredClone(prev)
      fn(draft)
      refEtat.current = draft
      marquerEtatLocalEnAttente(draft.settings.sync)
      const erreur = persist(draft)
      queueMicrotask(() => setPersistenceError(erreur))
      return draft
    })
  }, [])

  const replace = useCallback(
    (
      next: AppState,
      options?: { localSeulement?: boolean; restaurationSure?: boolean },
    ) => {
      // Toute source (ancienne, distante ou importée) passe par la normalisation.
      const withVersion = migrate(structuredClone(next))
      const precedent = refEtat.current
      const cibleAvant = cibleSynchronisation(precedent.settings.sync)
      const cibleApres = cibleSynchronisation(withVersion.settings.sync)
      const modificationsEnAttente =
        !recuperationLocaleRequise() &&
        (etatLocalEnAttentePour(precedent.settings.sync) ||
          pushEnCours.current !== null ||
          pushEnAttente.current !== null ||
          (refPush.current !== null && precedent !== refPush.current))
      if (
        changementCibleInterdit(cibleAvant, cibleApres, modificationsEnAttente)
      ) {
        setSyncError(
          'Synchronisez ou exportez les modifications en attente avant de changer de projet Supabase.',
        )
        return false
      }

      refEtat.current = withVersion
      if (options?.localSeulement) etatLocalSeulement.current = withVersion
      else marquerEtatLocalEnAttente(withVersion.settings.sync)
      const erreur = persist(withVersion)
      setPersistenceError(erreur)
      setState(withVersion)

      if (options?.restaurationSure && !erreur) {
        if (effacerRecuperationLocaleRequise()) {
          effacerConflitSync()
          setSyncError(null)
        } else {
          setSyncError(MESSAGE_RECUPERATION_LOCALE)
        }
      }
      return erreur === null
    },
    [],
  )

  const appliquerEtatDistant = useCallback((next: AppState): string | null => {
    const withVersion = migrate(structuredClone(next))
    appliquerDistant.current = true
    refPush.current = withVersion
    refEtat.current = withVersion
    const erreur = persist(withVersion)
    setPersistenceError(erreur)
    setState(withVersion)
    return erreur
  }, [])

  const sync = state.settings.sync

  const pousserEnSerie = useCallback(
    (prochain: AppState, cible: string | null): Promise<ResultatPush> => {
      if (recuperationLocaleRequise()) {
        const erreur = signalerRecuperationLocaleRequise()
        setSyncError(erreur)
        return Promise.resolve({ ok: false, conflit: true, erreur })
      }
      if (!cible || cibleSyncCourante() !== cible) {
        const erreur =
          'La cible de synchronisation a changé : cet envoi local a été annulé.'
        setSyncError(erreur)
        return Promise.resolve({ ok: false, erreur })
      }
      if (pushEnCours.current && ciblePushEnCours.current !== cible) {
        const erreur =
          'Un envoi destiné à un autre espace est encore en cours. Aucun état n’a été transféré.'
        setSyncError(erreur)
        return Promise.resolve({ ok: false, erreur })
      }
      if (pushEnAttente.current && pushEnAttente.current.cible !== cible) {
        const erreur =
          'Une modification appartient à un autre espace Supabase. Synchronisez-la avant de changer de cible.'
        setSyncError(erreur)
        return Promise.resolve({ ok: false, erreur })
      }

      pushEnAttente.current = { state: prochain, cible }
      marquerEtatLocalEnAttente(prochain.settings.sync)
      if (!pushEnCours.current) {
        const cibleExecution = cible
        ciblePushEnCours.current = cibleExecution
        const execution = (async (): Promise<ResultatPush> => {
          let dernier: ResultatPush = { ok: false, erreur: 'Aucun état à synchroniser.' }
          try {
            while (pushEnAttente.current) {
              const courant = pushEnAttente.current
              if (courant.cible !== cibleExecution) {
                const erreur =
                  'La file de synchronisation contient une cible différente ; envoi annulé.'
                setSyncError(erreur)
                return { ok: false, erreur }
              }
              pushEnAttente.current = null
              dernier = await pousserEtat(courant.state, cibleExecution)
              if (!dernier.ok) {
                // Ne rattache jamais le nouvel état à l'ancienne cible après un changement.
                if (
                  cibleSynchronisation(refEtat.current.settings.sync) === cibleExecution
                ) {
                  pushEnAttente.current = {
                    state: refEtat.current,
                    cible: cibleExecution,
                  }
                  marquerEtatLocalEnAttente(refEtat.current.settings.sync)
                }
                setSyncError(dernier.erreur || 'Synchronisation impossible.')
                return dernier
              }
              refPush.current = courant.state
              // Une saisie peut avoir eu lieu pendant le await, avant le debounce.
              if (!pushEnAttente.current && refEtat.current !== courant.state) {
                const cibleCourante = cibleSynchronisation(refEtat.current.settings.sync)
                if (cibleCourante !== cibleExecution) {
                  const erreur =
                    'La cible a changé pendant l’envoi ; le nouvel état reste local.'
                  setSyncError(erreur)
                  return { ok: false, erreur }
                }
                pushEnAttente.current = {
                  state: refEtat.current,
                  cible: cibleExecution,
                }
              }
            }
            if (
              cibleSyncCourante() === cibleExecution &&
              refPush.current === refEtat.current &&
              dernier.ok
            ) {
              adopterRevisionDistante(dernier.revision ?? null, syncEtat().derniereSync)
              setSyncError(null)
            } else {
              marquerEtatLocalEnAttente(refEtat.current.settings.sync)
            }
            return dernier
          } catch (e) {
            const erreur = e instanceof Error ? e.message : String(e)
            if (cibleSynchronisation(refEtat.current.settings.sync) === cibleExecution) {
              pushEnAttente.current = {
                state: refEtat.current,
                cible: cibleExecution,
              }
              marquerEtatLocalEnAttente(refEtat.current.settings.sync)
            }
            setSyncError(erreur)
            return { ok: false, erreur }
          }
        })()
        pushEnCours.current = execution
        void execution.finally(() => {
          if (pushEnCours.current === execution) {
            pushEnCours.current = null
            ciblePushEnCours.current = null
          }
        })
      }
      return pushEnCours.current
    },
    [],
  )

  const pousserMaintenant = useCallback(async (): Promise<ResultatPush> => {
    if (!syncActif()) {
      const erreur = 'Aucune session Supabase active.'
      setSyncError(erreur)
      return { ok: false, erreur }
    }
    const cible = cibleSynchronisation(refEtat.current.settings.sync)
    return pousserEnSerie(refEtat.current, cible)
  }, [pousserEnSerie])

  const synchroniserMaintenant = useCallback(
    async (
      config: ConfigSync,
      options?: { recupererConflit?: boolean },
    ): Promise<ResultatSynchronisation> => {
      try {
        const cible = cibleSynchronisation(config)
        if (!cible)
          return { ok: false, erreur: 'La configuration Supabase est incomplète.' }
        await connecterSync(config.url, config.anonKey, config.workspaceId)
        if (!syncActif()) return { ok: false, action: 'authentification' }
        if (cibleSyncCourante() !== cible) {
          const erreur =
            'La cible Supabase a changé pendant la synchronisation ; aucun état n’a été transféré.'
          setSyncError(erreur)
          return { ok: false, erreur }
        }
        const terminer = (resultat: ResultatSynchronisation) => {
          relancerRealtime()
          return resultat
        }
        if (recuperationLocaleRequise() && !options?.recupererConflit) {
          const erreur = signalerRecuperationLocaleRequise()
          setSyncError(erreur)
          return terminer({ ok: false, erreur })
        }
        if (syncEtat().conflit && !options?.recupererConflit) {
          const erreur = signalerConflitSync()
          setSyncError(erreur)
          return terminer({ ok: false, erreur })
        }

        const baseline = refEtat.current
        if (options?.recupererConflit) {
          const remote = await tirerEtat(false)
          if (refEtat.current !== baseline) {
            const erreur = signalerConflitSync()
            setSyncError(erreur)
            return terminer({ ok: false, erreur })
          }
          if (!remote)
            return terminer({
              ok: false,
              erreur: 'L’espace partagé est vide ou inaccessible.',
            })
          const erreurPersistance = appliquerEtatDistant(
            fusionnerEtatDistant(remote.data, baseline),
          )
          if (erreurPersistance) {
            const erreur =
              'La version partagée a été lue mais ne peut pas être sécurisée localement. Aucun verrou de récupération n’a été levé.'
            setSyncError(erreur)
            return terminer({ ok: false, erreur })
          }
          if (
            recuperationLocaleRequise() &&
            !effacerRecuperationLocaleRequise()
          ) {
            setSyncError(MESSAGE_RECUPERATION_LOCALE)
            return terminer({ ok: false, erreur: MESSAGE_RECUPERATION_LOCALE })
          }
          effacerConflitSync()
          adopterRevisionDistante(remote.revision, remote.updated_at)
          setSyncError(null)
          return terminer({ ok: true, action: 'recupere' })
        }

        // Après une coupure/recharge, le marqueur persistant impose un CAS local
        // avant tout pull : une saisie hors-ligne ne peut donc pas être écrasée.
        if (syncEtat().localEnAttente) {
          const resultat = await pousserEnSerie(baseline, cible)
          return terminer(
            resultat.ok
              ? { ok: true, action: 'pousse' }
              : { ok: false, erreur: resultat.erreur },
          )
        }

        const remote = await tirerEtat(false)
        // Protège une saisie faite pendant l'aller-retour réseau du pull initial.
        if (refEtat.current !== baseline) {
          const erreur = signalerConflitSync()
          setSyncError(erreur)
          return terminer({ ok: false, erreur })
        }
        if (remote) {
          const erreurPersistance = appliquerEtatDistant(
            fusionnerEtatDistant(remote.data, baseline),
          )
          if (erreurPersistance) {
            setSyncError(erreurPersistance)
            return terminer({ ok: false, erreur: erreurPersistance })
          }
          adopterRevisionDistante(remote.revision, remote.updated_at)
          setSyncError(null)
          return terminer({ ok: true, action: 'recupere' })
        }

        adopterRevisionDistante(null)
        const resultat = await pousserEnSerie(baseline, cible)
        return terminer(
          resultat.ok
            ? { ok: true, action: 'initialise' }
            : { ok: false, erreur: resultat.erreur },
        )
      } catch (e) {
        const erreur = e instanceof Error ? e.message : String(e)
        setSyncError(erreur)
        relancerRealtime()
        return { ok: false, erreur }
      }
    },
    [appliquerEtatDistant, pousserEnSerie],
  )

  // (a) connexion + temps réel. Deps PRIMITIVES : ne se relance qu'au changement de config.
  useEffect(() => {
    if (!sync?.url || !sync.anonKey || !sync.workspaceId) return
    refPush.current = null
    pushEnAttente.current = null
    let vivant = true
    let arreter: (() => void) | undefined
    void (async () => {
      const resultat = await synchroniserMaintenant(sync)
      if (!vivant) return
      if (!resultat.ok && resultat.action !== 'authentification')
        setSyncError(resultat.erreur || 'Synchronisation impossible.')
      arreter = demarrerRealtime(
        (next) => {
          if (recuperationLocaleRequise()) {
            setSyncError(signalerRecuperationLocaleRequise())
            return false
          }
          if (syncEtat().conflit) {
            setSyncError(signalerConflitSync())
            return false
          }
          const changementsLocaux =
            pushEnCours.current !== null ||
            syncEtat().localEnAttente ||
            (refPush.current !== null && refEtat.current !== refPush.current)
          if (changementsLocaux) {
            setSyncError(signalerConflitSync())
            return false
          }
          const fusionne = fusionnerEtatDistant(next, refEtat.current)
          const erreurPersistance = appliquerEtatDistant(fusionne)
          if (erreurPersistance) {
            setSyncError(erreurPersistance)
            return false
          }
          setSyncError(null)
          return true
        },
        (erreur) => {
          if (!vivant) return
          if (erreur) setSyncError(erreur)
          else if (!syncEtat().conflit) setSyncError(null)
        },
      )
    })()
    return () => {
      vivant = false
      arreter?.()
    }
  }, [
    sync?.url,
    sync?.anonKey,
    sync?.workspaceId,
    appliquerEtatDistant,
    synchroniserMaintenant,
  ])

  // (b) push débouncé de l'état local vers l'espace partagé
  useEffect(() => {
    if (!syncActif()) return
    if (
      etatLocalSeulement.current === state &&
      !syncEtat().localEnAttente
    ) {
      etatLocalSeulement.current = null
      if (refPush.current !== null) refPush.current = state
      return
    }
    etatLocalSeulement.current = null
    if (appliquerDistant.current) {
      // ce changement vient d'une réception distante → ne pas le renvoyer
      appliquerDistant.current = false
      return
    }
    if (refPush.current === null || refPush.current === state) return
    const cible = cibleSynchronisation(state.settings.sync)
    marquerEtatLocalEnAttente(state.settings.sync)
    const id = setTimeout(() => {
      void pousserEnSerie(state, cible)
    }, 700)
    return () => clearTimeout(id)
  }, [state, pousserEnSerie])

  // Un échec conserve le snapshot ; le retour réseau déclenche une reprise
  // même si aucune nouvelle saisie n'a eu lieu entre-temps.
  useEffect(() => {
    const reprendre = () => {
      if (
        syncActif() &&
        !syncEtat().conflit &&
        !recuperationLocaleRequise() &&
        refPush.current !== null &&
        (syncEtat().localEnAttente || refEtat.current !== refPush.current)
      )
        void pousserEnSerie(
          refEtat.current,
          cibleSynchronisation(refEtat.current.settings.sync),
        )
    }
    window.addEventListener('online', reprendre)
    return () => window.removeEventListener('online', reprendre)
  }, [pousserEnSerie])

  const clearPersistenceError = useCallback(() => setPersistenceError(null), [])
  const value = useMemo(
    () => ({
      state,
      update,
      replace,
      persistenceError,
      clearPersistenceError,
      syncError,
      synchroniserMaintenant,
      pousserMaintenant,
    }),
    [
      state,
      update,
      replace,
      persistenceError,
      clearPersistenceError,
      syncError,
      synchroniserMaintenant,
      pousserMaintenant,
    ],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore hors StoreProvider')
  return ctx
}
