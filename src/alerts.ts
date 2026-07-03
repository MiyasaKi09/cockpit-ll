// ============================================================
// Fil d'urgences — entièrement en règles codées, pas d'IA ici :
// la fiabilité prime. Chaque alerte est traçable (lien vers sa
// source) et peut être mise en sommeil (snooze).
// ============================================================

import type { Alerte, AppState } from './types'
import {
  STATUTS_ACTIFS,
  dateLimiteVerif,
  encaissementPrevu,
  factureHT,
  heuresPrevues,
  heuresReelles,
  nomProjet,
  retardFacture,
} from './derive'
import { addDays, diffDays, fmtDate, fmtMoney, fmtMois, monthKey } from './util'

/** toutes les alertes, hors snooze — pure : `today` en paramètre */
export function computeAlertes(state: AppState, today: string): Alerte[] {
  const alertes: Alerte[] = []
  const s = state.settings

  // --- Échéances de rendu : phase se terminant sous 21 jours (ou dépassée
  // de moins de 60 j) et pas intégralement facturée → rendu à préparer.
  for (const p of state.projets) {
    if (!STATUTS_ACTIFS.includes(p.statut)) continue
    for (const ph of p.phases) {
      if (!ph.fin || ph.montantHT <= 0) continue
      const dj = diffDays(today, ph.fin) // >0 : futur
      if (dj > 21 || dj < -60) continue
      if (factureHT(state, p.id, ph.code) >= ph.montantHT * 0.999) continue
      alertes.push({
        id: `rendu:${p.id}:${ph.code}`,
        type: 'echeance_rendu',
        gravite: dj < 0 ? 3 : dj <= 7 ? 3 : 2,
        titre:
          dj < 0
            ? `${p.id} · ${ph.code} — rendu dépassé de ${-dj} j`
            : `${p.id} · ${ph.code} — rendu dans ${dj} j`,
        detail: `${nomProjet(state, p.id)} · fin prévue ${fmtDate(ph.fin)} · ${fmtMoney(ph.montantHT)} HT`,
        lien: `#/projets/${p.id}`,
        date: ph.fin,
      })
    }
  }

  // --- Factures : prévues dont la date d'émission est passée → à émettre ;
  // émises dont l'encaissement prévu est dépassé → impayé.
  for (const f of state.factures) {
    if (f.statut === 'prevue' && f.emission <= today) {
      alertes.push({
        id: `emettre:${f.id}`,
        type: 'facture_a_emettre',
        gravite: diffDays(f.emission, today) > 15 ? 3 : 2,
        titre: `Facture ${f.id} à émettre (${fmtMoney(f.montantHT)} HT)`,
        detail: `${nomProjet(state, f.projetId)} · ${f.libelle} · prévue le ${fmtDate(f.emission)}`,
        lien: '#/facturation',
        date: f.emission,
      })
    }
    const retard = retardFacture(f, today)
    if (retard > 0) {
      alertes.push({
        id: `retard:${f.id}`,
        type: 'facture_retard',
        gravite: retard > 15 ? 3 : 2,
        titre: `Impayé : facture ${f.id} en retard de ${retard} j`,
        detail: `${nomProjet(state, f.projetId)} · ${f.libelle} · ${fmtMoney(f.montantHT)} HT · échéance ${fmtDate(encaissementPrevu(f))}`,
        lien: '#/facturation',
        date: encaissementPrevu(f),
      })
    }
  }

  // --- Situations : « à vérifier » (écrites par la routine) avec délai
  // contractuel de vérification ; situations mensuelles attendues manquantes.
  for (const sit of state.situations) {
    if (sit.statut !== 'a_verifier') continue
    const limite = dateLimiteVerif(state, sit)
    const dj = diffDays(today, limite)
    alertes.push({
      id: `sitverif:${sit.id}`,
      type: 'situation_a_verifier',
      gravite: dj <= 3 ? 3 : 2,
      titre: `Situation à vérifier — ${sit.entreprise} (${fmtMois(sit.mois)})`,
      detail: `${nomProjet(state, sit.projetId)} · ${sit.montantMoisHT !== null ? fmtMoney(sit.montantMoisHT) + ' HT · ' : ''}limite de vérification ${fmtDate(limite)}${sit.confiance != null ? ` · confiance routine ${Math.round(sit.confiance * 100)} %` : ''}`,
      lien: '#/situations',
      date: limite,
    })
  }
  const moisCourant = monthKey(today)
  const jourDuMois = Number(today.slice(8, 10))
  if (jourDuMois >= 10) {
    for (const m of state.marches.filter((m) => m.actif)) {
      const recue = state.situations.some((x) => x.marcheId === m.id && x.mois === moisCourant)
      if (!recue) {
        alertes.push({
          id: `sitmanq:${m.id}:${moisCourant}`,
          type: 'situation_manquante',
          gravite: jourDuMois >= 20 ? 3 : 2,
          titre: `Situation attendue non reçue — ${m.entreprise} (${m.lot})`,
          detail: `${nomProjet(state, m.projetId)} · mois ${fmtMois(moisCourant)} · relance à envoyer ?`,
          lien: '#/situations',
        })
      }
    }
  }

  // --- Dérive d'heures : réel > prévu × seuil, par projet actif.
  for (const p of state.projets) {
    if (!STATUTS_ACTIFS.includes(p.statut)) continue
    const prev = heuresPrevues(p)
    if (prev <= 0) continue
    const reel = heuresReelles(state, p.id)
    if (reel >= prev * s.seuilDeriveHeures) {
      const pct = Math.round((reel / prev) * 100)
      alertes.push({
        id: `derive:${p.id}`,
        type: 'derive_heures',
        gravite: reel >= prev ? 3 : 2,
        titre: `Dérive d'heures — ${p.id} à ${pct} % du budget`,
        detail: `${nomProjet(state, p.id)} · ${Math.round(reel)} h pointées / ${Math.round(prev)} h prévues`,
        lien: `#/projets/${p.id}`,
      })
    }
  }

  // --- Obligations réglementaires : échéance sous rappelJours.
  for (const o of state.obligations) {
    const declenche = addDays(o.echeance, -o.rappelJours)
    if (today < declenche) continue
    const dj = diffDays(today, o.echeance)
    alertes.push({
      id: `oblig:${o.id}:${o.echeance}`,
      type: 'obligation',
      gravite: dj < 0 ? 3 : dj <= 7 ? 3 : 2,
      titre:
        dj < 0
          ? `Obligation dépassée : ${o.libelle} (${-dj} j)`
          : `Obligation : ${o.libelle} — échéance ${fmtDate(o.echeance)}`,
      detail: o.organisme,
      lien: '#/agenda',
      date: o.echeance,
    })
  }

  // --- CRM : prochaine action datée et dépassée.
  for (const c of state.contacts) {
    if (!c.dateProchaineAction || c.dateProchaineAction > today) continue
    alertes.push({
      id: `crm:${c.id}:${c.dateProchaineAction}`,
      type: 'crm',
      gravite: diffDays(c.dateProchaineAction, today) > 14 ? 2 : 1,
      titre: `CRM : ${c.nom}${c.organisme ? ` (${c.organisme})` : ''} — ${c.prochaineAction || 'action prévue'}`,
      detail: `prévu le ${fmtDate(c.dateProchaineAction)}`,
      lien: '#/agenda',
      date: c.dateProchaineAction,
    })
  }

  // --- Décennales artisans expirées ou expirant sous 30 jours.
  for (const a of state.artisans) {
    if (!a.decennaleFin) continue
    const dj = diffDays(today, a.decennaleFin)
    if (dj > 30) continue
    alertes.push({
      id: `dec:${a.id}:${a.decennaleFin}`,
      type: 'decennale',
      gravite: dj < 0 ? 2 : 1,
      titre:
        dj < 0
          ? `Décennale expirée — ${a.nom}`
          : `Décennale de ${a.nom} expire le ${fmtDate(a.decennaleFin)}`,
      lien: '#/ressources',
      date: a.decennaleFin,
    })
  }

  // tri : gravité décroissante puis date croissante
  alertes.sort((x, y) => y.gravite - x.gravite || (x.date || '9999').localeCompare(y.date || '9999'))
  return alertes
}

/** filtre les alertes en sommeil */
export function alertesActives(state: AppState, today: string): Alerte[] {
  return computeAlertes(state, today).filter((a) => {
    const until = state.settings.snoozes[a.id]
    return !until || until <= today
  })
}
