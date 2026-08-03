import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * M.1 — écrit `dist/sw.js` depuis `src/sw-modele.js`, en y injectant la
 * liste RÉELLE des fichiers construits et une empreinte de version.
 *
 * Pourquoi un greffon maison plutôt qu'une bibliothèque : il tient en
 * quarante lignes lisibles, et le service worker est le seul code du dépôt
 * qui survit à un déploiement dans le navigateur des gens. Un cache mal
 * peuplé ne se corrige pas en repoussant — il faut attendre que chaque
 * poste le remplace. Ce fichier-là mérite d'être relu en entier.
 *
 * CE QUI EST PRÉCHARGÉ, ET CE QUI NE L'EST PAS
 * ----------------------------------------------
 * La COQUILLE seule : `index.html`, le morceau d'entrée, les CSS, la
 * police. Précharger les morceaux de route annulerait le découpage qu'on
 * vient de faire — on retéléchargerait tout à la première visite, pour des
 * écrans que l'agence n'ouvre pas ce jour-là. Les routes entrent au cache
 * quand on les visite : un écran déjà ouvert une fois fonctionne ensuite
 * sans réseau, ce qui est exactement la promesse utile.
 */
function coquilleHorsLigne(): Plugin {
  return {
    name: 'cockpit-coquille-hors-ligne',
    apply: 'build',
    generateBundle(_options, bundle) {
      const noms = Object.keys(bundle)

      // Le morceau d'entrée : celui que `index.html` charge. Les autres
      // sont des routes, chargées à la demande.
      const entree = noms.filter(
        (n) => bundle[n].type === 'chunk' && (bundle[n] as { isEntry?: boolean }).isEntry,
      )
      const styles = noms.filter((n) => n.endsWith('.css'))

      const coquille = [
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/icones/icone-192.png',
        '/fonts/jost.woff2',
        ...entree.map((n) => `/${n}`),
        ...styles.map((n) => `/${n}`),
      ]

      // La version change dès qu'un fichier de la coquille change de nom —
      // donc de contenu, puisque les noms portent une empreinte. Une version
      // stable alors que le contenu bouge laisserait l'ancien cache servir.
      const version = createHash('sha256').update(coquille.join('\n')).digest('hex').slice(0, 12)

      const modele = readFileSync('src/sw-modele.js', 'utf8')
      const source = modele
        .replace('self.__COQUILLE__', JSON.stringify(coquille))
        .replace('self.__VERSION__', JSON.stringify(version))

      // Le contrôle porte sur l'EXPRESSION injectée (`self.__X__`), pas sur
      // le nom nu : le gabarit cite ses propres marqueurs en commentaire, et
      // chercher le nom seul ferait échouer la construction sur une phrase.
      if (source.includes('self.__COQUILLE__') || source.includes('self.__VERSION__')) {
        // Un gabarit renommé sans que le greffon suive produirait un service
        // worker qui échoue à l'installation, donc AUCUN hors-ligne — en
        // silence, puisque l'application marche tant qu'il y a du réseau.
        throw new Error('sw-modele.js : les marqueurs d’injection n’ont pas été remplacés.')
      }

      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  plugins: [react(), coquilleHorsLigne()],
  server: { port: 5173 },
})
