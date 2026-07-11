// ============================================================
// Cockpit — tableau de bord : météo financière, CENTRE D'ACTIONS
// (une seule file : à faire, à surveiller, information — courriers,
// tâches et alertes classés ensemble) et repères du jour.
// Tout est dérivé de l'état : aucune donnée propre au module.
// Règle d'or : une action financière ou contractuelle s'OUVRE et
// se vérifie d'abord ; le raccourci « marquer… » reste possible
// mais demande une confirmation explicite.
// ============================================================

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Alerte } from '../types'
import { useStore } from '../store'
import { Btn, Card, DateF, EmptyState, Icon, Modal, Money, Page, RowMenu, Stat, confirmer, toast, useToday } from '../ui'
import { alertesActives } from '../alerts'
import { STATUTS_ACTIFS, caCible, caRealiseAnnee, meteoFinanciere } from '../derive'
import { addDays, fmtDate, fmtMoney, fmtPct, ouvrirGmail } from '../util'
import { useSurveillanceCtx } from '../surveillance'

// ---------- petits composants locaux ----------

const STYLE_GROUPE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--ink-3)',
  margin: '12px 2px 6px',
}

// types d'alertes déjà présents comme tâches « à faire » : pas de doublon
const TYPES_DANS_INBOX = new Set<Alerte['type']>(['situation_a_verifier', 'facture_a_emettre', 'cr_en_attente'])

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

// ---------- centre d'actions : le modèle unifié ----------

/** raccourci « marquer… » : les actions financières/contractuelles portent
 *  une confirmation explicite (sinon exécution directe, toujours annulable) */
type ActionRapide =
  | { kind: 'emettre_facture'; refId: string; label: string; confirme: string }
  | { kind: 'valider_situation'; refId: string; label: string; confirme: string }
  | { kind: 'note_faite'; refId: string; projetId: string; label: string; confirme?: undefined }

interface ItemAFaire {
  id: string
  gravite: 1 | 2 | 3
  titre: ReactNode
  detail: ReactNode
  lien: string
  /** échéance (tri + filtre « cette semaine ») */
  dateLimite?: string
  /** arrivée (tri tertiaire) */
  dateReception?: string
  pour?: string
  rapide?: ActionRapide
  marqueur: 'triangle' | 'square' | 'circle'
  /** actions spécifiques rendues telles quelles (courriers) */
  actionsSpecifiques?: ReactNode
}

function itemsAFaire(state: ReturnType<typeof useStore>['state'], today: string): ItemAFaire[] {
  const items: ItemAFaire[] = []
  for (const s of state.situations.filter((x) => x.statut === 'a_verifier')) {
    items.push({
      id: `sit-${s.id}`,
      gravite: 3,
      titre: `Vérifier la situation — ${s.entreprise} (${s.mois})`,
      detail: `${s.projetId || 'projet à rattacher'}${s.montantMoisHT != null ? ` · ${fmtMoney(s.montantMoisHT)} HT` : ''} · déposée par la routine situations@`,
      lien: '#/situations',
      dateReception: s.dateReception,
      pour: s.pour,
      marqueur: 'triangle',
      rapide: {
        kind: 'valider_situation',
        refId: s.id,
        label: 'Marquer validée…',
        confirme: `Marquer la situation de ${s.entreprise} (${s.mois}${s.montantMoisHT != null ? `, ${fmtMoney(s.montantMoisHT)} HT` : ''}) comme VALIDÉE sans l'ouvrir ?\nLe décompte part ensuite en proposition de paiement.`,
      },
    })
  }
  for (const c of state.consultations.filter((x) => x.statut === 'a_etudier')) {
    items.push({
      id: `ao-${c.id}`,
      gravite: 2,
      titre: `Étudier la consultation — ${c.intitule}`,
      detail: `${c.acheteur || 'acheteur ?'}${c.dateLimite ? ` · remise le ${fmtDate(c.dateLimite)}` : ''} · avis Go/No-Go à donner`,
      lien: '#/ao',
      dateLimite: c.dateLimite || undefined,
      pour: c.pour,
      marqueur: 'square',
    })
  }
  for (const f of state.factures.filter((x) => x.statut === 'prevue' && x.emission <= today)) {
    items.push({
      id: `fac-${f.id}`,
      gravite: 3,
      titre: `Émettre la facture ${f.id} — ${fmtMoney(f.montantHT)} HT`,
      detail: `${f.projetId} · ${f.libelle} · prévue le ${fmtDate(f.emission)}`,
      lien: '#/facturation',
      dateLimite: f.emission,
      marqueur: 'circle',
      rapide: {
        kind: 'emettre_facture',
        refId: f.id,
        label: 'Marquer émise…',
        confirme: `Marquer la facture ${f.id} (${fmtMoney(f.montantHT)} HT — ${f.libelle}) comme ÉMISE sans l'ouvrir ?\nElle entre au facturé et dans le suivi des retards à sa date d'émission.`,
      },
    })
  }
  for (const r of state.reunions.filter((x) => x.statut !== 'diffuse' && x.date <= today)) {
    items.push({
      id: `cr-${r.id}`,
      gravite: 2,
      titre: `Sortir le CR — ${r.titre}`,
      detail: `${r.projetId} · réunion du ${fmtDate(r.date)} · assistant CR dans l'onglet Chantier`,
      lien: `#/projets/${r.projetId}/chantier`,
      dateLimite: r.date,
      marqueur: 'circle',
    })
  }
  // notes de journal « à faire » non réglées
  for (const p of state.projets) {
    for (const n of p.journal) {
      if (!n.tags.includes('a-faire') || n.fait) continue
      items.push({
        id: `note-${n.id}`,
        gravite: 2,
        titre: n.texte.length > 90 ? n.texte.slice(0, 90) + '…' : n.texte,
        detail: `${p.id} · note du ${fmtDate(n.date)}${n.auteur ? ` (${n.auteur})` : ''}`,
        lien: `#/projets/${p.id}/journal`,
        dateReception: n.date,
        pour: n.auteur,
        marqueur: 'circle',
        rapide: { kind: 'note_faite', refId: n.id, projetId: p.id, label: '✓ Fait' },
      })
    }
  }
  return items
}

/** classement unique : gravité, puis date limite, puis date de réception */
function trierAFaire(a: ItemAFaire, b: ItemAFaire): number {
  return (
    b.gravite - a.gravite ||
    (a.dateLimite || '9999').localeCompare(b.dateLimite || '9999') ||
    (a.dateReception || '9999').localeCompare(b.dateReception || '9999')
  )
}

/** exécute un raccourci « marquer… » (mutation du store) */
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

/** menu « Reporter… » d'une alerte : 7 j, 30 j ou une date choisie */
function MenuReporter({ onReporter }: { onReporter: (jours: number | string) => void }) {
  return (
    <RowMenu
      label="Reporter"
      items={[
        { label: '7 jours', onClick: () => onReporter(7) },
        { label: '30 jours', onClick: () => onReporter(30) },
        {
          label: 'Choisir la date…',
          onClick: () => {
            const d = window.prompt('Réveiller cette alerte le (AAAA-MM-JJ) :')
            if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) onReporter(d)
            else if (d) toast('Date attendue au format AAAA-MM-JJ.', { tone: 'warn' })
          },
        },
      ]}
    />
  )
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

  const repondre = (c: (typeof courriers)[number]) => {
    const corps =
      `Bonjour,\n\n` +
      `Suite à votre message « ${c.objet} » :\n\n[à compléter]\n\n` +
      `Cordialement,\n${state.settings.personnes.join(' & ') || state.settings.nomAgence}\n${state.settings.nomAgence}`
    ouvrirGmail(c.de, `Re: ${c.objet}`, corps)
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
          <span className={`gmk gmk-${c.urgence === 3 ? 'triangle' : 'circle'}`} aria-hidden="true" />
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
            {c.de && (
              <Btn small kind="primary" onClick={() => repondre(c)} title="Ouvre un brouillon de réponse dans Gmail">
                Répondre
              </Btn>
            )}
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

// ---------- centre d'actions ----------

function CentreActions() {
  const { state, update, replace } = useStore()
  const today = useToday()
  const [personne, setPersonne] = useState('')
  const [toutAfficher, setToutAfficher] = useState(false)
  /** revue séquentielle : index dans `visibles` (null = fermée) */
  const [revue, setRevue] = useState<number | null>(null)

  const horizon = addDays(today, 7)

  const faireRapide = async (a: ActionRapide) => {
    if (a.confirme && !(await confirmer({ message: a.confirme, confirmerLabel: a.label.replace('…', '') }))) return
    const snap = state
    executerRapide(update, a)
    const libelle =
      a.kind === 'valider_situation' ? 'Situation validée.' : a.kind === 'emettre_facture' ? 'Facture émise.' : 'Note marquée faite.'
    toast(libelle, { undo: () => replace(snap) })
  }

  const reporter = (id: string, quand: number | string) => {
    const snap = state
    const date = typeof quand === 'number' ? addDays(today, quand) : quand
    update((d) => {
      d.settings.snoozes[id] = date
    })
    toast(`Alerte reportée au ${fmtDate(date)}.`, { undo: () => replace(snap) })
  }

  // action rapide d'une alerte : financière → confirmation explicite
  const executerAlerte = async (a: Alerte) => {
    const action = a.action!
    if (action.kind === 'emettre_facture' || action.kind === 'valider_situation') {
      const ok = await confirmer({
        message: `${a.titre}\n\nMarquer comme ${action.kind === 'emettre_facture' ? 'ÉMISE' : 'VALIDÉE'} sans ouvrir la fiche ?`,
        confirmerLabel: action.label,
      })
      if (!ok) return
    }
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
      action.kind === 'emettre_facture' ? 'Facture émise.' : action.kind === 'valider_situation' ? 'Situation validée.' : 'Obligation faite.'
    toast(libelle, { undo: () => replace(snap) })
  }

  const alertes = alertesActives(state, today).filter((a) => !TYPES_DANS_INBOX.has(a.type))
  const aSurveiller = alertes.filter((a) => a.gravite === 2)
  const information = alertes.filter((a) => a.gravite === 1)

  const tous = [...itemsAFaire(state, today), ...alertes.filter((a) => a.gravite === 3).map(alerteVersItem)].sort(trierAFaire)
  const filtres = personne ? tous.filter((i) => !i.pour || i.pour === personne) : tous
  // par défaut : les retards, aujourd'hui et cette semaine — le reste sur demande
  const masquables = filtres.filter((i) => i.dateLimite && i.dateLimite > horizon).length
  const visibles = toutAfficher ? filtres : filtres.filter((i) => !i.dateLimite || i.dateLimite <= horizon)

  const nbCourriers = state.courriers.filter(
    (c) => c.statut === 'a_traiter' && (!personne || !c.pour || c.pour === personne),
  ).length

  function alerteVersItem(a: Alerte): ItemAFaire {
    return {
      id: `al-${a.id}`,
      gravite: 3,
      titre: a.titre,
      detail: a.detail || '',
      lien: a.lien,
      dateLimite: a.date,
      marqueur: 'triangle',
      actionsSpecifiques: (
        <>
          {a.action && (
            <Btn small onClick={() => void executerAlerte(a)} title="Raccourci — confirmation demandée pour le financier">
              {a.action.label}
            </Btn>
          )}
          <MenuReporter onReporter={(quand) => reporter(a.id, quand)} />
        </>
      ),
    }
  }

  const rendreItem = (i: ItemAFaire) => (
    <div key={i.id} className={`alert-item ${i.gravite === 3 ? 'alert-3' : ''}`}>
      <span className={`gmk gmk-${i.marqueur}`} aria-hidden="true" />
      <div style={{ minWidth: 0 }}>
        <div className="alert-titre">
          {i.titre} {i.pour && <span className="badge badge-info">{i.pour}</span>}
        </div>
        <div className="alert-detail">
          {i.detail}
          {i.dateLimite && i.dateLimite < today && (
            <>
              {' '}
              <span className="badge badge-danger">en retard</span>
            </>
          )}
        </div>
      </div>
      <div className="alert-actions">
        {i.actionsSpecifiques ?? (
          <>
            {/* l'action principale OUVRE — on vérifie avant d'agir */}
            <a className="btn btn-small btn-primary" href={i.lien}>
              Ouvrir et vérifier
            </a>
            {i.rapide && (
              <Btn
                small
                onClick={() => void faireRapide(i.rapide!)}
                title={i.rapide.confirme ? 'Raccourci — une confirmation explicite est demandée' : 'Fait sur place'}
              >
                {i.rapide.label}
              </Btn>
            )}
          </>
        )}
      </div>
    </div>
  )

  const rendreAlerte = (a: Alerte) => (
    <div key={a.id} className={`alert-item alert-${a.gravite}`}>
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
          <Btn small onClick={() => void executerAlerte(a)}>
            {a.action.label}
          </Btn>
        )}
        <MenuReporter onReporter={(quand) => reporter(a.id, quand)} />
      </div>
    </div>
  )

  return (
    <Card
      titre="Centre d'actions"
      actions={
        <span className="segmente" role="group" aria-label="Filtrer par personne">
          {['', ...state.settings.personnes].map((p) => (
            <button key={p || 'tous'} aria-pressed={personne === p} onClick={() => setPersonne(p)}>
              {p || 'Tout'}
            </button>
          ))}
        </span>
      }
    >
      {/* ---------- synthèse du jour + revue séquentielle ---------- */}
      {(visibles.length > 0 || nbCourriers > 0) && (
        <p className="small" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 10px' }}>
          <strong>
            {visibles.length + nbCourriers} décision{visibles.length + nbCourriers > 1 ? 's' : ''} aujourd'hui
          </strong>
          <span className="muted">
            · environ {visibles.reduce((s, i) => s + (i.gravite === 3 ? 4 : 2), 0) + nbCourriers * 2} min
          </span>
          {visibles.length > 0 && (
            <Btn small kind="primary" onClick={() => setRevue(0)}>
              Commencer — une décision à la fois
            </Btn>
          )}
        </p>
      )}

      {/* ---------- à faire ---------- */}
      <div style={{ ...STYLE_GROUPE, marginTop: 0 }}>À faire</div>
      <LigneCourrier personne={personne} />
      {visibles.length === 0 && nbCourriers === 0 ? (
        <EmptyState>Rien à faire — le centre d'actions est calme.</EmptyState>
      ) : (
        visibles.map(rendreItem)
      )}
      {masquables > 0 && (
        <p className="small" style={{ margin: '6px 2px' }}>
          <Btn small kind="ghost" onClick={() => setToutAfficher(!toutAfficher)}>
            {toutAfficher
              ? 'Revenir à cette semaine'
              : `Afficher aussi ${masquables} échéance${masquables > 1 ? 's' : ''} à plus de 7 jours`}
          </Btn>
        </p>
      )}

      {/* ---------- à surveiller ---------- */}
      {aSurveiller.length > 0 && (
        <>
          <div style={STYLE_GROUPE}>À surveiller ({aSurveiller.length})</div>
          {aSurveiller.map(rendreAlerte)}
        </>
      )}

      {/* ---------- information (repliée par défaut) ---------- */}
      {information.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ ...STYLE_GROUPE, margin: '2px', cursor: 'pointer', display: 'list-item' }}>
            Pour information ({information.length})
          </summary>
          {information.map(rendreAlerte)}
        </details>
      )}

      {/* ---------- revue séquentielle : une décision à la fois ----------
          quand un élément est traité, la liste se raccourcit : l'index
          courant pointe alors tout seul sur la décision suivante */}
      {revue !== null &&
        (visibles.length === 0 ? (
          <Modal titre="Revue terminée" onClose={() => setRevue(null)}>
            <p>Tout est passé en revue — le centre d'actions est vide. 👏</p>
            <div className="form-foot">
              <Btn kind="primary" onClick={() => setRevue(null)}>Fermer</Btn>
            </div>
          </Modal>
        ) : (
          (() => {
            const idx = Math.min(revue, visibles.length - 1)
            return (
              <Modal titre={`Décision ${idx + 1} / ${visibles.length}`} onClose={() => setRevue(null)}>
                {rendreItem(visibles[idx])}
                <p className="muted small" style={{ margin: '8px 0 0' }}>
                  « Ouvrir et vérifier » ouvre la fiche dans cet onglet — la revue reprendra ici au retour.
                  Les raccourcis retirent la décision de la file.
                </p>
                <div className="form-foot">
                  <Btn onClick={() => setRevue(Math.max(0, idx - 1))} disabled={idx === 0}>
                    ‹ Précédente
                  </Btn>
                  <Btn
                    kind="primary"
                    onClick={() => {
                      if (idx + 1 < visibles.length) setRevue(idx + 1)
                      else {
                        setRevue(null)
                        toast('Revue terminée — toutes les décisions ont été vues.', { tone: 'ok' })
                      }
                    }}
                  >
                    {idx + 1 < visibles.length ? 'Suivante ›' : 'Terminer'}
                  </Btn>
                </div>
              </Modal>
            )
          })()
        ))}
    </Card>
  )
}

// ---------- module ----------

export default function Cockpit() {
  const { state, update } = useStore()
  const today = useToday()
  // la surveillance tourne à la racine de l'app (INT-02) — ici on ne fait que lire
  const { evenements } = useSurveillanceCtx()
  const dateFR = today.split('-').reverse().join('.')

  const meteo = meteoFinanciere(state, today)
  const excel = state.settings.dernierImportExcel

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
    <Page titre="aujourd’hui" wordmark meta={`Décisions du jour · ${dateFR}`}>
      {/* ---------- météo financière ---------- */}
      <div style={{ marginBottom: 16 }}>
        <div className="grid3">
          <Stat
            accent="yellow"
            label="Trésorerie"
            value={
              meteo.tresorerie === null ? (
                <a href="#/parametres" style={{ fontSize: 15, color: 'inherit' }}>renseigner →</a>
              ) : (
                <Money v={meteo.tresorerie} />
              )
            }
            sub={meteo.tresorerieMajLe ? `relevé du ${fmtDate(meteo.tresorerieMajLe)}` : 'solde disponible en banque'}
            tone={meteo.tresorerie !== null && meteo.tresorerie < 0 ? 'danger' : undefined}
          />
          <Stat
            accent="blue"
            label="Facturable 90 j"
            value={<Money v={meteo.facturable90j} />}
            sub="honoraires à facturer sous 90 jours"
          />
          <Stat
            accent="red"
            label="Carnet"
            value={<Money v={meteo.carnetHT} />}
            sub="honoraires signés restant au carnet"
          />
        </div>
        {caCible(state) > 0 && (() => {
          const annee = Number(today.slice(0, 4))
          const ca = caRealiseAnnee(state, annee)
          const cible = caCible(state)
          const pct = ca / cible
          const couleur = pct >= 1 ? 'var(--ok)' : pct >= 0.6 ? 'var(--c-blue)' : 'var(--c-red)'
          return (
            <div className="gauge" style={{ marginTop: 12 }}>
              <a href="#/pilotage/missions" className="gauge-t" style={{ color: 'inherit', textDecoration: 'none' }}>
                CA {annee} · {fmtPct(pct, 0)}
              </a>
              <span className="gauge-bar">
                <i style={{ width: `${Math.min(100, pct * 100)}%`, background: couleur }} />
              </span>
              <span className="gauge-t muted">
                {fmtMoney(ca)} / {fmtMoney(cible)}
              </span>
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

      {/* ---------- centre d'actions + rail latéral ---------- */}
      <div className="cockpit-cols">
        <div className="cockpit-main">
          <CentreActions />
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
