// B.14 — le départ d'un membre (§12.2, §14.4).
//
// Le plan v1 n'en parlait pas. Or depuis B.1, une personne qui part laisse
// des tâches ouvertes — et une tâche dont le responsable n'existe plus ne
// disparaît PAS de l'état : elle disparaît de « mes tâches » de tout le
// monde et du plan de charge. Elle est là, et plus personne ne la regarde.
// C'est le mode de perte que ce livrable ferme.
//
// Quatre choses tenues ici :
//
//   1. rien n'est SUPPRIMÉ — un an de temps passé ne s'efface pas parce
//      que quelqu'un est parti ;
//   2. l'inventaire de ce qui doit être repris est complet, et n'inclut
//      PAS ce qui est terminé ;
//   3. la réattribution ne crée pas de doublon — même personne
//      responsable ET co-responsable compterait deux fois dans la charge ;
//   4. on ne désactive pas la dernière personne active.

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

const D = charger('src/depart.ts')

const etat = () => ({
  settings: {
    personnes: ['Julien', 'Zoé', 'Alex'],
    equipe: [
      { id: 'p1', nom: 'Julien' },
      { id: 'p2', nom: 'Zoé' },
      { id: 'p3', nom: 'Alex' },
    ],
  },
  taches: [
    { id: 't1', responsable: 'Alex', statut: 'en_cours', majLe: '' },
    { id: 't2', responsable: 'Alex', statut: 'a_faire', majLe: '' },
    { id: 't3', responsable: 'Alex', statut: 'terminee', majLe: '' },
    { id: 't4', responsable: 'Alex', statut: 'annulee', majLe: '' },
    { id: 't5', responsable: 'Zoé', statut: 'en_cours', majLe: '' },
  ],
  projets: [
    { id: 'P01', responsable: 'Alex', coResponsable: 'Zoé', equipeProjet: ['Alex', 'Julien'] },
    { id: 'P02', responsable: 'Zoé', coResponsable: 'Alex', equipeProjet: [] },
    { id: 'P03', responsable: 'Julien', coResponsable: undefined, equipeProjet: ['Alex'] },
  ],
  temps: [{ id: 'h1', personne: 'Alex', heures: 120 }],
})

// --- 2. l'inventaire de ce qui doit être repris -----------------------------

{
  const a = D.aReprendre(etat(), 'Alex')

  assert.deepEqual(
    a.taches.map((t) => t.id),
    ['t1', 't2'],
    'les tâches TERMINÉES et ANNULÉES sont exclues : les faire réattribuer donnerait à quelqu’un ' +
      'la charge de travaux déjà faits',
  )
  assert.deepEqual(
    a.projets,
    [
      { id: 'P01', role: 'responsable' },
      { id: 'P02', role: 'coResponsable' },
    ],
    'responsable ET co-responsable comptent : les deux sont des désignations vivantes',
  )
  assert.deepEqual(a.equipes.sort(), ['P01', 'P03'], 'l’appartenance à une équipe se retire, elle ne se réattribue pas')

  assert.equal(D.departSansReprise(a), false)
  assert.equal(
    D.departSansReprise(D.aReprendre(etat(), 'Inconnu')),
    true,
    'quelqu’un qui ne porte rien peut partir sans réattribution',
  )
  assert.equal(D.aReprendre(etat(), '').taches.length, 0, 'un nom vide ne réclame rien')

  // Le chrono en cours est un cas à part : il produirait du temps au nom
  // de quelqu'un qui n'est plus là.
  assert.equal(D.aReprendre(etat(), 'Alex', true).chronoEnCours, true)
  assert.equal(D.departSansReprise({ taches: [], projets: [], equipes: [], chronoEnCours: true }), false)
}

// --- 3. la réattribution, sans doublon --------------------------------------

{
  const s = etat()
  const r = D.reattribuer(s, 'Alex', 'Zoé')

  assert.equal(r.taches, 2, 'les deux tâches ouvertes changent de main')
  assert.equal(s.taches.find((t) => t.id === 't1').responsable, 'Zoé')
  assert.equal(
    s.taches.find((t) => t.id === 't3').responsable,
    'Alex',
    'une tâche terminée garde son responsable : c’est l’historique de qui l’a faite',
  )
  assert.ok(s.taches.find((t) => t.id === 't1').majLe, 'la modification est datée')

  // P01 : Alex responsable, Zoé DÉJÀ co-responsable. Après reprise, Zoé
  // devient responsable — et ne doit pas rester co-responsable d'elle-même.
  const p01 = s.projets.find((p) => p.id === 'P01')
  assert.equal(p01.responsable, 'Zoé')
  assert.equal(
    p01.coResponsable,
    'Zoé',
    'ici la co-responsable était déjà Zoé et n’a pas été touchée — c’est P02 qui teste le doublon',
  )

  // P02 : Zoé responsable, Alex co-responsable → Zoé ne doit pas être aux
  // deux places, `equipeDuProjet()` la compterait deux fois dans la charge.
  const p02 = s.projets.find((p) => p.id === 'P02')
  assert.equal(p02.responsable, 'Zoé')
  assert.equal(
    p02.coResponsable,
    undefined,
    'la même personne ne peut pas être responsable ET co-responsable : le plan de charge la compterait deux fois',
  )

  // Les équipes : remplacement sans doublon.
  assert.deepEqual(
    s.projets.find((p) => p.id === 'P01').equipeProjet.sort(),
    ['Julien', 'Zoé'],
    'Alex sort de l’équipe, Zoé y entre — une seule fois',
  )
  assert.deepEqual(s.projets.find((p) => p.id === 'P03').equipeProjet, ['Zoé'])

  // Et si la cible est DÉJÀ dans l'équipe, elle n'y figure pas deux fois.
  const s2 = etat()
  s2.projets[0].equipeProjet = ['Alex', 'Zoé']
  D.reattribuer(s2, 'Alex', 'Zoé')
  assert.deepEqual(s2.projets[0].equipeProjet, ['Zoé'], 'pas de doublon dans l’équipe')
}

// --- les refus --------------------------------------------------------------

{
  assert.ok(D.reattribuer(etat(), 'Alex', 'Alex').erreur, 'un départ ne se transfère pas à lui-même')
  assert.ok(D.reattribuer(etat(), '', 'Zoé').erreur)
  assert.ok(D.reattribuer(etat(), 'Alex', '').erreur)
}

// --- 1. rien n'est supprimé -------------------------------------------------

{
  const s = etat()
  assert.deepEqual(D.desactiver(s, 'Alex'), { ok: true })

  assert.equal(
    s.settings.equipe.find((p) => p.nom === 'Alex').actif,
    false,
    'désactivée, pas supprimée',
  )
  assert.equal(
    s.settings.equipe.length,
    3,
    'la personne reste dans l’équipe : son nom est référencé par les pointages, les heures, ' +
      'les notes de journal et les documents déposés',
  )
  assert.ok(
    s.settings.personnes.includes('Alex'),
    'et dans `settings.personnes` : l’en retirer orphelinerait tout ce qui la cite',
  )
  assert.equal(s.temps.length, 1, 'ses heures restent valorisées — un an de temps passé ne s’efface pas')

  assert.deepEqual(D.personnesActives(s).sort(), ['Julien', 'Zoé'], 'elle sort des listes de choix')
  assert.deepEqual(
    D.personnesActives(etat()).sort(),
    ['Alex', 'Julien', 'Zoé'],
    '`actif` absent vaut ACTIVE : les états antérieurs à B.14 n’ont pas le champ',
  )
}

// --- 4. on ne désactive pas la dernière personne active ---------------------

{
  const s = etat()
  D.desactiver(s, 'Alex')
  D.desactiver(s, 'Zoé')
  const dernier = D.desactiver(s, 'Julien')
  assert.ok(
    dernier.erreur,
    'désactiver la dernière personne active laisserait l’agence sans personne à qui attribuer quoi que ce soit',
  )
  assert.notEqual(s.settings.equipe.find((p) => p.nom === 'Julien').actif, false)

  assert.ok(D.desactiver(etat(), 'Fantôme').erreur, 'une personne introuvable ne se désactive pas')
}

// --- le module ne décide pas seul -------------------------------------------

{
  const source = lire('src/depart.ts')
  assert.doesNotMatch(
    source,
    /useStore|localStorage|fetch\(/,
    'le module est pur : c’est l’écran qui écrit, après avoir demandé à qui',
  )
  // Réattribuer et désactiver sont DEUX gestes. Les enchaîner d'office
  // empêcherait de reprendre les tâches en plusieurs fois — le cas normal
  // quand deux personnes se partagent le travail de la troisième.
  const bloc = /export function reattribuer[\s\S]*?\n}/.exec(source)
  assert.doesNotMatch(bloc[0], /actif = false/, 'réattribuer ne désactive pas : ce sont deux gestes')
}

console.log(
  'Départ d’un membre : rien de supprimé, inventaire complet des reprises, réattribution sans doublon, ' +
    'et la dernière personne active ne peut pas partir.',
)
