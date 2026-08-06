// ============================================================
// banque-sync — connexion bancaire en LECTURE SEULE via GoCardless
// Bank Account Data (ex-Nordigen), pilotée depuis Banque & trésorerie.
//
// CE QU'ELLE FAIT
// ----------------
//   · `banques`      : la liste des établissements d'un pays ;
//   · `connecter`    : crée l'accord + la demande, et rend L'ADRESSE vers
//                      laquelle la personne part s'authentifier chez sa banque ;
//   · `finaliser`    : au retour, relit la demande et enregistre les comptes ;
//   · `synchroniser` : rapatrie les OPÉRATIONS et LE SOLDE ;
//   · `confirmer`    : note qu'une synchronisation est bien entrée au Cockpit ;
//   · `statut`       : l'état des connexions, SANS aucun secret ;
//   · `deconnecter`  : supprime la demande chez GoCardless et ici.
//
// CE QU'ELLE NE FAIT PAS
// -----------------------
// Elle n'écrit AUCUN mouvement en base. Les opérations repartent dans la
// réponse ; c'est le Cockpit qui les fait entrer par `preparerImport`
// (src/banque.ts), déjà idempotent sur date + montant + libellé. Une table de
// mouvements côté serveur serait une seconde vérité bancaire, et le lot D2 a
// montré ce que coûte la même notion codée deux fois.
//
// LES IDENTIFIANTS NE SORTENT JAMAIS D'ICI
// -----------------------------------------
// `GOCARDLESS_SECRET_ID` / `GOCARDLESS_SECRET_KEY` sont lus par
// `Deno.env.get` et ne quittent pas la fonction : ni dans une réponse, ni
// dans un journal, ni dans l'état de l'application. Les jetons dérivés
// (access 24 h, refresh 30 j) vivent dans `banque_gocardless_jeton`, table
// fermée au navigateur (RLS sans policy, `service_role` seul).
//
// AUCUNE ADRESSE PUBLIQUE — la différence avec `gmail-oauth`
// -----------------------------------------------------------
// `gmail-oauth` doit être publique parce que Google renvoie un `?code=` qu'il
// faut échanger : la valeur secrète transite par le navigateur. Ici, rien de
// tel : GoCardless renvoie simplement la personne dans l'application, et
// TOUT le reste (statut de la demande, comptes, opérations) se relit
// côté serveur par l'identifiant de la demande. L'adresse de retour est donc
// le Cockpit lui-même, et cette fonction reste derrière une session agence
// vérifiée. Il n'y a pas de point d'entrée non authentifié à surveiller.
//
// verify_jwt : la valeur par défaut de la plateforme (true) convient. La
// fonction revérifie de toute façon le jeton ET le registre des membres —
// deux verrous plutôt qu'un, comme `ingestion-config`.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2.110.0'
import { estMembreActif } from '../_shared/membres.ts'
import {
  ACCES_DEFAUT_JOURS,
  ACCES_MAX_JOURS,
  CHEMINS,
  DUREE_ACCES_DEFAUT,
  DUREE_RAFRAICHISSEMENT_DEFAUT,
  HISTORIQUE_MAX_JOURS,
  STATUT_COMPTE_PRET,
  STATUT_DEMANDE_LIEE,
  appelGoCardless,
  borner,
  expirationConsentement,
  lireReponseGoCardless,
  masquerIban,
  operationsComptabilisees,
  soldesLisibles,
  statutCompteExigeReconnexion,
  statutDemandeExigeReconnexion,
  type LectureReponse,
} from './gocardless.ts'

// Les quatre en-têtes que `supabase-js` joint à CHAQUE appel de fonction.
// En autoriser moins fait échouer le préflet, et l'erreur ressemble à une
// panne réseau : « Failed to send a request to the Edge Function ». C'est un
// défaut réellement vécu ici (scripts/test-cors-edge.cjs).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** fenêtre d'historique rapatriée à chaque synchronisation */
const FENETRE_DEFAUT_JOURS = 90

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
// Jeton d'API — cache serveur, rafraîchi puis renouvelé
// ------------------------------------------------------------------

interface LigneJeton {
  acces: string | null
  acces_expire_le: string | null
  rafraichissement: string | null
  rafraichissement_expire_le: string | null
}

class ErreurGoCardless extends Error {
  lecture: LectureReponse
  constructor(lecture: LectureReponse) {
    super(lecture.message)
    this.name = 'ErreurGoCardless'
    this.lecture = lecture
  }
}

/** identifiants d'API — lus ici, jamais renvoyés */
function identifiants(): { secretId: string; secretKey: string } | null {
  const secretId = Deno.env.get('GOCARDLESS_SECRET_ID')?.trim() || ''
  const secretKey = Deno.env.get('GOCARDLESS_SECRET_KEY')?.trim() || ''
  if (!secretId || !secretKey) return null
  return { secretId, secretKey }
}

async function jetonNeuf(sb: ReturnType<typeof admin>, maintenant: number): Promise<string> {
  const cles = identifiants()
  if (!cles) throw new ErreurGoCardless({ genre: 'autre', message: 'Identifiants GoCardless absents des secrets de la fonction.', type: null, status: 0 })
  const r = await appelGoCardless(CHEMINS.jetonNouveau, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ secret_id: cles.secretId, secret_key: cles.secretKey }),
  })
  const lecture = lireReponseGoCardless(r.status, r.corps)
  if (lecture.genre !== 'ok') {
    // Un 401 ici ne parle pas d'un jeton périmé mais des identifiants
    // eux-mêmes : le dire autrement enverrait chercher au mauvais endroit.
    throw new ErreurGoCardless({
      ...lecture,
      genre: 'autre',
      message:
        lecture.status === 401
          ? 'GoCardless refuse les identifiants d’API (secret_id / secret_key). Vérifiez les secrets de la fonction.'
          : lecture.message,
    })
  }
  const corps = r.corps as Record<string, unknown>
  const acces = typeof corps.access === 'string' ? corps.access : ''
  if (!acces) throw new ErreurGoCardless({ genre: 'autre', message: 'GoCardless n’a pas fourni de jeton d’accès.', type: null, status: r.status })
  const dureeAcces = typeof corps.access_expires === 'number' ? corps.access_expires : DUREE_ACCES_DEFAUT
  const dureeRefresh =
    typeof corps.refresh_expires === 'number' ? corps.refresh_expires : DUREE_RAFRAICHISSEMENT_DEFAUT
  await sb
    .from('banque_gocardless_jeton')
    .upsert({
      id: 'gocardless',
      acces,
      acces_expire_le: new Date(maintenant + dureeAcces * 1000).toISOString(),
      rafraichissement: typeof corps.refresh === 'string' ? corps.refresh : null,
      rafraichissement_expire_le: new Date(maintenant + dureeRefresh * 1000).toISOString(),
      maj_le: new Date(maintenant).toISOString(),
    })
  return acces
}

/**
 * Un jeton d'accès valide.
 *
 * Trois étages, dans cet ordre : le cache, le rafraîchissement, la création.
 * Le troisième n'est pas décoratif — le jeton de rafraîchissement meurt à
 * 30 jours et GoCardless n'en renvoie PAS de nouveau lors d'un
 * rafraîchissement. Une fonction qui ne saurait que rafraîchir tomberait au
 * 30e jour, silencieusement.
 */
async function jetonValide(sb: ReturnType<typeof admin>, forcer = false): Promise<string> {
  const maintenant = Date.now()
  const { data } = await sb
    .from('banque_gocardless_jeton')
    .select('acces,acces_expire_le,rafraichissement,rafraichissement_expire_le')
    .eq('id', 'gocardless')
    .maybeSingle()
  const ligne = (data || null) as LigneJeton | null

  if (!forcer && ligne?.acces && ligne.acces_expire_le) {
    const fin = Date.parse(ligne.acces_expire_le)
    // 60 secondes de marge : un jeton qui expire pendant l'appel produit un
    // 401 qu'on prendrait pour autre chose.
    if (Number.isFinite(fin) && fin - 60_000 > maintenant) return ligne.acces
  }

  if (ligne?.rafraichissement && ligne.rafraichissement_expire_le) {
    const finRefresh = Date.parse(ligne.rafraichissement_expire_le)
    if (Number.isFinite(finRefresh) && finRefresh > maintenant) {
      // ⚠ `/api/v2/token/refresh/` — le Quickstart officiel publie
      // `/v2/token/refresh/` (sans `/api/`), qui rend un 404.
      const r = await appelGoCardless(CHEMINS.jetonRafraichi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refresh: ligne.rafraichissement }),
      })
      const lecture = lireReponseGoCardless(r.status, r.corps)
      const corps = r.corps as Record<string, unknown>
      if (lecture.genre === 'ok' && typeof corps.access === 'string' && corps.access) {
        const duree = typeof corps.access_expires === 'number' ? corps.access_expires : DUREE_ACCES_DEFAUT
        await sb
          .from('banque_gocardless_jeton')
          .update({
            acces: corps.access,
            acces_expire_le: new Date(maintenant + duree * 1000).toISOString(),
            maj_le: new Date(maintenant).toISOString(),
          })
          .eq('id', 'gocardless')
        return corps.access
      }
      // Le rafraîchissement a échoué : on retombe sur la création plutôt que
      // de rendre une erreur — c'est le cas du 30e jour.
    }
  }

  return await jetonNeuf(sb, maintenant)
}

/**
 * Appel authentifié, avec UN seul rejeu.
 *
 * Le rejeu n'a lieu que sur `jeton_invalide` — jamais sur `reconnexion` :
 * c'est précisément la confusion qui fige une trésorerie en silence, un
 * relais bouclant indéfiniment sur un consentement expiré.
 */
async function appelAuthentifie(
  sb: ReturnType<typeof admin>,
  chemin: string,
  init: RequestInit = {},
): Promise<{ corps: unknown; lecture: LectureReponse; quotaRestant: string | null }> {
  let jeton = await jetonValide(sb)
  for (let essai = 0; essai < 2; essai++) {
    const r = await appelGoCardless(chemin, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${jeton}`,
        Accept: 'application/json',
      },
    })
    const lecture = lireReponseGoCardless(r.status, r.corps)
    if (lecture.genre === 'jeton_invalide' && essai === 0) {
      jeton = await jetonValide(sb, true)
      continue
    }
    return { corps: r.corps, lecture, quotaRestant: r.quotaRestant }
  }
  throw new ErreurGoCardless({ genre: 'autre', message: 'Jeton d’API refusé deux fois de suite.', type: null, status: 401 })
}

// ------------------------------------------------------------------
// Statut renvoyé au Cockpit — sans jeton, sans identifiant GoCardless
// ------------------------------------------------------------------

interface LigneConnexion {
  id: string
  institution_id: string
  institution_nom: string | null
  requisition_id: string | null
  accord_id: string | null
  reference: string
  statut: string
  statut_gocardless: string | null
  acces_jours: number | null
  consentement_accepte_le: string | null
  consentement_expire_le: string | null
  derniere_sync_le: string | null
  derniere_sync_ok: boolean | null
  derniere_sync_resultat: string | null
}

interface LigneCompte {
  id: string
  connexion_id: string
  compte_id: string
  libelle: string | null
  iban_masque: string | null
  devise: string | null
  statut: string | null
  dernier_solde: number | null
  dernier_solde_type: string | null
  dernier_solde_date: string | null
  types_solde_vus: unknown
}

/**
 * L'état des connexions tel que le Cockpit a le droit de le voir.
 *
 * `compte_id` (l'identifiant GoCardless) ne sort JAMAIS : le navigateur
 * désigne un compte par l'identifiant de NOTRE ligne. Un écran n'a besoin
 * que de reconnaître le compte, pas de pouvoir l'appeler.
 */
async function statutConnexions(sb: ReturnType<typeof admin>) {
  const { data: connexions, error } = await sb
    .from('banque_connexions')
    .select(
      'id,institution_id,institution_nom,requisition_id,accord_id,reference,statut,statut_gocardless,acces_jours,consentement_accepte_le,consentement_expire_le,derniere_sync_le,derniere_sync_ok,derniere_sync_resultat',
    )
    .order('cree_le', { ascending: true })
  if (error) throw new Error(error.message)
  const lignes = (connexions || []) as LigneConnexion[]
  const { data: comptes } = await sb
    .from('banque_comptes')
    .select(
      'id,connexion_id,compte_id,libelle,iban_masque,devise,statut,dernier_solde,dernier_solde_type,dernier_solde_date,types_solde_vus',
    )
  const parConnexion = new Map<string, LigneCompte[]>()
  for (const c of (comptes || []) as LigneCompte[]) {
    const liste = parConnexion.get(c.connexion_id) || []
    liste.push(c)
    parConnexion.set(c.connexion_id, liste)
  }
  return lignes.map((c) => ({
    id: c.id,
    banque: c.institution_nom || c.institution_id,
    statut: c.statut,
    statutGocardless: c.statut_gocardless,
    accesJours: c.acces_jours,
    consentementAccepteLe: c.consentement_accepte_le,
    consentementExpireLe: c.consentement_expire_le,
    derniereLectureLe: c.derniere_sync_le,
    derniereLectureOk: c.derniere_sync_ok,
    derniereLectureResultat: c.derniere_sync_resultat,
    comptes: (parConnexion.get(c.id) || []).map((x) => ({
      id: x.id,
      libelle: x.libelle,
      ibanMasque: x.iban_masque,
      devise: x.devise,
      statut: x.statut,
      dernierSolde: x.dernier_solde,
      dernierSoldeType: x.dernier_solde_type,
      dernierSoldeDate: x.dernier_solde_date,
      typesSoldeVus: Array.isArray(x.types_solde_vus) ? (x.types_solde_vus as string[]) : [],
    })),
  }))
}

async function marquerConnexion(
  sb: ReturnType<typeof admin>,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await sb
    .from('banque_connexions')
    .update({ ...patch, maj_le: new Date().toISOString() })
    .eq('id', id)
}

// ------------------------------------------------------------------
// Relecture d'une demande : les comptes, le consentement, les statuts
// ------------------------------------------------------------------

/**
 * Relit une demande chez GoCardless et met la ligne à jour.
 *
 * C'est ici que se posent DEUX des trois signaux de reconnexion : le statut
 * de la demande (`EX`) et le statut de chaque compte (`EXPIRED`). Le
 * troisième — le 401 `AccessExpiredError` — se pose à la synchronisation.
 * On surveille les trois : celui qui manque est celui qui ne préviendra pas.
 */
async function relireDemande(
  sb: ReturnType<typeof admin>,
  connexion: LigneConnexion,
  /**
   * Relire la fiche de CHAQUE compte, même déjà connu.
   *
   * Ce n'est pas gratuit : `/accounts/{id}/` consomme le quota « details »,
   * que la banque peut limiter à quatre appels par jour et par compte. On le
   * fait à la finalisation et à la reconnexion — là où l'information est
   * neuve — et pas à chaque synchronisation, où le 401
   * `AccessExpiredError` des soldes et des opérations dit déjà la même chose
   * sans rien dépenser de plus.
   */
  relireTousLesComptes = false,
): Promise<string> {
  if (!connexion.requisition_id) return connexion.statut

  const { corps, lecture } = await appelAuthentifie(sb, CHEMINS.demande(connexion.requisition_id))
  if (lecture.genre === 'reconnexion') {
    await marquerConnexion(sb, connexion.id, { statut: 'expiree', derniere_sync_resultat: lecture.message })
    return 'expiree'
  }
  if (lecture.genre !== 'ok') {
    await marquerConnexion(sb, connexion.id, { derniere_sync_resultat: lecture.message })
    return connexion.statut
  }

  const demande = corps as Record<string, unknown>
  const statutGc = typeof demande.status === 'string' ? demande.status : null
  const comptes = Array.isArray(demande.accounts) ? (demande.accounts as unknown[]) : []

  if (statutDemandeExigeReconnexion(statutGc)) {
    await marquerConnexion(sb, connexion.id, {
      statut: 'expiree',
      statut_gocardless: statutGc,
      derniere_sync_resultat: `La banque a clos l’autorisation (statut ${statutGc}).`,
    })
    return 'expiree'
  }

  // Le consentement : sa date d'acceptation vient de l'accord, jamais d'une
  // supposition. Sans elle, l'expiration reste inconnue — et « inconnue »
  // s'affiche, plutôt que de se remplir d'une date rassurante.
  let accepteLe: string | null = connexion.consentement_accepte_le
  let jours: number | null = connexion.acces_jours
  // Une fois l'accord accepté, sa date ne bouge plus : la relire à chaque
  // synchronisation serait un appel de plus pour la même réponse.
  if (connexion.accord_id && !connexion.consentement_expire_le) {
    const accord = await appelAuthentifie(sb, CHEMINS.accord(connexion.accord_id))
    if (accord.lecture.genre === 'ok') {
      const a = accord.corps as Record<string, unknown>
      if (typeof a.accepted === 'string' && a.accepted) accepteLe = a.accepted
      if (typeof a.access_valid_for_days === 'number') jours = a.access_valid_for_days
    }
  }
  const expireLe = expirationConsentement(accepteLe, jours) || connexion.consentement_expire_le

  const statut = statutGc === STATUT_DEMANDE_LIEE && comptes.length > 0 ? 'liee' : connexion.statut

  await marquerConnexion(sb, connexion.id, {
    statut,
    statut_gocardless: statutGc,
    consentement_accepte_le: accepteLe,
    acces_jours: jours,
    consentement_expire_le: expireLe,
  })

  // Les comptes : un par ligne, avec l'identifiant GoCardless qui reste ici.
  const { data: dejaConnus } = await sb
    .from('banque_comptes')
    .select('compte_id,statut,libelle,iban_masque,devise')
    .eq('connexion_id', connexion.id)
  interface CompteConnu {
    compte_id: string
    statut: string | null
    libelle: string | null
    iban_masque: string | null
    devise: string | null
  }
  const connus = new Map(((dejaConnus || []) as CompteConnu[]).map((x) => [x.compte_id, x] as const))

  for (const brut of comptes) {
    const compteId = typeof brut === 'string' ? brut : ''
    if (!compteId) continue
    const ancien = connus.get(compteId)
    if (ancien?.statut === STATUT_COMPTE_PRET && !relireTousLesComptes) continue

    // Une fiche illisible ne doit rien EFFACER de ce qu'on savait : repartir
    // de zéro ferait passer un compte prêt pour « en préparation », et la
    // synchronisation le sauterait sans rien dire.
    let libelle: string | null = ancien?.libelle ?? null
    let iban: string | null = ancien?.iban_masque ?? null
    let devise: string | null = ancien?.devise ?? null
    let statutCompte: string | null = ancien?.statut ?? null
    const meta = await appelAuthentifie(sb, CHEMINS.compte(compteId))
    if (meta.lecture.genre === 'ok') {
      const m = meta.corps as Record<string, unknown>
      statutCompte = typeof m.status === 'string' ? m.status : null
      devise = typeof m.currency === 'string' ? m.currency : devise
      iban = masquerIban(m.iban) ?? iban
      libelle =
        (typeof m.name === 'string' && m.name) ||
        (typeof m.owner_name === 'string' && m.owner_name) ||
        libelle
    } else if (meta.lecture.genre === 'reconnexion') {
      // Le compte lui-même annonce l'expiration : c'est le troisième signal.
      statutCompte = 'EXPIRED'
    }
    await sb
      .from('banque_comptes')
      .upsert(
        {
          connexion_id: connexion.id,
          compte_id: compteId,
          libelle,
          iban_masque: iban,
          devise,
          statut: statutCompte,
          maj_le: new Date().toISOString(),
        },
        { onConflict: 'connexion_id,compte_id' },
      )
  }
  return statut
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
  const configure = identifiants() !== null

  try {
    // ---------------- statut ----------------
    if (action === 'statut') {
      return json({ configure, connexions: await statutConnexions(sb) })
    }

    // `deconnecter` et `confirmer` restent possibles sans identifiants : la
    // première doit pouvoir nettoyer une connexion même après une rotation de
    // secrets ratée, la seconde n'appelle personne. Enfermer le ménage
    // derrière la panne serait le pire moment pour le rendre impossible.
    if (!configure && action !== 'deconnecter' && action !== 'confirmer') {
      return json(
        {
          erreur:
            'Identifiants GoCardless absents : posez GOCARDLESS_SECRET_ID et GOCARDLESS_SECRET_KEY dans les secrets de la fonction.',
        },
        409,
      )
    }

    // ---------------- liste des banques ----------------
    if (action === 'banques') {
      const paysBrut = typeof corpsRequete.pays === 'string' ? corpsRequete.pays.toUpperCase() : 'FR'
      const pays = /^[A-Z]{2}$/.test(paysBrut) ? paysBrut : 'FR'
      const { corps, lecture } = await appelAuthentifie(sb, `${CHEMINS.institutions}?country=${pays}`)
      if (lecture.genre !== 'ok') return json({ erreur: lecture.message, genre: lecture.genre }, 502)
      const liste = Array.isArray(corps) ? corps : []
      return json({
        banques: liste
          .map((b) => {
            const x = (b || {}) as Record<string, unknown>
            return {
              id: typeof x.id === 'string' ? x.id : '',
              nom: typeof x.name === 'string' ? x.name : '',
              logo: typeof x.logo === 'string' ? x.logo : null,
            }
          })
          .filter((b) => b.id && b.nom)
          .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
      })
    }

    // ---------------- démarrer une connexion ----------------
    if (action === 'connecter' || action === 'reconnecter') {
      // « Reconnecter » n'est PAS une action différente : la DSP2 n'offre
      // aucune prolongation utilisable pour des banques françaises (le
      // `reconfirm` de la spec est réservé aux banques britanniques). Se
      // reconnecter, c'est refaire le parcours. La seule différence est
      // qu'on GARDE la même ligne : son identifiant est celui que porte
      // l'alerte, le lien du fil d'urgences et le miroir local — le faire
      // changer perdrait le fil au moment précis où il sert.
      const reconnexion = action === 'reconnecter'
      let institutionId = typeof corpsRequete.institutionId === 'string' ? corpsRequete.institutionId.trim() : ''
      let institutionNom = typeof corpsRequete.institutionNom === 'string' ? corpsRequete.institutionNom.trim() : ''
      const connexionId = typeof corpsRequete.connexionId === 'string' ? corpsRequete.connexionId : ''

      if (reconnexion) {
        if (!connexionId) return json({ erreur: 'Connexion inconnue.' }, 400)
        const { data } = await sb
          .from('banque_connexions')
          .select('id,institution_id,institution_nom,acces_jours,historique_jours')
          .eq('id', connexionId)
          .maybeSingle()
        const ancienne = data as
          | { institution_id: string; institution_nom: string | null; acces_jours: number | null; historique_jours: number | null }
          | null
        if (!ancienne) return json({ erreur: 'Connexion inconnue.' }, 404)
        institutionId = ancienne.institution_id
        institutionNom = ancienne.institution_nom || ancienne.institution_id
      }
      if (!institutionId) return json({ erreur: 'Aucune banque choisie.' }, 400)

      const retour = (Deno.env.get('BANQUE_REDIRECT_URL') || '').trim()
      if (!retour || !retour.startsWith('https://')) {
        return json(
          { erreur: 'BANQUE_REDIRECT_URL manque dans les secrets de la fonction (adresse HTTPS du Cockpit).' },
          409,
        )
      }

      const accesJours = borner(corpsRequete.jours, 1, ACCES_MAX_JOURS, ACCES_DEFAUT_JOURS)
      const historiqueJours = borner(corpsRequete.historiqueJours, 1, HISTORIQUE_MAX_JOURS, FENETRE_DEFAUT_JOURS)
      const reference = crypto.randomUUID()

      // 1) l'accord : c'est lui qui porte la durée d'accès, donc la date
      //    d'expiration qu'on annoncera à J-7.
      const accord = await appelAuthentifie(sb, CHEMINS.accords, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          institution_id: institutionId,
          max_historical_days: historiqueJours,
          access_valid_for_days: accesJours,
          access_scope: ['balances', 'details', 'transactions'],
        }),
      })
      if (accord.lecture.genre !== 'ok') {
        return json({ erreur: accord.lecture.message, genre: accord.lecture.genre }, 502)
      }
      const accordCorps = accord.corps as Record<string, unknown>
      const accordId = typeof accordCorps.id === 'string' ? accordCorps.id : null

      // 2) la demande : elle rend le LIEN vers lequel la personne part.
      const demande = await appelAuthentifie(sb, CHEMINS.demandes, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect: retour,
          institution_id: institutionId,
          agreement: accordId,
          reference,
          user_language: 'FR',
          account_selection: false,
          redirect_immediate: false,
        }),
      })
      if (demande.lecture.genre !== 'ok') {
        return json({ erreur: demande.lecture.message, genre: demande.lecture.genre }, 502)
      }
      const demandeCorps = demande.corps as Record<string, unknown>
      const lien = typeof demandeCorps.link === 'string' ? demandeCorps.link : ''
      const requisitionId = typeof demandeCorps.id === 'string' ? demandeCorps.id : ''
      if (!lien || !requisitionId) {
        return json({ erreur: 'GoCardless n’a pas fourni d’adresse d’autorisation.' }, 502)
      }

      const champs = {
        institution_id: institutionId,
        institution_nom: institutionNom || institutionId,
        reference,
        accord_id: accordId,
        requisition_id: requisitionId,
        statut: 'en_attente',
        statut_gocardless: typeof demandeCorps.status === 'string' ? demandeCorps.status : null,
        acces_jours: accesJours,
        historique_jours: historiqueJours,
        // Le consentement précédent ne vaut plus rien : garder sa date
        // d'expiration ferait taire l'alerte avant que la nouvelle
        // autorisation ne soit acceptée.
        consentement_accepte_le: null,
        consentement_expire_le: null,
      }

      if (reconnexion) {
        await marquerConnexion(sb, connexionId, { ...champs, derniere_sync_resultat: 'Reconnexion en cours.' })
        // Les anciens comptes partent avec l'ancienne autorisation : leurs
        // identifiants GoCardless ne sont plus valides.
        await sb.from('banque_comptes').delete().eq('connexion_id', connexionId)
        return json({ connexionId, lien, connexions: await statutConnexions(sb) })
      }

      const { data: creee, error } = await sb
        .from('banque_connexions')
        .insert({ ...champs, cree_par: email })
        .select('id')
        .maybeSingle()
      if (error || !creee) {
        return json(
          { erreur: 'Connexion non enregistrée : appliquez la migration banque_gocardless_connexions.' },
          409,
        )
      }

      return json({ connexionId: (creee as { id: string }).id, lien, connexions: await statutConnexions(sb) })
    }

    // ---------------- finaliser (retour de la banque) ----------------
    if (action === 'finaliser') {
      const cible = typeof corpsRequete.connexionId === 'string' ? corpsRequete.connexionId : ''
      let requete = sb
        .from('banque_connexions')
        .select(
          'id,institution_id,institution_nom,requisition_id,accord_id,reference,statut,statut_gocardless,acces_jours,consentement_accepte_le,consentement_expire_le,derniere_sync_le,derniere_sync_ok,derniere_sync_resultat',
        )
      requete = cible ? requete.eq('id', cible) : requete.in('statut', ['en_attente', 'erreur'])
      const { data } = await requete
      for (const c of (data || []) as LigneConnexion[]) {
        // Retour de la banque : c'est LE moment où les fiches de compte sont
        // neuves — on les lit toutes.
        await relireDemande(sb, c, true)
      }
      return json({ connexions: await statutConnexions(sb) })
    }

    // ---------------- synchroniser ----------------
    if (action === 'synchroniser') {
      const cible = typeof corpsRequete.connexionId === 'string' ? corpsRequete.connexionId : ''
      const fenetre = borner(corpsRequete.jours, 1, HISTORIQUE_MAX_JOURS, FENETRE_DEFAUT_JOURS)
      let requete = sb
        .from('banque_connexions')
        .select(
          'id,institution_id,institution_nom,requisition_id,accord_id,reference,statut,statut_gocardless,acces_jours,consentement_accepte_le,consentement_expire_le,derniere_sync_le,derniere_sync_ok,derniere_sync_resultat',
        )
      requete = cible ? requete.eq('id', cible) : requete.eq('statut', 'liee')
      const { data } = await requete
      const connexions = (data || []) as LigneConnexion[]
      if (connexions.length === 0) {
        return json({ erreur: 'Aucune connexion bancaire à synchroniser.', connexions: await statutConnexions(sb) }, 409)
      }

      const maintenant = new Date()
      const dateFin = isoJour(maintenant)
      const dateDebut = isoJour(new Date(maintenant.getTime() - fenetre * 86_400_000))
      const resultats: Record<string, unknown>[] = []

      for (const connexion of connexions) {
        // On relit la demande AVANT de lire les comptes : le statut `EX` et
        // le statut de compte `EXPIRED` annoncent la reconnexion sans qu'on
        // ait à provoquer une erreur pour l'apprendre.
        const statut = await relireDemande(sb, connexion)
        if (statut !== 'liee') {
          resultats.push({
            connexionId: connexion.id,
            banque: connexion.institution_nom || connexion.institution_id,
            genre: statut === 'expiree' ? 'reconnexion' : 'autre',
            message:
              statut === 'expiree'
                ? 'Autorisation expirée ou révoquée : reconnectez ce compte.'
                : 'Connexion pas encore établie : terminez le parcours chez votre banque.',
            comptes: [],
          })
          continue
        }

        const { data: comptesData } = await sb
          .from('banque_comptes')
          .select('id,connexion_id,compte_id,libelle,iban_masque,devise,statut,dernier_solde,dernier_solde_type,dernier_solde_date,types_solde_vus')
          .eq('connexion_id', connexion.id)
        const comptes = (comptesData || []) as LigneCompte[]
        const sortieComptes: Record<string, unknown>[] = []
        let reconnexion = false
        let lu = 0

        for (const compte of comptes) {
          if (statutCompteExigeReconnexion(compte.statut)) {
            reconnexion = true
            sortieComptes.push({
              id: compte.id,
              libelle: compte.libelle,
              ibanMasque: compte.iban_masque,
              genre: 'reconnexion',
              message: `Ce compte n’est plus accessible (statut ${compte.statut}) : reconnectez-le.`,
              soldes: [],
              operations: [],
            })
            continue
          }
          if (compte.statut && compte.statut !== STATUT_COMPTE_PRET) {
            sortieComptes.push({
              id: compte.id,
              libelle: compte.libelle,
              ibanMasque: compte.iban_masque,
              genre: 'patienter',
              message: `GoCardless prépare encore ce compte (statut ${compte.statut}).`,
              soldes: [],
              operations: [],
            })
            continue
          }

          // Le solde et les opérations sont DEUX points d'entrée distincts,
          // et deux quotas distincts.
          const soldes = await appelAuthentifie(sb, CHEMINS.soldes(compte.compte_id))
          const ops = await appelAuthentifie(
            sb,
            `${CHEMINS.operations(compte.compte_id)}?date_from=${dateDebut}&date_to=${dateFin}`,
          )
          const pire =
            soldes.lecture.genre !== 'ok' ? soldes.lecture : ops.lecture.genre !== 'ok' ? ops.lecture : null
          if (pire?.genre === 'reconnexion' || pire?.genre === 'portee') reconnexion = true

          const listeSoldes = soldes.lecture.genre === 'ok' ? soldesLisibles(soldes.corps) : []
          const operations = ops.lecture.genre === 'ok' ? operationsComptabilisees(ops.corps) : []
          if (ops.lecture.genre === 'ok') lu++

          // On JOURNALISE les `balanceType` réellement publiés par cette
          // banque. Ils ne se devinent pas : chaque établissement choisit ce
          // qu'il expose parmi une quinzaine de valeurs, et c'est de ce
          // relevé que dépend le choix affiché au Cockpit.
          const typesVus = Array.from(
            new Set([
              ...(Array.isArray(compte.types_solde_vus) ? (compte.types_solde_vus as string[]) : []),
              ...listeSoldes.map((s) => s.type),
            ]),
          )
          await sb
            .from('banque_comptes')
            .update({
              types_solde_vus: typesVus,
              derniere_sync_le: maintenant.toISOString(),
              maj_le: maintenant.toISOString(),
            })
            .eq('id', compte.id)

          sortieComptes.push({
            id: compte.id,
            libelle: compte.libelle,
            ibanMasque: compte.iban_masque,
            devise: compte.devise,
            genre: pire ? pire.genre : 'ok',
            message: pire ? pire.message : '',
            quotaRestant: ops.quotaRestant,
            typesSoldeVus: typesVus,
            soldes: listeSoldes,
            operations,
            fenetre: { debut: dateDebut, fin: dateFin },
          })
        }

        await marquerConnexion(sb, connexion.id, {
          statut: reconnexion ? 'expiree' : 'liee',
          derniere_sync_le: lu > 0 ? maintenant.toISOString() : connexion.derniere_sync_le,
          derniere_sync_ok: lu > 0 && !reconnexion,
          derniere_sync_resultat: reconnexion
            ? 'Autorisation expirée : reconnexion nécessaire.'
            : `${lu} compte(s) lus le ${dateFin}.`,
        })

        resultats.push({
          connexionId: connexion.id,
          banque: connexion.institution_nom || connexion.institution_id,
          genre: reconnexion ? 'reconnexion' : 'ok',
          message: reconnexion ? 'Autorisation expirée : reconnectez ce compte.' : '',
          comptes: sortieComptes,
        })
      }

      return json({ resultats, connexions: await statutConnexions(sb) })
    }

    // ---------------- confirmer l'intégration ----------------
    // Le Cockpit dit ce qui est RÉELLEMENT entré. « Dernière synchronisation
    // réussie » ne doit pas vouloir dire « la banque a répondu » : un relevé
    // lu mais jamais intégré laisserait la trésorerie figée en affichant une
    // date rassurante.
    if (action === 'confirmer') {
      const id = typeof corpsRequete.connexionId === 'string' ? corpsRequete.connexionId : ''
      const resume = typeof corpsRequete.resultat === 'string' ? corpsRequete.resultat.slice(0, 300) : ''
      if (!id) return json({ erreur: 'Connexion inconnue.' }, 400)
      await marquerConnexion(sb, id, {
        derniere_sync_le: new Date().toISOString(),
        derniere_sync_ok: true,
        derniere_sync_resultat: resume || 'Mouvements intégrés au Cockpit.',
      })
      // Le solde RETENU vient du Cockpit : c'est lui qui applique la cascade
      // de types (`closingBooked` d'abord…) et qui l'explique à l'écran. On
      // le range ici pour que l'autre poste le voie sans avoir synchronisé —
      // et `.eq('connexion_id', id)` interdit d'écrire sur le compte d'une
      // autre connexion.
      const comptesConfirmes = Array.isArray(corpsRequete.comptes) ? corpsRequete.comptes : []
      for (const brut of comptesConfirmes) {
        const c = (brut || {}) as Record<string, unknown>
        const compteId = typeof c.id === 'string' ? c.id : ''
        if (!compteId) continue
        await sb
          .from('banque_comptes')
          .update({
            dernier_solde: typeof c.solde === 'number' ? c.solde : null,
            dernier_solde_type: typeof c.type === 'string' ? c.type : null,
            dernier_solde_date: typeof c.date === 'string' ? c.date : null,
            maj_le: new Date().toISOString(),
          })
          .eq('id', compteId)
          .eq('connexion_id', id)
      }
      return json({ connexions: await statutConnexions(sb) })
    }

    // ---------------- déconnecter ----------------
    if (action === 'deconnecter') {
      const id = typeof corpsRequete.connexionId === 'string' ? corpsRequete.connexionId : ''
      if (!id) return json({ erreur: 'Connexion inconnue.' }, 400)
      const { data } = await sb
        .from('banque_connexions')
        .select('id,requisition_id')
        .eq('id', id)
        .maybeSingle()
      const ligne = data as { id: string; requisition_id: string | null } | null
      if (configure && ligne?.requisition_id) {
        // Une suppression qui échoue chez GoCardless ne doit pas empêcher de
        // nettoyer ici : la ligne locale n'a plus de raison d'être, et
        // l'autorisation se retire aussi depuis la banque.
        try {
          await appelAuthentifie(sb, CHEMINS.demande(ligne.requisition_id), { method: 'DELETE' })
        } catch (e) {
          console.error('Suppression de la demande GoCardless impossible :', e)
        }
      }
      await sb.from('banque_connexions').delete().eq('id', id)
      return json({ connexions: await statutConnexions(sb) })
    }

    return json({ erreur: `Action inconnue : ${action}.` }, 400)
  } catch (e) {
    if (e instanceof ErreurGoCardless) {
      console.error('GoCardless :', e.lecture.genre, e.lecture.status)
      return json({ erreur: e.lecture.message, genre: e.lecture.genre }, 502)
    }
    // Le détail part au journal, jamais à l'écran : il peut contenir une
    // adresse d'API ou un fragment de réponse.
    console.error('banque-sync :', e)
    return json({ erreur: 'Synchronisation bancaire momentanément indisponible.' }, 500)
  }
})
