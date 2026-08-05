// 5.18 — les indices BT/TP de l'INSEE : historique COMPLET, récupéré tout
// seul (révise 5.4, dont la décision « geste volontaire » est explicitement
// annulée par l'agence — docs/PLAN_CDC_MAILS_TACHES_TEMPS.md, ligne 5.18).
//
// La source est l'API SDMX publique, sans clé :
// https://bdm.insee.fr/series/sdmx/data/INDEX-BT-TP-DIV-IM-2010 — sans
// paramètre lastNObservations, chaque série rend TOUT son historique (~140
// observations mensuelles, ~1,2 Mo pour les 84 séries : le relais Vercel et
// son plafond de 3 Mo suffisent largement). L'application « pioche comme
// elle veut dedans » : c'est `state.indicesBTP` (5.4) qui reste LE stockage —
// ce module le remplit en profondeur, il ne crée pas de second magasin.
//
// Le CODE d'une série (BT01, TP10d…) se lit dans TITLE_FR, motif « - CODE - ».
// JAMAIS de table idbank→code écrite de mémoire : un idbank « de mémoire »
// testé le 04/08 pointait sur un indice d'ÉLECTRICITÉ. Le titre fait foi, et
// une série sans code BT/TP est ignorée à la fusion — jamais une erreur.
//
// Logique PURE : le parse est fait par expressions régulières (pas de
// DOMParser — testable en node), aucune horloge ni réseau ici — `maintenant`
// et le XML sont des arguments. Le réseau vit dans src/majIndices.ts.

import type { IndiceBTP, MarcheTravaux } from './types'
import { cleSerie, valeursSerie } from './revisionPrix'

/** le flux SDMX complet des 84 séries BT/TP/divers — SANS lastNObservations :
 *  c'est l'absence de ce paramètre qui rend l'historique entier */
export const URL_FLUX_INSEE = 'https://bdm.insee.fr/series/sdmx/data/INDEX-BT-TP-DIV-IM-2010'

const MOIS_VALIDE = /^\d{4}-\d{2}$/

export interface SerieInsee {
  idbank: string
  /** code BT/TP lu dans le titre — null si le titre n'en porte pas
   *  (indice d'électricité, poste matériel… : la série sera ignorée) */
  code: string | null
  titre: string
  /** l'historique complet de la série, mois croissants */
  observations: { mois: string; valeur: number }[]
}

/** valeur d'un attribut XML dans un tag déjà isolé */
function attribut(tag: string, nom: string): string | null {
  const m = new RegExp(`\\b${nom}="([^"]*)"`).exec(tag)
  return m ? m[1] : null
}

/** les cinq entités XML nommées + les formes numériques : le flux INSEE écrit
 *  ses accents en UTF-8 brut, mais un titre peut porter &amp; ou &#xE9; */
function decoderEntites(texte: string): string {
  return texte
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** un code de série BT/TP : BT01, BT16b, TP10f… — la liste réelle porte des
 *  suffixes en lettre, le motif les accepte après passage par `cleSerie` */
const MOTIF_CODE = /^(BT|TP)\d{1,2}[A-Z]?$/

/** le code lu dans TITLE_FR, motif « - CODE - ». Les segments du titre sont
 *  séparés par un tiret — trois variantes coexistent DANS LE FLUX RÉEL :
 *  « - » (BT01), « – » cadratin (TP10d), « − » signe moins (autres flux BDM).
 *  null si aucun segment n'est un code BT/TP : le titre fait foi, on ne
 *  devine pas. */
export function codeDepuisTitre(titre: string): string | null {
  for (const segment of (titre || '').split(/\s+[-–−]\s+/)) {
    const cle = cleSerie(segment)
    if (MOTIF_CODE.test(cle)) return cle
  }
  return null
}

/** parse le XML SDMX par expressions régulières — volontairement : DOMParser
 *  n'existe pas en node, et ce parse doit être testable par le même chargeur
 *  que le reste du dépôt. Toute série ou observation illisible est écartée
 *  sans erreur : un flux public peut évoluer, l'application doit dégrader. */
export function parseSeriesSdmx(xml: string): SerieInsee[] {
  const series: SerieInsee[] = []
  const motifSerie = /<Series\b([^>]*)>([\s\S]*?)<\/Series>/g
  for (let m = motifSerie.exec(xml || ''); m; m = motifSerie.exec(xml || '')) {
    const idbank = attribut(m[1], 'IDBANK')
    const titre = decoderEntites(attribut(m[1], 'TITLE_FR') || '')
    if (!idbank || !titre) continue
    const observations: { mois: string; valeur: number }[] = []
    for (const obs of m[2].match(/<Obs\b[^>]*>/g) || []) {
      const mois = attribut(obs, 'TIME_PERIOD') || ''
      const valeur = Number(attribut(obs, 'OBS_VALUE'))
      // les fréquences non mensuelles et les valeurs manquantes sortent ici ;
      // valeur > 0 : la même règle que `valeursSerie` — 0 n'est pas un indice
      if (!MOIS_VALIDE.test(mois) || !Number.isFinite(valeur) || valeur <= 0) continue
      observations.push({ mois, valeur })
    }
    // le flux publie les mois DÉCROISSANTS ; on rend l'ordre croissant que
    // tout le reste du dépôt (valeursSerie, écrans) attend
    observations.sort((a, b) => a.mois.localeCompare(b.mois))
    series.push({ idbank, code: codeDepuisTitre(titre), titre, observations })
  }
  return series
}

/** les séries que l'application veut garder à jour :
 *  indiceRevision des marchés ∪ codes déjà présents dans indicesBTP ∪ BT01 —
 *  BT01 TOUJOURS : c'est l'index de référence du bâtiment, utile avant même
 *  le premier marché révisable (actualisation d'honoraires, comparaisons) */
export function codesVoulus(
  marches: readonly Pick<MarcheTravaux, 'indiceRevision'>[],
  existants: readonly IndiceBTP[],
): string[] {
  const codes = new Set<string>(['BT01'])
  for (const m of Array.isArray(marches) ? marches : []) {
    const c = cleSerie(m?.indiceRevision)
    if (c) codes.add(c)
  }
  for (const i of Array.isArray(existants) ? existants : []) {
    const c = cleSerie(i?.indice)
    if (c) codes.add(c)
  }
  return [...codes].sort()
}

export interface ResultatFusion {
  indices: IndiceBTP[]
  /** mois AJOUTÉS, par code de série — la matière du toast */
  ajoutes: Record<string, number>
  /** mois dont la valeur INSEE a REMPLACÉ une saisie différente */
  remplaces: Record<string, number>
}

/** fusionne l'historique INSEE dans la collection 5.4 — TOUT l'historique
 *  des séries voulues entre, pas une fenêtre.
 *
 *  Même (code, mois) ⇒ la valeur INSEE écrase la saisie manuelle : l'INSEE
 *  est la source, la saisie n'était que l'attente de la publication. Une
 *  valeur identique ne compte ni ajout ni remplacement — c'est ce qui permet
 *  au démarrage quotidien de dire « rien de nouveau » sans un mot.
 *
 *  Les identifiants des lignes créées sont DÉTERMINISTES (idx-insee-code-mois)
 *  et pas des uid() : la fonction reste pure (aucune horloge), et les deux
 *  postes qui récupèrent le même flux écrivent les mêmes lignes. */
export function fusionnerIndices(
  existants: IndiceBTP[],
  series: SerieInsee[],
  codes: readonly string[],
): ResultatFusion {
  const voulues = new Set((codes || []).map((c) => cleSerie(c)).filter(Boolean))
  const indices = (Array.isArray(existants) ? existants : []).map((i) => ({ ...i }))
  // position de la DERNIÈRE ligne par (code, mois) : c'est elle que
  // `valeursSerie` retient en cas de double saisie (la correction), donc
  // c'est elle que l'INSEE doit écraser pour l'emporter
  const position = new Map<string, number>()
  indices.forEach((i, idx) => position.set(`${cleSerie(i.indice)}|${i.mois}`, idx))
  const ajoutes: Record<string, number> = {}
  const remplaces: Record<string, number> = {}
  for (const serie of Array.isArray(series) ? series : []) {
    const code = cleSerie(serie?.code)
    // code null (électricité, postes matériel…) ou série non voulue :
    // ignorée, jamais une erreur — le flux en porte 84, l'agence en suit 3
    if (!code || !voulues.has(code)) continue
    for (const obs of serie.observations || []) {
      if (!MOIS_VALIDE.test(obs.mois) || !Number.isFinite(obs.valeur) || obs.valeur <= 0) continue
      const clef = `${code}|${obs.mois}`
      const idx = position.get(clef)
      if (idx === undefined) {
        indices.push({ id: `idx-insee-${code.toLowerCase()}-${obs.mois}`, indice: code, mois: obs.mois, valeur: obs.valeur })
        position.set(clef, indices.length - 1)
        ajoutes[code] = (ajoutes[code] || 0) + 1
      } else if (indices[idx].valeur !== obs.valeur) {
        indices[idx] = { ...indices[idx], indice: code, valeur: obs.valeur }
        remplaces[code] = (remplaces[code] || 0) + 1
      }
    }
  }
  return { indices, ajoutes, remplaces }
}

/** le texte du toast de succès — null si rien n'a changé : rien de nouveau
 *  ⇒ PAS UN MOT à l'écran, c'est la règle (d) du livrable */
export function messageMajIndices(
  ajoutes: Record<string, number>,
  remplaces: Record<string, number>,
): string | null {
  const codes = [...new Set([...Object.keys(ajoutes || {}), ...Object.keys(remplaces || {})])].sort()
  const morceaux: string[] = []
  for (const code of codes) {
    const a = ajoutes?.[code] || 0
    const r = remplaces?.[code] || 0
    if (!a && !r) continue
    const details = [
      a ? `${a} mois ajouté${a > 1 ? 's' : ''}` : '',
      r ? `${r} corrigé${r > 1 ? 's' : ''}` : '',
    ].filter(Boolean)
    morceaux.push(`${code} : ${details.join(', ')}`)
  }
  return morceaux.length > 0 ? `Indices INSEE à jour — ${morceaux.join(' · ')}` : null
}

/** au plus une récupération par 24 h */
export const INTERVALLE_MAJ_MS = 24 * 60 * 60 * 1000

/** l'anti-marteau : faut-il rappeler l'INSEE maintenant ? PURE — les deux
 *  horodatages sont des arguments, et c'est elle que le test sabote.
 *  `majLe` absent ou illisible ⇒ oui (on n'a jamais récupéré, ou on ne peut
 *  pas le prouver). Moins de 24 h ⇒ non. Une horodate FUTURE de plus de
 *  24 h ⇒ oui : ce n'est pas « hier », c'est l'horloge déréglée d'un des
 *  deux postes, et la respecter bloquerait la récupération pour toujours. */
export function doitRafraichirIndices(
  majLe: string | null | undefined,
  maintenant: string,
): boolean {
  const t = Date.parse(maintenant || '')
  if (!Number.isFinite(t)) return false
  const precedent = Date.parse(majLe || '')
  if (!Number.isFinite(precedent)) return true
  if (precedent - t > INTERVALLE_MAJ_MS) return true
  return t - precedent >= INTERVALLE_MAJ_MS
}

/** au-delà de cet écart entre le dernier mois publié et le mois courant, la
 *  série est PÉRIMÉE : l'INSEE publie à ~3 mois, un trou plus grand veut
 *  dire que la récupération échoue — et le badge du chantier doit le dire */
export const RETARD_MOIS_MAX = 4

/** écart en mois entre deux 'AAAA-MM' (b − a) — pure, pas de Date */
export function ecartMois(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}

/** la série d'un marché est-elle en retard au mois courant ? Couvre les deux
 *  manques que le badge « indice ? » doit montrer : aucune valeur du tout,
 *  et des valeurs présentes mais périmées (> RETARD_MOIS_MAX mois d'écart). */
export function serieEnRetard(
  indices: IndiceBTP[],
  code: string,
  moisCourant: string,
): { dernierMois: string | null; enRetard: boolean } {
  const valeurs = valeursSerie(indices, code)
  const dernierMois = valeurs.length > 0 ? valeurs[valeurs.length - 1].mois : null
  if (!MOIS_VALIDE.test(moisCourant)) return { dernierMois, enRetard: false }
  return {
    dernierMois,
    enRetard: dernierMois === null || ecartMois(dernierMois, moisCourant) > RETARD_MOIS_MAX,
  }
}
