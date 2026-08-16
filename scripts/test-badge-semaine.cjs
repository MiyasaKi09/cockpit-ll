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
// 2. LE TEMPS QUI S'ÉVAPORE (T4, action 26). Arrêter un chrono affichait
//    « 1 h 20 enregistrées » alors que `projeterVersTemps` n'avait AUCUN
//    appelant : la collection était écrite-seulement, et l'écran portait un
//    PANSEMENT D'ATTENTE — la mention « non reporté » et son avertissement.
//
// CE QUE CE TEST EST DEVENU (B.5)
// --------------------------------
// La première version de ce fichier annonçait sa propre inversion : « au
// branchement de la projection, la mention se retirera ». C'est fait — le
// store réconcilie `state.temps` avec les pointages à chaque mutation et
// sur tout état entrant (`reconcilierTempsChrono`, porte tenue par
// `test-conservation-totaux.cjs` §10). Le §4 tient désormais la nouvelle
// vérité : le temps chronométré est COMPTÉ, il reste visible avec ses
// gestes, et l'ancien avertissement a disparu — le maintenir ferait
// RESSAISIR du temps déjà compté, donc le compter deux fois. Le point 1,
// lui, était définitif et n'a pas bougé.

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

// --- 4. le temps chronométré est COMPTÉ, et reste visible avec ses gestes --
//
// Depuis B.5, un chrono arrêté qui porte projet et phase entre dans
// `state.temps` en ligne `tp-…` (réconciliation du store) : le total de la
// semaine et la marge le comptent SANS lire les pointages. Ce paragraphe
// tient trois choses : le total garde un seul chemin de lecture, l'écran
// montre le chrono avec ses gestes — corriger, supprimer, et RATTACHER ce
// qui n'a pas de projet ou de phase — et l'ancien avertissement a disparu.

{
  // le total ne lit toujours PAS les pointages : la projection entre par le
  // STORE, en écriture. Un second chemin de LECTURE vers la même grandeur
  // finit toujours par diverger — la règle de derive.ts vaut pour temps.ts.
  assert.doesNotMatch(
    lire('src/temps.ts'),
    /pointages/,
    'le total lit `state.temps`, où la projection ÉCRIT — jamais les pointages directement : deux chemins vers la même grandeur divergent toujours',
  )

  // l'ancien pansement a disparu : le maintenir ferait RESSAISIR du temps
  // déjà compté — donc le compter deux fois, le défaut exact qu'il fermait
  assert.doesNotMatch(
    afficheTemps,
    /non reporté|reporter à la main/,
    'l’avertissement d’attente s’est retiré avec le branchement, comme la première version de ce test l’annonçait',
  )
  assert.match(
    afficheTemps,
    /Au chrono cette semaine/,
    'compté n’est pas caché : le chrono reste visible sous « Ma semaine » — c’est là que vivent ses gestes',
  )
  assert.match(
    ecran,
    /state\.pointages/,
    'le chiffre du bloc vient de la collection réellement écrite par le chrono, pas d’une seconde mémoire',
  )

  // les gestes humains — corriger, supprimer, rattacher
  assert.match(afficheTemps, /Voir le détail/, 'voir : la liste se déplie')
  assert.match(ecran, /const corrigerDuree = /, 'corriger : la durée d’un chrono se rectifie sur place')
  assert.match(ecran, /const supprimerPointage = /, 'supprimer : un chrono oublié en marche se retire')
  assert.match(
    ecran,
    /const rattacherPointage = /,
    'rattacher : le SEUL pointage que la projection ne peut pas compter est celui sans projet ou sans phase — le geste qui répare vit ici',
  )
  assert.match(
    afficheTemps,
    /sans projet ou sans phase/,
    'et l’écran DIT pourquoi ces heures-là n’entrent pas dans la feuille : la clé exige projet ET phase',
  )
  assert.match(
    ecran,
    /const supprimerPointage = [\s\S]{0,600}?undo: \(\) => replace\(snap\)/,
    'la suppression laisse un « Annuler » — patron du dépôt (ui.tsx), sans quoi le geste devient risqué',
  )
  assert.match(
    ecran,
    /const rattacherPointage = [\s\S]{0,900}?undo: \(\) => replace\(snap\)/,
    'le rattachement aussi laisse un « Annuler » : il fait bouger le total et la marge au geste même',
  )
  // …et les gestes sont réellement CÂBLÉS à un contrôle : une fonction
  // écrite mais jamais appelée protège exactement autant qu'aucune fonction
  for (const geste of ['corrigerDuree', 'supprimerPointage', 'rattacherPointage']) {
    assert.ok(
      (ecran.match(new RegExp(`\\b${geste}\\b`, 'g')) || []).length >= 2,
      `« ${geste} » doit être appelé depuis la liste, pas seulement déclaré`,
    )
  }
  // ce que l'écran emprunte à pointages.ts : de quoi LIRE et DISTINGUER —
  // toujours pas de quoi projeter lui-même. La projection n'a qu'un
  // appelant, le store ; un second site de projection divergerait.
  assert.deepEqual(
    importesDe('src/modules/Temps.tsx', '../pointages').sort(),
    ['estLigneChrono', 'facturableParDefaut', 'heuresDepuisMinutes', 'lundiDe'],
    'l’écran lit, distingue les lignes projetées et applique la règle B.7 du facturable — il ne PROJETTE pas : `reconcilierTempsChrono` n’a qu’un appelant, le store',
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
  // le cas nominal (projet + phase) passe SANS mention : le temps est compté,
  // « X h enregistrées » est toute la vérité — une confirmation de plus à
  // chaque arrêt serait du bruit, et le bruit finit ignoré comme les badges
  assert.match(
    barre,
    /if \(pointage\.projetId && pointage\.phase\) return message/,
    'projet ET phase ⇒ le message d’arrêt n’ajoute rien : le pointage entre tout seul dans la feuille et la marge',
  )
  assert.match(
    barre,
    /if \(!pointage\) return message/,
    'rien d’enregistré (chrono sous la minute) ⇒ aucune promesse ajoutée : on ne renvoie pas vers une ligne qui n’existe pas',
  )
  // le seul cas qui parle encore : sans projet ou sans phase, la clé de la
  // feuille exige les deux — et le message donne le geste qui répare
  assert.match(
    textesAffiches('src/modules/ChronoBarre.tsx'),
    /pas compté dans la feuille — à rattacher sous « Ma semaine »/,
    'un pointage sans projet ou sans phase est le seul que la projection ne compte pas : le toast le dit AVEC le geste qui répare',
  )
  assert.doesNotMatch(
    textesAffiches('src/modules/ChronoBarre.tsx'),
    /Pas encore compté/,
    'l’ancien pansement d’attente a disparu : il promettait un report à la main qui compterait le temps deux fois',
  )

  const fiche = lire('src/modules/FicheTache.tsx')
  assert.match(
    fiche,
    /import \{ messageArretHonnete \} from '\.\/ChronoBarre'/,
    'la fiche tâche IMPORTE le message au lieu de le reformuler : deux phrases pour le même arrêt feraient deux vérités',
  )

  // L'AUTRE endroit où le temps est visible : la fiche tâche lit le temps
  // chronométré par `tempsParTache` — l'autorité de la notion — et dit le
  // NOUVEAU partage : compté dans la feuille avec projet et phase, compté
  // ici seulement sans eux, avec le geste qui répare.
  assert.ok(
    importesDe('src/modules/FicheTache.tsx', '../pointages').includes('tempsParTache'),
    'la fiche tâche lit le temps chronométré par `tempsParTache` (pointages.ts) : recompter à la main ferait une seconde autorité pour la même notion',
  )
  assert.match(
    textesAffiches('src/modules/FicheTache.tsx'),
    /chronométrées sur cette tâche/,
    'le temps chronométré d’une tâche reste visible sur sa fiche — c’est là qu’on vient de cliquer « arrêter »',
  )
  assert.doesNotMatch(
    textesAffiches('src/modules/FicheTache.tsx'),
    /pas encore comptées/,
    'la fiche ne dit plus « pas encore comptées » : depuis B.5 c’est faux pour tout pointage portant projet et phase',
  )
  assert.match(
    textesAffiches('src/modules/FicheTache.tsx').replace(/\s+/g, ' '),
    /sans projet ou sans phase, donc hors feuille de temps/,
    'et quand une partie du temps n’entre PAS dans la feuille, la fiche le dit avec la raison et le chemin du rattachement',
  )
}

console.log(
  'Badge de semaine & chrono : deux jours de congé + 21 h saisies ⇒ « complète » (35 h fixes disaient ' +
    '« incomplète »), capacité personnelle, nulle quand la semaine est entièrement absente, même règle sur ' +
    'le papier du plan de charge ; et le temps chronométré est COMPTÉ (B.5) — visible sous « Ma semaine » ' +
    'avec ses gestes (corriger, supprimer, rattacher), un seul message d’arrêt qui ne parle plus que des ' +
    'pointages sans projet ou sans phase.',
)
