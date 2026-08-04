# Questions TVA à trancher avec le cabinet comptable (livrable 5.15)

> **Pourquoi ce document.** Le Cockpit imprime des mentions fiscales, projette
> des décaissements de TVA et exporte des écritures — mais le **régime** de TVA
> de l'agence n'a jamais été confirmé par le cabinet : le réglage qui porte la
> mention d'exigibilité est marqué « à CONFIRMER » dans le code depuis l'audit
> finance. Ce document liste les questions **précises** à poser, chacune avec la
> référence du code concerné, pour que la réponse du cabinet se traduise en un
> réglage (jamais en une réécriture de code). La doctrine ne change pas : la
> machine calcule et propose, le cabinet et l'agence décident.
>
> **Ce que le code garantit déjà** (verrouillé par `npm run test:tva`) : la
> règle d'arrondi des totaux (HT arrondi par ligne, TVA arrondie une fois au
> total), la cohérence HT + TVA = TTC au centime, et le fait que la mention
> d'exigibilité reste un réglage — aucune phrase de régime fiscal n'est codée
> en dur.

---

## 1. Exigibilité : encaissements ou débits ?

**Ce que le Cockpit affirme aujourd'hui.** Chaque facture émise imprime la
mention « **TVA sur les encaissements** » — c'est le défaut
(`MENTION_TVA_DEFAUT`, `src/facture.ts:213`), figé dans la copie légale à
l'émission (`construireFigee`, `src/facture.ts:249`), imprimé sur le PDF
(`src/pdf.ts`) et repris dans le Factur-X (`src/facturx.ts:120`). Le réglage
`Settings.mentionTVA` (`src/types.ts:1638-1641`, saisi dans Paramètres) permet
de le remplacer, et son commentaire porte « à CONFIRMER avec le cabinet »
depuis l'audit.

**Questions.**

- [ ] L'agence est-elle bien au régime de droit commun des prestations de
      services (TVA exigible à l'**encaissement**, art. 269, 2-c du CGI), ou
      a-t-elle exercé l'**option pour les débits** ? Si l'option a été
      formulée au SIE, à quelle date ?
- [ ] Quelle formulation exacte le cabinet veut-il voir sur les factures ?
      (Elle sera saisie telle quelle dans Paramètres → « Mention TVA » — le
      Cockpit imprime le réglage, pas une phrase à lui.)
- [ ] **Incohérence à purger :** le régime est enregistré à DEUX endroits qui
      ne se parlent pas — la mention imprimée (`Settings.mentionTVA`,
      `src/types.ts:1641`) et le champ libre « Régime de TVA (confirmé par le
      cabinet) » du profil comptable (`ProfilComptable.regimeTVA`,
      `src/types.ts:1055`, saisi dans `src/modules/Comptable.tsx:134-136`).
      Une fois le régime confirmé, remplir les deux avec la même réponse.

**Conséquence selon la réponse.** Le régime décide de la **date** à laquelle la
TVA collectée devient due : à l'encaissement (lecture depuis les paiements)
ou à l'émission (lecture depuis les factures). Le prévisionnel de trésorerie
(question 2) et la recette chiffrée (question 5) se lisent différemment selon
le cas.

## 2. Décaissement prévisionnel : un forfait saisi à la main

**Ce qui existe.** Un seul chiffre : `Settings.tvaMensuelleEstimee`
(`src/types.ts:1634-1635`, saisi dans Paramètres), posé en sortie le **20 de
chaque mois** dans la prévision 13 semaines (`src/tresorerie.ts:181-185`) et
dans le budget 12 mois (`src/economie.ts:482-486`). **Rien ne calcule** la TVA
réellement due depuis les factures émises, les encaissements ou les achats —
c'est un forfait déclaré, et l'écran le dit (« paramétré avec le cabinet »).

**Questions.**

- [ ] Quel est le régime déclaratif réel : réel normal (CA3 **mensuelle**),
      CA3 **trimestrielle** (TVA due < 4 000 €/an), ou réel simplifié
      (acomptes semestriels + CA12) ?
- [ ] Quel montant et quelle date d'échéance retenir pour le forfait
      prévisionnel actuel ? (Le 20 du mois est une approximation codée —
      `src/tresorerie.ts:181` — à caler sur l'échéance réelle de l'agence.)
- [ ] Le cabinet veut-il, à terme, que la CA3 soit pré-remplie depuis les
      pièces du Cockpit (TVA collectée par taux, TVA déductible des achats
      ventilés — `lireFactureXMLDetail` lit déjà la TVA par taux des factures
      fournisseurs) ? C'est possible, mais ce serait un livrable à part
      entière — pas avant la confirmation du régime.

## 3. Crédit de TVA remboursable : rien ne le suit

**Constat.** Quand la TVA déductible dépasse la collectée (gros achats,
investissement, trimestre creux), il naît un **crédit de TVA** — reportable ou
remboursable. **Aucune donnée du Cockpit ne le représente** : la TVA n'apparaît
que comme une SORTIE prévisionnelle (`montant: -tva`, `src/tresorerie.ts:184`
et `src/economie.ts:486`) ; aucune collection d'AppState ne porte un crédit, un
report ou une demande de remboursement. Une entrée de trésorerie réelle
(remboursement du SIE) arriverait aujourd'hui comme un mouvement bancaire à
justifier à la main, sans lien avec sa cause.

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
3. le rapprochement attendu, selon la réponse à la question 1 :
   - régime **encaissements** : TVA collectée du trimestre ≈ somme de la TVA
     des paiements clients reçus sur la période (paiements du Cockpit,
     ventilés par taux depuis les pièces figées) ;
   - régime **débits** : TVA collectée ≈ somme de `totalTVA` des factures
     émises sur la période (copies figées) ;
   - TVA déductible ≈ TVA des factures d'achats validées de la période.

Tout écart doit avoir un nom (pièce hors Cockpit, décalage de déclaration,
arrondi) ; un écart sans nom est un défaut — le signaler et le traiter comme
tel.

---

*Document préparé le 04/08/2026 (livrable 5.15). Les garanties côté code sont
verrouillées par `scripts/test-tva.cjs` ; les réponses du cabinet se
traduisent en réglages (Paramètres, profil comptable), pas en code nouveau.*
