// Livrable 0.12 — « bloc L'équipe dans l'assistant Nouveau projet »
// (CDC §19.1 points 2 et 4 ; §12.1 point 12 NON livré, voir plus bas).
//
// Le défaut couvert ne lève aucune erreur et ne s'affiche nulle part.
// L'assistant créait un projet complet — phases datées, échéancier,
// arborescence Drive — mais sans personne dessus : `responsable`,
// `coResponsable` et `equipeProjet` ne se réglaient que dans la fiche,
// après coup. Or `equipeDuProjet()` est la seule définition de « qui
// travaille sur ce projet » : vide, elle rend `chargePlanifieeSemaine`
// nulle pour tout le monde et retire le projet des tableaux de temps.
// Le projet existe, il est juste absent des écrans où on le cherche —
// et on ne s'en aperçoit qu'en réunion de charge, des semaines plus tard.
//
// Ce que ce test verrouille :
//   1. la recette : un projet né de l'assistant (statut actif, phases
//      datées, responsable désigné) produit une charge planifiée NON
//      NULLE — et le même projet sans équipe en produit 0 ;
//   2. l'assistant écrit bien ces champs et refuse de créer un projet
//      sans responsable, l'identité venant de `useMoi()` et jamais de
//      `settings.personnes[0]` ;
//   3. `equipeDuProjet` est la seule définition de l'appartenance à un
//      projet : aucun module ne la recopie ;
//   4. un renommage dans les Paramètres suit l'équipe posée par
//      l'assistant — sinon la charge du projet disparaît en silence ;
//   5. `codeExternePropose` propose une suite lisible par année sans
//      jamais réinterpréter une numérotation d'un autre format, et son
//      résultat donne une adresse projet acceptable SANS que rien ne
//      dépende de l'existence du domaine (il n'est pas acheté).
//
// Ce test ne prétend PAS couvrir le point 12 du §12.1 (« créer les droits
// d'accès ») : le plan y renonce explicitement, ce bloc désigne une
// équipe et ne crée aucun droit.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racineDepot = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racineDepot, fichier), 'utf8')

/** charge un module TypeScript pur (sans React ni DOM) pour l'exercer */
function charger(fichier, dependances = {}) {
  const compile = ts.transpileModule(lire(fichier), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (dependances[id]) return dependances[id]
    throw new Error(`Import runtime inattendu dans ${fichier} : ${id}`)
  })
  return mod.exports
}

const util = charger('src/util.ts')
const miqcp = charger('src/miqcp.ts')
const facture = charger('src/facture.ts', { './util': util })
const derive = charger('src/derive.ts', { './miqcp': miqcp, './facture': facture, './util': util })
const echeancier = charger('src/echeancier.ts', { './util': util })
const inventaire = charger('src/personnes.ts')

const { chargePlanifieeSemaine, equipeDuProjet } = derive
const { codeExternePropose, adresseProjetProposee, adresseProjetValide, mondayOf } = util

// --- 1. la recette : un projet né de l'assistant pèse sur le plan de charge --
//
// Reproduit ce que fait `creer()` : phases par défaut sur les honoraires
// calculés, datées par `daterPhases`, statut actif, équipe désignée.

const settings = {
  personnes: ['Julien', 'Zoé'],
  equipe: [
    { id: 'p1', nom: 'Julien', email: 'julien@exemple.test' },
    { id: 'p2', nom: 'Zoé', email: 'zoe@exemple.test' },
  ],
  heuresParJour: 7,
  tauxHoraireVente: 75,
  bt01Actuel: 137.5,
}

/** le projet tel que l'assistant le fabrique, équipe comprise */
function projetDeLAssistant(equipe) {
  const base = {
    id: 'P42',
    nom: 'Réhabilitation 12 logements — Beauvais',
    typeMO: 'Public',
    statut: 'Signé',
    ouvrage: null,
    montantTravauxHT: 1_400_000,
    notesComplexite: {},
    coefManuel: 1,
    tauxRetenu: 10,
    missionsComplHT: 0,
    phases: [],
    liens: [],
    materiauxIds: [],
    artisanIds: [],
    journal: [],
    ...equipe,
  }
  const h = miqcp.calculHonoraires(base, settings)
  assert.ok(h.honorairesBaseHT > 0, 'le scénario de recette doit produire des honoraires — sinon la charge serait nulle pour une autre raison')
  const phases = echeancier.daterPhases(miqcp.phasesParDefaut(h.honorairesBaseHT, settings.tauxHoraireVente), '2026-09-01', 8, 12)
  return { ...base, phases }
}

const semaine = mondayOf('2026-09-15') // en pleine phase d'études

{
  const projet = projetDeLAssistant({ responsable: 'Julien' })
  const etat = { projets: [projet], settings, temps: [], absences: [] }

  assert.deepEqual(
    equipeDuProjet(projet),
    ['Julien'],
    'le responsable désigné par l’assistant doit suffire à peupler l’équipe du projet',
  )
  const charge = chargePlanifieeSemaine(etat, 'Julien', semaine)
  assert.ok(
    charge > 0,
    'RECETTE 0.12 : un projet créé par l’assistant doit produire une charge planifiée non nulle pour son responsable — c’est tout l’objet du livrable',
  )

  // la contre-épreuve : c'est bien l'équipe qui fait la différence, et rien
  // d'autre du projet (statut, phases, dates, heures sont identiques)
  const sansEquipe = { ...projet, responsable: undefined }
  const etatSansEquipe = { projets: [sansEquipe], settings, temps: [], absences: [] }
  assert.deepEqual(equipeDuProjet(sansEquipe), [], 'sans responsable ni équipe, le projet n’appartient à personne')
  assert.equal(
    chargePlanifieeSemaine(etatSansEquipe, 'Julien', semaine),
    0,
    'l’état d’avant 0.12 : un projet neuf sans équipe pèse 0 h, pour tout le monde et sans le dire',
  )

  // et la charge se répartit entre les personnes désignées : c'est pourquoi
  // l'assistant montre l'équipe résultante avant de créer
  const aDeux = { ...projet, coResponsable: 'Zoé' }
  const etatDeux = { projets: [aDeux], settings, temps: [], absences: [] }
  assert.ok(
    Math.abs(chargePlanifieeSemaine(etatDeux, 'Julien', semaine) - charge / 2) < 1e-9,
    'la charge d’une phase se partage entre les personnes affectées — ajouter un co-responsable allège le responsable',
  )
  assert.ok(
    chargePlanifieeSemaine(etatDeux, 'Zoé', semaine) > 0,
    'le co-responsable porte lui aussi une part de la charge',
  )
}

// --- 2. l'assistant écrit ces champs, et exige le responsable ---------------

const assistant = lire('src/modules/ProjetNouveau.tsx')

{
  // sur l'objet projet LUI-MÊME, pas ailleurs dans le fichier : un champ
  // saisi à l'écran mais absent du brouillon serait invisible et perdu
  const m = /const brouillon: Projet = useMemo\(\s*\(\) => \(\{([\s\S]*?)\n    \}\),/.exec(assistant)
  assert.ok(m, 'src/modules/ProjetNouveau.tsx : le brouillon de projet est introuvable')
  const brouillon = m[1]
  for (const champ of ['responsable', 'coResponsable', 'equipeProjet', 'codeExterne']) {
    assert.match(
      brouillon,
      new RegExp(`\\n\\s+${champ}[,:]`),
      `src/modules/ProjetNouveau.tsx : le projet créé doit porter ${champ} — laissé à la fiche « pour plus tard », il n’est en pratique jamais réglé`,
    )
  }
}
assert.match(
  assistant,
  /useMoi\(\)/,
  'src/modules/ProjetNouveau.tsx : le responsable par défaut vient de useMoi() (contrat des modules)',
)
assert.doesNotMatch(
  assistant,
  /personnes\[0\]/,
  'src/modules/ProjetNouveau.tsx : jamais settings.personnes[0] — un écran qui ne sait pas qui est là ne désigne pas le premier de la liste',
)
assert.match(
  assistant,
  /codeExternePropose\(/,
  'src/modules/ProjetNouveau.tsx : le code projet doit être pré-rempli par codeExternePropose (livrable 0.12)',
)
assert.match(
  assistant,
  /responsableManquant\s*=\s*personnes\.length > 0 && responsable\.trim\(\) === ''/,
  'src/modules/ProjetNouveau.tsx : le responsable est obligatoire — sauf si l’agence n’a aucune personne enregistrée, auquel cas l’assistant doit rester terminable',
)
{
  // le bouton « Créer le projet » doit être bloqué par la même condition que
  // l'étape 1 : un « Continuer » verrouillé qu'un « Créer » laisse passer ne
  // protégerait rien
  const bouton = /disabled=\{!projetComplet\}/.test(assistant)
  assert.ok(
    bouton,
    'src/modules/ProjetNouveau.tsx : le bouton « Créer le projet » doit être désactivé tant que le projet est incomplet (nom ET responsable)',
  )
  assert.match(
    assistant,
    /const projetComplet = nom\.trim\(\) !== '' && !responsableManquant/,
    'src/modules/ProjetNouveau.tsx : « complet » veut dire nom ET responsable',
  )
}
assert.doesNotMatch(
  assistant,
  /<table[\s>]/,
  'src/modules/ProjetNouveau.tsx : tout tableau passe par le composant Table (contrat des modules)',
)

// --- 3. une seule définition de « qui travaille sur ce projet » -------------
//
// Trois copies coexistaient : une union recopiée dans Projets.tsx et deux
// prédicats dans Temps.tsx. Elles disaient la même chose ce jour-là ; la
// première qui bouge fait apparaître un projet au planning et disparaître
// de la feuille de temps de la personne, sans erreur.

{
  const fichiers = []
  const parcourir = (dir) => {
    for (const e of fs.readdirSync(path.join(racineDepot, dir), { withFileTypes: true })) {
      if (e.isDirectory()) parcourir(`${dir}/${e.name}`)
      else if (/\.tsx?$/.test(e.name)) fichiers.push(`${dir}/${e.name}`)
    }
  }
  parcourir('src')

  for (const f of fichiers) {
    if (f === 'src/derive.ts') continue
    const source = lire(f)
    assert.doesNotMatch(
      source,
      /\[\s*(?:\.\.\.)?[A-Za-z_$][\w$]*\.responsable/,
      `${f} : l’appartenance à un projet se lit par equipeDuProjet() de derive.ts — une union recopiée ici divergerait du plan de charge sans que rien ne le signale`,
    )
    assert.doesNotMatch(
      source,
      /responsable === [A-Za-z_$][\w$]*\s*\|\|[^\n]*coResponsable ===/,
      `${f} : le prédicat « cette personne travaille-t-elle sur ce projet ? » se lit par equipeDuProjet().includes() — pas recopié`,
    )
  }

  for (const appelant of ['src/modules/ProjetNouveau.tsx', 'src/modules/Temps.tsx', 'src/modules/Projets.tsx']) {
    assert.match(
      lire(appelant),
      /equipeDuProjet\(/,
      `${appelant} doit passer par equipeDuProjet() — l’assistant, le tableau de temps et la fiche décrivent la même équipe`,
    )
  }
}

// --- 4. le renommage suit l'équipe posée par l'assistant --------------------
//
// L'assistant devient le premier producteur de `responsable` et
// `equipeProjet`. Si l'inventaire de src/personnes.ts les oubliait, un
// renommage dans les Paramètres viderait la charge du projet en silence.

{
  const projet = projetDeLAssistant({ responsable: 'Julien', coResponsable: 'Zoé', equipeProjet: ['Zoé'] })
  const etat = { projets: [projet], settings: { ...settings, personnes: ['Julien', 'Zoé'] }, temps: [], absences: [] }
  const avant = chargePlanifieeSemaine(etat, 'Julien', semaine)
  assert.ok(avant > 0, 'préalable : la charge est bien non nulle avant le renommage')

  inventaire.renommerPersonne(etat, 'Julien', 'Julien Martin')
  assert.equal(
    chargePlanifieeSemaine(etat, 'Julien Martin', semaine),
    avant,
    'src/personnes.ts : renommer une personne doit reporter sa charge — sinon le projet créé ce matin sort du plan de charge sans erreur',
  )
  assert.equal(
    chargePlanifieeSemaine(etat, 'Julien', semaine),
    0,
    'l’ancien nom ne doit plus rien porter',
  )
  assert.ok(
    equipeDuProjet(etat.projets[0]).includes('Julien Martin'),
    'l’équipe du projet doit citer le nouveau nom',
  )
}

// --- 5. le code projet proposé : une suite lisible, sans rien présumer ------

assert.equal(codeExternePropose([], '2026'), '2026-001', 'première affaire de l’année')
assert.equal(
  codeExternePropose(['2026-001', '2026-007', '2025-099'], '2026'),
  '2026-008',
  'la suite se lit sur les codes de la MÊME année, jamais sur ceux des précédentes',
)
assert.equal(
  codeExternePropose([undefined, null, '', 'AFF-12', 'chantier Beauvais'], '2026'),
  '2026-001',
  'un code d’un autre format est ignoré, pas réinterprété : mieux vaut un numéro visiblement à corriger qu’une numérotation maison écrasée',
)
assert.equal(codeExternePropose(['2026-099'], '2026'), '2026-100', 'le passage à trois chiffres ne casse pas la suite')
assert.equal(codeExternePropose([], 'plus tard'), '', 'sans année exploitable, la fonction ne propose rien plutôt qu’un code faux')
assert.equal(
  codeExternePropose(['2026-003'], '2026-09-15'),
  '2026-004',
  'une date ISO complète est acceptée : l’appelant passe todayISO(), pas un new Date()',
)

{
  // le format retenu par l'agence doit passer, SANS que rien ne dépende de
  // l'achat du domaine (verrou du §2.1)
  const code = codeExternePropose(['2026-033'], '2026')
  const adresse = adresseProjetProposee(code)
  assert.equal(adresse, '2026-034@agence-ll.fr', 'le code proposé doit donner l’adresse projet du §3.2')
  assert.ok(adresseProjetValide(adresse), 'l’adresse projet issue du code proposé doit être valide')
  assert.ok(
    adresseProjetValide(adresseProjetProposee(code, 'autre-domaine.fr')),
    'aucun domaine n’est présumé : le format doit rester valable si l’agence change d’avis',
  )
}
assert.doesNotMatch(
  lire('src/util.ts').split('export function codeExternePropose')[1].split('\n}')[0],
  /new Date\(/,
  'src/util.ts : codeExternePropose reste pure — la date du jour est passée par l’appelant (contrat des modules)',
)

console.log(
  'test-equipe-projet : OK — un projet neuf naît avec son responsable, pèse sur le plan de charge, et « qui travaille sur ce projet » ne se dit qu’à un seul endroit.',
)
