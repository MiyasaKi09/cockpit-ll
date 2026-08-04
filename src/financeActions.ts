// ============================================================
// « À traiter maintenant » — audit finance §3.3 / §5.1 : le badge
// Finance ne compte QUE ce qui demande une décision humaine
// (jamais toutes les données ni les échéances futures), et chaque
// action porte le problème, le montant, la source et un lien.
// ============================================================

import type { AppState, EcheanceFacturation } from './types'
import { attendusOuverts } from './achats'
import { controlesCloture } from './comptable'
import { derniereTransmission, soldeFacture } from './facture'
import { retardFacture } from './derive'
import { addMonths, fmtDate, fmtMoney, monthKey } from './util'

/** famille d'une action — l'accueil SÉLECTIONNE dans cette liste au lieu
 *  de refaire la boucle. Le préfixe de `id` portait déjà l'information,
 *  mais sous forme de chaîne à découper : un champ typé se relit, se
 *  rétrécit (`a.kind === 'facture_achat'`) et ne se désynchronise pas.
 *  Champ OPTIONNEL : les appelants existants (badge Finance, écran
 *  Finance) ne changent pas d'une ligne. */
export type KindActionFinance =
  | 'emettre_facture'
  | 'facture_achat'
  | 'attendu'
  | 'encaissement'
  | 'rejet_transmission'
  | 'cloture'

export interface ActionFinance {
  id: string
  titre: string
  detail: string
  lien: string
  date?: string
  gravite: 1 | 2 | 3
  kind?: KindActionFinance
}

/** décisions humaines en attente sur toute la chaîne finance */
export function actionsATraiter(state: AppState, today: string): ActionFinance[] {
  const actions: ActionFinance[] = []

  // factures clients à émettre — la MÊME liste que la tuile « À facturer »
  // de L'essentiel (echeancesDues) : une échéance due ici et absente là-bas
  // ferait deux vérités pour la même question
  for (const e of echeancesDues(state, today)) {
    actions.push({
      id: `emettre:${e.id}`,
      titre: `Émettre la facture — ${fmtMoney(e.montantHT)} HT`,
      detail: `${e.projetId} · ${e.libelle} · prévue le ${fmtDate(e.datePrevue)}`,
      lien: `#/facturation/emettre/${e.id}`,
      date: e.datePrevue,
      gravite: 3,
      kind: 'emettre_facture',
    })
  }
  // factures fournisseurs à valider
  for (const f of state.facturesAchat) {
    if (f.statut !== 'a_valider') continue
    actions.push({
      id: `achat:${f.id}`,
      titre: `Valider la facture fournisseur ${f.fournisseur} — ${fmtMoney(f.montantTTC)} TTC`,
      detail: `reçue le ${fmtDate(f.dateFacture)}${f.source !== 'manuel' ? ` · source ${f.source}` : ''}`,
      lien: '#/finance/achats',
      date: f.dateFacture,
      gravite: 2,
      kind: 'facture_achat',
    })
  }
  // attendus : facture récurrente absente, justificatif bancaire, montant anormal
  for (const a of attendusOuverts(state, today)) {
    actions.push({
      id: `attendu:${a.cle}`,
      titre: a.libelle,
      detail: a.detail,
      lien: a.type === 'justificatif_banque' ? '#/finance/banque' : '#/finance/achats',
      date: a.date,
      gravite: 2,
      kind: 'attendu',
    })
  }
  // encaissements non rapprochés (les débits sont déjà des attendus)
  for (const t of state.transactionsBancaires) {
    if (t.montant <= 0 || t.rapprochement) continue
    actions.push({
      id: `credit:${t.id}`,
      titre: `Rattacher l'encaissement de ${fmtMoney(t.montant)}`,
      detail: `${t.libelle.slice(0, 70)} · ${fmtDate(t.date)}`,
      lien: '#/finance/banque',
      date: t.date,
      gravite: 2,
      kind: 'encaissement',
    })
  }
  // transmissions rejetées (Chorus/PDP) — action précise avec le motif.
  // La plus récente PAR DATE (5.16) : le dernier élément du tableau peut
  // être un événement ancien ajouté par un import CSV rejoué.
  for (const f of state.factures) {
    const derniere = derniereTransmission(f)
    if (!derniere || derniere.statut !== 'rejetee') continue
    actions.push({
      id: `rejet:${f.id}`,
      titre: `Facture ${f.numero || f.id} rejetée (${derniere.plateforme})`,
      detail: derniere.motif || 'motif à récupérer sur la plateforme',
      lien: '#/facturation',
      date: derniere.date,
      gravite: 3,
      kind: 'rejet_transmission',
    })
  }
  // clôture du mois précédent bloquée
  const moisPrecedent = addMonths(monthKey(today), -1)
  const dejaClos = state.lotsComptables.some((l) => l.periode === moisPrecedent)
  if (!dejaClos) {
    const { bloquants } = controlesCloture(state, moisPrecedent, today)
    if (bloquants > 0) {
      actions.push({
        id: `cloture:${moisPrecedent}`,
        titre: `${bloquants} blocage(s) empêchent la clôture de ${moisPrecedent}`,
        detail: 'checklist de clôture dans Finance → Comptable',
        lien: '#/finance/comptable',
        gravite: 2,
        kind: 'cloture',
      })
    }
  }
  return actions.sort((a, b) => b.gravite - a.gravite || (a.date || '9999').localeCompare(b.date || '9999'))
}

/** badge de la barre latérale — uniquement des décisions humaines */
export function badgeFinance(state: AppState, today: string): number {
  return actionsATraiter(state, today).length
}

// ==================================================================
// Les chiffres de « L'essentiel » — l'écran d'entrée de la Finance
// (commande du 04/08 : « clair et simple visuellement, précis dans
// ce que ça montre »). La précision tient à UNE règle : chaque tuile
// lit un sélecteur de ce fichier, et l'onglet où l'on agit applique
// la même définition. Deux chiffres différents pour « à encaisser »
// selon l'écran détruiraient la confiance dans les deux.
// `scripts/test-finance-essentiel.cjs` verrouille cette règle.
// ==================================================================

const centimes = (v: number) => Math.round(v * 100) / 100

export interface AEncaisser {
  /** Σ des soldes TTC des factures émises non soldées (avoirs déduits) */
  totalTTC: number
  nb: number
  /** part de ce total dont l'échéance contractuelle est dépassée */
  retardTTC: number
  nbRetard: number
}

/** Ce que les clients doivent — factures ÉMISES non soldées. Les pièces
 *  « prévues » sont EXCLUES : tant que la facture n'existe pas légalement,
 *  rien n'est dû (elles relèvent de « à facturer » ci-dessous). Le retard
 *  vient de `retardFacture` — la même autorité que les relances de Ventes. */
export function aEncaisser(state: AppState, today: string): AEncaisser {
  let totalTTC = 0
  let retardTTC = 0
  let nb = 0
  let nbRetard = 0
  for (const f of state.factures) {
    if (f.type === 'avoir' || f.statut === 'prevue') continue
    const solde = soldeFacture(state, f)
    if (solde <= 0.01) continue
    totalTTC += solde
    nb++
    if (retardFacture(state, f, today) > 0) {
      retardTTC += solde
      nbRetard++
    }
  }
  return { totalTTC: centimes(totalTTC), nb, retardTTC: centimes(retardTTC), nbRetard }
}

/** Échéances de facturation DUES (date prévue atteinte) — SEULE définition
 *  du « à facturer » : `actionsATraiter` (« Émettre la facture ») et la
 *  tuile de L'essentiel itèrent toutes deux sur CETTE liste. */
export function echeancesDues(state: AppState, today: string): EcheanceFacturation[] {
  return state.echeancesFacturation.filter((e) => e.datePrevue <= today)
}

export interface AFacturer {
  /** Σ HT des échéances dues (les échéances n'ont pas de numéro légal : HT prévu) */
  totalHT: number
  nb: number
}

export function aFacturer(state: AppState, today: string): AFacturer {
  const dues = echeancesDues(state, today)
  return { totalHT: centimes(dues.reduce((s, e) => s + e.montantHT, 0)), nb: dues.length }
}

export interface AchatsAPayer {
  /** Σ TTC des factures fournisseurs validées non payées */
  totalTTC: number
  nb: number
  /** part de ce total dont l'échéance (à défaut la date de facture) est passée */
  retardTTC: number
  nbRetard: number
  /** boîte d'arrivée : reçues, pas encore validées — pas encore une dette sûre */
  aValiderTTC: number
  nbAValider: number
}

/** Ce que l'agence doit aux fournisseurs — même définition que l'écran
 *  Achats & frais (validée et non payée ; l'échéancier de décaissement) :
 *  le non-validé est montré À PART, une pièce non contrôlée n'est pas
 *  encore une dette certaine. */
export function achatsAPayer(state: AppState, today: string): AchatsAPayer {
  let totalTTC = 0
  let nb = 0
  let retardTTC = 0
  let nbRetard = 0
  let aValiderTTC = 0
  let nbAValider = 0
  for (const f of state.facturesAchat) {
    if (f.statut === 'a_valider') {
      aValiderTTC += f.montantTTC
      nbAValider++
      continue
    }
    if (f.statut !== 'validee' || f.payeLe) continue
    totalTTC += f.montantTTC
    nb++
    if ((f.dateEcheance || f.dateFacture) < today) {
      retardTTC += f.montantTTC
      nbRetard++
    }
  }
  return {
    totalTTC: centimes(totalTTC),
    nb,
    retardTTC: centimes(retardTTC),
    nbRetard,
    aValiderTTC: centimes(aValiderTTC),
    nbAValider,
  }
}
