// Coquille de l'application : barre latérale + routage hash.

import { Suspense, lazy, useEffect, useState } from 'react'
import { useStore } from './store'
import { Btn, ConfirmHost, Icon, Select, ToastHost, useRoute, useToday } from './ui'
import { alertesActives } from './alerts'
import { documentsATraiter } from './derive'
import { badgeFinance } from './financeActions'
// 5.21 — le compteur du menu « Entreprises ». Même sélecteur, même prédicat
// (`poids > 0`) que la tuile « Qui demandent une action » de l'écran : le
// menu et l'écran ne peuvent pas annoncer deux nombres différents.
import { entreprisesSuivies } from './entreprise'
import { basculerTheme, themeCourant } from './theme'
import { useMoi, useSessionSupabase } from './moi'
import type { InstantaneSession } from './sync'
import { SurveillanceCtx, useSurveillance } from './surveillance'
import { useMajIndicesInsee } from './majIndices'
import { diffDays } from './util'
import type { AppState } from './types'
import { appliquerMiseAJour, surMiseAJour } from './majApp'

import Cockpit from './modules/Cockpit'

/**
 * M.1 — « une nouvelle version est prête ».
 *
 * Elle ne s'applique JAMAIS toute seule. On saisit des heures et des
 * commentaires dans cette application : un rechargement décidé par la
 * machine au milieu d'une saisie perd ce qui n'est pas enregistré, et la
 * personne croit avoir perdu son travail par sa faute.
 */
function BanniereMiseAJour() {
  const [dispo, setDispo] = useState(false)
  useEffect(() => surMiseAJour(setDispo), [])
  if (!dispo) return null
  return (
    <div className="pill-note" role="status" style={{ marginBottom: 12 }}>
      <strong>Nouvelle version disponible.</strong> Elle s’appliquera au rechargement — terminez
      votre saisie d’abord, rien ne presse.{' '}
      <Btn small kind="primary" onClick={appliquerMiseAJour}>
        Recharger
      </Btn>
    </div>
  )
}
import ChronoBarre from './modules/ChronoBarre'
const Taches = lazy(() => import('./modules/Taches'))
const Parite = lazy(() => import('./modules/Parite'))
const RechercheOverlay = lazy(() => import('./modules/RechercheOverlay'))
const Pilotage = lazy(() => import('./modules/Pilotage'))
const Projets = lazy(() => import('./modules/Projets'))
const Situations = lazy(() => import('./modules/Situations'))
const Facturation = lazy(() => import('./modules/Facturation'))
const Contrats = lazy(() => import('./modules/Contrats'))
const Finance = lazy(() => import('./modules/Finance'))
const Achats = lazy(() => import('./modules/Achats'))
const Banque = lazy(() => import('./modules/Banque'))
const Comptable = lazy(() => import('./modules/Comptable'))
const FinanceRevue = lazy(() => import('./modules/FinanceRevue'))
const Previsions = lazy(() => import('./modules/Previsions'))
const Connecteurs = lazy(() => import('./modules/Connecteurs'))
const Temps = lazy(() => import('./modules/Temps'))
const VeilleAO = lazy(() => import('./modules/VeilleAO'))
const Claude = lazy(() => import('./modules/Claude'))
const Ressources = lazy(() => import('./modules/Ressources'))
const Agenda = lazy(() => import('./modules/Agenda'))
const Parametres = lazy(() => import('./modules/Parametres'))
const Planning = lazy(() => import('./modules/Planning'))
const Documents = lazy(() => import('./modules/Documents'))
// A1 — la revue des propositions : le moteur (`propositions.ts`,
// `revuePropositions.ts`) existait sans porte. L'alerte agrégée de l'accueil
// pointe `#/propositions` : sans ce `case`, le clic retombait sur l'accueil
// sans un mot.
const Propositions = lazy(() => import('./modules/Propositions'))
// 5.21 — l'entreprise avait tout SAUF une adresse : `syntheseEntreprise`
// agrégeait déjà marchés tous chantiers, RG, pénalités, GPA, visas et
// situations manquantes, mais ne s'ouvrait que dans une modale, et seulement
// depuis un projet. Un seul `case` suffit : le module découpe lui-même
// `#/entreprises` (liste) de `#/entreprises/<clé>` (fiche en page) sur
// `route[1]`, comme Projets.tsx le fait pour `#/projets/<id>`.
const Entreprises = lazy(() => import('./modules/Entreprises'))
const AssistantPage = lazy(() => import('./modules/Assistant').then((m) => ({ default: m.AssistantPage })))

// Menu recomposé (audit simplification) : « une page = un objectif ».
// Travail et Gestion restent ouverts ; Agence et Outils se replient,
// l'état est mémorisé sur le poste. Les fonctions rares vivent dans
// la recherche « / » plutôt que dans le menu.
const NAV: { groupe: string; repliable?: boolean; items: { path: string; label: string }[] }[] = [
  {
    groupe: 'Travail',
    items: [
      { path: '', label: "Aujourd'hui" },
      // A1 — la revue des détections. Elle a SA ligne et pas seulement
      // l'alerte de l'accueil : cette alerte est en gravité 1 (une détection
      // n'est jamais urgente), donc la première à être poussée hors de vue
      // un jour chargé — et un moteur qu'on oublie d'ouvrir redevient un
      // moteur sans porte. « IA » dit d'où vient la proposition, pour qu'on
      // ne la confonde pas avec une proposition d'honoraires.
      { path: 'propositions', label: 'Propositions IA' },
      { path: 'taches', label: 'Mes tâches' },
      { path: 'projets', label: 'Projets' },
      { path: 'documents', label: 'Documents' },
      { path: 'planning', label: 'Planning' },
      { path: 'temps', label: 'Temps' },
    ],
  },
  {
    // audit finance §3.1 : une seule entrée Finance (6 vues internes) ;
    // Pilotage reste accessible par sa route et la Vue d'ensemble
    groupe: 'Gestion',
    items: [
      { path: 'finance', label: 'Finance' },
      { path: 'situations', label: 'Situations' },
      // 5.21 — juste après Situations, et NON dans « Agence » à côté de
      // l'Annuaire : l'annuaire répond « quel est son téléphone », cet
      // écran répond « où en est son marché » — RG échue, situation qui ne
      // vient pas, visa qu'on n'a pas rendu, pénalité qu'on n'a pas décidée.
      // C'est le portefeuille du titulaire là où Situations est le mois du
      // chantier : deux faces du même suivi, elles se lisent l'une après
      // l'autre. Sans cette ligne, l'écran serait exactement le livrable
      // sans porte qu'on est en train de réparer.
      { path: 'entreprises', label: 'Entreprises' },
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
 *  santé des données, ouverte au clic. La session est passée en argument :
 *  lue depuis un hook, elle rend ce statut réactif (avant, il fallait
 *  recharger la page pour voir « synchronisé » après une connexion). */
function statutCompact(
  state: AppState,
  today: string,
  session: InstantaneSession,
): { texte: string; titre: string } {
  if (session.connecte)
    return {
      texte: 'synchronisé',
      titre: `Espace partagé connecté${session.email ? ` — session ${session.email}` : ''} — les 2 postes voient les mêmes données.`,
    }
  const sauvegarde = state.settings.derniereSauvegarde
  if (!sauvegarde) return { texte: 'local', titre: 'Données locales, aucune sauvegarde JSON — cliquez pour la santé des données.' }
  const jours = diffDays(sauvegarde.slice(0, 10), today)
  return {
    texte: 'local',
    titre: `Données locales · sauvegarde ${jours <= 0 ? "d'aujourd'hui" : jours === 1 ? "d'hier" : `d'il y a ${jours} j`}.`,
  }
}

/** Qui est devant l'écran (pied de menu). Deux étages : la session Supabase
 *  quand elle existe, sinon le choix « je suis… » mémorisé sur ce poste.
 *  Sans l'un ni l'autre, l'application ne devine pas — elle demande. */
function IdentiteCourante() {
  const { state } = useStore()
  const moi = useMoi()
  const noms = (state.settings.equipe || []).map((p) => p.nom).filter(Boolean)

  if (moi.source === 'session' && moi.nom) {
    return (
      <div className="nav-moi" title={`Session de l'espace partagé : ${moi.emailSession}`}>
        <span className="nav-moi-label">Connecté·e</span>
        <strong>{moi.nom}</strong>
      </div>
    )
  }
  return (
    <div className="nav-moi">
      <span className="nav-moi-label">Je suis</span>
      <Select
        value={moi.nom ?? ''}
        onChange={(v) => moi.choisir(v || null)}
        options={[{ value: '', label: '— personne —' }, ...noms.map((n) => ({ value: n, label: n }))]}
        style={{ width: '100%' }}
      />
      {moi.sessionOrpheline && (
        <a href="#/parametres" className="small muted">
          Session {moi.emailSession} non rattachée — renseignez l'adresse dans Paramètres.
        </a>
      )}
    </div>
  )
}

export default function App() {
  const route = useRoute()
  const { state, update, persistenceError, clearPersistenceError, syncError } = useStore()
  const today = useToday()
  // INT-02 : la surveillance Gmail/Agenda tourne à la racine — elle continue
  // de capter les mails quel que soit l'écran affiché (le Cockpit ne fait que lire)
  const surveillance = useSurveillance(state, update)
  // 5.18 : les indices INSEE se rafraîchissent à la racine aussi — différés
  // de quelques secondes, silencieux sur échec, au plus une fois par 24 h.
  // La récupération cesse d'être un geste à penser (« automatique et non pas
  // volontaire », demande explicite de l'agence).
  useMajIndicesInsee(state, update)
  // session RÉACTIVE : sans cet abonnement, le pied de menu affichait encore
  // « local » après une connexion réussie, jusqu'au rechargement de la page
  const session = useSessionSupabase()
  const nbAlertes = alertesActives(state, today).filter((a) => a.gravite >= 2).length
  // le triplet de statuts « en attente d'un geste » se déclare dans derive.ts :
  // recopié ici, il divergeait du bloc « validations attendues » de l'accueil
  const nbDocsATraiter = documentsATraiter(state).length
  // badge Finance : uniquement les décisions humaines (audit §3.3)
  const nbFinance = badgeFinance(state, today)
  // 5.21 — combien d'entreprises demandent une action. Le prédicat n'est pas
  // choisi ici : `poids` vient de `POIDS_MOTIF` (src/entreprise.ts), et c'est
  // le même filtre que la tuile « Qui demandent une action » et que la
  // bascule de la liste — le menu ne peut donc pas annoncer 3 quand l'écran
  // en montre 2. Une porte neuve sans compteur, on la lit une fois puis on
  // l'oublie ; c'est le compteur qui fait revenir.
  const nbEntreprises = entreprisesSuivies(state, today).filter((l) => l.poids > 0).length
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
    case 'taches':
      page = <Taches />
      break
    // Écran d'exploitation (B.18) : atteignable par son adresse, absent du
    // menu. Il ne sert qu'à décider si la coupure de B.15 est permise, et
    // disparaîtra avec elle.
    case 'parite':
      page = <Parite />
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
    // 5.21 — `#/entreprises` (liste) et `#/entreprises/<clé>` (fiche en
    // page). La clé est celle d'`entreprisesSuivies` : l'id du registre
    // quand il existe, sinon le nom plié — `navigate` l'encode, `useRoute`
    // le décode, un nom à espaces voyage intact.
    case 'entreprises':
      page = <Entreprises />
      break
    case 'facturation':
      page = <Facturation />
      break
    case 'contrats':
      page = <Contrats />
      break
    case 'finance':
      page =
        route[1] === 'achats' ? <Achats />
        : route[1] === 'banque' ? <Banque />
        : route[1] === 'comptable' ? <Comptable />
        : route[1] === 'revue' ? <FinanceRevue />
        : route[1] === 'previsions' ? <Previsions />
        : route[1] === 'connecteurs' ? <Connecteurs />
        : <Finance />
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
    // `#/classement` a été retiré : l'écran tenait une SECONDE formule de
    // nomenclature à côté de `nomConforme` (src/fsdrive.ts), celle qui nomme
    // réellement les fichiers rangés — deux noms pour un même fichier, libres
    // de diverger. Son seul apport, le champ « Objet », vit désormais dans
    // Documents, là où le fichier se range ; son pré-prompt « batch hebdo »
    // était déjà servi par `#/prompts` (gabarit `tpl-classement-batch`).
    // Aucun lien ne pointait dessus, aucune entrée de menu : rien ne casse.
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
    case 'propositions':
      page = <Propositions />
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
      {/* M.3 — emplacement TÉLÉPHONE. Le §3.5 note qu'il n'y a pas de barre
          supérieure au bureau : le second emplacement est la barre latérale,
          ci-dessous. Un seul composant, deux montages. */}
      <ChronoBarre emplacement="topbar" />
      <span className="spacer" />
      <button className="topbar-burger" onClick={() => setRechercheOuverte(true)} title="Recherche globale" aria-label="Recherche globale">
        <Icon name="search" size={17} />
      </button>
    </header>
    <div className="layout">
      {navOuverte && <div className="nav-back" onClick={() => setNavOuverte(false)} />}
      <aside className={`sidebar ${navOuverte ? 'ouverte' : ''}`}>
        <div className="brand">Cockpit L&L</div>
        {/* M.3 — emplacement POSTE, en tête de la barre latérale (§3.5). */}
        <ChronoBarre emplacement="laterale" />
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
                    className={`nav-item ${g.repliable ? 'nav-item-sec' : ''} ${
                      section === it.path ||
                      (it.path === 'finance' && ['facturation', 'contrats'].includes(section)) ||
                      // §3.2 « en passant » : `#/prompts` et `#/routines` affichent
                      // l'écran Automatisations — sans cette ligne, arriver par un de
                      // ces liens n'allumait aucune entrée et on se croyait ailleurs
                      (it.path === 'automatisations' && ['prompts', 'routines'].includes(section))
                        ? 'active'
                        : ''
                    }`}
                  >
                    <span>{it.label}</span>
                    {it.path === '' && nbAlertes > 0 && <span className="nav-count">{nbAlertes}</span>}
                    {it.path === 'documents' && nbDocsATraiter > 0 && (
                      <span className="nav-count">{nbDocsATraiter}</span>
                    )}
                    {it.path === 'finance' && nbFinance > 0 && <span className="nav-count">{nbFinance}</span>}
                    {it.path === 'entreprises' && nbEntreprises > 0 && (
                      <span className="nav-count">{nbEntreprises}</span>
                    )}
                  </a>
                ))}
            </div>
          )
        })}
        <div className="sidebar-foot">
          <IdentiteCourante />
          <a
            href="#/parametres"
            className={`nav-item nav-item-sec ${section === 'parametres' ? 'active' : ''}`}
            style={{ marginBottom: 6 }}
          >
            <span>Paramètres</span>
            <button
              className="nav-statut"
              title={statutCompact(state, today, session).titre}
              onClick={(e) => {
                e.preventDefault()
                window.location.hash = '#/sante'
              }}
            >
              ● {statutCompact(state, today, session).texte}
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
      <main className="main">
        {persistenceError && (
          <div
            className="pill-note danger-text"
            role="alert"
            style={{ marginBottom: 12, borderColor: 'var(--danger)' }}
          >
            <strong>Stockage local en échec.</strong> {persistenceError}{' '}
            <Btn small kind="ghost" onClick={clearPersistenceError}>
              Masquer
            </Btn>
          </div>
        )}
        {syncError && (
          <div
            className="pill-note danger-text"
            role="alert"
            style={{ marginBottom: 12, borderColor: 'var(--danger)' }}
          >
            <strong>Synchronisation suspendue.</strong> {syncError}
          </div>
        )}
        {/* M.1 — le découpage par route rend le chargement d'un écran
            asynchrone. Le repli reste DISCRET et sans mise en page propre :
            une grande pancarte « chargement » qui clignote entre chaque
            écran donne l'impression d'une application lente, alors que le
            morceau arrive en général avant d'être vu. */}
        <BanniereMiseAJour />
        <Suspense fallback={<p className="muted small" role="status">Chargement de l’écran…</p>}>
          {page}
        </Suspense>
      </main>
    </div>
    {rechercheOuverte && (
      <Suspense fallback={null}>
        <RechercheOverlay onClose={() => setRechercheOuverte(false)} />
      </Suspense>
    )}
    <ToastHost />
    <ConfirmHost />
    </SurveillanceCtx.Provider>
  )
}
