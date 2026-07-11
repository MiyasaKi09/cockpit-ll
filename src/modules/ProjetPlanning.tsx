// Onglet Planning de l'espace projet : LE projet, seul, sur une échelle
// de temps — phases de conception en haut, lots de chantier en dessous,
// puis le détail des travaux : chaque élément prévu au DCE (CCTP), daté.
// Les dates de phases s'éditent dans la fiche (Pilotage), les dates de
// lots dans l'onglet Chantier ; les tâches du DCE s'ajustent ICI.

import { Fragment, useState } from 'react'
import type { Projet, StatutTache, TacheChantier } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  DateInput,
  EmptyState,
  Field,
  Modal,
  Select,
  Table,
  TextInput,
  confirmer,
  toast,
  useToday, RowMenu } from '../ui'
import { diffDays, fmtDate, fmtMoney, fold, todayISO, uid } from '../util'
import { montantElement, sommeLignes } from '../dpgf'
import { couleurPhase } from './Planning'

const NOMS_MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

const LIBELLE_STATUT_TACHE: Record<StatutTache, string> = {
  prevu: 'prévu',
  en_cours: 'en cours',
  fait: 'fait',
}

function couleurTache(t: TacheChantier, today: string): string {
  if (t.statut === 'fait') return 'var(--ok)'
  // le retard prime : une tâche dépassée non faite est rouge, même « en cours »
  if (t.fin && t.fin < today) return 'var(--danger)'
  if (t.statut === 'en_cours') return 'var(--warn)'
  return 'var(--accent)'
}

/** position (%) d'une date dans la fenêtre [debut, fin] */
function pos(debut: string, fin: string, d: string): number {
  const total = Math.max(1, diffDays(debut, fin))
  return Math.min(100, Math.max(0, (diffDays(debut, d) / total) * 100))
}

/** premiers jours de mois couverts par la fenêtre (graduations) */
function moisDe(debut: string, fin: string): string[] {
  const out: string[] = []
  let [a, m] = [Number(debut.slice(0, 4)), Number(debut.slice(5, 7))]
  for (let i = 0; i < 40; i++) {
    const iso = `${a}-${String(m).padStart(2, '0')}-01`
    if (iso > fin) break
    if (iso >= debut) out.push(iso)
    m++
    if (m > 12) {
      m = 1
      a++
    }
  }
  return out
}

export default function ProjetPlanning({ projet: p }: { projet: Projet }) {
  const { state } = useStore()
  const today = useToday()

  const phases = p.phases.filter((ph) => ph.debut && ph.fin)
  const lots = state.marches.filter((m) => m.projetId === p.id && (m.dateDebut || m.dateFin))
  const taches = state.tachesChantier.filter((t) => t.projetId === p.id)
  const tachesDatees = taches.filter((t) => t.debut && t.fin)
  const reunionsAVenir = state.reunions
    .filter((r) => r.projetId === p.id && r.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3)

  // groupes de tâches par lot (ordre alphabétique = ordre des numéros de lots)
  const groupes = [...new Set(taches.map((t) => t.lot))].sort((a, b) => a.localeCompare(b))

  const dates = [
    ...phases.flatMap((ph) => [ph.debut!, ph.fin!]),
    ...lots.flatMap((m) => [m.dateDebut, m.dateFin, m.dateReception].filter((d): d is string => Boolean(d))),
    ...tachesDatees.flatMap((t) => [t.debut!, t.fin!]),
  ].sort()

  if (dates.length === 0) {
    return (
      <>
        <Card titre="Planning du projet">
          <EmptyState>
            Rien de daté pour l'instant — datez les phases (onglet Pilotage, « Modifier les phases »),
            les lots (onglet Chantier), et importez les CCTP (onglet DCE & CCTP) pour voir chaque
            élément prévu au DCE se poser sur le planning.
          </EmptyState>
        </Card>
        <CarteTaches projet={p} taches={taches} groupes={groupes} />
      </>
    )
  }

  const debut = dates[0]
  const fin = dates[dates.length - 1]
  const mois = moisDe(debut, fin)
  const dansFenetre = today >= debut && today <= fin

  const barre = (bDebut: string, bFin: string, couleur: string, label: string, titre: string, retard?: boolean) => {
    const gauche = pos(debut, fin, bDebut)
    const largeur = Math.max(1.5, pos(debut, fin, bFin) - gauche)
    return (
      <div
        title={titre}
        style={{
          position: 'absolute',
          left: `${gauche}%`,
          width: `${largeur}%`,
          top: 3,
          bottom: 3,
          background: couleur,
          border: retard ? '2px solid var(--danger)' : 'none',
          borderRadius: 2,
          color: '#fff',
          fontSize: 10,
          fontWeight: 700,
          lineHeight: '18px',
          paddingLeft: 5,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
    )
  }

  const ligne = (cle: string, gauche: React.ReactNode, contenu: React.ReactNode) => (
    <div key={cle} className="plan-frise plan-frise-projet">
      <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gauche}</div>
      <div style={{ position: 'relative', height: 26, background: 'var(--bg-soft)', borderRadius: 2 }}>
        {contenu}
        {dansFenetre && (
          <div
            style={{ position: 'absolute', left: `${pos(debut, fin, today)}%`, top: -2, bottom: -2, width: 2, background: 'var(--danger)' }}
            title={`aujourd'hui — ${fmtDate(today)}`}
          />
        )}
      </div>
    </div>
  )

  return (
    <>
      <Card
        titre="Planning du projet"
        actions={<a href="#/planning" className="small">tous les projets →</a>}
      >
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', rowGap: 6 }}>
            {/* graduations mois */}
            <div className="plan-frise plan-frise-projet">
              <div />
              <div style={{ position: 'relative', height: 18 }}>
                {mois.map((m) => (
                  <div
                    key={m}
                    className="muted small"
                    style={{ position: 'absolute', left: `${pos(debut, fin, m)}%`, top: 0, bottom: 0, borderLeft: '1px solid var(--line)', paddingLeft: 3, fontSize: 10 }}
                  >
                    {NOMS_MOIS[Number(m.slice(5, 7)) - 1]} {m.slice(2, 4)}
                  </div>
                ))}
              </div>
            </div>

            {/* phases de conception */}
            {phases.map((ph) =>
              ligne(
                `ph-${ph.code}`,
                <strong>{ph.code}</strong>,
                barre(ph.debut!, ph.fin!, couleurPhase(ph.code), ph.code, `${ph.code} · ${fmtDate(ph.debut)} → ${fmtDate(ph.fin)}`),
              ),
            )}

            {/* lots de chantier */}
            {lots.length > 0 && (
              <div className="muted small" style={{ marginTop: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>
                Lots de chantier
              </div>
            )}
            {lots.map((m) => {
              const bDebut = m.dateDebut || m.dateFin!
              const bFin = m.dateFin || m.dateDebut!
              const retard = Boolean(m.actif && m.dateFin && m.dateFin < today && !m.dateReception)
              return ligne(
                `lot-${m.id}`,
                <span title={`${m.lot} — ${m.entreprise}`}>{m.lot.replace(/^Lot\s*/i, 'L')}</span>,
                <>
                  {barre(
                    bDebut,
                    bFin,
                    'var(--accent)',
                    m.entreprise,
                    `${m.lot} — ${m.entreprise} · ${fmtDate(bDebut)} → ${fmtDate(bFin)}${retard ? ' · EN RETARD (réception non prononcée)' : ''}`,
                    retard,
                  )}
                  {m.dateReception && (
                    <div
                      title={`Réception le ${fmtDate(m.dateReception)}`}
                      style={{
                        position: 'absolute',
                        left: `calc(${pos(debut, fin, m.dateReception)}% - 5px)`,
                        top: 2,
                        width: 0,
                        height: 0,
                        borderLeft: '6px solid transparent',
                        borderRight: '6px solid transparent',
                        borderTop: '10px solid var(--ok)',
                      }}
                    />
                  )}
                </>,
              )
            })}

            {/* travaux détaillés : chaque élément prévu au DCE, daté */}
            {tachesDatees.length > 0 && (
              <div className="muted small" style={{ marginTop: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>
                Travaux détaillés (DCE / CCTP)
              </div>
            )}
            {groupes.map((g) => {
              const duGroupe = tachesDatees.filter((t) => t.lot === g)
              if (duGroupe.length === 0) return null
              return ligne(
                `grp-${g}`,
                <span title={g}>{g.replace(/^Lot\s*/i, 'L')}</span>,
                <>
                  {duGroupe.map((t) => {
                    const gauche = pos(debut, fin, t.debut!)
                    const largeur = Math.max(0.8, pos(debut, fin, t.fin!) - gauche)
                    return (
                      <div
                        key={t.id}
                        title={`${t.designation} · ${fmtDate(t.debut)} → ${fmtDate(t.fin)} (${LIBELLE_STATUT_TACHE[t.statut]})`}
                        style={{
                          position: 'absolute',
                          left: `${gauche}%`,
                          width: `${largeur}%`,
                          top: 7,
                          bottom: 7,
                          background: couleurTache(t, today),
                          borderRadius: 2,
                          opacity: t.statut === 'fait' ? 0.55 : 0.9,
                        }}
                      />
                    )
                  })}
                </>,
              )
            })}
          </div>
        </div>

        {/* repères réunions */}
        {reunionsAVenir.length > 0 && (
          <p className="small" style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted">Prochaines réunions :</span>
            {reunionsAVenir.map((r) => (
              <Badge key={r.id} tone="info">
                {fmtDate(r.date)}
                {r.heure ? ` · ${r.heure}` : ''} — {r.titre}
              </Badge>
            ))}
          </p>
        )}
        <p className="muted small" style={{ marginTop: 8 }}>
          Dates de phases : onglet Pilotage → « Modifier les phases ». Dates de lots : onglet Chantier.
          Tâches du DCE : tableau ci-dessous. Trait rouge = aujourd'hui · triangle vert = réception ·
          bord rouge = lot en retard · segment rouge = tâche dépassée non faite.
        </p>
      </Card>

      <CarteTaches projet={p} taches={taches} groupes={groupes} />
    </>
  )
}

// ============================================================
// Planning travaux détaillé — chaque élément du DCE, daté ici
// ============================================================

function CarteTaches({
  projet: p,
  taches,
  groupes,
}: {
  projet: Projet
  /** tâches et groupes calculés par le parent — mêmes données que la frise */
  taches: TacheChantier[]
  groupes: string[]
}) {
  const { state, update, replace } = useStore()
  const today = useToday()
  const [filtre, setFiltre] = useState('')
  const [modalAjout, setModalAjout] = useState(false)

  const aDater = taches.filter((t) => !t.debut || !t.fin).length
  const enRetard = taches.filter((t) => t.statut !== 'fait' && t.fin && t.fin < today).length
  const faites = taches.filter((t) => t.statut === 'fait').length

  // montants issus des DPGF importées (onglet DCE & CCTP) — dérivés, jamais stockés
  const lotsDce = state.lotsDce.filter((l) => l.projetId === p.id)
  const montantDe = (t: TacheChantier): number | null => {
    if (!t.lotDceId || !t.elementId) return null
    const lot = lotsDce.find((l) => l.id === t.lotDceId)
    if (!lot?.dpgf) return null
    const element = lot.elements.find((e) => e.id === t.elementId)
    return element ? montantElement(lot.dpgf.lignes, element) : null
  }
  const totalDpgfDe = (groupe: string): number | null => {
    const lotId = taches.find((t) => t.lot === groupe && t.lotDceId)?.lotDceId
    const lot = lotId ? lotsDce.find((l) => l.id === lotId) : null
    return lot?.dpgf ? sommeLignes(lot.dpgf.lignes) : null
  }

  const maj = (id: string, fn: (t: TacheChantier) => void) =>
    update((d) => {
      const t = d.tachesChantier.find((x) => x.id === id)
      if (t) fn(t)
    })

  const supprimer = async (t: TacheChantier) => {
    const snap = state
    if (!(await confirmer({ message: `Supprimer la tâche « ${t.designation} » ?`, danger: true, confirmerLabel: 'Supprimer' }))) return
    update((d) => {
      d.tachesChantier = d.tachesChantier.filter((x) => x.id !== t.id)
    })
    toast('Tâche supprimée.', { undo: () => replace(snap) })
  }

  if (taches.length === 0) {
    return (
      <Card titre="Planning travaux détaillé — les éléments prévus au DCE">
        <EmptyState>
          Aucune tâche — importez les CCTP dans l'onglet{' '}
          <a href={`#/projets/${p.id}/dce`}>DCE & CCTP</a> : chaque élément prévu aux pièces écrites
          arrive ici avec une date, prêt à être ajusté.
        </EmptyState>
      </Card>
    )
  }

  return (
    <Card
      titre="Planning travaux détaillé — les éléments prévus au DCE"
      actions={
        <>
          {enRetard > 0 && <Badge tone="danger">{enRetard} en retard</Badge>}
          {aDater > 0 && <Badge tone="warn">{aDater} à dater</Badge>}
          <Badge tone="ok">{faites}/{taches.length} faits</Badge>
          <Btn small onClick={() => setModalAjout(true)}>Ajouter une tâche</Btn>
        </>
      }
    >
      <div className="toolbar">
        <TextInput value={filtre} onChange={setFiltre} placeholder="Filtrer (désignation, lot)…" style={{ maxWidth: 280 }} />
      </div>
      <Table compact head={['Élément', 'Début', 'Fin', 'Statut', '']}>
        {groupes.map((g) => {
          const duGroupe = taches
            .filter((t) => t.lot === g)
            .filter((t) => !filtre.trim() || fold(t.designation + ' ' + t.lot).includes(fold(filtre)))
            .sort((a, b) => (a.debut || '9999').localeCompare(b.debut || '9999') || a.designation.localeCompare(b.designation))
          if (duGroupe.length === 0) return null
          return (
            <Fragment key={g}>
              <tr>
                <td colSpan={5} style={{ background: 'var(--bg-soft)', fontWeight: 700 }}>
                  {g}
                  <span className="muted small" style={{ fontWeight: 400 }}>
                    {' '}— {duGroupe.length} élément(s)
                    {totalDpgfDe(g) !== null && <> · DPGF {fmtMoney(totalDpgfDe(g))}</>}
                  </span>
                </td>
              </tr>
              {duGroupe.map((t) => {
                const retard = t.statut !== 'fait' && t.fin && t.fin < today
                const montant = montantDe(t)
                return (
                  <tr key={t.id}>
                    <td style={{ maxWidth: 380 }}>
                      {t.designation}
                      {montant !== null && <span className="muted small"> · {fmtMoney(montant, true)}</span>}
                      {(!t.debut || !t.fin) && <> <Badge tone="warn">à dater</Badge></>}
                      {retard && <> <Badge tone="danger">en retard</Badge></>}
                    </td>
                    <td style={{ width: 140 }}>
                      <DateInput
                        value={t.debut}
                        onChange={(v) => maj(t.id, (x) => {
                          x.debut = v
                          if (v && x.fin && x.fin < v) x.fin = v
                        })}
                      />
                    </td>
                    <td style={{ width: 140 }}>
                      <DateInput
                        value={t.fin}
                        onChange={(v) => maj(t.id, (x) => {
                          x.fin = v
                          if (v && x.debut && x.debut > v) x.debut = v
                        })}
                      />
                    </td>
                    <td style={{ width: 120 }}>
                      <Select
                        value={t.statut}
                        onChange={(v) => maj(t.id, (x) => { x.statut = v as StatutTache })}
                        options={Object.entries(LIBELLE_STATUT_TACHE).map(([value, label]) => ({ value, label }))}
                      />
                    </td>
                    <td className="right" style={{ width: 54 }}>
                      <RowMenu items={[{ label: 'Supprimer la tâche', onClick: () => void supprimer(t), danger: true }]} />
                    </td>
                  </tr>
                )
              })}
            </Fragment>
          )
        })}
      </Table>
      <p className="muted small" style={{ marginTop: 8 }}>
        Généré depuis les CCTP (onglet <a href={`#/projets/${p.id}/dce`}>DCE & CCTP</a>) — dates posées
        sur la fenêtre du marché rattaché (sinon phase DET), à affiner ici au fil du chantier.
        « Replanifier » (onglet DCE) recale tout un lot quand ses dates de marché changent.
      </p>

      {modalAjout && <ModalAjoutTache projet={p} onClose={() => setModalAjout(false)} />}
    </Card>
  )
}

function ModalAjoutTache({ projet: p, onClose }: { projet: Projet; onClose: () => void }) {
  const { state, update } = useStore()
  const lotsConnus = [
    ...new Set([
      ...state.tachesChantier.filter((t) => t.projetId === p.id).map((t) => t.lot),
      ...state.marches.filter((m) => m.projetId === p.id).map((m) => m.lot),
    ]),
  ].sort()
  const [lot, setLot] = useState(lotsConnus[0] || '')
  const [designation, setDesignation] = useState('')
  const [debut, setDebut] = useState<string | null>(todayISO())
  const [fin, setFin] = useState<string | null>(null)

  const ajouter = () => {
    if (!designation.trim()) return
    update((d) => {
      d.tachesChantier.push({
        id: uid('tache'),
        projetId: p.id,
        lotDceId: null,
        elementId: null,
        marcheId: null,
        lot: lot.trim() || 'Hors lot',
        designation: designation.trim(),
        debut,
        fin: fin && debut && fin < debut ? debut : fin,
        statut: 'prevu',
      })
    })
    toast('Tâche ajoutée au planning travaux.', { tone: 'ok' })
    onClose()
  }

  return (
    <Modal titre="Ajouter une tâche au planning travaux" onClose={onClose}>
      <div className="form-row">
        <Field label="Lot" hint="reprendre un libellé existant groupe les tâches ensemble">
          <TextInput value={lot} onChange={setLot} placeholder="Lot 02 — Gros œuvre" />
        </Field>
        <Field label="Désignation">
          <TextInput value={designation} onChange={setDesignation} placeholder="Ex. Dallage du hall" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Début">
          <DateInput value={debut} onChange={setDebut} />
        </Field>
        <Field label="Fin">
          <DateInput value={fin} onChange={setFin} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={ajouter} disabled={!designation.trim()}>Ajouter</Btn>
      </div>
    </Modal>
  )
}
