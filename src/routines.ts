// ============================================================
// Routines Claude programmées — le « hook » du sans-API.
// Chaque routine est configurée UNE FOIS dans Claude (avec accès
// Gmail / Drive / web) ; elle tourne à heure fixe et termine sa
// réponse par un bloc JSON au contrat ci-dessous, à coller dans
// le Cockpit (page Routines → Importer, ou module concerné).
// Résultat : plus aucun prompt à retaper — seul le résultat
// fait l'aller-retour.
// ============================================================

export interface RoutineSpec {
  id: string
  titre: string
  frequence: string
  description: string
  /** prompt à coller tel quel dans la routine programmée Claude */
  promptRoutine: string
  /** contrat de sortie JSON attendu par l'import du Cockpit */
  formatJSON?: string
  importCible?: 'situations' | 'consultations' | null
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
      "notes": "visite obligatoire, mission base + EXE, jugement 60/40"
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
    id: 'digest-matin',
    titre: 'Digest e-mails du matin',
    frequence: 'Tous les jours ouvrés, 7 h 45',
    description:
      "Synthèse de la boîte : 3 à 5 priorités du jour et projets de réponse pour les demandes récurrentes. Pas d'import Cockpit : le digest se lit dans Claude, les brouillons partent dans Gmail après relecture.",
    promptRoutine: `Tu es l'assistant de tri matinal de l'agence d'architecture L&L.

Chaque matin :
1. Parcours les e-mails reçus depuis hier 18 h (boîte principale, dossiers Administratif / Chantier / Client des filtres Gmail).
2. Produis un digest en 3 parties :
   — PRIORITÉS DU JOUR : 3 à 5 messages qui exigent une action aujourd'hui, avec pour chacun : de qui, quoi, pour quand, action suggérée en une ligne.
   — À SUIVRE : ce qui peut attendre mais mérite un œil cette semaine.
   — BRUIT : ce que tu as ignoré (newsletters, notifications), en une ligne.
3. Pour les demandes récurrentes simples (demande de disponibilité, envoi de document, question administrative), prépare un PROJET DE RÉPONSE en brouillon Gmail — ne jamais envoyer : l'envoi reste une décision humaine.
4. Ne traite pas les messages adressés à situations@ (routine dédiée).

Règle d'or : tout ce qui est financier, contractuel ou sortant reste à l'état de brouillon jusqu'à relecture.`,
    importCible: null,
  },
]
