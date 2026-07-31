// ============================================================
// Calendrier — TOUTES les dates qui comptent, au même endroit :
// rendus de phases, factures à émettre, encaissements attendus,
// remises d'AO, réunions de chantier, obligations, relances CRM,
// décennales, lancements/clôtures. Chaque pastille est cliquable
// et mène à sa source. Zéro saisie : tout vient des données.
// ============================================================

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { Badge, Btn, Card, Icon, useToday } from '../ui'
import { addDays, mondayOf, todayISO } from '../util'
// `evenements()` vivait ici, où il ne servait qu'à la grille mensuelle.
// L'accueil en a besoin pour ses « prochaines échéances » (CDC §8.1) :
// la fonction est remontée dans derive.ts — un seul inventaire des dates
// qui comptent, deux écrans qui le lisent.
import { evenements } from '../derive'
import type { EvtCal } from '../derive'

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const JOURS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']

export function EcheancesContenu() {
  const { state } = useStore()
  const today = useToday()
  const [annee, setAnnee] = useState(Number(todayISO().slice(0, 4)))
  const [mois, setMois] = useState(Number(todayISO().slice(5, 7))) // 1..12

  const evts = useMemo(() => {
    const parJour = new Map<string, EvtCal[]>()
    for (const e of evenements(state)) {
      if (!parJour.has(e.date)) parJour.set(e.date, [])
      parJour.get(e.date)!.push(e)
    }
    return parJour
  }, [state])

  const naviguer = (delta: number) => {
    const m = mois + delta
    if (m < 1) {
      setMois(12)
      setAnnee(annee - 1)
    } else if (m > 12) {
      setMois(1)
      setAnnee(annee + 1)
    } else {
      setMois(m)
    }
  }

  const premier = `${annee}-${String(mois).padStart(2, '0')}-01`
  const debutGrille = mondayOf(premier)
  const jours = Array.from({ length: 42 }, (_, i) => addDays(debutGrille, i))
  // 5 semaines suffisent parfois : on coupe la 6e si elle est hors mois
  const grille = jours[35].slice(5, 7) === premier.slice(5, 7) ? jours : jours.slice(0, 35)

  const moisCourant = todayISO().slice(0, 7)
  const iciEtMaintenant = `${annee}-${String(mois).padStart(2, '0')}` === moisCourant

  return (
    <>
      <p className="small muted" style={{ margin: '0 0 4px' }}>
        Toutes les échéances au même endroit. Cliquez une pastille pour ouvrir sa source.
      </p>
      <div className="toolbar">
        <Btn onClick={() => naviguer(-1)}>‹</Btn>
        <Btn onClick={() => naviguer(1)}>›</Btn>
        <Btn
          onClick={() => {
            setAnnee(Number(todayISO().slice(0, 4)))
            setMois(Number(todayISO().slice(5, 7)))
          }}
          disabled={iciEtMaintenant}
        >
          Aujourd'hui
        </Btn>
        <span style={{ fontSize: 18, fontWeight: 700 }}>
          {NOMS_MOIS[mois - 1]} {annee}
        </span>
        {!iciEtMaintenant && <Badge tone="muted">autre mois</Badge>}
      </div>

      <Card>
        <div className="cal-grille">
          {JOURS.map((j) => (
            <div key={j} className="cal-nom-jour muted small" style={{ fontWeight: 700, textAlign: 'center', padding: '2px 0' }}>
              {j}
            </div>
          ))}
          {grille.map((jour, idx) => {
            const dansMois = jour.slice(5, 7) === premier.slice(5, 7)
            const duJour = evts.get(jour) || []
            const estAujourdhui = jour === today
            return (
              <div
                key={jour}
                className={`cal-jour${dansMois ? '' : ' cal-hors-mois'}${duJour.length === 0 ? ' cal-vide' : ''}`}
                data-jour={`${JOURS[idx % 7]} ${Number(jour.slice(8, 10))}${estAujourdhui ? " — aujourd'hui" : ''}`}
                style={{
                  border: `1px solid ${estAujourdhui ? 'var(--accent)' : 'var(--line)'}`,
                  borderWidth: estAujourdhui ? 2 : 1,
                  borderRadius: 8,
                  padding: 4,
                  background: dansMois ? undefined : 'var(--bg-soft, #f6f7fa)',
                  opacity: dansMois ? 1 : 0.55,
                }}
              >
                <div className="small cal-num" style={{ fontWeight: estAujourdhui ? 800 : 600, color: estAujourdhui ? 'var(--accent)' : undefined }}>
                  {Number(jour.slice(8, 10))}
                </div>
                {duJour.map((e, i) => (
                  <a
                    key={i}
                    href={e.lien}
                    title={e.titreLong}
                    className={`cal-evt${i >= 4 ? ' cal-evt-extra' : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      lineHeight: '16px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: e.couleur,
                      textDecoration: 'none',
                      fontWeight: 600,
                    }}
                  >
                    {e.icon ? (
                      <Icon name={e.icon} size={12} />
                    ) : (
                      <span style={{ fontSize: 8 }}>●</span>
                    )}
                    <span className="cal-evt-court" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.label}</span>
                    <span className="cal-evt-long">{e.titreLong}</span>
                  </a>
                ))}
                {duJour.length > 4 && (
                  <div className="muted cal-evt-plus" style={{ fontSize: 10 }} title={duJour.slice(4).map((e) => e.titreLong).join('\n')}>
                    +{duJour.length - 4} autre(s)
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Les rendez-vous Google Agenda du jour restent visibles sur l'accueil, avec les
          réunions de chantier — ce calendrier montre les échéances issues de vos données de
          pilotage, dont l'accueil reprend les quatorze prochains jours.
        </p>
      </Card>
    </>
  )
}
