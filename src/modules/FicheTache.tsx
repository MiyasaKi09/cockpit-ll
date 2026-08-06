// ============================================================
// B.8 — la fiche tâche, l'écran que le §19.3 ouvre.
//
// B.1 stocke les dix-huit champs, B.2 en livre une liste filtrée, et rien
// ne les OUVRAIT : les points 2 et 5 du §19.3 restaient ouverts. Cette
// fiche les ferme.
//
// Montée en `Modal`, sur le patron des fiches existantes : on ne quitte
// pas sa liste pour ouvrir une tâche, on la regarde et on revient. Perdre
// ses filtres à chaque ouverture rendrait la revue d'une file de vingt
// tâches insupportable.
//
// Aucune règle ici : l'écart de temps, l'avancement des sous-tâches, la
// résolution des dépendances et les cinq statuts au menu viennent de
// `src/taches.ts`, exercés en CI.
//
// LE BOUTON CHRONO DU §19.3 EXISTE DEPUIS M.3
// ---------------------------------------------
// Il a longtemps manqué et la fiche le DISAIT, plutôt que de montrer un
// bouton mort — qu'on clique deux fois avant de cesser de croire l'écran.
// B.6 a livré la table, M.3 l'horloge et les deux emplacements de barre :
// le démarrage se fait ici, où la cible est déjà connue.
// ============================================================

import { useState } from 'react'
import type { PhaseCode, TacheInterne } from '../types'
import { useStore } from '../store'
import { Btn, Modal, Select, TextInput, toast } from '../ui'
import { useMoi } from '../moi'
import { fmtDate, fmtHeures, lienGmail } from '../util'
import { LIBELLES_PHASES, PHASES_ORDRE } from '../miqcp'
import { messageArretHonnete } from './ChronoBarre'
import { type ChronoActif, arreterChrono, basculerChrono, chronoDe, poserChrono } from '../chrono'
import { type Pointage, tempsParTache } from '../pointages'
import {
  LIBELLES_PRIORITE_TACHE,
  LIBELLES_SOURCE_TACHE,
  LIBELLES_STATUT_TACHE,
  PRIORITES_TACHE,
  STATUTS_TACHE_AU_MENU,
  avancementSousTaches,
  creerCommentaire,
  creerSousTache,
  dependancesDe,
  ecartDeTemps,
  estOuverte,
  estPrioriteTache,
} from '../taches'

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--ink-3)',
          marginBottom: 4,
        }}
      >
        {titre}
      </div>
      {children}
    </div>
  )
}

/**
 * Le geste chrono d'une tâche — monté UNE fois, consommé deux fois : la
 * fiche, et chaque ligne de « Mes tâches » (audit d'usage, action 30).
 *
 * Deux copies de cette glu auraient divergé comme le reste : celle de la
 * liste aurait oublié la bascule, et deux chronos auraient compté la même
 * heure. La règle elle-même n'est pas ici — elle est dans `src/chrono.ts`,
 * pure et testée ; ce hook n'est que le fil entre elle et le magasin.
 */
export function useChronoTache() {
  const { state, update } = useStore()
  const moi = useMoi()
  const qui = moi.nom || ''
  const courant = chronoDe(state.chronos as ChronoActif[], qui) as ChronoActif | null

  const demarrer = (t: TacheInterne) => {
    if (!qui) {
      toast('Indiquez d’abord qui vous êtes : un temps sans personne ne se rattache à rien.', { tone: 'warn' })
      return
    }
    const maintenant = new Date().toISOString()
    const { chrono, arret } = basculerChrono(courant, qui, {
      projetId: t.projetId ?? null,
      phase: t.phase ?? null,
      tacheId: t.id,
      libelle: t.titre,
    }, maintenant)
    update((d) => {
      if (arret?.pointage) d.pointages = [...(d.pointages || []), arret.pointage]
      d.chronos = poserChrono(d.chronos as ChronoActif[], chrono, qui)
    })
    // La bascule est silencieuse si on ne la dit pas : quelqu'un qui démarre
    // une seconde tâche doit savoir que la première vient d'être enregistrée
    // — et jusqu'où elle l'a été (`messageArretHonnete`).
    toast(
      arret
        ? `${messageArretHonnete(arret.message, !!arret.pointage)} Chrono démarré sur « ${t.titre} ».`
        : `Chrono démarré sur « ${t.titre} ».`,
      { tone: 'ok' },
    )
  }

  const arreter = () => {
    if (!courant) return
    const { pointage, message } = arreterChrono(courant, new Date().toISOString())
    update((d) => {
      d.chronos = poserChrono(d.chronos as ChronoActif[], null, qui)
      if (pointage) d.pointages = [...(d.pointages || []), pointage]
    })
    toast(messageArretHonnete(message, !!pointage), { tone: pointage ? 'ok' : 'warn' })
  }

  return {
    qui,
    courant,
    /** vrai si le chrono qui tourne est celui de CETTE tâche */
    enCoursSur: (tacheId: string) => courant?.tacheId === tacheId,
    demarrer,
    arreter,
  }
}

export default function FicheTache({ tache, onClose }: { tache: TacheInterne; onClose: () => void }) {
  const { state, update } = useStore()
  const moi = useMoi()
  const [commentaire, setCommentaire] = useState('')
  const [sousTache, setSousTache] = useState('')

  // On relit la tâche dans l'état à chaque rendu : la prop est un
  // instantané, et une modification faite ici doit se voir ici.
  const t = state.taches.find((x) => x.id === tache.id) || tache

  // --- M.3 : le chrono de cette tâche, par la glu partagée -----------------
  const chrono = useChronoTache()
  const enCoursIci = chrono.enCoursSur(t.id)
  const demarrerIci = () => chrono.demarrer(t)
  const arreterIci = () => chrono.arreter()

  const modifier = (fn: (cible: TacheInterne) => void) => {
    update((d) => {
      const cible = d.taches.find((x) => x.id === t.id)
      if (!cible) return
      fn(cible)
      cible.majLe = new Date().toISOString()
    })
  }

  const ecart = ecartDeTemps(t)
  const avancement = avancementSousTaches(t)
  const { resolues, introuvables } = dependancesDe(t, state.taches)
  const equipe = state.settings.equipe.map((p) => p.nom)

  /** les phases du projet, dans l'ordre MIQCP — pas le référentiel entier :
   *  une phase que le projet ne porte pas n'a pas d'heures à recevoir */
  const phasesDuProjet = (projetId: string | null | undefined): PhaseCode[] => {
    const p = projetId ? state.projets.find((x) => x.id === projetId) : null
    if (!p) return []
    return p.phases
      .map((ph) => ph.code)
      .sort((a, b) => PHASES_ORDRE.indexOf(a) - PHASES_ORDRE.indexOf(b))
  }
  const phasesDisponibles = phasesDuProjet(t.projetId)

  /** temps chronométré sur cette tâche — lu par l'autorité de la notion
   *  (`tempsParTache`), pas recompté ici : la projection vers
   *  `tempsEnregistre` (B.9) n'est pas branchée, le chiffre n'a donc encore
   *  aucun autre chemin pour se montrer. */
  const heuresChronometrees = tempsParTache(state.pointages as Pointage[]).get(t.id) ?? 0

  return (
    <Modal titre={t.titre} onClose={onClose} large>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          <Bloc titre="Description">
            <textarea
              className="input"
              rows={3}
              value={t.description}
              placeholder="De quoi s’agit-il ?"
              onChange={(e) => {
                const v = e.target.value
                modifier((c) => {
                  c.description = v
                })
              }}
            />
          </Bloc>

          <Bloc titre={`Sous-tâches${avancement ? ` — ${avancement.faites} / ${avancement.total}` : ''}`}>
            {(t.sousTaches || []).map((s) => (
              <label key={s.id} className="small" style={{ display: 'block', padding: '2px 0' }}>
                <input
                  type="checkbox"
                  checked={s.faite}
                  onChange={() =>
                    modifier((c) => {
                      const cible = c.sousTaches.find((x) => x.id === s.id)
                      if (cible) cible.faite = !cible.faite
                    })
                  }
                />{' '}
                <span style={{ textDecoration: s.faite ? 'line-through' : undefined }}>{s.titre}</span>
              </label>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <TextInput
                value={sousTache}
                onChange={setSousTache}
                placeholder="Ajouter une étape…"
                ariaLabel="Nouvelle sous-tâche"
                onCommit={(v) => {
                  if (!v.trim()) return
                  modifier((c) => {
                    c.sousTaches.push(creerSousTache(v))
                  })
                  setSousTache('')
                }}
              />
            </div>
          </Bloc>

          <Bloc titre="Commentaires">
            {(t.commentaires || []).length === 0 && <div className="muted small">Aucun commentaire.</div>}
            {(t.commentaires || []).map((c) => (
              <div key={c.id} className="small" style={{ padding: '4px 0', borderBottom: '1px solid var(--trait)' }}>
                <span className="muted">
                  {fmtDate(c.date.slice(0, 10))}
                  {c.auteur ? ` · ${c.auteur}` : ''}
                </span>
                <div>{c.texte}</div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <TextInput
                value={commentaire}
                onChange={setCommentaire}
                placeholder="Ajouter un commentaire…"
                ariaLabel="Nouveau commentaire"
              />
              <Btn
                small
                kind="primary"
                onClick={() => {
                  if (!commentaire.trim()) return
                  // Horodaté et attribué (§19.3 pt 5). Sans auteur, un
                  // commentaire ne dit pas qui doute ni qui a tranché.
                  modifier((c) => {
                    c.commentaires.push(creerCommentaire(commentaire, moi.nom))
                  })
                  setCommentaire('')
                  toast('Commentaire ajouté.')
                }}
              >
                Ajouter
              </Btn>
            </div>
          </Bloc>

          <Bloc titre="Dépendances">
            {resolues.length === 0 && introuvables.length === 0 && (
              <div className="muted small">Aucune. La tâche peut démarrer.</div>
            )}
            {resolues.map((d) => (
              <div key={d.id} className="small">
                <span className={estOuverte(d) ? 'badge badge-warn' : 'badge badge-muted'}>
                  {LIBELLES_STATUT_TACHE[d.statut as keyof typeof LIBELLES_STATUT_TACHE] || d.statut}
                </span>{' '}
                {d.titre}
              </div>
            ))}
            {/* Une dépendance disparue ne doit pas s'effacer en silence :
                on ne présume pas qu'un objet supprimé était terminé. */}
            {introuvables.map((id) => (
              <div key={id} className="small">
                <span className="badge badge-warn">introuvable</span> {id}
              </div>
            ))}
          </Bloc>
        </div>

        <div style={{ minWidth: 0 }}>
          <Bloc titre="Statut">
            <Select
              value={t.statut}
              onChange={(v) =>
                modifier((c) => {
                  c.statut = v
                })
              }
              options={[
                // Le statut courant reste choisissable même hors menu :
                // sinon ouvrir une tâche « à qualifier » la reclasserait
                // au premier rendu, sans que personne l'ait demandé.
                ...(STATUTS_TACHE_AU_MENU.includes(t.statut as never)
                  ? []
                  : [{ value: t.statut, label: LIBELLES_STATUT_TACHE[t.statut as keyof typeof LIBELLES_STATUT_TACHE] || t.statut }]),
                ...STATUTS_TACHE_AU_MENU.map((s) => ({ value: s, label: LIBELLES_STATUT_TACHE[s] })),
              ]}
            />
          </Bloc>

          <Bloc titre="Responsable">
            <Select
              value={t.responsable || ''}
              onChange={(v) =>
                modifier((c) => {
                  c.responsable = v || null
                })
              }
              options={[{ value: '', label: 'À attribuer' }, ...equipe.map((n) => ({ value: n, label: n }))]}
            />
          </Bloc>

          {/* LE RATTACHEMENT (audit d'usage, action 31).
              `projeterVersTemps` ignore tout pointage sans projet ET sans
              phase : sa clé les contient tous les deux. Une tâche née d'un
              message ou d'une proposition arrive sans projet ; sans ces deux
              sélecteurs elle n'en a JAMAIS, et le temps chronométré dessus
              n'atteindra pas la marge — même une fois la projection branchée.
              Le chrono lit `t.projetId` et `t.phase` au démarrage : les poser
              ici, c'est les poser sur tous les pointages à venir. */}
          <Bloc titre="Projet">
            <Select
              value={t.projetId || ''}
              onChange={(v) =>
                modifier((c) => {
                  c.projetId = v || null
                  // changer de projet en gardant une phase que le nouveau ne
                  // porte pas produirait un rattachement que rien ne refuse
                  // et que la projection écarte en silence
                  if (!v || !phasesDuProjet(v).includes(c.phase as PhaseCode)) c.phase = null
                })
              }
              options={[
                { value: '', label: 'Aucun projet' },
                ...state.projets.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
              ]}
            />
          </Bloc>

          <Bloc titre="Phase">
            <Select
              value={t.phase || ''}
              onChange={(v) =>
                modifier((c) => {
                  c.phase = (v || null) as PhaseCode | null
                })
              }
              disabled={!t.projetId}
              options={[
                { value: '', label: t.projetId ? 'Phase non précisée' : 'choisissez un projet d’abord' },
                ...phasesDisponibles.map((code) => ({ value: code, label: `${code} — ${LIBELLES_PHASES[code]}` })),
              ]}
            />
            {t.projetId && phasesDisponibles.length === 0 && (
              <div className="muted small" style={{ marginTop: 4 }}>
                Ce projet n’a aucune phase — elles se créent dans sa fiche.
              </div>
            )}
            {t.projetId && phasesDisponibles.length > 0 && !t.phase && (
              <div className="muted small" style={{ marginTop: 4 }}>
                Sans phase, le temps chronométré ici ne rejoindra pas la feuille : la grille est
                tenue par projet <em>et</em> phase.
              </div>
            )}
          </Bloc>

          <Bloc titre="Priorité">
            <Select
              value={estPrioriteTache(t.priorite) ? t.priorite : 'normale'}
              onChange={(v) =>
                modifier((c) => {
                  c.priorite = v
                })
              }
              options={PRIORITES_TACHE.map((p) => ({ value: p, label: LIBELLES_PRIORITE_TACHE[p] }))}
            />
          </Bloc>

          <Bloc titre="Échéance">
            <input
              className="input"
              type="date"
              value={t.echeance ? t.echeance.slice(0, 10) : ''}
              onChange={(e) => {
                const v = e.target.value || null
                modifier((c) => {
                  c.echeance = v
                })
              }}
            />
          </Bloc>

          <Bloc titre="Temps">
            <div className="small">
              Estimé :{' '}
              <input
                className="input"
                type="number"
                min={0}
                step={0.25}
                style={{ width: 90 }}
                value={t.tempsEstime ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value)
                  modifier((c) => {
                    c.tempsEstime = v
                  })
                }}
              />{' '}
              h
            </div>
            <div className="small" style={{ marginTop: 4 }}>
              Enregistré : {fmtHeures(t.tempsEnregistre || 0)}
              {ecart !== null && (
                <>
                  {' '}
                  <span className={ecart > 0 ? 'badge badge-warn' : 'badge badge-muted'}>
                    {ecart > 0 ? '+' : ''}
                    {fmtHeures(ecart)}
                  </span>
                </>
              )}
            </div>
            {/* « Enregistré : 0 h » sous un bouton qu'on vient d'arrêter est
                le mensonge que l'audit pointe (T4) : `tempsEnregistre` est une
                projection que personne n'a encore branchée. On lit donc le
                temps chronométré là où il est — par `tempsParTache`, qui EST
                l'autorité de cette notion — et on dit qu'il n'est pas compté.
                Cette ligne disparaît au branchement de B.9. */}
            {heuresChronometrees > 0 && (
              <div className="muted small" style={{ marginTop: 2 }}>
                {fmtHeures(heuresChronometrees)} chronométrées sur cette tâche, pas encore comptées
                ci-dessus ni dans la marge — le détail est sous « Ma semaine » dans{' '}
                <a href="#/temps">Temps passé</a>.
              </div>
            )}
            {/* M.3 — démarrage en un appui. La bascule est dans `chrono.ts` :
                démarrer alors qu'un chrono tourne arrête le premier et
                enregistre son pointage, en un seul geste. Sans cette règle,
                il faudrait se souvenir d'arrêter avant de démarrer — on
                oubliera, et deux chronos compteraient la même heure. */}
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {enCoursIci ? (
                <Btn small onClick={arreterIci}>Arrêter le chrono</Btn>
              ) : (
                <Btn small kind="primary" onClick={demarrerIci}>Démarrer le chrono</Btn>
              )}
              <span className="muted small">
                Le temps saisi à la semaine reste dans l’onglet Temps.
              </span>
            </div>
          </Bloc>

          <Bloc titre="Source">
            <div className="small">
              {LIBELLES_SOURCE_TACHE[t.source?.type as keyof typeof LIBELLES_SOURCE_TACHE] || t.source?.type}
              {/* §4.2 : l'objet issu d'un e-mail garde le lien vers lui */}
              {lienGmail(t.source?.id) && (
                <>
                  {' · '}
                  <a href={lienGmail(t.source.id) as string} target="_blank" rel="noreferrer">
                    ouvrir dans Gmail
                  </a>
                </>
              )}
            </div>
            <div className="muted small" style={{ marginTop: 4 }}>
              Créée par {t.createur || 'inconnu'} le {fmtDate(t.creeLe.slice(0, 10))}
              {t.projetId ? ` · ${t.projetId}` : ''}
            </div>
          </Bloc>
        </div>
      </div>
    </Modal>
  )
}
