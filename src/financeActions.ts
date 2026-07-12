// ============================================================
// « À traiter maintenant » — audit finance §3.3 / §5.1 : le badge
// Finance ne compte QUE ce qui demande une décision humaine
// (jamais toutes les données ni les échéances futures), et chaque
// action porte le problème, le montant, la source et un lien.
// ============================================================

import type { AppState } from './types'
import { attendusOuverts } from './achats'
import { controlesCloture } from './comptable'
import { addMonths, fmtDate, fmtMoney, monthKey } from './util'

export interface ActionFinance {
  id: string
  titre: string
  detail: string
  lien: string
  date?: string
  gravite: 1 | 2 | 3
}

/** décisions humaines en attente sur toute la chaîne finance */
export function actionsATraiter(state: AppState, today: string): ActionFinance[] {
  const actions: ActionFinance[] = []

  // factures clients à émettre (échéance passée)
  for (const e of state.echeancesFacturation) {
    if (e.datePrevue > today) continue
    actions.push({
      id: `emettre:${e.id}`,
      titre: `Émettre la facture — ${fmtMoney(e.montantHT)} HT`,
      detail: `${e.projetId} · ${e.libelle} · prévue le ${fmtDate(e.datePrevue)}`,
      lien: `#/facturation/emettre/${e.id}`,
      date: e.datePrevue,
      gravite: 3,
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
    })
  }
  // transmissions rejetées (Chorus/PDP) — action précise avec le motif
  for (const f of state.factures) {
    const derniere = f.transmissions?.[f.transmissions.length - 1]
    if (!derniere || derniere.statut !== 'rejetee') continue
    actions.push({
      id: `rejet:${f.id}`,
      titre: `Facture ${f.numero || f.id} rejetée (${derniere.plateforme})`,
      detail: derniere.motif || 'motif à récupérer sur la plateforme',
      lien: '#/facturation',
      date: derniere.date,
      gravite: 3,
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
      })
    }
  }
  return actions.sort((a, b) => b.gravite - a.gravite || (a.date || '9999').localeCompare(b.date || '9999'))
}

/** badge de la barre latérale — uniquement des décisions humaines */
export function badgeFinance(state: AppState, today: string): number {
  return actionsATraiter(state, today).length
}
