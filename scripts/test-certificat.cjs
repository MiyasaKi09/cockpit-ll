// 5.19 — le certificat de paiement mensuel (état d'acompte) vers le MO.
//
// LE JEU D'ESSAI EST LE DOCUMENT RÉEL : l'état n° 4 de la MAM de Chamant,
// fourni par l'agence. Un assembleur de certificat qui se trompe d'un
// centime produit un document contractuel faux, signé, transmis à un maître
// d'ouvrage public — et personne ne recompte à la main un état d'acompte
// « calculé par l'outil ». Si construireCertificat + les surcharges
// documentées reproduisent CES chiffres au centime, l'assembleur est juste.
//
// Cinq garanties tenues :
//
//   1. l'état n° 4 au centime — base 63 000, avenants 2 407,30, avance
//      3 150 remboursée, acompte 4 054,60, révision 56,73 / 459,66 / 516,39,
//      TVA 810,92 + 11,35, total TTC 4 933,60, cumul TTC 74 890,67,
//      reste HT 3 514,80 ;
//   2. la surcharge est la règle, pas l'exception : la RG du document réel
//      (5 % × avenants TTC = 144,44, GPD sur la base) ne sort d'AUCUNE règle
//      générale — surchargée, le net tombe à 4 789,16 ; et corriger un
//      montant primaire recalcule les dérivés ;
//   3. la résorption de l'avance suit la proposition CCAG : rien avant 65 %
//      d'avancement, soldée à 80 %, linéaire entre les deux, jamais plus que
//      le reste ;
//   4. un certificat ÉMIS est FIGÉ : les indices changent, les propositions
//      bougent, le document émis ne bouge pas — et le PDF ne lit QUE le bloc
//      figé ; la numérotation propose max(états émis du marché) + 1, une
//      pénalité appliquée se déduit UNE fois ;
//   5. le câblage : collection normalisée au chargement, amorcée vide au
//      seed, module pur, écran qui fige au geste « Émettre ».

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

const C = charger('src/certificat.ts')

// --- le jeu d'essai : l'état n° 4 de la MAM de Chamant ----------------------
//
// Les chiffres ci-dessous sont ceux du document réel émis par l'agence,
// recopiés — pas recalculés. C'est la référence, le code doit y arriver.

const etatChamant = () => ({
  settings: {
    nomAgence: 'Agence LL',
    adresseAgence: '1 rue de l’Exemple, 60000 Beauvais',
    siretAgence: '000 000 000 00000',
    personnes: ['Julien', 'Zoé'],
  },
  projets: [
    {
      id: 'P-MAM',
      nom: 'MAM de Chamant',
      moa: 'Commune de Chamant',
      numeroEngagement: '2025-MAM-04',
      phases: [],
    },
  ],
  marches: [
    {
      id: 'M-MAM',
      projetId: 'P-MAM',
      entreprise: 'Entreprise du lot',
      lot: 'Lot — corps d’état',
      montantInitialHT: 63000,
      avenantsHT: 2407.3,
      tauxRG: 0.05,
      // le document réel : GARANTIE À PREMIÈRE DEMANDE sur le marché de base
      garantie: 'gpd',
      // avance forfaitaire 5 % × 63 000, intégralement remboursée avant l'état 4
      avanceForfaitaireHT: 3150,
      avanceRembourseeHT: 3150,
      revision: true,
      indiceRevision: 'BT01',
      moisZero: '2025-01',
      delaiVerifJours: 15,
      actif: true,
    },
  ],
  situations: [
    {
      id: 'sit-3',
      projetId: 'P-MAM',
      marcheId: 'M-MAM',
      entreprise: 'Entreprise du lot',
      mois: '2026-05',
      numero: 3,
      montantMoisHT: null,
      montantCumulHT: 57837.9, // l'« antérieur » du document réel
      revisionHT: 459.66, // les révisions antérieures cumulées
      statut: 'validee',
      dateReception: '2026-06-02',
    },
    {
      id: 'sit-4',
      projetId: 'P-MAM',
      marcheId: 'M-MAM',
      entreprise: 'Entreprise du lot',
      mois: '2026-06',
      numero: 4,
      montantMoisHT: 4054.6,
      montantCumulHT: 61892.5,
      revisionHT: 56.73, // révision du présent état, vérifiée (5.5)
      statut: 'validee',
      dateReception: '2026-07-02',
    },
  ],
  indicesBTP: [],
  evenementsMarche: [],
  certificats: [],
})

// la surcharge DOCUMENTÉE du document réel : la GPD couvre le marché de
// BASE, la RG s'applique à l'AVENANT, à 5 % de son montant TTC —
// 2 407,30 × 1,20 × 5 % = 144,44. Aucune règle générale ne produit ça :
// c'est une lecture contractuelle, exactement ce que `surcharges` existe
// pour porter (§15 — la machine propose, l'humain décide).
const SURCHARGE_RG_CHAMANT = { retenueGarantieTTC: 144.44 }

// --- 1. l'état n° 4 au centime, sans surcharge ------------------------------

{
  const c = C.construireCertificat(etatChamant(), 'sit-4')
  assert.ok(c, 'situation rattachée à un marché : le certificat se construit')
  const l = c.proposition

  assert.equal(l.baseHT, 63000)
  assert.equal(l.avenantsHT, 2407.3)
  assert.equal(l.totalMarcheHT, 65407.3)

  assert.equal(l.avanceInitialeHT, 3150, '5 % × 63 000 — le champ du marché, pas un recalcul')
  assert.equal(l.avanceRembourseeTotaleHT, 3150, 'intégralement remboursée avant l’état 4')
  assert.equal(l.avanceResteHT, 0)
  assert.equal(l.resorptionHT, 0, 'plus rien à résorber : l’avance est soldée')

  assert.equal(l.cumulHT, 61892.5, 'décompte n° 4 cumulé')
  assert.equal(l.anterieurHT, 57837.9, 'l’antérieur vient de la situation précédente')
  assert.equal(l.acompteHT, 4054.6, 'acompte = cumulé − antérieur, au centime')

  assert.equal(l.revisionHT, 56.73, 'la révision SAISIE sur la situation prime (demande vérifiée en 5.5)')
  assert.equal(l.revisionAnterieureHT, 459.66)
  assert.equal(l.revisionOrigineHT, 516.39)

  assert.equal(l.tauxTVA, 0.2)
  assert.equal(l.tvaAcompteHT, 810.92, 'TVA 20 % sur l’acompte')
  assert.equal(l.tvaRevisionHT, 11.35, 'TVA 20 % sur la révision — 11,346 arrondi au centime')
  assert.equal(l.tvaAvanceCumulHT, 630, 'la TVA payée sur l’avance au versement')
  assert.equal(l.totalTTC, 4933.6, 'total TTC du présent état')
  assert.equal(l.acompteTTCCumul, 74890.67, 'acomptes TTC cumulés depuis l’origine (avance versée − remboursée = 0)')

  assert.equal(l.penalitesHT, 0, 'aucune pénalité appliquée sur ce marché')
  assert.equal(l.retenueGarantieTTC, 0, 'GPD au marché ⇒ AUCUNE retenue proposée (autorité 5.1)')
  assert.equal(l.netAPayerTTC, 4933.6, 'sans la lecture contractuelle, le net serait le total')
  assert.equal(l.resteHT, 3514.8, 'reste à exécuter HT = 65 407,30 − 61 892,50')

  assert.equal(c.numeroPropose, 4, 'aucun certificat émis : le n° du décompte sert de proposition')
  assert.equal(c.entete.moa, 'Commune de Chamant')
  assert.equal(c.entete.garantie, 'gpd', 'l’en-tête dit POURQUOI la ligne E vaut ce qu’elle vaut')
}

// --- 2. la surcharge documentée reproduit le NET du document réel -----------

{
  const c = C.construireCertificat(etatChamant(), 'sit-4', SURCHARGE_RG_CHAMANT)
  assert.equal(c.lignes.retenueGarantieTTC, 144.44, 'la lecture contractuelle remplace la proposition')
  assert.equal(c.lignes.netAPayerTTC, 4789.16, 'LE chiffre du document réel : 4 933,60 − 144,44')
  assert.equal(c.lignes.totalTTC, 4933.6, 'la surcharge de la retenue ne touche pas le total TTC')
  assert.equal(c.proposition.retenueGarantieTTC, 0, 'la proposition reste visible FACE à la correction')

  // corriger un montant PRIMAIRE recalcule les dérivés — corriger le cumul
  // doit faire bouger l'acompte, la TVA et le net sous les yeux
  const corrige = C.construireCertificat(etatChamant(), 'sit-4', { cumulHT: 62000 })
  assert.equal(corrige.lignes.acompteHT, 4162.1, '62 000 − 57 837,90')
  assert.equal(corrige.lignes.tvaAcompteHT, 832.42)
  assert.equal(corrige.lignes.resteHT, 3407.3, 'le reste à exécuter suit le cumul corrigé')

  // et un dérivé surchargé prime sur son recalcul : le document imprime la
  // valeur RETENUE, quelle que soit la ligne corrigée
  const net = C.construireCertificat(etatChamant(), 'sit-4', { netAPayerTTC: 4000 })
  assert.equal(net.lignes.netAPayerTTC, 4000, 'n’importe quelle ligne se corrige, y compris le net')

  const numero = C.construireCertificat(etatChamant(), 'sit-4', { numero: 12 })
  assert.equal(numero.numero, 12, 'le numéro aussi est une proposition')
  assert.equal(numero.numeroPropose, 4, 'la proposition reste dite')
}

// --- 3. la résorption de l'avance : la règle CCAG 65 % → 80 % ---------------

{
  assert.equal(C.resorptionProposee(3150, 0, 0.5), 0, 'sous 65 % d’avancement, rien à résorber')
  assert.equal(C.resorptionProposee(3150, 0, 0.725), 1575, 'à mi-chemin (72,5 %), la moitié de l’avance')
  assert.equal(C.resorptionProposee(3150, 0, 0.8), 3150, 'à 80 %, l’avance est soldée')
  assert.equal(C.resorptionProposee(3150, 0, 0.95), 3150, 'au-delà : jamais plus que l’avance')
  assert.equal(C.resorptionProposee(3150, 1575, 0.8), 1575, 'le déjà-remboursé se déduit de la cible')
  assert.equal(C.resorptionProposee(3150, 3150, 0.95), 0, 'avance soldée : plus rien — le cas Chamant')
  assert.equal(C.resorptionProposee(0, 0, 0.9), 0, 'pas d’avance au marché : rien à résorber')

  // en situation : un marché à 94,6 % d'avancement, avance NON remboursée —
  // la proposition solde, et elle reste une proposition
  const etat = etatChamant()
  etat.marches[0].avanceRembourseeHT = 0
  const c = C.construireCertificat(etat, 'sit-4')
  assert.equal(c.proposition.resorptionHT, 3150, '94,6 % ≥ 80 % : la résorption proposée solde l’avance')
  assert.equal(
    c.proposition.totalTTC,
    Math.round((4933.6 - 3150 * 1.2) * 100) / 100,
    'la résorption se déduit TTC du présent état (l’avance a été versée TTC)',
  )
  assert.equal(c.proposition.avanceResteHT, 0, 'après résorption, plus de reste')
}

// --- 4a. un certificat ÉMIS est FIGÉ : les indices changent, pas lui --------

{
  // marché SANS révision saisie sur la situation : le théorique 5.4 propose
  const etat = etatChamant()
  etat.situations[1].revisionHT = null
  etat.indicesBTP = [
    { id: 'i1', indice: 'BT01', mois: '2025-01', valeur: 100 },
    { id: 'i2', indice: 'BT01', mois: '2026-06', valeur: 110 },
  ]
  const avant = C.construireCertificat(etat, 'sit-4')
  // coefficient 0,15 + 0,85 × 1,1 = 1,085 ⇒ révision = 4 054,60 × 0,085
  assert.equal(avant.proposition.revisionHT, 344.64, 'sans saisie, le théorique 5.4 propose (sur l’acompte du mois)')

  const fige = C.figerCertificat(avant, { id: 'cert-1', emisLe: '2026-07-10', emisPar: 'Julien' })
  assert.equal(fige.lignes.revisionHT, 344.64)
  assert.equal(fige.netAPayerTTC, fige.lignes.netAPayerTTC, 'le net recopié en tête l’est depuis les lignes figées')

  // l'INSEE publie l'indice définitif : la PROPOSITION bouge…
  etat.indicesBTP[1].valeur = 120
  const apres = C.construireCertificat(etat, 'sit-4')
  assert.equal(apres.proposition.revisionHT, 689.28, 'l’indice corrigé change la proposition (coef 1,17)')
  // …le certificat émis, lui, ne bouge PAS : recalculer un document signé
  // avec d'autres indices réécrirait ce qui a été transmis au MO
  assert.equal(fige.lignes.revisionHT, 344.64, 'le certificat émis est FIGÉ — les indices n’y touchent plus')

  // la copie est PROFONDE : muter le construit après coup ne traverse pas
  avant.lignes.revisionHT = 9999
  avant.entete.agence.nom = 'Autre agence'
  assert.equal(fige.lignes.revisionHT, 344.64, 'figer copie les lignes, il ne garde pas une référence')
  assert.equal(fige.entete.agence.nom, 'Agence LL', 'l’en-tête aussi est copié en profondeur')
}

// --- 4b. numérotation, antérieur certifié, pénalité déduite UNE fois --------

{
  const etat = etatChamant()
  // un état 3 déjà ÉMIS : cumul certifié 57 837,90, révisions 459,66,
  // une pénalité de 300 déjà déduite
  etat.certificats = [
    {
      id: 'cert-3',
      marcheId: 'M-MAM',
      projetId: 'P-MAM',
      situationId: 'sit-3',
      numero: 7, // volontairement ≠ n° de situation : c'est LUI qui compte
      mois: '2026-05',
      entete: {},
      lignes: { cumulHT: 57837.9, revisionOrigineHT: 459.66, penalitesHT: 300 },
      netAPayerTTC: 0,
      emisLe: '2026-06-10',
      emisPar: 'Julien',
    },
  ]
  // la pénalité appliquée du marché (5.2) : 300 €, déjà déduites sur l'état 7
  etat.evenementsMarche = [
    {
      id: 'ev-1',
      marcheId: 'M-MAM',
      projetId: 'P-MAM',
      type: 'absence_reunion',
      date: '2026-05-12',
      commentaire: 'absence CR n° 18',
      penaliteAppliquee: true,
      penaliteMontantHT: 300,
    },
  ]
  const c = C.construireCertificat(etat, 'sit-4')
  assert.equal(c.numeroPropose, 8, 'max(numero des états émis du marché) + 1 = 7 + 1')
  assert.equal(c.proposition.anterieurHT, 57837.9, 'l’antérieur vient du dernier certificat ÉMIS (le cumul certifié au MO)')
  assert.equal(c.proposition.revisionAnterieureHT, 459.66, 'les révisions antérieures aussi')
  assert.equal(
    c.proposition.penalitesHT,
    0,
    'une pénalité déduite sur l’état précédent ne se re-déduit pas : l’entreprise la paierait deux fois',
  )

  // pénalité appliquée NON encore déduite : elle se propose, et le net baisse
  etat.certificats[0].lignes.penalitesHT = 0
  const avecPenalite = C.construireCertificat(etat, 'sit-4')
  assert.equal(avecPenalite.proposition.penalitesHT, 300, 'la pénalité APPLIQUÉE (5.2) se déduit — jamais l’encourue')
  assert.equal(avecPenalite.proposition.netAPayerTTC, 4633.6, '4 933,60 − 300 (hors champ TVA)')
}

// --- 4c. sans marché rattaché, pas de certificat ----------------------------

{
  const etat = etatChamant()
  etat.situations[1].marcheId = null
  etat.situations[1].entreprise = 'Entreprise inconnue au registre'
  assert.equal(
    C.construireCertificat(etat, 'sit-4'),
    null,
    'sans marché : ni base, ni avance, ni garantie — rien à certifier, et l’écran le dit',
  )
  assert.equal(C.construireCertificat(etatChamant(), 'sit-inexistante'), null, 'situation inconnue : null, pas un plantage')
}

// --- 5. le câblage dans l'application ---------------------------------------

{
  // logique PURE (règle du dépôt) : pas de store, pas d'horloge, pas de réseau
  const src = lire('src/certificat.ts')
  assert.doesNotMatch(
    src,
    /useStore|localStorage|fetch\(|Date\.now|new Date\(/,
    'certificat.ts doit rester pur : l’état et la date d’émission sont des ARGUMENTS',
  )

  // collection normalisée au chargement (modèle chronos/pointages), amorcée
  // VIDE au seed — un certificat d'exemple ressemblerait à un document émis
  assert.match(
    lire('src/store.tsx'),
    /etat\.certificats = Array\.isArray\(parsed\.certificats\) \? parsed\.certificats : \[\]/,
    'certificats doit être normalisée dans migrate() comme les autres collections',
  )
  assert.match(lire('src/seed.ts'), /certificats: \[\]/, 'le seed amorce la collection — VIDE')

  // l'avance forfaitaire vit sur le marché (types), pour être saisie et migrée
  const types = lire('src/types.ts')
  assert.match(types, /avanceForfaitaireHT\?: number \| null/, 'Marche.avanceForfaitaireHT est typé')
  assert.match(types, /avanceRembourseeHT\?: number \| null/, 'Marche.avanceRembourseeHT est typé')

  // le PDF ne lit QUE le bloc figé : pas d'état, pas de reconstruction —
  // c'est ce qui rend la réimpression stable par CONSTRUCTION
  const pdf = lire('src/pdf.ts')
  assert.match(pdf, /export function ouvrirCertificatPaiementPDF\(cert: CertificatPaiement\)/, 'le générateur prend le certificat FIGÉ, rien d’autre')
  assert.doesNotMatch(pdf, /construireCertificat/, 'le PDF ne reconstruit jamais : réimprimer ≠ recalculer')
  assert.match(pdf, /BON À PAYER LE/, 'le cartouche du maître d’ouvrage — c’est lui qui décide de payer')
  assert.match(pdf, /Présent état/, 'la colonne « présent état » du document réel')
  assert.match(pdf, /Cumulés depuis l'origine/, 'la colonne « cumulés depuis l’origine » du document réel')

  // le module des vues de situation : construire (propositions + corrections),
  // FIGER au geste « Émettre », rouvrir un émis en réimpression.
  //
  // TRANCHE 3 — ce fichier n'est plus un ÉCRAN (il n'a plus d'export par
  // défaut : `#/situations` monte `<Entreprises />`), il est le module qui
  // définit les quatre vues et les deux modales contractuelles. Rien de ce que
  // ce bloc vérifie n'en dépend : le code du geste n'a pas bougé d'un octet, il
  // est monté ailleurs. Le mot « écran » est corrigé pour qu'on ne cherche pas
  // une `Page` qui n'existe plus.
  const ecran = lire('src/modules/Situations.tsx')
  assert.match(ecran, /construireCertificat/, 'la modale construit depuis la situation')
  assert.match(ecran, /figerCertificat/, 'le geste « Émettre » fige')
  assert.match(ecran, /d\.certificats\.push/, 'le certificat émis rejoint la collection')
  assert.match(ecran, /certificatDeSituation/, 'un émis se retrouve — et se rouvre en réimpression')
  assert.match(ecran, /avanceRembourseeApresEmission/, 'la résorption émise avance le compteur du marché')
}

// --- UN SEUL CHEMIN POUR ÉMETTRE, QUEL QUE SOIT LE NOMBRE DE PORTES -------
//
// 5.21 a ouvert le cycle mensuel depuis TROIS écrans : l'onglet Situations,
// la fiche entreprise et l'onglet Chantier du projet. C'était la demande de
// l'agence — « faut pouvoir gérer aussi sur chaque chantier dans la fiche
// projet » — et c'est aussi le moment précis où un dépôt se met à produire
// deux documents contractuels différents pour la même situation.
//
// La règle n'est pas « un seul écran » : c'est UN SEUL AUTEUR. Les portes
// doivent mener au même composant, celui qui numérote, fige et signe.
// Un second `ModalCertificat` écrit ailleurs, même fidèlement copié, dériverait
// au premier correctif appliqué d'un seul côté — et rien ne dirait lequel des
// deux papiers fait foi.
//
// TRANCHE 3 — LES PORTES ONT CHANGÉ, PAS LA RÈGLE, ET LE CONTRÔLE A DÛ ÊTRE
// DURCI POUR LE RESTER.
// --------------------------------------------------------------------------
// Le §7.4 du plan l'annonçait : « on passe de trois adresses à deux —
// Situations perd la sienne au profit d'Entreprises — sans toucher au code,
// qui est verrouillé pour qu'il n'y ait qu'un seul auteur ». C'est ce qui a été
// fait : `ModalCertificat` est restée définie dans Situations.tsx, qui n'est
// plus un écran mais le module des vues de situation.
//
// Sauf que ce contrôle-ci NE LISAIT QUE TROIS FICHIERS NOMMÉS. Un second
// `ModalCertificat` écrit dans Entreprises.tsx — l'écran qui monte désormais
// les cartes, donc le premier endroit où l'on serait tenté d'en recopier une —
// serait passé au vert. L'assertion suit donc le déménagement en cessant d'être
// une liste : elle balaie TOUT src/. Elle ne peut plus s'affaiblir par
// omission, et elle vaut aussi pour les portes qui n'existent pas encore.
// C'est un document contractuel : deux auteurs voudraient dire deux vérités
// possibles, et personne pour dire laquelle a été remise à l'entreprise.

const fichiersSrc = (dossier) => {
  const out = []
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, e.name)
    if (e.isDirectory()) out.push(...fichiersSrc(complet))
    else if (/\.tsx?$/.test(e.name)) out.push(path.relative(racine, complet))
  }
  return out.sort()
}

{
  const TOUT_SRC = fichiersSrc(path.join(racine, 'src'))
  assert.ok(TOUT_SRC.length > 40, `le balayage de src/ ne rend que ${TOUT_SRC.length} fichiers : la lecture est cassée`)

  const definitions = TOUT_SRC.filter((f) =>
    /function ModalCertificat|const ModalCertificat\s*[:=]/.test(lire(f)),
  )
  assert.deepEqual(
    definitions,
    ['src/modules/Situations.tsx'],
    'UN SEUL fichier DÉFINIT le geste d’émission, dans TOUT src/ ; les autres l’IMPORTENT.\n' +
      `  constaté : [${definitions.join(', ')}]\n` +
      '  Deux définitions = deux certificats possibles pour la même situation, et aucun moyen de\n' +
      '  savoir lequel a été remis à l’entreprise. Le balayage est global depuis la tranche 3 : une\n' +
      '  liste de fichiers nommés laissait passer une copie écrite dans un écran neuf — et la tranche 3\n' +
      '  en a justement fait un nouveau porteur des cartes (Entreprises.tsx).',
  )

  // LES PORTES, NOMMÉES. Ce ne sont plus les trois de 5.21 : `#/situations` a
  // cessé d'être une destination, et c'est Entreprises qui a repris sa vue.
  // Chacune doit IMPORTER, jamais définir — et le fait qu'elles soient nommées
  // ici est ce qui rend visible le jour où l'une disparaît.
  const PORTES_DU_CERTIFICAT = {
    // la fiche d'une entreprise : c'est là que le décompte figé se réimprime
    'src/modules/FicheEntreprise.tsx': 'la fiche entreprise (portefeuille du titulaire)',
    // « faut pouvoir gérer aussi sur chaque chantier » — la demande de l'agence
    'src/modules/ProjetChantier.tsx': 'l’onglet Chantier du projet',
  }

  for (const [fichier, quoi] of Object.entries(PORTES_DU_CERTIFICAT)) {
    assert.match(
      lire(fichier),
      /import \{[^}]*ModalCertificat[^}]*\} from '\.\/Situations'/,
      `${fichier} ouvre le cycle mensuel (${quoi}) : il doit IMPORTER ModalCertificat, pas en écrire un.`,
    )
  }

  // ET LA PORTE QUI A REMPLACÉ SITUATIONS. Le certificat s'émet depuis la
  // carte « À vérifier » et se réimprime depuis l'historique : si Entreprises
  // cessait de monter ces deux cartes, le geste ne disparaîtrait pas du code —
  // il disparaîtrait de la seule vue transverse qui le portait, et personne
  // n'aurait rien à corriger pour que ce test reste vert. C'est le contrôle qui
  // manquait : le §7.4 promet DEUX adresses, pas une.
  const entreprises = lire('src/modules/Entreprises.tsx')
  assert.match(
    entreprises,
    /import \{[\s\S]*?\} from '\.\/Situations'/,
    'src/modules/Entreprises.tsx a repris la vue Situations (tranche 3) : il doit importer ses cartes.',
  )
  for (const carte of ['CarteAVerifier', 'CarteHistorique']) {
    assert.match(
      entreprises,
      new RegExp(`<${carte}\\b`),
      `src/modules/Entreprises.tsx ne monte plus <${carte} />.\n` +
        '  Le §7.4 du plan promet DEUX adresses pour le certificat de paiement — Entreprises et l’onglet\n' +
        '  Chantier — parce que l’agence a demandé de « pouvoir gérer aussi sur chaque chantier ». Cette\n' +
        '  carte est la porte d’Entreprises : sans elle, la vue transverse ne permet plus ni d’émettre\n' +
        '  (CarteAVerifier) ni de réimprimer un décompte figé (CarteHistorique), et il ne reste qu’une\n' +
        '  porte. Le code du geste, lui, serait toujours là : rien d’autre ne le signalerait.',
    )
  }

  // et le figeage lui-même n'a qu'un auteur, où qu'on l'appelle — balayé sur
  // TOUT src/ pour la même raison que ci-dessus : une liste de quatre fichiers
  // nommés ne dit rien du cinquième.
  const auteurs = TOUT_SRC.filter((f) => /function figerCertificat|const figerCertificat\s*=/.test(lire(f)))
  assert.deepEqual(auteurs, ['src/certificat.ts'], 'le figeage s’écrit dans src/certificat.ts et nulle part ailleurs')
}

console.log(
  'Certificat de paiement : l’état n° 4 de la MAM de Chamant reproduit au centime (net 4 789,16 avec la ' +
    'surcharge contractuelle de RG), résorption CCAG 65 → 80 % proposée jamais imposée, certificat émis ' +
    'FIGÉ (les indices bougent, pas lui), numérotation max + 1, pénalité appliquée déduite une seule fois, ' +
    'PDF depuis le seul bloc figé et geste « Émettre » à l’écran.',
)
