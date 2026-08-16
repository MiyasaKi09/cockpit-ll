// ============================================================
// Le versant navigateur des détecteurs — livrable A.10.
//
// LES DÉTECTEURS EUX-MÊMES NE SONT PAS ICI. Ils vivent dans
// `supabase/functions/_shared/detecteurs.ts`, sans le moindre import,
// parce qu'ils doivent tourner à l'identique dans trois runtimes : ce
// navigateur, le Deno de l'ingestion, et le Node du test.
//
// POURQUOI CE DÉPLACEMENT
// ------------------------
// Ce module a passé deux mois ici, écrit et testé, avec ZÉRO importateur.
// L'étage déterministe ne coûte ni clé d'API ni réseau — mais il ne
// tournait nulle part, et le seul endroit où il a du sens est le serveur
// d'ingestion, qui voit passer chaque message une fois et une seule. Le
// code n'a pas changé d'une ligne ; il a changé de côté.
//
// Ce fichier ne fait plus que deux choses :
//
//   1. RÉEXPORTER, pour que le navigateur puisse détecter localement le
//      jour où il en aura besoin (la revue, une saisie manuelle) sans
//      qu'une seconde implémentation apparaisse ;
//   2. TENIR LE PONT DE TYPES avec `src/propositions.ts`. Le module
//      partagé redéclare les formes de charge utile — il n'importe rien —
//      et une divergence d'orthographe ne se verrait autrement qu'à
//      l'insertion, côté serveur, sur une détection qu'on ne reverra pas.
//      Les quatre affectations ci-dessous la font échouer à la
//      COMPILATION, donc avant d'être écrite.
// ============================================================

import type {
  ChargeDecision,
  ChargeEcheance,
  ChargeRisque,
  ChargeTache,
  GenreProposition,
  NatureRisque,
} from './propositions'
import type {
  ChargeDecision as ChargeDecisionPartagee,
  ChargeEcheance as ChargeEcheancePartagee,
  ChargeRisque as ChargeRisquePartagee,
  ChargeTache as ChargeTachePartagee,
  GenreProposition as GenrePartage,
  NatureRisque as NaturePartagee,
} from '../supabase/functions/_shared/detecteurs'

export {
  MARQUEURS_ACTION,
  dateDansPhrase,
  detecter,
  empreinteDetection,
} from '../supabase/functions/_shared/detecteurs'
export type { DateDetectee, DetectionBrute } from '../supabase/functions/_shared/detecteurs'

// ------------------------------------------------------------
// Le pont de types — vérifié par le compilateur, pas par un test
// ------------------------------------------------------------
//
// `A extends B ? true : never` échoue à la compilation dès qu'une clé
// diverge, dans un sens comme dans l'autre. C'est plus sûr qu'une
// comparaison de texte : elle passerait au vert sur un champ renommé des
// deux côtés mais devenu incompatible avec la contrainte SQL.

type Identiques<A, B> = A extends B ? (B extends A ? true : never) : never

/* eslint-disable @typescript-eslint/no-unused-vars */
type _PontGenre = Identiques<GenrePartage, GenreProposition>
type _PontNature = Identiques<NaturePartagee, NatureRisque>
type _PontTache = Identiques<ChargeTachePartagee, ChargeTache>
type _PontEcheance = Identiques<ChargeEcheancePartagee, ChargeEcheance>
type _PontDecision = Identiques<ChargeDecisionPartagee, ChargeDecision>
type _PontRisque = Identiques<ChargeRisquePartagee, ChargeRisque>

// Les six ponts doivent valoir `true`. Une divergence les fait valoir
// `never`, et cette ligne cesse de compiler.
const _pont: [_PontGenre, _PontNature, _PontTache, _PontEcheance, _PontDecision, _PontRisque] = [
  true,
  true,
  true,
  true,
  true,
  true,
]
void _pont
