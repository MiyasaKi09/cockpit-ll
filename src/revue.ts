// ============================================================
// Orchestration & revue de direction — audit finance F7/F8.
// F7 : on DÉTECTE des expressions hors-périmètre dans les
//      courriers, comptes-rendus et journaux ; une action humaine
//      les promeut au pipeline, les chiffre, puis confirme
//      l'avenant SIGNÉ — c'est seulement à cette dernière étape
//      qu'une ligne active est ajoutée au contrat.
//      Les lignes contractuelles à jalon atteint sans facture ni
//      échéance sont proposées ; la validation crée une échéance
//      interne (le numéro légal reste au parcours d'émission).
// F8 : la revue rassemble tout dans un ordre imposé.
// ============================================================

import type { AppState, Contrat, LigneContrat, Projet } from './types'
import { STATUTS_ACTIFS, nomProjet, retardFacture } from './derive'
import { prevision13Semaines } from './tresorerie'
import { controlesCloture } from './comptable'
import { avancementPhase, consultationsParValeur, margeFinale } from './economie'
import { addMonths, fmtDate, fmtMoney, fold, monthKey } from './util'

// ------------------------------------------------------------------
// F7 — détection hors-périmètre (dérivée ; jamais promue seule)
// ------------------------------------------------------------------

const MOTIFS_HORS_PERIMETRE =
  /(hors\s+march[ée]|hors\s+p[ée]rim[èe]tre|travaux\s+suppl[ée]mentaires?|prestation\s+compl[ée]mentaire|mission\s+compl[ée]mentaire|non\s+pr[ée]vu|en\s+suppl[ée]ment|demande\s+suppl[ée]mentaire|modification\s+du\s+programme|avenant)/i

export interface DetectionHorsPerimetre {
  cle: string
  origine: string
  origineType: 'courrier' | 'cr' | 'journal'
  projetId: string | null
  date: string
  detail: string
}

function extrait(texte: string): string {
  const m = MOTIFS_HORS_PERIMETRE.exec(texte)
  if (!m) return texte.slice(0, 160)
  const i = Math.max(0, m.index - 60)
  return (i > 0 ? '…' : '') + texte.slice(i, m.index + 100).trim() + '…'
}

/** détections encore OUVERTES (non déjà promues au pipeline ni écartées) */
export function detectionsHorsPerimetre(state: AppState): DetectionHorsPerimetre[] {
  const dejaVues = new Set(state.pistesAvenant.map((p) => fold(p.origine).slice(0, 80)))
  const res: DetectionHorsPerimetre[] = []
  const ajouter = (d: DetectionHorsPerimetre) => {
    if (dejaVues.has(fold(d.origine).slice(0, 80))) return
    res.push(d)
  }
  for (const c of state.courriers) {
    const texte = `${c.objet} ${c.resume} ${c.actionProposee || ''}`
    if (MOTIFS_HORS_PERIMETRE.test(texte))
      ajouter({ cle: `co:${c.id}`, origine: extrait(texte), origineType: 'courrier', projetId: c.projetId, date: c.dateReception, detail: `Courrier de ${c.de} — ${c.objet}` })
  }
  for (const r of state.reunions) {
    const texte = `${r.cr || ''} ${r.notes || ''}`
    if (texte.trim() && MOTIFS_HORS_PERIMETRE.test(texte))
      ajouter({ cle: `re:${r.id}`, origine: extrait(texte), origineType: 'cr', projetId: r.projetId, date: r.date, detail: `CR — ${r.titre}` })
  }
  for (const p of state.projets) {
    for (const n of p.journal) {
      if (MOTIFS_HORS_PERIMETRE.test(n.texte))
        ajouter({ cle: `jo:${n.id}`, origine: extrait(n.texte), origineType: 'journal', projetId: p.id, date: n.date, detail: `Journal ${p.id}${n.auteur ? ` (${n.auteur})` : ''}` })
    }
  }
  return res.sort((a, b) => b.date.localeCompare(a.date))
}

// ------------------------------------------------------------------
// F7 — jalons facturables (ligne de contrat atteinte, ni facture ni échéance)
// ------------------------------------------------------------------

export interface JalonFacturable {
  contrat: Contrat
  ligne: LigneContrat
  projetId: string
  phase: string | null
  montantHT: number
  raison: string
}

/** part déjà couverte (facture émise + échéance) d'une phase d'un projet */
function couvertureePhase(state: AppState, projetId: string, phase: string | null): number {
  const f = state.factures
    .filter((x) => x.projetId === projetId && x.statut !== 'prevue' && (phase == null || x.phase === phase))
    .reduce((s, x) => s + (x.figee?.totalHT ?? x.montantHT), 0)
  const e = state.echeancesFacturation
    .filter((x) => x.projetId === projetId && (phase == null || x.phase === phase))
    .reduce((s, x) => s + x.montantHT, 0)
  return Math.round((f + e) * 100) / 100
}

/** lignes de contrat client dont le jalon semble atteint et qui n'ont ni
 *  facture ni échéance — proposées à la création d'une échéance interne */
export function jalonsFacturables(state: AppState, today: string): JalonFacturable[] {
  const res: JalonFacturable[] = []
  for (const c of state.contrats) {
    if (c.type !== 'client' || !c.projetId || c.provisoire) continue
    const projet = state.projets.find((p) => p.id === c.projetId)
    if (!projet) continue
    for (const l of c.lignes) {
      if (l.etat !== 'active') continue
      const phase = l.phase ?? null
      const montant = Math.round(l.quantite * l.prixUnitaireHT * 100) / 100
      if (montant <= 0) continue
      // jalon atteint ? phase avancée à ≥ 90 % ou fin de phase passée
      let atteint = false
      let raison = ''
      if (phase) {
        const ph = projet.phases.find((p) => p.code === phase)
        const av = avancementPhase(state, projet, phase)
        if (av >= 0.9) {
          atteint = true
          raison = `phase ${phase} avancée à ${Math.round(av * 100)} %`
        } else if (ph?.fin && ph.fin <= today) {
          atteint = true
          raison = `fin de phase ${phase} passée (${fmtDate(ph.fin)})`
        }
      }
      if (!atteint) continue
      // déjà couvert par une facture ou une échéance sur cette phase ?
      const couvert = couvertureePhase(state, c.projetId, phase)
      if (couvert >= montant - 0.5) continue
      res.push({ contrat: c, ligne: l, projetId: c.projetId, phase, montantHT: Math.round((montant - Math.max(0, couvert)) * 100) / 100, raison })
    }
  }
  return res
}

// ------------------------------------------------------------------
// F8 — revue de direction : les 8 sections, dans l'ordre imposé
// ------------------------------------------------------------------

export interface SectionRevue {
  cle: string
  titre: string
  lignes: { texte: string; lien?: string; tone?: 'ok' | 'warn' | 'danger' | 'muted' }[]
}

export function revueDirection(state: AppState, today: string): SectionRevue[] {
  const sections: SectionRevue[] = []

  // 1 — points bas probable et prudent
  const probable = prevision13Semaines(state, today, 'probable')
  const prudent = prevision13Semaines(state, today, 'prudent')
  const seuil = state.settings.seuilTresorerie ?? 0
  sections.push({
    cle: 'pointsbas',
    titre: '1 · Points bas de trésorerie (13 semaines)',
    lignes: [
      { texte: `Probable : ${fmtMoney(probable.pointBas.solde)} la semaine du ${fmtDate(probable.pointBas.lundi)}`, lien: '#/finance/banque', tone: probable.pointBas.solde < seuil ? 'danger' : 'ok' },
      { texte: `Prudent : ${fmtMoney(prudent.pointBas.solde)} la semaine du ${fmtDate(prudent.pointBas.lundi)}`, lien: '#/finance/banque', tone: prudent.pointBas.solde < seuil ? 'danger' : 'warn' },
    ],
  })

  // 2 — retards clients
  const retards = state.factures
    .filter((f) => f.type !== 'avoir' && retardFacture(f, today) > 0)
    .sort((a, b) => retardFacture(b, today) - retardFacture(a, today))
  sections.push({
    cle: 'retards',
    titre: `2 · Retards clients (${retards.length})`,
    lignes: retards.length
      ? retards.slice(0, 6).map((f) => ({ texte: `${f.numero || f.id} — ${nomProjet(state, f.projetId)} · ${retardFacture(f, today)} j de retard`, lien: '#/facturation', tone: 'danger' as const }))
      : [{ texte: 'Aucun retard client.', tone: 'ok' as const }],
  })

  // 3 — état de clôture (mois précédent)
  const moisPrec = addMonths(monthKey(today), -1)
  const dejaClos = state.lotsComptables.some((l) => l.periode === moisPrec)
  const cl = controlesCloture(state, moisPrec, today)
  sections.push({
    cle: 'cloture',
    titre: `3 · Clôture ${moisPrec}`,
    lignes: [
      dejaClos
        ? { texte: 'Période exportée au cabinet — importer son retour.', lien: '#/finance/comptable', tone: 'ok' as const }
        : { texte: `${cl.pctPret} % prêt · ${cl.bloquants} bloquant(s) · ${cl.aVerifier} à vérifier`, lien: '#/finance/comptable', tone: cl.bloquants > 0 ? 'danger' : 'warn' },
    ],
  })

  // 4 — demandes hors périmètre + avenants potentiels
  const detections = detectionsHorsPerimetre(state)
  const pipeline = state.pistesAvenant.filter((p) => p.statut === 'au_pipeline' || p.statut === 'chiffree')
  sections.push({
    cle: 'horsperimetre',
    titre: `4 · Hors périmètre & avenants (${detections.length} détectée(s), ${pipeline.length} au pipeline)`,
    lignes: [
      ...detections.slice(0, 4).map((d) => ({ texte: `Détecté (${d.origineType}) : « ${d.origine} »`, lien: '#/finance/revue', tone: 'warn' as const })),
      ...pipeline.map((p) => ({ texte: `Pipeline : ${p.libelle}${p.montantEstimeHT ? ` — ${fmtMoney(p.montantEstimeHT)} HT` : ''} (${p.statut})`, lien: '#/finance/revue', tone: 'muted' as const })),
      ...(detections.length === 0 && pipeline.length === 0 ? [{ texte: 'Rien à qualifier.', tone: 'ok' as const }] : []),
    ],
  })

  // 5 — jalons facturables
  const jalons = jalonsFacturables(state, today)
  sections.push({
    cle: 'jalons',
    titre: `5 · Jalons facturables (${jalons.length})`,
    lignes: jalons.length
      ? jalons.slice(0, 6).map((j) => ({ texte: `${j.projetId} — ${j.ligne.designation} : ${fmtMoney(j.montantHT)} HT (${j.raison})`, lien: '#/finance/revue', tone: 'warn' as const }))
      : [{ texte: 'Aucun jalon contractuel en attente d’échéance.', tone: 'ok' as const }],
  })

  // 6 — projets dont la marge finale dérive
  const derives = state.projets
    .filter((p) => STATUTS_ACTIFS.includes(p.statut))
    .map((p) => ({ p, mf: margeFinale(state, p) }))
    .filter((x) => x.mf.derive < -0.01 && Math.abs(x.mf.derive) >= x.mf.honorairesSignes * 0.02)
    .sort((a, b) => a.mf.derive - b.mf.derive)
  sections.push({
    cle: 'derive',
    titre: `6 · Marges finales qui dérivent (${derives.length})`,
    lignes: derives.length
      ? derives.slice(0, 6).map(({ p, mf }) => ({ texte: `${p.id} — dérive ${fmtMoney(mf.derive)} (marge finale ${fmtMoney(mf.marge)} vs initiale ${fmtMoney(mf.margeInitiale)})`, lien: `#/projets/${p.id}/finances`, tone: 'danger' as const }))
      : [{ texte: 'Aucune dérive de marge significative.', tone: 'ok' as const }],
  })

  // 7 — consultations par valeur attendue
  const consultations = consultationsParValeur(state)
  sections.push({
    cle: 'consultations',
    titre: `7 · Consultations par valeur attendue (${consultations.length})`,
    lignes: consultations.length
      ? consultations.slice(0, 6).map(({ c, valeurAttendue, proba }) => ({ texte: `${c.intitule.slice(0, 50)} — ${fmtMoney(valeurAttendue)} attendus (proba ${Math.round(proba * 100)} %)`, lien: '#/ao', tone: 'muted' as const }))
      : [{ texte: 'Aucune consultation en cours.', tone: 'muted' as const }],
  })

  // 8 — décisions (responsable, échéance, statut)
  const decisions = [...state.decisionsDirection].filter((d) => d.statut !== 'faite').sort((a, b) => (a.echeance || '9999').localeCompare(b.echeance || '9999'))
  sections.push({
    cle: 'decisions',
    titre: `8 · Décisions (${decisions.length} ouverte(s))`,
    lignes: decisions.length
      ? decisions.slice(0, 8).map((d) => ({ texte: `${d.sujet}${d.responsable ? ` — ${d.responsable}` : ''}${d.echeance ? ` · échéance ${fmtDate(d.echeance)}` : ''} (${d.statut})`, lien: '#/finance/revue', tone: d.echeance && d.echeance < today ? 'danger' : 'muted' })) as SectionRevue['lignes']
      : [{ texte: 'Aucune décision ouverte.', tone: 'ok' as const }],
  })

  return sections
}
