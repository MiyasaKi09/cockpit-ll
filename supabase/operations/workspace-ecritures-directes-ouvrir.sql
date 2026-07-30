-- Ouverture transitoire des écritures directes sur public.workspace.
--
-- À n'appliquer QUE pendant une bascule de production, juste après
-- `supabase db push`, et seulement si un front déjà déployé écrit encore
-- directement dans la table au lieu de passer par la RPC.
--
-- La migration 20260729170200 déclare l'état final : `authenticated` ne
-- possède que `select`, et `public.enregistrer_workspace` est le seul chemin
-- d'écriture. Ce script rouvre temporairement l'ancien chemin pour que les
-- postes encore sur la version précédente continuent d'enregistrer leur
-- travail pendant la fenêtre qui sépare la migration du déploiement du front.
--
-- L'inverse exact est `workspace-ecritures-directes-revoquer.sql`. Il doit
-- être appliqué dès que le nouveau front est en production : tant que ce
-- script-ci reste en vigueur, un poste autorisé peut écrire sans passer par le
-- verrou de révision, donc écraser le travail d'un autre poste.

create policy "agence insertion" on public.workspace
  for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

create policy "agence mise a jour" on public.workspace
  for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  )
  with check (
    lower((select auth.jwt()) ->> 'email')
      = any (array['julenglet@gmail.com', 'zoefhebert@gmail.com'])
  );

grant insert, update on table public.workspace to authenticated;

-- `delete` n'est volontairement pas rendu : aucune version du Cockpit ne
-- supprime la ligne partagée.
