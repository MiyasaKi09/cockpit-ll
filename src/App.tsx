// Coquille de l'application : barre latérale + routage hash.

import { useEffect, useState } from 'react'
import { useStore } from './store'
import { ConfirmHost, Icon, ToastHost, useRoute, useToday } from './ui'
import { alertesActives } from './alerts'
import { basculerTheme, themeCourant } from './theme'
import { syncActif } from './sync'
import { SurveillanceCtx, useSurveillance } from './surveillance'
import { diffDays } from './util'
import type { AppState } from './types'

import Cockpit from './modules/Cockpit'
import RechercheOverlay from './modules/RechercheOverlay'
import Pilotage from './modules/Pilotage'
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
import Documents from './modules/Documents'
import { AssistantPage } from './modules/Assistant'

// Menu recomposé (audit simplification) : « une page = un objectif ».
// Travail et Gestion restent ouverts ; Agence et Outils se replient,
// l'état est mémorisé sur le poste. Les fonctions rares vivent dans
// la recherche « / » plutôt que dans le menu.
const NAV: { groupe: string; repliable?: boolean; items: { path: string; label: string }[] }[] = [
  {
    groupe: 'Travail',
    items: [
      { path: '', label: "Aujourd'hui" },
      { path: 'projets', label: 'Projets' },
      { path: 'documents', label: 'Documents' },
      { path: 'planning', label: 'Planning' },
      { path: 'temps', label: 'Temps' },
    ],
  },
  {
    groupe: 'Gestion',
    items: [
      { path: 'facturation', label: 'Factures' },
      { path: 'situations', label: 'Situations' },
      { path: 'pilotage', label: 'Pilotage' },
    ],
  },
  {
    groupe: 'Agence',
    repliable: true,
    items: [
      { path: 'ao', label: 'Développement' },
      { path: 'ressources', label: 'Annuaire' },
      { path: 'agenda', label: 'Échéances agence' },
    ],
  },
  {
    groupe: 'Outils',
    repliable: true,
    items: [
      { path: 'assistant', label: 'Assistant' },
      { path: 'automatisations', label: 'Automatisations' },
    ],
  },
]

const CLE_NAV_GROUPES = 'cockpit-ll-nav-groupes'

/** statut compact des données (pied de menu) — le détail vit dans la
 *  santé des données, ouverte au clic */
function statutCompact(state: AppState, today: string): { texte: string; titre: string } {
  if (syncActif()) return { texte: 'synchronisé', titre: 'Espace partagé connecté — les 2 postes voient les mêmes données.' }
  const sauvegarde = state.settings.derniereSauvegarde
  if (!sauvegarde) return { texte: 'local', titre: 'Données locales, aucune sauvegarde JSON — cliquez pour la santé des données.' }
  const jours = diffDays(sauvegarde.slice(0, 10), today)
  return {
    texte: 'local',
    titre: `Données locales · sauvegarde ${jours <= 0 ? "d'aujourd'hui" : jours === 1 ? "d'hier" : `d'il y a ${jours} j`}.`,
  }
}

export default function App() {
  const route = useRoute()
  const { state, update } = useStore()
  const today = useToday()
  // INT-02 : la surveillance Gmail/Agenda tourne à la racine — elle continue
  // de capter les mails quel que soit l'écran affiché (le Cockpit ne fait que lire)
  const surveillance = useSurveillance(state, update)
  const nbAlertes = alertesActives(state, today).filter((a) => a.gravite >= 2).length
  const nbDocsATraiter = state.registreDocuments.filter((d) =>
    ['recu', 'a_classer', 'a_valider'].includes(d.statut),
  ).length
  const [theme, setTheme] = useState(themeCourant())
  const [rechercheOuverte, setRechercheOuverte] = useState(false)
  /** tiroir de navigation mobile (ouvert par le hamburger de la topbar) */
  const [navOuverte, setNavOuverte] = useState(false)
  /** groupes de menu repliables — l'état est mémorisé sur le poste */
  const [groupesOuverts, setGroupesOuverts] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(CLE_NAV_GROUPES) || '{}') as Record<string, boolean>
    } catch {
      return {}
    }
  })
  const basculerGroupe = (g: string) =>
    setGroupesOuverts((prev) => {
      const next = { ...prev, [g]: !(prev[g] ?? false) }
      try {
        localStorage.setItem(CLE_NAV_GROUPES, JSON.stringify(next))
      } catch {
        // stockage plein : l'état vivra le temps de la session
      }
      return next
    })

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
      page = <Pilotage ongletInitial="revue" />
      break
    case 'analyse':
      page = <Pilotage ongletInitial="missions" />
      break
    case 'pilotage':
      page = <Pilotage />
      break
    case 'automatisations':
      page = <Claude />
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
    case 'documents':
      page = <Documents />
      break
    default:
      page = <Cockpit />
  }

  return (
    <SurveillanceCtx.Provider value={surveillance}>
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
        <div className="brand">Cockpit L&L</div>
        <button className="nav-search" onClick={() => setRechercheOuverte(true)} title="Recherche globale">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Icon name="search" size={14} />
            Rechercher…
          </span>
          <kbd>/</kbd>
        </button>
        {NAV.map((g) => {
          // un groupe replié s'ouvre tout seul quand il contient l'écran actif
          const ouvert = !g.repliable || (groupesOuverts[g.groupe] ?? false) || g.items.some((it) => it.path === section)
          return (
            <div key={g.groupe}>
              {g.repliable ? (
                <button
                  className="nav-group nav-group-btn"
                  onClick={() => basculerGroupe(g.groupe)}
                  aria-expanded={ouvert}
                >
                  {g.groupe} <span aria-hidden="true">{ouvert ? '▾' : '▸'}</span>
                </button>
              ) : (
                <div className="nav-group">{g.groupe}</div>
              )}
              {ouvert &&
                g.items.map((it) => (
                  <a
                    key={it.path}
                    href={`#/${it.path}`}
                    className={`nav-item ${g.repliable ? 'nav-item-sec' : ''} ${section === it.path ? 'active' : ''}`}
                  >
                    <span>{it.label}</span>
                    {it.path === '' && nbAlertes > 0 && <span className="nav-count">{nbAlertes}</span>}
                    {it.path === 'documents' && nbDocsATraiter > 0 && (
                      <span className="nav-count">{nbDocsATraiter}</span>
                    )}
                  </a>
                ))}
            </div>
          )
        })}
        <div className="sidebar-foot">
          <a
            href="#/parametres"
            className={`nav-item nav-item-sec ${section === 'parametres' ? 'active' : ''}`}
            style={{ marginBottom: 6 }}
          >
            <span>Paramètres</span>
            <button
              className="nav-statut"
              title={statutCompact(state, today).titre}
              onClick={(e) => {
                e.preventDefault()
                window.location.hash = '#/sante'
              }}
            >
              ● {statutCompact(state, today).texte}
            </button>
          </a>
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
    </SurveillanceCtx.Provider>
  )
}
