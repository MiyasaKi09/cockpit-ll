// Livrable 0.10 — « référentiel de catégorisation des échanges » (CDC §5.2).
//
// Ce référentiel est consommé par la vague A : les CHECK de la table
// `communications` (A.2) et le classifieur déterministe (A.3) en sortent.
// Les régressions possibles ne font aucun bruit, d'où ce test :
//
//  1. une liste qui s'ouvre — une valeur ajoutée en base et pas ici, ou
//     l'inverse — et l'écart ne se voit qu'au premier INSERT refusé, en
//     production ;
//  2. `PhaseCode` étendu « pour faire simple » : quatre phases sans
//     montant ni pourcentage de mission entreraient dans l'échéancier de
//     facturation (REPARTITION_PHASES, src/echeancier.ts) ;
//  3. un niveau d'importance ajouté sans gravité : il retomberait sur un
//     défaut silencieux et un bloquant se rangerait avec les informations ;
//  4. `migrate()` qui reconstruit les courriers champ par champ : tout
//     champ non listé disparaît au premier rechargement, sans erreur ;
//  5. la reprise des axes qui s'exécute à chaque chargement au lieu d'une
//     fois : un axe délibérément vidé se remplirait à nouveau la nuit
//     suivante, et la correction humaine ne tiendrait pas ;
//  6. un référentiel qui se met à écrire (store, Supabase, React) : ce
//     livrable n'écrit AUCUNE donnée, il dit seulement ce qui existe.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

/** charge un module TypeScript pur (sans React ni DOM) pour l'exercer */
function charger(fichier, dependances = {}) {
  const compile = ts.transpileModule(lire(fichier), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (dependances[id]) return dependances[id]
    throw new Error(`Import runtime inattendu dans ${fichier} : ${id}`)
  })
  return mod.exports
}

const util = charger('src/util.ts')
const miqcp = charger('src/miqcp.ts')
const cat = charger('src/categorisation.ts', { './util': util, './miqcp': miqcp })
const source = lire('src/categorisation.ts')

// --- 1. `PhaseCode` n'a pas bougé -------------------------------------------
//
// Le livrable l'interdit explicitement : ce type porte la chaîne
// d'honoraires. On vérifie la liste littérale, pas seulement le cardinal.

const types = lire('src/types.ts')
const phaseCode = /export type PhaseCode =\s*\n\s*\|([^\n]*)/.exec(types)
assert.ok(phaseCode, 'src/types.ts : le type PhaseCode est introuvable')
const codesMission = phaseCode[1]
  .split('|')
  .map((v) => v.trim().replace(/^'|'$/g, ''))
  .filter(Boolean)
assert.deepEqual(
  codesMission,
  ['DIAG', 'ESQ', 'APS', 'APD', 'PRO', 'ACT-DCE', 'VISA', 'DET', 'AOR', 'MC'],
  'src/types.ts : PhaseCode ne doit PAS être étendu — les phases d’échange vivent dans src/categorisation.ts (§3.14)',
)
assert.deepEqual(
  miqcp.PHASES_ORDRE,
  codesMission,
  'src/miqcp.ts : PHASES_ORDRE et PhaseCode doivent rester la même liste',
)

// --- 2. les trois listes sont fermées, complètes, sans doublon --------------

const listes = [
  ['PHASES_ECHANGE', cat.PHASES_ECHANGE, cat.LIBELLES_PHASE_ECHANGE, 14],
  ['TYPES_ECHANGE', cat.TYPES_ECHANGE, cat.LIBELLES_TYPE_ECHANGE, 15],
  ['NIVEAUX_IMPORTANCE', cat.NIVEAUX_IMPORTANCE, cat.LIBELLES_IMPORTANCE, 6],
]
for (const [nom, valeurs, libelles, cardinal] of listes) {
  assert.ok(Array.isArray(valeurs), `src/categorisation.ts : ${nom} doit être exporté`)
  assert.equal(
    valeurs.length,
    cardinal,
    `src/categorisation.ts : ${nom} doit compter exactement ${cardinal} valeurs (CDC §5.2), lu ${valeurs.length}`,
  )
  assert.equal(new Set(valeurs).size, cardinal, `src/categorisation.ts : ${nom} contient un doublon`)
  assert.deepEqual(
    Object.keys(libelles).sort(),
    [...valeurs].sort(),
    `src/categorisation.ts : les libellés de ${nom} doivent couvrir la liste, ni plus ni moins — un libellé manquant s’affiche « undefined »`,
  )
  for (const v of valeurs)
    assert.ok(libelles[v] && libelles[v].trim(), `src/categorisation.ts : libellé vide pour ${nom}.${v}`)
}

// --- 3. PhaseEchange est un superset de PhaseCode, et STRUCTURELLEMENT -------

for (const code of codesMission)
  assert.ok(
    cat.PHASES_ECHANGE.includes(code),
    `src/categorisation.ts : la phase de mission ${code} doit exister dans PHASES_ECHANGE`,
  )
for (const hors of ['PROSPECTION', 'CONCOURS', 'DOE', 'SAV'])
  assert.ok(
    cat.PHASES_ECHANGE.includes(hors),
    `src/categorisation.ts : la phase hors mission ${hors} du CDC §5.2 manque à PHASES_ECHANGE`,
  )
assert.match(
  source,
  /export const PHASES_ECHANGE[^\n]*\.\.\.PHASES_ORDRE/,
  'src/categorisation.ts : PHASES_ECHANGE doit être construit AVEC ...PHASES_ORDRE — une liste recopiée oublierait la prochaine phase de mission, en silence',
)
assert.match(
  source,
  /export type PhaseEchange = PhaseCode \| PhaseHorsMission/,
  'src/categorisation.ts : PhaseEchange doit être défini comme PhaseCode | PhaseHorsMission — un superset recopié cesserait d’en être un',
)
for (const code of codesMission)
  assert.equal(
    cat.estPhaseDeMission(code),
    true,
    `src/categorisation.ts : estPhaseDeMission(${code}) doit être vrai`,
  )
for (const hors of ['PROSPECTION', 'CONCOURS', 'DOE', 'SAV'])
  assert.equal(
    cat.estPhaseDeMission(hors),
    false,
    `src/categorisation.ts : ${hors} n’est pas une phase de mission — elle n’a ni montant ni % d’honoraires`,
  )

// --- 4. graviteDe couvre les SIX niveaux, dans l'échelle 1-3 de alerts.ts ---

const gravites = cat.NIVEAUX_IMPORTANCE.map((n) => cat.graviteDe(n))
assert.equal(gravites.length, 6, 'graviteDe doit être exercé sur les six niveaux du CDC §5.2')
for (const [i, g] of gravites.entries())
  assert.ok(
    g === 1 || g === 2 || g === 3,
    `src/categorisation.ts : graviteDe(${cat.NIVEAUX_IMPORTANCE[i]}) = ${g} sort de l’échelle 1-3 de Alerte.gravite`,
  )
for (let i = 1; i < gravites.length; i++)
  assert.ok(
    gravites[i] >= gravites[i - 1],
    `src/categorisation.ts : l’axe d’importance est ORDONNÉ — graviteDe(${cat.NIVEAUX_IMPORTANCE[i]}) = ${gravites[i]} est inférieur à graviteDe(${cat.NIVEAUX_IMPORTANCE[i - 1]}) = ${gravites[i - 1]}`,
  )
assert.equal(gravites[gravites.length - 1], 3, 'le niveau le plus fort doit être en gravité 3 (rouge)')
assert.equal(cat.graviteDe('bloquant'), 3, 'un échange bloquant est de gravité 3')
assert.equal(cat.graviteDe('contractuel'), 3, 'le contractuel ne se rattrape pas — gravité 3')
assert.equal(cat.graviteDe('information'), 1)
assert.match(
  source,
  /const GRAVITES: Record<NiveauImportance, 1 \| 2 \| 3>/,
  'src/categorisation.ts : la table des gravités doit être un Record exhaustif — un switch laisserait un septième niveau retomber sur un défaut silencieux',
)

const alerts = lire('src/alerts.ts')
assert.match(
  types.slice(types.indexOf('export interface Alerte')),
  /gravite: 1 \| 2 \| 3/,
  'src/types.ts : l’échelle de Alerte.gravite a changé — la projection de graviteDe ne vise plus rien',
)
assert.ok(alerts.includes('gravite:'), 'src/alerts.ts : l’échelle de gravité visée est introuvable')

// --- 5. l'ancienne urgence 1-3 est la réciproque exacte de graviteDe --------

for (const u of [1, 2, 3]) {
  const niveau = cat.importanceDepuisUrgence(u)
  assert.ok(niveau, `importanceDepuisUrgence(${u}) doit donner un niveau`)
  assert.equal(
    cat.graviteDe(niveau),
    u,
    `src/categorisation.ts : l’urgence ${u} d’un courrier existant doit se retrouver à l’identique après reprise — sinon le fil d’urgences se réordonne tout seul`,
  )
}
for (const rien of [undefined, null, 0, 4, '2', {}])
  assert.equal(
    cat.importanceDepuisUrgence(rien),
    null,
    `importanceDepuisUrgence(${JSON.stringify(rien)}) doit rester vide plutôt que d’inventer`,
  )

// --- 6. normalisation : tolérante en entrée, fermée en sortie ---------------

assert.equal(cat.normaliserPhaseEchange('DIAG'), 'DIAG')
assert.equal(cat.normaliserPhaseEchange('  aor '), 'AOR', 'la casse et les espaces ne doivent pas décider')
assert.equal(
  cat.normaliserPhaseEchange('Faisabilité'),
  'DIAG',
  'divergence déclarée §3.14 : la « Faisabilité » du CDC est le DIAG du dépôt',
)
assert.equal(
  cat.normaliserPhaseEchange('DCE'),
  'ACT-DCE',
  'divergence déclarée §3.14 : DCE et ACT sont facturés ensemble — une seule valeur stockée',
)
assert.equal(cat.normaliserPhaseEchange('ACT'), 'ACT-DCE')
assert.equal(cat.normaliserPhaseEchange('Prospection'), 'PROSPECTION')
for (const inconnu of ['EXE', 'phase 3', '', ' ', null, undefined, 7])
  assert.equal(
    cat.normaliserPhaseEchange(inconnu),
    null,
    `normaliserPhaseEchange(${JSON.stringify(inconnu)}) doit rendre null — une phase approchée est pire qu’une phase à choisir`,
  )

assert.equal(cat.normaliserTypeEchange('client'), 'client')
assert.equal(cat.normaliserTypeEchange('Bureau de contrôle'), 'bureau_de_controle', 'le libellé affiché doit être reconnu')
assert.equal(cat.normaliserTypeEchange('bureau_de_controle'), 'bureau_de_controle')
assert.equal(cat.normaliserTypeEchange('Réclamation'), 'reclamation')
assert.equal(
  cat.normaliserTypeEchange('administratif'),
  'administration',
  'l’ancien Courrier.type « administratif » a une traduction certaine',
)
for (const nonTraduit of ['question', 'document', 'commercial', 'autre', 'mail reçu'])
  assert.equal(
    cat.normaliserTypeEchange(nonTraduit),
    null,
    `« ${nonTraduit} » décrit la forme du message, pas l’interlocuteur : l’axe doit rester à choisir`,
  )

assert.equal(cat.normaliserImportance('a_traiter'), 'a_traiter')
assert.equal(cat.normaliserImportance('À traiter'), 'a_traiter')
assert.equal(cat.normaliserImportance('URGENT'), 'urgent')
assert.equal(cat.normaliserImportance('critique'), null)

// --- 7. reprendreAxes : dérive une fois, respecte le vide voulu -------------

const neuf = cat.reprendreAxes({ type: 'administratif', urgence: 3 })
assert.deepEqual(
  neuf,
  { phaseEchange: null, typeEchange: 'administration', importance: 'urgent' },
  'un courrier jamais repris doit être dérivé de `type` et `urgence`, et sa phase rester à choisir',
)
assert.deepEqual(
  cat.reprendreAxes({ type: 'mail reçu' }),
  { phaseEchange: null, typeEchange: null, importance: null },
  'ce qui n’est pas déductible reste vide — aucun axe n’est inventé',
)
assert.deepEqual(
  cat.reprendreAxes({ type: 'question', urgence: 2, phaseEchange: 'DET', typeEchange: 'bet', importance: 'bloquant' }),
  { phaseEchange: 'DET', typeEchange: 'bet', importance: 'bloquant' },
  'une correction humaine doit être conservée telle quelle, jamais réécrite par la dérivation',
)
assert.deepEqual(
  cat.reprendreAxes({ type: 'administratif', urgence: 3, phaseEchange: null, typeEchange: null, importance: null }),
  { phaseEchange: null, typeEchange: null, importance: null },
  'un axe DÉLIBÉRÉMENT vidé doit le rester : sinon la dérivation le remplit à nouveau au rechargement suivant',
)
assert.deepEqual(
  cat.reprendreAxes({ type: 'client', phaseEchange: 'EXE', typeEchange: 'ami', importance: 'critique' }),
  { phaseEchange: null, typeEchange: null, importance: null },
  'une valeur hors liste fermée (import JSON, futur producteur) doit être ramenée à null — elle disparaîtrait des filtres sans erreur',
)
const repris = cat.reprendreAxes({ type: 'administratif', urgence: 1 })
assert.deepEqual(
  cat.reprendreAxes({ type: 'administratif', urgence: 1, ...repris }),
  repris,
  'la reprise doit être idempotente : elle s’exécute à chaque chargement',
)

// --- 8. le palier v19 est bien branché, et ne perd rien --------------------

const seed = lire('src/seed.ts')
const version = /export const STATE_VERSION = (\d+)/.exec(seed)
assert.ok(version, 'src/seed.ts : STATE_VERSION introuvable')
assert.ok(
  Number(version[1]) >= 19,
  `src/seed.ts : STATE_VERSION doit passer le palier des axes de catégorisation (19 minimum, lu ${version[1]})`,
)
assert.match(seed, /\/\/ v19 :/, 'src/seed.ts : le palier v19 doit être documenté comme les précédents')

const store = lire('src/store.tsx')
const repriseCourriers = /etat\.courriers = \(Array\.isArray\(parsed\.courriers\)[\s\S]*?\n  \}\)\)/.exec(store)
assert.ok(
  repriseCourriers,
  'src/store.tsx : migrate() doit reprendre les courriers sur les trois axes (palier v19)',
)
assert.match(
  repriseCourriers[0],
  /\.\.\.c,/,
  'src/store.tsx : la reprise doit repartir du courrier complet (...c) — une reconstruction champ par champ effacerait tout champ non listé, en silence',
)
assert.match(
  repriseCourriers[0],
  /reprendreAxes\(c\)/,
  'src/store.tsx : migrate() doit appeler reprendreAxes — une seconde règle de reprise écrite ici divergerait de celle que la vague A consomme',
)
assert.match(
  store,
  /import \{ reprendreAxes \} from '\.\/categorisation'/,
  'src/store.tsx : la reprise doit venir du référentiel, pas d’un doublon local',
)

const courrier = /export interface Courrier \{([\s\S]*?)\n\}/.exec(types)
assert.ok(courrier, 'src/types.ts : interface Courrier introuvable')
assert.match(
  courrier[1],
  /\n  type: string/,
  'src/types.ts : Courrier.type reste du texte libre — il est la trace de ce qui a été écrit, donc la source dont typeEchange se re-dérive',
)
for (const [champ, type] of [
  ['phaseEchange', 'PhaseEchange'],
  ['typeEchange', 'TypeEchange'],
  ['importance', 'NiveauImportance'],
])
  assert.match(
    courrier[1],
    new RegExp(`\\b${champ}\\?: ${type} \\| null`),
    `src/types.ts : Courrier.${champ} doit être OPTIONNEL et nullable — aucun courrier existant ne le porte, et null veut dire « à choisir »`,
  )
assert.match(
  types,
  /import type \{ NiveauImportance, PhaseEchange, TypeEchange \} from '\.\/categorisation'/,
  'src/types.ts : les trois axes doivent être IMPORTÉS du référentiel (import de types seul) — les redéclarer ici rouvrirait les listes',
)

// --- 9. le référentiel n'écrit rien, et ne dépend de rien d'écrivant -------

for (const interdit of ["from './store'", "from './sync'", '@supabase', 'react', 'localStorage'])
  assert.ok(
    !source.includes(interdit),
    `src/categorisation.ts : « ${interdit} » n’a rien à faire dans un référentiel — ce livrable n’écrit AUCUNE donnée`,
  )
const imports = [...source.matchAll(/^import .*from '([^']+)'/gm)].map((m) => m[1])
assert.deepEqual(
  imports.sort(),
  ['./miqcp', './types', './util'],
  'src/categorisation.ts : le référentiel ne doit dépendre que de ./types (types seuls), ./miqcp et ./util',
)
assert.match(
  source,
  /import type \{ PhaseCode \} from '\.\/types'/,
  'src/categorisation.ts : l’import de ./types doit rester un import de TYPES — src/types.ts importe en retour les trois axes',
)

console.log(
  'test-categorisation : OK — PhaseCode intact, trois listes fermées (14/15/6), graviteDe exhaustif et croissant sur 1-3, reprise v19 idempotente et sans perte.',
)
