// ============================================================
// Développement commercial — le pipeline en Kanban (type Pipedrive).
// Colonnes = étapes d'une consultation (à étudier → Go → déposée →
// gagnée / perdue). On déplace une carte d'un clic ; la valeur du
// pipeline se somme par colonne. « Gagnée » crée le projet tout seul.
// Plus une colonne « Prospects à relancer » nourrie du CRM.
// ============================================================

import { useState } from 'react'
import type { AppState, Consultation, StatutConsultation } from '../types'
import { useStore } from '../store'
import { Badge, Btn, Card, EmptyState, Money, Page, navigate, useToday } from '../ui'
import { diffDays, fmtMoney, todayISO } from '../util'
import { creerProjetDepuisConsultation } from '../consultations'

interface Colonne {
  statut: StatutConsultation
  titre: string
  couleur: string
}

// le pipeline « vivant » (no_go est rangé avec perdue en fin de tableau)
const COLONNES: Colonne[] = [
  { statut: 'a_etudier', titre: 'À étudier', couleur: '#0e7490' },
  { statut: 'go', titre: 'Go — à monter', couleur: '#2563eb' },
  { statut: 'deposee', titre: 'Déposée', couleur: '#7c3aed' },
  { statut: 'gagnee', titre: 'Gagnée', couleur: '#16a34a' },
]

/** étape suivante / précédente dans le flux principal */
const FLUX: StatutConsultation[] = ['a_etudier', 'go', 'deposee', 'gagnee']

function CarteConsultation({ c }: { c: Consultation }) {
  const { update } = useStore()
  const today = useToday()
  const idx = FLUX.indexOf(c.statut)
  const dj = c.dateLimite ? diffDays(today, c.dateLimite) : null

  const deplacer = (statut: StatutConsultation) =>
    update((d) => {
      const x = d.consultations.find((y) => y.id === c.id)
      if (!x) return
      x.statut = statut
      // gagnée sans projet encore lié → l'espace projet se crée tout seul
      if (statut === 'gagnee' && !x.projetId) {
        x.projetId = creerProjetDepuisConsultation(d, x)
      }
    })

  return (
    <div className="card" style={{ padding: 10, marginBottom: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>
        {c.intitule.length > 84 ? c.intitule.slice(0, 84) + '…' : c.intitule}
      </div>
      <div className="muted small" style={{ marginTop: 3 }}>
        {c.acheteur || '—'}
        {c.budgetTravaux ? <> · <Money v={c.budgetTravaux} /></> : null}
      </div>
      <div className="small" style={{ marginTop: 4 }}>
        {c.dateLimite && dj !== null && (
          <Badge tone={dj < 0 ? 'muted' : dj <= 7 ? 'danger' : dj <= 15 ? 'warn' : 'ok'}>
            {dj < 0 ? 'close' : `J−${dj}`}
          </Badge>
        )}{' '}
        {c.projetId && <a href={`#/projets/${c.projetId}`} className="badge badge-info">{c.projetId}</a>}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
        {idx > 0 && (
          <Btn small onClick={() => deplacer(FLUX[idx - 1])} title="Étape précédente">◀</Btn>
        )}
        {idx >= 0 && idx < FLUX.length - 1 && (
          <Btn small kind="primary" onClick={() => deplacer(FLUX[idx + 1])} title="Étape suivante">
            {FLUX[idx + 1] === 'gagnee' ? '🏆 Gagnée' : 'Suivante ▶'}
          </Btn>
        )}
        {c.statut !== 'perdue' && c.statut !== 'gagnee' && (
          <Btn small kind="ghost" onClick={() => deplacer('perdue')} title="Marquer perdue / No-Go">✕ Perdue</Btn>
        )}
        <a className="btn btn-small btn-ghost" href="#/ao" title="Ouvrir la fiche complète">fiche</a>
      </div>
      {c.statut === 'gagnee' && c.projetId && (
        <div className="small ok-text" style={{ marginTop: 4 }}>✓ projet {c.projetId} créé</div>
      )}
    </div>
  )
}

function ColonneKanban({ colonne, consultations }: { colonne: Colonne; consultations: Consultation[] }) {
  const total = consultations.reduce((s, c) => s + (c.budgetTravaux || 0), 0)
  return (
    <div style={{ flex: '1 1 220px', minWidth: 220 }}>
      <div style={{ borderTop: `3px solid ${colonne.couleur}`, paddingTop: 6, marginBottom: 8 }}>
        <div style={{ fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
          <span>{colonne.titre}</span>
          <span className="muted">{consultations.length}</span>
        </div>
        {total > 0 && <div className="muted small">{fmtMoney(total)} de travaux</div>}
      </div>
      {consultations.length === 0 ? (
        <div className="muted small" style={{ padding: '8px 0' }}>—</div>
      ) : (
        consultations.map((c) => <CarteConsultation key={c.id} c={c} />)
      )}
    </div>
  )
}

function ProspectsARelancer({ state }: { state: AppState }) {
  const today = todayISO()
  const prospects = state.contacts
    .filter((c) => c.type === 'Prospect')
    .sort((a, b) => (a.dateProchaineAction || '9999').localeCompare(b.dateProchaineAction || '9999'))
  const valeur = prospects.reduce((s, c) => s + (c.valeurEstimee || 0), 0)

  if (prospects.length === 0) return null
  return (
    <Card titre={`Prospects à relancer — ${fmtMoney(valeur)} de valeur estimée`}>
      {prospects.map((c) => {
        const enRetard = c.dateProchaineAction && c.dateProchaineAction < today
        return (
          <div key={c.id} className="small" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
            <div>
              <strong>{c.nom}</strong>
              {c.organisme ? <span className="muted"> · {c.organisme}</span> : null}
              {c.prochaineAction ? <div className="muted">{c.prochaineAction}</div> : null}
            </div>
            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              {c.valeurEstimee ? <Money v={c.valeurEstimee} /> : null}
              {c.dateProchaineAction && (
                <div>
                  <Badge tone={enRetard ? 'danger' : 'muted'}>{enRetard ? 'en retard' : c.dateProchaineAction}</Badge>
                </div>
              )}
            </div>
          </div>
        )
      })}
      <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
        <Btn small onClick={() => navigate('/agenda')}>Ouvrir le CRM →</Btn>
      </div>
    </Card>
  )
}

export default function Developpement() {
  const { state } = useStore()
  const [voirPerdues, setVoirPerdues] = useState(false)

  const parStatut = (statut: StatutConsultation) => state.consultations.filter((c) => c.statut === statut)
  const perdues = state.consultations.filter((c) => c.statut === 'perdue' || c.statut === 'no_go')

  const totalPipeline = state.consultations
    .filter((c) => ['a_etudier', 'go', 'deposee'].includes(c.statut))
    .reduce((s, c) => s + (c.budgetTravaux || 0), 0)

  return (
    <Page
      titre="Développement commercial"
      sousTitre="Chaque consultation avance d'un clic ; « Gagnée » crée le projet."
    >
      <div className="grid3" style={{ marginBottom: 16 }}>
        <Card titre="Pipeline actif (hors gagné/perdu)">
          <div style={{ fontSize: 24, fontWeight: 700 }}>{fmtMoney(totalPipeline)}</div>
          <div className="muted small">travaux estimés en cours d'étude / dépôt</div>
        </Card>
        <Card titre="Gagnées">
          <div style={{ fontSize: 24, fontWeight: 700 }} className="ok-text">{parStatut('gagnee').length}</div>
          <div className="muted small">consultations remportées</div>
        </Card>
        <Card titre="À étudier">
          <div style={{ fontSize: 24, fontWeight: 700 }}>{parStatut('a_etudier').length}</div>
          <div className="muted small">nouvelles opportunités — <a href="#/ao">veille AO</a></div>
        </Card>
      </div>

      <Card titre="Pipeline des consultations">
        {state.consultations.length === 0 ? (
          <EmptyState>
            Aucune consultation — la veille <a href="#/ao">Appels d'offres</a> les alimente automatiquement.
          </EmptyState>
        ) : (
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', alignItems: 'flex-start' }}>
            {COLONNES.map((col) => (
              <ColonneKanban key={col.statut} colonne={col} consultations={parStatut(col.statut)} />
            ))}
          </div>
        )}
        {perdues.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Btn small kind="ghost" onClick={() => setVoirPerdues((v) => !v)}>
              {voirPerdues ? 'Masquer' : 'Voir'} les perdues / No-Go ({perdues.length})
            </Btn>
            {voirPerdues && (
              <div className="muted small" style={{ marginTop: 8 }}>
                {perdues.map((c) => (
                  <div key={c.id} style={{ padding: '3px 0' }}>
                    ✕ {c.intitule.slice(0, 80)} — {c.acheteur || '—'}
                    {c.motifsResultat ? ` · ${c.motifsResultat}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <ProspectsARelancer state={state} />
    </Page>
  )
}
