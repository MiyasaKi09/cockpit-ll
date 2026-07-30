// Livrable 0.13 — « baseline des heures prévues par phase » (CDC §11.3,
// critère 15 du §22).
//
// Le défaut couvert ne fait aucun bruit et ne se rattrape pas : « Recalculer
// la répartition » remplace `projet.phases` en entier. Tant que la prévision
// vivait là, chaque recalcul remettait l'écart prévu / réel à zéro sur une
// nouvelle cible, et la mesure de la semaine écoulée disparaissait sans
// message d'erreur ni ligne de journal. Le §22 note d'ailleurs le critère 15
// comme « le second plus exposé » des critères protégés par rien.
//
// Ce que ce test verrouille :
//   1. la baseline ne vit PAS dans `Phase` — c'est la garantie structurelle,
//      et elle vaut mieux qu'une précaution dans le bouton : un futur
//      producteur de phases n'a rien à savoir pour la respecter ;
//   2. `phasesParDefaut`, le producteur réel du recalcul, ne fabrique aucun
//      champ de référence ;
//   3. le geste de recalcul, tel qu'il est écrit dans Projets.tsx, ne touche
//      pas `baselineHeures` — et le recalcul rejoué laisse l'écart intact ;
//   4. `heuresBaseline` ne renvoie jamais 0 pour « pas de référence » : un 0
//      se lirait comme un dépassement intégral ;
//   5. le palier v20 ne rejoue pas sa reprise à chaque chargement — sinon la
//      référence redéfinie ce matin serait réécrite au rechargement ;
//   6. la reprise ne se fait jamais passer pour une signature.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

/** charge un module TypeScript pur (sans React ni DOM) pour l'exercer */
function charger(fichier, dependances = {}) {
  const compile = ts.transpileModule(lire(fichier), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (dependances[id]) return dependances[id]
    throw new Error(`Import runtime inattendu dans ${fichier} : ${id}`)
  })
  return mod.exports
}

const util = charger('src/util.ts')
const miqcp = charger('src/miqcp.ts')
const facture = charger('src/facture.ts', { './util': util })
const derive = charger('src/derive.ts', { './miqcp': miqcp, './facture': facture, './util': util })

// --- 1. la référence vit HORS du tableau des phases -------------------------
//
// C'est ce qui rend le recalcul inoffensif. Rangée dans `Phase`, elle
// disparaîtrait avec `pr.phases = phasesParDefaut(...)`.

const types = lire('src/types.ts')
const bloc = (nom) => {
  const m = new RegExp(`export interface ${nom} \\{([\\s\\S]*?)\\n\\}`).exec(types)
  assert.ok(m, `src/types.ts : l’interface ${nom} est introuvable`)
  return m[1]
}

assert.doesNotMatch(
  bloc('Phase'),
  /baseline|reference|figee|heuresSignature/i,
  'src/types.ts : la baseline ne doit PAS être un champ de Phase — « Recalculer la répartition » remplace le tableau `phases` en entier et l’emporterait avec lui, sans erreur',
)
assert.match(
  bloc('Projet'),
  /baselineHeures\?: BaselineHeures \| null/,
  'src/types.ts : Projet doit porter `baselineHeures?: BaselineHeures | null` — nullable, car « volontairement sans référence » doit se distinguer de « jamais figée »',
)
const baseline = bloc('BaselineHeures')
for (const champ of ['le', 'origine', 'parPhase']) {
  assert.match(
    baseline,
    new RegExp(`\\n  ${champ}`),
    `src/types.ts : BaselineHeures doit déclarer ${champ} — une référence sans date ni provenance n’est pas traçable`,
  )
}
assert.match(
  baseline,
  /'signature' \| 'creation' \| 'reprise' \| 'revision'/,
  'src/types.ts : les origines de BaselineHeures sont une liste fermée — une reprise doit rester distinguable d’une signature',
)

// --- 2. le producteur du recalcul ne fabrique aucune référence --------------

const phasesRecalculees = miqcp.phasesParDefaut(172644.52, 90)
assert.ok(Array.isArray(phasesRecalculees) && phasesRecalculees.length > 0)
for (const ph of phasesRecalculees) {
  for (const cle of Object.keys(ph)) {
    assert.doesNotMatch(
      cle,
      /baseline|reference/i,
      `src/miqcp.ts : phasesParDefaut ne doit produire aucun champ de référence (${cle} sur ${ph.code})`,
    )
  }
}

// --- 3. le geste de recalcul, tel qu'il est écrit ---------------------------

const projets = lire('src/modules/Projets.tsx')
const debut = projets.indexOf('const recalculer = async () => {')
assert.ok(debut >= 0, 'src/modules/Projets.tsx : la fonction `recalculer` est introuvable — ce test doit être remis à jour AVEC elle')
// corps équilibré à partir de l'accolade ouvrante
let profondeur = 0
let fin = debut
for (let i = projets.indexOf('{', debut); i < projets.length; i++) {
  if (projets[i] === '{') profondeur++
  else if (projets[i] === '}') {
    profondeur--
    if (profondeur === 0) {
      fin = i + 1
      break
    }
  }
}
const corpsRecalcul = projets.slice(debut, fin)
assert.match(corpsRecalcul, /phasesParDefaut/, 'le corps extrait n’est pas celui du recalcul')
assert.doesNotMatch(
  corpsRecalcul,
  /pr\.baselineHeures\s*=|delete .*baselineHeures/,
  'src/modules/Projets.tsx : « Recalculer la répartition » ne doit JAMAIS écrire ni supprimer `baselineHeures` — c’est le critère 15 du §22 qui tombe',
)

// --- 4. l'écart survit à un recalcul ----------------------------------------
//
// L'exemple est celui du §11.3 mot pour mot : APD prévu 120 h, réel 148 h,
// écart +28 h. On rejoue ensuite la mutation exacte du bouton.

const projet = {
  id: 'P01',
  phases: [
    { code: 'APD', pctBase: 0.175, montantHT: 12000, debut: null, fin: null, heuresPrevues: 120 },
    { code: 'PRO', pctBase: 0.2, montantHT: 14000, debut: null, fin: null, heuresPrevues: 140 },
  ],
  baselineHeures: derive.baselineDepuisPhases(
    [
      { code: 'APD', heuresPrevues: 120 },
      { code: 'PRO', heuresPrevues: 140 },
    ],
    { le: '2026-01-15', par: 'Julien', origine: 'signature', honorairesBaseHT: 26000 },
  ),
}
const state = {
  temps: [
    { id: 't1', semaine: '2026-03-02', personne: 'Julien', projetId: 'P01', phase: 'APD', heures: 100 },
    { id: 't2', semaine: '2026-03-09', personne: 'Zoé', projetId: 'P01', phase: 'APD', heures: 48 },
  ],
}

const avant = derive.ecartHeures(state, projet, 'APD')
assert.equal(avant.baseline, 120, 'la référence de l’APD est celle de la signature')
assert.equal(avant.reel, 148)
assert.equal(avant.ecart, 28, 'l’écart du §11.3 est signé et vaut +28 h')
assert.equal(avant.surBaseline, true)
assert.equal(avant.derivePrevision, 0, 'la répartition courante n’a pas encore bougé')

// la mutation exacte du bouton : le tableau des phases est REMPLACÉ
projet.phases = miqcp.phasesParDefaut(26000, 90)

const apres = derive.ecartHeures(state, projet, 'APD')
assert.equal(apres.baseline, 120, 'RECALCUL : la prévision figée doit être intacte — critère 15')
assert.equal(apres.reel, 148, 'RECALCUL : les heures pointées ne bougent pas')
assert.equal(apres.ecart, 28, 'RECALCUL : l’écart prévu / réel doit rester +28 h, pas se recaler sur la nouvelle répartition')
assert.notEqual(
  apres.prevu,
  apres.baseline,
  'le jeu d’essai doit produire une répartition DIFFÉRENTE de la référence, sinon le test ne prouve rien',
)
assert.equal(
  apres.derivePrevision,
  Math.round((apres.prevu - 120) * 10) / 10,
  'la dérive de la prévision elle-même doit être lisible : c’est ce que la référence rend visible',
)
assert.equal(
  derive.heuresBaseline(projet),
  260,
  'RECALCUL : le total de la référence doit être intact',
)

// --- 5. pas de référence ≠ zéro heure prévue --------------------------------

const sansRef = { id: 'P02', phases: [{ code: 'APD', montantHT: 0, heuresPrevues: 40 }] }
assert.equal(
  derive.heuresBaseline(sansRef),
  null,
  'sans référence, heuresBaseline doit renvoyer null — un 0 se lirait comme « rien n’était prévu », donc comme un dépassement intégral',
)
const ecartSansRef = derive.ecartHeures({ temps: [] }, sansRef, 'APD')
assert.equal(ecartSansRef.surBaseline, false, 'l’écran doit pouvoir dire que l’écart n’est pas mesuré sur une référence figée')
assert.equal(ecartSansRef.reference, 40, 'faute de référence, l’écart retombe sur la répartition courante')
assert.equal(ecartSansRef.derivePrevision, null)
assert.equal(
  derive.heuresBaseline(projet, 'DIAG'),
  null,
  'une phase absente de la référence renvoie null — elle est née après le figeage, elle ne vaut pas 0 h',
)

// --- 6. le palier v20 : reprise UNE fois, et jamais déguisée ----------------

const ancien = { id: 'P03', phases: [{ code: 'APD', montantHT: 0, heuresPrevues: 190 }] }
const repris = derive.baselineApresMigration(ancien, true, '2026-07-30')
assert.ok(repris, 'palier v20 : un projet antérieur doit recevoir sa référence, sinon le prochain recalcul efface la mesure')
assert.equal(repris.origine, 'reprise', 'une répartition trouvée en place n’est PAS la prévision du contrat : elle ne doit jamais s’étiqueter « signature »')
assert.equal(repris.parPhase.APD, 190)

assert.equal(
  derive.baselineApresMigration(ancien, false, '2026-07-30'),
  undefined,
  'hors franchissement du palier, aucune référence ne doit être fabriquée : migrate() s’exécute à CHAQUE chargement',
)
assert.equal(
  derive.baselineApresMigration({ ...ancien, baselineHeures: null }, true, '2026-07-30'),
  null,
  '`null` veut dire « volontairement sans référence » — la reprise ne doit pas la ressusciter',
)
const dejaFigee = derive.baselineApresMigration(
  { ...ancien, baselineHeures: { le: '2025-01-01', origine: 'signature', parPhase: { APD: 170 } } },
  true,
  '2026-07-30',
)
assert.equal(dejaFigee.parPhase.APD, 170, 'une référence existante ne se réécrit pas au chargement')
assert.equal(dejaFigee.origine, 'signature')
assert.equal(
  derive.baselineApresMigration({ id: 'P04', phases: [] }, true, '2026-07-30'),
  undefined,
  'sans heure prévue, il n’y a rien à figer — une référence à 0 h ferait passer tout le réel pour du dépassement',
)

// une phase inconnue (import JSON, version future) gonflerait le total sans
// jamais apparaître dans une ligne du tableau
const nettoyee = derive.normaliserBaselineHeures({
  le: '2026-01-01',
  origine: 'fantaisie',
  parPhase: { APD: 100, LICORNE: 999, PRO: 'beaucoup' },
})
assert.deepEqual(Object.keys(nettoyee.parPhase), ['APD'], 'une phase hors PHASES_ORDRE doit être écartée de la référence')
assert.equal(nettoyee.origine, 'reprise', 'une origine hors liste retombe sur la moins engageante')
assert.equal(derive.heuresBaseline({ baselineHeures: nettoyee }), 100)

// --- 7. le palier est branché et documenté ----------------------------------

const seed = lire('src/seed.ts')
const version = /export const STATE_VERSION = (\d+)/.exec(seed)
assert.ok(version, 'src/seed.ts : STATE_VERSION introuvable')
assert.ok(
  Number(version[1]) >= 20,
  `src/seed.ts : STATE_VERSION doit passer le palier de la baseline (20 minimum, lu ${version[1]})`,
)
assert.match(seed, /\/\/ v20 :/, 'src/seed.ts : le palier v20 doit être documenté comme les précédents')

const store = lire('src/store.tsx')
assert.match(
  store,
  /baselineApresMigration\(p, reprendreBaselines, aujourdhui\)/,
  'src/store.tsx : migrate() doit poser la baseline via baselineApresMigration (palier v20)',
)
assert.match(
  store,
  /const reprendreBaselines = versionAncienne < 20/,
  'src/store.tsx : la reprise doit être conditionnée au FRANCHISSEMENT du palier — rejouée à chaque chargement, elle réécrirait une référence redéfinie le matin même',
)

// --- 8. l'écart est affiché là où il sert -----------------------------------
//
// Le livrable ne se limite pas à stocker la donnée : le §11.3 demande de
// comparer, et le plan cite la fiche projet et le tableau des phases.

assert.match(
  projets,
  /H\. référence/,
  'src/modules/Projets.tsx : le tableau des phases doit montrer la prévision figée',
)
assert.match(
  projets,
  /ecartHeures\(state, p, ph\.code\)/,
  'src/modules/Projets.tsx : la comparaison prévu / réel doit venir de derive.ts — un écart recalculé sur l’écran divergerait de celui du moteur (contrat des modules)',
)
assert.doesNotMatch(
  projets,
  /<table[\s>]/,
  'src/modules/Projets.tsx : tout tableau passe par le composant Table (contrat des modules)',
)

const nouveau = lire('src/modules/ProjetNouveau.tsx')
assert.match(
  nouveau,
  /baselineDepuisPhases\(phases,/,
  'src/modules/ProjetNouveau.tsx : un projet neuf doit naître avec sa baseline d’heures (critère de fin du Lot 0)',
)

console.log('✓ baseline des heures : la référence survit au recalcul (critère 15), la reprise ne se rejoue pas, l’écart §11.3 est rendu')
