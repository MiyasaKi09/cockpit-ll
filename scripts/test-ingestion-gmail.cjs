// ============================================================
// Livrable A.1 — l'ingestion Gmail enrichie.
//
// Deux choses sont vérifiées ici, et elles n'ont pas la même nature.
//
// A. LA NORMALISATION D'UN MESSAGE EST EXÉCUTÉE, pas relue.
//    `supabase/functions/gmail-ingestion/message.ts` est écrit sans
//    import ni API Deno exactement pour ça : ce test le transpile et
//    l'appelle sur des messages Gmail réalistes. Les cas qui cassent
//    une lecture d'en-têtes ne sont pas exotiques — un nom
//    d'affichage qui contient une virgule (forme par défaut d'un
//    carnet Outlook), un en-tête `Date` absent ou fantaisiste, un
//    `References` replié sur deux lignes, un corps base64url accentué
//    — et aucun ne produit d'erreur : ils produisent une donnée
//    fausse, silencieusement.
//
// B. LE CURSEUR NE PEUT PAS PERDRE DE MESSAGE EN SILENCE. C'est le
//    défaut que ce livrable corrige (§3.6 : « un pic de courrier fait
//    perdre des messages en silence »), et il se réintroduit en une
//    ligne. Trois propriétés le tiennent, chacune vérifiée :
//      1. la fenêtre fixe a disparu — plus de `newer_than:`, plus de
//         `in:inbox`, sans quoi la moitié sortante du courrier reste
//         invisible et la « direction » du message est une constante ;
//      2. la tranche traitée est BORNÉE des deux côtés et listée
//         jusqu'au bout : Gmail rend le plus récent d'abord, donc
//         borner à N messages sans borner le temps traite les plus
//         RÉCENTS et fait avancer le curseur par-dessus les plus
//         anciens ;
//      3. le curseur porte la requête qu'il a parcourue. A.2
//         élargira l'ingestion à tous les messages ; un curseur
//         hérité de la requête étroite ferait sauter tout
//         l'historique sans pièce jointe.
//
// Et une chose est vérifiée par son ABSENCE : cette migration ne crée
// aucune table. `communications` est le livrable A.2, et le plan exige
// qu'elle naisse d'une seule migration avec les dix colonnes des trois
// axes. En livrer une moitié ici imposerait la reprise de lignes que
// le plan veut précisément éviter.
// ============================================================

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

const CHEMIN_MESSAGE = 'supabase/functions/gmail-ingestion/message.ts'
const CHEMIN_INDEX = 'supabase/functions/gmail-ingestion/index.ts'
const CHEMIN_MIGRATION = 'supabase/migrations/20260731103000_ingestion_gmail_enrichie.sql'

// ------------------------------------------------------------------
// A. La normalisation, exécutée pour de vrai
// ------------------------------------------------------------------

const transpile = ts.transpileModule(lire(CHEMIN_MESSAGE), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: CHEMIN_MESSAGE,
  reportDiagnostics: true,
})
const erreurs = (transpile.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error)
assert.equal(
  erreurs.length,
  0,
  `${CHEMIN_MESSAGE} : ${erreurs.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`,
)

const mod = { exports: {} }
new Function('module', 'exports', 'require', transpile.outputText)(mod, mod.exports, require)
const M = mod.exports

// Le module doit rester importable hors Deno : c'est ce qui rend ce test
// possible. Un import ajouté ici le rendrait de nouveau illisible. Les
// commentaires sont retirés avant le contrôle — ils NOMMENT les API qu'ils
// expliquent de ne pas utiliser, et un test qui interdirait de les nommer
// interdirait d'en documenter le refus.
const codeMessage = lire(CHEMIN_MESSAGE)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, '')
assert.ok(
  !/^\s*import\s/m.test(codeMessage),
  `${CHEMIN_MESSAGE} ne doit rien importer : c'est ce qui permet de l'exécuter en CI`,
)
assert.ok(
  !/Deno\./.test(codeMessage),
  `${CHEMIN_MESSAGE} ne doit utiliser aucune API Deno`,
)

const enBase64Url = (texte) =>
  Buffer.from(texte, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const RECU_MS = Date.UTC(2026, 6, 29, 8, 12, 0)
const AGENCE = new Set(['zoe@agence.example', 'julien@agence.example'])

const enteteCommune = [
  { name: 'From', value: 'Marie Durand <M.Durand@Constructeur.example>' },
  // le nom d'affichage entre guillemets contient une virgule : un split(',')
  // naïf produit ici deux destinataires dont aucun n'a d'adresse
  { name: 'To', value: '"Durand, Paul" <p.durand@moa.example>, zoe@agence.example' },
  { name: 'Cc', value: 'Bureau de contrôle <bc@controle.example>' },
  { name: 'Subject', value: 'P03 — CCTP lot 3, remarques' },
  // en-tête Date antérieur de deux jours à la réception : un relais a retenu
  // le message. Les deux dates doivent rester distinctes.
  { name: 'Date', value: 'Mon, 27 Jul 2026 18:45:00 +0200' },
  // casse volontairement « Message-Id » et non « Message-ID »
  { name: 'Message-Id', value: '<abc123@constructeur.example>' },
  { name: 'In-Reply-To', value: '<parent@agence.example>' },
  { name: 'References', value: '<racine@moa.example>\r\n <parent@agence.example>' },
]

const corpsEtPieces = {
  mimeType: 'multipart/mixed',
  parts: [
    {
      mimeType: 'multipart/alternative',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: enBase64Url('Bonjour,\n\nVoici nos remarques sur le CCTP — c’est très urgent.\n') },
        },
        { mimeType: 'text/html', body: { data: enBase64Url('<p>Bonjour</p>') } },
      ],
    },
    { filename: 'CCTP_lot3.pdf', mimeType: 'application/pdf', body: { attachmentId: 'ANGjdJ1', size: 240_000 } },
    { filename: 'signature.png', mimeType: 'image/png', body: { attachmentId: 'ANGjdJ2', size: 4_000 } },
  ],
}

const messageEntrant = {
  id: '18f2a3b4c5d6e7f8',
  threadId: '18f2a3b4c5d6e000',
  labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'],
  internalDate: String(RECU_MS),
  payload: { ...corpsEtPieces, headers: enteteCommune },
}

const entrant = M.enrichir(messageEntrant, AGENCE)

assert.equal(entrant.threadId, '18f2a3b4c5d6e000', 'le fil doit être capté : sans lui, A.12 n’a pas de définition')
assert.notEqual(entrant.threadId, entrant.id, 'le fil et le message sont deux identifiants distincts')
assert.deepEqual(entrant.libelles, ['INBOX', 'UNREAD', 'IMPORTANT'], 'les libellés Gmail sont conservés')

assert.equal(entrant.messageIdRfc, '<abc123@constructeur.example>', 'Message-ID lu quelle que soit la casse de l’en-tête')
assert.equal(entrant.enReponseA, '<parent@agence.example>', 'In-Reply-To chaîne la réponse à sa question')
assert.deepEqual(
  entrant.references,
  ['<racine@moa.example>', '<parent@agence.example>'],
  'References doit être découpé même replié sur deux lignes',
)

assert.equal(entrant.expediteurAdresse, 'm.durand@constructeur.example', 'l’adresse d’expéditeur est normalisée en minuscules')
assert.deepEqual(
  entrant.destinataires,
  [
    { nom: 'Durand, Paul', adresse: 'p.durand@moa.example' },
    { nom: '', adresse: 'zoe@agence.example' },
  ],
  'un nom d’affichage contenant une virgule ne doit pas casser la liste des destinataires',
)
assert.deepEqual(
  entrant.copies,
  [{ nom: 'Bureau de contrôle', adresse: 'bc@controle.example' }],
  'les copies sont lues comme les destinataires',
)

assert.equal(entrant.recuLe, new Date(RECU_MS).toISOString(), 'la réception vient de internalDate')
assert.equal(entrant.recuMs, RECU_MS, 'le curseur avance sur internalDate, en millisecondes')
assert.equal(entrant.envoyeLe, '2026-07-27T16:45:00.000Z', 'l’envoi vient de l’en-tête Date, fuseau appliqué')
assert.notEqual(entrant.envoyeLe, entrant.recuLe, 'envoi et réception sont deux dates distinctes (§4.1)')

assert.equal(entrant.objet, 'P03 — CCTP lot 3, remarques')
assert.match(entrant.corpsExtrait, /remarques sur le CCTP/, 'le corps texte est extrait')
assert.match(entrant.corpsExtrait, /c’est très urgent/, 'le corps base64url doit être décodé en UTF-8, accents compris')
assert.ok(!entrant.corpsExtrait.includes('<p>'), 'le HTML ne doit pas être préféré au texte quand les deux existent')

assert.equal(entrant.pieces.length, 2, 'seules les parties portant un fichier joint sont des pièces')
assert.deepEqual(
  entrant.pieces.map((p) => p.filename),
  ['CCTP_lot3.pdf', 'signature.png'],
  'les pièces sont trouvées en profondeur, dans l’ordre du message',
)

// --- le sens du message, les trois chemins ---------------------------------

assert.equal(entrant.direction, 'entrant', 'un message reçu d’un tiers est entrant')

const messageSorti = {
  ...messageEntrant,
  id: '18f2a3b4c5d6e7f9',
  labelIds: ['SENT'],
  payload: {
    ...corpsEtPieces,
    headers: enteteCommune.map((h) => (h.name === 'From' ? { name: 'From', value: 'Zoé <zoe@agence.example>' } : h)),
  },
}
assert.equal(M.enrichir(messageSorti, AGENCE).direction, 'sortant', 'le libellé SENT décide du sens')

// Le cas qui compte pour A.12 : l'autre associée a répondu au client en nous
// mettant en copie. Le message arrive dans notre boîte, sans libellé SENT, et
// il est pourtant sortant — sinon le fil passerait pour « sans réponse ».
const messageDeLassociee = {
  ...messageEntrant,
  id: '18f2a3b4c5d6e7fa',
  labelIds: ['INBOX'],
  payload: {
    ...corpsEtPieces,
    headers: enteteCommune.map((h) => (h.name === 'From' ? { name: 'From', value: 'Julien <Julien@Agence.example>' } : h)),
  },
}
assert.equal(
  M.enrichir(messageDeLassociee, AGENCE).direction,
  'sortant',
  'un message émis par un membre du registre est sortant, même sans libellé SENT',
)
assert.equal(
  M.enrichir(messageDeLassociee, new Set()).direction,
  'entrant',
  'registre vide : tout est réputé entrant — la lecture prudente, un fil de trop, jamais un de moins',
)

// --- les replis : une date absente ou fausse ne doit rien inventer ----------

const sansDate = {
  ...messageEntrant,
  payload: { ...corpsEtPieces, headers: enteteCommune.filter((h) => h.name !== 'Date') },
}
assert.equal(
  M.enrichir(sansDate, AGENCE).envoyeLe,
  new Date(RECU_MS).toISOString(),
  'sans en-tête Date, l’envoi retombe explicitement sur la réception',
)

const dateFolle = {
  ...messageEntrant,
  payload: {
    ...corpsEtPieces,
    headers: enteteCommune.map((h) => (h.name === 'Date' ? { name: 'Date', value: 'Thu, 32 Jul 2026 99:99' } : h)),
  },
}
assert.equal(
  M.enrichir(dateFolle, AGENCE).envoyeLe,
  new Date(RECU_MS).toISOString(),
  'une date illisible vaut mieux remplacée que stockée : elle fausserait tout tri chronologique',
)

const sansEnTete = M.enrichir({ id: 'x1', internalDate: String(RECU_MS) }, AGENCE)
assert.equal(sansEnTete.threadId, 'x1', 'un message sans threadId retombe sur son propre identifiant')
assert.equal(sansEnTete.objet, '(sans objet)')
assert.deepEqual(sansEnTete.destinataires, [])
assert.equal(sansEnTete.messageIdRfc, null, 'un en-tête absent vaut null, jamais une chaîne vide déguisée')
assert.equal(sansEnTete.direction, 'entrant')

// --- ce qui n'est pas un message -------------------------------------------

assert.equal(M.estIndexable(['DRAFT', 'SENT']), false, 'un brouillon n’a pas été envoyé : il n’est pas indexable')
assert.equal(M.estIndexable(['CHAT']), false, 'un message Chat n’est pas du courrier')
assert.equal(M.estIndexable(['INBOX']), true)

// --- les briques d'analyse, isolément ---------------------------------------

assert.deepEqual(
  M.separerAdresses('"Durand, Paul" <p.durand@moa.example>, "A, B" <ab@x.example>, seul@y.example'),
  ['"Durand, Paul" <p.durand@moa.example>', '"A, B" <ab@x.example>', 'seul@y.example'],
  'le découpage respecte guillemets et chevrons',
)
assert.deepEqual(M.adresseNommee('  <A@B.example> '), { nom: '', adresse: 'a@b.example' })
assert.equal(M.adresseSeule('Marie <m@x.example>'), 'm@x.example')
assert.deepEqual(M.listeAdresses('un-groupe-sans-arobase, ok@x.example'), [{ nom: '', adresse: 'ok@x.example' }])
assert.equal(M.identifiantMessage(''), null)
assert.ok(M.EXTRAIT_MAX > 0 && M.EXTRAIT_MAX <= 8000, 'l’extrait de corps reste un extrait')

const longExtrait = M.enrichir(
  {
    id: 'x2',
    internalDate: String(RECU_MS),
    payload: {
      mimeType: 'text/plain',
      headers: [],
      body: { data: enBase64Url('a'.repeat(M.EXTRAIT_MAX * 3)) },
    },
  },
  AGENCE,
).corpsExtrait
assert.equal(longExtrait.length, M.EXTRAIT_MAX, 'le corps est borné : l’index n’est pas une copie de Gmail (§4.3)')

// ------------------------------------------------------------------
// B. Le curseur, et ce qu'il ne peut pas perdre
// ------------------------------------------------------------------

const index = lire(CHEMIN_INDEX)
// Même précaution qu'en A : l'en-tête du fichier CITE l'ancienne requête pour
// expliquer ce qui a changé et pourquoi. Ce qui est interdit, c'est de
// l'exécuter, pas de la nommer.
const codeIndex = index.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '')

assert.ok(
  !/newer_than:/.test(codeIndex),
  'la fenêtre fixe `newer_than:` doit avoir disparu : elle perdait les messages au-delà de sa borne, sans jamais les redemander',
)
assert.ok(
  !/in:inbox/.test(codeIndex),
  '`in:inbox` doit avoir disparu : sans les messages envoyés, la direction est une constante et A.12 n’a pas de définition',
)
assert.match(index, /const REQUETE_GMAIL = '[^']+'/, 'la requête Gmail doit être une constante nommée')
assert.match(index, /const PORTEE_CURSEUR = /, 'le curseur doit porter la requête qu’il a parcourue')
assert.match(
  index,
  /cfg\.curseur_gmail_portee === PORTEE_CURSEUR/,
  'le curseur ne doit être repris que si sa portée est celle du code : une requête élargie ne peut pas hériter d’une position acquise sur une requête plus étroite',
)
assert.match(
  index,
  /curseur_gmail: String\(curseur\)[\s\S]{0,120}curseur_gmail_portee: PORTEE_CURSEUR/,
  'le curseur et sa portée s’écrivent ensemble : l’un sans l’autre est un piège différé',
)

// La tranche : bornée des deux côtés, listée jusqu'au bout, paginée sans
// boucle infinie.
assert.match(index, /after:\$\{apresSec\} before:\$\{avantSec\}/, 'la tranche traitée est bornée des DEUX côtés')
assert.match(index, /for \(let page = 0; page < PAGES_MAX; page\+\+\)/, 'la pagination doit rester bornée')
assert.match(index, /if \(!liste\.nextPageToken\) return \{ ids, complet: true \}/, 'la tranche doit dire si elle a été listée en entier')
assert.match(
  index,
  /const idsAnciensDabord = \[\.\.\.listing\.ids\]\.reverse\(\)/,
  'Gmail liste du plus récent au plus ancien : traiter d’abord les plus anciens est ce qui rend le curseur monotone',
)
assert.match(
  index,
  /const trancheEntiere = ids\.length === idsAnciensDabord\.length/,
  'le curseur ne saute à la borne haute que si la tranche a été traitée en entier',
)
assert.match(
  index,
  /trancheEntiere && listing\.complet \? Math\.max\(curseurAtteint, borneHaute\) : curseurAtteint/,
  'tranche partielle ou incomplète : le curseur s’arrête au dernier message réellement traité',
)
assert.match(index, /maintenant - MARGE_MS/, 'le curseur s’arrête avant l’instant présent : un message reçu pendant le passage porte une date déjà dépassée')
assert.match(
  index,
  /listing\.complet \? '' : 'ATTENTION/,
  'une tranche non listée en entier doit être signalée, pas subie en silence',
)

// Le sens du message, côté serveur : il vient du registre, jamais d'une
// adresse écrite ici.
assert.match(index, /adressesMembresActifs\(sb\)/, 'les adresses de l’agence viennent du registre des membres')
assert.match(index, /adresseNormalisee\(cfg\.compte_email\)/, 'le compte Gmail ingéré compte aussi comme adresse de l’agence')

// Les colonnes enrichies partent avec CHAQUE insertion : un contexte écrit à
// un seul endroit se perdrait dès la deuxième pièce du message.
const contexte = /function contexteMessage\(msg: MessageEnrichi\) \{[\s\S]*?\n\}/.exec(index)
assert.ok(contexte, 'contexteMessage() doit rester le constructeur unique du contexte de message')
for (const colonne of [
  'thread_id',
  'message_id_rfc',
  'en_reponse_a',
  'references_rfc',
  'destinataires',
  'copies',
  'libelles',
  'direction',
  'envoye_le',
  'corps_extrait',
]) {
  assert.ok(contexte[0].includes(`${colonne}:`), `contexteMessage() doit porter ${colonne}`)
}

const insertions = [...index.matchAll(/\.from\('entrants'\)\s*\.insert\(\{([\s\S]*?)\n\s*\}\)/g)]
assert.equal(insertions.length, 3, 'trois insertions : la pièce à valider, le doublon tracé, la pièce sortante indexée')
for (const [, corps] of insertions) {
  assert.ok(
    corps.includes('...contexteMessage(msg)'),
    `une insertion n’emporte pas le contexte de son message :\n${corps.slice(0, 160)}`,
  )
}

// La pièce SORTANTE est indexée, jamais téléchargée, jamais proposée : la
// boîte d'arrivée ne liste que `a_valider` et ne bouge pas d'un iota.
const brancheSortante = /if \(msg\.direction === 'sortant'\) \{[\s\S]*?\n {6}continue\n {4}\}/.exec(index)
assert.ok(brancheSortante, 'le traitement des messages sortants doit rester un bloc identifiable')
assert.ok(
  !/attachments\//.test(brancheSortante[0]),
  'une pièce sortante ne se télécharge pas : elle a été écrite par l’agence, elle n’a rien à valider ni à stocker',
)
assert.ok(
  !/storage/.test(brancheSortante[0]),
  'une pièce sortante ne consomme pas le bucket privé',
)
assert.match(brancheSortante[0], /statut: 'ignore'/, 'une pièce sortante n’entre jamais dans la file de validation')

// Un message illisible ne doit pas retenir le curseur indéfiniment.
assert.match(index, /catch \{[\s\S]{0,400}echecs\+\+/, 'un message illisible est compté, pas fatal')
assert.match(index, /echecs \? `\$\{echecs\} message\(s\) illisible\(s\)` : ''/, 'les échecs doivent apparaître dans le dernier résultat')

// Rien ne change du contrat du Lot 0 : l'ingestion propose, elle ne conclut pas.
assert.ok(
  !/\.from\('entrants'\)\s*\.update\(/.test(index),
  'gmail-ingestion ne réécrit jamais une pièce déjà déposée',
)

// ------------------------------------------------------------------
// C. La migration : les colonnes, le domaine fermé, et rien de plus
// ------------------------------------------------------------------

const migration = lire(CHEMIN_MIGRATION)

const nomMigration = path.basename(CHEMIN_MIGRATION)
const migrations = fs
  .readdirSync(path.join(racine, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
assert.ok(migrations.includes(nomMigration), 'la migration de l’ingestion enrichie doit être présente')
assert.ok(
  nomMigration > '20260730180000_registre_des_membres.sql',
  'elle doit s’appliquer après le registre des membres, dont elle réutilise les politiques',
)

for (const colonne of [
  'thread_id',
  'message_id_rfc',
  'en_reponse_a',
  'references_rfc',
  'destinataires',
  'copies',
  'libelles',
  'direction',
  'envoye_le',
  'corps_extrait',
]) {
  assert.match(
    migration,
    new RegExp(`add column if not exists ${colonne}\\s`),
    `public.entrants doit gagner ${colonne}, et de façon rejouable`,
  )
}
for (const colonne of ['curseur_gmail', 'curseur_gmail_portee']) {
  assert.match(
    migration,
    new RegExp(`add column if not exists ${colonne}\\s`),
    `public.ingestion_config doit gagner ${colonne}`,
  )
}

assert.match(
  migration,
  /check \(direction is null or direction in \('entrant', 'sortant'\)\)/,
  'le domaine du sens est fermé en base : une troisième valeur casserait tout filtre écrit au-dessus',
)
assert.match(migration, /create index if not exists entrants_thread_idx/, 'le fil doit être indexé : c’est sur lui qu’on interroge')

// Le contrôle final : une colonne manquante ne doit pas produire une Edge
// Function dont chaque insertion échoue en silence.
assert.match(migration, /raise exception[\s\S]{0,200}colonnes absentes après migration/, 'la migration doit vérifier son propre effet')

// Aucune table créée : `communications` est le livrable A.2, et le plan exige
// qu'elle naisse d'UNE seule migration avec les dix colonnes des trois axes.
// Le SQL est lu commentaires retirés : l'en-tête EXPLIQUE ce que la migration
// s'interdit de faire, et doit pouvoir le nommer.
const sqlMigration = migration.replace(/^\s*--.*$/gm, '')
assert.ok(
  !/create table/i.test(sqlMigration),
  'A.1 ne crée aucune table : livrer une moitié de `communications` imposerait la reprise de lignes que le plan veut éviter',
)
assert.ok(
  !/communications/.test(sqlMigration),
  '`communications` appartient à A.2 — la créer ici laisserait croire qu’elle existe',
)

// Aucune politique nouvelle : celles du registre des membres couvrent déjà ces
// tables, et une politique écrite ici ne passerait pas par est_membre_actif().
assert.ok(
  !/create policy/i.test(sqlMigration),
  'aucune politique nouvelle : `entrants` garde celles de la migration du registre',
)

// ------------------------------------------------------------------
// D. Le registre reste la seule source des adresses de l'agence
// ------------------------------------------------------------------

const partage = lire('supabase/functions/_shared/membres.ts')
assert.match(
  partage,
  /export async function adressesMembresActifs\(/,
  'le module partagé doit exposer les adresses des membres actifs',
)
const corpsAdresses = partage.slice(partage.indexOf('export async function adressesMembresActifs('))
assert.match(corpsAdresses, /\.eq\('actif', true\)/, 'un membre désactivé n’est plus l’agence')
assert.match(
  corpsAdresses,
  /if \(error\)[\s\S]{0,240}return new Set<string>\(\)/,
  'registre illisible : ensemble vide, donc tout message réputé entrant — un fil « en attente » de trop, jamais un de moins',
)

console.log(
  'Ingestion Gmail enrichie : normalisation exécutée sur 8 messages (fil, en-têtes RFC, ' +
    'destinataires, dates distinctes, corps UTF-8, direction par libellé et par registre) ; ' +
    'curseur borné, portée mémorisée, tranche complète vérifiée ; migration additive sans table neuve.',
)
