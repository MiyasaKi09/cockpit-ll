// Les fonctions appelées depuis le navigateur doivent autoriser les en-têtes
// que supabase-js envoie — sinon la requête n'est jamais émise.
//
// LE DÉFAUT QU'IL FERME
// ----------------------
// `ingestion-config` déclarait `Access-Control-Allow-Headers: authorization,
// content-type`. Or `supabase-js` joint TOUJOURS `apikey` et `x-client-info`
// à ses appels. Le navigateur envoie donc un préflight demandant ces quatre
// en-têtes, la fonction n'en autorise que deux, et le navigateur BLOQUE la
// requête avant de l'émettre.
//
// Ce qui remonte à l'écran est « Failed to send a request to the Edge
// Function » — un message qui ressemble à une panne réseau ou à une fonction
// éteinte. On va donc chercher le défaut partout sauf là où il est : dans une
// liste d'en-têtes de six mots. La carte « Ingestion serveur » n'a
// probablement jamais fonctionné depuis un navigateur.
//
// POURQUOI CE TEST N'EST PAS UNE LISTE DE FICHIERS
// --------------------------------------------------
// Il lit d'abord `src/` pour savoir quelles fonctions le navigateur appelle
// VRAIMENT (`functions.invoke`), puis vérifie celles-là. Ajouter demain un
// appel client vers une septième fonction la fera entrer dans le périmètre
// toute seule — une liste écrite à la main, elle, resterait en arrière et le
// test validerait à vide.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')

// Ce que supabase-js joint à chaque appel de fonction. `apikey` et
// `x-client-info` sont ajoutés par la bibliothèque, jamais par l'appelant :
// on ne les voit donc pas en lisant le code du Cockpit.
const ENTETES_SUPABASE_JS = ['authorization', 'apikey', 'x-client-info', 'content-type']

// --- qui est appelé depuis le navigateur ? ---------------------------------

const fichiersClient = []
;(function balayer(dossier) {
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, e.name)
    if (e.isDirectory()) balayer(complet)
    else if (/\.tsx?$/.test(e.name)) fichiersClient.push(path.relative(racine, complet))
  }
})(path.join(racine, 'src'))

const appelees = new Set()
for (const f of fichiersClient) {
  for (const m of lire(f).matchAll(/functions\.invoke\(\s*'([^']+)'/g)) appelees.add(m[1])
}

assert.ok(
  appelees.size > 0,
  'aucun `functions.invoke` trouvé dans src/ : soit le client n’appelle plus aucune fonction,\n' +
    'soit ce test ne sait plus les repérer — dans les deux cas il ne garde plus rien.',
)

// --- chacune autorise ce que le navigateur va demander ---------------------

for (const nom of [...appelees].sort()) {
  const chemin = `supabase/functions/${nom}/index.ts`
  assert.ok(fs.existsSync(path.join(racine, chemin)), `${nom} est appelée par le client mais n’existe pas`)

  const source = lire(chemin)
  const declare = /'Access-Control-Allow-Headers':\s*'([^']+)'/.exec(source)
  assert.ok(declare, `${nom} : aucune déclaration d’en-têtes CORS — tout appel navigateur sera bloqué`)

  const autorises = declare[1].split(',').map((h) => h.trim().toLowerCase())
  for (const requis of ENTETES_SUPABASE_JS) {
    assert.ok(
      autorises.includes(requis),
      `${nom} n’autorise pas l’en-tête « ${requis} », que supabase-js envoie systématiquement.\n` +
        `Déclaré : ${autorises.join(', ')}\n` +
        'Conséquence : le navigateur refuse au préflight et n’émet JAMAIS la requête. L’écran affiche\n' +
        '« Failed to send a request to the Edge Function », qui ressemble à une panne réseau ou à une\n' +
        'fonction éteinte — et on cherche le défaut partout sauf dans cette liste.',
    )
  }

  // La méthode employée par le client doit être autorisée elle aussi.
  const methodes = (/'Access-Control-Allow-Methods':\s*'([^']+)'/.exec(source) || [, ''])[1]
    .split(',')
    .map((m) => m.trim().toUpperCase())
  assert.ok(methodes.includes('OPTIONS'), `${nom} : sans OPTIONS, le préflight lui-même échoue`)

  for (const f of fichiersClient) {
    for (const m of lire(f).matchAll(new RegExp(`functions\\.invoke\\(\\s*'${nom}',\\s*\\{[^}]*method:\\s*'(\\w+)'`, 'g'))) {
      assert.ok(
        methodes.includes(m[1].toUpperCase()),
        `${nom} est appelée en ${m[1]} depuis ${f}, mais n’autorise que : ${methodes.join(', ')}`,
      )
    }
  }

  // Un gestionnaire OPTIONS doit exister : déclarer les en-têtes sans répondre
  // au préflight revient au même refus, pour une autre raison.
  assert.match(
    source,
    /req\.method === 'OPTIONS'/,
    `${nom} : les en-têtes sont déclarés mais rien ne répond au préflight`,
  )
}

console.log(
  `CORS des fonctions Edge : ${appelees.size} fonction(s) appelées depuis le navigateur ` +
    `(${[...appelees].sort().join(', ')}), toutes autorisent authorization, apikey, x-client-info et ` +
    'content-type — les quatre en-têtes que supabase-js joint à chaque appel — et répondent au préflight.',
)
