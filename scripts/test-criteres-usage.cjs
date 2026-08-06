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

console.log(
  `Critères mécaniques du §5.2 : ${SOURCES.length} fichiers lus par le compilateur — aucune adresse interne ` +
    'hors du routeur (« #/messages » compris), aucune boîte native du navigateur dans les écrans, et ' +
    `${DEPOSENT_EN_HAUT_DUNE_LISTE.size} alertes rouges recensées comme déposant encore en haut d’une liste (liste qui ne peut que rétrécir).`,
)
