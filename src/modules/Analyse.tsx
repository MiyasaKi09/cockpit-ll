// ============================================================
// Analyse — la question qui compte : chaque mission paie-t-elle
// sa journée de travail ? €/jour réel par projet, comparé au
// seuil des coûts fixes, sur deux périodes configurables.
// Mieux que le forfait « 500 €/jour » : ici le coût du temps est
// calculé personne par personne (salaire réel chargé).
// ============================================================

import { useMemo, useState } from 'react'
import type { AppState } from '../types'
import { useStore } from '../store'
import {
  coutAgenceAnnuel,
  coutHoraireDe,
  coutJourObjectif,
  enJours,
  nomProjet,
} from '../derive'
import { Badge, Card, EmptyState, Page, Stat } from '../ui'
import { addDays, fmtMoney, fmtPct, todayISO } from '../util'

interface LigneAnalyse {
  projetId: string
  ca: number
  coutTemps: number
  margeReelle: number
  jours: number
  parJour: number | null
  partCA: number
  partTemps: number
}

interface Synthese {
  lignes: LigneAnalyse[]
  totalCA: number
  totalJours: number
  totalCoutTemps: number
  joursHorsProjet: number
  parJourMoyen: number | null
}

/** CA facturé (émis/encaissé), temps et coûts réels sur [debut, fin] */
function analyser(state: AppState, debut: string, fin: string): Synthese {
  const parProjet = new Map<string, LigneAnalyse>()
  const ligne = (id: string): LigneAnalyse => {
    if (!parProjet.has(id))
      parProjet.set(id, { projetId: id, ca: 0, coutTemps: 0, margeReelle: 0, jours: 0, parJour: null, partCA: 0, partTemps: 0 })
    return parProjet.get(id)!
  }

  for (const f of state.factures) {
    if (f.statut === 'prevue') continue
    if (f.emission < debut || f.emission > fin) continue
    ligne(f.projetId).ca += f.montantHT
  }
  for (const t of state.temps) {
    if (t.semaine < debut || t.semaine > fin) continue
    const l = ligne(t.projetId)
    l.jours += enJours(state, t.heures)
    l.coutTemps += t.heures * coutHoraireDe(state, t.personne)
  }

  let joursHorsProjet = 0
  for (const t of state.tempsHorsProjet) {
    if (t.semaine < debut || t.semaine > fin) continue
    joursHorsProjet += enJours(state, t.heures)
  }

  const lignes = [...parProjet.values()].filter((l) => l.ca > 0 || l.jours > 0)
  const totalCA = lignes.reduce((s, l) => s + l.ca, 0)
  const totalJours = lignes.reduce((s, l) => s + l.jours, 0)
  const totalCoutTemps = lignes.reduce((s, l) => s + l.coutTemps, 0)
  for (const l of lignes) {
    l.margeReelle = l.ca - l.coutTemps
    l.parJour = l.jours > 0.05 ? l.ca / l.jours : null
    l.partCA = totalCA > 0 ? l.ca / totalCA : 0
    l.partTemps = totalJours > 0 ? l.jours / totalJours : 0
  }
  lignes.sort((a, b) => b.ca - a.ca)

  return {
    lignes,
    totalCA,
    totalJours,
    totalCoutTemps,
    joursHorsProjet,
    parJourMoyen: totalJours > 0.05 ? totalCA / totalJours : null,
  }
}

function CouleurParJour({ v, objectif }: { v: number | null; objectif: number }) {
  if (v === null) return <span className="muted">—</span>
  const tone = v >= objectif ? 'ok-text' : v >= objectif * 0.6 ? 'warn-text' : 'danger-text'
  return <strong className={tone}>{fmtMoney(v)}</strong>
}

function ChampDate({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="input"
      type="date"
      value={value}
      style={{ width: 150 }}
      onChange={(e) => e.target.value && onChange(e.target.value)}
    />
  )
}

function TableauPeriode({ titre, debut, fin, setDebut, setFin }: {
  titre: string
  debut: string
  fin: string
  setDebut: (v: string) => void
  setFin: (v: string) => void
}) {
  const { state } = useStore()
  const objectif = coutJourObjectif(state)
  const syn = useMemo(() => analyser(state, debut, fin), [state, debut, fin])
  const totalAvecHP = syn.totalJours + syn.joursHorsProjet

  return (
    <Card
      titre={titre}
      actions={
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <ChampDate value={debut} onChange={setDebut} />
          <span className="muted small">→</span>
          <ChampDate value={fin} onChange={setFin} />
        </span>
      }
    >
      {syn.lignes.length === 0 ? (
        <EmptyState>Aucune facture émise ni heure pointée sur cette période.</EmptyState>
      ) : (
        <>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Mission</th>
                <th className="right">CA facturé HT</th>
                <th className="right">Coût du temps (réel)</th>
                <th className="right">Marge réelle</th>
                <th className="right">Jours</th>
                <th className="right">€ / jour réel</th>
                <th className="right">Part CA</th>
                <th className="right">Part temps</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ fontWeight: 650 }}>
                <td>Total / moyenne</td>
                <td className="right num">{fmtMoney(syn.totalCA)}</td>
                <td className="right num">{fmtMoney(syn.totalCoutTemps)}</td>
                <td className={`right num ${syn.totalCA - syn.totalCoutTemps < 0 ? 'danger-text' : 'ok-text'}`}>
                  {fmtMoney(syn.totalCA - syn.totalCoutTemps)}
                </td>
                <td className="right num">{Math.round(syn.totalJours)}</td>
                <td className="right"><CouleurParJour v={syn.parJourMoyen} objectif={objectif} /></td>
                <td className="right num">100 %</td>
                <td className="right num">100 %</td>
              </tr>
              <tr className="muted">
                <td>Objectif (payer tous les coûts fixes)</td>
                <td />
                <td />
                <td />
                <td />
                <td className="right num">{fmtMoney(objectif)}</td>
                <td />
                <td />
              </tr>
              {syn.lignes.map((l) => (
                <tr key={l.projetId}>
                  <td>
                    <a href={`#/projets/${l.projetId}`} title={nomProjet(state, l.projetId)}>
                      {nomProjet(state, l.projetId).slice(0, 44)}
                    </a>
                  </td>
                  <td className="right num">{fmtMoney(l.ca)}</td>
                  <td className="right num">{fmtMoney(l.coutTemps)}</td>
                  <td className={`right num ${l.margeReelle < 0 ? 'danger-text' : ''}`}>{fmtMoney(l.margeReelle)}</td>
                  <td className="right num">{Math.round(l.jours * 10) / 10}</td>
                  <td className="right"><CouleurParJour v={l.parJour} objectif={objectif} /></td>
                  <td className="right num" style={l.partCA < 0.03 && l.partTemps > 0.08 ? { background: 'var(--danger-soft)' } : undefined}>
                    {fmtPct(l.partCA, 0)}
                  </td>
                  <td className="right num">{fmtPct(l.partTemps, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 8 }}>
            Temps hors projet sur la période : {Math.round(syn.joursHorsProjet)} j
            {totalAvecHP > 0 && <> — part facturable : {fmtPct(syn.totalJours / totalAvecHP, 0)}</>}.
            Fond rouge : mission qui consomme beaucoup de temps pour peu de chiffre d'affaires.
          </p>
        </>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------
// Récap CA par mois — la matrice projets × mois de l'Excel de
// pilotage : qui a facturé quoi, quel mois, et ce qui arrive.
// ------------------------------------------------------------------

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function CarteCAMensuel() {
  const { state } = useStore()
  const [annee, setAnnee] = useState(Number(todayISO().slice(0, 4)))

  const donnees = useMemo(() => {
    const parProjet = new Map<string, number[]>()
    const emisParMois = Array(12).fill(0) as number[]
    const encaisseParMois = Array(12).fill(0) as number[]
    const prevuParMois = Array(12).fill(0) as number[]

    for (const f of state.factures) {
      const m = Number(f.emission.slice(5, 7)) - 1
      if (f.emission.slice(0, 4) === String(annee)) {
        if (f.statut === 'prevue') {
          prevuParMois[m] += f.montantHT
        } else {
          if (!parProjet.has(f.projetId)) parProjet.set(f.projetId, Array(12).fill(0))
          parProjet.get(f.projetId)![m] += f.montantHT
          emisParMois[m] += f.montantHT
        }
      }
      if (f.statut === 'encaissee' && f.encaissementReel?.slice(0, 4) === String(annee)) {
        encaisseParMois[Number(f.encaissementReel.slice(5, 7)) - 1] += f.montantHT
      }
    }

    const lignes = [...parProjet.entries()]
      .map(([projetId, mois]) => ({ projetId, mois, total: mois.reduce((s, x) => s + x, 0) }))
      .sort((a, b) => b.total - a.total)
    return { lignes, emisParMois, encaisseParMois, prevuParMois }
  }, [state, annee])

  const cellule = (v: number, cle: string | number, gras = false) => (
    <td key={cle} className="right num" style={gras ? { fontWeight: 650 } : undefined}>
      {v > 0 ? fmtMoney(v) : <span className="muted">·</span>}
    </td>
  )

  return (
    <Card
      titre={`CA facturé par mois — ${annee}`}
      actions={
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <button className="btn btn-small" onClick={() => setAnnee(annee - 1)}>‹</button>
          <strong>{annee}</strong>
          <button className="btn btn-small" onClick={() => setAnnee(annee + 1)}>›</button>
        </span>
      }
    >
      {donnees.lignes.length === 0 && donnees.prevuParMois.every((x) => x === 0) ? (
        <EmptyState>Aucune facture sur {annee}.</EmptyState>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Mission</th>
                {MOIS_COURTS.map((m) => (
                  <th key={m} className="right">{m}</th>
                ))}
                <th className="right">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ fontWeight: 650 }}>
                <td>Total émis HT</td>
                {donnees.emisParMois.map((v, i) => cellule(v, i, true))}
                {cellule(donnees.emisParMois.reduce((s, x) => s + x, 0), 'total', true)}
              </tr>
              <tr className="muted">
                <td>dont encaissé (date réelle)</td>
                {donnees.encaisseParMois.map((v, i) => cellule(v, i))}
                {cellule(donnees.encaisseParMois.reduce((s, x) => s + x, 0), 'total')}
              </tr>
              <tr className="muted">
                <td>à venir (prévu à l'échéancier)</td>
                {donnees.prevuParMois.map((v, i) => cellule(v, i))}
                {cellule(donnees.prevuParMois.reduce((s, x) => s + x, 0), 'total')}
              </tr>
              {donnees.lignes.map((l) => (
                <tr key={l.projetId}>
                  <td>
                    <a href={`#/projets/${l.projetId}`} title={nomProjet(state, l.projetId)}>
                      {nomProjet(state, l.projetId).slice(0, 38)}
                    </a>
                  </td>
                  {l.mois.map((v, i) => cellule(v, i))}
                  {cellule(l.total, 'total', true)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>
        Montants HT par date d'émission — la ligne « encaissé » suit la date réelle d'encaissement,
        « à venir » lit l'échéancier prévisionnel. Le pendant de la feuille Trésorerie de l'Excel,
        rempli tout seul par la facturation.
      </p>
    </Card>
  )
}

export default function Analyse() {
  const { state } = useStore()
  const auj = todayISO()
  const [d1, setD1] = useState(`${Number(auj.slice(0, 4)) - 1}-01-01`)
  const [f1, setF1] = useState(auj)
  const [d2, setD2] = useState(addDays(auj, -90))
  const [f2, setF2] = useState(auj)

  const objectif = coutJourObjectif(state)

  return (
    <Page
      titre="Analyse — chaque mission paie-t-elle sa journée ?"
      sousTitre="Le coût du temps est calculé personne par personne (salaire réel chargé, réglé dans Paramètres → Équipe) — pas de forfait. Vert : la mission couvre les coûts fixes ; rouge : elle en vit."
    >
      <div className="grid3" style={{ marginBottom: 16 }}>
        <Stat
          label="Seuil de rentabilité (€/jour facturable)"
          value={fmtMoney(objectif)}
          sub="coûts équipe chargés + frais généraux, par jour facturable visé"
        />
        <Stat
          label="Coût d'agence annuel"
          value={fmtMoney(coutAgenceAnnuel(state))}
          sub={<a href="#/parametres">équipe & frais généraux → Paramètres</a>}
        />
        <Stat
          label="Lecture"
          value="€ / jour réel"
          sub="CA facturé de la période ÷ jours pointés — la vérité d'une mission"
        />
      </div>

      <CarteCAMensuel />
      <TableauPeriode titre="Période 1" debut={d1} fin={f1} setDebut={setD1} setFin={setF1} />
      <TableauPeriode titre="Période 2 (comparaison)" debut={d2} fin={f2} setDebut={setD2} setFin={setF2} />
    </Page>
  )
}
