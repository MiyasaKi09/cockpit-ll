// 5.16 — cycle de vie des factures sur portail agréé (Chorus Pro / PDP).
//
// L'import CSV du cycle de vie existait (Connecteurs), mais le statut ne
// remontait pas dans l'écran Facturation : une facture rejetée par Chorus
// restait affichée comme une facture ordinaire, et une facture émise à un
// client public jamais déposée ne se voyait nulle part — deux façons de
// découvrir le problème quand l'encaissement manque, des semaines plus tard.
//
// Trois garanties tenues ici :
//
//   1. la « dernière transmission » est la plus récente PAR DATE, jamais le
//      dernier élément du tableau — l'import CSV ajoute dans l'ordre du
//      fichier, et un import rejoué peut appendre un événement ANCIEN après
//      un récent : lire l'ordre d'arrivée afficherait « déposée » sur une
//      facture déjà rejetée ;
//   2. un rejet est DÉTECTÉ et remonte : dans l'écran Facturation (badge,
//      alerte avec motif) et dans « à traiter » (financeActions), par la
//      MÊME fonction — deux lectures divergentes montreraient deux vérités ;
//   3. le rappel « à déposer » ne vise QUE les pièces émises d'un client
//      public sans transmission — un client privé n'a aucune obligation de
//      portail aujourd'hui, le badge chez lui serait du bruit qui apprend
//      à ignorer les badges.

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

const facture = (surcharge = {}) => ({
  id: 'fac-1',
  projetId: 'P01',
  phase: 'DET',
  libelle: 'Honoraires',
  montantHT: 1000,
  tauxTVA: 0.2,
  emission: '2026-07-01',
  delaiJours: 30,
  statut: 'emise',
  ...surcharge,
})
const ev = (date, statut, extra = {}) => ({ date, plateforme: 'chorus', statut, ...extra })

// --- 1. la dernière transmission est la plus récente PAR DATE ---------------

{
  assert.equal(F.derniereTransmission(facture()), null, 'sans suivi, pas de transmission inventée')
  assert.equal(F.derniereTransmission(facture({ transmissions: [] })), null)

  // L'ordre chronologique du tableau : le cas simple.
  const chronologique = facture({ transmissions: [ev('2026-07-02', 'deposee'), ev('2026-07-10', 'rejetee', { motif: 'SIRET inconnu' })] })
  assert.equal(F.derniereTransmission(chronologique).statut, 'rejetee', 'le rejet est détecté quand il est le plus récent')
  assert.equal(F.derniereTransmission(chronologique).motif, 'SIRET inconnu', 'le motif suit — un rejet sans motif n’est pas une action')

  // Le cas qui justifie la fonction : un import CSV rejoué appende un
  // événement ANCIEN après un récent. Le dernier élément du tableau est la
  // « déposée » du 2 juillet ; la vérité est la « payée » du 20.
  const desordre = facture({ transmissions: [ev('2026-07-20', 'payee'), ev('2026-07-02', 'deposee')] })
  assert.equal(
    F.derniereTransmission(desordre).statut,
    'payee',
    'la dernière transmission se lit PAR DATE, pas par position dans le tableau',
  )

  // À date égale, le dernier ARRIVÉ gagne : deux événements le même jour
  // (dépôt puis rejet immédiat), c'est le second qui décrit l'état.
  const memeJour = facture({ transmissions: [ev('2026-07-02', 'deposee'), ev('2026-07-02', 'rejetee', { motif: 'format' })] })
  assert.equal(F.derniereTransmission(memeJour).statut, 'rejetee', 'à date égale, l’événement ajouté en dernier gagne')

  // Une date vide (l'import CSV en produit : `date: ev.date || ''`,
  // Connecteurs.tsx) se classe comme la plus ancienne — elle ne doit jamais
  // masquer un événement daté.
  const dateVide = facture({ transmissions: [ev('2026-07-10', 'approuvee'), ev('', 'deposee')] })
  assert.equal(F.derniereTransmission(dateVide).statut, 'approuvee', 'un événement sans date ne masque pas un événement daté')
}

// --- 2. le rejet remonte partout par la MÊME lecture ------------------------

{
  // financeActions (« à traiter ») lit derniereTransmission — pas le dernier
  // élément du tableau. Sans cela, l'écran Facturation et le badge Finance
  // pourraient dire deux choses différentes de la même facture.
  const financeActions = lire('src/financeActions.ts')
  assert.match(financeActions, /derniereTransmission\(f\)/, '« à traiter » lit le rejet via derniereTransmission')
  assert.doesNotMatch(
    financeActions,
    /transmissions\?\.\[|transmissions\[f\.transmissions\.length/,
    '« à traiter » ne relit pas le tableau à la main : la seconde lecture divergerait de l’écran',
  )

  const facturation = lire('src/modules/Facturation.tsx')
  assert.match(facturation, /derniereTransmission/, 'l’écran Facturation lit le cycle de vie par la fonction pure')
  assert.doesNotMatch(
    facturation,
    /transmissions!\[f\.transmissions!\.length - 1\]/,
    'plus de lecture « dernier élément du tableau » dans l’écran',
  )
  assert.match(facturation, /BadgeTransmission/, 'le statut portail est un BADGE par facture, pas un texte discret')
  // Les libellés couvrent les statuts RÉELS du type EvenementTransmission.
  for (const statut of ['deposee', 'rejetee', 'mise_a_disposition', 'approuvee', 'payee']) {
    assert.ok(
      new RegExp(`${statut}: '`).test(facturation),
      `le statut « ${statut} » du type EvenementTransmission a son libellé français`,
    )
  }
  assert.match(
    facturation,
    /rejetée\(s\) sur le portail/,
    'une alerte VISIBLE (pill-note) liste les factures rejetées — pas seulement une ligne de tableau',
  )
}

// --- 3. « à déposer » : client public, pièce émise, aucune transmission -----

{
  const publicMO = { id: 'P01', typeMO: 'Public' }
  const priveMO = { id: 'P02', typeMO: 'Privé pro' }
  const particulier = { id: 'P03', typeMO: 'Particulier' }

  assert.equal(F.estADeposer(facture(), publicMO), true, 'facture émise à un client public sans transmission → à déposer')
  assert.equal(
    F.estADeposer(facture({ type: 'avoir', montantHT: -500 }), publicMO),
    true,
    'un avoir émis se dépose comme la facture qu’il corrige',
  )

  // Un client privé n'est JAMAIS « à déposer » : aucune obligation de portail
  // aujourd'hui — le badge serait du bruit.
  assert.equal(F.estADeposer(facture(), priveMO), false, 'client privé pro : jamais « à déposer »')
  assert.equal(F.estADeposer(facture(), particulier), false, 'particulier : jamais « à déposer »')
  assert.equal(F.estADeposer(facture(), undefined), false, 'projet introuvable : on ne devine pas un type de MO')

  // Dès qu'une transmission existe, le rappel s'éteint — même si c'est un
  // rejet : le rejet a SA propre alerte, plus urgente et plus précise.
  assert.equal(
    F.estADeposer(facture({ transmissions: [ev('2026-07-02', 'deposee')] }), publicMO),
    false,
    'une transmission suivie éteint le rappel de dépôt',
  )
  assert.equal(
    F.estADeposer(facture({ transmissions: [ev('2026-07-02', 'rejetee', { motif: 'x' })] }), publicMO),
    false,
    'une facture rejetée n’est pas « à déposer » : elle est « rejetée », alerte dédiée',
  )

  // Une pièce soldée n'est plus une action de dépôt ; une prévision n'est
  // pas encore une pièce.
  assert.equal(F.estADeposer(facture({ statut: 'encaissee' }), publicMO), false, 'une pièce encaissée n’a plus de dépôt à rappeler')
  assert.equal(F.estADeposer(facture({ statut: 'prevue' }), publicMO), false, 'une prévision n’est pas une pièce à déposer')

  // Et l'écran porte bien le badge.
  assert.match(lire('src/modules/Facturation.tsx'), /estADeposer/, 'l’écran Facturation calcule le rappel par la fonction pure')
  assert.match(lire('src/modules/Facturation.tsx'), /à déposer/, 'le badge « à déposer » est rendu')
}

console.log(
  'Transmissions : la dernière se lit par date (un import CSV rejoué ne remet pas « déposée » sur un rejet), ' +
    'le rejet remonte en badge, en alerte et dans « à traiter » par la même fonction, ' +
    'et « à déposer » ne vise que les pièces émises d’un client public sans transmission — jamais un client privé.',
)
