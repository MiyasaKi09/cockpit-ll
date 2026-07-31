# Contrat des modules — Cockpit L&L (intranet v2 « sans API »)

Contexte produit : intranet déterministe pour une agence d'architecture de 2 personnes
(Julien & Zoé).

**L'appel serveur à un modèle d'IA est autorisé, et il existe déjà** : `api/assistant.js`
interroge l'API Anthropic depuis une fonction Vercel, derrière une session Supabase vérifiée et
une liste d'adresses autorisées. La rédaction précédente — « AUCUN appel API vers un modèle
d'IA » — décrivait un état dépassé et interdisait des livrables désormais au plan
(`docs/PLAN_CDC_MAILS_TACHES_TEMPS.md`) : résumé automatique des messages, propositions de
tâches et d'échéances. La voie du presse-papier reste valable et reste la règle pour tout ce
qui est volumineux ou ponctuel : l'intranet assemble des pré-prompts complets (gabarit +
données de la base) et les copie ; des routines Claude produisent du JSON que l'utilisateur
colle dans le Cockpit.

Ce qui ne change pas, et qui est le cœur du contrat :

- **Claude propose, l'humain valide** — tout ce qui est financier, contractuel ou sortant reste
  brouillon jusqu'à relecture. Une proposition de l'IA porte toujours un statut distinct de
  l'objet métier qu'elle propose de créer ; elle ne devient jamais cet objet par expiration de
  délai ou par défaut.
- Toute alerte, extraction ou proposition est **traçable jusqu'à sa source** — l'e-mail, le
  document, la ligne de relevé. Une réponse sans source est un défaut, pas une approximation.
- Aucune action irréversible ni sortante n'est déclenchée par un modèle : les périmètres OAuth
  restent en lecture seule et l'envoi passe par un brouillon Gmail ouvert à l'écran.

**Ces trois règles sont opposables, pas seulement écrites** — c'était le livrable 0.14, et
c'est ce qui les sépare d'une intention. `scripts/test-oauth-lecture-seule.cjs` refuse tout
périmètre Google autre que `gmail.readonly` / `calendar.readonly`, tout verbe d'écriture vers
Gmail, et garde `gmailComposeUrl` (`util.ts`) comme seul constructeur d'un envoi — critères 1
et 14 du §22. `scripts/test-propositions-modifiables.cjs` vérifie qu'un champ proposé par une
machine a un pendant humain modifiable, que c'est le choix humain qui est enregistré, et
qu'aucune insertion serveur ne naît validée — critère 11, périmètre `entrants` au Lot 0, la
table `communications` viendra au MVP. `scripts/test-adresses-en-dur.cjs` interdit les deux
adresses de connexion réelles hors du registre `public.membres` : c'est la dépendance dure de
la bascule d'identité (livrable 3.2), qui ne démarre pas tant qu'il n'est pas vert.

## Règles générales (tous modules)

- Un module = un fichier `src/modules/X.tsx`, export default d'un composant sans props.
- **Les fichiers partagés se modifient, mais jamais en passant** (`types.ts`, `store.tsx`,
  `ui.tsx`, `util.ts`, `miqcp.ts`, `alerts.ts`, `derive.ts`, `prompts.ts`, `seed.ts`,
  `routines.ts`, `importRoutines.ts`, `personnes.ts`, `moi.ts`, `categorisation.ts`,
  `horsLigne.ts`, `communications.ts`, `rattachement.ts`,
  `styles.css`, `App.tsx`). L'interdiction
  absolue précédente avait un motif réel — un module qui bricole `ui.tsx` casse les 42 autres —
  mais elle produisait l'inverse de son intention : des composants locaux dupliqués, des styles
  en ligne, et un repli mobile qui s'est dégradé module par module. La règle est donc :
  - une modification de fichier partagé est un livrable **en soi**, pas un effet de bord d'un
    module ; elle s'annonce et se justifie ;
  - elle est **rétrocompatible** : on ajoute un paramètre optionnel, on ne change pas une
    signature existante ;
  - si elle porte une invariante, elle vient avec son test statique dans `scripts/`.
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
- **Tout tableau affiché passe par `Table`**, jamais par une balise `<table>` écrite à la main.
  C'est `Table` qui porte le repli en cartes empilées sous 700 px : une table brute est
  illisible sur un téléphone, et c'est ainsi que le responsive s'est perdu dans sept modules.
  Les gabarits d'impression (`src/pdf.ts`, les fenêtres `window.print()`) sont hors de cette
  règle : ils ne sont jamais montés dans le navigateur.
- **L'accueil n'invente aucun calcul.** Le Cockpit et les vues personnelles n'affichent que des
  valeurs déjà produites par `derive.ts`, `economie.ts`, `alerts.ts` ou `financeActions.ts`. Un
  chiffre recalculé sur place diverge tôt ou tard de celui du module qui fait autorité, et
  l'écart se découvre en réunion. Si la valeur n'existe pas, elle s'ajoute au module de calcul,
  pas à l'écran qui l'affiche.
- **L'utilisateur courant se lit par `useMoi()`** (`src/moi.ts`), jamais par
  `settings.personnes[0]`. L'identité a deux étages : la session Supabase quand elle existe
  (la personne dont `Personne.email` correspond), sinon le choix « je suis X » mémorisé sur
  le poste, sinon `null` — et `null` veut dire `null` : un écran qui ne sait pas qui est là
  ne doit rien signer, pas désigner le premier de la liste. Le choix par poste vit dans le
  `localStorage`, jamais dans `settings` : `settings` est synchronisé, et les deux postes
  s'écraseraient. `scripts/test-identite.cjs` le vérifie.
- **Une personne se référence par son nom, partout** — et donc `src/personnes.ts` tient
  l'inventaire des endroits qui la citent. Toute nouvelle collection portant un nom de personne
  s'y ajoute, sinon un renommage dans les Paramètres orpheline ses données en silence.
  `scripts/test-renommage-personne.cjs` le vérifie. **La règle qui tranche** : un champ qui
  désigne *la personne* (`responsable`, `pour`, `auteur` d'un document ou d'une note) entre dans
  l'inventaire ; une trace datée qui dit *qui a agi ce jour-là* (`validePar`, `evenements[].auteur`)
  n'y entre pas. `Projet.journal[].auteur` manquait à l'inventaire alors que
  `DocumentRecord.auteur` y figurait — or `ProjetJournal.tsx` écrit la **même** valeur dans les
  deux : deux copies d'un seul choix divergeaient au premier renommage.
- Pré-prompts : TOUJOURS via `CopyBtn` (feedback « Copié ! ») ; texte assemblé par
  `assemble(corps, contexte)` de `prompts.ts` avec les constructeurs de contexte fournis.

## API partagée (résumé — lire les sources pour le détail)

`types.ts` : toutes les interfaces (Projet, Phase, MarcheTravaux, Situation, Facture,
TempsEntry, Reference, Obligation, Contact, Artisan, Materiau, Consultation, PromptTemplate,
Alerte, Settings, AppState…).

`util.ts` : `uid`, `todayISO`, `addDays`, `diffDays`, `mondayOf`, `monthKey`, `addMonths`,
`fmtMoney(v, cents?)`, `fmtPct(v, digits?)`, `fmtDate`, `fmtMois('AAAA-MM')`, `fmtHeures`,
`parseNum`, `clamp`, `fold` (normalisation accents/casse), `download(nom, contenu, type?)`,
`DOMAINE_AGENCE` (`agence-ll.fr` — non acheté : il ne sert qu'à *proposer*, rien ne doit
dépendre de son existence), `adresseProjetProposee(codeExterne, domaine?)`,
`adresseProjetValide(adresse)` (aucun domaine présumé ; le champ vide est valide),
`gmailComposeUrl` / `ouvrirGmail` (le seul chemin sortant, §22 critère 14),
`gmailMessageUrl(id)` (le seul constructeur d'URL Gmail) et `lienGmail(source)`, qui lit les
quatre formes sous lesquelles le dépôt garde la trace d'un message — voir `LienGmail` ci-dessous.

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
`delaiMoyenPaiement(state, typeMO?)` ; **baseline des heures** (CDC §11.3) :
`heuresBaseline(projet, phase?)` (`null`, jamais `0`, quand il n'y a pas de
référence), `ecartHeures(state, projet, phase?): EcartHeuresPhase`
(`{baseline, prevu, reel, reference, ecart, surBaseline, derivePrevision}` — l'écart
signé du §11.3), `baselineDepuisPhases(phases, meta)`, `normaliserBaselineHeures`,
`baselineApresMigration(projet, reprendre, le)` ; **accueil du §8.1** :
`documentsATraiter(state)` (+ `STATUTS_DOCUMENT_A_TRAITER`), `situationsAVerifier(state)`,
`validationsAttendues(state, today, actionsFinance, entrantsDistants?): GroupeValidation[]`,
`reunionsDuJour(state, today, agenda?): ReunionDuJour[]`, `evenements(state): EvtCal[]`
(+ `COULEURS_ECHEANCE`) et `prochainesEcheances(state, today, jours = 14)`,
`phasesEnCours(state, today)`, `semaineParPersonne(state, lundi, personnes?):
LigneSemainePersonne[]` (temps pointé, charge planifiée et capacité en regard).

**La prévision d'heures figée ne vit jamais dans `Phase`.** `Projet.baselineHeures` est
un champ à part parce que « Recalculer la répartition » remplace `projet.phases` en
entier : une référence rangée dans une phase disparaîtrait avec elle, sans erreur, et
l'écart prévu / réel se reconstituerait faux la semaine suivante. Un écran qui compare
prévu et réel passe par `ecartHeures` — jamais par une soustraction locale — et n'écrit
`baselineHeures` que sur un geste humain explicite (signature, figeage, redéfinition).
`scripts/test-baseline-heures.cjs` le vérifie, et il porte le critère 15 du §22.

**« Ouvrir dans Gmail » n'a qu'un composant : `LienGmail` (`ui.tsx`).** Le CDC §4.2 exige le
bouton sur *chaque* e-mail affiché et sur *chaque* objet qui en est issu — pièce jointe classée,
document du registre, note de journal archivée depuis un mail. Il existait deux fois, avec deux
libellés pour le même geste, avant que la seconde copie n'oublie `rel="noreferrer"`. Le composant
prend une `source` sous n'importe laquelle des quatre formes du dépôt (identifiant nu de
`EntrantDistant.sourceMessageId` ou `Communication.gmailMessageId`, `gmail:<id>` de
`Courrier.source`, URL figée de `DocumentRecord.sourceUrl` / `NoteJournal.source`, ou du texte qui
ne désigne aucun message) et les ramène à une URL par `lienGmail` (`util.ts`) — `gmailMessageUrl`
restant le seul constructeur d'URL Gmail du dépôt. **Quand la source n'identifie aucun message, il
le dit** au lieu de ne rien afficher : une absence muette se lit « ce message n'existe plus »,
alors qu'il est dans Gmail et que c'est le Cockpit qui ne sait pas lequel ; `muet` supprime cette
mention là où elle serait du bruit, jamais là où l'utilisateur décide à partir du message.
`scripts/test-lien-gmail.cjs` rend le composant en HTML, vérifie sur l'arbre syntaxique qu'il est
monté dans chacune des sept surfaces d'affichage, et refuse qu'un autre fichier prononce
« Ouvrir dans Gmail » — c'était la leçon du 0.6, dont le test ne regardait que le stockage : un
lien rangé et jamais montré ne ramène personne à son e-mail. Il porte les critères 3 et 10 du §22.
Le critère 2, lui, ne tient pas au lien de retour mais à ce que le message soit **indexé** (A.2)
et **affiché** (A.7, puis B.15) : tant que la file quotidienne lit `state.courriers`, un courrier
importé par une routine n'a pas d'identifiant Gmail et le composant le dit.

**Le résumé automatique du §5.3 n'a qu'un composant : `ResumeMessage` (`ui.tsx`).**
Il rend `communications.resume` — les trois phrases qu'une machine a écrites — et il
rend TOUJOURS avec elles la mention « brouillon » et la phrase du §5.3 : le résumé ne
remplace jamais le message d'origine. C'est là toute sa raison d'être : le texte, seul,
est indiscernable de ce que l'expéditeur a écrit, et un écran qui l'afficherait sans sa
mention transformerait une aide de lecture en source. Sans résumé il n'affiche rien —
la plupart des messages n'en ont pas, et le dire partout serait du bruit. Il ne porte pas
le lien de retour : `LienGmail` est monté à côté, sur la même surface. **Tout écran qui
lit `Communication.resumeLe` doit monter ce composant** ; `scripts/test-resume-messages.cjs`
le vérifie fichier par fichier, rend le composant en HTML et refuse une seconde
définition. Il est monté aujourd'hui dans `CarteMessagesARattacher` (`Documents.tsx`) —
le seul écran où un message déjà résumé peut réapparaître, puisqu'il a fallu le détacher
à la main pour l'y ramener ; A.7 le montera dans `LigneCourrier`, où il servira chaque
matin.

**Le résumé est produit côté serveur, jamais dans le navigateur.** L'Edge Function
`supabase/functions/resume-messages` (livrable A.6, §3.8) est la seule à appeler un
modèle pour cet usage, avec **sa propre clé Anthropic** (secret Supabase
`RESUME_ANTHROPIC_API_KEY`, jamais celle de Vercel), **son propre secret de
planification** (`ingestion_config.resume_cron_secret`, distinct de celui des quatre
autres tâches : c'est la seule qui dépense de l'argent à chaque passage) et **sa propre
limitation de débit** à trois bornes — huit appels par passage, quarante par heure, deux
cents par jour, comptés dans `resume_le`, c'est-à-dire dans ce qui a réellement été
facturé. Elle ne résume que les messages **rattachés à un projet** (colonne générée
`projet_id`), et elle n'écrit que `resume` et `resume_le` : ni le corps, ni l'objet, ni un
axe, ni un rattachement. Elle ne détecte **ni tâche, ni échéance, ni décision, ni
risque** — c'est A.9 (la table `propositions`) et A.10 (les détecteurs), et sa consigne
le lui interdit nommément.

`fsdrive.ts` : accès au dossier Drive local (File System Access) — `supporteFS`,
`choisirRacine` / `lireRacine` / `sauverRacine` (poignée mémorisée en IndexedDB),
`verifierPermission`, `slugProjet(p)`, `nomConforme`, `rangerFichier`,
`listerFichiersProjet` / `listerFichiersRacine`, `DOSSIER_ENTRANTS`, `ARBORESCENCE`,
`phaseDuDossier` ; **arborescence documentaire** (CDC §12.1 pts 6 et 7) :
`creerArborescenceProjet(racine, p): ResultatArborescence` (`{dossierProjet, crees,
existants}`).

**Aucun module ne crée de dossier dans le Drive en direct** : la liste des dossiers se
déclare dans `ARBORESCENCE` et se crée par `creerArborescenceProjet`, point d'entrée
unique du bouton « Créer / compléter l'arborescence » (onglet Documents du projet) comme
de la fin de l'assistant « Nouveau projet ». Une boucle de création recopiée dans un
module ferait diverger la forme des dossiers selon la porte par laquelle le projet est né
— le jour où `ARBORESCENCE` gagne une entrée, les fichiers continueraient de se ranger,
simplement plus au même endroit. La fonction est **idempotente et non destructive** (un
dossier déjà là garde son contenu) et elle **lève** : c'est l'appelant qui décide du sens
de l'échec. À la création d'un projet, cet échec (Drive absent, permission refusée,
navigateur sans File System Access) **se signale et n'empêche rien** — le projet est
enregistré avant, et la saisie n'est jamais reperdue.
`scripts/test-arborescence-projet.cjs` le vérifie.

`moi.ts` : `useMoi(): Moi` (`{personne, nom, source: 'session'|'poste'|'aucune', emailSession,
sessionOrpheline, choisir(nom|null)}`), `useSessionSupabase()` (session Supabase **réactive** :
le composant se re-rend à la connexion comme à la déconnexion), `useIdentitePoste()`,
`identitePoste()` / `definirIdentitePoste(nom|null)` hors React, `resoudreMoi(equipe, email,
choixPoste)` (règle pure, testable), `normaliserEmail`.

`alerts.ts` : `computeAlertes(state, today)`, `alertesActives(state, today)` (snoozes filtrés).
Snooze = `d.settings.snoozes[alerte.id] = dateISO` (jusqu'à cette date).

**Les trois axes du §5.2 sont PROPOSÉS par un lexique, jamais par un modèle.** Le classifieur
déterministe vit dans `supabase/functions/_shared/classement-echanges.ts` (livrable A.8, §3.14
décision 5) : un lexique par axe, des raisons en français, un plafond de confiance commun avec la
cascade, et un **repli explicite** — sous le seuil, ou quand deux lectures s'équivalent, l'axe reste
VIDE et le dit. Il ne recopie **aucune** des trois listes fermées : il en émet des valeurs, et
`scripts/test-classement-echanges.cjs` compare chacune à `src/categorisation.ts`. Une valeur
inventée serait refusée par le domaine SQL à l'insertion, et le message ne serait jamais indexé —
sans autre trace que les journaux Supabase. Le type d'échange part de ce que l'agence sait déjà
(`Projet.emailMOA`, `Contact.type`, `MarcheTravaux.contactEmail`, `Entreprise.domaines`, le registre
`public.membres`) avant de regarder le domaine puis l'objet, dans cet ordre ; le désaccord entre
deux étages est **écrit dans les raisons**, jamais arbitré en silence. Contrairement à
`_shared/rattachement.ts`, ce module **importe** (la cascade, pour `fold` et la normalisation des
adresses) : il ne tourne que dans Deno et dans le test, parce que le navigateur ne classe rien — il
affiche et corrige. **Aucun fichier de `src/` ne doit l'importer**, l'extension `.ts` explicite y
casserait le build ; le test le refuse. L'ingestion n'écrit que `phase_proposee`,
`type_echange_propose`, `importance_proposee`, `confiance_categorisation` et
`raisons_categorisation` : la colonne humaine et `categorise_par` restent hors de toute écriture
machine.

**Le classement du §5.2 n'a qu'un afficheur : `AxesMessage` (`ui.tsx`).** Il rend les trois axes
effectifs en français (les libellés viennent de `categorisation.ts`, la couleur de l'importance de
`graviteDe` — l'échelle 1-3 des alertes a un seul propriétaire) et il rend TOUJOURS avec eux le
« Voir pourquoi ce classement ». Un axe vide ne s'affiche pas : le lexique préfère se taire, et
trois badges « — » répétés sur une file seraient du bruit ; ce qui manque se lit dans les raisons.
Tant que `categorise_par` est nul, la confiance de la machine s'affiche ; dès qu'un humain a signé,
c'est son nom qui s'affiche et la confiance disparaît — elle ne veut plus rien dire. **Tout écran
qui lit `Communication.propose.raisonsCategorisation` doit monter ce composant** ;
`scripts/test-classement-echanges.cjs` le vérifie fichier par fichier, rend le composant en HTML et
refuse une seconde définition. La correction, elle, passe par `corrigerAxes` (`communications.ts`)
et écrit les **trois** axes à la fois — `ChoixAxes` (`Documents.tsx`) est aujourd'hui le seul écran
qui l'appelle.

`categorisation.ts` : référentiel FERMÉ des trois axes de classement des échanges (CDC §5.2) —
`PhaseEchange` (superset **séparé** de `PhaseCode`, qui ne bouge pas : il porte la chaîne
d'honoraires) avec `PHASES_ECHANGE` / `LIBELLES_PHASE_ECHANGE` / `estPhaseDeMission`,
`TypeEchange` (15) avec `TYPES_ECHANGE` / `LIBELLES_TYPE_ECHANGE`, `NiveauImportance` (6) avec
`NIVEAUX_IMPORTANCE` / `LIBELLES_IMPORTANCE`, et `graviteDe(niveau): 1|2|3` — projection sur
l'échelle de `Alerte.gravite`. `normaliserPhaseEchange` / `normaliserTypeEchange` /
`normaliserImportance` (tolérantes en entrée, `null` en sortie si rien n'est certain),
`importanceDepuisUrgence`, `reprendreAxes(source)`. **Une valeur d'axe ne se déclare qu'ici** :
recopiée ailleurs (écran, CHECK SQL, Edge Function) elle divergerait sans bruit.
`scripts/test-categorisation.cjs` le vérifie.

`horsLigne.ts` : le hors-ligne des entités **sorties du document JSONB** (plan §3.3) —
cache IndexedDB borné à `FENETRE_CACHE_JOURS` (90 j) et file d'écritures idempotentes.
Règles pures et testables : `dansLaFenetre`, `elaguer`, `nouvelleEcriture`, `fusionnerFile`,
`rejouer(file, cible, executeurDe)`. Persistance et réarmement : `lireCache` / `ecrireCache` /
`patcherCache` / `viderCache`, `enfiler`, `rejouerFile`, `enregistrerExecuteur`,
`reprendreEcriture` / `oublierEcriture`, `useFileEcritures()`. **Ce module ne connaît aucune
table** : chaque table déclare son exécuteur. `propositions` (A.9) et `pointages` (B.4) s'y
branchent — un second cache écrit pour la deuxième table serait un doublon, et le test le refuse.

**Deux règles y sont opposables, pas seulement écrites.** Une lecture sans session rend `null`
— « on ne sait pas » — et jamais `[]`, qui s'affiche « aucun message » : c'est déjà la
distinction que tient `useNbEntrantsDistants`. Et une écriture en file porte des **valeurs
absolues** avec l'horodatage **du geste humain**, figé à l'enfilement : c'est ce qui rend le
rejeu idempotent (§24) sans rien demander au schéma. Une file préparée pour un projet Supabase
ne se rejoue jamais sur un autre. `scripts/test-hors-ligne.cjs` le vérifie.

`communications.ts` : la couche d'accès à `public.communications` (index des messages, A.2),
sur le modèle de `veille.ts` — `listerCommunications(options): PageCommunications | null`
(paginée **par curseur**, jamais par décalage : le cron ingère toutes les 10 minutes),
`useCommunications(filtre, taille)`, `correspondAuFiltre`, et les trois écritures signées
`marquerTraite`, `corrigerRattachement`, `corrigerAxes`. Elle lit les colonnes **générées**
(`projet_id`, `phase_effective`, `type_echange_effectif`, `importance_effective`) et jamais un
`coalesce` refait sur place. `corrigerAxes` prend **la ligne entière** : `categorise_par`
commande les trois axes à la fois, et signer en n'écrivant qu'une colonne humaine viderait les
deux autres. Aucune signature vide n'est acceptée — sans signataire, la colonne générée ne
bascule pas et la correction serait perdue en paraissant faite. Les **sélecteurs métier**
(`mailsATraiter`, `mailsEnAttenteDeReponse`, `echangesParPhase`) sont le livrable A.12 et ne
vivent pas ici. `Communication.resume` / `resumeLe` sont en **lecture seule** côté
navigateur — le GRANT au niveau colonne et le trigger de la migration A.2 le garantissent :
le résumé s'écrit uniquement par l'Edge Function `resume-messages`, et il s'affiche
uniquement par `ResumeMessage`.

`rattachement.ts` : LE rattachement d'un message, d'une pièce ou d'une ligne importée à un
projet (CDC §5.1, plan §3.7) — `rattacherDepuisEtat(state, indices)`, `reperesDe(state)`,
et les règles apprises (`reglesRattachement`, `regleProposee`, `enregistrerRegle`,
`basculerRegle`, `supprimerRegle`, `libelleRegle`), plus la file « à rattacher »
(`courriersARattacher`, `projetsCorrigibles`, `libelleProposition`).

**La cascade elle-même n'est pas dans `src/`** : elle vit dans
`supabase/functions/_shared/rattachement.ts`, **sans le moindre import**, parce qu'elle doit
tourner à l'identique dans le navigateur, dans le Deno de l'ingestion et dans le Node du test —
Deno exige l'extension `.ts` à l'import, TypeScript en `moduleResolution: bundler` la refuse,
donc un module qui importe quoi que ce soit n'est pas partageable. `src/rattachement.ts` en est
le versant navigateur : il traduit `AppState` en repères, rien de plus.

C'était le défaut nommé au §3.7 : **trois moteurs répondaient trois choses différentes** à
« de quel projet parle ce message ? » selon la porte d'entrée — `classer()` serveur,
`devinerProjet()` navigateur, `rapprocherProjet()` import, plus la recherche de projet de
`classerFichier()`. Aucun ne se trompait visiblement. Les quatre passent désormais par la
cascade. **N'en écrivez pas un cinquième** : `scripts/test-rattachement.cjs` refuse toute
recherche de projet écrite ailleurs.

Deux règles y sont opposables. **La cascade refuse de deviner** : deux projets à égalité
rendent `null` et nomment les candidats — un rattachement faux se propage à tout un fil et ne
se voit jamais, un rattachement absent coûte un clic. Et **une correction mémorisée propose,
elle ne signe pas** : les règles vivent dans `settings.reglesRattachement`, donc dans le
document partagé que l'ingestion serveur lit déjà, et elles n'alimentent que
`projet_id_propose`. La colonne humaine et `rattache_par` restent hors de toute écriture
machine (§3.14, §15). La file « à rattacher » est l'onglet du même nom de `Documents.tsx` ;
elle écrit par `corrigerRattachement` (`communications.ts`), donc signée, datée et rejouable
hors ligne.

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
label?, kind?, small?})`, `LienGmail({source, bouton?, muet?})`,
`ResumeMessage({resume, le?})`,
`AxesMessage({phase?, typeEchange?, importance?, confiance?, raisons?, signePar?})`,
`Field({label, hint?})`, `TextInput`, `TextArea({mono?})`,
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
- **Validations attendues** (CDC §8.1) : un groupe du centre d'actions qui agrège les quatre
  familles en attente d'une signature — factures fournisseurs `a_valider`, documents du registre
  `recu`/`a_classer`/`a_valider`, situations `a_verifier`, pièces arrivées dans la boîte
  partagée. Une ligne par famille : compte, détail traçable, lien. La source est
  `derive.validationsAttendues(state, today, actionsATraiter(…), nbEntrants)` — les factures
  fournisseurs **ne sont pas refiltrées** ici, elles arrivent par `financeActions`.
- **Repères du jour** (rail latéral) : réunions du jour (`reunionsDuJour` — `ReunionChantier`
  du jour + agenda Google **borné à la journée**, avec un repli explicite quand la session
  Google est fermée : seul le navigateur porte la portée calendrier, le jeton serveur ne
  l'a pas) ; prochaines échéances sur 14 jours (`prochainesEcheances`, qui remplace et
  contient les anciennes listes « prochaines factures à émettre » et « prochaines
  obligations ») ; phases en cours (`phasesEnCours`). Liens vers les modules.
  **[corrigé]** La rédaction précédente décrivait trois listes calculées sur place dans
  `Cockpit.tsx` ; elles refaisaient, moins bien, l'inventaire de `evenements()`.
- **Ma semaine** : `Table` du temps enregistré et de la charge prévisionnelle de la semaine,
  via `derive.semaineParPersonne` (qui met en regard `tempsParPersonne`,
  `chargePlanifieeSemaine` et `capacitePersonneSemaine`). Aucun seuil de couleur inventé :
  la charge dépasse la capacité, ou elle ne la dépasse pas.
- **Filtre par personne** : un `segmente` dans l'en-tête de page qui gouverne toute la page.
  Il part de `useMoi()` et **retombe sur « Tout » quand l'identité est inconnue** ; un choix
  explicite de l'utilisateur l'emporte ensuite.
- **Les factures à émettre n'ont qu'un seul constructeur** : `financeActions.actionsATraiter`.
  Le Cockpit sélectionne `kind === 'emettre_facture'` dans cette liste et en réaffiche le
  titre, le détail, le lien, la date et la gravité — il ne les réécrit pas. La version
  précédente les construisait des deux côtés, avec deux gravités identiques par coïncidence
  entretenue à la main. `scripts/test-accueil.cjs` le vérifie, comme il vérifie qu'aucune
  balise `<table>` brute n'est réintroduite dans les écrans de l'accueil.
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
    confirm car écrase) — il **ne touche pas** `baselineHeures`, et le confirm le dit.
    Bouton « Figer / Redéfinir la référence » à côté : c'est le seul chemin d'écriture
    manuel de la prévision figée. Colonne « H. référence » (`heuresBaseline`) et écart de
    la répartition courante à la référence.
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
