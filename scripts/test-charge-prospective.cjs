// 5.13 — plan de charge prospectif : « un projet de X heures démarrant en
// juin — qui peut le prendre, et ça passe ? » (§11, retour 03/08/2026).
//
// Le mode de panne couvert : signer un marché « de tête », découvrir en
// juin que personne n'a les heures, et le payer en soirées. La réponse
// doit être un CHIFFRE, calculé avec le MÊME modèle que le plan de charge
// affiché (heures des phases réparties, capacité congés déduits) — un
// second modèle de répartition donnerait deux vérités.
//
// Ce que ce test tient, chaque cas posé à la main :
//
//   1. la projection : capacité 35 h, 20 h planifiées ⇒ 15 h libres ;
//      les congés RÉDUISENT la capacité projetée ;
//   2. la simulation : 60 h sur 4 semaines ⇒ 15 h/semaine, verdict chiffré
//      semaine par semaine ET au total (lissage dans la fenêtre) ;
//   3. une personne désactivée (B.14) n'est JAMAIS simulée — planifier
//      sur un fantôme, même en hypothèse, est le trou de demain ;
//   4. aucune recommandation d'attribution : l'ordre est celui de
//      l'équipe, pas un classement par disponibilité (§15) ;
//   5. rien n'est écrit — simuler n'est pas engager.

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

const CP = charger('src/chargeProspective.ts')

// --- un état minimal, à la main --------------------------------------------
//
// 7 h/jour ⇒ 35 h/semaine. Les phases tiennent du lundi au jeudi (fin −
// début = 3 jours) : le modèle de `chargePlanifieeSemaine` les compte sur
// UNE semaine — l'arithmétique se vérifie de tête.

const etat = ({ projets = [], absences = [], equipe } = {}) => ({
  projets,
  absences,
  settings: {
    heuresParJour: 7,
    equipe: equipe ?? [
      { id: 'p1', nom: 'Julien' },
      { id: 'p2', nom: 'Zoé' },
    ],
  },
})

const projet = (id, responsable, phases) => ({
  id,
  nom: id,
  statut: 'En cours',
  responsable,
  coResponsable: null,
  equipeProjet: [],
  phases,
})

const phase = (debut, fin, heuresPrevues) => ({
  code: 'PRO',
  pctBase: null,
  montantHT: 0,
  debut,
  fin,
  heuresPrevues,
})

const pres = (a, b) => Math.abs(a - b) < 1e-9

// --- la grille des semaines ------------------------------------------------

{
  assert.deepEqual(
    CP.lundisFenetre('2026-06-01', '2026-06-26'),
    ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22'],
    'du lundi 01/06 au vendredi 26/06 : quatre semaines',
  )
  assert.deepEqual(
    CP.lundisFenetre('2026-06-03', '2026-06-10'),
    ['2026-06-01', '2026-06-08'],
    'une fenêtre qui démarre en milieu de semaine se rattache à son lundi',
  )
}

// --- 1. la projection : capacité 35, 20 h planifiées ⇒ 15 h libres ---------

{
  const s = etat({
    projets: [projet('P01', 'Julien', [phase('2026-06-01', '2026-06-04', 20)])],
    absences: [{ id: 'a1', personne: 'Julien', debut: '2026-06-10', fin: '2026-06-10' }],
  })
  const [sem1, sem2] = CP.chargeProjetee(s, 'Julien', ['2026-06-01', '2026-06-08'])

  assert.ok(pres(sem1.capacite, 35), `capacité pleine : 35 h (obtenu : ${sem1.capacite})`)
  assert.ok(pres(sem1.planifie, 20), `20 h planifiées (obtenu : ${sem1.planifie})`)
  assert.ok(pres(sem1.restant, 15), `35 − 20 = 15 h libres (obtenu : ${sem1.restant})`)

  // un jour de congé le mercredi 10/06 : la capacité projetée le DÉDUIT
  assert.ok(pres(sem2.capacite, 28), `1 j de congé ⇒ capacité 28 h (obtenu : ${sem2.capacite})`)
  assert.ok(pres(sem2.restant, 28), 'rien de planifié : tout le reste est libre')
}

// --- 2. la simulation du plan : 60 h sur 4 semaines ------------------------
//
// Fenêtre 01/06 → 26/06 = 4 semaines ⇒ le projet demande 15 h/semaine.
//   Julien (20 h planifiées en semaine 1) : restants 15/35/35/35 ⇒
//     disponibles 120, chaque semaine absorbe ses 15 h ⇒ ça passe.
//   Zoé (congé toute la semaine 2) : restants 35/0/35/35 ⇒ disponibles
//     105 ≥ 60 mais la semaine 2 ne prend pas ses 15 h ⇒ passe seulement
//     en lissant. Les congés décident du verdict : c'est le point de 5.13.

{
  const s = etat({
    projets: [projet('P01', 'Julien', [phase('2026-06-01', '2026-06-04', 20)])],
    absences: [{ id: 'a2', personne: 'Zoé', debut: '2026-06-08', fin: '2026-06-12' }],
  })
  const res = CP.simulerProjet(s, { heures: 60, debut: '2026-06-01', fin: '2026-06-26' })
  assert.ok(!('erreur' in res), 'la simulation du cas nominal ne doit pas échouer')
  assert.equal(res.lundis.length, 4)
  assert.ok(pres(res.demandeParSemaine, 15), `60 h ÷ 4 semaines = 15 h/semaine (obtenu : ${res.demandeParSemaine})`)

  const julien = res.parPersonne.find((v) => v.personne === 'Julien')
  assert.ok(pres(julien.semaines[0].restant, 15), 'semaine 1 de Julien : 15 h libres')
  assert.ok(pres(julien.semaines[0].solde, 0), '15 h libres − 15 h demandées = 0 : ça tient tout juste')
  assert.ok(pres(julien.heuresDisponibles, 120), `15+35+35+35 = 120 h (obtenu : ${julien.heuresDisponibles})`)
  assert.equal(julien.passeChaqueSemaine, true, 'chaque semaine absorbe sa part : ça passe sans rien bouger')
  assert.equal(julien.passeAuTotal, true)
  assert.ok(pres(julien.manque, 0))

  const zoe = res.parPersonne.find((v) => v.personne === 'Zoé')
  assert.ok(pres(zoe.semaines[1].capacite, 0), 'la semaine de congé de Zoé a une capacité NULLE — congés déduits')
  assert.ok(pres(zoe.semaines[1].solde, -15), 'sa part de 15 h ne tient pas cette semaine-là')
  assert.equal(
    zoe.passeChaqueSemaine,
    false,
    'le congé de la semaine 2 doit faire tomber le verdict semaine par semaine — sinon la projection ignore les congés',
  )
  assert.ok(pres(zoe.heuresDisponibles, 105), `35+0+35+35 = 105 h (obtenu : ${zoe.heuresDisponibles})`)
  assert.equal(zoe.passeAuTotal, true, '105 h libres pour 60 h demandées : passe en lissant dans la fenêtre')

  // et quand ça ne passe pas, le manque est CHIFFRÉ — c'est lui qu'on négocie
  const trop = CP.simulerProjet(s, { heures: 200, debut: '2026-06-01', fin: '2026-06-26', personne: 'Julien' })
  const [vj] = trop.parPersonne
  assert.equal(vj.passeAuTotal, false)
  assert.ok(pres(vj.manque, 80), `200 demandées − 120 disponibles = 80 h manquantes (obtenu : ${vj.manque})`)
}

// --- 3. une personne désactivée n'est jamais simulée (B.14) ----------------

{
  const s = etat({
    equipe: [
      { id: 'p1', nom: 'Julien' },
      { id: 'p2', nom: 'Zoé' },
      { id: 'p3', nom: 'Marc', actif: false },
    ],
  })
  const res = CP.simulerProjet(s, { heures: 10, debut: '2026-06-01', fin: '2026-06-26' })
  assert.deepEqual(
    res.parPersonne.map((v) => v.personne),
    ['Julien', 'Zoé'],
    'Marc est désactivé : il ne peut pas prendre un projet, il ne doit pas apparaître (B.14)',
  )

  const cible = CP.simulerProjet(s, { heures: 10, debut: '2026-06-01', fin: '2026-06-26', personne: 'Marc' })
  assert.ok('erreur' in cible, 'demander Marc nommément doit être REFUSÉ, pas silencieusement vidé')
  assert.match(cible.erreur, /active/, 'le refus dit pourquoi : la personne n’est pas active')
}

// --- 4. l'ordre est celui de l'équipe, jamais un classement ----------------
//
// Julien est saturé (0 h libre), Zoé est vide (140 h libres). Un module qui
// « aiderait » en classant par disponibilité mettrait Zoé en tête — c'est
// une recommandation d'attribution déguisée, et elle est refusée (§15) :
// les chiffres disent si ça passe, QUI le prend reste une décision humaine.

{
  const s = etat({
    projets: [
      projet('P01', 'Julien', [phase('2026-06-01', '2026-06-04', 35)]),
      projet('P02', 'Julien', [phase('2026-06-08', '2026-06-11', 35)]),
      projet('P03', 'Julien', [phase('2026-06-15', '2026-06-18', 35)]),
      projet('P04', 'Julien', [phase('2026-06-22', '2026-06-25', 35)]),
    ],
  })
  const res = CP.simulerProjet(s, { heures: 60, debut: '2026-06-01', fin: '2026-06-26' })
  assert.ok(pres(res.parPersonne[0].heuresDisponibles, 0), 'Julien n’a plus une heure')
  assert.ok(pres(res.parPersonne[1].heuresDisponibles, 140), 'Zoé les a toutes')
  assert.deepEqual(
    res.parPersonne.map((v) => v.personne),
    ['Julien', 'Zoé'],
    'l’ordre reste celui de l’équipe des réglages : classer par disponibilité serait recommander une attribution',
  )
}

// --- les entrées impossibles sont refusées en français ---------------------

{
  const s = etat({})
  assert.ok('erreur' in CP.simulerProjet(s, { heures: 0, debut: '2026-06-01', fin: '2026-06-26' }), '0 h : refusé')
  assert.ok(
    'erreur' in CP.simulerProjet(s, { heures: 10, debut: '2026-06-26', fin: '2026-06-01' }),
    'fenêtre à l’envers : refusée — une division par un nombre de semaines fantaisiste chiffrerait faux',
  )
}

// --- 5. rien n'est écrit : simuler n'est pas engager -----------------------

{
  const s = etat({
    projets: [projet('P01', 'Julien', [phase('2026-06-01', '2026-06-04', 20)])],
    absences: [{ id: 'a2', personne: 'Zoé', debut: '2026-06-08', fin: '2026-06-12' }],
  })
  const avant = JSON.stringify(s)
  CP.chargeProjetee(s, 'Julien', ['2026-06-01'])
  CP.simulerProjet(s, { heures: 60, debut: '2026-06-01', fin: '2026-06-26' })
  assert.equal(
    JSON.stringify(s),
    avant,
    'la simulation ne crée ni projet, ni phase, ni affectation : l’état ressort intact',
  )
}

// --- la pureté du module et le câblage de l'écran --------------------------

{
  const source = lire('src/chargeProspective.ts')
  assert.doesNotMatch(
    source,
    /useStore|localStorage|fetch\s*\(|Date\.now|todayISO/,
    'src/chargeProspective.ts est de la logique PURE : « à venir » est défini par la fenêtre demandée, ' +
      'pas par une horloge lue au fond du calcul',
  )

  const planning = lire('src/modules/Planning.tsx')
  assert.match(planning, /Et si \?/, 'le bloc « Et si ? » existe dans le plan de charge')
  assert.match(
    planning,
    /simulerProjet/,
    'l’écran doit passer par src/chargeProspective.ts — un calcul redit dans le composant divergerait',
  )

  // le bloc « Et si ? » affiche ses tableaux via Table (contrat modules) —
  // Planning.tsx étant déjà recensé par test-tableaux pour son plan de
  // charge historique, un <table> brut ajouté ICI y passerait inaperçu
  const debutBloc = planning.indexOf('function BadgeVerdict')
  const finBloc = planning.indexOf('function GestionAbsences')
  assert.ok(debutBloc !== -1 && finBloc > debutBloc, 'le bloc « Et si ? » est repérable dans Planning.tsx')
  const bloc = planning.slice(debutBloc, finBloc)
  assert.match(bloc, /<Table /, 'le verdict par personne s’affiche via Table')
  assert.doesNotMatch(bloc, /<table[\s>]/, 'aucun <table> JSX brut dans le bloc « Et si ? »')
}

console.log(
  'Charge prospective : 35 h de capacité et 20 h planifiées font 15 h libres, 60 h sur 4 semaines se ' +
    'répartissent en 15 h/semaine avec verdict chiffré (le congé fait tomber la semaine, le total dit le ' +
    'lissage, le manque est chiffré), la personne désactivée est exclue et le refus nominatif est dit, ' +
    'l’ordre n’est jamais un classement, rien n’est écrit, et l’écran passe par le module.',
)
