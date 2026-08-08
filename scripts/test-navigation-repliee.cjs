// Refonte de la navigation, tranche 2 — CE QUI EST REPLIÉ DOIT RESTER TROUVABLE,
// ET AUCUNE ADRESSE NE DOIT CESSER DE RÉPONDRE.
//
// LE DÉFAUT QUE CE FICHIER FERME
// ==========================================================================
// La tranche 2 met onze des seize entrées de menu dans un groupe « Agence »
// fermé. Le plan l'annonce comme une amélioration, et c'en est une — mais il
// nomme lui-même la condition, réserve n°6 du §7 :
//
//     « Pas de confiance aveugle dans la recherche. Replier suppose de
//     retrouver. La palette « / » n'indexe pas encore tout ce qu'on s'apprête
//     à replier : chaque tranche doit vérifier que ce qu'elle replie reste
//     trouvable, sans quoi « replié » veut dire « perdu ». »
//
// C'est la seule réserve qui pourrait rendre cette tranche NUISIBLE plutôt
// qu'utile. Avant la tranche 2, la palette n'indexait que des OBJETS — un
// projet, une tâche, un document, une entreprise — et AUCUN écran : taper
// « automatisations » ne rendait rien. Replier onze destinations dans ces
// conditions, ce n'était pas les ranger, c'était les perdre.
//
// Deux moitiés, donc, et elles ne valent que prises ensemble :
//
//   · scripts/test-surface.cjs compte ce qui DISPARAÎT DE LA VUE (16 entrées
//     déclarées, 5 visibles) — c'est le gain ;
//   · ce fichier vérifie que ce qui disparaît RESTE ATTEIGNABLE — par la
//     recherche « / », et par son adresse.
//
// Le premier sans le second mesurerait une simplification qui est peut-être
// une amputation.
//
// CE QUI EXISTE DÉJÀ AILLEURS, ET QU'ON NE REFAIT PAS
// ==========================================================================
// `test-criteres-usage.cjs` §1 lit tous les littéraux `'#/…'` de src/ et
// vérifie qu'ils visent une section que le `switch` d'App.tsx route. C'est le
// sens LIEN → ROUTE, et il couvre déjà les dix-sept liens d'écran de la
// palette, qui sont des littéraux.
//
// Il ne peut PAS couvrir deux choses, et ce sont exactement les deux ici :
//
//   1. LES ENTRÉES DE MENU. Elles s'écrivent `href={`#/${it.path}`}` : pour
//      l'analyse d'arbre, la tête du gabarit vaut « #/ » et la section lue est
//      la chaîne vide. Une entrée de menu pointant une route morte passerait
//      donc au vert. C'est le contrôle n°2 ci-dessous.
//   2. UNE ROUTE QUI DISPARAÎT AVEC SES LIENS. Si le `case` et le dernier lien
//      qui le visait partent dans le même commit, le sens LIEN → ROUTE reste
//      vert : il n'y a plus de lien à valider. Or l'adresse, elle, était en
//      favori, dans une alerte déjà envoyée, dans un signet du navigateur, et
//      elle retombe désormais sur l'accueil SANS UN MOT. C'est le contrôle
//      n°1 : l'inventaire des routes servies, comparé dans les deux sens.
//
// Le patron est celui de `test-tableaux.cjs` et de `PORTES_ATTENDUES` : une
// liste écrite à la main, confrontée à la réalité DANS LES DEUX SENS. Une
// entrée manquante est un défaut, une entrée périmée aussi — sans quoi
// l'inventaire finit par couvrir le vide.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')
const arbre = (f) =>
  ts.createSourceFile(f, lire(f), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)

const APP = arbre('src/App.tsx')
const SOURCE_PALETTE = lire('src/modules/RechercheOverlay.tsx')

const litteral = (noeud, sf) => noeud.getText(sf).replace(/^['"`]|['"`]$/g, '')
const champ = (objet, nom, sf) =>
  objet.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === nom)

// ==========================================================================
// Lecture du code — le compilateur, jamais une expression régulière
// ==========================================================================

/** le `switch (section)` d'App.tsx : chaque `case`, et les écrans qu'il monte */
function routesServies() {
  const trouvees = new Map()
  const visiter = (n) => {
    if (ts.isSwitchStatement(n) && n.expression.getText(APP) === 'section') {
      for (const c of n.caseBlock.clauses) {
        // on s'arrête aux `case` : le `default` n'est pas une adresse, il est
        // le filet qui rattrape tout le reste (y compris `#/AAAA-MM-JJ`)
        if (!ts.isCaseClause(c)) continue
        const composants = new Set()
        const w = (x) => {
          if (ts.isJsxOpeningElement(x) || ts.isJsxSelfClosingElement(x))
            composants.add(x.tagName.getText(APP))
          ts.forEachChild(x, w)
        }
        c.statements.forEach(w)
        trouvees.set(litteral(c.expression, APP), composants)
      }
    }
    ts.forEachChild(n, visiter)
  }
  visiter(APP)
  return trouvees
}

/** le tableau `NAV` : groupes, repli, entrées */
function groupesDeNav() {
  const groupes = []
  const visiter = (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'NAV' &&
      n.initializer &&
      ts.isArrayLiteralExpression(n.initializer)
    ) {
      for (const g of n.initializer.elements) {
        if (!ts.isObjectLiteralExpression(g)) continue
        const nom = champ(g, 'groupe', APP)
        const repliable = champ(g, 'repliable', APP)
        const items = champ(g, 'items', APP)
        const entrees = []
        if (items && ts.isArrayLiteralExpression(items.initializer)) {
          for (const it of items.initializer.elements) {
            if (!ts.isObjectLiteralExpression(it)) continue
            const p = champ(it, 'path', APP)
            const l = champ(it, 'label', APP)
            if (p && l) entrees.push({ path: litteral(p.initializer, APP), label: litteral(l.initializer, APP) })
          }
        }
        groupes.push({
          groupe: nom ? litteral(nom.initializer, APP) : '(sans nom)',
          repliable: !!repliable && repliable.initializer.getText(APP) === 'true',
          items: entrees,
        })
      }
    }
    ts.forEachChild(n, visiter)
  }
  visiter(APP)
  return groupes
}

/** la table `ALIAS_SECTION` : l'adresse « en passant » → l'entrée qu'elle allume */
function aliasSection() {
  const table = new Map()
  const visiter = (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'ALIAS_SECTION' &&
      n.initializer &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      for (const p of n.initializer.properties) {
        if (ts.isPropertyAssignment(p))
          table.set(p.name.getText(APP).replace(/^['"`]|['"`]$/g, ''), litteral(p.initializer, APP))
      }
    }
    ts.forEachChild(n, visiter)
  }
  visiter(APP)
  return table
}

/** le tableau `ECRANS` de la palette « / » — l'index des destinations */
function ecransIndexes() {
  const sf = arbre('src/modules/RechercheOverlay.tsx')
  // les constantes de module (`DANS_MENU`, `DANS_AGENCE`) : `detail` s'écrit
  // parfois `${DANS_MENU} · accueil`, et lire le texte brut du gabarit rendrait
  // le nom de la constante au lieu de ce que la personne voit
  const constantes = new Map()
  const collecter = (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))
    )
      constantes.set(n.name.text, n.initializer.text)
    ts.forEachChild(n, collecter)
  }
  collecter(sf)

  const texteDe = (noeud) => {
    if (ts.isStringLiteral(noeud) || ts.isNoSubstitutionTemplateLiteral(noeud)) return noeud.text
    if (ts.isIdentifier(noeud)) return constantes.has(noeud.text) ? constantes.get(noeud.text) : null
    if (ts.isTemplateExpression(noeud)) {
      let out = noeud.head.text
      for (const span of noeud.templateSpans) {
        const v = texteDe(span.expression)
        if (v === null) return null
        out += v + span.literal.text
      }
      return out
    }
    return null
  }

  const ecrans = []
  const visiter = (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'ECRANS' &&
      n.initializer &&
      ts.isArrayLiteralExpression(n.initializer)
    ) {
      for (const e of n.initializer.elements) {
        if (!ts.isObjectLiteralExpression(e)) continue
        const val = (cle) => {
          const p = champ(e, cle, sf)
          return p ? texteDe(p.initializer) : null
        }
        ecrans.push({
          titre: val('titre'),
          detail: val('detail'),
          lien: val('lien'),
          mots: val('mots'),
          ligne: sf.getLineAndCharacterOfPosition(e.getStart(sf)).line + 1,
        })
      }
    }
    ts.forEachChild(n, visiter)
  }
  visiter(sf)
  return ecrans
}

const ROUTES = routesServies()
const GROUPES = groupesDeNav()
const ENTREES = GROUPES.flatMap((g) => g.items.map((i) => ({ ...i, groupe: g.groupe, repliee: g.repliable })))
const REPLIEES = ENTREES.filter((e) => e.repliee)
const ALIAS = aliasSection()
const ECRANS = ecransIndexes()

// Un test qui ne voit rien passe toujours — le mode de panne que toute cette
// refonte répare est la mesure absente, pas la mesure fausse.
assert.ok(ROUTES.size > 20, `le \`switch (section)\` d’App.tsx ne rend que ${ROUTES.size} routes : la lecture est cassée`)
assert.ok(ENTREES.length >= 10, `\`NAV\` ne rend que ${ENTREES.length} entrées : la lecture est cassée`)
assert.ok(ALIAS.size >= 5, `\`ALIAS_SECTION\` ne rend que ${ALIAS.size} entrées : la lecture est cassée`)
assert.ok(ECRANS.length >= 10, `\`ECRANS\` (palette « / ») ne rend que ${ECRANS.length} écrans : la lecture est cassée`)
for (const e of ECRANS) {
  assert.ok(
    e.titre && e.lien && e.detail !== null && e.mots !== null,
    `src/modules/RechercheOverlay.tsx:${e.ligne} — écran indexé illisible (titre=${e.titre}, lien=${e.lien}).\n` +
      'Une entrée que ce contrôle ne sait pas lire sortirait de l’inventaire en silence, et c’est ' +
      'précisément l’inventaire qui garantit qu’un écran replié reste trouvable.',
  )
}

// ==========================================================================
// CONTRÔLE N°1 — AUCUNE ROUTE PERDUE
// ==========================================================================
//
// « Toutes les ROUTES restent valides — les liens existants, les alertes, les
// favoris et la palette « / » doivent continuer de fonctionner exactement
// comme avant. Une route qui cesse de répondre est une régression, pas une
// simplification. »
//
// Une route qui disparaît ne PLANTE pas : `default: page = <Cockpit />`. On
// clique sur un favori, on arrive sur l'accueil, on croit avoir mal cliqué, on
// recommence. Aucun message, aucune trace, et le défaut survit des mois.
//
// L'inventaire ci-dessous fige les vingt-neuf adresses qui répondaient avant la
// tranche 2. Il dit pour chacune QUI l'atteint — c'est la partie utile : une
// route dont personne ne sait plus dire qui s'en sert est une route qu'on
// supprimera par erreur.
//
// Il se lit dans les deux sens :
//   · une clé sans `case` = une adresse qui a cessé de répondre ;
//   · un `case` sans clé = une route ajoutée sans décision. Le compteur de
//     surface ne la voit PAS (il compte `NAV` et les jeux d'onglets, pas les
//     `case`) : sans cet inventaire, une destination neuve peut naître sans
//     rien déclencher, ce qui est très exactement l'histoire des 75 endroits.

const ROUTES_SERVIES = {
  '': 'La semaine (accueil). Le filtre de jour `#/AAAA-MM-JJ` n’est PAS une route de plus : il tombe dans le `default`, qui remonte le même écran.',
  taches: 'Mes tâches — repliée. Porte de `#/taches/<id>` (la palette ouvre la fiche, pas la liste).',
  parite: 'Écran d’exploitation B.18, hors menu depuis toujours : atteignable par son adresse seule, et il disparaîtra avec B.15.',
  revue: 'Pilotage, onglet Revue — arrivée « en passant » (ALIAS_SECTION).',
  analyse: 'Pilotage, onglet Missions — arrivée « en passant » (ALIAS_SECTION).',
  pilotage: 'Pilotage — repliée.',
  automatisations: 'Automatisations — repliée.',
  demarrer: 'Paramètres, onglet Bien démarrer — arrivée « en passant » (ALIAS_SECTION).',
  projets: 'Projets — ancre visible. Porte de `#/projets/<id>[/<onglet>]`, visée par six alertes.',
  situations: 'Situations — repliée. Porte de `#/situations/verifier/<id>` (alerte « situation à vérifier »). La tranche 3 en fera une vue d’Entreprises : la ROUTE survivra à la destination.',
  entreprises: 'Entreprises — visible. `#/entreprises/<clé>` ouvre la fiche en page.',
  facturation: 'Facturation — porte de `#/facturation/chercher/<numéro>` (alerte d’impayé, la plus fréquente du fil).',
  contrats: 'Contrats clients — atteinte depuis Finance ; le menu Finance l’allume par ALIAS_SECTION.',
  finance: 'Finance et ses neuf vues (`#/finance/<vue>`) — visible. `#/finance/banque/<id>` vise une connexion bancaire.',
  temps: 'Temps — repliée.',
  developpement: 'Développement, onglet Pipeline — arrivée « en passant » (ALIAS_SECTION).',
  ao: 'Développement — visible. `#/ao/consultations/<id>` ouvre la fiche de consultation.',
  references: 'Développement, onglet Références — arrivée « en passant » (ALIAS_SECTION).',
  prompts: 'Automatisations, ancienne adresse — encore écrite dans des gabarits (`tpl-classement-batch`).',
  routines: 'Automatisations, onglet Routines — arrivée « en passant » (ALIAS_SECTION).',
  ressources: 'Annuaire — repliée. Porte de `#/ressources/artisan/<id>` et `#/ressources/contacts/<id>`.',
  agenda: 'Échéances agence — repliée. Porte de `#/agenda/contrats/<id>`.',
  parametres: 'Paramètres — pied du menu, jamais replié : c’est là qu’on répare quand ça tombe en panne (§7.5).',
  sante: 'Santé des données (Paramètres, onglet Branchements) — cible du bouton de statut du pied de menu.',
  calendrier: 'Planning, onglet Échéances — arrivée « en passant » (ALIAS_SECTION).',
  planning: 'Planning — repliée.',
  assistant: 'Assistant — replié.',
  documents: 'Documents — repliée. Porte de `#/documents/tous/<id>` (la palette ouvre la fiche du document).',
  propositions: 'Propositions IA — repliée. Cible de l’alerte agrégée de l’accueil, en gravité 1.',
}

assert.deepEqual(
  [...ROUTES.keys()].sort(),
  Object.keys(ROUTES_SERVIES).sort(),
  'INVENTAIRE DES ROUTES SERVIES par le `switch (section)` d’App.tsx.\n' +
    '  · une route MANQUANTE = une adresse a cessé de répondre. Elle ne plante pas : le `default` remonte\n' +
    '    l’accueil, en silence. Les favoris, les alertes déjà envoyées et les liens de la palette qui la\n' +
    '    visaient atterrissent donc au mauvais endroit sans qu’un mot le dise. Si l’écran a vraiment\n' +
    '    disparu, GARDEZ LA ROUTE et faites-la mener là où le contenu a déménagé — c’est la règle de la\n' +
    '    refonte : « rien n’est supprimé, on replie, on regroupe ».\n' +
    '  · une route EN TROP = une destination neuve. Le plafond de surface ne la voit pas (il compte `NAV`\n' +
    '    et les onglets, pas les `case`) : déclarez-la ici, en disant QUI l’atteint. « Il fallait bien le\n' +
    '    mettre quelque part » est le raisonnement qui a produit les 75 endroits.',
)

// ==========================================================================
// CONTRÔLE N°2 — CHAQUE ENTRÉE DE MENU MÈNE QUELQUE PART
// ==========================================================================
//
// Le §1 de test-criteres-usage.cjs ne peut pas le voir : l'entrée s'écrit
// `href={`#/${it.path}`}`, et la tête du gabarit vaut « #/ ». Une entrée de
// menu qui pointe une route morte y passerait au vert — et c'est l'entrée la
// plus visible de l'outil.

for (const e of ENTREES) {
  assert.ok(
    ROUTES.has(e.path),
    `L’entrée de menu « ${e.label} » mène à « #/${e.path} », qu’aucun \`case\` d’App.tsx ne route.\n` +
      'Le clic retombe sur l’accueil sans un mot : la ligne du menu reste, l’écran ne vient jamais.\n' +
      'C’est le pire des liens morts, parce que celui-là est affiché en permanence.',
  )
}

// ==========================================================================
// CONTRÔLE N°3 — CE QUI EST REPLIÉ RESTE TROUVABLE
// ==========================================================================
//
// L'inventaire est la liste `ECRANS` de la palette, confrontée à `NAV` dans
// les DEUX sens :
//   · une destination du menu absente de la palette = elle n'est trouvable que
//     par le menu. Repliée, elle devient invisible ET introuvable ;
//   · un écran indexé qui ne correspond à aucune destination = entrée périmée.
//     Elle mène quelque part, mais plus au menu : le `detail` qu'elle affiche
//     (« groupe Agence ») envoie chercher un bouton qui n'existe plus.
//
// L'exception est déclarée, pas tolérée en silence.

const INDEXES_HORS_MENU = {
  // Paramètres n'est pas dans `NAV` : il vit dans le pied de la barre latérale,
  // avec le statut des données. Il est indexé quand même — c'est l'écran de
  // secours (§7.5), celui qu'on cherche justement quand plus rien ne marche.
  '#/parametres': 'Paramètres — pied du menu, jamais replié (§7.5)',
}

{
  const attendus = new Map(ENTREES.map((e) => [`#/${e.path}`, e]))
  const indexes = new Map(ECRANS.map((e) => [e.lien, e]))

  assert.deepEqual(
    [...indexes.keys()].sort(),
    [...new Set([...attendus.keys(), ...Object.keys(INDEXES_HORS_MENU)])].sort(),
    'INVENTAIRE DES ÉCRANS INDEXÉS PAR LA PALETTE « / » (réserve n°6 du plan, §7).\n' +
      '  · une destination du menu MANQUANTE de `ECRANS` (src/modules/RechercheOverlay.tsx) : si elle est\n' +
      '    repliée, elle est désormais invisible ET introuvable — « replié » vient de vouloir dire\n' +
      '    « perdu », et la tranche 2 a dégradé l’outil au lieu de l’améliorer. Ajoutez-la, avec ses\n' +
      '    synonymes : on cherche avec le mot qu’on a en tête, pas avec le libellé du menu.\n' +
      '  · un écran indexé EN TROP : soit il vient de quitter le menu (déclarez-le dans\n' +
      '    INDEXES_HORS_MENU, avec la raison), soit l’entrée est périmée et son `detail` envoie chercher\n' +
      '    un bouton de menu qui n’existe plus.',
  )

  // le libellé doit être LE MÊME des deux côtés : on cherche l'écran avec le
  // mot qu'on a vu dans le menu, et deux noms pour un même écran, c'est deux
  // fois où l'on ne trouve pas
  for (const [lien, entree] of attendus) {
    assert.equal(
      indexes.get(lien).titre,
      entree.label,
      `L’écran « #${lien.slice(1)} » s’appelle « ${entree.label} » dans le menu et ` +
        `« ${indexes.get(lien).titre} » dans la recherche.\n` +
        'On cherche un écran avec le mot qu’on a lu dans le menu. Deux noms pour un même écran, c’est ' +
        'deux fois où l’on ne trouve pas.',
    )
  }

  // et le `detail` dit OÙ l'écran vit : c'est ce qui fait que la palette
  // APPREND le repli au lieu de le contourner — la fois d'après, on sait quel
  // bouton ouvrir. Un écran replié dont la palette ne dit pas le groupe se
  // cherchera indéfiniment par la palette.
  for (const e of ENTREES) {
    const detail = indexes.get(`#/${e.path}`).detail
    if (e.repliee) {
      assert.ok(
        detail.includes(e.groupe),
        `« ${e.label} » est repliée dans le groupe « ${e.groupe} », mais la palette annonce ` +
          `« ${detail} ».\n` +
          'La palette doit dire OÙ l’écran vit, sinon elle contourne le repli au lieu de l’apprendre : ' +
          'on retrouvera l’écran, et on continuera de ne jamais savoir où est son bouton.',
      )
    } else {
      assert.ok(
        !/repli/i.test(detail),
        `« ${e.label} » est une entrée VISIBLE du menu, mais la palette la dit repliée ` +
          `(« ${detail} »).\n` +
          'Un écran qu’on annonce replié alors qu’il est sous les yeux fait douter du reste de la palette.',
      )
    }
  }
}

// --- 3b. la recherche par le NOM, telle qu'elle se comporte vraiment --------
//
// Vérifier que le libellé figure dans `ECRANS` ne prouve rien : encore
// faut-il que la frappe le fasse REMONTER, et remonter EN PREMIER — c'est le
// résultat qu'ouvre la touche Entrée.
//
// La règle de tri est donc rejouée ici, à l'identique, sur les données lues
// dans le module. Rejouer une règle, c'est risquer qu'elle diverge : les
// quatre fragments qui la portent sont donc vérifiés dans la source (même
// patron que `PORTES_ATTENDUES` — la preuve est nommée, et son absence est un
// échec).

const PREUVES_DU_TRI = [
  // la sélection : titre ET synonymes, pliés
  ['const ecrans = ECRANS.filter((e) => hit(e.titre, e.mots))', 'la sélection des écrans par titre + synonymes'],
  // le titre l'emporte sur le synonyme
  ['...ecrans.filter((e) => fold(e.titre).includes(cible)),', 'les correspondances de TITRE passent devant'],
  ['...ecrans.filter((e) => !fold(e.titre).includes(cible)),', '… et les correspondances de synonyme suivent'],
  // le groupe « Écrans » est poussé avant tous les objets
  ["res.push({ groupe: 'Écrans'", 'le groupe « Écrans » est bien celui qui est empilé'],
]

for (const [fragment, quoi] of PREUVES_DU_TRI) {
  assert.ok(
    SOURCE_PALETTE.includes(fragment),
    `RÈGLE DE TRI PERDUE — src/modules/RechercheOverlay.tsx ne contient plus « ${fragment} » (${quoi}).\n` +
      'Le contrôle ci-dessous rejoue cette règle pour vérifier que le premier résultat est le bon ; si la\n' +
      'règle a changé sans que ce fichier le sache, il continuerait de valider un tri qui n’existe plus —\n' +
      'vert, et faux. Mettez la preuve à jour APRÈS avoir vérifié que le tri reste juste.',
  )
}

// et le groupe « Écrans » doit être empilé AVANT les objets, sinon « annuaire »
// rendrait d'abord les trente lignes qui contiennent le mot
assert.ok(
  SOURCE_PALETTE.indexOf("groupe: 'Écrans'") < SOURCE_PALETTE.indexOf("groupe: 'Projets'"),
  'Le groupe « Écrans » n’est plus empilé en tête de `chercher()` : qui tape « annuaire » veut l’écran ' +
    'Annuaire, pas les lignes qui contiennent le mot. C’est le premier résultat qu’ouvre la touche Entrée.',
)

// `fold` est l'autorité du pliage (src/util.ts) : la rejouer suppose qu'elle
// n'a pas changé de définition
assert.match(
  lire('src/util.ts'),
  /export function fold[\s\S]{0,220}normalize\('NFD'\)/,
  '`fold` (src/util.ts) ne plie plus les accents : la simulation de recherche ci-dessous ne vaudrait plus rien.',
)

const fold = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

/** les écrans que la palette rendrait pour cette frappe, DANS L'ORDRE */
function ecransPour(saisie) {
  const cible = fold(saisie)
  const retenus = ECRANS.filter((e) => fold([e.titre, e.mots].filter(Boolean).join(' ')).includes(cible))
  return [
    ...retenus.filter((e) => fold(e.titre).includes(cible)),
    ...retenus.filter((e) => !fold(e.titre).includes(cible)),
  ]
}

{
  // la palette ne cherche qu'à partir de deux caractères (`q.trim().length >= 2`) :
  // un libellé d'une lettre serait indexé et jamais atteint
  assert.match(
    SOURCE_PALETTE,
    /const enSaisie = q\.trim\(\)\.length >= 2/,
    'le seuil de saisie de la palette a changé : la simulation ci-dessous ne correspond plus à l’écran réel',
  )

  for (const e of ENTREES) {
    assert.ok(e.label.trim().length >= 2, `le libellé « ${e.label} » est trop court pour déclencher la recherche`)
    const rendu = ecransPour(e.label)
    assert.ok(
      rendu.length > 0,
      `Taper « ${e.label} » dans la palette « / » ne rend AUCUN écran.\n` +
        (e.repliee
          ? `Cette destination est repliée dans le groupe « ${e.groupe} » : elle n’est donc plus visible au ` +
            'menu, et la voilà introuvable. « Replié » vient de vouloir dire « perdu ».'
          : 'Cette destination est visible au menu, mais qui cherche par la palette ne la trouve pas.'),
    )
    assert.equal(
      rendu[0].lien,
      `#/${e.path}`,
      `Taper « ${e.label} » ouvre « ${rendu[0].titre} » (${rendu[0].lien}) et non « ${e.label} » ` +
        `(#/${e.path}).\n` +
        'Le premier résultat est celui qu’ouvre la touche Entrée : viser le mauvais écran est pire que ' +
        'ne rien rendre, parce qu’on ne s’en aperçoit qu’une fois arrivé.',
    )
  }
}

// --- 3c. et par le mot qu'on a en tête ---------------------------------------
//
// Le libellé du menu est le mot le MOINS probable : on ne cherche pas
// « Annuaire », on cherche « le téléphone de l'artisan » ; pas
// « Automatisations », mais « prompt ». C'est la raison d'être du champ `mots`,
// et une raison d'être qui n'est pas vérifiée finit par ne plus être vraie.
//
// Chaque destination REPLIÉE doit figurer au moins une fois dans cette table :
// ce sont celles qu'on ne verra plus passer, donc celles pour lesquelles le
// synonyme n'est pas un confort mais le seul chemin restant.

const SYNONYMES_QUI_DOIVENT_MENER = {
  'certificat de paiement': '#/situations',
  OPC: '#/planning',
  pointage: '#/temps',
  rappels: '#/taches',
  drive: '#/documents',
  marge: '#/pilotage',
  détections: '#/propositions',
  contacts: '#/ressources',
  artisan: '#/ressources',
  URSSAF: '#/agenda',
  rédaction: '#/assistant',
  prompt: '#/automatisations',
}

{
  const couverts = new Set(Object.values(SYNONYMES_QUI_DOIVENT_MENER))
  for (const e of REPLIEES) {
    assert.ok(
      couverts.has(`#/${e.path}`),
      `« ${e.label} » est repliée et aucun synonyme n’est vérifié pour elle.\n` +
        'Une destination repliée ne se voit plus passer : le libellé du menu, on ne l’a plus sous les yeux ' +
        'pour s’en souvenir. Ajoutez à SYNONYMES_QUI_DOIVENT_MENER le mot avec lequel on la cherchera ' +
        'vraiment — et ajoutez-le d’abord au champ `mots` de l’écran.',
    )
  }

  for (const [mot, lien] of Object.entries(SYNONYMES_QUI_DOIVENT_MENER)) {
    const rendu = ecransPour(mot)
    assert.ok(
      rendu.length > 0,
      `Chercher « ${mot} » ne rend aucun écran : le synonyme a disparu du champ \`mots\` de ${lien}.`,
    )
    assert.equal(
      rendu[0].lien,
      lien,
      `Chercher « ${mot} » ouvre « ${rendu[0].titre} » (${rendu[0].lien}) au lieu de ${lien}.\n` +
        'Soit le synonyme a été retiré de l’écran visé, soit un autre écran vient de se l’approprier et\n' +
        'passe devant. Dans les deux cas, la personne arrive au mauvais endroit — et la destination\n' +
        'repliée, elle, n’est plus au menu pour rattraper l’erreur.',
    )
  }
}

// ==========================================================================
// CONTRÔLE N°4 — ARRIVER « EN PASSANT » ALLUME QUAND MÊME LE MENU
// ==========================================================================
//
// Onze entrées sont désormais derrière une porte fermée. Le groupe s'ouvre de
// lui-même quand il contient l'écran courant, et s'allume quand il est fermé —
// mais l'un et l'autre reposent sur `entreeActive()`, donc sur ALIAS_SECTION.
//
// Une adresse qui monte l'écran d'une entrée de menu sans être aliassée est
// donc pire depuis la tranche 2 qu'avant elle : avant, l'entrée restait
// visible, simplement éteinte ; maintenant, le groupe reste FERMÉ et rien à
// l'écran ne dit où l'on se trouve. C'est le cas d'un lien d'alerte, qui vise
// souvent l'adresse d'onglet (`#/revue`, `#/calendrier`) et pas celle du menu.

{
  const ECRAN_DU_PIED = 'parametres' // Paramètres n'est pas dans `NAV` (§7.5)
  const cheminsDeMenu = new Set([...ENTREES.map((e) => e.path), ECRAN_DU_PIED])

  for (const [depuis, vers] of ALIAS) {
    assert.ok(
      ROUTES.has(depuis),
      `ALIAS_SECTION déclare « #/${depuis} », qu’aucun \`case\` d’App.tsx ne route : l’alias est périmé et ` +
        'ne s’appliquera jamais.',
    )
    assert.ok(
      cheminsDeMenu.has(vers),
      `ALIAS_SECTION fait allumer « ${vers} » depuis « #/${depuis} », mais « ${vers} » n’est pas une entrée ` +
        'de menu.\nL’alias n’allumera rien : on travaillera dans un écran dont le menu ne dit pas le nom.',
    )
    assert.ok(
      !cheminsDeMenu.has(depuis),
      `« ${depuis} » est à la fois une entrée de menu et une clé d’ALIAS_SECTION : deux réponses possibles ` +
        'à « quelle entrée est allumée », donc deux autorités. Une seule doit trancher.',
    )
  }

  // le contrôle mécanique : toute route qui monte l'écran d'une entrée de menu
  // sans être cette entrée doit être aliassée — et vers la bonne
  const composantsDeMenu = new Map()
  for (const chemin of cheminsDeMenu) {
    for (const c of ROUTES.get(chemin) || []) composantsDeMenu.set(c, chemin)
  }

  for (const [section, composants] of ROUTES) {
    if (cheminsDeMenu.has(section)) continue
    const partages = [...composants].filter((c) => composantsDeMenu.has(c))
    if (partages.length === 0) continue // écran sans entrée de menu (`#/parite`) : rien à allumer
    const attendu = composantsDeMenu.get(partages[0])
    assert.ok(
      ALIAS.has(section),
      `« #/${section} » monte ${partages.join(', ')} — le même écran que l’entrée de menu « #/${attendu} » —, ` +
        'mais ALIAS_SECTION ne le dit pas.\n' +
        'Depuis la tranche 2, la conséquence n’est plus seulement une entrée éteinte : si l’entrée est\n' +
        'repliée, le groupe « Agence » reste FERMÉ et plus rien à l’écran ne dit où l’on est. Or c’est\n' +
        'par ce genre d’adresse qu’on arrive en cliquant une alerte.',
    )
    assert.ok(
      partages.some((c) => composantsDeMenu.get(c) === ALIAS.get(section)),
      `ALIAS_SECTION fait allumer « ${ALIAS.get(section)} » depuis « #/${section} », qui monte pourtant ` +
        `${partages.join(', ')} — l’écran de « #/${attendu} ».\n` +
        'Le menu désignerait un écran, l’écran en montrerait un autre.',
    )
  }
}

console.log(
  `Navigation repliée : ${ROUTES.size} routes servies, toutes inventoriées (aucune n’a cessé de répondre) ; ` +
    `${ENTREES.length} entrées de menu dont ${REPLIEES.length} repliées dans ` +
    `${GROUPES.filter((g) => g.repliable).map((g) => `« ${g.groupe} »`).join(', ') || 'aucun groupe'} — ` +
    `chacune retrouvée par son nom ET par un synonyme dans la palette « / », en premier résultat ; ` +
    `${ALIAS.size} adresses « en passant » allument bien l’entrée de leur écran.`,
)
