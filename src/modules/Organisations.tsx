// ============================================================
// Clients & acheteurs — le CRM organisations (audit V3, Lot 5).
// Passer du carnet de contacts au RADAR DE RELATIONS : chaque
// organisation porte sa relation (pipeline relationnel — pas une
// procédure), ses contacts, ses consultations, son historique
// d'attributions (DECP, données ouvertes) et une prochaine action
// suggérée par des règles lisibles. APProch reste un LIEN GUIDÉ :
// pas d'API publique documentée → pas de scraping.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import type { Consultation, EtapeRelation, Organisation } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  DateInput,
  EmptyState,
  Field,
  Modal,
  Money,
  Select,
  Table,
  TextArea,
  TextInput,
  confirmer,
  ligneActivable,
  toast,
  useToday,
} from '../ui'
import type { Tone } from '../ui'
import { fmtDate, fold, todayISO, uid } from '../util'
import {
  ETAPES_RELATION,
  LIBELLE_RELATION,
  TYPES_ORGANISATION,
  URL_APPROCH,
  consultationsDe,
  contactsDe,
  interactionsDe,
  prochaineActionSuggeree,
  rapprocherOrganisations,
  rechercherAttributionsDecp,
  referencesPourOrganisation,
  type AttributionDecp,
} from '../organisations'
import { signauxPourAcheteur } from '../veille'

const TON_RELATION: Record<EtapeRelation, Tone> = {
  identifie: 'muted',
  a_comprendre: 'muted',
  relation_a_creer: 'info',
  relation_active: 'info',
  projet_potentiel: 'warn',
  consultation_attendue: 'warn',
  client: 'ok',
}

const TON_STATUT_CONSULTATION: Record<Consultation['statut'], { label: string; tone: Tone }> = {
  a_etudier: { label: 'À étudier', tone: 'info' },
  go: { label: 'Go', tone: 'ok' },
  no_go: { label: 'No-Go', tone: 'muted' },
  deposee: { label: 'Déposée', tone: 'warn' },
  gagnee: { label: 'Gagnée', tone: 'ok' },
  perdue: { label: 'Perdue', tone: 'danger' },
}

function nouvelleOrganisation(): Organisation {
  return { id: uid('org'), nom: '', relation: 'identifie', creeLe: todayISO() }
}

// ---------- liste ----------

export function OrganisationsContenu() {
  const { state, update } = useStore()
  const today = useToday()
  const [q, setQ] = useState('')
  const [filtreRelation, setFiltreRelation] = useState('')
  const [fiche, setFiche] = useState<{ o: Organisation; nouveau: boolean } | null>(null)

  const organisations = state.organisations
  const fq = fold(q)

  const derniereInteraction = (o: Organisation): string | null => interactionsDe(state, o)[0]?.date || null

  const visibles = organisations
    .filter((o) => !filtreRelation || o.relation === filtreRelation)
    .filter((o) => !fq || fold(`${o.nom} ${o.type || ''} ${o.territoire || ''} ${o.notes || ''}`).includes(fq))
    .sort(
      (a, b) =>
        (b.interet || 0) - (a.interet || 0) ||
        ETAPES_RELATION.findIndex((e) => e.id === b.relation) - ETAPES_RELATION.findIndex((e) => e.id === a.relation) ||
        a.nom.localeCompare(b.nom),
    )

  const rapprocher = () => {
    let resultat = { creees: 0, rattachees: 0 }
    update((d) => {
      resultat = rapprocherOrganisations(d)
    })
    toast(
      resultat.creees + resultat.rattachees === 0
        ? 'Rien de nouveau : tous les acheteurs connus ont déjà leur fiche.'
        : `${resultat.creees} organisation(s) créée(s), ${resultat.rattachees} rattachement(s) (consultations, contacts).`,
    )
  }

  return (
    <>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <TextInput value={q} onChange={setQ} placeholder="Rechercher (nom, type, territoire…)" style={{ minWidth: 220 }} />
        <Select
          value={filtreRelation}
          onChange={setFiltreRelation}
          options={[
            { value: '', label: `Toutes les relations (${organisations.length})` },
            ...ETAPES_RELATION.map((e) => ({
              value: e.id,
              label: `${e.label} (${organisations.filter((o) => o.relation === e.id).length})`,
            })),
          ]}
        />
        <span className="spacer" />
        <Btn small onClick={rapprocher} title="Crée les fiches manquantes depuis les acheteurs des consultations et rattache les contacts par organisme.">
          Rapprocher depuis les consultations
        </Btn>
        <Btn kind="primary" onClick={() => setFiche({ o: nouvelleOrganisation(), nouveau: true })}>
          Nouvelle organisation
        </Btn>
      </div>

      <Card titre="Clients & acheteurs">
        <p className="small muted" style={{ marginTop: 0, marginBottom: 10 }}>
          La relation se travaille AVANT la publication : le pipeline ci-dessous décrit la
          relation (pas une procédure), et chaque fiche réunit contacts, consultations,
          attributions passées (DECP) et prochaine action.
        </p>
        {organisations.length === 0 ? (
          <EmptyState>
            Aucune organisation — « Rapprocher depuis les consultations » crée les fiches des
            acheteurs déjà rencontrés.
          </EmptyState>
        ) : visibles.length === 0 ? (
          <EmptyState>Aucune organisation ne correspond à la recherche ou au filtre.</EmptyState>
        ) : (
          <Table head={['Organisation', 'Type', 'Relation', 'Consultations', 'Dernière interaction', 'Prochaine action', '']}>
            {visibles.map((o) => {
              const consultations = consultationsDe(state, o)
              const derniere = derniereInteraction(o)
              const suggestion = prochaineActionSuggeree(state, o, today)
              return (
                <tr key={o.id} className="clickable" {...ligneActivable(() => setFiche({ o: { ...o }, nouveau: false }))}>
                  <td>
                    <strong>{o.nom}</strong>
                    {o.territoire && <div className="muted small">{o.territoire}</div>}
                  </td>
                  <td>{o.type || '—'}</td>
                  <td>
                    <Badge tone={TON_RELATION[o.relation]}>{LIBELLE_RELATION[o.relation]}</Badge>
                    {o.interet === 3 && (
                      <>
                        {' '}
                        <Badge tone="warn">prioritaire</Badge>
                      </>
                    )}
                  </td>
                  <td className="right num">{consultations.length || '—'}</td>
                  <td>{derniere ? fmtDate(derniere) : <span className="muted">jamais</span>}</td>
                  <td className="small">
                    {o.prochaineAction || (suggestion ? <span className="muted">suggérée : {suggestion.action}</span> : '—')}
                  </td>
                  <td className="right">
                    <Btn small kind="ghost" onClick={() => setFiche({ o: { ...o }, nouveau: false })}>
                      Fiche
                    </Btn>
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>

      {fiche && (
        <FicheOrganisation key={fiche.o.id} initial={fiche.o} nouveau={fiche.nouveau} onClose={() => setFiche(null)} />
      )}
    </>
  )
}

// ---------- fiche ----------

function FicheOrganisation({
  initial,
  nouveau,
  onClose,
}: {
  initial: Organisation
  nouveau: boolean
  onClose: () => void
}) {
  const { state, update, replace } = useStore()
  const today = useToday()
  const [o, setO] = useState<Organisation>({ ...initial })
  const maj = (patch: Partial<Organisation>) => setO((prev) => ({ ...prev, ...patch }))

  const consultations = useMemo(() => consultationsDe(state, o), [state, o])
  const contacts = useMemo(() => contactsDe(state, o), [state, o])
  const interactions = useMemo(() => interactionsDe(state, o), [state, o])
  const references = useMemo(() => referencesPourOrganisation(state, o), [state, o])
  const suggestion = prochaineActionSuggeree(state, o, today)

  const enregistrer = () => {
    const nom = o.nom.trim()
    if (!nom) {
      toast('Le nom de l’organisation est obligatoire.', { tone: 'danger' })
      return
    }
    const propre: Organisation = { ...o, nom }
    update((d) => {
      const i = d.organisations.findIndex((x) => x.id === propre.id)
      if (i >= 0) d.organisations[i] = structuredClone(propre)
      else d.organisations.push(structuredClone(propre))
    })
    onClose()
  }

  const supprimer = async () => {
    const snap = state
    if (!(await confirmer({ message: `Supprimer la fiche « ${o.nom || 'sans nom'} » ? (les consultations et contacts restent)`, danger: true, confirmerLabel: 'Supprimer' }))) return
    update((d) => {
      d.organisations = d.organisations.filter((x) => x.id !== o.id)
      for (const c of d.consultations) if (c.organisationId === o.id) c.organisationId = null
      for (const c of d.contacts) if (c.organisationId === o.id) c.organisationId = null
    })
    toast('Organisation supprimée.', { undo: () => replace(snap) })
    onClose()
  }

  return (
    <Modal titre={nouveau ? 'Nouvelle organisation' : 'Fiche organisation'} onClose={onClose} large>
      {suggestion && !nouveau && (
        <div className="card" style={{ padding: 10, marginBottom: 12, background: 'var(--bg-soft, #f6f7fa)' }}>
          <div className="small">
            <strong>Prochaine action suggérée :</strong> {suggestion.action}
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>
            Pourquoi : {suggestion.raison}.{' '}
            <button
              type="button"
              className="linklike"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent, #2563eb)', font: 'inherit' }}
              onClick={() => maj({ prochaineAction: suggestion.action })}
            >
              Reprendre comme prochaine action
            </button>
          </div>
        </div>
      )}

      <div className="form-row">
        <Field label="Nom de l’organisation">
          <TextInput value={o.nom} onChange={(v) => maj({ nom: v })} placeholder="Commune de…, OPH…, SEM…" />
        </Field>
        <Field label="Type">
          <Select
            value={o.type || ''}
            onChange={(v) => maj({ type: v || undefined })}
            options={[{ value: '', label: '—' }, ...TYPES_ORGANISATION.map((t) => ({ value: t, label: t }))]}
          />
        </Field>
        <Field label="Territoire">
          <TextInput value={o.territoire || ''} onChange={(v) => maj({ territoire: v })} placeholder="Oise, Hauts-de-France…" />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Relation" hint="Décrit la relation, pas une procédure — le pipeline des consultations vit à côté.">
          <Select
            value={o.relation}
            onChange={(v) => maj({ relation: v as EtapeRelation })}
            options={ETAPES_RELATION.map((e) => ({ value: e.id, label: `${e.label} — ${e.aide}` }))}
          />
        </Field>
        <Field label="Intérêt stratégique">
          <Select
            value={o.interet ? String(o.interet) : ''}
            onChange={(v) => maj({ interet: v ? (Number(v) as 1 | 2 | 3) : undefined })}
            options={[
              { value: '', label: '—' },
              { value: '1', label: '1 · faible' },
              { value: '2', label: '2 · à suivre' },
              { value: '3', label: '3 · prioritaire' },
            ]}
          />
        </Field>
        <Field label="SIREN (si connu)">
          <TextInput value={o.siren || ''} onChange={(v) => maj({ siren: v })} />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Prochaine action">
          <TextInput value={o.prochaineAction || ''} onChange={(v) => maj({ prochaineAction: v })} />
        </Field>
        <Field label="Pour le">
          <DateInput value={o.dateProchaineAction ?? null} onChange={(v) => maj({ dateProchaineAction: v })} />
        </Field>
        <Field label="Profil acheteur (URL)">
          <TextInput value={o.profilAcheteur || ''} onChange={(v) => maj({ profilAcheteur: v })} placeholder="https://…" />
        </Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Notes" hint="Habitudes d’achat, budgets observés, calendrier, entourage…">
          <TextArea rows={2} value={o.notes || ''} onChange={(v) => maj({ notes: v })} />
        </Field>
      </div>

      {!nouveau && (
        <>
          <BlocRelations
            contacts={contacts}
            interactions={interactions}
            consultations={consultations}
            references={references}
          />
          <BlocDecp o={o} />
          <BlocSignaux o={o} />
          <p className="small muted" style={{ marginTop: 10 }}>
            Signaux amont : les projets d’achat annoncés se consultent sur{' '}
            <a href={URL_APPROCH} target="_blank" rel="noreferrer">
              APProch ↗
            </a>{' '}
            (recherchez « {o.nom} ») — pas d’API publique, donc pas de collecte automatique.
            {o.profilAcheteur && (
              <>
                {' '}
                Profil acheteur :{' '}
                <a href={o.profilAcheteur} target="_blank" rel="noreferrer">
                  ouvrir ↗
                </a>
              </>
            )}
          </p>
        </>
      )}

      <div className="form-foot">
        {!nouveau && (
          <Btn kind="danger" onClick={supprimer}>
            Supprimer
          </Btn>
        )}
        <span className="spacer" />
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer}>
          {nouveau ? 'Créer' : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- blocs de la fiche ----------

function BlocRelations({
  contacts,
  interactions,
  consultations,
  references,
}: {
  contacts: ReturnType<typeof contactsDe>
  interactions: ReturnType<typeof interactionsDe>
  consultations: Consultation[]
  references: ReturnType<typeof referencesPourOrganisation>
}) {
  return (
    <div className="grid2" style={{ marginTop: 12 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
          Contacts <span className="muted small">({contacts.length})</span>
        </div>
        {contacts.length === 0 ? (
          <p className="muted small">
            Aucun contact rattaché — <a href="#/ressources/contacts">l’annuaire</a> rattache par
            organisme via « Rapprocher ».
          </p>
        ) : (
          contacts.map((c) => (
            <div key={c.id} className="small" style={{ padding: '2px 0' }}>
              <strong>{c.nom}</strong>
              {c.role && <span className="muted"> · {c.role}</span>}
              {c.email && (
                <>
                  {' '}
                  · <a href={`mailto:${c.email}`}>{c.email}</a>
                </>
              )}
            </div>
          ))
        )}
        <div style={{ fontWeight: 700, fontSize: 13, margin: '10px 0 6px' }}>
          Dernières interactions <span className="muted small">({interactions.length})</span>
        </div>
        {interactions.length === 0 ? (
          <p className="muted small">Aucune interaction tracée.</p>
        ) : (
          interactions.slice(0, 4).map((i) => (
            <div key={i.id} className="small" style={{ padding: '2px 0' }}>
              <span className="muted">{fmtDate(i.date)} · {i.canal}</span> — {i.resume}
            </div>
          ))
        )}
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
          Consultations <span className="muted small">({consultations.length})</span>
        </div>
        {consultations.length === 0 ? (
          <p className="muted small">Aucune consultation connue de cet acheteur.</p>
        ) : (
          consultations.slice(0, 6).map((c) => {
            const s = TON_STATUT_CONSULTATION[c.statut]
            return (
              <div key={c.id} className="small" style={{ padding: '2px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
                <Badge tone={s.tone}>{s.label}</Badge>
                <span style={{ flex: 1 }}>{c.intitule}</span>
                {(c.statut === 'go' || c.statut === 'deposee') && <a href={`#/ao/dossiers/${c.id}`}>dossier →</a>}
              </div>
            )
          })
        )}
        <div style={{ fontWeight: 700, fontSize: 13, margin: '10px 0 6px' }}>Références à montrer</div>
        {references.length === 0 ? (
          <p className="muted small">Aucune référence proche (choisies par les mots des consultations).</p>
        ) : (
          <p className="small" style={{ margin: 0 }}>
            {references.map((r) => (
              <span key={r.id} className="badge badge-info" style={{ marginRight: 4 }}>
                {r.nom}
                {r.annee ? ` (${r.annee})` : ''}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}

/** attributions passées — DECP consolidées (données ouvertes, ~2016-2023) */
function BlocDecp({ o }: { o: Organisation }) {
  const [moeSeulement, setMoeSeulement] = useState(true)
  const [resultat, setResultat] = useState<{ total: number; attributions: AttributionDecp[] } | null>(null)
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(false)

  const chercher = async () => {
    setEnCours(true)
    setErreur('')
    try {
      setResultat(await rechercherAttributionsDecp(o.nom, { moeSeulement }))
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Recherche impossible.')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Attributions passées (DECP)</div>
      <p className="muted small" style={{ marginTop: 0, marginBottom: 8 }}>
        Données essentielles de la commande publique (data.economie.gouv.fr, couverture
        ~2016-2023) : les habitudes d’achat et les maîtres d’œuvre retenus — la mémoire, pas une
        source d’annonces.
      </p>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <Btn small kind="primary" onClick={chercher} disabled={enCours || !o.nom.trim()}>
          {enCours ? 'Recherche…' : 'Chercher les attributions'}
        </Btn>
        <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={moeSeulement} onChange={(e) => setMoeSeulement(e.target.checked)} />
          maîtrise d’œuvre seulement (CPV 71)
        </label>
        {resultat && (
          <span className="muted small">
            {resultat.total} marché(s) trouvé(s) — {resultat.attributions.length} affiché(s)
          </span>
        )}
      </div>
      {erreur && <p className="danger-text small">{erreur}</p>}
      {resultat && resultat.attributions.length > 0 && (
        <Table compact head={['Objet', 'Titulaire', 'Montant', 'Notifié le', 'Procédure']}>
          {resultat.attributions.map((a, i) => (
            <tr key={i}>
              <td className="small">{a.objet.length > 90 ? `${a.objet.slice(0, 90)}…` : a.objet}</td>
              <td className="small">{a.titulaire}</td>
              <td className="right">
                <Money v={a.montant} />
              </td>
              <td>{a.date ? fmtDate(a.date) : '—'}</td>
              <td className="small muted">{a.procedure || '—'}</td>
            </tr>
          ))}
        </Table>
      )}
      {resultat && resultat.attributions.length === 0 && (
        <p className="muted small">Aucune attribution trouvée sous ce nom — essayez une variante (sans sigle, sans parenthèses).</p>
      )}
    </div>
  )
}

/** signaux de la veille serveur mentionnant cet acheteur */
function BlocSignaux({ o }: { o: Organisation }) {
  const [signaux, setSignaux] = useState<Awaited<ReturnType<typeof signauxPourAcheteur>>>(null)
  const [charge, setCharge] = useState(false)

  useEffect(() => {
    let vivant = true
    void signauxPourAcheteur(o.nom)
      .then((s) => {
        if (vivant) {
          setSignaux(s)
          setCharge(true)
        }
      })
      .catch(() => {
        if (vivant) setCharge(true)
      })
    return () => {
      vivant = false
    }
  }, [o.nom])

  if (!charge || signaux === null) return null // espace partagé non connecté → rien à montrer
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
        Signaux récents de la veille <span className="muted small">({signaux.length})</span>
      </div>
      {signaux.length === 0 ? (
        <p className="muted small">La veille n’a rien vu passer pour cet acheteur.</p>
      ) : (
        signaux.map((s, i) => (
          <div key={i} className="small" style={{ padding: '2px 0' }}>
            <Badge tone="muted">{s.source}</Badge>{' '}
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.objet}
              </a>
            ) : (
              s.objet
            )}
            {s.dateLimite && <span className="muted"> — limite {fmtDate(s.dateLimite)}</span>}
          </div>
        ))
      )}
    </div>
  )
}
