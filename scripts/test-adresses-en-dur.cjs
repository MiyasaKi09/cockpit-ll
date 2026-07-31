// ============================================================
// Livrable 0.14 — verrou de la bascule d'identité (livrable 3.2).
//
// Le plan pose une dépendance dure : « 3.2 ne peut pas démarrer tant
// que le test scripts/test-adresses-en-dur.cjs n'est pas vert en
// CI. » Ce fichier est ce test, et son périmètre est celui que le
// plan spécifie juste après le tableau du Lot 0.
//
// « Aucune adresse littérale dans le dépôt » est inapplicable tel
// quel : les données d'exemple en contiennent, les placeholders de
// formulaire aussi, et un test qui les interdirait serait désarmé
// dans la semaine. Ce qui est interdit ici est précis :
//
//   LES DEUX ADRESSES DE CONNEXION RÉELLES, hors du registre
//   d'identités livré par 0.2 (`public.membres`).
//
// Ce qui est explicitement autorisé : les adresses de démonstration
// en `.example` et l'adresse générique de l'agence — ce ne sont pas
// des identités de connexion, et les interdire ne protégerait rien.
//
// Rapport avec `scripts/test-registre-membres.cjs` (livrable 0.2) :
// celui-là vérifie que le registre est la seule autorité de contrôle
// d'accès, et il balaie déjà `src`, `api`, `scripts`,
// `supabase/functions`, `schema.sql` et le worker. Celui-ci prend le
// dépôt ENTIER — documentation, workflows CI, migrations,
// opérations, configuration — et fige l'inventaire des occurrences
// restantes. Le complément est annoncé dans l'en-tête de 0.2 ; il
// n'est pas une redite, c'est l'élargissement du périmètre.
//
// Il verrouille cinq choses.
//
// 1. AUCUNE ADRESSE DE CONNEXION HORS DE L'INVENTAIRE FIGÉ. Toute
//    occurrence dans un fichier non listé fait échouer le test. La
//    liste ne peut se réduire sans rien casser (retirer une adresse
//    est un progrès) mais elle ne peut pas s'étendre en silence.
// 2. LES MIGRATIONS POSTÉRIEURES AU REGISTRE N'EN ÉCRIVENT AUCUNE.
//    C'est le verrou tourné vers l'avenir : 3.2 écrira des
//    migrations, et c'est exactement là que la tentation de recopier
//    deux adresses réapparaîtra.
// 3. UN PROJET NEUF NAÎT SANS ADRESSE. `supabase/schema.sql` amorce
//    depuis les comptes existants, il n'en nomme aucun.
// 4. LES ADRESSES DE DÉMONSTRATION SONT RECONNAISSABLES COMME
//    TELLES. Dans `src/`, tout littéral d'adresse est en `.example`,
//    sur le domaine de l'agence, ou dans une courte liste justifiée.
//    C'est la règle qui empêche qu'une identité réelle rentre par la
//    porte des jeux d'essai.
// 5. RIEN, CÔTÉ SERVEUR, NE DÉPEND DU DOMAINE DE L'AGENCE. Il n'est
//    pas acheté (§23) et la bascule 3.2 le mettra en service : une
//    Edge Function ou une fonction Vercel qui le présumerait
//    casserait le jour où il changerait, ou ne changerait pas.
// ============================================================

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

const ADRESSE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const MIGRATION_REGISTRE = 'supabase/migrations/20260730180000_registre_des_membres.sql'

// ------------------------------------------------------------------
// 0. Les identités de connexion se LISENT dans le registre
// ------------------------------------------------------------------

// Ce test ne récite pas les deux adresses : il les lit là où elles font
// autorité, dans le bloc d'amorce de `public.membres`. Ce n'est pas une
// coquetterie. D'abord, un test qui les recopie devient lui-même une des
// occurrences qu'il interdit — `test-registre-membres.cjs` le refuse, à juste
// titre. Ensuite et surtout, la bascule d'identité (3.2) changera ces
// adresses : lues ici, elles suivront ; recopiées, ce test protégerait
// exactement les identités qu'on est en train d'abandonner.
const registre = lire(MIGRATION_REGISTRE)
const debutAmorce = registre.indexOf('-- [AMORCE-REGISTRE:DEBUT]')
const finAmorce = registre.indexOf('-- [AMORCE-REGISTRE:FIN]')
assert.ok(debutAmorce >= 0 && finAmorce > debutAmorce, 'le bloc d’amorce du registre doit rester délimité')
const amorce = registre.slice(debutAmorce, finAmorce)

const COMPTES = [...new Set([...amorce.matchAll(ADRESSE)].map((m) => m[0].toLowerCase()))]
assert.ok(
  COMPTES.length >= 2,
  `l’amorce du registre doit nommer les comptes de l’agence (${COMPTES.length} trouvé(s)) — ` +
    'sans eux ce test n’a plus rien à chercher, et la migration verrouillerait l’agence hors de son outil',
)

// ------------------------------------------------------------------
// 0 bis. Balayage du dépôt entier
// ------------------------------------------------------------------

const IGNORES = new Set(['node_modules', 'dist', '.git'])
const BINAIRES = /\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|pdf|xlsx|docx|zip)$/i

const parcourir = (dossier, acc = []) => {
  for (const entree of fs.readdirSync(path.join(racine, dossier || '.'), { withFileTypes: true })) {
    const relatif = dossier ? `${dossier}/${entree.name}` : entree.name
    if (entree.isDirectory()) {
      if (IGNORES.has(entree.name)) continue
      parcourir(relatif, acc)
    } else if (!BINAIRES.test(entree.name)) {
      acc.push(relatif)
    }
  }
  return acc
}

const fichiers = parcourir('')
assert.ok(fichiers.length > 100, `recensement inattendu : ${fichiers.length} fichiers balayés`)

// ------------------------------------------------------------------
// 1. L'inventaire figé des occurrences restantes
// ------------------------------------------------------------------

// Chaque entrée porte sa raison. Une entrée qu'on ne sait pas justifier est
// une adresse à retirer, pas une ligne à ajouter ici.
const TOLERES = {
  // Le point d'entrée légitime d'une identité : l'amorce du registre, dans la
  // même transaction que la réécriture des politiques. Sans elle, la migration
  // verrouillerait l'agence hors de son outil. Contrôlé bloc par bloc en §1 bis.
  [MIGRATION_REGISTRE]: 'bloc d’amorce du registre (0.2)',

  // Migrations antérieures au registre : de l'histoire, immuable par
  // construction. Chacune de leurs politiques « agence … » est explicitement
  // supprimée puis recréée par la migration du registre —
  // `test-registre-membres.cjs` le vérifie une par une. Les adresses y sont
  // donc inertes : elles décrivent un état que la migration suivante annule.
  'supabase/migrations/20260729170200_workspace_revision_et_permissions.sql': 'histoire, politiques réécrites par le registre',
  'supabase/migrations/20260730085155_ingestion_veille_schema_reproductible.sql': 'histoire, politiques réécrites par le registre',
  'supabase/migrations/20260730160000_workspace_auteur_serveur.sql': 'histoire, politiques réécrites par le registre',

  // [à reprendre en 3.2] Script d'opération de la bascule de production, joué
  // à la main une fois, et refermé par son inverse
  // (`workspace-ecritures-directes-revoquer.sql`, que
  // `test-mise-en-production.cjs` apparie ligne à ligne). Ce n'est pas de
  // l'histoire : c'est le dernier endroit vivant où les deux adresses sont
  // écrites. Il doit passer par `public.est_membre_actif()` au moment de la
  // bascule d'identité — ce livrable ne touche pas à `supabase/operations/`.
  'supabase/operations/workspace-ecritures-directes-ouvrir.sql': 'script d’opération, à reprendre en 3.2',

  // Le test du registre (0.2) vérifie que l'amorce nomme bien ces deux
  // comptes : il ne peut pas le faire sans les écrire. Ce fichier-ci n'y
  // figure pas — il les lit dans l'amorce et n'en recopie aucune.
  'scripts/test-registre-membres.cjs': 'contrôle du registre (0.2)',
}

const trouves = []
for (const fichier of fichiers) {
  const contenu = lire(fichier)
  if (COMPTES.some((compte) => contenu.includes(compte))) trouves.push(fichier)
}

for (const fichier of trouves) {
  assert.ok(
    TOLERES[fichier],
    `${fichier} : adresse de connexion en dur.\n` +
      'Le registre `public.membres` fait autorité (livrable 0.2) ; une adresse recopiée ' +
      'ici devra être retrouvée et corrigée à la bascule d’identité (livrable 3.2).',
  )
}

// L'inventaire ne se contourne pas par un fichier vidé de son contenu : si une
// entrée tolérée n'a plus d'occurrence, tant mieux — mais on veut le savoir.
const inutiles = Object.keys(TOLERES).filter((f) => !trouves.includes(f))
assert.deepEqual(
  inutiles,
  [],
  `entrée(s) tolérée(s) devenue(s) sans objet : ${inutiles.join(', ')} — retirez-les de TOLERES`,
)

// ------------------------------------------------------------------
// 1 bis. Dans le registre, elles n'existent que dans l'amorce
// ------------------------------------------------------------------

const registreHorsAmorce = registre.slice(0, debutAmorce) + registre.slice(finAmorce)
for (const compte of COMPTES) {
  assert.ok(
    !registreHorsAmorce.includes(compte),
    `${MIGRATION_REGISTRE} : ${compte} apparaît hors du bloc d’amorce`,
  )
}

// ------------------------------------------------------------------
// 2. Les migrations postérieures au registre n'écrivent aucune adresse
// ------------------------------------------------------------------

const migrations = fs
  .readdirSync(path.join(racine, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
const nomRegistre = path.basename(MIGRATION_REGISTRE)
assert.ok(migrations.includes(nomRegistre), 'la migration du registre doit être présente')

const posterieures = migrations.filter((f) => f > nomRegistre)
for (const fichier of posterieures) {
  const sql = lire(`supabase/migrations/${fichier}`)
  for (const compte of COMPTES) {
    assert.ok(
      !sql.includes(compte),
      `supabase/migrations/${fichier} : écrite APRÈS le registre, elle ne doit citer aucune adresse. ` +
        'Une politique se branche sur public.est_membre_actif().',
    )
  }
  // Et plus largement : plus aucune politique ne compare à une adresse.
  for (const bloc of sql.split(/create policy/).slice(1)) {
    const corps = bloc.slice(0, bloc.indexOf(';'))
    assert.ok(
      !corps.includes('@'),
      `supabase/migrations/${fichier} : une politique compare à une adresse :\n${corps.slice(0, 200)}`,
    )
  }
}

// ------------------------------------------------------------------
// 3. Un projet neuf naît sans adresse
// ------------------------------------------------------------------

const schema = lire('supabase/schema.sql')
for (const compte of COMPTES) {
  assert.ok(!schema.includes(compte), `supabase/schema.sql : ${compte} — un projet neuf ne nomme personne`)
}
assert.match(
  schema,
  /insert into public\.membres[\s\S]*?from auth\.users/,
  'schema.sql amorce le registre depuis les comptes existants, sans écrire d’adresse',
)

// ------------------------------------------------------------------
// 4. Les adresses de démonstration sont reconnaissables comme telles
// ------------------------------------------------------------------

const DOMAINE_AGENCE = /export const DOMAINE_AGENCE = '([^']+)'/.exec(lire('src/util.ts'))
assert.ok(DOMAINE_AGENCE, 'src/util.ts doit déclarer DOMAINE_AGENCE')
const domaine = DOMAINE_AGENCE[1]

// Les deux seules exceptions du code du navigateur, chacune justifiée.
const ADRESSES_TOLEREES = new Map([
  [
    'agence.ll@gmail.com',
    'placeholder du champ « Compte Gmail à lire » (Paramètres) — boîte générique de ' +
      'l’agence, pas une identité de connexion',
  ],
  [
    'situations@autre-domaine.fr',
    'contre-exemple d’un commentaire de src/util.ts : la validation d’adresse ne ' +
      'présume AUCUN domaine, et cette ligne le démontre',
  ],
])

const parcourirSrc = (dossier, acc = []) => {
  for (const entree of fs.readdirSync(path.join(racine, dossier), { withFileTypes: true })) {
    const relatif = `${dossier}/${entree.name}`
    if (entree.isDirectory()) parcourirSrc(relatif, acc)
    else if (/\.(ts|tsx|css)$/.test(entree.name)) acc.push(relatif)
  }
  return acc
}

let demonstration = 0
for (const fichier of parcourirSrc('src')) {
  for (const m of lire(fichier).matchAll(ADRESSE)) {
    const adresse = m[0].toLowerCase()
    demonstration++
    if (adresse.endsWith(`@${domaine}`)) continue // adresse d'agence, générique
    if (/\.example$/.test(adresse)) continue // démonstration, TLD réservé (RFC 6761)
    assert.ok(
      ADRESSES_TOLEREES.has(adresse),
      `${fichier} : adresse « ${m[0]} ».\n` +
        `Dans src/, une adresse est en « .example » (démonstration), sur « ${domaine} » ` +
        '(générique), ou justifiée dans ADRESSES_TOLEREES de ce test. Une identité réelle ' +
        'glissée dans un jeu d’essai est indistinguable d’une identité de production.',
    )
  }
}
assert.ok(demonstration > 10, `recensement inattendu : ${demonstration} adresses dans src/`)

// La liste des comptes autorisés de l'assistant se lit dans l'environnement,
// elle ne se code pas — et l'exemple fourni n'est l'adresse de personne.
const assistant = lire('api/assistant.js')
assert.match(assistant, /process\.env\.AGENCE_EMAILS/, 'api/assistant.js lit AGENCE_EMAILS dans l’environnement')
assert.ok(
  !new RegExp(ADRESSE.source).test(assistant),
  'api/assistant.js ne doit contenir aucune adresse littérale',
)
const exemple = /^AGENCE_EMAILS=(.*)$/m.exec(lire('.env.example'))
assert.ok(exemple, '.env.example doit documenter AGENCE_EMAILS')
assert.match(
  exemple[1],
  /@example\.(com|org|net)$/,
  '.env.example doit montrer une adresse de documentation (RFC 2606), pas une vraie',
)

// ------------------------------------------------------------------
// 5. Rien, côté serveur, ne dépend du domaine de l'agence
// ------------------------------------------------------------------

// Il n'est pas acheté (§23) : il ne sert qu'à PROPOSER une adresse dans un
// formulaire du navigateur. Le jour de la bascule (3.2), un serveur qui le
// présumerait échouerait sans message clair.
const parcourirServeur = (dossier, acc = []) => {
  for (const entree of fs.readdirSync(path.join(racine, dossier), { withFileTypes: true })) {
    const relatif = `${dossier}/${entree.name}`
    if (entree.isDirectory()) parcourirServeur(relatif, acc)
    else if (/\.(ts|js|sql)$/.test(entree.name)) acc.push(relatif)
  }
  return acc
}
const serveur = [
  ...parcourirServeur('supabase/functions'),
  ...parcourirServeur('api'),
  ...parcourirServeur('scraper-worker/src'),
]
for (const fichier of serveur) {
  assert.ok(
    !lire(fichier).includes(domaine),
    `${fichier} : le domaine « ${domaine} » n’est pas acheté et ne doit rien conditionner côté serveur`,
  )
}

console.log(
  `Adresses en dur : ${fichiers.length} fichiers balayés, ${trouves.length} porteurs tous inventoriés ` +
    `(dont ${posterieures.length} migration(s) postérieure(s) au registre, toutes propres), ` +
    `${demonstration} adresses de src/ toutes en « .example », sur « ${domaine} » ou justifiées.`,
)
