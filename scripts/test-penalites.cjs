// 5.2 — pénalités de marché : la machine chiffre l'ENCOURU, l'humain décide.
//
// Une pénalité appliquée toute seule serait le contraire du §15 : un acte
// contractuel posé par un calcul. Et un encouru faux ne se voit pas — il se
// découvre au décompte général, quand l'entreprise conteste. D'où les quatre
// garanties tenues ici :
//
//   1. les calculs sont vérifiés CONTRE DES CAS FAITS À LA MAIN — retard,
//      absence, document — et les jours d'intempéries se déduisent du seul
//      retard d'exécution (la pluie excuse un chantier, pas un DOE) ;
//   2. taux du CCAP non saisi ⇒ null, jamais 0 — « 0 € de pénalité »
//      affirmerait que le CCAP a été lu ; un taux à 0 explicitement saisi,
//      lui, vaut bien 0 € ;
//   3. le module pur ne pose JAMAIS `penaliteAppliquee`, ne mutile pas
//      l'événement, et AUCUN fichier hors de l'écran de décision n'écrit ce
//      champ — l'application est un geste humain daté et signé ;
//   4. un montant APPLIQUÉ est figé : les totaux relisent la décision, pas
//      le recalcul — corriger un taux après coup ne réécrit pas ce qui a
//      été signifié à l'entreprise.

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

const P = charger('src/penalites.ts')

// les taux d'un CCAP ordinaire — posés une fois, relus par tous les cas
const TAUX = { retardParJourHT: 200, absenceReunionHT: 500, documentRetardParJourHT: 100 }

// --- 1. les calculs, chiffres posés à la main -------------------------------

{
  const retard = P.penaliteEncourue({ type: 'retard_execution', jours: 10 }, TAUX, 0)
  assert.equal(retard.montantHT, 2000, '10 jours × 200 €/j — le cas nu, sans intempéries')
  assert.equal(retard.joursRetenus, 10)
  assert.equal(retard.joursDeduits, 0)

  // le lien avec 5.3 : 3 jours d'intempéries reconnues sur la période
  const excuse = P.penaliteEncourue({ type: 'retard_execution', jours: 10 }, TAUX, 3)
  assert.equal(excuse.montantHT, 1400, 'les intempéries se DÉDUISENT : (10 − 3) × 200 — on ne pénalise pas un retard que la pluie excuse')
  assert.equal(excuse.joursRetenus, 7)
  assert.equal(excuse.joursDeduits, 3, 'la déduction est DITE : l’écran doit pouvoir écrire « 10 j − 3 j »')

  // plus d'intempéries que de retard : un retard entièrement excusé vaut 0,
  // jamais un montant négatif — l'entreprise n'a pas de créance sur la MOE
  const toutExcuse = P.penaliteEncourue({ type: 'retard_execution', jours: 2 }, TAUX, 5)
  assert.equal(toutExcuse.montantHT, 0, 'jamais négatif')
  assert.equal(toutExcuse.joursDeduits, 2, 'on ne déduit que ce qui existe')

  const absence = P.penaliteEncourue({ type: 'absence_reunion' }, TAUX, 4)
  assert.equal(absence.montantHT, 500, 'une absence vaut le forfait du CCAP, pas un décompte en jours')
  assert.equal(absence.joursRetenus, null, 'une absence ne se compte pas en jours')
  assert.equal(absence.joursDeduits, 0, 'les intempéries n’excusent pas une absence de réunion')

  const doe = P.penaliteEncourue({ type: 'document_retard', jours: 5 }, TAUX, 3)
  assert.equal(doe.montantHT, 500, '5 jours × 100 €/j')
  assert.equal(doe.joursDeduits, 0, 'la pluie excuse un chantier à l’arrêt, pas un DOE en retard — il s’écrit au bureau')

  // arrondi au centime : le montant part sur un décompte, pas dans un float
  const centimes = P.penaliteEncourue({ type: 'retard_execution', jours: 3 }, { retardParJourHT: 0.1 }, 0)
  assert.equal(centimes.montantHT, 0.3, '0,1 × 3 = 0,30 — pas 0,30000000000000004')
}

// --- 2. taux non saisi ⇒ null, jamais 0 -------------------------------------

{
  assert.equal(
    P.penaliteEncourue({ type: 'retard_execution', jours: 10 }, undefined, 0),
    null,
    'aucun taux relevé au marché ⇒ null : « 0 € » affirmerait que le CCAP a été lu',
  )
  assert.equal(
    P.penaliteEncourue({ type: 'absence_reunion' }, { retardParJourHT: 200 }, 0),
    null,
    'chaque fait générateur lit SON taux — le taux de retard ne chiffre pas une absence',
  )
  assert.equal(
    P.penaliteEncourue({ type: 'retard_execution', jours: null }, TAUX, 0),
    null,
    'jours non saisis : rien à chiffrer — pas un « 0 € » qui clôt le sujet',
  )
  assert.equal(
    P.penaliteEncourue({ type: 'retard_execution', jours: -3 }, TAUX, 0),
    null,
    'des jours négatifs sont une erreur de saisie, pas une information',
  )
  assert.equal(
    P.penaliteEncourue({ type: 'inconnu', jours: 3 }, TAUX, 0),
    null,
    'un type inconnu (import JSON, version future) ne chiffre rien',
  )

  // un taux à 0 SAISI est une information : « ce CCAP ne pénalise pas »
  const zero = P.penaliteEncourue({ type: 'retard_execution', jours: 10 }, { retardParJourHT: 0 }, 0)
  assert.equal(zero.montantHT, 0, 'taux 0 explicite ⇒ 0 € — la différence avec null est tout le point')
}

// --- 3. le module pur ne décide jamais --------------------------------------

{
  const evenement = { type: 'retard_execution', jours: 10 }
  const avant = structuredClone(evenement)
  const r = P.penaliteEncourue(evenement, TAUX, 3)
  assert.deepEqual(evenement, avant, 'penaliteEncourue ne mutile pas l’événement')
  assert.ok(!('penaliteAppliquee' in r), 'le résultat est un chiffre, pas une décision')

  const src = lire('src/penalites.ts')
  assert.doesNotMatch(
    src,
    /penaliteAppliquee\s*=/,
    'src/penalites.ts ne pose JAMAIS penaliteAppliquee : la machine propose, l’humain décide (§15)',
  )
  assert.doesNotMatch(
    src,
    /useStore|localStorage|fetch\(|Date\.now|new Date\(/,
    'penalites.ts doit rester pur : les dates sont des ARGUMENTS, jamais une horloge lue au fond du calcul',
  )

  // AUCUN fichier hors de l'écran de décision n'écrit penaliteAppliquee —
  // un producteur automatique qui l'écrirait appliquerait une pénalité seul
  const fichiers = []
  const marcher = (dossier) => {
    for (const entree of fs.readdirSync(path.join(racine, dossier), { withFileTypes: true })) {
      const chemin = path.posix.join(dossier, entree.name)
      if (entree.isDirectory()) marcher(chemin)
      else if (/\.(ts|tsx)$/.test(entree.name)) fichiers.push(chemin)
    }
  }
  marcher('src')
  for (const fichier of fichiers) {
    if (fichier === 'src/modules/ProjetChantier.tsx') continue
    assert.doesNotMatch(
      lire(fichier),
      /penaliteAppliquee\s*=[^=]/,
      `${fichier} écrit penaliteAppliquee : seule la décision humaine de l'écran chantier a ce droit`,
    )
  }

  // et l'écran de décision signe : qui (useMoi), quand (decideLe), combien (figé)
  const chantier = lire('src/modules/ProjetChantier.tsx')
  assert.match(chantier, /useMoi/, 'la décision se signe avec l’identité de la personne devant l’écran')
  assert.match(chantier, /x\.decidePar = signataire/, 'decidePar est posé au clic « Appliquer »')
  assert.match(chantier, /x\.decideLe = todayISO\(\)/, 'la décision est datée')
  assert.match(
    chantier,
    /x\.penaliteMontantHT = encouru\.montantHT/,
    'le montant est FIGÉ à la décision : le recalcul ne bouge plus cette ligne',
  )
}

// --- 4. les totaux relisent la décision, pas le recalcul --------------------

{
  const evenements = [
    { id: 'e1', marcheId: 'm1', projetId: 'P', type: 'retard_execution', date: '2026-07-01', jours: 10, commentaire: '', penaliteAppliquee: false },
    // appliquée : 500 € figés au moment de la décision
    { id: 'e2', marcheId: 'm1', projetId: 'P', type: 'absence_reunion', date: '2026-07-08', commentaire: '', penaliteAppliquee: true, penaliteMontantHT: 500, decidePar: 'Julien', decideLe: '2026-07-10' },
    { id: 'e3', marcheId: 'm1', projetId: 'P', type: 'document_retard', date: '2026-07-15', jours: 5, commentaire: '', penaliteAppliquee: false },
    // un autre marché : il ne contamine pas les totaux de m1
    { id: 'e4', marcheId: 'm2', projetId: 'P', type: 'retard_execution', date: '2026-07-02', jours: 99, commentaire: '', penaliteAppliquee: false },
  ]

  assert.equal(
    P.totalEncouruMarche(evenements, 'm1', TAUX, 0),
    3000,
    '2 000 (retard) + 500 (absence figée) + 500 (document) — et rien du marché m2',
  )
  assert.equal(P.totalAppliqueMarche(evenements, 'm1'), 500, 'seul ce qu’une décision humaine a figé est « appliqué »')
  assert.equal(P.totalAppliqueMarche(evenements, 'm2'), 0)

  // le CCAP de l'absence passe de 500 à 800 APRÈS la décision : l'appliqué
  // reste 500 — corriger un taux ne réécrit pas ce qui a été signifié
  assert.equal(
    P.totalEncouruMarche(evenements, 'm1', { ...TAUX, absenceReunionHT: 800 }, 0),
    3000,
    'un événement appliqué compte pour son montant FIGÉ, pas pour le recalcul',
  )

  // les intempéries traversent le total : le retard de e1 passe de 10 à 7 j
  assert.equal(P.totalEncouruMarche(evenements, 'm1', TAUX, 3), 2400, '1 400 + 500 + 500 : la déduction joue aussi dans le total')

  // un événement dont le taux manque compte 0 dans le total (le manque se
  // voit ligne par ligne à l'écran), il ne rend pas le total incalculable —
  // et l'appliqué FIGÉ reste compté même sans taux : c'est une décision
  assert.equal(
    P.totalEncouruMarche(evenements, 'm1', { retardParJourHT: 200 }, 0),
    2500,
    '2 000 (retard) + 500 (absence figée) + 0 (taux document non saisi)',
  )
}

// --- 5. le câblage dans l'application ---------------------------------------

{
  assert.match(
    lire('src/store.tsx'),
    /etat\.evenementsMarche = Array\.isArray\(parsed\.evenementsMarche\) \? parsed\.evenementsMarche : \[\]/,
    'evenementsMarche doit être normalisée dans migrate() comme chronos/pointages',
  )
  assert.match(
    lire('src/seed.ts'),
    /evenementsMarche: \[\]/,
    'le seed amorce la collection — VIDE : un constat contractuel ne s’invente pas en exemple',
  )
  assert.match(lire('src/types.ts'), /penalites\?: \{/, 'les taux du CCAP sont OPTIONNELS sur le marché (pas de palier de version)')

  // les taux se saisissent là où vivent les marchés, et le journal s'affiche
  const chantier = lire('src/modules/ProjetChantier.tsx')
  for (const champ of ['retardParJourHT', 'absenceReunionHT', 'documentRetardParJourHT']) {
    assert.match(chantier, new RegExp(champ), `le modal du marché doit exposer « ${champ} »`)
  }
  assert.match(chantier, /CartePenalites/, 'le journal des pénalités doit exister dans l’onglet Chantier')
  assert.match(chantier, /<CartePenalites projet=\{projet\} \/>/, 'la carte doit être MONTÉE — un écran écrit mais jamais rendu ne protège rien')
}

console.log(
  'Pénalités de marché : encouru vérifié à la main (intempéries déduites du seul retard d’exécution, ' +
    'jamais négatif), taux non saisi ⇒ null jamais 0, le module pur ne pose jamais penaliteAppliquee ' +
    '(et aucun fichier hors écran de décision non plus), montant figé et signé à l’application, ' +
    'totaux qui relisent la décision — collection normalisée, amorcée vide, journal monté dans l’onglet Chantier.',
)
