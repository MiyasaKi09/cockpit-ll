# Inventaire de la sphère Finance — support de décision (livrable 5.17)

> **Origine.** Retour d'usage du 03/08/2026 : la Finance est « trop compliquée
> et pleine de trucs inutiles ». Simplifier sans mesurer l'usage supprimerait
> ce que l'une des deux utilisatrices utilise en silence — ce document mesure
> AVANT de décider. **C'est le support de la décision, pas la décision** :
> aucun masquage n'est fait dans ce livrable.

## Méthode — à lire avant de cocher

1. **Tout est listé, sans jugement.** Chaque écran, carte et bloc
   d'indicateurs de la sphère Finance, avec son nom exact affiché, l'endroit
   du code (`fichier:ligne`) et ce qu'il fait en une phrase.
2. **Cocher À DEUX, en une seule séance.** Pour chaque ligne : `[ ] utilisé`
   ou `[ ] jamais ouvert`. Une carte utilisée par UNE seule des deux est
   « utilisée ». Au moindre doute ou désaccord : « utilisé ».
3. **Ensuite seulement, on masque — jamais on ne supprime.** Ce qui est coché
   « jamais ouvert » par les deux sera replié derrière un « Voir plus »
   (les données, les calculs et le code restent ; un clic rouvre). Chaque
   masquage sera une décision documentée, carte par carte, dans un livrable
   ultérieur — pas ici.
4. **Les garde-fous ne se cochent pas.** Les alertes d'intégrité (trous de
   numérotation, factures rejetées, pièces à contrôler…) n'apparaissent que
   quand le problème existe : elles ne comptent pas comme des cartes à
   évaluer et ne figurent pas dans les tableaux.

**Périmètre.** Le plan citait sept fichiers ; la sous-navigation réelle de la
sphère (`src/modules/FinanceNav.tsx:17-27`) compte **neuf onglets** —
« Contrats & budgets » et « Ventes » en font partie et sont inventoriés
aussi : un inventaire partiel ferait décider à l'aveugle sur ce qui n'y
figure pas. Les fenêtres de saisie (émission, paiement, avoir…) ne sont pas
des lignes à cocher : elles s'ouvrent depuis leur carte et suivent son sort.

Les numéros de ligne sont ceux du commit qui introduit ce document ; ils
vieilliront — le nom affiché, lui, se retrouve avec la recherche du code.

---

## Décision du 04/08 — regroupement visuel, zéro suppression

La commande : « quelque chose de clair et simple (visuellement) mais précis
dans ce que ça montre ». Deux gestes, AUCUNE suppression :

1. **L'écran d'entrée devient « L'essentiel »** (`src/modules/Finance.tsx`) :
   six tuiles — trésorerie disponible (et point bas prévu), à encaisser
   (dont retard), à facturer, achats à payer, TVA due à l'État, marge de
   l'année — et rien d'autre. Chaque tuile lit le sélecteur que l'onglet de
   détail applique déjà (`financeActions`, `derive`, `tva`, `banque`,
   `tresorerie`) et la tuile entière ouvre cet onglet. Les blocs qui
   occupaient l'ancienne « Vue d'ensemble » (section 1 ci-dessous) ne sont
   pas perdus : la courbe 13 semaines vit dans Banque, les actions « à
   traiter » restent comptées par le badge Finance et visibles dans leurs
   vues (Ventes, Achats, Banque, Comptable), la santé des projets dans
   Pilotage et les fiches projet, l'état de clôture dans Comptable.
2. **La sous-navigation se hiérarchise** (`src/modules/FinanceNav.tsx`) :
   rang principal « L'essentiel · Ventes · Achats & frais · Banque », rang
   secondaire discret « Contrats · Comptable · Revue · Prévisions ·
   Connecteurs ». **Les neuf destinations restent toutes affichées et
   accessibles en un clic** — regroupement visuel, pas un masquage.

Le cochage à deux (méthode ci-dessus) reste À FAIRE pour aller plus loin :
tout repli « Voir plus » d'une carte cochée « jamais ouvert » sera un
livrable à part, décidé ligne à ligne. `scripts/test-finance-essentiel.cjs`
verrouille les deux gestes (sélecteurs réutilisés, neuf destinations).

## 1. Vue d'ensemble (`#/finance` — `src/modules/Finance.tsx`)

> **04/08 :** cet écran est devenu « L'essentiel » (décision ci-dessus). Les
> lignes ci-dessous décrivent l'ancien contenu, conservé pour le cochage :
> chaque bloc existe encore dans l'onglet indiqué par la décision.

| Élément affiché | Où | Ce que ça fait | Usage |
|---|---|---|---|
| Indicateurs « Banque disponible · Point bas à 13 semaines · À encaisser · À décaisser » | `Finance.tsx:70-98` | Les quatre chiffres de sécurité financière, en tête de sphère | `[ ] utilisé · [ ] jamais ouvert` |
| À traiter maintenant (N) | `Finance.tsx:101` | Les décisions humaines en attente sur toute la chaîne (émettre, valider, rapprocher, rejets portail, clôture), chacune avec son bouton « Traiter » | `[ ] utilisé · [ ] jamais ouvert` |
| Trésorerie — 13 semaines (probable) | `Finance.tsx:130-131` | La courbe de trésorerie du scénario probable, renvoie vers Banque pour le détail | `[ ] utilisé · [ ] jamais ouvert` |
| Santé économique des projets actifs | `Finance.tsx:141` | Par projet actif : facturé HT, marge sur coûts directs (temps valorisé + achats), budget externe et facturé fournisseurs | `[ ] utilisé · [ ] jamais ouvert` |
| Clôture AAAA-MM | `Finance.tsx:186` | L'état de la clôture du mois précédent (« exportée » ou « N % prêt »), renvoie vers Comptable | `[ ] utilisé · [ ] jamais ouvert` |

## 2. Contrats & budgets (`#/contrats` — `src/modules/Contrats.tsx`)

| Élément affiché | Où | Ce que ça fait | Usage |
|---|---|---|---|
| Indicateurs « Signé HT (contrats clients) · Facturé HT · Provisoires à contrôler · Contrats d'agence » | `Contrats.tsx:475-485` | Le total signé, ce qui en est facturé, les contrats à valider et les abonnements de l'agence | `[ ] utilisé · [ ] jamais ouvert` |
| Contrats clients (N) | `Contrats.tsx:499` | La liste des contrats clients — le contrat signé est la racine du chiffre | `[ ] utilisé · [ ] jamais ouvert` |
| Contrats de l'agence (N) | `Contrats.tsx:534` | Les contrats fournisseurs/agence récurrents (loyer, logiciels, assurances) | `[ ] utilisé · [ ] jamais ouvert` |
| Fiche d'un contrat : indicateurs, « Lignes du contrat (N) », « Historique » | `Contrats.tsx:276-306, 406` | Le détail d'un contrat : lignes actives/options, avenants tracés avec motif et date | `[ ] utilisé · [ ] jamais ouvert` |

## 3. Ventes (`#/facturation` — `src/modules/Facturation.tsx`)

| Élément affiché | Où | Ce que ça fait | Usage |
|---|---|---|---|
| Indicateurs « Solde en retard (TTC) · Factures en retard · Facturé HT net (cumul) · Encaissé TTC (cumul) · Délai moyen de paiement » | `Facturation.tsx:1538-1567` | L'état du poste clients en cinq chiffres | `[ ] utilisé · [ ] jamais ouvert` |
| Relances à faire | `Facturation.tsx:1055` | Les factures en retard avec trois niveaux de relance en brouillon (courtoise / ferme / mise en demeure) — l'envoi reste un geste humain | `[ ] utilisé · [ ] jamais ouvert` |
| À facturer — échéances (N) | `Facturation.tsx:1603-1604` | Les prévisions de facturation (sans numéro légal) et le parcours « Émettre… » qui numérote et fige la pièce | `[ ] utilisé · [ ] jamais ouvert` |
| Factures émises | `Facturation.tsx:1678` | Les pièces émises (figées) : paiements, avoirs, PDF, Factur-X, statut portail Chorus/PDP et rappel « à déposer » (5.16) | `[ ] utilisé · [ ] jamais ouvert` |

## 4. Achats & frais (`#/finance/achats` — `src/modules/Achats.tsx`)

| Élément affiché | Où | Ce que ça fait | Usage |
|---|---|---|---|
| Indicateurs « À valider · À payer (TTC) · Attendus ouverts · Notes de frais » | `Achats.tsx:524-529` | L'état du poste fournisseurs en quatre chiffres | `[ ] utilisé · [ ] jamais ouvert` |
| Boîte d'arrivée (N) | `Achats.tsx:533` | Les factures fournisseurs reçues (Gmail/Drive, XML, saisie) en attente d'une validation humaine avec ventilation projet/phase | `[ ] utilisé · [ ] jamais ouvert` |
| Ce qui manque (N) | `Achats.tsx:596` | Les attendus : facture récurrente absente, débit bancaire sans pièce, montant anormal | `[ ] utilisé · [ ] jamais ouvert` |
| À payer — échéancier de décaissement (N) | `Achats.tsx:625` | Les factures validées non payées, triées par échéance | `[ ] utilisé · [ ] jamais ouvert` |
| Balance fournisseurs (dettes) | `Achats.tsx:671` | Le dû par fournisseur, avec le retard et la prochaine échéance (ne s'affiche que s'il y a des dettes) | `[ ] utilisé · [ ] jamais ouvert` |
| Notes de frais (N) | `Achats.tsx:688` | Les notes de frais (qui a payé, remboursement, kilométrage), parcours volontairement court | `[ ] utilisé · [ ] jamais ouvert` |

## 5. Banque & trésorerie (`#/finance/banque` — `src/modules/Banque.tsx`)

| Élément affiché | Où | Ce que ça fait | Usage |
|---|---|---|---|
| Indicateurs « Solde bancaire (importé) · Écart avec le solde manuel · À rapprocher · Relevés importés » | `Banque.tsx:526-549` | L'état du compte et du rapprochement en quatre chiffres | `[ ] utilisé · [ ] jamais ouvert` |
| Mouvements (N) | `Banque.tsx:552` | Les mouvements bancaires importés (CSV idempotent) et leur rapprochement PROPOSÉ, jamais forcé (encaissement, fournisseur, note de frais, interne, justifié) | `[ ] utilisé · [ ] jamais ouvert` |
| Prévision de trésorerie — 13 semaines | `Banque.tsx:427-432` (rendue `:589`) | La courbe en trois scénarios (prudent / probable / favorable) avec le détail des flux semaine par semaine et le point bas | `[ ] utilisé · [ ] jamais ouvert` |

## 6. Comptable (`#/finance/comptable` — `src/modules/Comptable.tsx`)

| Élément affiché | Où | Ce que ça fait | Usage |
|---|---|---|---|
| Barre de clôture (période, % prêt, « Prévisualiser l'export », « Exporter et verrouiller ») | `Comptable.tsx:328-343` | Le pilotage de la clôture mensuelle et l'export du lot pour le cabinet | `[ ] utilisé · [ ] jamais ouvert` |
| Indicateurs « Ventes · Achats · Notes de frais · Paiements » | `Comptable.tsx:345-350` | Le contenu de la période sélectionnée, en pièces et en montants | `[ ] utilisé · [ ] jamais ouvert` |
| Checklist de clôture | `Comptable.tsx:359` | Les contrôles bloquants / à vérifier avant export, chacun avec son lien « corriger → » | `[ ] utilisé · [ ] jamais ouvert` |
| Aperçu des écritures (N) | `Comptable.tsx:377` | Les écritures comptables générées (équilibrées débit/crédit), visibles avant export | `[ ] utilisé · [ ] jamais ouvert` |
| Profil comptable — à caler UNE fois avec le cabinet | `Comptable.tsx:46-66` (rendue `:406`) | Journaux, comptes, format CSV, analytique, régime de TVA — la configuration de l'échange avec le cabinet | `[ ] utilisé · [ ] jamais ouvert` |
| Lots exportés (N) | `Comptable.tsx:408` | L'historique des lots (version, empreinte, diff V1/V2) et l'import du retour du cabinet (acceptée/rejetée par pièce) | `[ ] utilisé · [ ] jamais ouvert` |

## 7. Revue de direction (`#/finance/revue` — `src/modules/FinanceRevue.tsx`)

Les huit sections s'affichent dans un ordre imposé (`FinanceRevue.tsx:297-308`) ;
les titres 1-3 et 6-7 sont produits par `src/revue.ts`.

| Élément affiché | Où | Ce que ça fait | Usage |
|---|---|---|---|
| 1 · Points bas de trésorerie (13 semaines) | `src/revue.ts:151` | Les semaines sous le seuil d'alerte | `[ ] utilisé · [ ] jamais ouvert` |
| 2 · Retards clients (N) | `src/revue.ts:164` | Les factures en retard, vues direction | `[ ] utilisé · [ ] jamais ouvert` |
| 3 · Clôture AAAA-MM | `src/revue.ts:176` | L'état de la clôture, vue direction | `[ ] utilisé · [ ] jamais ouvert` |
| 4 · Hors périmètre & avenants potentiels | `FinanceRevue.tsx:97` | Les demandes hors contrat détectées dans les courriers/CR/journaux → pipeline → chiffrage → avenant SIGNÉ (seule étape qui modifie le contrat) | `[ ] utilisé · [ ] jamais ouvert` |
| 5 · Jalons facturables (N) | `FinanceRevue.tsx:180` | Les jalons atteints qui peuvent devenir des échéances de facturation | `[ ] utilisé · [ ] jamais ouvert` |
| 6 · Marges finales qui dérivent (N) | `src/revue.ts:215` | Les projets dont la marge finale projetée dérive | `[ ] utilisé · [ ] jamais ouvert` |
| 7 · Consultations par valeur attendue (N) | `src/revue.ts:225` | Les consultations en cours classées par valeur pondérée | `[ ] utilisé · [ ] jamais ouvert` |
| 8 · Décisions (N ouverte(s)) | `FinanceRevue.tsx:233` | Le relevé de décisions de direction : qui, quoi, pour quand, statut | `[ ] utilisé · [ ] jamais ouvert` |

## 8. Prévisions (`#/finance/previsions` — `src/modules/Previsions.tsx`)

| Élément affiché | Où | Ce que ça fait | Usage |
|---|---|---|---|
| Budget de trésorerie — 12 mois glissants (TTC) | `Previsions.tsx:32` | La projection mensuelle : encaissements probabilisés, récurrents, salaires, frais généraux, TVA paramétrée, point bas | `[ ] utilisé · [ ] jamais ouvert` |
| Simulateur de projet (aide à la décision) | `Previsions.tsx:126` | « Si on signe ce projet » : honoraires pondérés, coût estimé, marge attendue — une simulation, rien n'est écrit | `[ ] utilisé · [ ] jamais ouvert` |
| Rentabilité finale par client (HT) | `Previsions.tsx:193` | Honoraires signés, coût final et marge, agrégés par client | `[ ] utilisé · [ ] jamais ouvert` |
| Coût & ROI des appels d'offres / concours | `Previsions.tsx:211` | Le temps de prospection valorisé face à la valeur attendue des consultations en cours | `[ ] utilisé · [ ] jamais ouvert` |

## 9. Connecteurs (`#/finance/connecteurs` — `src/modules/Connecteurs.tsx`)

| Élément affiché | Où | Ce que ça fait | Usage |
|---|---|---|---|
| Diagnostic | `Connecteurs.tsx:355` | L'état des six branchements (banque, mail, Drive, cabinet, Chorus, PDP) en un coup d'œil | `[ ] utilisé · [ ] jamais ouvert` |
| Import bancaire — CAMT.053 · OFX/QFX · QIF · CSV | `Connecteurs.tsx:89-90` (rendue `:368`) | L'import multi-format des relevés, idempotent | `[ ] utilisé · [ ] jamais ouvert` |
| Import achat électronique — CII / UBL (ligne par ligne) | `Connecteurs.tsx:160-161` (rendue `:369`) | La lecture d'une facture fournisseur XML (Factur-X/UBL), TVA par taux, vers la boîte d'arrivée des Achats | `[ ] utilisé · [ ] jamais ouvert` |
| Cycle de vie Chorus / PDP — import CSV | `Connecteurs.tsx:234-235` (rendue `:370`) | L'import des statuts portail (déposée / rejetée / … / payée) rattachés par numéro de facture — alimente les badges de Ventes (5.16) | `[ ] utilisé · [ ] jamais ouvert` |
| Connecteurs directs — passerelles serveur HTTPS | `Connecteurs.tsx:308` (rendue `:371`) | L'enregistrement d'URL de passerelles et leur healthcheck — aucun secret dans le navigateur | `[ ] utilisé · [ ] jamais ouvert` |

---

## Après la séance de cochage

1. Reporter ici la date de la séance : ______________, et les deux
   signatures : ______________ · ______________.
2. Pour chaque ligne cochée « jamais ouvert » à deux, ouvrir la décision de
   masquage (un repli « Voir plus », jamais une suppression) — ce sera un
   livrable à part, avec sa propre trace, une décision par carte.
3. Ce qui est coché « utilisé » ne bouge pas, même si l'autre ne l'ouvre
   jamais : l'outil sert deux personnes, pas une moyenne des deux.
