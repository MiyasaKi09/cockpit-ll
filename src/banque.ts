// ============================================================
// Banque — audit finance F3 : imports de relevés IDEMPOTENTS
// (réimporter le même fichier n'ajoute aucune ligne) et
// rapprochement PROPOSÉ, jamais appliqué sans validation.
// ============================================================

import type { AppState, Facture, MappingBancaire, TransactionBancaire } from './types'
import { regleSurFacture, soldeFacture, ttcFacture } from './facture'
import { fold, parseNum } from './util'

// ---------- lecture du CSV bancaire ----------

/** découpe une ligne CSV en respectant les guillemets */
export function decouperLigneCSV(ligne: string, separateur: string): string[] {
  const cellules: string[] = []
  let cur = ''
  let dansGuillemets = false
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i]
    if (c === '"') {
      if (dansGuillemets && ligne[i + 1] === '"') {
        cur += '"'
        i++
      } else dansGuillemets = !dansGuillemets
    } else if (c === separateur && !dansGuillemets) {
      cellules.push(cur)
      cur = ''
    } else cur += c
  }
  cellules.push(cur)
  return cellules.map((x) => x.trim())
}

/** devine séparateur + colonnes depuis l'en-tête (proposé, ajustable) */
export function devinerMapping(texte: string): MappingBancaire {
  const lignes = texte.split(/\r?\n/).filter((l) => l.trim())
  const premiere = lignes[0] || ''
  const separateur = [';', '\t', ','].reduce((meilleur, sep) =>
    premiere.split(sep).length > premiere.split(meilleur).length ? sep : meilleur,
  )
  const entetes = decouperLigneCSV(premiere, separateur).map(fold)
  const chercher = (motifs: string[]) => {
    const i = entetes.findIndex((e) => motifs.some((m) => e.includes(m)))
    return i === -1 ? null : i
  }
  const colDate = chercher(['date operation', 'date de l', 'date']) ?? 0
  const colLibelle = chercher(['libelle', 'label', 'designation', 'nature']) ?? 1
  const colMontant = chercher(['montant', 'amount'])
  const colDebit = chercher(['debit'])
  const colCredit = chercher(['credit'])
  // date FR ou ISO ? on sonde la première ligne de données
  const donnee = lignes[1] ? decouperLigneCSV(lignes[1], separateur) : []
  const exemple = donnee[colDate] || ''
  const formatDate: MappingBancaire['formatDate'] = /^\d{4}-/.test(exemple) ? 'AAAA-MM-JJ' : 'JJ/MM/AAAA'
  const entete = entetes.some((e) => /date|libelle|montant|debit|credit/.test(e))
  return {
    separateur,
    entete,
    formatDate,
    colDate,
    colLibelle,
    colMontant: colDebit != null && colCredit != null ? null : colMontant ?? 2,
    colDebit: colDebit ?? null,
    colCredit: colCredit ?? null,
  }
}

function versISO(s: string, format: MappingBancaire['formatDate']): string | null {
  const t = s.trim()
  if (format === 'AAAA-MM-JJ') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null
  }
  const m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/.exec(t)
  if (!m) return null
  const annee = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${annee}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

export interface LigneRelevee {
  date: string
  montant: number
  libelle: string
}

/** parse le relevé avec le mapping — les lignes illisibles sont comptées */
export function lireReleve(texte: string, mapping: MappingBancaire): { lignes: LigneRelevee[]; ignorées: number } {
  const brutes = texte.split(/\r?\n/).filter((l) => l.trim())
  const donnees = mapping.entete ? brutes.slice(1) : brutes
  const lignes: LigneRelevee[] = []
  let ignorées = 0
  for (const brute of donnees) {
    const c = decouperLigneCSV(brute, mapping.separateur)
    const date = versISO(c[mapping.colDate] || '', mapping.formatDate)
    let montant: number | null = null
    if (mapping.colMontant != null) montant = parseNum(c[mapping.colMontant] || '')
    else {
      const debit = parseNum(c[mapping.colDebit ?? -1] || '')
      const credit = parseNum(c[mapping.colCredit ?? -1] || '')
      if (credit != null && credit !== 0) montant = Math.abs(credit)
      else if (debit != null && debit !== 0) montant = -Math.abs(debit)
    }
    const libelle = (c[mapping.colLibelle] || '').replace(/\s+/g, ' ').trim()
    if (!date || montant === null || montant === 0 || !libelle) {
      ignorées++
      continue
    }
    lignes.push({ date, montant: Math.round(montant * 100) / 100, libelle })
  }
  return { lignes, ignorées }
}

// ---------- idempotence ----------

/** identifiant STABLE d'une ligne : date + montant + libellé replié.
 *  Deux lignes identiques le même jour reçoivent un suffixe d'ordre —
 *  le réimport du même relevé retombe sur les mêmes identifiants. */
export function idsTransactions(lignes: LigneRelevee[]): string[] {
  const compteur = new Map<string, number>()
  return lignes.map((l) => {
    const base = `tx:${l.date}:${l.montant.toFixed(2)}:${fold(l.libelle).slice(0, 48)}`
    const n = (compteur.get(base) || 0) + 1
    compteur.set(base, n)
    return n === 1 ? base : `${base}#${n}`
  })
}

/** prépare l'import : sépare nouvelles lignes et doublons déjà connus */
export function preparerImport(
  state: AppState,
  lignes: LigneRelevee[],
  importId: string,
): { nouvelles: TransactionBancaire[]; doublons: number } {
  const connues = new Set(state.transactionsBancaires.map((t) => t.id))
  const ids = idsTransactions(lignes)
  const nouvelles: TransactionBancaire[] = []
  let doublons = 0
  lignes.forEach((l, i) => {
    if (connues.has(ids[i])) {
      doublons++
      return
    }
    nouvelles.push({ id: ids[i], date: l.date, montant: l.montant, libelle: l.libelle, importId, rapprochement: null })
  })
  return { nouvelles, doublons }
}

// ---------- solde ----------

/** solde bancaire courant : solde du dernier relevé + mouvements postérieurs */
export function soldeBancaire(state: AppState): { solde: number; date: string } | null {
  const imports = state.importsBancaires.filter((i) => i.soldeFinal != null && i.dateSolde)
  if (imports.length === 0) return null
  const dernier = [...imports].sort((a, b) => a.dateSolde!.localeCompare(b.dateSolde!)).pop()!
  const apres = state.transactionsBancaires
    .filter((t) => t.date > dernier.dateSolde!)
    .reduce((s, t) => s + t.montant, 0)
  return { solde: Math.round((dernier.soldeFinal! + apres) * 100) / 100, date: dernier.dateSolde! }
}

// ---------- rapprochement (proposé, jamais silencieux) ----------

export interface SuggestionCredit {
  factures: Facture[]
  montants: number[] // affectation proposée par facture
  raisons: string[]
  confiance: number // 0..1 — au-delà d'un seuil on PROPOSE en premier, jamais on n'applique
}

/** suggestions pour un CRÉDIT : factures clients dont le solde correspond
 *  (montant exact, somme de plusieurs, référence ou nom dans le libellé) */
export function suggestionsPourCredit(state: AppState, t: TransactionBancaire): SuggestionCredit[] {
  if (t.montant <= 0) return []
  const libelle = fold(t.libelle)
  const ouvertes = state.factures.filter(
    (f) => f.type !== 'avoir' && f.statut !== 'prevue' && soldeFacture(state, f) > 0.01,
  )
  const res: SuggestionCredit[] = []
  // 1) une facture au solde exact
  for (const f of ouvertes) {
    const solde = soldeFacture(state, f)
    const raisons: string[] = []
    let confiance = 0
    if (Math.abs(solde - t.montant) < 0.01) {
      raisons.push(`solde exact ${solde.toFixed(2)} €`)
      confiance += 0.5
    } else if (Math.abs(ttcFacture(f) - t.montant) < 0.01 && regleSurFacture(state, f.id) === 0) {
      raisons.push(`TTC exact ${t.montant.toFixed(2)} €`)
      confiance += 0.5
    }
    const numero = f.numero || f.id
    if (numero && libelle.includes(fold(numero))) {
      raisons.push(`référence ${numero} dans le libellé`)
      confiance += 0.4
    }
    const client = f.figee?.clientNom || state.projets.find((p) => p.id === f.projetId)?.moa
    if (client && libelle.includes(fold(client).slice(0, 8))) {
      raisons.push(`« ${client} » dans le libellé`)
      confiance += 0.25
    }
    if (confiance >= 0.4)
      res.push({ factures: [f], montants: [Math.min(t.montant, solde)], raisons, confiance: Math.min(1, confiance) })
  }
  // 2) paiement GROUPÉ : une paire de factures du même projet/client dont la
  //    somme des soldes correspond exactement (recette F3)
  for (let i = 0; i < ouvertes.length; i++) {
    for (let j = i + 1; j < ouvertes.length; j++) {
      const a = ouvertes[i]
      const b = ouvertes[j]
      if (a.projetId !== b.projetId) continue
      const sa = soldeFacture(state, a)
      const sb = soldeFacture(state, b)
      if (Math.abs(sa + sb - t.montant) < 0.01) {
        res.push({
          factures: [a, b],
          montants: [sa, sb],
          raisons: [`somme des soldes ${a.numero || a.id} + ${b.numero || b.id} = ${t.montant.toFixed(2)} €`],
          confiance: 0.6,
        })
      }
    }
  }
  return res.sort((x, y) => y.confiance - x.confiance).slice(0, 3)
}

/** écart entre le solde bancaire importé et le solde manuel (transition §5.5) */
export function ecartSoldeManuel(state: AppState): number | null {
  const bancaire = soldeBancaire(state)
  if (!bancaire || state.settings.tresorerieDispo == null) return null
  return Math.round((bancaire.solde - state.settings.tresorerieDispo) * 100) / 100
}
