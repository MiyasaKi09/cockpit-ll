# Plan de mise en œuvre — CDC « E-mails, tâches, temps et mémoire projet »

**Objet :** plan d'exécution du cahier des charges `docs/CDC_MAILS_TACHES_TEMPS.md` sur le Cockpit existant.
**Contexte :** agence de deux personnes, un poste chacune, application local-first synchronisée par un document unique.
**Principe directeur :** le CDC décrit un produit d'agence structurée. Le Cockpit est déjà un produit d'agence structurée sur d'autres domaines (finance, chantier, documents, veille). Le travail n'est pas de construire un outil, c'est de brancher trois domaines manquants sur un socle qui existe — et de lever trois verrous qui, tant qu'ils tiennent, rendent une partie du CDC non pas coûteuse mais impossible.

**Révision 2.** Cette version corrige cinq erreurs factuelles de la version 1, tranche la contradiction du critère 13, répare le graphe de dépendances, comble les sections du CDC qui n'avaient aucun livrable (§5.2, §8.1, §8.2, §8.7, §10.3, §12.1 pts 10-12, §12.2, §12.3 pts 5-8 et 10, §17, §19.1, §19.3, §20, §2 principe 10), chiffre chaque lot et le projet entier, et pose un calendrier. Les corrections sont signalées par **[corrigé]**, les ajouts par **[nouveau]**. Aucune analyse juste de la version 1 n'a été retirée.

**Révision 3.** Une seconde relecture critique a montré que la révision 2 reproduisait localement le défaut qu'elle corrigeait. Cette version, écrite après vérification directe dans le code de chaque point contesté : requalifie **M.2**, dont la prémisse était démentie par `src/modules/Temps.tsx:466-470` (la saisie une-personne / une-semaine est déjà la vue principale sur tous les écrans, la grille 6 semaines n'est qu'un onglet d'historique) ; borne le périmètre de **`test-adresses-en-dur.cjs`**, sans quoi le verrou du point de non-retour ne fermait pas ; corrige le recensement des tableaux (**7** JSX bruts, **1** dans le composant, **10** en HTML d'impression dont sept dans `src/pdf.ts` — la spécification de M.4 échouait à sa première exécution) ; rentre **A.4, A.5, A.6, B.1 et B.7** dans le graphe de dépendances, tranche la circularité **A.11 ↔ A.12** et déclare la dépendance de **B.10** à A.11 ; ramène la vague M à sa parallélisation réelle, **3,5 jours sur 6,5** ; et livre enfin les deux garde-fous que le plan invoquait sans les construire — l'outil de mesure de parité qui conditionne B.15 (**B.18**) et `test-conservation-totaux.cjs`, présenté comme le seul rempart de la marge et que personne n'écrivait (**B.5**). Elle écrit surtout la phrase qui manquait sur le critère 12 : le §22 énumère quinze critères après un « **si** », et y renoncer a une conséquence qu'il faut nommer. Total révisé : **224,5 jours** au lieu de 221.

---

## 1. Ce qui existe déjà

C'est la bonne nouvelle du dossier, et elle change le périmètre : une lecture rapide du CDC laisse croire à une refonte, alors que l'essentiel de la mécanique demandée est déjà écrite, éprouvée en production et souvent plus exigeante que ce que le texte réclame.

### 1.1 La doctrine du CDC est déjà tenue, et mieux qu'il ne le demande

Le §15 (« l'IA propose, ne valide pas ») et le critère 11 (« propositions acceptables, modifiables ou refusables ») ne sont pas des objectifs : ce sont des invariants déjà appliqués, et surtout **garantis structurellement**, pas par convention d'interface.

- **[corrigé]** Le périmètre OAuth Google est en lecture seule, mais les deux chemins n'ont pas le même périmètre et la version 1 les confondait. Le chemin **navigateur** (`src/google.ts:10`) porte `gmail.readonly` **et** `calendar.readonly`. Le chemin **serveur** (`supabase/functions/gmail-oauth/index.ts:20`) ne porte que `gmail.readonly openid email` : **le jeton qui alimente le cron n'a aucun accès au calendrier.** La conclusion sur la lecture seule tient dans les deux cas — l'application ne peut techniquement pas envoyer, supprimer ni déplacer un message, quel que soit le code écrit au-dessus, et le critère 14 est satisfait par construction et non par discipline. Mais la conséquence pratique n'est pas neutre : elle est traitée au §3.9 et corrige le livrable des suggestions d'agenda.
- Tout « envoi » ouvre un brouillon Gmail pré-rempli dans un onglet (`gmailComposeUrl` dans `src/util.ts:121-128`) : le clic « Envoyer » est fait par l'humain, dans Gmail, hors de l'application.
- L'ingestion serveur insère systématiquement `statut: 'a_valider'`, avec projet et catégorie seulement **proposés**. Les politiques RLS n'accordent aux comptes de l'agence que `select` et `update` (`grant select, update on table public.entrants to authenticated`, migration d'ingestion ligne 163) ; toute écriture machine passe par le `service_role`. La séparation « qui propose » / « qui valide » est portée par la base de données, pas par l'écran.
- Chaque proposition automatique porte une confiance de 0 à 1 et une liste de raisons en français (« Contient l'identifiant du projet P03 », « L'expéditeur @… correspond à … »), dépliables via « Voir pourquoi » (`src/modules/Documents.tsx:243, 326, 500`). Le classement est déterministe par lexique pondéré (`supabase/functions/gmail-ingestion/index.ts:44-107`), donc reproductible et auditable — ce qu'aucune proposition par modèle ne permettrait.
- L'assistant serveur (`api/assistant.js`) ne renvoie que du texte, traite les sources comme des données non fiables encodées en JSON (défense contre l'injection indirecte), impose la réponse « Pas trouvé dans les sources fournies. » à défaut, et affiche systématiquement la mention « brouillon — à vérifier » avec le nom du modèle.

### 1.2 Le socle Gmail serveur est réel et réutilisable tel quel

- Consentement Google « offline » complet : `state` anti-CSRF lié à un cookie `__Host`, lien d'initiation signé, vérification que le compte connecté est **exactement** le compte configuré (relecture de `userinfo` chez Google, pas un JWT décodé), refresh token stocké dans une table privée sans aucune politique RLS — donc inaccessible au navigateur.
- Scan planifié toutes les 10 minutes par `pg_cron` + `pg_net` + Vault, avec en-tête `x-cron-secret` lu en base et jamais inscrit dans `cron.job`. Cela fonctionne onglet fermé.
- Traitement du cas `invalid_grant` : effacement du refresh token et message « Reconnexion requise » remonté dans l'interface.
- Décodage MIME complet, extraction des parties `text/plain` et `text/html`, décodage base64url, lecture d'en-têtes insensible à la casse.
- Et surtout, dans `supabase/functions/veille-mails/index.ts:458-613` : une **lecture Gmail incrémentale éprouvée** — curseur `internalDate` persisté, pagination bornée, tri du plus ancien au plus récent pour n'avancer le curseur qu'après traitement. C'est exactement le moteur dont le §4.1 a besoin. Il existe, il tourne en production, il sert seulement à un autre usage.

### 1.3 Le patron relationnel de sortie existe déjà

Le dépôt n'a pas à inventer son chemin vers PostgreSQL : il l'a déjà parcouru une fois. Les tables `entrants`, `veille_signaux`, `veille_jobs`, `veille_collectes`, `veille_pages`, `veille_field_evidence`, `veille_documents` et `veille_observations` sont en production avec RLS par adresse, `GRANT` explicites, clés étrangères, index, buckets Storage privés et une RPC de file d'attente en `FOR UPDATE SKIP LOCKED`. Le client fait du `.select().eq().order().limit()` classique, hors document JSONB et hors verrou de révision.

L'idempotence y est déjà résolue de la bonne manière : index unique partiel `entrants_source_unq (source, source_id, piece_index)` et empreinte SHA-256 par pièce. C'est le modèle exact à recopier pour dédoublonner un index de messages sur `gmail_message_id`.

**[nouveau]** Et le patron « proposé / validé » y est déjà écrit, ce qui économise une conception entière : `veille_field_evidence` sépare la valeur, sa confiance et son `validation_status`, n'accorde à l'agence que `select, update` (lignes 690-691) et réserve l'`insert` au `service_role`. Le §15 se recopie ; il ne se réinvente pas.

### 1.4 Le registre documentaire dépasse le MVP du CDC

Le §7 est le domaine le plus avancé du dépôt. `DocumentRecord` porte la source (gmail / drive / dépôt / généré / plateforme), l'identifiant et l'URL de source, le chemin de rangement, le projet, la catégorie, la version avec `remplaceDocumentId`, neuf statuts, l'empreinte SHA-256, la confiance, les raisons, et un journal d'événements typé `{date, type, detail, auteur}`.

S'y ajoutent : arborescence projet normalisée en onze dossiers avec correspondance catégorie → sous-dossier (`src/fsdrive.ts:37-41`), boîte d'arrivée `_A_CLASSER`, nomenclature automatique `AAAAMMJJ_PROJET_TYPE_objet(_vNN)`, dédoublonnage par empreinte à trois niveaux, écriture qui n'écrase jamais (contenu différent sous le même nom → suffixe `_v02`), chaîne de versions métier, et revue séquentielle au clavier (Entrée = classer, → suivant, ← précédent, E = écarter — `src/modules/Documents.tsx:341, 479-481, 564`). Cette ergonomie de revue est un actif : elle se remonte telle quelle sur les propositions de tâches (§8.7).

### 1.5 Le pilotage du §11 est très largement livré

C'est le domaine où le CDC a le plus de retard sur le code. Existent et fonctionnent : temps prévu / consommé / restant par projet **et par phase**, reste à faire révisable phase par phase, alerte de dérive d'heures à seuil paramétrable, barème MIQCP actualisé, coût interne **réel** déduit de la rémunération chargée de chaque personne (plus aucun forfait), marge à date distinguée de la marge finale prévisionnelle, dérive de marge, € par jour réel comparé à l'objectif, rentabilité par client, ROI des appels d'offres, plan de charge par personne et par semaine avec congés déduits (`chargePlanifieeSemaine`, `capacitePersonneSemaine`, `heuresAbsenceSemaine` dans `src/derive.ts:290-325`), comparaison de deux périodes de même durée avec écart signé, et revue de pilotage imprimable en PDF.

La doctrine financière y est explicite et défendable : cinq états des coûts externes jamais confondus, production estimée jamais présentée comme une écriture comptable, budget non daté jamais compté comme un coût.

### 1.6 Les autres acquis directement réutilisables

- **Migration d'état versionnée et sans perte** : `STATE_VERSION = 16` (`src/seed.ts:10`), une fonction `migrate()` (`src/store.tsx:44`) qui rejoue seize paliers successifs, normalise toute collection absente et repersiste immédiatement. Toute source — locale, distante ou importée — repasse par `migrate()`. Ajouter une collection suit un rail balisé.
- **Fusion additive et cloisonnement** : `COLLECTIONS_ADDITIVES` empêche une version ancienne d'effacer une collection qu'elle ignore ; `etatPartageable()` retire les réglages machine et les documents privés avant chaque écriture ; `cibleSynchronisation()` interdit de rejouer une file préparée pour un projet Supabase sur un autre.
- **Mode hors ligne complet — sur les données** : marqueur « en attente » persistant, marqueur de conflit survivant au rechargement, sauvegarde datée d'un document illisible, reprise automatique sur l'événement `online` (`src/store.tsx:726`), file d'envoi sérialisée avec réarmement après échec. **[nouveau]** Contrepartie à ne pas taire : le hors-ligne porte sur les **données**, pas sur le **chargement**. Aucun service worker ni manifeste n'existe dans le dépôt (`public/` ne contient que `corpus/` et `fonts/`) ; un onglet ouvert sans réseau avec un cache navigateur évincé donne une page blanche. C'est l'objet du livrable M.1.
- **Centre d'actions unifié** dans le Cockpit : une file qui agrège situations à vérifier, consultations à étudier, factures à émettre, comptes-rendus à sortir, notes « à faire » et alertes, triée par gravité puis échéance (`trierAFaire`, `src/modules/Cockpit.tsx:161`), avec filtre par personne, horizon 7 jours et revue séquentielle « une décision à la fois ». **[corrigé]** La version 1 le qualifiait de « squelette » de la vue « Aujourd'hui » du §8.2. C'est en dessous de la réalité et cette sous-estimation a coûté un lot entier : sur les dix blocs du §8.1, **deux sont déjà rendus tels quels** (mails à traiter par `LigneCourrier` ; alertes projets par `alertesActives`, treize familles avec mise en sommeil), trois le sont partiellement, **trois sont calculés et jamais affichés au Cockpit** (`chargePlanifieeSemaine`, `tempsParPersonne`, `actionsATraiter`) et **deux seulement n'existent nulle part** (tâches du jour, chrono). Ce n'est pas un squelette : c'est un bâtiment auquel il manque quatre branchements. Le livrable 0.11 les fait.
- **[nouveau] L'application est déjà responsive, et le plan l'ignorait.** Meta viewport (`index.html:5`), tiroir de navigation et barre supérieure sous 880 px (`src/App.tsx:248`, `src/styles.css:1025-1039`), tableaux transformés en cartes empilées sous 700 px avec libellés injectés (`src/styles.css:1101`, composant `Table` de `src/ui.tsx:982`), onglets défilants au doigt, modales plein écran, calendrier replié en liste, cibles tactiles et champs à 16 px sous `@media (pointer: coarse)` (`src/styles.css:1217`), colonne figée (`.col-figee`, ligne 1009), safe-area iOS. **81 tableaux du dépôt passent par le composant `Table`** et héritent du repli en cartes. Le dépôt compte par ailleurs 18 balises `<table>` écrites à la main, qu'il faut distinguer en deux familles, faute de quoi tout test statique échoue dès sa première exécution : **sept sont du JSX affiché à l'écran**, une par module — Analyse, Planning (ligne 591), Prompts, Revue, Situations, Temps, VeilleAO — des matrices larges où le défilement horizontal est la bonne réponse ; **dix sont des chaînes HTML d'impression**, jamais montées dans le navigateur (`src/pdf.ts` en contient sept, `src/modules/Planning.tsx` trois, lignes 298, 520 et 814, à l'intérieur de gabarits `window.print()`) ; la dernière est dans `src/ui.tsx` (ligne 994), c'est le composant `Table` lui-même. Contrepartie honnête, à ne pas présenter comme un acquis : `.temps-mobile` et `.temps-desktop` sont **déclarés** dans `src/styles.css:1094, 1209-1210` et **posés par aucun fichier `.tsx`**. C'est une intention écrite jamais tenue, pas une fonctionnalité.
- **Journal d'audit financier exemplaire** : copie figée à l'émission avec empreinte SHA-256, numéro légal séquentiel, correction uniquement par avoir. Le §14.4 a déjà son modèle de référence dans le dépôt.
- **[corrigé] Sept scripts de test statiques en CI**, et non huit. Ils sont nommément `test-assistant`, `test-relais`, `test-edge-functions-security`, `test-mise-en-production`, `test-sync-state`, `test-facture-invariants` et `test-finance` (`package.json:15`). **Et l'un d'eux n'est pas statique** : `test:finance` fait installer un Chromium par Playwright dans la CI (`.github/workflows/ci.yml:58`). Il reste **six tests réellement statiques**. La correction n'est pas cosmétique : le §7.3 fondait son garde-fou principal sur ce décompte, et il faut savoir sur combien de marches on s'appuie.

### 1.7 Ce que cela change au périmètre

Sur les quinze critères d'acceptation du §22, deux sont déjà satisfaits structurellement (11 et 14), un l'est de fait (1), un l'est à une ligne de code près (10), et deux le sont pour l'essentiel côté données (15 pour le temps et les honoraires, 6 pour l'ossature). **Le vrai reste à faire tient en quatre domaines : l'index des messages, l'entité tâche, le chrono horodaté, et les trois axes de catégorisation du §5.2 sans lesquels les vues d'accueil du §8 n'ont pas de données à trier.** Tout le reste est du raccordement — mais le raccordement, chiffré au §4, représente à lui seul plus de la moitié du projet.

---

## 2. Les trois verrous

Trois prérequis bloquent des pans entiers du CDC. Ils ne sont pas de même nature : le premier est un achat, le deuxième est une notion absente du modèle, le troisième est une limite d'architecture. Aucun ne se contourne par du code appliqué ailleurs.

### 2.1 Premier verrou — le domaine et Google Workspace

**Ce qu'il bloque.** Sans nom de domaine vérifié et sans tenant Google Workspace, les §3.2 (adresse par projet), §3.4 (envoi depuis l'adresse projet), §3.5 (Cockpit pilote les paramètres Google), §12.1 points 2 à 5 (création du groupe, ajout des membres, autorisations d'envoi) et §12.2 (accès Drive à l'arrivée d'un membre) ne sont pas « à faire » : ils sont **impossibles**. Google Groups, les alias de domaine, l'Admin SDK et l'alias d'envoi auto-vérifié n'existent tout simplement pas sur des comptes `@gmail.com` personnels — Google exige alors un code de confirmation envoyé à l'adresse, ce qui interdit toute automatisation.

**Ce qu'il coûte aujourd'hui, en plus de bloquer.** L'argument décisif n'est pas le confort, c'est un défaut opérationnel présent. Le guide intégré (`src/modules/Parametres.tsx`) recommande une application OAuth de type « Externe » en mode Test. Dans ce mode, Google fait expirer les refresh tokens au bout de sept jours : **l'ingestion serveur s'arrête chaque semaine et réclame une reconnexion manuelle**. La seule alternative sans Workspace serait de publier l'application en Externe ; comme elle demande `gmail.readonly`, qui est un périmètre restreint, cela déclenche la vérification Google et une évaluation de sécurité CASA annuelle payante. Une application de type « Interne », qui n'est proposée que dans un projet Cloud rattaché à une organisation Workspace, supprime les deux d'un coup.

**Le coût.** Ordre de grandeur à confirmer au déploiement, comme le demande le §23 : domaine 10 à 15 € par an ; Google Workspace Business Standard environ 14 € par utilisateur et par mois hors taxes, soit environ 340 € par an pour deux licences. Business Starter est moins cher mais n'inclut pas le Drive partagé, que le §23 exige explicitement. S'y ajoute la migration d'identité : recréation des comptes, lien magique Supabase, RLS, nouveau consentement OAuth.

**Décision recommandée.** **Souscrire Business Standard sur un domaine au nom de l'agence, dès maintenant, mais ne rien faire dépendre de cette souscription avant la Phase 3.** C'est le seul arbitrage honnête : l'achat se justifie tout seul par la suppression de l'expiration hebdomadaire et de l'évaluation CASA, et il faut des semaines pour vérifier un domaine et migrer deux identités — autant commencer tôt. Mais tout le MVP est réalisable sur les comptes actuels, et le séquencer derrière un abonnement serait une erreur de planification.

**Corollaire immédiat, indépendant de l'achat.** Les deux adresses de l'agence apparaissent en dur à 23 endroits en SQL (16 dans la migration d'ingestion, 2 dans la migration workspace, 2 dans `schema.sql`, 3 dans le script d'opérations) et dans les constantes `AGENCE` de 5 Edge Functions, plus une variable d'environnement côté Vercel. `supabase/README.md` demande même de « conserver exactement la même liste » à la main. Une bascule de domaine faite dans cet état **verrouille l'agence hors de son propre outil** : authentification, ingestion planifiée et accès au bucket coupés d'un seul coup.

**[corrigé] L'ordre exact, que la version 1 laissait implicite et que le lot n'encodait pas.** La version 1 écrivait « le découplage doit être fait avant l'achat » et plaçait pourtant 0.2 (découplage) et 0.9 (achat, « à lancer maintenant ») dans le même lot sans ordre déclaré. La formulation était trop large et l'omission dangereuse. Ce qui est vrai et ce qui ne l'est pas :

- **Acheter le domaine et souscrire Workspace ne touche pas une ligne du dépôt.** Ces gestes peuvent et doivent commencer au jour 1 : ce sont eux qui prennent des semaines de calendrier.
- **Ce qui est interdit avant que 0.2 soit livré, c'est la bascule d'identité** — c'est-à-dire tout geste qui change l'adresse avec laquelle une associée se connecte, ou qui modifie la liste d'adresses lue par une politique RLS. C'est le livrable 3.2, et il porte désormais une dépendance dure et écrite : **3.2 ne peut pas démarrer tant que le test `scripts/test-adresses-en-dur.cjs` n'est pas vert en CI.**
- Autrement dit : l'achat est parallèle, le **point de non-retour** est séquencé. Cette distinction est encodée dans les lignes « Dépendances » du Lot 0 et du Lot 3.

### 2.2 Deuxième verrou — la notion d'utilisateur courant

**Ce qu'il bloque.** L'application ne sait pas qui est devant l'écran. Ce n'est pas une lacune d'interface, c'est une absence dans le modèle : une personne est une **chaîne de caractères** (`TempsEntry.personne`, `Projet.responsable`, `DocumentRecord.validePar` valent « Julien »), le type `Personne` (`src/types.ts:832-844`) ne porte ni e-mail ni rôle ni marqueur d'activité, et l'e-mail de la session Supabase — qui existe et est lisible — n'est utilisé que comme décoration dans deux écrans. `src/modules/Documents.tsx:156, 175, 692` va jusqu'à signer les validations avec `settings.personnes[0]` : le premier de la liste est réputé être tout le monde.

Sans sujet identifiable, il n'y a pas de « Mes tâches » (§8.3), pas d'unicité du chrono actif (§9.4), pas de validation par un tiers (§10.2), pas de journal d'audit nominatif (§14.4), et aucune RLS par utilisateur ne peut être écrite un jour. Le critère 6 est inatteignable et le critère 13 serait rempli d'identifiants de navigateur — car `workspace.updated_by` reçoit aujourd'hui `MON_ID` (`src/sync.ts:57, 591`), un UUID régénéré à chaque onglet.

**Ce qu'il coûte.** Peu, et c'est ce qui rend son absence coûteuse : quelques jours. Ajouter `email?: string` à `Personne`, publier la session de façon réactive (aujourd'hui `sync.ts` expose un singleton non observable — une connexion par lien magique ne re-rend aucun écran), écrire un `useMoi()` qui résout la session vers une `Personne`, et corriger `majPersonne` dans les Paramètres (`src/modules/Parametres.tsx:118-125`) pour qu'un renommage réécrive les références. Ce dernier point est un **bug latent** : renommer quelqu'un orpheline aujourd'hui, en silence, ses pointages, ses absences, ses affectations projet et tous les champs `pour`.

**Décision recommandée.** **Identité à deux étages, posée en Lot 0, avant toute autre écriture.** La session Supabase quand elle existe, sinon un choix « je suis X » mémorisé par poste dans `localStorage` — jamais dans `settings`, sinon il partirait dans le document partagé et les deux postes s'écraseraient mutuellement. À défaut des deux, `null`, et chaque écran conserve exactement son comportement actuel, donc aucune régression. Ce repli n'est pas une facilité : la synchronisation Supabase est optionnelle et revendiquée comme telle, et un Cockpit non synchronisé doit rester utilisable.

En cible, la clé de rattachement devient `personneId` et non plus le nom. La migration est du ressort de `migrate()`, qui a déjà franchi seize paliers — le rail existe.

### 2.3 Troisième verrou — le document JSONB unique

**Ce qu'il bloque.** Tout l'état applicatif vit dans `workspace.data jsonb`. **[corrigé]** `AppState` (`src/types.ts:1347-1406`) déclare **40 champs, dont 38 collections** — la version 1 disait 37, sur trois pages. Le document est mesuré à 50 Ko à l'amorce et projeté à environ 2,9 Mo à régime **sans le CDC**. La seule granularité d'écriture est le document entier. Trois murs sont franchis dès qu'on y verse ce que le CDC demande.

- **Le quota `localStorage`.** `persist()` sérialise tout l'état à chaque mutation dans `cockpit-ll-v1`. Le quota est d'environ 5 Mo par origine. Un index de messages le fait sauter dès la première année, et le code ne peut que le signaler proprement : le mode hors ligne s'effondre en premier. Avant même le quota, `structuredClone` puis `JSON.stringify` de l'état entier à chaque frappe rendraient l'interface inutilisable.
- **La charge Realtime.** `src/sync.ts` prévoit déjà le cas du « payload tronqué » et retombe sur un `tirerEtat()` complet — ce qui, à 18 Mo, signifie retélécharger 18 Mo à chaque notification.
- **Le verrou de révision global.** `enregistrer_workspace` n'écrit que si `w.revision = p_expected_revision`. Aujourd'hui les écritures sont rares et humaines, les collisions anecdotiques. Avec le CDC, chaque démarrage de chrono, chaque changement de statut de tâche et chaque message ingéré devient une révision. Et le conflit est **collant** : il pose un marqueur persistant, le callback Realtime refuse alors d'appliquer l'état distant, et la seule issue est « Récupérer la version partagée » — un geste explicite qui abandonne les modifications locales. Deux postes actifs entreraient en conflit permanent, arbitré par un geste destructeur. C'est la conséquence la plus grave de toute l'analyse.

**Ce que ça coûte de le lever, et ce que ça coûte de trop le lever.** Migrer les 38 collections en relationnel reviendrait à jeter `src/derive.ts`, `src/economie.ts` et `src/facture.ts` — toute la chaîne financière — pour un bénéfice nul : à régime ces collections pèsent 2,9 Mo au total. Ce serait l'usine que ce plan doit éviter. À l'inverse, ne rien sortir rend le CDC inapplicable.

**Décision recommandée.** **Ligne de partage par la nature de la croissance.** Ce qui croît avec le **temps** sort ; ce qui croît avec l'**activité** et reste borné à quelques milliers d'objets reste. Le détail entité par entité est tranché en §3.1.

**Corollaire non négociable.** Le patron relationnel existant (`entrants`, `veille_*`) est bon pour le schéma et **insuffisant pour le client** : `clientSupabase()` retourne `null` sans session, `listerEntrantsDistants()` renvoie alors `[]` (`src/entrants.ts:49-50`), et toutes les lectures de `src/veille.ts` échouent. Ces tables sont purement en ligne. Recopier ce patron tel quel pour les communications, le temps et les tâches supprimerait le hors-ligne exactement sur les trois entités les plus utilisées au quotidien — le chrono en déplacement, les tâches sur chantier. C'est le piège principal de la migration. Toute entité qui quitte le JSONB emporte donc avec elle un cache IndexedDB et une file d'écritures idempotentes.

---

## 3. Décisions d'architecture

### 3.1 Quelles entités quittent le document JSONB — décision entité par entité

**Sortent du JSONB, au MVP :**

| Entité | Pourquoi elle sort |
|---|---|
| `communications` (index des messages) | Poste volumétrique dominant : environ 937 octets par message mesuré sur un enregistrement §18 réaliste, soit 13 Mo par an à 60 messages par jour — contre 2,9 Mo pour **tout** le document actuel à régime. Table neuve, sans donnée à reprendre, sans code existant à casser. |
| `propositions` **[nouveau]** | Détections de tâches, échéances, décisions et risques (§12.3 pts 5-8). Croît avec les messages, donc avec le temps ; et surtout, c'est la seule façon de rendre le §15 **structurel** plutôt que conventionnel (voir §3.14). |
| `pointages` (entrées de temps horodatées) | Volume modeste en octets (environ 1,5 Mo par an) mais **400 fois** le nombre d'enregistrements du modèle hebdomadaire, et surtout une vingtaine d'écritures par jour et par personne, qui deviendraient autant de cycles compare-and-swap. C'est la fréquence, pas la taille, qui commande la sortie. |
| `chrono_actif` | Une ligne par personne, écrite aux seules transitions démarrer / pause / reprendre / arrêter. Mettre un chrono qui tique dans le document partagé le ferait battre à chaque seconde. |
| `journal_audit` | Un journal logé dans un document que l'utilisateur peut intégralement remplacer par `replace()` et exporter en JSON n'a **aucune valeur probante**. Il doit être en append-only côté serveur, insertion refusée aux comptes applicatifs, ou il ne sert à rien. |

**Restent dans le JSONB, y compris la nouveauté :**

| Entité | Pourquoi elle reste |
|---|---|
| Les 38 collections actuelles | Projets, phases, marchés, situations, factures, contrats, échéances, paiements, référentiels, prompts, réglages : elles croissent avec l'activité, restent bornées à quelques milliers d'objets, et la fusion additive, les seize paliers de `migrate()` et le hors-ligne y fonctionnent déjà très bien. |
| **`taches` (nouvelle collection)** | **Décision explicite, contre l'une des analyses.** Le volume est borné (une agence de deux personnes produit quelques centaines à quelques milliers de tâches par an, soit moins d'un mégaoctet) et la fréquence d'écriture reste **humaine** — quelques dizaines par jour au plus. **[corrigé]** L'argument reposait sur « 181 sites d'appel `update()` » au §3.1 contre « 189 » au §6 : le dépôt en compte **189** (`grep -roE "\bupdate\(" src`). Le chiffre exact **renforce** la conclusion au lieu de l'affaiblir : 189 sites d'appel humains coexistent aujourd'hui sans conflit observé, ce qui borne empiriquement le régime que le verrou compare-and-swap absorbe. Ce qui le tue, c'est le chrono qui tique et l'ingestion continue — des écritures **machine**, à la seconde ou à la minute — pas huit sites d'appel supplémentaires actionnés à la main. La conclusion tient : les tâches restent. En contrepartie, on gagne le hors-ligne immédiatement, sans écrire une ligne de couche IndexedDB, et on réutilise un rail de migration éprouvé. |
| `modelesTaches` **[nouveau]** | Gabarits écrits par l'agence, une dizaine d'objets, jamais écrits par une machine. Ils suivent `taches`. |
| `registreDocuments` | Fonctionne, est riche, et sa croissance reste absorbable au moins deux ans. Le sortir maintenant coûterait cher sans rien débloquer. |

**Seuils de sortie, à mesurer et non à deviner.** `taches` et `registreDocuments` sont conçues pour pouvoir sortir plus tard : identifiants stables, aucune donnée dérivée stockée, aucune dénormalisation. On les sort si l'un de ces seuils est franchi — document partagé au-delà de **3 Mo**, plus de **5 000 tâches**, ou arrivée d'un troisième collaborateur avec besoin réel de droits par projet. Un compteur de taille est déjà affiché à l'utilisateur ailleurs dans l'application (`Assistant.tsx` alerte au-delà de 2 M caractères de corpus) : le même geste s'applique.

### 3.2 Que devient le verrou compare-and-swap ?

**Décision : le conserver tel quel sur le JSONB résiduel, l'abandonner pour les tables relationnelles.**

Le compare-and-swap global est correct et bien implémenté ; son défaut n'est pas sa logique mais son **grain**. Une fois les écritures fréquentes sorties dans des tables où deux `insert` concurrents ne se gênent pas, le document résiduel ne reçoit plus que des écritures de configuration, de finance et de tâches — rares et humaines, exactement le régime pour lequel le verrou est dimensionné. Cela résout le conflit le plus grave **sans réécrire `sync.ts`**, et retire le marqueur de conflit collant du chemin quotidien.

### 3.3 Comment préserver le hors-ligne sur les entités sorties ?

**Décision : cache IndexedDB en lecture sur une fenêtre utile, plus une file d'écritures idempotentes.**

- Fenêtre de cache : messages, propositions et tâches des 90 derniers jours, pointages du mois courant. Au-delà, la consultation exige le réseau — c'est acceptable, personne ne relit un mail de l'an dernier en déplacement.
- IndexedDB est déjà utilisé dans le dépôt (`src/fsdrive.ts`, base `cockpit-ll-fs`) : la dépendance n'est pas nouvelle.
- Chaque écriture locale porte un **identifiant client généré côté navigateur**, sur le modèle de `MON_ID` dans `sync.ts`, qui sert de clé d'unicité serveur. Rejouer la file deux fois ne crée pas de doublon. Cela satisfait directement l'exigence §24 « actions idempotentes », et le patron d'index unique partiel de `entrants_source_unq` est déjà exactement cette mécanique — il se recopie.
- **[nouveau]** Le hors-ligne des données ne suffit pas si l'application ne se charge pas. La coquille applicative (manifeste + service worker, livrable M.1) est la condition qui rend vraie la phrase « les tâches sur chantier », sur laquelle le §3.1 appuie tout un arbitrage d'architecture. Sans elle, cet argument est faux le jour où on le teste.

### 3.4 Que devient la feuille de temps hebdomadaire ?

C'est la décision la plus délicate du plan, parce que toute la chaîne financière en dépend : `heuresReelles`, `coutReelTemps`, `analyserPeriode`, `tempsParPersonne`, la marge, le coût horaire réel, la comparaison prévu / réel du §11.3 et la revue PDF lisent tous `state.temps`, filtré sur le champ `semaine` (`TempsEntry`, `src/types.ts:792-800`, qui ne porte **que** la semaine — le grain journalier est structurellement impossible avant `pointages`).

**Décision : le pointage horodaté devient la source de vérité unique ; la grille hebdomadaire `state.temps` devient une projection dérivée, recalculée à chaque écriture de pointage, et reste le mode de saisie rapide.**

Concrètement :
- Écrire un pointage (chrono arrêté, ou saisie manuelle) écrit dans la table `pointages` **et** met à jour la cellule hebdomadaire correspondante dans `state.temps`.
- Saisir une cellule à la main dans la grille existante crée un pointage synthétique — journée entière, sans heure précise, `source: 'saisie_hebdo'`.
- `state.temps` conserve **exactement** sa forme actuelle. `src/derive.ts` n'est pas touché. La chaîne financière ne change pas d'une ligne.
- **[nouveau] Une seconde projection est nécessaire, et la version 1 l'avait oubliée.** Un pointage portant un `tacheId` doit aussi mettre à jour `Tache.tempsEnregistre` : le §8.5 le prévoit, le pt 8 du §19.3 dit « la tâche est mise à jour », et le critère 8 exige que le temps soit rattaché « à un projet **ou à une tâche** ». Sans elle, arrêter un chrono démarré depuis une tâche laisse la tâche inchangée. C'est le livrable B.9, et il est verrouillé par le même test de conservation des totaux que la projection hebdomadaire.

Pourquoi ce montage plutôt que « faire lire les deux sources aux dérivés », proposé par une des analyses : parce que `derive.ts` est synchrone et travaille sur `AppState`, alors que les pointages vivent dans une table relationnelle qui n'est pas disponible hors ligne de façon synchrone. Faire lire deux sources à `heuresReelles` créerait deux vérités qui divergeraient en silence sur la marge. La projection résout le problème sans arbitrage permanent : il n'y a qu'une source, et une vue matérialisée dans le document.

Corollaire : la grille cesse d'être **destructive**. Aujourd'hui vider une cellule supprime l'entrée et modifier une valeur l'écrase sans trace, ce qui rend le §9.6 (« toute correction importante doit être historisée ») inapplicable. Avec les pointages, la correction devient un événement daté et attribué.

**[nouveau] Un seul estimateur de temps non enregistré.** Le §8.2 (« temps restant estimé », lu en journée) et le §12.4 (« temps non enregistré estimé », lu le soir) demandent la même soustraction : capacité du jour (`settings.heuresParJour`, congés déduits via `heuresAbsenceSemaine`) moins la somme des pointages du jour. Une fonction unique `tempsNonEnregistre(state, personne, jour)`, deux consommateurs, deux formulations. Deux implémentations divergeraient en silence — exactement le défaut que ce paragraphe refuse pour la marge. Et l'estimation reste affichée comme telle : **jamais un pointage écrit d'office**, sinon la doctrine du §15 tombe sur le poste de coût le plus sensible du produit.

### 3.5 Où stocke-t-on le chrono en cours ?

**Décision : table dédiée `chrono_actif` (une ligne par personne, contrainte d'unicité en base), avec repli `localStorage` quand la synchronisation est inactive.**

Deux analyses divergeaient : l'une proposait `localStorage` seul au MVP, l'autre une table dès le départ. Je tranche pour la table, pour deux raisons. D'abord, une fois la table `pointages` créée, le coût marginal d'une table à une ligne par personne est nul. Ensuite, `localStorage` seul survit au rechargement mais **pas au changement de poste**, et l'unicité « un seul chrono actif par utilisateur » du §9.4 ne se garantit pas côté client — elle se garantit par une contrainte d'unicité, ou pas du tout. Le repli local préserve le local-first.

Le chrono n'écrit **jamais** via `update()` : chaque appel réécrit et repousse le document complet.

**[nouveau] Où le chrono s'affiche-t-il ?** Le §9.2 exige qu'il reste visible dans toute l'application. La version 1 écrivait « affichage permanent en barre supérieure » : **il n'y a pas de barre supérieure au bureau.** La `.topbar` n'est rendue qu'en dessous de 880 px (`src/styles.css:1025`, `src/App.tsx:248`). Deux emplacements, donc, parce que la mise en page en a deux : dans la `.topbar` au téléphone, en tête de la barre latérale au poste. Un seul composant monté à deux endroits, jamais dupliqué.

### 3.6 Quel moteur de synchronisation Gmail ?

**Décision : réutiliser le curseur `internalDate` de `veille-mails` pour le MVP, `users.history.list` en Phase 2.**

Le code existe, il est testé, il gère déjà pagination bornée, tri chronologique et reprise. La requête actuelle de `gmail-ingestion` — `in:inbox has:attachment newer_than:7d` avec `maxResults=25` — est une fenêtre fixe : un pic de courrier fait perdre des messages en silence, et les suppressions ou changements de libellés ne sont jamais vus. `history.list` coûte 2 unités de quota contre 5 et donne les modifications, pas seulement les ajouts ; c'est mieux, mais c'est une réécriture, pas une réutilisation. On garde le gain immédiat au MVP.

Le quota n'est pas la contrainte : une reprise d'historique de 25 000 messages coûte 125 000 unités, soit 0,0125 % du plafond quotidien. Les contraintes réelles sont le plafond de 250 unités par seconde et par utilisateur, et le temps d'exécution d'une Edge Function — donc une reprise découpée en passages successifs du cron.

Autre décision liée : **capter les métadonnées dès maintenant**, avec `format=metadata` et des `metadataHeaders` ciblés (To, Cc, Message-ID, In-Reply-To, References). Cela coûte les mêmes 5 unités que `format=full` pour une réponse 10 à 50 fois plus légère. Sans `threadId` capté à l'ingestion, le bouton « Ouvrir dans Gmail » du §4.2 est infaisable a posteriori — et **le bloc « mails nécessitant une réponse » du §8.2 l'est aussi** : il se définit comme « dernier message du fil entrant, sans message sortant postérieur dans le même fil », ce qu'aucun traitement a posteriori ne reconstruit.

### 3.7 Sur quoi rattache-t-on un message à un projet, faute d'adresse projet ?

**Décision : cascade déterministe avec confiance et raisons affichées, IA en dessous du seuil seulement, et mémorisation de chaque correction humaine comme règle réutilisable.**

Cascade, du signal le plus fort au plus faible : fil de discussion déjà rattaché → adresse d'un participant déclaré (`Projet.emailMOA`, `Contact.email`, `MarcheTravaux.contactEmail`) → domaine de l'expéditeur rapproché de `Entreprise.domaines` → identifiant ou nom de projet dans l'objet.

Le fil est le signal le plus fort une fois `threadId` capté : un seul rattachement humain propage tout le fil. Et la mémorisation des corrections est le critère 5 du §5.1, aujourd'hui totalement absent — c'est aussi le mécanisme qui rend le système meilleur avec l'usage sans jamais donner la main à un modèle.

Corollaire : les **trois moteurs de rattachement divergents** actuels (`classer()` serveur, `devinerProjet()` navigateur, `rapprocherProjet()` import) doivent converger vers une seule implémentation, sinon la même question reçoit trois réponses différentes selon le chemin d'entrée.

### 3.8 Où appelle-t-on l'IA pour les résumés ?

**Décision : nouvelle Edge Function dédiée avec son propre secret Supabase, sa propre limitation de débit, et le même garde-fou « brouillon à relire ».**

`api/assistant.js` n'est **pas** appelable depuis un cron : il exige un JWT Supabase d'un utilisateur de la liste blanche et limite à 10 requêtes par minute et par utilisateur. Cette vérification est précisément ce qui empêche aujourd'hui l'exposition de la clé Anthropic — l'ouvrir à un appel machine serait défaire la seule protection de la clé.

Périmètre et coût : **tout indexer en métadonnées, ne résumer que les messages rattachés à un projet**. Le résumé est le seul poste de coût variable — environ 20 € par mois en régime permanent sur 120 messages par jour, moins de 10 € en filtrant sur les messages rattachés. La reprise d'historique passe par la Batch API, qui n'est pas sensible à la latence et coûte moitié moins.

**[corrigé] Le libellé de ce livrable était trop large.** La version 1 étiquetait A.6 « §5.3, §12.3 » alors qu'il ne livre **que le résumé** : les points 5 à 8 du §12.3 (détecter tâches, échéances, décisions, risques) n'étaient chiffrés nulle part. A.6 est réétiqueté « §5.3 seul » et les détections font l'objet de livrables propres (A.9, A.10).

### 3.9 Google Drive ou Drive local ?

**Décision : découpler d'abord, trancher ensuite. Conserver le File System Access API au MVP.**

`DocumentRecord` porte déjà `source`, `sourceId`, `sourceUrl` et `cheminDrive` : il suffit d'ajouter `driveFileId`, `phase` et `auteur` pour que le registre devienne **agnostique du lieu de stockage**. Cela livre la double traçabilité du §7.3 immédiatement.

Basculer sur l'API Drive avant d'avoir Workspace ferait payer le coût OAuth et la vérification Google **sans gagner** ni le Drive partagé ni les droits par projet, qui sont les seules vraies raisons de basculer. La couche `src/fsdrive.ts` est une abstraction propre avec seulement sept sites d'appel : le remplacement restera contenu le jour venu.

**[nouveau] Limite à documenter, pas à réparer.** `supporteFS = 'showDirectoryPicker' in window` (`src/fsdrive.ts:27`) est faux sur Safari iOS et Firefox Android. Les onglets Documents, DCE et le rangement des photos **resteront des écrans de poste**, sur téléphone comme sur tablette Apple. C'est acceptable pour une agence de deux personnes qui range ses fichiers au bureau ; ce n'est pas acceptable de le découvrir sur un chantier. Une page de documentation le dit noir sur blanc (livrable 2.16).

**[corrigé] Conséquence sur les suggestions d'agenda.** La version 1 justifiait ce livrable par « la lecture des événements existe déjà ». C'est vrai **du navigateur seulement** : `calendar.readonly` est dans `src/google.ts:10` et **pas** dans le jeton serveur (`gmail-oauth/index.ts:20`, `gmail.readonly openid email`). Le cron ne peut donc pas préparer de suggestions de saisie ; elles ne peuvent naître que d'un onglet ouvert, ou d'un second consentement élargissant le périmètre serveur. Le livrable 3.6 est réécrit en conséquence et passe de 3 à 3 jours d'un contenu différent : suggestions calculées côté navigateur à l'ouverture de l'écran Temps, jamais par le cron. Élargir le périmètre serveur au calendrier est écarté au §6.

### 3.10 Quel format de code projet ?

**Décision : double clé. `id` interne inchangé (`P01`), plus un `codeExterne` (`2026-034`) et une `adresseProjet` portés par le projet.**

Renommer les identifiants casserait les liens, les journaux et `entrants.projet_id_propose` déjà en base. Surtout, un identifiant à deux caractères comme adresse ferait exploser les faux positifs du rattachement par texte. Ajouter deux champs ne coûte presque rien et peut être fait dès maintenant, sans Workspace.

**[corrigé]** La liste des champs neufs du livrable 0.7 oubliait `Projet.calendarId`, que le §18 exige explicitement (`calendar_id`). Il part avec les autres, à coût marginal nul.

### 3.11 Combien de statuts de tâche ?

**Décision : stocker les neuf statuts du §8.6 dès le premier jour, n'en exposer que cinq au MVP** (À faire, En cours, En attente, Terminée, Annulée).

Le type est le point difficile à migrer ensuite — badges, filtres, tables de correspondance avec les cinq vocabulaires de statut déjà existants dans le dépôt. Le menu déroulant, lui, s'élargit sans migration.

Décision liée : `TacheChantier` **n'est pas** la tâche du CDC et ne doit pas être étendue. C'est un jalon de planning travaux, régénéré et supprimé **en masse** par l'onglet DCE (`src/modules/ProjetDCE.tsx:1164`, `filter(t => t.lotDceId !== lot.id)`) — y loger des tâches personnelles détruirait temps saisi et commentaires au premier « Replanifier ». La nouvelle entité s'appelle `TacheInterne` pour éviter la collision de vocabulaire, et peut référencer un jalon de chantier sans se confondre avec lui.

**[nouveau] Autre collision de vocabulaire à éviter.** `src/routines.ts` et `src/modules/Routines.tsx` ne sont **pas** des modèles de tâches : ce sont les routines Claude programmées et leurs contrats d'import JSON. Les « modèles de tâches » du §12.1 pt 10 sont une collection distincte, `modelesTaches` (livrable B.13).

### 3.12 Que devient le `Courrier` existant ?

**Décision : le `Courrier` cède l'action à la tâche et devient une vue « à traiter » sur la table `communications` — mais en deux temps, et pas en un seul.**

Aujourd'hui `Courrier` a un statut `a_traiter` / `traite` (`src/types.ts:125`) ; une fois traité il disparaît et n'est plus consultable par projet. C'est une boîte de réception, pas une mémoire projet — l'inverse de ce que demandent le §4.3 et le critère 2. Le garder actionnable **en parallèle** des tâches ferait traiter le même message à deux endroits.

La conversion automatique d'un courrier en tâche est à exclure : elle viderait de son sens la validation humaine du §8.7 et du critère 11. Le bouton « Créer une tâche » produit une tâche avec `source: {type: 'mail', id}` — c'est un geste, pas un automatisme.

**[corrigé] La version 1 faisait ce mouvement en un seul livrable de vague A, ce qui garantissait une régression.** `LigneCourrier` (`src/modules/Cockpit.tsx:203-292`) est le seul point d'entrée quotidien de l'agence, et l'ancien A.7 retirait d'un coup deux choses dont les remplaçants sont en vague B : l'action « ✓ Fait » (remplacée par « Créer une tâche », B.3) et le chemin d'ingestion navigateur (`src/surveillance.ts:88-96`), qui est ce qui **alimente** `state.courriers`. Couper l'alimentation avant que le cron serveur soit prouvé en production ne casse pas la file : **elle la vide en silence**, ce qui est pire, parce que rien ne signale l'anomalie. Le mouvement est donc scindé :

1. **A.7 (vague A) — bascule de source, actions strictement inchangées.** `LigneCourrier` lit la couche d'accès A.3 au lieu de `state.courriers`, et **garde ses trois boutons à l'identique** : « Répondre » (brouillon Gmail), « → Journal », « ✓ Fait ». Le marqueur de traitement migre de `Courrier.statut` vers `communications.traite_le` / `traite_par` — donc nominatif, donc journalisable, ce que `Courrier` ne permet pas. Les deux sources sont **fusionnées à l'affichage** tant qu'il reste des `Courrier` en `a_traiter` non réglés : aucun mail en cours ne disparaît le jour de la bascule. Le tri actuel (urgence décroissante puis date) et le badge « projet ? » quand `projetId` est nul sont conservés — ils sont déjà la file « à rattacher » du §5.1.
2. **B.15 (fin de vague B) — retrait du statut et coupure du chemin navigateur.** « ✓ Fait » cède la place à « Créer une tâche » ; `surveillance.ts` cesse d'écrire dans `state.courriers` ; `state.courriers` passe en lecture seule, reste dans l'état et dans l'export JSON, et sort du chemin quotidien. **Condition de déclenchement non négociable, à inscrire au critère de fin de la vague : sept jours consécutifs en production sans écart entre les deux mémoires.** La surveillance Agenda n'est pas touchée — elle alimente le bloc « réunions du jour ».

### 3.13 Le contrat des modules

`docs/CONTRAT_MODULES.md` interdit de modifier les fichiers partagés (`types.ts`, `store.tsx`, `App.tsx`, `derive.ts`, `alerts.ts`…) et pose « AUCUN appel API vers un modèle d'IA ». Il est **factuellement caduc** sur le second point — `api/assistant.js` existe et appelle l'API Anthropic — et il interdit littéralement ce que le CDC exige sur le premier.

**Décision : le réviser en Lot 0, avant toute ligne de code.** Continuer à coder « au contrat » produirait des statuts dupliqués module par module et des contournements locaux — précisément la dette que ce chantier doit éviter. La révision conserve l'esprit (un module = un fichier, l'humain valide, tout est traçable) et lève les deux interdits devenus faux.

**[nouveau] Deux règles à y ajouter, parce qu'elles sont déjà la doctrine mais ne sont opposables nulle part.**
- *Tout tableau passe par le composant `Table`* (`src/ui.tsx:982`). Le contrat le dit déjà (ligne 31), rien ne le vérifie : c'est ainsi que 7 `<table>` bruts ont échappé au repli mobile. Test statique M.4.
- *L'accueil n'invente aucun calcul.* Il agrège `alerts.ts`, `derive.ts`, `financeActions.ts` et les événements du calendrier ; toute règle métier neuve vit dans son module de domaine et remonte à l'accueil, jamais l'inverse. C'est déjà écrit en tête de `Cockpit.tsx` (« tout est dérivé de l'état »), et c'est déjà contourné : `itemsAFaire` (`Cockpit.tsx:117-128`) et `actionsATraiter` (`financeActions.ts:27-36`) **recalculent tous deux, à partir des mêmes `echeancesFacturation`, la même liste de factures à émettre** — deux boucles, deux libellés construits séparément, deux liens, une seule vérité. Les deux gravités coïncident aujourd'hui (3 de part et d'autre) : c'est une coïncidence entretenue à la main, pas un invariant, et rien ne signalera le jour où l'une des deux bougera. Le livrable 0.11 supprime le doublon en faisant lire `actionsATraiter` à l'accueil.

### 3.14 **[nouveau]** Les trois axes du §5.2 et la garantie structurelle du §15

Le §5.2 demande de classer chaque échange selon trois axes : la phase du projet (14 valeurs), le type d'échange (15 valeurs), le niveau d'importance (6 valeurs). Aucun n'existait au plan, alors que §8.1 (« mails à traiter »), §8.2 (« urgent ») et §13.1 (recherche par phase) en dépendent entièrement.

**Décision 1 — ne pas étendre `PhaseCode`.** `PhaseCode` (`src/types.ts:12-13`, dix valeurs) est porteur de la chaîne d'honoraires : `REPARTITION_PHASES` et `PHASES_ORDRE` (`src/miqcp.ts:123-136`), les répartitions de `src/echeancier.ts`, la correspondance dossier ↔ phases (`src/fsdrive.ts:37-41`) et tous les projets de `src/seed.ts` en dépendent. Y ajouter quatre valeurs sans montant ni pourcentage de mission ferait entrer des phases fantômes dans l'échéancier. On crée un type **séparé** `PhaseEchange`, superset des dix `PhaseCode` plus PROSPECTION, CONCOURS, DOE et SAV. Deux divergences déclarées et assumées : la « Faisabilité » du CDC est le `DIAG` du dépôt (déjà libellé « Diagnostic ») ; « DCE » et « ACT » du CDC sont le seul `ACT-DCE` du dépôt, qui les facture ensemble — l'axe offre les deux libellés, la valeur stockée est unique. `MC` reste, sans équivalent CDC.

**Décision 2 — la séparation proposé / validé est portée par le schéma, pas par l'écran.** Chaque axe existe en deux colonnes : `phase_proposee` (machine) et `phase` (humain), la valeur effective étant exposée par une colonne générée `phase_effective` pour qu'aucun écran ne réimplémente la règle. Le GRANT est **au niveau colonne** — `grant update (phase, type_echange, importance, …) on communications to authenticated` — et un trigger `before update` refuse toute écriture d'une colonne `*_propos*` hors `service_role`. Résultat : la machine ne **peut pas** écrire un axe validé ; l'humain **peut toujours** corriger, comme le §5.1 l'exige. Deux exigences opposées deviennent deux GRANTs distincts, vérifiables par un test statique — et non deux comportements d'interface qu'un module peut contourner. Le patron est recopié de `veille_field_evidence` (migration d'ingestion, lignes 620-691), il n'est pas inventé.

**Décision 3 — une seule table `propositions`, à quatre genres.** Les points 5 à 8 du §12.3 (tâches, échéances, décisions, risques) ne prennent pas quatre tables mais une, avec un `genre`, une `charge_utile jsonb` typée par genre, l'**extrait cité** du message qui porte la détection (§13.3 et §4.2 : un lien ne suffit pas, il faut la phrase), une confiance, des raisons françaises, et un `statut` dont le domaine ne contient **aucun statut métier** — ni « confirmee », ni « valide », ni « contestee », seulement `proposee` / `acceptee` / `ignoree`. Par construction du type énuméré, une proposition ne peut pas devenir une décision ni une tâche : elle ne peut que **désigner** l'objet que l'humain a créé (`objet_cree_type`, `objet_cree_id`). C'est le verrou que la version 1 prévoyait en 2.2 pour la seule décision, rendu générique et avancé au MVP. L'`insert` est réservé au `service_role`.

Bénéfice de séquencement : les quatre genres sont **détectés** dès le MVP même si deux n'ont pas encore d'entité de destination (`decisions` = 2.1, risques = 2.3). La proposition reste lisible et ignorable, elle n'est pas perdue, et rien n'est promu sans destination. C'est ce qui permet de tenir les points 5 à 8 du §12.3 au MVP sans avancer 2.1 ni 2.3.

**Décision 4 — une échéance proposée n'écrit jamais une échéance juridique.** L'acceptation d'une proposition `genre='echeance'` renseigne `TacheInterne.echeance` ou `Contact.dateProchaineAction`, et rien d'autre. Elle ne crée jamais d'`Obligation` — qui déclenche le rappel réglementaire de gravité 3 (`src/alerts.ts:151-168`) — ni d'`EcheanceFacturation`, qui commande l'émission de facture. Le §15 interdit « créer une échéance juridique sans confirmation » : ces deux entités-là **sont** des échéances juridiques et financières. Garantie structurelle : `charge_utile->>'cible'` sous CHECK `in ('tache','contact')`. Le chemin n'existe pas, même par bug applicatif.

**Décision 5 — aucun modèle n'est appelé pour la catégorisation.** Le classifieur des trois axes est déterministe, par extension de `classer()` (`gmail-ingestion/index.ts:44-107`), qui produit déjà catégorie + projet + confiance + raisons françaises depuis un lexique pondéré, plafond 0,95. On passe d'un axe à quatre en gardant sa forme exacte. Repli explicite sous le seuil : l'axe reste vide, avec la raison déjà en production « Aucun mot du lexique reconnu — à choisir ». La détection des tâches et échéances, elle, a deux étages : déterministe hors ligne d'abord (marqueurs d'action de `src/tagging.ts:77`, dates françaises résolues relativement à la date d'envoi), modèle ensuite, dans la même réponse que le résumé.

**Point dur à ne pas manquer sur les risques.** Cinq des neuf natures du §6.3 sont **déjà produites** par `computeAlertes` (`src/alerts.ts`) : retard potentiel et échéance imminente par `echeance_rendu` et `obligation`, budget dépassé par `derive_heures`, absence de validation par `situation_a_verifier`, dépendance à un tiers par `situation_manquante`. Les redétecter depuis les mails doublerait chaque risque dans la fiche projet. Les détecteurs de mails se limitent donc aux quatre natures que le moteur d'alertes **ne peut pas** voir : demande contradictoire, modification de programme, réserve technique, responsabilité non attribuée.

### 3.15 **[nouveau]** Comment notifie-t-on les personnes concernées (§12.3 pt 10) ?

**Décision : ne construire aucun mécanisme de notification. Étendre celui qui existe et ne porte pas ce nom.**

Le dépôt a déjà tout sauf le destinataire : `computeAlertes()` / `alertesActives()` (`src/alerts.ts`, treize types, gravité 1-3, identifiant stable servant de clé, lien vers la source, action rapide `ActionAlerte`), la mise en sommeil par `settings.snoozes` (`src/types.ts:1174`) avec son écran de réglage, le centre d'actions filtré par personne (`ItemAFaire.pour`), le badge de comptage (`src/App.tsx:105`) et le journal de surveillance persistant.

Manquent exactement trois choses : `Alerte.pour?` et `Alerte.projetId?` (aujourd'hui `src/types.ts:1093-1106` n'a ni l'un ni l'autre) ; trois producteurs ajoutés à `TypeAlerte` (`mail_a_traiter`, `reponse_attendue`, `proposition_ia`) ; un marqueur « vu » par personne, `settings.vus`, jumeau exact de `snoozes`.

Pureté préservée : `computeAlertes(state, today)` est synchrone sur `AppState`, or les communications vivent en table. On lui ajoute un **troisième paramètre optionnel** alimenté par le cache IndexedDB. Les cinq sites d'appel existants compilent sans modification ; aucune lecture asynchrone n'entre dans `alerts.ts`.

Destinataire déterministe et corrigeable : `Projet.responsable` / `coResponsable` / `equipeProjet` (`src/types.ts:80-85`), sinon la personne à qui le message est adressé, sinon aucune — alerte visible de tous. **Aucun modèle ne choisit qui est notifié.**

**Hors périmètre, déclaré :** ni e-mail sortant, ni notification poussée. Envoyer un e-mail exigerait `gmail.send`, que le §6 refuse ; une notification poussée supposerait un service worker avec clé VAPID et permission navigateur, pour un gain nul à deux personnes qui ouvrent le Cockpit chaque matin. La file du centre d'actions est le canal réel.

### 3.16 **[nouveau]** Qui écrit le journal d'audit — la contradiction du critère 13, tranchée

**Le problème.** La version 1 plaçait le journal d'audit en vague A, « alimenté par triggers » en base, alors que ses objets principaux — les tâches (B.1) et le registre documentaire — restent dans `workspace.data jsonb`. **Un trigger PostgreSQL ne voit pas la mutation d'une collection à l'intérieur d'un document JSONB.** Il voit une ligne `workspace` changer, et rien de plus. Diffuser deux documents de 3 Mo à chaque écriture pour retrouver quelle tâche a bougé serait coûteux, fragile, et surtout muet sur l'**intention** : une validation, une correction et une acceptation de proposition IA produisent le même diff. Le §14.4 demande exactement ces trois-là. Le rattachement du critère 13 était donc nominal, pas effectif.

**Décision : les deux canaux, avec un partage explicite, et le critère 13 déclaré partiel au MVP.**

1. **Canal fort — triggers sur les tables relationnelles.** `communications`, `propositions`, `pointages`, `chrono_actif`, `membres` : l'application ne peut ni forger ni omettre l'entrée. C'est de la preuve.
2. **Canal faible — RPC `journaliser()` en `security definer`, appelée par l'application** pour les entités qui restent dans le JSONB (tâches, registre documentaire). L'application ne peut qu'**ajouter** ; elle ne peut ni modifier ni supprimer, et la RPC estampille elle-même `auth.uid()` et `now()`, de sorte que l'appelant ne peut mentir ni sur qui ni sur quand. **Mais il peut oublier d'appeler.** C'est la faiblesse, et elle doit être écrite.
3. **Mitigation, pas garantie** : un test statique en CI vérifie que toute fonction mutant une entité auditée passe par l'assistant d'audit. Un test statique rend l'omission visible ; il ne la rend pas impossible.
4. **Conséquence de séquencement.** Le journal ne peut pas précéder ce qu'il journalise. Il est scindé : **A.13** livre la table, la RPC et les triggers sur les tables de la vague A ; **B.16** étend les triggers à `pointages` et `chrono_actif` et branche le chemin d'écriture JSONB. Les corrections de temps du §14.4 deviennent auditables au moment où elles deviennent relationnelles (B.4), pas avant.
5. **Conséquence sur le tableau des critères.** Le critère 13 est déclaré **partiel à la fin du MVP** — fort sur les entités relationnelles, déclaratif sur le JSONB — et **complet à la fin du Lot 2**, quand 2.6 (historisation des corrections de temps) referme le dernier cas du §14.4. Il ne devient *structurellement* complet qu'au Lot 4, avec la sortie de `taches` et `registreDocuments` du JSONB (4.5). C'est moins flatteur que « satisfait » ; c'est ce qui est vrai.

Pourquoi ne pas sortir les tâches du JSONB tout de suite pour tout obtenir par triggers ? Parce que ce serait payer le hors-ligne des tâches — l'argument même du §3.1 — pour gagner une garantie de preuve dont deux associées qui se font confiance n'ont pas l'usage immédiat. L'ordre de priorité est assumé : on préfère qu'une tâche s'ouvre sur un chantier sans réseau plutôt qu'un journal opposable entre deux personnes qui partagent leurs salaires.

---

## 4. Le plan par lots

Les estimations sont des **ordres de grandeur en jours-homme de développeur expérimenté**, à ajuster ; elles servent à comparer les lots entre eux. Les totaux et le calendrier réaliste sont au §4.6, et ils sont inconfortables : il faut les lire avant d'engager quoi que ce soit.

### Lot 0 — Prérequis

> **Domaine retenu par l'agence : `agence-ll.fr`.** Les adresses personnelles seront de la forme
> `prenom@agence-ll.fr` et les adresses projet `[code-projet]@agence-ll.fr`, conformément au §3.2.
> Ce choix ne débloque rien avant le Lot 3, mais il fige le format que 0.2 et 0.7 doivent accepter
> dès maintenant, pour que la bascule d'identité (3.2) n'ait pas à réécrire ce qu'ils produisent.


> **Objectif :** poser l'identité, découpler les adresses en dur, rendre les critères déjà satisfaits **opposables**, et livrer les corrections à coût quasi nul, pour qu'aucun lot suivant ne construise sur du sable.

| # | Livrable | §CDC | Effort |
|---|---|---|---|
| 0.1 | Réviser `docs/CONTRAT_MODULES.md` : lever l'interdit sur les fichiers partagés et sur les appels IA serveur, conserver la doctrine de validation humaine et de traçabilité, **ajouter les deux règles du §3.13** (tout tableau passe par `Table` ; l'accueil n'invente aucun calcul) | — | 0,5 j |
| 0.2 | Table `membres` (compte ↔ personne ↔ rôle ↔ actif) et fonctions `est_membre_actif()` / `role_courant()` en `security definer`, appelées par toutes les politiques ; suppression des 23 adresses littérales en SQL et des 5 constantes `AGENCE` | §3.1, §14.2, §23 | 4 j |
| 0.3 | `Personne.email` ; session Supabase rendue **réactive** ; `useMoi()` à deux étages avec repli par poste | §8, §18 Collaborateur | 2 j |
| 0.4 | Correction de `majPersonne` : un renommage réécrit `temps`, `tempsHorsProjet`, `absences`, `responsable`, `coResponsable`, `equipeProjet`, et les champs `pour` — **bug latent existant** | §10 | 1 j |
| 0.5 | `workspace.updated_by` renseigné depuis `auth.uid()` au lieu de `MON_ID` | §14.4, critère 13 | 0,5 j |
| 0.6 | **Lien Gmail sur les pièces jointes** : ajouter `source_id` au `select` de `src/entrants.ts:53-55`, le propager dans `creerDocument`, construire l'URL de lecture | §7.3, **critère 10** | 0,5 j |
| 0.7 | Champs neufs sans dépendance externe : `Projet.codeExterne`, `adresseProjet`, `driveFolderId`, **`calendarId` [corrigé]** ; `DocumentRecord.phase`, `driveFileId`, `auteur` | §3.2, §7.3, §18 | 1 j |
| 0.8 | Création de l'arborescence documentaire à la fin de l'assistant « Nouveau projet » (aujourd'hui bouton manuel). **[corrigé]** Libellé : « §12.1 pts 6, 7 et 9 », le pt 9 (créer les phases) étant **déjà acquis** — `src/modules/ProjetNouveau.tsx:81-92` appelle `phasesParDefaut`, `daterPhases` et `echeancesParDefaut`. Le plan sous-déclarait son propre socle | §12.1 pts 6, 7, 9 | 0,5 j |
| 0.9 | Achat du domaine et souscription Google Workspace Business Standard — **décision de l'agence, hors code**, à lancer maintenant car la vérification DNS prend des semaines. **[corrigé] Ordre encodé : l'achat est parallèle et sans risque ; la bascule d'identité (3.2) est bloquée tant que 0.2 n'est pas livré et son test vert** | §23 | achat |
| 0.10 | **[nouveau]** Référentiel des trois axes du §5.2 : nouveau module `src/categorisation.ts` — `PhaseEchange` (superset séparé, voir §3.14), `TypeEchange` (15 valeurs, reprend `Courrier.type`), `NiveauImportance` (6 valeurs) et `graviteDe()` qui projette sur l'échelle 1-3 existante. Aucune donnée écrite, aucune modification de `PhaseCode`. Palier `migrate()` v16 → v17 reprenant les `Courrier` existants | §5.2, §13.1, §18 | 1,5 j |
| 0.11 | **[nouveau]** Accueil §8.1 — les cinq blocs livrables **sans un seul modèle neuf** : (1) validations attendues, groupe agrégeant factures fournisseurs `a_valider` (`financeActions.ts:38-48`), documents `recu`/`a_classer`/`a_valider` (comptés en `App.tsx:107`, jamais rendus au Cockpit), situations `a_verifier`, entrants distants — **et suppression du double calcul des factures à émettre** entre `itemsAFaire` et `actionsATraiter` (§3.13) ; (2) réunions du jour, agenda Google borné à la journée + `ReunionChantier` du jour, avec repli explicite quand la session Google est coupée ; (3) prochaines échéances sur 14 jours, en **exportant** `evenements()` de `Calendrier.tsx:40`, aujourd'hui local et rendu seulement en grille mensuelle ; (4) temps enregistré de la semaine via `tempsParPersonne` ; (5) charge prévisionnelle via `chargePlanifieeSemaine` / `capacitePersonneSemaine`, calculées et jamais affichées ici. Le filtre par personne prend `useMoi()` par défaut | §8.1, §8.2, critère 6 | 3 j |
| 0.12 | **[nouveau, étiquetage corrigé]** Assistant « Nouveau projet » : bloc « L'équipe » à l'étape 1 — responsable (obligatoire, `useMoi()` par défaut), co-responsable, équipe cochée dans `settings.personnes` — plus le `codeExterne` pré-rempli. **Conséquence mesurable aujourd'hui** : ces champs ne se règlent que dans la fiche, après coup (`Projets.tsx:1192, 1364`), donc `equipeDuProjet()` renvoie une liste vide et `chargePlanifieeSemaine` renvoie 0 pour tout projet neuf | §19.1 pts 2 et 4, §12.1 pt 12 | 1 j |
| 0.13 | **[corrigé, ex-3.7]** Baseline des heures prévues par phase, figée à la signature, pour que « Recalculer la répartition » n'efface plus l'écart qu'on mesure. **Remonté du Lot 3 : ne dépend d'aucun service Google, et chaque semaine de retard détruit une mesure qui ne se reconstitue pas** | §11.3, **critère 15** | 2 j |
| 0.14 | **[nouveau]** Trois tests de non-régression pour les critères déclarés satisfaits mais protégés par rien : `test-oauth-lecture-seule.cjs` (aucun périmètre `gmail.send` / `gmail.modify` / `gmail.compose` / `calendar.events` nulle part, aucun appel `messages/send` ni `sendAs`, seul chemin sortant `gmailComposeUrl`) → **critères 1 et 14** ; `test-propositions-modifiables.cjs` (tout champ proposé a un pendant humain, aucun `grant update` d'une colonne `*_propos*` à `authenticated`, `statut: 'a_valider'` à l'insertion) → **critère 11** ; `test-adresses-en-dur.cjs` → verrou de 3.2. Ajoutés à `npm test` | §22, §24 | 1,5 j |

**Périmètre exact de `test-adresses-en-dur.cjs`** — « aucune adresse littérale dans le dépôt » est inapplicable tel quel, et ce test garde le point de non-retour du §2.1 : il doit donc être écrit précisément. Ce qu'il interdit : les **deux adresses de connexion réelles** hors du registre d'identités de 0.2. Recensement vérifié : 23 lignes SQL dans les migrations, 5 constantes `AGENCE` dans les Edge Functions, une variable Vercel `AGENCE_EMAILS`, et **`src/modules/Parametres.tsx:602-603`, où elles figurent en clair dans un libellé d'aide et un `placeholder`** — occurrence que le recensement précédent avait manquée. Ce qu'il autorise explicitement : les adresses de démonstration en `.example` (`src/seed.ts`, `src/modules/Situations.tsx`, `src/routines.ts`, `src/modules/BienDemarrer.tsx`) et l'adresse générique d'agence, qui ne sont pas des identités de connexion.

**Dépendances internes.** 0.1 d'abord (il autorise le reste). 0.3 avant 0.11 et 0.12 (`useMoi()`). 0.7 avant 0.12 (`codeExterne`). 0.2 **avant tout geste de bascule d'identité**, et son test 0.14 doit être vert avant 3.2. 0.9 démarre au jour 1, en parallèle, sans point de non-retour. Tout le reste est parallélisable.
**Critère de fin :** aucune adresse e-mail n'est écrite en dur dans le dépôt et un test le vérifie ; renommer une personne dans les Paramètres ne perd aucune donnée ; une pièce jointe classée affiche un lien qui rouvre son e-mail dans Gmail ; l'écran affiche qui est connecté et le déduit de la session ; l'accueil affiche cinq blocs du §8.1 qui n'étaient calculés nulle part ; un projet neuf naît avec son équipe et sa baseline d'heures.
**Total Lot 0 : 19 jours.**

---

### Lot 1 — MVP

> **Objectif :** faire entrer les messages, les tâches et le temps dans le Cockpit, avec leur source, leur catégorisation et leurs propositions, sans casser le hors-ligne ni la chaîne financière.

**[corrigé] Divergence de périmètre avec le §20, déclarée et résolue.** Le MVP du cahier des charges (§20, rubrique « IA ») exige quatre choses : résumé, **proposition de tâches**, **proposition d'échéances**, validation humaine obligatoire. La version 1 du plan en retirait deux **sans le dire**. Elles sont **remises au MVP** (A.9, A.10, B.10, B.11), pour trois raisons : le plan ne peut pas citer le §19.2 pt 6 (« Cockpit propose tâches, décisions et échéances ») comme parcours servi et retirer les propositions ; le coût réel est modéré parce que le contrat JSON de détection est déjà écrit et déjà analysé (`src/routines.ts:59-74`, `src/importRoutines.ts:104-125`) et que l'ergonomie de revue séquentielle est en production ; et sans elles, l'unique sortie IA du MVP est le résumé, si bien que le critère 11 ne s'applique à **aucune** proposition nouvelle. **Ce qui reste hors MVP est déclaré et non caché : la promotion des propositions en décisions de projet (2.1) et en risques qualifiés (2.3) reste en Phase 2.** Les quatre genres sont détectés au MVP ; deux attendent leur destination sans être perdus.

Le lot se livre en trois vagues. A et B sont séquentielles ; M est **parallélisable à hauteur de 3,5 jours sur 6,5** (M.1 et M.4 seuls ; M.2 et M.3 attendent la vague B) — c'est elle qui permet d'occuper une seconde paire de mains si l'agence en dispose.

#### Vague A — la mémoire des échanges

| # | Livrable | §CDC | Effort |
|---|---|---|---|
| A.1 | Enrichir l'ingestion : `To`/`Cc`, `threadId`, `Message-ID`/`In-Reply-To`/`References`, `labelIds`, date d'envoi distincte de la réception, direction du message, corps ; passage au curseur `internalDate` réutilisé de `veille-mails` | §3.3, §4.1 | 5 j |
| A.2 | **[re-spécifié]** Table `communications` sur le patron `veille_signaux` : index unique sur `gmail_message_id`, RLS agence, `service_role` en écriture, index `(projet_id, envoye_le desc)` et `(thread_id)` — **plus, dans la même migration, les dix colonnes des trois axes** (`phase_proposee` / `phase` / `phase_effective` et leurs homologues pour type et importance, `confiance_categorisation`, `raisons_categorisation`, `categorise_par`, `categorise_le`), le GRANT au niveau colonne et le trigger de refus du §3.14, les CHECK générés depuis `src/categorisation.ts`, et les index `(projet_id, importance_effective, envoye_le desc)` et `(projet_id, phase_effective)` que lisent §8.1, §8.2 et §13.1. **Une seule migration : ajouter ces colonnes après coup coûterait une reprise des lignes déjà ingérées** | §4.1, §4.3, §5.1, §5.2, §15, §18, critère 11 | 9 j |
| A.3 | Couche d'accès paginée côté client sur le modèle de `src/veille.ts`, **plus cache IndexedDB 90 jours et file d'écritures idempotentes** | §24, hors-ligne | 7 j |
| A.4 | Rattachement en cascade unifié (fusion des trois moteurs divergents), file « à rattacher », mémorisation des corrections comme règles adresse → projet | §5.1, §19.2 | 6 j |
| A.5 | Bouton « Ouvrir dans Gmail » sur tout message et tout document issu d'un message | §4.2, **critères 2 et 3** | 1 j |
| A.6 | **[corrigé]** Edge Function de résumé avec secret Supabase propre, limitation de débit, mention « brouillon », résumé des seuls messages rattachés. **Étiquette réduite à « §5.3 seul »** : les points 5 à 8 du §12.3 sont chiffrés en A.9 et A.10 | §5.3 | 4,5 j |
| A.7 | **[scindé, ex-A.7 première moitié]** Bascule de la boîte « À traiter » vers `communications`, **actions strictement inchangées**, deux sources fusionnées à l'affichage, marqueur de traitement nominatif (`traite_par` / `traite_le`). Aucune régression possible : même écran, mêmes boutons, source plus complète | §4.3, §8.1, §16 | 3 j |
| A.8 | **[nouveau]** Classifieur déterministe des trois axes, avec raisons en français : extension de `classer()`, un lexique par axe (phases complétées de « permis », « DCE », « OPR », « levée de réserves », « parfait achèvement », « DOE » ; type d'échange par l'expéditeur d'abord, rapproché de `Entreprise.domaines` / `emailMOA` / `Contact.email` ; importance par `MARQUEURS_ACTION` de `src/tagging.ts:77` plus marqueurs contractuels et de blocage). Repli explicite sous le seuil. **Aucun modèle appelé.** Rendu par `BadgeConfiance` et « Voir pourquoi » réutilisés tels quels | §5.2, §12.3 pt 9, critère 11 | 3,5 j |
| A.9 | **[nouveau]** Table `propositions` : un genre, quatre valeurs (`tache` / `echeance` / `decision` / `risque`), `charge_utile jsonb` typée, **extrait cité obligatoire**, confiance, raisons, `statut` sans aucun statut métier, `objet_cree_type` / `objet_cree_id`, index unique partiel pour l'idempotence sur le patron `entrants_source_unq`. `insert` réservé au `service_role`, `grant update` limité aux colonnes de traitement. Couche d'accès `src/propositions.ts` calquée sur `src/entrants.ts`, branchée sur le cache et la file d'A.3 | §12.3 pts 5-8, §6.1, §6.3, §8.7, §15, critère 11 | 5 j |
| A.10 | **[nouveau]** Les détecteurs, en deux étages : déterministe hors ligne (marqueurs d'action, dates françaises résolues relativement à la date d'envoi, marqueurs de décision, **et pour les risques uniquement les 4 natures que `computeAlertes` ne voit pas** — voir §3.14) ; puis, dans la réponse de l'Edge Function d'A.6, extension du contrat `CONTRAT_COURRIERS` (`src/routines.ts:59-74`) et de son analyseur `parseRetourRoutine` (`src/importRoutines.ts:104-125`) à `taches[]`, `echeances[]`, `decisions[]`, `risques[]`, chacun avec extrait, confiance et raisons. **Aucune détection n'écrit ailleurs que dans `propositions`** — jamais dans `workspace.data`, où aucune Edge Function n'écrit aujourd'hui | §12.3 pts 5-8, §19.2 pt 6, §20 | 5 j |
| A.11 | **[nouveau]** Notifier les personnes concernées : `Alerte.pour` et `Alerte.projetId`, trois producteurs ajoutés à `TypeAlerte` (`mail_a_traiter`, `reponse_attendue`, `proposition_ia`), marqueur `settings.vus` jumeau de `snoozes`, et troisième paramètre optionnel à `computeAlertes` alimenté par le cache. Les cinq sites d'appel existants compilent sans modification. Ni e-mail sortant ni notification poussée (divergence déclarée, §3.15) | §12.3 pt 10, §8.1, §8.2 | 3,5 j |
| A.12 | **[nouveau]** Les trois sélecteurs purs que consomment §8.1, §8.2 et §13.1 : `mailsATraiter(personne)`, `mailsEnAttenteDeReponse()` (dernier message du fil entrant sans sortant postérieur — **d'où la dépendance dure et irrattrapable à `threadId` et à la direction, captés en A.1**), `echangesParPhase(projetId)`. Liste et compte, pas de rendu, testables en CI | §8.1, §8.2, §13.1 | 2 j |
| A.13 | **[scindé]** Journal d'audit, premier étage : table `journal_audit` en append-only, RPC `journaliser()` en `security definer` estampillant `auth.uid()` et `now()`, insertion directe refusée aux comptes applicatifs, **triggers sur les tables de la vague A** (`communications`, `propositions`, `membres`). Voir §3.16 pour le partage des canaux | §14.4, critère 13 | 3 j |

**Dépendances de la vague A.** Lot 0 intégralement. A.2 dépend de A.1 **et de 0.10** (les listes fermées viennent de `src/categorisation.ts`). A.3 dépend de A.2. **A.4, A.5 et A.6 dépendent de A.2 et de A.1** — `threadId` et la direction du message, que le §3.7 désigne comme le signal de rattachement le plus fort, sont captés en A.1. A.7 dépend de A.3 et A.4. A.8 dépend de A.2 et A.1. A.9 dépend de A.2 et A.3. A.10 dépend de A.6 et A.9. **A.12 dépend de A.2, A.1 et 0.2 — et précède A.11**, car son sélecteur `mailsEnAttenteDeReponse()` *est* la définition que le producteur d'alerte `reponse_attendue` consomme : les faire dépendre l'un de l'autre était une circularité. **A.11 dépend de 0.3, A.2, A.3, A.9 et A.12.** A.13 dépend de A.2 et A.9 — **il ne peut pas les précéder, contrairement à ce que la version 1 laissait croire.**
**Sous-total vague A : 57,5 jours.**

#### Vague B — le travail et le temps

| # | Livrable | §CDC | Effort |
|---|---|---|---|
| B.1 | Collection `taches` (`TacheInterne`) dans le document JSONB : 18 champs du §8.5, 9 statuts stockés, `source: {type, id}`, reprise des notes « à faire » non réglées à la migration | §8.4, §8.5, §8.6, **critères 4 et 5** | 7 j |
| B.2 | Vue « Mes tâches » : le filtre par personne du centre d'actions devient le filtre par défaut ; filtres Aujourd'hui, En retard, Cette semaine, À venir, Sans date, Par projet, Par priorité, Par statut, Créées par moi, Assignées par un tiers, **et « Proposées par l'IA » — le onzième filtre du §8.3, que la version précédente omettait alors qu'elle déclarait le critère 6 satisfait**. Ce filtre lit les mêmes propositions que B.10 ; il ne duplique aucune implémentation | §8.3, **critère 6** | 4,5 j |
| B.3 | « Créer une tâche depuis ce message » avec conservation de la source | §8.4, **critère 4** | 1 j |
| B.4 | Table `pointages` horodatés (début, fin, durée, tâche, type d'activité, commentaire, facturable, validée, source) et sa file d'envoi | §9.5, §18 | 7 j |
| B.5 | **Projection** de `pointages` vers `state.temps` — la grille hebdomadaire devient dérivée, `derive.ts` n'est pas touché. **[corrigé] Dépend de B.4, ce que la version 1 ne déclarait pas.** **Livre `scripts/test-conservation-totaux.cjs`** : le §7.3 le désigne comme le seul garde-fou qui protège réellement la marge, et aucune ligne ne s'engageait à l'écrire. Il vérifie que la somme des `pointages` d'une personne sur une semaine égale au centième d'heure près la valeur projetée dans `state.temps`, sur des jeux déterministes incluant les chevauchements de minuit, les corrections rétroactives et les pointages sans tâche. 1 j des 4,5 lui est réservé | §9.5, §11.3 | 4,5 j |
| B.6 | Chrono : table `chrono_actif`, contrainte d'unicité par personne, bascule « arrêter le chrono actuel et démarrer le nouveau », démarrage en un clic depuis une tâche, un projet, un message, un document. **[corrigé] L'affichage permanent n'est plus décrit comme « en barre supérieure » : il n'y a pas de barre supérieure au bureau (§3.5). Les deux emplacements sont livrés par M.3** | §9.2, §9.3, §9.4, **critère 7** | 7 j |
| B.7 | Attribut `facturable` par pointage, initialisé par la règle actuelle (projet = facturable) et modifiable | §9.5, §10.1, §11.2 | 1 j |
| B.8 | **[nouveau]** Fiche tâche — l'écran que le §19.3 ouvre et que le plan ne livrait pas. B.1 stocke les 18 champs, B.2 livre une liste filtrée, **rien n'ouvre la tâche** : les pts 2 et 5 du §19.3 restaient ouverts. Livre description, participants, temps estimé face au temps enregistré, **commentaires horodatés et attribués** (sur le journal d'événements typé de `DocumentRecord`, déjà écrit et éprouvé), sous-tâches, documents liés, dépendances, menu de statut (5 exposés sur 9), bouton chrono et lien vers la source typée. Montée en `Modal` sur le patron de `FicheObligation` / `FicheContact` | §8.5, §8.6, §19.3 pts 2 et 5 | 5 j |
| B.9 | **[nouveau]** Seconde projection : `Tache.tempsEnregistre` recalculé à chaque pointage portant un `tacheId`, écart au temps estimé affiché en heures signées. Un pointage sans `tacheId` alimente le projet seul — aucune régression sur les saisies hebdomadaires. Verrouillé par le **même** test de conservation des totaux que B.5 : deux projections, un test étendu | §19.3 pts 7 et 8, §8.5, **critère 8** | 1,5 j |
| B.10 | **[nouveau]** Revue des tâches proposées : **Accepter / Modifier / Attribuer / Ignorer** (§8.7 littéralement), en revue séquentielle au clavier reprise à l'identique de la revue documentaire (`Documents.tsx:341, 479-481, 564`). Accepter crée la `TacheInterne` avec sa source et écrit `objet_cree_*` sur la proposition ; Modifier ouvre le formulaire pré-rempli et **ne crée rien** tant que l'humain n'enregistre pas ; Attribuer met le responsable au premier plan et déclenche la notification d'A.11 ; Ignorer trace un motif court qui alimente la mémoire des corrections. Affichage conforme au §8.7 : tâche proposée, responsable suggéré, échéance détectée, source — plus l'extrait cité et le badge de confiance | §8.7, §8.4, §19.2 pts 6-7, **critères 4 et 11** | 4,5 j |
| B.11 | **[nouveau]** Échéance proposée : elle n'écrit **que** `TacheInterne.echeance` ou `Contact.dateProchaineAction`, jamais une `Obligation` ni une `EcheanceFacturation`. Garantie par CHECK sur `charge_utile->>'cible'`, pas par règle d'écran (§3.14, décision 4) | §20, §15, §12.3 pt 6 | 1,5 j |
| B.12 | **[nouveau]** Blocs d'accueil qui naissent avec la tâche et le chrono : tâches du jour et en retard entrant dans la file existante comme un `ItemAFaire` de plus (tri, badge « en retard », horizon 7 jours, filtre par personne et revue séquentielle s'appliquent sans être réécrits) ; priorité projetée sur la gravité 1-3, ce qui produit les « tâches urgentes » du §8.2 ; carte chrono en cours ; temps enregistré resserré au grain jour ; **`tempsNonEnregistre()`, l'estimateur unique du §3.4**, affiché comme estimation et jamais écrit ; emplacement réservé et replié pour le bloc « proposées par l'IA » | §8.1, §8.2 | 3 j |
| B.13 | **[nouveau]** Modèles de tâches : collection `modelesTaches` (nom, périmètre, lignes {libellé, phase, décalage en jours relatif au début de phase, rôle destinataire, priorité, temps estimé}), rangée dans les réglages et éditable sans code. Trois usages : case à cocher à l'étape 3 de l'assistant « Nouveau projet », bouton « Appliquer un modèle » depuis la fiche, ré-application au démarrage d'une phase. **Rien n'est appliqué en silence** : aperçu décochable ligne à ligne. Deux gabarits d'amorce (mission de base MOE, phase chantier). Le patron de générateur existe trois fois (`phasesParDefaut`, `echeancesParDefaut`, génération des `TacheChantier` depuis les lots DCE) et se recopie. Ce n'est **pas** une proposition machine mais un texte écrit par l'agence, donc hors du champ de validation du §15 | §12.1 pt 10, §19.1 pt 7, §8.4 | 3,5 j |
| B.14 | **[nouveau]** Départ d'un membre (§12.2, « transfert des tâches ouvertes », zéro occurrence au plan v1) : `retirer()` (`Parametres.tsx:144-157`) supprime aujourd'hui la personne de `settings.equipe` et `settings.personnes`, avertit que ses heures restent, et s'arrête là — elle demeure `responsable` de ses projets et, une fois B.1 livré, ses tâches ouvertes deviennent orphelines sans que personne ne le voie. La suppression devient une **désactivation** (`Personne.actif = false`), l'historique et les pointages restent valorisés, et un écran de départ liste ce qui doit être repris — tâches ouvertes, projets où la personne est responsable, chrono actif — avec réattribution en masse et motif journalisé. Le chrono actif est arrêté et son pointage clôturé | §12.2, §14.4 | 2,5 j |
| B.15 | **[scindé, ex-A.7 seconde moitié]** Retrait du statut « à traiter » au `Courrier` et coupure du chemin d'ingestion navigateur : « ✓ Fait » cède la place à « Créer une tâche » ; `surveillance.ts:88-96` cesse d'écrire dans `state.courriers` ; la collection passe en lecture seule, reste dans l'état et dans l'export. **Condition de déclenchement, non négociable : sept jours consécutifs en production sans écart entre les deux mémoires.** La surveillance Agenda n'est pas touchée | §4.3, §16, **critère 2** | 1,5 j |
| B.16 | **[scindé]** Journal d'audit, second étage : triggers sur `pointages` et `chrono_actif`, branchement de la RPC `journaliser()` sur le chemin d'écriture JSONB (tâches, registre documentaire), et test statique vérifiant que toute fonction mutant une entité auditée passe par l'assistant d'audit. Voir §3.16 | §14.4, critère 13 | 3 j |
| B.17 | **[nouveau]** Huitième test statique `test-categorisation-propositions.cjs` : (1) aucun `grant update` de colonne `*_propos*` à `authenticated` ; (2) le domaine de `propositions.statut` ne contient aucun statut métier ; (3) aucune Edge Function n'écrit dans `workspace.data` ; (4) les trois listes fermées du §5.2 sont identiques en base et dans `src/categorisation.ts` ; (5) `charge_utile->>'cible'` reste borné à `tache` / `contact`. **C'est ce qui rend le critère 11 opposable sur les entités nouvelles** | §15, §22 critère 11, §24 | 1 j |
| B.18 | **[nouveau — la condition de B.15 n'était mesurée par rien]** Outil de mesure de parité entre les deux mémoires : un écran d'exploitation qui compare, jour par jour, les messages vus par l'ingestion navigateur (`state.courriers`) et ceux indexés dans `communications`, et affiche les trois écarts qui comptent — présent d'un côté seulement, présent des deux avec un rattachement projet divergent, présent des deux avec une date ou un expéditeur divergents. « Sept jours consécutifs sans écart » est cité trois fois dans ce plan comme condition non négociable de la coupure : sans cet outil, c'est une phrase, pas une protection | §24, §4.6 | 2 j |

**Le point 12 du §12.1 (« créer les droits d'accès ») n'est pas livré, et 0.12 ne doit pas être étiqueté comme le livrant.** Ce bloc désigne un responsable et une équipe ; il ne crée aucun droit, puisque ce plan renonce explicitement aux droits par projet (critère 12, §6). Le §12.1 est donc satisfait sur ses points 1 à 11 et **ouvert sur le point 12**, exactement comme le critère 12 dont il dépend.

**La moitié « membre ajouté » du §12.2 est couverte par 0.12 et B.13, et vaut d'être énumérée** puisque le cahier des charges en fait six gestes : ajout au projet Cockpit (0.12, bloc « L'équipe »), ajout au Google Group (Lot 3, 3.4 — conditionné à Workspace), accès Drive (Lot 3, 3.5, même condition), accès aux tâches (B.13, par l'appartenance à l'équipe du projet), accès aux documents et aux informations utiles (acquis : le registre documentaire et l'état partagé sont lisibles par tout compte autorisé, ce qui est précisément le corollaire du renoncement au critère 12). Deux des six gestes attendent donc l'achat du domaine ; aucun ne demande de développement supplémentaire au MVP.

**Dépendances de la vague B.** **B.1 dépend du Lot 0 seul** — c'est la racine de la vague, tout le reste en découle. B.2 dépend de B.1 et 0.3. B.3 dépend de B.1. B.4 dépend de A.3 (file mutualisée). **B.5 dépend de B.4.** B.6 dépend de B.4. **B.7 dépend de B.4** — le caractère facturable se porte sur le pointage, qui n'existe qu'à partir de B.4. B.8 dépend de B.1, B.2 et B.6. B.9 dépend de B.4 et B.5. B.10 dépend de A.9, A.10, B.1, B.3 **et A.11** (l'action « Attribuer » déclenche la notification produite par A.11). B.11 dépend de A.9, A.10 et B.10. B.12 dépend de B.1, B.2, B.4, B.6 et 0.11. B.13 dépend de B.1 et 0.12. B.14 dépend de B.1, 0.3 et 0.4. **B.15 dépend de A.7, de B.3, et de sept jours de parité mesurée par l'outil de B.18.** B.16 dépend de B.4, B.6 et A.13. B.17 dépend de A.2, A.9 et B.11. **B.18 dépend de A.7.**
**Sous-total vague B : 57,5 jours.**

#### Vague M — le poste de travail *(partiellement parallélisable)*

> **Objectif :** rendre vraie la phrase « les tâches sur chantier », sur laquelle le §3.1 appuie un arbitrage d'architecture entier. Aucun chantier « rendre l'application responsive » : elle l'est déjà (§1.6). Trois manques précis, et trois seulement.

| # | Livrable | §CDC | Effort |
|---|---|---|---|
| M.1 | **[nouveau]** Coquille hors ligne : `manifest.webmanifest` (nom, icônes, `display: standalone`), service worker de type coquille applicative préchargeant `index.html` + JS/CSS et servant le cache d'abord, bannière « nouvelle version disponible » plutôt qu'une mise à jour silencieuse, et découpage par route via `React.lazy` pour que la coquille reste petite. Le bundle principal fait aujourd'hui 1,06 Mo en un seul morceau (305 Ko gzip) : un cache évincé sans réseau donne une page blanche. Les bibliothèques lourdes (pdfjs, xlsx, docx, transformers) sont **déjà** chargées à la demande — rien à reprendre de ce côté | §17 Frontend, §24 | 3 j |
| M.2 | **[corrigé — la prémisse de la version précédente était fausse]** La saisie principale du temps est **déjà** une liste une-personne / une-semaine, explicitement documentée comme « vue principale sur tous les écrans (audit simplification) » (`src/modules/Temps.tsx:466-470`) ; la grille 6 semaines de `TableauPersonne` (`Temps.tsx:86`) n'a **qu'un seul site d'appel**, ligne 763, dans l'onglet « Historique », qualifié de vue secondaire ligne 734. Il ne faut donc pas construire une saisie mobile : il faut **vérifier et ajuster la liste existante sous 700 px**, et poser les classes `.temps-mobile` / `.temps-desktop` **déclarées dans `src/styles.css:1094, 1209-1210` et posées par aucun `.tsx`** — une intention écrite jamais tenue. Ramené de 2 j à 1 j | §17 Frontend, §9.6, §10.1 | 1 j |
| M.3 | **[nouveau]** Chrono au doigt : le composant unique de B.6 monté à **deux** emplacements — dans la `.topbar` au téléphone, en tête de la barre latérale au poste (§3.5) — bouton démarrer/arrêter à 44 px, durée qui défile, nom de la tâche tronqué, démarrage en un appui depuis une ligne de tâche et depuis la fiche projet | §9.2, §9.3, §17, **critère 7** | 1,5 j |
| M.4 | **[nouveau, périmètre corrigé]** Test statique : aucun `<table>` **JSX** brut hors des sept modules recensés et de `src/ui.tsx`. Le test doit ignorer les chaînes HTML d'impression — `src/pdf.ts` (sept balises) et `src/modules/Planning.tsx` lignes 298, 520, 814 — sans quoi il échoue le jour de son écriture. Tout nouveau tableau affiché passe par `Table` (`src/ui.tsx:982`) ; `docs/CONTRAT_MODULES.md` l'impose déjà (ligne 31) sans que rien ne le vérifie | §17, §22 | 0,5 j |

**Dépendances de la vague M.** M.1 : aucune, parallélisable dès le jour 1. M.2 dépend de B.5. M.3 dépend de B.6. M.4 : aucune. **Correction d'une affirmation trop généreuse : M n'est pas indépendante de A et B.** Sur ses 6,5 jours, seuls **M.1 et M.4 — soit 3,5 jours — sont réellement parallélisables dès le début** ; M.2 et M.3 attendent la vague B. L'argument « la vague M occupe une seconde paire de mains » ne vaut donc qu'à moitié, et il faut le dire avant de dimensionner une équipe dessus.
**Sous-total vague M : 7 jours.**

**Critère de fin du Lot 1 :** un message reçu ce matin apparaît dans le Cockpit avec son projet, sa phase, son type et son importance **proposés et corrigeables**, ses destinataires, son résumé et un lien qui le rouvre dans Gmail ; les tâches et échéances qu'il contient sont **proposées** avec la phrase exacte qui les motive, et acceptées, modifiées, attribuées ou ignorées d'un geste ; une tâche créée depuis ce message conserve sa source et s'ouvre sur une fiche où l'on commente ; un chrono démarré depuis cette tâche produit une entrée de temps qui remonte dans la grille hebdomadaire **et** sur la tâche, **sans que la marge du projet ne bouge d'un euro** ; tout cela fonctionne avec le réseau coupé, y compris au premier chargement, y compris depuis un téléphone ; et l'export JSON reste complet.
**Total Lot 1 : 125,5 jours.** *(révisé : M.2 ramené de 2 à 1 j après vérification de `Temps.tsx:466-470` ; B.5 porté de 3,5 à 4,5 j pour écrire `test-conservation-totaux.cjs` ; B.2 de 4 à 4,5 j pour le onzième filtre du §8.3 ; B.18 ajouté, 2 j, pour mesurer la parité qui conditionne B.15.)*

---

### Lot 2 — Phase 2

> **Objectif :** transformer les échanges indexés en décisions, en risques et en mémoire consultable — et refermer le critère 15, qui n'avait aucune raison d'attendre Google.

| # | Livrable | §CDC | Effort |
|---|---|---|---|
| 2.1 | Entité `decisions` de **projet**, distincte de `DecisionDirection` qui reste le pilotage d'agence : `projetId`, `sourceType`/`sourceId`, `decidePar`, `decideLe`, cycle Proposée / À vérifier / Confirmée / Contestée / Annulée sur le patron éprouvé de `DocumentRecord`. Consomme `propositions.genre='decision'`, détectées depuis le MVP | §6.1, §6.2, **critère 9** | 7 j |
| 2.2 | **[réduit]** Fonction unique de promotion journalisée d'une proposition en décision. **Le verrou de type est absorbé par A.9** : le domaine de `propositions.statut` ne contient déjà aucun statut humain, pour les quatre genres, un lot plus tôt. Il ne reste que la promotion | §15 | 1 j |
| 2.3 | **[réduit]** Risques en mode hybride : détection dérivée par le moteur d'alertes, qualification humaine stockée (écartement, attribution, motif de clôture) sur le patron `AttenduFinancier`. **Consomme `propositions.genre='risque'` au lieu d'écrire sa propre détection, et l'ajout de `projetId` sur `Alerte` est déjà fait par A.11** : environ 1 j retiré | §6.3 | 6 j |
| 2.4 | Recherche par facettes : date, période, **phase (rendue possible par A.2)**, auteur, statut, client ; ajout des tâches, décisions, réunions et comptes-rendus au balayage ; anti-rebond et plafond de résultats | §13.1 | 4,5 j |
| 2.5 | Index plein texte français (`to_tsvector('french')` + GIN) sur communications, décisions et comptes-rendus, avec glossaire de synonymes métier | §13.1 | 3,5 j |
| 2.6 | Historisation des corrections de temps : valeur antérieure, auteur, date, motif. **Ferme le dernier cas du §14.4 et complète le critère 13 (§3.16)** | §9.6, §14.4 | 2 j |
| 2.7 | Purge planifiée du bucket `entrants` après classement (aucun `storage.remove()` n'existe aujourd'hui — les pièces s'accumulent indéfiniment). **[corrigé] Dépendance : aucune. Réalisable dès le Lot 0 si l'on veut ; placée ici par confort, pas par contrainte** | §24, RGPD | 1 j |
| 2.8 | **[réécrit]** Récapitulatif de fin de journée. Le §12.4 **avait** un livrable au plan v1, mais sans déclencheur, sans estimateur et sans écran de complément. (1) Déclencheur : bandeau discret en pied du Cockpit à partir d'une heure paramétrable, plus la même carte au premier chargement du lendemain si la veille n'a pas été récapitulée — **pas de fenêtre modale** : une journée finit souvent en fermant l'onglet, un déclencheur bloquant serait ignoré puis désactivé. (2) Contenu littéral du §12.4 : projets touchés, déduits des pointages du jour et, à défaut, des messages rattachés et des tâches passées en « terminée » ; puis « temps non enregistré estimé », via l'estimateur **unique** de B.12. (3) « Ignorer » ferme sans rien écrire et ne repose pas la question ; « Compléter » ouvre la saisie pré-remplie, chaque ligne acceptée créant un pointage normal, daté, attribué, `source: 'recap_fin_journee'`. **Rien n'est jamais écrit sans geste humain** | §12.4, §9.6 | 4 j |
| 2.9 | Synchronisation par `historyId` pour capter suppressions et changements de libellés ; reprise d'historique bornée et reprenable | §4.1 | 4,5 j |
| 2.10 | Marqueur de confidentialité par objet (message, document, projet) — prérequis du §14.3, aujourd'hui inexistant hors `DocumentCorpus.prive` | §14.3 | 2 j |
| 2.11 | **[nouveau]** Mémorisation des corrections de **catégorisation** comme règles réutilisables. A.4 ne couvre que le rattachement au projet ; les trois autres axes se retrompent indéfiniment. Table `regles_categorisation (declencheur, portee, axe, valeur, cree_par, cree_le, actif)`, déclencheur = adresse, domaine ou fil. Le troisième mail du même BET est typé « BET » sans que personne ne le redise. Règles listées, désactivables et supprimables — jamais implicites, comme `settings.veilleDecisions` (`src/types.ts:1187`) l'est déjà pour la veille. **Contrainte non négociable : une règle apprise écrit `*_proposee`, jamais la colonne validée** — une règle est une proposition automatique, pas une validation, et B.17 le vérifie | §5.1 pt 5, §5.2 | 3 j |
| 2.12 | **[nouveau, dédoublonné]** Bloc « Proposées par l'IA » du centre d'actions : l'emplacement réservé par B.12 devient un groupe actif, replié par défaut et jamais mêlé aux décisions confirmées, montant **le composant de revue de B.10** — pas une seconde implémentation. Une proposition non traitée ne devient jamais une tâche, quel que soit le délai | §8.2, §8.3, §8.7 | 1,5 j |
| 2.13 | **[reclassé, ex-3.6]** Cause documentée de l'écart prévu / réel, portée par `RevisionResteAFaire` — dont `notes` et `par` sont **déclarés (`src/types.ts:713-722`) et jamais alimentés (`Projets.tsx:555` ne les renseigne pas)** — avec la liste fermée du §11.3 plus « Autre » commenté. **Ne requiert aucun service Google : sorti du Lot 3** | §11.3, **critère 15** | 3 j |
| 2.14 | **[reclassé et corrigé, ex-3.8]** Écart en **heures** signé à côté du ratio de consommation, et **taux d'avancement porté dans la fiche projet et le tableau des phases**. **[corrigé] La version 1 affirmait que « le calcul `avancementPhase` existe déjà et n'est jamais rendu » : c'est faux.** `src/economie.ts:196` le définit, `src/revue.ts:113` en construit la phrase « phase APD avancée à 87 % » et `src/modules/FinanceRevue.tsx:190` l'affiche. Le vrai manque est plus étroit et le livrable rétrécit d'autant : ce taux n'est rendu **que** dans les jalons de facturation de la revue financière, et nulle part dans la fiche projet ni dans le tableau des phases, là où on le cherche. Il s'agit de le porter, pas de le créer | §11.1, §11.3, **critère 15** | 1 j |
| 2.15 | **[nouveau]** Carte des liens entre objets (§2 principe 10 : « tâches, documents, décisions, temps et communications sont reliés entre eux »), jamais tracée par aucun livrable. Toutes les entités portent déjà une source typée `{type, id}` ; ce qui manque est la lecture **inverse** : depuis un message, voir les tâches, pointages, documents et décisions qui en sont nés ; depuis une tâche, remonter au message. Un index inverse dérivé, plus un bloc « Ce qui en découle » dans la fiche tâche (B.8), la fiche message et la fiche décision. Aucune donnée nouvelle stockée | §2 principe 10, §13.3 | 2 j |
| 2.16 | **[nouveau]** Recette mobile réelle, sur un iPhone et un Android **physiques**, pas dans un émulateur : ouvrir l'accueil, lire « Mes tâches », démarrer un chrono depuis une tâche, l'arrêter, saisir une demi-journée, prendre une photo de chantier, couper le réseau et tout refaire. Correction des écarts sur les sept modules à tableau brut recensés (première colonne figée via `.col-figee`, qui existe déjà). Inclut **une page de documentation qui dit ce qui ne fonctionnera pas** : le chemin Drive local repose sur `showDirectoryPicker` (`src/fsdrive.ts:27`), absent de Safari iOS et de Firefox Android — Documents, DCE et rangement des photos restent des écrans de poste. Une limite assumée par écrit, pas un défaut à corriger | §17, §22 | 1,5 j |

**Dépendances du Lot 2.** Vague A pour 2.1, 2.4, 2.5, 2.9, 2.10, 2.11, 2.12. Vague B pour 2.6, 2.8, 2.12, 2.15. **2.1 pour 2.2 ; A.9 et A.10 pour 2.3 ; 2.7 : aucune ; 2.13 et 2.14 : aucune (chaîne financière existante) ; 2.16 : vague M.** *(La version 1 laissait 2.2, 2.3 et 2.7 hors du graphe : c'est corrigé.)*
**Critère de fin :** une décision prise dans un e-mail se retrouve dans la fiche projet avec un lien vers le message d'origine ; une recherche « APD, mars, Zoé » renvoie des résultats ; un risque écarté l'est avec un motif et un responsable ; l'écart prévu / réel porte sa cause et sa baseline, donc le **critère 15 est satisfait sans Google** ; et le critère 13 est complet.
**Total Lot 2 : 47,5 jours.**

---

### Lot 3 — Phase 3

> **Objectif :** exploiter Google Workspace une fois souscrit, et livrer la mémoire projet interrogeable. **[corrigé]** Ce lot ne contient plus que ce qui dépend réellement de Google ou du Lot 2 : 3.6, 3.7 et 3.8 de la version 1, qui portaient à eux seuls le critère 15 et ne requièrent aucun service Google, ont été reclassés en 0.13, 2.13 et 2.14. Le critère 15 n'est plus visuellement otage d'une décision d'achat qui ne le conditionne pas.

| # | Livrable | §CDC | Effort |
|---|---|---|---|
| 3.1 | Application OAuth de type **Interne** : fin de l'expiration des jetons à 7 jours et de l'évaluation CASA | §23 | 1 j |
| 3.2 | Bascule d'identité `@gmail.com` → domaine agence, avec période de double acceptation. **[corrigé] Dépendance dure : 0.2 livré et `test-adresses-en-dur.cjs` vert. C'est le point de non-retour du §2.1** | §3.1, §23 | 3,5 j |
| 3.3 | Adresses projet en Google Group, créées **à la main** à la création du projet (voir §6 : le provisionnement automatique n'est pas recommandé) | §3.2, §12.1 | 2 j |
| 3.4 | Alias d'envoi `sendAs` pour chaque membre, auto-vérifié parce que dans le domaine, et envoi depuis Cockpit avec l'adresse projet en expéditeur | §3.4, §12.1 pt 5 | 5,5 j |
| 3.5 | Mode assistant « mémoire projet » : récupération **serveur** des sources (seul endroit où le filtrage par confidentialité peut s'appliquer avant le prompt), réponse en deux parties avec un tableau de citations typées `{type, id, date, url}` transformables en liens | §13.2, §13.3 | 9 j |
| 3.6 | **[corrigé, ex-3.9]** Suggestions de saisie depuis Google Calendar, à confirmer avant validation. **La version 1 justifiait ce livrable par « la lecture des événements existe déjà » : elle existe côté navigateur seulement** (`src/google.ts:10`), pas dans le jeton serveur (`gmail-oauth/index.ts:20`). Les suggestions sont donc calculées à l'ouverture de l'écran Temps, jamais par le cron ; élargir le périmètre serveur au calendrier est écarté au §6 | §9.7 | 3 j |
| 3.7 | **[élargi, ex-3.10]** Exports du temps : CSV, Excel **et PDF**. Le §10.3 demandait les trois ; la version 1 en livrait deux et abandonnait le troisième sans un mot. Le PDF est un quatrième générateur dans `src/pdf.ts`, sur le patron exact des trois existants (`ouvrirFacturePDF:29`, `ouvrirDecompteSituationPDF:207`, `ouvrirRevuePDF:286`) — une fenêtre imprimable, sans dépendance ni service externe. `xlsx` est déjà une dépendance du projet mais **uniquement en lecture** (`Parametres.tsx:663`, `dpgf.ts:134`) ; l'écriture reste à écrire, elle est triviale. **[corrigé] Dépend de B.4, non déclaré en v1** | §10.3 | 3 j |
| 3.8 | **[nouveau]** Agenda projet : `Projet.calendarId` (livré en 0.7) renseigné à la main avec l'identifiant d'un agenda secondaire créé par l'agence, plus un **export .ics par projet** (phases datées, réunions de chantier, échéances de facturation, jalons) en réutilisant le générateur de `src/modules/Agenda.tsx:56-79`, aujourd'hui limité aux obligations, rendus et relances de toute l'agence. Créer l'agenda automatiquement exigerait le périmètre `calendar` en écriture, ce qui coûterait l'argument du critère 14 (§6). Le CDC place lui-même l'agenda projet en Phase 2 (§21) : ce lot ne le devance pas | §12.1 pt 11, §18, §21 | 2 j |
| 3.9 | **[nouveau]** Annexe « encours de production » au paquet de clôture comptable. `src/comptable.ts` est un pont abouti — écritures équilibrées, lot versionné, empreinte SHA-256, checklist, diff de réexport — mais il ne connaît **ni le temps ni la notion d'encours** : `piecesPeriode` (ligne 47) ne lit que factures, achats, notes de frais et paiements. Un CSV de plus dans `construirePaquet` (ligne 312) : par projet, heures pointées non encore facturées, coût réel correspondant (`coutReelTemps`, `derive.ts:225`), honoraires déjà émis, encours valorisé ; plus une ligne au manifeste et un contrôle dans `controlesCloture` (ligne 65). **C'est le seul usage comptable légitime des pointages pour cette agence, et le seul chiffre que le cabinet réclame au bilan et que le Cockpit ne sait pas produire alors qu'il en a toutes les données** | §10.3, §11.1 | 2,5 j |
| 3.10 | **[nouveau]** « API » du §10.3 : une fois `communications` et `pointages` sortis en tables PostgreSQL avec RLS, Supabase les expose **déjà** en PostgREST — le §10.3 est satisfait par construction et il n'y a rien à bâtir. Le livrable est du cadrage : vue de lecture `v_temps_export` (personne, projet, phase, date, durée, facturable, validée) avec sa politique RLS restreinte aux membres actifs, procédure de création et de révocation d'un jeton, exemple d'appel, page de documentation | §10.3 | 1 j |
| 3.11 | Recherche sémantique `pgvector` — **seulement si** le plein texte du Lot 2 a été mesuré insuffisant (7 j, hors total) | §13.2 | conditionnel |

**Dépendances du Lot 3.** Google Workspace souscrit et domaine vérifié pour 3.1 à 3.4 ; **0.2 et son test pour 3.2**. Lot 2 pour 3.5 et 3.11. B.4 pour 3.7, 3.9 et 3.10. 0.7 pour 3.8. 0.2 pour 3.10.
**Critère de fin :** un client écrit à `2026-034@agence.fr`, les deux collaboratrices le reçoivent, la réponse part avec l'adresse projet en expéditeur, la question « pourquoi avons-nous retenu ce bardage ? » renvoie une réponse dont chaque source est un lien cliquable, et la clôture comptable sort l'encours de production sans reprise à la main.
**Total Lot 3 : 32,5 jours** (hors 3.11, conditionnel, 7 j).

---

### Lot 4 — Phase 4

> **Objectif :** ce qui ne se justifie qu'avec un troisième collaborateur ou un vrai besoin externe. À ne pas engager avant. **Non chiffré volontairement :** chiffrer engagerait, et l'engagement dépend d'un événement qui n'a pas eu lieu.

| # | Livrable | §CDC | Condition d'engagement |
|---|---|---|---|
| 4.1 | Normalisation relationnelle des collections sensibles (`settings.equipe`, contrats, notes de frais, absences) et droits par projet | §14.2, §14.3, **critère 12** | Arrivée d'un troisième collaborateur |
| 4.2 | Les huit rôles du §14.1 et la matrice projet × rôle × phase × type × confidentialité | §14.1, §14.2 | Idem |
| 4.3 | Bascule sur l'API Google Drive, `driveFileId` renseigné, droits Drive par équipe projet | §7.3, §12.2 | Workspace souscrit **et** besoin de partage inter-postes avéré |
| 4.4 | Ingestion multi-boîtes (`ingestion_config` en table à N lignes) | §3.3 | Troisième boîte à ingérer |
| 4.5 | Sortie du JSONB de `taches` et `registreDocuments`. **[corrigé] Référence §CDC précisée : « §17 Base de données »** — le §17 comporte deux paragraphes sans rapport, « Base de données » (qui fonde ce livrable) et « Frontend » (le responsive, traité en vague M). Sans cette précision, le tableau des lots laissait croire que le §17 était couvert. **Rend aussi le critère 13 structurellement complet (§3.16)** | §17 Base de données | Franchissement d'un seuil mesuré (§3.1) |

---

### Lot 5 — Retours d'usage du 03/08/2026 : marchés, chantier et pilotage

> **Origine.** Cette section ne vient pas du CDC : elle vient de l'exploitation
> réelle du Cockpit par l'agence, consignée le 03/08/2026. Les demandes portent
> sur le suivi des marchés de travaux, le chantier et le pilotage d'agence —
> le versant que le CDC « mails, tâches, temps » ne couvrait pas. Chaque
> prémisse a été vérifiée dans le dépôt avant d'être écrite, selon la règle de
> ce plan : dire ce qui existe, ce qui manque, et ne pas confondre les deux.
>
> **Un des points signalés est un défaut réel, pas une demande :** le décompte
> des situations retient la RG même quand une garantie à première demande est
> enregistrée (5.1). Il passe en tête.

#### A. Marchés et situations — là où l'argent se joue chaque mois

| # | Livrable | Réf. | Effort |
|---|---|---|---|
| 5.1 | **[défaut réel]** RG à 0 % quand une garantie à première demande couvre le marché. `Marche.cautionRG` existe (`types.ts:322`) et `retenueGarantieMarche` le lit (`derive.ts:708`) — mais **`decompteSituation` l'ignore** : `tauxRG = marche?.tauxRG ?? 0` (`derive.ts:612`), donc le décompte net à payer retient 5 % à une entreprise qui a fourni sa garantie. Correction : `cautionRG` ⇒ taux effectif 0 % dans le décompte ; le champ devient un type de garantie (`retenue` / `caution bancaire` / `garantie à première demande`) avec la date de réception du document et son lien au registre documentaire. Verrouillé par extension de `test:facture-invariants` | CCAG Travaux art. 33 ; retour 03/08 | 1,5 j |
| 5.2 | **[nouveau]** Pénalités de marché : journal d'événements par marché — retard d'exécution, absence à une réunion de chantier, document contractuel en retard (DOE, PPSPS, décomptes, agréments) — avec les taux du CCAP saisis par marché, le calcul du montant encouru, et l'application **décidée par un humain** sur la situation, jamais automatique : une pénalité est un acte contractuel, pas un calcul. Rien n'existe aujourd'hui (seuls les modèles de relance de `seed.ts` mentionnent le mot) | CCAG Travaux art. 19-20 | 4 j |
| 5.3 | **[nouveau]** Registre des intempéries par chantier : chaleur, pluie, neige, vent, avec les seuils du CCAP, en jours datés. Double effet : prolongation du délai contractuel (les jours d'intempéries **neutralisent** les retards de 5.2 — les deux registres se lisent ensemble, sinon on pénalise un retard que la pluie excuse) et trace opposable pour le décompte général | CCAG Travaux art. 19.2.3 ; code du travail (chaleur) | 2 j |
| 5.4 | **[nouveau]** Indices de révision par marché : `indiceRevision` (BT01, BT02, TP…, chaque entreprise a le sien), mois zéro d'établissement des prix, formule du CCAP (défaut paramétrable `0,15 + 0,85 × In/I0`). Les valeurs d'indices se saisissent à la main ou s'importent (l'INSEE publie à ~3 mois ; le calcul prend le dernier indice connu **et le dit**). À tout moment : révision théorique du mois, pré-calculée — pour ne plus jamais vérifier à la main ce qu'une entreprise a envoyé. `Marche.revision` n'est aujourd'hui qu'un booléen (`types.ts:309`) et `Situation.revisionHT` une saisie libre (`Situations.tsx:336`) : rien ne calcule | retour 03/08 | 3,5 j |
| 5.5 | **[nouveau]** Vérification des situations contre le réel : la situation de l'entreprise s'affiche **face à** l'avancement du Gantt de son lot (5.6) — « elle demande 60 %, le chantier dit 40 % » — et face à la révision pré-calculée de 5.4. Deux écarts côte à côte, décision humaine. Dépend de 5.4 et 5.6 | §9 CCAG ; retour 03/08 | 3 j |

#### B. Chantier — visa, GPA, planning travaux

| # | Livrable | Réf. | Effort |
|---|---|---|---|
| 5.6 | **[nouveau]** Avancement du Gantt : `TacheChantier.avancement` (0–100 %, saisi en réunion de chantier — le champ n'existe pas, `types.ts:389-405`), rendu dans la barre ; et « faire revenir une entreprise » en un geste — duplication d'une tâche en intervention de reprise, liée à l'originale, plutôt que recréer la ligne à la main. C'est cet avancement qui nourrit la vérification des situations (5.5) : il est saisi une fois, au chantier, et sert deux fois | §19.3 ; retour 03/08 | 3 j |
| 5.7 | **[nouveau]** Alerte « entreprise à confirmer » : toute tâche de chantier démarrant sous ~30 jours dont l'entreprise n'a pas été confirmée produit une alerte (producteur A.11), avec l'action « relancer » en brouillon pré-rempli et un `confirmeLe` posé au clic. Une entreprise qui découvre sa date deux semaines avant ne vient pas — c'est le mode de retard le plus courant, et il est entièrement prévisible | retour 03/08 | 2 j |
| 5.8 | **[nouveau]** Visas par projet : registre des documents d'exécution reçus en phase VISA — entreprise/lot, reçu le, statut (à viser / visé / visé avec observations / refusé), délai contractuel du CCAP avec alerte à l'approche, lien au registre documentaire. La phase VISA existe partout (échéancier, catégorisation) mais **aucun registre ne suit ce qui est à viser** ; or un visa en retard engage la responsabilité de la MOE | CCAG MOE ; retour 03/08 (cité deux fois) | 3,5 j |
| 5.9 | **[nouveau]** GPA par projet avec modèles préfaits : registre des désordres signalés pendant l'année de parfait achèvement — désordre, entreprise concernée, relances, levée — s'appuyant sur ce qui existe déjà : la date de fin de GPA est dérivée (`derive.ts:673-699`), la phase SAV existe (`categorisation.ts:72`), et **le moteur de modèles de B.13 (`modelesTaches.ts`) fournit les modèles préfaits** — un gabarit « année de GPA » (visite à M+11, relances types, mise en demeure avant échéance) s'applique en aperçu décochable, comme tout modèle | CCAG Travaux art. 44.1 ; retour 03/08 | 3 j |

#### C. Honoraires entrants et partenaires

| # | Livrable | Réf. | Effort |
|---|---|---|---|
| 5.10 | **[nouveau]** Cotraitants et BET : par projet, les partenaires de maîtrise d'œuvre (BET, autre agence) avec leur mission, leurs honoraires convenus et la répartition ; suivi des **notes d'honoraires reçues chaque mois**, relance mensuelle proposée (alerte + brouillon) quand la note n'est pas arrivée ; rapprochement avec `coutsExternes` des phases (`types.ts:33`) pour que la marge lise le réel et non le convenu. Aujourd'hui seul le coût prévisionnel existe, en chiffre libre | retour 03/08 | 4 j |
| 5.11 | **[nouveau]** Ordre d'appel des contacts du projet : `Contact` n'a aucun champ d'ordre (`types.ts:1095-1109`) — qui appeler en premier chez le client se sait de tête. Un ordre numérique par projet, affiché trié dans la fiche, réordonnable | §12.1 ; retour 03/08 | 1 j |

#### D. Pilotage d'agence

| # | Livrable | Réf. | Effort |
|---|---|---|---|
| 5.12 | **[compléter]** Congés et report des heures planifiées : les absences existent et la capacité les déduit (`heuresAbsenceSemaine`, `capacitePersonneSemaine`, `derive.ts:469-484`) — mais rien ne **confronte** un congé posé aux heures déjà planifiées cette semaine-là. Détection du conflit (charge > capacité réelle), proposition de report sur les semaines voisines ou l'autre personne — proposé, jamais appliqué seul | §9 ; retour 03/08 | 2 j |
| 5.13 | **[compléter]** Plan de charge prospectif : la vue « qui bosse sur quoi, quelle semaine » existe (`Planning.tsx:533`) mais regarde le présent. Projection à 3-6 mois — heures planifiées des phases à venir contre capacité, congés déduits — et la question qui motive tout : « un projet de X heures démarrant en juin : qui peut le prendre, et ça passe ? », en simulation simple avant engagement | §11 ; retour 03/08 | 3 j |
| 5.14 | **[audit]** Vérification des calculs de dérive de marge : `derivePrevision` (`derive.ts:212`) et la chaîne baseline → prévu → réel, recalculés à la main sur des cas connus de l'agence (reprise en cours de phase, coûts externes, temps non facturable, avenants). Le livrable est la recette chiffrée ET sa version en test statique — un calcul de marge qui dérive ne se voit pas à l'écran, il se voit au bilan. À faire **avant** 5.10, qui modifie la lecture des coûts externes | §11.3 ; retour 03/08 | 2 j |
| 5.15 | **[audit]** TVA : vérification du régime avec le cabinet — exigibilité (la mention imprimée est marquée « à confirmer », `types.ts:1375`), décaissements prévisionnels (`types.ts:1371`), et le cas du **crédit de TVA remboursable** que rien ne suit aujourd'hui. Recette chiffrée sur un trimestre réel | retour 03/08 | 1,5 j |
| 5.16 | **[compléter]** Cycle de vie des factures sur portail agréé : l'import CSV Chorus/PDP existe (`Connecteurs.tsx:36-37`, `Facture.transmissions`) mais le statut ne remonte pas dans l'écran Facturation. Statut visible par facture (déposée / validée / rejetée / payée), alerte sur rejet, rappel de dépôt pour tout client public sans transmission — et le socle est prêt pour la facturation électronique obligatoire | retour 03/08 ; réforme 2026-2027 | 2 j |
| 5.17 | **[audit d'usage]** Finance : « trop compliqué et plein de trucs inutiles ». La méthode est un inventaire écran par écran fait AVEC les deux utilisatrices — chaque carte marquée utilisée / jamais ouverte — puis masquage (jamais suppression) des cartes non utilisées derrière un repli, une décision documentée par carte. Simplifier sans mesurer l'usage reviendrait à supprimer ce que l'une des deux utilise en silence | retour 03/08 | 2 j |

**Dépendances du Lot 5.** 5.5 dépend de 5.4 et 5.6. 5.3 se lit avec 5.2 (les intempéries neutralisent des pénalités). 5.9 s'appuie sur B.13 (livré). 5.7 s'appuie sur A.11 (livré). **5.14 précède 5.10** — on n'étend pas un calcul de marge qu'on n'a pas vérifié. 5.12 et 5.13 s'appuient sur l'existant du plan de charge ; ils profiteront de B.4/B.5 branchés (pointages réels) sans en dépendre. Le reste est indépendant.

**Ordre conseillé.** D'abord 5.1 (défaut réel qui retient de l'argent aux entreprises à tort) et 5.14 (vérifier avant de bâtir) ; puis 5.4 → 5.6 → 5.5, la chaîne de la révision et du contrôle des situations, qui rapporte chaque mois ; le reste se séquence librement avec le Lot 2.


#### Complément du 04/08 — retours après livraison du lot

Trois demandes arrivées à l'usage, dont deux RÉVISENT des décisions du lot :

| # | Livrable | Réf. | Effort |
|---|---|---|---|
| 5.18 | **[révise 5.4]** Indices : historique COMPLET des séries (plus seulement 24 mois — l'application « pioche comme elle veut dedans ») et récupération AUTOMATIQUE au démarrage (au plus une fois par jour, silencieuse, jamais bloquante pour le démarrage hors ligne de M.1) — la décision « geste volontaire » de 5.4 est explicitement annulée par l'agence | retour 04/08 | 1,5 j |
| 5.19 | **[nouveau]** Certificat de paiement mensuel (état d'acompte) : le document que la MOE émet depuis une situation validée — avance forfaitaire et sa résorption, décompte cumulé/antérieur, révision (5.4), TVA, pénalités (5.2), retenue ou GPD (5.1), net à payer, cumuls, reste HT — généré en PDF sur le patron des quatre générateurs de `src/pdf.ts`, chaque ligne calculée PROPOSÉE et corrigeable. La photo du certificat réel n° 4 (MAM de Chamant) sert de jeu d'essai : la RG y vaut 5 % de l'avenant en TTC alors que la GPD couvre la base — preuve qu'aucune ligne ne doit être verrouillée | retour 04/08, photo du 04/08 | 4 j |
| 5.20 | **[nouveau]** Fiche entreprise transverse : par entreprise, tout ce qui la concerne — marchés (tous projets), situations en attente, certificats émis, RG retenue/à libérer, pénalités, désordres GPA, visas — avec l'objectif énoncé par l'agence : « simplifier la vie, pas la complexifier ». S'appuie sur le registre d'organisations existant, pas de nouvelle collection d'identité | retour 04/08 | 3 j |

Décisions prises sur mandat (« je te laisse décider ») : la position TVA suit
le régime de droit commun des services — collectée à l'encaissement,
déductible au paiement — réglable, et le cabinet valide ou corrige ; l'écran
d'entrée de la Finance devient « L'essentiel », six chiffres qui font agir,
zéro suppression d'onglet.

**Sous-total Lot 5 : 51 (42,5 + 8,5 du complément du 04/08) jours.**

---

### 4.6 **[nouveau]** Chiffrage et calendrier réaliste

**Ce que la version 1 ne disait pas.** Elle chiffrait chaque ligne et ne totalisait rien — ni lot, ni projet — ne nommait aucun exécutant et ne posait aucun calendrier. Pour une agence de deux architectes qui ne codent pas, c'est le manque le plus lourd du document, parce que c'est celui qui empêche de décider.

#### Totaux

| Lot | Contenu | Jours |
|---|---|---|
| **Lot 0** | Prérequis, corrections à coût quasi nul, cinq blocs d'accueil, trois tests de non-régression | **19** |
| **Lot 1 — vague A** | Mémoire des échanges, catégorisation, propositions, notifications, audit (1er étage) | **57,5** |
| **Lot 1 — vague B** | Tâches, pointages, chrono, fiche tâche, revue des propositions, modèles, audit (2e étage), mesure de parité | **61,5** |
| **Lot 1 — vague M** | Coquille hors ligne, recette mobile de la saisie existante, chrono au doigt | **6,5** |
| **Lot 1 (total MVP)** | | **125,5** |
| **Lot 2** | Décisions, risques, recherche, fin de journée, critère 15, carte des liens, recette mobile | **47,5** |
| **Lot 3** | Workspace, mémoire projet interrogeable, exports, encours comptable | **32,5** |
| **Total engagé** | Lots 0 à 3, hors conditionnels | **224,5 jours** |
| **Lot 5** | Retours d'usage du 03/08 — marchés, chantier, pilotage (**hors CDC**) | **42,5** |
| Lot 3 conditionnel | 3.11 pgvector, si et seulement si le plein texte échoue | +7 |
| Lot 4 | Non chiffré — dépend d'un troisième collaborateur | — |

Pour mémoire, la version 1 de ce plan totalisait environ **151 jours**. L'écart de **73,5 jours** n'est pas une dérive : c'est le coût des sections du CDC qui n'avaient aucun livrable et dont l'absence ne se voyait pas faute de total. Les trois postes principaux sont la catégorisation et les propositions du §5.2 / §8.7 / §12.3 (≈ 25 j), les écrans d'accueil et la fiche tâche du §8.1 / §8.2 / §19.3 (≈ 18 j), et le poste de travail mobile du §17 (7 j) — plus les corrections de séquencement, qui ne coûtent rien en jours mais évitent des régressions.

#### Ce que 224,5 jours veulent dire

Un « jour » ici est une journée pleine d'un développeur expérimenté qui connaît React, TypeScript, PostgreSQL et les RLS Supabase. **Aucune des deux associées n'est ce développeur.** Trois scénarios, avec leurs chiffres.

**Scénario A — un prestataire externe à temps plein.** 224,5 jours ≈ **11 mois** de travail continu. Aux tarifs courants d'un développeur senior indépendant (450 à 600 € HT/jour), cela représente **100 000 à 133 000 € HT**. Pour une agence de deux personnes, ce n'est pas finançable, et il faut le dire tel quel plutôt que de laisser le lecteur faire l'addition seul.

**Scénario B — une associée pilote un assistant de développement.** C'est le mode réel de production de ce dépôt. L'ordre de grandeur observé : un « jour-plan » consomme entre une demi-journée de pilotage (lignes simples : un champ, un écran de liste, un test statique) et deux à trois demi-journées (migrations, RLS, chaîne financière, tout ce qui touche `derive.ts` ou `sync.ts`). En moyenne pondérée, comptez **trois quarts de journée de pilotage humain par jour-plan**. Soit environ **165 journées de pilotage** pour les 221 jours. À raison d'**une journée par semaine** — ce qui est déjà beaucoup pour une associée en charge de projets —, cela fait **plus de trois ans**. À deux journées par semaine, environ **vingt mois**. C'est le vrai chiffre, et il condamne l'idée de livrer le CDC en entier.

**Scénario C — le noyau qui change la journée de travail, et rien d'autre.** C'est la recommandation. Périmètre :

| Bloc | Lignes | Jours |
|---|---|---|
| Lot 0 entier | 0.1 à 0.14 | 19 |
| Mémoire des échanges, sans les propositions | A.1 à A.7, A.12 | 37,5 |
| Tâches, temps, chrono, fiche | B.1 à B.9 | 37 |
| Poste de travail | M.1, M.3 | 4,5 |
| **Total noyau** | | **98 jours** |

Environ **74 journées de pilotage**, soit **dix-sept mois à une journée par semaine**, ou **huit à neuf mois à deux journées**. Ce noyau livre : tous les messages consultables avec leur source et leur projet, la tâche et sa fiche, le chrono, le temps horodaté sans que la marge bouge, l'accueil du §8.1, et le tout utilisable sur un téléphone hors réseau. Il satisfait les critères 1 à 8, 10, 14, et partiellement 6, 13 et 15. Il **ne** livre pas les propositions de tâches et d'échéances — donc il **acte une divergence avec le §20**, qu'il faut alors déclarer au client de ce plan, c'est-à-dire à l'agence elle-même. C'est le seul renoncement défendable : il est explicite, il est réversible (A.9 et A.10 se greffent après coup sans reprise, puisque `propositions` est une table neuve), et il préserve la doctrine.

#### Contraintes de calendrier qui ne se compressent pas

Certaines durées ne sont pas des jours-homme et ne se raccourcissent pas en travaillant plus :

- **Vérification DNS et souscription Workspace (0.9)** : quelques jours à quelques semaines chez Google. À lancer au jour 1 pour ne pas être sur le chemin critique du Lot 3.
- **Sept jours consécutifs de parité mesurée** avant B.15. Non négociable : c'est la seule protection contre une file d'entrée vidée en silence.
- **Trente jours d'observation** du plein texte avant de décider de pgvector (3.11). Décider avant, c'est décider sans mesure.
- **Expiration hebdomadaire des jetons** tant que 3.1 n'est pas livré : chaque semaine sans Workspace impose une reconnexion manuelle. C'est le seul point du dossier qui se dégrade tout seul si rien n'est fait — et c'est un argument pour lancer 0.9 tout de suite, indépendamment du reste.

---

## 5. Les quinze critères d'acceptation du §22

| # | Critère | État aujourd'hui | Lot qui le satisfait | Test qui le protège |
|---|---|---|---|---|
| 1 | Continuer à travailler depuis Gmail | **Satisfait** — rien ne force à quitter Gmail, l'application est en lecture seule | **[corrigé] Lot 0 (0.14)** — satisfait de fait, désormais **verrouillé** | `test-oauth-lecture-seule.cjs` |
| 2 | Chaque message projet est visible dans Cockpit | **Non** — seules les pièces jointes sont indexées ; un message sans pièce jointe n'existe nulle part | MVP A.2 + B.15 | — |
| 3 | Chaque message Cockpit peut être rouvert dans Gmail | **Non** — aucune URL de lecture n'existe, `threadId` n'est jamais capté | MVP A.1 + A.5 | — |
| 4 | Une tâche peut être créée depuis un e-mail | **Non** — « → Journal » archive sans créer de tâche ni poser le tag `a-faire` | MVP B.3 + B.10 | — |
| 5 | Une tâche peut être créée manuellement | **Partiel** — notes de journal taguées, sans responsable, priorité ni échéance | MVP B.1 + B.8 | — |
| 6 | Chaque collaborateur possède une vue personnelle | **Partiel** — filtre par personne non persisté, non relié à une identité | **[corrigé] Lot 0 (0.3 + 0.11)** puis MVP B.2 — le filtre existe déjà (`Cockpit.tsx:299`), le brancher sur `useMoi()` satisfait la moitié du critère des semaines avant B.2 | — |
| 7 | Le chrono est accessible en un clic | **Non** — aucune notion de chrono dans le dépôt | MVP B.6 + **M.3** (le §9.2 exige qu'il reste visible ; il n'y a pas de barre supérieure au bureau) | — |
| 8 | Le temps est rattaché à un projet ou une tâche | **Partiel** — projet et phase oui, tâche non | **[corrigé] MVP B.4 + B.9** — B.4 seul ne rattache rien à la tâche | test de conservation des totaux (B.5/B.9) |
| 9 | Une décision conserve sa source | **Non** — `DecisionDirection` n'a ni `projetId` ni source typée | Phase 2 (2.1), **détection dès le MVP (A.10)** | — |
| 10 | Une pièce jointe conserve le lien vers son e-mail | **Non** — mais l'identifiant existe côté serveur, il manque une ligne au `select` | **Lot 0 (0.6)** | — |
| 11 | Les propositions IA peuvent être acceptées, modifiées ou refusées | **Satisfait** — confiance, raisons, champs modifiables, rejet tracé | **[corrigé] Lot 0 (0.14)** pour l'existant, puis **A.2 + A.9 + B.10 + B.17** pour les entités nouvelles. La v1 portait un tiret : rien ne le protégeait | `test-propositions-modifiables.cjs`, puis `test-categorisation-propositions.cjs` |
| 12 | Les droits sont gérés par projet | **Non** — structurellement impossible sur un document JSONB unique | **[corrigé] Aucun lot engagé.** Le rattachement « Phase 4 (4.1) — et non recommandé avant » était un non-rattachement déguisé : ni date, ni engagement. Dit franchement : **ce critère n'est pas au périmètre de ce plan** et ne le sera qu'à l'arrivée d'un troisième collaborateur, événement dont la date est inconnue. Le plan ne prétend pas le satisfaire | — |
| 13 | Les actions sensibles sont historisées | **Partiel** — exemplaire sur la facture et le registre, absent ailleurs ; `updated_by` contient un UUID d'onglet | **[corrigé] Partiel à la fin du MVP** (0.5 + A.13 + B.16 : preuve sur le relationnel, déclaratif sur le JSONB), **complet à la fin du Lot 2** (2.6), **structurel au Lot 4** (4.5). Voir §3.16 : un trigger ne voit pas une mutation dans un JSONB | test statique « toute mutation auditée passe par l'assistant d'audit » (B.16) |
| 14 | Aucune réponse envoyée sans validation | **Satisfait structurellement** — périmètre OAuth en lecture seule, envoi délégué au brouillon Gmail | **[corrigé] Lot 0 (0.14)** — satisfait par construction, désormais **verrouillé contre l'ajout futur d'un périmètre d'écriture** | `test-oauth-lecture-seule.cjs` |
| 15 | Les données permettent un suivi prévu / réel | **Partiel** — complet sur les heures et les honoraires ; manquent la baseline stable et la cause de l'écart | **[corrigé] Lot 0 (0.13) + Lot 2 (2.13, 2.14)** — sorti du Lot 3 : aucun de ces trois livrables ne requiert Google, et la baseline se perd un peu plus à chaque « Recalculer la répartition » | — |

**Lecture.** Deux critères sont satisfaits et désormais **protégés par un test** au lieu de l'être par la bonne volonté ; un l'est de fait ; un se règle en une demi-journée en Lot 0 ; dix se répartissent sur le MVP et les deux phases suivantes ; un — le treizième — est **déclaré partiel** et le restera jusqu'au Lot 2, pour une raison structurelle expliquée et non contournée ; un — le douzième — **n'est rattaché à aucun lot engagé**, et c'est dit sans détour.

**La conséquence, qu'il faut écrire une fois clairement.** Le §22 ne présente pas ses quinze critères comme un catalogue d'options : il s'ouvre par « Le système est acceptable **si** », et les énumère. Un plan qui renonce au douzième livre donc, selon le texte même qu'il met en œuvre, **un système que ce texte déclare inacceptable**. Ce n'est pas un détail de rédaction : c'est la seule phrase qui compte pour l'agence au moment de signer. Deux issues honnêtes, et il faut en choisir une explicitement plutôt que de laisser la contradiction dormir : soit l'agence **amende le §22** en actant que les droits par projet ne sont pas un critère d'acceptation tant qu'elle compte deux associées qui partagent tout — c'est la recommandation de ce plan, et elle est cohérente avec le §11.2 du cahier des charges lui-même, qui rappelle que ces données servent « au pilotage, pas à une surveillance permanente » ; soit elle **maintient le critère**, et il faut alors provisionner les 50 à 70 jours du §6 et les inscrire au calendrier, ce qui déplace tout le reste. Ce que ce plan refuse, c'est la troisième voie : cocher le critère 12 sur un livrable qui ne le satisfait pas.

**Neuf critères déclarés satisfaits sans aucun test.** Les critères 2, 3, 4, 5, 6, 7, 9, 10 et 15 portent un tiret dans la colonne « Test qui le protège ». Le principe appliqué aux critères 1, 11 et 14 en Lot 0 n'a pas été étendu, et c'est une faiblesse assumée mais réelle. Le cas le plus exposé est le **critère 10** : il tient à un mot dans une chaîne — l'ajout de `source_id` au `select` de `src/entrants.ts:52-54` — exactement le genre de ligne qu'une réécriture de requête resupprime sans que personne ne le voie. Le **critère 15** est le second plus exposé : le §4.6 fait de la mesure prévu/réel un argument central, et rien ne vérifiera que « Recalculer la répartition » cesse bien d'écraser la baseline posée en 0.13. Ces deux-là au moins méritent leur test ; les sept autres relèvent d'un arbitrage que l'agence peut assumer.

---

## 6. Ce que je recommande de ne pas faire

Le CDC décrit un produit pour une agence qui grandit. L'agence compte deux personnes qui partagent tout, y compris les salaires de l'équipe qui sont dans le même document que le reste. Plusieurs exigences, prises au pied de la lettre, coûteraient des mois pour un bénéfice nul ou négatif.

**Ne pas construire le modèle de permissions du §14 maintenant (critère 12).** Le chiffrage honnête est de 50 à 70 jours : la normalisation relationnelle des collections sensibles seule représente 358 références de lecture et **189** sites d'appel `update()` à reprendre, avant même d'écrire un seul rôle. Pour deux associées qui voient déjà tout et doivent voir tout. Ce qu'il faut faire à la place, et qui est dans le plan : le registre d'identités (Lot 0, 4 jours), qui supprime les adresses en dur et rend l'ajout d'un collaborateur possible sans redéployer, et le journal d'audit (MVP, 6 jours en deux étages), qui satisfait partiellement le critère 13. Le reste attend un troisième collaborateur — et il l'attend **sans dette**, parce que toute donnée personnelle porte dès maintenant son `personneId`.

**Ne pas migrer les 38 collections en relationnel.** Cela reviendrait à jeter `derive.ts`, `economie.ts` et `facture.ts` — toute la chaîne financière, qui fonctionne et qui est la partie la plus mûre du produit — pour 2,9 Mo de données à régime.

**Ne pas automatiser le provisionnement Google (Admin SDK, §12.1 points 3 et 4).** Cela suppose de donner à Cockpit un compte de service en délégation à l'échelle du domaine, usurpant un super-admin, avec les droits de créer et supprimer des groupes et d'en éjecter des membres. On passerait d'un outil qui ne peut rien casser chez Google — c'est aujourd'hui une propriété **garantie** par le périmètre en lecture seule — à un outil qui peut désinscrire une collaboratrice d'un projet sur un bug. Pour une agence qui crée peut-être dix projets par an, créer le groupe à la main prend deux minutes. Le rapport risque / bénéfice n'est pas défendable.

**[nouveau] Ne pas créer automatiquement l'agenda projet (§12.1 pt 11).** Même raisonnement, appliqué au calendrier : `calendars.insert` exige le périmètre `calendar` en **écriture**, alors que le dépôt ne demande que `calendar.readonly` côté navigateur et **rien du tout** côté serveur. C'est précisément sur cette lecture seule que repose l'argument « le critère 14 est satisfait par construction et non par discipline ». Deux minutes de création manuelle par projet, un identifiant collé dans `Projet.calendarId`, et un export `.ics` déterministe (3.8) : le pont existe déjà dans `src/modules/Agenda.tsx:56-79`.

**[nouveau] Ne pas élargir le périmètre serveur au calendrier pour les suggestions de saisie (§9.7).** Le jeton serveur ne porte que `gmail.readonly openid email`. Y ajouter le calendrier imposerait un nouveau consentement, invaliderait le refresh token en place et ferait échouer `test-oauth-lecture-seule.cjs`. Les suggestions se calculent très bien depuis l'onglet ouvert, au moment où l'utilisateur regarde son écran Temps ; les préparer par cron n'apporte rien à qui saisit son temps une fois par jour.

**Ne pas développer d'extension Gmail (§21 Phase 3).** Un lien « Ouvrir dans Gmail » dans un sens et un bouton « Créer une tâche » dans l'autre couvrent le besoin réel. Une extension est un artefact à distribuer, à maintenir et à faire valider, pour gagner un clic.

**Ne pas construire les portails client et partenaires (§21 Phase 4).** Un portail signifie des comptes externes, une surface d'authentification publique, une politique de confidentialité et un support. Pour deux personnes, un PDF envoyé par mail fait le même travail — et le dépôt sait déjà générer des PDF datés.

**[nouveau] Ne pas écrire d'API maison (§10.3).** Même raisonnement. À partir du moment où `communications` et `pointages` sont des tables PostgreSQL avec RLS, Supabase les expose déjà en PostgREST : l'exigence est satisfaite **par construction**, et il serait à la fois absurde de la reconstruire et malhonnête de prétendre qu'elle n'est pas couverte. Ce qui manque est de la documentation et une vue de lecture (3.10, 1 jour), pas un serveur.

**[nouveau] Ne pas construire d'export comptable des temps ni d'export paie (§10.3).** Deux associées ne se font pas de fiches de paie sur la base de leurs pointages, et aucune écriture comptable ne se déduit d'une heure travaillée. **Mais il faut le dire, et la version 1 laissait ces deux lignes du §10.3 disparaître en silence.** En revanche, un manque comptable **réel** a été trouvé en cherchant celui-là : `src/comptable.ts` ignore la notion d'encours de production, alors qu'il a toutes les données pour la calculer. C'est le seul usage comptable légitime des pointages, et il est livré en 3.9.

**[nouveau] Ne rien changer au Backend ni au Stockage du §17 — les deux paragraphes que ce plan n'avait jamais cités.** Le §17 décrit quatre briques ; ce plan traite le Frontend (vague M) et la Base de données (4.5), et il faut dire pourquoi les deux autres ne donnent lieu à aucun livrable. **Backend** : le §17 demande « API sécurisée, synchronisation Google, traitement des événements, moteur de règles, gestion des tâches, du temps, recherche, traitement IA ». Sept de ces huit fonctions existent déjà et sont réparties entre les Edge Functions Supabase, `pg_cron` et les deux fonctions Vercel — une architecture serverless qui n'a ni serveur à administrer ni coût fixe, ce qui est exactement ce qu'il faut à une agence de deux personnes. La huitième, le moteur de règles, est `src/alerts.ts` et tourne côté navigateur ; le seul livrable qui la déplace est A.11, déjà au plan. Rien à reconstruire. **Stockage** : le §17 demande « Gmail pour les e-mails, Drive pour les documents, Cockpit pour les métadonnées, stockage objet éventuel ». Trois sur quatre sont déjà la règle du dépôt et le §4.3 du CDC les consacre ; la seule divergence est Drive, traitée au Lot 3 (3.5) et conditionnée à l'achat du domaine. Le stockage objet « éventuel » existe déjà sous la forme des deux buckets privés Supabase. Chiffrer ces deux paragraphes reviendrait à facturer l'existant.

**[nouveau] Ne pas ouvrir de chantier « rendre l'application responsive » (§17 Frontend).** Ce serait l'erreur la plus coûteuse du dossier : 15 à 20 jours pour refabriquer ce que `src/styles.css` et `src/ui.tsx` font déjà (§1.6). Le §17 Frontend est en réalité le domaine du CDC le plus près d'être satisfait — il l'était simplement sans que le plan le sache. Trois manques précis, 6,5 jours (M.1 à M.3), et une limite documentée plutôt que réparée (le File System Access API sur iOS).

**[nouveau] Ne pas construire de mécanisme de notification (§12.3 pt 10).** Le moteur d'alertes est déjà un système de notification qui ne porte pas ce nom : treize producteurs, gravité, identifiant stable, lien vers la source, action rapide, mise en sommeil, filtre par personne, badge de comptage. Il lui manque un destinataire (`Alerte.pour`) et trois producteurs. Construire un second canal donnerait deux files où traiter la même chose — exactement ce que le §3.12 refuse pour le `Courrier`. Ni e-mail sortant (il faudrait `gmail.send`), ni notification poussée (service worker, clé VAPID, permission navigateur, pour deux personnes qui ouvrent le Cockpit chaque matin).

**Ne pas mettre pgvector avant d'avoir mesuré l'échec du plein texte.** Sous 400 000 caractères par projet, le corpus tient dans le prompt. Entre 400 000 et 3 millions, un pré-filtre déterministe plus un index français suffit largement. Le vrai déclencheur des embeddings n'est d'ailleurs pas le volume mais le vocabulaire : quand les mails disent « vêture mélèze » et la question dit « bardage bois ». Un glossaire de synonymes métier, qui coûte une journée, repousse ce mur d'environ un an.

**Ne pas renommer les identifiants de projet en `AAAA-NNN`.** Cela casserait les liens existants, les journaux, `entrants.projet_id_propose` et le rattachement automatique par texte. La double clé coûte deux champs.

**Ne pas renuméroter l'arborescence documentaire selon l'exemple du §7.2.** L'arborescence du dépôt encode des besoins réels que le CDC ignore — `09_FACTURES` et `10_PHOTOS` — et elle porte la lecture d'avancement du projet. Renuméroter invaliderait tous les `cheminDrive` déjà enregistrés, qui sont des chaînes figées et non recalculables. On adopte l'intention du CDC (un dossier par phase là où c'est utile), pas sa numérotation.

**Ne pas demander `gmail.send` ni `gmail.modify` au MVP.** Cela invaliderait le refresh token existant, imposerait un nouveau consentement, ferait échouer `scripts/test-edge-functions-security.cjs` et — surtout — retirerait l'argument « lecture seule » affiché à l'utilisateur, qui est aujourd'hui la garantie du critère 14. Le rangement automatique de la boîte, que la routine « Tri du matin » demande déjà et reconnaît elle-même ne pas pouvoir faire, n'en vaut pas le prix.

**Ne pas construire le circuit de validation hebdomadaire des feuilles de temps (§10.2).** Validation par chef de projet, verrouillage, correction sous justification : cela suppose une hiérarchie et un tiers validateur qui n'existent pas. On garde ce qui a une valeur réelle — l'**historisation** des corrections (§9.6), qui protège contre l'oubli et non contre la fraude — et on laisse tomber le circuit.

**Ne pas mettre les tâches en relationnel dès le départ,** malgré la recommandation de l'analyse d'architecture. Le hors-ligne sur les tâches vaut plus, pour une agence qui travaille sur chantier, que la marge de fréquence d'écriture qu'on gagnerait. La sortie reste possible et est préparée. Contrepartie assumée et écrite au §3.16 : le journal d'audit reste déclaratif sur les tâches jusqu'au Lot 4.

**[nouveau] Ne pas convertir automatiquement une proposition en tâche, quel que soit le délai.** Une proposition non traitée reste une proposition. La tentation de « promouvoir après sept jours sans réponse » est forte et elle est refusée : elle viderait le critère 11 de son contenu, et la garantie n'est pas dans l'écran mais dans le domaine du type énuméré de `propositions.statut` (§3.14), ce qui la rend impossible à contourner par un module.

---

## 7. Risques et garde-fous

### 7.1 Les risques du §24, appréciés sur le code réel

| Risque §24 | Appréciation | Garde-fou |
|---|---|---|
| Quotas API Google | **Faible.** Une reprise de 25 000 messages coûte 0,0125 % du plafond quotidien. La vraie limite est 250 unités par seconde et par utilisateur | Découpage de la reprise en passages successifs du cron, déjà planifié |
| Synchronisation incomplète | **Élevé aujourd'hui.** La fenêtre fixe `newer_than:7d` avec `maxResults=25` fait perdre des messages **en silence** dès un pic de courrier | Curseur `internalDate` au MVP (A.1), `historyId` en Phase 2 (2.9) |
| Doublons | **Faible.** Le patron est déjà résolu : index unique partiel plus empreinte SHA-256 | Recopie du patron sur `gmail_message_id` et sur `propositions`, plus identifiant client sur chaque écriture de la file |
| Changements de droits | **Non couvert.** Un changement de droits est aujourd'hui une migration SQL éditée à la main, invisible du journal | Table `membres` (0.2) plus journal d'audit (A.13, trigger sur `membres`) |
| Erreurs de rattachement | **Maîtrisé.** Confiance, raisons lisibles, proposition toujours modifiable, file « à rattacher » | Cascade unifiée (A.4), mémorisation des corrections (A.4 pour le projet, 2.11 pour les trois axes) |
| Dépendance à Google Workspace | **Réel et assumé.** Le §3 entier en dépend | Le MVP entier est livrable sans Workspace ; c'est la contrepartie du séquencement choisi |
| Indisponibilité temporaire | **Maîtrisé sur les données, non couvert sur le chargement** | Marqueurs persistants, reprise sur `online`, file sérialisée — **plus la coquille applicative (M.1), sans laquelle un onglet sans réseau affiche une page blanche** |

### 7.2 Ce que les analyses ont révélé en plus

**L'expiration des jetons à sept jours est un défaut présent, pas un risque futur.** L'application OAuth en mode Test fait expirer les refresh tokens chaque semaine : l'ingestion serveur s'arrête et réclame une reconnexion manuelle. C'est le seul point du dossier qui se dégrade tout seul si rien n'est fait.

**Le conflit de synchronisation est collant et son arbitrage est destructeur.** Le seul geste de sortie abandonne les modifications locales. Tant que les écritures fréquentes ne sont pas sorties du document, deux postes actifs simultanément produisent un conflit que la seule issue disponible résout en perdant du travail. C'est pourquoi la sortie des pointages et du chrono n'est pas une optimisation mais une condition d'usage à deux.

**Le bucket `entrants` n'est jamais purgé.** Aucun appel `storage.remove()` n'existe dans le dépôt : après classement, la pièce jointe reste indéfiniment dans le bucket, en doublon du fichier rangé. C'est un sujet de conservation de données personnelles autant qu'un coût. Purge planifiée à 30 jours en Phase 2 (2.7) — et ce livrable ne dépend de rien, il peut être avancé à tout moment.

**Deux ingestions Gmail concurrentes coexistent.** Le chemin serveur toutes les 10 minutes et le chemin navigateur toutes les 60 secondes (`src/surveillance.ts:143`) écrivent tous deux dans l'état partagé, avec deux mémoires distinctes de « déjà vu » — une table côté serveur, un `localStorage` plafonné à 500 identifiants côté navigateur (`src/google.ts:169`). Un poste qui vide son stockage local recrée des doublons. **[corrigé]** Le chemin navigateur est retiré en **B.15, à la fin du MVP** et non en vague A : il est ce qui *alimente* la file d'entrée quotidienne, et le couper avant que le cron serveur ne soit prouvé la viderait en silence (§3.12).

**La copie locale complète n'est pas révocable.** L'état de l'agence, salaires compris, est persisté en clair dans `localStorage` sur chaque poste. Révoquer un accès côté serveur ne récupère ni n'efface cette copie. Ce n'est pas un problème à deux associées ; ce le devient le jour d'un départ. À traiter en même temps que 4.1, pas avant — et B.14 (départ d'un membre) le rappelle explicitement à l'écran plutôt que de le taire.

**Le coût variable de l'IA est réel mais modeste.** Environ 20 € par mois en régime permanent si l'on résume tous les messages, moins de 10 € en ne résumant que les messages rattachés. Les détections d'A.10 voyagent dans la **même** réponse que le résumé : elles n'ajoutent pas d'appel, seulement des jetons de sortie. La reprise d'historique passe par la Batch API. Ce n'est pas un risque budgétaire, c'est une ligne à surveiller.

**Le vocabulaire « entrants » induit en erreur.** La table `entrants` ressemble à une boîte de réception mais ne conserve ni le message, ni son fil, ni ses destinataires : c'est un index de **pièces jointes**. Confondre les deux ferait sous-estimer d'un facteur important la charge de la table `communications`.

**[nouveau] Le plus grand risque de ce plan n'est pas technique, il est calendaire.** 224,5 jours à deux personnes qui ne codent pas, c'est un projet de plusieurs années s'il est mené en entier. Le risque n'est pas de mal construire : c'est d'abandonner à mi-chemin, en laissant le Cockpit dans un état intermédiaire où `state.courriers` n'est plus alimenté et où `communications` n'est pas encore consulté. **Deux protections, et elles sont dans le plan :** chaque vague est livrable et utile seule (le Lot 0 seul améliore déjà la journée de travail), et aucune coupure d'alimentation ne précède son remplaçant prouvé (B.15 et ses sept jours de parité). Le scénario C du §4.6 existe précisément pour rendre l'arrêt volontaire possible sans dégât.

### 7.3 Garde-fous à conserver et à étendre

Ce que le dépôt fait déjà bien et qu'il faut protéger :

- **La validation humaine reste obligatoire partout.** Aucun livrable de ce plan ne crée d'action irréversible déclenchée par un modèle. La conversion automatique d'un message en tâche est explicitement écartée (§3.12), celle d'une proposition en tâche aussi (§6), et la garantie est portée par le domaine d'un type énuméré en base (§3.14), pas par une règle d'écran.
- **La traçabilité jusqu'à la source est étendue, jamais réduite.** Chaque entité nouvelle — communication, proposition, tâche, décision, pointage — porte sa source typée `{type, id}`. Les propositions portent en plus **l'extrait cité** du message, parce qu'un lien ne suffit pas à justifier une détection (§13.3). Et 2.15 livre la lecture inverse, qui manquait au §2 principe 10.
- **Le hors-ligne et l'export JSON sont des acquis.** Toute entité sortie du document emporte son cache et sa file d'envoi ; l'export JSON doit être **étendu** pour embarquer les tables relationnelles, faute de quoi la sauvegarde de l'agence deviendrait partielle sans que personne ne le remarque. Et le hors-ligne des données ne vaut que si l'application se charge : M.1.
- **[corrigé] Les tests statiques en CI sont le lieu où les décisions de ce plan deviennent opposables.** Il y a aujourd'hui **sept** scripts `scripts/test-*.cjs` (`package.json:15`), dont **six seulement sont statiques** : `test:finance` fait installer un Chromium par Playwright (`.github/workflows/ci.yml:58`). C'est sur ce socle-là, et pas sur huit, qu'on ajoute. À écrire :
  - `test-oauth-lecture-seule.cjs` — aucun périmètre d'écriture Google nulle part (0.14, **critères 1 et 14**) ;
  - `test-propositions-modifiables.cjs` — tout champ proposé a un pendant humain (0.14, **critère 11**) ;
  - `test-adresses-en-dur.cjs` — aucune adresse littérale, verrou de la bascule d'identité (0.14) ;
  - `test-categorisation-propositions.cjs` — GRANT au niveau colonne, domaine de `statut` sans statut métier, listes fermées identiques en base et en TypeScript, cible d'échéance bornée (B.17) ;
  - `test-conservation-totaux.cjs` — la double projection `pointages → state.temps` **et** `pointages → Tache.tempsEnregistre` conserve les totaux (B.5, B.9) — **c'est le seul garde-fou qui protège vraiment la marge** ;
  - `test-audit-chemin-ecriture.cjs` — toute fonction mutant une entité auditée passe par l'assistant d'audit (B.16) ;
  - `test-tableaux-responsive.cjs` — aucun `<table>` brut hors des sept modules recensés et de `src/ui.tsx` (M.4).
- **La sauvegarde côté serveur reste à traiter.** La restauration à un point dans le temps n'est pas disponible sur l'offre Supabase gratuite. En attendant un arbitrage sur l'abonnement, un export planifié nocturne remplace le geste manuel actuel, que la documentation impose aujourd'hui avant toute résolution de conflit — un geste humain qui ne tiendra pas à l'échelle relationnelle.
