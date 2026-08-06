// ============================================================
// Routines Claude programmées — le « hook » du sans-API.
// Chaque routine est configurée UNE FOIS dans Claude (avec accès
// Gmail / Drive / web) ; elle tourne à heure fixe et termine sa
// réponse par un bloc JSON au contrat ci-dessous, à coller dans
// le Cockpit (page Routines → Importer, ou module concerné).
// Résultat : plus aucun prompt à retaper — seul le résultat
// fait l'aller-retour.
// ============================================================

import type { PromptTemplate } from './types'

export interface RoutineSpec {
  id: string
  titre: string
  frequence: string
  description: string
  /** prompt à coller tel quel dans la routine programmée Claude */
  promptRoutine: string
  /** contrat de sortie JSON attendu par l'import du Cockpit */
  formatJSON?: string
  importCible?: 'situations' | 'consultations' | 'courriers' | null
}

// ============================================================
// LES CRITÈRES MÉTIER SONT VIVANTS, LE CODE NE L'EST PAS.
//
// Zone d'intervention, typologies, fourchette de budget des appels
// d'offres, adresse dédiée aux situations, prénoms de l'agence : tout
// cela change — et tout cela était figé dans les constantes ci-dessous,
// donc modifiable par un développeur seulement.
//
// Aucune mécanique nouvelle : celle des gabarits de prompts fait déjà ce
// travail et a fait ses preuves (corps modifiable, version, date de mise
// à jour, retour au modèle). Une routine adaptée par l'agence est donc un
// `PromptTemplate` de `state.prompts` à identifiant STABLE — persisté et
// synchronisé comme le reste, sans champ d'état nouveau. Tant qu'il
// n'existe pas, c'est le modèle ci-dessous qui s'applique : supprimer
// l'entrée SUFFIT à rétablir le modèle, et c'est exactement ce que fait
// « Rétablir le modèle ».
// ============================================================

/** domaine sous lequel les routines adaptées apparaissent dans la
 *  bibliothèque de prompts — elles y sont modifiables comme les autres */
export const DOMAINE_ROUTINES = 'Routines Claude'

/** identifiant stable du gabarit qui porte la version de l'agence */
export function idPromptRoutine(routineId: string): string {
  return `tpl-routine-${routineId}`
}

export interface RoutineEffective {
  /** le prompt à coller : celui de l'agence s'il existe, le modèle sinon */
  corps: string
  /** l'agence a adapté ce modèle */
  adaptee: boolean
  /** 1 = modèle d'origine ; 2 et au-delà = versions de l'agence */
  version: number
  /** date de la dernière adaptation — null tant que le modèle s'applique */
  majLe: string | null
}

/** ce que l'écran doit afficher et copier pour une routine, `state.prompts`
 *  faisant foi dès qu'il porte une adaptation */
export function routineEffective(spec: RoutineSpec, prompts: PromptTemplate[]): RoutineEffective {
  const t = (Array.isArray(prompts) ? prompts : []).find((x) => x && x.id === idPromptRoutine(spec.id))
  if (!t || !t.corps.trim()) return { corps: spec.promptRoutine, adaptee: false, version: 1, majLe: null }
  return { corps: t.corps, adaptee: true, version: t.version, majLe: t.majLe }
}

/** le gabarit à ranger dans `state.prompts` après une modification —
 *  `precedent` porte la version en place (absent = première adaptation,
 *  qui devient la v2 : la v1 est le modèle livré avec l'outil) */
export function gabaritRoutine(
  spec: RoutineSpec,
  corps: string,
  today: string,
  precedent?: PromptTemplate | null,
): PromptTemplate {
  return {
    id: idPromptRoutine(spec.id),
    titre: `Routine — ${spec.titre}`,
    domaine: DOMAINE_ROUTINES,
    projetClaude: 'Routine programmée',
    contexte: 'libre',
    corps,
    version: (precedent?.version ?? 1) + 1,
    majLe: today,
  }
}

export const CONTRAT_SITUATIONS = `{
  "type": "situations",
  "items": [
    {
      "entreprise": "SARL Martin BTP",
      "lot": "Lot 01 — Gros œuvre",
      "projet": "P01",
      "mois": "2027-07",
      "numero": 3,
      "montantMoisHT": 4575,
      "montantCumulHT": 13725,
      "confiance": 0.85,
      "source": "mail du 02/07/2027 — « Situation n°3 juillet »",
      "pour": "Julien",
      "notes": "révision de prix mentionnée mais non chiffrée"
    }
  ]
}`

export const CONTRAT_CONSULTATIONS = `{
  "type": "consultations",
  "items": [
    {
      "intitule": "Restructuration du groupe scolaire Jules-Ferry",
      "acheteur": "Commune de Grandvilliers (60)",
      "lieu": "Oise",
      "typologie": "Enseignement",
      "budgetTravaux": 1800000,
      "dateLimite": "2026-09-15",
      "source": "BOAMP n°26-123456 — alerte du 07/07/2026",
      "pour": "Zoé",
      "notes": "visite obligatoire, mission base + EXE, jugement 60/40"
    }
  ]
}`

export const CONTRAT_COURRIERS = `{
  "type": "courriers",
  "items": [
    {
      "de": "lefevre@opac-oise.example",
      "objet": "Question sur le planning du DIAG",
      "resume": "La MOA demande si le diagnostic peut être avancé de deux semaines (vote du budget).",
      "projet": "P01",
      "type": "question",
      "actionProposee": "Répondre avec le planning mis à jour — brouillon préparé dans Gmail.",
      "urgence": 2,
      "pour": "Julien",
      "source": "mail du 02/07/2026 08:41",
      "detections": [
        {
          "genre": "tache",
          "extrait": "Pouvez-vous nous confirmer le planning mis à jour avant le 15 septembre ?",
          "confiance": 0.8,
          "raisons": ["Demande adressée explicitement.", "Une date de remise est donnée."],
          "chargeUtile": { "titre": "Confirmer le planning mis à jour", "echeance": "2026-09-15" }
        },
        {
          "genre": "risque",
          "extrait": "Contrairement au calendrier validé en APS, le vote du budget avance le DIAG.",
          "confiance": 0.6,
          "raisons": ["La demande contredit un calendrier déjà validé."],
          "chargeUtile": { "nature": "demande_contradictoire", "detail": "Calendrier APS remis en cause" }
        }
      ]
    }
  ]
}`

export const ROUTINES: RoutineSpec[] = [
  {
    id: 'situations-quotidienne',
    titre: 'Lecture quotidienne de situations@',
    frequence: 'Tous les jours ouvrés, 8 h 00',
    description:
      "Lit les nouveaux messages de situations@agence-ll.fr (adresse dédiée imposée dans les marchés), extrait entreprise / lot / montant, rapproche du marché connu et produit les lignes « à vérifier » à importer dans le Cockpit. L'humain valide toujours : rien n'est classé silencieusement.",
    promptRoutine: `Tu es l'assistant administratif de l'agence d'architecture L&L (maîtrise d'œuvre).

Chaque matin :
1. Lis dans Gmail les messages NON TRAITÉS adressés à situations@agence-ll.fr depuis la dernière exécution (cherche aussi les pièces jointes PDF de situations de travaux).
2. Pour chaque situation de travaux reçue, extrais : entreprise, lot, projet concerné, mois, numéro de situation, montant du mois HT, montant cumulé HT si présent.
3. Indique pour chaque extraction un niveau de confiance entre 0 et 1 (0.5 ou moins si le document est ambigu, illisible ou incomplet). N'invente jamais un montant : mets null et baisse la confiance.
4. Signale en texte libre toute anomalie (révision de prix, avenant évoqué, retenue de garantie inhabituelle, écart de cumul).
5. Termine ta réponse par UN SEUL bloc de code json strictement conforme au format ci-dessous — c'est ce bloc qui sera importé dans le Cockpit, ne mets rien d'autre dans le bloc.

Format de sortie :
\`\`\`json
${CONTRAT_SITUATIONS}
\`\`\`

Si aucun message pertinent : réponds « Rien à traiter » sans bloc json.`,
    formatJSON: CONTRAT_SITUATIONS,
    importCible: 'situations',
  },
  {
    id: 'veille-ao-hebdo',
    titre: 'Veille AO hebdomadaire',
    frequence: 'Le lundi, 7 h 30',
    description:
      "Filtre les alertes BOAMP / TED / plateformes acheteurs reçues par e-mail selon les critères de l'agence (Hauts-de-France / Oise, typologie, budget) et inscrit les consultations candidates à importer dans le module Veille AO pour l'avis Go/No-Go.",
    promptRoutine: `Tu es chargé de la veille appels d'offres de l'agence d'architecture L&L (Hauts-de-France, siège dans l'Oise).

Chaque lundi :
1. Lis dans Gmail les alertes BOAMP, TED et plateformes acheteurs reçues depuis 7 jours (libellé/étiquette « Veille AO » si présent).
2. Retiens uniquement les consultations de maîtrise d'œuvre bâtiment qui cochent nos critères :
   - localisation : Hauts-de-France, priorité Oise et limitrophes ;
   - typologies : logement collectif, enseignement, équipements publics de proximité, réhabilitation ;
   - budget travaux : 300 k€ à 5 M€ HT ;
   - exclure : infrastructures, conception-réalisation lourde, concours restreints hors profil.
3. Pour chaque consultation retenue : intitulé, acheteur, lieu, typologie, budget estimé, date limite, référence/source.
4. Ajoute une ligne d'appréciation par consultation (pourquoi elle nous correspond, points de vigilance).
5. Termine par UN SEUL bloc de code json au format ci-dessous, qui sera importé dans le Cockpit (module Veille AO).

Format de sortie :
\`\`\`json
${CONTRAT_CONSULTATIONS}
\`\`\`

Si rien ne passe le filtre : « Rien à signaler cette semaine », sans bloc json.`,
    formatJSON: CONTRAT_CONSULTATIONS,
    importCible: 'consultations',
  },
  {
    id: 'tri-matin',
    titre: 'Tri du matin — mails rangés, boîte « À traiter » alimentée',
    frequence: 'Tous les jours ouvrés, 7 h 45',
    description:
      "La routine range la boîte Gmail (libellés par projet, archivage du bruit, brouillons de réponse) ET amène chaque mail actionnable dans le Cockpit : rangé au bon projet, avec l'action proposée et la personne concernée. Résultat : on ouvre le Cockpit, pas la boîte mail.",
    promptRoutine: `Tu es l'assistant de tri matinal de l'agence d'architecture L&L (2 personnes : Julien et Zoé).

Chaque matin :
1. Parcours les e-mails reçus depuis hier 18 h (hors situations@, routine dédiée).
2. RANGE la boîte Gmail au fur et à mesure : applique le libellé du projet concerné (« Projets/P01 », « Projets/P02 »…) ou le libellé de catégorie (Administratif / Chantier / Client / Veille AO), et archive le bruit (newsletters, notifications). Si ton accès Gmail ne permet pas de poser les libellés, liste en fin de réponse les rangements à faire à la main (2 minutes).
3. Pour les demandes récurrentes simples, prépare un PROJET DE RÉPONSE en brouillon Gmail — ne jamais envoyer : l'envoi reste une décision humaine.
4. Produis un court digest lisible : priorités du jour, à suivre, bruit ignoré.
5. Termine par UN SEUL bloc de code json au format ci-dessous : chaque mail qui demande une action devient une ligne, rattachée au projet (champ "projet" : l'ID Pxx si tu le connais, sinon le nom du projet tel qu'écrit dans le mail), avec "pour" = la personne concernée (Julien ou Zoé) et "urgence" de 1 à 3. Ce bloc sera importé dans le Cockpit (boîte « À traiter »).
6. Dans chaque ligne, remplis "detections" avec ce que le mail contient d'ACTIONNABLE OU D'ENGAGEANT, un objet par élément. Quatre genres, et quatre seulement : "tache", "echeance", "decision", "risque".
   - "extrait" est OBLIGATOIRE : la phrase du mail, recopiée mot pour mot. Ne la reformule pas, ne la résume pas. C'est ce que l'humain relira pour décider — sans elle, la détection est inutilisable et sera rejetée.
   - "confiance" va de 0 à 0,95. N'écris jamais 1 : une lecture certaine à 100 % n'existe pas, et l'afficher pousse à accepter sans lire. Sous 0,4, ne propose rien plutôt que de proposer un doute.
   - "raisons" est une liste de phrases FRANÇAISES et vérifiables, qui disent ce qui, dans le texte, t'a fait conclure. « Le modèle a estimé » n'est pas une raison.
   - Pour "risque", "chargeUtile.nature" ne peut valoir que : demande_contradictoire, modification_de_programme, reserve_technique, responsabilite_non_attribuee. Les autres natures (retard, budget dépassé, échéance imminente, absence de validation, dépendance à un tiers) sont DÉJÀ suivies ailleurs par le Cockpit : les proposer les afficherait deux fois.
   - Pour "echeance", "chargeUtile.date" est en AAAA-MM-JJ, résolue par rapport à la DATE D'ENVOI du mail, jamais par rapport à aujourd'hui. Une date que tu ne peux pas résoudre : n'invente pas, omets la détection.
   - Ne propose RIEN d'autre. Tu ne crées ni tâche, ni décision, ni échéance : tout ce que tu produis ici est une proposition qu'un humain accepte, modifie ou ignore. Si le mail ne contient rien de tel, omets "detections".

Format de sortie :
\`\`\`json
${CONTRAT_COURRIERS}
\`\`\`

Règle d'or : tout ce qui est financier, contractuel ou sortant reste à l'état de brouillon jusqu'à relecture. Si rien d'actionnable : digest seul, sans bloc json.`,
    formatJSON: CONTRAT_COURRIERS,
    importCible: 'courriers',
  },
]
