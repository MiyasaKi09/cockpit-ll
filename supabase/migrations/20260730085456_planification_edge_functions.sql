-- Planification observée sur le projet cockpit-ll, sans recopier de secret.
--
-- Prérequis Vault (à créer hors Git, voir supabase/README.md) :
--   - project_url    : https://<project-ref>.supabase.co
--   - publishable_key: clé publique du projet
--
-- Le troisième en-tête, x-cron-secret, est lu à l'exécution dans la table
-- privée ingestion_config. La valeur n'apparaît donc jamais dans cron.job.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

select cron.schedule(
  'gmail-ingestion',
  '*/10 * * * *',
  $cron$
    select net.http_post(
      url := (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'project_url'
      ) || '/functions/v1/gmail-ingestion',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'publishable_key'
        ),
        'Authorization', 'Bearer ' || (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'publishable_key'
        ),
        'x-cron-secret', (
          select cron_secret
            from public.ingestion_config
           where id = 'google'
        )
      ),
      body := jsonb_build_object('declenche_le', now()),
      timeout_milliseconds := 120000
    ) as request_id;
  $cron$
);

select cron.schedule(
  'veille-collecte',
  '20 */4 * * *',
  $cron$
    select net.http_post(
      url := (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'project_url'
      ) || '/functions/v1/veille-collecte',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'publishable_key'
        ),
        'Authorization', 'Bearer ' || (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'publishable_key'
        ),
        'x-cron-secret', (
          select cron_secret
            from public.ingestion_config
           where id = 'google'
        )
      ),
      body := jsonb_build_object('declenche_le', now()),
      timeout_milliseconds := 120000
    ) as request_id;
  $cron$
);

select cron.schedule(
  'veille-mails',
  '50 * * * *',
  $cron$
    select net.http_post(
      url := (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'project_url'
      ) || '/functions/v1/veille-mails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'publishable_key'
        ),
        'Authorization', 'Bearer ' || (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'publishable_key'
        ),
        'x-cron-secret', (
          select cron_secret
            from public.ingestion_config
           where id = 'google'
        )
      ),
      body := jsonb_build_object('declenche_le', now()),
      timeout_milliseconds := 120000
    ) as request_id;
  $cron$
);

select cron.schedule(
  'veille-enrichir',
  '*/10 * * * *',
  $cron$
    select net.http_post(
      url := (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'project_url'
      ) || '/functions/v1/veille-enrichir',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'publishable_key'
        ),
        'Authorization', 'Bearer ' || (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'publishable_key'
        ),
        'x-cron-secret', (
          select cron_secret
            from public.ingestion_config
           where id = 'google'
        )
      ),
      body := jsonb_build_object('declenche_le', now()),
      timeout_milliseconds := 120000
    ) as request_id;
  $cron$
);
