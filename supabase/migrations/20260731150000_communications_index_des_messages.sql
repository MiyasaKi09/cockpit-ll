-- Livrable A.2 — `public.communications`, l'index des MESSAGES.
--
-- POURQUOI CETTE TABLE, ET POURQUOI MAINTENANT
-- --------------------------------------------
-- `public.entrants` est l'index des PIÈCES à valider : un message sans pièce
-- jointe n'y existe pas. C'est le critère 2 du §22 — « chaque message projet
-- est visible dans Cockpit » — qui tombe, et avec lui la mémoire projet du
-- §4.3. `communications` est l'index des messages : un message, une ligne,
-- qu'il porte une pièce ou non.
--
-- Le §3.1 du plan la fait sortir du document JSONB pour une raison mesurée :
-- environ 937 octets par message, soit 13 Mo par an à 60 messages par jour,
-- contre 2,9 Mo pour TOUT le document actuel à régime. Une table neuve, sans
-- donnée à reprendre et sans code existant à casser.
--
-- POURQUOI UNE SEULE MIGRATION, AXES COMPRIS
-- ------------------------------------------
-- Le plan l'exige explicitement : « ajouter ces colonnes après coup coûterait
-- une reprise des lignes déjà ingérées ». Les trois axes du §5.2 se calculent
-- à partir de l'objet, de l'expéditeur et du corps — c'est-à-dire à
-- l'ingestion. Une table créée sans eux se remplirait pendant des semaines de
-- lignes qu'il faudrait rouvrir une par une dans Gmail pour les catégoriser.
-- D'où : le squelette du message ET les dix colonnes des axes ici, ensemble.
--
-- OÙ VIVENT LES VALEURS DES TROIS AXES
-- ------------------------------------
-- Dans `src/categorisation.ts` (livrable 0.10), et nulle part ailleurs. Les
-- trois DOMAINES ci-dessous sont la transcription de ses trois listes fermées
-- — 14 phases, 15 types, 6 niveaux d'importance. Un domaine plutôt qu'un CHECK
-- par colonne, parce que chaque axe a deux colonnes (proposée, humaine) : deux
-- listes recopiées dans le même fichier divergeraient au premier ajout.
-- `scripts/test-communications.cjs` compare les trois domaines au module,
-- valeur par valeur : une liste qui s'ouvre d'un côté seulement échoue en CI,
-- et non au premier INSERT refusé en production.
--
-- LA SÉPARATION PROPOSÉ / VALIDÉ EST PORTÉE PAR LE SCHÉMA (§3.14, décision 2)
-- ---------------------------------------------------------------------------
-- Chaque axe existe en deux colonnes stockées — `phase_proposee` (machine) et
-- `phase` (humain) — et une colonne GÉNÉRÉE `phase_effective` que lisent les
-- écrans : aucun module ne réimplémente la règle, donc aucun ne peut en
-- diverger. Trois garde-fous, et non un :
--
--   1. le GRANT est au niveau COLONNE : `authenticated` ne reçoit `update` que
--      sur les colonnes humaines. PostgreSQL refuse l'écriture des autres,
--      quel que soit le code du navigateur ;
--   2. un trigger `before update` refuse explicitement toute modification
--      d'une colonne de proposition hors `service_role` — ceinture et
--      bretelles, et surtout un message d'erreur qui dit quoi corriger ;
--   3. l'`insert` est réservé à `service_role` : le navigateur ne fabrique pas
--      de message.
--
-- La règle d'effectivité mérite d'être lue : tant que personne n'a catégorisé
-- (`categorise_par is null`), la proposition de la machine s'affiche ; dès
-- qu'un humain a signé, SEULE sa valeur compte — y compris quand il a vidé
-- l'axe. Sans cette bascule, un axe délibérément effacé se remplirait à
-- nouveau avec la proposition, et la correction humaine ne tiendrait pas une
-- nuit. C'est exactement l'invariant que `reprendreAxes()` tient côté
-- navigateur (`src/categorisation.ts`), écrit ici dans le même sens.
--
-- CE QUE CETTE TABLE NE PORTE PAS, DÉLIBÉRÉMENT
-- ---------------------------------------------
--   * pas de `statut` : le §3.12 remplace le `Courrier.statut` `a_traiter` /
--     `traite` par `traite_le` / `traite_par` — donc nominatif, donc
--     journalisable, ce qu'un statut ne permet pas. Un message traité reste
--     consultable par projet ; c'est une mémoire, pas une boîte de réception ;
--   * pas de `source_url` : `gmailMessageUrl()` (`src/util.ts`) la construit
--     déjà, et refuse les identifiants malformés (critère 10,
--     `scripts/test-lien-gmail.cjs`). Une seconde construction en base
--     divergerait de celle que l'écran utilise ;
--   * pas de copie du corps : `corps_extrait` est BORNÉ. La source de vérité
--     reste Gmail (§4.3), Cockpit en tient l'index ;
--   * pas de propositions de tâches, d'échéances, de décisions ni de risques :
--     elles ont leur table à quatre genres (`propositions`, livrable A.9).
--
-- ORDRE D'APPLICATION
-- -------------------
-- Après 20260730160000, 20260730180000 (le registre, dont les fonctions
-- d'autorisation sont appelées ici) et 20260731103000 (l'ingestion enrichie).
-- Elle s'applique AVANT le redéploiement de `gmail-ingestion` : la nouvelle
-- source insère dans cette table, et une insertion vers une table absente
-- échoue à chaque passage du cron, sans autre trace que les journaux Supabase.

-- ---------------------------------------------------------------------------
-- 1. Les trois axes du §5.2, transcrits de src/categorisation.ts
--
-- Ne rien écrire d'autre entre les repères : `scripts/test-communications.cjs`
-- lit les listes ENTRE EUX et les compare au module. Un commentaire y est
-- toléré, une valeur inventée non.
-- ---------------------------------------------------------------------------

-- [AXES-CDC-5.2:DEBUT]

-- Axe 1 — phase du projet. Superset de `PhaseCode` : les dix phases de la
-- mission (PHASES_ORDRE, src/miqcp.ts) plus les quatre qui n'ont ni montant ni
-- pourcentage d'honoraires. `PhaseCode` n'est PAS étendu — y faire entrer
-- PROSPECTION ou SAV ferait entrer des phases fantômes dans l'échéancier de
-- facturation (§3.14, décision 1).
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'phase_echange' and n.nspname = 'public'
  ) then
    create domain public.phase_echange as text
      check (value in (
        'PROSPECTION', 'CONCOURS',
        'DIAG', 'ESQ', 'APS', 'APD', 'PRO', 'ACT-DCE', 'VISA', 'DET', 'AOR', 'MC',
        'DOE', 'SAV'
      ));
  end if;
end $$;

-- Axe 2 — type d'échange, par l'interlocuteur.
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'type_echange' and n.nspname = 'public'
  ) then
    create domain public.type_echange as text
      check (value in (
        'client', 'administration', 'urbanisme', 'bet', 'bureau_de_controle',
        'csps', 'entreprise', 'fournisseur', 'interne', 'contractuel',
        'financier', 'planning', 'chantier', 'reclamation', 'validation'
      ));
  end if;
end $$;

-- Axe 3 — niveau d'importance. L'ordre est significatif : `graviteDe()`
-- (src/categorisation.ts) le projette sur l'échelle 1-3 de `Alerte.gravite`,
-- et cette projection doit rester croissante.
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'niveau_importance' and n.nspname = 'public'
  ) then
    create domain public.niveau_importance as text
      check (value in (
        'information', 'a_traiter', 'important', 'urgent', 'bloquant', 'contractuel'
      ));
  end if;
end $$;

-- [AXES-CDC-5.2:FIN]

comment on domain public.phase_echange is
  'Axe 1 du CDC §5.2. Transcription de PHASES_ECHANGE (src/categorisation.ts) : superset de PhaseCode, jamais l''inverse. Une valeur ajoutée ici doit l''être là-bas, et réciproquement — scripts/test-communications.cjs le vérifie.';
comment on domain public.type_echange is
  'Axe 2 du CDC §5.2. Transcription de TYPES_ECHANGE (src/categorisation.ts).';
comment on domain public.niveau_importance is
  'Axe 3 du CDC §5.2. Transcription de NIVEAUX_IMPORTANCE (src/categorisation.ts), du plus faible au plus fort.';

-- ---------------------------------------------------------------------------
-- 2. La table
--
-- Patron de `public.veille_signaux` (migration 20260730085155) : création
-- complète, puis `add column if not exists` colonne par colonne, pour qu'une
-- base où une ébauche existerait déjà converge au lieu d'échouer.
-- ---------------------------------------------------------------------------

create table if not exists public.communications (
  id                        uuid primary key default gen_random_uuid(),

  -- identité Gmail (§4.1, §18). `gmail_thread_id` est le signal de
  -- rattachement le plus fort du §3.7 et la seule définition possible du bloc
  -- « mails en attente de réponse » du §8.2 : dernier message du fil entrant,
  -- sans sortant postérieur DANS LE MÊME FIL.
  gmail_message_id          text not null,
  gmail_thread_id           text not null,
  message_id_rfc            text,
  en_reponse_a              text,
  references_rfc            jsonb not null default '[]'::jsonb,

  -- participants et contenu (§4.1, §18)
  expediteur                text not null default '',
  expediteur_adresse        text not null default '',
  destinataires             jsonb not null default '[]'::jsonb,
  copies                    jsonb not null default '[]'::jsonb,
  objet                     text not null default '',
  corps_extrait             text,
  libelles                  jsonb not null default '[]'::jsonb,
  direction                 text not null default 'entrant',
  nb_pieces_jointes         integer not null default 0,
  envoye_le                 timestamptz,
  recu_le                   timestamptz,

  -- résumé automatique (§5.3) : produit par l'Edge Function du livrable A.6,
  -- jamais par le navigateur. C'est un BROUILLON, et l'écran doit le dire.
  resume                    text,
  resume_le                 timestamptz,

  -- rattachement au projet (§5.1, §3.7) — même patron proposé / humain /
  -- effectif que les axes. Le CDC est explicite : « le rattachement
  -- automatique doit être modifiable ».
  projet_id_propose         text,
  projet_id_valide          text,
  confiance_rattachement    real,
  raisons_rattachement      jsonb not null default '[]'::jsonb,
  rattache_par              text,
  rattache_le               timestamptz,

  -- les trois axes du §5.2 : six colonnes stockées, trois générées
  phase_proposee            public.phase_echange,
  phase                     public.phase_echange,
  type_echange_propose      public.type_echange,
  type_echange              public.type_echange,
  importance_proposee       public.niveau_importance,
  importance                public.niveau_importance,
  confiance_categorisation  real,
  raisons_categorisation    jsonb not null default '[]'::jsonb,
  categorise_par            text,
  categorise_le             timestamptz,

  -- traitement (§3.12, §8.1) : nominatif et daté, à la place du statut binaire
  -- de `Courrier`. Un message traité reste dans la mémoire du projet.
  traite_par                text,
  traite_le                 timestamptz,

  cree_le                   timestamptz not null default now(),
  maj_le                    timestamptz not null default now()
);

alter table public.communications
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists gmail_message_id text,
  add column if not exists gmail_thread_id text,
  add column if not exists message_id_rfc text,
  add column if not exists en_reponse_a text,
  add column if not exists references_rfc jsonb not null default '[]'::jsonb,
  add column if not exists expediteur text not null default '',
  add column if not exists expediteur_adresse text not null default '',
  add column if not exists destinataires jsonb not null default '[]'::jsonb,
  add column if not exists copies jsonb not null default '[]'::jsonb,
  add column if not exists objet text not null default '',
  add column if not exists corps_extrait text,
  add column if not exists libelles jsonb not null default '[]'::jsonb,
  add column if not exists direction text not null default 'entrant',
  add column if not exists nb_pieces_jointes integer not null default 0,
  add column if not exists envoye_le timestamptz,
  add column if not exists recu_le timestamptz,
  add column if not exists resume text,
  add column if not exists resume_le timestamptz,
  add column if not exists projet_id_propose text,
  add column if not exists projet_id_valide text,
  add column if not exists confiance_rattachement real,
  add column if not exists raisons_rattachement jsonb not null default '[]'::jsonb,
  add column if not exists rattache_par text,
  add column if not exists rattache_le timestamptz,
  add column if not exists phase_proposee public.phase_echange,
  add column if not exists phase public.phase_echange,
  add column if not exists type_echange_propose public.type_echange,
  add column if not exists type_echange public.type_echange,
  add column if not exists importance_proposee public.niveau_importance,
  add column if not exists importance public.niveau_importance,
  add column if not exists confiance_categorisation real,
  add column if not exists raisons_categorisation jsonb not null default '[]'::jsonb,
  add column if not exists categorise_par text,
  add column if not exists categorise_le timestamptz,
  add column if not exists traite_par text,
  add column if not exists traite_le timestamptz,
  add column if not exists cree_le timestamptz not null default now(),
  add column if not exists maj_le timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- 3. Les colonnes GÉNÉRÉES — la règle « proposé / validé », une seule fois
--
-- Elles sont ajoutées à part parce qu'`add column if not exists` ne peut pas
-- porter `generated always as … stored` de façon rejouable sur une base où la
-- colonne existerait avec une autre expression : on la teste avant.
--
-- La bascule est portée par `categorise_par` (respectivement `rattache_par`) :
-- tant qu'il est nul, la proposition de la machine s'affiche ; dès qu'un
-- humain a signé, seule sa valeur compte, VIDE COMPRISE. C'est ce qui rend une
-- correction durable — et c'est le seul point du schéma où « la machine
-- propose, l'humain valide » cesse d'être une convention d'écran.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'communications'
       and column_name = 'projet_id'
  ) then
    alter table public.communications
      add column projet_id text
        generated always as (
          case when rattache_par is not null then projet_id_valide else projet_id_propose end
        ) stored;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'communications'
       and column_name = 'phase_effective'
  ) then
    alter table public.communications
      add column phase_effective text
        generated always as (
          case when categorise_par is not null then phase else coalesce(phase, phase_proposee) end
        ) stored;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'communications'
       and column_name = 'type_echange_effectif'
  ) then
    alter table public.communications
      add column type_echange_effectif text
        generated always as (
          case when categorise_par is not null then type_echange else coalesce(type_echange, type_echange_propose) end
        ) stored;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'communications'
       and column_name = 'importance_effective'
  ) then
    alter table public.communications
      add column importance_effective text
        generated always as (
          case when categorise_par is not null then importance else coalesce(importance, importance_proposee) end
        ) stored;
  end if;
end $$;

comment on column public.communications.projet_id is
  'Projet EFFECTIF : le choix humain dès qu''il y en a eu un (rattache_par renseigné), la proposition de la machine sinon. Colonne générée — aucun écran ne réimplémente la règle, aucun ne peut en diverger. NULL = la file « à rattacher » du §5.1.';
comment on column public.communications.phase_effective is
  'Phase EFFECTIVE (§5.2). Générée : valeur humaine dès que categorise_par est renseigné — y compris vide, ce qui rend un axe délibérément effacé durable — proposition de la machine sinon.';
comment on column public.communications.type_echange_effectif is
  'Type d''échange EFFECTIF (§5.2). Même règle que phase_effective.';
comment on column public.communications.importance_effective is
  'Niveau d''importance EFFECTIF (§5.2). Même règle. Se projette sur la gravité 1-3 par graviteDe() (src/categorisation.ts) : la projection n''est pas refaite en base, l''échelle des alertes a un seul propriétaire.';

comment on column public.communications.gmail_message_id is
  'Identifiant Gmail du message. Clé d''unicité de l''index : ré-ingérer un message le met à jour, jamais en double.';
comment on column public.communications.gmail_thread_id is
  'Fil de discussion Gmail (§4.1). Signal de rattachement le plus fort du §3.7 et seule définition possible de « en attente de réponse » (§8.2).';
comment on column public.communications.direction is
  'entrant (reçu par l''agence) ou sortant (émis par elle). Vient du libellé SENT puis du registre public.membres — jamais d''une adresse écrite en dur.';
comment on column public.communications.corps_extrait is
  'Début du corps, BORNÉ. Cockpit tient un index, pas une copie de Gmail (§4.3).';
comment on column public.communications.resume is
  'Résumé automatique du §5.3, produit par l''Edge Function du livrable A.6. BROUILLON : l''écran doit le présenter comme tel (§15).';
comment on column public.communications.traite_le is
  'Marqueur de traitement du §3.12, qui remplace Courrier.statut. Nominatif (traite_par) et daté, donc journalisable — ce qu''un statut binaire ne permet pas.';
comment on column public.communications.nb_pieces_jointes is
  'Nombre de pièces retenues du message. Les pièces elles-mêmes restent dans public.entrants, avec leur circuit de validation propre : cette colonne dit qu''il y en a, elle ne les redécrit pas.';

-- Le domaine du sens est fermé en base : une troisième valeur casserait
-- silencieusement tout filtre « entrant / sortant » écrit au-dessus, à
-- commencer par le sélecteur `mailsEnAttenteDeReponse()` du livrable A.12.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'communications_direction_chk'
       and conrelid = 'public.communications'::regclass
  ) then
    alter table public.communications
      add constraint communications_direction_chk
      check (direction in ('entrant', 'sortant'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Index — un par lecture réelle, aucun décoratif
-- ---------------------------------------------------------------------------

create unique index if not exists communications_pkey
  on public.communications (id);

-- L'unicité qui rend l'ingestion IDEMPOTENTE : rejouer une tranche, redescendre
-- le curseur, relancer un scan à la main ne créent jamais de doublon. C'est le
-- patron d'`entrants_source_unq`, et c'est aussi ce sur quoi porte l'`upsert`
-- de la fonction d'ingestion.
create unique index if not exists communications_gmail_message_unq
  on public.communications (gmail_message_id);

-- « tous les échanges de ce projet, du plus récent au plus ancien » — la
-- mémoire projet du §4.3, l'onglet Échanges de la fiche projet.
create index if not exists communications_projet_envoi_idx
  on public.communications (projet_id, envoye_le desc);

-- « tout ce fil » (§4.2), et « ce fil a-t-il reçu une réponse » (§8.2, A.12).
create index if not exists communications_thread_idx
  on public.communications (gmail_thread_id, envoye_le desc);

-- §8.2 « urgent » et §8.1 : les échanges d'un projet par importance.
create index if not exists communications_projet_importance_idx
  on public.communications (projet_id, importance_effective, envoye_le desc);

-- §13.1 : la recherche par phase, que l'axe rend enfin possible.
create index if not exists communications_projet_phase_idx
  on public.communications (projet_id, phase_effective);

-- §8.1 « mails à traiter » : la file du jour, tous projets confondus. Index
-- PARTIEL — la file est petite et le reste de la table ne la concerne pas.
create index if not exists communications_a_traiter_idx
  on public.communications (envoye_le desc)
  where traite_le is null and direction = 'entrant';

-- ---------------------------------------------------------------------------
-- 5. Estampille de mise à jour
-- ---------------------------------------------------------------------------

create or replace function public.communications_touche_maj_le()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  new.maj_le := now();
  return new;
end
$$;

drop trigger if exists communications_maj_le on public.communications;
create trigger communications_maj_le
  before update on public.communications
  for each row
  execute function public.communications_touche_maj_le();

-- ---------------------------------------------------------------------------
-- 6. Le refus d'écriture d'une proposition (§3.14, décision 2)
--
-- Le GRANT au niveau colonne suffirait techniquement. Ce trigger existe pour
-- deux raisons qu'un GRANT ne couvre pas : il survit à un GRANT élargi par
-- inadvertance dans une migration future, et il DIT ce qu'il faut corriger à
-- la place. Une erreur « permission denied for table communications » n'aurait
-- envoyé personne vers la bonne colonne.
--
-- `security invoker` est délibéré : c'est `current_user` — le rôle réellement
-- en train d'écrire, positionné par PostgREST — qui décide. En `security
-- definer`, `current_user` serait le propriétaire de la fonction, et le
-- contrôle ne contrôlerait plus rien.
-- ---------------------------------------------------------------------------

create or replace function public.communications_refus_proposition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if new.gmail_message_id       is distinct from old.gmail_message_id
     or new.gmail_thread_id     is distinct from old.gmail_thread_id
     or new.projet_id_propose   is distinct from old.projet_id_propose
     or new.confiance_rattachement is distinct from old.confiance_rattachement
     or new.raisons_rattachement   is distinct from old.raisons_rattachement
     or new.phase_proposee      is distinct from old.phase_proposee
     or new.type_echange_propose   is distinct from old.type_echange_propose
     or new.importance_proposee is distinct from old.importance_proposee
     or new.confiance_categorisation is distinct from old.confiance_categorisation
     or new.raisons_categorisation   is distinct from old.raisons_categorisation
     or new.resume              is distinct from old.resume
  then
    raise exception
      'Ce que la machine a proposé ne se réécrit pas : corrigez la colonne humaine (projet_id_valide, phase, type_echange, importance) et signez (rattache_par / categorise_par). La proposition reste la trace de ce qui a été proposé.'
      using errcode = '42501';
  end if;

  return new;
end
$$;

drop trigger if exists communications_propositions_intactes on public.communications;
create trigger communications_propositions_intactes
  before update on public.communications
  for each row
  execute function public.communications_refus_proposition();

-- Appelable par une session du navigateur : c'est elle qui déclenche le
-- trigger. Appelée hors trigger, la fonction échoue d'elle-même — PostgreSQL
-- refuse d'exécuter une fonction `returns trigger` en dehors d'un trigger.
revoke all on function public.communications_touche_maj_le()   from public, anon;
revoke all on function public.communications_refus_proposition() from public, anon;
grant execute on function public.communications_touche_maj_le()   to authenticated, service_role;
grant execute on function public.communications_refus_proposition() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Accès — le registre des membres, aucune adresse littérale
-- ---------------------------------------------------------------------------

alter table public.communications enable row level security;

drop policy if exists "agence lecture"        on public.communications;
drop policy if exists "agence categorisation" on public.communications;

create policy "agence lecture"
  on public.communications
  for select
  to authenticated
  using ((select public.est_membre_actif()));

-- Corriger un rattachement, un axe, ou marquer un message traité : c'est le
-- « modifiable » du §5.1 et le « modifiées » du critère 11. Un membre en
-- lecture seule lit et ne corrige pas.
create policy "agence categorisation"
  on public.communications
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

revoke all on table public.communications from anon, authenticated;
grant select on table public.communications to authenticated;

-- LE GRANT AU NIVEAU COLONNE. C'est lui qui fait de « la machine ne peut pas
-- écrire un axe validé, l'humain peut toujours corriger » deux droits
-- distincts et vérifiables, et non deux comportements d'interface qu'un module
-- peut contourner. Toute colonne absente de cette liste est en lecture seule
-- pour le navigateur.
grant update (
    projet_id_valide,
    rattache_par,
    rattache_le,
    phase,
    type_echange,
    importance,
    categorise_par,
    categorise_le,
    traite_par,
    traite_le
  )
  on table public.communications
  to authenticated;

grant select, insert, update, delete on table public.communications to service_role;

-- ---------------------------------------------------------------------------
-- 8. Contrôle final — la migration se refuse à mentir sur ce qu'elle a fait
--
-- Aucun de ces défauts ne produirait d'erreur visible : une colonne générée
-- absente rendrait `phase_effective` introuvable et tous les écrans vides ; un
-- droit d'écriture accordé sur une colonne de proposition ouvrirait au
-- navigateur la réécriture de ce que la machine a proposé, en silence.
-- ---------------------------------------------------------------------------

do $$
declare
  v_manquantes text[] := '{}';
  v_colonne    text;
  v_fautives   text[];
begin
  foreach v_colonne in array array[
    'gmail_message_id', 'gmail_thread_id', 'message_id_rfc', 'en_reponse_a',
    'references_rfc', 'expediteur', 'expediteur_adresse', 'destinataires',
    'copies', 'objet', 'corps_extrait', 'libelles', 'direction',
    'nb_pieces_jointes', 'envoye_le', 'recu_le', 'resume', 'resume_le',
    'projet_id_propose', 'projet_id_valide', 'confiance_rattachement',
    'raisons_rattachement', 'rattache_par', 'rattache_le',
    'phase_proposee', 'phase', 'type_echange_propose', 'type_echange',
    'importance_proposee', 'importance', 'confiance_categorisation',
    'raisons_categorisation', 'categorise_par', 'categorise_le',
    'traite_par', 'traite_le', 'projet_id', 'phase_effective',
    'type_echange_effectif', 'importance_effective'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'communications'
         and column_name = v_colonne
    ) then
      v_manquantes := v_manquantes || v_colonne;
    end if;
  end loop;

  if array_length(v_manquantes, 1) > 0 then
    raise exception
      'public.communications : colonnes absentes après migration (%). Ne déployez pas gmail-ingestion : ses insertions échoueraient à chaque passage.',
      array_to_string(v_manquantes, ', ')
      using errcode = 'P0001';
  end if;

  -- Les quatre colonnes effectives doivent être GÉNÉRÉES. Écrites à la main
  -- par une Edge Function, elles diraient un jour autre chose que la règle.
  select array_agg(column_name order by column_name) into v_fautives
    from information_schema.columns
   where table_schema = 'public' and table_name = 'communications'
     and column_name in ('projet_id', 'phase_effective', 'type_echange_effectif', 'importance_effective')
     and is_generated <> 'ALWAYS';
  if v_fautives is not null then
    raise exception
      'public.communications : % ne sont pas des colonnes générées. La règle « proposé / validé » serait réimplémentée ailleurs, et divergerait.',
      array_to_string(v_fautives, ', ')
      using errcode = 'P0001';
  end if;

  -- Aucun droit d'écriture au navigateur sur une colonne que la machine
  -- renseigne. C'est la garantie structurelle du §15.
  select array_agg(distinct column_name order by column_name) into v_fautives
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'communications'
     and grantee = 'authenticated' and privilege_type = 'UPDATE'
     and (column_name like '%propos%' or column_name like 'confiance_%'
          or column_name like 'raisons_%' or column_name = 'resume'
          or column_name like 'gmail_%');
  if v_fautives is not null then
    raise exception
      'public.communications : le navigateur a reçu update sur % — une proposition de la machine ne se réécrit pas depuis l''écran (§3.14, critère 11).',
      array_to_string(v_fautives, ', ')
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'communications' and c.relrowsecurity
  ) then
    raise exception 'public.communications : RLS désactivée.' using errcode = 'P0001';
  end if;
end $$;
