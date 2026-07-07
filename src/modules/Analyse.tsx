// ============================================================
// Analyse — la question qui compte : chaque mission paie-t-elle
// sa journée de travail ? €/jour réel par projet, comparé au
// seuil des coûts fixes, sur deux périodes configurables.
// Mieux que le forfait « 500 €/jour » : ici le coût du temps est
// calculé personne par personne (salaire réel chargé).
// ============================================================

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import {
  analyserPeriode,
  caCible,
  caParMois,
  caRealiseAnnee,
  coutAgenceAnnuel,
  coutJourObjectif,
  nomProjet,
} from '../derive'
import { Badge, Card, EmptyState, Page, Stat } from '../ui'
import { addDays, fmtMoney, fmtPct, todayISO } from '../util'

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
  const syn = useMemo(() => analyserPeriode(state, debut, fin), [state, debut, fin])
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
                <td className="right num" title={syn.totalCoutExterne > 0 ? `dont ${fmtMoney(syn.totalCoutExterne)} de coûts externes déduits de la marge` : undefined}>{fmtMoney(syn.totalCoutTemps)}</td>
                <td className={`right num ${syn.totalCA - syn.totalCoutTemps - syn.totalCoutExterne < 0 ? 'danger-text' : 'ok-text'}`}>
                  {fmtMoney(syn.totalCA - syn.totalCoutTemps - syn.totalCoutExterne)}
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

  const donnees = useMemo(() => caParMois(state, annee), [state, annee])

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
  const annee = Number(auj.slice(0, 4))
  const caRealise = caRealiseAnnee(state, annee)
  const cible = caCible(state)
  const pctCible = cible > 0 ? caRealise / cible : null

  return (
    <Page
      titre="Analyse — chaque mission paie-t-elle sa journée ?"
      sousTitre={
        <>
          Comparaison du €/jour réel par mission sur deux périodes réglables. Pour le bilan daté
          et imprimable de tout le pilotage, voir la <a href="#/revue">Revue de pilotage</a>.
        </>
      }
    >
      {cible > 0 && (
        <Card titre={`Objectif de chiffre d'affaires ${annee}`}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 22, fontWeight: 700 }}>{fmtMoney(caRealise)}</span>
            <span className="muted">/ {fmtMoney(cible)} HT cible</span>
            {pctCible !== null && (
              <Badge tone={pctCible >= 1 ? 'ok' : pctCible >= 0.6 ? 'warn' : 'danger'}>{fmtPct(pctCible, 0)}</Badge>
            )}
          </div>
          <div style={{ background: 'var(--line)', borderRadius: 99, height: 12, overflow: 'hidden', marginTop: 10 }}>
            <div style={{ width: `${Math.min(100, (pctCible ?? 0) * 100)}%`, height: '100%', background: pctCible !== null && pctCible >= 1 ? 'var(--ok)' : pctCible !== null && pctCible >= 0.6 ? 'var(--warn)' : 'var(--danger)' }} />
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            CA facturé (émis ou encaissé) de l'année vs cible réglée dans Paramètres. Reste à faire :{' '}
            <strong>{fmtMoney(Math.max(0, cible - caRealise))}</strong>.
          </p>
        </Card>
      )}
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
