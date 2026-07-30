# Plan de mise en œuvre — CDC « E-mails, tâches, temps et mémoire projet »

**Objet :** plan d'exécution du cahier des charges `docs/CDC_MAILS_TACHES_TEMPS.md` sur le Cockpit existant.
**Contexte :** agence de deux personnes, un poste chacune, application local-first synchronisée par un document unique.
**Principe directeur :** le CDC décrit un produit d'agence structurée. Le Cockpit est déjà un produit d'agence structurée sur d'autres domaines (finance, chantier, documents, veille). Le travail n'est pas de construire un outil, c'est de brancher trois domaines manquants sur un socle qui existe — et de lever trois verrous qui, tant qu'ils tiennent, rendent une partie du CDC non pas coûteuse mais impossible.

---

## 1. Ce qui existe déjà

C'est la bonne nouvelle du dossier, et elle change le périmètre : une lecture rapide du CDC laisse croire à une refonte, alors que l'essentiel de la mécanique demandée est déjà écrite, éprouvée en production et souvent plus exigeante que ce que le texte réclame.

### 1.1 La doctrine du CDC est déjà tenue, et mieux qu'il ne le demande

Le §15 (« l'IA propose, ne valide pas ») et le critère 11 (« propositions acceptables, modifiables ou refusables ») ne sont pas des objectifs : ce sont des invariants déjà appliqués, et surtout **garantis structurellement**, pas par convention d'interface.

- Le périmètre OAuth Google est en lecture seule — `gmail.readonly` et `calendar.readonly` dans `src/google.ts` et `supabase/functions/gmail-oauth/index.ts`. L'application ne peut techniquement pas envoyer, supprimer ni déplacer un message, quel que soit le code écrit au-dessus. Le critère 14 est donc satisfait par construction et non par discipline.
- Tout « envoi » ouvre un brouillon Gmail pré-rempli dans un onglet (`gmailComposeUrl` dans `src/util.ts`) : le clic « Envoyer » est fait par l'humain, dans Gmail, hors de l'application.
- L'ingestion serveur insère systématiquement `statut: 'a_valider'`, avec projet et catégorie seulement **proposés**. Les politiques RLS n'accordent aux comptes de l'agence que `select` et `update` ; toute écriture machine passe par le `service_role`. La séparation « qui propose » / « qui valide » est portée par la base de données, pas par l'écran.
- Chaque proposition automatique porte une confiance de 0 à 1 et une liste de raisons en français (« Contient l'identifiant du projet P03 », « L'expéditeur @… correspond à … »), dépliables via « Voir pourquoi ». Le classement est déterministe par lexique, donc reproductible et auditable — ce qu'aucune proposition par modèle ne permettrait.
- L'assistant serveur (`api/assistant.js`) ne renvoie que du texte, traite les sources comme des données non fiables encodées en JSON (défense contre l'injection indirecte), impose la réponse « Pas trouvé dans les sources fournies. » à défaut, et affiche systématiquement la mention « brouillon — à vérifier » avec le nom du modèle.

### 1.2 Le socle Gmail serveur est réel et réutilisable tel quel

- Consentement Google « offline » complet : `state` anti-CSRF lié à un cookie `__Host`, lien d'initiation signé, vérification que le compte connecté est **exactement** le compte configuré (relecture de `userinfo` chez Google, pas un JWT décodé), refresh token stocké dans une table privée sans aucune politique RLS — donc inaccessible au navigateur.
- Scan planifié toutes les 10 minutes par `pg_cron` + `pg_net` + Vault, avec en-tête `x-cron-secret` lu en base et jamais inscrit dans `cron.job`. Cela fonctionne onglet fermé.
- Traitement du cas `invalid_grant` : effacement du refresh token et message « Reconnexion requise » remonté dans l'interface.
- Décodage MIME complet, extraction des parties `text/plain` et `text/html`, décodage base64url, lecture d'en-têtes insensible à la casse.
- Et surtout, dans `supabase/functions/veille-mails/index.ts` : une **lecture Gmail incrémentale éprouvée** — curseur `internalDate` persisté, pagination bornée, tri du plus ancien au plus récent pour n'avancer le curseur qu'après traitement. C'est exactement le moteur dont le §4.1 a besoin. Il existe, il tourne en production, il sert seulement à un autre usage.

### 1.3 Le patron relationnel de sortie existe déjà

Le dépôt n'a pas à inventer son chemin vers PostgreSQL : il l'a déjà parcouru une fois. Les tables `entrants`, `veille_signaux`, `veille_jobs`, `veille_collectes`, `veille_pages`, `veille_field_evidence`, `veille_documents` et `veille_observations` sont en production avec RLS par adresse, `GRANT` explicites, clés étrangères, index, buckets Storage privés et une RPC de file d'attente en `FOR UPDATE SKIP LOCKED`. Le client fait du `.select().eq().order().limit()` classique, hors document JSONB et hors verrou de révision.

L'idempotence y est déjà résolue de la bonne manière : index unique partiel `entrants_source_unq (source, source_id, piece_index)` et empreinte SHA-256 par pièce. C'est le modèle exact à recopier pour dédoublonner un index de messages sur `gmail_message_id`.

### 1.4 Le registre documentaire dépasse le MVP du CDC

Le §7 est le domaine le plus avancé du dépôt. `DocumentRecord` porte la source (gmail / drive / dépôt / généré / plateforme), l'identifiant et l'URL de source, le chemin de rangement, le projet, la catégorie, la version avec `remplaceDocumentId`, neuf statuts, l'empreinte SHA-256, la confiance, les raisons, et un journal d'événements typé `{date, type, detail, auteur}`.

S'y ajoutent : arborescence projet normalisée en onze dossiers avec correspondance catégorie → sous-dossier, boîte d'arrivée `_A_CLASSER`, nomenclature automatique `AAAAMMJJ_PROJET_TYPE_objet(_vNN)`, dédoublonnage par empreinte à trois niveaux, écriture qui n'écrase jamais (contenu différent sous le même nom → suffixe `_v02`), chaîne de versions métier, et revue séquentielle au clavier (Entrée = classer, E = écarter).

### 1.5 Le pilotage du §11 est très largement livré

C'est le domaine où le CDC a le plus de retard sur le code. Existent et fonctionnent : temps prévu / consommé / restant par projet **et par phase**, reste à faire révisable phase par phase, alerte de dérive d'heures à seuil paramétrable, barème MIQCP actualisé, coût interne **réel** déduit de la rémunération chargée de chaque personne (plus aucun forfait), marge à date distinguée de la marge finale prévisionnelle, dérive de marge, € par jour réel comparé à l'objectif, rentabilité par client, ROI des appels d'offres, plan de charge par personne et par semaine avec congés déduits, comparaison de deux périodes de même durée avec écart signé, et revue de pilotage imprimable en PDF.

La doctrine financière y est explicite et défendable : cinq états des coûts externes jamais confondus, production estimée jamais présentée comme une écriture comptable, budget non daté jamais compté comme un coût.

### 1.6 Les autres acquis directement réutilisables

- **Migration d'état versionnée et sans perte** : `STATE_VERSION = 16`, une fonction `migrate()` qui rejoue seize paliers successifs, normalise toute collection absente et repersiste immédiatement. Toute source — locale, distante ou importée — repasse par `migrate()`. Ajouter une collection suit un rail balisé.
- **Fusion additive et cloisonnement** : `COLLECTIONS_ADDITIVES` empêche une version ancienne d'effacer une collection qu'elle ignore ; `etatPartageable()` retire les réglages machine et les documents privés avant chaque écriture ; `cibleSynchronisation()` interdit de rejouer une file préparée pour un projet Supabase sur un autre.
- **Mode hors ligne complet** : marqueur « en attente » persistant, marqueur de conflit survivant au rechargement, sauvegarde datée d'un document illisible, reprise automatique sur l'événement `online`, file d'envoi sérialisée avec réarmement après échec.
- **Centre d'actions unifié** dans le Cockpit : une file qui agrège situations à vérifier, consultations à étudier, factures à émettre, comptes-rendus à sortir, notes « à faire » et alertes, triée par gravité puis échéance, avec filtre par personne, horizon 7 jours et revue séquentielle « une décision à la fois ». C'est le squelette de la vue « Aujourd'hui » du §8.2.
- **Journal d'audit financier exemplaire** : copie figée à l'émission avec empreinte SHA-256, numéro légal séquentiel, correction uniquement par avoir. Le §14.4 a déjà son modèle de référence dans le dépôt.
- **Huit scripts de test statiques en CI** (`scripts/test-*.cjs`) couvrant les invariants de facture, la sécurité des Edge Functions, l'état de synchronisation et la procédure de mise en production. Toute règle nouvelle peut y être ancrée.

### 1.7 Ce que cela change au périmètre

Sur les quinze critères d'acceptation du §22, deux sont déjà satisfaits structurellement (11 et 14), un l'est de fait (1), un l'est à une ligne de code près (10), et deux le sont pour l'essentiel côté données (15 pour le temps et les honoraires, 6 pour l'ossature). **Le vrai reste à faire tient en trois domaines : l'index des messages, l'entité tâche, et le chrono horodaté.** Tout le reste est du raccordement.

---

## 2. Les trois verrous

Trois prérequis bloquent des pans entiers du CDC. Ils ne sont pas de même nature : le premier est un achat, le deuxième est une notion absente du modèle, le troisième est une limite d'architecture. Aucun ne se contourne par du code appliqué ailleurs.

### 2.1 Premier verrou — le domaine et Google Workspace

**Ce qu'il bloque.** Sans nom de domaine vérifié et sans tenant Google Workspace, les §3.2 (adresse par projet), §3.4 (envoi depuis l'adresse projet), §3.5 (Cockpit pilote les paramètres Google), §12.1 points 2 à 5 (création du groupe, ajout des membres, autorisations d'envoi) et §12.2 (accès Drive à l'arrivée d'un membre) ne sont pas « à faire » : ils sont **impossibles**. Google Groups, les alias de domaine, l'Admin SDK et l'alias d'envoi auto-vérifié n'existent tout simplement pas sur des comptes `@gmail.com` personnels — Google exige alors un code de confirmation envoyé à l'adresse, ce qui interdit toute automatisation.

**Ce qu'il coûte aujourd'hui, en plus de bloquer.** L'argument décisif n'est pas le confort, c'est un défaut opérationnel présent. Le guide intégré (`src/modules/Parametres.tsx`) recommande une application OAuth de type « Externe » en mode Test. Dans ce mode, Google fait expirer les refresh tokens au bout de sept jours : **l'ingestion serveur s'arrête chaque semaine et réclame une reconnexion manuelle**. La seule alternative sans Workspace serait de publier l'application en Externe ; comme elle demande `gmail.readonly`, qui est un périmètre restreint, cela déclenche la vérification Google et une évaluation de sécurité CASA annuelle payante. Une application de type « Interne », qui n'est proposée que dans un projet Cloud rattaché à une organisation Workspace, supprime les deux d'un coup.

**Le coût.** Ordre de grandeur à confirmer au déploiement, comme le demande le §23 : domaine 10 à 15 € par an ; Google Workspace Business Standard environ 14 € par utilisateur et par mois hors taxes, soit environ 340 € par an pour deux licences. Business Starter est moins cher mais n'inclut pas le Drive partagé, que le §23 exige explicitement. S'y ajoute la migration d'identité : recréation des comptes, lien magique Supabase, RLS, nouveau consentement OAuth.

**Décision recommandée.** **Souscrire Business Standard sur un domaine au nom de l'agence, dès maintenant, mais ne rien faire dépendre de cette souscription avant la Phase 3.** C'est la seule arbitrage honnête : l'achat se justifie tout seul par la suppression de l'expiration hebdomadaire et de l'évaluation CASA, et il faut des semaines pour vérifier un domaine et migrer deux identités — autant commencer tôt. Mais tout le MVP est réalisable sur les comptes actuels, et le séquencer derrière un abonnement serait une erreur de planification.

**Corollaire immédiat, indépendant de l'achat.** Les deux adresses de l'agence apparaissent en dur à 23 endroits en SQL (16 dans la migration d'ingestion, 2 dans la migration workspace, 2 dans `schema.sql`, 3 dans le script d'opérations) et dans les constantes `AGENCE` de 5 Edge Functions, plus une variable d'environnement côté Vercel. `supabase/README.md` demande même de « conserver exactement la même liste » à la main. Une bascule de domaine faite dans cet état **verrouille l'agence hors de son propre outil** : authentification, ingestion planifiée et accès au bucket coupés d'un seul coup. Le découplage des identités doit donc être fait **avant** l'achat, pas après. Il est en Lot 0.

### 2.2 Deuxième verrou — la notion d'utilisateur courant

**Ce qu'il bloque.** L'application ne sait pas qui est devant l'écran. Ce n'est pas une lacune d'interface, c'est une absence dans le modèle : une personne est une **chaîne de caractères** (`TempsEntry.personne`, `Projet.responsable`, `DocumentRecord.validePar` valent « Julien »), le type `Personne` ne porte ni e-mail ni rôle, et l'e-mail de la session Supabase — qui existe et est lisible — n'est utilisé que comme décoration dans deux écrans. `src/modules/Documents.tsx` va jusqu'à signer les validations avec `settings.personnes[0]` : le premier de la liste est réputé être tout le monde.

Sans sujet identifiable, il n'y a pas de « Mes tâches » (§8.3), pas d'unicité du chrono actif (§9.4), pas de validation par un tiers (§10.2), pas de journal d'audit nominatif (§14.4), et aucune RLS par utilisateur ne peut être écrite un jour. Le critère 6 est inatteignable et le critère 13 serait rempli d'identifiants de navigateur — car `workspace.updated_by` reçoit aujourd'hui `MON_ID`, un UUID régénéré à chaque onglet.

**Ce qu'il coûte.** Peu, et c'est ce qui rend son absence coûteuse : quelques jours. Ajouter `email?: string` à `Personne`, publier la session de façon réactive (aujourd'hui `sync.ts` expose un singleton non observable — une connexion par lien magique ne re-rend aucun écran), écrire un `useMoi()` qui résout la session vers une `Personne`, et corriger `majPersonne` dans les Paramètres pour qu'un renommage réécrive les références. Ce dernier point est un **bug latent** : renommer quelqu'un orpheline aujourd'hui, en silence, ses pointages, ses absences, ses affectations projet et tous les champs `pour`.

**Décision recommandée.** **Identité à deux étages, posée en Lot 0, avant toute autre écriture.** La session Supabase quand elle existe, sinon un choix « je suis X » mémorisé par poste dans `localStorage` — jamais dans `settings`, sinon il partirait dans le document partagé et les deux postes s'écraseraient mutuellement. À défaut des deux, `null`, et chaque écran conserve exactement son comportement actuel, donc aucune régression. Ce repli n'est pas une facilité : la synchronisation Supabase est optionnelle et revendiquée comme telle, et un Cockpit non synchronisé doit rester utilisable.

En cible, la clé de rattachement devient `personneId` et non plus le nom. La migration est du ressort de `migrate()`, qui a déjà franchi seize paliers — le rail existe.

### 2.3 Troisième verrou — le document JSONB unique

**Ce qu'il bloque.** Tout l'état applicatif vit dans `workspace.data jsonb` : 37 collections, un document mesuré à 50 Ko à l'amorce et projeté à environ 2,9 Mo à régime **sans le CDC**. La seule granularité d'écriture est le document entier. Trois murs sont franchis dès qu'on y verse ce que le CDC demande.

- **Le quota `localStorage`.** `persist()` sérialise tout l'état à chaque mutation dans `cockpit-ll-v1`. Le quota est d'environ 5 Mo par origine. Un index de messages le fait sauter dès la première année, et le code ne peut que le signaler proprement : le mode hors ligne s'effondre en premier. Avant même le quota, `structuredClone` puis `JSON.stringify` de l'état entier à chaque frappe rendraient l'interface inutilisable.
- **La charge Realtime.** `src/sync.ts` prévoit déjà le cas du « payload tronqué » et retombe sur un `tirerEtat()` complet — ce qui, à 18 Mo, signifie retélécharger 18 Mo à chaque notification.
- **Le verrou de révision global.** `enregistrer_workspace` n'écrit que si `w.revision = p_expected_revision`. Aujourd'hui les écritures sont rares et humaines, les collisions anecdotiques. Avec le CDC, chaque démarrage de chrono, chaque changement de statut de tâche et chaque message ingéré devient une révision. Et le conflit est **collant** : il pose un marqueur persistant, le callback Realtime refuse alors d'appliquer l'état distant, et la seule issue est « Récupérer la version partagée » — un geste explicite qui abandonne les modifications locales. Deux postes actifs entreraient en conflit permanent, arbitré par un geste destructeur. C'est la conséquence la plus grave de toute l'analyse.

**Ce que ça coûte de le lever, et ce que ça coûte de trop le lever.** Migrer les 37 collections en relationnel reviendrait à jeter `src/derive.ts`, `src/economie.ts` et `src/facture.ts` — toute la chaîne financière — pour un bénéfice nul : à régime ces collections pèsent 2,9 Mo au total. Ce serait l'usine que ce plan doit éviter. À l'inverse, ne rien sortir rend le CDC inapplicable.

**Décision recommandée.** **Ligne de partage par la nature de la croissance.** Ce qui croît avec le **temps** sort ; ce qui croît avec l'**activité** et reste borné à quelques milliers d'objets reste. Le détail entité par entité est tranché en §3.1.

**Corollaire non négociable.** Le patron relationnel existant (`entrants`, `veille_*`) est bon pour le schéma et **insuffisant pour le client** : `clientSupabase()` retourne `null` sans session, `listerEntrantsDistants()` renvoie alors `[]`, et toutes les lectures de `src/veille.ts` échouent. Ces tables sont purement en ligne. Recopier ce patron tel quel pour les communications, le temps et les tâches supprimerait le hors-ligne exactement sur les trois entités les plus utilisées au quotidien — le chrono en déplacement, les tâches sur chantier. C'est le piège principal de la migration. Toute entité qui quitte le JSONB emporte donc avec elle un cache IndexedDB et une file d'écritures idempotentes.

---

## 3. Décisions d'architecture

### 3.1 Quelles entités quittent le document JSONB — décision entité par entité

**Sortent du JSONB, au MVP :**

| Entité | Pourquoi elle sort |
|---|---|
| `communications` (index des messages) | Poste volumétrique dominant : environ 937 octets par message mesuré sur un enregistrement §18 réaliste, soit 13 Mo par an à 60 messages par jour — contre 2,9 Mo pour **tout** le document actuel à régime. Table neuve, sans donnée à reprendre, sans code existant à casser. |
| `pointages` (entrées de temps horodatées) | Volume modeste en octets (environ 1,5 Mo par an) mais **400 fois** le nombre d'enregistrements du modèle hebdomadaire, et surtout une vingtaine d'écritures par jour et par personne, qui deviendraient autant de cycles compare-and-swap. C'est la fréquence, pas la taille, qui commande la sortie. |
| `chrono_actif` | Une ligne par personne, écrite aux seules transitions démarrer / pause / reprendre / arrêter. Mettre un chrono qui tique dans le document partagé le ferait battre à chaque seconde. |
| `journal_audit` | Un journal logé dans un document que l'utilisateur peut intégralement remplacer par `replace()` et exporter en JSON n'a **aucune valeur probante**. Il doit être en append-only côté serveur, insertion refusée aux comptes applicatifs, ou il ne sert à rien. |

**Restent dans le JSONB, y compris la nouveauté :**

| Entité | Pourquoi elle reste |
|---|---|
| Les 37 collections actuelles | Projets, phases, marchés, situations, factures, contrats, échéances, paiements, référentiels, prompts, réglages : elles croissent avec l'activité, restent bornées à quelques milliers d'objets, et la fusion additive, les seize paliers de `migrate()` et le hors-ligne y fonctionnent déjà très bien. |
| **`taches` (nouvelle collection)** | **Décision explicite, contre l'une des analyses.** Le volume est borné (une agence de deux personnes produit quelques centaines à quelques milliers de tâches par an, soit moins d'un mégaoctet) et la fréquence d'écriture reste **humaine** — quelques dizaines par jour au plus, exactement le régime que le verrou compare-and-swap absorbe déjà sans peine sur 181 sites d'appel `update()`. Ce qui tue le verrou, c'est le chrono qui tique et l'ingestion continue, pas un changement de statut de tâche. En contrepartie, on gagne le hors-ligne immédiatement, sans écrire une ligne de couche IndexedDB, et on réutilise un rail de migration éprouvé. |
| `registreDocuments` | Fonctionne, est riche, et sa croissance reste absorbable au moins deux ans. Le sortir maintenant coûterait cher sans rien débloquer. |

**Seuils de sortie, à mesurer et non à deviner.** `taches` et `registreDocuments` sont conçues pour pouvoir sortir plus tard : identifiants stables, aucune donnée dérivée stockée, aucune dénormalisation. On les sort si l'un de ces seuils est franchi — document partagé au-delà de **3 Mo**, plus de **5 000 tâches**, ou arrivée d'un troisième collaborateur avec besoin réel de droits par projet. Un compteur de taille est déjà affiché à l'utilisateur ailleurs dans l'application (`Assistant.tsx` alerte au-delà de 2 M caractères de corpus) : le même geste s'applique.

### 3.2 Que devient le verrou compare-and-swap ?

**Décision : le conserver tel quel sur le JSONB résiduel, l'abandonner pour les tables relationnelles.**

Le compare-and-swap global est correct et bien implémenté ; son défaut n'est pas sa logique mais son **grain**. Une fois les écritures fréquentes sorties dans des tables où deux `insert` concurrents ne se gênent pas, le document résiduel ne reçoit plus que des écritures de configuration, de finance et de tâches — rares et humaines, exactement le régime pour lequel le verrou est dimensionné. Cela résout le conflit le plus grave **sans réécrire `sync.ts`**, et retire le marqueur de conflit collant du chemin quotidien.

### 3.3 Comment préserver le hors-ligne sur les entités sorties ?

**Décision : cache IndexedDB en lecture sur une fenêtre utile, plus une file d'écritures idempotentes.**

- Fenêtre de cache : messages et tâches des 90 derniers jours, pointages du mois courant. Au-delà, la consultation exige le réseau — c'est acceptable, personne ne relit un mail de l'an dernier en déplacement.
- IndexedDB est déjà utilisé dans le dépôt (`src/fsdrive.ts`, base `cockpit-ll-fs`) : la dépendance n'est pas nouvelle.
- Chaque écriture locale porte un **identifiant client généré côté navigateur**, sur le modèle de `MON_ID` dans `sync.ts`, qui sert de clé d'unicité serveur. Rejouer la file deux fois ne crée pas de doublon. Cela satisfait directement l'exigence §24 « actions idempotentes », et le patron d'index unique partiel de `entrants_source_unq` est déjà exactement cette mécanique — il se recopie.

### 3.4 Que devient la feuille de temps hebdomadaire ?

C'est la décision la plus délicate du plan, parce que toute la chaîne financière en dépend : `heuresReelles`, `coutReelTemps`, `analyserPeriode`, `tempsParPersonne`, la marge, le coût horaire réel, la comparaison prévu / réel du §11.3 et la revue PDF lisent tous `state.temps`, filtré sur le champ `semaine`.

**Décision : le pointage horodaté devient la source de vérité unique ; la grille hebdomadaire `state.temps` devient une projection dérivée, recalculée à chaque écriture de pointage, et reste le mode de saisie rapide.**

Concrètement :
- Écrire un pointage (chrono arrêté, ou saisie manuelle) écrit dans la table `pointages` **et** met à jour la cellule hebdomadaire correspondante dans `state.temps`.
- Saisir une cellule à la main dans la grille existante crée un pointage synthétique — journée entière, sans heure précise, `source: 'saisie_hebdo'`.
- `state.temps` conserve **exactement** sa forme actuelle. `src/derive.ts` n'est pas touché. La chaîne financière ne change pas d'une ligne.

Pourquoi ce montage plutôt que « faire lire les deux sources aux dérivés », proposé par une des analyses : parce que `derive.ts` est synchrone et travaille sur `AppState`, alors que les pointages vivent dans une table relationnelle qui n'est pas disponible hors ligne de façon synchrone. Faire lire deux sources à `heuresReelles` créerait deux vérités qui divergeraient en silence sur la marge. La projection résout le problème sans arbitrage permanent : il n'y a qu'une source, et une vue matérialisée dans le document.

Corollaire : la grille cesse d'être **destructive**. Aujourd'hui vider une cellule supprime l'entrée et modifier une valeur l'écrase sans trace, ce qui rend le §9.6 (« toute correction importante doit être historisée ») inapplicable. Avec les pointages, la correction devient un événement daté et attribué.

### 3.5 Où stocke-t-on le chrono en cours ?

**Décision : table dédiée `chrono_actif` (une ligne par personne, contrainte d'unicité en base), avec repli `localStorage` quand la synchronisation est inactive.**

Deux analyses divergeaient : l'une proposait `localStorage` seul au MVP, l'autre une table dès le départ. Je tranche pour la table, pour deux raisons. D'abord, une fois la table `pointages` créée, le coût marginal d'une table à une ligne par personne est nul. Ensuite, `localStorage` seul survit au rechargement mais **pas au changement de poste**, et l'unicité « un seul chrono actif par utilisateur » du §9.4 ne se garantit pas côté client — elle se garantit par une contrainte d'unicité, ou pas du tout. Le repli local préserve le local-first.

Le chrono n'écrit **jamais** via `update()` : chaque appel réécrit et repousse le document complet.

### 3.6 Quel moteur de synchronisation Gmail ?

**Décision : réutiliser le curseur `internalDate` de `veille-mails` pour le MVP, `users.history.list` en Phase 2.**

Le code existe, il est testé, il gère déjà pagination bornée, tri chronologique et reprise. La requête actuelle de `gmail-ingestion` — `in:inbox has:attachment newer_than:7d` avec `maxResults=25` — est une fenêtre fixe : un pic de courrier fait perdre des messages en silence, et les suppressions ou changements de libellés ne sont jamais vus. `history.list` coûte 2 unités de quota contre 5 et donne les modifications, pas seulement les ajouts ; c'est mieux, mais c'est une réécriture, pas une réutilisation. On garde le gain immédiat au MVP.

Le quota n'est pas la contrainte : une reprise d'historique de 25 000 messages coûte 125 000 unités, soit 0,0125 % du plafond quotidien. Les contraintes réelles sont le plafond de 250 unités par seconde et par utilisateur, et le temps d'exécution d'une Edge Function — donc une reprise découpée en passages successifs du cron.

Autre décision liée : **capter les métadonnées dès maintenant**, avec `format=metadata` et des `metadataHeaders` ciblés (To, Cc, Message-ID, In-Reply-To, References). Cela coûte les mêmes 5 unités que `format=full` pour une réponse 10 à 50 fois plus légère. Sans `threadId` capté à l'ingestion, le bouton « Ouvrir dans Gmail » du §4.2 est infaisable a posteriori.

### 3.7 Sur quoi rattache-t-on un message à un projet, faute d'adresse projet ?

**Décision : cascade déterministe avec confiance et raisons affichées, IA en dessous du seuil seulement, et mémorisation de chaque correction humaine comme règle réutilisable.**

Cascade, du signal le plus fort au plus faible : fil de discussion déjà rattaché → adresse d'un participant déclaré (`Projet.emailMOA`, `Contact.email`, `MarcheTravaux.contactEmail`) → domaine de l'expéditeur rapproché de `Entreprise.domaines` → identifiant ou nom de projet dans l'objet.

Le fil est le signal le plus fort une fois `threadId` capté : un seul rattachement humain propage tout le fil. Et la mémorisation des corrections est le critère 5 du §5.1, aujourd'hui totalement absent — c'est aussi le mécanisme qui rend le système meilleur avec l'usage sans jamais donner la main à un modèle.

Corollaire : les **trois moteurs de rattachement divergents** actuels (`classer()` serveur, `devinerProjet()` navigateur, `rapprocherProjet()` import) doivent converger vers une seule implémentation, sinon la même question reçoit trois réponses différentes selon le chemin d'entrée.

### 3.8 Où appelle-t-on l'IA pour les résumés ?

**Décision : nouvelle Edge Function dédiée avec son propre secret Supabase, sa propre limitation de débit, et le même garde-fou « brouillon à relire ».**

`api/assistant.js` n'est **pas** appelable depuis un cron : il exige un JWT Supabase d'un utilisateur de la liste blanche et limite à 10 requêtes par minute et par utilisateur. Cette vérification est précisément ce qui empêche aujourd'hui l'exposition de la clé Anthropic — l'ouvrir à un appel machine serait défaire la seule protection de la clé.

Périmètre et coût : **tout indexer en métadonnées, ne résumer que les messages rattachés à un projet**. Le résumé est le seul poste de coût variable — environ 20 € par mois en régime permanent sur 120 messages par jour, moins de 10 € en filtrant sur les messages rattachés. La reprise d'historique passe par la Batch API, qui n'est pas sensible à la latence et coûte moitié moins.

### 3.9 Google Drive ou Drive local ?

**Décision : découpler d'abord, trancher ensuite. Conserver le File System Access API au MVP.**

`DocumentRecord` porte déjà `source`, `sourceId`, `sourceUrl` et `cheminDrive` : il suffit d'ajouter `driveFileId`, `phase` et `auteur` pour que le registre devienne **agnostique du lieu de stockage**. Cela livre la double traçabilité du §7.3 immédiatement.

Basculer sur l'API Drive avant d'avoir Workspace ferait payer le coût OAuth et la vérification Google **sans gagner** ni le Drive partagé ni les droits par projet, qui sont les seules vraies raisons de basculer. La couche `src/fsdrive.ts` est une abstraction propre avec seulement sept sites d'appel : le remplacement restera contenu le jour venu.

### 3.10 Quel format de code projet ?

**Décision : double clé. `id` interne inchangé (`P01`), plus un `codeExterne` (`2026-034`) et une `adresseProjet` portés par le projet.**

Renommer les identifiants casserait les liens, les journaux et `entrants.projet_id_propose` déjà en base. Surtout, un identifiant à deux caractères comme adresse ferait exploser les faux positifs du rattachement par texte. Ajouter deux champs ne coûte presque rien et peut être fait dès maintenant, sans Workspace.

### 3.11 Combien de statuts de tâche ?

**Décision : stocker les neuf statuts du §8.6 dès le premier jour, n'en exposer que cinq au MVP** (À faire, En cours, En attente, Terminée, Annulée).

Le type est le point difficile à migrer ensuite — badges, filtres, tables de correspondance avec les cinq vocabulaires de statut déjà existants dans le dépôt. Le menu déroulant, lui, s'élargit sans migration.

Décision liée : `TacheChantier` **n'est pas** la tâche du CDC et ne doit pas être étendue. C'est un jalon de planning travaux, régénéré et supprimé **en masse** par l'onglet DCE (`filter` sur `lotDceId`) — y loger des tâches personnelles détruirait temps saisi et commentaires au premier « Replanifier ». La nouvelle entité s'appelle `TacheInterne` pour éviter la collision de vocabulaire, et peut référencer un jalon de chantier sans se confondre avec lui.

### 3.12 Que devient le `Courrier` existant ?

**Décision : le `Courrier` cède l'action à la tâche et devient une vue « à traiter » sur la table `communications`.**

Aujourd'hui `Courrier` a un statut `a_traiter` / `traite` ; une fois traité il disparaît et n'est plus consultable par projet. C'est une boîte de réception, pas une mémoire projet — l'inverse de ce que demandent le §4.3 et le critère 2. Le garder actionnable **en parallèle** des tâches ferait traiter le même message à deux endroits.

La conversion automatique d'un courrier en tâche est à exclure : elle viderait de son sens la validation humaine du §8.7 et du critère 11. Le bouton « Créer une tâche » produit une tâche avec `source: {type: 'mail', id}` — c'est un geste, pas un automatisme.

### 3.13 Le contrat des modules

`docs/CONTRAT_MODULES.md` interdit de modifier les fichiers partagés (`types.ts`, `store.tsx`, `App.tsx`, `derive.ts`, `alerts.ts`…) et pose « AUCUN appel API vers un modèle d'IA ». Il est **factuellement caduc** sur le second point — `api/assistant.js` existe et appelle l'API Anthropic — et il interdit littéralement ce que le CDC exige sur le premier.

**Décision : le réviser en Lot 0, avant toute ligne de code.** Continuer à coder « au contrat » produirait des statuts dupliqués module par module et des contournements locaux — précisément la dette que ce chantier doit éviter. La révision conserve l'esprit (un module = un fichier, l'humain valide, tout est traçable) et lève les deux interdits devenus faux.

---

## 4. Le plan par lots

Les estimations sont des **ordres de grandeur en jours**, à ajuster ; elles servent à comparer les lots entre eux, pas à engager une date.

### Lot 0 — Prérequis

> **Objectif :** poser l'identité, découpler les adresses en dur et livrer les corrections à coût quasi nul, pour qu'aucun lot suivant ne construise sur du sable.

| # | Livrable | §CDC | Effort |
|---|---|---|---|
| 0.1 | Réviser `docs/CONTRAT_MODULES.md` : lever l'interdit sur les fichiers partagés et sur les appels IA serveur, conserver la doctrine de validation humaine et de traçabilité | — | 0,5 j |
| 0.2 | Table `membres` (compte ↔ personne ↔ rôle ↔ actif) et fonctions `est_membre_actif()` / `role_courant()` en `security definer`, appelées par toutes les politiques ; suppression des 23 adresses littérales en SQL et des 5 constantes `AGENCE` | §3.1, §14.2, §23 | 3-5 j |
| 0.3 | `Personne.email` ; session Supabase rendue **réactive** (aujourd'hui `sync.ts` expose un singleton non observable) ; `useMoi()` à deux étages avec repli par poste | §8, §18 Collaborateur | 2 j |
| 0.4 | Correction de `majPersonne` : un renommage réécrit `temps`, `tempsHorsProjet`, `absences`, `responsable`, `coResponsable`, `equipeProjet`, et les champs `pour` — **bug latent existant** | §10 | 1 j |
| 0.5 | `workspace.updated_by` renseigné depuis `auth.uid()` au lieu de `MON_ID` | §14.4, critère 13 | 0,5 j |
| 0.6 | **Lien Gmail sur les pièces jointes** : ajouter `source_id` au `select` de `src/entrants.ts`, le propager dans `creerDocument`, construire l'URL de lecture | §7.3, **critère 10** | 0,5 j |
| 0.7 | Champs neufs sans dépendance externe : `Projet.codeExterne`, `Projet.adresseProjet`, `Projet.driveFolderId` ; `DocumentRecord.phase`, `driveFileId`, `auteur` | §3.2, §7.3, §18 | 1 j |
| 0.8 | Création de l'arborescence documentaire à la fin de l'assistant « Nouveau projet » (aujourd'hui bouton manuel) | §12.1 pts 6-7 | 0,5 j |
| 0.9 | Achat du domaine et souscription Google Workspace Business Standard — **décision de l'agence, hors code**, à lancer maintenant car la vérification DNS et la migration d'identité prennent des semaines | §23 | achat |

**Dépendances :** aucune. Ce lot ne dépend de rien et tout dépend de lui.
**Critère de fin :** aucune adresse e-mail n'est plus écrite en dur dans le dépôt ; renommer une personne dans les Paramètres ne perd aucune donnée ; une pièce jointe classée affiche un lien qui rouvre son e-mail dans Gmail ; l'écran affiche qui est connecté et le déduit de la session quand elle existe.

---

### Lot 1 — MVP

> **Objectif :** faire entrer les messages, les tâches et le temps dans le Cockpit, avec leur source, sans casser le hors-ligne ni la chaîne financière.

Le lot se livre en deux vagues séquentielles. La première est autonome et apporte l'essentiel du gain ; la seconde en dépend peu mais gagne à venir après.

#### Vague A — la mémoire des échanges

| # | Livrable | §CDC | Effort |
|---|---|---|---|
| A.1 | Enrichir l'ingestion : `To`/`Cc`, `threadId`, `Message-ID`/`In-Reply-To`/`References`, `labelIds`, date d'envoi distincte de la réception, corps du message ; passage au curseur `internalDate` réutilisé de `veille-mails` | §3.3, §4.1 | 4-6 j |
| A.2 | Table `communications` sur le patron `veille_signaux` : index unique sur `gmail_message_id`, RLS agence, `service_role` en écriture, index `(projet_id, envoye_le desc)` et `(thread_id)` | §4.1, §4.3, §18 | 4-6 j |
| A.3 | Couche d'accès paginée côté client sur le modèle de `src/veille.ts`, **plus cache IndexedDB 90 jours et file d'écritures idempotentes** | §24, hors-ligne | 6-8 j |
| A.4 | Rattachement en cascade unifié (fusion des trois moteurs divergents), file « à rattacher », mémorisation des corrections comme règles adresse → projet | §5.1, §19.2 | 5-7 j |
| A.5 | Bouton « Ouvrir dans Gmail » sur tout message et tout document issu d'un message | §4.2, **critères 2 et 3** | 1 j |
| A.6 | Edge Function de résumé avec secret Supabase propre, limitation de débit, mention « brouillon », résumé des seuls messages rattachés | §5.3, §12.3 | 4-5 j |
| A.7 | Le `Courrier` devient une vue « à traiter » sur `communications` ; retrait du chemin d'ingestion navigateur concurrent | §4.3, §16 | 3 j |
| A.8 | Table `journal_audit` en append-only, alimentée par triggers, insertion refusée aux comptes applicatifs | §14.4, **critère 13** | 4 j |

#### Vague B — le travail et le temps

| # | Livrable | §CDC | Effort |
|---|---|---|---|
| B.1 | Collection `taches` (`TacheInterne`) dans le document JSONB : 18 champs du §8.5, 9 statuts stockés, `source: {type, id}`, reprise des notes « à faire » non réglées à la migration | §8.4, §8.5, §8.6, **critères 4 et 5** | 6-8 j |
| B.2 | Vue « Mes tâches » : le filtre par personne du centre d'actions devient le filtre par défaut ; filtres Aujourd'hui, En retard, Cette semaine, À venir, Sans date, Par projet, Par priorité, Par statut, Créées par moi, Assignées par un tiers | §8.3, **critère 6** | 4 j |
| B.3 | « Créer une tâche depuis ce message » avec conservation de la source | §8.4, **critère 4** | 1 j |
| B.4 | Table `pointages` horodatés (début, fin, durée, tâche, type d'activité, commentaire, facturable, validée, source) et sa file d'envoi | §9.5, §18 | 6-8 j |
| B.5 | **Projection** de `pointages` vers `state.temps` — la grille hebdomadaire devient dérivée, `derive.ts` n'est pas touché | §9.5, §11.3 | 3-4 j |
| B.6 | Chrono : table `chrono_actif`, contrainte d'unicité par personne, bascule « arrêter le chrono actuel et démarrer le nouveau », affichage permanent en barre supérieure, démarrage en un clic depuis une tâche, un projet, un message, un document | §9.2, §9.3, §9.4, **critère 7** | 6-8 j |
| B.7 | Attribut `facturable` par pointage, initialisé par la règle actuelle (projet = facturable) et modifiable | §9.5, §10.1, §11.2 | 1 j |

**Dépendances :** Lot 0 intégralement. A.2 dépend de A.1 (sans `threadId` capté, rien n'est rattrapable). B.4 dépend de A.3 pour la file d'envoi, qui est mutualisée. B.6 dépend de B.4.
**Critère de fin :** un message reçu ce matin apparaît dans le Cockpit avec son projet, ses destinataires, son résumé et un lien qui le rouvre dans Gmail ; une tâche créée depuis ce message conserve sa source ; un chrono démarré depuis cette tâche produit une entrée de temps qui remonte dans la grille hebdomadaire **sans que la marge du projet ne bouge d'un euro** ; tout cela fonctionne avec le réseau coupé, et l'export JSON reste complet.

---

### Lot 2 — Phase 2

> **Objectif :** transformer les échanges indexés en décisions, en risques et en mémoire consultable.

| # | Livrable | §CDC | Effort |
|---|---|---|---|
| 2.1 | Entité `decisions` de **projet**, distincte de `DecisionDirection` qui reste le pilotage d'agence : `projetId`, `sourceType`/`sourceId`, `decidePar`, `decideLe`, cycle Proposée / À vérifier / Confirmée / Contestée / Annulée sur le patron éprouvé de `DocumentRecord` | §6.1, §6.2, **critère 9** | 6-8 j |
| 2.2 | Verrou **de type** : un `PropositionDecision` qui ne peut pas porter les statuts humains, et une fonction unique de promotion qui journalise l'auteur. Aujourd'hui rien n'empêche un module d'écrire `statut: 'confirmee'` dans `update()` | §15 | 2 j |
| 2.3 | Risques en mode hybride : détection dérivée par le moteur d'alertes, qualification humaine stockée (écartement, attribution, motif de clôture) — sur le patron `AttenduFinancier`, qui « ne stocke que les décisions humaines ». Ajout de `projetId` sur `Alerte` et carte dans l'onglet Pilotage du projet | §6.3 | 6-8 j |
| 2.4 | Recherche par facettes : date, période, phase, auteur, statut, client ; ajout des tâches, décisions, réunions et comptes-rendus au balayage ; anti-rebond et plafond de résultats | §13.1 | 4-5 j |
| 2.5 | Index plein texte français (`to_tsvector('french')` + GIN) sur communications, décisions et comptes-rendus, avec glossaire de synonymes métier | §13.1 | 3-4 j |
| 2.6 | Historisation des corrections de temps : valeur antérieure, auteur, date, motif | §9.6, §14.4 | 2 j |
| 2.7 | Purge planifiée du bucket `entrants` après classement (aucun `storage.remove()` n'existe aujourd'hui — les pièces s'accumulent indéfiniment) | §24, RGPD | 1 j |
| 2.8 | Bilan de fin de journée : « vous avez travaillé aujourd'hui sur… · temps non enregistré estimé… », complétable ou ignorable | §12.4 | 3 j |
| 2.9 | Synchronisation par `historyId` pour capter suppressions et changements de libellés ; reprise d'historique bornée et reprenable | §4.1 | 4-5 j |
| 2.10 | Marqueur de confidentialité par objet (message, document, projet) — prérequis du §14.3, aujourd'hui inexistant hors `DocumentCorpus.prive` | §14.3 | 2 j |

**Dépendances :** Lot 1 vague A pour 2.1, 2.4, 2.5, 2.9, 2.10 ; vague B pour 2.6, 2.8.
**Critère de fin :** une décision prise dans un e-mail se retrouve dans la fiche projet avec un lien vers le message d'origine ; une recherche « APD, mars, Zoé » renvoie des résultats ; un risque écarté l'est avec un motif et un responsable.

---

### Lot 3 — Phase 3

> **Objectif :** exploiter Google Workspace une fois souscrit, et livrer la mémoire projet interrogeable.

| # | Livrable | §CDC | Effort |
|---|---|---|---|
| 3.1 | Application OAuth de type **Interne** : fin de l'expiration des jetons à 7 jours et de l'évaluation CASA | §23 | 1 j |
| 3.2 | Bascule d'identité `@gmail.com` → domaine agence, avec période de double acceptation | §3.1, §23 | 3-4 j |
| 3.3 | Adresses projet en Google Group, créées **à la main** à la création du projet (voir §6 : le provisionnement automatique n'est pas recommandé) | §3.2, §12.1 | 2 j |
| 3.4 | Alias d'envoi `sendAs` pour chaque membre, auto-vérifié parce que dans le domaine, et envoi depuis Cockpit avec l'adresse projet en expéditeur | §3.4, §12.1 pt 5 | 5-6 j |
| 3.5 | Mode assistant « mémoire projet » : récupération **serveur** des sources (seul endroit où le filtrage par confidentialité peut s'appliquer avant le prompt), réponse en deux parties avec un tableau de citations typées `{type, id, date, url}` transformables en liens | §13.2, §13.3 | 8-10 j |
| 3.6 | Cause documentée de l'écart prévu / réel, portée par `RevisionResteAFaire` — dont les champs `notes` et `par` sont **déjà déclarés et jamais alimentés** — avec la liste fermée du §11.3 plus « Autre » commenté | §11.3 | 3 j |
| 3.7 | Baseline des heures prévues par phase, figée à la signature, pour que « Recalculer la répartition » n'efface plus l'écart qu'on mesure | §11.3, **critère 15** | 2 j |
| 3.8 | Écart en **heures** signé à côté du ratio de consommation ; taux d'avancement affiché (le calcul `avancementPhase` existe déjà et n'est jamais rendu) | §11.1, §11.3 | 1 j |
| 3.9 | Suggestions de saisie depuis Google Calendar, à confirmer avant validation (la lecture des événements existe déjà) | §9.7 | 3 j |
| 3.10 | Exports du temps : CSV et Excel, à partir des pointages horodatés | §10.3 | 2 j |
| 3.11 | Recherche sémantique `pgvector` — **seulement si** le plein texte du Lot 2 a été mesuré insuffisant | §13.2 | 6-8 j |

**Dépendances :** Google Workspace souscrit et domaine vérifié pour 3.1 à 3.4. Lot 2 pour 3.5 et 3.11.
**Critère de fin :** un client écrit à `2026-034@agence.fr`, les deux collaboratrices le reçoivent, la réponse part avec l'adresse projet en expéditeur, et la question « pourquoi avons-nous retenu ce bardage ? » renvoie une réponse dont chaque source est un lien cliquable.

---

### Lot 4 — Phase 4

> **Objectif :** ce qui ne se justifie qu'avec un troisième collaborateur ou un vrai besoin externe. À ne pas engager avant.

| # | Livrable | §CDC | Condition d'engagement |
|---|---|---|---|
| 4.1 | Normalisation relationnelle des collections sensibles (`settings.equipe`, contrats, notes de frais, absences) et droits par projet | §14.2, §14.3, **critère 12** | Arrivée d'un troisième collaborateur |
| 4.2 | Les huit rôles du §14.1 et la matrice projet × rôle × phase × type × confidentialité | §14.1, §14.2 | Idem |
| 4.3 | Bascule sur l'API Google Drive, `driveFileId` renseigné, droits Drive par équipe projet | §7.3, §12.2 | Workspace souscrit **et** besoin de partage inter-postes avéré |
| 4.4 | Ingestion multi-boîtes (`ingestion_config` en table à N lignes) | §3.3 | Troisième boîte à ingérer |
| 4.5 | Sortie du JSONB de `taches` et `registreDocuments` | §17 | Franchissement d'un seuil mesuré (§3.1) |

---

## 5. Les quinze critères d'acceptation du §22

| # | Critère | État aujourd'hui | Lot qui le satisfait |
|---|---|---|---|
| 1 | Continuer à travailler depuis Gmail | **Satisfait** — rien ne force à quitter Gmail, l'application est en lecture seule | — |
| 2 | Chaque message projet est visible dans Cockpit | **Non** — seules les pièces jointes sont indexées ; un message sans pièce jointe n'existe nulle part | MVP A.2 |
| 3 | Chaque message Cockpit peut être rouvert dans Gmail | **Non** — aucune URL de lecture n'existe, `threadId` n'est jamais capté | MVP A.1 + A.5 |
| 4 | Une tâche peut être créée depuis un e-mail | **Non** — « → Journal » archive sans créer de tâche ni poser le tag `a-faire` | MVP B.3 |
| 5 | Une tâche peut être créée manuellement | **Partiel** — notes de journal taguées, sans responsable, priorité ni échéance | MVP B.1 |
| 6 | Chaque collaborateur possède une vue personnelle | **Partiel** — filtre par personne non persisté, non relié à une identité | Lot 0 (0.3) + MVP B.2 |
| 7 | Le chrono est accessible en un clic | **Non** — aucune notion de chrono dans le dépôt | MVP B.6 |
| 8 | Le temps est rattaché à un projet ou une tâche | **Partiel** — projet et phase oui, tâche non | MVP B.4 |
| 9 | Une décision conserve sa source | **Non** — `DecisionDirection` n'a ni `projetId` ni source typée | Phase 2 (2.1) |
| 10 | Une pièce jointe conserve le lien vers son e-mail | **Non** — mais l'identifiant existe côté serveur, il manque une ligne au `select` | **Lot 0 (0.6)** |
| 11 | Les propositions IA peuvent être acceptées, modifiées ou refusées | **Satisfait** — confiance, raisons, champs modifiables, rejet tracé | — (renforcé en Phase 2, 2.2) |
| 12 | Les droits sont gérés par projet | **Non** — structurellement impossible sur un document JSONB unique | Phase 4 (4.1) — **et non recommandé avant** |
| 13 | Les actions sensibles sont historisées | **Partiel** — exemplaire sur la facture et le registre, absent ailleurs ; `updated_by` contient un UUID d'onglet | Lot 0 (0.5) + MVP A.8 |
| 14 | Aucune réponse envoyée sans validation | **Satisfait structurellement** — périmètre OAuth en lecture seule, envoi délégué au brouillon Gmail | — |
| 15 | Les données permettent un suivi prévu / réel | **Partiel** — complet sur les heures et les honoraires ; manquent la baseline stable et la cause de l'écart | Phase 3 (3.6 à 3.8) |

**Lecture :** deux critères sont satisfaits, un l'est de fait, un se règle en une demi-journée en Lot 0, et onze se répartissent sur le MVP et les phases. Un seul — le douzième — est délibérément renvoyé au-delà, pour les raisons exposées ci-dessous.

---

## 6. Ce que je recommande de ne pas faire

Le CDC décrit un produit pour une agence qui grandit. L'agence compte deux personnes qui partagent tout, y compris les salaires de l'équipe qui sont dans le même document que le reste. Plusieurs exigences, prises au pied de la lettre, coûteraient des mois pour un bénéfice nul ou négatif.

**Ne pas construire le modèle de permissions du §14 maintenant (critère 12).** Le chiffrage honnête est de 50 à 70 jours : la normalisation relationnelle des collections sensibles seule représente 358 références de lecture et 189 sites d'appel `update()` à reprendre, avant même d'écrire un seul rôle. Pour deux associées qui voient déjà tout et doivent voir tout. Ce qu'il faut faire à la place, et qui est dans le plan : le registre d'identités (Lot 0, 3 à 5 jours), qui supprime les 29 adresses en dur et rend l'ajout d'un collaborateur possible sans redéployer, et le journal d'audit (MVP, 4 jours), qui satisfait le critère 13. Le reste attend un troisième collaborateur — et il l'attend **sans dette**, parce que toute donnée personnelle porte dès maintenant son `personneId`.

**Ne pas migrer les 37 collections en relationnel.** Cela reviendrait à jeter `derive.ts`, `economie.ts` et `facture.ts` — toute la chaîne financière, qui fonctionne et qui est la partie la plus mûre du produit — pour 2,9 Mo de données à régime.

**Ne pas automatiser le provisionnement Google (Admin SDK, §12.1 points 3 et 4).** Cela suppose de donner à Cockpit un compte de service en délégation à l'échelle du domaine, usurpant un super-admin, avec les droits de créer et supprimer des groupes et d'en éjecter des membres. On passerait d'un outil qui ne peut rien casser chez Google — c'est aujourd'hui une propriété **garantie** par le périmètre en lecture seule — à un outil qui peut désinscrire une collaboratrice d'un projet sur un bug. Pour une agence qui crée peut-être dix projets par an, créer le groupe à la main prend deux minutes. Le rapport risque / bénéfice n'est pas défendable.

**Ne pas développer d'extension Gmail (§21 Phase 3).** Un lien « Ouvrir dans Gmail » dans un sens et un bouton « Créer une tâche » dans l'autre couvrent le besoin réel. Une extension est un artefact à distribuer, à maintenir et à faire valider, pour gagner un clic.

**Ne pas construire les portails client et partenaires (§21 Phase 4).** Un portail signifie des comptes externes, une surface d'authentification publique, une politique de confidentialité et un support. Pour deux personnes, un PDF envoyé par mail fait le même travail — et le dépôt sait déjà générer des PDF datés.

**Ne pas mettre pgvector avant d'avoir mesuré l'échec du plein texte.** Sous 400 000 caractères par projet, le corpus tient dans le prompt. Entre 400 000 et 3 millions, un pré-filtre déterministe plus un index français suffit largement. Le vrai déclencheur des embeddings n'est d'ailleurs pas le volume mais le vocabulaire : quand les mails disent « vêture mélèze » et la question dit « bardage bois ». Un glossaire de synonymes métier, qui coûte une journée, repousse ce mur d'environ un an.

**Ne pas renommer les identifiants de projet en `AAAA-NNN`.** Cela casserait les liens existants, les journaux, `entrants.projet_id_propose` et le rattachement automatique par texte. La double clé coûte deux champs.

**Ne pas renuméroter l'arborescence documentaire selon l'exemple du §7.2.** L'arborescence du dépôt encode des besoins réels que le CDC ignore — `09_FACTURES` et `10_PHOTOS` — et elle porte la lecture d'avancement du projet. Renuméroter invaliderait tous les `cheminDrive` déjà enregistrés, qui sont des chaînes figées et non recalculables. On adopte l'intention du CDC (un dossier par phase là où c'est utile), pas sa numérotation.

**Ne pas demander `gmail.send` ni `gmail.modify` au MVP.** Cela invaliderait le refresh token existant, imposerait un nouveau consentement, ferait échouer `scripts/test-edge-functions-security.cjs` et — surtout — retirerait l'argument « lecture seule » affiché à l'utilisateur, qui est aujourd'hui la garantie du critère 14. Le rangement automatique de la boîte, que la routine « Tri du matin » demande déjà et reconnaît elle-même ne pas pouvoir faire, n'en vaut pas le prix.

**Ne pas construire le circuit de validation hebdomadaire des feuilles de temps (§10.2).** Validation par chef de projet, verrouillage, correction sous justification : cela suppose une hiérarchie et un tiers validateur qui n'existent pas. On garde ce qui a une valeur réelle — l'**historisation** des corrections (§9.6), qui protège contre l'oubli et non contre la fraude — et on laisse tomber le circuit. L'export paie relève de la même logique : deux associées ne se font pas de fiches de paie sur la base de leurs pointages.

**Ne pas mettre les tâches en relationnel dès le départ,** malgré la recommandation de l'analyse d'architecture. Le hors-ligne sur les tâches vaut plus, pour une agence qui travaille sur chantier, que la marge de fréquence d'écriture qu'on gagnerait. La sortie reste possible et est préparée.

---

## 7. Risques et garde-fous

### 7.1 Les risques du §24, appréciés sur le code réel

| Risque §24 | Appréciation | Garde-fou |
|---|---|---|
| Quotas API Google | **Faible.** Une reprise de 25 000 messages coûte 0,0125 % du plafond quotidien. La vraie limite est 250 unités par seconde et par utilisateur | Découpage de la reprise en passages successifs du cron, déjà planifié |
| Synchronisation incomplète | **Élevé aujourd'hui.** La fenêtre fixe `newer_than:7d` avec `maxResults=25` fait perdre des messages **en silence** dès un pic de courrier | Curseur `internalDate` au MVP (A.1), `historyId` en Phase 2 |
| Doublons | **Faible.** Le patron est déjà résolu : index unique partiel plus empreinte SHA-256 | Recopie du patron sur `gmail_message_id`, plus identifiant client sur chaque écriture de la file |
| Changements de droits | **Non couvert.** Un changement de droits est aujourd'hui une migration SQL éditée à la main, invisible du journal | Table `membres` (0.2) plus journal d'audit (A.8) |
| Erreurs de rattachement | **Maîtrisé.** Confiance, raisons lisibles, proposition toujours modifiable, file « à rattacher » | Cascade unifiée (A.4) et mémorisation des corrections |
| Dépendance à Google Workspace | **Réel et assumé.** Le §3 entier en dépend | Le MVP entier est livrable sans Workspace ; c'est la contrepartie du séquencement choisi |
| Indisponibilité temporaire | **Maîtrisé.** Marqueurs persistants, reprise sur `online`, file sérialisée | À étendre à la file des entités relationnelles (A.3) |

### 7.2 Ce que les analyses ont révélé en plus

**L'expiration des jetons à sept jours est un défaut présent, pas un risque futur.** L'application OAuth en mode Test fait expirer les refresh tokens chaque semaine : l'ingestion serveur s'arrête et réclame une reconnexion manuelle. C'est le seul point du dossier qui se dégrade tout seul si rien n'est fait.

**Le conflit de synchronisation est collant et son arbitrage est destructeur.** Le seul geste de sortie abandonne les modifications locales. Tant que les écritures fréquentes ne sont pas sorties du document, deux postes actifs simultanément produisent un conflit que la seule issue disponible résout en perdant du travail. C'est pourquoi la sortie des pointages et du chrono n'est pas une optimisation mais une condition d'usage à deux.

**Le bucket `entrants` n'est jamais purgé.** Aucun appel `storage.remove()` n'existe dans le dépôt : après classement, la pièce jointe reste indéfiniment dans le bucket, en doublon du fichier rangé. C'est un sujet de conservation de données personnelles autant qu'un coût. Purge planifiée à 30 jours en Phase 2 (2.7).

**Deux ingestions Gmail concurrentes coexistent.** Le chemin serveur toutes les 10 minutes et le chemin navigateur toutes les 60 secondes écrivent tous deux dans l'état partagé, avec deux mémoires distinctes de « déjà vu » — une table côté serveur, un `localStorage` plafonné à 500 identifiants côté navigateur. Un poste qui vide son stockage local recrée des doublons. Le chemin navigateur est retiré au MVP (A.7).

**La copie locale complète n'est pas révocable.** L'état de l'agence, salaires compris, est persisté en clair dans `localStorage` sur chaque poste. Révoquer un accès côté serveur ne récupère ni n'efface cette copie. Ce n'est pas un problème à deux associées ; ce le devient le jour d'un départ. À traiter en même temps que 4.1, pas avant.

**Le coût variable de l'IA est réel mais modeste.** Environ 20 € par mois en régime permanent si l'on résume tous les messages, moins de 10 € en ne résumant que les messages rattachés. La reprise d'historique passe par la Batch API. Ce n'est pas un risque budgétaire, c'est une ligne à surveiller.

**Le vocabulaire « entrants » induit en erreur.** La table `entrants` ressemble à une boîte de réception mais ne conserve ni le message, ni son fil, ni ses destinataires : c'est un index de **pièces jointes**. Confondre les deux ferait sous-estimer d'un facteur important la charge de la table `communications`.

### 7.3 Garde-fous à conserver et à étendre

Ce que le dépôt fait déjà bien et qu'il faut protéger :

- **La validation humaine reste obligatoire partout.** Aucun livrable de ce plan ne crée d'action irréversible déclenchée par un modèle. La conversion automatique d'un message en tâche est explicitement écartée (§3.12).
- **La traçabilité jusqu'à la source est étendue, jamais réduite.** Chaque entité nouvelle — communication, tâche, décision, pointage — porte sa source typée `{type, id}`.
- **Le hors-ligne et l'export JSON sont des acquis.** Toute entité sortie du document emporte son cache et sa file d'envoi ; l'export JSON doit être **étendu** pour embarquer les tables relationnelles, faute de quoi la sauvegarde de l'agence deviendrait partielle sans que personne ne le remarque.
- **Les tests statiques en CI sont le lieu où les décisions de ce plan deviennent opposables.** À ajouter aux huit scripts existants : un test qui vérifie qu'aucune adresse e-mail n'est écrite en dur dans le dépôt, un test qui vérifie que le type de proposition ne peut pas porter un statut humain (§3.2 de la Phase 2), et un test qui vérifie que la projection `pointages → state.temps` conserve les totaux — c'est le seul garde-fou qui protège vraiment la marge.
- **La sauvegarde côté serveur reste à traiter.** La restauration à un point dans le temps n'est pas disponible sur l'offre Supabase gratuite. En attendant un arbitrage sur l'abonnement, un export planifié nocturne remplace le geste manuel actuel, que la documentation impose aujourd'hui avant toute résolution de conflit — un geste humain qui ne tiendra pas à l'échelle relationnelle.
