// ============================================================
// Livrable A.3 — cache 90 jours, file d'écritures idempotentes,
// couche d'accès paginée à `public.communications`.
//
// Ce test ne se connecte à rien. Il transpile les deux modules et les
// EXÉCUTE, avec `./sync` et IndexedDB remplacés par des doublures : ce
// qui est vérifié ici n'est pas la forme du code mais son comportement.
// C'est le partage que `src/moi.ts` a déjà posé — `resoudreMoi()` est
// une règle pure, testable ; le hook n'est que son habillage.
//
// CE QU'IL VERROUILLE, ET POURQUOI AUCUN DE CES DÉFAUTS NE FERAIT DE BRUIT
// -----------------------------------------------------------------------
// 1. UNE LECTURE SANS SESSION NE REND JAMAIS UN ZÉRO AFFIRMATIF. Le
//    hors-ligne est un acquis du dépôt ; la sortie des messages du
//    document JSONB est précisément l'endroit où on le perd sans le
//    voir. `[]` s'affiche « aucun message à traiter » — une phrase
//    fausse sur laquelle on organise sa journée.
// 2. REJOUER LA FILE DEUX FOIS NE CHANGE RIEN. C'est l'exigence
//    « actions idempotentes » du §24. Elle tient parce que les écritures
//    portent des valeurs ABSOLUES et un horodatage figé au geste — pas
//    parce qu'on a promis de ne pas rejouer.
// 3. UNE FILE PRÉPARÉE POUR UN PROJET SUPABASE NE PART JAMAIS SUR UN
//    AUTRE. Même règle que `cibleSynchronisation()` pour le document
//    partagé ; c'est le seul accident irrattrapable de la mécanique.
// 4. LE CLIENT N'ÉCRIT QUE DES COLONNES QUE LA BASE LUI ACCORDE. Les
//    colonnes écrites sont relevées à l'exécution et comparées au
//    `grant update (…)` de la migration A.2 : une colonne de plus et
//    chaque correction serait refusée en production, une par une, sans
//    autre trace que les journaux Supabase.
// 5. CORRIGER UN SEUL AXE N'EN EFFACE PAS DEUX. `categorise_par`
//    commande les trois axes à la fois : signer en n'écrivant qu'une
//    colonne humaine viderait les deux autres. C'est le piège du
//    schéma, et il est silencieux.
// 6. UN FILTRE A SES DEUX TRADUCTIONS — SQL et cache. Écrites à deux
//    endroits sans lien, elles divergent au premier ajout, et la
//    divergence ne se voit que hors ligne.
// ============================================================

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

const CHEMIN_HORS_LIGNE = 'src/horsLigne.ts'
const CHEMIN_COMMUNICATIONS = 'src/communications.ts'
const CHEMIN_PROPOSITIONS = 'src/propositions.ts'
const CHEMIN_MIGRATION = 'supabase/migrations/20260731150000_communications_index_des_messages.sql'

const sourceHorsLigne = lire(CHEMIN_HORS_LIGNE)
const sourceCommunications = lire(CHEMIN_COMMUNICATIONS)
const sourcePropositions = lire(CHEMIN_PROPOSITIONS)
const migration = lire(CHEMIN_MIGRATION)

/** charge un module TypeScript en remplaçant ses imports par des doublures */
function charger(fichier, dependances = {}) {
  const compile = ts.transpileModule(lire(fichier), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, (id) => {
    if (dependances[id]) return dependances[id]
    throw new Error(`Import runtime inattendu dans ${fichier} : ${id}`)
  })
  return mod.exports
}

/** react n'est jamais exercé ici : aucun hook n'est appelé */
const reactFactice = {
  useSyncExternalStore: () => null,
  useCallback: (f) => f,
  useEffect: () => undefined,
  useMemo: (f) => f(),
  useRef: () => ({ current: true }),
  useState: (v) => [v, () => undefined],
}

const CIBLE = 'https://exemple.supabase.co|cle|espace'
const AUTRE_CIBLE = 'https://autre.supabase.co|cle|espace'

/** la session s'ouvre et se ferme pendant le test : c'est tout le sujet */
let sessionOuverte = true

const syncFactice = {
  cibleSyncCourante: () => CIBLE,
  syncActif: () => sessionOuverte,
  clientSupabase: () => null,
  abonnerSession: () => () => undefined,
}

const horsLigne = charger(CHEMIN_HORS_LIGNE, { react: reactFactice, './sync': syncFactice })
const util = charger('src/util.ts')
const miqcp = charger('src/miqcp.ts')
const categorisation = charger('src/categorisation.ts', { './util': util, './miqcp': miqcp })

const MAINTENANT = '2026-07-31T12:00:00.000Z'
const ilYA = (jours) => new Date(Date.parse(MAINTENANT) - jours * 86_400_000).toISOString()

const ecriture = (id, ordre, valeurs, cible = CIBLE, cle = 'm1') =>
  horsLigne.nouvelleEcriture('communications', cle, valeurs, cible, {
    id,
    ordre,
    faitLe: '2026-07-31T09:12:00.000Z',
  })

/** serveur simulé : des lignes, des colonnes, rien d'autre */
function serveurFactice() {
  const lignes = new Map([['m1', { id: 'm1' }]])
  const vues = []
  return {
    lignes,
    vues,
    executeur: async (e) => {
      vues.push(e.id)
      lignes.set(e.cle, { ...(lignes.get(e.cle) || { id: e.cle }), ...e.valeurs })
    },
  }
}

/** doublure du hors-ligne : cache injectable, écritures capturées.
 *
 *  Le module RÉEL est étalé dessous : seules la persistance et la file sont
 *  remplacées. Les règles pures qu'il exporte — `exigerSignataire` en
 *  particulier, partagée par les deux couches d'accès — sont donc celles du
 *  dépôt, et non une seconde copie écrite ici, qui aurait pu accepter ce que
 *  la vraie refuse. */
function horsLigneFactice(cache) {
  const enfilees = []
  let executeur = null
  return {
    enfilees,
    executeurEnregistre: () => executeur,
    module: {
      ...horsLigne,
      lireCache: async () => cache,
      ecrireCache: async () => undefined,
      patcherCache: async () => undefined,
      enfiler: async (magasin, cle, valeurs) => {
        const e = { id: `op-${enfilees.length}`, magasin, cle, valeurs }
        enfilees.push(e)
        return e
      },
      enregistrerExecuteur: (_magasin, fn) => {
        executeur = fn
      },
    },
  }
}

function chargerCommunications(cache, sync = syncFactice) {
  const doublure = horsLigneFactice(cache)
  const mod = charger(CHEMIN_COMMUNICATIONS, {
    react: reactFactice,
    './categorisation': categorisation,
    './horsLigne': doublure.module,
    './sync': sync,
    './util': util,
  })
  return { mod, doublure }
}

function chargerPropositions(cache, sync = syncFactice) {
  const doublure = horsLigneFactice(cache)
  const mod = charger(CHEMIN_PROPOSITIONS, {
    react: reactFactice,
    './horsLigne': doublure.module,
    './sync': sync,
    './util': util,
  })
  return { mod, doublure }
}

const messageBrut = (id, envoyeLe, sup = {}) => ({
  id,
  gmail_message_id: `18f3ab9c1d2e3f4${id.length}`,
  gmail_thread_id: `t-${id}`,
  message_id_rfc: null,
  en_reponse_a: null,
  references_rfc: [],
  expediteur: 'Mairie <contact@exemple.example>',
  expediteur_adresse: 'contact@exemple.example',
  destinataires: [],
  copies: [],
  objet: `objet ${id}`,
  corps_extrait: '',
  libelles: [],
  direction: 'entrant',
  nb_pieces_jointes: 0,
  envoye_le: envoyeLe,
  recu_le: envoyeLe,
  resume: null,
  resume_le: null,
  projet_id: null,
  projet_id_propose: null,
  confiance_rattachement: null,
  raisons_rattachement: [],
  rattache_par: null,
  rattache_le: null,
  phase_effective: null,
  phase_proposee: null,
  type_echange_effectif: null,
  type_echange_propose: null,
  importance_effective: null,
  importance_proposee: null,
  confiance_categorisation: null,
  raisons_categorisation: [],
  categorise_par: null,
  categorise_le: null,
  traite_par: null,
  traite_le: null,
  ...sup,
})

/** client Supabase simulé : la chaîne de requête rend toujours la même liste */
function clientFactice(lignes) {
  return {
    from: () => {
      const requete = {
        select: () => requete,
        eq: () => requete,
        is: () => requete,
        in: () => requete,
        gte: () => requete,
        lt: () => requete,
        or: () => requete,
        order: () => requete,
        limit: () => Promise.resolve({ data: lignes, error: null }),
      }
      return requete
    },
  }
}

const messageCourant = {
  id: 'm1',
  gmailMessageId: '18f3ab9c1d2e3f40',
  gmailThreadId: 't-m1',
  projetId: 'P03',
  phase: 'ACT-DCE',
  typeEchange: 'entreprise',
  importance: 'a_traiter',
  categorisePar: null,
  traiteLe: null,
  envoyeLe: '2026-07-30T08:00:00.000Z',
}

async function principal() {
  // ----------------------------------------------------------------
  // 1. La fenêtre de 90 jours
  // ----------------------------------------------------------------

  assert.equal(
    horsLigne.FENETRE_CACHE_JOURS,
    90,
    'la fenêtre de cache du plan §3.3 est de 90 jours : « messages, propositions et tâches des 90 derniers jours »',
  )

  assert.equal(horsLigne.dansLaFenetre(ilYA(1), MAINTENANT), true, 'hier est dans la fenêtre')
  assert.equal(horsLigne.dansLaFenetre(ilYA(89), MAINTENANT), true, 'la veille de la borne est dans la fenêtre')
  assert.equal(
    horsLigne.dansLaFenetre(ilYA(91), MAINTENANT),
    false,
    'au-delà de 90 jours, la consultation exige le réseau — c’est l’arbitrage assumé du §3.3',
  )
  assert.equal(
    horsLigne.dansLaFenetre(null, MAINTENANT),
    true,
    'une ligne sans date n’est pas datable : l’élaguer ferait disparaître une anomalie d’ingestion en silence',
  )

  const elaguees = horsLigne.elaguer([{ d: ilYA(2) }, { d: ilYA(200) }, { d: null }], (l) => l.d, MAINTENANT)
  assert.equal(elaguees.length, 2, 'l’élagage retire ce qui est sorti de la fenêtre, et rien d’autre')

  // ----------------------------------------------------------------
  // 2. La file : idempotence, ordre, cloisonnement, blocage
  // ----------------------------------------------------------------

  // --- 2a. enfiler deux fois la même écriture ne la duplique pas ---
  let file = []
  const e1 = ecriture('op-1', 1, { traite_par: 'Julien' })
  file = horsLigne.fusionnerFile(file, e1)
  file = horsLigne.fusionnerFile(file, e1)
  assert.equal(file.length, 1, 'réenfiler la même écriture (même identifiant client) ne doit pas la dupliquer')

  // --- 2b. rejouer deux fois laisse le serveur dans le même état ---
  const fileTriple = [
    ecriture('op-a', 1, { traite_par: 'Julien', traite_le: '2026-07-31T09:12:00.000Z' }),
    ecriture('op-b', 2, { projet_id_valide: 'P03', rattache_par: 'Julien' }),
    ecriture('op-c', 3, { importance: 'urgent', categorise_par: 'Zoé' }),
  ]
  const serveur = serveurFactice()
  const passe1 = await horsLigne.rejouer(fileTriple, CIBLE, () => serveur.executeur)
  assert.equal(passe1.envoyees, 3, 'les trois écritures doivent partir')
  assert.deepEqual(passe1.file, [], 'une écriture envoyée quitte la file')
  const apresUnePasse = { ...serveur.lignes.get('m1') }

  // la MÊME file rejouée intégralement — comme si l'accusé de réception s'était
  // perdu et que la file n'avait pas été vidée
  const passe2 = await horsLigne.rejouer(fileTriple, CIBLE, () => serveur.executeur)
  assert.equal(passe2.envoyees, 3, 'un rejeu complet ne doit pas échouer')
  assert.deepEqual(
    serveur.lignes.get('m1'),
    apresUnePasse,
    'rejouer la file deux fois doit laisser exactement le même état : c’est la définition d’« actions idempotentes » (§24)',
  )
  assert.deepEqual(apresUnePasse, {
    id: 'm1',
    traite_par: 'Julien',
    traite_le: '2026-07-31T09:12:00.000Z',
    projet_id_valide: 'P03',
    rattache_par: 'Julien',
    importance: 'urgent',
    categorise_par: 'Zoé',
  })

  // --- 2c. l'horodatage est celui du geste, jamais celui de l'envoi ---
  assert.equal(
    fileTriple[0].valeurs.traite_le,
    '2026-07-31T09:12:00.000Z',
    'le rejeu ne réécrit pas les valeurs : une écriture rejouée qui dirait autre chose ne serait plus rejouable',
  )
  assert.equal(fileTriple[0].faitLe, '2026-07-31T09:12:00.000Z', 'l’instant du geste humain est figé à l’enfilement')

  // --- 2d. cloisonnement des cibles ---
  const serveurCible = serveurFactice()
  const fileMixte = [
    ecriture('op-ici', 1, { traite_par: 'Julien' }, CIBLE),
    ecriture('op-ailleurs', 2, { traite_par: 'Julien' }, AUTRE_CIBLE),
  ]
  const passeMixte = await horsLigne.rejouer(fileMixte, CIBLE, () => serveurCible.executeur)
  assert.deepEqual(
    serveurCible.vues,
    ['op-ici'],
    'une écriture destinée à un autre projet Supabase ne doit jamais partir : c’est le seul accident irrattrapable de cette mécanique',
  )
  assert.equal(passeMixte.file.length, 1, 'elle n’est pas jetée pour autant : elle attend son projet')
  assert.equal(passeMixte.file[0].id, 'op-ailleurs', 'c’est bien elle qui reste')

  // --- 2e. l'échec conserve l'écriture, l'ordre, et arrête la passe ---
  const fileEchec = [ecriture('op-1', 1, { traite_par: 'Julien' }), ecriture('op-2', 2, { traite_par: 'Zoé' })]
  let appels = 0
  const passeEchec = await horsLigne.rejouer(fileEchec, CIBLE, () => async () => {
    appels++
    throw new Error('Réseau indisponible')
  })
  assert.equal(
    appels,
    1,
    'le premier échec arrête la passe : deux corrections de la même ligne doivent s’appliquer dans l’ordre où elles ont été faites',
  )
  assert.equal(passeEchec.file.length, 2, 'aucune écriture n’est perdue par un échec')
  assert.deepEqual(
    passeEchec.file.map((e) => e.id),
    ['op-1', 'op-2'],
    'l’ordre d’enfilement est conservé — c’est le sens des corrections successives',
  )
  assert.equal(passeEchec.file[0].tentatives, 1, 'la tentative est comptée')
  assert.equal(passeEchec.file[0].bloquee, false, 'une tentative ne bloque pas')
  assert.match(passeEchec.erreur, /Réseau indisponible/, 'l’erreur est remontée — « journal d’erreurs » (§24)')

  // --- 2f. blocage après MAX_TENTATIVES, sans retenir les suivantes ---
  let enCours = [
    ecriture('op-refusee', 1, { traite_par: 'Julien' }),
    ecriture('op-valide', 2, { traite_par: 'Zoé' }, CIBLE, 'm2'),
  ]
  const serveurRefus = serveurFactice()
  for (let i = 0; i < horsLigne.MAX_TENTATIVES; i++) {
    const passe = await horsLigne.rejouer(enCours, CIBLE, () => async (e) => {
      if (e.id === 'op-refusee') throw new Error('permission denied')
      await serveurRefus.executeur(e)
    })
    enCours = passe.file
  }
  assert.equal(enCours[0].bloquee, true, `au-delà de ${horsLigne.MAX_TENTATIVES} refus, l’écriture est déclarée bloquée`)
  assert.equal(
    enCours.length,
    2,
    'une écriture bloquée reste dans la file : on ne jette pas le travail de quelqu’un en silence',
  )
  const passeApresBlocage = await horsLigne.rejouer(enCours, CIBLE, () => serveurRefus.executeur)
  assert.equal(passeApresBlocage.envoyees, 1, 'une écriture bloquée est sautée et ne retient plus les suivantes')
  assert.equal(passeApresBlocage.file.length, 1, 'seule la bloquée reste')
  assert.equal(passeApresBlocage.file[0].id, 'op-refusee', 'et c’est bien elle')

  // --- 2g. la chaîne complète, sans IndexedDB : rien n'est perdu ---
  // Node n'a pas d'IndexedDB : c'est exactement le cas « navigation privée,
  // quota atteint, base corrompue ». La file doit continuer à fonctionner en
  // mémoire pour la session en cours — perdre une correction faite il y a dix
  // secondes parce que la persistance de confort est absente serait le pire
  // des compromis.
  sessionOuverte = false
  const horsLigneEnfilee = await horsLigne.enfiler('communications', 'm9', { traite_par: 'Julien' })
  assert.ok(horsLigneEnfilee, 'une écriture doit pouvoir être enfilée sans IndexedDB')
  assert.equal(horsLigneEnfilee.cible, CIBLE, 'elle porte la cible du moment, et ne partira que là')
  await horsLigne.rejouerFile()
  assert.equal(horsLigne.ecrituresEnAttente().length, 1, 'hors ligne, l’écriture attend — elle n’est ni perdue ni envoyée')
  assert.equal(
    horsLigne.ecrituresEnAttente()[0].tentatives,
    0,
    'sans session, AUCUNE tentative n’est consommée : rester trois jours hors ligne suffirait sinon à déclarer bloquée une correction parfaitement valide',
  )

  // la session s'ouvre : l'écriture repart seule, sans nouvelle saisie — et
  // les trois déclencheurs du réarmement (réseau, session, enfilement)
  // arrivent volontiers ensemble : deux passes concurrentes ne doivent pas
  // envoyer deux fois la même écriture
  sessionOuverte = true
  const recues = []
  horsLigne.enregistrerExecuteur('communications', async (e) => {
    await new Promise((r) => setTimeout(r, 5))
    recues.push(e)
  })
  await Promise.all([horsLigne.rejouerFile(), horsLigne.rejouerFile(), horsLigne.rejouerFile()])
  assert.deepEqual(
    recues.map((e) => e.valeurs),
    [{ traite_par: 'Julien' }],
    'à la reconnexion, l’écriture faite hors ligne repart seule — UNE fois, même si trois passes sont demandées en même temps',
  )
  assert.equal(horsLigne.ecrituresEnAttente().length, 0, 'et quitte la file une fois reçue')

  // ----------------------------------------------------------------
  // 3. La couche d'accès : jamais de zéro affirmatif
  // ----------------------------------------------------------------

  // --- 3a. ni session ni cache : « on ne sait pas », et surtout pas « rien » ---
  {
    const { mod } = chargerCommunications(null)
    const page = await mod.listerCommunications({})
    assert.equal(
      page,
      null,
      'sans session et sans cache, la lecture doit rendre `null` — « on ne sait pas ». Un tableau vide s’affiche « aucun message », et c’est faux.',
    )
  }

  // --- 3b. le réseau répond : traduction, colonnes générées, lien Gmail ---
  {
    const lignes = [
      messageBrut('m1', '2026-07-30T08:00:00.000Z', {
        gmail_message_id: '18f3ab9c1d2e3f40',
        projet_id: 'P03',
        projet_id_propose: 'P03',
        confiance_rattachement: 0.82,
        raisons_rattachement: ['Contient l’identifiant du projet P03'],
        phase_effective: 'ACT-DCE',
        phase_proposee: 'ACT-DCE',
        importance_effective: 'urgent',
        importance_proposee: 'urgent',
        type_echange_effectif: 'entreprise',
        type_echange_propose: 'entreprise',
      }),
    ]
    const { mod } = chargerCommunications(null, { ...syncFactice, clientSupabase: () => clientFactice(lignes) })
    const page = await mod.listerCommunications({ projetId: 'P03' })
    assert.equal(page.source, 'reseau', 'une réponse du serveur est une réponse du serveur')
    assert.equal(page.lignes.length, 1)
    const c = page.lignes[0]
    assert.equal(c.projetId, 'P03', 'le projet effectif vient de la colonne GÉNÉRÉE projet_id')
    assert.equal(c.phase, 'ACT-DCE', 'la phase effective vient de phase_effective')
    assert.equal(c.importance, 'urgent', 'l’importance effective vient de importance_effective')
    assert.equal(c.typeEchange, 'entreprise', 'le type effectif vient de type_echange_effectif')
    assert.equal(c.propose.confianceRattachement, 0.82, 'la confiance de la machine reste lisible (« Voir pourquoi »)')
    assert.equal(
      c.urlGmail,
      'https://mail.google.com/mail/u/0/#all/18f3ab9c1d2e3f40',
      'le lien de réouverture passe par gmailMessageUrl() — seul constructeur du dépôt (critère 10)',
    )
    assert.equal(
      categorisation.graviteDe(c.importance),
      3,
      'la projection sur la gravité 1-3 reste celle de src/categorisation.ts, jamais recopiée ici',
    )
  }

  // --- 3c. hors ligne : le cache répond, se déclare comme cache, et pagine ---
  {
    const cacheLignes = [
      { id: 'a', envoyeLe: '2026-07-30T10:00:00.000Z', projetId: 'P03', traiteLe: null, direction: 'entrant', gmailThreadId: 't1', phase: null, importance: null },
      { id: 'b', envoyeLe: '2026-07-29T10:00:00.000Z', projetId: 'P03', traiteLe: '2026-07-30T00:00:00.000Z', direction: 'entrant', gmailThreadId: 't1', phase: null, importance: null },
      { id: 'c', envoyeLe: '2026-07-28T10:00:00.000Z', projetId: 'P07', traiteLe: null, direction: 'entrant', gmailThreadId: 't2', phase: null, importance: null },
    ]
    const { mod } = chargerCommunications({ lignes: cacheLignes, luLe: MAINTENANT })

    const tout = await mod.listerCommunications({})
    assert.equal(tout.source, 'cache', 'sans session, la réponse vient du cache et le dit : « ce que ce poste connaît », pas « ce qui existe »')
    assert.deepEqual(
      tout.lignes.map((c) => c.id),
      ['a', 'b', 'c'],
      'du plus récent au plus ancien',
    )

    const duProjet = await mod.listerCommunications({ projetId: 'P03' })
    assert.deepEqual(
      duProjet.lignes.map((c) => c.id),
      ['a', 'b'],
      'le filtre projet s’applique aussi au cache',
    )

    const aTraiter = await mod.listerCommunications({ projetId: 'P03', nonTraite: true })
    assert.deepEqual(
      aTraiter.lignes.map((c) => c.id),
      ['a'],
      'le filtre « non traité » s’applique aussi au cache',
    )

    // pagination par curseur : la page 2 reprend exactement où la page 1 s'arrête
    const page1 = await mod.listerCommunications({ taille: 2 })
    assert.deepEqual(
      page1.lignes.map((c) => c.id),
      ['a', 'b'],
    )
    assert.ok(page1.curseur, 'une suite existe, donc un curseur')
    const page2 = await mod.listerCommunications({ taille: 2, suiteDe: page1.curseur })
    assert.deepEqual(
      page2.lignes.map((c) => c.id),
      ['c'],
      'la page suivante ne saute ni ne répète — c’est pourquoi la pagination est par curseur et non par décalage : le cron ingère toutes les dix minutes',
    )
    assert.equal(page2.curseur, null, 'pas de suite après la dernière ligne')
  }

  // un magasin déjà rempli et devenu vide répond « rien », et c'est légitime :
  // la distinction se joue sur l'existence du cache, pas sur son contenu
  {
    const { mod } = chargerCommunications({ lignes: [], luLe: MAINTENANT })
    const rien = await mod.listerCommunications({})
    assert.deepEqual(rien.lignes, [], 'un zéro CONNU reste affichable — c’est le zéro ignorant qui est interdit')
    assert.equal(rien.source, 'cache')
  }

  // ----------------------------------------------------------------
  // 4. Les écritures : signature, piège des trois axes, colonnes accordées
  // ----------------------------------------------------------------

  // --- 4a. rien ne se signe sans signataire ---
  {
    const { mod } = chargerCommunications(null)
    await assert.rejects(
      () => mod.marquerTraite(messageCourant, ''),
      /qui est connecté/,
      'sans identité connue, aucune signature : c’est elle qui fait basculer les colonnes générées, une correction non signée ne s’appliquerait pas',
    )
    await assert.rejects(() => mod.corrigerRattachement(messageCourant, 'P07', '   '), /qui est connecté/)
    await assert.rejects(() => mod.corrigerAxes(messageCourant, { importance: 'urgent' }, ''), /qui est connecté/)
  }

  // --- 4b. corriger UN axe réécrit les TROIS colonnes humaines ---
  const colonnesEcrites = new Set()
  {
    const { mod, doublure } = chargerCommunications(null)
    await mod.corrigerAxes(messageCourant, { importance: 'urgent' }, 'Julien')
    const valeurs = doublure.enfilees[0].valeurs
    assert.equal(valeurs.importance, 'urgent', 'l’axe corrigé porte la nouvelle valeur')
    assert.equal(
      valeurs.phase,
      'ACT-DCE',
      'la phase NON corrigée doit être réécrite avec sa valeur effective courante : `categorise_par` commande les trois axes, et signer sans elle la viderait',
    )
    assert.equal(valeurs.type_echange, 'entreprise', 'même piège pour le type d’échange')
    assert.equal(valeurs.categorise_par, 'Julien', 'la signature est le nom de la personne, pas un identifiant de navigateur')
    assert.ok(valeurs.categorise_le, 'la signature est datée')

    await mod.corrigerAxes(messageCourant, { importance: null }, 'Julien')
    assert.equal(
      doublure.enfilees[1].valeurs.importance,
      null,
      'un axe délibérément vidé s’écrit `null` — et la colonne générée rend ce vide durable, au lieu de le remplir au cron suivant',
    )

    await mod.marquerTraite(messageCourant, 'Zoé')
    await mod.corrigerRattachement(messageCourant, 'P07', 'Zoé')
    await mod.corrigerRattachement(messageCourant, null, 'Zoé')
    assert.equal(
      doublure.enfilees[4].valeurs.projet_id_valide,
      null,
      'détacher un message est un geste explicite : la proposition de la machine ne le reprend pas',
    )
    assert.equal(doublure.enfilees[4].valeurs.rattache_par, 'Zoé', 'et il est signé, sinon la colonne générée ne bascule pas')

    for (const enfilee of doublure.enfilees) {
      assert.equal(enfilee.magasin, 'communications', 'toutes les écritures passent par le même magasin')
      assert.equal(enfilee.cle, 'm1', 'et visent la clé primaire de la ligne — d’où l’idempotence de l’`update`')
      for (const colonne of Object.keys(enfilee.valeurs)) colonnesEcrites.add(colonne)
    }
  }

  // --- 4c. toute colonne écrite est une colonne que la base accorde ---
  const grant = /grant update \(([\s\S]*?)\)\s*\n\s*on table public\.communications\s*\n\s*to authenticated;/.exec(
    migration,
  )
  assert.ok(grant, 'le GRANT au niveau colonne de la migration A.2 est introuvable')
  const accordees = grant[1]
    .split(',')
    .map((c) => c.replace(/--[^\n]*/g, '').trim())
    .filter(Boolean)
  for (const colonne of colonnesEcrites) {
    assert.ok(
      accordees.includes(colonne),
      `src/communications.ts écrit « ${colonne} », que le GRANT au niveau colonne de public.communications n’accorde pas : ` +
        'chaque correction serait refusée en production, une par une, sans autre trace que les journaux Supabase',
    )
    assert.ok(
      !/propos|^confiance_|^raisons_|^resume$|^gmail_/.test(colonne),
      `src/communications.ts écrit « ${colonne} » : ce que la machine a proposé ne se réécrit pas depuis l’écran (§3.14, critère 11)`,
    )
  }
  assert.ok(colonnesEcrites.size >= 8, `recensement suspect : ${colonnesEcrites.size} colonnes écrites relevées`)

  // --- 4d. l'exécuteur applique des valeurs absolues sur la clé primaire ---
  {
    const appels = []
    const client = {
      from: (table) => ({
        update: (valeurs) => ({
          eq: (colonne, valeur) => {
            appels.push({ table, valeurs, colonne, valeur })
            return Promise.resolve({ error: null })
          },
        }),
      }),
    }
    const { doublure } = chargerCommunications(null, { ...syncFactice, clientSupabase: () => client })
    const executeur = doublure.executeurEnregistre()
    assert.ok(executeur, 'src/communications.ts doit déclarer son exécuteur à la file — sinon ses écritures dormiraient')
    const e = { id: 'op-x', magasin: 'communications', cle: 'm1', valeurs: { traite_par: 'Julien', traite_le: MAINTENANT } }
    await executeur(e)
    await executeur(e)
    assert.equal(appels.length, 2)
    assert.deepEqual(
      appels[0],
      appels[1],
      'rejouer une écriture doit produire exactement le même appel : c’est l’idempotence, pas une politesse',
    )
    assert.equal(appels[0].colonne, 'id', 'l’update vise la clé primaire')
    assert.equal(appels[0].table, 'communications')
  }

  // ----------------------------------------------------------------
  // 5. Un filtre a ses DEUX traductions
  // ----------------------------------------------------------------

  const declarationFiltre = /export interface FiltreCommunications \{([\s\S]*?)\n\}/.exec(sourceCommunications)
  assert.ok(declarationFiltre, 'FiltreCommunications doit rester une interface nommée')
  const champsFiltre = [...declarationFiltre[1].matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1])
  assert.ok(champsFiltre.length >= 6, `recensement suspect : ${champsFiltre.length} champs de filtre`)

  const tableCriteres = /const CRITERES[\s\S]*?\n\}\n/.exec(sourceCommunications)
  assert.ok(tableCriteres, 'la table CRITERES doit exister : c’est elle qui tient les deux traductions côte à côte')
  for (const champ of champsFiltre) {
    const bloc = new RegExp(`\\n {2}${champ}: \\{([\\s\\S]*?)\\n {2}\\},`).exec(tableCriteres[0])
    assert.ok(bloc, `le filtre « ${champ} » n’a pas de critère déclaré : sa traduction SQL et sa traduction cache divergeraient`)
    assert.match(bloc[1], /contraintes:/, `le critère « ${champ} » n’a pas de traduction SQL`)
    assert.match(
      bloc[1],
      /correspond:/,
      `le critère « ${champ} » n’a pas de traduction cache — hors ligne, la même question rendrait d’autres lignes`,
    )
  }

  // ----------------------------------------------------------------
  // 6. Une seule porte vers la table, et rien qui la contourne
  // ----------------------------------------------------------------

  const parcourir = (dossier, acc = []) => {
    for (const entree of fs.readdirSync(path.join(racine, dossier), { withFileTypes: true })) {
      const relatif = `${dossier}/${entree.name}`
      if (entree.isDirectory()) parcourir(relatif, acc)
      else if (/\.tsx?$/.test(entree.name)) acc.push(relatif)
    }
    return acc
  }

  const accedants = parcourir('src').filter((f) =>
    /\.from\(\s*(['"]communications['"]|MAGASIN_COMMUNICATIONS)\s*\)/.test(lire(f)),
  )
  assert.deepEqual(
    accedants,
    [CHEMIN_COMMUNICATIONS],
    'src/communications.ts est le seul accès à la table : un module qui la requête en direct échapperait à ce test, au cache et à la file',
  )

  assert.ok(
    !/\.select\(\s*['"`]\*/.test(sourceCommunications),
    'pas de `select(\'*\')` : toute colonne ajoutée demain entrerait sans bruit, y compris une proposition qu’aucun écran ne doit composer',
  )
  for (const generee of ['projet_id', 'phase_effective', 'type_echange_effectif', 'importance_effective']) {
    assert.ok(
      new RegExp(`'${generee}'`).test(sourceCommunications),
      `la couche d’accès doit lire la colonne GÉNÉRÉE ${generee} : la règle « proposé / validé » n’est écrite qu’en base`,
    )
  }

  const listeColonnes = /const COLONNES = \[([\s\S]*?)\]\.join/.exec(sourceCommunications)
  assert.ok(listeColonnes, 'la liste des colonnes lues doit rester nommée')
  const colonnesLues = [...listeColonnes[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  for (const humaine of ['phase', 'type_echange', 'importance']) {
    assert.ok(
      !colonnesLues.includes(humaine),
      `la colonne humaine brute ${humaine} est sélectionnée : c’est la valeur EFFECTIVE qui s’affiche, et la composer soi-même perd la subtilité (un axe signé et vide reste vide)`,
    )
  }

  // La file est mutualisée (A.9 « branchée sur le cache et la file d'A.3 »,
  // B.4 « file mutualisée ») : elle ne doit connaître aucune table.
  for (const table of ['communications', 'propositions', 'pointages', 'entrants']) {
    assert.ok(
      !new RegExp(`from\\(['"]${table}['"]\\)`).test(sourceHorsLigne),
      `src/horsLigne.ts nomme la table ${table} : la file doit rester générique, sinon A.9 et B.4 en écriront une seconde`,
    )
  }
  assert.match(
    sourceHorsLigne,
    /export function enregistrerExecuteur/,
    'chaque table déclare son exécuteur : c’est ce qui garde la file générique',
  )

  // Le réarmement, sans lequel « repart seule » n'est vrai que dans l'onglet
  // où la correction a été faite.
  const declarationExecuteur = /export function enregistrerExecuteur[\s\S]*?\n\}/.exec(sourceHorsLigne)
  assert.match(
    declarationExecuteur[0],
    /chargerFile\(\)[\s\S]*rejouerFile\(\)/,
    'déclarer un exécuteur doit charger la file persistée et tenter un envoi : sinon une correction faite hier, dans un onglet fermé depuis, ne repartirait qu’à la prochaine écriture — c’est-à-dire peut-être jamais',
  )
  const declarationArmer = /export function armer\(\)[\s\S]*?\n\}/.exec(sourceHorsLigne)
  assert.ok(declarationArmer, 'le réarmement doit rester une fonction nommée')
  assert.match(
    declarationArmer[0],
    /addEventListener\('online'/,
    'le retour du réseau doit relancer la file — c’est déjà ce que fait src/store.tsx pour le document partagé',
  )
  assert.match(
    declarationArmer[0],
    /abonnerSession\(/,
    'l’ouverture de session aussi : elle arrive en asynchrone au démarrage, et une correction saisie avant elle attend cet instant précis',
  )

  // ----------------------------------------------------------------
  // 7. La DEUXIÈME table branchée sur la même file (A.9)
  // ----------------------------------------------------------------
  //
  // C'est ici que le doublon se serait écrit. Le §3.3 le nomme d'avance :
  // « un second cache écrit pour la deuxième table serait un doublon ». Ce
  // bloc vérifie que `src/propositions.ts` se branche sur la mécanique
  // existante au lieu d'en refaire une — et qu'il en tient les deux
  // invariants, qui ne se déduisent pas du branchement.

  // --- 7a. aucune seconde base IndexedDB ---
  const ouvreursIndexedDB = parcourir('src').filter((f) => /indexedDB\.open\(/.test(lire(f)))
  assert.deepEqual(
    ouvreursIndexedDB.sort(),
    ['src/fsdrive.ts', CHEMIN_HORS_LIGNE],
    'une seconde base IndexedDB a été ouverte : le cache hors ligne est mutualisé (§3.3), et deux bases élagueraient selon deux fenêtres',
  )

  // --- 7b. ni session ni cache : « on ne sait pas », jamais « rien à valider » ---
  {
    const { mod } = chargerPropositions(null)
    assert.equal(
      await mod.listerPropositions({}),
      null,
      'sans session et sans cache, la lecture doit rendre `null`. « Rien à valider » annoncé à quelqu’un qui n’est pas connecté est un mensonge sur lequel on organise sa journée.',
    )
  }

  // --- 7c. le cache répond, filtre et pagine comme pour les messages ---
  {
    const enCache = (id, creeLe, sup = {}) => ({
      id,
      genre: 'tache',
      extrait: 'Merci de nous retourner le plan avant vendredi.',
      confiance: 0.6,
      raisons: [],
      origine: 'lexique',
      statut: 'proposee',
      objetCreeType: null,
      objetCreeId: null,
      traitePar: null,
      traiteLe: null,
      creeLe,
      chargeUtile: { titre: 'Mettre à jour le plan de façade' },
      message: { communicationId: 'm1', gmailMessageId: '18f3ab9c1d2e3f40', urlGmail: null, objet: '', envoyeLe: null, projetId: 'P03' },
      ...sup,
    })
    const { mod } = chargerPropositions({
      luLe: MAINTENANT,
      lignes: [
        enCache('p1', '2026-07-31T10:00:00.000Z'),
        enCache('p2', '2026-07-30T10:00:00.000Z', { statut: 'ignoree', traitePar: 'Zoé', traiteLe: MAINTENANT }),
        enCache('p3', '2026-07-29T10:00:00.000Z', {
          message: { communicationId: 'm2', gmailMessageId: '18f3ab9c1d2e3f41', urlGmail: null, objet: '', envoyeLe: null, projetId: 'P07' },
        }),
      ],
    })

    const tout = await mod.listerPropositions({})
    assert.equal(tout.source, 'cache', 'sans session, la réponse vient du cache et le dit')
    assert.deepEqual(tout.lignes.map((p) => p.id), ['p1', 'p2', 'p3'], 'du plus récent au plus ancien')

    const aRevoir = await mod.listerPropositions({ statut: 'proposee' })
    assert.deepEqual(
      aRevoir.lignes.map((p) => p.id),
      ['p1', 'p3'],
      'la file de revue du §8.7 se filtre aussi dans le cache',
    )

    const duProjet = await mod.listerPropositions({ projetId: 'P03' })
    assert.deepEqual(
      duProjet.lignes.map((p) => p.id),
      ['p1', 'p2'],
      'le projet vient de la jointure sur `communications` et se filtre des deux côtés : recopié dans la table, il aurait figé le rattachement au jour de la détection',
    )

    const page1 = await mod.listerPropositions({ taille: 2 })
    assert.deepEqual(page1.lignes.map((p) => p.id), ['p1', 'p2'])
    const page2 = await mod.listerPropositions({ taille: 2, suiteDe: page1.curseur })
    assert.deepEqual(
      page2.lignes.map((p) => p.id),
      ['p3'],
      'la page suivante ne saute ni ne répète : les détecteurs tournent derrière le cron',
    )
  }

  // --- 7d. l'exécuteur : valeurs absolues sur la clé primaire, rejeu identique ---
  {
    const appels = []
    const client = {
      from: (table) => ({
        update: (valeurs) => ({
          eq: (colonne, valeur) => {
            appels.push({ table, valeurs, colonne, valeur })
            return Promise.resolve({ error: null })
          },
        }),
      }),
    }
    const { doublure } = chargerPropositions(null, { ...syncFactice, clientSupabase: () => client })
    const executeur = doublure.executeurEnregistre()
    assert.ok(executeur, 'src/propositions.ts doit déclarer son exécuteur à la file — sinon ses décisions dormiraient')
    const e = {
      id: 'op-p',
      magasin: 'propositions',
      cle: 'p1',
      valeurs: { statut: 'acceptee', objet_cree_type: 'tache', objet_cree_id: 'T-42', traite_par: 'Julien', traite_le: MAINTENANT },
    }
    await executeur(e)
    await executeur(e)
    assert.deepEqual(
      appels[0],
      appels[1],
      'rejouer une décision doit produire exactement le même appel : c’est l’idempotence du §24, et elle tient parce que les valeurs sont absolues',
    )
    assert.equal(appels[0].colonne, 'id', 'l’update vise la clé primaire')
    assert.equal(appels[0].table, 'propositions')
  }

  // --- 7e. une seule règle de signature, partagée ---
  assert.match(
    sourcePropositions,
    /exigerSignataire,?\s*$/m,
    'src/propositions.ts doit IMPORTER exigerSignataire de src/horsLigne.ts : deux copies de cette règle auraient fini par diverger sur ce qui compte — l’une accepterait un espace',
  )
  for (const fichier of [CHEMIN_COMMUNICATIONS, CHEMIN_PROPOSITIONS]) {
    assert.ok(
      !/function exigerSignataire/.test(lire(fichier)),
      `${fichier} redéfinit exigerSignataire : la règle vit dans src/horsLigne.ts, avec la file qui porte les écritures signées`,
    )
  }

  console.log(
    `Hors-ligne : fenêtre ${horsLigne.FENETRE_CACHE_JOURS} j, file idempotente (rejeu double sans effet, ` +
      `${horsLigne.MAX_TENTATIVES} tentatives puis blocage sans retenir les suivantes, cibles cloisonnées), ` +
      `lecture sans session = null et jamais 0, ${colonnesEcrites.size} colonnes écrites toutes accordées par le GRANT, ` +
      `${champsFiltre.length} filtres à double traduction, ` +
      'et une DEUXIÈME table (propositions, A.9) branchée sur le même cache et la même file — une seule base IndexedDB.',
  )
}

principal().catch((e) => {
  console.error(e)
  process.exit(1)
})
