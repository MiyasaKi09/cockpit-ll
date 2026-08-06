// ============================================================
// chorus-sync — cycle de vie des factures publiques, LU sur Chorus Pro
// via la passerelle PISTE. Piloté depuis Finance → Ventes.
//
// CE QU'ELLE FAIT
// ----------------
//   · `statut`       : la configuration est-elle posée ? lesquels des quatre
//                      secrets manquent (PAR LEUR NOM), sur quel
//                      environnement, et qu'a dit la dernière synchronisation ;
//   · `synchroniser` : jeton OAuth2, recherche des factures ÉMISES sur une
//                      fenêtre, puis — pour les seules factures dont le statut
//                      n'est pas nominal — l'historique, afin d'en tirer LE
//                      MOTIF DE REJET. Renvoie les factures TELLES QUELLES ;
//   · `confirmer`    : le Cockpit dit ce qui est réellement entré (rattaché /
//                      signalé), et ça s'inscrit au journal.
//
// CE QU'ELLE NE FAIT PAS, ET C'EST MÉCANIQUE
// -------------------------------------------
// Elle n'écrit RIEN sur Chorus Pro. `chorus.ts` porte une liste FERMÉE de
// quatre chemins de lecture et `appelChorus` refuse tout le reste avant le
// moindre octet réseau — `soumettreFacture`, `deposerFluxFacture` et
// `traiterFactureRecue` sont nommés dans `CHEMINS_INTERDITS` pour qu'on sache
// qu'ils ont été vus et écartés. Elle ne ré-émet aucune facture, ne modifie
// aucun montant, n'envoie rien : elle rapatrie un statut (§15).
//
// Elle n'écrit non plus AUCUN événement de cycle de vie en base. Les factures
// repartent dans la réponse ; c'est le Cockpit qui les rattache PAR NUMÉRO,
// exactement comme l'import CSV le fait déjà (`src/chorusApi.ts`). Une table
// serveur d'événements serait une seconde vérité du cycle de vie, et le lot D2
// a montré ce que coûte la même notion codée deux fois.
//
// LES IDENTIFIANTS NE SORTENT JAMAIS D'ICI
// -----------------------------------------
// `CHORUS_CLIENT_ID`, `CHORUS_CLIENT_SECRET`, `CHORUS_TECHNIQUE_LOGIN` et
// `CHORUS_TECHNIQUE_MOTDEPASSE` sont lus par `Deno.env.get` et ne quittent pas
// la fonction : ni dans une réponse, ni dans un journal, ni dans l'état de
// l'application. Le compte technique HÉRITE des droits du gestionnaire
// principal sur toutes ses structures : c'est un secret à fort privilège, et
// il n'est mis en cache nulle part. Aucun jeton n'est stocké — voir
// `demanderJetonPiste`.
//
// INERTE TANT QUE LES SECRETS MANQUENT — et le dire PRÉCISÉMENT
// --------------------------------------------------------------
// Le raccordement demande un compte PISTE, une application, un espace
// « Raccordement EDI / API » et un compte technique : l'agence ne les a pas
// forcément le jour où ce code arrive. `statut` répond alors `configure:
// false` et NOMME les secrets absents, sans jamais échouer. Une carte qui dit
// « non configuré » et nomme le geste vaut mieux qu'un bouton qui échoue.
//
// verify_jwt : la valeur par défaut de la plateforme (true) convient. La
// fonction revérifie de toute façon le jeton ET le registre des membres —
// deux verrous plutôt qu'un, comme `ingestion-config` et `banque-sync`.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2.110.0'
import { estMembreActif } from '../_shared/membres.ts'
import {
  CHEMINS_LECTURE,
  ENVIRONNEMENTS,
  appelChorus,
  borner,
  corpsHistorique,
  corpsRechercheFournisseur,
  demanderJetonPiste,
  enteteCompteTechnique,
  entierOuNull,
  historiqueChorus,
  lireEnvironnement,
  lireReponseChorus,
  listeFacturesChorus,
  meriteUnDetail,
  motifChorus,
  normaliserFactureChorus,
  type FactureChorusBrute,
  type LectureReponseChorus,
  type NomEnvironnement,
} from './chorus.ts'

// Les quatre en-têtes que `supabase-js` joint à CHAQUE appel de fonction.
// En autoriser moins fait échouer le préflet, et l'erreur ressemble à une
// panne réseau : « Failed to send a request to the Edge Function ». C'est un
// défaut réellement vécu ici (scripts/test-cors-edge.cjs).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** fenêtre de dépôt balayée par défaut : un trimestre plus les délais de
 *  paiement publics — au-delà, une facture non payée a déjà parlé */
const FENETRE_DEFAUT_JOURS = 120
const FENETRE_MAX_JOURS = 730

/** bornes de balayage : une agence de deux personnes n'émet pas mille
 *  factures publiques par trimestre, et une boucle non bornée dans une
 *  fonction Edge finit par ne plus rendre la main */
const PAR_PAGE = 100
const PAGES_MAX = 5
/** appels de détail (historique + fiche) par passage : ils ne servent qu'aux
 *  statuts non nominaux, et un rejet sans motif reste affiché comme tel */
const DETAILS_MAX = 20

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

function json(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: {
      ...CORS,
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** e-mail du jeton utilisateur (vérifié par la plateforme, relu ici) */
async function emailAppelant(sb: ReturnType<typeof admin>, req: Request): Promise<string | null> {
  const jeton = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!jeton) return null
  const { data } = await sb.auth.getUser(jeton)
  return data.user?.email?.toLowerCase() ?? null
}

function isoJour(valeur: Date): string {
  return valeur.toISOString().slice(0, 10)
}

// ------------------------------------------------------------------
// Configuration — lue ici, JAMAIS renvoyée
// ------------------------------------------------------------------

interface Configuration {
  clientId: string
  clientSecret: string
  login: string
  motDePasse: string
  environnement: NomEnvironnement
  idUtilisateur: number | null
  idEspace: number | null
}

/** Les quatre secrets indispensables, dans l'ordre où l'agence les obtient :
 *  les deux premiers viennent de l'application PISTE, les deux suivants du
 *  compte technique Chorus Pro. Ce sont ces NOMS que l'écran affiche. */
const SECRETS_REQUIS = [
  'CHORUS_CLIENT_ID',
  'CHORUS_CLIENT_SECRET',
  'CHORUS_TECHNIQUE_LOGIN',
  'CHORUS_TECHNIQUE_MOTDEPASSE',
] as const

function secret(nom: string): string {
  return Deno.env.get(nom)?.trim() || ''
}

function secretsManquants(): string[] {
  return SECRETS_REQUIS.filter((nom) => !secret(nom))
}

function environnementCourant(): NomEnvironnement {
  return lireEnvironnement(Deno.env.get('CHORUS_ENVIRONNEMENT'))
}

/** la configuration complète, ou `null` : on ne fabrique pas d'identifiant
 *  partiel, qui produirait un 401 illisible au lieu d'un message clair */
function configuration(): Configuration | null {
  if (secretsManquants().length > 0) return null
  return {
    clientId: secret('CHORUS_CLIENT_ID'),
    clientSecret: secret('CHORUS_CLIENT_SECRET'),
    login: secret('CHORUS_TECHNIQUE_LOGIN'),
    motDePasse: secret('CHORUS_TECHNIQUE_MOTDEPASSE'),
    environnement: environnementCourant(),
    // Optionnels : leur obtention pour un compte technique n'est documentée
    // nulle part (réserve §3.13 de la note). Absents, ils ne partent pas —
    // les envoyer à 0 serait inventer une valeur, et Chorus dirait « non »
    // sans qu'on sache si c'est le 0 ou le reste qui gêne.
    idUtilisateur: entierOuNull(Deno.env.get('CHORUS_ID_UTILISATEUR')),
    idEspace: entierOuNull(Deno.env.get('CHORUS_ID_ESPACE')),
  }
}

// ------------------------------------------------------------------
// Journal des synchronisations
// ------------------------------------------------------------------
//
// Il n'existe QUE pour répondre à « la dernière synchronisation a-t-elle
// abouti, et qu'a-t-elle dit ? » sans que le navigateur en soit la seule
// mémoire : une réponse d'API perdue (onglet fermé, réseau coupé) ne laisse
// aucune trace côté Cockpit. Il ne porte AUCUN statut de facture — ceux-là
// vivent sur la pièce, dans l'état de l'application.

interface LigneJournal {
  id: string
  lance_le: string
  environnement: string
  ok: boolean | null
  resultat: string | null
  nb_factures: number | null
  nb_rattachees: number | null
  nb_inconnues: number | null
}

async function derniereSynchronisation(sb: ReturnType<typeof admin>): Promise<LigneJournal | null> {
  const { data, error } = await sb
    .from('chorus_synchronisations')
    .select('id,lance_le,environnement,ok,resultat,nb_factures,nb_rattachees,nb_inconnues')
    .order('lance_le', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    // Journal absent (migration non appliquée) : ce n'est pas une raison de
    // refuser de synchroniser. On le dit, et on continue.
    console.error('Journal chorus_synchronisations illisible :', error.message)
    return null
  }
  return (data as LigneJournal | null) ?? null
}

async function ouvrirJournal(
  sb: ReturnType<typeof admin>,
  environnement: string,
  par: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from('chorus_synchronisations')
    .insert({ environnement, lance_par: par })
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('Journal chorus_synchronisations non écrit :', error.message)
    return null
  }
  return (data as { id: string } | null)?.id ?? null
}

async function fermerJournal(
  sb: ReturnType<typeof admin>,
  id: string | null,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!id) return
  const { error } = await sb.from('chorus_synchronisations').update(patch).eq('id', id)
  if (error) console.error('Journal chorus_synchronisations non mis à jour :', error.message)
}

// ------------------------------------------------------------------
// Lecture du portail
// ------------------------------------------------------------------

class ErreurChorus extends Error {
  lecture: LectureReponseChorus
  constructor(lecture: LectureReponseChorus) {
    super(lecture.message)
    this.name = 'ErreurChorus'
    this.lecture = lecture
  }
}

interface Contexte {
  config: Configuration
  base: string
  entetes: Record<string, string>
}

async function ouvrirContexte(config: Configuration): Promise<Contexte> {
  const { jeton, lecture } = await demanderJetonPiste(config.environnement, config.clientId, config.clientSecret)
  if (!jeton) throw new ErreurChorus(lecture)
  return {
    config,
    base: ENVIRONNEMENTS[config.environnement].api,
    // LES DEUX à la fois : le Bearer identifie l'application PISTE,
    // `cpro-account` identifie la structure Chorus Pro. Le second dans
    // `Authorization` écraserait le premier — c'est le contresens classique.
    entetes: {
      Authorization: `Bearer ${jeton}`,
      'cpro-account': enteteCompteTechnique(config.login, config.motDePasse),
    },
  }
}

/** un appel de lecture, traduit en décision. Ne rejoue rien : un jeton est
 *  demandé par passage, il ne peut pas être servi périmé. */
async function lire(
  ctx: Contexte,
  chemin: string,
  corps: Record<string, unknown>,
): Promise<{ corps: unknown; lecture: LectureReponseChorus }> {
  const r = await appelChorus(ctx.base, chemin, corps, ctx.entetes)
  return { corps: r.corps, lecture: lireReponseChorus(r.status, r.corps) }
}

/**
 * Toutes les factures émises sur la fenêtre, page après page.
 *
 * `diagnostic` porte ce qui n'a PAS pu être lu — et c'est le point qui
 * compte : les noms de champs viennent d'un document de 2017. Une réponse
 * HTTP 200 dont aucune facture n'est extractible produirait sinon un écran
 * identique à « aucune facture déposée sur la période ». On nomme donc les
 * clés réellement reçues (les clés seules, jamais les valeurs) : c'est
 * exactement ce qu'il faut pour corriger la lecture en une relecture.
 */
async function rechercherFactures(
  ctx: Contexte,
  debut: string,
  fin: string,
): Promise<{ factures: FactureChorusBrute[]; diagnostic: string | null }> {
  const factures: FactureChorusBrute[] = []
  let diagnostic: string | null = null
  let illisibles = 0
  let clesVues: string[] = []

  for (let page = 1; page <= PAGES_MAX; page++) {
    const { corps, lecture } = await lire(
      ctx,
      CHEMINS_LECTURE.rechercherFournisseur,
      corpsRechercheFournisseur({
        debut,
        fin,
        page,
        parPage: PAR_PAGE,
        idUtilisateur: ctx.config.idUtilisateur,
        idEspace: ctx.config.idEspace,
      }),
    )
    if (lecture.genre !== 'ok') throw new ErreurChorus(lecture)

    const { liste, clesVues: cles } = listeFacturesChorus(corps)
    if (page === 1) clesVues = cles
    for (const brut of liste) {
      const facture = normaliserFactureChorus(brut)
      if (facture) factures.push(facture)
      else illisibles++
    }
    if (liste.length < PAR_PAGE) break
    if (page === PAGES_MAX) {
      diagnostic = `Plus de ${PAGES_MAX * PAR_PAGE} factures sur la fenêtre : réduisez-la, seules les plus récentes ont été lues.`
    }
  }

  if (factures.length === 0 && illisibles === 0 && clesVues.length > 0) {
    diagnostic =
      'Aucune facture lue dans la réponse de Chorus Pro. Champs reçus à la racine : ' +
      `${clesVues.slice(0, 12).join(', ')}. Si des factures existent bien sur la fenêtre, ce sont les NOMS DE ` +
      'CHAMPS qui ont changé depuis le dossier de spécifications de 2017 : ils se corrigent dans ' +
      'supabase/functions/chorus-sync/chorus.ts.'
  } else if (illisibles > 0) {
    diagnostic = `${illisibles} ligne(s) du portail sans numéro ni statut lisibles : elles n'ont été ni rattachées ni signalées.`
  }

  return { factures, diagnostic }
}

/**
 * Le motif de rejet, cherché là où il peut être.
 *
 * La note technique n'a PAS pu confirmer lequel des deux services le
 * restitue, ni sous quel nom exact (réserve §3.9). On interroge donc
 * l'historique — le service qui porte le cycle de vie — puis, s'il ne dit
 * rien, la fiche fournisseur. Si aucun des deux ne rend de motif, le motif
 * reste `null` : l'écran affiche alors « motif à lire sur le portail »,
 * plutôt qu'une phrase fabriquée qui donnerait à croire qu'on sait.
 */
async function completerDetail(ctx: Contexte, facture: FactureChorusBrute): Promise<void> {
  if (!facture.idFacture) return
  const corpsDemande = corpsHistorique({
    idFacture: facture.idFacture,
    idUtilisateur: ctx.config.idUtilisateur,
    idEspace: ctx.config.idEspace,
  })

  const histo = await lire(ctx, CHEMINS_LECTURE.historique, corpsDemande)
  if (histo.lecture.genre === 'ok') {
    facture.historique = historiqueChorus(histo.corps)
    facture.motif = facture.motif || motifChorus(histo.corps)
  }
  if (facture.motif) return

  const fiche = await lire(ctx, CHEMINS_LECTURE.consulterFournisseur, corpsDemande)
  if (fiche.lecture.genre === 'ok') facture.motif = motifChorus(fiche.corps)
}

// ------------------------------------------------------------------
// Point d'entrée
// ------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erreur: 'Méthode non prise en charge.' }, 405)

  const sb = admin()

  // Le registre des membres fait autorité — registre injoignable = accès
  // refusé (jamais l'inverse).
  const email = await emailAppelant(sb, req)
  if (!email || !(await estMembreActif(sb, email))) {
    return json({ erreur: 'Accès réservé à l’agence.' }, 403)
  }

  const corpsRequete = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = typeof corpsRequete.action === 'string' ? corpsRequete.action : 'statut'
  const manquants = secretsManquants()
  const environnement = environnementCourant()

  try {
    // ---------------- statut ----------------
    if (action === 'statut') {
      const derniere = await derniereSynchronisation(sb)
      return json({
        configure: manquants.length === 0,
        // les NOMS des secrets absents, jamais la moindre valeur
        manquants,
        environnement,
        environnementLibelle: ENVIRONNEMENTS[environnement].libelle,
        derniere: derniere
          ? {
              le: derniere.lance_le,
              ok: derniere.ok,
              resultat: derniere.resultat,
              environnement: derniere.environnement,
              nbFactures: derniere.nb_factures,
              nbRattachees: derniere.nb_rattachees,
              nbInconnues: derniere.nb_inconnues,
            }
          : null,
      })
    }

    // `confirmer` reste possible sans identifiants : elle n'appelle personne
    // et sert justement à consigner ce qui a été fait avec ce qui avait été lu.
    if (manquants.length > 0 && action !== 'confirmer') {
      return json(
        {
          erreur:
            'Chorus Pro n’est pas configuré : posez ' +
            `${manquants.join(', ')} dans les secrets de la fonction chorus-sync. ` +
            'L’import CSV du cycle de vie reste le chemin manuel, et il suffit.',
          manquants,
        },
        409,
      )
    }

    // ---------------- synchroniser ----------------
    if (action === 'synchroniser') {
      const config = configuration()
      if (!config) return json({ erreur: 'Chorus Pro n’est pas configuré.', manquants }, 409)

      const fenetre = borner(corpsRequete.jours, 1, FENETRE_MAX_JOURS, FENETRE_DEFAUT_JOURS)
      const maintenant = new Date()
      const fin = isoJour(maintenant)
      const debut = isoJour(new Date(maintenant.getTime() - fenetre * 86_400_000))
      const journalId = await ouvrirJournal(sb, config.environnement, email)

      try {
        const ctx = await ouvrirContexte(config)
        const { factures, diagnostic } = await rechercherFactures(ctx, debut, fin)

        // Le détail ne se demande QUE pour les statuts non nominaux : c'est
        // là qu'un motif existe, et chaque appel compte. Un code inconnu de
        // la liste est détaillé lui aussi — mieux vaut un appel de trop
        // qu'un rejet sans motif.
        let details = 0
        for (const facture of factures) {
          if (details >= DETAILS_MAX) break
          if (!meriteUnDetail(facture.statutPortail)) continue
          details++
          await completerDetail(ctx, facture)
        }

        const resume =
          `${factures.length} facture(s) lue(s) sur ${debut} → ${fin}` +
          (details > 0 ? `, ${details} détaillée(s)` : '')
        await fermerJournal(sb, journalId, {
          ok: true,
          resultat: diagnostic ? `${resume}. ${diagnostic}` : resume,
          nb_factures: factures.length,
          termine_le: new Date().toISOString(),
        })

        return json({
          environnement: config.environnement,
          environnementLibelle: ENVIRONNEMENTS[config.environnement].libelle,
          fenetre: { debut, fin },
          factures,
          diagnostic,
          journalId,
        })
      } catch (e) {
        const message =
          e instanceof ErreurChorus ? e.lecture.message : 'Chorus Pro momentanément indisponible.'
        await fermerJournal(sb, journalId, {
          ok: false,
          resultat: message,
          termine_le: new Date().toISOString(),
        })
        throw e
      }
    }

    // ---------------- confirmer l'intégration ----------------
    // Le Cockpit dit ce qui est RÉELLEMENT entré : combien d'événements ont
    // trouvé leur facture, et combien de factures du portail restent sans
    // correspondance. Sans cela, « dernière synchronisation » voudrait dire
    // « Chorus a répondu », ce qui n'est pas la même chose.
    if (action === 'confirmer') {
      const id = typeof corpsRequete.journalId === 'string' ? corpsRequete.journalId : ''
      if (!id) return json({ erreur: 'Synchronisation inconnue.' }, 400)
      await fermerJournal(sb, id, {
        resultat: typeof corpsRequete.resultat === 'string' ? corpsRequete.resultat.slice(0, 300) : null,
        nb_rattachees: typeof corpsRequete.rattachees === 'number' ? corpsRequete.rattachees : null,
        nb_inconnues: typeof corpsRequete.inconnues === 'number' ? corpsRequete.inconnues : null,
        integre_le: new Date().toISOString(),
      })
      return json({ ok: true })
    }

    return json({ erreur: `Action inconnue : ${action}.` }, 400)
  } catch (e) {
    if (e instanceof ErreurChorus) {
      console.error('Chorus Pro :', e.lecture.genre, e.lecture.status, e.lecture.codeRetour)
      return json({ erreur: e.lecture.message, genre: e.lecture.genre }, 502)
    }
    // Le détail part au journal, jamais à l'écran : il peut contenir une
    // adresse d'API ou un fragment de réponse.
    console.error('chorus-sync :', e)
    return json({ erreur: 'Synchronisation Chorus Pro momentanément indisponible.' }, 500)
  }
})
