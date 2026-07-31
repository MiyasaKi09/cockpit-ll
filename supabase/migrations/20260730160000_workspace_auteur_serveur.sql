-- Livrable 0.5 — l'auteur d'une écriture du document partagé est établi par le
-- serveur, plus par le client.
--
-- Jusqu'ici `workspace.updated_by` recevait `p_updated_by`, c'est-à-dire
-- `MON_ID` (src/sync.ts) : un UUID tiré au chargement de la page, régénéré à
-- chaque onglet et à chaque profil de navigateur. Le journal d'audit du §14.4
-- et le critère 13 demandent QUI a écrit ; un paramètre venu du client ne le
-- prouve pas, il l'annonce.
--
-- `public.enregistrer_workspace` est le seul chemin d'écriture de la table
-- depuis la migration 20260729170200, qui a retiré `insert` et `update` à
-- `authenticated` : estampiller ici couvre donc toutes les écritures.
--
-- Ce que cette migration NE change PAS :
--   * la signature de la RPC — cinq paramètres, mêmes noms, mêmes types, même
--     ordre : le front déjà déployé continue de l'appeler sans modification ;
--   * le contrôle du compte connecté et le verrou optimiste de révision, repris
--     mot pour mot ;
--   * l'usage légitime de `MON_ID` côté client — reconnaître ses propres échos
--     Realtime. Ce n'est pas une identité, et il déménage donc dans une colonne
--     qui porte son nom : `updated_by_client`.
--
-- Ordre d'application sur un projet EN SERVICE : déployer d'abord le front qui
-- lit `updated_by_client`, puis appliquer cette migration. Ce front reconnaît
-- ses échos par l'une OU l'autre colonne, donc de part et d'autre de la
-- bascule ; un poste resté sur la version précédente perd seulement son filtre
-- anti-écho pendant la fenêtre — le verrou de révision continue de le protéger.

-- Reprise unique des valeurs déjà en base : ce sont des identifiants d'onglet,
-- on les déplace dans la colonne qui dit la vérité plutôt que de les laisser
-- passer pour des auteurs. Rien n'est perdu ; conditionner au premier ajout de
-- la colonne rend le déplacement rejouable sans jamais dégrader un auteur
-- légitime écrit ensuite par le serveur.
do $$
begin
  if not exists (
    select 1
      from pg_attribute
     where attrelid = 'public.workspace'::regclass
       and attname = 'updated_by_client'
       and not attisdropped
  ) then
    alter table public.workspace add column updated_by_client text;

    update public.workspace
       set updated_by_client = updated_by,
           updated_by = null;
  end if;
end $$;

comment on column public.workspace.updated_by is
  'Auteur de la dernière écriture, établi par le serveur : auth.uid(), à défaut l''adresse du JWT. Jamais renseigné par le client.';

comment on column public.workspace.updated_by_client is
  'Instance de page à l''origine de la dernière écriture, telle qu''annoncée par le client. Sert au filtre anti-écho Realtime ; ne prouve aucune identité.';

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
  -- L'identité est lue dans le jeton vérifié par PostgREST, jamais dans les
  -- paramètres. `auth.uid()` est l'identifiant de compte stable attendu par le
  -- journal d'audit ; l'adresse ne sert que de repli lisible si un jeton
  -- valide venait à ne pas porter de `sub`. Le contrôle ci-dessous garantit
  -- qu'au moins l'une des deux existe.
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
