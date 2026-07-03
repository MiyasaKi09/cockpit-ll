// ============================================================
// Moteur MIQCP — 100 % déterministe (guide 1994, éd. 2019).
// Le barème n'a AUCUNE valeur réglementaire (interdiction des
// barèmes depuis 2016) : référence de négociation uniquement.
// Sous ~1,03 M€ de travaux actualisés, le guide renvoie au
// chiffrage en temps passé.
// ============================================================

import type { Phase, PhaseCode, Projet, Settings } from './types'

/** Barème : montant de travaux en € constants 1994 → taux mission de base */
export const BAREME_1994: { seuil: number; taux: number }[] = [
  { seuil: 457347.05, taux: 0.13 },
  { seuil: 609796.07, taux: 0.1225 },
  { seuil: 762245.09, taux: 0.117 },
  { seuil: 914694.1, taux: 0.114 },
  { seuil: 1067143.12, taux: 0.112 },
  { seuil: 1219592.14, taux: 0.11 },
  { seuil: 1372041.16, taux: 0.108 },
  { seuil: 1524490.17, taux: 0.1065 },
  { seuil: 2286735.26, taux: 0.1005 },
  { seuil: 3048980.34, taux: 0.097 },
  { seuil: 3811225.43, taux: 0.094 },
  { seuil: 4573470.52, taux: 0.092 },
  { seuil: 5335715.6, taux: 0.09 },
  { seuil: 6097960.69, taux: 0.0885 },
  { seuil: 6860205.78, taux: 0.0875 },
  { seuil: 7622450.86, taux: 0.087 },
  { seuil: 11433676.29, taux: 0.0855 },
  { seuil: 15244901.72, taux: 0.085 },
  { seuil: 22867352.59, taux: 0.084 },
  { seuil: 30489803.45, taux: 0.0835 },
  { seuil: 38112254.31, taux: 0.083 },
  { seuil: 45734705.17, taux: 0.0828 },
  { seuil: 53357156.03, taux: 0.0825 },
  { seuil: 60979606.89, taux: 0.0824 },
  { seuil: 68602057.76, taux: 0.0823 },
  { seuil: 76224508.62, taux: 0.0822 },
]

/** Types d'ouvrages — plages de coefficient de complexité (guide MIQCP) */
export const OUVRAGES: { code: string; bas: number; haut: number }[] = [
  { code: '11- Maisons individuelles', bas: 0.6, haut: 1.1 },
  { code: '12- Logements collectifs', bas: 0.7, haut: 1.2 },
  { code: '13- Hôtellerie et hébergement', bas: 0.8, haut: 1.3 },
  { code: '21- Bureaux', bas: 0.6, haut: 1.5 },
  { code: '22- Locaux commerciaux', bas: 0.6, haut: 1.4 },
  { code: '31- Maisons de retraite ou de cures', bas: 0.8, haut: 1.3 },
  { code: '32- Dispensaires et centres médicaux', bas: 0.9, haut: 1.4 },
  { code: '33- Cliniques et hôpitaux généraux', bas: 1.1, haut: 1.6 },
  { code: '34- CHU et hôpitaux régionaux', bas: 1.3, haut: 1.8 },
  { code: '41- Enseignement 1er degré', bas: 0.7, haut: 1.3 },
  { code: '42- Enseignement 2e degré', bas: 0.8, haut: 1.4 },
  { code: '43- Enseignement supérieur', bas: 0.9, haut: 1.5 },
  { code: '44- Établissements de recherche', bas: 1.3, haut: 1.8 },
  { code: '51- Équipements de proximité', bas: 0.7, haut: 1.1 },
  { code: '52- Foyers et salles polyvalentes', bas: 0.6, haut: 1.3 },
  { code: '53- Bibliothèques et médiathèques', bas: 0.8, haut: 1.6 },
  { code: '54- Spectacle, culture, musées', bas: 1.0, haut: 1.8 },
  { code: '55- Expositions et congrès', bas: 0.9, haut: 1.8 },
  { code: '61- Bâtiments liés à la sécurité', bas: 0.8, haut: 1.4 },
  { code: '62- Bâtiments administratifs simples', bas: 0.7, haut: 1.2 },
  { code: '63- Équip. administratifs complexité moyenne', bas: 0.9, haut: 1.4 },
  { code: '64- Équip. administratifs majeurs', bas: 1.0, haut: 1.8 },
  { code: '71- Salles de sport de proximité', bas: 0.6, haut: 1.0 },
  { code: '72- Équipements omnisports', bas: 0.8, haut: 1.4 },
  { code: '73- Ensembles sportifs importants', bas: 1.0, haut: 1.6 },
  { code: '81- Entreposage', bas: 0.6, haut: 1.2 },
  { code: '82- Garages et parkings', bas: 0.6, haut: 1.0 },
  { code: '83- Bâtiments à caractère technique', bas: 0.8, haut: 1.6 },
  { code: '84- Gares et aérogares', bas: 0.6, haut: 1.8 },
]

/** 27 critères de complexité MIQCP, notés de −2 à +2, en 3 groupes */
export const CRITERES_COMPLEXITE: { groupe: string; criteres: string[] }[] = [
  {
    groupe: "1. Contraintes physiques du contexte et insertion dans l'environnement",
    criteres: [
      'Qualité du sol et du sous-sol',
      'Contraintes physiques',
      'Existence de nuisances',
      'Existence de risques',
      'Situation du terrain',
      'Contexte urbain',
      'Contexte réglementaire',
    ],
  },
  {
    groupe: '2. Nature du programme et spécificité du projet',
    criteres: [
      'Multiplicité et imbrication des fonctions',
      'Typologie et répétitivité',
      'Adaptabilité et modularité',
      "Caractère d'innovation ou d'expérimentation",
      'Niveau de performances des ouvrages',
      'Difficultés techniques particulières',
      'Technicité des installations',
      'Étendue des compétences nécessaires',
    ],
  },
  {
    groupe: '3. Exigences contractuelles',
    criteres: [
      "Organisation de la maîtrise d'ouvrage",
      'Qualité du programme',
      'Demande de prestations supplémentaires',
      'Phasage des études et des travaux',
      'Délais des études et des travaux',
      'Exigences économiques performantielles',
      'Taux de tolérance',
      "Emploi de méthodes ou d'outils particuliers",
      'Mode de dévolution des travaux',
      "Gestion des variantes d'appel d'offres",
      'Sujétions particulières de chantier et déplacements',
      'Conditions contractuelles spéciales',
    ],
  },
]

export const TOUS_CRITERES: string[] = CRITERES_COMPLEXITE.flatMap((g) => g.criteres)

/** Répartition de la mission de base par phase (% retenus L&L) */
export const REPARTITION_PHASES: { code: PhaseCode; pct: number; fourchette: string }[] = [
  { code: 'ESQ', pct: 0.05, fourchette: '4 à 6 %' },
  { code: 'APS', pct: 0.095, fourchette: '9 à 10 %' },
  { code: 'APD', pct: 0.175, fourchette: '17 à 18 %' },
  { code: 'PRO', pct: 0.2, fourchette: '19 à 21 %' },
  { code: 'ACT-DCE', pct: 0.075, fourchette: '7 à 8 %' },
  { code: 'VISA', pct: 0.085, fourchette: '8 à 9 %' },
  { code: 'DET', pct: 0.265, fourchette: '24 à 28 %' },
  { code: 'AOR', pct: 0.055, fourchette: '5 à 7 %' },
]

export const PHASES_ORDRE: PhaseCode[] = ['DIAG', 'ESQ', 'APS', 'APD', 'PRO', 'ACT-DCE', 'VISA', 'DET', 'AOR', 'MC']

export const LIBELLES_PHASES: Record<PhaseCode, string> = {
  DIAG: 'Diagnostic',
  ESQ: 'Esquisse',
  APS: 'Avant-projet sommaire',
  APD: 'Avant-projet définitif',
  PRO: 'Projet',
  'ACT-DCE': 'Consultation des entreprises',
  VISA: 'Visa des plans EXE',
  DET: 'Direction de l’exécution',
  AOR: 'Réception des travaux',
  MC: 'Missions complémentaires',
}

/** coefficient d'actualisation BT01 (réf. avril 1994 = 60,989) */
export function coefBT01(settings: Pick<Settings, 'bt01Actuel' | 'bt01Ref1994'>): number {
  return settings.bt01Actuel / settings.bt01Ref1994
}

/** seuil du barème sous lequel le guide renvoie au temps passé (≈ 1,03 M€ actualisés) */
export function seuilPlancherActualise(settings: Pick<Settings, 'bt01Actuel' | 'bt01Ref1994'>): number {
  return BAREME_1994[0].seuil * coefBT01(settings)
}

/**
 * Taux barème pour un montant de travaux HT (€ courants), interpolation
 * linéaire entre seuils actualisés BT01. En dessous du premier seuil : 13 %
 * (le guide renvoie alors au chiffrage en temps passé) ; au-dessus du
 * dernier : 8,22 %.
 */
export function tauxBareme(montantTravauxHT: number, settings: Pick<Settings, 'bt01Actuel' | 'bt01Ref1994'>): number {
  const k = coefBT01(settings)
  const pts = BAREME_1994.map((b) => ({ seuil: b.seuil * k, taux: b.taux }))
  if (montantTravauxHT <= pts[0].seuil) return pts[0].taux
  for (let i = 1; i < pts.length; i++) {
    if (montantTravauxHT <= pts[i].seuil) {
      const a = pts[i - 1]
      const b = pts[i]
      const t = (montantTravauxHT - a.seuil) / (b.seuil - a.seuil)
      return a.taux + t * (b.taux - a.taux)
    }
  }
  return pts[pts.length - 1].taux
}

export function plageOuvrage(ouvrage: string | null): { bas: number; haut: number } | null {
  if (!ouvrage) return null
  const o = OUVRAGES.find((x) => x.code === ouvrage)
  return o ? { bas: o.bas, haut: o.haut } : null
}

/**
 * Coefficient de complexité : total des notes (−54..+54) → position dans la
 * plage (0,5 sans notation) → coef = bas + position × (haut − bas).
 * Arrondi à 2 décimales, comme l'Excel maître.
 */
export function coefComplexite(projet: Pick<Projet, 'ouvrage' | 'notesComplexite' | 'coefManuel'>): number | null {
  if (projet.coefManuel !== undefined && projet.coefManuel !== null) return projet.coefManuel
  const plage = plageOuvrage(projet.ouvrage)
  if (!plage) return null
  const total = TOUS_CRITERES.reduce((s, c) => s + (projet.notesComplexite[c] ?? 0), 0)
  const position = 0.5 + total / 108
  return Math.round((plage.bas + position * (plage.haut - plage.bas)) * 100) / 100
}

export function totalPointsComplexite(projet: Pick<Projet, 'notesComplexite'>): number {
  return TOUS_CRITERES.reduce((s, c) => s + (projet.notesComplexite[c] ?? 0), 0)
}

export interface CalculHonoraires {
  tauxBareme: number | null
  coef: number | null
  tauxAjuste: number | null
  /** taux réellement appliqué (tauxRetenu si saisi, sinon taux ajusté) */
  tauxFinal: number | null
  honorairesBaseHT: number
  missionsComplHT: number
  honorairesTotauxHT: number
  /** vrai si sous le plancher du barème → privilégier le temps passé */
  sousPlancher: boolean
}

export function calculHonoraires(projet: Projet, settings: Settings): CalculHonoraires {
  const m = projet.montantTravauxHT
  const tb = m ? tauxBareme(m, settings) : null
  const coef = coefComplexite(projet)
  const tauxAjuste = tb !== null && coef !== null ? tb * coef : null
  const tauxFinal = projet.tauxRetenu ?? tauxAjuste
  const base = m && tauxFinal !== null ? m * tauxFinal : 0
  return {
    tauxBareme: tb,
    coef,
    tauxAjuste,
    tauxFinal,
    honorairesBaseHT: base,
    missionsComplHT: projet.missionsComplHT || 0,
    honorairesTotauxHT: base + (projet.missionsComplHT || 0),
    sousPlancher: m !== null && m > 0 && m < seuilPlancherActualise(settings),
  }
}

/** phases par défaut d'un nouveau projet (mission de base répartie) */
export function phasesParDefaut(honorairesBaseHT: number, tauxHoraireVente: number): Phase[] {
  const phases: Phase[] = [
    { code: 'DIAG', pctBase: null, montantHT: 0, debut: null, fin: null, heuresPrevues: 0 },
  ]
  for (const r of REPARTITION_PHASES) {
    const montant = honorairesBaseHT * r.pct
    phases.push({
      code: r.code,
      pctBase: r.pct,
      montantHT: Math.round(montant),
      debut: null,
      fin: null,
      heuresPrevues: tauxHoraireVente > 0 ? Math.round(montant / tauxHoraireVente) : 0,
    })
  }
  phases.push({ code: 'MC', pctBase: null, montantHT: 0, debut: null, fin: null, heuresPrevues: 0 })
  return phases
}
