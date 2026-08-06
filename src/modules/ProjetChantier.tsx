// Onglet Chantier de l'espace projet : marchés de travaux +
// réunions de chantier avec l'assistant CR (audio → transcription
// sans API → CR au style de l'agence → relecture → diffusion).

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  DesordreGPA,
  EtatPointSeance,
  EvenementMarche,
  Intemperie,
  MarcheTravaux,
  NatureIntemperie,
  PhaseCode,
  PointSeance,
  Projet,
  ReunionChantier,
  StatutReunion,
  TypeEvenementMarche,
  TypeGarantie,
  Visa,
} from '../types'
import { useStore } from '../store'
import { useMoi } from '../moi'
import { LIBELLE_GARANTIE, garantieDuMarche } from '../derive'
// C1/C2 — l'avancement d'un lot et le prédicat « entreprise à confirmer »
// ont DÉJÀ leur autorité (src/chantier.ts) : les cartes de cet onglet les
// importent. Les recopier ici donnerait deux chiffres possibles pour la
// même question — le défaut n° 1 de l'audit (constat R3).
import { avancementLot, tacheAConfirmer } from '../chantier'
// C3 — le relevé de séance : rangement, ancienneté, report des points non
// résolus et propositions de la machine. TOUT vient de là, y compris pour
// le papier (src/pdf.ts appelle la même `preparerSeance`) : c'est ce qui
// rend impossible que l'écran et le document imprimé montrent deux ordres
// du jour différents.
import {
  LIBELLE_ETAT_POINT,
  ORDRE_ETATS_POINT,
  libelleAnciennete,
  pointAvecEtat,
  pointCorrige,
  pointDepuisProposition,
  pointNouveau,
  pointResolu,
  preparerSeance,
  type ContexteGeste,
  type PropositionSeance,
} from '../seanceChantier'
// R2 — le rapprochement nom → entreprise canonique a DÉJÀ son autorité
// (src/entreprise.ts) : la datalist du marché la réutilise au lieu d'en
// écrire une seconde, sinon « Martin BTP » et « SARL Martin BTP »
// continueraient de scinder la fiche transverse en silence.
import { entrepriseDe, marchesDe } from '../entreprise'
// C1 — le gabarit du dossier de séance vit dans src/pdf.ts, avec les autres
// impressions (facture, certificat, revue, décompte). Import STATIQUE : c'est
// le compilateur qui vérifie alors que l'écran et le gabarit parlent de la
// même fonction — l'import dynamique typé par `unknown` qui tenait la place
// en attendant sa livraison ne vérifiait rien.
import { ouvrirPreparationReunionPDF } from '../pdf'
import { serieEnRetard } from '../indicesInsee'
// La normalisation d'un code de série (« bt 01 » ≡ « BT01 ») et la lecture
// d'une série vivent dans src/revisionPrix.ts — c'est ce rapprochement-là qui
// décidera du calcul de révision. La datalist propose donc EXACTEMENT ce que
// le calcul saura rapprocher, au lieu d'une seconde liste écrite à côté.
import { cleSerie, valeursSerie } from '../revisionPrix'
import {
  DELAI_VISA_DEFAUT,
  LIBELLE_STATUT_VISA,
  echeanceVisa,
  visasEnAttente,
  visasEnRetard,
  visasSousHuitaine,
} from '../visas'
import { LIBELLE_STATUT_DESORDRE, avecRelance, desordresOuverts, finGPA, joursAvantFinGPA } from '../gpa'
import {
  MODELES_AMORCE,
  appliquerModele,
  tachesDepuisApercu,
  type ContexteApplication,
} from '../modelesTaches'
import {
  LIBELLE_EVENEMENT,
  LIBELLE_INTEMPERIE,
  estJourOuvre,
  penaliteEncourue,
  prolongationDelai,
  totalAppliqueMarche,
  totalEncouruMarche,
} from '../penalites'
import { assemble, contexteMarche, contexteProjet } from '../prompts'
import {
  Badge,
  Btn,
  BtnLien,
  Card,
  CopyBtn,
  EmptyState,
  DateInput,
  Field,
  Modal,
  Money,
  NumInput,
  PctInput,
  Select,
  Table,
  TextArea,
  TextInput,
  confirmer,
  toast, RowMenu } from '../ui'
import type { Tone } from '../ui'
import { addDays, diffDays, fmtDate, fmtMoney, fmtPct, fold, ouvrirGmail, todayISO, uid } from '../util'
import { MODELES_WHISPER, transcrireFichier, type ProgresTranscription } from '../transcription'
import { CONTRAT_CR, genererDocxCR, parseRetourCR, retourVersTexte } from '../crdocx'
import { lireRacine, nomConforme, rangerFichier, supporteFS, type ResultatRangement } from '../fsdrive'
import { creerDocument, empreinteSha256, enregistrerDocument, remplacerDocument } from '../registre'
import { copier } from '../prompts'
import FicheEntreprise from './FicheEntreprise'

// ============================================================
// Marchés de travaux
// ============================================================

export function CarteMarches({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const today = todayISO()
  const [modal, setModal] = useState<{ marche?: MarcheTravaux } | null>(null)
  // 5.20 — le nom de l'entreprise ouvre sa fiche transverse (lecture)
  const [fiche, setFiche] = useState<string | null>(null)
  // R3 — l'explication de l'écart reste repliée : le pied dit les deux
  // chiffres, le badge s'ouvre quand on veut savoir ce qu'il coûte
  const [ecartOuvert, setEcartOuvert] = useState(false)

  const marches = state.marches.filter((m) => m.projetId === p.id)

  // R3 — LES DEUX montants de travaux du projet, confrontés ici pour la
  // première fois : la somme des marchés signés (cet écran) et le montant
  // de travaux de l'OPÉRATION (fiche projet). C'est le second, et lui seul,
  // que lit `honorairesDETduMois` (derive.ts) pour proposer les honoraires
  // DET du mois — un écart non vu fausse chaque note DET sans un mot.
  const totalMarchesHT = marches.reduce((t, m) => t + m.montantInitialHT + m.avenantsHT, 0)
  // null ≠ 0 : un montant d'opération non saisi se dit, il ne s'affiche pas « 0 € »
  const travauxOperationHT = p.montantTravauxHT ?? null
  const ecartHT = travauxOperationHT === null ? null : totalMarchesHT - travauxOperationHT
  const partEcart =
    travauxOperationHT !== null && travauxOperationHT > 0 && ecartHT !== null
      ? Math.abs(ecartHT) / travauxOperationHT
      : null
  // sous 1 %, les deux chiffres se lisent côte à côte sans badge : un badge
  // qui crie pour un arrondi finit ignoré, et avec lui ceux qui comptent
  const ecartNotable = partEcart !== null && partEcart >= 0.01

  const supprimer = async (m: MarcheTravaux) => {
    const snap = state
    const nbSits = state.situations.filter((s) => s.marcheId === m.id).length
    const question =
      nbSits > 0
        ? `Supprimer le marché « ${m.lot} — ${m.entreprise} » ?\n${nbSits} situation(s) y sont rattachées : elles seront conservées mais détachées du marché.`
        : `Supprimer le marché « ${m.lot} — ${m.entreprise} » ?`
    if (!(await confirmer({ message: question, danger: true, confirmerLabel: 'Supprimer' }))) return
    update((d) => {
      d.marches = d.marches.filter((x) => x.id !== m.id)
      for (const s of d.situations) if (s.marcheId === m.id) s.marcheId = null
      // les lots DCE et tâches du planning travaux se détachent aussi
      for (const l of d.lotsDce) if (l.marcheId === m.id) l.marcheId = null
      for (const t of d.tachesChantier) if (t.marcheId === m.id) t.marcheId = null
    })
    toast('Marché supprimé.', { undo: () => replace(snap) })
  }

  return (
    <Card
      titre="Marchés de travaux"
      actions={
        <>
          <a href="#/situations" className="small">Situations de travaux →</a>
          <Btn small kind="primary" onClick={() => setModal({})}>Ajouter un marché</Btn>
        </>
      }
    >
      {marches.length === 0 ? (
        <EmptyState>
          Aucun marché — ajoutez chaque lot à la signature : c'est le support du suivi des situations,
          des relances et des CR.
        </EmptyState>
      ) : (
        <>
          <Table
            compact
            head={[
              'Lot',
              'Entreprise',
              <span key="m" className="right">Montant HT (avenants inclus)</span>,
              'RG',
              'Révision',
              'Intervention',
              'Chantier',
              'Contact',
              'Délai vérif.',
              '',
            ]}
          >
            {marches.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.lot}</strong></td>
                <td>
                  {/* 5.20 — la fiche transverse : marchés tous projets, RG,
                      certificats, GPA, visas, pénalités — en lecture */}
                  <BtnLien
                    title="Ouvrir la fiche entreprise — tout ce qu'on sait d'elle, tous projets"
                    onClick={() => setFiche(m.entrepriseId || m.entreprise)}
                  >
                    {m.entreprise}
                  </BtnLien>
                  {m.notes && <div className="muted small">{m.notes}</div>}
                </td>
                <td className="right">
                  <Money v={m.montantInitialHT + m.avenantsHT} />
                  {m.avenantsHT !== 0 && (
                    <div className="muted small">dont avenants {fmtMoney(m.avenantsHT)}</div>
                  )}
                </td>
                <td className="num">
                  {garantieDuMarche(m) === 'retenue' ? (
                    fmtPct(m.tauxRG, 0)
                  ) : (
                    // la raison du 0 % doit se lire dans la liste, pas se deviner
                    <span title={`RG 0 % — ${LIBELLE_GARANTIE[garantieDuMarche(m)]}${m.garantieRecueLe ? ` reçue le ${fmtDate(m.garantieRecueLe)}` : ''}`}>
                      {garantieDuMarche(m) === 'caution' ? 'caution' : 'GPD'}
                    </span>
                  )}
                </td>
                <td>
                  {m.revision ? (
                    m.indiceRevision ? (
                      (() => {
                        // 5.18 — deux manques à montrer, pas un : aucune valeur
                        // du tout, et des valeurs PÉRIMÉES (> 4 mois d'écart —
                        // l'INSEE publie à ~3 mois, au-delà c'est que la
                        // récupération automatique échoue et il faut le voir ICI,
                        // sur le marché concerné, pas dans une console).
                        const retard = serieEnRetard(state.indicesBTP, m.indiceRevision!, today.slice(0, 7))
                        return (
                          <span className="small">
                            {m.indiceRevision}
                            {m.moisZero ? <span className="muted"> · base {m.moisZero}</span> : ''}
                            {retard.enRetard && (
                              <>
                                {' '}
                                <Badge tone="warn">
                                  {retard.dernierMois ? `indice périmé (${retard.dernierMois})` : 'indice ?'}
                                </Badge>
                              </>
                            )}
                          </span>
                        )
                      })()
                    ) : (
                      // révisable mais sans série : la révision théorique (5.4)
                      // répondra null — le manque doit se voir dans la liste
                      <Badge tone="warn">indice ?</Badge>
                    )
                  ) : (
                    '—'
                  )}
                </td>
                <td className="small">
                  {m.dateDebut || m.dateFin ? (
                    <>{m.dateDebut ? fmtDate(m.dateDebut) : '?'} → {m.dateFin ? fmtDate(m.dateFin) : '?'}</>
                  ) : (
                    <a href="#/planning" className="muted">à planifier</a>
                  )}
                </td>
                <td>{m.actif ? <Badge tone="ok">en cours</Badge> : <span className="muted">—</span>}</td>
                <td className="small">
                  {m.contactNom || <span className="muted">—</span>}
                  {m.contactEmail && <div className="muted">{m.contactEmail}</div>}
                </td>
                <td className="num">{m.delaiVerifJours} j</td>
                <td className="right">
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <Btn small onClick={() => setModal({ marche: m })}>Modifier</Btn>
                    <RowMenu items={[{ label: 'Supprimer le marché', onClick: () => supprimer(m), danger: true }]} />
                  </span>
                </td>
              </tr>
            ))}
          </Table>
          {/* R3 — le pied confronte les deux montants. Sans lui, ils vivaient
              sur deux écrans et personne ne les comparait jamais. */}
          <p
            className="small"
            style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          >
            <span>
              Total marchés : <strong>{fmtMoney(totalMarchesHT)}</strong> HT — travaux de l'opération :{' '}
              {travauxOperationHT === null ? (
                <span className="muted">non saisi</span>
              ) : (
                <strong>{fmtMoney(travauxOperationHT)}</strong>
              )}
              {travauxOperationHT !== null && ' HT'}
            </span>
            {(ecartNotable || travauxOperationHT === null) && (
              <BtnLien
                title="Ce que cet écart change à la facturation DET"
                onClick={() => setEcartOuvert((x) => !x)}
              >
                <Badge tone="warn">
                  {travauxOperationHT === null
                    ? 'travaux de l’opération ?'
                    : `écart ${ecartHT! > 0 ? '+' : '−'}${fmtMoney(Math.abs(ecartHT!))} (${fmtPct(partEcart, 0)})`}
                </Badge>
              </BtnLien>
            )}
          </p>
          {ecartOuvert && (
            <div
              className="small"
              style={{ marginTop: 6, border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}
            >
              <p style={{ margin: '0 0 6px' }}>
                Les honoraires DET du mois sont proposés au prorata du montant de travaux de
                l'<strong>opération</strong> (montant du mois ÷ travaux de l'opération × honoraires DET) :
                c'est ce montant-là, saisi sur la fiche projet, qui fait la facturation — pas la somme
                des marchés affichée ci-dessus.
              </p>
              <p className="muted" style={{ margin: '0 0 8px' }}>
                {travauxOperationHT === null
                  ? "Sans montant de travaux sur la fiche projet, aucun honoraire DET ne se propose : la note se chiffre à la main, état après état."
                  : `Tant que tous les lots ne sont pas attribués, l'écart est normal. Une fois le dernier marché signé, il ne l'est plus : chaque note DET serait proposée ${ecartHT! > 0 ? 'au-dessus' : 'en dessous'} du réel d'environ ${fmtPct(partEcart, 0)}.`}
              </p>
              <a href={`#/projets/${p.id}`}>Fiche projet — vérifier le montant de travaux →</a>
            </div>
          )}
        </>
      )}

      {modal && <ModalMarche projetId={p.id} marche={modal.marche} onClose={() => setModal(null)} />}
      {fiche && <FicheEntreprise nomOuId={fiche} onClose={() => setFiche(null)} />}
    </Card>
  )
}

function ModalMarche({
  projetId,
  marche,
  onClose,
}: {
  projetId: string
  marche?: MarcheTravaux
  onClose: () => void
}) {
  const { state, update } = useStore()
  const creation = !marche

  const [lot, setLot] = useState(marche?.lot || '')
  const [entreprise, setEntreprise] = useState(marche?.entreprise || '')
  // R2 — l'entreprise canonique du registre : posée par la datalist, elle
  // regroupe marchés, RG, certificats et GPA sous UNE fiche transverse.
  // Le nom reste affiché tel qu'il est écrit au marché (l'acte contractuel).
  // À l'ouverture d'un marché ANCIEN (le lien n'existait pas), on repropose
  // celui que le nom désigne : enregistrer le pose enfin.
  const [entrepriseId, setEntrepriseId] = useState<string | null>(
    marche?.entrepriseId ?? entrepriseDe(state, marche?.entreprise ?? '')?.id ?? null,
  )
  const [montantInitial, setMontantInitial] = useState<number | null>(marche?.montantInitialHT ?? null)
  const [avenants, setAvenants] = useState<number | null>(marche?.avenantsHT ?? 0)
  const [tauxRG, setTauxRG] = useState<number | null>(marche?.tauxRG ?? 0.05)
  // `garantieDuMarche` et non `marche?.garantie` : un marché d'avant le Lot 5
  // ne porte que `cautionRG`, et le formulaire doit montrer la valeur EFFECTIVE
  const [garantie, setGarantie] = useState<TypeGarantie>(garantieDuMarche(marche))
  const [garantieRecueLe, setGarantieRecueLe] = useState<string | null>(marche?.garantieRecueLe ?? null)
  const [revision, setRevision] = useState(marche?.revision ? 'oui' : 'non')
  // 5.4 — paramètres de la révision, propres au marché (le CCAP de chaque
  // entreprise cite SA série) ; les valeurs des séries, elles, se saisissent
  // en Paramètres : elles sont nationales
  const [indiceRevision, setIndiceRevision] = useState(marche?.indiceRevision || '')
  const [moisZero, setMoisZero] = useState(marche?.moisZero || '')
  const [partFixe, setPartFixe] = useState<number | null>(marche?.partFixe ?? null)
  const [delaiVerif, setDelaiVerif] = useState<number | null>(marche?.delaiVerifJours ?? 15)
  // 5.2 — taux de pénalités du CCAP, propres au marché (comme la révision :
  // chaque CCAP écrit les siens). null = non relevé : l'encouru répondra
  // null, jamais 0 — pas de « pénalité nulle » par défaut de saisie.
  const [penRetard, setPenRetard] = useState<number | null>(marche?.penalites?.retardParJourHT ?? null)
  const [penAbsence, setPenAbsence] = useState<number | null>(marche?.penalites?.absenceReunionHT ?? null)
  const [penDocument, setPenDocument] = useState<number | null>(marche?.penalites?.documentRetardParJourHT ?? null)
  const [contactNom, setContactNom] = useState(marche?.contactNom || '')
  const [contactEmail, setContactEmail] = useState(marche?.contactEmail || '')
  const [actif, setActif] = useState(marche?.actif ? 'oui' : 'non')
  const [dateDebut, setDateDebut] = useState<string | null>(marche?.dateDebut ?? null)
  const [dateFin, setDateFin] = useState<string | null>(marche?.dateFin ?? null)
  // 5.19 — avance forfaitaire du CCAG (art. 13). Le champ existait au type et
  // le certificat de paiement le LIT (avance versée + résorption proposée) ;
  // personne ne l'écrivait : chaque état mensuel proposait donc 0 d'avance et
  // 0 de résorption, à corriger à la main état après état.
  const [avance, setAvance] = useState<number | null>(marche?.avanceForfaitaireHT ?? null)
  // la proposition à 5 % suit le montant initial tant qu'elle est cochée —
  // décochable, parce qu'un marché SANS avance existe (l'entreprise peut y
  // renoncer, le CCAP écrire un autre taux) et qu'une avance inventée
  // ferait résorber au titulaire un argent qu'il n'a jamais reçu
  const [avanceAuto, setAvanceAuto] = useState(creation)
  const [notes, setNotes] = useState(marche?.notes || '')

  const propositionAvance =
    montantInitial !== null && montantInitial > 0 ? Math.round(montantInitial * 0.05) : null
  const avanceRetenue = avanceAuto ? propositionAvance : avance

  // les entreprises déjà connues : le registre (fiches transverses) ET les
  // noms portés par les marchés existants — un marché saisi avant l'amorce du
  // registre doit rester proposable, sinon on retape ce que l'outil sait
  const entreprisesConnues = (() => {
    const noms = new Map<string, string>()
    for (const e of state.entreprises) if (e?.raisonSociale) noms.set(fold(e.raisonSociale), e.raisonSociale)
    for (const m of state.marches) if (m?.entreprise && !noms.has(fold(m.entreprise))) noms.set(fold(m.entreprise), m.entreprise)
    return [...noms.values()].sort((a, b) => a.localeCompare(b))
  })()

  // 5.18 — les séries dont l'agence a des valeurs : `state.indicesBTP` les
  // connaît (récupération INSEE + saisies), la personne n'a pas à retaper de
  // mémoire le code d'un CCAP. La liste PROPOSE, elle n'enferme pas : un CCAP
  // peut citer une série jamais suivie ici, la saisie reste libre.
  const seriesConnues = [...new Set(state.indicesBTP.map((i) => cleSerie(i?.indice)).filter(Boolean))].sort()
  // ce que le référentiel sait de la série SAISIE — dit à l'écran plutôt que
  // découvert au moment du certificat de paiement, quand la révision répond
  // null sans expliquer pourquoi
  const valeursIndiceSaisi = valeursSerie(state.indicesBTP, indiceRevision)
  const dernierIndiceSaisi = valeursIndiceSaisi[valeursIndiceSaisi.length - 1] ?? null

  // le nom d'abord (c'est ce qu'on lit à l'écran), l'identifiant en repli —
  // un marché lié à une fiche dont la raison sociale a changé reste lié
  const entrepriseReconnue =
    entrepriseDe(state, entreprise.trim()) ?? (entrepriseId ? entrepriseDe(state, entrepriseId) : null)

  /** saisie du nom : on repose l'identité canonique à chaque frappe (le
   *  rapprochement est celui de la fiche 5.20, pas un second) et on
   *  pré-remplit le contact — sans JAMAIS écraser une saisie en cours */
  const saisirEntreprise = (v: string) => {
    setEntreprise(v)
    const ent = entrepriseDe(state, v.trim())
    setEntrepriseId(ent?.id ?? null)
    const dernier = marchesDe(state, v.trim())
      .filter((m) => m.id !== marche?.id && (m.contactNom || m.contactEmail))
      .slice(-1)[0]
    const nom = ent?.contactNom || dernier?.contactNom || ''
    const email = ent?.contactEmail || dernier?.contactEmail || ''
    if (nom && !contactNom.trim()) setContactNom(nom)
    if (email && !contactEmail.trim()) setContactEmail(email)
  }

  const valide = lot.trim() !== '' && entreprise.trim() !== ''

  const enregistrer = () => {
    if (!valide) return
    if (moisZero.trim() && !/^\d{4}-\d{2}$/.test(moisZero.trim())) {
      // enregistrer un mois zéro illisible ferait répondre null au calcul de
      // révision sans que la cause se voie jamais : on refuse à la saisie
      toast('Mois zéro attendu au format AAAA-MM (ex. 2025-10).', { tone: 'danger' })
      return
    }
    update((d) => {
      const champs = {
        lot: lot.trim(),
        entreprise: entreprise.trim(),
        // R2 — l'identité canonique quand le nom est reconnu ; null sinon
        // (une entreprise pas encore au registre reste un nom libre, mais
        // elle le DIT à l'écran au lieu de scinder la fiche en silence)
        entrepriseId,
        montantInitialHT: montantInitial ?? 0,
        avenantsHT: avenants ?? 0,
        tauxRG: tauxRG ?? 0.05,
        // le champ typé prime sur l'ancien `cautionRG` (voir garantieDuMarche) ;
        // la date n'a de sens que si un document couvre le marché
        garantie,
        garantieRecueLe: garantie === 'retenue' ? null : garantieRecueLe,
        revision: revision === 'oui',
        // conservés même quand la révision passe à « non » : un aller-retour
        // du sélecteur ne doit pas effacer une saisie — et le calcul (5.4)
        // ne lit ces champs que si `revision` est vrai
        indiceRevision: indiceRevision.trim().toUpperCase() || undefined,
        moisZero: moisZero.trim() || undefined,
        partFixe: partFixe ?? undefined,
        delaiVerifJours: delaiVerif ?? 15,
        // 5.2 — undefined quand rien n'est relevé : un objet vide laisserait
        // croire que les taux du CCAP ont été lus et valent zéro
        penalites:
          penRetard == null && penAbsence == null && penDocument == null
            ? undefined
            : {
                retardParJourHT: penRetard,
                absenceReunionHT: penAbsence,
                documentRetardParJourHT: penDocument,
              },
        contactNom: contactNom.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        actif: actif === 'oui',
        dateDebut,
        dateFin,
        // 5.19 — null (et non 0) quand il n'y a pas d'avance : le certificat
        // n'a alors rien à résorber ; 0 affirmerait une avance nulle décidée
        avanceForfaitaireHT: avanceRetenue !== null && avanceRetenue > 0 ? avanceRetenue : null,
        notes: notes.trim() || undefined,
      }
      if (creation) {
        d.marches.push({ id: uid('marche'), projetId, ...champs })
      } else {
        const m = d.marches.find((x) => x.id === marche.id)
        if (m) Object.assign(m, champs)
      }
    })
    onClose()
  }

  return (
    <Modal titre={creation ? 'Nouveau marché de travaux' : `Modifier ${marche.lot}`} onClose={onClose}>
      <div className="form-row">
        <Field label="Lot">
          <TextInput value={lot} onChange={setLot} placeholder="Ex. Lot 01 — Gros œuvre" />
        </Field>
        <Field
          label="Entreprise"
          hint={
            entrepriseReconnue
              ? `Fiche « ${entrepriseReconnue.raisonSociale} » reconnue : marchés, RG, certificats et GPA se regrouperont dessus.`
              : entreprise.trim()
                ? 'Nom libre — pas encore de fiche : reprenez à l’identique le nom déjà utilisé ailleurs, sinon la fiche entreprise se scinde en deux.'
                : 'Choisissez dans la liste des entreprises déjà connues — le contact se pré-remplit.'
          }
        >
          {/* R2 — datalist : les entreprises déjà connues se choisissent, le
              nom reste saisissable (un nouveau titulaire n'est pas encore au
              registre). `TextInput` (ui.tsx) ne porte pas d'attribut `list` :
              l'input est écrit ici, aux mêmes classes. */}
          <input
            className="input"
            type="text"
            list="marche-entreprises-connues"
            value={entreprise}
            onChange={(e) => saisirEntreprise(e.target.value)}
            aria-label="Entreprise titulaire du lot"
          />
          <datalist id="marche-entreprises-connues">
            {entreprisesConnues.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>
      </div>
      <div className="form-row">
        <Field label="Montant initial HT (€)">
          <NumInput value={montantInitial} onChange={setMontantInitial} />
        </Field>
        <Field label="Avenants HT (€)">
          <NumInput value={avenants} onChange={setAvenants} />
        </Field>
        {/* <div> et non <Field> : la case à cocher est un second contrôle,
            et deux <label> imbriqués renverraient le clic au champ montant */}
        <div className="field">
          <span className="field-label">Avance forfaitaire HT (€)</span>
          <NumInput
            value={avanceRetenue}
            onChange={(v) => {
              // taper décoche : la valeur saisie fait foi sur la proposition
              setAvanceAuto(false)
              setAvance(v)
            }}
            ariaLabel="Avance forfaitaire du marché en euros HT"
          />
          <label
            className="small muted"
            style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={avanceAuto}
              onChange={(e) => {
                setAvanceAuto(e.target.checked)
                // décocher garde le chiffre sous la main : on l'ajuste, on ne le retape pas
                if (!e.target.checked) setAvance(propositionAvance)
              }}
            />
            proposer 5 % du montant initial
            {avanceAuto && propositionAvance === null && ' (montant initial à saisir)'}
          </label>
          <span className="field-hint">
            CCAG art. 13 — versée au démarrage. Le certificat de paiement la résorbe entre 65 % et
            80 % d'avancement ; vide = pas d'avance.
          </span>
        </div>
      </div>
      <div className="form-row">
        <Field
          label="Garantie (CCAG art. 33)"
          hint="caution ou première demande : rien n'est retenu sur les situations"
        >
          <Select
            value={garantie}
            onChange={(v) => setGarantie(v as TypeGarantie)}
            options={[
              { value: 'retenue', label: 'Retenue de garantie' },
              { value: 'caution', label: 'Caution bancaire' },
              { value: 'gpd', label: 'Garantie à première demande' },
            ]}
          />
        </Field>
        <Field
          label="Taux de retenue"
          hint={garantie === 'retenue' ? '5 % par défaut sur les marchés publics' : 'sans effet : le document couvre le marché'}
        >
          <PctInput value={tauxRG} onChange={setTauxRG} ariaLabel="Taux de retenue de garantie en pourcentage" />
        </Field>
        {garantie !== 'retenue' && (
          <Field label="Document reçu le" hint="date de réception de la caution / GPD">
            <DateInput value={garantieRecueLe} onChange={setGarantieRecueLe} />
          </Field>
        )}
      </div>
      <div className="form-row">
        <Field label="Révision de prix">
          <Select
            value={revision}
            onChange={setRevision}
            options={[{ value: 'non', label: 'Non' }, { value: 'oui', label: 'Oui' }]}
          />
        </Field>
        <Field label="Délai de vérification (j)" hint="Délai contractuel MOE sur les situations.">
          <NumInput value={delaiVerif} onChange={setDelaiVerif} />
        </Field>
      </div>
      {revision === 'oui' && (
        <div className="form-row">
          <Field
            label="Indice (CCAP)"
            hint={
              !indiceRevision.trim()
                ? `la série de cette entreprise : BT01, BT02, TP08… — ${
                    seriesConnues.length > 0
                      ? `${seriesConnues.length} séries déjà suivies vous sont proposées`
                      : 'aucune série connue pour l’instant (Paramètres → Indices)'
                  }`
                : dernierIndiceSaisi
                  ? `Série suivie : ${valeursIndiceSaisi.length} valeurs, dernière publiée ${dernierIndiceSaisi.mois}.`
                  : 'Série inconnue du référentiel — elle reste enregistrable, mais la révision restera sans indice tant qu’aucune valeur ne sera publiée (Paramètres → Indices).'
            }
          >
            {/* la liste PROPOSE ce que `state.indicesBTP` connaît ; elle
                n'enferme pas (un CCAP peut citer une série jamais suivie).
                `TextInput` (ui.tsx) ne porte pas d'attribut `list` : l'input
                est écrit ici, aux mêmes classes — même patron que la
                datalist des entreprises ci-dessus. */}
            <input
              className="input"
              type="text"
              list="marche-series-indices"
              value={indiceRevision}
              onChange={(e) => setIndiceRevision(e.target.value)}
              placeholder="BT01"
              aria-label="Série d’indice de révision du CCAP"
            />
            <datalist id="marche-series-indices">
              {seriesConnues.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Mois zéro" hint="mois d'établissement des prix — le I0 de la formule">
            <TextInput value={moisZero} onChange={setMoisZero} placeholder="2025-10" />
          </Field>
          <Field label="Partie fixe" hint="formule CCAP : partie fixe + (1 − partie fixe) × In/I0 — 15 % si vide">
            <PctInput value={partFixe} onChange={setPartFixe} placeholder="15" ariaLabel="Partie fixe de la formule de révision en pourcentage" />
          </Field>
        </div>
      )}
      <div className="form-row">
        <Field label="Pénalité retard (€ HT/jour)" hint="taux du CCAP — vide : l'encouru ne se calcule pas">
          <NumInput value={penRetard} onChange={setPenRetard} ariaLabel="Pénalité de retard d'exécution en euros HT par jour" />
        </Field>
        <Field label="Pénalité absence réunion (€ HT)">
          <NumInput value={penAbsence} onChange={setPenAbsence} ariaLabel="Pénalité d'absence à une réunion de chantier en euros HT" />
        </Field>
        <Field label="Pénalité document (€ HT/jour)" hint="DOE, PPSPS, décomptes, agréments en retard">
          <NumInput value={penDocument} onChange={setPenDocument} ariaLabel="Pénalité de document contractuel en retard en euros HT par jour" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Contact">
          <TextInput value={contactNom} onChange={setContactNom} />
        </Field>
        <Field label="E-mail du contact">
          <TextInput value={contactEmail} onChange={setContactEmail} />
        </Field>
        <Field label="Chantier en cours" hint="Oui = une situation mensuelle est attendue.">
          <Select
            value={actif}
            onChange={setActif}
            options={[{ value: 'non', label: 'Non' }, { value: 'oui', label: 'Oui' }]}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Intervention chantier — début" hint="alimente le planning travaux">
          <DateInput value={dateDebut} onChange={setDateDebut} />
        </Field>
        <Field label="Intervention chantier — fin">
          <DateInput value={dateFin} onChange={setDateFin} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Notes">
          <TextArea value={notes} onChange={setNotes} rows={2} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer} disabled={!valide}>
          {creation ? 'Ajouter le marché' : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  )
}

// ============================================================
// 5.8 — Registre des visas : les documents d'exécution reçus en
// phase VISA, le délai du CCAP qui court, et le geste de visa —
// daté et signé, parce qu'un visa en retard engage la
// responsabilité de la MOE.
// ============================================================

/** tons d'affichage des statuts de visa — le référentiel des libellés
 *  vit dans src/visas.ts, seule la couleur est une affaire d'écran */
const TONE_STATUT_VISA: Record<Visa['statut'], Tone> = {
  a_viser: 'info',
  vise: 'ok',
  vise_observations: 'warn',
  refuse: 'danger',
}

export function CarteVisas({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  // qui signe le visa : même règle que la décision de pénalité — la
  // personne reconnue, à défaut la première de la liste (pas de signature vide)
  const moi = useMoi()
  const signataire = moi.nom ?? state.settings.personnes[0]
  const today = todayISO()
  const [modal, setModal] = useState<{ visa?: Visa } | null>(null)
  const [geste, setGeste] = useState<{ visa: Visa; statut: 'vise_observations' | 'refuse' } | null>(null)

  const marches = state.marches.filter((m) => m.projetId === p.id)
  const visas = state.visas
    .filter((v) => v.projetId === p.id)
    .sort((a, b) => {
      // les visas en attente d'abord, échéance la plus proche en tête —
      // c'est l'ordre dans lequel la responsabilité court
      const attenteA = a.statut === 'a_viser' ? 0 : 1
      const attenteB = b.statut === 'a_viser' ? 0 : 1
      if (attenteA !== attenteB) return attenteA - attenteB
      if (attenteA === 0) return (echeanceVisa(a) || '9999').localeCompare(echeanceVisa(b) || '9999')
      return (b.viseLe || '').localeCompare(a.viseLe || '') || a.id.localeCompare(b.id)
    })
  const marcheDe = (v: Visa) => (v.marcheId ? marches.find((m) => m.id === v.marcheId) : undefined)
  const docDe = (v: Visa) =>
    v.documentId ? state.registreDocuments.find((d) => d.id === v.documentId) : undefined

  const retards = visasEnRetard(visas, today)
  const huitaine = visasSousHuitaine(visas, today)

  /** le geste : statut + date + signature en une seule écriture — un statut
   *  changé sans viseLe/visePar ne prouverait rien le jour où on demande
   *  qui a visé quoi et quand */
  const viser = (v: Visa, statut: Visa['statut'], observations?: string) => {
    const snap = state
    update((d) => {
      const x = d.visas.find((y) => y.id === v.id)
      if (!x) return
      x.statut = statut
      x.viseLe = todayISO()
      x.visePar = signataire
      if (observations !== undefined) x.observations = observations
    })
    toast(`${LIBELLE_STATUT_VISA[statut][0].toUpperCase()}${LIBELLE_STATUT_VISA[statut].slice(1)} — daté et signé « ${signataire} ».`, {
      tone: statut === 'refuse' ? 'warn' : 'ok',
      undo: () => replace(snap),
    })
  }

  const rouvrir = async (v: Visa) => {
    if (
      !(await confirmer({
        message:
          `Rouvrir le visa « ${v.document} » (${LIBELLE_STATUT_VISA[v.statut]} le ${fmtDate(v.viseLe)} par ${v.visePar || '?'}) ?\n` +
          `Le geste sera effacé et le délai du CCAP recommencera à compter depuis la réception.`,
        danger: true,
        confirmerLabel: 'Rouvrir le visa',
      }))
    )
      return
    update((d) => {
      const x = d.visas.find((y) => y.id === v.id)
      if (!x) return
      x.statut = 'a_viser'
      x.viseLe = null
      x.visePar = null
    })
  }

  const supprimer = async (v: Visa) => {
    const snap = state
    if (!(await confirmer({ message: `Retirer « ${v.document} » du registre des visas ?`, danger: true, confirmerLabel: 'Retirer' }))) return
    update((d) => {
      d.visas = d.visas.filter((x) => x.id !== v.id)
    })
    toast('Document retiré du registre.', { undo: () => replace(snap) })
  }

  return (
    <Card
      titre="Visas des documents d'exécution"
      actions={<Btn small kind="primary" onClick={() => setModal({})}>Consigner un document reçu</Btn>}
    >
      <div className="toolbar">
        <span className="small muted">Délai de visa du CCAP (jours calendaires), défaut du projet :</span>
        <NumInput
          value={p.delaiVisaJours ?? null}
          onChange={(v) =>
            update((d) => {
              const x = d.projets.find((y) => y.id === p.id)
              if (x) x.delaiVisaJours = v
            })
          }
          placeholder={String(DELAI_VISA_DEFAUT)}
          style={{ maxWidth: 90 }}
          ariaLabel="Délai de visa par défaut du projet en jours calendaires"
        />
        {(retards.length > 0 || huitaine.length > 0) && (
          <span className="small">
            {retards.length > 0 && <Badge tone="danger">{retards.length} en retard</Badge>}{' '}
            {huitaine.length > 0 && <Badge tone="warn">{huitaine.length} sous huitaine</Badge>}
          </span>
        )}
      </div>
      {visas.length === 0 ? (
        <EmptyState>
          Aucun document consigné — chaque document d'exécution reçu (plans EXE, notes de calcul,
          fiches techniques) entre ici avec sa date de réception : le délai du CCAP court, une
          alerte se lève à J−3, et le visa se signe. Un visa en retard engage la responsabilité de
          la MOE.
        </EmptyState>
      ) : (
        <Table
          compact
          head={['Document', 'Lot / entreprise', 'Reçu le', 'Échéance', 'Statut', '']}
        >
          {visas.map((v) => {
            const m = marcheDe(v)
            const doc = docDe(v)
            const echeance = echeanceVisa(v)
            const dj = echeance ? diffDays(today, echeance) : null
            const enAttente = v.statut === 'a_viser'
            return (
              <tr key={v.id}>
                <td>
                  <strong>{v.document}</strong>
                  {doc && <div className="muted small">au registre : {doc.titre}</div>}
                </td>
                <td className="small">
                  {v.lot}
                  {m && <div className="muted">{m.entreprise}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(v.recuLe)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {echeance ? (
                    <span title={`délai CCAP : ${v.delaiJours} jours calendaires`}>
                      {fmtDate(echeance)}
                      {enAttente && dj !== null && dj < 0 && (
                        <>
                          {' '}
                          <Badge tone="danger">retard de {-dj} j</Badge>
                        </>
                      )}
                      {enAttente && dj !== null && dj >= 0 && dj <= 7 && (
                        <>
                          {' '}
                          <Badge tone="warn">J−{dj}</Badge>
                        </>
                      )}
                    </span>
                  ) : (
                    <span className="muted">?</span>
                  )}
                </td>
                <td>
                  <Badge tone={TONE_STATUT_VISA[v.statut]}>{LIBELLE_STATUT_VISA[v.statut]}</Badge>
                  {v.viseLe && (
                    <div className="muted small">
                      le {fmtDate(v.viseLe)} — {v.visePar || '?'}
                    </div>
                  )}
                  {v.observations && <div className="muted small">{v.observations}</div>}
                </td>
                <td className="right">
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    {enAttente && (
                      <Btn
                        small
                        kind="primary"
                        onClick={() => viser(v, 'vise')}
                        title={`Vise le document sans observation — daté et signé « ${signataire} »`}
                      >
                        Viser
                      </Btn>
                    )}
                    <RowMenu
                      items={[
                        ...(enAttente
                          ? [
                              {
                                label: 'Viser avec observations',
                                onClick: () => setGeste({ visa: v, statut: 'vise_observations' as const }),
                              },
                              {
                                label: 'Refuser le document',
                                onClick: () => setGeste({ visa: v, statut: 'refuse' as const }),
                              },
                              { label: 'Modifier', onClick: () => setModal({ visa: v }) },
                            ]
                          : [{ label: 'Rouvrir le visa (annuler le geste)', onClick: () => void rouvrir(v) }]),
                        { label: 'Retirer du registre', onClick: () => void supprimer(v), danger: true },
                      ]}
                    />
                  </span>
                </td>
              </tr>
            )
          })}
        </Table>
      )}

      {modal && (
        <ModalVisa projet={p} marches={marches} visa={modal.visa} onClose={() => setModal(null)} />
      )}
      {geste && (
        <ModalGesteVisa
          visa={geste.visa}
          statut={geste.statut}
          onConfirmer={(obs) => {
            viser(geste.visa, geste.statut, obs)
            setGeste(null)
          }}
          onClose={() => setGeste(null)}
        />
      )}
    </Card>
  )
}

function ModalVisa({
  projet: p,
  marches,
  visa,
  onClose,
}: {
  projet: Projet
  marches: MarcheTravaux[]
  visa?: Visa
  onClose: () => void
}) {
  const { state, update } = useStore()
  const creation = !visa

  const [marcheId, setMarcheId] = useState(visa?.marcheId || '')
  const [lot, setLot] = useState(visa?.lot || '')
  const [document, setDocument] = useState(visa?.document || '')
  const [recuLe, setRecuLe] = useState<string | null>(visa?.recuLe || todayISO())
  // le défaut du PROJET pré-remplit, le visa peut porter le sien : le CCAP
  // fixe un délai d'opération, mais certains documents ont le leur
  const [delai, setDelai] = useState<number | null>(visa?.delaiJours ?? p.delaiVisaJours ?? DELAI_VISA_DEFAUT)
  const [documentId, setDocumentId] = useState(visa?.documentId || '')

  const docsProjet = state.registreDocuments.filter((d) => d.projetId === p.id)
  const valide = document.trim() !== '' && lot.trim() !== '' && !!recuLe

  const choisirMarche = (id: string) => {
    setMarcheId(id)
    const m = marches.find((x) => x.id === id)
    if (m) setLot(m.lot)
  }

  const enregistrer = () => {
    if (!valide) return
    update((d) => {
      const champs = {
        marcheId: marcheId || null,
        lot: lot.trim(),
        document: document.trim(),
        recuLe: recuLe!,
        delaiJours: delai ?? p.delaiVisaJours ?? DELAI_VISA_DEFAUT,
        documentId: documentId || null,
      }
      if (creation) {
        // le statut naît « à viser » : consigner la réception n'est pas viser
        d.visas.push({ id: uid('visa'), projetId: p.id, statut: 'a_viser', ...champs })
      } else {
        const x = d.visas.find((y) => y.id === visa.id)
        // un visa signé ne se modifie plus sans être rouvert : la date de
        // réception et le délai fondent une échéance déjà opposée
        if (x && x.statut === 'a_viser') Object.assign(x, champs)
      }
    })
    onClose()
  }

  return (
    <Modal titre={creation ? 'Consigner un document reçu' : `Modifier — ${visa.document}`} onClose={onClose}>
      <div className="form-row">
        <Field label="Marché émetteur" hint="facultatif — un document peut précéder la signature du marché">
          <Select
            value={marcheId}
            onChange={choisirMarche}
            options={[
              { value: '', label: '— hors marché —' },
              ...marches.map((m) => ({ value: m.id, label: `${m.lot} — ${m.entreprise}` })),
            ]}
          />
        </Field>
        <Field label="Lot">
          <TextInput value={lot} onChange={setLot} placeholder="Ex. Lot 03 — Charpente" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Document">
          <TextInput value={document} onChange={setDocument} placeholder="Ex. Plans EXE R+1 — indice B" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Reçu le">
          <DateInput value={recuLe} onChange={setRecuLe} />
        </Field>
        <Field label="Délai de visa (jours calendaires)" hint="délai du CCAP — pré-rempli par le défaut du projet">
          <NumInput value={delai} onChange={setDelai} ariaLabel="Délai de visa de ce document en jours calendaires" />
        </Field>
      </div>
      {docsProjet.length > 0 && (
        <div className="form-row">
          <Field label="Pièce au registre documentaire" hint="facultatif — relie le visa au fichier classé">
            <Select
              value={documentId}
              onChange={setDocumentId}
              options={[
                { value: '', label: '— aucune —' },
                ...docsProjet.map((d) => ({ value: d.id, label: d.titre })),
              ]}
            />
          </Field>
        </div>
      )}
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer} disabled={!valide}>
          {creation ? 'Consigner le document' : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  )
}

/** viser avec observations / refuser : le motif s'écrit AVANT le geste —
 *  un refus sans motif n'est pas opposable, et c'est le motif que
 *  l'entreprise lira */
function ModalGesteVisa({
  visa,
  statut,
  onConfirmer,
  onClose,
}: {
  visa: Visa
  statut: 'vise_observations' | 'refuse'
  onConfirmer: (observations: string) => void
  onClose: () => void
}) {
  const [observations, setObservations] = useState(visa.observations || '')
  const refus = statut === 'refuse'
  return (
    <Modal titre={`${refus ? 'Refuser' : 'Viser avec observations'} — ${visa.document}`} onClose={onClose}>
      <Field label={refus ? 'Motif du refus' : 'Observations du visa'}>
        <TextArea
          value={observations}
          onChange={setObservations}
          rows={3}
          placeholder={refus ? 'Ce que l’entreprise doit corriger avant nouvelle présentation…' : 'Réserves à lever, sans bloquer l’exécution…'}
        />
      </Field>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind={refus ? 'danger' : 'primary'} onClick={() => onConfirmer(observations.trim())} disabled={!observations.trim()}>
          {refus ? 'Refuser le document' : 'Viser avec observations'}
        </Btn>
      </div>
    </Modal>
  )
}

// ============================================================
// 5.2 — Pénalités de marché : le journal CONSTATE, le calcul
// chiffre l'encouru, et l'application reste un geste humain
// daté et signé (§15) — jamais un automatisme.
// ============================================================

export function CartePenalites({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  // qui signe la décision : la personne reconnue, à défaut la première de
  // la liste — même règle qu'au registre documentaire (pas de signature vide)
  const moi = useMoi()
  const signataire = moi.nom ?? state.settings.personnes[0]
  const [modal, setModal] = useState<{ evenement?: EvenementMarche } | null>(null)

  const marches = state.marches.filter((m) => m.projetId === p.id)
  const evenements = state.evenementsMarche
    .filter((e) => e.projetId === p.id)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  const marcheDe = (e: EvenementMarche) => marches.find((m) => m.id === e.marcheId)

  // 5.3 — les jours d'intempéries reconnues sur la fenêtre d'intervention
  // du marché : le MÊME chiffre que la prolongation du délai (une seule
  // source, `prolongationDelai`), déduit ici des retards d'exécution — les
  // deux registres se lisent ensemble, sinon on pénalise un retard que la
  // pluie excuse.
  const deductionDe = (m: MarcheTravaux | undefined): number =>
    m ? prolongationDelai(m, state.intemperies) : 0

  const appliquer = async (e: EvenementMarche) => {
    const m = marcheDe(e)
    const encouru = penaliteEncourue(e, m?.penalites, deductionDe(m))
    if (!encouru) return
    if (
      !(await confirmer({
        message:
          `Appliquer la pénalité de ${fmtMoney(encouru.montantHT, true)} HT — ${LIBELLE_EVENEMENT[e.type]}` +
          `${m ? ` (${m.lot} — ${m.entreprise})` : ''} ?\n` +
          `Le montant sera figé et la décision signée « ${signataire} ».\n` +
          // S2 — le message disait « report à la main » alors que le
          // certificat (certificat.ts) déduit DÉJÀ les pénalités appliquées :
          // le suivre faisait payer la pénalité DEUX FOIS à l'entreprise.
          `Elle sera proposée en déduction au prochain certificat de paiement (ligne D) — ` +
          `ne la déduisez pas aussi de la situation.`,
        danger: true,
        confirmerLabel: 'Appliquer la pénalité',
      }))
    )
      return
    update((d) => {
      const x = d.evenementsMarche.find((y) => y.id === e.id)
      if (!x) return
      x.penaliteAppliquee = true
      // FIGÉ : un taux corrigé ou une intempérie saisie après coup ne
      // réécrit pas ce qui a été signifié à l'entreprise
      x.penaliteMontantHT = encouru.montantHT
      x.decidePar = signataire
      x.decideLe = todayISO()
    })
    toast(
      'Pénalité appliquée — montant figé, décision signée. Le prochain certificat la proposera en déduction (ligne D).',
      { tone: 'ok' },
    )
  }

  const annulerApplication = async (e: EvenementMarche) => {
    if (
      !(await confirmer({
        message:
          `Annuler l'application de la pénalité de ${fmtMoney(e.penaliteMontantHT ?? 0, true)} HT ` +
          `(décidée le ${fmtDate(e.decideLe)} par ${e.decidePar || '?'}) ?\nL'événement reste au journal, le montant redevient un simple encouru.`,
        danger: true,
        confirmerLabel: "Annuler l'application",
      }))
    )
      return
    update((d) => {
      const x = d.evenementsMarche.find((y) => y.id === e.id)
      if (!x) return
      x.penaliteAppliquee = false
      x.penaliteMontantHT = null
      x.decidePar = null
      x.decideLe = null
    })
  }

  const supprimer = async (e: EvenementMarche) => {
    const snap = state
    if (
      !(await confirmer({
        message: e.penaliteAppliquee
          ? `Supprimer cet événement ?\nLa pénalité APPLIQUÉE de ${fmtMoney(e.penaliteMontantHT ?? 0, true)} HT disparaîtra du total — préférez « Annuler l'application » pour garder la trace.`
          : 'Supprimer cet événement du journal ?',
        danger: true,
        confirmerLabel: 'Supprimer',
      }))
    )
      return
    update((d) => {
      d.evenementsMarche = d.evenementsMarche.filter((x) => x.id !== e.id)
    })
    toast('Événement supprimé.', { undo: () => replace(snap) })
  }

  // marchés qui ont au moins un événement : la ligne de synthèse par marché
  const marchesAvecEvenements = marches.filter((m) => evenements.some((e) => e.marcheId === m.id))

  return (
    <Card
      titre="Pénalités de marché"
      actions={
        marches.length > 0 && (
          <Btn small kind="primary" onClick={() => setModal({})}>
            Constater un événement
          </Btn>
        )
      }
    >
      {marches.length === 0 ? (
        <EmptyState>
          Ajoutez d'abord les marchés de travaux : les taux de pénalités du CCAP se saisissent
          sur chaque marché, et le journal des événements s'y rattache.
        </EmptyState>
      ) : evenements.length === 0 ? (
        <EmptyState>
          Aucun événement constaté — retard d'exécution, absence à une réunion de chantier, document
          contractuel en retard (DOE, PPSPS…). Le Cockpit chiffre l'encouru d'après les taux du CCAP
          saisis sur le marché ; l'application reste votre décision, datée et signée.
        </EmptyState>
      ) : (
        <>
          <Table
            compact
            head={[
              'Marché',
              'Événement',
              'Date',
              'Jours',
              <span key="e" className="right">Encouru HT</span>,
              'Décision',
              '',
            ]}
          >
            {evenements.map((e) => {
              const m = marcheDe(e)
              const encouru = penaliteEncourue(e, m?.penalites, deductionDe(m))
              return (
                <tr key={e.id}>
                  <td>
                    {m ? (
                      <>
                        <strong>{m.lot}</strong>
                        <div className="muted small">{m.entreprise}</div>
                      </>
                    ) : (
                      <span className="muted">marché supprimé</span>
                    )}
                  </td>
                  <td>
                    {LIBELLE_EVENEMENT[e.type]}
                    {e.type === 'document_retard' && e.document && (
                      <span className="muted"> · {e.document}</span>
                    )}
                    {e.commentaire && <div className="muted small">{e.commentaire}</div>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.date)}</td>
                  <td className="num">
                    {e.type === 'absence_reunion' ? (
                      '—'
                    ) : e.jours == null ? (
                      '?'
                    ) : encouru && encouru.joursDeduits > 0 ? (
                      // 5.3 — la déduction se LIT là où elle agit : « 10 − 3 = 7 j »,
                      // pas un résultat sec dont personne ne saurait d'où il vient
                      <span title={`${encouru.joursDeduits} jour(s) ouvré(s) d'intempéries reconnues sur la fenêtre du marché, déduits du retard (registre ci-dessous)`}>
                        {e.jours} − {encouru.joursDeduits} = {encouru.joursRetenus} j
                      </span>
                    ) : (
                      `${e.jours} j`
                    )}
                  </td>
                  <td className="right">
                    {e.penaliteAppliquee ? (
                      <Money v={e.penaliteMontantHT} cents />
                    ) : encouru ? (
                      <Money v={encouru.montantHT} cents />
                    ) : (
                      // taux non saisi ou jours illisibles : le manque doit se
                      // voir dans la liste, pas se confondre avec « 0 € »
                      <span title="Encouru non calculable : saisissez le taux du CCAP sur le marché (« Modifier ») et les jours de l'événement.">
                        <Badge tone="warn">taux CCAP ?</Badge>
                      </span>
                    )}
                  </td>
                  <td>
                    {e.penaliteAppliquee ? (
                      <span title={`Décision du ${fmtDate(e.decideLe)} — ${e.decidePar || '?'}`}>
                        <Badge tone="danger">appliquée le {fmtDate(e.decideLe)}</Badge>
                      </span>
                    ) : (
                      <Btn
                        small
                        kind="primary"
                        disabled={!encouru}
                        onClick={() => void appliquer(e)}
                        title="Fige le montant encouru et signe la décision — la déduction est ensuite PROPOSÉE au prochain certificat (ligne D) : ne la reprenez pas sur la situation"
                      >
                        Appliquer
                      </Btn>
                    )}
                  </td>
                  <td className="right">
                    <RowMenu
                      items={[
                        ...(e.penaliteAppliquee
                          ? [
                              {
                                label: "Annuler l'application",
                                onClick: () => void annulerApplication(e),
                              },
                            ]
                          : [{ label: 'Modifier l’événement', onClick: () => setModal({ evenement: e }) }]),
                        { label: 'Supprimer l’événement', onClick: () => void supprimer(e), danger: true },
                      ]}
                    />
                  </td>
                </tr>
              )
            })}
          </Table>
          {/* S2 — dit UNE fois, là où l'on décide : la déduction est
              automatique au certificat, la reprendre sur la situation ferait
              payer deux fois (certificat.ts, ligne D) */}
          <p className="muted small" style={{ marginTop: 8 }}>
            Une pénalité appliquée est proposée en déduction du prochain certificat de paiement
            (ligne D), une seule fois : ne la déduisez pas en plus de la situation de l'entreprise.
          </p>
          {marchesAvecEvenements.length > 0 && (
            <p className="muted small" style={{ marginTop: 8 }}>
              {marchesAvecEvenements.map((m) => (
                <span key={m.id} style={{ display: 'block' }}>
                  {m.lot} — {m.entreprise} : encouru{' '}
                  <strong>{fmtMoney(totalEncouruMarche(evenements, m.id, m.penalites, deductionDe(m)), true)}</strong> HT
                  {' · '}appliqué <strong>{fmtMoney(totalAppliqueMarche(evenements, m.id), true)}</strong> HT
                </span>
              ))}
            </p>
          )}
        </>
      )}

      {modal && (
        <ModalEvenement
          projetId={p.id}
          marches={marches}
          evenement={modal.evenement}
          onClose={() => setModal(null)}
        />
      )}
    </Card>
  )
}

function ModalEvenement({
  projetId,
  marches,
  evenement,
  onClose,
}: {
  projetId: string
  marches: MarcheTravaux[]
  evenement?: EvenementMarche
  onClose: () => void
}) {
  const { update } = useStore()
  const creation = !evenement

  const [marcheId, setMarcheId] = useState(evenement?.marcheId || marches[0]?.id || '')
  const [type, setType] = useState<TypeEvenementMarche>(evenement?.type || 'retard_execution')
  const [date, setDate] = useState<string | null>(evenement?.date || todayISO())
  const [jours, setJours] = useState<number | null>(evenement?.jours ?? null)
  const [doc, setDoc] = useState(evenement?.document || '')
  const [commentaire, setCommentaire] = useState(evenement?.commentaire || '')

  const valide = marcheId !== '' && !!date

  const enregistrer = () => {
    if (!valide) return
    update((d) => {
      const champs = {
        marcheId,
        type,
        date: date!,
        // une absence de réunion ne se compte pas en jours : ne pas garder
        // une saisie faite avant un changement de type
        jours: type === 'absence_reunion' ? null : jours,
        document: type === 'document_retard' ? doc.trim() || undefined : undefined,
        commentaire: commentaire.trim(),
      }
      if (creation) {
        // penaliteAppliquee naît FAUX : constater n'est pas décider (§15)
        d.evenementsMarche.push({ id: uid('evt'), projetId, penaliteAppliquee: false, ...champs })
      } else {
        const e = d.evenementsMarche.find((x) => x.id === evenement.id)
        // un événement appliqué ne se modifie plus : sa pénalité est figée
        if (e && !e.penaliteAppliquee) Object.assign(e, champs)
      }
    })
    onClose()
  }

  return (
    <Modal titre={creation ? 'Constater un événement' : 'Modifier l’événement'} onClose={onClose}>
      <div className="form-row">
        <Field label="Marché">
          <Select
            value={marcheId}
            onChange={setMarcheId}
            options={marches.map((m) => ({ value: m.id, label: `${m.lot} — ${m.entreprise}` }))}
          />
        </Field>
        <Field label="Événement (CCAG art. 19-20)">
          <Select
            value={type}
            onChange={(v) => setType(v as TypeEvenementMarche)}
            options={(Object.keys(LIBELLE_EVENEMENT) as TypeEvenementMarche[]).map((t) => ({
              value: t,
              label: LIBELLE_EVENEMENT[t],
            }))}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Date du constat">
          <DateInput value={date} onChange={setDate} />
        </Field>
        {type !== 'absence_reunion' && (
          <Field label="Jours de retard" hint="l'encouru = jours × taux du CCAP saisi sur le marché">
            <NumInput value={jours} onChange={setJours} ariaLabel="Jours de retard constatés" />
          </Field>
        )}
        {type === 'document_retard' && (
          <Field label="Document">
            <TextInput value={doc} onChange={setDoc} placeholder="DOE, PPSPS, agrément, décompte…" />
          </Field>
        )}
      </div>
      <div className="form-row">
        <Field label="Commentaire" hint="le constat tel qu'il sera opposable : réunion, OS, courrier…">
          <TextArea value={commentaire} onChange={setCommentaire} rows={2} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer} disabled={!valide}>
          {creation ? 'Consigner l’événement' : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  )
}

// ============================================================
// 5.3 — Registre des intempéries : des jours datés, constatés,
// opposables. Double effet, affiché là où il agit : prolongation
// du délai des marchés (ici) et déduction des retards (journal
// des pénalités ci-dessus) — même chiffre, même fonction.
// ============================================================

/** garde-fou de saisie : au-delà, ce n'est plus un épisode d'intempéries
 *  mais une date mal tapée — 90 jours couvrent un hiver entier */
const MAX_JOURS_PERIODE = 90

/** les jours OUVRÉS d'une période, bornes incluses. L'énumération s'appuie
 *  sur `estJourOuvre` (src/penalites.ts), seule autorité du dépôt sur « un
 *  samedi n'est pas un jour de chantier » — le décompte affiché ici est donc
 *  exactement celui que `prolongationDelai` retiendra. */
function joursOuvresEntre(debut: string, fin: string): string[] {
  const jours: string[] = []
  let j = debut
  while (j <= fin && jours.length <= MAX_JOURS_PERIODE) {
    if (estJourOuvre(j)) jours.push(j)
    j = addDays(j, 1)
  }
  return jours
}

export function CarteIntemperies({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const [date, setDate] = useState<string | null>(todayISO())
  // 5.3 — la période : une semaine de gel se consigne d'un geste au lieu de
  // cinq. Vide = un seul jour (le geste d'avant, inchangé).
  const [dateFin, setDateFin] = useState<string | null>(null)
  const [nature, setNature] = useState<NatureIntemperie>('pluie')
  const [commentaire, setCommentaire] = useState('')
  // ... et le même gel arrête TOUS les chantiers : la case évite de rouvrir
  // chaque projet pour retaper les mêmes jours
  const [aussiAutres, setAussiAutres] = useState(false)

  const intemperies = state.intemperies
    .filter((i) => i.projetId === p.id)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))

  // l'effet « prolongation » se lit sur les marchés dont la fenêtre
  // d'intervention est posée — les autres n'ont pas de période à confronter
  const marchesAvecFenetre = state.marches.filter(
    (m) => m.projetId === p.id && (m.dateDebut || m.dateFin),
  )

  // « les autres chantiers en cours » : les projets qui ont au moins un
  // marché actif — le MÊME critère que « Chantier en cours » du marché, celui
  // qui fait attendre une situation mensuelle
  const autresChantiers = state.projets.filter(
    (x) => x.id !== p.id && state.marches.some((m) => m.projetId === x.id && m.actif),
  )

  // les jours qui seront consignés : un seul (bornes égales ou fin vide) ou
  // les jours ouvrés de la période — jamais les week-ends, qui ne comptent ni
  // dans la prolongation ni dans la déduction
  const periode = Boolean(date && dateFin && dateFin > date)
  const joursASaisir: string[] = !date ? [] : periode ? joursOuvresEntre(date, dateFin!) : [date]
  const tropLongue = Boolean(periode && diffDays(date!, dateFin!) + 1 > MAX_JOURS_PERIODE)
  const projetsVises = aussiAutres ? [p, ...autresChantiers] : [p]

  const ajouter = () => {
    if (!date) return
    if (dateFin && dateFin < date) {
      toast('La fin de période précède son début.', { tone: 'danger' })
      return
    }
    if (tropLongue) {
      toast(`Période trop longue (plus de ${MAX_JOURS_PERIODE} jours) — consignez mois par mois.`, {
        tone: 'danger',
      })
      return
    }
    if (joursASaisir.length === 0) {
      toast('Aucun jour ouvré dans cette période — rien à consigner.', { tone: 'warn' })
      return
    }
    // ce qui sera écrit se décide AVANT l'écriture, sur l'état lisible ici :
    // un même (chantier, jour, nature) ne se consigne pas deux fois — le
    // registre est une trace opposable, pas un journal de clics
    const nouveaux: Intemperie[] = []
    let deja = 0
    for (const pr of projetsVises) {
      for (const j of joursASaisir) {
        if (state.intemperies.some((i) => i.projetId === pr.id && i.date === j && i.nature === nature)) {
          deja++
          continue
        }
        nouveaux.push({
          id: uid('intemp'),
          projetId: pr.id,
          date: j,
          nature,
          commentaire: commentaire.trim(),
        })
      }
    }
    if (nouveaux.length === 0) {
      toast('Ces jours sont déjà au registre — rien de nouveau consigné.', { tone: 'warn' })
      return
    }
    const snap = state
    update((d) => {
      d.intemperies.push(...nouveaux)
    })
    setCommentaire('')
    toast(
      `${nouveaux.length} jour${nouveaux.length > 1 ? 's' : ''} consigné${nouveaux.length > 1 ? 's' : ''}` +
        (projetsVises.length > 1 ? ` sur ${projetsVises.length} chantiers` : '') +
        (deja > 0 ? ` — ${deja} déjà au registre, ignoré${deja > 1 ? 's' : ''}` : '') +
        '.',
      { tone: 'ok', undo: () => replace(snap) },
    )
  }

  const supprimer = (i: (typeof intemperies)[number]) => {
    const snap = state
    update((d) => {
      d.intemperies = d.intemperies.filter((x) => x.id !== i.id)
    })
    toast('Jour d’intempérie retiré du registre.', { undo: () => replace(snap) })
  }

  return (
    <Card titre="Registre des intempéries">
      <div className="toolbar">
        <span className="small muted">du</span>
        <DateInput value={date} onChange={setDate} style={{ maxWidth: 160 }} />
        <span className="small muted">au</span>
        <DateInput value={dateFin} onChange={setDateFin} style={{ maxWidth: 160 }} />
        <Select
          value={nature}
          onChange={(v) => setNature(v as NatureIntemperie)}
          options={(Object.keys(LIBELLE_INTEMPERIE) as NatureIntemperie[]).map((n) => ({
            value: n,
            label: LIBELLE_INTEMPERIE[n],
          }))}
          style={{ maxWidth: 140 }}
        />
        <TextInput
          value={commentaire}
          onChange={setCommentaire}
          placeholder="Constat opposable : seuil du CCAP atteint, CR n°…, relevé météo…"
          style={{ maxWidth: 360 }}
        />
        <Btn small kind="primary" onClick={ajouter} disabled={!date}>
          {periode ? `Consigner ${joursASaisir.length} jour${joursASaisir.length > 1 ? 's' : ''}` : 'Consigner le jour'}
        </Btn>
      </div>
      <div
        className="small"
        style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}
      >
        {autresChantiers.length > 0 && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={aussiAutres}
              onChange={(e) => setAussiAutres(e.target.checked)}
            />
            <span>
              appliquer aussi aux {autresChantiers.length} autre
              {autresChantiers.length > 1 ? 's' : ''} chantier{autresChantiers.length > 1 ? 's' : ''} en
              cours{' '}
              <span className="muted" title={autresChantiers.map((x) => x.nom).join(', ')}>
                ({autresChantiers.map((x) => x.id).join(', ')})
              </span>
            </span>
          </label>
        )}
        <span className="muted">
          {!date
            ? 'Indiquez la date du constat.'
            : tropLongue
              ? `Période de plus de ${MAX_JOURS_PERIODE} jours : à consigner mois par mois.`
              : periode
                ? `${fmtDate(date)} → ${fmtDate(dateFin)} : ${joursASaisir.length} jour${joursASaisir.length > 1 ? 's' : ''} ouvré${joursASaisir.length > 1 ? 's' : ''} (week-ends ignorés)` +
                  (projetsVises.length > 1
                    ? ` × ${projetsVises.length} chantiers = ${joursASaisir.length * projetsVises.length} lignes`
                    : '')
                : "« au » vide : un seul jour. Une semaine d'arrêt se consigne d'un geste en renseignant la fin."}
        </span>
      </div>
      {intemperies.length === 0 ? (
        <EmptyState>
          Aucun jour consigné — chaque jour d'intempérie (seuils du CCAP) prolonge le délai
          contractuel des marchés et se déduit des retards du journal de pénalités : c'est la trace
          opposable du décompte général.
        </EmptyState>
      ) : (
        <>
          <Table compact head={['Date', 'Nature', 'Commentaire', '']}>
            {intemperies.map((i) => (
              <tr key={i.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fmtDate(i.date)}
                  {!estJourOuvre(i.date) && (
                    <>
                      {' '}
                      {/* consigné quand même (le constat est vrai), mais dit :
                          un samedi ne prolonge pas un délai en jours ouvrés */}
                      <span title="Jour non ouvré : consigné pour mémoire, il ne compte ni dans la prolongation ni dans la déduction des retards">
                        <Badge tone="muted">week-end — non compté</Badge>
                      </span>
                    </>
                  )}
                </td>
                <td>{LIBELLE_INTEMPERIE[i.nature]}</td>
                <td>{i.commentaire || <span className="muted">—</span>}</td>
                <td className="right">
                  <RowMenu
                    items={[{ label: 'Retirer ce jour', onClick: () => supprimer(i), danger: true }]}
                  />
                </td>
              </tr>
            ))}
          </Table>
          {marchesAvecFenetre.length > 0 && (
            <p className="muted small" style={{ marginTop: 8 }}>
              Prolongation du délai contractuel (jours ouvrés distincts sur la fenêtre
              d'intervention — CCAG art. 19.2.3) :{' '}
              {marchesAvecFenetre.map((m, idx) => (
                <span key={m.id}>
                  {idx > 0 && ' · '}
                  {m.lot} <strong>+{prolongationDelai(m, state.intemperies)} j</strong>
                </span>
              ))}
              . Le même chiffre se déduit des retards d'exécution du journal de pénalités.
            </p>
          )}
          <p className="muted small" style={{ marginTop: 4 }}>
            Deux natures le même jour comptent UN jour. Un jour isolé se consigne même le week-end
            (pour mémoire) ; sur une période, les week-ends ne sont pas consignés — dans les deux cas
            ils ne comptent pas.
          </p>
        </>
      )}
    </Card>
  )
}

// ============================================================
// 5.9 — GPA : l'année de parfait achèvement. Le registre trace
// (signalement, notification, relances, levée), le compte à
// rebours lit la MÊME fin de GPA que la levée de la RG
// (src/gpa.ts), et les gestes restent humains : « Relancer »
// ouvre un brouillon Gmail, « Mettre en demeure » copie un
// prompt — rien ne part tout seul (§15).
// ============================================================

const TONE_STATUT_DESORDRE: Record<DesordreGPA['statut'], Tone> = {
  signale: 'warn',
  notifie_entreprise: 'info',
  leve: 'ok',
  conteste: 'danger',
}

/** corps de secours quand l'état ne porte pas encore le gabarit du seed
 *  (états d'avant le livrable : `prompts` n'est pas re-fusionné au
 *  chargement) — même trame courte que le fallback de l'assistant CR */
const MED_GPA_SECOURS = `Projet de mise en demeure — année de parfait achèvement (CCAG Travaux art. 44.1) — {{date}}.

{{fiche_marche}}

Désordre à lever :
{{desordre}}

Signalé le {{desordre_signale_le}} ; relances : {{desordre_relances}} ; fin de GPA : {{fin_gpa}}.

Rédige un courrier de MISE EN DEMEURE (courrier recommandé, pas un e-mail) : obligation de parfait achèvement (art. 1792-6 du code civil), chronologie datée du signalement et des relances, délai d'exécution avant intervention d'une entreprise tierce aux frais de l'entreprise défaillante. Ton strictement factuel — je relis avant tout envoi.`

export function CarteGPA({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const moi = useMoi()
  const signataire = moi.nom ?? state.settings.personnes[0]
  const today = todayISO()
  const [modal, setModal] = useState<{ desordre?: DesordreGPA } | null>(null)
  const [modele, setModele] = useState(false)

  const marches = state.marches.filter((m) => m.projetId === p.id)
  // le compte à rebours ne se lit que sur les marchés RÉCEPTIONNÉS : avant
  // la réception, la GPA n'a pas commencé — afficher un décompte serait faux
  const recus = marches.filter((m) => m.dateReception)
  const desordres = state.desordresGPA
    .filter((e) => e.projetId === p.id)
    .sort((a, b) => {
      const ouvertA = a.statut === 'leve' ? 1 : 0
      const ouvertB = b.statut === 'leve' ? 1 : 0
      if (ouvertA !== ouvertB) return ouvertA - ouvertB
      return b.signaleLe.localeCompare(a.signaleLe) || a.id.localeCompare(b.id)
    })
  const ouverts = desordresOuverts(desordres)
  const marcheDe = (e: DesordreGPA) => (e.marcheId ? marches.find((m) => m.id === e.marcheId) : undefined)
  const gabaritMED = state.prompts.find((t) => t.id === 'tpl-med-gpa')

  const maj = (id: string, fn: (x: DesordreGPA) => void) =>
    update((d) => {
      const x = d.desordresGPA.find((y) => y.id === id)
      if (x) fn(x)
    })

  /** « Relancer » : le brouillon s'ouvre, la relance se TRACE au même clic —
   *  c'est la chronologie datée qui rend la mise en demeure opposable.
   *  L'envoi, lui, reste le clic « Envoyer » de Gmail (§15). */
  const relancer = (e: DesordreGPA) => {
    const m = marcheDe(e)
    const fin = m ? finGPA(m.dateReception ?? null) : null
    ouvrirGmail(
      m?.contactEmail || '',
      `${p.id} — ${e.lot || m?.lot || 'GPA'} : désordre à lever (parfait achèvement)`,
      `Bonjour,\n\nLe désordre suivant, signalé le ${fmtDate(e.signaleLe)} sur l'opération ${p.nom}, n'est pas levé à ce jour :\n\n« ${e.description} »\n\nAu titre de la garantie de parfait achèvement${fin ? ` (qui court jusqu'au ${fmtDate(fin)})` : ''}, merci de nous indiquer sous 8 jours la date de votre intervention.\n\nCordialement,\n${state.settings.nomAgence}`,
    )
    update((d) => {
      const idx = d.desordresGPA.findIndex((y) => y.id === e.id)
      if (idx >= 0) d.desordresGPA[idx] = avecRelance(d.desordresGPA[idx], todayISO(), 'e-mail')
    })
  }

  /** « Mettre en demeure » : un PROMPT copié, pas un courrier envoyé — le
   *  gabarit du seed (tpl-med-gpa) porte le fondement GPA ; celui des
   *  honoraires (tpl-relance-med) réclamerait de l'argent au lieu d'exiger
   *  la levée. Sans marché rattaché, pas de destinataire : bouton inerte. */
  const mettreEnDemeure = async (e: DesordreGPA) => {
    const m = marcheDe(e)
    if (!m) return
    const ctx = {
      ...contexteMarche(state, m),
      desordre: e.description,
      desordre_signale_le: fmtDate(e.signaleLe),
      desordre_relances: e.relances.length
        ? e.relances.map((r) => `${fmtDate(r.date)} (${r.mode})`).join(', ')
        : 'aucune tracée',
      fin_gpa: m.dateReception ? fmtDate(finGPA(m.dateReception)) : '',
    }
    const ok = await copier(assemble(gabaritMED ? gabaritMED.corps : MED_GPA_SECOURS, ctx))
    toast(
      ok
        ? `Prompt de mise en demeure copié — collez-le dans le Projet Claude « ${gabaritMED?.projetClaude || 'Secrétariat'} », relisez, envoyez en recommandé.`
        : 'Copie impossible — ouvrez l’écran Prompts pour assembler la mise en demeure.',
      { tone: ok ? 'ok' : 'danger' },
    )
  }

  const supprimer = async (e: DesordreGPA) => {
    const snap = state
    if (!(await confirmer({ message: 'Retirer ce désordre du registre ?\nSa chronologie de relances sera perdue.', danger: true, confirmerLabel: 'Retirer' }))) return
    update((d) => {
      d.desordresGPA = d.desordresGPA.filter((x) => x.id !== e.id)
    })
    toast('Désordre retiré du registre.', { undo: () => replace(snap) })
  }

  return (
    <Card
      titre="GPA — année de parfait achèvement"
      actions={
        <>
          <Btn
            small
            onClick={() => setModele(true)}
            title="Aperçu décochable des tâches types de l'année de GPA (visite M+11, relances, mises en demeure) — rien n'est créé sans votre coche"
          >
            Préparer l'année de GPA (modèle)
          </Btn>
          <Btn small kind="primary" onClick={() => setModal({})}>Signaler un désordre</Btn>
        </>
      }
    >
      {recus.length > 0 && (
        <p className="small" style={{ marginTop: 0 }}>
          {recus.map((m) => {
            const jours = joursAvantFinGPA(m.dateReception ?? null, today)
            const fin = finGPA(m.dateReception ?? null)
            if (jours === null || !fin) return null
            return (
              <span key={m.id} style={{ display: 'block' }}>
                {m.lot} — {m.entreprise} : réception le {fmtDate(m.dateReception)}, fin de GPA le {fmtDate(fin)}{' '}
                {jours < 0 ? (
                  <Badge tone="muted">échue depuis {-jours} j</Badge>
                ) : (
                  // sous 60 jours, c'est la fenêtre de la visite M+11 et des
                  // dernières mises en demeure utiles : rouge
                  <Badge tone={jours <= 60 ? 'danger' : jours <= 120 ? 'warn' : 'ok'}>J−{jours}</Badge>
                )}
              </span>
            )
          })}
        </p>
      )}
      {desordres.length === 0 ? (
        <EmptyState>
          Aucun désordre signalé — pendant l'année qui suit la réception, chaque désordre se
          consigne ici : signalement daté, notification à l'entreprise, relances tracées, levée.
          Passé la fin de GPA, plus rien n'est opposable — la visite à M+11 (modèle ci-dessus)
          existe pour constater avant l'échéance.
        </EmptyState>
      ) : (
        <>
          <Table compact head={['Désordre', 'Lot / entreprise', 'Signalé', 'Statut', 'Relances', '']}>
            {desordres.map((e) => {
              const m = marcheDe(e)
              return (
                <tr key={e.id}>
                  <td>
                    {e.description}
                    {e.leveLe && <div className="muted small">levé le {fmtDate(e.leveLe)}</div>}
                  </td>
                  <td className="small">
                    {e.lot || m?.lot || <span className="muted">—</span>}
                    {m && <div className="muted">{m.entreprise}</div>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {fmtDate(e.signaleLe)}
                    {e.signalePar && <div className="muted small">par {e.signalePar}</div>}
                  </td>
                  <td>
                    <Badge tone={TONE_STATUT_DESORDRE[e.statut]}>{LIBELLE_STATUT_DESORDRE[e.statut]}</Badge>
                    {e.notifieLe && e.statut !== 'leve' && (
                      <div className="muted small">notifié le {fmtDate(e.notifieLe)}</div>
                    )}
                  </td>
                  <td className="small">
                    {e.relances.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      <span title={e.relances.map((r) => `${fmtDate(r.date)} — ${r.mode}`).join('\n')}>
                        {e.relances.length} · dern. {fmtDate(e.relances[e.relances.length - 1].date)}
                      </span>
                    )}
                  </td>
                  <td className="right">
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      {e.statut === 'signale' && (
                        <Btn
                          small
                          kind="primary"
                          onClick={() => {
                            maj(e.id, (x) => {
                              x.statut = 'notifie_entreprise'
                              x.notifieLe = todayISO()
                            })
                            toast('Notification datée — le délai de l’entreprise court.', { tone: 'ok' })
                          }}
                          title="Date la notification à l'entreprise : c'est le point de départ de son délai"
                        >
                          Notifier
                        </Btn>
                      )}
                      {e.statut !== 'leve' && (
                        <Btn
                          small
                          onClick={() => {
                            maj(e.id, (x) => {
                              x.statut = 'leve'
                              x.leveLe = todayISO()
                            })
                            toast('Levée constatée et datée.', { tone: 'ok' })
                          }}
                          title="Constate la levée du désordre, datée du jour"
                        >
                          Levé
                        </Btn>
                      )}
                      <RowMenu
                        items={[
                          ...(e.statut !== 'leve'
                            ? [
                                {
                                  label: 'Relancer l’entreprise (brouillon Gmail)',
                                  title: 'Ouvre un brouillon pré-rempli et trace la relance — l’envoi reste votre clic',
                                  onClick: () => relancer(e),
                                },
                                {
                                  label: 'Mettre en demeure (prompt à coller)',
                                  title: m
                                    ? 'Copie le prompt de mise en demeure (CCAG art. 44.1) — relecture humaine, envoi en recommandé'
                                    : 'Rattachez d’abord le désordre à un marché : une mise en demeure a un destinataire',
                                  onClick: () => {
                                    if (!m) {
                                      toast('Rattachez d’abord le désordre à un marché (« Modifier ») : une mise en demeure a un destinataire.', { tone: 'warn' })
                                      return
                                    }
                                    void mettreEnDemeure(e)
                                  },
                                },
                                {
                                  label: e.statut === 'conteste' ? 'Lever la contestation (re-notifié)' : 'Marquer contesté par l’entreprise',
                                  onClick: () =>
                                    maj(e.id, (x) => {
                                      x.statut = e.statut === 'conteste' ? (x.notifieLe ? 'notifie_entreprise' : 'signale') : 'conteste'
                                    }),
                                },
                                { label: 'Modifier', onClick: () => setModal({ desordre: e }) },
                              ]
                            : [
                                {
                                  label: 'Rouvrir (désordre non levé)',
                                  onClick: () =>
                                    maj(e.id, (x) => {
                                      x.statut = x.notifieLe ? 'notifie_entreprise' : 'signale'
                                      x.leveLe = null
                                    }),
                                },
                              ]),
                          { label: 'Retirer du registre', onClick: () => void supprimer(e), danger: true },
                        ]}
                      />
                    </span>
                  </td>
                </tr>
              )
            })}
          </Table>
          <p className="muted small" style={{ marginTop: 8 }}>
            {ouverts.length} désordre{ouverts.length > 1 ? 's' : ''} ouvert{ouverts.length > 1 ? 's' : ''} — un
            désordre contesté RESTE ouvert : seule la levée constatée le ferme.
          </p>
        </>
      )}

      {modal && (
        <ModalDesordreGPA
          projet={p}
          marches={marches}
          signataire={signataire}
          desordre={modal.desordre}
          onClose={() => setModal(null)}
        />
      )}
      {modele && <ModalModeleGPA projet={p} signataire={signataire} onClose={() => setModele(false)} />}
    </Card>
  )
}

function ModalDesordreGPA({
  projet: p,
  marches,
  signataire,
  desordre,
  onClose,
}: {
  projet: Projet
  marches: MarcheTravaux[]
  signataire: string
  desordre?: DesordreGPA
  onClose: () => void
}) {
  const { update } = useStore()
  const creation = !desordre

  const [marcheId, setMarcheId] = useState(desordre?.marcheId || '')
  const [lot, setLot] = useState(desordre?.lot || '')
  const [description, setDescription] = useState(desordre?.description || '')
  const [signaleLe, setSignaleLe] = useState<string | null>(desordre?.signaleLe || todayISO())
  const [signalePar, setSignalePar] = useState(desordre?.signalePar || signataire)

  const valide = description.trim() !== '' && !!signaleLe

  const choisirMarche = (id: string) => {
    setMarcheId(id)
    const m = marches.find((x) => x.id === id)
    if (m) setLot(m.lot)
  }

  const enregistrer = () => {
    if (!valide) return
    update((d) => {
      const champs = {
        marcheId: marcheId || null,
        lot: lot.trim() || undefined,
        description: description.trim(),
        signaleLe: signaleLe!,
        signalePar: signalePar.trim() || undefined,
      }
      if (creation) {
        // le statut naît « signalé » : notifier l'entreprise est un geste
        // à part, daté — c'est lui qui fait courir le délai
        d.desordresGPA.push({ id: uid('gpa'), projetId: p.id, statut: 'signale', relances: [], ...champs })
      } else {
        const x = d.desordresGPA.find((y) => y.id === desordre.id)
        if (x) Object.assign(x, champs)
      }
    })
    onClose()
  }

  return (
    <Modal titre={creation ? 'Signaler un désordre (GPA)' : 'Modifier le désordre'} onClose={onClose}>
      <div className="form-row">
        <Field label="Marché concerné" hint="facultatif tant que l'entreprise n'est pas identifiée — requis pour la mise en demeure">
          <Select
            value={marcheId}
            onChange={choisirMarche}
            options={[
              { value: '', label: '— à déterminer —' },
              ...marches.map((m) => ({ value: m.id, label: `${m.lot} — ${m.entreprise}` })),
            ]}
          />
        </Field>
        <Field label="Lot">
          <TextInput value={lot} onChange={setLot} placeholder="Ex. Lot 08 — Menuiseries ext." />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Désordre constaté">
          <TextArea value={description} onChange={setDescription} rows={2} placeholder="Ex. Infiltration en plafond du séjour, angle nord-ouest…" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Signalé le">
          <DateInput value={signaleLe} onChange={setSignaleLe} />
        </Field>
        <Field label="Signalé par" hint="MOA, occupant, visite MOE…">
          <TextInput value={signalePar} onChange={setSignalePar} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer} disabled={!valide}>
          {creation ? 'Consigner le désordre' : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  )
}

/** le modèle « Année de parfait achèvement » appliqué par le moteur B.13 :
 *  APERÇU décochable, puis création des seules lignes retenues — une ligne
 *  décochée ne produit RIEN (ni tâche annulée, ni tâche masquée). */
function ModalModeleGPA({
  projet: p,
  signataire,
  onClose,
}: {
  projet: Projet
  signataire: string
  onClose: () => void
}) {
  const { update } = useStore()
  const modele = MODELES_AMORCE.find((m) => m.id === 'modele-gpa')

  // le contexte d'application : débuts de phase connus du projet, rôles
  // résolus à l'application (le modèle nomme une place, pas une personne)
  const debutDePhase: Partial<Record<PhaseCode, string>> = {}
  for (const ph of p.phases) if (ph.debut) debutDePhase[ph.code] = ph.debut
  const ctx: ContexteApplication = {
    projetId: p.id,
    debutDePhase,
    responsable: p.responsable ?? null,
    coResponsable: p.coResponsable ?? null,
  }

  // l'aperçu se calcule UNE fois à l'ouverture : recalculer à chaque rendu
  // re-cocherait les lignes que l'utilisatrice vient de décocher
  const [apercu] = useState(() => (modele ? appliquerModele(modele, ctx) : []))
  const [retenues, setRetenues] = useState<Set<string>>(
    () => new Set(apercu.filter((l) => l.retenueParDefaut).map((l) => l.ligneId)),
  )

  if (!modele) return null

  const basculer = (ligneId: string) =>
    setRetenues((prev) => {
      const suivant = new Set(prev)
      if (suivant.has(ligneId)) suivant.delete(ligneId)
      else suivant.add(ligneId)
      return suivant
    })

  const creer = () => {
    const taches = tachesDepuisApercu(apercu, retenues, ctx, signataire)
    if (taches.length === 0) return
    update((d) => {
      d.taches.push(...taches)
    })
    toast(`${taches.length} tâche${taches.length > 1 ? 's' : ''} créée${taches.length > 1 ? 's' : ''} — à retrouver dans l'écran Tâches.`, { tone: 'ok' })
    onClose()
  }

  return (
    <Modal titre={`${modele.nom} — aperçu avant création`} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>
        {modele.perimetre}. Les dates se comptent depuis le début d'AOR (la réception s'y prononce) —
        décochez ce qui ne s'applique pas : une ligne décochée ne crée rien.
      </p>
      <Table compact head={['', 'Tâche', 'Échéance', 'Responsable', 'Priorité']}>
        {apercu.map((l) => (
          <tr key={l.ligneId}>
            <td>
              <input
                type="checkbox"
                checked={retenues.has(l.ligneId)}
                onChange={() => basculer(l.ligneId)}
                aria-label={`Retenir « ${l.libelle} »`}
              />
            </td>
            <td>{l.libelle}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {l.echeance ? (
                fmtDate(l.echeance)
              ) : (
                <span className="muted" title="Sans début d'AOR posé au planning, le décalage ne se calcule pas — la ligne est décochée d'office">
                  début d'AOR inconnu
                </span>
              )}
            </td>
            <td>{l.responsable || <span className="muted">—</span>}</td>
            <td className="small">{l.priorite}</td>
          </tr>
        ))}
      </Table>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={creer} disabled={retenues.size === 0}>
          Créer {retenues.size} tâche{retenues.size > 1 ? 's' : ''}
        </Btn>
      </div>
    </Modal>
  )
}

// ============================================================
// Réunions de chantier & assistant CR
// ============================================================

const LIBELLE_STATUT: Record<StatutReunion, { label: string; tone: Tone }> = {
  a_preparer: { label: 'à venir', tone: 'muted' },
  cr_a_generer: { label: 'CR à générer', tone: 'warn' },
  cr_a_relire: { label: 'CR à relire', tone: 'warn' },
  diffuse: { label: 'CR diffusé', tone: 'ok' },
}

/** S2 — le badge de la ligne : le statut stocké, lu AVEC la date. Une réunion
 *  de la semaine prochaine affichée « CR à générer » en orange, c'est un
 *  retard qui n'existe pas — et un badge qui crie pour rien finit ignoré, y
 *  compris le jour où il dit vrai. Symétriquement, une réunion passée restée
 *  « à préparer » ne s'annonce pas « à venir » : elle dit ce que dit déjà
 *  l'alerte de l'accueil (alerts.ts) — le CR est à sortir. */
function badgeReunion(r: ReunionChantier, today: string): { label: string; tone: Tone; title?: string } {
  if (r.statut !== 'a_preparer') return LIBELLE_STATUT[r.statut]
  if (r.date > today)
    return { label: 'à venir', tone: 'muted', title: `Réunion du ${fmtDate(r.date)} — rien à sortir avant` }
  if (r.date === today)
    return { label: 'aujourd’hui', tone: 'info', title: 'Réunion du jour — déposez l’enregistrement à la sortie' }
  return {
    label: 'CR à générer',
    tone: 'warn',
    title: 'Réunion passée restée « à préparer » : le CR n’a pas encore été produit',
  }
}

function participantsParDefaut(state: ReturnType<typeof useStore>['state'], p: Projet): string {
  const lignes = [
    `MOE : ${state.settings.nomAgence} (${state.settings.personnes.join(', ')})`,
    p.moa ? `MOA : ${p.moa}` : null,
    ...state.marches
      .filter((m) => m.projetId === p.id)
      .map((m) => `${m.lot} : ${m.entreprise}${m.contactNom ? ` (${m.contactNom})` : ''}`),
  ]
  return lignes.filter(Boolean).join('\n')
}

/** C3 — le gabarit d'impression (`ouvrirPreparationReunionPDF`, src/pdf.ts)
 *  imprime CE relevé, et il ne le refait pas : il appelle `preparerSeance`,
 *  exactement comme ce bloc.
 *
 *  C'était déjà l'intention du lot C — « deux lectures de la même autorité
 *  ne peuvent pas diverger ; deux calculs, si » — mais l'écran et le papier
 *  portaient chacun LEUR filtre, et le commentaire jumeau ne tenait que par
 *  la discipline. Ils n'en ont plus qu'un, et il vit dans
 *  `src/seanceChantier.ts` : le rangement des points, le report de ce qui
 *  n'est pas résolu, le comptage de l'ancienneté et les propositions de la
 *  machine sortent de la MÊME fonction. Si le filtre bouge, il bouge des
 *  deux côtés parce qu'il n'existe qu'une fois. (Le commentaire jumeau est
 *  dans src/pdf.ts.) */

/** C3 — LE RELEVÉ DE SÉANCE, en lieu et place du bloc « Préparer la
 *  réunion » du lot C.
 *
 *  Ce que l'agence a refusé, mot pour mot : « je ne vois pas où créer ça, le
 *  modifier, etc. Il faudrait que ça soit à la limite une version du CR
 *  précédent, ajusté. Il faudrait pouvoir faire une sorte de to-do
 *  améliorée, où on garde tout mais où tout se range en fonction de ce qui
 *  est fait ou non. » Elle a raison : le bloc précédent assemblait des
 *  chiffres EN LECTURE. Un tableau de bord n'est pas un ordre du jour.
 *
 *  Ici, tout se fait sans quitter l'écran : inscrire un point, le corriger,
 *  changer son état (LE geste de la réunion — une liste, un choix), accepter
 *  ou écarter ce que la machine propose, un par un. Chaque geste laisse un
 *  « Annuler ».
 *
 *  Ce bloc REMPLACE la préparation, il ne s'ajoute pas à côté : l'agence ne
 *  veut pas deux endroits, et elle a raison une seconde fois — deux endroits
 *  pour la même question, c'est deux réponses possibles. */
function ReleveSeance({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const today = todayISO()
  // UNE seule autorité : l'ordre du jour, le rangement, l'ancienneté et les
  // propositions viennent tous de src/seanceChantier.ts — rien n'est
  // recalculé ici, et le papier lit exactement la même fonction
  const ordre = preparerSeance(state, p.id, { maintenant: today })
  const marches = state.marches.filter((m) => m.projetId === p.id)

  const [edition, setEdition] = useState<PointSeance | null>(null)
  // la ligne de saisie : quatre champs, toujours à la même place, jamais une
  // modale — inscrire un point est le deuxième geste le plus fréquent de la
  // séance, et il doit coûter une frappe et une touche Entrée
  const [libelle, setLibelle] = useState('')
  const [marcheId, setMarcheId] = useState('')
  const [qui, setQui] = useState('')
  const [echeance, setEcheance] = useState<string | null>(null)

  const optionsLot = [
    { value: '', label: '— aucun lot —' },
    ...marches.map((m) => ({ value: m.id, label: `${m.lot} · ${m.entreprise}` })),
  ]

  const contexte = (): ContexteGeste => ({
    id: uid('pts'),
    projetId: p.id,
    maintenant: today,
    // le point naît à la séance qu'on prépare quand il y en a une : c'est
    // elle qui datera son ancienneté aux séances suivantes
    reunionId: ordre.seance ? ordre.seance.id : null,
  })

  const ajouter = () => {
    if (!libelle.trim()) return
    const snap = state
    const point = pointNouveau(
      { libelle, marcheId: marcheId || null, responsable: qui, echeance },
      contexte(),
    )
    update((d) => {
      d.pointsSeance.push(point)
    })
    setLibelle('')
    setQui('')
    setEcheance(null)
    toast(`Point inscrit à l’ordre du jour : « ${point.libelle} ».`, {
      tone: 'ok',
      undo: () => replace(snap),
    })
  }

  /** LE geste de la réunion. Une seule écriture, donc un seul « Annuler ». */
  const changerEtat = (point: PointSeance, etat: EtatPointSeance) => {
    if (etat === point.etat) return
    const snap = state
    const suivant = pointAvecEtat(point, etat, today)
    update((d) => {
      const i = d.pointsSeance.findIndex((x) => x.id === point.id)
      if (i >= 0) d.pointsSeance[i] = suivant
    })
    toast(`« ${point.libelle} » → ${LIBELLE_ETAT_POINT[etat]}.`, {
      tone: etat === 'fait' ? 'ok' : undefined,
      undo: () => replace(snap),
    })
  }

  /** accepter (« à traiter ») ou écarter (« sans suite ») une proposition,
   *  UNE PAR UNE. Écarter n'efface rien : le point entre au relevé, rangé
   *  tout en bas, avec la date à laquelle on a décidé de ne pas le suivre —
   *  et il se rouvre d'un geste. « Vu et écarté » n'est pas « jamais vu ». */
  const trancher = (proposition: PropositionSeance, etat: EtatPointSeance) => {
    const snap = state
    const point = pointDepuisProposition(proposition, contexte(), etat)
    update((d) => {
      d.pointsSeance.push(point)
    })
    toast(
      etat === 'sans_suite'
        ? `« ${proposition.libelle} » écarté — rangé « sans suite » au relevé, jamais perdu.`
        : `« ${proposition.libelle} » inscrit à l’ordre du jour.`,
      { tone: etat === 'sans_suite' ? undefined : 'ok', undo: () => replace(snap) },
    )
  }

  const supprimer = async (point: PointSeance) => {
    const snap = state
    if (
      !(await confirmer({
        message: `Supprimer « ${point.libelle} » du relevé ?\nPour ranger un point sans le perdre, « sans suite » suffit.`,
        danger: true,
        confirmerLabel: 'Supprimer',
      }))
    )
      return
    update((d) => {
      d.pointsSeance = d.pointsSeance.filter((x) => x.id !== point.id)
    })
    toast('Point supprimé du relevé.', { undo: () => replace(snap) })
  }

  const imprimer = () => ouvrirPreparationReunionPDF(state, p, today, ordre.seance)

  const libelleLot = (point: PointSeance): string => {
    const m = marches.find((x) => x.id === point.marcheId)
    return m ? `${m.lot} · ${m.entreprise}` : point.lot || ''
  }

  const ouverts = ordre.nbParEtat.a_traiter + ordre.nbParEtat.en_cours

  return (
    <div
      style={{
        border: '1.5px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'var(--bg-soft)',
        padding: '12px 14px',
        marginBottom: 14,
      }}
    >
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <strong>Relevé de séance</strong>
        <span className="small muted">
          {ordre.seance
            ? `prochaine séance le ${fmtDate(ordre.seance.date)}${ordre.seance.heure ? ` à ${ordre.seance.heure}` : ''}`
            : 'aucune séance programmée — « Nouvelle réunion » ci-dessus'}
          {ordre.seancePrecedente && (
            <>
              {' '}· repris de « {ordre.seancePrecedente.titre} » du {fmtDate(ordre.seancePrecedente.date)}
            </>
          )}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {ouverts > 0 && (
            <Badge tone={ordre.quiTrainent > 0 ? 'warn' : 'info'}>
              {ouverts} ouvert{ouverts > 1 ? 's' : ''}
              {ordre.quiTrainent > 0 &&
                `, dont ${ordre.quiTrainent} qui traîne${ordre.quiTrainent > 1 ? 'nt' : ''}`}
            </Badge>
          )}
          <Btn
            small
            onClick={imprimer}
            title="Ouvre le relevé imprimable (Ctrl+P pour le PDF) — même ordre du jour, même rangement, même ancienneté"
          >
            Imprimer le relevé
          </Btn>
        </span>
      </div>

      {/* ce que la MACHINE propose — hors du relevé tant que personne n'a
          tranché : rien ne s'inscrit tout seul (§15) */}
      {ordre.propositions.length > 0 && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--panel)',
            padding: '9px 11px',
            marginBottom: 10,
          }}
        >
          <div className="small" style={{ marginBottom: 4 }}>
            <strong>
              Le cockpit propose {ordre.propositions.length} point{ordre.propositions.length > 1 ? 's' : ''}
            </strong>{' '}
            <span className="muted">
              — relus des registres de cet onglet (visas, pénalités, parfait achèvement, planning). Rien ne
              s’inscrit sans vous.
            </span>
          </div>
          {ordre.propositions.map((prop) => (
            <div
              key={prop.cle}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '6px 0',
                borderTop: '1px solid var(--line)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div className="small">{prop.libelle}</div>
                <div className="muted small">{prop.detail}</div>
              </div>
              <span style={{ display: 'inline-flex', gap: 6 }}>
                <Btn
                  small
                  kind="primary"
                  onClick={() => trancher(prop, 'a_traiter')}
                  title="Inscrire ce point à l’ordre du jour"
                >
                  Inscrire
                </Btn>
                <Btn
                  small
                  onClick={() => trancher(prop, 'sans_suite')}
                  title="Écarter : le point entre au relevé « sans suite » — la décision est tracée, et elle se rouvre d’un geste"
                >
                  Écarter
                </Btn>
              </span>
            </div>
          ))}
        </div>
      )}

      <Table compact head={['Point', 'Lot / entreprise', 'Qui', 'Pour le', 'État', '']}>
        {ordre.groupes.map((g) => (
          <Fragment key={g.etat + g.libelle}>
            <tr>
              <td colSpan={6} style={{ background: 'var(--bg-soft)', fontWeight: 700 }}>
                {g.libelle} ({g.entrees.length})
              </td>
            </tr>
            {g.entrees.map((e) => {
              const point = e.point
              const lot = libelleLot(point)
              const enRetard = !pointResolu(point) && Boolean(point.echeance) && point.echeance! < today
              return (
                <tr key={point.id} style={pointResolu(point) ? { opacity: 0.68 } : undefined}>
                  <td>
                    <div>{point.libelle}</div>
                    <div
                      className="small"
                      style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
                    >
                      {!pointResolu(point) && e.anciennete > 1 && (
                        <span
                          title={`Inscrit le ${fmtDate(point.inscritLe)} — il revient à l’ordre du jour pour la ${libelleAnciennete(e.anciennete)}`}
                        >
                          <Badge tone={e.traine ? 'warn' : 'muted'}>{libelleAnciennete(e.anciennete)}</Badge>
                        </span>
                      )}
                      {pointResolu(point) && point.resoluLe && (
                        <span className="muted">
                          {point.etat === 'fait' ? 'fait le' : 'écarté le'} {fmtDate(point.resoluLe)}
                        </span>
                      )}
                      {point.notes && <span className="muted">{point.notes}</span>}
                    </div>
                  </td>
                  <td className="small">{lot || <span className="muted">—</span>}</td>
                  <td className="small">
                    {point.responsable || (
                      // « null n'est pas 0 » : personne n'a été désigné, et un
                      // point sans responsable ne se fait jamais tout seul
                      <span
                        className="muted"
                        title="Personne n’a été désigné — c’est justement ce qui se décide en séance"
                      >
                        ?
                      </span>
                    )}
                  </td>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>
                    {point.echeance ? (
                      <span
                        className={enRetard ? 'danger-text' : undefined}
                        title={enRetard ? 'Échéance dépassée' : undefined}
                      >
                        {fmtDate(point.echeance)}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {/* LE geste de la réunion : une liste, un choix, et le
                        relevé se range tout seul. Pas quatre boutons par
                        ligne — un écran qui gagne une option et perd en
                        lisibilité est un échec. */}
                    <Select
                      value={point.etat}
                      onChange={(v) => changerEtat(point, v as EtatPointSeance)}
                      options={ORDRE_ETATS_POINT.map((etat) => ({
                        value: etat,
                        label: LIBELLE_ETAT_POINT[etat],
                      }))}
                      style={{ minWidth: 116 }}
                    />
                  </td>
                  <td className="right">
                    <RowMenu
                      items={[
                        { label: 'Modifier le point', onClick: () => setEdition(point) },
                        { label: 'Supprimer du relevé', danger: true, onClick: () => void supprimer(point) },
                      ]}
                    />
                  </td>
                </tr>
              )
            })}
          </Fragment>
        ))}

        {/* la ligne de saisie, dans les mêmes colonnes que le relevé */}
        <tr>
          <td colSpan={6} style={{ background: 'var(--bg-soft)', fontWeight: 700 }}>
            inscrire un point
          </td>
        </tr>
        <tr>
          <td>
            <TextInput
              value={libelle}
              onChange={setLibelle}
              placeholder="Ce qu’il y a à dire, à faire ou à décider"
              ariaLabel="Libellé du point"
            />
          </td>
          <td>
            <Select value={marcheId} onChange={setMarcheId} options={optionsLot} />
          </td>
          <td>
            <TextInput value={qui} onChange={setQui} placeholder="Qui agit" ariaLabel="Qui doit agir" />
          </td>
          <td>
            <DateInput value={echeance} onChange={setEcheance} />
          </td>
          <td colSpan={2} className="right">
            <Btn small kind="primary" onClick={ajouter} disabled={!libelle.trim()}>
              Inscrire
            </Btn>
          </td>
        </tr>
      </Table>

      <p className="muted small" style={{ margin: '8px 0 0' }}>
        Le relevé PRÉPARE le compte rendu et lui SURVIT : les points non résolus passent d’eux-mêmes à la
        séance suivante — ils appartiennent à l’opération, pas à une réunion — et leur ancienneté se compte
        toute seule. Le CR, lui, reste le document d’UNE séance : il se rédige et se diffuse depuis
        l’assistant, ci-dessous.
      </p>

      {edition && (
        <ModalPointSeance
          projet={p}
          point={state.pointsSeance.find((x) => x.id === edition.id) || edition}
          onClose={() => setEdition(null)}
        />
      )}
    </div>
  )
}

/** corriger un point : son libellé, son rattachement, son responsable, son
 *  échéance. L'état ne passe PAS par ici — il a son geste, plus rapide, dans
 *  la ligne du relevé. */
function ModalPointSeance({
  projet: p,
  point,
  onClose,
}: {
  projet: Projet
  point: PointSeance
  onClose: () => void
}) {
  const { state, update, replace } = useStore()
  const today = todayISO()
  const marches = state.marches.filter((m) => m.projetId === p.id)
  const [libelle, setLibelle] = useState(point.libelle)
  const [marcheId, setMarcheId] = useState(point.marcheId || '')
  const [lot, setLot] = useState(point.lot || '')
  const [responsable, setResponsable] = useState(point.responsable || '')
  const [echeance, setEcheance] = useState<string | null>(point.echeance || null)

  const enregistrer = () => {
    if (!libelle.trim()) return toast('Le libellé ne peut pas être vide.', { tone: 'danger' })
    const snap = state
    const suivant = pointCorrige(
      point,
      { libelle, marcheId: marcheId || null, lot: marcheId ? '' : lot, responsable, echeance },
      today,
    )
    update((d) => {
      const i = d.pointsSeance.findIndex((x) => x.id === point.id)
      if (i >= 0) d.pointsSeance[i] = suivant
    })
    toast('Point mis à jour.', { tone: 'ok', undo: () => replace(snap) })
    onClose()
  }

  return (
    <Modal titre="Modifier le point" onClose={onClose}>
      <Field label="Point">
        <TextInput value={libelle} onChange={setLibelle} />
      </Field>
      <div className="form-row">
        <Field label="Lot / entreprise">
          <Select
            value={marcheId}
            onChange={setMarcheId}
            options={[
              { value: '', label: '— aucun lot —' },
              ...marches.map((m) => ({ value: m.id, label: `${m.lot} · ${m.entreprise}` })),
            ]}
          />
        </Field>
        {!marcheId && (
          <Field label="… ou à la main" hint="bureau de contrôle, concessionnaire, lot non attribué">
            <TextInput value={lot} onChange={setLot} />
          </Field>
        )}
      </div>
      <div className="form-row">
        <Field label="Qui doit agir" hint="c’est ce qui s’écrit au compte rendu">
          <TextInput value={responsable} onChange={setResponsable} />
        </Field>
        <Field label="Pour le" hint="facultatif — beaucoup de points n’ont pas d’échéance">
          <DateInput value={echeance} onChange={setEcheance} />
        </Field>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Inscrit le {fmtDate(point.inscritLe)}
        {point.origine ? ' · proposé par le cockpit' : ''} — cette date ne bouge pas : c’est elle qui porte
        l’ancienneté du point.
      </p>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer}>
          Enregistrer
        </Btn>
      </div>
    </Modal>
  )
}

export function CarteReunions({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const today = todayISO()
  const [assistant, setAssistant] = useState<{ reunion: ReunionChantier; fichier?: File } | null>(null)
  const [reprog, setReprog] = useState<ReunionChantier | null>(null)
  const [lectureCR, setLectureCR] = useState<ReunionChantier | null>(null)
  const [nouvelle, setNouvelle] = useState(false)

  const reunions = state.reunions
    .filter((r) => r.projetId === p.id)
    .sort((a, b) => b.date.localeCompare(a.date))

  // C3 — « quelle est la prochaine séance ? » ne se décide plus ici : c'est
  // `preparerSeance` (src/seanceChantier.ts) qui répond, pour l'écran comme
  // pour le papier. La règle était écrite deux fois — ici et dans le
  // gabarit d'impression — pour un seul jour où elles auraient divergé.

  const titreParDefaut = `Réunion de chantier n°${reunions.length + 1}`

  /** dépôt d'un enregistrement : la réunion a EU LIEU, elle naît donc avec
   *  son CR à générer et l'assistant s'ouvre sur la transcription */
  const creer = (fichier?: File) => {
    const reunion: ReunionChantier = {
      id: uid('reu'),
      projetId: p.id,
      date: today,
      heure: '14:00',
      titre: titreParDefaut,
      participants: participantsParDefaut(state, p),
      statut: 'cr_a_generer',
    }
    update((d) => {
      d.reunions.push(reunion)
    })
    setAssistant({ reunion, fichier })
  }

  /** réunion posée à l'agenda : c'est la DATE qui décide du statut de départ
   *  (S2). À venir → « à préparer », et l'assistant ne s'ouvre pas : il n'y a
   *  rien à transcrire avant qu'elle ait eu lieu. */
  const creerPlanifiee = (champs: { date: string; heure: string; titre: string }) => {
    const snap = state
    const aVenir = champs.date > today
    const reunion: ReunionChantier = {
      id: uid('reu'),
      projetId: p.id,
      date: champs.date,
      heure: champs.heure || undefined,
      titre: champs.titre.trim() || titreParDefaut,
      participants: participantsParDefaut(state, p),
      statut: aVenir ? 'a_preparer' : 'cr_a_generer',
    }
    update((d) => {
      d.reunions.push(reunion)
    })
    setNouvelle(false)
    if (aVenir) {
      toast(`« ${reunion.titre} » créée pour le ${fmtDate(reunion.date)} — à préparer.`, {
        tone: 'ok',
        undo: () => replace(snap),
      })
    } else {
      setAssistant({ reunion })
    }
  }

  const supprimer = async (r: ReunionChantier) => {
    const snap = state
    if (
      !(await confirmer({
        message: `Supprimer « ${r.titre} » ?${r.cr ? '\nLe CR conservé sur la réunion sera supprimé avec elle.' : ''}`,
        danger: true,
        confirmerLabel: 'Supprimer',
      }))
    )
      return
    update((d) => {
      d.reunions = d.reunions.filter((x) => x.id !== r.id)
    })
    toast('Réunion supprimée.', { undo: () => replace(snap) })
  }

  return (
    <Card
      titre="Réunions de chantier & comptes-rendus"
      actions={
        <>
          <label className="btn btn-small btn-primary" style={{ cursor: 'pointer' }}>
            🎙 Déposer l'enregistrement
            <input
              type="file"
              accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) creer(f)
                e.target.value = ''
              }}
            />
          </label>
          <Btn small onClick={() => setNouvelle(true)}>Nouvelle réunion</Btn>
        </>
      }
    >
      {/* C3 — en TÊTE de la carte : l'ordre du jour se tient avant la liste
          des CR passés, qui est de l'archive. C'est ici qu'on travaille en
          séance, et c'est le SEUL endroit — il n'y a plus de bloc de
          préparation à côté. */}
      <ReleveSeance projet={p} />

      {reunions.length === 0 ? (
        <EmptyState>
          Après chaque réunion, un seul geste : « 🎙 Déposer l'enregistrement » — la réunion se crée, la
          transcription démarre, le prompt se copie tout seul, et le DOCX final part dans le Drive.
        </EmptyState>
      ) : (
        <Table compact head={['Réunion', 'Quand', 'Statut', 'CR', '']}>
          {reunions.map((r) => {
            const badge = badgeReunion(r, today)
            return (
              <tr key={r.id}>
                <td>
                  <strong>{r.titre}</strong>
                  {r.notes && <div className="muted small">{r.notes}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fmtDate(r.date)}
                  {r.heure && <span className="mono"> · {r.heure}</span>}
                </td>
                <td>
                  <span title={badge.title}>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </span>
                </td>
                <td>
                  {r.cr ? (
                    <Btn small kind="ghost" onClick={() => setLectureCR(r)}>Voir le CR</Btn>
                  ) : (
                    <span className="muted small">—</span>
                  )}
                </td>
                <td className="right">
                  <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Btn small onClick={() => setReprog(r)} title="Changer la date ou l'heure en un geste">
                      Reprogrammer
                    </Btn>
                    <Btn small kind={r.statut === 'diffuse' ? 'default' : 'primary'} onClick={() => setAssistant({ reunion: r })}>
                      {r.statut === 'diffuse' ? 'Rouvrir' : r.statut === 'a_preparer' && r.date > today ? 'Préparer' : 'Assistant CR'}
                    </Btn>
                    {/* « Supprimer » rangé comme partout ailleurs : un bouton
                        rouge à nu au bout de chaque ligne se clique un jour */}
                    <RowMenu
                      items={[
                        { label: 'Supprimer la réunion', danger: true, onClick: () => void supprimer(r) },
                      ]}
                    />
                  </span>
                </td>
              </tr>
            )
          })}
        </Table>
      )}

      {assistant && (
        <AssistantCR
          projet={p}
          reunion={state.reunions.find((r) => r.id === assistant.reunion.id) || assistant.reunion}
          fichierInitial={assistant.fichier}
          onClose={() => setAssistant(null)}
        />
      )}
      {nouvelle && (
        <ModalNouvelleReunion
          titreParDefaut={titreParDefaut}
          today={today}
          onValider={creerPlanifiee}
          onClose={() => setNouvelle(false)}
        />
      )}
      {reprog && <ModalReprogrammation reunion={reprog} onClose={() => setReprog(null)} />}
      {lectureCR && (
        <ModalCR
          reunion={state.reunions.find((r) => r.id === lectureCR.id) || lectureCR}
          onClose={() => setLectureCR(null)}
        />
      )}
    </Card>
  )
}

/** poser une réunion à l'agenda : date, heure, titre — trois champs. La date
 *  décide du statut de départ (S2), c'est la seule raison d'être de cette
 *  modale plutôt que d'une création silencieuse au jour même. */
function ModalNouvelleReunion({
  titreParDefaut,
  today,
  onValider,
  onClose,
}: {
  titreParDefaut: string
  today: string
  onValider: (champs: { date: string; heure: string; titre: string }) => void
  onClose: () => void
}) {
  const [date, setDate] = useState<string | null>(today)
  const [heure, setHeure] = useState('14:00')
  const [titre, setTitre] = useState(titreParDefaut)
  const aVenir = Boolean(date && date > today)

  return (
    <Modal titre="Nouvelle réunion de chantier" onClose={onClose}>
      <div className="form-row">
        <Field label="Titre">
          <TextInput value={titre} onChange={setTitre} />
        </Field>
        <Field label="Date">
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label="Heure">
          <input
            className="input"
            type="time"
            value={heure}
            onChange={(e) => setHeure(e.target.value)}
            aria-label="Heure de la réunion"
          />
        </Field>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        {aVenir
          ? 'Réunion à venir : elle naît « à préparer » — pas de CR réclamé avant qu’elle ait eu lieu. Les convoqués sont repris des marchés et de la MOA.'
          : 'Réunion du jour ou passée : l’assistant CR s’ouvre pour la transcription et le compte-rendu.'}
      </p>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn
          kind="primary"
          disabled={!date}
          onClick={() => date && onValider({ date, heure, titre })}
        >
          {aVenir ? 'Créer la réunion' : 'Créer et ouvrir l’assistant'}
        </Btn>
      </div>
    </Modal>
  )
}

/** reprogrammation « dernière minute » : date + heure, rien d'autre */
function ModalReprogrammation({ reunion, onClose }: { reunion: ReunionChantier; onClose: () => void }) {
  const { update } = useStore()
  const today = todayISO()
  const [date, setDate] = useState<string | null>(reunion.date)
  const [heure, setHeure] = useState(reunion.heure || '')

  const enregistrer = () => {
    if (!date) return toast('Indiquer la date.', { tone: 'danger' })
    // S2 — le statut suit la date tant qu'aucun CR n'existe : reporter une
    // réunion à la semaine prochaine ne doit pas laisser un « CR à générer »
    // orange derrière soi, et la ramener à hier ne doit pas la laisser
    // « à venir ». Dès qu'un CR est écrit, on ne touche plus à rien.
    const bascule =
      !reunion.cr && reunion.statut === 'cr_a_generer' && date > today
        ? 'a_preparer'
        : !reunion.cr && reunion.statut === 'a_preparer' && date <= today
          ? 'cr_a_generer'
          : null
    update((d) => {
      const r = d.reunions.find((x) => x.id === reunion.id)
      if (!r) return
      r.date = date
      r.heure = heure || undefined
      if (bascule) r.statut = bascule
    })
    toast(
      `« ${reunion.titre} » reprogrammée au ${fmtDate(date)}${heure ? ` à ${heure}` : ''}` +
        (bascule === 'a_preparer' ? ' — à préparer' : bascule === 'cr_a_generer' ? ' — CR à générer' : '') +
        '.',
      { tone: 'ok' },
    )
    onClose()
  }

  return (
    <Modal titre={`Reprogrammer — ${reunion.titre}`} onClose={onClose}>
      <div className="form-row">
        <Field label="Date">
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label="Heure">
          <input className="input" type="time" value={heure} onChange={(e) => setHeure(e.target.value)} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer}>Reprogrammer</Btn>
      </div>
    </Modal>
  )
}

/** le CR vit sur la réunion : lisible, corrigeable, copiable — jamais perdu */
function ModalCR({ reunion, onClose }: { reunion: ReunionChantier; onClose: () => void }) {
  const { update } = useStore()
  const [texte, setTexte] = useState(reunion.cr || '')

  const enregistrer = () => {
    update((d) => {
      const r = d.reunions.find((x) => x.id === reunion.id)
      if (r) r.cr = texte.trim() || undefined
    })
    toast('CR enregistré sur la réunion.', { tone: 'ok' })
    onClose()
  }

  return (
    <Modal titre={`CR — ${reunion.titre} (${fmtDate(reunion.date)}${reunion.heure ? ` · ${reunion.heure}` : ''})`} onClose={onClose} large>
      <TextArea rows={16} mono value={texte} onChange={setTexte} />
      <div className="form-foot">
        <CopyBtn text={() => texte} label="Copier le CR" kind="default" />
        <span className="spacer" />
        <Btn onClick={onClose}>Fermer</Btn>
        <Btn kind="primary" onClick={enregistrer}>Enregistrer</Btn>
      </div>
    </Modal>
  )
}

/** Assistant CR — 4 étapes guidées, de l'audio au CR diffusé */

/** le circuit CR en 4 étapes lisibles — dérivé du statut persistant de la
 *  réunion : fermer et rouvrir la modale reprend exactement où on en était */
function EtapesCR({ statut }: { statut: StatutReunion }) {
  const etapes: { id: StatutReunion; label: string }[] = [
    { id: 'a_preparer', label: '1 · Réunion & convocation' },
    { id: 'cr_a_generer', label: '2 · Audio → CR' },
    { id: 'cr_a_relire', label: '3 · Relecture du DOCX' },
    { id: 'diffuse', label: '4 · Diffusion' },
  ]
  const courant = etapes.findIndex((e) => e.id === statut)
  return (
    <p className="small" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 0 10px' }}>
      {etapes.map((e, i) => (
        <span
          key={e.id}
          className={`badge ${i < courant ? 'badge-ok' : i === courant ? 'badge-info' : 'badge-muted'}`}
          aria-current={i === courant ? 'step' : undefined}
        >
          {i < courant ? '✓ ' : ''}{e.label}
        </span>
      ))}
    </p>
  )
}

function AssistantCR({
  projet: p,
  reunion,
  fichierInitial,
  onClose,
}: {
  projet: Projet
  reunion: ReunionChantier
  fichierInitial?: File
  onClose: () => void
}) {
  const { state, update } = useStore()
  const [transcript, setTranscript] = useState('')
  const [modele, setModele] = useState(MODELES_WHISPER[0].id)
  const [progres, setProgres] = useState<ProgresTranscription | null>(null)
  const [erreurAudio, setErreurAudio] = useState('')
  const [retourClaude, setRetourClaude] = useState('')
  const [messageDocx, setMessageDocx] = useState('')
  const enCours = progres !== null
  const fichierLance = useRef(false)

  useEffect(() => {
    if (fichierInitial && !fichierLance.current) {
      fichierLance.current = true
      void transcrire(fichierInitial)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const transcrire = async (file: File) => {
    setErreurAudio('')
    const dureeSuspecte = file.size > 250 * 1024 * 1024
    if (
      dureeSuspecte &&
      !(await confirmer({
        message:
          'Fichier volumineux : pour une réunion de plus de ~1 h 30, préférez un enregistrement mono compressé (m4a) ou coupez le fichier en deux. Tenter quand même ?',
        danger: true,
        confirmerLabel: 'Tenter quand même',
      }))
    )
      return
    setProgres({ etape: 'Préparation…' })
    try {
      const texte = await transcrireFichier(file, modele, setProgres)
      const complet = (transcript.trim() ? transcript + '\n\n' : '') + texte
      setTranscript(complet)
      if (reunion.statut === 'a_preparer') maj((r) => { r.statut = 'cr_a_generer' })
      // le prompt complet part tout seul dans le presse-papier : il ne reste qu'à le coller dans Claude
      if (await copier(construirePrompt(complet))) {
        setMessageDocx('Transcription terminée — le prompt CR est DÉJÀ dans votre presse-papier : collez-le dans le Projet Claude, puis rapportez sa réponse ci-dessous.')
      }
    } catch (e) {
      setErreurAudio(
        `Transcription impossible : ${e instanceof Error ? e.message : String(e)} — vous pouvez transcrire avec un outil local (MacWhisper, Vibe) et coller le texte ci-dessous.`,
      )
    } finally {
      setProgres(null)
    }
  }

  const maj = (fn: (r: ReunionChantier) => void) =>
    update((d) => {
      const r = d.reunions.find((x) => x.id === reunion.id)
      if (r) fn(r)
    })

  const gabarit = state.prompts.find((t) => t.id === 'tpl-cr-chantier')

  const construirePrompt = (texteTranscript?: string): string => {
    const t = (texteTranscript ?? transcript).trim()
    const ctx = contexteProjet(state, p)
    let corps = gabarit
      ? assemble(gabarit.corps, ctx)
      : `Compte-rendu de la réunion de chantier — ${p.nom} (${p.id}).\n\n${ctx.fiche}\n\nDictée brute :\n« ⟦coller ou dicter ici⟧ »`
    const blocReunion = [
      `Réunion : ${reunion.titre} du ${fmtDate(reunion.date)}.`,
      `Convoqués :`,
      reunion.participants,
      '',
    ].join('\n')
    corps = blocReunion + '\n' + corps
    if (t) corps = corps.replace('« ⟦coller ou dicter ici⟧ »', t)
    corps += `\n\nIMPORTANT — la transcription est automatique et peut contenir des erreurs : corrige les noms propres d'après la liste des convoqués et le contexte. La mise en page est gérée par le Cockpit : termine ta réponse par UN SEUL bloc de code json strictement conforme à ce format (le Cockpit fabriquera le DOCX officiel) :\n\n\`\`\`json\n${CONTRAT_CR}\n\`\`\``
    return corps
  }

  const fabriquerDocx = async () => {
    setMessageDocx('')
    const { retour, erreur } = parseRetourCR(retourClaude)
    if (erreur || !retour) {
      setMessageDocx(`Impossible de lire le retour : ${erreur}`)
      return
    }
    try {
      const blob = await genererDocxCR(state.settings, p, reunion, retour)
      const nom = nomConforme(p, 'CR', reunion.titre, 'cr.docx')
      const file = new File([blob], nom, { type: blob.type })
      let rangement: ResultatRangement | null = null
      if (supporteFS) {
        const racine = await lireRacine()
        if (racine) rangement = await rangerFichier(racine, p, '07_CHANTIER', file, nom)
      }
      const chemin = rangement?.chemin || ''
      if (!chemin) {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = nom
        a.click()
        URL.revokeObjectURL(url)
      }
      // registre documentaire : le CR généré devient traçable (calculé
      // AVANT la mutation — le producteur clone pour rester rejouable)
      const docPret = creerDocument({
        titre: rangement?.nomFinal || nom,
        nomOriginal: nom,
        source: 'genere',
        categorie: 'CR',
        typeMime: file.type || undefined,
        taille: file.size,
        empreinteSha256: rangement?.empreinte || (await empreinteSha256(file)) || undefined,
        cheminDrive: chemin || undefined,
        projetId: p.id,
        reunionId: reunion.id,
        dateDocument: reunion.date,
        statut: 'classe',
      })
      const texteCR = retourVersTexte(retour)
      update((d) => {
        const { doc, doublon } = enregistrerDocument(d, structuredClone(docPret))
        const r = d.reunions.find((x) => x.id === reunion.id)
        if (r) {
          // un CR régénéré REMPLACE le précédent (versions sûres, rien d'écrasé)
          const ancien = r.crDocumentId ? d.registreDocuments.find((x) => x.id === r.crDocumentId) : undefined
          if (ancien && ancien.id !== doc.id && !doublon) remplacerDocument(ancien, doc)
          r.statut = 'cr_a_relire'
          // le texte du CR reste sur la réunion : relisible et cherchable plus tard
          r.cr = texteCR
          r.crDocumentId = doc.id
        }
      })
      setRetourClaude('')
      setMessageDocx(
        chemin
          ? `DOCX fabriqué et rangé dans le Drive : ${chemin} — relisez avant diffusion.`
          : 'DOCX fabriqué et téléchargé (configurez le Drive dans l’onglet Documents pour le rangement automatique) — relisez avant diffusion.',
      )
    } catch (e) {
      setMessageDocx(`Fabrication impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <Modal titre={`Assistant CR — ${reunion.titre} (${p.id})`} onClose={onClose} large>
      {/* le circuit en étapes : l'avancement vit sur la RÉUNION (statut),
          donc fermer la modale ne perd rien — on reprend où on s'était arrêté */}
      <EtapesCR statut={reunion.statut} />
      <div className="form-row">
        <Field label="Titre">
          <TextInput value={reunion.titre} onChange={(v) => maj((r) => { r.titre = v })} />
        </Field>
        <Field label="Date de la réunion">
          <input
            className="input"
            type="date"
            value={reunion.date}
            onChange={(e) => maj((r) => { r.date = e.target.value || todayISO() })}
          />
        </Field>
        <Field label="Heure">
          <input
            className="input"
            type="time"
            value={reunion.heure || ''}
            onChange={(e) => maj((r) => { r.heure = e.target.value || undefined })}
          />
        </Field>
      </div>
      <Field label="Convoqués (pré-rempli depuis les marchés — ajustez)">
        <TextArea value={reunion.participants} onChange={(v) => maj((r) => { r.participants = v })} rows={4} />
      </Field>

      <div className="pill-note" style={{ marginTop: 12 }}>
        <strong>1 · Capturer.</strong> Enregistrez la réunion (téléphone / dictaphone), même 1 à 2 h.
        <br />
        <strong>2 · Transcrire ICI.</strong> Importez le fichier audio ci-dessous : la transcription
        (Whisper) tourne <em>dans le navigateur</em>, gratuitement — l'audio ne quitte pas votre machine.
        <br />
        <strong>3 · Un aller-retour Claude.</strong> À la fin de la transcription, le prompt complet est
        copié automatiquement : collez-le dans « {gabarit?.projetClaude || 'CR de chantier'} », puis
        rapportez la réponse ci-dessous.
        <br />
        <strong>4 · Le site fabrique le DOCX.</strong> Mise en page de l'agence, codée en dur, et
        rangement direct dans 07_CHANTIER du Drive. Relecture humaine, diffusion, terminé.
      </div>

      <Field label="Fichier audio de la réunion (m4a, mp3, wav…)">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <input
            className="input"
            type="file"
            accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac"
            disabled={enCours}
            style={{ maxWidth: 320 }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void transcrire(f)
              e.target.value = ''
            }}
          />
          <Select
            value={modele}
            onChange={setModele}
            options={MODELES_WHISPER.map((m) => ({ value: m.id, label: m.label }))}
            style={{ maxWidth: 300 }}
          />
        </div>
      </Field>
      {progres && (
        <p className="small" style={{ marginTop: 6 }}>
          <Badge tone="info">en cours</Badge> {progres.etape}
          {progres.pct != null ? ` — ${progres.pct} %` : ''}
        </p>
      )}
      {erreurAudio && <p className="danger-text small" style={{ marginTop: 6 }}>{erreurAudio}</p>}

      <Field label="Transcription / dictée brute (collée ici, elle est intégrée au prompt — rien n'est stocké)">
        <TextArea
          value={transcript}
          onChange={setTranscript}
          rows={8}
          mono
          placeholder="Collez ici la transcription de la réunion (ou laissez vide : le prompt gardera un emplacement à compléter)…"
        />
      </Field>

      <div className="toolbar" style={{ marginTop: 10 }}>
        <CopyBtn
          text={construirePrompt}
          label={`Copier le prompt CR → « ${gabarit?.projetClaude || 'CR de chantier'} »`}
        />
        {reunion.statut !== 'cr_a_relire' && reunion.statut !== 'diffuse' && (
          <Btn small onClick={() => maj((r) => { r.statut = 'cr_a_relire' })}>
            Prompt collé — CR en relecture
          </Btn>
        )}
        {reunion.statut === 'cr_a_relire' && (
          <Btn small kind="primary" onClick={() => { maj((r) => { r.statut = 'diffuse' }); onClose() }}>
            ✓ CR relu et diffusé
          </Btn>
        )}
        {reunion.statut === 'diffuse' && <Badge tone="ok">CR diffusé</Badge>}
      </div>

      <Field label="Retour de Claude (collez sa réponse — le bloc JSON est détecté tout seul)">
        <TextArea
          value={retourClaude}
          onChange={setRetourClaude}
          rows={4}
          mono
          placeholder="Collez ici la réponse complète de Claude…"
        />
      </Field>
      <div className="toolbar" style={{ marginTop: 6 }}>
        <Btn kind="primary" onClick={fabriquerDocx} disabled={!retourClaude.trim()}>
          Fabriquer le DOCX → Drive (07_CHANTIER)
        </Btn>
        {messageDocx && <span className="small">{messageDocx}</span>}
      </div>

      <Field label="Notes (points en attente, absents…)">
        <TextArea value={reunion.notes || ''} onChange={(v) => maj((r) => { r.notes = v })} rows={2} />
      </Field>

      <div className="form-foot">
        <Btn onClick={onClose}>Fermer</Btn>
      </div>
    </Modal>
  )
}

/** C2 — une carte qui n'a rien à dire ne prend plus une page d'écran : elle
 *  devient une LIGNE de titre avec son compteur, qu'un clic déplie. Le badge
 *  (« 2 en retard ») reste visible replié — c'est lui qui donne envie de
 *  déplier, et c'est le seul contenu qu'un registre replié doit encore crier.
 *
 *  ZÉRO SUPPRESSION : rien ne disparaît, tout se rouvre d'un clic. Le tri
 *  définitif entre utile et inutile passe par l'inventaire coché à deux
 *  (méthode 5.17 du plan d'usage), jamais par une décision d'écran. */
function SectionRepliable({
  titre,
  resume,
  badges,
  ouverteParDefaut,
  children,
}: {
  titre: string
  /** ce que la ligne repliée dit de la carte, en quelques mots */
  resume: string
  badges?: ReactNode
  /** ouverte quand la carte appelle un geste ; repliée quand elle est de
   *  l'histoire ou hors phase — chaque section porte SA raison, en commentaire */
  ouverteParDefaut: boolean
  children: ReactNode
}) {
  // l'état initial ne vaut qu'à l'ouverture de l'onglet : une section dépliée
  // ne se referme pas sous les doigts parce qu'on vient de viser le dernier
  // document. Le `key={projet.id}` du montage garantit qu'on repart du bon
  // état en changeant de projet.
  const [ouverte, setOuverte] = useState(ouverteParDefaut)
  return (
    <details
      open={ouverte}
      onToggle={(e) => setOuverte(e.currentTarget.open)}
      style={{ marginBottom: ouverte ? 0 : 12 }}
    >
      <summary
        style={{
          cursor: 'pointer',
          padding: ouverte ? '0 0 8px' : '11px 16px',
          border: ouverte ? undefined : '1.5px solid var(--border)',
          borderRadius: ouverte ? undefined : 'var(--radius)',
          background: ouverte ? undefined : 'var(--bg-soft)',
        }}
      >
        {ouverte ? (
          <span className="small muted">Replier « {titre} »</span>
        ) : (
          <>
            <strong>{titre}</strong> <span className="muted small">— {resume}</span>
            {badges ? <> {badges}</> : null}
          </>
        )}
      </summary>
      {children}
    </details>
  )
}

export default function ProjetChantier({ projet }: { projet: Projet }) {
  const { state } = useStore()
  const today = todayISO()

  // C2 — les compteurs des lignes repliées lisent EXACTEMENT ce que leur
  // carte affiche : mêmes filtres, mêmes sélecteurs d'autorité. Un compteur
  // qui compterait autre chose que sa carte serait un badge qui ment — et un
  // badge qui ment se paie sur tous les autres (constat S2).
  const marches = state.marches.filter((m) => m.projetId === projet.id)

  const visas = state.visas.filter((v) => v.projetId === projet.id)
  const visasAViser = visasEnAttente(visas)
  const visasRetard = visasEnRetard(visas, today)
  const visasHuitaine = visasSousHuitaine(visas, today)

  const evenements = state.evenementsMarche.filter((e) => e.projetId === projet.id)
  const penalitesADecider = evenements.filter((e) => !e.penaliteAppliquee)

  const intemperies = state.intemperies.filter((i) => i.projetId === projet.id)
  const chantierOuvert = marches.some((m) => m.actif)

  const desordres = state.desordresGPA.filter((d) => d.projetId === projet.id)
  const desordresGPAOuverts = desordresOuverts(desordres)
  // la GPA la plus avancée du projet : c'est elle qui expire la première, et
  // c'est avant SON terme qu'une mise en demeure doit partir
  const premiereReception =
    marches
      .map((m) => m.dateReception)
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? null
  const finGPAProche = finGPA(premiereReception)
  const joursFinGPA = joursAvantFinGPA(premiereReception, today)

  return (
    <>
      <CarteReunions projet={projet} />
      <CarteMarches projet={projet} />

      {/* 5.8 — le registre des visas vit sous les marchés : les documents
          d'exécution arrivent des entreprises titulaires, et le délai du
          CCAP court dès leur réception.
          Ouvert tant qu'un document attend un visa : c'est le seul état où
          la responsabilité de la MOE court. */}
      <SectionRepliable
        key={projet.id}
        titre="Visas des documents d'exécution"
        resume={
          visas.length === 0
            ? 'aucun document consigné'
            : visasAViser.length === 0
              ? `${visas.length} document(s) — tous rendus`
              : `${visasAViser.length} à viser sur ${visas.length}`
        }
        badges={
          visasRetard.length > 0 || visasHuitaine.length > 0 ? (
            <>
              {visasRetard.length > 0 && <Badge tone="danger">{visasRetard.length} en retard</Badge>}
              {visasRetard.length > 0 && visasHuitaine.length > 0 ? ' ' : null}
              {visasHuitaine.length > 0 && (
                <Badge tone="warn">{visasHuitaine.length} sous huitaine</Badge>
              )}
            </>
          ) : null
        }
        ouverteParDefaut={visasAViser.length > 0}
      >
        <CarteVisas projet={projet} />
      </SectionRepliable>

      {/* 5.2 — le journal des pénalités vit sous les marchés : les taux du
          CCAP se saisissent sur le marché, les événements se constatent ici.
          Ouvert tant qu'un constat attend une décision ; une fois tout
          décidé, c'est un journal — il se relit, il n'appelle rien. */}
      <SectionRepliable
        key={projet.id}
        titre="Pénalités de marché"
        resume={
          marches.length === 0
            ? 'aucun marché — les taux du CCAP se saisissent sur le marché'
            : evenements.length === 0
              ? 'aucun événement constaté'
              : penalitesADecider.length === 0
                ? `${evenements.length} événement(s) — tous décidés`
                : `${penalitesADecider.length} à décider sur ${evenements.length}`
        }
        badges={
          penalitesADecider.length > 0 ? (
            <Badge tone="warn">{penalitesADecider.length} à décider</Badge>
          ) : null
        }
        ouverteParDefaut={penalitesADecider.length > 0}
      >
        <CartePenalites projet={projet} />
      </SectionRepliable>

      {/* 5.3 — le registre des intempéries se lit AVEC le journal des
          pénalités : il prolonge les délais et neutralise les retards.
          Ouvert tant qu'un marché est en cours ET qu'il y a des jours
          consignés : la pluie ne se constate que sur un chantier ouvert. */}
      <SectionRepliable
        key={projet.id}
        titre="Intempéries"
        resume={
          intemperies.length === 0
            ? 'aucun jour consigné'
            : `${intemperies.length} jour(s) consigné(s)${chantierOuvert ? '' : ' — plus aucun marché en cours'}`
        }
        ouverteParDefaut={intemperies.length > 0 && chantierOuvert}
      >
        <CarteIntemperies projet={projet} />
      </SectionRepliable>

      {/* 5.9 — la GPA ferme la vie du chantier : réception, désordres,
          relances tracées, mise en demeure avant la fin de l'année.
          Repliée tant qu'aucune réception n'est prononcée — la GPA n'a
          alors pas commencé, et une carte hors phase est du bruit. */}
      <SectionRepliable
        key={projet.id}
        titre="GPA — année de parfait achèvement"
        resume={
          premiereReception === null
            ? 'réception non prononcée — la GPA n’a pas commencé'
            : `${desordresGPAOuverts.length === 0 ? `${desordres.length} désordre(s), aucun ouvert` : `${desordresGPAOuverts.length} désordre(s) ouvert(s)`}${finGPAProche ? ` — fin de GPA le ${fmtDate(finGPAProche)}` : ''}`
        }
        badges={
          desordresGPAOuverts.length > 0 ? (
            <>
              <Badge tone="warn">{desordresGPAOuverts.length} ouvert(s)</Badge>
              {joursFinGPA !== null && joursFinGPA >= 0 && joursFinGPA <= 60 ? (
                <>
                  {' '}
                  <Badge tone="danger">fin de GPA dans {joursFinGPA} j</Badge>
                </>
              ) : null}
            </>
          ) : null
        }
        ouverteParDefaut={desordresGPAOuverts.length > 0}
      >
        <CarteGPA projet={projet} />
      </SectionRepliable>
    </>
  )
}
