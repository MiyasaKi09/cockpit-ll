// ============================================================
// Échéancier de facturation automatique — 100 % déterministe.
// Modèles du Réf_MIQCP :
//  · Public / Privé pro : facture à la remise de chaque phase ;
//    DET facturé mensuellement à l'avancement ; AOR 50 % à la
//    réception / 50 % à la levée des réserves.
//  · Particulier (modèle du cours) : ESQ 25 % démarrage / 75 %
//    remise · PC (APS+APD) 75 % au dépôt / 25 % à la complétude
//    · PRO 50/50 · ACT-DCE 40/30/30 · DET mensuel · AOR remise.
// Règle d'or : jamais d'honoraires conditionnés à l'OBTENTION du
// permis — on facture au dépôt et à la complétude.
// Tout est généré « prévue » et reste modifiable facture par
// facture dans le module Facturation.
// ============================================================

import type { Facture, Phase, PhaseCode, Projet, Settings } from './types'
import { addDays, monthKey } from './util'

/** prochain numéro AAAA-NNN, en continuant la séquence globale de l'année */
function compteurParAnnee(existantes: Facture[]): Map<string, number> {
  const compteur = new Map<string, number>()
  for (const f of existantes) {
    const m = /^(\d{4})-[A-Z]?(\d+)$/.exec(f.id)
    if (m) compteur.set(m[1], Math.max(compteur.get(m[1]) || 0, Number(m[2])))
  }
  return compteur
}

/** dernier jour du mois d'une date ISO */
function finDeMois(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const dernier = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(dernier).padStart(2, '0')}`
}

/** liste des fins de mois entre deux dates (bornes incluses par mois) */
function finsDeMoisEntre(debut: string, fin: string): string[] {
  const res: string[] = []
  let cur = monthKey(debut)
  const dernier = monthKey(fin)
  let garde = 0
  while (cur <= dernier && garde < 120) {
    res.push(finDeMois(cur + '-01'))
    const [y, m] = cur.split('-').map(Number)
    cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    garde++
  }
  return res
}

function arrondi(v: number): number {
  return Math.round(v)
}

interface Jalon {
  phase: PhaseCode
  libelle: string
  montantHT: number
  emission: string
}

/** jalons Public / Privé pro */
function jalonsPublic(phases: Phase[]): Jalon[] {
  const jalons: Jalon[] = []
  for (const ph of phases) {
    if (ph.montantHT <= 0 || !ph.fin) continue
    switch (ph.code) {
      case 'DET': {
        const mois = ph.debut ? finsDeMoisEntre(ph.debut, ph.fin) : [ph.fin]
        const n = Math.max(1, mois.length)
        const part = arrondi(ph.montantHT / n)
        mois.forEach((date, i) => {
          const montant = i === n - 1 ? ph.montantHT - part * (n - 1) : part
          jalons.push({
            phase: 'DET',
            libelle: `DET — situation de chantier n°${i + 1}/${n} (avancement)`,
            montantHT: montant,
            emission: date,
          })
        })
        break
      }
      case 'AOR': {
        const moitie = arrondi(ph.montantHT / 2)
        jalons.push(
          { phase: 'AOR', libelle: 'Réception (50 %)', montantHT: moitie, emission: ph.fin },
          { phase: 'AOR', libelle: 'Levée des réserves (50 %)', montantHT: ph.montantHT - moitie, emission: addDays(ph.fin, 30) },
        )
        break
      }
      case 'MC': {
        const moitie = arrondi(ph.montantHT / 2)
        const debut = ph.debut || ph.fin
        jalons.push(
          { phase: 'MC', libelle: 'Missions compl. — 1er acompte (50 %)', montantHT: moitie, emission: debut },
          { phase: 'MC', libelle: 'Missions compl. — solde (50 %)', montantHT: ph.montantHT - moitie, emission: ph.fin },
        )
        break
      }
      case 'ACT-DCE':
        jalons.push({ phase: ph.code, libelle: 'DCE + signature des marchés', montantHT: ph.montantHT, emission: ph.fin })
        break
      default:
        jalons.push({ phase: ph.code, libelle: `${ph.code} — remise`, montantHT: ph.montantHT, emission: ph.fin })
    }
  }
  return jalons
}

/** jalons Particulier (modèle du cours) */
function jalonsParticulier(phases: Phase[]): Jalon[] {
  const jalons: Jalon[] = []
  const par = (code: PhaseCode) => phases.find((p) => p.code === code)
  const aps = par('APS')
  const apd = par('APD')

  for (const ph of phases) {
    if (ph.montantHT <= 0 || !ph.fin) continue
    switch (ph.code) {
      case 'ESQ': {
        const quart = arrondi(ph.montantHT * 0.25)
        jalons.push(
          { phase: 'ESQ', libelle: 'Esquisse — démarrage (25 %)', montantHT: quart, emission: ph.debut || ph.fin },
          { phase: 'ESQ', libelle: 'Esquisse — remise (75 %)', montantHT: ph.montantHT - quart, emission: ph.fin },
        )
        break
      }
      case 'APS':
        // regroupé avec l'APD dans le dossier PC (traité sur la ligne APD)
        break
      case 'APD': {
        const pc = (aps?.montantHT || 0) + ph.montantHT
        if (pc <= 0) break
        const depot = arrondi(pc * 0.75)
        jalons.push(
          { phase: 'APD', libelle: 'Dossier PC (APS+APD) — dépôt (75 %)', montantHT: depot, emission: ph.fin },
          { phase: 'APD', libelle: 'Dossier PC — complétude (25 %)', montantHT: pc - depot, emission: addDays(ph.fin, 45) },
        )
        break
      }
      case 'PRO': {
        const moitie = arrondi(ph.montantHT / 2)
        jalons.push(
          { phase: 'PRO', libelle: 'Conception — démarrage PRO (50 %)', montantHT: moitie, emission: ph.debut || ph.fin },
          { phase: 'PRO', libelle: 'Conception — remise PRO (50 %)', montantHT: ph.montantHT - moitie, emission: ph.fin },
        )
        break
      }
      case 'ACT-DCE': {
        const p40 = arrondi(ph.montantHT * 0.4)
        const p30 = arrondi(ph.montantHT * 0.3)
        jalons.push(
          { phase: 'ACT-DCE', libelle: 'Consultation — démarrage (40 %)', montantHT: p40, emission: ph.debut || ph.fin },
          { phase: 'ACT-DCE', libelle: 'Consultation — remise DCE (30 %)', montantHT: p30, emission: ph.fin },
          { phase: 'ACT-DCE', libelle: 'Consultation — signature des marchés (30 %)', montantHT: ph.montantHT - p40 - p30, emission: addDays(ph.fin, 30) },
        )
        break
      }
      case 'DET': {
        const mois = ph.debut ? finsDeMoisEntre(ph.debut, ph.fin) : [ph.fin]
        const n = Math.max(1, mois.length)
        // regrouper par trimestre si le chantier est long (petites factures sinon)
        const pas = n > 6 ? 2 : 1
        const dates = mois.filter((_, i) => i % pas === pas - 1 || i === n - 1)
        const nb = dates.length
        const part = arrondi(ph.montantHT / nb)
        dates.forEach((date, i) => {
          const montant = i === nb - 1 ? ph.montantHT - part * (nb - 1) : part
          jalons.push({
            phase: 'DET',
            libelle: `Chantier — situation ${i + 1}/${nb}`,
            montantHT: montant,
            emission: date,
          })
        })
        break
      }
      case 'AOR':
        jalons.push({ phase: 'AOR', libelle: 'Réception & levée des réserves', montantHT: ph.montantHT, emission: ph.fin })
        break
      default:
        jalons.push({ phase: ph.code, libelle: `${ph.code} — remise`, montantHT: ph.montantHT, emission: ph.fin })
    }
  }
  return jalons
}

/**
 * Génère l'échéancier complet d'un projet à partir de ses phases datées.
 * Ne touche pas aux factures existantes : retourne les nouvelles factures
 * à ajouter (numérotation AAAA-NNN continue sur l'année, statut « prévue »).
 */
export function facturesParDefaut(projet: Projet, settings: Settings, existantes: Facture[]): Facture[] {
  const jalons =
    projet.typeMO === 'Particulier' ? jalonsParticulier(projet.phases) : jalonsPublic(projet.phases)
  jalons.sort((a, b) => a.emission.localeCompare(b.emission))

  const compteur = compteurParAnnee(existantes)
  const delai = settings.delaisPaiement[projet.typeMO]

  return jalons
    .filter((j) => j.montantHT > 0)
    .map((j) => {
      const annee = j.emission.slice(0, 4)
      const n = (compteur.get(annee) || 0) + 1
      compteur.set(annee, n)
      return {
        id: `${annee}-${String(n).padStart(3, '0')}`,
        projetId: projet.id,
        phase: j.phase,
        libelle: j.libelle,
        montantHT: j.montantHT,
        tauxTVA: 0.2,
        emission: j.emission,
        delaiJours: delai,
        statut: 'prevue' as const,
      }
    })
}

/**
 * Date les phases d'une mission à partir de trois repères simples :
 * début des études, durée des études (mois), durée du chantier (mois).
 * Études : ESQ→ACT-DCE réparties au prorata des % de mission ;
 * VISA : premier tiers du chantier ; DET : tout le chantier ;
 * AOR : les 2 mois suivant la fin du chantier. DIAG (si montant) : le
 * mois précédant les études. Tout reste ajustable phase par phase.
 */
export function daterPhases(
  phases: Phase[],
  debutEtudes: string,
  dureeEtudesMois: number,
  dureeChantierMois: number,
): Phase[] {
  const joursEtudes = Math.max(30, Math.round(dureeEtudesMois * 30.4))
  const joursChantier = Math.max(30, Math.round(dureeChantierMois * 30.4))

  const etudes: PhaseCode[] = ['ESQ', 'APS', 'APD', 'PRO', 'ACT-DCE']
  const poids = etudes.map((c) => phases.find((p) => p.code === c)?.pctBase || 0)
  const totalPoids = poids.reduce((s, x) => s + x, 0) || 1

  const debutChantier = addDays(debutEtudes, joursEtudes)
  const finChantier = addDays(debutChantier, joursChantier)

  let curseur = debutEtudes
  return phases.map((ph) => {
    const copie = { ...ph }
    if (ph.code === 'DIAG') {
      if (ph.montantHT > 0) {
        copie.debut = addDays(debutEtudes, -30)
        copie.fin = addDays(debutEtudes, -1)
      }
      return copie
    }
    const idx = etudes.indexOf(ph.code)
    if (idx >= 0) {
      const duree = Math.max(15, Math.round((joursEtudes * poids[idx]) / totalPoids))
      copie.debut = curseur
      copie.fin = addDays(curseur, duree - 1)
      curseur = addDays(copie.fin, 1)
      return copie
    }
    switch (ph.code) {
      case 'VISA':
        copie.debut = debutChantier
        copie.fin = addDays(debutChantier, Math.round(joursChantier / 3))
        break
      case 'DET':
        copie.debut = debutChantier
        copie.fin = finChantier
        break
      case 'AOR':
        copie.debut = addDays(finChantier, 1)
        copie.fin = addDays(finChantier, 60)
        break
      case 'MC':
        if (ph.montantHT > 0) {
          copie.debut = debutChantier
          copie.fin = addDays(finChantier, 60)
        }
        break
    }
    return copie
  })
}
