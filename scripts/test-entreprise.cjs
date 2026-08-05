// 5.20 — la fiche entreprise transverse (complément du 04/08/2026 au Lot 5).
//
// « Où en est-on avec HORIZONS ? » demandait six écrans. La fiche les
// rassemble EN LECTURE : l'agrégat pur `syntheseEntreprise` réutilise les
// fonctions qui font déjà autorité et n'en réécrit aucune — un agrégat qui
// recalculerait ferait deux vérités pour le même marché.
//
// Cinq choses tenues ici :
//
//   1. la synthèse, calculée À LA MAIN sur un état à deux entreprises et
//      deux projets : totaux RG (retenue / à libérer), dernier certificat,
//      pénalités intempéries déduites, désordres du BON titulaire ;
//   2. le rapprochement : entrepriseId d'abord, nom en repli (casse et
//      espaces de bord tolérés — la règle `fold` du registre) ;
//   3. UN critère « situation attendue » : celui du fil d'urgences, extrait
//      dans src/entreprise.ts et consommé par alerts.ts ET par la fiche —
//      le même jour, les deux disent la même chose ;
//   4. le module reste PUR et la fiche reste en LECTURE : l'écran
//      FicheEntreprise n'appelle pas la fonction d'écriture du store —
//      seuls la navigation et le brouillon Gmail sont permis (§15) ;
//   5. la réutilisation se PROUVE sur les imports : RG via derive,
//      pénalités via penalites, GPA via gpa, visas via visas — et aucune
//      re-dérivation locale de ces règles.

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

const E = charger('src/entreprise.ts')
const { computeAlertes } = charger('src/alerts.ts')

// le 15 du mois : la situation d'août est attendue (≥ 10), pas encore urgente (< 20)
const AUJOURDHUI = '2026-08-15'

// L'état minimal : les collections lues dans AppState plutôt que recopiées —
// une collection ajoutée demain ne doit pas faire échouer ce test sur un
// `undefined` qui n'est pas son sujet (même méthode que test-alerte-entreprise).
const COLLECTIONS = (() => {
  const types = lire('src/types.ts')
  const debut = types.indexOf('export interface AppState')
  const bloc = types.slice(debut, types.indexOf('\n}', debut))
  return [...bloc.matchAll(/^  ([a-zA-Z_]+)\??:\s*[A-Za-z]+\[\]/gm)].map((m) => m[1])
})()
assert.ok(COLLECTIONS.includes('certificats'), 'AppState doit porter les certificats (5.19) — la fiche les lit')

const etat = (over = {}) => {
  const vide = {}
  for (const c of COLLECTIONS) vide[c] = []
  return {
    version: 20,
    ...vide,
    settings: { snoozes: {}, vus: {}, personnes: ['Julien'], equipe: [], nomAgence: 'Atelier L&L', ...(over.settings || {}) },
    ...over,
  }
}

// ------------------------------------------------------------------
// Le jeu d'essai : deux entreprises, deux projets
// ------------------------------------------------------------------
//
// HORIZONS BTP : m1 (P01, ACTIF, RG en cours, pénalité encourue, visa à
// viser, deux certificats émis, situation d'août MANQUANTE) et m2 (P02,
// inactif, rattaché par le NOM seul, GPA échue → RG à libérer, un désordre
// ouvert). Menuiserie Dubois : m3 (P01, actif, situation d'août reçue SANS
// marcheId — le rapprochement par nom du critère partagé), un désordre à
// elle, un visa à elle, une pénalité appliquée à elle.

const S = etat({
  projets: [
    { id: 'P01', nom: 'École de Naours', statut: 'En cours', phases: [] },
    { id: 'P02', nom: 'Halle de Corbie', statut: 'En cours', phases: [] },
  ],
  entreprises: [
    {
      id: 'ent-horizons',
      raisonSociale: 'HORIZONS BTP',
      domaines: [],
      lots: [],
      contactNom: 'M. Horizon',
      contactEmail: 'contact@horizons.example',
    },
    { id: 'ent-dubois', raisonSociale: 'Menuiserie Dubois', domaines: [], lots: [] },
  ],
  marches: [
    {
      id: 'm1',
      projetId: 'P01',
      entreprise: 'HORIZONS BTP',
      entrepriseId: 'ent-horizons',
      lot: 'Lot 01 — Gros œuvre',
      montantInitialHT: 100000,
      avenantsHT: 5000,
      tauxRG: 0.05,
      revision: false,
      delaiVerifJours: 15,
      actif: true,
      dateDebut: '2026-03-02',
      dateFin: '2026-10-30',
      contactNom: 'M. Horizon',
      contactEmail: 'chantier@horizons.example',
      penalites: { retardParJourHT: 100 },
    },
    {
      // rattaché par le NOM seul (casse différente, pas d'entrepriseId) :
      // un marché saisi avant l'amorce du registre ne doit pas disparaître
      id: 'm2',
      projetId: 'P02',
      entreprise: 'Horizons btp',
      entrepriseId: null,
      lot: 'Lot 02 — Charpente',
      montantInitialHT: 50000,
      avenantsHT: 0,
      tauxRG: 0.05,
      revision: false,
      delaiVerifJours: 15,
      actif: false,
      dateReception: '2025-06-01', // GPA finie le 2026-06-01 → RG à libérer
    },
    {
      id: 'm3',
      projetId: 'P01',
      entreprise: 'Menuiserie Dubois',
      entrepriseId: 'ent-dubois',
      lot: 'Lot 08 — Menuiseries',
      montantInitialHT: 40000,
      avenantsHT: 0,
      tauxRG: 0.05,
      revision: false,
      delaiVerifJours: 15,
      actif: true,
    },
  ],
  situations: [
    { id: 's1', projetId: 'P01', marcheId: 'm1', entreprise: 'HORIZONS BTP', mois: '2026-06', montantMoisHT: 25000, montantCumulHT: 25000, statut: 'validee', dateReception: '2026-07-02' },
    { id: 's2', projetId: 'P01', marcheId: 'm1', entreprise: 'HORIZONS BTP', mois: '2026-07', montantMoisHT: 35000, montantCumulHT: 60000, statut: 'validee', dateReception: '2026-08-03' },
    { id: 's3', projetId: 'P02', marcheId: 'm2', entreprise: 'Horizons btp', mois: '2025-05', montantMoisHT: 50000, montantCumulHT: 50000, statut: 'validee', dateReception: '2025-06-02' },
    // la situation d'août de Dubois arrive SANS marcheId (routine) : le
    // critère partagé la rattache par (projet + nom plié) — l'alerte se tait
    { id: 's4', projetId: 'P01', marcheId: null, entreprise: 'menuiserie DUBOIS', mois: '2026-08', montantMoisHT: 8000, statut: 'a_verifier', dateReception: '2026-08-12' },
  ],
  certificats: [
    { id: 'c1', marcheId: 'm1', projetId: 'P01', situationId: 's1', numero: 1, mois: '2026-06', netAPayerTTC: 28500, emisLe: '2026-07-05', emisPar: 'Julien' },
    { id: 'c2', marcheId: 'm1', projetId: 'P01', situationId: 's2', numero: 2, mois: '2026-07', netAPayerTTC: 39900, emisLe: '2026-08-06', emisPar: 'Julien' },
  ],
  evenementsMarche: [
    { id: 'e1', marcheId: 'm1', projetId: 'P01', type: 'retard_execution', date: '2026-08-10', jours: 10, commentaire: '', penaliteAppliquee: false },
    { id: 'e2', marcheId: 'm3', projetId: 'P01', type: 'absence_reunion', date: '2026-07-21', commentaire: '', penaliteAppliquee: true, penaliteMontantHT: 250, decidePar: 'Julien', decideLe: '2026-07-22' },
  ],
  intemperies: [
    { id: 'i1', projetId: 'P01', date: '2026-08-03', nature: 'pluie', commentaire: 'CR n° 12' }, // lundi
    { id: 'i2', projetId: 'P01', date: '2026-08-03', nature: 'vent', commentaire: 'CR n° 12' }, // même jour : 1 seul
    { id: 'i3', projetId: 'P01', date: '2026-08-04', nature: 'pluie', commentaire: 'CR n° 13' }, // mardi
    { id: 'i4', projetId: 'P01', date: '2026-08-01', nature: 'pluie', commentaire: '' }, // samedi : non ouvré
  ],
  desordresGPA: [
    { id: 'd1', projetId: 'P02', marcheId: 'm2', signaleLe: '2026-05-20', description: 'Fissure façade sud', statut: 'signale', relances: [] },
    { id: 'd2', projetId: 'P01', marcheId: 'm3', signaleLe: '2026-06-01', description: 'Joint de menuiserie', statut: 'notifie_entreprise', relances: [] },
    { id: 'd3', projetId: 'P02', marcheId: 'm2', signaleLe: '2026-04-10', description: 'Réglé', statut: 'leve', leveLe: '2026-05-01', relances: [] },
    { id: 'd4', projetId: 'P02', marcheId: null, signaleLe: '2026-05-25', description: 'Titulaire à identifier', statut: 'signale', relances: [] },
  ],
  visas: [
    { id: 'v1', projetId: 'P01', marcheId: 'm1', lot: 'Lot 01', document: 'Plans EXE R+1 — indice B', recuLe: '2026-08-10', delaiJours: 15, statut: 'a_viser' },
    { id: 'v2', projetId: 'P01', marcheId: 'm1', lot: 'Lot 01', document: 'Note de calcul', recuLe: '2026-07-01', delaiJours: 15, statut: 'vise', viseLe: '2026-07-08', visePar: 'Julien' },
    { id: 'v3', projetId: 'P01', marcheId: 'm3', lot: 'Lot 08', document: 'Carnet de détails', recuLe: '2026-08-11', delaiJours: 15, statut: 'a_viser' },
  ],
})

// ------------------------------------------------------------------
// 1. La synthèse HORIZONS, à la main
// ------------------------------------------------------------------

{
  const syn = E.syntheseEntreprise(S, 'ent-horizons', AUJOURDHUI)

  assert.equal(syn.nom, 'HORIZONS BTP', 'le nom d’affichage vient du registre')
  assert.deepEqual(
    syn.marches.map((l) => l.marche.id),
    ['m1', 'm2'],
    'les DEUX marchés, tous projets : m1 par entrepriseId, m2 par le nom seul — actif d’abord',
  )
  assert.equal(syn.marches[0].projet.nom, 'École de Naours', 'chaque ligne porte son projet')

  // totaux, au centime : 105 000 + 50 000 de marchés ; RG 5 % de 60 000 (m1,
  // en cours) + 5 % de 50 000 (m2, GPA échue) = 5 500 dont 2 500 à libérer
  assert.deepEqual(
    syn.totaux,
    { montantMarchesHT: 155000, rgRetenueHT: 5500, aLibererHT: 2500 },
    'totaux : Σ marchés HT avenants inclus ; RG retenue = en cours + à libérer ; à libérer = GPA échue seule',
  )
  assert.equal(syn.marches[0].rg.statut, 'en_cours', 'm1 : pas de réception, la RG court')
  assert.equal(syn.marches[1].rg.statut, 'a_liberer', 'm2 : réception + 1 an dépassé — l’argent est à rendre')

  // dernier certificat émis de m1 : le n° 2 de juillet (jamais recalculé)
  assert.equal(syn.marches[0].dernierCertificat.numero, 2, 'le DERNIER certificat émis, pas le premier')
  assert.equal(syn.marches[0].dernierCertificat.netAPayerTTC, 39900, '… avec son net à payer figé')
  assert.equal(syn.marches[1].dernierCertificat, null, 'm2 : rien d’émis, pas de certificat inventé')

  // situation du mois : m1 actif sans situation d'août → non reçue ;
  // m2 inactif → null (« non » serait faux : rien n'est attendu)
  assert.equal(syn.marches[0].situationDuMoisRecue, false, 'm1 : la situation d’août manque')
  assert.equal(syn.marches[1].situationDuMoisRecue, null, 'm2 inactif : rien d’attendu, ni oui ni non')
  assert.deepEqual(
    syn.situationsAttendues.map((a) => ({ id: a.marche.id, mois: a.mois, gravite: a.gravite })),
    [{ id: 'm1', mois: '2026-08', gravite: 2 }],
    'UNE situation attendue : le marché ACTIF sans situation du mois courant — jamais l’inactif',
  )

  // pénalités : 10 j de retard − 2 jours OUVRÉS DISTINCTS d'intempéries
  // (3 et 4 août ; le doublon du 3 compte une fois, le samedi 1er jamais)
  // × 100 €/j = 800 € — la déduction de l'écran chantier, pas une autre
  assert.deepEqual(
    syn.penalitesEncourues.map((p) => ({ id: p.marche.id, encouruHT: p.encouruHT, appliqueHT: p.appliqueHT })),
    [{ id: 'm1', encouruHT: 800, appliqueHT: 0 }],
    'pénalités : (10 − 2) × 100 = 800 € HT encourus sur m1 — celles de Dubois n’y sont pas',
  )

  // désordres du BON titulaire : d1 (m2) seul — pas ceux de Dubois (d2),
  // pas les levés (d3), pas ceux sans marché identifié (d4)
  assert.deepEqual(
    syn.desordresGPAOuverts.map((d) => d.id),
    ['d1'],
    'désordres GPA : ouverts ET rattachés à un marché du titulaire, rien d’autre',
  )

  assert.deepEqual(
    syn.visasEnAttente.map((v) => v.id),
    ['v1'],
    'visas : « à viser » de SES marchés — un document déjà visé ne s’alerte plus, ceux de Dubois non plus',
  )

  assert.equal(syn.contactEmail, 'contact@horizons.example', 'le contact du registre prime')
}

// ------------------------------------------------------------------
// 2. Le rapprochement : id d'abord, nom en repli (règle `fold`)
// ------------------------------------------------------------------

{
  const parId = E.syntheseEntreprise(S, 'ent-horizons', AUJOURDHUI)
  const parNom = E.syntheseEntreprise(S, '  horizons btp  ', AUJOURDHUI)
  assert.deepEqual(
    parNom.marches.map((l) => l.marche.id),
    parId.marches.map((l) => l.marche.id),
    'par id ou par nom plié (casse, espaces de bord), la MÊME fiche — pas deux',
  )
  assert.equal(parNom.entreprise.id, 'ent-horizons', 'le nom plié retrouve la fiche canonique du registre')

  const inconnue = E.syntheseEntreprise(S, 'Entreprise Fantôme', AUJOURDHUI)
  assert.equal(inconnue.marches.length, 0, 'entreprise inconnue : fiche vide, pas de rapprochement inventé')
  assert.equal(inconnue.entreprise, null, '… et pas d’entrée de registre inventée non plus')

  // Dubois : sa situation d'août est arrivée SANS marcheId — le critère
  // partagé la rattache par (projet + nom plié) : reçue, rien d'attendu
  const dubois = E.syntheseEntreprise(S, 'ent-dubois', AUJOURDHUI)
  assert.equal(dubois.marches[0].situationDuMoisRecue, true, 'la situation sans marcheId compte REÇUE (projet + nom plié)')
  assert.deepEqual(dubois.situationsAttendues, [], 'donc rien à relancer chez Dubois')
  assert.deepEqual(dubois.desordresGPAOuverts.map((d) => d.id), ['d2'], 'ses désordres à elle, pas ceux d’HORIZONS')
  assert.deepEqual(
    dubois.penalitesEncourues.map((p) => ({ id: p.marche.id, encouruHT: p.encouruHT, appliqueHT: p.appliqueHT })),
    [{ id: 'm3', encouruHT: 250, appliqueHT: 250 }],
    'sa pénalité APPLIQUÉE compte pour son montant figé, dans l’encouru ET dans l’appliqué',
  )
}

// ------------------------------------------------------------------
// 3. UN critère « situation attendue » — fil d'urgences et fiche d'accord
// ------------------------------------------------------------------

{
  // avant le 10 : rien n'est attendu — l'entreprise facture à terme échu
  assert.equal(E.situationAttendueNonRecue(S, S.marches[0], '2026-08-05'), null, 'avant le 10, pas de retard')
  // du 10 au 19 : attendue, à surveiller
  assert.deepEqual(E.situationAttendueNonRecue(S, S.marches[0], AUJOURDHUI), { mois: '2026-08', gravite: 2 })
  // à partir du 20 : la relance devient urgente
  assert.deepEqual(E.situationAttendueNonRecue(S, S.marches[0], '2026-08-25'), { mois: '2026-08', gravite: 3 })
  // marché inactif : jamais
  assert.equal(E.situationAttendueNonRecue(S, S.marches[1], '2026-08-25'), null, 'inactif : relancer serait du bruit')

  // le producteur d'alertes consomme LE MÊME critère : m1 alerte, m3 se
  // tait (sa situation est arrivée sans marcheId — avant 5.20, l'alerte
  // criait sur une situation que l'écran montrait reçue)
  const ids = computeAlertes(S, AUJOURDHUI).filter((a) => a.type === 'situation_manquante').map((a) => a.id)
  assert.deepEqual(ids, ['sitmanq:m1:2026-08'], 'fil d’urgences et fiche disent la même chose le même jour')

  const srcAlerts = lire('src/alerts.ts')
  assert.match(srcAlerts, /situationAttendueNonRecue/, 'alerts.ts consomme le critère de src/entreprise.ts')
  assert.doesNotMatch(srcAlerts, /jourDuMois/, 'alerts.ts ne garde aucun critère local « jour du mois » — une seconde définition divergerait')
  const srcEcran = lire('src/modules/Situations.tsx')
  assert.match(srcEcran, /situationDuMois/, 'l’onglet Attendues lit le même rapprochement')
  assert.doesNotMatch(srcEcran, /function situationDuMois/, '… sans le redéfinir localement')
  assert.match(srcEcran, /sujetRelanceSituation/, 'la relance de l’onglet Attendues vient de src/entreprise.ts')
  assert.doesNotMatch(srcEcran, /Sauf erreur de notre part, nous n'avons pas reçu votre situation/, 'le texte du brouillon ne vit qu’à UN endroit')

  // le brouillon : sujet et corps définis une fois, pour les deux écrans
  assert.equal(E.sujetRelanceSituation(S.marches[0], '2026-08'), 'Situation de travaux août 2026 — Lot 01 — Gros œuvre')
  const corps = E.corpsRelanceSituation(S.marches[0], '2026-08', 'Atelier L&L')
  assert.match(corps, /août 2026/, 'le mois attendu est écrit en clair')
  assert.match(corps, /situations@agence-ll\.fr/, 'l’adresse dédiée où renvoyer la situation')
  assert.match(corps, /Atelier L&L/, 'signé du nom de l’agence')
}

// ------------------------------------------------------------------
// 4. Module PUR, fiche en LECTURE
// ------------------------------------------------------------------

{
  const source = lire('src/entreprise.ts')
  assert.doesNotMatch(
    source,
    /useStore|localStorage|fetch\(|Date\.now|todayISO/,
    'src/entreprise.ts ne lit ni l’état ni l’horloge : today est un argument',
  )

  const ecran = lire('src/modules/FicheEntreprise.tsx')
  assert.doesNotMatch(
    ecran,
    /\bupdate\(|\breplace\(/,
    'la fiche est en LECTURE : aucun appel d’écriture du store — un doublon d’écriture ferait deux vérités',
  )
  assert.match(
    ecran,
    /const \{ state \} = useStore\(\)/,
    'l’écran ne destructure QUE state — même pas la fonction d’écriture sous la main',
  )
  assert.match(ecran, /ouvrirGmail\(/, 'le seul geste préparé est un BROUILLON (gmailComposeUrl, §15)')
  assert.match(ecran, /corpsRelanceSituation/, '… et c’est le même texte que l’onglet Attendues')
  assert.match(ecran, /<Table/, 'les listes passent par Table (src/ui.tsx) — la règle des tableaux')
  assert.match(ecran, /#\/projets\/\$\{projetId\}\/chantier/, 'chaque ligne renvoie vers l’écran où l’on AGIT')
}

// ------------------------------------------------------------------
// 5. La réutilisation se prouve sur les imports
// ------------------------------------------------------------------

{
  const source = lire('src/entreprise.ts')
  assert.match(source, /retenueGarantieMarche[\s\S]*?from '\.\/derive'/, 'la RG vient de derive.ts (autorité 5.1)')
  assert.match(source, /totalEncouruMarche[\s\S]*?from '\.\/penalites'/, 'les pénalités viennent de penalites.ts (5.2)')
  assert.match(source, /prolongationDelai/, '… avec la déduction d’intempéries de l’écran chantier (5.3)')
  assert.match(source, /desordresOuverts[\s\S]*?from '\.\/gpa'/, 'les désordres ouverts viennent de gpa.ts (5.9)')
  assert.match(source, /visasEnAttente[\s\S]*?from '\.\/visas'/, 'les visas en attente viennent de visas.ts (5.8)')

  // et aucune re-dérivation locale de ces règles : les motifs qui
  // trahiraient une seconde formule ne doivent pas apparaître ici
  assert.doesNotMatch(source, /tauxRG|finGPA|garantieDuMarche/, 'pas de calcul de RG ou de garantie refait localement (le défaut 5.1, précisément)')
  assert.doesNotMatch(source, /!== 'leve'/, 'pas de re-définition locale de « désordre ouvert »')
  assert.doesNotMatch(source, /'a_viser'/, 'pas de re-définition locale de « visa en attente »')
}

// ------------------------------------------------------------------
// 6. Les points d'ouverture existent
// ------------------------------------------------------------------

{
  assert.match(lire('src/modules/ProjetChantier.tsx'), /FicheEntreprise/, 'le nom de l’entreprise ouvre la fiche depuis la liste des marchés du projet')
  assert.match(lire('src/modules/Situations.tsx'), /FicheEntreprise/, '… et depuis les onglets Attendues / Retenues')
}

console.log(
  'Fiche entreprise : synthèse à la main (155 000 € de marchés, RG 5 500 dont 2 500 à libérer, ' +
    'pénalité 800 € intempéries déduites, désordres du bon titulaire) ; rapprochement id puis nom plié ; ' +
    'UN critère « situation attendue » partagé fil d’urgences / fiche ; module pur, fiche en lecture, ' +
    'réutilisation prouvée sur les imports.',
)
