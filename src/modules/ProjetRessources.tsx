// Onglet Ressources de l'espace projet : matériaux, artisans et
// liens rattachés au fil de l'eau — tout est interconnecté avec
// la matériauthèque et l'annuaire (une seule source de vérité).

import { useState } from 'react'
import type { Projet } from '../types'
import { useStore } from '../store'
import { Badge, Btn, Card, EmptyState, Etoiles, Field, Modal, Select, Table, TextInput, toast, RowMenu } from '../ui'
import { fmtDate, fold, todayISO, uid } from '../util'

export default function ProjetRessources({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()

  const maj = (fn: (pr: Projet) => void) =>
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (pr) fn(pr)
    })

  return (
    <>
      <CarteLiens projet={p} maj={maj} />
      <div className="grid2">
        <CarteMateriauxLies projet={p} maj={maj} />
        <CarteArtisansLies projet={p} maj={maj} />
      </div>
      <CarteContactsLies projet={p} />
      <p className="muted small">
        Les fiches complètes vivent dans <a href="#/ressources">Matériaux & artisans</a> et dans le{' '}
        <a href="#/agenda">CRM</a> — ici, on rattache au projet ce qui le concerne : pas de double
        saisie, l'agence entière profite de chaque fiche.
      </p>
    </>
  )
}

type Maj = (fn: (pr: Projet) => void) => void

/** rattachement en un geste : tape le nom → Entrée. Existant = rattaché,
 *  inconnu = créé puis rattaché. Suggestions au fil de la frappe. */
function QuickAttach({
  placeholder,
  disponibles,
  onExistant,
  onCreer,
}: {
  placeholder: string
  disponibles: { id: string; nom: string; detail?: string }[]
  onExistant: (id: string) => void
  onCreer: (nom: string) => void
}) {
  const [q, setQ] = useState('')
  const cible = fold(q)
  const matches = cible
    ? disponibles.filter((d) => fold(d.nom).includes(cible)).slice(0, 5)
    : []
  const exact = disponibles.find((d) => fold(d.nom) === cible)

  const valider = () => {
    if (!q.trim()) return
    if (exact) onExistant(exact.id)
    else if (matches.length === 1) onExistant(matches[0].id)
    else onCreer(q.trim())
    setQ('')
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <input
          className="input"
          value={q}
          placeholder={placeholder}
          style={{ maxWidth: 320 }}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') valider()
          }}
        />
        <Btn small kind="primary" onClick={valider} disabled={!q.trim()}>
          {exact || matches.length === 1 ? 'Rattacher' : q.trim() ? 'Créer & rattacher' : 'Ajouter'}
        </Btn>
      </div>
      {matches.length > 0 && !exact && (
        <div className="small" style={{ marginTop: 6 }}>
          {matches.map((m) => (
            <button
              key={m.id}
              className="badge badge-info"
              style={{ border: 'none', cursor: 'pointer', marginRight: 4 }}
              onClick={() => {
                onExistant(m.id)
                setQ('')
              }}
            >
              + {m.nom}
              {m.detail ? ` (${m.detail})` : ''}
            </button>
          ))}
          <span className="muted"> — ou Entrée pour créer « {q.trim()} »</span>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// Liens & documents
// ------------------------------------------------------------------

function CarteLiens({ projet: p, maj }: { projet: Projet; maj: Maj }) {
  const [titre, setTitre] = useState('')
  const [url, setUrl] = useState('')

  const ajouter = () => {
    if (!titre.trim() || !url.trim()) return
    const u = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`
    maj((pr) => {
      pr.liens.push({ id: uid('lien'), titre: titre.trim(), url: u })
    })
    setTitre('')
    setUrl('')
  }

  return (
    <Card titre="Liens & documents (Drive, plateforme, DCE…)">
      {p.liens.length === 0 ? (
        <EmptyState>Aucun lien — dossier Drive du projet, plateforme de remise, DCE, permis…</EmptyState>
      ) : (
        <Table compact head={['Lien', 'URL', '']}>
          {p.liens.map((l) => (
            <tr key={l.id}>
              <td><strong>{l.titre}</strong></td>
              <td>
                <a href={l.url} target="_blank" rel="noreferrer" className="small">
                  {l.url.length > 60 ? l.url.slice(0, 60) + '…' : l.url} ↗
                </a>
              </td>
              <td className="right">
                <RowMenu
                  items={[
                    {
                      label: 'Retirer le lien',
                      danger: true,
                      onClick: () => maj((pr) => { pr.liens = pr.liens.filter((x) => x.id !== l.id) }),
                    },
                  ]}
                />
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
        <TextInput value={titre} onChange={setTitre} placeholder="Titre (ex. Dossier Drive)" style={{ width: 220 }} />
        <TextInput value={url} onChange={setUrl} placeholder="https://…" style={{ width: 280 }} />
        <Btn small kind="primary" onClick={ajouter} disabled={!titre.trim() || !url.trim()}>
          Ajouter
        </Btn>
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------
// Matériaux du projet
// ------------------------------------------------------------------

function CarteMateriauxLies({ projet: p, maj }: { projet: Projet; maj: Maj }) {
  const { state, update } = useStore()

  const lies = p.materiauxIds
    .map((id) => state.materiaux.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
  const disponibles = state.materiaux.filter((m) => !p.materiauxIds.includes(m.id))

  return (
    <Card titre="Matériaux du projet">
      {lies.length === 0 ? (
        <EmptyState>Aucun matériau rattaché.</EmptyState>
      ) : (
        <Table compact head={['Matériau', 'Tags', '']}>
          {lies.map((m) => (
            <tr key={m.id}>
              <td>
                <a href={`#/ressources/materiau/${m.id}`}><strong>{m.nom}</strong></a>
                {m.coutM2 != null && <div className="muted small">{m.coutM2} €/m²{m.fournisseur ? ` · ${m.fournisseur}` : ''}</div>}
              </td>
              <td>
                {m.tags.slice(0, 3).map((t) => (
                  <Badge key={t} tone="muted">{t}</Badge>
                ))}
                {m.lienFDES && (
                  <>
                    {' '}
                    <a href={m.lienFDES} target="_blank" rel="noreferrer" className="small">FDES ↗</a>
                  </>
                )}
              </td>
              <td className="right">
                <Btn
                  small
                  kind="ghost"
                  onClick={() => maj((pr) => { pr.materiauxIds = pr.materiauxIds.filter((x) => x !== m.id) })}
                >
                  Retirer
                </Btn>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <QuickAttach
        placeholder="Tapez un matériau (ex. « bardage mélèze ») puis Entrée…"
        disponibles={disponibles.map((m) => ({ id: m.id, nom: m.nom, detail: m.tags.slice(0, 2).join(', ') }))}
        onExistant={(id) => maj((pr) => { if (!pr.materiauxIds.includes(id)) pr.materiauxIds.push(id) })}
        onCreer={(nom) => {
          const id = uid('ma')
          update((d) => {
            d.materiaux.push({ id, nom, tags: ['à compléter'], notes: `Créé depuis ${p.id} (${fmtDate(todayISO())}).` })
            const pr = d.projets.find((x) => x.id === p.id)
            if (pr) pr.materiauxIds.push(id)
          })
        }}
      />
      <p className="muted small" style={{ marginTop: 6 }}>
        Fiche complète (coût, FDES…) : cliquez le nom du matériau.
      </p>
    </Card>
  )
}

// ------------------------------------------------------------------
// Artisans consultés / retenus
// ------------------------------------------------------------------

function CarteArtisansLies({ projet: p, maj }: { projet: Projet; maj: Maj }) {
  const { state, update } = useStore()
  /** artisan dont on est en train d'éditer le commentaire d'évaluation */
  const [commentePour, setCommentePour] = useState<string | null>(null)
  const [brouillon, setBrouillon] = useState('')

  const lies = p.artisanIds
    .map((id) => state.artisans.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
  const disponibles = state.artisans.filter((a) => !p.artisanIds.includes(a.id))

  const evalDe = (artisanId: string) =>
    state.evaluations.find((e) => e.artisanId === artisanId && e.projetId === p.id)

  const noter = (artisanId: string, note: number) =>
    update((d) => {
      const ex = d.evaluations.find((e) => e.artisanId === artisanId && e.projetId === p.id)
      if (ex) {
        ex.note = note
        ex.date = todayISO()
      } else {
        d.evaluations.push({ id: uid('ev'), artisanId, projetId: p.id, note, date: todayISO() })
      }
    })

  const commenter = (artisanId: string) => {
    update((d) => {
      const ex = d.evaluations.find((e) => e.artisanId === artisanId && e.projetId === p.id)
      if (ex) ex.commentaire = brouillon.trim() || undefined
    })
    setCommentePour(null)
    setBrouillon('')
  }

  return (
    <Card titre="Artisans consultés / pressentis">
      {lies.length === 0 ? (
        <EmptyState>Aucun artisan rattaché — utile dès la consultation des entreprises.</EmptyState>
      ) : (
        <Table compact head={['Entreprise', 'Note (ce chantier)', '']}>
          {lies.map((a) => {
            const ev = evalDe(a.id)
            return (
              <tr key={a.id}>
                <td>
                  <a href={`#/ressources/artisan/${a.id}`}><strong>{a.nom}</strong></a>
                  <div className="muted small">
                    {a.lots.slice(0, 2).join(', ')}
                    {a.contactNom ? ` · ${a.contactNom}` : ''}
                  </div>
                </td>
                <td>
                  <Etoiles
                    note={ev?.note ?? null}
                    onChange={(n) => noter(a.id, n)}
                    titre="Comment l'entreprise s'est comportée sur CE chantier"
                  />
                  {commentePour === a.id ? (
                    <div className="toolbar" style={{ margin: '6px 0 0' }}>
                      <TextInput value={brouillon} onChange={setBrouillon} placeholder="Commentaire (délais, qualité, SAV…)" />
                      <Btn small kind="primary" onClick={() => commenter(a.id)}>OK</Btn>
                    </div>
                  ) : ev?.commentaire ? (
                    <div className="muted small" style={{ maxWidth: 260 }}>{ev.commentaire}</div>
                  ) : null}
                </td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  {ev && commentePour !== a.id && (
                    <Btn
                      small
                      kind="ghost"
                      onClick={() => {
                        setCommentePour(a.id)
                        setBrouillon(ev.commentaire || '')
                      }}
                    >
                      Commenter
                    </Btn>
                  )}{' '}
                  <Btn
                    small
                    kind="ghost"
                    onClick={() => maj((pr) => { pr.artisanIds = pr.artisanIds.filter((x) => x !== a.id) })}
                  >
                    Retirer
                  </Btn>
                </td>
              </tr>
            )
          })}
        </Table>
      )}
      <QuickAttach
        placeholder="Tapez une entreprise (ex. « Martin BTP ») puis Entrée…"
        disponibles={disponibles.map((a) => ({ id: a.id, nom: a.nom, detail: a.lots.slice(0, 2).join(', ') }))}
        onExistant={(id) => maj((pr) => { if (!pr.artisanIds.includes(id)) pr.artisanIds.push(id) })}
        onCreer={(nom) => {
          const id = uid('ar')
          update((d) => {
            d.artisans.push({ id, nom, lots: [], notes: `Créé depuis ${p.id} (${fmtDate(todayISO())}).` })
            const pr = d.projets.find((x) => x.id === p.id)
            if (pr) pr.artisanIds.push(id)
          })
        }}
      />
      <p className="muted small" style={{ marginTop: 6 }}>
        Fiche complète (lots, décennale…) : cliquez le nom. <a href="#/ressources">Annuaire complet →</a>
      </p>
    </Card>
  )
}

// ------------------------------------------------------------------
// Contacts du projet (CRM) — lier ou créer un contact sans quitter la fiche
// ------------------------------------------------------------------

function CarteContactsLies({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()

  const lies = state.contacts.filter((c) => c.projetsIds?.includes(p.id))
  const disponibles = state.contacts.filter((c) => !c.projetsIds?.includes(p.id))

  return (
    <Card titre="Contacts du projet (CRM)">
      {lies.length === 0 ? (
        <EmptyState>Aucun contact rattaché — MOA, BET, mairie… tapez un nom ci-dessous.</EmptyState>
      ) : (
        <Table compact head={['Contact', 'Type', 'Joindre', '']}>
          {lies.map((c) => (
            <tr key={c.id}>
              <td>
                <strong>{c.nom}</strong>
                {c.organisme && <div className="muted small">{c.organisme}</div>}
              </td>
              <td>
                <Badge tone="muted">{c.type}</Badge>
                {c.role ? <span className="muted small"> {c.role}</span> : null}
              </td>
              <td className="small">{c.email || c.tel || '—'}</td>
              <td className="right">
                <Btn
                  small
                  kind="ghost"
                  onClick={() =>
                    update((d) => {
                      const x = d.contacts.find((y) => y.id === c.id)
                      if (x) x.projetsIds = (x.projetsIds || []).filter((id) => id !== p.id)
                    })
                  }
                >
                  Détacher
                </Btn>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <QuickAttach
        placeholder="Tapez un contact (ex. « Mme Lefèvre ») puis Entrée…"
        disponibles={disponibles.map((c) => ({ id: c.id, nom: c.nom, detail: c.organisme }))}
        onExistant={(id) =>
          update((d) => {
            const c = d.contacts.find((y) => y.id === id)
            if (c) c.projetsIds = [...new Set([...(c.projetsIds || []), p.id])]
          })
        }
        onCreer={(nom) => {
          update((d) => {
            d.contacts.push({
              id: uid('ct'),
              nom,
              type: 'Autre',
              projetsIds: [p.id],
              notes: `Créé depuis ${p.id} (${fmtDate(todayISO())}).`,
            })
          })
          toast(`Contact « ${nom} » créé et rattaché à ${p.id} — type et coordonnées à compléter dans le CRM.`, { tone: 'ok' })
        }}
      />
      <p className="muted small" style={{ marginTop: 6 }}>
        Relances, journal d'échanges et fiches complètes : <a href="#/agenda">Contacts & obligations →</a>
      </p>
    </Card>
  )
}
