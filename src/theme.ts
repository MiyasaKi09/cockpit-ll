// Bascule de thème clair (A — atelier néo-bauhaus) / sombre (D — nuit atelier).
// Par défaut : préférence système ; un choix manuel est persisté et prioritaire.

const CLE = 'cockpit-ll-theme'
export type Theme = 'light' | 'dark'

/** applique le thème mémorisé (appelé au démarrage, avant le rendu) */
export function initTheme(): void {
  try {
    const t = localStorage.getItem(CLE)
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
  } catch {
    /* stockage indisponible : on suit la préférence système */
  }
}

/** thème effectif : choix manuel s'il existe, sinon préférence système */
export function themeCourant(): Theme {
  const attr = document.documentElement.dataset.theme
  if (attr === 'light' || attr === 'dark') return attr
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** bascule et mémorise ; renvoie le nouveau thème */
export function basculerTheme(): Theme {
  const suivant: Theme = themeCourant() === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = suivant
  try {
    localStorage.setItem(CLE, suivant)
  } catch {
    /* ignore */
  }
  return suivant
}
