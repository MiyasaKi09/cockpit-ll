// 5.9 — GPA par projet avec modèles préfaits (retour d'usage du 03/08/2026).
//
// Pendant l'année qui suit la réception, l'entreprise doit lever tout
// désordre signalé (CCAG Travaux art. 44.1). Passé la fin de GPA, plus rien
// n'est opposable : un désordre relancé sans trace, mis en demeure après
// l'échéance, c'est un désordre payé par la MOA — ou par la MOE.
//
// Quatre choses tenues ici :
//
//   1. UNE fin de GPA : la formule vit dans src/gpa.ts et derive.ts la
//      consomme pour la levée de la RG — deux formules divergeraient un
//      jour (année bissextile, arrondi) sans que rien ne le signale ;
//   2. le registre : un désordre levé sort des ouverts, un désordre
//      CONTESTÉ y reste — la contestation ne lève rien ;
//   3. la relance se TRACE (date + mode, ajoutée sans rien réécrire) :
//      c'est la chronologie qui rend la mise en demeure opposable ;
//   4. le gabarit « Année de parfait achèvement » passe par le moteur B.13
//      (appliquerModele → aperçu décochable → tachesDepuisApercu) : une
//      ligne décochée ne crée RIEN.

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

const G = charger('src/gpa.ts')
const D = charger('src/derive.ts')
const M = charger('src/modelesTaches.ts')

// --- 1. la fin de GPA : une formule, calculée à la main ----------------------

{
  assert.equal(G.finGPA('2026-03-15'), '2027-03-15', 'réception + 1 an, même jour l’année suivante')
  assert.equal(G.finGPA('2026-12-31'), '2027-12-31', 'le passage d’année ne décale rien')
  assert.equal(G.finGPA(null), null, 'sans réception, pas de fin de GPA inventée')
  assert.equal(G.finGPA('n’importe quoi'), null, 'réception illisible : null, pas une chaîne absurde')

  assert.equal(G.joursAvantFinGPA('2026-03-15', '2027-03-10'), 5, 'J−5 avant l’échéance')
  assert.equal(G.joursAvantFinGPA('2026-03-15', '2027-04-01'), -17, 'GPA échue : négatif, et il se chiffre')
  assert.equal(G.joursAvantFinGPA(null, '2027-03-10'), null, '« on ne sait pas » n’est pas « c’est fini »')
}

// --- ... et c'est CELLE de derive.ts, pas une seconde ------------------------

{
  const marche = {
    id: 'm1',
    projetId: 'P01',
    entreprise: 'Batidur',
    lot: 'Lot 02',
    montantInitialHT: 100000,
    avenantsHT: 0,
    tauxRG: 0.05,
    revision: false,
    delaiVerifJours: 15,
    actif: false,
    dateReception: '2026-03-15',
  }
  const rg = D.retenueGarantieMarche({ situations: [] }, marche, '2026-08-04')
  assert.equal(
    rg.dateLevee,
    G.finGPA(marche.dateReception),
    'la levée de la RG (derive) et le compte à rebours GPA (gpa) tombent le MÊME jour — une seule autorité',
  )

  const derive = lire('src/derive.ts')
  assert.match(derive, /finGPA\(/, 'derive.ts consomme finGPA (src/gpa.ts) pour la date de levée')
  assert.doesNotMatch(
    derive,
    /slice\(0, 4\)\) \+ 1/,
    'derive.ts ne porte plus de formule locale « réception + 1 an » : une seconde formule divergerait sans que rien ne le signale',
  )
  const gpa = lire('src/gpa.ts')
  assert.match(gpa, /slice\(0, 4\)\) \+ 1/, 'la formule vit dans src/gpa.ts — et nulle part ailleurs')
}

// --- 2. le registre : levé sort, contesté reste ------------------------------

const desordre = (over = {}) => ({
  id: 'd1',
  projetId: 'P01',
  marcheId: 'm1',
  lot: 'Lot 02',
  signaleLe: '2026-06-01',
  signalePar: 'MOA',
  description: 'Fissure en façade sud',
  statut: 'signale',
  relances: [],
  ...over,
})

{
  const liste = [
    desordre(),
    desordre({ id: 'd2', statut: 'notifie_entreprise', notifieLe: '2026-06-05' }),
    desordre({ id: 'd3', statut: 'leve', leveLe: '2026-07-01' }),
    desordre({ id: 'd4', statut: 'conteste' }),
  ]
  const ouverts = G.desordresOuverts(liste)
  assert.deepEqual(
    ouverts.map((d) => d.id),
    ['d1', 'd2', 'd4'],
    'un désordre levé sort des ouverts ; un désordre CONTESTÉ y reste — la contestation ne lève rien',
  )
}

// --- 3. la relance se trace, sans rien réécrire ------------------------------

{
  const avant = desordre({ relances: [{ date: '2026-06-10', mode: 'téléphone' }] })
  const apres = G.avecRelance(avant, '2026-06-20', 'e-mail')
  assert.deepEqual(
    apres.relances,
    [
      { date: '2026-06-10', mode: 'téléphone' },
      { date: '2026-06-20', mode: 'e-mail' },
    ],
    'la relance s’AJOUTE en fin de chronologie : datée, avec son canal',
  )
  assert.equal(avant.relances.length, 1, 'l’original n’est pas muté — la chronologie ne se réécrit pas')
  assert.equal(apres.statut, 'signale', 'relancer ne change pas le statut : notifier et lever sont d’autres gestes')
}

// --- 4. le gabarit GPA passe par le moteur B.13 ------------------------------

{
  const modele = M.MODELES_AMORCE.find((g) => g.id === 'modele-gpa')
  assert.ok(modele, 'le gabarit « Année de parfait achèvement » est dans l’amorce des modèles')
  assert.match(modele.nom, /parfait achèvement/i, 'il se choisit sur son nom')

  const visite = modele.lignes.find((l) => /M\+11/.test(l.libelle))
  assert.ok(visite, 'la ligne qui compte : la visite à M+11 — après la fin de GPA, plus rien n’est opposable')
  assert.equal(visite.phase, 'AOR', 'les décalages se comptent depuis AOR, la phase où la réception se prononce')
  assert.equal(visite.decalageJours, 335, 'M+11 ≈ 335 jours après le début d’AOR')

  const ctx = {
    projetId: 'P01',
    debutDePhase: { AOR: '2026-09-01' },
    responsable: 'Julien',
    coResponsable: 'Zoé',
  }
  const apercu = M.appliquerModele(modele, ctx)
  assert.equal(apercu.length, modele.lignes.length, 'toutes les lignes sont montrées dans l’aperçu')
  const visiteApercu = apercu.find((l) => /M\+11/.test(l.libelle))
  assert.equal(visiteApercu.echeance, '2027-08-02', '1er sept. 2026 + 335 jours = 2 août 2027, calculé à la main')
  for (const l of apercu) {
    assert.equal(l.id, undefined, 'un aperçu n’a pas d’identifiant de tâche : rien n’a été créé')
    assert.ok(l.retenueParDefaut, 'début d’AOR connu : toutes les lignes sont cochées par défaut')
  }

  // une ligne décochée ne crée RIEN
  const retenues = new Set(apercu.filter((l) => !/M\+11/.test(l.libelle)).map((l) => l.ligneId))
  const taches = M.tachesDepuisApercu(apercu, retenues, ctx, 'Julien')
  assert.equal(taches.length, modele.lignes.length - 1, 'seules les lignes retenues fabriquent')
  assert.ok(
    taches.every((t) => !/M\+11/.test(t.titre)),
    'la ligne décochée (visite M+11) ne produit RIEN — ni tâche annulée, ni tâche masquée',
  )
  assert.equal(M.tachesDepuisApercu(apercu, new Set(), ctx, 'Julien').length, 0, 'rien coché, rien créé')

  // sans début d'AOR, pas de date inventée : lignes montrées mais décochées
  const sansDate = M.appliquerModele(modele, { ...ctx, debutDePhase: {} })
  for (const l of sansDate) {
    assert.equal(l.echeance, null, 'sans début d’AOR, pas de date inventée')
    assert.equal(l.retenueParDefaut, false, 'et la ligne est décochée d’office')
  }
}

// --- l'écran : gestes datés, relance tracée, mise en demeure branchée --------

{
  const ecran = lire('src/modules/ProjetChantier.tsx')
  assert.match(ecran, /CarteGPA/, 'le bloc « GPA » existe dans l’onglet Chantier du projet')
  assert.match(ecran, /joursAvantFinGPA/, 'le compte à rebours lit src/gpa.ts — la même autorité que la levée de la RG')
  assert.match(ecran, /x\.notifieLe = todayISO\(\)/, 'notifier est un geste DATÉ : c’est le point de départ du délai de l’entreprise')
  assert.match(ecran, /x\.leveLe = todayISO\(\)/, 'la levée est constatée et datée')
  assert.match(ecran, /avecRelance\(/, 'la relance se TRACE (date + mode) au moment du geste — la chronologie est la pièce du dossier')
  assert.match(ecran, /ouvrirGmail\(/, '« Relancer » ouvre un BROUILLON via gmailComposeUrl : l’envoi reste un clic humain (§15)')
  assert.match(ecran, /tpl-med-gpa/, '« Mettre en demeure » lit le gabarit GPA du seed (tpl-relance-med vise les honoraires, pas la GPA)')
  assert.match(ecran, /copier\(assemble\(/, 'la mise en demeure est un PROMPT copié à relire — jamais un courrier envoyé seul')
  assert.match(ecran, /appliquerModele\(/, 'le modèle GPA s’applique par le moteur B.13 : aperçu d’abord')
  assert.match(ecran, /tachesDepuisApercu\(/, '… et seules les lignes retenues fabriquent des tâches')

  const types = lire('src/types.ts')
  assert.match(types, /export interface DesordreGPA/, 'l’entité DesordreGPA est déclarée')
  const store = lire('src/store.tsx')
  assert.match(store, /etat\.desordresGPA = Array\.isArray\(parsed\.desordresGPA\) \? parsed\.desordresGPA : \[\]/, 'la collection se normalise au chargement, sur le modèle des autres')
  const seed = lire('src/seed.ts')
  assert.match(seed, /desordresGPA: \[\]/, 'la collection est amorcée VIDE — un désordre inventé finirait dans une chronologie opposable')
  assert.match(seed, /tpl-med-gpa/, 'le gabarit de mise en demeure GPA est amorcé dans les prompts du seed')
}

// --- le module reste pur ----------------------------------------------------

{
  const source = lire('src/gpa.ts')
  assert.doesNotMatch(source, /useStore|localStorage|fetch\(|Date\.now|todayISO/, 'la logique GPA ne lit ni l’état ni l’horloge : today est un argument')
}

console.log(
  'GPA : fin = réception + 1 an, UNE formule (gpa.ts) consommée par derive ; levé sort des ouverts, ' +
    'contesté y reste ; relance tracée sans réécrire ; le gabarit M+11 passe par le moteur B.13 et ' +
    'une ligne décochée ne crée rien.',
)
