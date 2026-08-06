# Plan d'action — audit d'usage du 05/08/2026

**Commande de l'agence :** « un audit complet du site sur l'usage. L'idée c'est la
simplicité d'utilisation, le gain réel de temps, le regroupement d'informations » —
et la règle qui tranche tout : **« simplifier la vie, pas la complexifier »**.

**Méthode.** Huit auditeurs ont couvert l'application entière par domaine (accueil
et courrier ; projets et pilotage ; chantier et entreprises ; finance ; temps et
tâches ; documents et assistance ; développement commercial et réglages), chaque
constat vérifié dans le code avec sa référence `fichier:ligne`. En parallèle,
**douze parcours réels du quotidien ont été comptés geste par geste**. Les trois
critères de la commande servent de grille : chaque constat est classé **temps**,
**simplicité** ou **regroupement**. Les recoupements entre auditeurs sont fusionnés —
un problème vu deux fois est un constat, renforcé, pas deux.

**Le verdict tient en une phrase :** rien de structurel n'est à refaire. Les
frictions sont des frictions de **parcours** — le geste commence sur un écran et
finit sur un autre, l'outil sait et fait retaper, la donnée existe et n'est pas
montrée. Presque tout se corrige en heures ; la donnée et le composant existent
déjà dans neuf cas sur dix, c'est le **montage au point de décision** qui manque.

Trois claims lourds ont été re-vérifiés dans le dépôt avant d'écrire ce plan :
`usePropositions`/`revuePropositions.ts` ne sont importés par aucun écran,
`Marche.avanceForfaitaireHT` est lu par le certificat mais écrit par personne,
`projeterVersTemps`/`tempsParTache` (`src/pointages.ts:174,220`) n'ont aucun
appelant. Les auditeurs ne se sont pas trompés.

---

## 1. Ce qui marche et qu'on protège

Toute retouche de ce plan doit passer AUTOUR de ces acquis, jamais à travers.
Ils sont cités parce que chacun est fragile à sa manière : il suffit d'une
« amélioration » mal placée pour le casser.

- **Le centre d'actions unifié de l'accueil** : UNE file du matin (courriers,
  tâches, alertes graves, finance), un seul tri gravité/échéance, filtre calé sur
  la personne connectée (`Cockpit.tsx:225-231, 1062-1064`). La question « quoi
  faire aujourd'hui » a une réponse en une ouverture — c'est le meilleur écran de
  l'outil, et la raison pour laquelle aucune notification poussée n'est nécessaire.
- **« Annuler » systématique** : chaque geste pose un toast avec undo de 8 s
  (`ui.tsx:538-542`). L'erreur ne coûte rien, donc la vitesse est permise. Toute
  nouvelle action doit garder ce contrat.
- **Une seule autorité par notion** : `entreprise.ts` (situation attendue, texte
  de relance), `financeActions.ts` (« à facturer » identique pour la tuile, le
  badge et l'accueil), `totalSemaine` (`temps.ts:48`), `garantieDuMarche`,
  `finGPA`, `prolongationDelai`. C'est ce qui rend les chiffres crédibles ; le
  constat R3 ci-dessous liste précisément les endroits où cette règle n'est PAS
  encore tenue.
- **Finance « L'essentiel »** : six tuiles sans calcul local, chacune lisant le
  sélecteur de son onglet de détail, verrouillé par
  `scripts/test-finance-essentiel.cjs`. Le parcours 5 (trésorerie + TVA du
  vendredi) tient en 2 gestes — c'est la référence, et le modèle du geste
  « regrouper sans supprimer » que les autres sphères doivent imiter.
- **« null n'est pas 0 », partout** : taux CCAP absent → badge « taux ? » jamais
  « 0 € », contrôle de situation qui DIT ses manques, indice périmé → badge sur le
  marché. La confiance dans les badges repose là-dessus — et le constat S2 montre
  qu'elle s'use vite dès qu'un badge ment.
- **Les documents émis sont figés** : facture, certificat de paiement —
  réimpression depuis la copie figée avec empreinte SHA-256, jamais recalcul
  (`pdf.ts:34-126, 294`). Le constat S6 pointe le seul générateur qui déroge.
- **Jamais d'envoi machine** : tout « envoyer » est un brouillon Gmail pré-rempli,
  le clic final est humain. Les actions de relance ajoutées par ce plan gardent ce
  patron — aucune exception.
- **La chaîne proposer → « Voir pourquoi » → corriger → valider** des documents et
  du rattachement (`Documents.tsx:340-349, 1356-1364`), la revue au clavier, le
  rangement qui n'écrase jamais (`fsdrive.ts:194-216`). Ossature du domaine le
  plus abouti — on y branche des raccourcis, on ne la contourne pas.
- **La transition des deux mémoires du courrier** : fusion, dédoublonnage,
  traitement des deux jumeaux, et une mesure de parité chiffrée (`#/parite`) qui
  conditionne la coupure au lieu de l'espérer (`boite.ts:271-296`). C'est un filet,
  pas une redondance à « simplifier ».
- **Les états vides qui disent le geste suivant**, les confirmations détaillées
  avant tout geste destructeur, la suppression de projet bloquée si des factures
  existent, la bannière de mise à jour qui ne recharge jamais toute seule
  (`App.tsx:28-40`) : le respect de la saisie en cours avant tout.

---

## 2. Les constats qui comptent

Dédoublonnés et croisés. Quand deux auditeurs (ou un auditeur et un parcours)
ont vu la même chose indépendamment, c'est dit — c'est le meilleur indice de
gravité réelle.

### 2.1 Gain réel de temps

**T1 — Le moteur sans porte : l'intelligence promise est invisible.** Les
détections serveur (tâches, échéances, décisions, risques dans les mails)
s'accumulent en base sans aucun écran de revue — `usePropositions` et les quatre
gestes accepter/modifier/attribuer/ignorer ne sont consommés nulle part
(`propositions.ts:768`, `revuePropositions.ts:58`), l'alerte « N propositions à
revoir » ne se déclenche jamais (`Cockpit.tsx:746-749` ne passe pas
`ctx.propositions`) et son lien `#/messages/propositions` n'a pas de route. Même
famille : le signal « quelqu'un attend une réponse depuis N jours » a son
producteur et son sélecteur (`alerts.ts:107-122`, `communications.ts:811`) mais
aucun flux d'entrée. **Impact majeur** : on retraite à la main ce que la machine
a déjà détecté — le gain de temps central promis n'existe pas au quotidien.

**T2 — Le geste commence ici et finit ailleurs.** Vu par TROIS auditeurs et
quatre parcours, c'est la friction dominante de l'outil : le contrôle 5.5 des
situations ne s'affiche que dans la modale « Éditer » alors qu'on clique
« Valider » dans la liste (`Situations.tsx:137-187, 606, 761`) ; le certificat
s'émet dans l'onglet Historique après validation dans « À vérifier »
(`Situations.tsx:1030-1039`) ; rattacher un mail vu à l'accueil se fait dans
Documents (`Cockpit.tsx:585` vs `Documents.tsx:1288`) ; décaler les dates d'une
phase constatée en retard dans la fiche exige Planning global
(`ProjetPlanning.tsx:291` vs `Planning.tsx:122-249`) ; la piste de report d'un
congé ne mène pas à la phase à décaler (`Planning.tsx:719-762`). À chaque fois
la donnée ET le composant existent — c'est le montage au point de décision qui
manque. **Impact majeur cumulé.**

**T3 — L'outil sait et fait retaper.** L'avance forfaitaire n'est saisissable
nulle part alors que le certificat la lit (`types.ts:371` écrit par personne,
`certificat.ts:170`) : chaque certificat propose 0 d'avance et 0 de résorption,
à corriger état après état. Le mois de la note d'honoraires manquante se retape
alors que `moisManquants()` le connaît (`Projets.tsx:876-877, 997`). Le nom
d'entreprise et son contact se retapent à chaque marché (`ProjetChantier.tsx:335-337`,
`entrepriseId` jamais posé). Le solde bancaire importé existe et Paramètres fait
retaper un solde manuel (`Parametres.tsx:1054-1070` vs `Banque.tsx:526-541`),
que Pilotage affiche (`Pilotage.tsx:71, 98-102`). Le BT01 auto-récupéré se
recopie à la main pour le barème (`Parametres.tsx:1250-1255` vs
`indicesInsee.ts:106-113`). Le terme cherché au « / » se retape à l'arrivée sur
la liste (`RechercheOverlay.tsx:81, 158, 179`). **Impact majeur cumulé** — c'est
la différence entre « l'outil m'aide » et « l'outil me fait remplir ».

**T4 — Le chrono qui rassure est celui qui ne compte pas.** Arrêter un chrono
affiche « X h enregistrées » mais ce temps n'apparaît nulle part : ni dans « Ma
semaine » (seule source de la marge), ni sur la tâche (« Enregistré : 0:00 »
juste sous le bouton, `FicheTache.tsx:317`), ni dans aucun écran —
`state.pointages` est une collection écrite-seulement (`pointages.ts:174, 220`
sans appelant). Le branchement de la projection est **acté au plan (B.4/B.5/B.9,
test déjà écrit)** et n'est pas re-proposé — mais l'état intermédiaire actuel,
où le toast affirme enregistrer un temps qui ne compte nulle part, exige un
garde-fou immédiat. **Impact majeur** : temps perdu, ou ressaisi (double
comptage le jour du branchement), ou cru compté (marge fausse dès aujourd'hui).

**T5 — Les listes qui grossissent enterrent le geste.** L'historique des
situations est plafonné à 6 lignes par projet sans « voir plus »
(`Situations.tsx:978`) : sur un chantier de 8 lots, le bouton « Certificat de
paiement » devient **inaccessible**, pas seulement lent. « Chercher dans les
CR » se désactive à 16 CR sans offrir le moindre levier (`Assistant.tsx:399-402,
471-475`) : un chantier suivi un an rend l'onglet définitivement inutilisable.
« Factures émises » est triée du plus ancien au plus récent, sans recherche
(`Facturation.tsx:1216`). La liste des projets mélange vivants et terminés,
triée par ordre de création (`Projets.tsx:200-226`). **Impact majeur** — ces
quatre-là sont les listes qui grossiront mécaniquement.

**T6 — L'atterrissage rate sa cible.** Vu par trois auditeurs : les liens
d'alertes et de recherche déposent en HAUT d'une liste au lieu de l'élément
(`alerts.ts:186, 201, 219, 443`) ; la fiche consultation — le lieu du Go/No-Go —
n'a pas d'URL, donc carte Kanban, dossier et Cockpit déposent devant la liste
(`Developpement.tsx:93`, `Dossiers.tsx:206-208`, `Cockpit.tsx:150`) ; les liens
de la fiche entreprise tombent tous sur le mauvais onglet de Situations
(`FicheEntreprise.tsx:111-198`, onglet en `useState` local) ; l'alerte CRM ouvre
l'écran d'où les contacts ont déménagé (`alerts.ts:410`, `derive.ts:1307`) ; et
les alertes mail pointent `#/messages/{id}`, route qui n'existe pas — le clic
retombe sur l'accueil sans un mot (`alerts.ts:96-136` vs `App.tsx:239-336`).
**Impact majeur cumulé, plusieurs fois par jour.**

**T7 — Retrouver une pièce finit hors de l'outil.** Le registre affiche le
chemin Drive de chaque document mais rien ne l'ouvre (`Documents.tsx:903, 1058`),
alors que la racine persistée sait lire (`fsdrive.ts:80-104`) : le geste le plus
fréquent du domaine documentaire — relire une pièce — se termine
systématiquement dans l'explorateur, chemin mémorisé de tête. **Impact majeur.**

**T8 — Facturer se termine en cul-de-sac doux.** Après « Émettre », le toast
renvoie au menu de la ligne — à retrouver en bas d'une liste triée à l'envers —
pour le PDF puis l'e-mail (`Facturation.tsx:415, 1795-1815`) : 3-4 gestes de
trop sur le geste central du mois. La relance d'impayé copie un brouillon à
coller dans Gmail alors que l'outil sait ouvrir Gmail pré-rempli et connaît le
destinataire (`Facturation.tsx:1108-1148`). **Impact majeur/moyen, mensuel.**

### 2.2 Simplicité d'utilisation

**S1 — L'écran montre le problème sans le bouton qui le règle.** Le badge
« projet ? » n'est pas cliquable et le geste vit dans Documents
(`Cockpit.tsx:585`) ; l'alerte « situation attendue non reçue » n'a pas de
« Relancer » alors que l'alerte jumelle des notes d'honoraires l'a
(`alerts.ts:229-240` vs `317-319`) — même geste, un parcours à 2 clics et un à
5 ; la carte « Écart avec le solde manuel » de Banque n'a pas le bouton qui
règle l'écart (`Banque.tsx:526-541`) ; « limitez ce projet à 16 CR » sans aucun
moyen de limiter (`Assistant.tsx:471-475`). **Impact moyen à majeur.**

**S2 — Des affichages qui mentent un peu — et un badge qui crie pour rien finit
ignoré.** La semaine avec 2 j de congé s'affiche « incomplète » (théorique = 35 h
fixes, `Temps.tsx:583`, alors que `capacitePersonneSemaine` sait) ; la réunion
créée pour la semaine prochaine naît « CR à générer » en orange
(`ProjetChantier.tsx:1812-1827`, le statut « à venir » n'est jamais posé) ; le
message des pénalités dit « report à la main » alors que le certificat déduit
automatiquement (`ProjetChantier.tsx:865-866, 1025` vs `certificat.ts:217-228`)
— suivre le message fait **payer la pénalité deux fois** à l'entreprise ; la
boîte tronquée à 50 messages ressemble à une file finie (`Cockpit.tsx:288, 337`) ;
« manquante » dès le 1er du mois contredit le critère partagé du 10
(`Situations.tsx:1113-1119` vs `entreprise.ts:103-129`) ; la pastille Santé est
verte pour un branchement jamais testé (`Sante.tsx:176`) ; le PDF du plan de
charge ignore les congés que l'écran déduit (`Planning.tsx:963-966`). **Impact
moyen cumulé** — la confiance dans les badges est l'actif n° 1 de l'outil.

**S3 — Le rare enterré devant le fréquent.** La fiche projet ouvre sur les
honoraires MIQCP réglés une fois, le tableau des phases passe sous la ligne de
flottaison (`Projets.tsx:445-452`) ; l'onglet Chantier empile six cartes quel
que soit l'état du projet (`ProjetChantier.tsx:2297-2316`) ; le plan de charge
affiche ~52 colonnes de semaines dont 4 passées pour une question qui porte sur
8-12 semaines (`Planning.tsx:1019-1032` — vu par DEUX auditeurs) ; la table des
indices INSEE, désormais en historique complet, va enterrer l'onglet « Agence &
coûts » (`Parametres.tsx:802-905`) ; la page Branchements dit chaque état deux
fois (`Parametres.tsx:1380-1387`). **Impact moyen.**

**S4 — Les restes de jargon machine.** Trois `window.prompt` (report d'alerte à
date en AAAA-MM-JJ `Cockpit.tsx:256-259`, justification bancaire
`Banque.tsx:383-391`, nouvelle tâche `Taches.tsx:102-116`) ; codes nus sans
libellé alors que `LIBELLES_PHASES` et les descriptions d'arborescence existent
(`Cockpit.tsx:1229-1231`, `Temps.tsx:637`, `Achats.tsx:176, 294`,
`Documents.tsx:363-373`) ; champ « Confiance 0 à 1 » à retaper au clavier
(`Situations.tsx:525-527`) ; quatre noms pour le même écran Développement
(`App.tsx:99`, `VeilleAO.tsx:1314`, `Sante.tsx:207`). **Impact mineur, mais vu
par QUATRE auditeurs** : c'est l'écart entre « utilisable par elles deux » et
« utilisable par quiconque les remplace une semaine ».

**S5 — Une décision du 04/08 sans écran.** Le régime de TVA se « règle » dans un
champ libre sans aucun effet (`Comptable.tsx:135-137`) pendant que le vrai
interrupteur, `settings.regimeTVA` — le seul lu par `positionTVA`
(`tva.ts:64-66`) — n'a pas d'écran. Si le cabinet répond « option débits »,
taper sa réponse ne change rien. **Impact moyen : trou de livraison de la
décision « position TVA réglable », pas une re-proposition.**

**S6 — Deux régimes de vérité dans la même famille de PDF.** La facture et le
certificat se réimpriment figés avec empreinte ; le décompte remis à l'entreprise
est recalculé à chaque impression sans mention (`pdf.ts:212` vs `34-126, 294`),
son infobulle l'appelle « certificat de paiement » (`Situations.tsx:766`), et
deux générateurs impriment une date d'« édition » qui n'en est pas une
(`pdf.ts:456, 249`). Sur des documents qui engagent, **impact moyen**.

### 2.3 Regroupement d'informations

**R1 — La fiche projet ne répond pas à « où en est ce projet ? » côté
opérationnel.** Les alertes portent toutes un `projetId` (`alerts.ts:44`) mais
ne s'affichent qu'à l'accueil : visa en retard, entreprise à confirmer, CR à
sortir, note manquante se découvrent en ouvrant le Cockpit et en repérant les
lignes du projet parmi toutes (`Projets.tsx:445-453`). Le Cockpit, lui, ne
filtre que par personne — impossible d'afficher « tout ce qui crie sur P03 ».
Conséquence chiffrée : préparer la réunion de chantier = **12 gestes, 4 écrans,
synthèse de tête** (parcours 6), alors que chaque brique est calculée et testée.
**Impact majeur — vu par deux auditeurs et un parcours.**

**R2 — L'identité entreprise est éclatée.** Le nom est un champ libre sans
`entrepriseId` (« Martin BTP » ≠ « SARL Martin BTP » scinde la fiche 5.20 en
silence, `ProjetChantier.tsx:335-337`, `types.ts:316`) ; et l'onglet
« Entreprises » de l'Annuaire édite `state.artisans` alors que rattachement,
fiche transverse et factures fournisseurs lisent `state.entreprises`,
resynchronisées à l'amorçage seulement (`store.tsx:292-317`,
`rattachement.ts:131-143`). Deux vérités possibles pour la même entreprise.
**Impact moyen — deux auditeurs.**

**R3 — La même notion codée deux fois, avec deux résultats possibles.** Deux
cartes d'import bancaire dont une perd le solde (`Banque.tsx:556-576` vs
`Connecteurs.tsx:79` qui enregistre `soldeFinal: null` — un OFX importé là ne
mettra JAMAIS à jour la trésorerie, sans un mot) ; le prévu/réel d'heures par
phase affiché deux fois dans la même fiche avec deux dénominateurs — après un
recalcul, 105 % et 80 % pour la même phase (`Projets.tsx:1236-1268` vs `1728`) ;
le montant travaux en deux endroits jamais confrontés, dont celui qui sert la
facturation DET (`ProjetChantier.tsx:122-222` vs `derive.ts:692-701`) ;
`TYPES_DOC` recopié divergent de `CATEGORIES_DOC` (`ProjetDocuments.tsx:27`,
`Classement.tsx:13`) ; Pilotage et Revue qui recouvrent trois vues
(`Pilotage.tsx:76-95` vs `Revue.tsx:157-307`). **Impact moyen à majeur** — c'est
exactement la divergence que la règle « une seule autorité » a été écrite pour
empêcher.

**R4 — Des saisies que rien ne relit.** « Prochaine action » + « Pour le » d'une
organisation ne sont lus par aucun producteur d'alerte (`Organisations.tsx:302-307`
vs `alerts.ts:401-413` qui ne lit que les contacts — **vu par deux auditeurs**) ;
les rectificatifs et ANNULATIONS BOAMP sont rattachés aux consultations mais
aucun écran ne les affiche — on peut monter le dossier d'un avis annulé
(`VeilleAO.tsx:206-212`) ; `settings.vus` est filtré mais jamais écrit
(`alerts.ts:471-489`). **Impact moyen.**

**R5 — Le centre d'actions a des angles morts.** Un dossier « Go » à J−3 de la
remise n'a aucun rappel central (`Cockpit.tsx:144-155`) — le risque le plus
coûteux du développement ; la file « À rattacher » n'a de compteur nulle part
(`Documents.tsx:1566-1586`) ; une tâche « à attribuer » disparaît de la vue par
défaut des DEUX utilisatrices (`taches.ts:361`) ; le filtre « Tout » de la boîte
masque les messages adressés à l'autre associée (`Cockpit.tsx:553-556`) ; la
recherche « / » ignore les tâches, l'entité quotidienne depuis B.12
(`RechercheOverlay.tsx:58-206`). **Impact moyen.**

**R6 — Ce que l'agence produit sort de sa propre mémoire.** Le DOCX généré par
l'Assistant part en Téléchargements sans entrer au registre ni au Drive, alors
que la source `'genere'` existe et sert déjà aux CR (`Assistant.tsx:573-584`) ;
le dépôt de l'onglet projet n'appelle pas le moteur de classement et fait tout
retaper (`ProjetDocuments.tsx:206-227`). **Impact moyen.**

### 2.4 Les douze parcours, comptés

Gestes actuels mesurés dans le code, gestes visés après les horizons « cette
semaine » + « ce mois-ci » de la section 3. Les parcours 5 et 12 sont déjà bons :
on n'y touche pas, ils servent de témoins. Le 7 ne reçoit qu'une datalist — s'il
bougeait de plus de deux gestes, ce serait le signe qu'on a débordé.

| # | Parcours | Gestes actuels | Visés | Ce qui fait la différence |
|---|---|---:|---:|---|
| 1 | Lundi matin : traiter le courrier (10 mails, 4 PJ) | ~35 / 2 écrans | ~22 / 1 écran | rattachement inline (S1), mails dans la revue séquentielle, liens d'alerte réparés (T6) |
| 2 | Saisir 3 h au retour de réunion | 5 + calcul de tête | 4 | `useMoi` par défaut (T3) ; le calcul de tête tombera avec B.4/B.5 (plan) |
| 3 | Situation reçue → contrôle → certificat | 12 / 2 onglets, 2 modales | ~7 / 1 onglet | contrôle 5.5 au point de validation, enchaînement certificat, historique déplafonné (T2, T5) |
| 4 | Relancer une entreprise en retard | 5 | 2 | « Relancer » sur l'alerte même, patron des notes d'honoraires (S1) |
| 5 | Trésorerie + TVA du vendredi | 2 | 2 | **rien — témoin à protéger** |
| 6 | Préparer la réunion de chantier | ~12 / 4 écrans, de tête | ~3 / 1 écran | bloc « Préparer la réunion » assemblant les sélecteurs existants (R1) |
| 7 | Créer un projet complet | ~20 | ~18 | datalist MOA ; l'assistant 3 étapes reste tel quel |
| 8 | Fin de mois : notes des cotraitants | ~10 par note | ~6 | mois pré-rempli (T3), vue transverse « notes attendues » |
| 9 | Retrouver un mail/document ancien | 7, double recherche | ~3 | liens profonds de la palette (T6) + bouton « Ouvrir » du registre (T7) |
| 10 | Poser des congés et replanifier | ~12 | ~8 | pistes de report avec liens vers le geste (T2) |
| 11 | Enregistrer un marché complet | ~24 | ~18 | datalist entreprise + contact pré-rempli, avance forfaitaire enfin saisissable (T3) |
| 12 | Marquer la TVA déclarée | 4 | 4 | rien cette phase — l'échéance de décaissement attend le cabinet (§5) |

---

## 3. Le plan d'action

Priorisé par ratio gain/effort. Un « S » est une affaire d'heures, un « M » de
jours. Chaque action se rattache à un constat de la section 2 (ou au plan, cité).
Les livrables déjà actés au plan (`docs/PLAN_CDC_MAILS_TACHES_TEMPS.md`, Lot 5 et
complément du 04/08) ne sont **jamais** re-proposés : ils sont référencés.

### 3.1 Cette semaine — les S à impact majeur ou moyen

Quarante-sept actions d'heures chacune, groupées par écran pour être faites en
rafale. L'ordre des groupes suit le gain des parcours ; à l'intérieur d'un
groupe, on prend tout d'un coup — c'est le même fichier ouvert.

**Situations & chantier** (parcours 3, 4, 11 — le mensuel de l'argent)

1. Afficher le badge d'écart du contrôle 5.5 dans la ligne, et faire ouvrir par « Valider » un panneau montrant `BlocControle` quand l'écart dépasse le seuil — `Situations.tsx:137-187, 606, 761` (T2, **majeur**).
2. « Afficher tout (N) » + filtre mois/entreprise sur l'Historique : le plafond de 6 redevient un défaut d'affichage, pas une limite d'accès au certificat — `Situations.tsx:978, 1030-1039` (T5, **majeur**).
3. Après « Valider », proposer « Émettre le certificat » dans le toast — `Situations.tsx:647-654` (T2).
4. Bouton « Saisir une situation » réutilisant `ModalEdition` en création, pré-remplie depuis le marché — seul point d'entrée aujourd'hui : le JSON de la routine (`importRoutines.ts:297`) (S1).
5. Champ « Avance forfaitaire HT » dans `ModalMarche`, proposition 5 % décochable — lu par `certificat.ts:170`, écrit par personne (T3, **majeur** : fiabilise chaque certificat mensuel).
6. Datalist des entreprises connues sur `ModalMarche`, pose d'`entrepriseId`, contact/e-mail pré-remplis — `ProjetChantier.tsx:335-337` (T3, R2).
7. Pied de carte Marchés : « Total marchés : X € — travaux de l'opération : Y € », badge d'écart cliquable — `ProjetChantier.tsx:122-222` vs `derive.ts:692-701` (R3 : l'écart fausse la facturation DET en silence).
8. Reformuler le message des pénalités : « proposée en déduction au prochain certificat (ligne D) — ne la déduisez pas aussi de la situation » — `ProjetChantier.tsx:865-866, 1025` (S2 : évite la double pénalité).
9. Intempéries par période (« du… au… », jours ouvrés) + case « aussi sur les autres chantiers en cours » — `ProjetChantier.tsx:1222-1242` (T3).
10. La réunion créée à date future naît « à venir », pas « CR à générer » — `ProjetChantier.tsx:1812-1827` (S2).
11. Sous-routes `#/situations/rg|attendues|historique` (motif de `#/projets/:id/chantier`) et liens de la fiche entreprise mis à jour — `Situations.tsx:1280`, `FicheEntreprise.tsx:111-198` (T6).
12. Action « Relancer » (brouillon `entreprise.ts`) sur l'alerte « situation attendue non reçue », lien vers l'onglet Attendues — `alerts.ts:229-240`, patron de `Cockpit.tsx:679-690` (S1, parcours 4 : 5 gestes → 2).

**Accueil & alertes** (parcours 1, 9)

13. Alertes mail : supprimer le doublon (l'urgence passe en badge sur la ligne de boîte, déjà triée) et pointer vers le lien Gmail `urlGmail` tant qu'aucun écran message n'existe — `alerts.ts:96-117` vs `App.tsx:239-336`, route `#/messages` inexistante (T6, S2).
14. Le badge « projet ? » devient le geste : sélecteur de projet en ligne appelant `corrigerRattachement` (le composant `ChoixRattachement` existe, `Documents.tsx:1125`) — `Cockpit.tsx:585` (S1, T2 ; parcours 1).
15. Filtre « Tout » de la boîte : passer une liste d'adresses vide pour montrer VRAIMENT tout — `Cockpit.tsx:553-556` (R5 : en couvrant l'autre pendant ses congés, on ne voit pas ses mails).
16. « +N autres messages » avec le `chargerSuite` que le hook expose déjà — `Cockpit.tsx:288, 337` (S2 : une file tronquée ressemble à une file finie).
17. Inclure les lignes de la boîte dans la revue séquentielle (ou faire dire au bouton ce qu'il couvre) — `Cockpit.tsx:848-861, 931-969` (parcours 1 : le geste du lundi matin n'a pas son mode revue).
18. Liens CRM et pastille calendrier → `#/ressources/contacts` où vivent la liste et « Relancer » — deux constantes, `alerts.ts:410` et `derive.ts:1307` (T6).
19. Recherche « / » : indexer `state.taches` (état local, quelques lignes) et atterrir sur l'ÉLÉMENT — fiche du document (`ModalDocument`), filtre de destination pré-rempli pour factures/situations — `RechercheOverlay.tsx:58-206, 81, 158, 179` (R5, T6 ; parcours 9 : 7 gestes → 3).

**Finance** (parcours du mois)

20. Fin d'émission : la confirmation porte « Ouvrir le PDF » et « Préparer l'e-mail » (les deux fonctions existent) — `Facturation.tsx:415` (T8, **majeur**).
21. « Factures émises » : tri par émission décroissante + recherche numéro/libellé — `Facturation.tsx:1216, 1679-1701` (T5).
22. La relance ouvre Gmail pré-rempli (destinataire, sujet, corps) au lieu du presse-papier, trace posée au clic comme aujourd'hui — `Facturation.tsx:1108-1148` (T8).
23. Filtre d'état à payer / payées / toutes sur l'échéancier Achats — `Achats.tsx:416` (les factures payées disparaissent de l'écran).
24. Remplacer le champ libre « Régime de TVA » par un sélecteur encaissements/débits branché sur `settings.regimeTVA`, convention affichée dessous — `Comptable.tsx:135-137`, `tva.ts:64-66` (S5 : trou de livraison de la décision du 04/08).
25. Trésorerie : bouton « Reprendre le solde importé » dans la carte Écart de Banque (+ hint « lot F3 » périmé corrigé), et la tuile de Pilotage lit le solde importé comme Prévisions le fait — `Banque.tsx:526-541`, `Pilotage.tsx:71, 98-102`, `Parametres.tsx:1054-1070` (T3, vu par deux auditeurs).

**Temps & tâches** (parcours 2, 10)

26. Garde-fou chrono : ligne « Temps chronométré non reporté : X h » sous « Ma semaine », dépliable en liste (voir/corriger/supprimer), et toast honnête à l'arrêt (« enregistré — pas encore compté dans la feuille ») — `ChronoBarre.tsx:66`, `pointages.ts:174` (T4, **majeur** ; le branchement lui-même reste B.4/B.5/B.9 au plan).
27. `useMoi()` par défaut partout où l'identité est connue : sélecteur de « Ma semaine » (`Temps.tsx:470`) et pointage sur dossier (`Dossiers.tsx:770`) — T3, vu par deux auditeurs.
28. Badge de semaine calculé congés déduits via `capacitePersonneSemaine`, mention « sur X h (congés déduits) » — `Temps.tsx:583` (S2 : l'indicateur principal ment à chaque congé).
29. Les tâches sans responsable entrent dans le filtre par défaut (à deux, une tâche sans responsable est pour les deux) — `taches.ts:361` (R5).
30. Bouton ▶ sur chaque ligne de « Mes tâches » et sur la fiche projet — la bascule un-geste existe (`chrono.ts`) ; c'est la fin du livrable M.3 tel que le plan le décrit, dont seul le bouton de la fiche tâche est livré — `FicheTache.tsx:337` (écart de livraison signalé, pas une re-proposition).
31. Sélecteurs Projet et Phase sur la fiche tâche — sans eux, une tâche née sans projet ne se rattache JAMAIS et ses pointages n'atteindront jamais la marge, même après B.5 — `FicheTache.tsx:238-362`, `pointages.ts:179` (T4).
32. Pistes de report décomposées par projet/phase (« P03 · DCE — 12 h ») avec lien « ajuster » vers Études filtré — `Planning.tsx:670-676, 719-762` ; `chargePlanifieeSemaine` fait déjà la boucle (T2, parcours 10).

**Projets & pilotage** (parcours 6 en amont du lot du mois)

33. Bloc « À traiter sur ce projet » en tête de la vue d'ensemble : `alertesActives(...).filter(a => a.projetId === p.id)`, chaque ligne gardant son lien — `Projets.tsx:445-453`, `alerts.ts:44` (R1, **majeur** ; aucun calcul nouveau).
34. Projet signé → Honoraires et Complexité repliés en une ligne de résumé, `CartePhases` remontée sous le bandeau — `Projets.tsx:445-452, 1515` (S3).
35. Une seule table d'heures par phase (celle de l'onglet Finance, qui porte la référence §11.3), dénominateur `reference` partout — `Projets.tsx:1236-1268` vs `1728` (R3 : deux pourcentages contradictoires possibles).
36. Monter `EditionDates`/`EditionChantier` dans l'onglet Planning de la fiche, derrière « Ajuster les dates » — composants autonomes, seul le montage manque — `ProjetPlanning.tsx:291`, `Planning.tsx:122-249` (T2 : le geste le plus fréquent d'une phase chantier).
37. Liste des projets : filtre « Actifs » par défaut, « Terminés (N) » repliés, dernier choix mémorisé — `Projets.tsx:200-226` (T5).
38. Mois de la note d'honoraires pré-rempli avec le premier manquant (`moisManquants` le connaît ; le commentaire du code le promet déjà) — `Projets.tsx:876-877, 997` (T3, parcours 8).

**Documents & assistant** (parcours 9)

39. « Chercher dans les CR » : présélectionner les 16 CR les plus récents, décochables et bornables par période, au lieu de bloquer — `Assistant.tsx:399-402, 471-475` (T5, **majeur** : la question porte presque toujours sur les derniers mois).
40. Après génération d'un DOCX : « Ranger dans le Drive et au registre » (`rangerFichier` + `creerDocument` source `'genere'`, projet pré-rempli) à côté du téléchargement — `Assistant.tsx:573-584` (R6 : les documents produits par l'agence sont les seuls absents de son registre).
41. Compteur sur l'onglet « À rattacher » + entrée dans les validations attendues du Cockpit — `Documents.tsx:1566-1586` (R5 : un message sans projet peut attendre des jours en silence).
42. Le dépôt de l'onglet projet appelle `classerFichier` (catégorie + phase proposées), le sous-dossier suit le type via `DOSSIER_PAR_CATEGORIE`, `TYPES_DOC` supprimé au profit de `CATEGORIES_DOC` — `ProjetDocuments.tsx:27, 206-227` (R6, R3).

**Développement & réglages**

43. Afficher les événements BOAMP sur la fiche consultation et la carte dossier, badge « annulé » / « rectifié le … » — `VeilleAO.tsx:206-212` (R4 : on peut monter le dossier d'un avis annulé sans le savoir).
44. Item « Déposer le dossier — J−x » au centre d'actions (statuts go/concours, limite sous 10 j) — `Cockpit.tsx:144-155` (R5 : le dépôt raté est le risque le plus coûteux du domaine).
45. `bt01Actuel` dérivé de la dernière valeur BT01 d'`indicesBTP`, le champ devient un override affichant « auto : 137,5 — avril 2026 » — `Parametres.tsx:1250-1255`, `miqcp.ts:150-151` (T3).
46. Table des indices bornée aux 12 derniers mois par série, filtre + « voir tout » replié — `Parametres.tsx:802-905` (S3 : l'historique complet va noyer les réglages annuels).
47. Alerte CRM étendue aux organisations (même règle que les contacts) et date affichée dans la colonne — `Organisations.tsx:302-307`, `alerts.ts:401-413` (R4, vu par deux auditeurs).

### 3.2 Ce mois-ci — les M, en lots par écran

**Lot A — L'accueil finit ses branchements** (T1 — le plus gros gain du mois)

- A1. Livrer l'écran de revue des propositions IA : les couches pures et leurs
  tests existent (`propositions.ts`, `revuePropositions.ts` — livrables B.10/B.11
  du plan, moteur livré sans porte), il ne manque QUE le rendu ; et nourrir
  `ctx.propositions` à l'accueil pour que l'alerte agrégée s'allume
  (`Cockpit.tsx:746-749`). C'est finir une livraison du plan, pas un livrable
  nouveau.
- A2. Lecture dédiée à l'ouverture de l'accueil (dernier message de chaque fil
  entrant non traité, 30 jours) nourrissant `ctx.enAttenteDeReponse` — le
  sélecteur et l'alerte sont prêts (`alerts.ts:107-122`, `communications.ts:811`) ;
  « le client attend depuis 5 jours » est le signal le plus précieux pour deux
  personnes débordées.
- A3. Geste « Vu » sur les types d'alerte marquables (jumeau du snooze) — sans
  lui, `settings.vus` reste du code mort qui deviendra un manque réel dès que A1
  et A2 parleront (`alerts.ts:471-489`).
- A4. Liens d'alerte avec identifiant + surlignage de la ligne à l'arrivée, en
  commençant par les trois plus fréquents : situation à vérifier, facture en
  retard, décennale → fiche artisan (`alerts.ts:186, 201, 219, 443`) (T6).

**Lot B — Le document remis fait foi** (S6)

- B1. Figer le décompte à la validation de la situation, comme le certificat ;
  d'ici là, mention « reconstitué depuis l'état courant » sur chaque impression,
  infobulle renommée « décompte de vérification », vraies dates d'édition sur
  revue et décompte — `pdf.ts:212, 249, 456`, `Situations.tsx:766`.

**Lot C — L'onglet Chantier au service de la réunion** (R1, S3 — parcours 6 : 12 gestes → 3)

- C1. Bloc « Préparer la réunion » en tête de `CarteReunions` : avancement par
  lot, pénalités encourues non décidées, visas à rendre/en retard, désordres GPA
  ouverts, entreprises à confirmer — assemblage de sélecteurs existants + gabarit
  d'impression sur le patron de `src/pdf.ts`. Le symétrique amont de l'assistant
  CR, qui n'existe qu'en aval.
- C2. Replier les cartes vides ou hors phase en une ligne de titre avec compteur
  (`details/summary`, badge « 2 en retard » qui déplie) — `ProjetChantier.tsx:2297-2316`.
  Zéro suppression ; le tri utile/inutile définitif passe par la méthode 5.17
  (inventaire coché à deux), pas par ce lot.

**Lot D — Finance : la clôture cesse de crier faux** (T2, R3)

- D1. Sélecteur « Justificatif (registre documentaire) » dans `AchatModal` (même
  patron que `ProjetChantier.tsx:772`) et la checklist liste les seules pièces
  sans justificatif de la période — aujourd'hui, le contrôle BLOQUANT vise un
  champ qu'aucune saisie ne pose et chaque clôture finit par « Exporter malgré
  tout » (`comptable.ts:114-119`, `Achats.tsx:77-241`).
- D2. Un seul point d'import de relevé dans Banque, quatre formats, avec le champ
  « solde de fin » ; la carte Connecteurs devient un renvoi ; l'état vide « OFX :
  plus tard » corrigé — `Banque.tsx:556-576`, `Connecteurs.tsx:56-114` (un OFX
  importé aujourd'hui ne met jamais à jour la trésorerie, sans un mot).

**Lot E — Documents & annuaire : une identité, un chemin** (T7, R2)

- E1. Bouton « Ouvrir » sur la fiche et la ligne du registre : `cheminDrive` →
  handle → `getFile()` → nouvel onglet ; message clair si racine non branchée ou
  fichier déplacé — `Documents.tsx:903, 1058`, `fsdrive.ts:80-104`.
- E2. La fiche artisan devient l'éditeur de l'entreprise canonique (via
  `a.entrepriseId`, déjà posé) : contact, e-mail, décennale, lots s'écrivent une
  fois — et le vocabulaire s'aligne (« Entreprises » qui dit « artisan » partout) —
  `Ressources.tsx:83`, `store.tsx:292-317`.
- E3. Routines Claude éditables (mécanique de `state.prompts` : corps modifiable,
  version, « rétablir le modèle ») — les critères métier vivants (zone, fourchette
  AO, adresse, prénoms) sont figés dans une constante (`routines.ts:92-176`), et
  le test des adresses en dur exclut explicitement ce fichier de son périmètre.

**Lot F — Développement : la fiche a une adresse** (T6)

- F1. Route `#/ao/consultations/:id` ouvrant la `FicheModal`, et les trois
  chemins (carte Kanban, dossier, Cockpit) pointent dessus — `Developpement.tsx:93`,
  `Dossiers.tsx:206-208`, `Cockpit.tsx:150` : 3 gestes de trop sur le geste le
  plus fréquent du domaine, plusieurs fois par semaine.
- F2. Fusionner carte de réglage et carte Santé : la pastille + test + journal
  devient LA carte du branchement, les champs passent dans son `<details>` —
  `Parametres.tsx:1380-1387`.

**En passant** — les S mineurs, à faire quand l'écran du lot est déjà ouvert
(aucun ne justifie une session à lui seul ; ensemble ils enlèvent le jargon) :
les trois `window.prompt` remplacés par popover/champ inline (`Cockpit.tsx:256-259`,
`Banque.tsx:383-391`, `Taches.tsx:102-116` — ce dernier en mini-formulaire titre
+ projet + échéance, responsable = moi) ; `title={LIBELLES_PHASES[...]}` sur tous
les codes nus (`Cockpit.tsx:1229`, `Temps.tsx:637`, `Achats.tsx:176, 294`) et
libellés composés dans les Selects de Documents (`Documents.tsx:363-373`) ;
champ « Confiance » en badge, remis à « saisie manuelle » dès correction humaine
(`Situations.tsx:525-527`) ; « Supprimer » de la réunion rangé dans un RowMenu
(`ProjetChantier.tsx:1884-1898`) ; onglet Attendues aligné sur le critère du 10
(`Situations.tsx:1113-1119`) ; cascade de suppression de projet complétée des
quatre collections oubliées (`Projets.tsx:351-358`) ; suppression
d'artisan/matériau factorisée sur celle de la fiche (`Ressources.tsx:431-439`) ;
statuts de tâche alignés sur `STATUTS_TACHE_AU_MENU` (`Taches.tsx:256`) ; PDF du
plan de charge en capacité congés déduits (`Planning.tsx:963-966`) ; préréglages
en semaines (8/13/26) pour l'onglet Charge (`Planning.tsx:1019-1032`, deux
auditeurs) ; état vide de « Ma semaine » qui dit où vit l'affectation
(`Temps.tsx:627-630`) ; tuiles météo financière cliquables (`Cockpit.tsx:1099-1123`) ;
« Relancer » sur l'alerte d'impayé (`alerts.ts:192-205`) ; cumuls de Ventes
bornés à l'année (`Facturation.tsx:1179, 1556`) ; km × barème pré-rempli
(`Achats.tsx:300-304`) ; lien « ouvrir dans l'agenda » par contrat d'agence
(`Contrats.tsx:534-553`) ; badge de phase courante sur la vue d'ensemble
(`Projets.tsx:505`) ; Revue réutilise `CarteCAMensuel` au lieu de la recopier
(`Revue.tsx:253-307`) ; générateur de noms de Classement rapatrié dans Documents,
route retirée (`Classement.tsx:13`) ; `dernierMouvement` posé au changement de
statut depuis la fiche (`VeilleAO.tsx:929-947`) ; état vide du premier usage du
Radar (`VeilleAO.tsx:283-294`) ; pastille Santé « jamais testé » (`Sante.tsx:176`) ;
Client ID pré-renseigné (`Parametres.tsx:533-534`) ; phrase de la probabilité
corrigée ou champ ajouté (`Dossiers.tsx:842-845`) ; un seul nom pour l'écran
Développement (`App.tsx:99` et renvois) ; surbrillance du menu Automatisations
(`App.tsx:388`) ; contacts d'organisation triés par `trierContactsAppel` + lien
« tracer une interaction » (`Organisations.tsx:388-405`) ; datalist des séries
d'indices sur le champ indice du marché (parcours 11) ; datalist MOA depuis les
organisations sur « Nouveau projet » (parcours 7) ; carte « Arrivées
automatiques » qui rejoue la cascade comme sa voisine (`Documents.tsx:169-176`).

### 3.3 De fond — conditions d'engagement

Ces chantiers ne se décident pas dans ce plan : ils y sont référencés avec la
condition qui les déclenche. Quatre des cinq figurent déjà au plan
(`docs/PLAN_CDC_MAILS_TACHES_TEMPS.md`) — on ne les re-propose pas, on s'interdit
de les doubler.

1. **Chrono → feuille de temps → tâche** : branchement des projections
   (B.4/B.5/B.9, fonctions et `test-conservation-totaux.cjs` déjà écrits).
   Condition : telle que séquencée au plan, vague B. Le garde-fou n° 26 de la
   semaine n'est qu'un pansement d'attente — il se retire au branchement.
2. **Coupure de l'ancienne mémoire du courrier** (B.15) : condition inchangée et
   non négociable — sept jours consécutifs de parité verte mesurée par `#/parite`
   (B.18). Rien dans ce plan ne touche à la double mémoire.
3. **Retrouver par le contenu** : recherche par facettes (2.4) + plein texte
   français (2.5). Condition : après la bascule B.15, quand l'index des messages
   est la seule source. En attendant, la palette locale avec les tâches (action
   n° 19) suffit.
4. **TVA : échéance de décaissement au « Marquer déclarée »**, alimentant la
   prévision 13 semaines à la place du forfait — aujourd'hui le point bas du
   vendredi ignore la TVA qu'on vient de chiffrer au centime. Condition : retour
   du cabinet sur le régime (5.15, `docs/QUESTIONS_CABINET_TVA.md`) — on ne date
   pas un télépaiement dont le régime n'est pas confirmé.
5. **Hors-ligne de chargement** (coquille service worker, M.1) : condition et
   périmètre déjà posés au plan — c'est lui qui rendra vrais les usages chantier
   (consulter un marché, consigner une intempérie au téléphone).

---

## 4. Ce qu'on ne fera PAS, et pourquoi

Les suggestions d'auditeurs écartées, une décision par ligne — pour ne pas
refaire ce débat dans six mois.

1. **Pas de seconde recherche sur `communications` dans la palette « / »** (via
   le cache 90 j) : doublon des livrables 2.4/2.5 du plan ; on indexe les tâches
   (état local, action n° 19) et on s'arrête là.
2. **Pas de « simplification » de la double mémoire courriers/communications** :
   c'est le filet de la bascule, B.15 la coupera sur parité mesurée (§3.12 du
   plan) — la redondance est le dispositif, pas le défaut.
3. **Pas de notification poussée ni d'e-mail sortant** : divergence déclarée du
   plan (§3.15) — la file du matin est le canal officiel pour deux personnes qui
   ouvrent le Cockpit chaque jour. Aucun constat d'audit ne la remet en cause.
4. **Pas de rapprochement local « plus malin » des situations importées** : c'est
   la cascade unique A.4 (§3.7) ; un moteur local de plus recréerait les trois
   vérités divergentes qu'elle existe pour supprimer.
5. **Pas de retouche de Finance « L'essentiel »** — pas même la ligne « prochaine
   obligation Urssaf » suggérée : l'écran est la référence, verrouillé par test ;
   s'il évolue un jour, c'est par l'inventaire d'usage 5.17 coché à deux.
6. **Pas de vue « par entreprise » supplémentaire** : la fiche transverse 5.20
   est livrée ; on la rend mieux adressable (liens, recherche), on ne la double
   pas.
7. **Pas de refonte de l'onglet Chantier décidée seule** : le lot C replie les
   cartes vides, rien de plus ; le tri utile/inutile définitif suit la méthode
   actée (5.17 — inventaire coché à deux, masquer jamais supprimer).
8. **Pas de re-livraison du branchement chrono → grille** : B.4/B.5/B.9 sont au
   plan avec leur test ; ce plan ne livre que l'honnêteté d'attente (action n° 26).
9. **Pas d'assistant multi-écrans pour le marché de travaux** : la modale unique
   à ~20 champs est le bon format pour un geste de dix minutes (parcours 11) —
   on l'outille (datalists, avance), on ne la découpe pas.
10. **Pas de « ✓ Visé » sans lecture sur les alertes financières** : le refus
    existant (`alerts.ts:293-295`) est la bonne prudence — un raccourci qui
    dispense de lire un document financier n'est pas un gain de temps.
11. **Pas d'élargissement du jeton serveur au calendrier** pour des suggestions
    de saisie : écarté au §6 du plan ; les suggestions d'agenda restent côté
    navigateur (3.6).
12. **Pas de réparation du rangement DOCX sur téléphone/tablette** :
    `showDirectoryPicker` absent de Safari iOS et Firefox Android — limite
    navigateur actée, à documenter (2.16), pas à contourner.

---

## 5. La mesure

On saura que ça a marché de la même façon qu'on a su que ça frottait : **en
recomptant les gestes**.

1. **Les douze parcours re-comptés** après livraison de « cette semaine » puis de
   « ce mois-ci », même protocole (nombre de gestes, nombre d'écrans, saisies
   redondantes), cible = colonne « visés » du tableau §2.4. Les parcours 5 et
   12, non touchés, servent de témoins : s'ils bougent, quelque chose a été cassé.
   Le 7, qui ne reçoit qu'une datalist, sert de témoin faible : plus de deux
   gestes gagnés voudrait dire qu'on a débordé du périmètre annoncé.
2. **Trois vérifications mécaniques**, greppables, à zéro après « cette
   semaine » : aucun lien vers une route inexistante (`#/messages` dans
   `alerts.ts`) ; aucun `window.prompt` dans `src/modules/` ; chaque alerte de
   gravité 3 porte au moins un geste ou un lien qui atterrit sur l'élément.
3. **Le test du badge honnête** : une semaine avec deux jours de congé saisie à
   21 h s'affiche complète ; une réunion créée pour la semaine prochaine
   s'affiche « à venir » ; un OFX importé met à jour la trésorerie. Trois cas
   concrets, vérifiés à la main en cinq minutes.
4. **Un re-comptage à froid dans un mois**, fait par l'associée qui n'a pas suivi
   les travaux — le même biais qui a produit les douze parcours doit servir à les
   re-mesurer. Si un parcours n'a pas atteint sa cible, le constat correspondant
   revient en tête du lot suivant, avec son chiffre.

---

*Document établi le 05/08/2026 à partir des huit rapports d'audit et des douze
parcours comptés. Règle de mise à jour : comme le plan — chaque constat garde sa
référence de code, l'existant se distingue du manquant, et une action sans
constat sourcé n'entre pas.*
