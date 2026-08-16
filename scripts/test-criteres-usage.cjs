// Plan d'action d'usage, §5.2 — les vérifications MÉCANIQUES.
//
// « Trois vérifications mécaniques, greppables, à zéro après cette semaine :
//   aucun lien vers une route inexistante (`#/messages` dans `alerts.ts`) ;
//   aucun `window.prompt` dans `src/modules/` ; chaque alerte de gravité 3
//   porte au moins un geste ou un lien qui atterrit sur l'élément. »
//
// Le plan a écrit « greppables ». C'est précisément ce qu'il ne faut PAS
// faire, et le dépôt en a déjà fait deux fois l'expérience (`test-tableaux`) :
// une recherche sur le texte brut ne distingue pas une adresse ÉCRITE dans un
// lien d'une adresse CITÉE dans un commentaire. Or les deux corrections en
// question sont documentées en commentaire, avec les mots qu'elles
// interdisent — `alerts.ts` explique pourquoi `#/messages` a disparu,
// `Cockpit.tsx` explique quel `window.prompt` a été remplacé. Une recherche
// textuelle échouerait donc le jour de son écriture, on la relâcherait, et
// elle ne servirait plus à rien. Le compilateur rend un arbre : un littéral
// de chaîne EST une adresse, un commentaire n'en est pas une.
//
// POURQUOI CES TROIS-LÀ MÉRITENT UN TEST
// ----------------------------------------
// · Un lien mort ne plante pas. Le routeur retombe sur l'accueil, en silence
//   (`default: page = <Cockpit />`). La personne clique, se retrouve sur
//   l'accueil, croit avoir mal cliqué, recommence. C'est un défaut qui coûte
//   du temps tous les jours et que rien ne signale jamais.
// · `window.prompt` bloque l'onglet, ne se style pas, ne se teste pas,
//   n'accepte aucun format, ne laisse aucun « Annuler » — et sur un téléphone
//   de chantier il est franchement hostile. Le dépôt s'en est débarrassé ;
//   la question est qu'il ne revienne pas.
// · Une alerte rouge qui dépose en haut d'une liste fait rechercher à la main
//   ce que la machine venait de trouver. C'est le constat T6, vu par trois
//   auditeurs.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')

function fichiersSources(dossier) {
  const trouves = []
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, entree.name)
    if (entree.isDirectory()) trouves.push(...fichiersSources(complet))
    else if (/\.tsx?$/.test(entree.name)) trouves.push(path.relative(racine, complet))
  }
  return trouves.sort()
}

const arbre = (chemin) => ts.createSourceFile(chemin, lire(chemin), ts.ScriptTarget.ES2022, true)

const SOURCES = fichiersSources(path.join(racine, 'src'))
assert.ok(SOURCES.length > 50, 'le balayage doit couvrir tout src/ — un périmètre vide passerait au vert pour rien')

// ============================================================
// 1. Aucun lien vers une route inexistante
// ============================================================
//
// La table de vérité, c'est le `switch (section)` d'App.tsx — le seul endroit
// qui décide ce qu'une adresse affiche. Tout le reste (l'onglet, l'élément)
// est lu par le module d'arrivée, chacun à sa façon : ce test s'arrête donc
// à la SECTION, la seule chose qu'un fichier extérieur puisse trancher.

const app = lire('src/App.tsx')
const debutTable = app.indexOf('switch (section) {')
assert.ok(debutTable > 0, 'le routeur d’App.tsx doit être un `switch (section)` — c’est lui la table de vérité')
// on s'arrête au `default:` : au-delà, un `case` appartiendrait à un autre
// aiguillage, et l'accepter comme section rendrait ce test permissif en
// silence — exactement le défaut qu'il cherche
const tableRoutage = app.slice(debutTable, app.indexOf('default:', debutTable))
const sections = new Set([...tableRoutage.matchAll(/case '([a-z0-9-]*)':/g)].map((m) => m[1]))
assert.ok(sections.size > 20, `les sections se lisent dans le switch d’App.tsx (${sections.size} trouvées)`)
assert.ok(sections.has(''), 'la racine `#/` est routée (l’accueil)')
assert.ok(!sections.has('messages'), 'aucun écran message n’existe avant B.15 : c’est le fait que le §1 vérifie')

/** toutes les adresses `#/…` ÉCRITES dans le code — jamais celles citées en commentaire */
function adressesEcrites(chemin) {
  const trouvees = []
  const sf = arbre(chemin)
  const noter = (texte, noeud) => {
    if (!texte.startsWith('#/')) return
    trouvees.push({
      texte,
      section: texte.slice(2).split('/')[0],
      ligne: sf.getLineAndCharacterOfPosition(noeud.getStart()).line + 1,
    })
  }
  const parcourir = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) noter(n.text, n)
    // `` `#/projets/${id}` `` : c'est la TÊTE du gabarit qui porte la section
    else if (ts.isTemplateExpression(n)) noter(n.head.text, n)
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)
  return trouvees
}

{
  const morts = []
  let total = 0
  for (const fichier of SOURCES) {
    for (const a of adressesEcrites(fichier)) {
      total++
      if (!sections.has(a.section)) morts.push(`${fichier}:${a.ligne} → « ${a.texte} »`)
    }
  }
  assert.ok(total > 100, `le dépôt porte ${total} adresses internes : le balayage doit en voir beaucoup, sinon il ne balaie rien`)
  assert.deepEqual(
    morts,
    [],
    'ces liens pointent une section qu’App.tsx ne route pas : le clic retombe sur l’accueil SANS UN MOT, et la personne croit avoir mal cliqué :\n  ' +
      morts.join('\n  '),
  )

  // le cas nommé par le plan, verrouillé par son nom : les alertes de courrier
  // pointaient `#/messages/{id}` alors qu'aucun écran message n'existe. Elles
  // ouvrent désormais le fil dans Gmail (`urlGmail`), là où il se traite.
  const messages = SOURCES.flatMap((f) =>
    adressesEcrites(f).filter((a) => a.section === 'messages').map((a) => `${f}:${a.ligne}`),
  )
  assert.deepEqual(
    messages,
    [],
    '`#/messages` n’a pas de route et n’en aura pas avant B.15 : une alerte qui pointe dessus est un cul-de-sac silencieux',
  )
}

// ============================================================
// 2. Aucun window.prompt (ni confirm, ni alert) dans src/modules/
// ============================================================
//
// Le dépôt a ses propres remplaçants : `confirmer()` (modale accessible,
// ui.tsx) et le champ en ligne / popover pour une saisie. Ce qui est refusé
// ici, ce sont les boîtes natives — y compris appelées sans `window.`

const NATIVES = new Set(['prompt', 'confirm', 'alert'])

/** les appels aux boîtes natives du navigateur, vus par le compilateur */
function boitesNatives(chemin) {
  const trouvees = []
  const sf = arbre(chemin)
  const parcourir = (n) => {
    if (ts.isCallExpression(n)) {
      const appele = n.expression
      // `window.prompt(...)` / `globalThis.confirm(...)`
      if (
        ts.isPropertyAccessExpression(appele) &&
        ts.isIdentifier(appele.expression) &&
        ['window', 'globalThis', 'self'].includes(appele.expression.text) &&
        NATIVES.has(appele.name.text)
      ) {
        trouvees.push({ nom: `${appele.expression.text}.${appele.name.text}`, ligne: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 })
      }
      // `prompt(...)` tout court — le même défaut, sans le préfixe
      if (ts.isIdentifier(appele) && NATIVES.has(appele.text)) {
        trouvees.push({ nom: appele.text, ligne: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 })
      }
    }
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)
  return trouvees
}

{
  const modules = SOURCES.filter((f) => f.startsWith('src/modules/'))
  assert.ok(modules.length > 30, 'src/modules/ contient les écrans : le balayage doit tous les voir')

  const restes = modules.flatMap((f) => boitesNatives(f).map((b) => `${f}:${b.ligne} → ${b.nom}()`))
  assert.deepEqual(
    restes,
    [],
    'boîte native du navigateur dans un écran : elle bloque l’onglet, n’accepte aucun format, ne laisse aucun « Annuler » et ne se teste pas. Le dépôt a `confirmer()` (ui.tsx) et le champ en ligne :\n  ' +
      restes.join('\n  '),
  )

  // et le remplaçant EXISTE, sinon l'interdit ci-dessus n'est qu'un vœu
  assert.match(
    lire('src/ui.tsx'),
    /export (async )?function confirmer/,
    'la modale de confirmation du dépôt doit exister : interdire `confirm()` sans donner son remplaçant reviendrait à interdire le geste',
  )
}

// ============================================================
// 3. Une alerte de gravité 3 atterrit sur l'élément
// ============================================================
//
// Troisième critère du §5.2 — celui qui n'est PAS encore à zéro. On l'écrit
// donc comme `test-tableaux.cjs` écrit son inventaire : la liste ci-dessous
// ne PERMET pas, elle CONSTATE. Elle ne peut que rétrécir. Retirer une entrée
// est une bonne nouvelle qui fait tomber le test, et c'est voulu : c'est
// comme ça qu'on saura que le compte est bon.
//
// Est réputée « atterrir » une alerte qui porte soit une action inline (le
// geste se fait sans quitter l'accueil), soit un lien portant un identifiant
// (gabarit `#/…/${id}`) ou une URL externe (le fil Gmail).

const DEPOSENT_EN_HAUT_DUNE_LISTE = new Set([
  // ─── RETIRÉE le 06/08/2026 : `facture_retard` ────────────────────────
  // C'est la bonne nouvelle que le commentaire ci-dessus annonçait, et
  // l'inventaire est tombé dessus comme prévu. L'alerte d'impayé — la plus
  // fréquente du fil — déposait devant la liste entière : il fallait
  // retrouver la facture à la main, tous les jours. Le lot A lui a donné
  // `#/facturation/chercher/${numero}` (alerts.ts), qui se dépose dans le
  // champ de recherche de la liste : la ligne visée est la seule affichée.
  // La destination existait depuis la semaine passée ; c'est le lien qui
  // manquait. Un seul chemin, aucune route nouvelle.
  //
  // « contrat à revoir » : `#/agenda/contrats/${id}` EXISTE depuis le
  // câblage des routes ; l'alerte ne porte pas encore l'identifiant.
  'contrat_renouvellement',
  // « situation attendue non reçue » : mène à l'onglet Attendues, qui ne
  // contient que les situations attendues — l'écart est faible.
  'situation_manquante',
])

/**
 * Les gravités qu'une expression peut rendre.
 *
 * Une gravité s'écrit de trois façons dans `alerts.ts` : un nombre
 * (`gravite: 1`), une cascade de ternaires (`dj < 0 ? 3 : dj <= 7 ? 3 : 2`),
 * ou un calcul délégué à une autorité (`graviteDe(m.importance)`,
 * `attente.gravite`). Les deux premières se lisent ; la troisième ne se lit
 * pas d'ici — et on la traite alors comme POUVANT valoir 3. Le sens du doute
 * compte : supposer qu'une alerte déléguée n'est jamais rouge la ferait
 * sortir du contrôle en silence, ce qui est exactement le défaut visé.
 */
function graviteesPossibles(expr) {
  if (ts.isParenthesizedExpression(expr)) return graviteesPossibles(expr.expression)
  if (ts.isNumericLiteral(expr)) return [Number(expr.text)]
  if (ts.isConditionalExpression(expr)) {
    return [...graviteesPossibles(expr.whenTrue), ...graviteesPossibles(expr.whenFalse)]
  }
  return ['calculée ailleurs']
}

/** les alertes déclarées par alerts.ts, lues dans l'arbre */
function alertesDeclarees() {
  const sf = arbre('src/alerts.ts')
  const trouvees = []
  const parcourir = (n) => {
    if (ts.isObjectLiteralExpression(n)) {
      const champs = new Map()
      for (const p of n.properties) {
        if (ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name)) champs.set(p.name.text, p.initializer)
      }
      if (champs.has('gravite') && champs.has('lien') && champs.has('type')) {
        const lien = champs.get('lien')
        trouvees.push({
          type: champs.get('type').getText().replace(/'/g, ''),
          gravites: graviteesPossibles(champs.get('gravite')),
          ligne: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          action: champs.has('action'),
          // un identifiant dans l'adresse (`#/projets/${id}`), ou une adresse
          // calculée — le fil Gmail, qui atterrit sur le message lui-même
          lienIdentifie: !ts.isStringLiteral(lien),
        })
      }
    }
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)
  return trouvees
}

{
  const alertes = alertesDeclarees()
  assert.ok(alertes.length >= 18, `le fil d’urgences déclare ${alertes.length} alertes : le balayage doit toutes les voir`)

  // « peut valoir 3 » : une branche rend 3, ou la gravité est déléguée
  const rouges = alertes.filter((a) => a.gravites.some((g) => g === 3 || typeof g === 'string'))
  assert.ok(rouges.length >= 10, 'une bonne moitié des alertes peuvent virer au rouge')
  assert.ok(
    alertes.some((a) => a.gravites.every((g) => g === 1 || g === 2)),
    'et d’autres ne le peuvent pas : si TOUTES étaient réputées rouges, l’inventaire ne dirait plus rien',
  )

  const sansAtterrissage = rouges
    .filter((a) => !a.action && !a.lienIdentifie)
    .map((a) => a.type)
    .sort()
  const attendu = [...DEPOSENT_EN_HAUT_DUNE_LISTE].sort()

  assert.deepEqual(
    [...new Set(sansAtterrissage)],
    attendu,
    'INVENTAIRE des alertes rouges qui déposent encore en haut d’une liste (§5.2, critère 3).\n' +
      '  · une entrée EN TROP = une alerte rouge a perdu son geste ou son identifiant : le clic ne mène plus à l’élément ;\n' +
      '  · une entrée MANQUANTE = bonne nouvelle, l’alerte a été réparée — retirez-la de DEPOSENT_EN_HAUT_DUNE_LISTE.\n' +
      `  constaté : [${[...new Set(sansAtterrissage)].join(', ')}]`,
  )

  // et l'acquis correspondant : toutes les autres rouges atterrissent bien
  const atterrissent = rouges.filter((a) => a.action || a.lienIdentifie).map((a) => a.type)
  assert.ok(
    atterrissent.length >= 7,
    'la majorité des alertes rouges portent déjà leur geste ou leur identifiant — c’est l’acquis que l’inventaire protège',
  )
  // `facture_retard` vient de rejoindre cette liste : elle sortait de
  // l'inventaire ci-dessus, elle entre ici. Un acquis qui n'est pas nommé se
  // reperd sans bruit — et celui-ci est le plus fréquent du fil.
  for (const type of ['echeance_rendu', 'situation_a_verifier', 'visa_a_rendre', 'cr_en_attente', 'note_honoraires_manquante', 'facture_retard']) {
    assert.ok(
      atterrissent.includes(type),
      `l’alerte « ${type} » atterrissait sur son élément : elle ne doit pas redevenir un dépôt en haut de liste`,
    )
  }
}

// --- 4. un lien à identifiant DOIT avoir une porte, et elle est nommée ------
//
// POURQUOI CE CONTRÔLE EXISTE, ET CE QU'IL RÉPARE
// ------------------------------------------------
// Le critère `lienIdentifie` ci-dessus juge une alerte « atterrie » sur un
// seul fait : son lien est un gabarit plutôt qu'une chaîne littérale. C'est
// une propriété de l'ÉMETTEUR. Elle ne dit rien du DESTINATAIRE.
//
// Ce n'est pas une critique théorique : une vérification du 06/08/2026 a
// trouvé que `#/situations/verifier/${sit.id}` était émis depuis des semaines
// et lu par personne — `Situations.tsx` n'inspectait `route[2]` que pour y
// chercher le mot « chercher », et ignorait un identifiant en silence.
// L'alerte « situation à vérifier » déposait donc en haut de la liste non
// filtrée, exactement le défaut T6 qu'on croyait fermé. Le test, lui, était
// vert : il regardait la forme du lien, et la forme était bonne.
//
// Un test qui valide l'émission d'une adresse sans vérifier qu'elle mène
// quelque part ne mesure rien. Pire : il rassure.
//
// CE QUE CE CONTRÔLE PEUT, ET CE QU'IL NE PEUT PAS
// -------------------------------------------------
// Prouver statiquement qu'un écran « traite correctement » un segment de
// route demanderait de comprendre sa sémantique — hors de portée d'une
// analyse d'arbre, et une heuristique s'y tromperait en silence (c'est
// précisément ce qu'on répare). On applique donc le patron déjà éprouvé par
// l'inventaire de `test-tableaux.cjs` : la porte est NOMMÉE à la main, et
// l'inventaire se compare à la réalité DANS LES DEUX SENS.
//
//   · une famille de lien qui apparaît dans alerts.ts sans être inventoriée
//     ⇒ échec : personne n'a dit où elle atterrit ;
//   · une famille inventoriée qui a disparu d'alerts.ts ⇒ échec : l'entrée
//     est périmée et couvrirait n'importe quoi ;
//   · une porte dont la preuve n'est plus dans le fichier consommateur
//     ⇒ échec : quelqu'un a retiré la lecture, le lien est redevenu mort.
//
// Ce n'est pas une preuve de correction. C'est l'impossibilité d'ajouter un
// lien à identifiant sans que quelqu'un désigne le code qui le lit — et
// l'alarme le jour où ce code disparaît.

// UNE PORTE PEUT AVOIR PLUSIEURS MAILLONS, et la tranche 3 l'a rendu
// nécessaire — pas par élégance, parce que sans ça ce contrôle serait devenu
// FAUX SANS ÉCHOUER, exactement le défaut qu'il existe pour fermer.
//
// Avant la tranche 3, `#/situations/verifier/<id>` était découpée ET consommée
// dans Situations.tsx : un fichier, une preuve. Depuis, `case 'situations'`
// monte `<Entreprises />` — c'est Entreprises.tsx qui découpe le segment, et
// Situations.tsx qui met la ligne en évidence à l'arrivée. Or Situations.tsx
// contient toujours le mot « cibleId » (c'est la prop de sa carte) : l'entrée
// d'origine restait donc VERTE en désignant un fichier qui ne lit plus
// l'adresse. Le contrôle aurait continué de rassurer alors que le maillon
// neuf — le découpage, celui qui peut disparaître d'un refactor — n'était
// surveillé par personne.
//
// La chaîne est donc écrite en entier : `route` → segment lu → geste à
// l'arrivée. Chaque maillon nommé, chacun vérifié.
const PORTES_ATTENDUES = {
  // `#/projets/<id>` et `#/projets/<id>/<onglet>` — six alertes s'y rendent
  projets: [['src/modules/Projets.tsx', 'const id = route[1]', 'découpe et ouvre la fiche']],
  // `#/facturation/chercher/<terme>` — le terme se dépose dans la recherche
  facturation: [['src/modules/Facturation.tsx', "route[1] === 'chercher'", 'découpe et pré-remplit la recherche']],
  // `#/situations/verifier/<id>` — LA porte qui manquait le 06/08/2026, et qui
  // a DÉMÉNAGÉ à la tranche 3 sans que l'alerte change d'un caractère
  situations: [
    [
      'src/modules/Entreprises.tsx',
      "const idRoute = segments[1] && segments[1] !== 'chercher' ? segments[1] : ''",
      'découpe l’identifiant de l’ancienne adresse, servie par le nouvel endroit',
    ],
    [
      'src/modules/Situations.tsx',
      'cibleId',
      'met la ligne en évidence et la ramène à l’écran (la carte, montée en repli par Entreprises)',
    ],
  ],
  // `#/finance/banque/<id>` — la connexion bancaire visée par l'alerte
  finance: [['src/modules/Banque.tsx', 'cibleConnexion', 'découpe et met en évidence la connexion']],
  // `#/ressources/artisan/<id>` — la fiche entreprise, pas l'annuaire entier
  ressources: [
    ['src/modules/Ressources.tsx', "route[1] === 'artisan' && route[2]", 'découpe et ouvre la fiche'],
  ],
}

{
  // les familles réellement émises, lues dans l'arbre : on ne cherche que les
  // gabarits (`lien: \`#/…\``), puisqu'une chaîne littérale ne porte par
  // construction aucun identifiant
  const sf = ts.createSourceFile(
    'src/alerts.ts',
    lire('src/alerts.ts'),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  )
  const familles = new Set()
  const parcourir = (n) => {
    if (
      ts.isPropertyAssignment(n) &&
      n.name.getText(sf) === 'lien' &&
      ts.isTemplateExpression(n.initializer)
    ) {
      const debut = n.initializer.head.text // ex. « #/situations/verifier/ »
      const segments = debut.replace(/^#\//, '').split('/').filter(Boolean)
      if (segments.length) familles.add(segments[0])
    }
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)

  assert.ok(
    familles.size >= 4,
    `le balayage n’a trouvé que ${familles.size} famille(s) de lien à identifiant dans alerts.ts : ` +
      'la lecture de l’arbre est cassée, et ce contrôle validerait à vide.',
  )

  assert.deepEqual(
    [...familles].sort(),
    Object.keys(PORTES_ATTENDUES).sort(),
    'INVENTAIRE des familles de liens d’alerte portant un identifiant.\n' +
      '  · une famille EN TROP = un lien à identifiant a été ajouté sans qu’on dise où il atterrit.\n' +
      '    Ajoutez-la à PORTES_ATTENDUES avec le fichier qui la lit ET la preuve — après avoir VÉRIFIÉ\n' +
      '    dans ce fichier qu’il lit vraiment le segment. C’est ce contrôle-là qui a manqué le 06/08.\n' +
      '  · une famille MANQUANTE = l’entrée est périmée : retirez-la, sinon elle couvre le vide.',
  )

  let maillons = 0
  for (const [famille, chaine] of Object.entries(PORTES_ATTENDUES)) {
    assert.ok(
      Array.isArray(chaine) && chaine.length > 0,
      `PORTES_ATTENDUES.${famille} doit être une chaîne de maillons [[fichier, preuve, rôle], …].`,
    )
    for (const [fichier, preuve, role] of chaine) {
      maillons++
      assert.ok(role, `le maillon ${fichier} de « #/${famille}/… » ne dit pas ce qu’il fait.`)
      assert.ok(
        fs.existsSync(path.join(racine, fichier)),
        `${fichier} est désigné comme un maillon de la porte de « #/${famille}/… » mais n’existe plus.`,
      )
      assert.ok(
        lire(fichier).includes(preuve),
        `PORTE PERDUE — « #/${famille}/<identifiant> » est encore émis par src/alerts.ts, mais\n` +
          `  ${fichier} ne contient plus « ${preuve} ».\n` +
          `  Ce maillon ${role} : sans lui, l’identifiant voyage et personne ne le lit.\n` +
          '  Le lien est redevenu un dépôt en haut d’une liste, en silence — c’est exactement le\n' +
          '  défaut du 06/08/2026, où l’alerte « situation à vérifier » pointait dans le vide\n' +
          '  pendant que ce test restait vert.\n' +
          (chaine.length > 1
            ? `  Cette porte a ${chaine.length} maillons parce que son contenu a DÉMÉNAGÉ : le fichier qui\n` +
              '  découpe l’adresse n’est plus celui qui affiche le résultat. Les deux se vérifient, sinon\n' +
              '  le maillon restant suffirait à garder le test vert.\n'
            : '') +
          '  Si la lecture a simplement changé de forme ou de fichier, mettez la preuve à jour APRÈS\n' +
          '  avoir vérifié qu’une porte existe encore.',
      )
    }
  }

  console.log(
    `Portes des liens d’alerte : ${familles.size} familles à identifiant et ${maillons} maillons, chacun avec ` +
      'le fichier qui le porte et la preuve de sa lecture — un lien nouveau ne peut plus être ajouté sans ' +
      'porte, et un contenu qui déménage ne peut plus laisser derrière lui une porte qui semble tenue.',
  )
}

console.log(
  `Critères mécaniques du §5.2 : ${SOURCES.length} fichiers lus par le compilateur — aucune adresse interne ` +
    'hors du routeur (« #/messages » compris), aucune boîte native du navigateur dans les écrans, et ' +
    `${DEPOSENT_EN_HAUT_DUNE_LISTE.size} alertes rouges recensées comme déposant encore en haut d’une liste (liste qui ne peut que rétrécir).`,
)
