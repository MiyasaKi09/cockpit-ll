// 5.16 — cycle de vie Chorus Pro rapatrié depuis le portail (via PISTE).
//
// L'import CSV du cycle de vie existait et reste le repli. Ce qui arrive ici,
// c'est la lecture AUTOMATIQUE du portail — et avec elle quatre façons de se
// tromper en silence, que ce test ferme :
//
//   1. LES DOMAINES. `aife.economie.gouv.fr` ne résout plus (NXDOMAIN) et
//      figure encore dans la doc anglaise de Chorus Pro ; `*.rie.gouv.fr` est
//      le réseau de l'État, injoignable d'une agence privée. Seules quatre
//      adresses `piste.gouv.fr` doivent être écrites. Le test les lit dans
//      l'ARBRE (un domaine mort CITÉ dans l'avertissement n'est pas un domaine
//      APPELÉ — une recherche de texte confondrait les deux).
//   2. L'AUTHENTIFICATION EST DOUBLE : `Authorization: Bearer` (l'application
//      PISTE) ET `cpro-account: base64(login:motdepasse)` (la structure Chorus
//      Pro). Mettre le second dans `Authorization` écrase le premier.
//   3. HTTP 200 N'EST PAS UN SUCCÈS. Chorus répond 200 avec un `codeRetour`
//      non nul pour ses erreurs métier. Un relais qui ne lirait que le code
//      HTTP rendrait zéro facture, et l'écran afficherait « aucune facture »
//      là où il fallait lire « structure non habilitée ».
//   4. LE RATTACHEMENT EST PAR NUMÉRO, et il ne devine pas. Une facture du
//      portail sans correspondance est SIGNALÉE, jamais rattachée au plus
//      proche — et resynchroniser, ou synchroniser après avoir importé le CSV
//      du même jour, n'ajoute AUCUNE ligne.
//
// Et la garantie du §15, qui n'est pas une intention : `chorus.ts` porte une
// liste FERMÉE de chemins de LECTURE, et `appelChorus` refuse les autres avant
// le moindre octet réseau. Le test le vérifie sur les chemins d'écriture réels
// (`soumettreFacture`, `deposerFluxFacture`, `traiterFactureRecue`) en
// fournissant un `fetch` qui LÈVE : si l'appel partait, le test le saurait.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8')

// 1. les deux fichiers Deno compilent sans erreur de syntaxe/type de surface
for (const f of ['supabase/functions/chorus-sync/chorus.ts', 'supabase/functions/chorus-sync/index.ts']) {
  const r = ts.transpileModule(lire(f), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: f, reportDiagnostics: true,
  })
  const erreurs = (r.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error)
  assert.equal(erreurs.length, 0, `${f}: ${erreurs.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`)
}
console.log('OK — les deux fichiers Deno transpilent.')

// 2. le module pur chorus.ts, exécuté
const cache = new Map()
function charger(chemin) {
  const fichier = chemin.endsWith('.ts') ? chemin : `${chemin}.ts`
  if (cache.has(fichier)) return cache.get(fichier)
  const compile = ts.transpileModule(lire(fichier), { fileName: fichier, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  cache.set(fichier, mod.exports)
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (id.startsWith('.')) return charger(path.posix.join(path.posix.dirname(fichier), id))
    throw new Error(`Dépendance externe inattendue dans ${fichier} : ${id}`)
  })
  cache.set(fichier, mod.exports)
  return mod.exports
}
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64')
const C = charger('supabase/functions/chorus-sync/chorus.ts')

// domaines : piste.gouv.fr seulement, aucun aife.economie
// vus par le compilateur : un domaine CITÉ en commentaire (l'avertissement)
// n'est pas un domaine APPELÉ. Une recherche de texte confondrait les deux.
function urlsEcrites(chemin) {
  const sf = ts.createSourceFile(chemin, lire(chemin), ts.ScriptTarget.ES2022, true)
  const trouvees = []
  const parcourir = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { if (/^https?:/.test(n.text)) trouvees.push(n.text) }
    ts.forEachChild(n, parcourir)
  }
  parcourir(sf)
  return trouvees
}
const urls = [...urlsEcrites('supabase/functions/chorus-sync/chorus.ts'), ...urlsEcrites('supabase/functions/chorus-sync/index.ts')]
assert.ok(urls.length >= 3, 'le balayage doit voir les adresses PISTE')
for (const u of urls) {
  assert.ok(!/aife\.economie\.gouv\.fr/.test(u), `${u} : domaine mort (NXDOMAIN)`)
  assert.ok(!/rie\.gouv\.fr/.test(u), `${u} : réseau de l'État, injoignable depuis une agence privée`)
  assert.ok(/^https:\/\/(sandbox-)?(oauth|api)\.piste\.gouv\.fr(\/|$)/.test(u), `${u} : hors des quatre adresses PISTE`)
}

// double authentification
assert.equal(C.enteteCompteTechnique('CPRO_TEST', 'motdepasse'), Buffer.from('CPRO_TEST:motdepasse').toString('base64'))
assert.equal(C.enteteCompteTechnique('lögin', 'ét€'), Buffer.from('lögin:ét€', 'utf8').toString('base64'), 'UTF-8, pas Latin-1')

// liste FERMÉE : aucune écriture ne part.
// Le refus doit être MÉCANIQUE — pas « personne n'a écrit l'appel ». Le
// `fetch` fourni LÈVE : si le moindre octet partait, ce test le dirait.
assert.equal(C.estCheminDeLecture('/cpro/factures/v1/consulter/historique'), true)
for (const interdit of C.CHEMINS_INTERDITS) assert.equal(C.estCheminDeLecture(interdit), false, interdit)
const reseauInterdit = () => {
  throw new Error('le réseau ne doit PAS être touché')
}
const refus = Promise.all(
  [...C.CHEMINS_INTERDITS, '/cpro/factures/v1/soumettre/', '/cpro/transverses/v1/quelconque'].map((chemin) =>
    assert.rejects(
      () => C.appelChorus('https://api.piste.gouv.fr', chemin, {}, {}, reseauInterdit),
      /LECTURE SEULE/,
      `${chemin} doit être refusé AVANT le réseau : une facture rejetée se corrige et se redépose à la main`,
    ),
  ),
)

// erreurs : 200 avec codeRetour non nul = échec métier, pas un succès
assert.equal(C.lireReponseChorus(200, { codeRetour: 0, listeFactures: [] }).genre, 'ok')
assert.equal(C.lireReponseChorus(200, { codeRetour: 55, libelle: 'Structure non habilitée' }).genre, 'metier')
assert.equal(C.lireReponseChorus(200, { codeRetour: 55, libelle: 'Structure non habilitée' }).message, 'Structure non habilitée')
assert.equal(C.lireReponseChorus(400, { error: 'invalid_client' }).genre, 'identifiants')
assert.equal(C.lireReponseChorus(401, {}).genre, 'compte_technique')
assert.equal(C.lireReponseChorus(403, {}).genre, 'habilitation')
assert.equal(C.lireReponseChorus(404, {}).genre, 'chemin')
assert.equal(C.lireReponseChorus(429, {}).genre, 'quota')
assert.equal(C.lireReponseChorus(503, {}).genre, 'indisponible')

// dates : les deux écritures, et rien d'inventé
assert.equal(C.dateChorus('05/08/2026'), '2026-08-05')
assert.equal(C.dateChorus('2026-08-05T11:02:00Z'), '2026-08-05')
assert.equal(C.dateChorus(''), null)
assert.equal(C.dateChorus(undefined), null)
assert.equal(C.jourChorus('2026-08-05'), '05/08/2026')

// normalisation tolérante
const f1 = C.normaliserFactureChorus({ numeroFacture: '2026-050', idFacture: '99', statutCourantCode: 'rejetee', dateDepot: '01/08/2026', montantATtc: '1200,50', designationDestinataire: 'Ville de Senlis' })
assert.equal(f1.statutPortail, 'REJETEE', 'le code est normalisé en majuscules')
assert.equal(f1.montantTTC, 1200.5)
assert.equal(f1.dateStatut, '2026-08-01')
assert.equal(C.normaliserFactureChorus({ numeroFacture: '2026-051' }), null, 'sans statut, la ligne ne dit rien')

// le motif se cherche en profondeur
assert.equal(C.motifChorus({ a: { b: [{ motifRefus: 'SIRET destinataire inconnu' }] } }), 'SIRET destinataire inconnu')
assert.equal(C.motifChorus({ a: 1 }), null, 'aucun motif ⇒ null, jamais une phrase inventée')

// liste de factures : conteneur inconnu ⇒ on nomme les clés reçues
const l1 = C.listeFacturesChorus({ codeRetour: 0, listeFactures: [{ numeroFacture: 'A' }] })
assert.equal(l1.liste.length, 1)
const l2 = C.listeFacturesChorus({ codeRetour: 0, quelqueChose: 'x' })
assert.equal(l2.liste.length, 0)
assert.deepEqual(l2.clesVues, ['codeRetour', 'quelqueChose'])

// le corps de requête n'invente pas d'identifiant
const corps = C.corpsRechercheFournisseur({ debut: '2026-05-01', fin: '2026-08-06', page: 1, parPage: 100, idUtilisateur: null, idEspace: null })
assert.ok(!('idUtilisateurCourant' in corps), 'absent ⇒ pas envoyé (0 serait une valeur inventée)')
assert.equal(corps.facture.dateDepotDu, '01/05/2026')
assert.equal(C.entierOuNull(''), null)
assert.equal(C.entierOuNull('12'), 12)

// détail : nominal = pas d'appel, inconnu = appel (mieux un appel de trop qu'un rejet sans motif)
assert.equal(C.meriteUnDetail('MISE_EN_PAIEMENT'), false)
assert.equal(C.meriteUnDetail('REJETEE'), true)
assert.equal(C.meriteUnDetail('CODE_INVENTE_2029'), true)

console.log('OK — chorus.ts : domaines, double auth, liste fermée, erreurs 200/4xx, dates, tolérance des champs.')

// alerts.ts se charge SANS pile réseau (chorusApi n'importe le client Supabase qu'en TYPE)
const A = charger('src/alerts.ts')
const CH = charger('src/chorusApi.ts')
const F = charger('src/facture.ts')
const I = charger('src/imports.ts')
console.log('OK — alerts.ts + chorusApi.ts se chargent sans dépendance externe.')

// --- 1. projection des statuts : le comportement d'un côté, les mots de l'autre
assert.equal(CH.lireCodeStatutChorus('REJETEE').statut, 'rejetee')
assert.equal(CH.lireCodeStatutChorus('SUSPENDUE').statut, 'rejetee')
assert.equal(CH.lireCodeStatutChorus('A_COMPLETER').statut, 'rejetee')
assert.equal(CH.lireCodeStatutChorus('A_RECYCLER').exigeUneAction, true)
assert.equal(CH.lireCodeStatutChorus('SUSPENDUE').libelle, 'suspendue', 'le MOT reste celui du portail')
assert.equal(CH.lireCodeStatutChorus('MISE_EN_PAIEMENT').statut, 'payee')
assert.equal(CH.lireCodeStatutChorus('COMPTABILISEE').statut, 'payee')
assert.equal(CH.lireCodeStatutChorus('VALIDEE').statut, 'approuvee')
assert.equal(CH.lireCodeStatutChorus('MISE_A_DISPOSITION_COMPTABLE').statut, 'mise_a_disposition')
assert.equal(CH.lireCodeStatutChorus('CODE_INVENTE_2029').statut, null, 'un code inconnu ne se projette pas')
assert.equal(CH.lireCodeStatutChorus('CODE_INVENTE_2029').libelle, 'CODE_INVENTE_2029', '… et s’affiche tel quel')
assert.equal(CH.lireCodeStatutChorus(null).statut, null)

// --- 2. rattachement PAR NUMÉRO, et rien d'autre
const facture = (o) => ({ id: 'f1', projetId: 'P01', phase: 'DET', libelle: 'Honoraires', montantHT: 1000, tauxTVA: 0.2, emission: '2026-07-01', delaiJours: 30, statut: 'emise', ...o })
const factures = [facture({ id: 'f1', numero: '2026-050' }), facture({ id: 'f2', numero: '2026-051' })]
const chorus = (o) => ({ numero: '2026-050', idFacture: '99', statutPortail: 'REJETEE', dateStatut: '2026-08-05', destinataire: 'Ville de Senlis', montantTTC: 1200, motif: 'SIRET destinataire inconnu', historique: [], ...o })

let r = CH.rattacherCycleVieChorus(factures, [chorus()], '2026-08-06')
assert.equal(r.ajouts.length, 1)
assert.equal(r.ajouts[0].factureId, 'f1')
assert.equal(r.ajouts[0].evenement.statut, 'rejetee')
assert.equal(r.ajouts[0].evenement.statutPortail, 'REJETEE')
assert.equal(r.ajouts[0].evenement.motif, 'SIRET destinataire inconnu')
assert.equal(r.inconnues.length, 0)

// une facture du portail sans correspondance est SIGNALÉE, jamais rattachée au plus proche
r = CH.rattacherCycleVieChorus(factures, [chorus({ numero: '2026-05' }), chorus({ numero: '2026-0500' })], '2026-08-06')
assert.equal(r.ajouts.length, 0, 'aucun rapprochement approximatif : ni préfixe, ni voisin')
assert.equal(r.inconnues.length, 2)
assert.equal(r.inconnues[0].numero, '2026-05')
assert.equal(r.inconnues[0].vueLe, '2026-08-06')

// casse et accents tolérés — la clé `fold`, exactement celle de l'import CSV
r = CH.rattacherCycleVieChorus([facture({ id: 'f9', numero: 'FA-2026-Été' })], [chorus({ numero: 'fa-2026-ete' })], '2026-08-06')
assert.equal(r.ajouts.length, 1, 'même normalisation que l’import CSV (fold)')

// une facture SANS numéro légal se rattache par son identifiant interne
r = CH.rattacherCycleVieChorus([facture({ id: '2026-D01', numero: undefined })], [chorus({ numero: '2026-D01' })], '2026-08-06')
assert.equal(r.ajouts.length, 1, 'numero || id — la règle de l’import CSV')

// --- 3. idempotence : rejouer n'écrit rien, y compris après un import CSV
const evCsv = I.lireCycleVieCSV('numero;statut;date;motif\n2026-050;rejetée;2026-08-05;SIRET destinataire inconnu')[0]
const apresCsv = [facture({ id: 'f1', numero: '2026-050', transmissions: [{ date: evCsv.date, plateforme: 'chorus', statut: evCsv.statut, motif: evCsv.motif }] })]
r = CH.rattacherCycleVieChorus(apresCsv, [chorus()], '2026-08-06')
assert.equal(r.ajouts.length, 0, 'le CSV a déjà consigné ce rejet : la synchro n’en fait pas un doublon')
assert.equal(r.dejaConnus, 1)

// deux passages de synchro d'affilée
let etat = [facture({ id: 'f1', numero: '2026-050' })]
const p1 = CH.rattacherCycleVieChorus(etat, [chorus()], '2026-08-06')
etat = [{ ...etat[0], transmissions: p1.ajouts.map((a) => a.evenement) }]
const p2 = CH.rattacherCycleVieChorus(etat, [chorus()], '2026-08-07')
assert.equal(p2.ajouts.length, 0, 'resynchroniser n’ajoute AUCUNE ligne')

// un statut qui BOUGE entre deux passages entre bien
const p3 = CH.rattacherCycleVieChorus(etat, [chorus({ statutPortail: 'MISE_EN_PAIEMENT', dateStatut: '2026-08-20', motif: null })], '2026-08-21')
assert.equal(p3.ajouts.length, 1)
assert.equal(F.derniereTransmission({ transmissions: [...etat[0].transmissions, p3.ajouts[0].evenement] }).statut, 'payee')

// --- 4. un code non traduisible n'écrit RIEN sur la pièce, et se dit
r = CH.rattacherCycleVieChorus(factures, [chorus({ statutPortail: 'CODE_INVENTE_2029' })], '2026-08-06')
assert.equal(r.ajouts.length, 0)
assert.equal(r.nonTraduits.length, 1)
assert.match(CH.resumeSynchronisationChorus(r), /non reconnu\(s\) \(CODE_INVENTE_2029\)/)

// --- 5. l'alerte de rejet : gravité 3, motif, lien profond
const etatComplet = {
  settings: { snoozes: {}, vus: {}, seuilDeriveHeures: 0.9, nomAgence: 'L&L', delaisPaiement: {}, personnes: [], equipe: [] },
  projets: [{ id: 'P01', nom: 'Groupe scolaire', statut: 'DET', typeMO: 'Public', phases: [] }],
  factures: [facture({ id: 'f1', numero: '2026-050', transmissions: [{ date: '2026-08-05', plateforme: 'chorus', statut: 'rejetee', statutPortail: 'SUSPENDUE', motif: 'SIRET destinataire inconnu' }] })],
  echeancesFacturation: [], paiements: [], situations: [], marches: [], tachesChantier: [], visas: [], cotraitants: [],
  notesHonoraires: [], obligations: [], contacts: [], organisations: [], reunions: [], artisans: [], temps: [],
  connexionsBancaires: [], chorusInconnues: [],
}
const alertes = A.computeAlertes(etatComplet, '2026-08-06')
const rejet = alertes.find((a) => a.type === 'facture_rejetee_portail')
assert.ok(rejet, 'le rejet produit une alerte')
assert.equal(rejet.gravite, 3)
assert.match(rejet.titre, /suspendue par Chorus Pro/, 'le MOT du portail, pas « rejetée »')
assert.match(rejet.detail, /SIRET destinataire inconnu/, 'le motif voyage avec l’alerte')
assert.match(rejet.detail, /ne sera pas payée/)
assert.equal(rejet.lien, '#/facturation/chercher/2026-050', 'lien profond : la ligne visée est la seule affichée')
assert.equal(rejet.date, '2026-08-05')

// sans motif rendu par le portail, on le DIT
etatComplet.factures[0].transmissions[0].motif = undefined
const sansMotif = A.computeAlertes(etatComplet, '2026-08-06').find((a) => a.type === 'facture_rejetee_portail')
assert.match(sansMotif.detail, /Motif non rendu par le portail/)
// et sans statutPortail (saisie manuelle / CSV), le mot reste « rejetée »
delete etatComplet.factures[0].transmissions[0].statutPortail
assert.match(A.computeAlertes(etatComplet, '2026-08-06').find((a) => a.type === 'facture_rejetee_portail').titre, /rejetée par Chorus Pro/)

// une facture corrigée puis redéposée n'alerte plus
etatComplet.factures[0].transmissions.push({ date: '2026-08-10', plateforme: 'chorus', statut: 'deposee', statutPortail: 'DEPOSEE' })
assert.equal(A.computeAlertes(etatComplet, '2026-08-11').some((a) => a.type === 'facture_rejetee_portail'), false, 'redéposée ⇒ l’alerte s’éteint')

// --- 6. fusion des « inconnues » : elles sortent quand elles trouvent leur facture
const anciennes = [{ numero: '2026-090', statutPortail: 'DEPOSEE', vueLe: '2026-08-01' }, { numero: '2026-091', statutPortail: 'REJETEE', vueLe: '2026-08-01' }]
let fus = CH.fusionnerInconnues(anciennes, [{ numero: '2026-091', statutPortail: 'REJETEE', dateStatut: '2026-08-05', vueLe: '2026-08-06' }], [])
assert.equal(fus.length, 2, 'une inconnue hors fenêtre n’est pas effacée parce qu’on a réduit la fenêtre')
assert.equal(fus.find((x) => x.numero === '2026-091').vueLe, '2026-08-06', '… et celle qu’on revoit se met à jour')
fus = CH.fusionnerInconnues(anciennes, [], ['2026-090'])
assert.deepEqual(fus.map((x) => x.numero), ['2026-091'], 'celle qui a trouvé sa facture sort de la liste')

// --- 7. LA MACHINE NE MODIFIE AUCUN MONTANT
//
// C'est la garantie qui coûte le plus cher si elle tombe, et la seule qui ne
// se voit pas à l'écran : une facture dont le TTC aurait été « corrigé »
// d'après le portail paraîtrait normale. Chorus rend des montants (ils
// s'affichent pour les factures SANS correspondance, où ils aident à
// reconnaître la pièce) — mais rien de ce que le portail dit d'une facture
// CONNUE ne doit s'écrire ailleurs que dans son cycle de vie.

// 7.1 ce que la synchronisation propose d'écrire ne contient aucun montant
{
  const r7 = CH.rattacherCycleVieChorus(factures, [chorus({ montantTTC: 999999 })], '2026-08-06')
  assert.deepEqual(
    Object.keys(r7.ajouts[0]).sort(),
    ['evenement', 'factureId', 'numero'],
    'un rattachement propose un ÉVÉNEMENT sur une pièce, rien d’autre',
  )
  const cles = Object.keys(r7.ajouts[0].evenement).sort()
  assert.deepEqual(
    cles,
    ['date', 'motif', 'plateforme', 'reference', 'statut', 'statutPortail'],
    'l’événement de transmission ne porte ni montant, ni numéro à réécrire, ni statut de paiement',
  )
  for (const cle of cles) {
    assert.ok(
      !/montant|ttc|ht|tva|solde/i.test(cle),
      `« ${cle} » ressemble à un montant : le cycle de vie n’en transporte aucun`,
    )
  }
}

// 7.2 … et l'écran n'écrit que ces deux champs-là sur la pièce
//
// Lu dans l'ARBRE : une recherche de texte confondrait une affectation avec
// une mention en commentaire, et ce qui compte ici est ce qui S'EXÉCUTE.
{
  const FACTURATION = 'src/modules/Facturation.tsx'
  const sf = ts.createSourceFile(FACTURATION, lire(FACTURATION), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let carte = null
  const chercherCarte = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.name.text === 'CarteChorus') carte = n
    ts.forEachChild(n, chercherCarte)
  }
  chercherCarte(sf)
  assert.ok(carte, 'src/modules/Facturation.tsx : CarteChorus est introuvable — ce test parle d’un code disparu')

  const champsEcrits = new Set()
  const parcourir = (n) => {
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(n.left) &&
      ts.isIdentifier(n.left.expression) &&
      n.left.expression.text === 'f'
    ) {
      champsEcrits.add(n.left.name.text)
    }
    ts.forEachChild(n, parcourir)
  }
  parcourir(carte)
  assert.deepEqual(
    [...champsEcrits].sort(),
    ['evenements', 'transmissions'],
    'la synchronisation Chorus n’écrit sur une facture QUE son cycle de vie et son journal.\n' +
      'Écrire un montant, un numéro ou un statut d’après le portail ferait diverger la pièce de\n' +
      'ce que l’agence a émis — et rien à l’écran ne le montrerait.',
  )

  // Aucun `update` de cette carte ne touche les collections d'argent.
  const texteCarte = carte.getText()
  for (const interdit of ['d.paiements', 'd.echeancesFacturation', 'd.situations', 'd.notesHonoraires']) {
    assert.ok(
      !texteCarte.includes(interdit),
      `${interdit} n’a rien à faire dans la carte Chorus : « mise en paiement » veut dire que le payeur a lancé ` +
        'le virement, pas que l’argent est arrivé — le solde se dérive des paiements ENREGISTRÉS.',
    )
  }
}

// 7.3 le prédicat qui dit « le virement est parti » ne dit jamais « c'est encaissé »
assert.equal(CH.estMiseEnPaiement({ plateforme: 'chorus', statut: 'payee', date: '2026-08-20' }), true)
assert.equal(
  CH.estMiseEnPaiement({ plateforme: 'email', statut: 'payee', date: '2026-08-20' }),
  false,
  'un « payée » saisi sur un envoi par e-mail dit ce que la personne a voulu dire, pas qu’un ordonnateur a mandaté',
)
assert.equal(CH.estMiseEnPaiement(null), false)

refus
  .then(() =>
    console.log(
      'OK — chorusApi.ts : projection des statuts, rattachement par numéro, idempotence CSV+API, ' +
        'alerte de rejet, et aucun montant touché.',
    ),
  )
  .catch((erreur) => {
    console.error(erreur)
    process.exitCode = 1
  })
