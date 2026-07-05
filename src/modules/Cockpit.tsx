// ============================================================
// Cockpit — tableau de bord : météo financière, fil d'urgences
// (alertes calculées, snoozables) et repères du jour.
// Tout est dérivé de l'état : aucune donnée propre au module.
// ============================================================

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Alerte } from '../types'
import { useStore } from '../store'
import { Btn, Card, DateF, EmptyState, Icon, Money, Page, Progress, Stat, toast, useToday } from '../ui'
import { alertesActives } from '../alerts'
import { STATUTS_ACTIFS, caCible, caRealiseAnnee, meteoFinanciere } from '../derive'
import { addDays, fmtDate, fmtMoney, fmtPct } from '../util'
import { useSurveillance } from '../surveillance'

// ---------- petits composants locaux ----------

const STYLE_GROUPE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--ink-3)',
  margin: '12px 2px 6px',
}

const GROUPES_ALERTES: { gravite: Alerte['gravite']; label: string }[] = [
  { gravite: 3, label: 'Critique' },
  { gravite: 2, label: 'À surveiller' },
  { gravite: 1, label: 'Pour information' },
]

function AlerteLigne({
  a,
  onSnooze,
  onAction,
}: {
  a: Alerte
  onSnooze: (id: string, jours: number) => void
  onAction: (action: NonNullable<Alerte['action']>) => void
}) {
  return (
    <div className={`alert-item alert-${a.gravite}`}>
      <span className="alert-dot" />
      <div style={{ minWidth: 0 }}>
        <div className="alert-titre">{a.titre}</div>
        <div className="alert-detail">
          {a.detail ? <>{a.detail} · </> : null}
          <a href={a.lien}>ouvrir</a>
        </div>
      </div>
      <div className="alert-actions">
        {a.action && (
          <Btn small kind="primary" onClick={() => onAction(a.action!)} title="Fait sur place, sans changer de page">
            {a.action.label}
          </Btn>
        )}
        <Btn small onClick={() => onSnooze(a.id, 7)} title="Mettre cette alerte en sommeil 7 jours">
          Sommeil 7 j
        </Btn>
        <Btn
          small
          kind="ghost"
          onClick={() => onSnooze(a.id, 30)}
          title="Mettre cette alerte en sommeil 30 jours"
        >
          30 j
        </Btn>
      </div>
    </div>
  )
}

/** colonne des « Repères du jour » */
function Repere({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ ...STYLE_GROUPE, margin: '0 0 6px' }}>{titre}</div>
      {children}
    </div>
  )
}

function Ligne({ children }: { children: ReactNode }) {
  return (
    <div className="small" style={{ padding: '4px 0' }}>
      {children}
    </div>
  )
}

function RienASignaler({ children }: { children: ReactNode }) {
  return <div className="muted small">{children}</div>
}

// ---------- boîte « À traiter » ----------

/** action rapide réalisable SUR PLACE, sans changer de page */
type ActionRapide =
  | { kind: 'emettre_facture'; refId: string; label: string }
  | { kind: 'valider_situation'; refId: string; label: string }
  | { kind: 'note_faite'; refId: string; projetId: string; label: string }

interface ItemATraiter {
  id: string
  action: string
  detail: string
  lien: string
  date?: string
  pour?: string
  rapide?: ActionRapide
}

function itemsATraiter(state: ReturnType<typeof useStore>['state'], today: string): ItemATraiter[] {
  const items: ItemATraiter[] = []
  for (const s of state.situations.filter((x) => x.statut === 'a_verifier')) {
    items.push({
      id: `sit-${s.id}`,
      action: `Vérifier la situation — ${s.entreprise} (${s.mois})`,
      detail: `${s.projetId || 'projet à rattacher'}${s.montantMoisHT != null ? ` · ${fmtMoney(s.montantMoisHT)} HT` : ''} · déposée par la routine situations@`,
      lien: '#/situations',
      date: s.dateReception,
      pour: s.pour,
      rapide: { kind: 'valider_situation', refId: s.id, label: '✓ Valider' },
    })
  }
  for (const c of state.consultations.filter((x) => x.statut === 'a_etudier')) {
    items.push({
      id: `ao-${c.id}`,
      action: `Étudier la consultation — ${c.intitule}`,
      detail: `${c.acheteur || 'acheteur ?'}${c.dateLimite ? ` · remise le ${fmtDate(c.dateLimite)}` : ''} · avis Go/No-Go à donner`,
      lien: '#/ao',
      date: c.dateLimite || undefined,
      pour: c.pour,
    })
  }
  for (const f of state.factures.filter((x) => x.statut === 'prevue' && x.emission <= today)) {
    items.push({
      id: `fac-${f.id}`,
      action: `Émettre la facture ${f.id} — ${fmtMoney(f.montantHT)} HT`,
      detail: `${f.projetId} · ${f.libelle} · prévue le ${fmtDate(f.emission)}`,
      lien: '#/facturation',
      date: f.emission,
      rapide: { kind: 'emettre_facture', refId: f.id, label: '✓ Émettre' },
    })
  }
  for (const r of state.reunions.filter((x) => x.statut !== 'diffuse' && x.date <= today)) {
    items.push({
      id: `cr-${r.id}`,
      action: `Sortir le CR — ${r.titre}`,
      detail: `${r.projetId} · réunion du ${fmtDate(r.date)} · assistant CR dans l'onglet Chantier`,
      lien: `#/projets/${r.projetId}/chantier`,
      date: r.date,
    })
  }
  // notes de journal « à faire » non réglées
  for (const p of state.projets) {
    for (const n of p.journal) {
      if (!n.tags.includes('a-faire') || n.fait) continue
      items.push({
        id: `note-${n.id}`,
        action: n.texte.length > 90 ? n.texte.slice(0, 90) + '…' : n.texte,
        detail: `${p.id} · note du ${fmtDate(n.date)}${n.auteur ? ` (${n.auteur})` : ''} · à cocher dans le journal`,
        lien: `#/projets/${p.id}/journal`,
        date: n.date,
        pour: n.auteur,
        rapide: { kind: 'note_faite', refId: n.id, projetId: p.id, label: '✓ Fait' },
      })
    }
  }
  items.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
  return items
}

function LigneCourrier({ personne }: { personne: string }) {
  const { state, update, replace } = useStore()
  const courriers = state.courriers
    .filter((c) => c.statut === 'a_traiter')
    .filter((c) => !personne || !c.pour || c.pour === personne)
    .sort((a, b) => (b.urgence || 0) - (a.urgence || 0) || a.dateReception.localeCompare(b.dateReception))

  if (courriers.length === 0) return null

  const traiter = (id: string) => {
    const snap = state
    update((d) => {
      const c = d.courriers.find((x) => x.id === id)
      if (c) c.statut = 'traite'
    })
    toast('Courrier traité.', { undo: () => replace(snap) })
  }

  const versJournal = (id: string) => {
    const snap = state
    update((d) => {
      const c = d.courriers.find((x) => x.id === id)
      if (!c || !c.projetId) return
      const p = d.projets.find((x) => x.id === c.projetId)
      if (!p) return
      p.journal.push({
        id: `note-${id}`,
        date: c.dateReception,
        auteur: c.pour,
        texte: `Mail de ${c.de} — ${c.objet}\n${c.resume}${c.actionProposee ? `\nAction : ${c.actionProposee}` : ''}`,
        tags: ['mail', c.type],
      })
      c.statut = 'traite'
    })
    toast('Archivé dans le journal du projet.', { undo: () => replace(snap) })
  }

  return (
    <>
      {courriers.map((c) => (
        <div key={c.id} className={`alert-item ${c.urgence === 3 ? 'alert-3' : ''}`}>
          <span className="alert-dot" style={{ background: c.urgence === 3 ? 'var(--danger)' : 'var(--accent)' }} />
          <div style={{ minWidth: 0 }}>
            <div className="alert-titre">
              <Icon name="mail" size={13} style={{ verticalAlign: '-0.15em' }} /> {c.objet}{' '}
              {c.pour && <span className="badge badge-info">{c.pour}</span>}{' '}
              {c.projetId ? (
                <a href={`#/projets/${c.projetId}`} className="badge badge-muted">
                  {c.projetId}
                </a>
              ) : (
                <span className="badge badge-warn">projet ?</span>
              )}
            </div>
            <div className="alert-detail">
              de {c.de} · {c.resume}
              {c.actionProposee && (
                <>
                  <br />
                  <strong>Action proposée :</strong> {c.actionProposee}
                </>
              )}
            </div>
          </div>
          <div className="alert-actions">
            {c.projetId && (
              <Btn small kind="ghost" onClick={() => versJournal(c.id)} title="Archive le mail dans le journal du projet et le marque traité">
                → Journal
              </Btn>
            )}
            <Btn small onClick={() => traiter(c.id)}>✓ Fait</Btn>
          </div>
        </div>
      ))}
    </>
  )
}

/** exécute une action rapide sur place (mutation du store) */
function executerRapide(update: ReturnType<typeof useStore>['update'], a: ActionRapide): void {
  update((d) => {
    if (a.kind === 'emettre_facture') {
      const f = d.factures.find((x) => x.id === a.refId)
      if (f && f.statut === 'prevue') f.statut = 'emise'
    } else if (a.kind === 'valider_situation') {
      const s = d.situations.find((x) => x.id === a.refId)
      if (s) s.statut = 'validee'
    } else if (a.kind === 'note_faite') {
      const n = d.projets.find((x) => x.id === a.projetId)?.journal.find((x) => x.id === a.refId)
      if (n) n.fait = true
    }
  })
}

function BoiteATraiter() {
  const { state, update, replace } = useStore()
  const today = useToday()
  const [personne, setPersonne] = useState('')

  const faireRapide = (a: ActionRapide) => {
    const snap = state
    executerRapide(update, a)
    const libelle =
      a.kind === 'valider_situation'
        ? 'Situation validée.'
        : a.kind === 'emettre_facture'
          ? 'Facture émise.'
          : 'Note marquée faite.'
    toast(libelle, { undo: () => replace(snap) })
  }

  const tous = itemsATraiter(state, today)
  const items = personne ? tous.filter((i) => !i.pour || i.pour === personne) : tous
  const nbCourriers = state.courriers.filter(
    (c) => c.statut === 'a_traiter' && (!personne || !c.pour || c.pour === personne),
  ).length

  return (
    <Card
      titre="À traiter"
      actions={
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {['', ...state.settings.personnes].map((p) => (
            <button
              key={p || 'tous'}
              className={`btn btn-small ${personne === p ? 'btn-primary' : ''}`}
              onClick={() => setPersonne(p)}
            >
              {p || 'Tout'}
            </button>
          ))}
        </span>
      }
    >
      <p className="muted small" style={{ marginBottom: 10 }}>
        Trié par urgence. Chaque ligne mène au bon endroit.
      </p>
      <LigneCourrier personne={personne} />
      {items.length === 0 && nbCourriers === 0 ? (
        <EmptyState>Rien à traiter.</EmptyState>
      ) : (
        items.map((i) => (
          <div key={i.id} className="alert-item">
            <span className="alert-dot" style={{ background: 'var(--accent)' }} />
            <div style={{ minWidth: 0 }}>
              <div className="alert-titre">
                {i.action}{' '}
                {i.pour && <span className="badge badge-info">{i.pour}</span>}
              </div>
              <div className="alert-detail">{i.detail}</div>
            </div>
            <div className="alert-actions">
              {i.rapide && (
                <Btn small kind="primary" onClick={() => faireRapide(i.rapide!)} title="Fait sur place, sans changer de page">
                  {i.rapide.label}
                </Btn>
              )}
              <a className={`btn btn-small ${i.rapide ? 'btn-ghost' : 'btn-primary'}`} href={i.lien}>
                {i.rapide ? 'ouvrir' : 'Traiter →'}
              </a>
            </div>
          </div>
        ))
      )}
    </Card>
  )
}

// ---------- module ----------

export default function Cockpit() {
  const { state, update, replace } = useStore()
  const today = useToday()
  const { evenements, direct } = useSurveillance(state, update)

  const meteo = meteoFinanciere(state, today)
  const excel = state.settings.dernierImportExcel
  const alertes = alertesActives(state, today)

  const snooze = (id: string, jours: number) => {
    const snap = state
    update((d) => {
      d.settings.snoozes[id] = addDays(today, jours)
    })
    toast(`Alerte en sommeil ${jours} jours.`, { undo: () => replace(snap) })
  }

  // action rapide d'une alerte, exécutée sur place
  const executerAlerte = (action: NonNullable<Alerte['action']>) => {
    const snap = state
    update((d) => {
      if (action.kind === 'emettre_facture') {
        const f = d.factures.find((x) => x.id === action.refId)
        if (f && f.statut === 'prevue') f.statut = 'emise'
      } else if (action.kind === 'valider_situation') {
        const s = d.situations.find((x) => x.id === action.refId)
        if (s) s.statut = 'validee'
      } else if (action.kind === 'obligation_faite') {
        const o = d.obligations.find((x) => x.id === action.refId)
        if (!o) return
        if (o.periodiciteMois) {
          // reconduit à la prochaine échéance (même logique qu'Agenda)
          const ym = o.echeance.slice(0, 7)
          const [y, m] = ym.split('-').map(Number)
          const totalM = m - 1 + o.periodiciteMois
          const jour = Math.min(Number(o.echeance.slice(8, 10)), 28)
          o.echeance = `${y + Math.floor(totalM / 12)}-${String((totalM % 12) + 1).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
        } else {
          d.obligations = d.obligations.filter((x) => x.id !== o.id)
        }
      }
    })
    const libelle =
      action.kind === 'emettre_facture'
        ? 'Facture émise.'
        : action.kind === 'valider_situation'
          ? 'Situation validée.'
          : 'Obligation faite.'
    toast(libelle, { undo: () => replace(snap) })
  }

  // phases en cours : projets actifs dont une phase encadre la date du jour
  const phasesEnCours = state.projets
    .filter((p) => STATUTS_ACTIFS.includes(p.statut))
    .flatMap((p) =>
      p.phases
        .filter((ph) => ph.debut && ph.fin && ph.debut <= today && today <= ph.fin)
        .map((ph) => ({ projet: p, phase: ph })),
    )

  const prochainesFactures = state.factures
    .filter((f) => f.statut === 'prevue' && f.emission >= today)
    .sort((a, b) => a.emission.localeCompare(b.emission))
    .slice(0, 3)

  const prochainesObligations = state.obligations
    .filter((o) => o.echeance >= today)
    .sort((a, b) => a.echeance.localeCompare(b.echeance))
    .slice(0, 3)

  return (
    <Page
      titre="Cockpit"
      sousTitre={
        <>
          {direct ? (
            <span className="badge badge-ok" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon name="bolt" size={12} /> Gmail & Agenda en direct
            </span>
          ) : (
            state.settings.surveillance?.clientId && (
              <a href="#/parametres/branchements" className="badge badge-muted">surveillance coupée — reconnecter</a>
            )
          )}{' '}
          <a
            href="#/parametres/branchements"
            className="badge badge-muted"
            title="Tester chaque branchement en un clic"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <Icon name="activity" size={12} /> santé des branchements
          </a>
        </>
      }
    >
      {/* ---------- météo financière ---------- */}
      <div style={{ marginBottom: 16 }}>
        <div className="grid3">
          <Stat
            accent="blue"
            label="Trésorerie disponible"
            value={<Money v={meteo.tresorerie} />}
            tone={meteo.tresorerie !== null && meteo.tresorerie < 0 ? 'danger' : undefined}
            sub={
              meteo.tresorerie === null ? (
                <>
                  à renseigner dans <a href="#/parametres">Paramètres</a>
                </>
              ) : (
                <>
                  MAJ le {fmtDate(meteo.tresorerieMajLe)} · <a href="#/parametres">Paramètres</a>
                </>
              )
            }
          />
          <Stat
            accent="yellow"
            label="Facturable à 90 jours"
            value={<Money v={meteo.facturable90j} />}
            sub="factures à émettre ou en attente d'encaissement"
          />
          <Stat
            accent="red"
            label="Carnet de commandes"
            value={<Money v={meteo.carnetHT} />}
            sub="honoraires restant à facturer (projets signés / en cours)"
          />
        </div>
        {caCible(state) > 0 && (() => {
          const annee = Number(today.slice(0, 4))
          const ca = caRealiseAnnee(state, annee)
          const cible = caCible(state)
          const pct = ca / cible
          return (
            <div style={{ margin: '10px 2px 0' }}>
              <Progress
                value={ca}
                max={cible}
                header={
                  <>
                    <span className="muted">Objectif CA {annee} — <a href="#/analyse">Analyse</a></span>
                    <span><strong>{fmtMoney(ca)}</strong> <span className="muted">/ {fmtMoney(cible)} ({fmtPct(pct, 0)})</span></span>
                  </>
                }
              />
            </div>
          )
        })()}
        {excel && (
          <p className="muted small" style={{ margin: '8px 2px 0' }}>
            Excel maître importé le {fmtDate(excel.date)} ({excel.fichier}) : carnet{' '}
            {fmtMoney(excel.carnetHT)}, facturé {fmtMoney(excel.factureHT)} — source maître la
            première année.
          </p>
        )}
      </div>

      {/* ---------- inbox principale + rail latéral ---------- */}
      <div className="cockpit-cols">
      <div className="cockpit-main">
      <BoiteATraiter />

      {/* ---------- fil d'urgences ---------- */}
      <Card
        titre="Fil d'urgences"
        actions={
          alertes.length > 0 ? (
            <span className="muted small">
              {alertes.length} alerte{alertes.length > 1 ? 's' : ''} active
              {alertes.length > 1 ? 's' : ''}
            </span>
          ) : undefined
        }
      >
        {alertes.length === 0 ? (
          <EmptyState>Rien d'urgent.</EmptyState>
        ) : (
          GROUPES_ALERTES.map((g) => {
            const items = alertes.filter((a) => a.gravite === g.gravite)
            if (items.length === 0) return null
            return (
              <div key={g.gravite}>
                <div style={STYLE_GROUPE}>
                  {g.label} ({items.length})
                </div>
                {items.map((a) => (
                  <AlerteLigne key={a.id} a={a} onSnooze={snooze} onAction={executerAlerte} />
                ))}
              </div>
            )
          })
        )}
      </Card>
      </div>

      {/* ---------- repères du jour (rail latéral discret) ---------- */}
      <aside className="cockpit-rail">
      <Card titre={<>Repères — {fmtDate(today)}</>}>
        <div className="cockpit-rail-stack">
          <Repere titre="Phases en cours">
            {phasesEnCours.length === 0 ? (
              <RienASignaler>Aucune phase en cours aujourd'hui.</RienASignaler>
            ) : (
              phasesEnCours.map(({ projet, phase }) => (
                <Ligne key={`${projet.id}-${phase.code}`}>
                  <a href={`#/projets/${projet.id}`}>
                    {projet.id} · {phase.code}
                  </a>{' '}
                  — {projet.nom}
                  <div className="muted">
                    fin prévue le <DateF d={phase.fin} />
                  </div>
                </Ligne>
              ))
            )}
          </Repere>

          <Repere titre="Prochaines factures à émettre">
            {prochainesFactures.length === 0 ? (
              <RienASignaler>Aucune facture prévue à venir.</RienASignaler>
            ) : (
              prochainesFactures.map((f) => (
                <Ligne key={f.id}>
                  <a href="#/facturation">{f.id}</a> ·{' '}
                  <a href={`#/projets/${f.projetId}`}>{f.projetId}</a> — {f.libelle}
                  <div className="muted">
                    <Money v={f.montantHT} /> HT · à émettre le <DateF d={f.emission} />
                  </div>
                </Ligne>
              ))
            )}
          </Repere>

          {evenements.length > 0 && (
            <Repere titre="Agenda (72 h, en direct)">
              {evenements.slice(0, 4).map((e) => (
                <Ligne key={e.id}>
                  <strong>{e.titre}</strong>
                  <div className="muted">
                    {e.journee
                      ? `journée du ${fmtDate(e.debut)}`
                      : new Date(e.debut).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {e.lieu ? ` · ${e.lieu}` : ''}
                  </div>
                </Ligne>
              ))}
            </Repere>
          )}
          <Repere titre="Prochaines obligations">
            {prochainesObligations.length === 0 ? (
              <RienASignaler>Aucune obligation à venir.</RienASignaler>
            ) : (
              prochainesObligations.map((o) => (
                <Ligne key={o.id}>
                  <a href="#/agenda">{o.libelle}</a>
                  {o.organisme ? <span className="muted"> — {o.organisme}</span> : null}
                  <div className="muted">
                    échéance le <DateF d={o.echeance} />
                  </div>
                </Ligne>
              ))
            )}
          </Repere>
        </div>
      </Card>
      </aside>
      </div>
    </Page>
  )
}
