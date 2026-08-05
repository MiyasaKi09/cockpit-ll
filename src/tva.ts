// ============================================================
// Position TVA — « ce qu'on doit à l'État », calculé depuis les
// pièces, mois par mois. Logique PURE : `moisCourant` est passé en
// argument, aucune horloge ni stockage ici.
//
// CONVENTION APPLIQUÉE (à valider avec le cabinet —
// docs/QUESTIONS_CABINET_TVA.md) :
//
// - TVA COLLECTÉE à l'ENCAISSEMENT — le régime de droit commun des
//   prestations de services : quand un paiement arrive, la part de
//   TVA de CE paiement devient due, au prorata du TTC de la facture
//   réglée (montant × tvaFacture / ttcFacture). Les avoirs et les
//   remboursements sont des montants négatifs et suivent le même
//   chemin. Le réglage `settings.regimeTVA` ('encaissements' par
//   défaut) permet de basculer sur l'option « débits » : la TVA
//   collectée naît alors à l'ÉMISSION de la facture, lue sur la
//   copie figée de la pièce.
//
// - TVA DÉDUCTIBLE au PAIEMENT de l'achat (`payeLe`) — choix
//   prudent : on ne déduit jamais ce qu'on n'a pas payé, donc le
//   « dû à l'État » n'est jamais sous-estimé. `montantTVA` null
//   vaut 0 déductible (pas une erreur) ; une pièce écartée est hors
//   calcul. Les notes de frais ne sont pas comptées ici — même
//   prudence : les ignorer ne peut que majorer le dû affiché.
//
// Le « dû à l'État » est la somme des soldes des mois ÉCHUS
// (strictement avant le mois courant) non encore marqués déclarés.
// « Marquer déclarée » est un GESTE humain (§15) qui fige le solde
// du mois dans `tvaDeclarations` — la machine calcule et propose,
// elle ne déclare jamais seule. Cette position ne remplace pas le
// forfait prévisionnel `settings.tvaMensuelleEstimee` de la
// trésorerie, paramétré avec le cabinet.
// ============================================================

import type { AppState, Facture, TvaDeclaration } from './types'
import { ttcFacture } from './facture'
import { addMonths, monthKey } from './util'

export type RegimeTVA = 'encaissements' | 'debits'

export interface MoisTVA {
  mois: string // 'AAAA-MM'
  collectee: number
  deductible: number
  solde: number
}

export interface PositionTVA {
  /** mois triés (au moins les 3 jusqu'au mois courant, plus tout mois actif) */
  mois: MoisTVA[]
  /** Σ des soldes des mois échus non encore marqués déclarés */
  duALEtat: number
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** un mois hors de la forme 'AAAA-MM' (date corrompue, import) est écarté
 *  plutôt que de créer une ligne illisible dans la position */
const MOIS_VALIDE = /^\d{4}-\d{2}$/

/** régime effectif : seul 'debits' bascule — toute autre valeur (absente,
 *  future, importée) retombe sur le droit commun, jamais sur un régime
 *  optionnel que personne n'a choisi */
export function regimeTVAEffectif(settings: AppState['settings']): RegimeTVA {
  return settings.regimeTVA === 'debits' ? 'debits' : 'encaissements'
}

/** la ligne de convention affichée à l'écran — UNE source pour la phrase,
 *  alignée sur le régime réglé, jamais recopiée dans un composant */
export function libelleConvention(regime: RegimeTVA): string {
  const collectee =
    regime === 'debits'
      ? 'collectée à l’émission (option sur les débits)'
      : 'collectée à l’encaissement'
  return `${collectee} · déductible au paiement — régime à confirmer avec le cabinet`
}

/** TVA d'une facture : la copie figée d'abord (la vérité de la pièce émise,
 *  arrondie UNE fois au total — règle de totauxLignes verrouillée par
 *  test-tva), sinon l'héritage montantHT × tauxTVA (fraction : 0.2 = 20 %) */
function tvaFacture(f: Facture): number {
  if (f.figee) return f.figee.totalTVA
  return r2(f.montantHT * f.tauxTVA)
}

/** déclaration d'un mois, s'il a été marqué (null sinon) */
export function declarationDuMois(state: AppState, mois: string): TvaDeclaration | null {
  return state.tvaDeclarations.find((d) => d.mois === mois) || null
}

export function positionTVA(state: AppState, options: { moisCourant: string }): PositionTVA {
  // accepte 'AAAA-MM' comme une date ISO complète
  const moisCourant = monthKey(options.moisCourant)
  const brut = new Map<string, { collectee: number; deductible: number }>()
  const cumule = (mois: string, cle: 'collectee' | 'deductible', montant: number) => {
    if (!MOIS_VALIDE.test(mois) || !Number.isFinite(montant)) return
    const ligne = brut.get(mois) || { collectee: 0, deductible: 0 }
    ligne[cle] += montant
    brut.set(mois, ligne)
  }

  // --- collectée -----------------------------------------------------------
  if (regimeTVAEffectif(state.settings) === 'debits') {
    // option débits : la TVA naît à l'émission de la PIÈCE (jamais d'une
    // prévision — une facture « prévue » n'existe pas fiscalement)
    for (const f of state.factures) {
      if (f.statut === 'prevue') continue
      cumule(monthKey(f.figee?.dateEmission || f.emission), 'collectee', tvaFacture(f))
    }
  } else {
    // encaissements : la part de TVA de chaque affectation, au prorata du
    // TTC de la facture réglée. Accumulée en précision pleine puis arrondie
    // une fois PAR MOIS — même règle que totauxLignes : arrondir chaque
    // paiement déplacerait des centimes sur les petits règlements.
    const factures = new Map(state.factures.map((f) => [f.id, f]))
    for (const p of state.paiements) {
      for (const a of p.affectations) {
        const f = factures.get(a.factureId)
        if (!f) continue // affectation orpheline : aucune pièce, aucune TVA attribuable
        const ttc = ttcFacture(f)
        if (ttc === 0) continue
        cumule(monthKey(p.date), 'collectee', a.montant * (tvaFacture(f) / ttc))
      }
    }
  }

  // --- déductible ----------------------------------------------------------
  for (const f of state.facturesAchat) {
    if (f.statut === 'ecartee') continue // écartée = hors calcul, quel que soit son état
    if (!f.payeLe) continue // pas payée : rien n'est déductible (prudence)
    cumule(monthKey(f.payeLe), 'deductible', f.montantTVA ?? 0)
  }

  // --- les mois de la position ---------------------------------------------
  // Tous les mois actifs, PLUS les trois derniers jusqu'au mois courant même
  // vides : la carte affiche toujours ce trio, et un mois à zéro est une
  // information (« rien encaissé »), pas un trou.
  const cles = new Set(brut.keys())
  if (MOIS_VALIDE.test(moisCourant)) {
    cles.add(moisCourant)
    cles.add(addMonths(moisCourant, -1))
    cles.add(addMonths(moisCourant, -2))
  }
  const mois: MoisTVA[] = [...cles].sort().map((m) => {
    const ligne = brut.get(m) || { collectee: 0, deductible: 0 }
    const collectee = r2(ligne.collectee)
    const deductible = r2(ligne.deductible)
    return { mois: m, collectee, deductible, solde: r2(collectee - deductible) }
  })

  // --- dû à l'État ---------------------------------------------------------
  // Mois ÉCHUS (le mois courant n'est pas fini : son solde n'est pas encore
  // dû) et non déclarés. Un mois déclaré est sorti au montant près : son
  // solde est FIGÉ dans la déclaration, le recalcul ne le déplace plus. Un
  // solde négatif (crédit de TVA) diminue le dû — c'est le report, cf.
  // question 3 de docs/QUESTIONS_CABINET_TVA.md.
  const declares = new Set(state.tvaDeclarations.map((d) => d.mois))
  let du = 0
  for (const m of mois) {
    if (m.mois < moisCourant && !declares.has(m.mois)) du += m.solde
  }
  return { mois, duALEtat: r2(du) }
}
