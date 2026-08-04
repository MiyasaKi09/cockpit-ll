// 5.12 — congés × heures planifiées : le conflit se détecte, le report se
// PROPOSE, rien ne s'applique seul (§15, retour 03/08/2026).
//
// Le mode de panne couvert : deux jours de congé posés sur une semaine à
// 35 h planifiées ne faisaient aucun bruit — on découvrait le trou la
// semaine même, quand il n'y a plus rien à replacer. Et le mode de panne
// symétrique, plus sournois : un module qui « aiderait » en décalant les
// phases tout seul — une pénalité de planning appliquée sans décision
// humaine. Ce test tient les deux bords :
//
//   1. le conflit se calcule À LA MAIN : 35 h planifiées, 2 j de congé
//      (14 h) ⇒ capacité 21 h ⇒ 14 h à replacer — et la fonction rend
//      exactement ces chiffres ;
//   2. une proposition ne dépasse JAMAIS la capacité restante de la
//      semaine cible : proposer 14 h à une semaine qui n'en a que 5 de
//      libres ne replacerait rien, ça déplacerait le trou ;
//   3. le module n'écrit RIEN : l'état est photographié avant/après ;
//   4. une personne désactivée (B.14) ne se voit rien proposer ;
//   5. l'écran passe par ces fonctions et le dit : badge « à replacer »,
//      et le report reste un geste humain.

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

const G = charger('src/conges.ts')

// --- un état minimal, construit à la main ----------------------------------
//
// 7 h/jour ⇒ capacité 35 h/semaine. Les phases tiennent du lundi au jeudi
// (fin − début = 3 jours) : le modèle de `chargePlanifieeSemaine` compte
// alors UNE semaine (nbSemaines = round(3/7)+1 = 1) — toutes les heures
// prévues tombent sur cette semaine-là, ce qui rend l'arithmétique du test
// vérifiable de tête.

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

// --- 1. le conflit du plan, chiffré à la main ------------------------------
//
// Semaine du lundi 01/06/2026 : une phase de 35 h (01/06 → 04/06, Julien
// seul). Congé jeudi 04 + vendredi 05 = 2 j × 7 h = 14 h d'absence.
// Capacité réelle : 35 − 14 = 21 h. Excédent : 35 − 21 = 14 h à replacer.

{
  const s = etat({
    projets: [projet('P01', 'Julien', [phase('2026-06-01', '2026-06-04', 35)])],
    absences: [{ id: 'a1', personne: 'Julien', debut: '2026-06-04', fin: '2026-06-05' }],
  })
  const conflits = G.conflitsConges(s, 'Julien')
  assert.equal(conflits.length, 1, 'le congé sur la semaine chargée produit UN conflit')
  const c = conflits[0]
  assert.equal(c.lundi, '2026-06-01')
  assert.ok(pres(c.planifie, 35), `35 h planifiées (obtenu : ${c.planifie})`)
  assert.ok(pres(c.absence, 14), `2 j de congé = 14 h (obtenu : ${c.absence})`)
  assert.ok(pres(c.capacite, 21), `capacité congés déduits = 21 h (obtenu : ${c.capacite})`)
  assert.ok(pres(c.excedent, 14), `excédent = 14 h à replacer (obtenu : ${c.excedent})`)

  assert.deepEqual(G.conflitsConges(s, 'Zoé'), [], 'Zoé n’a ni congé ni charge : aucun conflit')
}

// --- une surcharge SANS congé n'est pas un conflit de congé ----------------
//
// La surcharge ordinaire est déjà rouge dans le plan de charge ; ce module
// répond à une autre question — « ce congé crée-t-il un trou ? ». Semaine
// du 08/06 : 70 h planifiées, aucun congé ⇒ rien ici.

{
  const s = etat({
    projets: [
      projet('P01', 'Julien', [phase('2026-06-01', '2026-06-04', 35)]),
      projet('P02', 'Julien', [phase('2026-06-08', '2026-06-11', 70)]),
    ],
    absences: [{ id: 'a1', personne: 'Julien', debut: '2026-06-04', fin: '2026-06-05' }],
  })
  const conflits = G.conflitsConges(s, 'Julien')
  assert.equal(conflits.length, 1, 'la semaine surchargée SANS congé ne lève pas de conflit de congé')
  assert.equal(conflits[0].lundi, '2026-06-01')
}

// --- un congé sur une semaine vide ne sonne pas ----------------------------

{
  const s = etat({
    absences: [{ id: 'a1', personne: 'Julien', debut: '2026-06-04', fin: '2026-06-05' }],
  })
  assert.deepEqual(G.conflitsConges(s, 'Julien'), [], 'congé sans heures planifiées : rien à replacer, rien à dire')
}

// --- semaine entière en congé : TOUT est à replacer ------------------------

{
  const s = etat({
    projets: [projet('P01', 'Julien', [phase('2026-06-01', '2026-06-04', 35)])],
    absences: [{ id: 'a1', personne: 'Julien', debut: '2026-06-01', fin: '2026-06-05' }],
  })
  const [c] = G.conflitsConges(s, 'Julien')
  assert.ok(c, 'capacité 0 + 35 h planifiées = conflit')
  assert.ok(pres(c.capacite, 0))
  assert.ok(pres(c.excedent, 35), 'l’excédent est la totalité des heures planifiées')
}

// --- 2. les propositions : plafonnées, jamais appliquées -------------------
//
// Autour du conflit du §1 (14 h à replacer) :
//   · semaine d'après (08/06) : 30 h déjà planifiées ⇒ 5 h restantes —
//     la proposition est 5 h, PAS 14 ;
//   · semaines d'avant (25/05, 18/05) : vides ⇒ 35 h restantes, proposition
//     plafonnée à l'excédent (14 h) — proposer plus n'aurait pas de sens ;
//   · Zoé, même semaine : 35 h libres ⇒ 14 h.

{
  const s = etat({
    projets: [
      projet('P01', 'Julien', [phase('2026-06-01', '2026-06-04', 35)]),
      projet('P02', 'Julien', [phase('2026-06-08', '2026-06-11', 30)]),
    ],
    absences: [{ id: 'a1', personne: 'Julien', debut: '2026-06-04', fin: '2026-06-05' }],
  })
  const [c] = G.conflitsConges(s, 'Julien')
  const pistes = G.propositionsReport(s, c)

  for (const p of pistes) {
    assert.ok(
      p.heures <= p.capaciteRestante + 1e-9,
      `une proposition ne dépasse JAMAIS la capacité restante de la semaine cible ` +
        `(${p.personne}, ${p.lundi} : ${p.heures} h proposées pour ${p.capaciteRestante} h restantes)`,
    )
    assert.ok(p.heures <= c.excedent + 1e-9, 'ni l’excédent à replacer : au-delà, on déplacerait des heures qui tiennent')
    assert.ok(p.heures > 0, 'une piste sans heures n’est pas une piste')
  }

  const apres = pistes.find((p) => p.cible === 'semaine-voisine' && p.lundi === '2026-06-08')
  assert.ok(apres, 'la semaine d’après est une piste')
  assert.ok(pres(apres.capaciteRestante, 5), `30 h déjà planifiées ⇒ 5 h restantes (obtenu : ${apres.capaciteRestante})`)
  assert.ok(pres(apres.heures, 5), 'la proposition est plafonnée aux 5 h restantes, pas les 14 h de l’excédent')

  const avant = pistes.find((p) => p.cible === 'semaine-voisine' && p.lundi === '2026-05-25')
  assert.ok(avant, 'la semaine d’avant est une piste')
  assert.ok(pres(avant.capaciteRestante, 35))
  assert.ok(pres(avant.heures, 14), 'semaine vide : la proposition est l’excédent entier, pas la capacité entière')

  const zoe = pistes.find((p) => p.cible === 'autre-personne')
  assert.ok(zoe, 'l’autre personne avec de la marge est une piste')
  assert.equal(zoe.personne, 'Zoé')
  assert.equal(zoe.lundi, c.lundi, 'l’entraide se propose sur la semaine DU conflit')
  assert.ok(pres(zoe.heures, 14))
}

// --- une semaine voisine saturée n'est pas proposée ------------------------

{
  const s = etat({
    projets: [
      projet('P01', 'Julien', [phase('2026-06-01', '2026-06-04', 35)]),
      projet('P02', 'Julien', [phase('2026-06-08', '2026-06-11', 35)]),
    ],
    absences: [{ id: 'a1', personne: 'Julien', debut: '2026-06-04', fin: '2026-06-05' }],
  })
  const [c] = G.conflitsConges(s, 'Julien')
  const pistes = G.propositionsReport(s, c)
  assert.ok(
    !pistes.some((p) => p.lundi === '2026-06-08' && p.cible === 'semaine-voisine'),
    'une semaine déjà pleine n’accueille rien : elle ne doit pas apparaître',
  )
}

// --- 4. une personne désactivée ne se voit rien proposer (B.14) ------------

{
  const s = etat({
    projets: [projet('P01', 'Julien', [phase('2026-06-01', '2026-06-04', 35)])],
    absences: [{ id: 'a1', personne: 'Julien', debut: '2026-06-04', fin: '2026-06-05' }],
    equipe: [
      { id: 'p1', nom: 'Julien' },
      { id: 'p2', nom: 'Zoé' },
      { id: 'p3', nom: 'Marc', actif: false },
    ],
  })
  const [c] = G.conflitsConges(s, 'Julien')
  const pistes = G.propositionsReport(s, c)
  assert.ok(
    !pistes.some((p) => p.personne === 'Marc'),
    'Marc est désactivé : on ne propose pas de confier des heures à quelqu’un qui n’est plus là (B.14)',
  )
  assert.ok(pistes.some((p) => p.personne === 'Zoé'), 'Zoé (active, `actif` non renseigné) reste proposée')
}

// --- 3. rien d'appliqué : l'état ressort intact ----------------------------
//
// La garantie du §15 n'est pas dans le vocabulaire (« proposition ») mais
// dans le fait : ni conflitsConges ni propositionsReport ne modifient quoi
// que ce soit. L'instantané JSON attrape toute écriture, où qu'elle soit.

{
  const s = etat({
    projets: [
      projet('P01', 'Julien', [phase('2026-06-01', '2026-06-04', 35)]),
      projet('P02', 'Julien', [phase('2026-06-08', '2026-06-11', 30)]),
    ],
    absences: [{ id: 'a1', personne: 'Julien', debut: '2026-06-04', fin: '2026-06-05' }],
  })
  const avant = JSON.stringify(s)
  const [c] = G.conflitsConges(s, 'Julien')
  G.propositionsReport(s, c)
  assert.equal(
    JSON.stringify(s),
    avant,
    'le module ne modifie RIEN : ni phase décalée, ni équipe changée, ni congé retouché — ' +
      'le report est un geste humain (§15)',
  )
}

// --- 5. la pureté du module et le câblage de l'écran -----------------------

{
  const source = lire('src/conges.ts')
  assert.doesNotMatch(
    source,
    /useStore|localStorage|fetch\s*\(|Date\.now|todayISO/,
    'src/conges.ts est de la logique PURE : pas de store, pas de réseau, pas d’horloge — ' +
      'les semaines viennent des congés posés, pas du jour où l’on regarde',
  )

  const planning = lire('src/modules/Planning.tsx')
  assert.match(
    planning,
    /conflitsConges/,
    'le plan de charge doit détecter les conflits par src/conges.ts — un calcul redit dans l’écran divergerait',
  )
  assert.match(
    planning,
    /propositionsReport/,
    'les pistes de report affichées doivent venir de src/conges.ts',
  )
  assert.match(planning, /à replacer/, 'le badge dit « congé : X h à replacer » — le conflit doit se VOIR')
  assert.match(
    planning,
    /[Rr]ien n(?:'|’)est appliqué/,
    'l’écran dit que rien ne s’applique seul : la proposition n’est pas une action',
  )
}

console.log(
  'Congés × charge : le conflit du plan (35 h, 2 j de congé ⇒ 21 h de capacité ⇒ 14 h à replacer) est ' +
    'détecté à la main, les propositions sont plafonnées à la capacité restante de la cible ET à l’excédent, ' +
    'une personne désactivée n’est jamais proposée, l’état ressort intact, et l’écran passe par le module.',
)
