// ============================================================
// Projets — liste + fiche (MIQCP, complexité, phases, marchés).
// Le plus gros module : tout le pilotage d'un projet passe ici.
// ============================================================

import { useState } from 'react'
import type { MarcheTravaux, Phase, PhaseCode, Projet, StatutProjet, TypeMO } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  CopyBtn,
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
  navigate,
  useRoute,
} from '../ui'
import type { Tone } from '../ui'
import { fmtHeures, fmtMoney, fmtPct, fold, uid } from '../util'
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
import { factureHT, heuresPrevues, heuresReelles } from '../derive'
import { assemble, contexteProjet } from '../prompts'

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

/** prochain identifiant libre de la forme P01, P02… */
function prochainId(projets: Projet[]): string {
  let max = 0
  for (const p of projets) {
    const m = /^P(\d+)$/.exec(p.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `P${String(max + 1).padStart(2, '0')}`
}

/** badge d'écart heures réelles / prévues (cohérent avec le fil d'urgences) */
function EcartHeures({ reel, prevu, seuil }: { reel: number; prevu: number; seuil: number }) {
  if (reel <= 0) return <span className="muted">—</span>
  if (prevu <= 0) return <Badge tone="warn">sans budget</Badge>
  const ratio = reel / prevu
  const tone: Tone = ratio >= 1 ? 'danger' : ratio >= seuil ? 'warn' : 'ok'
  return <Badge tone={tone}>{fmtPct(ratio, 0)}</Badge>
}

// ============================================================
// Routage interne : #/projets = liste, #/projets/P01 = fiche
// ============================================================

export default function Projets() {
  const route = useRoute()
  const id = route[1]
  if (id) return <FicheProjet projetId={id} />
  return <ListeProjets />
}

// ============================================================
// Liste des projets
// ============================================================

function ListeProjets() {
  const { state } = useStore()
  const [recherche, setRecherche] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [modalCreation, setModalCreation] = useState(false)

  const projets = state.projets
    .filter((p) => {
      if (filtreStatut && p.statut !== filtreStatut) return false
      if (recherche.trim() === '') return true
      return fold(`${p.id} ${p.nom} ${p.moa || ''} ${p.adresse || ''}`).includes(fold(recherche))
    })
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))

  return (
    <Page
      titre="Projets"
      sousTitre="Honoraires MIQCP, phases de mission et marchés de travaux — une fiche par projet."
      actions={<Btn kind="primary" onClick={() => setModalCreation(true)}>Nouveau projet</Btn>}
    >
      <div className="toolbar">
        <TextInput
          value={recherche}
          onChange={setRecherche}
          placeholder="Rechercher (nom, MO, adresse…)"
          style={{ width: 260 }}
        />
        <Select
          value={filtreStatut}
          onChange={setFiltreStatut}
          options={[{ value: '', label: 'Tous les statuts' }, ...STATUTS.map((s) => ({ value: s, label: s }))]}
        />
      </div>

      {projets.length === 0 ? (
        <Card>
          <EmptyState>
            {state.projets.length === 0
              ? 'Aucun projet — créez le premier avec « Nouveau projet ».'
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
                <tr key={p.id} className="clickable" onClick={() => navigate(`/projets/${p.id}`)}>
                  <td className="mono">{p.id}</td>
                  <td>
                    <strong>{p.nom}</strong>
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
        </Card>
      )}

      {modalCreation && <ModalProjet onClose={() => setModalCreation(false)} />}
    </Page>
  )
}

// ============================================================
// Fiche projet
// ============================================================

function FicheProjet({ projetId }: { projetId: string }) {
  const { state, update } = useStore()
  const [modalEdition, setModalEdition] = useState(false)
  const p = state.projets.find((x) => x.id === projetId)

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

  const supprimer = () => {
    const nbFactures = state.factures.filter((f) => f.projetId === p.id).length
    const nbSituations = state.situations.filter((s) => s.projetId === p.id).length
    if (nbFactures > 0 || nbSituations > 0) {
      alert(
        `Suppression impossible : ${nbFactures} facture(s) et ${nbSituations} situation(s) sont liées à ${p.id}.\n` +
          'Supprimez ou réaffectez d’abord ces éléments (modules Facturation et Situations) — chaque donnée reste traçable.',
      )
      return
    }
    if (!confirm(`Supprimer définitivement le projet ${p.id} — ${p.nom} (et ses marchés de travaux) ?`)) return
    update((d) => {
      d.projets = d.projets.filter((x) => x.id !== p.id)
      d.marches = d.marches.filter((m) => m.projetId !== p.id)
      d.temps = d.temps.filter((t) => t.projetId !== p.id)
    })
    navigate('/projets')
  }

  return (
    <Page
      titre={`${p.id} — ${p.nom}`}
      sousTitre={
        <>
          <Badge tone={toneStatut(p.statut)}>{p.statut}</Badge> <Badge tone="info">{p.typeMO}</Badge>
          {p.moa && <> · {p.moa}</>}
          {p.adresse && <> · {p.adresse}</>}
        </>
      }
      actions={
        <>
          {promptsProjet.map((t) => (
            <CopyBtn
              key={t.id}
              kind="default"
              text={() => assemble(t.corps, contexteProjet(state, p))}
              label={`${t.titre} → coller dans « ${t.projetClaude} »`}
            />
          ))}
          <Btn onClick={() => setModalEdition(true)}>Modifier</Btn>
          <Btn kind="danger" onClick={supprimer}>Supprimer</Btn>
        </>
      }
    >
      <p className="small" style={{ marginTop: -10, marginBottom: 14 }}>
        <a href="#/projets">← Tous les projets</a>
        {p.notes && <span className="muted"> — {p.notes}</span>}
      </p>

      <div className="grid2">
        <CarteHonoraires projet={p} />
        <CarteComplexite projet={p} />
      </div>

      <CartePhases projet={p} />
      <CarteMarches projet={p} />

      {modalEdition && <ModalProjet projet={p} onClose={() => setModalEdition(false)} />}
    </Page>
  )
}

// ============================================================
// Carte Honoraires (MIQCP)
// ============================================================

function CarteHonoraires({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const h = calculHonoraires(p, state.settings)
  const hPrev = heuresPrevues(p)
  const tempsPasseVente = hPrev * state.settings.tauxHoraireVente
  const coutPrevisionnel = hPrev * state.settings.coutHoraireRevient
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
            <NumInput
              value={p.tauxRetenu ?? null}
              onChange={(v) => maj((pr) => { pr.tauxRetenu = v })}
              placeholder="auto"
              style={{ width: 110 }}
            />
            <span className="muted small">
              {p.tauxRetenu !== null && p.tauxRetenu !== undefined
                ? `soit ${fmtPct(h.tauxFinal, 2)} (négocié)`
                : `vide = taux ajusté (${fmtPct(h.tauxFinal, 2)}) — ex. 0,12 pour 12 %`}
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

        <dt>Équivalent temps passé (vente)</dt>
        <dd>
          <Money v={tempsPasseVente} />{' '}
          <span className="muted small">
            ({fmtHeures(hPrev)} prévues × {fmtMoney(state.settings.tauxHoraireVente)}/h)
          </span>
        </dd>

        <dt>Marge prévisionnelle</dt>
        <dd className={marge < 0 ? 'danger-text' : 'ok-text'}>
          {fmtMoney(marge)}
          {margePct !== null && <> ({fmtPct(margePct, 0)})</>}{' '}
          <span className="muted small">
            (honoraires − {fmtHeures(hPrev)} × {fmtMoney(state.settings.coutHoraireRevient)}/h de revient)
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
  const { state, update } = useStore()
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
  const seuil = state.settings.seuilDeriveHeures

  const majPhase = (code: PhaseCode, fn: (ph: Phase) => void) =>
    update((d) => {
      const ph = d.projets.find((x) => x.id === p.id)?.phases.find((x) => x.code === code)
      if (ph) fn(ph)
    })

  const recalculer = () => {
    const h = calculHonoraires(p, state.settings)
    if (
      !confirm(
        `Recalculer la répartition des phases sur ${fmtMoney(h.honorairesBaseHT)} d’honoraires de base ?\n` +
          'Attention : montants, dates et heures prévues saisis sur les phases seront écrasés (DIAG et MC remis à zéro).',
      )
    )
      return
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (pr) pr.phases = phasesParDefaut(h.honorairesBaseHT, d.settings.tauxHoraireVente)
    })
  }

  const totaux = p.phases.reduce(
    (t, ph) => {
      const fact = factureHT(state, p.id, ph.code)
      return {
        montant: t.montant + ph.montantHT,
        facture: t.facture + fact,
        reste: t.reste + (ph.montantHT - fact),
        hPrev: t.hPrev + ph.heuresPrevues,
        hReel: t.hReel + heuresReelles(state, p.id, ph.code),
      }
    },
    { montant: 0, facture: 0, reste: 0, hPrev: 0, hReel: 0 },
  )

  return (
    <Card
      titre="Phases de la mission"
      actions={<Btn small onClick={recalculer}>Recalculer la répartition</Btn>}
    >
      {p.phases.length === 0 ? (
        <EmptyState>Aucune phase — « Recalculer la répartition » pour générer la mission de base.</EmptyState>
      ) : (
        <Table
          compact
          head={[
            'Phase',
            '% base',
            <span key="m" className="right">Montant HT</span>,
            'Début',
            'Fin',
            <span key="hp" className="right">H. prévues</span>,
            <span key="f" className="right">Facturé HT</span>,
            <span key="r" className="right">Reste HT</span>,
            <span key="hr" className="right">H. réelles</span>,
            'Écart heures',
          ]}
        >
          {p.phases.map((ph) => {
            const fact = factureHT(state, p.id, ph.code)
            const reste = ph.montantHT - fact
            const hReel = heuresReelles(state, p.id, ph.code)
            return (
              <tr key={ph.code}>
                <td>
                  <strong>{ph.code}</strong>
                  <div className="muted small">{LIBELLES_PHASES[ph.code]}</div>
                </td>
                <td className="muted small">{ph.pctBase !== null ? fmtPct(ph.pctBase, 1) : '—'}</td>
                <td className="right">
                  <NumInput
                    value={ph.montantHT}
                    onChange={(v) => majPhase(ph.code, (x) => { x.montantHT = v ?? 0 })}
                    style={{ width: 96 }}
                  />
                </td>
                <td>
                  <DateInput
                    value={ph.debut}
                    onChange={(v) => majPhase(ph.code, (x) => { x.debut = v })}
                    style={{ width: 138 }}
                  />
                </td>
                <td>
                  <DateInput
                    value={ph.fin}
                    onChange={(v) => majPhase(ph.code, (x) => { x.fin = v })}
                    style={{ width: 138 }}
                  />
                </td>
                <td className="right">
                  <NumInput
                    value={ph.heuresPrevues}
                    onChange={(v) => majPhase(ph.code, (x) => { x.heuresPrevues = v ?? 0 })}
                    style={{ width: 64 }}
                  />
                </td>
                <td className="right"><Money v={fact} /></td>
                <td className={`right ${reste < 0 ? 'danger-text' : ''}`}><Money v={reste} /></td>
                <td className="right num">{fmtHeures(hReel)}</td>
                <td><EcartHeures reel={hReel} prevu={ph.heuresPrevues} seuil={seuil} /></td>
              </tr>
            )
          })}
          <tr>
            <td><strong>Total</strong></td>
            <td />
            <td className="right"><strong><Money v={totaux.montant} /></strong></td>
            <td />
            <td />
            <td className="right"><strong>{fmtHeures(totaux.hPrev)}</strong></td>
            <td className="right"><strong><Money v={totaux.facture} /></strong></td>
            <td className={`right ${totaux.reste < 0 ? 'danger-text' : ''}`}>
              <strong><Money v={totaux.reste} /></strong>
            </td>
            <td className="right"><strong>{fmtHeures(totaux.hReel)}</strong></td>
            <td><EcartHeures reel={totaux.hReel} prevu={totaux.hPrev} seuil={seuil} /></td>
          </tr>
        </Table>
      )}
    </Card>
  )
}

// ============================================================
// Carte Marchés de travaux — CRUD
// ============================================================

function CarteMarches({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const [modal, setModal] = useState<{ marche?: MarcheTravaux } | null>(null)

  const marches = state.marches.filter((m) => m.projetId === p.id)

  const supprimer = (m: MarcheTravaux) => {
    const nbSits = state.situations.filter((s) => s.marcheId === m.id).length
    const question =
      nbSits > 0
        ? `Supprimer le marché « ${m.lot} — ${m.entreprise} » ?\n${nbSits} situation(s) y sont rattachées : elles seront conservées mais détachées du marché.`
        : `Supprimer le marché « ${m.lot} — ${m.entreprise} » ?`
    if (!confirm(question)) return
    update((d) => {
      d.marches = d.marches.filter((x) => x.id !== m.id)
      for (const s of d.situations) if (s.marcheId === m.id) s.marcheId = null
    })
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
          Aucun marché de travaux — ajoutez les lots à la signature des marchés (support du suivi des situations).
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
              <td className="num">{fmtPct(m.tauxRG, 0)}</td>
              <td>{m.revision ? 'oui' : '—'}</td>
              <td>{m.actif ? <Badge tone="ok">en cours</Badge> : <span className="muted">—</span>}</td>
              <td className="small">
                {m.contactNom || <span className="muted">—</span>}
                {m.contactEmail && <div className="muted">{m.contactEmail}</div>}
              </td>
              <td className="num">{m.delaiVerifJours} j</td>
              <td className="right">
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <Btn small onClick={() => setModal({ marche: m })}>Modifier</Btn>
                  <Btn small kind="danger" onClick={() => supprimer(m)}>Supprimer</Btn>
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

// ============================================================
// Modal projet — création & édition
// ============================================================

function ModalProjet({ projet, onClose }: { projet?: Projet; onClose: () => void }) {
  const { state, update } = useStore()
  const creation = !projet
  const idAuto = prochainId(state.projets)

  const [nom, setNom] = useState(projet?.nom || '')
  const [typeMO, setTypeMO] = useState<string>(projet?.typeMO || 'Public')
  const [statut, setStatut] = useState<string>(projet?.statut || 'Prospect')
  const [moa, setMoa] = useState(projet?.moa || '')
  const [adresse, setAdresse] = useState(projet?.adresse || '')
  const [ouvrage, setOuvrage] = useState(projet?.ouvrage || '')
  const [montant, setMontant] = useState<number | null>(projet?.montantTravauxHT ?? null)
  const [notes, setNotes] = useState(projet?.notes || '')

  const enregistrer = () => {
    if (nom.trim() === '') return
    if (creation) {
      const nouveau: Projet = {
        id: idAuto,
        nom: nom.trim(),
        typeMO: typeMO as TypeMO,
        statut: statut as StatutProjet,
        moa: moa.trim() || undefined,
        adresse: adresse.trim() || undefined,
        ouvrage: ouvrage || null,
        montantTravauxHT: montant,
        notesComplexite: {},
        coefManuel: null,
        tauxRetenu: null,
        missionsComplHT: 0,
        notes: notes.trim() || undefined,
        phases: [],
      }
      const base = calculHonoraires(nouveau, state.settings).honorairesBaseHT
      nouveau.phases = phasesParDefaut(base, state.settings.tauxHoraireVente)
      update((d) => { d.projets.push(nouveau) })
      onClose()
      navigate(`/projets/${nouveau.id}`)
    } else {
      update((d) => {
        const pr = d.projets.find((x) => x.id === projet.id)
        if (!pr) return
        pr.nom = nom.trim()
        pr.typeMO = typeMO as TypeMO
        pr.statut = statut as StatutProjet
        pr.moa = moa.trim() || undefined
        pr.adresse = adresse.trim() || undefined
        pr.ouvrage = ouvrage || null
        pr.montantTravauxHT = montant
        pr.notes = notes.trim() || undefined
      })
      onClose()
    }
  }

  return (
    <Modal titre={creation ? `Nouveau projet — ${idAuto}` : `Modifier ${projet.id}`} onClose={onClose}>
      <div className="form-row">
        <Field label="Nom du projet">
          <TextInput value={nom} onChange={setNom} placeholder="Ex. Réhabilitation 12 logements — Oise" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Type de maître d’ouvrage">
          <Select value={typeMO} onChange={setTypeMO} options={TYPES_MO.map((t) => ({ value: t, label: t }))} />
        </Field>
        <Field label="Statut">
          <Select value={statut} onChange={setStatut} options={STATUTS.map((s) => ({ value: s, label: s }))} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Maître d’ouvrage">
          <TextInput value={moa} onChange={setMoa} />
        </Field>
        <Field label="Adresse / localisation">
          <TextInput value={adresse} onChange={setAdresse} />
        </Field>
      </div>
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
      </div>
      <div className="form-row">
        <Field label="Notes">
          <TextArea value={notes} onChange={setNotes} rows={3} />
        </Field>
      </div>
      {creation && (
        <p className="muted small" style={{ marginTop: 10 }}>
          Les phases de la mission de base seront pré-remplies (répartition MIQCP sur les honoraires
          estimés) — ajustables ensuite dans la fiche.
        </p>
      )}
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer} disabled={nom.trim() === ''}>
          {creation ? 'Créer le projet' : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  )
}

// ============================================================
// Modal marché de travaux — création & édition
// ============================================================

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
  const [revision, setRevision] = useState(marche?.revision ? 'oui' : 'non')
  const [delaiVerif, setDelaiVerif] = useState<number | null>(marche?.delaiVerifJours ?? 15)
  const [contactNom, setContactNom] = useState(marche?.contactNom || '')
  const [contactEmail, setContactEmail] = useState(marche?.contactEmail || '')
  const [actif, setActif] = useState(marche?.actif ? 'oui' : 'non')
  const [notes, setNotes] = useState(marche?.notes || '')

  const valide = lot.trim() !== '' && entreprise.trim() !== ''

  const enregistrer = () => {
    if (!valide) return
    update((d) => {
      const champs = {
        lot: lot.trim(),
        entreprise: entreprise.trim(),
        montantInitialHT: montantInitial ?? 0,
        avenantsHT: avenants ?? 0,
        tauxRG: tauxRG ?? 0.05,
        revision: revision === 'oui',
        delaiVerifJours: delaiVerif ?? 15,
        contactNom: contactNom.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        actif: actif === 'oui',
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
        <Field label="Retenue de garantie" hint="0,05 = 5 %">
          <NumInput value={tauxRG} onChange={setTauxRG} />
        </Field>
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
