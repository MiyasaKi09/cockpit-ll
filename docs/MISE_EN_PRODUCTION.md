# Mise en production

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

Cette étape précède obligatoirement le déploiement du front : sans
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et `AGENCE_EMAILS`, l'assistant
répond `501 Assistant non configuré` par conception, et ce comportement ne doit
pas être contourné.

N'écrivez jamais la clé `service_role` ni la clé Anthropic dans une variable
préfixée `VITE_` : Vite les intégrerait au code envoyé au navigateur.

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
   ```

   `supabase/config.toml` fixe le `verify_jwt` de chacune. Les cinq fonctions
   appelées sans session utilisateur — callback OAuth et tâches planifiées —
   sont en `verify_jwt = false` et appliquent leur propre authentification
   (`state` OAuth signé ou `x-cron-secret`). Un déploiement qui les passerait en
   `verify_jwt = true` casserait les crons.

4. **Tâches planifiées** : créées par la migration `20260730085456`.
   `cron.schedule()` remplace une tâche de même nom, donc réappliquer ne crée
   pas de doublon.

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
 where jobname in ('gmail-ingestion', 'veille-collecte', 'veille-mails', 'veille-enrichir')
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
elle ne peut pas être automatisée.

1. Dans la console Google Cloud, créer un identifiant OAuth « application web »
   dont l'URI de redirection est
   `https://<project-ref>.supabase.co/functions/v1/gmail-oauth`.
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

## Retour arrière

- **Front** : redéployer le déploiement Vercel précédent.
- **Écritures directes** : rejouer
  `supabase/operations/workspace-ecritures-directes-ouvrir.sql` pour rendre la
  main aux anciens postes.
- **Base** : les migrations sont rejouables mais ne se défont pas. Un retour en
  arrière sur le schéma passe par la restauration de la sauvegarde prise avant
  l'étape 4.
