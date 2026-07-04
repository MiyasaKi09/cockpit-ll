// Parseur des retours de routines Claude (bloc JSON collé).
// Déterministe et méfiant : validation stricte, jamais d'écrasement —
// tout arrive en « à vérifier » ou « à étudier », traçable via `source`.

import type { AppState, Consultation, Courrier, Situation } from './types'
import { fold, todayISO, uid } from './util'

export interface RetourSituation {
  entreprise: string
  lot?: string
  projet?: string
  mois: string
  numero?: number | null
  montantMoisHT?: number | null
  montantCumulHT?: number | null
  confiance?: number | null
  source?: string
  /** personne concernée (ex. "Julien") — filtre la boîte « À traiter » */
  pour?: string
  notes?: string
}

export interface RetourConsultation {
  intitule: string
  acheteur?: string
  lieu?: string
  typologie?: string
  budgetTravaux?: number | null
  dateLimite?: string | null
  source?: string
  /** personne concernée (ex. "Zoé") */
  pour?: string
  notes?: string
}

export interface RetourCourrier {
  de: string
  objet: string
  resume: string
  projet?: string
  type?: string
  actionProposee?: string
  urgence?: number
  pour?: string
  source?: string
}

export type RetourRoutine =
  | { type: 'situations'; items: RetourSituation[] }
  | { type: 'consultations'; items: RetourConsultation[] }
  | { type: 'courriers'; items: RetourCourrier[] }

/** extrait le JSON d'un collage brut (tolère le bloc ```json ... ``` et le texte autour) */
export function extraireJSON(brut: string): string | null {
  const bloc = brut.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (bloc) return bloc[1].trim()
  const debut = brut.indexOf('{')
  const fin = brut.lastIndexOf('}')
  if (debut >= 0 && fin > debut) return brut.slice(debut, fin + 1)
  return null
}

export function parseRetourRoutine(brut: string): { retour?: RetourRoutine; erreur?: string } {
  const json = extraireJSON(brut)
  if (!json) return { erreur: 'Aucun JSON détecté dans le texte collé.' }
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (e) {
    return { erreur: `JSON invalide : ${e instanceof Error ? e.message : String(e)}` }
  }
  if (typeof data !== 'object' || data === null) return { erreur: 'Le JSON doit être un objet.' }
  const obj = data as { type?: unknown; items?: unknown }
  if (obj.type !== 'situations' && obj.type !== 'consultations' && obj.type !== 'courriers')
    return { erreur: 'Champ « type » attendu : "situations", "consultations" ou "courriers".' }
  if (!Array.isArray(obj.items)) return { erreur: 'Champ « items » attendu : un tableau.' }

  if (obj.type === 'situations') {
    const items: RetourSituation[] = []
    for (const [i, raw] of (obj.items as unknown[]).entries()) {
      const r = raw as Record<string, unknown>
      if (typeof r?.entreprise !== 'string' || !r.entreprise.trim())
        return { erreur: `items[${i}] : « entreprise » manquante.` }
      if (typeof r?.mois !== 'string' || !/^\d{4}-\d{2}$/.test(r.mois))
        return { erreur: `items[${i}] : « mois » attendu au format AAAA-MM.` }
      items.push({
        entreprise: r.entreprise.trim(),
        lot: typeof r.lot === 'string' ? r.lot : undefined,
        projet: typeof r.projet === 'string' ? r.projet : undefined,
        mois: r.mois,
        numero: typeof r.numero === 'number' ? r.numero : null,
        montantMoisHT: typeof r.montantMoisHT === 'number' ? r.montantMoisHT : null,
        montantCumulHT: typeof r.montantCumulHT === 'number' ? r.montantCumulHT : null,
        confiance:
          typeof r.confiance === 'number' ? Math.max(0, Math.min(1, r.confiance)) : null,
        source: typeof r.source === 'string' ? r.source : undefined,
        pour: typeof r.pour === 'string' ? r.pour : undefined,
        notes: typeof r.notes === 'string' ? r.notes : undefined,
      })
    }
    return { retour: { type: 'situations', items } }
  }

  if (obj.type === 'courriers') {
    const items: RetourCourrier[] = []
    for (const [i, raw] of (obj.items as unknown[]).entries()) {
      const r = raw as Record<string, unknown>
      if (typeof r?.objet !== 'string' || !r.objet.trim())
        return { erreur: `items[${i}] : « objet » manquant.` }
      if (typeof r?.resume !== 'string' || !r.resume.trim())
        return { erreur: `items[${i}] : « resume » manquant.` }
      items.push({
        de: typeof r.de === 'string' ? r.de : '?',
        objet: r.objet.trim(),
        resume: r.resume.trim(),
        projet: typeof r.projet === 'string' ? r.projet : undefined,
        type: typeof r.type === 'string' ? r.type : undefined,
        actionProposee: typeof r.actionProposee === 'string' ? r.actionProposee : undefined,
        urgence: typeof r.urgence === 'number' ? r.urgence : undefined,
        pour: typeof r.pour === 'string' ? r.pour : undefined,
        source: typeof r.source === 'string' ? r.source : undefined,
      })
    }
    return { retour: { type: 'courriers', items } }
  }

  const items: RetourConsultation[] = []
  for (const [i, raw] of (obj.items as unknown[]).entries()) {
    const r = raw as Record<string, unknown>
    if (typeof r?.intitule !== 'string' || !r.intitule.trim())
      return { erreur: `items[${i}] : « intitule » manquant.` }
    items.push({
      intitule: r.intitule.trim(),
      acheteur: typeof r.acheteur === 'string' ? r.acheteur : undefined,
      lieu: typeof r.lieu === 'string' ? r.lieu : undefined,
      typologie: typeof r.typologie === 'string' ? r.typologie : undefined,
      budgetTravaux: typeof r.budgetTravaux === 'number' ? r.budgetTravaux : null,
      dateLimite:
        typeof r.dateLimite === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dateLimite)
          ? r.dateLimite
          : null,
      source: typeof r.source === 'string' ? r.source : undefined,
      pour: typeof r.pour === 'string' ? r.pour : undefined,
      notes: typeof r.notes === 'string' ? r.notes : undefined,
    })
  }
  return { retour: { type: 'consultations', items } }
}

/** rapprochement d'une situation importée avec un marché connu (projet + lot, sinon entreprise) */
export function rapprocherMarche(
  state: AppState,
  item: RetourSituation,
): { marcheId: string | null; projetId: string } {
  const marches = state.marches
  // 1. projet explicite + lot ou entreprise qui matche
  if (item.projet) {
    const duProjet = marches.filter((m) => m.projetId === item.projet)
    const parLot = item.lot ? duProjet.find((m) => fold(m.lot).includes(fold(item.lot!)) || fold(item.lot!).includes(fold(m.lot))) : undefined
    if (parLot) return { marcheId: parLot.id, projetId: parLot.projetId }
    const parEnt = duProjet.find((m) => fold(m.entreprise) === fold(item.entreprise))
    if (parEnt) return { marcheId: parEnt.id, projetId: parEnt.projetId }
    if (state.projets.some((p) => p.id === item.projet)) return { marcheId: null, projetId: item.projet }
  }
  // 2. entreprise seule, sans ambiguïté
  const parEntreprise = marches.filter((m) => fold(m.entreprise) === fold(item.entreprise))
  if (parEntreprise.length === 1)
    return { marcheId: parEntreprise[0].id, projetId: parEntreprise[0].projetId }
  // 3. non rattachée → premier projet actif ou champ vide (l'utilisateur corrigera)
  return { marcheId: null, projetId: item.projet || '' }
}

/** doublon : même marché/entreprise et même mois déjà en base */
export function situationExiste(state: AppState, item: RetourSituation, marcheId: string | null): boolean {
  return state.situations.some(
    (s) =>
      s.mois === item.mois &&
      (marcheId ? s.marcheId === marcheId : fold(s.entreprise) === fold(item.entreprise)),
  )
}

export interface ResultatImport {
  ajoutes: number
  doublons: number
  nonRattaches: number
}

/** horodate le dernier import d'un type de routine (lu par la page Santé) */
function marquerImport(draft: AppState, type: 'situations' | 'consultations' | 'courriers'): void {
  draft.settings.derniersImports = { ...(draft.settings.derniersImports || {}), [type]: todayISO() }
}

/** importe les situations (mutation du draft passé par store.update) */
export function importerSituations(draft: AppState, items: RetourSituation[]): ResultatImport {
  const res: ResultatImport = { ajoutes: 0, doublons: 0, nonRattaches: 0 }
  marquerImport(draft, 'situations')
  for (const item of items) {
    const { marcheId, projetId } = rapprocherMarche(draft, item)
    if (situationExiste(draft, item, marcheId)) {
      res.doublons++
      continue
    }
    if (!marcheId) res.nonRattaches++
    const sit: Situation = {
      id: uid('sit'),
      projetId,
      marcheId,
      entreprise: item.entreprise,
      lot: item.lot,
      mois: item.mois,
      numero: item.numero ?? null,
      montantMoisHT: item.montantMoisHT ?? null,
      montantCumulHT: item.montantCumulHT ?? null,
      statut: 'a_verifier',
      confiance: item.confiance ?? null,
      source: item.source || 'import routine',
      dateReception: todayISO(),
      pour: item.pour,
      notes: item.notes,
    }
    draft.situations.push(sit)
    res.ajoutes++
  }
  return res
}

/** rattache un courrier à un projet : id exact, sinon nom de projet contenu */
export function rapprocherProjet(state: AppState, ref?: string): string | null {
  if (!ref) return null
  const brut = ref.trim()
  if (state.projets.some((p) => p.id === brut)) return brut
  const cible = fold(brut)
  const parNom = state.projets.filter((p) => fold(p.nom).includes(cible) || cible.includes(fold(p.nom)))
  return parNom.length === 1 ? parNom[0].id : null
}

/** importe les courriers triés par la routine mail (dédoublonnage de + objet) */
export function importerCourriers(draft: AppState, items: RetourCourrier[]): ResultatImport {
  const res: ResultatImport = { ajoutes: 0, doublons: 0, nonRattaches: 0 }
  marquerImport(draft, 'courriers')
  for (const item of items) {
    const existe = draft.courriers.some(
      (c) => fold(c.objet) === fold(item.objet) && fold(c.de) === fold(item.de) && c.statut === 'a_traiter',
    )
    if (existe) {
      res.doublons++
      continue
    }
    const projetId = rapprocherProjet(draft, item.projet)
    if (!projetId) res.nonRattaches++
    const courrier: Courrier = {
      id: uid('mail'),
      projetId,
      de: item.de,
      objet: item.objet,
      resume: item.resume,
      type: item.type || 'autre',
      actionProposee: item.actionProposee,
      urgence: item.urgence === 3 ? 3 : item.urgence === 1 ? 1 : item.urgence === 2 ? 2 : undefined,
      pour: item.pour,
      statut: 'a_traiter',
      dateReception: todayISO(),
      source: item.source || 'routine tri du matin',
    }
    draft.courriers.push(courrier)
    res.ajoutes++
  }
  return res
}

/** importe les consultations (dédoublonnage sur intitulé + acheteur) */
export function importerConsultations(draft: AppState, items: RetourConsultation[]): ResultatImport {
  const res: ResultatImport = { ajoutes: 0, doublons: 0, nonRattaches: 0 }
  marquerImport(draft, 'consultations')
  for (const item of items) {
    const existe = draft.consultations.some(
      (c) =>
        fold(c.intitule) === fold(item.intitule) &&
        fold(c.acheteur || '') === fold(item.acheteur || ''),
    )
    if (existe) {
      res.doublons++
      continue
    }
    const c: Consultation = {
      id: uid('ao'),
      intitule: item.intitule,
      acheteur: item.acheteur,
      lieu: item.lieu,
      typologie: item.typologie,
      budgetTravaux: item.budgetTravaux ?? null,
      dateLimite: item.dateLimite ?? null,
      statut: 'a_etudier',
      source: item.source || 'import routine',
      pour: item.pour,
      notes: item.notes,
    }
    draft.consultations.push(c)
    res.ajoutes++
  }
  return res
}
