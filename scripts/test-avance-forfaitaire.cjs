// Audit d'usage, action 5 (constat T3) — l'avance forfaitaire est SAISISSABLE,
// et ce qui est saisi parvient au certificat de paiement.
//
// LE MODE DE PANNE QUE CE TEST FERME
// ------------------------------------
// `Marche.avanceForfaitaireHT` était typé (`types.ts`) et LU par
// `construireCertificat` (`certificat.ts`) — mais aucun écran ne l'écrivait.
// Conséquence exacte, vérifiée ci-dessous en euros : chaque état d'acompte
// mensuel proposait 0 d'avance et 0 de résorption. Sur un marché avec avance,
// l'agence certifiait donc au maître d'ouvrage un montant TROP ÉLEVÉ, tous
// les mois, jusqu'à ce que quelqu'un pense à corriger la ligne à la main —
// état après état, entreprise après entreprise. Personne ne recompte un
// certificat « calculé par l'outil » : le trop-payé s'installe.
//
// Le champ ne « manque » donc pas par oubli d'ergonomie : il manque de
// l'argent au décompte. D'où les trois verrous d'ici :
//
//   1. le CHIFFRAGE : la résorption CCAG que l'avance déclenche vaut
//      exactement ce qu'elle vaut, et sans le champ le certificat propose
//      1 890 € de trop sur le cas posé — le montant de l'erreur est dit ;
//   2. la SAISIE : la modale du marché porte le champ, et sa valeur entre
//      bien dans l'objet enregistré (un champ qui ne quitte pas le
//      formulaire ne vaut rien) ;
//   3. la PROPOSITION reste une proposition : les 5 % du CCAG sont
//      décochables, et « vide » enregistre `null`, jamais 0 — un marché sans
//      avance et un marché dont l'avance n'a pas été relevée ne sont pas la
//      même chose (« null n'est pas 0 »), et une avance INVENTÉE ferait
//      résorber au titulaire un argent qu'il n'a jamais reçu.

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

// --- le cas posé à la main --------------------------------------------------
//
// Un marché de 63 000 € HT, non révisable, garantie retenue au taux courant.
// Le décompte du mois porte le chantier à 45 675 € cumulés, soit 72,5 %
// d'avancement : au CCAG, la résorption de l'avance a commencé (elle démarre
// à 65 %) et n'est pas soldée (elle l'est à 80 %). C'est le mois où le champ
// se paie — celui où l'avance N'EST NI absente NI soldée, donc celui qu'une
// saisie manquante rend faux sans que rien ne crie.

const etat = (avanceForfaitaireHT) => ({
  settings: { nomAgence: 'Agence LL', personnes: ['Julien', 'Zoé'] },
  projets: [{ id: 'P-01', nom: 'Groupe scolaire', moa: 'Ville de Beauvais', phases: [] }],
  marches: [
    {
      id: 'M-01',
      projetId: 'P-01',
      entreprise: 'Martin BTP',
      lot: 'Lot 01 — Gros œuvre',
      montantInitialHT: 63000,
      avenantsHT: 0,
      tauxRG: 0.05,
      garantie: 'retenue',
      avanceForfaitaireHT,
      avanceRembourseeHT: 0,
      revision: false,
      delaiVerifJours: 15,
      actif: true,
    },
  ],
  situations: [
    {
      id: 'sit-1',
      projetId: 'P-01',
      marcheId: 'M-01',
      entreprise: 'Martin BTP',
      mois: '2026-06',
      numero: 1,
      montantMoisHT: null,
      montantCumulHT: 45675, // 72,5 % de 63 000
      revisionHT: null,
      statut: 'validee',
      dateReception: '2026-07-02',
    },
  ],
  indicesBTP: [],
  evenementsMarche: [],
  certificats: [],
})

// --- 1. le chiffrage : ce que le champ vide coûtait chaque mois -------------

{
  // l'état d'AVANT la correction : personne n'écrivait le champ, il valait
  // donc `undefined` sur tous les marchés du dépôt
  const sans = C.construireCertificat(etat(undefined), 'sit-1')
  assert.ok(sans, 'la situation est rattachée à un marché : le certificat se construit')
  assert.equal(
    sans.proposition.avanceInitialeHT,
    0,
    'avance non saisie ⇒ le certificat ne connaît AUCUNE avance : c’est l’état que ce test ferme',
  )
  assert.equal(
    sans.proposition.resorptionHT,
    0,
    'sans avance connue, rien à résorber — et la ligne à corriger à la main, état après état',
  )

  // le même mois, avec les 5 % du CCAG saisis à la création du marché
  const avec = C.construireCertificat(etat(3150), 'sit-1')
  assert.equal(avec.proposition.avanceInitialeHT, 3150, '5 % × 63 000 — la valeur SAISIE, pas un recalcul')
  assert.equal(
    avec.proposition.resorptionHT,
    1575,
    'à 72,5 % d’avancement, la règle CCAG (65 % → 80 %) résorbe la moitié de l’avance',
  )

  // LE chiffre de l'affaire : l'écart entre les deux certificats, en euros
  // réellement certifiés au maître d'ouvrage. 1 575 € HT de résorption
  // deviennent 1 890 € TTC — l'avance ayant été versée TTC.
  const ecartTotal = Math.round((sans.proposition.totalTTC - avec.proposition.totalTTC) * 100) / 100
  assert.equal(
    ecartTotal,
    1890,
    'sans le champ, le présent état est majoré de 1 890 € TTC (1 575 HT × 1,20) — le montant exact du défaut fermé ici',
  )
  // et sur le NET, ce que le maître d'ouvrage paie réellement : la retenue de
  // garantie de 5 % suit le total, donc l'écart y vaut 1 890 − 94,50
  const ecartNet = Math.round((sans.proposition.netAPayerTTC - avec.proposition.netAPayerTTC) * 100) / 100
  assert.equal(
    ecartNet,
    1795.5,
    'net à payer : 1 795,50 € de trop virés à l’entreprise ce mois-là (la RG de 5 % suit le total)',
  )

  assert.equal(
    avec.proposition.avanceResteHT,
    1575,
    'la moitié de l’avance reste à résorber : le compteur du marché suit d’un état à l’autre',
  )
  assert.ok(
    avec.mentions.some((m) => /CCAG/.test(m) && /corrigez/i.test(m)),
    'la résorption est PROPOSÉE et le dit : le CCAP de l’entreprise peut prévoir d’autres seuils',
  )
}

// --- 2. « null n'est pas 0 », dans les deux sens ----------------------------

{
  const zero = C.construireCertificat(etat(0), 'sit-1')
  assert.equal(zero.proposition.resorptionHT, 0, 'avance à 0 : rien à résorber, sans erreur')

  const negatif = C.construireCertificat(etat(-500), 'sit-1')
  assert.equal(
    negatif.proposition.avanceInitialeHT,
    0,
    'une avance négative n’existe pas : le certificat la borne au lieu de créditer l’entreprise',
  )

  assert.equal(C.resorptionProposee(3150, 0, 0.64), 0, 'sous 65 % d’avancement, on ne résorbe rien')
  assert.equal(C.resorptionProposee(3150, 0, 0.8), 3150, 'à 80 %, l’avance est soldée')
  assert.equal(C.resorptionProposee(3150, 3150, 0.95), 0, 'déjà soldée : on ne résorbe pas deux fois')
}

// --- 3. la saisie existe, et elle SORT du formulaire ------------------------

const chantier = lire('src/modules/ProjetChantier.tsx')

{
  // le contrôle lui-même, nommé pour le lecteur d'écran
  assert.match(
    chantier,
    /ariaLabel="Avance forfaitaire du marché en euros HT"/,
    'la modale du marché doit porter un champ « Avance forfaitaire » — c’est le seul endroit où la donnée peut naître',
  )

  // …et surtout : la valeur affichée entre dans l'objet enregistré. Un champ
  // dont la valeur ne rejoint pas `champs` reste dans le formulaire et le
  // certificat continue de proposer 0.
  const enregistrement = chantier.match(/avanceForfaitaireHT:[^\n]*/)
  assert.ok(enregistrement, 'le marché enregistré doit porter `avanceForfaitaireHT`')
  assert.match(
    enregistrement[0],
    /avanceRetenue/,
    'c’est la valeur RETENUE à l’écran qui est enregistrée — pas une constante, pas une valeur d’origine',
  )
  assert.match(
    enregistrement[0],
    /: null/,
    'vide ⇒ null (et non 0) : « pas d’avance » et « avance non relevée » ne sont pas la même chose',
  )

  // une seule autorité d'écriture : si un second écran posait ce champ, deux
  // valeurs d'avance pourraient exister pour le même marché
  const ecrivains = fs
    .readdirSync(path.join(racine, 'src/modules'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `src/modules/${f}`)
    .filter((f) => /avanceForfaitaireHT\s*:/.test(lire(f)))
  assert.deepEqual(
    ecrivains,
    ['src/modules/ProjetChantier.tsx'],
    'un seul écran écrit l’avance du marché : deux points de saisie = deux avances possibles pour le même marché',
  )
}

// --- 4. la proposition 5 % reste une proposition ----------------------------

{
  assert.match(
    chantier,
    /montantInitial \* 0\.05/,
    'la proposition du CCAG (5 % du montant initial) doit être calculée depuis le montant saisi',
  )
  assert.match(
    chantier,
    /type="checkbox"[\s\S]{0,200}checked=\{avanceAuto\}/,
    'la proposition 5 % est DÉCOCHABLE : un marché sans avance existe, et une avance inventée ferait résorber un argent jamais reçu',
  )
  assert.match(
    chantier,
    /setAvanceAuto\(false\)/,
    'taper un montant décoche la proposition : la saisie humaine fait foi (§15 — la machine propose, l’humain décide)',
  )
  // la modale ne DÉCIDE pas de la résorption : elle n'écrit que l'avance
  // versée. Le calendrier de résorption reste au certificat, autorité unique.
  assert.doesNotMatch(
    chantier,
    /resorptionProposee/,
    'la règle de résorption vit dans certificat.ts et nulle part ailleurs — la recopier ferait diverger l’écran du document émis',
  )
}

console.log(
  'Avance forfaitaire : saisissable dans la modale du marché (5 % proposés, décochables, vide ⇒ null), ' +
    'la valeur retenue rejoint le marché enregistré et parvient à construireCertificat — sans elle, le ' +
    'certificat du cas posé proposait 1 890 € TTC de trop, tous les mois.',
)
