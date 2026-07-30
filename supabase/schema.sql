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
-- ============================================================

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
  using ((auth.jwt() ->> 'email') in ('julenglet@gmail.com', 'zoefhebert@gmail.com'));

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
  if coalesce(auth.jwt() ->> 'email', '') not in ('julenglet@gmail.com', 'zoefhebert@gmail.com') then
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
