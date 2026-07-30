# Cockpit L&L

Cockpit L&L est l’intranet de pilotage d’une agence d’architecture : projets,
contrats et honoraires, facturation, trésorerie, temps, chantier, DCE,
documents, CRM, références et veille des appels d’offres.

L’application est **local-first**, mais elle n’est plus « 100 % locale » :

- l’interface React fonctionne dans le navigateur et conserve un état local ;
- Supabase peut authentifier l’équipe, synchroniser l’espace de travail et
  exécuter les ingestions/collectes en arrière-plan ;
- les fonctions Vercel exposent le relais de veille et, si elle est configurée,
  l’intégration Anthropic de l’assistant.

Les sorties automatiques restent des brouillons à relire. Les décisions
financières, contractuelles et les envois externes nécessitent une validation
humaine.

## Démarrage

Prérequis : une version LTS de Node.js compatible (`20.19+`, `22.13+` ou
`24+`) et npm.

```bash
npm ci
npm run dev
```

Vite sert l’interface sur <http://localhost:5173>. Pour vérifier une version de
production :

```bash
npm run build
npm run preview
```

Au premier lancement, des données marquées **EXEMPLE** permettent de parcourir
les modules. Elles doivent être remplacées avant tout usage réel.

### Commandes de qualité

```bash
npm run typecheck   # contrôle TypeScript
npm run lint        # contrôles statiques des fonctions et scripts Node
npm run build       # typecheck puis bundle Vite
npm run test        # API, Edge Functions, sync, invariants facture et recette finance Chromium
```

Le test navigateur a besoin du binaire Chromium une fois par machine :

```bash
npx playwright install chromium
npm run build
npm test
```

La CI GitHub exécute `npm ci`, le lint, le build, les tests Node puis la
recette navigateur sur chaque pull request et chaque push sur `main`.

## Architecture

| Zone | Rôle |
|---|---|
| `src/` | SPA React 18 + TypeScript + Vite et règles métier |
| `api/` | fonctions serverless Vercel (`assistant`, relais HTTP de veille) |
| `supabase/` | schéma, RLS, stockage, temps réel et Edge Functions |
| `scraper-worker/` | worker Playwright optionnel pour les seules pages de veille nécessitant JavaScript |
| `public/corpus/` | corpus réglementaire livré avec l’application |
| `scripts/` | collecte de corpus et recette navigateur finance |

Les calculs métier sont réalisés dans des modules TypeScript dédiés. Les
imports Excel utilisent la distribution officielle SheetJS 0.20.3, verrouillée
dans `package-lock.json`.

## Configuration

Copiez `.env.example` vers `.env.local` pour un environnement local compatible
avec `vercel dev`. Ne commitez jamais `.env.local`.

### Assistant Vercel / Anthropic

Configurez dans Vercel :

- `ANTHROPIC_API_KEY` : secret serveur obligatoire pour activer l’assistant ;
- `ASSISTANT_MODELE` : modèle standard, facultatif ;
- `ASSISTANT_MODELE_DIFFICILE` : modèle d’escalade, facultatif ;
- `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` : vérification de la session
  Supabase ; `SUPABASE_ANON_KEY` reste accepté comme fallback pour les anciens
  projets ;
- `AGENCE_EMAILS` : liste des adresses autorisées, séparées par des virgules ;
- `APP_ORIGIN` : origine exacte autorisée du Cockpit, sans barre finale
  (HTTPS en production ; plusieurs origines peuvent être séparées par des
  virgules).

La clé Anthropic ne doit jamais porter le préfixe `VITE_`, sans quoi Vite
l’intégrerait au code envoyé au navigateur. `npm run dev` ne lance que Vite ;
utilisez `vercel dev` si vous devez aussi tester localement les routes `api/`.
L’assistant refuse l’accès si la session ne peut pas être vérifiée ou si
`AGENCE_EMAILS` est absent : ne contournez pas ce comportement en production.

### Supabase

La synchronisation est facultative. Dans **Paramètres → Synchronisation**,
renseignez la Project URL, la clé `anon`/`publishable`, le même identifiant
d’espace sur chaque poste, puis connectez-vous par lien magique. Cette clé
publique peut être utilisée dans le navigateur ; la protection réelle repose
sur l’authentification et les politiques RLS.

Les Edge Functions utilisent `SUPABASE_URL` et
`SUPABASE_SERVICE_ROLE_KEY`. La plateforme les injecte côté serveur lors du
déploiement. La clé `service_role` contourne les RLS : ne la placez jamais dans
l’interface, une variable `VITE_*`, un journal, une capture d’écran ou le
dépôt. Le worker optionnel reçoit ces deux variables dans son propre
environnement.

Le guide d’installation actuellement disponible se trouve dans
[`supabase/README.md`](supabase/README.md). Avant un déploiement neuf, vérifiez
que le schéma, les tables, les buckets privés, les politiques RLS, les grants,
les fonctions et les tâches planifiées nécessaires sont tous versionnés et
appliqués.

## Données, confidentialité et sauvegardes

Sans Supabase, l’état principal vit dans le `localStorage` du profil navigateur
(clé `cockpit-ll-v1`). Ce stockage peut être effacé, corrompu ou atteindre son
quota : **ce n’est pas une sauvegarde**. Exportez régulièrement le JSON depuis
**Paramètres → Données**, conservez plusieurs versions datées sur un support
protégé et testez périodiquement une restauration.

Quand la synchronisation Supabase est activée, l’état partagé est envoyé comme
un document d’espace de travail. La synchronisation améliore la disponibilité,
mais ne remplace ni l’historique de sauvegardes ni une stratégie de reprise.
Les écritures utilisent une révision compare-and-swap : une modification
concurrente n’écrase pas silencieusement l’autre poste et reste signalée jusqu’à
réconciliation. Ce contrôle de conflit ne remplace pas une sauvegarde datée.

Les documents de corpus marqués **privés** restent sur le navigateur : ils sont
exclus de la synchronisation et des sélecteurs de l’assistant. En revanche, les
autres textes, modèles, comptes-rendus ou contextes **sélectionnés comme source
de l’assistant** sont transmis à la fonction Vercel puis au fournisseur IA pour
produire la réponse. N’envoyez que les données nécessaires, vérifiez les droits
et le consentement applicables, et excluez par défaut les documents clients,
personnels, contractuels ou confidentiels.

Mesures minimales d’exploitation :

- dépôt GitHub privé si le code ou sa configuration révèle l’organisation de
  l’agence ;
- secrets uniquement dans les gestionnaires Vercel/Supabase ;
- comptes nominatifs, MFA et liste d’accès RLS tenue à jour ;
- export avant migration, import massif ou opération sensible ;
- relecture humaine de tout document, conseil ou montant généré.

## Déploiement

Le front et `api/` sont prévus pour Vercel. Le build de production est
`npm run build` et le répertoire publié est `dist/`. Ajoutez les variables de
l’assistant dans chaque environnement Vercel concerné, puis contrôlez les
limites de dépense et les journaux de la fonction.

Supabase doit être déployé séparément : base, Auth, RLS, Storage, Realtime,
Edge Functions et planification. Les identifiants OAuth Gmail sont saisis dans
le Cockpit et stockés côté serveur ; ils ne doivent pas rejoindre l’état
partagé ni les fichiers d’environnement du front.

Le worker Playwright de veille est optionnel et ne doit être activé que si les
mesures montrent des pages réellement impossibles à traiter en HTTP simple.
Voir [`scraper-worker/README.md`](scraper-worker/README.md).

## Dépendances et mises à jour

Utilisez `npm ci` en CI et pour reproduire exactement le verrou
`package-lock.json`. SheetJS est installé depuis son CDN officiel parce que la
version npm publique `xlsx@0.18.5` est ancienne ; ne remplacez pas cette URL
par cette version du registre npm.

Avant une mise à jour de dépendances :

1. examinez le diff de `package-lock.json` ;
2. lancez lint, build et recette navigateur ;
3. vérifiez les imports Excel et PDF avec des fichiers non sensibles ;
4. contrôlez les avis de sécurité et les notes de version des éditeurs.
