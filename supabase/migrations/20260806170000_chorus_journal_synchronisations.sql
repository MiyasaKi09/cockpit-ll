-- ===========================================================================
-- Cycle de vie Chorus Pro — journal des synchronisations.
--
-- CE QUE CETTE MIGRATION CRÉE, ET CE QU'ELLE NE CRÉE PAS
-- ------------------------------------------------------
-- UNE table, fermée au navigateur (RLS activée, AUCUNE policy : seul
-- `service_role` y accède, exactement comme `ingestion_config` et
-- `banque_connexions`). Elle porte ce que la fonction Edge `chorus-sync` doit
-- pouvoir dire d'un appel à l'autre :
--
--   · une synchronisation a-t-elle eu lieu, quand, sur quel environnement ;
--   · a-t-elle abouti, et sinon POURQUOI (message en français) ;
--   · combien de factures ont été lues, combien rattachées, combien signalées
--     sans correspondance.
--
-- CE QU'ELLE NE CRÉE PAS : aucune table de statuts de facture. Le cycle de vie
-- d'une facture vit sur la PIÈCE (`Facture.transmissions`, état de
-- l'application), rattaché par NUMÉRO — le même chemin que l'import CSV
-- manuel. Une table serveur d'événements serait une seconde vérité du cycle de
-- vie : deux réponses possibles à « où en est la facture 2026-050 », et l'écart
-- ne se verrait que le jour où quelqu'un compare (constat R3).
--
-- POURQUOI UN JOURNAL SERVEUR PLUTÔT QU'UNE LIGNE DANS L'ÉTAT PARTAGÉ
-- --------------------------------------------------------------------
-- Parce qu'une synchronisation qui échoue ne laisse RIEN dans le navigateur :
-- la réponse peut ne jamais arriver (onglet fermé, réseau coupé), et l'écran
-- affiche alors le même calme que s'il n'y avait rien à voir. Le journal est
-- l'endroit où un échec laisse une trace même quand personne ne regarde.
--
-- AUCUN SECRET CHORUS / PISTE ICI. `client_id`, `client_secret`, le login et
-- le mot de passe du compte technique restent dans les secrets de la fonction
-- Edge (`Deno.env.get`). Aucun jeton n'est stocké non plus : `chorus-sync`
-- demande un jeton par passage plutôt que d'en mettre un en cache. Ce qui est
-- ici est un compte-rendu — jamais un moyen d'accès.
--
-- MIGRATION NON APPLIQUÉE : l'agence relit, puis déclenche (`supabase db
-- push`). Rien n'est joué depuis le dépôt.
-- ===========================================================================

create table if not exists public.chorus_synchronisations (
  id             uuid primary key default gen_random_uuid(),
  -- 'qualification' | 'production' — conservé TEL QUEL : lire des factures de
  -- qualification et croire lire celles de la structure est le contresens que
  -- cette colonne rend impossible à commettre en silence.
  environnement  text not null,
  lance_le       timestamptz not null default now(),
  lance_par      text,
  termine_le     timestamptz,
  -- null = la synchronisation n'a jamais rendu la main (le cas le plus
  -- instructif : il ne produit aucune erreur à l'écran)
  ok             boolean,
  resultat       text,
  nb_factures    integer,
  -- Renseignés par l'action `confirmer` : ce qui est RÉELLEMENT entré au
  -- Cockpit. « Chorus a répondu » et « le Cockpit a rattaché » ne sont pas la
  -- même chose, et c'est la seconde qui dit si le suivi vaut quelque chose.
  nb_rattachees  integer,
  nb_inconnues   integer,
  integre_le     timestamptz
);

-- `create table if not exists` ne complète pas une table historique partielle :
-- ces ALTER rendent la migration rejouable sans surprise.
alter table public.chorus_synchronisations
  add column if not exists environnement text not null default 'qualification',
  add column if not exists lance_le timestamptz not null default now(),
  add column if not exists lance_par text,
  add column if not exists termine_le timestamptz,
  add column if not exists ok boolean,
  add column if not exists resultat text,
  add column if not exists nb_factures integer,
  add column if not exists nb_rattachees integer,
  add column if not exists nb_inconnues integer,
  add column if not exists integre_le timestamptz;

create index if not exists chorus_synchronisations_lance_le_idx
  on public.chorus_synchronisations (lance_le desc);

comment on table public.chorus_synchronisations is
  'Journal des lectures du cycle de vie Chorus Pro. Aucun statut de facture ici : le cycle de vie vit sur la pièce, rattaché par numéro, comme l''import CSV.';
comment on column public.chorus_synchronisations.environnement is
  'qualification = jeu de données de l''AIFE, PAS les factures de l''agence. La confusion entre les deux se paie en factures fantômes.';
comment on column public.chorus_synchronisations.nb_inconnues is
  'Factures vues sur le portail dont le numéro ne correspond à AUCUNE facture du Cockpit. Elles sont SIGNALÉES, jamais rattachées « au plus proche ».';

-- ---------------------------------------------------------------------------
-- Fermeture : service_role uniquement, comme ingestion_config
-- ---------------------------------------------------------------------------

alter table public.chorus_synchronisations enable row level security;

-- Aucune policy, volontairement : RLS activée sans policy = personne ne passe,
-- sauf `service_role`, qui n'y est pas soumis. Le navigateur ne lit jamais
-- cette table en direct — il passe par la fonction `chorus-sync`, qui ne lui
-- rend qu'un compte-rendu, sans identifiant ni jeton.
revoke all on table public.chorus_synchronisations from anon, authenticated;
grant select, insert, update, delete on table public.chorus_synchronisations to service_role;

-- ---------------------------------------------------------------------------
-- Garde-fou de déploiement
-- ---------------------------------------------------------------------------
--
-- `chorus-sync` sait vivre sans cette table : elle journalise dans les logs et
-- continue (une synchronisation ne doit pas échouer parce qu'un compte-rendu
-- ne s'écrit pas). Le dire ici évite de chercher la panne ailleurs le jour où
-- la carte affiche « dernière synchronisation : inconnue » alors qu'elle vient
-- d'avoir lieu.

do $$
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'chorus_synchronisations'
  ) then
    raise exception
      'public.chorus_synchronisations est absente : chorus-sync fonctionnera, mais sans mémoire de ses passages.';
  end if;
end
$$;
