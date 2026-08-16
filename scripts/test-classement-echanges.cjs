// ============================================================
// Livrable A.8 — le classifieur déterministe des trois axes du §5.2.
//
// Ce test EXÉCUTE le classifieur : il ne relit pas du code, il lui pose
// des questions et compare les réponses. C'est le seul moyen de vérifier
// un lexique, et c'est le partage que `_shared/rattachement.ts` a posé —
// une règle pure, testable, dont l'écran n'est que l'habillage.
//
// CE QU'IL VERROUILLE, ET POURQUOI AUCUN DE CES DÉFAUTS NE FERAIT DE BRUIT
// -----------------------------------------------------------------------
// 1. IL N'Y A QU'UNE SOURCE POUR LES TROIS LISTES FERMÉES. C'est LE
//    risque du livrable, et il est double : une valeur inventée côté
//    serveur (« a_faire » au lieu de « a_traiter ») serait refusée par le
//    domaine SQL à chaque insertion, et le message ne serait jamais
//    indexé ; une liste recopiée ici divergerait au premier ajout. Le
//    test compare donc CHAQUE valeur émise par les lexiques aux listes de
//    `src/categorisation.ts`, et refuse qu'une liste fermée réapparaisse
//    dans le module serveur.
// 2. AUCUN MODÈLE N'EST APPELÉ (§3.14, décision 5). Un appel glissé ici
//    coûterait de l'argent à chaque message ingéré — soixante par jour —
//    sans qu'aucun écran ne le montre, et la seule fonction du dépôt qui
//    a le droit de dépenser est `resume-messages`, avec sa clé propre et
//    ses trois bornes de débit.
// 3. LE CLASSIFIEUR REFUSE DE DEVINER. Deux lectures à égalité laissent
//    l'axe VIDE et nomment les candidates ; sous le seuil, l'axe reste
//    vide avec la raison déjà en production. Un axe vide se voit dans la
//    file du matin ; un axe faux se lit comme un fait et ne se voit
//    jamais — il déforme les filtres du §8.2 et du §13.1 en silence.
// 4. IL PROPOSE, IL NE SIGNE PAS. L'ingestion n'écrit que les colonnes
//    `*_propose*` ; `phase`, `type_echange`, `importance` et
//    `categorise_par` restent hors de toute écriture machine. C'est le
//    critère 11 et la garantie structurelle du §15 — le GRANT au niveau
//    colonne d'A.2 la tient en base, ce test la tient dans le code.
// 5. LE CLASSEMENT S'AFFICHE AVEC SES RAISONS, ET SE CORRIGE. Une
//    proposition qu'on ne peut ni comprendre ni modifier est une décision
//    déguisée. `AxesMessage` est le seul afficheur, il porte toujours le
//    « Voir pourquoi », et `corrigerAxes` est réellement branché à un
//    écran — il ne l'était à aucun avant ce livrable.
// ============================================================

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

const CHEMIN_CLASSEUR = 'supabase/functions/_shared/classement-echanges.ts'
const CHEMIN_CASCADE = 'supabase/functions/_shared/rattachement.ts'
const CHEMIN_INGESTION = 'supabase/functions/gmail-ingestion/index.ts'
const CHEMIN_TAGGING = 'src/tagging.ts'

/** transpile puis exécute un module du dépôt, dépendances injectées à la main */
function charger(fichier, dependances = {}) {
  const compile = ts.transpileModule(lire(fichier), {
    fileName: fichier,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    reportDiagnostics: true,
  })
  const erreurs = (compile.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error)
  assert.equal(
    erreurs.length,
    0,
    `${fichier} : ${erreurs.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`,
  )
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile.outputText)(mod, mod.exports, (id) => {
    if (id in dependances) return dependances[id]
    throw new Error(`Import runtime inattendu dans ${fichier} : ${id}`)
  })
  return mod.exports
}

function sansCommentaires(fichier) {
  return ts.transpileModule(lire(fichier), {
    fileName: fichier,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      removeComments: true,
    },
  }).outputText
}

function parcourir(dossier, acc = []) {
  for (const e of fs.readdirSync(path.join(racine, dossier), { withFileTypes: true })) {
    const rel = `${dossier}/${e.name}`
    if (e.isDirectory()) parcourir(rel, acc)
    // les déclarations `.d.ts` ne se transpilent pas : les inclure ferait
    // échouer la lecture du code, pas le test qu'elle sert
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) acc.push(rel)
  }
  return acc
}

const cascade = charger(CHEMIN_CASCADE)
const classeur = charger(CHEMIN_CLASSEUR, { './rattachement.ts': cascade })
const util = charger('src/util.ts')
const miqcp = charger('src/miqcp.ts')
const cat = charger('src/categorisation.ts', { './util': util, './miqcp': miqcp })

const source = lire(CHEMIN_CLASSEUR)
const codeIngestion = lire(CHEMIN_INGESTION)

// ------------------------------------------------------------------
// 0. Le module serveur est un programme TypeScript valide, à lui seul
// ------------------------------------------------------------------
//
// `tsconfig.json` n'inclut que `src` : ce module n'est typé par personne
// puisque, délibérément, aucun fichier de `src/` ne l'importe (l'extension
// `.ts` explicite, exigée par Deno, y casserait la compilation). On lui fait
// donc son propre programme — il n'a qu'une dépendance, la cascade, et elle
// n'en a aucune : le programme est clos, et le contrôle est complet.

const programme = ts.createProgram([path.join(racine, CHEMIN_CLASSEUR)], {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
})
const typage = ts
  .getPreEmitDiagnostics(programme)
  .filter((d) => d.file && d.file.fileName.includes('supabase/functions/_shared'))
assert.equal(
  typage.length,
  0,
  `${CHEMIN_CLASSEUR} ne compile pas :\n${typage
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    .join('\n')}`,
)

// ------------------------------------------------------------------
// 1. Une seule source pour les trois listes fermées du §5.2
// ------------------------------------------------------------------

const AXES = [
  ['phase', cat.PHASES_ECHANGE, 'PHASES_ECHANGE'],
  ['type d’échange', cat.TYPES_ECHANGE, 'TYPES_ECHANGE'],
  ['importance', cat.NIVEAUX_IMPORTANCE, 'NIVEAUX_IMPORTANCE'],
]

// Le module serveur ne REDÉCLARE aucune des trois listes : il n'en émet que
// des valeurs. Une copie ici s'ouvrirait seule au premier ajout, et l'écart ne
// se verrait qu'en base.
for (const [, , nom] of AXES) {
  assert.doesNotMatch(
    sansCommentaires(CHEMIN_CLASSEUR),
    new RegExp(`\\b${nom}\\b`),
    `${CHEMIN_CLASSEUR} déclare ou recopie ${nom} : les trois listes fermées vivent dans src/categorisation.ts, et nulle part ailleurs`,
  )
}
assert.doesNotMatch(
  source,
  /from '\.\.\/\.\.\/\.\.\/src|from '\.\.\/\.\.\/src/,
  `${CHEMIN_CLASSEUR} importe src/ : il doit tourner dans Deno, où src/ n'existe pas`,
)

const valeursPhase = new Set(classeur.LEXIQUE_PHASE.map((e) => e.valeur))
const valeursType = new Set([
  ...classeur.LEXIQUE_TYPE.map((e) => e.valeur),
  ...classeur.LEXIQUE_DOMAINE.map((e) => e.valeur),
  ...Object.values(classeur.TYPE_PAR_GENRE),
])
const valeursImportance = new Set(classeur.LEXIQUE_IMPORTANCE.map((e) => e.valeur))

for (const [axe, fermee, nom, emises] of [
  ['phase', cat.PHASES_ECHANGE, 'PHASES_ECHANGE', valeursPhase],
  ['type d’échange', cat.TYPES_ECHANGE, 'TYPES_ECHANGE', valeursType],
  ['importance', cat.NIVEAUX_IMPORTANCE, 'NIVEAUX_IMPORTANCE', valeursImportance],
]) {
  for (const valeur of emises) {
    assert.ok(
      fermee.includes(valeur),
      `Le lexique de l’axe « ${axe} » émet « ${valeur} », absent de src/categorisation.ts::${nom}. ` +
        `Le domaine SQL d’A.2 refuserait l’INSERT : le message ne serait jamais indexé, et rien ne le dirait.`,
    )
  }
  assert.ok(emises.size > 0, `l’axe « ${axe} » n’a aucun lexique`)
}

// Les six mots que le plan exige nommément dans le lexique des phases.
const MOTS_DU_PLAN = [
  ['Dépôt du permis de construire', 'APD'],
  ['Envoi du DCE lot 3', 'ACT-DCE'],
  ['OPR du 3 juillet', 'AOR'],
  ['Levée de réserves', 'AOR'],
  ['Parfait achèvement : reprise du carrelage', 'SAV'],
  ['Remise du DOE', 'DOE'],
]

// ------------------------------------------------------------------
// 2. Aucun modèle appelé, aucune écriture, aucune API de plateforme
// ------------------------------------------------------------------

// Sur le CODE seul : l'en-tête, lui, a le droit d'expliquer pourquoi ce module
// tourne dans le Deno de l'ingestion.
const codeClasseur = sansCommentaires(CHEMIN_CLASSEUR)
for (const interdit of ['fetch(', 'anthropic', 'ANTHROPIC', 'Deno.', 'localStorage', 'createClient']) {
  assert.ok(
    !codeClasseur.includes(interdit),
    `${CHEMIN_CLASSEUR} contient « ${interdit} » : la catégorisation est DÉTERMINISTE (§3.14, décision 5) et ne parle à personne.`,
  )
}
assert.doesNotMatch(
  codeClasseur,
  /\.from\(|insert\(|upsert\(|\.update\(/,
  `${CHEMIN_CLASSEUR} écrit en base : il propose, il n'enregistre rien.`,
)

// ------------------------------------------------------------------
// 3. Le classifieur, exercé
// ------------------------------------------------------------------

const REPERES = {
  correspondants: [
    {
      valeur: 'julien@agence.example',
      surDomaine: false,
      genre: 'interne',
      origine: 'Adresse de l’agence (registre des membres)',
    },
    {
      valeur: 'zoe@agence.example',
      surDomaine: false,
      genre: 'interne',
      origine: 'Adresse de l’agence (registre des membres)',
    },
    {
      valeur: 'contact@boileau.example',
      surDomaine: false,
      genre: 'maitrise_ouvrage',
      origine: 'La maîtrise d’ouvrage du projet P03 (Villa Boileau)',
    },
    {
      valeur: 'structure@bet-thermique.example',
      surDomaine: false,
      genre: 'bet',
      origine: 'Le contact Dupont (BET)',
    },
    {
      valeur: 'macon-durand.example',
      surDomaine: true,
      genre: 'entreprise',
      origine: 'Le domaine déclaré de « Durand Maçonnerie »',
    },
  ],
}

const classer = (indices) => classeur.classerAxes(REPERES, indices)

// --- l'axe 1 : la phase, y compris les six mots du plan ---------------------

for (const [objet, attendu] of MOTS_DU_PLAN) {
  const r = classer({ objet, expediteur: 'quelquun@inconnu.example' })
  assert.equal(
    r.phase,
    attendu,
    `« ${objet} » doit proposer la phase ${attendu} (le plan la nomme), reçu ${r.phase}`,
  )
  assert.ok(
    r.raisons.some((x) => /L’objet parle de/.test(x)),
    `« ${objet} » : la raison doit dire que c'est l’objet qui a parlé`,
  )
}

// --- l'axe 2 : l'interlocuteur d'abord, comme le plan le tranche ------------

assert.equal(
  classer({ objet: 'Point sur le projet', expediteur: 'contact@boileau.example' }).typeEchange,
  'client',
  'un message du maître d’ouvrage déclaré est un échange « client »',
)
assert.equal(
  classer({ objet: 'Note de calcul', expediteur: 'structure@bet-thermique.example' }).typeEchange,
  'bet',
  'un message d’un contact de type BET est un échange « bet »',
)
assert.equal(
  classer({ objet: 'Devis complémentaire', expediteur: 'chef@macon-durand.example' }).typeEchange,
  'entreprise',
  'un domaine déclaré d’entreprise l’emporte sur le mot « devis » de l’objet',
)
assert.equal(
  classer({
    objet: 'Organisation de la semaine',
    expediteur: 'julien@agence.example',
    destinataires: ['zoe@agence.example'],
  }).typeEchange,
  'interne',
  'entre deux adresses de l’agence, l’échange est « interne »',
)
assert.equal(
  classer({
    objet: 'Envoi des plans',
    expediteur: 'julien@agence.example',
    destinataires: ['contact@boileau.example'],
    direction: 'sortant',
  }).typeEchange,
  'client',
  'sur un message SORTANT, l’interlocuteur est le destinataire externe — sinon la moitié du courrier serait « interne »',
)
assert.equal(
  classer({ objet: 'Instruction de votre dossier', expediteur: 'urbanisme@mairie-bourgoin.example' })
    .typeEchange,
  'urbanisme',
  'le domaine d’une mairie inconnue par ailleurs classe l’échange en « urbanisme »',
)
assert.equal(
  classer({ objet: 'Rapport initial de contrôle', expediteur: 'agence@socotec.example' }).typeEchange,
  'bureau_de_controle',
  'un contrôleur technique se reconnaît à son domaine',
)

// Le désaccord entre un signal fort et un signal faible se DIT, il ne
// s'arbitre pas en silence — c'est la doctrine de la cascade de rattachement.
const desaccord = classer({
  objet: 'Facture n°12 — honoraires',
  expediteur: 'chef@macon-durand.example',
})
assert.equal(desaccord.typeEchange, 'entreprise', 'l’interlocuteur connu l’emporte (le plan tranche)')
assert.ok(
  desaccord.raisons.some((r) => /Signal plus faible en désaccord.*financier/.test(r)),
  'le désaccord avec le lexique de l’objet doit être écrit dans les raisons',
)

// --- l'axe 3 : l'importance, à partir des marqueurs d'action ---------------

const IMPORTANCES = [
  ['Mise en demeure de reprendre les travaux', 'contractuel'],
  ['Chantier à l’arrêt depuis lundi', 'bloquant'],
  ['URGENT : réponse attendue', 'urgent'],
  ['Plans à valider', 'important'],
  ['Merci de vérifier la cote du seuil', 'a_traiter'],
]
for (const [objet, attendu] of IMPORTANCES) {
  assert.equal(
    classer({ objet, expediteur: 'quelquun@inconnu.example' }).importance,
    attendu,
    `« ${objet} » doit proposer l’importance ${attendu}`,
  )
}

// Les dix marqueurs d'action sont RELUS à leur source, et chacun doit encore
// être reconnu ici : c'est la méthode déjà employée pour `fold`, qui compare
// deux implémentations par leur comportement et non par leur texte.
//
// La source a DÉMÉNAGÉ de `src/tagging.ts` vers le module partagé au
// branchement serveur des détecteurs : celui-ci n'importe rien — c'est ce qui
// lui permet de tourner dans Deno, dans le navigateur et dans un test — donc
// il ne pouvait pas continuer à lire `tagging.ts`, qui l'importe désormais.
// Une seule liste, dans l'autre sens ; l'assertion, elle, ne bouge pas.
const CHEMIN_MARQUEURS = 'supabase/functions/_shared/detecteurs.ts'
const listeMarqueurs = /const MARQUEURS_ACTION = \[([\s\S]*?)\]/.exec(lire(CHEMIN_MARQUEURS))
assert.ok(listeMarqueurs, `${CHEMIN_MARQUEURS} : MARQUEURS_ACTION est introuvable — le plan le désigne comme source`)
const marqueurs = listeMarqueurs[1]
  .split(',')
  .map((m) => m.trim().replace(/^'|'$/g, ''))
  .filter(Boolean)
assert.ok(marqueurs.length >= 10, `MARQUEURS_ACTION doit compter au moins dix marqueurs, lu ${marqueurs.length}`)
for (const marqueur of marqueurs) {
  const r = classer({ objet: marqueur, expediteur: 'quelquun@inconnu.example' })
  assert.ok(
    r.importance !== null,
    `« ${marqueur} » est un marqueur d’action de src/tagging.ts et ne déclenche plus rien : le plan en fait la source de l’axe importance`,
  )
}

// L'expéditeur automatique : le signal est dans l'adresse, pas dans le texte.
assert.equal(
  classer({ objet: 'Votre relevé est disponible', expediteur: 'no-reply@banque.example' }).importance,
  'information',
  'une adresse « ne pas répondre » n’attend rien de personne',
)

// ------------------------------------------------------------------
// 4. Le refus de deviner, et le repli explicite
// ------------------------------------------------------------------

const vide = classer({ objet: '', corpsExtrait: '', expediteur: 'quelquun@inconnu.example' })
assert.deepEqual(
  [vide.phase, vide.typeEchange, vide.importance],
  [null, null, null],
  'sans aucun mot reconnu, les trois axes restent VIDES — un axe faux ne se voit pas',
)
assert.equal(vide.confiance, 0, 'aucune proposition ⇒ aucune confiance')
assert.equal(vide.raisons.length, 3, 'chaque axe non renseigné doit dire pourquoi : une raison par axe')
for (const r of vide.raisons) {
  assert.match(
    r,
    /Aucun mot du lexique reconnu — .* à choisir\./,
    `le repli doit reprendre la phrase déjà en production, reçu « ${r} »`,
  )
}

// Deux phases citées à égalité : on refuse, et on les nomme.
const ambigu = classer({ objet: 'Esquisse et DCE', expediteur: 'quelquun@inconnu.example' })
assert.equal(ambigu.phase, null, 'deux phases à égalité laissent l’axe vide : la cascade fait de même sur le projet')
assert.ok(
  ambigu.raisons.some((r) => /Deux lectures s’équivalent \(phase\)/.test(r) && /ESQ/.test(r) && /ACT-DCE/.test(r)),
  'le refus doit NOMMER les candidates, sinon il ne se corrige pas',
)

// Sous le seuil : reconnu dans le corps seulement, un signal faible ne classe pas.
const faible = classer({
  objet: 'Bonjour',
  corpsExtrait: 'Je transmets la demande au maître d’ouvrage.',
  expediteur: 'quelquun@inconnu.example',
})
assert.notEqual(
  faible.typeEchange,
  'client',
  'sous le seuil, « maître d’ouvrage » lu dans un corps de message ne classe rien (SEUIL_AXE)',
)
assert.ok(classeur.SEUIL_AXE > 0 && classeur.BONUS_OBJET > 0, 'le seuil et le bonus d’objet doivent rester déclarés')

// Déterministe : deux appels, la même réponse. C'est ce qui distingue ce
// classifieur d'un modèle, et ce qui rend une correction humaine durable.
const indicesTemoin = {
  objet: 'Levée de réserves — visite du 12 juin',
  corpsExtrait: 'Merci de vérifier la reprise avant vendredi.',
  expediteur: 'chef@macon-durand.example',
}
assert.deepEqual(classer(indicesTemoin), classer(indicesTemoin), 'le classement doit être reproductible à l’identique')

// La confiance ne dépasse jamais le plafond commun du dépôt.
assert.ok(
  classer(indicesTemoin).confiance <= cascade.CONFIANCE_MAX,
  'la confiance doit rester sous le plafond commun (CONFIANCE_MAX)',
)

// ------------------------------------------------------------------
// 5. L'ingestion écrit les propositions, et RIEN d'autre
// ------------------------------------------------------------------

assert.match(
  codeIngestion,
  /from '\.\.\/_shared\/classement-echanges\.ts'/,
  'gmail-ingestion doit IMPORTER le classifieur, jamais en recopier les lexiques',
)
const appel = /const axes = classerAxes\(([\s\S]*?)\}\)/.exec(codeIngestion)
assert.ok(appel, 'gmail-ingestion doit appeler classerAxes() pour chaque message indexé')
for (const champ of ['objet', 'corpsExtrait', 'expediteur', 'destinataires', 'copies', 'direction']) {
  assert.ok(
    appel[1].includes(`${champ}:`),
    `classerAxes() doit recevoir ${champ} : sans lui, un axe entier perd son signal`,
  )
}

const ligne = /function ligneCommunication\([\s\S]*?\n\}/.exec(codeIngestion)
assert.ok(ligne, 'ligneCommunication() doit rester le constructeur unique de la ligne de message')
for (const colonne of [
  'phase_proposee',
  'type_echange_propose',
  'importance_proposee',
  'confiance_categorisation',
  'raisons_categorisation',
]) {
  assert.ok(
    ligne[0].includes(`${colonne}:`),
    `ligneCommunication() doit écrire ${colonne} — c'est tout l'objet du livrable A.8`,
  )
}
// …et AUCUNE colonne humaine ni générée. Le GRANT au niveau colonne l'interdit
// déjà en base ; ici on refuse même que le code l'essaie, parce qu'une
// insertion refusée en production ne laisse d'autre trace que les journaux.
for (const colonne of [
  'phase',
  'type_echange',
  'importance',
  'categorise_par',
  'categorise_le',
  'phase_effective',
  'type_echange_effectif',
  'importance_effective',
]) {
  assert.ok(
    !new RegExp(`\\b${colonne}:`).test(ligne[0]),
    `ligneCommunication() écrit ${colonne} : la machine ne signe pas un classement (§3.14, critère 11)`,
  )
}

// Les repères du classement viennent du registre des membres, pas d'une
// adresse écrite dans le code (livrable 0.2).
assert.match(
  codeIngestion,
  /correspondantsDepuisEtat\(etatPartage, adressesAgence\)/,
  'les repères du classement doivent être construits avec les adresses du registre des membres',
)
assert.ok(
  codeIngestion.indexOf('const adressesAgence') < codeIngestion.indexOf('correspondantsDepuisEtat(etatPartage'),
  'le registre doit être lu AVANT les repères de classement : « qui est l’agence » commande le type « interne »',
)

// ------------------------------------------------------------------
// 6. Le module serveur n'est jamais importé par le navigateur
// ------------------------------------------------------------------

for (const fichier of parcourir('src')) {
  assert.doesNotMatch(
    sansCommentaires(fichier),
    /(from|import\()\s*['"][^'"]*classement-echanges/,
    `${fichier} importe le classifieur serveur : son import porte l'extension « .ts » exigée par Deno, que TypeScript en « moduleResolution: bundler » refuse — le build casserait`,
  )
}

// ------------------------------------------------------------------
// 7. Le classement s'affiche avec ses raisons, et se corrige
// ------------------------------------------------------------------

const ui = charger('src/ui.tsx', {
  react: require('react'),
  'react/jsx-runtime': require('react/jsx-runtime'),
  './prompts': { copier: async () => true },
  './util': util,
  './categorisation': cat,
})
const { AxesMessage } = ui
assert.ok(AxesMessage, 'src/ui.tsx doit exporter AxesMessage')

const rendu = (props) => renderToStaticMarkup(createElement(AxesMessage, props))

const htmlPropose = rendu({
  phase: 'AOR',
  typeEchange: 'entreprise',
  importance: 'urgent',
  confiance: 0.68,
  raisons: ['L’objet parle de la réception — phase AOR.'],
})
assert.match(htmlPropose, /Réception des travaux/, 'la phase doit être écrite en français (LIBELLES_PHASE_ECHANGE)')
assert.match(htmlPropose, /Entreprise/, 'le type d’échange doit être écrit en français')
assert.match(htmlPropose, /Urgent/, 'l’importance doit être écrite en français')
assert.match(htmlPropose, /classement proposé 68 %/, 'la confiance de la proposition doit être visible')
assert.match(
  htmlPropose,
  /Voir pourquoi ce classement/,
  'le dépôt affiche TOUJOURS pourquoi une proposition est faite : c’est le contrat des modules',
)
assert.match(htmlPropose, /L’objet parle de la réception/, 'les raisons doivent être rendues, pas seulement stockées')

// La gravité vient de `graviteDe`, jamais d'une échelle refaite sur place.
for (const [niveau, ton] of [
  ['contractuel', 'danger'],
  ['bloquant', 'danger'],
  ['urgent', 'danger'],
  ['important', 'warn'],
  ['information', 'muted'],
]) {
  const html = rendu({ importance: niveau, raisons: [] })
  assert.match(
    html,
    new RegExp(`badge-${ton}`),
    `l’importance « ${niveau} » doit prendre le ton de sa gravité ${cat.graviteDe(niveau)} (graviteDe, src/categorisation.ts)`,
  )
}

// Signé par un humain : c'est SON classement, et la confiance de la machine
// n'a plus de sens — la colonne générée a basculé.
const htmlSigne = rendu({ phase: 'AOR', confiance: 0.68, signePar: 'Zoé', raisons: [] })
assert.match(htmlSigne, /classé par Zoé/, 'un classement signé doit dire qui a signé')
assert.doesNotMatch(
  htmlSigne,
  /classement proposé/,
  'après signature humaine, la confiance de la machine ne veut plus rien dire et ne doit plus s’afficher',
)

// Rien à dire, rien à afficher : la plupart des messages n'ont pas encore
// d'axe, et trois badges vides répétés sur toute une file seraient du bruit.
assert.equal(rendu({ raisons: [] }), '', 'sans axe ni raison, le composant ne doit rien afficher')

// Un seul afficheur, et il est monté là où un classement apparaît.
const definitions = parcourir('src').filter((f) => /function AxesMessage\b/.test(lire(f)))
assert.deepEqual(
  definitions,
  ['src/ui.tsx'],
  'un seul composant de classement : deux copies, c’est deux « Voir pourquoi » qui divergent',
)
const lecteurs = parcourir('src').filter(
  (f) => f !== 'src/communications.ts' && f !== 'src/ui.tsx' && /raisonsCategorisation/.test(sansCommentaires(f)),
)
assert.ok(lecteurs.length > 0, 'personne ne lit les raisons du classement : le composant serait monté nulle part')
for (const fichier of lecteurs) {
  assert.match(
    sansCommentaires(fichier),
    /AxesMessage/,
    `${fichier} lit raisonsCategorisation sans monter <AxesMessage/> : un classement affiché sans son « pourquoi » se lit comme un fait`,
  )
}

/** « ce composant-là est-il monté dans cette fonction-là », question qu'une
 *  expression régulière ne sait pas poser */
function fonction(fichier, nom) {
  const src = ts.createSourceFile(fichier, lire(fichier), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  let trouvee = null
  const visiter = (n) => {
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) && n.name && n.name.text === nom)
      trouvee = n
    ts.forEachChild(n, visiter)
  }
  visiter(src)
  assert.ok(trouvee, `${fichier} : la fonction ${nom} a disparu — la surface a été renommée`)
  return trouvee
}
function monte(noeud, composant) {
  let n = 0
  const visiter = (x) => {
    const tag = ts.isJsxSelfClosingElement(x) || ts.isJsxOpeningElement(x) ? x.tagName.getText() : null
    if (tag === composant) n++
    ts.forEachChild(x, visiter)
  }
  visiter(noeud)
  return n
}
for (const composant of ['AxesMessage', 'ChoixAxes']) {
  assert.ok(
    monte(fonction('src/modules/Documents.tsx', 'CarteMessagesARattacher'), composant) > 0,
    `src/modules/Documents.tsx › CarteMessagesARattacher : ${composant} doit y être monté — c'est aujourd'hui le seul écran où un message se relit`,
  )
}

// La correction est réellement branchée : `corrigerAxes` n'avait aucun appelant
// avant ce livrable, et une proposition qu'on ne peut pas modifier est une
// décision déguisée (critère 11).
const appelants = parcourir('src').filter(
  (f) => f !== 'src/communications.ts' && /corrigerAxes\(/.test(lire(f)),
)
assert.ok(
  appelants.length > 0,
  'aucun écran n’appelle corrigerAxes : les trois axes ne seraient corrigeables qu’en SQL',
)
const correction = lire('src/modules/Documents.tsx')
assert.match(
  correction,
  /corrigerAxes\(\s*message,\s*\{[\s\S]{0,200}phase:[\s\S]{0,200}typeEchange:[\s\S]{0,200}importance:/,
  'la correction doit porter les TROIS axes : categorise_par les commande ensemble, en signer un seul viderait les deux autres',
)

console.log(
  `Classement des échanges (§5.2) : ${classeur.LEXIQUE_PHASE.length} entrées de phase, ` +
    `${classeur.LEXIQUE_TYPE.length + classeur.LEXIQUE_DOMAINE.length} de type, ` +
    `${classeur.LEXIQUE_IMPORTANCE.length} d’importance, toutes dans les listes fermées de src/categorisation.ts ; ` +
    'déterministe, repli explicite, propositions affichées et corrigeables.',
)
