// ============================================================
// B.2 — la vue « Mes tâches » (§8.3, critère 6).
//
// Onze filtres, et pas dix : « Proposées par l'IA » est le onzième, celui
// que la version 1 du plan omettait tout en déclarant le critère 6
// satisfait. Il lit les MÊMES tâches que les autres — une tâche proposée
// acceptée en est une comme une autre, sa source dit d'où elle vient.
//
// AUCUNE LOGIQUE ICI. Les filtres, l'ordre et la notion de « tâche
// ouverte » vivent dans `src/taches.ts`, purs et vérifiés en CI sans
// navigateur. Cet écran choisit, affiche et écrit ; il ne décide pas ce
// qu'est une tâche en retard. C'est la règle que `docs/CONTRAT_MODULES.md`
// pose depuis que l'accueil s'était mis à recalculer les factures à
// émettre pour son compte.
// ============================================================

import { useMemo, useState } from 'react'
import type { TacheInterne } from '../types'
import { useStore } from '../store'
import { Btn, Card, DateF, EmptyState, Icon, Page, Table, toast, useToday } from '../ui'
import { useMoi } from '../moi'
import FicheTache from './FicheTache'
import { lienGmail } from '../util'
import {
  type FiltreTaches,
  type FiltreTemporel,
  LIBELLES_PRIORITE_TACHE,
  LIBELLES_SOURCE_TACHE,
  LIBELLES_STATUT_TACHE,
  PRIORITES_TACHE,
  STATUTS_TACHE,
  creerTache,
  estPrioriteTache,
  estStatutTache,
  filtrerTaches,
  trierTaches,
} from '../taches'

/** les cinq filtres temporels du §8.3, dans son ordre */
const TEMPORELS: { cle: FiltreTemporel; label: string }[] = [
  { cle: 'aujourdhui', label: "Aujourd'hui" },
  { cle: 'en_retard', label: 'En retard' },
  { cle: 'cette_semaine', label: 'Cette semaine' },
  { cle: 'a_venir', label: 'À venir' },
  { cle: 'sans_date', label: 'Sans date' },
]

function Puce({
  actif,
  onClick,
  children,
}: {
  actif: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Btn small kind={actif ? 'primary' : 'ghost'} onClick={onClick}>
      {children}
    </Btn>
  )
}

export default function Taches() {
  const { state, update } = useStore()
  const moi = useMoi()
  const today = useToday()

  // Le filtre par personne est celui par DÉFAUT (§8.3) : la vue s'appelle
  // « Mes tâches ». Il reste débrayable — à deux, on regarde souvent ce que
  // fait l'autre.
  const [mien, setMien] = useState(true)
  const [temporel, setTemporel] = useState<FiltreTemporel | null>(null)
  const [projetId, setProjetId] = useState<string | null>(null)
  const [priorite, setPriorite] = useState<string | null>(null)
  const [statut, setStatut] = useState<string | null>(null)
  const [creeesParMoi, setCreeesParMoi] = useState(false)
  const [assigneesParUnTiers, setAssignees] = useState(false)
  const [proposeesParIA, setIA] = useState(false)
  const [inclureClos, setInclureClos] = useState(false)

  const filtre = useMemo<FiltreTaches>(
    () => ({
      personne: mien ? moi.nom : null,
      temporel,
      projetId,
      priorite: estPrioriteTache(priorite) ? priorite : null,
      statut: estStatutTache(statut) ? statut : null,
      creeesParMoi,
      assigneesParUnTiers,
      proposeesParIA,
      inclureClos,
    }),
    [mien, moi.nom, temporel, projetId, priorite, statut, creeesParMoi, assigneesParUnTiers, proposeesParIA, inclureClos],
  )

  const visibles = useMemo(
    () => filtrerTaches(state.taches, filtre, today).slice().sort(trierTaches),
    [state.taches, filtre, today],
  )

  const ajouter = () => {
    const titre = window.prompt('Titre de la tâche :')
    if (!titre || !titre.trim()) return
    const tache = creerTache({
      titre,
      createur: moi.nom,
      responsable: moi.nom,
      projetId,
      source: { type: 'manuelle', id: null },
    })
    update((d) => {
      d.taches.push(tache)
    })
    toast('Tâche créée.')
  }

  const changerStatut = (t: TacheInterne, nouveau: string) => {
    update((d) => {
      const cible = d.taches.find((x) => x.id === t.id)
      if (!cible) return
      cible.statut = nouveau
      cible.majLe = new Date().toISOString()
    })
  }

  // B.8 : la fiche s'ouvre EN MODALE. Quitter la liste pour ouvrir une
  // tâche ferait perdre les filtres à chaque fois, et la revue d'une file
  // de vingt tâches deviendrait insupportable.
  const [ouverte, setOuverte] = useState<string | null>(null)
  const tacheOuverte = ouverte ? state.taches.find((x) => x.id === ouverte) : null

  const projets = state.projets.map((p) => p.id)
  const nbSansFiltre = state.taches.length

  return (
    <Page
      titre="Mes tâches"
      actions={
        <Btn small kind="primary" onClick={ajouter}>
          Nouvelle tâche
        </Btn>
      }
    >
      <Card titre="Filtres">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <Puce actif={mien} onClick={() => setMien(!mien)}>
            {moi.nom ? `Mes tâches (${moi.nom})` : 'Personne non reconnue — tout est affiché'}
          </Puce>
          {TEMPORELS.map((f) => (
            <Puce key={f.cle} actif={temporel === f.cle} onClick={() => setTemporel(temporel === f.cle ? null : f.cle)}>
              {f.label}
            </Puce>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <Puce actif={creeesParMoi} onClick={() => setCreeesParMoi(!creeesParMoi)}>
            Créées par moi
          </Puce>
          <Puce actif={assigneesParUnTiers} onClick={() => setAssignees(!assigneesParUnTiers)}>
            Assignées par un tiers
          </Puce>
          {/* le onzième filtre du §8.3 */}
          <Puce actif={proposeesParIA} onClick={() => setIA(!proposeesParIA)}>
            Proposées par l'IA
          </Puce>
          <Puce actif={inclureClos} onClick={() => setInclureClos(!inclureClos)}>
            Afficher les terminées
          </Puce>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={projetId || ''} onChange={(e) => setProjetId(e.target.value || null)} aria-label="Filtrer par projet">
            <option value="">Tous les projets</option>
            {projets.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select value={priorite || ''} onChange={(e) => setPriorite(e.target.value || null)} aria-label="Filtrer par priorité">
            <option value="">Toutes priorités</option>
            {PRIORITES_TACHE.map((p) => (
              <option key={p} value={p}>
                {LIBELLES_PRIORITE_TACHE[p]}
              </option>
            ))}
          </select>
          <select value={statut || ''} onChange={(e) => setStatut(e.target.value || null)} aria-label="Filtrer par statut">
            <option value="">Tous statuts</option>
            {STATUTS_TACHE.map((s) => (
              <option key={s} value={s}>
                {LIBELLES_STATUT_TACHE[s]}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card titre={`${visibles.length} tâche${visibles.length > 1 ? 's' : ''}`}>
        {visibles.length === 0 ? (
          <EmptyState>
            {nbSansFiltre === 0
              ? 'Aucune tâche pour l’instant. Elles naissent d’un message, d’une note reprise ou d’une saisie.'
              : 'Aucune tâche ne correspond à ces filtres.'}
          </EmptyState>
        ) : (
          <Table
            head={['Tâche', 'Projet', 'Responsable', 'Échéance', 'Priorité', 'Statut', 'Source']}
          >
            {visibles.map((t) => (
              <tr key={t.id}>
                <td>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      setOuverte(t.id)
                    }}
                  >
                    {t.titre}
                  </a>
                  {/* §4.2 : un objet issu d'un e-mail garde le lien vers lui.
                      Sans ce bouton, la source serait une donnée morte. */}
                  {t.source?.type === 'message' && lienGmail(t.source.id) && (
                    <>
                      {' '}
                      <a
                        href={lienGmail(t.source.id) as string}
                        target="_blank"
                        rel="noreferrer"
                        className="badge badge-muted"
                      >
                        <Icon name="mail" size={11} /> Ouvrir
                      </a>
                    </>
                  )}
                </td>
                <td>{t.projetId || <span className="muted">—</span>}</td>
                <td>{t.responsable || <span className="muted">à attribuer</span>}</td>
                <td>
                  {t.echeance ? (
                    <span className={t.echeance.slice(0, 10) < today ? 'badge badge-warn' : ''}>
                      <DateF d={t.echeance} />
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{estPrioriteTache(t.priorite) ? LIBELLES_PRIORITE_TACHE[t.priorite] : t.priorite}</td>
                <td>
                  <select
                    value={t.statut}
                    onChange={(e) => changerStatut(t, e.target.value)}
                    aria-label={`Statut de ${t.titre}`}
                  >
                    {STATUTS_TACHE.map((s) => (
                      <option key={s} value={s}>
                        {LIBELLES_STATUT_TACHE[s]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="small muted">
                  {LIBELLES_SOURCE_TACHE[t.source?.type as keyof typeof LIBELLES_SOURCE_TACHE] || t.source?.type}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {tacheOuverte && <FicheTache tache={tacheOuverte} onClose={() => setOuverte(null)} />}
    </Page>
  )
}
