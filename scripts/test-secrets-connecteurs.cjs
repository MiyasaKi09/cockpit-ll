// LES IDENTIFIANTS D'API TIERS NE SORTENT PAS DE LEUR FONCTION EDGE.
//
// Deux branchements nouveaux ont apporté SIX secrets à fort privilège :
// l'identifiant d'API GoCardless (il ouvre la lecture de tous les comptes
// bancaires connectés) et les quatre identifiants Chorus Pro — dont un compte
// technique qui HÉRITE des droits du gestionnaire principal sur TOUTES ses
// structures. Aucun d'eux ne doit approcher le navigateur.
//
// LES QUATRE FAÇONS DE LES PERDRE, ET CE QUE CE TEST EN FERME
// ------------------------------------------------------------
//  1. LE BUNDLE. Une variable préfixée `VITE_` est recopiée EN CLAIR dans le
//     JavaScript servi à tout le monde. C'est la fuite la moins visible : rien
//     ne casse, rien n'alerte, et le secret est publié.
//  2. L'ÉTAT DE L'APPLICATION. `AppState` part dans `localStorage` et dans une
//     colonne JSONB que le navigateur relit. Un identifiant rangé là est
//     lisible par quiconque ouvre la console.
//  3. LA RÉPONSE DE LA FONCTION. Renvoyer la configuration « pour l'afficher »
//     est le geste le plus naturel du monde, et le plus coûteux. L'écran a
//     besoin des NOMS des secrets absents, jamais de leurs valeurs.
//  4. LA BASE. Une table sans RLS, ou avec une policy pour `authenticated`,
//     rend au navigateur ce que la fonction avait mis à l'abri.
//
// ET LA CLÉ `service_role` : elle contourne toutes les RLS. Elle vit dans les
// secrets de la plateforme et ne doit exister nulle part ailleurs — ni dans
// `src/`, ni dans `api/` (qui part sur Vercel), ni dans un workflow.
//
// CE TEST NE LIT PAS UNE LISTE ÉCRITE À LA MAIN : il DÉRIVE l'inventaire des
// secrets depuis les `Deno.env.get` réellement présents dans les fonctions.
// Une septième plateforme branchée demain entre donc dans le périmètre toute
// seule ; une liste recopiée, elle, resterait en arrière et validerait à vide.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')

function fichiersSous(dossier, motif) {
  const sortie = []
  const complet = path.join(racine, dossier)
  if (!fs.existsSync(complet)) return sortie
  ;(function balayer(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const chemin = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue
        balayer(chemin)
      } else if (motif.test(e.name)) sortie.push(path.relative(racine, chemin))
    }
  })(complet)
  return sortie
}

const fonctionsEdge = fs
  .readdirSync(path.join(racine, 'supabase/functions'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name)

const sourcesEdge = fichiersSous('supabase/functions', /\.ts$/)

// ============================================================
// 1. L'INVENTAIRE DES SECRETS, DÉRIVÉ DU CODE
// ============================================================

/** ce que la plateforme Supabase fournit d'elle-même : ce ne sont pas des
 *  secrets de plateforme tierce, et `SUPABASE_URL` n'en est pas un du tout */
const FOURNIS_PAR_LA_PLATEFORME = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])

/** Les variables d'environnement qu'un fichier de fonction lit réellement.
 *  Deux façons : `Deno.env.get('NOM')` en clair, et le détour par un helper
 *  `secret(nom)` — les noms sont alors dans une constante voisine, et la
 *  valeur au bout est la même. Ne voir que la première forme laisserait
 *  quatre identifiants Chorus hors du périmètre. */
function secretsLusPar(fichier) {
  const source = lire(fichier)
  const noms = new Set()
  for (const m of source.matchAll(/Deno\.env\.get\(\s*'([A-Z0-9_]+)'/g)) noms.add(m[1])
  if (/Deno\.env\.get\(nom\)/.test(source)) {
    for (const m of source.matchAll(/'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g)) noms.add(m[1])
  }
  return [...noms].filter((nom) => !FOURNIS_PAR_LA_PLATEFORME.has(nom))
}

const lusParLesFonctions = new Set()
for (const f of sourcesEdge) for (const nom of secretsLusPar(f)) lusParLesFonctions.add(nom)

const secretsTiers = [...lusParLesFonctions].sort()

// Anti-vacuité : si ce balayage ne voyait plus rien, tout le reste passerait
// pour vert en ne vérifiant rien du tout.
for (const attendu of [
  'GOCARDLESS_SECRET_ID',
  'GOCARDLESS_SECRET_KEY',
  'CHORUS_CLIENT_ID',
  'CHORUS_CLIENT_SECRET',
  'CHORUS_TECHNIQUE_LOGIN',
  'CHORUS_TECHNIQUE_MOTDEPASSE',
]) {
  assert.ok(
    secretsTiers.includes(attendu),
    `${attendu} n’a pas été trouvé parmi les Deno.env.get des fonctions Edge : soit le branchement a disparu,\n` +
      'soit ce test ne sait plus repérer les secrets — dans les deux cas il ne garde plus rien.',
  )
}
assert.ok(secretsTiers.length >= 8, 'l’inventaire des secrets tiers paraît trop court pour être complet')

// --- 1.1 un secret ne se lit QUE dans la fonction qui en a besoin ----------
//
// Le nom d'un secret a le droit d'être écrit dans un message (« vérifiez
// CHORUS_CLIENT_ID ») : c'est la VALEUR qui ne doit pas circuler. Ce qui se
// vérifie, c'est le confinement — un identifiant bancaire lu depuis une
// fonction publique (`gmail-oauth` accepte des requêtes sans session) serait
// exposé par la porte de cette fonction-là, pas par la sienne.
{
  /** Un secret peut légitimement être lu par deux fonctions quand il sert à
   *  SIGNER d'un côté et à VÉRIFIER de l'autre : les deux moitiés d'un même
   *  verrou. Chaque partage se déclare ici avec sa raison — un partage qu'on
   *  ne sait pas justifier est un partage qu'il ne faut pas faire. */
  const PARTAGES_ASSUMES = {
    // `ingestion-config` signe le jeton d'initiation OAuth, `gmail-oauth` le
    // vérifie : sans la même clé, le départ OAuth ne serait pas protégé.
    GMAIL_OAUTH_INIT_SECRET: ['ingestion-config', 'gmail-oauth'],
  }
  const lecteurs = new Map()
  for (const f of sourcesEdge) {
    const fonction = f.split('/')[2]
    for (const nom of secretsLusPar(f)) lecteurs.set(nom, (lecteurs.get(nom) || new Set()).add(fonction))
  }
  for (const [nom, ou] of lecteurs) {
    if (ou.size === 1) continue
    assert.deepEqual(
      [...ou].sort(),
      [...(PARTAGES_ASSUMES[nom] || [])].sort(),
      `${nom} est lu par ${[...ou].join(' et ')}. Un identifiant tiers appartient à UNE fonction :\n` +
        'partagé, il s’expose par la porte la moins bien fermée des deux. Si le partage est voulu,\n' +
        'déclarez-le dans PARTAGES_ASSUMES avec sa raison.',
    )
  }
  assert.deepEqual([...lecteurs.get('GOCARDLESS_SECRET_KEY')], ['banque-sync'])
  assert.deepEqual([...lecteurs.get('CHORUS_TECHNIQUE_MOTDEPASSE')], ['chorus-sync'])
}

// --- 1.2 aucun identifiant collé en dur ------------------------------------
//
// Le chemin le plus court vers une fuite : un jeton d'essai copié pendant la
// mise au point et jamais retiré. On refuse toute chaîne qui a la forme d'une
// clé — et on l'exige dans les fonctions comme dans le navigateur.
for (const f of [...sourcesEdge, ...fichiersSous('src', /\.(ts|tsx)$/)]) {
  const sf = ts.createSourceFile(f, lire(f), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const parcourir = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const t = n.text
      assert.ok(
        !(/^[A-Za-z0-9_-]{28,}$/.test(t) && /[0-9]/.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t)),
        `${f} : la chaîne « ${t.slice(0, 12)}… » a la forme d’un identifiant d’API collé en dur.\n` +
          'Un secret d’essai oublié après la mise au point est la fuite la plus banale qui soit.',
      )
    }
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)
}

// ============================================================
// 2. AUCUN SECRET DU CÔTÉ NAVIGATEUR
// ============================================================
//
// `src/` part dans le bundle, `api/` et `vercel.json` partent sur Vercel,
// `.github/` est public dès que le dépôt l'est. Les noms de secrets ont le
// droit d'être écrits dans `docs/` (le runbook doit dire lesquels poser) et
// dans `scripts/` (ce test les nomme) — nulle part ailleurs.

// `scraper-worker/` est volontairement HORS de cette liste : c'est un
// processus Node lancé à la main sur un serveur, avec son propre
// `package.json` et ses propres variables — il tient légitimement la clé
// `service_role`. Il n'est ni compilé par Vite, ni déployé sur Vercel, et on
// le vérifie plutôt que de le supposer.
{
  const vite = lire('vite.config.ts')
  const vercel = lire('vercel.json')
  assert.ok(!vite.includes('scraper-worker'), 'scraper-worker ne doit pas entrer dans le bundle du navigateur')
  assert.ok(!vercel.includes('scraper-worker'), 'scraper-worker ne doit pas être déployé sur Vercel')
  assert.ok(
    fs.existsSync(path.join(racine, 'scraper-worker/package.json')),
    'scraper-worker doit rester un paquet séparé : c’est ce qui justifie qu’il détienne la clé service_role',
  )
}

const surfacesExposees = [
  ...fichiersSous('src', /\.(ts|tsx|js|css)$/),
  ...fichiersSous('api', /\.js$/),
  ...fichiersSous('public', /\.(js|json|html|webmanifest)$/),
  ...fichiersSous('.github', /\.(yml|yaml)$/),
  'index.html',
  'vite.config.ts',
  'vercel.json',
].filter((f) => fs.existsSync(path.join(racine, f)))

assert.ok(surfacesExposees.length > 20, 'le balayage des surfaces exposées paraît vide : il ne garderait rien')

// Le NOM d'un secret a le droit d'être AFFICHÉ : l'écran dit « il manque
// GOCARDLESS_SECRET_ID dans les secrets de la fonction », et c'est cette
// phrase qui évite une demi-journée de recherche. Ce qui est interdit, c'est
// de s'en SERVIR ici — `import.meta.env.X`, `process.env.X`, une constante du
// même nom : autant de façons de faire descendre une valeur dans le bundle.
const nomsSurveilles = new Set([...secretsTiers, ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_')])

for (const f of surfacesExposees) {
  if (/\.(yml|yaml)$/.test(f)) {
    // Un workflow a le droit d'EXPLIQUER qu'un secret ne se met pas là (c'est
    // le cas de `deployer-fonctions.yml`). Ce qui est interdit, c'est de s'en
    // servir : un secret recopié dans GitHub Actions vit désormais à deux
    // endroits, et le second ne se révoque pas avec le premier.
    const source = lire(f)
    for (const nom of nomsSurveilles) {
      for (const motif of [
        new RegExp(`secrets\\.${nom}\\b`),
        new RegExp(`vars\\.${nom}\\b`),
        new RegExp(`^\\s*${nom}\\s*:`, 'm'),
      ]) {
        assert.ok(
          !motif.test(source),
          `${f} SE SERT de ${nom}. Les secrets lus par les fonctions se règlent dans le tableau de bord\n` +
            'Supabase : les faire transiter par GitHub les recopie dans un second endroit qu’on oubliera de vider.',
        )
      }
    }
    continue
  }
  if (!/\.(ts|tsx|js)$/.test(f)) {
    for (const nom of nomsSurveilles) {
      assert.ok(!lire(f).includes(nom), `${f} mentionne ${nom} : ce fichier n’a rien à en savoir`)
    }
    continue
  }
  const sf = ts.createSourceFile(f, lire(f), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const usages = []
  const parcourir = (n) => {
    if (ts.isIdentifier(n) && nomsSurveilles.has(n.text)) usages.push(n.text)
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)
  assert.deepEqual(
    usages,
    [],
    `${f} SE SERT de ${usages.join(', ')} (identifiant, `.concat(
      'variable ou lecture d’environnement) au lieu de simplement l’afficher.\n',
      'Ce fichier part dans le navigateur ou sur Vercel : la valeur y serait publiée.',
    ),
  )
  // La clé qui contourne toutes les RLS ne s'affiche pas non plus : rien à
  // l'écran n'a besoin de la nommer.
  assert.ok(
    !lire(f).includes(['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_')),
    `${f} mentionne la clé service_role. Elle ne quitte JAMAIS Supabase : ni Vercel, ni le navigateur,\n` +
      'ni un fichier. Elle contourne toutes les RLS — la publier revient à publier la base.',
  )
}

// --- 2.1 aucune variable `VITE_` ne porte de secret ------------------------
//
// Vite recopie EN CLAIR toute variable préfixée `VITE_` dans le bundle. Ce
// n'est pas une fuite possible, c'est une publication.
{
  const vues = new Set()
  for (const f of [...surfacesExposees, ...fichiersSous('docs', /\.md$/)]) {
    for (const m of lire(f).matchAll(/\bVITE_[A-Z0-9_]+/g)) vues.add(m[0])
  }
  for (const nom of vues) {
    assert.ok(
      !/SECRET|KEY|TOKEN|PASSWORD|MOTDEPASSE|PASS|CREDENTIAL|SERVICE_ROLE|CLIENT_ID|LOGIN/.test(nom),
      `${nom} : une variable VITE_ part EN CLAIR dans le bundle servi à tout le monde. Un secret ne s’y met pas —\n` +
        'il vit dans les secrets de la fonction Edge (`Deno.env.get`).',
    )
  }
}

// --- 2.2 le navigateur n'appelle jamais les plateformes en direct ----------
//
// Si une adresse d'API tierce apparaissait dans `src/`, c'est que le
// navigateur s'apprêterait à l'appeler — donc à porter un identifiant.
for (const f of fichiersSous('src', /\.(ts|tsx)$/)) {
  const source = lire(f).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const domaine of ['bankaccountdata.gocardless.com', 'piste.gouv.fr', 'ob.gocardless.com']) {
    if (!source.includes(domaine)) continue
    // `ob.gocardless.com` arrive au navigateur dans le LIEN rendu par la
    // fonction : c'est une navigation de la personne vers sa banque, pas un
    // appel du Cockpit. Il ne doit donc pas être écrit en dur non plus.
    assert.fail(
      `${f} écrit ${domaine} en dur. Tous les appels sortants partent de la fonction Edge, qui seule détient\n` +
        'les identifiants ; le navigateur ne parle qu’à `supabase.functions.invoke`.',
    )
  }
}

// --- 2.3 le relais Vercel n'est pas ouvert à ces plateformes ---------------
//
// `api/relais.js` porte une liste blanche FERMÉE pour les appels que le
// NAVIGATEUR doit faire sans CORS. Y inscrire GoCardless ou PISTE ouvrirait
// un chemin navigateur vers une API qui exige un identifiant — c'est-à-dire
// la raison même pour laquelle ces appels sont côté serveur.
{
  const relais = lire('api/relais.js')
  const blanche = /const DOMAINES_AUTORISES = new Set\(\[([\s\S]*?)\]\)/.exec(relais)
  assert.ok(blanche, 'api/relais.js : la liste blanche est introuvable')
  for (const interdit of ['gocardless', 'piste.gouv', 'aife', 'chorus']) {
    assert.ok(
      !blanche[1].toLowerCase().includes(interdit),
      `api/relais.js : « ${interdit} » a été ajouté à la liste blanche. Ces API ne se joignent pas depuis le\n` +
        'navigateur : leurs identifiants sont côté serveur, et le relais n’a aucun chemin vers elles.',
    )
  }
  assert.ok(!/\*/.test(blanche[1]), 'aucun joker dans la liste blanche')
}

// ============================================================
// 3. LA RÉPONSE DES FONCTIONS NE PORTE QUE DES NOMS
// ============================================================
//
// Lu dans l'ARBRE : un identifiant CITÉ dans un message d'erreur (« vérifiez
// CHORUS_CLIENT_ID ») n'est pas un identifiant RENVOYÉ. Une recherche de
// texte confondrait les deux et rendrait ce test inutilisable.

/** les accesseurs qui portent une VALEUR de secret. La liste est courte et
 *  écrite à la main — mais elle ne peut pas pourrir : chacun est vérifié
 *  présent dans le code juste après. Le jour où l'un est renommé, ce test
 *  tombe et demande qu'on le relise, au lieu de garder le silence. */
const PORTEURS_DE_SECRET = {
  'supabase/functions/banque-sync/index.ts': ['secretId', 'secretKey'],
  'supabase/functions/chorus-sync/index.ts': ['clientId', 'clientSecret', 'login', 'motDePasse'],
}

for (const [fichier, porteurs] of Object.entries(PORTEURS_DE_SECRET)) {
  const source = lire(fichier)
  const sf = ts.createSourceFile(fichier, source, ts.ScriptTarget.Latest, true)

  for (const nom of porteurs) {
    assert.match(
      source,
      new RegExp(`\\b${nom}\\b`),
      `${fichier} : ${nom} a disparu. Ce test surveille des noms précis ; renommez-les ici en même temps,\n` +
        'sinon il continuerait de « passer » en ne regardant plus rien.',
    )
  }

  const fuites = []
  const inspecter = (noeud, ou) => {
    const voir = (n) => {
      if (ts.isIdentifier(n) && porteurs.includes(n.text)) fuites.push(`${ou} → ${n.text}`)
      if (ts.isPropertyAccessExpression(n) && porteurs.includes(n.name.text)) fuites.push(`${ou} → .${n.name.text}`)
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && porteurs.includes(n.name.text)) {
        fuites.push(`${ou} → ${n.name.text}:`)
      }
      ts.forEachChild(n, voir)
    }
    voir(noeud)
  }

  const parcourir = (n) => {
    // toute réponse HTTP passe par `json(...)`
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'json') {
      n.arguments.forEach((a) => inspecter(a, 'réponse json()'))
    }
    // les journaux de la plateforme sont lisibles dans le tableau de bord
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'console'
    ) {
      n.arguments.forEach((a) => inspecter(a, 'console.' + n.expression.name.text))
    }
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)

  assert.deepEqual(
    fuites,
    [],
    `${fichier} : un identifiant d’API sort de la fonction (${fuites.join(', ')}).\n` +
      'L’écran a besoin du NOM des secrets absents, jamais de leur valeur — et un journal de plateforme\n' +
      'se lit dans un tableau de bord.',
  )

  // Et rien de ce qui vient de l'environnement ne s'écrit en base.
  const ecritures = []
  const chercherEcritures = (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      /^(insert|upsert|update)$/.test(n.expression.name.text)
    ) {
      for (const a of n.arguments) if (/Deno\.env/.test(a.getText())) ecritures.push(a.getText().slice(0, 80))
    }
    ts.forEachChild(n, chercherEcritures)
  }
  chercherEcritures(sf)
  assert.deepEqual(ecritures, [], `${fichier} : un secret d’environnement est écrit en base`)
}

// --- 3.1 l'écran nomme les secrets manquants, il ne les demande pas --------
assert.match(
  lire('supabase/functions/chorus-sync/index.ts'),
  /const manquants = secretsManquants\(\)/,
  'la fonction doit calculer les NOMS des secrets absents — c’est ce qui permet à l’écran de dire quoi poser',
)
assert.match(
  lire('supabase/functions/chorus-sync/index.ts'),
  /configure: manquants\.length === 0/,
  '« configuré » se déduit des secrets présents, il ne se déclare pas',
)
assert.match(
  lire('supabase/functions/banque-sync/index.ts'),
  /const configure = identifiants\(\) !== null/,
  'la fonction doit dire SI elle est configurée, sans dire avec quoi',
)
// L'écran doit pouvoir NOMMER ce qui manque : sans cela, « ça ne marche pas »
// envoie chercher dans le mauvais tiroir.
assert.match(
  lire('src/modules/Facturation.tsx'),
  /statut\.manquants/,
  'l’écran Ventes doit afficher les noms rendus par la fonction, pas une liste recopiée à la main',
)

// ============================================================
// 4. CE QUE LE SERVEUR GARDE RESTE FERMÉ AU NAVIGATEUR
// ============================================================
//
// Les jetons dérivés (access 24 h, refresh 30 j) et les identifiants de
// ressources GoCardless sont en base. Une table sans RLS, ou avec une policy
// pour `authenticated`, les rendrait au navigateur — ce serait avoir mis le
// secret à l'abri dans la fonction pour le republier par la porte d'à côté.

const migrationsNouvelles = fs
  .readdirSync(path.join(racine, 'supabase/migrations'))
  .filter((f) => /^2026080[0-9]/.test(f) && /(banque|chorus)/.test(f))
assert.ok(migrationsNouvelles.length >= 2, 'les migrations des deux branchements sont introuvables')

for (const fichier of migrationsNouvelles) {
  const sql = lire(`supabase/migrations/${fichier}`)
  const tables = [...sql.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1])
  assert.ok(tables.length > 0, `${fichier} : aucune table créée — ce test ne garde rien`)

  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table}\\s+enable row level security`),
      `${fichier} : ${table} sans RLS — le navigateur la lirait avec la clé anon`,
    )
    assert.match(
      sql,
      new RegExp(`revoke all on table public\\.${table}\\s+from anon, authenticated`),
      `${fichier} : ${table} ne révoque pas anon/authenticated`,
    )
    assert.match(
      sql,
      new RegExp(`grant [a-z, ]+ on table public\\.${table}\\s+to service_role`),
      `${fichier} : ${table} doit rester accessible à la fonction Edge`,
    )
  }
  assert.ok(
    !/create policy/.test(sql),
    `${fichier} : une policy ouvrirait ces tables à un rôle client. Elles n’ont AUCUNE raison d’être lues\n` +
      'depuis un navigateur : c’est là que vivent les jetons.',
  )
}

// --- 4.1 les secrets ne passent pas non plus par l'état de l'application ----
//
// `AppState` part dans `localStorage` ET dans la colonne JSONB que le
// navigateur relit. Un identifiant rangé là serait lisible en deux clics.
{
  const types = lire('src/types.ts')
  for (const suspect of ['secretKey', 'secretId', 'clientSecret', 'motDePasse', 'accessToken', 'refreshToken']) {
    assert.ok(
      !new RegExp(`\\b${suspect}\\b`).test(types),
      `src/types.ts déclare ${suspect} : l’état de l’application n’est pas un coffre — il part dans localStorage.`,
    )
  }
  // ce que le Cockpit garde d'une connexion bancaire : de quoi RECONNAÎTRE un
  // compte, jamais de quoi l'appeler
  assert.match(types, /ibanMasque/, 'un IBAN ne se garde que masqué')
  assert.ok(
    !/compteId|gocardlessId|requisitionId/.test(types),
    'l’identifiant GoCardless d’un compte ne descend pas au navigateur : il désigne un compte par NOTRE ligne',
  )
}

// ============================================================
// 5. LES DEUX FONCTIONS SONT AUTHENTIFIÉES COMME LES AUTRES
// ============================================================

const config = lire('supabase/config.toml')
const configurationFonction = (nom) => {
  const motif = new RegExp(`\\[functions\\.${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]([\\s\\S]*?)(?=\\n\\[|$)`)
  return motif.exec(config)?.[1] || ''
}

// Les fonctions à auth applicative (appelées par cron ou par un redirect
// OAuth) déclarent `verify_jwt = false` et vérifient elles-mêmes. TOUTES LES
// AUTRES doivent exiger un JWT — déclaré, ou par le défaut de la plateforme.
const AUTH_APPLICATIVE = new Set([
  'gmail-oauth',
  'gmail-ingestion',
  'veille-collecte',
  'veille-mails',
  'veille-enrichir',
  'resume-messages',
])
for (const nom of fonctionsEdge) {
  if (AUTH_APPLICATIVE.has(nom)) continue
  assert.doesNotMatch(
    configurationFonction(nom),
    /verify_jwt\s*=\s*false/,
    `${nom} : cette fonction n’a pas d’auth applicative. Sans JWT, elle serait appelable par n’importe qui\n` +
      'avec la seule clé anon, qui est publique par construction.',
  )
  assert.match(
    lire(`supabase/functions/${nom}/index.ts`),
    /estMembreActif/,
    `${nom} doit vérifier le registre des membres : un JWT valide n’est pas une autorisation`,
  )
  assert.match(
    lire(`supabase/functions/${nom}/index.ts`),
    /auth\.getUser/,
    `${nom} doit relire le jeton porteur — deux verrous plutôt qu’un`,
  )
}

console.log(
  `Secrets des connecteurs : ${secretsTiers.length} identifiants tiers (${secretsTiers.join(', ')}) ` +
    'restent dans Deno.env.get, absents du bundle, des réponses, des journaux et de l’état ; ' +
    `${migrationsNouvelles.length} migrations ferment leurs tables au navigateur.`,
)
