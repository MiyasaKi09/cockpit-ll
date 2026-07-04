// ============================================================
// Réponse semi-automatique à un appel d'offres : le site
// assemble le dossier de candidature (DOCX, mise en page agence)
// à partir de ce qu'il sait déjà — fiche AO, équipe, références
// pertinentes choisies par similarité de mots-clés. L'humain
// relit, complète le mémoire, joint les pièces. Zéro API payante.
// ============================================================

import type { AppState, Consultation, Reference } from './types'
import { fmtDate, fmtMoney, fold, todayISO } from './util'

// ---------- sélection automatique des références ----------

const STOP = new Set([
  'dans', 'pour', 'avec', 'sans', 'sous', 'travaux', 'marche', 'marches', 'mission',
  'maitrise', 'oeuvre', 'relative', 'relatif', 'concernant', 'objet', 'avis', 'lot',
  'lots', 'tranche', 'phase', 'etude', 'etudes', 'prestations', 'services',
])

function tokens(texte: string): string[] {
  return fold(texte)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3 && !STOP.has(t))
}

/** score une référence contre la consultation par recouvrement de mots significatifs */
export function referencesPertinentes(state: AppState, c: Consultation, max = 4): Reference[] {
  const cible = new Set(tokens(`${c.intitule} ${c.typologie || ''} ${c.notes || ''}`))
  if (cible.size === 0) return []
  const scores = state.references.map((r) => {
    const corpus = tokens(`${r.nom} ${r.mission || ''} ${r.moa || ''} ${(r.motsCles || []).join(' ')}`)
    const score = corpus.reduce((s, t) => s + (cible.has(t) ? 1 : 0), 0)
    return { r, score }
  })
  const pertinentes = scores
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.r.annee || 0) - (a.r.annee || 0))
    .slice(0, max)
    .map((x) => x.r)
  if (pertinentes.length > 0) return pertinentes
  // rien ne matche : les plus récentes font office de carte de visite
  return [...state.references].sort((a, b) => (b.annee || 0) - (a.annee || 0)).slice(0, Math.min(3, max))
}

// ---------- pièces habituelles d'une candidature ----------

export const PIECES_CANDIDATURE = [
  'DC1 — lettre de candidature (ou DUME)',
  'DC2 — déclaration du candidat (CA, effectifs)',
  'Attestation d’assurance RC professionnelle / décennale (MAF)',
  'Attestations fiscales et sociales à jour',
  'Inscription à l’Ordre des architectes',
  'RIB',
  'CV et diplômes de l’équipe proposée',
  'Références détaillées avec attestations de bonne exécution',
  'Mémoire technique / note méthodologique (selon RC)',
]

// ---------- génération du DOCX ----------

export function nomFichierCandidature(c: Consultation): string {
  const slug = fold(c.intitule).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return `${todayISO().replaceAll('-', '')}_candidature_${slug || 'consultation'}.docx`
}

export async function genererDocxCandidature(
  state: AppState,
  c: Consultation,
  refs: Reference[],
): Promise<Blob> {
  const {
    AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell,
    TableRow, TextRun, WidthType,
  } = await import('docx')
  const s = state.settings

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

  const lignesRefs = refs.map(
    (r) =>
      new TableRow({
        children: [
          cellule(`${r.nom}${r.lieu ? ` — ${r.lieu}` : ''}`, false, 34),
          cellule(r.moa || '—', false, 22),
          cellule(r.annee ? String(r.annee) : '—', false, 8),
          cellule(r.montantTravauxHT != null ? fmtMoney(r.montantTravauxHT) : '—', false, 16),
          cellule(r.mission || '—', false, 20),
        ],
      }),
  )

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 21 } } } },
    sections: [
      {
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
            children: [new TextRun({ text: s.nomAgence, bold: true, size: 30 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [new TextRun({ text: 'Architecture — maîtrise d’œuvre', size: 20, color: '5A6478' })],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 60 },
            children: [new TextRun({ text: 'Dossier de candidature' })],
          }),
          texte(c.intitule, true),
          texte(
            `${c.acheteur ? `Acheteur : ${c.acheteur}` : ''}${c.lieu ? ` · ${c.lieu}` : ''}${
              c.dateLimite ? ` · remise avant le ${fmtDate(c.dateLimite)}` : ''
            }`,
          ),
          ...(c.budgetTravaux != null ? [texte(`Budget travaux estimé : ${fmtMoney(c.budgetTravaux)} HT`)] : []),
          ...(c.source ? [texte(`Référence de la consultation : ${c.source}`)] : []),
          new Paragraph({
            spacing: { after: 160 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '1A2233' } },
            children: [],
          }),

          titre('1. Présentation de l’agence'),
          texte(
            `${s.nomAgence} — société d’architecture (SAS), équipe de ${s.equipe.length} personne${s.equipe.length > 1 ? 's' : ''} : ${s.equipe.map((p) => p.nom).join(', ')}.`,
          ),
          texte(
            '⟨À compléter : adresse, n° d’inscription à l’Ordre, année de création, philosophie de l’agence en 3 lignes.⟩',
          ),

          titre('2. Moyens humains et matériels'),
          ...s.equipe.map((p) => puce(`${p.nom} — architecte ⟨rôle sur cette opération à préciser⟩`)),
          puce('Moyens : ⟨logiciels (CAO/BIM), matériel, BET partenaires habituels…⟩'),

          titre('3. Références similaires'),
          ...(refs.length > 0
            ? [
                texte('Sélection automatique par proximité avec l’objet de la consultation — à ajuster :'),
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  rows: [
                    new TableRow({
                      children: [
                        cellule('Opération', true, 34),
                        cellule('Maître d’ouvrage', true, 22),
                        cellule('Année', true, 8),
                        cellule('Travaux HT', true, 16),
                        cellule('Mission', true, 20),
                      ],
                    }),
                    ...lignesRefs,
                  ],
                }),
              ]
            : [texte('⟨Aucune référence en base pour l’instant — page Références du cockpit.⟩')]),

          titre('4. Pièces à joindre (checklist)'),
          ...PIECES_CANDIDATURE.map((p) => puce(`☐ ${p}`)),

          new Paragraph({
            spacing: { before: 320 },
            children: [
              new TextRun({
                text: `Trame générée par le cockpit le ${fmtDate(todayISO())} — les passages entre ⟨crochets⟩ sont à compléter, le mémoire technique s’écrit avec le pré-prompt « Références & candidature ».`,
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
