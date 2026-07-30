// Livrable 0.8 — « arborescence documentaire à la création du projet »
// (CDC §12.1, points 6 « créer le dossier Drive » et 7 « créer
// l'arborescence » ; le point 9 « créer les phases » était déjà acquis).
//
// Deux défauts sont couverts ici, et aucun des deux ne fait de bruit.
//
// Le premier est le doublon. L'arborescence existait déjà, sous la forme
// d'une boucle écrite à la main dans le bouton de l'onglet Documents. La
// recopier dans l'assistant aurait donné deux vérités : le jour où
// `ARBORESCENCE` gagne un dossier, les projets nés par l'assistant et ceux
// complétés à la main n'ont plus la même forme, et personne ne le voit —
// les fichiers se rangent, simplement pas au même endroit.
//
// Le second est la perte de saisie. Créer des dossiers sur un disque peut
// échouer de plusieurs façons (Drive absent, permission refusée, disque
// plein, navigateur sans File System Access, dossier verrouillé). Si cet
// échec remonte dans le bouton « Créer le projet », il emporte trois écrans
// de saisie — taux négocié compris. L'échec doit se signaler APRÈS
// l'enregistrement, jamais l'empêcher.
//
// Ce que ce test verrouille :
//   1. `creerArborescenceProjet` crée le dossier projet ET les sous-dossiers
//      d'`ARBORESCENCE`, en une fois ;
//   2. elle est idempotente et NON DESTRUCTIVE : rejouée, elle ne recrée
//      rien, ne supprime rien et laisse intacts les fichiers déjà rangés ;
//   3. permission refusée → elle lève, sans avoir rien créé ;
//   4. c'est le SEUL endroit du dépôt qui crée des dossiers dans le Drive ;
//   5. dans l'assistant, l'enregistrement du projet précède l'appel, et
//      l'appel est lancé sans être attendu et avec son `.catch` — un échec
//      Drive ne peut ni annuler le projet ni faire reperdre la saisie.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racineDepot = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racineDepot, fichier), 'utf8')

/** charge un module TypeScript pur (sans React ni DOM) pour l'exercer */
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

const util = charger('src/util.ts')
const fsdrive = charger('src/fsdrive.ts', {
  './util': util,
  // l'empreinte ne sert qu'au rangement de fichiers, pas à l'arborescence
  './registre': { empreinteSha256: async () => '' },
})

const { ARBORESCENCE, creerArborescenceProjet, slugProjet } = fsdrive

// --- faux dossier File System Access ---------------------------------------
//
// Il journalise TOUT, y compris ce qui ne devrait jamais arriver : une
// suppression pendant une création est un défaut, pas une variante.

function faireDossier(nom, journal) {
  const sousDossiers = new Map()
  const fichiers = new Set()
  return {
    kind: 'directory',
    name: nom,
    sousDossiers,
    fichiers,
    async getDirectoryHandle(n, opts) {
      if (sousDossiers.has(n)) return sousDossiers.get(n)
      if (!opts || !opts.create) throw new Error(`NotFoundError: ${n}`)
      const d = faireDossier(n, journal)
      sousDossiers.set(n, d)
      journal.push(`cree:${nom}/${n}`)
      return d
    },
    async getFileHandle() {
      throw new Error('getFileHandle n’a rien à faire dans la création d’une arborescence')
    },
    async removeEntry(n) {
      journal.push(`SUPPRIME:${nom}/${n}`)
    },
  }
}

const projet = { id: 'P07', nom: 'Réhabilitation 12 logements — Beauvais' }

;(async () => {
  // --- 1. création complète en une fois -------------------------------------
  {
    const journal = []
    const racine = faireDossier('Drive', journal)
    const r = await creerArborescenceProjet(racine, projet)

    assert.equal(r.dossierProjet, slugProjet(projet), 'le dossier projet doit être nommé par slugProjet')
    assert.match(r.dossierProjet, /^P07_/, 'le dossier projet doit commencer par l’identifiant interne du projet')
    assert.ok(
      racine.sousDossiers.has(r.dossierProjet),
      'CDC §12.1 point 6 : le dossier Drive du projet doit être créé à la racine',
    )

    const dossierProjet = racine.sousDossiers.get(r.dossierProjet)
    for (const a of ARBORESCENCE) {
      assert.ok(
        dossierProjet.sousDossiers.has(a.dossier),
        `CDC §12.1 point 7 : le sous-dossier ${a.dossier} doit être créé — l’arborescence est celle d’ARBORESCENCE, en entier`,
      )
    }
    assert.equal(
      dossierProjet.sousDossiers.size,
      ARBORESCENCE.length,
      'aucun dossier hors ARBORESCENCE ne doit apparaître : la liste ne se déclare qu’à un endroit',
    )
    assert.deepEqual(
      r.crees,
      ARBORESCENCE.map((a) => a.dossier),
      'le compte rendu doit lister les sous-dossiers réellement créés',
    )
    assert.deepEqual(r.existants, [], 'sur un Drive vierge, rien n’existait avant')
    assert.ok(
      !journal.some((l) => l.startsWith('SUPPRIME:')),
      'la création d’arborescence ne supprime jamais rien',
    )
  }

  // --- 2. rejouée : idempotente et non destructive ---------------------------
  //
  // C'est le cas réel du bouton « Créer / compléter l'arborescence » sur un
  // projet ancien. Si un dossier déjà plein était recréé — ou pire, vidé —
  // le rangement d'une année disparaîtrait sans message.
  {
    const journal = []
    const racine = faireDossier('Drive', journal)
    await creerArborescenceProjet(racine, projet)

    const dossierProjet = racine.sousDossiers.get(slugProjet(projet))
    const chantier = dossierProjet.sousDossiers.get('07_CHANTIER')
    chantier.fichiers.add('20260112_P07_CR_reunion-3.pdf')
    const avant = journal.length

    const r2 = await creerArborescenceProjet(racine, projet)

    assert.deepEqual(r2.crees, [], 'rejouée sur une arborescence complète, la fonction ne crée rien')
    assert.deepEqual(
      r2.existants,
      ARBORESCENCE.map((a) => a.dossier),
      'les sous-dossiers déjà là doivent être rendus comme « existants », pas comme « créés »',
    )
    assert.equal(journal.length, avant, 'aucune écriture ne doit avoir lieu sur une arborescence déjà complète')
    assert.ok(
      chantier.fichiers.has('20260112_P07_CR_reunion-3.pdf'),
      'les fichiers déjà rangés doivent être intacts — la fonction complète les dossiers, elle ne les remplace pas',
    )
    assert.ok(!journal.some((l) => l.startsWith('SUPPRIME:')), 'rejouée, elle ne supprime toujours rien')

    // dossier manquant sur un projet ancien : elle complète, sans toucher au reste
    dossierProjet.sousDossiers.delete('10_PHOTOS')
    const r3 = await creerArborescenceProjet(racine, projet)
    assert.deepEqual(r3.crees, ['10_PHOTOS'], 'un dossier manquant doit être le seul recréé')
    assert.equal(r3.existants.length, ARBORESCENCE.length - 1, 'les autres restent des existants')
  }

  // --- 3. permission refusée : elle lève, et n’a rien créé -------------------
  {
    const journal = []
    const racine = faireDossier('Drive', journal)
    racine.requestPermission = async () => 'denied'

    await assert.rejects(
      creerArborescenceProjet(racine, projet),
      /refus/i,
      'permission refusée : la fonction doit lever avec un message explicite, jamais rendre un succès silencieux',
    )
    assert.equal(racine.sousDossiers.size, 0, 'rien ne doit avoir été créé quand la permission est refusée')
  }

  // --- 4. un seul endroit crée des dossiers dans le Drive --------------------
  //
  // L'invariante qui empêche le doublon de revenir : si un module remet une
  // boucle de création en direct, l'arborescence des projets diverge selon la
  // porte par laquelle ils sont nés.
  {
    const fichiers = []
    const parcourir = (dir) => {
      for (const e of fs.readdirSync(path.join(racineDepot, dir), { withFileTypes: true })) {
        if (e.isDirectory()) parcourir(`${dir}/${e.name}`)
        else if (/\.tsx?$/.test(e.name)) fichiers.push(`${dir}/${e.name}`)
      }
    }
    parcourir('src')

    for (const f of fichiers) {
      if (f === 'src/fsdrive.ts') continue
      assert.doesNotMatch(
        lire(f),
        /getDirectoryHandle\([^)]*create:\s*true/,
        `${f} : aucun module ne crée de dossier dans le Drive en direct — tout passe par src/fsdrive.ts, sinon l’arborescence diverge selon le module qui l’écrit`,
      )
    }

    for (const appelant of ['src/modules/ProjetDocuments.tsx', 'src/modules/ProjetNouveau.tsx']) {
      assert.match(
        lire(appelant),
        /creerArborescenceProjet/,
        `${appelant} doit passer par creerArborescenceProjet — le bouton manuel et l’assistant partagent la même fonction`,
      )
    }
  }

  // --- 5. l’échec Drive ne peut pas faire perdre la saisie -------------------
  {
    const source = lire('src/modules/ProjetNouveau.tsx')
    const m = /const creer = [\s\S]*?\n  \}\n/.exec(source)
    assert.ok(m, 'src/modules/ProjetNouveau.tsx : la fonction `creer` est introuvable')
    const creer = m[0]

    const iUpdate = creer.indexOf('update((d)')
    const iArbo = creer.indexOf('creerArborescenceProjet')
    assert.ok(iUpdate >= 0, '`creer` doit enregistrer le projet par update()')
    assert.ok(iArbo >= 0, '`creer` doit créer l’arborescence documentaire (CDC §12.1 points 6 et 7)')
    assert.ok(
      iUpdate < iArbo,
      'l’enregistrement du projet doit précéder la création des dossiers : une écriture disque qui échoue ne doit pas emporter trois écrans de saisie',
    )
    assert.match(
      creer,
      /void creerArborescenceProjet\(/,
      'l’appel doit être lancé sans être attendu (`void`) : le projet est déjà enregistré, l’assistant n’a pas à rester bloqué sur le disque',
    )
    assert.match(
      creer.slice(iArbo),
      /\.catch\(/,
      'l’appel doit porter son `.catch` : un échec Drive se signale, il ne remonte pas en promesse non gérée',
    )
    assert.ok(
      creer.slice(iArbo).includes('onClose()'),
      'la fermeture de l’assistant ne doit pas dépendre du résultat de la création des dossiers',
    )
  }

  console.log('OK — arborescence documentaire : une seule fonction, idempotente, et son échec ne coûte pas la saisie.')
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
