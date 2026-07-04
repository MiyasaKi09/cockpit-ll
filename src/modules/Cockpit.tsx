// ============================================================
// Cockpit — tableau de bord : météo financière, fil d'urgences
// (alertes calculées, snoozables) et repères du jour.
// Tout est dérivé de l'état : aucune donnée propre au module.
// ============================================================

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Alerte } from '../types'
import { useStore } from '../store'
import { Btn, Card, DateF, EmptyState, Money, Page, Stat, useToday } from '../ui'
import { alertesActives } from '../alerts'
import { STATUTS_ACTIFS, meteoFinanciere } from '../derive'
import { addDays, fmtDate, fmtMoney } from '../util'

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
}: {
  a: Alerte
  onSnooze: (id: string, jours: number) => void
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

interface ItemATraiter {
  id: string
  action: string
  detail: string
  lien: string
  date?: string
  pour?: string
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
      })
    }
  }
  items.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
  return items
}

function LigneCourrier({ personne }: { personne: string }) {
  const { state, update } = useStore()
  const courriers = state.courriers
    .filter((c) => c.statut === 'a_traiter')
    .filter((c) => !personne || !c.pour || c.pour === personne)
    .sort((a, b) => (b.urgence || 0) - (a.urgence || 0) || a.dateReception.localeCompare(b.dateReception))

  if (courriers.length === 0) return null

  const traiter = (id: string) =>
    update((d) => {
      const c = d.courriers.find((x) => x.id === id)
      if (c) c.statut = 'traite'
    })

  const versJournal = (id: string) =>
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

  return (
    <>
      {courriers.map((c) => (
        <div key={c.id} className={`alert-item ${c.urgence === 3 ? 'alert-3' : ''}`}>
          <span className="alert-dot" style={{ background: c.urgence === 3 ? 'var(--danger)' : 'var(--accent)' }} />
          <div style={{ minWidth: 0 }}>
            <div className="alert-titre">
              ✉ {c.objet} {c.pour && <span className="badge badge-info">{c.pour}</span>}{' '}
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

function BoiteATraiter() {
  const { state } = useStore()
  const today = useToday()
  const [personne, setPersonne] = useState('')

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
        Tout ce que les routines et les échéances ont déposé — trié, rangé, prêt à traiter. Chaque ligne
        mène directement au bon endroit.
      </p>
      <LigneCourrier personne={personne} />
      {items.length === 0 && nbCourriers === 0 ? (
        <EmptyState>Rien à traiter — la boîte est vide. Les mails peuvent attendre.</EmptyState>
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
              <a className="btn btn-small btn-primary" href={i.lien}>
                Traiter →
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
  const { state, update } = useStore()
  const today = useToday()

  const meteo = meteoFinanciere(state, today)
  const excel = state.settings.dernierImportExcel
  const alertes = alertesActives(state, today)

  const snooze = (id: string, jours: number) =>
    update((d) => {
      d.settings.snoozes[id] = addDays(today, jours)
    })

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
      sousTitre="Claude propose, l'humain valide — intranet 100 % déterministe."
    >
      {/* ---------- météo financière ---------- */}
      <div style={{ marginBottom: 16 }}>
        <div className="grid3">
          <Stat
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
            label="Facturable à 90 jours"
            value={<Money v={meteo.facturable90j} />}
            sub="factures à émettre ou en attente d'encaissement"
          />
          <Stat
            label="Carnet de commandes"
            value={<Money v={meteo.carnetHT} />}
            sub="honoraires restant à facturer (projets signés / en cours)"
          />
        </div>
        {excel && (
          <p className="muted small" style={{ margin: '8px 2px 0' }}>
            Excel maître importé le {fmtDate(excel.date)} ({excel.fichier}) : carnet{' '}
            {fmtMoney(excel.carnetHT)}, facturé {fmtMoney(excel.factureHT)} — source maître la
            première année.
          </p>
        )}
      </div>

      {/* ---------- boîte à traiter ---------- */}
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
          <EmptyState>Rien d'urgent — le fil est calme.</EmptyState>
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
                  <AlerteLigne key={a.id} a={a} onSnooze={snooze} />
                ))}
              </div>
            )
          })
        )}
      </Card>

      {/* ---------- repères du jour ---------- */}
      <Card titre={<>Repères du jour — {fmtDate(today)}</>}>
        <div className="grid3">
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
    </Page>
  )
}
