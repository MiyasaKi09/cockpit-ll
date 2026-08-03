# Recette — vague B

Ce que la vague B livre, ce qui le vérifie, et **le seul livrable qui ne
peut pas être livré aujourd'hui**. Elle se lit avant la fusion.

Là où la vague A a fait exister les **messages**, la vague B fait exister
les **tâches** et le **temps**. Deux entités que le Cockpit n'avait pas, et
dont tout le §8 et tout le §9 du cahier des charges dépendent.

## 1. Ce qui est livré

| Livrable | Ce qu'il fait | Ce qui le vérifie |
| --- | --- | --- |
| B.1 | Collection `taches` : 18 champs du §8.5, 9 statuts, 8 origines, reprise des notes « à faire » au palier v21 | `test:taches` |
| B.2 | Vue « Mes tâches » : les **onze** filtres du §8.3 | `test:taches` |
| B.3 | « Créer une tâche depuis ce message », avec sa source | `test:boite` |
| B.4 | Table `pointages` horodatés (§9.5) | migration + `test:conservation` |
| B.5 | Projection `pointages` → `state.temps` ; la grille devient dérivée | `test:conservation` |
| B.6 | Table `chrono_actif`, un seul chrono par personne par clé primaire | migration |
| B.7 | `facturable` par pointage, initialisé par la règle actuelle | `test:conservation` |
| B.8 | Fiche tâche : les points 2 et 5 du §19.3 | `test:taches` |
| B.9 | Seconde projection → `Tache.tempsEnregistre` | `test:conservation` |
| B.10 | Accepter / Modifier / Attribuer / Ignorer (§8.7) | `test:revue-propositions` |
| B.11 | Échéance proposée : jamais d'échéance juridique | `test:revue-propositions` |
| B.12 | Tâches dans la file du matin, et fin du doublon avec les notes | `test:taches` |
| B.13 | Modèles de tâches : aperçu décochable avant création | `test:modeles` |
| B.14 | Départ d'un membre : transfert au lieu d'orphelinage | `test:depart` |
| B.16 | Journal d'audit sur `pointages` et `chrono_actif` | migration + `test:audit` |
| B.17 | Le critère 11 rendu opposable | `test:critere11` |
| B.18 | Mesure de la parité des deux mémoires | `test:boite` |

Trente-sept scripts de test tournent en CI.

## 2. B.15 ne peut pas être livré, et ce n'est pas un choix de périmètre

B.15 coupe l'ingestion navigateur. Sa condition est écrite trois fois dans
le plan comme **non négociable** : *sept jours consécutifs en production
sans écart entre les deux mémoires.*

Aujourd'hui, les fonctions Edge de la vague A **ne sont pas déployées**.
La table `communications` est vide. Le compteur de B.18 est donc à zéro —
non parce qu'il y a des écarts, mais parce qu'il n'y a rien à comparer.

Livrer B.15 maintenant reviendrait à couper l'ancienne mémoire avant que
la nouvelle ait jamais fonctionné. Cela ne casserait pas la file du
matin : **cela la viderait en silence**, et une file vide ressemble à une
journée calme.

**Ce qu'il faut pour débloquer B.15**, dans l'ordre :

1. déployer les trois fonctions Edge (voir `MISE_EN_PRODUCTION.md`) ;
2. réactiver le cron du résumé ;
3. laisser tourner, et regarder `#/parite` — l'écran de B.18 ;
4. quand le compteur atteint 7 / 7, B.15 devient une demi-journée de
   travail : retirer le statut « à traiter » au `Courrier`, couper
   `surveillance.ts:88-96`, passer la collection en lecture seule.

L'outil qui mesure existe. C'est le sens de B.18, livré exprès avant.

## 3. Ce que la vague B a trouvé en chemin

Quatre défauts, dont aucun n'aurait produit d'erreur visible.

- **Le test de renommage validait à vide.** Il exigeait « au moins 15
  références » ; les trois désignations de la tâche portaient le total à 18
  sans être exercées par le jeu d'essai. Il compare maintenant à
  l'inventaire lui-même.
- **`identifiantGmailDe` rend le dernier segment de n'importe quel texte.**
  « routine tri du matin » ressortait comme un identifiant Gmail. Sans
  conséquence pour le dédoublonnage d'affichage ; pour la *mesure* de
  B.18, c'était un écart permanent qui aurait masqué les vrais.
- **La conservation des totaux ne peut pas être exacte, et le prétendre
  aurait coûté le test.** `TempsEntry.heures` stocke des heures : un
  arrondi par ligne agrégée est inévitable. La première version du test
  exigeait l'exactitude au total — elle échouait. Un test faux se
  désactive, et on perd les deux. Il tient maintenant la vraie propriété :
  chaque ligne exacte au centième, écart total borné par le nombre de
  lignes, et l'arrondi **par pointage** interdit.
- **Un lint laissé passer.** J'avais enchaîné `npm run lint` dans un pipe
  qui en masquait la sortie ; la CI l'a trouvé. Vérifié depuis sur le code
  de sortie, pas sur l'apparence.

## 4. Divergences déclarées

| Point | Décision | Pourquoi |
| --- | --- | --- |
| B.6 — affichage permanent du chrono | Table et contrainte livrées, **écran non livré** | Le §3.5 note qu'il n'y a pas de barre supérieure au bureau ; les deux emplacements sont M.3. Le chrono se démarre aujourd'hui par la saisie de pointage |
| B.8 — bouton chrono dans la fiche | **Absent, et dit** | Un bouton mort se clique deux fois, puis on cesse de faire confiance à l'écran. La fiche indique où le temps se saisit |
| B.10 / B.11 / B.13 / B.14 | Logique pure + tests livrés ; **écrans de revue à monter** | Les règles sont là et vérifiées en CI. Les écrans se posent dessus sans les redéfinir — c'est la partie qui ne peut plus se tromper |
| B.5 | `derive.ts` **n'est pas touché** | La marge continue de lire `state.temps` sans savoir d'où il vient. Deux chemins vers la marge finissent toujours par diverger |

## 5. La migration du temps est appliquée — et exercée

`20260801090000_pointages_et_chrono.sql` a été appliquée en production le
03/08/2026. Elle crée `pointages` et `chrono_actif`, et étend le journal
d'audit (B.16).

Ses garanties ont été **vérifiées en refusant**, pas en constatant leur
présence. Quatre écritures fautives ont été tentées et rejetées : durée
négative, fin antérieure au début, activité hors référentiel, second chrono
pour la même personne. Une correction de durée (90 → 75 min) laisse dans le
journal une ligne portant le seul champ modifié, avec ses valeurs avant et
après ; le commentaire libre y figure **par son nom**, jamais par sa valeur.

Les lignes d'audit de cette vérification restent en base : le journal est en
ajout seul, et c'est le comportement voulu. Elles documentent le contrôle.

Trois garanties qu'elle pose et qu'un écran ne peut pas poser :

- **un seul chrono par personne**, par clé primaire. Deux onglets, deux
  postes, un rechargement au mauvais moment : deux chronos comptent le
  même temps deux fois ;
- **aucune durée négative**. Un pointage négatif soustrait du temps, donc
  la marge s'améliore toute seule — et personne ne va chercher un défaut
  qui embellit un chiffre ;
- **un pointage validé ne se réécrit plus** depuis le navigateur.

## 6. Comment vérifier, une fois tout appliqué

1. Ouvrir `#/taches` : la liste existe, les onze filtres répondent.
2. Cliquer une tâche : la fiche s'ouvre en modale, sans perdre les filtres.
3. Depuis l'accueil, « Créer une tâche » sur un mail : elle apparaît dans
   `#/taches` avec un lien « Ouvrir » vers Gmail.
4. `select count(*) from pointages` après une saisie de temps.
5. `select count(*) from journal_audit where table_cible = 'pointages'`
   passe à 1 après une correction de durée.
6. `#/parite` : le compteur avance d'un jour par jour sans écart.
