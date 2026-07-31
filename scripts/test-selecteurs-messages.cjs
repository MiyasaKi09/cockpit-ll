// Les trois sélecteurs purs du livrable A.12 — ce que consomment la vue
// d'accueil (§8.1), la vue « Aujourd'hui » (§8.2) et la recherche par
// phase (§13.1).
//
// Ils sont purs : on leur passe une liste de messages, ils répondent. Ce
// test les exerce donc réellement, sans base ni navigateur — et il porte
// surtout sur les cas où une définition naïve se trompe en silence :
//
//   - un fil auquel on a répondu ne doit plus attendre de réponse ;
//   - un message sans date ne doit pas décider de l'état de son fil ;
//   - un message adressé à quelqu'un d'autre ne doit pas atterrir dans
//     « mes mails à traiter » ;
//   - les messages non classés doivent rester VISIBLES, pas disparaître
//     d'un total.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

/** transpile puis exécute un module du dépôt, dépendances injectées */
function charger(fichier, dependances = {}) {
  const compile = ts.transpileModule(lire(fichier), {
    fileName: fichier,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (id in dependances) return dependances[id]
    throw new Error(`Import runtime inattendu dans ${fichier} : ${id}`)
  })
  return mod.exports
}

const util = charger('src/util.ts')
const categorisation = charger('src/categorisation.ts', {
  './util': util,
  './miqcp': charger('src/miqcp.ts'),
})

// La couche d'accès tire React et Supabase ; les sélecteurs, eux, ne
// dépendent que du référentiel des phases. On coupe donc les modules
// d'entrée/sortie plutôt que de monter tout l'environnement.
const communications = charger('src/communications.ts', {
  react: { useCallback: () => {}, useEffect: () => {}, useMemo: () => {}, useRef: () => ({}), useState: () => [] },
  './categorisation': categorisation,
  './sync': { abonnerSession: () => () => {}, clientSupabase: () => null },
  './horsLigne': {
    ecrireCache: async () => {},
    enfiler: async () => {},
    enregistrerExecuteur: () => {},
    exigerSignataire: (v) => v,
    lireCache: async () => [],
    patcherCache: async () => {},
  },
  './util': util,
})

const { mailsATraiter, mailsEnAttenteDeReponse, echangesParPhase } = communications
for (const [nom, fn] of Object.entries({ mailsATraiter, mailsEnAttenteDeReponse, echangesParPhase }))
  assert.equal(typeof fn, 'function', `src/communications.ts doit exporter ${nom}`)

/** un message, avec les seuls champs que les sélecteurs regardent */
const msg = (over) => ({
  id: over.id,
  gmailThreadId: over.fil ?? 'F1',
  direction: over.direction ?? 'entrant',
  envoyeLe: over.envoyeLe === undefined ? '2026-07-30T09:00:00Z' : over.envoyeLe,
  destinataires: over.destinataires ?? [],
  copies: over.copies ?? [],
  traiteLe: over.traiteLe ?? null,
  projetId: over.projetId ?? null,
  phase: over.phase ?? null,
})

const MOI = ['julien@agence-ll.fr']

// --- mailsATraiter -----------------------------------------------------------

{
  const messages = [
    msg({ id: 'a', destinataires: ['Julien <julien@agence-ll.fr>'] }),
    msg({ id: 'b', copies: ['JULIEN@AGENCE-LL.FR'] }),
    msg({ id: 'c', destinataires: ['zoe@agence-ll.fr'] }),
    msg({ id: 'd', destinataires: ['julien@agence-ll.fr'], traiteLe: '2026-07-30T10:00:00Z' }),
    msg({ id: 'e', direction: 'sortant', destinataires: ['client@example.com'] }),
  ]

  const miens = mailsATraiter(messages, MOI).map((c) => c.id)
  assert.deepEqual(
    miens,
    ['a', 'b'],
    'à traiter = reçu, pas encore traité, et adressé à la personne — en direct ou en copie, ' +
      'quelle que soit la casse ou la forme « Nom <adresse> »',
  )

  const tous = mailsATraiter(messages).map((c) => c.id)
  assert.deepEqual(
    tous,
    ['a', 'b', 'c'],
    'sans personne reconnue, on montre tout ce qui attend un geste plutôt que de choisir quelqu’un au hasard',
  )

  assert.deepEqual(mailsATraiter(messages, []).map((c) => c.id), ['a', 'b', 'c'], 'une liste vide vaut « personne reconnue »')
  assert.deepEqual(mailsATraiter([], MOI), [], 'aucun message, aucune réponse — et surtout pas une erreur')
}

// --- mailsEnAttenteDeReponse -------------------------------------------------

{
  const messages = [
    // fil 1 : on nous écrit, on répond → plus rien à faire
    msg({ id: '1a', fil: 'F1', direction: 'entrant', envoyeLe: '2026-07-28T09:00:00Z' }),
    msg({ id: '1b', fil: 'F1', direction: 'sortant', envoyeLe: '2026-07-28T11:00:00Z' }),
    // fil 2 : on répond, puis le client relance → en attente
    msg({ id: '2a', fil: 'F2', direction: 'sortant', envoyeLe: '2026-07-29T09:00:00Z' }),
    msg({ id: '2b', fil: 'F2', direction: 'entrant', envoyeLe: '2026-07-29T15:00:00Z' }),
    // fil 3 : entrant unique, déjà marqué traité à la main
    msg({ id: '3a', fil: 'F3', direction: 'entrant', traiteLe: '2026-07-30T08:00:00Z' }),
  ]

  const attente = mailsEnAttenteDeReponse(messages).map((c) => c.id)
  assert.deepEqual(
    attente,
    ['2b'],
    'seul un fil dont le DERNIER message est entrant et non traité attend une réponse',
  )

  // Le piège : un message sans date ne doit pas être élu dernier de son fil.
  // Le traiter comme « très ancien » ou « très récent » fait mentir le fil
  // dans les deux sens — on l'écarte de l'élection, sans le perdre ailleurs.
  const avecSansDate = [
    msg({ id: '4a', fil: 'F4', direction: 'sortant', envoyeLe: '2026-07-30T09:00:00Z' }),
    msg({ id: '4b', fil: 'F4', direction: 'entrant', envoyeLe: null }),
  ]
  assert.deepEqual(
    mailsEnAttenteDeReponse(avecSansDate),
    [],
    'un message sans date d’envoi ne peut pas décider de l’état de son fil : on a répondu, le fil est clos',
  )

  // Ordre : le plus récent d'abord — c'est celui qui attend depuis le moins
  // longtemps, mais c'est aussi celui qu'on a en tête.
  const deuxFils = [
    msg({ id: '5a', fil: 'F5', direction: 'entrant', envoyeLe: '2026-07-25T09:00:00Z' }),
    msg({ id: '6a', fil: 'F6', direction: 'entrant', envoyeLe: '2026-07-31T09:00:00Z' }),
  ]
  assert.deepEqual(
    mailsEnAttenteDeReponse(deuxFils).map((c) => c.id),
    ['6a', '5a'],
    'les fils en attente sortent du plus récent au plus ancien',
  )
}

// --- echangesParPhase --------------------------------------------------------

{
  const messages = [
    msg({ id: 'p1', projetId: 'P01', phase: 'APD' }),
    msg({ id: 'p2', projetId: 'P01', phase: 'ESQ' }),
    msg({ id: 'p3', projetId: 'P01', phase: 'APD' }),
    msg({ id: 'p4', projetId: 'P01', phase: null }),
    msg({ id: 'p5', projetId: 'P02', phase: 'APD' }),
  ]

  const groupes = echangesParPhase(messages, 'P01')
  assert.equal(groupes.reduce((n, g) => n + g.nb, 0), 4, 'seuls les messages du projet demandé sont comptés')

  const phases = groupes.map((g) => g.phase)
  assert.ok(
    phases.indexOf('ESQ') < phases.indexOf('APD'),
    'les phases sortent dans l’ordre de la mission, pas dans l’ordre d’arrivée des messages',
  )
  assert.equal(
    phases[phases.length - 1],
    null,
    'les messages non classés forment le DERNIER groupe : ils restent visibles au lieu de disparaître d’un total',
  )
  assert.equal(groupes.find((g) => g.phase === 'APD').nb, 2, 'le compte par phase est exact')
  assert.deepEqual(echangesParPhase(messages, 'P99'), [], 'un projet sans échange rend une liste vide')
}

// --- la dépendance dure d'A.1, dite explicitement ----------------------------

const source = lire('src/communications.ts')
assert.match(
  source,
  /gmailThreadId/,
  'mailsEnAttenteDeReponse repose sur le fil capté en A.1 — sans lui la question n’a pas de réponse',
)
assert.match(source, /direction/, 'et sur le sens du message, capté en A.1')

console.log('Sélecteurs de messages : à traiter, en attente de réponse et par phase vérifiés.')
