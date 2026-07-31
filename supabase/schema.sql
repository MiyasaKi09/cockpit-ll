-- ============================================================
-- Cockpit L&L — schéma de synchronisation Supabase
-- À exécuter dans SQL Editor. Idempotent et ré-exécutable.
--
-- Le document partagé reste protégé par RLS. Chaque écriture passe
-- par enregistrer_workspace(), qui compare une révision : un poste
-- en retard ne peut plus écraser silencieusement l'autre.
--
-- `updated_by` dit QUI a écrit : la fonction l'estampille elle-même
-- depuis auth.uid(). `updated_by_client` dit depuis QUEL onglet, sur
-- la foi du client : cela suffit à filtrer ses propres échos Realtime
-- et ne prouve rien d'autre. Sur un projet déjà en service, c'est la
-- migration 20260730160000 qui fait la bascule et déplace les valeurs
-- historiques (des identifiants d'onglet) vers la seconde colonne.
--
-- QUI A LE DROIT — plus aucune adresse n'est écrite ici. Le registre
-- `public.membres` fait autorité (migration 20260730180000) : les
-- politiques appellent `est_membre_actif()` et `role_courant()`. Sur
-- un projet neuf, ce script amorce le registre avec les comptes qui
-- existent déjà dans `auth.users` — créez donc d'abord les comptes,
-- puis (ré)exécutez ce script : il est fait pour être rejoué.
-- ============================================================

-- ------------------------------------------------------------
-- Registre des membres — compte ↔ personne ↔ rôle ↔ actif
-- ------------------------------------------------------------

create table if not exists public.membres (
  email       text primary key,
  compte_id   uuid unique references auth.users (id) on delete set null,
  personne    text,
  role        text not null default 'collaborateur',
  actif       boolean not null default true,
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now(),
  notes       text
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.membres'::regclass and conname = 'membres_email_normalise'
  ) then
    alter table public.membres add constraint membres_email_normalise
      check (
        email = lower(email)
        and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.membres'::regclass and conname = 'membres_role_connu'
  ) then
    alter table public.membres add constraint membres_role_connu
      check (role in (
        'administrateur_agence',
        'direction',
        'chef_de_projet',
        'collaborateur',
        'assistant_administratif',
        'comptabilite',
        'intervenant_externe',
        'lecture_seule'
      ));
  end if;
end $$;

create or replace function public.membres_touche_maj_le()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.maj_le := now();
  return new;
end;
$$;

drop trigger if exists membres_maj_le on public.membres;
create trigger membres_maj_le
  before update on public.membres
  for each row execute function public.membres_touche_maj_le();

-- Amorce d'un projet neuf : les comptes déjà créés dans Auth entrent au
-- registre en administrateurs. Aucune adresse n'est écrite ici, elles sont
-- lues. Si aucun compte n'existe encore, le script le dit et ne crée rien —
-- rejouez-le après avoir envoyé les liens magiques.
insert into public.membres (email, personne, role, actif, notes)
select lower(u.email), null, 'administrateur_agence', true,
       'Amorcé depuis auth.users par schema.sql.'
  from auth.users u
 where u.email is not null
   and not exists (select 1 from public.membres)
on conflict (email) do nothing;

update public.membres m
   set compte_id = u.id
  from auth.users u
 where m.compte_id is null
   and lower(u.email) = m.email
   and not exists (select 1 from public.membres autre where autre.compte_id = u.id);

-- ------------------------------------------------------------
-- Les deux fonctions d'autorisation
--
-- `security definer` : elles lisent le registre pour le compte de
-- l'appelant, qui n'y a pas accès en écriture. `set search_path = ''`
-- interdit qu'un schéma placé devant `public` détourne la lecture.
-- Pas de récursion malgré la RLS sur `public.membres` : elles
-- s'exécutent avec les droits du propriétaire de la table, qui n'est
-- pas soumis à ses propres politiques — d'où l'absence délibérée de
-- `force row level security`.
-- ------------------------------------------------------------

create or replace function public.est_membre_actif()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.membres m
     where m.actif
       and (
         (m.compte_id is not null and m.compte_id = auth.uid())
         or m.email = lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''))
       )
  );
$$;

create or replace function public.role_courant()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
    from public.membres m
   where m.actif
     and (
       (m.compte_id is not null and m.compte_id = auth.uid())
       or m.email = lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''))
     )
   order by (m.compte_id is not null and m.compte_id = auth.uid()) desc, m.email
   limit 1;
$$;

revoke all on function public.est_membre_actif() from public, anon;
revoke all on function public.role_courant()    from public, anon;
grant execute on function public.est_membre_actif() to authenticated, service_role;
grant execute on function public.role_courant()    to authenticated, service_role;

alter table public.membres enable row level security;

drop policy if exists "agence lecture" on public.membres;

create policy "agence lecture"
  on public.membres
  for select
  to authenticated
  using ((select public.est_membre_actif()));

revoke all on table public.membres from anon, authenticated;
grant select on table public.membres to authenticated;
grant select, insert, update, delete on table public.membres to service_role;

-- ------------------------------------------------------------
-- Document partagé
-- ------------------------------------------------------------

create table if not exists public.workspace (
  id                 text primary key,
  data               jsonb not null,
  version            integer,
  updated_at         timestamptz not null default now(),
  updated_by         text,
  updated_by_client  text,
  revision           bigint not null default 0
);

alter table public.workspace
  add column if not exists revision bigint not null default 0;

alter table public.workspace
  add column if not exists updated_by_client text;

alter table public.workspace enable row level security;

drop policy if exists "agence lecture"     on public.workspace;
drop policy if exists "agence insertion"   on public.workspace;
drop policy if exists "agence mise a jour" on public.workspace;

create policy "agence lecture" on public.workspace
  for select to authenticated
  using ((select public.est_membre_actif()));

-- Les privilèges SQL et les politiques RLS sont deux verrous distincts.
revoke all on table public.workspace from anon;
revoke all on table public.workspace from authenticated;
grant select on table public.workspace to authenticated;

create or replace function public.enregistrer_workspace(
  p_id text,
  p_data jsonb,
  p_version integer,
  p_updated_by text,
  p_expected_revision bigint
)
returns table(revision bigint, updated_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- L'identité est lue dans le jeton vérifié, jamais dans les paramètres :
  -- `p_updated_by` n'est qu'une annonce du navigateur, conservée à part.
  v_auteur text;
begin
  -- Le registre fait autorité. Un membre en lecture seule lit le document
  -- partagé par la politique RLS, mais ne l'écrit pas.
  if not public.est_membre_actif()
     or public.role_courant() is not distinct from 'lecture_seule' then
    raise exception 'Compte non autorisé.'
      using errcode = '42501';
  end if;

  v_auteur := coalesce(auth.uid()::text, auth.jwt() ->> 'email');

  if p_expected_revision < 0 then
    return query
      insert into public.workspace as w
        (id, data, version, updated_at, updated_by, updated_by_client, revision)
      values (p_id, p_data, p_version, now(), v_auteur, nullif(p_updated_by, ''), 0)
      on conflict (id) do nothing
      returning w.revision, w.updated_at;
    return;
  end if;

  return query
    update public.workspace as w
       set data = p_data,
           version = p_version,
           updated_at = now(),
           updated_by = v_auteur,
           updated_by_client = nullif(p_updated_by, ''),
           revision = w.revision + 1
     where w.id = p_id
       and w.revision = p_expected_revision
    returning w.revision, w.updated_at;
end;
$$;

revoke all on function public.enregistrer_workspace(text, jsonb, integer, text, bigint)
  from public, anon;
grant execute on function public.enregistrer_workspace(text, jsonb, integer, text, bigint)
  to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.workspace;
exception
  when duplicate_object then null;
end $$;

-- Dernier mot du script : dire si quelqu'un peut encore entrer. Sur un
-- projet neuf sans compte, ce n'est pas une erreur — c'est une étape
-- restante, et le script est rejouable.
do $$
declare
  v_actifs integer;
begin
  select count(*) filter (where actif) into v_actifs from public.membres;
  if v_actifs = 0 then
    raise warning 'Registre des membres vide : personne ne peut se connecter. Créez les comptes dans Auth, puis réexécutez ce script.';
  else
    raise notice 'Registre des membres : % membre(s) actif(s).', v_actifs;
  end if;
end $$;
