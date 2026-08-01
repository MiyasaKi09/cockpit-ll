// B.1 — la collection `taches` (§8.4, §8.5, §8.6, critères 4 et 5).
//
// B.1 est la racine de la vague B : neuf livrables en descendent. Un
// référentiel qui bouge après coup se paie neuf fois, et un palier de
// migration qui se trompe ne se rattrape pas — il a déjà écrit.
//
// Ce test tient cinq choses :
//
//   1. les dix-huit champs du §8.5 existent, TOUS, sur toute tâche créée —
//      un champ manquant ne casse que l'écran qui le lit, donc tard ;
//   2. les neuf statuts du §8.6 et les quatre priorités sont ceux du
//      cahier des charges, et la projection sur la gravité est croissante ;
//   3. la reprise des notes « à faire » ne DOUBLE pas, ne SUPPRIME pas la
//      note, et ne se déclenche qu'au franchissement du palier ;
//   4. une tâche née d'une machine arrive « à qualifier » — la différence
//      entre proposer et décider (§15) ;
//   5. `tempsEnregistre` n'est écrit nulle part ici : c'est une projection
//      (B.9), et la calculer deux fois la ferait diverger de la marge.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

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

const T = charger('src/taches.ts')

// --- 1. les dix-huit champs du §8.5, lus DANS le cahier des charges --------

{
  // La liste vient du CDC, pas d'une copie dans ce fichier : c'est lui qui
  // fait foi, et une divergence doit se voir ici plutôt qu'à la recette.
  const cdc = lire('docs/CDC_MAILS_TACHES_TEMPS.md')
  const bloc = /## 8\.5 Structure d'une tâche[\s\S]*?```text\n([\s\S]*?)```/.exec(
    cdc.replace(/’/g, "'"),
  )
  assert.ok(bloc, 'le §8.5 du CDC doit décrire la structure d’une tâche')
  const champsCdc = bloc[1].split('\n').map((l) => l.trim()).filter(Boolean)
  assert.equal(champsCdc.length, 18, `le §8.5 énumère 18 champs, ${champsCdc.length} lus`)

  // Correspondance CDC → modèle. Elle est explicite parce qu'elle est le
  // seul endroit où les deux vocabulaires se rencontrent.
  const correspondance = {
    Titre: 'titre',
    Description: 'description',
    Projet: 'projetId',
    Phase: 'phase',
    Responsable: 'responsable',
    'Créateur': 'createur',
    Participants: 'participants',
    'Priorité': 'priorite',
    Statut: 'statut',
    'Date de début': 'debut',
    'Échéance': 'echeance',
    'Temps estimé': 'tempsEstime',
    'Temps enregistré': 'tempsEnregistre',
    Source: 'source',
    'Documents liés': 'documentIds',
    Commentaires: 'commentaires',
    'Sous-tâches': 'sousTaches',
    'Dépendances': 'dependances',
  }

  const tache = T.creerTache({ titre: 'Mettre à jour le plan de façade', source: { type: 'manuelle', id: null } })
  for (const champCdc of champsCdc) {
    const champ = correspondance[champCdc]
    assert.ok(champ, `« ${champCdc} » du §8.5 n’a pas de correspondance déclarée dans ce test`)
    assert.ok(
      Object.prototype.hasOwnProperty.call(tache, champ),
      `« ${champCdc} » (${champ}) manque sur une tâche créée : l’écran qui le lit cassera, et lui seul`,
    )
  }

  // Les collections naissent VIDES, jamais `undefined` : le premier
  // `t.participants.length` d'un écran planterait sur cette tâche-là
  // seulement, donc longtemps après sa création.
  for (const liste of ['participants', 'documentIds', 'commentaires', 'sousTaches', 'dependances'])
    assert.deepEqual(tache[liste], [], `${liste} doit naître liste vide, pas undefined`)

  assert.equal(tache.tempsEnregistre, 0, 'le temps enregistré naît à 0 — il se projette, il ne se saisit pas')
  assert.ok(tache.id && tache.creeLe && tache.majLe, 'identité et horodatage sont posés')
  assert.notEqual(T.idTache(), T.idTache(), 'deux identifiants d’affilée diffèrent (application d’un modèle, B.13)')
}

// --- 2. les référentiels du §8.6 -------------------------------------------

{
  const cdc = lire('docs/CDC_MAILS_TACHES_TEMPS.md')
  const bloc = /## 8\.6 Statuts\n([\s\S]*?)\n---/.exec(cdc)
  assert.ok(bloc, 'le §8.6 doit énumérer les statuts')
  const libellesCdc = bloc[1].split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean)

  assert.equal(T.STATUTS_TACHE.length, 9, 'neuf statuts sont STOCKÉS, même si cinq seront exposés (B.8)')
  assert.deepEqual(
    T.STATUTS_TACHE.map((s) => T.LIBELLES_STATUT_TACHE[s]),
    libellesCdc,
    'les statuts et leur ORDRE sont ceux du §8.6 : les écrans trient dessus',
  )

  // « Terminée » et « annulée » ne pèsent plus sur personne. Défini une
  // fois, sinon chaque écran choisit ses propres exclusions et une tâche
  // annulée réapparaît dans un seul d'entre eux.
  assert.equal(T.STATUTS_TACHE_OUVERTS.size, 7)
  for (const clos of ['terminee', 'annulee'])
    assert.ok(!T.STATUTS_TACHE_OUVERTS.has(clos), `« ${clos} » ne doit pas compter comme ouverte`)
  assert.equal(T.estOuverte({ statut: 'en_cours' }), true)
  assert.equal(T.estOuverte({ statut: 'terminee' }), false)

  // Un statut inventé — import JSON, synchronisation, futur producteur —
  // ferait disparaître la tâche de TOUS les filtres à la fois, sans erreur.
  assert.equal(T.estStatutTache('en_cours'), true)
  assert.equal(T.estStatutTache('EN_COURS'), false, 'la casse compte : le référentiel est en minuscules')
  assert.equal(T.estStatutTache('fini'), false)
  assert.equal(T.estOuverte({ statut: 'fini' }), false, 'un statut inconnu n’est pas « ouvert » par défaut')

  // La projection sur la gravité doit être CROISSANTE : sans cela un
  // « critique » se classerait avec les informations dans le fil d'urgences.
  const gravites = T.PRIORITES_TACHE.map((p) => T.graviteDePriorite(p))
  for (let i = 1; i < gravites.length; i++)
    assert.ok(gravites[i] >= gravites[i - 1], 'la projection priorité → gravité doit être croissante')
  assert.equal(T.graviteDePriorite('critique'), 3)
  assert.equal(
    T.graviteDePriorite('normale'),
    1,
    'une priorité normale ne doit PAS entrer dans le fil d’urgences : il cesserait d’être lu',
  )
  for (const p of T.PRIORITES_TACHE) assert.ok(T.LIBELLES_PRIORITE_TACHE[p], `libellé manquant pour ${p}`)
}

// --- les sept origines du §8.4, plus celle de la reprise -------------------

{
  const cdc = lire('docs/CDC_MAILS_TACHES_TEMPS.md')
  const bloc = /## 8\.4 Création des tâches\n([\s\S]*?)\n---/.exec(cdc)
  const lignes = bloc[1].split('\n').filter((l) => l.trim().startsWith('-'))
  assert.equal(lignes.length, 7, 'le §8.4 énumère sept façons de créer une tâche')

  // Huit, et pas sept : la reprise du palier v21 en ajoute une. Dire
  // « manuelle » d'une tâche reprise ferait mentir sa source, et une source
  // inventée est pire qu'une source absente — elle a l'air vraie (§4.2).
  assert.equal(T.TYPES_SOURCE_TACHE.length, 8)
  assert.ok(T.TYPES_SOURCE_TACHE.includes('note_journal'))
  for (const t of T.TYPES_SOURCE_TACHE) assert.ok(T.LIBELLES_SOURCE_TACHE[t], `libellé manquant pour ${t}`)
}

// --- 4. proposer n'est pas décider (§15) -----------------------------------

{
  const proposee = T.creerTache({ titre: 'Relancer le BET', source: { type: 'proposition', id: 'p1' } })
  assert.equal(
    proposee.statut,
    'a_qualifier',
    'une tâche née d’une machine arrive « à qualifier », jamais « à faire » : ' +
      'la mettre dans la file de quelqu’un serait décider à sa place (§15)',
  )
  const manuelle = T.creerTache({ titre: 'Appeler la MOA', source: { type: 'manuelle', id: null } })
  assert.equal(manuelle.statut, 'a_faire', 'une tâche saisie à la main est directement à faire')
}

// --- 3. la reprise des notes « à faire » -----------------------------------

const note = (over) => ({
  id: over.id,
  date: over.date ?? '2026-06-15',
  auteur: over.auteur,
  texte: over.texte ?? 'Relancer le bureau de contrôle',
  tags: over.tags ?? ['a-faire'],
  fait: over.fait,
})

const projets = () => [
  {
    id: 'P01',
    journal: [
      note({ id: 'n1', auteur: 'Julien' }),
      note({ id: 'n2', auteur: 'Zoé', fait: true }),
      note({ id: 'n3', tags: ['mail'], texte: 'Mail de la MOA' }),
      note({ id: 'n4', auteur: 'Julien', texte: '   ' }),
    ],
  },
  { id: 'P02', journal: [note({ id: 'n5', auteur: 'Zoé', date: '2026-07-01' })] },
]

{
  const reprises = T.tachesDepuisNotes(projets(), [])
  assert.deepEqual(
    reprises.map((t) => t.source.id).sort(),
    ['n1', 'n5'],
    'seules les notes « à faire » NON réglées et non vides sont reprises : ' +
      'une note cochée appartient à l’historique du projet, pas à la file de quelqu’un',
  )

  const t1 = reprises.find((t) => t.source.id === 'n1')
  assert.equal(t1.source.type, 'note_journal', 'la source dit d’où vient la tâche (§4.2)')
  assert.equal(t1.projetId, 'P01', 'la tâche reste rattachée au projet dont la note vient')
  assert.equal(t1.responsable, 'Julien', 'l’auteur de la note la portait déjà : il en devient responsable')
  assert.equal(
    t1.creeLe,
    '2026-06-15',
    'la date de la NOTE, pas celle de la migration : une tâche reprise qui naîtrait aujourd’hui ' +
      'perdrait son ancienneté, et c’est elle qui la rendait urgente',
  )

  // LE point : rejouer ne double pas. `migrate()` tourne à chaque
  // chargement et sur tout état distant reçu.
  const rejeu = T.tachesDepuisNotes(projets(), reprises)
  assert.deepEqual(rejeu, [], 'une note déjà reprise ne l’est pas deux fois')

  const deuxFois = T.tachesDepuisNotes(projets(), [...reprises, ...rejeu])
  assert.deepEqual(deuxFois, [], 'et pas davantage au troisième passage')

  // La note n'est pas touchée : elle reste la mémoire du projet, avec son
  // horodatage, son auteur et son contexte.
  const avant = JSON.stringify(projets())
  const apres = projets()
  T.tachesDepuisNotes(apres, [])
  assert.equal(JSON.stringify(apres), avant, 'la reprise ne modifie AUCUNE note : elle lit, elle n’écrit pas')
}

// --- un titre long est coupé, et la coupe se voit --------------------------

{
  const long = 'Reprendre le calepinage de la façade sud '.repeat(6)
  const [t] = T.tachesDepuisNotes([{ id: 'P01', journal: [note({ id: 'nL', texte: long })] }], [])
  assert.ok(t.titre.length <= 120, 'un titre de tâche se lit d’un coup d’œil dans une liste')
  assert.ok(t.titre.endsWith('…'), 'et la coupe se voit')
  assert.equal(t.description, long.trim(), 'le texte entier survit dans la description — rien n’est perdu')
}

// --- B.2 : les onze filtres du §8.3, lus dans le CDC -----------------------

{
  const cdc = lire('docs/CDC_MAILS_TACHES_TEMPS.md')
  const bloc = /## 8\.3 Vue « Mes tâches »\n([\s\S]*?)\n---/.exec(cdc)
  assert.ok(bloc, 'le §8.3 doit énumérer les filtres')
  const filtresCdc = bloc[1].split('\n').filter((l) => l.trim().startsWith('-'))
  assert.equal(
    filtresCdc.length,
    11,
    'le §8.3 en énumère ONZE. La version 1 du plan en déclarait dix et tenait quand même ' +
      'le critère 6 pour satisfait — « Proposées par l’IA » manquait',
  )

  const AUJ = '2026-08-05' // un mercredi
  const t = (over) => ({
    id: over.id,
    statut: over.statut ?? 'a_faire',
    priorite: over.priorite ?? 'normale',
    echeance: over.echeance ?? null,
    projetId: over.projetId ?? null,
    responsable: over.responsable ?? 'Julien',
    createur: over.createur ?? 'Julien',
    source: { type: over.sourceType ?? 'manuelle', id: null },
    creeLe: over.creeLe ?? '2026-07-01',
  })

  const jeu = [
    t({ id: 'retard', echeance: '2026-08-03' }),
    t({ id: 'auj', echeance: AUJ }),
    t({ id: 'semaine', echeance: '2026-08-07' }),
    t({ id: 'venir', echeance: '2026-09-15' }),
    t({ id: 'sans', echeance: null }),
    t({ id: 'zoe', echeance: AUJ, responsable: 'Zoé', createur: 'Zoé' }),
    t({ id: 'assignee', echeance: AUJ, responsable: 'Julien', createur: 'Zoé' }),
    t({ id: 'ia', echeance: AUJ, statut: 'a_qualifier', sourceType: 'proposition' }),
    t({ id: 'close', echeance: AUJ, statut: 'terminee' }),
    t({ id: 'p01', echeance: AUJ, projetId: 'P01', priorite: 'critique' }),
  ]
  const ids = (f) => T.filtrerTaches(jeu, f, AUJ).map((x) => x.id).sort()

  // --- les cinq filtres temporels ---
  assert.deepEqual(ids({ temporel: 'en_retard' }), ['retard'])
  assert.deepEqual(ids({ temporel: 'aujourdhui' }).includes('retard'), false,
    'une échéance dépassée n’est pas « aujourd’hui »')
  assert.ok(ids({ temporel: 'aujourdhui' }).includes('auj'))
  assert.deepEqual(ids({ temporel: 'sans_date' }), ['sans'])
  assert.ok(!ids({ temporel: 'a_venir' }).includes('sans'),
    'une tâche sans échéance n’est pas « à venir » : elle a son propre filtre, sinon personne ne lui en donne jamais')
  assert.ok(!ids({ temporel: 'a_venir' }).includes('auj'),
    '« à venir » commence DEMAIN : le jour même a son filtre')

  // « cette semaine » englobe le retard de la semaine en cours : elle
  // répond « ce sur quoi porte ma semaine », pas « ce qui reste ».
  const semaine = ids({ temporel: 'cette_semaine' })
  assert.ok(semaine.includes('retard') && semaine.includes('auj') && semaine.includes('semaine'))
  assert.ok(!semaine.includes('venir'), 'septembre n’est pas cette semaine')

  // --- les trois filtres paramétrés ---
  assert.deepEqual(ids({ projetId: 'P01' }), ['p01'])
  assert.deepEqual(ids({ priorite: 'critique' }), ['p01'])
  assert.deepEqual(ids({ statut: 'a_qualifier' }), ['ia'])

  // --- personne, créateur, assignation ---
  assert.ok(!ids({ personne: 'Julien' }).includes('zoe'), 'la vue filtre par personne PAR DÉFAUT')
  assert.ok(ids({ personne: null }).includes('zoe'),
    'sans personne reconnue, on montre tout plutôt que de choisir quelqu’un au hasard')
  assert.deepEqual(
    ids({ personne: 'Julien', assigneesParUnTiers: true }),
    ['assignee'],
    '« assignée par un tiers » : je la porte, quelqu’un d’AUTRE l’a créée — ' +
      'une tâche que je me suis donnée n’a été assignée par personne',
  )
  // « Créées par moi » regarde le CRÉATEUR, pas le responsable — donc elle
  // montre ce que j'ai confié à quelqu'un d'autre. C'est précisément à quoi
  // sert le filtre : savoir ce qui avance de ce que j'ai lancé. Le confondre
  // avec « mes tâches » le rendrait redondant avec le filtre par défaut.
  const parZoe = ids({ personne: 'Zoé', creeesParMoi: true })
  assert.ok(
    parZoe.includes('assignee'),
    '« créées par moi » montre ce que j’ai confié à quelqu’un d’autre : sinon le filtre ' +
      'ne dirait rien de plus que le filtre par personne',
  )
  assert.ok(parZoe.includes('zoe'), 'et ce que j’ai gardé pour moi')
  assert.ok(!parZoe.includes('auj'), 'mais pas ce qu’un autre a créé')

  // --- le onzième, celui que la v1 du plan oubliait ---
  assert.deepEqual(
    ids({ proposeesParIA: true }),
    ['ia'],
    '« Proposées par l’IA » lit la SOURCE. Un booléen à part finirait par dire autre chose qu’elle',
  )

  // --- ce qui est clos sort des files par défaut ---
  assert.ok(!ids({}).includes('close'), 'une file qui montre l’histoire complète cesse d’être une file')
  assert.ok(ids({ inclureClos: true }).includes('close'), 'mais elle reste consultable sur demande')

  // --- les filtres se COMBINENT ---
  assert.deepEqual(
    ids({ personne: 'Julien', projetId: 'P01', temporel: 'aujourdhui' }),
    ['p01'],
    '« mes tâches d’aujourd’hui sur P01 » est une question légitime : les filtres se composent',
  )

  // --- l'ordre : ce qui presse d'abord ---
  const tries = [...jeu].sort(T.trierTaches).map((x) => x.id)
  assert.equal(tries[0], 'retard', 'le retard passe devant')
  assert.equal(tries[tries.length - 1], 'sans',
    'les tâches sans échéance ferment la marche : sans rendez-vous, elles n’en réclament pas')
  assert.ok(
    tries.indexOf('p01') < tries.indexOf('auj'),
    'à échéance égale, la priorité la plus forte passe devant',
  )
}

// --- l'écran de B.2 : onze filtres, et aucune logique -----------------------

{
  const ecran = lire('src/modules/Taches.tsx')

  // Les onze filtres doivent être ATTEIGNABLES depuis l'écran. Livrer les
  // sélecteurs sans les câbler laisserait le critère 6 déclaré et non tenu,
  // ce qui est précisément ce que la version 1 du plan avait fait.
  for (const [libelle, indice] of [
    ["Aujourd'hui", 'aujourdhui'],
    ['En retard', 'en_retard'],
    ['Cette semaine', 'cette_semaine'],
    ['À venir', 'a_venir'],
    ['Sans date', 'sans_date'],
    ['Par projet', 'Filtrer par projet'],
    ['Par priorité', 'Filtrer par priorité'],
    ['Par statut', 'Filtrer par statut'],
    ['Créées par moi', 'Créées par moi'],
    ['Assignées par un tiers', 'Assignées par un tiers'],
    ["Proposées par l'IA", 'proposeesParIA'],
  ]) {
    assert.ok(ecran.includes(indice), `le filtre « ${libelle} » du §8.3 doit être atteignable depuis l’écran`)
  }

  // Aucune logique dans le module : les filtres, l'ordre et « ouverte »
  // vivent dans `src/taches.ts`. L'accueil s'était déjà mis à recalculer
  // les factures à émettre pour son compte, et deux gravités identiques
  // par coïncidence entretenue à la main en avaient résulté.
  assert.match(ecran, /filtrerTaches\(/, 'l’écran CONSOMME le sélecteur, il ne le réimplémente pas')
  assert.match(ecran, /\.sort\(trierTaches\)/, 'et l’ordre vient du même module')
  assert.doesNotMatch(
    ecran,
    /STATUTS_TACHE_OUVERTS|echeance\s*<\s*aujourdhui|new Set\(\[/,
    'l’écran ne redéfinit ni « ouverte » ni « en retard » : une seconde définition divergerait',
  )

  // La tâche saisie passe par la fabrique — sinon elle naîtrait sans
  // `participants` et le premier écran qui le lit casserait.
  assert.match(ecran, /creerTache\(\{/, 'toute création passe par la fabrique des 18 champs')
}

// --- B.8 : la fiche, et les règles qu'elle ne doit pas inventer ------------

{
  const tache = (over = {}) => ({
    id: over.id ?? 't1',
    titre: 'Relancer le BET',
    statut: over.statut ?? 'a_faire',
    priorite: 'normale',
    tempsEstime: over.tempsEstime ?? null,
    tempsEnregistre: over.tempsEnregistre ?? 0,
    sousTaches: over.sousTaches ?? [],
    dependances: over.dependances ?? [],
    commentaires: [],
    source: { type: 'manuelle', id: null },
    creeLe: '2026-07-01',
  })

  // Cinq statuts au menu sur les neuf stockés — et tous doivent exister.
  assert.equal(T.STATUTS_TACHE_AU_MENU.length, 5)
  for (const s of T.STATUTS_TACHE_AU_MENU)
    assert.ok(T.STATUTS_TACHE.includes(s), `« ${s} » au menu doit être un statut du référentiel`)
  assert.ok(
    !T.STATUTS_TACHE_AU_MENU.includes('a_qualifier'),
    '« à qualifier » ne se pose pas à la main : c’est l’état d’une proposition non revue (B.10)',
  )

  // L'écart de temps : `null` sans estimation. Afficher « +3 h » sur une
  // tâche jamais estimée ferait passer une absence de repère pour un
  // dépassement — et le §7.3 tient les faux dépassements pour ce qui fait
  // cesser de regarder la marge.
  assert.equal(T.ecartDeTemps(tache({ tempsEnregistre: 3 })), null, 'sans estimation, pas d’écart')
  assert.equal(T.ecartDeTemps(tache({ tempsEstime: 0, tempsEnregistre: 3 })), null, 'une estimation à zéro n’en est pas une')
  assert.equal(T.ecartDeTemps(tache({ tempsEstime: 2, tempsEnregistre: 3.5 })), 1.5)
  assert.equal(T.ecartDeTemps(tache({ tempsEstime: 4, tempsEnregistre: 1 })), -3, 'l’écart est SIGNÉ')

  // Sous-tâches
  assert.equal(T.avancementSousTaches(tache()), null, 'aucune sous-tâche : pas de « 0 / 0 »')
  assert.deepEqual(
    T.avancementSousTaches(tache({ sousTaches: [{ faite: true }, { faite: false }, { faite: true }] })),
    { faites: 2, total: 3 },
  )

  // Dépendances : une cible supprimée ne disparaît PAS en silence.
  const autres = [tache({ id: 'a', statut: 'terminee' }), tache({ id: 'b', statut: 'en_cours' })]
  const t3 = tache({ id: 't3', dependances: ['a', 'b', 'fantome'] })
  const { resolues, introuvables } = T.dependancesDe(t3, autres)
  assert.deepEqual(resolues.map((x) => x.id), ['a', 'b'])
  assert.deepEqual(
    introuvables,
    ['fantome'],
    'une dépendance vers une tâche supprimée doit RESSORTIR : celle qu’on ne voit plus est celle qu’on croit levée',
  )

  assert.equal(T.dependancesLevees(tache({ dependances: ['a'] }), autres), true, 'une dépendance terminée est levée')
  assert.equal(T.dependancesLevees(tache({ dependances: ['b'] }), autres), false, 'une dépendance en cours ne l’est pas')
  assert.equal(
    T.dependancesLevees(tache({ dependances: ['fantome'] }), autres),
    false,
    'on ne présume pas qu’un objet disparu était terminé',
  )
  assert.equal(T.dependancesLevees(tache(), autres), true, 'aucune dépendance : rien ne bloque')

  // Commentaires : horodatés ET attribués (§19.3 pt 5).
  const c = T.creerCommentaire('  Le BET a répondu.  ', 'Julien')
  assert.equal(c.texte, 'Le BET a répondu.')
  assert.equal(c.auteur, 'Julien')
  assert.ok(c.date && c.id, 'un commentaire sans date ni identité ne dit pas qui a tranché')
  assert.equal(T.creerCommentaire('x', null).auteur, null, 'sans personne reconnue, on n’invente pas un auteur')

  // L'écran ne réimplémente rien.
  const fiche = lire('src/modules/FicheTache.tsx')
  for (const fn of ['ecartDeTemps', 'avancementSousTaches', 'dependancesDe', 'STATUTS_TACHE_AU_MENU'])
    assert.ok(fiche.includes(fn), `la fiche doit consommer ${fn} plutôt que de le refaire`)
  assert.doesNotMatch(
    fiche,
    /tempsEnregistre\s*=|tempsEnregistre\s*\+=/,
    'la fiche n’écrit PAS le temps enregistré : c’est une projection des pointages (B.9)',
  )

  // Le chrono est B.6 : la fiche doit le DIRE, pas offrir un bouton mort.
  assert.match(
    fiche,
    /livrable B\.6/,
    'la fiche doit dire que le chrono n’existe pas encore — un bouton mort se clique deux fois, ' +
      'puis on cesse de faire confiance à l’écran',
  )
}

// --- 5. le temps enregistré ne s'écrit pas ici -----------------------------

const source = lire('src/taches.ts')
assert.doesNotMatch(
  source.replace(/tempsEnregistre: 0/g, ''),
  /tempsEnregistre\s*[:=]/,
  '`tempsEnregistre` est une PROJECTION des pointages (B.9). L’écrire ici en ferait une seconde ' +
    'source de vérité, qui divergerait de la marge — le défaut le plus coûteux du dépôt (§7.3)',
)
assert.doesNotMatch(
  source,
  /useStore|localStorage|fetch\(/,
  'le référentiel des tâches ne lit ni n’écrit l’état : ce sont les écrans qui le font',
)

// --- le palier de migration, et sa condition ------------------------------

const store = lire('src/store.tsx')
assert.match(
  store,
  /versionAncienne < 21/,
  'la reprise doit être conditionnée au FRANCHISSEMENT du palier : `migrate()` tourne à chaque ' +
    'chargement et sur tout état distant reçu — inconditionnelle, elle recréerait les tâches chaque jour',
)
assert.match(store, /etat\.taches = Array\.isArray\(parsed\.taches\)/, 'la collection est normalisée comme les autres')
assert.equal(
  Number(/export const STATE_VERSION = (\d+)/.exec(lire('src/seed.ts'))[1]),
  21,
  'le palier v21 doit être déclaré, sinon la reprise ne se déclenche jamais',
)
assert.match(lire('src/seed.ts'), /taches: \[\]/, 'le jeu d’amorce ne contient AUCUNE tâche d’exemple')

console.log(
  'Tâches (B.1/B.2/B.8) : 18 champs du §8.5, 9 statuts et 4 priorités du CDC, reprise des notes ' +
    'idempotente et non destructive, 11 filtres du §8.3 câblés, fiche sans règle inventée, ' +
    'et le temps enregistré reste une projection.',
)
