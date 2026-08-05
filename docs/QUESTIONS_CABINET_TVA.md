# Questions TVA à trancher avec le cabinet comptable (livrable 5.15)

> **Pourquoi ce document.** Le Cockpit imprime des mentions fiscales, projette
> des décaissements de TVA, exporte des écritures — et calcule désormais une
> **position TVA** (« ce qu'on doit à l'État », `src/tva.ts`, carte TVA de
> Finance) selon une **convention appliquée par défaut**, décrite ci-dessous.
> Le régime n'a toujours pas été confirmé par le cabinet : la question n'est
> plus « que faut-il coder ? » mais « **valider ou corriger ce réglage** » —
> chaque réponse se traduit en un réglage (jamais en une réécriture de code).
> La doctrine ne change pas : la machine calcule et propose, le cabinet et
> l'agence décident.
>
> **La convention appliquée par défaut** (verrouillée par
> `npm run test:position-tva`) :
>
> - **TVA collectée à l'encaissement** — le régime de droit commun des
>   prestations de services : quand un paiement client arrive, la part de TVA
>   de ce paiement devient due, au prorata du TTC de la facture réglée. Le
>   réglage `Settings.regimeTVA` (`'encaissements'` par défaut, `'debits'` en
>   option — `src/types.ts`) bascule le calcul sur la date d'**émission** si
>   le cabinet confirme l'option pour les débits.
> - **TVA déductible au paiement de l'achat** (`payeLe`) — choix prudent : on
>   ne déduit jamais ce qui n'a pas été payé, donc le « dû à l'État » affiché
>   n'est jamais sous-estimé. Une pièce écartée est hors calcul ; une TVA
>   d'achat non renseignée vaut 0 déductible.
> - Le « dû à l'État » somme les soldes des **mois échus non encore marqués
>   déclarés** ; « Marquer déclarée » est un geste humain qui fige le solde du
>   mois (`tvaDeclarations`) — la machine ne déclare jamais seule.
>
> **Ce que le code garantit déjà** (verrouillé par `npm run test:tva`) : la
> règle d'arrondi des totaux (HT arrondi par ligne, TVA arrondie une fois au
> total), la cohérence HT + TVA = TTC au centime, et le fait que la mention
> d'exigibilité reste un réglage — aucune phrase de régime fiscal n'est codée
> en dur.

---

## 1. Exigibilité : valider ou corriger le réglage « encaissements »

**Ce que le Cockpit applique aujourd'hui.** Deux choses, alignées sur le même
défaut :

1. chaque facture émise imprime la mention « **TVA sur les encaissements** »
   (`MENTION_TVA_DEFAUT`, `src/facture.ts:214`), figée dans la copie légale à
   l'émission (`construireFigee`), imprimée sur le PDF (`src/pdf.ts`) et
   reprise dans le Factur-X (`src/facturx.ts`) ; le réglage
   `Settings.mentionTVA` permet de la remplacer ;
2. la **position TVA calculée** (`positionTVA`, `src/tva.ts`) compte la
   collectée **à l'encaissement** : la part de TVA de chaque paiement reçu, au
   prorata du TTC de la facture réglée (avoirs et remboursements : montants
   négatifs, même chemin). Le réglage `Settings.regimeTVA`
   (`'encaissements'` par défaut) bascule ce calcul sur la date d'émission des
   pièces si l'option pour les **débits** est confirmée.

**Questions — valider ou corriger ce réglage.**

- [ ] L'agence est-elle bien au régime de droit commun des prestations de
      services (TVA exigible à l'**encaissement**, art. 269, 2-c du CGI), ou
      a-t-elle exercé l'**option pour les débits** ? Si l'option a été
      formulée au SIE, à quelle date ? → la réponse se pose dans
      `Settings.regimeTVA` (`'encaissements'` ou `'debits'`), rien d'autre à
      changer.
- [ ] Quelle formulation exacte le cabinet veut-il voir sur les factures ?
      (Elle sera saisie telle quelle dans Paramètres → « Mention TVA » — le
      Cockpit imprime le réglage, pas une phrase à lui.)
- [ ] **Cohérence à tenir :** le régime vit désormais à TROIS endroits — la
      mention imprimée (`Settings.mentionTVA`), le réglage du calcul
      (`Settings.regimeTVA`) et le champ libre de mémoire du profil comptable
      (`ProfilComptable.regimeTVA`, saisi dans `src/modules/Comptable.tsx`).
      Une fois le régime confirmé, aligner les trois sur la même réponse.

**Conséquence selon la réponse.** Le régime décide de la **date** à laquelle la
TVA collectée devient due : à l'encaissement (lecture depuis les paiements)
ou à l'émission (lecture depuis les factures). La position calculée bascule
d'elle-même avec le réglage ; le prévisionnel de trésorerie (question 2) et la
recette chiffrée (question 5) se lisent différemment selon le cas.

## 2. Décaissement prévisionnel : le forfait reste, la position est calculée

**Ce qui existe.** Deux chiffres qui ne se remplacent pas :

- le **forfait prévisionnel** `Settings.tvaMensuelleEstimee` (saisi dans
  Paramètres), posé en sortie le **20 de chaque mois** dans la prévision
  13 semaines (`src/tresorerie.ts:181-185`) et dans le budget 12 mois
  (`src/economie.ts:482-486`) — un forfait déclaré, et l'écran le dit
  (« paramétré avec le cabinet ») ;
- la **position calculée** (`src/tva.ts`, carte TVA) : collectée − déductible
  par mois depuis les pièces réelles, et le « dû à l'État » des mois échus non
  déclarés. Elle constate, elle ne projette pas — le forfait garde la main
  sur le prévisionnel tant que le cabinet n'a pas calé mieux.

**Questions.**

- [ ] Quel est le régime déclaratif réel : réel normal (CA3 **mensuelle**),
      CA3 **trimestrielle** (TVA due < 4 000 €/an), ou réel simplifié
      (acomptes semestriels + CA12) ? (La position calculée est mensuelle ;
      en trimestriel, trois mois se déclarent d'un coup — trois gestes
      « Marquer déclarée ».)
- [ ] Quel montant et quelle date d'échéance retenir pour le forfait
      prévisionnel actuel ? La position calculée des derniers mois échus
      (carte TVA) donne un ordre de grandeur constaté pour recaler ce
      forfait. (Le 20 du mois est une approximation codée —
      `src/tresorerie.ts:181` — à caler sur l'échéance réelle de l'agence.)
- [ ] Le cabinet veut-il, à terme, que la CA3 soit pré-remplie depuis les
      pièces du Cockpit ? La position mensuelle collectée/déductible/solde
      existe désormais (`positionTVA`) ; la ventilation **par taux** et le
      format CA3 restent un livrable à part — pas avant la confirmation du
      régime (question 1).

## 3. Crédit de TVA remboursable : rien ne le suit

**Constat.** Quand la TVA déductible dépasse la collectée (gros achats,
investissement, trimestre creux), il naît un **crédit de TVA** — reportable ou
remboursable. La position calculée le **montre** désormais (un solde mensuel
négatif, affiché « crédit de TVA » sur la carte, qui diminue le dû — c'est le
report), mais **rien ne le suit** au-delà : aucune collection d'AppState ne
porte une demande de remboursement ni son virement attendu, et la TVA du
prévisionnel reste une SORTIE (`montant: -tva`, `src/tresorerie.ts:184` et
`src/economie.ts:486`). Une entrée de trésorerie réelle (remboursement du SIE)
arriverait aujourd'hui comme un mouvement bancaire à justifier à la main, sans
lien avec sa cause.

**Questions.**

- [ ] L'agence a-t-elle déjà été, ou risque-t-elle d'être, en crédit de TVA ?
      (Le cabinet le voit sur les CA3 passées.)
- [ ] Si oui : politique du cabinet — report systématique ou demande de
      remboursement dès les seuils atteints (760 € en mensuel/trimestriel,
      150 € en annuel) ?
- [ ] Faut-il le suivre dans le Cockpit (une entrée prévisionnelle datée dans
      la trésorerie, rapprochée du virement du SIE) ? Ne rien bâtir avant la
      réponse : si le cabinet reporte toujours, un suivi ne servirait à rien.

## 4. Autoliquidation : des cas existent-ils ?

**Constat.** Le mot n'apparaît nulle part dans le code. Le modèle **permet**
une ligne à TVA 0 % (`LigneFacture.tauxTVA`, `src/types.ts:679-688` ; contrôle
0–100 % à l'émission, `src/facture.ts:152-162`), mais la seule mention
imprimable est la mention d'exigibilité globale (`Settings.mentionTVA`) — pas
de mention « Autoliquidation » par pièce, alors qu'elle est **obligatoire** sur
la facture dans les cas concernés.

**Questions.**

- [ ] Client assujetti établi dans l'**UE** (ou hors UE) : y a-t-il, ou
      pourrait-il y avoir, des honoraires facturés à un preneur étranger
      (TVA autoliquidée par le preneur, facture HT avec mention
      « Autoliquidation ») ?
- [ ] **Sous-traitance** : quand l'agence intervient en sous-traitance de
      maîtrise d'œuvre pour un autre architecte ou un contractant général,
      l'autoliquidation du secteur du bâtiment (art. 283, 2 nonies du CGI)
      s'applique-t-elle à ses prestations ? (C'est une question de
      qualification que seul le cabinet peut trancher — le CCAG et les
      cotraitances du livrable 5.10 rendent le cas plausible.)
- [ ] Si un cas existe : quelle mention exacte, et faut-il un réglage par
      facture (et non global) ? Rien ne sera codé avant la réponse.

## 5. Recette chiffrée sur un trimestre réel — à faire ensemble

Le livrable 5.15 prévoit une vérification **sur pièces** d'un trimestre
réellement déclaré. Matériel à apporter au rendez-vous :

1. le **lot comptable** exporté du Cockpit pour chaque mois du trimestre
   (Finance → Comptable — écritures, ventes, achats, paiements, manifeste et
   empreinte) ;
2. la **CA3 déposée** du même trimestre (cabinet) ;
3. le rapprochement attendu, selon la réponse à la question 1 — la carte TVA
   donne ces chiffres mois par mois (`positionTVA`, `src/tva.ts`) :
   - régime **encaissements** : TVA collectée du trimestre ≈ somme de la TVA
     des paiements clients reçus sur la période (paiements du Cockpit, au
     prorata du TTC des pièces figées) ;
   - régime **débits** (réglage `Settings.regimeTVA = 'debits'`) : TVA
     collectée ≈ somme de `totalTVA` des factures émises sur la période
     (copies figées) ;
   - TVA déductible ≈ TVA des factures d'achats **payées** sur la période
     (convention du calcul : déductible au paiement — le cabinet peut
     préférer la date de facture, c'est un point à trancher ici).

Tout écart doit avoir un nom (pièce hors Cockpit, décalage de déclaration,
arrondi) ; un écart sans nom est un défaut — le signaler et le traiter comme
tel.

---

*Document préparé le 04/08/2026 (livrable 5.15), mis à jour le 04/08/2026 :
la position TVA est désormais calculée (`src/tva.ts`, convention par défaut
« collectée à l'encaissement · déductible au paiement ») — la question au
cabinet devient « valider ou corriger ce réglage ». Les garanties côté code
sont verrouillées par `scripts/test-tva.cjs` et
`scripts/test-position-tva.cjs` ; les réponses du cabinet se traduisent en
réglages (Paramètres, profil comptable), pas en code nouveau.*
