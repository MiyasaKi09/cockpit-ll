// ============================================================
// Analyse — la question qui compte : chaque mission paie-t-elle
// sa journée de travail ? €/jour réel par projet, comparé au
// seuil des coûts fixes, sur DEUX PÉRIODES COMPARABLES (année vs
// année précédente, 90 j vs 90 j précédents, ou libre vs période
// précédente équivalente) — plus un histogramme mensuel et le
// classement des missions autour de l'objectif.
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
import { RecapDerives } from './Temps'
import { Badge, Card, EmptyState, Page, Stat, Table } from '../ui'
import { addDays, diffDays, fmtDate, fmtMoney, fmtPct, todayISO } from '../util'

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function CouleurParJour({ v, objectif }: { v: number | null; objectif: number }) {
  if (v === null) return <span className="muted">—</span>
  const tone = v >= objectif ? 'ok-text' : v >= objectif * 0.6 ? 'warn-text' : 'danger-text'
  return <strong className={tone}>{fmtMoney(v)}</strong>
}

function ChampDate({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  return (
    <input
      className="input"
      type="date"
      value={value}
      style={{ width: 150 }}
      aria-label={ariaLabel}
      onChange={(e) => e.target.value && onChange(e.target.value)}
    />
  )
}

// ---------- histogramme mensuel émis / encaissé / prévisionnel ----------

/** barres groupées en CSS pur — couleurs --graph-1/2/3 validées (CVD, contraste)
 *  dans les deux thèmes ; les valeurs exactes vivent dans la matrice dessous */
function HistogrammeMensuel({ annee }: { annee: number }) {
  const { state } = useStore()
  const cam = useMemo(() => caParMois(state, annee), [state, annee])
  const series = [
    { cle: 'émis', valeurs: cam.emisParMois, couleur: 'var(--graph-1)' },
    { cle: 'encaissé', valeurs: cam.encaisseParMois, couleur: 'var(--graph-2)' },
    { cle: 'prévu', valeurs: cam.prevuParMois, couleur: 'var(--graph-3)' },
  ]
  const maxV = Math.max(1, ...series.flatMap((s) => s.valeurs))

  return (
    <div>
      <div className="graphe-mois" role="img" aria-label={`CA ${annee} par mois : émis, encaissé, prévisionnel`}>
        {MOIS_COURTS.map((m, i) => (
          <div
            key={m}
            className="graphe-col"
            title={`${m} ${annee} — émis ${fmtMoney(cam.emisParMois[i])} · encaissé ${fmtMoney(cam.encaisseParMois[i])} · prévu ${fmtMoney(cam.prevuParMois[i])}`}
          >
            <div className="graphe-barres">
              {series.map((s) => (
                <span
                  key={s.cle}
                  className="graphe-barre"
                  style={{ height: `${Math.round((s.valeurs[i] / maxV) * 100)}%`, background: s.couleur }}
                />
              ))}
            </div>
            <div className="graphe-label">{m.replace('.', '')}</div>
          </div>
        ))}
      </div>
      <p className="small" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '8px 0 0' }}>
        {series.map((s) => (
          <span key={s.cle} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: s.couleur, display: 'inline-block' }} />
            {s.cle}
          </span>
        ))}
        <span className="muted">— survolez un mois pour le détail ; chiffres exacts dans la matrice dessous.</span>
      </p>
    </div>
  )
}

// ---------- récap CA par mois (matrice = la vue table du graphique) ----------

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
          <button className="btn btn-small" onClick={() => setAnnee(annee - 1)} aria-label="Année précédente">‹</button>
          <strong>{annee}</strong>
          <button className="btn btn-small" onClick={() => setAnnee(annee + 1)} aria-label="Année suivante">›</button>
        </span>
      }
    >
      {donnees.lignes.length === 0 && donnees.prevuParMois.every((x) => x === 0) ? (
        <EmptyState>Aucune facture sur {annee}.</EmptyState>
      ) : (
        <>
          <HistogrammeMensuel annee={annee} />
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <table className="table table-compact">
              <thead>
                <tr>
                  <th className="col-figee">Mission</th>
                  {MOIS_COURTS.map((m) => (
                    <th key={m} className="right">{m}</th>
                  ))}
                  <th className="right">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ fontWeight: 650 }}>
                  <td className="col-figee">Total émis HT</td>
                  {donnees.emisParMois.map((v, i) => cellule(v, i, true))}
                  {cellule(donnees.emisParMois.reduce((s, x) => s + x, 0), 'total', true)}
                </tr>
                <tr className="muted">
                  <td className="col-figee">dont encaissé (date réelle)</td>
                  {donnees.encaisseParMois.map((v, i) => cellule(v, i))}
                  {cellule(donnees.encaisseParMois.reduce((s, x) => s + x, 0), 'total')}
                </tr>
                <tr className="muted">
                  <td className="col-figee">à venir (prévu à l'échéancier)</td>
                  {donnees.prevuParMois.map((v, i) => cellule(v, i))}
                  {cellule(donnees.prevuParMois.reduce((s, x) => s + x, 0), 'total')}
                </tr>
                {donnees.lignes.map((l) => (
                  <tr key={l.projetId}>
                    <td className="col-figee">
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
        </>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>
        Montants HT par date d'émission — « encaissé » suit la date réelle d'encaissement,
        « à venir » lit l'échéancier prévisionnel.
      </p>
    </Card>
  )
}

// ---------- classement des missions autour de l'objectif €/jour ----------

function CarteClassement({ debut, fin }: { debut: string; fin: string }) {
  const { state } = useStore()
  const objectif = coutJourObjectif(state)
  const syn = useMemo(() => analyserPeriode(state, debut, fin), [state, debut, fin])
  const lignes = syn.lignes.filter((l) => l.parJour !== null).sort((a, b) => (b.parJour ?? 0) - (a.parJour ?? 0))
  const maxV = Math.max(objectif * 1.3, ...lignes.map((l) => l.parJour ?? 0))

  if (lignes.length === 0) return null

  return (
    <Card titre={`Classement €/jour — autour de l'objectif de ${fmtMoney(objectif)}`}>
      <div style={{ position: 'relative', display: 'grid', rowGap: 6 }}>
        {/* seuil : trait vertical étiqueté — la position porte le message */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: `calc(180px + (100% - 180px) * ${Math.min(1, objectif / maxV)})`,
            top: -4,
            bottom: -4,
            width: 2,
            background: 'var(--ink)',
            opacity: 0.55,
            zIndex: 1,
          }}
          title={`objectif ${fmtMoney(objectif)} / jour`}
        />
        {lignes.map((l) => {
          const v = l.parJour ?? 0
          const ok = v >= objectif
          const largeur = Math.max(1, Math.min(100, (v / maxV) * 100))
          return (
            <div key={l.projetId} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8, alignItems: 'center' }}>
              <a className="small" href={`#/projets/${l.projetId}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nomProjet(state, l.projetId)}
              </a>
              <div style={{ position: 'relative', height: 22, background: 'var(--bg-soft)', borderRadius: 2 }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 2,
                    bottom: 2,
                    width: `${largeur}%`,
                    background: ok ? 'var(--graph-2)' : 'var(--graph-3)',
                    borderRadius: 2,
                  }}
                />
                {/* la valeur est TOUJOURS écrite — jamais la couleur seule ;
                    barre longue → étiquette DANS la barre (sinon ça déborde) */}
                {largeur > 68 ? (
                  <span className="small num" style={{ position: 'absolute', right: 8, top: 1, whiteSpace: 'nowrap', color: '#fff', fontWeight: 700 }}>
                    {fmtMoney(v)} {ok ? '✓' : ''}
                  </span>
                ) : (
                  <span className="small num" style={{ position: 'absolute', left: `calc(${largeur}% + 6px)`, top: 1, whiteSpace: 'nowrap' }}>
                    {fmtMoney(v)} {ok ? '✓' : ''}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        €/jour réel (CA facturé ÷ jours pointés) sur la période — le trait vertical est l'objectif
        « payer tous les coûts fixes ». ✓ = mission au-dessus de l'objectif.
      </p>
    </Card>
  )
}

// ---------- comparaison A / B sur des durées équivalentes ----------

type Preset = 'annees' | 'quatrevingtdix' | 'libre'

export function CarteComparaison() {
  const { state } = useStore()
  const auj = todayISO()
  const objectif = coutJourObjectif(state)
  const [preset, setPreset] = useState<Preset>('annees')
  const [debutLibre, setDebutLibre] = useState(addDays(auj, -90))
  const [finLibre, setFinLibre] = useState(auj)

  const annee = Number(auj.slice(0, 4))
  const { A, B, libelleA, libelleB } = useMemo(() => {
    if (preset === 'annees') {
      return {
        A: { debut: `${annee}-01-01`, fin: auj },
        B: { debut: `${annee - 1}-01-01`, fin: `${annee - 1}${auj.slice(4)}` },
        libelleA: `${annee}`,
        libelleB: `${annee - 1} (même fenêtre)`,
      }
    }
    if (preset === 'quatrevingtdix') {
      return {
        A: { debut: addDays(auj, -89), fin: auj },
        B: { debut: addDays(auj, -179), fin: addDays(auj, -90) },
        libelleA: '90 derniers jours',
        libelleB: '90 jours précédents',
      }
    }
    const duree = Math.max(0, diffDays(debutLibre, finLibre))
    return {
      A: { debut: debutLibre, fin: finLibre },
      B: { debut: addDays(debutLibre, -(duree + 1)), fin: addDays(debutLibre, -1) },
      libelleA: `${fmtDate(debutLibre)} → ${fmtDate(finLibre)}`,
      libelleB: 'période précédente équivalente',
    }
  }, [preset, annee, auj, debutLibre, finLibre])

  const synA = useMemo(() => analyserPeriode(state, A.debut, A.fin), [state, A.debut, A.fin])
  const synB = useMemo(() => analyserPeriode(state, B.debut, B.fin), [state, B.debut, B.fin])

  // toutes les missions présentes dans A ou B
  const ids = [...new Set([...synA.lignes.map((l) => l.projetId), ...synB.lignes.map((l) => l.projetId)])]
  const lignes = ids
    .map((id) => ({
      id,
      a: synA.lignes.find((l) => l.projetId === id),
      b: synB.lignes.find((l) => l.projetId === id),
    }))
    .sort((x, y) => (y.a?.ca ?? 0) - (x.a?.ca ?? 0))

  const ecart = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null || b == null) return <span className="muted">—</span>
    const d = a - b
    return <Badge tone={d >= 0 ? 'ok' : 'danger'}>{d >= 0 ? '+' : ''}{fmtMoney(d)}</Badge>
  }

  return (
    <Card
      titre="Comparaison — deux périodes de même durée"
      actions={
        <span className="segmente" role="group" aria-label="Choix des périodes comparées">
          <button aria-pressed={preset === 'annees'} onClick={() => setPreset('annees')}>
            {annee} vs {annee - 1}
          </button>
          <button aria-pressed={preset === 'quatrevingtdix'} onClick={() => setPreset('quatrevingtdix')}>
            90 j vs 90 j préc.
          </button>
          <button aria-pressed={preset === 'libre'} onClick={() => setPreset('libre')}>
            Libre
          </button>
        </span>
      }
    >
      {preset === 'libre' && (
        <div className="toolbar">
          <ChampDate value={debutLibre} onChange={setDebutLibre} ariaLabel="Début de la période A" />
          <span className="muted small">→</span>
          <ChampDate value={finLibre} onChange={setFinLibre} ariaLabel="Fin de la période A" />
          <span className="muted small">— comparée à la période précédente de même durée</span>
        </div>
      )}
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        <strong>A</strong> : {libelleA} · <strong>B</strong> : {libelleB} — mêmes durées, la
        comparaison veut dire quelque chose.
      </p>

      {synA.lignes.length === 0 && synB.lignes.length === 0 ? (
        <EmptyState>Aucune facture émise ni heure pointée sur ces périodes.</EmptyState>
      ) : (
        <Table
          compact
          head={[
            'Mission',
            <span key="caa" className="right">CA A</span>,
            <span key="cab" className="right">CA B</span>,
            <span key="ja" className="right">€/jour A</span>,
            <span key="jb" className="right">€/jour B</span>,
            <span key="e" className="right">Écart €/jour</span>,
          ]}
        >
          <tr style={{ fontWeight: 650 }}>
            <td>Total / moyenne</td>
            <td className="right num">{fmtMoney(synA.totalCA)}</td>
            <td className="right num">{fmtMoney(synB.totalCA)}</td>
            <td className="right"><CouleurParJour v={synA.parJourMoyen} objectif={objectif} /></td>
            <td className="right"><CouleurParJour v={synB.parJourMoyen} objectif={objectif} /></td>
            <td className="right">{ecart(synA.parJourMoyen, synB.parJourMoyen)}</td>
          </tr>
          {lignes.map(({ id, a, b }) => (
            <tr key={id}>
              <td>
                <a href={`#/projets/${id}`} title={nomProjet(state, id)}>
                  {nomProjet(state, id).slice(0, 44)}
                </a>
              </td>
              <td className="right num">{a ? fmtMoney(a.ca) : <span className="muted">·</span>}</td>
              <td className="right num">{b ? fmtMoney(b.ca) : <span className="muted">·</span>}</td>
              <td className="right"><CouleurParJour v={a?.parJour ?? null} objectif={objectif} /></td>
              <td className="right"><CouleurParJour v={b?.parJour ?? null} objectif={objectif} /></td>
              <td className="right">{ecart(a?.parJour ?? null, b?.parJour ?? null)}</td>
            </tr>
          ))}
        </Table>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>
        Temps hors projet — A : {Math.round(synA.joursHorsProjet)} j · B : {Math.round(synB.joursHorsProjet)} j.
        Le €/jour est en couleur ET en chiffres : vert ≥ objectif, ocre ≥ 60 %, rouge en dessous.
      </p>
    </Card>
  )
}

// ---------- module ----------

/** vue Missions de la page Pilotage — le €/jour réel par mission */
export function MissionsContenu() {
  const { state } = useStore()
  const auj = todayISO()

  const objectif = coutJourObjectif(state)
  const annee = Number(auj.slice(0, 4))

  return (
    <>
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
      <CarteClassement debut={`${annee}-01-01`} fin={auj} />
      <RecapDerives />
    </>
  )
}
