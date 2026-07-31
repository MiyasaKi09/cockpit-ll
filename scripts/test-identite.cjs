// Livrable 0.3 — « l'écran sait qui est devant lui ».
//
// Quatre invariants dont AUCUN ne produit d'erreur quand il casse : le
// Cockpit continue de fonctionner, il se met simplement à attribuer les
// gestes à la mauvaise personne, ou cesse de remarquer les connexions.
//
//  1. l'identité se résout en DEUX étages, dans cet ordre : session
//     Supabase reconnue, puis choix mémorisé sur le poste, puis rien ;
//  2. `useMoi()` ne retombe JAMAIS sur `settings.personnes[0]` — le
//     raccourci historique de Documents.tsx, qui réputait le premier de la
//     liste être tout le monde ;
//  3. le choix « je suis X » reste sur le poste (localStorage) et ne part
//     jamais dans `settings`, qui est synchronisé : les deux postes
//     s'écraseraient mutuellement ;
//  4. toute écriture de la session dans src/sync.ts passe par
//     `definirSession` — une écriture directe rend la session muette et
//     l'interface cesse de se mettre à jour à la connexion.
//
// Plus deux gardes sur le champ : `Personne.email` est optionnel, et il
// survit à la reconstruction champ par champ de l'équipe dans `migrate()`.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

// --- chargement de src/moi.ts, sans React ni store ---------------------------

const sourceMoi = lire('src/moi.ts')
const compile = ts.transpileModule(sourceMoi, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
// le module ne doit rien exiger de React ni du store AU CHARGEMENT : la
// résolution de l'identité est une règle métier, pas un détail de rendu
new Function('module', 'exports', 'require', compile)(mod, mod.exports, () => ({}))
const { resoudreMoi, normaliserEmail } = mod.exports

assert.equal(typeof resoudreMoi, 'function', 'src/moi.ts doit exporter resoudreMoi')
assert.equal(typeof normaliserEmail, 'function', 'src/moi.ts doit exporter normaliserEmail')

const equipe = [
  { id: 'p1', nom: 'Julien', email: 'Julien@Agence-LL.fr' },
  { id: 'p2', nom: 'Zoé' },
]

// --- 1. les deux étages, dans l'ordre ---------------------------------------

assert.deepEqual(
  resoudreMoi(equipe, 'julien@agence-ll.fr', 'Zoé'),
  { personne: equipe[0], source: 'session' },
  'une session reconnue prime sur le choix du poste — sinon le poste pourrait usurper un compte',
)

assert.deepEqual(
  resoudreMoi(equipe, null, 'Zoé'),
  { personne: equipe[1], source: 'poste' },
  'sans session, le repli par poste doit répondre : le Cockpit s’utilise hors ligne',
)

assert.deepEqual(
  resoudreMoi(equipe, 'inconnu@agence-ll.fr', 'Zoé'),
  { personne: equipe[1], source: 'poste' },
  'une session non rattachée ne doit pas effacer le choix du poste',
)

assert.deepEqual(
  resoudreMoi(equipe, null, null),
  { personne: null, source: 'aucune' },
  'sans session ni choix, l’identité est nulle — l’application ne devine pas',
)

assert.deepEqual(
  resoudreMoi(equipe, null, 'Ancien Nom'),
  { personne: null, source: 'aucune' },
  'un choix devenu introuvable ne doit désigner personne, surtout pas un homonyme de rang 0',
)

assert.deepEqual(
  resoudreMoi([], 'julien@agence-ll.fr', 'Julien'),
  { personne: null, source: 'aucune' },
  'une équipe vide ne doit pas faire tomber la résolution',
)

// --- 2. les formats d'adresse retenus par l'agence --------------------------

// personnelles prenom@agence-ll.fr, projet [code-projet]@agence-ll.fr :
// aucun domaine n'est présumé, seule la casse est neutralisée
assert.equal(normaliserEmail('  Prenom@Agence-LL.FR '), 'prenom@agence-ll.fr')
assert.equal(
  resoudreMoi([{ id: 'p', nom: 'Projet', email: 'p01@agence-ll.fr' }], 'P01@AGENCE-LL.FR', null)
    .source,
  'session',
  'une adresse projet doit être reconnue comme n’importe quelle autre',
)
assert.equal(normaliserEmail(null), '', 'une adresse absente ne doit jamais lever')
assert.equal(
  resoudreMoi([{ id: 'p', nom: 'Sans adresse' }], '', null).source,
  'aucune',
  'une session sans adresse ne doit rattacher personne',
)

// --- 3. le raccourci interdit et le stockage du repli -----------------------

const codeMoi = sourceMoi.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
assert.ok(
  !/personnes\s*\[\s*0\s*\]/.test(codeMoi) && !/equipe\s*\[\s*0\s*\]/.test(codeMoi),
  'src/moi.ts : l’identité ne doit jamais retomber sur le premier de la liste',
)
assert.ok(
  !/\bupdate\s*\(/.test(codeMoi) && !/d\.settings|settings\.\w+\s*=/.test(codeMoi),
  'src/moi.ts : le choix « je suis X » ne doit jamais être écrit dans settings — settings est synchronisé, les 2 postes s’écraseraient',
)
assert.match(
  codeMoi,
  /localStorage\.setItem\(\s*CLE_MOI/,
  'src/moi.ts : le choix du poste doit être mémorisé dans le localStorage du navigateur',
)

// --- 4. une seule porte d'écriture pour la session --------------------------

const sync = lire('src/sync.ts')
const debutDefinir = sync.indexOf('function definirSession(')
assert.ok(debutDefinir > 0, 'src/sync.ts : definirSession a disparu — la session redeviendrait muette')
const finDefinir = sync.indexOf('\n}', debutDefinir)
const ecritures = [...sync.matchAll(/^[ \t]*session = /gm)]
assert.equal(
  ecritures.length,
  1,
  `src/sync.ts : ${ecritures.length} écritures directes de \`session\` — elles doivent toutes passer par definirSession, sinon l’interface n’est plus prévenue des connexions`,
)
assert.ok(
  ecritures[0].index > debutDefinir && ecritures[0].index < finDefinir,
  'src/sync.ts : la seule écriture de `session` doit être celle de definirSession',
)
for (const exporte of ['abonnerSession', 'instantaneSession']) {
  assert.ok(
    new RegExp(`export function ${exporte}\\b`).test(sync),
    `src/sync.ts : ${exporte} doit rester exporté — src/moi.ts s’y abonne`,
  )
}
assert.match(
  sourceMoi,
  /useSyncExternalStore\(\s*abonnerSession/,
  'src/moi.ts : la session doit être lue par abonnement, pas par appel ponctuel',
)

// --- 5. le champ lui-même : optionnel, saisissable, et qui survit à migrate --

const types = lire('src/types.ts')
const personne = /export interface Personne \{([\s\S]*?)\n\}/.exec(types)
assert.ok(personne, 'src/types.ts : interface Personne introuvable')
assert.match(
  personne[1],
  /\bemail\?:\s*string/,
  'src/types.ts : Personne.email doit rester OPTIONNEL — le Cockpit s’utilise sans compte',
)

const store = lire('src/store.tsx')
const remap = /etat\.settings\.equipe = etat\.settings\.equipe\.map\(\(p\) => \{[\s\S]*?\n  \}\)/.exec(
  store,
)
assert.ok(remap, 'src/store.tsx : la reconstruction de l’équipe dans migrate() est introuvable')
assert.match(
  remap[0],
  /email:/,
  'src/store.tsx : migrate() reconstruit chaque personne champ par champ — sans `email`, l’adresse serait effacée à chaque rechargement, sans erreur',
)

const parametres = lire('src/modules/Parametres.tsx')
assert.match(
  parametres,
  /champ === 'email'/,
  'src/modules/Parametres.tsx : l’adresse doit rester saisissable dans la carte Équipe',
)
assert.match(
  parametres,
  /majPersonne\(p\.id, 'email', v\)/,
  'src/modules/Parametres.tsx : le champ adresse doit être rendu dans le tableau de l’équipe',
)

// --- 6. l'auteur d'une écriture partagée est établi par le serveur (0.5) -----
//
// Cinquième invariant muet : si `updated_by` redevenait un paramètre du
// client, le journal d'audit continuerait de se remplir — d'identifiants
// d'onglet. Rien ne casserait, et personne ne le verrait.

const migrations = fs
  .readdirSync(path.join(racine, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()

/** dernière définition SQL de la RPC : c'est elle qui fait foi en base */
const derniereDefinition = [...migrations.map((f) => `supabase/migrations/${f}`)]
  .filter((f) => /create or replace function public\.enregistrer_workspace/.test(lire(f)))
  .pop()
assert.ok(
  derniereDefinition,
  'aucune migration ne définit enregistrer_workspace : le seul chemin d’écriture a disparu',
)

const corpsRpc = (fichier) => {
  const source = lire(fichier)
  const debut = source.indexOf('create or replace function public.enregistrer_workspace')
  assert.ok(debut >= 0, `${fichier} : définition de enregistrer_workspace introuvable`)
  const fin = source.indexOf('$$;', debut)
  assert.ok(fin > debut, `${fichier} : corps de enregistrer_workspace non terminé`)
  return source.slice(debut, fin)
}

// La RPC fait foi en base, `schema.sql` amorce un projet neuf : les deux
// doivent dire la même chose, sinon un nouveau projet repart avec l'ancien
// comportement.
for (const fichier of [derniereDefinition, 'supabase/schema.sql']) {
  const corps = corpsRpc(fichier)
  assert.match(
    corps,
    /v_auteur\s*:=\s*coalesce\(auth\.uid\(\)::text/,
    `${fichier} : l’auteur doit venir d’auth.uid(), pas d’un paramètre — un client peut annoncer n’importe qui`,
  )
  assert.doesNotMatch(
    corps,
    /updated_by\s*=\s*[^,;\n]*p_updated_by/,
    `${fichier} : updated_by ne doit jamais être renseigné depuis p_updated_by`,
  )
  assert.match(
    corps,
    /updated_by\s*=\s*v_auteur/,
    `${fichier} : la mise à jour doit estampiller updated_by côté serveur`,
  )
  assert.match(
    corps,
    /updated_by,\s*updated_by_client[\s\S]*?v_auteur,\s*nullif\(p_updated_by/,
    `${fichier} : à l’insertion, l’auteur est v_auteur et l’onglet annoncé va dans updated_by_client`,
  )
  // Le contrôle du compte connecté reste la première ligne de défense.
  assert.match(
    corps,
    /raise exception 'Compte non autorisé\.'/,
    `${fichier} : le contrôle du compte connecté ne doit pas disparaître avec l’estampille`,
  )
}

// La signature ne bouge pas : le front appelle la RPC avec cinq paramètres
// nommés, et une signature modifiée en base ferait échouer chaque envoi.
const signature = /create or replace function public\.enregistrer_workspace\(([\s\S]*?)\)\s*returns/.exec(
  lire(derniereDefinition),
)
const parametresSql = [...signature[1].matchAll(/(p_[a-z_]+)\s+[a-z]/g)].map((m) => m[1])
const appel = /\.rpc\('enregistrer_workspace',\s*\{([\s\S]*?)\n\s*\}\)/.exec(sync)
assert.ok(appel, 'src/sync.ts : l’appel à enregistrer_workspace est introuvable')
const parametresFront = [...appel[1].matchAll(/^\s*(p_[a-z_]+):/gm)].map((m) => m[1])
assert.deepEqual(
  parametresFront.slice().sort(),
  parametresSql.slice().sort(),
  'la signature de la RPC et l’appel de src/sync.ts ont divergé : chaque synchronisation échouerait',
)

// MON_ID garde son autre usage — reconnaître ses propres échos — et le filtre
// doit rester valide de part et d’autre de la migration, quel que soit l’ordre
// entre le déploiement du front et son application.
assert.match(
  sync,
  /row\.updated_by_client === MON_ID \|\| row\.updated_by === MON_ID/,
  'src/sync.ts : l’anti-écho doit accepter les DEUX colonnes — sinon un poste réapplique ses propres écritures pendant la fenêtre de bascule',
)
assert.match(
  sync,
  /p_updated_by: MON_ID/,
  'src/sync.ts : l’onglet émetteur doit continuer d’être annoncé, c’est lui qui alimente le filtre anti-écho',
)

console.log(
  'test-identite : OK — identité à deux étages, session observable, adresse préservée, auteur estampillé côté serveur.',
)
