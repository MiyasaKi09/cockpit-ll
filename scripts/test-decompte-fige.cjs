// B1 (constat S6) — LE DÉCOMPTE DE SITUATION EST FIGÉ À LA VALIDATION.
//
// Trois pièces sortent de `src/pdf.ts` et se ressemblent à l'écran : la
// facture, le certificat de paiement, le décompte de situation. Les deux
// premières se réimprimaient depuis leur COPIE FIGÉE ; la troisième se
// RECALCULAIT à chaque impression depuis l'état courant, et rien ne le
// disait. L'entreprise recevait un décompte le 3 juillet, l'agence saisissait
// un avenant le 10, réimprimait le 12 pour classer — et rangeait au dossier
// un papier qui ne portait plus les mêmes chiffres que celui qui avait été
// envoyé, sans qu'aucune des deux feuilles ne l'admette.
//
// CE QUE CE TEST VERROUILLE MAINTENANT QUE B1 EST LIVRÉ
// ------------------------------------------------------
// La version précédente de ce fichier verrouillait la version d'ATTENTE : la
// dérive était réelle, donc chaque feuille portait sa mention. Elle disait
// elle-même que B1 n'était pas livré. Il l'est. Quatre garanties, dans
// l'ordre du risque :
//
//   (a) une situation validée APRÈS B1 se réimprime AU CARACTÈRE PRÈS après
//       que le marché, les situations antérieures et l'agence ont changé —
//       le protocole même qui prouve déjà l'immuabilité du certificat ;
//   (b) l'annulation de la validation RETIRE le bloc : une situation
//       redevenue « à vérifier » qui garderait son décompte figé porterait
//       un papier qui ne correspond plus à rien ;
//   (c) les situations validées AVANT B1 — les données réelles déjà en base,
//       qui n'ont pas de bloc — gardent leur mention honnête. La
//       démonstration de dérive est CONSERVÉE comme témoin de ce cas : elle
//       prouve que la mention n'est pas un ornement, et le jour où elle
//       cessera de tomber c'est que ce régime aura disparu ;
//   (d) le figeage a lieu à la VALIDATION, jamais à l'impression. Imprimer
//       n'écrit rien : sinon deux personnes qui impriment le même jour
//       figeraient deux vérités pour la même situation, et la première à
//       cliquer gagnerait.
//
// Et le corollaire qui ferme la boucle : TOUTE validation fige. Une situation
// validée depuis la file du matin doit donner exactement le même papier que
// la même situation validée depuis l'écran des situations — deux régimes de
// vérité selon le bouton cliqué, c'est le défaut d'origine réinstallé sous
// une autre forme.
//
// Le test REND les documents pour de vrai : `window.open` est remplacé par un
// carnet, et c'est le HTML produit qui est examiné. Une assertion sur le code
// source dirait seulement que la phrase est écrite quelque part ; ici on
// vérifie qu'elle SORT sur le papier.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')
const arbre = (f) => ts.createSourceFile(f, lire(f), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)

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

// --- le carnet : ce que le navigateur aurait affiché ------------------------
//
// `pdf.ts` ouvre un onglet et y écrit. On remplace l'onglet par un carnet :
// le module n'est pas modifié, c'est bien le HTML RÉELLEMENT produit qui est
// lu ici. `window` est posé AVANT le chargement pour que rien ne capture une
// référence morte.

let derniereSortie = null
globalThis.window = {
  open: () => ({
    document: {
      write: (h) => {
        derniereSortie = h
      },
      close: () => {},
    },
  }),
}

const PDF = charger('src/pdf.ts')
const { figerDecompte, empreinteDecompte } = charger('src/decompte.ts')
const { decompteSituation } = charger('src/derive.ts')
const { construireCertificat, figerCertificat } = charger('src/certificat.ts')

/** imprime et rend le papier */
function imprimerDecompte(state, sit, editeLe) {
  derniereSortie = null
  PDF.ouvrirDecompteSituationPDF(state, sit, editeLe)
  assert.ok(derniereSortie, 'le décompte doit produire un document — sinon rien de ce qui suit ne veut dire quoi que ce soit')
  return derniereSortie
}

/** le HTML débarrassé de ses espaces de mise en forme monétaire : `fmtMoney`
 *  pose des espaces insécables fines, invisibles à l'œil et fatales à une
 *  comparaison littérale */
const sansEspaces = (s) => s.replace(/\s/g, ' ')

/** les montants du papier, dans l'ordre où ils y figurent — c'est ce que
 *  l'entreprise compare d'une feuille à l'autre */
function montantsDu(html) {
  const tableau = html.slice(html.indexOf('<table class="dc">'), html.indexOf('</table>'))
  return [...tableau.matchAll(/class="r">([^<]+)</g)].map((m) => sansEspaces(m[1]))
}

/** la ligne « net à payer ce mois HT » — celle que l'entreprise lit en
 *  premier et que le comptable recopie */
const netDu = (html) => montantsDu(html).at(-2)

// --- le jeu d'essai : un chantier ordinaire, une situation à vérifier -------

const etat = () => ({
  settings: {
    nomAgence: 'Agence LL',
    siretAgence: '000 000 000 00000',
    personnes: ['Julien', 'Zoé'],
    tresorerieDispo: null,
  },
  projets: [{ id: 'P-EC', nom: 'École de Chamant', moa: 'Commune de Chamant', adresse: '3 rue du Marché, 60300 Chamant', phases: [] }],
  marches: [
    {
      id: 'M-GO',
      projetId: 'P-EC',
      entreprise: 'Gros œuvre du Valois',
      lot: 'Lot 2 — gros œuvre',
      montantInitialHT: 200000,
      avenantsHT: 0,
      tauxRG: 0.05,
      garantie: 'retenue',
      revision: false,
      delaiVerifJours: 15,
      actif: true,
    },
  ],
  situations: [
    {
      id: 'sit-1',
      projetId: 'P-EC',
      marcheId: 'M-GO',
      entreprise: 'Gros œuvre du Valois',
      lot: 'Lot 2 — gros œuvre',
      mois: '2026-05',
      numero: 1,
      montantMoisHT: 40000,
      montantCumulHT: 40000,
      revisionHT: null,
      statut: 'validee',
      dateReception: '2026-06-02',
    },
    {
      id: 'sit-2',
      projetId: 'P-EC',
      marcheId: 'M-GO',
      entreprise: 'Gros œuvre du Valois',
      lot: 'Lot 2 — gros œuvre',
      mois: '2026-06',
      numero: 2,
      montantMoisHT: 30000,
      montantCumulHT: 70000,
      revisionHT: null,
      // le cas NEUF : elle est encore à vérifier, c'est la validation qui va
      // la figer. L'ancien jeu d'essai la posait déjà « validée », ce qui ne
      // pouvait décrire que le régime d'avant.
      statut: 'a_verifier',
      dateReception: '2026-07-02',
    },
  ],
  indicesBTP: [],
  evenementsMarche: [],
  certificats: [],
  factures: [],
  paiements: [],
})

const situation = (e) => e.situations.find((s) => s.id === 'sit-2')

/** LE GESTE DE VALIDATION, tel que les écrans le font : on fige, puis on
 *  écrit le statut et le bloc ENSEMBLE. Que les écrans le fassent bien ainsi
 *  — et nulle part ailleurs — est vérifié en §4 et §6 par le compilateur ;
 *  ici on exerce la conséquence sur le papier. */
async function valider(e, sit, { le, par }) {
  const fige = figerDecompte(e, sit, { maintenant: le, par })
  fige.empreinte = await empreinteDecompte(fige)
  sit.statut = 'validee'
  sit.decompteFige = fige
  return fige
}

/** la vie du chantier APRÈS la validation : l'entreprise fournit sa garantie
 *  à première demande, un avenant est signé, une situation antérieure est
 *  corrigée, l'agence se renomme. Rien de tout cela n'a le droit d'atteindre
 *  un papier déjà remis. */
function toutBouge(e) {
  e.marches[0].garantie = 'gpd'
  e.marches[0].avenantsHT = 12000
  e.marches[0].revision = true
  e.situations[0].montantCumulHT = 52000
  e.situations[1].montantCumulHT = 88000
  e.situations[1].revisionHT = 1234.56
  e.settings.nomAgence = 'Autre agence'
  e.settings.personnes = ['Quelqu’un d’autre']
}

const main = async () => {
  // ============================================================
  // 1. (a) UNE SITUATION VALIDÉE APRÈS B1 NE BOUGE PLUS
  // ============================================================
  //
  // Le protocole est celui qui prouve déjà l'immuabilité du certificat : on
  // imprime, on dérègle l'état tout entier, on réimprime. La différence est
  // qu'un décompte porte, lui, une date d'édition — c'est le seul caractère
  // qui a le droit de changer, et le seul qu'on normalise ici.

  {
    const e = etat()
    const sit = situation(e)
    const fige = await valider(e, sit, { le: '2026-07-03', par: 'Julien' })

    const troisJuillet = imprimerDecompte(e, sit, '2026-07-03')
    assert.equal(netDu(troisJuillet), '28 500,00 €', 'le 3 juillet, retenue de garantie de 5 % déduite')

    // le chantier vit
    toutBouge(e)

    // …et le calcul, LUI, a bel et bien changé : sans ceci la comparaison
    // ci-dessous serait un rituel qui ne teste rien
    const recalcule = decompteSituation(e, sit)
    assert.notEqual(
      Math.round(recalcule.netAPayerHT * 100),
      Math.round(fige.lignes.netAPayerHT * 100),
      'le jeu d’essai doit VRAIMENT faire dériver le calcul (garantie, avenant, cumuls, révision) — sinon ' +
        '« le papier n’a pas bougé » ne prouverait rien du tout',
    )

    // même jour, après la dérive : identique AU CARACTÈRE PRÈS
    const memeJour = imprimerDecompte(e, sit, '2026-07-03')
    assert.equal(
      memeJour,
      troisJuillet,
      'LA GARANTIE B1 : une situation validée se réimprime à l’identique quoi qu’il advienne du marché, des ' +
        'situations antérieures et de l’agence. Si ceci tombe, le papier remis à l’entreprise vient de ' +
        'changer tout seul dans le dossier — le défaut S6 est de retour.',
    )

    // neuf jours plus tard : seule la date d'ÉDITION a le droit de bouger
    const douzeJuillet = imprimerDecompte(e, sit, '2026-07-12')
    assert.deepEqual(
      montantsDu(douzeJuillet),
      montantsDu(troisJuillet),
      'réimprimé le 12 pour classer, le décompte porte les mêmes chiffres que celui envoyé le 3',
    )
    assert.equal(
      douzeJuillet.replace(/12 juil\. 2026/g, '03 juil. 2026'),
      troisJuillet,
      'et RIEN d’autre que la date d’édition ne diffère : ni l’agence, ni le marché, ni la retenue, ni les ' +
        'points à vérifier relevés ce jour-là',
    )

    // ce que le papier DIT de lui-même
    assert.match(
      troisJuillet,
      /<strong>Décompte figé à la validation<\/strong> le 03 juil\. 2026 par Julien, édité le 03 juil\. 2026\./,
      'le document nomme son régime, sa date de figeage, son auteur et sa date d’édition — quatre choses ' +
        'différentes qu’un dossier relu à trois mois ne peut pas deviner',
    )
    assert.match(douzeJuillet, /édité le 12 juil\. 2026/, 'la date d’édition suit le jour où l’on imprime')
    assert.match(douzeJuillet, /figé à la validation<\/strong> le 03 juil\. 2026/, 'la date de figeage, elle, ne bouge pas')
    assert.doesNotMatch(
      troisJuillet,
      /Document reconstitué depuis l'état courant/,
      'un décompte figé ne doit PAS porter la mention de l’ancien régime : dire les deux, c’est ne rien dire',
    )

    // l'agence FIGÉE, pas celle d'aujourd'hui
    assert.match(douzeJuillet, /Agence LL/, 'le papier porte l’agence telle qu’elle se nommait au jour de la validation')
    assert.doesNotMatch(
      douzeJuillet,
      /Autre agence/,
      'renommer l’agence ne réécrit pas un papier déjà remis — c’est la même raison qui a fait naître ' +
        '`EnteteCertificat`',
    )

    // l'empreinte est au document (audit), et elle est réellement calculée
    assert.match(fige.empreinte, /^[0-9a-f]{64}$/, 'SHA-256 hexadécimal, comme `empreinteFigee` de src/facture.ts')
    assert.ok(
      troisJuillet.includes(fige.empreinte.slice(0, 12)),
      'le papier porte le début de l’empreinte : c’est ce qui permet de dire si deux feuilles sortent du ' +
        'même bloc figé',
    )
    const autre = await empreinteDecompte({ ...fige, lignes: { ...fige.lignes, netAPayerHT: fige.lignes.netAPayerHT + 1 } })
    assert.notEqual(autre, fige.empreinte, 'un centime de plus, une autre empreinte — sinon elle ne prouve rien')
  }

  // ============================================================
  // 2. Le bloc figé est la SEULE source du papier
  // ============================================================
  //
  // §1 le montre par l'extérieur (l'état bouge, le papier non). Ici on le
  // montre par l'intérieur : on falsifie le bloc, et le papier suit le bloc.
  // C'est la preuve qu'aucune ligne n'est relue de l'état — pas même « en
  // secours », ce qui serait le pire des deux mondes.

  {
    const e = etat()
    const sit = situation(e)
    const fige = await valider(e, sit, { le: '2026-07-03', par: 'Julien' })

    fige.lignes.netAPayerHT = 1234.56
    fige.entete.agence.nom = 'Agence d’alors'
    fige.entete.projetLibelle = 'Opération d’alors'
    fige.coherences = ['Un point relevé ce jour-là.']

    const html = imprimerDecompte(e, sit, '2026-07-03')
    assert.equal(netDu(html), '1 234,56 €', 'le net imprimé sort du BLOC, jamais d’un recalcul')
    assert.match(html, /Agence d’alors/, 'l’en-tête sort du bloc')
    assert.match(html, /Opération d’alors/, 'le libellé d’opération aussi — `nomProjet` a été lu UNE fois, à la validation')
    assert.match(
      html,
      /Un point relevé ce jour-là\./,
      'et les points à vérifier relevés au figeage repartent avec le papier : les taire à la réimpression ' +
        'donnerait un document plus propre que l’original',
    )

    // « null n'est pas 0 » : personne d'identifié au poste, le papier le dit
    // au lieu de signer au nom du premier de la liste
    const anonyme = etat()
    const sitAnonyme = situation(anonyme)
    await valider(anonyme, sitAnonyme, { le: '2026-07-03', par: null })
    assert.match(
      imprimerDecompte(anonyme, sitAnonyme, '2026-07-03'),
      /le 03 juil\. 2026 \(auteur non identifié\)/,
      '`useMoi()` peut ne désigner personne : le papier l’écrit, il n’attribue pas la validation à Julien ' +
        'parce qu’il est premier dans les réglages',
    )
  }

  // ============================================================
  // 3. (d) LE FIGEAGE A LIEU À LA VALIDATION, PAS À L'IMPRESSION
  // ============================================================
  //
  // C'est la règle qui décide de QUELLE vérité fait foi. Figer à la première
  // impression donnerait deux vérités pour la même situation si deux
  // personnes impriment le même jour, et ferait dépendre le contenu d'un
  // papier contractuel de l'ordre dans lequel on a cliqué.

  {
    const e = etat()
    const sit = situation(e)
    const avant = JSON.stringify(e)

    const html = imprimerDecompte(e, sit, '2026-07-03')
    imprimerDecompte(e, sit, '2026-07-12')
    imprimerDecompte(e, sit, '2026-07-12')

    assert.equal(sit.decompteFige, undefined, 'imprimer une situation NON validée ne pose aucun bloc figé')
    assert.equal(
      JSON.stringify(e),
      avant,
      'imprimer n’écrit RIEN, nulle part : trois impressions laissent l’état au caractère près comme il était',
    )

    // et le papier annonce ce qu'il n'est pas encore
    assert.match(
      html,
      /<strong>Décompte de vérification — situation non validée<\/strong>/,
      'une situation à vérifier n’est pas une pièce : le papier le dit avant tout le reste',
    )
    assert.match(
      html,
      /Le décompte sera figé au moment de la validation, et c'est cette copie-là qui se réimprimera\./,
      'et il annonce ce qui va se passer — sans quoi personne ne sait quelle feuille conserver',
    )
    assert.match(html, /Deux impressions faites à deux dates peuvent donc différer/, 'tant qu’elle n’est pas validée, elle bouge, et elle le dit')

    // la même chose une fois VALIDÉE, sur le bloc figé : plus de mise en garde
    await valider(e, sit, { le: '2026-07-03', par: 'Zoé' })
    const apres = imprimerDecompte(e, sit, '2026-07-12')
    assert.doesNotMatch(
      apres,
      /Deux impressions faites à deux dates peuvent donc différer/,
      'validée, elle ne bouge plus : garder la mise en garde ferait douter d’un papier qui, lui, est sûr',
    )
    assert.match(apres, /Deux impressions portent les mêmes chiffres\./, 'elle est remplacée par la promesse inverse')

    // …et la preuve structurelle : le générateur n'écrit nulle part
    const pdf = arbre('src/pdf.ts')
    const ecritures = []
    const chercher = (n) => {
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(n.left) &&
        n.left.name.text === 'decompteFige'
      )
        ecritures.push(pdf.getLineAndCharacterOfPosition(n.getStart()).line + 1)
      ts.forEachChild(n, chercher)
    }
    chercher(pdf)
    assert.deepEqual(
      ecritures,
      [],
      `src/pdf.ts écrit \`decompteFige\` (ligne ${ecritures.join(', ')}). Un générateur de PDF qui écrit dans ` +
        'l’état fige la vérité au premier qui imprime — la règle est « à la validation, jamais à l’impression ».',
    )
  }

  // ============================================================
  // 4. (b) L'ANNULATION RETIRE LE BLOC
  // ============================================================
  //
  // Le statut et le bloc doivent partir ensemble. S'ils sont écrits par deux
  // chemins, un « Annuler » qui n'en défait qu'un laisse une situation « à
  // vérifier » porteuse d'un décompte figé — et l'impression, elle, croira
  // le bloc (§2) : le papier affirmerait « figé à la validation » sur une
  // situation que personne n'a validée.

  {
    const src = lire('src/modules/Situations.tsx')
    const sf = arbre('src/modules/Situations.tsx')

    /** le corps de `validerVraiment`, tel que le compilateur le découpe */
    const trouverFonction = (nom, source) => {
      let trouve = null
      const chercher = (n) => {
        if (
          ts.isVariableDeclaration(n) &&
          ts.isIdentifier(n.name) &&
          n.name.text === nom &&
          n.initializer
        )
          trouve = n.initializer
        ts.forEachChild(n, chercher)
      }
      chercher(source)
      return trouve
    }

    const noeudValider = trouverFonction('validerVraiment', sf)
    assert.ok(noeudValider, 'src/modules/Situations.tsx doit porter `validerVraiment` — le geste « Valider » de la liste')
    const corps = noeudValider.getText(sf)

    // une SEULE écriture : le statut et le bloc dans la même mutation.
    // Comptée par le compilateur, pas par le texte : un commentaire qui
    // écrirait « update( » ferait échouer une recherche littérale, et on
    // relâcherait le contrôle jusqu'à ce qu'il ne serve plus à rien.
    let updates = 0
    const compter = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'update') updates++
      ts.forEachChild(n, compter)
    }
    compter(noeudValider)
    assert.equal(
      updates,
      1,
      `validerVraiment fait ${updates} écritures. Il en faut UNE : deux écritures, ce sont deux entrées ` +
        'd’historique, et un « Annuler » qui n’en défait qu’une laisse une situation à vérifier avec un ' +
        'décompte figé — exactement le papier qui ne correspond à rien.',
    )
    const mutation = corps.slice(corps.indexOf('update('))
    assert.match(mutation, /statut = 'validee'/, 'l’écriture pose le statut…')
    assert.match(mutation, /decompteFige = fige/, '…et le bloc figé, dans la MÊME mutation')

    // l'empreinte se calcule AVANT l'écriture : le bloc part complet
    assert.ok(
      corps.indexOf('await empreinteDecompte') < corps.indexOf('update('),
      'l’empreinte se calcule avant l’écriture — un bloc écrit puis complété serait deux écritures déguisées',
    )

    // et l'« Annuler » rend l'état d'avant, pris avant tout le reste
    assert.ok(
      corps.indexOf('const snap = state') < corps.indexOf('figerDecompte'),
      'l’instantané est pris AVANT le figeage : sinon « Annuler » rendrait un état qui contient déjà le bloc',
    )
    assert.match(
      corps,
      /undo:[\s\S]*replace\(snap\)/,
      'la validation laisse un « Annuler » (patron ui.tsx) — et comme statut et bloc sont partis ensemble, ' +
        'il retire les deux',
    )
    assert.match(
      corps,
      /toast\('Situation validée — décompte figé à cette date\.'/,
      'le toast DIT ce qui vient d’être figé : « validée » seul laisserait croire qu’un simple statut a changé',
    )

    // --- l'autre porte : la fiche, où le statut se change aussi ----------
    const enregistrer = trouverFonction('enregistrer', sf)
    assert.ok(enregistrer, 'la fiche « Éditer la situation » doit porter son `enregistrer`')
    const corpsFiche = enregistrer.getText(sf)

    assert.match(
      corpsFiche,
      /const devientValidee = .*statut === 'validee' && sit\.statut !== 'validee'/,
      'la fiche fige quand la situation DEVIENT validée — et une situation qui RESTE validée n’est jamais ' +
        'refigée : ni pour réécrire le papier déjà remis, ni pour dater d’aujourd’hui une validation de l’an ' +
        'dernier',
    )

    // le retrait doit être une vraie suppression de propriété
    let suppression = null
    const chercherDelete = (n) => {
      if (
        ts.isDeleteExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === 'decompteFige'
      )
        suppression = n
      ts.forEachChild(n, chercherDelete)
    }
    chercherDelete(enregistrer)
    assert.ok(
      suppression,
      'quitter « validée » depuis la fiche doit SUPPRIMER `decompteFige`. Sans ce retrait, une situation ' +
        'repassée « à vérifier » ou rejetée garderait un décompte figé, et son impression affirmerait « figé ' +
        'à la validation » — sur une situation que plus personne n’a validée.',
    )
    assert.match(
      corpsFiche.slice(corpsFiche.indexOf('devientValidee')),
      /statut !== 'validee' && [A-Za-z]+\.decompteFige/,
      'le retrait est conditionné à la SORTIE de « validée », pas à autre chose',
    )

    // --- et l'on montre le papier que ce retrait évite -------------------
    //
    // Témoin, pas cible : on force à la main l'état que le code interdit,
    // pour rendre visible ce qu'il coûterait. C'est cette feuille-là que les
    // deux garanties ci-dessus rendent impossible.
    const e = etat()
    const sit = situation(e)
    await valider(e, sit, { le: '2026-07-03', par: 'Julien' })
    sit.statut = 'a_verifier' // le bloc, lui, est resté : le défaut simulé
    const papierIncoherent = imprimerDecompte(e, sit, '2026-07-12')
    assert.match(
      papierIncoherent,
      /Décompte figé à la validation/,
      'DÉMONSTRATION : un bloc oublié fait dire « figé à la validation » à une situation à vérifier. Le ' +
        'papier serait plus affirmatif que la réalité — d’où le retrait, vérifié ci-dessus.',
    )

    // enfin : le rejet n'est offert que sur une situation à vérifier, ce qui
    // ferme la troisième porte de sortie sans code supplémentaire
    const listeAVerifier = src.slice(src.indexOf('const duProjet = aVerifier.filter'), src.indexOf('</Table>', src.indexOf('const duProjet = aVerifier.filter')))
    assert.match(
      listeAVerifier,
      /label: 'Rejeter…'/,
      '« Rejeter… » vit dans la liste « à vérifier » — une situation validée ne s’y rejette pas d’un clic, ' +
        'elle repasse par la fiche, qui retire le bloc',
    )
  }

  // ============================================================
  // 5. (c) LES SITUATIONS VALIDÉES AVANT B1 GARDENT LEUR MENTION
  // ============================================================
  //
  // Ce sont les données réelles déjà en base : validées, sans bloc. Leur
  // décompte se reconstitue depuis l'état courant — et la dérive est RÉELLE.
  // On la provoque, chiffres à l'appui : sans cela la mention serait un
  // ornement et on la retirerait un jour.

  {
    const e = etat()
    const sit = situation(e)
    sit.statut = 'validee' // validée AVANT B1 : aucun `decompteFige`
    assert.equal(sit.decompteFige, undefined, 'le cas décrit est bien celui d’une validée SANS bloc')

    const juillet = imprimerDecompte(e, sit, '2026-07-03')

    // à état égal, le document est déterministe — sinon rien de ce qui suit
    // ne dirait quoi que ce soit
    const jumeau = etat()
    const sitJumeau = situation(jumeau)
    sitJumeau.statut = 'validee'
    assert.deepEqual(
      montantsDu(juillet),
      montantsDu(imprimerDecompte(jumeau, sitJumeau, '2026-07-03')),
      'à état égal, le décompte reconstitué est déterministe',
    )

    // …puis la vie du chantier : le marché passe en garantie à première
    // demande (l'entreprise a fourni sa GPD après coup — cas courant)
    const apres = etat()
    const sitApres = situation(apres)
    sitApres.statut = 'validee'
    apres.marches[0].garantie = 'gpd'
    const reimpression = imprimerDecompte(apres, sitApres, '2026-07-12')

    assert.notDeepEqual(
      montantsDu(juillet),
      montantsDu(reimpression),
      'LE DÉFAUT QUI SUBSISTE, ET QUI EST DIT : faute de bloc, la même situation réimprimée neuf jours plus ' +
        'tard ne porte plus les mêmes chiffres. C’est un FAIT pour toutes les situations validées avant B1, ' +
        'et c’est pour ce fait que la mention existe. Si cette assertion tombe un jour, c’est que plus aucune ' +
        'situation sans bloc ne subsiste : retirez le régime « reconstitué » du document, et cette section ' +
        'avec — la bonne nouvelle est ailleurs.',
    )
    assert.equal(netDu(juillet), '28 500,00 €', 'le 3 juillet, retenue de garantie déduite')
    assert.equal(netDu(reimpression), '30 000,00 €', 'le 12 juillet, la garantie couvre le marché — plus de retenue')

    // donc chaque feuille porte sa mention, et dit la conséquence en clair
    assert.match(
      juillet,
      /<strong>Document reconstitué depuis l'état courant<\/strong>/,
      'le document ADMET qu’il se recalcule : une pièce qui engage doit dire ce qu’elle est',
    )
    assert.match(
      juillet,
      /Deux impressions faites à deux dates peuvent donc différer/,
      'et dire la conséquence — « reconstitué » seul ne se comprend pas au bout d’un an de dossier',
    )
    assert.match(
      juillet,
      /Aucun décompte n'a été figé à la validation de cette situation/,
      'et dire POURQUOI : le papier remis ce jour-là n’a pas été conservé. C’est la phrase qui distingue ' +
        'une donnée d’avant B1 d’un bloc perdu',
    )
    assert.match(juillet, /décompte de vérification n'est pas une pièce figée/, 'le nom du document dit sa nature')
    assert.match(juillet, /<title>Décompte situation/, 'le document reste nommé pour ce qu’il est')

    // la vraie date d'édition, pas la date de réception : sur un document qui
    // bouge, c'est le seul repère qui dit laquelle des deux feuilles est la
    // plus récente
    assert.match(juillet, /Édité le 03 juil\. 2026/, 'la date d’édition est celle du jour de l’impression')
    assert.match(reimpression, /Édité le 12 juil\. 2026/, 'elle suit le jour où l’on imprime, pas la pièce')
    assert.match(juillet, /Situation reçue le 02 juil\. 2026/, 'la date de réception reste dite — elle ne sert simplement plus de date d’édition')

    // et l'écran passe bien SA date (`useToday`) plutôt que de laisser jouer
    // le repli d'horloge du module
    const ecran = lire('src/modules/Situations.tsx')
    const appels = [...ecran.matchAll(/ouvrirDecompteSituationPDF\(([^)]*)\)/g)].map((m) => m[1])
    assert.ok(appels.length >= 2, `l’écran des situations imprime le décompte depuis plusieurs endroits (${appels.length} trouvés)`)
    for (const args of appels)
      assert.match(
        args,
        /,\s*today\s*$/,
        `« ouvrirDecompteSituationPDF(${args}) » : l’écran doit passer SA date du jour — le repli d’horloge du module ne doit servir à personne`,
      )
  }

  // ============================================================
  // 6. TOUTE validation fige — sinon deux régimes reviennent
  // ============================================================
  //
  // Le décompte n'est figé que si TOUS les chemins de validation le figent.
  // L'accueil valide aussi des situations (raccourci de la file du matin,
  // action de l'alerte) : une situation validée là-bas repartirait en régime
  // « reconstitué », et la même situation aurait deux papiers possibles
  // selon l'endroit d'où on a cliqué. C'est le défaut d'origine réinstallé.

  {
    const ecrans = fs
      .readdirSync(path.join(racine, 'src/modules'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => `src/modules/${f}`)

    let validations = 0
    for (const fichier of ecrans) {
      const sf = arbre(fichier)
      const chercher = (n) => {
        const estValidation =
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(n.left) &&
          n.left.name.text === 'statut' &&
          ts.isStringLiteral(n.right) &&
          n.right.text === 'validee'
        if (estValidation) {
          validations++
          const ligne = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
          // l'écriture qui contient ce statut doit contenir aussi le bloc
          let ecriture = n.parent
          while (
            ecriture &&
            !(ts.isCallExpression(ecriture) && ts.isIdentifier(ecriture.expression) && ecriture.expression.text === 'update')
          )
            ecriture = ecriture.parent
          assert.ok(
            ecriture,
            `${fichier}:${ligne} — une situation passe à « validée » hors de toute écriture \`update\` : ` +
              'impossible de garantir que le bloc figé part avec elle.',
          )
          assert.match(
            ecriture.getText(sf),
            /decompteFige/,
            `${fichier}:${ligne} — cette validation ne fige AUCUN décompte. La situation validée ici ` +
              'retombera dans le régime « reconstitué » et se réimprimera avec les chiffres du jour, pendant ' +
              'que la même situation validée depuis l’écran des situations, elle, ne bougera plus. Deux ' +
              'régimes de vérité pour une seule pièce : c’est exactement le défaut S6, sous une autre porte. ' +
              '(Appelez `figerDecompte` — src/decompte.ts — et rangez le bloc dans CETTE mutation.)',
          )
        }
        ts.forEachChild(n, chercher)
      }
      chercher(sf)
    }
    assert.ok(
      validations >= 3,
      `seulement ${validations} chemins de validation trouvés : l’écran des situations, le raccourci de la ` +
        'file du matin et l’action de l’alerte en font au moins trois. Si le compte a baissé, ce contrôle ' +
        'ne regarde plus rien.',
    )

    // le bloc est produit par la seule autorité, jamais recopié à la main
    for (const fichier of ecrans) {
      const source = lire(fichier)
      if (!source.includes('decompteFige')) continue
      assert.match(
        source,
        /import \{[^}]*figerDecompte[^}]*\} from '\.\.\/decompte'/,
        `${fichier} manipule \`decompteFige\` sans importer \`figerDecompte\` : un second assembleur de bloc ` +
          'produirait un deuxième décompte, différent, pour la même situation.',
      )
    }
  }

  // ============================================================
  // 7. Le module de figeage est PUR, et il n'invente aucun calcul
  // ============================================================

  {
    const source = lire('src/decompte.ts')
    for (const [motif, pourquoi] of [
      [/useStore/, 'il lirait l’état par un canal caché, et ne serait plus rejouable'],
      [/localStorage/, 'un module pur ne connaît pas le poste de travail'],
      [/fetch\(/, 'figer un décompte ne demande le réseau à personne'],
      [/Date\.now\(\)/, 'la date du figeage est un ARGUMENT : c’est celle de la validation, pas celle de l’exécution'],
      [/new Date\(\)/, 'même raison — une horloge lue ici rendrait deux figeages du même geste différents'],
    ])
      assert.doesNotMatch(source, motif, `src/decompte.ts : ${pourquoi} (motif ${motif})`)

    assert.match(
      source,
      /import \{ decompteSituation[^}]*\} from '\.\/derive'/,
      '`figerDecompte` IMPORTE le calcul : refaire une seule de ses onze lignes ici donnerait deux décomptes ' +
        'pour une situation — celui de l’écran et celui du papier',
    )

    // et il photographie VRAIMENT : le bloc doit reproduire le calcul au centime
    const e = etat()
    const sit = situation(e)
    const attendu = decompteSituation(e, sit)
    const fige = figerDecompte(e, sit, { maintenant: '2026-07-03', par: 'Julien' })
    for (const cle of ['travauxCumulHT', 'revisionHT', 'baseHT', 'tauxRG', 'garantie', 'retenueGarantieHT', 'cumulNetHT', 'precedentNetHT', 'netAPayerHT', 'tauxTVA', 'netAPayerTTC'])
      assert.equal(fige.lignes[cle], attendu[cle], `la ligne « ${cle} » du bloc figé doit être celle de \`decompteSituation\`, au centime`)

    assert.equal(fige.entete.marcheTotalHT, 200000, 'le marché figé porte ses avenants du jour de la validation')

    // « null n'est pas 0 » : sans marché rattaché, il n'y a pas de montant
    const orphelin = etat()
    const sitOrphelin = situation(orphelin)
    // ni identifiant de marché, ni entreprise qui corresponde à un marché du
    // projet : `marcheDeSituation` retombe sur le nom, il faut donc couper les
    // deux liens pour décrire vraiment une situation non rattachée
    sitOrphelin.marcheId = null
    sitOrphelin.entreprise = 'Entreprise pas encore au tableau des marchés'
    const figeOrphelin = figerDecompte(orphelin, sitOrphelin, { maintenant: '2026-07-03', par: null })
    assert.equal(
      figeOrphelin.entete.marcheTotalHT,
      null,
      'une situation non rattachée n’a pas un marché de 0 € : elle n’a pas de marché, et le papier le dit',
    )
    assert.match(
      imprimerDecompte(orphelin, sitOrphelin, '2026-07-03'),
      /Situation non rattachée à un marché/,
      'et le papier l’écrit plutôt que d’imprimer « Marché : 0,00 € HT »',
    )

    // le bloc ne partage plus rien avec l'état : c'est ce qui le rend stable
    const isole = etat()
    const sitIsole = situation(isole)
    const bloc = figerDecompte(isole, sitIsole, { maintenant: '2026-07-03', par: 'Julien' })
    isole.settings.personnes.push('Une recrue')
    assert.deepEqual(
      bloc.entete.agence.personnes,
      ['Julien', 'Zoé'],
      'le bloc COPIE la liste des personnes : la partager ferait réécrire un papier remis le jour où ' +
        'quelqu’un rejoint l’agence',
    )
  }

  // ============================================================
  // 8. Le certificat émis est nommé, et c'est LUI qui fait foi
  // ============================================================
  //
  // Le certificat est émis APRÈS la validation : il ne peut pas vivre dans
  // le bloc figé, et se lit donc en direct. Il est figé de son côté, et
  // vis-à-vis du maître d'ouvrage c'est lui la pièce contractuelle.

  {
    const vierge = etat()
    const sitVierge = situation(vierge)
    await valider(vierge, sitVierge, { le: '2026-07-03', par: 'Julien' })
    const sansCertificat = imprimerDecompte(vierge, sitVierge, '2026-07-03')
    assert.match(
      sansCertificat,
      /Aucun certificat de paiement n'a encore été émis/,
      'aucune pièce certifiée : le document doit le dire, pas se taire — sans quoi on croit que le décompte ' +
        'est la pièce contractuelle',
    )
    assert.doesNotMatch(sansCertificat, /fait foi/, 'et ne pas parler d’une pièce qui n’existe pas')

    const e = etat()
    const sit = situation(e)
    await valider(e, sit, { le: '2026-07-03', par: 'Julien' })
    const construit = construireCertificat(e, 'sit-2')
    assert.ok(construit, 'la situation est rattachée à un marché : le certificat se construit')
    e.certificats.push(figerCertificat(construit, { id: 'cert-1', emisLe: '2026-07-08', emisPar: 'Julien' }))
    const netCertifie = e.certificats[0].netAPayerTTC

    const html = imprimerDecompte(e, sit, '2026-07-12')
    assert.match(
      html,
      /Certificat de paiement n° 2 émis le 08 juil\. 2026 par Julien/,
      'le décompte NOMME la pièce figée : numéro, date, signataire',
    )
    assert.match(html, /c'est le certificat qui fait foi/, 'et tranche : en cas d’écart, la pièce figée l’emporte')
    const attendu = `net à payer certifié ${netCertifie.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    assert.ok(
      sansEspaces(html).includes(sansEspaces(attendu)),
      `le net rappelé doit être celui du certificat FIGÉ (« ${attendu} ») — le recopier depuis l'état courant ` +
        'ferait dire au décompte que le maître d’ouvrage a certifié un montant qu’il n’a jamais vu',
    )

    // le certificat, lui, ne prend même pas l'état : c'est par CONSTRUCTION
    // qu'il ne peut pas dériver. C'est le patron que B1 vient de reproduire.
    assert.match(
      lire('src/pdf.ts'),
      /export function ouvrirCertificatPaiementPDF\(cert: CertificatPaiement\)/,
      'le générateur du certificat ne prend pas l’état — le décompte, lui, en a encore besoin pour lire le ' +
        'certificat émis, d’où les contrôles ci-dessus qui vérifient qu’il ne s’en sert PAS pour ses montants',
    )
  }

  console.log(
    'Décompte de situation, B1 : une situation validée se réimprime au caractère près après que le marché, ' +
      'les situations et l’agence ont changé (seule la date d’édition bouge) ; le papier sort du bloc et de ' +
      'lui seul ; imprimer n’écrit rien ; statut et bloc partent dans une seule écriture, donc un seul ' +
      '« Annuler » les retire ; les validées d’avant B1 gardent leur mention honnête — et la dérive de ' +
      '1 500 € qui la justifie est toujours démontrée.',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
