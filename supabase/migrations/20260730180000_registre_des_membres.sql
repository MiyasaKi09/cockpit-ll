-- Livrable 0.2 — Registre des membres, et fin des adresses de connexion en dur.
--
-- POURQUOI
-- --------
-- Les deux adresses de connexion de l'agence étaient recopiées littéralement
-- dans chaque politique RLS et dans chaque fonction serveur. Le jour où une
-- adresse change — c'est précisément l'objet du livrable 3.2, bascule vers le
-- domaine agence-ll.fr — il faut retrouver et corriger ces occurrences une par
-- une, dans le même geste. En rater une, c'est perdre l'accès à la table
-- concernée ; les rater toutes, c'est verrouiller l'agence hors de son propre
-- outil. Un droit d'accès n'a pas à être un littéral dupliqué : il a une
-- table.
--
-- Cette migration crée donc `public.membres` (compte ↔ personne ↔ rôle ↔
-- actif) et deux fonctions `security definer` — `est_membre_actif()` et
-- `role_courant()` — puis réécrit les quatorze politiques existantes et la RPC
-- d'écriture pour les appeler. Après elle, changer les droits d'accès est un
-- `update` d'une ligne, pas une migration.
--
-- CE QUI GARANTIT QU'ELLE NE VERROUILLE PERSONNE
-- ----------------------------------------------
-- L'amorce du registre et la réécriture des politiques sont dans CE fichier,
-- donc dans la même transaction : il n'existe aucun instant où une politique
-- interroge un registre qui n'aurait pas encore ses membres. Et le contrôle
-- final, en fin de fichier, lève une exception si le registre est vide ou sans
-- membre actif — l'exception annule la transaction, donc annule aussi la
-- réécriture des politiques. Le scénario « liste littérale remplacée par une
-- table vide » n'est pas rattrapable après coup : il est rendu impossible.
--
-- CE QU'ELLE NE CHANGE PAS
-- ------------------------
--   * la signature de `enregistrer_workspace` — cinq paramètres, mêmes noms,
--     mêmes types, même ordre : le front déjà déployé continue de l'appeler ;
--   * le message d'erreur « Compte non autorisé. », que le front reconnaît ;
--   * les noms des politiques, table par table : un audit `pg_policies`
--     antérieur reste comparable ligne à ligne ;
--   * le comportement effectif pour les deux comptes en service, qui sont
--     amorcés ici et restent autorisés sans interruption.
--
-- ORDRE D'APPLICATION SUR UN PROJET EN SERVICE
-- --------------------------------------------
-- 1. appliquer CETTE migration ;
-- 2. seulement ensuite, redéployer les Edge Functions : leur nouvelle source
--    interroge `public.membres` et refuse tout le monde tant que la table
--    n'existe pas (refuser, jamais autoriser). L'inverse coupe l'ingestion.
-- Les Edge Functions actuellement déployées, elles, continuent de fonctionner
-- pendant l'intervalle : elles passent par `service_role`, que la RLS
-- n'atteint pas.
--
-- PÉRIMÈTRE POUR `scripts/test-adresses-en-dur.cjs` (livrable 0.14)
-- ----------------------------------------------------------------
-- Le bloc « AMORCE DU REGISTRE » ci-dessous est le SEUL endroit du dépôt où
-- une adresse de connexion réelle est écrite en clair, et c'est sa place : le
-- registre est le point unique où une identité entre dans le système.
--
-- Les migrations dont l'horodatage est antérieur à 20260730180000 sont hors
-- périmètre, pour deux raisons cumulatives : une migration déjà appliquée est
-- immuable par construction — la réécrire ne change rien en base et fausse la
-- reproductibilité d'un projet neuf ; et toute règle d'accès qu'elles posent
-- est de toute façon remplacée par celle-ci, qui s'applique après elles. Le
-- même raisonnement vaut pour `supabase/operations/`, dont les scripts ont
-- été joués en production : ils décrivent un état passé.
--
-- Partout ailleurs — code source, Edge Functions, `schema.sql`, interface —
-- une adresse de connexion réelle est un défaut.

-- ---------------------------------------------------------------------------
-- Le registre
-- ---------------------------------------------------------------------------

create table if not exists public.membres (
  -- L'adresse est la clé : c'est elle que porte le JWT, c'est elle que le
  -- Cockpit connaît (`Personne.email`, livrable 0.3), et c'est elle qui
  -- survit à un renommage de la personne dans les Paramètres.
  email       text primary key,
  -- Renseigné dès que le compte Supabase existe. Sert de correspondance
  -- stable si l'adresse change : à la bascule 3.2, on met à jour `email`
  -- sans perdre le lien avec le compte.
  compte_id   uuid unique references auth.users (id) on delete set null,
  -- Le nom tel qu'il figure dans `settings.personnes` du document partagé.
  -- Indicatif : il rend les requêtes SQL lisibles. L'autorité du lien
  -- application ↔ registre reste l'adresse.
  personne    text,
  role        text not null default 'collaborateur',
  actif       boolean not null default true,
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now(),
  notes       text
);

-- Rejouable sur une base où une ébauche de la table existerait déjà.
alter table public.membres
  add column if not exists compte_id uuid,
  add column if not exists personne  text,
  add column if not exists role      text not null default 'collaborateur',
  add column if not exists actif     boolean not null default true,
  add column if not exists cree_le   timestamptz not null default now(),
  add column if not exists maj_le    timestamptz not null default now(),
  add column if not exists notes     text;

-- Une adresse stockée en majuscules ou avec des espaces ne serait jamais
-- retrouvée par les fonctions ci-dessous : deux postes croiraient décrire la
-- même personne et décriraient deux registres. Aucun domaine n'est présumé :
-- `prenom@agence-ll.fr`, `2026-034@agence-ll.fr` et les adresses actuelles
-- passent toutes.
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

  -- Les huit rôles du §14.1 du cahier des charges, ni plus ni moins : une
  -- faute de frappe dans un rôle ne doit pas produire un droit silencieux.
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

comment on table public.membres is
  'Registre des comptes autorisés : compte ↔ personne ↔ rôle ↔ actif. Seule autorité de contrôle d''accès du Cockpit ; les politiques RLS et les Edge Functions l''interrogent au lieu de comparer à des adresses littérales.';
comment on column public.membres.email is
  'Adresse de connexion, en minuscules. Clé du registre ; correspond à Personne.email dans le document partagé. Aucun domaine n''est présumé.';
comment on column public.membres.compte_id is
  'Identifiant du compte auth.users, renseigné dès la première connexion. Permet de changer l''adresse sans perdre le lien avec le compte.';
comment on column public.membres.personne is
  'Nom de la personne tel qu''il figure dans settings.personnes. Indicatif : il rend les requêtes lisibles. Un renommage dans les Paramètres ne le réécrit pas — l''autorité du lien est l''adresse.';
comment on column public.membres.role is
  'Rôle au sens du §14.1 du CDC. Aujourd''hui seul « lecture_seule » a un effet : il retire les droits d''écriture.';
comment on column public.membres.actif is
  'Faux retire tous les droits sans effacer l''historique. Désactiver plutôt que supprimer.';

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

-- ---------------------------------------------------------------------------
-- AMORCE DU REGISTRE  >>>  seul endroit du dépôt où une adresse de connexion
-- réelle est écrite en clair (voir l'en-tête, périmètre du test 0.14). Les
-- deux repères ci-dessous délimitent ce bloc pour un test automatique : ne
-- pas les déplacer, ne rien écrire d'autre entre eux.
--
-- L'amorce n'a lieu que si le registre est vide. Rejouer cette migration sur
-- une base dont le registre a été tenu à jour — un membre désactivé, une
-- adresse basculée sur le domaine de l'agence — n'y ressuscite donc rien.
-- [AMORCE-REGISTRE:DEBUT]
-- ---------------------------------------------------------------------------
insert into public.membres (email, personne, role, actif, notes)
select v.email, v.personne, v.role, true, v.notes
  from (values
    ('julenglet@gmail.com', 'Julien', 'administrateur_agence',
     'Amorce du registre, livrable 0.2. Bascule vers le domaine de l''agence : livrable 3.2.'),
    ('zoefhebert@gmail.com', 'Zoé',   'administrateur_agence',
     'Amorce du registre, livrable 0.2. Bascule vers le domaine de l''agence : livrable 3.2.')
  ) as v(email, personne, role, notes)
 where not exists (select 1 from public.membres)
on conflict (email) do nothing;
-- ---------------------------------------------------------------------------
-- <<<  FIN DE L'AMORCE
-- [AMORCE-REGISTRE:FIN]
-- ---------------------------------------------------------------------------

-- Rattachement au compte Supabase quand il existe déjà. Sans effet sur un
-- projet neuf ; sur le projet en service, il remplit `compte_id` pour les deux
-- comptes et rend la bascule d'adresse (3.2) sans risque.
update public.membres m
   set compte_id = u.id
  from auth.users u
 where m.compte_id is null
   and lower(u.email) = m.email
   and not exists (select 1 from public.membres autre where autre.compte_id = u.id);

-- ---------------------------------------------------------------------------
-- Les deux fonctions d'autorisation
--
-- `security definer` : elles lisent le registre pour le compte de l'appelant,
-- qui n'a pas besoin d'y accéder lui-même. `set search_path = ''` interdit
-- qu'un schéma placé devant `public` détourne la lecture.
--
-- Elles sont `stable` : PostgreSQL peut alors n'évaluer qu'une fois par
-- requête l'appel encapsulé `(select public.est_membre_actif())` employé dans
-- les politiques, au lieu d'une fois par ligne.
--
-- Elles interrogent `public.membres`, table sur laquelle la RLS est active.
-- Il n'y a pas de récursion : elles s'exécutent avec les droits de leur
-- propriétaire, qui est aussi propriétaire de la table, et un propriétaire
-- n'est pas soumis à ses propres politiques. C'est pourquoi `force row level
-- security` n'est délibérément PAS activé sur `public.membres`.
-- ---------------------------------------------------------------------------

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

comment on function public.est_membre_actif() is
  'Vrai si la session en cours appartient à un membre actif du registre. Reconnaît le compte par son identifiant, à défaut par l''adresse du jeton. Sans session, faux.';

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

comment on function public.role_courant() is
  'Rôle du membre actif correspondant à la session, ou NULL. Le rattachement par identifiant de compte prime sur le rattachement par adresse.';

revoke all on function public.est_membre_actif() from public, anon;
revoke all on function public.role_courant()    from public, anon;
grant execute on function public.est_membre_actif() to authenticated, service_role;
grant execute on function public.role_courant()    to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Accès au registre lui-même
--
-- Lecture pour les membres : le Cockpit doit pouvoir dire qui est autorisé.
-- Aucune écriture depuis le navigateur : ajouter, désactiver ou changer un
-- rôle reste un geste d'administration, tracé côté serveur (journal d'audit,
-- livrable A.13). Un compte compromis ne s'ajoute pas lui-même au registre.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Réécriture des politiques existantes
--
-- Mêmes noms, mêmes tables, mêmes commandes qu'avant : seule l'expression
-- change. Les politiques de lecture demandent un membre actif ; les
-- politiques d'écriture demandent en plus que son rôle ne soit pas
-- « lecture_seule ».
-- ---------------------------------------------------------------------------

-- Préalable : toutes les tables concernées doivent exister, sinon la
-- réécriture serait partielle et une table resterait sur sa politique
-- littérale. On le dit ici, clairement, plutôt que de laisser surgir un
-- « relation does not exist » trente lignes plus bas.
do $$
declare
  v_manquantes text[] := '{}';
  v_table      text;
begin
  foreach v_table in array array[
    'public.workspace', 'public.entrants', 'public.veille_collectes',
    'public.veille_signaux', 'public.veille_observations', 'public.veille_jobs',
    'public.veille_pages', 'public.veille_field_evidence', 'public.veille_documents',
    'storage.objects'
  ] loop
    if to_regclass(v_table) is null then
      v_manquantes := v_manquantes || v_table;
    end if;
  end loop;

  if array_length(v_manquantes, 1) > 0 then
    raise exception
      'Tables absentes : %. Appliquez d''abord les migrations antérieures (20260730085155 crée l''ingestion et la veille) : sinon ces tables resteraient sur leurs politiques littérales.',
      array_to_string(v_manquantes, ', ')
      using errcode = 'P0001';
  end if;
end $$;

-- public.workspace — migration 20260729170200
drop policy if exists "agence lecture" on public.workspace;

create policy "agence lecture"
  on public.workspace
  for select
  to authenticated
  using ((select public.est_membre_actif()));

-- public.entrants — migration 20260730085155
drop policy if exists "agence lecture"     on public.entrants;
drop policy if exists "agence mise a jour" on public.entrants;

create policy "agence lecture"
  on public.entrants
  for select
  to authenticated
  using ((select public.est_membre_actif()));

create policy "agence mise a jour"
  on public.entrants
  for update
  to authenticated
  using (
    (select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule'
  )
  with check (
    (select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule'
  );

-- storage.objects — bucket privé « entrants »
drop policy if exists "agence lit les entrants" on storage.objects;

create policy "agence lit les entrants"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'entrants'
    and (select public.est_membre_actif())
  );

-- public.veille_collectes
drop policy if exists "agence lecture" on public.veille_collectes;

create policy "agence lecture"
  on public.veille_collectes
  for select
  to authenticated
  using ((select public.est_membre_actif()));

-- public.veille_signaux
drop policy if exists "agence lecture" on public.veille_signaux;

create policy "agence lecture"
  on public.veille_signaux
  for select
  to authenticated
  using ((select public.est_membre_actif()));

-- public.veille_observations
drop policy if exists "agence lecture" on public.veille_observations;

create policy "agence lecture"
  on public.veille_observations
  for select
  to authenticated
  using ((select public.est_membre_actif()));

-- public.veille_jobs
drop policy if exists "agence lecture"   on public.veille_jobs;
drop policy if exists "agence insertion" on public.veille_jobs;
drop policy if exists "agence relance"   on public.veille_jobs;

create policy "agence lecture"
  on public.veille_jobs
  for select
  to authenticated
  using ((select public.est_membre_actif()));

create policy "agence insertion"
  on public.veille_jobs
  for insert
  to authenticated
  with check (
    (select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule'
  );

create policy "agence relance"
  on public.veille_jobs
  for update
  to authenticated
  using (
    (select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule'
  )
  with check (
    (select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule'
  );

-- public.veille_pages
drop policy if exists "agence lecture" on public.veille_pages;

create policy "agence lecture"
  on public.veille_pages
  for select
  to authenticated
  using ((select public.est_membre_actif()));

-- public.veille_field_evidence
drop policy if exists "agence lecture"    on public.veille_field_evidence;
drop policy if exists "agence validation" on public.veille_field_evidence;

create policy "agence lecture"
  on public.veille_field_evidence
  for select
  to authenticated
  using ((select public.est_membre_actif()));

create policy "agence validation"
  on public.veille_field_evidence
  for update
  to authenticated
  using (
    (select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule'
  )
  with check (
    (select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule'
  );

-- public.veille_documents
drop policy if exists "agence lecture" on public.veille_documents;

create policy "agence lecture"
  on public.veille_documents
  for select
  to authenticated
  using ((select public.est_membre_actif()));

-- ---------------------------------------------------------------------------
-- Le seul chemin d'écriture du document partagé
--
-- Signature, verrou optimiste de révision et estampille d'auteur repris mot
-- pour mot du livrable 0.5 : seul le contrôle du compte change de source.
-- ---------------------------------------------------------------------------

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
  -- valide venait à ne pas porter de `sub`.
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

-- ---------------------------------------------------------------------------
-- CONTRÔLE FINAL — il ne s'agit pas d'une vérification de confort.
--
-- Toute exception levée ici annule la transaction, donc annule la réécriture
-- des politiques ci-dessus : la base repart avec ses anciennes politiques,
-- littérales mais fonctionnelles. C'est le filet qui rend impossible le
-- scénario « la liste des adresses a été remplacée par un registre vide ».
-- ---------------------------------------------------------------------------
do $$
declare
  v_total     integer;
  v_actifs    integer;
  v_litteral  integer;
begin
  select count(*), count(*) filter (where actif)
    into v_total, v_actifs
    from public.membres;

  if v_total = 0 then
    raise exception
      'Registre des membres vide : les politiques RLS interrogeraient une table sans personne. Transaction annulée, les anciennes politiques sont conservées.'
      using errcode = 'P0001';
  end if;

  if v_actifs = 0 then
    raise exception
      'Registre des membres sans aucun membre actif (% ligne(s) inactive(s)) : personne ne pourrait plus se connecter. Transaction annulée.', v_total
      using errcode = 'P0001';
  end if;

  -- Les deux fonctions doivent exister : sans elles, chaque politique
  -- réécrite ci-dessus échouerait à la première requête du navigateur.
  if to_regprocedure('public.est_membre_actif()') is null
     or to_regprocedure('public.role_courant()') is null then
    raise exception
      'Les fonctions d''autorisation sont absentes alors que les politiques les appellent. Transaction annulée.'
      using errcode = 'P0001';
  end if;

  -- Plus aucune politique de l'agence ne doit contenir d'adresse littérale :
  -- le contrôle est indépendant du domaine, il cherche l'arobase.
  -- Deux filets : toutes les politiques des tables concernées, et toutes les
  -- politiques nommées « agence … » où qu'elles soient. Une politique
  -- ancienne qui aurait survécu à un `drop policy` mal orthographié serait
  -- permissive — elle ÉLARGIRAIT l'accès sans rien signaler. Elle est donc
  -- cherchée ici plutôt que supposée absente.
  select count(*)
    into v_litteral
    from pg_policies
   where (
           (schemaname = 'public'
              and tablename in ('workspace', 'membres', 'entrants',
                                'veille_collectes', 'veille_signaux', 'veille_observations',
                                'veille_jobs', 'veille_pages', 'veille_field_evidence',
                                'veille_documents'))
           or (schemaname in ('public', 'storage') and policyname like 'agence%')
         )
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%@%';

  if v_litteral > 0 then
    raise exception
      '% politique(s) comparent encore à une adresse littérale : le découplage serait incomplet, et une politique oubliée ÉLARGIT l''accès au lieu de le restreindre. Si une bascule de production est en cours, refermez-la d''abord (supabase/operations/workspace-ecritures-directes-revoquer.sql). Transaction annulée.',
      v_litteral
      using errcode = 'P0001';
  end if;

  raise notice 'Registre des membres : % ligne(s), dont % active(s). Politiques réécrites.', v_total, v_actifs;
end $$;
