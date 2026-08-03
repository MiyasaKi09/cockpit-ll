// B.17 — ce qui rend le critère 11 OPPOSABLE sur les entités nouvelles.
//
// Le critère 11 du §22 dit que les propositions de la machine doivent
// pouvoir être « acceptées, modifiées ou refusées ». C'est une phrase ; ce
// fichier en fait une propriété vérifiable.
//
// Les cinq points du plan, et pourquoi chacun compte :
//
//   1. aucun `grant update` d'une colonne `*_propos*` à `authenticated` —
//      sinon un écran peut réécrire ce que la machine a proposé, et la
//      trace de ce qui a été proposé disparaît ;
//   2. le domaine de `propositions.statut` ne contient aucun statut métier
//      — sinon une proposition DEVIENT la décision qu'elle propose ;
//   3. aucune Edge Function n'ÉCRIT dans `workspace.data` — c'est le point
//      que rien ne couvrait, et le plus facile à franchir par mégarde ;
//   4. les trois listes fermées du §5.2 sont identiques en base et dans
//      `src/categorisation.ts` ;
//   5. `charge_utile->>'cible'` reste borné à `tache` / `contact` — une
//      échéance proposée ne crée jamais une obligation juridique.
//
// Les points 1, 2, 4 et 5 sont aussi vérifiés par les tests de leurs
// livrables respectifs. Le doublon est VOULU : ces tests-là partent de la
// migration qu'ils accompagnent, celui-ci part du critère. Le jour où une
// migration future ajoutera une table de propositions, c'est ici qu'on
// s'apercevra qu'elle n'a pas les mêmes garanties.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')
const migrations = path.join(racine, 'supabase/migrations')
const sqlDeToutes = fs
  .readdirSync(migrations)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ nom: f, sql: fs.readFileSync(path.join(migrations, f), 'utf8') }))

/** exécute un module du dépôt : les listes fermées se COMPOSENT
 *  (PHASES_ECHANGE part de PHASES_ORDRE), donc les lire au regex ne
 *  rendrait qu'une partie des valeurs — et le test comparerait deux
 *  extractions incomplètes en croyant comparer deux référentiels. */
const cacheMod = new Map()
function charger(chemin) {
  const fichier = chemin.endsWith('.ts') ? chemin : `${chemin}.ts`
  if (cacheMod.has(fichier)) return cacheMod.get(fichier)
  const compile = ts.transpileModule(lire(fichier), {
    fileName: fichier,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  cacheMod.set(fichier, mod.exports)
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (id === 'react') return { useCallback: (f) => f, useEffect: () => {}, useMemo: (f) => f(), useRef: () => ({}), useState: () => [] }
    if (id === '@supabase/supabase-js') return { createClient: () => null }
    if (id.startsWith('.')) return charger(require('node:path').posix.join(require('node:path').posix.dirname(fichier), id))
    throw new Error(`Dépendance externe inattendue dans ${fichier} : ${id}`)
  })
  cacheMod.set(fichier, mod.exports)
  return mod.exports
}

/** parcourt récursivement un dossier de sources */
function fichiers(dossier, motif = /\.ts$/) {
  const sortie = []
  for (const e of fs.readdirSync(path.join(racine, dossier), { withFileTypes: true })) {
    const rel = `${dossier}/${e.name}`
    if (e.isDirectory()) sortie.push(...fichiers(rel, motif))
    else if (motif.test(e.name)) sortie.push(rel)
  }
  return sortie
}

// ============================================================
// 1. Rien de « proposé » n'est écrivable depuis le navigateur
// ============================================================

for (const { nom, sql } of sqlDeToutes) {
  for (const bloc of sql.matchAll(/grant update \(([\s\S]*?)\)\s*\n\s*on table (public\.[a-z_]+)\s*\n\s*to ([a-z_, ]+);/g)) {
    const [, colonnes, table, beneficiaires] = bloc
    if (!/authenticated/.test(beneficiaires)) continue
    const fautives = [...colonnes.matchAll(/([a-z_]+)/g)]
      .map((m) => m[1])
      .filter((c) => /propos/.test(c) || /^confiance_/.test(c) || /^raisons_/.test(c))
    assert.deepEqual(
      fautives,
      [],
      `${nom} : ${table} accorde au navigateur l’écriture de ${fautives.join(', ')} — ` +
        'ce que la machine a proposé ne se réécrit pas depuis un écran (§3.14, critère 11)',
    )
  }
}

// ============================================================
// 2. Aucun statut métier dans le domaine des propositions
// ============================================================

{
  const domaines = sqlDeToutes
    .flatMap(({ nom, sql }) =>
      [...sql.matchAll(/create domain (public\.statut_[a-z_]+) as text\s*\n\s*check \(value in \(([\s\S]*?)\)\)/g)].map(
        (m) => ({ nom, domaine: m[1], valeurs: [...m[2].matchAll(/'([a-z_]+)'/g)].map((v) => v[1]) }),
      ),
    )
  assert.ok(domaines.length > 0, 'au moins un domaine de statut doit exister')

  const METIER = ['confirm', 'valide', 'conteste', 'verifi', 'annul', 'refus', 'termin', 'cloture', 'expir']
  for (const { nom, domaine, valeurs } of domaines) {
    if (!/proposition/.test(domaine)) continue
    for (const v of valeurs)
      for (const mot of METIER)
        assert.ok(
          !v.includes(mot),
          `${nom} : ${domaine} admet « ${v} » — une proposition ne devient jamais la décision qu’elle ` +
            'propose. Ces statuts appartiennent à l’entité `decisions` (livrable 2.1)',
        )
    assert.deepEqual(
      valeurs.slice().sort(),
      ['acceptee', 'ignoree', 'proposee'],
      `${domaine} : trois statuts, et rien d’autre`,
    )
  }
}

// ============================================================
// 3. Aucune Edge Function n'ÉCRIT dans `workspace.data`
// ============================================================
//
// C'est le point que rien ne couvrait, et celui qu'on franchit par
// mégarde : `.from('workspace')` est légitime — trois fonctions y lisent
// les repères de classement de l'agence. Ce qui ne l'est pas, c'est le
// verbe qui suit. Une Edge Function qui écrirait dans le document partagé
// contournerait le verrou compare-and-swap ET la validation humaine : une
// tâche, une décision ou un risque y apparaîtraient sans que personne les
// ait acceptés.

{
  const ECRITURES = ['insert', 'update', 'upsert', 'delete']
  let lectures = 0
  for (const fichier of fichiers('supabase/functions')) {
    const source = ts.transpileModule(lire(fichier), {
      fileName: fichier,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: true },
    }).outputText

    for (const acces of source.matchAll(/\.from\(\s*['"]workspace['"]\s*\)\s*\.\s*([a-zA-Z]+)\s*\(/g)) {
      const verbe = acces[1].toLowerCase()
      assert.ok(
        !ECRITURES.includes(verbe),
        `${fichier} : \`.from('workspace').${acces[1]}()\` — aucune Edge Function n’écrit dans le document ` +
          'partagé (§3.14). Elle contournerait le verrou de révision ET la validation humaine, et une ' +
          'tâche y apparaîtrait sans que personne l’ait acceptée',
      )
      lectures++
    }

    // La RPC d'écriture est réservée au navigateur : l'appeler depuis le
    // serveur reviendrait au même par un autre chemin.
    assert.doesNotMatch(
      source,
      /rpc\(\s*['"]enregistrer_workspace['"]/,
      `${fichier} : une Edge Function ne doit pas appeler enregistrer_workspace — ` +
        'c’est le chemin d’écriture du NAVIGATEUR',
    )
  }
  assert.ok(lectures >= 3, `au moins trois fonctions lisent l’état partagé, ${lectures} vues — le test cherche-t-il au bon endroit ?`)
}

// ============================================================
// 4. Les trois listes fermées du §5.2, en base et dans le code
// ============================================================

{
  const categorisation = charger('src/categorisation.ts')
  const listeCode = (nom) => {
    assert.ok(Array.isArray(categorisation[nom]), `${nom} doit être exportée par src/categorisation.ts`)
    return categorisation[nom]
  }
  const listeSql = (domaine) => {
    for (const { sql } of sqlDeToutes) {
      const bloc = new RegExp(`create domain public\\.${domaine} as text\\s*\\n\\s*check \\(value in \\(([\\s\\S]*?)\\)\\)`).exec(sql)
      if (bloc) return [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    }
    assert.fail(`domaine ${domaine} introuvable dans les migrations`)
  }

  for (const [nomCode, domaine] of [
    ['PHASES_ECHANGE', 'phase_echange'],
    ['TYPES_ECHANGE', 'type_echange'],
    ['NIVEAUX_IMPORTANCE', 'niveau_importance'],
  ]) {
    assert.deepEqual(
      listeSql(domaine).slice().sort(),
      listeCode(nomCode).slice().sort(),
      `${domaine} et ${nomCode} doivent contenir exactement les mêmes valeurs : une divergence ferait ` +
        'échouer l’écriture côté serveur, sur un message qu’on ne reverra pas',
    )
  }
}

// ============================================================
// 5. Une échéance proposée ne crée aucune échéance juridique
// ============================================================

{
  const valeurs = (() => {
    for (const { sql } of sqlDeToutes) {
      const bloc = /create domain public\.objet_propose as text\s*\n\s*check \(value in \(([\s\S]*?)\)\)/.exec(sql)
      if (bloc) return [...bloc[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    }
    assert.fail('le domaine objet_propose est introuvable')
  })()

  assert.deepEqual(
    valeurs.slice().sort(),
    ['contact', 'tache'],
    'les deux SEULES destinations d’une proposition acceptée (§3.14, décision 4)',
  )
  for (const interdit of ['obligation', 'echeance_facturation', 'facture', 'marche', 'situation'])
    assert.ok(
      !valeurs.includes(interdit),
      `« ${interdit} » est une échéance juridique ou financière : le §15 interdit d’en créer une sans ` +
        'confirmation. Le chemin ne doit pas exister, même par bug applicatif',
    )

  // Et la contrainte doit bien porter sur la charge utile, pas seulement
  // exister comme domaine : un domaine que personne n'applique ne protège rien.
  const applique = sqlDeToutes.some(({ sql }) =>
    /charge_utile ->> 'cible'\)::public\.objet_propose/.test(sql),
  )
  assert.ok(
    applique,
    'le domaine doit être APPLIQUÉ à `charge_utile->>\'cible\'` par un CHECK : ' +
      'un domaine déclaré et jamais utilisé est décoratif',
  )
}

// ============================================================
// 6. Le miroir côté navigateur ne peut pas être plus permissif
// ============================================================
//
// `src/propositions.ts` traduit les mêmes listes fermées. Si le navigateur
// en connaît une de plus, il l'affichera et proposera de l'écrire — et
// l'échec viendra de la base, après le clic, sur une détection perdue.

{
  const propositions = charger('src/propositions.ts')
  const liste = (nom) => {
    assert.ok(Array.isArray(propositions[nom]), `${nom} doit être exportée par src/propositions.ts`)
    return propositions[nom]
  }
  const enBase = (domaine) => {
    for (const { sql } of sqlDeToutes) {
      const bloc = new RegExp(`create domain public\\.${domaine} as text\\s*\\n\\s*check \\(value in \\(([\\s\\S]*?)\\)\\)`).exec(sql)
      if (bloc) return [...bloc[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    }
    assert.fail(`domaine ${domaine} introuvable`)
  }

  for (const [nomCode, domaine] of [
    ['GENRES_PROPOSITION', 'genre_proposition'],
    ['STATUTS_PROPOSITION', 'statut_proposition'],
    ['OBJETS_PROPOSABLES', 'objet_propose'],
    ['NATURES_RISQUE', 'nature_risque'],
  ]) {
    assert.deepEqual(
      liste(nomCode).slice().sort(),
      enBase(domaine).slice().sort(),
      `${nomCode} et ${domaine} doivent coïncider — sinon le navigateur propose une valeur que la base refuse`,
    )
  }
}

console.log(
  'Critère 11 opposable : aucune colonne proposée écrivable, aucun statut métier, aucune Edge Function ' +
    'n’écrit l’état partagé, listes fermées identiques en base et dans le code, échéance sans destination juridique.',
)
