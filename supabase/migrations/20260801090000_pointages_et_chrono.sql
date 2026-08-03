-- Livrables B.4, B.6, B.7 — le temps horodaté et le chrono.
--
-- POURQUOI CES DEUX TABLES SORTENT DU DOCUMENT JSONB
-- ---------------------------------------------------
-- C'est la FRÉQUENCE, pas la taille (§3.1). Un pointage pèse quelques
-- octets ; mais une vingtaine par jour et par personne deviennent autant de
-- cycles compare-and-swap sur un document que tout le reste utilise. Et un
-- chrono logé dans le JSONB le ferait battre à la seconde.
--
-- La grille hebdomadaire (`state.temps`), elle, RESTE dans le document :
-- elle devient une projection des pointages (B.5). `derive.ts` n'est pas
-- touché, donc la marge, le plan de charge et la chaîne financière
-- continuent de lire ce qu'ils lisaient.
--
-- CE QUE LA BASE GARANTIT, ET QU'UN ÉCRAN NE PEUT PAS GARANTIR
-- -------------------------------------------------------------
-- 1. **Un seul chrono actif par personne.** C'est une contrainte d'unicité,
--    pas une règle d'interface. Deux onglets ouverts, deux postes, un
--    rechargement au mauvais moment : l'écran ne peut pas s'en prémunir, et
--    deux chronos qui tournent produisent du temps compté deux fois — sur
--    la grandeur qui porte la marge.
-- 2. **Une durée n'est jamais négative**, et une fin n'est jamais avant son
--    début. Un pointage négatif SOUSTRAIT du temps : la marge s'améliorerait
--    toute seule, ce qui est le défaut le plus difficile à remarquer.
-- 3. **Un pointage validé ne se réécrit pas** depuis le navigateur. La
--    relecture est ce qui fait d'une saisie une donnée ; la rouvrir doit
--    être un geste tracé (B.16).

-- ---------------------------------------------------------------------------
-- 1. Les pointages
-- ---------------------------------------------------------------------------

create table if not exists public.pointages (
  id           uuid primary key default gen_random_uuid(),
  personne     text not null,
  -- C'est `debut` qui décide du jour ET de la semaine. Un pointage qui
  -- franchit minuit appartient à la journée où il a commencé : le découper
  -- ferait apparaître deux saisies là où la personne se souvient d'une.
  debut        timestamptz not null,
  -- `null` = le chrono tourne. Un pointage ouvert ne compte dans aucune
  -- projection : le temps en train de passer n'est pas du temps passé.
  fin          timestamptz,
  -- Stockée, pas déduite : une correction manuelle (« j'ai été interrompu
  -- une demi-heure ») ne doit pas être écrasée par le calcul des bornes.
  minutes      integer not null default 0,
  projet_id    text,
  phase        text,
  -- Critère 8 : un temps se rattache « à un projet OU à une tâche ».
  -- L'identifiant vient du document JSONB, il n'a donc pas de clé
  -- étrangère — et c'est assumé : une tâche supprimée laisse un pointage
  -- orphelin, ce qui vaut mieux qu'un pointage supprimé avec elle.
  tache_id     text,
  activite     text not null default 'autre',
  commentaire  text not null default '',
  facturable   boolean not null default true,
  validee      boolean not null default false,
  source       text not null default 'saisie',
  cree_le      timestamptz not null default now(),
  maj_le       timestamptz not null default now()
);

alter table public.pointages
  add column if not exists tache_id text,
  add column if not exists activite text not null default 'autre',
  add column if not exists commentaire text not null default '',
  add column if not exists facturable boolean not null default true,
  add column if not exists validee boolean not null default false,
  add column if not exists source text not null default 'saisie';

comment on table public.pointages is
  'Temps horodaté (CDC §9.5, livrable B.4). Sorti du JSONB pour sa FRÉQUENCE, pas sa taille. La grille hebdomadaire state.temps en est une PROJECTION (B.5) — elle ne se saisit plus.';
comment on column public.pointages.minutes is
  'Durée en MINUTES. Entière et stockée : on additionne des entiers et on ne divise qu''à la fin (voir src/pointages.ts). Arrondir chaque pointage en heures perdrait plusieurs heures par an sur la marge.';
comment on column public.pointages.fin is
  'null = chrono en cours. Un pointage ouvert n''entre dans aucune projection.';
comment on column public.pointages.facturable is
  'B.7. Défaut : vrai si un projet est rattaché — la règle actuelle, reconduite telle quelle. Modifiable par pointage : un déplacement ne se facture pas toujours.';
comment on column public.pointages.tache_id is
  'Identifiant d''une TacheInterne du document JSONB. Sans clé étrangère, délibérément : une tâche supprimée doit laisser un pointage orphelin plutôt qu''emporter du temps réellement passé.';

do $$
begin
  -- Une durée négative SOUSTRAIT du temps : la marge s'améliorerait toute
  -- seule, et personne ne va chercher un défaut qui embellit un chiffre.
  if not exists (select 1 from pg_constraint where conname = 'pointages_minutes_chk') then
    alter table public.pointages add constraint pointages_minutes_chk check (minutes >= 0);
  end if;
  -- Une fin avant son début est soit une faute de saisie, soit un fuseau
  -- mal converti. Les deux se corrigent ; aucune ne se stocke.
  if not exists (select 1 from pg_constraint where conname = 'pointages_bornes_chk') then
    alter table public.pointages add constraint pointages_bornes_chk check (fin is null or fin >= debut);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pointages_activite_chk') then
    alter table public.pointages add constraint pointages_activite_chk
      check (activite in ('conception','reunion','chantier','administratif','deplacement','echange','autre'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pointages_source_chk') then
    alter table public.pointages add constraint pointages_source_chk
      check (source in ('chrono','saisie','reprise'));
  end if;
end $$;

-- « le temps de cette personne cette semaine » : la lecture de la grille.
create index if not exists pointages_personne_debut_idx
  on public.pointages (personne, debut desc);
-- « le temps de ce projet » : la marge.
create index if not exists pointages_projet_idx
  on public.pointages (projet_id, debut desc) where projet_id is not null;
-- « le temps de cette tâche » : la seconde projection (B.9).
create index if not exists pointages_tache_idx
  on public.pointages (tache_id) where tache_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Le chrono actif — UN par personne, garanti par la base
-- ---------------------------------------------------------------------------
--
-- L'unicité est ici et non dans l'écran, parce que l'écran ne peut pas la
-- tenir : deux onglets, deux postes, un rechargement au mauvais moment. Et
-- deux chronos qui tournent comptent le même temps deux fois.

create table if not exists public.chrono_actif (
  personne    text primary key,
  debut       timestamptz not null default now(),
  projet_id   text,
  phase       text,
  tache_id    text,
  activite    text not null default 'autre',
  commentaire text not null default '',
  maj_le      timestamptz not null default now()
);

comment on table public.chrono_actif is
  'Chrono en cours (CDC §9.2-9.4, livrable B.6). UNE ligne par personne — la clé primaire EST la garantie : deux chronos simultanés compteraient le même temps deux fois, et l''écran ne peut pas s''en prémunir.';

-- ---------------------------------------------------------------------------
-- 3. Estampilles
-- ---------------------------------------------------------------------------

create or replace function public.pointages_touche_maj_le()
returns trigger language plpgsql volatile security invoker set search_path = '' as $$
begin
  new.maj_le := now();
  return new;
end
$$;

drop trigger if exists pointages_maj_le on public.pointages;
create trigger pointages_maj_le before update on public.pointages
  for each row execute function public.pointages_touche_maj_le();

drop trigger if exists chrono_maj_le on public.chrono_actif;
create trigger chrono_maj_le before update on public.chrono_actif
  for each row execute function public.pointages_touche_maj_le();

-- ---------------------------------------------------------------------------
-- 4. Un pointage validé ne se réécrit pas depuis le navigateur
-- ---------------------------------------------------------------------------
--
-- La relecture est ce qui fait d'une saisie une donnée. La rouvrir reste
-- possible — mais c'est un geste, et il devra être tracé (B.16). Le
-- `service_role` passe : la correction administrative existe, elle est
-- simplement hors du chemin quotidien.

create or replace function public.pointages_refus_reecriture_validee()
returns trigger language plpgsql volatile security invoker set search_path = '' as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if old.validee and (
       new.debut is distinct from old.debut
    or new.fin is distinct from old.fin
    or new.minutes is distinct from old.minutes
    or new.projet_id is distinct from old.projet_id
    or new.phase is distinct from old.phase
    or new.tache_id is distinct from old.tache_id
  ) then
    raise exception
      'Ce pointage a été validé : sa durée et son rattachement ne se modifient plus. Rouvrez-le d''abord (validee = false), le geste sera tracé.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists pointages_validee_intacte on public.pointages;
create trigger pointages_validee_intacte before update on public.pointages
  for each row execute function public.pointages_refus_reecriture_validee();

-- ---------------------------------------------------------------------------
-- 5. Accès — le registre des membres, aucune adresse littérale
-- ---------------------------------------------------------------------------

alter table public.pointages enable row level security;
alter table public.chrono_actif enable row level security;

drop policy if exists "agence lecture" on public.pointages;
drop policy if exists "agence saisie" on public.pointages;
drop policy if exists "agence insertion" on public.pointages;
drop policy if exists "agence suppression" on public.pointages;

-- Les deux associés voient le temps l'un de l'autre : c'est une agence de
-- deux personnes, le plan de charge et la marge se lisent ensemble.
create policy "agence lecture" on public.pointages
  for select to authenticated using ((select public.est_membre_actif()));

create policy "agence insertion" on public.pointages
  for insert to authenticated
  with check ((select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule');

create policy "agence saisie" on public.pointages
  for update to authenticated
  using ((select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule')
  with check ((select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule');

-- Supprimer un pointage reste possible : une saisie faite sur le mauvais
-- projet doit pouvoir disparaître plutôt que d'être compensée par une
-- seconde saisie négative, qui n'existe pas (contrainte `minutes >= 0`).
create policy "agence suppression" on public.pointages
  for delete to authenticated
  using ((select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule'
    and not validee);

drop policy if exists "agence lecture" on public.chrono_actif;
drop policy if exists "agence chrono" on public.chrono_actif;
drop policy if exists "agence chrono insertion" on public.chrono_actif;
drop policy if exists "agence chrono arret" on public.chrono_actif;

create policy "agence lecture" on public.chrono_actif
  for select to authenticated using ((select public.est_membre_actif()));
create policy "agence chrono insertion" on public.chrono_actif
  for insert to authenticated
  with check ((select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule');
create policy "agence chrono" on public.chrono_actif
  for update to authenticated
  using ((select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule')
  with check ((select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule');
create policy "agence chrono arret" on public.chrono_actif
  for delete to authenticated
  using ((select public.est_membre_actif())
    and (select public.role_courant()) is distinct from 'lecture_seule');

revoke all on table public.pointages from anon, authenticated;
grant select, insert, delete on table public.pointages to authenticated;
-- `validee` est écrivable : c'est le geste de relecture. Ce qu'il protège
-- ensuite est tenu par le trigger, pas par ce GRANT.
grant update (
    debut, fin, minutes, projet_id, phase, tache_id,
    activite, commentaire, facturable, validee
  ) on table public.pointages to authenticated;
grant select, insert, update, delete on table public.pointages to service_role;

revoke all on table public.chrono_actif from anon, authenticated;
grant select, insert, update, delete on table public.chrono_actif to authenticated;
grant select, insert, update, delete on table public.chrono_actif to service_role;

revoke all on function public.pointages_touche_maj_le() from public, anon;
revoke all on function public.pointages_refus_reecriture_validee() from public, anon;
grant execute on function public.pointages_touche_maj_le() to authenticated, service_role;
grant execute on function public.pointages_refus_reecriture_validee() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Journal d'audit (B.16) — les deux tables du temps
-- ---------------------------------------------------------------------------
--
-- A.13 a posé le mécanisme ; B.16 l'étend ici. Le §14.4 vise nommément les
-- corrections de temps : elles deviennent auditables au moment où elles
-- deviennent relationnelles, pas avant.

create or replace function public.journal_audit_colonnes_suivies(p_table text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_table
    when 'communications' then array[
      'projet_id_valide', 'rattache_par', 'rattache_le',
      'phase', 'type_echange', 'importance', 'categorise_par', 'categorise_le',
      'traite_par', 'traite_le'
    ]
    when 'propositions' then array[
      'statut', 'objet_cree_type', 'objet_cree_id', 'traite_par', 'traite_le'
    ]
    when 'membres' then array['email', 'compte_id', 'personne', 'role', 'actif']
    -- Le temps : QUI, QUAND, sur QUOI, et combien. Pas le commentaire —
    -- il est libre, et le journal n'est pas une seconde mémoire du texte.
    when 'pointages' then array[
      'personne', 'debut', 'fin', 'minutes', 'projet_id', 'phase',
      'tache_id', 'facturable', 'validee'
    ]
    when 'chrono_actif' then array['personne', 'debut', 'projet_id', 'phase', 'tache_id']
    else array[]::text[]
  end;
$$;

drop trigger if exists pointages_audit on public.pointages;
-- Les trois opérations : une correction de temps est un `update`, mais une
-- saisie effacée est un `delete`, et c'est celle-là qu'on cherchera le jour
-- où un total ne tombe pas juste.
create trigger pointages_audit
  after insert or update or delete on public.pointages
  for each row execute function public.tracer_mutation('id');

drop trigger if exists chrono_audit on public.chrono_actif;
create trigger chrono_audit
  after insert or update or delete on public.chrono_actif
  for each row execute function public.tracer_mutation('personne');

-- ---------------------------------------------------------------------------
-- 7. Contrôle final
-- ---------------------------------------------------------------------------

do $$
declare
  v_manque text;
begin
  if to_regclass('public.pointages') is null or to_regclass('public.chrono_actif') is null then
    raise exception 'Les tables du temps sont absentes après migration.';
  end if;

  -- L'unicité du chrono est LA garantie de ce fichier.
  if not exists (
    select 1 from pg_constraint c
      join pg_class t on t.oid = c.conrelid
     where t.relname = 'chrono_actif' and c.contype = 'p'
  ) then
    raise exception 'public.chrono_actif sans clé primaire : deux chronos simultanés compteraient le même temps deux fois.';
  end if;

  -- Aucune durée négative possible.
  if not exists (select 1 from pg_constraint where conname = 'pointages_minutes_chk') then
    raise exception 'pointages_minutes_chk absente : une durée négative soustrairait du temps, et la marge s''améliorerait toute seule.';
  end if;

  for v_manque in select unnest(array['pointages_audit', 'chrono_audit']) loop
    if not exists (select 1 from pg_trigger where tgname = v_manque) then
      raise exception 'Déclencheur d''audit manquant : % (livrable B.16).', v_manque;
    end if;
  end loop;

  -- Le journal ne doit pas recopier le commentaire libre d'un pointage :
  -- il trace des décisions, pas du texte.
  if public.journal_audit_colonnes_suivies('pointages') && array['commentaire'] then
    raise exception 'La liste blanche des pointages recopierait le commentaire libre dans une table en ajout seul.';
  end if;
end $$;
