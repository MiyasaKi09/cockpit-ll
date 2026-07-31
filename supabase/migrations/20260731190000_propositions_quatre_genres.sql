-- Livrable A.9 — `public.propositions`, la table à QUATRE GENRES.
--
-- POURQUOI CETTE TABLE, ET POURQUOI ELLE EST LE VERROU DU §15
-- -----------------------------------------------------------
-- Les points 5 à 8 du §12.3 demandent de détecter, dans un message, des
-- tâches, des échéances, des décisions et des risques. Le §3.14 (décision 3)
-- tranche : une seule table, un `genre`, une `charge_utile` typée par genre.
--
-- Mais sa raison d'être n'est pas l'économie de trois tables. C'est que le §15
-- — « l'IA ne doit pas confirmer seule une décision contractuelle, ni créer une
-- échéance juridique sans confirmation » — cesse ici d'être une convention
-- d'écran pour devenir une propriété du schéma :
--
--   1. le domaine de `statut` ne contient AUCUN statut métier. Ni « confirmee »,
--      ni « validee », ni « contestee », ni « a_verifier », ni « annulee » —
--      les cinq statuts du §6.2 appartiennent à l'entité `decisions`, qui est
--      le livrable 2.1 et n'existe pas. Seulement `proposee` / `acceptee` /
--      `ignoree`. Une proposition ne PEUT donc pas devenir la décision qu'elle
--      propose : le type ne l'exprime pas ;
--   2. une proposition acceptée DÉSIGNE l'objet que l'humain a créé
--      (`objet_cree_type`, `objet_cree_id`) au lieu de le devenir. La
--      contrainte est une équivalence, pas une politesse : `statut = 'acceptee'`
--      si et seulement si un objet est désigné ;
--   3. rien ne quitte l'état `proposee` sans SIGNATURE (`traite_par` non vide,
--      `traite_le` daté). C'est ce qui rend l'expiration structurellement
--      impossible : un délai qui « accepterait par défaut » devrait inventer un
--      nom de personne pour y parvenir. Aucun `default`, aucun trigger et
--      aucune tâche planifiée ne touche `statut` — c'est vérifié plus bas ;
--   4. les destinations sont fermées à `tache` et `contact` (§3.14, décision 4).
--      Une échéance proposée ne peut renseigner qu'une `TacheInterne.echeance`
--      ou un `Contact.dateProchaineAction`. Elle ne peut créer NI `Obligation`
--      — qui déclenche le rappel réglementaire de gravité 3 de `src/alerts.ts`
--      — NI `EcheanceFacturation`, qui commande l'émission d'une facture. Ces
--      deux entités-là SONT des échéances juridiques et financières. Le chemin
--      n'existe pas, pas même par bug applicatif.
--
-- L'EXTRAIT CITÉ EST OBLIGATOIRE
-- ------------------------------
-- `extrait text not null`, non vide, borné. Le §13.3 et le §4.2 sont explicites :
-- un lien vers le message ne suffit pas, il faut la PHRASE qui porte la
-- détection. Une proposition sans extrait est invérifiable — on ne peut ni la
-- confirmer ni la contredire sans rouvrir Gmail et relire tout le fil, ce que
-- personne ne fait. Le contrat des modules dit la même chose autrement : « une
-- réponse sans source est un défaut, pas une approximation ».
--
-- CE QUE CETTE TABLE NE PORTE PAS, DÉLIBÉRÉMENT
-- ---------------------------------------------
--   * pas de `projet_id`. Il vit sur `communications`, où c'est une colonne
--     GÉNÉRÉE que la correction humaine d'un rattachement fait basculer. Le
--     recopier ici en ferait une valeur figée le jour de la détection : un
--     message rerattaché laisserait ses propositions sur l'ancien projet, sans
--     erreur. `src/propositions.ts` le lit PAR JOINTURE ;
--   * pas de copie du message. `communication_id` désigne la ligne d'index, qui
--     désigne elle-même le message dans Gmail (§4.3 : Cockpit tient un index) ;
--   * pas de `responsable` en colonne. Le responsable SUGGÉRÉ du §8.7 vit dans
--     `charge_utile->>'responsable'` : c'est la trace de ce qu'une machine a
--     proposé, pas la désignation d'une personne. Il ne suit donc PAS un
--     renommage dans les Paramètres — l'inventaire de `src/personnes.ts` porte
--     les champs qui désignent la personne (`responsable` d'une tâche, `pour`),
--     pas les traces datées de ce qui a été proposé ou fait ce jour-là. C'est
--     la tâche créée à l'acceptation, dans `state.taches` (livrable B.1), qui
--     entrera dans cet inventaire ;
--   * pas d'`ecriture_id`. Le navigateur n'INSÈRE jamais ici (l'`insert` est
--     réservé au `service_role`) : ses écritures sont des `update` visant la
--     clé primaire, donc idempotentes par construction. La clé d'idempotence
--     dont cette table a besoin est celle de la DÉTECTION, et c'est
--     `propositions_detection_unq`, sur le patron d'`entrants_source_unq`.
--
-- ORDRE D'APPLICATION
-- -------------------
-- Après 20260730180000 (le registre des membres, dont les fonctions
-- d'autorisation sont appelées ici) et 20260731150000 (`communications`, que la
-- clé étrangère référence). Elle n'est suivie d'AUCUN déploiement : les
-- détecteurs qui la remplissent sont le livrable A.10, les écrans qui la lisent
-- sont B.10 et B.11. Une table vide ne casse rien ; une table absente ferait
-- échouer chaque passage du détecteur, sans autre trace que les journaux.

-- ---------------------------------------------------------------------------
-- 1. Les quatre listes fermées, transcrites de src/propositions.ts
--
-- Un domaine par liste, pour la même raison qu'au livrable A.2 : la liste des
-- destinations sert DEUX fois (la colonne `objet_cree_type` et la clé `cible`
-- d'une charge utile d'échéance), et deux listes recopiées dans le même fichier
-- divergent au premier ajout.
--
-- Ne rien écrire d'autre entre les repères : `scripts/test-propositions-
-- modifiables.cjs` lit les listes ENTRE EUX et les compare au module. Un
-- commentaire y est toléré, une valeur inventée non.
-- ---------------------------------------------------------------------------

-- [PROPOSITIONS-A9:DEBUT]

-- Les quatre genres du §12.3 (points 5 à 8). Une seule table : le §3.14
-- (décision 3) l'a tranché contre l'intuition des quatre tables.
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'genre_proposition' and n.nspname = 'public'
  ) then
    create domain public.genre_proposition as text
      check (value in ('tache', 'echeance', 'decision', 'risque'));
  end if;
end $$;

-- Le statut d'une PROPOSITION, et rien d'autre. Aucun statut métier : les cinq
-- statuts de décision du §6.2 (proposée, à vérifier, confirmée, contestée,
-- annulée) appartiennent à l'entité `decisions` du livrable 2.1. Les faire
-- entrer ici ferait de cette table la mémoire des décisions de l'agence, ce
-- qu'une détection automatique n'a pas vocation à être.
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'statut_proposition' and n.nspname = 'public'
  ) then
    create domain public.statut_proposition as text
      check (value in ('proposee', 'acceptee', 'ignoree'));
  end if;
end $$;

-- Les deux SEULES destinations d'une proposition acceptée (§3.14, décision 4).
-- Ni `obligation` ni `echeance_facturation` : ce sont des échéances juridiques
-- et financières, et le §15 interdit de les créer sans confirmation. Le Lot 2
-- élargira ce domaine le jour où `decisions` (2.1) et les risques qualifiés
-- (2.3) auront une entité de destination — pas avant.
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'objet_propose' and n.nspname = 'public'
  ) then
    create domain public.objet_propose as text
      check (value in ('tache', 'contact'));
  end if;
end $$;

-- Les QUATRE natures de risque que `computeAlertes()` ne peut pas voir. Le
-- §6.3 en liste neuf ; cinq sont DÉJÀ produites par `src/alerts.ts` (retard
-- potentiel et échéance imminente par `echeance_rendu` et `obligation`, budget
-- dépassé par `derive_heures`, absence de validation par
-- `situation_a_verifier`, dépendance à un tiers par `situation_manquante`). Les
-- redétecter depuis les mails doublerait chaque risque dans la fiche projet —
-- c'est le « point dur » nommé au §3.14, et il est fermé ici plutôt que confié
-- à la discipline du détecteur.
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'nature_risque' and n.nspname = 'public'
  ) then
    create domain public.nature_risque as text
      check (value in (
        'demande_contradictoire', 'modification_de_programme',
        'reserve_technique', 'responsabilite_non_attribuee'
      ));
  end if;
end $$;

-- [PROPOSITIONS-A9:FIN]

comment on domain public.genre_proposition is
  'Les quatre genres du CDC §12.3 pts 5-8. Transcription de GENRES_PROPOSITION (src/propositions.ts) : une valeur ajoutée ici doit l''être là-bas, et réciproquement.';
comment on domain public.statut_proposition is
  'Statut d''une PROPOSITION. Ne contient aucun statut métier (§3.14, décision 3) : une proposition ne peut pas devenir la décision ou la tâche qu''elle propose, le type ne l''exprime pas.';
comment on domain public.objet_propose is
  'Les deux seules destinations d''une proposition acceptée (§3.14, décision 4). Jamais Obligation ni EcheanceFacturation : ce sont des échéances juridiques et financières, que le §15 interdit de créer sans confirmation.';
comment on domain public.nature_risque is
  'Les quatre natures de risque que computeAlertes() ne voit pas (§6.3, §3.14). Les cinq autres sont déjà produites par src/alerts.ts : les redétecter depuis les mails doublerait chaque risque dans la fiche projet.';

-- ---------------------------------------------------------------------------
-- 2. La table
--
-- Même patron qu'`entrants` et `communications` : création complète, puis
-- `add column if not exists` colonne par colonne, pour qu'une base où une
-- ébauche existerait déjà converge au lieu d'échouer.
-- ---------------------------------------------------------------------------

create table if not exists public.propositions (
  id                uuid primary key default gen_random_uuid(),

  -- LE message d'où sort la détection. `on delete cascade` : une proposition
  -- privée de son message serait une affirmation sans source.
  communication_id  uuid not null references public.communications (id) on delete cascade,

  genre             public.genre_proposition not null,

  -- charge utile TYPÉE PAR GENRE — voir la contrainte plus bas. Volontairement
  -- jsonb : les quatre genres n'ont pas les mêmes champs, et quatre jeux de
  -- colonnes nullables auraient rendu tout INSERT valide.
  charge_utile      jsonb not null default '{}'::jsonb,

  -- LA PHRASE du message qui porte la détection (§13.3, §4.2). Obligatoire :
  -- une proposition sans extrait est invérifiable.
  extrait           text not null,

  confiance         real,
  raisons           jsonb not null default '[]'::jsonb,

  -- quel ÉTAGE a détecté (§3.14, décision 5 : « deux étages, déterministe hors
  -- ligne d'abord, modèle ensuite »). L'écran doit pouvoir le dire : « un
  -- modèle a lu ce message » n'est pas la même information que « un marqueur
  -- d'action a été reconnu ».
  origine           text not null default 'lexique',

  -- le statut de la PROPOSITION, jamais celui de l'objet proposé
  statut            public.statut_proposition not null default 'proposee',

  -- ce que l'humain a créé, et que la proposition se contente de DÉSIGNER
  objet_cree_type   public.objet_propose,
  objet_cree_id     text,

  -- qui a tranché, et quand. Sans eux, rien ne quitte l'état `proposee`.
  traite_par        text,
  traite_le         timestamptz,

  -- clé d'idempotence de la DÉTECTION, sur le patron d'`entrants_source_unq` :
  -- empreinte stable de ce qui a été détecté dans ce message. Rejouer un
  -- détecteur, redescendre un curseur ou relancer un scan à la main ne doit pas
  -- proposer deux fois la même chose — la file de revue du §8.7 deviendrait
  -- inutilisable en une semaine.
  empreinte         text,

  cree_le           timestamptz not null default now(),
  maj_le            timestamptz not null default now()
);

-- Les trois colonnes obligatoires sont ajoutées SANS `not null` ici : sur une
-- base où une ébauche de table existerait déjà avec des lignes, `add column
-- … not null` sans valeur par défaut échouerait. Le `not null` est reposé juste
-- après, quand les données le permettent, et le contrôle final refuse la
-- migration s'il manque.
alter table public.propositions
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists communication_id uuid,
  add column if not exists genre public.genre_proposition,
  add column if not exists charge_utile jsonb not null default '{}'::jsonb,
  add column if not exists extrait text,
  add column if not exists confiance real,
  add column if not exists raisons jsonb not null default '[]'::jsonb,
  add column if not exists origine text not null default 'lexique',
  add column if not exists statut public.statut_proposition not null default 'proposee',
  add column if not exists objet_cree_type public.objet_propose,
  add column if not exists objet_cree_id text,
  add column if not exists traite_par text,
  add column if not exists traite_le timestamptz,
  add column if not exists empreinte text,
  add column if not exists cree_le timestamptz not null default now(),
  add column if not exists maj_le timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from public.propositions
     where communication_id is null or genre is null or extrait is null
  ) then
    alter table public.propositions alter column communication_id set not null;
    alter table public.propositions alter column genre set not null;
    alter table public.propositions alter column extrait set not null;
  end if;
end $$;

comment on table public.propositions is
  'Détections de tâches, échéances, décisions et risques dans les messages (CDC §12.3 pts 5-8). Une proposition n''est JAMAIS l''objet qu''elle propose, et ne le devient pas par expiration : elle le désigne (objet_cree_type / objet_cree_id) une fois qu''un humain l''a créé. C''est la forme structurelle du §15.';
comment on column public.propositions.communication_id is
  'Le message d''où sort la détection. Le projet, lui, n''est PAS recopié : il est lu par jointure sur communications.projet_id, colonne générée qu''une correction de rattachement fait basculer.';
comment on column public.propositions.charge_utile is
  'Contenu de la proposition, typé par genre (voir propositions_charge_utile_chk). Ne peut pas porter de clé « statut » : un statut métier caché dans le jsonb annulerait la garantie du domaine.';
comment on column public.propositions.extrait is
  'LA PHRASE du message qui porte la détection (§13.3, §4.2). Obligatoire : un lien ne suffit pas, et une proposition sans extrait est invérifiable.';
comment on column public.propositions.origine is
  'Quel étage a détecté : « lexique » (déterministe, hors ligne) ou « modele » (§3.14, décision 5). L''écran doit pouvoir le dire.';
comment on column public.propositions.statut is
  'proposee / acceptee / ignoree — et rien d''autre. Aucun statut métier n''entre ici.';
comment on column public.propositions.objet_cree_type is
  'Ce que l''humain a créé à l''acceptation : une tâche ou un contact. Jamais une Obligation ni une EcheanceFacturation (§3.14, décision 4).';
comment on column public.propositions.traite_par is
  'Qui a accepté ou ignoré. Trace datée du geste, PAS une désignation de personne : elle n''entre pas dans l''inventaire de src/personnes.ts et ne suit pas un renommage.';
comment on column public.propositions.empreinte is
  'Clé d''idempotence de la détection, sur le patron d''entrants_source_unq : rejouer un détecteur ne propose pas deux fois la même chose.';

-- ---------------------------------------------------------------------------
-- 3. Les contraintes — c'est ici que le §15 devient structurel
-- ---------------------------------------------------------------------------

do $$
begin
  -- (a) L'extrait cité, obligatoire et borné. Cockpit tient un index, pas une
  -- copie de Gmail : la phrase qui porte la détection suffit.
  if not exists (
    select 1 from pg_constraint
     where conname = 'propositions_extrait_chk' and conrelid = 'public.propositions'::regclass
  ) then
    alter table public.propositions
      add constraint propositions_extrait_chk
      check (length(btrim(extrait)) between 1 and 2000);
  end if;

  -- (b) Une confiance hors de [0, 1] ne veut rien dire, et se rendrait
  -- invisible dans un badge.
  if not exists (
    select 1 from pg_constraint
     where conname = 'propositions_confiance_chk' and conrelid = 'public.propositions'::regclass
  ) then
    alter table public.propositions
      add constraint propositions_confiance_chk
      check (confiance is null or (confiance >= 0 and confiance <= 1));
  end if;

  -- (c) Les deux étages du §3.14, décision 5, et aucun troisième.
  if not exists (
    select 1 from pg_constraint
     where conname = 'propositions_origine_chk' and conrelid = 'public.propositions'::regclass
  ) then
    alter table public.propositions
      add constraint propositions_origine_chk
      check (origine in ('lexique', 'modele'));
  end if;

  -- (d) LA CHARGE UTILE EST TYPÉE PAR GENRE. Sans cette contrainte, `jsonb`
  -- rendrait tout INSERT valide et le genre ne serait qu'une étiquette : un
  -- risque sans nature, une échéance sans date, une tâche sans titre
  -- s'afficheraient vides dans la file de revue, sans que rien ne le signale.
  --
  -- Les valeurs fermées passent par un CAST vers le domaine plutôt que par une
  -- seconde liste littérale : deux listes recopiées dans le même fichier
  -- divergent au premier ajout. Conséquence assumée : une valeur hors liste
  -- échoue avec l'erreur du DOMAINE et non avec le nom de cette contrainte —
  -- c'est le meilleur des deux messages, il nomme la liste qui a refusé.
  if not exists (
    select 1 from pg_constraint
     where conname = 'propositions_charge_utile_chk' and conrelid = 'public.propositions'::regclass
  ) then
    alter table public.propositions
      add constraint propositions_charge_utile_chk
      check (
        case genre
          -- §8.7 : « Tâche proposée » + « Responsable suggéré » + « Échéance
          -- détectée ». Seul le titre est exigé : une tâche sans responsable se
          -- corrige d'un clic, une tâche sans titre n'existe pas.
          when 'tache' then
            length(btrim(coalesce(charge_utile ->> 'titre', ''))) > 0
          -- §3.14, décision 4 : la cible est fermée à `tache` / `contact`, et
          -- la date est une date. Une échéance sans date n'est pas une échéance.
          when 'echeance' then
            (charge_utile ->> 'cible')::public.objet_propose is not null
            and coalesce(charge_utile ->> 'date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          -- §6.1 : ce qui a été décidé. Le « validée par » et la date restent
          -- facultatifs — un e-mail les donne rarement tous les deux.
          when 'decision' then
            length(btrim(coalesce(charge_utile ->> 'objet', ''))) > 0
          -- §6.3 restreint aux quatre natures que le moteur d'alertes ne voit
          -- pas (§3.14, « point dur »).
          when 'risque' then
            (charge_utile ->> 'nature')::public.nature_risque is not null
          else false
        end
      );
  end if;

  -- (e) AUCUN STATUT MÉTIER CACHÉ DANS LE JSONB. Fermer le domaine de `statut`
  -- et laisser `charge_utile->>'statut'` libre reviendrait à déplacer le
  -- problème d'une colonne à une clé : « confirmee » s'écrirait là, et la
  -- garantie du §3.14 (décision 3) serait décorative.
  if not exists (
    select 1 from pg_constraint
     where conname = 'propositions_sans_statut_metier_chk' and conrelid = 'public.propositions'::regclass
  ) then
    alter table public.propositions
      add constraint propositions_sans_statut_metier_chk
      check (not jsonb_exists(charge_utile, 'statut'));
  end if;

  -- (f) ACCEPTÉE SI ET SEULEMENT SI UN OBJET EST DÉSIGNÉ. C'est l'équivalence
  -- qui interdit qu'une proposition « devienne » l'objet : accepter, c'est
  -- pointer vers ce qu'un humain a créé, jamais se transformer.
  if not exists (
    select 1 from pg_constraint
     where conname = 'propositions_objet_cree_chk' and conrelid = 'public.propositions'::regclass
  ) then
    alter table public.propositions
      add constraint propositions_objet_cree_chk
      check (
        (statut = 'acceptee') = (objet_cree_type is not null)
        and (objet_cree_type is null) = (objet_cree_id is null)
        and (objet_cree_id is null or length(btrim(objet_cree_id)) > 0)
      );
  end if;

  -- (g) RIEN NE QUITTE `proposee` SANS SIGNATURE. C'est ce qui rend
  -- l'expiration structurellement impossible : un délai qui « accepterait par
  -- défaut » devrait inventer un nom de personne pour y parvenir. Et c'est
  -- réversible dans l'autre sens : rouvrir efface la signature avec le statut.
  if not exists (
    select 1 from pg_constraint
     where conname = 'propositions_signature_chk' and conrelid = 'public.propositions'::regclass
  ) then
    alter table public.propositions
      add constraint propositions_signature_chk
      check (
        case statut
          when 'proposee' then traite_par is null and traite_le is null
          else traite_par is not null and btrim(traite_par) <> '' and traite_le is not null
        end
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Index — un par lecture réelle, aucun décoratif
-- ---------------------------------------------------------------------------

create unique index if not exists propositions_pkey
  on public.propositions (id);

-- L'unicité qui rend la DÉTECTION idempotente. Patron d'`entrants_source_unq`,
-- partiel pour la même raison : une proposition sans empreinte (saisie
-- manuelle future, reprise) reste possible et n'entre pas dans l'unicité.
create unique index if not exists propositions_detection_unq
  on public.propositions (communication_id, genre, empreinte)
  where empreinte is not null;

-- La file de revue du §8.7 : ce qui attend une décision humaine, du plus récent
-- au plus ancien. Index PARTIEL — la file est petite, et tout ce qui a été
-- tranché ne la concerne plus.
create index if not exists propositions_a_revoir_idx
  on public.propositions (cree_le desc)
  where statut = 'proposee';

-- « les propositions de ce message », et la jointure par laquelle la fiche
-- projet du §6.3 remonte ses risques : c'est `communications.projet_id` qui
-- porte le projet, donc la lecture part toujours de ce côté-ci.
create index if not exists propositions_communication_idx
  on public.propositions (communication_id, genre);

-- ---------------------------------------------------------------------------
-- 5. Estampille de mise à jour
-- ---------------------------------------------------------------------------

create or replace function public.propositions_touche_maj_le()
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

drop trigger if exists propositions_maj_le on public.propositions;
create trigger propositions_maj_le
  before update on public.propositions
  for each row
  execute function public.propositions_touche_maj_le();

-- ---------------------------------------------------------------------------
-- 6. Le refus de réécriture de ce qui a été détecté (§3.14, décision 2)
--
-- Même patron, même motif qu'`communications_refus_proposition` : le GRANT au
-- niveau colonne suffirait techniquement, mais ce trigger survit à un GRANT
-- élargi par inadvertance dans une migration future, et il DIT ce qu'il faut
-- corriger à la place.
--
-- `security invoker` est délibéré : c'est `current_user` — le rôle réellement
-- en train d'écrire, positionné par PostgREST — qui décide. En `security
-- definer`, `current_user` serait le propriétaire de la fonction, et le
-- contrôle ne contrôlerait plus rien.
-- ---------------------------------------------------------------------------

create or replace function public.propositions_refus_reecriture()
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

  if new.communication_id is distinct from old.communication_id
     or new.genre        is distinct from old.genre
     or new.charge_utile is distinct from old.charge_utile
     or new.extrait      is distinct from old.extrait
     or new.confiance    is distinct from old.confiance
     or new.raisons      is distinct from old.raisons
     or new.origine      is distinct from old.origine
     or new.empreinte    is distinct from old.empreinte
     or new.cree_le      is distinct from old.cree_le
  then
    raise exception
      'Ce qui a été détecté ne se réécrit pas : acceptez la proposition en désignant l''objet créé (objet_cree_type / objet_cree_id), ou ignorez-la, et signez (traite_par). L''extrait, la confiance et les raisons restent la trace de ce qui a été proposé.'
      using errcode = '42501';
  end if;

  return new;
end
$$;

drop trigger if exists propositions_detection_intacte on public.propositions;
create trigger propositions_detection_intacte
  before update on public.propositions
  for each row
  execute function public.propositions_refus_reecriture();

revoke all on function public.propositions_touche_maj_le()    from public, anon;
revoke all on function public.propositions_refus_reecriture() from public, anon;
grant execute on function public.propositions_touche_maj_le()    to authenticated, service_role;
grant execute on function public.propositions_refus_reecriture() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Accès — le registre des membres, aucune adresse littérale
-- ---------------------------------------------------------------------------

alter table public.propositions enable row level security;

drop policy if exists "agence lecture"      on public.propositions;
drop policy if exists "agence traitement"   on public.propositions;

create policy "agence lecture"
  on public.propositions
  for select
  to authenticated
  using ((select public.est_membre_actif()));

-- Accepter ou ignorer une proposition : c'est le « acceptées, modifiées ou
-- refusées » du critère 11. Un membre en lecture seule les lit et ne les tranche
-- pas.
create policy "agence traitement"
  on public.propositions
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

revoke all on table public.propositions from anon, authenticated;
grant select on table public.propositions to authenticated;

-- LE GRANT AU NIVEAU COLONNE, limité aux colonnes de TRAITEMENT. Le navigateur
-- ne peut réécrire ni le genre, ni la charge utile, ni l'extrait, ni la
-- confiance, ni les raisons : PostgreSQL le refuse, quel que soit le code de
-- l'écran. Toute colonne absente de cette liste est en lecture seule.
grant update (
    statut,
    objet_cree_type,
    objet_cree_id,
    traite_par,
    traite_le
  )
  on table public.propositions
  to authenticated;

-- L'`insert` est réservé au serveur : le navigateur ne fabrique pas de
-- proposition (§3.14, décision 3). Une détection naît d'un message, jamais d'un
-- écran.
grant select, insert, update, delete on table public.propositions to service_role;

-- ---------------------------------------------------------------------------
-- 8. Contrôle final — la migration se refuse à mentir sur ce qu'elle a fait
--
-- Aucun de ces défauts ne produirait d'erreur visible : un `not null` manquant
-- laisserait passer des propositions sans extrait, un droit d'écriture de trop
-- ouvrirait au navigateur la réécriture de ce qu'une machine a détecté, et un
-- statut métier glissé dans le domaine ferait de cette table la mémoire des
-- décisions de l'agence — en silence, dans les trois cas.
-- ---------------------------------------------------------------------------

do $$
declare
  v_manquantes text[] := '{}';
  v_colonne    text;
  v_fautives   text[];
  v_def        text;
  v_mot        text;
begin
  foreach v_colonne in array array[
    'id', 'communication_id', 'genre', 'charge_utile', 'extrait', 'confiance',
    'raisons', 'origine', 'statut', 'objet_cree_type', 'objet_cree_id',
    'traite_par', 'traite_le', 'empreinte', 'cree_le', 'maj_le'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'propositions'
         and column_name = v_colonne
    ) then
      v_manquantes := v_manquantes || v_colonne;
    end if;
  end loop;

  if array_length(v_manquantes, 1) > 0 then
    raise exception
      'public.propositions : colonnes absentes après migration (%). Les détecteurs du livrable A.10 échoueraient à chaque passage.',
      array_to_string(v_manquantes, ', ')
      using errcode = 'P0001';
  end if;

  -- Les trois colonnes sans lesquelles une proposition n'est pas traçable.
  select array_agg(column_name order by column_name) into v_fautives
    from information_schema.columns
   where table_schema = 'public' and table_name = 'propositions'
     and column_name in ('communication_id', 'genre', 'extrait')
     and is_nullable = 'YES';
  if v_fautives is not null then
    raise exception
      'public.propositions : % acceptent NULL. Une proposition sans source ni extrait est invérifiable (§13.3, §4.2).',
      array_to_string(v_fautives, ', ')
      using errcode = 'P0001';
  end if;

  -- Aucun statut métier dans le domaine : c'est LE verrou du §15, et il se
  -- perdrait par une simple recompilation du domaine dans une migration future.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
    join pg_type t on t.oid = c.contypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typname = 'statut_proposition'
   limit 1;
  if v_def is null then
    raise exception 'public.statut_proposition : domaine sans contrainte — le statut ne serait plus fermé.'
      using errcode = 'P0001';
  end if;
  foreach v_mot in array array[
    'confirm', 'valide', 'conteste', 'verifi', 'annul', 'refus', 'termin', 'cloture', 'expir'
  ] loop
    if v_def ilike '%' || v_mot || '%' then
      raise exception
        'public.statut_proposition contient « % » : une proposition ne devient jamais la décision qu''elle propose (§3.14, décision 3). Ces statuts appartiennent à l''entité decisions (livrable 2.1).',
        v_mot
        using errcode = 'P0001';
    end if;
  end loop;

  -- Aucun droit d'écriture au navigateur sur ce qu'une machine a détecté.
  select array_agg(distinct column_name order by column_name) into v_fautives
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'propositions'
     and grantee = 'authenticated' and privilege_type = 'UPDATE'
     and column_name not in ('statut', 'objet_cree_type', 'objet_cree_id', 'traite_par', 'traite_le');
  if v_fautives is not null then
    raise exception
      'public.propositions : le navigateur a reçu update sur % — ce qu''une machine a détecté ne se réécrit pas depuis l''écran (§3.14, critère 11).',
      array_to_string(v_fautives, ', ')
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'propositions'
       and grantee in ('authenticated', 'anon') and privilege_type in ('INSERT', 'DELETE')
  ) then
    raise exception
      'public.propositions : insert ou delete accordé au navigateur — une détection naît d''un message, jamais d''un écran.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'propositions' and c.relrowsecurity
  ) then
    raise exception 'public.propositions : RLS désactivée.' using errcode = 'P0001';
  end if;
end $$;
