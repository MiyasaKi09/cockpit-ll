// M.3 — le chrono au doigt (§9.2, §9.3, §9.4, §17, critère 7).
//
// Un défaut de comptage du temps ne se voit pas à l'œil. Il se voit sur la
// facture, trois mois plus tard, quand plus personne ne peut dire ce qui
// s'est passé ce jour-là. C'est pour ça que toute la logique est pure et
// que `maintenant` est passé en argument : une horloge lue au fond du
// calcul rendrait ce fichier impossible à écrire.
//
// Cinq choses tenues ici :
//
//   1. la bascule arrête ET démarre en un geste — sans quoi il faudrait se
//      souvenir d'arrêter avant de démarrer, on oubliera, et deux chronos
//      compteraient la même heure ;
//   2. un chrono arrêté sous la minute n'écrit rien, et le dit ;
//   3. jamais deux chronos pour une même personne — la règle que la clé
//      primaire de `chrono_actif` tient en base, tenue aussi en local ;
//   4. l'activité d'un pointage reste dans le référentiel que la base
//      accepte, sinon l'arrêt serait refusé à la seconde où le temps compte ;
//   5. UN composant, DEUX montages.

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

const C = charger('src/chrono.ts')
const P = charger('src/pointages.ts')

const T0 = '2026-08-03T09:00:00.000Z'
const apres = (minutes, secondes = 0) =>
  new Date(Date.parse(T0) + minutes * 60000 + secondes * 1000).toISOString()

// --- la durée qui défile ----------------------------------------------------

{
  const c = C.demarrerChrono('Julien', { libelle: 'Relevé du site' }, T0)
  assert.equal(C.secondesEcoulees(c, apres(0, 45)), 45)
  assert.equal(C.secondesEcoulees(c, apres(90)), 5400)

  // Une horloge peut reculer (mise à l'heure réseau, fuseau, veille) : une
  // durée négative afficherait « -3:12 » et, pire, produirait un pointage
  // que `pointages_minutes_chk` refuserait.
  assert.equal(C.secondesEcoulees(c, '2026-08-03T08:00:00.000Z'), 0, 'jamais négatif')
  assert.equal(C.secondesEcoulees({ debut: 'n’importe quoi' }, T0), 0, 'une date illisible vaut zéro, pas NaN')

  assert.equal(C.formaterDuree(45), '0:45')
  assert.equal(C.formaterDuree(605), '10:05')
  assert.equal(C.formaterDuree(3600), '1 h 00')
  assert.equal(C.formaterDuree(4020), '1 h 07', 'au-delà de l’heure, la seconde est du bruit')
  assert.equal(C.formaterDuree(-10), '0:00')

  assert.equal(C.libelleCourt('Relevé', 22), 'Relevé')
  assert.equal(
    C.libelleCourt('Dépôt du permis de construire — lot 3', 22).length,
    22,
    'un bouton ne s’élargit pas',
  )
  assert.ok(C.libelleCourt('Dépôt du permis de construire', 22).endsWith('…'))
}

// --- 2. sous la minute, rien n'est écrit — et c'est dit --------------------

{
  const c = C.demarrerChrono('Julien', { projetId: 'P01', libelle: 'x' }, T0)

  const court = C.arreterChrono(c, apres(0, 30))
  assert.equal(court.pointage, null, 'un chrono démarré par erreur ne laisse pas de ligne vide')
  assert.match(court.message, /rien n’est enregistré/, 'le refus est DIT : un temps perdu en silence est pire')

  const juste = C.arreterChrono(c, apres(1))
  assert.ok(juste.pointage, 'à la minute, on enregistre')
  assert.equal(juste.pointage.minutes, 1)

  const long = C.arreterChrono(c, apres(97))
  assert.equal(long.pointage.minutes, 97)
  assert.equal(long.pointage.source, 'chrono', 'la source distingue le chrono de la saisie et de la reprise')
  assert.equal(long.pointage.fin, apres(97), 'la fin est posée : un pointage sans fin est un chrono qui tourne')
  assert.equal(long.pointage.facturable, true, 'B.7 : un temps sur projet est facturable par défaut')
  assert.ok(long.pointage.id, 'un identifiant est généré ICI — c’est lui qui rend un rejeu idempotent')
}

{
  // Hors projet : la règle de B.7 s'inverse, et c'est le même code qui décide.
  const c = C.demarrerChrono('Zoé', { libelle: 'Administratif' }, T0)
  const r = C.arreterChrono(c, apres(30))
  assert.equal(r.pointage.facturable, false, 'sans projet, pas facturable — `facturableParDefaut`')
  assert.equal(r.pointage.projetId, null)
}

// --- 1. la bascule : un geste, deux effets ---------------------------------

{
  const premier = C.demarrerChrono('Julien', { projetId: 'P01', tacheId: 't1', libelle: 'Relevé' }, T0)
  const { chrono, arret } = C.basculerChrono(premier, 'Julien', { projetId: 'P07', tacheId: 't2', libelle: 'PC' }, apres(42))

  // Nommé explicitement plutôt que déréférencé : sans cette ligne, une
  // bascule qui n'arrête plus rien échoue sur un « Cannot read properties of
  // null », qui dit qu'une chose est cassée sans dire laquelle.
  assert.ok(
    arret,
    'la bascule n’arrête plus le chrono en cours : le temps déjà écoulé serait perdu sans un mot, ' +
      'et la personne ne s’en apercevrait qu’à la facture',
  )
  assert.equal(arret.pointage.minutes, 42, 'le premier est enregistré, pas abandonné')
  assert.equal(arret.pointage.tacheId, 't1')
  assert.equal(chrono.tacheId, 't2', 'le second démarre')
  assert.equal(chrono.debut, apres(42), 'il démarre à l’instant de la bascule, sans trou ni recouvrement')

  // Le premier chrono d'une session n'arrête rien, et ne doit pas prétendre
  // le contraire — un message « 0 min enregistrées » au premier démarrage
  // ferait douter de ce qui vient d'être écrit.
  const neuf = C.basculerChrono(null, 'Julien', { tacheId: 't1' }, T0)
  assert.equal(neuf.arret, null)
  assert.equal(neuf.chrono.tacheId, 't1')
}

// --- 3. jamais deux chronos pour une même personne -------------------------

{
  let chronos = []
  chronos = C.poserChrono(chronos, C.demarrerChrono('Julien', { tacheId: 't1' }, T0), 'Julien')
  chronos = C.poserChrono(chronos, C.demarrerChrono('Zoé', { tacheId: 't9' }, T0), 'Zoé')
  assert.equal(chronos.length, 2, 'deux personnes, deux chronos : c’est permis')

  chronos = C.poserChrono(chronos, C.demarrerChrono('Julien', { tacheId: 't2' }, apres(10)), 'Julien')
  assert.equal(chronos.length, 2, 'le second chrono de Julien REMPLACE le premier, il ne s’ajoute pas')
  assert.equal(C.chronoDe(chronos, 'Julien').tacheId, 't2')
  assert.equal(C.chronoDe(chronos, 'Zoé').tacheId, 't9', 'celui de Zoé n’a pas bougé')

  chronos = C.poserChrono(chronos, null, 'Julien')
  assert.equal(C.chronoDe(chronos, 'Julien'), null, 'arrêter retire la ligne')
  assert.equal(chronos.length, 1)

  assert.equal(C.chronoDe(chronos, ''), null, 'sans personne, aucun chrono — pas celui du premier venu')
  assert.equal(C.chronoDe(null, 'Julien'), null, 'un état incomplet ne fait pas tomber l’écran')
}

// --- 4. l'activité reste dans le référentiel que la base accepte -----------

{
  // `pointages_activite_chk` refuse tout ce qui sort de cette liste. Un
  // chrono dont l'activité en sortirait échouerait À L'ARRÊT — c'est-à-dire
  // au moment précis où la personne croit avoir sauvegardé son temps.
  const migration = lire('supabase/migrations/20260801090000_pointages_et_chrono.sql')
  const enBase = /activite in \(([^)]*)\)/.exec(migration)[1]
    .split(',')
    .map((v) => v.trim().replace(/'/g, ''))
    .sort()
  assert.deepEqual(
    [...P.TYPES_ACTIVITE].sort(),
    enBase,
    'le référentiel du client et celui de la base doivent être le MÊME jeu de valeurs',
  )

  const c = C.demarrerChrono('Julien', { libelle: 'x' }, T0)
  assert.ok(enBase.includes(c.activite), `l’activité par défaut (${c.activite}) doit être acceptée en base`)
}

// --- 5. un composant, deux montages ---------------------------------------

{
  const app = lire('src/App.tsx')
  const montages = [...app.matchAll(/<ChronoBarre emplacement="(\w+)"/g)].map((m) => m[1])
  assert.deepEqual(
    montages.sort(),
    ['laterale', 'topbar'],
    'les deux emplacements du §3.5 : barre supérieure au téléphone, barre latérale au poste',
  )
  assert.equal(
    (app.match(/import ChronoBarre/g) || []).length,
    1,
    'UN composant. Deux composants divergeraient : celui du téléphone recevrait la correction, ' +
      'celui du bureau l’attendrait six mois, et le temps compté ne serait plus le même selon l’écran.',
  )

  const barre = lire('src/modules/ChronoBarre.tsx')
  assert.match(barre, /if \(!chrono\) return null/, 'rien ne s’affiche quand rien ne tourne : pas de bouton mort')
  assert.doesNotMatch(barre, /minutes|Math\.floor\(\(/, 'aucun calcul de durée dans le composant : tout est dans chrono.ts')

  const css = lire('src/styles.css')
  assert.match(css, /\.chrono-stop \{[\s\S]*?\}/, 'le bouton d’arrêt est stylé')
  const coarse = /@media \(pointer: coarse\)([\s\S]*?)\n\}/g
  const tactile = [...css.matchAll(coarse)].map((m) => m[1]).join('\n')
  assert.match(tactile, /\.chrono-stop \{[^}]*44px/, 'la cible tactile fait 44 px (§17) — au doigt, pas à la souris')

  // La fiche tâche ne doit plus annoncer un chrono à venir : c'est fait.
  const fiche = lire('src/modules/FicheTache.tsx')
  assert.match(fiche, /Démarrer le chrono/, 'le §19.3 est servi : on démarre là où la cible est connue')
  assert.doesNotMatch(fiche, /arrive avec le livrable B\.6/, 'la note d’attente n’a plus lieu d’être')
  assert.match(fiche, /basculerChrono/, 'la fiche passe par la bascule, pas par un démarrage nu')
}

// --- ce que le chrono produit se projette comme le reste ------------------

{
  // La projection de B.5 doit accepter un pointage de chrono sans rien de
  // spécial : si le chrono produisait une forme à part, le temps qu'il compte
  // n'arriverait jamais dans la feuille.
  const c = C.demarrerChrono('Julien', { projetId: 'P01', phase: 'APD', libelle: 'x' }, T0)
  const { pointage } = C.arreterChrono(c, apres(120))
  const lignes = P.projeterVersTemps([pointage])
  assert.equal(lignes.length, 1, 'un pointage de chrono se projette comme un autre')
  assert.equal(lignes[0].heures, 2)
  assert.equal(lignes[0].personne, 'Julien')
  assert.equal(lignes[0].projetId, 'P01')
}

console.log(
  'Chrono : bascule en un geste (le premier temps est enregistré, jamais abandonné), rien sous la minute ' +
    'et le refus est dit, un seul chrono par personne, activité alignée sur la contrainte de la base, ' +
    'un composant monté aux deux emplacements du §3.5 — et ce qu’il produit se projette comme le reste.',
)
