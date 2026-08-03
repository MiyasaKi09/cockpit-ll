// B.10 / B.11 — les quatre gestes du §8.7, et ce qu'ils n'ont pas le droit
// de faire.
//
// A.9 a créé la table, A.10 la remplit. Cet étage-ci est celui où le §15
// se joue pour de bon : accepter une proposition ne la TRANSFORME pas, cela
// crée un objet et fait pointer la proposition vers lui. La différence
// paraît subtile ; elle est tout le sujet.
//
// Quatre choses tenues ici :
//
//   1. accepter crée un objet ET signe — jamais l'un sans l'autre, sinon la
//      contrainte SQL refuse et la détection est perdue ;
//   2. « Modifier » ne crée RIEN. Créer d'abord et laisser corriger
//      reviendrait à accepter par défaut, obtenu par l'ergonomie plutôt
//      que par le schéma ;
//   3. le responsable n'est JAMAIS pré-rempli par la machine (§3.15) ;
//   4. une échéance proposée ne vise que `tache` ou `contact` — jamais une
//      obligation ni une échéance de facturation.

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
    if (id === 'react') return { useCallback: (f) => f, useEffect: () => {}, useMemo: (f) => f(), useRef: () => ({}), useState: () => [] }
    if (id === '@supabase/supabase-js') return { createClient: () => null }
    if (id.startsWith('.')) return charger(path.posix.join(path.posix.dirname(fichier), id))
    throw new Error(`Dépendance externe inattendue dans ${fichier} : ${id}`)
  })
  cache.set(fichier, mod.exports)
  return mod.exports
}

const R = charger('src/revuePropositions.ts')
const { GENRES_PROPOSITION, OBJETS_PROPOSABLES } = charger('src/propositions.ts')

const prop = (over = {}) => ({
  id: over.id ?? 'p1',
  genre: over.genre ?? 'tache',
  chargeUtile: over.chargeUtile ?? { titre: 'Confirmer le planning' },
  extrait: over.extrait ?? 'Pouvez-vous confirmer le planning avant vendredi ?',
  confiance: 0.8,
  raisons: ['Demande adressée.'],
  projetId: over.projetId ?? 'P01',
})

// --- les quatre gestes du §8.7, littéralement -------------------------------

{
  const cdc = lire('docs/CDC_MAILS_TACHES_TEMPS.md')
  assert.match(cdc, /## 8\.7/, 'le §8.7 doit exister')
  assert.deepEqual(
    [...R.GESTES_REVUE],
    ['accepter', 'modifier', 'attribuer', 'ignorer'],
    'les quatre gestes du §8.7, dans son ordre',
  )
}

// --- 1. accepter crée un objet ET signe -------------------------------------

{
  const { tache, signature } = R.accepterTache(prop(), { responsable: 'Zoé', par: 'Julien' })

  assert.equal(tache.titre, 'Confirmer le planning')
  assert.equal(tache.projetId, 'P01', 'la tâche hérite du projet du MESSAGE, lu par jointure')
  assert.equal(tache.responsable, 'Zoé', 'le responsable est celui que l’humain a choisi')
  assert.equal(tache.createur, 'Julien', 'et le créateur est celui qui a accepté')
  assert.equal(
    tache.statut,
    'a_faire',
    'la tâche naît « à faire » et non « à qualifier » : elle vient précisément d’être qualifiée',
  )
  assert.deepEqual(
    tache.source,
    { type: 'proposition', id: 'p1' },
    'la source permet de remonter à l’extrait cité (§4.2)',
  )

  // La signature, et l'équivalence de la contrainte SQL.
  assert.equal(signature.statut, 'acceptee')
  assert.equal(signature.objet_cree_type, 'tache')
  assert.equal(
    signature.objet_cree_id,
    tache.id,
    'la proposition DÉSIGNE l’objet créé ; elle ne devient pas cet objet',
  )
  assert.ok(signature.traite_par && signature.traite_le, 'rien ne quitte « proposée » sans signature')
  assert.ok(
    OBJETS_PROPOSABLES.includes(signature.objet_cree_type),
    'le type d’objet créé appartient au domaine SQL — sinon l’écriture est refusée et la détection perdue',
  )

  // L'équivalence est une équivalence : ni statut sans objet, ni objet
  // sans statut. On vérifie que la fonction ne peut pas produire l'un
  // sans l'autre.
  assert.ok(
    (signature.statut === 'acceptee') === (signature.objet_cree_type !== undefined),
    '(statut = acceptee) ⟺ (objet désigné) — c’est la contrainte SQL, reproduite ici',
  )
}

// --- le titre : jamais vide, et l'extrait sert de repli ---------------------

{
  const sansTitre = R.accepterTache(prop({ chargeUtile: {} }), { responsable: null, par: 'Julien' })
  assert.ok(sansTitre.tache.titre.length > 0, 'une tâche sans titre n’existe pas : l’extrait sert de repli')
  assert.ok(sansTitre.tache.titre.length <= 120, 'et il reste lisible dans une liste')

  const corrige = R.accepterTache(prop(), { titre: 'Autre chose', responsable: null, par: 'Julien' })
  assert.equal(corrige.tache.titre, 'Autre chose', 'le titre corrigé par l’humain l’emporte sur la détection')
}

// --- 3. le responsable n'est jamais pré-rempli par la machine ---------------

{
  const brouillon = R.brouillonDepuis(prop({ chargeUtile: { titre: 'X', responsable: 'Julien' } }))
  assert.equal(
    brouillon.responsable,
    null,
    'même quand la détection a « suggéré » quelqu’un, le champ reste VIDE : le §3.15 pose qu’aucune ' +
      'machine ne choisit qui est notifié, et un champ pré-rempli se valide sans être lu',
  )
  assert.equal(brouillon.titre, 'X', 'le titre, lui, est bien pré-rempli — il se relit d’un coup d’œil')

  const source = lire('src/revuePropositions.ts')
  assert.doesNotMatch(
    source,
    /responsable:\s*(?:charge|p)\.[a-zA-Z]/,
    'aucun chemin ne doit lire un responsable dans la charge utile de la détection',
  )
}

// --- 2. « Modifier » ne crée rien -------------------------------------------

{
  // Le brouillon est une STRUCTURE, pas une tâche : il n'a ni identifiant,
  // ni statut, ni source. Créer d'abord et laisser corriger reviendrait à
  // accepter par défaut — le §15 obtenu à l'envers, par l'ergonomie.
  const brouillon = R.brouillonDepuis(prop())
  assert.equal(brouillon.id, undefined, '« Modifier » ne produit AUCUN objet : pas d’identifiant')
  assert.equal(brouillon.statut, undefined, 'ni de statut')
  assert.equal(brouillon.source, undefined, 'ni de source — rien n’a été créé')
}

// --- 4. B.11 : une échéance ne vise que `tache` ou `contact` -----------------

{
  assert.equal(R.cibleEcheance(prop({ chargeUtile: { cible: 'tache', date: '2026-09-15' } })), 'tache')
  assert.equal(R.cibleEcheance(prop({ chargeUtile: { cible: 'contact', date: '2026-09-15' } })), 'contact')

  // Les deux destinations interdites : une `Obligation` déclenche un rappel
  // réglementaire de gravité 3, une `EcheanceFacturation` commande
  // l'émission d'une facture. Le §15 interdit de créer l'une ou l'autre
  // sans confirmation.
  for (const interdit of ['obligation', 'echeance_facturation', 'facture', 'marche'])
    assert.equal(
      R.cibleEcheance(prop({ chargeUtile: { cible: interdit, date: '2026-09-15' } })),
      null,
      `« ${interdit} » est une échéance juridique ou financière : le chemin ne doit pas exister`,
    )

  assert.equal(R.dateEcheance(prop({ chargeUtile: { date: '2026-09-15' } })), '2026-09-15')
  assert.equal(
    R.dateEcheance(prop({ chargeUtile: { date: '15/09/2026' } })),
    null,
    'une date mal formée est refusée plutôt que réinterprétée : le format français et l’ISO ne se devinent pas',
  )
  assert.equal(R.dateEcheance(prop({ chargeUtile: {} })), null)

  // Le module ne doit même pas fabriquer la valeur interdite.
  const source = lire('src/revuePropositions.ts')
  assert.doesNotMatch(
    source,
    /'obligation'|'echeance_facturation'|obligations\.push|echeancesFacturation\.push/,
    'ce module ne fabrique aucune échéance juridique — c’est une ceinture, la contrainte SQL est la bretelle',
  )
}

// --- ignorer : un motif, même court, est obligatoire ------------------------

{
  const refus = R.ignorer('Pas une tâche', 'Julien')
  assert.equal(refus.statut, 'ignoree')
  assert.equal(refus.motif, 'Pas une tâche')
  assert.ok(refus.traite_par && refus.traite_le, 'ignorer est signé, comme accepter')

  for (const vide of ['', '   ', null, undefined])
    assert.ok(
      R.ignorer(vide, 'Julien').erreur,
      'un motif est nécessaire : « pas une tâche » et « déjà fait » n’apprennent pas la même chose ' +
        'au détecteur, et sans motif on ne peut plus rien apprendre',
    )

  assert.ok(R.ignorer('x'.repeat(500), 'Julien').motif.length <= 200, 'le motif reste COURT')
}

// --- le module reste pur ----------------------------------------------------

{
  const source = lire('src/revuePropositions.ts')
  for (const interdit of [/useStore/, /from '\.\/sync'/, /from '\.\/horsLigne'/, /fetch\(/, /localStorage/])
    assert.doesNotMatch(source, interdit, `le module de revue n’écrit rien lui-même : ${interdit}`)

  // Il rend ce qu'il faut écrire DES DEUX CÔTÉS. Les deux écritures vivent
  // dans deux mémoires différentes — la tâche dans le JSONB, la signature
  // dans la table — et prétendre les faire atomiquement serait mentir.
  assert.match(source, /deux mémoires différentes/, 'la non-atomicité doit être DITE, pas découverte')

  assert.ok(GENRES_PROPOSITION.includes('tache') && GENRES_PROPOSITION.includes('echeance'))
}

console.log(
  'Revue des propositions : accepter crée ET signe, modifier ne crée rien, le responsable n’est jamais ' +
    'pré-rempli, et une échéance ne vise que tâche ou contact.',
)
