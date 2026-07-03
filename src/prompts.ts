// ============================================================
// Assembleur de pré-prompts — la pièce maîtresse du sans-API.
// Un clic assemble gabarit + données de la base et copie le
// tout dans le presse-papier ; il ne reste qu'à le coller dans
// le bon Projet Claude.
// ============================================================

import type {
  AppState,
  Consultation,
  Facture,
  MarcheTravaux,
  Projet,
  PromptTemplate,
  Situation,
} from './types'
import { calculHonoraires, LIBELLES_PHASES } from './miqcp'
import {
  delaiMoyenPaiement,
  encaissementPrevu,
  factureHT,
  heuresPrevues,
  heuresReelles,
  retardFacture,
  ttc,
} from './derive'
import { fmtDate, fmtMoney, fmtMois, fmtPct, todayISO } from './util'

/** remplace les {{cles}} du gabarit ; les clés inconnues restent visibles */
export function assemble(corps: string, ctx: Record<string, string>): string {
  return corps.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, cle: string) => {
    const v = ctx[cle]
    return v !== undefined && v !== '' ? v : `⟦${cle} : à compléter⟧`
  })
}

/** copie dans le presse-papier (fallback textarea si API indisponible) */
export async function copier(texte: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texte)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = texte
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

// ---------- constructeurs de contexte (placeholders) ----------

export function contexteProjet(state: AppState, p: Projet): Record<string, string> {
  const h = calculHonoraires(p, state.settings)
  const auj = todayISO()
  const phasesEnCours = p.phases.filter(
    (ph) => ph.debut && ph.fin && ph.debut <= auj && auj <= ph.fin,
  )
  const impayees = state.factures.filter(
    (f) => f.projetId === p.id && retardFacture(f, auj) > 0,
  )
  const marches = state.marches.filter((m) => m.projetId === p.id)

  const fiche = [
    `Projet : ${p.id} — ${p.nom}`,
    p.moa ? `Maître d'ouvrage : ${p.moa} (${p.typeMO})` : `Type de MO : ${p.typeMO}`,
    p.adresse ? `Adresse : ${p.adresse}` : null,
    `Statut : ${p.statut}`,
    p.montantTravauxHT ? `Montant de travaux : ${fmtMoney(p.montantTravauxHT)} HT` : null,
    h.honorairesTotauxHT
      ? `Honoraires : ${fmtMoney(h.honorairesTotauxHT)} HT (taux ${fmtPct(h.tauxFinal, 2)})`
      : null,
    `Facturé à ce jour : ${fmtMoney(factureHT(state, p.id))} HT`,
    phasesEnCours.length
      ? `Phase(s) en cours : ${phasesEnCours.map((ph) => `${ph.code} (${LIBELLES_PHASES[ph.code]}, fin ${fmtDate(ph.fin)})`).join(', ')}`
      : null,
    marches.length
      ? `Marchés de travaux :\n${marches.map((m) => `  - ${m.lot} : ${m.entreprise}, ${fmtMoney(m.montantInitialHT + m.avenantsHT)} HT${m.actif ? ' (chantier en cours)' : ''}`).join('\n')}`
      : null,
    impayees.length
      ? `Factures en retard :\n${impayees.map((f) => `  - ${f.id} ${f.libelle} : ${fmtMoney(ttc(f), true)} TTC, échue le ${fmtDate(encaissementPrevu(f))}`).join('\n')}`
      : null,
    p.notes ? `Notes : ${p.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return {
    fiche,
    projet_id: p.id,
    projet_nom: p.nom,
    moa: p.moa || '',
    type_mo: p.typeMO,
    adresse: p.adresse || '',
    montant_travaux: p.montantTravauxHT ? fmtMoney(p.montantTravauxHT) : '',
    honoraires: h.honorairesTotauxHT ? fmtMoney(h.honorairesTotauxHT) : '',
    phase_en_cours: phasesEnCours.map((ph) => ph.code).join(', '),
    heures_pointees: String(Math.round(heuresReelles(state, p.id))),
    heures_prevues: String(Math.round(heuresPrevues(p))),
    date: fmtDate(auj),
  }
}

export function contexteMarche(
  state: AppState,
  m: MarcheTravaux,
  sit?: Situation,
): Record<string, string> {
  const p = state.projets.find((x) => x.id === m.projetId)
  const base = p ? contexteProjet(state, p) : { fiche: '', date: fmtDate(todayISO()) }
  const sits = state.situations
    .filter((s) => s.marcheId === m.id)
    .sort((a, b) => a.mois.localeCompare(b.mois))
  const ficheMarche = [
    `Marché : ${m.lot} — ${m.entreprise}`,
    `Montant initial : ${fmtMoney(m.montantInitialHT)} HT${m.avenantsHT ? ` + avenants ${fmtMoney(m.avenantsHT)} HT` : ''}`,
    `Retenue de garantie : ${fmtPct(m.tauxRG, 0)}${m.revision ? ' · révision de prix applicable' : ''}`,
    `Délai de vérification des situations : ${m.delaiVerifJours} jours`,
    m.contactNom || m.contactEmail
      ? `Contact : ${[m.contactNom, m.contactEmail].filter(Boolean).join(' — ')}`
      : null,
    sits.length
      ? `Situations reçues :\n${sits.map((s) => `  - ${fmtMois(s.mois)} : ${s.montantMoisHT !== null ? fmtMoney(s.montantMoisHT) + ' HT' : 'montant ?'} (${s.statut === 'validee' ? 'validée' : s.statut === 'rejetee' ? 'rejetée' : 'à vérifier'})`).join('\n')}`
      : 'Aucune situation reçue à ce jour.',
  ]
    .filter(Boolean)
    .join('\n')

  return {
    ...base,
    fiche_marche: ficheMarche,
    entreprise: m.entreprise,
    lot: m.lot,
    montant_marche: fmtMoney(m.montantInitialHT + m.avenantsHT),
    contact_entreprise: m.contactNom || m.entreprise,
    email_entreprise: m.contactEmail || '',
    mois_situation: sit ? fmtMois(sit.mois) : fmtMois(todayISO().slice(0, 7)),
    montant_situation: sit && sit.montantMoisHT !== null ? fmtMoney(sit.montantMoisHT) : '',
  }
}

export function contexteFacture(state: AppState, f: Facture): Record<string, string> {
  const p = state.projets.find((x) => x.id === f.projetId)
  const base = p ? contexteProjet(state, p) : { fiche: '', date: fmtDate(todayISO()) }
  const retard = retardFacture(f, todayISO())
  const delaiMoyen = p ? delaiMoyenPaiement(state, p.typeMO) : null
  return {
    ...base,
    facture_numero: f.id,
    facture_libelle: f.libelle,
    facture_ht: fmtMoney(f.montantHT, true),
    facture_ttc: fmtMoney(ttc(f), true),
    facture_emission: fmtDate(f.emission),
    facture_echeance: fmtDate(encaissementPrevu(f)),
    retard_jours: String(retard),
    delai_moyen_client: delaiMoyen !== null ? `${delaiMoyen} j` : '',
  }
}

export function contexteConsultation(state: AppState, c: Consultation): Record<string, string> {
  const refs = state.references
    .slice()
    .sort((a, b) => (b.annee || 0) - (a.annee || 0))
    .slice(0, 12)
  const chargeActuelle = state.projets
    .filter((p) => ['Signé', 'En cours'].includes(p.statut))
    .map((p) => `${p.id} ${p.nom} (${p.statut})`)
    .join(' ; ')
  const ficheConsultation = [
    `Consultation : ${c.intitule}`,
    c.acheteur ? `Acheteur : ${c.acheteur}` : null,
    c.lieu ? `Lieu : ${c.lieu}` : null,
    c.typologie ? `Typologie : ${c.typologie}` : null,
    c.budgetTravaux ? `Budget travaux estimé : ${fmtMoney(c.budgetTravaux)} HT` : null,
    c.dateLimite ? `Date limite de remise : ${fmtDate(c.dateLimite)}` : null,
    c.source ? `Source : ${c.source}` : null,
    c.notes ? `Notes : ${c.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  const referencesTexte = refs.length
    ? refs
        .map(
          (r) =>
            `  - ${r.nom}${r.lieu ? ` (${r.lieu})` : ''}${r.annee ? `, ${r.annee}` : ''}${r.montantTravauxHT ? `, ${fmtMoney(r.montantTravauxHT)} HT` : ''}${r.mission ? `, mission ${r.mission}` : ''}${r.attestation ? ', attestation OK' : ''}`,
        )
        .join('\n')
    : '  (base de références vide)'

  return {
    fiche: ficheConsultation,
    consultation: ficheConsultation,
    references: referencesTexte,
    charge_actuelle: chargeActuelle || 'aucun projet actif',
    date_limite: fmtDate(c.dateLimite),
    acheteur: c.acheteur || '',
    date: fmtDate(todayISO()),
  }
}

/** contexte générique selon le type déclaré du gabarit */
export function contextePourTemplate(
  state: AppState,
  t: PromptTemplate,
  cible: { projet?: Projet; marche?: MarcheTravaux; facture?: Facture; consultation?: Consultation; situation?: Situation },
): Record<string, string> {
  switch (t.contexte) {
    case 'projet':
      return cible.projet ? contexteProjet(state, cible.projet) : { date: fmtDate(todayISO()) }
    case 'marche':
      return cible.marche
        ? contexteMarche(state, cible.marche, cible.situation)
        : { date: fmtDate(todayISO()) }
    case 'facture':
      return cible.facture ? contexteFacture(state, cible.facture) : { date: fmtDate(todayISO()) }
    case 'consultation':
      return cible.consultation
        ? contexteConsultation(state, cible.consultation)
        : { date: fmtDate(todayISO()) }
    case 'libre':
      return { date: fmtDate(todayISO()) }
  }
}
