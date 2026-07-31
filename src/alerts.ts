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
  retenueGarantieMarche,
} from './derive'
import { addDays, diffDays, fmtDate, fmtMoney, fmtMois, monthKey } from './util'
import { LIBELLES_IMPORTANCE, type NiveauImportance, estImportance, graviteDe } from './categorisation'

// ------------------------------------------------------------
// A.11 — notifier les personnes concernées (§12.3 pt 10)
// ------------------------------------------------------------
//
// Le contexte des messages vit hors de `workspace.data` : il est chargé
// par la couche d'accès d'A.3 et mis en cache. `computeAlertes` ne va
// donc pas le chercher — on le lui passe, et il reste pur.
//
// Ce contexte porte le RÉSULTAT des sélecteurs d'A.12, pas les messages
// bruts : « à traiter » et « en attente de réponse » se définissent à un
// seul endroit. Un producteur qui redirait la définition la ferait
// diverger de l'écran qui l'affiche, sans que rien ne le signale.

/** un message, réduit à ce que le fil d'urgences a besoin d'en savoir */
export interface MessageNotifiable {
  id: string
  objet: string
  expediteur: string
  projetId: string | null
  importance: string | null
  envoyeLe: string | null
  urlGmail: string | null
  destinataires?: string[]
  copies?: string[]
}

/** une détection en attente de revue humaine */
export interface PropositionNotifiable {
  id: string
  genre: string
  projetId: string | null
}

export interface ContexteAlertes {
  /** sortie de `mailsATraiter()` — A.12 */
  aTraiter?: MessageNotifiable[]
  /** sortie de `mailsEnAttenteDeReponse()` — A.12 */
  enAttenteDeReponse?: MessageNotifiable[]
  /** propositions au statut `proposee` */
  propositions?: PropositionNotifiable[]
  /** la personne devant l'écran, pour attribuer les alertes produites */
  moi?: string | null
}

/** au-delà, un fil sans réponse cesse d'être un oubli et devient un signal */
const JOURS_AVANT_RELANCE = 3

/** Les niveaux du §5.2 qui ont leur place dans un fil d'URGENCES.
 *
 *  Les valeurs viennent du référentiel de `src/categorisation.ts`, qui est
 *  aussi le domaine SQL `niveau_importance` : les recopier à la main ici
 *  produirait un ensemble qui n'intersecte jamais la réalité, et un fil
 *  d'urgences vide ne ressemble pas à une panne — il ressemble à du calme.
 *  `estImportance()` referme la porte à la compilation. */
const IMPORTANCES_ALERTANTES = new Set<NiveauImportance>(['urgent', 'bloquant', 'contractuel'])

function alertesDesMessages(ctx: ContexteAlertes, today: string): Alerte[] {
  const sortie: Alerte[] = []

  // Un message à traiter n'est pas une urgence en soi — sinon le fil se
  // remplirait de tout le courrier. Seuls y entrent les niveaux que
  // l'agence a elle-même qualifiés d'urgents, bloquants ou contractuels.
  for (const m of ctx.aTraiter || []) {
    if (!estImportance(m.importance) || !IMPORTANCES_ALERTANTES.has(m.importance)) continue
    sortie.push({
      id: `mail-${m.id}`,
      type: 'mail_a_traiter',
      // l'échelle a un seul propriétaire : `graviteDe`. La refaire ici
      // ferait diverger le fil d'urgences de l'axe qu'il affiche.
      gravite: graviteDe(m.importance),
      titre: `Message ${LIBELLES_IMPORTANCE[m.importance].toLowerCase()} — ${m.objet || '(sans objet)'}`,
      detail: `De ${m.expediteur}. Non traité.`,
      lien: `#/messages/${m.id}`,
      date: m.envoyeLe ? m.envoyeLe.slice(0, 10) : undefined,
      pour: ctx.moi || undefined,
      projetId: m.projetId || undefined,
    })
  }

  // Un fil dont le dernier message est entrant depuis plus de trois jours :
  // ce n'est plus « à lire », c'est quelqu'un qui attend.
  for (const m of ctx.enAttenteDeReponse || []) {
    if (!m.envoyeLe) continue
    const jours = diffDays(m.envoyeLe.slice(0, 10), today)
    if (jours < JOURS_AVANT_RELANCE) continue
    sortie.push({
      id: `reponse-${m.id}`,
      type: 'reponse_attendue',
      gravite: jours >= 7 ? 3 : 2,
      titre: `Sans réponse depuis ${jours} jours — ${m.objet || '(sans objet)'}`,
      detail: `${m.expediteur} attend. Dernier message du fil, rien n'est reparti depuis.`,
      lien: `#/messages/${m.id}`,
      date: m.envoyeLe.slice(0, 10),
      pour: ctx.moi || undefined,
      projetId: m.projetId || undefined,
    })
  }

  // Les propositions sont AGRÉGÉES, et en gravité 1. Une détection n'est
  // jamais urgente : la présenter comme telle pousserait à l'accepter pour
  // faire taire l'alerte, ce que le §15 interdit précisément. On signale
  // qu'il y a de la revue en attente, on ne met pas la main dessus.
  const enAttente = (ctx.propositions || []).length
  if (enAttente > 0) {
    sortie.push({
      id: 'propositions-a-revoir',
      type: 'proposition_ia',
      gravite: 1,
      titre: `${enAttente} proposition${enAttente > 1 ? 's' : ''} à revoir`,
      detail: 'Détections issues des messages : à accepter, modifier ou ignorer.',
      lien: '#/messages/propositions',
      pour: ctx.moi || undefined,
    })
  }

  return sortie
}

/** toutes les alertes, hors snooze — pure : `today` en paramètre.
 *  `contexte` est optionnel : les cinq sites d'appel historiques n'en
 *  passent pas et continuent de compiler et de rendre exactement la même
 *  chose qu'avant. */
export function computeAlertes(state: AppState, today: string, contexte?: ContexteAlertes): Alerte[] {
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

  // --- Échéances de facturation dont la date prévue est passée → facture
  // à émettre (l'émission attribue le numéro légal — audit F0) ;
  // factures émises dont l'encaissement prévu est dépassé → impayé.
  for (const e of state.echeancesFacturation) {
    if (e.datePrevue > today) continue
    alertes.push({
      id: `emettre:${e.id}`,
      type: 'facture_a_emettre',
      gravite: diffDays(e.datePrevue, today) > 15 ? 3 : 2,
      titre: `Facture à émettre (${fmtMoney(e.montantHT)} HT)`,
      detail: `${nomProjet(state, e.projetId)} · ${e.libelle} · prévue le ${fmtDate(e.datePrevue)}`,
      lien: '#/facturation',
      date: e.datePrevue,
      action: { kind: 'emettre_facture', refId: e.id, label: '✓ Émettre' },
    })
  }
  for (const f of state.factures) {
    const retard = retardFacture(state, f, today)
    if (retard > 0) {
      alertes.push({
        id: `retard:${f.id}`,
        type: 'facture_retard',
        gravite: retard > 15 ? 3 : 2,
        titre: `Impayé : facture ${f.numero || f.id} en retard de ${retard} j`,
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
      action: { kind: 'valider_situation', refId: sit.id, label: '✓ Valider' },
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

  // --- Retenue de garantie arrivée à échéance (réception + 1 an) et non levée.
  for (const m of state.marches) {
    const rg = retenueGarantieMarche(state, m, today)
    if (rg.statut !== 'a_liberer' || rg.retenueHT <= 0) continue
    alertes.push({
      id: `rg:${m.id}`,
      type: 'rg_a_liberer',
      gravite: 2,
      titre: `Retenue de garantie à libérer — ${m.entreprise} (${m.lot})`,
      detail: `${nomProjet(state, m.projetId)} · ${fmtMoney(rg.retenueHT)} retenus · réception le ${fmtDate(rg.dateReception)}${rg.caution ? ' · caution de substitution' : ''}`,
      lien: '#/situations',
      date: rg.dateLevee || undefined,
    })
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
      action: { kind: 'obligation_faite', refId: o.id, label: '✓ Fait' },
    })
  }

  // --- Contrats de l'agence : fenêtre de renouvellement / résiliation.
  // 45 j avant la date limite, il est encore temps de renégocier ou résilier.
  for (const o of state.obligations) {
    if (!o.contrat || !o.dateRenouvellement) continue
    const declenche = addDays(o.dateRenouvellement, -45)
    if (today < declenche) continue
    const dj = diffDays(today, o.dateRenouvellement)
    if (dj < -30) continue // fenêtre passée depuis plus d'un mois : le contrat est reconduit
    alertes.push({
      id: `contrat:${o.id}:${o.dateRenouvellement}`,
      type: 'contrat_renouvellement',
      gravite: dj < 0 ? 1 : dj <= 15 ? 3 : 2,
      titre:
        dj < 0
          ? `Contrat reconduit tacitement : ${o.libelle}`
          : `Contrat à revoir : ${o.libelle} — décider avant le ${fmtDate(o.dateRenouvellement)}`,
      detail: [o.organisme, o.montantAnnuel ? `${fmtMoney(o.montantAnnuel)} / an` : null]
        .filter(Boolean)
        .join(' · '),
      lien: '#/agenda',
      date: o.dateRenouvellement,
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

  // --- CR de chantier en attente : réunion passée, CR ni relu ni diffusé.
  for (const r of state.reunions) {
    if (r.statut === 'diffuse' || r.date > today) continue
    const dj = diffDays(r.date, today)
    alertes.push({
      id: `cr:${r.id}`,
      type: 'cr_en_attente',
      gravite: dj > 3 ? 3 : 2,
      titre: `CR à sortir — ${r.titre} (${nomProjet(state, r.projetId)})`,
      detail: `réunion du ${fmtDate(r.date)} · ${r.statut === 'cr_a_relire' ? 'CR en relecture' : 'CR à générer'} · assistant dans l'onglet Chantier`,
      lien: `#/projets/${r.projetId}/chantier`,
      date: r.date,
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

  // --- Sauvegarde : tout vit dans ce navigateur — rappel doux si
  // aucun export JSON depuis 14 jours (ou jamais).
  const sauve = s.derniereSauvegarde
  if (!sauve || diffDays(sauve, today) > 14) {
    alertes.push({
      id: `sauvegarde:${sauve || 'jamais'}`,
      type: 'sauvegarde',
      gravite: 1,
      titre: sauve
        ? `Sauvegarde JSON datée du ${fmtDate(sauve)} — pensez à exporter`
        : 'Aucune sauvegarde JSON — exportez une première fois',
      detail: 'Les données vivent dans ce navigateur : un export JSON régulier les met à l’abri (30 secondes).',
      lien: '#/parametres/donnees',
    })
  }

  // tri : gravité décroissante puis date croissante
  if (contexte) alertes.push(...alertesDesMessages(contexte, today))

  alertes.sort((x, y) => y.gravite - x.gravite || (x.date || '9999').localeCompare(y.date || '9999'))
  return alertes
}

/** filtre les alertes en sommeil, et celles qu'on a déjà lues */
export function alertesActives(state: AppState, today: string, contexte?: ContexteAlertes): Alerte[] {
  const vus = state.settings.vus || {}
  return computeAlertes(state, today, contexte).filter((a) => {
    const until = state.settings.snoozes[a.id]
    if (until && until > today) return false
    // « Vu » ne vaut que pour les alertes de la mémoire des échanges : les
    // autres se règlent en agissant sur leur source, et disparaissent
    // d'elles-mêmes. Marquer vu une facture en retard la ferait taire sans
    // qu'elle soit émise.
    if (!TYPES_MARQUABLES_VUS.has(a.type)) return true
    return !vus[a.id]
  })
}

/** seules ces alertes se marquent « vu » : elles n'ont pas d'autre issue
 *  que la lecture, contrairement à une facture qu'on émet ou une situation
 *  qu'on vérifie */
const TYPES_MARQUABLES_VUS = new Set(['mail_a_traiter', 'reponse_attendue', 'proposition_ia'])
