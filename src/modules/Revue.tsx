// ============================================================
// Revue de pilotage — le point hebdo/mensuel à deux : CA, marge,
// temps et alertes agrégés sur une période, en un écran, exportable
// en PDF. Tout est dérivé de l'état (aucune donnée propre).
// ============================================================

import { useMemo, useState } from 'react'
import type { Alerte } from '../types'
import { useStore } from '../store'
import {
  analyserPeriode,
  caCible,
  caParMois,
  caRealiseAnnee,
  coutJourObjectif,
  nomProjet,
  tempsParPersonne,
} from '../derive'
import { alertesActives } from '../alerts'
import { Badge, Btn, Card, EmptyState, Icon, Money, Page, Progress, Stat, useToday } from '../ui'
import { ouvrirRevuePDF } from '../pdf'
import { addDays, addMonths, fmtDate, fmtMoney, fmtPct, monthKey } from '../util'

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

const GROUPES_ALERTES: { gravite: Alerte['gravite']; label: string }[] = [
  { gravite: 3, label: 'Critique' },
  { gravite: 2, label: 'À surveiller' },
  { gravite: 1, label: 'Pour information' },
]

type Preset = 'mois' | 'trimestre' | 'annee' | 'perso'

/** dernier jour du mois AAAA-MM */
function finDeMois(ym: string): string {
  return addDays(`${addMonths(ym, 1)}-01`, -1)
}

function bornes(preset: Exclude<Preset, 'perso'>, today: string): [string, string] {
  const ym = monthKey(today)
  if (preset === 'mois') return [`${ym}-01`, finDeMois(ym)]
  if (preset === 'annee') return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`]
  // trimestre courant
  const m = Number(today.slice(5, 7))
  const debutMois = Math.floor((m - 1) / 3) * 3 + 1
  const ymDebut = `${today.slice(0, 4)}-${String(debutMois).padStart(2, '0')}`
  return [`${ymDebut}-01`, finDeMois(addMonths(ymDebut, 2))]
}

function ChampDate({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="input"
      type="date"
      value={value}
      style={{ width: 148 }}
      onChange={(e) => e.target.value && onChange(e.target.value)}
    />
  )
}

function toneParJour(v: number | null, objectif: number): 'ok' | 'warn' | 'danger' | undefined {
  if (v === null) return undefined
  return v >= objectif ? 'ok' : v >= objectif * 0.6 ? 'warn' : 'danger'
}

export default function Revue() {
  const { state } = useStore()
  const today = useToday()
  const [preset, setPreset] = useState<Preset>('mois')
  const initial = bornes('mois', today)
  const [debut, setDebut] = useState(initial[0])
  const [fin, setFin] = useState(initial[1])

  const choisir = (p: Exclude<Preset, 'perso'>) => {
    const [d, f] = bornes(p, today)
    setPreset(p)
    setDebut(d)
    setFin(f)
  }
  const majDebut = (v: string) => { setPreset('perso'); setDebut(v) }
  const majFin = (v: string) => { setPreset('perso'); setFin(v) }

  const syn = useMemo(() => analyserPeriode(state, debut, fin), [state, debut, fin])
  const tpp = useMemo(() => tempsParPersonne(state, debut, fin), [state, debut, fin])
  const objectif = coutJourObjectif(state)
  const annee = Number(debut.slice(0, 4))
  const cam = useMemo(() => caParMois(state, annee), [state, annee])
  const caRealise = caRealiseAnnee(state, annee)
  const cible = caCible(state)
  const alertes = alertesActives(state, today)

  const encaisse = useMemo(
    () =>
      state.factures
        .filter((f) => f.statut === 'encaissee' && f.encaissementReel && f.encaissementReel >= debut && f.encaissementReel <= fin)
        .reduce((acc, f) => acc + f.montantHT, 0),
    [state.factures, debut, fin],
  )
  const marge = syn.totalCA - syn.totalCoutTemps - syn.totalCoutExterne
  const facturesPeriode = useMemo(
    () =>
      state.factures
        .filter((f) => f.statut === 'prevue' && f.emission >= debut && f.emission <= fin)
        .sort((a, b) => a.emission.localeCompare(b.emission)),
    [state.factures, debut, fin],
  )

  const libellePeriode =
    preset === 'mois' ? `Mois · ${fmtDate(debut)}`
      : preset === 'trimestre' ? 'Trimestre courant'
        : preset === 'annee' ? `Année ${annee}`
          : `${fmtDate(debut)} → ${fmtDate(fin)}`

  return (
    <Page
      titre="revue"
      wordmark
      meta={`Pilotage · ${libellePeriode}`}
      actions={
        <Btn kind="primary" onClick={() => ouvrirRevuePDF(state, debut, fin)}>
          <Icon name="printer" size={14} /> Imprimer / PDF
        </Btn>
      }
    >
      {/* ---------- sélecteur de période ---------- */}
      <div className="toolbar" style={{ marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {([['mois', 'Mois'], ['trimestre', 'Trimestre'], ['annee', 'Année']] as const).map(([p, label]) => (
            <Btn key={p} small kind={preset === p ? 'primary' : 'default'} onClick={() => choisir(p)}>
              {label}
            </Btn>
          ))}
        </span>
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <ChampDate value={debut} onChange={majDebut} />
          <span className="muted small">→</span>
          <ChampDate value={fin} onChange={majFin} />
        </span>
      </div>

      {/* ---------- bandeau KPI ---------- */}
      <div className="grid4" style={{ marginBottom: 16 }}>
        <Stat accent="yellow" label="CA émis (période)" value={<Money v={syn.totalCA} />} />
        <Stat accent="blue" label="Encaissé (période)" value={<Money v={encaisse} />} />
        <Stat
          accent="red"
          label="Marge réelle"
          value={<Money v={marge} />}
          tone={marge < 0 ? 'danger' : undefined}
        />
        <Stat
          label="€ / jour réel"
          value={syn.parJourMoyen !== null ? fmtMoney(syn.parJourMoyen) : '—'}
          sub={`objectif ${fmtMoney(objectif)}`}
          tone={toneParJour(syn.parJourMoyen, objectif)}
        />
      </div>

      {/* ---------- jauge CA année ---------- */}
      {cible > 0 && (
        <Card titre={`Objectif de chiffre d'affaires ${annee}`}>
          <Progress
            value={caRealise}
            max={cible}
            header={
              <>
                <span>
                  {fmtMoney(caRealise)} <span className="muted">/ {fmtMoney(cible)} HT</span>
                </span>
                <Badge tone={caRealise >= cible ? 'ok' : caRealise >= cible * 0.6 ? 'warn' : 'danger'}>
                  {fmtPct(cible > 0 ? caRealise / cible : 0, 0)}
                </Badge>
              </>
            }
          />
          <p className="muted small" style={{ marginTop: 8 }}>
            CA facturé (émis ou encaissé) de l'année vs cible. Reste à faire :{' '}
            <strong>{fmtMoney(Math.max(0, cible - caRealise))}</strong>.
          </p>
        </Card>
      )}

      {/* ---------- marge par mission ---------- */}
      <Card titre="Marge par mission — période">
        {syn.lignes.length === 0 ? (
          <EmptyState>Aucune facture émise ni heure pointée sur la période.</EmptyState>
        ) : (
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Mission</th>
                <th className="right">CA HT</th>
                <th className="right">Coût temps</th>
                <th className="right">Marge</th>
                <th className="right">Jours</th>
                <th className="right">€ / jour</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ fontWeight: 650 }}>
                <td>Total / moyenne</td>
                <td className="right num">{fmtMoney(syn.totalCA)}</td>
                <td className="right num">{fmtMoney(syn.totalCoutTemps)}</td>
                <td className={`right num ${marge < 0 ? 'danger-text' : 'ok-text'}`}>{fmtMoney(marge)}</td>
                <td className="right num">{Math.round(syn.totalJours)}</td>
                <td className={`right num ${syn.parJourMoyen !== null && syn.parJourMoyen < objectif ? 'warn-text' : ''}`}>
                  {syn.parJourMoyen !== null ? fmtMoney(syn.parJourMoyen) : '—'}
                </td>
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
                  <td className={`right num ${l.parJour !== null && l.parJour < objectif ? 'warn-text' : ''}`}>
                    {l.parJour !== null ? fmtMoney(l.parJour) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ---------- temps par personne ---------- */}
      <Card titre="Temps pointé par personne — période">
        {tpp.length === 0 ? (
          <EmptyState>Aucune heure pointée sur la période.</EmptyState>
        ) : (
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Personne</th>
                <th className="right">Heures</th>
                <th className="right">Jours</th>
                <th className="right">Coût réel</th>
              </tr>
            </thead>
            <tbody>
              {tpp.map((l) => (
                <tr key={l.personne}>
                  <td>{l.personne}</td>
                  <td className="right num">{Math.round(l.heures)} h</td>
                  <td className="right num">{Math.round(l.jours * 10) / 10}</td>
                  <td className="right num">{fmtMoney(l.cout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ---------- CA par mois ---------- */}
      <Card titre={`CA facturé par mois — ${annee}`}>
        {cam.lignes.length === 0 && cam.prevuParMois.every((x) => x === 0) ? (
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
                  {cam.emisParMois.map((v, i) => (
                    <td key={i} className="right num">{v > 0 ? fmtMoney(v) : <span className="muted">·</span>}</td>
                  ))}
                  <td className="right num">{fmtMoney(cam.emisParMois.reduce((s, x) => s + x, 0))}</td>
                </tr>
                <tr className="muted">
                  <td>dont encaissé</td>
                  {cam.encaisseParMois.map((v, i) => (
                    <td key={i} className="right num">{v > 0 ? fmtMoney(v) : '·'}</td>
                  ))}
                  <td className="right num">{fmtMoney(cam.encaisseParMois.reduce((s, x) => s + x, 0))}</td>
                </tr>
                <tr className="muted">
                  <td>à venir (prévu)</td>
                  {cam.prevuParMois.map((v, i) => (
                    <td key={i} className="right num">{v > 0 ? fmtMoney(v) : '·'}</td>
                  ))}
                  <td className="right num">{fmtMoney(cam.prevuParMois.reduce((s, x) => s + x, 0))}</td>
                </tr>
                {cam.lignes.map((l) => (
                  <tr key={l.projetId}>
                    <td>
                      <a href={`#/projets/${l.projetId}`} title={nomProjet(state, l.projetId)}>
                        {nomProjet(state, l.projetId).slice(0, 38)}
                      </a>
                    </td>
                    {l.mois.map((v, i) => (
                      <td key={i} className="right num">{v > 0 ? fmtMoney(v) : <span className="muted">·</span>}</td>
                    ))}
                    <td className="right num" style={{ fontWeight: 650 }}>{fmtMoney(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------- échéances à émettre sur la période ---------- */}
      <Card titre="Factures à émettre sur la période">
        {facturesPeriode.length === 0 ? (
          <EmptyState>Aucune facture prévue à émettre entre ces deux dates.</EmptyState>
        ) : (
          <table className="table table-compact">
            <thead>
              <tr>
                <th>N°</th>
                <th>Projet</th>
                <th>Libellé</th>
                <th className="right">HT</th>
                <th className="right">Prévue le</th>
              </tr>
            </thead>
            <tbody>
              {facturesPeriode.map((f) => (
                <tr key={f.id}>
                  <td>{f.id}</td>
                  <td><a href={`#/projets/${f.projetId}`}>{f.projetId}</a></td>
                  <td>{f.libelle}</td>
                  <td className="right num">{fmtMoney(f.montantHT)}</td>
                  <td className="right">{fmtDate(f.emission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ---------- alertes actives ---------- */}
      <Card
        titre="Alertes actives"
        actions={<span className="muted small">{alertes.length} active{alertes.length > 1 ? 's' : ''}</span>}
      >
        {alertes.length === 0 ? (
          <EmptyState>Rien à signaler — tout est à jour.</EmptyState>
        ) : (
          GROUPES_ALERTES.map(({ gravite, label }) => {
            const lot = alertes.filter((a) => a.gravite === gravite)
            if (lot.length === 0) return null
            return (
              <div key={gravite} style={{ marginBottom: 8 }}>
                <div className="small" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-3)', margin: '8px 2px 4px' }}>
                  {label} · {lot.length}
                </div>
                {lot.map((a) => (
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
              </div>
            )
          })
        )}
      </Card>
    </Page>
  )
}
