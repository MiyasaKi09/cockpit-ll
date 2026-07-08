# Cockpit L&L — intranet v2 « sans API », en local

Outil de pilotage de l'agence d'architecture L&L, conforme à l'architecture v2 :
**aucun appel API vers un modèle d'IA**. L'intranet est 100 % déterministe (calculs
de dates, seuils, barème MIQCP, rapprochements) ; l'intelligence passe par Claude
*en tant que produit* — Projets, pré-prompts assemblés par le Cockpit, routines
programmées — avec un humain dans la boucle à chaque étape.

Cette version tourne **entièrement en local** : pas de Supabase, pas de Vercel,
pas de compte. Les données vivent dans le navigateur (localStorage) avec
export/import JSON pour la sauvegarde. Le jour où l'agence bascule sur
l'intranet hébergé (React + Supabase + Vercel), le modèle de données et les
règles ne changent pas.

## Lancer le site

```bash
npm install
npm run dev
```

puis ouvrir http://localhost:5173. (Build de production : `npm run build`,
servi depuis `dist/` par `npm run preview`.)

Au premier lancement, le Cockpit est pré-rempli avec les données d'exemple de
l'Excel maître (`Pilotage_Agence_LL.xlsx`) : projets P01/P02, échéancier de
factures, barème MIQCP actualisé BT01, obligations réglementaires. Tout ce qui
est marqué **EXEMPLE** est à écraser par vos vraies données.

## Ce qu'il y a dedans

| Module | Contenu |
|---|---|
| **Cockpit** | Météo financière + boîte **« À traiter »** (courriers triés par la routine mail, situations, consultations, factures à émettre, CR en attente — filtrable par personne) + fil d'urgences en règles codées |
| **Recherche** | Les liens dans tous les sens : un matériau, une entreprise, un mot d'une note → tous les projets où ils apparaissent |
| **Bien démarrer** | Le parcours de prise en main en 1 h : 8 étapes cochables, puis un rituel quotidien en 3 gestes |
| **Espace projet** | Un hub par projet, à onglets : pilotage MIQCP (barème 1994 actualisé BT01, 27 critères), **DCE & CCTP** (le site lit les CCTP — PDF analysé dans le navigateur ou depuis le dossier Drive 04_PRO-DCE — en extrait les lots et les éléments d'ouvrage, et pose **chaque élément prévu au DCE sur le planning travaux avec une date**), **chantier & CR** (marchés, réunions, assistant CR avec **transcription audio dans le navigateur**), **ressources** (matériaux, artisans, liens rattachés), **journal** (notes datées + tags, export Markdown/Obsidian), **documents** (rangement réel dans le Drive local + suivi d'avancement), **factures & temps** (PDF et e-mail Gmail pré-rempli). Création guidée en 3 étapes : phases datées et **échéancier de facturation générés automatiquement** (modèles Public / Privé pro / Particulier) |
| **Situations de travaux** | Le « Secrétaire ++ » : import du JSON produit par la routine quotidienne situations@, délais contractuels de vérification calculés en dur, validation humaine, relances |
| **Honoraires & relances** | Échéancier de facturation par phase, alertes d'impayés, relances graduées (courtoise → ferme → mise en demeure), délai moyen de paiement par client |
| **Saisie des temps** | Grille hebdomadaire projets × phases, alerte de dérive contre le budget d'heures — calibre les futurs devis |
| **Veille AO & Go/No-Go** | Import des consultations filtrées par la routine hebdo, avis Go/No-Go, résultats tracés |
| **Base de références** | Les 35 ans de références structurées : carburant des candidatures |
| **Bibliothèque de prompts** | La pièce maîtresse : gabarits versionnés, assemblés avec les données de la base, copiés en un clic vers le bon Projet Claude |
| **Routines & imports** | Les prompts des routines Claude à configurer une fois + l'import universel de leurs retours JSON |
| **Classement** | Renommage selon la nomenclature de l'agence + pré-prompt batch hebdomadaire |
| **Matériaux & artisans** | Fiches en dur : décennales surveillées, liens FDES (INIES) |
| **Réglementaire & CRM** | Obligations de l'agence avec rappels, contacts avec prochaine action, **export .ics** des échéances vers Google Agenda |
| **Paramètres & données** | Import mensuel des totaux de l'Excel maître, export/import JSON, réglages |

## Le circuit « sans API » (et la logique de hook)

Le principe : **on ne colle plus jamais le contexte, seulement les résultats.**

1. **Une fois** : créer les Projets Claude (« CR de chantier », « Analyse AO »,
   « Secrétariat », « Matériauthèque ») avec leurs instructions permanentes, et
   les **routines programmées** avec les prompts fournis page *Routines* (accès
   Gmail/Drive/web, exécution à heure fixe).
2. **Au quotidien** :
   - les boutons d'action des fiches assemblent le pré-prompt complet (gabarit +
     montants, contacts, historique, dates) → presse-papier → coller dans le bon
     Projet Claude ;
   - les routines tournent seules et terminent leur réponse par un **bloc JSON
     au contrat du Cockpit** → coller dans *Routines → Import* (ou le module
     concerné) → les lignes arrivent **« à vérifier »**, jamais validées seules.
3. **Règle d'or** : Claude propose, l'humain valide. Tout ce qui est financier,
   contractuel ou sortant reste brouillon jusqu'à relecture.

Limites assumées : pas d'automatisation de fond hors routines planifiées, un
geste de copier-coller subsiste. À deux, c'est un avantage déguisé — chaque
sortie est relue.

## Données

- Stockage : `localStorage` du navigateur (clé `cockpit-ll-v1`). **Exportez
  régulièrement** (Paramètres → Exporter JSON).
- L'Excel de pilotage reste la **source maître** côté finances la première
  année : le Cockpit lit ses totaux par import mensuel (Paramètres), sans
  double saisie.
- Minimisation : ne coller dans Claude que le nécessaire (pas de données
  personnelles inutiles).

## Stack

React 18 + Vite + TypeScript, zéro backend, une seule dépendance runtime
au-delà de React : `xlsx` (lecture de l'Excel maître dans le navigateur).
Le code des règles métier est isolé et testable : `src/miqcp.ts` (barème),
`src/echeancier.ts` (génération automatique des factures et des dates de
phases), `src/alerts.ts` (fil d'urgences), `src/derive.ts` (dérivés
financiers), `src/importRoutines.ts` (contrats JSON des routines).

## CR de chantier (réunion de 1–2 h → CR au style de l'agence)

Onglet **Chantier & CR** de chaque projet : « Nouvelle réunion » ouvre
l'assistant en 4 étapes — capturer (enregistrement audio), **transcrire
dans le site** (Whisper open source via transformers.js : WebGPU/WASM,
gratuit, l'audio ne quitte jamais la machine ; modèle mis en cache après
le premier usage), générer (le bouton copie le prompt complet : contexte
projet + convoqués pré-remplis depuis les marchés + transcription →
Projet Claude « CR de chantier »), relire & diffuser. Un CR qui traîne
plus de 3 jours remonte dans le fil d'urgences.

## Mails, Drive, Agenda — les ponts sans API payante

- **Entrant (mails)** : la routine « tri du matin » range la boîte Gmail
  (libellés par projet, archivage du bruit, brouillons de réponse) ET
  produit un bloc JSON `courriers` : chaque mail actionnable arrive dans
  la boîte « À traiter », rattaché à son projet, avec l'action proposée
  et la personne concernée.
- **Sortant (mails)** : boutons « E-mail » (factures) et « Gmail »
  (relances) — le message part pré-rempli dans Gmail, l'envoi reste un
  clic humain après relecture.
- **Drive** : l'onglet Documents écrit réellement dans le dossier
  « Google Drive pour ordinateur » via l'API File System du navigateur
  (Chrome/Edge) : arborescence normalisée par projet, renommage
  automatique à la nomenclature, et lecture de l'état des dossiers pour
  situer l'avancement — sans API Google.
- **Agenda** : export `.ics` (Réglementaire & CRM) importable dans
  Google Agenda.
