# Refonte de la navigation — deux ancres, moins d'endroits

> **Origine.** Retour de l'agence du 07/08/2026 : « actuellement c'est super
> compliqué, y a plein de clics pour faire plein de choses, rien n'est vraiment
> homogène. On se perd dans le site. Il faudrait réfléchir à clairement
> améliorer l'usage. »
>
> **Ce document est un plan, pas une livraison.** Il se lit pour dire oui ou non
> avant qu'une ligne de code bouge. Sa pièce maîtresse est la table de la
> section 3 : le devenir de chacun des soixante-deux endroits actuels. Un
> endroit absent de cette table est un endroit qui disparaîtrait en silence.

---

## 1. Ce qui ne va pas, en chiffres

| | |
|---|---:|
| Destinations au menu | **16** |
| Sous-onglets | **59** |
| **Endroits distincts où l'on peut se trouver** | **75** |
| Écrans | 51 |
| Cartes | 183 |
| Modales | 86 |

> **Correction du 07/08, et elle est instructive.** Ce document annonçait
> d'abord 46 onglets et 62 endroits. Le contrôle mécanique de la tranche 1, qui
> compte par le compilateur et non à la main, en trouve **59 et 75** : mon
> relevé avait oublié cinq écrans à onglets (Assistant, Pilotage, Propositions,
> et un quatrième onglet de Documents). Un plan dont le chiffre de départ est
> faux ne vaut rien — d'où le contrôle, qui mesure désormais à notre place.
> Toutes les valeurs ci-dessous sont celles du compilateur.

Pour **deux personnes**. Il y a plus d'endroits dans cet outil que l'agence n'a
de moments dans la semaine pour les visiter.

### Pourquoi on en est arrivé là

Ce n'est pas une négligence, c'est une **erreur de mesure**, et il faut la
nommer parce qu'elle se reproduira sinon.

Un audit d'usage a compté **les gestes par parcours** — combien de clics pour
relancer une entreprise, pour émettre une facture, pour préparer une réunion.
Puis environ cent cinquante corrections ont été livrées. Chacune raccourcissait
un parcours. Chacune ajoutait une carte, un onglet, un bouton ou une alerte.

La consigne « simplifier la vie, pas la complexifier » figurait dans chaque
prompt, dans chaque message de commit, dans chaque document. Elle n'a servi à
rien, pour une raison simple : **la surface n'était mesurée nulle part.** On ne
corrige que ce qu'on mesure. Un parcours plus court dans un outil plus vaste,
c'est un gain local payé par une perte globale — et la perte globale ne
figurait sur aucun tableau de bord.

### La règle de cette refonte, inversée

**La seule mesure de succès est le nombre d'endroits, à fonctions constantes.**

Une proposition qui ajoute un écran, un onglet ou une carte est un échec, même
si elle raccourcit un parcours. Chaque ligne de ce document dit **ce qui
disparaît de la vue**, jamais ce qui s'ajoute.

**Rien n'est supprimé.** On replie, on regroupe, on laisse retrouver par la
recherche. Les données, les calculs et le code restent ; un clic rouvre. C'est
la même règle que l'inventaire Finance, et pour la même raison : supprimer sans
mesurer enlèverait ce que l'une des deux utilise en silence.

Et « simple » ne veut pas dire pauvre. L'agence demande un planning de semaine
**ultra complet et précis**. Un écran dense vaut mieux que douze clairsemés :
c'est le nombre de **portes** qu'on réduit, pas la quantité d'information.

---

## 2. La cible : deux ancres

L'agence a tranché : « il faut à la fois ce point autour du **projet**, mais
aussi une vision simple de **la semaine** avec un planning ultra complet et
précis ».

Deux ancres, donc — le temps qui passe, et le travail qu'on fait. Tout le reste
devient une vue de recoupement, pas une destination concurrente.

### 2.1 « La semaine » ne s'écrit pas : elle se révèle

**C'est la découverte principale de l'analyse, et elle change l'ampleur du
chantier.** L'écran d'accueil *est déjà* un écran de semaine — il est
simplement mal nommé et à moitié aveugle :

- son horizon est déjà de sept jours (`Cockpit.tsx:982`,
  `const horizon = addDays(today, 7)`) ;
- il porte déjà un bouton « Revenir à cette semaine » (`:1381`) ;
- la carte « Semaine de l'équipe » y est déjà montée (`:1683`) ;
- et la fonction qui répond **mot pour mot** à « qui fait quoi cette semaine »
  — `chargeParPhase`, qui rend « P03 · DCE — 12 h » — existe depuis des
  semaines et n'a **qu'un seul appelant** : le cas où un congé entre en conflit
  avec la charge (`Planning.tsx:1808`).

Le vrai défaut n'est pas l'absence d'écran. C'est que **`derive.evenements()`
— l'inventaire unique des dates qui comptent — est aveugle à la moitié du
temps de l'agence** : il ignore les périodes d'intervention des entreprises,
les congés, les visas, les situations attendues, les limites de vérification,
les points de séance et les échéances fournisseurs.

C'est cette incomplétude, et elle seule, qui a fait ouvrir huit portes pour
lire une semaine.

**On ne construit donc pas un écran de plus. On complète un inventaire et on
renomme une route.** `#/` devient « Semaine du 10 au 16 mars », et
« Aujourd'hui » redevient ce qu'il aurait toujours dû être : un **filtre de
jour**, pas un écran.

**Ce que la semaine montre**, dans l'ordre de la question posée — sept
colonnes, quatre bandes :

1. **Rendez-vous** — heure, projet, participants ;
2. **Sur le chantier** — une puce par lot et par entreprise, les chevauchements
   hachurés, les interventions non confirmées badgées ;
3. **Nous deux** — congés en creux, charge planifiée en clair, heures
   saisissables sur place ;
4. **Ce qui tombe** — toute échéance datée, sans troncature.

Dessous, la file du matin actuelle, code inchangé — c'est le meilleur écran de
l'outil, on n'y touche pas. En pied, deux replis : l'argent, et les heures
agrégées. Lire la trésorerie avant de savoir qui est sur quel chantier, c'est
l'ordre inverse de celui d'un lundi matin.

### 2.2 Le projet contient ce qui le concerne

Le projet est aujourd'hui une destination parmi seize, alors qu'il est la
moitié de l'outil — et il est démembré : ses situations sont dans Situations,
ses phases dans Planning, ses fichiers dans Documents, son contrat dans
Finance, ses heures dans Temps.

**Le signe qui ne trompe pas** : chacun de ces écrans porte un sélecteur
« Projet » qu'on règle toujours sur le même projet. C'est la signature d'un
morceau exilé, pas d'une vue de recoupement.

**Le test qui tranche, et qu'on appliquera partout** : une liste transverse est
légitime seulement quand sa question est **insoluble dans un projet**. Trois cas
seulement :

- l'objet **n'a pas encore de projet** — boîte d'arrivée, courriers à
  rattacher, radar d'appels d'offres ;
- l'objet **appartient à plusieurs projets à la fois** — le portefeuille d'une
  entreprise, une entreprise attendue sur deux chantiers, la charge d'une
  personne ;
- l'objet **appartient à l'agence et non au travail** — banque, comptable, TVA,
  numérotation légale, Chorus, congés.

Tout le reste rentre dans le projet.

**La fiche projet passe de neuf endroits à quatre moments.** Elle a aujourd'hui
sept onglets, deux sous-onglets et un menu « Plus ». Un projet a des moments —
on l'étudie, on le consulte, on le construit, on le solde — et ce sont eux qui
doivent la structurer, pas les types de données. On n'ajoute aucun onglet : on
en retire cinq.

### 2.3 La conséquence la plus nette

**Situations n'est pas une destination : c'est une vue de l'écran
Entreprises.** Ses quatre onglets répondent déjà aux colonnes qu'Entreprises
affiche — « Attendues » correspond à la statistique « Situations attendues »,
« Retenues de garantie » à la colonne « RG à libérer », et les deux autres
regroupent par projet (le titre de la carte est littéralement « Historique —
par projet »).

Entreprises, elle, reste : c'est **la** vue de recoupement légitime, celle qui
répond à une question insoluble dans un projet.

---

## 3. La table de correspondance

Six destins possibles. « Inchangé » doit se justifier à chaque fois : c'est le
destin qui ne coûte rien à écrire et qui annule la refonte s'il est choisi trop
souvent.

### 3.1 Les seize destinations du menu

| Destination | Adresse | Devenir |
|---|---|---|
| Aujourd'hui | `#/` | **ancre** — devient « La semaine » ; « aujourd'hui » redevient un filtre de jour |
| Projets | `#/projets` | **ancre** |
| Entreprises | `#/entreprises` | **inchangé** — vue de recoupement légitime ; elle *absorbe* Situations |
| Finance | `#/finance` | **inchangé** — l'argent appartient à l'agence, pas au projet |
| Développement | `#/ao` | **inchangé** — un dossier n'a pas encore de projet |
| Situations | `#/situations` | **vue de Entreprises** — la route survit pour les liens et la recherche |
| Planning | `#/planning` | **fondu** — 2 onglets vont à la semaine, 2 au projet |
| Temps | `#/temps` | **fondu dans la semaine** — la saisie est déjà là ; route conservée |
| Mes tâches | `#/taches` | **fondu dans la semaine** — les tâches sont déjà toutes dans la file du matin |
| Documents | `#/documents` | **fondu** — le registre va au projet, la file d'arrivée à la semaine |
| Pilotage | `#/pilotage` | **replié** — un seul de ses quatre onglets est transverse |
| Propositions IA | `#/propositions` | **replié** (groupe Agence) — l'alerte de la semaine reste sa porte principale |
| Annuaire | `#/ressources` | **replié** (groupe Agence) |
| Échéances agence | `#/agenda` | **replié** (groupe Agence) |
| Assistant | `#/assistant` | **replié** (groupe Outils) |
| Automatisations | `#/automatisations` | **replié** (groupe Outils) |

**Menu visible : 5 entrées** (La semaine, Projets, Entreprises, Finance,
Développement) **+ un groupe « Agence » replié** contenant le reste.

### 3.2 Les quarante-six onglets

**Finance (9)** — L'essentiel · Ventes · Achats & frais · Banque · Contrats ·
Comptable · Revue · Prévisions · Connecteurs
→ **inchangés sauf deux** : « Contrats » se scinde (la moitié clients rejoint
le projet, la moitié agence est un doublon franc d'Échéances agence) et
« Revue » se replie (deux de ses quatre cartes sont des files par projet).
**−2 endroits.**

**Fiche projet (9)** — Pilotage & honoraires · Documents (+ 2 sous-onglets :
Tous les documents, DCE structuré) · Planning · Chantier & CR · Finance ·
Équipe & ressources · Journal · menu « Plus »
→ **4 moments** : Étudier · Consulter · Construire · Solder. **−5 endroits.**

**Développement (6)** — Radar · Pipeline · Dossiers · Consultations ·
Acheteurs · Références
→ **inchangés.** Un dossier d'appel d'offres n'a pas encore de projet : c'est le
premier des trois cas légitimes, et ces six vues sont les étapes d'un même
entonnoir.

**Situations (4)** — À vérifier · Attendues · Historique · Retenues de garantie
→ **vues d'Entreprises** (Attendues et RG existent déjà comme colonnes) et
**de la semaine** (À vérifier est daté). Historique rejoint le projet.
**−4 endroits.**

**Planning (4)** — Échéances · Études · Chantier / OPC · Charge & absences
→ Échéances et Charge & absences **vont à la semaine** ; Études et Chantier/OPC
**fusionnent** et deviennent le « voir plus » de la bande chantier, routes
conservées. **−3 endroits.**

**Documents (3)** — À vérifier · À rattacher · Tous les documents
→ les deux premiers **vont à la semaine** (ils sont datés et sans projet), le
troisième **va au projet**. **−3 endroits, destination supprimée.**

**Réglages (4)** — Agence & coûts · Branchements · Sauvegarde & données · Bien
démarrer
→ **inchangés.** C'est là qu'on répare quand ça tombe en panne : jamais replié
au point d'être introuvable.

**Annuaire (3)** — Entreprises · Contacts · Matériaux
→ « Entreprises » **fondu** dans la destination Entreprises (doublon), les deux
autres **inchangés**. **−1 endroit.**

**Temps (2)** — Ma semaine · Historique (6 semaines)
→ « Ma semaine » **va à la semaine** ; « Historique » **replié**.
**−2 endroits, destination supprimée.**

**Échéances agence (2)** — Obligations · Contrats de l'agence
→ **repliés** dans le groupe Agence ; « Contrats de l'agence » absorbe le
doublon venu de Finance. **−1 endroit.**

### 3.3 Le décompte

Deux comptes différents, et il faut les distinguer — la tranche 1 me l'a
appris en me contredisant.

**Ce que l'on VOIT** — ce dont l'agence se plaint :

| | Avant | Après |
|---|---:|---:|
| Destinations visibles au menu | 16 | **5** (+ 1 groupe replié) |

**Ce que l'on MESURE** — ce que le contrôle compte, et qui seul empêche la
rechute :

| | Avant | Après visé |
|---|---:|---:|
| Entrées de menu | 16 | **9** |
| Sous-onglets | 59 | **38** |
| **Endroits** | **75** | **≈ 47** |

**−37 % d'endroits mesurés, et le menu visible divisé par trois.** Aucune
donnée, aucun calcul, aucun geste n'est perdu.

> **La distinction n'est pas cosmétique.** Replier une destination dans un
> groupe fermé la retire de la vue mais PAS du compte : la route existe, le
> code aussi. C'est voulu — on ne supprime rien — mais cela veut dire qu'une
> refonte qui se contenterait de replier ferait baisser la gêne sans faire
> baisser la dette. Les tranches 3 et 4 sont celles qui retirent vraiment des
> endroits ; la tranche 2 ne fait que rendre l'outil respirable en attendant.

---

## 4. Les règles d'homogénéité

L'agence dit « rien n'est vraiment homogène ». Ce n'est pas une impression :
**éditer** une situation ouvre une modale, une période de marché se modifie
dans un tableau en ligne, une tâche ouvre une fiche, un point de séance se
modifie sur la ligne. Quatre façons de faire la même chose.

> *Cette section repose sur ma propre lecture du code, moins exhaustive que le
> reste du document : l'analyse dédiée n'a pas abouti. Les patrons sont exacts,
> le comptage des écrans à migrer est à faire avant de s'engager sur un délai.*

Un patron par famille, et les exceptions **assumées** — une règle qu'on
contourne en silence ne vaut rien.

| Famille | Patron unique | Exception assumée |
|---|---|---|
| **Éditer** | modale, pour tout objet qui a plus de trois champs | l'édition **sur la ligne** reste pour les listes de travail où l'on modifie vite et souvent (relevé de séance, périodes d'intervention) — ouvrir une modale par point de séance serait plus lent, pas plus homogène |
| **Lister** | le composant `Table` (`src/ui.tsx`) : colonne figée, défilement encapsulé, repli en cartes sous 700 px | les gabarits d'impression de `pdf.ts` sont du texte, pas des écrans |
| **Créer** | ligne de saisie **permanente en pied de liste**, dans les mêmes colonnes | la création d'un projet reste un assistant : vingt champs ne se saisissent pas en ligne |
| **Confirmer** | toast avec « Annuler » de 8 s | confirmation explicite avant un geste **destructeur** ou **irréversible** (suppression, émission d'un document contractuel) |
| **Atteindre un détail** | route adressable, mise en évidence à l'arrivée | aucune — c'est la règle qui a le plus manqué, et le test des « portes » la protège désormais |

---

## 5. L'ordre des travaux

Quatre tranches. Chacune est **réversible**, laisse l'outil utilisable, et se
mesure. **La première se voit tout de suite** : personne ne fait confiance à une
refonte dont le premier effet arrive dans trois semaines.

**Tranche 1 — La semaine devient vraie.** Compléter `derive.evenements()` pour
qu'il voie enfin les périodes d'intervention, les congés, les visas, les
situations attendues, les points de séance et les échéances fournisseurs ;
brancher `chargeParPhase` sur l'écran ; renommer `#/` en « Semaine du X au
Y ». *Aucun endroit supprimé encore — mais huit portes cessent d'être
nécessaires le lundi matin.* C'est la tranche qui donne raison ou tort au plan.

**Tranche 2 — Le menu se réduit.** Passer de 16 à 5 destinations visibles + un
groupe replié. Routes toutes conservées : rien ne casse, la recherche et les
liens existants continuent de fonctionner. *−11 destinations visibles.*

**Tranche 3 — Situations devient une vue d'Entreprises**, et le registre
documentaire rejoint le projet. *−7 endroits.*

**Tranche 4 — La fiche projet passe à quatre moments.** La plus délicate : elle
touche l'écran le plus utilisé. À faire en dernier, quand les trois premières
auront prouvé la méthode. *−5 endroits.*

---

## 6. La mesure, et ce qui empêchera la surface de regrimper

Le décompte avant/après est donné tranche par tranche à la section 5. Mais un
chiffre qu'on ne vérifie pas se périme — c'est exactement ce qui vient de se
passer.

**Trois contrôles mécaniques, à écrire avec la tranche 1 :**

1. **Un plafond d'endroits.** Un test compte les destinations de `NAV` et les
   jeux d'onglets de chaque écran, et échoue si le total dépasse le plafond
   fixé. Ajouter un endroit devient une décision explicite : il faut relever le
   plafond, donc l'écrire, donc l'expliquer.
2. **Un plafond de cartes par écran.** Aucun écran ne dépasse N cartes visibles
   au premier rendu. C'est ce qui a fait déborder l'onglet Chantier.
3. **Le patron d'édition est unique**, sauf exceptions inventoriées — même
   forme que l'inventaire des tableaux : la liste se compare à la réalité dans
   les deux sens, et une exception non déclarée fait échouer le test.

Ces trois contrôles sont la vraie livraison de ce document. Sans eux, on
réécrira le même plan dans six mois.

---

## 7. Ce qu'on ne fera pas, et pourquoi

1. **Pas d'écran « La semaine » construit à côté de l'accueil.** Il existe déjà
   à moitié. En livrer un second aurait ajouté une destination pour résoudre un
   problème de surface — l'erreur exacte qu'on répare.

2. **Pas de suppression, à aucun moment.** Tout ce qui se replie reste à un
   clic, et l'inventaire Finance coché à deux reste l'arbitre de ce qui se
   replie. Aucun masquage décidé par la machine seule.

3. **Pas de refonte du Cockpit.** Sa file du matin unifiée est le meilleur écran
   de l'outil. On l'alimente mieux, on ne la redessine pas.

4. **Pas de réduction à une seule porte pour le certificat de paiement.**
   L'agence a demandé de « pouvoir gérer aussi sur chaque chantier ». On passe
   de trois adresses à deux — Situations perd la sienne au profit
   d'Entreprises — sans toucher au code, qui est verrouillé pour qu'il n'y ait
   qu'un seul auteur.

5. **Pas de repli des Réglages au-delà du raisonnable.** C'est là qu'on répare
   une panne : un écran de secours introuvable n'est pas un écran de secours.

6. **Pas de confiance aveugle dans la recherche.** Replier suppose de
   retrouver. La palette « / » n'indexe pas encore tout ce qu'on s'apprête à
   replier : chaque tranche doit vérifier que ce qu'elle replie reste
   trouvable, sans quoi « replié » veut dire « perdu ».

---

*Document établi le 07/08/2026 contre le code du commit `f8f5677`. Les
références `fichier:ligne` vieilliront ; les noms affichés, eux, se retrouvent.
Règle de mise à jour : toute proposition dit ce qui disparaît de la vue, et le
décompte de la section 3.3 se recalcule à chaque tranche.*
