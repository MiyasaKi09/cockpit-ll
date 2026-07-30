-- Ajoute le verrou optimiste et explicite les privilèges de la table partagée.
create table if not exists public.workspace (
  id          text primary key,
  data        jsonb not null,
  version     integer,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  revision    bigint not null default 0
);

alter table public.workspace
  add column if not exists revision bigint not null default 0;

alter table public.workspace enable row level security;

drop policy if exists "agence lecture"     on public.workspace;
drop policy if exists "agence insertion"   on public.workspace;
drop policy if exists "agence mise a jour" on public.workspace;

create policy "agence lecture" on public.workspace
  for select to authenticated
  using ((auth.jwt() ->> 'email') in ('julenglet@gmail.com', 'zoefhebert@gmail.com'));

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
begin
  if coalesce(auth.jwt() ->> 'email', '') not in ('julenglet@gmail.com', 'zoefhebert@gmail.com') then
    raise exception 'Compte non autorisé.'
      using errcode = '42501';
  end if;

  if p_expected_revision < 0 then
    return query
      insert into public.workspace as w (id, data, version, updated_at, updated_by, revision)
      values (p_id, p_data, p_version, now(), p_updated_by, 0)
      on conflict (id) do nothing
      returning w.revision, w.updated_at;
    return;
  end if;

  return query
    update public.workspace as w
       set data = p_data,
           version = p_version,
           updated_at = now(),
           updated_by = p_updated_by,
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
