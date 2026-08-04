// 5.6 — avancement du planning travaux (retour d'usage du 03/08/2026).
//
// Ce chiffre est saisi une fois, en réunion de chantier, et sert deux fois :
// dans la barre du Gantt, et face à la situation que l'entreprise envoie
// (5.5 : « elle demande 60 %, le chantier dit 40 % »). Un avancement faux ne
// se voit pas à l'écran — il se voit sur un certificat de paiement contesté.
//
// Quatre choses tenues ici :
//
//   1. la moyenne du lot est pondérée par la DURÉE, vérifiée à la main —
//      une moyenne simple dirait qu'un lot aux trois quarts à l'arrêt est
//      à moitié fait ;
//   2. les bornes 0–100 : une frappe à 150 n'entre pas dans la moyenne ;
//   3. un lot sans tâche répond null, PAS 0 — « on ne sait pas » n'est pas
//      « rien n'est fait », et un 0 pousserait à contester une situation
//      légitime au seul motif que le planning n'est pas construit ;
//   4. « faire revenir l'entreprise » : la reprise est LIÉE à l'originale,
//      dates vides, et n'hérite ni de l'avancement ni du montant DPGF.

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

const CH = charger('src/chantier.ts')

const tache = (over = {}) => ({
  id: over.id || 't1',
  projetId: 'P01',
  lotDceId: null,
  elementId: null,
  marcheId: 'm1',
  lot: 'Lot 02 — Gros œuvre',
  designation: 'Dallage du hall',
  debut: null,
  fin: null,
  statut: 'prevu',
  ...over,
})

// --- 1. la pondération par la durée, vérifiée à la main ---------------------

{
  // t1 : 4 jours (03 → 06, bornes incluses) finis ; t2 : sans dates, poids 1,
  // rien de fait. À la main : (4 × 100 + 1 × 0) / 5 = 80.
  const taches = [
    tache({ id: 'a', debut: '2026-08-03', fin: '2026-08-06', avancement: 100 }),
    tache({ id: 'b', avancement: 0 }),
  ]
  assert.equal(
    CH.avancementLot(taches, 'm1'),
    80,
    'la moyenne est pondérée par la durée : 4 jours finis contre 1 poids sans dates font 80, pas 50',
  )
}

{
  // À la main : 10 j × 30 + 5 j × 90 + 1 × 100 = 300 + 450 + 100 = 850 ;
  // poids 16 ; 850 / 16 = 53,125 → 53,1 au dixième.
  const taches = [
    tache({ id: 'go', debut: '2026-09-01', fin: '2026-09-10', avancement: 30 }),
    tache({ id: 'ch', debut: '2026-09-11', fin: '2026-09-15', avancement: 90 }),
    tache({ id: 'appro', avancement: 100 }),
  ]
  assert.equal(CH.avancementLot(taches, 'm1'), 53.1, 'pondération 10/5/1 recalculée à la main, arrondie au dixième')

  // Les tâches d'un AUTRE marché ne pèsent pas dans ce lot.
  const melange = [...taches, tache({ id: 'z', marcheId: 'm2', debut: '2026-09-01', fin: '2026-12-31', avancement: 0 })]
  assert.equal(CH.avancementLot(melange, 'm1'), 53.1, 'une tâche d’un autre marché ne pèse pas dans la moyenne du lot')
}

{
  // Le poids d'une tâche est sa durée bornes incluses : un jour (debut = fin)
  // pèse 1, pas 0 — un poids nul la ferait disparaître de la moyenne.
  assert.equal(CH.poidsTache({ debut: '2026-08-03', fin: '2026-08-03' }), 1, 'debut = fin : un jour, pas zéro')
  assert.equal(CH.poidsTache({ debut: '2026-08-03', fin: '2026-08-06' }), 4, 'durée bornes incluses')
  assert.equal(CH.poidsTache({ debut: null, fin: null }), 1, 'sans dates : poids 1, la tâche compte quand même')
  assert.equal(CH.poidsTache({ debut: '2026-08-06', fin: '2026-08-03' }), 1, 'dates inversées (saisie ratée) : poids plancher, pas négatif')
}

// --- 2. les bornes 0–100 ----------------------------------------------------

{
  assert.equal(CH.clampPourcent(150), 100, 'une frappe à 150 est bornée à 100')
  assert.equal(CH.clampPourcent(-20), 0, 'un avancement négatif est borné à 0')
  assert.equal(CH.clampPourcent(Number.NaN), 0, 'NaN vaut 0, pas une moyenne NaN qui traverse tout l’écran')

  assert.equal(CH.avancementLot([tache({ avancement: 150 })], 'm1'), 100, 'la moyenne du lot ne dépasse jamais 100')
  assert.equal(CH.avancementLot([tache({ avancement: -20 })], 'm1'), 0, 'la moyenne du lot ne descend jamais sous 0')
}

// --- l'absence de saisie retombe sur le statut, jamais sur une devinette ----

{
  assert.equal(CH.avancementTache(tache({ statut: 'fait' })), 100, 'une tâche « fait » d’avant le Lot 5 EST terminée — la compter 0 dirait qu’un lot fini n’a pas commencé')
  assert.equal(CH.avancementTache(tache({ statut: 'en_cours' })), 0, 'sans saisie, une tâche en cours vaut 0 : on ne devine pas un pourcentage qu’aucun humain n’a constaté')
  assert.equal(CH.avancementTache(tache({ statut: 'fait', avancement: 60 })), 60, 'la saisie explicite prime sur le statut')
}

// --- 3. un lot sans tâche répond null, PAS 0 --------------------------------

{
  assert.equal(CH.avancementLot([], 'm1'), null, 'lot sans tâche ⇒ null : « on ne sait pas » n’est pas « rien n’est fait »')
  assert.equal(
    CH.avancementLot([tache({ marcheId: 'm2' })], 'm1'),
    null,
    'aucune tâche rattachée à CE marché ⇒ null, pas la moyenne d’un autre lot',
  )
  assert.equal(CH.avancementLot([tache()], ''), null, 'sans identifiant de marché, il n’y a pas de lot à mesurer')
}

// --- 4. « faire revenir l'entreprise » : la reprise, liée à l'originale -----

{
  const origine = tache({
    id: 't-or',
    lotDceId: 'ld1',
    elementId: 'e1',
    debut: '2026-08-01',
    fin: '2026-08-05',
    statut: 'fait',
    avancement: 100,
    notes: 'fissures au séchage',
  })
  const avant = JSON.parse(JSON.stringify(origine))
  const r = CH.tacheDeReprise(origine, 'tache-neuf')

  assert.equal(r.repriseDeId, 't-or', 'la reprise est LIÉE à la tâche d’origine — sans le lien, on ressaisit une ligne orpheline')
  assert.equal(r.id, 'tache-neuf', 'l’identifiant est fourni par l’appelant : la logique pure ne tire pas d’aléatoire')
  assert.equal(r.debut, null, 'dates vides : la date de reprise se négocie avec l’entreprise, elle ne se recopie pas du passé')
  assert.equal(r.fin, null)
  assert.equal(r.statut, 'prevu', 'une reprise repart au statut prévu, pas au statut de la tâche finie qu’elle corrige')
  assert.match(r.designation, / — reprise$/, 'le libellé dit que c’est une reprise')
  assert.equal(r.projetId, origine.projetId)
  assert.equal(r.marcheId, 'm1', 'même marché : c’est la même entreprise qu’on fait revenir')
  assert.equal(r.lot, origine.lot, 'même lot : la reprise se groupe avec les tâches d’origine')
  assert.equal(r.lotDceId, 'ld1', 'la traçabilité vers le lot DCE est conservée')
  assert.equal(r.elementId, null, 'le lien DPGF n’est PAS copié : le montant du poste s’afficherait deux fois, or la reprise est aux frais de l’entreprise')
  assert.equal(r.avancement, undefined, 'une reprise repart de zéro — pas de 100 % hérité de la première exécution')
  assert.equal(CH.avancementTache(r), 0)
  assert.deepEqual(origine, avant, 'la tâche d’origine n’est pas modifiée : dupliquer n’est pas déplacer')
}

// --- l'écran rend ce que la logique calcule ---------------------------------

{
  const ecran = lire('src/modules/ProjetPlanning.tsx')
  assert.match(ecran, /avancementTache/, 'la frise lit l’avancement par la fonction partagée, pas par un calcul local qui divergerait')
  assert.match(ecran, /width: `\$\{av\}%`/, 'l’avancement se VOIT dans la barre : remplissage proportionnel, pas seulement un chiffre en tableau')
  assert.match(ecran, /avancementLot/, 'l’avancement du lot est affiché par la même fonction que lira le contrôle des situations (5.5)')
  assert.match(ecran, /tacheDeReprise/, 'le geste « faire revenir l’entreprise » existe à l’écran, pas seulement dans la logique')
  assert.match(ecran, /clampPourcent/, 'la saisie est bornée par la même règle que la moyenne — deux clamps divergeraient')
}

// --- la logique reste pure --------------------------------------------------

{
  const source = lire('src/chantier.ts')
  assert.doesNotMatch(
    source,
    /useStore|localStorage|fetch\(|Date\.now|new Date\(\)/,
    'src/chantier.ts est de la logique PURE : ni store, ni réseau, ni horloge — sinon 5.5 ne pourrait pas recalculer le même chiffre',
  )
}

console.log(
  'Avancement chantier : moyenne pondérée par la durée vérifiée à la main, bornes 0–100, ' +
    'lot sans tâche ⇒ null (on ne sait pas ≠ rien n’est fait), reprise liée à l’originale sans dates ni héritage — ' +
    'et l’écran rend ce que la logique calcule.',
)
