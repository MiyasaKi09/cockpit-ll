// Onglet Planning de l'espace projet : LE projet, seul, sur une échelle
// de temps — phases de conception en haut, lots de chantier en dessous,
// réunions à venir en repères. Lecture d'un coup d'œil ; l'édition des
// dates vit dans la fiche (phases) et l'onglet Chantier (lots).

import type { Projet } from '../types'
import { useStore } from '../store'
import { Badge, Card, EmptyState, useToday } from '../ui'
import { diffDays, fmtDate } from '../util'
import { couleurPhase } from './Planning'

const NOMS_MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

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
  const reunionsAVenir = state.reunions
    .filter((r) => r.projetId === p.id && r.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3)

  const dates = [
    ...phases.flatMap((ph) => [ph.debut!, ph.fin!]),
    ...lots.flatMap((m) => [m.dateDebut, m.dateFin, m.dateReception].filter((d): d is string => Boolean(d))),
  ].sort()

  if (dates.length === 0) {
    return (
      <Card titre="Planning du projet">
        <EmptyState>
          Rien de daté pour l'instant — datez les phases (onglet Pilotage, « Modifier les phases »)
          et les lots (onglet Chantier) pour voir le planning se dessiner.
        </EmptyState>
      </Card>
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
    <div key={cle} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, alignItems: 'center', minWidth: 560 }}>
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
    <Card
      titre="Planning du projet"
      actions={<a href="#/planning" className="small">tous les projets →</a>}
    >
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', rowGap: 6 }}>
          {/* graduations mois */}
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, minWidth: 560 }}>
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
        Trait rouge = aujourd'hui · triangle vert = réception · bord rouge = lot en retard.
      </p>
    </Card>
  )
}
