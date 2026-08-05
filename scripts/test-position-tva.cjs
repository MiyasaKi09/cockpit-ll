// Position TVA — « ce qu'on doit à l'État » calculé depuis les pièces
// (src/tva.ts, carte TVA). Convention appliquée par défaut, à valider avec
// le cabinet (docs/QUESTIONS_CABINET_TVA.md) : collectée à l'ENCAISSEMENT
// (settings.regimeTVA, option 'debits'), déductible au PAIEMENT de l'achat.
//
// Une position TVA fausse ne se voit pas à l'écran : elle se voit à la
// CA3, quand le cabinet trouve un mois qui ne colle pas — ou pire, quand
// l'agence provisionne 700 € et en doit 2 000. Tout est vérifié sur des
// cas posés À LA MAIN : prorata d'un paiement partiel, paiement à cheval
// sur deux factures, avoir négatif, achat écarté ou impayé, bascule sur
// les débits, mois déclaré figé par un geste humain — et la pureté du
// module, parce qu'une horloge lue au fond du calcul rendrait ces cas
// impossibles à écrire.

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

const T = charger('src/tva.ts')

// --- fabriques : des pièces posées à la main, jamais tirées du seed --------

const r2 = (v) => Math.round(v * 100) / 100

/** facture ÉMISE avec copie figée (la vérité fiscale de la pièce) */
const facture = (id, ht, tva, { emission = '2026-02-10', statut = 'emise', type = 'facture' } = {}) => ({
  id,
  projetId: 'P01',
  phase: 'DET',
  libelle: id,
  montantHT: ht,
  tauxTVA: ht ? tva / ht : 0,
  emission,
  delaiJours: 30,
  statut,
  type,
  figee: {
    numero: id,
    dateEmission: emission,
    clientNom: 'MOA',
    agence: { nom: 'Agence' },
    lignes: [],
    totalHT: ht,
    totalTVA: tva,
    totalTTC: r2(ht + tva),
    mentionTVA: '',
    delaiJours: 30,
  },
})

const paiement = (id, date, affectations) => ({
  id,
  date,
  montant: r2(affectations.reduce((s, a) => s + a.montant, 0)),
  affectations,
})

const achat = (id, tva, { payeLe = null, statut = 'validee' } = {}) => ({
  id,
  fournisseur: 'BET',
  dateFacture: '2026-03-01',
  montantHT: 1000,
  montantTVA: tva,
  montantTTC: r2(1000 + (tva ?? 0)),
  ventilations: [],
  statut,
  payeLe,
  source: 'manuel',
})

const etat = (patch = {}) => ({
  settings: {},
  factures: [],
  paiements: [],
  facturesAchat: [],
  tvaDeclarations: [],
  ...patch,
})

const mois = (position, cle) => position.mois.find((m) => m.mois === cle)

// --- 1. le cas à la main : moitié encaissée, un achat payé ------------------

{
  // facture 10 000 HT / 2 000 TVA / 12 000 TTC, payée MOITIÉ en mars :
  // la TVA collectée suit le paiement au prorata (6 000 × 2 000/12 000).
  const s = etat({
    factures: [facture('F1', 10000, 2000)],
    paiements: [paiement('p1', '2026-03-15', [{ factureId: 'F1', montant: 6000 }])],
    facturesAchat: [achat('A1', 300, { payeLe: '2026-03-20' })],
  })
  const p = T.positionTVA(s, { moisCourant: '2026-04' })
  const mars = mois(p, '2026-03')
  assert.equal(mars.collectee, 1000, 'moitié du TTC encaissée ⇒ moitié de la TVA collectée (prorata)')
  assert.equal(mars.deductible, 300, 'l’achat payé en mars est déductible en mars')
  assert.equal(mars.solde, 700, 'solde du mois = collectée − déductible')
  assert.equal(p.duALEtat, 700, 'mars est échu et non déclaré : son solde est dû à l’État')
  assert.equal(mois(p, '2026-02').collectee, 0, 'rien encaissé en février : la facture ÉMISE ne collecte rien en encaissements')

  // `moisCourant` accepte aussi une date ISO complète (la carte passe le mois)
  assert.equal(T.positionTVA(s, { moisCourant: '2026-04-18' }).duALEtat, 700)
}

// --- 2. un paiement à cheval sur deux factures (affectations) ---------------

{
  // 1 200 sur F1 (TVA 2 000/12 000 ⇒ 200) + 110 sur F2 (TVA 50/550 ⇒ 10) :
  // chaque affectation porte le prorata de SA facture, pas celui du paiement.
  const s = etat({
    factures: [facture('F1', 10000, 2000), facture('F2', 500, 50)],
    paiements: [
      paiement('p1', '2026-03-05', [
        { factureId: 'F1', montant: 1200 },
        { factureId: 'F2', montant: 110 },
      ]),
    ],
  })
  const p = T.positionTVA(s, { moisCourant: '2026-04' })
  assert.equal(
    mois(p, '2026-03').collectee,
    210,
    'paiement multi-factures : la TVA se calcule affectation par affectation (200 + 10)',
  )
}

// --- 3. l'avoir : des montants négatifs, le même chemin ---------------------

{
  // avoir de -120 TTC (-20 de TVA) remboursé en mars : la collectée du mois
  // DIMINUE de 20 — un avoir qui ne repasserait pas par le prorata gonflerait
  // le dû à l'État de la TVA d'une pièce annulée.
  const s = etat({
    factures: [
      facture('F1', 10000, 2000),
      facture('AV1', -100, -20, { type: 'avoir' }),
    ],
    paiements: [
      paiement('p1', '2026-03-15', [{ factureId: 'F1', montant: 6000 }]),
      paiement('p2', '2026-03-20', [{ factureId: 'AV1', montant: -120 }]),
    ],
  })
  const p = T.positionTVA(s, { moisCourant: '2026-04' })
  assert.equal(mois(p, '2026-03').collectee, 980, 'l’avoir remboursé retire sa TVA de la collectée (1 000 − 20)')

  // seul, l'avoir met le mois en crédit — et le crédit DIMINUE le dû (report)
  const seul = T.positionTVA(
    etat({
      factures: [facture('AV1', -100, -20, { type: 'avoir' })],
      paiements: [paiement('p2', '2026-03-20', [{ factureId: 'AV1', montant: -120 }])],
    }),
    { moisCourant: '2026-04' },
  )
  assert.equal(mois(seul, '2026-03').solde, -20, 'un mois en crédit de TVA porte un solde négatif')
  assert.equal(seul.duALEtat, -20, 'le crédit se reporte : il diminue le dû, il ne disparaît pas')
}

// --- 4. achats : écarté ou impayé = 0, TVA absente = 0 (pas NaN) ------------

{
  const s = etat({
    facturesAchat: [
      achat('A1', 300, { payeLe: '2026-03-20', statut: 'ecartee' }),
      achat('A2', 300, { payeLe: null }),
      achat('A3', null, { payeLe: '2026-03-25' }),
    ],
  })
  const p = T.positionTVA(s, { moisCourant: '2026-04' })
  const mars = mois(p, '2026-03')
  assert.equal(mars.deductible, 0, 'écartée ou impayée : rien n’est déductible ; TVA null : 0 déductible, pas une erreur')
  assert.equal(Number.isFinite(mars.solde), true, 'une TVA d’achat absente ne produit jamais NaN')
  assert.equal(p.duALEtat, 0)
}

// --- 5. l'option débits : la collectée bascule sur l'ÉMISSION ---------------

{
  const pieces = {
    factures: [facture('F1', 10000, 2000, { emission: '2026-02-10' })],
    paiements: [paiement('p1', '2026-03-15', [{ factureId: 'F1', montant: 6000 }])],
  }
  const enc = T.positionTVA(etat(pieces), { moisCourant: '2026-04' })
  assert.equal(mois(enc, '2026-03').collectee, 1000, 'défaut encaissements : la TVA suit le paiement (mars)')

  const deb = T.positionTVA(etat({ ...pieces, settings: { regimeTVA: 'debits' } }), { moisCourant: '2026-04' })
  assert.equal(mois(deb, '2026-02').collectee, 2000, 'option débits : TOUTE la TVA naît à l’émission (février)')
  assert.equal(mois(deb, '2026-03').collectee, 0, 'option débits : le paiement de mars ne collecte plus rien')

  // une facture PRÉVUE n'existe pas fiscalement : même en débits, rien
  const prevue = T.positionTVA(
    etat({ settings: { regimeTVA: 'debits' }, factures: [facture('F9', 1000, 200, { statut: 'prevue' })] }),
    { moisCourant: '2026-04' },
  )
  assert.equal(mois(prevue, '2026-02').collectee, 0, 'une facture prévue ne collecte rien, même sur les débits')

  // un réglage inconnu (import, version future) retombe sur le droit commun,
  // jamais sur une option que personne n'a formulée au SIE
  assert.equal(T.regimeTVAEffectif({ regimeTVA: 'n’importe quoi' }), 'encaissements')
  assert.equal(T.regimeTVAEffectif({}), 'encaissements')
}

// --- 6. « Marquer déclarée » : le geste humain sort le mois du dû -----------

{
  const s = etat({
    factures: [facture('F1', 10000, 2000)],
    paiements: [paiement('p1', '2026-03-15', [{ factureId: 'F1', montant: 6000 }])],
    facturesAchat: [achat('A1', 300, { payeLe: '2026-03-20' })],
  })
  assert.equal(T.positionTVA(s, { moisCourant: '2026-05' }).duALEtat, 700, 'non déclaré : mars reste dû')

  s.tvaDeclarations = [{ id: 'd1', mois: '2026-03', montant: 700, declareLe: '2026-04-15' }]
  assert.equal(T.positionTVA(s, { moisCourant: '2026-05' }).duALEtat, 0, 'mars déclaré sort du dû à l’État')
  assert.equal(
    mois(T.positionTVA(s, { moisCourant: '2026-05' }), '2026-03').solde,
    700,
    'le mois déclaré reste LISIBLE dans la position (la carte affiche l’écart si les pièces bougent)',
  )
  assert.equal(T.declarationDuMois(s, '2026-03').montant, 700)
  assert.equal(T.declarationDuMois(s, '2026-04'), null)

  // le mois COURANT n'est jamais dû : il n'est pas fini
  s.tvaDeclarations = []
  assert.equal(T.positionTVA(s, { moisCourant: '2026-03' }).duALEtat, 0, 'le mois courant n’est pas échu : rien n’est encore dû')
}

// --- 7. l'arrondi : accumulé en précision pleine, arrondi une fois par mois --

{
  // deux règlements de 0,03 € sur une pièce à TVA 0,20/1,20 : chaque part
  // vaut un demi-centime. Arrondir par paiement donnerait 0,00 ou 0,02 ;
  // la règle du dépôt (totauxLignes) accumule puis arrondit UNE fois : 0,01.
  const s = etat({
    factures: [facture('F1', 1, 0.2)],
    paiements: [
      paiement('p1', '2026-03-03', [{ factureId: 'F1', montant: 0.03 }]),
      paiement('p2', '2026-03-04', [{ factureId: 'F1', montant: 0.03 }]),
    ],
  })
  assert.equal(
    mois(T.positionTVA(s, { moisCourant: '2026-04' }), '2026-03').collectee,
    0.01,
    'la TVA collectée s’accumule en précision pleine et s’arrondit une fois par mois',
  )
}

// --- 8. la carte a toujours ses trois mois, même sans aucune pièce ----------

{
  const p = T.positionTVA(etat(), { moisCourant: '2026-08' })
  assert.deepEqual(
    p.mois.map((m) => m.mois),
    ['2026-06', '2026-07', '2026-08'],
    'les trois derniers mois existent même vides : un mois à zéro est une information, pas un trou',
  )
  assert.equal(p.duALEtat, 0)

  // une affectation orpheline ou une date corrompue n'inventent ni mois ni TVA
  const sale = T.positionTVA(
    etat({
      paiements: [paiement('p1', 'pas-une-date', [{ factureId: 'fantôme', montant: 100 }])],
      facturesAchat: [achat('A1', 300, { payeLe: 'n/a' })],
    }),
    { moisCourant: '2026-08' },
  )
  assert.equal(sale.mois.length, 3, 'une date illisible ne crée pas de ligne illisible')
  assert.equal(sale.duALEtat, 0)
}

// --- 9. le module est PUR — l'horloge et le stockage restent dehors ---------

{
  const src = lire('src/tva.ts')
  for (const interdit of ['Date.now', 'new Date(', 'localStorage', 'fetch(', 'useStore', "from './store'"]) {
    assert.ok(
      !src.includes(interdit),
      `src/tva.ts contient « ${interdit} » : le calcul doit recevoir moisCourant en argument, jamais lire l’horloge ou le stockage`,
    )
  }
}

// --- 10. le câblage : collection normalisée, carte montée, UNE convention ---

{
  // règle 1 du dépôt : la collection est normalisée (modèle Array.isArray)
  // et amorcée vide — un mois « déclaré » d'exemple sortirait un mois réel du dû.
  assert.match(
    lire('src/store.tsx'),
    /tvaDeclarations = Array\.isArray\(parsed\.tvaDeclarations\) \? parsed\.tvaDeclarations : \[\]/,
    'store.tsx doit normaliser tvaDeclarations : une sauvegarde antérieure ferait tomber la carte',
  )
  assert.match(lire('src/seed.ts'), /tvaDeclarations: \[\]/, 'le seed amorce tvaDeclarations VIDE')
  assert.match(
    lire('src/types.ts'),
    /regimeTVA\?: 'encaissements' \| 'debits'/,
    'Settings.regimeTVA reste un réglage fermé encaissements/débits',
  )

  // la carte est autonome, montée en tête de Comptable, et porte le geste.
  // Le montage doit être une LIGNE de JSX vivante : « {/* <CarteTVA /> */} »
  // laisserait la carte invisible en satisfaisant une recherche naïve.
  const comptable = lire('src/modules/Comptable.tsx')
  assert.match(
    comptable,
    /^\s*<CarteTVA \/>$/m,
    'la carte TVA doit être montée (provisoirement) en tête de Comptable — pas commentée, pas absente',
  )
  const carte = lire('src/modules/CarteTVA.tsx')
  assert.match(carte, /positionTVA\(/, 'la carte AFFICHE la position calculée par src/tva.ts, elle ne recalcule rien')
  assert.match(carte, /Marquer déclarée/, 'le geste « Marquer déclarée » est offert par mois échu')
  assert.match(carte, /confirmer\(/, 'figer un mois passe par une confirmation : le geste est humain (§15)')
  assert.match(carte, /QUESTIONS_CABINET_TVA/, 'la carte renvoie au document des questions au cabinet')
  assert.match(
    carte,
    /libelleConvention\(/,
    'la ligne de convention vient de libelleConvention — une phrase recopiée divergerait au premier changement de régime',
  )

  // la convention énoncée : une source, deux régimes
  assert.match(T.libelleConvention('encaissements'), /collectée à l’encaissement · déductible au paiement — régime à confirmer avec le cabinet/)
  assert.match(T.libelleConvention('debits'), /émission/, 'en mode débits, la ligne dit que la collectée naît à l’émission')
  assert.match(T.libelleConvention('debits'), /déductible au paiement — régime à confirmer avec le cabinet/)

  // le document du cabinet décrit bien la convention APPLIQUÉE et la question
  // devient « valider ou corriger ce réglage »
  const doc = lire('docs/QUESTIONS_CABINET_TVA.md')
  assert.match(doc, /convention appliquée par défaut/i, 'le doc décrit la convention appliquée par défaut')
  assert.match(doc, /valider ou corriger ce réglage/i, 'la question au cabinet devient : valider ou corriger ce réglage')
  assert.match(doc, /regimeTVA/, 'le doc cite le réglage qui traduit la réponse du cabinet')
}

console.log(
  'Position TVA : collectée à l’encaissement au prorata (paiement partiel, multi-factures, avoir négatif), ' +
    'déductible au paiement (écartée/impayée/TVA absente = 0), bascule propre sur l’option débits, ' +
    'mois déclaré figé par geste humain et sorti du dû, arrondi une fois par mois, module pur — ' +
    'et la carte montée avec UNE ligne de convention (docs/QUESTIONS_CABINET_TVA.md).',
)
