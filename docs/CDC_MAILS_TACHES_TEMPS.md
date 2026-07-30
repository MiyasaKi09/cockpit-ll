# Cockpit — Cahier des charges fonctionnel  
## Gestion des e-mails, tâches, temps et mémoire projet

**Version :** 1.0  
**Contexte :** agence d’architecture  
**Objectif :** conserver Gmail comme interface principale tout en structurant automatiquement les échanges, les tâches, les décisions, les documents et le temps passé dans Cockpit.

---

## 1. Vision générale

Cockpit ne remplace pas Gmail.

Gmail reste l’outil quotidien pour :

- lire et envoyer les e-mails ;
- répondre aux clients et partenaires ;
- conserver les fils de discussion ;
- rechercher les messages ;
- utiliser les applications mobile et web ;
- gérer les pièces jointes.

Cockpit devient la couche métier de l’agence.

Il relie chaque e-mail à un projet, une phase, des intervenants, des documents, des décisions, des tâches, des échéances et du temps passé.

Le principe central est :

> Gmail conserve l’échange original. Cockpit transforme cet échange en information exploitable.

---

## 2. Principes structurants

1. Chaque collaborateur conserve une adresse personnelle professionnelle.
2. Chaque projet possède une adresse e-mail dédiée.
3. Le client communique principalement avec l’adresse du projet.
4. Les collaborateurs continuent à travailler depuis Gmail.
5. Les réponses peuvent être envoyées depuis l’adresse du projet.
6. Cockpit synchronise les e-mails sans supprimer ni déplacer les originaux.
7. Toute donnée créée dans Cockpit reste liée à sa source.
8. L’intelligence artificielle propose, mais ne valide pas seule les éléments sensibles.
9. Le projet est l’objet central de l’application.
10. Les tâches, documents, décisions, temps et communications sont reliés entre eux.

---

# 3. Infrastructure e-mail

## 3.1 Adresses personnelles

Chaque collaborateur dispose d’une adresse professionnelle :

```text
julien@agence.fr
zoe@agence.fr
paul@agence.fr
```

Ces adresses servent à :

- se connecter à Google Workspace ;
- recevoir les e-mails distribués ;
- utiliser Gmail ;
- gérer les agendas et documents ;
- identifier l’auteur réel d’une action.

---

## 3.2 Adresses projet

Chaque projet dispose d’une adresse dédiée :

```text
boileau@agence.fr
2026-034@agence.fr
concours-nanterre@agence.fr
```

Cette adresse doit être créée automatiquement depuis Cockpit lors de la création du projet.

### Format recommandé

```text
[code-projet]@agence.fr
```

Exemple :

```text
2026-034@agence.fr
```

Un alias lisible peut être ajouté :

```text
boileau@agence.fr
```

---

## 3.3 Réception des e-mails

Lorsqu’un client écrit à l’adresse du projet :

```text
À : 2026-034@agence.fr
```

le message est distribué aux membres autorisés du projet.

Exemple :

```text
Julien
Zoé
Paul
```

Les membres reçoivent le message dans leur boîte Gmail habituelle.

Cockpit détecte ensuite :

- le projet ;
- l’expéditeur ;
- les destinataires ;
- le fil de discussion ;
- les pièces jointes ;
- la date ;
- le sujet ;
- les intervenants cités ;
- les éventuelles tâches ou échéances.

---

## 3.4 Envoi depuis l’adresse projet

Depuis Gmail, le collaborateur doit pouvoir envoyer :

```text
De : 2026-034@agence.fr
```

Le client ne voit donc pas uniquement l’adresse personnelle du collaborateur.

La signature reste nominative :

```text
Julien Martin
Architecte DE — Chef de projet
Projet 2026-034 — Résidence Boileau
2026-034@agence.fr
```

Cette organisation garantit :

- une identité stable pour le projet ;
- une continuité en cas de changement d’équipe ;
- une meilleure lisibilité pour le client ;
- un historique collectif ;
- une réduction des pertes d’information.

---

## 3.5 Technologie recommandée

Google Workspace constitue le socle principal.

Les adresses projet peuvent être gérées par :

- Google Groups ;
- alias d’envoi ;
- délégation d’envoi ;
- règles d’administration Workspace.

Cockpit doit piloter autant que possible ces paramètres via les API Google.

---

# 4. Synchronisation Gmail — Cockpit

## 4.1 Principe

Cockpit ne remplace pas Gmail et ne devient pas une nouvelle messagerie.

Il synchronise les messages via l’API Gmail.

Pour chaque message, Cockpit conserve notamment :

```text
gmail_message_id
gmail_thread_id
project_id
sender
recipients
subject
sent_at
received_at
labels
attachments
source_url
```

---

## 4.2 Lien direct vers Gmail

Chaque e-mail affiché dans Cockpit doit contenir un bouton :

```text
Ouvrir dans Gmail
```

Chaque tâche, décision, document ou échéance issue d’un e-mail doit également conserver ce lien.

Exemple :

```text
Décision : Bardage bois validé
Source : e-mail du 29 juillet 2026
[Ouvrir dans Gmail]
```

---

## 4.3 Source de vérité

La source de vérité des communications reste Gmail.

Cockpit stocke :

- un index ;
- des métadonnées ;
- des résumés ;
- des relations métier ;
- des références vers les messages originaux ;
- des copies éventuelles de pièces jointes utiles.

Cockpit ne doit pas supprimer automatiquement les messages Gmail.

---

# 5. Structuration des communications

## 5.1 Rattachement au projet

Un e-mail peut être rattaché au projet grâce à :

1. l’adresse projet utilisée ;
2. l’adresse des participants ;
3. l’objet ;
4. le fil de discussion ;
5. des règles manuelles ;
6. une proposition de l’IA.

Le rattachement automatique doit être modifiable.

---

## 5.2 Catégorisation

Chaque échange peut être classé selon :

### Phase du projet

- Prospection
- Concours
- Faisabilité
- ESQ
- APS
- APD
- PRO
- DCE
- ACT
- VISA
- DET
- AOR
- DOE
- SAV

### Type d’échange

- Client
- Administration
- Urbanisme
- BET
- Bureau de contrôle
- CSPS
- Entreprise
- Fournisseur
- Interne
- Contractuel
- Financier
- Planning
- Chantier
- Réclamation
- Validation

### Niveau d’importance

- Information
- À traiter
- Important
- Urgent
- Bloquant
- Contractuel

---

## 5.3 Résumé automatique

Cockpit peut produire un résumé court :

```text
Le client valide la variante B de la façade sud.
Il demande une mise à jour des plans avant vendredi.
Le BET structure doit confirmer la faisabilité du porte-à-faux.
```

Le résumé ne remplace jamais le message original.

---

# 6. Décisions, validations et risques

## 6.1 Décisions

Cockpit peut proposer la création d’une décision à partir d’un e-mail.

Exemple :

```text
Décision
Façade sud en bardage bois validée

Date
29 juillet 2026

Validée par
Client

Source
E-mail Gmail
```

---

## 6.2 Validation humaine

Une décision détectée par l’IA doit avoir un statut :

- Proposée
- À vérifier
- Confirmée
- Contestée
- Annulée

L’IA ne doit jamais considérer seule qu’une décision a une valeur contractuelle.

---

## 6.3 Risques

L’IA peut détecter :

- retard potentiel ;
- budget dépassé ;
- demande contradictoire ;
- absence de validation ;
- modification de programme ;
- réserve technique ;
- responsabilité non attribuée ;
- dépendance à un tiers ;
- échéance imminente.

Ces risques apparaissent dans la fiche projet.

---

# 7. Pièces jointes et documents

## 7.1 Conservation

La pièce jointe reste dans l’e-mail Gmail.

Cockpit peut également proposer de la copier vers le stockage documentaire.

---

## 7.2 Classement documentaire

Exemple d’arborescence :

```text
2026-034 — Boileau
├── 00_Administration
├── 01_Contrat
├── 02_ESQ
├── 03_APS
├── 04_APD
├── 05_PRO
├── 06_DCE
├── 07_ACT
├── 08_VISA
├── 09_DET
├── 10_AOR
└── 11_DOE
```

L’IA peut proposer :

```text
Plan_APD_indice_C.pdf
→ 04_APD / Plans
```

La proposition doit être validable ou modifiable.

---

## 7.3 Double traçabilité

Pour chaque document classé, Cockpit conserve :

- le lien vers le fichier Drive ;
- le lien vers l’e-mail Gmail ;
- le projet ;
- la phase ;
- l’auteur ;
- la date ;
- l’indice ;
- le type de document ;
- son statut.

---

# 8. Espace personnel par collaborateur

Chaque collaborateur dispose d’un espace Cockpit personnel.

## 8.1 Vue d’accueil

La page d’accueil personnelle affiche :

- tâches du jour ;
- tâches en retard ;
- prochaines échéances ;
- mails à traiter ;
- validations attendues ;
- réunions du jour ;
- chrono en cours ;
- temps enregistré ;
- alertes projets ;
- charge prévisionnelle.

---

## 8.2 Vue « Aujourd’hui »

Cette vue regroupe :

- les tâches prévues aujourd’hui ;
- les tâches urgentes ;
- les mails nécessitant une réponse ;
- les réunions ;
- les échéances proches ;
- les tâches suggérées par l’IA ;
- le temps restant estimé.

---

## 8.3 Vue « Mes tâches »

Filtres :

- Aujourd’hui
- En retard
- Cette semaine
- À venir
- Sans date
- Par projet
- Par priorité
- Par statut
- Créées par moi
- Assignées par un tiers
- Proposées par l’IA

---

## 8.4 Création des tâches

Une tâche peut être créée :

- manuellement ;
- depuis un e-mail ;
- depuis un compte rendu ;
- depuis une décision ;
- depuis une réunion ;
- depuis un document ;
- automatiquement sous forme de proposition.

---

## 8.5 Structure d’une tâche

Chaque tâche comprend :

```text
Titre
Description
Projet
Phase
Responsable
Créateur
Participants
Priorité
Statut
Date de début
Échéance
Temps estimé
Temps enregistré
Source
Documents liés
Commentaires
Sous-tâches
Dépendances
```

---

## 8.6 Statuts

- À qualifier
- À faire
- Planifiée
- En cours
- En attente
- Bloquée
- À valider
- Terminée
- Annulée

---

## 8.7 Tâches proposées par l’IA

Exemple :

```text
Tâche proposée
Mettre à jour le plan de façade

Responsable suggéré
Julien

Échéance détectée
4 août 2026

Source
E-mail du client
```

Actions disponibles :

```text
Accepter
Modifier
Attribuer
Ignorer
```

---

# 9. Chrono et horodatage

## 9.1 Objectif

Le chrono doit réduire la friction de saisie du temps.

Il permet de mesurer rapidement le temps consacré à :

- un projet ;
- une tâche ;
- une réunion ;
- un déplacement ;
- un appel ;
- une phase ;
- une activité interne.

---

## 9.2 Fonctionnement

Actions principales :

```text
Démarrer
Pause
Reprendre
Arrêter
```

Le chrono actif reste visible dans toute l’application.

---

## 9.3 Démarrage rapide

Le collaborateur peut démarrer un chrono depuis :

- une tâche ;
- une fiche projet ;
- un e-mail ;
- un document ;
- un événement calendrier ;
- la barre supérieure de Cockpit.

---

## 9.4 Changement d’activité

Lorsqu’un nouveau chrono démarre, Cockpit propose :

```text
Arrêter le chrono actuel et démarrer le nouveau ?
```

Un seul chrono actif est recommandé par utilisateur.

---

## 9.5 Informations d’une entrée de temps

```text
Collaborateur
Projet
Tâche
Phase
Type d’activité
Début
Fin
Durée
Commentaire
Facturable ou non
Validée ou non
Source éventuelle
```

---

## 9.6 Saisie manuelle

Le collaborateur peut :

- ajouter une durée ;
- modifier une heure de début ;
- modifier une heure de fin ;
- corriger une erreur ;
- répartir une durée entre plusieurs projets ;
- ajouter un commentaire.

Toute correction importante doit être historisée.

---

## 9.7 Suggestions automatiques

Cockpit peut proposer une saisie à partir de :

- calendrier Google ;
- réunion ;
- appel enregistré dans Cockpit ;
- travail sur une tâche ;
- ouverture d’un document ;
- activité continue sur un projet.

Ces suggestions doivent être confirmées avant validation.

---

# 10. Feuilles de temps

## 10.1 Vue collaborateur

Chaque personne peut consulter :

- aujourd’hui ;
- semaine en cours ;
- mois en cours ;
- temps par projet ;
- temps par phase ;
- temps facturable ;
- temps interne ;
- temps non affecté.

---

## 10.2 Validation

Selon l’organisation de l’agence :

- validation libre ;
- validation hebdomadaire ;
- validation par chef de projet ;
- verrouillage après validation ;
- correction avec justification.

---

## 10.3 Export

Formats :

- CSV
- Excel
- PDF
- export comptable
- export paie éventuel
- API

---

# 11. Pilotage de l’agence

## 11.1 Indicateurs projet

- temps prévu ;
- temps consommé ;
- temps restant ;
- taux d’avancement ;
- budget d’honoraires ;
- coût interne ;
- rentabilité ;
- répartition par phase ;
- charge restante ;
- dépassement ;
- tâches en retard ;
- décisions en attente.

---

## 11.2 Indicateurs collaborateurs

- charge actuelle ;
- charge future ;
- temps disponible ;
- temps par projet ;
- tâches en retard ;
- interruptions ;
- répartition facturable / interne ;
- heures non affectées.

Ces données doivent servir au pilotage, pas à une surveillance permanente.

---

## 11.3 Comparaison prévu / réel

Cockpit doit permettre de comparer :

```text
Prévision
APD : 120 h

Réel
APD : 148 h

Écart
+28 h
```

La cause peut être documentée :

- modification client ;
- reprise interne ;
- erreur de production ;
- retard d’un partenaire ;
- aléa administratif ;
- prestation complémentaire.

---

# 12. Automatisations

## 12.1 Création d’un projet

À la création du projet, Cockpit peut :

1. générer le code projet ;
2. créer l’adresse e-mail projet ;
3. créer le Google Group ;
4. ajouter les membres ;
5. configurer les autorisations d’envoi ;
6. créer le dossier Drive ;
7. créer l’arborescence ;
8. créer l’espace Cockpit ;
9. créer les phases ;
10. appliquer des modèles de tâches ;
11. créer l’agenda projet ;
12. créer les droits d’accès.

---

## 12.2 Modification de l’équipe

Lorsqu’un membre est ajouté :

- ajout au projet Cockpit ;
- ajout au Google Group ;
- accès Drive ;
- accès aux tâches ;
- accès aux documents ;
- accès aux informations utiles.

Lorsqu’un membre quitte le projet :

- retrait du groupe ;
- retrait des accès actifs ;
- conservation de l’historique ;
- transfert des tâches ouvertes.

---

## 12.3 Réception d’un e-mail

Cockpit peut :

1. identifier le projet ;
2. synchroniser le message ;
3. récupérer les pièces jointes ;
4. produire un résumé ;
5. détecter les tâches ;
6. détecter les échéances ;
7. détecter les décisions ;
8. détecter les risques ;
9. proposer un classement ;
10. notifier les personnes concernées.

---

## 12.4 Fin de journée

Cockpit peut proposer :

```text
Vous avez travaillé aujourd’hui sur :
- Boileau
- Concours Nanterre
- Administration interne

Temps non enregistré estimé : 1 h 20
```

Le collaborateur peut compléter ou ignorer.

---

# 13. Recherche et mémoire projet

## 13.1 Recherche globale

Recherche par :

- projet ;
- client ;
- entreprise ;
- date ;
- phase ;
- mot-clé ;
- décision ;
- document ;
- tâche ;
- auteur ;
- statut.

---

## 13.2 Questions en langage naturel

Exemples :

```text
Pourquoi avons-nous retenu le bardage bois ?
```

```text
Quelles décisions du client sont encore non appliquées ?
```

```text
Quels documents devons-nous recevoir du BET structure ?
```

```text
Quelles tâches sont bloquées par l’urbanisme ?
```

Cockpit doit répondre avec les sources utilisées.

---

## 13.3 Traçabilité

Chaque réponse IA doit citer :

- l’e-mail ;
- le document ;
- le compte rendu ;
- la décision ;
- la tâche ;
- la date.

---

# 14. Permissions et sécurité

## 14.1 Rôles

- Administrateur agence
- Direction
- Chef de projet
- Collaborateur
- Assistant administratif
- Comptabilité
- Intervenant externe
- Lecture seule

---

## 14.2 Règles d’accès

Les droits peuvent dépendre :

- du projet ;
- du rôle ;
- de la phase ;
- du type de document ;
- du niveau de confidentialité ;
- de l’appartenance à l’équipe.

---

## 14.3 Données sensibles

Certaines données doivent être restreintes :

- contrats ;
- honoraires ;
- salaires ;
- rentabilité ;
- contentieux ;
- documents RH ;
- données personnelles ;
- échanges confidentiels.

---

## 14.4 Journal d’audit

Cockpit doit historiser :

- créations ;
- modifications ;
- suppressions ;
- changements de droits ;
- validations ;
- corrections de temps ;
- actions automatiques ;
- actions IA acceptées ou refusées.

---

# 15. Limites de l’intelligence artificielle

L’IA ne doit pas :

- envoyer une réponse sans validation ;
- supprimer un e-mail ;
- confirmer seule une décision contractuelle ;
- attribuer définitivement une responsabilité ;
- classer seule un document sensible ;
- modifier un contrat ;
- valider une facture ;
- créer une échéance juridique sans confirmation ;
- remplacer l’analyse humaine.

L’IA peut :

- résumer ;
- proposer ;
- détecter ;
- suggérer ;
- relier ;
- rechercher ;
- signaler ;
- préparer.

---

# 16. Architecture fonctionnelle

```text
Google Workspace
├── Gmail
├── Drive
├── Calendar
├── Contacts
├── Groups
└── Admin

        │ API Google
        ▼

Cockpit
├── Projets
├── Communications
├── Documents
├── Contacts
├── Décisions
├── Risques
├── Tâches
├── Planning
├── Temps
├── Finance
├── Recherche
├── IA
└── Administration
```

---

# 17. Architecture technique recommandée

## Frontend

- application web responsive ;
- interface adaptée desktop, tablette et mobile ;
- extension Gmail ou panneau latéral dans une phase ultérieure.

## Backend

- API sécurisée ;
- synchronisation Google ;
- traitement des événements ;
- moteur de règles ;
- gestion des tâches ;
- gestion du temps ;
- recherche ;
- traitement IA.

## Base de données

Base relationnelle recommandée, par exemple PostgreSQL.

## Stockage

- Gmail pour les e-mails ;
- Google Drive pour les documents ;
- Cockpit pour les métadonnées et relations ;
- stockage objet éventuel pour les fichiers internes.

---

# 18. Principales entités de données

## Projet

```text
id
code
name
status
client_id
project_email
phase
start_date
end_date
budget
fees
drive_folder_id
calendar_id
```

## Collaborateur

```text
id
name
email
role
workspace_user_id
status
```

## Communication

```text
id
project_id
gmail_message_id
gmail_thread_id
sender
recipients
subject
body_excerpt
summary
sent_at
source_url
```

## Tâche

```text
id
project_id
title
description
assignee_id
creator_id
status
priority
due_date
estimated_minutes
source_type
source_id
```

## Entrée de temps

```text
id
user_id
project_id
task_id
start_at
end_at
duration_minutes
activity_type
comment
billable
validated
```

## Décision

```text
id
project_id
title
description
status
decided_at
decided_by
source_type
source_id
```

## Document

```text
id
project_id
drive_file_id
name
document_type
phase
version
status
source_email_id
```

---

# 19. Parcours utilisateurs

## 19.1 Création d’un projet

1. L’administrateur crée le projet.
2. Cockpit génère le code.
3. Cockpit crée l’adresse projet.
4. L’équipe est sélectionnée.
5. Les accès sont créés.
6. Le dossier Drive est généré.
7. Les modèles de tâches sont appliqués.
8. Le projet devient actif.

---

## 19.2 Traitement d’un e-mail

1. Le client écrit à l’adresse projet.
2. Le message arrive dans Gmail.
3. Cockpit le synchronise.
4. Le message est rattaché au projet.
5. Cockpit produit un résumé.
6. Cockpit propose tâches, décisions et échéances.
7. Le collaborateur confirme ou corrige.
8. Les éléments validés apparaissent dans le projet.

---

## 19.3 Travail sur une tâche

1. Le collaborateur ouvre sa vue Aujourd’hui.
2. Il sélectionne une tâche.
3. Il démarre le chrono.
4. Il travaille.
5. Il ajoute un commentaire.
6. Il arrête le chrono.
7. Le temps est rattaché au projet.
8. La tâche est mise à jour.

---

# 20. MVP recommandé

## Périmètre MVP

### Projets

- création ;
- équipe ;
- phases ;
- code projet ;
- statut.

### Gmail

- connexion Google ;
- synchronisation ;
- rattachement aux projets ;
- liens vers Gmail ;
- résumé simple.

### Tâches

- création manuelle ;
- création depuis un e-mail ;
- attribution ;
- priorité ;
- échéance ;
- statut ;
- vue personnelle.

### Temps

- chrono ;
- saisie manuelle ;
- historique ;
- temps par projet ;
- temps par tâche.

### Documents

- lien Drive ;
- classement manuel ;
- lien vers l’e-mail source.

### IA

- résumé ;
- proposition de tâches ;
- proposition d’échéances ;
- validation humaine obligatoire.

---

# 21. Phases suivantes

## Phase 2

- création automatique des Google Groups ;
- synchronisation Drive ;
- classement proposé des pièces jointes ;
- décisions ;
- risques ;
- recherche globale ;
- agenda projet.

## Phase 3

- extension Gmail ;
- recherche sémantique ;
- questions en langage naturel ;
- rentabilité ;
- charge prévisionnelle ;
- comparaison prévu / réel ;
- exports avancés.

## Phase 4

- automatisations avancées ;
- facturation ;
- contrats ;
- CRM ;
- appels d’offres ;
- portail client ;
- portail partenaires ;
- reporting direction.

---

# 22. Critères d’acceptation essentiels

Le système est acceptable si :

1. un utilisateur peut continuer à travailler depuis Gmail ;
2. chaque message projet est visible dans Cockpit ;
3. chaque message Cockpit peut être rouvert dans Gmail ;
4. une tâche peut être créée depuis un e-mail ;
5. une tâche peut être créée manuellement ;
6. chaque collaborateur possède une vue personnelle ;
7. le chrono est accessible en un clic ;
8. le temps est rattaché à un projet ou une tâche ;
9. une décision conserve sa source ;
10. une pièce jointe conserve le lien vers son e-mail ;
11. les propositions IA peuvent être acceptées, modifiées ou refusées ;
12. les droits sont gérés par projet ;
13. les actions sensibles sont historisées ;
14. aucune réponse n’est envoyée automatiquement sans validation ;
15. les données permettent un suivi prévu / réel.

---

# 23. Google Workspace

## Est-il nécessaire ?

Pour cette architecture, Google Workspace est fortement recommandé.

Il apporte :

- adresses professionnelles ;
- domaine agence ;
- gestion centralisée des utilisateurs ;
- Gmail ;
- Google Groups ;
- alias ;
- Drive partagé ;
- Calendar ;
- Contacts ;
- administration ;
- API ;
- gestion des accès.

Une version gratuite de Gmail ne permettrait pas de gérer proprement l’ensemble de l’agence et des adresses projet.

## Offre recommandée

Pour démarrer, une formule professionnelle intermédiaire est généralement suffisante.

L’offre doit être choisie en fonction de :

- nombre de collaborateurs ;
- volume de stockage ;
- besoin de Drive partagé ;
- besoins de sécurité ;
- archivage ;
- conservation légale ;
- administration avancée.

Les fonctions exactes et les tarifs doivent être vérifiés au moment du déploiement.

---

# 24. Risques et garde-fous

## Risques techniques

- quotas API Google ;
- synchronisation incomplète ;
- doublons ;
- changements de droits ;
- erreurs de rattachement ;
- dépendance à Google Workspace ;
- indisponibilité temporaire.

## Garde-fous

- synchronisation rejouable ;
- journal d’erreurs ;
- actions idempotentes ;
- validation humaine ;
- sauvegardes ;
- contrôle des accès ;
- historique ;
- possibilité de corriger manuellement ;
- alertes en cas d’échec.

---

# 25. Synthèse

Cockpit doit devenir la mémoire opérationnelle de l’agence.

Gmail reste le lieu des échanges.

Drive reste le lieu des documents.

Cockpit relie les deux et ajoute :

- le projet ;
- les tâches ;
- les décisions ;
- les échéances ;
- les risques ;
- le chrono ;
- les feuilles de temps ;
- la charge ;
- la rentabilité ;
- la recherche ;
- l’intelligence artificielle.

L’objectif n’est pas de créer un outil supplémentaire à remplir.

L’objectif est de transformer automatiquement le travail déjà réalisé dans Gmail, Drive et Calendar en une information structurée, fiable et directement exploitable par l’agence.
