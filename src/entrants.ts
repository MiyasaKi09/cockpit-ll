// ============================================================
// Boîte d'arrivée PARTAGÉE — le versant navigateur de l'ingestion
// serveur (Edge Functions gmail-*). L'index vit dans la table
// « entrants » du projet Supabase de l'agence, le contenu dans le
// bucket privé « entrants ». Tout passe par la session du lien
// magique (RLS : les 2 adresses de l'agence uniquement) — aucune
// clé secrète côté client.
// ============================================================

import { clientSupabase } from './sync'

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
      'id,source,expediteur,objet,recu_le,nom_fichier,type_mime,taille,empreinte_sha256,chemin_storage,projet_id_propose,categorie_proposee,confiance,raisons',
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
    cheminStorage: l.chemin_storage,
    projetIdPropose: l.projet_id_propose,
    categorieProposee: l.categorie_proposee,
    confiance: l.confiance,
    raisons: Array.isArray(l.raisons) ? l.raisons : [],
  }))
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
  dernierScan: string | null
  dernierResultat: string | null
  urlOauth: string
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
  clientId: string
  clientSecret: string
  compteEmail: string
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
