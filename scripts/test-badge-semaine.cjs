// Audit d'usage, actions 26 et 28 (constats S2 et T4) — le badge de la
// semaine ne ment plus, et le temps chronométré ne disparaît plus.
//
// DEUX DÉFAUTS, UN SEUL ACTIF À PROTÉGER : LA CONFIANCE
// ------------------------------------------------------
// Le §2.2 de l'audit le dit en une phrase : « un badge qui crie pour rien
// finit ignoré ». Les deux modes de panne fermés ici se rejoignent là.
//
// 1. LE BADGE QUI CRIE POUR RIEN (S2, action 28). « Ma semaine » comparait
//    les heures saisies à 35 h FIXES. Une semaine avec deux jours de congé
//    restait donc « incomplète » quoi qu'on saisisse : impossible de la
//    rendre verte autrement qu'en déclarant des heures qu'on n'a pas
//    travaillées. C'est l'indicateur PRINCIPAL de l'écran ; celui qui a tort
//    à chaque congé cesse d'être regardé, et la feuille de temps avec lui —
//    or c'est la seule source de la marge des projets.
//    `capacitePersonneSemaine` (derive.ts) savait déjà déduire les congés.
//
// 2. LE TEMPS QUI S'ÉVAPORE (T4, action 26). Arrêter un chrono affiche
//    « 1 h 20 enregistrées ». C'est vrai : le pointage est écrit dans
//    `state.pointages`. Ce qui est faux, c'est ce que la phrase laisse
//    entendre — `projeterVersTemps` et `tempsParTache` (`pointages.ts`)
//    n'ont AUCUN appelant, la collection est écrite-seulement. Trois issues,
//    toutes coûteuses : le temps est perdu, ou ressaisi (et compté DEUX fois
//    le jour du branchement), ou cru compté (et la marge ment dès
//    aujourd'hui).
//
// CE QUE CE TEST DEVIENDRA
// -------------------------
// Le point 2 est un PANSEMENT D'ATTENTE, pas un acquis : au branchement de
// la projection (B.4/B.5/B.9 du plan, `test-conservation-totaux.cjs` déjà
// écrit), le temps chronométré entrera dans le total et la mention se
// retirera. Ce jour-là, les assertions §3 ci-dessous s'inverseront — c'est
// prévu, et elles disent laquelle et pourquoi. Le point 1, lui, est
// définitif.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')

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

const D = charger('src/derive.ts')
const T = charger('src/temps.ts')
const P = charger('src/pointages.ts')

/**
 * Ce que la personne LIT, et les identifiants réellement IMPORTÉS — deux
 * lectures par le compilateur, pour la raison qui a déjà servi à
 * `test-tableaux.cjs` : le fichier explique la correction en commentaire,
 * avec les mêmes mots que le code. Une recherche sur le texte brut confondrait
 * la phrase affichée et la phrase expliquée, et passerait au vert sur un
 * écran qui n'affiche plus rien.
 */
function arbre(chemin) {
  return ts.createSourceFile(chemin, lire(chemin), ts.ScriptTarget.ES2022, true)
}

function textesAffiches(chemin) {
  const sortie = []
  const parcourir = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) sortie.push(n.text)
    else if (ts.isTemplateExpression(n)) sortie.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text))
    else if (ts.isJsxText(n)) sortie.push(n.text)
    ts.forEachChild(n, parcourir)
  }
  parcourir(arbre(chemin))
  return sortie.join(' • ')
}

/** les noms importés d'un module donné — jamais ceux cités en commentaire */
function importesDe(chemin, module) {
  const noms = []
  const parcourir = (n) => {
    if (ts.isImportDeclaration(n) && n.moduleSpecifier.text === module) {
      const clause = n.importClause?.namedBindings
      if (clause && ts.isNamedImports(clause)) noms.push(...clause.elements.map((e) => e.name.text))
    }
    ts.forEachChild(n, parcourir)
  }
  parcourir(arbre(chemin))
  return noms
}

// --- 1. le cas du plan (§5.3) : deux jours de congé, 21 h saisies -----------
//
// « Le test du badge honnête : une semaine avec deux jours de congé saisie à
//   21 h s'affiche complète. » Trois cas concrets à vérifier à la main en
//   cinq minutes, dit le plan. Celui-ci se vérifie ici, tout seul.

const SEMAINE = '2026-08-03' // lundi
const etat = () => ({
  settings: { heuresParJour: 7, personnes: ['Julien', 'Zoé'] },
  absences: [
    // Zoé pose le jeudi et le vendredi
    { id: 'a1', personne: 'Zoé', debut: '2026-08-06', fin: '2026-08-07', motif: 'congés' },
  ],
  temps: [
    { id: 't1', personne: 'Zoé', semaine: SEMAINE, projetId: 'P-01', phase: 'DCE', heures: 21 },
  ],
  tempsHorsProjet: [],
  projets: [],
  phases: [],
})

{
  const capacite = D.capacitePersonneSemaine(etat(), 'Zoé', SEMAINE)
  assert.equal(capacite, 21, '35 h nominales − 2 jours × 7 h de congé = 21 h RÉELLEMENT attendues')

  const total = T.totalSemaine(etat(), 'Zoé', SEMAINE)
  assert.equal(total, 21, 'les 21 h saisies sont bien comptées')

  assert.equal(
    T.etatSemaine(total, capacite),
    'complete',
    'LE cas du §5.3 du plan : deux jours de congé, 21 h saisies ⇒ semaine COMPLÈTE',
  )
  assert.equal(
    T.TONS_ETAT[T.etatSemaine(total, capacite)],
    'ok',
    'et la pastille est verte : le mot et la couleur sortent du même état, ils ne peuvent pas se contredire',
  )

  // ce que faisait l'écran AVANT : comparer à 35 h fixes
  assert.equal(
    T.etatSemaine(total, D.capaciteSemaine(etat())),
    'incomplete',
    'avec la capacité NOMINALE (35 h), la même semaine restait « incomplète » — impossible à verdir sans déclarer des heures non travaillées',
  )
}

// --- 2. la capacité est PERSONNELLE, et sait se taire -----------------------

{
  assert.equal(
    D.capacitePersonneSemaine(etat(), 'Julien', SEMAINE),
    35,
    'le congé de Zoé n’ampute pas la capacité de Julien : la capacité se calcule par personne',
  )

  const toutePartie = etat()
  toutePartie.absences = [{ id: 'a2', personne: 'Zoé', debut: '2026-08-03', fin: '2026-08-09', motif: 'congés' }]
  assert.equal(
    D.capacitePersonneSemaine(toutePartie, 'Zoé', SEMAINE),
    0,
    'semaine entièrement absente ⇒ capacité 0 : aucune heure n’est attendue',
  )
  // et l'écran doit alors se TAIRE plutôt que de réclamer — le verdict n'a
  // pas de sens quand rien n'est attendu (division par une capacité nulle)
  assert.match(
    lire('src/modules/Temps.tsx'),
    /capacite > 0 \?/,
    'à capacité nulle, l’écran ne rend pas de verdict : un badge « incomplète » sur une semaine de congés est exactement le badge qui se fait ignorer',
  )

  // week-end : les congés ne comptent que sur les cinq jours ouvrés
  const weekend = etat()
  weekend.absences = [{ id: 'a3', personne: 'Zoé', debut: '2026-08-08', fin: '2026-08-09', motif: 'congés' }]
  assert.equal(
    D.capacitePersonneSemaine(weekend, 'Zoé', SEMAINE),
    35,
    'un « congé » posé sur un samedi-dimanche ne retire aucune heure de capacité',
  )
}

// --- 3. l'écran lit cette autorité, et la dit ------------------------------

const ecran = lire('src/modules/Temps.tsx')
const afficheTemps = textesAffiches('src/modules/Temps.tsx')

{
  assert.ok(
    importesDe('src/modules/Temps.tsx', '../derive').includes('capacitePersonneSemaine'),
    'l’écran du temps IMPORTE `capacitePersonneSemaine` — une seule autorité pour la capacité (règle du dépôt)',
  )
  // l'assertion vise la ligne du BADGE, et pas seulement la présence du nom
  // quelque part dans le fichier : la grille du bureau appelle la même
  // fonction, et une capacité juste dans la grille ne rend pas le badge juste
  assert.match(
    ecran,
    /const capacite = capacitePersonneSemaine\(state, personne, semaine\)/,
    'le dénominateur du badge de « Ma semaine » EST la capacité congés déduits — pas un forfait, pas la capacité d’une autre vue',
  )
  assert.match(
    ecran,
    /etatSemaine\(total, capacite\)/,
    'le verdict compare le total à la capacité RÉELLE, jamais à un théorique fixe',
  )
  assert.match(
    afficheTemps,
    /congés déduits/,
    'l’écran DIT pourquoi le dénominateur a bougé : « sur 21 h (congés déduits) » — sinon le chiffre paraît faux',
  )

  // la vue téléphone doit recevoir la MÊME capacité, semaine par semaine :
  // une capacité unique passée aux six colonnes ferait diverger les deux vues
  // dès qu'une seule d'entre elles porte un congé
  assert.match(
    ecran,
    /bilanSemaines\(state, personne, \[s\], capacitePersonneSemaine\(state, personne, s\)\)/,
    'la fiche du téléphone calcule la capacité SEMAINE PAR SEMAINE : sinon les deux vues du même écran donnent deux verdicts',
  )

  // Le papier de la réunion dit la même chose que l'écran. On vise le CORPS
  // du générateur PDF, et pas le fichier entier : Planning.tsx affiche aussi
  // le plan de charge à l'écran, et une capacité juste à l'écran laisserait
  // le PDF sortir « confortable » là où l'écran sort rouge — or c'est le PDF
  // qu'on regarde en réunion, et qu'on envoie.
  const planning = lire('src/modules/Planning.tsx')
  const depuis = planning.indexOf('function ouvrirChargePDF')
  assert.ok(depuis > 0, 'le générateur PDF du plan de charge doit exister')
  const pdfCharge = planning.slice(depuis, planning.indexOf('\nfunction ', depuis + 10))
  assert.ok(pdfCharge.length > 500, 'le corps du générateur PDF doit être délimité, sinon on ne vérifie rien')
  assert.match(
    pdfCharge,
    /const capP = capacitePersonneSemaine\(/,
    'la CASE de chaque personne, sur le papier, se colore contre sa capacité congés déduits — sinon le PDF sort « confortable » là où l’écran sort rouge',
  )
  assert.match(
    pdfCharge,
    /capEquipe = equipe\.reduce\(\(s, pers\) => s \+ capacitePersonneSemaine\(/,
    'la ligne de TOTAL de l’équipe aussi : c’est celle qu’on lit en réunion pour dire « on peut prendre ce projet »',
  )
}

// --- 4. le temps chronométré est VISIBLE quelque part ----------------------
//
// Tant que la projection n'est pas branchée, la seule protection est que le
// temps enregistré se VOIE, avec les trois gestes qui restent humains :
// voir, corriger, supprimer. Sans cela il n'existe nulle part.

{
  // la prémisse, vérifiée et non supposée : le total de la semaine ne lit PAS
  // les pointages. C'est ce qui rend la mention « non reporté » vraie.
  // AU BRANCHEMENT (B.4/B.5/B.9), c'est CETTE assertion qui s'inverse en
  // premier — et le bloc d'attente du §4 se retire avec elle.
  assert.doesNotMatch(
    lire('src/temps.ts'),
    /pointages/,
    'le total de la semaine ignore encore les pointages : c’est le fait que l’écran doit avouer, pas cacher',
  )

  assert.match(
    afficheTemps,
    /Temps chronométré non reporté/,
    'sous « Ma semaine », le temps chronométré de la semaine s’affiche — sinon il n’existe nulle part (T4)',
  )
  assert.match(
    ecran,
    /state\.pointages/,
    'le chiffre vient de la collection réellement écrite par le chrono, pas d’une seconde mémoire',
  )
  assert.match(
    afficheTemps.replace(/\s+/g, ' '),
    /ni dans le total ci-dessus, ni dans la marge/,
    'la mention dit EXACTEMENT ce qui n’est pas compté : le total de l’écran et la marge des projets',
  )

  // les trois gestes humains — le report reste une décision (§15)
  assert.match(afficheTemps, /Voir le détail/, 'voir : la liste se déplie')
  assert.match(ecran, /const corrigerDuree = /, 'corriger : la durée d’un chrono se rectifie sur place')
  assert.match(ecran, /const supprimerPointage = /, 'supprimer : un chrono oublié en marche se retire')
  assert.match(
    ecran,
    /const supprimerPointage = [\s\S]{0,600}?undo: \(\) => replace\(snap\)/,
    'la suppression laisse un « Annuler » — patron du dépôt (ui.tsx), sans quoi le geste devient risqué',
  )
  // …et les trois gestes sont réellement CÂBLÉS à un contrôle : une fonction
  // écrite mais jamais appelée protège exactement autant qu'aucune fonction
  for (const geste of ['corrigerDuree', 'supprimerPointage']) {
    assert.ok(
      (ecran.match(new RegExp(`\\b${geste}\\b`, 'g')) || []).length >= 2,
      `« ${geste} » doit être appelé depuis la liste, pas seulement déclaré`,
    )
  }
  // ce que l'écran ne fait PAS : reporter tout seul. On lit les IMPORTS,
  // pas le texte : le fichier nomme `projeterVersTemps` en commentaire, pour
  // expliquer précisément qu'il ne l'appelle pas.
  assert.deepEqual(
    importesDe('src/modules/Temps.tsx', '../pointages').sort(),
    ['heuresDepuisMinutes', 'lundiDe'],
    'l’écran d’attente ne branche pas la projection en douce : il n’emprunte à pointages.ts que de quoi LIRE. Le report est le livrable B.5, avec son test de conservation des totaux.',
  )

  // un chrono EN COURS n'est pas du temps passé : il ne se compte pas
  assert.match(
    ecran,
    /p\.personne === personne && p\.fin &&/,
    'seuls les chronos ARRÊTÉS sont comptés : un chrono en cours est du temps en train de passer',
  )

  // une seule division, à la fin — la règle de pointages.ts
  assert.match(
    ecran,
    /heuresDepuisMinutes\(\s*\n?\s*chronosSemaine\.reduce/,
    'les minutes s’additionnent en entiers et ne se divisent qu’une fois : c’est la règle de conservation des totaux',
  )
  assert.equal(P.heuresDepuisMinutes(80), 1.33, '80 min = 1,33 h — l’arrondi vit à un seul endroit')
  assert.equal(P.heuresDepuisMinutes(0), 0)
}

// --- 5. le toast d'arrêt dit la même chose que l'écran --------------------
//
// Deux formulations pour le même événement feraient dire au même arrêt deux
// choses différentes selon l'endroit d'où on l'a cliqué. Le message vit dans
// `ChronoBarre.tsx` et la fiche tâche l'IMPORTE.

{
  const barre = lire('src/modules/ChronoBarre.tsx')
  assert.match(
    barre,
    /export function messageArretHonnete/,
    'le message d’arrêt est une fonction exportée : une seule formulation pour tous les points d’arrêt',
  )
  assert.match(
    textesAffiches('src/modules/ChronoBarre.tsx'),
    /Pas encore compté dans la feuille/,
    'le toast avoue ce que « X h enregistrées » laissait croire — sans quoi le temps est cru compté, et la marge ment',
  )
  assert.match(
    barre,
    /if \(!enregistre\) return message/,
    'rien d’enregistré (chrono sous la minute) ⇒ aucune promesse ajoutée : on ne renvoie pas vers une ligne qui n’existe pas',
  )

  const fiche = lire('src/modules/FicheTache.tsx')
  assert.match(
    fiche,
    /import \{ messageArretHonnete \} from '\.\/ChronoBarre'/,
    'la fiche tâche IMPORTE le message au lieu de le reformuler : deux phrases pour le même arrêt feraient deux vérités',
  )

  // L'AUTRE endroit où le temps devait être visible, et où il mentait le plus
  // fort : « Enregistré : 0:00 » juste sous le bouton qu'on vient d'arrêter
  // (T4). `Tache.tempsEnregistre` est une projection non branchée ; la fiche
  // lit donc le temps là où il EST — par `tempsParTache`, l'autorité de cette
  // notion — et dit qu'il n'est pas compté.
  assert.ok(
    importesDe('src/modules/FicheTache.tsx', '../pointages').includes('tempsParTache'),
    'la fiche tâche lit le temps chronométré par `tempsParTache` (pointages.ts) : recompter à la main ferait une seconde autorité pour la même notion',
  )
  assert.match(
    textesAffiches('src/modules/FicheTache.tsx'),
    /chronométrées sur cette tâche, pas encore comptées/,
    'la fiche tâche AVOUE l’écart au lieu d’afficher « Enregistré : 0 h » sous un chrono qu’on vient d’arrêter — le mensonge le plus visible du constat T4',
  )
}

console.log(
  'Badge de semaine & chrono : deux jours de congé + 21 h saisies ⇒ « complète » (35 h fixes disaient ' +
    '« incomplète »), capacité personnelle, nulle quand la semaine est entièrement absente, même règle sur ' +
    'le papier du plan de charge ; et le temps chronométré non reporté est visible sous « Ma semaine » avec ' +
    'ses trois gestes, un seul message d’arrêt pour tous les points d’arrêt.',
)
