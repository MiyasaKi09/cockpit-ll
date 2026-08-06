// Lot A1 — LA PORTE DU MOTEUR, ET CE QU'ELLE N'A PAS LE DROIT DE FAIRE.
//
// `test-revue-propositions.cjs` verrouille les quatre gestes du §8.7 dans
// leur module pur. Il ne peut rien dire de l'écran : c'est là que le §15 se
// perd, parce qu'un `useEffect` bien intentionné, un champ pré-rempli ou un
// bouton actif sur un formulaire vide suffisent à faire décider la machine
// SANS qu'aucune fonction pure ne mente. Le module reste juste, et l'outil
// accepte tout seul.
//
// Ce que ce test ferme, dans l'ordre du risque :
//
//   1. l'alerte agrégée S'ALLUME et MÈNE quelque part. Le moteur tournait
//      depuis A.10 : il remplissait la table, l'alerte existait dans
//      `alerts.ts`, personne ne lui passait `ctx.propositions`, et son lien
//      pointait une route qu'App.tsx ne routait pas. Trois maillons, aucun
//      bruit : la promesse centrale de l'outil — « la machine a déjà lu vos
//      mails » — n'existait qu'en base ;
//   2. l'alerte reste AGRÉGÉE et en gravité 1. Quarante détections en
//      quarante lignes rouges, c'est un fil d'urgences qu'on cesse de lire ;
//      et une détection présentée comme urgente pousse à l'accepter pour la
//      faire taire — exactement ce que le §15 interdit ;
//   3. RIEN ne s'écrit sans un clic. Aucun `useEffect` de l'écran ne touche
//      aux fonctions qui créent ou qui signent ;
//   4. la signature part AVANT la création. Si l'espace partagé refuse, rien
//      n'a été créé et il n'y a rien à défaire ; l'ordre inverse laisserait
//      une tâche orpheline et une proposition encore « à revoir » ;
//   5. « ignorer » exige un motif — et c'est l'AUTORITÉ qui le dit, pas
//      l'écran : deux validations divergeraient au premier assouplissement ;
//   6. le responsable n'est jamais pré-rempli, même quand la détection en
//      propose un (§3.15) ;
//   7. chaque geste laisse un « Annuler ».
//
// L'écran n'est pas exécutable ici (React, `useStore`, Supabase). C'est donc
// le compilateur qui le lit — un arbre syntaxique, jamais une recherche de
// texte : `accepter` apparaît quatorze fois dans les commentaires de ce
// fichier, et un `grep` n'aurait aucun moyen de les distinguer d'un appel.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')
const arbre = (f) => ts.createSourceFile(f, lire(f), ts.ScriptTarget.ES2022, true)

const cache = new Map()
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
    if (id.startsWith('.')) return charger(path.posix.join(path.posix.dirname(fichier), id))
    throw new Error(`Dépendance externe inattendue dans ${fichier} : ${id}`)
  })
  cache.set(fichier, mod.exports)
  return mod.exports
}

const ECRAN = 'src/modules/Propositions.tsx'
assert.ok(fs.existsSync(path.join(racine, ECRAN)), `${ECRAN} : sans écran, le moteur de détection n’a pas de porte`)

const A = charger('src/alerts.ts')

// ============================================================
// 1. L'alerte agrégée s'allume, et elle mène à l'écran
// ============================================================

/** un état SANS RIEN dedans : toute collection que le fil d'urgences irait
 *  lire est vide. Écrit en Proxy plutôt qu'en inventaire, parce qu'un
 *  inventaire de collections recopié ici se périmerait au premier ajout
 *  dans `types.ts` — et le test tomberait pour une raison qui n'a rien à
 *  voir avec les propositions. */
const etatNu = () =>
  new Proxy(
    { settings: { snoozes: {}, vus: {}, personnes: ['Julien', 'Zoé'], tresorerieDispo: null } },
    {
      get: (cible, cle) => (cle in cible || typeof cle === 'symbol' ? cible[cle] : []),
      has: () => true,
    },
  )

const proposee = (id, genre = 'tache') => ({ id, genre, projetId: 'P01' })

{
  // sans contexte, rien : les cinq sites d'appel historiques n'en passent
  // pas et ne doivent pas se mettre à crier
  const sansContexte = A.computeAlertes(etatNu(), '2026-08-06')
  assert.equal(
    sansContexte.filter((a) => a.type === 'proposition_ia').length,
    0,
    'sans contexte, aucune alerte de proposition — un écran qui ne lit pas les propositions ne doit pas en inventer',
  )

  // contexte fourni mais vide : toujours rien. « Zéro proposition » n'est
  // pas une nouvelle.
  const vide = A.computeAlertes(etatNu(), '2026-08-06', { propositions: [] })
  assert.equal(vide.filter((a) => a.type === 'proposition_ia').length, 0, 'zéro proposition à revoir : rien à dire')

  // et « on ne sait pas » (ni réseau ni cache) n'est pas « il n'y en a pas »
  const inconnu = A.computeAlertes(etatNu(), '2026-08-06', { propositions: undefined })
  assert.equal(
    inconnu.filter((a) => a.type === 'proposition_ia').length,
    0,
    '`undefined` = on ne sait pas : le fil se tait plutôt que d’affirmer un zéro qu’il n’a pas lu',
  )

  // trois détections en attente : UNE alerte, pas trois
  const ctx = { propositions: [proposee('p1'), proposee('p2', 'echeance'), proposee('p3')], moi: 'Julien' }
  const avec = A.computeAlertes(etatNu(), '2026-08-06', ctx).filter((a) => a.type === 'proposition_ia')
  assert.equal(
    avec.length,
    1,
    'les détections sont AGRÉGÉES : quarante propositions ne font pas quarante lignes dans un fil d’urgences ' +
      'qu’on lit debout, entre deux chantiers',
  )
  assert.equal(avec[0].titre, '3 propositions à revoir', 'le nombre est dans le titre — c’est tout ce qu’il faut savoir de loin')
  assert.equal(avec[0].gravite, 1, 'gravité 1 : une détection n’est JAMAIS urgente. La présenter en rouge ferait accepter pour faire taire')
  assert.equal(avec[0].pour, 'Julien', 'l’alerte est attribuée à la personne devant l’écran')

  // le singulier compte : « 1 propositions à revoir » est le genre de
  // détail qui fait douter du reste
  const une = A.computeAlertes(etatNu(), '2026-08-06', { propositions: [proposee('p1')] }).filter(
    (a) => a.type === 'proposition_ia',
  )
  assert.equal(une[0].titre, '1 proposition à revoir')

  // --- et le lien mène quelque part -----------------------------------
  const lien = avec[0].lien
  assert.equal(lien, '#/propositions', 'l’alerte pointe l’écran de revue, pas le registre documentaire ni l’accueil')

  const app = lire('src/App.tsx')
  const table = app.slice(app.indexOf('switch (section) {'), app.indexOf('default:', app.indexOf('switch (section) {')))
  assert.match(
    table,
    /case 'propositions':/,
    'le routeur d’App.tsx doit router `#/propositions` : sans ce `case`, le clic sur l’alerte retombe sur ' +
      'l’accueil SANS UN MOT et la personne croit avoir mal cliqué',
  )
  assert.match(app, /import\('\.\/modules\/Propositions'\)/, 'et le `case` doit monter CET écran-là')
  assert.match(
    app,
    /path: 'propositions'/,
    'une entrée de menu : l’alerte est en gravité 1, donc la première chassée de l’écran un jour chargé — sans ' +
      'porte dans le menu, le moteur redeviendrait invisible',
  )
}

// ============================================================
// 2. L'accueil nourrit le contexte — le maillon qui manquait
// ============================================================

{
  const cockpit = arbre('src/modules/Cockpit.tsx')
  const source = cockpit.getFullText()

  // le contexte passé à `alertesActives` porte bien `propositions`
  assert.match(
    source,
    /propositions:\s*propositionsNotifiables/,
    'l’accueil doit passer `ctx.propositions` : c’est le maillon qui manquait, et son absence ne faisait ' +
      'aucun bruit — l’alerte se contentait de ne jamais s’allumer',
  )
  assert.match(
    source,
    /alertesActives\(state, today, contexteAlertes\)/,
    'et le contexte doit atteindre `alertesActives`, sinon il est construit pour rien',
  )

  // la file de revue est la MÊME des deux côtés. Deux définitions du mot
  // « à revoir » donneraient un compteur qui ne correspond à rien de ce
  // que l'écran montre — le pire des deux mondes : on clique, on compte,
  // et on trouve autre chose.
  const filtre = (chemin) => {
    const m = /statut: 'proposee' as const/.exec(lire(chemin))
    return m ? m[0] : null
  }
  assert.ok(filtre('src/modules/Cockpit.tsx'), 'l’accueil définit sa file de revue sur `statut: proposee`')
  assert.ok(filtre(ECRAN), 'l’écran de revue définit la sienne sur le même statut')
  assert.equal(
    filtre('src/modules/Cockpit.tsx'),
    filtre(ECRAN),
    'le compteur de l’accueil et la file de l’écran doivent dire « à revoir » de la même façon : sinon on ' +
      'clique sur « 3 propositions à revoir » pour en trouver sept, ou aucune',
  )
}

// ============================================================
// 3. Rien ne s'écrit sans un clic (§15)
// ============================================================
//
// Les fonctions qui ENGAGENT, dans cet écran : celles qui créent un objet
// et celles qui signent la proposition. Aucune ne doit être atteignable
// depuis un `useEffect` — un effet qui « rattrape » les propositions de
// confiance élevée serait la machine décidant à la place de l'humain,
// obtenue sans qu'aucune fonction pure ne mente.

const ENGAGENT = new Set([
  'signerAcceptation', // écrit la signature dans la table (propositions.ts)
  'signerRefus',
  'rouvrirProposition',
  'accepterTache', // fabrique l'objet (revuePropositions.ts)
  'accepterEnTache', // les deux gestes de l'écran
  'accepterEcheance',
  'update', // toute écriture dans l'état local
])

/** les identifiants appelés à l'intérieur d'un nœud */
function appelsDans(noeud) {
  const noms = new Set()
  const parcourir = (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression
      if (ts.isIdentifier(e)) noms.add(e.text)
      else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) noms.add(e.name.text)
    }
    ts.forEachChild(n, parcourir)
  }
  parcourir(noeud)
  return noms
}

{
  const sf = arbre(ECRAN)
  const effets = []
  const parcourir = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'useEffect') effets.push(n)
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)
  assert.ok(effets.length > 0, `l’écran a bien des effets (${effets.length}) — sinon ce contrôle ne contrôle rien`)

  for (const effet of effets) {
    const ligne = sf.getLineAndCharacterOfPosition(effet.getStart()).line + 1
    const fautifs = [...appelsDans(effet)].filter((nom) => ENGAGENT.has(nom))
    assert.deepEqual(
      fautifs,
      [],
      `${ECRAN}:${ligne} — un \`useEffect\` appelle ${fautifs.join(', ')}. Un effet s’exécute SANS clic : la ` +
        'machine déciderait à la place de l’humain (§15), et le module pur resterait juste pendant que ' +
        'l’outil accepte tout seul.',
    )
  }

  // le pendant positif : les deux gestes SONT bien accrochés à un clic —
  // sinon l'interdit ci-dessus serait tenu par un écran qui ne fait rien
  const surClic = new Set()
  const parcourirClics = (n) => {
    if (ts.isJsxAttribute(n) && n.name.getText() === 'onClick' && n.initializer)
      for (const nom of appelsDans(n.initializer)) surClic.add(nom)
    ts.forEachChild(n, parcourirClics)
  }
  parcourirClics(sf)
  for (const geste of ['accepterEnTache', 'accepterEcheance'])
    assert.ok(surClic.has(geste), `« ${geste} » doit partir d’un clic humain, et de rien d’autre`)
}

// ============================================================
// 4. La signature part AVANT la création
// ============================================================

{
  const source = lire(ECRAN)
  const corps = source.slice(source.indexOf('const accepterEnTache'), source.indexOf('const accepterEcheance'))
  assert.ok(corps.length > 200, 'le geste « accepter en tâche » doit se lire d’un bloc')

  const signature = corps.indexOf('await signerAcceptation')
  const creation = corps.indexOf('d.taches.push')
  assert.ok(signature > 0, 'accepter DOIT signer : une proposition qui quitte « proposée » sans signature est perdue pour le détecteur')
  assert.ok(creation > 0, 'accepter DOIT créer l’objet proposé')
  assert.ok(
    signature < creation,
    'ORDRE : la signature part la première. Si l’espace partagé refuse (pas de session, pas de réseau), rien ' +
      'n’a été créé et il n’y a rien à défaire. L’ordre inverse laisse une tâche orpheline ET une proposition ' +
      'encore « à revoir » — le même travail deux fois, sans que rien ne le signale.',
  )

  // et l'objet créé n'est pas fabriqué ici : `accepterTache` en est
  // l'auteur (une seule autorité par notion, constat R3)
  assert.match(
    corps,
    /accepterTache\(revue, \{/,
    'l’écran ne fabrique pas la tâche : il la demande à `accepterTache` — la recopier ferait deux tâches ' +
      'différentes selon qu’on passe par la revue ou par l’écran des tâches',
  )
}

// ============================================================
// 5. « Ignorer » exige un motif — et c'est l'autorité qui le dit
// ============================================================

{
  const R = charger('src/revuePropositions.ts')

  // l'autorité, d'abord : elle refuse le vide et borne la longueur
  assert.ok(R.ignorer('', 'Julien').erreur, 'l’autorité refuse un motif vide')
  assert.ok(R.ignorer('   ', 'Julien').erreur, 'et un motif d’espaces')
  assert.equal(R.ignorer('Pas une tâche', 'Julien').motif, 'Pas une tâche')

  const source = lire(ECRAN)

  // l'écran l'INTERROGE avant d'écrire : il ne refait pas la validation
  const corps = source.slice(source.indexOf('const ignorer = async'), source.indexOf('const optionsResponsable'))
  assert.ok(corps.length > 100, 'le geste « ignorer » doit se lire d’un bloc')
  const demande = corps.indexOf('motifDuRefus(saisi')
  const garde = corps.indexOf("'erreur' in refus")
  const ecriture = corps.indexOf('await signerRefus')
  assert.ok(demande > 0 && garde > demande, 'l’écran demande le motif à l’autorité, puis regarde si elle a refusé')
  assert.ok(
    garde < ecriture,
    'et il s’arrête AVANT d’écrire : une détection écartée sans motif n’apprend rien au détecteur, et « pas ' +
      'une tâche » n’apprend pas la même chose que « déjà fait »',
  )

  // le bouton lui-même est fermé tant que le champ est vide : refuser
  // après coup par un message d'erreur ferait le geste, puis le défaire
  assert.match(
    source,
    /disabled=\{!motif\.trim\(\) \|\| occupe\}/,
    'le bouton « Écarter » reste inactif tant qu’aucun motif n’est saisi — la ceinture, dont l’autorité est la bretelle',
  )
}

// ============================================================
// 6. Le responsable n'est jamais pré-rempli (§3.15)
// ============================================================

{
  const R = charger('src/revuePropositions.ts')
  const brouillon = R.brouillonDepuis({
    id: 'p1',
    genre: 'tache',
    chargeUtile: { titre: 'Confirmer le planning', responsable: 'Julien' },
    extrait: 'Pouvez-vous confirmer ?',
    confiance: 0.9,
    raisons: [],
    projetId: 'P01',
  })
  assert.equal(brouillon.responsable, null, 'la détection a beau suggérer quelqu’un, le brouillon reste vide')

  const source = lire(ECRAN)
  // l'écran part du brouillon, pas de la charge utile
  assert.match(source, /brouillonDepuis\(/, 'le formulaire se remplit depuis le brouillon de l’autorité')
  assert.match(
    source,
    /Personne n’est pré-rempli/,
    'et l’écran le DIT : un champ vide sans explication ressemble à un oubli, et on le remplit au hasard',
  )
  // la suggestion reste visible — elle informe, elle ne décide pas
  assert.match(
    source,
    /Suggéré par la détection : \$\{suggere\} — à confirmer/,
    'la suggestion de la machine s’affiche en aide, jamais dans le champ : un champ pré-rempli se valide sans être lu',
  )
}

// ============================================================
// 7. Chaque geste laisse un « Annuler »
// ============================================================

{
  const sf = arbre(ECRAN)
  const toasts = []
  const parcourir = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'toast') {
      const options = n.arguments[1]
      const ligne = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
      const texte = n.arguments[0] ? n.arguments[0].getText() : ''
      const ton = options ? /tone:/.test(options.getText()) : false
      const undo = options ? /undo:/.test(options.getText()) : false
      toasts.push({ ligne, texte, ton, undo })
    }
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)
  assert.ok(toasts.length >= 4, `l’écran parle après ses gestes (${toasts.length} messages)`)

  // les messages d'ERREUR n'ont rien à annuler ; les messages de RÉUSSITE, si
  const reussites = toasts.filter((t) => !t.ton)
  assert.ok(reussites.length >= 3, 'trois gestes au moins réussissent : accepter en tâche, poser une échéance, écarter')
  const sansAnnuler = reussites.filter((t) => !t.undo).map((t) => `${ECRAN}:${t.ligne}`)
  assert.deepEqual(
    sansAnnuler,
    [],
    'un geste sans « Annuler » : la personne qui accepte la mauvaise détection à 19 h n’a plus qu’à défaire ' +
      'à la main une tâche créée et une proposition signée, dans deux mémoires différentes.\n  ' +
      sansAnnuler.join('\n  '),
  )
}

console.log(
  'Écran de revue des propositions : l’alerte agrégée s’allume (une seule ligne, gravité 1, singulier tenu) et ' +
    'mène à un écran qu’App.tsx route vraiment ; aucun effet n’accepte à la place de l’humain ; la signature ' +
    'part avant la création ; « écarter » passe par l’autorité du motif ; le responsable reste vide et la ' +
    'suggestion s’affiche à côté ; chaque geste réussi laisse un « Annuler ».',
)
