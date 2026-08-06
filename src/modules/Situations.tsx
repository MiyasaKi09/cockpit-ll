// ============================================================
// Situations.tsx — « Secrétaire ++ »
// Circuit : situations@ → routine Claude quotidienne → import JSON
// ici → vérification humaine (délais contractuels suivis en dur)
// → visa. Claude propose, l'humain valide.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type { AppState, Situation, StatutSituation, TypeGarantie } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  BtnLien,
  Card,
  CopyBtn,
  DateF,
  DateInput,
  EmptyState,
  Field,
  Modal,
  Money,
  NumInput,
  Page,
  RowMenu,
  Select,
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
import { clamp, diffDays, fmtDate, fmtMois, fmtMoney, fmtPct, fold, monthKey, ouvrirGmail, uid } from '../util'
import {
  LIBELLE_GARANTIE,
  dateLimiteVerif,
  decompteSituation,
  garantieDuMarche,
  honorairesDETduMois,
  marcheDeSituation,
  nomProjet,
  retenueGarantieMarche,
} from '../derive'
import type { StatutRG } from '../derive'
import { SEUIL_ECART_AVANCEMENT_PTS, controleSituation } from '../controleSituation'
import type { ControleSituation } from '../controleSituation'
import {
  avanceRembourseeApresEmission,
  certificatDeSituation,
  construireCertificat,
  figerCertificat,
} from '../certificat'
// B1 — le décompte se FIGE au moment de la validation (src/decompte.ts), sur
// le patron du certificat : ce qui fait foi est l'état validé, pas l'état de
// la première impression
import { empreinteDecompte, figerDecompte } from '../decompte'
import type { SurchargesCertificat } from '../certificat'
import type { LignesCertificat } from '../types'
import { useMoi } from '../moi'
import { ouvrirCertificatPaiementPDF, ouvrirDecompteSituationPDF } from '../pdf'
import { assemble, contexteMarche } from '../prompts'
import {
  importerSituations,
  parseRetourRoutine,
  rapprocherMarche,
  situationExiste,
} from '../importRoutines'
import type { ResultatImport, RetourSituation } from '../importRoutines'
// 5.20 — le critère « situation du mois » et le texte de la relance vivent
// dans src/entreprise.ts : la fiche entreprise, le fil d'urgences et cet
// écran doivent dire (et écrire) la même chose
import {
  JOUR_ATTENTE_SITUATION,
  JOUR_RELANCE_SITUATION,
  corpsRelanceSituation,
  situationAttendueNonRecue,
  situationDuMois,
  sujetRelanceSituation,
} from '../entreprise'
import FicheEntreprise from './FicheEntreprise'

// ---------- petits helpers locaux ----------

function gabarit(state: AppState, id: string) {
  return state.prompts.find((t) => t.id === id)
}

function BadgeConfiance({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <Badge tone="muted">saisie manuelle</Badge>
  const tone = v >= 0.8 ? 'ok' : v >= 0.5 ? 'warn' : 'danger'
  return <Badge tone={tone}>{fmtPct(v, 0)}</Badge>
}

function BadgeStatutSituation({ statut }: { statut: StatutSituation }) {
  if (statut === 'validee') return <Badge tone="ok">validée</Badge>
  if (statut === 'rejetee') return <Badge tone="danger">rejetée</Badge>
  return <Badge tone="info">à vérifier</Badge>
}

function LienProjet({ state, projetId }: { state: AppState; projetId: string }) {
  if (!projetId) return <span className="muted">—</span>
  return (
    <a href={`#/projets/${projetId}`} title={nomProjet(state, projetId)}>
      {projetId}
    </a>
  )
}

/** pastille de cohérence du décompte (cumul, dépassement marché) */
function BadgeCoherence({ state, sit }: { state: AppState; sit: Situation }) {
  const dc = decompteSituation(state, sit)
  if (dc.coherences.length === 0) return null
  return (
    <span title={dc.coherences.join('\n')}>
      <Badge tone="danger">⚠ à vérifier</Badge>
    </span>
  )
}

/** montant net à payer HT d'une situation (colonne de tableau) */
function NetAPayer({ state, sit }: { state: AppState; sit: Situation }) {
  const dc = decompteSituation(state, sit)
  const titre =
    dc.tauxRG > 0
      ? `Cumul ${fmtMoney(dc.baseHT)} − RG ${fmtPct(dc.tauxRG, 0)} (${fmtMoney(dc.retenueGarantieHT)}) − déjà réglé ${fmtMoney(dc.precedentNetHT)}`
      : dc.garantie !== 'retenue'
        ? // la RAISON du 0 % se lit, sinon on croit à un marché mal rattaché (5.1)
          `RG 0 % — ${LIBELLE_GARANTIE[dc.garantie]} fournie par l'entreprise`
        : 'RG à 0 % (marché non rattaché ou sans retenue)'
  return (
    <span title={titre}>
      <Money v={dc.netAPayerHT} />
    </span>
  )
}

/** formate un nombre de points déjà arrondi au dixième (5.5) — virgule
 *  française, sans passer par fmtPct qui attend une fraction */
const pts = (v: number) => String(v).replace('.', ',')

/** l'écart d'avancement quand il dépasse le seuil nommé de 5.5, null sinon.
 *  UN SEUL prédicat pour les trois endroits qui le lisent : le badge de la
 *  ligne « à vérifier », le panneau qui s'ouvre au clic « Valider » et le
 *  bloc de contrôle lui-même — trois lectures du même seuil finiraient par
 *  ne plus dire la même chose. */
const ecartSignificatif = (ctl: ControleSituation): number | null =>
  ctl.ecartPts !== null && Math.abs(ctl.ecartPts) > SEUIL_ECART_AVANCEMENT_PTS ? ctl.ecartPts : null

/** T2 — le badge d'écart DANS LA LIGNE : on clique « Valider » depuis la
 *  liste, le contrôle 5.5 doit donc s'y voir. Rien n'est recalculé ici,
 *  controleSituation reste la seule autorité ; le badge SIGNALE, il ne
 *  qualifie pas — valider ou non reste le clic humain. */
function BadgeEcartControle({ state, sit }: { state: AppState; sit: Situation }) {
  const ctl = controleSituation(state, sit)
  const ecart = ecartSignificatif(ctl)
  if (ecart === null || ctl.pctDemande === null || ctl.pctChantier === null) return null
  return (
    <span
      title={`Contrôle 5.5 — l'entreprise demande ${pts(ctl.pctDemande)} %, le chantier dit ${pts(ctl.pctChantier)} % : « Valider » ouvrira le détail du contrôle.`}
    >
      <Badge tone="warn">écart {pts(Math.abs(ecart))} pts</Badge>
    </span>
  )
}

/** n° d'ordre PROPOSÉ pour une nouvelle situation d'un marché : le plus haut
 *  déjà reçu + 1 (1 si c'est la première). Une proposition, pas une règle —
 *  le champ reste ouvert, les entreprises numérotent comme elles veulent. */
function prochainNumeroSituation(state: AppState, marcheId: string): number {
  let max = 0
  for (const s of state.situations) {
    if (s.marcheId === marcheId && typeof s.numero === 'number' && s.numero > max) max = s.numero
  }
  return max + 1
}

/** 5.5 — le bloc « Contrôle » : la situation FACE AU réel du chantier et
 *  des indices. Des chiffres côte à côte, un badge quand l'écart
 *  d'avancement dépasse le seuil nommé — et jamais un verdict : valider ou
 *  non reste le clic humain, au-dessus. Quand un terme manque, le bloc DIT
 *  ce qui manque (`manques`) au lieu de se taire — un bloc muet ressemble
 *  à un bloc qui a vérifié. */
function BlocControle({ state, sit }: { state: AppState; sit: Situation }) {
  // pas de marché rattaché ⇒ pas de bloc : le contrôle est vide par
  // construction, et la fiche demande déjà le rattachement juste au-dessus
  if (!marcheDeSituation(state, sit)) return null
  const ctl = controleSituation(state, sit)
  const ecart = ecartSignificatif(ctl)
  return (
    <div style={{ marginTop: 8, padding: 12, background: 'var(--bg-soft, #f6f7fa)', borderRadius: 8 }}>
      <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>
        Contrôle — la situation face au réel
      </div>
      {ctl.pctDemande !== null && ctl.pctChantier !== null && (
        <div className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            l’entreprise demande <strong>{pts(ctl.pctDemande)} %</strong> · le chantier dit{' '}
            <strong>{pts(ctl.pctChantier)} %</strong>
          </span>
          {ecart !== null && <Badge tone="warn">écart {pts(Math.abs(ecart))} pts</Badge>}
        </div>
      )}
      {(ctl.revisionDemandee !== null || ctl.revisionTheorique !== null) && (
        <div className="small">
          révision demandée <strong>{fmtMoney(ctl.revisionDemandee)}</strong> · théorique{' '}
          <strong>{ctl.revisionTheorique ? fmtMoney(ctl.revisionTheorique.montant) : '—'}</strong>
          {ctl.revisionTheorique && (
            <span className="muted">
              {' '}
              (indice de {fmtMois(ctl.revisionTheorique.indiceUtilise.mois)}
              {ctl.revisionTheorique.approximatif ? ', approximatif' : ''})
            </span>
          )}
          {ctl.ecartRevision !== null && (
            <>
              {' '}
              · écart {ctl.ecartRevision > 0 ? '+' : ''}
              {fmtMoney(ctl.ecartRevision, true)}
            </>
          )}
        </div>
      )}
      {ctl.manques.length > 0 && (
        <div className="muted small" style={{ marginTop: 4 }}>
          {ctl.manques.map((m, i) => (
            <div key={i}>· {m}</div>
          ))}
        </div>
      )}
    </div>
  )
}

/** crée l'ÉCHÉANCE d'honoraires DET du mois depuis une situation validée —
 *  la facture (numéro légal, gel) naît ensuite dans le parcours d'émission */
async function facturerDET(
  state: AppState,
  update: (fn: (d: AppState) => void) => void,
  today: string,
  sit: Situation,
): Promise<void> {
  const montant = honorairesDETduMois(state, sit)
  if (montant <= 0) {
    toast(
      "Honoraires DET incalculables : renseignez le montant des travaux de l'opération (fiche projet) et une phase DET dotée d'honoraires.",
      { tone: 'danger' },
    )
    return
  }
  if (
    sit.factureId &&
    (state.factures.some((f) => f.id === sit.factureId) || state.echeancesFacturation.some((e) => e.id === sit.factureId))
  ) {
    if (!(await confirmer({ message: `Une facturation DET existe déjà pour cette situation. En créer une autre ?`, danger: true }))) return
  }
  // id calculé AVANT la mutation (producteur rejouable)
  const id = uid('ech')
  const p = state.projets.find((x) => x.id === sit.projetId)
  const delai = p ? state.settings.delaisPaiement[p.typeMO] : 30
  update((d) => {
    d.echeancesFacturation.push({
      id,
      projetId: sit.projetId,
      phase: 'DET',
      libelle: `DET — avancement ${sit.entreprise}${sit.lot ? ' · ' + sit.lot : ''} (${fmtMois(sit.mois)})`,
      montantHT: montant,
      tauxTVA: 0.2,
      datePrevue: today,
      delaiJours: delai,
      situationId: sit.id,
    })
    const x = d.situations.find((s) => s.id === sit.id)
    if (x) x.factureId = id
  })
  toast(
    `Échéance créée (${fmtMoney(montant, true)} HT — honoraires DET d'avancement) : à ajuster puis émettre dans Facturation.`,
    { tone: 'ok' },
  )
}

// ---------- import du retour de routine ----------

interface LigneApercu {
  item: RetourSituation
  marcheId: string | null
  projetId: string
  doublon: boolean
}

/** simule l'import (mêmes règles qu'importerSituations, y compris doublons intra-lot) */
function analyserItems(state: AppState, items: RetourSituation[]): LigneApercu[] {
  const ajoutsPrec: { mois: string; marcheId: string | null; entreprise: string }[] = []
  return items.map((item) => {
    const { marcheId, projetId } = rapprocherMarche(state, item)
    const doublonBase = situationExiste(state, item, marcheId)
    const doublonLot = ajoutsPrec.some(
      (a) =>
        a.mois === item.mois &&
        (marcheId ? a.marcheId === marcheId : fold(a.entreprise) === fold(item.entreprise)),
    )
    const doublon = doublonBase || doublonLot
    if (!doublon) ajoutsPrec.push({ mois: item.mois, marcheId, entreprise: item.entreprise })
    return { item, marcheId, projetId, doublon }
  })
}

function CarteImport() {
  const { state, update } = useStore()
  const [texte, setTexte] = useState('')
  const [apercu, setApercu] = useState<LigneApercu[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [resultat, setResultat] = useState<ResultatImport | null>(null)

  const analyser = () => {
    setResultat(null)
    setApercu(null)
    const { retour, erreur: err } = parseRetourRoutine(texte)
    if (err || !retour) {
      setErreur(err || 'Analyse impossible.')
      return
    }
    if (retour.type !== 'situations') {
      setErreur(
        `Ce retour contient des ${retour.type}, pas des situations — collez-le dans Routines → Import universel, qui le rangera au bon endroit.`,
      )
      return
    }
    if (retour.items.length === 0) {
      setErreur('Le JSON est valide mais ne contient aucune situation.')
      return
    }
    setErreur(null)
    setApercu(analyserItems(state, retour.items))
  }

  const importer = () => {
    if (!apercu) return
    const items = apercu.map((l) => l.item)
    const attendu: ResultatImport = {
      ajoutes: apercu.filter((l) => !l.doublon).length,
      doublons: apercu.filter((l) => l.doublon).length,
      nonRattaches: apercu.filter((l) => !l.doublon && !l.marcheId).length,
    }
    update((d) => {
      importerSituations(d, items)
    })
    setResultat(attendu)
    setApercu(null)
    setTexte('')
  }

  const nAImporter = apercu ? apercu.filter((l) => !l.doublon).length : 0

  return (
    <Card titre="Coller le retour de la routine">
      <p className="muted small">
        Routine « Lecture quotidienne de situations@ » : collez ici la réponse complète (le bloc
        JSON est détecté automatiquement). Tout arrive en statut « à vérifier » — rien n'est
        validé sans relecture humaine.
      </p>
      <TextArea
        value={texte}
        onChange={setTexte}
        rows={6}
        mono
        placeholder={'Collez ici le retour de la routine (texte + bloc ```json ... ```)'}
      />
      <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
        <Btn kind="primary" onClick={analyser} disabled={!texte.trim()}>
          Analyser
        </Btn>
        {apercu && (
          <>
            <Btn kind="primary" onClick={importer} disabled={nAImporter === 0}>
              Importer {nAImporter} situation{nAImporter > 1 ? 's' : ''}
            </Btn>
            <Btn
              kind="ghost"
              onClick={() => {
                setApercu(null)
                setErreur(null)
              }}
            >
              Annuler
            </Btn>
          </>
        )}
      </div>

      {erreur && <p className="danger-text small">{erreur}</p>}

      {apercu && (
        <>
          <p className="small" style={{ marginTop: 12 }}>
            {apercu.length} situation{apercu.length > 1 ? 's' : ''} détectée
            {apercu.length > 1 ? 's' : ''} —{' '}
            {apercu.filter((l) => l.marcheId).length} rattachée
            {apercu.filter((l) => l.marcheId).length > 1 ? 's' : ''} à un marché,{' '}
            {apercu.filter((l) => l.doublon).length} doublon
            {apercu.filter((l) => l.doublon).length > 1 ? 's' : ''}.
          </p>
          <Table
            compact
            head={['Entreprise', 'Lot', 'Mois', 'Mois HT', 'Cumul HT', 'Confiance', 'Rattachement', 'État']}
          >
            {apercu.map((l, i) => {
              const m = l.marcheId ? state.marches.find((x) => x.id === l.marcheId) : undefined
              return (
                <tr key={i} title={l.item.source}>
                  <td>{l.item.entreprise}</td>
                  <td>{l.item.lot || '—'}</td>
                  <td>{fmtMois(l.item.mois)}</td>
                  <td className="right">
                    <Money v={l.item.montantMoisHT} />
                  </td>
                  <td className="right">
                    <Money v={l.item.montantCumulHT} />
                  </td>
                  <td>
                    <BadgeConfiance v={l.item.confiance} />
                  </td>
                  <td>
                    {m ? (
                      `${m.projetId} · ${m.lot}`
                    ) : l.projetId ? (
                      <Badge tone="warn">projet {l.projetId}, sans marché</Badge>
                    ) : (
                      <Badge tone="warn">non rattachée</Badge>
                    )}
                  </td>
                  <td>
                    {l.doublon ? <Badge tone="muted">doublon — ignorée</Badge> : <Badge tone="ok">à importer</Badge>}
                  </td>
                </tr>
              )
            })}
          </Table>
        </>
      )}

      {resultat && (
        <p className="ok-text small" style={{ marginTop: 10 }}>
          Import terminé : {resultat.ajoutes} ajoutée{resultat.ajoutes > 1 ? 's' : ''},{' '}
          {resultat.doublons} doublon{resultat.doublons > 1 ? 's' : ''} ignoré
          {resultat.doublons > 1 ? 's' : ''}, {resultat.nonRattaches} non rattachée
          {resultat.nonRattaches > 1 ? 's' : ''} à un marché
          {resultat.nonRattaches > 0 ? ' (à corriger via « Éditer » ci-dessous)' : ''}.
        </p>
      )}
    </Card>
  )
}

// ---------- modal d'édition ----------

/** LA fiche d'une situation — en édition comme en création (S1). Une
 *  situation reçue par courrier papier ou remise en réunion n'avait aucun
 *  point d'entrée : seul le JSON de la routine en créait. Le même formulaire
 *  sert les deux gestes — décompte, contrôle 5.5 et cohérences compris —
 *  plutôt qu'un second écran de saisie qui divergerait. */
function ModalEdition({ sit, creation, onClose }: { sit: Situation; creation?: boolean; onClose: () => void }) {
  const { state, update, replace } = useStore()
  const today = useToday()
  const moi = useMoi()
  const [entreprise, setEntreprise] = useState(sit.entreprise)
  const [lot, setLot] = useState(sit.lot || '')
  const [mois, setMois] = useState(sit.mois)
  const [numero, setNumero] = useState<number | null>(sit.numero ?? null)
  const [montantMois, setMontantMois] = useState<number | null>(sit.montantMoisHT)
  const [cumul, setCumul] = useState<number | null>(sit.montantCumulHT ?? null)
  const [revision, setRevision] = useState<number | null>(sit.revisionHT ?? null)
  const [confiance, setConfiance] = useState<number | null>(sit.confiance ?? null)
  const [marcheId, setMarcheId] = useState(sit.marcheId || '')
  const [projetId, setProjetId] = useState(sit.projetId)
  const [dateReception, setDateReception] = useState<string | null>(sit.dateReception)
  const [statut, setStatut] = useState<StatutSituation>(sit.statut)
  const [source, setSource] = useState(sit.source || '')
  const [notes, setNotes] = useState(sit.notes || '')

  const marche = state.marches.find((m) => m.id === marcheId)

  /** S4 — la confiance est l'indice d'une LECTURE machine. Dès qu'un humain
   *  corrige un chiffre lu, cet indice ne veut plus rien dire : la situation
   *  redevient une « saisie manuelle ». Le champ ne se retape donc plus au
   *  clavier — il se lit, et il se remet tout seul. */
  const manuel = () => setConfiance(null)

  /** choisir le marché REMPLIT la fiche en création (entreprise, lot, projet,
   *  n° proposé) — c'est le sens de « pré-remplie depuis le marché ». En
   *  édition il ne touche qu'au projet : le rattachement se corrige souvent
   *  après coup, écraser le nom LU ferait perdre la trace de ce qui est
   *  arrivé. */
  const choisirMarche = (id: string) => {
    setMarcheId(id)
    const m = state.marches.find((x) => x.id === id)
    if (!m) return
    setProjetId(m.projetId)
    if (!creation) return
    setEntreprise(m.entreprise)
    setLot(m.lot)
    setNumero(prochainNumeroSituation(state, m.id))
  }

  const enregistrer = async () => {
    if (!entreprise.trim()) {
      toast('Le nom de l’entreprise est obligatoire.', { tone: 'danger' })
      return
    }
    if (!/^\d{4}-\d{2}$/.test(mois)) {
      toast('Mois attendu au format AAAA-MM (ex. 2026-07).', { tone: 'danger' })
      return
    }
    // la situation TELLE QU'ELLE SERA enregistrée — un seul objet pour la
    // création et l'édition : c'est lui que le décompte figé photographie,
    // avec les montants corrigés à l'instant, pas ceux d'avant la fiche
    const suivante: Situation = {
      ...sit,
      entreprise: entreprise.trim(),
      lot: lot.trim() || undefined,
      mois,
      numero,
      montantMoisHT: montantMois,
      montantCumulHT: cumul,
      revisionHT: revision,
      confiance: confiance === null ? null : clamp(confiance, 0, 1),
      marcheId: marcheId || null,
      projetId: marche ? marche.projetId : projetId,
      dateReception: dateReception || sit.dateReception,
      statut,
      source: source.trim() || undefined,
      notes: notes.trim() || undefined,
    }
    // B1 — le statut se change AUSSI depuis cette fiche : le décompte s'y fige
    // donc au moment où la situation PASSE à « validée », comme au bouton
    // « Valider » de la liste. Trois cas, et un seul fige :
    //  · elle devient validée → on fige, daté d'aujourd'hui, ce qui est vrai ;
    //  · elle quitte « validée » → on RETIRE le bloc : un décompte figé sur
    //    une situation redevenue « à vérifier » ne correspondrait plus à rien
    //    (même règle que l'« Annuler » du toast de validation) ;
    //  · elle reste validée → on ne touche à rien. Ni pour réécrire un bloc
    //    (le papier déjà remis à l'entreprise ne se refait pas parce qu'on
    //    corrige un cumul après coup), ni pour en inventer un daté
    //    d'aujourd'hui à une situation validée l'an dernier — celle-là reste
    //    sans bloc, et son impression le dit.
    const devientValidee = suivante.statut === 'validee' && sit.statut !== 'validee'
    if (devientValidee) {
      const fige = figerDecompte(state, suivante, { maintenant: today, par: moi.nom ?? null })
      fige.empreinte = await empreinteDecompte(fige)
      suivante.decompteFige = fige
    } else if (suivante.statut !== 'validee' && suivante.decompteFige) {
      delete suivante.decompteFige
    }

    if (creation) {
      const snap = state
      update((d) => {
        d.situations.push(suivante)
      })
      toast(`Situation saisie : ${suivante.entreprise} — ${fmtMois(suivante.mois)}.`, {
        undo: () => replace(snap),
      })
      onClose()
      return
    }
    update((d) => {
      const i = d.situations.findIndex((s) => s.id === sit.id)
      if (i >= 0) d.situations[i] = suivante
    })
    onClose()
  }

  const supprimer = async () => {
    const snap = state
    if (!(await confirmer({ message: `Supprimer la situation de ${sit.entreprise} (${fmtMois(sit.mois)}) ?`, danger: true, confirmerLabel: 'Supprimer' }))) return
    update((d) => {
      d.situations = d.situations.filter((s) => s.id !== sit.id)
    })
    toast('Situation supprimée.', { undo: () => replace(snap) })
    onClose()
  }

  return (
    <Modal titre={creation ? 'Saisir une situation' : 'Éditer la situation'} onClose={onClose} large>
      {creation && (
        <p className="muted small" style={{ marginTop: 0 }}>
          Situation reçue autrement que par situations@ (courrier, remise en réunion) :
          choisissez le marché, le reste se pré-remplit. Elle entrera « à vérifier », comme
          celles de la routine.
        </p>
      )}
      <div className="form-row">
        <Field label="Marché rattaché" hint="Le rattachement fixe le projet et le délai de vérification">
          <Select
            value={marcheId}
            onChange={choisirMarche}
            options={[
              { value: '', label: '— non rattachée —' },
              ...state.marches.map((m) => ({
                value: m.id,
                label: `${m.projetId} · ${m.lot} — ${m.entreprise}`,
              })),
            ]}
          />
        </Field>
        {!marche && (
          <Field label="Projet">
            <Select
              value={projetId}
              onChange={setProjetId}
              options={[
                { value: '', label: '— aucun —' },
                ...state.projets.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
              ]}
            />
          </Field>
        )}
      </div>
      {/* toute correction d'une valeur LUE repasse la situation en « saisie
          manuelle » : la confiance ci-dessous se remet toute seule */}
      <div className="form-row">
        <Field label="Entreprise">
          <TextInput
            value={entreprise}
            onChange={(v) => {
              setEntreprise(v)
              manuel()
            }}
          />
        </Field>
        <Field label="Lot">
          <TextInput
            value={lot}
            onChange={(v) => {
              setLot(v)
              manuel()
            }}
            placeholder="Lot 01 — Gros œuvre"
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Mois" hint="Format AAAA-MM">
          <TextInput
            value={mois}
            onChange={(v) => {
              setMois(v)
              manuel()
            }}
            placeholder="2026-07"
          />
        </Field>
        <Field label="N° de situation">
          <NumInput
            value={numero}
            onChange={(v) => {
              setNumero(v)
              manuel()
            }}
          />
        </Field>
        <Field label="Montant du mois HT">
          <NumInput
            value={montantMois}
            onChange={(v) => {
              setMontantMois(v)
              manuel()
            }}
          />
        </Field>
        <Field label="Cumul HT">
          <NumInput
            value={cumul}
            onChange={(v) => {
              setCumul(v)
              manuel()
            }}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Reçue le">
          <DateInput value={dateReception} onChange={setDateReception} />
        </Field>
        {/* S4 — plus de « 0 à 1 » à retaper au clavier : la confiance est une
            LECTURE, elle se lit. Elle repasse à « saisie manuelle » dès qu'une
            valeur lue est corrigée ci-dessus. */}
        <Field
          label="Confiance de la lecture"
          hint={
            confiance === null
              ? 'saisie ou corrigée à la main — aucune lecture machine à qualifier'
              : 'lecture de la routine ; toute correction ci-dessus la repasse en saisie manuelle'
          }
        >
          <div style={{ paddingTop: 6 }}>
            <BadgeConfiance v={confiance} />
          </div>
        </Field>
        <Field label="Statut">
          <Select
            value={statut}
            onChange={(v) => setStatut(v as StatutSituation)}
            options={[
              { value: 'a_verifier', label: 'À vérifier' },
              { value: 'validee', label: 'Validée' },
              { value: 'rejetee', label: 'Rejetée' },
            ]}
          />
        </Field>
      </div>

      {/* décompte « net à payer » et contrôle (5.5) recalculés en direct :
          le bloc lit les valeurs EN COURS d'édition, pas l'état enregistré —
          corriger un cumul doit faire bouger l'écart sous les yeux */}
      {(() => {
        const sitTemp: Situation = {
          ...sit,
          montantMoisHT: montantMois,
          montantCumulHT: cumul,
          revisionHT: revision,
          marcheId: marcheId || null,
          projetId: marche ? marche.projetId : projetId,
          entreprise: entreprise.trim() || sit.entreprise,
        }
        const dc = decompteSituation(state, sitTemp)
        return (
          <>
          <div style={{ marginTop: 4, padding: 12, background: 'var(--bg-soft, #f6f7fa)', borderRadius: 8 }}>
            <div className="form-row" style={{ alignItems: 'flex-start' }}>
              <Field
                label="Révision de prix HT"
                hint={marche ? (marche.revision ? 'marché révisable' : 'marché non révisable') : 'rattachez un marché pour la RG et le contrôle'}
              >
                <NumInput
                  value={revision}
                  onChange={(v) => {
                    setRevision(v)
                    manuel()
                  }}
                  placeholder="0"
                />
              </Field>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="small muted" style={{ marginBottom: 4 }}>
                  Décompte net à payer —{' '}
                  {dc.garantie !== 'retenue'
                    ? `RG 0 % — ${LIBELLE_GARANTIE[dc.garantie]}`
                    : `retenue de garantie ${fmtPct(dc.tauxRG, 0)}`}
                </div>
                <table className="table table-compact" style={{ margin: 0 }}>
                  <tbody>
                    <tr>
                      <td>Base HT (travaux + révision)</td>
                      <td className="right"><Money v={dc.baseHT} /></td>
                    </tr>
                    <tr>
                      <td>− Retenue de garantie</td>
                      <td className="right"><Money v={-dc.retenueGarantieHT} /></td>
                    </tr>
                    <tr>
                      <td>− Déjà réglé (situations préc.)</td>
                      <td className="right"><Money v={-dc.precedentNetHT} /></td>
                    </tr>
                    <tr>
                      <td><strong>Net à payer ce mois HT</strong></td>
                      <td className="right"><strong><Money v={dc.netAPayerHT} /></strong></td>
                    </tr>
                    <tr>
                      <td className="muted small">Net à payer TTC</td>
                      <td className="right muted small"><Money v={dc.netAPayerTTC} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            {dc.coherences.length > 0 && (
              <p className="danger-text small" style={{ marginTop: 8, marginBottom: 0 }}>
                {dc.coherences.map((c, i) => (
                  <span key={i}>⚠ {c}<br /></span>
                ))}
              </p>
            )}
          </div>
          <BlocControle state={state} sit={sitTemp} />
          </>
        )
      })()}

      <Field label="Source" hint="Traçabilité : mail d’origine, routine, date">
        <TextInput value={source} onChange={setSource} />
      </Field>
      <Field label="Notes">
        <TextArea value={notes} onChange={setNotes} rows={3} />
      </Field>
      <div className="form-foot">
        {!creation && (
          <Btn kind="danger" onClick={supprimer}>
            Supprimer
          </Btn>
        )}
        <span className="spacer" />
        <Btn kind="ghost" onClick={onClose}>
          Annuler
        </Btn>
        <Btn kind="primary" onClick={enregistrer}>
          {creation ? 'Enregistrer la situation' : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- tableau « à vérifier » ----------

/** T6 — l'ARRIVÉE des deux liens profonds de l'onglet « À vérifier ». Ils
 *  existaient tous les deux, écrits ailleurs, et tombaient tous les deux dans
 *  le vide : on atterrissait en haut de la liste NON FILTRÉE, à retrouver la
 *  ligne à l'œil parmi huit — le geste le plus fréquent du module.
 *   · `cibleId` — `#/situations/verifier/<id>`, écrit par l'alerte
 *     « situation à vérifier » (`alerts.ts`) : la ligne est mise en évidence
 *     et ramenée à l'écran. Rien ne s'ouvre à sa place : la vérification se
 *     lit dans le tableau (limite, écart de cumul, net à payer) AVANT de
 *     trancher, et « Valider » reste le geste humain.
 *   · `entrepriseInitiale` — `#/situations/verifier/chercher/<entreprise>`,
 *     écrit par la palette « / » : le filtre entreprise arrive pré-rempli,
 *     comme l'Historique le faisait déjà seul.
 *  Les deux formes ne peuvent pas se confondre : aucun identifiant ne vaut
 *  « chercher » (le découpage se fait dans `Situations()`, plus bas). */
function CarteAVerifier({
  cibleId = '',
  entrepriseInitiale = '',
}: {
  cibleId?: string
  entrepriseInitiale?: string
}) {
  const { state, update, replace } = useStore()
  const today = useToday()
  // B1 — qui valide : la personne reconnue, et `null` quand le poste ne sait
  // pas qui est là. Le décompte figé porte alors « auteur non identifié »
  // plutôt que le nom du premier de la liste (§identité)
  const moi = useMoi()
  const [editionId, setEditionId] = useState<string | null>(null)
  const [rejetId, setRejetId] = useState<string | null>(null)
  const [motifRejet, setMotifRejet] = useState('')
  /** situation dont « Valider » a ouvert le contrôle 5.5 (écart au-delà du seuil) */
  const [controleId, setControleId] = useState<string | null>(null)
  /** dernière situation validée : le geste suivant (le certificat) se propose ici */
  const [suiteId, setSuiteId] = useState<string | null>(null)
  const [certifId, setCertifId] = useState<string | null>(null)
  /** situation en cours de SAISIE manuelle (courrier papier, remise en réunion) */
  const [creation, setCreation] = useState<Situation | null>(null)

  const tplVerif = gabarit(state, 'tpl-verif-situation')
  const aVerifierToutes = state.situations
    .filter((s) => s.statut === 'a_verifier')
    .sort((a, b) => dateLimiteVerif(state, a).localeCompare(dateLimiteVerif(state, b)))
  const entreprisesConnues = [...new Set(aVerifierToutes.map((s) => s.entreprise))].sort((a, b) =>
    a.localeCompare(b),
  )
  // le filtre porté par la route ne s'applique que s'il désigne une entreprise
  // réellement en attente ICI : sinon la carte s'ouvrirait vide sans dire
  // pourquoi, ce qui est pire que de ne pas pré-remplir (même règle que
  // l'Historique). Le parent remonte la carte quand la route change (`key`).
  const [filtreEntreprise, setFiltreEntreprise] = useState(
    entreprisesConnues.includes(entrepriseInitiale) ? entrepriseInitiale : '',
  )
  const aVerifier = filtreEntreprise
    ? aVerifierToutes.filter((s) => s.entreprise === filtreEntreprise)
    : aVerifierToutes

  // la situation désignée par le lien : trouvée ici (mise en évidence), ou
  // ailleurs dans la base (déjà vérifiée → l'Historique le dit), ou nulle part
  const cible = cibleId ? aVerifierToutes.find((s) => s.id === cibleId) : undefined
  const cibleAilleurs = cibleId && !cible ? state.situations.find((s) => s.id === cibleId) : undefined
  const refCible = useRef<HTMLTableRowElement | null>(null)
  useEffect(() => {
    // la ligne peut être au bas d'un troisième projet : on la ramène à l'écran
    refCible.current?.scrollIntoView({ block: 'center' })
  }, [cibleId])

  const saisirSituation = () =>
    setCreation({
      // id calculé AVANT la mutation (producteur rejouable)
      id: uid('sit'),
      projetId: '',
      marcheId: null,
      entreprise: '',
      mois: monthKey(today),
      numero: null,
      montantMoisHT: null,
      montantCumulHT: null,
      statut: 'a_verifier',
      confiance: null,
      source: `saisie manuelle du ${fmtDate(today)}`,
      dateReception: today,
    })

  /** B1 — la validation FIGE le décompte, dans la MÊME écriture que le
   *  changement de statut. Deux conséquences voulues :
   *   · le papier remis à l'entreprise se réimprimera à l'identique, même
   *     après un avenant saisi la semaine suivante ;
   *   · l'« Annuler » du toast (`replace(snap)`) retire le bloc EN MÊME TEMPS
   *     que le statut — une situation redevenue « à vérifier » qui garderait
   *     son décompte figé ne correspondrait plus à rien.
   *  L'empreinte se calcule AVANT l'écriture, pour que le bloc parte complet
   *  et qu'une seule annulation suffise. */
  const validerVraiment = async (id: string) => {
    const s = state.situations.find((x) => x.id === id)
    if (!s) return
    const snap = state
    const fige = figerDecompte(state, s, { maintenant: today, par: moi.nom ?? null })
    fige.empreinte = await empreinteDecompte(fige)
    update((d) => {
      const x = d.situations.find((y) => y.id === id)
      if (!x) return
      x.statut = 'validee'
      x.decompteFige = fige
    })
    setControleId(null)
    setSuiteId(id)
    toast('Situation validée — décompte figé à cette date.', {
      undo: () => {
        setSuiteId(null)
        replace(snap)
      },
    })
  }

  /** T2 — le contrôle 5.5 au POINT DE DÉCISION. On clique « Valider » depuis
   *  la liste : quand l'écart d'avancement dépasse le seuil, le contrôle
   *  s'ouvre AVANT la validation au lieu de rester dans la modale « Éditer »
   *  que personne n'ouvre. Il ne bloque rien — il montre, l'humain tranche. */
  const valider = (id: string) => {
    const s = state.situations.find((x) => x.id === id)
    if (s && ecartSignificatif(controleSituation(state, s)) !== null) {
      setControleId(id)
      return
    }
    void validerVraiment(id)
  }

  const confirmerRejet = () => {
    if (!rejetId) return
    const snap = state
    const motif = motifRejet
    update((d) => {
      const x = d.situations.find((s) => s.id === rejetId)
      if (!x) return
      x.statut = 'rejetee'
      const ligne = `Rejetée le ${today} : ${motif.trim() || 'sans motif'}`
      x.notes = x.notes ? `${x.notes}\n${ligne}` : ligne
    })
    setRejetId(null)
    setMotifRejet('')
    toast('Situation rejetée.', { undo: () => replace(snap) })
  }

  const enEdition = editionId ? state.situations.find((s) => s.id === editionId) : undefined
  const enRejet = rejetId ? state.situations.find((s) => s.id === rejetId) : undefined
  const enControle = controleId ? state.situations.find((s) => s.id === controleId) : undefined
  // la suite ne se propose que tant que la validation TIENT : « Annuler »
  // dans le toast la fait disparaître d'elle-même
  const suite = suiteId ? state.situations.find((s) => s.id === suiteId) : undefined
  const suiteAProposer =
    suite && suite.statut === 'validee' && marcheDeSituation(state, suite) && !certificatDeSituation(state, suite.id)
      ? suite
      : undefined

  // regroupement par projet : on vérifie chantier par chantier, pas en vrac
  const projetIds = [...new Set(aVerifier.map((s) => s.projetId))]

  return (
    <Card
      titre={`À vérifier (${aVerifierToutes.length})`}
      actions={
        <Btn
          small
          onClick={saisirSituation}
          title="Une situation reçue par courrier ou remise en réunion se saisit ici — même fiche, même contrôle que celles de la routine"
        >
          Saisir une situation
        </Btn>
      }
    >
      {/* T2 — après « Valider », le geste suivant est toujours le certificat :
          il se propose ici, au lieu de se retrouver dans l'onglet Historique */}
      {suiteAProposer && (
        <div
          className="pill-note"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <span>
            <strong>{suiteAProposer.entreprise}</strong> validée ({fmtMois(suiteAProposer.mois)}) — le
            geste suivant est le certificat de paiement vers le maître d’ouvrage.
          </span>
          <Btn small kind="primary" onClick={() => setCertifId(suiteAProposer.id)}>
            Émettre le certificat
          </Btn>
          <Btn small kind="ghost" onClick={() => setSuiteId(null)} title="Il restera dans l’onglet Historique">
            Plus tard
          </Btn>
        </div>
      )}
      {/* T6 — le lien d'alerte a désigné UNE situation : on dit laquelle, et
          « Retirer la mise en évidence » rend la liste entière (chaque geste
          laisse un retour en arrière) */}
      {cible && (
        <div className="pill-note" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            Lien direct — <strong>{cible.entreprise}</strong> ({fmtMois(cible.mois)}) est mise en
            évidence ci-dessous ; à vérifier avant le {fmtDate(dateLimiteVerif(state, cible))}.
          </span>
          <Btn
            small
            kind="ghost"
            onClick={() => navigate('/situations/verifier')}
            title="Retirer la mise en évidence et revenir à la liste complète"
          >
            Retirer la mise en évidence
          </Btn>
        </div>
      )}
      {cibleId && !cible && (
        <div className="pill-note" style={{ borderColor: 'var(--warn)' }}>
          {cibleAilleurs ? (
            <>
              La situation <strong>{cibleAilleurs.entreprise}</strong> ({fmtMois(cibleAilleurs.mois)}) n’est
              plus à vérifier : <BadgeStatutSituation statut={cibleAilleurs.statut} />{' '}
              <a
                href={`#/situations/historique/chercher/${encodeURIComponent(cibleAilleurs.entreprise)}`}
              >
                la voir dans l’Historique
              </a>
              .
            </>
          ) : (
            <>
              La situation demandée par ce lien est introuvable (supprimée, ou base d’un autre poste).
              Les situations en attente restent listées ci-dessous.
            </>
          )}
        </div>
      )}
      {/* filtre entreprise — pré-rempli par `#/situations/verifier/chercher/<entreprise>`
          (palette « / »), et utilisable à la main quand plusieurs entreprises attendent */}
      {(entreprisesConnues.length > 1 || filtreEntreprise) && (
        <div className="toolbar" style={{ marginTop: 0 }}>
          <Select
            value={filtreEntreprise}
            onChange={setFiltreEntreprise}
            options={[
              { value: '', label: 'Toutes les entreprises' },
              ...entreprisesConnues.map((e) => ({ value: e, label: e })),
            ]}
          />
          <span className="muted small">
            {aVerifier.length} situation{aVerifier.length > 1 ? 's' : ''}
            {filtreEntreprise ? ` sur ${aVerifierToutes.length}` : ''}
          </span>
          {filtreEntreprise && (
            <Btn small kind="ghost" onClick={() => setFiltreEntreprise('')}>
              Retirer le filtre
            </Btn>
          )}
        </div>
      )}
      {aVerifierToutes.length === 0 ? (
        <EmptyState>
          Aucune situation en attente de vérification — « Saisir une situation » pour celle qui
          arrive autrement que par situations@.
        </EmptyState>
      ) : aVerifier.length === 0 ? (
        <EmptyState>
          Aucune situation à vérifier pour cette entreprise — « Retirer le filtre » les remet toutes.
        </EmptyState>
      ) : (
        projetIds.map((pid) => {
          const duProjet = aVerifier.filter((s) => s.projetId === pid)
          const totalMois = duProjet.reduce((t, s) => t + (s.montantMoisHT || 0), 0)
          return (
            <div key={pid} style={{ marginBottom: 14 }}>
              <div
                className="small"
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', margin: '0 0 6px', fontWeight: 700 }}
              >
                <LienProjet state={state} projetId={pid} />
                <span className="muted" style={{ fontWeight: 500 }}>
                  {duProjet.length} situation{duProjet.length > 1 ? 's' : ''} · {fmtMoney(totalMois)} HT ce mois
                </span>
              </div>
              <Table
                compact
                head={['Entreprise / lot', 'Mois', 'Mois HT', 'Cumul HT', 'Net à payer', 'Confiance', 'Vérifier avant', 'Actions']}
              >
                {duProjet.map((s) => {
                  const marche = s.marcheId ? state.marches.find((m) => m.id === s.marcheId) : undefined
                  const limite = dateLimiteVerif(state, s)
                  const jours = diffDays(today, limite)
                  // la ligne désignée par le lien : trait d'accent + aplat doux.
                  // `outline` plutôt que `border` — il ne déplace rien, ni en
                  // tableau ni dans le repli en cartes sous 700 px
                  const visee = s.id === cibleId
                  return (
                    <tr
                      key={s.id}
                      ref={visee ? refCible : undefined}
                      style={
                        visee
                          ? {
                              outline: '2px solid var(--accent)',
                              outlineOffset: '-2px',
                              background: 'var(--accent-soft)',
                            }
                          : undefined
                      }
                    >
                      <td>
                        <strong>{s.entreprise}</strong>
                        {visee && (
                          <span className="muted small" style={{ marginLeft: 6 }}>
                            (situation du lien)
                          </span>
                        )}
                        <div className="muted small">
                          {s.lot || '—'}
                          {s.source ? ` · ${s.source}` : ''}
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {fmtMois(s.mois)}
                        {s.numero != null && <span className="muted small"> n°{s.numero}</span>}
                        <div className="muted small">reçue le {fmtDate(s.dateReception)}</div>
                      </td>
                      <td className="right">
                        <Money v={s.montantMoisHT} />
                      </td>
                      <td className="right">
                        <Money v={s.montantCumulHT} /> <BadgeEcartControle state={state} sit={s} />
                      </td>
                      <td className="right">
                        <NetAPayer state={state} sit={s} /> <BadgeCoherence state={state} sit={s} />
                      </td>
                      <td>
                        <BadgeConfiance v={s.confiance} />
                      </td>
                      <td>
                        <DateF d={limite} />{' '}
                        {jours < 0 ? (
                          <Badge tone="danger">dépassée de {-jours} j</Badge>
                        ) : jours <= 3 ? (
                          <Badge tone="danger">{jours === 0 ? 'aujourd’hui' : `J−${jours}`}</Badge>
                        ) : null}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {marche && tplVerif ? (
                            <CopyBtn
                              small
                              kind="default"
                              label="Vérifier avec Claude"
                              text={() => assemble(tplVerif.corps, contexteMarche(state, marche, s))}
                            />
                          ) : (
                            <Btn
                              small
                              disabled
                              title={
                                !marche
                                  ? 'Rattachez d’abord la situation à un marché (bouton « Éditer »).'
                                  : 'Gabarit « tpl-verif-situation » introuvable dans la bibliothèque de prompts.'
                              }
                            >
                              Vérifier avec Claude
                            </Btn>
                          )}
                          <Btn small kind="primary" onClick={() => valider(s.id)}>
                            Valider
                          </Btn>
                          <RowMenu
                            items={[
                              {
                                label: 'Décompte (PDF)',
                                // S6 — la date d'ÉDITION est celle du jour, pas celle de
                                // réception de la situation : le document le dit désormais
                                onClick: () => ouvrirDecompteSituationPDF(state, s, today),
                                // S6 — ce document est le DÉCOMPTE DE VÉRIFICATION remis à
                                // l'entreprise ; le certificat de paiement est un autre
                                // document, contractuel, adressé au maître d'ouvrage
                                title:
                                  'Décompte de vérification (interne, remis à l’entreprise) — net à payer. Tant que la situation n’est pas validée, il se recalcule à chaque impression et le dit ; c’est la validation qui le fige.',
                              },
                              { label: 'Éditer', onClick: () => setEditionId(s.id) },
                              { label: 'Rejeter…', onClick: () => { setRejetId(s.id); setMotifRejet('') }, danger: true },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </Table>
            </div>
          )
        })
      )}
      {tplVerif && aVerifier.length > 0 && (
        <p className="muted small">
          « Vérifier avec Claude » copie le prompt assemblé — à coller dans le Projet Claude
          « {tplVerif.projetClaude} », avec la situation en pièce jointe. Le visa reste humain.
        </p>
      )}
      {enEdition && <ModalEdition sit={enEdition} onClose={() => setEditionId(null)} />}
      {creation && <ModalEdition sit={creation} creation onClose={() => setCreation(null)} />}
      {enControle && (
        <Modal
          titre={`Contrôle avant validation — ${enControle.entreprise} (${fmtMois(enControle.mois)})`}
          onClose={() => setControleId(null)}
          large
        >
          <p className="muted small" style={{ marginTop: 0 }}>
            Le contrôle a trouvé un écart d’avancement de plus de {SEUIL_ECART_AVANCEMENT_PTS} points.
            Il ne dit pas qui a raison : le planning travaux peut être en retard de saisie, la
            demande peut devancer le chantier. Vous décidez.
          </p>
          <BlocControle state={state} sit={enControle} />
          <div className="form-foot">
            <Btn kind="ghost" onClick={() => setControleId(null)}>
              Annuler
            </Btn>
            <span className="spacer" />
            <Btn
              onClick={() => {
                setEditionId(enControle.id)
                setControleId(null)
              }}
            >
              Éditer la situation
            </Btn>
            <Btn kind="primary" onClick={() => void validerVraiment(enControle.id)}>
              Valider quand même
            </Btn>
          </div>
        </Modal>
      )}
      {(() => {
        const sit = certifId ? state.situations.find((s) => s.id === certifId) : undefined
        return sit ? <ModalCertificat sit={sit} onClose={() => setCertifId(null)} /> : null
      })()}
      {enRejet && (
        <Modal titre={`Rejeter la situation — ${enRejet.entreprise} (${fmtMois(enRejet.mois)})`} onClose={() => setRejetId(null)}>
          <Field label="Motif du rejet" hint="tracé dans les notes de la situation">
            <TextArea
              value={motifRejet}
              onChange={setMotifRejet}
              rows={3}
              placeholder="Ex. écart de cumul, pièce manquante, montant à corriger…"
            />
          </Field>
          <div className="form-foot">
            <Btn onClick={() => setRejetId(null)}>Annuler</Btn>
            <Btn kind="danger" onClick={confirmerRejet}>
              Rejeter la situation
            </Btn>
          </div>
        </Modal>
      )}
    </Card>
  )
}

// ---------- certificat de paiement (5.19) ----------

/** libellés des lignes du certificat, dans l'ordre du document réel —
 *  `null` en libellé = séparateur de rubrique */
const LIGNES_CERTIFICAT: (readonly [keyof LignesCertificat | null, string, { fort?: boolean }?])[] = [
  [null, 'Le marché'],
  ['baseHT', 'Montant du marché (base) HT'],
  ['avenantsHT', 'Avenants HT'],
  ['totalMarcheHT', 'Total marché HT', { fort: true }],
  [null, 'Avance forfaitaire (CCAG art. 13)'],
  ['avanceInitialeHT', 'Avance forfaitaire initiale HT'],
  ['avanceRembourseeAnterieureHT', 'Avance déjà remboursée HT (états antérieurs)'],
  ['avanceVerseePresentHT', 'Avance versée au présent état HT'],
  ['resorptionHT', 'Résorption du présent état HT (à déduire)'],
  ['avanceResteHT', 'Reste à rembourser HT', { fort: true }],
  [null, 'A — Acompte en prix de base'],
  ['cumulHT', 'Travaux exécutés cumulés HT (décompte)'],
  ['anterieurHT', 'À déduire : décompte antérieur HT'],
  ['acompteHT', 'Acompte en prix de base HT (cumulé − antérieur)', { fort: true }],
  [null, 'B — Révision de prix'],
  ['revisionHT', 'Révision du présent état HT'],
  ['revisionAnterieureHT', 'Révisions antérieures HT'],
  ['revisionOrigineHT', 'Révision depuis l’origine HT', { fort: true }],
  [null, 'C — TVA'],
  ['tauxTVA', 'Taux de TVA (fraction : 0,2 = 20 %)'],
  ['tvaAvanceHT', 'TVA sur avance (présent état)'],
  ['tvaAcompteHT', 'TVA sur acompte (présent état)'],
  ['tvaRevisionHT', 'TVA sur révision (présent état)'],
  ['totalTTC', 'Total acompte TTC — présent état', { fort: true }],
  ['acompteTTCCumul', 'Acomptes TTC cumulés depuis l’origine'],
  [null, 'D & E — À déduire'],
  ['penalitesHT', 'Pénalités appliquées (5.2)'],
  ['retenueGarantieTTC', 'Retenue de garantie TTC'],
  [null, 'Le net'],
  ['netAPayerTTC', 'NET À PAYER TTC — présent état', { fort: true }],
  ['resteHT', 'Reste à exécuter HT'],
]

/** modale d'émission : chaque ligne calculée est une PROPOSITION corrigeable
 *  (le document réel le prouve — la RG de l'état n° 4 sort d'une lecture
 *  contractuelle qu'aucune règle ne produit) ; « Émettre » FIGE et ouvre le
 *  PDF. Un certificat émis se rouvre en LECTURE, il ne se recalcule pas. */
function ModalCertificat({ sit, onClose }: { sit: Situation; onClose: () => void }) {
  const { state, update } = useStore()
  const today = useToday()
  const moi = useMoi()
  // qui émet : même règle que le visa et la pénalité — la personne reconnue,
  // à défaut la première de la liste (pas de signature vide)
  const signataire = moi.nom ?? state.settings.personnes[0]
  const [surcharges, setSurcharges] = useState<SurchargesCertificat>({})
  const [numero, setNumero] = useState<number | null>(null)

  const construit = construireCertificat(state, sit.id, numero === null ? surcharges : { ...surcharges, numero })
  if (!construit) {
    return (
      <Modal titre="Certificat de paiement" onClose={onClose}>
        <p>Rattachez d'abord la situation à un marché (bouton « Éditer ») : sans marché, ni montant de base, ni avance, ni garantie — rien à certifier.</p>
      </Modal>
    )
  }

  const corriger = (cle: keyof LignesCertificat) => (v: number | null) =>
    setSurcharges((prev) => {
      const suiv = { ...prev }
      if (v === null) delete suiv[cle]
      else suiv[cle] = v
      return suiv
    })

  const emettre = () => {
    if (certificatDeSituation(state, sit.id)) {
      toast('Un certificat est déjà émis pour cette situation — rouvrez-le en réimpression.', { tone: 'danger' })
      return
    }
    // id calculé AVANT la mutation (producteur rejouable)
    const id = uid('cert')
    const cert = figerCertificat(construit, { id, emisLe: today, emisPar: signataire })
    update((d) => {
      d.certificats.push(cert)
      // la résorption émise avance le compteur du marché : l'état suivant
      // proposera la suite, pas la même résorption
      const m = d.marches.find((x) => x.id === cert.marcheId)
      if (m && cert.lignes.resorptionHT > 0) m.avanceRembourseeHT = avanceRembourseeApresEmission(m, cert)
    })
    ouvrirCertificatPaiementPDF(cert)
    toast(`Certificat n° ${cert.numero} émis et figé (${fmtMoney(cert.netAPayerTTC, true)} TTC) — il se rouvrira en réimpression, jamais en recalcul.`, { tone: 'ok' })
    onClose()
  }

  return (
    <Modal titre={`Certificat de paiement — ${sit.entreprise} (${fmtMois(sit.mois)})`} onClose={onClose} large>
      <p className="muted small" style={{ marginTop: 0 }}>
        Chaque ligne est une <strong>proposition</strong> : corrigez ce que le contrat dit autrement
        (l'état n° 4 de la MAM de Chamant retenait 5 % de RG sur le seul avenant, GPD sur la base —
        aucune règle générale ne produit ça). Le PDF imprime la valeur retenue.
      </p>
      <div className="form-row">
        <Field label="N° du certificat" hint={`proposé : ${construit.numeroPropose} (max des états émis du marché + 1)`}>
          <NumInput value={numero ?? construit.numeroPropose} onChange={setNumero} />
        </Field>
      </div>
      <Table compact head={['Rubrique', 'Proposé', 'Correction', 'Retenu']}>
        {LIGNES_CERTIFICAT.map(([cle, libelle, opts], i) =>
          cle === null ? (
            <tr key={i}>
              <td colSpan={4} style={{ fontWeight: 700, background: 'var(--bg-soft, #f6f7fa)' }}>{libelle}</td>
            </tr>
          ) : (
            <tr key={i} style={opts?.fort ? { fontWeight: 700 } : undefined}>
              <td>{libelle}</td>
              <td className="right">
                {cle === 'tauxTVA' ? fmtPct(construit.proposition[cle]) : <Money v={construit.proposition[cle]} cents />}
              </td>
              <td style={{ width: 120 }}>
                <NumInput
                  value={surcharges[cle] ?? null}
                  onChange={corriger(cle)}
                  placeholder="—"
                  ariaLabel={`Correction — ${libelle}`}
                />
              </td>
              <td className="right">
                {cle === 'tauxTVA' ? fmtPct(construit.lignes[cle]) : <Money v={construit.lignes[cle]} cents />}
              </td>
            </tr>
          ),
        )}
      </Table>
      {construit.mentions.length > 0 && (
        <div className="muted small" style={{ marginTop: 8 }}>
          {construit.mentions.map((m, i) => (
            <div key={i}>· {m}</div>
          ))}
        </div>
      )}
      <div className="form-foot">
        <Btn kind="ghost" onClick={onClose}>
          Annuler
        </Btn>
        <span className="spacer" />
        <Btn kind="primary" onClick={emettre}>
          Émettre le certificat n° {construit.numero} et ouvrir le PDF
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- historique ----------

/** T5 — les 6 lignes par chantier restent le DÉFAUT d'affichage (l'historique
 *  se lit chantier par chantier), jamais une limite d'accès : sur 8 lots, le
 *  bouton « Certificat de paiement » du 7e lot devenait inatteignable. */
const PLAFOND_HISTORIQUE = 6

function CarteHistorique({ entrepriseInitiale = '' }: { entrepriseInitiale?: string }) {
  const { state, update } = useStore()
  const today = useToday()
  // situation dont on prépare le certificat de paiement (5.19)
  // le filtre porté par la route ne s'applique que s'il désigne une entreprise
  // réellement présente dans l'historique : sinon la carte s'ouvrirait vide
  // sans dire pourquoi, ce qui est pire que de ne pas pré-remplir.
  const connuIci = state.situations.some(
    (s) => s.statut !== 'a_verifier' && s.entreprise === entrepriseInitiale,
  )
  const [certifId, setCertifId] = useState<string | null>(null)
  const [filtreMois, setFiltreMois] = useState('')
  const [filtreEntreprise, setFiltreEntreprise] = useState(connuIci ? entrepriseInitiale : '')
  /** projets dont on a demandé l'historique complet (par leur id) */
  const [deplies, setDeplies] = useState<string[]>([])
  const deplier = (pid: string) =>
    setDeplies((prev) => (prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]))

  const toutes = state.situations
    .filter((s) => s.statut !== 'a_verifier')
    .sort((a, b) => b.mois.localeCompare(a.mois) || b.dateReception.localeCompare(a.dateReception))
  const moisConnus = [...new Set(toutes.map((s) => s.mois))].sort().reverse()
  const entreprisesConnues = [...new Set(toutes.map((s) => s.entreprise))].sort((a, b) => a.localeCompare(b))
  const traitees = toutes.filter(
    (s) => (!filtreMois || s.mois === filtreMois) && (!filtreEntreprise || s.entreprise === filtreEntreprise),
  )
  const filtre = Boolean(filtreMois || filtreEntreprise)

  const projetIds = [...new Set(traitees.map((s) => s.projetId))]

  return (
    <Card titre="Historique — par projet">
      {toutes.length > 0 && (
        <div className="toolbar" style={{ marginTop: 0 }}>
          <Select
            value={filtreMois}
            onChange={setFiltreMois}
            options={[
              { value: '', label: 'Tous les mois' },
              ...moisConnus.map((m) => ({ value: m, label: fmtMois(m) })),
            ]}
          />
          <Select
            value={filtreEntreprise}
            onChange={setFiltreEntreprise}
            options={[
              { value: '', label: 'Toutes les entreprises' },
              ...entreprisesConnues.map((e) => ({ value: e, label: e })),
            ]}
          />
          <span className="muted small">
            {traitees.length} situation{traitees.length > 1 ? 's' : ''}
            {filtre ? ` sur ${toutes.length}` : ''}
          </span>
          {filtre && (
            <Btn
              small
              kind="ghost"
              onClick={() => {
                setFiltreMois('')
                setFiltreEntreprise('')
              }}
            >
              Retirer le filtre
            </Btn>
          )}
        </div>
      )}
      {toutes.length === 0 ? (
        <EmptyState>Aucune situation validée ou rejetée pour l’instant.</EmptyState>
      ) : traitees.length === 0 ? (
        <EmptyState>Aucune situation ne correspond à ce filtre — « Retirer le filtre » les remet toutes.</EmptyState>
      ) : (
        projetIds.map((pid) => {
          const duProjetToutes = traitees.filter((s) => s.projetId === pid)
          const deplie = deplies.includes(pid)
          const duProjet = deplie ? duProjetToutes : duProjetToutes.slice(0, PLAFOND_HISTORIQUE)
          return (
            <div key={pid} style={{ marginBottom: 14 }}>
              <div className="small" style={{ margin: '0 0 6px', fontWeight: 700 }}>
                <LienProjet state={state} projetId={pid} />
                {duProjetToutes.length > PLAFOND_HISTORIQUE && !deplie && (
                  <span className="muted" style={{ fontWeight: 500 }}>
                    {' '}
                    — {PLAFOND_HISTORIQUE} dernières sur {duProjetToutes.length}
                  </span>
                )}
              </div>
              <Table
                compact
                head={['Entreprise / lot', 'Mois', 'Mois HT', 'Cumul HT', 'Net à payer', 'Statut', 'Actions']}
              >
                {duProjet.map((s) => (
                  <tr key={s.id} title={s.source || undefined}>
                    <td>
                      <strong>{s.entreprise}</strong>
                      <div className="muted small">{s.lot || '—'}</div>
                    </td>
                    <td>{fmtMois(s.mois)}</td>
                    <td className="right">
                      <Money v={s.montantMoisHT} />
                    </td>
                    <td className="right">
                      <Money v={s.montantCumulHT} />
                    </td>
                    <td className="right">
                      <NetAPayer state={state} sit={s} /> <BadgeCoherence state={state} sit={s} />
                    </td>
                    <td>
                      <BadgeStatutSituation statut={s.statut} />
                      {s.statut === 'rejetee' && s.notes && (
                        <div className="muted small" style={{ maxWidth: 260 }}>{s.notes.split('\n').pop()}</div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <Btn
                          small
                          kind="ghost"
                          // B1 — réimpression du décompte FIGÉ à la validation quand la
                          // situation en porte un ; sinon reconstitution, et le papier
                          // le dit lui-même (validations antérieures à B1)
                          onClick={() => ouvrirDecompteSituationPDF(state, s, today)}
                          title={
                            s.decompteFige
                              ? `Décompte figé le ${fmtDate(s.decompteFige.figeLe)}${s.decompteFige.validePar ? ` par ${s.decompteFige.validePar}` : ''} — réimpression à l'identique (${fmtMoney(s.decompteFige.lignes.netAPayerHT)} HT net)`
                              : "Décompte de vérification (interne, vers l'entreprise) — aucun décompte n'a été figé à la validation : ce papier est reconstitué depuis l'état courant, et il le dit"
                          }
                        >
                          Décompte{s.decompteFige ? ' ✓' : ''}
                        </Btn>
                        {(() => {
                          // 5.19 — certificat de paiement vers le MO : émis = FIGÉ,
                          // il se rouvre en réimpression, jamais en recalcul
                          const cert = certificatDeSituation(state, s.id)
                          if (cert)
                            return (
                              <Btn
                                small
                                kind="ghost"
                                onClick={() => ouvrirCertificatPaiementPDF(cert)}
                                title={`Émis le ${fmtDate(cert.emisLe)} par ${cert.emisPar} — réimpression du document figé`}
                              >
                                Certificat n° {cert.numero} ✓
                              </Btn>
                            )
                          if (s.statut === 'validee' && marcheDeSituation(state, s))
                            return (
                              <Btn
                                small
                                onClick={() => setCertifId(s.id)}
                                title="Certificat de paiement (état d'acompte) vers le maître d'ouvrage — chaque ligne proposée reste corrigeable avant émission"
                              >
                                Certificat de paiement
                              </Btn>
                            )
                          return null
                        })()}
                        {s.statut === 'validee' && (
                          <Btn
                            small
                            onClick={() => facturerDET(state, update, today, s)}
                            title={
                              s.factureId
                                ? `Honoraires DET déjà facturés (${s.factureId}) — recréer si besoin`
                                : "Créer la facture d'honoraires DET d'avancement pour ce mois"
                            }
                          >
                            {s.factureId ? 'DET ✓' : 'Facturer DET'}
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
              {duProjetToutes.length > PLAFOND_HISTORIQUE && (
                <div className="small" style={{ marginTop: 4 }}>
                  <BtnLien
                    title="Le plafond de 6 lignes est un défaut d’affichage — jamais une limite d’accès au certificat"
                    onClick={() => deplier(pid)}
                  >
                    {deplie
                      ? `Réduire aux ${PLAFOND_HISTORIQUE} dernières`
                      : `Afficher tout (${duProjetToutes.length})`}
                  </BtnLien>
                </div>
              )}
            </div>
          )
        })
      )}
      {(() => {
        const sit = certifId ? state.situations.find((s) => s.id === certifId) : undefined
        return sit ? <ModalCertificat sit={sit} onClose={() => setCertifId(null)} /> : null
      })()}
    </Card>
  )
}

// ---------- situations attendues (marchés actifs) ----------
// le critère « situation du mois » vit dans src/entreprise.ts (5.20)

function CarteAttendues() {
  const { state } = useStore()
  const today = useToday()
  const moisCourant = monthKey(today)
  const tplRelance = gabarit(state, 'tpl-relance-situation')
  const actifs = state.marches.filter((m) => m.actif)
  // 5.20 — le nom de l'entreprise ouvre sa fiche transverse (lecture)
  const [fiche, setFiche] = useState<string | null>(null)

  return (
    <Card titre={`Situations attendues — ${fmtMois(moisCourant)}`}>
      {actifs.length === 0 ? (
        <EmptyState>
          Aucun marché actif : passez un marché en « chantier en cours » dans la fiche projet
          quand le chantier démarre — une situation mensuelle sera alors attendue ici.
        </EmptyState>
      ) : (
        <Table head={['Projet', 'Lot', 'Entreprise', 'Montant marché', 'État du mois', 'Relance']}>
          {actifs.map((m) => {
            const sit = situationDuMois(state, m, moisCourant)
            // 5.20 / S2 — LE critère partagé du 10 du mois (src/entreprise.ts),
            // celui du fil d'urgences et de la fiche entreprise. La règle
            // locale « manquante dès le 1er » faisait répondre deux écrans
            // différemment à « cette situation est-elle en retard ? »
            const attente = situationAttendueNonRecue(state, m, today)
            return (
              <tr key={m.id}>
                <td>
                  <LienProjet state={state} projetId={m.projetId} />
                </td>
                <td>{m.lot}</td>
                <td>
                  <BtnLien
                    title="Ouvrir la fiche entreprise — tout ce qu'on sait d'elle, tous projets"
                    onClick={() => setFiche(m.entrepriseId || m.entreprise)}
                  >
                    {m.entreprise}
                  </BtnLien>
                </td>
                <td className="right">
                  <Money v={m.montantInitialHT + m.avenantsHT} />
                </td>
                <td>
                  {sit ? (
                    <>
                      <Badge tone="ok">reçue ✓</Badge> <BadgeStatutSituation statut={sit.statut} />
                    </>
                  ) : attente ? (
                    <span
                      title={
                        attente.gravite === 3
                          ? `Attendue depuis le ${JOUR_ATTENTE_SITUATION} — passé le ${JOUR_RELANCE_SITUATION}, le retard décale d’autant la vérification puis le paiement`
                          : `Attendue depuis le ${JOUR_ATTENTE_SITUATION} du mois`
                      }
                    >
                      <Badge tone={attente.gravite === 3 ? 'danger' : 'warn'}>non reçue</Badge>
                    </span>
                  ) : (
                    <span
                      className="muted small"
                      title={`L'entreprise facture à terme échu : elle a jusqu'au ${JOUR_ATTENTE_SITUATION} pour envoyer sa situation du mois.`}
                    >
                      attendue à partir du {JOUR_ATTENTE_SITUATION}
                    </span>
                  )}
                </td>
                <td>
                  {!attente ? (
                    <span
                      className="muted"
                      title={
                        sit
                          ? 'Situation reçue — rien à relancer'
                          : `Avant le ${JOUR_ATTENTE_SITUATION}, l'entreprise n'est pas en retard : relancer serait injuste`
                      }
                    >
                      —
                    </span>
                  ) : tplRelance ? (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <CopyBtn
                        small
                        kind="default"
                        label="Relance"
                        text={() => assemble(tplRelance.corps, contexteMarche(state, m))}
                      />
                      <Btn
                        small
                        kind="ghost"
                        title="Ouvre Gmail avec une relance factuelle pré-remplie — l'envoi reste votre clic"
                        onClick={() =>
                          // 5.20 — le MÊME brouillon que la fiche entreprise
                          // (texte défini dans src/entreprise.ts, une fois)
                          ouvrirGmail(
                            m.contactEmail || '',
                            sujetRelanceSituation(m, moisCourant),
                            corpsRelanceSituation(m, moisCourant, state.settings.nomAgence),
                          )
                        }
                      >
                        Gmail
                      </Btn>
                    </span>
                  ) : (
                    <Btn small disabled title="Gabarit « tpl-relance-situation » introuvable dans la bibliothèque de prompts.">
                      Relance
                    </Btn>
                  )}
                </td>
              </tr>
            )
          })}
        </Table>
      )}
      <p className="muted small">
        Une situation n’est « non reçue » qu’à partir du {JOUR_ATTENTE_SITUATION} du mois —
        l’entreprise facture à terme échu ; c’est le même critère que le fil d’urgences et la
        fiche entreprise. Les marchés de travaux se gèrent dans la fiche projet (carte
        « Marchés de travaux »).
        {tplRelance ? ` La relance copiée se colle dans le Projet Claude « ${tplRelance.projetClaude} » — brouillon Gmail, relu avant envoi.` : ''}
      </p>
      {fiche && <FicheEntreprise nomOuId={fiche} onClose={() => setFiche(null)} />}
    </Card>
  )
}

// ---------- page ----------

const LIBELLE_RG: Record<StatutRG, { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted' }> = {
  en_cours: { label: 'chantier en cours', tone: 'muted' },
  retenue: { label: 'retenue en cours', tone: 'info' },
  a_liberer: { label: 'à libérer', tone: 'danger' },
  liberee: { label: 'libérée', tone: 'ok' },
}

function CarteRetenues() {
  const { state, update } = useStore()
  const today = useToday()
  const marches = state.marches.filter((m) => (m.tauxRG || 0) > 0)
  // 5.20 — le nom de l'entreprise ouvre sa fiche transverse (lecture)
  const [fiche, setFiche] = useState<string | null>(null)

  const majMarche = (id: string, patch: Partial<(typeof state.marches)[number]>) =>
    update((d) => {
      const m = d.marches.find((x) => x.id === id)
      if (m) Object.assign(m, patch)
    })

  const total = marches.reduce((s, m) => {
    const rg = retenueGarantieMarche(state, m, today)
    return rg.statut === 'liberee' || rg.caution ? s : s + rg.retenueHT
  }, 0)

  return (
    <Card titre={`Retenues de garantie — ${fmtMoney(total)} encore retenus`}>
      <p className="small muted" style={{ marginTop: 0, marginBottom: 8 }}>
        La RG (5 % en général) est libérée un an après la réception (garantie de parfait
        achèvement), sauf caution bancaire de substitution. De l'argent facile à oublier.
      </p>
      {marches.length === 0 ? (
        <EmptyState>Aucun marché avec retenue de garantie.</EmptyState>
      ) : (
        <Table
          compact
          head={['Lot / entreprise', 'Projet', 'Cumul travaux', 'RG retenue', 'Réception', 'Levée (récep.+1 an)', 'Garantie', 'Statut', '']}
        >
          {marches.map((m) => {
            const rg = retenueGarantieMarche(state, m, today)
            const lib = LIBELLE_RG[rg.statut]
            return (
              <tr key={m.id}>
                <td>
                  <strong>{m.lot}</strong>
                  <div className="muted small">
                    <BtnLien
                      title="Ouvrir la fiche entreprise — tout ce qu'on sait d'elle, tous projets"
                      onClick={() => setFiche(m.entrepriseId || m.entreprise)}
                    >
                      {m.entreprise}
                    </BtnLien>
                  </div>
                </td>
                <td><LienProjet state={state} projetId={m.projetId} /></td>
                <td className="right num">{fmtMoney(rg.travauxCumulHT)}</td>
                <td className="right num">
                  {fmtMoney(rg.retenueHT)}
                  <div className="muted small">
                    {rg.garantie === 'retenue' ? fmtPct(m.tauxRG, 0) : 'rien n\'est retenu'}
                  </div>
                </td>
                <td>
                  <DateInput value={m.dateReception ?? null} onChange={(v) => majMarche(m.id, { dateReception: v })} />
                </td>
                <td>{rg.dateLevee ? <DateF d={rg.dateLevee} /> : <span className="muted">—</span>}</td>
                <td>
                  {/* écrit le champ TYPÉ, qui prime sur l'ancien `cautionRG` :
                      un booléen modifié ici pendant que le formulaire pose le
                      type ferait deux sources de vérité (défaut 5.1) */}
                  <Select
                    value={garantieDuMarche(m)}
                    onChange={(v) => majMarche(m.id, { garantie: v as TypeGarantie })}
                    options={[
                      { value: 'retenue', label: 'Retenue' },
                      { value: 'caution', label: 'Caution bancaire' },
                      { value: 'gpd', label: 'Première demande' },
                    ]}
                  />
                  {garantieDuMarche(m) !== 'retenue' && m.garantieRecueLe && (
                    <div className="muted small">reçue le {fmtDate(m.garantieRecueLe)}</div>
                  )}
                </td>
                <td><Badge tone={lib.tone}>{lib.label}</Badge></td>
                <td className="right">
                  {rg.statut !== 'liberee' && rg.dateReception ? (
                    <Btn small onClick={() => majMarche(m.id, { rgLibere: true })} title="Marquer la retenue de garantie comme libérée à l'entreprise">
                      Marquer libérée
                    </Btn>
                  ) : rg.statut === 'liberee' ? (
                    <Btn small kind="ghost" onClick={() => majMarche(m.id, { rgLibere: false })} title="Annuler la libération">
                      Rouvrir
                    </Btn>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </Table>
      )}
      {fiche && <FicheEntreprise nomOuId={fiche} onClose={() => setFiche(null)} />}
    </Card>
  )
}

/** T6 — les sous-vues ont une ADRESSE : `#/situations/attendues` ouvre
 *  l'onglet Attendues, comme `#/projets/:id/chantier` ouvre l'onglet
 *  Chantier. En `useState` local, tous les liens venus d'ailleurs (fiche
 *  entreprise, alertes) atterrissaient sur « À vérifier », charge à la
 *  personne de retrouver l'onglet qu'on lui avait promis. */
const ONGLETS_SITUATIONS = ['verifier', 'attendues', 'historique', 'rg']

export default function Situations() {
  // quatre tâches distinctes → quatre sous-vues (audit simplification) ;
  // l'import manuel de la routine devient un dépannage replié
  const { state } = useStore()
  const route = useRoute()
  const vue = ONGLETS_SITUATIONS.includes(route[1] || '') ? route[1] : 'verifier'
  // Deux routes profondes, distinguées par le SEUL segment `route[2]` — et
  // elles ne peuvent pas se confondre : aucun identifiant ne vaut « chercher ».
  //   · `#/situations/<onglet>/chercher/<entreprise>` (palette « / ») : la
  //     palette envoie déjà sur le BON onglet en portant le nom de
  //     l'entreprise ; sans cette lecture, l'onglet était bon et le filtre
  //     vide (T6, parcours 9).
  //   · `#/situations/<onglet>/<id>` (alerte « situation à vérifier », écrite
  //     par alerts.ts) : l'identifiant voyageait depuis le début et personne
  //     ne le lisait — le lien déposait en haut de la liste NON filtrée, à
  //     retrouver la ligne à l'œil. C'est la carte qui met la ligne en
  //     évidence, ici on ne fait que découper l'adresse.
  const entrepriseRoute = route[2] === 'chercher' ? route[3] || '' : ''
  const idRoute = route[2] && route[2] !== 'chercher' ? route[2] : ''
  const nbAVerifier = state.situations.filter((s) => s.statut === 'a_verifier').length
  return (
    <Page
      titre="Situations de travaux"
      sousTitre="Les entreprises envoient à situations@ ; vous vérifiez et visez."
    >
      <Tabs
        tabs={[
          { id: 'verifier', label: nbAVerifier > 0 ? `À vérifier (${nbAVerifier})` : 'À vérifier' },
          { id: 'attendues', label: 'Attendues' },
          { id: 'historique', label: 'Historique' },
          { id: 'rg', label: 'Retenues de garantie' },
        ]}
        actif={vue}
        onSelect={(id) => navigate(`/situations/${id}`)}
      />
      {vue === 'verifier' && (
        <>
          <div className="pill-note">
            La maîtrise d'œuvre porte le risque sur le délai de paiement : la date limite de
            vérification est calculée d'après le délai du marché (15 j par défaut).
          </div>
          {/* `key` : arriver depuis une AUTRE alerte (ou une autre entreprise)
              repose le filtre et la mise en évidence — sans lui, le second
              lien laisserait l'état du premier en place */}
          <CarteAVerifier
            key={`${idRoute}|${entrepriseRoute}`}
            cibleId={idRoute}
            entrepriseInitiale={entrepriseRoute}
          />
          <details style={{ marginTop: 8 }}>
            <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
              Dépannage — coller à la main le retour JSON de la routine
            </summary>
            <div style={{ marginTop: 8 }}>
              <CarteImport />
            </div>
          </details>
        </>
      )}
      {vue === 'attendues' && <CarteAttendues />}
      {/* `key` : arriver depuis la palette sur une AUTRE entreprise repose le
          filtre — sans lui, le second lien laisserait le premier filtre en place */}
      {vue === 'historique' && (
        <CarteHistorique key={entrepriseRoute} entrepriseInitiale={entrepriseRoute} />
      )}
      {vue === 'rg' && <CarteRetenues />}
    </Page>
  )
}
