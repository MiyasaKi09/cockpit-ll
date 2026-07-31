// ============================================================
// Livrable 0.14 — critère 11 du §22 : « les propositions IA peuvent
// être acceptées, modifiées ou refusées ».
//
// PÉRIMÈTRE AU LOT 0 : la table `entrants`, seule table du dépôt qui
// porte aujourd'hui des champs proposés par une machine
// (`projet_id_propose`, `categorie_proposee`, `confiance`, `raisons`)
// et son versant navigateur (`src/entrants.ts`, la carte « boîte
// d'arrivée partagée » de `src/modules/Documents.tsx`). La table
// `communications` du §5 N'EXISTE PAS ENCORE : elle arrive au MVP
// (Lot 1), avec ses propres champs proposés, et c'est
// `test-categorisation-propositions.cjs` qui étendra ce verrou —
// pas ce fichier. Écrire ici des assertions sur une table absente
// donnerait un test qui passe en ne vérifiant rien.
//
// Ce test est statique : il lit les fichiers, il ne se connecte à
// aucune base. Il verrouille quatre choses.
//
// 1. UNE PROPOSITION N'EST PAS UNE DÉCISION. Ce que la machine
//    propose est rangé dans des colonnes `*_propos*` distinctes ;
//    l'objet métier, lui, n'est écrit qu'au geste humain. Le statut
//    d'une pièce insérée par le serveur est toujours `a_valider` :
//    aucune insertion machine ne naît validée, et rien ne le devient
//    par expiration d'un délai.
// 2. CHAQUE CHAMP PROPOSÉ A SON PENDANT HUMAIN — un champ de
//    formulaire, pré-rempli par la proposition et modifiable. C'est
//    la lettre du critère 11 : « acceptées, MODIFIÉES ou refusées ».
//    Une proposition qu'on ne peut qu'accepter en bloc ou jeter est
//    une décision déguisée.
// 3. CE QUI EST ENREGISTRÉ EST LE CHOIX HUMAIN, PAS LA PROPOSITION.
//    Le classement écrit `c.categorie` et le projet retenu, jamais
//    `e.categorieProposee` — sinon la modification humaine serait un
//    théâtre : l'écran offrirait un Select dont la valeur n'irait
//    nulle part.
// 4. LA PROPOSITION RESTE TRAÇABLE. `confiance` et `raisons`
//    accompagnent la pièce jusqu'au document classé, et l'écran les
//    montre. Le contrat des modules l'impose : « une réponse sans
//    source est un défaut, pas une approximation. »
//
// Le refus, lui, est déjà couvert : « Rejeter » écrit le statut
// `rejete` côté serveur, la pièce reste tracée et n'est plus
// proposée.
// ============================================================

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

const MIGRATIONS = fs
  .readdirSync(path.join(racine, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()

const schemaEntrants = lire('supabase/migrations/20260730085155_ingestion_veille_schema_reproductible.sql')
const ingestion = lire('supabase/functions/gmail-ingestion/index.ts')
const entrants = lire('src/entrants.ts')
const documents = lire('src/modules/Documents.tsx')

/** `assert.match` recracherait le module entier dans le rapport d'échec —
 *  quarante mille caractères pour une ligne manquante. On teste, on affiche
 *  la phrase. */
const contient = (source, motif, message) => assert.ok(motif.test(source), message)

// ------------------------------------------------------------------
// 1. Une proposition n'est pas une décision
// ------------------------------------------------------------------

const definition = /create table if not exists public\.entrants \(([\s\S]*?)\n\);/.exec(schemaEntrants)
assert.ok(definition, 'la table entrants doit être définie par la migration d’ingestion')

// Les colonnes de proposition, recensées depuis le schéma lui-même : une
// colonne proposée ajoutée demain entre automatiquement dans le périmètre.
const colonnesProposees = [...definition[1].matchAll(/^\s{2}([a-z_]*propos[a-z_]*)\s/gm)].map((m) => m[1])
assert.deepEqual(
  colonnesProposees.sort(),
  ['categorie_proposee', 'projet_id_propose'],
  'recensement inattendu des colonnes de proposition de public.entrants',
)

assert.match(
  definition[1],
  /statut\s+text not null default 'a_valider'/,
  'une pièce arrive « à valider » par défaut : le statut ne peut pas être oublié à l’insertion',
)
assert.match(
  definition[1],
  /raisons\s+jsonb not null default '\[\]'::jsonb/,
  'les raisons d’une proposition ne sont jamais nulles : une proposition sans motif est un défaut',
)

// Toute insertion serveur porte un statut explicite, et ce statut est en
// attente d'un humain — jamais un état d'aboutissement.
const STATUTS_MACHINE = new Set(['a_valider', 'ignore'])
const insertions = [...ingestion.matchAll(/\.from\('entrants'\)\s*\.insert\(\{([\s\S]*?)\n\s*\}\)/g)]
assert.ok(insertions.length >= 2, `recensement inattendu : ${insertions.length} insertion(s) dans entrants`)
for (const [, corps] of insertions) {
  const statut = /statut:\s*'([a-z_]+)'/.exec(corps)
  assert.ok(statut, `une insertion serveur dans entrants n’écrit pas de statut explicite :\n${corps.slice(0, 200)}`)
  assert.ok(
    STATUTS_MACHINE.has(statut[1]),
    `le serveur insère une pièce au statut « ${statut[1]} » : une machine ne produit pas un objet déjà validé`,
  )
  assert.match(
    corps,
    /raisons:/,
    `une insertion serveur dans entrants n’explique pas sa proposition :\n${corps.slice(0, 200)}`,
  )
}
const aValider = insertions.filter(([, corps]) => corps.includes("statut: 'a_valider'"))
assert.equal(aValider.length, 1, 'exactement une insertion propose une pièce à valider')

// Aucune promotion automatique : rien, côté serveur, ne fait passer une pièce
// de « proposée » à « traitée » sans qu'un humain l'ait demandé.
assert.ok(
  !/\.from\('entrants'\)\s*\.update\(/.test(ingestion),
  'gmail-ingestion ne doit jamais réécrire une pièce déjà déposée : il propose, il ne conclut pas',
)

// ------------------------------------------------------------------
// 2. Chaque champ proposé a son pendant humain
// ------------------------------------------------------------------

// La correspondance colonne SQL → champ du navigateur → champ de formulaire.
// Elle est écrite ici parce qu'elle est le cœur du critère : c'est elle qui
// dit qu'à toute proposition répond une commande.
const PENDANTS = [
  {
    colonne: 'projet_id_propose',
    champ: 'projetIdPropose',
    saisie: 'projetId',
    libelle: 'Projet',
  },
  {
    colonne: 'categorie_proposee',
    champ: 'categorieProposee',
    saisie: 'categorie',
    libelle: 'Catégorie',
  },
]
assert.equal(
  PENDANTS.length,
  colonnesProposees.length,
  'une colonne de proposition a été ajoutée sans pendant humain déclaré ici',
)

// Le bloc qui pré-remplit le formulaire depuis la proposition reçue. On
// l'extrait pour que l'échec pointe une dizaine de lignes, pas le module.
const preRemplissage = /setChoix\(\(prev\) => \{[\s\S]*?\n {6}\}\)/.exec(documents)
assert.ok(preRemplissage, 'la boîte d’arrivée doit pré-remplir un formulaire depuis les propositions')

for (const { colonne, champ, saisie, libelle } of PENDANTS) {
  assert.ok(
    entrants.includes(colonne),
    `src/entrants.ts doit lire ${colonne} : une proposition invisible ne peut pas être modifiée`,
  )
  assert.ok(
    new RegExp(`${champ}: (string|number) \\| null`).test(entrants),
    `EntrantDistant doit exposer ${champ} — et le laisser nul quand la machine n’a rien proposé`,
  )
  // le formulaire part de la proposition — avec un repli explicite quand elle
  // est absente, faute de quoi « accepter » ne serait plus un simple clic
  assert.ok(
    new RegExp(`e\\.${champ} \\|\\|`).test(preRemplissage[0]),
    `le champ « ${libelle} » doit être pré-rempli par ${champ} (accepter doit rester un clic)`,
  )
  assert.ok(
    new RegExp(`\\b${saisie}[,:]`).test(preRemplissage[0]),
    `la valeur pré-remplie doit alimenter le champ de saisie « ${saisie} »`,
  )
  // …et l'humain peut la remplacer
  assert.ok(
    documents.includes(`majChoix(e.id, { ${saisie}: v })`),
    `le champ « ${libelle} » doit être modifiable : c’est le « modifiées » du critère 11`,
  )
  assert.ok(
    documents.includes(`<Field label="${libelle}">`),
    `le champ « ${libelle} » doit être visible et étiqueté à l’écran`,
  )
}

// Rien ne se classe sans qu'un projet ait été explicitement retenu : le bouton
// reste désactivé, et la fonction s'arrête. La proposition ne « prend » pas
// par inaction.
contient(
  documents,
  /if \(!c \|\| !projet\) return/,
  'classer() doit refuser d’agir sans choix humain de projet',
)
contient(
  documents,
  /disabled=\{!projet \|\| occupe === e\.id\}/,
  'le bouton « Classer » reste désactivé tant qu’aucun projet n’est retenu',
)
contient(
  documents,
  /'Classer \(choisir un projet\)'/,
  'le bouton doit dire pourquoi il est désactivé, plutôt que de laisser deviner',
)

// ------------------------------------------------------------------
// 3. Ce qui est enregistré est le choix humain
// ------------------------------------------------------------------

const classer = /const classer = async \(e: EntrantDistant\) => \{[\s\S]*?\n  \}/.exec(documents)
assert.ok(classer, 'classer() doit exister dans src/modules/Documents.tsx')
for (const { champ } of PENDANTS) {
  assert.ok(
    !classer[0].includes(`e.${champ}`),
    `classer() enregistre e.${champ} : la proposition court-circuiterait le choix humain`,
  )
}
assert.match(classer[0], /categorie: c\.categorie/, 'la catégorie enregistrée est celle du formulaire')
assert.match(classer[0], /projetId: projet\.id/, 'le projet enregistré est celui que l’humain a retenu')

// Le navigateur n'écrit jamais dans une colonne de proposition. C'est la
// version « Lot 0 » du garde-fou : la trace de ce que la machine a proposé
// reste intacte quoi qu'il arrive à l'écran.
//
// [à relire] Le grant SQL reste au niveau de la TABLE
// (`grant select, update on table public.entrants to authenticated`), donc le
// rôle `authenticated` pourrait techniquement écrire ces colonnes. Le
// resserrer en grant de colonnes (`statut`, `traite_par`, `traite_le`)
// demande une nouvelle migration : c'est un livrable en soi, pas un effet de
// bord de ce test. Le verrou ci-dessous ferme le seul chemin qui existe
// réellement — aucun autre code du dépôt ne parle à cette table.
const CHAMPS_ECRIVABLES = new Set(['statut', 'traite_par', 'traite_le'])
const misesAJour = [...entrants.matchAll(/\.from\('entrants'\)\s*\.update\(\{([^}]*)\}\)/g)]
assert.equal(misesAJour.length, 1, 'src/entrants.ts ne doit avoir qu’un seul écrivain vers entrants')
for (const [, corps] of misesAJour) {
  // les clés de l'objet écrit : `statut` (abrégé), `traite_par: …`, `traite_le: …`
  const colonnesEcrites = corps
    .split(',')
    .map((segment) => segment.split(':')[0].trim())
    .filter((cle) => /^[a-z_]+$/.test(cle))
  assert.ok(colonnesEcrites.length > 0, 'la mise à jour de src/entrants.ts n’écrit aucune colonne lisible')
  for (const colonne of colonnesEcrites) {
    assert.ok(
      CHAMPS_ECRIVABLES.has(colonne),
      `le navigateur écrit « ${colonne} » dans entrants : seuls ${[...CHAMPS_ECRIVABLES].join(', ')} lui reviennent`,
    )
  }
}
assert.ok(
  !/\.from\('entrants'\)\s*\.(insert|upsert|delete)\(/.test(entrants),
  'le navigateur ne crée ni ne supprime de pièce : il valide ou il refuse',
)

// Et personne d'autre ne parle à cette table côté navigateur.
const parcourirSrc = (dossier, acc = []) => {
  for (const entree of fs.readdirSync(path.join(racine, dossier), { withFileTypes: true })) {
    const relatif = `${dossier}/${entree.name}`
    if (entree.isDirectory()) parcourirSrc(relatif, acc)
    else if (/\.tsx?$/.test(entree.name)) acc.push(relatif)
  }
  return acc
}
const ecrivains = parcourirSrc('src').filter((f) => /\.from\('entrants'\)/.test(lire(f)))
assert.deepEqual(
  ecrivains,
  ['src/entrants.ts'],
  'src/entrants.ts est le seul accès à la boîte partagée ; un module qui la requête en direct échapperait à ce test',
)

// Aucune migration n'accorde à `authenticated` l'écriture d'une colonne de
// proposition : le jour où un grant de colonnes sera écrit, il ne devra pas
// les inclure.
for (const fichier of MIGRATIONS) {
  const sql = lire(`supabase/migrations/${fichier}`)
  for (const m of sql.matchAll(/grant\s+[a-z, ]*update\s*\(([^)]*)\)[\s\S]{0,120}?to\s+([a-z_, ]+)/gi)) {
    if (!/authenticated/.test(m[2])) continue
    for (const colonne of m[1].split(',').map((c) => c.trim())) {
      assert.ok(
        !/propos/.test(colonne),
        `${fichier} : grant update (${colonne}) à authenticated — une proposition ne se réécrit pas depuis le navigateur`,
      )
    }
  }
}

// ------------------------------------------------------------------
// 4. La proposition reste traçable
// ------------------------------------------------------------------

for (const champ of ['confiance', 'raisons']) {
  assert.match(
    definition[1],
    new RegExp(`^\\s{2}${champ}\\s`, 'm'),
    `public.entrants doit porter ${champ} : une proposition se justifie`,
  )
  assert.match(
    classer[0],
    new RegExp(`${champ}: e\\.${champ}`),
    `le document classé conserve ${champ} : la trace survit à la validation`,
  )
}
contient(
  documents,
  /Voir pourquoi cette proposition/,
  'les raisons doivent être consultables à l’écran, pas seulement stockées',
)
contient(
  documents,
  /<BadgeConfiance confiance=\{e\.confiance\}/,
  'la confiance de la proposition doit être affichée avant la décision',
)

// Le rejet est tracé, pas destructif.
contient(
  documents,
  /marquerEntrant\(e\.id, 'rejete', signataire\)/,
  'refuser une proposition doit être un geste enregistré, avec son auteur',
)
contient(
  documents,
  /La pièce reste tracée côté serveur mais ne sera plus proposée/,
  'le refus doit annoncer qu’il conserve la trace',
)

// L'écran ne montre que ce qui attend un humain.
contient(
  entrants,
  /\.eq\('statut', 'a_valider'\)/,
  'la boîte d’arrivée ne liste que les pièces en attente de décision',
)

console.log(
  `Propositions modifiables : ${colonnesProposees.length} colonnes proposées, ` +
    `${PENDANTS.length} pendants humains, ${insertions.length} insertions serveur toutes en attente de validation, ` +
    'trace (confiance + raisons) conservée jusqu’au document classé.',
)
