// A.7 — la bascule de la boîte « À traiter » vers `communications`.
//
// Le livrable n'ajoute aucune fonctionnalité : il change la mémoire sous
// un écran qui, lui, ne doit pas bouger. Tout le risque est donc dans ce
// qui pourrait DISPARAÎTRE ou APPARAÎTRE EN DOUBLE au moment du passage.
//
// Ce test tient cinq choses :
//
//   1. la fusion ne perd rien et ne double rien — un mail présent dans les
//      deux mémoires apparaît UNE fois, et c'est la ligne relationnelle,
//      celle qui porte le projet, les axes et la signature ;
//   2. le jumeau ancien voyage avec elle, pour que le traiter marque les
//      deux — sinon le mail ressort dès que la table est hors de portée ;
//   3. l'ordre est celui d'avant, et il est calculé sur la file ENTIÈRE :
//      un urgent d'une source ne passe pas derrière un ordinaire de l'autre ;
//   4. la boîte du §8.1 montre ce qui m'est adressé ET ce qui n'est adressé
//      nommément à personne — le courrier d'une boîte partagée ne doit pas
//      tomber dans la file de personne ;
//   5. l'écran garde ses trois boutons. « ✓ Fait » cède la place à
//      « Créer une tâche » en B.3, pas ici : retirer un geste avant que son
//      successeur existe, c'est retirer un geste.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

const cache = new Map()
const EXTERNES = {
  react: { useCallback: (f) => f, useEffect: () => {}, useMemo: (f) => f(), useRef: () => ({}), useState: () => [] },
  '@supabase/supabase-js': { createClient: () => null },
}

function charger(chemin) {
  const fichier = chemin.endsWith('.ts') ? chemin : `${chemin}.ts`
  if (cache.has(fichier)) return cache.get(fichier)
  const compile = ts.transpileModule(lire(fichier), {
    fileName: fichier,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  cache.set(fichier, mod.exports)
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (id in EXTERNES) return EXTERNES[id]
    if (id.startsWith('.')) return charger(path.posix.join(path.posix.dirname(fichier), id))
    throw new Error(`Dépendance externe inattendue dans ${fichier} : ${id}`)
  })
  cache.set(fichier, mod.exports)
  return mod.exports
}

const { fusionnerBoite, urgenceDe, dateDe, comparerMemoires, joursConsecutifsSansEcart, ECARTS_BLOQUANTS, JOURS_DE_PARITE_EXIGES } = charger('src/boite.ts')
const { mailsATraiterPourLaBoite } = charger('src/communications.ts')
const { NIVEAUX_IMPORTANCE, graviteDe } = charger('src/categorisation.ts')

for (const [nom, fn] of Object.entries({ fusionnerBoite, urgenceDe, dateDe, mailsATraiterPourLaBoite }))
  assert.equal(typeof fn, 'function', `${nom} doit être exportée`)

/** un ancien `Courrier`, tel que `src/surveillance.ts` l'écrit */
const courrier = (over) => ({
  id: over.id,
  projetId: over.projetId ?? null,
  de: over.de ?? 'client@example.com',
  objet: over.objet ?? 'Validation façade sud',
  resume: over.resume ?? 'Le client valide.',
  type: 'question',
  urgence: over.urgence,
  pour: over.pour,
  statut: 'a_traiter',
  dateReception: over.dateReception ?? '2026-07-30T09:00:00Z',
  // `src/surveillance.ts` écrit exactement cette forme
  source: over.gmailId ? `gmail:${over.gmailId}` : over.source,
  importance: over.importance ?? null,
})

/** une ligne de `communications`, réduite à ce que la boîte regarde */
const message = (over) => ({
  id: over.id,
  gmailMessageId: over.gmailId ?? '',
  gmailThreadId: over.fil ?? 'F1',
  urlGmail: null,
  expediteur: over.expediteur ?? 'Client <client@example.com>',
  expediteurAdresse: over.expediteurAdresse ?? 'client@example.com',
  destinataires: over.destinataires ?? [],
  copies: over.copies ?? [],
  objet: over.objet ?? 'Validation façade sud',
  corpsExtrait: over.corpsExtrait ?? 'Bonjour, …',
  direction: over.direction ?? 'entrant',
  envoyeLe: over.envoyeLe === undefined ? '2026-07-30T09:00:00Z' : over.envoyeLe,
  recuLe: over.recuLe ?? null,
  resume: over.resume ?? null,
  resumeLe: null,
  projetId: over.projetId ?? null,
  phase: null,
  typeEchange: null,
  importance: over.importance ?? null,
  traitePar: null,
  traiteLe: over.traiteLe ?? null,
})

// --- 1. la fusion ne perd rien, et ne double rien ----------------------------

{
  const jumelle = { gmailId: '18f0abc123', objet: 'Devis lot 3' }
  const anciens = [
    courrier({ id: 'c1', ...jumelle, urgence: 2 }),
    courrier({ id: 'c2', source: 'routine tri du matin', urgence: 1 }),
  ]
  const neufs = [message({ id: 'm1', ...jumelle, projetId: 'P01' })]

  const boite = fusionnerBoite(anciens, neufs)
  assert.equal(boite.length, 2, 'le mail présent des deux côtés n’apparaît qu’UNE fois')

  const fusionnee = boite.find((e) => e.genre === 'message')
  assert.ok(fusionnee, 'c’est la ligne relationnelle qui l’emporte : elle porte le projet et la signature')
  assert.equal(fusionnee.message.projetId, 'P01', 'et donc son rattachement, que l’ancienne n’avait pas')

  // --- 2. le jumeau voyage avec elle -----------------------------------------
  assert.equal(
    fusionnee.jumeau?.id,
    'c1',
    'l’ancien `Courrier` reste attaché au message : le traiter doit marquer les DEUX, ' +
      'sinon il ressort dès que la table est hors de portée (hors ligne, cache froid)',
  )

  const seul = boite.find((e) => e.genre === 'courrier')
  assert.equal(seul.courrier.id, 'c2', 'un `Courrier` sans identifiant Gmail reste affiché : ' +
    'l’absence d’identifiant n’est pas une preuve de doublon')
}

// --- l'appariement supporte les quatre formes de référence -------------------

{
  // `Courrier.source` s'écrit `gmail:<id>` ; `Communication.gmailMessageId`
  // est l'identifiant nu. Les rapprocher est tout l'objet du dédoublonnage.
  const boite = fusionnerBoite(
    [courrier({ id: 'c1', source: 'gmail:18f0abc123' })],
    [message({ id: 'm1', gmailId: '18f0abc123' })],
  )
  assert.equal(boite.length, 1, '`gmail:<id>` et l’identifiant nu désignent le même mail')

  const sansIdentifiant = fusionnerBoite(
    [courrier({ id: 'c1', source: 'gmail:18f0abc123' })],
    [message({ id: 'm1', gmailId: '' })],
  )
  assert.equal(
    sansIdentifiant.length,
    2,
    'un message sans identifiant ne peut apparier personne — mieux vaut un doublon visible qu’un mail effacé',
  )
}

// --- 3. un seul tri sur la file entière --------------------------------------

{
  const boite = fusionnerBoite(
    [courrier({ id: 'vieux-ordinaire', source: 'saisie', urgence: 1, dateReception: '2026-07-01T09:00:00Z' })],
    [
      message({ id: 'urgent', gmailId: 'aa11bb', importance: 'urgent', envoyeLe: '2026-07-30T09:00:00Z' }),
      message({ id: 'calme', gmailId: 'cc22dd', importance: 'information', envoyeLe: '2026-07-29T09:00:00Z' }),
    ],
  )
  const ordre = boite.map((e) => (e.genre === 'message' ? e.message.id : e.courrier.id))
  assert.deepEqual(
    ordre,
    ['urgent', 'vieux-ordinaire', 'calme'],
    'urgence décroissante puis date croissante, sur la file ENTIÈRE : empiler les deux sources ' +
      'aurait classé l’urgent de l’une derrière l’ordinaire de l’autre',
  )
}

// --- l'échelle est bien commune aux deux mémoires ----------------------------

{
  for (const niveau of NIVEAUX_IMPORTANCE) {
    const parMessage = urgenceDe({ genre: 'message', message: message({ id: 'x', importance: niveau }), jumeau: null })
    assert.equal(
      parMessage,
      graviteDe(niveau),
      `« ${niveau} » doit peser la même chose des deux côtés — sinon le tri compare des unités différentes`,
    )
    assert.ok(parMessage >= 1 && parMessage <= 3, 'l’échelle reste 1-3, celle de `Courrier.urgence`')
  }
  assert.equal(
    urgenceDe({ genre: 'message', message: message({ id: 'x', importance: 'URGENT' }), jumeau: null }),
    0,
    'une valeur hors référentiel ne se fait pas passer pour urgente',
  )
  assert.equal(
    urgenceDe({ genre: 'courrier', courrier: courrier({ id: 'c', source: 'x' }) }),
    0,
    'un courrier sans urgence vaut 0, pas `undefined` — sinon le tri devient NaN et l’ordre part au hasard',
  )
}

// --- 4. la boîte du §8.1 : les miens, et ceux de personne --------------------

{
  const MOI = ['julien@agence-ll.fr']
  const AGENCE = ['julien@agence-ll.fr', 'zoe@agence-ll.fr']
  const messages = [
    message({ id: 'a-moi', gmailId: 'a1', destinataires: ['Julien <julien@agence-ll.fr>'] }),
    message({ id: 'en-copie', gmailId: 'a2', copies: ['JULIEN@AGENCE-LL.FR'] }),
    message({ id: 'a-zoe', gmailId: 'a3', destinataires: ['zoe@agence-ll.fr'] }),
    message({ id: 'partage', gmailId: 'a4', destinataires: ['contact@agence-ll.fr'] }),
    message({ id: 'deja-traite', gmailId: 'a5', destinataires: MOI, traiteLe: '2026-07-30T10:00:00Z' }),
    message({ id: 'sortant', gmailId: 'a6', direction: 'sortant', destinataires: ['client@example.com'] }),
  ]

  assert.deepEqual(
    mailsATraiterPourLaBoite(messages, MOI, AGENCE).map((c) => c.id),
    ['a-moi', 'en-copie', 'partage'],
    'ma boîte : ce qui m’est adressé, plus ce qui n’est adressé nommément à personne de l’agence — ' +
      'un mail arrivé sur `contact@` ne doit tomber dans la file de personne',
  )

  assert.deepEqual(
    mailsATraiterPourLaBoite(messages, [], AGENCE).map((c) => c.id),
    ['a-moi', 'en-copie', 'a-zoe', 'partage'],
    'personne reconnue : on montre tout ce qui attend un geste plutôt que de choisir quelqu’un au hasard',
  )

  // La règle reproduite est bien l'ancienne (`!c.pour || c.pour === personne`) :
  // un mail nommément adressé à l'autre associé sort de ma file, et un seul.
  const zoe = mailsATraiterPourLaBoite(messages, ['zoe@agence-ll.fr'], AGENCE).map((c) => c.id)
  assert.ok(!zoe.includes('a-moi'), 'ce qui m’est nommément adressé n’est pas dans la file de l’autre')
  assert.ok(zoe.includes('partage'), 'le courrier partagé est dans les DEUX files : quelqu’un doit le prendre')
}

// --- B.3 : créer une tâche depuis un message, sans le faire disparaître -----

{
  const boite = /function useBoiteATraiter[\s\S]*?\n}/.exec(lire('src/modules/Cockpit.tsx'))
  assert.ok(boite, 'useBoiteATraiter doit exister')

  assert.match(
    boite[0],
    /source: \{ type: 'message', id: champs\.source \}/,
    'la tâche créée depuis un message CONSERVE le lien vers lui (§4.2) — sans quoi ' +
      'elle devient une phrase sans référence, et rouvrir le mail demande de le retrouver à la main',
  )

  // Les deux mémoires passent par la MÊME fabrique : deux chemins de
  // création divergeraient sur la source, et l'un des deux la perdrait.
  assert.equal(
    (boite[0].match(/creerTacheDepuisMessage\(\{/g) || []).length,
    2,
    'les deux sources appellent la même fabrique — une par mémoire, pas deux implémentations',
  )
  assert.equal(
    (boite[0].match(/creerTache\(\{/g) || []).length,
    1,
    'une seule construction de tâche : la fabrique de `src/taches.ts` garantit les 18 champs',
  )

  // LE point de B.3 : créer une tâche ne marque pas le message traité.
  // Les enchaîner ferait sortir de la boîte un mail auquel on n'a pas
  // encore répondu — le geste d'organisation n'est pas le geste de clôture.
  const fabrique = /const creerTacheDepuisMessage[\s\S]*?undo: \(\) => replace\(snap\),/.exec(boite[0])
  assert.ok(fabrique, 'la fabrique doit être identifiable')
  assert.doesNotMatch(
    fabrique[0],
    /marquerTraite|statut = 'traite'/,
    'créer une tâche ne marque PAS le message traité : ce sont deux gestes, et les enchaîner ' +
      'ferait sortir de la boîte un mail auquel on n’a pas répondu',
  )
  assert.match(fabrique[0], /undo: \(\) => replace\(snap\)/, 'le geste est annulable, comme les autres')
}

// --- B.18 : mesurer la parité, sinon « sept jours » est une phrase ----------

{
  const FENETRE = { debut: '2026-07-25', fin: '2026-07-31' }
  const par = (c, m) => comparerMemoires(c, m, FENETRE)
  const genres = (c, m) => par(c, m).flatMap((j) => j.ecarts.map((e) => e.genre)).sort()

  // Le cas qui INTERDIT la coupure : le navigateur l'a vu, le cron non.
  assert.deepEqual(
    genres([courrier({ id: 'c1', gmailId: '18f0aa11', dateReception: '2026-07-30T09:00:00Z' })], []),
    ['absent_du_relationnel'],
    'un mail vu par le navigateur et absent de la table est l’écart qui interdit la coupure',
  )

  // Un `Courrier` SANS identifiant Gmail n'est pas comparable. La moitié
  // du dépôt est dans ce cas ; les compter manquants produirait un écart
  // permanent qui masquerait les vrais.
  assert.deepEqual(
    genres([courrier({ id: 'c1', source: 'routine tri du matin', dateReception: '2026-07-30T09:00:00Z' })], []),
    [],
    'un courrier sans identifiant Gmail sort de la comparaison au lieu de la polluer',
  )

  // L'inverse n'est PAS un défaut : le serveur ne dépend pas d'un onglet
  // ouvert. On le montre — c'est ce qui permet de CONSTATER le gain — mais
  // il ne doit pas bloquer.
  assert.deepEqual(
    genres([], [message({ id: 'm1', gmailId: '18f0bb22', recuLe: '2026-07-30T09:00:00Z' })]),
    ['absent_de_l_ancien'],
  )
  assert.ok(
    !ECARTS_BLOQUANTS.has('absent_de_l_ancien'),
    'le gain attendu ne doit pas bloquer la coupure qu’il justifie',
  )

  // Divergences de contenu sur un mail présent des deux côtés.
  const jumeaux = (over = {}) => [
    [courrier({ id: 'c1', gmailId: '18f0cc33', dateReception: '2026-07-30T09:00:00Z', projetId: over.projetAncien ?? null, de: over.de ?? 'client@example.com' })],
    [message({ id: 'm1', gmailId: '18f0cc33', recuLe: '2026-07-30T09:00:00Z', projetId: over.projetNeuf ?? null, expediteurAdresse: over.deNeuf ?? 'client@example.com' })],
  ]
  assert.deepEqual(genres(...jumeaux()), [], 'deux mémoires d’accord ne produisent aucun écart')
  assert.deepEqual(
    genres(...jumeaux({ projetAncien: 'P01', projetNeuf: 'P02' })),
    ['projet_divergent'],
  )
  // `null` d'un côté n'est pas une divergence : c'est « pas encore
  // rattaché », et les deux mémoires n'apprennent pas au même rythme.
  assert.deepEqual(
    genres(...jumeaux({ projetAncien: 'P01', projetNeuf: null })),
    [],
    'un rattachement absent d’un côté n’est pas une divergence — sinon l’outil crie tous les jours',
  )
  assert.deepEqual(
    genres(...jumeaux({ de: 'Client <CLIENT@example.com>' })),
    [],
    'la casse et la forme « Nom <adresse> » ne sont pas des divergences',
  )
  assert.deepEqual(genres(...jumeaux({ deNeuf: 'autre@example.com' })), ['expediteur_divergent'])

  // La réponse exacte à la condition de B.15.
  const jour = (j, nb) => ({ jour: j, nbAncien: nb, nbRelationnel: nb, ecarts: [] })
  assert.equal(
    joursConsecutifsSansEcart([jour('2026-07-31', 3), jour('2026-07-30', 2), jour('2026-07-29', 1)]),
    3,
  )
  assert.equal(
    joursConsecutifsSansEcart([
      jour('2026-07-31', 3),
      { ...jour('2026-07-30', 2), ecarts: [{ genre: 'absent_du_relationnel' }] },
      jour('2026-07-29', 1),
    ]),
    1,
    'le compteur repart de zéro au premier écart bloquant, en partant du plus récent',
  )

  // LE piège : un jour vide n'est pas un jour « sans écart ». Le compter
  // offrirait une semaine de congés comme preuve de parité, ce qui est
  // l'inverse exact d'une mesure.
  assert.equal(
    joursConsecutifsSansEcart([jour('2026-07-31', 3), jour('2026-07-30', 0), jour('2026-07-29', 1)]),
    1,
    'un jour sans aucun message des deux côtés est sans INFORMATION, pas sans écart',
  )

  assert.equal(JOURS_DE_PARITE_EXIGES, 7, 'le seuil du plan, cité trois fois comme non négociable')

  // Les jours sortent du plus récent au plus ancien : c'est l'ordre dans
  // lequel le compteur les lit, et celui dans lequel on les regarde.
  const plusieurs = par(
    [
      courrier({ id: 'c1', gmailId: '18f0d1d1', dateReception: '2026-07-28T09:00:00Z' }),
      courrier({ id: 'c2', gmailId: '18f0d2d2', dateReception: '2026-07-30T09:00:00Z' }),
    ],
    [],
  )
  assert.deepEqual(plusieurs.map((j) => j.jour), ['2026-07-30', '2026-07-28'])

  // Hors fenêtre : ignoré des deux côtés. Sans cela, tout l'historique
  // antérieur au déploiement du cron apparaîtrait comme un écart.
  assert.deepEqual(
    par([courrier({ id: 'c1', gmailId: '18f0e1e1', dateReception: '2026-01-01T09:00:00Z' })], []),
    [],
    'la fenêtre est donnée par l’appelant : avant le cron, tout serait « absent du relationnel »',
  )
}

// --- 5. l'écran garde ses trois boutons -------------------------------------

const cockpit = lire('src/modules/Cockpit.tsx')
for (const [bouton, pourquoi] of [
  ['Répondre', 'le brouillon Gmail est le seul geste d’envoi — le Cockpit n’envoie pas d’e-mail (§4.1)'],
  ['→ Journal', 'transformer un mail en note de projet est le geste du §4.2'],
  ['✓ Fait', 'son remplaçant est arrivé en B.3, mais le retrait est B.15 : les deux cohabitent'],
  ['Créer une tâche', 'B.3 — le geste du §8.4 « depuis un e-mail », avec sa source'],
]) {
  assert.ok(cockpit.includes(bouton), `A.7 ne change PAS les actions : « ${bouton} » doit rester — ${pourquoi}`)
}

// La bascule est une FUSION, pas un remplacement : couper l'ancienne source
// avant que la nouvelle soit prouvée ne casserait pas la file, elle la
// viderait en silence. Le retrait est un livrable à part, sous condition.
assert.match(
  cockpit,
  /state\.courriers\s*\n?\s*\.filter\(\(c\) => c\.statut === 'a_traiter'\)/,
  'l’ancienne mémoire reste lue tant que B.15 n’a pas mesuré sept jours de parité',
)
assert.match(cockpit, /useCommunications\(/, 'la nouvelle mémoire est lue par la couche d’accès d’A.3')

// « ne sait pas encore » n'est pas « vide » : `lignes` vaut `null` tant que ni
// le réseau ni le cache n'ont répondu. En faire une liste vide afficherait une
// boîte calme là où l'on n'a simplement rien lu.
assert.match(
  cockpit,
  /lignes \? mailsATraiterPourLaBoite\([^)]*\) : \[\]/,
  '`lignes === null` ne doit pas être confondu avec une boîte vide : l’ancienne file reste seule affichée',
)

// Le marqueur de traitement devient nominatif : c'est la raison d'être du
// livrable. Un `Courrier.statut` ne dit pas QUI a traité, donc ne se journalise pas.
assert.match(cockpit, /marquerTraite\(/, 'le traitement passe par `marquerTraite`, qui signe et date')

console.log(
  'Boîte « À traiter » : deux mémoires fusionnées, dédoublonnées par l’identifiant Gmail, ' +
    'triées ensemble, et les trois gestes intacts.',
)
