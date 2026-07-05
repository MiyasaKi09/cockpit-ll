-- ============================================================
-- Cockpit L&L — schéma de synchronisation (Supabase, offre gratuite)
-- À coller dans « SQL Editor » → Run. Idempotent (ré-exécutable).
--
-- Un seul document JSON = tout l'état de l'agence, partagé par les
-- 2 postes en temps réel. Accès verrouillé aux 2 adresses via RLS :
-- la clé « anon / publishable » peut donc être collée côté client
-- sans risque (elle ne donne accès à rien sans une session autorisée).
-- ============================================================

-- 1) Table de l'espace partagé
create table if not exists public.workspace (
  id          text primary key,           -- identifiant d'espace (ex. 'agence-ll')
  data        jsonb not null,             -- l'AppState complet
  version     int,                        -- STATE_VERSION au moment de l'écriture
  updated_at  timestamptz not null default now(),
  updated_by  text                        -- id du poste émetteur (anti-écho)
);

-- 2) Row Level Security : accès réservé aux 2 e-mails de l'agence
alter table public.workspace enable row level security;

drop policy if exists "agence lecture"     on public.workspace;
drop policy if exists "agence insertion"   on public.workspace;
drop policy if exists "agence mise a jour" on public.workspace;

create policy "agence lecture" on public.workspace
  for select to authenticated
  using ( (auth.jwt() ->> 'email') in ('julenglet@gmail.com','zoefhebert@gmail.com') );

create policy "agence insertion" on public.workspace
  for insert to authenticated
  with check ( (auth.jwt() ->> 'email') in ('julenglet@gmail.com','zoefhebert@gmail.com') );

create policy "agence mise a jour" on public.workspace
  for update to authenticated
  using      ( (auth.jwt() ->> 'email') in ('julenglet@gmail.com','zoefhebert@gmail.com') )
  with check ( (auth.jwt() ->> 'email') in ('julenglet@gmail.com','zoefhebert@gmail.com') );

-- 3) Temps réel : diffuser les changements de la table
do $$
begin
  alter publication supabase_realtime add table public.workspace;
exception
  when duplicate_object then null;  -- déjà ajoutée : on ignore
end $$;
