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
import {
  Btn,
  Card,
  DateF,
  DateInput,
  EmptyState,
  Field,
  Icon,
  Modal,
  Page,
  Select,
  Table,
  TextInput,
  navigate,
  toast,
  useRoute,
  useToday,
} from '../ui'
import { useMoi } from '../moi'
import FicheTache, { useChronoTache } from './FicheTache'
import { lienGmail } from '../util'
import {
  type FiltreTaches,
  type FiltreTemporel,
  LIBELLES_PRIORITE_TACHE,
  LIBELLES_SOURCE_TACHE,
  LIBELLES_STATUT_TACHE,
  PRIORITES_TACHE,
  STATUTS_TACHE,
  STATUTS_TACHE_AU_MENU,
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
  title,
}: {
  actif: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <Btn small kind={actif ? 'primary' : 'ghost'} onClick={onClick} title={title}>
      {children}
    </Btn>
  )
}

/**
 * Le mini-formulaire de création (audit d'usage, « en passant » du §3.1).
 *
 * Il remplace la boîte de saisie grise du navigateur : sans nom d'écran, sans
 * projet, sans échéance — donc une tâche qui naissait nue et qu'il fallait
 * rouvrir pour la compléter. Trois champs suffisent, et le troisième
 * (l'échéance) est celui qui décide si la tâche entrera un jour dans une file
 * du matin. La vérification de l'audit se grepe : plus aucune boîte de ce
 * genre dans `src/modules/`.
 */
function ModalNouvelleTache({
  projetParDefaut,
  onClose,
}: {
  projetParDefaut: string | null
  onClose: () => void
}) {
  const { state, update, replace } = useStore()
  const moi = useMoi()
  const [titre, setTitre] = useState('')
  const [projetId, setProjetId] = useState(projetParDefaut || '')
  const [echeance, setEcheance] = useState<string | null>(null)

  const creer = () => {
    if (!titre.trim()) return
    const snap = state
    const tache = creerTache({
      titre,
      createur: moi.nom,
      // Responsable = moi : une tâche qu'on saisit est une tâche qu'on prend.
      // Sans identité reconnue on n'attribue à PERSONNE plutôt qu'au premier
      // de la liste — et depuis l'action 29 une tâche sans responsable reste
      // visible des deux côtés au lieu de disparaître.
      responsable: moi.nom,
      projetId: projetId || null,
      echeance,
      source: { type: 'manuelle', id: null },
    })
    update((d) => {
      d.taches.push(tache)
    })
    onClose()
    toast(moi.nom ? `Tâche créée pour ${moi.nom}.` : 'Tâche créée — à attribuer.', {
      undo: () => replace(snap),
    })
  }

  return (
    <Modal titre="Nouvelle tâche" onClose={onClose}>
      <Field label="Titre" hint="Une action, pas un sujet : c’est ce qu’on lira dans la liste.">
        <TextInput
          value={titre}
          onChange={setTitre}
          placeholder="Relancer le BET sur la ventilation"
          ariaLabel="Titre de la tâche"
        />
      </Field>
      <Field
        label="Projet"
        hint="Facultatif — mais sans projet, le temps passé dessus ne rejoindra aucune marge."
      >
        <Select
          value={projetId}
          onChange={setProjetId}
          options={[
            { value: '', label: 'Aucun projet' },
            ...state.projets.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
          ]}
        />
      </Field>
      <Field
        label="Échéance"
        hint="Sans date, la tâche n’est ni en retard ni pour aujourd’hui : elle attend dans « Sans date »."
      >
        <DateInput value={echeance} onChange={setEcheance} />
      </Field>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={creer} disabled={!titre.trim()}>
          Créer la tâche
        </Btn>
      </div>
    </Modal>
  )
}

export default function Taches() {
  const { state, update, replace } = useStore()
  const moi = useMoi()
  const today = useToday()
  const route = useRoute()
  // le chrono d'une ligne : MÊME glu que la fiche tâche (action 30)
  const chrono = useChronoTache()

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

  const [creation, setCreation] = useState(false)

  const changerStatut = (t: TacheInterne, nouveau: string) => {
    const snap = state
    update((d) => {
      const cible = d.taches.find((x) => x.id === t.id)
      if (!cible) return
      cible.statut = nouveau
      cible.majLe = new Date().toISOString()
    })
    // Passer une tâche à « terminée » la fait SORTIR de la liste : sans ce
    // toast, un mauvais choix dans le menu n'a plus de retour visible du tout.
    toast(
      `« ${t.titre} » → ${LIBELLES_STATUT_TACHE[nouveau as keyof typeof LIBELLES_STATUT_TACHE] || nouveau}.`,
      { undo: () => replace(snap) },
    )
  }

  // B.8 : la fiche s'ouvre EN MODALE. Quitter la liste pour ouvrir une
  // tâche ferait perdre les filtres à chaque fois, et la revue d'une file
  // de vingt tâches deviendrait insupportable.
  const [ouverte, setOuverte] = useState<string | null>(null)
  // Route profonde `#/taches/<id>` : la recherche « / » indexe les tâches mais
  // n'avait aucune adresse où les déposer — le résultat atterrissait en haut de
  // la liste, à re-chercher à l'œil (T6, parcours 9). La modale l'emporte sur
  // l'écran : ouvrir une tâche ne fait pas perdre les filtres de la liste.
  const idRoute = route[1] || null
  const idOuvert = ouverte ?? idRoute
  const tacheOuverte = idOuvert ? state.taches.find((x) => x.id === idOuvert) : null
  const fermerFiche = () => {
    setOuverte(null)
    // revenir à la liste nue : sans cela, l'adresse garderait la tâche fermée
    // et un rechargement la rouvrirait
    if (idRoute) navigate('/taches')
  }

  const projets = state.projets.map((p) => p.id)
  const nbSansFiltre = state.taches.length

  return (
    <Page
      titre="Mes tâches"
      actions={
        <Btn small kind="primary" onClick={() => setCreation(true)}>
          Nouvelle tâche
        </Btn>
      }
    >
      <Card titre="Filtres">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <Puce
            actif={mien}
            onClick={() => setMien(!mien)}
            title={
              moi.nom
                ? 'Vos tâches ET celles que personne n’a encore prises : à deux, « à attribuer » est l’affaire de tout le monde.'
                : undefined
            }
          >
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
            head={['Tâche', 'Projet', 'Responsable', 'Échéance', 'Priorité', 'Statut', 'Source', 'Chrono']}
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
                    {/* Les CINQ statuts qui se posent à la main, comme dans la
                        fiche : neuf entrées se lisent moins bien, et quatre
                        d'entre elles ne se choisissent pas ici (« à qualifier »
                        vient d'une proposition non revue, « planifiée » du
                        planning). Le statut courant reste dans la liste même
                        hors menu, sinon ouvrir l'écran reclasserait la tâche. */}
                    {!(estStatutTache(t.statut) && STATUTS_TACHE_AU_MENU.includes(t.statut)) && (
                      <option value={t.statut}>
                        {LIBELLES_STATUT_TACHE[t.statut as keyof typeof LIBELLES_STATUT_TACHE] || t.statut}
                      </option>
                    )}
                    {STATUTS_TACHE_AU_MENU.map((s) => (
                      <option key={s} value={s}>
                        {LIBELLES_STATUT_TACHE[s]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="small muted">
                  {LIBELLES_SOURCE_TACHE[t.source?.type as keyof typeof LIBELLES_SOURCE_TACHE] || t.source?.type}
                </td>
                {/* M.3 était livré à moitié : la bascule un-geste existait dans
                    `chrono.ts` et seule la fiche l'offrait — il fallait ouvrir
                    une modale pour lancer un chrono sur la tâche qu'on a sous
                    les yeux. Démarrer ici arrête et enregistre le chrono en
                    cours : c'est la même bascule, jamais deux compteurs. */}
                <td>
                  {chrono.enCoursSur(t.id) ? (
                    <Btn small onClick={() => chrono.arreter()} title="Arrêter le chrono en cours">
                      ■ Arrêter
                    </Btn>
                  ) : (
                    <Btn
                      small
                      kind="ghost"
                      onClick={() => chrono.demarrer(t)}
                      title={
                        chrono.courant
                          ? `Démarrer le chrono sur « ${t.titre} » — le chrono en cours sera arrêté et enregistré`
                          : `Démarrer le chrono sur « ${t.titre} »`
                      }
                    >
                      ▶
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {tacheOuverte && <FicheTache tache={tacheOuverte} onClose={fermerFiche} />}
      {creation && <ModalNouvelleTache projetParDefaut={projetId} onClose={() => setCreation(false)} />}
    </Page>
  )
}
