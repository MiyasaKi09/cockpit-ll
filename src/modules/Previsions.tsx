// ============================================================
// Finance — Prévisions & rentabilité (audit F9).
// - budget de trésorerie glissant sur 12 mois, explicable mois
//   par mois (flux TTC) ;
// - simulateur sauvegardable d'un nouveau projet (probabilité,
//   délai d'encaissement, heures, coûts externes, embauche,
//   investissement) ;
// - rentabilité FINALE par client (HT) ;
// - coût et ROI attendu des appels d'offres / concours depuis
//   le temps hors projet.
// ============================================================

import { useMemo, useState } from 'react'
import type { SimulationProjet } from '../types'
import { useStore } from '../store'
import { Badge, Btn, Card, EmptyState, Field, Money, NumInput, Page, PctInput, Stat, Table, TextInput, toast, useToday } from '../ui'
import FinanceNav from './FinanceNav'
import { budget12Mois, evaluerSimulation, rentabiliteParClient, roiAppelsOffres } from '../economie'
import { soldeBancaire } from '../banque'
import { fmtDate, fmtMoney, fmtPct, uid } from '../util'

// ---------- budget 12 mois ----------

function CarteBudget12({ today }: { today: string }) {
  const { state } = useStore()
  const banque = soldeBancaire(state)
  const soldeDepart = banque ? banque.solde : state.settings.tresorerieDispo ?? 0
  const source = banque ? 'banque' : state.settings.tresorerieDispo != null ? 'manuel' : 'aucun'
  const budget = useMemo(() => budget12Mois(state, today, soldeDepart, source), [state, today, soldeDepart, source])
  const seuil = state.settings.seuilTresorerie ?? 0
  return (
    <Card titre="Budget de trésorerie — 12 mois glissants (TTC)">
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        Départ {fmtMoney(budget.soldeDepart)} ({source === 'banque' ? 'solde bancaire importé' : source === 'manuel' ? 'solde d’ouverture manuel' : 'aucun solde connu'}).
        Encaissements probabilisés (une facture en retard n'est plus « encaissée aujourd'hui »), récurrents ancrés,
        salaires, frais généraux et TVA paramétrée.
      </p>
      {budget.pointBas.solde < seuil && (
        <div className="pill-note" style={{ marginBottom: 10, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          Point bas : <strong>{fmtMoney(budget.pointBas.solde)}</strong> en {budget.pointBas.mois}
          {seuil > 0 ? ` (seuil ${fmtMoney(seuil)})` : ''}.
        </div>
      )}
      <Table compact head={['Mois', <span key="e" className="right">Entrées</span>, <span key="s" className="right">Sorties</span>, <span key="v" className="right">Variation</span>, <span key="so" className="right">Solde</span>, '']}>
        {budget.mois.map((m) => {
          const totalE = m.entrees.reduce((s, f) => s + f.montant, 0)
          const totalS = m.sorties.reduce((s, f) => s + f.montant, 0)
          return (
            <tr key={m.mois}>
              <td>{m.mois}</td>
              <td className="right num ok-text">{totalE > 0 ? fmtMoney(totalE) : '·'}</td>
              <td className="right num">{totalS < 0 ? fmtMoney(totalS) : '·'}</td>
              <td className={`right num ${m.variation < 0 ? 'danger-text' : ''}`}>{fmtMoney(m.variation)}</td>
              <td className={`right num ${m.solde < seuil ? 'danger-text' : ''}`} style={{ fontWeight: 600 }}>{fmtMoney(m.solde)}</td>
              <td>
                {(m.entrees.length > 0 || m.sorties.length > 0) && (
                  <details>
                    <summary className="small" style={{ cursor: 'pointer' }}>{m.entrees.length + m.sorties.length} flux</summary>
                    {[...m.entrees, ...m.sorties].map((f, i) => (
                      <div key={i} className="small" style={{ padding: '2px 0' }}>
                        <span className={f.montant < 0 ? '' : 'ok-text'}>{fmtMoney(f.montant)}</span> — {f.libelle}
                      </div>
                    ))}
                  </details>
                )}
              </td>
            </tr>
          )
        })}
      </Table>
    </Card>
  )
}

// ---------- simulateur ----------

function CarteSimulateur() {
  const { state, update } = useStore()
  const today = useToday()
  const [nom, setNom] = useState('')
  const [honoraires, setHonoraires] = useState<number | null>(null)
  const [proba, setProba] = useState<number | null>(0.5)
  const [delai, setDelai] = useState<number | null>(45)
  const [heures, setHeures] = useState<number | null>(null)
  const [externes, setExternes] = useState<number | null>(0)
  const [embaucheCout, setEmbaucheCout] = useState<number | null>(null)
  const [investMontant, setInvestMontant] = useState<number | null>(null)

  const brouillon = {
    honorairesHT: honoraires ?? 0,
    probabilite: proba ?? 0,
    heures: heures ?? 0,
    coutsExternesHT: externes ?? 0,
    embauche: embaucheCout ? { moisApres: 0, coutMensuel: embaucheCout } : null,
    investissement: investMontant ? { moisApres: 0, montant: investMontant } : null,
  }
  const res = evaluerSimulation(state, brouillon)

  const sauvegarder = () => {
    if (!nom.trim() || honoraires == null) return toast('Nom et honoraires obligatoires.', { tone: 'danger' })
    const sim: SimulationProjet = {
      id: uid('sim'),
      nom: nom.trim(),
      honorairesHT: honoraires,
      probabilite: proba ?? 0,
      delaiEncaissementJours: delai ?? 45,
      heures: heures ?? 0,
      coutsExternesHT: externes ?? 0,
      embauche: brouillon.embauche,
      investissement: brouillon.investissement,
      creeLe: today,
    }
    update((s) => {
      s.simulations.push(sim)
    })
    toast('Simulation sauvegardée.', { tone: 'ok' })
    setNom('')
  }

  const supprimer = (id: string) =>
    update((s) => {
      s.simulations = s.simulations.filter((x) => x.id !== id)
    })

  return (
    <Card titre="Simulateur de projet (aide à la décision)">
      <div className="form-row">
        <Field label="Nom du projet simulé">
          <TextInput value={nom} onChange={setNom} placeholder="ex. Groupe scolaire — concours" />
        </Field>
        <Field label="Honoraires HT (€)">
          <NumInput value={honoraires} onChange={setHonoraires} />
        </Field>
        <Field label="Probabilité de signature">
          <PctInput value={proba} onChange={setProba} ariaLabel="Probabilité de signature" />
        </Field>
        <Field label="Délai d'encaissement (j)">
          <NumInput value={delai} onChange={setDelai} />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Heures internes">
          <NumInput value={heures} onChange={setHeures} />
        </Field>
        <Field label="Coûts externes HT (€)">
          <NumInput value={externes} onChange={setExternes} />
        </Field>
        <Field label="Embauche — coût mensuel chargé (€)" hint="optionnel">
          <NumInput value={embaucheCout} onChange={setEmbaucheCout} />
        </Field>
        <Field label="Investissement ponctuel (€)" hint="optionnel">
          <NumInput value={investMontant} onChange={setInvestMontant} />
        </Field>
      </div>
      <div className="grid4" style={{ marginTop: 12 }}>
        <Stat label="Honoraires pondérés" value={<Money v={res.honorairesPonderes} />} sub={`${fmtPct(proba ?? 0, 0)} × honoraires`} />
        <Stat label="Coût total estimé" value={<Money v={res.coutTotal} />} sub="interne + externe + embauche + invest." />
        <Stat label="Marge attendue" value={<Money v={res.margeAttendue} />} tone={res.margeAttendue < 0 ? 'danger' : 'ok'} />
        <Stat label="Taux de marge" value={res.tauxMarge != null ? fmtPct(res.tauxMarge, 0) : '—'} />
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <span className="spacer" />
        <Btn kind="primary" onClick={sauvegarder}>Sauvegarder la simulation</Btn>
      </div>
      {state.simulations.length > 0 && (
        <Table compact head={['Simulation', <span key="h" className="right">Honoraires</span>, <span key="p" className="right">Proba</span>, <span key="m" className="right">Marge attendue</span>, '']}>
          {[...state.simulations].sort((a, b) => b.creeLe.localeCompare(a.creeLe)).map((sim) => {
            const r = evaluerSimulation(state, sim)
            return (
              <tr key={sim.id}>
                <td>{sim.nom}<div className="muted small">créée le {fmtDate(sim.creeLe)}</div></td>
                <td className="right num">{fmtMoney(sim.honorairesHT)}</td>
                <td className="right num">{fmtPct(sim.probabilite, 0)}</td>
                <td className={`right num ${r.margeAttendue < 0 ? 'danger-text' : 'ok-text'}`}>{fmtMoney(r.margeAttendue)}</td>
                <td><Btn small onClick={() => supprimer(sim.id)}>Supprimer</Btn></td>
              </tr>
            )
          })}
        </Table>
      )}
    </Card>
  )
}

// ---------- rentabilité par client + ROI AO ----------

function CarteRentabilite() {
  const { state } = useStore()
  const lignes = useMemo(() => rentabiliteParClient(state), [state])
  const roi = useMemo(() => roiAppelsOffres(state), [state])
  return (
    <>
      <Card titre="Rentabilité finale par client (HT)">
        {lignes.length === 0 ? (
          <EmptyState>Aucun projet actif à agréger.</EmptyState>
        ) : (
          <Table compact head={['Client', <span key="n" className="right">Projets</span>, <span key="h" className="right">Honoraires signés</span>, <span key="c" className="right">Coût final</span>, <span key="m" className="right">Marge finale</span>, <span key="t" className="right">Taux</span>]}>
            {lignes.map((l) => (
              <tr key={l.client}>
                <td>{l.client}</td>
                <td className="right num">{l.projets}</td>
                <td className="right num">{fmtMoney(l.honorairesSignes)}</td>
                <td className="right num">{fmtMoney(l.coutFinal)}</td>
                <td className={`right num ${l.margeFinale < 0 ? 'danger-text' : 'ok-text'}`}>{fmtMoney(l.margeFinale)}</td>
                <td className="right num">{l.tauxMarge != null ? fmtPct(l.tauxMarge, 0) : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card titre="Coût & ROI des appels d'offres / concours">
        <div className="grid4">
          <Stat label="Coût de prospection" value={<Money v={roi.coutProspection} />} sub={`${roi.joursProspection} j hors projet (AO)`} />
          <Stat label="Valeur attendue" value={<Money v={roi.valeurAttendue} />} sub={`${roi.nbEnCours} consultation(s) en cours`} />
          <Stat label="ROI attendu" value={roi.roi != null ? `× ${roi.roi}` : '—'} tone={roi.roi != null && roi.roi >= 1 ? 'ok' : roi.roi != null ? 'warn' : undefined} sub="valeur attendue ÷ coût" />
          <Stat label="Repère" value={roi.roi != null && roi.roi >= 3 ? 'bon' : roi.roi != null ? 'à surveiller' : '—'} />
        </div>
        <p className="muted small" style={{ margin: '10px 2px 0' }}>
          Valeur attendue = budget travaux × 10 % d'honoraires × probabilité de la consultation (Radar). Le coût
          de prospection vient du temps hors projet catégorie AO/concours.
        </p>
      </Card>
    </>
  )
}

export default function Previsions() {
  const today = useToday()
  return (
    <Page titre="Finance" sousTitre="Prévisions & rentabilité — projeter et arbitrer.">
      <FinanceNav actif="previsions" />
      <CarteBudget12 today={today} />
      <CarteSimulateur />
      <CarteRentabilite />
    </Page>
  )
}
