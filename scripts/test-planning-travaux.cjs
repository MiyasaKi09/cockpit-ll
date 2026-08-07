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

// --- 3. le geste, et la butée qui empêche l'inversion --------------------

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

// --- 4. l'état d'un lot : rien d'inventé ---------------------------------

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

// --- 5. une entreprise ne peut pas être à deux endroits ------------------

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

// --- 6. les autorités sont importées, pas recopiées ----------------------

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

  const ecran = lire('src/modules/Planning.tsx')
  assert.match(ecran, /planningTravaux/, 'l’écran consomme le module pur au lieu de refaire sa géométrie')
}

console.log(
  'Planning travaux : la fenêtre s’aligne (‹ › revient au même endroit), la géométrie est réversible ' +
    '(un glissement de N px rend N jours), une intervention ne peut ni s’inverser ni devenir vide, ' +
    'les intempéries repoussent la fin DÉFENDABLE par `prolongationDelai`, l’avancement absent reste null ' +
    'et le décrochage se voit avant l’échéance — et une même entreprise sur deux chantiers à la fois est détectée.',
)
