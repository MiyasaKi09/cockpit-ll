const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'syncState.ts'), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2021,
  },
  fileName: 'syncState.ts',
}).outputText
const moduleSync = { exports: {} }
const enveloppe = vm.runInNewContext(
  `(function (exports, require, module) { ${javascript}\n})`,
)
enveloppe(moduleSync.exports, () => {
  throw new Error('Aucun import runtime attendu dans syncState.ts.')
}, moduleSync)

const {
  COLLECTIONS_ADDITIVES,
  changementCibleInterdit,
  cibleSynchronisation,
  etatPartageable,
  fusionnerEtatDistant,
  namespaceSynchronisation,
} = moduleSync.exports
const collections = [
  'projets',
  'marches',
  'situations',
  'factures',
  'temps',
  'references',
  'obligations',
  'contacts',
  'interactions',
  'artisans',
  'materiaux',
  'consultations',
  'prompts',
  'reunions',
  'courriers',
  'tempsHorsProjet',
  'absences',
  'evaluations',
  'lotsDce',
  'tachesChantier',
  'registreDocuments',
  'entreprises',
  'organisations',
  'echeancesFacturation',
  'paiements',
  'contrats',
  'facturesAchat',
  'notesFrais',
  'attendusFinanciers',
  'transactionsBancaires',
  'importsBancaires',
  'lotsComptables',
  'revisionsResteAFaire',
  'pistesAvenant',
  'decisionsDirection',
  'simulations',
  'connecteurs',
]
assert.deepEqual(Array.from(COLLECTIONS_ADDITIVES), collections)

const local = {
  version: 16,
  settings: {
    nomAgence: 'Locale',
    sync: { url: 'https://projet.test', anonKey: 'publique', workspaceId: 'agence' },
  },
  corpusDocuments: [
    { id: 'public-local', prive: false, texte: 'public local' },
    { id: 'prive-1', prive: true, texte: 'secret local' },
  ],
}
for (const nom of collections) local[nom] = [`local-${nom}`]

const partage = etatPartageable(local)
assert.equal(partage.settings.sync, undefined)
assert.deepEqual(
  partage.corpusDocuments.map((document) => document.id),
  ['public-local'],
)
assert.equal(local.corpusDocuments.length, 2, 'la source locale ne doit pas être mutée')

const distant = {
  version: 16,
  settings: { nomAgence: 'Partagée' },
  corpusDocuments: [
    { id: 'public-distant', texte: 'public distant' },
    { id: 'prive-fuite', prive: true, texte: 'ne doit pas entrer' },
    { id: 'prive-1', texte: 'ancienne copie publique du secret' },
  ],
}
const fusion = fusionnerEtatDistant(distant, local)
assert.deepEqual(
  Array.from(fusion.corpusDocuments, (document) => document.id),
  ['public-distant', 'prive-1'],
)
assert.equal(fusion.corpusDocuments[1].texte, 'secret local')
assert.deepEqual(fusion.lotsDce, ['local-lotsDce'])
assert.deepEqual(fusion.connecteurs, ['local-connecteurs'])
for (const nom of collections)
  assert.deepEqual(fusion[nom], [`local-${nom}`], `${nom} absent doit rester local`)
assert.deepEqual(fusion.settings.sync, local.settings.sync)
assert.equal(fusion.settings.nomAgence, 'Partagée')

const suppressionExplicite = fusionnerEtatDistant(
  { ...distant, interactions: [], absences: [], connecteurs: [] },
  local,
)
assert.deepEqual(suppressionExplicite.interactions, [])
assert.deepEqual(suppressionExplicite.absences, [])
assert.deepEqual(suppressionExplicite.connecteurs, [])

const cibleA = cibleSynchronisation(local.settings.sync)
assert.equal(
  cibleA,
  cibleSynchronisation({
    ...local.settings.sync,
    url: ' HTTPS://PROJET.TEST/ ',
  }),
  'URL équivalente normalisée',
)
assert.notEqual(
  cibleA,
  cibleSynchronisation({ ...local.settings.sync, workspaceId: 'autre' }),
)
assert.notEqual(
  cibleA,
  cibleSynchronisation({ ...local.settings.sync, anonKey: 'autre-cle' }),
)
assert.equal(cibleSynchronisation({ url: '', anonKey: '', workspaceId: '' }), null)
assert.equal(
  namespaceSynchronisation(local.settings.sync),
  namespaceSynchronisation({ ...local.settings.sync, anonKey: 'cle-tournee' }),
  'une rotation de clé publique conserve le verrou du même workspace',
)
assert.equal(changementCibleInterdit(cibleA, `${cibleA}-autre`, true), true)
assert.equal(
  changementCibleInterdit(cibleA, null, true),
  true,
  'vider la configuration en deux temps ne doit pas contourner la garde dirty',
)
assert.equal(changementCibleInterdit(cibleA, `${cibleA}-autre`, false), false)
assert.equal(changementCibleInterdit(null, cibleA, true), false)

const sourceSecurite = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'syncSafety.ts'),
  'utf8',
)
const javascriptSecurite = ts.transpileModule(sourceSecurite, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2021,
  },
  fileName: 'syncSafety.ts',
}).outputText
const valeursStockees = new Map()
const stockage = {
  getItem: (cle) => (valeursStockees.has(cle) ? valeursStockees.get(cle) : null),
  setItem: (cle, valeur) => valeursStockees.set(cle, valeur),
  removeItem: (cle) => valeursStockees.delete(cle),
}
function chargerSecurite() {
  const moduleSecurite = { exports: {} }
  const contexte = vm.createContext({
    Date,
    exports: moduleSecurite.exports,
    localStorage: stockage,
    module: moduleSecurite,
  })
  const enveloppeSecurite = vm.runInContext(
    `(function (exports, module) { ${javascriptSecurite}\n})`,
    contexte,
  )
  enveloppeSecurite(moduleSecurite.exports, moduleSecurite)
  return moduleSecurite.exports
}

const securite1 = chargerSecurite()
assert.equal(securite1.recuperationLocaleRequise(), false)
securite1.marquerRecuperationLocaleRequise()
assert.equal(securite1.recuperationLocaleRequise(), true)
assert.equal(valeursStockees.size, 1)
const securiteApresReload = chargerSecurite()
assert.equal(
  securiteApresReload.recuperationLocaleRequise(),
  true,
  'le verrou de corruption doit survivre à un rechargement',
)
assert.equal(securiteApresReload.effacerRecuperationLocaleRequise(), true)
assert.equal(chargerSecurite().recuperationLocaleRequise(), false)

const sourceRuntime = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'sync.ts'),
  'utf8',
)
const javascriptRuntime = ts.transpileModule(sourceRuntime, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2021,
  },
  fileName: 'sync.ts',
}).outputText

async function testerCoursesRuntime() {
  const session = {
    access_token: 'jeton-test',
    user: { email: 'agence@example.test' },
  }
  let obtenirSession = async () => ({ data: { session }, error: null })
  let deconnexion = async () => {}
  let appelsRpc = 0
  const fauxClient = {
    auth: {
      getSession: () => obtenirSession(),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
      signInWithOtp: async () => ({ error: null }),
      signOut: () => deconnexion(),
    },
    removeChannel: async () => {},
    rpc: async () => {
      appelsRpc++
      return {
        data: [{ revision: 0, updated_at: '2026-07-30T10:00:00.000Z' }],
        error: null,
      }
    },
  }
  const securiteRuntime = chargerSecurite()
  const moduleRuntime = { exports: {} }
  const contexteRuntime = vm.createContext({
    clearTimeout,
    crypto: require('node:crypto').webcrypto,
    Date,
    exports: moduleRuntime.exports,
    fetch: async () => {
      throw new Error('fetch inattendu')
    },
    localStorage: stockage,
    module: moduleRuntime,
    setTimeout,
    window: { location: { origin: 'https://cockpit.test', pathname: '/' } },
  })
  const enveloppeRuntime = vm.runInContext(
    `(function (exports, require, module) { ${javascriptRuntime}\n})`,
    contexteRuntime,
  )
  enveloppeRuntime(
    moduleRuntime.exports,
    (identifiant) => {
      if (identifiant === './syncState') return moduleSync.exports
      if (identifiant === './syncSafety') return securiteRuntime
      if (identifiant === '@supabase/supabase-js')
        return { createClient: () => fauxClient }
      throw new Error(`Import runtime inattendu : ${identifiant}`)
    },
    moduleRuntime,
  )
  const runtime = moduleRuntime.exports
  const config = {
    url: 'https://projet.test',
    anonKey: 'publique',
    workspaceId: 'agence',
  }
  const etatMinimal = {
    version: 16,
    settings: { sync: config },
    corpusDocuments: [],
  }

  await runtime.connecterSync(config.url, config.anonKey, config.workspaceId)
  const cible = runtime.cibleSyncCourante()
  assert.equal(cible, cibleSynchronisation(config))
  const mauvaiseCible = await runtime.pousserEtat(etatMinimal, `${cible}-autre`)
  assert.equal(mauvaiseCible.ok, false)
  assert.equal(appelsRpc, 0, 'une cible différente ne doit jamais atteindre le RPC')

  securiteRuntime.marquerRecuperationLocaleRequise()
  const apresCorruption = await runtime.pousserEtat(etatMinimal, cible)
  assert.equal(apresCorruption.ok, false)
  assert.equal(apresCorruption.conflit, true)
  assert.equal(appelsRpc, 0, 'le verrou de corruption bloque le RPC au niveau le plus bas')
  assert.equal(securiteRuntime.effacerRecuperationLocaleRequise(), true)
  const envoiValide = await runtime.pousserEtat(etatMinimal, cible)
  assert.equal(envoiValide.ok, true)
  assert.equal(appelsRpc, 1)

  let resoudreJeton
  obtenirSession = () =>
    new Promise((resolve) => {
      resoudreJeton = resolve
    })
  const lectureJeton = runtime.jetonAccesSync()
  await Promise.resolve()
  const fermeture = runtime.deconnecterSync()
  resoudreJeton({ data: { session }, error: null })
  assert.equal(
    await lectureJeton,
    null,
    'une ancienne lecture de session ne doit pas survivre à la déconnexion',
  )
  await fermeture

  obtenirSession = async () => ({ data: { session }, error: null })
  await runtime.connecterSync(config.url, config.anonKey, config.workspaceId)
  let libererDeconnexion
  deconnexion = () =>
    new Promise((resolve) => {
      libererDeconnexion = resolve
    })
  let lecturesSession = 0
  obtenirSession = async () => {
    lecturesSession++
    return { data: { session }, error: null }
  }
  const fermetureLente = runtime.deconnecterSync()
  const lecturesAvantReconnexion = lecturesSession
  const reconnexion = runtime.connecterSync(
    config.url,
    config.anonKey,
    config.workspaceId,
  )
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(
    lecturesSession,
    lecturesAvantReconnexion,
    'la reconnexion doit attendre la fin du signOut précédent',
  )
  libererDeconnexion()
  await fermetureLente
  await reconnexion
  assert.equal(lecturesSession, lecturesAvantReconnexion + 1)
}

testerCoursesRuntime()
  .then(() => {
    console.log(
      'OK — synchronisation : confidentialité, fusion additive, cibles et courses de session vérifiées.',
    )
  })
  .catch((erreur) => {
    console.error(erreur)
    process.exitCode = 1
  })
