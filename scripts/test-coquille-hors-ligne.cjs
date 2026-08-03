// M.1 — la coquille hors ligne (§17 Frontend, §24).
//
// Le hors-ligne a ceci de particulier qu'il ne se voit pas quand il est
// cassé. L'application marche, les écrans s'ouvrent, personne ne remarque
// rien — jusqu'au jour où quelqu'un ouvre le Cockpit sur un chantier sans
// réseau et obtient une page blanche. Ce test existe parce qu'aucune
// vérification manuelle ne se fait dans ces conditions-là.
//
// Cinq choses tenues ici :
//
//   1. la liste de préchargement pointe sur des fichiers QUI EXISTENT —
//      une seule adresse morte fait échouer `addAll`, donc l'installation,
//      donc TOUT le hors-ligne, en silence ;
//   2. le service worker ne met jamais en cache une donnée : c'est
//      `horsLigne.ts` qui en a la charge, et deux caches sur la même donnée
//      rendraient deux réponses à la même question ;
//   3. une mise à jour ne s'applique jamais toute seule ;
//   4. la coquille reste PETITE — précharger les morceaux de route
//      annulerait le découpage ;
//   5. les routes sont bien découpées, et l'accueil ne l'est pas.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')
const existe = (f) => fs.existsSync(path.join(racine, f))

assert.ok(
  existe('dist/sw.js'),
  'dist/sw.js absent : lancez `npm run build` avant ce test. Il vérifie le service worker RÉELLEMENT\n' +
    'produit, pas son gabarit — c’est le fichier construit qui part dans les navigateurs.',
)

const sw = lire('dist/sw.js')
const gabarit = lire('src/sw-modele.js')

// --- 1. la liste de préchargement pointe sur des fichiers réels -------------

const coquille = JSON.parse(/const COQUILLE = (\[[^\]]*\])/.exec(sw)[1])

{
  assert.ok(coquille.length >= 5, 'la coquille doit au moins porter le document, le script et la feuille')

  const manquants = coquille.filter((u) => u !== '/' && !existe(`dist${u}`))
  assert.deepEqual(
    manquants,
    [],
    'adresse(s) préchargée(s) sans fichier correspondant dans dist/.\n' +
      '`cache.addAll()` rejette EN BLOC à la première 404 : l’installation échoue, aucun fichier n’est\n' +
      'mis en cache, et l’application continue de marcher tant qu’il y a du réseau. Le défaut ne se\n' +
      'voit donc que le jour où le réseau manque — c’est-à-dire trop tard.',
  )

  for (const attendu of ['/index.html', '/manifest.webmanifest']) {
    assert.ok(coquille.includes(attendu), `${attendu} doit être préchargé : sans lui, pas de démarrage sans réseau`)
  }
  assert.ok(
    coquille.some((u) => u.endsWith('.css')),
    'la feuille de style est dans la coquille : sans elle on obtient une page nue, ce qui ressemble à une panne',
  )

  const version = /const VERSION = "([^"]+)"/.exec(sw)
  assert.ok(version && version[1].length >= 8, 'une empreinte de version est injectée')
}

// --- 2. le service worker ne met jamais en cache une donnée ----------------

{
  assert.match(
    gabarit,
    /function estDonnee\(url\)[\s\S]*?url\.origin !== self\.location\.origin/,
    'tout ce qui vient d’une autre origine (Supabase, Google) est une donnée : jamais mis en cache',
  )
  assert.match(
    gabarit,
    /url\.pathname\.startsWith\('\/api\/'\)/,
    'les routes /api/ sont des données : jamais mises en cache',
  )
  assert.match(
    gabarit,
    /if \(estDonnee\(url\)\) return/,
    'le test doit COURT-CIRCUITER le gestionnaire, pas seulement exister — une fonction déclarée et\n' +
      'jamais appelée est le défaut le plus facile à introduire ici',
  )

  // La division des rôles est écrite noir sur blanc dans les deux fichiers :
  // si quelqu'un ajoute un cache de données au service worker, il devra
  // effacer une phrase qui explique pourquoi c'est faux.
  assert.match(gabarit, /horsLigne\.ts/, 'le gabarit nomme l’autorité du hors-ligne des données')
  assert.ok(existe('src/horsLigne.ts'), 'cette autorité existe toujours')
}

// --- 3. une mise à jour ne s'applique jamais toute seule --------------------

{
  const installation = /addEventListener\('install'[\s\S]*?\n\}\)/.exec(gabarit)
  assert.ok(installation, 'le gestionnaire d’installation existe')
  assert.doesNotMatch(
    installation[0],
    /skipWaiting/,
    'skipWaiting() à l’installation recharge l’onglet pendant qu’on saisit des heures, et fait croire\n' +
      'à la personne qu’elle a perdu son travail par sa faute. La nouvelle version attend un clic.',
  )
  assert.match(gabarit, /'SAUTER_ATTENTE'[\s\S]*?skipWaiting\(\)/, 'elle ne s’applique que sur message')

  const maj = lire('src/majApp.ts')
  assert.match(maj, /navigator\.serviceWorker\.controller/, 'une PREMIÈRE installation n’est pas une mise à jour :\n' +
    'sans ce test, quelqu’un qui ouvre l’application pour la première fois lit « nouvelle version disponible »')
  assert.match(maj, /controllerchange[\s\S]*?reload/, 'on recharge quand le nouveau worker prend la main, pas avant')
  assert.match(maj, /import\.meta\.env\.DEV/, 'aucun service worker en développement : il servirait du code périmé')
  assert.match(maj, /\.catch\(/, 'un échec d’enregistrement fait perdre le hors-ligne, pas l’outil')
}

// --- 4. la coquille reste petite -------------------------------------------

{
  const morceaux = fs.readdirSync(path.join(racine, 'dist/assets')).filter((f) => f.endsWith('.js'))
  const prechargesJs = coquille.filter((u) => u.endsWith('.js'))

  assert.ok(
    prechargesJs.length < morceaux.length / 2,
    `${prechargesJs.length} morceaux JS préchargés sur ${morceaux.length} : la coquille avale le découpage.\n` +
      'Tout précharger revient à retélécharger l’application entière à la première visite, pour des\n' +
      'écrans que l’agence n’ouvrira pas ce jour-là. Les routes entrent au cache quand on les visite.',
  )

  // L'entrée est le seul morceau qui doit y être — et elle doit être
  // sensiblement plus petite que l'application entière, sinon le découpage
  // n'a rien découpé.
  const octetsEntree = prechargesJs.reduce((s, u) => s + fs.statSync(path.join(racine, `dist${u}`)).size, 0)
  const octetsTout = morceaux.reduce((s, f) => s + fs.statSync(path.join(racine, 'dist/assets', f)).size, 0)
  assert.ok(
    octetsEntree < octetsTout * 0.2,
    `entrée ${Math.round(octetsEntree / 1024)} Ko sur ${Math.round(octetsTout / 1024)} Ko au total : ` +
      'le découpage par route ne découpe plus grand-chose.',
  )
}

// --- 5. les routes sont découpées, l'accueil ne l'est pas ------------------

{
  const app = lire('src/App.tsx')
  const paresseux = (app.match(/= lazy\(/g) || []).length
  assert.ok(paresseux >= 20, `${paresseux} écrans en chargement différé : le découpage doit couvrir les routes`)

  assert.match(
    app,
    /^import Cockpit from '\.\/modules\/Cockpit'$/m,
    'l’accueil reste chargé d’emblée : c’est la route par défaut, la différer ferait clignoter\n' +
      'l’écran d’ouverture à chaque démarrage à froid, sur tous les postes, tous les jours.',
  )
  assert.match(app, /<Suspense/, 'un repli existe pendant le chargement d’un écran')

  const html = lire('index.html')
  assert.match(html, /rel="manifest"/, 'le document déclare le manifeste')
  assert.match(html, /apple-touch-icon/, 'iOS n’utilise pas les icônes du manifeste')
}

// --- le manifeste ----------------------------------------------------------

{
  const manifeste = JSON.parse(lire('public/manifest.webmanifest'))
  assert.equal(manifeste.display, 'standalone')
  assert.ok(manifeste.name && manifeste.short_name, 'un nom court pour l’écran d’accueil')
  assert.ok(manifeste.icons.length >= 2, 'plusieurs tailles')
  assert.ok(
    manifeste.icons.some((i) => i.purpose === 'maskable'),
    'sans icône « maskable », Android rogne la marque dans son masque',
  )
  for (const icone of manifeste.icons) {
    assert.ok(existe(`public${icone.src}`), `icône déclarée et absente : ${icone.src}`)
  }
  assert.ok(existe('public/icones/apple-touch-icon.png'), 'l’icône iOS existe')
}

console.log(
  `Coquille hors ligne : ${coquille.length} fichiers préchargés, tous présents dans dist/ ; ` +
    'aucune donnée mise en cache (horsLigne.ts reste seul juge) ; aucune mise à jour silencieuse ; ' +
    'et le découpage par route tient — l’entrée ne pèse plus qu’une fraction du tout.',
)
