import type { AppState } from './types'

export type ConfigSyncMinimale = NonNullable<AppState['settings']['sync']>

/** Identité exacte d'une cible d'envoi. Elle reste en mémoire uniquement :
 *  une file préparée pour un projet ne doit jamais être rejouée sur un autre. */
export function cibleSynchronisation(
  config: ConfigSyncMinimale | null | undefined,
): string | null {
  if (!config) return null
  const url = config.url.trim().replace(/\/+$/, '').toLowerCase()
  const anonKey = config.anonKey.trim()
  const workspaceId = config.workspaceId.trim()
  if (!url || !anonKey || !workspaceId) return null
  return `${url}\u0000${anonKey}\u0000${workspaceId}`
}

/** Namespace persistant : la clé publique peut tourner sans perdre la révision
 *  du même projet, mais deux projets/espaces restent strictement cloisonnés. */
export function namespaceSynchronisation(
  config: Pick<ConfigSyncMinimale, 'url' | 'workspaceId'> | null | undefined,
): string | null {
  if (!config) return null
  const url = config.url.trim().replace(/\/+$/, '').toLowerCase()
  const workspaceId = config.workspaceId.trim()
  if (!url || !workspaceId) return null
  return encodeURIComponent(`${url}\u0000${workspaceId}`)
}

export function changementCibleInterdit(
  cibleAvant: string | null,
  cibleApres: string | null,
  modificationsEnAttente: boolean,
): boolean {
  return Boolean(
    modificationsEnAttente &&
      cibleAvant &&
      cibleAvant !== cibleApres,
  )
}

/** État autorisé à quitter le navigateur. */
export function etatPartageable(state: AppState): AppState {
  const { sync: _local, ...restSettings } = state.settings
  return {
    ...state,
    corpusDocuments: state.corpusDocuments.filter((document) => !document.prive),
    settings: restSettings,
  }
}

/** Toute collection absente d'un document écrit par une ancienne version est
 *  préservée. Un tableau vide, lui, reste une suppression explicite. */
export const COLLECTIONS_ADDITIVES = [
  'projets',
  'marches',
  'situations',
  'factures',
  'temps',
  'references',
  'obligations',
  'contacts',
  'interactions',
  'artisans',
  'materiaux',
  'consultations',
  'prompts',
  'reunions',
  'courriers',
  'tempsHorsProjet',
  'absences',
  'evaluations',
  'lotsDce',
  'tachesChantier',
  'registreDocuments',
  'entreprises',
  'organisations',
  'echeancesFacturation',
  'paiements',
  'contrats',
  'facturesAchat',
  'notesFrais',
  'attendusFinanciers',
  'transactionsBancaires',
  'importsBancaires',
  'lotsComptables',
  'revisionsResteAFaire',
  'pistesAvenant',
  'decisionsDirection',
  'simulations',
  'connecteurs',
] as const satisfies readonly (keyof AppState)[]

/** Fusion additive d'un état distant avec les données strictement locales.
 *  Les anciennes versions du Cockpit ne doivent pas effacer les collections
 *  qu'elles ne connaissent pas, et un document privé ne quitte jamais ce poste. */
export function fusionnerEtatDistant(next: AppState, local: AppState): AppState {
  const distant = { ...next }
  const distantIndexe = distant as unknown as Record<string, unknown>
  const localIndexe = local as unknown as Record<string, unknown>
  for (const collection of COLLECTIONS_ADDITIVES) {
    if (!Array.isArray(distantIndexe[collection]))
      distantIndexe[collection] = localIndexe[collection]
  }

  const privesLocaux = local.corpusDocuments.filter((document) => document.prive)
  const idsPrives = new Set(privesLocaux.map((document) => document.id))
  const publicsDistants = (
    Array.isArray(distant.corpusDocuments)
      ? distant.corpusDocuments
      : local.corpusDocuments
  ).filter((document) => !document.prive && !idsPrives.has(document.id))
  distant.corpusDocuments = [...publicsDistants, ...privesLocaux]

  distant.settings = {
    ...local.settings,
    ...(distant.settings || {}),
    sync: local.settings.sync,
  }
  return distant
}
