// ============================================================
// LE classifieur déterministe des trois axes du §5.2 — livrable A.8.
//
// POURQUOI CE FICHIER EXISTE, ET PAS UN BLOC DANS `index.ts`
// ---------------------------------------------------------
// Le plan écrit « extension de `classer()` ». C'en est bien l'extension —
// même forme exactement : une valeur, une confiance, des raisons en
// français, le plafond commun — mais dans un fichier PUR, parce que
// `gmail-ingestion/index.ts` appelle `Deno.serve` et n'est donc exécutable
// par aucun test. Le dépôt a déjà tranché deux fois dans ce sens :
// `message.ts` (normalisation d'un message) et `_shared/rattachement.ts`
// (la cascade) sont sortis pour la même raison. Un lexique qu'on ne peut
// pas interroger est un lexique que personne ne corrige jamais.
//
// AUCUN MODÈLE N'EST APPELÉ ICI — c'est la décision 5 du §3.14, et ce n'est
// pas une économie : un axe est une donnée de TRI, lue cent fois par jour et
// jamais relue en tant que telle. Une erreur de tri ne se voit pas. Un
// lexique, lui, s'explique, se corrige et se rejoue à l'identique.
//
// OÙ VIVENT LES VALEURS, ET OÙ ELLES NE VIVENT PAS
// ------------------------------------------------
// Les trois listes fermées du §5.2 sont dans `src/categorisation.ts`, et
// nulle part ailleurs : ce module n'en RECOPIE aucune. Il ne déclare ni
// `PHASES_ECHANGE`, ni `TYPES_ECHANGE`, ni `NIVEAUX_IMPORTANCE` ; il se
// contente d'ÉMETTRE des valeurs, et `scripts/test-classement-echanges.cjs`
// vérifie une par une que chacune appartient bien à la liste fermée du module
// de référence — et refuse qu'une liste fermée réapparaisse ici. C'est la
// même discipline que les trois domaines SQL d'A.2, comparés au module valeur
// par valeur.
//
// Les LIBELLÉS français des axes ne sont pas recopiés non plus : chaque entrée
// de lexique porte sa propre phrase d'explication, écrite une fois, affichée
// telle quelle. Recopier `LIBELLES_PHASE_ECHANGE` ici en aurait fait une
// seconde table de traduction, qui aurait vieilli seule.
//
// POURQUOI CE MODULE PEUT IMPORTER, ALORS QUE `rattachement.ts` NE LE PEUT PAS
// ---------------------------------------------------------------------------
// `_shared/rattachement.ts` doit tourner dans TROIS runtimes, dont le
// navigateur : d'où son interdiction d'importer quoi que ce soit (Deno exige
// l'extension `.ts`, TypeScript en `moduleResolution: bundler` la refuse).
// Ce module-ci n'en a que DEUX — le Deno de l'ingestion et le Node du test —
// parce que le navigateur ne classe rien : il AFFICHE ce que le serveur a
// proposé (colonnes `*_propose*`) et corrige à la main (colonnes humaines).
// Il peut donc importer `./rattachement.ts` à la mode Deno, et surtout il le
// DOIT : `fold`, `normaliserAdresse` et `domaineDe` y sont déjà, et une
// quatrième copie de la normalisation des accents divergerait un jour.
//
// Corollaire à ne pas perdre : AUCUN fichier de `src/` ne doit importer ce
// module — l'extension `.ts` explicite y casserait la compilation. Le test le
// vérifie, et le typage du module est contrôlé par le test lui-même, qui en
// fait un programme TypeScript complet (il n'a pas d'autre dépendance).
//
// CE QU'IL FAIT, ET CE QU'IL REFUSE DE FAIRE
// ------------------------------------------
// Il PROPOSE trois axes, chacun indépendamment, avec ses raisons. Il ne valide
// rien : l'appelant n'écrit que `phase_proposee`, `type_echange_propose` et
// `importance_proposee`, et le GRANT au niveau colonne d'A.2 lui interdit
// d'écrire les colonnes humaines (§3.14, §15).
//
// Il REFUSE DE DEVINER, exactement comme la cascade : deux valeurs à égalité
// sur un axe le laissent VIDE et nomment les candidates. Sous le seuil, l'axe
// reste vide avec la raison déjà en production — « Aucun mot du lexique
// reconnu — … à choisir ». Un axe vide se voit dans la file du matin et coûte
// deux clics ; un axe faux se lit comme un fait, se propage aux filtres du
// §8.2 et du §13.1, et ne se voit jamais.
// ============================================================

import { CONFIANCE_MAX, domaineDe, fold, normaliserAdresse } from './rattachement.ts'

// ------------------------------------------------------------
// 1. Les repères — ce que la base sait des correspondants
// ------------------------------------------------------------

/**
 * Le GENRE d'un correspondant, tel que la base de l'agence le connaît.
 *
 * Ce n'est pas l'axe : c'est ce qu'on sait de la personne. La traduction
 * genre → type d'échange vit ici, une seule fois (`TYPE_PAR_GENRE`), pour que
 * l'ingestion et un éventuel second appelant ne puissent pas en diverger.
 */
export type GenreCorrespondant = 'maitrise_ouvrage' | 'bet' | 'entreprise' | 'interne'

export interface CorrespondantRepere {
  /** adresse normalisée, ou domaine nu quand `surDomaine` */
  valeur: string
  surDomaine: boolean
  genre: GenreCorrespondant
  /** d'où vient l'information, en français : c'est la raison affichée */
  origine: string
}

export interface ReperesClassement {
  correspondants: CorrespondantRepere[]
}

/** ce qu'on sait du message à classer. Le corps ENTRE ici, contrairement au
 *  rattachement (§3.7) qui l'exclut — voir la section 4 pour pourquoi. */
export interface IndicesClassement {
  objet?: string
  corpsExtrait?: string
  expediteur?: string
  destinataires?: string[]
  copies?: string[]
  direction?: 'entrant' | 'sortant'
}

/** `Contact.type` (src/types.ts) → genre. « Prospect » et « Autre » ne se
 *  traduisent pas : un prospect n'est pas encore un client, et « Autre » ne
 *  dit rien. Deviner ici classerait durablement de travers. */
export function genreDepuisTypeContact(type: string | null | undefined): GenreCorrespondant | null {
  const t = fold(type || '')
  if (t === 'moa') return 'maitrise_ouvrage'
  if (t === 'bet') return 'bet'
  if (t === 'entreprise') return 'entreprise'
  return null
}

// ------------------------------------------------------------
// 2. Le résultat
// ------------------------------------------------------------

/**
 * Les trois axes proposés, leur confiance commune et leurs raisons.
 *
 * Les valeurs sont typées `string | null` et non par les unions fermées de
 * `src/categorisation.ts` : ce module ne peut pas importer `src/` (voir
 * l'en-tête), et recopier les unions ici en aurait fait une seconde liste
 * fermée — précisément ce que le livrable interdit. Le contrôle est reporté
 * sur deux garde-fous qui, eux, ne se contournent pas : le domaine SQL de la
 * colonne (une valeur inconnue est refusée à l'INSERT) et le test, qui compare
 * chaque valeur émise à la liste fermée.
 */
export interface ClassementAxes {
  phase: string | null
  typeEchange: string | null
  importance: string | null
  /**
   * Moyenne des confiances des axes RÉELLEMENT proposés, `0` si aucun.
   *
   * Pas la moyenne sur trois : « ce que j'ai proposé, j'en suis sûr à tant »
   * est la question que se pose la personne qui relit. C'est aussi la
   * sémantique de `Rattachement.confiance`, qui vaut 0 quand rien n'est
   * proposé et ne se dilue pas quand une piste manque.
   */
  confiance: number
  /** en français, toujours non vide : le dépôt affiche pourquoi */
  raisons: string[]
}

// ------------------------------------------------------------
// 3. Les lexiques
// ------------------------------------------------------------

/** une entrée de lexique : une valeur d'axe, un motif, un poids, une phrase */
export interface EntreeLexique {
  /** valeur de l'axe — prise dans la liste fermée de `src/categorisation.ts` */
  valeur: string
  motif: RegExp
  poids: number
  /** phrase française complète, affichée telle quelle sous « Voir pourquoi » */
  raison: string
}

/**
 * Sous ce seuil, l'axe reste vide (« repli explicite » du plan).
 *
 * Il n'est pas décoratif : les entrées à 0,3 ne passent QUE si elles ont été
 * reconnues dans l'objet, qui vaut le bonus ci-dessous. « Maître d'ouvrage »
 * cité au détour d'un corps de message ne classe rien ; le même mot dans
 * l'objet, si.
 */
export const SEUIL_AXE = 0.35

/** ce que vaut, en plus, une reconnaissance dans l'OBJET plutôt que dans le
 *  corps : l'objet est écrit pour dire de quoi parle le message, le corps
 *  contient aussi les fils recopiés et les signatures */
export const BONUS_OBJET = 0.1

// --- Axe 1 : la phase du projet ---------------------------------------------
//
// Les dix phases de la mission plus les quatre hors mission. Le §3.14 les tient
// dans `PhaseEchange` (superset de `PhaseCode`) : `PROSPECTION`, `CONCOURS`,
// `DOE` et `SAV` n'ont ni montant ni pourcentage d'honoraires, et c'est
// exactement pour cela qu'elles ne sont pas entrées dans `PhaseCode`.
//
// Le plan demande nommément d'y reconnaître « permis », « DCE », « OPR »,
// « levée de réserves », « parfait achèvement » et « DOE ».

export const LEXIQUE_PHASE: EntreeLexique[] = [
  {
    valeur: 'PROSPECTION',
    motif: /prise de contact|premier contact|prospection|dossier de candidature|appel a candidature|references de l'agence/,
    poids: 0.5,
    raison: 'prise de contact ou candidature — phase PROSPECTION.',
  },
  {
    valeur: 'CONCOURS',
    motif: /concours d'architecture|concours restreint|concours de maitrise|rendu de concours|prime de concours|jury de concours|anonymat du concours/,
    poids: 0.6,
    raison: 'un concours — phase CONCOURS.',
  },
  {
    valeur: 'DIAG',
    motif: /faisabilite|etude prealable|diagnostic|releve de l'existant|releve geometre|audit energetique/,
    poids: 0.6,
    raison: 'faisabilité, diagnostic ou relevé — phase DIAG (le « Faisabilité » du CDC).',
  },
  {
    valeur: 'ESQ',
    motif: /(^|[^a-z])esq([^a-z]|$)|esquisse/,
    poids: 0.6,
    raison: 'l’esquisse — phase ESQ.',
  },
  {
    valeur: 'APS',
    motif: /(^|[^a-z])aps([^a-z]|$)|avant[- ]projet sommaire/,
    poids: 0.6,
    raison: 'l’avant-projet sommaire — phase APS.',
  },
  {
    valeur: 'APD',
    motif: /(^|[^a-z])apd([^a-z]|$)|avant[- ]projet definitif/,
    poids: 0.6,
    raison: 'l’avant-projet définitif — phase APD.',
  },
  {
    // Le dossier de permis se produit à l'APD (décret 93-1268 art. 4) : c'est
    // la phase que la correspondance d'urbanisme accompagne. Poids modéré,
    // parce que l'instruction se poursuit souvent pendant le PRO.
    valeur: 'APD',
    motif: /permis de construire|permis d'amenager|declaration prealable|depot du permis|instruction du permis|(^|[^a-z])cerfa([^a-z]|$)/,
    poids: 0.4,
    raison:
      'le permis — le dossier se produit à l’APD (décret 93-1268), d’où la phase APD ; à corriger si l’instruction se poursuit en PRO.',
  },
  {
    valeur: 'PRO',
    motif: /(^|[^a-z])pro([^a-z]|$)|dossier pro|phase pro|projet definitif/,
    poids: 0.55,
    raison: 'le dossier PRO — phase PRO.',
  },
  {
    valeur: 'ACT-DCE',
    motif: /(^|[^a-z])dce([^a-z]|$)|consultation des entreprises|reglement de consultation|(^|[^a-z])ccap([^a-z]|$)|(^|[^a-z])cctp([^a-z]|$)|(^|[^a-z])dpgf([^a-z]|$)|appel d'offre|analyse des offres|attribution du marche/,
    poids: 0.6,
    raison: 'la consultation des entreprises — phase ACT-DCE (le dépôt facture « DCE » et « ACT » ensemble).',
  },
  {
    valeur: 'VISA',
    motif: /(^|[^a-z])visa([^a-z]|$)|plan d'execution|plans d'execution|(^|[^a-z])exe([^a-z]|$)|note de calcul/,
    poids: 0.55,
    raison: 'le visa des plans d’exécution — phase VISA.',
  },
  {
    valeur: 'DET',
    motif: /reunion de chantier|compte[- ]rendu de chantier|ordre de service|(^|[^a-z])os n|situation n|avancement des travaux|planning des travaux/,
    poids: 0.55,
    raison: 'le suivi de l’exécution des travaux — phase DET.',
  },
  {
    valeur: 'AOR',
    motif: /reception des travaux|(^|[^a-z])opr([^a-z]|$)|operations prealables a la reception|levee de reserve|proces[- ]verbal de reception|(^|[^a-z])pv de reception/,
    poids: 0.6,
    raison: 'la réception ou la levée des réserves — phase AOR.',
  },
  {
    valeur: 'MC',
    motif: /mission complementaire|(^|[^a-z])opc([^a-z]|$)|(^|[^a-z])ssi([^a-z]|$)/,
    poids: 0.45,
    raison: 'une mission complémentaire (OPC, SSI…) — phase MC.',
  },
  {
    valeur: 'DOE',
    motif: /(^|[^a-z])doe([^a-z]|$)|dossier des ouvrages executes|(^|[^a-z])diuo([^a-z]|$)|dossier d'intervention ulterieure/,
    poids: 0.6,
    raison: 'le dossier des ouvrages exécutés — phase DOE.',
  },
  {
    valeur: 'SAV',
    motif: /parfait achevement|(^|[^a-z])gpa([^a-z]|$)|garantie de parfait|(^|[^a-z])sav([^a-z]|$)|reprise sous garantie|desordre apres reception/,
    poids: 0.6,
    raison: 'l’année de parfait achèvement — phase SAV.',
  },
]

// --- Axe 2 : le type d'échange ----------------------------------------------
//
// Le plan tranche l'ordre : « type d'échange par l'expéditeur d'abord ». D'où
// trois étages de poids décroissant, et non trois règles concurrentes :
//
//   1. le correspondant CONNU de la base (0,75) — c'est un fait de l'agence,
//      pas une inférence : `Projet.emailMOA`, `Contact.email` avec son type,
//      `MarcheTravaux.contactEmail`, `Entreprise.domaines` ;
//   2. le DOMAINE de l'interlocuteur (0,6) — mairie, préfecture, contrôleur
//      technique : des organisations reconnaissables sans rien savoir d'elles ;
//   3. l'OBJET et le corps (0,3 à 0,55) — le sujet du message.
//
// Une mairie qui est le CLIENT figure déjà dans `Projet.emailMOA` : l'étage 1
// gagne et l'échange est « client ». Une mairie qui ne l'est pas est, pour une
// agence d'architecture, l'urbanisme — d'où le classement de l'étage 2.

/** genre du correspondant → type d'échange. Une seule table, ici. */
export const TYPE_PAR_GENRE: Record<GenreCorrespondant, string> = {
  maitrise_ouvrage: 'client',
  bet: 'bet',
  entreprise: 'entreprise',
  interne: 'interne',
}

/** le même, en français, pour la phrase affichée */
export const LIBELLE_GENRE: Record<GenreCorrespondant, string> = {
  maitrise_ouvrage: 'client',
  bet: 'BET',
  entreprise: 'entreprise',
  interne: 'interne',
}

export const CONFIANCE_CORRESPONDANT = 0.75
export const CONFIANCE_DOMAINE = 0.6

/** Étage 2 : le domaine de l'interlocuteur. L'ORDRE COMPTE — `culture.gouv.fr`
 *  (DRAC, ABF) doit être reconnu comme urbanisme avant d'être vu comme un
 *  `.gouv.fr` quelconque. Le poids ne vient pas des entrées : c'est
 *  `CONFIANCE_DOMAINE`, le même pour toutes, parce qu'un domaine reconnu est
 *  un fait binaire — il l'est ou il ne l'est pas. */
export const LEXIQUE_DOMAINE: EntreeLexique[] = [
  {
    valeur: 'urbanisme',
    motif: /(^|\.)mairie|(^|\.)ville-|(^|\.)commune|agglo|metropole|grandlyon|(^|\.)cc-|(^|\.)udap|(^|\.)drac|culture\.gouv\.fr$/,
    poids: CONFIANCE_DOMAINE,
    raison:
      'le domaine de l’interlocuteur est celui d’une collectivité ou d’un service d’urbanisme — type « urbanisme ». S’il s’agit du maître d’ouvrage, renseignez son adresse dans la fiche projet : le classement deviendra « client ».',
  },
  {
    valeur: 'administration',
    motif: /\.gouv\.fr$|prefecture|urssaf|impots|(^|\.)ars-|(^|\.)dreal|(^|\.)ddt|(^|\.)sdis|pole-emploi/,
    poids: CONFIANCE_DOMAINE,
    raison: 'le domaine de l’interlocuteur est celui d’une administration — type « administration ».',
  },
  {
    valeur: 'bureau_de_controle',
    motif: /apave|socotec|veritas|dekra|qualiconsult|alpes-controles|controle-technique/,
    poids: CONFIANCE_DOMAINE,
    raison: 'le domaine de l’interlocuteur est celui d’un bureau de contrôle — type « bureau de contrôle ».',
  },
  {
    valeur: 'csps',
    motif: /(^|[.-])csps|coordination-sps|coordonnateur-sps/,
    poids: CONFIANCE_DOMAINE,
    raison: 'le domaine de l’interlocuteur est celui d’un coordonnateur SPS — type « CSPS ».',
  },
]

/** Étage 3 : le sujet du message. */
export const LEXIQUE_TYPE: EntreeLexique[] = [
  {
    valeur: 'contractuel',
    motif: /avenant|acte d'engagement|resiliation|mise en demeure|ordre de service|retenue de garantie|caution bancaire|penalite de retard|notification du marche/,
    poids: 0.55,
    raison: 'le contrat ou le marché — type « contractuel ».',
  },
  {
    valeur: 'reclamation',
    motif: /reclamation|litige|contestation|desaccord|malfacon|non conformite|non conforme|refus de reception/,
    poids: 0.55,
    raison: 'une contestation — type « réclamation ».',
  },
  {
    valeur: 'urbanisme',
    motif: /permis de construire|declaration prealable|certificat d'urbanisme|autorisation d'urbanisme|architecte des batiments de france|(^|[^a-z])abf([^a-z]|$)|(^|[^a-z])plu([^a-z]|$)/,
    poids: 0.55,
    raison: 'une autorisation d’urbanisme — type « urbanisme ».',
  },
  {
    valeur: 'financier',
    motif: /facture|honoraire|acompte|paiement|virement|impaye|situation de travaux|devis|(^|[^a-z])rib([^a-z]|$)/,
    poids: 0.5,
    raison: 'de l’argent (facture, honoraires, paiement) — type « financier ».',
  },
  {
    valeur: 'planning',
    motif: /planning|calendrier|retard|report de|delai de livraison|phasage|date de livraison|echeancier/,
    poids: 0.5,
    raison: 'les délais — type « planning ».',
  },
  {
    valeur: 'validation',
    motif: /bon pour accord|pour validation|pour approbation|accord de principe|pour signature|visa favorable|validation du/,
    poids: 0.5,
    raison: 'un accord demandé ou donné — type « validation ».',
  },
  {
    valeur: 'chantier',
    motif: /reunion de chantier|visite de chantier|installation de chantier|intemperie|constat de chantier|securite du chantier/,
    poids: 0.5,
    raison: 'le chantier — type « chantier ».',
  },
  {
    valeur: 'fournisseur',
    motif: /echantillon|nuancier|catalogue|fiche technique|documentation produit|(^|[^a-z])fdes([^a-z]|$)/,
    poids: 0.5,
    raison: 'un produit ou un matériau — type « fournisseur ».',
  },
  {
    valeur: 'administration',
    motif: /attestation de vigilance|attestation decennale|assurance decennale|(^|[^a-z])kbis([^a-z]|$)|urssaf/,
    poids: 0.45,
    raison: 'des pièces administratives — type « administration ».',
  },
  {
    valeur: 'bureau_de_controle',
    motif: /controleur technique|bureau de controle|rapport initial de controle|(^|[^a-z])rvrat([^a-z]|$)/,
    poids: 0.45,
    raison: 'le contrôle technique — type « bureau de contrôle ».',
  },
  {
    valeur: 'csps',
    motif: /(^|[^a-z])csps([^a-z]|$)|coordonnateur sps|plan general de coordination|(^|[^a-z])pgc([^a-z]|$)/,
    poids: 0.45,
    raison: 'la coordination SPS — type « CSPS ».',
  },
  {
    valeur: 'bet',
    motif: /(^|[^a-z])bet([^a-z]|$)|bureau d'etude/,
    poids: 0.45,
    raison: 'un bureau d’études — type « BET ».',
  },
  {
    // 0,3 : sous le seuil, sauf si c'est l'OBJET qui le dit. « Maître
    // d'ouvrage » au fil d'un corps de message ne classe rien.
    valeur: 'client',
    motif: /maitre d'ouvrage|maitrise d'ouvrage|(^|[^a-z])moa([^a-z]|$)/,
    poids: 0.3,
    raison: 'la maîtrise d’ouvrage — type « client ».',
  },
  {
    valeur: 'entreprise',
    motif: /sous[- ]traitance|sous[- ]traitant|entreprise titulaire|(^|[^a-z])lot n/,
    poids: 0.3,
    raison: 'une entreprise de travaux — type « entreprise ».',
  },
]

// --- Axe 3 : le niveau d'importance -----------------------------------------
//
// Le plan désigne la source : `MARQUEURS_ACTION` (`src/tagging.ts`), complété
// de marqueurs contractuels et de blocage. Les dix marqueurs d'action sont
// repris dans l'entrée « a_traiter » ; le test les relit dans `src/tagging.ts`
// et vérifie que CHACUN est encore reconnu, plutôt que de comparer deux textes
// — c'est la méthode déjà employée pour `fold`, dont `_shared/rattachement.ts`
// détient une copie vérifiée par comportement et non par égalité de source.
//
// Il n'y a AUCUN repli sur « information » : un message sans marqueur laisse
// l'axe vide. Écrire « information » par défaut rendrait le niveau illisible —
// on ne distinguerait plus « c'est une information » de « personne n'a rien su
// en dire », et c'est la seconde qui serait vraie neuf fois sur dix.

export const LEXIQUE_IMPORTANCE: EntreeLexique[] = [
  {
    valeur: 'contractuel',
    motif: /mise en demeure|lettre recommandee|recommande avec accuse|(^|[^a-z])lrar([^a-z]|$)|resiliation|contentieux|penalite de retard|reserve emise|protocole transactionnel|huissier|expertise judiciaire|(^|[^a-z])refere([^a-z]|$)/,
    poids: 0.75,
    raison: 'des termes contractuels engageants (mise en demeure, résiliation, pénalités…) — importance « contractuel ».',
  },
  {
    valeur: 'bloquant',
    motif: /bloquant|blocage|chantier a l'arret|arret de chantier|impossible de (poursuivre|continuer|demarrer)|suspension des travaux|nous ne pouvons pas (poursuivre|continuer|demarrer)/,
    poids: 0.7,
    raison: 'un arrêt ou un blocage — importance « bloquant ».',
  },
  {
    valeur: 'urgent',
    motif: /(^|[^a-z])urgent|tres urgent|au plus vite|des que possible|immediatement|sous 24 ?h|sous 48 ?h|avant ce soir|delai depasse|derniere relance|deuxieme relance/,
    poids: 0.65,
    raison: 'une urgence ou un délai immédiat — importance « urgent ».',
  },
  {
    valeur: 'important',
    motif: /(^|[^a-z])important|prioritaire|pour validation|bon pour accord|pour signature|a valider|date limite|(^|[^a-z])echeance/,
    poids: 0.55,
    raison: 'une décision attendue ou une échéance — importance « important ».',
  },
  {
    valeur: 'information',
    motif: /pour information|pour info|pour votre information|ne pas repondre a ce message|newsletter|se desinscrire/,
    poids: 0.5,
    raison: 'un message qui s’annonce comme une information — importance « information ».',
  },
  {
    // les dix marqueurs d'action de `src/tagging.ts`, plus les trois tournures
    // de demande les plus fréquentes en français professionnel
    valeur: 'a_traiter',
    motif: /penser a|(^|[^a-z])a faire([^a-z]|$)|ne pas oublier|rappeler|relancer|verifier|prevoir|demander|envoyer|appeler|merci de|pouvez[- ]vous|pourriez[- ]vous/,
    poids: 0.45,
    raison: 'une action demandée (marqueurs d’action du journal) — importance « à traiter ».',
  },
]

/** Un expéditeur automatique n'attend rien de personne. Le signal est dans
 *  l'ADRESSE, pas dans le texte : il est donc plus sûr que le lexique. */
export const ADRESSES_AUTOMATIQUES = /^(no-?reply|ne-?pas-?repondre|donotreply|mailer-daemon|notifications?)@/

// ------------------------------------------------------------
// 4. Les textes fouillés
// ------------------------------------------------------------
//
// POURQUOI LE CORPS ENTRE ICI ALORS QUE LE §3.7 L'EXCLUT DU RATTACHEMENT.
// Ce n'est pas une entorse, c'est la même règle appliquée à deux enjeux
// différents. Un nom de projet lu en signature rattacherait tout un fil au
// mauvais projet, et le faux se recopie ensuite dans les documents : le §3.7
// refuse donc le corps. Un mot d'urgence lu dans un fil recopié, lui, propose
// un niveau d'importance sur UN message, corrigible d'un clic, sans effet de
// bord. Et surtout, l'information n'EST PAS dans l'objet : « merci de valider
// avant vendredi » ne s'écrit jamais en objet. Refuser le corps ici ne
// protégerait rien et laisserait l'axe vide neuf fois sur dix.
//
// Le corps reste second : une reconnaissance dans l'objet vaut `BONUS_OBJET`
// de plus, et c'est ce qui départage.

/** minuscules, sans accents, apostrophes unifiées, espaces normalisés */
function preparer(texte: string): string {
  return fold(texte || '')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, ' ')
}

// ------------------------------------------------------------
// 5. La reconnaissance d'un axe
// ------------------------------------------------------------

interface Reconnaissance {
  valeur: string
  poids: number
  raison: string
}

/** applique un lexique aux deux textes et rend les reconnaissances retenues,
 *  la meilleure d'abord */
function reconnaitre(lexique: EntreeLexique[], objet: string, complet: string): Reconnaissance[] {
  const trouvees: Reconnaissance[] = []
  for (const entree of lexique) {
    const dansObjet = entree.motif.test(objet)
    if (!dansObjet && !entree.motif.test(complet)) continue
    const poids = entree.poids + (dansObjet ? BONUS_OBJET : 0)
    if (poids < SEUIL_AXE) continue
    trouvees.push({
      valeur: entree.valeur,
      poids,
      raison: `${dansObjet ? 'L’objet parle de' : 'Le corps du message parle de'} ${entree.raison}`,
    })
  }
  return trouvees.sort((a, b) => b.poids - a.poids)
}

/** le domaine n'est ni un objet ni un corps : il a sa propre phrase, et le
 *  bonus « vu dans l'objet » n'y aurait aucun sens */
function reconnaitreDomaine(domaine: string): Reconnaissance[] {
  const trouvees: Reconnaissance[] = []
  for (const entree of LEXIQUE_DOMAINE) {
    if (!entree.motif.test(domaine)) continue
    trouvees.push({ valeur: entree.valeur, poids: entree.poids, raison: `@${domaine} : ${entree.raison}` })
  }
  return trouvees
}

/**
 * Tranche entre des reconnaissances concurrentes.
 *
 * Deux valeurs DIFFÉRENTES au même poids ⇒ on refuse et on les nomme, comme la
 * cascade de rattachement. Une valeur qui gagne pendant qu'une autre, plus
 * faible, dit autre chose ⇒ on tranche, mais le désaccord est DIT : c'est là
 * que se voit le seul cas où le lexique se trompe visiblement.
 */
function trancherAxe(
  trouvees: Reconnaissance[],
  axe: string,
  raisons: string[],
): { valeur: string | null; confiance: number } {
  if (trouvees.length === 0) {
    raisons.push(`Aucun mot du lexique reconnu — ${axe} à choisir.`)
    return { valeur: null, confiance: 0 }
  }
  const ordonnees = [...trouvees].sort((a, b) => b.poids - a.poids)
  const meilleur = ordonnees[0].poids
  const exAequo = [...new Set(ordonnees.filter((t) => t.poids === meilleur).map((t) => t.valeur))]
  if (exAequo.length > 1) {
    for (const t of ordonnees.filter((x) => x.poids === meilleur)) raisons.push(t.raison)
    raisons.push(`Deux lectures s’équivalent (${axe}) — ${exAequo.join(', ')} : à choisir.`)
    return { valeur: null, confiance: 0 }
  }
  const retenu = ordonnees[0]
  raisons.push(retenu.raison)
  const desaccords = [...new Set(ordonnees.filter((t) => t.valeur !== retenu.valeur).map((t) => t.valeur))]
  if (desaccords.length > 0) {
    raisons.push(`Signal plus faible en désaccord (${axe}) : ${desaccords.join(', ')} — vérifiez.`)
  }
  return { valeur: retenu.valeur, confiance: Math.min(retenu.poids, CONFIANCE_MAX) }
}

// ------------------------------------------------------------
// 6. L'interlocuteur
// ------------------------------------------------------------

/**
 * Qui est en face ?
 *
 * Pour un message ENTRANT, c'est l'expéditeur. Pour un message SORTANT, c'est
 * le premier destinataire externe : l'expéditeur est l'agence, et classer
 * « interne » tout ce que l'agence envoie viderait l'axe de son sens sur la
 * moitié du courrier — or c'est cette moitié que le §8.2 (« en attente de
 * réponse ») a fait entrer dans l'index en A.1.
 *
 * Quand tous les participants sont de l'agence — et seulement alors —
 * l'échange est bien « interne ».
 */
function interlocuteurDe(
  reperes: ReperesClassement,
  indices: IndicesClassement,
): { adresse: string; correspondant: CorrespondantRepere | null; tousInternes: boolean } {
  const internes = new Set(
    reperes.correspondants.filter((c) => c.genre === 'interne' && !c.surDomaine).map((c) => c.valeur),
  )
  const expediteur = normaliserAdresse(indices.expediteur)
  const autres = [...(indices.destinataires || []), ...(indices.copies || [])]
    .map(normaliserAdresse)
    .filter(Boolean)
  const participants = [...(expediteur ? [expediteur] : []), ...autres]
  const externes = participants.filter((a) => !internes.has(a))
  const tousInternes = participants.length > 0 && externes.length === 0

  const adresse =
    indices.direction === 'sortant' ? autres.find((a) => !internes.has(a)) || expediteur : expediteur

  return { adresse, correspondant: correspondantDe(reperes, adresse), tousInternes }
}

/** l'adresse exacte d'abord, le domaine ensuite — une adresse nominative en dit
 *  plus qu'un domaine partagé par toute une entreprise */
function correspondantDe(reperes: ReperesClassement, adresse: string): CorrespondantRepere | null {
  if (!adresse) return null
  const parAdresse = reperes.correspondants.find((c) => !c.surDomaine && c.valeur === adresse)
  if (parAdresse) return parAdresse
  const domaine = domaineDe(adresse)
  if (!domaine) return null
  return reperes.correspondants.find((c) => c.surDomaine && c.valeur === domaine) || null
}

// ------------------------------------------------------------
// 7. Le classifieur
// ------------------------------------------------------------

/**
 * Les trois axes du §5.2, PROPOSÉS — jamais validés.
 *
 * Chaque axe est décidé INDÉPENDAMMENT : une phase reconnue n'entraîne pas un
 * type, un type n'entraîne pas une importance. Les faire dépendre l'un de
 * l'autre produirait des chaînes d'erreurs qu'aucune correction unitaire ne
 * défait — corriger la phase changerait le type sous les doigts, et l'écran
 * n'aurait plus de moyen de le dire.
 */
export function classerAxes(reperes: ReperesClassement, indices: IndicesClassement): ClassementAxes {
  const objet = preparer(indices.objet || '')
  const complet = preparer(`${indices.objet || ''} ${indices.corpsExtrait || ''}`)
  const raisons: string[] = []

  // --- axe 1 : la phase ---
  const phase = trancherAxe(reconnaitre(LEXIQUE_PHASE, objet, complet), 'phase', raisons)

  // --- axe 2 : le type d'échange, l'interlocuteur d'abord ---
  const qui = interlocuteurDe(reperes, indices)
  const candidatsType = reconnaitre(LEXIQUE_TYPE, objet, complet)
  if (qui.correspondant) {
    const genre = qui.correspondant.genre
    candidatsType.push({
      valeur: TYPE_PAR_GENRE[genre],
      poids: CONFIANCE_CORRESPONDANT,
      raison: `${qui.correspondant.origine} — ${qui.adresse} : type « ${LIBELLE_GENRE[genre]} ».`,
    })
  } else if (qui.tousInternes) {
    candidatsType.push({
      valeur: TYPE_PAR_GENRE.interne,
      poids: CONFIANCE_CORRESPONDANT,
      raison: 'Tous les participants sont des adresses de l’agence : type « interne ».',
    })
  } else {
    candidatsType.push(...reconnaitreDomaine(domaineDe(qui.adresse)))
  }
  const typeEchange = trancherAxe(candidatsType, 'type d’échange', raisons)

  // --- axe 3 : l'importance ---
  const candidatsImportance = reconnaitre(LEXIQUE_IMPORTANCE, objet, complet)
  if (ADRESSES_AUTOMATIQUES.test(normaliserAdresse(indices.expediteur))) {
    candidatsImportance.push({
      valeur: 'information',
      poids: 0.6,
      raison: 'L’expéditeur est une adresse automatique (« ne pas répondre ») : importance « information ».',
    })
  }
  const importance = trancherAxe(candidatsImportance, 'importance', raisons)

  const decides = [phase, typeEchange, importance].filter((a) => a.valeur !== null)
  const confiance =
    decides.length === 0
      ? 0
      : Math.min(decides.reduce((s, a) => s + a.confiance, 0) / decides.length, CONFIANCE_MAX)

  return {
    phase: phase.valeur,
    typeEchange: typeEchange.valeur,
    importance: importance.valeur,
    confiance: Math.round(confiance * 100) / 100,
    raisons,
  }
}
