// ============================================================
// M.1 — la coquille hors ligne (§17 Frontend, §24).
//
// Ce fichier est un GABARIT : le greffon de `vite.config.ts` y injecte la
// liste réelle des fichiers construits et une empreinte de version, puis
// écrit le résultat dans `dist/sw.js`. Il n'est jamais servi tel quel.
//
// LE PROBLÈME QU'IL RÈGLE
// ------------------------
// L'application est un SPA servi par Vercel. Sans réseau, le navigateur
// n'obtient pas `index.html` — il affiche sa page « pas de connexion ». Le
// cache HTTP ordinaire ne suffit pas : il s'évince sous pression mémoire,
// et un téléphone de chantier est précisément l'appareil où il s'évince.
// D'où une page blanche là où le hors-ligne était promis.
//
// CE QU'IL NE FAIT PAS, ET C'EST LE POINT IMPORTANT
// ---------------------------------------------------
// Il ne met JAMAIS en cache une réponse de données — ni `/api/`, ni
// Supabase, ni Google. Le hors-ligne des DONNÉES a déjà une autorité :
// `src/horsLigne.ts`, son cache 90 jours et sa file d'écritures
// idempotentes. Deux caches sur la même donnée, c'est deux réponses
// possibles à la même question, et celle du service worker serait la plus
// vieille sans que rien ne le dise. On garderait un devis périmé à l'écran
// en croyant lire l'actuel.
//
// La division est donc nette, et le test la vérifie :
//   * le service worker → la COQUILLE (html, js, css, polices, icônes) ;
//   * `horsLigne.ts`     → les DONNÉES.
//
// MISE À JOUR : ANNONCÉE, JAMAIS SILENCIEUSE
// --------------------------------------------
// `skipWaiting()` n'est pas appelé à l'installation. Une version qui
// s'installe seule pendant qu'on saisit des heures recharge l'onglet et
// perd la saisie en cours. Le nouveau worker attend ; l'application montre
// une bannière ; c'est un clic humain qui envoie `SAUTER_ATTENTE`.
// ============================================================

// __COQUILLE__ et __VERSION__ sont remplacés à la construction.
const COQUILLE = self.__COQUILLE__
const VERSION = self.__VERSION__

const CACHE_COQUILLE = `cockpit-coquille-${VERSION}`
const CACHE_ROUTES = `cockpit-routes-${VERSION}`

/** Ce qui ne doit jamais entrer dans un cache de coquille. */
function estDonnee(url) {
  if (url.origin !== self.location.origin) return true // Supabase, Google, tout tiers
  return url.pathname.startsWith('/api/')
}

self.addEventListener('install', (e) => {
  // `reload` force le réseau : sans lui, on précharge depuis le cache HTTP
  // et on peut figer une version déjà périmée dans le cache de la coquille.
  e.waitUntil(
    caches
      .open(CACHE_COQUILLE)
      .then((c) => c.addAll(COQUILLE.map((u) => new Request(u, { cache: 'reload' })))),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const nom of await caches.keys()) {
        if (nom.startsWith('cockpit-') && nom !== CACHE_COQUILLE && nom !== CACHE_ROUTES) {
          await caches.delete(nom)
        }
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SAUTER_ATTENTE') self.skipWaiting()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (estDonnee(url)) return // laissé au réseau, et à horsLigne.ts

  // Navigation : toutes les adresses `#/…` sont le même document. On rend
  // la coquille depuis le cache, et l'application se charge de la route.
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_COQUILLE)
        try {
          const reseau = await fetch(req)
          // On rafraîchit la coquille au passage, pour que le prochain
          // démarrage sans réseau parte de la dernière version vue.
          if (reseau && reseau.ok) cache.put('/index.html', reseau.clone())
          return reseau
        } catch {
          return (await cache.match('/index.html')) || Response.error()
        }
      })(),
    )
    return
  }

  // Morceaux de route, polices, icônes : le cache d'abord. Leur nom porte
  // une empreinte, donc un fichier servi depuis le cache est le bon
  // fichier — il n'existe pas deux contenus sous un même nom.
  e.respondWith(
    (async () => {
      const trouve = await caches.match(req)
      if (trouve) return trouve
      const reseau = await fetch(req)
      if (reseau && reseau.ok && reseau.type === 'basic') {
        const cache = await caches.open(CACHE_ROUTES)
        cache.put(req, reseau.clone())
      }
      return reseau
    })(),
  )
})
