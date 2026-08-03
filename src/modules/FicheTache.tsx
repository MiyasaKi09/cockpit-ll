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
// CE QUI MANQUE, ET POURQUOI C'EST DIT PLUTÔT QUE SIMULÉ
// -------------------------------------------------------
// Le §19.3 prévoit un bouton chrono. Le chrono est B.6 : la table
// `chrono_actif` n'existe pas. Plutôt qu'un bouton qui ne ferait rien —
// ou pire, qui écrirait un temps sans horloge — la fiche dit que le temps
// se saisit ailleurs pour l'instant. Un bouton mort se clique deux fois,
// puis on cesse de faire confiance à l'écran.
// ============================================================

import { useState } from 'react'
import type { TacheInterne } from '../types'
import { useStore } from '../store'
import { Btn, Modal, Select, TextInput, toast } from '../ui'
import { useMoi } from '../moi'
import { fmtDate, fmtHeures, lienGmail } from '../util'
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

export default function FicheTache({ tache, onClose }: { tache: TacheInterne; onClose: () => void }) {
  const { state, update } = useStore()
  const moi = useMoi()
  const [commentaire, setCommentaire] = useState('')
  const [sousTache, setSousTache] = useState('')

  // On relit la tâche dans l'état à chaque rendu : la prop est un
  // instantané, et une modification faite ici doit se voir ici.
  const t = state.taches.find((x) => x.id === tache.id) || tache

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
            {/* Le chrono est B.6. Un bouton mort se clique deux fois, puis
                on cesse de faire confiance à l'écran : on dit plutôt où le
                temps se saisit aujourd'hui. */}
            <div className="muted small" style={{ marginTop: 4 }}>
              Le temps se saisit dans l’onglet Temps. Le chrono par tâche arrive avec le livrable B.6 ;
              d’ici là ce compteur reste à zéro.
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
