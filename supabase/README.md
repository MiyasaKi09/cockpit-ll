# Synchronisation Supabase

La synchronisation est facultative. Sans Supabase, le Cockpit reste utilisable
en local dans le navigateur ; un export JSON régulier demeure indispensable.

## Installation

1. Créez un projet Supabase dans une région UE.
2. Activez le fournisseur Auth **Email** et désactivez les inscriptions libres :
   seuls les comptes de l’agence doivent pouvoir se connecter. Créez les
   comptes (lien magique) **avant** l’étape suivante.
3. Exécutez `schema.sql` dans le SQL Editor, ou appliquez les migrations
   versionnées avec la CLI Supabase. Plus aucune adresse n’est à remplacer à la
   main : `schema.sql` inscrit au registre les comptes déjà présents dans Auth,
   et il est rejouable — si aucun compte n’existait encore, il le dit
   (`WARNING : registre des membres vide`) et il suffit de le rejouer après.
4. Copiez la Project URL et la clé publique `publishable`/`anon`.

Le schéma crée :

- la table `public.membres`, **registre des comptes autorisés** (compte ↔
  personne ↔ rôle ↔ actif) et seule autorité de contrôle d’accès, avec les
  fonctions `est_membre_actif()` et `role_courant()` en `security definer` que
  toutes les politiques appellent ;
- la table `public.workspace`, protégée par RLS ;
- des privilèges SQL explicites pour `authenticated` et aucun accès pour
  `anon` ;
- la fonction `enregistrer_workspace`, seul chemin d’écriture, exécutée en
  `security definer` avec un `search_path` verrouillé et un contrôle du compte
  connecté fait sur le registre — un membre en `lecture_seule` lit le document
  partagé mais ne l’écrit pas ;
- l’estampille de l’auteur : la fonction renseigne elle-même `updated_by` depuis
  `auth.uid()`. Le paramètre `p_updated_by` reste accepté — la signature ne
  bouge pas — mais il n’est plus qu’une annonce du navigateur, rangée dans
  `updated_by_client`, où elle sert au filtre anti-écho Realtime et à rien
  d’autre : un client peut annoncer n’importe qui, une session non ;
- une colonne `revision` utilisée comme verrou optimiste ;
- la publication Realtime de la table.

La clé publique n’est pas un secret. La sécurité repose sur la session
Supabase, les privilèges et les politiques RLS. La clé `service_role`, elle, est
un secret serveur et ne doit jamais entrer dans le navigateur ou le dépôt.

## Connexion des postes

Dans **Paramètres → Branchements** :

1. renseignez la Project URL, la clé publique et le même identifiant d’espace ;
2. envoyez le lien magique à l’adresse autorisée ;
3. ouvrez-le depuis le poste concerné ;
4. cliquez sur **Synchroniser maintenant**.

Un espace vide est initialisé avec les données locales. Un espace existant est
récupéré en conservant la configuration propre au poste et les documents
marqués privés.

## Conflits et mode hors ligne

Chaque écriture compare la révision précédemment lue. Si l’autre poste a écrit
entre-temps, l’envoi est refusé : les changements locaux restent visibles et
un marqueur de conflit persiste après rechargement.

Avant de choisir **Récupérer la version partagée**, exportez les données locales
en JSON. Cette action est volontairement explicite car elle abandonne les
modifications locales non synchronisées. Le bouton **Pousser mes données** ne
force jamais l’écrasement d’une révision plus récente.

Hors ligne, les modifications continuent d’être enregistrées localement. Une
erreur de lecture, d’écriture ou un dépassement de quota est affiché dans
l’interface au lieu d’être ignoré.

## Confidentialité

`settings.sync` et les documents de corpus portant `prive: true` sont retirés
du document partagé avant chaque écriture. Ces documents privés sont également
exclus des appels à l’assistant IA.

## Schéma complet de l’ingestion et de la veille

`schema.sql` est le bootstrap minimal de la synchronisation `workspace`. Pour
reproduire **toutes** les fonctions serveur du dépôt, appliquez les migrations
versionnées de `supabase/migrations/` dans l’ordre. Elles ajoutent les contrats
réellement utilisés par `supabase/functions/`, `src/entrants.ts` et
`src/veille.ts` :

| Objet | Rôle | Accès navigateur |
| --- | --- | --- |
| `ingestion_config` | secrets OAuth Gmail, secret interne du cron, état du dernier scan, curseur de lecture incrémentale Gmail et portée de ce curseur | aucun ; `service_role` seulement |
| `entrants` | index des pièces Gmail et DCE à valider, avec le contexte du message qui les a apportées (fil, destinataires, en-têtes RFC, libellés, date d’envoi, sens entrant/sortant, extrait du corps) | lecture et marquage traité pour les comptes de l’agence |
| `veille_collectes` | journal de chaque collecte | lecture |
| `veille_signaux` | opportunités normalisées, dédupliquées par source | lecture |
| `veille_observations` | provenance des alertes e-mail | lecture |
| `veille_etat` | curseurs techniques incrémentaux | aucun ; `service_role` seulement |
| `veille_jobs` | file d’enrichissement et de retrait DCE | lecture, création et relance |
| `veille_pages` | métadonnées et empreintes des pages analysées | lecture des métadonnées |
| `veille_field_evidence` | preuve et validation de chaque champ extrait | lecture et validation |
| `veille_documents` | versions des DCE et mode d’accès | lecture |

La migration crée également :

- les buckets privés `entrants` et `veille` ;
- une politique Storage autorisant uniquement le téléchargement des objets
  `entrants` par les comptes de l’agence ; le brut du bucket `veille` reste
  réservé au serveur ;
- le trigger `veille_cle_canonique`, qui normalise uniformément les objets ;
- la RPC `reclamer_veille_jobs(integer)`, accessible uniquement à
  `service_role`, qui réserve les jobs avec `FOR UPDATE SKIP LOCKED` ;
- les contraintes d’unicité, clés étrangères et index correspondant aux
  lectures et écritures du code ;
- des `GRANT` explicites, distincts des politiques RLS.

## Qui a le droit — le registre des membres

Les adresses autorisées ne sont plus écrites nulle part dans le code. La table
`public.membres` fait autorité, pour les politiques RLS comme pour les Edge
Functions. Elle est amorcée par la migration `20260730180000` avec les comptes
en service, dans la même transaction que la réécriture des politiques : une
migration qui laisserait le registre vide échoue et s’annule, plutôt que de
verrouiller l’agence hors de son propre outil.

| Geste | Avant | Maintenant |
| --- | --- | --- |
| Ajouter une personne | migration SQL, 23 endroits | `insert into public.membres (email, personne, role) values (…)` |
| Retirer une personne | migration SQL, 23 endroits | `update public.membres set actif = false where email = …` |
| Changer une adresse | migration SQL, 23 endroits + 5 Edge Functions | `update public.membres set email = … where compte_id = …` |

Le registre se lit depuis le navigateur (les membres voient qui est autorisé)
mais ne s’écrit **que** côté serveur : un compte compromis ne peut pas s’ajouter
un complice. Les rôles reconnus sont ceux du §14.1 du cahier des charges ;
aujourd’hui seul `lecture_seule` a un effet — il retire les droits d’écriture,
y compris sur le document partagé.

**Ordre d’intervention, à ne pas inverser :** appliquez d’abord la migration,
**ensuite** seulement redéployez les Edge Functions. Leur source interroge
`public.membres` et refuse tout le monde tant que la table n’existe pas
(refuser, jamais autoriser) ; l’ordre inverse coupe l’ingestion. Les fonctions
déjà déployées, elles, ne sont pas affectées par la migration : elles passent
par `service_role`, que la RLS n’atteint pas.

**Reste hors du registre, à traiter lors d’une bascule d’adresse :** la variable
d’environnement Vercel `AGENCE_EMAILS`, lue par `api/assistant.js`. Elle ne
contient aucune adresse dans le dépôt, mais elle constitue une seconde liste :
mettez-la à jour en même temps que le registre. Même remarque pour
`VEILLE_CONTACT_EMAIL`, l’adresse de contact du User-Agent de la veille
(`veille-enrichir`, `scraper-worker`), vide par défaut.

## Secrets Vault et tâches planifiées

La migration de planification ne contient ni URL de projet, ni clé API, ni
secret de cron. Avant son premier déclenchement, créez les deux entrées
suivantes dans **Database → Vault** ou dans le SQL Editor :

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co',
  'project_url',
  'URL publique utilisée par pg_cron'
);

select vault.create_secret(
  '<publishable-key>',
  'publishable_key',
  'Clé publique transmise au gateway des Edge Functions'
);
```

Le secret `x-cron-secret` est généré aléatoirement par la migration dans
`ingestion_config` et lu seulement à l’exécution. Il n’est jamais copié dans
`cron.job`.

Les quatre tâches reproduites sont :

| Tâche | Fréquence UTC | Fonction |
| --- | --- | --- |
| `gmail-ingestion` | toutes les 10 minutes | pièces jointes Gmail, lues par tranches successives depuis un curseur `internalDate` |
| `veille-collecte` | à `:20`, toutes les 4 heures | BOAMP et TED |
| `veille-mails` | à `:50`, toutes les heures | alertes des plateformes |
| `veille-enrichir` | toutes les 10 minutes | fiches publiques, preuves et DCE |

`cron.schedule()` remplace une tâche existante portant le même nom : réappliquer
la migration ne crée donc pas de doublons.

## Déploiement reproductible

Avec la CLI Supabase officielle :

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push

npx supabase functions deploy ingestion-config
npx supabase functions deploy gmail-oauth
npx supabase functions deploy gmail-ingestion
npx supabase functions deploy veille-collecte
npx supabase functions deploy veille-mails
npx supabase functions deploy veille-enrichir
```

Sur un projet **déjà en service**, l’ordre de bascule compte : la migration
`20260729170200` retire le chemin d’écriture direct sur `public.workspace`, que
le front précédent utilise encore. Suivez
[`docs/MISE_EN_PRODUCTION.md`](../docs/MISE_EN_PRODUCTION.md), qui encadre cette
fenêtre avec les deux scripts de
[`supabase/operations/`](operations/README.md).

Configurez ensuite les identifiants Google depuis **Paramètres →
Branchements**, puis accordez le consentement Gmail. Ne placez jamais la clé
`service_role`, le secret OAuth Google ou un refresh token dans Git.

La connexion Gmail démarre depuis une URL signée valable dix minutes. Vous
pouvez lui dédier un secret distinct avec
`npx supabase secrets set GMAIL_OAUTH_INIT_SECRET=<secret-de-32-caracteres-ou-plus>`.
À défaut, les fonctions utilisent la clé serveur Supabase déjà injectée ; aucun
secret supplémentaire n’est obligatoire.

Vérifications structurelles sans lire les secrets :

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name like 'veille_%'
order by table_name;

select id, public
from storage.buckets
where id in ('entrants', 'veille')
order by id;

select jobname, schedule, active
from cron.job
where jobname in (
  'gmail-ingestion',
  'veille-collecte',
  'veille-mails',
  'veille-enrichir'
)
order by jobname;
```
