# Inventaire de la sphère Finance — support de décision (livrable 5.17)

> **Origine.** Retour d'usage du 03/08/2026 : la Finance est « trop compliquée
> et pleine de trucs inutiles ». Simplifier sans mesurer l'usage supprimerait
> ce que l'une des deux utilisatrices utilise en silence — ce document mesure
> AVANT de décider. **C'est le support de la décision, pas la décision** :
> aucun masquage n'est fait dans ce livrable.
>
> **Remis à jour le 07/08/2026** contre le code du commit `cc7d4cb`, écran par
> écran. La version du 04/08 listait des cartes qui n'existent plus là où elle
> les plaçait (l'import bancaire), et ignorait sept éléments apparus depuis
> (connexion bancaire directe, Chorus Pro, TVA, régime de TVA, filtres…). Un
> inventaire faux est pire qu'un inventaire absent : celui-ci a été refait
> ligne à ligne, en lecture du code.

> ⏱ **La séance dure environ 35 minutes.** 55 lignes à cocher, à deux, d'une
> traite. Ce n'est pas une réunion : c'est un café avec l'outil ouvert à côté.

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
   numérotation, factures rejetées, pièces à contrôler, pièces déjà exportées,
   projets sans contrat, contrat provisoire…) n'apparaissent que quand le
   problème existe : elles ne comptent pas comme des cartes à évaluer et ne
   figurent pas dans les listes ci-dessous.

**Périmètre.** La sous-navigation réelle de la sphère
(`src/modules/FinanceNav.tsx:22-34`) compte **neuf onglets** — quatre au rang
principal (L'essentiel · Ventes · Achats & frais · Banque), cinq au rang
secondaire (Contrats · Comptable · Revue · Prévisions · Connecteurs). Les neuf
sont inventoriés : un inventaire partiel ferait décider à l'aveugle sur ce qui
n'y figure pas. Les fenêtres de saisie (émission, paiement, avoir, facture
fournisseur, note de frais…) ne sont pas des lignes à cocher : elles s'ouvrent
depuis leur carte et suivent son sort.

Les numéros de ligne sont ceux du commit `cc7d4cb` (07/08/2026) ; ils
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
   occupaient l'ancienne « Vue d'ensemble » ne sont pas perdus : la courbe
   13 semaines vit dans Banque, les actions « à traiter » restent comptées
   par le badge Finance et visibles dans leurs vues (Ventes, Achats, Banque,
   Comptable), la santé des projets dans Pilotage et les fiches projet,
   l'état de clôture dans Comptable.
2. **La sous-navigation se hiérarchise** (`src/modules/FinanceNav.tsx`) :
   rang principal « L'essentiel · Ventes · Achats & frais · Banque », rang
   secondaire discret « Contrats · Comptable · Revue · Prévisions ·
   Connecteurs ». **Les neuf destinations restent toutes affichées et
   accessibles en un clic** — regroupement visuel, pas un masquage.

Le cochage à deux (méthode ci-dessus) reste À FAIRE pour aller plus loin :
tout repli « Voir plus » d'une carte cochée « jamais ouvert » sera un
livrable à part, décidé ligne à ligne. `scripts/test-finance-essentiel.cjs`
verrouille les deux gestes (sélecteurs réutilisés, neuf destinations).

---

## 1. L'essentiel (`#/finance` — `src/modules/Finance.tsx`) — 6 lignes

Six tuiles, un chiffre chacune ; la tuile entière est un lien. Aucun calcul
local : chaque chiffre vient du sélecteur que l'onglet de détail lit déjà.

- **Trésorerie disponible** — solde bancaire (sinon manuel) + point bas prévu ; ouvre Banque · `Finance.tsx:89-103` → `[ ] utilisé` `[ ] jamais ouvert`
- **À encaisser** — factures émises non soldées, dont le retard ; ouvre Ventes · `Finance.tsx:104-114` → `[ ] utilisé` `[ ] jamais ouvert`
- **À facturer** — échéances dues (HT) à émettre ; ouvre Ventes · `Finance.tsx:115-125` → `[ ] utilisé` `[ ] jamais ouvert`
- **Achats à payer** — fournisseurs validés non payés (+ ce qui reste à valider) ; ouvre Achats · `Finance.tsx:126-138` → `[ ] utilisé` `[ ] jamais ouvert`
- **TVA due à l'État** — mois échus non déclarés ; ouvre Comptable · `Finance.tsx:139-149` → `[ ] utilisé` `[ ] jamais ouvert`
- **Marge AAAA** — CA facturé − temps pointé valorisé ; ouvre Pilotage · `Finance.tsx:150-156` → `[ ] utilisé` `[ ] jamais ouvert`

## 2. Contrats & budgets (`#/contrats` — `src/modules/Contrats.tsx`) — 4 lignes

- **Indicateurs « Signé HT (contrats clients) · Facturé HT · Provisoires à contrôler · Contrats d'agence »** — le signé, ce qui en est facturé, ce qui reste à valider · `Contrats.tsx:475-489` → `[ ] utilisé` `[ ] jamais ouvert`
- **Contrats clients (N)** — la liste des contrats clients, racine du chiffre · `Contrats.tsx:503` → `[ ] utilisé` `[ ] jamais ouvert`
- **Contrats de l'agence (N)** — loyer, logiciels, assurances (récurrents) · `Contrats.tsx:538` → `[ ] utilisé` `[ ] jamais ouvert`
- **Fiche d'un contrat** — indicateurs « Total signé HT · Facturé HT · Budget heures · Budget externe (saisi) », « Lignes du contrat (N) », « Historique » · `Contrats.tsx:284-294, 304, 406` → `[ ] utilisé` `[ ] jamais ouvert`

## 3. Ventes (`#/facturation` — `src/modules/Facturation.tsx`) — 6 lignes

- **Indicateurs « Solde en retard (TTC) · Factures en retard · Facturé HT net AAAA · Encaissé TTC AAAA · Délai moyen de paiement »** — le poste clients en cinq chiffres · `Facturation.tsx:1949-1969` → `[ ] utilisé` `[ ] jamais ouvert`
- **Chorus Pro — cycle de vie des factures publiques** — synchronisation des statuts du portail (déposée / rejetée / payée) par l'espace partagé, et les factures que le portail annonce sans qu'on les reconnaisse · `Facturation.tsx:288` (rendue `:2004`) → `[ ] utilisé` `[ ] jamais ouvert`
- **Relances à faire** — les impayés, avec « Relancer par e-mail… » (brouillon Gmail déjà rempli, envoi humain) et les niveaux plus fermes en brouillon à relire · `Facturation.tsx:1421` (rendue `:2007`) → `[ ] utilisé` `[ ] jamais ouvert`
- **À facturer — échéances (N)** — les prévisions (sans numéro légal) et le parcours « Émettre… » qui numérote et fige · `Facturation.tsx:2010` → `[ ] utilisé` `[ ] jamais ouvert`
- **Factures émises** — les pièces figées : paiements, avoirs, PDF, Factur-X, statut portail, badge « à déposer » · `Facturation.tsx:2085` → `[ ] utilisé` `[ ] jamais ouvert`
- **Filtres et recherche des factures émises** — projet, état (à encaisser / en retard / payées / avoirs / à contrôler), recherche n° ou libellé ; tri par émission décroissante · `Facturation.tsx:2086-2112` (tri `:1612`) → `[ ] utilisé` `[ ] jamais ouvert`

## 4. Achats & frais (`#/finance/achats` — `src/modules/Achats.tsx`) — 8 lignes

- **Indicateurs « À valider · À payer (TTC) · Attendus ouverts · Notes de frais »** — le poste fournisseurs en quatre chiffres · `Achats.tsx:654-659` → `[ ] utilisé` `[ ] jamais ouvert`
- **Boîte d'arrivée (N)** — factures fournisseurs reçues (Gmail/Drive, XML, saisie) en attente de validation humaine, avec ventilation projet/phase · `Achats.tsx:709` → `[ ] utilisé` `[ ] jamais ouvert`
- **Justificatifs manquants — AAAA-MM (N)** — la liste des dépenses validées sans pièce, ouverte depuis la checklist de clôture (« corriger → ») ; chacune porte son geste de rattachement · `Achats.tsx:662-664` → `[ ] utilisé` `[ ] jamais ouvert`
- **Ce qui manque (N)** — facture récurrente absente, débit bancaire sans pièce, montant anormal · `Achats.tsx:773` → `[ ] utilisé` `[ ] jamais ouvert`
- **Échéancier de décaissement — N à payer** — les factures validées, triées par échéance · `Achats.tsx:802` → `[ ] utilisé` `[ ] jamais ouvert`
- **Filtre d'état de l'échéancier (À payer / Payées / Toutes)** — une facture réglée ne disparaît plus de l'écran : elle se relit et se corrige · `Achats.tsx:804-814` → `[ ] utilisé` `[ ] jamais ouvert`
- **Balance fournisseurs (dettes)** — le dû par fournisseur, retard et prochaine échéance (visible seulement s'il y a des dettes) · `Achats.tsx:888` → `[ ] utilisé` `[ ] jamais ouvert`
- **Notes de frais (N)** — qui a payé, remboursement, kilométrage ; parcours volontairement court · `Achats.tsx:905` → `[ ] utilisé` `[ ] jamais ouvert`

> Le **sélecteur de justificatif** (« Justificatif (registre documentaire) »,
> `Achats.tsx:210-211`) vit dans la fenêtre de saisie d'une facture
> fournisseur : il suit le sort de la carte qui l'ouvre et ne se coche pas à
> part. À signaler quand même pendant la séance : c'est lui qui débloque la
> clôture du mois.

## 5. Banque & trésorerie (`#/finance/banque` — `src/modules/Banque.tsx`) — 5 lignes

- **Indicateurs « Solde bancaire (importé) · Écart avec le solde manuel · À rapprocher · Relevés importés »** — l'état du compte et du rapprochement · `Banque.tsx:1240-1285` → `[ ] utilisé` `[ ] jamais ouvert`
- **« Reprendre le solde importé »** — le bouton qui aligne le solde manuel (météo financière, Pilotage) sur le relevé, au lieu de le recopier à la main ; annulable · `Banque.tsx:1267-1274` → `[ ] utilisé` `[ ] jamais ouvert`
- **Connexion bancaire directe — lecture seule** — connecter un compte (GoCardless via l'espace partagé), synchroniser, reconnecter tous les 90 jours (DSP2) ; aucun ordre possible · `Banque.tsx:766` (rendue `:1287`) → `[ ] utilisé` `[ ] jamais ouvert`
- **Mouvements (N à rapprocher)** — les mouvements et leur rapprochement PROPOSÉ, jamais forcé ; c'est ici, et nulle part ailleurs, qu'on importe un relevé (CAMT.053 · OFX/QFX · QIF · CSV) avec son solde de fin · `Banque.tsx:1289` (import `:1294-1301`) → `[ ] utilisé` `[ ] jamais ouvert`
- **Prévision de trésorerie — 13 semaines** — trois scénarios (prudent / probable / favorable), flux semaine par semaine, point bas · `Banque.tsx:1121` (rendue `:1335`) → `[ ] utilisé` `[ ] jamais ouvert`

## 6. Comptable (`#/finance/comptable` — `src/modules/Comptable.tsx`) — 9 lignes

- **TVA — ce qu'on doit à l'État** — collectée, déductible, solde des trois derniers mois, et « Marquer déclarée » qui fige un mois échu · `src/modules/CarteTVA.tsx:68` (rendue `Comptable.tsx:489`) → `[ ] utilisé` `[ ] jamais ouvert`
- **Barre de clôture** — période, « N % prêt », bloquants, « Prévisualiser l'export », « Exporter et verrouiller » · `Comptable.tsx:491-506` → `[ ] utilisé` `[ ] jamais ouvert`
- **Indicateurs « Ventes · Achats · Notes de frais · Paiements »** — le contenu de la période, en pièces et en montants · `Comptable.tsx:508-513` → `[ ] utilisé` `[ ] jamais ouvert`
- **Checklist de clôture** — les contrôles bloquants / à vérifier, chacun avec son lien « corriger → » · `Comptable.tsx:522` → `[ ] utilisé` `[ ] jamais ouvert`
- **Chorus Pro — ce que le portail dit de nos factures publiques** — rejets à corriger et factures annoncées en paiement mais non rapprochées, vus depuis la clôture · `Comptable.tsx:305` (rendue `:539`) → `[ ] utilisé` `[ ] jamais ouvert`
- **Aperçu des écritures (N)** — les écritures générées (débit/crédit équilibrés), visibles avant export · `Comptable.tsx:542` → `[ ] utilisé` `[ ] jamais ouvert`
- **Profil comptable — à caler UNE fois avec le cabinet** — logiciel, journaux, comptes, format CSV, analytique · `Comptable.tsx:98` (rendue `:571`) → `[ ] utilisé` `[ ] jamais ouvert`
- **Régime de TVA (réponse du cabinet)** — encaissements ou débits ; c'est CE réglage qui pilote le calcul de la position TVA, et le changer se dit et s'annule · `Comptable.tsx:171-182` → `[ ] utilisé` `[ ] jamais ouvert`
- **Lots exportés (N)** — historique (version, empreinte, diff V1/V2) et import du retour du cabinet, accepté/rejeté par pièce · `Comptable.tsx:573` → `[ ] utilisé` `[ ] jamais ouvert`

## 7. Revue de direction (`#/finance/revue` — `src/modules/FinanceRevue.tsx`) — 8 lignes

Les huit sections s'affichent dans un ordre imposé
(`FinanceRevue.tsx:296-307`) ; les titres 1-3 et 6-7 sont produits par
`src/revue.ts`.

- **1 · Points bas de trésorerie (13 semaines)** — les semaines sous le seuil d'alerte · `src/revue.ts:151` → `[ ] utilisé` `[ ] jamais ouvert`
- **2 · Retards clients (N)** — les factures en retard, vues direction · `src/revue.ts:164` → `[ ] utilisé` `[ ] jamais ouvert`
- **3 · Clôture AAAA-MM** — l'état de la clôture, vue direction · `src/revue.ts:176` → `[ ] utilisé` `[ ] jamais ouvert`
- **4 · Hors périmètre & avenants potentiels** — les demandes hors contrat détectées → pipeline → chiffrage → avenant SIGNÉ (seule étape qui modifie le contrat) · `FinanceRevue.tsx:97` → `[ ] utilisé` `[ ] jamais ouvert`
- **5 · Jalons facturables (N)** — les jalons atteints qui peuvent devenir des échéances · `FinanceRevue.tsx:180` → `[ ] utilisé` `[ ] jamais ouvert`
- **6 · Marges finales qui dérivent (N)** — les projets dont la marge projetée dérive · `src/revue.ts:215` → `[ ] utilisé` `[ ] jamais ouvert`
- **7 · Consultations par valeur attendue (N)** — les consultations en cours, classées par valeur pondérée · `src/revue.ts:225` → `[ ] utilisé` `[ ] jamais ouvert`
- **8 · Décisions (N ouverte(s))** — le relevé de décisions : qui, quoi, pour quand, statut · `FinanceRevue.tsx:233` → `[ ] utilisé` `[ ] jamais ouvert`

## 8. Prévisions (`#/finance/previsions` — `src/modules/Previsions.tsx`) — 4 lignes

- **Budget de trésorerie — 12 mois glissants (TTC)** — encaissements probabilisés, récurrents, salaires, frais généraux, TVA paramétrée, point bas · `Previsions.tsx:32` → `[ ] utilisé` `[ ] jamais ouvert`
- **Simulateur de projet (aide à la décision)** — « si on signe ce projet » : honoraires pondérés, coût, marge attendue ; rien n'est écrit · `Previsions.tsx:126` → `[ ] utilisé` `[ ] jamais ouvert`
- **Rentabilité finale par client (HT)** — honoraires signés, coût final et marge, agrégés par client · `Previsions.tsx:193` → `[ ] utilisé` `[ ] jamais ouvert`
- **Coût & ROI des appels d'offres / concours** — le temps de prospection valorisé face à la valeur attendue des consultations · `Previsions.tsx:211` → `[ ] utilisé` `[ ] jamais ouvert`

## 9. Connecteurs (`#/finance/connecteurs` — `src/modules/Connecteurs.tsx`) — 5 lignes

- **Diagnostic** — l'état des six branchements (banque, mail, Drive, cabinet, Chorus, PDP), consentements bancaires compris · `Connecteurs.tsx:385` → `[ ] utilisé` `[ ] jamais ouvert`
- **Import bancaire — CAMT.053 · OFX/QFX · QIF · CSV (et connexion directe)** — ce n'est plus un import : c'est un RENVOI vers Banque & trésorerie, qui est le seul endroit à porter le solde de fin ; la carte rappelle le dernier relevé, le solde connu et les connexions à reconnecter · `Connecteurs.tsx:118` (rendue `:398`) → `[ ] utilisé` `[ ] jamais ouvert`
- **Import achat électronique — CII / UBL (ligne par ligne)** — lecture d'une facture fournisseur XML, TVA par taux, vers la boîte d'arrivée des Achats · `Connecteurs.tsx:189` (rendue `:399`) → `[ ] utilisé` `[ ] jamais ouvert`
- **Cycle de vie Chorus / PDP — import CSV** — le chemin hors ligne des statuts portail, rattachés par numéro de facture (la synchronisation automatique, elle, est dans Ventes) · `Connecteurs.tsx:263` (rendue `:400`) → `[ ] utilisé` `[ ] jamais ouvert`
- **Connecteurs directs — passerelles serveur HTTPS** — enregistrement d'URL de passerelles et healthcheck ; aucun secret dans le navigateur · `Connecteurs.tsx:337` (rendue `:401`) → `[ ] utilisé` `[ ] jamais ouvert`

---

**Total : 55 lignes à cocher.** 6 · 4 · 6 · 8 · 5 · 9 · 8 · 4 · 5.

---

## Après la séance de cochage

1. Reporter ici la date de la séance : ______________, et les deux
   signatures : ______________ · ______________.
2. Pour chaque ligne cochée « jamais ouvert » à deux, ouvrir la décision de
   masquage (un repli « Voir plus », jamais une suppression) — ce sera un
   livrable à part, avec sa propre trace, une décision par carte.
3. Ce qui est coché « utilisé » ne bouge pas, même si l'autre ne l'ouvre
   jamais : l'outil sert deux personnes, pas une moyenne des deux.
