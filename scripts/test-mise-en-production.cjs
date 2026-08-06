// Vérifie que la procédure de bascule reste cohérente avec le code.
//
// Le risque couvert est précis : la fenêtre d'ouverture des écritures directes
// se referme par un second script. Si les deux moitiés divergent — une policy
// créée mais jamais retirée, un privilège rendu mais jamais révoqué — la
// production reste ouverte en écriture directe sans que rien ne le signale.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

const ouvrir = lire('supabase/operations/workspace-ecritures-directes-ouvrir.sql')
const revoquer = lire('supabase/operations/workspace-ecritures-directes-revoquer.sql')
const migration = lire('supabase/migrations/20260729170200_workspace_revision_et_permissions.sql')
const planification = lire('supabase/migrations/20260730085456_planification_edge_functions.sql')
const runbook = lire('docs/MISE_EN_PRODUCTION.md')

// --- Les deux scripts d'opération sont l'inverse exact l'un de l'autre -------

const policiesCreees = [...ouvrir.matchAll(/create policy "([^"]+)" on public\.workspace/g)].map(
  (m) => m[1],
)
assert.ok(policiesCreees.length > 0, "le script d'ouverture doit créer au moins une policy")

for (const nom of policiesCreees) {
  assert.match(
    revoquer,
    new RegExp(`drop policy if exists "${nom}"\\s+on public\\.workspace`),
    `la policy « ${nom} » est créée à l'ouverture mais jamais retirée`,
  )
}

const privilegesRendus = new Set(
  [...ouvrir.matchAll(/grant ([a-z, ]+?) on table public\.workspace to authenticated/g)]
    .flatMap((m) => m[1].split(','))
    .map((mot) => mot.trim().toLowerCase())
    .filter(Boolean),
)
assert.ok(privilegesRendus.size > 0, "le script d'ouverture doit rendre au moins un privilège")
assert.ok(
  !privilegesRendus.has('delete'),
  "aucune version du Cockpit ne supprime la ligne partagée : delete ne doit pas être rendu",
)

const privilegesRevoques = new Set(
  [...revoquer.matchAll(/revoke ([a-z, ]+?) on table public\.workspace from authenticated/g)]
    .flatMap((m) => m[1].split(','))
    .map((mot) => mot.trim().toLowerCase())
    .filter(Boolean),
)
for (const privilege of privilegesRendus) {
  assert.ok(
    privilegesRevoques.has(privilege),
    `« ${privilege} » est rendu à l'ouverture mais jamais révoqué`,
  )
}

// La révocation doit aussi couvrir anon, que l'ouverture ne touche pas : un
// projet historique peut l'avoir conservé.
assert.match(
  revoquer,
  /revoke [a-z, ]+ on table public\.workspace from anon/,
  'la révocation doit également retirer les écritures à anon',
)

// --- La révocation rétablit exactement ce que la migration déclare -----------

assert.match(
  migration,
  /grant select on table public\.workspace to authenticated/,
  'la migration déclare la lecture pour authenticated',
)
assert.match(
  revoquer,
  /grant select on table public\.workspace to authenticated/,
  'la révocation doit conserver la lecture : le front lit la révision avant chaque envoi',
)
assert.match(
  revoquer,
  /proname = 'enregistrer_workspace'[\s\S]*raise exception/,
  'la révocation doit refuser de fermer l’ancien chemin si la RPC est absente',
)

// --- Les scripts d'opération ne doivent pas être joués par `db push` ---------

for (const fichier of fs.readdirSync(path.join(racine, 'supabase/migrations'))) {
  assert.ok(
    !/ecritures-directes/.test(fichier),
    `${fichier} : les scripts de bascule restent hors de supabase/migrations`,
  )
}

// --- Le runbook reste synchronisé avec le dépôt -----------------------------

const fonctions = fs
  .readdirSync(path.join(racine, 'supabase/functions'), { withFileTypes: true })
  .filter((entree) => entree.isDirectory() && !entree.name.startsWith('_'))
  .map((entree) => entree.name)

// Le runbook et le dépôt doivent contenir EXACTEMENT les mêmes fonctions.
//
// Un nombre écrit à la main (« sept fonctions attendues ») obligeait à le
// corriger à chaque livraison sans rien apprendre : il disait qu'un compte
// avait changé, pas lequel. La comparaison des deux ensembles dit les deux
// choses à la fois — la fonction nouvelle qu'on oublierait de déployer (elle
// existerait, éteinte, et l'écran afficherait une panne réseau) ET la ligne
// de déploiement restée pour une fonction supprimée (la commande échouerait
// au milieu de la bascule).
const deployees = [...runbook.matchAll(/functions deploy ([a-z0-9-]+)/g)].map((m) => m[1])
assert.deepEqual(
  [...new Set(deployees)].sort(),
  [...fonctions].sort(),
  'le runbook et supabase/functions/ ne déclarent pas les mêmes fonctions Edge',
)
assert.equal(deployees.length, new Set(deployees).size, 'une fonction est déployée deux fois par le runbook')

// --- Chaque secret lu par une fonction est nommé dans le runbook ------------
//
// Un secret que personne ne sait poser produit la pire des pannes : la
// fonction répond, poliment, qu'elle n'est pas configurée — et on cherche
// dans le code ce qui manquait dans un tableau de bord.
{
  const FOURNIS_PAR_LA_PLATEFORME = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
  const secrets = new Set()
  for (const nom of fonctions) {
    const chemin = path.join(racine, 'supabase/functions', nom)
    for (const fichier of fs.readdirSync(chemin).filter((f) => f.endsWith('.ts'))) {
      const source = lire(`supabase/functions/${nom}/${fichier}`)
      for (const m of source.matchAll(/Deno\.env\.get\(\s*'([A-Z0-9_]+)'/g)) secrets.add(m[1])
      // le détour par un helper `secret(nom)` : les noms sont dans une
      // constante voisine, et la valeur au bout est la même
      if (/Deno\.env\.get\(nom\)/.test(source)) {
        for (const m of source.matchAll(/'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g)) secrets.add(m[1])
      }
    }
  }
  for (const secret of [...secrets].sort()) {
    if (FOURNIS_PAR_LA_PLATEFORME.has(secret)) continue
    assert.ok(
      runbook.includes(secret),
      `${secret} est lu par une fonction Edge mais absent du runbook : personne ne saurait qu'il faut le poser,\n` +
        "et la fonction se contenterait de répondre qu'elle n'est pas configurée.",
    )
  }
}

for (const nom of [...planification.matchAll(/cron\.schedule\(\s*'([^']+)'/g)].map((m) => m[1])) {
  assert.ok(runbook.includes(nom), `la tâche planifiée ${nom} n'est pas vérifiée par le runbook`)
}

const variables = new Set(
  ['api/assistant.js', 'api/relais.js']
    .flatMap((fichier) => [...lire(fichier).matchAll(/process\.env\.([A-Z0-9_]+)/g)])
    .map((m) => m[1]),
)
for (const variable of variables) {
  assert.ok(
    runbook.includes(variable),
    `${variable} est lue par api/ mais absente du runbook : elle manquerait à la configuration Vercel`,
  )
}

// L'ordre des étapes est le garde-fou principal : les variables avant le front,
// le front avant la révocation.
const position = (motif) => runbook.search(motif)
assert.ok(
  position(/^## 3\. Configurer les variables/m) <
    position(/^## 5\. Déployer le front en production/m),
  'les variables Vercel se configurent avant le déploiement du front',
)
assert.ok(
  position(/^## 5\. Déployer le front en production/m) <
    position(/^## 6\. Appliquer la révocation finale/m),
  'la révocation finale vient après le déploiement du front',
)

// --- Aucun test écrit ne dort ------------------------------------------------

// Un test qu'on écrit mais qu'on ne branche ni à `npm test` ni à la CI donne
// exactement la fausse assurance qu'il était censé retirer : il existe, on le
// cite dans une revue, et il ne s'exécute jamais. C'est arrivé deux fois de
// suite pendant le Lot 0 — d'abord dans package.json, puis dans ci.yml.

const pkg = JSON.parse(lire('package.json'))
const ci = lire('.github/workflows/ci.yml')

const fichiersTest = fs
  .readdirSync(path.join(racine, 'scripts'))
  .filter((f) => /^test-.*\.cjs$/.test(f))

for (const fichier of fichiersTest) {
  const script = Object.entries(pkg.scripts).find(
    ([nom, cmd]) => nom.startsWith('test:') && cmd.includes(fichier),
  )
  assert.ok(
    script,
    `scripts/${fichier} n'a aucun script npm : un test que rien ne lance ne protège rien`,
  )
  assert.ok(
    pkg.scripts.test.includes(`npm run ${script[0]}`),
    `${script[0]} existe mais ne fait pas partie de \`npm test\``,
  )
  assert.ok(
    ci.includes(`npm run ${script[0]}`),
    `${script[0]} est dans \`npm test\` mais pas dans .github/workflows/ci.yml : il ne tournera pas en intégration`,
  )
}

console.log(
  `Mise en production : bascule cohérente, runbook synchronisé, ${fichiersTest.length} tests tous branchés.`,
)
