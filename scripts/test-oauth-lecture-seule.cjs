// ============================================================
// Livrable 0.14 — critères 1 et 14 du §22 : « continuer à
// travailler depuis Gmail » et « aucune réponse envoyée sans
// validation ».
//
// Ces deux critères sont déclarés satisfaits, et ils le sont — mais
// par une propriété du code, pas par une garantie. Rien n'empêche
// aujourd'hui d'ajouter `gmail.send` à une constante de périmètre :
// le consentement suivant l'accorderait, et l'argument affiché à
// l'utilisateur — « l'application ne PEUT pas envoyer » — deviendrait
// faux sans qu'aucune ligne ne le signale. Un critère satisfait par
// bonne volonté n'est pas un critère : c'est une intention.
//
// Ce test est statique : il lit les fichiers, il n'ouvre aucune
// connexion, il ne contacte ni Google ni Supabase. Il verrouille
// quatre choses.
//
// 1. LES PÉRIMÈTRES DEMANDÉS SONT EN LECTURE SEULE, PARTOUT. Toute
//    URL de périmètre Google écrite dans le dépôt doit appartenir à
//    une liste blanche de deux valeurs. La liste blanche l'emporte
//    sur la liste noire : `auth/calendar` tout court (lecture ET
//    écriture) ne contient aucun des mots interdits, et passerait un
//    contrôle par mots-clés.
// 2. LES DEUX CHEMINS N'ONT PAS LE MÊME PÉRIMÈTRE, ET C'EST VOULU.
//    Le navigateur (`src/google.ts`) porte `gmail.readonly` ET
//    `calendar.readonly` ; le jeton serveur (`gmail-oauth`) ne porte
//    que `gmail.readonly openid email` — le cron n'a AUCUN accès au
//    calendrier. Le plan (§3.9, §6) construit dessus : les
//    suggestions d'agenda ne peuvent naître que d'un onglet ouvert.
//    Élargir le périmètre serveur au calendrier invaliderait le
//    refresh token en place ; ce test rend cet effet de bord visible
//    au moment où on l'écrit, pas au prochain scan silencieux.
// 3. AUCUN VERBE D'ÉCRITURE VERS GOOGLE. Ni envoi, ni brouillon, ni
//    étiquette, ni corbeille ; et toute requête vers l'API Gmail ou
//    Agenda est un GET. Le seul POST autorisé est l'échange de jeton
//    OAuth, que le protocole impose.
// 4. LE SEUL CHEMIN SORTANT EST `gmailComposeUrl`. Il n'envoie rien :
//    il ouvre une fenêtre de rédaction Gmail pré-remplie, dans le
//    navigateur, devant un humain qui clique « Envoyer ». C'est la
//    forme exacte du critère 14 — et elle n'a de valeur que si elle
//    reste le seul constructeur.
//
// Périmètre de lecture : le code du dépôt. Les fichiers `.md` sont
// exclus délibérément — le plan et le cahier des charges NOMMENT les
// périmètres d'écriture pour expliquer pourquoi ils sont refusés, et
// un test qui interdirait d'écrire « gmail.send » dans une phrase
// interdirait d'en documenter le refus.
// ============================================================

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

const IGNORES = new Set(['node_modules', 'dist', '.git', 'docs'])
const EXTENSIONS = /\.(ts|tsx|js|cjs|mjs|sql|json|html|css|toml|ya?ml)$/
// ce fichier cite les périmètres qu'il interdit ; le lock-file n'est pas du code
const HORS_SCAN = new Set([`scripts/${path.basename(__filename)}`, 'package-lock.json'])

const parcourir = (dossier, acc = []) => {
  for (const entree of fs.readdirSync(path.join(racine, dossier || '.'), { withFileTypes: true })) {
    const relatif = dossier ? `${dossier}/${entree.name}` : entree.name
    if (entree.isDirectory()) {
      if (IGNORES.has(entree.name)) continue
      parcourir(relatif, acc)
    } else if (EXTENSIONS.test(entree.name) && !HORS_SCAN.has(relatif)) {
      acc.push(relatif)
    }
  }
  return acc
}

const fichiers = parcourir('')
assert.ok(fichiers.length > 50, `recensement inattendu : ${fichiers.length} fichiers de code`)

// ------------------------------------------------------------------
// 1. Tout périmètre Google écrit dans le dépôt est en lecture seule
// ------------------------------------------------------------------

const PERIMETRES_AUTORISES = new Set([
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
])

const perimetresTrouves = new Map() // périmètre → fichiers
for (const fichier of fichiers) {
  for (const m of lire(fichier).matchAll(/https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._-]+/g)) {
    if (!perimetresTrouves.has(m[0])) perimetresTrouves.set(m[0], [])
    perimetresTrouves.get(m[0]).push(fichier)
  }
}

assert.ok(perimetresTrouves.size > 0, 'aucun périmètre Google trouvé : le test ne vérifie plus rien')
for (const [perimetre, ou] of perimetresTrouves) {
  assert.ok(
    PERIMETRES_AUTORISES.has(perimetre),
    `périmètre Google non autorisé dans ${ou.join(', ')} : ${perimetre}\n` +
      'Seule la lecture est admise (gmail.readonly, calendar.readonly). Un périmètre ' +
      'd’écriture retire l’argument « l’application ne peut pas envoyer » du critère 14.',
  )
}

// La liste noire nommée par le plan, en plus de la liste blanche : elle donne
// un message d'échec immédiatement lisible, et couvre les formes qui ne sont
// pas des URL complètes (chaîne courte, variable d'environnement, doc Google).
const PERIMETRES_INTERDITS = [
  'gmail.send',
  'gmail.modify',
  'gmail.compose',
  'gmail.insert',
  'gmail.settings',
  'calendar.events',
  'calendar.app.created',
]
for (const fichier of fichiers) {
  const contenu = lire(fichier)
  for (const interdit of PERIMETRES_INTERDITS) {
    assert.ok(
      !contenu.includes(interdit),
      `${fichier} : périmètre d’écriture Google « ${interdit} ». Refusé au §6 du plan.`,
    )
  }
}

// ------------------------------------------------------------------
// 2. Les deux chemins, et leur asymétrie assumée
// ------------------------------------------------------------------

const google = lire('src/google.ts')
const perimetreNavigateur = /const SCOPES = '([^']+)'/.exec(google)
assert.ok(perimetreNavigateur, 'src/google.ts doit déclarer ses périmètres dans une constante SCOPES')
assert.deepEqual(
  perimetreNavigateur[1].split(/\s+/).sort(),
  [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
  ],
  'le chemin navigateur lit Gmail et l’Agenda, et rien d’autre',
)

const oauth = lire('supabase/functions/gmail-oauth/index.ts')
const perimetreServeur = /const SCOPES = '([^']+)'/.exec(oauth)
assert.ok(perimetreServeur, 'gmail-oauth doit déclarer ses périmètres dans une constante SCOPES')
assert.equal(
  perimetreServeur[1],
  'https://www.googleapis.com/auth/gmail.readonly openid email',
  'le jeton serveur lit Gmail et vérifie l’identité, rien de plus',
)
// L'absence de `calendar` ici n'est pas un oubli : c'est une décision du §6 sur
// laquelle repose le livrable 3.6 (suggestions calculées côté navigateur).
assert.ok(
  !perimetreServeur[1].includes('calendar'),
  'élargir le jeton serveur au calendrier invaliderait le refresh token en place (§6)',
)

// Le périmètre annoncé à Google au départ est bien celui de la constante :
// une chaîne recopiée dans l'URL d'autorisation divergerait sans bruit.
assert.match(
  oauth,
  /scope:\s*SCOPES/,
  'l’URL d’autorisation doit reprendre la constante SCOPES, jamais une chaîne recopiée',
)
assert.match(
  google,
  /scope:\s*SCOPES/,
  'le client de jeton du navigateur doit reprendre la constante SCOPES',
)

// ------------------------------------------------------------------
// 3. Aucun verbe d'écriture vers Google
// ------------------------------------------------------------------

// Points d'entrée d'écriture de l'API Gmail. `sendAs` relève des réglages du
// compte : le demander reviendrait à pouvoir écrire au nom de l'agence.
const APPELS_INTERDITS = [
  'messages/send',
  'sendAs',
  '/drafts',
  'batchModify',
  '/trash',
  '/untrash',
  'users/me/settings',
  'labels/',
]
for (const fichier of fichiers) {
  const contenu = lire(fichier)
  for (const interdit of APPELS_INTERDITS) {
    assert.ok(
      !contenu.includes(interdit),
      `${fichier} : appel d’écriture vers Gmail « ${interdit} ». ` +
        'Rien, dans le Cockpit, ne modifie la boîte de l’utilisateur (critère 1).',
    )
  }
}

// Toute requête vers l'API Gmail ou Agenda est un GET. On regarde ce qui suit
// immédiatement l'URL, ce qui couvre `fetch(url, {…})` comme un appel passant
// par un helper — la fonction n'a pas à s'appeler `fetch` pour écrire.
const API_LECTURE = /https:\/\/gmail\.googleapis\.com|https:\/\/www\.googleapis\.com\/calendar/g
let requetesLecture = 0
for (const fichier of fichiers) {
  const contenu = lire(fichier)
  for (const m of contenu.matchAll(API_LECTURE)) {
    requetesLecture++
    const suite = contenu.slice(m.index, m.index + 400)
    const verbe = /method\s*:\s*['"`]?([A-Za-z]+)/.exec(suite)
    assert.ok(
      !verbe || verbe[1].toUpperCase() === 'GET',
      `${fichier} : requête « ${verbe && verbe[1]} » vers l’API Google de lecture (${m[0]}). ` +
        'Seul GET est compatible avec les périmètres demandés.',
    )
  }
}
assert.ok(requetesLecture > 0, 'aucune requête vers l’API Google trouvée : le contrôle serait vide')

// Le seul POST vers Google est l'échange de jeton, imposé par OAuth.
const postsGoogle = []
for (const fichier of fichiers) {
  const contenu = lire(fichier)
  for (const m of contenu.matchAll(/https:\/\/[a-z0-9.-]*google[a-z0-9.-]*\.com[^\s'"`)]*/g)) {
    const suite = contenu.slice(m.index, m.index + 300)
    if (/method\s*:\s*['"`]?POST/.test(suite)) postsGoogle.push({ fichier, url: m[0] })
  }
}
for (const { fichier, url } of postsGoogle) {
  assert.equal(
    url,
    'https://oauth2.googleapis.com/token',
    `${fichier} : POST vers ${url}. Le seul POST admis vers Google est l’échange de jeton OAuth.`,
  )
}

// `src/google.ts` n'a qu'une porte de sortie : `apiGet`. Une seconde fonction
// de requête, même bien intentionnée, rouvrirait la question à chaque revue.
assert.equal(
  google.split('fetch(').length - 1,
  1,
  'src/google.ts ne doit avoir qu’un seul appel réseau (apiGet) : c’est lui qui garantit le GET',
)
const apiGet = /async function apiGet<T>\(url: string\): Promise<T> \{[\s\S]*?\n\}/.exec(google)
assert.ok(apiGet, 'apiGet doit rester la fonction de requête de src/google.ts')
assert.ok(!/method\s*:/.test(apiGet[0]), 'apiGet ne doit jamais fixer de méthode HTTP')

// L'état de la boîte de l'utilisateur n'est jamais modifié : « déjà vu » est
// une mémoire locale, pas une étiquette Gmail (critère 1).
const marquerVus = /export function marquerVus\([\s\S]*?\n\}/.exec(google)
assert.ok(marquerVus, 'marquerVus doit exister dans src/google.ts')
assert.match(marquerVus[0], /localStorage\.setItem/, 'le suivi des mails vus reste sur le poste')
assert.ok(
  !/googleapis|fetch\(/.test(marquerVus[0]),
  'marquer un mail « vu » dans le Cockpit ne doit rien changer dans Gmail',
)

// ------------------------------------------------------------------
// 4. Le seul chemin sortant : un brouillon ouvert devant un humain
// ------------------------------------------------------------------

const util = lire('src/util.ts')
const compose = /export function gmailComposeUrl\([\s\S]*?\n\}/.exec(util)
assert.ok(compose, 'gmailComposeUrl doit exister dans src/util.ts')
assert.match(compose[0], /view: 'cm'/, 'gmailComposeUrl ouvre une fenêtre de rédaction (view=cm)')
assert.match(compose[0], /https:\/\/mail\.google\.com\/mail\//, 'gmailComposeUrl produit une URL Gmail')
assert.ok(
  !/fetch\(|googleapis/.test(compose[0]),
  'gmailComposeUrl construit une URL et n’émet aucune requête : c’est ce qui fait le critère 14',
)

const ouvrir = /export function ouvrirGmail\([\s\S]*?\n\}/.exec(util)
assert.ok(ouvrir, 'ouvrirGmail doit exister dans src/util.ts')
assert.match(
  ouvrir[0],
  /window\.open\(gmailComposeUrl\(/,
  'ouvrirGmail affiche le brouillon : c’est un humain qui décide d’envoyer, ou pas',
)

// Un seul constructeur. Un module qui assemblerait son URL Gmail à la main
// contournerait la relecture sans qu'aucun test ne s'en aperçoive — c'est
// exactement la faille refermée sur les factures à émettre au livrable 0.11.
const auteursGmail = parcourir('src').filter((f) => lire(f).includes('mail.google.com'))
assert.deepEqual(
  auteursGmail,
  ['src/util.ts'],
  'seul src/util.ts construit une URL Gmail ; ailleurs, on passe par ouvrirGmail/gmailComposeUrl',
)

console.log(
  `OAuth lecture seule : ${perimetresTrouves.size} périmètre(s) Google, tous en lecture ; ` +
    `${requetesLecture} requête(s) API toutes en GET, ${postsGoogle.length} POST (échange de jeton) ; ` +
    `${fichiers.length} fichiers de code sans verbe d’écriture Gmail ; ` +
    'un seul chemin sortant (brouillon Gmail ouvert devant un humain).',
)
