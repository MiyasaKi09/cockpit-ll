// ============================================================
// Projets — liste + espace projet (hub à onglets).
// Tout ce qui concerne un projet se rattache ICI, au fil de
// l'eau : pilotage MIQCP, chantier (marchés, CR), ressources
// (matériaux, artisans, liens), journal, finances & temps.
// ============================================================

import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'
import type { Alerte, BaselineHeures, Cotraitant, Phase, PhaseCode, Projet, StatutProjet, TypeCotraitant, TypeMO } from '../types'
import { useStore } from '../store'
import { useMoi } from '../moi'
import { alertesActives } from '../alerts'
import { type ChronoActif, arreterChrono, basculerChrono, chronoDe, poserChrono } from '../chrono'
import { messageArretHonnete } from './ChronoBarre'
import { ligneActivable,
  Badge,
  Btn,
  Card,
  DateF,
  DateInput,
  EmptyState,
  Field,
  Modal,
  Money,
  NumInput,
  PctInput,
  Page,
  RowMenu,
  Select,
  Stat,
  Table,
  Tabs,
  TextArea,
  TextInput,
  confirmer,
  navigate,
  toast,
  useRoute,
  useToday,
} from '../ui'
import type { Tone } from '../ui'
import { adresseProjetProposee, adresseProjetValide, fmtDate, fmtHeures, fmtMois, fmtMoney, fmtPct, fold, monthKey, ouvrirGmail, todayISO, uid } from '../util'
import {
  CRITERES_COMPLEXITE,
  LIBELLES_PHASES,
  OUVRAGES,
  calculHonoraires,
  coefComplexite,
  phasesParDefaut,
  plageOuvrage,
  seuilPlancherActualise,
  totalPointsComplexite,
} from '../miqcp'
import { baselineDepuisPhases, coutHoraireMoyen, coutJourObjectif, coutReelTemps, coutsExternes, ecartHeures, encaisseHT, encaissementPrevu, enJours, equipeDuProjet, factureHT, heuresBaseline, heuresPrevues, heuresReelles, nomProjet, retardFacture, tauxVente, ttc } from '../derive'
import { LIBELLE_TYPE_COTRAITANT, corpsRelanceNote, cumulRecuHT, moisManquants, recuProjetHT, convenuProjetHT, resteAPayer, sujetRelanceNote } from '../cotraitants'
import { assemble, contexteProjet, copier } from '../prompts'
import { echeancesParDefaut } from '../echeancier'
import { contratDuProjet, totalContratHT } from '../contrats'
import { cinqEtatsExterne, margeFinale, productionEstimee, resteAFaireProjet } from '../economie'
import ProjetNouveau from './ProjetNouveau'
import ProjetChantier from './ProjetChantier'
import ProjetDCE from './ProjetDCE'
import ProjetPlanning from './ProjetPlanning'
import ProjetRessources from './ProjetRessources'
import ProjetJournal from './ProjetJournal'
import ProjetDocuments from './ProjetDocuments'

// ---------- constantes & petits helpers ----------

const STATUTS: StatutProjet[] = ['Prospect', 'Offre remise', 'Signé', 'En cours', 'Livré', 'Perdu']
const TYPES_MO: TypeMO[] = ['Public', 'Privé pro', 'Particulier']

function toneStatut(s: StatutProjet): Tone {
  switch (s) {
    case 'Prospect':
      return 'muted'
    case 'Offre remise':
      return 'warn'
    case 'Signé':
      return 'info'
    case 'En cours':
      return 'ok'
    case 'Livré':
      return 'muted'
    case 'Perdu':
      return 'danger'
  }
}

function fmtCoef(c: number | null | undefined): string {
  return c === null || c === undefined ? '—' : c.toFixed(2).replace('.', ',')
}

/** la phase en cours aujourd'hui — définie UNE fois pour cet écran : le
 *  bandeau, la barre compacte des sous-pages et le chrono de la fiche en
 *  disent forcément la même chose. `today` est passé, jamais lu ici. */
function phaseCourante(p: Projet, today: string): Phase | undefined {
  return p.phases.find((ph) => ph.debut && ph.fin && ph.debut <= today && today <= ph.fin)
}

/** « Terminés » = ce qui ne demande plus rien. Volontairement PAS
 *  `STATUTS_ACTIFS` (src/derive.ts) : cette constante-là répond à une autre
 *  question — quels projets produisent de la charge — et rangerait un
 *  prospect ou une offre remise avec les projets morts. */
const STATUTS_TERMINES: StatutProjet[] = ['Livré', 'Perdu']

/** Une fois le projet signé, les honoraires MIQCP et la grille de complexité
 *  sont réglés une fois pour toutes : ils cessent d'occuper le haut de
 *  l'écran au profit du tableau des phases, qui s'ouvre tous les jours. */
const STATUTS_HONORAIRES_REGLES: StatutProjet[] = ['Signé', 'En cours', 'Livré']

/** dernier choix de vue de la liste — un réglage d'écran, jamais synchronisé */
const CLE_VUE_PROJETS = 'cockpit.projets.vue'

function lireVueProjets(): string {
  try {
    return localStorage.getItem(CLE_VUE_PROJETS) || 'actifs'
  } catch {
    return 'actifs'
  }
}

/** badge d'écart heures réelles / prévues (cohérent avec le fil d'urgences) */
function EcartHeures({ reel, prevu, seuil }: { reel: number; prevu: number; seuil: number }) {
  if (reel <= 0) return <span className="muted">—</span>
  if (prevu <= 0) return <Badge tone="warn">sans budget</Badge>
  const ratio = reel / prevu
  const tone: Tone = ratio >= 1 ? 'danger' : ratio >= seuil ? 'warn' : 'ok'
  return <Badge tone={tone}>{fmtPct(ratio, 0)}</Badge>
}

// ---------- prévision d'heures figée (CDC §11.3, critère 15) ----------

/** ce que la référence dit d'elle-même. Une reprise n'est PAS une signature :
 *  la nommer autrement ferait passer une répartition trouvée en place pour un
 *  engagement contractuel. */
const LIBELLES_ORIGINE_BASELINE: Record<BaselineHeures['origine'], string> = {
  signature: 'figée à la signature',
  creation: 'figée à la création du projet',
  reprise: 'reprise de la répartition en place',
  revision: 'redéfinie',
}

/** heures signées, comme le §11.3 les écrit : « +28 h », « −12 h » */
function ecartSigne(h: number): string {
  const arrondi = Math.round(h * 10) / 10
  if (arrondi === 0) return '0 h'
  return `${arrondi > 0 ? '+' : '−'}${fmtHeures(Math.abs(arrondi))}`
}

/** l'écart du §11.3 en heures, signé. Un écart positif, c'est la référence
 *  déjà dépassée : même seuil que le badge de consommation ci-dessus (100 %),
 *  et donc jamais deux lectures contradictoires sur la même ligne. */
function EcartSigne({ h }: { h: number | null }) {
  if (h === null) return <span className="muted">—</span>
  const arrondi = Math.round(h * 10) / 10
  const classe = arrondi > 0 ? 'danger-text' : arrondi < 0 ? 'ok-text' : ''
  return <span className={`num ${classe}`}>{ecartSigne(arrondi)}</span>
}

/** d'où vient la référence, et ce qu'un recalcul lui fait (rien) */
function NoteBaseline({ projet: p }: { projet: Projet }) {
  const b = p.baselineHeures
  const total = heuresBaseline(p)
  if (!b || total === null) {
    return (
      <p className="muted small" style={{ margin: '0 2px 10px' }}>
        Aucune prévision de référence : l’écart prévu / réel se mesure sur la répartition courante,
        que « Recalculer la répartition » écrase. « Modifier les phases » → « Figer la référence »
        la fixe une fois pour toutes.
      </p>
    )
  }
  return (
    <p className="muted small" style={{ margin: '0 2px 10px' }}>
      Prévision de référence : <strong>{fmtHeures(total)}</strong> — {LIBELLES_ORIGINE_BASELINE[b.origine]}{' '}
      le <DateF d={b.le} />
      {b.par ? ` par ${b.par}` : ''}
      {b.honorairesBaseHT ? `, sur ${fmtMoney(b.honorairesBaseHT)} d’honoraires de base` : ''}. « Recalculer la
      répartition » ne la touche pas.
    </p>
  )
}

/** cellule « H. référence » d'une phase : la prévision figée, et de combien la
 *  répartition courante s'en est éloignée depuis */
function CelluleReference({ projet: p, phase: ph }: { projet: Projet; phase: Phase }) {
  const ref = heuresBaseline(p, ph.code)
  if (ref === null) {
    return (
      <td className="right muted" title={p.baselineHeures ? 'phase absente de la prévision de référence : elle est née après le figeage' : 'aucune prévision figée sur ce projet'}>
        —
      </td>
    )
  }
  const derive = Math.round((ph.heuresPrevues - ref) * 10) / 10
  return (
    <td className="right">
      {fmtHeures(ref)}
      {derive !== 0 && (
        <div className="muted small" title="la répartition courante s’est éloignée de la référence">
          {ecartSigne(derive)} vs réf.
        </div>
      )}
    </td>
  )
}

// ============================================================
// Routage interne : #/projets = liste, #/projets/P01 = espace,
// #/projets/P01/<onglet> = onglet direct
// ============================================================

export default function Projets() {
  const route = useRoute()
  const id = route[1]
  if (id) return <EspaceProjet projetId={id} onglet={route[2]} />
  return <ListeProjets />
}

// ============================================================
// Liste des projets
// ============================================================

function ListeProjets() {
  const { state } = useStore()
  const [recherche, setRecherche] = useState('')
  // T5 — vivants et terminés étaient mélangés, triés par ordre de création :
  // la liste grossit d'un projet livré par mois, et les vivants descendent.
  // Défaut « Actifs », les terminés à un clic, et le dernier choix retenu.
  const [vue, setVue] = useState<string>(lireVueProjets)
  const [wizard, setWizard] = useState(false)

  const choisirVue = (v: string) => {
    setVue(v)
    try {
      localStorage.setItem(CLE_VUE_PROJETS, v)
    } catch {
      // navigation privée : le choix vaut pour la session, rien de plus
    }
  }

  const termine = (p: Projet) => STATUTS_TERMINES.includes(p.statut)
  const nActifs = state.projets.filter((p) => !termine(p)).length
  const nTermines = state.projets.length - nActifs

  const dansLaVue = (p: Projet) => {
    if (vue === 'tous') return true
    if (vue === 'termines') return termine(p)
    if (vue.startsWith('statut:')) return p.statut === vue.slice(7)
    return !termine(p)
  }

  const projets = state.projets
    .filter((p) => {
      if (!dansLaVue(p)) return false
      if (recherche.trim() === '') return true
      return fold(`${p.id} ${p.nom} ${p.moa || ''} ${p.adresse || ''}`).includes(fold(recherche))
    })
    .slice()
    // en vue « Tous », les vivants d'abord : un projet livré ne doit pas
    // s'intercaler entre deux chantiers en cours
    .sort((a, b) => Number(termine(a)) - Number(termine(b)) || a.id.localeCompare(b.id))

  return (
    <Page
      titre="Projets"
      sousTitre="Un espace par projet ; tout s'y rattache."
      actions={<Btn kind="primary" onClick={() => setWizard(true)}>Nouveau projet</Btn>}
    >
      <div className="toolbar">
        <TextInput
          value={recherche}
          onChange={setRecherche}
          placeholder="Rechercher (nom, MO, adresse…)"
          style={{ width: 260 }}
        />
        <Select
          value={vue}
          onChange={choisirVue}
          options={[
            { value: 'actifs', label: `Actifs (${nActifs})` },
            { value: 'termines', label: `Terminés (${nTermines})` },
            { value: 'tous', label: `Tous (${state.projets.length})` },
            ...STATUTS.map((s) => ({
              value: `statut:${s}`,
              label: `— ${s} (${state.projets.filter((p) => p.statut === s).length})`,
            })),
          ]}
          style={{ maxWidth: 210 }}
        />
      </div>

      {projets.length === 0 ? (
        <Card>
          <EmptyState>
            {state.projets.length === 0
              ? 'Aucun projet — « Nouveau projet » : 3 étapes, 2 minutes, phases et factures générées automatiquement.'
              : vue === 'actifs' && recherche.trim() === '' && nTermines > 0
                ? `Aucun projet actif — ${nTermines} projet(s) terminé(s) sont repliés : choisissez « Terminés » ci-dessus.`
                : 'Aucun projet ne correspond à la recherche ou au filtre.'}
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <Table
            head={[
              'ID',
              'Projet',
              'MO',
              'Statut',
              <span key="t" className="right">Travaux HT</span>,
              <span key="h" className="right">Honoraires HT</span>,
              <span key="f" className="right">Facturé HT</span>,
              <span key="r" className="right">Reste à facturer</span>,
              <span key="he" className="right">Heures réel / prévu</span>,
            ]}
          >
            {projets.map((p) => {
              const h = calculHonoraires(p, state.settings)
              const fact = factureHT(state, p.id)
              const reste = Math.max(0, h.honorairesTotauxHT - fact)
              return (
                <tr key={p.id} className="clickable" {...ligneActivable(() => navigate(`/projets/${p.id}`))}>
                  <td className="mono">{p.id}</td>
                  <td>
                    <a href={`#/projets/${p.id}`} onClick={(e) => e.stopPropagation()}>
                      <strong>{p.nom}</strong>
                    </a>
                    {p.moa && <div className="muted small">{p.moa}</div>}
                  </td>
                  <td>{p.typeMO}</td>
                  <td><Badge tone={toneStatut(p.statut)}>{p.statut}</Badge></td>
                  <td className="right"><Money v={p.montantTravauxHT} /></td>
                  <td className="right"><Money v={h.honorairesTotauxHT} /></td>
                  <td className="right"><Money v={fact} /></td>
                  <td className="right"><Money v={reste} /></td>
                  <td className="right num">
                    {fmtHeures(heuresReelles(state, p.id))} / {fmtHeures(heuresPrevues(p))}
                  </td>
                </tr>
              )
            })}
          </Table>
          {/* « replié » doit se voir : un filtre silencieux fait croire à une
              liste complète (le mode de panne du courrier tronqué, S2) */}
          {vue === 'actifs' && nTermines > 0 && (
            <p className="muted small" style={{ margin: '10px 2px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
              {nTermines} projet{nTermines > 1 ? 's' : ''} terminé{nTermines > 1 ? 's' : ''} (livrés, perdus) replié
              {nTermines > 1 ? 's' : ''}
              <Btn small kind="ghost" onClick={() => choisirVue('termines')}>les afficher</Btn>
            </p>
          )}
        </Card>
      )}

      {wizard && <ProjetNouveau onClose={() => setWizard(false)} />}
    </Page>
  )
}

// ============================================================
// Espace projet — bandeau + onglets
// ============================================================

/** onglets de premier niveau — le quotidien du projet.
 *  Documents réunit le Drive, le registre ET le DCE structuré : un seul
 *  endroit pour les fichiers du projet (audit simplification). */
const ONGLETS_PRINCIPAUX = [
  { id: 'pilotage', label: 'Pilotage & honoraires' },
  { id: 'documents', label: 'Documents' },
  { id: 'planning', label: 'Planning' },
  { id: 'chantier', label: 'Chantier & CR' },
  { id: 'finances', label: 'Finance' },
]

/** le reste vit derrière « Plus » */
const ONGLETS_PLUS = [
  { id: 'ressources', label: 'Équipe & ressources' },
  { id: 'journal', label: 'Journal' },
]

/** 'dce' reste une route valide : elle ouvre Documents → DCE structuré */
const ONGLETS = [...ONGLETS_PRINCIPAUX, ...ONGLETS_PLUS, { id: 'dce', label: 'Documents' }]

function EspaceProjet({ projetId, onglet }: { projetId: string; onglet?: string }) {
  const { state, update, replace } = useStore()
  const today = useToday()
  const [modalEdition, setModalEdition] = useState(false)
  const p = state.projets.find((x) => x.id === projetId)
  const actif = ONGLETS.some((o) => o.id === onglet) ? onglet! : 'pilotage'
  const ongletSurligne = actif === 'dce' ? 'documents' : actif

  if (!p) {
    return (
      <Page titre="Projet introuvable">
        <Card>
          <EmptyState>
            Aucun projet « {projetId} » dans la base. <a href="#/projets">← Retour à la liste des projets</a>
          </EmptyState>
        </Card>
      </Page>
    )
  }

  const promptsProjet = state.prompts.filter((t) => t.contexte === 'projet')

  const supprimer = async () => {
    // les PIÈCES qui engagent bloquent la suppression — elles ne se
    // suppriment pas en cascade, elles se réaffectent à la main
    const nbFactures = state.factures.filter((f) => f.projetId === p.id).length
    const nbSituations = state.situations.filter((s) => s.projetId === p.id).length
    const nbCertificats = state.certificats.filter((c) => c.projetId === p.id).length
    if (nbFactures > 0 || nbSituations > 0 || nbCertificats > 0) {
      toast(
        `Suppression impossible : ${nbFactures} facture(s), ${nbSituations} situation(s) et ${nbCertificats} certificat(s) liés à ${p.id}. Supprimez-les ou réaffectez-les d'abord.`,
        { tone: 'danger' },
      )
      return
    }
    // ce que la cascade emporte, compté AVANT : la confirmation dit ce
    // qu'on perd, chiffre par chiffre. Les collections qui manquaient ici
    // laissaient des lignes orphelines rattachées à un projet disparu —
    // notes de cotraitants, échéances prévues, visas, désordres GPA.
    const cotraitantsIds = state.cotraitants.filter((c) => c.projetId === p.id).map((c) => c.id)
    const lies: [string, number][] = [
      ['marché(s)', state.marches.filter((x) => x.projetId === p.id).length],
      ['saisie(s) de temps', state.temps.filter((x) => x.projetId === p.id).length],
      ['réunion(s) de chantier', state.reunions.filter((x) => x.projetId === p.id).length],
      ['lot(s) DCE', state.lotsDce.filter((x) => x.projetId === p.id).length],
      ['tâche(s) de planning travaux', state.tachesChantier.filter((x) => x.projetId === p.id).length],
      ['échéance(s) de facturation prévue(s)', state.echeancesFacturation.filter((x) => x.projetId === p.id).length],
      [
        'cotraitant(s) et leurs notes',
        cotraitantsIds.length + state.notesHonoraires.filter((x) => x.projetId === p.id).length,
      ],
      ['visa(s)', state.visas.filter((x) => x.projetId === p.id).length],
      ['désordre(s) GPA', state.desordresGPA.filter((x) => x.projetId === p.id).length],
      ['intempérie(s)', state.intemperies.filter((x) => x.projetId === p.id).length],
      ['événement(s) de marché', state.evenementsMarche.filter((x) => x.projetId === p.id).length],
      ['révision(s) du reste à faire', state.revisionsResteAFaire.filter((x) => x.projetId === p.id).length],
      ["évaluation(s) d'entreprise", state.evaluations.filter((x) => x.projetId === p.id).length],
      ["piste(s) d'avenant", state.pistesAvenant.filter((x) => x.projetId === p.id).length],
    ]
    const detail = lies
      .filter(([, n]) => n > 0)
      .map(([quoi, n]) => `${n} ${quoi}`)
      .join(', ')
    const snap = state
    if (
      !(await confirmer({
        message:
          `Supprimer définitivement le projet ${p.id} — ${p.nom} ?` +
          (detail ? `\nSeront supprimés avec lui : ${detail}.` : '\nAucune donnée rattachée.'),
        danger: true,
        confirmerLabel: 'Supprimer',
      }))
    )
      return
    update((d) => {
      d.projets = d.projets.filter((x) => x.id !== p.id)
      d.marches = d.marches.filter((m) => m.projetId !== p.id)
      d.temps = d.temps.filter((t) => t.projetId !== p.id)
      d.reunions = d.reunions.filter((r) => r.projetId !== p.id)
      d.lotsDce = d.lotsDce.filter((l) => l.projetId !== p.id)
      d.tachesChantier = d.tachesChantier.filter((t) => t.projetId !== p.id)
      d.echeancesFacturation = d.echeancesFacturation.filter((e) => e.projetId !== p.id)
      d.cotraitants = d.cotraitants.filter((c) => c.projetId !== p.id)
      // une note suit son cotraitant, qu'elle porte le projet ou non
      d.notesHonoraires = d.notesHonoraires.filter(
        (n) => n.projetId !== p.id && !cotraitantsIds.includes(n.cotraitantId),
      )
      d.visas = d.visas.filter((v) => v.projetId !== p.id)
      d.desordresGPA = d.desordresGPA.filter((g) => g.projetId !== p.id)
      d.intemperies = d.intemperies.filter((i) => i.projetId !== p.id)
      d.evenementsMarche = d.evenementsMarche.filter((e) => e.projetId !== p.id)
      d.revisionsResteAFaire = d.revisionsResteAFaire.filter((r) => r.projetId !== p.id)
      d.evaluations = d.evaluations.filter((e) => e.projetId !== p.id)
      d.pistesAvenant = d.pistesAvenant.filter((a) => a.projetId !== p.id)
    })
    navigate('/projets')
    toast(`Projet ${p.id} supprimé.`, { undo: () => replace(snap) })
  }

  // action principale contextuelle : pendant le chantier, c'est le CR qui compte
  const enChantier =
    state.marches.some((m) => m.projetId === p.id && m.actif) ||
    p.phases.some((ph) => ph.code === 'DET' && ph.debut && ph.fin && ph.debut <= today && today <= ph.fin)

  // onglets visibles : les principaux + l'onglet « Plus » actif le cas échéant
  const ongletsVisibles = [
    ...ONGLETS_PRINCIPAUX,
    ...ONGLETS_PLUS.filter((o) => o.id === ongletSurligne),
  ]

  return (
    <Page
      titre={`${p.id} — ${p.nom}`}
      sousTitre={
        <>
          <Badge tone={toneStatut(p.statut)}>{p.statut}</Badge> <Badge tone="info">{p.typeMO}</Badge>
          {p.responsable && <Badge tone="muted">resp. {p.responsable}</Badge>}
          {p.plaisir != null && <Badge tone={p.plaisir >= 4 ? 'ok' : p.plaisir <= 2 ? 'danger' : 'muted'}>{'★'.repeat(p.plaisir)}</Badge>}
          {p.moa && <> · {p.moa}</>}
          {p.adresse && <> · {p.adresse}</>}
          {p.numeroEngagement && <span className="muted small"> · engagement {p.numeroEngagement}</span>}
        </>
      }
    >
      {/* le titre garde toute la première ligne — les actions vivent ici */}
      <div className="toolbar" style={{ marginTop: -6, marginBottom: 12 }}>
        <a href="#/projets" className="small">← Tous les projets</a>
        <span className="spacer" />
        <BoutonChronoProjet projet={p} />
        {actif === 'pilotage' &&
          (enChantier ? (
            <Btn kind="primary" onClick={() => navigate(`/projets/${p.id}/chantier`)}>Nouveau CR</Btn>
          ) : (
            <Btn kind="primary" onClick={() => setModalEdition(true)}>Modifier</Btn>
          ))}
        {promptsProjet.length > 0 && (
          <RowMenu
            label="Assistant"
            items={promptsProjet.map((t) => ({
              label: `${t.titre} → « ${t.projetClaude} »`,
              onClick: () => {
                void copier(assemble(t.corps, contexteProjet(state, p))).then((ok) =>
                  toast(ok ? 'Prompt copié — collez-le dans le Projet Claude.' : 'Copie impossible.', {
                    tone: ok ? 'ok' : 'danger',
                  }),
                )
              },
            }))}
          />
        )}
        <RowMenu
          items={[
            ...(enChantier || actif !== 'pilotage' ? [{ label: 'Modifier la fiche', onClick: () => setModalEdition(true) }] : []),
            { label: 'Supprimer le projet', onClick: supprimer, danger: true },
          ]}
        />
      </div>
      {p.notes && <p className="muted small" style={{ marginTop: -6, marginBottom: 12 }}>{p.notes}</p>}

      {actif === 'pilotage' ? (
        <>
          <BandeauProjet projet={p} />
          <LigneIdentite projet={p} />
        </>
      ) : (
        <BarreProjetCompacte projet={p} />
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Tabs
            tabs={ongletsVisibles.map((o) => ({ id: o.id, label: o.label }))}
            actif={ongletSurligne}
            onSelect={(id) => navigate(`/projets/${p.id}/${id}`)}
          />
        </div>
        <RowMenu
          label="Plus"
          items={ONGLETS_PLUS.map((o) => ({ label: o.label, onClick: () => navigate(`/projets/${p.id}/${o.id}`) }))}
        />
      </div>

      {actif === 'pilotage' && (
        <>
          {/* R1 — ce qui crie sur CE projet, en tête : ces alertes existent
              déjà, elles ne se lisaient qu'à l'accueil, mêlées à celles des
              autres projets — et l'accueil ne filtre que par personne. */}
          <ATraiterSurCeProjet projet={p} />
          {STATUTS_HONORAIRES_REGLES.includes(p.statut) ? (
            <>
              {/* S3 — projet signé : les phases d'abord, le barème ensuite */}
              <CartePhases projet={p} />
              <ResumeHonoraires projet={p} />
            </>
          ) : (
            <>
              <div className="grid2">
                <CarteHonoraires projet={p} />
                <CarteComplexite projet={p} />
              </div>
              <CartePhases projet={p} />
            </>
          )}
        </>
      )}
      {actif === 'planning' && <ProjetPlanning projet={p} />}
      {actif === 'chantier' && <ProjetChantier projet={p} />}
      {actif === 'ressources' && <ProjetRessources projet={p} />}
      {actif === 'journal' && <ProjetJournal projet={p} />}
      {(actif === 'documents' || actif === 'dce') && (
        <OngletDocumentsProjet projet={p} vueInitiale={actif === 'dce' ? 'dce' : 'tous'} />
      )}
      {actif === 'finances' && <OngletFinances projet={p} />}

      {modalEdition && <ModalEditionProjet projet={p} onClose={() => setModalEdition(false)} />}
    </Page>
  )
}

/** L'alerte parle-t-elle de CE projet ?
 *
 *  `projetId` d'abord : c'est le champ prévu pour ça (types.ts). Mais six
 *  producteurs sur vingt seulement le posent aujourd'hui — « CR à sortir »,
 *  « rendu de phase » et « dérive d'heures », tous trois cités par le
 *  constat R1, ne l'ont pas. Leur DESTINATION, elle, est déjà la fiche du
 *  projet, et `lien` est un champ public de l'alerte (« route hash vers la
 *  source »), pas la forme de son identifiant : on s'en sert en second, sur
 *  des segments entiers — « #/projets/P1 » ne doit pas attraper P10.
 *  Ce repli se retire le jour où ces producteurs posent `projetId` ; il ne
 *  dispense pas de le faire, il évite d'attendre. */
function concerneLeProjet(a: Alerte, id: string): boolean {
  if (a.projetId) return a.projetId === id
  return a.lien === `#/projets/${id}` || a.lien.startsWith(`#/projets/${id}/`)
}

/** R1 — « À traiter sur ce projet » : la file du matin, réduite à ce projet.
 *
 *  AUCUN calcul nouveau. `alertesActives` (src/alerts.ts) est l'autorité —
 *  snooze, « vu » et tri compris — on ne fait que filtrer, et chaque ligne
 *  garde SON lien, celui que le producteur lui a donné. Avant, préparer une
 *  réunion de chantier demandait d'ouvrir l'accueil et d'y repérer à l'œil
 *  les lignes du projet parmi toutes les autres — l'accueil, lui, ne filtre
 *  que par personne.
 *
 *  Le contexte des messages n'est pas passé : il vit dans le cache de la
 *  boîte, que seul l'accueil charge. Une alerte de courrier ne manque donc
 *  pas ici — elle n'existe simplement pas hors de l'accueil. */
function ATraiterSurCeProjet({ projet: p }: { projet: Projet }) {
  const { state } = useStore()
  const today = useToday()
  const alertes = alertesActives(state, today).filter((a) => concerneLeProjet(a, p.id))

  if (alertes.length === 0)
    return (
      <p className="muted small" style={{ margin: '0 2px 12px' }}>
        Rien à traiter sur ce projet aujourd'hui.
      </p>
    )

  return (
    <Card
      titre={`À traiter sur ce projet (${alertes.length})`}
      actions={<a href="#/" className="small">tout le fil d'urgences →</a>}
    >
      {alertes.map((a) => (
        <div key={a.id} className={`alert-item alert-${a.gravite}`}>
          <span className="alert-dot" />
          <div style={{ minWidth: 0 }}>
            <div className="alert-titre">{a.titre}</div>
            <div className="alert-detail">
              {a.detail ? <>{a.detail} · </> : null}
              <a href={a.lien}>ouvrir</a>
            </div>
          </div>
        </div>
      ))}
      {/* ce que ce bloc ne couvre PAS se dit, plutôt que de manquer en
          silence : ces deux familles d'alertes ne portent pas encore le
          projet qu'elles concernent (src/alerts.ts) */}
      <p className="muted small" style={{ margin: '4px 2px 0' }}>
        Factures à émettre et impayés : bandeau ci-dessus et <a href="#/facturation">Facturation</a>.
        Situations à vérifier : <a href="#/situations">Situations</a>.
      </p>
    </Card>
  )
}

/** M.3 — démarrer le chrono depuis la fiche projet (action 30 du plan
 *  d'usage : le bouton de la fiche tâche était livré, celui-ci non).
 *
 *  La cible est déjà connue — le projet, et sa phase en cours — donc le
 *  geste tient en un bouton. Toute la logique (bascule, seuil de la minute,
 *  durée) vit dans `src/chrono.ts` ; le message d'arrêt est celui de la
 *  barre de chrono : deux formulations feraient dire au même arrêt deux
 *  choses différentes selon l'endroit d'où on l'a cliqué. */
function BoutonChronoProjet({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const today = useToday()
  const qui = useMoi().nom || ''
  const chrono = chronoDe(state.chronos as ChronoActif[], qui) as ChronoActif | null
  // « ici » = ce projet, sans tâche : le chrono d'une tâche du projet
  // s'arrête depuis sa fiche, là où on l'a lancé
  const iciEnCours = Boolean(chrono && chrono.projetId === p.id && !chrono.tacheId)
  const phase = phaseCourante(p, today)

  const demarrer = () => {
    if (!qui) {
      toast('Indiquez d’abord qui vous êtes (menu du haut) : un temps sans personne ne se rattache à rien.', { tone: 'warn' })
      return
    }
    const maintenant = new Date().toISOString()
    const { chrono: nouveau, arret } = basculerChrono(
      chrono,
      qui,
      { projetId: p.id, phase: phase?.code ?? null, libelle: `${p.id} — ${p.nom}` },
      maintenant,
    )
    update((d) => {
      if (arret?.pointage) d.pointages = [...(d.pointages || []), arret.pointage]
      d.chronos = poserChrono(d.chronos as ChronoActif[], nouveau, qui)
    })
    const demarrage = `Chrono démarré sur ${p.id}${phase ? ` · ${phase.code}` : ''}.`
    // la bascule est silencieuse si on ne la dit pas : le chrono précédent
    // vient d'être arrêté ET enregistré
    toast(arret ? `${messageArretHonnete(arret.message, !!arret.pointage)} ${demarrage}` : demarrage, { tone: 'ok' })
  }

  const arreter = () => {
    if (!chrono) return
    const { pointage, message } = arreterChrono(chrono, new Date().toISOString())
    update((d) => {
      d.chronos = poserChrono(d.chronos as ChronoActif[], null, qui)
      if (pointage) d.pointages = [...(d.pointages || []), pointage]
    })
    toast(messageArretHonnete(message, !!pointage), { tone: pointage ? 'ok' : 'warn' })
  }

  return iciEnCours ? (
    <Btn small onClick={arreter} title={`Arrêter le chrono de ${p.id} et enregistrer le temps`}>
      ■ Arrêter le chrono
    </Btn>
  ) : (
    <Btn
      small
      onClick={demarrer}
      title={
        `Démarrer le chrono sur ${p.id}${phase ? ` · ${phase.code}` : ''}` +
        (chrono ? ' — le chrono en cours sera arrêté et enregistré' : '')
      }
    >
      ▶ Chrono
    </Btn>
  )
}

/** S3 — le résumé qui remplace les deux cartes après la signature. Rien
 *  n'est supprimé : « Déplier » rend le barème MIQCP et les 27 critères
 *  tels quels, et aucun chiffre n'est recalculé ici (`calculHonoraires`). */
function ResumeHonoraires({ projet: p }: { projet: Projet }) {
  const { state } = useStore()
  const [ouvert, setOuvert] = useState(false)
  const h = calculHonoraires(p, state.settings)

  if (ouvert)
    return (
      <>
        <div className="grid2">
          <CarteHonoraires projet={p} />
          <CarteComplexite projet={p} />
        </div>
        <p style={{ margin: '0 2px 12px' }}>
          <Btn small onClick={() => setOuvert(false)}>Replier honoraires & complexité</Btn>
        </p>
      </>
    )

  return (
    <Card
      titre="Honoraires & complexité"
      actions={<Btn small onClick={() => setOuvert(true)}>Déplier</Btn>}
    >
      <p className="small" style={{ margin: 0 }}>
        <strong><Money v={h.honorairesTotauxHT} /> HT</strong> · taux retenu {fmtPct(h.tauxFinal, 2)} · coefficient{' '}
        {fmtCoef(h.coef)}
        {p.coefManuel !== null && p.coefManuel !== undefined ? ' (manuel)' : ''} · travaux{' '}
        <Money v={p.montantTravauxHT} /> HT
        <span className="muted"> — réglés à la signature ; « Déplier » pour le barème et les 27 critères.</span>
      </p>
    </Card>
  )
}

/** onglet Documents fusionné : le Drive + registre du projet ET le DCE
 *  structuré (CCTP/DPGF) — plus deux systèmes qui se ressemblent */
function OngletDocumentsProjet({ projet: p, vueInitiale }: { projet: Projet; vueInitiale: 'tous' | 'dce' }) {
  const [vue, setVue] = useState<'tous' | 'dce'>(vueInitiale)
  return (
    <>
      <Tabs
        tabs={[
          { id: 'tous', label: 'Tous les documents' },
          { id: 'dce', label: 'DCE structuré (CCTP · DPGF)' },
        ]}
        actif={vue}
        onSelect={(id) => setVue(id as 'tous' | 'dce')}
      />
      {vue === 'tous' ? <ProjetDocuments projet={p} /> : <ProjetDCE projet={p} />}
    </>
  )
}

/** barre compacte des sous-pages : phase, prochaine échéance, alerte
 *  principale — les 4 grandes cartes ne vivent que sur la vue d'ensemble */
function BarreProjetCompacte({ projet: p }: { projet: Projet }) {
  const { state } = useStore()
  const today = useToday()
  const phase = phaseCourante(p, today)
  const prochainePhase = p.phases
    .filter((ph) => ph.fin && ph.fin >= today && ph.montantHT > 0)
    .sort((a, b) => (a.fin || '').localeCompare(b.fin || ''))[0]
  const prochaineEcheance = state.echeancesFacturation
    .filter((e) => e.projetId === p.id && e.datePrevue >= today)
    .sort((a, b) => a.datePrevue.localeCompare(b.datePrevue))[0]
  const enRetard = state.factures.filter((f) => f.projetId === p.id && retardFacture(state, f, today) > 0)
  return (
    <p
      className="small"
      style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', margin: '0 2px 12px' }}
    >
      {phase && (
        <span title={LIBELLES_PHASES[phase.code]}>
          <Badge tone="info">phase {phase.code}</Badge>
        </span>
      )}
      {prochaineEcheance ? (
        <span>
          Prochaine échéance : <strong>{fmtMoney(prochaineEcheance.montantHT)} HT à facturer</strong> le{' '}
          <DateF d={prochaineEcheance.datePrevue} />
        </span>
      ) : prochainePhase ? (
        <span>
          Prochaine échéance : <strong>rendu {prochainePhase.code}</strong> le <DateF d={prochainePhase.fin!} />
        </span>
      ) : (
        <span className="muted">aucune échéance datée à venir</span>
      )}
      {enRetard.length > 0 && (
        <span className="danger-text">
          {enRetard.length} facture(s) en retard — <a href="#/facturation">relancer</a>
        </span>
      )}
      <a href={`#/projets/${p.id}`} className="muted">
        vue d'ensemble →
      </a>
    </p>
  )
}

/** bandeau : les 4 chiffres qui résument le projet — vue d'ensemble uniquement */
function BandeauProjet({ projet: p }: { projet: Projet }) {
  const { state } = useStore()
  const today = useToday()
  const h = calculHonoraires(p, state.settings)
  const fact = factureHT(state, p.id)
  const reste = h.honorairesTotauxHT - fact
  const hReel = heuresReelles(state, p.id)
  const hPrev = heuresPrevues(p)

  const prochainePhase = p.phases
    .filter((ph) => ph.fin && ph.fin >= today && ph.montantHT > 0)
    .sort((a, b) => (a.fin || '').localeCompare(b.fin || ''))[0]
  const prochaineEcheance = state.echeancesFacturation
    .filter((e) => e.projetId === p.id && e.datePrevue >= today)
    .sort((a, b) => a.datePrevue.localeCompare(b.datePrevue))[0]
  // l'échéance CONCRÈTE la plus proche : une facturation datée bat un code de phase
  const echeance =
    prochaineEcheance && (!prochainePhase?.fin || prochaineEcheance.datePrevue <= prochainePhase.fin)
      ? { valeur: 'Facture à émettre', date: prochaineEcheance.datePrevue, complement: `${fmtMoney(prochaineEcheance.montantHT)} HT — ${prochaineEcheance.libelle}` }
      : prochainePhase
        ? { valeur: prochainePhase.code, date: prochainePhase.fin!, complement: `rendu de phase (${LIBELLES_PHASES[prochainePhase.code]})` }
        : null
  const enRetard = state.factures.filter((f) => f.projetId === p.id && retardFacture(state, f, today) > 0)

  return (
    <div className="grid4" style={{ marginBottom: 8 }}>
      <Stat label="Honoraires totaux" value={<Money v={h.honorairesTotauxHT} />} sub={`taux ${fmtPct(h.tauxFinal, 2)}`} />
      <Stat
        label="Facturé / reste"
        value={<Money v={fact} />}
        sub={<>reste à facturer {fmtMoney(Math.max(0, reste))}</>}
        tone={enRetard.length > 0 ? 'danger' : undefined}
      />
      <Stat
        label="Heures réel / prévu"
        value={`${Math.round(hReel)} / ${Math.round(hPrev)} h`}
        tone={hPrev > 0 && hReel >= hPrev ? 'danger' : hPrev > 0 && hReel >= hPrev * state.settings.seuilDeriveHeures ? 'warn' : undefined}
        sub={<a href="#/temps">pointer les heures →</a>}
      />
      <Stat
        label="Prochaine échéance"
        value={echeance ? echeance.valeur : '—'}
        sub={
          enRetard.length > 0 ? (
            <span className="danger-text">{enRetard.length} facture(s) en retard — <a href="#/facturation">relancer</a></span>
          ) : echeance ? (
            <><DateF d={echeance.date} /> · {echeance.complement}</>
          ) : (
            'aucune échéance datée à venir'
          )
        }
      />
    </div>
  )
}

/** ligne « carte d'identité » sous le bandeau (dates, équipe, accès commande…) */
function LigneIdentite({ projet: p }: { projet: Projet }) {
  const today = useToday()
  const items: ReactNode[] = []
  // « où en est-on ? » se lisait sur les sous-pages (barre compacte) mais pas
  // sur la vue d'ensemble, qui est pourtant la page d'arrivée du projet
  {
    const phase = phaseCourante(p, today)
    if (phase)
      items.push(
        <span key="phase" title={`phase en cours — ${LIBELLES_PHASES[phase.code]}`}>
          <Badge tone="info">phase {phase.code}</Badge>{' '}
          <span className="muted">{LIBELLES_PHASES[phase.code]}</span>
        </span>,
      )
  }
  if (p.codeExterne)
    items.push(
      <span key="code" title="code du projet côté client">
        n° {p.codeExterne}
      </span>,
    )
  if (p.adresseProjet)
    items.push(
      <span key="adresse" className="mono" title="adresse dédiée du projet">
        {p.adresseProjet}
      </span>,
    )
  if (p.dateLancement || p.dateCloture)
    items.push(
      <span key="dates">
        📅 <DateF d={p.dateLancement ?? null} /> → <DateF d={p.dateCloture ?? null} />
      </span>,
    )
  {
    const equipe = equipeDuProjet(p)
    if (equipe.length > 0) items.push(<span key="resp">👤 {equipe.join(', ')}</span>)
  }
  if (p.chargeOperation) items.push(<span key="co">MOA : {p.chargeOperation}</span>)
  if (p.accesCommande) items.push(<span key="acces">{p.accesCommande}</span>)
  if (p.typologie || p.typeConstruction)
    items.push(<span key="typo">{[p.typologie, p.typeConstruction].filter(Boolean).join(' · ')}</span>)
  if (p.trajetAller) items.push(<span key="trajet">🚗 {p.trajetAller}</span>)
  if (p.plaisir) items.push(<span key="plaisir" title="plaisir /5">{'★'.repeat(p.plaisir)}</span>)
  if (items.length === 0) return null
  return (
    <p className="muted small" style={{ margin: '0 2px 16px', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {items}
    </p>
  )
}

// ============================================================
// Économie du projet (audit finance F6) — cinq états des coûts
// externes (budget / engagé / facturé / payé / final prévu) et
// reste à faire révisable par phase (base de la marge finale).
// ============================================================

function EconomieProjet({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const today = useToday()
  const cinq = cinqEtatsExterne(state, p)
  const rf = resteAFaireProjet(state, p)
  const [edit, setEdit] = useState(false)

  const reviser = (phase: PhaseCode, champ: 'heuresRestantes' | 'coutExterneRestantHT', v: number | null) =>
    update((d) => {
      const ex = d.revisionsResteAFaire.find((r) => r.projetId === p.id && r.phase === phase)
      if (ex) {
        ex[champ] = v
        ex.majLe = today
      } else {
        d.revisionsResteAFaire.push({ id: uid('rrf'), projetId: p.id, phase, heuresRestantes: null, coutExterneRestantHT: null, [champ]: v, majLe: today })
      }
    })
  const valeurRev = (phase: PhaseCode, champ: 'heuresRestantes' | 'coutExterneRestantHT') =>
    state.revisionsResteAFaire.find((r) => r.projetId === p.id && r.phase === phase)?.[champ] ?? null

  return (
    <Card
      titre="Coûts externes — les cinq états (jamais confondus)"
      actions={<Btn small onClick={() => setEdit((e) => !e)}>{edit ? 'Fermer' : 'Réviser le reste à faire'}</Btn>}
    >
      <div className="grid5">
        <Stat label="Budget" value={<Money v={cinq.budget} />} sub="prévu" />
        <Stat label="Engagé" value={<Money v={cinq.engage} />} sub="commandé (contrats fourn.)" />
        <Stat label="Facturé" value={<Money v={cinq.facture} />} sub="factures fournisseurs" />
        <Stat label="Payé" value={<Money v={cinq.paye} />} sub="preuve bancaire" />
        <Stat label="Final prévu" value={<Money v={cinq.finalPrevu} />} sub="facturé + reste révisé" />
      </div>
      <p className="muted small" style={{ margin: '8px 2px 0' }}>
        Reste à faire {rf.revise ? '(révisé)' : '(dérivé du budget)'} : {Math.round(rf.heures)} h internes + {fmtMoney(rf.coutExterne)} externes = {fmtMoney(rf.cout)} → base de la marge finale.
      </p>
      {edit && (
        <Table compact head={['Phase', <span key="h" className="right">Heures restantes</span>, <span key="e" className="right">Coût externe restant HT</span>]}>
          {p.phases
            .filter((ph) => ph.montantHT > 0 || ph.heuresPrevues > 0 || (ph.coutExterneHT || 0) > 0)
            .map((ph) => (
              <tr key={ph.code}>
                <td>{ph.code}</td>
                <td className="right"><NumInput value={valeurRev(ph.code, 'heuresRestantes')} onChange={(v) => reviser(ph.code, 'heuresRestantes', v)} placeholder={String(Math.max(0, ph.heuresPrevues - heuresReelles(state, p.id, ph.code)))} style={{ width: 90 }} /></td>
                <td className="right"><NumInput value={valeurRev(ph.code, 'coutExterneRestantHT')} onChange={(v) => reviser(ph.code, 'coutExterneRestantHT', v)} placeholder={String(ph.coutExterneHT || 0)} style={{ width: 100 }} /></td>
              </tr>
            ))}
        </Table>
      )}
    </Card>
  )
}

// ============================================================
// 5.10 — Cotraitance : la chaîne d'honoraires ENTRANTE.
// Le bloc vit dans l'onglet Finance de la fiche projet, pas dans
// Chantier : un BET facture la maîtrise d'œuvre dès l'ESQ, bien
// avant tout marché de travaux — et c'est ici que la marge lit
// les coûts externes, donc ici que le réel reçu doit se lire
// FACE au convenu (affiché, jamais versé dans le calcul : 5.14).
// ============================================================

const TYPES_COTRAITANT: TypeCotraitant[] = ['bet', 'agence', 'autre']
const MOIS_SAISIE_VALIDE = /^\d{4}-\d{2}$/

function CarteCotraitance({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const today = useToday()
  const moisCourant = monthKey(today)
  /** cotraitant dont les notes sont dépliées */
  const [ouvert, setOuvert] = useState<string | null>(null)

  const cotraitants = state.cotraitants
    .filter((c) => c.projetId === p.id)
    // actifs d'abord (ce sont eux qu'on surveille), puis par nom
    .sort((a, b) => (a.actif === b.actif ? a.nom.localeCompare(b.nom, 'fr') : a.actif ? -1 : 1))
  const notes = state.notesHonoraires

  const convenuTotal = convenuProjetHT(state.cotraitants, p.id)
  const recuTotal = recuProjetHT(state.notesHonoraires, p.id)
  const budgetPhases = coutsExternes(state, p.id)

  /** le MÊME brouillon que l'action rapide du fil d'urgences (Cockpit) :
   *  le texte vient de src/cotraitants.ts, l'envoi reste le clic « Envoyer »
   *  de Gmail (§15) */
  const relancer = (c: Cotraitant, mois: string) =>
    ouvrirGmail(
      c.email || '',
      sujetRelanceNote(c, mois),
      corpsRelanceNote(c, mois, nomProjet(state, p.id), state.settings.nomAgence),
    )

  const majCotraitant = (id: string, fn: (x: Cotraitant) => void) =>
    update((d) => {
      const x = d.cotraitants.find((y) => y.id === id)
      if (x) fn(x)
    })

  const retirer = async (c: Cotraitant) => {
    const nbNotes = state.notesHonoraires.filter((n) => n.cotraitantId === c.id).length
    const snap = state
    if (
      !(await confirmer({
        message:
          `Retirer ${c.nom} de la cotraitance de ${p.id} ?` +
          (nbNotes > 0 ? `\nSes ${nbNotes} note(s) d'honoraires consignée(s) seront retirées aussi.` : ''),
        danger: true,
        confirmerLabel: 'Retirer',
      }))
    )
      return
    update((d) => {
      d.cotraitants = d.cotraitants.filter((x) => x.id !== c.id)
      d.notesHonoraires = d.notesHonoraires.filter((n) => n.cotraitantId !== c.id)
    })
    toast(`${c.nom} retiré de la cotraitance.`, { undo: () => replace(snap) })
  }

  return (
    <Card titre="Cotraitance (BET, agences) — honoraires entrants">
      {cotraitants.length === 0 ? (
        <EmptyState>
          Aucun partenaire de maîtrise d'œuvre — BET structure, fluides, économiste, OPC… Chacun
          porte ses honoraires convenus, et sa note d'honoraires mensuelle se consigne à réception :
          le mois qui manque se relance en un clic.
        </EmptyState>
      ) : (
        <Table
          compact
          head={[
            'Cotraitant',
            'Mission',
            <span key="c" className="right" title="convention de groupement / contrat">Convenu HT</span>,
            <span key="r" className="right" title="cumul des notes d'honoraires reçues">Reçu HT</span>,
            <span key="s" className="right">Reste</span>,
            'Notes',
            '',
          ]}
        >
          {cotraitants.map((c) => {
            const manquants = moisManquants(c, notes, moisCourant)
            const siennes = notes
              .filter((n) => n.cotraitantId === c.id)
              .sort((a, b) => b.mois.localeCompare(a.mois))
            const reste = resteAPayer(c, notes)
            const deplie = ouvert === c.id
            return (
              // Fragment de React, pas un composant local : le composant
              // Table ne sait étiqueter (data-label, rendu téléphone) qu'à
              // travers un vrai Fragment — un intermédiaire perdrait les
              // libellés de colonnes sur mobile
              <Fragment key={c.id}>
                <tr>
                  <td>
                    <strong>{c.nom}</strong> <Badge tone="muted">{LIBELLE_TYPE_COTRAITANT[c.type]}</Badge>
                    {!c.actif && <Badge tone="muted">mission terminée</Badge>}
                    {c.email && <div className="muted small">{c.email}</div>}
                  </td>
                  <td className="small">{c.mission || '—'}</td>
                  <td className="right">{c.honorairesConvenusHT !== null ? <Money v={c.honorairesConvenusHT} /> : <span className="muted">—</span>}</td>
                  <td className="right"><Money v={cumulRecuHT(c.id, notes)} /></td>
                  <td className="right">
                    {reste === null ? (
                      <span className="muted" title="honoraires convenus non saisis : le reste ne s'invente pas">—</span>
                    ) : (
                      <span style={reste < 0 ? { color: 'var(--danger)' } : undefined} title={reste < 0 ? 'le reçu dépasse le convenu — avenant à régulariser ?' : undefined}>
                        {fmtMoney(reste)}
                      </span>
                    )}
                  </td>
                  <td>
                    {siennes.filter((n) => n.recueLe).length > 0 && (
                      <span className="small">{siennes.filter((n) => n.recueLe).length} reçue{siennes.filter((n) => n.recueLe).length > 1 ? 's' : ''}</span>
                    )}{' '}
                    {manquants.length > 0 && (
                      <Badge tone="warn">
                        {manquants.length > 1 ? `${manquants.length} mois manquent` : `${fmtMois(manquants[0])} manque`}
                      </Badge>
                    )}
                    {c.actif && siennes.length === 0 && (
                      <span className="muted small" title="les mois échus se comptent depuis la première note consignée">
                        aucune note consignée
                      </span>
                    )}
                  </td>
                  <td className="right">
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <Btn small onClick={() => setOuvert(deplie ? null : c.id)}>
                        {deplie ? 'Replier' : 'Notes'}
                      </Btn>
                      <RowMenu
                        items={[
                          ...(c.email && manquants.length > 0
                            ? [{
                                label: `Relancer (${fmtMois(manquants[0])}) — brouillon Gmail`,
                                onClick: () => relancer(c, manquants[0]),
                              }]
                            : []),
                          {
                            label: c.actif ? 'Marquer la mission terminée' : 'Réactiver la mission',
                            onClick: () => majCotraitant(c.id, (x) => { x.actif = !x.actif }),
                          },
                          { label: 'Retirer de la cotraitance', onClick: () => void retirer(c), danger: true },
                        ]}
                      />
                    </span>
                  </td>
                </tr>
                {deplie && (
                  <tr>
                    <td colSpan={7} style={{ background: 'var(--bg-soft)' }}>
                      <NotesCotraitant cotraitant={c} manquants={manquants} onRelancer={relancer} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </Table>
      )}
      <AjoutCotraitant projet={p} />
      {(cotraitants.length > 0 || budgetPhases > 0) && (
        <p className="muted small" style={{ margin: '8px 2px 0' }}>
          Convenu {fmtMoney(convenuTotal)} · reçu {fmtMoney(recuTotal)} — face au budget externe des
          phases ({fmtMoney(budgetPhases)}), qui reste la base de la marge : le réel s'affiche ici,
          il ne remplace pas le calcul (audit 5.14).
        </p>
      )}
    </Card>
  )
}

/** notes d'honoraires d'UN cotraitant : mois manquants relançables, notes
 *  consignées (montant, réception, règlement), consignation d'une nouvelle */
function NotesCotraitant({
  cotraitant: c,
  manquants,
  onRelancer,
}: {
  cotraitant: Cotraitant
  manquants: string[]
  onRelancer: (c: Cotraitant, mois: string) => void
}) {
  const { state, update, replace } = useStore()
  const today = useToday()
  // T3 — le commentaire promettait le mois attendu, le champ arrivait vide et
  // se retapait à chaque note : `moisManquants` (src/cotraitants.ts) le connaît
  // déjà, c'est le PREMIER manquant qu'on consigne. Rien n'est écrit pour
  // autant : la proposition reste modifiable avant « Consigner ».
  const [mois, setMois] = useState(manquants[0] || '')
  const [montant, setMontant] = useState<number | null>(null)

  const siennes = state.notesHonoraires
    .filter((n) => n.cotraitantId === c.id)
    .sort((a, b) => b.mois.localeCompare(a.mois))

  const majNote = (id: string, fn: (n: (typeof siennes)[number]) => void) =>
    update((d) => {
      const n = d.notesHonoraires.find((x) => x.id === id)
      if (n) fn(n)
    })

  const consigner = () => {
    const m = mois.trim()
    if (!MOIS_SAISIE_VALIDE.test(m)) {
      toast('Mois attendu au format AAAA-MM (ex. 2026-07).', { tone: 'danger' })
      return
    }
    if (siennes.some((n) => n.mois === m)) {
      toast(`Une note ${fmtMois(m)} est déjà consignée pour ${c.nom} — une attendue par mois.`, { tone: 'danger' })
      return
    }
    update((d) => {
      d.notesHonoraires.push({
        id: uid('nh'),
        cotraitantId: c.id,
        projetId: c.projetId,
        mois: m,
        montantHT: montant,
        recueLe: todayISO(),
        reglee: false,
      })
    })
    // le mois suivant qui manque prend la place : à la fin du mois on en
    // consigne souvent plusieurs d'affilée
    setMois(manquants.find((x) => x !== m) || '')
    setMontant(null)
  }

  return (
    <div style={{ padding: '4px 2px' }}>
      {manquants.length > 0 && (
        <p className="small" style={{ margin: '4px 0 8px' }}>
          {manquants.map((m) => (
            <span key={m} style={{ marginRight: 10 }}>
              <Badge tone="warn">{fmtMois(m)} manque</Badge>{' '}
              {c.email && (
                <Btn small kind="ghost" onClick={() => onRelancer(c, m)} title="ouvre un brouillon Gmail — l'envoi reste votre clic">
                  Relancer
                </Btn>
              )}
            </span>
          ))}
        </p>
      )}
      {siennes.length > 0 && (
        <Table
          compact
          head={['Mois', <span key="m" className="right">Montant HT</span>, 'Reçue', 'Réglée', '']}
        >
          {siennes.map((n) => (
            <tr key={n.id}>
              <td>{fmtMois(n.mois)}</td>
              <td className="right">
                <NumInput
                  value={n.montantHT}
                  onChange={(v) => majNote(n.id, (x) => { x.montantHT = v })}
                  style={{ width: 100 }}
                  ariaLabel={`Montant HT de la note ${fmtMois(n.mois)} — ${c.nom}`}
                />
              </td>
              <td>
                {n.recueLe ? (
                  <span className="small">le {fmtDate(n.recueLe)}</span>
                ) : (
                  <Btn small onClick={() => majNote(n.id, (x) => { x.recueLe = todayISO() })}>
                    Reçue aujourd'hui
                  </Btn>
                )}
              </td>
              <td>
                {/* le règlement suit la réception : régler une note jamais
                    reçue n'a pas de sens, le bouton n'apparaît pas */}
                {n.reglee ? (
                  <Badge tone="ok">réglée</Badge>
                ) : n.recueLe ? (
                  <Btn small kind="ghost" onClick={() => majNote(n.id, (x) => { x.reglee = true })}>
                    Marquer réglée
                  </Btn>
                ) : (
                  <span className="muted small">—</span>
                )}
              </td>
              <td className="right">
                <RowMenu
                  items={[
                    ...(n.reglee
                      ? [{ label: 'Annuler le règlement', onClick: () => majNote(n.id, (x) => { x.reglee = false }) }]
                      : []),
                    ...(n.recueLe && !n.reglee
                      ? [{ label: 'Annuler la réception', onClick: () => majNote(n.id, (x) => { x.recueLe = null }) }]
                      : []),
                    {
                      label: 'Retirer la note',
                      danger: true,
                      onClick: () => {
                        const snap = state
                        update((d) => {
                          d.notesHonoraires = d.notesHonoraires.filter((x) => x.id !== n.id)
                        })
                        toast(`Note ${fmtMois(n.mois)} retirée.`, { undo: () => replace(snap) })
                      },
                    },
                  ]}
                />
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
        <TextInput value={mois} onChange={setMois} placeholder={`Mois (ex. ${monthKey(today)})`} style={{ width: 130 }} ariaLabel={`Mois de la note à consigner — ${c.nom}`} />
        <NumInput value={montant} onChange={setMontant} placeholder="Montant HT" style={{ width: 110 }} ariaLabel={`Montant HT de la note à consigner — ${c.nom}`} />
        <Btn small kind="primary" onClick={consigner} disabled={!mois.trim()}>
          Consigner la note reçue
        </Btn>
        {siennes.length === 0 && (
          <span className="muted small">
            La première note consignée fixe le début de mission : les mois échus se comptent depuis elle.
          </span>
        )}
      </div>
    </div>
  )
}

/** ajout d'un cotraitant — le convenu peut rester vide (pas encore
 *  contractualisé) : le reste à payer répondra « — », jamais 0 */
function AjoutCotraitant({ projet: p }: { projet: Projet }) {
  const { update } = useStore()
  const [nom, setNom] = useState('')
  const [type, setType] = useState<TypeCotraitant>('bet')
  const [mission, setMission] = useState('')
  const [convenu, setConvenu] = useState<number | null>(null)
  const [email, setEmail] = useState('')

  const ajouter = () => {
    if (!nom.trim()) return
    update((d) => {
      d.cotraitants.push({
        id: uid('cot'),
        projetId: p.id,
        nom: nom.trim(),
        type,
        mission: mission.trim(),
        honorairesConvenusHT: convenu,
        email: email.trim() || undefined,
        actif: true,
      })
    })
    setNom('')
    setMission('')
    setConvenu(null)
    setEmail('')
  }

  return (
    <div className="toolbar" style={{ marginTop: 10, marginBottom: 0, flexWrap: 'wrap' }}>
      <TextInput value={nom} onChange={setNom} placeholder="Nom (ex. BET Structure Nord)" style={{ width: 200 }} />
      <Select value={type} onChange={(v) => setType(v as TypeCotraitant)} options={TYPES_COTRAITANT.map((t) => ({ value: t, label: LIBELLE_TYPE_COTRAITANT[t] }))} />
      <TextInput value={mission} onChange={setMission} placeholder="Mission (structure, fluides…)" style={{ width: 180 }} />
      <NumInput value={convenu} onChange={setConvenu} placeholder="Convenu HT" style={{ width: 110 }} ariaLabel="Honoraires convenus HT du cotraitant" />
      <TextInput value={email} onChange={setEmail} placeholder="contact@bet.example (pour les relances)" style={{ width: 200 }} />
      <Btn small kind="primary" onClick={ajouter} disabled={!nom.trim()}>
        Ajouter
      </Btn>
    </div>
  )
}

// ============================================================
// Onglet Finances — factures du projet (auto) + temps
// ============================================================

function OngletFinances({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const today = useToday()

  const factures = state.factures
    .filter((f) => f.projetId === p.id)
    .sort((a, b) => a.emission.localeCompare(b.emission))
  const echeances = state.echeancesFacturation
    .filter((e) => e.projetId === p.id)
    .sort((a, b) => a.datePrevue.localeCompare(b.datePrevue))

  const generer = async () => {
    // calculées AVANT la mutation (producteur rejouable)
    const nouvelles = echeancesParDefaut(p, state.settings)
    if (nouvelles.length === 0) {
      toast('Rien à générer : datez d’abord les phases (onglet Pilotage) — l’échéancier se construit sur les fins de phases.', { tone: 'danger' })
      return
    }
    if (
      !(await confirmer({
        message:
          `Générer ${nouvelles.length} échéance(s) de facturation selon le modèle « ${p.typeMO} » ?\n` +
          `Les ${echeances.length} échéance(s) et ${factures.length} facture(s) existantes du projet ne sont pas touchées — attention aux doublons si l’échéancier a déjà été généré.`,
        danger: true,
        confirmerLabel: 'Générer',
      }))
    )
      return
    update((d) => {
      d.echeancesFacturation.push(...nouvelles)
    })
    toast(`${nouvelles.length} échéance(s) de facturation générée(s) — l’émission (numéro, gel) se fait dans Facturation.`, { tone: 'ok' })
  }

  const contrat = contratDuProjet(state, p.id)
  const coutTemps = coutReelTemps(state, p.id)
  const externes = coutsExternes(state, p.id)
  // 5.10 — la cotraitance en face du budget externe (affichage seul)
  const convenuCotraitance = convenuProjetHT(state.cotraitants, p.id)
  const recuCotraitance = recuProjetHT(state.notesHonoraires, p.id)
  const factTotal = factureHT(state, p.id)
  const margeReelle = factTotal - coutTemps - externes
  const joursPointes = enJours(state, heuresReelles(state, p.id))
  const objectifJour = coutJourObjectif(state)
  // audit F6 : production estimée / en-cours + marge finale prévisionnelle
  const prod = productionEstimee(state, p)
  const mf = margeFinale(state, p)

  // comparaison prévu / réel du §11.3 : l'écart se mesure sur la prévision
  // FIGÉE dès qu'il y en a une (`ecartHeures`, src/derive.ts), pas sur la
  // répartition courante qu'un recalcul remet à plat. Aucun calcul ici.
  const heuresParPhase = p.phases
    .map((ph) => ({ code: ph.code, ...ecartHeures(state, p, ph.code) }))
    .filter((x) => x.prevu > 0 || x.reel > 0 || (x.baseline ?? 0) > 0)
  const heuresProjet = ecartHeures(state, p)

  return (
    <>
      <div className="grid4" style={{ marginBottom: 16 }}>
        <Stat
          label="Coût du temps (réel)"
          value={<Money v={coutTemps} />}
          sub="heures pointées × coût horaire de chaque personne"
        />
        <Stat
          label="Budget externe (saisi)"
          value={<Money v={externes} />}
          sub={
            // 5.10 — le RÉEL de la cotraitance s'affiche FACE au budget que
            // la marge lit : affiché, jamais soustrait (audit 5.14)
            convenuCotraitance > 0 || recuCotraitance > 0 ? (
              <>budget des phases — cotraitance : reçu {fmtMoney(recuCotraitance)} / convenu {fmtMoney(convenuCotraitance)}</>
            ) : (
              'BET, sous-traitance — un budget, pas un coût réel (lot F2)'
            )
          }
        />
        <Stat
          label="Marge estimée à date"
          value={<Money v={margeReelle} />}
          tone={margeReelle < 0 ? 'danger' : 'ok'}
          sub={<>facturé {fmtMoney(factTotal)} − temps − budget externe saisi</>}
        />
        <Stat
          label="€ / jour réel"
          value={joursPointes > 0.05 ? fmtMoney(factTotal / joursPointes) : '—'}
          tone={joursPointes > 0.05 ? (factTotal / joursPointes >= objectifJour ? 'ok' : 'warn') : undefined}
          sub={<>objectif {fmtMoney(objectifJour)} · <a href="#/pilotage/missions">Pilotage →</a></>}
        />
      </div>

      {/* ---------- économie du projet (audit finance F6) ---------- */}
      <EconomieProjet projet={p} />
      <div className="grid4" style={{ marginBottom: 16 }}>
        <Stat label="Production estimée" value={<Money v={prod.production} />} sub="avancement × honoraires — indicatif, pas une écriture" />
        <Stat label="En-cours (WIP)" value={<Money v={prod.enCours} />} tone={prod.enCours < 0 ? 'warn' : undefined} sub="production − facturé" />
        <Stat label="Marge finale prévue" value={<Money v={mf.marge} />} tone={mf.marge < 0 ? 'danger' : 'ok'} sub={<>signés {fmtMoney(mf.honorairesSignes)} − coût final {fmtMoney(mf.coutFinal)}</>} />
        <Stat label="Dérive de marge" value={<Money v={mf.derive} />} tone={mf.derive < -0.01 ? 'danger' : 'ok'} sub={<>vs marge initiale {fmtMoney(mf.margeInitiale)}</>} />
      </div>

      {/* ---------- 5.10 : cotraitance, honoraires entrants ---------- */}
      <CarteCotraitance projet={p} />

      <Card
        titre={`Échéancier du projet (${factures.length} facture${factures.length > 1 ? 's' : ''} · ${echeances.length} prévue${echeances.length > 1 ? 's' : ''})`}
        actions={
          <>
            {contrat && (
              <a href={`#/contrats/${contrat.id}`} className="small">
                Contrat ({fmtMoney(totalContratHT(contrat))} HT{contrat.provisoire ? ' · provisoire' : ''}) →
              </a>
            )}
            <a href="#/facturation" className="small">Module Facturation →</a>
            <Btn small kind="primary" onClick={generer}>(Re)générer l'échéancier</Btn>
          </>
        }
      >
        {factures.length === 0 && echeances.length === 0 ? (
          <EmptyState>
            Aucune facture ni échéance — « (Re)générer l'échéancier » crée les échéances automatiquement
            depuis les phases datées (modèle {p.typeMO}).
          </EmptyState>
        ) : (
          <Table
            compact
            head={['N°', 'Phase', 'Libellé', <span key="h" className="right">HT</span>, <span key="t" className="right">TTC</span>, 'Émission', 'Statut']}
          >
            {factures.map((f) => {
              const retard = retardFacture(state, f, today)
              return (
                <tr key={f.id}>
                  <td className="mono">{f.numero || f.id}</td>
                  <td>{f.phase}</td>
                  <td>{f.libelle}</td>
                  <td className="right"><Money v={f.montantHT} /></td>
                  <td className="right"><Money v={ttc(f)} /></td>
                  <td><DateF d={f.emission} /></td>
                  <td>
                    {retard > 0 ? (
                      <Badge tone="danger">en retard {retard} j</Badge>
                    ) : f.statut === 'encaissee' ? (
                      <Badge tone="ok">encaissée</Badge>
                    ) : (
                      <Badge tone="info">émise · échéance {encaissementPrevu(f)}</Badge>
                    )}
                  </td>
                </tr>
              )
            })}
            {echeances.map((e) => (
              <tr key={e.id}>
                <td className="muted small">— à émettre —</td>
                <td>{e.phase}</td>
                <td>{e.libelle}</td>
                <td className="right"><Money v={e.montantHT} /></td>
                <td className="right"><Money v={e.montantHT * (1 + e.tauxTVA)} /></td>
                <td><DateF d={e.datePrevue} /></td>
                <td><Badge tone="muted">prévue</Badge></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card
        titre="Temps par phase — prévu / réel"
        actions={
          <>
            <a href={`#/projets/${p.id}/pilotage`} className="small">Phases →</a>
            <a href="#/temps" className="small">Saisie des temps →</a>
          </>
        }
      >
        <NoteBaseline projet={p} />
        {heuresParPhase.length === 0 ? (
          <EmptyState>Aucune heure prévue ni pointée.</EmptyState>
        ) : (
          <Table
            compact
            head={[
              'Phase',
              <span key="b" className="right" title="prévision figée — la référence de l’écart (CDC §11.3)">Référence</span>,
              <span key="p" className="right" title="répartition courante, écrasée par « Recalculer la répartition »">Prévu</span>,
              <span key="r" className="right">Pointé</span>,
              <span key="e" className="right">Écart</span>,
              'Consommation',
            ]}
          >
            {heuresParPhase.map((x) => (
              <tr key={x.code}>
                <td>{x.code} <span className="muted small">{LIBELLES_PHASES[x.code]}</span></td>
                <td className="right num">{x.baseline !== null ? fmtHeures(x.baseline) : '—'}</td>
                <td className="right num">{fmtHeures(x.prevu)}</td>
                <td className="right num">{fmtHeures(x.reel)}</td>
                <td className="right">
                  <EcartSigne h={x.reel > 0 || x.reference > 0 ? x.ecart : null} />
                </td>
                <td><EcartHeures reel={x.reel} prevu={x.reference} seuil={state.settings.seuilDeriveHeures} /></td>
              </tr>
            ))}
            <tr>
              <td><strong>Total</strong></td>
              <td className="right num"><strong>{heuresProjet.baseline !== null ? fmtHeures(heuresProjet.baseline) : '—'}</strong></td>
              <td className="right num"><strong>{fmtHeures(heuresProjet.prevu)}</strong></td>
              <td className="right num"><strong>{fmtHeures(heuresProjet.reel)}</strong></td>
              <td className="right"><strong><EcartSigne h={heuresProjet.ecart} /></strong></td>
              <td><EcartHeures reel={heuresProjet.reel} prevu={heuresProjet.reference} seuil={state.settings.seuilDeriveHeures} /></td>
            </tr>
          </Table>
        )}
        <p className="muted small" style={{ margin: '8px 2px 0' }}>
          L’écart est mesuré sur {heuresProjet.surBaseline ? 'la prévision figée' : 'la répartition courante, faute de référence figée'}
          {heuresProjet.derivePrevision !== null && heuresProjet.derivePrevision !== 0 && (
            <> — la répartition courante s’en est éloignée de {ecartSigne(heuresProjet.derivePrevision)} depuis</>
          )}
          .
        </p>
      </Card>
    </>
  )
}

// ============================================================
// Carte Honoraires (MIQCP)
// ============================================================

function CarteHonoraires({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const h = calculHonoraires(p, state.settings)
  const hPrev = heuresPrevues(p)
  const tempsPasseVente = hPrev * tauxVente(state)
  // marge au COÛT RÉEL (comme Finances et Analyse) : plus de forfait.
  // prévisionnel = heures prévues × coût horaire réel moyen de l'équipe + coûts externes
  const coutHoraireReel = coutHoraireMoyen(state)
  const coutExterne = coutsExternes(state, p.id)
  const coutPrevisionnel = hPrev * coutHoraireReel + coutExterne
  const marge = h.honorairesTotauxHT - coutPrevisionnel
  const margePct = h.honorairesTotauxHT > 0 ? marge / h.honorairesTotauxHT : null

  const maj = (fn: (pr: Projet) => void) =>
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (pr) fn(pr)
    })

  return (
    <Card titre="Honoraires (MIQCP)">
      {h.sousPlancher && (
        <div className="pill-note">
          Sous ~{fmtMoney(seuilPlancherActualise(state.settings))} de travaux, le guide MIQCP renvoie au
          chiffrage en temps passé — le barème n’est ici qu’un repère.
        </div>
      )}
      <dl className="kv">
        <dt>Montant de travaux HT</dt>
        <dd><Money v={p.montantTravauxHT} /></dd>

        <dt>Taux barème (actualisé BT01)</dt>
        <dd>{fmtPct(h.tauxBareme, 2)}</dd>

        <dt>Coefficient de complexité</dt>
        <dd>
          {fmtCoef(h.coef)}{' '}
          <span className="muted small">
            {p.coefManuel !== null && p.coefManuel !== undefined ? '(manuel)' : h.coef !== null ? '(calculé sur les 27 critères)' : '(choisir un type d’ouvrage ou saisir un coef manuel)'}
          </span>
        </dd>

        <dt>Taux ajusté (barème × coef)</dt>
        <dd>{fmtPct(h.tauxAjuste, 2)}</dd>

        <dt>Taux retenu</dt>
        <dd>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <PctInput
              value={p.tauxRetenu ?? null}
              onChange={(v) => maj((pr) => { pr.tauxRetenu = v })}
              placeholder="auto"
              style={{ width: 110 }}
              ariaLabel="Taux d'honoraires retenu en pourcentage"
            />
            <span className="muted small">
              {p.tauxRetenu !== null && p.tauxRetenu !== undefined
                ? 'taux négocié'
                : `vide = taux ajusté (${fmtPct(h.tauxFinal, 2)}) — ex. 12 pour 12 %`}
            </span>
          </span>
        </dd>

        <dt>Honoraires mission de base HT</dt>
        <dd><Money v={h.honorairesBaseHT} /></dd>

        <dt>Missions complémentaires HT</dt>
        <dd>
          <NumInput
            value={p.missionsComplHT ?? 0}
            onChange={(v) => maj((pr) => { pr.missionsComplHT = v ?? 0 })}
            style={{ width: 110 }}
          />
        </dd>

        <dt><strong>Honoraires totaux HT</strong></dt>
        <dd><strong><Money v={h.honorairesTotauxHT} /></strong></dd>

        {p.surfacePlancher != null && p.surfacePlancher > 0 && (
          <>
            <dt>Ratios (SP {p.surfacePlancher} m²)</dt>
            <dd className="muted small">
              travaux {p.montantTravauxHT ? fmtMoney(p.montantTravauxHT / p.surfacePlancher) : '—'}/m² ·
              honoraires {h.honorairesTotauxHT > 0 ? fmtMoney(h.honorairesTotauxHT / p.surfacePlancher) : '—'}/m²
            </dd>
          </>
        )}

        <dt>Équivalent temps passé (vente)</dt>
        <dd>
          <Money v={tempsPasseVente} />{' '}
          <span className="muted small">
            ({fmtHeures(hPrev)} prévues × {fmtMoney(tauxVente(state))}/h)
          </span>
        </dd>

        <dt>Marge prévisionnelle</dt>
        <dd className={marge < 0 ? 'danger-text' : 'ok-text'}>
          {fmtMoney(marge)}
          {margePct !== null && <> ({fmtPct(margePct, 0)})</>}{' '}
          <span className="muted small">
            (honoraires − {fmtHeures(hPrev)} × {fmtMoney(coutHoraireReel, true)}/h coût réel moyen
            {coutExterne > 0 && <> − {fmtMoney(coutExterne)} externes</>})
          </span>
        </dd>
      </dl>
    </Card>
  )
}

// ============================================================
// Carte Complexité — grille des 27 critères MIQCP (repliable)
// ============================================================

function CarteComplexite({ projet: p }: { projet: Projet }) {
  const { update } = useStore()
  const [ouverte, setOuverte] = useState(false)

  const plage = plageOuvrage(p.ouvrage)
  const total = totalPointsComplexite(p)
  const position = 0.5 + total / 108
  const coef = coefComplexite(p)
  const manuel = p.coefManuel !== null && p.coefManuel !== undefined

  const maj = (fn: (pr: Projet) => void) =>
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (pr) fn(pr)
    })

  const noter = (critere: string, note: number) =>
    maj((pr) => {
      if (note === 0) delete pr.notesComplexite[critere]
      else pr.notesComplexite[critere] = note
    })

  return (
    <Card
      titre="Complexité (27 critères MIQCP)"
      actions={
        <Btn small onClick={() => setOuverte(!ouverte)}>
          {ouverte ? 'Masquer la grille' : 'Noter les critères'}
        </Btn>
      }
    >
      <dl className="kv">
        <dt>Type d’ouvrage</dt>
        <dd>{p.ouvrage || <span className="muted">non renseigné (bouton « Modifier »)</span>}</dd>

        <dt>Plage de coefficient</dt>
        <dd>{plage ? `${fmtCoef(plage.bas)} – ${fmtCoef(plage.haut)}` : '—'}</dd>

        <dt>Total des notes</dt>
        <dd>{total > 0 ? `+${total}` : total} <span className="muted small">(de −54 à +54)</span></dd>

        <dt>Position dans la plage</dt>
        <dd>{fmtPct(position, 0)}</dd>

        <dt>Coefficient résultant</dt>
        <dd>
          <strong>{fmtCoef(coef)}</strong>{' '}
          {manuel && <span className="muted small">(coefficient manuel prioritaire)</span>}
        </dd>

        <dt>Coefficient manuel</dt>
        <dd>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <NumInput
              value={p.coefManuel ?? null}
              onChange={(v) => maj((pr) => { pr.coefManuel = v })}
              placeholder="auto"
              style={{ width: 90 }}
            />
            <span className="muted small">vide = calcul par critères</span>
          </span>
        </dd>
      </dl>

      {ouverte && (
        <div style={{ marginTop: 14 }}>
          {manuel && (
            <div className="pill-note">
              Un coefficient manuel est saisi : la grille reste consultable mais n’est pas utilisée
              tant qu’il n’est pas effacé.
            </div>
          )}
          {CRITERES_COMPLEXITE.map((g) => (
            <div key={g.groupe} style={{ marginBottom: 12 }}>
              <div className="small" style={{ fontWeight: 650, margin: '8px 0 6px' }}>{g.groupe}</div>
              {g.criteres.map((c) => (
                <div
                  key={c}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}
                >
                  <span className="small" style={{ flex: 1 }}>{c}</span>
                  <NoteCritere value={p.notesComplexite[c] ?? 0} onChange={(n) => noter(c, n)} />
                </div>
              ))}
            </div>
          ))}
          <p className="muted small">−2 = très favorable · 0 = neutre · +2 = très défavorable.</p>
        </div>
      )}
    </Card>
  )
}

function NoteCritere({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, flexShrink: 0 }}>
      {[-2, -1, 0, 1, 2].map((n) => (
        <button
          key={n}
          type="button"
          className={`btn btn-small ${n === value ? 'btn-primary' : ''}`}
          style={{ minWidth: 32, padding: '2px 5px' }}
          onClick={() => onChange(n)}
        >
          {n > 0 ? `+${n}` : n}
        </button>
      ))}
    </span>
  )
}

// ============================================================
// Carte Phases — tableau éditable en place
// ============================================================

function CartePhases({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const today = useToday()
  const moi = useMoi()
  const [edition, setEdition] = useState(false)
  const [colonnesDetaillees, setColonnesDetaillees] = useState(false)
  const detail = edition || colonnesDetaillees
  const baseline = p.baselineHeures || null
  const totalBaseline = heuresBaseline(p)

  const majPhase = (code: PhaseCode, fn: (ph: Phase) => void) =>
    update((d) => {
      const ph = d.projets.find((x) => x.id === p.id)?.phases.find((x) => x.code === code)
      if (ph) fn(ph)
    })

  const recalculer = async () => {
    const h = calculHonoraires(p, state.settings)
    if (
      !(await confirmer({
        message:
          `Recalculer la répartition des phases sur ${fmtMoney(h.honorairesBaseHT)} d’honoraires de base ?\n` +
          'Attention : montants, dates et heures prévues saisis sur les phases seront écrasés (DIAG et MC remis à zéro).\n' +
          (totalBaseline !== null
            ? `La prévision de référence (${fmtHeures(totalBaseline)}) n’est pas touchée : l’écart prévu / réel continue de se mesurer dessus.`
            : 'Aucune prévision de référence n’est figée sur ce projet : l’écart prévu / réel repartira de la nouvelle répartition.'),
        danger: true,
        confirmerLabel: 'Recalculer',
      }))
    )
      return
    // NE JAMAIS toucher `pr.baselineHeures` ici — c'est la garantie du
    // critère 15, et scripts/test-baseline-heures.cjs la vérifie.
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (pr) pr.phases = phasesParDefaut(h.honorairesBaseHT, tauxVente(d))
    })
    toast('Répartition des phases recalculée.', { tone: 'ok' })
  }

  /** fige (ou redéfinit) la prévision de référence — geste humain explicite */
  const figerBaseline = async () => {
    const total = heuresPrevues(p)
    if (total <= 0) {
      toast('Rien à figer : aucune heure prévue sur les phases.', { tone: 'danger' })
      return
    }
    const h = calculHonoraires(p, state.settings)
    if (
      !(await confirmer({
        message: baseline
          ? `Redéfinir la prévision de référence de ${p.id} ?\n` +
            `Actuelle : ${fmtHeures(totalBaseline)} (${LIBELLES_ORIGINE_BASELINE[baseline.origine]} le ${fmtDate(baseline.le)}).\n` +
            `Nouvelle : la répartition en place, ${fmtHeures(total)}.\n` +
            'L’écart prévu / réel déjà mesuré est remis à zéro sur cette nouvelle référence.'
          : `Figer la répartition en place (${fmtHeures(total)}) comme prévision de référence de ${p.id} ?\n` +
            '« Recalculer la répartition » ne la touchera plus : c’est elle qui portera l’écart prévu / réel.',
        danger: !!baseline,
        confirmerLabel: baseline ? 'Redéfinir' : 'Figer',
      }))
    )
      return
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (!pr) return
      pr.baselineHeures = baselineDepuisPhases(pr.phases, {
        le: today,
        par: moi.nom,
        origine: baseline ? 'revision' : 'signature',
        honorairesBaseHT: h.honorairesBaseHT,
      })
    })
    toast(
      baseline
        ? `Prévision de référence redéfinie à ${fmtHeures(total)}.`
        : `Prévision de référence figée à ${fmtHeures(total)} — l’écart se mesure désormais dessus.`,
      { tone: 'ok' },
    )
  }

  const encaissePhase = (code: PhaseCode) => encaisseHT(state, p.id, code)

  const totaux = p.phases.reduce(
    (t, ph) => {
      const fact = factureHT(state, p.id, ph.code)
      return {
        montant: t.montant + ph.montantHT,
        facture: t.facture + fact,
        reste: t.reste + (ph.montantHT - fact),
        hPrev: t.hPrev + ph.heuresPrevues,
        externe: t.externe + (ph.coutExterneHT || 0),
      }
    },
    { montant: 0, facture: 0, reste: 0, hPrev: 0, externe: 0 },
  )

  return (
    <Card
      titre="Phases de la mission"
      actions={
        edition ? (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <Btn small onClick={recalculer}>Recalculer la répartition</Btn>
            <Btn small onClick={figerBaseline}>{baseline ? 'Redéfinir la référence' : 'Figer la référence'}</Btn>
            <Btn small kind="primary" onClick={() => setEdition(false)}>Terminé</Btn>
          </span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
            <label className="small" style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={colonnesDetaillees} onChange={(e) => setColonnesDetaillees(e.target.checked)} />
              Colonnes détaillées
            </label>
            <Btn small onClick={() => setEdition(true)}>Modifier les phases</Btn>
          </span>
        )
      }
    >
      <NoteBaseline projet={p} />
      {p.phases.length === 0 ? (
        <EmptyState>Aucune phase — « Modifier les phases » puis « Recalculer la répartition » pour générer la mission de base.</EmptyState>
      ) : (
        <Table
          compact
          head={[
            'Phase',
            ...(detail ? ['% base'] : []),
            <span key="m" className="right">Montant HT</span>,
            'Début',
            'Fin',
            ...(detail ? [<span key="hp" className="right">H. prévues</span>] : []),
            ...(detail
              ? [
                  <span key="hb" className="right" title="prévision figée — un recalcul de la répartition ne la touche pas (CDC §11.3)">
                    H. référence
                  </span>,
                ]
              : []),
            ...(detail ? [<span key="ce" className="right" title="BET cotraitants, sous-traitance, débours — vient en moins de la marge">Coût ext. HT</span>] : []),
            <span key="f" className="right">% fact.</span>,
            ...(detail ? [<span key="pay" className="right">% payé</span>] : []),
            <span key="r" className="right">Reste HT</span>,
          ]}
        >
          {p.phases.map((ph) => {
            const fact = factureHT(state, p.id, ph.code)
            const reste = ph.montantHT - fact
            return (
              <tr key={ph.code}>
                <td>
                  <strong>{ph.code}</strong>
                  <div className="muted small">{LIBELLES_PHASES[ph.code]}</div>
                </td>
                {detail && <td className="muted small">{ph.pctBase !== null ? fmtPct(ph.pctBase, 1) : '—'}</td>}
                <td className="right">
                  {edition ? (
                    <NumInput value={ph.montantHT} onChange={(v) => majPhase(ph.code, (x) => { x.montantHT = v ?? 0 })} style={{ width: 96 }} />
                  ) : (
                    <Money v={ph.montantHT} />
                  )}
                </td>
                <td>
                  {edition ? (
                    <DateInput value={ph.debut} onChange={(v) => majPhase(ph.code, (x) => { x.debut = v })} style={{ width: 138 }} />
                  ) : (
                    <DateF d={ph.debut} />
                  )}
                </td>
                <td>
                  {edition ? (
                    <DateInput value={ph.fin} onChange={(v) => majPhase(ph.code, (x) => { x.fin = v })} style={{ width: 138 }} />
                  ) : (
                    <DateF d={ph.fin} />
                  )}
                </td>
                {detail && (
                  <td className="right">
                    {edition ? (
                      <NumInput value={ph.heuresPrevues} onChange={(v) => majPhase(ph.code, (x) => { x.heuresPrevues = v ?? 0 })} style={{ width: 64 }} />
                    ) : (
                      fmtHeures(ph.heuresPrevues)
                    )}
                    {ph.montantHT > 0 && coutJourObjectif(state) > 0 && (
                      <div className="muted small" title="jours objectif = budget de phase ÷ seuil de rentabilité par jour">
                        obj. {Math.round((ph.montantHT / coutJourObjectif(state)) * 10) / 10} j
                      </div>
                    )}
                  </td>
                )}
                {detail && <CelluleReference projet={p} phase={ph} />}
                {detail && (
                  <td className="right">
                    {edition ? (
                      <NumInput value={ph.coutExterneHT ?? null} onChange={(v) => majPhase(ph.code, (x) => { x.coutExterneHT = v ?? undefined })} style={{ width: 80 }} />
                    ) : ph.coutExterneHT ? (
                      <Money v={ph.coutExterneHT} />
                    ) : (
                      '—'
                    )}
                  </td>
                )}
                <td className="right num" title={fmtMoney(fact) + ' facturés'}>
                  {ph.montantHT > 0 ? fmtPct(fact / ph.montantHT, 0) : '—'}
                </td>
                {detail && (
                  <td className="right num">{ph.montantHT > 0 ? fmtPct(encaissePhase(ph.code) / ph.montantHT, 0) : '—'}</td>
                )}
                <td className={`right ${reste < 0 ? 'danger-text' : ''}`}><Money v={reste} /></td>
              </tr>
            )
          })}
          <tr>
            <td><strong>Total</strong></td>
            {detail && <td />}
            <td className="right"><strong><Money v={totaux.montant} /></strong></td>
            <td />
            <td />
            {detail && <td className="right"><strong>{fmtHeures(totaux.hPrev)}</strong></td>}
            {detail && (
              <td className="right">
                <strong>{totalBaseline !== null ? fmtHeures(totalBaseline) : '—'}</strong>
                {totalBaseline !== null && Math.abs(totaux.hPrev - totalBaseline) >= 0.1 && (
                  <div className="muted small">{ecartSigne(totaux.hPrev - totalBaseline)} vs réf.</div>
                )}
              </td>
            )}
            {detail && <td className="right"><strong><Money v={totaux.externe} /></strong></td>}
            <td className="right num"><strong>{totaux.montant > 0 ? fmtPct(totaux.facture / totaux.montant, 0) : '—'}</strong></td>
            {detail && <td />}
            <td className={`right ${totaux.reste < 0 ? 'danger-text' : ''}`}>
              <strong><Money v={totaux.reste} /></strong>
            </td>
          </tr>
        </Table>
      )}
      {/* R3 — la même fiche affichait DEUX fois le prévu / réel par phase,
          avec deux dénominateurs : ici la répartition courante, dans
          l'onglet Finance la prévision de référence. Après un recalcul, la
          même phase pouvait s'afficher à 105 % d'un côté et 80 % de
          l'autre. Une seule table désormais — celle qui mesure sur la
          référence du §11.3 ; ici, ce qui se saisit : la répartition. */}
      <p className="muted small" style={{ margin: '10px 2px 0' }}>
        Heures pointées et écart prévu / réel : <a href={`#/projets/${p.id}/finances`}>onglet Finance</a> — une
        seule table, mesurée sur la prévision de référence (§11.3). Ici se saisit la répartition prévue.
      </p>
    </Card>
  )
}

// ============================================================
// Modal d'édition (l'identité du projet — la création passe par
// l'assistant ProjetNouveau)
// ============================================================

function ModalEditionProjet({ projet, onClose }: { projet: Projet; onClose: () => void }) {
  const { state, update } = useStore()
  const moi = useMoi()

  const [nom, setNom] = useState(projet.nom)
  const [typeMO, setTypeMO] = useState<string>(projet.typeMO)
  const [statut, setStatut] = useState<string>(projet.statut)
  const [moa, setMoa] = useState(projet.moa || '')
  const [emailMOA, setEmailMOA] = useState(projet.emailMOA || '')
  const [adresse, setAdresse] = useState(projet.adresse || '')
  const [ouvrage, setOuvrage] = useState(projet.ouvrage || '')
  const [montant, setMontant] = useState<number | null>(projet.montantTravauxHT ?? null)
  const [surface, setSurface] = useState<number | null>(projet.surfacePlancher ?? null)
  const [surfaceExt, setSurfaceExt] = useState<number | null>(projet.surfaceExterieure ?? null)
  const [responsable, setResponsable] = useState(projet.responsable || '')
  const [coResponsable, setCoResponsable] = useState(projet.coResponsable || '')
  const [equipeProjet, setEquipeProjet] = useState<string[]>(projet.equipeProjet || [])
  const [plaisir, setPlaisir] = useState<number | null>(projet.plaisir ?? null)
  const [numEng, setNumEng] = useState(projet.numeroEngagement || '')
  const [notes, setNotes] = useState(projet.notes || '')
  const [dateLancement, setDateLancement] = useState<string | null>(projet.dateLancement ?? null)
  const [dateCloture, setDateCloture] = useState<string | null>(projet.dateCloture ?? null)
  const [objetFacture, setObjetFacture] = useState(projet.objetFacture || '')
  const [siretClient, setSiretClient] = useState(projet.siretClient || '')
  const [chargeOperation, setChargeOperation] = useState(projet.chargeOperation || '')
  const [accesCommande, setAccesCommande] = useState(projet.accesCommande || '')
  const [typologie, setTypologie] = useState(projet.typologie || '')
  const [typeConstruction, setTypeConstruction] = useState(projet.typeConstruction || '')
  const [trajetAller, setTrajetAller] = useState(projet.trajetAller || '')
  // ancrages externes — saisis à la main, jamais fabriqués par le Cockpit
  const [codeExterne, setCodeExterne] = useState(projet.codeExterne || '')
  const [adresseProjet, setAdresseProjet] = useState(projet.adresseProjet || '')
  const [driveFolderId, setDriveFolderId] = useState(projet.driveFolderId || '')
  const [calendarId, setCalendarId] = useState(projet.calendarId || '')
  const adresseDouteuse = !adresseProjetValide(adresseProjet)

  const enregistrer = () => {
    if (nom.trim() === '') return
    const livraison = statut === 'Livré' && projet.statut !== 'Livré'
    // le CDC §11.3 fige la prévision « à la signature » : c'est donc ce
    // passage de statut qui la pose, une fois, et seulement si le projet
    // n'a pas déjà de référence (`undefined` = jamais figée ; `null` =
    // volontairement sans référence, on n'y revient pas).
    const signature =
      statut === 'Signé' &&
      projet.statut !== 'Signé' &&
      projet.baselineHeures === undefined &&
      heuresPrevues(projet) > 0
    update((d) => {
      const pr = d.projets.find((x) => x.id === projet.id)
      if (!pr) return
      pr.nom = nom.trim()
      pr.typeMO = typeMO as TypeMO
      pr.statut = statut as StatutProjet
      pr.moa = moa.trim() || undefined
      pr.emailMOA = emailMOA.trim() || undefined
      pr.adresse = adresse.trim() || undefined
      pr.ouvrage = ouvrage || null
      pr.montantTravauxHT = montant
      pr.surfacePlancher = surface
      pr.surfaceExterieure = surfaceExt
      pr.responsable = responsable || undefined
      pr.coResponsable = coResponsable || undefined
      pr.equipeProjet = equipeProjet
      pr.plaisir = plaisir
      pr.numeroEngagement = numEng.trim() || undefined
      pr.notes = notes.trim() || undefined
      pr.dateLancement = dateLancement
      pr.dateCloture = dateCloture
      pr.objetFacture = objetFacture.trim() || undefined
      pr.siretClient = siretClient.trim() || undefined
      pr.chargeOperation = chargeOperation.trim() || undefined
      pr.accesCommande = accesCommande || undefined
      pr.typologie = typologie.trim() || undefined
      pr.typeConstruction = typeConstruction || undefined
      pr.trajetAller = trajetAller.trim() || undefined
      pr.codeExterne = codeExterne.trim() || undefined
      // une adresse ne se distingue pas par la casse (même règle que
      // normaliserEmail, src/moi.ts) : on range la forme comparable
      pr.adresseProjet = adresseProjet.trim().toLowerCase() || undefined
      pr.driveFolderId = driveFolderId.trim() || undefined
      pr.calendarId = calendarId.trim() || undefined

      // à la signature, la répartition en place devient la prévision de
      // référence : mesurée plus tard, elle aurait déjà dérivé
      if (signature) {
        pr.baselineHeures = baselineDepuisPhases(pr.phases, {
          le: todayISO(),
          par: moi.nom,
          origine: 'signature',
          honorairesBaseHT: calculHonoraires(pr, state.settings).honorairesBaseHT,
        })
      }

      // à la livraison, le projet devient automatiquement une référence
      if (livraison && !d.references.some((r) => fold(r.nom) === fold(pr.nom))) {
        const finAOR = pr.phases.find((ph) => ph.code === 'AOR')?.fin
        const tagsJournal = [...new Set(pr.journal.flatMap((n) => n.tags))]
          .filter((t) => !['a-faire', 'mail', 'photo'].includes(t))
          .slice(0, 4)
        d.references.push({
          id: uid('ref'),
          nom: pr.nom,
          lieu: pr.adresse,
          annee: Number((finAOR || todayISO()).slice(0, 4)),
          typeMO: pr.typeMO,
          moa: pr.moa,
          montantTravauxHT: pr.montantTravauxHT,
          surfaceM2: pr.surfacePlancher ?? null,
          mission: pr.missionsComplHT > 0 ? 'Base + missions compl.' : 'Base',
          motsCles: [...new Set([...(pr.ouvrage ? [fold(pr.ouvrage.replace(/^\d+-\s*/, '')).split(' ')[0]] : []), ...tagsJournal])],
          attestation: false,
          notes: `Référence créée automatiquement à la livraison de ${pr.id} — compléter surface et photos, réclamer l'attestation de bonne exécution.`,
        })
      }
    })
    if (livraison)
      toast(
        `${projet.id} livré : la référence « ${nom.trim()} » a été créée dans la base (surface et attestation à compléter).`,
        { tone: 'ok' },
      )
    if (signature)
      toast(
        `${projet.id} signé : la prévision de référence est figée à ${fmtHeures(heuresPrevues(projet))} — l’écart prévu / réel se mesurera dessus.`,
        { tone: 'ok' },
      )
    onClose()
  }

  const Section = ({ titre }: { titre: string }) => (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--ink-3)',
        borderBottom: '1px solid var(--line)',
        padding: '14px 0 4px',
        marginBottom: 8,
      }}
    >
      {titre}
    </div>
  )

  return (
    <Modal titre={`Modifier ${projet.id}`} onClose={onClose} large>
      <Section titre="Identité" />
      <div className="form-row">
        <Field label="Nom du projet">
          <TextInput value={nom} onChange={setNom} />
        </Field>
        <Field label="Statut">
          <Select value={statut} onChange={setStatut} options={STATUTS.map((s) => ({ value: s, label: s }))} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Lancement">
          <DateInput value={dateLancement} onChange={setDateLancement} />
        </Field>
        <Field label="Clôture (prévue ou réelle)">
          <DateInput value={dateCloture} onChange={setDateCloture} />
        </Field>
        <Field label="Adresse du projet">
          <TextInput value={adresse} onChange={setAdresse} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Objet pour les factures" hint="rappelé sur chaque facture (ex. « Création d'une pension de famille au 19 rue… »)">
          <TextInput value={objetFacture} onChange={setObjetFacture} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Type de maître d’ouvrage">
          <Select value={typeMO} onChange={setTypeMO} options={TYPES_MO.map((t) => ({ value: t, label: t }))} />
        </Field>
        <Field label="Maître d’ouvrage">
          <TextInput value={moa} onChange={setMoa} />
        </Field>
        <Field label="SIRET client">
          <TextInput value={siretClient} onChange={setSiretClient} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Chargé·e d’opération client" hint="votre interlocuteur chez le MOA">
          <TextInput value={chargeOperation} onChange={setChargeOperation} placeholder="ex. Thibaut Feuga" />
        </Field>
        <Field label="E-mail MOA (facturation)" hint="pré-remplit les e-mails sortants">
          <TextInput value={emailMOA} onChange={setEmailMOA} />
        </Field>
        <Field label="N° marché / engagement">
          <TextInput value={numEng} onChange={setNumEng} placeholder="ex. 220216" />
        </Field>
      </div>

      <Section titre="Interne agence" />
      <div className="form-row">
        <Field label="Responsable">
          <Select
            value={responsable}
            onChange={setResponsable}
            options={[{ value: '', label: '—' }, ...state.settings.personnes.map((x) => ({ value: x, label: x }))]}
          />
        </Field>
        <Field label="Co-responsable">
          <Select
            value={coResponsable}
            onChange={setCoResponsable}
            options={[{ value: '', label: '—' }, ...state.settings.personnes.map((x) => ({ value: x, label: x }))]}
          />
        </Field>
        <Field label="Plaisir (note /5)" hint="oui, ça compte">
          <Select
            value={plaisir === null ? '' : String(plaisir)}
            onChange={(v) => setPlaisir(v === '' ? null : Number(v))}
            options={[{ value: '', label: '—' }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: '★'.repeat(n) }))]}
          />
        </Field>
        <Field label="Travaillent sur le projet" hint="pré-remplit leur tableau de temps">
          <div style={{ display: 'flex', gap: 14, paddingTop: 7 }}>
            {state.settings.personnes.map((n) => (
              <label key={n} className="small" style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={equipeProjet.includes(n)}
                  onChange={(e) =>
                    setEquipeProjet(e.target.checked ? [...equipeProjet, n] : equipeProjet.filter((x) => x !== n))
                  }
                />
                {n}
              </label>
            ))}
          </div>
        </Field>
      </div>
      <div className="form-row">
        <Field label="Accès à la commande">
          <Select
            value={accesCommande}
            onChange={setAccesCommande}
            options={[
              { value: '', label: '—' },
              { value: 'AO', label: 'Appel d’offres' },
              { value: 'Concours', label: 'Concours' },
              { value: 'Gré à gré', label: 'Gré à gré' },
              { value: 'Bouche à oreille', label: 'Bouche à oreille' },
              { value: 'Client fidèle', label: 'Client fidèle' },
            ]}
          />
        </Field>
        <Field label="Typologie">
          <TextInput value={typologie} onChange={setTypologie} placeholder="Logement, enseignement…" />
        </Field>
        <Field label="Type de construction">
          <Select
            value={typeConstruction}
            onChange={setTypeConstruction}
            options={[
              { value: '', label: '—' },
              { value: 'Neuf', label: 'Neuf' },
              { value: 'Réhabilitation', label: 'Réhabilitation' },
              { value: 'Extension', label: 'Extension' },
              { value: 'Mixte', label: 'Mixte' },
            ]}
          />
        </Field>
        <Field label="Trajet aller" hint="repère logistique">
          <TextInput value={trajetAller} onChange={setTrajetAller} placeholder="ex. 1 h 10 — A16" />
        </Field>
      </div>

      <Section titre="Ancrages externes" />
      <p className="small muted" style={{ margin: '0 0 8px' }}>
        Ce que le projet porte HORS du Cockpit : le code qu'en connaît le client, son adresse
        dédiée, son dossier Drive, son agenda. Tout se saisit ici, rien n'est créé automatiquement —
        l'identifiant interne <strong>{projet.id}</strong> ne change jamais.
      </p>
      <div className="form-row">
        <Field label="Code projet (côté client)" hint="celui qui circule dans les échanges — ex. 2026-034">
          <TextInput value={codeExterne} onChange={setCodeExterne} placeholder="2026-034" />
        </Field>
        <Field
          label="Adresse dédiée du projet"
          hint={
            adresseDouteuse
              ? 'Format attendu : code@domaine — vérifiez la saisie.'
              : 'boîte à créer à la main, format [code-projet]@agence-ll.fr'
          }
        >
          <TextInput
            value={adresseProjet}
            onChange={setAdresseProjet}
            placeholder={adresseProjetProposee(codeExterne) || 'code-projet@agence-ll.fr'}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Dossier Drive (identifiant)" hint="renseigné à la main ; le rangement local suit son propre chemin">
          <TextInput value={driveFolderId} onChange={setDriveFolderId} />
        </Field>
        <Field label="Agenda du projet (identifiant)" hint="agenda secondaire créé à la main — le Cockpit ne lit que le calendrier">
          <TextInput value={calendarId} onChange={setCalendarId} />
        </Field>
      </div>

      <Section titre="Budget & surfaces" />
      <div className="form-row">
        <Field label="Type d’ouvrage (référentiel MIQCP)" hint="Détermine la plage du coefficient de complexité.">
          <Select
            value={ouvrage}
            onChange={setOuvrage}
            options={[
              { value: '', label: '— non renseigné —' },
              ...OUVRAGES.map((o) => ({ value: o.code, label: o.code })),
            ]}
          />
        </Field>
        <Field label="Montant de travaux HT (€)">
          <NumInput value={montant} onChange={setMontant} />
        </Field>
        <Field label="Surface plancher (m²)" hint="active les ratios €/m²">
          <NumInput value={surface} onChange={setSurface} />
        </Field>
        <Field label="Surface extérieure (m²)">
          <NumInput value={surfaceExt} onChange={setSurfaceExt} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Notes">
          <TextArea value={notes} onChange={setNotes} rows={3} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer} disabled={nom.trim() === ''}>
          Enregistrer
        </Btn>
      </div>
    </Modal>
  )
}
