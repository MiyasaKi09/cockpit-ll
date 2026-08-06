-- ===========================================================================
-- Connexion bancaire en LECTURE (GoCardless Bank Account Data, ex-Nordigen).
--
-- CE QUE CETTE MIGRATION CRÉE, ET POURQUOI CÔTÉ SERVEUR
-- -----------------------------------------------------
-- Trois tables, toutes fermées au navigateur (RLS activée, AUCUNE policy :
-- seul `service_role` y accède, exactement comme `ingestion_config`). Elles
-- portent ce que la fonction Edge `banque-sync` doit savoir d'un appel à
-- l'autre et que le Cockpit ne doit jamais tenir :
--
--   · `banque_gocardless_jeton`  — le couple access / refresh de l'API. Le
--     jeton d'accès vit 24 h, le jeton de rafraîchissement 30 jours ; sans
--     cache, chaque synchronisation redemanderait un jeton neuf.
--   · `banque_connexions`        — une demande (requisition) = une banque
--     autorisée par une personne, avec la DATE D'EXPIRATION DU CONSENTEMENT.
--     C'est cette date qui permet d'avertir AVANT que la trésorerie ne se
--     fige (DSP2 : 90 jours d'accès continu, ré-authentification ensuite).
--   · `banque_comptes`           — les comptes rendus par cette demande, et
--     le dernier solde relevé avec SON TYPE (`closingBooked`,
--     `interimAvailable`…) et la liste des types que la banque publie
--     réellement. Cette liste ne se devine pas : elle se relève banque par
--     banque, et elle est ici pour ça.
--
-- CE QU'ELLE NE CRÉE PAS : aucune table de mouvements. Les opérations
-- rapatriées ne transitent pas par une table serveur — elles repartent dans
-- la réponse de la fonction, et c'est le navigateur qui les fait entrer par
-- `preparerImport` (src/banque.ts), le seul chemin idempotent du dépôt.
-- Une seconde table de mouvements serait une seconde vérité bancaire.
--
-- AUCUN SECRET GOCARDLESS ICI. `secret_id` / `secret_key` restent dans les
-- secrets de la fonction Edge (`Deno.env.get`). Ce qui est stocké ici, ce
-- sont des JETONS DÉRIVÉS (révocables, à durée de vie courte) et des
-- identifiants de ressources — jamais les identifiants d'API eux-mêmes.
--
-- MIGRATION NON APPLIQUÉE : l'agence relit, puis déclenche (`supabase db
-- push`). Rien n'est joué depuis le dépôt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Jeton d'API — une seule ligne ('gocardless')
-- ---------------------------------------------------------------------------

create table if not exists public.banque_gocardless_jeton (
  id                  text primary key,
  acces               text,
  acces_expire_le     timestamptz,
  rafraichissement    text,
  rafraichissement_expire_le timestamptz,
  maj_le              timestamptz not null default now()
);

-- `create table if not exists` ne complète pas une table historique partielle :
-- ces ALTER rendent la migration rejouable sans surprise.
alter table public.banque_gocardless_jeton
  add column if not exists acces text,
  add column if not exists acces_expire_le timestamptz,
  add column if not exists rafraichissement text,
  add column if not exists rafraichissement_expire_le timestamptz,
  add column if not exists maj_le timestamptz not null default now();

insert into public.banque_gocardless_jeton (id)
values ('gocardless')
on conflict (id) do nothing;

comment on table public.banque_gocardless_jeton is
  'Cache du jeton GoCardless (access 24 h / refresh 30 j). Les identifiants d''API restent dans les secrets de la fonction Edge.';
comment on column public.banque_gocardless_jeton.rafraichissement_expire_le is
  'Au-delà, le rafraîchissement ne suffit plus : il faut repasser par /api/v2/token/new/. Un relais qui ne gère que le refresh tombe silencieusement au 30e jour.';

-- ---------------------------------------------------------------------------
-- Connexions (une demande GoCardless = une banque autorisée)
-- ---------------------------------------------------------------------------

create table if not exists public.banque_connexions (
  id                        uuid primary key default gen_random_uuid(),
  institution_id            text not null,
  institution_nom           text,
  reference                 text not null,
  accord_id                 text,
  requisition_id            text,
  -- statut LISIBLE côté Cockpit : en_attente | liee | expiree | erreur
  statut                    text not null default 'en_attente',
  -- statut BRUT de GoCardless, conservé tel quel : la spec en déclare onze
  -- (CR ID GC UA RJ SA GA LN SU ER EX) là où la page HTML n'en documente que
  -- huit. On ne le traduit pas de force, on le garde pour le diagnostic.
  statut_gocardless         text,
  acces_jours               integer,
  historique_jours          integer,
  consentement_accepte_le   timestamptz,
  consentement_expire_le    timestamptz,
  derniere_sync_le          timestamptz,
  derniere_sync_ok          boolean,
  derniere_sync_resultat    text,
  cree_par                  text,
  cree_le                   timestamptz not null default now(),
  maj_le                    timestamptz not null default now()
);

alter table public.banque_connexions
  add column if not exists institution_nom text,
  add column if not exists accord_id text,
  add column if not exists requisition_id text,
  add column if not exists statut text not null default 'en_attente',
  add column if not exists statut_gocardless text,
  add column if not exists acces_jours integer,
  add column if not exists historique_jours integer,
  add column if not exists consentement_accepte_le timestamptz,
  add column if not exists consentement_expire_le timestamptz,
  add column if not exists derniere_sync_le timestamptz,
  add column if not exists derniere_sync_ok boolean,
  add column if not exists derniere_sync_resultat text,
  add column if not exists cree_par text,
  add column if not exists cree_le timestamptz not null default now(),
  add column if not exists maj_le timestamptz not null default now();

-- La référence voyage jusqu'à GoCardless (champ `reference` de la demande) et
-- revient dans l'adresse de retour : elle doit être unique et imprévisible.
create unique index if not exists banque_connexions_reference_unq
  on public.banque_connexions (reference);

create index if not exists banque_connexions_statut_idx
  on public.banque_connexions (statut);

comment on column public.banque_connexions.consentement_expire_le is
  'DSP2 : fin de l''accès continu (90 jours par défaut). C''est de cette date que part l''alerte J-7 du Cockpit — la détection par erreur 401 n''est que le filet.';
comment on column public.banque_connexions.derniere_sync_le is
  'Dernière synchronisation RÉUSSIE. null veut dire « jamais », pas « à l''instant » : une synchronisation morte depuis trois semaines doit se voir.';

-- ---------------------------------------------------------------------------
-- Comptes rendus par une connexion
-- ---------------------------------------------------------------------------

create table if not exists public.banque_comptes (
  id                  uuid primary key default gen_random_uuid(),
  connexion_id        uuid not null references public.banque_connexions (id) on delete cascade,
  compte_id           text not null,
  libelle             text,
  iban_masque         text,
  devise              text,
  -- DISCOVERED | PROCESSING | READY | ERROR | EXPIRED | SUSPENDED
  statut              text,
  dernier_solde       numeric(14, 2),
  dernier_solde_type  text,
  dernier_solde_date  date,
  -- les `balanceType` réellement publiés par CETTE banque, relevés à chaque
  -- synchronisation : il n'existe pas de champ « le solde », et le choix ne
  -- se code pas en dur (§1.5 de la note technique).
  types_solde_vus     jsonb not null default '[]'::jsonb,
  derniere_sync_le    timestamptz,
  cree_le             timestamptz not null default now(),
  maj_le              timestamptz not null default now()
);

alter table public.banque_comptes
  add column if not exists libelle text,
  add column if not exists iban_masque text,
  add column if not exists devise text,
  add column if not exists statut text,
  add column if not exists dernier_solde numeric(14, 2),
  add column if not exists dernier_solde_type text,
  add column if not exists dernier_solde_date date,
  add column if not exists types_solde_vus jsonb not null default '[]'::jsonb,
  add column if not exists derniere_sync_le timestamptz,
  add column if not exists cree_le timestamptz not null default now(),
  add column if not exists maj_le timestamptz not null default now();

create unique index if not exists banque_comptes_compte_unq
  on public.banque_comptes (connexion_id, compte_id);

comment on column public.banque_comptes.iban_masque is
  'Quatre derniers caractères seulement : de quoi reconnaître le compte à l''écran, jamais de quoi émettre un ordre.';
comment on column public.banque_comptes.dernier_solde is
  'Dernier solde relevé. Reste null quand la banque n''en publie aucun d''exploitable : null n''est pas 0, et l''écran le dit.';

-- ---------------------------------------------------------------------------
-- Fermeture : service_role uniquement, comme ingestion_config
-- ---------------------------------------------------------------------------

alter table public.banque_gocardless_jeton enable row level security;
alter table public.banque_connexions       enable row level security;
alter table public.banque_comptes          enable row level security;

-- Aucune policy, volontairement : RLS activée sans policy = personne ne
-- passe, sauf `service_role`, qui n'y est pas soumis. Le navigateur ne lit
-- ces tables JAMAIS en direct — il passe par la fonction `banque-sync`, qui
-- ne lui rend qu'un statut sans jeton ni identifiant GoCardless.
revoke all on table public.banque_gocardless_jeton from anon, authenticated;
revoke all on table public.banque_connexions       from anon, authenticated;
revoke all on table public.banque_comptes          from anon, authenticated;

grant select, insert, update, delete on table public.banque_gocardless_jeton to service_role;
grant select, insert, update, delete on table public.banque_connexions       to service_role;
grant select, insert, update, delete on table public.banque_comptes          to service_role;

-- ---------------------------------------------------------------------------
-- Garde-fou de déploiement
-- ---------------------------------------------------------------------------
--
-- `banque-sync` refuse de démarrer sans ces tables ; le dire ici évite de
-- chercher la panne dans la fonction. Même esprit que les vérifications
-- finales des migrations d'ingestion.

do $$
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'banque_connexions'
  ) then
    raise exception
      'public.banque_connexions est absente : ne déployez pas banque-sync, elle ne pourrait rien enregistrer.';
  end if;
end
$$;
