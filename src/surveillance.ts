// ============================================================
// Surveillance Gmail & Agenda — moteur partagé entre le Cockpit
// (scan automatique toutes les 60 s tant que l'onglet est ouvert)
// et la page Santé (scan à la demande + journal de bord).
// Chaque mail capté laisse une trace : quoi, quand, rangé où et
// pourquoi — pour qu'on puisse VOIR que ça marche.
// ============================================================

import { createContext, useContext, useEffect, useState } from 'react'
import type { AppState } from './types'
import { assurerJeton, estConnecte, listerEvenements, listerMailsRecents, mailsDejaVus, marquerVus } from './google'
import type { EvenementAgenda } from './google'
import { rattacherMessage, reperesDe } from './rattachement'
import { todayISO, uid } from './util'

// ---------- journal de bord persistant (hors état exporté) ----------

export interface EvenementSurveillance {
  ts: string // ISO datetime
  type: 'mail' | 'erreur' | 'info'
  message: string
  projetId?: string | null
}

const CLE_JOURNAL = 'cockpit-ll-journal-surveillance'
const CLE_DERNIER_SCAN = 'cockpit-ll-dernier-scan'

export function journalSurveillance(): EvenementSurveillance[] {
  try {
    return JSON.parse(localStorage.getItem(CLE_JOURNAL) || '[]') as EvenementSurveillance[]
  } catch {
    return []
  }
}

function noter(type: EvenementSurveillance['type'], message: string, projetId?: string | null): void {
  try {
    const j = [{ ts: new Date().toISOString(), type, message, projetId }, ...journalSurveillance()].slice(0, 60)
    localStorage.setItem(CLE_JOURNAL, JSON.stringify(j))
  } catch {
    // stockage plein : sans gravité
  }
}

/** horodatage du dernier scan réussi (ISO), ou null si jamais scanné */
export function dernierScan(): string | null {
  return localStorage.getItem(CLE_DERNIER_SCAN)
}

// ---------- rattachement ----------
//
// A.4 — CE MOTEUR N'EXISTE PLUS ICI. `devinerProjet` cherchait l'identifiant,
// le nom du projet (dès 9 caractères) ou le nom d'une entreprise de marché
// dans l'objet, l'EXTRAIT DU CORPS et l'expéditeur mis bout à bout, et
// retenait le premier projet croisé — sans confiance, sans raison, et sans
// jamais refuser de trancher quand deux projets correspondaient. Le serveur
// et l'import répondaient autrement à la même question (§3.7).
//
// Deux conséquences visibles de la bascule, toutes deux voulues :
//   * le CORPS ne rattache plus rien. Un nom de projet cité en signature ou
//     dans un fil recopié rattachait à tort, et un rattachement faux se
//     corrige un par un ;
//   * deux projets à égalité rendent `null` — le mail part dans la file
//     « à rattacher » au lieu d'aller au premier de la liste.

/** devine le projet d'un mail — LA cascade du §3.7, jamais une seconde. */
export function devinerProjet(
  state: AppState,
  message: { objet?: string; expediteur?: string },
): string | null {
  return rattacherMessage(reperesDe(state), message).projetId
}

// ---------- scan ----------

export interface ResultatScan {
  nouveauxMails: number
  totalMails: number
  evenements: EvenementAgenda[]
}

/**
 * Un scan complet : Gmail + Agenda. Range les nouveaux mails dans les
 * courriers « à traiter » (projet deviné) et journalise chaque capture.
 * Lève une Error lisible si la session Google est coupée.
 */
export async function scannerUneFois(
  state: AppState,
  update: (fn: (draft: AppState) => void) => void,
): Promise<ResultatScan> {
  if (!estConnecte()) throw new Error('Session Google non connectée — bouton « Se connecter » dans Paramètres.')
  const adresse = state.settings.surveillance?.email?.trim() || ''
  let mails, evts
  try {
    ;[mails, evts] = await Promise.all([listerMailsRecents(adresse), listerEvenements()])
  } catch (e) {
    noter('erreur', e instanceof Error ? e.message : 'Erreur Google inconnue.')
    throw e
  }
  const vus = mailsDejaVus()
  const nouveaux = mails.filter((m) => !vus.has(m.id))
  if (nouveaux.length > 0) {
    update((d) => {
      for (const m of nouveaux) {
        if (d.courriers.some((c) => c.source === `gmail:${m.id}`)) continue
        const projetId = devinerProjet(d, { objet: m.objet, expediteur: m.de })
        d.courriers.push({
          id: uid('mail'),
          projetId,
          de: m.de.replace(/<[^>]*>/g, '').trim() || m.de,
          objet: m.objet,
          resume: m.extrait,
          type: 'mail reçu',
          statut: 'a_traiter',
          dateReception: m.date || todayISO(),
          source: `gmail:${m.id}`,
        })
        noter(
          'mail',
          `✉ « ${m.objet} » de ${m.de.replace(/<[^>]*>/g, '').trim() || m.de} → ${projetId || 'À traiter (projet non reconnu)'}`,
          projetId,
        )
      }
    })
    marquerVus(nouveaux.map((m) => m.id))
  }
  localStorage.setItem(CLE_DERNIER_SCAN, new Date().toISOString())
  return { nouveauxMails: nouveaux.length, totalMails: mails.length, evenements: evts }
}

// ---------- hook du Cockpit (tick 60 s) ----------

export function useSurveillance(state: AppState, update: (fn: (draft: AppState) => void) => void) {
  const [evenements, setEvenements] = useState<EvenementAgenda[]>([])
  const [direct, setDirect] = useState(false)
  const sv = state.settings.surveillance

  useEffect(() => {
    let arret = false
    const tick = async () => {
      // `assurerJeton` reprend la main en silence quand le jeton a disparu —
      // au rechargement de la page comme à l'expiration horaire. Tester
      // `estConnecte()` seul rendait ces deux coupures définitives jusqu'au
      // prochain clic, alors que Google sait ré-émettre sans rien demander.
      if (!(await assurerJeton(sv?.clientId))) {
        setDirect(false)
        return
      }
      if (arret) return
      setDirect(true)
      try {
        const r = await scannerUneFois(state, update)
        if (!arret) setEvenements(r.evenements)
      } catch {
        // session expirée ou hors-ligne : le badge repasse à « off » au tick suivant
      }
    }
    void tick()
    const iv = setInterval(tick, 60_000)
    return () => {
      arret = true
      clearInterval(iv)
    }
  }, [sv?.email, sv?.clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  return { evenements, direct }
}

// ---------- contexte applicatif : la surveillance vit à la RACINE ----------
// (elle tourne quel que soit l'écran affiché, pas seulement sur le Cockpit ;
//  App.tsx monte useSurveillance une fois et publie le résultat ici)

export interface EtatSurveillance {
  evenements: EvenementAgenda[]
  direct: boolean
}

export const SurveillanceCtx = createContext<EtatSurveillance>({ evenements: [], direct: false })

export function useSurveillanceCtx(): EtatSurveillance {
  return useContext(SurveillanceCtx)
}
