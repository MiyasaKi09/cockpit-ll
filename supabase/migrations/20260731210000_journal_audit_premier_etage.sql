-- Livrable A.13 — Journal d'audit, premier étage.
--
-- POURQUOI
-- --------
-- Le critère 13 du cahier des charges demande que les actions sensibles
-- soient historisées. Elles le sont aujourd'hui de façon exemplaire sur la
-- facture et sur le registre des documents, et nulle part ailleurs. Là où
-- une trace existe, elle porte souvent un identifiant d'onglet en guise
-- d'auteur : cela dit d'où venait l'écriture, jamais qui l'a faite.
--
-- Cette migration pose le premier étage : une table en ajout seul, une RPC
-- qui estampille l'acteur et l'instant côté serveur, et des déclencheurs sur
-- les trois tables relationnelles de la vague A — `communications`,
-- `propositions`, `membres`.
--
-- CE QU'ELLE NE COUVRE PAS, ET POURQUOI C'EST DIT ICI
-- ---------------------------------------------------
-- Un déclencheur ne voit pas une mutation à l'intérieur d'un document JSONB.
-- Tout ce qui vit dans `workspace.data` — projets, factures, pointages
-- actuels — reste donc hors de portée de ce fichier. C'est le sens du
-- découpage : B.16 étend les déclencheurs à `pointages` et `chrono_actif`
-- quand ces tables existent, et branche le chemin déclaratif pour le JSONB.
-- Le critère 13 est « partiel » à la fin du MVP, et le plan le dit.
--
-- LES TROIS DÉCISIONS QUI FONT LA VALEUR DE CE FICHIER
-- ----------------------------------------------------
-- 1. **L'acteur et l'instant ne sont pas des paramètres.** `journaliser()`
--    lit `auth.uid()` et `now()` elle-même. Un appelant qui pourrait écrire
--    « c'est untel, à telle heure » rendrait le journal sans valeur : une
--    trace forgeable ne prouve rien, et coûte la confiance qu'on lui accorde.
--
-- 2. **L'insertion directe est refusée aux comptes applicatifs.** Aucun
--    `grant insert` à `authenticated` : la seule porte est la RPC et les
--    déclencheurs, qui sont `security definer`. Et la table refuse `update`
--    et `delete` à tout le monde, y compris au serveur — un journal qu'on
--    peut réécrire est un brouillon.
--
-- 3. **Les valeurs journalisées sont sur liste BLANCHE, colonne par
--    colonne.** `communications` contient l'objet et un extrait du corps des
--    messages. Les recopier dans une table en ajout seul créerait une
--    seconde mémoire du courrier, indestructible, alors que le §4.1 pose
--    Gmail comme source de vérité et que l'outil n'est pas une messagerie.
--    Le journal retient donc QUI a décidé QUOI : les colonnes de décision
--    humaine, avec leurs valeurs ; tout le reste par son NOM seulement.
--    Une colonne ajoutée demain est donc muette par défaut — c'est le sens
--    d'une liste blanche, et l'inverse serait une fuite en attente.

-- ---------------------------------------------------------------------------
-- 1. La table
-- ---------------------------------------------------------------------------

create table if not exists public.journal_audit (
  id            bigint generated always as identity primary key,
  -- Estampillé par le serveur. Jamais fourni par l'appelant : c'est le point.
  survenu_le    timestamptz not null default now(),
  -- L'identifiant du compte, quand il y en a un. Une écriture du serveur
  -- (cron d'ingestion, Edge Function) n'a pas de session : `acteur_id` est
  -- alors nul et `acteur_nom` vaut 'serveur'. Ne pas confondre les deux est
  -- l'essentiel : « personne » et « la machine » ne sont pas le même acteur.
  acteur_id     uuid references auth.users (id) on delete set null,
  acteur_email  text,
  acteur_nom    text,
  table_cible   text not null,
  operation     text not null check (operation in ('insert', 'update', 'delete')),
  -- La clé primaire de la ligne touchée, en texte : les trois tables n'ont
  -- pas le même type de clé (`uuid` pour deux, `email` pour `membres`).
  cible_id      text,
  -- Les colonnes qui ont changé — TOUTES, y compris celles dont la valeur
  -- n'est pas retenue. Savoir que le corps d'un message a été réécrit sans
  -- savoir en quoi reste une information ; ne rien savoir n'en est pas une.
  champs        text[] not null default '{}',
  -- Les valeurs, pour les seules colonnes de la liste blanche.
  avant         jsonb,
  apres         jsonb,
  -- Note libre d'un appelant de `journaliser()`. Les déclencheurs la
  -- laissent nulle : ce qu'ils savent est déjà dans les colonnes.
  contexte      text
);

comment on table public.journal_audit is
  'Journal d''audit en AJOUT SEUL (CDC §14.4, critère 13). Alimenté par public.journaliser() et par les déclencheurs des tables relationnelles. Ni update ni delete, pour personne. Les valeurs des colonnes hors liste blanche ne sont pas recopiées : seul leur nom figure dans `champs`.';
comment on column public.journal_audit.survenu_le is
  'Instant serveur. N''est pas un paramètre : un horodatage fourni par l''appelant ne prouve rien.';
comment on column public.journal_audit.acteur_id is
  'auth.uid() de la session. Nul pour une écriture serveur — voir acteur_nom, qui vaut alors ''serveur''.';
comment on column public.journal_audit.champs is
  'Toutes les colonnes modifiées, y compris celles dont la valeur n''est pas journalisée.';
comment on column public.journal_audit.avant is
  'Valeurs d''avant, pour les seules colonnes de la liste blanche de journal_audit_colonnes_suivies().';

create index if not exists journal_audit_cible_idx
  on public.journal_audit (table_cible, cible_id, survenu_le desc);
create index if not exists journal_audit_acteur_idx
  on public.journal_audit (acteur_id, survenu_le desc);
create index if not exists journal_audit_recent_idx
  on public.journal_audit (survenu_le desc);

-- ---------------------------------------------------------------------------
-- 2. Ajout seul, y compris pour le serveur
-- ---------------------------------------------------------------------------
--
-- Le déclencheur est la garantie qui compte : un `revoke` se contourne avec
-- le bon rôle, une exception levée `before update or delete` arrête aussi le
-- propriétaire. Elle ne résiste évidemment pas à un superutilisateur qui la
-- supprimerait d'abord — mais cette suppression, elle, laisse une trace dans
-- l'historique des migrations, et c'est précisément la différence entre une
-- réécriture silencieuse et une réécriture assumée.

create or replace function public.journal_audit_refus_reecriture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception
    'Le journal d''audit est en ajout seul : une ligne écrite ne se modifie ni ne se supprime (CDC §14.4).';
end;
$$;

drop trigger if exists journal_audit_ajout_seul on public.journal_audit;
create trigger journal_audit_ajout_seul
  before update or delete on public.journal_audit
  for each statement
  execute function public.journal_audit_refus_reecriture();

-- ---------------------------------------------------------------------------
-- 3. Qui écrit, et sous quel nom
-- ---------------------------------------------------------------------------

create or replace function public.acteur_courant()
returns table (id uuid, email text, nom text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid(),
    coalesce(
      (select m.email from public.membres m
        where m.compte_id is not null and m.compte_id = auth.uid() limit 1),
      lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''))
    ),
    coalesce(
      (select m.personne from public.membres m
        where (m.compte_id is not null and m.compte_id = auth.uid())
           or m.email = lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''))
        order by (m.compte_id is not null and m.compte_id = auth.uid()) desc, m.email
        limit 1),
      -- Pas de session : l'écriture vient du serveur (cron d'ingestion, Edge
      -- Function sous `service_role`). On le NOMME, au lieu de laisser un
      -- auteur vide qui se lirait comme « on ne sait pas ».
      case when auth.uid() is null then 'serveur' else null end
    );
$$;

comment on function public.acteur_courant() is
  'Qui écrit : identifiant, adresse et nom du membre, ou « serveur » quand il n''y a pas de session. Lit la session, ne l''accepte jamais en paramètre.';

-- ---------------------------------------------------------------------------
-- 4. La liste blanche des colonnes dont la VALEUR est journalisée
-- ---------------------------------------------------------------------------
--
-- Toutes les autres colonnes sont journalisées par leur nom seulement. La
-- règle est celle-ci : on retient les colonnes qui portent une DÉCISION
-- humaine ou un DROIT, jamais celles qui portent le contenu d'un message.

create or replace function public.journal_audit_colonnes_suivies(p_table text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_table
    -- Les dix colonnes que le navigateur peut écrire sur un message : le
    -- rattachement, les trois axes du §5.2, le traitement — et leurs
    -- signatures. Ni `objet`, ni `corps_extrait`, ni `resume`.
    when 'communications' then array[
      'projet_id_valide', 'rattache_par', 'rattache_le',
      'phase', 'type_echange', 'importance', 'categorise_par', 'categorise_le',
      'traite_par', 'traite_le'
    ]
    -- Le §15 tient à ce qu'une proposition acceptée dise ce qu'elle est
    -- devenue. C'est exactement ce que ces colonnes portent.
    when 'propositions' then array[
      'statut', 'objet_cree_type', 'objet_cree_id', 'traite_par', 'traite_le'
    ]
    -- Un changement de droits est l'action sensible par excellence, et la
    -- seule que le dépôt ne traçait nulle part : c'était une migration
    -- écrite à la main, invisible.
    when 'membres' then array['email', 'compte_id', 'personne', 'role', 'actif']
    else array[]::text[]
  end;
$$;

comment on function public.journal_audit_colonnes_suivies(text) is
  'Liste BLANCHE : les colonnes dont la valeur est recopiée dans le journal. Toute autre colonne modifiée n''y figure que par son nom. Une colonne ajoutée est donc muette par défaut.';

-- ---------------------------------------------------------------------------
-- 5. La RPC — la seule porte ouverte aux comptes applicatifs
-- ---------------------------------------------------------------------------

create or replace function public.journaliser(
  p_table     text,
  p_operation text,
  p_cible_id  text default null,
  p_champs    text[] default '{}',
  p_avant     jsonb default null,
  p_apres     jsonb default null,
  p_contexte  text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acteur record;
  v_id     bigint;
begin
  -- Une trace anonyme ne prouve rien de plus qu'une absence de trace, et
  -- coûte davantage : elle donne l'impression d'un contrôle.
  if not (select public.est_membre_actif()) and auth.uid() is not null then
    raise exception 'Compte non autorisé.';
  end if;
  if p_operation not in ('insert', 'update', 'delete') then
    raise exception 'Opération inconnue : %. Attendu insert, update ou delete.', p_operation;
  end if;
  if coalesce(btrim(p_table), '') = '' then
    raise exception 'Le journal d''audit exige la table concernée.';
  end if;

  select * into v_acteur from public.acteur_courant();

  insert into public.journal_audit (
    acteur_id, acteur_email, acteur_nom,
    table_cible, operation, cible_id, champs, avant, apres, contexte
  )
  values (
    v_acteur.id, v_acteur.email, v_acteur.nom,
    p_table, p_operation, p_cible_id, coalesce(p_champs, '{}'), p_avant, p_apres, p_contexte
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.journaliser(text, text, text, text[], jsonb, jsonb, text) is
  'Écrit une ligne d''audit. L''acteur et l''instant ne sont PAS des paramètres : ils sont lus de la session et de l''horloge serveur. Seule porte d''écriture ouverte aux comptes applicatifs.';

-- ---------------------------------------------------------------------------
-- 6. Le déclencheur générique
-- ---------------------------------------------------------------------------
--
-- Un seul déclencheur pour les trois tables, paramétré par le nom de la clé
-- primaire. Trois copies auraient fini par diverger — et une divergence dans
-- un journal d'audit ne se voit qu'au moment où l'on en a besoin.

create or replace function public.tracer_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cle       text := coalesce(tg_argv[0], 'id');
  v_acteur    record;
  v_avant     jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_apres     jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_suivies   text[] := public.journal_audit_colonnes_suivies(tg_table_name);
  v_champs    text[];
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(cle order by cle), '{}')
      into v_champs
      from jsonb_object_keys(v_apres) as cle
     where v_avant -> cle is distinct from v_apres -> cle;

    -- Rien de suivi n'a bougé : on n'écrit pas. C'est ce qui empêche la
    -- réingestion quotidienne des messages — qui réécrit des résumés et des
    -- libellés — de noyer les décisions humaines sous son propre bruit. Un
    -- journal illisible n'est pas relu, et un journal non relu ne sert à rien.
    if not (v_champs && v_suivies) then
      return null;
    end if;
  else
    select coalesce(array_agg(cle order by cle), '{}')
      into v_champs
      from jsonb_object_keys(coalesce(v_apres, v_avant)) as cle;
  end if;

  select * into v_acteur from public.acteur_courant();

  insert into public.journal_audit (
    acteur_id, acteur_email, acteur_nom,
    table_cible, operation, cible_id, champs, avant, apres
  )
  values (
    v_acteur.id, v_acteur.email, v_acteur.nom,
    tg_table_name, lower(tg_op),
    coalesce(v_apres ->> v_cle, v_avant ->> v_cle),
    v_champs,
    -- Liste blanche appliquée ici, et non à la lecture : ce qui n'est pas
    -- écrit ne fuit pas. Filtrer à l'affichage laisserait la valeur en base.
    case when v_avant is null then null else jsonb_strip_nulls(
      (select coalesce(jsonb_object_agg(cle, v_avant -> cle), '{}'::jsonb)
         from unnest(v_suivies) as cle where v_avant ? cle)) end,
    case when v_apres is null then null else jsonb_strip_nulls(
      (select coalesce(jsonb_object_agg(cle, v_apres -> cle), '{}'::jsonb)
         from unnest(v_suivies) as cle where v_apres ? cle)) end
  );

  return null;
end;
$$;

comment on function public.tracer_mutation() is
  'Déclencheur d''audit générique. Premier argument : le nom de la colonne clé. Applique la liste blanche à l''ÉCRITURE — une valeur non retenue n''entre pas en base.';

-- ---------------------------------------------------------------------------
-- 7. Les déclencheurs, table par table
-- ---------------------------------------------------------------------------
--
-- Le choix des opérations n'est pas uniforme, et c'est délibéré.
--
--   * `membres` : tout. Créer, modifier ou retirer un membre EST le
--     changement de droits ; il n'y a pas d'insertion « de routine ».
--   * `communications` : `update` et `delete` seulement. L'insertion, c'est
--     l'arrivée d'un mail — plusieurs milliers par an, aucune décision.
--   * `propositions` : `update` et `delete` seulement. L'insertion, c'est la
--     machine qui propose ; l'acte humain est l'acceptation ou le refus, et
--     c'est un `update`.

drop trigger if exists membres_audit on public.membres;
create trigger membres_audit
  after insert or update or delete on public.membres
  for each row execute function public.tracer_mutation('email');

drop trigger if exists communications_audit on public.communications;
create trigger communications_audit
  after update or delete on public.communications
  for each row execute function public.tracer_mutation('id');

drop trigger if exists propositions_audit on public.propositions;
create trigger propositions_audit
  after update or delete on public.propositions
  for each row execute function public.tracer_mutation('id');

-- ---------------------------------------------------------------------------
-- 8. Droits
-- ---------------------------------------------------------------------------

alter table public.journal_audit enable row level security;

drop policy if exists "agence lecture" on public.journal_audit;
create policy "agence lecture"
  on public.journal_audit
  for select
  to authenticated
  using ((select public.est_membre_actif()));

-- Aucune politique d'écriture, et aucun `grant insert` : la seule porte est
-- `journaliser()`, en `security definer`, et les déclencheurs.
revoke all on table public.journal_audit from anon, authenticated;
grant select on table public.journal_audit to authenticated;

-- Le serveur peut lire et ajouter. Il ne peut ni modifier ni supprimer :
-- « ajout seul » ne souffre pas d'exception pour celui qui écrit le plus.
revoke all on table public.journal_audit from service_role;
grant select, insert on table public.journal_audit to service_role;

revoke all on function public.journaliser(text, text, text, text[], jsonb, jsonb, text) from public, anon;
grant execute on function public.journaliser(text, text, text, text[], jsonb, jsonb, text) to authenticated, service_role;

revoke all on function public.acteur_courant()                    from public, anon;
revoke all on function public.tracer_mutation()                   from public, anon;
revoke all on function public.journal_audit_refus_reecriture()    from public, anon;
revoke all on function public.journal_audit_colonnes_suivies(text) from public, anon;
grant execute on function public.acteur_courant()                     to authenticated, service_role;
grant execute on function public.journal_audit_colonnes_suivies(text) to authenticated, service_role;

-- La séquence de la clé d'identité : sans droit dessus, l'insertion par la
-- RPC échouerait pour un compte applicatif. `security definer` s'en charge,
-- mais l'explicite vaut mieux que le sous-entendu.
revoke all on sequence public.journal_audit_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Contrôle final — la migration se refuse à mentir sur ce qu'elle a fait
-- ---------------------------------------------------------------------------

do $$
declare
  v_manque text;
begin
  -- 1. les trois déclencheurs sont posés
  select string_agg(t.attendu, ', ')
    into v_manque
    from (values
      ('membres_audit', 'membres'),
      ('communications_audit', 'communications'),
      ('propositions_audit', 'propositions')
    ) as t(attendu, tbl)
   where not exists (
     select 1 from pg_trigger g
       join pg_class c on c.oid = g.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.tbl and g.tgname = t.attendu
   );
  if v_manque is not null then
    raise exception 'Déclencheurs d''audit manquants : %', v_manque;
  end if;

  -- 2. aucun compte applicatif ne peut insérer directement
  if has_table_privilege('authenticated', 'public.journal_audit', 'insert') then
    raise exception 'authenticated ne doit pas pouvoir insérer directement dans le journal : la seule porte est journaliser().';
  end if;

  -- 3. personne ne peut réécrire l'histoire
  for v_manque in select unnest(array['authenticated', 'service_role', 'anon']) loop
    if has_table_privilege(v_manque, 'public.journal_audit', 'update')
       or has_table_privilege(v_manque, 'public.journal_audit', 'delete') then
      raise exception '% conserve un droit de modification sur le journal d''audit : il ne serait plus en ajout seul.', v_manque;
    end if;
  end loop;

  -- 4. la liste blanche ne laisse pas passer de contenu de message
  if public.journal_audit_colonnes_suivies('communications')
     && array['objet', 'corps_extrait', 'resume', 'destinataires', 'copies', 'expediteur'] then
    raise exception 'La liste blanche de `communications` laisserait entrer du contenu de message dans une table en ajout seul.';
  end if;
end $$;
