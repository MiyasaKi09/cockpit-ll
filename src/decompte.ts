// B1 (constat S6) — FIGER LE DÉCOMPTE DE SITUATION À LA VALIDATION.
//
// Le défaut fermé ici n'était pas un calcul faux : c'était un document qui
// changeait tout seul. La facture et le certificat de paiement se
// réimpriment depuis leur COPIE FIGÉE ; le décompte de situation, lui, se
// recalculait à chaque impression depuis l'état courant. L'entreprise
// recevait un décompte le 3 juillet, l'agence saisissait un avenant le 10,
// réimprimait le 12 pour classer — et rangeait dans le dossier un papier qui
// ne portait plus les mêmes chiffres que celui qui avait été envoyé.
//
// Ce module est au décompte ce que `figerCertificat` (src/certificat.ts) est
// au certificat : il PHOTOGRAPHIE, il ne calcule pas. `decompteSituation`
// (src/derive.ts) reste la seule autorité du calcul — elle est IMPORTÉE, et
// rien ici ne refait une de ses lignes. Le bloc rendu contient tout ce que le
// papier imprime, de sorte que le PDF n'ait plus besoin de l'état.
//
// QUAND figer : au moment où la situation passe à « validée », jamais à
// l'impression. Ce qui fait foi est l'état validé, pas l'état de la première
// impression — sinon deux personnes qui impriment le même jour figeraient
// deux vérités différentes pour la même situation.
//
// Logique PURE : aucun store, aucune horloge, aucun réseau. `maintenant` et
// l'auteur sont des paramètres (producteur rejouable), comme la date et
// l'identifiant d'émission le sont pour `figerCertificat`.

import type { AppState, DecompteFige, EnteteDecompte, LignesDecompte, Situation } from './types'
import { decompteSituation, nomProjet, projetById } from './derive'

/** ce qu'un humain a décidé, et quand — les deux seules choses que le calcul
 *  ne peut pas produire lui-même */
export interface ValidationDecompte {
  /** date de la validation (ISO) : c'est elle qui date le figeage */
  maintenant: string
  /** la personne qui valide — `null` si le poste ne sait pas qui est là
   *  (`useMoi()` peut ne désigner personne, et « null n'est pas 0 ») */
  par: string | null
}

/** FIGE le décompte d'une situation au moment de sa validation : copie
 *  profonde de l'en-tête, des lignes et des points à vérifier. Le bloc rendu
 *  ne partage plus rien avec l'état — c'est ce qui rend la réimpression
 *  stable quand le marché, la garantie, la révision ou une situation
 *  antérieure bougent ensuite.
 *
 *  N'écrit rien : l'appelant (l'écran) range le bloc sur la situation dans la
 *  MÊME écriture que le passage à « validée », pour qu'un seul « Annuler »
 *  retire les deux. */
export function figerDecompte(
  state: AppState,
  s: Situation,
  validation: ValidationDecompte,
): DecompteFige {
  // l'autorité du calcul, importée : aucune ligne n'est refaite ici
  const d = decompteSituation(state, s)
  const p = projetById(state, s.projetId)
  const reglages = state.settings

  const entete: EnteteDecompte = {
    agence: {
      nom: reglages.nomAgence,
      // copie du tableau : renommer une associée plus tard ne doit pas
      // réécrire l'en-tête d'un papier déjà remis
      personnes: [...(Array.isArray(reglages.personnes) ? reglages.personnes : [])],
      siret: reglages.siretAgence,
    },
    // le libellé vient de `nomProjet` : une seule façon de nommer un projet
    projetLibelle: nomProjet(state, s.projetId),
    projetAdresse: p?.adresse,
    entreprise: s.entreprise,
    lot: s.lot,
    mois: s.mois,
    // « null n'est pas 0 » : une situation sans numéro le dit
    numero: typeof s.numero === 'number' ? s.numero : null,
    dateReception: s.dateReception,
    // sans marché rattaché, il n'y a pas de montant de marché — pas 0 €
    marcheTotalHT: d.marche ? d.marche.montantInitialHT + d.marche.avenantsHT : null,
    marcheRevisable: Boolean(d.marche?.revision),
  }

  const lignes: LignesDecompte = {
    travauxCumulHT: d.travauxCumulHT,
    revisionHT: d.revisionHT,
    baseHT: d.baseHT,
    tauxRG: d.tauxRG,
    garantie: d.garantie,
    retenueGarantieHT: d.retenueGarantieHT,
    cumulNetHT: d.cumulNetHT,
    precedentNetHT: d.precedentNetHT,
    netAPayerHT: d.netAPayerHT,
    tauxTVA: d.tauxTVA,
    netAPayerTTC: d.netAPayerTTC,
  }

  return {
    entete,
    lignes,
    // les incohérences relevées ce jour-là partent avec le papier : les taire
    // à la réimpression rendrait un document plus propre que l'original
    coherences: [...d.coherences],
    figeLe: validation.maintenant,
    validePar: validation.par,
  }
}

/** empreinte SHA-256 du bloc figé (hex) — '' si l'API crypto manque, comme
 *  `empreinteFigee` (src/facture.ts) : une empreinte inventée ne prouverait
 *  rien. Elle se calcule AVANT l'écriture, pour que le bloc parte complet et
 *  qu'un seul « Annuler » suffise à tout retirer. */
export async function empreinteDecompte(fige: DecompteFige): Promise<string> {
  try {
    const sans = { ...fige, empreinte: undefined }
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(sans)))
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
  } catch {
    return ''
  }
}
