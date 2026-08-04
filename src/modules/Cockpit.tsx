// ============================================================
// Cockpit — tableau de bord : météo financière, CENTRE D'ACTIONS
// (une seule file : à faire, validations attendues, à surveiller,
// information — courriers, tâches et alertes classés ensemble),
// la semaine de chacun et les repères du jour.
//
// Tout est dérivé de l'état, et RIEN n'est calculé ici : chaque
// chiffre affiché sort de derive.ts, alerts.ts ou financeActions.ts.
// La règle avait déjà été contournée — les factures à émettre étaient
// construites deux fois, ici et dans `actionsATraiter`, à partir des
// mêmes `echeancesFacturation` ; deux gravités identiques par
// coïncidence entretenue à la main. `scripts/test-accueil.cjs` le
// verrouille désormais.
//
// Règle d'or : une action financière ou contractuelle s'OUVRE et
// se vérifie d'abord ; le raccourci « marquer… » reste possible
// mais demande une confirmation explicite.
// ============================================================

import { useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Alerte, Courrier } from '../types'
import { useStore } from '../store'
import { Btn, Card, DateF, EmptyState, Icon, LienGmail, Modal, Money, Page, ResumeMessage, RowMenu, Stat, Table, confirmer, navigate, toast, useToday } from '../ui'
import type { ContexteAlertes, MessageNotifiable } from '../alerts'
import { alertesActives } from '../alerts'
import { dateDe, fusionnerBoite, urgenceDe } from '../boite'
import { LIBELLES_STATUT_TACHE, creerTache, estOuverte, estPrioriteTache, graviteDePriorite } from '../taches'
import type { Communication, FiltreCommunications } from '../communications'
import { mailsATraiterPourLaBoite, marquerTraite, useCommunications } from '../communications'
import { lienGmail } from '../util'
import {
  caCible,
  caRealiseAnnee,
  meteoFinanciere,
  phasesEnCours,
  prochainesEcheances,
  reunionsDuJour,
  semaineParPersonne,
  situationsAVerifier,
  validationsAttendues,
} from '../derive'
import type { ActionFinance } from '../financeActions'
import { actionsATraiter } from '../financeActions'
import { useNbEntrantsDistants } from '../entrants'
import { useMoi } from '../moi'
import { addDays, fmtDate, fmtHeures, fmtMoney, fmtPct, mondayOf, ouvrirGmail } from '../util'
import { useSurveillanceCtx } from '../surveillance'

// ---------- petits composants locaux ----------

const STYLE_GROUPE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--ink-3)',
  margin: '12px 2px 6px',
}

// types d'alertes déjà présents comme tâches « à faire » : pas de doublon
const TYPES_DANS_INBOX = new Set<Alerte['type']>(['situation_a_verifier', 'facture_a_emettre', 'cr_en_attente'])

/** colonne des « Repères du jour » */
function Repere({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ ...STYLE_GROUPE, margin: '0 0 6px' }}>{titre}</div>
      {children}
    </div>
  )
}

function Ligne({ children }: { children: ReactNode }) {
  return (
    <div className="small" style={{ padding: '4px 0' }}>
      {children}
    </div>
  )
}

function RienASignaler({ children }: { children: ReactNode }) {
  return <div className="muted small">{children}</div>
}

// ---------- centre d'actions : le modèle unifié ----------

/** raccourci « marquer… » : les actions financières/contractuelles portent
 *  une confirmation explicite (sinon exécution directe, toujours annulable).
 *  Il n'y a PAS de raccourci « Émettre… » : le lien « Ouvrir et vérifier »
 *  mène déjà au parcours contrôlé d'émission (numéro légal, contrôles
 *  bloquants, gel de la pièce) — un second bouton vers exactement la même
 *  adresse ne faisait que doubler la cible. */
type ActionRapide =
  | { kind: 'valider_situation'; refId: string; label: string; confirme: string }
  | { kind: 'note_faite'; refId: string; projetId: string; label: string; confirme?: undefined }

interface ItemAFaire {
  id: string
  gravite: 1 | 2 | 3
  titre: ReactNode
  detail: ReactNode
  lien: string
  /** échéance (tri + filtre « cette semaine ») */
  dateLimite?: string
  /** arrivée (tri tertiaire) */
  dateReception?: string
  pour?: string
  rapide?: ActionRapide
  marqueur: 'triangle' | 'square' | 'circle'
  /** actions spécifiques rendues telles quelles (courriers) */
  actionsSpecifiques?: ReactNode
}

/** La file du jour. `actionsFinance` est la liste que `financeActions`
 *  produit déjà pour le badge Finance : l'accueil y SÉLECTIONNE ce qui le
 *  concerne au lieu de refaire la boucle sur `echeancesFacturation`. */
function itemsAFaire(
  state: ReturnType<typeof useStore>['state'],
  today: string,
  actionsFinance: readonly ActionFinance[],
): ItemAFaire[] {
  const items: ItemAFaire[] = []
  for (const s of situationsAVerifier(state)) {
    items.push({
      id: `sit-${s.id}`,
      gravite: 3,
      titre: `Vérifier la situation — ${s.entreprise} (${s.mois})`,
      detail: `${s.projetId || 'projet à rattacher'}${s.montantMoisHT != null ? ` · ${fmtMoney(s.montantMoisHT)} HT` : ''} · déposée par la routine situations@`,
      lien: '#/situations',
      dateReception: s.dateReception,
      pour: s.pour,
      marqueur: 'triangle',
      rapide: {
        kind: 'valider_situation',
        refId: s.id,
        label: 'Marquer validée…',
        confirme: `Marquer la situation de ${s.entreprise} (${s.mois}${s.montantMoisHT != null ? `, ${fmtMoney(s.montantMoisHT)} HT` : ''}) comme VALIDÉE sans l'ouvrir ?\nLe décompte part ensuite en proposition de paiement.`,
      },
    })
  }
  for (const c of state.consultations.filter((x) => x.statut === 'a_etudier')) {
    items.push({
      id: `ao-${c.id}`,
      gravite: 2,
      titre: `Étudier la consultation — ${c.intitule}`,
      detail: `${c.acheteur || 'acheteur ?'}${c.dateLimite ? ` · remise le ${fmtDate(c.dateLimite)}` : ''} · avis Go/No-Go à donner`,
      lien: '#/ao',
      dateLimite: c.dateLimite || undefined,
      pour: c.pour,
      marqueur: 'square',
    })
  }
  // Factures à émettre : titre, détail, lien, date et gravité viennent tels
  // quels de `actionsATraiter`. Audit F0 : plus de « marquer émise » à
  // l'aveugle — le lien mène au parcours contrôlé (contrôles bloquants,
  // numéro légal, gel de la pièce).
  for (const a of actionsFinance) {
    if (a.kind !== 'emettre_facture') continue
    items.push({
      id: `fac-${a.id}`,
      gravite: a.gravite,
      titre: a.titre,
      detail: a.detail,
      lien: a.lien,
      dateLimite: a.date,
      marqueur: 'circle',
    })
  }
  for (const r of state.reunions.filter((x) => x.statut !== 'diffuse' && x.date <= today)) {
    items.push({
      id: `cr-${r.id}`,
      gravite: 2,
      titre: `Sortir le CR — ${r.titre}`,
      detail: `${r.projetId} · réunion du ${fmtDate(r.date)} · assistant CR dans l'onglet Chantier`,
      lien: `#/projets/${r.projetId}/chantier`,
      dateLimite: r.date,
      marqueur: 'circle',
    })
  }
  // B.12 — les tâches entrent dans la file du matin.
  //
  // Elles y entrent comme un `ItemAFaire` DE PLUS : le tri, le badge
  // « en retard », l'horizon à sept jours, le filtre par personne et la
  // revue séquentielle s'appliquent sans être réécrits. Une seconde file
  // à côté aurait imposé de choisir laquelle regarder le matin.
  //
  // Le bloc des notes de journal « à faire » a DISPARU d'ici, et c'est le
  // point du livrable : le palier v21 a repris ces notes en tâches
  // (`tachesDepuisNotes`). Les garder toutes les deux aurait affiché
  // chaque note reprise DEUX FOIS — une fois comme note, une fois comme
  // tâche. C'est la tâche qui reste : elle porte la source de la note,
  // l'inverse n'est pas vrai, et elle a un responsable, une priorité et
  // une échéance que la note n'avait pas.
  for (const t of state.taches || []) {
    if (!estOuverte(t)) continue
    const echeance = t.echeance ? t.echeance.slice(0, 10) : undefined
    const enRetard = !!echeance && echeance < today
    items.push({
      id: `tache-${t.id}`,
      // La priorité se projette sur la gravité par `graviteDePriorite`,
      // qui vit dans `src/taches.ts` : l'échelle des alertes a un seul
      // propriétaire, et une tâche « normale » ne doit pas entrer dans
      // les urgences — le fil cesserait d'être lu.
      gravite: enRetard ? 3 : estPrioriteTache(t.priorite) ? graviteDePriorite(t.priorite) : 1,
      titre: t.titre.length > 90 ? `${t.titre.slice(0, 90)}…` : t.titre,
      detail: [
        t.projetId || 'sans projet',
        enRetard ? 'EN RETARD' : echeance ? `pour le ${fmtDate(echeance)}` : 'sans échéance',
        LIBELLES_STATUT_TACHE[t.statut as keyof typeof LIBELLES_STATUT_TACHE] || t.statut,
      ].join(' · '),
      lien: '#/taches',
      dateLimite: echeance,
      dateReception: t.creeLe?.slice(0, 10),
      pour: t.responsable || undefined,
      marqueur: enRetard ? 'triangle' : 'circle',
    })
  }
  return items
}

/** classement unique : gravité, puis date limite, puis date de réception */
function trierAFaire(a: ItemAFaire, b: ItemAFaire): number {
  return (
    b.gravite - a.gravite ||
    (a.dateLimite || '9999').localeCompare(b.dateLimite || '9999') ||
    (a.dateReception || '9999').localeCompare(b.dateReception || '9999')
  )
}

/** exécute un raccourci « marquer… » (mutation du store) */
function executerRapide(update: ReturnType<typeof useStore>['update'], a: ActionRapide): void {
  update((d) => {
    if (a.kind === 'valider_situation') {
      const s = d.situations.find((x) => x.id === a.refId)
      if (s) s.statut = 'validee'
    } else if (a.kind === 'note_faite') {
      const n = d.projets.find((x) => x.id === a.projetId)?.journal.find((x) => x.id === a.refId)
      if (n) n.fait = true
    }
  })
}

/** menu « Reporter… » d'une alerte : 7 j, 30 j ou une date choisie */
function MenuReporter({ onReporter }: { onReporter: (jours: number | string) => void }) {
  return (
    <RowMenu
      label="Reporter"
      items={[
        { label: '7 jours', onClick: () => onReporter(7) },
        { label: '30 jours', onClick: () => onReporter(30) },
        {
          label: 'Choisir la date…',
          onClick: () => {
            const d = window.prompt('Réveiller cette alerte le (AAAA-MM-JJ) :')
            if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) onReporter(d)
            else if (d) toast('Date attendue au format AAAA-MM-JJ.', { tone: 'warn' })
          },
        },
      ]}
    />
  )
}

// ---------- la boîte « À traiter » : deux mémoires, un seul écran (A.7) ----------
//
// La file quotidienne bascule de `state.courriers` vers la table
// `communications` (A.2), qui porte le fil, le sens du message, les trois
// axes du §5.2 et un marqueur de traitement NOMINATIF (`traite_par` /
// `traite_le`) là où `Courrier.statut` n'avait qu'un booléen anonyme.
//
// La bascule se fait par FUSION, pas par remplacement. Les deux sources
// cohabitent tant qu'il reste des `Courrier` en `a_traiter` : couper
// l'ancienne avant que la nouvelle soit prouvée en production ne casserait
// pas la file — elle la viderait en silence, ce qui est pire, parce que
// rien ne le signalerait. Le retrait est un livrable à part (B.15), et sa
// condition de déclenchement est sept jours de parité mesurée.
//
// Les trois boutons sont RIGOUREUSEMENT les mêmes qu'avant : « Répondre »,
// « → Journal », « ✓ Fait ». Le remplacement de « ✓ Fait » par « Créer une
// tâche » appartient à B.3 ; le faire ici retirerait un geste avant que son
// successeur existe.

/** le filtre est une constante de module : il ne doit pas se reconstruire
 *  à chaque rendu, sans quoi la couche d'accès repagine en boucle */
const FILTRE_BOITE: FiltreCommunications = { direction: 'entrant', nonTraite: true }

/** Une ligne de la boîte, quelle que soit la mémoire d'où elle vient.
 *  Les deux sources se rejoignent ici pour être TRIÉES ENSEMBLE : deux
 *  listes l'une sous l'autre auraient reclassé l'urgent d'une source
 *  derrière l'ordinaire de l'autre. */
interface LigneATraiter {
  cle: string
  /** 0-3, l'échelle de `Courrier.urgence` et de `graviteDe` — la même */
  urgence: number
  dateReception: string
  objet: string
  de: string
  resume: string
  actionProposee: string | null
  pour: string | null
  projetId: string | null
  source: string | null
  /** le brouillon du §5.3 quand A.6 en a produit un, avec sa date */
  brouillon: { texte: string; le: string | null } | null
  /** ce que le fil d'urgences a besoin d'en savoir (A.11) — la ligne le
   *  porte plutôt que de laisser l'appelant le reconstruire depuis deux
   *  formes différentes */
  notifiable: MessageNotifiable
  /** null quand le geste n'a pas de destination (message sans projet) */
  versJournal: (() => void) | null
  traiter: () => void
  repondre: (() => void) | null
  /** B.3 — « Créer une tâche depuis ce message », en conservant sa source */
  creerTacheDepuis: () => void
}

/**
 * Construit la boîte du jour à partir des deux mémoires.
 *
 * Le dédoublonnage est la partie qui compte : le même mail existe des deux
 * côtés pendant toute la transition — la surveillance navigateur écrit un
 * `Courrier` (`src/surveillance.ts`), le cron serveur écrit une
 * `communication`. L'identifiant Gmail les réconcilie.
 *
 * C'est la ligne RELATIONNELLE qui l'emporte : elle porte le projet, les
 * axes et la signature. Mais traiter un message dont le jumeau existe
 * encore marque AUSSI le jumeau : sans cela le vieux `Courrier` ressort dès
 * que la table est hors de portée (hors ligne, cache froid), et le mail
 * réapparaît traité une fois, à traiter une autre.
 */
function useBoiteATraiter(personne: string): LigneATraiter[] {
  const { state, update, replace } = useStore()
  const moi = useMoi()
  const { lignes } = useCommunications(FILTRE_BOITE)

  const courriers = state.courriers
    .filter((c) => c.statut === 'a_traiter')
    .filter((c) => !personne || !c.pour || c.pour === personne)

  const signature = state.settings.personnes.join(' & ') || state.settings.nomAgence
  const corpsDeReponse = (objet: string) =>
    `Bonjour,\n\n` +
    `Suite à votre message « ${objet} » :\n\n[à compléter]\n\n` +
    `Cordialement,\n${signature}\n${state.settings.nomAgence}`

  // ----- ancienne mémoire : à l'identique, y compris ses gestes -----

  const traiterCourrier = (id: string) => {
    const snap = state
    update((d) => {
      const c = d.courriers.find((x) => x.id === id)
      if (c) c.statut = 'traite'
    })
    toast('Courrier traité.', { undo: () => replace(snap) })
  }

  const versJournalCourrier = (id: string) => {
    const snap = state
    update((d) => {
      const c = d.courriers.find((x) => x.id === id)
      if (!c || !c.projetId) return
      const p = d.projets.find((x) => x.id === c.projetId)
      if (!p) return
      p.journal.push({
        id: `note-${id}`,
        date: c.dateReception,
        auteur: c.pour,
        texte: `Mail de ${c.de} — ${c.objet}\n${c.resume}${c.actionProposee ? `\nAction : ${c.actionProposee}` : ''}`,
        tags: ['mail', c.type],
        // §4.2 : « chaque tâche, décision, document ou échéance issue d'un
        // e-mail doit également conserver ce lien ». Ce geste-ci est le seul
        // du dépôt qui transforme un message en autre chose ET fait
        // disparaître le message de la file : la note devient la seule trace,
        // et sans la source elle est une citation sans référence.
        source: c.source,
      })
      c.statut = 'traite'
    })
    toast('Archivé dans le journal du projet.', { undo: () => replace(snap) })
  }

  /**
   * B.3 — transforme un message en tâche SANS le faire disparaître.
   *
   * Le §4.2 est explicite : « chaque tâche, décision, document ou échéance
   * issue d'un e-mail doit également conserver ce lien ». La source porte
   * donc la même valeur que celle d'une note de journal — celle que
   * `lienGmail()` sait rouvrir, quelle que soit la mémoire d'origine.
   *
   * Le message n'est PAS marqué traité. C'est délibéré, et c'est le point
   * qui distingue B.3 de B.15 : créer la tâche est un geste d'organisation,
   * marquer traité en est un autre. Les enchaîner d'office ferait sortir de
   * la boîte un mail auquel on n'a pas encore répondu.
   */
  const creerTacheDepuisMessage = (champs: {
    titre: string
    projetId: string | null
    source: string | null
    echeance?: string | null
  }) => {
    const snap = state
    const tache = creerTache({
      titre: champs.titre,
      projetId: champs.projetId,
      // Le créateur est celui qui clique ; le responsable aussi, faute de
      // mieux. Ne rien mettre laisserait la tâche hors de « mes tâches »
      // (§8.3) et hors du plan de charge — invisible sans être perdue,
      // ce qui est pire.
      createur: moi.nom,
      responsable: moi.nom,
      echeance: champs.echeance ?? null,
      source: { type: 'message', id: champs.source },
    })
    update((d) => {
      d.taches.push(tache)
    })
    toast(`Tâche créée${champs.projetId ? ` sur ${champs.projetId}` : ''}.`, {
      undo: () => replace(snap),
    })
  }

  const deCourrier = (c: Courrier): LigneATraiter => ({
    cle: `courrier:${c.id}`,
    urgence: urgenceDe({ genre: 'courrier', courrier: c }),
    dateReception: dateDe({ genre: 'courrier', courrier: c }),
    objet: c.objet,
    de: c.de,
    resume: c.resume,
    actionProposee: c.actionProposee || null,
    pour: c.pour || null,
    projetId: c.projetId,
    source: c.source || null,
    brouillon: null,
    notifiable: {
      id: `courrier-${c.id}`,
      objet: c.objet,
      expediteur: c.de,
      projetId: c.projetId,
      importance: c.importance ?? null,
      envoyeLe: c.dateReception,
      urlGmail: lienGmail(c.source),
    },
    versJournal: c.projetId ? () => versJournalCourrier(c.id) : null,
    traiter: () => traiterCourrier(c.id),
    repondre: c.de ? () => ouvrirGmail(c.de, `Re: ${c.objet}`, corpsDeReponse(c.objet)) : null,
    creerTacheDepuis: () =>
      creerTacheDepuisMessage({
        titre: c.actionProposee?.trim() || c.objet,
        projetId: c.projetId,
        source: c.source || null,
      }),
  })

  // ----- nouvelle mémoire : mêmes gestes, écriture signée et datée -----

  /** marque le message traité, et son jumeau `Courrier` s'il en reste un.
   *  Rend `false` si l'écriture a été refusée — l'appelant ne doit alors
   *  PAS annoncer que c'est fait. */
  const marquer = async (c: Communication, jumeau: Courrier | null, fait: boolean): Promise<boolean> => {
    try {
      await marquerTraite(c, moi.nom || '', fait)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: 'warn' })
      return false
    }
    if (jumeau)
      update((d) => {
        const j = d.courriers.find((x) => x.id === jumeau.id)
        if (j) j.statut = fait ? 'traite' : 'a_traiter'
      })
    return true
  }

  const traiterMessage = async (c: Communication, jumeau: Courrier | null) => {
    if (!(await marquer(c, jumeau, true))) return
    toast(`Message traité par ${moi.nom}.`, { undo: () => void marquer(c, jumeau, false) })
  }

  const versJournalMessage = async (c: Communication, jumeau: Courrier | null) => {
    if (!c.projetId) return
    const snap = state
    // L'ordre compte : la marque de traitement part la PREMIÈRE. Si elle est
    // refusée (aucun espace partagé, aucune identité), on n'a pas encore
    // écrit de note — le message reste dans la file, visible, et rien n'est
    // à défaire. L'inverse laisserait une note orpheline sur un message qui
    // revient le lendemain.
    if (!(await marquer(c, jumeau, true))) return
    update((d) => {
      const p = d.projets.find((x) => x.id === c.projetId)
      if (!p) return
      p.journal.push({
        id: `note-${c.id}`,
        date: c.envoyeLe || c.recuLe || new Date().toISOString(),
        auteur: moi.nom || undefined,
        texte: `Mail de ${c.expediteur} — ${c.objet}\n${c.resume || c.corpsExtrait}`,
        tags: ['mail', c.typeEchange || 'autre'],
        // même exigence qu'au-dessus : la note devient la seule trace
        source: c.gmailMessageId,
      })
    })
    toast('Archivé dans le journal du projet.', {
      undo: () => {
        replace(snap)
        void marquer(c, jumeau, false)
      },
    })
  }

  const deMessage = (c: Communication, jumeau: Courrier | null): LigneATraiter => ({
    cle: `message:${c.id}`,
    // l'échelle commune aux deux mémoires vit dans `src/boite.ts`, avec le
    // tri qui la consomme : la recopier ici la ferait diverger de l'ordre
    urgence: urgenceDe({ genre: 'message', message: c, jumeau }),
    dateReception: dateDe({ genre: 'message', message: c, jumeau }),
    objet: c.objet,
    de: c.expediteur || c.expediteurAdresse,
    resume: c.corpsExtrait,
    actionProposee: null,
    pour: null,
    projetId: c.projetId,
    source: c.gmailMessageId,
    brouillon: c.resume ? { texte: c.resume, le: c.resumeLe } : null,
    notifiable: {
      id: c.id,
      objet: c.objet,
      expediteur: c.expediteur || c.expediteurAdresse,
      projetId: c.projetId,
      importance: c.importance,
      envoyeLe: c.envoyeLe,
      urlGmail: c.urlGmail,
      destinataires: c.destinataires,
      copies: c.copies,
    },
    versJournal: c.projetId ? () => void versJournalMessage(c, jumeau) : null,
    traiter: () => void traiterMessage(c, jumeau),
    creerTacheDepuis: () =>
      creerTacheDepuisMessage({
        titre: c.objet || '(sans objet)',
        projetId: c.projetId,
        source: c.gmailMessageId,
      }),
    repondre: c.expediteurAdresse
      ? () => ouvrirGmail(c.expediteurAdresse, `Re: ${c.objet}`, corpsDeReponse(c.objet))
      : null,
  })

  // ----- la fusion -----

  const adressesAgence = state.settings.equipe.map((p) => p.email || '').filter(Boolean)
  const miennes = state.settings.equipe
    .filter((p) => p.nom === (personne || moi.nom))
    .map((p) => p.email || '')
    .filter(Boolean)

  // `lignes` vaut `null` tant qu'on ne sait pas : ni réseau ni cache. On
  // n'en conclut PAS que la boîte relationnelle est vide — on n'affiche
  // que l'ancienne, et la file du jour reste celle d'hier.
  const messages = lignes ? mailsATraiterPourLaBoite(lignes, miennes, adressesAgence) : []

  return fusionnerBoite(courriers, messages).map((e) =>
    e.genre === 'message' ? deMessage(e.message, e.jumeau) : deCourrier(e.courrier),
  )
}

function LigneCourrier({ lignes }: { lignes: LigneATraiter[] }) {
  if (lignes.length === 0) return null

  return (
    <>
      {lignes.map((c) => (
        <div key={c.cle} className={`alert-item ${c.urgence === 3 ? 'alert-3' : ''}`}>
          <span className={`gmk gmk-${c.urgence === 3 ? 'triangle' : 'circle'}`} aria-hidden="true" />
          <div style={{ minWidth: 0 }}>
            <div className="alert-titre">
              <Icon name="mail" size={13} style={{ verticalAlign: '-0.15em' }} /> {c.objet}{' '}
              {c.pour && <span className="badge badge-info">{c.pour}</span>}{' '}
              {c.projetId ? (
                <a href={`#/projets/${c.projetId}`} className="badge badge-muted">
                  {c.projetId}
                </a>
              ) : (
                <span className="badge badge-warn">projet ?</span>
              )}
            </div>
            <div className="alert-detail">
              de {c.de} · {c.resume}
              {c.actionProposee && (
                <>
                  <br />
                  <strong>Action proposée :</strong> {c.actionProposee}
                </>
              )}
            </div>
            {/* le résumé d'A.6 est un BROUILLON, et il le dit lui-même :
                il ne remplace pas l'extrait ci-dessus, il s'y ajoute */}
            {c.brouillon && <ResumeMessage resume={c.brouillon.texte} le={c.brouillon.le} />}
          </div>
          <div className="alert-actions">
            {/* §4.2 : le premier geste sur un mail à traiter est souvent de le
                RELIRE en entier — le résumé ne remplace pas le message, et le
                Cockpit ne devient pas une messagerie (§4.1) */}
            <LienGmail source={c.source} bouton />
            {c.repondre && (
              <Btn small kind="primary" onClick={c.repondre} title="Ouvre un brouillon de réponse dans Gmail">
                Répondre
              </Btn>
            )}
            {c.versJournal && (
              <Btn small kind="ghost" onClick={c.versJournal} title="Archive le mail dans le journal du projet et le marque traité">
                → Journal
              </Btn>
            )}
            {/* B.3. « ✓ Fait » lui cède la place en B.15, pas avant : retirer
                un geste avant que son successeur soit éprouvé, c'est le
                retirer tout court. Les deux cohabitent le temps de la
                transition. */}
            <Btn small kind="ghost" onClick={c.creerTacheDepuis} title="Crée une tâche qui garde le lien vers ce message">
              Créer une tâche
            </Btn>
            <Btn small onClick={c.traiter}>✓ Fait</Btn>
          </div>
        </div>
      ))}
    </>
  )
}

// ---------- centre d'actions ----------

function CentreActions({ personne }: { personne: string }) {
  const { state, update, replace } = useStore()
  const today = useToday()
  const [toutAfficher, setToutAfficher] = useState(false)
  /** revue séquentielle : index dans `visibles` (null = fermée) */
  const [revue, setRevue] = useState<number | null>(null)
  /** pièces captées côté serveur — hors état local, donc lues, pas dérivées */
  const nbEntrants = useNbEntrantsDistants()
  /** la boîte « À traiter », les deux mémoires fusionnées (A.7) */
  const boite = useBoiteATraiter(personne)
  const moi = useMoi()

  const horizon = addDays(today, 7)

  // la seule construction de la file finance de la journée
  const actionsFinance = useMemo(() => actionsATraiter(state, today), [state, today])
  const validations = useMemo(
    () => validationsAttendues(state, today, actionsFinance, nbEntrants),
    [state, today, actionsFinance, nbEntrants],
  )

  const faireRapide = async (a: ActionRapide) => {
    if (a.confirme && !(await confirmer({ message: a.confirme, confirmerLabel: a.label.replace('…', '') }))) return
    const snap = state
    executerRapide(update, a)
    const libelle = a.kind === 'valider_situation' ? 'Situation validée.' : 'Note marquée faite.'
    toast(libelle, { undo: () => replace(snap) })
  }

  const reporter = (id: string, quand: number | string) => {
    const snap = state
    const date = typeof quand === 'number' ? addDays(today, quand) : quand
    update((d) => {
      d.settings.snoozes[id] = date
    })
    toast(`Alerte reportée au ${fmtDate(date)}.`, { undo: () => replace(snap) })
  }

  // action rapide d'une alerte : financière → confirmation explicite
  const executerAlerte = async (a: Alerte) => {
    const action = a.action!
    if (action.kind === 'emettre_facture') {
      // parcours contrôlé (numéro légal, contrôles, gel) — audit F0
      navigate(`/facturation/emettre/${action.refId}`)
      return
    }
    if (action.kind === 'valider_situation') {
      const ok = await confirmer({
        message: `${a.titre}\n\nMarquer comme VALIDÉE sans ouvrir la fiche ?`,
        confirmerLabel: action.label,
      })
      if (!ok) return
    }
    const snap = state
    update((d) => {
      if (action.kind === 'valider_situation') {
        const s = d.situations.find((x) => x.id === action.refId)
        if (s) s.statut = 'validee'
      } else if (action.kind === 'confirmer_tache') {
        // 5.7 — la confirmation est un fait daté, pas une case cochée :
        // la date dit QUAND l'entreprise a dit oui, ce qui compte si elle
        // se dédit ensuite. L'alerte s'éteint d'elle-même au recalcul.
        const t = d.tachesChantier.find((x) => x.id === action.refId)
        if (t) t.confirmeLe = today
      } else if (action.kind === 'obligation_faite') {
        const o = d.obligations.find((x) => x.id === action.refId)
        if (!o) return
        if (o.periodiciteMois) {
          // reconduit à la prochaine échéance (même logique qu'Agenda)
          const ym = o.echeance.slice(0, 7)
          const [y, m] = ym.split('-').map(Number)
          const totalM = m - 1 + o.periodiciteMois
          const jour = Math.min(Number(o.echeance.slice(8, 10)), 28)
          o.echeance = `${y + Math.floor(totalM / 12)}-${String((totalM % 12) + 1).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
        } else {
          d.obligations = d.obligations.filter((x) => x.id !== o.id)
        }
      }
    })
    const libelle =
      action.kind === 'valider_situation'
        ? 'Situation validée.'
        : action.kind === 'confirmer_tache'
          ? 'Entreprise confirmée.'
          : 'Obligation faite.'
    toast(libelle, { undo: () => replace(snap) })
  }

  // Le contexte d'A.11. `computeAlertes` reste pur : on lui passe ce que la
  // boîte a déjà chargé, il ne va rien chercher. Les deux sources y entrent
  // — un `Courrier` qualifié « urgent » au palier v19 alerte autant qu'une
  // `communication`, sans quoi la bascule ferait taire la moitié du fil.
  //
  // `enAttenteDeReponse` n'est PAS alimenté ici, et c'est délibéré : ce
  // producteur a besoin des fils COMPLETS pour savoir si on a répondu, or
  // cette lecture-ci est paginée et filtrée sur l'entrant non traité. La
  // nourrir avec une vue partielle produirait des relances fausses —
  // « le client attend » alors qu'on lui a répondu la veille. Un fil
  // d'urgences qui se trompe cesse d'être lu ; mieux vaut un producteur
  // muet qu'un producteur menteur.
  const contexteAlertes = useMemo<ContexteAlertes>(
    () => ({ moi: personne || moi.nom, aTraiter: boite.map((l) => l.notifiable) }),
    [boite, personne, moi.nom],
  )

  const alertes = alertesActives(state, today, contexteAlertes).filter((a) => !TYPES_DANS_INBOX.has(a.type))
  const aSurveiller = alertes.filter((a) => a.gravite === 2)
  const information = alertes.filter((a) => a.gravite === 1)

  const tous = [...itemsAFaire(state, today, actionsFinance), ...alertes.filter((a) => a.gravite === 3).map(alerteVersItem)].sort(trierAFaire)
  const filtres = personne ? tous.filter((i) => !i.pour || i.pour === personne) : tous
  // par défaut : les retards, aujourd'hui et cette semaine — le reste sur demande
  const masquables = filtres.filter((i) => i.dateLimite && i.dateLimite > horizon).length
  const visibles = toutAfficher ? filtres : filtres.filter((i) => !i.dateLimite || i.dateLimite <= horizon)

  const nbCourriers = boite.length

  function alerteVersItem(a: Alerte): ItemAFaire {
    return {
      id: `al-${a.id}`,
      gravite: 3,
      titre: a.titre,
      detail: a.detail || '',
      lien: a.lien,
      dateLimite: a.date,
      marqueur: 'triangle',
      actionsSpecifiques: (
        <>
          {a.action && (
            <Btn small onClick={() => void executerAlerte(a)} title="Raccourci — confirmation demandée pour le financier">
              {a.action.label}
            </Btn>
          )}
          <MenuReporter onReporter={(quand) => reporter(a.id, quand)} />
        </>
      ),
    }
  }

  const rendreItem = (i: ItemAFaire) => (
    <div key={i.id} className={`alert-item ${i.gravite === 3 ? 'alert-3' : ''}`}>
      <span className={`gmk gmk-${i.marqueur}`} aria-hidden="true" />
      <div style={{ minWidth: 0 }}>
        <div className="alert-titre">
          {i.titre} {i.pour && <span className="badge badge-info">{i.pour}</span>}
        </div>
        <div className="alert-detail">
          {i.detail}
          {i.dateLimite && i.dateLimite < today && (
            <>
              {' '}
              <span className="badge badge-danger">en retard</span>
            </>
          )}
        </div>
      </div>
      <div className="alert-actions">
        {i.actionsSpecifiques ?? (
          <>
            {/* l'action principale OUVRE — on vérifie avant d'agir */}
            <a className="btn btn-small btn-primary" href={i.lien}>
              Ouvrir et vérifier
            </a>
            {i.rapide && (
              <Btn
                small
                onClick={() => void faireRapide(i.rapide!)}
                title={i.rapide.confirme ? 'Raccourci — une confirmation explicite est demandée' : 'Fait sur place'}
              >
                {i.rapide.label}
              </Btn>
            )}
          </>
        )}
      </div>
    </div>
  )

  const rendreAlerte = (a: Alerte) => (
    <div key={a.id} className={`alert-item alert-${a.gravite}`}>
      <span className="alert-dot" />
      <div style={{ minWidth: 0 }}>
        <div className="alert-titre">{a.titre}</div>
        <div className="alert-detail">
          {a.detail ? <>{a.detail} · </> : null}
          <a href={a.lien}>ouvrir</a>
        </div>
      </div>
      <div className="alert-actions">
        {a.action && (
          <Btn small onClick={() => void executerAlerte(a)}>
            {a.action.label}
          </Btn>
        )}
        <MenuReporter onReporter={(quand) => reporter(a.id, quand)} />
      </div>
    </div>
  )

  return (
    <Card titre="Centre d'actions">
      {/* ---------- synthèse du jour + revue séquentielle ---------- */}
      {(visibles.length > 0 || nbCourriers > 0) && (
        <p className="small" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 10px' }}>
          <strong>
            {visibles.length + nbCourriers} décision{visibles.length + nbCourriers > 1 ? 's' : ''} aujourd'hui
          </strong>
          <span className="muted">
            · environ {visibles.reduce((s, i) => s + (i.gravite === 3 ? 4 : 2), 0) + nbCourriers * 2} min
          </span>
          {visibles.length > 0 && (
            <Btn small kind="primary" onClick={() => setRevue(0)}>
              Commencer — une décision à la fois
            </Btn>
          )}
        </p>
      )}

      {/* ---------- à faire ---------- */}
      <div style={{ ...STYLE_GROUPE, marginTop: 0 }}>À faire</div>
      <LigneCourrier lignes={boite} />
      {visibles.length === 0 && nbCourriers === 0 ? (
        <EmptyState>Rien à faire — le centre d'actions est calme.</EmptyState>
      ) : (
        visibles.map(rendreItem)
      )}
      {masquables > 0 && (
        <p className="small" style={{ margin: '6px 2px' }}>
          <Btn small kind="ghost" onClick={() => setToutAfficher(!toutAfficher)}>
            {toutAfficher
              ? 'Revenir à cette semaine'
              : `Afficher aussi ${masquables} échéance${masquables > 1 ? 's' : ''} à plus de 7 jours`}
          </Btn>
        </p>
      )}

      {/* ---------- validations attendues (CDC §8.1) ----------
          Un groupe, quatre familles : factures fournisseurs, documents du
          registre, situations de travaux, pièces arrivées côté serveur.
          Les situations figurent aussi, une par une, dans « À faire »
          au-dessus — elles y portent leur raccourci ; ici elles se
          comptent avec le reste de ce qui attend une signature. */}
      {validations.length > 0 && (
        <>
          <div style={STYLE_GROUPE}>
            Validations attendues ({validations.reduce((s, v) => s + v.nombre, 0)})
          </div>
          {validations.map((v) => (
            <div key={v.cle} className={`alert-item ${v.gravite === 3 ? 'alert-3' : ''}`}>
              <span className={`gmk gmk-${v.gravite === 3 ? 'triangle' : 'square'}`} aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <div className="alert-titre">{v.titre}</div>
                <div className="alert-detail">{v.detail}</div>
              </div>
              <div className="alert-actions">
                <a className="btn btn-small btn-primary" href={v.lien}>
                  Ouvrir et vérifier
                </a>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ---------- à surveiller ---------- */}
      {aSurveiller.length > 0 && (
        <>
          <div style={STYLE_GROUPE}>À surveiller ({aSurveiller.length})</div>
          {aSurveiller.map(rendreAlerte)}
        </>
      )}

      {/* ---------- information (repliée par défaut) ---------- */}
      {information.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ ...STYLE_GROUPE, margin: '2px', cursor: 'pointer', display: 'list-item' }}>
            Pour information ({information.length})
          </summary>
          {information.map(rendreAlerte)}
        </details>
      )}

      {/* ---------- revue séquentielle : une décision à la fois ----------
          quand un élément est traité, la liste se raccourcit : l'index
          courant pointe alors tout seul sur la décision suivante */}
      {revue !== null &&
        (visibles.length === 0 ? (
          <Modal titre="Revue terminée" onClose={() => setRevue(null)}>
            <p>Tout est passé en revue — le centre d'actions est vide. 👏</p>
            <div className="form-foot">
              <Btn kind="primary" onClick={() => setRevue(null)}>Fermer</Btn>
            </div>
          </Modal>
        ) : (
          (() => {
            const idx = Math.min(revue, visibles.length - 1)
            return (
              <Modal titre={`Décision ${idx + 1} / ${visibles.length}`} onClose={() => setRevue(null)}>
                {rendreItem(visibles[idx])}
                <p className="muted small" style={{ margin: '8px 0 0' }}>
                  « Ouvrir et vérifier » ouvre la fiche dans cet onglet — la revue reprendra ici au retour.
                  Les raccourcis retirent la décision de la file.
                </p>
                <div className="form-foot">
                  <Btn onClick={() => setRevue(Math.max(0, idx - 1))} disabled={idx === 0}>
                    ‹ Précédente
                  </Btn>
                  <Btn
                    kind="primary"
                    onClick={() => {
                      if (idx + 1 < visibles.length) setRevue(idx + 1)
                      else {
                        setRevue(null)
                        toast('Revue terminée — toutes les décisions ont été vues.', { tone: 'ok' })
                      }
                    }}
                  >
                    {idx + 1 < visibles.length ? 'Suivante ›' : 'Terminer'}
                  </Btn>
                </div>
              </Modal>
            )
          })()
        ))}
    </Card>
  )
}

// ---------- ma semaine : temps enregistré + charge prévisionnelle ----------

/**
 * Blocs 8 et 10 du §8.1. Les deux chiffres se lisent ensemble ou pas du
 * tout : 12 h pointées ne veut rien dire sans les 28 h planifiées en face.
 * Aucun des deux n'est calculé ici — `semaineParPersonne` met en regard
 * `tempsParPersonne`, `chargePlanifieeSemaine` et `capacitePersonneSemaine`.
 */
function CarteSemaine({ personne }: { personne: string }) {
  const { state } = useStore()
  const today = useToday()
  const lundi = mondayOf(today)
  const toutes = semaineParPersonne(state, lundi)
  const lignes = personne ? toutes.filter((l) => l.personne === personne) : toutes
  // vide compris : `every` sur une liste vide est vrai, et c'est le bon sens ici
  const rienAMontrer = lignes.every((l) => l.heures === 0 && l.charge === 0)

  return (
    <Card
      titre={`${personne ? `Semaine de ${personne}` : 'Semaine de l’équipe'} — du ${fmtDate(lundi)} au ${fmtDate(addDays(lundi, 6))}`}
      actions={
        <>
          <a className="btn btn-small" href="#/temps">
            Saisir le temps
          </a>
          <a className="btn btn-small btn-ghost" href="#/planning">
            Plan de charge
          </a>
        </>
      }
    >
      {rienAMontrer ? (
        <EmptyState>
          Rien à afficher cette semaine : aucune heure pointée, et aucune phase datée sur un
          projet où figure quelqu'un de l'équipe. Le temps se saisit dans « Temps » ; la charge
          vient des heures prévues des phases (onglet Phases d'un projet).
        </EmptyState>
      ) : (
        <>
          <Table head={['Personne', 'Temps enregistré', 'Charge prévue', 'Capacité', 'Charge / capacité']}>
            {lignes.map((l) => (
              <tr key={l.personne}>
                <td>{l.personne}</td>
                <td className="right num">{fmtHeures(l.heures)}</td>
                <td className="right num">{fmtHeures(l.charge)}</td>
                <td className="right num">
                  {fmtHeures(l.capacite)}
                  {l.absence > 0 && <span className="muted"> (−{fmtHeures(l.absence)} congés)</span>}
                </td>
                <td className="right">
                  {l.capacite > 0 ? (
                    // seule comparaison faite ici, et elle n'invente aucun seuil :
                    // la charge dépasse la capacité, ou elle ne la dépasse pas
                    <span className={l.charge > l.capacite ? 'danger-text' : undefined}>
                      {fmtPct(l.charge / l.capacite, 0)}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <p className="muted small" style={{ margin: '8px 2px 0' }}>
            Temps enregistré : heures pointées de la semaine, projets et hors-projet. Charge
            prévue : heures des phases actives des projets où la personne figure, réparties sur
            la durée de la phase puis entre les personnes affectées.
          </p>
        </>
      )}
    </Card>
  )
}

// ---------- module ----------

export default function Cockpit() {
  const { state } = useStore()
  const today = useToday()
  // la surveillance tourne à la racine de l'app (INT-02) — ici on ne fait que lire.
  // Seul ce chemin NAVIGATEUR porte la portée calendrier : le jeton serveur de
  // l'ingestion Gmail n'a pas accès à l'agenda, il ne pourra jamais suppléer.
  const { evenements: agendaGoogle, direct: googleEnDirect } = useSurveillanceCtx()
  const dateFR = today.split('-').reverse().join('.')

  // §8 : l'accueil est PERSONNEL. Tant que le filtre n'est pas touché, il suit
  // `useMoi()` ; quand l'application ne sait pas qui est là, `null` veut dire
  // `null` — on retombe sur « Tout » plutôt que de désigner le premier venu.
  const moi = useMoi()
  const [choixFiltre, setChoixFiltre] = useState<string | null>(null)
  const personne = choixFiltre ?? moi.nom ?? ''
  const nomsFiltre = useMemo(
    () => [
      ...new Set(
        [...(state.settings.personnes || []), ...(state.settings.equipe || []).map((p) => p.nom)].filter(Boolean),
      ),
    ],
    [state.settings.personnes, state.settings.equipe],
  )

  const meteo = meteoFinanciere(state, today)
  const excel = state.settings.dernierImportExcel

  const phases = phasesEnCours(state, today)
  const reunions = reunionsDuJour(state, today, agendaGoogle)
  const echeances = prochainesEcheances(state, today, 14)

  return (
    <Page
      titre="aujourd’hui"
      wordmark
      meta={`Décisions du jour · ${dateFR}`}
      actions={
        <span className="segmente" role="group" aria-label="Filtrer par personne">
          {['', ...nomsFiltre].map((p) => (
            <button key={p || 'tous'} aria-pressed={personne === p} onClick={() => setChoixFiltre(p)}>
              {p || 'Tout'}
            </button>
          ))}
        </span>
      }
    >
      {/* ---------- météo financière ---------- */}
      <div style={{ marginBottom: 16 }}>
        <div className="grid3">
          <Stat
            accent="yellow"
            label="Trésorerie"
            value={
              meteo.tresorerie === null ? (
                <a href="#/parametres" style={{ fontSize: 15, color: 'inherit' }}>renseigner →</a>
              ) : (
                <Money v={meteo.tresorerie} />
              )
            }
            sub={meteo.tresorerieMajLe ? `relevé du ${fmtDate(meteo.tresorerieMajLe)}` : 'solde disponible en banque'}
            tone={meteo.tresorerie !== null && meteo.tresorerie < 0 ? 'danger' : undefined}
          />
          <Stat
            accent="blue"
            label="Facturable 90 j"
            value={<Money v={meteo.facturable90j} />}
            sub="HT restant à encaisser ou à facturer sous 90 jours"
          />
          <Stat
            accent="red"
            label="Carnet"
            value={<Money v={meteo.carnetHT} />}
            sub="honoraires signés restant au carnet"
          />
        </div>
        {caCible(state) > 0 && (() => {
          const annee = Number(today.slice(0, 4))
          const ca = caRealiseAnnee(state, annee)
          const cible = caCible(state)
          const pct = ca / cible
          const couleur = pct >= 1 ? 'var(--ok)' : pct >= 0.6 ? 'var(--c-blue)' : 'var(--c-red)'
          return (
            <div className="gauge" style={{ marginTop: 12 }}>
              <a href="#/pilotage/missions" className="gauge-t" style={{ color: 'inherit', textDecoration: 'none' }}>
                CA {annee} · {fmtPct(pct, 0)}
              </a>
              <span className="gauge-bar">
                <i style={{ width: `${Math.min(100, pct * 100)}%`, background: couleur }} />
              </span>
              <span className="gauge-t muted">
                {fmtMoney(ca)} / {fmtMoney(cible)}
              </span>
            </div>
          )
        })()}
        {excel && (
          <p className="muted small" style={{ margin: '8px 2px 0' }}>
            Excel maître importé le {fmtDate(excel.date)} ({excel.fichier}) : carnet{' '}
            {fmtMoney(excel.carnetHT)}, facturé {fmtMoney(excel.factureHT)} — source maître la
            première année.
          </p>
        )}
      </div>

      {/* ---------- centre d'actions + rail latéral ---------- */}
      <div className="cockpit-cols">
        <div className="cockpit-main">
          <CentreActions personne={personne} />
          <CarteSemaine personne={personne} />
        </div>

        {/* ---------- repères du jour (rail latéral discret) ---------- */}
        <aside className="cockpit-rail">
          <Card titre={<>Repères — {fmtDate(today)}</>}>
            <div className="cockpit-rail-stack">
              {/* ---------- réunions du jour (CDC §8.1) ----------
                  Réunions de chantier saisies ici + agenda Google borné à la
                  journée. Le repli est EXPLICITE : sans session Google, une
                  liste courte se lit « rien aujourd'hui », ce qui est faux et
                  se paie en rendez-vous manqué. */}
              <Repere titre="Réunions du jour">
                {reunions.length === 0 ? (
                  <RienASignaler>Aucune réunion aujourd'hui.</RienASignaler>
                ) : (
                  reunions.map((r) => (
                    <Ligne key={r.id}>
                      <strong>{r.heure ? `${r.heure} · ` : ''}</strong>
                      {r.lien ? <a href={r.lien}>{r.titre}</a> : <strong>{r.titre}</strong>}
                      {r.detail && <div className="muted">{r.detail}</div>}
                    </Ligne>
                  ))
                )}
                {!googleEnDirect && (
                  <div className="muted small" style={{ paddingTop: 4 }}>
                    Agenda Google non connecté — seules les réunions de chantier saisies dans le
                    Cockpit sont listées. <a href="#/parametres">Se connecter</a> (la lecture du
                    calendrier ne passe que par ce navigateur).
                  </div>
                )}
              </Repere>

              {/* ---------- prochaines échéances (CDC §8.1) ----------
                  Toutes les dates qui comptent sur 14 jours : rendus de phase,
                  factures à émettre, encaissements attendus, remises d'AO,
                  réunions, obligations, relances CRM, décennales. Même
                  inventaire que la grille mensuelle — `derive.evenements`. */}
              <Repere titre="Prochaines échéances (14 jours)">
                {echeances.length === 0 ? (
                  <RienASignaler>Aucune échéance dans les quatorze jours.</RienASignaler>
                ) : (
                  <>
                    {echeances.slice(0, 8).map((e, i) => (
                      <Ligne key={`${e.date}-${i}`}>
                        <a href={e.lien} style={{ color: e.couleur, fontWeight: 600 }}>
                          {e.icon && <Icon name={e.icon} size={12} style={{ verticalAlign: '-0.1em' }} />}{' '}
                          {e.titreLong}
                        </a>
                        <div className="muted">
                          {e.date === today ? "aujourd'hui" : <DateF d={e.date} />}
                        </div>
                      </Ligne>
                    ))}
                    {echeances.length > 8 && (
                      <div className="muted small" style={{ paddingTop: 4 }}>
                        <a href="#/calendrier">
                          + {echeances.length - 8} autre{echeances.length - 8 > 1 ? 's' : ''} — voir le calendrier
                        </a>
                      </div>
                    )}
                  </>
                )}
              </Repere>

              <Repere titre="Phases en cours">
                {phases.length === 0 ? (
                  <RienASignaler>Aucune phase en cours aujourd'hui.</RienASignaler>
                ) : (
                  phases.map(({ projet, phase }) => (
                    <Ligne key={`${projet.id}-${phase.code}`}>
                      <a href={`#/projets/${projet.id}`}>
                        {projet.id} · {phase.code}
                      </a>{' '}
                      — {projet.nom}
                      <div className="muted">
                        fin prévue le <DateF d={phase.fin} />
                      </div>
                    </Ligne>
                  ))
                )}
              </Repere>
            </div>
          </Card>
        </aside>
      </div>
    </Page>
  )
}
