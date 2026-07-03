# Contrat des modules — Cockpit L&L (intranet v2 « sans API »)

Contexte produit : intranet 100 % déterministe pour une agence d'architecture de 2 personnes
(Julien & Zoé). AUCUN appel API vers un modèle d'IA. L'intelligence passe par Claude *en tant
que produit* : l'intranet assemble des pré-prompts complets (gabarit + données de la base) et
les copie dans le presse-papier ; des routines Claude programmées produisent du JSON que
l'utilisateur colle dans le Cockpit (import). Règle d'or partout : **Claude propose, l'humain
valide** — tout ce qui est financier, contractuel ou sortant reste brouillon jusqu'à relecture.
Toute alerte/extraction est **traçable jusqu'à sa source**.

## Règles générales (tous modules)

- Un module = un fichier `src/modules/X.tsx`, export default d'un composant sans props.
- **Ne modifier AUCUN fichier partagé** (`types.ts`, `store.tsx`, `ui.tsx`, `util.ts`,
  `miqcp.ts`, `alerts.ts`, `derive.ts`, `prompts.ts`, `seed.ts`, `routines.ts`,
  `importRoutines.ts`, `styles.css`, `App.tsx`). Si un manque bloque, contourner localement
  (petit composant local, style inline) et le signaler dans la réponse finale.
- Lire les fichiers partagés avant d'écrire : les signatures ci-dessous sont un résumé.
- UI en **français**, ton professionnel sobre. Dates via `fmtDate`, montants via
  `fmtMoney`/`<Money>`, heures via `fmtHeures`. Pas d'emoji décoratifs.
- État global : `const { state, update } = useStore()` (`src/store.tsx`).
  Mutation : `update(d => { d.projets.push(p) })` — le draft est un clone, muter librement.
  Ne jamais muter `state` directement.
- Date du jour : `const today = useToday()` (chaîne `AAAA-MM-JJ`), jamais `new Date()` direct
  pour la logique métier (les helpers de `util.ts` travaillent sur des ISO strings).
- Identifiants : `uid('prefixe')` de `util.ts`.
- Navigation : liens hash `<a href="#/projets/P01">` ou `navigate('/projets/P01')`.
- Formulaires : composants contrôlés du kit (`TextInput`, `NumInput`, `DateInput`, `Select`,
  `TextArea`, `Field`, `Modal`, `Btn`). Création/édition dans un `Modal`.
- Suppression : `confirm()` natif suffit.
- Listes : `Table` + lignes ; état vide : `EmptyState`.
- Pré-prompts : TOUJOURS via `CopyBtn` (feedback « Copié ! ») ; texte assemblé par
  `assemble(corps, contexte)` de `prompts.ts` avec les constructeurs de contexte fournis.

## API partagée (résumé — lire les sources pour le détail)

`types.ts` : toutes les interfaces (Projet, Phase, MarcheTravaux, Situation, Facture,
TempsEntry, Reference, Obligation, Contact, Artisan, Materiau, Consultation, PromptTemplate,
Alerte, Settings, AppState…).

`util.ts` : `uid`, `todayISO`, `addDays`, `diffDays`, `mondayOf`, `monthKey`, `addMonths`,
`fmtMoney(v, cents?)`, `fmtPct(v, digits?)`, `fmtDate`, `fmtMois('AAAA-MM')`, `fmtHeures`,
`parseNum`, `clamp`, `fold` (normalisation accents/casse), `download(nom, contenu, type?)`.

`miqcp.ts` : `BAREME_1994`, `OUVRAGES` (`{code, bas, haut}`), `CRITERES_COMPLEXITE`
(3 groupes × critères), `TOUS_CRITERES`, `REPARTITION_PHASES`, `PHASES_ORDRE`,
`LIBELLES_PHASES`, `coefBT01(settings)`, `seuilPlancherActualise(settings)`,
`tauxBareme(montantHT, settings)`, `plageOuvrage(ouvrage)`, `coefComplexite(projet)`,
`totalPointsComplexite(projet)`, `calculHonoraires(projet, settings): CalculHonoraires`
(`{tauxBareme, coef, tauxAjuste, tauxFinal, honorairesBaseHT, missionsComplHT,
honorairesTotauxHT, sousPlancher}`), `phasesParDefaut(honorairesBaseHT, tauxHoraire)`.

`derive.ts` : `projetById`, `nomProjet`, `factureHT(state, projetId, phase?)`,
`encaisseHT`, `heuresReelles(state, projetId, phase?)`, `heuresPrevues(projet, phase?)`,
`coutEngage`, `encaissementPrevu(f)`, `retardFacture(f, today)`, `ttc(f)`,
`STATUTS_ACTIFS`, `meteoFinanciere(state, today): {tresorerie, tresorerieMajLe,
facturable90j, carnetHT}`, `dateLimiteVerif(state, situation)`,
`delaiMoyenPaiement(state, typeMO?)`.

`alerts.ts` : `computeAlertes(state, today)`, `alertesActives(state, today)` (snoozes filtrés).
Snooze = `d.settings.snoozes[alerte.id] = dateISO` (jusqu'à cette date).

`prompts.ts` : `assemble(corps, ctx)`, `copier(texte)`, `contexteProjet(state, p)`,
`contexteMarche(state, m, situation?)`, `contexteFacture(state, f)`,
`contexteConsultation(state, c)`, `contextePourTemplate(state, template, cible)`.

`importRoutines.ts` : `parseRetourRoutine(brut)` (tolère le texte autour du bloc ```json),
`importerSituations(draft, items)`, `importerConsultations(draft, items)`,
`rapprocherMarche`, `situationExiste`. `routines.ts` : `ROUTINES` (specs + prompts),
`CONTRAT_SITUATIONS`, `CONTRAT_CONSULTATIONS`.

`ui.tsx` : `useRoute()` (segments hash), `navigate`, `useToday`, `Page({titre, sousTitre?,
actions?})`, `Card({titre?, actions?, className?})`, `Badge({tone})` (`ok|warn|danger|info|muted`),
`Stat({label, value, sub?, tone?})`, `Money`, `DateF`, `EmptyState`, `Btn({kind, small,
disabled, title})` (`default|primary|ghost|danger`), `CopyBtn({text: string | () => string,
label?, kind?, small?})`, `Field({label, hint?})`, `TextInput`, `TextArea({mono?})`,
`NumInput({value: number|null})`, `DateInput({value: string|null})`, `Select({options})`,
`Modal({titre, onClose, large?})`, `Tabs({tabs, actif, onSelect})`, `Table({head, compact?})`.

Classes CSS utiles : `grid2 grid3 grid4`, `toolbar`, `spacer`, `kv` (dl), `pill-note`,
`muted small danger-text ok-text warn-text`, `mono`, `num`, `right` (td/th),
`clickable` (tr), `alert-item alert-2 alert-3 alert-dot alert-titre alert-detail
alert-actions`, `form-row form-foot`, `empty`.

## Spécifications par module

### Cockpit.tsx — tableau de bord
- **Météo financière** : 3 `Stat` en `grid3` via `meteoFinanciere` : Trésorerie disponible
  (sous-titre : date MAJ + « Paramètres » si vide, lien), Facturable à 90 jours, Carnet de
  commandes (honoraires restant à facturer). Si `settings.dernierImportExcel`, afficher en
  dessous une ligne discrète « Excel maître importé le … : carnet …, facturé … » (source
  maître la 1re année).
- **Fil d'urgences** : liste `alertesActives(state, today)` (toutes gravités) rendue avec les
  classes `alert-item alert-{gravite}` ; chaque alerte : dot, titre, détail, lien « ouvrir »
  vers `a.lien`, bouton « Sommeil 7 j » (snooze via update) et « 30 j ». Grouper visuellement :
  gravité 3 d'abord (l'ordre est déjà trié). État vide : « Rien d'urgent — le fil est calme. »
- **Repères du jour** : carte avec la date du jour formatée, phases en cours (projets actifs
  dont une phase encadre today, avec fin), 3 prochaines factures à émettre (statut prevue,
  émission ≥ today, triées), 3 prochaines obligations. Liens vers les modules.
- Sous-titre de page : rappel « Claude propose, l'humain valide — intranet 100 % déterministe ».

### Projets.tsx — projets & marchés (le plus gros module)
Routage interne : `useRoute()` → `['projets']` = liste ; `['projets', id]` = fiche.
- **Liste** : tableau (ID, nom, MO, statut Badge, montant travaux, honoraires totaux
  (`calculHonoraires`), facturé HT (`factureHT`), reste à facturer, heures réel/prévu).
  Ligne cliquable → fiche. Toolbar : recherche texte (`fold`), filtre statut, bouton
  « Nouveau projet » (Modal : id auto suivant P01…, nom, type MO, ouvrage (Select depuis
  OUVRAGES + option vide), montant travaux, statut ; à la création `phases =
  phasesParDefaut(honorairesBase estimés, settings.tauxHoraireVente)`).
- **Fiche projet** :
  - En-tête : nom, badges statut/MO, actions : boutons pré-prompts contextuels (voir plus bas),
    « Modifier » (Modal), « Supprimer » (confirm ; interdire si factures ou situations liées :
    alert() explicatif).
  - Carte **Honoraires (MIQCP)** : `kv` avec montant travaux, taux barème (`fmtPct(x, 2)`),
    coefficient (calculé ou manuel), taux ajusté, taux retenu (éditable NumInput, vide = auto),
    honoraires base, missions compl. (éditable), **total**, comparaison « temps passé »
    (heures prévues × taux horaire) et marge prévisionnelle (honoraires − heures prévues ×
    coût horaire, en € et %). Si `sousPlancher` : `pill-note` « Sous ~X € de travaux, le guide
    MIQCP renvoie au chiffrage en temps passé ».
  - Carte **Complexité** (repliable ou Modal) : grille des 27 critères par groupe, note
    −2..+2 (Select ou 5 boutons), total, position, plage de l'ouvrage, coefficient résultant ;
    champ « coefficient manuel » qui court-circuite.
  - Carte **Phases** : tableau éditable en place (montant, début, fin, heures prévues) +
    colonnes calculées : facturé HT (`factureHT(state, id, code)`), reste, heures réelles
    (`heuresReelles`), écart heures (badge warn/danger si > seuil). Ligne total.
    Bouton « Recalculer la répartition » (phasesParDefaut sur les honoraires base actuels,
    confirm car écrase).
  - Carte **Marchés de travaux** : liste des `state.marches` du projet (lot, entreprise,
    montant+avenants, RG, révision, actif ✓), CRUD en Modal, lien vers `#/situations`.
  - Boutons pré-prompts de la fiche (via gabarits `state.prompts` avec `contexte === 'projet'`,
    typiquement « Rédiger le CR de chantier ») : pour chacun un `CopyBtn` qui assemble
    `assemble(t.corps, contexteProjet(state, p))` et rappelle dans le libellé le Projet Claude
    cible, ex. « CR de chantier → coller dans “CR de chantier” ».

### Situations.tsx — « Secrétaire ++ »
- `pill-note` d'explication du circuit : situations@ → routine quotidienne → import ici →
  vérification humaine → visa. La MOE porte le risque sur le délai global de paiement :
  les délais de vérification sont calculés en dur.
- **Import** : Card « Coller le retour de la routine » : TextArea mono + bouton « Analyser » →
  `parseRetourRoutine` ; afficher aperçu (n situations, rattachements trouvés via
  `rapprocherMarche`, doublons via `situationExiste`) puis bouton « Importer » →
  `update(d => importerSituations(d, items))` ; afficher le résultat (ajoutées / doublons /
  non rattachées). Erreur de parse : message clair.
- **À vérifier** : tableau des situations `a_verifier` : entreprise, lot, projet (lien), mois,
  montant mois HT, cumul, confiance (badge : ≥0.8 ok, ≥0.5 warn, <0.5 danger), reçue le,
  **date limite de vérification** (`dateLimiteVerif`, badge danger si ≤ 3 j), source (title).
  Actions par ligne : « Vérifier avec Claude » (CopyBtn du gabarit `tpl-verif-situation`
  assemblé via `contexteMarche(state, marche, sit)` si marché rattaché — sinon désactivé avec
  title explicatif), « Valider » (statut validee), « Rejeter » (statut rejetee + prompt()
  motif dans notes), « Éditer » (Modal : tous champs, dont rattachement marché Select).
- **Historique** : tableau des validées/rejetées (repliable, 20 dernières).
- **Situations attendues** : pour chaque marché `actif`, état du mois courant (reçue ✓ /
  manquante) ; si manquante : CopyBtn « Relance » (gabarit `tpl-relance-situation`,
  `contexteMarche`). Note : marchés gérés dans la fiche projet.

### Facturation.tsx — honoraires & relances
- Stats en tête : montant en retard TTC (somme `retardFacture>0` → `ttc`), nb en retard,
  facturé HT cumul (statut ≠ prevue), encaissé TTC cumul, délai moyen de paiement
  (`delaiMoyenPaiement` global + par type de MO en sous-titre).
- **Échéancier** : tableau de toutes les factures triées par émission : n°, projet (lien),
  phase, libellé, HT, TTC, émission, échéance (`encaissementPrevu`), statut (Badge :
  prevue=muted « prévue », emise=info « émise », encaissee=ok « encaissée », retard=danger
  « en retard N j »), actions.
  Toolbar : filtre projet, filtre statut (dont « en retard »), bouton « Nouvelle facture »
  (Modal : projet, phase (Select PHASES_ORDRE), libellé, HT, TVA, émission, délai
  (pré-rempli depuis `settings.delaisPaiement[typeMO du projet]`)).
- Actions par ligne : « Émettre » (prevue→emise, l'émission devient la date du jour si
  passée ? non : garder la date, juste statut), « Encaisser » (Modal ou prompt date →
  statut encaissee + encaissementReel), « Modifier », « Supprimer » (confirm).
- **Relances graduées** : pour chaque facture en retard, 3 CopyBtn (courtoise / ferme /
  mise en demeure — gabarits `tpl-relance-courtoise|ferme|med` assemblés via
  `contexteFacture`). Les proposer directement dans une carte « Relances à faire »
  au-dessus de l'échéancier (une ligne par facture en retard, avec le retard en jours).

### Temps.tsx — grille hebdomadaire
- Sélecteur de semaine (lundi ; boutons ‹ › et « Cette semaine » ; `mondayOf`, `addDays`).
- Pour chaque personne (`settings.personnes`) : grille lignes = projets actifs
  (STATUTS_ACTIFS) + option d'ajouter une ligne pour une phase précise ; colonnes = phases
  de la mission ; MVP : lignes = couples (projet, phase) existants ou ajoutés via deux
  Select + bouton, cellule unique « heures de la semaine » (NumInput). Enregistrer =
  upsert des TempsEntry (clé semaine+personne+projet+phase ; heures 0 → suppression).
  Rester simple : « rempli en deux minutes ».
- Récap semaine : total heures par personne, badge si < ou > heures théoriques
  (`settings.heuresParJour` × 5).
- Récap dérives : par projet actif, heures pointées cumulées vs prévues, barre ou badge
  (ok < 80 %, warn ≥ 80 %, danger ≥ 100 %) — cohérent avec l'alerte du fil d'urgences.
- Ces données calibrent les futurs devis : afficher sous le titre « collecte dès le jour 1 ».

### VeilleAO.tsx — consultations & Go/No-Go
- **Import routine** : même mécanique que Situations (parse → aperçu → import
  `importerConsultations`).
- **Pipeline** : tableau par statut (a_etudier, go, no_go, deposee, gagnee, perdue) —
  filtre par statut + recherche. Colonnes : intitulé, acheteur, lieu, typologie, budget,
  date limite (badge danger si < 10 j et statut a_etudier/go), source, statut.
- Fiche/édition en Modal : tous champs + `avisGoNoGo` (TextArea), et si gagnee/perdue :
  classement, motifs. CRUD complet.
- Actions pré-prompts par consultation : « Analyser le RC » (tpl-analyse-rc),
  « Avis Go/No-Go » (tpl-go-nogo), « Sélection de références » (tpl-references-candidature),
  tous via `contexteConsultation` + CopyBtn, en rappelant le Projet Claude cible.
- Les résultats (gagné/perdu, classement, motifs) sont tracés pour affiner les avis suivants :
  petite carte bilan (taux de réussite, nb déposées).

### References.tsx — base de références (module V1 le plus rentable)
- Tableau : nom, lieu, année, MO, montant travaux, surface, mission, mots-clés (badges),
  attestation (✓/—), notes. Recherche plein texte (`fold` sur nom+lieu+moa+motsCles),
  filtres type MO et attestation. Tri par année desc par défaut.
- CRUD en Modal (motsCles = TextInput séparé par virgules ; photosDossier = chemin Drive).
- CopyBtn « Export texte pour candidature » global : liste formatée des références filtrées
  (même format que `contexteConsultation`.references) à coller dans un Projet Claude.
- Rappel discret : « Carburant des candidatures, du Go/No-Go et des futures planches. »

### Prompts.tsx — bibliothèque de gabarits (pièce maîtresse)
- Explication en sous-titre : un clic assemble gabarit + données et copie ; gabarits
  versionnés : quand un prompt s'améliore, toute l'agence en profite.
- Liste groupée par `domaine` : titre, Projet Claude cible (Badge info), contexte, version,
  MAJ le. Actions : « Utiliser », « Modifier », « Dupliquer », « Supprimer ».
- **Utiliser** : Modal : selon `t.contexte`, Select de la cible (projet / marché / facture /
  consultation — listes depuis state), aperçu du texte assemblé (`assemble` +
  `contextePourTemplate`) dans un `pre`, CopyBtn, rappel « à coller dans le Projet Claude
  “X” ». Contexte `libre` : pas de cible.
- **Modifier** : Modal large : titre, domaine, projetClaude, contexte (Select), corps
  (TextArea mono, 16 lignes) ; à l'enregistrement `version += 1`, `majLe = todayISO()`.
  Afficher la liste des placeholders disponibles selon le contexte (aide-mémoire statique :
  projet → {{fiche}}, {{projet_nom}}, {{moa}}, … ; marche → {{fiche_marche}}, {{entreprise}},
  … ; facture → {{facture_numero}}, … ; consultation → {{consultation}}, {{references}},
  {{charge_actuelle}} ; partout → {{date}}).
- « Nouveau gabarit » : Modal identique, version 1.

### Routines.tsx — routines Claude & imports (le « hook »)
- Sous-titre : les routines tournent à heure fixe dans Claude (accès Gmail/Drive/web) ;
  l'intranet n'appelle jamais d'API — on colle une fois le prompt de routine dans Claude,
  puis seuls les résultats font l'aller-retour.
- Pour chaque `ROUTINES` : Card avec titre, fréquence (Badge), description, CopyBtn
  « Copier le prompt de routine », détails repliables (`<details>`) montrant le prompt
  complet (`pre`) et le contrat JSON le cas échéant.
- Card **Import universel** : TextArea « collez ici le retour d'une routine » →
  `parseRetourRoutine` → aperçu → import vers situations ou consultations selon `type`
  (réutiliser `importerSituations`/`importerConsultations`) ; lien vers le module concerné
  après import.
- Card **Mode d'emploi** (statique, concise) : 1) créer les Projets Claude (CR de chantier,
  Analyse AO, Secrétariat, Matériauthèque) avec instructions et templates ; 2) créer les
  routines programmées avec les prompts ci-dessus ; 3) filtres Gmail + adresse situations@ ;
  4) chaque matin : lire le digest, coller les blocs JSON ici. Limites assumées : pas de
  tâche de fond hors routines, un copier-coller subsiste — à deux, chaque sortie est relue.

### Classement.tsx — nomenclature & classement
- **Générateur de nom** : Field date (défaut today), Select projet (+ « AGENCE »), Select
  type (ADM, PC, CR, DCE, PLAN, FACT, DEVIS, PHOTO, MAIL, NOTE, CCTP, SITU), objet (TextInput,
  normalisé : minuscules, tirets, sans accents via `fold`), version (NumInput défaut 1) →
  aperçu `AAAAMMJJ_P01_CR_objet_v01` + CopyBtn. La nomenclature (pattern) vient de
  `settings.nomenclature` (affichée, modifiable dans Paramètres).
- **Batch hebdo** : TextArea « collez la liste des fichiers à classer (un par ligne) » +
  CopyBtn qui assemble le gabarit `tpl-classement-batch` (contexte libre) en y substituant
  la liste collée à la place du marqueur « ⟦coller la liste ici⟧ » et en ajoutant la liste
  des codes projets actifs. (Assemblage local simple : `t.corps.replace('« ⟦coller la liste
  ici ⟧ »', liste)` — attention au marqueur exact, faire un replace sur « ⟦coller la liste
  ici⟧ ».)
- Note : sans API, pas d'indexation silencieuse — le type se choisit en deux clics et le
  renommage suit la nomenclature ; en appoint, le pré-prompt batch fait suggérer le
  classement par Claude (validation humaine avant tout renommage).

### Ressources.tsx — matériauthèque & annuaire d'artisans
- `Tabs` : « Artisans » / « Matériaux ».
- **Artisans** : tableau (nom, lots badges, zone, fourchette, décennale : DateF + badge
  danger si expirée / warn si < 60 j / ok sinon / muted si vide, contact, tel, notes).
  CRUD Modal (lots = TextInput virgules). Recherche + filtre lot.
- **Matériaux** : tableau (nom, fournisseur, coût €/m², lien FDES (a target _blank
  « FDES ↗ »), tags badges, notes). CRUD Modal. Recherche + filtre tag.
  Sous le tableau : CopyBtn « Prompt de tagging photos » (gabarit tpl-tagging-photos,
  contexte libre → assemble avec {date}) + rappel « photos déposées dans le Projet Claude
  “Matériauthèque”, retour JSON importé dans la base » ; prévoir un TextArea d'import du
  JSON de tags qui crée/complète des matériaux (best effort : tableau d'objets {fichier,
  materiaux[], teintes[], style[], vue, planche} → une ligne matériau par « materiaux »
  inconnu avec tag 'à trier' ; simple et traçable, notes = fichier source).
- L'argument carbone (FDES/INIES) disponible dès l'esquisse : `pill-note` en tête de
  l'onglet Matériaux.

### Agenda.tsx — échéancier réglementaire & CRM léger
- `Tabs` : « Obligations » / « Contacts (CRM) ». Low-tech, haute valeur.
- **Obligations** : tableau trié par échéance : libellé, organisme, échéance (badge danger
  si dépassée, warn si sous rappelJours), périodicité (« tous les N mois » / « ponctuelle »),
  rappel (N j avant), notes. Action « Fait » : si périodique → `echeance = addMonths… `
  (utiliser addDays(echeance, 0) ? Non : reconstruire : `const [y,m,d]=…` ; helper local :
  échéance suivante = même jour, +periodiciteMois mois — utiliser `addMonths(monthKey(e),n)`
  + jour d'origine, clampé à 28 si besoin) ; si ponctuelle → suppression (confirm).
  CRUD Modal.
- **Contacts** : tableau : nom, organisme, type (badge), email/tel, dernière interaction,
  prochaine action + date (badge danger si dépassée). Actions : « Fait aujourd'hui »
  (derniereInteraction = today, efface prochaine action après prompt() de la suivante ?
  Simple : Modal d'édition), CRUD Modal. Filtre type + recherche.
  Les prochaines actions datées alimentent le fil d'urgences (déjà câblé dans alerts.ts).

### Parametres.tsx — paramètres & données
- **Agence** : nomAgence, personnes (TextInput virgules), CA cible, taux horaire vente,
  coût horaire revient, heures/jour, seuil dérive (NumInput 0–1, hint « 0,9 = alerte à
  90 % »), délais de paiement par type de MO, nomenclature (TextInput), BT01 actuel
  (hint : « dernier connu : 137,5 — avril 2026, série Insee 001710986, ~2 mois de
  décalage » ; la réf. 1994 = 60,989 n'est pas éditable, l'afficher), tout via update.
- **Trésorerie** : tresorerieDispo (NumInput) + « MAJ aujourd'hui » (bouton règle
  tresorerieMajLe=today) — source : relevé bancaire ou Excel maître.
- **Import Excel maître** (`input type="file"` .xlsx, lib `xlsx` : `import * as XLSX from
  'xlsx'`) : lire l'onglet « Dashboard » ; par balayage des libellés (col B) récupérer :
  « Carnet signé + en cours (HT) », « Facturé HT (cumul) », « Reste à facturer HT »,
  « Point bas de trésorerie (horizon) », « Mois du point bas » (valeur voisine dans la
  ligne, première cellule numérique/date à droite du libellé). Stocker dans
  `settings.dernierImportExcel = {fichier, date: today, carnetHT, factureHT,
  resteAFacturerHT, pointBas, pointBasMois}` + afficher le dernier import. Gérer l'échec
  proprement (message). L'Excel reste la source maître la 1re année : le Cockpit n'écrase
  rien, il AFFICHE ces totaux (Cockpit.tsx les reprend).
- **Sauvegarde** : bouton « Exporter les données (JSON) » (`download('cockpit-ll-AAAA-MM-JJ.json',
  JSON.stringify(state, null, 2))`) ; import JSON (file input → `JSON.parse` → validation
  minimale (`version` number, `projets` array) → `replace(data)` avec confirm) ; bouton
  « Réinitialiser sur les données d'exemple » (confirm → `replace(seedState())` —
  importer `seedState` depuis seed.ts).
- **Snoozes** : liste des alertes en sommeil (`settings.snoozes`) avec bouton « réveiller ».
- Rappels données : carte statique — Supabase région UE prévue en cible ; en local, données
  dans le navigateur (localStorage) → exporter régulièrement ; minimisation de ce qui est
  collé dans Claude (pas de données personnelles inutiles).
