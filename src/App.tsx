// Coquille de l'application : barre latérale + routage hash.

import { useStore } from './store'
import { useRoute, useToday } from './ui'
import { alertesActives } from './alerts'

import Cockpit from './modules/Cockpit'
import BienDemarrer from './modules/BienDemarrer'
import Recherche from './modules/Recherche'
import Analyse from './modules/Analyse'
import Projets from './modules/Projets'
import Situations from './modules/Situations'
import Facturation from './modules/Facturation'
import Temps from './modules/Temps'
import VeilleAO from './modules/VeilleAO'
import References from './modules/References'
import Prompts from './modules/Prompts'
import Routines from './modules/Routines'
import Classement from './modules/Classement'
import Ressources from './modules/Ressources'
import Agenda from './modules/Agenda'
import Parametres from './modules/Parametres'

const NAV: { groupe: string; items: { path: string; label: string }[] }[] = [
  {
    groupe: 'Pilotage',
    items: [
      { path: '', label: 'Cockpit' },
      { path: 'recherche', label: 'Recherche' },
      { path: 'demarrer', label: 'Bien démarrer' },
      { path: 'projets', label: 'Projets & marchés' },
      { path: 'situations', label: 'Situations de travaux' },
      { path: 'facturation', label: 'Honoraires & relances' },
      { path: 'temps', label: 'Saisie des temps' },
      { path: 'analyse', label: 'Analyse €/jour' },
    ],
  },
  {
    groupe: 'Développement',
    items: [
      { path: 'ao', label: 'Veille AO & Go/No-Go' },
      { path: 'references', label: 'Base de références' },
    ],
  },
  {
    groupe: 'Claude (sans API)',
    items: [
      { path: 'prompts', label: 'Bibliothèque de prompts' },
      { path: 'routines', label: 'Routines & imports' },
    ],
  },
  {
    groupe: 'Ressources',
    items: [
      { path: 'classement', label: 'Classement documentaire' },
      { path: 'ressources', label: 'Matériaux & artisans' },
      { path: 'agenda', label: 'Réglementaire & CRM' },
    ],
  },
  {
    groupe: 'Agence',
    items: [{ path: 'parametres', label: 'Paramètres & données' }],
  },
]

export default function App() {
  const route = useRoute()
  const { state } = useStore()
  const today = useToday()
  const nbAlertes = alertesActives(state, today).filter((a) => a.gravite >= 2).length

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
    case 'ao':
      page = <VeilleAO />
      break
    case 'references':
      page = <References />
      break
    case 'prompts':
      page = <Prompts />
      break
    case 'routines':
      page = <Routines />
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
      </aside>
      <main className="main">{page}</main>
    </div>
  )
}
