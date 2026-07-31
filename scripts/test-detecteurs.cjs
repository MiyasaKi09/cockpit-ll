// A.10 — les détecteurs, en deux étages (§12.3 pts 5-8, §19.2 pt 6, §20).
//
// Un détecteur se juge à ses FAUX POSITIFS, pas à ses trouvailles. Une
// détection manquée coûte une saisie manuelle ; une détection fausse coûte
// la confiance dans toute la file, et une file en laquelle on n'a plus
// confiance n'est plus relue — donc tout passe.
//
// Ce test exerce donc réellement l'étage déterministe sur des phrases
// françaises d'agence, et il porte surtout sur ce qui ne doit RIEN
// produire. Il tient six choses :
//
//   1. les dates sont résolues par rapport à la DATE D'ENVOI, jamais à
//      aujourd'hui — c'est l'erreur nommée par le plan, et elle est
//      invisible : le résultat reste une date plausible ;
//   2. une date au passé n'est pas une échéance, et une date seule non plus ;
//   3. les risques se limitent aux QUATRE natures que le fil d'urgences ne
//      voit pas — les cinq autres s'afficheraient deux fois ;
//   4. aucune détection ne désigne de responsable : le §3.15 pose qu'aucune
//      machine ne choisit qui est notifié ;
//   5. rien ne sort vers `workspace.data` — les détections n'ont qu'une
//      destination, et c'est structurel, pas conventionnel ;
//   6. le second étage refuse une détection sans extrait, sans confiance ou
//      sans raisons, au lieu de la compléter.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const racine = path.resolve(__dirname, '..')
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8')

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
    if (id === 'react') return { useCallback: (f) => f, useEffect: () => {}, useMemo: (f) => f(), useRef: () => ({}), useState: () => [] }
    if (id === '@supabase/supabase-js') return { createClient: () => null }
    if (id.startsWith('.')) return charger(path.posix.join(path.posix.dirname(fichier), id))
    throw new Error(`Dépendance externe inattendue dans ${fichier} : ${id}`)
  })
  cache.set(fichier, mod.exports)
  return mod.exports
}

const { detecter, dateDansPhrase } = charger('src/detecteurs.ts')
const { NATURES_RISQUE, GENRES_PROPOSITION } = charger('src/propositions.ts')
const { MARQUEURS_ACTION } = charger('src/tagging.ts')

const ENVOI = '2026-07-31' // un vendredi
const genres = (texte, envoye = ENVOI) => detecter(texte, envoye).map((d) => d.genre)
const un = (texte, genre, envoye = ENVOI) => detecter(texte, envoye).find((d) => d.genre === genre)

// --- 1. les dates se résolvent depuis la DATE D'ENVOI -----------------------

{
  // C'est l'erreur que le plan nomme, et elle ne se voit pas : un message lu
  // trois semaines après son arrivée produirait une échéance décalée de trois
  // semaines, et le résultat resterait une date parfaitement plausible.
  assert.equal(dateDansPhrase('Merci de répondre demain.', ENVOI).date, '2026-08-01')
  assert.equal(dateDansPhrase('Merci de répondre demain.', '2026-01-15').date, '2026-01-16')

  // « lundi » = le PROCHAIN lundi strictement après l'envoi. Le 31/07/2026
  // est un vendredi ; le lundi suivant est le 3 août.
  assert.equal(dateDansPhrase('On se cale lundi prochain.', ENVOI).date, '2026-08-03')
  // Envoyé un lundi, « lundi » désigne le lundi SUIVANT, pas le jour même :
  // sinon l'échéance serait déjà échue à la seconde où elle est proposée.
  assert.equal(dateDansPhrase('On se cale lundi.', '2026-08-03').date, '2026-08-10')

  assert.equal(dateDansPhrase('Remise le 15 septembre.', ENVOI).date, '2026-09-15')
  assert.equal(dateDansPhrase('Remise le 15/09.', ENVOI).date, '2026-09-15')
  assert.equal(dateDansPhrase('Remise le 15/09/2027.', ENVOI).date, '2027-09-15')
  // Le format français est jour/mois. Le lire à l'américaine décalerait
  // silencieusement toutes les échéances des douze premiers jours du mois.
  assert.equal(dateDansPhrase('Remise le 03/09.', ENVOI).date, '2026-09-03')
  assert.equal(dateDansPhrase('Réponse sous quinzaine.', ENVOI).date, '2026-08-15')
  assert.equal(dateDansPhrase('Réponse sous 10 jours.', ENVOI).date, '2026-08-10')
  assert.equal(dateDansPhrase('Livraison fin septembre.', ENVOI).date, '2026-09-30')

  // Sans année, une date déjà passée dans l'année d'envoi bascule sur
  // l'année suivante : une échéance regarde devant.
  assert.equal(dateDansPhrase('Rendu le 3 mars.', ENVOI).date, '2027-03-03')
}

// --- rien de ce qui n'est pas une date ne doit en devenir une ---------------

for (const texte of [
  'La version 1.12/09.3 du logiciel est installée.',
  'Le lot 3 représente 45/60 des travaux restants.',
  'Nous avons reçu le devis du bureau de contrôle.',
  'Le montant est de 12 000 € HT.',
]) {
  assert.equal(
    dateDansPhrase(texte, ENVOI),
    null,
    `« ${texte} » ne contient pas de date : en fabriquer une produirait une échéance inventée`,
  )
}

// --- 2. une date au passé n'est pas une échéance ----------------------------

{
  assert.deepEqual(
    genres('Nous étions sur place le 12 juin dernier.'),
    [],
    'un rappel du passé ne produit rien : le proposer ferait apparaître un retard qui n’existe pas',
  )
  assert.deepEqual(
    genres('Le rendu était prévu pour le 03/06/2026.'),
    [],
    'même avec un verbe de rendu, une date antérieure à l’envoi reste du passé',
  )

  // Une date seule ne fait pas une échéance : il faut un mot qui engage.
  assert.deepEqual(
    genres('Nous serons en congés le 15 septembre.'),
    [],
    'une date citée en passant ne remplit pas la file d’échéances',
  )
  assert.deepEqual(
    genres('Remise des offres au plus tard le 15 septembre.'),
    ['echeance'],
    'une date PLUS un mot qui engage : là, c’est une échéance',
  )
}

// --- une phrase ne produit pas deux fois la même chose ----------------------

{
  const sorties = detecter('Pouvez-vous nous envoyer le DCE avant le 15 septembre ?', ENVOI)
  assert.deepEqual(
    sorties.map((d) => d.genre),
    ['tache'],
    'une demande datée est UNE chose à faire, pas une tâche plus une échéance : ' +
      'la dédoubler ferait relire la même phrase deux fois en revue',
  )
  assert.equal(sorties[0].chargeUtile.echeance, '2026-09-15', 'et la tâche porte la date')
}

// --- 3. les risques, et seulement les quatre natures ------------------------

{
  const attendus = {
    'Contrairement à ce que vous aviez indiqué, la surface passe à 1 200 m².': 'demande_contradictoire',
    'Le maître d’ouvrage annonce un changement de programme sur le rez-de-chaussée.': 'modification_de_programme',
    'Le bureau de contrôle émet un avis défavorable sur le lot 3.': 'reserve_technique',
    'Il reste à caler la reprise en sous-œuvre, mais qui s’en charge ?': 'responsabilite_non_attribuee',
  }
  for (const [phrase, nature] of Object.entries(attendus)) {
    const r = un(phrase, 'risque')
    assert.ok(r, `« ${phrase} » doit produire un risque`)
    assert.equal(r.chargeUtile.nature, nature, `nature attendue pour « ${phrase} »`)
  }

  // Les cinq natures du §6.3 déjà produites par `computeAlertes` ne doivent
  // PAS être redétectées : elles apparaîtraient deux fois dans la fiche
  // projet, et un risque affiché deux fois se lit comme deux risques.
  for (const phrase of [
    'Le chantier a trois semaines de retard sur le planning.',
    'Le budget travaux est dépassé de 8 %.',
    'La situation de mars n’a toujours pas été validée.',
    'Nous attendons toujours le rapport du géotechnicien.',
  ]) {
    const r = un(phrase, 'risque')
    assert.equal(
      r,
      undefined,
      `« ${phrase} » relève d’une nature déjà suivie par le fil d’urgences : la redétecter la doublerait`,
    )
  }

  // La garantie structurelle : la seule liste de natures est celle d'A.9.
  const source = lire('src/detecteurs.ts')
  const citees = [...source.matchAll(/nature: '([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(citees.length >= 4, 'les quatre natures doivent être couvertes')
  for (const n of citees)
    assert.ok(
      NATURES_RISQUE.includes(n),
      `« ${n} » n’est pas une nature du référentiel : la contrainte SQL la refuserait, ` +
        'et le refus n’apparaîtrait qu’à l’insertion, sur une détection qu’on ne reverra pas',
    )
}

// --- 4. aucune détection ne désigne de responsable --------------------------

{
  const sorties = detecter('Julien, merci de relancer le BET structure lundi.', ENVOI)
  const tache = sorties.find((d) => d.genre === 'tache')
  assert.ok(tache, 'la phrase est bien une tâche')
  assert.equal(
    tache.chargeUtile.responsable,
    null,
    'même quand un prénom figure dans la phrase, la machine ne désigne personne : ' +
      'le §3.15 pose qu’aucun modèle ne choisit qui est notifié — une règle lexicale non plus',
  )
}

// --- les bornes de forme ----------------------------------------------------

{
  const longue = `Merci de vérifier ${'le dossier de consultation des entreprises '.repeat(20)}avant lundi.`
  const t = un(longue, 'tache')
  assert.ok(t, 'une phrase longue reste détectable')
  assert.ok(t.extrait.length <= 240, 'l’extrait est borné : au-delà, ce n’est plus une citation mais une copie')
  assert.ok(t.extrait.endsWith('…'), 'et la coupe se voit')

  for (const d of detecter(longue, ENVOI)) {
    assert.ok(d.confiance > 0 && d.confiance <= 0.95, 'la confiance reste dans 0-0,95')
    assert.ok(d.raisons.length > 0, 'une détection sans raison n’est pas relisible')
    assert.ok(
      d.raisons.every((r) => typeof r === 'string' && r.trim() !== ''),
      'les raisons sont des phrases, pas des codes',
    )
    assert.ok(GENRES_PROPOSITION.includes(d.genre), 'le genre appartient au référentiel d’A.9')
    assert.equal(d.origine, 'lexique', 'l’étage qui a détecté est tracé')
  }

  assert.equal(
    detecter('', ENVOI).length + detecter('   ', ENVOI).length,
    0,
    'un message vide ne produit rien — et surtout pas une erreur',
  )
  // Sans date d'envoi, aucune date relative n'est résoluble. Le reste passe.
  assert.deepEqual(genres('Merci de relancer le BET lundi prochain.', null), ['tache'])
  assert.equal(un('Merci de relancer le BET lundi prochain.', 'tache', null).chargeUtile.echeance, null)
}

// --- le lexique d'action est celui de `src/tagging.ts`, pas un second -------

assert.ok(Array.isArray(MARQUEURS_ACTION) && MARQUEURS_ACTION.length >= 8, 'MARQUEURS_ACTION doit être exporté')
assert.match(
  lire('src/detecteurs.ts'),
  /import \{ MARQUEURS_ACTION \} from '\.\/tagging'/,
  'le détecteur PART du lexique existant : deux listes auraient fini par diverger, ' +
    'et la divergence se verrait là où on la remarque le moins',
)

// --- 5. rien ne sort vers `workspace.data` ----------------------------------

{
  const source = lire('src/detecteurs.ts')
  // Le détecteur ne fait qu'une chose : rendre des objets. Une détection
  // écrite dans l'état partagé serait une tâche, une décision ou un risque
  // créés par une machine — ce que le §15 refuse.
  for (const chemin of [
    /from '\.\/store'/,
    /from '\.\/sync'/,
    /from '\.\/horsLigne'/,
    /\bfetch\(/,
    /localStorage/,
    /\buseStore\b/,
  ]) {
    assert.doesNotMatch(source, chemin, `le détecteur ne doit rien atteindre qui écrive : ${chemin}`)
  }
  // Il importe des TYPES de `propositions`, jamais sa couche d'écriture.
  assert.match(
    source,
    /import type \{[\s\S]*?\} from '\.\/propositions'/,
    'les formes de charge utile viennent d’A.9, mais en type seulement — aucun chemin d’écriture',
  )
  assert.doesNotMatch(source, /from '\.\/types'/, 'il ne connaît même pas l’état de l’application')
}

// --- 6. le second étage refuse plutôt que de compléter ----------------------

const { parseRetourRoutine } = charger('src/importRoutines.ts')

{
  const avec = (detections) =>
    parseRetourRoutine(
      JSON.stringify({
        type: 'courriers',
        items: [{ de: 'a@b.c', objet: 'Objet', resume: 'Un résumé.', detections }],
      }),
    ).retour.items[0].detections

  const bonne = {
    genre: 'tache',
    extrait: 'Merci de confirmer le planning avant vendredi.',
    confiance: 0.8,
    raisons: ['Demande adressée explicitement.'],
    chargeUtile: { titre: 'Confirmer le planning' },
  }
  assert.equal(avec([bonne]).length, 1, 'une détection complète passe')

  // Les trois champs manquants sont ceux SANS lesquels la revue est
  // impossible. Les compléter d'un défaut serait pire que les refuser :
  // un extrait fabriqué aurait l'air d'une citation.
  for (const [champ, valeur] of [
    ['extrait', ''],
    ['raisons', []],
    ['confiance', 'élevée'],
  ]) {
    assert.equal(
      avec([{ ...bonne, [champ]: valeur }]),
      undefined,
      `sans « ${champ} », la détection est REFUSÉE, pas complétée : une revue impossible n’est pas faite`,
    )
  }

  assert.equal(
    avec([{ ...bonne, confiance: 1 }])[0].confiance,
    0.95,
    'la confiance est plafonnée : afficher 1,00 inviterait à accepter sans lire',
  )
  assert.equal(avec([{ ...bonne, confiance: -3 }])[0].confiance, 0, 'et plancher à 0')
  assert.equal(avec('pas une liste'), undefined, 'un champ mal typé ne fait pas échouer tout l’import')
  assert.equal(avec([]), undefined, 'aucune détection : le champ reste absent, pas une liste vide')
}

// --- l'étage modèle, côté fonction Edge -------------------------------------

{
  const compile = ts.transpileModule(lire('supabase/functions/resume-messages/resume.ts'), {
    fileName: 'resume.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile)(mod, mod.exports, () => {
    throw new Error('resume.ts doit rester pur')
  })
  const { detectionsDuRetour, nettoyerResume } = mod.exports

  const reponse =
    'Le client valide la variante B.\n' +
    'Il demande les plans avant vendredi.\n' +
    '```json\n' +
    JSON.stringify({
      detections: [
        { genre: 'tache', extrait: 'Merci de nous envoyer les plans avant vendredi.', confiance: 0.85, raisons: ['Demande datée.'], chargeUtile: { titre: 'Envoyer les plans' } },
        { genre: 'risque', extrait: 'sans extrait valable', confiance: 0.5, raisons: [] },
      ],
    }) +
    '\n```'

  assert.equal(detectionsDuRetour(reponse).length, 1, 'la détection sans raisons est écartée, l’autre passe')
  assert.equal(detectionsDuRetour(reponse)[0].confiance, 0.85)

  // LE point : le bloc JSON ne doit pas finir affiché comme résumé.
  const resume = nettoyerResume(reponse)
  assert.doesNotMatch(resume, /detections|```|\{/, 'le bloc de détections ne s’affiche jamais comme résumé')
  assert.match(resume, /variante B/, 'et le résumé, lui, survit intact')

  // Un JSON cassé coûte les détections, jamais le résumé : ils sont séparés
  // précisément pour ça.
  const casse = 'Le client valide la variante B.\n```json\n{"detections":[ oups\n```'
  assert.deepEqual(detectionsDuRetour(casse), [], 'un bloc malformé ne lève pas et ne produit rien')
  assert.match(nettoyerResume(casse), /variante B/, 'et le résumé passe quand même')

  assert.deepEqual(detectionsDuRetour(null), [], 'aucune réponse : aucune détection, aucune erreur')
  assert.deepEqual(detectionsDuRetour('Un résumé sans bloc.'), [], 'pas de bloc : pas de détection')
}

console.log(
  'Détecteurs : dates résolues depuis l’envoi, passé écarté, quatre natures de risque, ' +
    'aucun responsable désigné, et le second étage refuse plutôt que de compléter.',
)
