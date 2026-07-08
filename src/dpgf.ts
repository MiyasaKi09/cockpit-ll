// ============================================================
// DPGF — les prix du DCE, compris par le site sans API :
// lecture des décompositions de prix (Excel via xlsx, PDF via
// l'extraction ligne à ligne de cctp.ts, texte brut), détection
// déterministe des colonnes (désignation, unité, quantité, PU,
// total) et des lots. Les montants alimentent la vue chiffrée
// des lots et le planning travaux. En secours, un Projet Claude
// structure un document atypique (contrat JSON ci-dessous) —
// toujours relu avant import.
// ============================================================

import type { ElementCCTP, LigneDPGF, Projet } from './types'
import { RE_LOT } from './cctp'
import { extraireJSON } from './importRoutines'
import { fold, uid } from './util'

export interface LigneAnalyse {
  article?: string
  designation: string
  unite?: string
  quantite?: number | null
  prixUnitaireHT?: number | null
  totalHT?: number | null
}

export interface DpgfAnalyse {
  numero: string
  intitule: string
  totalHT?: number | null
  lignes: LigneAnalyse[]
}

// ---------- nombres au format français ----------

/** '1 812,50', '1.812,50', 420000, '420 000 €' → nombre (null si illisible) */
export function nombreFr(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const t = v
    .replace(/[€\s  ]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '') // points de milliers
    .replace(',', '.')
  if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ---------- analyse d'un classeur Excel (le format DPGF courant) ----------

const RE_COL_DESIGNATION = /d[ée]signation|libell[ée]|d[ée]nomination|description|nature\s+des\s+ouvrages/i
const RE_COL_ARTICLE = /^(n[°ºo]?\.?|art(icle)?\.?|rep[èe]re|rep\.?|code|poste|r[ée]f\.?)$/i
const RE_COL_UNITE = /^(u|un|unit[ée]s?)\.?$/i
const RE_COL_QUANTITE = /qt[ée]s?|quantit[ée]s?|^qte$/i
const RE_COL_PU = /p\.?\s*u\.?|prix\s+unit/i
const RE_COL_TOTAL = /p\.?\s*t\.?|total|montant/i
const RE_LIGNE_TOTAL = /^(sous[- ]?)?total|^montant\s+(total|ht)|r[ée]capitulatif/i

function texteCellule(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

/** repère la ligne d'en-têtes et l'affectation des colonnes d'une feuille */
function detecterColonnes(rows: unknown[][]): {
  ligneEntete: number
  colArticle: number
  colDesignation: number
  colUnite: number
  colQuantite: number
  colPU: number
  colTotal: number
} | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r] || []
    const colDesignation = row.findIndex((c) => RE_COL_DESIGNATION.test(texteCellule(c)))
    if (colDesignation < 0) continue
    let colArticle = row.findIndex((c) => RE_COL_ARTICLE.test(texteCellule(c)))
    const colUnite = row.findIndex((c) => RE_COL_UNITE.test(texteCellule(c)))
    const colQuantite = row.findIndex((c) => RE_COL_QUANTITE.test(texteCellule(c)))
    const colPU = row.findIndex((c) => RE_COL_PU.test(texteCellule(c)))
    // « total » : préférer la colonne qui mentionne HT, sinon la dernière qui matche
    let colTotal = -1
    row.forEach((c, i) => {
      const t = texteCellule(c)
      if (i !== colPU && RE_COL_TOTAL.test(t)) {
        if (colTotal < 0 || /ht/i.test(t)) colTotal = i
      }
    })
    // il faut au moins la désignation et une colonne de montant pour parler de DPGF
    if (colPU < 0 && colTotal < 0) continue
    if (colArticle < 0 && colDesignation > 0) colArticle = 0
    return { ligneEntete: r, colArticle, colDesignation, colUnite, colQuantite, colPU, colTotal }
  }
  return null
}

/** retire l'éventuel préfixe « DPGF — » avant la détection d'en-tête de lot */
function sansPrefixeDpgf(s: string): string {
  return s.trim().replace(/^D\.?P\.?G\.?F\.?\s*[-–—:]?\s*/i, '')
}

/** identité du lot d'une feuille : « Lot 02 — Gros œuvre » dans le nom de
 *  feuille ou les premières cellules ; sinon le nom de feuille tel quel.
 *  Un en-tête complet (numéro + intitulé) gagne toujours sur un « LOT 02 » seul. */
function identiteLot(nomFeuille: string, rows: unknown[][], nomFichier?: string): { numero: string; intitule: string } {
  const candidats = [
    nomFeuille,
    ...rows.slice(0, 12).flatMap((row) => (row || []).map(texteCellule)).filter(Boolean),
    nomFichier || '',
  ]
  for (const c of candidats) {
    const m = RE_LOT.exec(sansPrefixeDpgf(c))
    if (m) {
      return { numero: m[1].padStart(2, '0') + (m[2] || '').toUpperCase(), intitule: m[3].replace(/\s+/g, ' ').trim() }
    }
  }
  for (const c of candidats) {
    // variante sans intitulé : « LOT 02 » seul
    const seul = /^lot\s*(?:n\s*[°ºo]\s*)?(\d{1,2})\s*$/i.exec(sansPrefixeDpgf(c))
    if (seul) return { numero: seul[1].padStart(2, '0'), intitule: nomFeuille }
  }
  const generique = /^(feuil|sheet|dpgf)/i.test(nomFeuille)
  const intitule = generique
    ? (nomFichier || 'DPGF importée').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
    : nomFeuille
  return { numero: '', intitule }
}

/**
 * Analyse déterministe d'un classeur Excel de DPGF : une feuille = un lot
 * (ou plusieurs feuilles pour un DCE complet). Colonnes détectées sur la
 * ligne d'en-têtes, lignes « total » captées comme contrôle de cohérence.
 */
export async function analyserDpgfXlsx(fichier: File): Promise<DpgfAnalyse[]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await fichier.arrayBuffer())
  const lots: DpgfAnalyse[] = []

  for (const nomFeuille of wb.SheetNames) {
    const ws = wb.Sheets[nomFeuille]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }) as unknown[][]
    const cols = detecterColonnes(rows)
    if (!cols) continue

    const lignes: LigneAnalyse[] = []
    let totalHT: number | null = null
    for (let r = cols.ligneEntete + 1; r < rows.length; r++) {
      const row = rows[r] || []
      const designation = texteCellule(row[cols.colDesignation])
      const total = cols.colTotal >= 0 ? nombreFr(row[cols.colTotal]) : null
      if (!designation) continue
      if (RE_LIGNE_TOTAL.test(designation)) {
        // ligne de total : on garde le plus grand montant rencontré (total général)
        if (total !== null && (totalHT === null || total > totalHT)) totalHT = total
        continue
      }
      const quantite = cols.colQuantite >= 0 ? nombreFr(row[cols.colQuantite]) : null
      const pu = cols.colPU >= 0 ? nombreFr(row[cols.colPU]) : null
      // un titre de chapitre n'a ni quantité, ni PU, ni total : on ne le chiffre pas
      if (quantite === null && pu === null && total === null) continue
      const article = cols.colArticle >= 0 ? texteCellule(row[cols.colArticle]) : ''
      const unite = cols.colUnite >= 0 ? texteCellule(row[cols.colUnite]) : ''
      lignes.push({
        article: article || undefined,
        designation: designation.replace(/\s+/g, ' '),
        unite: unite || undefined,
        quantite,
        prixUnitaireHT: pu,
        totalHT: total ?? (quantite !== null && pu !== null ? Math.round(quantite * pu * 100) / 100 : null),
      })
    }
    if (lignes.length === 0) continue
    const { numero, intitule } = identiteLot(nomFeuille, rows, fichier.name)
    lots.push({ numero, intitule, totalHT, lignes })
  }
  return lots
}

// ---------- analyse d'un texte (PDF extrait ligne à ligne, texte collé) ----------

const UNITES = 'm[23²³]?|ml|ens(?:emble)?|forf(?:ait)?|ff|u|kg|t|l|h|j|pce|paire|ml\\.'
const NOMBRE = String.raw`(?:\d{1,3}(?:[\s  ]\d{3})+|\d+)(?:[.,]\d+)?`

const RE_LIGNE_TEXTE = new RegExp(
  String.raw`^(?:(\d{1,2}(?:\.\d{1,3}){0,4})[).\s]+)?` + // article éventuel
    String.raw`(.+?)\s+` + // désignation
    String.raw`(?:(${UNITES})\s+)?` + // unité éventuelle
    String.raw`(${NOMBRE})(?:\s+(${NOMBRE}))?(?:\s+(${NOMBRE}))?\s*€?\s*$`, // 1 à 3 nombres
  'i',
)

/**
 * Analyse déterministe d'une DPGF au format texte (PDF extrait) : lignes se
 * terminant par 1 à 3 nombres (quantité · PU · total, ou PU · total, ou
 * total seul), découpées par lots quand des en-têtes « LOT n° » existent.
 */
export function analyserDpgfTexte(texte: string, nomFichier?: string): DpgfAnalyse[] {
  const lots: DpgfAnalyse[] = []
  let courant: DpgfAnalyse | null = null

  const ouvrirLot = (numero: string, intitule: string): DpgfAnalyse => {
    const existant = lots.find((l) => l.numero === numero && fold(l.intitule) === fold(intitule))
    if (existant) return existant
    const nouveau: DpgfAnalyse = { numero, intitule, totalHT: null, lignes: [] }
    lots.push(nouveau)
    return nouveau
  }

  for (const brute of texte.split('\n')) {
    const ligne = brute.replace(/[ \t]+/g, ' ').trim()
    if (!ligne) continue

    const enTete = RE_LOT.exec(sansPrefixeDpgf(ligne))
    if (enTete && !/\d[.,]\d{2}\s*€?\s*$/.test(ligne)) {
      courant = ouvrirLot(
        enTete[1].padStart(2, '0') + (enTete[2] || '').toUpperCase(),
        enTete[3].replace(/\s+/g, ' ').trim(),
      )
      continue
    }

    const m = RE_LIGNE_TEXTE.exec(ligne)
    if (!m) continue
    const [, article, designationBrute, unite, n1, n2, n3] = m
    const designation = designationBrute.replace(/[.·…]{3,}.*$/, '').trim()
    if (designation.length < 3 || !/[A-Za-zÀ-ÿ]{3}/.test(designation)) continue

    const nombres = [n1, n2, n3].filter((x): x is string => Boolean(x)).map((x) => nombreFr(x))
    if (RE_LIGNE_TOTAL.test(designation)) {
      const total = nombres[nombres.length - 1]
      if (courant && total !== null && (courant.totalHT == null || total > courant.totalHT)) courant.totalHT = total
      continue
    }
    if (!courant) {
      const intitule = (nomFichier || 'DPGF importée').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
      courant = ouvrirLot('', intitule)
    }
    const ligneDpgf: LigneAnalyse = { designation, article: article || undefined, unite: unite || undefined }
    if (nombres.length === 3) {
      ligneDpgf.quantite = nombres[0]
      ligneDpgf.prixUnitaireHT = nombres[1]
      ligneDpgf.totalHT = nombres[2]
    } else if (nombres.length === 2) {
      // ambiguïté des milliers : « 48 620,00 29 760,00 » peut être
      // PU=48 620 / total=29 760… ou qté=48 × PU=620 = 29 760.
      // Le produit tranche : si qté × PU retombe sur le total, on scinde.
      const scinde = /^(\d{1,3})[\s  ]+(\d{1,3}(?:[\s  ]\d{3})*(?:[.,]\d+)?)$/.exec(n1)
      const q = scinde ? nombreFr(scinde[1]) : null
      const pu = scinde ? nombreFr(scinde[2]) : null
      const total = nombres[1]
      if (q !== null && pu !== null && total !== null && Math.abs(q * pu - total) <= Math.max(1, total * 0.01)) {
        ligneDpgf.quantite = q
        ligneDpgf.prixUnitaireHT = pu
        ligneDpgf.totalHT = total
      } else {
        ligneDpgf.prixUnitaireHT = nombres[0]
        ligneDpgf.totalHT = nombres[1]
      }
    } else {
      ligneDpgf.totalHT = nombres[0]
    }
    courant.lignes.push(ligneDpgf)
  }

  return lots.filter((l) => l.lignes.length > 0)
}

// ---------- secours : contrat JSON pour un Projet Claude ----------

export const CONTRAT_DPGF = `{
  "type": "dpgf",
  "lots": [
    {
      "numero": "02",
      "intitule": "Gros œuvre",
      "totalHT": 420000,
      "lignes": [
        { "article": "2.3.1", "designation": "Voiles béton armé en infrastructure", "unite": "m3", "quantite": 12.5, "prixUnitaireHT": 145, "totalHT": 1812.5 }
      ]
    }
  ]
}`

/** pré-prompt à coller (avec les DPGF jointes) dans un Projet Claude quand
 *  l'analyse déterministe ne suffit pas (scan, mise en page atypique) */
export function promptExtractionDPGF(p: Projet): string {
  return [
    `Voici une ou plusieurs DPGF du DCE de l'opération « ${p.nom} » (${p.id}).`,
    '',
    "Pour CHAQUE lot présent, liste les lignes de prix (article, désignation, unité,",
    'quantité, prix unitaire HT, total HT) et le total HT du lot. Ne garde que les',
    'lignes d\'ouvrages chiffrées — pas les titres de chapitres ni les sous-totaux.',
    '',
    'Termine ta réponse par UN SEUL bloc de code json strictement conforme à ce format :',
    '',
    '```json',
    CONTRAT_DPGF,
    '```',
  ].join('\n')
}

export function parseRetourDPGF(brut: string): { lots?: DpgfAnalyse[]; erreur?: string } {
  const json = extraireJSON(brut)
  if (!json) return { erreur: 'Aucun bloc JSON détecté dans le texte collé.' }
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (e) {
    return { erreur: `JSON invalide : ${e instanceof Error ? e.message : String(e)}` }
  }
  const o = data as Record<string, unknown>
  if (o?.type !== 'dpgf') return { erreur: 'Champ « type » attendu : "dpgf".' }
  if (!Array.isArray(o.lots)) return { erreur: 'Champ « lots » attendu (tableau).' }
  const lots: DpgfAnalyse[] = (o.lots as Record<string, unknown>[])
    .filter((l) => typeof l?.intitule === 'string' && Array.isArray(l?.lignes))
    .map((l) => ({
      numero: typeof l.numero === 'string' ? l.numero : '',
      intitule: l.intitule as string,
      totalHT: nombreFr(l.totalHT),
      lignes: (l.lignes as Record<string, unknown>[])
        .filter((x) => typeof x?.designation === 'string')
        .map((x) => ({
          article: typeof x.article === 'string' ? x.article : undefined,
          designation: x.designation as string,
          unite: typeof x.unite === 'string' ? x.unite : undefined,
          quantite: nombreFr(x.quantite),
          prixUnitaireHT: nombreFr(x.prixUnitaireHT),
          totalHT: nombreFr(x.totalHT),
        })),
    }))
    .filter((l) => l.lignes.length > 0)
  if (lots.length === 0) return { erreur: 'Aucun lot exploitable dans le retour.' }
  return { lots }
}

// ---------- helpers de rattachement & de chiffrage ----------

/** somme des totaux de lignes (les lignes sans total sont ignorées) */
export function sommeLignes(lignes: Pick<LigneDPGF, 'totalHT'>[]): number {
  return Math.round(lignes.reduce((s, l) => s + (l.totalHT ?? 0), 0) * 100) / 100
}

/** lignes prêtes à stocker (identifiants attribués) */
export function versLignes(analyses: LigneAnalyse[]): LigneDPGF[] {
  return analyses.map((l) => ({
    id: uid('dpgfl'),
    article: l.article,
    designation: l.designation,
    unite: l.unite,
    quantite: l.quantite ?? null,
    prixUnitaireHT: l.prixUnitaireHT ?? null,
    totalHT: l.totalHT ?? null,
  }))
}

/** éléments CCTP dérivés des lignes chiffrées — quand la DPGF crée le lot,
 *  le planning travaux dispose ainsi des mêmes ouvrages */
export function elementsDepuisLignes(lignes: LigneDPGF[]): ElementCCTP[] {
  return lignes.map((l) => ({ id: uid('elt'), article: l.article, designation: l.designation }))
}

/** montant HT d'un élément de CCTP dans la DPGF du lot : rapprochement par
 *  numéro d'article, sinon par désignation normalisée */
export function montantElement(
  lignes: LigneDPGF[],
  element: Pick<ElementCCTP, 'article' | 'designation'>,
): number | null {
  if (element.article) {
    const parArticle = lignes.find((l) => l.article === element.article)
    if (parArticle) return parArticle.totalHT ?? null
  }
  const cible = fold(element.designation)
  const parDesignation = lignes.find((l) => fold(l.designation) === cible)
  return parDesignation ? (parDesignation.totalHT ?? null) : null
}
