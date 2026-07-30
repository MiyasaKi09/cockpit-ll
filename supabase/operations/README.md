# Opérations ponctuelles

`supabase/migrations/` décrit l'état **cible** de la base : un projet neuf
appliqué dans l'ordre obtient directement la configuration durcie, sans fenêtre
d'ouverture intermédiaire.

Ce répertoire contient les scripts qui n'appartiennent pas à cet état cible :
ils servent à traverser une bascule sur un projet **déjà en service**, puis à
revenir exactement à ce que les migrations déclarent. Ils ne sont donc pas joués
par `supabase db push` et ne sont pas enregistrés dans l'historique des
migrations.

| Script | Quand | Effet |
| --- | --- | --- |
| `workspace-ecritures-directes-ouvrir.sql` | juste après `supabase db push`, si un front déjà déployé écrit encore en direct | rouvre `insert`/`update` sur `public.workspace` pour les comptes de l'agence |
| `workspace-ecritures-directes-revoquer.sql` | dès que le front de production passe par la RPC | referme l'ancien chemin et rétablit l'état déclaré par la migration `20260729170200` |

Les deux scripts sont l'inverse exact l'un de l'autre et
`scripts/test-mise-en-production.cjs` le vérifie à chaque exécution de la CI.

Tant que le script d'ouverture reste en vigueur, un poste autorisé peut écrire
sans passer par le verrou de révision : la fenêtre doit rester courte et se
terminer par la révocation. La procédure complète, dans l'ordre, est décrite
dans [`docs/MISE_EN_PRODUCTION.md`](../../docs/MISE_EN_PRODUCTION.md).
