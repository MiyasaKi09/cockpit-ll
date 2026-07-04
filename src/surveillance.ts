// ============================================================
// Surveillance Gmail & Agenda — moteur partagé entre le Cockpit
// (scan automatique toutes les 60 s tant que l'onglet est ouvert)
// et la page Santé (scan à la demande + journal de bord).
// Chaque mail capté laisse une trace : quoi, quand, rangé où et
// pourquoi — pour qu'on puisse VOIR que ça marche.
// ============================================================

import { useEffect, useState } from 'react'
import type { AppState } from './types'
import { estConnecte, listerEvenements, listerMailsRecents, mailsDejaVus, marquerVus } from './google'
import type { EvenementAgenda } from './google'
import { fold, todayISO, uid } from './util'

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

/** devine le projet d'un mail : ID Pxx cité, nom de projet, ou entreprise d'un marché */
export function devinerProjet(state: AppState, texte: string): string | null {
  const t = fold(texte)
  for (const p of state.projets) {
    if (t.includes(fold(p.id)) || (p.nom.length > 8 && t.includes(fold(p.nom)))) return p.id
  }
  for (const m of state.marches) {
    if (t.includes(fold(m.entreprise))) return m.projetId
  }
  return null
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
        const projetId = devinerProjet(d, `${m.objet} ${m.extrait} ${m.de}`)
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
      if (!estConnecte()) {
        setDirect(false)
        return
      }
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
