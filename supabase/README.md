# Synchronisation 2 postes — Supabase (offre gratuite)

Optionnelle. Sans elle, le Cockpit reste **local-first** (tout vit dans le navigateur,
localStorage). Une fois branchée, l'état de l'agence est partagé entre Julien et Zoé
**en temps réel** et **sauvegardé** hors du navigateur — sans clé API payante.

## Créer le projet (une fois, ~5 min)

1. **supabase.com → New project** — offre *Free*, région **West EU (Frankfurt)**.
   Notez le mot de passe de la base (pas utilisé côté client, mais gardez-le).
2. **SQL Editor → New query** → collez le contenu de [`schema.sql`](./schema.sql) → **Run**.
   Crée la table `workspace`, les règles d'accès restreintes à vos 2 e-mails, et le temps réel.
3. **Authentication → Providers → Email** : activez-le (lien magique).
   **Authentication → Sign In / Providers** : décochez *« Allow new users to sign up »*
   (vos 2 comptes suffisent ; la règle d'accès verrouille de toute façon les données).
4. **Project Settings → API** : copiez **Project URL** et la clé **anon / publishable**.

## Connecter les 2 postes

Dans l'appli : **Paramètres → Synchronisation 2 postes**
1. Collez **URL** + **clé publique**, gardez le même **identifiant d'espace** sur les 2 postes
   (par défaut `agence-ll`).
2. Saisissez votre **e-mail** → **Envoyer le lien magique** → ouvrez le lien **depuis ce poste**.
3. **Synchroniser maintenant** : le poste récupère l'espace partagé (ou l'initialise s'il est vide).
4. Répétez sur le 2ᵉ poste. Une modification chez l'un apparaît chez l'autre en ~1–2 s.

## Notes

- La clé « anon / publishable » est **publique par conception** : les données sont protégées
  par les règles RLS (accès réservé à `julenglet@gmail.com` et `zoefhebert@gmail.com`).
  Pour ajouter/retirer une personne, éditez la liste dans les 3 policies de `schema.sql` et
  ré-exécutez le script.
- **Conflits** : le document est écrit en entier (dernier écrit gagne). Pour 2 personnes qui
  éditent rarement la même seconde, le temps réel réaligne les postes en ~1–2 s ; le risque de
  perte est négligeable. En cas de doute, « Pousser mes données » force ce poste comme référence.
- **Hors-ligne** : la synchro ne bloque jamais. Déconnecté, le poste travaille en local et
  repoussera au prochain changement une fois reconnecté.
