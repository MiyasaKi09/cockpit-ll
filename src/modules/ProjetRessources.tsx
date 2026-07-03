// Onglet Ressources de l'espace projet : matériaux, artisans et
// liens rattachés au fil de l'eau — tout est interconnecté avec
// la matériauthèque et l'annuaire (une seule source de vérité).

import { useState } from 'react'
import type { Projet } from '../types'
import { useStore } from '../store'
import { Badge, Btn, Card, EmptyState, Field, Modal, Select, Table, TextInput } from '../ui'
import { fmtDate, uid } from '../util'

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
      <p className="muted small">
        Les fiches complètes vivent dans <a href="#/ressources">Matériaux & artisans</a> — ici, on rattache
        au projet ce qui le concerne : pas de double saisie, l'agence entière profite de chaque fiche.
      </p>
    </>
  )
}

type Maj = (fn: (pr: Projet) => void) => void

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
                <Btn
                  small
                  kind="danger"
                  onClick={() => maj((pr) => { pr.liens = pr.liens.filter((x) => x.id !== l.id) })}
                >
                  Retirer
                </Btn>
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
  const { state } = useStore()
  const [choix, setChoix] = useState('')
  const [modalCreation, setModalCreation] = useState(false)

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
                <strong>{m.nom}</strong>
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
      <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
        <Select
          value={choix}
          onChange={setChoix}
          options={[{ value: '', label: '— rattacher un matériau —' }, ...disponibles.map((m) => ({ value: m.id, label: m.nom }))]}
          style={{ maxWidth: 240 }}
        />
        <Btn
          small
          kind="primary"
          disabled={!choix}
          onClick={() => {
            maj((pr) => { if (choix && !pr.materiauxIds.includes(choix)) pr.materiauxIds.push(choix) })
            setChoix('')
          }}
        >
          Rattacher
        </Btn>
        <Btn small onClick={() => setModalCreation(true)}>+ Nouveau</Btn>
      </div>
      {modalCreation && (
        <CreationRapideMateriau
          onClose={() => setModalCreation(false)}
          onCree={(id) => maj((pr) => { pr.materiauxIds.push(id) })}
        />
      )}
    </Card>
  )
}

function CreationRapideMateriau({ onClose, onCree }: { onClose: () => void; onCree: (id: string) => void }) {
  const { update } = useStore()
  const [nom, setNom] = useState('')
  const [tags, setTags] = useState('')

  return (
    <Modal titre="Nouveau matériau (création rapide)" onClose={onClose}>
      <Field label="Nom">
        <TextInput value={nom} onChange={setNom} placeholder="Ex. Bardage mélèze à claire-voie" />
      </Field>
      <Field label="Tags (virgules)">
        <TextInput value={tags} onChange={setTags} placeholder="bois, façade, biosourcé" />
      </Field>
      <p className="muted small" style={{ marginTop: 8 }}>
        La fiche complète (fournisseur, coût, FDES) se complète plus tard dans Matériaux & artisans.
      </p>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn
          kind="primary"
          disabled={!nom.trim()}
          onClick={() => {
            const id = uid('ma')
            update((d) => {
              d.materiaux.push({
                id,
                nom: nom.trim(),
                tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
                notes: `Créé depuis l'espace projet (${fmtDate(new Date().toISOString().slice(0, 10))}).`,
              })
            })
            onCree(id)
            onClose()
          }}
        >
          Créer et rattacher
        </Btn>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
// Artisans consultés / retenus
// ------------------------------------------------------------------

function CarteArtisansLies({ projet: p, maj }: { projet: Projet; maj: Maj }) {
  const { state } = useStore()
  const [choix, setChoix] = useState('')

  const lies = p.artisanIds
    .map((id) => state.artisans.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
  const disponibles = state.artisans.filter((a) => !p.artisanIds.includes(a.id))

  return (
    <Card titre="Artisans consultés / pressentis">
      {lies.length === 0 ? (
        <EmptyState>Aucun artisan rattaché — utile dès la consultation des entreprises.</EmptyState>
      ) : (
        <Table compact head={['Entreprise', 'Lots', '']}>
          {lies.map((a) => (
            <tr key={a.id}>
              <td>
                <strong>{a.nom}</strong>
                {a.contactNom && <div className="muted small">{a.contactNom}{a.tel ? ` · ${a.tel}` : ''}</div>}
              </td>
              <td>
                {a.lots.slice(0, 3).map((l) => (
                  <Badge key={l} tone="muted">{l}</Badge>
                ))}
              </td>
              <td className="right">
                <Btn
                  small
                  kind="ghost"
                  onClick={() => maj((pr) => { pr.artisanIds = pr.artisanIds.filter((x) => x !== a.id) })}
                >
                  Retirer
                </Btn>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
        <Select
          value={choix}
          onChange={setChoix}
          options={[{ value: '', label: '— rattacher un artisan —' }, ...disponibles.map((a) => ({ value: a.id, label: `${a.nom} (${a.lots.join(', ')})` }))]}
          style={{ maxWidth: 260 }}
        />
        <Btn
          small
          kind="primary"
          disabled={!choix}
          onClick={() => {
            maj((pr) => { if (choix && !pr.artisanIds.includes(choix)) pr.artisanIds.push(choix) })
            setChoix('')
          }}
        >
          Rattacher
        </Btn>
        <a href="#/ressources" className="small" style={{ marginLeft: 6 }}>Annuaire complet →</a>
      </div>
    </Card>
  )
}
