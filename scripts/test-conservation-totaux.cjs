// B.5 / B.9 — la conservation des totaux.
//
// Le §7.3 désigne ce test comme le seul garde-fou qui protège réellement
// la marge, et aucune ligne du plan ne s'engageait à l'écrire. Le voici.
//
// CE QU'IL GARDE
// --------------
// `state.temps` cesse d'être saisi : il devient une PROJECTION des
// pointages. `derive.ts` n'est pas touché — la marge, le plan de charge et
// la chaîne financière continuent de lire `state.temps` sans savoir d'où
// il vient. C'est ce qui rend la bascule sûre, et c'est aussi ce qui la
// rend dangereuse : si la projection perd un centième d'heure, la marge se
// met à mentir et RIEN ne se produit. Pas d'erreur, pas d'écran rouge —
// juste un chiffre légèrement faux, sur la seule grandeur dont l'agence
// tire son revenu.
//
// Les trois pièges qu'il exerce, nommés par le plan :
//
//   1. les CHEVAUCHEMENTS DE MINUIT — un pointage 23 h 40 → 00 h 20 ;
//   2. les CORRECTIONS RÉTROACTIVES — une durée saisie qui ne se déduit
//      pas des bornes ;
//   3. les POINTAGES SANS TÂCHE — ils alimentent le projet seul.
//
// Et le piège que le plan ne nomme pas mais qui est le plus coûteux :
// l'ARRONDI. Arrondir chaque pointage puis sommer perd jusqu'à un
// demi-centième par pointage ; à vingt par jour et par personne, cela fait
// plusieurs heures par an.

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

const P = charger('src/pointages.ts')

/** un pointage, avec les seuls champs que les projections regardent */
const pt = (over) =>
  P.creerPointage({
    personne: over.personne ?? 'Julien',
    debut: over.debut,
    fin: over.fin === undefined ? over.debut.replace(/T(\d\d)/, (m, h) => `T${String(Number(h) + 1).padStart(2, '0')}`) : over.fin,
    minutes: over.minutes,
    projetId: over.projetId === undefined ? 'P01' : over.projetId,
    phase: over.phase === undefined ? 'APD' : over.phase,
    tacheId: over.tacheId ?? null,
    facturable: over.facturable,
  })

const total = (entrees) => Math.round(entrees.reduce((s, e) => s + e.heures, 0) * 100) / 100

// ============================================================
// 1. LA propriété : rien ne se perd entre les minutes et les heures
// ============================================================

{
  // Vingt pointages de 7 minutes. Arrondis un par un — 0,12 h chacun —
  // ils totaliseraient 2,40 h. La vérité est 140 min = 2,33 h. L'écart
  // paraît dérisoire ; c'est 3 % de l'heure, tous les jours, sur la
  // grandeur qui porte la marge.
  const petits = Array.from({ length: 20 }, (_, i) =>
    pt({ debut: `2026-08-03T09:00:00Z`, fin: null, minutes: 7 }),
  ).map((p) => ({ ...p, fin: '2026-08-03T09:07:00Z' }))

  const projete = P.projeterVersTemps(petits)
  assert.equal(projete.length, 1, 'même semaine, même personne, même projet, même phase : UNE ligne')
  assert.equal(
    projete[0].heures,
    P.heuresDepuisMinutes(140),
    'la division vient à la FIN, une fois par ligne agrégée — jamais par pointage',
  )
  assert.equal(projete[0].heures, 2.33)
  assert.notEqual(projete[0].heures, 2.4, 'arrondir chaque pointage puis sommer donnerait 2,40 h : 3 % de trop')
}

// ============================================================
// 2. La somme des pointages égale la valeur projetée, au centième
// ============================================================

{
  // Un jeu DÉTERMINISTE et réaliste : deux personnes, deux projets, deux
  // phases, sur deux semaines, avec des durées qui ne tombent pas rond.
  const jeu = []
  const personnes = ['Julien', 'Zoé']
  const projets = ['P01', 'P02']
  const phases = ['APD', 'PRO']
  let n = 0
  for (let jour = 3; jour <= 14; jour++) {
    for (const personne of personnes)
      for (const projetId of projets)
        for (const phase of phases) {
          n++
          jeu.push(
            pt({
              personne,
              projetId,
              phase,
              debut: `2026-08-${String(jour).padStart(2, '0')}T08:00:00Z`,
              fin: null,
              // 13, 27, 41… minutes : des durées qui ne tombent jamais sur
              // un centième d'heure exact.
              minutes: 13 + ((n * 14) % 53),
            }),
          )
        }
  }
  const clos = jeu.map((p) => ({ ...p, fin: '2026-08-03T09:00:00Z' }))
  const minutesTotales = clos.reduce((s, p) => s + p.minutes, 0)

  const projete = P.projeterVersTemps(clos)

  // LA propriété, énoncée exactement.
  //
  // `TempsEntry.heures` stocke des HEURES : un arrondi par ligne agrégée
  // est donc inévitable, et la somme de N lignes peut s'écarter du total
  // vrai d'au plus N demi-centièmes. Prétendre à l'exactitude au total
  // serait faux, et un test faux se désactive au premier échec.
  //
  // Ce qui doit être interdit, c'est l'arrondi PAR POINTAGE : il est du
  // même ordre mais multiplié par le nombre de pointages — ici 192 au lieu
  // de 8, soit vingt-quatre fois pire. C'est cette borne-là que le test
  // tient, et elle se resserre quand on agrège mieux, jamais l'inverse.
  const borne = projete.length * 0.005
  const attendu = P.heuresDepuisMinutes(minutesTotales)
  assert.ok(
    Math.abs(total(projete) - attendu) <= borne,
    `${total(projete)} h projetées pour ${attendu} h pointées sur ${projete.length} lignes : ` +
      `l’écart dépasse ${borne} h. Un arrondi par POINTAGE (${clos.length} au lieu de ${projete.length}) ` +
      'donnerait cet écart-là',
  )

  // Chaque ligne, elle, est EXACTE au centième de ses propres minutes.
  // C'est là que se joue la conservation : une ligne juste, toujours.
  for (const ligne of projete) {
    const minutes = clos
      .filter(
        (p) =>
          P.lundiDe(p.debut) === ligne.semaine &&
          p.personne === ligne.personne &&
          p.projetId === ligne.projetId &&
          p.phase === ligne.phase,
      )
      .reduce((s, p) => s + p.minutes, 0)
    assert.equal(
      ligne.heures,
      P.heuresDepuisMinutes(minutes),
      `${ligne.id} : ${ligne.heures} h pour ${minutes} min — la ligne agrégée doit être exacte`,
    )
  }

  // Et par personne, parce que c'est ainsi que le coût est réparti.
  for (const personne of personnes) {
    const lignes = projete.filter((e) => e.personne === personne)
    const attenduPersonne = P.heuresDepuisMinutes(
      clos.filter((p) => p.personne === personne).reduce((s, p) => s + p.minutes, 0),
    )
    assert.ok(
      Math.abs(total(lignes) - attenduPersonne) <= lignes.length * 0.005,
      `${personne} : ${total(lignes)} h projetées pour ${attenduPersonne} h pointées`,
    )
  }
}

// ============================================================
// 3. Les chevauchements de minuit
// ============================================================

{
  // 23 h 40 → 00 h 20, un dimanche. Le pointage appartient au jour et à la
  // SEMAINE de son début. Le découper ferait apparaître deux saisies là où
  // la personne se souvient d'une seule, et déplacerait une partie de son
  // dimanche soir dans la semaine suivante.
  const dimanche = pt({ debut: '2026-08-09T23:40:00Z', fin: '2026-08-10T00:20:00Z' })
  assert.equal(dimanche.minutes, 40, 'la durée traverse minuit sans se perdre')
  assert.equal(P.jourDuPointage(dimanche), '2026-08-09', 'le jour est celui du DÉBUT')

  const projete = P.projeterVersTemps([dimanche])
  assert.equal(projete.length, 1, 'une seule ligne, pas deux')
  assert.equal(
    projete[0].semaine,
    '2026-08-03',
    'la semaine est celle du début : le dimanche 9 août appartient à la semaine du lundi 3',
  )
  assert.equal(projete[0].heures, P.heuresDepuisMinutes(40))

  // Le lendemain matin, lui, est bien dans la semaine suivante.
  const lundi = pt({ debut: '2026-08-10T08:00:00Z', fin: '2026-08-10T09:00:00Z' })
  assert.equal(P.projeterVersTemps([lundi])[0].semaine, '2026-08-10')
}

// ============================================================
// 4. Les corrections rétroactives
// ============================================================

{
  // Une durée saisie l'emporte sur les bornes : quelqu'un corrige « j'ai
  // été interrompu une demi-heure ». Recalculer depuis les bornes
  // effacerait la correction — silencieusement, et au profit d'un chiffre
  // plus grand.
  const corrige = pt({ debut: '2026-08-03T09:00:00Z', fin: '2026-08-03T12:00:00Z', minutes: 150 })
  assert.equal(corrige.minutes, 150, 'la durée fournie l’emporte sur les trois heures des bornes')
  assert.equal(P.projeterVersTemps([corrige])[0].heures, 2.5)

  // Sans durée fournie, elle se déduit des bornes.
  assert.equal(pt({ debut: '2026-08-03T09:00:00Z', fin: '2026-08-03T12:00:00Z' }).minutes, 180)

  // Une fin AVANT le début ne produit pas une durée négative : elle
  // soustrairait du temps au total, et la marge s'améliorerait toute seule.
  assert.equal(P.minutesEntre('2026-08-03T12:00:00Z', '2026-08-03T09:00:00Z'), 0)
  assert.equal(P.minutesEntre('pas une date', '2026-08-03T09:00:00Z'), 0)
}

// ============================================================
// 5. Ce que la projection écarte, et qui n'est pas perdu
// ============================================================

{
  const enCours = pt({ debut: '2026-08-03T09:00:00Z', fin: null, minutes: 0 })
  assert.deepEqual(
    P.projeterVersTemps([enCours]),
    [],
    'un chrono qui tourne n’est pas du temps passé : le compter ferait bouger la marge à chaque rendu',
  )

  const sansProjet = pt({ debut: '2026-08-03T09:00:00Z', projetId: null })
  assert.deepEqual(
    P.projeterVersTemps([sansProjet]),
    [],
    'sans projet, pas de clé dans la grille hebdomadaire — le pointage reste, il n’entre pas ici',
  )

  const sansPhase = pt({ debut: '2026-08-03T09:00:00Z', phase: null })
  assert.deepEqual(
    P.projeterVersTemps([sansPhase]),
    [],
    'inventer une phase fausserait la répartition d’honoraires, donc la marge PAR PHASE',
  )

  // Mais un pointage sans tâche alimente bien le projet : c'est le cas
  // ordinaire, et le régresser casserait toutes les saisies existantes.
  assert.equal(P.projeterVersTemps([pt({ debut: '2026-08-03T09:00:00Z', tacheId: null })]).length, 1)
}

// ============================================================
// 6. La seconde projection : vers la tâche (B.9)
// ============================================================

{
  const jeu = [
    pt({ debut: '2026-08-03T09:00:00Z', fin: '2026-08-03T10:30:00Z', tacheId: 't1' }),
    pt({ debut: '2026-08-04T09:00:00Z', fin: '2026-08-04T09:45:00Z', tacheId: 't1' }),
    pt({ debut: '2026-08-05T09:00:00Z', fin: '2026-08-05T10:00:00Z', tacheId: 't2' }),
    pt({ debut: '2026-08-06T09:00:00Z', fin: '2026-08-06T10:00:00Z', tacheId: null }),
    pt({ debut: '2026-08-07T09:00:00Z', fin: null, minutes: 0, tacheId: 't1' }),
  ]
  const parTache = P.tempsParTache(jeu)
  assert.equal(parTache.get('t1'), P.heuresDepuisMinutes(90 + 45), 'les pointages d’une tâche s’additionnent en MINUTES')
  assert.equal(parTache.get('t1'), 2.25)
  assert.equal(parTache.get('t2'), 1)
  assert.equal(parTache.has('null'), false, 'un pointage sans tâche n’en crée pas une')
  assert.equal(parTache.size, 2, 'et le chrono en cours ne compte pas davantage ici que dans la grille')

  // Les deux projections lisent les MÊMES pointages : leur somme sur une
  // tâche ne peut pas dépasser la somme sur son projet.
  const totalTaches = [...parTache.values()].reduce((s, h) => s + h, 0)
  const totalProjets = total(P.projeterVersTemps(jeu))
  assert.ok(
    totalTaches <= totalProjets + 0.01,
    `le temps par tâche (${totalTaches} h) ne peut pas dépasser le temps par projet (${totalProjets} h)`,
  )
}

// ============================================================
// 7. Déterminisme : rejouer ne change rien
// ============================================================

{
  const jeu = [
    pt({ debut: '2026-08-03T09:00:00Z', fin: '2026-08-03T10:00:00Z' }),
    pt({ debut: '2026-08-04T09:00:00Z', fin: '2026-08-04T10:00:00Z', personne: 'Zoé' }),
  ]
  const a = P.projeterVersTemps(jeu)
  const b = P.projeterVersTemps([...jeu].reverse())
  assert.deepEqual(
    a,
    b,
    'la projection est déterministe et indépendante de l’ordre : sinon chaque recalcul produirait un ' +
      'état différent, et la synchronisation croirait à une modification à chaque ouverture',
  )
  assert.deepEqual(a.map((e) => e.id), b.map((e) => e.id), 'les identifiants sont stables, donc dérivés de la clé')
}

// ============================================================
// 8. B.7 — le facturable, et la règle qu'il ne change pas
// ============================================================

{
  assert.equal(P.facturableParDefaut('P01'), true, 'la règle ACTUELLE est reconduite : un projet est facturable')
  assert.equal(P.facturableParDefaut(null), false)
  assert.equal(
    pt({ debut: '2026-08-03T09:00:00Z', projetId: 'P01' }).facturable,
    true,
    'le défaut vient de la règle, pas d’un choix par écran',
  )
  assert.equal(
    pt({ debut: '2026-08-03T09:00:00Z', projetId: 'P01', facturable: false }).facturable,
    false,
    'et il se corrige par pointage — c’est tout l’objet de B.7',
  )

  const jeu = [
    pt({ debut: '2026-08-03T09:00:00Z', fin: '2026-08-03T10:00:00Z', facturable: true }),
    pt({ debut: '2026-08-04T09:00:00Z', fin: '2026-08-04T10:00:00Z', facturable: false }),
  ]
  assert.equal(P.minutesFacturables(jeu), 60)
  // Le non-facturable reste dans la grille : il a coûté du temps, même
  // s'il ne se facture pas. L'exclure ferait disparaître du coût réel.
  assert.equal(total(P.projeterVersTemps(jeu)), 2, 'la grille compte TOUT le temps ; la facturation trie ensuite')
}

// ============================================================
// 9. `derive.ts` n'est pas touché
// ============================================================

// La bascule n'est sûre que parce que la marge continue de lire
// `state.temps` sans savoir d'où il vient. Le jour où `derive.ts` lirait
// les pointages directement, il y aurait deux chemins vers la même
// grandeur — et c'est ainsi que les deux gravités des factures à émettre
// avaient fini par diverger.
const derive = lire('src/derive.ts')
assert.doesNotMatch(
  derive,
  /from '\.\/pointages'|state\.pointages/,
  'derive.ts ne doit PAS connaître les pointages : il lit `state.temps`, qui en est la projection. ' +
    'Deux chemins vers la marge finissent toujours par diverger',
)
assert.match(derive, /state\.temps/, 'et il continue bien de lire la grille')

console.log(
  'Conservation des totaux : minutes sommées puis divisées une seule fois, minuit sans découpe, ' +
    'corrections préservées, deux projections cohérentes, et `derive.ts` intact.',
)
