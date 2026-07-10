// Coquille de l'application : barre latérale + routage hash.

import { useEffect, useState } from 'react'
import { useStore } from './store'
import { ConfirmHost, Icon, ToastHost, useRoute, useToday } from './ui'
import { alertesActives } from './alerts'
import { basculerTheme, themeCourant } from './theme'
import { syncActif } from './sync'
import { diffDays } from './util'
import type { AppState } from './types'

import Cockpit from './modules/Cockpit'
import RechercheOverlay from './modules/RechercheOverlay'
import Revue from './modules/Revue'
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
import { AssistantPage } from './modules/Assistant'

// Le moteur temps → marge → facturation est l'interface : six écrans
// quotidiens en tête, le reste en « Atelier » (accessible, discret).
const NAV: { groupe: string; sec?: boolean; items: { path: string; label: string }[] }[] = [
  {
    groupe: 'Quotidien',
    items: [
      { path: '', label: 'Cockpit' },
      { path: 'projets', label: 'Projets' },
      { path: 'temps', label: 'Temps' },
      { path: 'facturation', label: 'Factures' },
      { path: 'analyse', label: 'Analyse €/jour' },
      { path: 'revue', label: 'Revue de pilotage' },
      { path: 'assistant', label: 'Assistant' },
    ],
  },
  {
    groupe: 'Atelier',
    sec: true,
    items: [
      { path: 'situations', label: 'Situations' },
      { path: 'planning', label: 'Planning' },
      { path: 'ao', label: 'Développement & AO' },
      { path: 'ressources', label: 'Matériaux & artisans' },
      { path: 'agenda', label: 'Contacts & obligations' },
      { path: 'prompts', label: 'Prompts & routines' },
    ],
  },
  {
    groupe: 'Réglages',
    sec: true,
    items: [{ path: 'parametres', label: 'Paramètres' }],
  },
]

/** statut réel des données — remplace l'ancien slogan « sans API » :
 *  où vivent les données, et de quand date le dernier filet de sécurité */
function statutDonnees(state: AppState, today: string): string {
  if (syncActif()) return 'Synchronisé (espace partagé)'
  const sauvegarde = state.settings.derniereSauvegarde
  if (!sauvegarde) return 'Local · aucune sauvegarde JSON'
  const jours = diffDays(sauvegarde.slice(0, 10), today)
  return `Local · sauvegarde ${jours <= 0 ? "aujourd'hui" : jours === 1 ? 'hier' : `il y a ${jours} j`}`
}

export default function App() {
  const route = useRoute()
  const { state } = useStore()
  const today = useToday()
  const nbAlertes = alertesActives(state, today).filter((a) => a.gravite >= 2).length
  const [theme, setTheme] = useState(themeCourant())
  const [rechercheOuverte, setRechercheOuverte] = useState(false)
  /** tiroir de navigation mobile (ouvert par le hamburger de la topbar) */
  const [navOuverte, setNavOuverte] = useState(false)

  // changer d'écran referme le tiroir mobile
  const cheminCourant = route.join('/')
  useEffect(() => {
    setNavOuverte(false)
  }, [cheminCourant])

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
    case 'revue':
      page = <Revue />
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
    case 'assistant':
      page = <AssistantPage />
      break
    default:
      page = <Cockpit />
  }

  return (
    <>
    <header className="topbar">
      <button className="topbar-burger" onClick={() => setNavOuverte(true)} title="Ouvrir le menu" aria-label="Ouvrir le menu">
        <Icon name="menu" size={19} />
      </button>
      <div className="brand">Cockpit L&L</div>
      <span className="spacer" />
      <button className="topbar-burger" onClick={() => setRechercheOuverte(true)} title="Recherche globale" aria-label="Recherche globale">
        <Icon name="search" size={17} />
      </button>
    </header>
    <div className="layout">
      {navOuverte && <div className="nav-back" onClick={() => setNavOuverte(false)} />}
      <aside className={`sidebar ${navOuverte ? 'ouverte' : ''}`}>
        <div className="brand">
          Cockpit L&L
          <small>{statutDonnees(state, today)}</small>
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
                className={`nav-item ${g.sec ? 'nav-item-sec' : ''} ${section === it.path ? 'active' : ''}`}
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
