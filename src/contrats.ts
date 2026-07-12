// ============================================================
// Contrats — audit finance F1 : le contrat devient la racine du
// chiffre d'affaires (client), des dépenses récurrentes (agence)
// et des budgets (heures internes, coûts externes).
// Règles :
// - le total signé = lignes ACTIVES uniquement (une option non
//   levée n'entre pas dans le signé) ;
// - un avenant ne réécrit JAMAIS une ligne : il la désactive et
//   en crée une nouvelle, les deux tracées par avenantId ;
// - le budget externe reste un BUDGET tant qu'aucune facture
//   fournisseur ne le justifie (jamais confondu avec un coût réel).
// ============================================================

import type {
  AppState,
  AvenantContrat,
  Contrat,
  LigneContrat,
  Obligation,
  Projet,
} from './types'
import { todayISO, uid } from './util'

export const NATURES_LIGNE: { id: LigneContrat['nature']; label: string }[] = [
  { id: 'base', label: 'Mission de base' },
  { id: 'complementaire', label: 'Mission complémentaire' },
  { id: 'option', label: 'Option' },
  { id: 'debours', label: 'Débours' },
  { id: 'revision', label: 'Révision' },
]

// ---------- totaux ----------

export function montantLigneContrat(l: LigneContrat): number {
  return Math.round(l.quantite * l.prixUnitaireHT * 100) / 100
}

/** total CONTRACTUEL actuel : lignes actives uniquement — une option
 *  non levée n'entre pas dans le signé (recette F1) */
export function totalContratHT(c: Contrat): number {
  return (
    Math.round(
      c.lignes.filter((l) => l.etat === 'active').reduce((somme, l) => somme + l.quantite * l.prixUnitaireHT, 0) * 100,
    ) / 100
  )
}

/** part du total venue des avenants signés (lignes actives créées par avenant) */
export function totalAvenantsHT(c: Contrat): number {
  return (
    Math.round(
      c.lignes
        .filter((l) => l.etat === 'active' && l.avenantId)
        .reduce((somme, l) => somme + l.quantite * l.prixUnitaireHT, 0) * 100,
    ) / 100
  )
}

export function budgetHeures(c: Contrat): number {
  return c.lignes.filter((l) => l.etat === 'active').reduce((somme, l) => somme + (l.heuresBudget || 0), 0)
}

/** budget externe SAISI (pas un coût réel — audit §1.4) */
export function budgetExterneHT(c: Contrat): number {
  return (
    Math.round(
      c.lignes.filter((l) => l.etat === 'active').reduce((somme, l) => somme + (l.coutExterneBudgetHT || 0), 0) * 100,
    ) / 100
  )
}

// ---------- lectures ----------

export function contratDuProjet(state: AppState, projetId: string): Contrat | undefined {
  return state.contrats.find((c) => c.type === 'client' && c.projetId === projetId)
}

/** honoraires portés par la fiche projet (phases + missions compl.) —
 *  la référence de comparaison du contrat provisoire */
export function honorairesProjetHT(p: Projet): number {
  return Math.round((p.phases.reduce((somme, ph) => somme + ph.montantHT, 0) + (p.missionsComplHT || 0)) * 100) / 100
}

/** écart contrat ↔ fiche projet, affiché tant que le contrat est provisoire */
export function ecartContratProjet(c: Contrat, p: Projet): number {
  return Math.round((totalContratHT(c) - honorairesProjetHT(p)) * 100) / 100
}

/** total facturé (hors avoirs négatifs inclus) sur le projet du contrat */
export function factureSurContrat(state: AppState, c: Contrat): number {
  if (!c.projetId) return 0
  return (
    Math.round(
      state.factures
        .filter((f) => f.projetId === c.projetId && f.statut !== 'prevue')
        .reduce((somme, f) => somme + (f.figee?.totalHT ?? f.montantHT), 0) * 100,
    ) / 100
  )
}

// ---------- avenants (avant/après, jamais de réécriture) ----------

export interface ModificationAvenant {
  /** ligne existante désactivée par l'avenant */
  desactiver?: string[]
  /** lignes ajoutées (remplacement ou ajout) */
  ajouter?: Omit<LigneContrat, 'id' | 'avenantId'>[]
}

/** applique un avenant : retourne le contrat MIS À JOUR (nouvel objet) —
 *  les lignes désactivées restent visibles avec leur avenant */
export function appliquerAvenant(c: Contrat, avenant: AvenantContrat, modif: ModificationAvenant): Contrat {
  const desactivees = new Set(modif.desactiver || [])
  const lignes = c.lignes.map((l) =>
    desactivees.has(l.id) ? { ...l, etat: 'supprimee' as const, avenantId: avenant.id } : l,
  )
  for (const nouvelle of modif.ajouter || []) {
    lignes.push({ ...nouvelle, id: uid('lc'), avenantId: avenant.id })
  }
  const avant = totalContratHT(c)
  const suivant: Contrat = { ...c, lignes, avenants: [...c.avenants, avenant] }
  const apres = totalContratHT(suivant)
  suivant.evenements = [
    ...(c.evenements || []),
    {
      date: avenant.date,
      type: 'avenant',
      detail: `${avenant.motif} — total ${avant} € → ${apres} € HT`,
    },
  ]
  return suivant
}

/** lève une option : la ligne entre dans le signé, l'événement le trace */
export function leverOption(c: Contrat, ligneId: string): Contrat {
  const lignes = c.lignes.map((l) => (l.id === ligneId && l.etat === 'option' ? { ...l, etat: 'active' as const } : l))
  const ligne = c.lignes.find((l) => l.id === ligneId)
  return {
    ...c,
    lignes,
    evenements: [
      ...(c.evenements || []),
      { date: todayISO(), type: 'option_levee', detail: ligne ? ligne.designation : ligneId },
    ],
  }
}

// ---------- migration : provisoires depuis l'existant ----------

/** contrat client PROVISOIRE construit depuis les honoraires/phases —
 *  à contrôler face au document signé avant validation (audit §14) */
export function contratProvisoireDepuisProjet(p: Projet): Contrat {
  const lignes: LigneContrat[] = p.phases
    .filter((ph) => ph.montantHT > 0 || ph.heuresPrevues > 0 || (ph.coutExterneHT || 0) > 0)
    .map((ph) => ({
      id: uid('lc'),
      nature: 'base' as const,
      phase: ph.code,
      designation: `Phase ${ph.code}`,
      quantite: 1,
      unite: 'forfait',
      prixUnitaireHT: ph.montantHT,
      heuresBudget: ph.heuresPrevues || null,
      coutExterneBudgetHT: ph.coutExterneHT || null,
      declencheur: 'remise',
      etat: 'active' as const,
    }))
  if ((p.missionsComplHT || 0) > 0) {
    lignes.push({
      id: uid('lc'),
      nature: 'complementaire',
      designation: 'Missions complémentaires',
      quantite: 1,
      unite: 'forfait',
      prixUnitaireHT: p.missionsComplHT,
      etat: 'active',
    })
  }
  return {
    id: uid('ctr'),
    type: 'client',
    intitule: `Marché de maîtrise d'œuvre — ${p.nom}`,
    tiers: p.moa || '',
    projetId: p.id,
    lignes,
    avenants: [],
    provisoire: true,
    evenements: [
      {
        date: todayISO(),
        type: 'migration',
        detail: 'Contrat provisoire construit depuis les phases — à contrôler face au document signé.',
      },
    ],
  }
}

/** contrat d'agence récurrent construit depuis une Obligation-contrat
 *  (bail, assurance, logiciels…) — les deux vues restent liées */
export function contratDepuisObligation(o: Obligation): Contrat {
  const periodicite = o.periodiciteMois || 12
  const parPeriode =
    o.montantAnnuel != null ? Math.round(((o.montantAnnuel * periodicite) / 12) * 100) / 100 : null
  return {
    id: uid('ctr'),
    type: 'agence',
    intitule: o.libelle,
    tiers: o.organisme || '',
    lignes: [],
    avenants: [],
    periodiciteMois: periodicite,
    montantAttenduHT: parPeriode,
    tolerancePct: 0.15,
    dateRenouvellement: o.dateRenouvellement || null,
    obligationId: o.id,
    evenements: [{ date: todayISO(), type: 'migration', detail: 'Repris des contrats de l’agence (Échéances agence).' }],
  }
}
