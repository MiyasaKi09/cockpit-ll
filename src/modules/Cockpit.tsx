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
import type { Alerte, Courrier, DecompteFige, MarcheTravaux } from '../types'
import { useStore } from '../store'
import { Btn, Card, DateF, DateInput, EmptyState, Icon, LienGmail, Modal, Money, NumInput, Page, ResumeMessage, RowMenu, Select, Stat, Table, confirmer, navigate, toast, useToday } from '../ui'
import type { ContexteAlertes, MessageNotifiable, PropositionNotifiable, RelanceProposee } from '../alerts'
import { alertesActives, estMarquableVu, relanceDeLAlerte } from '../alerts'
import { dateDe, fusionnerBoite, urgenceDe } from '../boite'
import { LIBELLES_STATUT_TACHE, creerTache, estOuverte, estPrioriteTache, graviteDePriorite } from '../taches'
import type { Communication, FiltreCommunications } from '../communications'
import {
  corrigerRattachement,
  mailsATraiterPourLaBoite,
  mailsEnAttenteDeReponse,
  marquerTraite,
  useCommunications,
} from '../communications'
import { usePropositions } from '../propositions'
import { LIBELLES_IMPORTANCE, estImportance } from '../categorisation'
import { courriersARattacher, projetsCorrigibles } from '../rattachement'
import { lienGmail } from '../util'
import type { AutoritesDatees, BarreChantier, LigneChargePhase, SemaineComplete } from '../derive'
import {
  LIBELLES_PHASES,
  caCible,
  caRealiseAnnee,
  meteoFinanciere,
  nomProjet,
  nombreARattacher,
  phasesEnCours,
  prochainesEcheances,
  reunionsDuJour,
  semaineComplete,
  semaineParPersonne,
  situationsAVerifier,
  validationsAttendues,
} from '../derive'
// ---------- les autorités que `derive.ts` NE PEUT PAS importer ----------
//
// `derive.ts` est chargé hors navigateur par cinq scripts de test avec une
// liste FERMÉE de dépendances (`./miqcp`, `./facture`, `./util`, `./gpa`) :
// un import de plus les fait échouer sur « Import inattendu dans derive.ts »,
// et ces chargeurs sont hors du périmètre de ce livrable.
//
// L'accueil ne les APPELLE pas pour son compte — il ne recalcule rien : il
// les PASSE à `derive.evenements` / `derive.semaineComplete`, qui restent les
// seuls à décider ce qui compte et comment ça s'écrit. C'est le même geste
// que les pièces distantes de `validationsAttendues`, et il garantit que
// l'inventaire des dates lit la MÊME fonction que l'écran d'origine — pas
// une copie qui divergerait au premier changement de règle.
import { chevauchementsEntreprise, clePeriode, interventionsDe, periodesEnConflit } from '../planningTravaux'
import { echeanceVisa, visasEnAttente } from '../visas'
import { situationAttendueNonRecue } from '../entreprise'
import { pointResolu } from '../seanceChantier'
import { corpsRelanceNote, sujetRelanceNote } from '../cotraitants'
// B1 — l'accueil valide aussi des situations : il doit donc figer le décompte
// exactement comme l'écran des situations. Le calcul est IMPORTÉ, jamais refait.
import { empreinteDecompte, figerDecompte } from '../decompte'
import type { ActionFinance } from '../financeActions'
import { actionsATraiter } from '../financeActions'
import { useNbEntrantsDistants } from '../entrants'
import { useMoi } from '../moi'
import { addDays, diffDays, fmtDate, fmtHeures, fmtMoney, fmtPct, mondayOf, ouvrirGmail, uid } from '../util'
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

// types d'alertes déjà présents comme tâches « à faire » : pas de doublon.
//
// `mail_a_traiter` les rejoint : le message qualifié urgent, bloquant ou
// contractuel est DÉJÀ dans la boîte juste au-dessus, en tête puisqu'elle
// est triée sur cette même urgence. L'alerte le répétait une ligne plus
// bas, avec un lien qui menait ailleurs et deux gestes de moins.
// L'information portée par l'alerte — le niveau qualifié — ne se perd pas :
// elle passe en badge sur la ligne de la boîte (voir `LigneCourrier`).
//
// `reponse_attendue` (A2) N'Y ENTRE PAS, et la nuance est le tout du geste :
// le doublon de `mail_a_traiter` était gratuit parce que la boîte est déjà
// TRIÉE sur l'urgence qualifiée — l'alerte redisait le tri. Le nombre de
// jours d'attente, lui, n'est écrit nulle part dans la boîte : « ce fil
// attend depuis 5 jours » est une information que la ligne de courrier ne
// porte pas, et la faire disparaître au nom du doublon reviendrait à livrer
// A2 sans rien montrer. Elle se marque « Vu » quand le jugement humain dit
// que personne n'attend.
const TYPES_DANS_INBOX = new Set<Alerte['type']>([
  'situation_a_verifier',
  'facture_a_emettre',
  'cr_en_attente',
  'mail_a_traiter',
])

/** dépôt d'un dossier de consultation : au-delà, ce n'est pas encore le
 *  sujet du jour ; en deçà de −7, la remise est passée depuis assez
 *  longtemps pour que le statut ait dû bouger */
const HORIZON_DEPOT_JOURS = 10

/** un concours en PRODUCTION : la candidature se monte, ou le projet se
 *  dessine. Après le rendu, plus rien ne se dépose. */
const CONCOURS_EN_PRODUCTION = new Set(['candidature', 'selectionne'])

/** statuts où plus aucun dépôt n'est attendu */
const CONSULTATION_CLOSE = new Set(['no_go', 'deposee', 'gagnee', 'perdue'])

/** Les autorités passées à `derive` — constante de module : elles ne
 *  changent jamais, et les reconstruire à chaque rendu ferait recalculer la
 *  semaine entière pour rien. `today` s'y ajoute à l'usage. */
const AUTORITES_DATEES: Omit<AutoritesDatees, 'today'> = {
  interventionsDe,
  clePeriode,
  // la seule composition faite ici, et elle ne calcule rien : deux fonctions
  // de `planningTravaux` mises bout à bout, dans l'ordre que ce module impose
  periodesEnConflit: (marches: MarcheTravaux[]) => periodesEnConflit(chevauchementsEntreprise(marches)),
  visasEnAttente,
  echeanceVisa,
  situationAttendueNonRecue,
  pointResolu,
}

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

/** une tuile de météo financière rendue cliquable vers son détail — le
 *  `Stat` reste inchangé, c'est son enveloppe qui porte le lien */
function TuileLien({ href, titre, children }: { href: string; titre: string; children: ReactNode }) {
  return (
    <a href={href} title={titre} style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
      {children}
    </a>
  )
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
      // T6 / lot F — la fiche consultation est adressable : le lien porte
      // l'identifiant au lieu de déposer devant le Kanban entier, où il
      // fallait retrouver la carte qu'on vient de lire dans le titre.
      lien: `#/ao/consultations/${c.id}`,
      dateLimite: c.dateLimite || undefined,
      pour: c.pour,
      marqueur: 'square',
    })
  }
  // R5 — le dépôt raté est le risque le plus coûteux du développement
  // commercial, et il n'avait aucun rappel central : la remise se lisait
  // sur la carte Kanban, à condition d'aller voir. L'item ne concerne que
  // les dossiers ENGAGÉS (« go », ou concours en production) : rappeler
  // une remise sur un avis qu'on n'a pas encore étudié ferait deux lignes
  // pour la même consultation, dont une prématurée.
  for (const c of state.consultations) {
    if (CONSULTATION_CLOSE.has(c.statut)) continue
    const engage =
      c.statut === 'go' ||
      (c.typeAvis === 'concours' && CONCOURS_EN_PRODUCTION.has(c.concours?.etape || ''))
    if (!engage || !c.dateLimite) continue
    const dj = diffDays(today, c.dateLimite)
    if (dj > HORIZON_DEPOT_JOURS || dj < -7) continue
    const quoi = c.typeAvis === 'concours' && c.concours?.etape === 'candidature' ? 'la candidature' : 'le dossier'
    items.push({
      id: `depot-${c.id}`,
      // une remise se rate une fois : à une semaine elle est déjà rouge,
      // et une limite dépassée reste rouge tant que le statut ne bouge pas
      gravite: dj <= 7 ? 3 : 2,
      titre:
        dj < 0
          ? `Déposer ${quoi} — remise dépassée de ${-dj} j — ${c.intitule}`
          : `Déposer ${quoi} — J−${dj} — ${c.intitule}`,
      detail: `${c.acheteur || 'acheteur ?'} · remise le ${fmtDate(c.dateLimite)}${c.typeAvis === 'concours' ? ' · concours' : ''} · dossier et pièces dans Développement`,
      lien: '#/ao/dossiers',
      dateLimite: c.dateLimite,
      pour: c.pour,
      marqueur: dj <= 7 ? 'triangle' : 'square',
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

/** B1 — le bloc figé d'une situation qu'on s'apprête à valider depuis
 *  l'accueil, empreinte comprise. `null` dès que l'action ne valide rien (ou
 *  que la situation a disparu entre-temps) : on ne fabrique pas un décompte
 *  pour une situation qui n'existe plus.
 *
 *  Volontairement HORS de l'écriture : l'empreinte est asynchrone, et une
 *  écriture qui attendrait la fin d'un calcul laisserait la fenêtre où le
 *  statut est posé sans son bloc — c'est exactement ce que B1 ferme. */
async function figerSituation(
  state: ReturnType<typeof useStore>['state'],
  situationId: string | null,
  today: string,
  par: string | null,
): Promise<DecompteFige | null> {
  if (!situationId) return null
  const s = state.situations.find((x) => x.id === situationId)
  if (!s) return null
  const fige = figerDecompte(state, s, { maintenant: today, par })
  fige.empreinte = await empreinteDecompte(fige)
  return fige
}

/** exécute un raccourci « marquer… » (mutation du store).
 *
 *  B1 — valider depuis l'accueil est une validation COMME UNE AUTRE : le
 *  décompte s'y fige, sans quoi la même situation porterait deux régimes de
 *  vérité selon le bouton cliqué (figée depuis l'écran des situations,
 *  reconstituée depuis la file du matin). Le bloc est calculé par l'appelant
 *  — il est asynchrone (empreinte) et cette fonction, elle, ne l'est pas —
 *  puis rangé dans la MÊME écriture que le statut : un seul « Annuler »
 *  retire les deux. */
function executerRapide(
  update: ReturnType<typeof useStore>['update'],
  a: ActionRapide,
  fige: DecompteFige | null,
): void {
  update((d) => {
    if (a.kind === 'valider_situation') {
      const s = d.situations.find((x) => x.id === a.refId)
      if (s) {
        s.statut = 'validee'
        if (fige) s.decompteFige = fige
      }
    } else if (a.kind === 'note_faite') {
      const n = d.projets.find((x) => x.id === a.projetId)?.journal.find((x) => x.id === a.refId)
      if (n) n.fait = true
    }
  })
}

/** menu « Reporter… » d'une alerte : 7 j, 30 j ou une date choisie.
 *
 *  La date se CHOISIT, dans un champ daté du navigateur. Elle se tapait
 *  auparavant dans un `window.prompt` au format AAAA-MM-JJ — un format de
 *  machine, refusé sans explication à la moindre faute de frappe, et rien
 *  ne rappelait ce qu'était « aujourd'hui ». */
function MenuReporter({ onReporter }: { onReporter: (jours: number | string) => void }) {
  const [choixDate, setChoixDate] = useState<string | null>(null)
  const [ouvert, setOuvert] = useState(false)

  if (ouvert)
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <DateInput value={choixDate} onChange={setChoixDate} style={{ width: 150 }} />
        <Btn
          small
          kind="primary"
          disabled={!choixDate}
          onClick={() => {
            if (!choixDate) return
            setOuvert(false)
            onReporter(choixDate)
          }}
        >
          Reporter
        </Btn>
        <Btn small kind="ghost" onClick={() => setOuvert(false)}>
          Annuler
        </Btn>
      </span>
    )

  return (
    <RowMenu
      label="Reporter"
      items={[
        { label: '7 jours', onClick: () => onReporter(7) },
        { label: '30 jours', onClick: () => onReporter(30) },
        { label: 'Choisir la date…', onClick: () => setOuvert(true) },
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

/** la file « à rattacher » du module Documents, à l'identique : le même
 *  filtre que l'onglet, jamais une seconde définition — ce que l'accueil
 *  annonce et ce que l'onglet montre doivent être le même ensemble.
 *  Constante de module pour la même raison que `FILTRE_BOITE`. */
const FILTRE_A_RATTACHER: FiltreCommunications = { sansProjet: true }

/** A2 — la fenêtre des fils observés pour « quelqu'un attend une réponse ».
 *  Trente jours : au-delà, un fil sans réponse n'est plus un oubli, c'est
 *  un sujet clos ou repris ailleurs, et le fil d'urgences se remplirait
 *  d'archéologie. */
const JOURS_DE_FILS = 30

/** assez pour un mois de courrier à deux ; au-delà, la page suivante ne
 *  contiendrait que des messages PLUS ANCIENS (voir le commentaire d'A2) */
const TAILLE_FILS = 200

/** A1bis — la file de revue du §8.7, telle que l'écran des propositions la
 *  définit : le même filtre, jamais une seconde définition */
const FILTRE_PROPOSITIONS = { statut: 'proposee' as const }

/** Ce que le fil d'urgences a besoin de savoir d'un message (A.11).
 *
 *  Écrit UNE fois : la boîte du jour et la lecture des fils d'A2 le
 *  produisent toutes les deux, et deux traductions du même message
 *  divergeraient au premier champ ajouté — sans que rien ne le signale,
 *  puisque les deux alertes continueraient de s'afficher. */
function notifiableDuMessage(c: Communication): MessageNotifiable {
  return {
    id: c.id,
    objet: c.objet,
    expediteur: c.expediteur || c.expediteurAdresse,
    projetId: c.projetId,
    importance: c.importance,
    envoyeLe: c.envoyeLe,
    urlGmail: c.urlGmail,
    destinataires: c.destinataires,
    copies: c.copies,
  }
}

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
  /** S1 — rattacher le message à un projet SANS quitter l'accueil. La
   *  cascade refuse de deviner (A.4) et son refus s'affiche ici en
   *  « projet ? » : il faut donc que le geste soit ici aussi. */
  rattacher: (projetId: string) => void
}

/** la boîte du jour, et de quoi en voir la suite */
interface Boite {
  lignes: LigneATraiter[]
  /** d'autres messages non traités attendent derrière la page courante */
  suite: boolean
  chargerSuite: () => void
  chargement: boolean
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
function useBoiteATraiter(personne: string): Boite {
  const { state, update, replace } = useStore()
  const moi = useMoi()
  const { lignes, suite, chargerSuite, chargement, recharger } = useCommunications(FILTRE_BOITE)

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

  const rattacherCourrier = (id: string, projetId: string) => {
    const snap = state
    update((d) => {
      const c = d.courriers.find((x) => x.id === id)
      if (c) c.projetId = projetId
    })
    toast(`Message rattaché à ${projetId}.`, { undo: () => replace(snap) })
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
    rattacher: (projetId: string) => rattacherCourrier(c.id, projetId),
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

  /**
   * S1 — le rattachement se corrige depuis l'accueil.
   *
   * L'écriture passe par `corrigerRattachement` (src/communications.ts),
   * la MÊME que la file « À rattacher » de Documents : elle signe, date et
   * commande la colonne générée du projet. Une écriture directe ici
   * produirait un rattachement anonyme que le serveur reprendrait à la
   * prochaine proposition.
   *
   * Pas de règle « adresse → projet » apprise depuis l'accueil : cette
   * décision-là mérite sa case à cocher et sa liste consultable, elles
   * vivent dans Documents. Un apprentissage implicite, en un clic, dans
   * une file qu'on traite vite, serait une règle qu'on ne retrouve plus le
   * jour où elle se trompe.
   */
  const rattacherMessage = async (c: Communication, projetId: string) => {
    const defaire = async () => {
      try {
        await corrigerRattachement(c, null, moi.nom || '')
        recharger()
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), { tone: 'warn' })
      }
    }
    try {
      await corrigerRattachement(c, projetId, moi.nom || '')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: 'warn' })
      return
    }
    recharger()
    toast(`Message rattaché à ${projetId}.`, { undo: () => void defaire() })
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
    notifiable: notifiableDuMessage(c),
    versJournal: c.projetId ? () => void versJournalMessage(c, jumeau) : null,
    traiter: () => void traiterMessage(c, jumeau),
    rattacher: (projetId: string) => void rattacherMessage(c, projetId),
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
  // R5 — « Tout » doit montrer TOUT. Le filtre retombait sur `moi.nom` dès
  // qu'aucune personne n'était choisie : « Tout » masquait alors les
  // messages nommément adressés à l'autre associée. À deux, la semaine où
  // l'une couvre l'autre, c'est exactement la moitié du courrier qui
  // disparaît sans un mot. Une liste d'adresses VIDE fait rendre la file
  // entière par `mailsATraiterPourLaBoite` — c'est son contrat.
  const miennes = personne
    ? state.settings.equipe
        .filter((p) => p.nom === personne)
        .map((p) => p.email || '')
        .filter(Boolean)
    : []

  // `lignes` vaut `null` tant qu'on ne sait pas : ni réseau ni cache. On
  // n'en conclut PAS que la boîte relationnelle est vide — on n'affiche
  // que l'ancienne, et la file du jour reste celle d'hier.
  const messages = lignes ? mailsATraiterPourLaBoite(lignes, miennes, adressesAgence) : []

  return {
    lignes: fusionnerBoite(courriers, messages).map((e) =>
      e.genre === 'message' ? deMessage(e.message, e.jumeau) : deCourrier(e.courrier),
    ),
    // S2 — une file tronquée ressemble à une file finie. La couche d'accès
    // pagine ; tant qu'il reste une page, l'écran le DIT et propose de la
    // charger, au lieu d'afficher cinquante messages comme s'ils étaient
    // les seuls.
    suite,
    chargerSuite,
    chargement,
  }
}

/**
 * S1 — le badge « projet ? » DEVIENT le geste.
 *
 * Il signalait le problème et laissait aller le régler dans Documents :
 * on voyait à l'accueil ce qu'on devait corriger ailleurs. Le sélecteur
 * s'ouvre sur place, la liste des projets est celle de la cascade
 * (`projetsCorrigibles`, src/rattachement.ts — terminés en dernier), et
 * l'écriture est celle de Documents.
 *
 * Le composant `ChoixRattachement` de Documents.tsx n'est pas exporté :
 * ce qu'il fallait partager — la liste des projets et l'écriture signée —
 * l'est, et c'est là que vit le risque de divergence, pas dans le `Select`.
 */
function BadgeProjet({ ligne }: { ligne: LigneATraiter }) {
  const { state } = useStore()
  const [ouvert, setOuvert] = useState(false)
  const [choix, setChoix] = useState('')

  if (ligne.projetId)
    return (
      <a href={`#/projets/${ligne.projetId}`} className="badge badge-muted">
        {ligne.projetId}
      </a>
    )

  if (!ouvert)
    return (
      <button
        className="badge badge-warn"
        style={{ cursor: 'pointer' }}
        onClick={() => setOuvert(true)}
        title="Choisir le projet sans quitter l'accueil"
      >
        projet ? — rattacher
      </button>
    )

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <Select
        value={choix}
        onChange={setChoix}
        style={{ maxWidth: 280 }}
        options={[
          { value: '', label: '— choisir un projet —' },
          ...projetsCorrigibles(state).map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
        ]}
      />
      <Btn
        small
        kind="primary"
        disabled={!choix}
        onClick={() => {
          if (!choix) return
          setOuvert(false)
          ligne.rattacher(choix)
        }}
      >
        Rattacher
      </Btn>
      <Btn small kind="ghost" onClick={() => setOuvert(false)}>
        Annuler
      </Btn>
    </span>
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
              {/* T6 — le niveau qualifié (urgent / bloquant / contractuel)
                  s'affiche ICI, sur la ligne du message, au lieu d'être
                  redit une ligne plus bas par une alerte jumelle dont le
                  lien ne menait nulle part. La file est déjà triée dessus. */}
              {estImportance(c.notifiable.importance) && (
                <>
                  <span className={`badge ${c.urgence === 3 ? 'badge-danger' : 'badge-warn'}`}>
                    {LIBELLES_IMPORTANCE[c.notifiable.importance]}
                  </span>{' '}
                </>
              )}
              {c.pour && <span className="badge badge-info">{c.pour}</span>}{' '}
              <BadgeProjet ligne={c} />
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
  /** la file « à rattacher » : deux mémoires, l'une dérivée de l'état
   *  (`courriersARattacher`), l'autre lue sur l'espace partagé. La
   *  composition — et la règle « null n'est pas 0 » — appartient à
   *  `derive.nombreARattacher`, que l'onglet Documents lit aussi. */
  const messagesSansProjet = useCommunications(FILTRE_A_RATTACHER)
  const nbARattacher = nombreARattacher(
    courriersARattacher(state).length,
    messagesSansProjet.lignes?.length ?? null,
  )
  /** la boîte « À traiter », les deux mémoires fusionnées (A.7) */
  const boite = useBoiteATraiter(personne)
  const moi = useMoi()

  const horizon = addDays(today, 7)

  // la seule construction de la file finance de la journée
  const actionsFinance = useMemo(() => actionsATraiter(state, today), [state, today])
  const validations = useMemo(
    () => validationsAttendues(state, today, actionsFinance, nbEntrants, nbARattacher),
    [state, today, actionsFinance, nbEntrants, nbARattacher],
  )

  const faireRapide = async (a: ActionRapide) => {
    if (a.confirme && !(await confirmer({ message: a.confirme, confirmerLabel: a.label.replace('…', '') }))) return
    const snap = state
    // B1 — le décompte se fige AVANT l'écriture, comme au bouton « Valider »
    // de l'écran des situations : le papier remis à l'entreprise se
    // réimprimera à l'identique, et l'« Annuler » du toast retire le bloc en
    // même temps que le statut
    const fige = await figerSituation(state, a.kind === 'valider_situation' ? a.refId : null, today, moi.nom)
    executerRapide(update, a, fige)
    const libelle = a.kind === 'valider_situation' ? 'Situation validée.' : 'Note marquée faite.'
    toast(libelle, { undo: () => replace(snap) })
  }

  /**
   * A3 — « Vu », le jumeau du report.
   *
   * `alertesActives` filtre déjà `settings.vus` ; personne ne l'écrivait,
   * si bien que le champ était du code mort. Le manque devient criant dès
   * que les propositions et les réponses attendues parlent : ces alertes-là
   * n'ont pas d'autre issue que la lecture — il n'y a rien à « faire », et
   * les reporter de sept jours ne fait que déplacer le bruit.
   *
   * `estMarquableVu` décide, pas l'écran : la liste des types vit dans
   * `src/alerts.ts`, avec le filtre qui la consomme.
   */
  const marquerVu = (a: Alerte) => {
    const snap = state
    update((d) => {
      d.settings.vus = { ...(d.settings.vus || {}), [a.id]: today }
    })
    toast('Marquée vue — elle ne reviendra plus.', { undo: () => replace(snap) })
  }

  const boutonVu = (a: Alerte) =>
    estMarquableVu(a.type) ? (
      <Btn small kind="ghost" onClick={() => marquerVu(a)} title="Lue et prise en compte : cette alerte ne reviendra plus">
        Vu
      </Btn>
    ) : null

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
    if (action.kind === 'relancer_cotraitant') {
      // 5.10 — un BROUILLON s'ouvre, rien ne s'écrit ni ne part (§15) : le
      // texte vient de src/cotraitants.ts, le même que l'écran projet — deux
      // rédactions divergeraient sans que rien ne le signale
      const c = state.cotraitants.find((x) => x.id === action.refId)
      if (!c?.email) return
      ouvrirGmail(
        c.email,
        sujetRelanceNote(c, action.mois),
        corpsRelanceNote(c, action.mois, nomProjet(state, c.projetId), state.settings.nomAgence),
      )
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
    // B1 — même règle qu'au bouton « Valider » de l'écran des situations :
    // le décompte se fige à la VALIDATION, dans la même écriture que le
    // statut. Sans cela, la situation validée depuis le fil d'alertes
    // repartirait en régime « reconstitué » et la même situation aurait deux
    // papiers possibles selon l'endroit d'où on a cliqué.
    const fige = await figerSituation(
      state,
      action.kind === 'valider_situation' ? action.refId : null,
      today,
      moi.nom,
    )
    update((d) => {
      if (action.kind === 'valider_situation') {
        const s = d.situations.find((x) => x.id === action.refId)
        if (s) {
          s.statut = 'validee'
          if (fige) s.decompteFige = fige
        }
      } else if (action.kind === 'confirmer_tache') {
        // 5.7 — la confirmation est un fait daté, pas une case cochée :
        // la date dit QUAND l'entreprise a dit oui, ce qui compte si elle
        // se dédit ensuite. L'alerte s'éteint d'elle-même au recalcul.
        const t = d.tachesChantier.find((x) => x.id === action.refId)
        if (t) t.confirmeLe = today
      } else if (action.kind === 'confirmer_periode') {
        // 5.23 — même fait daté, mais porté par LA PÉRIODE : une entreprise
        // qui revient en juin se reconfirme, et la confirmation de février
        // reste où elle est. Confirmer le mauvais passage serait pire que ne
        // rien confirmer — on croirait le retour couvert.
        const p = d.marches
          .find((m) => m.id === action.refId)
          ?.interventions?.find((x) => x.id === action.periodeId)
        if (p) p.confirmeLe = today
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
        : action.kind === 'confirmer_tache' || action.kind === 'confirmer_periode'
          ? 'Entreprise confirmée.'
          : 'Obligation faite.'
    toast(libelle, { undo: () => replace(snap) })
  }

  /**
   * S1 — « Relancer » sur l'alerte elle-même.
   *
   * Deux alertes montraient un problème dont le geste tient en un e-mail
   * — situation attendue non reçue, facture impayée — et renvoyaient à un
   * écran où il fallait retrouver la ligne : 5 gestes là où l'alerte
   * jumelle des notes d'honoraires en demande 2.
   *
   * Un BROUILLON s'ouvre, rien ne part : `ouvrirGmail` → `gmailComposeUrl`,
   * le clic final est humain (§15). Le texte vient de `src/alerts.ts`, qui
   * le tient de `src/entreprise.ts` pour les situations — le même que
   * l'onglet « Attendues » et la fiche entreprise.
   */
  const relancer = (a: Alerte, r: RelanceProposee) => {
    if (!r.email) return
    ouvrirGmail(r.email, r.sujet, r.corps)
    if (a.type !== 'facture_retard') {
      toast(`Brouillon de relance ouvert — ${r.quoi}.`, { tone: 'ok' })
      return
    }
    // La trace est posée au clic, exactement comme l'écran Ventes le fait
    // aujourd'hui : sans elle, la colonne « Dernière relance » afficherait
    // « jamais » sur une facture relancée le matin même.
    const snap = state
    update((d) => {
      const f = d.factures.find((x) => x.id === r.refId)
      if (!f) return
      f.derniereRelance = today
      f.niveauRelance = 0
      f.relances = [...(f.relances || []), { date: today, niveau: 0 }]
    })
    toast(`Brouillon ouvert, relance tracée — ${r.quoi}.`, { undo: () => replace(snap) })
  }

  /** le geste de relance quand l'alerte en porte un ET qu'une adresse est
   *  connue — un brouillon sans destinataire n'irait nulle part, et un
   *  bouton qui ne mène nulle part use la confiance dans tous les autres */
  const boutonRelance = (a: Alerte) => {
    const r = relanceDeLAlerte(state, a, today)
    if (!r?.email) return null
    return (
      <Btn small onClick={() => relancer(a, r)} title={`Ouvre un brouillon Gmail vers ${r.email}`}>
        Relancer
      </Btn>
    )
  }

  // Le contexte d'A.11. `computeAlertes` reste pur : on lui passe ce que la
  // boîte a déjà chargé, il ne va rien chercher. Les deux sources y entrent
  // — un `Courrier` qualifié « urgent » au palier v19 alerte autant qu'une
  // `communication`, sans quoi la bascule ferait taire la moitié du fil.
  //
  // A2 — « le client attend depuis 5 jours ».
  //
  // Ce producteur ne peut PAS se nourrir de la boîte : elle est filtrée sur
  // l'entrant non traité, et un fil vu à travers ce filtre paraît toujours
  // sans réponse — « le client attend » alors qu'on lui a répondu la veille.
  // D'où cette lecture DÉDIÉE, dans les deux sens et sans filtre de
  // traitement : `mailsEnAttenteDeReponse` élit le dernier message de chaque
  // fil, et un fil dont le dernier message est sortant sort de lui-même.
  //
  // Sur la troncature, qui est le seul risque restant : la page est triée du
  // plus RÉCENT au plus ancien, et une réponse est toujours postérieure au
  // message qu'elle répond. Si l'entrant est dans la fenêtre, la réponse y
  // est aussi. Tronquer ne peut donc que faire MANQUER une attente, jamais
  // en inventer une — un producteur muet vaut mieux qu'un producteur menteur.
  const depuis = useMemo(() => `${addDays(today, -JOURS_DE_FILS)}T00:00:00Z`, [today])
  const filtreFils = useMemo<FiltreCommunications>(() => ({ depuis }), [depuis])
  const { lignes: fils } = useCommunications(filtreFils, TAILLE_FILS)
  const enAttenteDeReponse = useMemo(
    () => (fils ? mailsEnAttenteDeReponse(fils).map(notifiableDuMessage) : undefined),
    [fils],
  )

  // A1bis — l'alerte agrégée « N propositions à revoir » ne s'allumait
  // jamais : personne ne passait `ctx.propositions`. La file de revue est
  // celle de l'écran (`statut: 'proposee'`), pas une seconde définition.
  // `null` (ni réseau ni cache) reste `undefined` ici : « on ne sait pas »
  // n'est pas « il n'y en a pas », et aucune des deux ne doit faire crier
  // le fil.
  const { lignes: propositions } = usePropositions(FILTRE_PROPOSITIONS)
  const propositionsNotifiables = useMemo<PropositionNotifiable[] | undefined>(
    () =>
      propositions
        ? propositions.map((p) => ({ id: p.id, genre: p.genre, projetId: p.message.projetId }))
        : undefined,
    [propositions],
  )

  const contexteAlertes = useMemo<ContexteAlertes>(
    () => ({
      moi: personne || moi.nom,
      aTraiter: boite.lignes.map((l) => l.notifiable),
      enAttenteDeReponse,
      propositions: propositionsNotifiables,
    }),
    [boite.lignes, personne, moi.nom, enAttenteDeReponse, propositionsNotifiables],
  )

  const alertes = alertesActives(state, today, contexteAlertes).filter((a) => !TYPES_DANS_INBOX.has(a.type))
  const aSurveiller = alertes.filter((a) => a.gravite === 2)
  const information = alertes.filter((a) => a.gravite === 1)

  const tous = [...itemsAFaire(state, today, actionsFinance), ...alertes.filter((a) => a.gravite === 3).map(alerteVersItem)].sort(trierAFaire)
  const filtres = personne ? tous.filter((i) => !i.pour || i.pour === personne) : tous
  // par défaut : les retards, aujourd'hui et cette semaine — le reste sur demande
  const masquables = filtres.filter((i) => i.dateLimite && i.dateLimite > horizon).length
  const visibles = toutAfficher ? filtres : filtres.filter((i) => !i.dateLimite || i.dateLimite <= horizon)

  const nbCourriers = boite.lignes.length

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
          {/* T6 — une alerte rouge garde son atterrissage : les actions
              rapides la remplaçaient, et la ligne la plus grave de la file
              était la seule qu'on ne pouvait pas ouvrir. */}
          <a className="btn btn-small btn-primary" href={a.lien}>
            Ouvrir et vérifier
          </a>
          {boutonRelance(a)}
          {a.action && (
            <Btn small onClick={() => void executerAlerte(a)} title="Raccourci — confirmation demandée pour le financier">
              {a.action.label}
            </Btn>
          )}
          {boutonVu(a)}
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
        {boutonRelance(a)}
        {a.action && (
          <Btn small onClick={() => void executerAlerte(a)}>
            {a.action.label}
          </Btn>
        )}
        {boutonVu(a)}
        <MenuReporter onReporter={(quand) => reporter(a.id, quand)} />
      </div>
    </div>
  )

  // Parcours 1 — la revue séquentielle couvre TOUTE la file du matin.
  //
  // Elle s'arrêtait aux items et sautait les courriers : le geste du lundi
  // matin — dépouiller la boîte — était justement celui qui n'avait pas son
  // mode « une décision à la fois ». Les messages passent en premier, dans
  // l'ordre où la boîte les a triés (urgence, puis date) ; les items du
  // reste de la file suivent, dans leur ordre à eux. Aucun des deux tris
  // n'est refait ici.
  const revueEntrees: { cle: string; rendu: ReactNode }[] = [
    ...boite.lignes.map((l) => ({ cle: l.cle, rendu: <LigneCourrier lignes={[l]} /> })),
    ...visibles.map((i) => ({ cle: i.id, rendu: rendreItem(i) })),
  ]

  return (
    <Card titre="Centre d'actions">
      {/* ---------- synthèse du jour + revue séquentielle ---------- */}
      {revueEntrees.length > 0 && (
        <p className="small" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 10px' }}>
          <strong>
            {visibles.length + nbCourriers} décision{visibles.length + nbCourriers > 1 ? 's' : ''} aujourd'hui
          </strong>
          <span className="muted">
            · environ {visibles.reduce((s, i) => s + (i.gravite === 3 ? 4 : 2), 0) + nbCourriers * 2} min
          </span>
          <Btn small kind="primary" onClick={() => setRevue(0)}>
            Commencer — une décision à la fois
          </Btn>
        </p>
      )}

      {/* ---------- à faire ---------- */}
      <div style={{ ...STYLE_GROUPE, marginTop: 0 }}>À faire</div>
      <LigneCourrier lignes={boite.lignes} />
      {/* S2 — une file tronquée ressemble à une file finie : tant qu'il
          reste une page de messages non traités, l'écran le dit. */}
      {boite.suite && (
        <p className="small" style={{ margin: '6px 2px' }}>
          <Btn small kind="ghost" onClick={boite.chargerSuite} disabled={boite.chargement}>
            {boite.chargement ? 'Chargement…' : 'Charger la suite des messages non traités'}
          </Btn>{' '}
          <span className="muted">la boîte s'affiche par pages — d'autres messages attendent derrière</span>
        </p>
      )}
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
          Un groupe, cinq familles : factures fournisseurs, documents du
          registre, situations de travaux, pièces arrivées côté serveur et
          messages sans projet à rattacher.
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
        (revueEntrees.length === 0 ? (
          <Modal titre="Revue terminée" onClose={() => setRevue(null)}>
            <p>Tout est passé en revue — le centre d'actions est vide. 👏</p>
            <div className="form-foot">
              <Btn kind="primary" onClick={() => setRevue(null)}>Fermer</Btn>
            </div>
          </Modal>
        ) : (
          (() => {
            const idx = Math.min(revue, revueEntrees.length - 1)
            return (
              <Modal titre={`Décision ${idx + 1} / ${revueEntrees.length}`} onClose={() => setRevue(null)}>
                {/* la clé remonte l'identité de la décision : passer à la
                    suivante repart d'un état neuf (sélecteur de projet
                    ouvert, date de report saisie) plutôt que d'hériter de
                    celui de la précédente */}
                <div key={revueEntrees[idx].cle}>{revueEntrees[idx].rendu}</div>
                <p className="muted small" style={{ margin: '8px 0 0' }}>
                  Courriers d'abord, puis le reste de la file. « Ouvrir et vérifier » ouvre la fiche
                  dans cet onglet — la revue reprendra ici au retour. Traiter, rattacher ou classer
                  retire la décision de la file.
                </p>
                <div className="form-foot">
                  <Btn onClick={() => setRevue(Math.max(0, idx - 1))} disabled={idx === 0}>
                    ‹ Précédente
                  </Btn>
                  <Btn
                    kind="primary"
                    onClick={() => {
                      if (idx + 1 < revueEntrees.length) setRevue(idx + 1)
                      else {
                        setRevue(null)
                        toast('Revue terminée — toutes les décisions ont été vues.', { tone: 'ok' })
                      }
                    }}
                  >
                    {idx + 1 < revueEntrees.length ? 'Suivante ›' : 'Terminer'}
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

// ==========================================================================
// LA SEMAINE — sept colonnes, quatre bandes, un seul écran.
//
// Ce n'est pas un écran de plus : c'est l'accueil, qui avait déjà l'horizon
// de sept jours et le bouton « Revenir à cette semaine », et qui cesse
// d'être à moitié aveugle. Rien n'est calculé ici — `derive.semaineComplete`
// assemble les quatre bandes, l'écran les rend.
//
// Un seul `Table` porte les quatre bandes : c'est lui qui donne, sous
// 700 px, le repli en cartes empilées avec le nom du jour en libellé
// (`.table-cartes`, `data-label`). Aucun composant mobile séparé — l'outil
// sert SUR le chantier, avec le même écran, plus ou moins déplié.
// ==========================================================================

const JOURS_COURTS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

/** « mardi 11 » — l'index du jour se lit sur la date, sans horloge */
function libelleJour(iso: string): string {
  const js = (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7
  return `${JOURS_COURTS[js]} ${Number(iso.slice(8, 10))}`
}

/** deux entreprises au même endroit au même moment : on le HACHURE, on ne
 *  le corrige pas — la machine propose, l'humain décide */
const HACHURES = 'repeating-linear-gradient(45deg, var(--danger) 0 3px, transparent 3px 7px)'
/** le creux d'un congé : la place reste dessinée, elle est simplement vide */
const CREUX = 'repeating-linear-gradient(45deg, var(--line) 0 3px, transparent 3px 7px)'

const STYLE_BANDE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--ink-3)',
  background: 'var(--bg-soft)',
}

/** la puce d'un lot présent ce jour-là */
function PuceChantier({ barre, present }: { barre: BarreChantier; present: boolean }) {
  // rien, et pas un tiret : sous 700 px une cellule VIDE disparaît de la
  // carte (`.table-cartes td:empty`) — sept tirets par lot y seraient du bruit
  if (!present) return null
  return (
    <span
      title={`${barre.lot} · ${barre.entreprise} — du ${fmtDate(barre.debut)} au ${fmtDate(barre.fin)}${
        barre.chevauche ? ' — CHEVAUCHEMENT : cette entreprise est attendue ailleurs en même temps' : ''
      }`}
      style={{
        display: 'block',
        height: 12,
        borderRadius: 3,
        background: barre.chevauche ? HACHURES : 'var(--cat-teal)',
        border: barre.chevauche ? '1.5px solid var(--danger)' : '1.5px solid transparent',
        opacity: barre.confirmee ? 1 : 0.55,
      }}
    />
  )
}

/**
 * Les heures de la semaine, saisies SUR PLACE.
 *
 * Le geste est celui du tableau de temps, à la ligne près : même clé
 * naturelle (semaine × personne × projet × phase), même règle « 0 ou vide
 * retire la ligne ». Le temps se saisit à la SEMAINE dans ce dépôt
 * (`TempsEntry.semaine`) : une case par jour donnerait une précision que la
 * donnée ne porte pas, donc un chiffre inventé.
 */
function SaisieHeures({
  personne,
  lundi,
  ligne,
}: {
  personne: string
  lundi: string
  ligne: LigneChargePhase
}) {
  const { update } = useStore()
  return (
    <NumInput
      value={ligne.pointees > 0 ? ligne.pointees : null}
      style={{ width: 74 }}
      placeholder="0"
      ariaLabel={`Heures de ${personne} — ${ligne.projetId} ${ligne.phase} — semaine du ${fmtDate(lundi)}`}
      onChange={(v) =>
        update((d) => {
          const i = d.temps.findIndex(
            (t) =>
              t.semaine === lundi &&
              t.personne === personne &&
              t.projetId === ligne.projetId &&
              t.phase === ligne.phase,
          )
          if (v === null || v <= 0) {
            if (i >= 0) d.temps.splice(i, 1)
            return
          }
          if (i >= 0) d.temps[i].heures = v
          else
            d.temps.push({
              id: uid('tps'),
              semaine: lundi,
              personne,
              projetId: ligne.projetId,
              phase: ligne.phase,
              heures: v,
            })
        })
      }
    />
  )
}

function CarteLaSemaine({
  semaine,
  today,
  jour,
  personne,
}: {
  semaine: SemaineComplete
  today: string
  /** filtre de jour — `null` : la semaine entière */
  jour: string | null
  personne: string
}) {
  // « Aujourd'hui » n'est plus un écran : c'est une colonne qu'on isole.
  const index = semaine.jours.map((_, i) => i).filter((i) => !jour || semaine.jours[i] === jour)
  const nbCol = index.length + 1
  const tete = ['', ...index.map((i) => `${libelleJour(semaine.jours[i])}${semaine.jours[i] === today ? ' · aujourd’hui' : ''}`)]

  const bande = (titre: string) => (
    <tr>
      <td colSpan={nbCol} style={STYLE_BANDE}>
        {titre}
      </td>
    </tr>
  )

  return (
    <Card
      titre={jour ? `Le ${fmtDate(jour)}` : `Sept jours — ${semaine.nbEcheances} échéance${semaine.nbEcheances > 1 ? 's' : ''}`}
      actions={
        <span className="segmente" role="group" aria-label="Filtrer sur un jour">
          <button aria-pressed={jour === null} onClick={() => navigate('/')}>
            La semaine
          </button>
          {semaine.jours.map((j) => (
            <button key={j} aria-pressed={jour === j} onClick={() => navigate(`/${j}`)} title={fmtDate(j)}>
              {libelleJour(j).slice(0, 3)}
            </button>
          ))}
        </span>
      }
    >
      <Table head={tete}>
        {/* ---------- (a) rendez-vous ---------- */}
        {bande('Rendez-vous')}
        <tr>
          <td className="muted small">heure · projet · participants</td>
          {index.map((i) => (
            <td key={semaine.jours[i]}>
              {semaine.rendezVous[i].length === 0
                ? null
                : semaine.rendezVous[i].map((r) => (
                    <div key={r.id} className="small" style={{ padding: '2px 0' }}>
                      <strong>{r.heure || 'journée'}</strong>{' '}
                      {r.lien ? <a href={r.lien}>{r.titre}</a> : r.titre}
                      {r.detail && <div className="muted">{r.detail}</div>}
                    </div>
                  ))}
            </td>
          ))}
        </tr>

        {/* ---------- (b) sur le chantier ---------- */}
        {bande('Sur le chantier')}
        {semaine.chantier.length === 0 ? (
          <tr>
            <td colSpan={nbCol} className="muted small">
              Aucun lot en intervention cette semaine — les périodes se saisissent sur le marché
              (onglet Chantier d'un projet).
            </td>
          </tr>
        ) : (
          semaine.chantier.map((b) => (
            <tr key={b.cle}>
              <td>
                <a href={b.lien}>
                  <strong>{b.lot}</strong>
                </a>{' '}
                <span className="small">{b.entreprise}</span>
                {b.libelle && <span className="muted small"> · {b.libelle}</span>}
                <div className="muted small">
                  {b.projetId}
                  {!b.confirmee && (
                    <>
                      {' '}
                      <span className="badge badge-warn">venue non confirmée</span>
                    </>
                  )}
                  {b.chevauche && (
                    <>
                      {' '}
                      <span className="badge badge-danger">attendue ailleurs</span>
                    </>
                  )}
                </div>
              </td>
              {index.map((i) => (
                <td key={semaine.jours[i]}>
                  <PuceChantier barre={b} present={b.jours[i]} />
                </td>
              ))}
            </tr>
          ))
        )}

        {/* ---------- (c) nous deux ---------- */}
        {bande('Nous deux')}
        {semaine.nousDeux.length === 0 ? (
          <tr>
            <td colSpan={nbCol} className="muted small">
              Aucune personne à afficher — l'équipe se renseigne dans Paramètres.
            </td>
          </tr>
        ) : (
          semaine.nousDeux.map((l) => (
            <tr key={l.personne}>
              <td>
                <strong>{l.personne}</strong>
                <div className="muted small">
                  {fmtHeures(l.heures)} pointées · {fmtHeures(l.charge)} planifiées ·{' '}
                  <span className={l.capacite > 0 && l.charge > l.capacite ? 'danger-text' : undefined}>
                    {fmtHeures(l.capacite)} de capacité
                  </span>
                </div>
              </td>
              {index.map((i) => (
                <td key={semaine.jours[i]}>
                  {l.conges[i] ? (
                    <span
                      title={`${l.personne} est en congé le ${fmtDate(semaine.jours[i])}`}
                      style={{ display: 'block', height: 12, borderRadius: 3, background: CREUX }}
                    />
                  ) : null}
                </td>
              ))}
            </tr>
          ))
        )}

        {/* ---------- (d) ce qui tombe ---------- */}
        {bande('Ce qui tombe')}
        <tr>
          <td className="muted small">toute échéance datée, sans troncature</td>
          {index.map((i) => (
            <td key={semaine.jours[i]}>
              {semaine.echeances[i].length === 0
                ? null
                : semaine.echeances[i].map((e, k) => (
                    <div key={`${e.date}-${k}`} className="small" style={{ padding: '2px 0' }}>
                      <a href={e.lien} style={{ color: e.couleur, fontWeight: 600 }}>
                        {e.icon && <Icon name={e.icon} size={12} style={{ verticalAlign: '-0.1em' }} />}{' '}
                        {e.titreLong}
                      </a>
                    </div>
                  ))}
            </td>
          ))}
        </tr>
      </Table>

      {/* ---------- (c) suite : la charge EN CLAIR, et les heures en face ----------
          « P03 · DCE — 12 h » : `chargeParPhase` existait depuis des semaines
          et n'avait qu'un seul appelant. Elle ne vit pas dans une colonne de
          jour parce que le temps se saisit À LA SEMAINE dans ce dépôt : une
          case par jour afficherait une précision que la donnée n'a pas. */}
      {semaine.nousDeux.some((l) => l.charges.length > 0) && (
        <div style={{ marginTop: 14 }}>
          <div style={{ ...STYLE_GROUPE, margin: '0 0 6px' }}>
            Charge planifiée et heures de la semaine{personne ? ` — ${personne}` : ''}
          </div>
          <Table
            compact
            head={[
              'Personne',
              'Projet · phase',
              <span key="p" className="right">
                Planifié
              </span>,
              <span key="h" className="right">
                Heures
              </span>,
            ]}
          >
            {semaine.nousDeux.flatMap((l) =>
              l.charges.map((c) => (
                <tr key={`${l.personne}|${c.projetId}|${c.phase}`}>
                  <td>{l.personne}</td>
                  <td>
                    <a href={`#/projets/${c.projetId}`} title={c.nomProjet}>
                      <strong>{c.projetId}</strong>
                    </a>{' '}
                    · {c.phase}{' '}
                    <span className="muted small">{LIBELLES_PHASES[c.phase] || ''}</span>
                  </td>
                  <td className="right num">{c.planifiees > 0 ? fmtHeures(c.planifiees) : <span className="muted">—</span>}</td>
                  <td className="right">
                    <SaisieHeures personne={l.personne} lundi={semaine.lundi} ligne={c} />
                  </td>
                </tr>
              )),
            )}
          </Table>
          <p className="muted small" style={{ margin: '8px 2px 0' }}>
            Les heures se saisissent ici, pour la semaine entière : c'est la même ligne que le
            tableau de <a href="#/temps">Temps</a>, écrite au même endroit. Une case vide ou à zéro
            retire la ligne.
          </p>
        </div>
      )}
    </Card>
  )
}

// ---------- module ----------

export default function Cockpit({ jour }: { jour?: string | null } = {}) {
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

  // « Aujourd'hui » n'est plus un écran : c'est le jour qu'on isole dans la
  // semaine. Sans filtre, la semaine est celle d'aujourd'hui ; avec, celle
  // du jour demandé — l'adresse `#/AAAA-MM-JJ` est lue par App.tsx.
  const jourFiltre = jour && /^\d{4}-\d{2}-\d{2}$/.test(jour) ? jour : null
  const lundi = mondayOf(jourFiltre || today)

  // les autorités que `derive` ne peut pas importer, voir AUTORITES_DATEES
  const autorites = useMemo<AutoritesDatees>(() => ({ ...AUTORITES_DATEES, today }), [today])
  const semaine = useMemo(
    () =>
      semaineComplete(state, lundi, {
        agenda: agendaGoogle,
        personnes: personne ? [personne] : undefined,
        autorites,
      }),
    [state, lundi, agendaGoogle, personne, autorites],
  )

  const meteo = meteoFinanciere(state, today)
  const excel = state.settings.dernierImportExcel

  const phases = phasesEnCours(state, today)
  const reunions = reunionsDuJour(state, today, agendaGoogle)
  const echeances = prochainesEcheances(state, today, 14, autorites)

  return (
    <Page
      titre={`la semaine du ${fmtDate(lundi)} au ${fmtDate(addDays(lundi, 6))}`}
      wordmark
      meta={jourFiltre ? `Filtré sur le ${fmtDate(jourFiltre)}` : `Aujourd’hui · ${dateFR}`}
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
      {/* ---------- LA SEMAINE, EN TÊTE ----------
          Ce n'est pas une carte de plus : c'est l'ordre de lecture d'un lundi
          matin. Qui vient nous voir, qui est sur le chantier, ce que nous deux
          avons à faire, ce qui tombe — et l'argent seulement après, sous le
          pli. Tout vient de `derive.semaineComplete`, qui lit le même
          inventaire que la file du matin ci-dessous. */}
      <div style={{ marginBottom: 16 }}>
        <CarteLaSemaine semaine={semaine} today={today} jour={jourFiltre} personne={personne} />
      </div>

      {/* ---------- centre d'actions + rail latéral ---------- */}
      <div className="cockpit-cols">
        <div className="cockpit-main">
          <CentreActions personne={personne} />
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
                      {/* le code de phase nu ne se lit qu'avec l'habitude :
                          le libellé de `LIBELLES_PHASES` (src/miqcp.ts, via
                          derive) le dit au survol, sans allonger la ligne */}
                      <a href={`#/projets/${projet.id}`} title={LIBELLES_PHASES[phase.code] || phase.code}>
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

      {/* ==================================================================
          SOUS LE PLI — ce qui QUITTE le dessus de l'écran.
          Lire la trésorerie avant de savoir qui est sur quel chantier, c'est
          l'ordre inverse de celui d'un lundi matin. Rien n'est supprimé :
          les trois tuiles, la jauge de CA, le rappel de l'import Excel et le
          tableau heures / charge / capacité sont à un clic, au même endroit,
          avec les mêmes liens. Deux résumés remplacent, au premier coup
          d'œil, deux blocs qui occupaient le haut de la page.
          ================================================================== */}
      <details style={{ marginTop: 16 }}>
        <summary style={{ ...STYLE_GROUPE, margin: '2px', cursor: 'pointer', display: 'list-item' }}>
          Voir plus — l’argent : trésorerie, facturable 90 j, carnet, objectif de CA
        </summary>
        <div style={{ marginTop: 10 }}>
          {/* ---------- météo financière ----------
              Chaque tuile mène à l'écran où son chiffre se DÉTAILLE et se
              corrige : trois chiffres qu'on lisait le matin et qu'il fallait
              ensuite retrouver de mémoire dans le menu. La tuile Trésorerie
              non renseignée garde son propre lien (« renseigner → ») : deux
              liens imbriqués n'en font aucun. */}
          <div style={{ marginBottom: 16 }}>
            <div className="grid3">
              {meteo.tresorerie === null ? (
                <Stat
                  accent="yellow"
                  label="Trésorerie"
                  value={<a href="#/parametres" style={{ fontSize: 15, color: 'inherit' }}>renseigner →</a>}
                  sub="solde disponible en banque"
                />
              ) : (
                <TuileLien href="#/finance/banque" titre="Voir les relevés et le solde importé">
                  <Stat
                    accent="yellow"
                    label="Trésorerie"
                    value={<Money v={meteo.tresorerie} />}
                    sub={meteo.tresorerieMajLe ? `relevé du ${fmtDate(meteo.tresorerieMajLe)}` : 'solde disponible en banque'}
                    tone={meteo.tresorerie < 0 ? 'danger' : undefined}
                  />
                </TuileLien>
              )}
              <TuileLien href="#/facturation" titre="Voir les échéances à émettre et les factures en attente">
                <Stat
                  accent="blue"
                  label="Facturable 90 j"
                  value={<Money v={meteo.facturable90j} />}
                  sub="HT restant à encaisser ou à facturer sous 90 jours"
                />
              </TuileLien>
              <TuileLien href="#/projets" titre="Voir les projets actifs et leurs honoraires restants">
                <Stat
                  accent="red"
                  label="Carnet"
                  value={<Money v={meteo.carnetHT} />}
                  sub="honoraires signés restant au carnet"
                />
              </TuileLien>
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
        </div>
      </details>

      <details style={{ marginTop: 10 }}>
        <summary style={{ ...STYLE_GROUPE, margin: '2px', cursor: 'pointer', display: 'list-item' }}>
          Voir plus — heures, charge et capacité de la semaine
        </summary>
        <div style={{ marginTop: 10 }}>
          <CarteSemaine personne={personne} />
        </div>
      </details>
    </Page>
  )
}
