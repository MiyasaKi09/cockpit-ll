// ============================================================
// Boîte d'arrivée PARTAGÉE — le versant navigateur de l'ingestion
// serveur (Edge Functions gmail-*). L'index vit dans la table
// « entrants » du projet Supabase de l'agence, le contenu dans le
// bucket privé « entrants ». Tout passe par la session du lien
// magique (RLS : les 2 adresses de l'agence uniquement) — aucune
// clé secrète côté client.
// ============================================================

import { useEffect, useState } from 'react'
import { clientSupabase, syncActif } from './sync'

/** une pièce reçue côté serveur, en attente de validation humaine */
export interface EntrantDistant {
  id: string
  source: string
  expediteur: string
  objet: string
  recuLe: string // ISO
  nomFichier: string
  typeMime: string
  taille: number
  empreinte: string
  /** identifiant du message Gmail d'origine — permet de rouvrir l'échange
   *  qui a apporté la pièce (§7.3 double traçabilité, critère 10) */
  sourceMessageId: string | null
  cheminStorage: string | null
  projetIdPropose: string | null
  categorieProposee: string | null
  confiance: number | null
  raisons: string[]
}

interface LigneEntrant {
  id: string
  source: string
  expediteur: string | null
  objet: string | null
  recu_le: string
  nom_fichier: string
  type_mime: string | null
  taille: number | null
  empreinte_sha256: string | null
  source_id: string | null
  chemin_storage: string | null
  projet_id_propose: string | null
  categorie_proposee: string | null
  confiance: number | null
  raisons: string[] | null
}

/** pièces « à valider » de l'index partagé (récent d'abord) */
export async function listerEntrantsDistants(): Promise<EntrantDistant[]> {
  const sb = clientSupabase()
  if (!sb) return []
  const { data, error } = await sb
    .from('entrants')
    .select(
      'id,source,source_id,expediteur,objet,recu_le,nom_fichier,type_mime,taille,empreinte_sha256,chemin_storage,projet_id_propose,categorie_proposee,confiance,raisons',
    )
    .eq('statut', 'a_valider')
    .order('recu_le', { ascending: false })
    .limit(50)
  if (error) throw new Error(`Lecture de la boîte partagée impossible : ${error.message}`)
  return ((data || []) as LigneEntrant[]).map((l) => ({
    id: l.id,
    source: l.source,
    expediteur: l.expediteur || '',
    objet: l.objet || '',
    recuLe: l.recu_le,
    nomFichier: l.nom_fichier,
    typeMime: l.type_mime || '',
    taille: l.taille || 0,
    empreinte: l.empreinte_sha256 || '',
    sourceMessageId: l.source_id,
    cheminStorage: l.chemin_storage,
    projetIdPropose: l.projet_id_propose,
    categorieProposee: l.categorie_proposee,
    confiance: l.confiance,
    raisons: Array.isArray(l.raisons) ? l.raisons : [],
  }))
}

/**
 * Combien de pièces attendent dans la boîte partagée — `null` quand
 * l'espace partagé n'est pas connecté ou n'a pas encore répondu.
 *
 * L'accueil annonce ces pièces parmi les validations attendues, mais il
 * ne peut pas les DÉRIVER : elles vivent côté serveur, pas dans l'état
 * local. Le compteur est donc lu ici, une fois, et passé en argument aux
 * fonctions de calcul — l'écran ne filtre rien lui-même. La session du
 * lien magique s'ouvrant en asynchrone au démarrage, une seconde lecture
 * est tentée peu après, puis le rythme retombe à cinq minutes.
 */
export function useNbEntrantsDistants(): number | null {
  const [nb, setNb] = useState<number | null>(null)
  useEffect(() => {
    let vivant = true
    const lire = async () => {
      if (!syncActif()) {
        if (vivant) setNb(null)
        return
      }
      try {
        const liste = await listerEntrantsDistants()
        if (vivant) setNb(liste.length)
      } catch {
        // boîte partagée illisible : l'accueil n'annonce rien plutôt
        // qu'un zéro trompeur — le module Documents porte le message
        if (vivant) setNb(null)
      }
    }
    void lire()
    const differe = setTimeout(() => void lire(), 2500)
    const iv = setInterval(() => void lire(), 300_000)
    return () => {
      vivant = false
      clearTimeout(differe)
      clearInterval(iv)
    }
  }, [])
  return nb
}

/** télécharge le contenu de la pièce (bucket privé) en File prêt à ranger */
export async function telechargerEntrant(e: EntrantDistant): Promise<File> {
  const sb = clientSupabase()
  if (!sb) throw new Error('Espace partagé non connecté.')
  if (!e.cheminStorage) throw new Error('Cette pièce n’a pas de contenu stocké.')
  const { data, error } = await sb.storage.from('entrants').download(e.cheminStorage)
  if (error || !data) throw new Error(`Téléchargement impossible : ${error?.message || 'contenu absent'}.`)
  return new File([data], e.nomFichier, { type: e.typeMime || data.type })
}

/** marque la pièce traitée (classée ou rejetée) dans l'index partagé */
export async function marquerEntrant(id: string, statut: 'classe' | 'rejete', par?: string): Promise<void> {
  const sb = clientSupabase()
  if (!sb) throw new Error('Espace partagé non connecté.')
  const { error } = await sb
    .from('entrants')
    .update({ statut, traite_par: par || null, traite_le: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Mise à jour impossible : ${error.message}`)
}

// ---------- pilotage de l'ingestion (Edge Functions) ----------

export interface StatutIngestion {
  configure: boolean
  connecte: boolean
  compteEmail: string
  workspaceId: string
  dernierScan: string | null
  dernierResultat: string | null
  /** URI fixe à déclarer dans Google Cloud. */
  urlOauth: string
  /** Départ OAuth court et signé, délivré à la session agence. */
  urlConnexion?: string | null
}

/** statut de l'ingestion serveur (sans aucun secret) */
export async function lireStatutIngestion(): Promise<StatutIngestion | null> {
  const sb = clientSupabase()
  if (!sb) return null
  const { data, error } = await sb.functions.invoke('ingestion-config', { method: 'GET' })
  if (error) throw new Error(`Statut illisible : ${error.message}`)
  return data as StatutIngestion
}

/** enregistre les identifiants OAuth côté serveur (table privée) */
export async function majConfigIngestion(cfg: {
  clientId?: string
  clientSecret?: string
  compteEmail: string
  workspaceId: string
}): Promise<void> {
  const sb = clientSupabase()
  if (!sb) throw new Error('Espace partagé non connecté.')
  const { error } = await sb.functions.invoke('ingestion-config', { method: 'POST', body: cfg })
  if (error) throw new Error(`Enregistrement impossible : ${error.message}`)
}

/** oublie le refresh token côté serveur (déconnexion Gmail) */
export async function deconnecterIngestion(): Promise<void> {
  const sb = clientSupabase()
  if (!sb) throw new Error('Espace partagé non connecté.')
  const { error } = await sb.functions.invoke('ingestion-config', { method: 'DELETE' })
  if (error) throw new Error(`Déconnexion impossible : ${error.message}`)
}

/** déclenche un scan Gmail immédiat (sinon : toutes les 10 minutes) */
export async function scannerMaintenant(): Promise<{ statut: string; nouvelles?: number; messages?: number }> {
  const sb = clientSupabase()
  if (!sb) throw new Error('Espace partagé non connecté.')
  const { data, error } = await sb.functions.invoke('gmail-ingestion', { method: 'POST', body: {} })
  if (error) throw new Error(`Scan impossible : ${error.message}`)
  return data as { statut: string; nouvelles?: number; messages?: number }
}
