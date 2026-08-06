// ============================================================
// Cycle de vie Chorus Pro — le versant navigateur de la fonction Edge
// `chorus-sync` (Chorus Pro via la passerelle PISTE, LECTURE SEULE).
//
// DEUX MOITIÉS, ET UNE RAISON DE LES SÉPARER
// -------------------------------------------
// 1. LA LOGIQUE PURE — traduire un code de statut du portail, en tirer un
//    événement de transmission, et RATTACHER par numéro de facture. Aucun
//    réseau, aucune horloge : `aujourdhui` est un paramètre. `src/alerts.ts`
//    l'importe pour nommer un rejet avec le mot exact du portail, et le fil
//    d'urgences doit rester calculable hors ligne, sur un état chargé du
//    localStorage.
// 2. LE TRANSPORT — les appels à la fonction Edge. Ils reçoivent le client
//    Supabase EN PARAMÈTRE et ne vont pas le chercher : ce fichier reste ainsi
//    chargeable sans la pile réseau, ce qui est la condition pour que le
//    point 1 soit vrai.
//
// AUCUN SECRET NE PASSE ICI. `client_id`, `client_secret`, le login et le mot
// de passe du compte technique vivent dans les secrets de la fonction Edge
// (`Deno.env.get`) ; le navigateur ne connaît ni jeton PISTE, ni identifiant
// de structure. Le compte technique hérite des droits du gestionnaire
// principal sur TOUTES ses structures : c'est le secret le plus sensible de ce
// branchement, et il ne doit jamais approcher un bundle `VITE_`.
//
// LE RATTACHEMENT SE FAIT PAR NUMÉRO — LE MÊME QUE L'IMPORT CSV
// --------------------------------------------------------------
// `rattacherCycleVieChorus` applique EXACTEMENT la règle de l'import CSV du
// cycle de vie (Connecteurs) : la clé est `fold(numero || id)`, et un
// événement déjà présent (même statut, même date) n'est pas réécrit. Ce n'est
// pas un second mécanisme, c'est le même, écrit une fois : deux règles de
// rattachement diraient deux choses de la même facture le jour où l'une
// tolérerait un espace de plus.
//
// ET UNE FACTURE INCONNUE NE S'INVENTE PAS. Une pièce vue sur le portail dont
// le numéro ne correspond à aucune facture du Cockpit n'est JAMAIS rattachée
// « au plus proche » : elle est signalée telle quelle. Rapprocher au plus
// proche écrirait un rejet sur la facture du voisin — et personne ne le
// verrait, parce que l'écran serait plein.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EvenementTransmission, Facture, FactureChorusInconnue } from './types'
import { fold } from './util'

// ------------------------------------------------------------------
// Ce que la fonction Edge renvoie (aucun secret, aucun identifiant tiers)
// ------------------------------------------------------------------

export type EnvironnementChorus = 'qualification' | 'production'

/** une facture du portail, telle que Chorus l'a rendue — rien n'est traduit
 *  côté serveur : la traduction est une règle métier, elle vit ici */
export interface FactureChorusBrute {
  numero: string
  idFacture: string | null
  /** `REJETEE`, `MISE_EN_PAIEMENT`… — le code du portail, tel quel */
  statutPortail: string
  dateStatut: string | null
  destinataire: string | null
  montantTTC: number | null
  /** `null` veut dire « le portail n'a pas rendu de motif », jamais « aucun » */
  motif: string | null
  historique: { code: string; date: string | null }[]
}

export interface StatutChorus {
  /** les quatre secrets sont-ils posés sur la fonction Edge ? */
  configure: boolean
  /** les NOMS des secrets absents — jamais la moindre valeur */
  manquants: string[]
  environnement: EnvironnementChorus
  environnementLibelle: string
  derniere: {
    le: string
    ok: boolean | null
    resultat: string | null
    environnement: string
    nbFactures: number | null
    nbRattachees: number | null
    nbInconnues: number | null
  } | null
}

export interface ResultatSyncChorus {
  environnement: EnvironnementChorus
  environnementLibelle: string
  fenetre: { debut: string; fin: string }
  factures: FactureChorusBrute[]
  /** ce que la fonction n'a PAS su lire, nommé — une liste vide et une liste
   *  illisible se ressemblent trop pour qu'on laisse le silence trancher */
  diagnostic: string | null
  journalId: string | null
}

// ==================================================================
// 1. LOGIQUE PURE
// ==================================================================

// ------------------------------------------------------------------
// Les statuts du portail — UNE table, et le mot exact conservé
// ------------------------------------------------------------------

/**
 * Les codes de statut de Chorus Pro, en français.
 *
 * Extraits du dossier de spécifications externes (V3.2). La liste PEUT avoir
 * bougé depuis : un code absent d'ici n'est pas une erreur, il s'affiche tel
 * quel et ne s'écrit sur aucune pièce (voir `lireCodeStatutChorus`).
 */
export const LIBELLES_STATUT_CHORUS: Record<string, string> = {
  DEPOSEE: 'déposée',
  MISE_A_DISPOSITION: 'mise à disposition',
  MISE_A_DISPOSITION_COMPTABLE: 'mise à disposition du comptable',
  MISE_A_DISPOSITION_MOE: 'mise à disposition de la MOE',
  A_ASSOCIER_FOURNISSEUR: 'à associer (fournisseur)',
  A_ASSOCIER_MOA: 'à associer (MOA)',
  A_ASSOCIER_MOE: 'à associer (MOE)',
  SERVICE_FAIT: 'service fait',
  VALIDEE: 'validée',
  MANDATEE: 'mandatée',
  MISE_EN_PAIEMENT: 'mise en paiement',
  COMPTABILISEE: 'comptabilisée',
  REJETEE: 'rejetée',
  SUSPENDUE: 'suspendue',
  A_RECYCLER: 'à recycler',
  A_COMPLETER: 'à compléter',
}

/** le mot du portail, en français quand on le connaît, tel quel sinon —
 *  un code inconnu s'affiche, il ne se remplace pas par « autre » */
export function libelleCodeChorus(code: string | null | undefined): string {
  if (!code) return 'statut inconnu'
  return LIBELLES_STATUT_CHORUS[code] || code
}

/** les quatre plateformes d'`EvenementTransmission`, en français. Un seul
 *  endroit les nomme : l'écran affichait le code brut (« chorus »), l'alerte
 *  aurait écrit autre chose, et la même transmission se serait appelée de deux
 *  façons selon l'endroit où on la lit. */
export function libellePlateformeTransmission(plateforme: EvenementTransmission['plateforme']): string {
  if (plateforme === 'chorus') return 'Chorus Pro'
  if (plateforme === 'pdp') return 'plateforme agréée'
  if (plateforme === 'email') return 'e-mail'
  return 'autre plateforme'
}

// Les libellés de la liste FERMÉE (`deposee`, `rejetee`, …) ne vivent PAS ici :
// ils sont dans `src/modules/Facturation.tsx`, qui les possédait déjà et que
// `scripts/test-transmissions.cjs` vérifie statut par statut. Deux
// vocabulaires, deux propriétaires : celui du portail (ci-dessus) et celui de
// la liste fermée (là-bas). Les recopier ici en ferait diverger un des deux au
// premier ajustement.

export interface LectureCodeChorus {
  /** le code brut, tel que le portail l'a écrit */
  code: string
  /**
   * Projection sur la liste FERMÉE d'`EvenementTransmission` — ou `null`.
   *
   * `null` veut dire « le Cockpit ne sait pas traduire ce code » : aucun
   * événement n'est alors écrit sur la pièce, et la synchronisation le DIT.
   * Projeter un code inconnu sur « déposée » écrirait une histoire qui n'a pas
   * eu lieu, et le badge afficherait une facture tranquille.
   */
  statut: EvenementTransmission['statut'] | null
  /** la facture ne sera pas payée tant que l'agence n'agit pas */
  exigeUneAction: boolean
  libelle: string
}

/**
 * QUATRE CODES SE PROJETTENT SUR « rejetée », ET C'EST DÉLIBÉRÉ.
 *
 * `REJETEE`, `SUSPENDUE`, `A_RECYCLER` et `A_COMPLETER` sont quatre voies non
 * nominales distinctes chez Chorus, mais elles ont pour l'agence une seule et
 * même conséquence : la facture est revenue, elle ne sera pas payée, et il
 * faut la corriger. La liste `EvenementTransmission['statut']` est FERMÉE (cinq
 * valeurs, `src/types.ts`) et pilote déjà trois choses — le badge rouge de
 * l'écran Ventes, l'action « à traiter » de `financeActions`, et l'alerte du
 * fil d'urgences. Les projeter ailleurs les rendrait muettes.
 *
 * Ce qui serait malhonnête, c'est d'AFFICHER « rejetée » quand le portail a dit
 * « suspendue ». D'où `EvenementTransmission.statutPortail` : le code exact
 * voyage avec l'événement, et c'est LUI que l'écran et l'alerte prononcent. La
 * liste fermée décide du comportement, le mot du portail décide des mots.
 */
const PROJECTION: Record<string, { statut: EvenementTransmission['statut']; action?: true }> = {
  DEPOSEE: { statut: 'deposee' },
  A_ASSOCIER_FOURNISSEUR: { statut: 'deposee' },
  A_ASSOCIER_MOA: { statut: 'deposee' },
  A_ASSOCIER_MOE: { statut: 'deposee' },
  MISE_A_DISPOSITION: { statut: 'mise_a_disposition' },
  MISE_A_DISPOSITION_COMPTABLE: { statut: 'mise_a_disposition' },
  MISE_A_DISPOSITION_MOE: { statut: 'mise_a_disposition' },
  SERVICE_FAIT: { statut: 'approuvee' },
  VALIDEE: { statut: 'approuvee' },
  MANDATEE: { statut: 'approuvee' },
  MISE_EN_PAIEMENT: { statut: 'payee' },
  COMPTABILISEE: { statut: 'payee' },
  REJETEE: { statut: 'rejetee', action: true },
  SUSPENDUE: { statut: 'rejetee', action: true },
  A_RECYCLER: { statut: 'rejetee', action: true },
  A_COMPLETER: { statut: 'rejetee', action: true },
}

/** LA lecture d'un code de statut Chorus. Pure, et seule de son espèce : le
 *  serveur transporte, il ne traduit pas. */
export function lireCodeStatutChorus(code: string | null | undefined): LectureCodeChorus {
  const propre = (code || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  const projete = PROJECTION[propre]
  return {
    code: propre,
    statut: projete ? projete.statut : null,
    exigeUneAction: Boolean(projete?.action),
    libelle: libelleCodeChorus(propre),
  }
}

/**
 * « Mise en paiement » ou « comptabilisée » : le payeur public a lancé le
 * virement.
 *
 * Ce n'est PAS un encaissement, et la nuance est tout l'intérêt du signal : le
 * solde d'une facture se dérive des paiements enregistrés, jamais d'un statut
 * de portail. Ce que dit ce prédicat, c'est « l'argent est parti, le
 * rapprochement bancaire n'a pas encore eu lieu ».
 *
 * Les deux portails agréés comptent (Chorus Pro et une PDP) ; un envoi par
 * e-mail, non. Un « payée » saisi à la main sur une transmission e-mail veut
 * dire ce que la personne a voulu dire, et sûrement pas qu'un ordonnateur
 * public a mandaté.
 */
export function estMiseEnPaiement(evenement: EvenementTransmission | null | undefined): boolean {
  if (!evenement) return false
  if (evenement.plateforme !== 'chorus' && evenement.plateforme !== 'pdp') return false
  return evenement.statut === 'payee'
}

// ------------------------------------------------------------------
// Rattachement par NUMÉRO — la règle de l'import CSV, écrite une fois
// ------------------------------------------------------------------

/** la clé de rattachement : le numéro légal, le numéro interne en repli,
 *  normalisé par `fold` (accents et casse) — exactement la clé de l'import
 *  CSV du cycle de vie */
export function cleNumeroFacture(f: Pick<Facture, 'id' | 'numero'>): string {
  return fold(f.numero || f.id)
}

/**
 * Cet événement est-il déjà consigné sur la pièce ?
 *
 * Même prédicat que l'import CSV : `statut` + `date`. Volontairement PAS
 * `statutPortail` — une facture dont le CSV a consigné le rejet sans code
 * portail, puis que la synchronisation revoit avec `REJETEE`, ne doit pas
 * produire une seconde ligne pour le même fait. La synchronisation est
 * idempotente : la relancer trois fois n'écrit rien de plus.
 */
export function evenementDejaConnu(
  transmissions: EvenementTransmission[] | undefined,
  evenement: EvenementTransmission,
): boolean {
  return (transmissions || []).some(
    (t) => t.plateforme === evenement.plateforme && t.statut === evenement.statut && t.date === evenement.date,
  )
}

/** l'événement de transmission d'une facture du portail, ou `null` quand son
 *  code de statut n'est pas traduisible */
export function evenementDepuisChorus(f: FactureChorusBrute): EvenementTransmission | null {
  const lecture = lireCodeStatutChorus(f.statutPortail)
  if (!lecture.statut) return null
  const date = f.dateStatut || derniereDateHistorique(f) || ''
  return {
    date,
    plateforme: 'chorus',
    statut: lecture.statut,
    statutPortail: lecture.code,
    reference: f.idFacture || undefined,
    motif: f.motif || undefined,
  }
}

function derniereDateHistorique(f: FactureChorusBrute): string | null {
  let derniere: string | null = null
  for (const ligne of f.historique || []) {
    if (ligne.date && (!derniere || ligne.date > derniere)) derniere = ligne.date
  }
  return derniere
}

/** un rattachement PROPOSÉ par la synchronisation — l'écran l'applique en un
 *  geste, et le geste laisse un « Annuler » */
export interface RattachementChorus {
  factureId: string
  numero: string
  evenement: EvenementTransmission
}

export interface ResultatRattachementChorus {
  /** événements nouveaux, prêts à être posés sur leur facture */
  ajouts: RattachementChorus[]
  /** événements déjà consignés — la synchronisation est idempotente */
  dejaConnus: number
  /** factures du portail sans correspondance : SIGNALÉES, jamais rattachées */
  inconnues: FactureChorusInconnue[]
  /** factures dont le code de statut n'est pas traduisible : rien n'est écrit
   *  sur la pièce, et l'écran nomme le code */
  nonTraduits: { numero: string; statutPortail: string }[]
}

/**
 * Le rattachement complet d'une synchronisation. Pur : `aujourdhui` en
 * paramètre, aucune écriture — c'est l'écran qui mute, en un seul `update`.
 *
 * Rien n'est écrit ici sur les MONTANTS, le STATUT de paiement ou le NUMÉRO
 * d'une facture. La synchronisation rapatrie un statut de portail et rien
 * d'autre : elle ne ré-émet pas, ne corrige pas, n'envoie pas (§15).
 */
export function rattacherCycleVieChorus(
  factures: Facture[],
  facturesChorus: FactureChorusBrute[],
  aujourdhui: string,
): ResultatRattachementChorus {
  const parNumero = new Map<string, Facture>()
  for (const f of Array.isArray(factures) ? factures : []) {
    const cle = cleNumeroFacture(f)
    if (cle && !parNumero.has(cle)) parNumero.set(cle, f)
  }

  const ajouts: RattachementChorus[] = []
  const inconnues: FactureChorusInconnue[] = []
  const nonTraduits: { numero: string; statutPortail: string }[] = []
  let dejaConnus = 0

  for (const chorus of Array.isArray(facturesChorus) ? facturesChorus : []) {
    if (!chorus || !chorus.numero) continue
    const facture = parNumero.get(fold(chorus.numero))
    if (!facture) {
      // Pas de rapprochement approximatif : une facture du portail sans
      // correspondance est SIGNALÉE. Un rattachement faux se propage à toute
      // la pièce et ne se voit jamais ; un rattachement absent coûte un clic.
      inconnues.push({
        numero: chorus.numero,
        idFacture: chorus.idFacture,
        statutPortail: lireCodeStatutChorus(chorus.statutPortail).code,
        dateStatut: chorus.dateStatut,
        destinataire: chorus.destinataire,
        montantTTC: chorus.montantTTC,
        motif: chorus.motif,
        vueLe: aujourdhui,
      })
      continue
    }
    const evenement = evenementDepuisChorus(chorus)
    if (!evenement) {
      nonTraduits.push({ numero: chorus.numero, statutPortail: chorus.statutPortail })
      continue
    }
    if (evenementDejaConnu(facture.transmissions, evenement)) {
      dejaConnus++
      continue
    }
    ajouts.push({ factureId: facture.id, numero: chorus.numero, evenement })
  }

  return { ajouts, dejaConnus, inconnues, nonTraduits }
}

/** la phrase du toast — assemblée une fois, pour que l'écran et le journal
 *  serveur racontent la même synchronisation */
export function resumeSynchronisationChorus(r: ResultatRattachementChorus): string {
  const morceaux = [`${r.ajouts.length} statut(s) rattaché(s) par numéro`]
  if (r.dejaConnus > 0) morceaux.push(`${r.dejaConnus} déjà connu(s)`)
  if (r.inconnues.length > 0) morceaux.push(`${r.inconnues.length} facture(s) du portail sans correspondance`)
  if (r.nonTraduits.length > 0) {
    const codes = [...new Set(r.nonTraduits.map((x) => x.statutPortail))].join(', ')
    morceaux.push(`${r.nonTraduits.length} statut(s) non reconnu(s) (${codes})`)
  }
  return `${morceaux.join(', ')}.`
}

/**
 * Fusion de la liste des factures « inconnues ».
 *
 * Une facture signalée qui reste inconnue à la synchronisation suivante se met
 * à jour (son statut a pu bouger) ; celle qui a disparu du portail — ou qui a
 * trouvé sa facture entre-temps — sort de la liste. Les numéros que la
 * synchronisation n'a PAS revus (hors fenêtre) sont conservés : les effacer
 * ferait disparaître un signalement parce qu'on a réduit la fenêtre.
 */
export function fusionnerInconnues(
  anciennes: FactureChorusInconnue[] | undefined,
  vues: FactureChorusInconnue[],
  numerosRattaches: string[],
): FactureChorusInconnue[] {
  const rattaches = new Set(numerosRattaches.map((n) => fold(n)))
  const parNumero = new Map<string, FactureChorusInconnue>()
  for (const x of Array.isArray(anciennes) ? anciennes : []) {
    if (!x || !x.numero || rattaches.has(fold(x.numero))) continue
    parNumero.set(fold(x.numero), x)
  }
  for (const x of vues) parNumero.set(fold(x.numero), x)
  return [...parNumero.values()].sort((a, b) => (b.dateStatut || '').localeCompare(a.dateStatut || '') || a.numero.localeCompare(b.numero))
}

// ==================================================================
// 2. TRANSPORT — le client Supabase est PASSÉ, jamais importé
// ==================================================================

/** Message d'erreur LISIBLE : sans cela, une fonction qui répond 502 avec une
 *  phrase en français fait afficher « Edge Function returned a non-2xx status
 *  code », et on cherche la panne partout sauf là où elle est. */
async function messageDeLaFonction(erreur: unknown, defaut: string): Promise<string> {
  const contexte = (erreur as { context?: { json?: () => Promise<unknown> } } | null)?.context
  if (contexte && typeof contexte.json === 'function') {
    try {
      const corps = (await contexte.json()) as { erreur?: string } | null
      if (corps && typeof corps.erreur === 'string' && corps.erreur) return corps.erreur
    } catch {
      /* le corps n'est pas du JSON : le message par défaut reste plus utile */
    }
  }
  return erreur instanceof Error && erreur.message ? erreur.message : defaut
}

async function appeler<T>(sb: SupabaseClient, corps: Record<string, unknown>, defaut: string): Promise<T> {
  const { data, error } = await sb.functions.invoke('chorus-sync', { method: 'POST', body: corps })
  if (error) throw new Error(await messageDeLaFonction(error, defaut))
  return data as T
}

/** configuration et dernière synchronisation, sans aucun secret */
export function lireStatutChorusPro(sb: SupabaseClient): Promise<StatutChorus> {
  return appeler<StatutChorus>(sb, { action: 'statut' }, 'Statut Chorus Pro illisible.')
}

/** rapatrie les factures émises et leur statut courant sur une fenêtre de
 *  dépôt (le portail limite l'historique : une fenêtre large coûte des pages,
 *  pas de la précision) */
export function synchroniserChorus(sb: SupabaseClient, jours = 120): Promise<ResultatSyncChorus> {
  return appeler<ResultatSyncChorus>(sb, { action: 'synchroniser', jours }, 'Synchronisation Chorus Pro impossible.')
}

/** dit au serveur ce qui est RÉELLEMENT entré au Cockpit — « Chorus a
 *  répondu » et « le Cockpit a rattaché » ne sont pas la même chose */
export function confirmerSynchronisationChorus(
  sb: SupabaseClient,
  journalId: string,
  resultat: string,
  rattachees: number,
  inconnues: number,
): Promise<{ ok: boolean }> {
  return appeler(
    sb,
    { action: 'confirmer', journalId, resultat, rattachees, inconnues },
    'Confirmation impossible.',
  )
}
