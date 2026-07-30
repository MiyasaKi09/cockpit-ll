-- Révocation finale des anciennes écritures directes sur public.workspace.
--
-- Inverse exact de `workspace-ecritures-directes-ouvrir.sql`. À appliquer dès
-- que le front de production passe par `public.enregistrer_workspace`.
--
-- Après ce script, la base est revenue à l'état déclaré par la migration
-- 20260729170200 : `authenticated` ne peut que lire, et toute écriture passe
-- par la RPC, donc par le contrôle du compte et le verrou de révision.

-- Garde-fou : refuser de fermer l'ancien chemin si le nouveau n'existe pas
-- encore, sans quoi l'espace partagé deviendrait lisible mais non modifiable.
do $$
begin
  if not exists (
    select 1
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'enregistrer_workspace'
  ) then
    raise exception
      'public.enregistrer_workspace est absente : appliquez les migrations avant de révoquer les écritures directes.'
      using errcode = '42883';
  end if;
end
$$;

drop policy if exists "agence insertion"   on public.workspace;
drop policy if exists "agence mise a jour" on public.workspace;

revoke insert, update, delete on table public.workspace from anon;
revoke insert, update, delete on table public.workspace from authenticated;

-- La lecture reste nécessaire au front : il lit la révision courante avant
-- chaque envoi.
grant select on table public.workspace to authenticated;

-- Contrôle final : plus aucun privilège d'écriture pour les rôles du
-- navigateur, et plus aucune policy d'écriture sur la table.
do $$
declare
  ecritures integer;
  policies  integer;
begin
  select count(*) into ecritures
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name = 'workspace'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

  select count(*) into policies
    from pg_policies
   where schemaname = 'public'
     and tablename = 'workspace'
     and cmd <> 'SELECT';

  if ecritures <> 0 or policies <> 0 then
    raise exception
      'Révocation incomplète : % privilège(s) d''écriture et % policy(s) d''écriture subsistent.',
      ecritures, policies;
  end if;
end
$$;
