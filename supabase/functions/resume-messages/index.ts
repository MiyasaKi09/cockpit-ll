// ============================================================
// resume-messages — le résumé automatique du §5.3 (livrable A.6).
//
// Toutes les quinze minutes, cette fonction prend les quelques
// messages RATTACHÉS À UN PROJET qui n'ont pas encore de résumé,
// en demande trois phrases au modèle, et écrit le résultat dans
// `communications.resume`. Rien d'autre.
//
// POURQUOI UNE FONCTION DÉDIÉE PLUTÔT QU'`api/assistant.js` (§3.8)
// ----------------------------------------------------------------
// `api/assistant.js` n'est PAS appelable par un planificateur : il
// exige le jeton d'une session Supabase appartenant à la liste des
// comptes autorisés. Cette vérification est exactement ce qui
// protège aujourd'hui la clé Anthropic — l'ouvrir à un appel
// machine reviendrait à retirer la seule serrure de la porte.
// D'où une fonction séparée, avec :
//   * SON PROPRE SECRET DE PLANIFICATION (`resume_cron_secret`) —
//     distinct de `cron_secret`, que quatre tâches se partagent.
//     C'est la seule fonction du dépôt qui DÉPENSE DE L'ARGENT à
//     chaque passage : un secret compromis ailleurs ne doit pas
//     ouvrir le robinet ici ;
//   * SA PROPRE CLÉ ANTHROPIC (`RESUME_ANTHROPIC_API_KEY`, secret
//     Supabase). Elle n'est jamais celle de Vercel : révoquer l'une
//     n'éteint pas l'autre, et la facture se lit par usage. La
//     fonction REFUSE de se rabattre sur une clé générique — un
//     repli silencieux ferait dépendre le budget d'une variable
//     que personne n'a choisie pour ça ;
//   * SA PROPRE LIMITATION DE DÉBIT, à trois bornes (passage,
//     heure, jour) — voir `quotaDuPassage` dans `resume.ts`.
//
// SEULS LES MESSAGES RATTACHÉS SONT RÉSUMÉS
// -----------------------------------------
// C'est le périmètre exact du plan (§3.8 : « tout indexer en
// métadonnées, ne résumer que les messages rattachés à un projet »)
// et c'est ce qui divise le coût par deux. Le filtre porte sur la
// colonne GÉNÉRÉE `projet_id` — le choix humain dès qu'il y en a eu
// un, la proposition sinon —, jamais sur un `coalesce` refait ici :
// la règle « proposé / validé » a un seul propriétaire, la base.
//
// CE QUE CETTE FONCTION N'ÉCRIT PAS
// ---------------------------------
// `resume`, `resume_le` et `resume_tente_le`, rien d'autre. Pas le corps, pas l'objet,
// pas un axe, pas un rattachement : le §5.3 dit que « le résumé ne
// remplace jamais le message original », et la seule façon d'en
// être sûr est de ne jamais toucher au message. Aucune tâche, aucune
// échéance, aucune décision, aucun risque n'est détecté ici : c'est
// A.9 (la table `propositions`) et A.10 (les détecteurs), et rien
// n'a le droit d'écrire une détection avant que sa table existe.
//
// ORDRE DE DÉPLOIEMENT : la migration
// `20260731170000_resume_messages_brouillon` s'applique AVANT ce
// code (elle crée `resume_cron_secret` et la tâche planifiée). Sans
// clé Anthropic configurée, la fonction ne dépense rien, l'annonce
// dans `ingestion_config.resume_dernier_resultat`, et le reste du
// Cockpit fonctionne — le résumé est un confort, pas un socle.
// ============================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2.110.0'
import { jetonDeMembreActif } from '../_shared/membres.ts'
import {
  CONSIGNE_RESUME,
  MODELE_PAR_DEFAUT,
  demandeDeResume,
  estResumable,
  nettoyerResume,
  quotaDuPassage,
  type MessageAResumer,
} from './resume.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** appels facturés autorisés par passage — borne les APPELS, pas les succès */
const MESSAGES_PAR_PASSAGE = 8
/** heure glissante et 24 h glissantes : les deux bornes du budget (§3.8) */
const PLAFOND_HORAIRE = 40
const PLAFOND_JOURNALIER = 200
/** au-delà, un message n'est plus lu par personne : le résumer coûte sans servir */
const FENETRE_JOURS = 30
const JOUR_MS = 86_400_000
/** un modèle lent ne doit pas retenir le passage entier */
const DELAI_ANTHROPIC_MS = 45_000
/** budget de temps d'une Edge Function : on s'arrête avant d'être arrêté */
const BUDGET_PASSAGE_MS = 110_000
/** de quoi tenir trois phrases ET la réflexion adaptative du modèle */
const MAX_TOKENS = 2000
/** deux échecs d'affilée = la panne n'est pas dans le message : on s'arrête */
const ECHECS_TOLERES = 2

function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

function json(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** la ligne lue — strictement ce dont le résumé a besoin */
interface LigneAResumer {
  id: string
  objet: string | null
  expediteur: string | null
  corps_extrait: string | null
  envoye_le: string | null
}

function messageDepuisLigne(l: LigneAResumer): MessageAResumer {
  return {
    objet: l.objet || '',
    expediteur: l.expediteur || '',
    envoyeLe: l.envoye_le,
    corps: l.corps_extrait || '',
  }
}

/** Un appel, un résumé — ou une erreur explicite.
 *
 *  La réflexion adaptative reste ACTIVE, à effort `low` : la désactiver sur
 *  cette famille de modèles fait parfois fuir la réflexion dans le texte
 *  visible, ce qui est précisément ce qu'un résumé montré à l'écran ne doit
 *  pas contenir. `nettoyerResume` reste la ceinture, l'effort bas est la
 *  bretelle — et c'est aussi le réglage le moins cher. */
async function resumer(cle: string, modele: string, m: MessageAResumer): Promise<string | null> {
  const controleur = new AbortController()
  const expiration = setTimeout(() => controleur.abort(), DELAI_ANTHROPIC_MS)
  let reponse: Response
  try {
    reponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cle,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modele,
        max_tokens: MAX_TOKENS,
        output_config: { effort: 'low' },
        // Pas de `cache_control` : le préfixe système est très en dessous du
        // minimum cachable, et le déclarer laisserait croire à une économie
        // qui n'a pas lieu.
        system: [{ type: 'text', text: CONSIGNE_RESUME }],
        messages: [{ role: 'user', content: [{ type: 'text', text: demandeDeResume(m) }] }],
      }),
      signal: controleur.signal,
    })
  } finally {
    clearTimeout(expiration)
  }

  if (reponse.status === 429) throw new Error('debit')
  if (!reponse.ok) {
    // le corps d'erreur peut contenir la requête : on ne journalise que le code
    throw new Error(`api-${reponse.status}`)
  }
  const corps = (await reponse.json().catch(() => null)) as
    | { content?: { type?: string; text?: string }[]; stop_reason?: string }
    | null
  if (!corps || !Array.isArray(corps.content)) throw new Error('reponse-invalide')
  // Un refus de sécurité n'est pas une panne : le message n'est simplement pas
  // résumé, et il ne sera pas re-tenté indéfiniment puisque le suivant passera
  // devant lui à chaque fenêtre.
  if (corps.stop_reason === 'refusal') return null
  const texte = corps.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('\n')
  return nettoyerResume(texte)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erreur: 'Méthode non prise en charge.' }, 405)

  const sb = admin()
  const { data: cfg, error: erreurConfig } = await sb
    .from('ingestion_config')
    .select('resume_cron_secret')
    .eq('id', 'google')
    .maybeSingle()
  if (erreurConfig) return json({ erreur: `Configuration illisible : ${erreurConfig.message}` }, 500)
  if (!cfg) return json({ erreur: 'Configuration absente.' }, 500)

  // --- accès : le secret PROPRE à cette tâche, ou une personne de l'agence ---
  const secretRecu = req.headers.get('x-cron-secret')
  let autorise = Boolean(
    secretRecu && cfg.resume_cron_secret && secretRecu === cfg.resume_cron_secret,
  )
  if (!autorise) {
    const jeton = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    autorise = await jetonDeMembreActif(sb, jeton)
  }
  if (!autorise) return json({ erreur: 'Accès refusé.' }, 401)

  /** le résultat lisible du passage, à côté de celui de l'ingestion et jamais
   *  à sa place : deux tâches qui écrivent la même colonne s'effacent l'une
   *  l'autre, et on croit l'une en panne quand c'est l'autre qui a parlé */
  const noter = (resultat: string) =>
    sb
      .from('ingestion_config')
      .update({
        resume_dernier_scan: new Date().toISOString(),
        resume_dernier_resultat: resultat,
        maj_le: new Date().toISOString(),
      })
      .eq('id', 'google')

  const cle = Deno.env.get('RESUME_ANTHROPIC_API_KEY')
  if (!cle) {
    await noter(
      'En attente : le résumé automatique n’a pas de clé (secret Supabase RESUME_ANTHROPIC_API_KEY).',
    )
    return json({ statut: 'non-configure' })
  }
  const modele = Deno.env.get('RESUME_MODELE') || MODELE_PAR_DEFAUT

  // --- limitation de débit : ce que les dernières 24 h ont déjà coûté ---
  const debut = Date.now()
  const { data: recents, error: erreurRecents } = await sb
    .from('communications')
    .select('resume_le')
    .gte('resume_le', new Date(debut - JOUR_MS).toISOString())
    .order('resume_le', { ascending: false })
    .limit(PLAFOND_JOURNALIER + 1)
  if (erreurRecents) return json({ erreur: `Débit illisible : ${erreurRecents.message}` }, 500)

  const quota = quotaDuPassage(
    (recents || []).map((r) => r.resume_le as string | null),
    debut,
    { parPassage: MESSAGES_PAR_PASSAGE, horaire: PLAFOND_HORAIRE, journalier: PLAFOND_JOURNALIER },
  )
  if (quota <= 0) {
    await noter(
      `Plafond atteint (${PLAFOND_HORAIRE}/heure, ${PLAFOND_JOURNALIER}/jour) : aucun résumé ce passage.`,
    )
    return json({ statut: 'plafond', resumes: 0 })
  }

  // --- les candidats : RATTACHÉS, pas encore résumés, encore lus ---
  //
  // On en demande plus que le quota parce que certains seront écartés sans
  // appel (corps vide, accusé de réception) : sans cette marge, un message
  // vide en tête de file consommerait la place d'un message utile.
  const { data: lignes, error: erreurLignes } = await sb
    .from('communications')
    .select('id,objet,expediteur,corps_extrait,envoye_le')
    .not('projet_id', 'is', null)
    .is('resume', null)
    .is('resume_tente_le', null)
    .gte('envoye_le', new Date(debut - FENETRE_JOURS * JOUR_MS).toISOString())
    .order('envoye_le', { ascending: false })
    .limit(Math.min(50, quota * 3))
  if (erreurLignes) return json({ erreur: `Messages illisibles : ${erreurLignes.message}` }, 500)

  const candidats = ((lignes || []) as LigneAResumer[]).filter((l) =>
    estResumable(messageDepuisLigne(l)),
  )

  let appels = 0
  let resumes = 0
  let vides = 0
  let echecs = 0
  let interrompu = ''
  for (const ligne of candidats) {
    // Le quota borne les APPELS, pas les succès : un message auquel le modèle
    // ne trouve rien à dire a coûté autant qu'un autre. Compter les seuls
    // résumés produits laisserait un passage dépenser trois fois son budget
    // un jour de réponses automatiques.
    if (appels >= quota) break
    if (Date.now() - debut > BUDGET_PASSAGE_MS) {
      interrompu = 'budget de temps'
      break
    }
    let texte: string | null
    appels++
    try {
      texte = await resumer(cle, modele, messageDepuisLigne(ligne))
    } catch (e) {
      const motif = e instanceof Error ? e.message : String(e)
      // Un refus de débit du fournisseur arrête le passage : insister
      // multiplierait les appels facturés sans produire un seul résumé.
      if (motif === 'debit') {
        interrompu = 'débit du fournisseur'
        break
      }
      console.error('Résumé en échec', { motif })
      if (++echecs >= ECHECS_TOLERES) {
        interrompu = 'échecs répétés'
        break
      }
      continue
    }
    echecs = 0
    if (!texte) {
      // Le modèle a répondu, et il n'y avait rien à résumer (accusé de
      // réception, réponse automatique, refus de sécurité). On le MARQUE :
      // sans cette écriture, ce message récent resterait en tête de file et
      // serait redemandé — et refacturé — toutes les quinze minutes. Les
      // pannes, elles, ne marquent rien : elles doivent être re-tentées.
      vides++
      await sb
        .from('communications')
        .update({ resume_tente_le: new Date().toISOString() })
        .eq('id', ligne.id)
      continue
    }
    // Le résumé lui-même. Deux colonnes, jamais le message : c'est ce qui rend
    // vraie la phrase du §5.3 même le jour où le modèle déraille.
    const { error } = await sb
      .from('communications')
      .update({ resume: texte, resume_le: new Date().toISOString() })
      .eq('id', ligne.id)
    if (error) {
      console.error('Écriture du résumé refusée', { motif: error.message })
      if (++echecs >= ECHECS_TOLERES) {
        interrompu = 'écritures refusées'
        break
      }
      continue
    }
    resumes++
  }

  const details = [
    `${candidats.length} message(s) rattaché(s) en attente`,
    vides ? `${vides} sans matière à résumer` : '',
    echecs ? `${echecs} échec(s)` : '',
    interrompu ? `passage écourté (${interrompu})` : '',
  ].filter(Boolean)

  await noter(
    resumes > 0
      ? `${resumes} résumé(s) brouillon produit(s) — ${details.join(', ')}.`
      : `Aucun résumé produit — ${details.join(', ') || 'rien à résumer'}.`,
  )
  return json({
    statut: interrompu ? 'ecourte' : 'ok',
    resumes,
    appels,
    candidats: candidats.length,
    vides,
    echecs,
    quota,
    modele,
  })
})
