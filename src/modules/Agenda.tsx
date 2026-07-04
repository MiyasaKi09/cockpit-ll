// Échéancier réglementaire & CRM léger — deux tables simples,
// low-tech, haute valeur. Les échéances datées alimentent le fil
// d'urgences. Export .ics : les échéances s'importent dans
// Google Agenda sans API (pont déterministe, un fichier).

import { useMemo, useState } from 'react'
import type { Contact, Obligation, TypeContact } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  DateF,
  DateInput,
  EmptyState,
  Field,
  Modal,
  NumInput,
  Page,
  Select,
  Table,
  Tabs,
  TextArea,
  TextInput,
  useToday,
} from '../ui'
import { addDays, addMonths, diffDays, download, fold, todayISO, uid } from '../util'
import { STATUTS_ACTIFS } from '../derive'

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
    for (const o of state.obligations)
      pousse(`oblig-${o.id}`, o.echeance, `⚑ ${o.libelle}`, [o.organisme, o.notes].filter(Boolean).join(' — '))
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
      sousTitre="Obligations de l'agence avec rappels, contacts avec prochaine action — les deux alimentent le fil d'urgences."
      actions={
        <Btn onClick={exporterICS} title="Fichier .ics : obligations, rendus de phases et actions CRM — à importer dans Google Agenda (sans API)">
          Exporter vers l'agenda (.ics)
        </Btn>
      }
    >
      <Tabs
        tabs={[
          { id: 'obligations', label: 'Obligations réglementaires' },
          { id: 'contacts', label: 'Contacts (CRM)' },
        ]}
        actif={onglet}
        onSelect={setOnglet}
      />
      {onglet === 'obligations' ? <OngletObligations today={today} /> : <OngletContacts today={today} />}
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
  const { state, update } = useStore()
  const [edition, setEdition] = useState<Obligation | null>(null)
  const [creation, setCreation] = useState(false)

  const obligations = useMemo(
    () => [...state.obligations].sort((a, b) => a.echeance.localeCompare(b.echeance)),
    [state.obligations],
  )

  const marquerFaite = (o: Obligation) => {
    if (o.periodiciteMois) {
      update((d) => {
        const x = d.obligations.find((y) => y.id === o.id)
        if (x) x.echeance = echeanceSuivante(x.echeance, x.periodiciteMois!)
      })
    } else if (confirm(`« ${o.libelle} » est ponctuelle : la marquer faite la supprime. Confirmer ?`)) {
      update((d) => {
        d.obligations = d.obligations.filter((x) => x.id !== o.id)
      })
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
                <tr key={o.id} className="clickable" onClick={() => setEdition(structuredClone(o))}>
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
                      onClick={() => {
                        if (confirm(`Supprimer « ${o.libelle} » ?`))
                          update((d) => {
                            d.obligations = d.obligations.filter((x) => x.id !== o.id)
                          })
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

  return (
    <Modal titre={creation ? 'Nouvelle obligation' : o.libelle} onClose={onClose}>
      <Field label="Libellé">
        <TextInput value={o.libelle} onChange={(v) => setO({ ...o, libelle: v })} />
      </Field>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Organisme">
          <TextInput value={o.organisme || ''} onChange={(v) => setO({ ...o, organisme: v })} />
        </Field>
        <Field label="Prochaine échéance">
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

function OngletContacts({ today }: { today: string }) {
  const { state, update } = useStore()
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
                <tr key={c.id} className="clickable" onClick={() => setEdition(structuredClone(c))}>
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
                    <DateF d={c.derniereInteraction} />
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
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="right" onClick={(e) => e.stopPropagation()}>
                    <Btn
                      small
                      kind="danger"
                      onClick={() => {
                        if (confirm(`Supprimer ${c.nom} ?`))
                          update((d) => {
                            d.contacts = d.contacts.filter((x) => x.id !== c.id)
                          })
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
  const { update } = useStore()
  const [c, setC] = useState<Contact>(initiale)

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
        <Field label="Dernière interaction">
          <DateInput value={c.derniereInteraction || null} onChange={(v) => setC({ ...c, derniereInteraction: v })} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Prochaine action" hint="alimente le fil d'urgences dès que la date est passée">
          <TextInput value={c.prochaineAction || ''} onChange={(v) => setC({ ...c, prochaineAction: v })} />
        </Field>
        <Field label="Pour le">
          <DateInput value={c.dateProchaineAction || null} onChange={(v) => setC({ ...c, dateProchaineAction: v })} />
        </Field>
      </div>
      <Field label="Notes">
        <TextArea value={c.notes || ''} onChange={(v) => setC({ ...c, notes: v })} rows={3} />
      </Field>
      <div className="form-foot">
        <Btn
          onClick={() => setC({ ...c, derniereInteraction: todayISO() })}
          title="Note l'interaction du jour — pensez à redonner une prochaine action"
        >
          Interaction aujourd'hui
        </Btn>
        <span className="spacer" />
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn
          kind="primary"
          disabled={!c.nom.trim()}
          onClick={() => {
            update((d) => {
              const i = d.contacts.findIndex((x) => x.id === c.id)
              if (i >= 0) d.contacts[i] = c
              else d.contacts.push(c)
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
