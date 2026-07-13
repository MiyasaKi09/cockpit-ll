// ============================================================
// Imports multi-formats — audit finance F10.
// Banque : CAMT.053, OFX/QFX, QIF et CSV — tous produisent des
// LigneRelevee et passent par preparerImport (idempotence par
// date + montant + libellé, comme le CSV F3).
// Achats : lecture CII ou UBL ligne par ligne (TVA par taux),
// avec conservation du XML source.
// Chorus/PDP : import CSV du cycle de vie, rattaché par numéro
// de facture.
// ============================================================

import { decouperLigneCSV, type LigneRelevee } from './banque'
import { fold, parseNum } from './util'

export type FormatBancaire = 'camt' | 'ofx' | 'qif' | 'csv'

/** devine le format bancaire d'après le contenu (et le nom de fichier) */
export function detecterFormatBancaire(texte: string, nomFichier = ''): FormatBancaire {
  const t = texte.slice(0, 800)
  const nom = nomFichier.toLowerCase()
  if (/<Document[\s>]|urn:iso:std:iso:20022|<BkToCstmrStmt|<Stmt>/.test(t) || nom.endsWith('.xml')) return 'camt'
  if (/OFXHEADER|<OFX>|<STMTTRN>/.test(t) || nom.endsWith('.ofx') || nom.endsWith('.qfx')) return 'ofx'
  if (/^!Type:|^\^$/m.test(t) || nom.endsWith('.qif')) return 'qif'
  return 'csv'
}

function r2(v: number): number {
  return Math.round(v * 100) / 100
}

// ---------- CAMT.053 (ISO 20022 XML) ----------

function texteEnfant(el: Element, nom: string): string | undefined {
  const tous = el.getElementsByTagName('*')
  for (let i = 0; i < tous.length; i++) if (tous[i].localName === nom) return tous[i].textContent?.trim() || undefined
  return undefined
}

export function lireCAMT053(xml: string): LigneRelevee[] {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml')
  } catch {
    return []
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return []
  const entrees: LigneRelevee[] = []
  const tous = doc.getElementsByTagName('*')
  for (let i = 0; i < tous.length; i++) {
    const e = tous[i]
    if (e.localName !== 'Ntry') continue
    const montantBrut = parseNum(texteEnfant(e, 'Amt') || '')
    if (montantBrut == null) continue
    const sens = texteEnfant(e, 'CdtDbtInd') || 'CRDT'
    const montant = sens.startsWith('DBIT') ? -Math.abs(montantBrut) : Math.abs(montantBrut)
    // date de comptabilisation (BookgDt) sinon valeur (ValDt)
    let date: string | undefined
    for (let j = 0; j < e.getElementsByTagName('*').length; j++) {
      const n = e.getElementsByTagName('*')[j]
      if ((n.localName === 'BookgDt' || n.localName === 'ValDt') && !date) {
        const d = texteEnfant(n, 'Dt') || texteEnfant(n, 'DtTm')
        if (d) date = d.slice(0, 10)
      }
    }
    if (!date) continue
    const libelle = (texteEnfant(e, 'Ustrd') || texteEnfant(e, 'AddtlNtryInf') || texteEnfant(e, 'AddtlTxInf') || 'Mouvement').replace(/\s+/g, ' ').trim()
    entrees.push({ date, montant: r2(montant), libelle: libelle.slice(0, 140) })
  }
  return entrees
}

// ---------- OFX / QFX ----------

export function lireOFX(texte: string): LigneRelevee[] {
  const res: LigneRelevee[] = []
  const blocs = texte.split(/<STMTTRN>/i).slice(1)
  for (const bloc of blocs) {
    const bal = (tag: string) => {
      const m = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i').exec(bloc)
      return m ? m[1].trim() : undefined
    }
    const montant = parseNum(bal('TRNAMT') || '')
    const dateBrut = bal('DTPOSTED')
    if (montant == null || montant === 0 || !dateBrut) continue
    const date = `${dateBrut.slice(0, 4)}-${dateBrut.slice(4, 6)}-${dateBrut.slice(6, 8)}`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const libelle = (bal('NAME') || bal('MEMO') || 'Mouvement').replace(/\s+/g, ' ').trim()
    res.push({ date, montant: r2(montant), libelle: libelle.slice(0, 140) })
  }
  return res
}

// ---------- QIF ----------

export function lireQIF(texte: string): LigneRelevee[] {
  const res: LigneRelevee[] = []
  let date = ''
  let montant: number | null = null
  let libelle = ''
  const versISO = (d: string): string | null => {
    const m = /(\d{1,2})[\/.'](\d{1,2})[\/.'](\d{2,4})/.exec(d)
    if (m) {
      const a = m[3].length === 2 ? `20${m[3]}` : m[3]
      return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10)
    return null
  }
  for (const brute of texte.split(/\r?\n/)) {
    const ligne = brute.trim()
    if (ligne.startsWith('!')) continue
    const code = ligne[0]
    const val = ligne.slice(1).trim()
    if (code === 'D') date = versISO(val) || ''
    else if (code === 'T' || code === 'U') montant = parseNum(val)
    else if (code === 'P' || code === 'M') libelle = (libelle ? libelle + ' ' : '') + val
    else if (code === '^') {
      if (date && montant != null && montant !== 0) res.push({ date, montant: r2(montant), libelle: (libelle || 'Mouvement').slice(0, 140) })
      date = ''
      montant = null
      libelle = ''
    }
  }
  return res
}

// ---------- Chorus / PDP : cycle de vie CSV ----------

export interface EvenementCycleVie {
  numeroFacture: string
  statut: 'deposee' | 'rejetee' | 'mise_a_disposition' | 'approuvee' | 'payee'
  date: string
  reference?: string
  motif?: string
}

const MAP_STATUT_CHORUS: { motif: RegExp; statut: EvenementCycleVie['statut'] }[] = [
  { motif: /rejet|refus|rejec/i, statut: 'rejetee' },
  { motif: /pay[ée]|mandat|encaiss|paid/i, statut: 'payee' },
  { motif: /mise\s*[àa]\s*disposition|mad|transmis|available/i, statut: 'mise_a_disposition' },
  { motif: /approuv|valid[ée]|accept/i, statut: 'approuvee' },
  { motif: /d[ée]pos|re[çc]u|d[ée]pot|submitted|integr/i, statut: 'deposee' },
]

/** lit un CSV de cycle de vie Chorus/PDP : colonnes numéro, statut, date, motif */
export function lireCycleVieCSV(texte: string): EvenementCycleVie[] {
  const lignes = texte.split(/\r?\n/).filter((l) => l.trim())
  if (lignes.length === 0) return []
  const sep = [';', '\t', ','].reduce((meilleur, s) => (lignes[0].split(s).length > lignes[0].split(meilleur).length ? s : meilleur))
  const entetes = decouperLigneCSV(lignes[0], sep).map(fold)
  const col = (motifs: string[]) => entetes.findIndex((e) => motifs.some((m) => e.includes(m)))
  const cNum = col(['numero', 'facture', 'invoice', 'piece'])
  const cStatut = col(['statut', 'status', 'etat', 'cycle'])
  const cDate = col(['date', 'maj', 'evenement'])
  const cMotif = col(['motif', 'commentaire', 'raison', 'comment'])
  const aEntete = cNum >= 0 || cStatut >= 0
  const res: EvenementCycleVie[] = []
  for (const brute of aEntete ? lignes.slice(1) : lignes) {
    const c = decouperLigneCSV(brute, sep)
    const numeroFacture = (cNum >= 0 ? c[cNum] : c[0] || '').trim()
    const statutBrut = (cStatut >= 0 ? c[cStatut] : c[1] || '').trim()
    if (!numeroFacture || !statutBrut) continue
    const trouve = MAP_STATUT_CHORUS.find((x) => x.motif.test(statutBrut))
    if (!trouve) continue
    const dateBrut = (cDate >= 0 ? c[cDate] : '').trim()
    const date = /^\d{4}-\d{2}-\d{2}/.test(dateBrut)
      ? dateBrut.slice(0, 10)
      : (() => {
          const m = /(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/.exec(dateBrut)
          return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''
        })()
    res.push({ numeroFacture, statut: trouve.statut, date, reference: undefined, motif: cMotif >= 0 ? c[cMotif]?.trim() || undefined : undefined })
  }
  return res
}
