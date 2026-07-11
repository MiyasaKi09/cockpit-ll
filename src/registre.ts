// ============================================================
// Registre documentaire — moteur DÉTERMINISTE.
// Le document est une entité métier : identité par empreinte
// SHA-256, classification par lexique (jamais par modèle), et
// chaque proposition porte ses raisons (« Voir pourquoi »).
// Le moteur PROPOSE, l'utilisateur CONFIRME.
// ============================================================

import type { AppState, DocumentRecord, SourceDocument } from './types'
import { fold, todayISO, uid } from './util'

/** catégories contrôlées — partagées par le dépôt manuel et la boîte d'arrivée */
export const CATEGORIES_DOC = [
  'CCTP',
  'DPGF',
  'CR',
  'SITU',
  'FACT',
  'DEVIS',
  'PLAN',
  'PHOTO',
  'ADM',
  'PC',
  'DCE',
  'MAIL',
  'NOTE',
  'AUTRE',
] as const

/** sous-dossier projet proposé pour chaque catégorie (arborescence normalisée) */
export const DOSSIER_PAR_CATEGORIE: Record<string, string> = {
  CCTP: '04_PRO-DCE',
  DPGF: '04_PRO-DCE',
  DCE: '04_PRO-DCE',
  CR: '07_CHANTIER',
  SITU: '07_CHANTIER',
  FACT: '09_FACTURES',
  PHOTO: '10_PHOTOS',
  ADM: '00_ADMIN',
  PC: '03_APS-APD_PC',
  PLAN: '06_EXE-VISA',
  DEVIS: '05_ACT_MARCHES',
  MAIL: '00_ADMIN',
  NOTE: '00_ADMIN',
  AUTRE: '00_ADMIN',
}

/** empreinte SHA-256 hexadécimale du contenu (Web Crypto).
 *  Contexte non sécurisé (http distant) → '' : le dédoublonnage se désactive
 *  proprement au lieu de casser le dépôt. */
export async function empreinteSha256(blob: Blob): Promise<string> {
  try {
    if (!crypto?.subtle) return ''
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return ''
  }
}

// ------------------------------------------------------------
// Classification déterministe : catégorie, projet, entreprise
// ------------------------------------------------------------

/** proposition de classement — confiance 0..1 et raisons lisibles */
export interface PropositionClassement {
  categorie: string
  projetId: string | null
  entrepriseId: string | null
  confiance: number
  raisons: string[]
}

/** indices facultatifs au-delà du nom de fichier (mail source, type MIME…) */
export interface IndicesClassement {
  typeMime?: string
  /** adresse de l'expéditeur (rattachement entreprise par domaine) */
  expediteur?: string
  /** objet du mail ou titre de la source */
  objet?: string
}

/** lexique catégorie → motifs testés sur le nom (et l'objet) foldés.
 *  Ordre = priorité : le premier motif qui matche gagne. */
const LEXIQUE: { categorie: string; motif: RegExp; libelle: string; poids: number }[] = [
  { categorie: 'CCTP', motif: /cctp|cahier des clauses techniques/, libelle: 'contient « CCTP »', poids: 0.5 },
  { categorie: 'DPGF', motif: /dpgf|decomposition du prix|bordereau des? prix|\bbpu\b|\bdqe\b/, libelle: 'contient « DPGF » (ou BPU/DQE)', poids: 0.5 },
  { categorie: 'SITU', motif: /situation|\bsitu\b|etat d.avancement/, libelle: 'contient « situation »', poids: 0.45 },
  { categorie: 'CR', motif: /compte[ -]?rendu|proces[ -]?verbal|(^|[^a-z])cr([^a-z]|$)|(^|[^a-z])pv([^a-z]|$)/, libelle: 'contient « CR » ou « compte-rendu »', poids: 0.4 },
  { categorie: 'FACT', motif: /facture|(^|[^a-z])fact([^a-z]|$)/, libelle: 'contient « facture »', poids: 0.45 },
  { categorie: 'DEVIS', motif: /devis/, libelle: 'contient « devis »', poids: 0.45 },
  { categorie: 'ADM', motif: /decennale|attestation|assurance|kbis|urssaf|qualibat|\brib\b|vigilance/, libelle: 'document administratif (attestation, assurance…)', poids: 0.4 },
  { categorie: 'PC', motif: /permis de construire|cerfa|(^|[^a-z])pc[0-9]/, libelle: 'permis de construire / CERFA', poids: 0.4 },
  { categorie: 'DCE', motif: /(^|[^a-z])dce([^a-z]|$)|reglement de consultation|\brc\b.*consult|ccap/, libelle: 'pièce du DCE', poids: 0.35 },
  { categorie: 'PLAN', motif: /(^|[^a-z])plan(s)?([^a-z]|$)|\.dwg$|\.ifc$|coupe|facade/, libelle: 'plan (nom ou format DWG/IFC)', poids: 0.35 },
  { categorie: 'PHOTO', motif: /photo|img[_-]|dsc[_-]|\.(jpe?g|png|heic|webp)$/, libelle: 'photo (nom ou format image)', poids: 0.35 },
  { categorie: 'MAIL', motif: /\.(eml|msg)$/, libelle: 'message enregistré (.eml/.msg)', poids: 0.4 },
]

/** propose catégorie + projet + entreprise pour un fichier entrant.
 *  100 % déterministe : mêmes entrées → même proposition. */
export function classerFichier(etat: AppState, nomFichier: string, indices?: IndicesClassement): PropositionClassement {
  const texte = fold(`${nomFichier} ${indices?.objet || ''}`)
  const raisons: string[] = []
  let confiance = 0

  // --- catégorie ---
  let categorie = 'AUTRE'
  const entree = LEXIQUE.find((l) => l.motif.test(texte))
  if (entree) {
    categorie = entree.categorie
    confiance += entree.poids
    raisons.push(`Le nom ${entree.libelle}.`)
  } else if (indices?.typeMime?.startsWith('image/')) {
    categorie = 'PHOTO'
    confiance += 0.3
    raisons.push('Le fichier est une image.')
  } else {
    raisons.push('Aucun mot du lexique reconnu — catégorie à choisir.')
  }

  // --- projet : identifiant Pxx (nomenclature) puis nom du projet ---
  let projetId: string | null = null
  const parId = etat.projets.find((p) => new RegExp(`(^|[^a-z0-9])${fold(p.id)}([^a-z0-9]|$)`).test(texte))
  if (parId) {
    projetId = parId.id
    confiance += 0.35
    raisons.push(`Le nom contient l'identifiant du projet ${parId.id} (${parId.nom}).`)
  } else {
    const parNom = etat.projets.find((p) => {
      const nom = fold(p.nom)
      return nom.length >= 5 && texte.includes(nom)
    })
    if (parNom) {
      projetId = parNom.id
      confiance += 0.25
      raisons.push(`Le nom contient le nom du projet « ${parNom.nom} ».`)
    }
  }

  // --- entreprise : raison sociale dans le nom, ou domaine de l'expéditeur ---
  let entrepriseId: string | null = null
  const parRaison = etat.entreprises.find((e) => {
    const rs = fold(e.raisonSociale)
    return rs.length >= 4 && texte.includes(rs)
  })
  if (parRaison) {
    entrepriseId = parRaison.id
    confiance += 0.2
    raisons.push(`Le nom contient l'entreprise « ${parRaison.raisonSociale} ».`)
  } else if (indices?.expediteur) {
    const domaine = fold(indices.expediteur.split('@')[1] || '')
    const parDomaine = domaine ? etat.entreprises.find((e) => e.domaines.some((d) => fold(d) === domaine)) : undefined
    if (parDomaine) {
      entrepriseId = parDomaine.id
      confiance += 0.25
      raisons.push(`L'expéditeur (@${domaine}) correspond à « ${parDomaine.raisonSociale} ».`)
    }
  }

  return { categorie, projetId, entrepriseId, confiance: Math.min(confiance, 0.95), raisons }
}

// ------------------------------------------------------------
// Cycle de vie : création, événements, dédoublonnage, versions
// ------------------------------------------------------------

/** journalise un événement sur le document (mutation en place — à appeler
 *  dans un producteur update()) */
export function ajouterEvenement(doc: DocumentRecord, type: string, detail?: string, auteur?: string): void {
  doc.evenements.push({ date: todayISO(), type, ...(detail ? { detail } : {}), ...(auteur ? { auteur } : {}) })
}

/** fabrique un DocumentRecord complet à partir des champs métier */
export function creerDocument(base: {
  titre: string
  nomOriginal: string
  source: SourceDocument
  categorie: string
  typeMime?: string
  taille?: number
  empreinteSha256?: string
  cheminDrive?: string
  sourceId?: string
  sourceUrl?: string
  projetId?: string | null
  entrepriseId?: string | null
  marcheId?: string | null
  lotDceId?: string | null
  reunionId?: string | null
  sousType?: string
  dateDocument?: string | null
  confiance?: number | null
  raisons?: string[]
  statut?: DocumentRecordStatut
  auteur?: string
}): DocumentRecord {
  const doc: DocumentRecord = {
    id: uid('doc'),
    titre: base.titre,
    nomOriginal: base.nomOriginal,
    source: base.source,
    categorie: base.categorie,
    typeMime: base.typeMime,
    taille: base.taille,
    empreinteSha256: base.empreinteSha256,
    cheminDrive: base.cheminDrive,
    sourceId: base.sourceId,
    sourceUrl: base.sourceUrl,
    projetId: base.projetId ?? null,
    entrepriseId: base.entrepriseId ?? null,
    marcheId: base.marcheId ?? null,
    lotDceId: base.lotDceId ?? null,
    reunionId: base.reunionId ?? null,
    sousType: base.sousType,
    dateDocument: base.dateDocument ?? null,
    recuLe: todayISO(),
    version: 1,
    remplaceDocumentId: null,
    statut: base.statut ?? 'recu',
    confiance: base.confiance ?? null,
    raisons: base.raisons,
    evenements: [],
  }
  ajouterEvenement(doc, 'recu', `Source : ${base.source}${base.cheminDrive ? ` — ${base.cheminDrive}` : ''}`, base.auteur)
  return doc
}

type DocumentRecordStatut = DocumentRecord['statut']

/** retrouve un document au contenu identique (dédoublonnage par empreinte).
 *  Empreinte vide → jamais de doublon (contexte sans Web Crypto). */
export function chercherDoublon(etat: AppState, empreinte: string): DocumentRecord | undefined {
  if (!empreinte) return undefined
  return etat.registreDocuments.find((d) => d.empreinteSha256 === empreinte && d.statut !== 'rejete')
}

/** enregistre le document dans le registre — SAUF s'il y existe déjà au
 *  même contenu : on journalise la re-réception sur l'existant et on le
 *  retourne (aucun doublon créé). À appeler dans un producteur update(). */
export function enregistrerDocument(etat: AppState, doc: DocumentRecord): { doc: DocumentRecord; doublon: boolean } {
  const existant = chercherDoublon(etat, doc.empreinteSha256 || '')
  if (existant) {
    ajouterEvenement(existant, 'doublon', `Reçu à nouveau (${doc.source}${doc.nomOriginal ? ` — ${doc.nomOriginal}` : ''}) : contenu identique, non dupliqué.`)
    return { doc: existant, doublon: true }
  }
  etat.registreDocuments.push(doc)
  return { doc, doublon: false }
}

/** documents « même famille » que doc (projet + catégorie + rattachement) —
 *  candidats à une relation de version */
export function memesFamille(etat: AppState, doc: DocumentRecord): DocumentRecord[] {
  return etat.registreDocuments.filter(
    (d) =>
      d.id !== doc.id &&
      d.statut !== 'rejete' &&
      d.categorie === doc.categorie &&
      d.projetId === doc.projetId &&
      d.lotDceId === doc.lotDceId &&
      d.reunionId === doc.reunionId &&
      d.marcheId === doc.marcheId,
  )
}

/** pose la relation de version : `nouveau` remplace `ancien`.
 *  L'ancien reste consultable (statut « remplace »), rien n'est écrasé. */
export function remplacerDocument(ancien: DocumentRecord, nouveau: DocumentRecord): void {
  nouveau.remplaceDocumentId = ancien.id
  nouveau.version = ancien.version + 1
  ancien.statut = 'remplace'
  ajouterEvenement(ancien, 'remplace', `Remplacé par « ${nouveau.titre} » (v${nouveau.version}).`)
  ajouterEvenement(nouveau, 'version', `Version ${nouveau.version} — remplace « ${ancien.titre} ».`)
}

/** valide le classement proposé (statut, auteur, journal) */
export function validerDocument(doc: DocumentRecord, auteur?: string): void {
  doc.statut = 'valide'
  doc.validePar = auteur
  doc.valideLe = todayISO()
  ajouterEvenement(doc, 'valide', undefined, auteur)
}

/** cherche le document par id (raccourci sûr) */
export function documentParId(etat: AppState, id: string | null | undefined): DocumentRecord | undefined {
  return id ? etat.registreDocuments.find((d) => d.id === id) : undefined
}

/** libellé court du statut pour l'affichage */
export const LIBELLES_STATUT: Record<DocumentRecord['statut'], string> = {
  recu: 'Reçu',
  a_classer: 'À classer',
  classe: 'Classé',
  a_valider: 'À vérifier',
  valide: 'Validé',
  exploite: 'Exploité',
  remplace: 'Remplacé',
  rejete: 'Rejeté',
}
