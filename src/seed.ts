// ============================================================
// Données initiales — reprises de l'Excel maître
// « Pilotage_Agence_LL.xlsx » (P01/P02 = projets EXEMPLES, à
// écraser par vos vrais projets) + gabarits de prompts v1.
// ============================================================

import type { AppState, Facture, PromptTemplate } from './types'

export const STATE_VERSION = 2

const P = (v: number) => Math.round(v * 100) / 100

function facture(
  id: string,
  projetId: string,
  phase: Facture['phase'],
  libelle: string,
  montantHT: number,
  emission: string,
  delaiJours: number,
): Facture {
  return { id, projetId, phase, libelle, montantHT, tauxTVA: 0.2, emission, delaiJours, statut: 'prevue' }
}

const GABARITS: PromptTemplate[] = [
  {
    id: 'tpl-cr-chantier',
    titre: 'Rédiger le CR de chantier',
    domaine: 'Chantier',
    projetClaude: 'CR de chantier',
    contexte: 'projet',
    version: 1,
    majLe: '2026-07-01',
    corps: `Compte-rendu de la réunion de chantier — {{projet_nom}} ({{projet_id}}), le {{date}}.

Contexte du projet :
{{fiche}}

Voici ma dictée brute de la visite (présents, remarques, décisions, points par lot) :
« ⟦coller ou dicter ici⟧ »

À faire :
1. Structure le compte-rendu selon le template du Projet : en-tête, présents / excusés / absents convoqués, avancement général, remarques PAR LOT (numérotées, avec responsable et échéance), décisions, calendrier des prochaines échéances, prochaine réunion.
2. Reprends la liste des intervenants du Projet pour normaliser les noms et repérer les absents.
3. Signale en fin de document les points en attente depuis plus de 2 réunions.
4. Génère le DOCX prêt à relire — je relis avant toute diffusion.`,
  },
  {
    id: 'tpl-analyse-rc',
    titre: 'Analyser le RC / DCE',
    domaine: 'Appels d’offres',
    projetClaude: 'Analyse AO',
    contexte: 'consultation',
    version: 1,
    majLe: '2026-07-01',
    corps: `Analyse du règlement de consultation — {{date}}.

{{consultation}}

Le RC (et le DCE le cas échéant) est déposé dans ce Projet. Extrais, sous forme de fiche synthétique :
- dates clés : limite de remise, visite (obligatoire ?), questions, démarrage envisagé ;
- pièces exigées pour la candidature et pour l'offre (liste exhaustive, avec formulaires imposés) ;
- compétences et références demandées (et le niveau exigé) ;
- critères de jugement et leur pondération exacte ;
- pénalités et clauses sensibles (délais, retenues, propriété intellectuelle) ;
- plateforme de remise et modalités (signature électronique ?).
Termine par les 5 points de vigilance principaux et la liste de ce qui nous manque aujourd'hui pour candidater.`,
  },
  {
    id: 'tpl-go-nogo',
    titre: 'Avis Go / No-Go',
    domaine: 'Appels d’offres',
    projetClaude: 'Analyse AO',
    contexte: 'consultation',
    version: 1,
    majLe: '2026-07-01',
    corps: `Avis Go / No-Go — {{date}}.

{{consultation}}

Nos références (extrait de la base) :
{{references}}

Notre charge actuelle : {{charge_actuelle}}.

Donne un avis Go / No-Go ARGUMENTÉ en croisant :
1. Adéquation références ↔ attentes probables du jury (typologie, montant, missions) ;
2. Notre charge et le calendrier de la consultation ({{date_limite}}) ;
3. Le coût de constitution du dossier vs la probabilité de gain (nombre probable de candidats, critères) ;
4. L'intérêt stratégique (positionnement, client récurrent potentiel, biosourcé).
Conclus par : GO franc / GO prudent / NO-GO, avec les 3 raisons décisives. Si GO : liste des premières actions et angle du mémoire.`,
  },
  {
    id: 'tpl-verif-situation',
    titre: 'Vérifier une situation de travaux',
    domaine: 'Situations',
    projetClaude: 'Secrétariat',
    contexte: 'marche',
    version: 1,
    majLe: '2026-07-01',
    corps: `Vérification d'une situation de travaux — {{date}}.

{{fiche_marche}}

La situation du mois {{mois_situation}} ({{montant_situation}} HT annoncés) est jointe / collée ci-dessous :
« ⟦coller la situation ici⟧ »

Vérifie ligne à ligne :
1. Cohérence du cumul avec les situations précédentes listées ci-dessus ;
2. Application correcte des avenants, de la révision de prix le cas échéant, et de la retenue de garantie ;
3. Avancements annoncés vs réalité chantier (signale ce qui paraît optimiste) ;
4. Calcul TVA et net à mandater.
Rends : le montant que je peux proposer au visa, les écarts détectés, et le texte court du courrier d'accompagnement au maître d'ouvrage. Je valide avant toute transmission.`,
  },
  {
    id: 'tpl-relance-situation',
    titre: 'Relancer une situation manquante',
    domaine: 'Situations',
    projetClaude: 'Secrétariat',
    contexte: 'marche',
    version: 1,
    majLe: '2026-07-01',
    corps: `Brouillon de relance — situation attendue non reçue.

{{fiche_marche}}

L'entreprise {{entreprise}} ({{lot}}) n'a pas transmis sa situation du mois {{mois_situation}} à situations@agence-ll.fr.

Rédige un e-mail de relance courtois mais précis à {{contact_entreprise}} ({{email_entreprise}}) :
- rappel de l'obligation contractuelle de transmission mensuelle à l'adresse dédiée ;
- rappel que le retard de transmission décale d'autant la vérification et le paiement ;
- demande d'envoi sous 5 jours ouvrés.
Prépare le brouillon dans Gmail — je relis avant envoi.`,
  },
  {
    id: 'tpl-relance-courtoise',
    titre: 'Relance honoraires — courtoise',
    domaine: 'Honoraires',
    projetClaude: 'Secrétariat',
    contexte: 'facture',
    version: 1,
    majLe: '2026-07-01',
    corps: `Brouillon de relance d'honoraires (niveau 1 — courtoise) — {{date}}.

{{fiche}}

Facture concernée : n° {{facture_numero}} — {{facture_libelle}} — {{facture_ttc}} TTC, émise le {{facture_emission}}, échue le {{facture_echeance}} ({{retard_jours}} jours de retard).

Rédige un e-mail de relance adapté à un maître d'ouvrage de type {{type_mo}} : ton cordial, qui présuppose un simple oubli ou un circuit de paiement en cours ; rappelle la référence de la facture, son échéance, et propose de renvoyer le PDF si besoin. Brouillon Gmail uniquement — je relis avant envoi.`,
  },
  {
    id: 'tpl-relance-ferme',
    titre: 'Relance honoraires — ferme',
    domaine: 'Honoraires',
    projetClaude: 'Secrétariat',
    contexte: 'facture',
    version: 1,
    majLe: '2026-07-01',
    corps: `Brouillon de relance d'honoraires (niveau 2 — ferme) — {{date}}.

{{fiche}}

Facture n° {{facture_numero}} — {{facture_libelle}} — {{facture_ttc}} TTC, échue le {{facture_echeance}}, {{retard_jours}} jours de retard malgré une première relance.

Rédige un e-mail ferme et factuel, adapté à un {{type_mo}} : rappel des relances précédentes, des pénalités de retard et de l'indemnité forfaitaire de recouvrement prévues par la loi (à mentionner sans agressivité), demande de règlement sous 8 jours ou d'un échéancier. Si {{type_mo}} = Public : mentionner les intérêts moratoires de plein droit. Brouillon Gmail — je relis avant envoi.`,
  },
  {
    id: 'tpl-relance-med',
    titre: 'Relance honoraires — mise en demeure',
    domaine: 'Honoraires',
    projetClaude: 'Secrétariat',
    contexte: 'facture',
    version: 1,
    majLe: '2026-07-01',
    corps: `Projet de mise en demeure (niveau 3) — {{date}}.

{{fiche}}

Facture n° {{facture_numero}} — {{facture_libelle}} — {{facture_ttc}} TTC, échue le {{facture_echeance}}, {{retard_jours}} jours de retard, relances niveau 1 et 2 restées sans effet.

Rédige un courrier de MISE EN DEMEURE (courrier recommandé, pas un e-mail) : rappel chronologique des faits et relances, montant dû avec pénalités et indemnité de recouvrement chiffrées, délai de 15 jours avant saisine (référé-provision ou médiation selon le contrat), réserve de suspendre les prestations conformément au contrat. Ton strictement factuel. Document à relire avec attention avant tout envoi — signale-moi ce qu'un avocat devrait vérifier.`,
  },
  {
    id: 'tpl-tagging-photos',
    titre: 'Tagger un lot de photos (matériauthèque)',
    domaine: 'Matériauthèque',
    projetClaude: 'Matériauthèque',
    contexte: 'libre',
    version: 1,
    majLe: '2026-07-01',
    corps: `Tagging par lot — matériauthèque / références, le {{date}}.

Les photos sont déposées dans ce Projet (glissées dans la conversation).

Pour CHAQUE photo, produis une entrée avec :
- fichier (nom exact),
- matériaux visibles (liste normalisée : béton brut, chanvre, mélèze, zinc, terre cuite…),
- teintes dominantes (2-3),
- style / ambiance (3 mots-clés max, vocabulaire constant d'une photo à l'autre),
- type de vue (extérieur, intérieur, détail, chantier),
- qualité (utilisable en planche : oui / non).

Termine par UN SEUL bloc de code json : un tableau d'objets {"fichier", "materiaux", "teintes", "style", "vue", "planche"} — il sera importé dans la base. N'invente rien : si un matériau est incertain, préfixe-le d'un « ? ».`,
  },
  {
    id: 'tpl-classement-batch',
    titre: 'Classer le dossier « à classer » de la semaine',
    domaine: 'Documentation',
    projetClaude: 'Secrétariat',
    contexte: 'libre',
    version: 1,
    majLe: '2026-07-01',
    corps: `Classement hebdomadaire — {{date}}.

Voici la liste des fichiers du dossier « à classer » (noms bruts, un par ligne) :
« ⟦coller la liste ici⟧ »

Nomenclature de l'agence : AAAAMMJJ_PROJET_TYPE_objet_vNN
Types autorisés : ADM (administratif), PC (permis), CR (compte-rendu), DCE, PLAN, FACT (facture), DEVIS, PHOTO, MAIL, NOTE, CCTP, SITU (situation de travaux).
Codes projets actifs : voir la liste du Projet.

Pour chaque fichier, propose : le nom conforme, le dossier de destination (Drive), et un niveau de doute (sûr / à confirmer). Présente le tout en tableau. Les « à confirmer » d'abord. Je valide avant tout renommage.`,
  },
  {
    id: 'tpl-references-candidature',
    titre: 'Sélectionner les références pour une candidature',
    domaine: 'Appels d’offres',
    projetClaude: 'Analyse AO',
    contexte: 'consultation',
    version: 1,
    majLe: '2026-07-01',
    corps: `Sélection de références pour candidature — {{date}}.

{{consultation}}

Notre base de références :
{{references}}

Sélectionne les 3 à 5 références les plus pertinentes pour CETTE consultation (typologie, montant, missions, fraîcheur), justifie chaque choix en une ligne, et rédige pour chacune le paragraphe de présentation (4-5 lignes, factuel, montants et missions exacts) prêt à intégrer au dossier. Signale les attestations de bonne exécution manquantes à réclamer.`,
  },
]

export function seedState(): AppState {
  return {
    version: STATE_VERSION,
    settings: {
      nomAgence: 'Agence L&L',
      tresorerieDispo: null,
      tresorerieMajLe: null,
      bt01Actuel: 137.5,
      bt01Ref1994: 60.989,
      tauxHoraireVente: 90,
      coutHoraireRevient: 65.14,
      heuresParJour: 7.8,
      caCibleHT: 174772,
      seuilDeriveHeures: 0.9,
      delaisPaiement: { Public: 30, 'Privé pro': 45, Particulier: 15 },
      personnes: ['Julien', 'Zoé'],
      nomenclature: 'AAAAMMJJ_PROJET_TYPE_objet_vNN',
      snoozes: {},
      dernierImportExcel: null,
    },

    projets: [
      {
        id: 'P01',
        nom: 'Réhabilitation 12 logements sociaux — Oise',
        typeMO: 'Public',
        statut: 'Signé',
        moa: 'OPAC de l’Oise',
        adresse: 'Oise (60)',
        ouvrage: '12- Logements collectifs',
        montantTravauxHT: 1400000,
        notesComplexite: {
          'Qualité du sol et du sous-sol': 1,
          'Contraintes physiques': 1,
          'Existence de risques': 1,
          'Contexte urbain': 1,
          'Contexte réglementaire': 1,
          'Niveau de performances des ouvrages': 1,
          'Difficultés techniques particulières': 2,
          'Technicité des installations': 1,
          'Phasage des études et des travaux': 1,
          'Taux de tolérance': 1,
          'Mode de dévolution des travaux': 1,
        },
        coefManuel: null,
        tauxRetenu: null,
        missionsComplHT: 18000,
        notes: 'EXEMPLE — à remplacer par un vrai projet. Mission de base + DIAG + OPC.',
        liens: [
          { id: 'lien-p01-1', titre: 'Dossier Drive du projet (exemple)', url: 'https://drive.google.com/' },
        ],
        materiauxIds: ['ma-1'],
        artisanIds: ['ar-1', 'ar-2'],
        journal: [
          {
            id: 'jr-p01-1',
            date: '2026-06-20',
            auteur: 'Julien',
            texte: 'EXEMPLE — Visite du site avec la MOA : sous-sol humide côté nord, prévoir diagnostic structure renforcé sur cage B.',
            tags: ['visite', 'structure'],
          },
        ],
        phases: [
          { code: 'DIAG', pctBase: null, montantHT: 9000, debut: '2026-10-01', fin: '2026-10-31', heuresPrevues: 100 },
          { code: 'ESQ', pctBase: 0.05, montantHT: P(8632.23), debut: '2026-11-01', fin: '2026-11-30', heuresPrevues: 96 },
          { code: 'APS', pctBase: 0.095, montantHT: P(16401.23), debut: '2026-12-01', fin: '2027-01-15', heuresPrevues: 182 },
          { code: 'APD', pctBase: 0.175, montantHT: P(30212.79), debut: '2027-01-16', fin: '2027-02-28', heuresPrevues: 336 },
          { code: 'PRO', pctBase: 0.2, montantHT: P(34528.9), debut: '2027-03-01', fin: '2027-04-15', heuresPrevues: 384 },
          { code: 'ACT-DCE', pctBase: 0.075, montantHT: P(12948.34), debut: '2027-04-16', fin: '2027-06-30', heuresPrevues: 144 },
          { code: 'VISA', pctBase: 0.085, montantHT: P(14674.78), debut: '2027-07-01', fin: '2027-09-30', heuresPrevues: 163 },
          { code: 'DET', pctBase: 0.265, montantHT: P(45750.8), debut: '2027-07-01', fin: '2028-04-30', heuresPrevues: 508 },
          { code: 'AOR', pctBase: 0.055, montantHT: P(9495.45), debut: '2028-05-01', fin: '2028-06-30', heuresPrevues: 106 },
          { code: 'MC', pctBase: null, montantHT: 9000, debut: null, fin: null, heuresPrevues: 100 },
        ],
      },
      {
        id: 'P02',
        nom: 'Extension maison individuelle — Vermandovillers',
        typeMO: 'Particulier',
        statut: 'Signé',
        moa: 'M. et Mme Petit',
        adresse: 'Vermandovillers (80)',
        ouvrage: '11- Maisons individuelles',
        montantTravauxHT: 180000,
        notesComplexite: {},
        coefManuel: null,
        tauxRetenu: 0.12,
        missionsComplHT: 0,
        notes: 'EXEMPLE — taux retenu saisi à la main (petit projet, barème non pertinent : temps passé).',
        liens: [],
        materiauxIds: [],
        artisanIds: [],
        journal: [],
        phases: [
          { code: 'DIAG', pctBase: null, montantHT: 0, debut: null, fin: null, heuresPrevues: 0 },
          { code: 'ESQ', pctBase: 0.05, montantHT: 1080, debut: '2026-10-01', fin: '2026-11-15', heuresPrevues: 12 },
          { code: 'APS', pctBase: 0.095, montantHT: 2052, debut: '2026-11-16', fin: '2026-12-20', heuresPrevues: 23 },
          { code: 'APD', pctBase: 0.175, montantHT: 3780, debut: '2027-01-05', fin: '2027-01-31', heuresPrevues: 42 },
          { code: 'PRO', pctBase: 0.2, montantHT: 4320, debut: '2027-02-01', fin: '2027-03-15', heuresPrevues: 48 },
          { code: 'ACT-DCE', pctBase: 0.075, montantHT: 1620, debut: '2027-03-16', fin: '2027-04-30', heuresPrevues: 18 },
          { code: 'VISA', pctBase: 0.085, montantHT: 1836, debut: '2027-06-01', fin: '2027-06-30', heuresPrevues: 20 },
          { code: 'DET', pctBase: 0.265, montantHT: 5724, debut: '2027-06-01', fin: '2027-12-31', heuresPrevues: 64 },
          { code: 'AOR', pctBase: 0.055, montantHT: 1188, debut: '2028-01-01', fin: '2028-01-31', heuresPrevues: 13 },
          { code: 'MC', pctBase: null, montantHT: 0, debut: null, fin: null, heuresPrevues: 0 },
        ],
      },
    ],

    marches: [
      {
        id: 'M-P01-L01',
        projetId: 'P01',
        entreprise: 'SARL Martin BTP',
        lot: 'Lot 01 — Gros œuvre',
        montantInitialHT: 420000,
        avenantsHT: 0,
        tauxRG: 0.05,
        revision: true,
        delaiVerifJours: 15,
        contactNom: 'M. Martin',
        contactEmail: 'contact@martin-btp.example',
        actif: false,
        notes: 'EXEMPLE — chantier prévu juillet 2027. Passer « actif » au démarrage du chantier.',
      },
      {
        id: 'M-P01-L08',
        projetId: 'P01',
        entreprise: 'Menuiserie Dubois',
        lot: 'Lot 08 — Menuiseries extérieures',
        montantInitialHT: 180000,
        avenantsHT: 0,
        tauxRG: 0.05,
        revision: false,
        delaiVerifJours: 15,
        contactNom: 'Mme Dubois',
        contactEmail: 'devis@menuiserie-dubois.example',
        actif: false,
        notes: 'EXEMPLE.',
      },
    ],

    situations: [
      {
        id: 'sit-exemple-1',
        projetId: 'P01',
        marcheId: 'M-P01-L01',
        entreprise: 'SARL Martin BTP',
        lot: 'Lot 01 — Gros œuvre',
        mois: '2026-06',
        numero: 1,
        montantMoisHT: 4575,
        montantCumulHT: 4575,
        statut: 'a_verifier',
        confiance: 0.82,
        source: 'EXEMPLE — routine situations@ du 01/07/2026',
        dateReception: '2026-07-01',
        notes: 'Ligne d’exemple pour montrer le circuit routine → à vérifier → validation humaine.',
      },
    ],

    factures: [
      facture('2026-001', 'P01', 'DIAG', 'Diagnostic — remise', 9000, '2026-10-30', 30),
      facture('2026-002', 'P01', 'ESQ', 'Esquisse — remise', 8550, '2026-11-30', 30),
      facture('2027-003', 'P01', 'APS', 'APS — remise', 16250, '2027-01-15', 30),
      facture('2027-004', 'P01', 'APD', 'APD — remise', 29900, '2027-02-28', 30),
      facture('2027-005', 'P01', 'PRO', 'PRO — remise', 34200, '2027-04-15', 30),
      facture('2027-006', 'P01', 'ACT-DCE', 'DCE + signature des marchés', 12800, '2027-06-30', 30),
      facture('2026-007', 'P02', 'ESQ', 'Esquisse — remise', 1080, '2026-11-15', 15),
      facture('2027-008', 'P02', 'APD', 'Dossier PC — dépôt (APS+APD)', 5830, '2027-02-15', 15),
      facture('2027-009', 'P02', 'PRO', 'Conception globale — remise', 4320, '2027-03-15', 15),
      facture('2027-010', 'P02', 'ACT-DCE', 'Consultation entreprises — signature marchés', 1620, '2027-04-30', 15),
      facture('2027-011', 'P01', 'VISA', 'VISA — plans d’exécution', 14675, '2027-09-30', 30),
      facture('2027-012', 'P02', 'DET', 'Chantier — situation 1/3', 2520, '2027-07-31', 15),
      facture('2027-018', 'P02', 'DET', 'Chantier — situation 2/3', 2520, '2027-09-30', 15),
      facture('2027-022', 'P02', 'DET', 'Chantier — situation 3/3', 2520, '2027-11-30', 15),
      facture('2027-025', 'P01', 'MC', 'OPC — 1er acompte', 4500, '2027-10-31', 30),
      facture('2028-026', 'P01', 'MC', 'OPC — solde', 4500, '2028-03-31', 30),
      facture('2028-027', 'P02', 'AOR', 'Réception & levée des réserves', 1188, '2028-01-31', 15),
      facture('2028-028', 'P01', 'AOR', 'Réception (50 %)', 4748, '2028-05-31', 30),
      facture('2028-029', 'P01', 'AOR', 'Levée des réserves (50 %)', 4747, '2028-06-30', 30),
      facture('2027-D01', 'P01', 'DET', 'DET — situation de chantier n°1/10', 4575, '2027-07-31', 30),
      facture('2027-D02', 'P01', 'DET', 'DET — situation de chantier n°2/10', 4575, '2027-08-31', 30),
      facture('2027-D03', 'P01', 'DET', 'DET — situation de chantier n°3/10', 4575, '2027-09-30', 30),
      facture('2027-D04', 'P01', 'DET', 'DET — situation de chantier n°4/10', 4575, '2027-10-31', 30),
      facture('2027-D05', 'P01', 'DET', 'DET — situation de chantier n°5/10', 4575, '2027-11-30', 30),
      facture('2027-D06', 'P01', 'DET', 'DET — situation de chantier n°6/10', 4575, '2027-12-31', 30),
      facture('2028-D07', 'P01', 'DET', 'DET — situation de chantier n°7/10', 4575, '2028-01-31', 30),
      facture('2028-D08', 'P01', 'DET', 'DET — situation de chantier n°8/10', 4575, '2028-02-29', 30),
      facture('2028-D09', 'P01', 'DET', 'DET — situation de chantier n°9/10', 4575, '2028-03-31', 30),
      facture('2028-D10', 'P01', 'DET', 'DET — situation de chantier n°10/10', 4575, '2028-04-30', 30),
    ],

    temps: [],

    references: [
      {
        id: 'ref-1',
        nom: 'Groupe scolaire des Tilleuls',
        lieu: 'Beauvais (60)',
        annee: 1998,
        typeMO: 'Public',
        moa: 'Ville de Beauvais',
        montantTravauxHT: 2100000,
        surfaceM2: 1850,
        mission: 'Base + EXE',
        motsCles: ['enseignement', 'neuf', 'béton'],
        attestation: true,
        notes: 'EXEMPLE — référence héritée.',
      },
      {
        id: 'ref-2',
        nom: 'Réhabilitation de 24 logements',
        lieu: 'Compiègne (60)',
        annee: 2015,
        typeMO: 'Public',
        moa: 'OPAC de l’Oise',
        montantTravauxHT: 1650000,
        surfaceM2: 1720,
        mission: 'Base + OPC',
        motsCles: ['logement', 'réhabilitation', 'site occupé'],
        attestation: true,
        notes: 'EXEMPLE.',
      },
      {
        id: 'ref-3',
        nom: 'Salle polyvalente',
        lieu: 'Noyon (60)',
        annee: 2005,
        typeMO: 'Public',
        moa: 'Commune de Noyon',
        montantTravauxHT: 890000,
        surfaceM2: 640,
        mission: 'Base',
        motsCles: ['équipement', 'bois', 'neuf'],
        attestation: false,
        notes: 'EXEMPLE — attestation de bonne exécution à réclamer.',
      },
    ],

    obligations: [
      { id: 'ob-maf', libelle: 'Assurance RC pro / décennale — cotisation MAF', organisme: 'MAF', echeance: '2026-10-15', periodiciteMois: 12, rappelJours: 30 },
      { id: 'ob-multi', libelle: 'Assurance multirisque locaux', organisme: 'Assureur', echeance: '2026-09-15', periodiciteMois: 12, rappelJours: 21 },
      { id: 'ob-ordre', libelle: 'Cotisation Ordre des architectes', organisme: 'CROA Hauts-de-France', echeance: '2027-01-15', periodiciteMois: 12, rappelJours: 30 },
      { id: 'ob-tva', libelle: 'Déclaration et reversement TVA', organisme: 'DGFiP', echeance: '2026-10-12', periodiciteMois: 1, rappelJours: 7, notes: 'Régime réel normal : mensuelle. Exigible à l’encaissement.' },
      { id: 'ob-urssaf', libelle: 'Cotisations TNS gérants', organisme: 'URSSAF', echeance: '2026-11-05', periodiciteMois: 3, rappelJours: 10, notes: 'Année 1 : forfaitaires, régularisation N+1.' },
      { id: 'ob-cfe', libelle: 'CFE', organisme: 'DGFiP', echeance: '2027-12-15', periodiciteMois: 12, rappelJours: 30, notes: 'Exonération 2026 (création) ; base réduite de 50 % en 2027.' },
      { id: 'ob-ag', libelle: 'AG annuelle SARL — approbation des comptes', organisme: 'Greffe', echeance: '2027-06-30', periodiciteMois: 12, rappelJours: 45 },
      { id: 'ob-is', libelle: 'IS — solde exercice 1', organisme: 'DGFiP', echeance: '2027-05-15', periodiciteMois: 12, rappelJours: 30, notes: 'Pas d’acomptes la 1re année.' },
    ],

    contacts: [
      {
        id: 'ct-1',
        nom: 'M. Lefèvre',
        organisme: 'OPAC de l’Oise',
        role: 'Chargé d’opérations',
        type: 'MOA',
        email: 'lefevre@opac-oise.example',
        derniereInteraction: '2026-06-20',
        prochaineAction: 'Retour attendu sur le planning DIAG',
        dateProchaineAction: '2026-07-10',
        notes: 'EXEMPLE.',
      },
      {
        id: 'ct-2',
        nom: 'Mme Morel',
        organisme: 'CC Oise Picarde',
        role: 'DGS',
        type: 'Prospect',
        email: 'dgs@ccop.example',
        derniereInteraction: '2026-06-05',
        prochaineAction: 'Proposer une rencontre de présentation de l’agence',
        dateProchaineAction: '2026-09-01',
        notes: 'EXEMPLE — projets scolaires évoqués pour 2027.',
      },
    ],

    artisans: [
      {
        id: 'ar-1',
        nom: 'SARL Martin BTP',
        lots: ['Gros œuvre', 'Maçonnerie'],
        zone: 'Oise, 40 km autour de Beauvais',
        fourchette: '100 k€ – 800 k€',
        decennaleFin: '2027-03-31',
        contactNom: 'M. Martin',
        contactEmail: 'contact@martin-btp.example',
        tel: '03 44 00 00 01',
        notes: 'EXEMPLE — sérieux sur les délais, chiffrage rapide.',
      },
      {
        id: 'ar-2',
        nom: 'Menuiserie Dubois',
        lots: ['Menuiseries extérieures', 'Menuiseries intérieures'],
        zone: 'Somme / Oise',
        fourchette: '20 k€ – 250 k€',
        decennaleFin: '2026-07-20',
        contactNom: 'Mme Dubois',
        contactEmail: 'devis@menuiserie-dubois.example',
        tel: '03 22 00 00 02',
        notes: 'EXEMPLE — décennale à renouveler (alerte attendue dans le fil d’urgences).',
      },
    ],

    materiaux: [
      {
        id: 'ma-1',
        nom: 'Bloc de béton de chanvre',
        fournisseur: 'Chanvribloc (exemple)',
        coutM2: 85,
        lienFDES: 'https://www.base-inies.fr/iniesV4/dist/consultation.html',
        tags: ['biosourcé', 'isolation répartie', 'mur'],
        notes: 'EXEMPLE — argument carbone dès l’esquisse (FDES INIES).',
      },
      {
        id: 'ma-2',
        nom: 'Bardage mélèze à claire-voie',
        fournisseur: 'Scierie locale (exemple)',
        coutM2: 68,
        lienFDES: 'https://www.base-inies.fr/iniesV4/dist/consultation.html',
        tags: ['bois', 'façade', 'biosourcé'],
        notes: 'EXEMPLE.',
      },
    ],

    consultations: [
      {
        id: 'ao-exemple-1',
        intitule: 'Restructuration du groupe scolaire Jules-Ferry',
        acheteur: 'Commune de Grandvilliers (60)',
        lieu: 'Oise',
        typologie: 'Enseignement',
        budgetTravaux: 1800000,
        dateLimite: '2026-09-15',
        statut: 'a_etudier',
        source: 'EXEMPLE — veille AO du 29/06/2026 (BOAMP)',
        notes: 'Visite obligatoire. Mission base + EXE probable.',
      },
    ],

    prompts: GABARITS,

    reunions: [],
  }
}
