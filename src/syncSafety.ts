const CLE_RECUPERATION_LOCALE = 'cockpit-ll-recuperation-locale-requise'

export const MESSAGE_RECUPERATION_LOCALE =
  'La sauvegarde locale a été déclarée corrompue. Aucun envoi automatique n’est autorisé : restaurez un export JSON valide ou récupérez explicitement la version partagée.'

let recuperationEnMemoire = false

/** Ce verrou n'est pas lié à un workspace : quand l'AppState est illisible,
 *  sa configuration l'est aussi. Il doit survivre à une saisie faite sur le
 *  jeu d'exemple afin que ce dernier ne puisse jamais partir au serveur. */
export function recuperationLocaleRequise(): boolean {
  if (recuperationEnMemoire) return true
  try {
    recuperationEnMemoire =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(CLE_RECUPERATION_LOCALE) !== null
  } catch {
    /* Le verrou mémoire reste la source de vérité si le stockage est indisponible. */
  }
  return recuperationEnMemoire
}

export function marquerRecuperationLocaleRequise(): void {
  recuperationEnMemoire = true
  try {
    localStorage.setItem(CLE_RECUPERATION_LOCALE, new Date().toISOString())
  } catch {
    /* Le verrou mémoire bloque encore tout envoi pendant cette session. */
  }
}

/** N'appeler qu'après une restauration locale persistée ou un pull distant
 *  explicitement confirmé et lui aussi persisté. */
export function effacerRecuperationLocaleRequise(): boolean {
  try {
    localStorage.removeItem(CLE_RECUPERATION_LOCALE)
  } catch {
    return false
  }
  recuperationEnMemoire = false
  return true
}
