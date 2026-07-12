// ============================================================
// Amorçage finance (v13 → v14, audit F0/F1) — IDEMPOTENT :
// - la PRÉVISION n'est pas la PIÈCE : les factures « prévues »
//   deviennent des échéances de facturation (aucun numéro légal) ;
// - les factures émises/encaissées héritent leur ancien id comme
//   numéro et sont marquées « historique à contrôler » (le PDF
//   réellement envoyé n'a jamais été gelé) ;
// - chaque « encaissée » reçoit son paiement de reprise : le statut
//   de paiement se dérive du solde désormais ;
// - un contrat client PROVISOIRE naît des phases des projets signés,
//   les contrats d'agence des Obligations-contrats.
// Appelé par seedState() ET migrate() : la deuxième exécution ne
// change rien (chaque étape vérifie l'existant avant de créer).
// ============================================================

import type { AppState, Facture } from './types'
import { contratDepuisObligation, contratProvisoireDepuisProjet } from './contrats'
import { ttcFacture } from './facture'

/** projets qui justifient un contrat (rien de signé pour un prospect) */
const STATUTS_AVEC_CONTRAT: AppState['projets'][number]['statut'][] = ['Signé', 'En cours', 'Livré']

export function amorcerFinance(etat: AppState): void {
  if (!Array.isArray(etat.echeancesFacturation)) etat.echeancesFacturation = []
  if (!Array.isArray(etat.paiements)) etat.paiements = []
  if (!Array.isArray(etat.contrats)) etat.contrats = []

  // 1) factures « prévues » → échéances (id interne conservé, lien
  //    situation aussi) ; les pièces réelles restent des factures
  const pieces: Facture[] = []
  for (const f of etat.factures) {
    if (f.statut === 'prevue') {
      if (!etat.echeancesFacturation.some((e) => e.id === f.id)) {
        etat.echeancesFacturation.push({
          id: f.id,
          projetId: f.projetId,
          phase: f.phase,
          libelle: f.libelle,
          montantHT: f.montantHT,
          tauxTVA: f.tauxTVA,
          datePrevue: f.emission,
          delaiJours: f.delaiJours,
          situationId: f.situationId ?? null,
        })
      }
    } else {
      pieces.push(f)
    }
  }
  etat.factures = pieces

  // 2) pièces héritées : le numéro légal est l'ancien id — la version
  //    PDF envoyée n'a pas été rapprochée, on le signale
  for (const f of etat.factures) {
    if (!f.numero) {
      f.numero = f.id
      f.historiqueAControler = true
    }
    if (!f.type) f.type = 'facture'
  }

  // 3) encaissées sans paiement → paiement de reprise aligné sur le TTC
  //    (id déterministe : rejouer la migration ne crée pas de doublon)
  for (const f of etat.factures) {
    if (f.statut !== 'encaissee') continue
    if (etat.paiements.some((p) => p.affectations.some((a) => a.factureId === f.id))) continue
    const montant = ttcFacture(f)
    etat.paiements.push({
      id: `pay-migr-${f.id}`,
      date: f.encaissementReel || f.emission,
      montant,
      affectations: [{ factureId: f.id, montant }],
      notes: 'Reprise de l’ancien statut « encaissée » — à rapprocher du relevé.',
    })
  }

  // 4) contrats : un provisoire par projet chiffré (hors prospects),
  //    un contrat d'agence par Obligation-contrat (bail, assurance…)
  for (const p of etat.projets) {
    if (!STATUTS_AVEC_CONTRAT.includes(p.statut)) continue
    if (etat.contrats.some((c) => c.type === 'client' && c.projetId === p.id)) continue
    const c = contratProvisoireDepuisProjet(p)
    if (c.lignes.length > 0) etat.contrats.push(c)
  }
  for (const o of etat.obligations) {
    if (!o.contrat) continue
    if (etat.contrats.some((c) => c.obligationId === o.id)) continue
    etat.contrats.push(contratDepuisObligation(o))
  }
}
