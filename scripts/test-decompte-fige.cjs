// Lot B (S6) — DEUX RÉGIMES DE VÉRITÉ DANS LA MÊME FAMILLE DE DOCUMENTS.
//
// Le défaut fermé ici n'est pas un calcul faux : c'est un document qui ne
// disait pas ce qu'il était. Trois pièces sortent de `src/pdf.ts` et se
// ressemblent à l'écran — la facture, le certificat de paiement, le décompte
// de situation. Les deux premières se réimpriment depuis leur COPIE FIGÉE :
// réimprimer une facture émise en 2025 rend le même papier en 2027. La
// troisième se RECALCULE à chaque impression depuis l'état courant, et rien
// ne le disait.
//
// Concrètement : l'entreprise reçoit un décompte le 3 juillet, l'agence
// saisit un avenant le 10, réimprime le 12 pour le classer — et range dans
// le dossier un papier qui ne porte plus les mêmes chiffres que celui qui a
// été envoyé, sans qu'aucune des deux feuilles ne l'admette. Deux personnes
// qui se relisent à trois mois d'écart n'ont aucun moyen de savoir laquelle
// fait foi.
//
// B1 du plan (« figer le décompte à la validation, comme le certificat »)
// n'est PAS livré : il touche `types.ts`, une fonction pure et deux écritures
// réparties sur trois lots. Ce qui est livré, et ce que ce test verrouille,
// c'est la version honnête d'ici là :
//
//   1. la dérive est RÉELLE — on la provoque, chiffres à l'appui : sans
//      cela la mention serait un ornement et on la retirerait un jour ;
//   2. donc chaque impression PORTE SA MENTION, et dit que deux impressions
//      peuvent différer ;
//   3. la vraie date d'édition figure au document — la date de réception de
//      la situation n'en a jamais été une ;
//   4. quand un certificat a été émis, le décompte le NOMME, donne son net
//      FIGÉ et dit que c'est lui qui fait foi — au lieu de laisser deux
//      chiffres se contredire en silence ;
//   5. et là où le figeage EXISTE (le certificat), deux impressions sont
//      identiques au caractère près, même après que l'état a bougé. C'est la
//      preuve que « figé » veut dire quelque chose dans ce dépôt — et le
//      gabarit que B1 devra reproduire.
//
// Le test RRND les documents pour de vrai : `window.open` est remplacé par un
// carnet, et c'est le HTML produit qui est examiné. Une assertion sur le code
// source dirait seulement que la phrase est écrite quelque part ; ici on
// vérifie qu'elle SORT sur le papier.

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

// --- le carnet : ce que le navigateur aurait affiché ------------------------
//
// `pdf.ts` ouvre un onglet et y écrit. On remplace l'onglet par un carnet :
// le module n'est pas modifié, c'est bien le HTML RÉELLEMENT produit qui est
// lu ici. `window` est posé AVANT le chargement pour que rien ne capture une
// référence morte.

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

const PDF = charger('src/pdf.ts')
const { construireCertificat, figerCertificat } = charger('src/certificat.ts')

/** imprime et rend le papier */
function imprimerDecompte(state, sit, editeLe) {
  derniereSortie = null
  PDF.ouvrirDecompteSituationPDF(state, sit, editeLe)
  assert.ok(derniereSortie, 'le décompte doit produire un document — sinon rien de ce qui suit ne veut dire quoi que ce soit')
  return derniereSortie
}

/** le HTML débarrassé de ses espaces de mise en forme monétaire : `fmtMoney`
 *  pose des espaces insécables fines, invisibles à l'œil et fatales à une
 *  comparaison littérale */
const sansEspaces = (s) => s.replace(/\s/g, ' ')

/** les montants du papier, dans l'ordre où ils y figurent — c'est ce que
 *  l'entreprise compare d'une feuille à l'autre */
function montantsDu(html) {
  const tableau = html.slice(html.indexOf('<table class="dc">'), html.indexOf('</table>'))
  return [...tableau.matchAll(/class="r">([^<]+)</g)].map((m) => sansEspaces(m[1]))
}

// --- le jeu d'essai : un chantier ordinaire, une situation validée ----------

const etat = () => ({
  settings: {
    nomAgence: 'Agence LL',
    siretAgence: '000 000 000 00000',
    personnes: ['Julien', 'Zoé'],
    tresorerieDispo: null,
  },
  projets: [{ id: 'P-EC', nom: 'École de Chamant', moa: 'Commune de Chamant', adresse: '3 rue du Marché, 60300 Chamant', phases: [] }],
  marches: [
    {
      id: 'M-GO',
      projetId: 'P-EC',
      entreprise: 'Gros œuvre du Valois',
      lot: 'Lot 2 — gros œuvre',
      montantInitialHT: 200000,
      avenantsHT: 0,
      tauxRG: 0.05,
      garantie: 'retenue',
      revision: false,
      delaiVerifJours: 15,
      actif: true,
    },
  ],
  situations: [
    {
      id: 'sit-1',
      projetId: 'P-EC',
      marcheId: 'M-GO',
      entreprise: 'Gros œuvre du Valois',
      lot: 'Lot 2 — gros œuvre',
      mois: '2026-05',
      numero: 1,
      montantMoisHT: 40000,
      montantCumulHT: 40000,
      revisionHT: null,
      statut: 'validee',
      dateReception: '2026-06-02',
    },
    {
      id: 'sit-2',
      projetId: 'P-EC',
      marcheId: 'M-GO',
      entreprise: 'Gros œuvre du Valois',
      lot: 'Lot 2 — gros œuvre',
      mois: '2026-06',
      numero: 2,
      montantMoisHT: 30000,
      montantCumulHT: 70000,
      revisionHT: null,
      statut: 'validee',
      dateReception: '2026-07-02',
    },
  ],
  indicesBTP: [],
  evenementsMarche: [],
  certificats: [],
  factures: [],
  paiements: [],
})

const situation = (e) => e.situations.find((s) => s.id === 'sit-2')

// ============================================================
// 1. La dérive est RÉELLE — c'est elle qui rend la mention nécessaire
// ============================================================
//
// Sans cette section, tout le reste serait un rituel : on répéterait une
// phrase sans savoir si elle décrit encore le code. On provoque donc
// l'accident exact que la mention annonce.

{
  const e = etat()
  const juillet = imprimerDecompte(e, situation(e), '2026-07-03')

  // même état, même situation, DEUX dates : seuls les montants comptent,
  // et ils doivent être rigoureusement les mêmes
  const memeJour = imprimerDecompte(etat(), situation(etat()), '2026-07-03')
  assert.deepEqual(
    montantsDu(juillet),
    montantsDu(memeJour),
    'à état égal, le décompte est déterministe — sinon aucun des contrôles suivants ne dirait rien',
  )

  // …puis la vie du chantier : le marché passe en garantie à première
  // demande (l'entreprise a fourni sa GPD après coup — cas courant, et le
  // défaut 5.1 du dépôt porte précisément là-dessus)
  const apres = etat()
  apres.marches[0].garantie = 'gpd'
  const reimpression = imprimerDecompte(apres, situation(apres), '2026-07-12')

  assert.notDeepEqual(
    montantsDu(juillet),
    montantsDu(reimpression),
    'LE DÉFAUT : la même situation, réimprimée neuf jours plus tard, ne porte plus les mêmes chiffres. ' +
      'Tant que la situation n’a pas son bloc figé (B1), c’est un FAIT — et c’est pour ce fait que la ' +
      'mention existe. Si cette assertion tombe, c’est que le décompte a été figé : retirez la mention ' +
      'du document et ce test avec, la bonne nouvelle est ailleurs.',
  )
  // et de combien : la ligne « net à payer ce mois HT » — celle que
  // l'entreprise lit en premier et que le comptable recopie
  const netDu = (html) => montantsDu(html).at(-2)
  assert.equal(netDu(juillet), '28 500,00 €', 'le 3 juillet, retenue de garantie déduite')
  assert.equal(netDu(reimpression), '30 000,00 €', 'le 12 juillet, la garantie couvre le marché — plus de retenue')
  assert.ok(
    netDu(juillet) !== netDu(reimpression),
    'l’écart n’est pas cosmétique : 1 500 € de plus sur la ligne que l’entreprise lit en premier, sur une ' +
      'feuille qui porte le même numéro de situation et le même mois',
  )
}

// ============================================================
// 2. Donc chaque impression porte sa mention
// ============================================================

{
  const e = etat()
  const html = imprimerDecompte(e, situation(e), '2026-07-03')

  assert.match(
    html,
    /Document reconstitué depuis l'état courant/,
    'le document doit ADMETTRE qu’il se recalcule : une pièce qui engage doit dire ce qu’elle est',
  )
  assert.match(
    html,
    /Deux impressions faites à deux dates peuvent donc différer/,
    'et dire la conséquence en clair — « reconstitué » seul ne se comprend pas au bout d’un an de dossier',
  )
  assert.match(
    html,
    /décompte de vérification n'est pas une pièce figée/,
    'le nom du document dit sa nature : « décompte de VÉRIFICATION », interne, pas un état d’acompte au MO',
  )

  // et le titre de la fenêtre ne promet rien d'autre
  assert.match(html, /<title>Décompte situation/, 'le document reste nommé pour ce qu’il est')
}

// ============================================================
// 3. La vraie date d'édition, pas la date de réception
// ============================================================
//
// Le document portait la date de RÉCEPTION de la situation comme date
// d'édition. Elle dit quand l'entreprise a envoyé sa demande — jamais quand
// la feuille est sortie de l'imprimante. Sur un document qui bouge, se
// tromper de date, c'est perdre le seul repère qui permettrait de savoir
// laquelle des deux feuilles est la plus récente.

{
  const e = etat()
  const troisJuillet = imprimerDecompte(e, situation(e), '2026-07-03')
  const douzeJuillet = imprimerDecompte(e, situation(e), '2026-07-12')

  assert.match(troisJuillet, /Édité le 03 juil\. 2026/, 'la date d’édition est celle du jour de l’impression')
  assert.match(douzeJuillet, /Édité le 12 juil\. 2026/, 'elle suit le jour où l’on imprime, pas la pièce')
  assert.match(troisJuillet, /Situation reçue le 02 juil\. 2026/, 'la date de réception reste dite — elle ne sert simplement plus de date d’édition')

  // et l'écran passe bien SA date (`useToday`) plutôt que de laisser jouer
  // le repli d'horloge : sans cela, la date du papier resterait juste par
  // accident, et un test d'horloge figée ne verrait jamais le défaut
  const ecran = lire('src/modules/Situations.tsx')
  const appels = [...ecran.matchAll(/ouvrirDecompteSituationPDF\(([^)]*)\)/g)].map((m) => m[1])
  assert.ok(appels.length >= 2, `l’écran des situations imprime le décompte depuis plusieurs endroits (${appels.length} trouvés)`)
  for (const args of appels)
    assert.match(
      args,
      /,\s*today\s*$/,
      `« ouvrirDecompteSituationPDF(${args}) » : l’écran doit passer SA date du jour — le repli d’horloge du module ne doit servir à personne`,
    )
}

// ============================================================
// 4. Le certificat émis est nommé, et c'est LUI qui fait foi
// ============================================================

{
  // sans certificat, le document le DIT — « null n'est pas 0 » : ne rien
  // dire laisserait croire que le décompte est la pièce contractuelle
  const vierge = etat()
  const sansCertificat = imprimerDecompte(vierge, situation(vierge), '2026-07-03')
  assert.match(
    sansCertificat,
    /Aucun certificat de paiement n'a encore été émis/,
    'aucune pièce certifiée : le document doit le dire, pas se taire',
  )
  assert.doesNotMatch(sansCertificat, /fait foi/, 'et ne pas parler d’une pièce qui n’existe pas')

  // on émet le certificat de la situation, puis on laisse le chantier bouger
  const e = etat()
  const construit = construireCertificat(e, 'sit-2')
  assert.ok(construit, 'la situation est rattachée à un marché : le certificat se construit')
  e.certificats.push(
    figerCertificat(construit, { id: 'cert-1', emisLe: '2026-07-08', emisPar: 'Julien' }),
  )
  const netCertifie = e.certificats[0].netAPayerTTC

  // la dérive de la section 1, APRÈS l'émission
  e.marches[0].garantie = 'gpd'
  const html = imprimerDecompte(e, situation(e), '2026-07-12')

  assert.match(html, /Certificat de paiement n° 2 émis le 08 juil\. 2026 par Julien/, 'le décompte NOMME la pièce figée : numéro, date, signataire')
  assert.match(html, /c'est le certificat qui fait foi/, 'et tranche : en cas d’écart, la pièce figée l’emporte')
  const attendu = `net à payer certifié ${netCertifie.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
  assert.ok(
    sansEspaces(html).includes(sansEspaces(attendu)),
    `le net rappelé doit être celui du certificat FIGÉ (« ${attendu} ») — le recopier depuis l'état courant ` +
      'ferait dire au décompte que le maître d’ouvrage a certifié un montant qu’il n’a jamais vu',
  )

  // le décompte, lui, a dérivé : les deux chiffres diffèrent, et c'est
  // exactement le moment où le document doit désigner l'arbitre
  const netRecalcule = charger('src/derive.ts').decompteSituation(e, situation(e)).netAPayerTTC
  assert.notEqual(
    Math.round(netRecalcule * 100),
    Math.round(netCertifie * 100),
    'le jeu d’essai doit VRAIMENT produire deux chiffres différents, sinon la phrase d’arbitrage ne se joue jamais',
  )
}

// ============================================================
// 5. Là où le figeage existe, il tient : deux impressions identiques
// ============================================================
//
// C'est le gabarit que B1 devra reproduire. On imprime le certificat, on
// dérègle l'état tout entier — marché, situations, réglages de l'agence —
// et on réimprime : le papier doit être identique au caractère près.

{
  const e = etat()
  const cert = figerCertificat(construireCertificat(e, 'sit-2'), {
    id: 'cert-1',
    emisLe: '2026-07-08',
    emisPar: 'Julien',
  })

  derniereSortie = null
  PDF.ouvrirCertificatPaiementPDF(cert)
  const premiere = derniereSortie

  // le chantier vit : avenant, garantie, révision, et même le nom de
  // l'agence changent. Rien de tout cela n'a le droit d'atteindre une pièce
  // déjà transmise au maître d'ouvrage.
  e.marches[0].avenantsHT = 12000
  e.marches[0].garantie = 'gpd'
  e.situations[1].montantCumulHT = 99000
  e.situations[1].revisionHT = 1234.56
  e.settings.nomAgence = 'Autre agence'

  derniereSortie = null
  PDF.ouvrirCertificatPaiementPDF(cert)
  assert.equal(
    derniereSortie,
    premiere,
    'un certificat ÉMIS se réimprime à l’identique quoi qu’il advienne de l’état : c’est ce que « figé » veut ' +
      'dire, et c’est la garantie que le décompte n’a pas encore. Si ceci tombe, une pièce signée transmise au ' +
      'maître d’ouvrage vient de changer toute seule.',
  )

  // et la raison structurelle : le générateur ne reçoit QUE la pièce figée.
  // Tant que sa signature ne prend pas l'état, aucune dérive ne peut entrer.
  assert.match(
    lire('src/pdf.ts'),
    /export function ouvrirCertificatPaiementPDF\(cert: CertificatPaiement\)/,
    'le générateur du certificat ne prend pas l’état : c’est par CONSTRUCTION qu’il ne peut pas dériver',
  )
}

console.log(
  'Décompte de situation : la dérive est prouvée (1 500 € d’écart sur le net à payer d’une impression à l’autre), ' +
    'chaque feuille porte sa mention « reconstitué depuis l’état courant » et sa vraie date d’édition, le ' +
    'certificat émis y est nommé comme la pièce qui fait foi — et le certificat, lui, se réimprime au ' +
    'caractère près après que le marché, les situations et l’agence ont changé.',
)
