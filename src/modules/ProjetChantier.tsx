// Onglet Chantier de l'espace projet : marchés de travaux +
// réunions de chantier avec l'assistant CR (audio → transcription
// sans API → CR au style de l'agence → relecture → diffusion).

import { useEffect, useRef, useState } from 'react'
import type {
  EvenementMarche,
  MarcheTravaux,
  NatureIntemperie,
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
import {
  DELAI_VISA_DEFAUT,
  LIBELLE_STATUT_VISA,
  echeanceVisa,
  visasEnRetard,
  visasSousHuitaine,
} from '../visas'
import {
  LIBELLE_EVENEMENT,
  LIBELLE_INTEMPERIE,
  estJourOuvre,
  penaliteEncourue,
  prolongationDelai,
  totalAppliqueMarche,
  totalEncouruMarche,
} from '../penalites'
import { assemble, contexteProjet } from '../prompts'
import {
  Badge,
  Btn,
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
import { diffDays, fmtDate, fmtMoney, fmtPct, todayISO, uid } from '../util'
import { MODELES_WHISPER, transcrireFichier, type ProgresTranscription } from '../transcription'
import { CONTRAT_CR, genererDocxCR, parseRetourCR, retourVersTexte } from '../crdocx'
import { lireRacine, nomConforme, rangerFichier, supporteFS, type ResultatRangement } from '../fsdrive'
import { creerDocument, empreinteSha256, enregistrerDocument, remplacerDocument } from '../registre'
import { copier } from '../prompts'

// ============================================================
// Marchés de travaux
// ============================================================

export function CarteMarches({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const [modal, setModal] = useState<{ marche?: MarcheTravaux } | null>(null)

  const marches = state.marches.filter((m) => m.projetId === p.id)

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
                {m.entreprise}
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
                    <span className="small">
                      {m.indiceRevision}
                      {m.moisZero ? <span className="muted"> · base {m.moisZero}</span> : ''}
                    </span>
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
      )}

      {modal && <ModalMarche projetId={p.id} marche={modal.marche} onClose={() => setModal(null)} />}
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
  const { update } = useStore()
  const creation = !marche

  const [lot, setLot] = useState(marche?.lot || '')
  const [entreprise, setEntreprise] = useState(marche?.entreprise || '')
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
  const [notes, setNotes] = useState(marche?.notes || '')

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
        <Field label="Entreprise">
          <TextInput value={entreprise} onChange={setEntreprise} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Montant initial HT (€)">
          <NumInput value={montantInitial} onChange={setMontantInitial} />
        </Field>
        <Field label="Avenants HT (€)">
          <NumInput value={avenants} onChange={setAvenants} />
        </Field>
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
          <Field label="Indice (CCAP)" hint="la série de cette entreprise : BT01, BT02, TP08… — valeurs à saisir dans Paramètres">
            <TextInput value={indiceRevision} onChange={setIndiceRevision} placeholder="BT01" />
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
          `Le montant sera figé et la décision signée « ${signataire} ». Le report sur la situation reste à faire à la main : ` +
          `une pénalité est un acte contractuel.`,
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
    toast('Pénalité appliquée — montant figé, décision signée.', { tone: 'ok' })
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
                        title="Fige le montant encouru et signe la décision — le report sur la situation reste manuel"
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

export function CarteIntemperies({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const [date, setDate] = useState<string | null>(todayISO())
  const [nature, setNature] = useState<NatureIntemperie>('pluie')
  const [commentaire, setCommentaire] = useState('')

  const intemperies = state.intemperies
    .filter((i) => i.projetId === p.id)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))

  // l'effet « prolongation » se lit sur les marchés dont la fenêtre
  // d'intervention est posée — les autres n'ont pas de période à confronter
  const marchesAvecFenetre = state.marches.filter(
    (m) => m.projetId === p.id && (m.dateDebut || m.dateFin),
  )

  const ajouter = () => {
    if (!date) return
    update((d) => {
      d.intemperies.push({
        id: uid('intemp'),
        projetId: p.id,
        date,
        nature,
        commentaire: commentaire.trim(),
      })
    })
    setCommentaire('')
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
        <DateInput value={date} onChange={setDate} style={{ maxWidth: 170 }} />
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
          style={{ maxWidth: 420 }}
        />
        <Btn small kind="primary" onClick={ajouter} disabled={!date}>
          Consigner le jour
        </Btn>
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
            Deux natures le même jour comptent UN jour ; les week-ends sont consignés mais non
            comptés.
          </p>
        </>
      )}
    </Card>
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

export function CarteReunions({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const [assistant, setAssistant] = useState<{ reunion: ReunionChantier; fichier?: File } | null>(null)
  const [reprog, setReprog] = useState<ReunionChantier | null>(null)
  const [lectureCR, setLectureCR] = useState<ReunionChantier | null>(null)

  const reunions = state.reunions
    .filter((r) => r.projetId === p.id)
    .sort((a, b) => b.date.localeCompare(a.date))

  const creer = (fichier?: File) => {
    const n = reunions.length + 1
    const reunion: ReunionChantier = {
      id: uid('reu'),
      projetId: p.id,
      date: todayISO(),
      heure: '14:00',
      titre: `Réunion de chantier n°${n}`,
      participants: participantsParDefaut(state, p),
      statut: 'cr_a_generer',
    }
    update((d) => {
      d.reunions.push(reunion)
    })
    setAssistant({ reunion, fichier })
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
          <Btn small onClick={() => creer()}>Nouvelle réunion</Btn>
        </>
      }
    >
      {reunions.length === 0 ? (
        <EmptyState>
          Après chaque réunion, un seul geste : « 🎙 Déposer l'enregistrement » — la réunion se crée, la
          transcription démarre, le prompt se copie tout seul, et le DOCX final part dans le Drive.
        </EmptyState>
      ) : (
        <Table compact head={['Réunion', 'Quand', 'Statut', 'CR', '']}>
          {reunions.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.titre}</strong>
                {r.notes && <div className="muted small">{r.notes}</div>}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {fmtDate(r.date)}
                {r.heure && <span className="mono"> · {r.heure}</span>}
              </td>
              <td><Badge tone={LIBELLE_STATUT[r.statut].tone}>{LIBELLE_STATUT[r.statut].label}</Badge></td>
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
                    {r.statut === 'diffuse' ? 'Rouvrir' : 'Assistant CR'}
                  </Btn>
                  <Btn
                    small
                    kind="danger"
                    onClick={async () => {
                      const snap = state
                      if (await confirmer({ message: `Supprimer « ${r.titre} » ?`, danger: true, confirmerLabel: 'Supprimer' })) {
                        update((d) => {
                          d.reunions = d.reunions.filter((x) => x.id !== r.id)
                        })
                        toast('Réunion supprimée.', { undo: () => replace(snap) })
                      }
                    }}
                  >
                    Suppr.
                  </Btn>
                </span>
              </td>
            </tr>
          ))}
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

/** reprogrammation « dernière minute » : date + heure, rien d'autre */
function ModalReprogrammation({ reunion, onClose }: { reunion: ReunionChantier; onClose: () => void }) {
  const { update } = useStore()
  const [date, setDate] = useState<string | null>(reunion.date)
  const [heure, setHeure] = useState(reunion.heure || '')

  const enregistrer = () => {
    if (!date) return toast('Indiquer la date.', { tone: 'danger' })
    update((d) => {
      const r = d.reunions.find((x) => x.id === reunion.id)
      if (!r) return
      r.date = date
      r.heure = heure || undefined
    })
    toast(`« ${reunion.titre} » reprogrammée au ${fmtDate(date)}${heure ? ` à ${heure}` : ''}.`, { tone: 'ok' })
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

export default function ProjetChantier({ projet }: { projet: Projet }) {
  return (
    <>
      <CarteReunions projet={projet} />
      <CarteMarches projet={projet} />
      {/* 5.8 — le registre des visas vit sous les marchés : les documents
          d'exécution arrivent des entreprises titulaires, et le délai du
          CCAP court dès leur réception */}
      <CarteVisas projet={projet} />
      {/* 5.2 — le journal des pénalités vit sous les marchés : les taux du
          CCAP se saisissent sur le marché, les événements se constatent ici */}
      <CartePenalites projet={projet} />
      {/* 5.3 — le registre des intempéries se lit AVEC le journal des
          pénalités : il prolonge les délais et neutralise les retards */}
      <CarteIntemperies projet={projet} />
    </>
  )
}
