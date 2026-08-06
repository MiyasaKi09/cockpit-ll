const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

const config = lire('supabase/config.toml')
const configurationFonction = (nom) => {
  const motif = new RegExp(`\\[functions\\.${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]([\\s\\S]*?)(?=\\n\\[|$)`)
  return motif.exec(config)?.[1] || ''
}

// Les règles générales ci-dessous se DÉRIVENT du dossier des fonctions : une
// fonction nouvelle entre dans le périmètre toute seule. Une liste recopiée à
// la main, elle, laisserait le neuvième branchement sans aucune vérification
// — ce qui est arrivé, et qui ne se voit jamais puisque le test reste vert.
const TOUTES_LES_FONCTIONS = fs
  .readdirSync(path.join(racine, 'supabase/functions'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name)
  .sort()

/** `gmail-oauth` est le seul point d'entrée que Google appelle en GET (le
 *  retour `?code=`) : la règle « POST uniquement » ne peut pas s'y appliquer,
 *  et il porte à la place son jeton d'initiation signé, vérifié plus bas. */
const RETOUR_OAUTH = 'gmail-oauth'
const FONCTIONS_AUTHENTIFIEES = TOUTES_LES_FONCTIONS.filter((nom) => nom !== RETOUR_OAUTH)

/** Les méthodes qu'une fonction ANNONCE au navigateur. On s'en sert pour
 *  dériver la règle au lieu de la recopier : celle qui n'annonce que POST
 *  doit refuser tout le reste, celle qui en annonce plus (ingestion-config
 *  sert aussi GET et DELETE) est traitée pour ce qu'elle est. */
const methodesDeclarees = (nom) =>
  (/'Access-Control-Allow-Methods':\s*'([^']+)'/.exec(lire(`supabase/functions/${nom}/index.ts`)) || [, ''])[1]
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean)

const FONCTIONS_POST = TOUTES_LES_FONCTIONS.filter((nom) => {
  const m = methodesDeclarees(nom)
  return m.length === 2 && m.includes('POST') && m.includes('OPTIONS')
})
assert.ok(FONCTIONS_POST.length >= 6, 'la dérivation des fonctions « POST seulement » paraît vide')

for (const nom of [
  'gmail-oauth',
  'gmail-ingestion',
  'veille-collecte',
  'veille-mails',
  'veille-enrichir',
  'resume-messages',
]) {
  assert.match(configurationFonction(nom), /verify_jwt\s*=\s*false/, `${nom} doit accepter son auth applicative`)
}
assert.match(configurationFonction('ingestion-config'), /verify_jwt\s*=\s*true/, 'ingestion-config doit exiger un JWT')
for (const nom of FONCTIONS_POST) {
  assert.match(
    lire(`supabase/functions/${nom}/index.ts`),
    /req\.method !== 'POST'/,
    `${nom} doit refuser les méthodes autres que POST`,
  )
  assert.match(
    lire(`supabase/functions/${nom}/index.ts`),
    /req\.method === 'OPTIONS'/,
    `${nom} doit répondre au préflet : sans cela le navigateur n’émet jamais la requête`,
  )
}

const enrichir = lire('supabase/functions/veille-enrichir/index.ts')
const gmailIngestion = lire('supabase/functions/gmail-ingestion/index.ts')
const veilleCollecte = lire('supabase/functions/veille-collecte/index.ts')
assert.match(enrichir, /const JOBS_PAR_RUN = 4/, 'le lot doit rester sous le budget de temps Edge')
assert.match(enrichir, /candidate\.protocol\s*!==\s*'https:'/, 'HTTPS est obligatoire')
assert.match(enrichir, /candidate\.port/, 'les ports non standard doivent être rejetés')
assert.match(
  enrichir,
  /const chronoGlobal[\s\S]*for \(let saut[\s\S]*finally \{\s*clearTimeout\(chronoGlobal\)/,
  'le timeout doit couvrir les redirections et la lecture du corps',
)
assert.match(enrichir, /class ErreurEcriture extends Error/, 'les erreurs Supabase doivent être typées')
assert.match(
  enrichir,
  /status: erreurEcriture \? 'requeue' : 'failed'/,
  'une écriture Supabase en échec doit remettre le job en file',
)
assert.match(enrichir, /exigerEcriture\(depot, `Archivage de la page/, 'le stockage des pages doit être vérifié')
assert.match(enrichir, /exigerEcritureOuDoublon\(document, `Indexation du DCE/, 'le document DCE doit être vérifié')
assert.match(enrichir, /exigerEcritureOuDoublon\(entrant, `Indexation du DCE entrant/, 'l’entrant DCE doit être vérifié')
assert.match(enrichir, /exigerEcriture\(signalDce, `Marquage DCE du signal/, 'le niveau DCE doit être persisté')
assert.match(
  enrichir,
  /\.update\(\{[\s\S]*?parser_version: VERSION_PARSEUR[\s\S]*?\.select\('id'\)\s*\.maybeSingle\(\)/,
  'la finalisation du job doit vérifier qu’une ligne a été modifiée',
)
const migrationFile = lire('supabase/migrations/20260730085155_ingestion_veille_schema_reproductible.sql')
assert.match(
  migrationFile,
  /status = 'fetching'[\s\S]*started_at < now\(\) - interval '3 minutes'/,
  'les jobs interrompus doivent être automatiquement remis en file',
)
assert.match(
  migrationFile,
  /add column if not exists workspace_id text not null default 'agence-ll'/,
  'la migration doit compléter ingestion_config sur une base historique',
)
assert.match(
  migrationFile,
  /create unique index if not exists veille_signaux_source_unq/,
  'la déduplication des signaux doit aussi être créée sur une table existante',
)
assert.match(
  migrationFile,
  /create unique index if not exists veille_documents_version_unq/,
  'les versions DCE doivent être idempotentes',
)
assert.match(migrationFile, /pg_get_serial_sequence/, 'les séquences doivent être découvertes dynamiquement')
assert.doesNotMatch(
  migrationFile,
  /on sequence public\.veille_/,
  'la migration ne doit pas dépendre de noms de séquences implicites',
)
const migrationCron = lire('supabase/migrations/20260730085456_planification_edge_functions.sql')
for (const delai of migrationCron.matchAll(/timeout_milliseconds\s*:=\s*(\d+)/g)) {
  assert.ok(Number(delai[1]) >= 100_000, 'le délai pg_net doit couvrir le traitement Edge')
}
assert.equal(
  Array.from(migrationCron.matchAll(/timeout_milliseconds\s*:=/g)).length,
  4,
  'chaque tâche cron doit déclarer un délai explicite',
)

// Le contrôle d'accès passe par le registre des membres (livrable 0.2) et non
// plus par une liste d'adresses recopiée dans chaque fonction. Le détail est
// vérifié par scripts/test-registre-membres.cjs ; ici on garde le principe.
for (const nom of FONCTIONS_AUTHENTIFIEES) {
  assert.match(
    lire(`supabase/functions/${nom}/index.ts`),
    /from '\.\.\/_shared\/membres\.ts'/,
    `${nom} doit autoriser depuis le registre des membres, pas depuis une constante locale`,
  )
}

const oauth = lire('supabase/functions/gmail-oauth/index.ts')
const configIngestion = lire('supabase/functions/ingestion-config/index.ts')
assert.match(configIngestion, /workspaceId: cfg\?\.workspace_id/, 'le workspace configuré doit être exposé sans secret')
assert.match(configIngestion, /patch\.workspace_id = workspaceId/, 'le workspace doit être enregistré côté serveur')
assert.match(
  configIngestion,
  /if \(clientId\) patch\.client_id = clientId/,
  'un champ Client ID vide doit conserver le secret déjà stocké',
)
assert.match(
  gmailIngestion,
  /\.eq\('id', cfg\.workspace_id \|\| 'agence-ll'\)/,
  'Gmail doit lire le workspace configuré',
)
assert.match(
  veilleCollecte,
  /\.eq\('id', cfg\?\.workspace_id \|\| 'agence-ll'\)/,
  'la collecte doit lire le workspace configuré',
)
assert.match(
  enrichir,
  /planifierSurveillance\(sb, cfg\?\.workspace_id \|\| 'agence-ll'\)/,
  'l’enrichissement doit lire le workspace configuré',
)
assert.match(oauth, /verifierJetonInitiationOAuth/, 'le départ OAuth doit vérifier le jeton signé')
assert.match(configIngestion, /creerJetonInitiationOAuth/, 'le jeton doit venir de la fonction protégée par session')
assert.match(configIngestion, /urlConnexion/, 'une URL de connexion distincte du redirect URI est requise')
assert.match(oauth, /requeteJsonGoogle/, 'les appels Google doivent être bornés')
assert.match(oauth, /https:\/\/oauth2\.googleapis\.com\/token/, 'échange Google borné')
assert.match(oauth, /https:\/\/openidconnect\.googleapis\.com\/v1\/userinfo/, 'identité Google vérifiée')
assert.match(oauth, /\.select\('id'\)\s*\.maybeSingle\(\)/, 'la mise à jour du refresh token doit être vérifiée')

const fichiersEdge = []
;(function balayer(dossier) {
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, e.name)
    if (e.isDirectory()) balayer(complet)
    else if (e.name.endsWith('.ts')) fichiersEdge.push(path.relative(racine, complet))
  }
})(path.join(racine, 'supabase/functions'))
assert.ok(fichiersEdge.length >= 10, 'le balayage des sources Edge paraît vide')

for (const fichier of fichiersEdge) {
  const resultat = ts.transpileModule(lire(fichier), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: fichier,
    reportDiagnostics: true,
  })
  const erreurs = (resultat.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.equal(
    erreurs.length,
    0,
    `${fichier}: ${erreurs.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('; ')}`,
  )
}

for (const nom of TOUTES_LES_FONCTIONS) {
  assert.match(
    lire(`supabase/functions/${nom}/index.ts`),
    /jsr:@supabase\/supabase-js@2\.110\.0/,
    `${nom}: la dépendance Supabase doit être figée — une fonction Edge se redéploie avec ce qu’elle trouve`,
  )
}

async function testerJetonSigne() {
  const javascript = ts.transpileModule(lire('supabase/functions/_shared/oauth-init.ts'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
  const oauthInit = await import(moduleUrl)
  const maintenant = Date.now()
  const secret = 'secret-test-de-plus-de-trente-deux-caracteres'
  const jeton = await oauthInit.creerJetonInitiationOAuth(
    'architecte@example.com',
    'agence@example.com',
    secret,
    maintenant,
  )
  assert.equal(
    await oauthInit.verifierJetonInitiationOAuth(
      jeton,
      'agence@example.com',
      secret,
      maintenant + 1000,
    ),
    true,
  )
  assert.equal(
    await oauthInit.verifierJetonInitiationOAuth(
      jeton,
      'autre@example.com',
      secret,
      maintenant + 1000,
    ),
    false,
  )
  // Une altération est testée à trois endroits : le corps, le premier
  // caractère de la signature, et le dernier — dont les bits de bourrage
  // rendaient autrefois la falsification indétectable une fois sur seize.
  const alterer = (source, index) =>
    `${source.slice(0, index)}${source[index] === 'a' ? 'b' : 'a'}${source.slice(index + 1)}`
  const debutSignature = jeton.indexOf('.') + 1
  for (const [endroit, jetonAltere] of [
    ['le corps', alterer(jeton, 0)],
    ['le premier caractère de la signature', alterer(jeton, debutSignature)],
    ['le dernier caractère de la signature', alterer(jeton, jeton.length - 1)],
  ]) {
    assert.equal(
      await oauthInit.verifierJetonInitiationOAuth(
        jetonAltere,
        'agence@example.com',
        secret,
        maintenant + 1000,
      ),
      false,
      `un jeton altéré sur ${endroit} doit être refusé`,
    )
  }
  assert.equal(
    await oauthInit.verifierJetonInitiationOAuth(
      jeton,
      'agence@example.com',
      secret,
      maintenant + 10 * 60 * 1000 + 1,
    ),
    false,
  )
}

testerJetonSigne()
  .then(() => console.log('Edge Functions : configuration/auth, SSRF, délais et OAuth vérifiés.'))
  .catch((erreur) => {
    console.error(erreur)
    process.exitCode = 1
  })
