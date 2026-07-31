// ============================================================
// Livrable A.4 — la cascade de rattachement unifiée, la file
// « à rattacher », et la mémorisation des corrections humaines.
//
// Ce test EXÉCUTE la cascade. Il ne relit pas du code, il lui pose des
// questions et compare les réponses : c'est le seul moyen de vérifier
// une règle de priorité, et c'est le partage que `src/moi.ts` a posé —
// une règle pure, testable, dont l'écran n'est que l'habillage.
//
// CE QU'IL VERROUILLE, ET POURQUOI AUCUN DE CES DÉFAUTS NE FERAIT DE BRUIT
// -----------------------------------------------------------------------
// 1. IL N'Y A QU'UN MOTEUR. Le §3.7 décrivait trois implémentations
//    divergentes de « à quel projet appartient ce message ? » —
//    serveur, navigateur, import — qui répondaient trois choses
//    différentes selon la porte d'entrée. Aucune ne se trompait
//    visiblement ; c'est précisément pour ça que personne ne l'avait
//    vu. En réécrire une quatrième, ou laisser une ancienne en place,
//    rouvrirait la faille : le test refuse toute recherche de projet
//    hors du module partagé.
// 2. LE MODULE PARTAGÉ N'IMPORTE RIEN. C'est la condition de son
//    partage : Deno exige l'extension `.ts` à l'import, TypeScript en
//    `moduleResolution: bundler` la refuse. Un seul import ajouté ici
//    et la fonction d'ingestion cesse de se déployer — ou pire, se
//    déploie avec une copie divergente.
// 3. LA CASCADE REFUSE DE DEVINER. Deux projets à égalité rendent
//    `null` et nomment les candidats. Prendre le premier de la liste
//    est le défaut le plus coûteux du lot : un rattachement faux se
//    propage à tout un fil, se recopie dans les documents, et ne se
//    voit jamais — alors qu'un rattachement absent coûte un clic.
// 4. LE CORPS DU MESSAGE NE RATTACHE RIEN. Un nom de projet en
//    signature ou dans un fil recopié rattacherait à tort.
// 5. UNE RÈGLE APPRISE PROPOSE, ELLE NE SIGNE PAS. Une règle qui
//    écrirait la colonne humaine ferait de la mémoire de l'outil une
//    validation qu'aucun humain n'a donnée — c'est le §15 qui tombe,
//    sur le mécanisme même censé le servir.
// 6. LE RATTACHEMENT RESTE MODIFIABLE (§5.1, dernière phrase). Une
//    file « à rattacher » qui n'offrirait pas de choix serait une
//    liste de reproches.
// ============================================================

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

const CHEMIN_PARTAGE = 'supabase/functions/_shared/rattachement.ts'
const CHEMIN_NAVIGATEUR = 'src/rattachement.ts'
const CHEMIN_INGESTION = 'supabase/functions/gmail-ingestion/index.ts'
const CHEMIN_SURVEILLANCE = 'src/surveillance.ts'
const CHEMIN_IMPORTS = 'src/importRoutines.ts'
const CHEMIN_REGISTRE = 'src/registre.ts'
const CHEMIN_UTIL = 'src/util.ts'
const CHEMIN_DOCUMENTS = 'src/modules/Documents.tsx'
const CHEMIN_STORE = 'src/store.tsx'
const CHEMIN_TYPES = 'src/types.ts'

function charger(fichier, dependances = {}) {
  const transpile = ts.transpileModule(lire(fichier), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: fichier,
    reportDiagnostics: true,
  })
  const erreurs = (transpile.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error)
  assert.equal(
    erreurs.length,
    0,
    `${fichier} : ${erreurs.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`,
  )
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', transpile.outputText)(mod, mod.exports, (id) => {
    if (id in dependances) return dependances[id]
    throw new Error(`Import runtime inattendu dans ${fichier} : ${id}`)
  })
  return mod.exports
}

const P = charger(CHEMIN_PARTAGE)
const U = charger(CHEMIN_UTIL)
const N = charger(CHEMIN_NAVIGATEUR, {
  '../supabase/functions/_shared/rattachement': P,
  './util': U,
  './types': {},
})

const sansCommentaires = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

// ------------------------------------------------------------------
// 1. Un seul moteur — et un module réellement partageable
// ------------------------------------------------------------------

const codePartage = sansCommentaires(lire(CHEMIN_PARTAGE))
assert.equal(
  /(^|\n)\s*import\s/.test(codePartage),
  false,
  `${CHEMIN_PARTAGE} ne doit importer RIEN : c'est ce qui lui permet de tourner à l'identique dans Deno, dans le navigateur et ici. Un import et la fusion des trois moteurs se défait.`,
)
for (const interdit of ['Deno.', 'window.', 'localStorage', 'fetch(']) {
  assert.equal(
    codePartage.includes(interdit),
    false,
    `${CHEMIN_PARTAGE} utilise « ${interdit} » : il cesserait de tourner dans l'un des trois runtimes.`,
  )
}

// les quatre portes d'entrée passent par le module partagé
assert.ok(
  lire(CHEMIN_INGESTION).includes("from '../_shared/rattachement.ts'"),
  "L'ingestion serveur doit importer la cascade partagée, pas en réécrire une.",
)
for (const fichier of [CHEMIN_SURVEILLANCE, CHEMIN_IMPORTS, CHEMIN_REGISTRE, CHEMIN_DOCUMENTS]) {
  assert.ok(
    /from '\.\.?\/rattachement'/.test(lire(fichier)),
    `${fichier} doit passer par src/rattachement.ts — c'était l'un des moteurs divergents du §3.7.`,
  )
}

// aucun des anciens moteurs ne subsiste : plus une seule recherche de projet
// par identifiant ou par nom hors du module partagé
const RECHERCHES_INTERDITES = [
  /projets\s*\.\s*find\s*\(/,
  /projets\s*\.\s*filter\s*\(/,
  /projets\s*\.\s*some\s*\(\s*\(\s*p\s*\)\s*=>\s*fold/,
]
for (const fichier of [CHEMIN_SURVEILLANCE, CHEMIN_REGISTRE, CHEMIN_INGESTION]) {
  const code = sansCommentaires(lire(fichier))
  for (const motif of RECHERCHES_INTERDITES) {
    assert.equal(
      motif.test(code),
      false,
      `${fichier} refait une recherche de projet (${motif}). La cascade du §3.7 n'a qu'une implémentation : ${CHEMIN_PARTAGE}.`,
    )
  }
}

// `fold` : une seule normalisation, vérifiée par son COMPORTEMENT
for (const s of ['', ' Élévation ', 'ÉCOLE Saint-Éloi', 'p01', 'Ｐ01', 'àéîõü', '  ']) {
  assert.equal(P.fold(s), U.fold(s), `fold diverge sur ${JSON.stringify(s)} entre le module partagé et src/util.ts.`)
}
assert.equal(P.fold(undefined), '', 'fold partagé doit encaisser undefined : il est appelé sur des champs optionnels.')

// ------------------------------------------------------------------
// 2. Les repères de démonstration
// ------------------------------------------------------------------

const REPERES = {
  projets: [
    { id: 'P01', nom: 'Groupe scolaire Jean Moulin', codeExterne: '2026-034', adresseProjet: 'p01@agence-ll.fr' },
    { id: 'P03', nom: 'Médiathèque de Crèvecœur' },
    { id: 'P07', nom: 'Halle couverte' },
    { id: 'P12', nom: 'Gymnase Nord' },
  ],
  participants: [
    { email: 'moa@ville-crevecoeur.fr', projetIds: ['P03'], origine: 'La maîtrise d’ouvrage' },
    { email: 'partage@bet-structure.fr', projetIds: ['P03', 'P07'], origine: 'Le contact BET' },
  ],
  entreprises: [
    { id: 'E1', raisonSociale: 'Charpentes Legrand', domaines: ['legrand-charpentes.fr'], projetIds: ['P07'] },
    { id: 'E2', raisonSociale: 'Sols et Cie', domaines: ['sols-et-cie.fr'], projetIds: ['P01', 'P03'] },
  ],
  regles: [],
}

const avec = (modif) => ({ ...REPERES, ...modif })

// ------------------------------------------------------------------
// 3. L'ordre de la cascade — chaque barreau l'emporte sur les suivants
// ------------------------------------------------------------------

// tous les signaux en même temps, chacun désignant un projet différent :
// c'est le seul montage qui prouve une PRIORITÉ et pas une coïncidence
const tousLesSignaux = {
  objet: 'Réunion Halle couverte P07',
  expediteur: 'moa@ville-crevecoeur.fr',
  destinataires: ['p01@agence-ll.fr'],
  projetDuFil: 'P12',
}

let r = P.rattacher(REPERES, tousLesSignaux)
assert.equal(r.projetId, 'P01', "L'adresse dédiée du projet est le signal le plus fort (§5.1 pt 1).")
assert.equal(r.niveau, 'adresse_projet')

r = P.rattacher(REPERES, { ...tousLesSignaux, destinataires: [] })
assert.equal(r.projetId, 'P12', 'Le fil déjà rattaché passe avant l’adresse d’un participant (§3.7).')
assert.equal(r.niveau, 'fil')

r = P.rattacher(REPERES, { ...tousLesSignaux, destinataires: [], projetDuFil: null })
assert.equal(r.projetId, 'P03', 'L’adresse d’un participant déclaré passe avant l’objet (§3.7).')
assert.equal(r.niveau, 'participant')

r = P.rattacher(REPERES, { objet: 'Réunion Halle couverte P07', expediteur: 'inconnu@ailleurs.fr' })
assert.equal(r.projetId, 'P07', 'À défaut de tout le reste, l’identifiant cité dans l’objet tranche.')
assert.equal(r.niveau, 'objet')

// une règle mémorisée passe avant l'inférence machine, et après le fil :
// un humain a dit, une machine a supposé
r = P.rattacher(
  avec({ regles: [{ id: 'r1', declencheur: 'adresse', valeur: 'moa@ville-crevecoeur.fr', projetId: 'P07', creeLe: '2026-07-01', actif: true }] }),
  { expediteur: 'moa@ville-crevecoeur.fr', objet: 'Sans repère' },
)
assert.equal(r.projetId, 'P07', 'Une correction humaine mémorisée l’emporte sur l’inférence par participant.')
assert.equal(r.niveau, 'regle')

r = P.rattacher(
  avec({ regles: [{ id: 'r1', declencheur: 'adresse', valeur: 'moa@ville-crevecoeur.fr', projetId: 'P07', creeLe: '2026-07-01', actif: true }] }),
  { expediteur: 'moa@ville-crevecoeur.fr', objet: 'Sans repère', projetDuFil: 'P12' },
)
assert.equal(r.projetId, 'P12', 'Le fil reste au-dessus de la règle : c’est le signal du §3.7.')

// l'entreprise ne rattache que si elle n'a qu'un chantier
r = P.rattacher(REPERES, { expediteur: 'contact@legrand-charpentes.fr', objet: 'Devis' })
assert.equal(r.projetId, 'P07', 'Une entreprise qui n’a qu’un marché désigne son projet.')
assert.equal(r.entrepriseId, 'E1', 'L’entreprise reconnue est rendue : classerFichier la reprend au lieu de la rechercher.')

r = P.rattacher(REPERES, { expediteur: 'contact@sols-et-cie.fr', objet: 'Devis' })
assert.equal(r.projetId, null, 'Une entreprise qui intervient sur deux projets ne désigne rien.')
assert.equal(r.entrepriseId, 'E2', 'Elle reste reconnue pour autant — le classement documentaire s’en sert.')

// ------------------------------------------------------------------
// 4. Le refus de deviner — la file « à rattacher »
// ------------------------------------------------------------------

r = P.rattacher(REPERES, { objet: 'Coordination P03 et P07', expediteur: 'inconnu@ailleurs.fr' })
assert.equal(r.projetId, null, 'Deux projets cités : la cascade refuse de trancher.')
assert.deepEqual([...r.candidats].sort(), ['P03', 'P07'], 'Les candidats sont NOMMÉS — la file doit pouvoir le dire.')
assert.ok(
  r.raisons.some((x) => x.includes('P03') && x.includes('P07')),
  'L’ambiguïté doit être expliquée, pas seulement subie.',
)

r = P.rattacher(REPERES, { expediteur: 'partage@bet-structure.fr', objet: 'Point hebdo' })
assert.equal(r.projetId, null, 'Une adresse qui sert deux projets ne tranche pas non plus.')
assert.deepEqual([...r.candidats].sort(), ['P03', 'P07'])

r = P.rattacher(REPERES, { objet: 'Bonjour', expediteur: 'inconnu@ailleurs.fr' })
assert.equal(r.projetId, null)
assert.equal(r.confiance, 0, 'Aucun signal ⇒ aucune confiance : un 0,2 affiché serait un mensonge poli.')
assert.ok(r.raisons.length > 0, 'Même sans signal, la file doit pouvoir dire pourquoi.')

// déterminisme : la même question, deux fois, et dans l'autre ordre
const a = P.rattacher(REPERES, { objet: 'Coordination P03 et P07' })
const b = P.rattacher(avec({ projets: [...REPERES.projets].reverse() }), { objet: 'Coordination P03 et P07' })
assert.deepEqual(a.projetId, b.projetId, 'L’ordre des projets ne doit pas changer la réponse.')
assert.deepEqual([...a.candidats].sort(), [...b.candidats].sort())

// ------------------------------------------------------------------
// 5. Le désaccord se dit, il ne s'arbitre pas en silence
// ------------------------------------------------------------------

r = P.rattacher(REPERES, { objet: 'Suite P07', projetDuFil: 'P03', expediteur: 'inconnu@ailleurs.fr' })
assert.equal(r.projetId, 'P03', 'Le fil l’emporte, conformément au §3.7.')
assert.ok(
  r.raisons.some((x) => x.includes('désaccord') && x.includes('P07')),
  'Un signal plus faible qui désigne un AUTRE projet doit ressortir dans les raisons : c’est le seul garde-fou contre un fil mal rattaché qui se propage.',
)

// ------------------------------------------------------------------
// 6. Le corps ne rattache rien, et P1 ne mord pas P12
// ------------------------------------------------------------------

assert.equal(
  P.rattacherMessage(REPERES, { objet: 'Bonjour', expediteur: 'inconnu@ailleurs.fr' }).projetId,
  null,
  'Un message sans repère dans son objet ne se rattache pas.',
)
assert.equal(
  /devinerProjet\([^)]*extrait/.test(sansCommentaires(lire(CHEMIN_SURVEILLANCE))),
  false,
  'src/surveillance.ts ne doit plus rattacher sur l’EXTRAIT du corps : un nom de projet en signature ou dans un fil recopié rattachait à tort (§3.7). L’extrait reste le résumé affiché, il ne décide de rien.',
)
assert.equal(
  P.rattacher(REPERES, {
    objet: 'Bonjour',
    expediteur: 'inconnu@ailleurs.fr',
    corps: 'Cordialement — équipe Halle couverte P07',
  }).projetId,
  null,
  'Un corps glissé dans les indices ne doit RIEN rattacher : la cascade ne le lit pas, et un champ ajouté un jour par mégarde ne doit pas le lui faire lire.',
)

r = P.rattacher(avec({ projets: [{ id: 'P1', nom: 'Ancien projet' }, { id: 'P12', nom: 'Gymnase Nord' }] }), {
  objet: 'Dossier P12',
})
assert.equal(r.projetId, 'P12', 'Les bornes de mot doivent empêcher « P1 » de mordre « P12 ».')

// le code externe rattache aussi (§3.10 : c'est LUI que le client cite)
r = P.rattacher(REPERES, { objet: 'Votre dossier 2026-034', expediteur: 'inconnu@ailleurs.fr' })
assert.equal(r.projetId, 'P01', 'Le code externe est un identifiant de projet à part entière.')

// ------------------------------------------------------------------
// 7. Les règles : proposer, jamais signer
// ------------------------------------------------------------------

const regle = (v) => ({ id: 'x', declencheur: 'adresse', valeur: v, projetId: 'P03', creeLe: '2026-07-01', actif: true })

assert.deepEqual(
  P.reglesApplicables([{ ...regle('a@b.fr'), actif: false }], ['P03']),
  [],
  'Une règle désactivée ne s’applique pas — sinon « désactiver » ne veut rien dire.',
)
assert.deepEqual(
  P.reglesApplicables([regle('a@b.fr')], ['P99']),
  [],
  'Une règle qui pointe un projet supprimé rattacherait du courrier à un projet inexistant, sans erreur.',
)

let liste = P.memoriserRegle([], { ...regle('MOA@Ville.fr'), id: 'r1' })
assert.equal(liste.length, 1)
assert.equal(liste[0].valeur, 'moa@ville.fr', 'Une adresse se mémorise normalisée : deux casses feraient deux règles.')
liste = P.memoriserRegle(liste, { ...regle('moa@ville.fr'), id: 'r2', projetId: 'P07' })
assert.equal(liste.length, 1, 'La dernière correction remplace la précédente : deux règles contradictoires sur la même adresse sont un piège muet.')
assert.equal(liste[0].projetId, 'P07')

// aucune écriture de colonne humaine par la machine
const codeIngestion = sansCommentaires(lire(CHEMIN_INGESTION))
for (const colonne of ['projet_id_valide', 'rattache_par', 'rattache_le', 'categorise_par']) {
  assert.equal(
    codeIngestion.includes(colonne),
    false,
    `L'ingestion écrit « ${colonne} » : une règle mémorisée PROPOSE (projet_id_propose), elle ne signe jamais à la place d'un humain (§3.14, §15).`,
  )
}
assert.ok(
  codeIngestion.includes('projet_id_propose'),
  "L'ingestion doit alimenter projet_id_propose : sans proposition, la cascade ne sert à rien.",
)

// ------------------------------------------------------------------
// 8. Le versant navigateur : repères, règles, file
// ------------------------------------------------------------------

const etat = {
  projets: [
    { id: 'P01', nom: 'Groupe scolaire Jean Moulin', statut: 'En cours', emailMOA: 'moa@ville.fr', adresseProjet: 'p01@agence-ll.fr' },
    { id: 'P03', nom: 'Médiathèque de Crèvecœur', statut: 'Livré' },
  ],
  contacts: [{ id: 'c1', nom: 'Durand', email: 'durand@bet.fr', projetsIds: ['P03'] }],
  marches: [{ id: 'm1', projetId: 'P01', lot: 'Gros œuvre', entreprise: 'Sols et Cie', entrepriseId: 'E2', contactEmail: 'chantier@sols.fr' }],
  entreprises: [{ id: 'E2', raisonSociale: 'Sols et Cie', domaines: ['sols-et-cie.fr'] }],
  courriers: [
    { id: 'mail1', projetId: null, de: 'durand@bet.fr', objet: 'Note de calcul', statut: 'a_traiter', dateReception: '2026-07-20' },
    { id: 'mail2', projetId: 'P01', de: 'x@y.fr', objet: 'Déjà rangé', statut: 'a_traiter', dateReception: '2026-07-20' },
  ],
  settings: {
    equipe: [{ id: 'p1', nom: 'Julien', email: 'julien@agence-ll.fr' }],
    reglesRattachement: [],
  },
}

const reperes = N.reperesDe(etat)
assert.ok(
  reperes.participants.some((p) => p.email === 'moa@ville.fr' && p.projetIds.includes('P01')),
  'Projet.emailMOA doit entrer dans les repères — c’est le §3.7 pt 2.',
)
assert.ok(reperes.participants.some((p) => p.email === 'durand@bet.fr' && p.projetIds.includes('P03')))
assert.ok(reperes.participants.some((p) => p.email === 'chantier@sols.fr' && p.projetIds.includes('P01')))
assert.equal(
  reperes.participants.some((p) => p.email === 'julien@agence-ll.fr'),
  false,
  'Une adresse de l’agence ne rattache rien : l’agence écrit sur tous ses projets.',
)
assert.deepEqual(
  reperes.entreprises.find((e) => e.id === 'E2').projetIds,
  ['P01'],
  'Les projets d’une entreprise se déduisent de ses marchés.',
)

assert.equal(N.rattacherDepuisEtat(etat, { expediteur: 'durand@bet.fr', objet: 'Point' }).projetId, 'P03')

// une règle ne se mémorise ni sur une adresse de l'agence, ni deux fois
assert.equal(
  N.regleProposee(etat, 'julien@agence-ll.fr', 'P01'),
  null,
  'Mémoriser une adresse interne rattacherait tout le courrier de l’agence au dernier projet corrigé.',
)
assert.equal(N.regleProposee(etat, 'pas-une-adresse', 'P01'), null)
assert.equal(N.regleProposee(etat, 'durand@bet.fr', ''), null)
const proposee = N.regleProposee(etat, 'Durand@BET.fr', 'P01', 'Julien')
assert.equal(proposee.valeur, 'durand@bet.fr')
assert.equal(proposee.projetId, 'P01')
assert.equal(proposee.actif, true)
assert.equal(proposee.creePar, 'Julien')

const draft = structuredClone(etat)
N.enregistrerRegle(draft, proposee)
assert.equal(N.reglesRattachement(draft).length, 1)
assert.equal(
  N.regleProposee(draft, 'durand@bet.fr', 'P01'),
  null,
  'Une règle identique ne se re-mémorise pas : la liste doit rester lisible.',
)
N.basculerRegle(draft, proposee.id, false)
assert.equal(N.reglesRattachement(draft)[0].actif, false, 'Une règle se met en pause sans se perdre.')
assert.equal(
  N.rattacherDepuisEtat(draft, { expediteur: 'durand@bet.fr', objet: 'Point' }).projetId,
  'P03',
  'Règle en pause : la cascade reprend son cours normal.',
)
N.basculerRegle(draft, proposee.id, true)
assert.equal(
  N.rattacherDepuisEtat(draft, { expediteur: 'durand@bet.fr', objet: 'Point' }).projetId,
  'P01',
  'Règle active : la correction humaine l’emporte sur l’inférence.',
)
N.supprimerRegle(draft, proposee.id)
assert.equal(N.reglesRattachement(draft).length, 0, 'Une règle se supprime — jamais implicite, jamais définitive.')

// la file « à rattacher » : ce qui n'a pas de projet, et rien d'autre
const file = N.courriersARattacher(etat)
assert.equal(file.length, 1, 'Seuls les courriers SANS projet entrent dans la file.')
assert.equal(file[0].id, 'mail1')
assert.equal(file[0].adresse, 'durand@bet.fr', 'La file porte l’adresse : c’est sur elle que la règle se mémorise.')
assert.equal(file[0].proposition.projetId, 'P03')

// les projets proposés à la correction incluent les projets livrés (SAV, DOE)
const corrigibles = N.projetsCorrigibles(etat).map((p) => p.id)
assert.deepEqual(corrigibles, ['P01', 'P03'], 'Un projet livré doit rester rattachable : le SAV et le DOE arrivent après.')

assert.ok(N.libelleProposition(P.rattacher(REPERES, { objet: 'Coordination P03 et P07' })).includes('Ambigu'))
assert.ok(N.libelleProposition(P.rattacher(REPERES, { objet: 'Dossier P07' })).includes('Proposé par'))

// ------------------------------------------------------------------
// 9. Le rattachement reste MODIFIABLE (§5.1, dernière phrase)
// ------------------------------------------------------------------

const codeDocuments = lire(CHEMIN_DOCUMENTS)
assert.ok(
  codeDocuments.includes('corrigerRattachement'),
  'La file doit écrire par corrigerRattachement (A.3) : signée, datée, et rejouable hors ligne.',
)
assert.ok(
  codeDocuments.includes('sansProjet: true'),
  'La file « à rattacher » lit le filtre sansProjet de la couche d’accès — elle ne refait pas la requête.',
)
assert.ok(
  /Select[\s\S]{0,400}choisir un projet/.test(codeDocuments),
  'La file doit offrir un choix de projet : « le rattachement automatique doit être modifiable » (§5.1).',
)
assert.ok(
  codeDocuments.includes('regleProposee') && codeDocuments.includes('enregistrerRegle'),
  'Corriger doit pouvoir mémoriser la correction — c’est le point 5 du §5.1, absent jusqu’à A.4.',
)
assert.ok(
  codeDocuments.includes('basculerRegle') && codeDocuments.includes('supprimerRegle'),
  'Les règles doivent être listées, désactivables et supprimables — jamais implicites.',
)

// la collection vit dans les réglages PARTAGÉS : c'est ce qui permet à
// l'ingestion serveur d'appliquer la même correction
assert.ok(
  lire(CHEMIN_TYPES).includes('reglesRattachement?: RegleRattachement[]'),
  'Les règles vivent dans Settings — donc dans workspace.data, que l’ingestion lit déjà.',
)
assert.ok(
  sansCommentaires(lire(CHEMIN_STORE)).includes('etat.settings.reglesRattachement'),
  'migrate() doit normaliser les règles : une règle mal formée rattacherait du courrier sans lever d’erreur.',
)
assert.ok(
  codeIngestion.includes('reglesRattachement'),
  "L'ingestion serveur doit appliquer les règles mémorisées, sinon la correction ne vaut que pour l'onglet ouvert.",
)

console.log('test-rattachement : OK')
