// ============================================================
// Temps.tsx — grille hebdomadaire de pointage des heures.
// MVP « rempli en deux minutes » : par personne, des lignes
// (projet, phase) avec une seule cellule « heures de la
// semaine ». Enregistrer = upsert des TempsEntry (clé
// semaine + personne + projet + phase ; heures 0 → suppression).
// ============================================================

import { useState } from 'react'
import type { AppState, PhaseCode, Projet } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  NumInput,
  Page,
  Select,
  Stat,
  Table,
  useToday,
} from '../ui'
import { addDays, fmtDate, fmtHeures, mondayOf, todayISO, uid } from '../util'
import { LIBELLES_PHASES, PHASES_ORDRE } from '../miqcp'
import { STATUTS_ACTIFS, heuresPrevues, heuresReelles } from '../derive'

// ---------- helpers locaux ----------

/** ligne de saisie : un couple (projet, phase) et ses heures de la semaine */
interface Ligne {
  projetId: string
  phase: PhaseCode
  heures: number | null
}

function indexPhase(code: PhaseCode): number {
  const i = PHASES_ORDRE.indexOf(code)
  return i === -1 ? PHASES_ORDRE.length : i
}

function triLignes(a: Ligne, b: Ligne): number {
  return a.projetId.localeCompare(b.projetId) || indexPhase(a.phase) - indexPhase(b.phase)
}

/** lignes déjà enregistrées dans le store pour une semaine et une personne */
function lignesEnregistrees(state: AppState, semaine: string, personne: string): Ligne[] {
  return state.temps
    .filter((t) => t.semaine === semaine && t.personne === personne)
    .map((t) => ({ projetId: t.projetId, phase: t.phase, heures: t.heures }))
    .sort(triLignes)
}

/** clé canonique d'un jeu de lignes (les 0/vides comptent pour « absent ») */
function canonique(lignes: Ligne[]): string {
  return lignes
    .filter((l) => (l.heures ?? 0) > 0)
    .map((l) => `${l.projetId}|${l.phase}|${l.heures}`)
    .sort()
    .join(';')
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

function tonePourRatio(ratio: number): 'ok' | 'warn' | 'danger' {
  if (ratio >= 1) return 'danger'
  if (ratio >= 0.8) return 'warn'
  return 'ok'
}

// ---------- barre de consommation (style inline : pas de classe dédiée) ----------

function BarreConso({ ratio }: { ratio: number }) {
  const tone = tonePourRatio(ratio)
  const couleur = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--ok)'
  return (
    <div
      style={{
        background: 'var(--line)',
        borderRadius: 99,
        height: 8,
        width: 140,
        overflow: 'hidden',
      }}
      title={`${Math.round(ratio * 100)} % du budget d'heures`}
    >
      <div
        style={{
          width: `${Math.min(100, Math.round(ratio * 100))}%`,
          background: couleur,
          height: '100%',
        }}
      />
    </div>
  )
}

// ---------- grille d'une personne ----------

function GrillePersonne({
  personne,
  semaine,
  today,
}: {
  personne: string
  semaine: string
  today: string
}) {
  const { state, update } = useStore()
  const actifs = state.projets.filter((p) => STATUTS_ACTIFS.includes(p.statut))

  // brouillon local, initialisé depuis le store (le composant est re-monté
  // par sa `key` quand la semaine change)
  const [lignes, setLignes] = useState<Ligne[]>(() => lignesEnregistrees(state, semaine, personne))
  const [projetSel, setProjetSel] = useState(actifs[0]?.id ?? '')
  const [phaseSel, setPhaseSel] = useState<PhaseCode>(() => phaseParDefaut(actifs[0], today))
  const [fait, setFait] = useState(false)

  const modifie = canonique(lignes) !== canonique(lignesEnregistrees(state, semaine, personne))
  const totalSaisi = lignes.reduce((s, l) => s + (l.heures ?? 0), 0)

  const projetCourant = actifs.find((p) => p.id === projetSel)
  const codesPhases = projetCourant
    ? [...projetCourant.phases.map((ph) => ph.code)].sort((a, b) => indexPhase(a) - indexPhase(b))
    : PHASES_ORDRE

  // couples de la semaine précédente (pour reprendre la structure en un clic)
  const semainePrec = addDays(semaine, -7)
  const couplesPrec = lignesEnregistrees(state, semainePrec, personne)

  const changer = (l: Ligne, v: number | null) => {
    setLignes((ls) =>
      ls.map((x) => (x.projetId === l.projetId && x.phase === l.phase ? { ...x, heures: v } : x)),
    )
  }

  const ajouter = () => {
    if (!projetSel) return
    if (lignes.some((l) => l.projetId === projetSel && l.phase === phaseSel)) {
      alert('Cette ligne (projet + phase) existe déjà dans la grille.')
      return
    }
    setLignes((ls) => [...ls, { projetId: projetSel, phase: phaseSel, heures: null }].sort(triLignes))
  }

  const retirer = (l: Ligne) => {
    const enBase = state.temps.some(
      (t) =>
        t.semaine === semaine &&
        t.personne === personne &&
        t.projetId === l.projetId &&
        t.phase === l.phase &&
        t.heures > 0,
    )
    if (
      enBase &&
      !confirm('Retirer cette ligne ? Les heures enregistrées seront supprimées à l’enregistrement.')
    ) {
      return
    }
    setLignes((ls) => ls.filter((x) => !(x.projetId === l.projetId && x.phase === l.phase)))
  }

  const reprendrePrecedente = () => {
    setLignes(couplesPrec.map((l) => ({ ...l, heures: null })).sort(triLignes))
  }

  const enregistrer = () => {
    update((d) => {
      const cle = (projetId: string, phase: PhaseCode) => `${projetId}|${phase}`
      const gardees = new Set<string>()
      for (const l of lignes) {
        const h = l.heures ?? 0
        if (h <= 0) continue // heures 0 ou vides → suppression (via le filtre ci-dessous)
        gardees.add(cle(l.projetId, l.phase))
        const existante = d.temps.find(
          (t) =>
            t.semaine === semaine &&
            t.personne === personne &&
            t.projetId === l.projetId &&
            t.phase === l.phase,
        )
        if (existante) {
          existante.heures = h
        } else {
          d.temps.push({
            id: uid('tps'),
            semaine,
            personne,
            projetId: l.projetId,
            phase: l.phase,
            heures: h,
          })
        }
      }
      d.temps = d.temps.filter(
        (t) =>
          t.semaine !== semaine || t.personne !== personne || gardees.has(cle(t.projetId, t.phase)),
      )
    })
    setFait(true)
    window.setTimeout(() => setFait(false), 1800)
  }

  return (
    <Card
      titre={personne}
      actions={
        <>
          <span className="small muted" style={{ alignSelf: 'center' }}>
            Total saisi : <strong className="num">{fmtHeures(totalSaisi)}</strong>
          </span>
          <Btn
            kind={modifie ? 'primary' : 'default'}
            onClick={enregistrer}
            disabled={!modifie}
            title={modifie ? 'Enregistrer les heures de la semaine' : 'Aucune modification à enregistrer'}
          >
            {fait ? '✓ Enregistré' : 'Enregistrer'}
          </Btn>
        </>
      }
    >
      {lignes.length === 0 ? (
        <EmptyState>Aucune heure pointée cette semaine — ajoutez une ligne projet + phase.</EmptyState>
      ) : (
        <Table compact head={['Projet', 'Phase', 'Heures', '']}>
          {lignes.map((l) => {
            const p = state.projets.find((x) => x.id === l.projetId)
            return (
              <tr key={`${l.projetId}|${l.phase}`}>
                <td>
                  <a href={`#/projets/${l.projetId}`}>{l.projetId}</a>{' '}
                  <span className="muted small">{p ? p.nom : 'projet inconnu'}</span>
                </td>
                <td>
                  {l.phase} <span className="muted small">{LIBELLES_PHASES[l.phase]}</span>
                </td>
                <td className="right" style={{ width: 100 }}>
                  <NumInput value={l.heures} onChange={(v) => changer(l, v)} placeholder="0" />
                </td>
                <td className="right" style={{ width: 70 }}>
                  <Btn kind="ghost" small onClick={() => retirer(l)} title="Retirer la ligne de la grille">
                    Retirer
                  </Btn>
                </td>
              </tr>
            )
          })}
        </Table>
      )}

      {actifs.length === 0 ? (
        <p className="muted small" style={{ marginTop: 10 }}>
          Aucun projet actif (statut « Signé » ou « En cours ») — passez un projet dans un statut
          actif pour pointer des heures.
        </p>
      ) : (
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
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
          <Btn onClick={ajouter}>Ajouter la ligne</Btn>
          {lignes.length === 0 && couplesPrec.length > 0 && (
            <Btn kind="ghost" onClick={reprendrePrecedente} title="Reprend les couples projet + phase, heures à ressaisir">
              Reprendre les lignes de la semaine précédente
            </Btn>
          )}
        </div>
      )}
    </Card>
  )
}

// ---------- récap de la semaine (données enregistrées) ----------

function RecapSemaine({ semaine }: { semaine: string }) {
  const { state } = useStore()
  const s = state.settings
  const theorique = s.heuresParJour * 5

  const totaux = s.personnes.map((personne) => ({
    personne,
    total: state.temps
      .filter((t) => t.semaine === semaine && t.personne === personne)
      .reduce((x, t) => x + t.heures, 0),
  }))
  const totalAgence = totaux.reduce((x, t) => x + t.total, 0)

  return (
    <Card titre="Récap de la semaine (heures enregistrées)">
      <div className="grid3">
        {totaux.map(({ personne, total }) => {
          const ecart = total - theorique
          const conforme = Math.abs(ecart) < 0.5
          return (
            <Stat
              key={personne}
              label={personne}
              value={fmtHeures(total)}
              tone={total === 0 ? undefined : conforme ? 'ok' : 'warn'}
              sub={
                <>
                  théorique {fmtHeures(theorique)} ({s.heuresParJour} h × 5 j){' '}
                  {total === 0 ? (
                    <Badge tone="muted">rien de pointé</Badge>
                  ) : conforme ? (
                    <Badge tone="ok">conforme</Badge>
                  ) : (
                    <Badge tone="warn">
                      {ecart > 0 ? '+' : '−'}
                      {fmtHeures(Math.abs(ecart))} vs théorique
                    </Badge>
                  )}
                </>
              }
            />
          )
        })}
        <Stat
          label="Total agence"
          value={fmtHeures(totalAgence)}
          sub={`théorique ${fmtHeures(theorique * s.personnes.length)}`}
        />
      </div>
    </Card>
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
  const [semaine, setSemaine] = useState(() => mondayOf(todayISO()))
  const personnes = state.settings.personnes
  const semaineCourante = mondayOf(today)

  return (
    <Page
      titre="Temps passé"
      sousTitre="Grille hebdomadaire par personne — ces heures calibrent les futurs devis : collecte dès le jour 1."
    >
      <div className="toolbar">
        <Btn onClick={() => setSemaine(addDays(semaine, -7))} title="Semaine précédente">
          ‹
        </Btn>
        <Btn onClick={() => setSemaine(addDays(semaine, 7))} title="Semaine suivante">
          ›
        </Btn>
        <Btn onClick={() => setSemaine(semaineCourante)} disabled={semaine === semaineCourante}>
          Cette semaine
        </Btn>
        <span>
          Semaine du <strong>{fmtDate(semaine)}</strong> au <strong>{fmtDate(addDays(semaine, 6))}</strong>
        </span>
        {semaine === semaineCourante && <Badge tone="info">semaine en cours</Badge>}
      </div>

      {personnes.length === 0 ? (
        <Card>
          <EmptyState>
            Aucune personne définie — renseignez les personnes de l’agence dans{' '}
            <a href="#/parametres">Paramètres</a>.
          </EmptyState>
        </Card>
      ) : (
        <div className={personnes.length > 1 ? 'grid2' : undefined}>
          {personnes.map((p) => (
            <GrillePersonne key={`${p}|${semaine}`} personne={p} semaine={semaine} today={today} />
          ))}
        </div>
      )}

      {personnes.length > 0 && <RecapSemaine semaine={semaine} />}
      <RecapDerives />
    </Page>
  )
}
