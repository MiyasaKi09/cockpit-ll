// 5.1 — la garantie du marché gouverne la retenue (CCAG Travaux art. 33).
//
// Le défaut corrigé ici retenait de l'argent à tort : `Marche.cautionRG`
// existait, le cycle de vie de la RG le lisait, mais `decompteSituation`
// lisait `tauxRG` seul — le certificat de paiement retenait donc 5 % à une
// entreprise qui avait déjà fourni sa caution ou sa garantie à première
// demande, c'est-à-dire qu'il lui faisait payer sa garantie deux fois.
// Personne ne le voyait : un décompte faux de 5 % ressemble à un décompte.
//
// Quatre garanties tenues ici :
//
//   1. caution bancaire ou garantie à première demande ⇒ taux effectif 0,
//      rien n'est retenu, le net à payer est le cumul entier ;
//   2. sans document de garantie, la retenue s'applique — corriger 5.1 ne
//      doit pas offrir le cumul entier à tout le monde ;
//   3. le « déjà réglé » des situations successives suit le MÊME taux
//      effectif : la somme des nets mensuels reconstitue le cumul net ;
//   4. UNE seule autorité (`garantieDuMarche`) : rétro-compatibilité de
//      l'ancien `cautionRG`, champ typé qui prime, et les DEUX lecteurs
//      (décompte et cycle de vie RG) qui passent par elle.

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

const D = charger('src/derive.ts')

/** état minimal : un marché de 200 000 € HT à 5 % de RG, deux situations
 *  validées (mai : 100 000 cumulés ; juin : 150 000) */
function etatAvecMarche(surcharge = {}) {
  const marche = {
    id: 'M1',
    projetId: 'P1',
    entreprise: 'Maçonnerie Durand',
    lot: 'Lot 01 — Gros œuvre',
    montantInitialHT: 200000,
    avenantsHT: 0,
    tauxRG: 0.05,
    revision: false,
    delaiVerifJours: 15,
    actif: true,
    ...surcharge,
  }
  const situations = [
    { id: 'S1', projetId: 'P1', marcheId: 'M1', entreprise: 'Maçonnerie Durand', lot: 'Lot 01', mois: '2026-05', montantMoisHT: 100000, montantCumulHT: 100000, revisionHT: 0, dateReception: '2026-06-02', statut: 'validee' },
    { id: 'S2', projetId: 'P1', marcheId: 'M1', entreprise: 'Maçonnerie Durand', lot: 'Lot 01', mois: '2026-06', montantMoisHT: 50000, montantCumulHT: 150000, revisionHT: 0, dateReception: '2026-07-03', statut: 'validee' },
  ]
  return { marches: [marche], situations }
}

// --- 2. sans document de garantie, la retenue s'applique (rien ne change) --

{
  const etat = etatAvecMarche()
  const d1 = D.decompteSituation(etat, etat.situations[0])
  // main : base 100 000 ; RG 5 % = 5 000 ; net cumulé 95 000 ; rien de réglé
  assert.equal(d1.tauxRG, 0.05)
  assert.equal(d1.garantie, 'retenue')
  assert.equal(d1.retenueGarantieHT, 5000, 'sans caution ni GPD, la RG de 5 % se retient — le CCAG ne se corrige pas en offrant le cumul entier à tout le monde')
  assert.equal(d1.netAPayerHT, 95000)

  const d2 = D.decompteSituation(etat, etat.situations[1])
  // main : cumul net 150 000 × 0,95 = 142 500 ; déjà réglé 95 000 ; net 47 500
  assert.equal(d2.precedentNetHT, 95000)
  assert.equal(d2.netAPayerHT, 47500)
  assert.equal(d1.netAPayerHT + d2.netAPayerHT, d2.cumulNetHT, 'la somme des nets mensuels doit reconstituer le cumul net — sinon un mois paie deux fois ou jamais')
}

// --- 1. garantie à première demande ⇒ taux effectif 0 ----------------------

{
  const etat = etatAvecMarche({ garantie: 'gpd', garantieRecueLe: '2026-04-10' })
  const d1 = D.decompteSituation(etat, etat.situations[0])
  assert.equal(
    d1.retenueGarantieHT,
    0,
    'défaut 5.1 : le décompte retient la RG alors qu\'une garantie à première demande couvre le marché — l\'entreprise paierait sa garantie deux fois',
  )
  assert.equal(d1.tauxRG, 0, 'le taux EFFECTIF du décompte doit valoir 0 quand la garantie couvre le marché, quel que soit Marche.tauxRG')
  assert.equal(d1.garantie, 'gpd', 'le décompte doit dire POURQUOI le taux vaut 0 — un 0 muet ressemble à un marché mal rattaché')
  assert.equal(d1.netAPayerHT, 100000, 'net à payer = cumul entier : rien n\'est retenu')

  const d2 = D.decompteSituation(etat, etat.situations[1])
  // main : cumul net 150 000 (RG 0) ; déjà réglé 100 000 ; net du mois 50 000
  assert.equal(
    d2.precedentNetHT,
    100000,
    'le « déjà réglé » doit suivre le MÊME taux effectif que le cumul : un précédent calculé à 95 % face à un cumul à 100 % gonflerait le net du mois de 5 000 €',
  )
  assert.equal(d2.netAPayerHT, 50000)
  assert.equal(d1.netAPayerHT + d2.netAPayerHT, d2.cumulNetHT)
}

// --- 1 bis. caution bancaire : même effet, et la révision suit -------------

{
  const etat = etatAvecMarche({ garantie: 'caution' })
  etat.situations[1].revisionHT = 1200
  const d2 = D.decompteSituation(etat, etat.situations[1])
  // main : base 151 200 (cumul + révision) ; RG 0 ; déjà réglé 100 000
  assert.equal(d2.retenueGarantieHT, 0, 'défaut 5.1 : la caution bancaire doit annuler la retenue du décompte')
  assert.equal(d2.baseHT, 151200)
  assert.equal(d2.netAPayerHT, 51200)
  assert.equal(d2.netAPayerTTC, 51200 * 1.2)
}

// --- 4. rétro-compatibilité : l'ancien `cautionRG` équivaut à 'caution' ----

{
  // un marché saisi avant le Lot 5 ne porte que le booléen — il doit rester
  // couvert sans que personne ne rouvre sa fiche
  assert.equal(D.garantieDuMarche({ cautionRG: true }), 'caution', 'rétro-compat : cautionRG:true ≡ caution bancaire — les marchés existants perdraient leur garantie sinon')
  assert.equal(D.garantieDuMarche({}), 'retenue')
  assert.equal(D.garantieDuMarche(undefined), 'retenue', 'sans marché rattaché, rien n\'est couvert')
  // le champ typé PRIME : repasser un marché en 'retenue' doit tenir même si
  // le vieux booléen traîne encore à true dans le document
  assert.equal(D.garantieDuMarche({ garantie: 'retenue', cautionRG: true }), 'retenue', 'le champ typé prime sur cautionRG — sinon impossible de revenir en arrière')
  // une valeur inconnue (état plus récent, import) retombe sur la rétro-compat
  assert.equal(D.garantieDuMarche({ garantie: 'nawak', cautionRG: true }), 'caution')

  const etat = etatAvecMarche({ cautionRG: true })
  const d1 = D.decompteSituation(etat, etat.situations[0])
  assert.equal(d1.retenueGarantieHT, 0, 'défaut 5.1 : un marché historique avec cautionRG:true doit passer à RG 0 dans le décompte')
  assert.equal(d1.garantie, 'caution')
}

// --- 4 bis. le cycle de vie de la RG suit la MÊME autorité -----------------

{
  const couvert = etatAvecMarche({ garantie: 'gpd' })
  const rgCouvert = D.retenueGarantieMarche(couvert, couvert.marches[0], '2026-08-04')
  assert.equal(
    rgCouvert.retenueHT,
    0,
    'cycle de vie RG : un marché couvert par une GPD ne retient rien — afficher un cumul « retenu » théorique ferait deux vérités face au décompte',
  )
  assert.equal(rgCouvert.caution, true)
  assert.equal(rgCouvert.garantie, 'gpd')

  const nu = etatAvecMarche()
  const rgNu = D.retenueGarantieMarche(nu, nu.marches[0], '2026-08-04')
  // main : cumul validé 150 000 × 5 % = 7 500 encore retenus
  assert.equal(rgNu.retenueHT, 7500)
  assert.equal(rgNu.caution, false)

  // l'autorité est UNIQUE dans le code, pas seulement dans le comportement :
  // les deux lecteurs appellent garantieDuMarche. Un futur refactor qui
  // relirait tauxRG ou cautionRG en direct recréerait le défaut 5.1.
  const source = lire('src/derive.ts')
  const corps = (nom) => {
    const m = new RegExp(`export function ${nom}\\(([\\s\\S]*?)\\n\\}`).exec(source)
    assert.ok(m, `src/derive.ts : ${nom} introuvable`)
    return m[1]
  }
  assert.match(corps('decompteSituation'), /garantieDuMarche/, 'decompteSituation doit décider via garantieDuMarche — lire tauxRG seul est exactement le défaut 5.1')
  assert.match(corps('retenueGarantieMarche'), /garantieDuMarche/, 'retenueGarantieMarche doit décider via garantieDuMarche, pas via cautionRG en direct')
}

// --- l'écran et le formulaire disent la raison du 0 ------------------------

{
  const situations = lire('src/modules/Situations.tsx')
  assert.match(
    situations,
    /LIBELLE_GARANTIE\[dc\.garantie\]/,
    'Situations.tsx : le décompte doit AFFICHER la raison du 0 % (« RG 0 % — garantie à première demande ») — un 0 muet se lit comme une erreur de rattachement',
  )
  assert.doesNotMatch(
    situations,
    /\.cautionRG/,
    'Situations.tsx : l\'écran ne doit plus écrire ni lire le booléen hérité (accès `.cautionRG`) — le champ typé est la seule écriture, sinon deux sources de vérité',
  )

  const formulaire = lire('src/modules/ProjetChantier.tsx')
  for (const type of ["'retenue'", "'caution'", "'gpd'"]) {
    assert.ok(formulaire.includes(type), `ProjetChantier.tsx : le formulaire marché doit proposer le type de garantie ${type}`)
  }
  assert.match(formulaire, /garantieRecueLe/, 'ProjetChantier.tsx : la date de réception du document de garantie doit se saisir sur le marché')

  const types = lire('src/types.ts')
  assert.match(types, /garantie\?: TypeGarantie/, 'types.ts : MarcheTravaux doit porter le type de garantie optionnel (rétro-compatible)')
  assert.match(types, /garantieRecueLe\?: string \| null/, 'types.ts : la date de réception du document est un champ optionnel du marché')
}

console.log(
  'Garantie de marché : caution ou première demande ⇒ RG effective 0 et net au cumul entier, retenue de 5 % sinon, ' +
    'précédent réglé au même taux (les nets mensuels reconstituent le cumul), cautionRG historique honoré, ' +
    'et une seule autorité — garantieDuMarche — pour le décompte comme pour le cycle de vie de la RG.',
)
