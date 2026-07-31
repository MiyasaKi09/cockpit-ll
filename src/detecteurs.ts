// ============================================================
// A.10 — les détecteurs, premier étage : déterministe et hors ligne.
//
// Les points 5 à 8 du §12.3 demandent que le Cockpit propose des tâches,
// des échéances, des décisions et des risques à partir des messages. Le
// §3.14 (décision 5) pose que cela se fait en DEUX étages, et que le
// premier est celui-ci : un lexique, des dates résolues, une confiance et
// des raisons en français. Le second étage — le modèle — voyage dans la
// même réponse que le résumé (`supabase/functions/resume-messages/`) et
// n'ajoute donc aucun appel.
//
// Pourquoi commencer par le déterministe plutôt que par le modèle :
//
//   * il fonctionne sans clé d'API, sans réseau, et sans coût. Le jour où
//     le budget IA est coupé — c'est un réglage, pas un accident — les
//     détections continuent ;
//   * il est reproductible. Une détection qu'on ne peut pas rejouer ne se
//     débogue pas : on ne sait jamais si c'est le lexique ou le modèle qui
//     a changé d'avis ;
//   * il rend les raisons vérifiables. « La phrase contient "ne pas
//     oublier" » se contrôle ; « le modèle a estimé » ne se contrôle pas.
//
// CE QUE CE MODULE NE FAIT PAS, ET NE DOIT JAMAIS FAIRE
// -----------------------------------------------------
// Il n'écrit rien. Il rend des objets. Les détections n'ont qu'une seule
// destination — la table `propositions` (A.9) — et jamais `workspace.data` :
// une détection qui atterrirait dans l'état partagé serait une tâche, une
// décision ou un risque créés par une machine, ce que le §15 interdit et
// que le domaine SQL de `statut` rend structurellement impossible.
//
// Il ne choisit pas non plus de responsable. Le §3.15 est explicite :
// aucun modèle ne décide qui est notifié, et ce lexique-ci ne le fait pas
// davantage.
// ============================================================

import type {
  ChargeDecision,
  ChargeEcheance,
  ChargeRisque,
  ChargeTache,
  GenreProposition,
  NatureRisque,
} from './propositions'
import { MARQUEURS_ACTION } from './tagging'
import { addDays, fold } from './util'

/** Repli et APOSTROPHES. `fold` normalise la casse et les accents mais laisse
 *  l'apostrophe, or elle est typographique (’) autant que droite (') selon le
 *  clavier de l'expéditeur. Un motif écrit avec l'une ne reconnaît pas l'autre,
 *  et l'échec est silencieux : la détection ne se produit simplement pas. On
 *  les réduit donc toutes deux à une espace — « qui s'en charge » et « qui s’en
 *  charge » deviennent le même texte. */
function aplatir(s: string): string {
  return fold(s).replace(/['\u2019]/g, ' ').replace(/\s+/g, ' ')
}

// ------------------------------------------------------------
// 1. Ce que rend un détecteur
// ------------------------------------------------------------

export interface DetectionBrute {
  genre: GenreProposition
  chargeUtile: ChargeTache | ChargeEcheance | ChargeDecision | ChargeRisque
  /** LA PHRASE du message qui porte la détection. §13.3 et §4.2 : un lien
   *  vers le message ne suffit pas — il faut pouvoir relire ce qui a été
   *  compris sans rouvrir Gmail, sinon la revue coûte plus cher que la
   *  saisie manuelle et personne ne la fait. */
  extrait: string
  /** 0 à 0,95. Le plafond est celui du classifieur d'ingestion : une règle
   *  lexicale n'atteint pas la certitude, et afficher 1,00 inviterait à
   *  accepter sans lire. */
  confiance: number
  raisons: string[]
  origine: 'lexique'
}

/** au-delà, le texte cité devient une capture d'écran du message */
const MAX_EXTRAIT = 240

/** le plafond du classifieur d'ingestion — la même échelle, le même sens */
const PLAFOND = 0.95

// ------------------------------------------------------------
// 2. Découpage en phrases
// ------------------------------------------------------------
//
// L'unité de détection est la phrase, pas le message : c'est elle qui
// devient l'extrait cité. Découper au message donnerait un extrait
// illisible ; découper au mot perdrait ce qui rend la phrase concluante.

function phrases(texte: string): string[] {
  return (texte || '')
    .split(/(?<=[.!?…])\s+|\n+|\s+;\s+/u)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 8)
}

function extraitDe(phrase: string): string {
  return phrase.length <= MAX_EXTRAIT ? phrase : `${phrase.slice(0, MAX_EXTRAIT - 1).trimEnd()}…`
}

// ------------------------------------------------------------
// 3. Les dates françaises, résolues relativement à la DATE D'ENVOI
// ------------------------------------------------------------
//
// C'est le point technique du livrable, et l'erreur qu'il faut éviter est
// nommée dans le plan : résoudre « lundi prochain » par rapport à
// AUJOURD'HUI. Un message lu trois semaines après son arrivée produirait
// alors une échéance fausse de trois semaines — et fausse en silence, car
// le résultat reste une date plausible.

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MOIS = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
]

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** dernier jour du mois — sans passer par une bibliothèque de dates */
function finDuMois(annee: number, moisIndex: number): string {
  return iso(new Date(Date.UTC(annee, moisIndex + 1, 0)))
}

/** la prochaine occurrence de ce jour de semaine, STRICTEMENT après `depuis` */
function prochainJour(depuis: string, jourVise: number): string {
  const base = new Date(`${depuis}T00:00:00Z`)
  const ecart = (jourVise - base.getUTCDay() + 7) % 7 || 7
  return addDays(depuis, ecart)
}

export interface DateDetectee {
  date: string
  raison: string
}

/**
 * Résout la première date exprimée dans la phrase, relativement à `envoyeLe`.
 *
 * Rend `null` plutôt que de deviner : une échéance inventée coûte plus cher
 * qu'une échéance manquée, parce qu'elle se lit comme un engagement.
 */
export function dateDansPhrase(phrase: string, envoyeLe: string): DateDetectee | null {
  const t = ` ${aplatir(phrase)} `

  if (/\bapres[- ]demain\b/.test(t))
    return { date: addDays(envoyeLe, 2), raison: 'La phrase dit « après-demain », compté depuis la date d’envoi.' }
  if (/\bdemain\b/.test(t))
    return { date: addDays(envoyeLe, 1), raison: 'La phrase dit « demain », compté depuis la date d’envoi.' }

  // « sous quinzaine », « sous huitaine », « sous 10 jours », « d'ici 3 semaines »
  const delai = /\b(?:sous|d ?ici|dans)\s+(\d{1,2})\s+(jours?|semaines?|mois)\b/.exec(t)
  if (delai) {
    const n = Number(delai[1])
    const jours = delai[2].startsWith('semaine') ? n * 7 : delai[2] === 'mois' ? n * 30 : n
    return { date: addDays(envoyeLe, jours), raison: `La phrase donne un délai de ${delai[1]} ${delai[2]}.` }
  }
  if (/\bsous quinzaine\b/.test(t))
    return { date: addDays(envoyeLe, 15), raison: 'La phrase dit « sous quinzaine ».' }
  if (/\bsous huitaine\b/.test(t))
    return { date: addDays(envoyeLe, 8), raison: 'La phrase dit « sous huitaine ».' }

  // « le 15 septembre », « 15 septembre 2026 », « fin septembre »
  const enLettres = new RegExp(`\\b(?:(\\d{1,2})\\s+)?(${MOIS.join('|')})(?:\\s+(\\d{4}))?\\b`).exec(t)
  if (enLettres) {
    const moisIndex = MOIS.indexOf(enLettres[2])
    const jour = enLettres[1] ? Number(enLettres[1]) : null
    const anneeDite = enLettres[3] ? Number(enLettres[3]) : null
    const anneeEnvoi = Number(envoyeLe.slice(0, 4))
    if (!jour && !/\bfin\s+(?:de\s+)?$/.test(t.slice(0, enLettres.index))) {
      // un mois seul, sans « fin » : trop vague pour une échéance. On ne
      // choisit pas le 1er au hasard — ce serait une date inventée.
    } else if (jour && (jour < 1 || jour > 31)) {
      // pas une date
    } else {
      for (const annee of anneeDite ? [anneeDite] : [anneeEnvoi, anneeEnvoi + 1]) {
        const candidate = jour
          ? iso(new Date(Date.UTC(annee, moisIndex, jour)))
          : finDuMois(annee, moisIndex)
        // sans année dite, on retient la PROCHAINE occurrence : une échéance
        // regarde devant. Avec une année dite, on respecte ce qui est écrit,
        // fût-ce du passé — le tri par « date antérieure à l'envoi » s'en
        // charge plus bas, avec sa propre raison.
        if (anneeDite || candidate >= envoyeLe)
          return {
            date: candidate,
            raison: jour
              ? `La phrase cite le ${jour} ${enLettres[2]}${anneeDite ? ` ${anneeDite}` : ''}.`
              : `La phrase dit « fin ${enLettres[2]} ».`,
          }
      }
    }
  }

  // « le 15/09 », « 15/09/2026 » — jour/mois, jamais l'inverse. Les bornes de
  // mot excluent les numéros de version, les références et les fractions.
  const chiffres = /(?:^|[^\d/.])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/.exec(t)
  if (chiffres) {
    const jour = Number(chiffres[1])
    const mois = Number(chiffres[2])
    if (jour >= 1 && jour <= 31 && mois >= 1 && mois <= 12) {
      const anneeEnvoi = Number(envoyeLe.slice(0, 4))
      const brute = chiffres[3]
      const annee = brute ? (brute.length === 2 ? 2000 + Number(brute) : Number(brute)) : null
      for (const a of annee ? [annee] : [anneeEnvoi, anneeEnvoi + 1]) {
        const candidate = iso(new Date(Date.UTC(a, mois - 1, jour)))
        if (annee || candidate >= envoyeLe)
          return { date: candidate, raison: `La phrase cite la date ${jour}/${mois}${annee ? `/${annee}` : ''}.` }
      }
    }
  }

  // « lundi prochain », « d'ici vendredi », « lundi »
  const jourNomme = new RegExp(`\\b(${JOURS.join('|')})\\b`).exec(t)
  if (jourNomme) {
    const vise = JOURS.indexOf(jourNomme[1])
    return {
      date: prochainJour(envoyeLe, vise),
      raison: `La phrase dit « ${jourNomme[1]} » : le prochain, compté depuis la date d’envoi.`,
    }
  }

  if (/\bla semaine prochaine\b/.test(t))
    return { date: prochainJour(envoyeLe, 1), raison: 'La phrase dit « la semaine prochaine » : lundi suivant l’envoi.' }

  return null
}

// ------------------------------------------------------------
// 4. Les lexiques
// ------------------------------------------------------------

/** ce qui annonce une décision prise — §6.1 */
const MARQUEURS_DECISION: { motif: RegExp; libelle: string }[] = [
  { motif: /\b(?:nous avons|on a|il a ete|a ete)\s+(?:decide|acte|arbitre|valide|retenu)\b/, libelle: 'annonce une décision prise' },
  { motif: /\b(?:decision|arbitrage)\s+(?:prise?|rendu|du|de la|en reunion)\b/, libelle: 'annonce une décision prise' },
  { motif: /\b(?:acte|valide|entérine|retenu)\s+en\s+reunion\b/, libelle: 'renvoie à une validation en réunion' },
  { motif: /\bnous retenons\b|\bon retient\b|\bnous validons\b/, libelle: 'énonce un choix au nom de l’émetteur' },
]

/**
 * Les quatre natures de risque que `computeAlertes()` ne peut PAS voir.
 *
 * Les cinq autres du §6.3 sont déjà produites par `src/alerts.ts` — retard
 * potentiel, échéance imminente, budget dépassé, absence de validation,
 * dépendance à un tiers. Les redétecter ici doublerait chaque risque dans la
 * fiche projet, et un risque affiché deux fois se lit comme deux risques.
 */
const MARQUEURS_RISQUE: { nature: NatureRisque; motif: RegExp; libelle: string }[] = [
  {
    nature: 'demande_contradictoire',
    motif: /\bcontrairement a\b|\ben contradiction\b|\bce qui contredit\b|\bor vous (?:aviez|avez) (?:indique|demande|valide)\b|\bn est pas coherent avec\b/,
    libelle: 'oppose la demande à une position antérieure',
  },
  {
    nature: 'modification_de_programme',
    motif: /\bchangement de programme\b|\bmodifier le programme\b|\brevoir le programme\b|\bnouveau besoin\b|\bsurface supplementaire\b|\bajouter un (?:niveau|etage|local)\b/,
    libelle: 'annonce un changement du programme',
  },
  {
    nature: 'reserve_technique',
    motif: /\breserves?\b|\bnon conforme\b|\bmalfacons?\b|\bdesordres?\b|\bavis defavorable\b|\bne respecte pas (?:le|la|les)\b/,
    libelle: 'signale une réserve ou une non-conformité',
  },
  {
    nature: 'responsabilite_non_attribuee',
    motif: /\bqui (?:s en charge|doit|prend en charge)\b|\bpersonne n a (?:ete|pris|repondu)\b|\ba qui revient\b|\bn est pas clair qui\b/,
    libelle: 'laisse une responsabilité sans titulaire',
  },
]

// ------------------------------------------------------------
// 5. Les quatre détecteurs
// ------------------------------------------------------------

function normaliser(confiance: number): number {
  return Math.min(Math.round(confiance * 100) / 100, PLAFOND)
}

/**
 * Détecte tâches, échéances, décisions et risques dans un message.
 *
 * `envoyeLe` est la date d'envoi du message, en ISO. Elle est OBLIGATOIRE :
 * sans elle, aucune date relative n'est résoluble, et les résoudre par
 * rapport à aujourd'hui produirait des échéances décalées du temps qu'on a
 * mis à lire le message. Un message sans date d'envoi ne produit donc pas
 * d'échéance — mais il produit toujours des tâches, des décisions et des
 * risques, qui n'en dépendent pas.
 */
export function detecter(texte: string, envoyeLe: string | null): DetectionBrute[] {
  const jourEnvoi = envoyeLe ? envoyeLe.slice(0, 10) : null
  const sorties: DetectionBrute[] = []

  for (const phrase of phrases(texte)) {
    const t = ` ${aplatir(phrase)} `
    const date = jourEnvoi ? dateDansPhrase(phrase, jourEnvoi) : null
    // Une date antérieure à l'envoi n'est pas une échéance : c'est un rappel
    // du passé (« nous étions sur place le 12 juin »). La proposer ferait
    // apparaître un retard qui n'existe pas, et le §14.3 tient les fausses
    // urgences pour le pire défaut d'un fil d'alertes.
    const aVenir = date && jourEnvoi && date.date >= jourEnvoi ? date : null
    const extrait = extraitDe(phrase)

    // --- tâches : un marqueur d'action, celui de `src/tagging.ts` ---------
    const marqueur = MARQUEURS_ACTION.find((m) => t.includes(m))
    if (marqueur) {
      const raisons = [`La phrase contient le marqueur d’action « ${marqueur} ».`]
      let confiance = 0.5
      if (/\b(?:pouvez[- ]vous|pourriez[- ]vous|merci de|il faudrait|veuillez)\b/.test(t)) {
        confiance += 0.15
        raisons.push('Elle est formulée comme une demande adressée.')
      }
      if (aVenir) {
        confiance += 0.15
        raisons.push(aVenir.raison)
      }
      sorties.push({
        genre: 'tache',
        // Aucun responsable n'est proposé : le §3.15 pose qu'aucun modèle ne
        // choisit qui est notifié, et une règle lexicale n'a pas plus de
        // titre à le faire. C'est la revue humaine qui attribue.
        chargeUtile: { titre: extraitDe(phrase), responsable: null, echeance: aVenir?.date ?? null },
        extrait,
        confiance: normaliser(confiance),
        raisons,
        origine: 'lexique',
      })
    }

    // --- échéances : une date, et un verbe qui engage ---------------------
    //
    // Une date seule ne fait pas une échéance : « nous étions sur place le
    // 12 juin » en contient une. Il faut qu'elle porte une remise, un rendu
    // ou une limite. Sans ce second signal, on ne propose rien plutôt que
    // de remplir la file de dates citées en passant.
    //
    // Et seulement si la phrase n'a pas DÉJÀ produit une tâche qui porte
    // cette date : « Pouvez-vous envoyer le DCE avant le 15 septembre ? »
    // est une seule chose à faire, pas deux. En proposer deux ferait relire
    // la même phrase deux fois en revue, et c'est le genre de bruit qui fait
    // abandonner la revue entière.
    const dejaDansUneTache = marqueur !== undefined && aVenir !== null
    if (aVenir && !dejaDansUneTache) {
      const engage = /\b(?:avant le|au plus tard|date limite|echeance|remise|rendu|livraison|depot|pour le|d ?ici)\b/.test(t)
      if (engage) {
        sorties.push({
          genre: 'echeance',
          // §3.14 décision 4 : une échéance proposée ne vise qu'une tâche ou
          // un contact — jamais une `Obligation` ni une `EcheanceFacturation`,
          // qui sont des échéances juridiques et financières. La contrainte
          // SQL le tient aussi ; ici on ne fabrique même pas la valeur
          // interdite.
          chargeUtile: { cible: 'tache', date: aVenir.date, libelle: extraitDe(phrase) },
          extrait,
          confiance: normaliser(0.55 + 0.2),
          raisons: [aVenir.raison, 'La phrase exprime une remise, une limite ou un rendu.'],
          origine: 'lexique',
        })
      }
    }

    // --- décisions --------------------------------------------------------
    const decision = MARQUEURS_DECISION.find((m) => m.motif.test(t))
    if (decision) {
      sorties.push({
        genre: 'decision',
        chargeUtile: { objet: extraitDe(phrase), date: date?.date ?? null, validee_par: null },
        extrait,
        confiance: normaliser(date ? 0.7 : 0.6),
        raisons: [
          `La phrase ${decision.libelle}.`,
          // une décision, elle, peut fort bien être datée du PASSÉ : c'est
          // même le cas normal — on acte ce qui a été décidé hier
          ...(date ? [date.raison] : []),
          // Dit franchement : la destination n'existe pas encore, et c'est
          // une information utile au moment de la revue.
          'Aucune décision de projet n’est créée : la promotion des décisions est en Phase 2 (livrable 2.1).',
        ],
        origine: 'lexique',
      })
    }

    // --- risques, et seulement les quatre natures ------------------------
    const risque = MARQUEURS_RISQUE.find((m) => m.motif.test(t))
    if (risque) {
      sorties.push({
        genre: 'risque',
        chargeUtile: { nature: risque.nature, detail: extraitDe(phrase) },
        extrait,
        confiance: normaliser(0.55),
        raisons: [
          `La phrase ${risque.libelle}.`,
          'Les cinq autres natures du §6.3 sont déjà produites par le fil d’urgences : les redétecter ici les doublerait.',
        ],
        origine: 'lexique',
      })
    }
  }

  return sorties
}
