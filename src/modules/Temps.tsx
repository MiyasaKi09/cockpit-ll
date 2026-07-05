// ============================================================
// Temps.tsx — LE tableau de temps interactif, façon fiche de
// temps d'agence : par personne, lignes = projets-phases puis
// catégories hors projet, colonnes = semaines. Chaque cellule
// s'édite en place et s'enregistre TOUTE SEULE (plus de bouton).
// ============================================================

import { useState } from 'react'
import type { PhaseCode, Projet } from '../types'
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
  confirmer,
  toast,
  useToday,
} from '../ui'
import { addDays, fmtDate, fmtHeures, mondayOf, todayISO, uid } from '../util'
import { LIBELLES_PHASES, PHASES_ORDRE } from '../miqcp'
import { STATUTS_ACTIFS, heuresPrevues, heuresReelles } from '../derive'

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
  const affectes = actifs.filter(
    (p) => p.equipeProjet?.includes(personne) || p.responsable === personne || p.coResponsable === personne,
  )

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

  const heuresDe = (semaine: string, c: Couple): number | null => {
    const e = state.temps.find(
      (t) => t.semaine === semaine && t.personne === personne && t.projetId === c.projetId && t.phase === c.phase,
    )
    return e ? e.heures : null
  }

  const poser = (semaine: string, c: Couple, v: number | null) =>
    update((d) => {
      const i = d.temps.findIndex(
        (t) => t.semaine === semaine && t.personne === personne && t.projetId === c.projetId && t.phase === c.phase,
      )
      if (v === null || v <= 0) {
        if (i >= 0) d.temps.splice(i, 1)
        return
      }
      if (i >= 0) d.temps[i].heures = v
      else d.temps.push({ id: uid('tps'), semaine, personne, projetId: c.projetId, phase: c.phase, heures: v })
    })

  const hpDe = (semaine: string, categorie: string): number | null => {
    const e = state.tempsHorsProjet.find(
      (t) => t.semaine === semaine && t.personne === personne && t.categorie === categorie,
    )
    return e ? e.heures : null
  }

  const poserHP = (semaine: string, categorie: string, v: number | null) =>
    update((d) => {
      const i = d.tempsHorsProjet.findIndex(
        (t) => t.semaine === semaine && t.personne === personne && t.categorie === categorie,
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

  const totalColonne = (semaine: string): number =>
    state.temps
      .filter((t) => t.semaine === semaine && t.personne === personne)
      .reduce((s, t) => s + t.heures, 0) +
    state.tempsHorsProjet
      .filter((t) => t.semaine === semaine && t.personne === personne)
      .reduce((s, t) => s + t.heures, 0)

  const totalLigne = (c: Couple): number =>
    semaines.reduce((s, sem) => s + (heuresDe(sem, c) ?? 0), 0)
  const totalLigneHP = (cat: string): number =>
    semaines.reduce((s, sem) => s + (hpDe(sem, cat) ?? 0), 0)

  const theorique = state.settings.heuresParJour * 5
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
              <th style={{ minWidth: 190 }}>Projet · phase</th>
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
                  <td>
                    <a href={`#/projets/${c.projetId}`}>{c.projetId}</a> · {c.phase}
                    <div className="muted small" title={LIBELLES_PHASES[c.phase]}>
                      {p ? (p.nom.length > 30 ? p.nom.slice(0, 30) + '…' : p.nom) : 'projet inconnu'}
                    </div>
                  </td>
                  {semaines.map((s) => (
                    <td key={s} className="right">
                      <NumInput value={heuresDe(s, c)} onChange={(v) => poser(s, c, v)} style={{ width: 58 }} />
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
                <td className="small">{cat}</td>
                {semaines.map((s) => (
                  <td key={s} className="right">
                    <NumInput value={hpDe(s, cat)} onChange={(v) => poserHP(s, cat, v)} style={{ width: 58 }} />
                  </td>
                ))}
                <td className="right num">{fmtHeures(totalLigneHP(cat))}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 650 }}>
              <td>Total semaine</td>
              {semaines.map((s) => {
                const t = totalColonne(s)
                const ecart = Math.abs(t - theorique)
                const couleur = t === 0 ? 'var(--ink-3)' : ecart < 0.5 ? 'var(--ok)' : 'var(--warn)'
                return (
                  <td key={s} className="right num" style={{ color: couleur }} title={`théorique ${fmtHeures(theorique)}`}>
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

function RecapDerives() {
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

// ---------- module ----------

export default function Temps() {
  const { state } = useStore()
  const today = useToday()
  const [fin, setFin] = useState(() => mondayOf(todayISO()))
  const personnes = state.settings.personnes
  const finCourante = mondayOf(today)

  const semaines = Array.from({ length: NB_SEMAINES }, (_, i) => addDays(fin, -7 * (NB_SEMAINES - 1 - i)))

  return (
    <Page
      titre="Temps passé"
      sousTitre="Une colonne par semaine, saisie enregistrée en direct. Ces heures calibrent marge et devis."
    >
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
      </div>

      {personnes.length === 0 ? (
        <Card>
          <EmptyState>
            Aucune personne définie — renseignez l’équipe dans <a href="#/parametres">Paramètres</a>.
          </EmptyState>
        </Card>
      ) : (
        personnes.map((p) => <TableauPersonne key={p} personne={p} semaines={semaines} today={today} />)
      )}

      <RecapDerives />
    </Page>
  )
}
