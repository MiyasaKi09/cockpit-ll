-- Livrable A.1 — Ingestion Gmail enrichie : le fil, le sens, les en-têtes.
--
-- POURQUOI
-- --------
-- L'ingestion serveur n'enregistrait d'un message que trois choses :
-- l'expéditeur, l'objet et la date de réception. Tout le reste — le fil de
-- discussion, les destinataires, les en-têtes RFC qui chaînent une réponse à
-- sa question, les libellés, la date à laquelle l'expéditeur dit avoir écrit,
-- et le SENS du message — était lu par l'API Gmail à chaque scan, puis jeté.
--
-- Ce n'est pas une omission rattrapable plus tard. Le §3.6 du plan le dit :
-- « sans threadId capté à l'ingestion, le bouton Ouvrir dans Gmail du §4.2 est
-- infaisable a posteriori — et le bloc mails nécessitant une réponse du §8.2
-- l'est aussi ». Ce dernier se définit comme « dernier message du fil entrant,
-- sans message sortant postérieur dans le même fil » : sans le fil ET sans le
-- sens, la phrase n'a pas de traduction. Le sélecteur qui la porte (A.12) en
-- dépend « de façon irrattrapable ».
--
-- CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE NE FAIT PAS
-- ------------------------------------------------------
-- Elle ajoute au contexte de chaque pièce reçue les colonnes du message qui
-- l'a apportée, et deux colonnes de curseur à la configuration d'ingestion.
--
-- Elle NE crée PAS la table `communications`. Celle-ci est le livrable A.2, et
-- le plan exige qu'elle naisse d'UNE seule migration, avec les dix colonnes des
-- trois axes du §5.2 : les ajouter après coup coûterait une reprise de toutes
-- les lignes déjà ingérées. En créer ici une moitié imposerait exactement cette
-- reprise. `public.entrants` reste donc ce qu'elle est — l'index des PIÈCES à
-- valider — et gagne le contexte de leur message ; `communications` sera
-- l'index des MESSAGES, y compris ceux qui n'ont aucune pièce jointe.
--
-- LE CURSEUR PORTE SA PORTÉE, ET C'EST LE POINT IMPORTANT
-- -------------------------------------------------------
-- `curseur_gmail` seul serait un piège différé. Le jour où A.2 élargira
-- l'ingestion de « les messages avec pièce jointe » à « tous les messages »,
-- un curseur hérité de la requête étroite ferait sauter, sans erreur ni trace,
-- tout l'historique sans pièce jointe antérieur à sa position.
-- `curseur_gmail_portee` enregistre la requête que le curseur a réellement
-- parcourue : portée différente ⇒ la fonction repart de sa fenêtre initiale
-- au lieu de faire confiance à une position qui ne veut plus rien dire.
--
-- ORDRE D'APPLICATION
-- -------------------
-- Cette migration s'applique AVANT le redéploiement de `gmail-ingestion` : la
-- nouvelle source écrit ces colonnes, et une insertion vers une colonne
-- absente échoue. Les fonctions déjà déployées, elles, ignorent ces colonnes
-- et continuent de fonctionner pendant l'intervalle — aucune n'est NOT NULL.
--
-- RÉTROCOMPATIBILITÉ
-- ------------------
-- Toutes les colonnes sont ajoutées en `if not exists`, nullables ou avec une
-- valeur par défaut vide. Les lignes déjà ingérées restent lisibles : elles
-- portent simplement un contexte inconnu, et c'est la vérité — ces messages
-- ont été lus à une époque où on ne le captait pas. Aucune rétro-écriture
-- n'est tentée : elle inventerait un fil qu'on n'a pas vu.
--
-- ACCÈS
-- -----
-- Aucune politique nouvelle. `public.entrants` et `public.ingestion_config`
-- gardent celles de la migration 20260730180000, qui appellent
-- `public.est_membre_actif()`. Les `grant` étant au niveau de la table, les
-- colonnes ajoutées héritent des droits existants : lecture pour les membres
-- actifs sur `entrants`, `service_role` seul sur `ingestion_config`.

-- ---------------------------------------------------------------------------
-- 1. Le curseur de lecture incrémentale, et sa portée
-- ---------------------------------------------------------------------------

alter table public.ingestion_config
  add column if not exists curseur_gmail        text,
  add column if not exists curseur_gmail_portee text;

comment on column public.ingestion_config.curseur_gmail is
  'Dernier internalDate Gmail traité, en millisecondes (texte : la valeur dépasse un integer). Vide = premier passage, la fonction reprend une fenêtre initiale bornée.';

comment on column public.ingestion_config.curseur_gmail_portee is
  'Requête Gmail que ce curseur a parcourue. Si elle diffère de celle du code, le curseur est ignoré : une requête élargie ne peut pas hériter de la position d''une requête plus étroite sans sauter ce qu''elle seule voit.';

-- ---------------------------------------------------------------------------
-- 2. Le contexte du message, porté par chaque pièce qu'il apporte
-- ---------------------------------------------------------------------------

alter table public.entrants
  add column if not exists thread_id      text,
  add column if not exists message_id_rfc text,
  add column if not exists en_reponse_a   text,
  add column if not exists references_rfc jsonb not null default '[]'::jsonb,
  add column if not exists destinataires  jsonb not null default '[]'::jsonb,
  add column if not exists copies         jsonb not null default '[]'::jsonb,
  add column if not exists libelles       jsonb not null default '[]'::jsonb,
  add column if not exists direction      text,
  add column if not exists envoye_le      timestamptz,
  add column if not exists corps_extrait  text;

comment on column public.entrants.thread_id is
  'Fil de discussion Gmail. Signal de rattachement le plus fort du §3.7 : un seul rattachement humain propage tout le fil.';

comment on column public.entrants.message_id_rfc is
  'Message-ID RFC 5322 — l''identité du message hors de Gmail, seule clé stable si la boîte change un jour de fournisseur.';

comment on column public.entrants.en_reponse_a is
  'In-Reply-To : le message auquel celui-ci répond.';

comment on column public.entrants.references_rfc is
  'References : la chaîne du fil, du plus ancien au plus récent. Reconstruit un fil que Gmail aurait éclaté.';

comment on column public.entrants.destinataires is
  'To, normalisé en [{nom, adresse}]. Le §3.3 exige que Cockpit détecte les destinataires ; le §3.7 en fait un signal de rattachement.';

comment on column public.entrants.copies is
  'Cc, même forme que destinataires.';

comment on column public.entrants.libelles is
  'labelIds Gmail. SENT décide du sens ; les étiquettes de l''agence serviront au classement.';

comment on column public.entrants.direction is
  'entrant (reçu par l''agence) ou sortant (émis par elle). Déterminé par le libellé SENT, sinon par l''appartenance de l''expéditeur au registre public.membres — jamais par une adresse écrite en dur.';

comment on column public.entrants.envoye_le is
  'En-tête Date : quand l''expéditeur dit avoir écrit. Distinct de recu_le (internalDate Gmail), parfois de plusieurs jours quand un serveur relais a retenu le message.';

comment on column public.entrants.corps_extrait is
  'Début du corps en texte brut, borné. Donne à l''humain qui valide une pièce le contexte du message, sans copier Gmail : la source de vérité reste la boîte (§4.3).';

-- Le domaine du sens est fermé, et il est vérifié en base plutôt que par
-- convention d'écriture : une troisième valeur casserait silencieusement tout
-- filtre « entrant / sortant » écrit au-dessus. `not valid` parce que les
-- lignes déjà ingérées portent `null` — légitime, on ne connaissait pas le sens.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'entrants_direction_chk'
       and conrelid = 'public.entrants'::regclass
  ) then
    alter table public.entrants
      add constraint entrants_direction_chk
      check (direction is null or direction in ('entrant', 'sortant'))
      not valid;
  end if;
end $$;

-- Le fil est ce sur quoi on interroge : « toutes les pièces de cet échange »,
-- et demain « ce fil a-t-il reçu une réponse ». Index partiel : la colonne est
-- nulle sur tout l'historique déjà ingéré.
create index if not exists entrants_thread_idx
  on public.entrants (thread_id)
  where thread_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Contrôle final — la migration se refuse à mentir sur ce qu'elle a fait
-- ---------------------------------------------------------------------------
--
-- Une colonne manquante ici ne produirait aucune erreur : elle produirait une
-- Edge Function dont chaque insertion échoue, toutes les dix minutes, sans que
-- rien n'apparaisse ailleurs que dans les journaux Supabase.

do $$
declare
  v_attendues text[] := array[
    'thread_id', 'message_id_rfc', 'en_reponse_a', 'references_rfc',
    'destinataires', 'copies', 'libelles', 'direction', 'envoye_le', 'corps_extrait'
  ];
  v_manquantes text[] := '{}';
  v_colonne    text;
begin
  foreach v_colonne in array v_attendues loop
    if not exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'entrants'
         and column_name = v_colonne
    ) then
      v_manquantes := v_manquantes || v_colonne;
    end if;
  end loop;

  if array_length(v_manquantes, 1) > 0 then
    raise exception
      'public.entrants : colonnes absentes après migration (%). Ne déployez pas gmail-ingestion : ses insertions échoueraient à chaque passage.',
      array_to_string(v_manquantes, ', ')
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'ingestion_config'
       and column_name = 'curseur_gmail_portee'
  ) then
    raise exception
      'public.ingestion_config.curseur_gmail_portee est absente : un curseur sans portée reprendrait une position acquise sur une autre requête.'
      using errcode = 'P0001';
  end if;
end $$;
