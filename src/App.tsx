// Coquille de l'application : barre latérale + routage hash.

import { Suspense, lazy, useEffect, useState } from 'react'
import { useStore } from './store'
import { Btn, ConfirmHost, Icon, Select, ToastHost, useRoute, useToday } from './ui'
import { alertesActives } from './alerts'
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
// TRANCHE 3 — plus de `lazy(() => import('./modules/Situations'))` : ce module
// n'a plus d'écran à charger. Ses quatre vues sont montées par Entreprises, et
// ses deux modales contractuelles (`ModalEdition`, `ModalCertificat`) sont
// importées par la fiche entreprise et l'onglet Chantier, comme avant.
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

// TRANCHE 3 — DEUX ENTRÉES QUITTENT `NAV`, ET PAS SEULEMENT LA VUE.
//
// La tranche 2 avait replié onze entrées : la gêne baissait, la dette non —
// « replier retire de la VUE, pas du COMPTE » (§3.3). Celle-ci retire deux
// entrées du tableau lui-même :
//
//   · « Situations » : ses quatre onglets répondaient déjà aux colonnes
//     d'Entreprises (§2.3). L'écran est devenu une vue d'Entreprises, et
//     `case 'situations'` monte désormais `<Entreprises />` — donc
//     `ALIAS_SECTION` doit allumer « Entreprises » quand on arrive par
//     l'ancienne adresse, sans quoi le groupe replié resterait fermé et rien
//     ne dirait où l'on est.
//   · « Documents » : le registre est devenu une vue du projet, les deux files
//     datées (« à vérifier », « à rattacher ») sont déjà remontées dans la
//     semaine par la tranche 1, et leur compteur se lit dans le Cockpit — ce
//     pourquoi le badge `documents` quitte aussi ce menu. `case 'documents'`
//     reste servi : la boîte d'arrivée n'a pas encore de projet, c'est le
//     premier des trois cas transverses légitimes du §2.2.
//
// AUCUNE ROUTE NE DISPARAÎT. Les deux `case` sont là, à leur place, et les
// deux libellés restent indexés par la palette « / » : une entrée retirée du
// menu doit rester trouvable, faute de quoi « replié » veut dire « perdu »
// (réserve n°6 du §7).
//
// TRANCHE 2 DE LA REFONTE (docs/REFONTE_NAVIGATION.md §3.1, §5).
//
// Seize destinations, toutes visibles en permanence, sur tous les écrans, pour
// deux personnes : une destination est l'endroit le PLUS CHER de l'outil, et
// on en montrait seize à la fois. La cible du plan est CINQ entrées visibles —
// les deux ancres (la semaine, les projets) et les trois questions insolubles
// dans un projet (une entreprise sur plusieurs chantiers, l'argent de
// l'agence, un dossier qui n'a pas encore de projet) — plus UN groupe replié
// pour les onze autres.
//
// RIEN N'EST SUPPRIMÉ, et c'est la règle qui commande : les onze lignes sont
// toujours là, un clic sur « Agence » les rouvre, l'état est mémorisé sur le
// poste, et TOUTES les routes du `switch` ci-dessous restent servies — une
// adresse tapée, un favori, un lien d'alerte continuent d'arriver exactement
// au même endroit. Ce qui baisse, c'est ce qu'on VOIT (16 → 5) ; ce qui se
// MESURE (test-surface.cjs compte ce tableau en entier) ne bouge pas d'un
// endroit, et le plan le dit sans détour : replier rend l'outil respirable, ce
// sont les tranches 3 et 4 qui retirent vraiment de la dette.
//
// Le corollaire est la réserve n°6 du §7 : replier suppose de retrouver. Les
// onze libellés sont indexés dans la palette « / » (src/modules/
// RechercheOverlay.tsx, groupe « Écrans ») — sans quoi « replié » voudrait
// dire « perdu ».
const NAV: { groupe: string; repliable?: boolean; items: { path: string; label: string }[] }[] = [
  {
    // Ce groupe-ci n'affiche PAS son titre : il est la seule liste toujours
    // visible, donc il est le menu. Un intitulé au-dessus n'apprend rien et
    // ajoute une ligne à balayer — le nom ne sert qu'à la clé de rendu.
    groupe: 'Ancres',
    items: [
      // L'accueil EST l'écran de semaine — il l'était déjà à moitié (horizon
      // de sept jours, « Revenir à cette semaine », carte « Semaine de
      // l'équipe »). Le libellé le dit enfin, et « aujourd'hui » redevient ce
      // qu'il aurait toujours dû être : un filtre de jour (`#/AAAA-MM-JJ`),
      // pas une destination. Aucune entrée ajoutée, aucune retirée.
      { path: '', label: 'La semaine' },
      { path: 'projets', label: 'Projets' },
      // 5.21 — l'annuaire répond « quel est son téléphone », cet écran répond
      // « où en est son marché » : RG échue, situation qui ne vient pas, visa
      // qu'on n'a pas rendu. C'est LA vue de recoupement légitime du §2.3 —
      // une entreprise travaille sur plusieurs chantiers, la question est
      // insoluble dans un projet — et c'est à ce titre qu'elle reste visible.
      { path: 'entreprises', label: 'Entreprises' },
      // audit finance §3.1 : une seule entrée Finance (9 vues internes)
      { path: 'finance', label: 'Finance' },
      { path: 'ao', label: 'Développement' },
    ],
  },
  {
    // Les onze repliées. L'ordre suit le §3.1 du plan : ce qui touche encore
    // au chantier d'abord, les outils en dernier.
    groupe: 'Agence',
    repliable: true,
    items: [
      // « Situations » et « Documents » ont quitté ce groupe à la tranche 3 :
      // le premier est devenu une vue d'Entreprises, le second une vue du
      // projet. Leurs routes répondent toujours (voir le `switch`).
      { path: 'planning', label: 'Planning' },
      { path: 'temps', label: 'Temps' },
      { path: 'taches', label: 'Mes tâches' },
      { path: 'pilotage', label: 'Pilotage' },
      // A1 — la revue des détections garde SA ligne : son alerte d'accueil est
      // en gravité 1 (une détection n'est jamais urgente), donc la première à
      // être poussée hors de vue un jour chargé, et un moteur qu'on oublie
      // d'ouvrir redevient un moteur sans porte. « IA » dit d'où vient la
      // proposition, pour qu'on ne la confonde pas avec une proposition
      // d'honoraires.
      { path: 'propositions', label: 'Propositions IA' },
      { path: 'ressources', label: 'Annuaire' },
      { path: 'agenda', label: 'Échéances agence' },
      { path: 'assistant', label: 'Assistant' },
      { path: 'automatisations', label: 'Automatisations' },
    ],
  },
]

const CLE_NAV_GROUPES = 'cockpit-ll-nav-groupes'

/** Les sections qui affichent l'écran d'une entrée de menu SANS porter son
 *  adresse : `#/prompts` monte Automatisations, `#/calendrier` monte Planning,
 *  `#/sante` monte Paramètres… Le §3.2 appelle ça arriver « en passant ».
 *
 *  Sans cette table, aucune entrée ne s'allume et on se croit ailleurs — et
 *  depuis la tranche 2 le défaut est pire : le groupe replié resterait FERMÉ
 *  sur l'écran où l'on se trouve, sans rien pour dire où l'on est. */
const ALIAS_SECTION: Record<string, string> = {
  facturation: 'finance',
  contrats: 'finance',
  // TRANCHE 3 — `#/situations` monte `<Entreprises />` : l'ancienne adresse
  // continue de répondre, et c'est bien l'entrée « Entreprises » qu'elle
  // allume. Sans cette ligne, on arriverait par une alerte sur un écran dont
  // le menu ne dit plus le nom.
  situations: 'entreprises',
  calendrier: 'planning',
  revue: 'pilotage',
  analyse: 'pilotage',
  prompts: 'automatisations',
  routines: 'automatisations',
  developpement: 'ao',
  references: 'ao',
  demarrer: 'parametres',
  sante: 'parametres',
}

/** L'entrée de menu qu'une adresse allume — UNE seule autorité, lue par
 *  l'entrée elle-même, par le groupe qui décide de s'ouvrir et par le pied de
 *  menu. Deux réponses différentes à cette question et le menu montrerait un
 *  écran actif pendant qu'un groupe fermé en cache un autre. */
function entreeActive(section: string, jourDeRoute: string | null): string {
  // un jour filtré (`#/2026-08-10`) reste la semaine : sans cette ligne
  // l'entrée s'éteint et on se croit ailleurs
  if (jourDeRoute !== null) return ''
  return ALIAS_SECTION[section] ?? section
}

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
  // badge Finance : uniquement les décisions humaines (audit §3.3)
  const nbFinance = badgeFinance(state, today)
  // 5.21 — combien d'entreprises demandent une action. Le prédicat n'est pas
  // choisi ici : `poids` vient de `POIDS_MOTIF` (src/entreprise.ts), et c'est
  // le même filtre que la tuile « Qui demandent une action » et que la
  // bascule de la liste — le menu ne peut donc pas annoncer 3 quand l'écran
  // en montre 2. Une porte neuve sans compteur, on la lit une fois puis on
  // l'oublie ; c'est le compteur qui fait revenir.
  const nbEntreprises = entreprisesSuivies(state, today).filter((l) => l.poids > 0).length
  // Le compteur d'une entrée de menu se déclare ICI et nulle part ailleurs :
  // le groupe replié en fait la somme (voir plus bas). Écrit en quatre `&&`
  // dans le JSX, comme avant, la pastille du groupe aurait dû recopier la
  // liste — et le jour où une entrée gagne un compteur, la porte fermée
  // l'aurait avalé en silence.
  // TRANCHE 3 — `documents` a quitté ce tableau EN MÊME TEMPS que le menu :
  // un compteur sans ligne où s'afficher n'aurait rien compté. Les deux files
  // qu'il annonçait (« à vérifier », « à rattacher ») sont dans l'inventaire de
  // la semaine depuis la tranche 1 et le Cockpit lit le même `documentsATraiter`
  // — le nombre n'est pas perdu, il a changé de porteur.
  const compteurs: Record<string, number> = {
    '': nbAlertes,
    finance: nbFinance,
    entreprises: nbEntreprises,
  }
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
  /** `ouvert` est l'état VISIBLE au moment du clic, pas l'état mémorisé : un
   *  groupe ouvert d'office parce qu'il contient l'écran courant se serait
   *  sinon replié sur `!false === true`, c'est-à-dire pas du tout — un bouton
   *  qui ne répond pas, sur onze entrées. */
  const basculerGroupe = (g: string, ouvert: boolean) =>
    setGroupesOuverts((prev) => {
      const next = { ...prev, [g]: !ouvert }
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

  // Le filtre de JOUR de la semaine : `#/2026-08-10` affiche le même écran
  // que `#/`, une colonne isolée. Ce n'est pas une destination de plus —
  // c'est la lecture d'un segment, et l'accueil reste l'unique écran.
  const jourDeRoute = /^\d{4}-\d{2}-\d{2}$/.test(section) ? section : null
  // l'entrée de menu allumée par l'adresse courante, alias compris
  const actif = entreeActive(section, jourDeRoute)

  let page
  switch (section) {
    case '':
      page = <Cockpit jour={jourDeRoute} />
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
    // TRANCHE 3 — L'ANCIENNE ADRESSE DES SITUATIONS, SERVIE PAR SON NOUVEL
    // ENDROIT. `#/situations`, `#/situations/rg`, `#/situations/attendues`,
    // `#/situations/verifier/<id>` (alerte, `alerts.ts`) et
    // `#/situations/<vue>/chercher/<entreprise>` (palette « / », fiche
    // entreprise, onglet Chantier) continuent de répondre EXACTEMENT — c'est
    // `Entreprises` qui découpe ces segments désormais, avec la même lecture.
    // Rien à réécrire chez les émetteurs, et rien qui retombe sur l'accueil.
    case 'situations':
      page = <Entreprises />
      break
    // 5.21 — `#/entreprises` (liste) et `#/entreprises/<clé>` (fiche en
    // page). La clé est celle d'`entreprisesSuivies` : l'id du registre
    // quand il existe, sinon le nom plié — `navigate` l'encode, `useRoute`
    // le décode, un nom à espaces voyage intact.
    // Depuis la tranche 3, s'y ajoute `#/entreprises/situations/<vue>`.
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
    // TRANCHE 3 — la destination a quitté le menu, la route reste servie : la
    // boîte d'arrivée traite ce qui n'a PAS encore de projet (§2.2, premier des
    // trois cas transverses légitimes), et `#/documents/tous[/<id>]` — écrite
    // par la palette et par Achats — ouvre le registre replié en pied d'écran.
    // Le registre PAR PROJET, lui, vit dans la fiche projet, onglet Documents.
    case 'documents':
      page = <Documents />
      break
    case 'propositions':
      page = <Propositions />
      break
    default:
      page = <Cockpit jour={jourDeRoute} />
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
          const contientActif = g.items.some((it) => it.path === actif)
          // Le choix mémorisé l'emporte ; à défaut, le groupe s'ouvre de
          // lui-même quand il contient l'écran courant. Dans l'autre ordre
          // (auto-ouverture prioritaire), la personne qui replie le groupe
          // depuis un de ses écrans le verrait se rouvrir aussitôt.
          const ouvert = !g.repliable || (groupesOuverts[g.groupe] ?? contientActif)
          // Ce qui attend DERRIÈRE la porte fermée. Replier ne doit pas revenir
          // à cacher un signal : le groupe montre la somme des compteurs qu'il
          // contient tant qu'il est fermé, et les rend à chaque entrée dès
          // qu'il s'ouvre. La pastille n'ouvre RIEN toute seule — un menu qui
          // se déplie sans qu'on l'ait touché est exactement la surface qu'on
          // vient de replier.
          const enAttente = g.items.reduce((n, it) => n + (compteurs[it.path] || 0), 0)
          return (
            <div key={g.groupe}>
              {g.repliable && (
                <button
                  // `actif` sur la porte fermée : c'est ce qui remplace
                  // l'entrée surlignée quand elle est repliée. Sans lui, on
                  // travaille dans un écran dont le menu ne dit plus le nom.
                  className={`nav-group nav-group-btn ${!ouvert && contientActif ? 'actif' : ''}`}
                  onClick={() => basculerGroupe(g.groupe, ouvert)}
                  aria-expanded={ouvert}
                  aria-current={!ouvert && contientActif ? 'true' : undefined}
                  aria-label={
                    !ouvert && enAttente > 0 ? `${g.groupe} — ${enAttente} en attente` : g.groupe
                  }
                  title={
                    ouvert
                      ? `Replier ${g.groupe} — les ${g.items.length} écrans restent atteignables par la recherche « / »`
                      : `Déplier ${g.groupe} — ${g.items.length} écrans` +
                        (contientActif ? ', dont celui où vous êtes' : '') +
                        (enAttente > 0 ? `, ${enAttente} en attente` : '')
                  }
                >
                  <span>{g.groupe}</span>
                  <span className="nav-group-fin">
                    {!ouvert && enAttente > 0 && (
                      <span className="nav-count" aria-hidden="true">
                        {enAttente}
                      </span>
                    )}
                    <span aria-hidden="true">{ouvert ? '▾' : '▸'}</span>
                  </span>
                </button>
              )}
              {ouvert &&
                g.items.map((it) => (
                  <a
                    key={it.path}
                    href={`#/${it.path}`}
                    className={`nav-item ${g.repliable ? 'nav-item-sec' : ''} ${it.path === actif ? 'active' : ''}`}
                  >
                    <span>{it.label}</span>
                    {(compteurs[it.path] || 0) > 0 && <span className="nav-count">{compteurs[it.path]}</span>}
                  </a>
                ))}
            </div>
          )
        })}
        <div className="sidebar-foot">
          <IdentiteCourante />
          <a
            href="#/parametres"
            className={`nav-item nav-item-sec ${actif === 'parametres' ? 'active' : ''}`}
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
