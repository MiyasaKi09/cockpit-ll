// Coquille de l'application : barre latérale + routage hash.

import { useEffect, useState } from 'react'
import { useStore } from './store'
import { navigate, useRoute, useToday } from './ui'
import { alertesActives } from './alerts'
import { basculerTheme, themeCourant } from './theme'

import Cockpit from './modules/Cockpit'
import BienDemarrer from './modules/BienDemarrer'
import Recherche from './modules/Recherche'
import Analyse from './modules/Analyse'
import Projets from './modules/Projets'
import Situations from './modules/Situations'
import Facturation from './modules/Facturation'
import Temps from './modules/Temps'
import Developpement from './modules/Developpement'
import VeilleAO from './modules/VeilleAO'
import References from './modules/References'
import Claude from './modules/Claude'
import Classement from './modules/Classement'
import Ressources from './modules/Ressources'
import Agenda from './modules/Agenda'
import Parametres from './modules/Parametres'
import Sante from './modules/Sante'
import Calendrier from './modules/Calendrier'
import Planning from './modules/Planning'

const NAV: { groupe: string; items: { path: string; label: string }[] }[] = [
  {
    groupe: 'Pilotage',
    items: [
      { path: '', label: 'Cockpit' },
      { path: 'calendrier', label: 'Calendrier' },
      { path: 'planning', label: 'Planning' },
      { path: 'recherche', label: 'Recherche ( / )' },
      { path: 'demarrer', label: 'Bien démarrer' },
      { path: 'projets', label: 'Projets' },
      { path: 'situations', label: 'Situations de travaux' },
      { path: 'facturation', label: 'Factures & relances' },
      { path: 'temps', label: 'Temps' },
      { path: 'analyse', label: 'Analyse €/jour' },
    ],
  },
  {
    groupe: 'Développement',
    items: [
      { path: 'developpement', label: 'Pipeline commercial' },
      { path: 'ao', label: "Appels d'offres" },
      { path: 'references', label: 'Références' },
    ],
  },
  {
    groupe: 'Claude',
    items: [{ path: 'prompts', label: 'Prompts & routines' }],
  },
  {
    groupe: 'Ressources',
    items: [
      { path: 'classement', label: 'Classement documentaire' },
      { path: 'ressources', label: 'Matériaux & artisans' },
      { path: 'agenda', label: 'Obligations & contacts' },
    ],
  },
  {
    groupe: 'Agence',
    items: [
      { path: 'sante', label: 'Santé des branchements' },
      { path: 'parametres', label: 'Paramètres & données' },
    ],
  },
]

export default function App() {
  const route = useRoute()
  const { state } = useStore()
  const today = useToday()
  const nbAlertes = alertesActives(state, today).filter((a) => a.gravite >= 2).length
  const [theme, setTheme] = useState(themeCourant())

  // « / » depuis n'importe où (hors champ de saisie) → Recherche
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const cible = e.target as HTMLElement | null
      if (cible && (['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName) || cible.isContentEditable)) return
      e.preventDefault()
      navigate('/recherche')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const [section] = route

  let page
  switch (section) {
    case '':
      page = <Cockpit />
      break
    case 'recherche':
      page = <Recherche />
      break
    case 'analyse':
      page = <Analyse />
      break
    case 'demarrer':
      page = <BienDemarrer />
      break
    case 'projets':
      page = <Projets />
      break
    case 'situations':
      page = <Situations />
      break
    case 'facturation':
      page = <Facturation />
      break
    case 'temps':
      page = <Temps />
      break
    case 'developpement':
      page = <Developpement />
      break
    case 'ao':
      page = <VeilleAO />
      break
    case 'references':
      page = <References />
      break
    case 'prompts':
      page = <Claude />
      break
    case 'routines':
      page = <Claude ongletInitial="routines" />
      break
    case 'classement':
      page = <Classement />
      break
    case 'ressources':
      page = <Ressources />
      break
    case 'agenda':
      page = <Agenda />
      break
    case 'parametres':
      page = <Parametres />
      break
    case 'sante':
      page = <Sante />
      break
    case 'calendrier':
      page = <Calendrier />
      break
    case 'planning':
      page = <Planning />
      break
    default:
      page = <Cockpit />
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          Cockpit L&L
          <small>intranet v2 — sans API</small>
        </div>
        {NAV.map((g) => (
          <div key={g.groupe}>
            <div className="nav-group">{g.groupe}</div>
            {g.items.map((it) => (
              <a
                key={it.path}
                href={`#/${it.path}`}
                className={`nav-item ${section === it.path ? 'active' : ''}`}
              >
                <span>{it.label}</span>
                {it.path === '' && nbAlertes > 0 && <span className="nav-count">{nbAlertes}</span>}
              </a>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">
          <button
            className="theme-toggle"
            onClick={() => setTheme(basculerTheme())}
            title="Basculer clair / sombre"
          >
            {theme === 'dark' ? '☀ Thème clair' : '☾ Thème sombre'}
          </button>
        </div>
      </aside>
      <main className="main">{page}</main>
    </div>
  )
}
