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
  Tabs,
  confirmer,
  toast,
  useToday,
} from '../ui'
import { addDays, fmtDate, fmtHeures, mondayOf, todayISO, uid } from '../util'
import { syncActif } from '../sync'
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
                    <a href={`#/projets/${c.projetId}`}>{c.projetId}</a> · {c.phase}
                    <div className="muted small" title={LIBELLES_PHASES[c.phase]}>
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
            <tr style={{ fontWeight: 650 }}>
              <td className="col-figee">Total semaine</td>
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
  const personnes = state.settings.personnes
  const [personne, setPersonne] = useState(personnes[0] || '')
  const [semaine, setSemaine] = useState(() => mondayOf(today))
  const [ajoutes, setAjoutes] = useState<Couple[]>([])
  const [activitesVisibles, setActivitesVisibles] = useState<string[]>([])
  const semaineCourante = mondayOf(today)

  const actifs = state.projets.filter((p) => STATUTS_ACTIFS.includes(p.statut))
  const affectes = actifs.filter(
    (p) => p.equipeProjet?.includes(personne) || p.responsable === personne || p.coResponsable === personne,
  )

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

  const heuresDe = (c: Couple): number | null => {
    const e = state.temps.find(
      (t) => t.semaine === semaine && t.personne === personne && t.projetId === c.projetId && t.phase === c.phase,
    )
    return e ? e.heures : null
  }
  const poser = (c: Couple, v: number | null) =>
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
    const temps = state.temps.filter((t) => t.personne === personne && t.semaine === avant)
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
          !state.temps.some(
            (x) => x.semaine === semaine && x.personne === personne && x.projetId === t.projetId && x.phase === t.phase,
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

  const total =
    state.temps.filter((t) => t.semaine === semaine && t.personne === personne).reduce((s, t) => s + t.heures, 0) +
    state.tempsHorsProjet.filter((t) => t.semaine === semaine && t.personne === personne).reduce((s, t) => s + t.heures, 0)
  const theorique = state.settings.heuresParJour * 5
  const projetsHorsListe = actifs.filter((p) => !couples.some((c) => c.projetId === p.id))

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
        <strong>{fmtHeures(total)} saisies</strong>
        <span className="muted">sur {fmtHeures(theorique)} théoriques</span>
        <Badge tone={total === 0 ? 'muted' : Math.abs(total - theorique) < 0.5 ? 'ok' : 'warn'}>
          {total === 0 ? 'à saisir' : total < theorique ? 'incomplète' : total > theorique + 0.5 ? 'surcharge' : 'complète'}
        </Badge>
        <IndicateurEnregistrement />
        <span className="spacer" />
        <Btn small onClick={copierSemainePrecedente}>Copier la semaine précédente</Btn>
      </p>

      {couples.length === 0 ? (
        <EmptyState>
          Aucun projet affecté à {personne || '—'} — l'affectation se fait sur la version bureau ou
          dans la fiche projet.
        </EmptyState>
      ) : (
        couples.map((c) => {
          const p = state.projets.find((x) => x.id === c.projetId)
          return (
            <div key={`${c.projetId}|${c.phase}`} style={ligneStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <a href={`#/projets/${c.projetId}`}>{c.projetId}</a> · {c.phase}
                <div className="muted small">{p?.nom || 'projet inconnu'}</div>
              </div>
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
      {personnes.map((p) => (
        <TableauPersonne key={p} personne={p} semaines={semaines} today={today} />
      ))}
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
