// Échéancier réglementaire & CRM léger — deux tables simples,
// low-tech, haute valeur. Les échéances datées alimentent le fil
// d'urgences. Export .ics : les échéances s'importent dans
// Google Agenda sans API (pont déterministe, un fichier).

import { useMemo, useState } from 'react'
import type { AppState, CanalInteraction, Contact, Obligation, TypeContact } from '../types'
import { useStore } from '../store'
import { ligneActivable,
  Badge,
  Btn,
  Card,
  DateF,
  DateInput,
  EmptyState,
  Field,
  Modal,
  Money,
  NumInput,
  Page,
  Select,
  Table,
  Tabs,
  TextArea,
  TextInput,
  confirmer,
  toast,
  useToday,
} from '../ui'
import { addDays, addMonths, diffDays, download, fmtDate, fold, ouvrirGmail, todayISO, uid } from '../util'
import { STATUTS_ACTIFS } from '../derive'

const CANAUX: { value: CanalInteraction; label: string }[] = [
  { value: 'appel', label: '📞 Appel' },
  { value: 'mail', label: '✉ Mail' },
  { value: 'rdv', label: '🤝 RDV' },
  { value: 'visite', label: '🏗 Visite' },
  { value: 'autre', label: 'Autre' },
]

/** dernière interaction datée d'un contact (dérivée du journal) */
function derniereInteractionDe(state: AppState, contactId: string): string | null {
  const dates = state.interactions.filter((i) => i.contactId === contactId).map((i) => i.date)
  const fiche = state.contacts.find((c) => c.id === contactId)?.derniereInteraction
  const toutes = [...dates, ...(fiche ? [fiche] : [])].sort()
  return toutes.length ? toutes[toutes.length - 1] : null
}

export default function Agenda() {
  const [onglet, setOnglet] = useState('obligations')
  const { state } = useStore()
  const today = useToday()

  const exporterICS = () => {
    const lignes: string[] = []
    const pousse = (uid_: string, dateISO: string, resume: string, description = '') => {
      lignes.push(
        'BEGIN:VEVENT',
        `UID:${uid_}@cockpit-ll`,
        `DTSTAMP:${todayISO().replaceAll('-', '')}T000000Z`,
        `DTSTART;VALUE=DATE:${dateISO.replaceAll('-', '')}`,
        `SUMMARY:${echapperICS(resume)}`,
        ...(description ? [`DESCRIPTION:${echapperICS(description)}`] : []),
        'END:VEVENT',
      )
    }
    for (const o of state.obligations) {
      pousse(`oblig-${o.id}`, o.echeance, `⚑ ${o.libelle}`, [o.organisme, o.notes].filter(Boolean).join(' — '))
      if (o.contrat && o.dateRenouvellement)
        pousse(`renouv-${o.id}`, o.dateRenouvellement, `⚑ Renouvellement : ${o.libelle} — décider avant cette date`, o.organisme || '')
    }
    for (const p of state.projets.filter((x) => STATUTS_ACTIFS.includes(x.statut)))
      for (const ph of p.phases)
        if (ph.fin && ph.montantHT > 0) pousse(`phase-${p.id}-${ph.code}`, ph.fin, `Rendu ${p.id} · ${ph.code} — ${p.nom}`)
    for (const c of state.contacts)
      if (c.dateProchaineAction)
        pousse(`crm-${c.id}`, c.dateProchaineAction, `CRM : ${c.nom}${c.organisme ? ` (${c.organisme})` : ''}`, c.prochaineAction || '')

    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cockpit LL//FR', ...lignes, 'END:VCALENDAR'].join('\r\n')
    download(`cockpit-ll-echeances-${todayISO()}.ics`, ics, 'text/calendar')
  }

  return (
    <Page
      titre="Réglementaire & CRM"
      sousTitre="Obligations et contacts à relancer — les deux alimentent le fil d'urgences."
      actions={
        <Btn onClick={exporterICS} title="Fichier .ics : obligations, rendus de phases et actions CRM — à importer dans Google Agenda (sans API)">
          Exporter vers l'agenda (.ics)
        </Btn>
      }
    >
      <Tabs
        tabs={[
          { id: 'obligations', label: 'Obligations réglementaires' },
          { id: 'contrats', label: 'Contrats de l’agence' },
          { id: 'contacts', label: 'Contacts (CRM)' },
        ]}
        actif={onglet}
        onSelect={setOnglet}
      />
      {onglet === 'obligations' && <OngletObligations today={today} />}
      {onglet === 'contrats' && <OngletContrats today={today} />}
      {onglet === 'contacts' && <OngletContacts today={today} />}
    </Page>
  )
}

function echapperICS(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

// ------------------------------------------------------------------
// Obligations
// ------------------------------------------------------------------

/** échéance suivante : même jour (plafonné au 28), +N mois */
function echeanceSuivante(echeance: string, mois: number): string {
  const ym = addMonths(echeance.slice(0, 7), mois)
  const jour = Math.min(Number(echeance.slice(8, 10)), 28)
  return `${ym}-${String(jour).padStart(2, '0')}`
}

function obligationVide(): Obligation {
  return { id: uid('ob'), libelle: '', organisme: '', echeance: addDays(todayISO(), 30), periodiciteMois: 12, rappelJours: 30, notes: '' }
}

function OngletObligations({ today }: { today: string }) {
  const { state, update, replace } = useStore()
  const [edition, setEdition] = useState<Obligation | null>(null)
  const [creation, setCreation] = useState(false)

  // les contrats de l'agence vivent dans leur propre onglet
  const obligations = useMemo(
    () => state.obligations.filter((o) => !o.contrat).sort((a, b) => a.echeance.localeCompare(b.echeance)),
    [state.obligations],
  )

  const marquerFaite = async (o: Obligation) => {
    if (o.periodiciteMois) {
      update((d) => {
        const x = d.obligations.find((y) => y.id === o.id)
        if (x) x.echeance = echeanceSuivante(x.echeance, x.periodiciteMois!)
      })
    } else if (await confirmer({ message: `« ${o.libelle} » est ponctuelle : la marquer faite la supprime. Confirmer ?`, danger: true })) {
      const snap = state
      update((d) => {
        d.obligations = d.obligations.filter((x) => x.id !== o.id)
      })
      toast('Obligation faite.', { undo: () => replace(snap) })
    }
  }

  return (
    <>
      <div className="toolbar">
        <span className="muted small">MAF, décennale, URSSAF, TVA, CFE, AG de la SAS… tout ce qui ne pardonne pas l'oubli.</span>
        <span className="spacer" />
        <Btn kind="primary" onClick={() => setCreation(true)}>
          Nouvelle obligation
        </Btn>
      </div>

      <Card>
        {obligations.length === 0 ? (
          <EmptyState>Aucune obligation enregistrée.</EmptyState>
        ) : (
          <Table head={['Obligation', 'Organisme', 'Échéance', 'Périodicité', 'Rappel', 'Notes', '']}>
            {obligations.map((o) => {
              const dj = diffDays(today, o.echeance)
              const enRappel = today >= addDays(o.echeance, -o.rappelJours)
              return (
                <tr key={o.id} className="clickable" {...ligneActivable(() => setEdition(structuredClone(o)))}>
                  <td>
                    <strong>{o.libelle}</strong>
                  </td>
                  <td>{o.organisme || '—'}</td>
                  <td>
                    <DateF d={o.echeance} />{' '}
                    {dj < 0 ? (
                      <Badge tone="danger">dépassée de {-dj} j</Badge>
                    ) : enRappel ? (
                      <Badge tone="warn">dans {dj} j</Badge>
                    ) : null}
                  </td>
                  <td>{o.periodiciteMois ? `tous les ${o.periodiciteMois} mois` : 'ponctuelle'}</td>
                  <td className="num">{o.rappelJours} j avant</td>
                  <td className="small">{o.notes || ''}</td>
                  <td className="right" onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                    <Btn small kind="primary" onClick={() => marquerFaite(o)} title={o.periodiciteMois ? 'Reconduit à la prochaine échéance' : 'Supprime (ponctuelle)'}>
                      ✓ Fait
                    </Btn>{' '}
                    <Btn
                      small
                      kind="danger"
                      onClick={async () => {
                        const snap = state
                        if (await confirmer({ message: `Supprimer « ${o.libelle} » ?`, danger: true, confirmerLabel: 'Supprimer' })) {
                          update((d) => {
                            d.obligations = d.obligations.filter((x) => x.id !== o.id)
                          })
                          toast('Obligation supprimée.', { undo: () => replace(snap) })
                        }
                      }}
                    >
                      Suppr.
                    </Btn>
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>

      {(edition || creation) && (
        <FicheObligation
          initiale={edition || obligationVide()}
          creation={creation}
          onClose={() => {
            setEdition(null)
            setCreation(false)
          }}
        />
      )}
    </>
  )
}

// ------------------------------------------------------------------
// Contrats de l'agence (assurances, licences, bail, abonnements…)
// ------------------------------------------------------------------

function contratVide(): Obligation {
  return {
    id: uid('ob'),
    libelle: '',
    organisme: '',
    echeance: addDays(todayISO(), 30),
    periodiciteMois: 12,
    rappelJours: 30,
    notes: '',
    contrat: true,
    montantAnnuel: null,
  }
}

function OngletContrats({ today }: { today: string }) {
  const { state, update, replace } = useStore()
  const [edition, setEdition] = useState<Obligation | null>(null)
  const [creation, setCreation] = useState(false)

  const contrats = useMemo(
    () => state.obligations.filter((o) => o.contrat).sort((a, b) => a.echeance.localeCompare(b.echeance)),
    [state.obligations],
  )
  const totalAnnuel = contrats.reduce((somme, o) => somme + (o.montantAnnuel || 0), 0)

  /** cellule Renouvellement : date + badge selon l'urgence de la décision */
  const celluleRenouvellement = (o: Obligation) => {
    if (!o.dateRenouvellement) return <span className="muted">—</span>
    const dj = diffDays(today, o.dateRenouvellement)
    return (
      <span>
        <DateF d={o.dateRenouvellement} />{' '}
        {dj < 0 ? (
          <Badge tone="muted">reconduit</Badge>
        ) : dj <= 45 ? (
          <Badge tone={dj <= 15 ? 'danger' : 'warn'}>décider sous {dj} j</Badge>
        ) : null}
      </span>
    )
  }

  return (
    <>
      <div className="toolbar">
        <span className="muted small">
          Assurances, licences, bail, abonnements… coût annuel et date limite de résiliation sous les yeux.
        </span>
        <span className="spacer" />
        <Btn kind="primary" onClick={() => setCreation(true)}>
          Nouveau contrat
        </Btn>
      </div>

      <Card>
        {contrats.length === 0 ? (
          <EmptyState>
            Aucun contrat suivi. Ajoutez MAF, multirisque, licences logiciels, bail… — le Cockpit
            rappellera la fenêtre de résiliation 45 jours avant chaque reconduction tacite.
          </EmptyState>
        ) : (
          <>
            <Table head={['Contrat', 'Organisme', 'Coût annuel', 'Prochaine échéance', 'Renouvellement', 'Contrat signé', '']}>
              {contrats.map((o) => {
                const dj = diffDays(today, o.echeance)
                const enRappel = today >= addDays(o.echeance, -o.rappelJours)
                return (
                  <tr key={o.id} className="clickable" {...ligneActivable(() => setEdition(structuredClone(o)))}>
                    <td>
                      <strong>{o.libelle}</strong>
                      {o.notes && <div className="muted small">{o.notes}</div>}
                    </td>
                    <td>{o.organisme || '—'}</td>
                    <td className="right">
                      <Money v={o.montantAnnuel} />
                      {o.montantAnnuel ? <span className="muted small"> / an</span> : null}
                    </td>
                    <td>
                      <DateF d={o.echeance} />{' '}
                      {dj < 0 ? (
                        <Badge tone="danger">dépassée de {-dj} j</Badge>
                      ) : enRappel ? (
                        <Badge tone="warn">dans {dj} j</Badge>
                      ) : null}
                    </td>
                    <td>{celluleRenouvellement(o)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {o.documentUrl ? (
                        <a href={o.documentUrl} target="_blank" rel="noreferrer">
                          ouvrir
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="right" onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                      <Btn
                        small
                        kind="primary"
                        onClick={() => {
                          if (o.periodiciteMois) {
                            update((d) => {
                              const x = d.obligations.find((y) => y.id === o.id)
                              if (x) x.echeance = echeanceSuivante(x.echeance, x.periodiciteMois!)
                            })
                            toast('Échéance reconduite.', { tone: 'ok' })
                          }
                        }}
                        title="Paiement fait → échéance reconduite"
                      >
                        ✓ Payé
                      </Btn>{' '}
                      <Btn
                        small
                        kind="danger"
                        onClick={async () => {
                          const snap = state
                          if (await confirmer({ message: `Supprimer le contrat « ${o.libelle} » ?`, danger: true, confirmerLabel: 'Supprimer' })) {
                            update((d) => {
                              d.obligations = d.obligations.filter((x) => x.id !== o.id)
                            })
                            toast('Contrat supprimé.', { undo: () => replace(snap) })
                          }
                        }}
                      >
                        Suppr.
                      </Btn>
                    </td>
                  </tr>
                )
              })}
            </Table>
            <p className="small" style={{ marginBottom: 0, marginTop: 10 }}>
              Total des contrats suivis : <strong><Money v={totalAnnuel} /> / an</strong>
              <span className="muted"> — à rapprocher des frais généraux saisis dans Paramètres.</span>
            </p>
          </>
        )}
      </Card>

      {(edition || creation) && (
        <FicheObligation
          initiale={edition || contratVide()}
          creation={creation}
          onClose={() => {
            setEdition(null)
            setCreation(false)
          }}
        />
      )}
    </>
  )
}

function FicheObligation({
  initiale,
  creation,
  onClose,
}: {
  initiale: Obligation
  creation: boolean
  onClose: () => void
}) {
  const { update } = useStore()
  const [o, setO] = useState<Obligation>(initiale)
  const estContrat = Boolean(o.contrat)

  return (
    <Modal
      titre={creation ? (estContrat ? 'Nouveau contrat' : 'Nouvelle obligation') : o.libelle}
      onClose={onClose}
    >
      <Field label="Libellé">
        <TextInput value={o.libelle} onChange={(v) => setO({ ...o, libelle: v })} />
      </Field>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Organisme">
          <TextInput value={o.organisme || ''} onChange={(v) => setO({ ...o, organisme: v })} />
        </Field>
        <Field label={estContrat ? 'Prochaine échéance de paiement' : 'Prochaine échéance'}>
          <DateInput value={o.echeance} onChange={(v) => setO({ ...o, echeance: v || todayISO() })} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Périodicité (mois)" hint="vide = ponctuelle">
          <NumInput value={o.periodiciteMois ?? null} onChange={(v) => setO({ ...o, periodiciteMois: v })} />
        </Field>
        <Field label="Rappel (jours avant)">
          <NumInput value={o.rappelJours} onChange={(v) => setO({ ...o, rappelJours: v ?? 30 })} />
        </Field>
      </div>
      {estContrat && (
        <>
          <div className="form-row">
            <Field label="Coût annuel (€)" hint="alimente le total des frais fixes contractuels">
              <NumInput value={o.montantAnnuel ?? null} onChange={(v) => setO({ ...o, montantAnnuel: v })} />
            </Field>
            <Field label="Renouvellement — décider avant le" hint="date limite pour résilier ou renégocier ; alerte 45 j avant">
              <DateInput
                value={o.dateRenouvellement || null}
                onChange={(v) => setO({ ...o, dateRenouvellement: v || undefined })}
              />
            </Field>
          </div>
          <Field label="Lien vers le contrat (Drive…)">
            <TextInput value={o.documentUrl || ''} onChange={(v) => setO({ ...o, documentUrl: v })} placeholder="https://…" />
          </Field>
        </>
      )}
      <Field label="Notes">
        <TextArea value={o.notes || ''} onChange={(v) => setO({ ...o, notes: v })} rows={2} />
      </Field>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn
          kind="primary"
          disabled={!o.libelle.trim() || !o.echeance}
          onClick={() => {
            update((d) => {
              const i = d.obligations.findIndex((x) => x.id === o.id)
              if (i >= 0) d.obligations[i] = o
              else d.obligations.push(o)
            })
            onClose()
          }}
        >
          Enregistrer
        </Btn>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
// Contacts (CRM)
// ------------------------------------------------------------------

const TYPES_CONTACT: TypeContact[] = ['MOA', 'Prospect', 'Entreprise', 'BET', 'Autre']

function toneContact(t: TypeContact) {
  return t === 'MOA' ? 'info' : t === 'Prospect' ? 'warn' : 'muted'
}

function contactVide(): Contact {
  return { id: uid('ct'), nom: '', organisme: '', role: '', type: 'MOA', email: '', tel: '', derniereInteraction: null, prochaineAction: '', dateProchaineAction: null, notes: '' }
}

/** ouvre un brouillon Gmail de relance pré-rempli, puis logue l'échange sortant */
function relancerParMail(state: AppState, update: (fn: (d: AppState) => void) => void, c: Contact): void {
  const agence = state.settings.nomAgence || 'l’agence'
  const objet = c.prochaineAction ? `Relance — ${c.prochaineAction}` : `Suite à notre échange — ${agence}`
  const corps =
    `Bonjour${c.nom ? ` ${c.nom}` : ''},\n\n` +
    `Je me permets de revenir vers vous${c.prochaineAction ? ` au sujet de : ${c.prochaineAction}` : ''}.\n\n` +
    `Restant à votre disposition,\n${state.settings.personnes.join(' & ') || agence}\n${agence}`
  ouvrirGmail(c.email || '', objet, corps)
  update((d) => {
    const x = d.contacts.find((y) => y.id === c.id)
    if (!x) return
    d.interactions.push({
      id: uid('int'),
      contactId: c.id,
      date: todayISO(),
      canal: 'mail',
      resume: `Relance par mail${c.prochaineAction ? ` : ${c.prochaineAction}` : ''}.`,
    })
    x.derniereInteraction = todayISO()
  })
}

/** relance faite : décale la prochaine action de relanceJours (ou la vide) + logue l'échange */
function marquerRelanceFaite(state: AppState, update: (fn: (d: AppState) => void) => void, c: Contact): void {
  update((d) => {
    const x = d.contacts.find((y) => y.id === c.id)
    if (!x) return
    d.interactions.push({
      id: uid('int'),
      contactId: c.id,
      date: todayISO(),
      canal: 'autre',
      resume: x.prochaineAction ? `Relance : ${x.prochaineAction}` : 'Relance effectuée.',
    })
    x.derniereInteraction = todayISO()
    if (x.relanceJours && x.relanceJours > 0) {
      x.dateProchaineAction = addDays(todayISO(), x.relanceJours)
    } else {
      x.dateProchaineAction = null
      x.prochaineAction = ''
    }
  })
}

function OngletContacts({ today }: { today: string }) {
  const { state, update, replace } = useStore()
  const [recherche, setRecherche] = useState('')
  const [filtreType, setFiltreType] = useState('')
  const [edition, setEdition] = useState<Contact | null>(null)
  const [creation, setCreation] = useState(false)

  const contacts = useMemo(() => {
    const q = fold(recherche)
    return state.contacts
      .filter((c) => {
        if (filtreType && c.type !== filtreType) return false
        if (!q) return true
        return fold([c.nom, c.organisme, c.role, c.email, c.notes].filter(Boolean).join(' ')).includes(q)
      })
      .sort((a, b) => (a.dateProchaineAction || '9999').localeCompare(b.dateProchaineAction || '9999'))
  }, [state.contacts, recherche, filtreType])

  return (
    <>
      <div className="toolbar">
        <TextInput value={recherche} onChange={setRecherche} placeholder="Rechercher…" />
        <Select
          value={filtreType}
          onChange={setFiltreType}
          options={[{ value: '', label: 'Tous types' }, ...TYPES_CONTACT.map((t) => ({ value: t, label: t }))]}
        />
        <span className="spacer" />
        <Btn kind="primary" onClick={() => setCreation(true)}>
          Nouveau contact
        </Btn>
      </div>

      <Card>
        {contacts.length === 0 ? (
          <EmptyState>Aucun contact — le CRM se nourrit de chaque échange.</EmptyState>
        ) : (
          <Table head={['Contact', 'Type', 'Coordonnées', 'Dernière interaction', 'Prochaine action', '']}>
            {contacts.map((c) => {
              const enRetard = c.dateProchaineAction && c.dateProchaineAction < today
              return (
                <tr key={c.id} className="clickable" {...ligneActivable(() => setEdition(structuredClone(c)))}>
                  <td>
                    <strong>{c.nom}</strong>
                    <div className="muted small">
                      {[c.role, c.organisme].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>
                    <Badge tone={toneContact(c.type)}>{c.type}</Badge>
                  </td>
                  <td className="small">
                    {c.email && <div>{c.email}</div>}
                    {c.tel && <div>{c.tel}</div>}
                  </td>
                  <td>
                    <DateF d={derniereInteractionDe(state, c.id)} />
                    {c.type === 'Prospect' && c.valeurEstimee ? (
                      <div className="muted small">opportunité <Money v={c.valeurEstimee} /></div>
                    ) : null}
                  </td>
                  <td>
                    {c.prochaineAction ? (
                      <>
                        {c.prochaineAction}{' '}
                        {c.dateProchaineAction && (
                          <Badge tone={enRetard ? 'danger' : 'muted'}>
                            {enRetard ? 'en retard — ' : ''}
                            <DateF d={c.dateProchaineAction} />
                          </Badge>
                        )}
                        {c.relanceJours ? <span className="muted small"> · récurrente {c.relanceJours} j</span> : null}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="right" onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                    {c.email && (
                      <Btn small onClick={() => relancerParMail(state, update, c)} title="Ouvrir un brouillon Gmail de relance (et journaliser l'échange)">
                        Relancer
                      </Btn>
                    )}{' '}
                    {c.dateProchaineAction && (
                      <Btn small kind="primary" onClick={() => marquerRelanceFaite(state, update, c)} title={c.relanceJours ? `Relance faite — replanifiée dans ${c.relanceJours} j` : 'Relance faite — action soldée'}>
                        ✓ Relance
                      </Btn>
                    )}{' '}
                    <Btn
                      small
                      kind="danger"
                      onClick={async () => {
                        const snap = state
                        if (await confirmer({ message: `Supprimer ${c.nom} ?`, danger: true, confirmerLabel: 'Supprimer' })) {
                          update((d) => {
                            d.contacts = d.contacts.filter((x) => x.id !== c.id)
                          })
                          toast('Contact supprimé.', { undo: () => replace(snap) })
                        }
                      }}
                    >
                      Suppr.
                    </Btn>
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>

      {(edition || creation) && (
        <FicheContact
          initiale={edition || contactVide()}
          creation={creation}
          onClose={() => {
            setEdition(null)
            setCreation(false)
          }}
        />
      )}
    </>
  )
}

function FicheContact({
  initiale,
  creation,
  onClose,
}: {
  initiale: Contact
  creation: boolean
  onClose: () => void
}) {
  const { state, update } = useStore()
  const [c, setC] = useState<Contact>(initiale)
  // saisie d'un nouvel échange
  const [canal, setCanal] = useState<CanalInteraction>('appel')
  const [resume, setResume] = useState('')
  const [projetLie, setProjetLie] = useState('')

  const interactions = state.interactions
    .filter((i) => i.contactId === c.id)
    .sort((a, b) => b.date.localeCompare(a.date))

  // projets liés : liens manuels + projets cités dans les interactions
  const projetsLies = [
    ...new Set([...(c.projetsIds || []), ...interactions.map((i) => i.projetId).filter(Boolean) as string[]]),
  ]

  const enregistrerContact = (patch?: Partial<Contact>) =>
    update((d) => {
      const fusion = { ...c, ...patch }
      const i = d.contacts.findIndex((x) => x.id === c.id)
      if (i >= 0) d.contacts[i] = fusion
      else d.contacts.push(fusion)
    })

  const loggerEchange = () => {
    if (!resume.trim()) return
    // le contact doit exister en base avant d'y rattacher un échange
    if (creation && !state.contacts.some((x) => x.id === c.id)) enregistrerContact()
    update((d) => {
      d.interactions.push({
        id: uid('int'),
        contactId: c.id,
        date: todayISO(),
        canal,
        resume: resume.trim(),
        projetId: projetLie || null,
      })
      const x = d.contacts.find((y) => y.id === c.id)
      if (x) x.derniereInteraction = todayISO()
    })
    setResume('')
    setProjetLie('')
  }

  return (
    <Modal titre={creation ? 'Nouveau contact' : c.nom} onClose={onClose} large>
      <div className="form-row">
        <Field label="Nom">
          <TextInput value={c.nom} onChange={(v) => setC({ ...c, nom: v })} />
        </Field>
        <Field label="Organisme">
          <TextInput value={c.organisme || ''} onChange={(v) => setC({ ...c, organisme: v })} />
        </Field>
        <Field label="Rôle">
          <TextInput value={c.role || ''} onChange={(v) => setC({ ...c, role: v })} />
        </Field>
        <Field label="Type">
          <Select
            value={c.type}
            onChange={(v) => setC({ ...c, type: v as TypeContact })}
            options={TYPES_CONTACT.map((t) => ({ value: t, label: t }))}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="E-mail">
          <TextInput value={c.email || ''} onChange={(v) => setC({ ...c, email: v })} />
        </Field>
        <Field label="Téléphone">
          <TextInput value={c.tel || ''} onChange={(v) => setC({ ...c, tel: v })} />
        </Field>
        {c.type === 'Prospect' && (
          <Field label="Valeur estimée (€)" hint="opportunité — alimente le pipeline">
            <NumInput value={c.valeurEstimee ?? null} onChange={(v) => setC({ ...c, valeurEstimee: v })} />
          </Field>
        )}
      </div>
      <div className="form-row">
        <Field label="Prochaine action" hint="alimente le fil d'urgences dès que la date est passée">
          <TextInput value={c.prochaineAction || ''} onChange={(v) => setC({ ...c, prochaineAction: v })} />
        </Field>
        <Field label="Pour le">
          <DateInput value={c.dateProchaineAction || null} onChange={(v) => setC({ ...c, dateProchaineAction: v })} />
        </Field>
        <Field label="Relance récurrente (jours)" hint="vide = ponctuelle ; sinon la relance se replanifie quand faite">
          <NumInput value={c.relanceJours ?? null} onChange={(v) => setC({ ...c, relanceJours: v })} />
        </Field>
      </div>
      <Field label="Notes">
        <TextArea value={c.notes || ''} onChange={(v) => setC({ ...c, notes: v })} rows={2} />
      </Field>

      {projetsLies.length > 0 && (
        <p className="small" style={{ marginTop: 10 }}>
          Projets liés :{' '}
          {projetsLies.map((id) => (
            <a key={id} href={`#/projets/${id}`} className="badge badge-info" style={{ marginRight: 4 }}>{id}</a>
          ))}
        </p>
      )}

      {/* ---------- historique des échanges ---------- */}
      <div className="card" style={{ padding: 12, marginTop: 12, background: 'var(--bg-soft, #f6f7fa)' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Historique des échanges</div>
        <div className="toolbar" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
          <Select value={canal} onChange={(v) => setCanal(v as CanalInteraction)} options={CANAUX} style={{ width: 120 }} />
          <TextInput value={resume} onChange={setResume} placeholder="Résumé de l'échange…" style={{ minWidth: 240 }} />
          <Select
            value={projetLie}
            onChange={setProjetLie}
            options={[{ value: '', label: 'Projet lié (option)' }, ...state.projets.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` }))]}
            style={{ maxWidth: 200 }}
          />
          <Btn kind="primary" onClick={loggerEchange} disabled={!resume.trim()}>Logguer</Btn>
        </div>
        {interactions.length === 0 ? (
          <p className="muted small">Aucun échange enregistré — chaque appel/mail/RDV se logue ici et ne s'écrase jamais.</p>
        ) : (
          interactions.slice(0, 20).map((i) => (
            <div key={i.id} className="small" style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
              <span className="muted">{fmtDate(i.date)}</span>{' '}
              <strong>{CANAUX.find((x) => x.value === i.canal)?.label || i.canal}</strong> — {i.resume}
              {i.projetId && <> · <a href={`#/projets/${i.projetId}`}>{i.projetId}</a></>}
            </div>
          ))
        )}
      </div>

      <div className="form-foot">
        <span className="spacer" />
        <Btn onClick={onClose}>Fermer</Btn>
        <Btn
          kind="primary"
          disabled={!c.nom.trim()}
          onClick={() => {
            enregistrerContact()
            onClose()
          }}
        >
          Enregistrer
        </Btn>
      </div>
    </Modal>
  )
}
