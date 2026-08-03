// ============================================================
// M.1 — enregistrement du service worker et annonce des mises à jour.
//
// POURQUOI UNE BANNIÈRE PLUTÔT QU'UN RECHARGEMENT
// -------------------------------------------------
// Le réflexe courant est d'appeler `skipWaiting()` dès qu'une version est
// prête, puis de recharger. Sur cette application, ce serait un défaut :
// on y saisit des heures, on y écrit des commentaires de tâche, on y
// remplit une situation. Un rechargement décidé par la machine au milieu
// d'une saisie perd ce qui n'est pas encore enregistré, et l'utilisateur
// ne comprend pas ce qui vient de se passer — il croit avoir perdu son
// travail par sa faute.
//
// La nouvelle version attend donc, visible, jusqu'à un clic. C'est le
// même principe que le §15 tient pour l'IA : la machine propose, l'humain
// décide. Ici l'enjeu est plus modeste, la règle est la même.
//
// CE MODULE NE FAIT RIEN EN DÉVELOPPEMENT
// -----------------------------------------
// `import.meta.env.DEV` court-circuite tout : un service worker en
// développement sert des morceaux périmés pendant qu'on code, et on
// cherche pendant une heure un défaut qu'on a déjà corrigé.
// ============================================================

type Ecouteur = (disponible: boolean) => void

let versionEnAttente: ServiceWorker | null = null
const ecouteurs = new Set<Ecouteur>()

function annoncer(): void {
  for (const e of ecouteurs) e(versionEnAttente !== null)
}

/** S'abonner à l'existence d'une version prête. Rend la désinscription. */
export function surMiseAJour(ecouteur: Ecouteur): () => void {
  ecouteurs.add(ecouteur)
  ecouteur(versionEnAttente !== null)
  return () => ecouteurs.delete(ecouteur)
}

/**
 * Applique la version en attente. C'est le SEUL chemin vers un
 * rechargement, et il part d'un geste humain.
 */
export function appliquerMiseAJour(): void {
  const attente = versionEnAttente
  if (!attente) return
  // `controllerchange` part quand le nouveau worker prend la main : on
  // recharge à ce moment-là, pas avant, sinon on recharge sur l'ancienne
  // version et la bannière revient aussitôt.
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  })
  attente.postMessage({ type: 'SAUTER_ATTENTE' })
}

function surveiller(reg: ServiceWorkerRegistration): void {
  const examiner = (sw: ServiceWorker | null) => {
    if (!sw) return
    const verifier = () => {
      // `installed` + un contrôleur déjà en place = c'est un REMPLACEMENT.
      // Sans le test du contrôleur, la toute première installation
      // afficherait « nouvelle version disponible » à quelqu'un qui vient
      // d'ouvrir l'application pour la première fois.
      if (sw.state === 'installed' && navigator.serviceWorker.controller) {
        versionEnAttente = sw
        annoncer()
      }
    }
    verifier()
    sw.addEventListener('statechange', verifier)
  }

  examiner(reg.waiting)
  reg.addEventListener('updatefound', () => examiner(reg.installing))
}

export function enregistrerCoquille(): void {
  if (import.meta.env.DEV) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        surveiller(reg)
        // Une session ouverte plusieurs jours ne verrait jamais de nouvelle
        // version sans cette vérification ; l'agence garde ses onglets.
        setInterval(() => void reg.update(), 60 * 60 * 1000)
      })
      .catch((e) => {
        // Un échec d'enregistrement ne doit pas empêcher l'application de
        // tourner : on perd le hors-ligne, pas l'outil.
        console.warn('Coquille hors ligne indisponible :', e)
      })
  })
}
