// C3 — LE RELEVÉ DE SÉANCE : ce que l'agence a demandé, mot pour mot.
//
// Le lot C avait livré un bloc « Préparer la réunion » : une synthèse EN
// LECTURE, qui assemblait les chiffres des registres lot par lot. Verdict de
// l'agence : « je ne vois pas où créer ça, le modifier, etc. Il faudrait que
// ça soit à la limite une version du CR précédent, ajusté. Il faudrait
// pouvoir faire une sorte de to-do améliorée, où on garde tout mais où tout
// se range en fonction de ce qui est fait ou non. »
//
// Quatre exigences se cachent dans ces deux phrases, et ce test les rend
// opposables une par une :
//
//   1. « une version du CR précédent, ajusté » — un point NON RÉSOLU est
//      REPRIS à la séance suivante. Pas recopié : repris. Une recopie, c'est
//      deux objets pour une seule question, donc deux histoires possibles,
//      donc la disparition silencieuse de la seule information que personne
//      n'a aujourd'hui — « ce point traîne depuis trois séances » ;
//   2. « tout se range en fonction de ce qui est fait ou non » — les points à
//      traiter EN TÊTE, et parmi eux LES PLUS ANCIENS D'ABORD. C'est
//      l'inversion qui fait tout : un point repoussé quatre fois est plus
//      urgent qu'un point d'aujourd'hui. Et RIEN N'EST MASQUÉ : un relevé qui
//      cacherait les points faits ne serait plus le document qu'on envoie
//      après la séance ;
//   3. l'ancienneté en séances est JUSTE — c'est ce chiffre qui fait la
//      « to-do améliorée ». Il se COMPTE, jamais ne se stocke : un compteur
//      incrémenté à chaque séance mentirait dès qu'une réunion est
//      reprogrammée, ajoutée après coup ou supprimée ;
//   4. « je ne vois pas où créer ça, le modifier » — l'écran doit offrir les
//      gestes : inscrire, modifier, changer d'état. Un relevé qu'on ne peut
//      pas modifier serait exactement ce que l'agence vient de refuser.
//
// Et la règle du dépôt qui les traverse toutes (§15) : la machine PROPOSE,
// l'humain DÉCIDE. Un point proposé par le cockpit ne s'inscrit pas tout
// seul, et l'écarter ne l'efface pas.
//
// Le test EXÉCUTE la logique pure (src/seanceChantier.ts) et REND le papier
// (src/pdf.ts, `window.open` remplacé par un carnet). L'écran, lui, n'est pas
// exécutable ici (React, `useStore`) : c'est le compilateur qui le lit — un
// arbre syntaxique, jamais une recherche de texte, parce que « pointNouveau »
// apparaît aussi dans les commentaires.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')
const arbre = (f) => ts.createSourceFile(f, lire(f), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)

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

let derniereSortie = null
globalThis.window = {
  open: () => ({
    document: {
      write: (h) => {
        derniereSortie = h
      },
      close: () => {},
    },
  }),
}

const S = charger('src/seanceChantier.ts')
const PDF = charger('src/pdf.ts')

const ECRAN = 'src/modules/ProjetChantier.tsx'

// ============================================================
// LE JEU D'ESSAI — un chantier avec trois séances derrière lui
// ============================================================
//
// Réunions n°18 (24/06), n°19 (01/07), n°20 (08/07). On est le 06/07 : la
// séance qu'on prépare est la n°20. Les points sont ceux d'un chantier
// ordinaire — un qui traîne depuis le début, un né la veille, un en cours,
// un réglé à la dernière séance, un écarté.

const PROJET = {
  id: 'P-EC',
  nom: 'École de Chamant',
  moa: 'Commune de Chamant',
  adresse: '3 rue du Marché, 60300 Chamant',
  phases: [],
}

const etat = () => ({
  settings: { nomAgence: 'Agence LL', personnes: ['Julien', 'Zoé'] },
  projets: [PROJET],
  marches: [
    {
      id: 'M-L01',
      projetId: 'P-EC',
      entreprise: 'SARL Martin BTP',
      lot: 'Lot 01 — Gros œuvre',
      montantInitialHT: 200000,
      avenantsHT: 0,
      tauxRG: 0.05,
      garantie: 'retenue',
      actif: true,
    },
  ],
  reunions: [
    { id: 'r-18', projetId: 'P-EC', titre: 'Réunion de chantier n°18', date: '2026-06-24', heure: '09:00', convoques: [] },
    { id: 'r-19', projetId: 'P-EC', titre: 'Réunion de chantier n°19', date: '2026-07-01', heure: '09:00', convoques: [] },
    { id: 'r-20', projetId: 'P-EC', titre: 'Réunion de chantier n°20', date: '2026-07-08', heure: '09:00', convoques: [] },
  ],
  pointsSeance: [
    {
      id: 'pt-ferraillage',
      projetId: 'P-EC',
      marcheId: null,
      lot: 'Bureau de contrôle',
      libelle: 'Avis sur le ferraillage du préau',
      responsable: 'Bureau de contrôle',
      echeance: null,
      etat: 'a_traiter',
      inscritLe: '2026-06-24',
      reunionOrigineId: 'r-18',
      resoluLe: null,
      majLe: '2026-07-01',
    },
    {
      id: 'pt-veille',
      projetId: 'P-EC',
      marcheId: 'M-L01',
      libelle: 'Calepinage des seuils à valider',
      responsable: 'SARL Martin BTP',
      echeance: '2026-07-20',
      etat: 'a_traiter',
      inscritLe: '2026-07-05',
      reunionOrigineId: null,
      resoluLe: null,
      majLe: '2026-07-05',
    },
    {
      id: 'pt-enduit',
      projetId: 'P-EC',
      marcheId: 'M-L01',
      libelle: 'Reprise d’enduit sur pignon nord',
      responsable: 'SARL Martin BTP',
      echeance: '2026-07-03',
      etat: 'en_cours',
      inscritLe: '2026-06-24',
      reunionOrigineId: 'r-18',
      resoluLe: null,
      majLe: '2026-07-01',
    },
    {
      id: 'pt-levage',
      projetId: 'P-EC',
      marcheId: 'M-L01',
      libelle: 'Plan de levage à diffuser',
      responsable: 'Charpentes Leroy',
      echeance: '2026-06-30',
      etat: 'fait',
      inscritLe: '2026-06-24',
      reunionOrigineId: 'r-18',
      resoluLe: '2026-07-01',
      majLe: '2026-07-01',
    },
    {
      id: 'pt-benne',
      projetId: 'P-EC',
      marcheId: null,
      libelle: 'Emplacement de benne à revoir',
      responsable: null,
      echeance: null,
      etat: 'sans_suite',
      inscritLe: '2026-06-24',
      reunionOrigineId: 'r-18',
      resoluLe: '2026-06-30',
      majLe: '2026-06-30',
    },
  ],
  // les registres que la machine relit pour PROPOSER — vides par défaut :
  // chaque section allume celui dont elle a besoin
  visas: [],
  evenementsMarche: [],
  desordresGPA: [],
  tachesChantier: [],
  intemperies: [],
})

const AUJOURD_HUI = '2026-07-06'
const idsDe = (ordre) => ordre.entrees.map((e) => e.point.id)

// ============================================================
// 1. « UNE VERSION DU CR PRÉCÉDENT, AJUSTÉ » — la reprise
// ============================================================
//
// C'est la demande centrale. Un point non résolu doit se retrouver à la
// séance suivante SANS que personne ne le recopie, et sans que le cockpit
// n'écrive quoi que ce soit : le point appartient à l'OPÉRATION, pas à la
// réunion. La reprise n'est donc pas une fonctionnalité — c'est une
// conséquence du modèle, et elle ne peut pas être oubliée.

{
  const e = etat()
  const avant = JSON.stringify(e)
  const ordre = S.preparerSeance(e, 'P-EC', { maintenant: AUJOURD_HUI })

  assert.equal(
    JSON.stringify(e),
    avant,
    'préparer une séance n’ÉCRIT RIEN : l’ordre du jour se CONSTATE. S’il se construisait, il faudrait le ' +
      'reconstruire à chaque changement, et deux personnes qui ouvrent l’écran le même matin fabriqueraient ' +
      'deux ordres du jour.',
  )

  assert.equal(ordre.seance.id, 'r-20', 'la séance préparée est la plus PROCHE à venir, aujourd’hui compris')
  assert.equal(ordre.seancePrecedente.id, 'r-19', 'et celle d’avant est le relevé qu’on « ajuste »')

  // les points d'avant sont là, sans recopie
  const repris = ordre.entrees.filter((x) => x.reporte).map((x) => x.point.id)
  assert.deepEqual(
    repris.sort(),
    ['pt-enduit', 'pt-ferraillage'],
    'les points NON RÉSOLUS nés à une séance antérieure sont REPRIS. Le point né la veille (pt-veille) n’est ' +
      'pas « reporté » — il n’a encore été repoussé par personne, et l’appeler ainsi banaliserait le mot.',
  )
  assert.equal(e.pointsSeance.length, 5, 'et la reprise ne crée AUCUN objet : cinq points avant, cinq après')

  // la séance a lieu, on avance d'une semaine : la n°21 est posée le 15
  const apres = etat()
  apres.reunions.push({ id: 'r-21', projetId: 'P-EC', titre: 'Réunion de chantier n°21', date: '2026-07-15', heure: '09:00', convoques: [] })
  const suivante = S.preparerSeance(apres, 'P-EC', { maintenant: '2026-07-09' })

  assert.equal(suivante.seance.id, 'r-21', 'une semaine plus tard, c’est la n°21 qu’on prépare')
  assert.ok(
    idsDe(suivante).includes('pt-ferraillage'),
    'LE CŒUR DE LA DEMANDE : le point non résolu est encore là à la séance suivante. Personne ne l’a recopié, ' +
      'personne n’a pu l’oublier.',
  )
  assert.equal(
    suivante.entrees.find((x) => x.point.id === 'pt-ferraillage').anciennete,
    4,
    'et son ancienneté a AVANCÉ d’une séance toute seule : 18, 19, 20, 21 — c’est ce chiffre qui dit qu’il ' +
      'traîne, et c’est lui que personne n’a aujourd’hui',
  )

  // le point RÉSOLU, lui, ne revient pas à l'ordre du jour… mais ne
  // disparaît pas non plus
  const levage = suivante.entrees.find((x) => x.point.id === 'pt-levage')
  assert.ok(levage, 'un point fait reste AU RELEVÉ — c’est ce qu’on annonce en séance, et ce que le CR reprend')
  assert.equal(levage.reporte, false, 'mais il n’est pas « reporté » : il ne réclame plus rien de personne')
  assert.equal(levage.traine, false, 'et il ne peut pas « traîner » : un point réglé ne traîne pas')
}

// ============================================================
// 2. LE RANGEMENT — à traiter en tête, les plus anciens d'abord
// ============================================================

{
  const e = etat()
  const ordre = S.preparerSeance(e, 'P-EC', { maintenant: AUJOURD_HUI })

  assert.deepEqual(
    idsDe(ordre),
    ['pt-ferraillage', 'pt-veille', 'pt-enduit', 'pt-levage', 'pt-benne'],
    'L’ORDRE EXACT : « à traiter » d’abord (le plus ancien en tête), puis « en cours », puis « fait », puis ' +
      '« sans suite ».',
  )

  // l'inversion, isolée : c'est ELLE la demande, et une liste
  // antéchronologique la trahirait sans que rien ne le signale
  const aTraiter = ordre.entrees.filter((x) => x.point.etat === 'a_traiter').map((x) => x.point.id)
  assert.deepEqual(
    aTraiter,
    ['pt-ferraillage', 'pt-veille'],
    'LES PLUS ANCIENS EN TÊTE. pt-ferraillage est inscrit depuis le 24/06, pt-veille depuis le 05/07: c’est ' +
      'le VIEUX qui passe devant. Une liste antéchronologique — le réflexe de tout registre — enterrerait ' +
      'chaque semaine un peu plus ce qu’il fallait traiter en premier, et le point le plus repoussé finirait ' +
      'sous la ligne de flottaison.',
  )

  // les réglés, eux, se lisent à l'envers : la décision de la séance en tête
  const regles = S.rangerPoints([
    { id: 'a', projetId: 'P-EC', libelle: 'ancien', etat: 'fait', inscritLe: '2026-06-01', resoluLe: '2026-06-10', majLe: '2026-06-10' },
    { id: 'b', projetId: 'P-EC', libelle: 'frais', etat: 'fait', inscritLe: '2026-06-02', resoluLe: '2026-07-01', majLe: '2026-07-01' },
  ]).map((p) => p.id)
  assert.deepEqual(
    regles,
    ['b', 'a'],
    'côté « fait », les résolutions les plus RÉCENTES en tête : ce sont celles de la séance, celles qu’on ' +
      'annonce — pas celles d’il y a un mois',
  )

  // --- rien n'est masqué, rien n'est agrégé, rien n'est supprimé --------
  assert.equal(
    ordre.entrees.length,
    e.pointsSeance.length,
    'TOUS les points du projet sont au relevé. Un relevé qui cacherait les points faits ne serait plus le ' +
      'document qu’on envoie après la séance — et un relevé qui cacherait les « sans suite » ferait ' +
      'reproposer six mois plus tard une question déjà tranchée.',
  )
  assert.deepEqual(
    idsDe(ordre).slice().sort(),
    e.pointsSeance.map((p) => p.id).sort(),
    'aucun identifiant perdu en route',
  )
  assert.deepEqual(
    ordre.nbParEtat,
    { a_traiter: 2, en_cours: 1, fait: 1, sans_suite: 1 },
    'le compte par état est celui du relevé entier',
  )
  const dansLesGroupes = ordre.groupes.flatMap((g) => g.entrees.map((x) => x.point.id))
  assert.deepEqual(
    dansLesGroupes,
    idsDe(ordre),
    'les intertitres ne trient RIEN et ne perdent rien : `grouperPoints` pose des titres sur un relevé déjà ' +
      'rangé — deux tris, ce serait deux ordres possibles',
  )

  // un état hors liste (import JSON, version future) ne s'évapore pas
  const bizarre = etat()
  bizarre.pointsSeance.push({
    id: 'pt-inconnu',
    projetId: 'P-EC',
    libelle: 'Venu d’un import',
    etat: 'a_arbitrer',
    inscritLe: '2026-06-20',
    resoluLe: null,
    majLe: '2026-06-20',
  })
  const avecInconnu = S.preparerSeance(bizarre, 'P-EC', { maintenant: AUJOURD_HUI })
  assert.ok(
    idsDe(avecInconnu).includes('pt-inconnu'),
    'un point dont l’état ne se range pas passe en FIN de relevé, jamais à la poubelle : un point qu’on ne ' +
      'sait pas classer reste un point, et le perdre en silence serait le seul vrai défaut possible ici',
  )
  assert.equal(idsDe(avecInconnu).at(-1), 'pt-inconnu', 'et il passe bien après tout le reste')
  assert.ok(
    avecInconnu.groupes.some((g) => g.entrees.some((x) => x.point.id === 'pt-inconnu')),
    'il porte même son intertitre — sinon il serait au tableau mais sous le mauvais titre',
  )

  // --- le rangement est DÉTERMINISTE ------------------------------------
  const memeJour = S.preparerSeance(etat(), 'P-EC', { maintenant: AUJOURD_HUI })
  assert.deepEqual(idsDe(memeJour), idsDe(ordre), 'deux lectures du même relevé donnent le même ordre')

  const exAequo = S.rangerPoints([
    { id: 'z', projetId: 'P', libelle: 'z', etat: 'a_traiter', inscritLe: '2026-06-24', resoluLe: null, majLe: '2026-06-24' },
    { id: 'a', projetId: 'P', libelle: 'a', etat: 'a_traiter', inscritLe: '2026-06-24', resoluLe: null, majLe: '2026-06-24' },
  ]).map((p) => p.id)
  assert.deepEqual(
    exAequo,
    ['a', 'z'],
    'deux points inscrits le même jour se départagent par identifiant — sans quoi deux impressions du même ' +
      'relevé ne donneraient pas le même papier',
  )
}

// ============================================================
// 3. L'ANCIENNETÉ EN SÉANCES — comptée, jamais stockée
// ============================================================

{
  const e = etat()
  const ordre = S.preparerSeance(e, 'P-EC', { maintenant: AUJOURD_HUI })
  const anciennete = (id) => ordre.entrees.find((x) => x.point.id === id).anciennete

  assert.equal(
    anciennete('pt-ferraillage'),
    3,
    'né à la n°18, il figure aux n°18, 19 et 20 : c’est sa 3ᵉ séance. C’est LE chiffre de la « to-do ' +
      'améliorée » — sans lui, la liste ne dit pas qu’un point est repoussé pour la troisième fois.',
  )
  assert.equal(anciennete('pt-veille'), 1, 'inscrit le 05/07, hors séance : la n°20 est sa 1re')
  assert.equal(anciennete('pt-enduit'), 3, 'même origine que le ferraillage, même ancienneté')

  assert.equal(S.SEUIL_POINT_QUI_TRAINE, 3, 'au-delà de trois séances, un point ne « suit plus son cours »')
  assert.equal(ordre.entrees.find((x) => x.point.id === 'pt-ferraillage').traine, true, 'il TRAÎNE, et l’écran doit le dire')
  assert.equal(ordre.entrees.find((x) => x.point.id === 'pt-veille').traine, false, 'celui d’hier, non')
  assert.equal(ordre.quiTrainent, 2, 'deux points traînent — c’est le badge de l’en-tête et la ligne de l’entête du papier')
  assert.equal(S.libelleAnciennete(1), '1re séance', 'l’accord se fait à un seul endroit, pour l’écran comme pour le papier')
  assert.equal(S.libelleAnciennete(3), '3ᵉ séance')

  // --- la preuve que c'est COMPTÉ : l'agenda bouge, la réponse suit ----
  //
  // Un compteur stocké et incrémenté à chaque séance donnerait toujours 3
  // ici, quoi qu'il arrive à l'agenda. C'est exactement le mode d'erreur
  // qu'on refuse : la réunion la plus souvent reprogrammée est celle du
  // chantier qui va mal, donc celle dont les points traînent le plus.
  const reprogramme = etat()
  reprogramme.reunions.find((r) => r.id === 'r-19').date = '2026-07-20' // la n°19 est repoussée après la n°20
  assert.equal(
    S.preparerSeance(reprogramme, 'P-EC', { maintenant: AUJOURD_HUI }).entrees.find((x) => x.point.id === 'pt-ferraillage')
      .anciennete,
    2,
    'la n°19 repoussée après la n°20, le point n’a plus figuré qu’à DEUX séances. Un compteur incrémenté ' +
      'aurait gardé 3 et menti sur le seul chiffre qui compte.',
  )

  const annulee = etat()
  annulee.reunions = annulee.reunions.filter((r) => r.id !== 'r-19')
  assert.equal(
    S.preparerSeance(annulee, 'P-EC', { maintenant: AUJOURD_HUI }).entrees.find((x) => x.point.id === 'pt-ferraillage')
      .anciennete,
    2,
    'séance annulée, une séance de moins au compteur — la réponse suit toujours l’agenda RÉEL',
  )

  const sansAgenda = etat()
  sansAgenda.reunions = []
  const orphelin = S.preparerSeance(sansAgenda, 'P-EC', { maintenant: AUJOURD_HUI })
  assert.equal(orphelin.seance, null, 'aucune date posée : on prépare quand même, et l’écran le dit')
  assert.equal(
    orphelin.entrees.find((x) => x.point.id === 'pt-ferraillage').anciennete,
    1,
    'au moins 1 : le point figure au relevé qu’on est en train de tenir, même si rien n’est encore à l’agenda',
  )

  // --- et `inscritLe` ne se réécrit JAMAIS ------------------------------
  const point = e.pointsSeance.find((p) => p.id === 'pt-ferraillage')
  const enCours = S.pointAvecEtat(point, 'en_cours', '2026-07-08')
  assert.equal(
    enCours.inscritLe,
    '2026-06-24',
    'changer l’état ne réécrit pas la date d’inscription. La réécrire remettrait à zéro le compteur du point ' +
      'qui traîne le plus, EXACTEMENT au moment où quelqu’un s’en occupe enfin — le pire moment possible.',
  )
  assert.equal(enCours.majLe, '2026-07-08', 'la date de dernier geste, elle, suit')
  assert.equal(enCours.resoluLe, null, '« en cours » n’est pas une résolution')
  assert.equal(point.etat, 'a_traiter', 'le geste rend une COPIE : l’appelant range le résultat dans SON écriture, un seul « Annuler »')

  const fait = S.pointAvecEtat(point, 'fait', '2026-07-08')
  assert.equal(fait.resoluLe, '2026-07-08', 'entrer dans « fait » date la résolution')
  const rouvert = S.pointAvecEtat(fait, 'a_traiter', '2026-07-15')
  assert.equal(
    rouvert.resoluLe,
    null,
    'et en sortir la RETIRE : laisser traîner la date rangerait un point rouvert entre deux points réglés à ' +
      'la prochaine impression',
  )
  assert.equal(rouvert.inscritLe, '2026-06-24', 'tandis que son ancienneté, elle, est intacte — il a bien traîné tout ce temps')
}

// ============================================================
// 4. LA MACHINE PROPOSE, L'HUMAIN DÉCIDE (§15)
// ============================================================

{
  const e = etat()
  // un visa en retard : reçu le 20/06, délai CCAP de 15 jours → échéance au
  // 05/07, dépassée le 06
  e.visas.push({
    id: 'v-12',
    projetId: 'P-EC',
    marcheId: 'M-L01',
    lot: 'Lot 01 — Gros œuvre',
    document: 'Plans EXE R+1 — indice B',
    recuLe: '2026-06-20',
    delaiJours: 15,
    statut: 'a_viser',
  })

  const avant = JSON.stringify(e)
  const ordre = S.preparerSeance(e, 'P-EC', { maintenant: AUJOURD_HUI })

  assert.equal(
    JSON.stringify(e),
    avant,
    'RIEN NE S’INSCRIT TOUT SEUL (§15) : lire l’ordre du jour n’ajoute aucun point. Un `useEffect` qui ' +
      '« rattraperait » les visas en retard serait la machine décidant à la place de l’humain, et le module ' +
      'pur resterait juste pendant que l’outil déciderait seul.',
  )
  assert.equal(ordre.entrees.length, 5, 'le relevé est toujours à cinq points : la proposition n’en est pas un')
  assert.equal(ordre.propositions.length, 1, 'la machine propose UN point — le visa en retard')

  const prop = ordre.propositions[0]
  assert.equal(prop.cle, 'visa:v-12', 'la proposition porte une clé STABLE : c’est elle qui empêchera de la reproposer')
  assert.equal(prop.origine, 'visa')
  assert.match(prop.libelle, /Plans EXE R\+1 — indice B/, 'le libellé nomme le document, pas « un visa »')
  assert.match(
    prop.detail,
    /reçu le 20 juin 2026 · échéance CCAP 05 juil\. 2026 \(en retard de 1 j\)/,
    'et le DÉTAIL est vérifiable avant d’être accepté : dates, délai, retard. Une proposition qu’on ne peut ' +
      'pas vérifier se signe les yeux fermés, ce qui revient à laisser la machine décider.',
  )
  assert.equal(prop.responsable, 'MOE', 'un visa est un geste de la maîtrise d’œuvre : c’est NOUS qui devons agir')

  // --- INSCRIRE : le geste humain ---------------------------------------
  const inscrit = S.pointDepuisProposition(prop, { id: 'pts-1', projetId: 'P-EC', maintenant: AUJOURD_HUI, reunionId: 'r-20' })
  assert.equal(inscrit.etat, 'a_traiter', 'accepter, c’est porter le point à l’ordre du jour')
  assert.equal(inscrit.origineRef, 'visa:v-12', 'et poser la clé')
  assert.equal(inscrit.resoluLe, null)
  assert.equal(inscrit.notes, prop.detail, 'le « pourquoi » de la machine reste attaché : sans lui, la ligne devient un libellé orphelin à re-vérifier')

  const accepte = etat()
  accepte.visas = e.visas
  accepte.pointsSeance.push(inscrit)
  const apresInscription = S.preparerSeance(accepte, 'P-EC', { maintenant: AUJOURD_HUI })
  assert.equal(
    apresInscription.propositions.length,
    0,
    'la machine ne repropose plus ce qui est au relevé : la question vit désormais à UN SEUL endroit, avec ' +
      'son état et son ancienneté',
  )
  assert.ok(idsDe(apresInscription).includes('pts-1'), 'et le point est bien au relevé')

  // --- ÉCARTER : n'efface rien ------------------------------------------
  const ecarte = S.pointDepuisProposition(prop, { id: 'pts-2', projetId: 'P-EC', maintenant: AUJOURD_HUI, reunionId: 'r-20' }, 'sans_suite')
  assert.equal(ecarte.etat, 'sans_suite', 'écarter, c’est ranger — pas supprimer')
  assert.equal(
    ecarte.resoluLe,
    AUJOURD_HUI,
    'et la décision est DATÉE : « vu et écarté » n’est pas « jamais vu », et c’est exactement la question ' +
      'qu’on se pose six mois plus tard',
  )

  const ecartee = etat()
  ecartee.visas = e.visas
  ecartee.pointsSeance.push(ecarte)
  const apresEcart = S.preparerSeance(ecartee, 'P-EC', { maintenant: AUJOURD_HUI })
  assert.equal(apresEcart.propositions.length, 0, 'écartée, elle ne revient pas non plus — sinon « écarter » ne servirait à rien')
  assert.equal(apresEcart.groupes.at(-1).etat, 'sans_suite', 'le dernier groupe du relevé est « sans suite »')
  assert.ok(
    apresEcart.groupes.at(-1).entrees.some((x) => x.point.id === 'pts-2'),
    'la proposition écartée est rangée dans le dernier groupe du relevé — en bas, mais AU relevé : jamais masquée',
  )
  assert.ok(
    idsDe(apresEcart).indexOf('pts-2') > idsDe(apresEcart).indexOf('pt-enduit'),
    'elle passe après tout ce qui reste à faire — écarter range, ça n’efface pas, et ça ne remonte rien',
  )

  // …et elle se rouvre d'un geste
  const rouverte = S.pointAvecEtat(ecarte, 'a_traiter', '2026-07-15')
  assert.equal(rouverte.etat, 'a_traiter')
  assert.equal(rouverte.resoluLe, null, 'rouvrir efface la date d’écartement')
  assert.equal(rouverte.inscritLe, AUJOURD_HUI, 'sans toucher à la date d’inscription')

  // --- un point saisi à la main naît « à traiter » ----------------------
  const nouveau = S.pointNouveau(
    { libelle: '  Reprise du seuil bas  ', marcheId: 'M-L01', responsable: ' SARL Martin BTP ', echeance: null },
    { id: 'pts-3', projetId: 'P-EC', maintenant: AUJOURD_HUI, reunionId: 'r-20' },
  )
  assert.equal(nouveau.etat, 'a_traiter', 'un point qu’on écrit est un point qu’on n’a pas encore traité')
  assert.equal(nouveau.libelle, 'Reprise du seuil bas', 'le libellé est nettoyé')
  assert.equal(nouveau.responsable, 'SARL Martin BTP')
  assert.equal(nouveau.echeance, null, 'pas d’échéance inventée : beaucoup de points n’en ont pas')
  assert.equal(nouveau.inscritLe, AUJOURD_HUI)
  assert.equal(nouveau.reunionOrigineId, 'r-20', 'il naît à la séance qu’on prépare : c’est elle qui datera son ancienneté')

  // --- corriger un point ne touche pas à son état ni à son ancienneté ---
  const corrige = S.pointCorrige(
    nouveau,
    { libelle: 'Reprise du seuil bas — côté cour', marcheId: null, lot: 'Bureau de contrôle', responsable: 'MOE', echeance: '2026-07-20' },
    '2026-07-10',
  )
  assert.equal(corrige.libelle, 'Reprise du seuil bas — côté cour')
  assert.equal(corrige.etat, 'a_traiter', 'l’état ne passe PAS par la correction : il a son geste, plus rapide')
  assert.equal(corrige.inscritLe, AUJOURD_HUI, 'et corriger un libellé ne remet pas l’ancienneté à zéro')
  assert.equal(corrige.majLe, '2026-07-10')
}

// ============================================================
// 5. L'ÉCRAN OFFRE LES GESTES — « je ne vois pas où créer ça »
// ============================================================
//
// C'est le reproche littéral de l'agence. Un relevé qu'on ne peut pas
// modifier serait exactement ce qu'elle vient de refuser : un tableau de bord
// de plus. Les trois gestes doivent partir d'un CLIC (ou d'un choix), et
// aucun d'un effet.

{
  const sf = arbre(ECRAN)
  const source = lire(ECRAN)

  /** les identifiants appelés à l'intérieur d'un nœud */
  const appelsDans = (n) => {
    const noms = new Set()
    const parcourir = (x) => {
      if (ts.isCallExpression(x)) {
        const e = x.expression
        if (ts.isIdentifier(e)) noms.add(e.text)
        else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) noms.add(e.name.text)
      }
      ts.forEachChild(x, parcourir)
    }
    parcourir(n)
    return noms
  }

  /** tous les identifiants d'un nœud — un gestionnaire s'écrit aussi bien
   *  `onClick={ajouter}` (la fonction elle-même) que
   *  `onClick={() => changerEtat(point, v)}` (un appel) */
  const nomsDans = (n) => {
    const noms = new Set(appelsDans(n))
    const parcourir = (x) => {
      if (ts.isIdentifier(x)) noms.add(x.text)
      ts.forEachChild(x, parcourir)
    }
    parcourir(n)
    return noms
  }

  // ce que les gestes de l'écran déclenchent. Deux formes portent un
  // gestionnaire dans cet écran : l'attribut JSX (`<Btn onClick=…>`) et la
  // propriété d'un item de `RowMenu` (`{ label: …, onClick: … }`) — n'en
  // regarder qu'une laisserait la moitié des gestes hors contrôle.
  const surGeste = new Set()
  const parcourirGestes = (n) => {
    const estAttribut = ts.isJsxAttribute(n) && ['onClick', 'onChange'].includes(n.name.getText()) && n.initializer
    const estPropriete =
      ts.isPropertyAssignment(n) && ['onClick', 'onChange'].includes(n.name.getText()) && n.initializer
    if (estAttribut || estPropriete) for (const nom of nomsDans(n.initializer)) surGeste.add(nom)
    ts.forEachChild(n, parcourirGestes)
  }
  parcourirGestes(sf)

  /** le corps de `ReleveSeance`, découpé par le compilateur : l'écran fait
   *  3 500 lignes et porte d'autres `ajouter` (intempéries, réunions) — une
   *  recherche de texte sur le fichier entier attraperait le mauvais geste et
   *  validerait à vide, ce qui est pire que ne rien vérifier. */
  const corpsDe = (nom) => {
    let trouve = null
    const chercher = (n) => {
      if (ts.isFunctionDeclaration(n) && n.name && n.name.text === nom) trouve = n
      ts.forEachChild(n, chercher)
    }
    chercher(sf)
    return trouve
  }
  const noeudReleve = corpsDe('ReleveSeance')
  assert.ok(noeudReleve, `${ECRAN} doit porter le bloc \`ReleveSeance\` — le relevé est le seul endroit où la séance se tient`)
  const releve = noeudReleve.getText(sf)

  /** le corps EXACT d'un geste du relevé, découpé par le compilateur. Une
   *  fenêtre de N caractères après `const geste =` ferait passer le contrôle
   *  ou le ferait échouer selon la longueur d'un commentaire — c'est-à-dire
   *  au hasard. */
  const geste = (nom) => {
    let trouve = null
    const chercher = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === nom && n.initializer)
        trouve = n.initializer
      ts.forEachChild(n, chercher)
    }
    chercher(noeudReleve)
    return trouve ? trouve.getText(sf) : null
  }

  for (const [geste, quoi] of [
    ['ajouter', 'INSCRIRE un point — la ligne de saisie en pied de relevé'],
    ['changerEtat', 'CHANGER L’ÉTAT — le geste le plus fréquent de la séance'],
    ['setEdition', 'MODIFIER un point — ouvrir sa fiche'],
    ['trancher', 'inscrire ou écarter une proposition, une par une'],
    ['supprimer', 'retirer un point du relevé'],
  ])
    assert.ok(
      surGeste.has(geste),
      `${ECRAN} : « ${geste} » (${quoi}) doit partir d’un geste humain — clic ou choix. Sans lui, le relevé ` +
        'redevient le tableau de bord EN LECTURE que l’agence a refusé : « je ne vois pas où créer ça, le ' +
        'modifier, etc. »',
    )

  // …et les trois fabriques du module pur sont bien celles qu'il appelle :
  // recopier la construction d'un point dans l'écran donnerait deux points
  // différents selon la porte empruntée
  for (const fabrique of ['pointNouveau', 'pointAvecEtat', 'pointCorrige', 'pointDepuisProposition'])
    assert.match(
      source,
      new RegExp(`\\b${fabrique}\\(`),
      `${ECRAN} doit appeler \`${fabrique}\` (src/seanceChantier.ts) plutôt que de fabriquer le point à la main`,
    )

  // le geste d'état est une LISTE, pas quatre boutons par ligne : sur un
  // relevé de quinze points, quatre chips font soixante boutons à l'écran —
  // « un écran qui gagne une option et perd en lisibilité est un échec ».
  // Cherché DANS le relevé : cet écran porte une douzaine d'autres listes.
  assert.match(
    releve,
    /<Select\s+value=\{point\.etat\}/,
    'l’état se change par une liste déroulante posée sur la ligne, qui MONTRE l’état courant et le change ' +
      'd’un choix',
  )
  assert.match(
    releve,
    /ORDRE_ETATS_POINT\.map\(\(etat\) => \(\{/,
    'et ses choix viennent de `ORDRE_ETATS_POINT` — une seconde liste d’états écrite à la main divergerait ' +
      'du rangement au premier ajout',
  )

  // la modale de correction existe, et elle n'emporte pas l'état avec elle
  assert.match(source, /function ModalPointSeance\(/, 'la correction d’un point a sa fiche')
  const modale = source.slice(source.indexOf('function ModalPointSeance('))
  assert.ok(
    !/pointAvecEtat\(/.test(modale.slice(0, modale.indexOf('\n}\n'))),
    'la fiche ne change pas l’état : il a son geste, sur la ligne, et deux chemins pour un même changement ' +
      'sont deux occasions de diverger',
  )

  // --- rien ne s'écrit sans geste : aucun effet n'appelle une fabrique ---
  const effets = []
  const chercherEffets = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'useEffect') effets.push(n)
    ts.forEachChild(n, chercherEffets)
  }
  chercherEffets(sf)
  const ECRIVENT = new Set(['pointNouveau', 'pointDepuisProposition', 'pointAvecEtat', 'pointCorrige', 'trancher', 'ajouter', 'changerEtat'])
  for (const effet of effets) {
    const ligne = sf.getLineAndCharacterOfPosition(effet.getStart()).line + 1
    const fautifs = [...appelsDans(effet)].filter((nom) => ECRIVENT.has(nom))
    assert.deepEqual(
      fautifs,
      [],
      `${ECRAN}:${ligne} — un \`useEffect\` appelle ${fautifs.join(', ')}. Un effet s’exécute SANS clic : la ` +
        'machine inscrirait des points toute seule (§15).',
    )
  }

  // --- chaque geste laisse un « Annuler » (patron ui.tsx) ---------------
  for (const nom of ['ajouter', 'changerEtat', 'trancher', 'supprimer']) {
    const corps = geste(nom)
    assert.ok(corps, `${ECRAN} : le geste « ${nom} » du relevé doit exister`)
    assert.match(
      corps,
      /undo: \(\) => replace\(snap\)/,
      `« ${nom} » doit laisser un « Annuler » : en réunion on clique vite, et un geste qui ne se défait pas ` +
        'se paye en ressaisie',
    )
    assert.ok(
      corps.indexOf('const snap = state') >= 0 && corps.indexOf('const snap = state') < corps.indexOf('update('),
      `« ${nom} » doit prendre son instantané AVANT d’écrire — pris après, « Annuler » rendrait l’état qui ` +
        'contient déjà le geste',
    )
  }

  // la suppression, elle, passe par la confirmation MAISON (pas
  // window.confirm — test-criteres-usage l'interdit) et rappelle qu'il y a
  // mieux à faire que supprimer
  const suppr = geste('supprimer')
  assert.match(suppr, /await confirmer\(\{/, 'supprimer se confirme')
  assert.match(
    suppr,
    /« sans suite » suffit/,
    'et la confirmation rappelle que « sans suite » range sans perdre : supprimer un point efface la trace ' +
      'qu’on l’avait vu',
  )

  // --- un seul endroit : l'ancien bloc « Préparer la réunion » est PARTI --
  assert.ok(
    !/function PreparationReunion\b/.test(source),
    'le bloc « Préparer la réunion » (lot C) doit avoir été REMPLACÉ, pas doublé. Deux endroits pour la même ' +
      'question, c’est deux réponses possibles — et c’est le premier reproche de l’agence.',
  )
  assert.match(source, /function ReleveSeance\(/, 'le relevé est le seul endroit')
}

// ============================================================
// 6. L'ÉCRAN ET LE PAPIER NE PEUVENT PLUS DIVERGER
// ============================================================
//
// Le lot C écrivait le filtre des deux côtés et comptait sur la vigilance :
// un commentaire jumeau demandait qu'on pense à modifier l'autre. Le
// rangement, le report, l'ancienneté et les propositions n'existent
// désormais qu'une fois. Ce n'est plus une discipline, c'est une
// impossibilité — et on le vérifie sur le papier RÉELLEMENT produit.

{
  const e = etat()
  e.visas.push({
    id: 'v-12',
    projetId: 'P-EC',
    marcheId: 'M-L01',
    lot: 'Lot 01 — Gros œuvre',
    document: 'Plans EXE R+1 — indice B',
    recuLe: '2026-06-20',
    delaiJours: 15,
    statut: 'a_viser',
  })
  const ordre = S.preparerSeance(e, 'P-EC', { maintenant: AUJOURD_HUI })

  derniereSortie = null
  PDF.ouvrirPreparationReunionPDF(e, PROJET, AUJOURD_HUI, ordre.seance)
  const papier = derniereSortie
  assert.ok(papier, 'le relevé doit produire un document')

  // l'ordre du jour du PAPIER, dans l'ordre où il y figure
  const ordreDuJour = papier.slice(papier.indexOf('Ordre du jour'), papier.indexOf('Proposé par le cockpit'))
  const libellesPapier = [...ordreDuJour.matchAll(/<td><strong>([^<]+)<\/strong>/g)].map((m) => m[1])
  assert.deepEqual(
    libellesPapier,
    ordre.entrees.map((x) => x.point.libelle.replace(/&/g, '&amp;')),
    'LE MÊME ORDRE DU JOUR, DANS LE MÊME ORDRE : l’écran et le papier lisent `preparerSeance`, une seule ' +
      'fois. Si ceci tombe, deux personnes tiennent la même réunion sur deux listes différentes — celle de ' +
      'l’écran et celle qu’on a imprimée la veille.',
  )

  // et le papier ne masque rien non plus
  assert.equal(libellesPapier.length, 5, 'les cinq points sont au papier — faits et sans suite compris')
  assert.match(papier, /3ᵉ séance/, 'l’ancienneté est imprimée : c’est elle qu’on lit en séance pour décider de débloquer')
  assert.match(papier, /à traiter — 2 points/, 'les intertitres portent leur compte')
  assert.match(papier, /Réunion de chantier n°19 du 01 juil\. 2026/, 'le papier dit d’où l’on repart')

  // les propositions restent HORS de l'ordre du jour, avec leurs deux
  // colonnes à cocher au stylo : c'est le §15 sur le papier
  const propose = papier.slice(papier.indexOf('Proposé par le cockpit'))
  assert.match(propose, /Plans EXE R\+1 — indice B/, 'la proposition est au papier…')
  assert.ok(
    !ordreDuJour.includes('Plans EXE R+1'),
    '…mais PAS à l’ordre du jour : imprimer une proposition parmi les points la ferait traiter comme un ' +
      'point décidé, et personne ne saurait plus qui l’a inscrite',
  )
  assert.match(propose, /<th>Inscrire<\/th><th>Écarter<\/th>/, 'et le papier laisse trancher au stylo, en séance')
  assert.match(
    propose,
    /Ces points ne sont <strong>pas<\/strong> à l'ordre du jour/,
    'la feuille le dit en toutes lettres',
  )

  // la raison STRUCTURELLE : une seule autorité, importée des deux côtés
  for (const fichier of [ECRAN, 'src/pdf.ts'])
    assert.match(
      lire(fichier),
      /from '(\.\.\/|\.\/)seanceChantier'/,
      `${fichier} doit lire l’ordre du jour de src/seanceChantier.ts — deux lectures de la même autorité ne ` +
        'peuvent pas diverger ; deux calculs, si',
    )
  const pdf = lire('src/pdf.ts')
  for (const registre of ['visas', 'gpa', 'penalites', 'chantier'])
    assert.doesNotMatch(
      pdf,
      new RegExp(`from '\\./${registre}'`),
      `src/pdf.ts ne doit plus importer './${registre}' : c’est \`preparerSeance\` qui relit les registres, ` +
        'une seule fois. Les rouvrir ici recréerait le filtre jumeau que le lot C tenait à la discipline.',
    )
}

// ============================================================
// 7. LE CÂBLAGE — une collection qui n'existe qu'à moitié ne sert à rien
// ============================================================

{
  // le module est PUR : c'est ce qui le rend rejouable, testable, et ce qui
  // permet à l'écran et au papier de partager la même réponse
  const module = lire('src/seanceChantier.ts')
  for (const [motif, pourquoi] of [
    [/useStore/, 'il lirait l’état par un canal caché'],
    [/localStorage/, 'un module pur ne connaît pas le poste de travail'],
    [/fetch\(/, 'préparer une séance ne demande le réseau à personne'],
    [/Date\.now\(\)/, '`maintenant` est un ARGUMENT — c’est lui qui date les retards, l’ancienneté et les résolutions'],
    [/new Date\(\)/, 'même raison : une horloge lue ici rendrait deux préparations du même jour différentes'],
  ])
    assert.doesNotMatch(module, motif, `src/seanceChantier.ts : ${pourquoi} (motif ${motif})`)

  // aucun seuil n'est réinventé : les cinq familles de propositions viennent
  // des autorités existantes
  for (const [autorite, notion] of [
    ["'./visas'", 'les échéances et retards de visa'],
    ["'./gpa'", 'les désordres ouverts et la fin de garantie de parfait achèvement'],
    ["'./penalites'", 'les montants encourus et la prolongation de délai pour intempéries'],
    ["'./chantier'", 'l’avancement des lots et le prédicat « entreprise à confirmer »'],
  ])
    assert.ok(
      module.includes(`from ${autorite}`),
      `src/seanceChantier.ts doit IMPORTER ${autorite} pour ${notion} : recopier un seuil ici ferait annoncer ` +
        'en séance un retard que l’écran du chantier ne voit pas',
    )

  // la collection se normalise au chargement (patron `Array.isArray`) : un
  // état ancien, ou tronqué par une synchronisation, ne doit pas faire
  // planter l'onglet Chantier au premier `.filter`
  assert.match(
    lire('src/store.tsx'),
    /etat\.pointsSeance = Array\.isArray\(parsed\.pointsSeance\) \? parsed\.pointsSeance : \[\]/,
    'src/store.tsx doit normaliser `pointsSeance` : sans cette ligne, ouvrir un état enregistré avant C3 ' +
      'casse l’écran au lieu d’afficher un relevé vide',
  )
  assert.match(lire('src/seed.ts'), /pointsSeance: \[/, 'et le jeu d’amorce doit porter la collection')
  assert.match(lire('src/types.ts'), /pointsSeance: PointSeance\[\]/, 'déclarée dans AppState')

  // un état vide traverse tout sans exploser — c'est le premier lancement
  const vide = { settings: { nomAgence: 'A', personnes: [] }, projets: [PROJET], marches: [], reunions: [], pointsSeance: [], visas: [], evenementsMarche: [], desordresGPA: [], tachesChantier: [], intemperies: [] }
  const rien = S.preparerSeance(vide, 'P-EC', { maintenant: AUJOURD_HUI })
  assert.deepEqual(rien.entrees, [], 'aucun point : le relevé est vide, il ne plante pas')
  assert.deepEqual(rien.propositions, [], 'et rien à proposer')
  assert.equal(rien.seance, null)
  derniereSortie = null
  PDF.ouvrirPreparationReunionPDF(vide, PROJET, AUJOURD_HUI, null)
  assert.match(
    derniereSortie,
    /Aucun point au relevé/,
    'et le papier d’un relevé vide DIT qu’il est vide : une rubrique absente laisserait croire à un oubli, ' +
      'une rubrique vide dit qu’on a regardé',
  )
}

console.log(
  'Relevé de séance : un point non résolu est REPRIS à la séance suivante sans recopie (et son ancienneté ' +
    'avance toute seule) ; le rangement met les plus anciens « à traiter » en tête et ne masque rien — pas ' +
    'même un état inconnu ; l’ancienneté se COMPTE (une séance reprogrammée change la réponse, un compteur ' +
    'stocké aurait menti) ; une proposition ne s’inscrit qu’au geste humain et l’écarter la range au lieu de ' +
    'l’effacer ; l’écran offre inscrire / modifier / changer d’état, chacun avec son « Annuler » ; et le ' +
    'papier imprime EXACTEMENT l’ordre du jour de l’écran, parce qu’il n’en existe qu’un.',
)
