// ============================================================
// Fil d'urgences — entièrement en règles codées, pas d'IA ici :
// la fiabilité prime. Chaque alerte est traçable (lien vers sa
// source) et peut être mise en sommeil (snooze).
// ============================================================

import type { Alerte, AppState, Facture, MarcheTravaux } from './types'
import {
  STATUTS_ACTIFS,
  dateLimiteVerif,
  encaissementPrevu,
  factureHT,
  heuresPrevues,
  heuresReelles,
  nomProjet,
  projetById,
  retardFacture,
  retenueGarantieMarche,
} from './derive'
import { addDays, diffDays, fmtDate, fmtMoney, fmtMois, monthKey } from './util'
import { LIBELLES_IMPORTANCE, type NiveauImportance, estImportance, graviteDe } from './categorisation'
import { tacheAConfirmer } from './chantier'
import {
  corpsRelanceSituation,
  entrepriseDe,
  situationAttendueNonRecue,
  sujetRelanceSituation,
} from './entreprise'
import { SEUIL_ALERTE_VISA_JOURS, echeanceVisa } from './visas'
import { ecartMois, notesManquantes } from './cotraitants'
// La connexion bancaire directe : `src/banqueApi.ts` porte l'autorité sur
// l'état d'un consentement et sur la fraîcheur d'une synchronisation. Sa
// partie pure n'importe aucune pile réseau — ce fil doit rester calculable
// hors ligne, sur un état chargé du localStorage.
import { etatConsentement, etatSynchronisation } from './banqueApi'
// 5.16 — le cycle de vie d'une facture sur un portail agréé. `src/facture.ts`
// porte l'autorité sur « quel est le dernier statut » (le plus récent PAR
// DATE, pas le dernier élément du tableau) : l'écran Ventes, la file « à
// traiter » de `financeActions` et ce fil lisent tous les trois la MÊME
// fonction. `src/chorusApi.ts` porte les mots — le code exact du portail, qui
// est celui qu'on retrouvera sur le portail.
import { derniereTransmission } from './facture'
import { libelleCodeChorus, libellePlateformeTransmission } from './chorusApi'

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

/** Où mène un message tant qu'AUCUN écran message n'existe.
 *
 *  Les liens `#/messages/{id}` pointaient une route absente d'App.tsx : le
 *  clic retombait sur l'accueil sans un mot, plusieurs fois par jour. Tant
 *  que l'écran n'est pas livré, la destination honnête est le message
 *  lui-même, dans Gmail — `urlGmail` est déjà porté par la ligne. Sans
 *  URL, on renvoie à l'accueil, où la boîte « À traiter » montre le
 *  message : c'est la seule destination qui le contient vraiment. */
function lienDuMessage(urlGmail: string | null): string {
  return urlGmail || '#/'
}

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
      lien: lienDuMessage(m.urlGmail),
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
      lien: lienDuMessage(m.urlGmail),
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
      // L'écran de revue EXISTE désormais (lot A, `src/modules/Propositions.tsx`)
      // et l'alerte y mène directement. Elle a pointé `#/messages/propositions`
      // — une route qui n'a jamais existé — puis, faute d'écran, le registre
      // documentaire : deux destinations qui ne contenaient pas ce dont
      // l'alerte parlait.
      lien: '#/propositions',
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
        id: idFactureEnRetard(f),
        type: 'facture_retard',
        gravite: retard > 15 ? 3 : 2,
        titre: `Impayé : facture ${f.numero || f.id} en retard de ${retard} j`,
        detail: `${nomProjet(state, f.projetId)} · ${f.libelle} · ${fmtMoney(f.montantHT)} HT · échéance ${fmtDate(encaissementPrevu(f))}`,
        // T6 — l'alerte portait sur UNE facture et déposait devant la liste
        // entière : il fallait la retrouver à la main, tous les jours, sur
        // l'alerte la plus fréquente du fil. La route profonde de recherche
        // existe déjà et se dépose dans le champ de la liste
        // (`Facturation.tsx`, route `#/facturation/chercher/<terme>`) : le
        // numéro voyage dans le lien, la ligne visée est la seule affichée.
        lien: `#/facturation/chercher/${encodeURIComponent(f.numero || f.id)}`,
        date: encaissementPrevu(f),
      })
    }
  }

  // --- 5.16 : facture REJETÉE par le portail (Chorus Pro, plateforme agréée).
  //
  // C'est l'urgence la plus silencieuse de la facturation publique. Un impayé
  // finit par se voir : l'échéance passe, le retard grandit, l'alerte
  // ci-dessus se durcit. Une facture rejetée, elle, ne produit AUCUN de ces
  // signaux tant que son échéance n'est pas dépassée — et quand elle l'est, on
  // relance un payeur qui n'a jamais rien reçu d'exploitable. Elle ne sera
  // jamais payée tant que personne ne la corrige et ne la redépose.
  //
  // Le motif VOYAGE avec l'alerte. Sans lui, il faut rouvrir le portail pour
  // savoir quoi corriger, et le geste se remet à demain — ce qui est
  // exactement la façon dont un rejet devient un trimestre de trésorerie.
  // Quand le portail n'a rendu aucun motif, on le DIT au lieu d'en inventer un.
  //
  // Deux surfaces, un seul prédicat : `financeActions` produit l'action du
  // badge Finance, ce fil produit la ligne rouge du matin, et les deux lisent
  // `derniereTransmission`. Le jour où l'une des deux relirait le tableau à la
  // main, elles diraient deux choses de la même facture.
  for (const f of Array.isArray(state.factures) ? state.factures : []) {
    const transmission = derniereTransmission(f)
    if (!transmission || transmission.statut !== 'rejetee') continue
    const projet = projetById(state, f.projetId)
    alertes.push({
      id: `rejet-portail:${f.id}`,
      type: 'facture_rejetee_portail',
      // toujours 3 : il n'existe pas de rejet « à surveiller ». Tant qu'elle
      // n'est pas corrigée, la pièce est hors circuit de paiement.
      gravite: 3,
      // le mot du PORTAIL quand on l'a (« suspendue », « à compléter »…) :
      // c'est celui qu'on relira sur le portail. Les quatre voies non
      // nominales de Chorus se projettent sur « rejetée » pour le
      // comportement, jamais pour les mots.
      titre: `Facture ${f.numero || f.id} — ${
        transmission.statutPortail ? libelleCodeChorus(transmission.statutPortail) : 'rejetée'
      } par ${libellePlateformeTransmission(transmission.plateforme)}`,
      detail: [
        transmission.motif
          ? `Motif : ${transmission.motif}`
          : 'Motif non rendu par le portail — à lire sur Chorus Pro',
        `${nomProjet(state, f.projetId)} · ${fmtMoney(f.figee?.totalHT ?? f.montantHT)} HT${
          transmission.date ? ` · statut du ${fmtDate(transmission.date)}` : ''
        }`,
        'Elle ne sera pas payée tant qu’elle n’est pas corrigée et redéposée — le dépôt reste un geste humain sur le portail.',
      ].join(' — '),
      // le numéro voyage dans le lien : la ligne visée est la seule affichée
      // dans la liste des pièces (route `#/facturation/chercher/<terme>`)
      lien: `#/facturation/chercher/${encodeURIComponent(f.numero || f.id)}`,
      date: transmission.date || undefined,
      projetId: projet ? f.projetId : undefined,
    })
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
      // T6 — l'identifiant de la situation voyage dans le lien. L'onglet
      // « À vérifier » est déjà la bonne destination ; ce qui manquait,
      // c'est DE QUELLE situation on parle quand il y en a huit. Forme
      // retenue : `#/situations/<onglet>/<id>` — l'onglet en premier, comme
      // la navigation par onglets l'écrit déjà, l'élément ensuite. Elle ne
      // peut pas se confondre avec la route de recherche
      // (`#/situations/<onglet>/chercher/<terme>`) : aucun identifiant ne
      // vaut « chercher ».
      lien: `#/situations/verifier/${sit.id}`,
      date: limite,
      action: { kind: 'valider_situation', refId: sit.id, label: '✓ Valider' },
    })
  }
  // 5.20 — LE critère « situation attendue non reçue » vit dans
  // src/entreprise.ts : la fiche entreprise et ce fil doivent dire la même
  // chose le même jour. Au passage il rattrape aussi les situations reçues
  // SANS marcheId (rapprochées par projet + nom, comme l'onglet Attendues) :
  // l'alerte criait sur une situation que l'écran montrait reçue.
  for (const m of state.marches) {
    const attente = situationAttendueNonRecue(state, m, today)
    if (!attente) continue
    alertes.push({
      id: idSituationManquante(m, attente.mois),
      type: 'situation_manquante',
      gravite: attente.gravite,
      titre: `Situation attendue non reçue — ${m.entreprise} (${m.lot})`,
      detail: `${nomProjet(state, m.projetId)} · mois ${fmtMois(attente.mois)} · relance à envoyer ?`,
      // l'onglet où l'on VOIT ce qui manque, pas la tête de l'écran :
      // `#/situations` déposait devant la liste des situations reçues,
      // c'est-à-dire devant tout sauf la question posée
      lien: '#/situations/attendues',
      projetId: m.projetId,
      // le geste « Relancer » ne peut pas voyager dans `Alerte.action` (le
      // type ActionAlerte est fermé, src/types.ts) : il est résolu à
      // l'affichage par `relanceDeLAlerte` ci-dessous, avec le texte de
      // src/entreprise.ts — le même que la fiche entreprise
    })
  }

  // --- 5.7 : entreprise à confirmer — tâche de chantier démarrant sous
  // SEUIL_CONFIRMATION_JOURS (src/chantier.ts, même prédicat que l'écran
  // planning) sans que l'entreprise ait confirmé sa venue, marché actif.
  // Une entreprise qui découvre sa date deux semaines avant ne vient pas :
  // c'est le mode de retard le plus courant, et le plus prévisible.
  for (const t of state.tachesChantier) {
    const marche = t.marcheId ? state.marches.find((m) => m.id === t.marcheId) : null
    if (!marche || !tacheAConfirmer(t, marche, today)) continue
    const dj = diffDays(today, t.debut!)
    alertes.push({
      id: `confirme:${t.id}`,
      type: 'entreprise_a_confirmer',
      // sous 14 jours on est DANS le mode de défaillance connu : rouge
      gravite: dj <= 14 ? 3 : 2,
      titre: `Entreprise à confirmer — ${marche.entreprise} (${t.lot})`,
      detail: `${nomProjet(state, t.projetId)} · ${t.designation} · intervention le ${fmtDate(t.debut)} (J−${dj})`,
      lien: `#/projets/${t.projetId}/planning`,
      date: t.debut!,
      projetId: t.projetId,
      // l'humain confirme (confirmeLe posé), l'alerte s'éteint au recalcul ;
      // « Relancer » vit à l'écran planning, en brouillon Gmail — jamais
      // d'envoi automatique (§15)
      action: { kind: 'confirmer_tache', refId: t.id, label: '✓ Confirmé' },
    })
  }

  // --- 5.8 : visa non traité à J−SEUIL_ALERTE_VISA_JOURS de l'échéance du
  // CCAP (src/visas.ts — même calcul d'échéance que l'écran). Un document
  // déjà visé, même tardivement, ne s'alerte plus : le geste a été fait,
  // c'est lui qui compte. Le retard reste alertant tant que rien n'est visé
  // — un visa en retard engage la responsabilité de la MOE, le silence
  // serait exactement le défaut que ce registre corrige.
  for (const v of state.visas) {
    if (v.statut !== 'a_viser') continue
    const echeance = echeanceVisa(v)
    if (!echeance) continue
    const dj = diffDays(today, echeance)
    if (dj > SEUIL_ALERTE_VISA_JOURS) continue
    alertes.push({
      id: `visa:${v.id}`,
      type: 'visa_a_rendre',
      // échéance dépassée : la responsabilité court, rouge
      gravite: dj < 0 ? 3 : 2,
      titre:
        dj < 0
          ? `Visa en retard de ${-dj} j — ${v.document} (${v.lot})`
          : `Visa à rendre ${dj === 0 ? 'aujourd’hui' : `sous ${dj} j`} — ${v.document} (${v.lot})`,
      detail: `${nomProjet(state, v.projetId)} · reçu le ${fmtDate(v.recuLe)} · délai CCAP ${v.delaiJours} j — viser dans l'onglet Chantier`,
      lien: `#/projets/${v.projetId}/chantier`,
      date: echeance,
      projetId: v.projetId,
      // pas d'action rapide : viser demande de LIRE le document — un
      // « ✓ Visé » depuis le fil d'urgences inviterait à signer sans lire
    })
  }

  // --- 5.10 : note d'honoraires de cotraitance manquante — une alerte par
  // cotraitant ACTIF et par mois échu sans note reçue (src/cotraitants.ts :
  // même prédicat que l'écran projet — deux définitions divergeraient sans
  // que rien ne le signale). « Relancer » ouvre un BROUILLON Gmail : la
  // machine propose, l'envoi reste un clic humain (§15) — et sans adresse,
  // pas d'action : un brouillon sans destinataire n'irait nulle part.
  const moisCourant = monthKey(today)
  for (const { cotraitant, mois } of notesManquantes(state.cotraitants, state.notesHonoraires, moisCourant)) {
    // un mois de retard est un oubli de fin de mois ; deux mois, un signal —
    // le reçu s'écarte du convenu sans que personne ne le voie avant le bilan
    const retard = ecartMois(mois, moisCourant)
    alertes.push({
      id: `noteh:${cotraitant.id}:${mois}`,
      type: 'note_honoraires_manquante',
      gravite: retard >= 2 ? 3 : 2,
      titre: `Note d'honoraires manquante — ${cotraitant.nom} (${fmtMois(mois)})`,
      detail: `${nomProjet(state, cotraitant.projetId)}${cotraitant.mission ? ` · ${cotraitant.mission}` : ''} · aucune note reçue pour ${fmtMois(mois)}`,
      lien: `#/projets/${cotraitant.projetId}/finances`,
      projetId: cotraitant.projetId,
      action: cotraitant.email
        ? { kind: 'relancer_cotraitant', refId: cotraitant.id, mois, label: 'Relancer' }
        : undefined,
    })
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
      // l'onglet des retenues de garantie existe depuis le câblage des
      // sous-routes : déposer devant la liste des situations reçues, c'est
      // déposer devant tout sauf la question posée
      lien: '#/situations/rg',
      date: rg.dateLevee || undefined,
    })
  }

  // --- Connexion bancaire directe : les deux façons dont une trésorerie se
  // fige EN SILENCE.
  //
  // 1) LA RECONNEXION DES 90 JOURS. La DSP2 impose une ré-authentification
  //    forte à date fixe. Cette date est CONNUE d'avance : l'annoncer une
  //    semaine avant est le mécanisme principal ; détecter l'erreur 401
  //    `AccessExpiredError` au moment où elle tombe n'est que le filet.
  //    Attendre le filet, c'est découvrir le problème le jour où les
  //    mouvements ont déjà cessé d'entrer.
  // 2) LA SYNCHRONISATION MUETTE. Une connexion qui n'a plus rien rapporté
  //    depuis des semaines ne produit AUCUNE erreur : elle produit un écran
  //    calme, et un solde qui vieillit sans que personne ne s'en aperçoive.
  //
  // Les deux mènent à la carte de la connexion concernée
  // (`#/finance/banque/<id>`), où le bouton « Reconnecter » attend — pas en
  // haut de la liste des mouvements.
  for (const c of Array.isArray(state.connexionsBancaires) ? state.connexionsBancaires : []) {
    if (!c || !c.id) continue
    const consentement = etatConsentement(c, today)
    if (consentement.alerter) {
      const jours = consentement.jours ?? 0
      alertes.push({
        id: `banque-consentement:${c.id}`,
        type: 'banque_consentement',
        // expiré : plus rien n'entre, c'est rouge. À venir : orange, il
        // reste le temps de faire le geste tranquillement.
        gravite: consentement.expire ? 3 : 2,
        titre: consentement.expire
          ? `Banque ${c.banque} — autorisation expirée, plus aucun mouvement n'entre`
          : `Banque ${c.banque} — autorisation à renouveler sous ${jours} j`,
        detail: consentement.expire
          ? 'La banque exige une nouvelle authentification (DSP2, tous les 90 jours). Le solde affiché ne bouge plus : reconnectez, ou importez un relevé en attendant.'
          : `Fin de l'accès le ${fmtDate(c.consentementExpireLe?.slice(0, 10) || today)}. Reconnecter maintenant évite l'interruption — l'import de relevé reste le repli.`,
        lien: `#/finance/banque/${c.id}`,
        date: c.consentementExpireLe?.slice(0, 10),
      })
      continue
    }
    // Pas de double alerte : quand le consentement parle déjà, le silence de
    // la synchronisation en est la conséquence, pas une seconde nouvelle.
    const synchro = etatSynchronisation(c, today)
    if (synchro.alerter) {
      alertes.push({
        id: `banque-muette:${c.id}`,
        type: 'banque_sync_muette',
        gravite: synchro.morte ? 3 : 2,
        titre: synchro.jamais
          ? `Banque ${c.banque} — connectée mais jamais synchronisée`
          : `Banque ${c.banque} — aucune synchronisation depuis ${synchro.jours} j`,
        detail: `Le solde et les mouvements affichés datent${c.derniereSyncLe ? ` du ${fmtDate(c.derniereSyncLe)}` : ' d’avant la connexion'}. Une synchronisation à la demande suffit à rattraper.`,
        lien: `#/finance/banque/${c.id}`,
        date: c.derniereSyncLe || undefined,
      })
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
  //
  // Le lien mène là où la liste ET le geste « Relancer » vivent depuis que
  // les contacts ont déménagé : `#/ressources/contacts`. Il pointait encore
  // `#/agenda`, l'écran d'où ils sont partis — le clic arrivait sur une
  // page qui ne contient plus ni le contact, ni son geste.
  for (const c of state.contacts) {
    if (!c.dateProchaineAction || c.dateProchaineAction > today) continue
    alertes.push({
      id: `crm:${c.id}:${c.dateProchaineAction}`,
      type: 'crm',
      gravite: diffDays(c.dateProchaineAction, today) > 14 ? 2 : 1,
      titre: `CRM : ${c.nom}${c.organisme ? ` (${c.organisme})` : ''} — ${c.prochaineAction || 'action prévue'}`,
      detail: `prévu le ${fmtDate(c.dateProchaineAction)}`,
      lien: '#/ressources/contacts',
      date: c.dateProchaineAction,
    })
  }
  // Même règle, sur les ORGANISATIONS : « prochaine action » + « pour le »
  // s'y saisissent depuis le Lot 5 et aucun producteur ne les relisait —
  // une relance notée sur un acheteur ne ressortait nulle part. Un même
  // seuil, une même gravité, un même libellé : deux règles pour la même
  // notion divergeraient au premier ajustement.
  for (const o of Array.isArray(state.organisations) ? state.organisations : []) {
    if (!o || !o.dateProchaineAction || o.dateProchaineAction > today) continue
    alertes.push({
      id: `crm-org:${o.id}:${o.dateProchaineAction}`,
      type: 'crm',
      gravite: diffDays(o.dateProchaineAction, today) > 14 ? 2 : 1,
      titre: `CRM : ${o.nom}${o.type ? ` (${o.type})` : ''} — ${o.prochaineAction || 'action prévue'}`,
      detail: `prévu le ${fmtDate(o.dateProchaineAction)}`,
      lien: '#/ao/acheteurs',
      date: o.dateProchaineAction,
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
      // T6 — la fiche artisan est adressable (`Ressources.tsx`, route
      // `#/ressources/artisan/<id>`) : l'alerte y mène directement, au lieu
      // de déposer devant l'annuaire entier où il faut retrouver le nom
      // qu'on vient de lire dans le titre.
      lien: `#/ressources/artisan/${a.id}`,
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

/**
 * L'écran peut-il proposer « Vu » sur cette alerte ?
 *
 * `alertesActives` FILTRE déjà `settings.vus` ; personne ne l'écrivait, si
 * bien que le geste n'existait pas et que le champ était du code mort. Un
 * écran qui devinerait la liste des types marquables la ferait diverger de
 * celle qui filtre, et le bouton s'afficherait sur des alertes qu'il ne
 * ferait pas taire — le pire des deux mondes. Elle se demande donc, elle ne
 * se recopie pas.
 */
export function estMarquableVu(type: Alerte['type']): boolean {
  return TYPES_MARQUABLES_VUS.has(type)
}

// ------------------------------------------------------------
// Les relances proposées depuis le fil — un BROUILLON, jamais un envoi
// ------------------------------------------------------------
//
// Deux alertes montrent un problème dont le geste tient en un e-mail :
// la situation attendue qui n'arrive pas, et la facture impayée. L'alerte
// jumelle des notes d'honoraires porte déjà ce geste dans `Alerte.action`
// (`relancer_cotraitant`) — le parcours y tient en 2 clics, ici il en
// demandait 5.
//
// Pourquoi ces deux-là ne passent PAS par `Alerte.action` : le type
// `ActionAlerte` vit dans `src/types.ts`, hors du périmètre de ce lot. Le
// geste est donc résolu à l'affichage, à partir du TYPE de l'alerte, en
// REJOUANT le prédicat qui l'a produite — jamais en redécoupant son
// identifiant, ce qui ferait de la forme de l'id un contrat implicite.
//
// Le TEXTE, lui, appartient à son propriétaire : la relance de situation
// est celle de `src/entreprise.ts`, mot pour mot celle de l'onglet
// « Attendues » et de la fiche entreprise. La relance d'impayé n'avait
// aucun propriétaire — l'écran Ventes copie des PROMPTS Claude dans le
// presse-papier — elle en reçoit un ici, et c'est le seul : l'écran de
// facturation doit l'IMPORTER plutôt qu'en écrire une seconde.

/** l'identifiant d'une alerte « situation attendue non reçue » — construit
 *  à un seul endroit, pour que le producteur et le résolveur du geste ne
 *  puissent pas diverger */
function idSituationManquante(m: Pick<MarcheTravaux, 'id'>, mois: string): string {
  return `sitmanq:${m.id}:${mois}`
}

/** idem pour l'impayé */
function idFactureEnRetard(f: Pick<Facture, 'id'>): string {
  return `retard:${f.id}`
}

/** relance de premier niveau (courtoise) d'une facture échue. Volontairement
 *  factuelle et courte : elle constate un retard, elle ne le qualifie pas.
 *  La fermeté et la mise en demeure restent des rédactions humaines, dans
 *  l'écran Ventes — un fil d'urgences ne doit pas pouvoir durcir le ton
 *  d'un courrier au client d'un seul clic. */
export function sujetRelanceImpaye(f: Pick<Facture, 'numero' | 'id' | 'libelle'>): string {
  return `Facture ${f.numero || f.id} — ${f.libelle}`
}

export function corpsRelanceImpaye(
  f: Pick<Facture, 'numero' | 'id' | 'libelle' | 'montantHT'>,
  echeance: string,
  retardJours: number,
  operation: string,
  nomAgence: string,
): string {
  return (
    `Bonjour,\n\n` +
    `Sauf erreur de notre part, notre facture n° ${f.numero || f.id} (${f.libelle} — ${operation}), ` +
    `d'un montant de ${fmtMoney(f.montantHT)} HT, échue le ${fmtDate(echeance)}, reste à ce jour impayée ` +
    `(${retardJours} jours de retard).\n\n` +
    `Merci de nous indiquer la date de règlement prévue, ou de nous signaler toute pièce qui vous manquerait — ` +
    `nous vous la transmettons aussitôt.\n\nCordialement,\n${nomAgence}`
  )
}

/** un brouillon de relance proposé par le fil d'urgences */
export interface RelanceProposee {
  /** ce qui est relancé (marché ou facture) — l'écran s'en sert pour tracer
   *  le geste au clic, comme l'écran Ventes le fait déjà */
  refId: string
  /** destinataire ; `null` quand aucune adresse n'est connue — un brouillon
   *  sans destinataire n'irait nulle part, l'écran n'offre alors pas le geste */
  email: string | null
  sujet: string
  corps: string
  /** de quoi il s'agit, pour le toast de confirmation */
  quoi: string
}

/** L'e-mail de contact d'un marché : le marché d'abord (c'est l'adresse à
 *  qui l'on écrit pour CE lot), le registre entreprise en repli — la même
 *  double lecture que la fiche 5.20, jamais une troisième. */
function contactDuMarche(state: AppState, m: MarcheTravaux): string | null {
  if (m.contactEmail) return m.contactEmail
  return entrepriseDe(state, m.entrepriseId || m.entreprise)?.contactEmail || null
}

/** Le brouillon de relance d'une alerte, s'il y en a un. Pur : `today` en
 *  paramètre, aucune écriture — c'est l'écran qui ouvre Gmail, au clic. */
export function relanceDeLAlerte(state: AppState, a: Alerte, today: string): RelanceProposee | null {
  if (a.type === 'situation_manquante') {
    for (const m of Array.isArray(state.marches) ? state.marches : []) {
      const attente = situationAttendueNonRecue(state, m, today)
      if (!attente || idSituationManquante(m, attente.mois) !== a.id) continue
      return {
        refId: m.id,
        email: contactDuMarche(state, m),
        sujet: sujetRelanceSituation(m, attente.mois),
        corps: corpsRelanceSituation(m, attente.mois, state.settings.nomAgence),
        quoi: `${m.entreprise} — ${m.lot}`,
      }
    }
    return null
  }
  if (a.type === 'facture_retard') {
    for (const f of Array.isArray(state.factures) ? state.factures : []) {
      if (idFactureEnRetard(f) !== a.id) continue
      const retard = retardFacture(state, f, today)
      if (retard <= 0) return null
      const projet = projetById(state, f.projetId)
      return {
        refId: f.id,
        email: projet?.emailMOA || null,
        sujet: sujetRelanceImpaye(f),
        corps: corpsRelanceImpaye(
          f,
          encaissementPrevu(f),
          retard,
          nomProjet(state, f.projetId),
          state.settings.nomAgence,
        ),
        quoi: `facture ${f.numero || f.id}`,
      }
    }
    return null
  }
  return null
}
