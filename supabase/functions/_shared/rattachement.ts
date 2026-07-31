// ============================================================
// LA cascade de rattachement au projet — livrable A.4, §3.7 du plan.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Le §3.7 relève que la même question — « de quel projet parle ce
// message ? » — recevait TROIS réponses différentes selon la porte
// d'entrée :
//
//   * `classer()` / `rattacher()` (serveur, gmail-ingestion) : identifiant
//     de projet dans le texte, à défaut le nom ; le domaine de
//     l'expéditeur ajoutait de la confiance mais ne désignait jamais de
//     projet ;
//   * `devinerProjet()` (navigateur, src/surveillance.ts) : identifiant OU
//     nom (dès 9 caractères) OU nom d'entreprise d'un marché — et le tout
//     cherché dans l'objet, l'EXTRAIT DU CORPS et l'expéditeur mis bout à
//     bout, ce que le §3.7 refuse explicitement pour un message ;
//   * `rapprocherProjet()` (import de routine, src/importRoutines.ts) :
//     identifiant exact, sinon nom contenu — et `null` dès que deux projets
//     correspondaient, seule des trois à refuser de deviner.
//
// Trois réponses, trois échelles de confiance, trois façons de traiter
// l'ambiguïté. Un même mail rangé dans P03 par le serveur, dans P07 par
// l'onglet ouvert, nulle part par l'import : personne ne le voyait, parce
// qu'aucune des trois ne se trompait « visiblement ».
//
// POURQUOI ICI, ET PAS DANS src/
// ------------------------------
// Ce module doit tourner dans TROIS runtimes : le navigateur (Vite), Deno
// (Edge Function d'ingestion) et Node (le test). Deno exige une extension
// `.ts` explicite à l'import, TypeScript en `moduleResolution: bundler` la
// refuse : un module qui importe quoi que ce soit ne peut donc pas être
// partagé tel quel. D'où la contrainte que ce fichier s'impose et que
// `scripts/test-rattachement.cjs` vérifie : AUCUN import, aucune API de
// plateforme. `supabase/functions/_shared/` est par ailleurs le seul
// répertoire dont l'import est PROUVÉ des deux côtés — `membres.ts` y est
// déjà, importé par une fonction en production.
//
// CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS
// --------------------------------------
// Il PROPOSE. Il ne valide rien, n'écrit rien, ne connaît ni table ni état
// applicatif : on lui passe des repères et des indices, il rend un projet,
// une confiance, des raisons en français et le niveau de cascade qui a
// tranché. La correction humaine reste souveraine (§5.1 : « le rattachement
// automatique doit être modifiable ») et c'est elle qui, mémorisée, devient
// une règle réutilisable — le point 5 du §5.1, absent jusqu'ici.
//
// Il REFUSE DE DEVINER. Deux projets à égalité au même niveau ⇒ `null`,
// avec les candidats nommés. C'est la file « à rattacher » : un rattachement
// faux se corrige un par un et se propage à tout un fil, un rattachement
// absent se voit et coûte un clic.
// ============================================================

// ------------------------------------------------------------
// 1. Normalisation
// ------------------------------------------------------------

/** normalise pour comparaison floue (minuscules, sans accents).
 *  Copie EXACTE de `fold` (src/util.ts) — le test compare les deux
 *  fonctions sur une batterie de chaînes, pas leur texte. */
export function fold(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/** l'adresse seule, en minuscules : « Jean Dupont <J.Dupont@BET.fr> » →
 *  « j.dupont@bet.fr ». Rien à deviner, rien à valider : ce qui n'a pas la
 *  forme d'une adresse ressort vide. */
export function normaliserAdresse(brut: string | null | undefined): string {
  const texte = (brut || '').trim()
  const entreChevrons = texte.match(/<([^>]+)>/)
  const candidat = (entreChevrons ? entreChevrons[1] : texte).trim().toLowerCase()
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(candidat) ? candidat : ''
}

/** le domaine d'une adresse, ou '' */
export function domaineDe(brut: string | null | undefined): string {
  const adresse = normaliserAdresse(brut)
  const arobase = adresse.lastIndexOf('@')
  return arobase < 0 ? '' : adresse.slice(arobase + 1)
}

// ------------------------------------------------------------
// 2. Les règles apprises (§5.1 pt 5)
// ------------------------------------------------------------

/** ce qui déclenche une règle : l'adresse exacte, ou tout un domaine */
export type DeclencheurRegle = 'adresse' | 'domaine'

/**
 * Une correction humaine mémorisée. Elle PROPOSE pour les messages
 * suivants ; elle ne valide jamais rien — c'est la contrainte que le §2.11
 * pose pour les règles de catégorisation et qui vaut d'abord ici : une règle
 * apprise écrit la colonne PROPOSÉE, jamais la colonne validée.
 *
 * `creePar` est une trace datée de qui a agi, pas une désignation de
 * personne : elle n'entre donc pas à l'inventaire de `src/personnes.ts`
 * (règle qui tranche du contrat des modules, comme `validePar`).
 */
export interface RegleRattachement {
  id: string
  declencheur: DeclencheurRegle
  /** adresse ou domaine, déjà normalisé en minuscules */
  valeur: string
  projetId: string
  /** ISO — quand la correction a été faite */
  creeLe: string
  /** qui a corrigé ce jour-là (trace, pas référence de personne) */
  creePar?: string
  /** une règle se désactive sans se perdre : on veut pouvoir la rallumer */
  actif: boolean
}

/** les règles utilisables : actives, non vides, projet encore existant */
export function reglesApplicables(
  regles: readonly RegleRattachement[] | null | undefined,
  projetsConnus: readonly string[],
): RegleRattachement[] {
  const connus = new Set(projetsConnus)
  return (regles || []).filter((r) => r && r.actif && r.valeur && connus.has(r.projetId))
}

/**
 * Ajoute (ou remplace) une règle, sans doublon.
 *
 * Deux règles sur la même adresse pointant deux projets sont un piège
 * silencieux : la première gagnerait pour toujours, et personne ne saurait
 * pourquoi la correction d'hier ne prend pas. La dernière correction humaine
 * fait donc autorité — elle remplace la précédente, qui n'avait plus cours.
 */
export function memoriserRegle(
  regles: readonly RegleRattachement[] | null | undefined,
  nouvelle: RegleRattachement,
): RegleRattachement[] {
  const valeur = nouvelle.valeur.trim().toLowerCase()
  if (!valeur || !nouvelle.projetId) return [...(regles || [])]
  const propre: RegleRattachement = { ...nouvelle, valeur }
  const autres = (regles || []).filter(
    (r) => !(r.declencheur === propre.declencheur && r.valeur === valeur),
  )
  return [...autres, propre]
}

// ------------------------------------------------------------
// 3. Les repères — ce que la cascade a le droit de connaître
// ------------------------------------------------------------

export interface ProjetRepere {
  id: string
  nom: string
  /** code lisible côté client (« 2026-034 ») — §3.10 */
  codeExterne?: string
  /** adresse dédiée du projet (§3.2) — le signal le plus fort quand elle existe */
  adresseProjet?: string
}

/** une adresse déclarée quelque part, et les projets qu'elle sert */
export interface ParticipantRepere {
  /** adresse normalisée */
  email: string
  projetIds: string[]
  /** d'où vient l'adresse, en français, pour la raison affichée */
  origine: string
}

export interface EntrepriseRepere {
  id: string
  raisonSociale: string
  /** domaines e-mail connus, normalisés */
  domaines: string[]
  /** projets sur lesquels l'entreprise a un marché */
  projetIds: string[]
}

export interface ReperesRattachement {
  projets: ProjetRepere[]
  participants: ParticipantRepere[]
  entreprises: EntrepriseRepere[]
  regles: RegleRattachement[]
}

/** ce qu'on sait du message, du fichier ou de la ligne à rattacher */
export interface IndicesRattachement {
  /** objet du message, ou titre de la source */
  objet?: string
  /** nom de fichier — pour une PIÈCE, il porte souvent la nomenclature */
  nomFichier?: string
  /** référence explicite donnée par un import (champ « projet » d'une routine) */
  reference?: string
  /** expéditeur, brut ou normalisé */
  expediteur?: string
  /** destinataires et copies : l'adresse projet peut n'être QUE là */
  destinataires?: string[]
  /**
   * projet du fil de discussion, déjà rattaché — fourni par l'appelant, qui
   * seul sait interroger sa source (table `communications` côté serveur,
   * page chargée côté navigateur). Le §3.7 en fait le signal le plus fort :
   * un seul rattachement humain propage tout le fil.
   */
  projetDuFil?: string | null
}

// ------------------------------------------------------------
// 4. Le résultat
// ------------------------------------------------------------

/** le barreau de la cascade qui a tranché (§3.7 + §5.1) */
export type NiveauRattachement =
  | 'adresse_projet'
  | 'fil'
  | 'regle'
  | 'participant'
  | 'entreprise'
  | 'objet'

export const LIBELLES_NIVEAU: Record<NiveauRattachement, string> = {
  adresse_projet: 'adresse dédiée du projet',
  fil: 'fil de discussion déjà rattaché',
  regle: 'règle mémorisée',
  participant: 'adresse d’un participant déclaré',
  entreprise: 'entreprise reconnue',
  objet: 'identifiant ou nom de projet dans l’objet',
}

/**
 * Confiance par niveau. Les deux derniers barreaux gardent EXACTEMENT les
 * poids historiques (0,35 pour l'identifiant, 0,25 pour le nom) : ils
 * s'additionnent au lexique documentaire de `classerFichier`, et les
 * relever aurait fait virer au vert des propositions inchangées, dans un
 * écran où la couleur du badge est ce qu'on lit en premier.
 */
export const CONFIANCE_NIVEAU: Record<NiveauRattachement, number> = {
  adresse_projet: 0.9,
  fil: 0.85,
  regle: 0.8,
  participant: 0.7,
  entreprise: 0.5,
  objet: 0.35,
}

/** un nom de projet reconnu vaut moins qu'un identifiant : « Villa » se
 *  retrouve dans trois projets sur quatre, « P03 » dans un seul */
export const CONFIANCE_NOM_PROJET = 0.25

/** plafond commun à toutes les propositions machine du dépôt */
export const CONFIANCE_MAX = 0.95

export interface Rattachement {
  projetId: string | null
  /** entreprise reconnue au passage — `classerFichier` la reprend au lieu
   *  de refaire sa propre recherche par domaine */
  entrepriseId: string | null
  confiance: number
  raisons: string[]
  niveau: NiveauRattachement | null
  /** projets à égalité quand rien ne départage — la file « à rattacher » */
  candidats: string[]
}

// ------------------------------------------------------------
// 5. La cascade
// ------------------------------------------------------------

interface Trouvaille {
  projetId: string | null
  candidats: string[]
  raison: string
  confiance?: number
}

/** un seul candidat ⇒ on tranche ; plusieurs ⇒ on refuse et on les nomme */
function trancher(candidats: string[], raisonUnique: (id: string) => string, quoi: string): Trouvaille | null {
  const uniques = [...new Set(candidats)]
  if (uniques.length === 0) return null
  if (uniques.length === 1) return { projetId: uniques[0], candidats: uniques, raison: raisonUnique(uniques[0]) }
  return {
    projetId: null,
    candidats: uniques,
    raison: `${quoi} — ${uniques.join(', ')} conviennent également : à choisir.`,
  }
}

function nommer(reperes: ReperesRattachement, id: string): string {
  const p = reperes.projets.find((x) => x.id === id)
  return p ? `${p.id} (${p.nom})` : id
}

/** l'identifiant, le code externe ou le nom du projet, cherchés dans un
 *  texte DÉJÀ replié. Les bornes de mot évitent que « P1 » morde « P12 ». */
function citeDansLeTexte(reperes: ReperesRattachement, texte: string): { id: string; parNom: boolean }[] {
  const trouves: { id: string; parNom: boolean }[] = []
  for (const p of reperes.projets) {
    const id = fold(p.id)
    const code = fold(p.codeExterne || '')
    const borne = (aiguille: string) =>
      aiguille.length > 0 && new RegExp(`(^|[^a-z0-9])${echapper(aiguille)}([^a-z0-9]|$)`).test(texte)
    if (borne(id) || borne(code)) {
      trouves.push({ id: p.id, parNom: false })
      continue
    }
    const nom = fold(p.nom)
    if (nom.length >= 5 && texte.includes(nom)) trouves.push({ id: p.id, parNom: true })
  }
  return trouves
}

function echapper(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * LA cascade, du signal le plus fort au plus faible (§3.7) :
 *
 *   1. l'adresse dédiée du projet, si elle figure parmi les participants ;
 *   2. le fil de discussion déjà rattaché ;
 *   3. une règle mémorisée depuis une correction humaine (adresse, puis domaine) ;
 *   4. l'adresse d'un participant déclaré (MOA, contact, contact de marché) ;
 *   5. l'entreprise reconnue — par son domaine ou sa raison sociale — quand
 *      elle n'a de marché que sur un seul projet ;
 *   6. l'identifiant, le code externe ou le nom du projet dans l'objet.
 *
 * L'ORDRE EST CELUI DU PLAN, y compris là où il surprend : l'objet arrive en
 * DERNIER. C'est délibéré et le §3.7 le tranche — un objet est recopié de fil
 * en fil, un nom de projet traîne dans une signature, alors qu'une adresse et
 * un fil sont des faits. Le cas gênant (le fil dit P03, l'objet cite P07)
 * n'est pas arbitré en silence pour autant : il RESSORT DANS LES RAISONS,
 * pour que la personne qui relit voie qu'il y avait un désaccord.
 *
 * Le CORPS du message n'entre jamais ici. Un nom de projet cité en signature
 * ou dans un fil recopié rattacherait à tort, et un rattachement faux se
 * corrige un par un.
 */
export function rattacher(reperes: ReperesRattachement, indices: IndicesRattachement): Rattachement {
  const raisons: string[] = []
  const expediteur = normaliserAdresse(indices.expediteur)
  const domaineExpediteur = domaineDe(indices.expediteur)
  const participantsMessage = [
    ...(expediteur ? [expediteur] : []),
    ...(indices.destinataires || []).map(normaliserAdresse).filter(Boolean),
  ]
  const idsConnus = reperes.projets.map((p) => p.id)
  const regles = reglesApplicables(reperes.regles, idsConnus)

  // le texte fouillé : objet, nom de fichier, référence d'import. Jamais le corps.
  const texte = fold(`${indices.nomFichier || ''} ${indices.objet || ''} ${indices.reference || ''}`)

  // --- l'entreprise, reconnue au passage (elle sert deux barreaux) ---
  let entrepriseId: string | null = null
  let entrepriseRaison = ''
  const parDomaine = domaineExpediteur
    ? reperes.entreprises.find((e) => e.domaines.some((d) => fold(d) === domaineExpediteur))
    : undefined
  if (parDomaine) {
    entrepriseId = parDomaine.id
    entrepriseRaison = `L’expéditeur (@${domaineExpediteur}) correspond à « ${parDomaine.raisonSociale} ».`
  } else {
    const parRaison = reperes.entreprises.find((e) => {
      const rs = fold(e.raisonSociale)
      return rs.length >= 4 && texte.includes(rs)
    })
    if (parRaison) {
      entrepriseId = parRaison.id
      entrepriseRaison = `Le texte cite l’entreprise « ${parRaison.raisonSociale} ».`
    }
  }
  const entreprise = reperes.entreprises.find((e) => e.id === entrepriseId)

  // ---------------- les barreaux, dans l'ordre ----------------

  const barreaux: { niveau: NiveauRattachement; trouvaille: Trouvaille | null }[] = []

  // 1. adresse dédiée du projet
  barreaux.push({
    niveau: 'adresse_projet',
    trouvaille: trancher(
      reperes.projets
        .filter((p) => {
          const adresse = normaliserAdresse(p.adresseProjet)
          return adresse !== '' && participantsMessage.includes(adresse)
        })
        .map((p) => p.id),
      (id) => `Le message passe par l’adresse dédiée du projet ${nommer(reperes, id)}.`,
      'Plusieurs adresses de projet figurent parmi les participants',
    ),
  })

  // 2. fil de discussion déjà rattaché
  const projetDuFil = indices.projetDuFil && idsConnus.includes(indices.projetDuFil) ? indices.projetDuFil : null
  barreaux.push({
    niveau: 'fil',
    trouvaille: projetDuFil
      ? {
          projetId: projetDuFil,
          candidats: [projetDuFil],
          raison: `Le fil de discussion est déjà rattaché au projet ${nommer(reperes, projetDuFil)}.`,
        }
      : null,
  })

  // 3. règle mémorisée — l'adresse exacte d'abord, le domaine ensuite
  const parRegleAdresse = regles.filter((r) => r.declencheur === 'adresse' && participantsMessage.includes(r.valeur))
  const parRegleDomaine = regles.filter((r) => r.declencheur === 'domaine' && r.valeur === domaineExpediteur)
  const regleRetenue = parRegleAdresse.length > 0 ? parRegleAdresse : parRegleDomaine
  const surDomaine = parRegleAdresse.length === 0
  barreaux.push({
    niveau: 'regle',
    trouvaille: trancher(
      regleRetenue.map((r) => r.projetId),
      (id) => {
        const r = regleRetenue.find((x) => x.projetId === id)!
        return surDomaine
          ? `Règle mémorisée : les messages de @${r.valeur} vont au projet ${nommer(reperes, id)}.`
          : `Règle mémorisée : les messages de ${r.valeur} vont au projet ${nommer(reperes, id)}.`
      },
      'Plusieurs règles mémorisées se contredisent',
    ),
  })
  if (regleRetenue.length > 0 && surDomaine) {
    barreaux[barreaux.length - 1].trouvaille = {
      ...barreaux[barreaux.length - 1].trouvaille!,
      confiance: 0.6,
    }
  }

  // 4. adresse d'un participant déclaré
  const participantsReconnus = reperes.participants.filter((p) => p.email && participantsMessage.includes(p.email))
  barreaux.push({
    niveau: 'participant',
    trouvaille: trancher(
      participantsReconnus.flatMap((p) => p.projetIds),
      (id) => {
        const p = participantsReconnus.find((x) => x.projetIds.includes(id))!
        return `${p.origine} (${p.email}) participe au projet ${nommer(reperes, id)}.`
      },
      'Les adresses reconnues servent plusieurs projets',
    ),
  })

  // 5. entreprise reconnue — utile seulement si elle n'a qu'un marché
  barreaux.push({
    niveau: 'entreprise',
    trouvaille: entreprise
      ? trancher(
          entreprise.projetIds,
          (id) => `${entrepriseRaison} Elle n’a de marché que sur le projet ${nommer(reperes, id)}.`,
          `${entrepriseRaison} Elle intervient sur plusieurs projets`,
        )
      : null,
  })

  // 6. identifiant, code externe ou nom du projet dans l'objet
  const cites = citeDansLeTexte(reperes, texte)
  const parIdentifiant = cites.filter((c) => !c.parNom)
  const citesRetenus = parIdentifiant.length > 0 ? parIdentifiant : cites
  barreaux.push({
    niveau: 'objet',
    trouvaille: trancher(
      citesRetenus.map((c) => c.id),
      (id) =>
        parIdentifiant.length > 0
          ? `L’objet contient l’identifiant du projet ${nommer(reperes, id)}.`
          : `L’objet contient le nom du projet ${nommer(reperes, id)}.`,
      'Plusieurs projets sont cités',
    ),
  })
  if (citesRetenus.length > 0 && parIdentifiant.length === 0) {
    barreaux[barreaux.length - 1].trouvaille = {
      ...barreaux[barreaux.length - 1].trouvaille!,
      confiance: CONFIANCE_NOM_PROJET,
    }
  }

  // ---------------- on descend jusqu'au premier qui tranche ----------------

  let retenu: { niveau: NiveauRattachement; trouvaille: Trouvaille } | null = null
  for (const barreau of barreaux) {
    if (!barreau.trouvaille) continue
    if (!retenu && barreau.trouvaille.projetId) {
      retenu = { niveau: barreau.niveau, trouvaille: barreau.trouvaille }
      raisons.push(barreau.trouvaille.raison)
      continue
    }
    if (!retenu) {
      // un barreau qui a vu quelque chose sans pouvoir trancher : sa raison
      // vaut d'être dite, c'est elle qui explique la file « à rattacher »
      raisons.push(barreau.trouvaille.raison)
      continue
    }
    // un barreau PLUS FAIBLE désigne un AUTRE projet : le désaccord se dit,
    // il ne s'arbitre pas en silence
    if (barreau.trouvaille.projetId && barreau.trouvaille.projetId !== retenu.trouvaille.projetId) {
      raisons.push(
        `Signal plus faible en désaccord : ${LIBELLES_NIVEAU[barreau.niveau]} désigne ${nommer(reperes, barreau.trouvaille.projetId)} — vérifiez.`,
      )
    }
  }

  // l'entreprise reconnue se dit toujours : elle explique le classement du
  // document même quand elle n'a pas désigné de projet
  if (entrepriseRaison && !raisons.some((r) => r.startsWith(entrepriseRaison))) {
    raisons.push(entrepriseRaison)
  }

  if (!retenu) {
    const candidats = [...new Set(barreaux.flatMap((b) => b.trouvaille?.candidats || []))]
    if (candidats.length === 0) {
      raisons.push('Ni adresse connue, ni fil rattaché, ni identifiant de projet — projet à choisir.')
    }
    return {
      projetId: null,
      entrepriseId,
      confiance: 0,
      raisons,
      niveau: null,
      candidats,
    }
  }

  const confiance = Math.min(
    retenu.trouvaille.confiance ?? CONFIANCE_NIVEAU[retenu.niveau],
    CONFIANCE_MAX,
  )
  return {
    projetId: retenu.trouvaille.projetId,
    entrepriseId,
    confiance,
    raisons,
    niveau: retenu.niveau,
    candidats: retenu.trouvaille.candidats,
  }
}

/**
 * Le rattachement d'un MESSAGE : l'objet, les participants et le fil — jamais
 * le corps. Un raccourci nommé, pour que la règle du §3.7 soit visible sur
 * l'appel et non enfouie dans le choix des champs passés.
 */
export function rattacherMessage(
  reperes: ReperesRattachement,
  message: {
    objet?: string
    expediteur?: string
    destinataires?: string[]
    projetDuFil?: string | null
  },
): Rattachement {
  return rattacher(reperes, {
    objet: message.objet,
    expediteur: message.expediteur,
    destinataires: message.destinataires,
    projetDuFil: message.projetDuFil ?? null,
  })
}
