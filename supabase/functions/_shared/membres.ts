// ============================================================
// Registre des membres — autorisation partagée des Edge Functions.
//
// Les fonctions serveur portaient chacune sa constante `AGENCE`, une
// liste d'adresses recopiée cinq fois. Cinq copies, c'est cinq
// occasions d'en oublier une le jour d'un changement d'adresse — et
// une fonction oubliée ne se plaint pas : elle refuse silencieusement
// la personne autorisée, ou pire, autorise celle qui ne l'est plus.
//
// La table `public.membres` (migration 20260730180000) est désormais
// la seule autorité. Ces fonctions l'interrogent avec la clé
// `service_role`, qui n'est pas soumise à la RLS.
//
// COMPORTEMENT EN CAS DE PANNE — refuser, jamais autoriser. Table
// absente, requête en erreur, réseau coupé : la réponse est « non ».
// Conséquence opérationnelle, à ne pas inverser : la migration qui
// crée `membres` s'applique AVANT le déploiement de ces fonctions.
// ============================================================

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2.110.0'

/** Adresse normalisée telle qu'elle est stockée au registre, ou '' */
export function adresseNormalisee(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

/**
 * Vrai si l'adresse correspond à un membre actif du registre.
 * Toute incertitude — adresse vide, table injoignable, erreur SQL —
 * vaut faux.
 */
export async function estMembreActif(
  sb: SupabaseClient,
  email: string | null | undefined,
): Promise<boolean> {
  const adresse = adresseNormalisee(email)
  if (!adresse) return false

  const { data, error } = await sb
    .from('membres')
    .select('email')
    .eq('email', adresse)
    .eq('actif', true)
    .maybeSingle()

  if (error) {
    console.error('Registre des membres injoignable, accès refusé :', error.message)
    return false
  }
  return Boolean(data)
}

/**
 * Vrai si le porteur du jeton est un membre actif. Enchaîne la
 * vérification de la session et la consultation du registre : c'est le
 * geste que faisaient les cinq constantes `AGENCE`.
 */
export async function jetonDeMembreActif(
  sb: SupabaseClient,
  jeton: string | null | undefined,
): Promise<boolean> {
  if (!jeton) return false
  const { data, error } = await sb.auth.getUser(jeton)
  if (error) return false
  return await estMembreActif(sb, data.user?.email)
}
