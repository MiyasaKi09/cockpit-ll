// ============================================================
// Fabrique de CR — la mise en page est DÉCIDÉE ICI, en dur,
// versionnée avec le site : Claude structure le contenu (retour
// JSON au contrat ci-dessous), le site fabrique le DOCX conforme
// et l'écrit directement dans le Drive (07_CHANTIER).
// ============================================================

import type { Projet, ReunionChantier, Settings } from './types'
import { extraireJSON } from './importRoutines'
import { fmtDate } from './util'

export const CONTRAT_CR = `{
  "type": "cr",
  "presents": ["OPAC de l'Oise — M. Lefèvre", "SARL Martin BTP — M. Martin"],
  "excuses": ["Menuiserie Dubois"],
  "absents_convoques": [],
  "avancement": "Gros œuvre au R+1, conforme au planning général.",
  "points": [
    {
      "lot": "Lot 01 — Gros œuvre",
      "numero": "12.1",
      "texte": "Reprise de la fissure du voile B2 avant coulage de la dalle haute.",
      "responsable": "SARL Martin BTP",
      "echeance": "2027-07-15"
    }
  ],
  "decisions": ["Le calepinage des menuiseries sera validé en réunion n°13."],
  "en_attente": ["DOE du lot 03 demandé depuis 2 réunions."],
  "prochaine_reunion": "2027-07-22"
}`

export interface RetourCR {
  presents: string[]
  excuses: string[]
  absents_convoques: string[]
  avancement: string
  points: { lot: string; numero?: string; texte: string; responsable?: string; echeance?: string }[]
  decisions: string[]
  en_attente: string[]
  prochaine_reunion?: string
}

export function parseRetourCR(brut: string): { retour?: RetourCR; erreur?: string } {
  const json = extraireJSON(brut)
  if (!json) return { erreur: 'Aucun bloc JSON détecté dans le texte collé.' }
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (e) {
    return { erreur: `JSON invalide : ${e instanceof Error ? e.message : String(e)}` }
  }
  const o = data as Record<string, unknown>
  if (o?.type !== 'cr') return { erreur: 'Champ « type » attendu : "cr".' }
  const liste = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  const points = Array.isArray(o.points)
    ? (o.points as Record<string, unknown>[])
        .filter((p) => typeof p?.texte === 'string')
        .map((p) => ({
          lot: typeof p.lot === 'string' ? p.lot : 'Général',
          numero: typeof p.numero === 'string' ? p.numero : undefined,
          texte: p.texte as string,
          responsable: typeof p.responsable === 'string' ? p.responsable : undefined,
          echeance: typeof p.echeance === 'string' ? p.echeance : undefined,
        }))
    : []
  return {
    retour: {
      presents: liste(o.presents),
      excuses: liste(o.excuses),
      absents_convoques: liste(o.absents_convoques),
      avancement: typeof o.avancement === 'string' ? o.avancement : '',
      points,
      decisions: liste(o.decisions),
      en_attente: liste(o.en_attente),
      prochaine_reunion: typeof o.prochaine_reunion === 'string' ? o.prochaine_reunion : undefined,
    },
  }
}

/** construit le DOCX du CR — mise en page maison, identique pour tous les CR */
export async function genererDocxCR(
  settings: Settings,
  p: Projet,
  reunion: ReunionChantier,
  cr: RetourCR,
): Promise<Blob> {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import('docx')

  const titre = (t: string) =>
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t })] })
  const texte = (t: string, gras = false) =>
    new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: t, bold: gras })] })
  const puce = (t: string) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: t })] })
  const cellule = (t: string, gras = false, largeur?: number) =>
    new TableCell({
      width: largeur ? { size: largeur, type: WidthType.PERCENTAGE } : undefined,
      children: [new Paragraph({ children: [new TextRun({ text: t, bold: gras, size: 20 })] })],
    })

  // points groupés par lot
  const lots = [...new Set(cr.points.map((x) => x.lot))]
  const lignesPoints = lots.flatMap((lot) => [
    new TableRow({ children: [cellule(lot, true, 22), cellule('', false), cellule('', false, 20), cellule('', false, 14)] }),
    ...cr.points
      .filter((x) => x.lot === lot)
      .map(
        (x) =>
          new TableRow({
            children: [
              cellule(x.numero || '—', false, 22),
              cellule(x.texte),
              cellule(x.responsable || '—', false, 20),
              cellule(x.echeance ? fmtDate(x.echeance) : '—', false, 14),
            ],
          }),
      ),
  ])

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 21 } } },
    },
    sections: [
      {
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
            children: [new TextRun({ text: settings.nomAgence, bold: true, size: 30 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [new TextRun({ text: 'Architecture — maîtrise d\'œuvre', size: 20, color: '5A6478' })],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 60 },
            children: [new TextRun({ text: `Compte-rendu — ${reunion.titre}` })],
          }),
          texte(`Opération : ${p.id} — ${p.nom}${p.adresse ? ` · ${p.adresse}` : ''}`),
          texte(`Maître d'ouvrage : ${p.moa || '—'} · Réunion du ${fmtDate(reunion.date)}`),
          new Paragraph({
            spacing: { after: 160 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1A2233' } },
            children: [],
          }),

          titre('Présents / excusés'),
          ...cr.presents.map((x) => puce(`Présent : ${x}`)),
          ...cr.excuses.map((x) => puce(`Excusé : ${x}`)),
          ...cr.absents_convoques.map((x) => puce(`Absent (convoqué) : ${x}`)),

          titre('Avancement général'),
          texte(cr.avancement || '—'),

          titre('Remarques par lot'),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [cellule('Lot / n°', true, 22), cellule('Remarque', true), cellule('Responsable', true, 20), cellule('Échéance', true, 14)],
              }),
              ...lignesPoints,
            ],
          }),

          ...(cr.decisions.length ? [titre('Décisions'), ...cr.decisions.map(puce)] : []),
          ...(cr.en_attente.length ? [titre('Points en attente'), ...cr.en_attente.map(puce)] : []),

          titre('Prochaine réunion'),
          texte(cr.prochaine_reunion ? fmtDate(cr.prochaine_reunion) : 'À fixer.'),

          new Paragraph({
            spacing: { before: 320 },
            children: [
              new TextRun({
                text: 'Ce compte-rendu vaut approbation sauf remarque écrite sous 48 heures. Document établi par la maîtrise d\'œuvre — reproduction interdite sans accord.',
                size: 17,
                color: '5A6478',
              }),
            ],
          }),
        ],
      },
    ],
  })

  return Packer.toBlob(doc)
}
