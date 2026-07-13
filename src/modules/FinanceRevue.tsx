// ============================================================
// Finance — Revue de direction (audit F7/F8). Une seule vue :
// F7 orchestre les demandes hors-périmètre (détection → pipeline
// → chiffrage → avenant SIGNÉ, seule étape qui ajoute une ligne
// active au contrat) et les jalons facturables (→ échéance
// interne) ; F8 rassemble les 8 sections dans l'ordre imposé.
// ============================================================

import { useMemo, useState } from 'react'
import type { PisteAvenant } from '../types'
import { useStore } from '../store'
import { Badge, Btn, Card, DateInput, EmptyState, Field, Money, NumInput, Page, Select, Table, TextInput, confirmer, toast, useToday } from '../ui'
import FinanceNav from './FinanceNav'
import { detectionsHorsPerimetre, jalonsFacturables, revueDirection, type DetectionHorsPerimetre } from '../revue'
import { appliquerAvenant, contratDuProjet } from '../contrats'
import { nomProjet } from '../derive'
import { fmtDate, fmtMoney, uid } from '../util'

// ---------- section « à faire » : hors périmètre → pipeline → avenant ----------

function CarteHorsPerimetre() {
  const { state, update } = useStore()
  const today = useToday()
  const detections = useMemo(() => detectionsHorsPerimetre(state), [state])
  const pistes = state.pistesAvenant.filter((p) => p.statut !== 'ecartee' && p.statut !== 'confirmee')
  const [chiffrage, setChiffrage] = useState<Record<string, number | null>>({})

  const promouvoir = (d: DetectionHorsPerimetre) => {
    const piste: PisteAvenant = {
      id: uid('pa'),
      projetId: d.projetId,
      contratId: d.projetId ? contratDuProjet(state, d.projetId)?.id ?? null : null,
      origine: d.origine,
      origineType: d.origineType,
      libelle: d.detail,
      statut: 'au_pipeline',
      creeLe: today,
    }
    update((s) => {
      s.pistesAvenant.push(piste)
    })
    toast('Ajouté au pipeline — à chiffrer puis confirmer l’avenant signé.', { tone: 'ok' })
  }

  const chiffrer = (p: PisteAvenant) => {
    const montant = chiffrage[p.id]
    if (montant == null || montant <= 0) return toast('Indiquer un montant estimé.', { tone: 'danger' })
    update((s) => {
      const x = s.pistesAvenant.find((y) => y.id === p.id)
      if (x) {
        x.montantEstimeHT = montant
        x.statut = 'chiffree'
      }
    })
    toast('Piste chiffrée — reste à confirmer l’avenant SIGNÉ.', { tone: 'ok' })
  }

  const confirmerSigne = async (p: PisteAvenant) => {
    if (p.montantEstimeHT == null) return toast('Chiffrer la piste d’abord.', { tone: 'danger' })
    const contrat = (p.contratId && state.contrats.find((c) => c.id === p.contratId)) || (p.projetId ? contratDuProjet(state, p.projetId) : undefined)
    if (!contrat)
      return toast('Aucun contrat client rattaché — impossible d’ajouter la ligne d’avenant.', { tone: 'danger' })
    if (contrat.provisoire)
      return toast('Contrat encore provisoire : le valider (Contrats & budgets) avant d’y passer un avenant.', { tone: 'danger' })
    if (
      !(await confirmer({
        message: `Confirmer l'avenant SIGNÉ « ${p.libelle} » (${fmtMoney(p.montantEstimeHT)} HT) ?\n\nUne ligne ACTIVE sera ajoutée au contrat « ${contrat.intitule} ». C'est la seule étape qui modifie le contrat.`,
        confirmerLabel: 'Confirmer l’avenant',
      }))
    )
      return
    // avenant calculé AVANT la mutation (producteur rejouable)
    const avenantId = uid('av')
    const suivant = appliquerAvenant(
      contrat,
      { id: avenantId, date: today, motif: `Avenant hors-périmètre — ${p.libelle}` },
      { ajouter: [{ nature: 'complementaire', designation: p.libelle, quantite: 1, unite: 'forfait', prixUnitaireHT: p.montantEstimeHT, etat: 'active' }] },
    )
    update((s) => {
      s.contrats = s.contrats.map((c) => (c.id === suivant.id ? suivant : c))
      const x = s.pistesAvenant.find((y) => y.id === p.id)
      if (x) {
        x.statut = 'confirmee'
        x.avenantId = avenantId
      }
    })
    toast('Avenant confirmé — ligne active ajoutée au contrat, total mis à jour.', { tone: 'ok' })
  }

  const ecarter = (p: PisteAvenant) =>
    update((s) => {
      const x = s.pistesAvenant.find((y) => y.id === p.id)
      if (x) x.statut = 'ecartee'
    })

  return (
    <Card titre="4 · Hors périmètre & avenants potentiels">
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        Le Cockpit DÉTECTE les expressions hors-périmètre dans les courriers, CR et journaux. Vous les
        ajoutez au pipeline, les chiffrez, puis confirmez l'avenant signé — cette dernière étape SEULE ajoute
        une ligne active au contrat.
      </p>

      {detections.length > 0 && (
        <>
          <div className="small" style={{ fontWeight: 650, margin: '4px 0' }}>Détections ({detections.length})</div>
          <Table compact head={['Origine', 'Extrait', 'Projet', '']}>
            {detections.slice(0, 8).map((d) => (
              <tr key={d.cle}>
                <td className="small">{d.detail}<div className="muted">{fmtDate(d.date)}</div></td>
                <td className="small">« {d.origine} »</td>
                <td>{d.projetId || '—'}</td>
                <td><Btn small kind="primary" onClick={() => promouvoir(d)}>Ajouter au pipeline</Btn></td>
              </tr>
            ))}
          </Table>
        </>
      )}

      <div className="small" style={{ fontWeight: 650, margin: '12px 0 4px' }}>Pipeline ({pistes.length})</div>
      {pistes.length === 0 ? (
        <EmptyState>Aucune piste au pipeline.</EmptyState>
      ) : (
        <Table compact head={['Demande', 'Projet', <span key="m" className="right">Estimé HT</span>, 'État', '']}>
          {pistes.map((p) => (
            <tr key={p.id}>
              <td>{p.libelle}<div className="muted small" title={p.origine}>« {p.origine.slice(0, 60)} »</div></td>
              <td>{p.projetId || '—'}</td>
              <td className="right" style={{ minWidth: 120 }}>
                {p.statut === 'chiffree' ? (
                  <Money v={p.montantEstimeHT || 0} />
                ) : (
                  <NumInput value={chiffrage[p.id] ?? null} onChange={(v) => setChiffrage((c) => ({ ...c, [p.id]: v }))} style={{ width: 100 }} />
                )}
              </td>
              <td>{p.statut === 'chiffree' ? <Badge tone="info">chiffrée</Badge> : <Badge tone="muted">au pipeline</Badge>}</td>
              <td>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {p.statut !== 'chiffree' && <Btn small onClick={() => chiffrer(p)}>Chiffrer</Btn>}
                  {p.statut === 'chiffree' && <Btn small kind="primary" onClick={() => void confirmerSigne(p)}>Confirmer l’avenant signé</Btn>}
                  <Btn small onClick={() => ecarter(p)}>Écarter</Btn>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  )
}

// ---------- section « à faire » : jalons facturables → échéance interne ----------

function CarteJalons() {
  const { state, update } = useStore()
  const today = useToday()
  const jalons = useMemo(() => jalonsFacturables(state, today), [state, today])

  const creerEcheance = (j: (typeof jalons)[number]) => {
    const projet = state.projets.find((p) => p.id === j.projetId)
    const delai = projet ? state.settings.delaisPaiement[projet.typeMO] : 30
    const echeance = {
      id: uid('ech'),
      projetId: j.projetId,
      phase: (j.phase || 'MC') as (typeof state.echeancesFacturation)[number]['phase'],
      libelle: j.ligne.designation,
      montantHT: j.montantHT,
      tauxTVA: 0.2,
      datePrevue: today,
      delaiJours: delai,
      contratLigneId: j.ligne.id,
    }
    update((s) => {
      s.echeancesFacturation.push(echeance)
    })
    toast('Échéance interne créée — le numéro légal reste attribué à l’émission (Ventes).', { tone: 'ok' })
  }

  return (
    <Card titre={`5 · Jalons facturables (${jalons.length})`}>
      {jalons.length === 0 ? (
        <EmptyState>Aucune ligne contractuelle à jalon atteint sans facture ni échéance.</EmptyState>
      ) : (
        <Table compact head={['Projet', 'Ligne', <span key="m" className="right">À facturer HT</span>, 'Raison', '']}>
          {jalons.map((j, i) => (
            <tr key={`${j.ligne.id}-${i}`}>
              <td><a href={`#/projets/${j.projetId}`} title={nomProjet(state, j.projetId)}>{j.projetId}</a></td>
              <td>{j.ligne.designation}</td>
              <td className="right"><Money v={j.montantHT} /></td>
              <td className="small muted">{j.raison}</td>
              <td><Btn small kind="primary" onClick={() => creerEcheance(j)}>Créer l’échéance</Btn></td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  )
}

// ---------- section décisions ----------

function CarteDecisions() {
  const { state, update } = useStore()
  const today = useToday()
  const [sujet, setSujet] = useState('')
  const [responsable, setResponsable] = useState(state.settings.personnes[0] || '')
  const [echeance, setEcheance] = useState<string | null>(null)
  const decisions = [...state.decisionsDirection].sort((a, b) => {
    const rang = { a_faire: 0, en_cours: 1, faite: 2 } as const
    return rang[a.statut] - rang[b.statut] || (a.echeance || '9999').localeCompare(b.echeance || '9999')
  })

  const ajouter = () => {
    if (!sujet.trim()) return toast('Indiquer un sujet.', { tone: 'danger' })
    const d = { id: uid('dec'), sujet: sujet.trim(), responsable: responsable || undefined, echeance, statut: 'a_faire' as const, creeLe: today }
    update((s) => {
      s.decisionsDirection.push(d)
    })
    setSujet('')
    setEcheance(null)
    toast('Décision ajoutée.', { tone: 'ok' })
  }
  const avancer = (id: string, statut: 'a_faire' | 'en_cours' | 'faite') =>
    update((s) => {
      const x = s.decisionsDirection.find((y) => y.id === id)
      if (x) {
        x.statut = statut
        x.faiteLe = statut === 'faite' ? today : null
      }
    })

  return (
    <Card titre={`8 · Décisions (${decisions.filter((d) => d.statut !== 'faite').length} ouverte(s))`}>
      <div className="form-row" style={{ marginBottom: 10 }}>
        <Field label="Nouvelle décision">
          <TextInput value={sujet} onChange={setSujet} placeholder="ex. Revoir le prix cible du taux horaire" />
        </Field>
        <Field label="Responsable">
          <Select value={responsable} onChange={setResponsable} options={state.settings.personnes.map((p) => ({ value: p, label: p }))} />
        </Field>
        <Field label="Échéance">
          <DateInput value={echeance} onChange={setEcheance} />
        </Field>
        <Field label="&nbsp;">
          <Btn kind="primary" onClick={ajouter}>Ajouter</Btn>
        </Field>
      </div>
      {decisions.length === 0 ? (
        <EmptyState>Aucune décision.</EmptyState>
      ) : (
        <Table compact head={['Sujet', 'Responsable', 'Échéance', 'Statut', '']}>
          {decisions.map((d) => (
            <tr key={d.id} style={d.statut === 'faite' ? { opacity: 0.6 } : undefined}>
              <td>{d.sujet}</td>
              <td>{d.responsable || '—'}</td>
              <td className={d.echeance && d.echeance < today && d.statut !== 'faite' ? 'danger-text' : undefined}>{d.echeance ? fmtDate(d.echeance) : '—'}</td>
              <td>{d.statut === 'faite' ? <Badge tone="ok">faite</Badge> : d.statut === 'en_cours' ? <Badge tone="info">en cours</Badge> : <Badge tone="warn">à faire</Badge>}</td>
              <td>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {d.statut === 'a_faire' && <Btn small onClick={() => avancer(d.id, 'en_cours')}>Démarrer</Btn>}
                  {d.statut !== 'faite' && <Btn small kind="primary" onClick={() => avancer(d.id, 'faite')}>Fait</Btn>}
                  {d.statut === 'faite' && <Btn small onClick={() => avancer(d.id, 'en_cours')}>Rouvrir</Btn>}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  )
}

export default function FinanceRevue() {
  const { state } = useStore()
  const today = useToday()
  // ordre imposé F8 : 1 points bas · 2 retards · 3 clôture · 4 hors-périmètre ·
  // 5 jalons · 6 marges qui dérivent · 7 consultations · 8 décisions
  const sections = revueDirection(state, today)
  const parCle = Object.fromEntries(sections.map((s) => [s.cle, s]))
  const carteSimple = (cle: string) => {
    const sec = parCle[cle]
    if (!sec) return null
    return (
      <Card key={cle} titre={sec.titre}>
        {sec.lignes.map((l, i) => (
          <div key={i} className="small" style={{ padding: '3px 0' }}>
            <span className={l.tone === 'danger' ? 'danger-text' : l.tone === 'ok' ? 'ok-text' : l.tone === 'warn' ? 'warn-text' : undefined}>
              {l.lien ? <a href={l.lien}>{l.texte}</a> : l.texte}
            </span>
          </div>
        ))}
      </Card>
    )
  }

  return (
    <Page titre="Finance" sousTitre="Revue de direction — la chaîne de pilotage, dans l'ordre.">
      <FinanceNav actif="revue" />
      {carteSimple('pointsbas')}
      {carteSimple('retards')}
      {carteSimple('cloture')}
      <CarteHorsPerimetre />
      <CarteJalons />
      {carteSimple('derive')}
      {carteSimple('consultations')}
      <CarteDecisions />
    </Page>
  )
}
