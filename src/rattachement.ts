// ============================================================
// Le versant navigateur de la cascade de rattachement — livrable A.4.
//
// LA CASCADE ELLE-MÊME N'EST PAS ICI. Elle vit dans
// `supabase/functions/_shared/rattachement.ts`, sans le moindre import,
// parce qu'elle doit tourner à l'identique dans trois runtimes : ce
// navigateur, le Deno de l'ingestion, et le Node du test. C'était toute
// la difficulté du §3.7 — trois moteurs divergents, un par porte
// d'entrée — et la seule façon de la refermer pour de bon est qu'il n'y
// ait qu'un fichier à corriger le jour où la règle change.
//
// Ce module-ci ne fait que trois choses, et rien d'autre :
//
//   1. TRADUIRE `AppState` en repères. Le cascade ne connaît ni `Projet`,
//      ni `Contact`, ni `MarcheTravaux` : elle reçoit des adresses, des
//      identifiants et des noms. C'est ce qui la rend testable sans
//      construire un état complet, et transportable côté serveur, où
//      `AppState` n'existe pas.
//   2. TENIR LES RÈGLES MÉMORISÉES (§5.1 pt 5). Elles vivent dans
//      `settings.reglesRattachement`, donc dans le document partagé : les
//      deux postes apprennent ensemble, et l'ingestion serveur — qui lit
//      déjà `workspace.data` — les applique sans qu'on lui ouvre une
//      seconde source. Le §2.11 pose la contrainte qui vaut d'abord ici :
//      **une règle apprise propose, elle ne valide jamais**. Elle alimente
//      `projet_id_propose` ; la colonne humaine reste vide tant qu'un
//      humain n'a pas signé.
//   3. NOMMER LA FILE « À RATTACHER ». Elle n'est pas une nouvelle
//      structure : c'est l'ensemble des objets dont la cascade a REFUSÉ
//      de deviner le projet. Refuser est le comportement voulu — un
//      rattachement faux se corrige un par un et contamine tout un fil ;
//      un rattachement absent se voit et coûte un clic.
//
// CE QU'IL NE FAIT PAS : il n'écrit rien dans `communications`. La
// correction d'un message passe par `corrigerRattachement`
// (`src/communications.ts`, A.3), qui la signe et la met en file hors
// ligne. Ici on prépare la règle à mémoriser, pas l'écriture.
// ============================================================

import type { AppState, Projet } from './types'
import {
  LIBELLES_NIVEAU,
  memoriserRegle,
  normaliserAdresse,
  rattacher,
  rattacherMessage,
  type IndicesRattachement,
  type Rattachement,
  type RegleRattachement,
  type ReperesRattachement,
} from '../supabase/functions/_shared/rattachement'
import { fold, todayISO, uid } from './util'

// Ce qui traverse : la cascade elle-même, la normalisation d'une adresse (une
// règle mémorisée sur « Jean <Jean@Bet.example> » et une autre sur
// « jean@bet.example » seraient deux règles pour un seul correspondant) et les
// libellés de niveau. Rien de plus : un export que personne n'appelle finit
// par être appelé de travers.
export {
  LIBELLES_NIVEAU,
  domaineDe,
  normaliserAdresse,
  rattacher,
  rattacherMessage,
  reglesApplicables,
} from '../supabase/functions/_shared/rattachement'
export type {
  DeclencheurRegle,
  IndicesRattachement,
  NiveauRattachement,
  Rattachement,
  RegleRattachement,
  ReperesRattachement,
} from '../supabase/functions/_shared/rattachement'

// ------------------------------------------------------------
// 1. AppState → repères
// ------------------------------------------------------------

/**
 * Les adresses déclarées et les projets qu'elles servent (§3.7 : « adresse
 * d'un participant déclaré »). Trois gisements, et pas un de plus :
 *
 *   * `Projet.emailMOA` — le maître d'ouvrage, rattaché à SON projet ;
 *   * `Contact.email` avec `Contact.projetsIds` — un contact peut suivre
 *     plusieurs projets, et c'est précisément le cas où la cascade doit
 *     refuser de trancher plutôt que prendre le premier ;
 *   * `MarcheTravaux.contactEmail` — l'interlocuteur d'une entreprise sur
 *     un chantier donné.
 *
 * Les adresses de l'équipe sont exclues : l'agence écrit sur tous ses
 * projets, une adresse interne ne désigne rien.
 */
function participantsDe(state: AppState): ReperesRattachement['participants'] {
  const internes = adressesInternes(state)
  const parAdresse = new Map<string, { projetIds: Set<string>; origine: string }>()

  const ajouter = (brut: string | undefined | null, projetId: string | undefined, origine: string) => {
    const email = normaliserAdresse(brut)
    if (!email || internes.has(email) || !projetId) return
    const courant = parAdresse.get(email)
    if (courant) courant.projetIds.add(projetId)
    else parAdresse.set(email, { projetIds: new Set([projetId]), origine })
  }

  for (const p of state.projets) ajouter(p.emailMOA, p.id, 'La maîtrise d’ouvrage')
  for (const c of state.contacts)
    for (const projetId of c.projetsIds || []) ajouter(c.email, projetId, `Le contact ${c.nom}`)
  for (const m of state.marches) ajouter(m.contactEmail, m.projetId, `Le contact du marché « ${m.lot} »`)

  return [...parAdresse.entries()].map(([email, v]) => ({
    email,
    projetIds: [...v.projetIds],
    origine: v.origine,
  }))
}

/** les adresses de l'agence — elles ne rattachent rien, et surtout aucune
 *  règle ne se mémorise dessus (voir `regleProposee`) */
export function adressesInternes(state: AppState): Set<string> {
  const set = new Set<string>()
  for (const p of state.settings.equipe || []) {
    const email = normaliserAdresse(p.email)
    if (email) set.add(email)
  }
  const surveillee = normaliserAdresse(state.settings.surveillance?.email)
  if (surveillee) set.add(surveillee)
  return set
}

/** l'entreprise canonique et les projets où elle a un marché */
function entreprisesDe(state: AppState): ReperesRattachement['entreprises'] {
  return state.entreprises.map((e) => ({
    id: e.id,
    raisonSociale: e.raisonSociale,
    domaines: e.domaines || [],
    projetIds: [
      ...new Set(
        state.marches
          .filter((m) => m.entrepriseId === e.id || fold(m.entreprise) === fold(e.raisonSociale))
          .map((m) => m.projetId),
      ),
    ],
  }))
}

/** l'état de l'agence, réduit à ce que la cascade a le droit de connaître */
export function reperesDe(state: AppState): ReperesRattachement {
  return {
    projets: state.projets.map((p) => ({
      id: p.id,
      nom: p.nom,
      codeExterne: p.codeExterne,
      adresseProjet: p.adresseProjet,
    })),
    participants: participantsDe(state),
    entreprises: entreprisesDe(state),
    regles: reglesRattachement(state),
  }
}

/** la cascade, appliquée à l'état courant — LE point d'entrée du navigateur */
export function rattacherDepuisEtat(state: AppState, indices: IndicesRattachement): Rattachement {
  return rattacher(reperesDe(state), indices)
}

// ------------------------------------------------------------
// 2. Les règles mémorisées
// ------------------------------------------------------------

/** les règles telles qu'elles sont stockées (y compris inactives) */
export function reglesRattachement(state: AppState): RegleRattachement[] {
  const brut = state.settings.reglesRattachement
  return Array.isArray(brut) ? brut : []
}

/**
 * Ce qu'une correction humaine apprend, ou `null` quand elle n'apprend rien.
 *
 * Trois refus, et chacun a coûté cher ailleurs :
 *   * pas d'adresse exploitable — rien à mémoriser ;
 *   * une adresse de l'agence — l'agence écrit sur tous ses projets ; une
 *     règle dessus rattacherait tout le courrier interne au dernier projet
 *     corrigé, et c'est irrattrapable sans purge manuelle ;
 *   * une adresse déjà couverte par une règle identique — la re-mémoriser
 *     ferait grossir la liste sans rien changer.
 *
 * Le déclencheur est l'ADRESSE, jamais le domaine : un domaine de MOA
 * publique (une mairie, un bailleur) sert des dizaines de projets. La règle
 * par domaine existe dans le modèle et s'applique, mais elle se crée à la
 * main, en connaissance de cause.
 */
export function regleProposee(
  state: AppState,
  adresse: string | null | undefined,
  projetId: string,
  par?: string,
): RegleRattachement | null {
  const email = normaliserAdresse(adresse)
  if (!email || !projetId) return null
  if (adressesInternes(state).has(email)) return null
  const existante = reglesRattachement(state).find(
    (r) => r.declencheur === 'adresse' && r.valeur === email && r.actif,
  )
  if (existante && existante.projetId === projetId) return null
  return {
    id: uid('regle'),
    declencheur: 'adresse',
    valeur: email,
    projetId,
    creeLe: todayISO(),
    ...(par ? { creePar: par } : {}),
    actif: true,
  }
}

/** enregistre la règle dans le document partagé (à appeler dans un `update`) */
export function enregistrerRegle(draft: AppState, regle: RegleRattachement): void {
  draft.settings.reglesRattachement = memoriserRegle(reglesRattachement(draft), regle)
}

/** active / désactive une règle sans la perdre (à appeler dans un `update`) */
export function basculerRegle(draft: AppState, id: string, actif: boolean): void {
  draft.settings.reglesRattachement = reglesRattachement(draft).map((r) =>
    r.id === id ? { ...r, actif } : r,
  )
}

/** supprime une règle (à appeler dans un `update`) */
export function supprimerRegle(draft: AppState, id: string): void {
  draft.settings.reglesRattachement = reglesRattachement(draft).filter((r) => r.id !== id)
}

/** libellé d'une règle, en une phrase lisible */
export function libelleRegle(state: AppState, regle: RegleRattachement): string {
  const projet = state.projets.find((p) => p.id === regle.projetId)
  const cible = projet ? `${projet.id} — ${projet.nom}` : `${regle.projetId} (projet supprimé)`
  return regle.declencheur === 'domaine'
    ? `Tout @${regle.valeur} → ${cible}`
    : `${regle.valeur} → ${cible}`
}

// ------------------------------------------------------------
// 3. La file « à rattacher »
// ------------------------------------------------------------

/** ce qu'une ligne de la file doit savoir dire d'elle-même */
export interface ARattacher {
  /** identifiant de l'objet dans SA mémoire (message, courrier local…) */
  id: string
  /** d'où il vient — deux mémoires coexistent jusqu'à B.15 */
  origine: 'message' | 'courrier'
  expediteur: string
  /** adresse seule, celle sur laquelle une règle se mémorise */
  adresse: string
  objet: string
  /** ISO, ou '' quand la source ne la porte pas */
  date: string
  /** le fil, quand il est connu : corriger un message corrige tout le fil */
  filId?: string
  /** la trace du message d'origine, telle qu'elle est stockée — `gmail:<id>`
   *  pour un courrier capté par l'onglet, du texte libre pour un courrier
   *  importé. `lienGmail` (`src/util.ts`) sait la lire ; l'écran n'a pas à
   *  connaître ces formes (CDC §4.2) */
  source?: string
  proposition: Rattachement
}

/**
 * Les courriers locaux sans projet (`state.courriers`), repassés par la
 * cascade.
 *
 * Cette moitié de la file disparaîtra avec B.15, quand `state.courriers`
 * passera en lecture seule. Jusque-là elle reste alimentée par
 * `src/surveillance.ts`, et l'ignorer viderait la file de la moitié de son
 * contenu sans que rien ne le signale — exactement le défaut que le §3.12
 * demande d'éviter en scindant A.7 et B.15.
 */
export function courriersARattacher(state: AppState): ARattacher[] {
  const reperes = reperesDe(state)
  return state.courriers
    .filter((c) => !c.projetId && c.statut === 'a_traiter')
    .map((c) => ({
      id: c.id,
      origine: 'courrier' as const,
      expediteur: c.de,
      adresse: normaliserAdresse(c.de),
      objet: c.objet,
      date: c.dateReception || '',
      source: c.source,
      proposition: rattacherMessage(reperes, { objet: c.objet, expediteur: c.de }),
    }))
}

/** les projets proposables à la correction — actifs d'abord, mais tous
 *  présents : un mail peut concerner un projet livré (SAV, DOE) */
export function projetsCorrigibles(state: AppState): Projet[] {
  const rang = (p: Projet) => (['Livré', 'Perdu'].includes(p.statut) ? 1 : 0)
  return [...state.projets].sort((a, b) => rang(a) - rang(b) || a.id.localeCompare(b.id))
}

/** le niveau de cascade, dit en une ligne pour l'écran — le libellé vient
 *  du module partagé : deux tables de libellés divergeraient, et c'est
 *  exactement le défaut que ce livrable referme */
export function libelleProposition(r: Rattachement): string {
  if (!r.projetId) {
    return r.candidats.length > 1
      ? `Ambigu — ${r.candidats.join(', ')} conviennent également.`
      : 'Aucun signal — projet à choisir.'
  }
  return r.niveau ? `Proposé par : ${LIBELLES_NIVEAU[r.niveau]}.` : 'Proposé.'
}
