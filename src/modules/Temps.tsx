// ============================================================
// Temps.tsx — LE tableau de temps interactif, façon fiche de
// temps d'agence : par personne, lignes = projets-phases puis
// catégories hors projet, colonnes = semaines. Chaque cellule
// s'édite en place et s'enregistre TOUTE SEULE (plus de bouton).
// ============================================================

import { useState } from 'react'
import type { PhaseCode, PointageLocal, Projet } from '../types'
import { useStore } from '../store'
import { CATEGORIES_HORS_PROJET } from '../types'
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  NumInput,
  Page,
  Select,
  Table,
  Tabs,
  confirmer,
  toast,
  useToday,
} from '../ui'
import { addDays, fmtDate, fmtHeures, mondayOf, todayISO, uid } from '../util'
import { LIBELLES_ETAT, TONS_ETAT, bilanSemaines, etatSemaine, projetsDeLaSemaine, totalSemaine } from '../temps'
import { syncActif } from '../sync'
import { useMoi } from '../moi'
import { LIBELLES_PHASES, PHASES_ORDRE } from '../miqcp'
import {
  STATUTS_ACTIFS,
  capacitePersonneSemaine,
  equipeDuProjet,
  heuresAbsenceSemaine,
  heuresPrevues,
  heuresReelles,
} from '../derive'
import { estLigneChrono, facturableParDefaut, heuresDepuisMinutes, lundiDe } from '../pointages'

const NB_SEMAINES = 6

// ---------- helpers ----------

interface Couple {
  projetId: string
  phase: PhaseCode
}

function indexPhase(code: PhaseCode): number {
  const i = PHASES_ORDRE.indexOf(code)
  return i === -1 ? PHASES_ORDRE.length : i
}

function triCouples(a: Couple, b: Couple): number {
  return a.projetId.localeCompare(b.projetId) || indexPhase(a.phase) - indexPhase(b.phase)
}

/** phase proposée par défaut : celle qui encadre la date du jour, sinon la 1re dotée */
function phaseParDefaut(p: Projet | undefined, today: string): PhaseCode {
  if (!p) return 'ESQ'
  const enCours = p.phases.find((ph) => ph.debut && ph.fin && ph.debut <= today && today <= ph.fin)
  if (enCours) return enCours.code
  const premiere = [...p.phases]
    .sort((a, b) => indexPhase(a.code) - indexPhase(b.code))
    .find((ph) => ph.montantHT > 0 || ph.heuresPrevues > 0)
  return premiere?.code ?? p.phases[0]?.code ?? 'ESQ'
}

/** phases d'un projet actives pendant la fenêtre affichée [debut, fin] —
 *  ce sont les lignes prêtes d'office pour un projet affecté ; ainsi la
 *  phase suit la période consultée, elle ne reste pas figée sur aujourd'hui */
function phasesFenetre(p: Projet, debut: string, fin: string): PhaseCode[] {
  const actives = p.phases
    .filter((ph) => ph.debut && ph.fin && ph.debut <= fin && ph.fin >= debut)
    .sort((a, b) => indexPhase(a.code) - indexPhase(b.code))
    .map((ph) => ph.code)
  // aucune phase datée sur la fenêtre → repli sur la phase par défaut du milieu de fenêtre
  if (actives.length === 0) return [phaseParDefaut(p, debut)]
  return actives
}

function tonePourRatio(ratio: number): 'ok' | 'warn' | 'danger' {
  if (ratio >= 1) return 'danger'
  if (ratio >= 0.8) return 'warn'
  return 'ok'
}

/** en-tête court d'une colonne semaine : « 22/06 » */
function enTeteSemaine(lundi: string): string {
  return `${lundi.slice(8, 10)}/${lundi.slice(5, 7)}`
}

// ---------- tableau interactif d'une personne ----------

function TableauPersonne({
  personne,
  semaines,
  today,
}: {
  personne: string
  semaines: string[]
  today: string
}) {
  const { state, update, replace } = useStore()
  const actifs = state.projets.filter((p) => STATUTS_ACTIFS.includes(p.statut))
  const [ajoutees, setAjoutees] = useState<Couple[]>([])
  const [projetSel, setProjetSel] = useState(actifs[0]?.id ?? '')
  const [phaseSel, setPhaseSel] = useState<PhaseCode>(() => phaseParDefaut(actifs[0], today))

  // projets affectés à la personne (fiche projet ou chips ci-dessous)
  const affectes = actifs.filter((p) => equipeDuProjet(p).includes(personne))

  // lignes affichées : projets affectés (ligne prête d'office) + couples
  // pointés dans la fenêtre + ajouts manuels
  const couples: Couple[] = []
  const vu = new Set<string>()
  const pousser = (c: Couple) => {
    const cle = `${c.projetId}|${c.phase}`
    if (!vu.has(cle)) {
      vu.add(cle)
      couples.push(c)
    }
  }
  const finFenetre = addDays(semaines[semaines.length - 1], 6)
  for (const p of affectes) {
    for (const phase of phasesFenetre(p, semaines[0], finFenetre)) pousser({ projetId: p.id, phase })
  }
  for (const t of state.temps) {
    if (t.personne === personne && semaines.includes(t.semaine)) pousser({ projetId: t.projetId, phase: t.phase })
  }
  ajoutees.forEach(pousser)
  couples.sort(triCouples)

  const affecter = (projetId: string) =>
    update((d) => {
      const p = d.projets.find((x) => x.id === projetId)
      if (!p) return
      p.equipeProjet = [...new Set([...(p.equipeProjet || []), personne])]
    })

  const desaffecter = async (projetId: string) => {
    const snap = state
    if (!(await confirmer({ message: `Retirer ${personne} du projet ${projetId} ? (les heures déjà pointées restent)`, danger: true, confirmerLabel: 'Retirer' }))) return
    update((d) => {
      const p = d.projets.find((x) => x.id === projetId)
      if (!p) return
      p.equipeProjet = (p.equipeProjet || []).filter((n) => n !== personne)
    })
    toast('Ligne retirée.', { undo: () => replace(snap) })
  }

  // Les lignes PROJETÉES (`tp-…`, chrono) restent hors des cellules : la
  // réconciliation du store les réécrirait au geste suivant, et l'édition
  // disparaîtrait sans erreur. Elles s'affichent en lecture seule plus bas,
  // sur le modèle des heures pointées depuis les dossiers.
  const heuresDe = (semaine: string, c: Couple): number | null => {
    const e = state.temps.find(
      (t) =>
        !estLigneChrono(t.id) &&
        t.semaine === semaine && t.personne === personne && t.projetId === c.projetId && t.phase === c.phase,
    )
    return e ? e.heures : null
  }

  const poser = (semaine: string, c: Couple, v: number | null) =>
    update((d) => {
      const i = d.temps.findIndex(
        (t) =>
          !estLigneChrono(t.id) &&
          t.semaine === semaine && t.personne === personne && t.projetId === c.projetId && t.phase === c.phase,
      )
      if (v === null || v <= 0) {
        if (i >= 0) d.temps.splice(i, 1)
        return
      }
      if (i >= 0) d.temps[i].heures = v
      else d.temps.push({ id: uid('tps'), semaine, personne, projetId: c.projetId, phase: c.phase, heures: v })
    })

  // les pointages RATTACHÉS À UN DOSSIER (consultationId) ne passent pas par
  // ces cellules : ils se saisissent depuis le dossier et s'affichent en
  // lecture seule plus bas — sinon la cellule les écraserait
  const hpDe = (semaine: string, categorie: string): number | null => {
    const e = state.tempsHorsProjet.find(
      (t) => t.semaine === semaine && t.personne === personne && t.categorie === categorie && !t.consultationId,
    )
    return e ? e.heures : null
  }

  const poserHP = (semaine: string, categorie: string, v: number | null) =>
    update((d) => {
      const i = d.tempsHorsProjet.findIndex(
        (t) => t.semaine === semaine && t.personne === personne && t.categorie === categorie && !t.consultationId,
      )
      if (v === null || v <= 0) {
        if (i >= 0) d.tempsHorsProjet.splice(i, 1)
        return
      }
      if (i >= 0) d.tempsHorsProjet[i].heures = v
      else d.tempsHorsProjet.push({ id: uid('thp'), semaine, personne, categorie, heures: v })
    })

  const ajouterLigne = () => {
    if (!projetSel) return
    if (couples.some((c) => c.projetId === projetSel && c.phase === phaseSel)) {
      toast('Cette ligne (projet + phase) est déjà dans le tableau.', { tone: 'warn' })
      return
    }
    setAjoutees((ls) => [...ls, { projetId: projetSel, phase: phaseSel }])
  }

  // Le même calcul que la fiche du téléphone, parce que c'est la même
  // fonction. Deux totaux divergents sur une feuille de temps, et c'est la
  // feuille entière qu'on cesse de croire.
  const totalColonne = (semaine: string): number => totalSemaine(state, personne, semaine)

  const totalLigne = (c: Couple): number =>
    semaines.reduce((s, sem) => s + (heuresDe(sem, c) ?? 0), 0)
  const totalLigneHP = (cat: string): number =>
    semaines.reduce((s, sem) => s + (hpDe(sem, cat) ?? 0), 0)

  // Capacité CONGÉS DÉDUITS, semaine par semaine (audit d'usage, action 28).
  // Une semaine à deux jours de congé n'a jamais 35 h à remplir : comparer à
  // un forfait fixe fait crier la colonne pour rien, et un indicateur qui
  // crie pour rien finit ignoré. La capacité a un propriétaire —
  // `capacitePersonneSemaine` — et les trois vues du temps le lisent.
  const capaciteDe = (semaine: string) => capacitePersonneSemaine(state, personne, semaine)
  const projetCourant = actifs.find((p) => p.id === projetSel)
  const codesPhases = projetCourant
    ? [...projetCourant.phases.map((ph) => ph.code)].sort((a, b) => indexPhase(a) - indexPhase(b))
    : PHASES_ORDRE

  const semaineCourante = mondayOf(today)

  const nonAffectes = actifs.filter((p) => !affectes.some((a) => a.id === p.id))

  return (
    <Card titre={personne}>
      <div className="toolbar" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="muted small">Affecté·e à :</span>
        {affectes.length === 0 && <span className="muted small">aucun projet — cochez-les ici ou dans la fiche projet</span>}
        {affectes.map((p) => (
          <span key={p.id} className="badge badge-info" title={p.nom}>
            {p.id}{' '}
            <button
              onClick={() => desaffecter(p.id)}
              title={`Retirer ${personne} de ${p.id}`}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontWeight: 700 }}
            >
              ✕
            </button>
          </span>
        ))}
        {nonAffectes.length > 0 && (
          <Select
            value=""
            onChange={(v) => v && affecter(v)}
            options={[{ value: '', label: '+ affecter à…' }, ...nonAffectes.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` }))]}
            style={{ maxWidth: 220 }}
          />
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table table-compact">
          <thead>
            <tr>
              <th className="col-figee temps-libelle">Projet · phase</th>
              {semaines.map((s) => (
                <th key={s} className="right" title={`semaine du ${fmtDate(s)}`}>
                  {enTeteSemaine(s)}
                  {s === semaineCourante && ' •'}
                </th>
              ))}
              <th className="right">Total</th>
            </tr>
          </thead>
          <tbody>
            {couples.length === 0 && (
              <tr>
                <td colSpan={semaines.length + 2}>
                  <span className="muted small">Aucune ligne — ajoutez un couple projet + phase ci-dessous.</span>
                </td>
              </tr>
            )}
            {couples.map((c) => {
              const p = state.projets.find((x) => x.id === c.projetId)
              return (
                <tr key={`${c.projetId}|${c.phase}`}>
                  <td className="col-figee">
                    <a href={`#/projets/${c.projetId}`}>{c.projetId}</a> ·{' '}
                    {/* l'infobulle appartient au CODE, pas au nom du projet :
                        c'est le code qu'on ne sait pas lire */}
                    <span title={LIBELLES_PHASES[c.phase]}>{c.phase}</span>
                    <div className="muted small">
                      {p ? (p.nom.length > 30 ? p.nom.slice(0, 30) + '…' : p.nom) : 'projet inconnu'}
                    </div>
                  </td>
                  {semaines.map((s) => (
                    <td key={s} className="right">
                      <NumInput
                        value={heuresDe(s, c)}
                        onChange={(v) => poser(s, c, v)}
                        style={{ width: 58 }}
                        ariaLabel={`Heures de ${personne} — ${c.projetId} ${c.phase} — semaine du ${fmtDate(s)}`}
                      />
                    </td>
                  ))}
                  <td className="right num">
                    <strong>{fmtHeures(totalLigne(c))}</strong>
                  </td>
                </tr>
              )
            })}
            <tr>
              <td colSpan={semaines.length + 2} style={{ background: 'var(--line)', padding: '3px 8px' }}>
                <span className="muted small" style={{ fontWeight: 700 }}>Hors projet (non facturable)</span>
              </td>
            </tr>
            {CATEGORIES_HORS_PROJET.map((cat) => (
              <tr key={cat}>
                <td className="small col-figee">{cat}</td>
                {semaines.map((s) => (
                  <td key={s} className="right">
                    <NumInput
                      value={hpDe(s, cat)}
                      onChange={(v) => poserHP(s, cat, v)}
                      style={{ width: 58 }}
                      ariaLabel={`Heures de ${personne} — ${cat} (hors projet) — semaine du ${fmtDate(s)}`}
                    />
                  </td>
                ))}
                <td className="right num">{fmtHeures(totalLigneHP(cat))}</td>
              </tr>
            ))}
            {(() => {
              const lies = state.tempsHorsProjet.filter((t) => t.personne === personne && t.consultationId)
              if (!semaines.some((sem) => lies.some((t) => t.semaine === sem))) return null
              return (
                <tr>
                  <td className="small col-figee">
                    Prospection / AO — dossiers
                    <div className="muted small">pointé depuis les dossiers</div>
                  </td>
                  {semaines.map((sem) => {
                    const h = lies.filter((t) => t.semaine === sem).reduce((x, t) => x + t.heures, 0)
                    return (
                      <td key={sem} className="right num muted">
                        {h > 0 ? fmtHeures(h) : '·'}
                      </td>
                    )
                  })}
                  <td className="right num muted">
                    {fmtHeures(lies.filter((t) => semaines.includes(t.semaine)).reduce((x, t) => x + t.heures, 0))}
                  </td>
                </tr>
              )
            })()}
            {(() => {
              // B.5 — les lignes projetées du chrono, hors cellules mais pas
              // hors totaux : sans cette ligne, les colonnes sommeraient plus
              // que les cases visibles, et deux chiffres différents pour la
              // même semaine font perdre la confiance dans la feuille entière.
              const chronos = state.temps.filter((t) => estLigneChrono(t.id) && t.personne === personne)
              if (!semaines.some((sem) => chronos.some((t) => t.semaine === sem))) return null
              return (
                <tr>
                  <td className="small col-figee">
                    Au chrono
                    <div className="muted small">compté dans les totaux — se corrige sous « Ma semaine »</div>
                  </td>
                  {semaines.map((sem) => {
                    const h = chronos.filter((t) => t.semaine === sem).reduce((x, t) => x + t.heures, 0)
                    return (
                      <td key={sem} className="right num muted">
                        {h > 0 ? fmtHeures(h) : '·'}
                      </td>
                    )
                  })}
                  <td className="right num muted">
                    {fmtHeures(chronos.filter((t) => semaines.includes(t.semaine)).reduce((x, t) => x + t.heures, 0))}
                  </td>
                </tr>
              )
            })()}
            <tr style={{ fontWeight: 650 }}>
              <td className="col-figee">Total semaine</td>
              {semaines.map((s) => {
                const t = totalColonne(s)
                const cap = capaciteDe(s)
                const absence = heuresAbsenceSemaine(state, personne, s)
                // Le verdict vient de `etatSemaine`, comme le badge de « Ma
                // semaine » : une seconde règle de couleur avait déjà produit
                // une pastille verte portant le mot « incomplet ».
                const etat = etatSemaine(t, cap)
                const couleur =
                  etat === 'vide' ? 'var(--ink-3)' : etat === 'complete' ? 'var(--ok)' : 'var(--warn)'
                return (
                  <td
                    key={s}
                    className="right num"
                    style={{ color: couleur }}
                    title={`capacité ${fmtHeures(cap)}${absence > 0 ? ` — ${fmtHeures(absence)} de congés déduites` : ''}`}
                  >
                    {t > 0 ? fmtHeures(t) : '·'}
                  </td>
                )
              })}
              <td className="right num">{fmtHeures(semaines.reduce((s, sem) => s + totalColonne(sem), 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {actifs.length === 0 ? (
        <p className="muted small" style={{ marginTop: 10 }}>
          Aucun projet actif (statut « Signé » ou « En cours ») — passez un projet dans un statut
          actif pour pointer des heures.
        </p>
      ) : (
        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <Select
            value={projetSel}
            onChange={(v) => {
              setProjetSel(v)
              setPhaseSel(phaseParDefaut(actifs.find((x) => x.id === v), today))
            }}
            options={actifs.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` }))}
            style={{ maxWidth: 240 }}
          />
          <Select
            value={phaseSel}
            onChange={(v) => setPhaseSel(v as PhaseCode)}
            options={codesPhases.map((c) => ({ value: c, label: `${c} — ${LIBELLES_PHASES[c]}` }))}
            style={{ maxWidth: 220 }}
          />
          <Btn small onClick={ajouterLigne}>+ Ajouter la ligne</Btn>
          <span className="muted small" style={{ alignSelf: 'center' }}>
            La saisie s'enregistre toute seule — vider une cellule l'efface.
          </span>
        </div>
      )}
    </Card>
  )
}

// ---------- barre de consommation ----------

function BarreConso({ ratio }: { ratio: number }) {
  const tone = tonePourRatio(ratio)
  const couleur = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--ok)'
  return (
    <div
      style={{ background: 'var(--line)', borderRadius: 99, height: 8, width: 140, overflow: 'hidden' }}
      title={`${Math.round(ratio * 100)} % du budget d'heures`}
    >
      <div style={{ width: `${Math.min(100, Math.round(ratio * 100))}%`, background: couleur, height: '100%' }} />
    </div>
  )
}

// ---------- récap dérives par projet (cumul toutes semaines) ----------

export function RecapDerives() {
  const { state } = useStore()
  const actifs = state.projets.filter((p) => STATUTS_ACTIFS.includes(p.statut))

  return (
    <Card titre="Dérives par projet (heures cumulées)">
      {actifs.length === 0 ? (
        <EmptyState>Aucun projet actif — rien à suivre pour le moment.</EmptyState>
      ) : (
        <Table compact head={['Projet', 'Pointé', 'Prévu', 'Consommation', '']}>
          {actifs.map((p) => {
            const prevues = heuresPrevues(p)
            const reelles = heuresReelles(state, p.id)
            if (prevues <= 0) {
              return (
                <tr key={p.id}>
                  <td>
                    <a href={`#/projets/${p.id}`}>{p.id}</a>{' '}
                    <span className="muted small">{p.nom}</span>
                  </td>
                  <td className="right num">{fmtHeures(reelles)}</td>
                  <td className="right muted">—</td>
                  <td className="muted small">—</td>
                  <td>
                    <Badge tone="muted">pas de budget d’heures</Badge>
                  </td>
                </tr>
              )
            }
            const ratio = reelles / prevues
            const tone = tonePourRatio(ratio)
            const pct = Math.round(ratio * 100)
            return (
              <tr key={p.id}>
                <td>
                  <a href={`#/projets/${p.id}`}>{p.id}</a>{' '}
                  <span className="muted small">{p.nom}</span>
                </td>
                <td className="right num">{fmtHeures(reelles)}</td>
                <td className="right num">{fmtHeures(prevues)}</td>
                <td>
                  <BarreConso ratio={ratio} />
                </td>
                <td>
                  <Badge tone={tone}>
                    {pct} %{tone === 'danger' ? ' — budget dépassé' : tone === 'warn' ? ' — à surveiller' : ''}
                  </Badge>
                </td>
              </tr>
            )
          })}
        </Table>
      )}
      <p className="muted small" style={{ marginTop: 10 }}>
        Heures pointées toutes semaines confondues vs heures prévues des phases — même logique que
        l’alerte « dérive d’heures » du fil d’urgences.
      </p>
    </Card>
  )
}

// ---------- saisie principale : UNE personne, UNE semaine, une liste ----------

/** la tâche réelle — mes heures de la semaine, projet par projet.
 *  Vue principale sur tous les écrans (audit simplification) ; la grille
 *  6 semaines vit dans l'onglet Historique. */
function SaisieSemaine({ today }: { today: string }) {
  const { state, update, replace } = useStore()
  const moi = useMoi()
  const personnes = state.settings.personnes
  // « Ma semaine » s'ouvre sur MA semaine (audit d'usage, action 27).
  // `personnes[0]` affichait la feuille de l'autre associée une fois sur
  // deux : on lisait ses heures en croyant lire les siennes, et on les
  // corrigeait. Le choix explicite l'emporte dès qu'il est fait ; sans
  // identité reconnue, on retombe sur la première personne — les deux
  // boutons segmentés disent laquelle, l'écran n'affirme rien en silence.
  const [choixPersonne, setChoixPersonne] = useState('')
  const personne =
    choixPersonne || (moi.nom && personnes.includes(moi.nom) ? moi.nom : personnes[0] || '')
  const setPersonne = setChoixPersonne
  const [semaine, setSemaine] = useState(() => mondayOf(today))
  const [ajoutes, setAjoutes] = useState<Couple[]>([])
  const [activitesVisibles, setActivitesVisibles] = useState<string[]>([])
  const [chronosDeplies, setChronosDeplies] = useState(false)
  const semaineCourante = mondayOf(today)

  const actifs = state.projets.filter((p) => STATUTS_ACTIFS.includes(p.statut))
  const affectes = actifs.filter((p) => equipeDuProjet(p).includes(personne))

  const couples: Couple[] = []
  const vu = new Set<string>()
  const pousser = (c: Couple) => {
    const cle = `${c.projetId}|${c.phase}`
    if (!vu.has(cle)) {
      vu.add(cle)
      couples.push(c)
    }
  }
  for (const p of affectes) {
    for (const phase of phasesFenetre(p, semaine, addDays(semaine, 6))) pousser({ projetId: p.id, phase })
  }
  for (const t of state.temps) {
    if (t.personne === personne && t.semaine === semaine) pousser({ projetId: t.projetId, phase: t.phase })
  }
  ajoutes.forEach(pousser)
  // les lignes déjà pointées cette semaine passent devant : c'est le
  // travail réellement actif, le reste attend en dessous
  const aDesHeures = (c: Couple) =>
    state.temps.some(
      (t) => t.semaine === semaine && t.personne === personne && t.projetId === c.projetId && t.phase === c.phase,
    )
  couples.sort((a, b) => Number(aDesHeures(b)) - Number(aDesHeures(a)) || triCouples(a, b))

  // même règle que la grille : une cellule n'édite JAMAIS une ligne projetée
  // (`tp-…`) — la réconciliation du store la réécrirait au geste suivant. Le
  // chrono s'affiche à part : « + X h » sur la ligne, et le détail plus bas.
  const heuresDe = (c: Couple): number | null => {
    const e = state.temps.find(
      (t) =>
        !estLigneChrono(t.id) &&
        t.semaine === semaine && t.personne === personne && t.projetId === c.projetId && t.phase === c.phase,
    )
    return e ? e.heures : null
  }
  const chronoDe = (c: Couple): number =>
    state.temps
      .filter(
        (t) =>
          estLigneChrono(t.id) &&
          t.semaine === semaine && t.personne === personne && t.projetId === c.projetId && t.phase === c.phase,
      )
      .reduce((s, t) => s + t.heures, 0)
  const poser = (c: Couple, v: number | null) =>
    update((d) => {
      const i = d.temps.findIndex(
        (t) =>
          !estLigneChrono(t.id) &&
          t.semaine === semaine && t.personne === personne && t.projetId === c.projetId && t.phase === c.phase,
      )
      if (v === null || v <= 0) {
        if (i >= 0) d.temps.splice(i, 1)
        return
      }
      if (i >= 0) d.temps[i].heures = v
      else d.temps.push({ id: uid('tps'), semaine, personne, projetId: c.projetId, phase: c.phase, heures: v })
    })

  // idem grille : les pointages rattachés à un dossier restent hors de la
  // cellule éditable (lecture seule plus bas)
  const hpDe = (cat: string): number | null => {
    const e = state.tempsHorsProjet.find(
      (t) => t.semaine === semaine && t.personne === personne && t.categorie === cat && !t.consultationId,
    )
    return e ? e.heures : null
  }
  const poserHP = (cat: string, v: number | null) =>
    update((d) => {
      const i = d.tempsHorsProjet.findIndex(
        (t) => t.semaine === semaine && t.personne === personne && t.categorie === cat && !t.consultationId,
      )
      if (v === null || v <= 0) {
        if (i >= 0) d.tempsHorsProjet.splice(i, 1)
        return
      }
      if (i >= 0) d.tempsHorsProjet[i].heures = v
      else d.tempsHorsProjet.push({ id: uid('thp'), semaine, personne, categorie: cat, heures: v })
    })

  /** reprend la semaine précédente SANS écraser : seules les cases vides
   *  de la semaine courante sont remplies (préparé avant la mutation) */
  const copierSemainePrecedente = () => {
    const avant = addDays(semaine, -7)
    // jamais les lignes projetées : copier du chrono en saisie manuelle le
    // compterait deux fois — une fois recopié, une fois reprojeté
    const temps = state.temps.filter(
      (t) => !estLigneChrono(t.id) && t.personne === personne && t.semaine === avant,
    )
    // les heures pointées depuis un dossier appartiennent à LEUR semaine :
    // la copie ne reprend que la saisie libre
    const hp = state.tempsHorsProjet.filter((t) => t.personne === personne && t.semaine === avant && !t.consultationId)
    if (temps.length === 0 && hp.length === 0) {
      toast('Rien à copier : la semaine précédente est vide.', { tone: 'warn' })
      return
    }
    const snap = state
    const nouveaux = temps
      .filter(
        (t) =>
          // une CASE est occupée par une saisie, pas par une ligne projetée :
          // le chrono de la semaine courante ne bloque pas la reprise
          !state.temps.some(
            (x) =>
              !estLigneChrono(x.id) &&
              x.semaine === semaine && x.personne === personne && x.projetId === t.projetId && x.phase === t.phase,
          ),
      )
      .map((t) => ({ id: uid('tps'), semaine, personne, projetId: t.projetId, phase: t.phase, heures: t.heures }))
    const nouveauxHP = hp
      .filter(
        (t) =>
          !state.tempsHorsProjet.some(
            (x) => x.semaine === semaine && x.personne === personne && x.categorie === t.categorie,
          ),
      )
      .map((t) => ({ id: uid('thp'), semaine, personne, categorie: t.categorie, heures: t.heures }))
    update((d) => {
      d.temps.push(...nouveaux)
      d.tempsHorsProjet.push(...nouveauxHP)
    })
    toast(
      `${nouveaux.length + nouveauxHP.length} ligne(s) reprise(s) de la semaine précédente — les cases déjà remplies sont conservées.`,
      { tone: 'ok', undo: () => replace(snap) },
    )
  }

  const total = totalSemaine(state, personne, semaine)
  // Congés DÉDUITS (audit d'usage, action 28) : comparé à 35 h fixes, une
  // semaine avec deux jours de congé restait « incomplet » à jamais, quoi
  // qu'on saisisse. Le badge est l'indicateur principal de cet écran ; un
  // indicateur qui ment à chaque congé cesse d'être regardé, et avec lui la
  // feuille de temps. `capacitePersonneSemaine` fait autorité.
  const capacite = capacitePersonneSemaine(state, personne, semaine)
  const absence = heuresAbsenceSemaine(state, personne, semaine)
  const etat = etatSemaine(total, capacite)
  const projetsHorsListe = actifs.filter((p) => !couples.some((c) => c.projetId === p.id))

  // --- le chrono, compté et corrigeable (B.5) -----------------------------
  //
  // Depuis le branchement de la projection (`reconcilierTempsChrono`, store),
  // un chrono arrêté qui porte projet et phase entre TOUT SEUL dans le total
  // ci-dessus et dans la marge — plus rien à reporter à la main. Ce bloc
  // garde les gestes qui restent humains : corriger une durée, supprimer un
  // chrono oublié, et RATTACHER un pointage sans projet ou sans phase — le
  // seul qui ne peut pas entrer dans la feuille, sa clé les exige tous deux.
  //
  // Un chrono EN COURS n'est pas compté : ce n'est pas du temps passé, c'est
  // du temps en train de passer — la même règle que `projeterVersTemps`.
  const chronosSemaine = (state.pointages || []).filter(
    (p) => p.personne === personne && p.fin && lundiDe(p.debut) === semaine,
  )
  // On additionne des entiers et on ne divise qu'à la fin : c'est la règle de
  // `pointages.ts`, et `heuresDepuisMinutes` est le seul endroit qui divise.
  const heuresChrono = heuresDepuisMinutes(
    chronosSemaine.reduce((s, p) => s + (p.minutes || 0), 0),
  )
  const chronosOrphelins = chronosSemaine.filter((p) => !p.projetId || !p.phase)
  const heuresChronoOrphelines = heuresDepuisMinutes(
    chronosOrphelins.reduce((s, p) => s + (p.minutes || 0), 0),
  )
  // ce que la projection a réellement posé dans la grille cette semaine — lu
  // dans `state.temps` comme le total lui-même, pour dire « dont » sans
  // recompter par un second chemin
  const heuresChronoComptees = state.temps
    .filter((t) => estLigneChrono(t.id) && t.personne === personne && t.semaine === semaine)
    .reduce((s, t) => s + t.heures, 0)

  const corrigerDuree = (id: string, heures: number | null) =>
    update((d) => {
      const cible = (d.pointages || []).find((p) => p.id === id)
      if (!cible || heures === null || heures <= 0) return
      cible.minutes = Math.max(1, Math.round(heures * 60))
      cible.majLe = new Date().toISOString()
    })

  const supprimerPointage = (p: PointageLocal) => {
    const snap = state
    update((d) => {
      d.pointages = (d.pointages || []).filter((x) => x.id !== p.id)
    })
    toast(`Chrono supprimé (${fmtHeures(heuresDepuisMinutes(p.minutes || 0))}).`, {
      tone: 'warn',
      undo: () => replace(snap),
    })
  }

  /** les phases du projet, dans l'ordre MIQCP — pas le référentiel entier :
   *  une phase que le projet ne porte pas ne peut pas recevoir d'heures */
  const phasesDe = (projetId: string): PhaseCode[] => {
    const p = state.projets.find((x) => x.id === projetId)
    return [...(p?.phases || [])].map((ph) => ph.code).sort((a, b) => indexPhase(a) - indexPhase(b))
  }

  /** pose projet puis phase sur un pointage qui n'en a pas : dès que les deux
   *  y sont, la projection le compte — dans le total et la marge, au geste
   *  même. C'est le rattachement, pas un report : la durée ne bouge pas. */
  const rattacherPointage = (p: PointageLocal, projetId: string | null, phase: PhaseCode | null) => {
    const snap = state
    update((d) => {
      const cible = (d.pointages || []).find((x) => x.id === p.id)
      if (!cible) return
      // B.7 : un facturable resté au défaut suit la règle vers son nouveau
      // projet ; un facturable corrigé par un humain ne se réécrit pas
      if (cible.facturable === facturableParDefaut(cible.projetId ?? null)) {
        cible.facturable = facturableParDefaut(projetId)
      }
      cible.projetId = projetId
      cible.phase = phase
      cible.majLe = new Date().toISOString()
    })
    if (projetId && phase) {
      toast(`Chrono rattaché à ${projetId} · ${phase} — compté dans le total et la marge.`, {
        tone: 'ok',
        undo: () => replace(snap),
      })
    }
  }

  /** ce que le chrono visait — projet · phase, tâche, ou le libellé saisi */
  const cibleDuPointage = (p: PointageLocal): string => {
    if (p.projetId) return `${p.projetId}${p.phase ? ` · ${p.phase}` : ' · phase ?'}`
    const tache = p.tacheId ? state.taches.find((t) => t.id === p.tacheId) : null
    if (tache) return tache.titre
    return 'sans projet'
  }

  const ligneStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 0',
    borderBottom: '1px solid var(--line)',
  }

  return (
    <Card titre="Mes heures de la semaine">
      <div className="toolbar">
        <span className="segmente" role="group" aria-label="Personne">
          {personnes.map((p) => (
            <button key={p} aria-pressed={personne === p} onClick={() => setPersonne(p)}>
              {p}
            </button>
          ))}
        </span>
      </div>
      <div className="toolbar">
        <Btn small onClick={() => setSemaine(addDays(semaine, -7))} title="Semaine précédente">‹</Btn>
        <Btn small onClick={() => setSemaine(addDays(semaine, 7))} title="Semaine suivante">›</Btn>
        <strong className="small">semaine du {fmtDate(semaine)}</strong>
        {semaine === semaineCourante ? (
          <Badge tone="info">en cours</Badge>
        ) : (
          <Btn small kind="ghost" onClick={() => setSemaine(semaineCourante)}>aujourd'hui</Btn>
        )}
      </div>

      <p className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 8px' }}>
        <strong>{fmtHeures(total)} comptées</strong>
        {heuresChronoComptees > 0 && (
          <span className="muted" title="Projection des chronos arrêtés portant projet et phase — le détail se corrige dans le bloc chrono ci-dessous">
            dont {fmtHeures(heuresChronoComptees)} au chrono
          </span>
        )}
        {capacite > 0 ? (
          <>
            <span
              className="muted"
              title={
                absence > 0
                  ? `${fmtHeures(absence)} de congés déduites de la capacité de la semaine`
                  : `${fmtHeures(state.settings.heuresParJour)} par jour, 5 jours`
              }
            >
              sur {fmtHeures(capacite)} {absence > 0 ? '(congés déduits)' : 'théoriques'}
            </span>
            <Badge tone={TONS_ETAT[etat]}>{LIBELLES_ETAT[etat]}</Badge>
          </>
        ) : (
          // Semaine entièrement absente : aucune heure n'est attendue, donc
          // aucun verdict n'a de sens. Le badge se tait plutôt que de réclamer.
          <Badge tone="muted">semaine d’absence — rien n’est attendu</Badge>
        )}
        <IndicateurEnregistrement />
        <span className="spacer" />
        <Btn small onClick={copierSemainePrecedente}>Copier la semaine précédente</Btn>
      </p>

      {chronosSemaine.length > 0 && (
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: '8px 10px',
            marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge tone={heuresChronoOrphelines > 0 ? 'warn' : 'info'}>chrono</Badge>
            <strong className="small">
              Au chrono cette semaine : {fmtHeures(heuresChrono)} — compté dans le total
              {heuresChronoOrphelines > 0 && ` sauf ${fmtHeures(heuresChronoOrphelines)}`}
            </strong>
            <span className="spacer" />
            <Btn small kind="ghost" onClick={() => setChronosDeplies(!chronosDeplies)}>
              {chronosDeplies ? 'Replier' : `Voir le détail (${chronosSemaine.length})`}
            </Btn>
          </div>
          {heuresChronoOrphelines > 0 && (
            <div className="muted small" style={{ marginTop: 4 }}>
              Un pointage sans projet ou sans phase ne peut pas entrer dans la feuille — sa clé les
              exige tous les deux. Rattachez-le dans le détail ci-dessous : il compte aussitôt, dans
              le total comme dans la marge.
            </div>
          )}
          {chronosDeplies && (
            <div style={{ marginTop: 8 }}>
              <Table compact head={['Jour', 'Sur quoi', 'Durée', '']}>
                {chronosSemaine.map((p) => (
                  <tr key={p.id}>
                    <td className="small">
                      {fmtDate(p.debut.slice(0, 10))}{' '}
                      <span className="muted">
                        {new Date(p.debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>
                    <td className="small">
                      {cibleDuPointage(p)}
                      {p.commentaire && <div className="muted small">{p.commentaire}</div>}
                      {(!p.projetId || !p.phase) && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                          <Select
                            value={p.projetId || ''}
                            onChange={(v) => rattacherPointage(p, v || null, null)}
                            options={[
                              { value: '', label: 'Projet ?' },
                              ...actifs.map((x) => ({ value: x.id, label: `${x.id} — ${x.nom}` })),
                            ]}
                            style={{ maxWidth: 190 }}
                          />
                          {p.projetId && (
                            <Select
                              value={p.phase || ''}
                              onChange={(v) => rattacherPointage(p, p.projetId ?? null, (v || null) as PhaseCode | null)}
                              options={[
                                { value: '', label: 'Phase ?' },
                                ...phasesDe(p.projetId).map((c) => ({ value: c, label: `${c} — ${LIBELLES_PHASES[c]}` })),
                              ]}
                              style={{ maxWidth: 190 }}
                            />
                          )}
                        </div>
                      )}
                    </td>
                    <td className="right">
                      <NumInput
                        value={heuresDepuisMinutes(p.minutes || 0)}
                        onChange={(v) => corrigerDuree(p.id, v)}
                        style={{ width: 70 }}
                        ariaLabel={`Durée du chrono du ${fmtDate(p.debut.slice(0, 10))} sur ${cibleDuPointage(p)}`}
                      />
                    </td>
                    <td className="right">
                      <Btn
                        small
                        kind="ghost"
                        title="Supprimer ce chrono (un chrono oublié, une fausse manœuvre)"
                        onClick={() => supprimerPointage(p)}
                      >
                        ✕
                      </Btn>
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </div>
      )}

      {couples.length === 0 ? (
        <EmptyState>
          Aucun projet affecté à {personne || '—'}. L’affectation vit à deux endroits : les puces
          « Affecté·e à » en tête du tableau de l’onglet <strong>Historique</strong>, et l’équipe de
          la <a href="#/projets">fiche projet</a>.
          {projetsHorsListe.length > 0
            ? ' Pour une semaine isolée, « + Ajouter un projet » ci-dessous suffit — sans rien affecter.'
            : ' Aucun projet actif pour l’instant : seul un projet « Signé » ou « En cours » reçoit des heures.'}
        </EmptyState>
      ) : (
        couples.map((c) => {
          const p = state.projets.find((x) => x.id === c.projetId)
          return (
            <div key={`${c.projetId}|${c.phase}`} style={ligneStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* le code de phase nu ne dit rien à qui ne le pratique pas
                    tous les jours : le libellé de `LIBELLES_PHASES` est en
                    clair sous le nom du projet, et en infobulle sur le code */}
                <a href={`#/projets/${c.projetId}`}>{c.projetId}</a> ·{' '}
                <span title={LIBELLES_PHASES[c.phase]}>{c.phase}</span>
                <div className="muted small">
                  {p?.nom || 'projet inconnu'} · {LIBELLES_PHASES[c.phase] || c.phase}
                </div>
              </div>
              {chronoDe(c) > 0 && (
                <span
                  className="muted small"
                  title="Au chrono sur cette ligne — compté dans le total, en plus de la cellule saisie"
                >
                  + {fmtHeures(chronoDe(c))} chrono
                </span>
              )}
              <NumInput
                value={heuresDe(c)}
                onChange={(v) => poser(c, v)}
                style={{ width: 76 }}
                ariaLabel={`Heures de ${personne} — ${c.projetId} ${c.phase} — semaine du ${fmtDate(semaine)}`}
              />
            </div>
          )
        })
      )}

      {/* hors projet : seules les activités réellement utilisées s'affichent,
          le reste attend derrière « Ajouter une activité » */}
      {CATEGORIES_HORS_PROJET.filter((cat) => (hpDe(cat) ?? 0) > 0 || activitesVisibles.includes(cat)).map((cat) => (
        <div key={cat} style={ligneStyle}>
          <div className="small" style={{ flex: 1 }}>{cat} <span className="muted">· hors projet</span></div>
          <NumInput
            value={hpDe(cat)}
            onChange={(v) => poserHP(cat, v)}
            style={{ width: 76 }}
            ariaLabel={`Heures de ${personne} — ${cat} (hors projet) — semaine du ${fmtDate(semaine)}`}
          />
        </div>
      ))}

      {(() => {
        const dossiers = state.tempsHorsProjet.filter(
          (t) => t.semaine === semaine && t.personne === personne && t.consultationId,
        )
        if (dossiers.length === 0) return null
        const h = dossiers.reduce((x, t) => x + t.heures, 0)
        return (
          <div style={ligneStyle}>
            <div className="small" style={{ flex: 1 }}>
              Prospection / AO — dossiers{' '}
              <span className="muted">
                · pointé depuis <a href="#/ao/dossiers">les dossiers</a>
              </span>
            </div>
            <span className="num small" style={{ width: 76, textAlign: 'right' }}>{fmtHeures(h)}</span>
          </div>
        )
      })()}

      <div className="toolbar" style={{ marginTop: 10, marginBottom: 0, flexWrap: 'wrap' }}>
        <Select
          value=""
          onChange={(v) => v && setActivitesVisibles((l) => [...new Set([...l, v])])}
          options={[
            { value: '', label: '+ Ajouter une activité (hors projet)' },
            ...CATEGORIES_HORS_PROJET.filter((cat) => (hpDe(cat) ?? 0) <= 0 && !activitesVisibles.includes(cat)).map(
              (cat) => ({ value: cat, label: cat }),
            ),
          ]}
          style={{ maxWidth: 260 }}
        />
        {projetsHorsListe.length > 0 && (
          <Select
            value=""
            onChange={(v) => {
              if (!v) return
              const p = actifs.find((x) => x.id === v)
              setAjoutes((l) => [...l, { projetId: v, phase: phaseParDefaut(p, semaine) }])
            }}
            options={[
              { value: '', label: '+ Ajouter un projet' },
              ...projetsHorsListe.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
            ]}
            style={{ maxWidth: 260 }}
          />
        )}
      </div>
    </Card>
  )
}

/** où vont les données : local (navigateur) ou espace partagé Supabase */
function IndicateurEnregistrement() {
  return syncActif() ? (
    <Badge tone="ok">Synchronisé</Badge>
  ) : (
    <Badge tone="muted">Enregistré localement</Badge>
  )
}

// ---------- historique au téléphone : le même total, lisible ----------

/**
 * Sous 700 px, la grille 6 semaines devient six colonnes de saisie
 * numérique sans colonne figée : on fait défiler à l'horizontale et on ne
 * sait plus de quelle personne on lit les chiffres. Cette fiche la
 * remplace (`styles.css` échange `.temps-desktop` et `.temps-mobile`).
 *
 * Elle est en LECTURE. Ce n'est pas une capacité perdue : la saisie est
 * l'onglet d'à côté, qui tient déjà au doigt et porte une seule semaine —
 * la bonne granularité pour un téléphone. Monter ici une seconde saisie
 * sur six semaines donnerait deux chemins d'écriture vers `state.temps`,
 * et le second serait celui qu'on utilise en marchant. La fiche le dit à
 * l'écran plutôt que de laisser chercher un champ qui n'existe pas.
 */
function FichePersonneMobile({ personne, semaines }: { personne: string; semaines: string[] }) {
  const { state } = useStore()
  // Une capacité par semaine, congés déduits — `bilanSemaines` n'en prend
  // qu'une, on l'appelle donc semaine par semaine plutôt que de recopier son
  // verdict. Un forfait unique aurait fait dire à cette fiche autre chose
  // qu'à « Ma semaine » sur la MÊME semaine de congés, et deux verdicts
  // contradictoires sur une feuille de temps, c'est la feuille qu'on cesse
  // de croire (audit d'usage, action 28).
  const bilans = semaines.map(
    (s) => bilanSemaines(state, personne, [s], capacitePersonneSemaine(state, personne, s))[0],
  )
  const total = bilans.reduce((s, b) => s + b.heures, 0)

  return (
    <Card
      titre={personne}
      actions={
        <span className="small muted">
          {fmtHeures(total)} sur {semaines.length} semaines
        </span>
      }
    >
      {bilans.map((b) => {
        const projets = projetsDeLaSemaine(state, personne, b.semaine)
        return (
          <div
            key={b.semaine}
            style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="small" style={{ flex: 1, minWidth: 0 }}>
                semaine du <strong>{fmtDate(b.semaine)}</strong>
              </span>
              <strong className="small">{fmtHeures(b.heures)}</strong>
              <Badge tone={TONS_ETAT[b.etat]}>{LIBELLES_ETAT[b.etat]}</Badge>
            </div>
            {projets.length > 0 && (
              <div className="muted small" style={{ marginTop: 2 }}>
                {projets.map((p) => `${p.projetId} ${fmtHeures(p.heures)}`).join(' · ')}
              </div>
            )}
          </div>
        )
      })}
      <p className="muted small" style={{ marginTop: 8 }}>
        Lecture seule : la saisie se fait dans l’onglet <strong>Ma semaine</strong>, une semaine à la
        fois. Le détail par phase et l’affectation des projets restent sur la version bureau.
      </p>
    </Card>
  )
}

// ---------- historique : la grille 6 semaines (vue secondaire) ----------

function Historique({ today }: { today: string }) {
  const { state } = useStore()
  const [fin, setFin] = useState(() => mondayOf(todayISO()))
  const personnes = state.settings.personnes
  const finCourante = mondayOf(today)
  const semaines = Array.from({ length: NB_SEMAINES }, (_, i) => addDays(fin, -7 * (NB_SEMAINES - 1 - i)))

  return (
    <>
      <div className="toolbar">
        <Btn onClick={() => setFin(addDays(fin, -7))} title="Reculer d'une semaine">
          ‹
        </Btn>
        <Btn onClick={() => setFin(addDays(fin, 7))} title="Avancer d'une semaine">
          ›
        </Btn>
        <Btn onClick={() => setFin(finCourante)} disabled={fin === finCourante}>
          Cette semaine
        </Btn>
        <span>
          Semaines du <strong>{fmtDate(semaines[0])}</strong> au{' '}
          <strong>{fmtDate(addDays(fin, 6))}</strong>
        </span>
        {fin === finCourante && <Badge tone="info">• = semaine en cours</Badge>}
        <IndicateurEnregistrement />
      </div>
      {/* Les deux vues sur les mêmes données, échangées par la CSS à 700 px.
          Elles lisent le MÊME `totalSemaine()` : elles ne peuvent pas
          afficher deux chiffres différents pour une même semaine. */}
      <div className="temps-desktop">
        {personnes.map((p) => (
          <TableauPersonne key={p} personne={p} semaines={semaines} today={today} />
        ))}
      </div>
      <div className="temps-mobile">
        {personnes.map((p) => (
          <FichePersonneMobile key={p} personne={p} semaines={semaines} />
        ))}
      </div>
      <p className="muted small">
        Les dérives heures par projet ont déménagé dans <a href="#/pilotage/missions">Pilotage → Missions</a>.
      </p>
    </>
  )
}

// ---------- module ----------

export default function Temps() {
  const { state } = useStore()
  const today = useToday()
  const [vue, setVue] = useState<'semaine' | 'historique'>('semaine')
  const personnes = state.settings.personnes

  return (
    <Page
      titre="Temps passé"
      sousTitre="Ma semaine, projet par projet — l'historique et la grille complète à côté."
    >
      {personnes.length === 0 ? (
        <Card>
          <EmptyState>
            Aucune personne définie — renseignez l’équipe dans <a href="#/parametres">Paramètres</a>.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Tabs
            tabs={[
              { id: 'semaine', label: 'Ma semaine' },
              { id: 'historique', label: 'Historique (6 semaines)' },
            ]}
            actif={vue}
            onSelect={(id) => setVue(id as 'semaine' | 'historique')}
          />
          {vue === 'semaine' && <SaisieSemaine today={today} />}
          {vue === 'historique' && <Historique today={today} />}
        </>
      )}
    </Page>
  )
}
