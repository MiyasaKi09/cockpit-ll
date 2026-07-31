// ============================================================
// Critère 11 du §22 : « les propositions IA peuvent être acceptées,
// modifiées ou refusées ».
//
// PÉRIMÈTRE — DEUX TABLES, ET LA SECONDE EST LA PLUS IMPORTANTE
// -------------------------------------------------------------
//   * PARTIE I (livrable 0.14) : `entrants`, l'index des PIÈCES, qui
//     porte des champs proposés par une machine (`projet_id_propose`,
//     `categorie_proposee`, `confiance`, `raisons`) et son versant
//     navigateur (`src/entrants.ts`, la carte « boîte d'arrivée
//     partagée » de `src/modules/Documents.tsx`) ;
//   * PARTIE II (livrable A.9) : `propositions`, la table à quatre
//     genres — tâches, échéances, décisions et risques détectés dans un
//     message (§12.3 pts 5-8). Elle N'EXISTAIT PAS au Lot 0, et le
//     périmètre d'alors le disait.
//
// Pourquoi ici et pas dans un troisième fichier : parce que le critère
// 11 est UNE exigence, et que la partie II en est la forme forte. Sur
// `entrants`, « une proposition n'est pas une décision » est tenu par
// des conventions vérifiables (colonnes séparées, statut d'attente,
// formulaire modifiable). Sur `propositions`, c'est tenu par le TYPE :
// le domaine de `statut` ne contient aucun statut métier, « acceptée »
// équivaut par contrainte à « désigne un objet créé », et rien ne quitte
// l'état proposé sans signature — donc pas par expiration. Séparer les
// deux moitiés d'un même critère dans deux fichiers aurait fait relire
// deux fois la même doctrine, et diverger une fois.
//
// Les trois axes du §5.2 de `communications` (proposé / humain /
// effectif) sont, eux, vérifiés par `test-communications.cjs` et
// `test-hors-ligne.cjs`, qui EXÉCUTENT le schéma et la couche d'accès.
//
// Ce test est statique pour la partie I ; la partie II transpile
// `src/propositions.ts` pour comparer ses listes fermées aux domaines
// SQL. Il ne se connecte à aucune base.
//
// La PARTIE I verrouille quatre choses.
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
const ts = require('typescript')

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

// ==================================================================
// PARTIE II — `public.propositions` (livrable A.9), la forme forte
//
// Cinq verrous, et aucun ne produirait d'erreur visible s'il cédait.
//
// 1. LE STATUT NE CONTIENT AUCUN STATUT MÉTIER. C'est LE verrou du
//    §15 : par construction du type, une proposition ne peut pas
//    devenir la décision ou la tâche qu'elle propose. Un « confirmee »
//    ajouté au domaine — ou glissé dans la charge utile — ferait de la
//    table des détections la mémoire des décisions de l'agence, sans
//    qu'aucune requête n'échoue.
// 2. « ACCEPTÉE » ÉQUIVAUT À « DÉSIGNE UN OBJET CRÉÉ », et rien ne
//    quitte l'état proposé sans SIGNATURE. C'est ce qui rend
//    l'expiration structurellement impossible : un délai qui
//    accepterait par défaut devrait inventer un nom de personne.
// 3. LES DESTINATIONS SONT FERMÉES À `tache` ET `contact` (§3.14,
//    décision 4). Ni Obligation — gravité 3 dans `src/alerts.ts` — ni
//    EcheanceFacturation, qui commande l'émission d'une facture : ce
//    sont les échéances juridiques et financières que le §15 protège.
// 4. LES QUATRE LISTES FERMÉES SONT IDENTIQUES EN BASE ET DANS
//    `src/propositions.ts`. Même risque qu'au livrable A.2 : une valeur
//    ajoutée d'un seul côté ne se voit qu'au premier INSERT refusé, en
//    production, sur une détection qu'on ne reverra pas.
// 5. L'EXTRAIT CITÉ EST OBLIGATOIRE, et le navigateur ne peut réécrire
//    ni lui, ni la confiance, ni les raisons : une proposition sans
//    source est invérifiable, une proposition réécrite n'est plus une
//    trace.
// ==================================================================

const CHEMIN_MIGRATION_A9 = 'supabase/migrations/20260731190000_propositions_quatre_genres.sql'
const migrationA9 = lire(CHEMIN_MIGRATION_A9)
const sourcePropositions = lire('src/propositions.ts')

/** charge un module TypeScript en remplaçant ses imports par des doublures */
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

const propositions = charger('src/propositions.ts', {
  react: {
    useCallback: (f) => f,
    useEffect: () => undefined,
    useMemo: (f) => f(),
    useRef: () => ({ current: true }),
    useState: (v) => [v, () => undefined],
  },
  './horsLigne': {
    ecrireCache: async () => undefined,
    enfiler: async () => null,
    enregistrerExecuteur: () => undefined,
    exigerSignataire: (par) => {
      const nom = (par || '').trim()
      if (!nom) throw new Error('qui est connecté')
      return nom
    },
    lireCache: async () => null,
    patcherCache: async () => undefined,
  },
  './sync': { abonnerSession: () => () => undefined, clientSupabase: () => null },
  './util': charger('src/util.ts'),
})

// ------------------------------------------------------------------
// II.0 La migration s'applique après celles dont elle dépend
// ------------------------------------------------------------------

const nomA9 = path.basename(CHEMIN_MIGRATION_A9)
assert.ok(MIGRATIONS.includes(nomA9), 'la migration de `propositions` doit être présente')
for (const anterieure of [
  '20260730180000_registre_des_membres.sql',
  '20260731150000_communications_index_des_messages.sql',
]) {
  assert.ok(
    nomA9 > anterieure,
    `elle doit s’appliquer après ${anterieure} : elle en appelle les fonctions d’autorisation et en référence la clé primaire`,
  )
}

// ------------------------------------------------------------------
// II.1 Les quatre listes fermées : base et module, valeur par valeur
// ------------------------------------------------------------------

const debutA9 = migrationA9.indexOf('-- [PROPOSITIONS-A9:DEBUT]')
const finA9 = migrationA9.indexOf('-- [PROPOSITIONS-A9:FIN]')
assert.ok(debutA9 >= 0 && finA9 > debutA9, 'le bloc des quatre listes doit être délimité par ses repères')
const blocA9 = migrationA9.slice(debutA9, finA9)

/** valeurs littérales d'un `create domain … check (value in (…))` */
function valeursDuDomaine(nom) {
  const motif = new RegExp(
    `create domain public\\.${nom} as text\\s*\\n\\s*check \\(value in \\(([\\s\\S]*?)\\)\\);`,
  )
  const trouve = motif.exec(blocA9)
  assert.ok(trouve, `${CHEMIN_MIGRATION_A9} : le domaine public.${nom} est introuvable dans le bloc`)
  return trouve[1]
    .split(',')
    .map((v) => v.replace(/--[^\n]*/g, '').trim())
    .filter(Boolean)
    .map((v) => {
      assert.match(v, /^'[^']*'$/, `public.${nom} : « ${v} » n’est pas une valeur littérale`)
      return v.slice(1, -1)
    })
}

const LISTES = [
  ['genre_proposition', propositions.GENRES_PROPOSITION, 'GENRES_PROPOSITION', 4],
  ['statut_proposition', propositions.STATUTS_PROPOSITION, 'STATUTS_PROPOSITION', 3],
  ['objet_propose', propositions.OBJETS_PROPOSABLES, 'OBJETS_PROPOSABLES', 2],
  ['nature_risque', propositions.NATURES_RISQUE, 'NATURES_RISQUE', 4],
]
for (const [domaine, listeModule, nomListe, cardinal] of LISTES) {
  const enBase = valeursDuDomaine(domaine)
  assert.equal(enBase.length, cardinal, `public.${domaine} doit compter ${cardinal} valeurs, lu ${enBase.length}`)
  assert.ok(Array.isArray(listeModule), `src/propositions.ts doit exporter ${nomListe}`)
  assert.deepEqual(
    [...enBase].sort(),
    [...listeModule].sort(),
    `public.${domaine} et src/propositions.ts::${nomListe} ont divergé. ` +
      'Une valeur présente d’un seul côté ne se voit qu’au premier INSERT refusé, en production.',
  )
  // chaque valeur a son libellé français : une file de revue qui affiche
  // « responsabilite_non_attribuee » n'est pas une file de revue
  const libelles = {
    genre_proposition: propositions.LIBELLES_GENRE,
    statut_proposition: propositions.LIBELLES_STATUT,
    objet_propose: propositions.LIBELLES_OBJET_PROPOSE,
    nature_risque: propositions.LIBELLES_NATURE_RISQUE,
  }[domaine]
  for (const valeur of enBase) {
    assert.ok(libelles && libelles[valeur], `${nomListe} : « ${valeur} » n’a pas de libellé français`)
  }
}

// ------------------------------------------------------------------
// II.2 Le statut ne contient AUCUN statut métier
// ------------------------------------------------------------------

const statuts = valeursDuDomaine('statut_proposition')
assert.deepEqual(
  [...statuts].sort(),
  ['acceptee', 'ignoree', 'proposee'],
  'le domaine de statut a changé : c’est le verrou du §15, une proposition ne devient jamais l’objet qu’elle propose',
)
// les cinq statuts de décision du §6.2 appartiennent à l'entité `decisions`
// (livrable 2.1). Leur entrée ici, même partielle, ferait de cette table la
// mémoire des décisions de l'agence.
for (const interdit of ['confirmee', 'a_verifier', 'contestee', 'annulee', 'validee', 'expiree', 'terminee']) {
  assert.ok(
    !statuts.includes(interdit),
    `public.statut_proposition contient « ${interdit} » : ce statut est métier, il appartient à l’entité decisions (2.1)`,
  )
}
// …et la migration se refuse elle-même à l'appliquer si le domaine dérive : le
// test protège le dépôt, ce contrôle-là protège la base d'une migration future
assert.match(
  migrationA9,
  /pg_get_constraintdef[\s\S]{0,600}statut_proposition[\s\S]{0,900}raise exception/,
  'le contrôle final doit relire le domaine du statut : il se perdrait par une simple recompilation dans une migration ultérieure',
)

// Aucun statut métier caché dans le jsonb : fermer le domaine et laisser
// `charge_utile->>'statut'` libre déplacerait le problème d'une colonne à une clé.
assert.match(
  migrationA9,
  /constraint propositions_sans_statut_metier_chk\s*\n\s*check \(not jsonb_exists\(charge_utile, 'statut'\)\)/,
  'la charge utile ne doit pas pouvoir porter de clé « statut » : la garantie du domaine serait décorative',
)

// ------------------------------------------------------------------
// II.3 Acceptée ⟺ un objet est désigné ; rien ne sort sans signature
// ------------------------------------------------------------------

const definitionA9 = /create table if not exists public\.propositions \(([\s\S]*?)\n\);/.exec(migrationA9)
assert.ok(definitionA9, 'la table propositions doit être créée par cette migration')
const colonnesA9 = definitionA9[1]

for (const colonne of [
  'communication_id',
  'genre',
  'charge_utile',
  'extrait',
  'confiance',
  'raisons',
  'origine',
  'statut',
  'objet_cree_type',
  'objet_cree_id',
  'traite_par',
  'traite_le',
  'empreinte',
]) {
  assert.match(
    colonnesA9,
    new RegExp(`^\\s{2}${colonne}\\s`, 'm'),
    `public.propositions doit porter ${colonne}`,
  )
}

const equivalence = /constraint propositions_objet_cree_chk\s*\n\s*check \(([\s\S]*?)\n\s*\);/.exec(migrationA9)
assert.ok(equivalence, 'la contrainte propositions_objet_cree_chk est introuvable')
assert.match(
  equivalence[1],
  /\(statut = 'acceptee'\) = \(objet_cree_type is not null\)/,
  'accepter, c’est DÉSIGNER l’objet créé : l’équivalence doit être écrite comme telle, sinon une proposition « acceptée » sans rien derrière serait tenue pour faite',
)

const signature = /constraint propositions_signature_chk\s*\n\s*check \(([\s\S]*?)\n\s*\);/.exec(migrationA9)
assert.ok(signature, 'la contrainte propositions_signature_chk est introuvable')
assert.match(
  signature[1],
  /when 'proposee' then traite_par is null and traite_le is null/,
  'une proposition non tranchée ne porte pas de signature',
)
assert.match(
  signature[1],
  /else traite_par is not null and btrim\(traite_par\) <> '' and traite_le is not null/,
  'rien ne quitte l’état proposé sans signataire non vide et daté : c’est ce qui rend l’expiration impossible plutôt qu’interdite',
)

// Aucune promotion automatique nulle part : ni tâche planifiée, ni mise à jour
// en masse du statut. « Ne devient pas l'objet par expiration » (§15) doit être
// vrai du dépôt entier, pas seulement de la contrainte.
assert.ok(
  !/cron\.schedule/.test(migrationA9),
  'aucune tâche planifiée ne touche les propositions : rien ne doit les trancher à la place de quelqu’un',
)
assert.ok(
  !/update public\.propositions\s+set/i.test(migrationA9),
  'la migration ne doit réécrire aucun statut : une proposition se tranche à la main',
)

// ------------------------------------------------------------------
// II.4 Les destinations sont fermées (§3.14, décision 4)
// ------------------------------------------------------------------

const destinations = valeursDuDomaine('objet_propose')
assert.deepEqual(
  [...destinations].sort(),
  ['contact', 'tache'],
  'les deux seules destinations d’une proposition acceptée sont la tâche et le contact',
)
for (const interdite of ['obligation', 'echeance_facturation', 'facture', 'contrat', 'situation']) {
  assert.ok(
    !destinations.includes(interdite),
    `« ${interdite} » est une échéance juridique ou financière : le §15 interdit d’en créer sans confirmation, et le chemin ne doit pas exister`,
  )
}

// La charge utile est TYPÉE PAR GENRE, et les valeurs fermées passent par le
// domaine plutôt que par une seconde liste littérale.
const chargeUtile = /constraint propositions_charge_utile_chk\s*\n\s*check \(([\s\S]*?)\n\s*\);/.exec(migrationA9)
assert.ok(chargeUtile, 'la contrainte propositions_charge_utile_chk est introuvable')
for (const genre of propositions.GENRES_PROPOSITION) {
  assert.ok(
    new RegExp(`when '${genre}' then`).test(chargeUtile[1]),
    `la charge utile du genre « ${genre} » n’est pas contrainte : jsonb rendrait tout INSERT valide et le genre ne serait qu’une étiquette`,
  )
}
assert.match(
  chargeUtile[1],
  /else false/,
  'un genre inconnu doit être refusé, pas accepté par défaut',
)
assert.match(
  chargeUtile[1],
  /\(charge_utile ->> 'cible'\)::public\.objet_propose is not null/,
  'la cible d’une échéance proposée doit passer par le domaine des destinations : une seconde liste littérale divergerait au premier ajout',
)
assert.match(
  chargeUtile[1],
  /\(charge_utile ->> 'nature'\)::public\.nature_risque is not null/,
  'la nature d’un risque doit passer par le domaine des quatre natures que computeAlertes() ne voit pas',
)

// ------------------------------------------------------------------
// II.5 L'extrait cité, obligatoire — et la trace, non réécrivable
// ------------------------------------------------------------------

assert.match(
  colonnesA9,
  /^\s{2}extrait\s+text not null,/m,
  'l’extrait cité est obligatoire (§13.3, §4.2) : une proposition sans phrase est invérifiable',
)
assert.match(
  migrationA9,
  /constraint propositions_extrait_chk\s*\n\s*check \(length\(btrim\(extrait\)\) between 1 and 2000\)/,
  'un extrait vide ou d’espaces vaudrait un extrait absent, et un extrait sans borne ferait de Cockpit une copie de Gmail',
)
assert.match(
  migrationA9,
  /is_nullable = 'YES'[\s\S]{0,400}raise exception/,
  'le contrôle final doit refuser une proposition sans source ni extrait',
)

const grantA9 = /grant update \(([\s\S]*?)\)\s*\n\s*on table public\.propositions\s*\n\s*to authenticated;/.exec(
  migrationA9,
)
assert.ok(grantA9, 'le GRANT au niveau colonne est introuvable')
const traitables = grantA9[1]
  .split(',')
  .map((c) => c.replace(/--[^\n]*/g, '').trim())
  .filter(Boolean)
assert.deepEqual(
  [...traitables].sort(),
  ['objet_cree_id', 'objet_cree_type', 'statut', 'traite_le', 'traite_par'],
  'le GRANT de colonnes a changé : il doit rester limité aux colonnes de TRAITEMENT (plan A.9)',
)
for (const colonne of ['genre', 'charge_utile', 'extrait', 'confiance', 'raisons', 'origine', 'empreinte', 'communication_id']) {
  assert.ok(
    !traitables.includes(colonne),
    `grant update (${colonne}) à authenticated : ce qu’une machine a détecté ne se réécrit pas depuis l’écran`,
  )
}
assert.ok(
  !/grant\s+[a-z, ]*\b(insert|delete)\b[^;]*on table public\.propositions to authenticated/.test(migrationA9),
  'le navigateur ne fabrique ni ne supprime de proposition : une détection naît d’un message, jamais d’un écran',
)
assert.doesNotMatch(
  migrationA9,
  /grant\s+(select\s*,\s*)?update\s+on table public\.propositions to authenticated/,
  'un GRANT au niveau TABLE annulerait le GRANT au niveau colonne',
)
assert.match(
  migrationA9,
  /grant select, insert, update, delete on table public\.propositions to service_role/,
  'l’insertion des détections revient au serveur (A.10)',
)

// Le second verrou, qui survit à un GRANT élargi par inadvertance.
const refusA9 = /create or replace function public\.propositions_refus_reecriture\(\)[\s\S]*?\$\$;/.exec(migrationA9)
assert.ok(refusA9, 'le trigger de refus de réécriture doit être défini')
assert.match(
  refusA9[0],
  /security invoker/,
  'le refus doit être `security invoker` : en `security definer`, `current_user` serait le propriétaire de la fonction et le contrôle ne contrôlerait plus rien',
)
assert.match(refusA9[0], /current_user in \('service_role'/, 'seul le serveur écrit une détection')
for (const colonne of ['genre', 'charge_utile', 'extrait', 'confiance', 'raisons', 'origine', 'empreinte']) {
  assert.ok(
    new RegExp(`new\\.${colonne}\\s+is distinct from old\\.${colonne}`).test(refusA9[0]),
    `le trigger de refus doit couvrir ${colonne} : une trace réécrivable n’est plus une trace`,
  )
}

// ------------------------------------------------------------------
// II.6 L'accès passe par le registre, et l'idempotence de la détection
// ------------------------------------------------------------------

assert.match(
  migrationA9,
  /alter table public\.propositions enable row level security/,
  'la table doit être protégée par RLS',
)
const politiquesA9 = migrationA9.split(/create policy/).slice(1)
assert.ok(politiquesA9.length >= 2, 'lecture et traitement doivent être deux politiques distinctes')
for (const bloc of politiquesA9) {
  const corps = bloc.slice(0, bloc.indexOf(';'))
  assert.match(
    corps,
    /public\.est_membre_actif\(\)/,
    `une politique n’interroge pas le registre des membres :\n${corps.slice(0, 200)}`,
  )
  assert.doesNotMatch(corps, /@/, `une politique compare à une adresse littérale :\n${corps.slice(0, 200)}`)
}
assert.match(
  migrationA9,
  /for update[\s\S]{0,240}role_courant\(\)\) is distinct from 'lecture_seule'/,
  'un membre en lecture seule lit les propositions et ne les tranche pas',
)

assert.match(
  migrationA9,
  /create unique index if not exists propositions_detection_unq\s*\n\s*on public\.propositions \(communication_id, genre, empreinte\)\s*\n\s*where empreinte is not null/,
  'l’index unique PARTIEL du patron entrants_source_unq manque : rejouer un détecteur proposerait deux fois la même chose, et la file de revue du §8.7 serait inutilisable en une semaine',
)

// ------------------------------------------------------------------
// II.7 La couche d'accès : une seule porte, aucune trace réécrite
// ------------------------------------------------------------------

const accedantsA9 = parcourirSrc('src').filter((f) =>
  /\.from\(\s*(['"]propositions['"]|MAGASIN_PROPOSITIONS)\s*\)/.test(lire(f)),
)
assert.deepEqual(
  accedantsA9,
  ['src/propositions.ts'],
  'src/propositions.ts est le seul accès à la table : un module qui la requête en direct échapperait au cache, à la file et à ce test',
)
assert.ok(
  !/\.from\(\s*MAGASIN_PROPOSITIONS\s*\)\s*\.(insert|upsert|delete)\(/.test(sourcePropositions),
  'le navigateur n’insère ni ne supprime de proposition : il accepte, il ignore, ou il rouvre',
)
assert.ok(
  !/\.select\(\s*['"`]\*/.test(sourcePropositions),
  'pas de `select(\'*\')` : toute colonne ajoutée demain entrerait sans bruit',
)

// Toute colonne écrite par le navigateur est une colonne que la base accorde.
// Relevée à l'exécution des trois gestes, pas lue dans le source : c'est ce qui
// attrape une clé ajoutée dans un objet littéral.
const enfileesA9 = []
const propositionsExec = charger('src/propositions.ts', {
  react: { useCallback: (f) => f, useEffect: () => undefined, useMemo: (f) => f(), useRef: () => ({ current: true }), useState: (v) => [v, () => undefined] },
  './horsLigne': {
    ecrireCache: async () => undefined,
    enfiler: async (magasin, cle, valeurs) => {
      enfileesA9.push({ magasin, cle, valeurs })
      return { id: 'op' }
    },
    enregistrerExecuteur: () => undefined,
    exigerSignataire: (par) => {
      const nom = (par || '').trim()
      if (!nom) throw new Error('l’application ne sait pas qui est connecté')
      return nom
    },
    lireCache: async () => null,
    patcherCache: async () => undefined,
  },
  './sync': { abonnerSession: () => () => undefined, clientSupabase: () => null },
  './util': charger('src/util.ts'),
})

const propositionFactice = {
  id: 'pr1',
  genre: 'tache',
  extrait: 'Merci de nous retourner le plan de façade avant vendredi.',
  confiance: 0.62,
  raisons: ['Marqueur d’action « merci de » reconnu'],
  origine: 'lexique',
  statut: 'proposee',
  objetCreeType: null,
  objetCreeId: null,
  traitePar: null,
  traiteLe: null,
  creeLe: '2026-07-31T09:00:00.000Z',
  chargeUtile: { titre: 'Mettre à jour le plan de façade' },
  message: { communicationId: 'm1', gmailMessageId: '18f3ab9c1d2e3f40', urlGmail: null, objet: '', envoyeLe: null, projetId: 'P03' },
}

async function partieII() {
  // aucune signature vide — la règle est celle de src/horsLigne.ts, partagée
  // avec src/communications.ts : deux copies auraient divergé
  await assert.rejects(
    () => propositionsExec.ignorer(propositionFactice, '  '),
    /qui est connecté/,
    'trancher une proposition sans savoir qui est là n’est pas traçable, et la contrainte de signature refuserait l’écriture',
  )
  // accepter sans objet créé : refusé AVANT la base, avec la bonne raison
  await assert.rejects(
    () => propositionsExec.accepter(propositionFactice, { type: 'tache', id: '   ' }, 'Julien'),
    /sans lui, la proposition serait tenue pour faite/,
    'accepter, c’est désigner l’objet créé : sans lui, la proposition serait « faite » sans rien derrière',
  )

  await propositionsExec.accepter(propositionFactice, { type: 'tache', id: 'T-42' }, 'Julien')
  await propositionsExec.ignorer(propositionFactice, 'Zoé')
  await propositionsExec.rouvrir(propositionFactice, 'Zoé')

  assert.equal(enfileesA9.length, 3, 'les trois gestes doivent passer par la file')
  const colonnesEcrites = new Set()
  for (const e of enfileesA9) {
    assert.equal(e.magasin, 'propositions', 'toutes les écritures passent par le même magasin')
    assert.equal(e.cle, 'pr1', 'et visent la clé primaire — d’où l’idempotence de l’`update`')
    for (const colonne of Object.keys(e.valeurs)) colonnesEcrites.add(colonne)
  }
  for (const colonne of colonnesEcrites) {
    assert.ok(
      traitables.includes(colonne),
      `src/propositions.ts écrit « ${colonne} », que le GRANT au niveau colonne n’accorde pas : ` +
        'chaque décision serait refusée en production, une par une, sans autre trace que les journaux Supabase',
    )
  }
  assert.deepEqual(
    enfileesA9[0].valeurs,
    {
      statut: 'acceptee',
      objet_cree_type: 'tache',
      objet_cree_id: 'T-42',
      traite_par: 'Julien',
      traite_le: enfileesA9[0].valeurs.traite_le,
    },
    'accepter écrit le statut, l’objet DÉSIGNÉ et la signature — et rien de ce que la machine a détecté',
  )
  assert.equal(
    enfileesA9[2].valeurs.traite_par,
    null,
    'rouvrir efface la signature avec le statut : la contrainte du schéma lie les deux',
  )

  // Le pendant humain du critère 11 : la charge utile est LISIBLE et typée,
  // pour que l'écran de revue (B.10) en pré-remplisse un formulaire modifiable.
  // Une proposition qu'on ne pourrait qu'accepter en bloc ou jeter serait une
  // décision déguisée.
  const lue = propositions.depuisLigne({
    id: 'pr1',
    communication_id: 'm1',
    genre: 'echeance',
    charge_utile: { cible: 'tache', date: '2026-08-04', libelle: 'Retour du plan de façade' },
    extrait: 'Nous attendons votre retour pour le 4 août.',
    confiance: 0.7,
    raisons: ['Date française résolue depuis la date d’envoi'],
    origine: 'modele',
    statut: 'proposee',
    objet_cree_type: null,
    objet_cree_id: null,
    traite_par: null,
    traite_le: null,
    cree_le: '2026-07-31T09:00:00.000Z',
    communications: { projet_id: 'P03', gmail_message_id: '18f3ab9c1d2e3f40', objet: 'Façade sud', envoye_le: '2026-07-30T08:00:00.000Z' },
  })
  assert.ok(lue, 'une échéance proposée complète doit être lisible')
  assert.equal(lue.chargeUtile.cible, 'tache', 'la cible est exposée : c’est elle que §3.14 décision 4 ferme')
  assert.equal(lue.chargeUtile.date, '2026-08-04', 'la date détectée est exposée, donc modifiable à l’écran')
  assert.equal(
    lue.message.projetId,
    'P03',
    'le projet est lu PAR JOINTURE sur communications : recopié ici, il serait figé au jour de la détection',
  )
  assert.equal(
    lue.message.urlGmail,
    'https://mail.google.com/mail/u/0/#all/18f3ab9c1d2e3f40',
    'la source reste atteignable — le lien passe par gmailMessageUrl(), seul constructeur du dépôt (critère 10)',
  )

  // une détection incomplète n'est pas affichée à moitié : elle serait tranchée
  // sur un contenu absent
  assert.equal(
    propositions.depuisLigne({
      id: 'pr2',
      communication_id: 'm1',
      genre: 'risque',
      charge_utile: { nature: 'retard_potentiel' },
      extrait: 'Le chantier prend du retard.',
      confiance: 0.5,
      raisons: [],
      origine: 'modele',
      statut: 'proposee',
      objet_cree_type: null,
      objet_cree_id: null,
      traite_par: null,
      traite_le: null,
      cree_le: '2026-07-31T09:00:00.000Z',
      communications: { projet_id: null, gmail_message_id: '18f3ab9c1d2e3f41', objet: '', envoye_le: null },
    }),
    null,
    'une nature de risque hors des quatre du §3.14 doit être refusée : « retard potentiel » est déjà produit par computeAlertes(), et le redétecter doublerait le risque dans la fiche projet',
  )

  // le filtre a ses DEUX traductions — sans quoi, hors ligne, la même question
  // rendrait d'autres lignes
  const declarationFiltre = /export interface FiltrePropositions \{([\s\S]*?)\n\}/.exec(sourcePropositions)
  assert.ok(declarationFiltre, 'FiltrePropositions doit rester une interface nommée')
  const champsFiltre = [...declarationFiltre[1].matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1])
  const tableCriteres = /const CRITERES[\s\S]*?\n\}\n/.exec(sourcePropositions)
  assert.ok(tableCriteres, 'la table CRITERES doit exister : c’est elle qui tient les deux traductions côte à côte')
  for (const champ of champsFiltre) {
    const bloc = new RegExp(`\\n {2}${champ}: \\{([\\s\\S]*?)\\n {2}\\},`).exec(tableCriteres[0])
    assert.ok(bloc, `le filtre « ${champ} » n’a pas de critère déclaré`)
    assert.match(bloc[1], /contraintes:/, `le critère « ${champ} » n’a pas de traduction SQL`)
    assert.match(bloc[1], /correspond:/, `le critère « ${champ} » n’a pas de traduction cache`)
  }

  console.log(
    `Propositions modifiables — entrants : ${colonnesProposees.length} colonnes proposées, ` +
      `${PENDANTS.length} pendants humains, ${insertions.length} insertions serveur toutes en attente de validation. ` +
      `propositions (A.9) : ${LISTES.length} listes fermées identiques en base et dans src/propositions.ts ` +
      `(${propositions.GENRES_PROPOSITION.length} genres, ${statuts.length} statuts dont aucun métier, ` +
      `${destinations.length} destinations sans échéance juridique, ${propositions.NATURES_RISQUE.length} natures de risque), ` +
      `acceptée ⟺ objet désigné, rien ne sort de « proposée » sans signature, ` +
      `${colonnesEcrites.size} colonnes écrites toutes accordées par le GRANT.`,
  )
}

partieII().catch((e) => {
  console.error(e)
  process.exit(1)
})
