// Coquille de l'application : barre latérale + routage hash.

import { useEffect, useState } from 'react'
import { useStore } from './store'
import { ConfirmHost, Icon, ToastHost, useRoute, useToday } from './ui'
import { alertesActives } from './alerts'
import { basculerTheme, themeCourant } from './theme'

import Cockpit from './modules/Cockpit'
import RechercheOverlay from './modules/RechercheOverlay'
import Analyse from './modules/Analyse'
import Projets from './modules/Projets'
import Situations from './modules/Situations'
import Facturation from './modules/Facturation'
import Temps from './modules/Temps'
import VeilleAO from './modules/VeilleAO'
import Claude from './modules/Claude'
import Classement from './modules/Classement'
import Ressources from './modules/Ressources'
import Agenda from './modules/Agenda'
import Parametres from './modules/Parametres'
import Planning from './modules/Planning'

const NAV: { groupe: string; items: { path: string; label: string }[] }[] = [
  {
    groupe: 'Piloter',
    items: [
      { path: '', label: 'Cockpit' },
      { path: 'planning', label: 'Planning' },
      { path: 'analyse', label: 'Analyse €/jour' },
    ],
  },
  {
    groupe: 'Produire',
    items: [
      { path: 'projets', label: 'Projets' },
      { path: 'situations', label: 'Situations' },
      { path: 'facturation', label: 'Factures' },
      { path: 'temps', label: 'Temps' },
    ],
  },
  {
    groupe: 'Développer',
    items: [{ path: 'ao', label: 'Développement & AO' }],
  },
  {
    groupe: 'Ressources',
    items: [
      { path: 'ressources', label: 'Matériaux & artisans' },
      { path: 'agenda', label: 'Contacts & obligations' },
    ],
  },
  {
    groupe: 'Claude',
    items: [{ path: 'prompts', label: 'Prompts & routines' }],
  },
  {
    groupe: 'Réglages',
    items: [{ path: 'parametres', label: 'Paramètres' }],
  },
]

export default function App() {
  const route = useRoute()
  const { state } = useStore()
  const today = useToday()
  const nbAlertes = alertesActives(state, today).filter((a) => a.gravite >= 2).length
  const [theme, setTheme] = useState(themeCourant())
  const [rechercheOuverte, setRechercheOuverte] = useState(false)

  // « / » depuis n'importe où (hors champ de saisie) → palette de recherche
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const cible = e.target as HTMLElement | null
      if (cible && (['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName) || cible.isContentEditable)) return
      e.preventDefault()
      setRechercheOuverte(true)
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
    case 'analyse':
      page = <Analyse />
      break
    case 'demarrer':
      page = <Parametres ongletInitial="demarrer" />
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
      page = <VeilleAO ongletInitial="pipeline" />
      break
    case 'ao':
      page = <VeilleAO />
      break
    case 'references':
      page = <VeilleAO ongletInitial="references" />
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
      page = <Parametres ongletInitial="branchements" />
      break
    case 'calendrier':
      page = <Planning ongletInitial="echeances" />
      break
    case 'planning':
      page = <Planning />
      break
    default:
      page = <Cockpit />
  }

  return (
    <>
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          Cockpit L&L
          <small>intranet v2 — sans API</small>
        </div>
        <button className="nav-search" onClick={() => setRechercheOuverte(true)} title="Recherche globale">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Icon name="search" size={14} />
            Rechercher…
          </span>
          <kbd>/</kbd>
        </button>
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
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
            {theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
          </button>
        </div>
      </aside>
      <main className="main">{page}</main>
    </div>
    {rechercheOuverte && <RechercheOverlay onClose={() => setRechercheOuverte(false)} />}
    <ToastHost />
    <ConfirmHost />
    </>
  )
}
