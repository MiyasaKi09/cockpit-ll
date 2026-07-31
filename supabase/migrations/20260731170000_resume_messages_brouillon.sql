-- Livrable A.6 — le résumé automatique du §5.3, et ce qui le borne.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ----------------------------------
-- Elle ne crée aucune colonne de résumé : `communications.resume` et
-- `communications.resume_le` existent depuis A.2 (migration 20260731150000),
-- qui les a posées avec le reste de la table pour la raison que le plan
-- donne — ajouter une colonne après coup imposerait de rouvrir les lignes
-- déjà ingérées. Le trigger `communications_refus_proposition` y protège déjà
-- `resume` de toute réécriture depuis le navigateur, et le GRANT au niveau
-- colonne ne l'accorde à personne d'autre que `service_role`. Il n'y avait
-- donc rien à redéclarer : ce qui manquait, c'est de quoi FAIRE TOURNER le
-- résumé sans laisser filer la facture.
--
-- CE QU'ELLE FAIT, ET POURQUOI
-- ----------------------------
--   1. UN SECRET DE PLANIFICATION PROPRE (`resume_cron_secret`). Les quatre
--      tâches existantes partagent `cron_secret`. Le résumé est la seule
--      tâche du dépôt qui DÉPENSE DE L'ARGENT à chaque passage : lui donner
--      le secret commun reviendrait à faire d'une fuite d'ingestion une
--      fuite de budget. Le secret est tiré ici, une fois, et n'apparaît
--      jamais dans `cron.job` — la tâche le relit à l'exécution, comme les
--      quatre autres relisent le leur.
--   2. DEUX COLONNES DE JOURNAL PROPRES (`resume_dernier_scan`,
--      `resume_dernier_resultat`). Écrire dans `dernier_resultat`, que
--      l'ingestion Gmail renseigne toutes les dix minutes, ferait disparaître
--      l'un derrière l'autre : on croirait l'ingestion muette quand c'est le
--      résumé qui a parlé, et réciproquement.
--   3. UNE MARQUE DE PASSAGE (`communications.resume_tente_le`). Sans elle,
--      un message auquel le modèle répond « il n'y a rien à résumer » — un
--      accusé de réception, une réponse automatique — resterait éternellement
--      candidat : il est RÉCENT, donc en tête de file, donc redemandé au
--      modèle toutes les quinze minutes, indéfiniment. Le plafond journalier
--      ne l'attraperait pas, puisqu'il compte les résumés PRODUITS et non les
--      appels tentés. C'est la fuite de coût la moins visible du livrable, et
--      elle se referme avec une colonne.
--   4. DEUX INDEX, un par lecture réelle de la fonction : « quels messages
--      rattachés attendent encore un résumé » et « combien en ai-je produit
--      depuis une heure ». Le second EST la limitation de débit : sans lui,
--      la borne serait un compteur à tenir à jour quelque part, c'est-à-dire
--      une seconde vérité.
--   5. LA TÂCHE PLANIFIÉE, toutes les quinze minutes.
--
-- CE QUI RESTE HORS DE LA BASE, DÉLIBÉRÉMENT
-- ------------------------------------------
-- La clé Anthropic. Elle vit dans un secret Supabase propre à la fonction
-- (`RESUME_ANTHROPIC_API_KEY`), jamais dans une table, jamais dans Git, et
-- jamais partagée avec celle de Vercel : révoquer l'une n'éteint pas l'autre.
-- Tant qu'elle n'est pas posée, la tâche tourne, ne dépense rien, et le dit
-- dans `resume_dernier_resultat`.
--
-- ORDRE D'APPLICATION
-- -------------------
-- Après 20260730160000, 20260730180000 et 20260731150000. Elle s'applique
-- AVANT le déploiement de `resume-messages` : la fonction lit
-- `resume_cron_secret`, et sans cette colonne elle refuse tout le monde —
-- y compris son propre planificateur.

-- ---------------------------------------------------------------------------
-- 1. Le secret de la tâche, et son journal
-- ---------------------------------------------------------------------------

alter table public.ingestion_config
  add column if not exists resume_cron_secret      text,
  add column if not exists resume_dernier_scan     timestamptz,
  add column if not exists resume_dernier_resultat text;

-- Tiré en base, jamais recopié dans Git ni dans `cron.job`. `coalesce` :
-- rejouer la migration ne fait pas tourner le secret sous la tâche déjà
-- planifiée, qui refuserait alors son propre planificateur jusqu'au prochain
-- `cron.schedule`.
update public.ingestion_config
   set resume_cron_secret = encode(extensions.gen_random_bytes(32), 'hex')
 where id = 'google'
   and coalesce(resume_cron_secret, '') = '';

comment on column public.ingestion_config.resume_cron_secret is
  'Secret de la tâche « resume-messages » (A.6). DISTINCT de cron_secret, que quatre tâches partagent : le résumé est la seule tâche qui dépense de l''argent à chaque passage.';
comment on column public.ingestion_config.resume_dernier_resultat is
  'Dernier passage du résumé automatique, en clair. Colonne propre : partager dernier_resultat avec l''ingestion ferait disparaître l''un des deux journaux derrière l''autre.';

-- ---------------------------------------------------------------------------
-- 2. La marque de passage, et les lectures de la fonction
-- ---------------------------------------------------------------------------

-- « on a demandé, il n'y avait rien à en dire ». Écrite par la seule Edge
-- Function, jamais accordée au navigateur (aucun `grant update` ne la nomme,
-- et c'est ce silence qui la rend inaccessible depuis l'écran).
alter table public.communications
  add column if not exists resume_tente_le timestamptz;

comment on column public.communications.resume_tente_le is
  'Le résumé a été DEMANDÉ et le modèle n''a rien produit (accusé de réception, réponse automatique, refus). Sans cette marque, un message récent sans matière serait redemandé toutes les quinze minutes indéfiniment : le plafond journalier compte les résumés produits, pas les appels tentés.';

-- « les messages rattachés qui attendent encore leur résumé, les plus récents
-- d'abord ». Index PARTIEL : une fois résumée — ou une fois examinée sans
-- résultat — une ligne n'est plus jamais candidate, et la file utile reste
-- petite même quand la table grossit. Le prédicat ne porte que sur des
-- colonnes stockées ordinaires ; le rattachement, lui, se lit dans la colonne
-- GÉNÉRÉE `projet_id`, que la fonction interroge et ne recalcule jamais.
create index if not exists communications_a_resumer_idx
  on public.communications (envoye_le desc)
  where resume is null and resume_tente_le is null;

-- « combien de résumés depuis une heure, depuis un jour » — la limitation de
-- débit se lit dans les lignes déjà écrites, pas dans un compteur à part.
create index if not exists communications_resume_le_idx
  on public.communications (resume_le desc)
  where resume_le is not null;

-- ---------------------------------------------------------------------------
-- 3. La tâche planifiée
--
-- Quinze minutes : l'ingestion tourne toutes les dix, le résumé n'a aucune
-- raison d'aller plus vite qu'elle, et huit messages par passage suffisent
-- très largement au courrier réel d'une agence de deux personnes (le §18
-- mesure 60 messages par jour, dont une moitié rattachée).
--
-- `cron.schedule()` remplace une tâche de même nom : réappliquer la migration
-- ne crée pas de doublon.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

select cron.schedule(
  'resume-messages',
  '*/15 * * * *',
  $cron$
    select net.http_post(
      url := (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'project_url'
      ) || '/functions/v1/resume-messages',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'publishable_key'
        ),
        'Authorization', 'Bearer ' || (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'publishable_key'
        ),
        'x-cron-secret', (
          select resume_cron_secret
            from public.ingestion_config
           where id = 'google'
        )
      ),
      body := jsonb_build_object('declenche_le', now()),
      timeout_milliseconds := 120000
    ) as request_id;
  $cron$
);

-- ---------------------------------------------------------------------------
-- 4. Contrôle final — la migration se refuse à mentir sur ce qu'elle a fait
--
-- Aucun de ces défauts ne produirait d'erreur visible : un secret vide fait
-- refuser le planificateur par sa propre fonction, toutes les quinze minutes,
-- sans autre trace que les journaux Supabase.
-- ---------------------------------------------------------------------------

do $$
declare
  v_colonne text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'communications'
       and column_name = 'resume_tente_le'
  ) then
    raise exception
      'public.communications.resume_tente_le est absente : un message sans matière serait redemandé au modèle toutes les quinze minutes, et le plafond journalier ne le verrait pas.'
      using errcode = 'P0001';
  end if;

  -- Le navigateur ne doit pas pouvoir effacer la marque de passage : ce serait
  -- rouvrir la fuite depuis un écran.
  if exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'communications'
       and grantee = 'authenticated' and privilege_type = 'UPDATE'
       and column_name in ('resume', 'resume_le', 'resume_tente_le')
  ) then
    raise exception
      'public.communications : le navigateur a reçu update sur une colonne de résumé — le résumé s''écrit côté serveur, et lui seul.'
      using errcode = 'P0001';
  end if;

  foreach v_colonne in array array[
    'resume_cron_secret', 'resume_dernier_scan', 'resume_dernier_resultat'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'ingestion_config'
         and column_name = v_colonne
    ) then
      raise exception
        'public.ingestion_config.% est absente : ne déployez pas resume-messages, elle refuserait son propre planificateur.',
        v_colonne
        using errcode = 'P0001';
    end if;
  end loop;

  if exists (
    select 1 from public.ingestion_config
     where id = 'google' and coalesce(resume_cron_secret, '') = ''
  ) then
    raise exception
      'public.ingestion_config.resume_cron_secret est vide : la tâche planifiée n''aurait aucun moyen de s''authentifier.'
      using errcode = 'P0001';
  end if;

  -- Le secret du résumé ne doit PAS être celui des quatre autres tâches :
  -- c'est tout l'objet de la colonne.
  if exists (
    select 1 from public.ingestion_config
     where id = 'google' and resume_cron_secret = cron_secret
  ) then
    raise exception
      'public.ingestion_config : resume_cron_secret est identique à cron_secret — la tâche qui dépense partagerait le secret des quatre autres.'
      using errcode = 'P0001';
  end if;
end $$;
