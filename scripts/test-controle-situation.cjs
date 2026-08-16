// 5.5 — contrôle d'une situation d'entreprise contre le réel (retour du
// 03/08/2026) : « elle demande 60 %, le chantier dit 40 % », et la révision
// demandée face au théorique des indices.
//
// Ce contrôle est la dernière lecture avant le visa d'un certificat de
// paiement : un chiffre faux ici, c'est un paiement faux là-bas. C'est
// pourquoi les cas sont CHIFFRÉS À LA MAIN — et pourquoi le module doit
// rester muet sur la suite : la machine pose les chiffres côte à côte,
// l'humain décide (§15).
//
// Cinq garanties tenues :
//
//   1. l'écart d'avancement, recalculé à la main : cumul 60 000 sur un
//      marché de 100 000 = 60 %, chantier constaté à 40 % ⇒ 20 pts —
//      et le seuil du badge est une constante nommée, pas un 10 en dur ;
//   2. la révision demandée face au théorique de 5.4, assis sur le MÊME
//      cumul, avec l'approximation dite quand l'indice du mois manque ;
//   3. marché sans tâches ⇒ pctChantier null ET le manque est DIT
//      (« pas d'avancement saisi au planning travaux ») — jamais un 0
//      qui ferait douter d'une situation légitime ;
//   4. situation sans marché ⇒ contrôle vide : tout à null, rien à dire ;
//   5. AUCUN mot de verdict — ni dans la source du module, ni dans ce
//      qu'il produit, même sur un écart de 20 pts : des chiffres, pas un
//      jugement.

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

const C = charger('src/controleSituation.ts')

// --- le décor : un marché, son planning, ses indices ------------------------

const MARCHE = {
  id: 'm1',
  projetId: 'P01',
  entreprise: 'Maçonnerie Durand',
  lot: 'Lot 02 — Gros œuvre',
  montantInitialHT: 90000,
  avenantsHT: 10000, // plafond 100 000 : le % demandé se lit AVENANTS INCLUS
  tauxRG: 0.05,
  revision: true,
  indiceRevision: 'BT01',
  moisZero: '2025-10',
  delaiVerifJours: 15,
  actif: true,
}
// I0 = 110 (2025-10), In = 121 (2026-03) : coefficient 0,15 + 0,85 × 1,1 = 1,085
const INDICES = [
  { id: 'i1', indice: 'BT01', mois: '2025-10', valeur: 110 },
  { id: 'i2', indice: 'BT01', mois: '2026-03', valeur: 121 },
]
// une seule tâche à 40 % : l'avancement du lot est celui de 5.6 (pondéré),
// ici 40 tout court — le cas de référence du plan
const TACHES = [
  {
    id: 't1',
    projetId: 'P01',
    marcheId: 'm1',
    lot: 'Lot 02 — Gros œuvre',
    designation: 'Élévations',
    debut: '2026-01-05',
    fin: '2026-04-30',
    statut: 'en_cours',
    avancement: 40,
  },
]

const etat = (over = {}) => ({ marches: [MARCHE], tachesChantier: TACHES, indicesBTP: INDICES, ...over })
const situation = (over = {}) => ({
  id: 's1',
  projetId: 'P01',
  marcheId: 'm1',
  entreprise: 'Maçonnerie Durand',
  lot: 'Lot 02 — Gros œuvre',
  mois: '2026-03',
  numero: 3,
  montantMoisHT: 20000,
  montantCumulHT: 60000,
  statut: 'a_verifier',
  dateReception: '2026-04-02',
  revisionHT: 6000,
  ...over,
})

// --- 1. l'écart d'avancement, chiffré à la main -----------------------------

{
  const c = C.controleSituation(etat(), situation())
  assert.equal(c.pctDemande, 60, 'cumul 60 000 / marché 100 000 (avenants inclus) = 60 %')
  assert.equal(c.pctChantier, 40, 'le chantier dit 40 : le chiffre vient d’avancementLot (5.6), pas d’un calcul local')
  assert.equal(c.ecartPts, 20, 'elle demande 60, le chantier dit 40 ⇒ écart 20 pts — le cas de référence du plan')
  assert.deepEqual(c.manques, [], 'quand tout se calcule, il n’y a rien à signaler comme manquant')

  assert.equal(C.SEUIL_ECART_AVANCEMENT_PTS, 10, 'le seuil du badge est une constante NOMMÉE à ~10 pts — l’écran la lit, il n’a pas son propre 10')

  // le % demandé n'inclut PAS la révision : le plafond du marché est en prix
  // de base, comparer une base révisée à un plafond non révisé gonflerait
  // l'écart de quelques points sans qu'on sache pourquoi
  const sansRevision = C.controleSituation(etat(), situation({ revisionHT: null }))
  assert.equal(sansRevision.pctDemande, 60, 'la révision ne pèse pas dans le % demandé : cumul de TRAVAUX sur plafond de travaux')
}

// --- 2. la révision demandée face au théorique ------------------------------

{
  const c = C.controleSituation(etat(), situation())
  assert.ok(c.revisionTheorique, 'marché paramétré + indices saisis : le théorique se calcule')
  // à la main : base = cumul 60 000, coefficient 1,085 ⇒ 60 000 × 0,085 = 5 100
  assert.equal(c.revisionTheorique.montant, 5100, 'le théorique est assis sur le MÊME cumul que le % demandé : 60 000 × (1,085 − 1)')
  assert.equal(c.revisionTheorique.approximatif, false, 'l’indice de mars est publié : rien d’approximatif')
  assert.equal(c.revisionDemandee, 6000, 'le chiffre de l’entreprise est rendu tel quel — c’est lui qu’on regarde en face')
  assert.equal(c.ecartRevision, 900, '6 000 demandés − 5 100 théoriques = 900 € au-dessus (le signe dit le sens)')

  // juin demandé, dernier indice publié : mars — l'approximation est DITE,
  // avec le mois qui a servi, pour que l'écran écrive « indice de mars 2026 »
  const approx = C.controleSituation(etat(), situation({ mois: '2026-06' }))
  assert.equal(approx.revisionTheorique.approximatif, true, 'indice du mois absent ⇒ le contrôle le DIT — jamais en silence')
  assert.equal(approx.revisionTheorique.indiceUtilise.mois, '2026-03', 'le mois réellement utilisé est rendu pour l’affichage')

  // théorique là, chiffre de l'entreprise absent : l'écart ne s'invente pas
  const sansSaisie = C.controleSituation(etat(), situation({ revisionHT: null }))
  assert.equal(sansSaisie.revisionTheorique.montant, 5100)
  assert.equal(sansSaisie.revisionDemandee, null)
  assert.equal(sansSaisie.ecartRevision, null, 'un seul terme ⇒ pas d’écart : le comparer à 0 affirmerait une demande qui n’existe pas')
  assert.ok(
    sansSaisie.manques.some((m) => m.includes('pas de révision saisie')),
    'le bloc DIT que la comparaison attend le chiffre demandé',
  )

  // marché révisable mais référentiel vide : le théorique manque ET on dit où corriger
  const sansIndices = C.controleSituation(etat({ indicesBTP: [] }), situation())
  assert.equal(sansIndices.revisionTheorique, null)
  assert.equal(sansIndices.ecartRevision, null)
  assert.ok(
    sansIndices.manques.some((m) => m.includes('Indices BTP')),
    'indices non saisis ⇒ le manque pointe vers Paramètres → Indices BTP',
  )

  // marché non révisable avec un montant tout de même demandé : le constat
  // se lit — factuel, sans qualifier la demande
  const nonRevisable = C.controleSituation(etat({ marches: [{ ...MARCHE, revision: false }] }), situation())
  assert.equal(nonRevisable.revisionTheorique, null)
  assert.ok(
    nonRevisable.manques.some((m) => m.includes('non révisable')),
    'marché non révisable + montant demandé ⇒ le bloc dit qu’il n’y a pas de théorique en face',
  )
}

// --- 3. marché sans tâches ⇒ pctChantier null ET le manque est dit ----------

{
  const c = C.controleSituation(etat({ tachesChantier: [] }), situation())
  assert.equal(c.pctChantier, null, 'aucune tâche au planning ⇒ null : « on ne sait pas » n’est pas « rien n’est fait »')
  assert.equal(c.ecartPts, null, 'sans avancement constaté, aucun écart ne se fabrique')
  assert.equal(c.pctDemande, 60, 'le terme qui SE calcule reste rendu — un manque n’efface pas l’autre moitié')
  assert.ok(
    c.manques.includes("pas d'avancement saisi au planning travaux"),
    'le bloc DIT ce qui manque, dans les mots du plan, au lieu de se taire',
  )
}

// --- le cumul absent se dit aussi, au lieu de valoir 0 ----------------------

{
  const c = C.controleSituation(etat(), situation({ montantMoisHT: null, montantCumulHT: null }))
  assert.equal(c.pctDemande, null, 'sans cumul saisi, « 0 % demandé » affirmerait une lecture qui n’a pas eu lieu')
  assert.equal(c.ecartPts, null)
  assert.equal(c.revisionTheorique, null, 'le théorique est assis sur le cumul : sans base, pas de théorique')
  assert.ok(
    c.manques.some((m) => m.includes('pas de cumul saisi')),
    'le manque du cumul est dit une fois, il explique les deux trous',
  )
}

// --- 4. situation sans marché ⇒ contrôle vide -------------------------------

{
  // entreprise inconnue des marchés : même le rattachement par nom (fallback
  // de marcheDeSituation) ne joue pas
  const c = C.controleSituation(etat(), situation({ marcheId: null, entreprise: 'Entreprise Inconnue' }))
  assert.deepEqual(
    c,
    {
      pctDemande: null,
      pctChantier: null,
      ecartPts: null,
      revisionTheorique: null,
      revisionDemandee: null,
      ecartRevision: null,
      manques: [],
    },
    'sans marché il n’y a ni plafond, ni lot, ni formule : tout est null et rien n’est dit — l’écran ne montre pas le bloc',
  )
}

// --- 5. aucun mot de verdict : des chiffres, pas un jugement ----------------

{
  // le lexique du jugement : si l'un de ces mots entre dans le module ou dans
  // ce qu'il produit, la machine a décidé à la place de l'humain (§15)
  const interdits = /refus|rejet|anormal|suspect|abusi|exagér|frauduleu|inacceptable|douteu|gonflé/i
  assert.doesNotMatch(
    lire('src/controleSituation.ts'),
    interdits,
    'le module ne prononce AUCUN verdict — « refusée », « anormale » et leurs cousins n’ont pas leur place dans src/controleSituation.ts',
  )
  // même sur un écart de 20 pts, la sortie reste factuelle
  assert.doesNotMatch(
    JSON.stringify(C.controleSituation(etat(), situation())),
    interdits,
    'la sortie du contrôle reste des chiffres, même quand l’écart est grand',
  )
  // et quand tout manque, les messages de manque restent des constats
  assert.doesNotMatch(
    JSON.stringify(C.controleSituation(etat({ tachesChantier: [], indicesBTP: [] }), situation())),
    interdits,
    'les messages de manque décrivent des données absentes, jamais la situation elle-même',
  )
}

// --- le câblage dans le module des vues de situation -----------------------
//
// TRANCHE 3 : Situations.tsx n'est plus un écran (`#/situations` monte
// `<Entreprises />`), c'est le module qui définit ses cartes. Le code lu
// ci-dessous n'a pas bougé — seul l'endroit où il se monte a changé.

{
  const ecran = lire('src/modules/Situations.tsx')
  assert.match(ecran, /controleSituation/, 'la fiche de la situation lit le module partagé, pas un calcul local qui divergerait')
  assert.match(ecran, /SEUIL_ECART_AVANCEMENT_PTS/, 'le badge d’écart lit la constante nommée — un 10 en dur divergerait du module en silence')
  assert.match(ecran, /entreprise demande/, 'le bloc écrit « l’entreprise demande X % »')
  assert.match(ecran, /le chantier dit/, 'le bloc écrit « le chantier dit Y % » — les deux chiffres côte à côte')
  assert.match(ecran, /ctl\.manques/, 'le bloc AFFICHE les manques du module au lieu de se taire')
  assert.match(ecran, /approximatif/, 'l’approximation de l’indice se lit à l’écran, pas seulement dans la structure')
}

// --- la logique reste pure --------------------------------------------------

{
  assert.doesNotMatch(
    lire('src/controleSituation.ts'),
    /useStore|localStorage|fetch\(|Date\.now|new Date\(/,
    'src/controleSituation.ts est de la logique PURE : l’état est un argument, le mois est celui de la situation — aucune horloge',
  )
}

console.log(
  'Contrôle des situations : 60 % demandés contre 40 % constatés ⇒ 20 pts (seuil nommé), révision demandée face au ' +
    'théorique sur le même cumul (900 € d’écart, approximation dite), manques DITS (planning vide, cumul absent, indices ' +
    'manquants), contrôle vide sans marché — et pas un mot de verdict, ni dans la source ni dans les sorties.',
)
