// 5.21 — LE PLANNING CHANTIER DEVIENT MANIPULABLE, DONC IL DEVIENT CALCULABLE.
//
// L'agence a demandé « un vrai Gantt » : pouvoir DÉPLACER une intervention,
// l'allonger, la raccourcir — et que les dates du marché suivent. Un planning
// qu'on regarde est une image ; un planning sur lequel on agit est un calcul,
// et un calcul se vérifie.
//
// CE QUE CE TEST FERME, ET POURQUOI ÇA COMPTE
// ---------------------------------------------
// 1. LA GÉOMÉTRIE EST RÉVERSIBLE. Un glissement de N pixels doit rendre la
//    date qu'on voit sous le curseur. Si l'aller (date → position) et le
//    retour (pixels → jours) ne se répondent pas, la barre atterrit à côté
//    de là où on l'a lâchée — et personne ne s'en aperçoit, parce qu'une
//    barre de Gantt n'a pas d'échelle absolue sous les yeux. C'est le mode
//    de panne le plus sournois d'un Gantt manipulable.
//
// 2. UNE INTERVENTION NE PEUT PAS S'INVERSER. Tirer la poignée de début
//    au-delà de la fin produirait un lot qui finit avant de commencer :
//    aucune des fonctions en aval (avancement, retard, chevauchement,
//    impression) ne sait lire cela, et elles échoueraient chacune à leur
//    façon, loin d'ici.
//
// 3. LE PLANNING N'INVENTE NI L'AVANCEMENT NI LES INTEMPÉRIES. `avancementLot`
//    (src/chantier.ts) et `prolongationDelai` (src/penalites.ts) font
//    autorité et sont IMPORTÉS. La raison est concrète et coûteuse : le même
//    chiffre d'intempéries déduit les jours de retard des pénalités. Si le
//    planning en recalculait un autre, il excuserait un retard que le
//    décompte facture — et l'agence défendrait deux positions contraires
//    devant la même entreprise.
//
// 4. « null n'est pas 0 ». Un lot sans tâche rattachée n'est pas un lot à
//    0 % : c'est un lot dont on ne sait rien. Le peindre à 0 % afficherait un
//    retard imaginaire sur tout chantier dont le planning de tâches n'est pas
//    encore construit.
//
// 5. UNE MÊME ENTREPRISE NE PEUT PAS ÊTRE À DEUX ENDROITS. C'est le conflit
//    réel d'une agence qui suit plusieurs opérations, et il ne se voit sur
//    aucun planning de chantier pris isolément.
//
// 5.23 — « UNE ENTREPRISE PEUT INTERVENIR PLUSIEURS FOIS »
// --------------------------------------------------------
// Le gros œuvre revient après le clos-couvert : c'est le plus banal des
// chantiers, et un seul couple de dates ne sait pas le dire. Un marché porte
// désormais des PÉRIODES. Cinq invariants portent tout le reste, et chacun a
// un mode de panne silencieux — d'où les sections 3 et 7 à 11 ci-dessous.
//
// 6. LE REPLI DE COMPATIBILITÉ (section 3, placée AVANT tout ce qui en
//    dépend). Aucun marché déjà saisi n'est migré : le repli se fait à la
//    LECTURE. Si `interventionsDe` rendait autre chose qu'EXACTEMENT une
//    période sur un marché ancien, tout le planning des chantiers en cours se
//    viderait d'un coup, sans erreur, à la première ouverture après la mise à
//    jour. C'est l'invariant le plus coûteux du lot, et il ne casse rien de
//    visible : il efface.
//
// 7. L'ENVELOPPE. `dateDebut`/`dateFin` deviennent le premier début et la
//    dernière fin. Une dizaine d'endroits du dépôt les lisent encore — fiche
//    projet, filtres, impression, `prolongationDelai`, relevé de séance. S'ils
//    cessaient d'être justes, le planning global, l'alerte à M−1 et
//    l'impression se tromperaient chacun de leur côté, sans rien dire.
//
// 8. LE CHEVAUCHEMENT NE SE SIGNALE PLUS LUI-MÊME. Deux périodes du MÊME
//    marché ne sont jamais un conflit. Sinon tout lot en plusieurs passages
//    crierait contre lui-même — le gros œuvre « attendu à deux endroits », les
//    deux endroits étant son propre chantier — et on apprendrait en une
//    semaine à ignorer l'alerte, emportant les vrais conflits avec elle.
//
// 9. LE GESTE PORTE SUR UNE PÉRIODE, pas sur le marché. Pousser les reprises
//    de juin ne touche pas au terrassement de février. Un geste qui porterait
//    sur le lot entier réécrirait un passage terminé et confirmé.
//
// 10. LE RETARD SE JUGE SUR LA DERNIÈRE FIN DÉFENDABLE. Un lot dans son trou
//    de mai n'est pas en retard : il l'est passé le 30 juin. Juger sur la
//    première période déclarerait en retard, dès le 1er mai, un lot dont
//    l'entreprise revient comme prévu en juin.
//
// 11. LA CONFIRMATION SE REDEMANDE À CHAQUE RETOUR. C'est précisément quand
//    une entreprise revient qu'on oublie de la confirmer : le passage de
//    février est dans toutes les têtes, celui de juin dans aucune.

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

const P = charger('src/planningTravaux.ts')
// le SEUIL de confirmation se lit chez son autorité (src/chantier.ts) : le
// recopier ici ferait passer ce test au vert le jour où les deux divergent,
// c'est-à-dire exactement le jour où il devrait tomber.
const C = charger('src/chantier.ts')
const U = charger('src/util.ts')
const S = charger('src/seed.ts')

const marche = (over = {}) => ({
  id: 'm1',
  projetId: 'p1',
  entreprise: 'Martin BTP',
  lot: 'Gros œuvre',
  montantInitialHT: 63000,
  avenantsHT: 0,
  tauxRG: 0.05,
  revision: false,
  delaiVerifJours: 30,
  actif: true,
  dateDebut: '2026-03-02',
  dateFin: '2026-05-29',
  ...over,
})

// --- 1. la fenêtre s'aligne, sinon l'aller-retour ‹ › dérive --------------

{
  const sem = P.fenetrePlanning('2026-03-04', 'semaine', 4) // un mercredi
  assert.equal(sem.debut, '2026-03-02', 'l’échelle semaine s’ancre sur le LUNDI de la date visée')
  assert.equal(sem.jours, 28, '4 semaines = 28 jours')
  assert.equal(sem.fin, '2026-03-30', 'la fin est EXCLUSIVE : le premier jour non visible')

  const mois = P.fenetrePlanning('2026-03-17', 'mois', 3)
  assert.equal(mois.debut, '2026-03-01', 'l’échelle mois s’ancre sur le 1er')
  assert.equal(mois.fin, '2026-06-01')
  assert.equal(mois.jours, 92, 'mars + avril + mai = 31 + 30 + 31')

  // l'aller-retour DOIT revenir au même endroit : c'est tout l'intérêt de
  // l'alignement. Décaler d'un nombre de jours fixe casserait ceci dès que
  // deux mois consécutifs n'ont pas la même longueur.
  const apres = P.decalerFenetre(mois, 1)
  const retour = P.decalerFenetre(apres, -1)
  assert.deepEqual(retour, mois, '‹ puis › revient EXACTEMENT à la même fenêtre (février ≠ mars en jours)')
}

// --- 2. la géométrie est réversible --------------------------------------

{
  const f = P.fenetrePlanning('2026-03-02', 'semaine', 4) // 28 jours
  assert.equal(P.pourcent(f, '2026-03-02'), 0, 'le premier jour visible est à 0 %')
  assert.equal(Math.round(P.pourcent(f, '2026-03-16')), 50, 'le 15e jour sur 28 est à la moitié')

  const LARGEUR = 700 // px : 25 px par jour sur 28 jours
  assert.equal(P.pixelsParJour(f, LARGEUR), 25)

  // L'ALLER ET LE RETOUR SE RÉPONDENT. Sans cette propriété, une barre
  // lâchée sous le curseur atterrit ailleurs, et rien à l'écran ne le dit.
  for (const jours of [1, 3, 7, -2, -14]) {
    const px = jours * P.pixelsParJour(f, LARGEUR)
    assert.equal(
      P.joursDepuisPixels(f, px, LARGEUR),
      jours,
      `un glissement de ${px} px doit rendre ${jours} jour(s) : sinon la barre n’atterrit pas ` +
        'sous le curseur, et l’erreur est invisible faute d’échelle absolue à l’écran',
    )
  }

  assert.equal(P.joursDepuisPixels(f, 0, 0), 0, 'largeur nulle (écran non mesuré) ⇒ aucun mouvement, pas une division par zéro')
}

// --- 3. LE REPLI DE COMPATIBILITÉ : AUCUNE DONNÉE SAISIE NE DISPARAÎT ----
//
// C'est l'invariant le plus coûteux à casser du lot 5.23, parce qu'il ne
// casse rien de visible : il EFFACE. Tous les marchés du dépôt n'ont que
// `dateDebut`/`dateFin`, et personne ne les migre — ni palier, ni reprise.
// `interventionsDe` est l'autorité, et c'est elle seule qui replie.

{
  const ancien = marche() // 02/03 → 29/05, aucune période : le cas de TOUS les marchés déjà saisis
  const repli = P.interventionsDe(ancien)
  assert.equal(
    repli.length,
    1,
    'un marché ANCIEN (dateDebut/dateFin seuls) rend EXACTEMENT une intervention. Zéro viderait le\n' +
      'planning de tous les chantiers en cours dès la première ouverture après la mise à jour, sans\n' +
      'une erreur ; deux inventerait un passage que personne n’a saisi.',
  )
  assert.deepEqual(
    { debut: repli[0].debut, fin: repli[0].fin },
    { debut: '2026-03-02', fin: '2026-05-29' },
    'et ce sont SES dates, telles qu’elles ont été saisies : le repli se fait à la lecture, il ne\n' +
      'réinterprète ni ne réaligne rien',
  )
  assert.equal(
    repli[0].id,
    null,
    '`id: null` n’est pas décoratif : il dit au chemin d’écriture qu’il n’y a AUCUNE période à\n' +
      'modifier et que l’enveloppe EST la donnée. Un identifiant inventé ici ferait écrire un geste de\n' +
      'barre dans une période inexistante — donc nulle part, en silence.',
  )

  // LIRE NE RÉÉCRIT RIEN. « Aucune réécriture des données existantes » doit
  // être tenue par le CODE, pas par l'intention : une migration silencieuse
  // au premier affichage rendrait irréversible un choix que personne n'a fait.
  const empreinte = JSON.stringify(ancien)
  P.interventionsDe(ancien)
  P.interventionDe(ancien)
  P.etatLot(ancien, [], [], '2026-04-15')
  P.chevauchementsEntreprise([ancien])
  assert.equal(
    JSON.stringify(ancien),
    empreinte,
    'LIRE un marché ancien (interventionsDe, interventionDe, etatLot, chevauchements) ne lui ajoute\n' +
      'aucune collection `interventions` : afficher un planning ne doit pas migrer la base.',
  )

  assert.deepEqual(
    P.interventionsDe(marche({ dateDebut: null, dateFin: null })),
    [],
    'un marché sans AUCUNE date rend une liste vide — pas une période bancale d’un jour à aujourd’hui.\n' +
      '« null n’est pas 0 » : une date inventée entrerait dans les calculs de retard et de\n' +
      'chevauchement avec des jours que personne n’a décidés.',
  )

  const seule = P.interventionsDe(marche({ dateFin: null }))
  assert.deepEqual(
    { n: seule.length, debut: seule[0].debut, fin: seule[0].fin },
    { n: 1, debut: '2026-03-02', fin: '2026-03-02' },
    'une seule date connue = une période d’UN jour — « ça commence là, sans durée connue ». Elle reste\n' +
      'visible et déplaçable, donc corrigeable d’un geste ; l’écarter cacherait la saisie à finir.',
  )

  // LE TABLEAU VIDE EST UN CHOIX HUMAIN, PAS UNE ABSENCE.
  const vide = marche({ interventions: [] })
  assert.deepEqual(
    P.interventionsDe(vide),
    [],
    'un tableau de périodes VIDE ne se replie sur rien, alors même que le marché porte encore ses\n' +
      'anciennes dates. Sinon retirer la DERNIÈRE période ferait ressusciter la barre qu’on vient\n' +
      'd’enlever : le geste « retirer » resterait sans effet visible, et on le referait trois fois.',
  )
  assert.equal(
    vide.dateDebut,
    '2026-03-02',
    '… et la lecture n’a pas effacé les dates du marché pour autant : c’est `synchroniserEnveloppe`\n' +
      'qui les remettra d’aplomb à l’écriture, pas l’autorité de lecture',
  )

  const bancal = marche({
    interventions: [{ id: 'sans-date' }, { id: 'datee', debut: '2026-04-01', fin: '2026-04-10' }],
  })
  assert.deepEqual(
    P.interventionsDe(bancal).map((i) => i.id),
    ['datee'],
    'une période sans aucune date EXISTE (un humain l’a ajoutée) mais ne se DESSINE pas : elle n’a pas\n' +
      'de géométrie, et lui en inventer une la ferait juger en retard sur des jours fictifs',
  )

  const desordre = marche({
    interventions: [
      { id: 'juin', debut: '2026-06-01', fin: '2026-06-30' },
      { id: 'fevrier', debut: '2026-02-15', fin: '2026-04-30' },
    ],
  })
  assert.deepEqual(
    P.interventionsDe(desordre).map((i) => i.id),
    ['fevrier', 'juin'],
    'l’ordre rendu est celui du CALENDRIER, jamais celui de la saisie : c’est le réel du chantier qui\n' +
      'commande. Sur une liste ressaisie dans le désordre, l’enveloppe et les barres se liraient de travers.',
  )

  const nommees = P.interventionsDe(
    marche({
      interventions: [
        { id: 'un', debut: '2026-02-15', fin: '2026-04-30', libelle: 'terrassement', confirmeLe: '2026-01-20' },
        { id: 'deux', debut: '2026-06-01', fin: '2026-06-30', libelle: 'reprises' },
      ],
    }),
  )
  assert.deepEqual(
    nommees.map((i) => i.confirmeLe),
    ['2026-01-20', null],
    'la confirmation est portée PAR LA PÉRIODE et ne déteint pas sur la suivante : une entreprise qui a\n' +
      'confirmé en janvier pour février n’a rien dit de son retour de juin. Une confirmation héritée\n' +
      'éteindrait l’alerte du retour — celui que personne n’a en tête.',
  )
  assert.deepEqual(
    nommees.map((i) => i.libelle),
    ['terrassement', 'reprises'],
    'le libellé suit sa période : sans lui, trois rectangles de la même couleur sur la même ligne ne se\n' +
      'distinguent que par leur position',
  )
}

// --- 4. le geste, et la butée qui empêche l'inversion --------------------

{
  const i = { debut: '2026-03-02', fin: '2026-03-20' }

  const deplace = P.appliquerGeste(i, 'deplacer', 7)
  assert.deepEqual(
    { debut: deplace.debut, fin: deplace.fin },
    { debut: '2026-03-09', fin: '2026-03-27' },
    'déplacer conserve la DURÉE : c’est le geste « ce lot glisse d’une semaine », pas « il dure une semaine de plus »',
  )
  assert.equal(deplace.change, true)

  assert.equal(P.appliquerGeste(i, 'deplacer', 0).change, false, 'relâcher au même endroit n’empile pas un « Annuler » pour rien')

  const allonge = P.appliquerGeste(i, 'fin', 5)
  assert.deepEqual({ debut: allonge.debut, fin: allonge.fin }, { debut: '2026-03-02', fin: '2026-03-25' }, 'la poignée de fin n’allonge que la fin')

  // LA BUTÉE : une intervention ne peut pas s'inverser ni devenir vide.
  const trop = P.appliquerGeste(i, 'debut', 60)
  assert.equal(trop.debut, i.fin, 'la poignée de début s’arrête SUR la fin — jamais au-delà')
  assert.equal(trop.bute, true, 'et le geste est signalé « buté » : l’écran le DIT, sinon on croit l’outil bloqué')
  assert.ok(trop.debut <= trop.fin, 'un lot qui finit avant de commencer serait illisible par tout ce qui est en aval')

  const tropFin = P.appliquerGeste(i, 'fin', -60)
  assert.equal(tropFin.fin, i.debut, 'symétrique côté fin')
  assert.equal(tropFin.bute, true)

  assert.equal(P.appliquerGeste(i, 'deplacer', NaN).change, false, 'un glissement non mesurable ne déplace rien')
  assert.equal(P.PAS_SEMAINE, 7, 'le pas clavier « semaine » est l’unité dans laquelle un chantier prend du retard')
}

// --- 5. l'état d'un lot : rien d'inventé ---------------------------------

{
  const taches = [
    { id: 't1', projetId: 'p1', marcheId: 'm1', titre: 'fondations', dureeJours: 10, avancement: 100 },
    { id: 't2', projetId: 'p1', marcheId: 'm1', titre: 'élévations', dureeJours: 10, avancement: 0 },
  ]

  // sans tâche rattachée : on ne sait pas, et on le DIT
  const muet = P.etatLot(marche(), [], [], '2026-04-15')
  assert.equal(muet.avancementPct, null, '« null n’est pas 0 » : un lot sans tâche n’est pas un lot à 0 %')
  assert.equal(muet.ecartPoints, null, 'un écart calculé sur une inconnue serait une opinion, pas un constat')

  // les intempéries REPOUSSENT la date à laquelle l'entreprise est tenue
  const intemperies = [
    { id: 'i1', projetId: 'p1', date: '2026-04-06', motif: 'gel', reconnue: true },
    { id: 'i2', projetId: 'p1', date: '2026-04-07', motif: 'gel', reconnue: true },
  ]
  const sansGel = P.etatLot(marche(), taches, [], '2026-06-05')
  const avecGel = P.etatLot(marche(), taches, intemperies, '2026-06-05')
  assert.ok(
    avecGel.prolongationJours > 0,
    'les intempéries reconnues viennent de `prolongationDelai` (src/penalites.ts) — le MÊME chiffre\n' +
      'qui déduit les jours de retard des pénalités. Deux lectures divergentes, et le planning\n' +
      'excuserait un retard que le décompte facture.',
  )
  assert.ok(
    avecGel.finDefendable > sansGel.finDefendable,
    'la fin DÉFENDABLE recule d’autant : juger sur la fin contractuelle réclamerait des jours que le CCAG accorde',
  )
  assert.ok(avecGel.joursDeRetard < sansGel.joursDeRetard, 'et le retard constaté diminue d’autant')

  // LE DÉCROCHAGE, avec les chiffres posés à la main — un seuil qu'on ne
  // calcule pas est un seuil qu'on croit.
  //
  // Le lot court du 02/03 au 29/05 inclus, soit 89 jours. Les deux tâches
  // rattachées pèsent la même durée et l'une est finie : `avancementLot`
  // rend 50 %.
  //
  //   · au 15/04 : 45 jours écoulés sur 89 = 50,6 %. Écart de 0,6 point —
  //     RIEN À SIGNALER, et c'est voulu : sous le seuil de 15 points, l'écart
  //     relève du grain de la saisie (un avancement se constate à la dizaine,
  //     en réunion). Une alerte ici se lèverait sur presque tous les lots
  //     presque tout le temps, c'est-à-dire sur aucun.
  //   · au 05/05 : 65 jours écoulés = 73 %. Écart de 23 points — DÉCROCHE.
  //
  // C'est la paire qui fait la valeur du test : elle prouve que le seuil
  // sépare vraiment, au lieu de se déclencher toujours ou jamais.
  const calme = P.etatLot(marche(), taches, [], '2026-04-15')
  assert.equal(calme.avancementPct, 50, 'deux tâches de même durée, une finie ⇒ 50 % (avancementLot)')
  assert.equal(
    calme.decroche,
    false,
    'à mi-parcours, 50 % d’avancement pour 50,6 % de délai écoulé ne décroche pas — un seuil qui\n' +
      'crierait ici crierait partout, et plus personne ne le regarderait.',
  )

  const decroche = P.etatLot(marche(), taches, [], '2026-05-05')
  assert.equal(decroche.enRetard, false, 'la fin du 29/05 n’est pas passée : ce n’est pas encore un retard')
  assert.equal(
    decroche.decroche,
    true,
    'mais 50 % d’avancement pour 73 % du délai écoulé DÉCROCHE : c’est le signal qui arrive AVANT\n' +
      'que le retard soit constaté — après, il n’y a plus rien à rattraper.',
  )
  assert.ok(decroche.raisons.length > 0, 'et la phrase à dire en réunion vit dans le calcul, pas à l’écran : elle ne peut pas mentir')

  const receptionne = P.etatLot(marche({ dateReception: '2026-05-20' }), taches, [], '2026-08-01')
  assert.equal(receptionne.enRetard, false, 'un lot réceptionné n’est jamais « en retard » — la réception a soldé la question')
  assert.equal(receptionne.gravite, 0)
}

// --- 6. une entreprise ne peut pas être à deux endroits ------------------

{
  const conflits = P.chevauchementsEntreprise([
    marche({ id: 'a', projetId: 'p1', dateDebut: '2026-03-02', dateFin: '2026-04-30' }),
    marche({ id: 'b', projetId: 'p2', dateDebut: '2026-04-01', dateFin: '2026-05-31' }),
  ])
  assert.equal(conflits.length, 1, 'la MÊME entreprise sur deux chantiers en même temps : le vrai conflit d’une agence multi-opérations')

  assert.deepEqual(
    P.chevauchementsEntreprise([
      marche({ id: 'a', dateDebut: '2026-03-02', dateFin: '2026-03-31' }),
      marche({ id: 'b', projetId: 'p2', dateDebut: '2026-04-01', dateFin: '2026-05-31' }),
    ]),
    [],
    'deux interventions qui se suivent ne se chevauchent pas',
  )

  assert.deepEqual(
    P.chevauchementsEntreprise([
      marche({ id: 'a', dateDebut: '2026-03-02', dateFin: '2026-04-30' }),
      marche({ id: 'b', projetId: 'p2', entreprise: 'Dupont', dateDebut: '2026-04-01', dateFin: '2026-05-31' }),
    ]),
    [],
    'deux entreprises différentes au même moment : c’est le cas NORMAL d’un chantier',
  )

  assert.deepEqual(
    P.chevauchementsEntreprise([
      marche({ id: 'a', dateDebut: '2026-03-02', dateFin: '2026-04-30', dateReception: '2026-04-30' }),
      marche({ id: 'b', projetId: 'p2', dateDebut: '2026-04-01', dateFin: '2026-05-31' }),
    ]),
    [],
    'un lot réceptionné ne mobilise plus personne : le signaler serait du bruit permanent',
  )

  // le rapprochement par NOM, pas seulement par identifiant : le cas le plus
  // fréquent est justement l'entreprise saisie deux fois à la main
  const parNom = P.chevauchementsEntreprise([
    marche({ id: 'a', entreprise: ' martin btp ', entrepriseId: null, dateDebut: '2026-03-02', dateFin: '2026-04-30' }),
    marche({ id: 'b', projetId: 'p2', entreprise: 'Martin BTP', entrepriseId: null, dateDebut: '2026-04-01', dateFin: '2026-05-31' }),
  ])
  assert.equal(parNom.length, 1, 'sans identifiant, le nom plié rapproche quand même — sinon le conflit le plus fréquent passerait inaperçu')
}

// --- 7. L'ENVELOPPE : CE QUE LISENT LES ÉCRANS NON MIGRÉS ---------------
//
// `dateDebut`/`dateFin` ne disparaissent pas — ils deviennent un DÉRIVÉ.
// C'est ce qui permet à la fiche projet, aux filtres, à l'impression, à
// `prolongationDelai` (src/penalites.ts) et au relevé de séance
// (src/seanceChantier.ts) de continuer à dire quelque chose de vrai sans être
// migrés. Une étendue est approximative ; un trou est faux.

{
  const deuxPassages = () =>
    marche({
      // volontairement fausses : on vérifie qu'elles se remettent d'aplomb
      dateDebut: '1999-01-01',
      dateFin: '1999-12-31',
      interventions: [
        { id: 'p2', debut: '2026-06-01', fin: '2026-06-30', libelle: 'reprises' },
        { id: 'p1', debut: '2026-02-15', fin: '2026-04-30', libelle: 'terrassement' },
      ],
    })

  assert.deepEqual(
    P.interventionDe(deuxPassages()),
    { debut: '2026-02-15', fin: '2026-06-30' },
    'l’ENVELOPPE vaut le PREMIER début et la DERNIÈRE fin — et elle se calcule sur les périodes, jamais\n' +
      'sur les deux dates stockées, qui peuvent être en retard d’une saisie',
  )

  // la DERNIÈRE FIN n'est pas la fin de la DERNIÈRE PÉRIODE COMMENCÉE. Deux
  // périodes d'un même lot ont le droit de se recouvrir — un passage court
  // nommé, glissé à l'intérieur d'une présence longue.
  const emboitees = marche({
    interventions: [
      { id: 'longue', debut: '2026-03-01', fin: '2026-09-30', libelle: 'présence continue' },
      { id: 'courte', debut: '2026-05-01', fin: '2026-05-15', libelle: 'pose des menuiseries' },
    ],
  })
  assert.deepEqual(
    P.interventionDe(emboitees),
    { debut: '2026-03-01', fin: '2026-09-30' },
    'la dernière fin est la PLUS TARDIVE, pas celle de la période commencée en dernier. Prendre la fin\n' +
      'du dernier passage raccourcirait l’étendue du lot de quatre mois et demi : la fiche projet et\n' +
      'l’impression le donneraient terminé mi-mai, et le suivi de retard le réclamerait dès le 16.',
  )

  const m = deuxPassages()
  P.synchroniserEnveloppe(m)
  assert.deepEqual(
    { debut: m.dateDebut, fin: m.dateFin },
    { debut: '2026-02-15', fin: '2026-06-30' },
    '`synchroniserEnveloppe` est le SEUL endroit du dépôt où dateDebut/dateFin s’écrivent. Une dizaine\n' +
      'de lecteurs non migrés en dépendent ; désynchronisées, la fiche projet, l’impression, les\n' +
      'filtres et le calcul d’intempéries se tromperaient chacun de leur côté, sans rien dire.',
  )

  const empreinte = JSON.stringify(m)
  P.synchroniserEnveloppe(m)
  P.synchroniserEnveloppe(m)
  assert.equal(
    JSON.stringify(m),
    empreinte,
    'IDEMPOTENT : `migrate()` (src/store.tsx) la rejoue à CHAQUE chargement et sur tout état distant\n' +
      'reçu. Une synchronisation qui dériverait d’un passage à l’autre décalerait le planning d’un cran\n' +
      'par ouverture — sans erreur, et sans que personne ne puisse remonter à la cause.',
  )

  // UN MARCHÉ SANS LISTE DE PÉRIODES N'EST JAMAIS TOUCHÉ. Ses deux dates SONT
  // sa donnée, pas un dérivé. Les trois cas ci-dessous sont ceux où la
  // différence se VOIT : sur un marché aux deux dates propres, recalculer
  // l'enveloppe depuis le repli rendrait exactement les mêmes dates, et la
  // garde passerait inaperçue jusqu'au jour où elle manque.
  const legacy = marche()
  P.synchroniserEnveloppe(legacy)
  assert.deepEqual(
    { debut: legacy.dateDebut, fin: legacy.dateFin },
    { debut: '2026-03-02', fin: '2026-05-29' },
    'un marché non migré aux deux dates propres traverse la synchronisation sans changer',
  )

  const uneSeuleDate = marche({ dateFin: null })
  P.synchroniserEnveloppe(uneSeuleDate)
  assert.equal(
    uneSeuleDate.dateFin,
    null,
    'un marché non migré qui n’a QUE sa date de début la garde seule. Le repli lui dessine une barre\n' +
      'd’un jour — c’est bon pour l’écran — mais l’écrire lui INVENTERAIT une date de fin que personne\n' +
      'n’a décidée, et qui servirait ensuite à le déclarer en retard.',
  )

  const inversees = marche({ dateDebut: '2026-05-29', dateFin: '2026-03-02' })
  P.synchroniserEnveloppe(inversees)
  assert.deepEqual(
    { debut: inversees.dateDebut, fin: inversees.dateFin },
    { debut: '2026-05-29', fin: '2026-03-02' },
    'et une saisie ratée (dates inversées) n’est pas « corrigée » dans le dos de qui l’a faite : le\n' +
      'repli les remet dans l’ordre POUR DESSINER, la donnée reste fausse et visible, et c’est à\n' +
      'l’humain de trancher. C’est ici que se tient « aucune réécriture des données existantes ».',
  )

  const videe = marche({ interventions: [] })
  P.synchroniserEnveloppe(videe)
  assert.deepEqual(
    { debut: videe.dateDebut, fin: videe.dateFin },
    { debut: null, fin: null },
    'retirer la DERNIÈRE période met l’enveloppe à null — pas aux anciennes dates. Les conserver\n' +
      'laisserait la fiche projet et l’impression annoncer à la MOA une intervention que le planning ne\n' +
      'montre plus.',
  )

  // ÉCRIRE : l'enveloppe suit dans la foulée, sans que l'écran ait à y penser
  const ecrit = marche({
    dateDebut: '2026-02-15',
    dateFin: '2026-06-30',
    interventions: [
      { id: 'p1', debut: '2026-02-15', fin: '2026-04-30', confirmeLe: '2026-01-20' },
      { id: 'p2', debut: '2026-06-01', fin: '2026-06-30' },
    ],
  })
  P.appliquerReport(ecrit, { marcheId: 'm1', periodeId: 'p2', debut: '2026-06-15', fin: '2026-07-14' })
  assert.equal(
    ecrit.dateFin,
    '2026-07-14',
    'écrire une période par `appliquerReport` remet l’enveloppe d’aplomb DANS LA FOULÉE : l’écran n’a\n' +
      'jamais à poser dateDebut/dateFin lui-même, et ne peut donc pas oublier de le faire',
  )
  assert.equal(ecrit.dateDebut, '2026-02-15', 'le premier début n’a pas bougé : seule la période visée a été écrite')

  // UN REPORT PÉRIMÉ EST IGNORÉ, PAS APPLIQUÉ DE TRAVERS. Il a été calculé
  // sur un état antérieur à une saisie concurrente (l'autre associée vient
  // d'ajouter une période depuis son téléphone) : l'écrire quand même
  // désynchroniserait l'enveloppe de ses propres périodes.
  const periodique = marche({
    id: 'x',
    dateDebut: '2026-03-01',
    dateFin: '2026-03-31',
    interventions: [{ id: 'k', debut: '2026-03-01', fin: '2026-03-31' }],
  })
  P.appliquerReport(periodique, { marcheId: 'x', periodeId: null, debut: '2030-01-01', fin: '2030-01-31' })
  assert.deepEqual(
    { debut: periodique.dateDebut, fin: periodique.dateFin },
    { debut: '2026-03-01', fin: '2026-03-31' },
    'un report visant l’ENVELOPPE d’un marché devenu périodique est ignoré : appliqué, il poserait une\n' +
      'étendue que plus aucune période ne justifie, et le prochain `synchroniserEnveloppe` l’écraserait\n' +
      'sans prévenir — le geste aurait semblé marcher, puis disparu.',
  )

  const inverse = marche({ id: 'y' })
  P.appliquerReport(inverse, { marcheId: 'y', periodeId: 'inconnue', debut: '2030-01-01', fin: '2030-01-31' })
  assert.deepEqual(
    { debut: inverse.dateDebut, fin: inverse.dateFin, periodes: inverse.interventions },
    { debut: '2026-03-02', fin: '2026-05-29', periodes: undefined },
    'et symétriquement : un report visant une PÉRIODE d’un marché qui n’en a pas ne lui en fabrique\n' +
      'aucune — un geste de planning ne migre pas un marché à l’insu de qui l’a fait',
  )

  const etranger = marche({ id: 'z' })
  P.appliquerReport(etranger, { marcheId: 'autre', periodeId: null, debut: '2030-01-01', fin: '2030-01-31' })
  assert.equal(etranger.dateDebut, '2026-03-02', 'un report ne s’applique jamais à un autre marché que celui qu’il nomme')

  // L'AMORCE NE SE CONTREDIT PAS ELLE-MÊME. Une installation neuve rend
  // `seedState()` TEL QUEL (src/store.tsx) : elle ne passe pas par
  // `migrate()`, donc jamais par `normaliserMarche` ni par
  // `synchroniserEnveloppe`. Rien ne rattraperait donc une période modifiée
  // dans src/seed.ts dont on aurait oublié de reporter la date sur
  // l'enveloppe — et c'est l'enveloppe que lit la fiche projet.
  for (const m of S.seedState().marches) {
    const env = P.interventionDe(m)
    assert.deepEqual(
      { debut: m.dateDebut ?? null, fin: m.dateFin ?? null },
      { debut: env ? env.debut : null, fin: env ? env.fin : null },
      `amorce ${m.id} : son enveloppe contredit ses propres périodes. Une installation neuve affiche\n` +
        'seedState() sans le filet de `migrate()` : les barres du Gantt et l’étendue annoncée par la\n' +
        'fiche projet montreraient deux chantiers différents, dès la première ouverture.',
    )
  }
}

// --- 8. LE CHEVAUCHEMENT NE SE SIGNALE PLUS LUI-MÊME --------------------
//
// C'est la correction la plus urgente du lot : sans elle, TOUT lot en
// plusieurs passages entrerait en conflit avec lui-même dès sa saisie.

{
  const soi = marche({
    id: 'soi',
    interventions: [
      // volontairement CHEVAUCHANTES : même là, un lot ne se dédouble pas
      { id: 's1', debut: '2026-03-01', fin: '2026-04-30' },
      { id: 's2', debut: '2026-04-01', fin: '2026-05-31' },
    ],
  })
  assert.deepEqual(
    P.chevauchementsEntreprise([soi]),
    [],
    'deux périodes du MÊME marché ne sont JAMAIS un conflit, même quand elles se recouvrent. Sinon le\n' +
      'gros œuvre serait signalé « attendu à deux endroits à la fois », les deux endroits étant son\n' +
      'propre chantier — et l’alerte deviendrait en une semaine du bruit qu’on apprend à ignorer,\n' +
      'emportant avec elle les vrais conflits qu’elle existe pour montrer.',
  )

  // LA PRÉCISION GAGNÉE : deux enveloppes qui se croisent sans qu'aucune
  // période ne se croise ne crient plus.
  const A = marche({
    id: 'a',
    projetId: 'p1',
    interventions: [
      { id: 'a1', debut: '2026-03-01', fin: '2026-03-31' },
      { id: 'a2', debut: '2026-07-01', fin: '2026-07-31' },
    ],
  })
  const B = marche({ id: 'b', projetId: 'p2', interventions: [{ id: 'b1', debut: '2026-05-01', fin: '2026-05-31' }] })
  assert.ok(
    P.periodeCommune(P.interventionDe(A), P.interventionDe(B)) !== null,
    'préalable du test : à l’échelle de l’ENVELOPPE, ces deux lots se croisent bel et bien en mai —\n' +
      'c’est exactement ce que l’ancienne lecture voyait',
  )
  assert.deepEqual(
    P.chevauchementsEntreprise([A, B]),
    [],
    '… et pourtant AUCUN conflit : en mai, l’entreprise n’est sur aucun des deux chantiers. Comparer\n' +
      'les enveloppes lèverait ici un faux positif permanent sur tout lot qui revient.',
  )

  // LE CONFLIT RESTE, ET IL DÉSIGNE LA BARRE FAUTIVE.
  const trois = marche({
    id: 'a',
    projetId: 'p1',
    interventions: [
      { id: 'a1', debut: '2026-03-01', fin: '2026-03-31', libelle: 'terrassement' },
      { id: 'a2', debut: '2026-07-01', fin: '2026-07-31', libelle: 'reprises' },
      { id: 'a3', debut: '2026-10-01', fin: '2026-10-31', libelle: 'finitions' },
    ],
  })
  const autre = marche({
    id: 'b',
    projetId: 'p2',
    interventions: [{ id: 'b1', debut: '2026-07-20', fin: '2026-08-10', libelle: 'gros œuvre P2' }],
  })
  const conflits = P.chevauchementsEntreprise([trois, autre])
  assert.equal(
    conflits.length,
    1,
    'deux marchés DIFFÉRENTS de la même entreprise dont deux périodes se recouvrent : le conflit dur,\n' +
      'toujours signalé — une entreprise ne se dédouble pas',
  )
  assert.deepEqual(
    { a: conflits[0].aPeriodeId, b: conflits[0].bPeriodeId, lib: conflits[0].aLibelle },
    { a: 'a2', b: 'b1', lib: 'reprises' },
    'le conflit nomme les PÉRIODES en cause. Sans elles, deux lots en trois passages produiraient des\n' +
      'lignes indiscernables et on ne saurait pas lequel des retours pose problème.',
  )
  assert.deepEqual(
    { debut: conflits[0].debut, fin: conflits[0].fin, jours: conflits[0].jours, memeChantier: conflits[0].memeChantier },
    { debut: '2026-07-20', fin: '2026-07-31', jours: 12, memeChantier: false },
    'la période commune est celle des deux PÉRIODES, pas des deux enveloppes : douze jours à arbitrer,\n' +
      'pas cinq mois de conflit imaginaire',
  )

  const cles = P.periodesEnConflit(conflits)
  assert.deepEqual(
    [...cles].sort(),
    ['a|a2', 'b|b1'],
    'le marquage se fait à la maille de la BARRE : signaler les trois passages du lot parce que le\n' +
      'second croise un autre chantier accuserait deux interventions parfaitement en règle',
  )
  assert.equal(cles.has(P.clePeriode('a', 'a1')), false, 'le terrassement de mars n’est pas marqué')
  assert.equal(cles.has(P.clePeriode('a', 'a3')), false, 'les finitions d’octobre non plus')
  assert.equal(
    P.clePeriode('a', null),
    'a|enveloppe',
    'un marché non migré a une clé stable lui aussi — sinon son marquage sauterait d’un rendu à l’autre',
  )
}

// --- 9. LE GESTE PORTE SUR UNE PÉRIODE, PAS SUR LE MARCHÉ ---------------

{
  const lots = () => [
    marche({
      id: 'm1',
      projetId: 'p1',
      dateDebut: '2026-02-15',
      dateFin: '2026-06-30',
      interventions: [
        { id: 'p1', debut: '2026-02-15', fin: '2026-04-30', libelle: 'terrassement', confirmeLe: '2026-01-20' },
        { id: 'p2', debut: '2026-06-01', fin: '2026-06-30', libelle: 'reprises' },
      ],
    }),
    marche({
      id: 'm2',
      projetId: 'p1',
      entreprise: 'Charpentes Leroy',
      dateDebut: '2026-07-01',
      dateFin: '2026-09-15',
      interventions: [
        { id: 'q1', debut: '2026-07-01', fin: '2026-08-15' },
        { id: 'q2', debut: '2026-09-01', fin: '2026-09-15' },
      ],
    }),
  ]

  const geste = P.appliquerGeste({ debut: '2026-06-01', fin: '2026-06-30' }, 'deplacer', 14)

  const seul = P.reportsDuGeste(lots(), 'm1', 'p2', 'deplacer', geste, false)
  assert.deepEqual(
    seul,
    [{ marcheId: 'm1', periodeId: 'p2', debut: '2026-06-15', fin: '2026-07-14' }],
    'pousser les reprises de juin produit UN report, sur la période visée. Un report par marché\n' +
      'réécrirait aussi le terrassement de février — un passage terminé, confirmé, et dont les dates\n' +
      'sont celles du CR de chantier.',
  )

  const applique = lots()
  P.appliquerReport(applique[0], seul[0])
  assert.deepEqual(
    applique[0].interventions[0],
    { id: 'p1', debut: '2026-02-15', fin: '2026-04-30', libelle: 'terrassement', confirmeLe: '2026-01-20' },
    'après écriture, la PREMIÈRE période est intacte — dates, libellé ET confirmation. Déplacer un\n' +
      'retour ne doit pas effacer le « oui » obtenu au téléphone en janvier pour le passage de février.',
  )
  assert.deepEqual(
    { debut: applique[0].dateDebut, fin: applique[0].dateFin },
    { debut: '2026-02-15', fin: '2026-07-14' },
    'et l’enveloppe a suivi le geste, elle seule',
  )

  const propage = P.reportsDuGeste(lots(), 'm1', 'p2', 'deplacer', geste, true)
  assert.deepEqual(
    propage.map((r) => `${r.marcheId}/${r.periodeId}`),
    ['m1/p2', 'm2/q1', 'm2/q2'],
    'PROPAGATION COCHÉE : les lots suivants du même chantier glissent, mais les AUTRES périodes du lot\n' +
      'déplacé ne bougent toujours pas. C’est la version dangereuse du défaut n°9 : la case cochée est\n' +
      'justement celle qu’on coche quand un chantier prend du retard.',
  )
  assert.deepEqual(
    propage.slice(1),
    [
      { marcheId: 'm2', periodeId: 'q1', debut: '2026-07-15', fin: '2026-08-29' },
      { marcheId: 'm2', periodeId: 'q2', debut: '2026-09-15', fin: '2026-09-29' },
    ],
    'un lot suivant glisse EN ENTIER, toutes ses périodes du même nombre de jours : n’en décaler qu’une\n' +
      'refermerait ou creuserait ses propres trous, que personne n’a demandé à toucher',
  )

  const bord = P.appliquerGeste({ debut: '2026-06-01', fin: '2026-06-30' }, 'fin', 10)
  assert.deepEqual(
    P.reportsDuGeste(lots(), 'm1', 'p2', 'fin', bord, true).map((r) => r.marcheId),
    ['m1'],
    'une POIGNÉE DE BORD ne propage rien, même case cochée : allonger un retour de dix jours ne repousse\n' +
      'pas mécaniquement le reste du chantier — un chevauchement peut être exactement ce qu’on veut voir.',
  )
  const bordDebut = P.appliquerGeste({ debut: '2026-06-01', fin: '2026-06-30' }, 'debut', -7)
  assert.deepEqual(
    P.reportsDuGeste(lots(), 'm1', 'p2', 'debut', bordDebut, true).map((r) => `${r.marcheId}/${r.periodeId}`),
    ['m1/p2'],
    'et la poignée de DÉBUT non plus, alors qu’elle change bien la date de début : c’est le seul bord\n' +
      'où la confusion est possible, puisque la propagation se mesure justement sur le décalage du\n' +
      'début. Faire venir l’entreprise une semaine plus tôt AGRANDIT son passage — cela ne réordonne\n' +
      'pas le chantier, et ne doit tirer aucun lot suivant en arrière.',
  )

  assert.deepEqual(
    P.reportsDuGeste(lots(), 'm1', 'inconnue', 'deplacer', geste, true),
    [],
    'un geste visant une période disparue entre-temps ne produit RIEN plutôt qu’un report au hasard',
  )
  assert.deepEqual(
    P.reportsDuGeste(lots(), 'm1', null, 'deplacer', geste, true),
    [],
    'et un geste visant l’enveloppe d’un marché périodique non plus : les deux dates sont un dérivé,\n' +
      'les écrire directement les mettrait en contradiction avec les barres affichées',
  )

  // le marché non migré, lui, se conduit toujours par son enveloppe
  const ancien = [marche({ id: 'L' })]
  const gAncien = P.appliquerGeste({ debut: '2026-03-02', fin: '2026-05-29' }, 'deplacer', 7)
  const rAncien = P.reportsDuGeste(ancien, 'L', null, 'deplacer', gAncien, false)
  assert.deepEqual(
    rAncien,
    [{ marcheId: 'L', periodeId: null, debut: '2026-03-09', fin: '2026-06-05' }],
    'un marché non migré reste entièrement manipulable au Gantt par son enveloppe : exiger des périodes\n' +
      'pour bouger une barre rendrait le planning existant en lecture seule du jour au lendemain',
  )
  P.appliquerReport(ancien[0], rAncien[0])
  assert.equal(ancien[0].interventions, undefined, '… et le geste ne lui fabrique toujours aucune période')
}

// --- 10. LE RETARD SE JUGE SUR LA DERNIÈRE FIN DÉFENDABLE ---------------

{
  // le cas emblématique du seed : le gros œuvre revient après le clos-couvert
  const lot = marche({
    dateDebut: '2026-02-15',
    dateFin: '2026-06-30',
    interventions: [
      { id: 'p1', debut: '2026-02-15', fin: '2026-04-30', libelle: 'terrassement & élévations' },
      { id: 'p2', debut: '2026-06-01', fin: '2026-06-30', libelle: 'reprises après clos-couvert' },
    ],
  })

  const dansLeTrou = P.etatLot(lot, [], [], '2026-05-15')
  assert.equal(
    dansLeTrou.enRetard,
    false,
    'le 15 mai, l’entreprise n’est PAS sur le chantier et c’est prévu : son premier passage est fini,\n' +
      'son retour est en juin. Juger sur la fin de la première période la déclarerait en retard de\n' +
      'quinze jours — et l’agence relancerait une entreprise parfaitement à l’heure.',
  )
  assert.deepEqual(
    dansLeTrou.intervention,
    { debut: '2026-02-15', fin: '2026-06-30' },
    'l’étendue du lot va du PREMIER début à la DERNIÈRE fin : c’est le délai contractuel du CCAP',
  )
  assert.equal(
    dansLeTrou.interventions.length,
    2,
    'et `etatLot` rend les périodes elles-mêmes : l’écran les reçoit ici plutôt que de rappeler\n' +
      'l’autorité — deux lectures du même lot dans le même rendu finiraient par diverger',
  )
  assert.equal(
    dansLeTrou.tempsEcoulePct,
    66.2,
    'le délai écoulé se compte SUR L’ÉTENDUE (90 j sur 136), pas sur la somme des périodes (75 j sur\n' +
      '105 = 71,4 %). C’est délibéré : le délai du CCAP court en jours calendaires, et ne compter que\n' +
      'les passages ferait paraître à l’heure un lot qui a laissé filer trois semaines entre deux venues.',
  )
  assert.ok(
    dansLeTrou.raisons.some((r) => r.includes('2 interventions au planning')),
    'la phrase à dire en réunion énumère les passages : sans elle, l’étendue affichée ailleurs (fiche\n' +
      'projet, impression, filtres) recouvre un trou qui est voulu, et rien ne le dit à voix haute',
  )

  const apres = P.etatLot(lot, [], [], '2026-07-05')
  assert.equal(apres.enRetard, true, 'passé la DERNIÈRE fin, en revanche, le lot est bien en retard — la question n’est que repoussée')
  assert.equal(apres.joursDeRetard, 5, 'et le retard se compte depuis la dernière fin défendable (30/06), pas depuis la première (30/04)')
  assert.equal(apres.gravite, 2)

  // et la fin DÉFENDABLE recule toujours des intempéries reconnues, sur la
  // dernière fin — l'autorité reste `prolongationDelai` (src/penalites.ts)
  const gel = [
    { id: 'i1', projetId: 'p1', date: '2026-06-08', motif: 'gel', reconnue: true },
    { id: 'i2', projetId: 'p1', date: '2026-06-09', motif: 'gel', reconnue: true },
  ]
  const avecGel = P.etatLot(lot, [], gel, '2026-07-02')
  assert.equal(
    avecGel.finDefendable,
    '2026-07-02',
    'deux jours d’intempéries reconnues repoussent la fin défendable au 02/07 — depuis la DERNIÈRE fin\n' +
      'du lot. Les appliquer à la première rendrait la prolongation invisible au planning tout en\n' +
      'restant due au décompte.',
  )
  assert.equal(avecGel.enRetard, false, 'ce jour-là, l’entreprise est donc encore dans son délai — le même chiffre que celui des pénalités')
}

// --- 11. LA CONFIRMATION SE REDEMANDE À CHAQUE RETOUR -------------------
//
// 5.7 posait la question un mois avant l'intervention. 5.23 la pose avant
// CHAQUE période : c'est précisément quand une entreprise revient qu'on oublie
// de la confirmer, et une entreprise qui découvre sa date deux semaines avant
// ne vient pas.

{
  const AUJOURDHUI = '2026-08-07'
  const SEUIL = C.SEUIL_CONFIRMATION_JOURS
  const avec = (periodes, over = {}) => marche({ interventions: periodes, ...over })

  const retour = avec([
    { id: 'p1', debut: '2026-02-15', fin: '2026-04-30', confirmeLe: '2026-01-20' },
    { id: 'p2', debut: U.addDays(AUJOURDHUI, 22), fin: U.addDays(AUJOURDHUI, 40), libelle: 'reprises' },
  ])
  const dus = P.periodesAConfirmer(retour, AUJOURDHUI)
  assert.deepEqual(
    dus.map((x) => [x.periode.id, x.jours]),
    [['p2', 22]],
    'le passage de février est confirmé, celui de juin ne l’est pas : c’est LUI qui alerte, à J−22. La\n' +
      'confirmation du premier passage ne vaut pas pour le second — c’est tout l’objet du champ\n' +
      '`confirmeLe` porté par la période plutôt que par le marché.',
  )
  assert.deepEqual(
    { lot: dus[0].lot, entreprise: dus[0].entreprise, projetId: dus[0].projetId, marcheId: dus[0].marcheId },
    { lot: 'Gros œuvre', entreprise: 'Martin BTP', projetId: 'p1', marcheId: 'm1' },
    'et l’alerte sait QUI relancer et OÙ : sans le lot ni le projet, la ligne serait illisible dans un\n' +
      'fil d’urgences qui mélange plusieurs chantiers',
  )

  assert.deepEqual(
    P.periodesAConfirmer(
      avec([{ id: 'p1', debut: U.addDays(AUJOURDHUI, SEUIL), fin: U.addDays(AUJOURDHUI, SEUIL + 10) }]),
      AUJOURDHUI,
    ).length,
    1,
    `la borne est INCLUSE : à J−${SEUIL} pile, on alerte`,
  )
  assert.deepEqual(
    P.periodesAConfirmer(
      avec([{ id: 'p1', debut: U.addDays(AUJOURDHUI, SEUIL + 1), fin: U.addDays(AUJOURDHUI, SEUIL + 10) }]),
      AUJOURDHUI,
    ),
    [],
    'un jour plus tôt, rien : relancer six semaines avant, c’est relancer pour rien, et une alerte qui\n' +
      'traîne un mois de trop devient un meuble',
  )
  assert.deepEqual(
    P.periodesAConfirmer(avec([{ id: 'p1', debut: U.addDays(AUJOURDHUI, -2), fin: U.addDays(AUJOURDHUI, 10) }]), AUJOURDHUI),
    [],
    'une date de début PASSÉE ne se confirme plus : la question n’a plus d’objet, c’est le suivi de\n' +
      'retard qui prend le relais',
  )
  assert.deepEqual(
    P.periodesAConfirmer(avec([{ id: 'p1', debut: U.addDays(AUJOURDHUI, 10), fin: null }], { actif: false }), AUJOURDHUI),
    [],
    'marché inactif : relancer l’entreprise d’un lot soldé serait du bruit',
  )
  assert.deepEqual(
    P.periodesAConfirmer(
      avec([{ id: 'p1', debut: U.addDays(AUJOURDHUI, 10), fin: null }], { dateReception: '2026-07-01' }),
      AUJOURDHUI,
    ),
    [],
    'réception prononcée : la question est soldée',
  )

  const ancien = P.periodesAConfirmer(
    marche({ dateDebut: U.addDays(AUJOURDHUI, 10), dateFin: U.addDays(AUJOURDHUI, 20) }),
    AUJOURDHUI,
  )
  assert.deepEqual(
    ancien.map((x) => x.periode.id),
    [null],
    'un marché non migré alerte lui aussi — par son repli — et `periode.id` vaut null : le producteur\n' +
      'd’alertes saura qu’il n’y a nulle part où inscrire la confirmation, et proposera la saisie des\n' +
      'périodes plutôt qu’un bouton qui n’écrirait rien.',
  )
}

// --- 11 bis. LA PORTE : le producteur est-il seulement APPELÉ ? ----------
//
// `periodesAConfirmer` a été livré complet, testé sur douze cas ci-dessus…
// et importé par personne. L'alerte à M−1 par période n'existait donc pas à
// l'écran : le calcul était juste, il ne servait à rien. C'est le motif de
// panne dominant de ce dépôt — du code livré SANS PORTE — et les assertions
// de la section 11 seraient toutes restées vertes.
//
// Ce contrôle-ci ferme cela : il ne juge pas la qualité du branchement (une
// analyse statique ne le peut pas), il exige seulement qu'une porte EXISTE,
// et il tombe le jour où quelqu'un la retire.

{
  const alertes = lire('src/alerts.ts')
  assert.match(
    alertes,
    /import \{ periodesAConfirmer \} from '\.\/planningTravaux'/,
    'src/alerts.ts doit IMPORTER `periodesAConfirmer` : sans appelant, l’alerte de confirmation\n' +
      'par période n’existe pas à l’écran, quelle que soit la justesse du calcul.',
  )
  assert.match(alertes, /periodesAConfirmer\(/, '… et l’APPELER, pas seulement l’importer')
  assert.match(
    alertes,
    /confirme-periode:/,
    'l’identifiant de l’alerte porte la période : deux passages du même marché sont deux alertes,\n' +
      'et confirmer février ne doit pas éteindre juin.',
  )

  // le geste proposé doit avoir un exécutant, sinon le bouton ment
  const cockpit = lire('src/modules/Cockpit.tsx')
  assert.match(
    cockpit,
    /action\.kind === 'confirmer_periode'/,
    'l’accueil propose « ✓ Confirmé » sur cette alerte : il doit savoir l’exécuter.\n' +
      'Un geste offert sans exécutant est pire qu’un geste absent — on croit avoir confirmé.',
  )
  assert.match(
    cockpit,
    /interventions\?\.find\(\(x\) => x\.id === action\.periodeId\)/,
    'et il écrit sur LA PÉRIODE visée : confirmer le mauvais passage ferait croire le retour couvert.',
  )
}

// --- 12. les autorités sont importées, pas recopiées ---------------------

{
  const source = lire('src/planningTravaux.ts')
  assert.match(source, /import \{ avancementLot \} from '\.\/chantier'/, 'l’avancement vient de src/chantier.ts')
  assert.match(source, /import \{ prolongationDelai \} from '\.\/penalites'/, 'les intempéries viennent de src/penalites.ts')
  assert.doesNotMatch(
    source,
    /function\s+avancementLot|function\s+prolongationDelai/,
    'AUCUNE seconde version de ces deux calculs ici : un Gantt qui recalculerait l’avancement\n' +
      'afficherait un pourcentage différent de celui annoncé en réunion de chantier.',
  )
  assert.doesNotMatch(
    source,
    /useStore|localStorage|fetch\(|Date\.now\(|new Date\(\)/,
    'module PUR : ni état, ni réseau, ni horloge implicite — `today` est un argument, sinon\n' +
      'rien de ce qui précède ne serait vérifiable.',
  )

  assert.match(
    source,
    /import \{ SEUIL_CONFIRMATION_JOURS \} from '\.\/chantier'/,
    'le seuil de confirmation est IMPORTÉ de src/chantier.ts — c’est le même mois que celui qui régit\n' +
      'la confirmation des tâches de chantier (5.7), et deux seuils qui divergeraient donneraient deux\n' +
      'réponses à la même question, sur le même écran',
  )
  assert.doesNotMatch(
    source,
    /(const|let)\s+SEUIL_CONFIRMATION_JOURS/,
    'et il n’en existe AUCUNE seconde définition ici : une constante recopiée survit à la modification\n' +
      'de l’originale, silencieusement',
  )
  // les commentaires du module CITENT le seuil : les compter reviendrait à
  // se satisfaire d'une bonne intention écrite au-dessus d'un nombre en dur
  const codeSeul = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  assert.ok(
    (codeSeul.match(/SEUIL_CONFIRMATION_JOURS/g) || []).length >= 2,
    'importé ET UTILISÉ DANS LE CODE — au moins une fois en plus de la ligne d’import. Un import laissé\n' +
      'en place au-dessus d’un « 30 » écrit en dur passerait toutes les vérifications de forme, et le\n' +
      'seuil resterait figé le jour où src/chantier.ts le change : deux réponses à la même question,\n' +
      'sur le même écran, sans que rien ne le signale.',
  )

  const ecran = lire('src/modules/Planning.tsx')
  assert.match(ecran, /planningTravaux/, 'l’écran consomme le module pur au lieu de refaire sa géométrie')
  assert.doesNotMatch(
    ecran,
    /\.date(Debut|Fin)\s*=[^=]/,
    'l’écran ne pose JAMAIS dateDebut/dateFin à la main : tout passe par `appliquerReport`, qui remet\n' +
      'l’enveloppe d’aplomb. Une écriture directe ici désynchroniserait l’enveloppe de ses périodes sans\n' +
      'la moindre erreur — et c’est l’enveloppe que lisent la fiche projet, l’impression, les filtres et\n' +
      'le calcul d’intempéries.',
  )
  assert.match(
    ecran,
    /reportsDuGeste\([\s\S]{0,200}periodeId/,
    'et le geste du Gantt nomme la PÉRIODE qu’il vise : sans elle, déplacer la barre de juin\n' +
      'réécrirait aussi celle de février',
  )

  const saisie = lire('src/modules/ProjetChantier.tsx')
  assert.doesNotMatch(
    saisie,
    /\.date(Debut|Fin)\s*=[^=]/,
    'la saisie du marché non plus : elle compose son enveloppe par `interventionDe`, l’autorité, plutôt\n' +
      'que de refaire un min/max à la main — deux calculs d’enveloppe finiraient par se contredire',
  )
}

console.log(
  'Planning travaux : la fenêtre s’aligne (‹ › revient au même endroit), la géométrie est réversible ' +
    '(un glissement de N px rend N jours), une intervention ne peut ni s’inverser ni devenir vide, ' +
    'les intempéries repoussent la fin DÉFENDABLE par `prolongationDelai`, l’avancement absent reste null ' +
    'et le décrochage se voit avant l’échéance — et une même entreprise sur deux chantiers à la fois est détectée.\n' +
    '5.23 — un marché ancien rend EXACTEMENT une période (rien ne disparaît de l’écran) et un tableau vide ' +
    'ne ressuscite rien ; l’enveloppe vaut premier début → dernière fin, s’écrit par le seul ' +
    '`synchroniserEnveloppe`, est idempotente et ne touche jamais un marché non migré ; un lot ne se ' +
    'chevauche JAMAIS lui-même et le conflit désigne la barre fautive ; le geste porte sur UNE période ' +
    '(propagation comprise) ; le retard se juge sur la DERNIÈRE fin défendable ; et la confirmation se ' +
    'redemande à chaque retour, au seuil IMPORTÉ de src/chantier.ts.',
)
