// ============================================================
// CCTP — le site COMPREND les pièces écrites du DCE, sans API :
// extraction du texte dans le navigateur (pdfjs — le fichier ne
// quitte jamais le poste), détection déterministe des lots et des
// articles numérotés, puis génération des tâches datées du
// planning travaux. En secours (PDF scanné, document atypique),
// un Projet Claude structure le document via le contrat JSON
// ci-dessous — relu et importé par l'humain, jamais validé seul.
// ============================================================

import type { ElementCCTP, LotDCE, MarcheTravaux, Projet, TacheChantier } from './types'
import { extraireJSON } from './importRoutines'
import { addDays, diffDays, fold, uid } from './util'

// ---------- extraction du texte (PDF / texte brut) ----------

/** texte d'un PDF, ligne à ligne (reconstruction par position verticale) —
 *  indispensable pour détecter titres de lots et articles numérotés */
async function textePdfLignes(fichier: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const pdf = await pdfjs.getDocument({ data: await fichier.arrayBuffer() }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const contenu = await page.getTextContent()
    const lignes: string[] = []
    let ligne = ''
    let dernierY: number | null = null
    for (const it of contenu.items) {
      if (!('str' in it)) continue
      const y = Array.isArray(it.transform) ? (it.transform[5] as number) : null
      if (dernierY !== null && y !== null && Math.abs(y - dernierY) > 2 && ligne.trim()) {
        lignes.push(ligne)
        ligne = ''
      }
      ligne += (ligne && it.str ? ' ' : '') + it.str
      if (it.hasEOL) {
        lignes.push(ligne)
        ligne = ''
      }
      if (y !== null) dernierY = y
    }
    if (ligne.trim()) lignes.push(ligne)
    pages.push(lignes.join('\n'))
  }
  return pages.join('\n\n').replace(/[ \t]+/g, ' ').trim()
}

/** texte d'un fichier CCTP : PDF (extrait dans le navigateur) ou texte brut */
export async function extraireTexteFichier(fichier: File): Promise<string> {
  if (/\.pdf$/i.test(fichier.name)) return textePdfLignes(fichier)
  return (await fichier.text()).trim()
}

// ---------- analyse déterministe du CCTP ----------

export interface ElementAnalyse {
  article?: string
  designation: string
  localisation?: string
}

export interface LotAnalyse {
  numero: string
  intitule: string
  elements: ElementAnalyse[]
}

/** en-tête de lot : « LOT N° 02 — GROS ŒUVRE », « Lot 3 : Charpente »… */
const RE_LOT = /^(?:C\.?C\.?T\.?P\.?\s*[-–—:]?\s*)?LOT\s*(?:N\s*[°ºo]\s*)?(\d{1,2})\s*([A-Za-z])?\s*[-–—:.]?\s+(.{3,60})$/i

/** article numéroté : « 2.3.1 Maçonnerie de soubassement » (≥ 2 niveaux) */
const RE_ARTICLE = /^(\d{1,2}(?:\.\d{1,3}){1,4})\.?\s+(\S.{1,149})$/

/** retire les pointillés de sommaire et le numéro de page en fin de ligne */
function nettoyerLigne(brute: string): string {
  return brute
    .replace(/[.·…_]{2,}\s*\d{0,4}\s*$/, '')
    .replace(/\s{2,}\d{1,4}\s*$/, '')
    .trim()
}

/** ligne de sommaire : se termine par un numéro de page isolé */
const RE_PAGE_FIN = /\s+\d{1,4}\s*$/

/** articles de généralités sans intérêt pour le planning (intitulés exacts) */
const GENERALITES = new Set(
  [
    'objet',
    'objet du present document',
    'objet du marche',
    'objet du lot',
    'objet du cctp',
    'generalites',
    'documents de reference',
    'normes et reglements',
    'normes et documents de reference',
    'textes de reference',
    'reglementation',
    'prescriptions generales',
    'connaissance des lieux',
    'visite des lieux',
    'etendue des travaux',
    'consistance des travaux',
    'limites de prestations',
    'garanties',
    'echantillons',
  ].map(fold),
)

/** vrai si la désignation ressemble à un intitulé d'ouvrage (pas une phrase coupée) */
function designationPlausible(s: string): boolean {
  if (s.length < 3) return false
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return false
  // une ligne presque uniquement numérique/ponctuation = artefact de mise en page
  const lettres = (s.match(/[A-Za-zÀ-ÿ]/g) || []).length
  return lettres >= s.length * 0.4
}

/**
 * Analyse déterministe d'un texte de CCTP : découpe par lots (si le
 * document en contient plusieurs) et liste les articles numérotés de
 * chaque lot. Les sommaires sont dédoublonnés par numéro d'article.
 * Si aucun en-tête de lot n'est détecté, tout le document forme un
 * seul lot (numéro/intitulé à compléter dans l'aperçu avant import).
 */
export function analyserCCTP(texte: string, nomFichier?: string): LotAnalyse[] {
  const lots: LotAnalyse[] = []
  const vusParLot: Set<string>[] = []
  let courant: LotAnalyse | null = null
  let vus: Set<string> = new Set()

  const ouvrirLot = (numero: string, intitule: string) => {
    // le même en-tête revient à chaque page (en-têtes/pieds de page) : on regroupe
    const existant = lots.find((l) => l.numero === numero && fold(l.intitule) === fold(intitule))
    if (existant) {
      courant = existant
      vus = vusParLot[lots.indexOf(existant)]
      return
    }
    courant = { numero, intitule, elements: [] }
    vus = new Set()
    lots.push(courant)
    vusParLot.push(vus)
  }

  for (const brute of texte.split('\n')) {
    const ligne = nettoyerLigne(brute)
    if (!ligne) continue

    const enTete = RE_LOT.exec(ligne)
    if (enTete && designationPlausible(enTete[3])) {
      const numero = enTete[1].padStart(2, '0') + (enTete[2] || '').toUpperCase()
      ouvrirLot(numero, enTete[3].replace(/\s+/g, ' ').trim())
      continue
    }

    const article = RE_ARTICLE.exec(ligne)
    if (!article) continue
    const designation = article[2].replace(/\s+/g, ' ').trim()
    if (!designationPlausible(designation)) continue
    if (!courant) {
      // document sans en-tête de lot : un seul lot, à nommer dans l'aperçu
      const intitule = (nomFichier || 'CCTP importé').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
      ouvrirLot('', intitule)
    }
    // sommaire + corps : le même numéro apparaît deux fois — le corps (sans
    // numéro de page en fin de ligne) remplace la version sommaire
    if (vus.has(article[1])) {
      const elt = courant!.elements.find((e) => e.article === article[1])
      if (elt && RE_PAGE_FIN.test(elt.designation) && !RE_PAGE_FIN.test(designation)) {
        elt.designation = designation
      }
      continue
    }
    vus.add(article[1])
    courant!.elements.push({ article: article[1], designation })
  }

  for (const lot of lots) {
    lot.elements = lot.elements
      // un chapitre qui a des sous-articles n'est pas un ouvrage : on garde les feuilles
      .filter(
        (e) => !lot.elements.some((x) => x !== e && x.article && e.article && x.article.startsWith(e.article + '.')),
      )
      // les articles de généralités (objet, normes, garanties…) n'entrent pas au planning
      .filter((e) => !GENERALITES.has(fold(e.designation).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')))
  }

  return lots.filter((l) => l.elements.length > 0)
}

// ---------- secours : contrat JSON pour un Projet Claude ----------

export const CONTRAT_CCTP = `{
  "type": "cctp",
  "lots": [
    {
      "numero": "02",
      "intitule": "Gros œuvre",
      "elements": [
        { "article": "2.3.1", "designation": "Voiles béton armé en infrastructure", "localisation": "sous-sol" },
        { "article": "2.3.2", "designation": "Plancher haut du RDC — dalle pleine 20 cm" }
      ]
    }
  ]
}`

/** pré-prompt à coller (avec les CCTP joints) dans un Projet Claude quand
 *  l'analyse déterministe ne suffit pas (PDF scanné, document atypique) */
export function promptExtractionCCTP(p: Projet): string {
  return [
    `Voici un ou plusieurs CCTP du DCE de l'opération « ${p.nom} » (${p.id}).`,
    '',
    'Pour CHAQUE lot présent dans ces documents, liste les éléments d\'ouvrage prévus',
    '(les articles de description des ouvrages, avec leur numéro exact). Ignore les',
    'généralités (documents de référence, obligations administratives, garanties) :',
    'ne garde que ce qui se construit et devra apparaître au planning de chantier.',
    '',
    'Termine ta réponse par UN SEUL bloc de code json strictement conforme à ce format :',
    '',
    '```json',
    CONTRAT_CCTP,
    '```',
  ].join('\n')
}

export function parseRetourCCTP(brut: string): { lots?: LotAnalyse[]; erreur?: string } {
  const json = extraireJSON(brut)
  if (!json) return { erreur: 'Aucun bloc JSON détecté dans le texte collé.' }
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (e) {
    return { erreur: `JSON invalide : ${e instanceof Error ? e.message : String(e)}` }
  }
  const o = data as Record<string, unknown>
  if (o?.type !== 'cctp') return { erreur: 'Champ « type » attendu : "cctp".' }
  if (!Array.isArray(o.lots)) return { erreur: 'Champ « lots » attendu (tableau).' }
  const lots: LotAnalyse[] = (o.lots as Record<string, unknown>[])
    .filter((l) => typeof l?.intitule === 'string' && Array.isArray(l?.elements))
    .map((l) => ({
      numero: typeof l.numero === 'string' ? l.numero : '',
      intitule: l.intitule as string,
      elements: (l.elements as Record<string, unknown>[])
        .filter((e) => typeof e?.designation === 'string')
        .map((e) => ({
          article: typeof e.article === 'string' ? e.article : undefined,
          designation: e.designation as string,
          ...(typeof e.localisation === 'string' ? { localisation: e.localisation } : {}),
        })),
    }))
    .filter((l) => l.elements.length > 0)
  if (lots.length === 0) return { erreur: 'Aucun lot exploitable dans le retour.' }
  return { lots }
}

// ---------- rattachement au marché & fenêtre de dates ----------

/** libellé d'affichage d'un lot DCE : « Lot 02 — Gros œuvre » */
export function libelleLot(lot: Pick<LotDCE, 'numero' | 'intitule'>): string {
  return lot.numero ? `Lot ${lot.numero} — ${lot.intitule}` : lot.intitule
}

/** retrouve le marché de travaux correspondant à un lot DCE (numéro dans le
 *  libellé du lot du marché, ou intitulés qui se recouvrent) */
export function rapprocherMarcheLot(
  lot: Pick<LotDCE, 'numero' | 'intitule'>,
  marches: MarcheTravaux[],
): MarcheTravaux | null {
  const numero = lot.numero.replace(/^0+/, '')
  if (numero) {
    const parNumero = marches.find((m) => {
      const n = /lot\s*(?:n\s*[°ºo]\s*)?0*(\d{1,2})/i.exec(m.lot)
      return n ? n[1] === numero : false
    })
    if (parNumero) return parNumero
  }
  const intit = fold(lot.intitule)
  if (intit.length < 4) return null
  return marches.find((m) => fold(m.lot).includes(intit) || intit.includes(fold(m.lot.replace(/^lot\s*\S*\s*[-–—:]?\s*/i, '')))) || null
}

/** fenêtre de dates d'un lot : intervention du marché rattaché, sinon phase DET */
export function fenetreLot(
  lot: LotDCE,
  marches: MarcheTravaux[],
  projet: Projet,
): { debut: string; fin: string } | null {
  const marche = lot.marcheId ? marches.find((m) => m.id === lot.marcheId) : null
  const det = projet.phases.find((ph) => ph.code === 'DET')
  const debut = marche?.dateDebut || det?.debut || null
  const fin = marche?.dateFin || det?.fin || null
  if (!debut || !fin) return null
  return fin >= debut ? { debut, fin } : { debut, fin: debut }
}

// ---------- génération des tâches datées du planning travaux ----------

/**
 * Transforme les éléments d'un lot DCE en tâches datées : répartition
 * séquentielle sur la fenêtre du lot (dates du marché rattaché, sinon
 * phase DET), dans l'ordre des articles du CCTP. Les éléments qui ont
 * déjà une tâche sont ignorés (relance sans doublon). Sans fenêtre,
 * les tâches sont créées « à dater » (dates vides, à poser à la main).
 */
export function genererTaches(
  projet: Projet,
  lot: LotDCE,
  marches: MarcheTravaux[],
  existantes: TacheChantier[],
): { taches: TacheChantier[]; dejaPlanifies: number; sansDate: boolean } {
  const dejaVus = new Set(
    existantes.filter((t) => t.lotDceId === lot.id && t.elementId).map((t) => t.elementId as string),
  )
  const aPlanifier = lot.elements.filter((e) => !dejaVus.has(e.id))
  const fenetre = fenetreLot(lot, marches, projet)
  const libelle = libelleLot(lot)

  const taches: TacheChantier[] = aPlanifier.map((e, i) => {
    let debut: string | null = null
    let fin: string | null = null
    if (fenetre) {
      const jours = diffDays(fenetre.debut, fenetre.fin) + 1
      const pas = Math.max(1, Math.floor(jours / aPlanifier.length))
      debut = addDays(fenetre.debut, Math.min(i * pas, jours - 1))
      fin = i === aPlanifier.length - 1 ? fenetre.fin : addDays(fenetre.debut, Math.min((i + 1) * pas - 1, jours - 1))
      if (fin < debut) fin = debut
    }
    return {
      id: uid('tache'),
      projetId: projet.id,
      lotDceId: lot.id,
      elementId: e.id,
      marcheId: lot.marcheId ?? null,
      lot: libelle,
      designation: e.article ? `${e.article} · ${e.designation}` : e.designation,
      debut,
      fin,
      statut: 'prevu' as const,
    }
  })

  return { taches, dejaPlanifies: dejaVus.size, sansDate: !fenetre && taches.length > 0 }
}

/** éléments CCTP prêts à stocker (identifiants attribués) */
export function versElements(analyses: ElementAnalyse[]): ElementCCTP[] {
  return analyses.map((e) => ({
    id: uid('elt'),
    article: e.article,
    designation: e.designation,
    localisation: e.localisation,
  }))
}
