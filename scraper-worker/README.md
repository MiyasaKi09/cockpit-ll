# scraper-worker — navigateur serveur de REPLI (Lot 0 ter C)

Petit service Node/Playwright séparé des Edge Functions : il ne traite QUE
les jobs `needs_browser` de la file `veille_jobs` (pages publiques qui
n'exposent leurs données qu'après exécution de JavaScript). Tout le reste
passe par `veille-enrichir` en HTTP simple.

## Quand l'activer (pas encore !)

L'ordre de réalisation de l'audit (§12) est volontaire : **mesurer d'abord**
les pages réellement impossibles à lire en HTTP. Regardez régulièrement :

```sql
select source, error_code, count(*) from veille_jobs
where status = 'needs_browser' group by 1, 2;
```

Tant que ce compte reste marginal, ce worker n'a pas besoin d'exister en
production. Quand des manques réels persistent (ex. fiches MarchésOnline
pilotées en JS), déployez-le sur n'importe quelle petite machine Node 20+.

## Déploiement

```bash
cd scraper-worker
npm install
SUPABASE_URL=https://rxwnbscmmgflvwxafbek.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
npm start
```

La clé service_role ne quitte JAMAIS la machine du worker (variables
d'environnement uniquement — pas de fichier commité, pas de cockpit).

## Garde-fous CÂBLÉS dans le code (audit §6.3 et §14)

- domaines en LISTE BLANCHE — tout le reste est refusé (`blocked`) ;
- quota de pages par domaine et par heure ;
- délai maximal par job, arrêt après erreurs consécutives (circuit ouvert) ;
- attente d'un état métier précis (sélecteur), pas d'un délai arbitraire ;
- session neuve par job, AUCUN cookie conservé ;
- aucune connexion à un compte, aucun CAPTCHA contourné (→ `blocked`),
  aucune page payante, aucune soumission de formulaire, aucun dépôt ;
- User-Agent honnête et identifiable.

Un besoin de compte devient `needs_login` (action humaine dans le Cockpit),
un refus d'accès devient `blocked` — jamais de nouvelle tentative agressive.
