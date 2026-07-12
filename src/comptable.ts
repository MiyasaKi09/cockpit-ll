// ============================================================
// Pont expert-comptable — audit finance F4. Le Cockpit N'EST PAS
// un logiciel comptable : il prépare un paquet d'import propre
// (jamais appelé « FEC » — §11.5), le cabinet tient la comptabilité.
// - profil de mapping configuré une fois avec le cabinet ;
// - checklist de clôture (bloquants / à vérifier, % prêt) ;
// - écritures préparées ÉQUILIBRÉES (contrôle débit = crédit) ;
// - lot versionné + empreinte, pièces marquées exportées ;
// - jamais deux exports de la même pièce sans alerte (V2 + diff).
// ============================================================

import { zipSync, strToU8 } from 'fflate'
import type { AppState, FactureAchat, Facture, LotComptable, NoteFrais, Paiement, ProfilComptable } from './types'
import { ttcFacture } from './facture'
import { attendusOuverts } from './achats'
import { fold, monthKey } from './util'

export const PROFIL_DEFAUT: ProfilComptable = {
  separateur: ';',
  formatDate: 'JJ/MM/AAAA',
  journaux: { ventes: 'VE', achats: 'AC', banque: 'BQ', od: 'OD' },
  comptes: {
    produits: '706000',
    clients: '411000',
    fournisseurs: '401000',
    tvaCollectee: '445710',
    tvaDeductible: '445660',
    banque: '512000',
    notesFrais: '421000',
    chargesDefaut: '604000',
  },
  analytique: true,
  prefixeClient: '411',
  prefixeFournisseur: '401',
}

// ---------- pièces d'une période ----------

export interface PiecesPeriode {
  ventes: Facture[]
  achats: FactureAchat[]
  frais: NoteFrais[]
  paiements: Paiement[]
}

export function piecesPeriode(state: AppState, periode: string): PiecesPeriode {
  return {
    ventes: state.factures.filter((f) => monthKey(f.emission) === periode),
    achats: state.facturesAchat.filter((f) => f.statut === 'validee' && monthKey(f.dateFacture) === periode),
    frais: state.notesFrais.filter((n) => monthKey(n.date) === periode),
    paiements: state.paiements.filter((p) => monthKey(p.date) === periode),
  }
}

// ---------- checklist de clôture (audit §5.6 / §8.2) ----------

export interface ControleCloture {
  libelle: string
  niveau: 'bloquant' | 'a_verifier' | 'ok'
  detail?: string
  lien?: string
}

export function controlesCloture(state: AppState, periode: string, today: string): {
  controles: ControleCloture[]
  bloquants: number
  aVerifier: number
  pctPret: number
} {
  const p = piecesPeriode(state, periode)
  const controles: ControleCloture[] = []
  const finPeriode = `${periode}-31`

  // ventes complètes : échéances de la période non émises
  const echeancesEchues = state.echeancesFacturation.filter((e) => monthKey(e.datePrevue) === periode)
  controles.push(
    echeancesEchues.length === 0
      ? { libelle: 'Ventes complètes', niveau: 'ok' }
      : {
          libelle: 'Ventes complètes',
          niveau: 'a_verifier',
          detail: `${echeancesEchues.length} échéance(s) de la période non émise(s)`,
          lien: '#/facturation',
        },
  )
  // achats complets : propositions à valider + attendus ouverts échus
  const aValider = state.facturesAchat.filter((f) => f.statut === 'a_valider' && monthKey(f.dateFacture) === periode)
  controles.push(
    aValider.length === 0
      ? { libelle: 'Achats validés', niveau: 'ok' }
      : { libelle: 'Achats validés', niveau: 'bloquant', detail: `${aValider.length} facture(s) fournisseur à valider`, lien: '#/finance/achats' },
  )
  const attendus = attendusOuverts(state, today).filter((a) => (a.periode || monthKey(a.date)) <= periode)
  controles.push(
    attendus.length === 0
      ? { libelle: 'Rien d’attendu manquant', niveau: 'ok' }
      : { libelle: 'Attendus manquants', niveau: 'a_verifier', detail: `${attendus.length} attendu(s) sans pièce ni exception`, lien: '#/finance/achats' },
  )
  // notes de frais validées
  const fraisOuverts = p.frais.filter((n) => n.statut === 'a_rembourser' && n.moyen === 'perso')
  controles.push(
    fraisOuverts.length === 0
      ? { libelle: 'Notes de frais traitées', niveau: 'ok' }
      : { libelle: 'Notes de frais traitées', niveau: 'a_verifier', detail: `${fraisOuverts.length} à rembourser`, lien: '#/finance/achats' },
  )
  // banque rapprochée
  const nonRapprochees = state.transactionsBancaires.filter((t) => monthKey(t.date) === periode && !t.rapprochement)
  controles.push(
    nonRapprochees.length === 0
      ? { libelle: 'Banque rapprochée', niveau: 'ok' }
      : { libelle: 'Banque rapprochée', niveau: 'a_verifier', detail: `${nonRapprochees.length} mouvement(s) non rapproché(s)`, lien: '#/finance/banque' },
  )
  // pièces présentes
  const sansPiece = p.achats.filter((f) => !f.documentId)
  controles.push(
    sansPiece.length === 0
      ? { libelle: 'Pièces jointes présentes', niveau: 'ok' }
      : { libelle: 'Pièces jointes présentes', niveau: 'a_verifier', detail: `${sansPiece.length} achat(s) sans justificatif attaché`, lien: '#/finance/achats' },
  )
  // ventes migrées à contrôler
  const aControler = p.ventes.filter((f) => f.historiqueAControler)
  controles.push(
    aControler.length === 0
      ? { libelle: 'Factures historiques rapprochées', niveau: 'ok' }
      : { libelle: 'Factures historiques rapprochées', niveau: 'bloquant', detail: `${aControler.length} facture(s) migrée(s) « à contrôler »`, lien: '#/facturation' },
  )
  // écritures équilibrées (construites équilibrées — on vérifie quand même)
  const ecritures = genererEcritures(state, periode, state.settings.profilComptable || PROFIL_DEFAUT)
  const debit = Math.round(ecritures.reduce((s, e) => s + e.debit, 0) * 100) / 100
  const credit = Math.round(ecritures.reduce((s, e) => s + e.credit, 0) * 100) / 100
  controles.push(
    Math.abs(debit - credit) < 0.02
      ? { libelle: 'Écritures équilibrées', niveau: 'ok', detail: `${debit.toFixed(2)} € au débit et au crédit` }
      : { libelle: 'Écritures équilibrées', niveau: 'bloquant', detail: `débit ${debit.toFixed(2)} € ≠ crédit ${credit.toFixed(2)} €` },
  )
  // période déjà exportée ?
  const lots = state.lotsComptables.filter((l) => l.periode === periode)
  controles.push(
    lots.length === 0
      ? { libelle: 'Période non exportée', niveau: 'ok' }
      : {
          libelle: 'Période déjà exportée',
          niveau: 'a_verifier',
          detail: `${lots.length} lot(s) — un nouvel export créera la version ${Math.max(...lots.map((l) => l.version)) + 1} avec son diff`,
        },
  )
  // période future ?
  if (periode > monthKey(today)) controles.push({ libelle: 'Période non échue', niveau: 'a_verifier', detail: 'le mois n’est pas terminé' })

  const bloquants = controles.filter((c) => c.niveau === 'bloquant').length
  const aVerifier = controles.filter((c) => c.niveau === 'a_verifier').length
  const pctPret = Math.round((controles.filter((c) => c.niveau === 'ok').length / controles.length) * 100)
  return { controles, bloquants, aVerifier, pctPret }
}

// ---------- écritures préparées ----------

export interface EcriturePreparee {
  journal: string
  datePiece: string
  dateEcheance?: string
  numeroPiece: string
  compteGeneral: string
  compteTiers?: string
  libelle: string
  debit: number
  credit: number
  tauxTVA?: number
  projet?: string
  phase?: string
  documentId?: string
  sourceId: string
}

function r2(v: number): number {
  return Math.round(v * 100) / 100
}

/** compte tiers : préfixe du profil + nom replié en majuscules (règle simple,
 *  corrigeable par le retour du cabinet) */
export function compteTiers(prefixe: string | undefined, nom: string): string {
  return `${prefixe || ''}${fold(nom).replace(/[^a-z0-9]/g, '').toUpperCase().slice(0, 8)}`
}

/** écritures ventes + achats + frais + banque d'une période — TOUJOURS
 *  équilibrées par construction (l'arrondi TVA est porté par la ligne TVA) */
export function genererEcritures(state: AppState, periode: string, profil: ProfilComptable): EcriturePreparee[] {
  const p = piecesPeriode(state, periode)
  const e: EcriturePreparee[] = []
  const parId = new Map(state.factures.map((f) => [f.id, f]))

  for (const f of p.ventes) {
    const numero = f.numero || f.id
    const ht = f.figee?.totalHT ?? f.montantHT
    const ttc = ttcFacture(f)
    const tva = r2(ttc - ht)
    const tiers = compteTiers(profil.prefixeClient, f.figee?.clientNom || f.projetId)
    const base = {
      journal: profil.journaux.ventes,
      datePiece: f.emission,
      dateEcheance: undefined as string | undefined,
      numeroPiece: numero,
      documentId: f.figee ? undefined : undefined,
      sourceId: f.id,
    }
    // client au débit du TTC (un avoir, négatif, s'inverse naturellement)
    e.push({ ...base, compteGeneral: profil.comptes.clients, compteTiers: tiers, libelle: `${f.type === 'avoir' ? 'Avoir' : 'Facture'} ${numero} — ${f.libelle}`, debit: ttc > 0 ? r2(ttc) : 0, credit: ttc > 0 ? 0 : r2(-ttc), projet: f.projetId, phase: f.phase })
    e.push({ ...base, compteGeneral: profil.comptes.produits, libelle: `${numero} — honoraires HT`, debit: ht > 0 ? 0 : r2(-ht), credit: ht > 0 ? r2(ht) : 0, projet: f.projetId, phase: f.phase })
    if (Math.abs(tva) > 0.001)
      e.push({ ...base, compteGeneral: profil.comptes.tvaCollectee, libelle: `${numero} — TVA collectée`, debit: tva > 0 ? 0 : r2(-tva), credit: tva > 0 ? r2(tva) : 0 })
  }

  for (const f of p.achats) {
    const tva = r2(f.montantTVA ?? f.montantTTC - f.montantHT)
    const tiers = compteTiers(profil.prefixeFournisseur, f.fournisseur)
    const base = { journal: profil.journaux.achats, datePiece: f.dateFacture, dateEcheance: f.dateEcheance || undefined, numeroPiece: f.numeroFournisseur || f.id, documentId: f.documentId || undefined, sourceId: f.id }
    for (const v of f.ventilations) {
      e.push({ ...base, compteGeneral: v.compteComptable || profil.comptes.chargesDefaut, libelle: `${f.fournisseur} — ${v.categorie}`, debit: r2(v.montantHT), credit: 0, projet: v.projetId || undefined, phase: v.phase || undefined })
    }
    if (Math.abs(tva) > 0.001) e.push({ ...base, compteGeneral: profil.comptes.tvaDeductible, libelle: `${f.fournisseur} — TVA déductible`, debit: r2(tva), credit: 0 })
    e.push({ ...base, compteGeneral: profil.comptes.fournisseurs, compteTiers: tiers, libelle: `${f.fournisseur}${f.numeroFournisseur ? ` — ${f.numeroFournisseur}` : ''}`, debit: 0, credit: r2(f.montantHT + tva) })
  }

  for (const n of p.frais) {
    const base = { journal: profil.journaux.od, datePiece: n.date, numeroPiece: n.id, documentId: n.documentId || undefined, sourceId: n.id }
    const tva = n.tauxTVA != null ? r2(n.montantTTC - n.montantTTC / (1 + n.tauxTVA)) : 0
    const ht = r2(n.montantTTC - tva)
    e.push({ ...base, compteGeneral: profil.comptes.chargesDefaut, libelle: `NDF ${n.personne} — ${n.libelle}`, debit: ht, credit: 0, projet: n.projetId || undefined, phase: n.phase || undefined })
    if (tva > 0.001) e.push({ ...base, compteGeneral: profil.comptes.tvaDeductible, libelle: `NDF ${n.personne} — TVA`, debit: tva, credit: 0 })
    e.push({ ...base, compteGeneral: profil.comptes.notesFrais, compteTiers: compteTiers('421', n.personne), libelle: `NDF ${n.personne} — à rembourser`, debit: 0, credit: n.montantTTC })
  }

  for (const pay of p.paiements) {
    for (const a of pay.affectations) {
      const f = parId.get(a.factureId)
      const numero = f ? f.numero || f.id : a.factureId
      const tiers = compteTiers(profil.prefixeClient, f?.figee?.clientNom || f?.projetId || 'client')
      const base = { journal: profil.journaux.banque, datePiece: pay.date, numeroPiece: pay.id, sourceId: pay.id }
      e.push({ ...base, compteGeneral: profil.comptes.banque, libelle: `Règlement ${numero}${pay.moyen ? ` (${pay.moyen})` : ''}`, debit: r2(a.montant), credit: 0 })
      e.push({ ...base, compteGeneral: profil.comptes.clients, compteTiers: tiers, libelle: `Règlement ${numero}`, debit: 0, credit: r2(a.montant) })
    }
  }
  return e
}

// ---------- CSV / manifeste / zip ----------

function formaterDate(iso: string | undefined, format: ProfilComptable['formatDate']): string {
  if (!iso) return ''
  return format === 'JJ/MM/AAAA' ? iso.split('-').reverse().join('/') : iso
}

function champ(v: string | number | undefined, sep: string): string {
  const s = v == null ? '' : String(v)
  return s.includes(sep) || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvEcritures(ecritures: EcriturePreparee[], profil: ProfilComptable): string {
  const sep = profil.separateur === 'tab' ? '\t' : profil.separateur
  const entete = [
    'journal', 'date_piece', 'date_echeance', 'numero_piece', 'compte_general', 'compte_tiers',
    'libelle', 'debit', 'credit', 'taux_tva', 'projet', 'phase', 'document_id', 'source_id',
  ].join(sep)
  const lignes = ecritures.map((e) =>
    [
      e.journal, formaterDate(e.datePiece, profil.formatDate), formaterDate(e.dateEcheance, profil.formatDate),
      champ(e.numeroPiece, sep), e.compteGeneral, e.compteTiers || '', champ(e.libelle, sep),
      e.debit ? e.debit.toFixed(2).replace('.', ',') : '', e.credit ? e.credit.toFixed(2).replace('.', ',') : '',
      e.tauxTVA != null ? String(e.tauxTVA) : '',
      profil.analytique ? e.projet || '' : '', profil.analytique ? e.phase || '' : '',
      e.documentId || '', e.sourceId,
    ].join(sep),
  )
  return [entete, ...lignes].join('\r\n')
}

export function csvTiers(state: AppState, periode: string, profil: ProfilComptable): string {
  const sep = profil.separateur === 'tab' ? '\t' : profil.separateur
  const p = piecesPeriode(state, periode)
  const tiers = new Map<string, { compte: string; nom: string; type: string; siret?: string }>()
  for (const f of p.ventes) {
    const nom = f.figee?.clientNom || f.projetId
    tiers.set(compteTiers(profil.prefixeClient, nom), { compte: compteTiers(profil.prefixeClient, nom), nom, type: 'client', siret: f.figee?.clientSiret })
  }
  for (const f of p.achats) {
    const e = f.entrepriseId ? state.entreprises.find((x) => x.id === f.entrepriseId) : undefined
    tiers.set(compteTiers(profil.prefixeFournisseur, f.fournisseur), { compte: compteTiers(profil.prefixeFournisseur, f.fournisseur), nom: f.fournisseur, type: 'fournisseur', siret: e?.siret })
  }
  const entete = ['compte', 'nom', 'type', 'siret'].join(sep)
  return [entete, ...[...tiers.values()].map((t) => [t.compte, champ(t.nom, sep), t.type, t.siret || ''].join(sep))].join('\r\n')
}

/** empreinte SHA-256 (hex) d'un contenu binaire */
export async function empreinteOctets(octets: Uint8Array): Promise<string> {
  try {
    const h = await crypto.subtle.digest('SHA-256', octets.slice().buffer as ArrayBuffer)
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
  } catch {
    return ''
  }
}

export interface PaquetExport {
  nomFichier: string
  octets: Uint8Array
  empreinte: string
  ecritures: EcriturePreparee[]
}

/** construit le paquet zip complet d'une période (audit §5.6) */
export async function construirePaquet(
  state: AppState,
  periode: string,
  version: number,
  today: string,
): Promise<PaquetExport> {
  const profil = state.settings.profilComptable || PROFIL_DEFAUT
  const p = piecesPeriode(state, periode)
  const ecritures = genererEcritures(state, periode, profil)
  const { controles, bloquants, aVerifier, pctPret } = controlesCloture(state, periode, today)

  const parJournal = (j: string) => ecritures.filter((x) => x.journal === j)
  const manifeste = {
    application: 'Cockpit L&L',
    avertissement:
      "Paquet d'import préparé pour le logiciel du cabinet — ce n'est PAS un FEC (le FEC est produit par le logiciel comptable).",
    periode,
    version,
    genereLe: today,
    profil: { logiciel: profil.logiciel || null, journaux: profil.journaux, formatDate: profil.formatDate, separateur: profil.separateur },
    contenus: {
      ventes: p.ventes.length,
      achats: p.achats.length,
      notesDeFrais: p.frais.length,
      paiements: p.paiements.length,
      ecritures: ecritures.length,
    },
    totaux: {
      debit: Math.round(ecritures.reduce((s, x) => s + x.debit, 0) * 100) / 100,
      credit: Math.round(ecritures.reduce((s, x) => s + x.credit, 0) * 100) / 100,
    },
  }
  const controlesMd = [
    `# Contrôles de clôture — ${periode} (v${version})`,
    '',
    `État : ${pctPret} % prêt · ${bloquants} bloquant(s) · ${aVerifier} à vérifier`,
    '',
    ...controles.map((c) => `- [${c.niveau === 'ok' ? 'x' : ' '}] ${c.libelle}${c.detail ? ` — ${c.detail}` : ''} (${c.niveau})`),
    '',
    'Généré par Cockpit L&L — les montants proviennent des pièces opérationnelles, chaque ligne cite sa source (source_id).',
  ].join('\n')

  const fichiers: Record<string, Uint8Array> = {
    'manifeste.json': strToU8(JSON.stringify(manifeste, null, 2)),
    'controles.md': strToU8(controlesMd),
    'tiers.csv': strToU8(csvTiers(state, periode, profil)),
    'ventes.csv': strToU8(csvEcritures(parJournal(profil.journaux.ventes), profil)),
    'achats.csv': strToU8(csvEcritures(parJournal(profil.journaux.achats), profil)),
    'notes-de-frais.csv': strToU8(csvEcritures(parJournal(profil.journaux.od), profil)),
    'paiements.csv': strToU8(csvEcritures(parJournal(profil.journaux.banque), profil)),
  }
  const octets = zipSync(fichiers, { level: 6 })
  const empreinte = await empreinteOctets(octets)
  const nomFichier = `${periode}_Cockpit-LL_Comptabilite_v${version}.zip`
  return { nomFichier, octets, empreinte, ecritures }
}

export function telechargerOctets(nomFichier: string, octets: Uint8Array): void {
  const blob = new Blob([octets.slice().buffer as ArrayBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ---------- diff V1/V2 & pièces déjà exportées ----------

export interface DiffLots {
  ajoutes: string[]
  retires: string[]
  communs: number
}

export function diffLots(precedent: LotComptable, ids: { factureIds: string[]; achatIds: string[]; fraisIds: string[]; paiementIds: string[] }): DiffLots {
  const avant = new Set([...precedent.factureIds, ...precedent.achatIds, ...precedent.fraisIds, ...precedent.paiementIds])
  const apres = new Set([...ids.factureIds, ...ids.achatIds, ...ids.fraisIds, ...ids.paiementIds])
  return {
    ajoutes: [...apres].filter((x) => !avant.has(x)),
    retires: [...avant].filter((x) => !apres.has(x)),
    communs: [...apres].filter((x) => avant.has(x)).length,
  }
}

/** pièces du lot candidates déjà présentes dans un lot ANTÉRIEUR (toute
 *  période confondue) — jamais réexportées sans alerte (recette F4) */
export function dejaExportees(state: AppState, ids: string[], horsLotPeriode?: string): string[] {
  const exportees = new Set<string>()
  for (const l of state.lotsComptables) {
    if (horsLotPeriode && l.periode === horsLotPeriode) continue
    for (const id of [...l.factureIds, ...l.achatIds, ...l.fraisIds, ...l.paiementIds]) exportees.add(id)
  }
  return ids.filter((id) => exportees.has(id))
}

/** import du retour du cabinet : CSV « source_id;statut;motif » (ou 2 colonnes) */
export function lireRetourCabinet(texte: string): { pieceId: string; statut: 'acceptee' | 'rejetee'; motif?: string }[] {
  const res: { pieceId: string; statut: 'acceptee' | 'rejetee'; motif?: string }[] = []
  for (const ligne of texte.split(/\r?\n/)) {
    if (!ligne.trim()) continue
    const sep = ligne.includes(';') ? ';' : ligne.includes('\t') ? '\t' : ','
    const c = decouper(ligne, sep)
    if (c.length < 2) continue
    const statutBrut = fold(c[1])
    if (/source_id|piece/.test(fold(c[0]))) continue // en-tête
    const statut = /rejet|refus|erreur/.test(statutBrut) ? 'rejetee' : /accept|ok|import|comptabilis/.test(statutBrut) ? 'acceptee' : null
    if (!statut) continue
    res.push({ pieceId: c[0].trim(), statut, motif: c[2]?.trim() || undefined })
  }
  return res
}

function decouper(ligne: string, sep: string): string[] {
  return ligne.split(sep).map((x) => x.replace(/^"|"$/g, '').trim())
}
