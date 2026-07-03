// ============================================================
// Situations.tsx — « Secrétaire ++ »
// Circuit : situations@ → routine Claude quotidienne → import JSON
// ici → vérification humaine (délais contractuels suivis en dur)
// → visa. Claude propose, l'humain valide.
// ============================================================

import { useState } from 'react'
import type { AppState, MarcheTravaux, Situation, StatutSituation } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
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
  Select,
  Table,
  TextArea,
  TextInput,
  useToday,
} from '../ui'
import { clamp, diffDays, fmtMois, fmtPct, fold, monthKey } from '../util'
import { dateLimiteVerif, nomProjet } from '../derive'
import { assemble, contexteMarche } from '../prompts'
import {
  importerSituations,
  parseRetourRoutine,
  rapprocherMarche,
  situationExiste,
} from '../importRoutines'
import type { ResultatImport, RetourSituation } from '../importRoutines'

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
    if (retour.type === 'consultations') {
      setErreur(
        'Ce retour contient des consultations, pas des situations — collez-le dans le module Veille AO (ou Routines → Import universel).',
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

function ModalEdition({ sit, onClose }: { sit: Situation; onClose: () => void }) {
  const { state, update } = useStore()
  const [entreprise, setEntreprise] = useState(sit.entreprise)
  const [lot, setLot] = useState(sit.lot || '')
  const [mois, setMois] = useState(sit.mois)
  const [numero, setNumero] = useState<number | null>(sit.numero ?? null)
  const [montantMois, setMontantMois] = useState<number | null>(sit.montantMoisHT)
  const [cumul, setCumul] = useState<number | null>(sit.montantCumulHT ?? null)
  const [confiance, setConfiance] = useState<number | null>(sit.confiance ?? null)
  const [marcheId, setMarcheId] = useState(sit.marcheId || '')
  const [projetId, setProjetId] = useState(sit.projetId)
  const [dateReception, setDateReception] = useState<string | null>(sit.dateReception)
  const [statut, setStatut] = useState<StatutSituation>(sit.statut)
  const [source, setSource] = useState(sit.source || '')
  const [notes, setNotes] = useState(sit.notes || '')

  const marche = state.marches.find((m) => m.id === marcheId)

  const enregistrer = () => {
    if (!entreprise.trim()) {
      alert('Le nom de l’entreprise est obligatoire.')
      return
    }
    if (!/^\d{4}-\d{2}$/.test(mois)) {
      alert('Mois attendu au format AAAA-MM (ex. 2026-07).')
      return
    }
    update((d) => {
      const x = d.situations.find((s) => s.id === sit.id)
      if (!x) return
      x.entreprise = entreprise.trim()
      x.lot = lot.trim() || undefined
      x.mois = mois
      x.numero = numero
      x.montantMoisHT = montantMois
      x.montantCumulHT = cumul
      x.confiance = confiance === null ? null : clamp(confiance, 0, 1)
      x.marcheId = marcheId || null
      x.projetId = marche ? marche.projetId : projetId
      if (dateReception) x.dateReception = dateReception
      x.statut = statut
      x.source = source.trim() || undefined
      x.notes = notes.trim() || undefined
    })
    onClose()
  }

  const supprimer = () => {
    if (!confirm(`Supprimer la situation de ${sit.entreprise} (${fmtMois(sit.mois)}) ?`)) return
    update((d) => {
      d.situations = d.situations.filter((s) => s.id !== sit.id)
    })
    onClose()
  }

  return (
    <Modal titre="Éditer la situation" onClose={onClose} large>
      <div className="form-row">
        <Field label="Marché rattaché" hint="Le rattachement fixe le projet et le délai de vérification">
          <Select
            value={marcheId}
            onChange={setMarcheId}
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
      <div className="form-row">
        <Field label="Entreprise">
          <TextInput value={entreprise} onChange={setEntreprise} />
        </Field>
        <Field label="Lot">
          <TextInput value={lot} onChange={setLot} placeholder="Lot 01 — Gros œuvre" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Mois" hint="Format AAAA-MM">
          <TextInput value={mois} onChange={setMois} placeholder="2026-07" />
        </Field>
        <Field label="N° de situation">
          <NumInput value={numero} onChange={setNumero} />
        </Field>
        <Field label="Montant du mois HT">
          <NumInput value={montantMois} onChange={setMontantMois} />
        </Field>
        <Field label="Cumul HT">
          <NumInput value={cumul} onChange={setCumul} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Reçue le">
          <DateInput value={dateReception} onChange={setDateReception} />
        </Field>
        <Field label="Confiance" hint="0 à 1 — vide si saisie manuelle">
          <NumInput value={confiance} onChange={setConfiance} placeholder="0,85" />
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
      <Field label="Source" hint="Traçabilité : mail d’origine, routine, date">
        <TextInput value={source} onChange={setSource} />
      </Field>
      <Field label="Notes">
        <TextArea value={notes} onChange={setNotes} rows={3} />
      </Field>
      <div className="form-foot">
        <Btn kind="danger" onClick={supprimer}>
          Supprimer
        </Btn>
        <span className="spacer" />
        <Btn kind="ghost" onClick={onClose}>
          Annuler
        </Btn>
        <Btn kind="primary" onClick={enregistrer}>
          Enregistrer
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- tableau « à vérifier » ----------

function CarteAVerifier() {
  const { state, update } = useStore()
  const today = useToday()
  const [editionId, setEditionId] = useState<string | null>(null)

  const tplVerif = gabarit(state, 'tpl-verif-situation')
  const aVerifier = state.situations
    .filter((s) => s.statut === 'a_verifier')
    .sort((a, b) => dateLimiteVerif(state, a).localeCompare(dateLimiteVerif(state, b)))

  const valider = (id: string) => {
    update((d) => {
      const x = d.situations.find((s) => s.id === id)
      if (x) x.statut = 'validee'
    })
  }

  const rejeter = (id: string) => {
    const motif = prompt('Motif du rejet (tracé dans les notes) :')
    if (motif === null) return
    update((d) => {
      const x = d.situations.find((s) => s.id === id)
      if (!x) return
      x.statut = 'rejetee'
      const ligne = `Rejetée le ${today} : ${motif.trim() || 'sans motif'}`
      x.notes = x.notes ? `${x.notes}\n${ligne}` : ligne
    })
  }

  const enEdition = editionId ? state.situations.find((s) => s.id === editionId) : undefined

  return (
    <Card titre={`À vérifier (${aVerifier.length})`}>
      {aVerifier.length === 0 ? (
        <EmptyState>Aucune situation en attente de vérification.</EmptyState>
      ) : (
        <Table
          head={[
            'Entreprise',
            'Lot',
            'Projet',
            'Mois',
            'Mois HT',
            'Cumul HT',
            'Confiance',
            'Reçue le',
            'Vérifier avant',
            'Actions',
          ]}
        >
          {aVerifier.map((s) => {
            const marche = s.marcheId ? state.marches.find((m) => m.id === s.marcheId) : undefined
            const limite = dateLimiteVerif(state, s)
            const jours = diffDays(today, limite)
            return (
              <tr key={s.id} title={s.source || undefined}>
                <td>{s.entreprise}</td>
                <td>{s.lot || '—'}</td>
                <td>
                  <LienProjet state={state} projetId={s.projetId} />
                </td>
                <td>
                  {fmtMois(s.mois)}
                  {s.numero != null && <span className="muted small"> n°{s.numero}</span>}
                </td>
                <td className="right">
                  <Money v={s.montantMoisHT} />
                </td>
                <td className="right">
                  <Money v={s.montantCumulHT} />
                </td>
                <td>
                  <BadgeConfiance v={s.confiance} />
                </td>
                <td>
                  <DateF d={s.dateReception} />
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
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                    <Btn small kind="danger" onClick={() => rejeter(s.id)}>
                      Rejeter
                    </Btn>
                    <Btn small kind="ghost" onClick={() => setEditionId(s.id)}>
                      Éditer
                    </Btn>
                  </div>
                </td>
              </tr>
            )
          })}
        </Table>
      )}
      {tplVerif && aVerifier.length > 0 && (
        <p className="muted small">
          « Vérifier avec Claude » copie le prompt assemblé — à coller dans le Projet Claude
          « {tplVerif.projetClaude} », avec la situation en pièce jointe. Le visa reste humain.
        </p>
      )}
      {enEdition && <ModalEdition sit={enEdition} onClose={() => setEditionId(null)} />}
    </Card>
  )
}

// ---------- historique ----------

function CarteHistorique() {
  const { state } = useStore()
  const traitees = state.situations
    .filter((s) => s.statut !== 'a_verifier')
    .sort(
      (a, b) => b.dateReception.localeCompare(a.dateReception) || b.mois.localeCompare(a.mois),
    )
    .slice(0, 20)

  return (
    <Card titre="Historique">
      {traitees.length === 0 ? (
        <EmptyState>Aucune situation validée ou rejetée pour l’instant.</EmptyState>
      ) : (
        <details>
          <summary className="clickable" style={{ cursor: 'pointer' }}>
            Afficher les {traitees.length} dernières situations traitées
          </summary>
          <div style={{ marginTop: 10 }}>
            <Table
              compact
              head={['Entreprise', 'Lot', 'Projet', 'Mois', 'Mois HT', 'Cumul HT', 'Statut', 'Reçue le', 'Notes']}
            >
              {traitees.map((s) => (
                <tr key={s.id} title={s.source || undefined}>
                  <td>{s.entreprise}</td>
                  <td>{s.lot || '—'}</td>
                  <td>
                    <LienProjet state={state} projetId={s.projetId} />
                  </td>
                  <td>{fmtMois(s.mois)}</td>
                  <td className="right">
                    <Money v={s.montantMoisHT} />
                  </td>
                  <td className="right">
                    <Money v={s.montantCumulHT} />
                  </td>
                  <td>
                    <BadgeStatutSituation statut={s.statut} />
                  </td>
                  <td>
                    <DateF d={s.dateReception} />
                  </td>
                  <td className="muted small" title={s.notes || undefined}>
                    {s.notes ? (s.notes.length > 60 ? s.notes.slice(0, 60) + '…' : s.notes) : '—'}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </details>
      )}
    </Card>
  )
}

// ---------- situations attendues (marchés actifs) ----------

function situationDuMois(state: AppState, m: MarcheTravaux, mois: string): Situation | undefined {
  return state.situations.find(
    (s) =>
      s.mois === mois &&
      (s.marcheId === m.id ||
        (s.projetId === m.projetId && fold(s.entreprise) === fold(m.entreprise))),
  )
}

function CarteAttendues() {
  const { state } = useStore()
  const today = useToday()
  const moisCourant = monthKey(today)
  const tplRelance = gabarit(state, 'tpl-relance-situation')
  const actifs = state.marches.filter((m) => m.actif)

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
            return (
              <tr key={m.id}>
                <td>
                  <LienProjet state={state} projetId={m.projetId} />
                </td>
                <td>{m.lot}</td>
                <td>{m.entreprise}</td>
                <td className="right">
                  <Money v={m.montantInitialHT + m.avenantsHT} />
                </td>
                <td>
                  {sit ? (
                    <>
                      <Badge tone="ok">reçue ✓</Badge> <BadgeStatutSituation statut={sit.statut} />
                    </>
                  ) : (
                    <Badge tone="warn">manquante</Badge>
                  )}
                </td>
                <td>
                  {sit ? (
                    <span className="muted">—</span>
                  ) : tplRelance ? (
                    <CopyBtn
                      small
                      kind="default"
                      label="Relance"
                      text={() => assemble(tplRelance.corps, contexteMarche(state, m))}
                    />
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
        Les marchés de travaux se gèrent dans la fiche projet (carte « Marchés de travaux »).
        {tplRelance ? ` La relance copiée se colle dans le Projet Claude « ${tplRelance.projetClaude} » — brouillon Gmail, relu avant envoi.` : ''}
      </p>
    </Card>
  )
}

// ---------- page ----------

export default function Situations() {
  return (
    <Page
      titre="Situations de travaux"
      sousTitre="Secrétaire ++ — la routine lit situations@, l'humain vérifie et vise."
    >
      <div className="pill-note">
        Circuit : les entreprises envoient leurs situations à situations@ → la routine Claude
        quotidienne les extrait → import ici → vérification humaine → visa. La maîtrise d'œuvre
        porte le risque sur le délai global de paiement : la date limite de vérification de
        chaque situation est calculée en dur (délai contractuel du marché, 15 j par défaut).
      </div>
      <CarteImport />
      <CarteAVerifier />
      <CarteHistorique />
      <CarteAttendues />
    </Page>
  )
}
