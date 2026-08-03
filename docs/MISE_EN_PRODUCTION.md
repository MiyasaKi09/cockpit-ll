# Mise en production

> **État du projet `rxwnbscmmgflvwxafbek` au 03/08/2026.**
>
> **Base : à jour, onze migrations appliquées et vérifiées.** Registre à deux
> membres actifs rattachés à leurs comptes, zéro politique comparant à une
> adresse littérale, `communications` avec ses quatre colonnes générées,
> `propositions` avec ses sept contraintes, journal d'audit en ajout seul, et
> depuis le 03/08 les deux tables du temps — `pointages` et `chrono_actif`.
>
> Les garanties de `20260801090000` ont été **exercées en production**, pas
> seulement posées : une durée négative, une fin antérieure à son début, une
> activité hors référentiel et un second chrono pour la même personne ont tous
> été refusés. Une correction de durée laisse dans le journal une ligne portant
> le seul champ modifié, avec ses valeurs avant et après ; le commentaire libre
> y figure par son NOM, jamais par sa valeur.
>
> **Fonctions Edge : deux restent en retard.** État relevé le 03/08 :
>
> | Fonction | En ligne | Verdict |
> | --- | --- | --- |
> | `gmail-oauth` | v2, 30/07 | à jour |
> | `ingestion-config` | **v3, 03/08** | à jour |
> | `veille-collecte` / `-enrichir` / `-mails` | v2–v3, 30/07 | à jour |
> | `gmail-ingestion` | v2, 30/07 | **en retard de 5 commits** (A.1, A.2, A.4, A.8) |
> | `resume-messages` | — | **jamais déployée** |
>
> Les versions en ligne continuent de fonctionner — les migrations sont
> additives, c'est leur raison d'être. Le cron `gmail-ingestion` tourne
> d'ailleurs toutes les dix minutes sans erreur et répond « En attente : Gmail
> n'est pas connecté ». Mais la version déployée est ANTÉRIEURE à A.2, le
> livrable qui a créé `public.communications` : elle n'écrit pas dans cette
> table. Le cron de `resume-messages` a été **désactivé** plutôt que laissé à
> frapper une fonction absente toutes les quinze minutes.
>
> **Le déploiement se fait par le workflow `Déployer une fonction Edge`**
> (`.github/workflows/deployer-fonctions.yml`) : onglet Actions du dépôt,
> « Run workflow », choisir la fonction. Il exige une fois le secret
> `SUPABASE_ACCESS_TOKEN` (Settings → Secrets and variables → Actions).
>
> Pourquoi par là et pas autrement : le workflow déploie **les octets du
> dépôt**. Retaper 113 Ko à travers un outil de conversation, ce serait
> déployer une copie non relue — et `classement-echanges.ts` est un lexique de
> 714 lignes où une faute d'un caractère ne plante rien : elle fait classer
> faux, en silence. Aucun test du dépôt ne verrait la différence, puisqu'ils
> lisent les fichiers, pas ce qui a été déployé.
>
> **Dans cet ordre :**
>
> 1. workflow → `gmail-ingestion` ;
> 2. workflow → `resume-messages`, puis ses deux secrets côté Supabase
>    (`RESUME_ANTHROPIC_API_KEY`, `RESUME_MODELE` — Edge Functions → Secrets),
>    puis réactiver son cron :
>
> ```sql
> select cron.alter_job(
>   job_id := (select jobid from cron.job where jobname = 'resume-messages'),
>   active := true);
> ```
>
> 3. **et seulement ensuite** le consentement Gmail (section plus bas).
>
> L'ordre n'est pas cosmétique : consentir AVANT de déployer `gmail-ingestion`
> lance l'ingestion sur la version pré-A.2. `communications` resterait à 0 et
> le compteur de `#/parite` ne bougerait jamais — on chercherait un défaut de
> mesure là où il y aurait un défaut de version.
>
> **Après le déploiement de `gmail-ingestion`, l'écran `#/parite` (B.18)
> mesure la condition de coupure de B.15** : jours consécutifs sans écart
> entre les deux mémoires du courrier. C'est lui qui dira quand
> `state.courriers` peut cesser d'être alimenté — pas une impression.

Procédure de bascule d'un projet Cockpit **déjà en service** vers la version
durcie. Elle est ordonnée : chaque étape suppose la précédente terminée, et
l'ordre existe précisément pour qu'aucun poste ne se retrouve sans chemin
d'écriture.

Pour un projet **neuf**, cette procédure ne s'applique pas : appliquez les
migrations de `supabase/migrations/` dans l'ordre, déployez les fonctions,
configurez les variables, et ignorez les étapes 4 bis et 6 — l'état durci est
alors atteint directement.

Sauvegardez et testez une restauration avant de commencer.

## 1. Pousser la branche et ouvrir la demande de fusion

La CI (`.github/workflows/ci.yml`) et le déploiement de prévisualisation Vercel
se déclenchent sur la demande de fusion. Ne fusionnez rien à cette étape.

## 2. Attendre la CI et la prévisualisation

Les deux doivent être au vert :

- le job `verify` : lint, `npm run build`, puis les suites de tests ;
- le contrôle `Vercel` : le déploiement de prévisualisation aboutit.

La prévisualisation partage la base de production. Elle vérifie que le front se
compile et se charge, pas que la base est déjà migrée.

## 3. Configurer les variables d'environnement Vercel

Dans le projet Vercel, environnement **Production** (et **Preview** si vous y
testez l'assistant) :

| Variable | Obligatoire | Rôle |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | oui | clé serveur de l'assistant |
| `SUPABASE_URL` | oui | vérification de la session par `api/assistant.js` |
| `SUPABASE_PUBLISHABLE_KEY` | oui | clé publique de vérification ; `SUPABASE_ANON_KEY` reste accepté en repli |
| `AGENCE_EMAILS` | oui | comptes autorisés, séparés par des virgules |
| `APP_ORIGIN` | oui | origines exactes autorisées, sans barre finale, séparées par des virgules |
| `ASSISTANT_MODELE` | non | modèle standard |
| `ASSISTANT_MODELE_DIFFICILE` | non | modèle d'escalade |

Valeurs de ce projet — ni l'une ni l'autre n'est un secret, la clé publiable
est faite pour être lue par le navigateur :

```
SUPABASE_URL=https://rxwnbscmmgflvwxafbek.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_1vHhiHfOTn4hbN-EIDrQcQ_HgjPPKCj
```

`AGENCE_EMAILS` ne figure pas ici, et ce n'est pas un oubli : depuis le
livrable 0.2, `public.membres` est la seule autorité sur qui est de l'agence.
Recopier les adresses dans ce document en ferait un endroit de plus à retrouver
le jour de la bascule d'identité (livrable 3.2) — c'est précisément ce que
`test:adresses` interdit, et il a raison. Lisez-les au registre :

```sql
select string_agg(email, ',' order by email) as agence_emails
from membres where actif;
```

Le résultat se colle tel quel. Il est juste par construction, et il le restera
après un ajout ou un départ.

Cette étape précède obligatoirement le déploiement du front : sans
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et `AGENCE_EMAILS`, l'assistant
répond `501 Assistant non configuré` par conception, et ce comportement ne doit
pas être contourné.

**Redéployez après avoir enregistré.** Vercel n'applique les variables qu'aux
déploiements suivants : sans redéploiement on lit `501` et on croit à une faute
de frappe.

`APP_ORIGIN` est marquée obligatoire mais ne bloque pas l'assistant : le code
ajoute déjà l'hôte courant à la liste autorisée. Elle sert le jour de la
bascule vers `agence-ll.fr` — mettez-y alors les deux origines, séparées par
une virgule.

**Vérification :** ouvrez l'assistant depuis le Cockpit connecté. Appeler
`/api/assistant?ping=1` dans la barre d'adresse ne prouve rien — la route exige
une session Supabase et répond `501` même bien configurée.

N'écrivez jamais la clé `service_role` ni la clé Anthropic dans une variable
préfixée `VITE_` : Vite les intégrerait au code envoyé au navigateur. La
`service_role` n'a rien à faire chez Vercel du tout — aucun fichier de `api/`
ne la lit.

## 4. Appliquer Supabase

Dans cet ordre :

1. **Secrets Vault**, avant toute exécution planifiée :

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url',
     'URL publique utilisée par pg_cron');
   select vault.create_secret('<publishable-key>', 'publishable_key',
     'Clé publique transmise au gateway des Edge Functions');
   ```

2. **Migrations** : `npx supabase link --project-ref <project-ref>` puis
   `npx supabase db push`. La migration `20260730085155` est rejouable sur un
   schéma historique et conserve le `cron_secret` existant.

3. **Fonctions Edge**, dans cet ordre :

   ```bash
   npx supabase functions deploy ingestion-config
   npx supabase functions deploy gmail-oauth
   npx supabase functions deploy gmail-ingestion
   npx supabase functions deploy veille-collecte
   npx supabase functions deploy veille-mails
   npx supabase functions deploy veille-enrichir
   npx supabase functions deploy resume-messages
   ```

   `supabase/config.toml` fixe le `verify_jwt` de chacune. Les six fonctions
   appelées sans session utilisateur — callback OAuth et tâches planifiées —
   sont en `verify_jwt = false` et appliquent leur propre authentification
   (`state` OAuth signé ou `x-cron-secret`). Un déploiement qui les passerait en
   `verify_jwt = true` casserait les crons.

4. **Tâches planifiées** : créées par les migrations `20260730085456`
   (`gmail-ingestion`, `veille-collecte`, `veille-mails`, `veille-enrichir`) et
   `20260731170000` (`resume-messages`). `cron.schedule()` remplace une tâche de
   même nom, donc réappliquer ne crée pas de doublon.

5. **Secret du résumé automatique**, si l'agence veut les résumés du §5.3 :

   ```bash
   npx supabase secrets set RESUME_ANTHROPIC_API_KEY=sk-ant-...
   # facultatif : npx supabase secrets set RESUME_MODELE=claude-opus-5
   ```

   Cette clé est **propre à `resume-messages`** : ce n'est pas celle de Vercel,
   et c'est délibéré — révoquer l'une n'éteint pas l'autre, et la facture se
   lit par usage. Tant qu'elle n'est pas posée, la tâche tourne, ne dépense
   rien, et l'écrit dans `ingestion_config.resume_dernier_resultat`. Rien
   d'autre dans le Cockpit n'en dépend.

La migration `20260730180000` crée le **registre des membres**
(`public.membres`) et fait appeler `est_membre_actif()` / `role_courant()` par
toutes les politiques, à la place des adresses recopiées. Trois conséquences
opérationnelles :

- elle **amorce le registre avec les comptes en service dans la même
  transaction** que la réécriture des politiques, et lève une exception — donc
  annule tout — si le registre resterait vide. Une base ne peut pas se
  retrouver avec des politiques qui interrogent un registre sans personne ;
- elle **refuse de s'appliquer si une politique compare encore à une adresse**.
  C'est le cas pendant l'ouverture transitoire de l'étape 4 bis : refermez-la
  (étape 6) avant de la pousser, ou appliquez-la lors d'un `db push` ultérieur ;
- les **Edge Functions se déploient après elle**, jamais avant : leur nouvelle
  source interroge `public.membres` et refuse tout le monde tant que la table
  n'existe pas. Les fonctions déjà déployées ne sont pas affectées par la
  migration, elles passent par `service_role`.

Après elle, ajouter ou retirer une personne, ou changer son adresse, est un
`update` d'une ligne de `public.membres` — plus une migration.

La migration `20260731103000` enrichit l'ingestion Gmail (livrable A.1) : elle
ajoute à `public.entrants` le contexte du message qui apporte chaque pièce —
fil de discussion, destinataires, en-têtes RFC, libellés, date d'envoi distincte
de la réception, sens entrant/sortant, extrait du corps — et à
`public.ingestion_config` le curseur de lecture incrémentale avec sa portée.
Deux points opérationnels :

- **elle s'applique AVANT le redéploiement de `gmail-ingestion`**, comme celle
  du registre : la nouvelle source écrit ces colonnes, et une insertion vers
  une colonne absente échoue à chaque passage, toutes les dix minutes, sans
  autre trace que les journaux Supabase. La fonction déjà déployée, elle,
  ignore ces colonnes — toutes sont nullables ou ont une valeur par défaut ;
- **au premier passage de la nouvelle fonction, le curseur est vide** : elle
  reprend une fenêtre de sept jours, exactement l'ancienne fenêtre fixe, puis
  avance par tranches d'un jour au maximum jusqu'à rattraper le présent. Sur
  une boîte chargée, le rattrapage prend donc plusieurs passages du cron ;
  `ingestion_config.dernier_resultat` dit à chaque fois jusqu'où le curseur est
  allé et combien de messages restent en attente.

La migration `20260731150000` crée `public.communications` (livrable A.2),
l'index des **messages** : un message, une ligne, qu'il porte une pièce jointe
ou non. C'est elle qui fait exister dans Cockpit le courrier d'un projet qui
n'apporte aucun fichier — la grande majorité — et donc le critère 2 du §22.
Quatre points opérationnels :

- **elle s'applique AVANT le redéploiement de `gmail-ingestion`**, pour la même
  raison que la précédente : la nouvelle source insère dans cette table, et une
  insertion vers une table absente échoue à chaque passage du cron ;
- **la requête Gmail s'élargit**, de « les messages avec pièce jointe » à tout
  le courrier. La portée du curseur passe donc de `v1` à `v2`, et la fonction
  **repart d'une fenêtre de sept jours** : c'est voulu, et c'est ce que
  `curseur_gmail_portee` protégeait. Un curseur hérité de la requête étroite
  aurait fait sauter en silence tout l'historique sans pièce jointe. Le
  rattrapage prend plusieurs heures de cron ; les pièces déjà validées ne sont
  pas re-proposées (l'unicité de `entrants` et le contrôle « déjà vues » n'ont
  pas bougé) et les messages déjà indexés sont mis à jour, jamais dupliqués ;
- **le volume par passage est borné à 25 messages** comme avant. Les messages
  sans pièce jointe sont ouverts en `format=metadata` (§3.6) : même coût de
  quota, réponse dix à cinquante fois plus légère, et le `snippet` de Gmail
  sert d'extrait de corps ;
- **les trois axes du §5.2 sont remplis depuis le livrable A.8**, par un
  lexique déterministe embarqué dans `gmail-ingestion` (aucun appel de modèle,
  donc aucun coût et aucune clé à poser). **Aucune migration ne l'accompagne** :
  les dix colonnes sont là depuis celle-ci, ce qui était tout l'objet de les
  livrer ensemble. Conséquence opérationnelle unique : **redéployer
  `gmail-ingestion`**. Les messages déjà indexés ne sont pas reclassés — ils
  gardent leurs axes vides jusqu'à ce que le curseur repasse ou qu'un humain
  les renseigne (Documents → « À rattacher » → « Corriger le classement ») ;
  aucune correction humaine n'est écrasée, l'`upsert` ne touche que les
  colonnes proposées.

Cette migration ne se défait pas d'un `drop table` sans perdre les corrections
humaines qu'elle aura accumulées : rattachements, axes choisis, messages
marqués traités. Elle est en revanche entièrement rejouable.

La migration `20260731170000` fait tourner le **résumé automatique** du §5.3
(livrable A.6). Elle ne crée aucune colonne de résumé — `communications.resume`
et `resume_le` viennent de `20260731150000` — mais elle pose ce qui borne la
dépense. Quatre points opérationnels :

- **elle s'applique AVANT le déploiement de `resume-messages`** : la fonction
  s'authentifie sur `ingestion_config.resume_cron_secret`, et sans cette
  colonne elle refuse tout le monde, y compris son propre planificateur ;
- **le secret de cette tâche est distinct de `cron_secret`**, que les quatre
  autres partagent, et il est tiré en base : il n'apparaît ni dans Git ni dans
  `cron.job`. C'est la seule tâche du dépôt qui dépense de l'argent à chaque
  passage — un secret compromis ailleurs ne doit pas ouvrir ce robinet. La
  migration **refuse de s'appliquer** si les deux secrets sont identiques ;
- **seuls les messages rattachés à un projet sont résumés** (§3.8), au plus
  huit par passage, quarante par heure et deux cents par jour. Ces bornes sont
  dans le code de la fonction ; le compteur, lui, est `resume_le` — ce qui a
  réellement été facturé, et non un compteur à part qui pourrait en diverger ;
- **sans `RESUME_ANTHROPIC_API_KEY`, rien ne se produit et rien ne se casse.**
  Le résumé est un confort : le reste du Cockpit ne le lit jamais pour décider.

**Depuis A.10, cette même fonction produit aussi les détections** (tâches,
échéances, décisions, risques). Trois conséquences opérationnelles :

- **redéployez `resume-messages` APRÈS `20260731190000`**, qui crée
  `propositions`. Dans l'autre ordre, chaque passage écrirait vers une table
  absente : le résumé passerait quand même — l'échec d'insertion est capté et
  journalisé — mais les détections seraient perdues sans trace visible ;
- **les détections ne coûtent aucun appel supplémentaire.** Elles voyagent dans
  la même réponse que le résumé, sous forme d'un bloc JSON séparé, et
  n'ajoutent que des jetons de sortie. Les bornes de débit ci-dessus les
  couvrent donc telles quelles ;
- **elles n'écrivent que dans `propositions`, au statut `proposee`.** Aucune
  tâche, aucune décision, aucun risque n'est créé : c'est l'acceptation humaine
  qui crée, et le domaine SQL de `statut` le rend structurel. Un premier étage
  déterministe (`src/detecteurs.ts`) fonctionne par ailleurs sans clé d'API :
  le jour où le budget IA est coupé, les détections lexicales continuent.

La migration `20260731190000` crée `public.propositions` (livrable A.9), la
table à **quatre genres** où atterriront les détections de tâches, échéances,
décisions et risques (§12.3 pts 5-8). Trois points opérationnels, et le premier
est le plus reposant :

- **elle n'est suivie d'aucun déploiement.** Rien ne la remplit encore : les
  détecteurs sont le livrable A.10 et les écrans de revue B.10/B.11. Une table
  vide ne casse rien et ne coûte rien ; c'est l'inverse — une détection écrite
  vers une table absente — qui échouerait à chaque passage du cron, sans autre
  trace que les journaux Supabase ;
- **elle s'applique après `20260731150000`**, dont elle référence la clé
  primaire (`communication_id`), et après le registre des membres, dont elle
  appelle `est_membre_actif()` / `role_courant()` ;
- **elle refuse de s'appliquer** si le domaine de `statut` a pris un statut
  métier, si l'extrait ou la source peuvent être nuls, ou si le navigateur a
  reçu le droit d'écrire une colonne autre que les cinq colonnes de traitement.
  Ce n'est pas une précaution de style : ces trois défauts ne produiraient
  aucune erreur visible, et le premier ferait de la table des détections la
  mémoire des décisions de l'agence.

Elle se défait par un `drop table public.propositions` tant qu'aucune décision
humaine n'y a été enregistrée — c'est-à-dire jusqu'à B.10. Après, elle porte des
acceptations signées, comme `communications` porte des rattachements corrigés.

La migration `20260731210000` pose le **journal d'audit** (livrable A.13) :
`public.journal_audit` en ajout seul, la RPC `journaliser()` et des
déclencheurs sur `communications`, `propositions` et `membres`. Quatre points
opérationnels :

- **elle s'applique après les trois tables qu'elle instrumente** — le contrôle
  final refuse la migration si l'un des trois déclencheurs manque, plutôt que
  de laisser croire à une couverture qu'elle n'aurait pas ;
- **elle ne s'accompagne d'aucun déploiement.** Les déclencheurs écrivent seuls,
  et le front n'a rien à appeler pour l'instant : l'écran de consultation est
  hors MVP (2.6). En attendant, le journal se lit dans l'éditeur SQL de
  Supabase — c'est peu pratique, et c'est suffisant pour deux personnes ;
- **elle refuse `update` et `delete` à tout le monde, `service_role` compris.**
  Si un futur besoin réclame une purge — une obligation de conservation bornée,
  par exemple — ce sera une migration explicite, pas un droit dormant ;
- **elle ne journalise pas les insertions de `communications`.** L'arrivée d'un
  mail n'est pas une action sensible, et une mise à jour qui ne touche aucune
  colonne de décision n'écrit rien du tout : sans cette borne, la réingestion
  quotidienne noierait les décisions humaines sous son propre bruit.

Le contenu des messages n'entre pas dans le journal : `objet`, `corps_extrait`
et `resume` sont hors de la liste blanche. Une colonne modifiée hors liste y
figure par son **nom** seulement. C'est délibéré — une table en ajout seul qui
recopierait le courrier deviendrait une seconde mémoire des échanges, celle-là
indestructible, alors que Gmail reste la source de vérité (§4.1).

Elle se défait par un `drop table public.journal_audit cascade` tant qu'aucune
décision n'y est consignée. Après, elle est ce qu'elle prétend être : une trace.

La migration `20260730160000` fait estampiller l'auteur d'une écriture par le
serveur : `workspace.updated_by` cesse de recevoir l'identifiant d'onglet envoyé
par le navigateur et reçoit `auth.uid()`. La signature de la RPC ne change pas,
donc aucun poste ne perd son chemin d'écriture. Sur un projet **en service**,
appliquez-la de préférence après l'étape 5 : le front de cette version reconnaît
ses propres échos Realtime par `updated_by_client` **ou** par `updated_by`, donc
avant comme après la bascule, tandis qu'un poste resté sur la version précédente
perd ce filtre pendant la fenêtre — sans risque pour ses données, que le verrou
de révision continue de protéger.

### 4 bis. Ouvrir transitoirement les écritures directes

Uniquement sur un projet en service dont le front déployé écrit encore
directement dans `public.workspace` :

```bash
psql "$DATABASE_URL" -f supabase/operations/workspace-ecritures-directes-ouvrir.sql
```

À jouer immédiatement après `db push`. La migration `20260729170200` retire le
chemin d'écriture direct ; sans cette ouverture, les postes encore sur la
version précédente ne peuvent plus enregistrer entre l'étape 4 et l'étape 5.

Cette ouverture suspend le verrou de révision pour les anciens postes : la
fenêtre doit rester courte et se refermer à l'étape 6.

## 5. Déployer le front en production

Fusionner vers `main` déclenche le déploiement de production Vercel. Vérifiez
ensuite la connexion, une synchronisation, et une réponse de l'assistant.

## 6. Appliquer la révocation finale des anciennes écritures

Une fois tous les postes rechargés sur la nouvelle version :

```bash
psql "$DATABASE_URL" -f supabase/operations/workspace-ecritures-directes-revoquer.sql
```

Le script refuse de s'exécuter si `public.enregistrer_workspace` est absente, et
échoue si un privilège ou une policy d'écriture subsiste. La base est alors
revenue à l'état déclaré par les migrations.

## 7. Tester la production

Vérifications structurelles, sans lire aucun secret :

```sql
select table_name
  from information_schema.tables
 where table_schema = 'public'
   and table_name like 'veille_%'
 order by table_name;

select id, public from storage.buckets where id in ('entrants', 'veille') order by id;

select jobname, schedule, active
  from cron.job
 where jobname in ('gmail-ingestion', 'veille-collecte', 'veille-mails', 'veille-enrichir',
                   'resume-messages')
 order by jobname;

select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'workspace'
   and grantee in ('anon', 'authenticated')
 order by grantee, privilege_type;
```

La dernière requête ne doit renvoyer que `authenticated | SELECT`.

Côté application : connexion par lien magique, **Synchroniser maintenant**,
modification depuis un second poste pour vérifier le marqueur de conflit, et une
question à l'assistant.

Relisez enfin les avis de sécurité du projet Supabase.

## Consentement Gmail

Étape distincte, qui exige les identifiants OAuth Google et une action humaine :
elle ne peut pas être automatisée. Google veut quelqu'un devant l'écran de
consentement, et c'est très bien ainsi.

**À faire APRÈS le déploiement de `gmail-ingestion`**, pour la raison donnée en
tête de document : consentir avant lancerait l'ingestion sur la version
pré-A.2, qui n'écrit pas `communications`.

1. Dans la console Google Cloud, créer un identifiant OAuth « application web »
   dont l'URI de redirection est, exactement et sans barre finale :

   ```
   https://rxwnbscmmgflvwxafbek.supabase.co/functions/v1/gmail-oauth
   ```

   Vérifier dans « Écran de consentement OAuth » que la portée demandée est
   `https://www.googleapis.com/auth/gmail.readonly` et rien d'autre — c'est ce
   que le code demande (`gmail.readonly openid email`), et `gmail.send`,
   `gmail.modify` et `gmail.compose` doivent rester hors du périmètre. Si
   l'application est en mode *Testing*, ajouter le compte à lire dans
   « Utilisateurs test », sinon Google refuse le consentement.
2. Saisir `client_id` et `client_secret` dans **Paramètres → Branchements** du
   Cockpit. Ils sont stockés côté serveur, dans `ingestion_config`, jamais dans
   l'état partagé ni dans Git.
3. Lancer la connexion depuis le Cockpit et accorder le consentement avec le
   compte de l'agence. Le lien d'initiation est signé et valable dix minutes.
4. Facultatif : dédier un secret à cette signature avec
   `npx supabase secrets set GMAIL_OAUTH_INIT_SECRET=<32 caractères ou plus>`.
   À défaut, les fonctions utilisent la clé serveur déjà injectée.

Tant que le consentement n'est pas accordé, `gmail-ingestion` n'a pas de
`refresh_token` et ne remonte aucune pièce ; le reste de la veille fonctionne.

**Vérification**, dans le SQL Editor Supabase, dix minutes après :

```sql
select dernier_scan, dernier_resultat from ingestion_config;
select count(*) from communications;
```

`dernier_resultat` doit cesser de dire « En attente ». Si le compteur reste à 0
alors que `dernier_resultat` a changé, c'est que `gmail-ingestion` n'a pas été
redéployée — c'est le symptôme exact de l'inversion d'ordre.

## Retour arrière

- **Front** : redéployer le déploiement Vercel précédent.
- **Écritures directes** : rejouer
  `supabase/operations/workspace-ecritures-directes-ouvrir.sql` pour rendre la
  main aux anciens postes.
- **Base** : les migrations sont rejouables mais ne se défont pas. Un retour en
  arrière sur le schéma passe par la restauration de la sauvegarde prise avant
  l'étape 4.
