// 5.15 — TVA : le versant que le code peut prouver (le reste appartient au
// cabinet — docs/QUESTIONS_CABINET_TVA.md porte les questions à trancher).
//
// Une erreur de TVA ne se voit pas à l'écran : elle se voit au contrôle
// fiscal, ou quand le cabinet rapproche la CA3 des factures et trouve un
// centime qui manque. Trois garanties tenues ici :
//
//   1. la règle d'arrondi de `totauxLignes` (src/facture.ts) est CONSTATÉE
//      et verrouillée : HT arrondi PAR LIGNE, TVA accumulée en précision
//      pleine sur toutes les lignes puis arrondie UNE fois au total —
//      changer l'un ou l'autre déplacerait des centimes sur des pièces
//      légales déjà émises ;
//   2. ht + tva = ttc au centime, y compris sur les cas piégeux (taux
//      mixtes — LigneFacture porte un taux PAR ligne —, quantités
//      décimales, remise en ligne négative, grands montants) ;
//   3. la mention d'exigibilité (« TVA sur les encaissements », marquée
//      « à CONFIRMER » sur Settings.mentionTVA dans types.ts) reste un
//      RÉGLAGE : partout où une pièce s'imprime, le réglage gagne, et
//      aucun fichier ne recopie la phrase en dur — sinon le jour où le
//      cabinet confirme l'option sur les débits, une partie des documents
//      continuerait d'affirmer l'autre régime.

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

const F = charger('src/facture.ts')

const ligne = (quantite, prixUnitaireHT, tauxTVA) => ({
  id: 'l',
  designation: 'prestation',
  quantite,
  unite: 'forfait',
  prixUnitaireHT,
  tauxTVA,
})
const centimes = (v) => Math.round(v * 100)

// --- 1. la règle d'arrondi CONSTATÉE : HT par ligne, TVA au total ----------

{
  // HT : chaque ligne est arrondie au centime AVANT la somme. 3 × 33,335 €
  // vaut 100,005 € exacts ; la ligne imprimée porte 100,01 €, et deux lignes
  // identiques totalisent 200,02 € — pas round(200,01) = 200,01 €. C'est la
  // règle qui fait que le total HT de la facture est toujours la somme des
  // montants que le client LIT ligne à ligne sur le PDF.
  assert.equal(F.montantLigne(ligne(3, 33.335, 0.2)), 100.01, 'le montant de ligne est arrondi au centime')
  assert.equal(
    F.totauxLignes([ligne(3, 33.335, 0.2), ligne(3, 33.335, 0.2)]).ht,
    200.02,
    'le HT total est la somme des lignes ARRONDIES (200,02), pas l’arrondi de la somme exacte (200,01) — ' +
      'sinon le total imprimé contredirait les lignes imprimées',
  )

  // TVA : accumulée en précision pleine puis arrondie UNE fois au total.
  // Deux lignes de 0,03 € à 20 % portent chacune 0,006 € de TVA : l'arrondi
  // par ligne donnerait 0,01 + 0,01 = 0,02 ; la règle constatée donne
  // round(0,012) = 0,01.
  assert.equal(
    F.totauxLignes([ligne(1, 0.03, 0.2), ligne(1, 0.03, 0.2)]).tva,
    0.01,
    'la TVA n’est PAS arrondie par ligne : elle s’accumule puis s’arrondit une fois au total',
  )

  // …et l'arrondi est GLOBAL, pas par taux : 0,07 € à 20 % (0,014) plus
  // 0,03 € à 10 % (0,003) donnent round(0,017) = 0,02 ; un arrondi par taux
  // donnerait 0,01 + 0,00 = 0,01. La ventilation par taux d'une pièce figée
  // (montantsPieceParTaux) réconcilie ensuite cet écart d'un centime sur le
  // taux principal — c'est documenté dans src/facture.ts et vérifié par
  // test-facture-invariants ; ici on fige la règle du TOTAL.
  assert.equal(
    F.totauxLignes([ligne(1, 0.07, 0.2), ligne(1, 0.03, 0.1)]).tva,
    0.02,
    'la TVA totale s’arrondit globalement, pas taux par taux',
  )
}

// --- 2. ht + tva = ttc au centime, sur les cas piégeux ---------------------

{
  const cas = [
    ['un seul taux plein', [ligne(1, 1000, 0.2)]],
    ['taux mixtes 20/10/5,5/0 avec quantité décimale', [ligne(1, 1234.56, 0.2), ligne(2.5, 199.99, 0.1), ligne(1, 88.2, 0.055), ligne(3, 45.5, 0)]],
    ['demi-centime par ligne', [ligne(3, 33.335, 0.2), ligne(3, 33.335, 0.1)]],
    ['centimes qui accumulent la TVA sous le centime', [ligne(1, 0.03, 0.2), ligne(1, 0.03, 0.2), ligne(1, 0.07, 0.055)]],
    ['remise en ligne négative (base nette positive)', [ligne(1, 1000, 0.2), ligne(-1, 333.33, 0.2)]],
    ['grand montant', [ligne(1, 123456.785, 0.2)]],
    ['flottants notoires (0,1 et 0,2)', [ligne(0.1, 0.1, 0.2), ligne(0.2, 0.2, 0.2)]],
  ]
  for (const [nom, lignes] of cas) {
    const t = F.totauxLignes(lignes)
    assert.equal(
      centimes(t.ht) + centimes(t.tva),
      centimes(t.ttc),
      `${nom} : ht (${t.ht}) + tva (${t.tva}) ≠ ttc (${t.ttc}) — la pièce imprimée serait fausse au centime`,
    )
    assert.equal(t.ht, Math.round(t.ht * 100) / 100, `${nom} : le HT total doit être un montant en centimes`)
    assert.equal(t.tva, Math.round(t.tva * 100) / 100, `${nom} : la TVA totale doit être un montant en centimes`)
  }

  // Le trio figé à l'émission reprend EXACTEMENT ces totaux : le PDF et le
  // Factur-X se régénèrent depuis la copie figée, jamais depuis un recalcul.
  const settings = { nomAgence: 'Agence', adresseAgence: '1 rue', siretAgence: '123', mentionTVA: '' }
  const brouillon = {
    projetId: 'P01',
    clientNom: 'MOA',
    clientAdresse: '2 rue',
    dateEmission: '2026-08-04',
    lignes: [ligne(1, 1234.56, 0.2), ligne(2.5, 199.99, 0.1)],
  }
  const figee = F.construireFigee({ settings }, brouillon, '2026-001')
  const attendu = F.totauxLignes(brouillon.lignes)
  assert.equal(figee.totalHT, attendu.ht, 'la copie figée reprend le HT calculé par totauxLignes')
  assert.equal(figee.totalTVA, attendu.tva, 'la copie figée reprend la TVA calculée par totauxLignes')
  assert.equal(
    centimes(figee.totalHT) + centimes(figee.totalTVA),
    centimes(figee.totalTTC),
    'les totaux figés restent cohérents au centime',
  )
}

// --- 3. la mention d'exigibilité : un réglage, jamais une phrase en dur ----

{
  const settingsDebits = { nomAgence: 'Agence', mentionTVA: 'TVA sur les débits (option formulée au SIE)' }
  const brouillon = { projetId: 'P01', clientNom: 'MOA', clientAdresse: '2 rue', dateEmission: '2026-08-04', lignes: [ligne(1, 100, 0.2)] }
  assert.equal(
    F.construireFigee({ settings: settingsDebits }, brouillon, '2026-002').mentionTVA,
    'TVA sur les débits (option formulée au SIE)',
    'quand le cabinet confirme un régime, le RÉGLAGE gagne sur le défaut',
  )
  assert.equal(
    F.construireFigee({ settings: { nomAgence: 'Agence' } }, brouillon, '2026-003').mentionTVA,
    F.MENTION_TVA_DEFAUT,
    'sans réglage, le défaut s’applique — et il vient de la constante, pas d’une chaîne recopiée',
  )
  assert.equal(F.MENTION_TVA_DEFAUT, 'TVA sur les encaissements', 'le défaut reste le régime de droit commun des prestations de services')

  // Le champ reste OPTIONNEL et marqué « à confirmer » dans types.ts : tant
  // que le cabinet n'a pas tranché (docs/QUESTIONS_CABINET_TVA.md), la
  // question doit rester visible dans le code, pas absorbée en silence.
  const types = lire('src/types.ts')
  assert.match(types, /mentionTVA\?: string/, 'Settings.mentionTVA reste un réglage optionnel')
  assert.match(
    types,
    /mention d'exigibilité TVA[\s\S]{0,200}CONFIRMER/,
    'la marque « à CONFIRMER avec le cabinet » reste posée sur le réglage tant que le régime n’est pas tranché',
  )

  // Les documents imprimés lisent le réglage : la copie figée porte la
  // mention (PDF et Factur-X la reprennent), et la facture HISTORIQUE (jamais
  // gelée) lit AUSSI le réglage — c'est le chemin qui codait la phrase en dur.
  const pdf = lire('src/pdf.ts')
  assert.match(pdf, /fg\.mentionTVA/, 'le PDF d’une pièce figée imprime la mention de la copie figée')
  assert.match(
    pdf,
    /s\.mentionTVA \|\| MENTION_TVA_DEFAUT/,
    'le PDF d’une facture historique lit le réglage (repli : la constante) — pas une phrase recopiée',
  )
  assert.match(lire('src/facturx.ts'), /fg\.mentionTVA/, 'le Factur-X reprend la mention de la copie figée')

  // Aucun fichier de src/ ne recopie la phrase du défaut en dur : seules
  // sont admises la déclaration de la constante, une lecture avec repli
  // (`mentionTVA || …`) et les textes d'AIDE à la saisie (placeholder/hint
  // des formulaires) — une occurrence nouvelle serait une seconde source de
  // vérité qui divergerait du réglage.
  const marcher = (dossier) =>
    fs.readdirSync(path.join(racine, dossier), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? marcher(`${dossier}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dossier}/${e.name}`] : [],
    )
  for (const fichier of marcher('src')) {
    for (const [numero, texte] of lire(fichier).split('\n').entries()) {
      if (!texte.includes('TVA sur les encaissements')) continue
      assert.ok(
        /MENTION_TVA_DEFAUT\s*=|mentionTVA \|\||placeholder|hint=/.test(texte),
        `${fichier}:${numero + 1} code la mention d'exigibilité en dur — elle doit venir du réglage ou de MENTION_TVA_DEFAUT`,
      )
    }
  }
}

console.log(
  'TVA : règle d’arrondi constatée et verrouillée (HT par ligne, TVA une fois au total), ' +
    'ht + tva = ttc au centime sur les cas piégeux, et la mention d’exigibilité reste un réglage — ' +
    'aucune phrase de régime fiscal codée en dur, le cabinet garde la main (QUESTIONS_CABINET_TVA.md).',
)
