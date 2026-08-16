// ============================================================
// M.3 — le chrono au doigt (§9.2, §9.3, §17, critère 7).
//
// UN composant, DEUX emplacements : dans la `.topbar` au téléphone, en
// tête de la barre latérale au poste. Le §3.5 note qu'il n'y a pas de
// barre supérieure au bureau — d'où les deux, et non un seul.
//
// Deux composants auraient divergé. Celui du téléphone aurait reçu la
// correction, celui du bureau l'aurait attendue six mois, et le temps
// compté n'aurait plus été le même selon l'écran. Le montage est donc
// dupliqué ; le composant ne l'est pas.
//
// TOUTE LA LOGIQUE EST DANS `src/chrono.ts`
// -------------------------------------------
// Ici on n'a que l'horloge qui rafraîchit et les deux boutons. Le calcul
// des durées, la bascule et le seuil de la minute sont purs et testés :
// un défaut de comptage du temps ne se voit pas à l'œil, il se voit sur la
// facture trois mois plus tard.
// ============================================================

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { toast } from '../ui'
import { useMoi } from '../moi'
import {
  type ChronoActif,
  arreterChrono,
  chronoDe,
  formaterDuree,
  libelleCourt,
  poserChrono,
  secondesEcoulees,
} from '../chrono'

/**
 * L'HONNÊTETÉ D'ARRÊT, seconde époque (B.5).
 *
 * La première époque de cette fonction était un pansement d'attente : la
 * projection n'avait aucun appelant, et le toast avouait que « 1 h 20
 * enregistrées » n'était pas comptée. Depuis le branchement
 * (`reconcilierTempsChrono`, appelé par le store), un pointage qui porte
 * projet ET phase entre tout seul dans « Ma semaine » et dans la marge :
 * la phrase de `arreterChrono` est alors toute la vérité, et le message
 * n'ajoute rien — une confirmation de plus à chaque arrêt serait du bruit.
 *
 * Restent deux cas où la phrase seule laisserait croire plus qu'elle ne dit :
 *   - rien d'enregistré (chrono sous la minute) : aucune promesse ajoutée,
 *     on ne renvoie pas vers une ligne qui n'existe pas ;
 *   - un pointage SANS projet ou SANS phase : il est conservé (et compte sur
 *     sa tâche s'il en porte une), mais la clé de la feuille exige les deux —
 *     le dire ici, avec le geste qui répare (le rattacher sous « Ma
 *     semaine »), plutôt que de laisser la marge se tromper en silence.
 *
 * Le message vit ICI, et la fiche tâche l'importe : deux formulations pour le
 * même événement feraient dire au même arrêt deux choses différentes selon
 * l'endroit d'où on l'a cliqué.
 */
export function messageArretHonnete(
  message: string,
  pointage: { projetId: string | null; phase: string | null } | null | undefined,
): string {
  if (!pointage) return message
  if (pointage.projetId && pointage.phase) return message
  return `${message} Sans projet ou sans phase, pas compté dans la feuille — à rattacher sous « Ma semaine ».`
}

/** Rafraîchit chaque seconde — et seulement quand un chrono tourne. */
function useSeconde(actif: boolean): number {
  const [tic, setTic] = useState(0)
  useEffect(() => {
    if (!actif) return
    const t = setInterval(() => setTic((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [actif])
  return tic
}

export default function ChronoBarre({ emplacement }: { emplacement: 'topbar' | 'laterale' }) {
  const { state, update } = useStore()
  const moi = useMoi().nom || ''
  const chrono = chronoDe(state.chronos as ChronoActif[], moi) as ChronoActif | null
  useSeconde(chrono !== null)

  // Rien en cours : pas de bouton mort. Un bouton « démarrer » sans cible
  // demanderait aussitôt sur quoi, ce qui n'est pas un geste de barre.
  // Le démarrage se fait depuis une tâche, un projet ou la fiche — là où
  // la cible est déjà connue.
  if (!chrono) return null

  const secondes = secondesEcoulees(chrono, new Date().toISOString())
  const nom = libelleCourt(chrono.libelle || chrono.projetId || 'sans objet', emplacement === 'topbar' ? 16 : 22)

  const arreter = () => {
    const maintenant = new Date().toISOString()
    const { pointage, message } = arreterChrono(chrono, maintenant)
    update((d) => {
      d.chronos = poserChrono(d.chronos as ChronoActif[], null, moi)
      if (pointage) d.pointages = [...(d.pointages || []), pointage]
    })
    toast(messageArretHonnete(message, pointage), { tone: pointage ? 'ok' : 'warn' })
  }

  return (
    <div className={`chrono-barre chrono-${emplacement}`} role="status" aria-live="off">
      <span className="chrono-pastille" aria-hidden="true" />
      <span className="chrono-duree" title={`Chrono en cours depuis ${formaterDuree(secondes)}`}>
        {formaterDuree(secondes)}
      </span>
      <span className="chrono-nom" title={chrono.libelle || chrono.projetId || ''}>
        {nom}
      </span>
      <button
        className="chrono-stop"
        onClick={arreter}
        title="Arrêter le chrono et enregistrer le temps"
        aria-label={`Arrêter le chrono — ${formaterDuree(secondes)} sur ${nom}`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <rect x="1" y="1" width="12" height="12" rx="2" fill="currentColor" />
        </svg>
      </button>
    </div>
  )
}
