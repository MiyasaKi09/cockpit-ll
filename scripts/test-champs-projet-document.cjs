// Livrable 0.7 — « champs neufs : Projet et DocumentRecord ».
//
// Sept champs optionnels posés maintenant, alimentés plus tard (0.8, 0.12,
// Lot 3). Aucune des régressions possibles ne fait de bruit :
//
//  1. `migrate()` reconstruit chaque projet à chaque chargement. Si la
//     reconstruction cesse de nommer les ancrages externes, ils sont effacés
//     à la première ouverture — sans erreur, sans message, sans trace ;
//  2. `DocumentRecord.phase` doit rester le référentiel des phases de la
//     mission (`PhaseCode`). Un second vocabulaire de phases ferait diverger
//     le filtre de l'arborescence Drive, chacun ayant l'air correct ;
//  3. la correspondance sous-dossier → phase existe DEPUIS L'ORIGINE dans
//     `ARBORESCENCE` (src/fsdrive.ts) : la redéclarer ailleurs créerait deux
//     vérités qui se sépareraient au premier dossier ajouté ;
//  4. `creerDocument` doit reporter phase, auteur et fichier Drive sur le
//     document. S'il les oublie, tout continue de fonctionner : les
//     documents arrivent simplement sans phase et sans auteur ;
//  5. l'adresse projet doit accepter le format retenu par l'agence
//     ([code-projet]@agence-ll.fr) SANS présumer du domaine — il n'est pas
//     acheté, et rien ne doit dépendre de son existence.

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

// --- 1. les sept champs existent, et ils sont OPTIONNELS ---------------------

const types = lire('src/types.ts')
const bloc = (nom) => {
  const m = new RegExp(`export interface ${nom} \\{([\\s\\S]*?)\\n\\}`).exec(types)
  assert.ok(m, `src/types.ts : interface ${nom} introuvable`)
  return m[1]
}

const projet = bloc('Projet')
for (const champ of ['codeExterne', 'adresseProjet', 'driveFolderId', 'calendarId']) {
  assert.match(
    projet,
    new RegExp(`\\b${champ}\\?:`),
    `src/types.ts : Projet.${champ} doit exister et rester OPTIONNEL — aucun projet existant ne le porte`,
  )
}
assert.match(
  projet,
  /\n  id: string/,
  'src/types.ts : Projet.id reste la clé interne — le code externe s’ajoute, il ne remplace pas',
)

const document = bloc('DocumentRecord')
for (const champ of ['driveFileId', 'auteur']) {
  assert.match(
    document,
    new RegExp(`\\b${champ}\\?:`),
    `src/types.ts : DocumentRecord.${champ} doit exister et rester OPTIONNEL`,
  )
}
assert.match(
  document,
  /\bphase\?:\s*PhaseCode\s*\|\s*null/,
  'src/types.ts : DocumentRecord.phase doit porter le référentiel des phases de la mission (PhaseCode) — un type libre laisserait s’installer un second vocabulaire',
)
assert.match(
  document,
  /\bvalidePar\?:/,
  'src/types.ts : `auteur` (qui dépose) ne remplace pas `validePar` (qui contrôle) — les deux traces coexistent',
)

// --- 2. migrate() ne doit pas effacer les ancrages ---------------------------

const store = lire('src/store.tsx')
const reconstruction = /etat\.projets = \(parsed\.projets \|\| \[\]\)\.map\(\(p\) => \(\{[\s\S]*?\n  \}\)\)/.exec(
  store,
)
assert.ok(reconstruction, 'src/store.tsx : la reconstruction des projets dans migrate() est introuvable')
assert.match(
  reconstruction[0],
  /\.\.\.p,/,
  'src/store.tsx : migrate() doit repartir du projet complet (...p) — une reconstruction champ par champ perdrait tout champ non listé, en silence',
)
for (const champ of ['codeExterne', 'adresseProjet', 'driveFolderId', 'calendarId']) {
  assert.match(
    reconstruction[0],
    new RegExp(`${champ}:`),
    `src/store.tsx : migrate() doit normaliser ${champ} — sinon un « » saisi puis effacé se propage comme une valeur`,
  )
}
assert.match(
  reconstruction[0],
  /adresseProjet:[^\n]*toLowerCase\(\)/,
  'src/store.tsx : l’adresse projet doit être rangée en minuscules — « P01@Agence-LL.fr » et « p01@agence-ll.fr » désignent la même boîte',
)
assert.match(
  store,
  /registreDocuments[\s\S]{0,400}PHASES_ORDRE\.includes\(doc\.phase\)/,
  'src/store.tsx : migrate() doit ramener à null une phase inconnue — un document porteur d’une phase fantaisiste disparaîtrait des filtres sans erreur',
)

const seed = lire('src/seed.ts')
const version = /export const STATE_VERSION = (\d+)/.exec(seed)
assert.ok(version, 'src/seed.ts : STATE_VERSION introuvable')
assert.ok(
  Number(version[1]) >= 18,
  `src/seed.ts : STATE_VERSION doit passer le palier des ancrages externes (18 minimum, lu ${version[1]})`,
)
assert.match(seed, /\/\/ v18 :/, 'src/seed.ts : le palier v18 doit être documenté comme les précédents')

// --- 3. une seule table sous-dossier → phase --------------------------------

const fsdrive = charger('src/fsdrive.ts', {
  './registre': { empreinteSha256: async () => '' },
  './util': charger('src/util.ts'),
})
assert.equal(typeof fsdrive.phaseDuDossier, 'function', 'src/fsdrive.ts doit exporter phaseDuDossier')
assert.equal(fsdrive.phaseDuDossier('07_CHANTIER'), 'DET', 'le dossier chantier porte la phase DET')
assert.equal(fsdrive.phaseDuDossier('08_AOR'), 'AOR')
assert.equal(
  fsdrive.phaseDuDossier('03_APS-APD_PC'),
  null,
  'un dossier qui couvre DEUX phases ne doit rien proposer : une phase fausse vaut moins que pas de phase',
)
assert.equal(fsdrive.phaseDuDossier('00_ADMIN'), null, 'un dossier hors mission ne propose aucune phase')
assert.equal(fsdrive.phaseDuDossier('inconnu'), null)

const sourceFsdrive = lire('src/fsdrive.ts')
assert.match(
  /export function phaseDuDossier[\s\S]*?\n\}/.exec(sourceFsdrive)[0],
  /ARBORESCENCE/,
  'src/fsdrive.ts : phaseDuDossier doit LIRE ARBORESCENCE — une seconde table de correspondance divergerait au premier dossier ajouté',
)

const miqcp = lire('src/miqcp.ts')
const codesPhases = /export const PHASES_ORDRE: PhaseCode\[\] = \[([^\]]*)\]/.exec(miqcp)[1]
for (const [, phases] of sourceFsdrive.matchAll(/phases: \[([^\]]*)\]/g))
  for (const code of phases.split(',').map((c) => c.trim()).filter(Boolean))
    assert.ok(
      codesPhases.includes(code),
      `src/fsdrive.ts : la phase ${code} de l’arborescence n’existe pas dans PHASES_ORDRE`,
    )

// --- 4. creerDocument reporte bien les champs sur le document ---------------

// A.4 : `registre.ts` ne cherche plus le projet lui-même — il appelle la
// cascade unifiée du §3.7. La doublure suit la vraie dépendance ; la mettre à
// `{}` ferait passer ce test avec un classement qui ne rattache plus rien.
const outils = charger('src/util.ts')
const registre = charger('src/registre.ts', {
  './util': outils,
  './rattachement': charger('src/rattachement.ts', {
    '../supabase/functions/_shared/rattachement': charger('supabase/functions/_shared/rattachement.ts'),
    './util': outils,
    './types': {},
  }),
})
const doc = registre.creerDocument({
  titre: 'CR-2026-07-30.pdf',
  nomOriginal: 'CR-2026-07-30.pdf',
  source: 'depot',
  categorie: 'CR',
  projetId: 'P01',
  phase: 'DET',
  driveFileId: '1AbCdEf',
  auteur: 'Julien',
})
assert.equal(doc.phase, 'DET', 'creerDocument doit reporter la phase sur le document')
assert.equal(doc.auteur, 'Julien', 'creerDocument doit reporter l’auteur SUR LE DOCUMENT, pas seulement dans le journal')
assert.equal(doc.driveFileId, '1AbCdEf', 'creerDocument doit reporter l’identifiant du fichier Drive')
assert.equal(doc.sourceId, undefined, 'driveFileId ne doit pas écraser sourceId — les deux traces coexistent (CDC §7.3)')
assert.equal(doc.evenements[0].auteur, 'Julien', 'le premier événement doit rester signé')

const minimal = registre.creerDocument({
  titre: 'a.pdf',
  nomOriginal: 'a.pdf',
  source: 'depot',
  categorie: 'AUTRE',
})
assert.equal(minimal.phase, null, 'sans phase choisie, le document n’en invente pas')
assert.equal(minimal.auteur, undefined, 'sans identité connue, le document ne désigne personne')

// --- 5. l'adresse projet : le format de l'agence, sans dépendre du domaine ---

const util = charger('src/util.ts')
assert.equal(util.DOMAINE_AGENCE, 'agence-ll.fr', 'le domaine retenu par l’agence est agence-ll.fr')
assert.equal(
  util.adresseProjetProposee('2026-034'),
  '2026-034@agence-ll.fr',
  'la proposition doit suivre le format [code-projet]@agence-ll.fr',
)
assert.equal(util.adresseProjetProposee('Concours Nanterre'), 'concours-nanterre@agence-ll.fr')
assert.equal(util.adresseProjetProposee(''), '', 'sans code externe, aucune adresse n’est proposée')
assert.equal(util.adresseProjetProposee(null), '')

for (const bonne of [
  '2026-034@agence-ll.fr',
  'prenom@agence-ll.fr',
  'situations@agence-ll.fr',
  'p01@autre-domaine.example.com',
  ' P01@AGENCE-LL.FR ',
])
  assert.equal(util.adresseProjetValide(bonne), true, `${bonne} doit être acceptée`)
assert.equal(util.adresseProjetValide(''), true, 'le champ est optionnel : vide est valide')
assert.equal(util.adresseProjetValide(null), true)
for (const mauvaise of ['2026-034', 'p01@agence', 'p01@@agence-ll.fr', 'p01 34@agence-ll.fr', '@agence-ll.fr'])
  assert.equal(util.adresseProjetValide(mauvaise), false, `${mauvaise} ne doit pas passer pour une adresse`)

// --- 6. les champs sont saisissables, et lus, là où c'est naturel -----------

const projets = lire('src/modules/Projets.tsx')
for (const champ of ['codeExterne', 'adresseProjet', 'driveFolderId', 'calendarId'])
  assert.match(
    projets,
    new RegExp(`pr\\.${champ} = `),
    `src/modules/Projets.tsx : ${champ} doit être enregistré par la fiche projet — un champ non saisissable ne sera jamais rempli`,
  )
assert.match(
  projets,
  /adresseProjet\.trim\(\)\.toLowerCase\(\)/,
  'src/modules/Projets.tsx : l’adresse doit être rangée dans sa forme comparable, comme dans migrate()',
)

const documents = lire('src/modules/Documents.tsx')
assert.ok(
  (documents.match(/<ChampPhase/g) || []).length >= 3,
  'src/modules/Documents.tsx : la phase doit se choisir aux DEUX arrivées (dépôt, serveur) et se corriger sur la fiche',
)
assert.match(
  documents,
  /phase: phaseChoisie\(/,
  'src/modules/Documents.tsx : la phase choisie doit partir dans creerDocument',
)
assert.match(
  documents,
  /auteur: moi\.nom \|\| undefined/,
  'src/modules/Documents.tsx : l’auteur d’un dépôt vient de useMoi() — et reste vide si l’application ne sait pas qui est là',
)
assert.match(
  documents,
  /OPTIONS_PHASE[\s\S]{0,200}PHASES_ORDRE/,
  'src/modules/Documents.tsx : les options de phase doivent venir de PHASES_ORDRE, jamais d’une liste recopiée',
)

// --- 7. `auteur` porte un NOM de personne : le renommage doit le suivre -----
//
// Sans cette entrée d'inventaire, renommer quelqu'un dans les Paramètres
// laisserait ses documents signés de l'ancien nom : ils sortiraient de
// « mes documents » sans qu'aucune erreur ne soit levée (src/personnes.ts).

const inventaire = charger('src/personnes.ts')
const etatRenommage = {
  settings: { personnes: ['Julien'], equipe: [] },
  registreDocuments: [
    { id: 'doc1', auteur: 'Julien', validePar: 'Julien' },
    { id: 'doc2', auteur: 'Zoé' },
  ],
}
inventaire.renommerPersonne(etatRenommage, 'Julien', 'Julien Martin')
assert.equal(
  etatRenommage.registreDocuments[0].auteur,
  'Julien Martin',
  'src/personnes.ts : le renommage doit réécrire l’auteur des documents — sinon ils sortent des vues de la personne, en silence',
)
assert.equal(etatRenommage.registreDocuments[1].auteur, 'Zoé', 'les documents des autres ne bougent pas')
assert.equal(
  etatRenommage.registreDocuments[0].validePar,
  'Julien',
  'la trace datée de validation n’est PAS réécrite : elle dit qui a agi ce jour-là',
)

console.log(
  'test-champs-projet-document : OK — ancrages externes du projet, phase/auteur/fichier Drive du document, une seule table de phases, adresse projet indépendante du domaine.',
)
