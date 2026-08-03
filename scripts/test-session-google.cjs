// La connexion Google ne doit pas se défaire à chaque rechargement — et le
// jeton ne doit pas être conservé pour autant.
//
// LE DÉFAUT SIGNALÉ
// ------------------
// `token` est une variable de MODULE. Un rechargement de page ré-évalue le
// module, le jeton repart à `null`, et la surveillance s'arrête jusqu'au
// prochain clic. L'expiration horaire produisait la même coupure.
//
// LE PIÈGE, ET C'EST LUI QUE CE TEST GARDE
// ------------------------------------------
// La correction évidente est de ranger le jeton dans `localStorage`. Ce
// serait un mauvais échange : un jeton d'accès y est lisible par n'importe
// quel script de la page, il survit à la fermeture de l'onglet sur un poste
// partagé, et il expire de toute façon au bout d'une heure — on aurait le
// risque ET la coupure.
//
// La reprise SILENCIEUSE (`prompt: ''`) referme les deux coupures sans rien
// stocker. Quelqu'un qui, plus tard, trouvera ce mécanisme trop subtil et le
// remplacera par un `localStorage.setItem` fera échouer ce test, et lira
// pourquoi.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')

const google = lire('src/google.ts')
const surveillance = lire('src/surveillance.ts')
const parametres = lire('src/modules/Parametres.tsx')

// --- 1. le jeton n'est jamais conservé -------------------------------------

{
  // Le fichier a un usage LÉGITIME du stockage : `mailsDejaVus` mémorise les
  // identifiants déjà remontés, pour ne pas resignaler deux fois le même
  // mail. Interdire tout `localStorage` ici échouerait donc sur du code
  // correct — et un test qui échoue sur du code correct finit désactivé.
  // Ce qui est interdit, c'est d'y ranger LE JETON.
  const ecritures = [...google.matchAll(/(localStorage|sessionStorage)\.setItem\(\s*([A-Za-z_$][\w$]*|'[^']*')/g)]
  const clesAutorisees = new Set(['CLE_VUS'])
  for (const [, magasin, cle] of ecritures) {
    assert.ok(
      clesAutorisees.has(cle),
      `écriture inattendue dans ${magasin} sous « ${cle} ». Si c’est le jeton Google, c’est précisément\n` +
        'l’échange à ne pas faire : lisible par tout script de la page, survivant à la fermeture de\n' +
        'l’onglet sur un poste partagé, et périmé au bout d’une heure de toute façon. La reprise\n' +
        'silencieuse règle la coupure SANS rien stocker.',
    )
  }

  // Et, quelle que soit la clé, le jeton ne doit franchir aucun stockage.
  for (const ligne of google.split('\n')) {
    if (ligne.trimStart().startsWith('//') || ligne.trimStart().startsWith('*')) continue
    if (!/(localStorage|sessionStorage|document\.cookie|indexedDB)/.test(ligne)) continue
    assert.doesNotMatch(
      ligne,
      /\btoken\b|\bexpireA\b|access_token/,
      `le jeton passe par un stockage : ${ligne.trim()}`,
    )
  }

  assert.match(google, /^let token: string \| null = null$/m, 'il reste une variable de module, volontairement')
  assert.doesNotMatch(google, /document\.cookie|indexedDB/, 'aucun autre stockage n’apparaît dans ce fichier')
}

// --- 2. la reprise est bien SILENCIEUSE ------------------------------------

{
  assert.match(
    google,
    /requestAccessToken\(\{ prompt: '' \}\)/,
    'la reprise doit passer `prompt: \'\'` — sans lui Google ouvre une fenêtre, et une fenêtre qui\n' +
      's’ouvre toute seule à chaque chargement de page est pire que la coupure qu’on répare',
  )
  assert.match(google, /export async function assurerJeton/, 'le point d’entrée existe')

  // Elle ne doit JAMAIS rejeter : un échec est une réponse normale (« pas de
  // session Google ici »). Une exception ferait tomber le tick de
  // surveillance, donc toute la scrutation, pour une cause bénigne.
  const bloc = /function repriseSilencieuse[\s\S]*?\n\}/.exec(google)
  assert.ok(bloc, 'la reprise silencieuse est isolée dans sa fonction')
  assert.match(bloc[0], /catch/, 'elle rattrape ses propres erreurs')
  assert.doesNotMatch(bloc[0], /\brej\(|reject\(/, 'elle ne rejette pas : l’appelant lit un booléen')

  // Sans minuteur, une promesse que Google ne résout jamais suspendrait la
  // boucle pour de bon — et le badge dirait « en direct » alors que plus
  // rien n’est scruté. C’est le pire des deux états : faux ET rassurant.
  assert.match(bloc[0], /setTimeout\(/, 'un minuteur garantit que la promesse se résout toujours')
  assert.match(google, /DELAI_REPRISE_MS/, 'ce délai est nommé, pas un nombre perdu dans le code')
}

// --- 3. on ne martèle pas Google -------------------------------------------

{
  assert.match(google, /DELAI_AVANT_NOUVEL_ESSAI_MS/, 'un échec espace les tentatives suivantes')
  assert.match(
    google,
    /dernierEchecSilencieux && Date\.now\(\) - dernierEchecSilencieux < DELAI_AVANT_NOUVEL_ESSAI_MS/,
    'réessayer chaque minute ne ferait pas apparaître une session Google qui n’existe pas',
  )

  // Une connexion réussie doit EFFACER la mémoire de l'échec, sinon le
  // bouton « Connecter Google » resterait sans effet visible cinq minutes.
  const co = /export async function connecterGoogle[\s\S]*?\n\}/.exec(google)
  assert.match(co[0], /dernierEchecSilencieux = 0/, 'une connexion réussie débride la reprise')

  // Et se déconnecter doit TENIR : sans marqueur, le tick suivant
  // rebrancherait la surveillance et le bouton n'aurait servi à rien.
  const deco = /export function deconnecter\(\)[\s\S]*?\n\}/.exec(google)
  assert.match(deco[0], /dernierEchecSilencieux = Date\.now\(\)/, 'une déconnexion volontaire tient')
}

// --- 4. la boucle de surveillance s'en sert vraiment -----------------------

{
  assert.match(
    surveillance,
    /await assurerJeton\(sv\?\.clientId\)/,
    'la boucle doit APPELER la reprise. Tester `estConnecte()` seul rendait les deux coupures —\n' +
      'rechargement et expiration horaire — définitives jusqu’au prochain clic.',
  )
  const tick = /const tick = async \(\)[\s\S]*?\n    \}/.exec(surveillance)
  assert.ok(tick, 'le tick est identifiable')
  assert.doesNotMatch(
    tick[0],
    /if \(!estConnecte\(\)\) \{\s*\n\s*setDirect\(false\)/,
    'le test synchrone d’origine est encore là : la reprise ne sera jamais tentée',
  )
}

// --- 5. l'écran dit vrai ---------------------------------------------------

{
  // La carte lit `estConnecte()` au rendu, alors que la reprise a lieu hors
  // du composant. Sans branchement, elle afficherait « non connecté »
  // pendant que la surveillance tourne — et on recliquerait pour rien.
  assert.match(parametres, /useSurveillanceCtx\(\)/, 'la carte suit l’état réel de la boucle')
  assert.match(parametres, /assurerJeton\(sv\.clientId\)/, 'et tente la reprise à l’ouverture de l’écran')
}

// --- les périmètres restent en lecture seule -------------------------------

{
  // Ce livrable touche à l'authentification Google : l'occasion rêvée
  // d'élargir un périmètre « pendant qu'on y est ». `test:oauth` le vérifie
  // sur tout le dépôt ; on le redit ici, sur le fichier modifié.
  const scopes = /const SCOPES = '([^']+)'/.exec(google)[1].split(' ')
  assert.deepEqual(
    scopes.sort(),
    ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.readonly'],
    'la reprise silencieuse demande EXACTEMENT les mêmes périmètres, tous deux en lecture seule',
  )
  assert.equal(
    (google.match(/scope: SCOPES/g) || []).length,
    2,
    'les deux chemins (clic et silence) passent par la même constante — deux listes divergeraient',
  )
}

console.log(
  'Session Google : reprise silencieuse au rechargement et à l’expiration (prompt vide, aucune fenêtre), ' +
    'jeton toujours en mémoire seule, tentatives espacées après échec, déconnexion volontaire qui tient, ' +
    'et périmètres identiques sur les deux chemins.',
)
