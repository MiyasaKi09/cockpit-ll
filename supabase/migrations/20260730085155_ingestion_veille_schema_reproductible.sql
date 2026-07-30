-- Reproduit le contrat PostgreSQL réellement utilisé par les Edge Functions
-- gmail-* / veille-* et par src/entrants.ts + src/veille.ts.
--
-- Les secrets restent dans ingestion_config (service_role uniquement).
-- Les comptes du navigateur n'obtiennent que les privilèges nécessaires,
-- toujours derrière les politiques RLS de l'agence.

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Un ancien projet Cockpit avait installé unaccent dans public. Le déplacer
-- rend le résultat identique sur un projet neuf et sur ce projet historique.
do $$
begin
  if exists (
    select 1
      from pg_extension as e
      join pg_namespace as n on n.oid = e.extnamespace
     where e.extname = 'unaccent'
       and n.nspname <> 'extensions'
  ) then
    alter extension unaccent set schema extensions;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Configuration privée de l'ingestion Gmail
-- ---------------------------------------------------------------------------

create table if not exists public.ingestion_config (
  id                 text primary key,
  client_id          text,
  client_secret      text,
  compte_email       text,
  refresh_token      text,
  oauth_state        text,
  cron_secret        text,
  workspace_id       text not null default 'agence-ll',
  dernier_scan       timestamptz,
  dernier_resultat   text,
  maj_le             timestamptz not null default now()
);

-- CREATE TABLE IF NOT EXISTS ne complète pas une table historique partielle.
-- Ces ALTER rendent donc la migration rejouable sur les premiers prototypes.
alter table public.ingestion_config
  add column if not exists id text,
  add column if not exists client_id text,
  add column if not exists client_secret text,
  add column if not exists compte_email text,
  add column if not exists refresh_token text,
  add column if not exists oauth_state text,
  add column if not exists cron_secret text,
  add column if not exists workspace_id text not null default 'agence-ll',
  add column if not exists dernier_scan timestamptz,
  add column if not exists dernier_resultat text,
  add column if not exists maj_le timestamptz not null default now();

create unique index if not exists ingestion_config_pkey
  on public.ingestion_config (id);

insert into public.ingestion_config (id, cron_secret)
values ('google', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (id) do update
  set cron_secret = coalesce(ingestion_config.cron_secret, excluded.cron_secret);

alter table public.ingestion_config enable row level security;

-- Aucune policy volontairement : seul service_role accède aux secrets.
revoke all on table public.ingestion_config from anon, authenticated;
grant select, insert, update, delete on table public.ingestion_config to service_role;

-- ---------------------------------------------------------------------------
-- Boîte d'arrivée partagée et bucket privé associé
-- ---------------------------------------------------------------------------

create table if not exists public.entrants (
  id                    uuid primary key default gen_random_uuid(),
  source                text not null default 'gmail',
  source_id             text,
  piece_index           integer not null default 0,
  expediteur            text,
  objet                 text,
  recu_le               timestamptz not null default now(),
  nom_fichier           text not null,
  type_mime             text,
  taille                bigint,
  empreinte_sha256      text,
  chemin_storage        text,
  projet_id_propose     text,
  categorie_proposee    text,
  confiance             real,
  raisons               jsonb not null default '[]'::jsonb,
  statut                text not null default 'a_valider',
  traite_par            text,
  traite_le             timestamptz,
  cree_le               timestamptz not null default now()
);

alter table public.entrants
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists source text not null default 'gmail',
  add column if not exists source_id text,
  add column if not exists piece_index integer not null default 0,
  add column if not exists expediteur text,
  add column if not exists objet text,
  add column if not exists recu_le timestamptz not null default now(),
  add column if not exists nom_fichier text,
  add column if not exists type_mime text,
  add column if not exists taille bigint,
  add column if not exists empreinte_sha256 text,
  add column if not exists chemin_storage text,
  add column if not exists projet_id_propose text,
  add column if not exists categorie_proposee text,
  add column if not exists confiance real,
  add column if not exists raisons jsonb not null default '[]'::jsonb,
  add column if not exists statut text not null default 'a_valider',
  add column if not exists traite_par text,
  add column if not exists traite_le timestamptz,
  add column if not exists cree_le timestamptz not null default now();

create unique index if not exists entrants_pkey
  on public.entrants (id);

create unique index if not exists entrants_source_unq
  on public.entrants (source, source_id, piece_index)
  where source_id is not null;

create index if not exists entrants_statut_idx
  on public.entrants (statut);

alter table public.entrants enable row level security;

drop policy if exists "agence lecture" on public.entrants;
drop policy if exists "agence mise a jour" on public.entrants;

create policy "agence lecture"
  on public.entrants
  for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

create policy "agence mise a jour"
  on public.entrants
  for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  )
  with check (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

revoke all on table public.entrants from anon, authenticated;
grant select, update on table public.entrants to authenticated;
grant select, insert, update, delete on table public.entrants to service_role;

insert into storage.buckets (id, name, public)
values ('entrants', 'entrants', false)
on conflict (id) do update
  set name = excluded.name,
      public = false;

drop policy if exists "agence lit les entrants" on storage.objects;

create policy "agence lit les entrants"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'entrants'
    and lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

-- ---------------------------------------------------------------------------
-- Collectes et signaux normalisés
-- ---------------------------------------------------------------------------

create table if not exists public.veille_collectes (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  demarre_le    timestamptz not null default now(),
  termine_le    timestamptz,
  statut        text not null default 'en_cours',
  nb_nouveaux   integer not null default 0,
  nb_maj        integer not null default 0,
  erreur        text
);

alter table public.veille_collectes
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists source text,
  add column if not exists demarre_le timestamptz not null default now(),
  add column if not exists termine_le timestamptz,
  add column if not exists statut text not null default 'en_cours',
  add column if not exists nb_nouveaux integer not null default 0,
  add column if not exists nb_maj integer not null default 0,
  add column if not exists erreur text;

create unique index if not exists veille_collectes_pkey
  on public.veille_collectes (id);

create index if not exists veille_collectes_recentes
  on public.veille_collectes (demarre_le desc);

alter table public.veille_collectes enable row level security;

drop policy if exists "agence lecture" on public.veille_collectes;

create policy "agence lecture"
  on public.veille_collectes
  for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

revoke all on table public.veille_collectes from anon, authenticated;
grant select on table public.veille_collectes to authenticated;
grant select, insert, update, delete on table public.veille_collectes to service_role;

create table if not exists public.veille_signaux (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null,
  source_id          text not null,
  type               text not null default 'initial',
  type_avis          text not null default 'marche',
  objet              text not null,
  acheteur           text,
  date_parution      date,
  date_limite        date,
  departements       text[] not null default '{}',
  procedure          text,
  descripteurs       text[] not null default '{}',
  annonces_liees     text[] not null default '{}',
  url                text,
  empreinte          text,
  collecte_id        uuid references public.veille_collectes (id),
  cree_le            timestamptz not null default now(),
  maj_le             timestamptz not null default now(),
  cle_canonique      text,
  reference          text,
  url_canonique      text,
  niveau_analyse     text not null default 'alerte',
  detail             jsonb,
  enrichi_le         timestamptz
);

alter table public.veille_signaux
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists source text,
  add column if not exists source_id text,
  add column if not exists type text not null default 'initial',
  add column if not exists type_avis text not null default 'marche',
  add column if not exists objet text,
  add column if not exists acheteur text,
  add column if not exists date_parution date,
  add column if not exists date_limite date,
  add column if not exists departements text[] not null default '{}',
  add column if not exists procedure text,
  add column if not exists descripteurs text[] not null default '{}',
  add column if not exists annonces_liees text[] not null default '{}',
  add column if not exists url text,
  add column if not exists empreinte text,
  add column if not exists collecte_id uuid references public.veille_collectes (id),
  add column if not exists cree_le timestamptz not null default now(),
  add column if not exists maj_le timestamptz not null default now(),
  add column if not exists cle_canonique text,
  add column if not exists reference text,
  add column if not exists url_canonique text,
  add column if not exists niveau_analyse text not null default 'alerte',
  add column if not exists detail jsonb,
  add column if not exists enrichi_le timestamptz;

create unique index if not exists veille_signaux_pkey
  on public.veille_signaux (id);

create unique index if not exists veille_signaux_source_unq
  on public.veille_signaux (source, source_id);

create index if not exists veille_signaux_parution
  on public.veille_signaux (date_parution desc);

create index if not exists veille_signaux_type
  on public.veille_signaux (type);

create index if not exists veille_signaux_cle
  on public.veille_signaux (cle_canonique);

create or replace function public.veille_cle_canonique()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  new.cle_canonique := left(
    btrim(
      regexp_replace(
        lower(extensions.unaccent(new.objet)),
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    ),
    120
  );
  return new;
end
$$;

drop trigger if exists veille_signaux_cle on public.veille_signaux;
create trigger veille_signaux_cle
  before insert or update of objet
  on public.veille_signaux
  for each row
  execute function public.veille_cle_canonique();

revoke all on function public.veille_cle_canonique()
  from public, anon, authenticated;
grant execute on function public.veille_cle_canonique()
  to service_role;

alter table public.veille_signaux enable row level security;

drop policy if exists "agence lecture" on public.veille_signaux;

create policy "agence lecture"
  on public.veille_signaux
  for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

revoke all on table public.veille_signaux from anon, authenticated;
grant select on table public.veille_signaux to authenticated;
grant select, insert, update, delete on table public.veille_signaux to service_role;

-- ---------------------------------------------------------------------------
-- Alertes e-mail : observations et curseur incrémental
-- ---------------------------------------------------------------------------

create table if not exists public.veille_observations (
  id                 bigint generated always as identity primary key,
  signal_source      text not null,
  signal_source_id   text not null,
  canal              text not null default 'mail',
  message_id         text not null,
  sujet              text,
  recu_le            timestamptz,
  extrait            jsonb,
  cree_le            timestamptz not null default now()
);

alter table public.veille_observations
  add column if not exists id bigint generated always as identity,
  add column if not exists signal_source text,
  add column if not exists signal_source_id text,
  add column if not exists canal text not null default 'mail',
  add column if not exists message_id text,
  add column if not exists sujet text,
  add column if not exists recu_le timestamptz,
  add column if not exists extrait jsonb,
  add column if not exists cree_le timestamptz not null default now();

create unique index if not exists veille_observations_pkey
  on public.veille_observations (id);

create unique index if not exists veille_observations_dedup
  on public.veille_observations (canal, message_id, signal_source, signal_source_id);

alter table public.veille_observations enable row level security;

drop policy if exists "agence lecture" on public.veille_observations;

create policy "agence lecture"
  on public.veille_observations
  for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

revoke all on table public.veille_observations from anon, authenticated;
grant select on table public.veille_observations to authenticated;
grant select, insert, update, delete on table public.veille_observations to service_role;

create table if not exists public.veille_etat (
  cle      text primary key,
  valeur   text,
  maj_le   timestamptz not null default now()
);

alter table public.veille_etat
  add column if not exists cle text,
  add column if not exists valeur text,
  add column if not exists maj_le timestamptz not null default now();

create unique index if not exists veille_etat_pkey
  on public.veille_etat (cle);

alter table public.veille_etat enable row level security;

-- Aucune policy : table technique réservée au service.
revoke all on table public.veille_etat from anon, authenticated;
grant select, insert, update, delete on table public.veille_etat to service_role;

-- ---------------------------------------------------------------------------
-- File d'enrichissement, pages, provenance et DCE
-- ---------------------------------------------------------------------------

create table if not exists public.veille_jobs (
  id                 uuid primary key default gen_random_uuid(),
  signal_source      text,
  signal_source_id   text,
  source             text not null,
  kind               text not null
                       check (kind = any (
                         array['resolve_link', 'fetch_detail', 'fetch_dce', 'check_updates']
                       )),
  url                text,
  status             text not null default 'queued'
                       check (status = any (
                         array[
                           'queued',
                           'fetching',
                           'needs_browser',
                           'needs_login',
                           'blocked',
                           'complete',
                           'failed'
                         ]
                       )),
  attempts           integer not null default 0,
  max_attempts       integer not null default 3,
  next_attempt_at    timestamptz not null default now(),
  error_code         text,
  error_detail       text,
  parser_version     text,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz not null default now()
);

alter table public.veille_jobs
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists signal_source text,
  add column if not exists signal_source_id text,
  add column if not exists source text,
  add column if not exists kind text,
  add column if not exists url text,
  add column if not exists status text not null default 'queued',
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists error_code text,
  add column if not exists error_detail text,
  add column if not exists parser_version text,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists veille_jobs_pkey
  on public.veille_jobs (id);

create index if not exists veille_jobs_file
  on public.veille_jobs (status, next_attempt_at);

create unique index if not exists veille_jobs_dedup
  on public.veille_jobs (kind, signal_source, signal_source_id)
  where status = any (array['queued', 'fetching']);

alter table public.veille_jobs enable row level security;

drop policy if exists "agence lecture" on public.veille_jobs;
drop policy if exists "agence insertion" on public.veille_jobs;
drop policy if exists "agence relance" on public.veille_jobs;

create policy "agence lecture"
  on public.veille_jobs
  for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

create policy "agence insertion"
  on public.veille_jobs
  for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

create policy "agence relance"
  on public.veille_jobs
  for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  )
  with check (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

revoke all on table public.veille_jobs from anon, authenticated;
grant select, insert, update on table public.veille_jobs to authenticated;
grant select, insert, update, delete on table public.veille_jobs to service_role;

-- Claim atomique : les runs concurrents ne prennent jamais le même job.
-- service_role possède déjà les droits nécessaires ; SECURITY INVOKER évite
-- d'introduire un contournement RLS inutile.
create or replace function public.reclamer_veille_jobs(nb integer)
returns setof public.veille_jobs
language sql
volatile
security invoker
set search_path = ''
as $$
  with baux_expires as (
    update public.veille_jobs as ancien
       set status = 'queued',
           started_at = null,
           next_attempt_at = now(),
           error_code = 'bail_expire',
           error_detail = 'Traitement interrompu avant sa finalisation ; job automatiquement remis en file.'
     where ancien.status = 'fetching'
       and ancien.started_at < now() - interval '3 minutes'
    returning ancien.id
  )
  update public.veille_jobs as j
     set status = 'fetching',
         attempts = j.attempts + 1,
         started_at = now()
   where j.id in (
     select q.id
       from public.veille_jobs as q
      where q.status = 'queued'
        and q.next_attempt_at <= now()
      order by q.created_at
      limit greatest(nb, 0)
      for update skip locked
   )
  returning j.*;
$$;

revoke all on function public.reclamer_veille_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.reclamer_veille_jobs(integer)
  to service_role;

create table if not exists public.veille_pages (
  id                   bigint generated always as identity primary key,
  job_id               uuid references public.veille_jobs (id) on delete set null,
  canonical_url        text not null,
  http_status          integer,
  content_type         text,
  content_hash         text,
  raw_storage_path     text,
  fetched_at           timestamptz not null default now(),
  parser_version       text,
  parse_completeness   numeric,
  parse_status         text
);

alter table public.veille_pages
  add column if not exists id bigint generated always as identity,
  add column if not exists job_id uuid references public.veille_jobs (id) on delete set null,
  add column if not exists canonical_url text,
  add column if not exists http_status integer,
  add column if not exists content_type text,
  add column if not exists content_hash text,
  add column if not exists raw_storage_path text,
  add column if not exists fetched_at timestamptz not null default now(),
  add column if not exists parser_version text,
  add column if not exists parse_completeness numeric,
  add column if not exists parse_status text;

create unique index if not exists veille_pages_pkey
  on public.veille_pages (id);

create index if not exists veille_pages_url
  on public.veille_pages (canonical_url, fetched_at desc);

alter table public.veille_pages enable row level security;

drop policy if exists "agence lecture" on public.veille_pages;

create policy "agence lecture"
  on public.veille_pages
  for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

revoke all on table public.veille_pages from anon, authenticated;
grant select on table public.veille_pages to authenticated;
grant select, insert, update, delete on table public.veille_pages to service_role;

create table if not exists public.veille_field_evidence (
  id                    bigint generated always as identity primary key,
  signal_source         text not null,
  signal_source_id      text not null,
  field_name            text not null,
  value                 text,
  source_connector_id   text,
  raw_signal_id         text,
  page_url              text,
  document_id           text,
  page_or_section       text,
  evidence_excerpt      text,
  confidence            numeric,
  validation_status     text not null default 'automatique'
                          check (validation_status = any (
                            array['automatique', 'validee', 'a_verifier']
                          )),
  observed_at           timestamptz not null default now()
);

alter table public.veille_field_evidence
  add column if not exists id bigint generated always as identity,
  add column if not exists signal_source text,
  add column if not exists signal_source_id text,
  add column if not exists field_name text,
  add column if not exists value text,
  add column if not exists source_connector_id text,
  add column if not exists raw_signal_id text,
  add column if not exists page_url text,
  add column if not exists document_id text,
  add column if not exists page_or_section text,
  add column if not exists evidence_excerpt text,
  add column if not exists confidence numeric,
  add column if not exists validation_status text not null default 'automatique',
  add column if not exists observed_at timestamptz not null default now();

create unique index if not exists veille_field_evidence_pkey
  on public.veille_field_evidence (id);

create index if not exists veille_evidence_signal
  on public.veille_field_evidence (signal_source, signal_source_id, field_name);

alter table public.veille_field_evidence enable row level security;

drop policy if exists "agence lecture" on public.veille_field_evidence;
drop policy if exists "agence validation" on public.veille_field_evidence;

create policy "agence lecture"
  on public.veille_field_evidence
  for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

create policy "agence validation"
  on public.veille_field_evidence
  for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  )
  with check (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

revoke all on table public.veille_field_evidence from anon, authenticated;
grant select, update on table public.veille_field_evidence to authenticated;
grant select, insert, update, delete on table public.veille_field_evidence to service_role;

create table if not exists public.veille_documents (
  id                     bigint generated always as identity primary key,
  signal_source          text not null,
  signal_source_id       text not null,
  source_url             text,
  download_url           text,
  file_name              text,
  mime_type              text,
  content_hash           text,
  version                integer not null default 1,
  access_mode            text
                           check (access_mode = any (
                             array['public', 'form', 'login', 'unknown']
                           )),
  registry_document_id   text,
  storage_path           text,
  fetched_at             timestamptz,
  last_checked_at        timestamptz
);

alter table public.veille_documents
  add column if not exists id bigint generated always as identity,
  add column if not exists signal_source text,
  add column if not exists signal_source_id text,
  add column if not exists source_url text,
  add column if not exists download_url text,
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists content_hash text,
  add column if not exists version integer not null default 1,
  add column if not exists access_mode text,
  add column if not exists registry_document_id text,
  add column if not exists storage_path text,
  add column if not exists fetched_at timestamptz,
  add column if not exists last_checked_at timestamptz;

create unique index if not exists veille_documents_pkey
  on public.veille_documents (id);

create unique index if not exists veille_documents_version_unq
  on public.veille_documents (signal_source, signal_source_id, version);

create index if not exists veille_documents_signal
  on public.veille_documents (signal_source, signal_source_id, version desc);

alter table public.veille_documents enable row level security;

drop policy if exists "agence lecture" on public.veille_documents;

create policy "agence lecture"
  on public.veille_documents
  for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

revoke all on table public.veille_documents from anon, authenticated;
grant select on table public.veille_documents to authenticated;
grant select, insert, update, delete on table public.veille_documents to service_role;

-- Les noms de séquences d'identité peuvent différer sur un schéma historique.
-- pg_get_serial_sequence évite de supposer leur nom et ignore les colonnes
-- qui n'utilisent pas de séquence.
do $$
declare
  sequence_cible text;
begin
  for sequence_cible in
    select pg_get_serial_sequence(cible.table_name, 'id')
      from (
        values
          ('public.veille_observations'),
          ('public.veille_pages'),
          ('public.veille_field_evidence'),
          ('public.veille_documents')
      ) as cible(table_name)
  loop
    if sequence_cible is not null then
      execute format('revoke all on sequence %s from anon, authenticated', sequence_cible);
      execute format('grant usage, select on sequence %s to service_role', sequence_cible);
    end if;
  end loop;
end
$$;

insert into storage.buckets (id, name, public)
values ('veille', 'veille', false)
on conflict (id) do update
  set name = excluded.name,
      public = false;
