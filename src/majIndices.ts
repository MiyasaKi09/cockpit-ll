// 5.18 — la récupération AUTOMATIQUE des indices INSEE, branchée à la
// racine de l'application (même patron que useSurveillance : App.tsx monte
// le hook une fois, il tourne quel que soit l'écran affiché).
//
// L'agence l'a demandé en toutes lettres : « une récupération automatique et
// non pas volontaire ». Le geste des Paramètres reste possible — il cesse
// d'être NÉCESSAIRE. Quatre règles tiennent ce module :
//
//   (a) JAMAIS bloquant : la tentative part quelques secondes APRÈS le
//       chargement, par setTimeout — aucun await de fetch dans le chemin de
//       rendu, le démarrage hors ligne de M.1 reste intact ;
//   (b) au plus une fois par 24 h (`settings.indicesMajLe`, horodatage ISO,
//       partagé entre les 2 postes : l'un a récupéré, l'autre n'appelle pas) ;
//   (c) échec réseau ⇒ SILENCE à l'écran (console.warn seulement) et nouvel
//       essai au prochain démarrage — une application locale qui affiche une
//       erreur réseau au réveil ressemble à une panne ;
//   (d) succès avec changements ⇒ UN toast discret ; rien de nouveau ⇒ pas
//       un mot.
//
// La logique (parse, fusion, anti-marteau) est PURE dans src/indicesInsee.ts ;
// ici ne vivent que le réseau, l'horloge et le branchement React — comme
// surveillance.ts pour Gmail/Agenda.

import { useEffect, useRef } from 'react'
import type { AppState } from './types'
import { relaisDisponible, viaRelais } from './relais'
import { toast } from './ui'
import {
  URL_FLUX_INSEE,
  codesVoulus,
  doitRafraichirIndices,
  fusionnerIndices,
  messageMajIndices,
  parseSeriesSdmx,
} from './indicesInsee'

/** le différé de démarrage : l'écran d'abord, le réseau ensuite */
export const DELAI_DEMARRAGE_MS = 5_000

type MiseAJour = (fn: (draft: AppState) => void) => void

export interface ResultatMajIndices {
  ok: boolean
  /** le texte des changements — null si succès sans rien de nouveau */
  message: string | null
  erreur?: string
}

/** récupère le flux complet et fusionne l'historique dans `indicesBTP`.
 *
 *  La fusion se calcule SUR LE DRAFT du store, pas sur un état capturé avant
 *  le fetch : une valeur saisie à la main pendant l'aller-retour réseau
 *  (plusieurs secondes) serait sinon écrasée par un instantané périmé.
 *  `indicesMajLe` n'est posé QUE sur succès : un échec doit laisser le
 *  prochain démarrage réessayer (règle c). */
export async function rafraichirIndicesInsee(update: MiseAJour): Promise<ResultatMajIndices> {
  try {
    // le relais n'existe que sur le site déployé : en local ou hors ligne,
    // on s'arrête là — sans horodatage, le prochain démarrage retentera
    if (!(await relaisDisponible())) {
      return { ok: false, message: null, erreur: 'Le relais Vercel ne répond pas (hors ligne, ou poste de développement).' }
    }
    const xml = await viaRelais(URL_FLUX_INSEE)
    const series = parseSeriesSdmx(xml)
    if (series.length === 0) {
      // une réponse 200 sans aucune série lisible est un flux qui a changé
      // de forme, pas « rien de nouveau » : la traiter en échec la rend
      // visible en console au lieu de figer silencieusement les indices
      return { ok: false, message: null, erreur: 'Réponse INSEE illisible : aucune série dans le flux.' }
    }
    let message: string | null = null
    update((d) => {
      const fusion = fusionnerIndices(d.indicesBTP, series, codesVoulus(d.marches, d.indicesBTP))
      message = messageMajIndices(fusion.ajoutes, fusion.remplaces)
      if (message) d.indicesBTP = fusion.indices
      d.settings.indicesMajLe = new Date().toISOString()
    })
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: null, erreur: e instanceof Error ? e.message : String(e) }
  }
}

/** le branchement racine : UNE tentative différée par démarrage, l'anti-
 *  marteau 24 h fait le reste. Les refs portent l'état et l'update les plus
 *  récents pour que l'effet garde des dépendances VIDES — relancer la
 *  tentative à chaque frappe de clavier serait le marteau qu'on interdit. */
export function useMajIndicesInsee(state: AppState, update: MiseAJour): void {
  const refEtat = useRef(state)
  refEtat.current = state
  const refUpdate = useRef(update)
  refUpdate.current = update

  useEffect(() => {
    let arrete = false
    // (a) le différé : rien ne part pendant le rendu ni pendant les premières
    // secondes — l'écran appartient à la personne, pas au réseau
    const minuteur = setTimeout(() => {
      void (async () => {
        if (arrete) return
        // (b) l'anti-marteau, décidé par la fonction pure et testable
        if (!doitRafraichirIndices(refEtat.current.settings.indicesMajLe, new Date().toISOString())) return
        const resultat = await rafraichirIndicesInsee((fn) => refUpdate.current(fn))
        if (arrete) return
        if (!resultat.ok) {
          // (c) silence à l'écran — la console garde la trace pour qui cherche
          console.warn('Indices INSEE non rafraîchis :', resultat.erreur)
          return
        }
        // (d) un seul toast, et seulement s'il y a du nouveau
        if (resultat.message) toast(resultat.message)
      })()
    }, DELAI_DEMARRAGE_MS)
    return () => {
      arrete = true
      clearTimeout(minuteur)
    }
    // dépendances vides : une tentative par démarrage (le nettoyage rend le
    // double-montage StrictMode inoffensif — le premier minuteur est annulé)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
