// ============================================================
// CRM organisations — le Lot 5 de l'audit V3 : passer du carnet
// de contacts au radar de RELATIONS et de futurs projets.
// - rapprochement automatique acheteur → organisation (fold)
// - fiche : contacts, interactions, consultations, références
// - historique DECP (données ouvertes data.economie.gouv.fr,
//   attributions ~2016-2023) — la mémoire des acheteurs
// - APProch (projets d'achats futurs) : LIEN GUIDÉ uniquement,
//   pas d'API publique documentée → pas de scraping (garde-fous)
// - prochaine action suggérée par règles lisibles, jamais imposée
// ============================================================

import type {
  AppState,
  Consultation,
  Contact,
  EtapeRelation,
  Interaction,
  Organisation,
  Reference,
} from './types'
import { diffDays, fold, todayISO, uid } from './util'

// ---------- pipeline relationnel ----------

export const ETAPES_RELATION: { id: EtapeRelation; label: string; aide: string }[] = [
  { id: 'identifie', label: 'Identifié', aide: 'repéré dans la veille ou les consultations' },
  { id: 'a_comprendre', label: 'À comprendre', aide: 'habitudes d’achat et projets à cerner' },
  { id: 'relation_a_creer', label: 'Relation à créer', aide: 'premier contact à provoquer' },
  { id: 'relation_active', label: 'Relation active', aide: 'échanges réguliers' },
  { id: 'projet_potentiel', label: 'Projet potentiel', aide: 'un projet se dessine' },
  { id: 'consultation_attendue', label: 'Consultation attendue', aide: 'publication anticipée' },
  { id: 'client', label: 'Client', aide: 'a déjà confié une mission' },
]

export const LIBELLE_RELATION: Record<EtapeRelation, string> = Object.fromEntries(
  ETAPES_RELATION.map((e) => [e.id, e.label]),
) as Record<EtapeRelation, string>

export const TYPES_ORGANISATION = [
  'Commune',
  'EPCI / intercommunalité',
  'Département / Région',
  'Bailleur social',
  'État / établissement public',
  'Santé / médico-social',
  'Enseignement / recherche',
  'Privé',
  'Autre',
]

// ---------- rapprochement ----------

export function trouverOrganisation(state: AppState, nom: string): Organisation | null {
  const cle = fold(nom)
  if (!cle) return null
  return state.organisations.find((o) => fold(o.nom) === cle) || null
}

/** crée les organisations manquantes depuis les ACHETEURS des consultations
 *  et rattache consultations + contacts (par organisme). Idempotent : un nom
 *  normalisé = une organisation ; un acheteur déjà client reste client. */
export function rapprocherOrganisations(d: AppState): { creees: number; rattachees: number } {
  const parNom = new Map<string, Organisation>()
  for (const o of d.organisations) parNom.set(fold(o.nom), o)
  let creees = 0
  let rattachees = 0

  const obtenir = (nom: string): Organisation => {
    const cle = fold(nom)
    let o = parNom.get(cle)
    if (!o) {
      o = { id: uid('org'), nom, relation: 'identifie', creeLe: todayISO() }
      parNom.set(cle, o)
      d.organisations.push(o)
      creees++
    }
    return o
  }

  for (const c of d.consultations) {
    const nom = (c.acheteur || '').trim()
    if (!nom) continue
    const o = obtenir(nom)
    if (!c.organisationId) {
      c.organisationId = o.id
      rattachees++
    }
    // une mission gagnée fait de l'acheteur un CLIENT (jamais l'inverse)
    if (c.statut === 'gagnee' && o.relation !== 'client') o.relation = 'client'
  }

  for (const ct of d.contacts) {
    if (ct.organisationId) continue
    const nom = (ct.organisme || '').trim()
    if (!nom) continue
    const o = parNom.get(fold(nom))
    if (o) {
      ct.organisationId = o.id
      rattachees++
    }
  }

  return { creees, rattachees }
}

// ---------- lectures de la fiche ----------

export function consultationsDe(state: AppState, org: Organisation): Consultation[] {
  const cle = fold(org.nom)
  return state.consultations.filter(
    (c) => c.organisationId === org.id || (c.acheteur && fold(c.acheteur) === cle),
  )
}

export function contactsDe(state: AppState, org: Organisation): Contact[] {
  const cle = fold(org.nom)
  return state.contacts.filter(
    (c) => c.organisationId === org.id || (c.organisme && fold(c.organisme) === cle),
  )
}

/** interactions liées à l'organisation (via ses contacts ou ses consultations) */
export function interactionsDe(state: AppState, org: Organisation): Interaction[] {
  const contacts = new Set(contactsDe(state, org).map((c) => c.id))
  const consultations = new Set(consultationsDe(state, org).map((c) => c.id))
  return state.interactions
    .filter((i) => contacts.has(i.contactId) || (i.consultationId && consultations.has(i.consultationId)))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** références de l'agence à MONTRER à cette organisation : mêmes mots
 *  que ses consultations (typologie + intitulés), sélection expliquée */
export function referencesPourOrganisation(state: AppState, org: Organisation): Reference[] {
  const texte = fold(
    consultationsDe(state, org)
      .map((c) => `${c.intitule} ${c.typologie || ''}`)
      .join(' '),
  )
  if (!texte.trim()) return []
  const mots = new Set(texte.split(/[^a-z0-9]+/).filter((m) => m.length >= 4))
  return state.references
    .filter((r) => {
      const cles = [...(r.motsCles || []), r.nom]
      return cles.some((cText) => fold(cText).split(/[^a-z0-9]+/).some((m) => m.length >= 4 && mots.has(m)))
    })
    .slice(0, 4)
}

// ---------- prochaine action suggérée (règles lisibles) ----------

export interface ActionSuggeree {
  action: string
  raison: string
}

/** la « prochaine meilleure action » relationnelle — des RÈGLES, pas une
 *  boîte noire : chaque suggestion dit pourquoi ; l'humain décide */
export function prochaineActionSuggeree(
  state: AppState,
  org: Organisation,
  today: string,
): ActionSuggeree | null {
  const consultations = consultationsDe(state, org)
  const interactions = interactionsDe(state, org)
  const derniere = interactions[0]?.date || null

  // 1. un résultat perdu récent = la meilleure occasion d'apprendre
  const perdueRecente = consultations.find(
    (c) => c.statut === 'perdue' && !c.motifsResultat && (c.dernierMouvement ? diffDays(c.dernierMouvement, today) <= 60 : true),
  )
  if (perdueRecente) {
    return {
      action: `Demander le débriefing de « ${perdueRecente.intitule} » (motifs, classement, attributaire).`,
      raison: 'consultation perdue sans motifs tracés — la matière première des prochains Go/No-Go',
    }
  }
  // 2. une consultation attendue se surveille par les alertes
  if (org.relation === 'consultation_attendue') {
    return {
      action: 'Vérifier les alertes plateforme + APProch : la consultation peut sortir à tout moment.',
      raison: 'relation à l’étape « consultation attendue »',
    }
  }
  // 3. une relation qui dort se perd
  if ((org.relation === 'relation_active' || org.relation === 'client') && derniere && diffDays(derniere, today) > 90) {
    return {
      action: 'Reprendre contact (actualité de l’agence, référence livrée, vœux…).',
      raison: `dernière interaction il y a ${diffDays(derniere, today)} jours`,
    }
  }
  // 4. une organisation identifiée mais jamais approchée
  if ((org.relation === 'identifie' || org.relation === 'a_comprendre') && interactions.length === 0) {
    return {
      action: 'Compléter la fiche : attributions passées (DECP), contacts, territoires — puis décider si la relation vaut d’être créée.',
      raison: 'organisation repérée mais encore jamais approchée',
    }
  }
  if (org.relation === 'relation_a_creer') {
    return {
      action: 'Provoquer un premier échange (rencontre, envoi d’une référence pertinente).',
      raison: 'relation marquée « à créer »',
    }
  }
  return null
}

// ---------- DECP : attributions passées (données ouvertes) ----------

export interface AttributionDecp {
  objet: string
  acheteur: string
  titulaire: string
  montant: number | null
  date: string | null
  procedure: string
  cpv: string
  lieu: string
}

const URL_DECP = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/decp_augmente/records'

/** APProch (projets d'achats futurs de l'État et des collectivités) :
 *  pas d'API publique documentée → on GUIDE vers la recherche officielle,
 *  on ne scrape pas (garde-fous de l'audit V3 §15) */
export const URL_APPROCH = 'https://projets-achats.marches-publics.gouv.fr/'

/** attributions passées d'un acheteur dans les DECP consolidées
 *  (data.economie.gouv.fr, couverture ~2016-2023). C'est la MÉMOIRE :
 *  habitudes d'achat, budgets, maîtres d'œuvre retenus — jamais une
 *  source d'opportunités ouvertes. */
export async function rechercherAttributionsDecp(
  nomAcheteur: string,
  opts?: { moeSeulement?: boolean; limite?: number },
): Promise<{ total: number; attributions: AttributionDecp[] }> {
  const nom = nomAcheteur.replace(/["\\]/g, ' ').replace(/\(\d+\)/g, ' ').trim()
  if (!nom) return { total: 0, attributions: [] }
  const clauses = [`search(nomacheteur, "${nom}")`]
  // CPV 71 = services d'architecture, d'ingénierie et de maîtrise d'œuvre
  if (opts?.moeSeulement) clauses.push('startswith(codecpv, "71")')
  const params = new URLSearchParams({
    where: clauses.join(' AND '),
    order_by: 'datenotification desc',
    limit: String(opts?.limite ?? 12),
    select:
      'objetmarche,nomacheteur,denominationsocialeetablissement,montant,datenotification,procedure,codecpv,lieuexecutionnom',
  })
  const r = await fetch(`${URL_DECP}?${params}`)
  if (!r.ok) throw new Error(`Les DECP ont répondu ${r.status}.`)
  const data = (await r.json()) as {
    total_count: number
    results: {
      objetmarche?: string
      nomacheteur?: string
      denominationsocialeetablissement?: string
      montant?: number
      datenotification?: string
      procedure?: string
      codecpv?: string
      lieuexecutionnom?: string
    }[]
  }
  const anneeMax = new Date().getFullYear() + 1
  const attributions = (data.results || [])
    // le jeu contient quelques dates aberrantes (2048…) — on les écarte
    .filter((x) => {
      if (!x.datenotification) return true
      const annee = Number(x.datenotification.slice(0, 4))
      return annee >= 2010 && annee <= anneeMax
    })
    .map((x) => ({
      objet: x.objetmarche || '(objet non publié)',
      acheteur: x.nomacheteur || '',
      titulaire: x.denominationsocialeetablissement || '(titulaire non publié)',
      montant: typeof x.montant === 'number' ? x.montant : null,
      date: x.datenotification || null,
      procedure: x.procedure || '',
      cpv: x.codecpv || '',
      lieu: x.lieuexecutionnom || '',
    }))
  return { total: data.total_count, attributions }
}
