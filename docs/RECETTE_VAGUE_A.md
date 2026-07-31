# Recette — vague A

Ce que la vague A livre, ce qui le vérifie, ce qui diverge du plan et ce qui
reste à faire par une main humaine. Elle se lit avant la fusion, et se relit
après la mise en production.

La vague A ne livre pas un écran de plus : elle fait **exister les messages**
dans le Cockpit. Avant elle, seule une pièce jointe faisait entrer un mail
dans l'outil — c'est-à-dire une petite minorité du courrier. Après elle, le
courrier d'un projet est là, avec son fil, son sens, son projet, ses trois
axes, son résumé brouillon et ses propositions.

## 1. Ce qui est livré

| Livrable | Ce qu'il fait | Où il vit | Ce qui le vérifie |
| --- | --- | --- | --- |
| A.1 | L'ingestion Gmail capte le fil, les en-têtes RFC, les destinataires, la direction et le corps ; curseur `internalDate` incrémental | `supabase/functions/gmail-ingestion/`, migration `20260731103000` | `test:ingestion-gmail` |
| A.2 | `public.communications` : un message, une ligne, avec ou sans pièce jointe. Les dix colonnes des trois axes, en triades proposé / humain / effectif | migration `20260731150000` | `test:communications` |
| A.3 | Couche d'accès paginée, cache IndexedDB 90 jours, file d'écritures idempotente | `src/communications.ts`, `src/horsLigne.ts` | `test:hors-ligne` |
| A.4 | Un seul moteur de rattachement, la file « à rattacher », les corrections mémorisées comme règles | `src/rattachement.ts` | `test:rattachement` |
| A.5 | « Ouvrir dans Gmail » sur tout message et tout document qui en vient | `src/util.ts`, `src/ui.tsx` | `test:lien-gmail` |
| A.6 | Résumé automatique du §5.3, secret propre, débit borné, mention « brouillon » rendue à l'écran | `supabase/functions/resume-messages/`, migration `20260731170000` | `test:resume` |
| A.7 | La boîte « À traiter » bascule sur `communications`, deux mémoires fusionnées, traitement nominatif | `src/boite.ts`, `src/modules/Cockpit.tsx` | `test:boite` |
| A.8 | Classifieur déterministe des trois axes, avec ses raisons en français. Aucun modèle appelé | `src/categorisation.ts`, `gmail-ingestion` | `test:classement` |
| A.9 | `public.propositions` : quatre genres, extrait cité obligatoire, aucun statut métier | migration `20260731190000`, `src/propositions.ts` | `test:propositions` |
| A.10 | Les détecteurs, deux étages : lexical hors ligne, puis modèle dans la réponse du résumé | `src/detecteurs.ts`, `resume-messages`, `src/routines.ts` | `test:detecteurs` |
| A.11 | Trois producteurs de notification à l'écran, marqueur « vu », alertes attribuées | `src/alerts.ts` | `test:notifications` |
| A.12 | Trois sélecteurs purs : à traiter, en attente de réponse, par phase | `src/communications.ts` | `test:selecteurs` |
| A.13 | Journal d'audit, premier étage : table en ajout seul, RPC non forgeable, trois déclencheurs | migration `20260731210000` | `test:audit` |

Trente et un scripts de test tournent en CI. `test:mise-en-production` refuse
qu'un script existe sans être branché dans `npm test` **et** dans `ci.yml` : la
vague précédente avait perdu sept tests de cette façon, sans que rien ne le
signale.

## 2. Ce qui a été trouvé en chemin

Trois défauts n'auraient produit aucune erreur visible. Ils sont notés ici
parce que la recette sert à cela, et non à réciter ce qui a marché.

- **A.11 comparait les niveaux d'importance en majuscules.** Le référentiel est
  en minuscules (`urgent`, `bloquant`, `contractuel`), et l'ensemble des
  niveaux alertants n'intersectait donc jamais les valeurs réelles : aucun
  message n'aurait produit d'alerte. Le test passait, parce que ses fixtures
  reproduisaient l'erreur. Un fil d'urgences vide ne ressemble pas à une panne,
  il ressemble à du calme. Corrigé, et le test lit maintenant le référentiel.
- **La signature OAuth était malléable** (`_shared/oauth-init.ts`) : un
  base64url non canonique décodait vers les mêmes octets. Le décodeur exige
  désormais la forme canonique.
- **La liste blanche du journal d'audit pouvait dériver** des colonnes
  réellement écrivables. Le test compare les deux listes entre fichiers : plus
  large, elle journalise ce que personne ne décide ; plus étroite, elle laisse
  une décision humaine sans trace.

## 3. Divergences avec le plan, déclarées

| Point | Décision | Pourquoi |
| --- | --- | --- |
| §3.15 — notification | **À l'écran seulement.** Ni e-mail sortant, ni notification poussée | Un e-mail exigerait `gmail.send`, que le §6 refuse. La file du centre d'actions est le canal réel à deux personnes |
| A.11 — `reponse_attendue` | Producteur **livré mais non alimenté** depuis l'accueil | Il lui faut les fils complets. La lecture de la boîte est paginée et filtrée sur l'entrant non traité ; l'alimenter avec cette vue produirait des relances fausses — « le client attend » alors qu'on lui a répondu la veille. Un producteur muet vaut mieux qu'un producteur menteur |
| A.13 — portée | `workspace.data` reste **hors** du journal | Un déclencheur ne voit pas une mutation dans un JSONB (§3.16). B.16 étend au relationnel restant et branche le chemin déclaratif. Le critère 13 est **partiel** à la fin du MVP, et le plan le dit |
| A.13 — contenu des messages | `objet`, `corps_extrait` et `resume` **hors liste blanche** | Les recopier dans une table en ajout seul créerait une seconde mémoire du courrier, indestructible, alors que le §4.1 pose Gmail comme source de vérité |
| A.7 — retrait de l'ancienne file | **Non fait**, et c'est le sujet de B.15 | Couper la surveillance navigateur avant que le cron serveur soit prouvé ne casserait pas la file : elle la viderait en silence. Condition de déclenchement : sept jours consécutifs sans écart entre les deux mémoires |
| A.10 — risques | Quatre natures sur les neuf du §6.3 | Les cinq autres sont déjà produites par `computeAlertes`. Les redétecter les afficherait deux fois, et un risque affiché deux fois se lit comme deux risques |

## 4. Ce que la vague A ne livre pas

Ce n'est pas un oubli, c'est le séquencement : les **écrans de revue** des
propositions sont B.10 et B.11. Aujourd'hui, les détections s'écrivent dans
`propositions`, l'alerte agrégée « N propositions à revoir » les signale, et
elles se consultent dans l'éditeur SQL de Supabase. C'est peu pratique, et
c'est suffisant tant que personne n'y a encore rien accepté — le statut
`proposee` est le seul qu'une machine puisse écrire.

La collection `taches`, la fiche de tâche et le chrono sont la vague B. Une
proposition de tâche acceptée n'a donc pas encore de destination : elle reste
lisible et ignorable, ce qui est exactement ce que le §15 demande.

## 5. À faire par une main humaine, avant que tout cela serve

Aucune de ces étapes n'est automatisable, et aucune n'a été faite par un agent
— c'est délibéré.

1. **Cinq variables d'environnement Vercel** (§3 du runbook). L'assistant
   répond encore `501 Assistant non configuré` en production, et c'est le seul
   défaut réel du jour. Redéployer ensuite : les fonctions Vercel ne lisent
   leurs variables qu'au déploiement.
2. **Relire puis appliquer les migrations en attente**, dans l'ordre du
   runbook. `20260731210000` (journal d'audit) doit venir après les trois
   tables qu'elle instrumente ; son contrôle final refuse de s'appliquer si un
   déclencheur manque.
3. **Redéployer `resume-messages` après `20260731190000`.** Dans l'autre ordre,
   les détections seraient perdues sans trace visible.
4. **Consentement Gmail** : identifiants OAuth Google, périmètres
   `gmail.readonly` et `calendar.readonly` uniquement, et un clic humain.
5. **Domaine `agence-ll.fr` et Google Workspace**, si l'agence le confirme. Les
   comptes `@gmail.com` restent les comptes de connexion tant que la bascule
   d'identité (3.2) n'est pas faite : la faire trop tôt enfermerait dehors.

## 6. Comment vérifier que la vague A fonctionne, en production

Dans l'ordre, et chaque étape suppose la précédente :

1. `ingestion_config.dernier_resultat` avance et cite un nombre de messages.
2. `select count(*) from communications` croît d'un passage à l'autre.
3. L'accueil montre des mails dans « À traiter », chacun avec « Ouvrir dans
   Gmail », son projet ou un badge « projet ? ».
4. Marquer un mail « ✓ Fait » renseigne `traite_par` **et** `traite_le` — donc
   un nom, pas un booléen.
5. `select count(*) from journal_audit where table_cible = 'communications'`
   passe à 1 après ce geste. Sinon, le déclencheur n'est pas posé.
6. Si `RESUME_ANTHROPIC_API_KEY` est posée : `resume_le` se remplit, et
   `propositions` reçoit des lignes au statut `proposee`.

Si l'étape 5 échoue alors que les autres passent, la migration d'audit n'a pas
été appliquée — c'est le cas le plus probable, et le moins bruyant.
