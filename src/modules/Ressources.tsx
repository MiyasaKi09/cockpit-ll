// Matériauthèque & annuaire d'artisans — fiches en dur.
// Artisans : lots, zone, décennale surveillée. Matériaux :
// coût, lien FDES (INIES) — l'argument carbone dès l'esquisse.
// Le tagging stylistique se fait par lots via un pré-prompt ;
// le retour JSON s'importe ici.

import { useMemo, useState } from 'react'
import type { Artisan, Materiau } from '../types'
import { useStore } from '../store'
import { assemble } from '../prompts'
import {
  Badge,
  Btn,
  Card,
  CopyBtn,
  DateF,
  DateInput,
  EmptyState,
  Field,
  Modal,
  Page,
  Select,
  Table,
  Tabs,
  TextArea,
  TextInput,
  NumInput,
  useToday,
} from '../ui'
import { diffDays, fmtDate, fold, todayISO, uid } from '../util'

export default function Ressources() {
  const [onglet, setOnglet] = useState('artisans')
  return (
    <Page
      titre="Matériaux & artisans"
      sousTitre="Fiches 100 % code dur : notes qualitatives issues des chantiers, décennales surveillées, FDES pour l'argument carbone."
    >
      <Tabs
        tabs={[
          { id: 'artisans', label: 'Artisans' },
          { id: 'materiaux', label: 'Matériaux' },
        ]}
        actif={onglet}
        onSelect={setOnglet}
      />
      {onglet === 'artisans' ? <OngletArtisans /> : <OngletMateriaux />}
    </Page>
  )
}

// ------------------------------------------------------------------
// Artisans
// ------------------------------------------------------------------

function badgeDecennale(fin: string | null | undefined, today: string) {
  if (!fin) return <Badge tone="muted">non renseignée</Badge>
  const dj = diffDays(today, fin)
  if (dj < 0) return <Badge tone="danger">expirée le {fmtDate(fin)}</Badge>
  if (dj <= 60) return <Badge tone="warn">expire le {fmtDate(fin)}</Badge>
  return <Badge tone="ok">OK jusqu'au {fmtDate(fin)}</Badge>
}

function artisanVide(): Artisan {
  return { id: uid('ar'), nom: '', lots: [], zone: '', fourchette: '', decennaleFin: null, contactNom: '', contactEmail: '', tel: '', notes: '' }
}

function OngletArtisans() {
  const { state, update } = useStore()
  const today = useToday()
  const [recherche, setRecherche] = useState('')
  const [filtreLot, setFiltreLot] = useState('')
  const [edition, setEdition] = useState<Artisan | null>(null)
  const [creation, setCreation] = useState(false)

  const lots = useMemo(
    () => [...new Set(state.artisans.flatMap((a) => a.lots))].sort((a, b) => a.localeCompare(b)),
    [state.artisans],
  )

  const artisans = useMemo(() => {
    const q = fold(recherche)
    return state.artisans
      .filter((a) => {
        if (filtreLot && !a.lots.includes(filtreLot)) return false
        if (!q) return true
        return fold([a.nom, a.zone, a.notes, ...(a.lots || [])].filter(Boolean).join(' ')).includes(q)
      })
      .sort((a, b) => a.nom.localeCompare(b.nom))
  }, [state.artisans, recherche, filtreLot])

  const enregistrer = (a: Artisan) => {
    update((d) => {
      const i = d.artisans.findIndex((x) => x.id === a.id)
      if (i >= 0) d.artisans[i] = a
      else d.artisans.push(a)
    })
    setEdition(null)
    setCreation(false)
  }

  return (
    <>
      <div className="toolbar">
        <TextInput value={recherche} onChange={setRecherche} placeholder="Rechercher (nom, zone, lot…)" />
        <Select
          value={filtreLot}
          onChange={setFiltreLot}
          options={[{ value: '', label: 'Tous les lots' }, ...lots.map((l) => ({ value: l, label: l }))]}
        />
        <span className="spacer" />
        <Btn kind="primary" onClick={() => setCreation(true)}>
          Nouvel artisan
        </Btn>
      </div>

      <Card>
        {artisans.length === 0 ? (
          <EmptyState>Aucun artisan — l'annuaire se remplit chantier après chantier.</EmptyState>
        ) : (
          <Table head={['Entreprise', 'Lots', 'Zone', 'Fourchette', 'Décennale', 'Contact', 'Notes', '']}>
            {artisans.map((a) => (
              <tr key={a.id} className="clickable" onClick={() => setEdition(structuredClone(a))}>
                <td>
                  <strong>{a.nom}</strong>
                </td>
                <td>
                  {a.lots.map((l) => (
                    <Badge key={l} tone="muted">
                      {l}
                    </Badge>
                  ))}
                </td>
                <td>{a.zone || '—'}</td>
                <td>{a.fourchette || '—'}</td>
                <td>{badgeDecennale(a.decennaleFin, today)}</td>
                <td>
                  {a.contactNom || '—'}
                  {a.contactEmail && <div className="muted small">{a.contactEmail}</div>}
                  {a.tel && <div className="muted small">{a.tel}</div>}
                </td>
                <td className="small">{a.notes || ''}</td>
                <td className="right" onClick={(e) => e.stopPropagation()}>
                  <Btn
                    small
                    kind="danger"
                    onClick={() => {
                      if (confirm(`Supprimer ${a.nom} ?`))
                        update((d) => {
                          d.artisans = d.artisans.filter((x) => x.id !== a.id)
                        })
                    }}
                  >
                    Suppr.
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {(edition || creation) && (
        <FicheArtisan
          initiale={edition || artisanVide()}
          creation={creation}
          onClose={() => {
            setEdition(null)
            setCreation(false)
          }}
          onSave={enregistrer}
        />
      )}
    </>
  )
}

function FicheArtisan({
  initiale,
  creation,
  onClose,
  onSave,
}: {
  initiale: Artisan
  creation: boolean
  onClose: () => void
  onSave: (a: Artisan) => void
}) {
  const [a, setA] = useState<Artisan>(initiale)
  const [lots, setLots] = useState(initiale.lots.join(', '))

  return (
    <Modal titre={creation ? 'Nouvel artisan' : a.nom} onClose={onClose} large>
      <div className="form-row">
        <Field label="Entreprise">
          <TextInput value={a.nom} onChange={(v) => setA({ ...a, nom: v })} />
        </Field>
        <Field label="Lots (virgules)">
          <TextInput value={lots} onChange={setLots} placeholder="Gros œuvre, Maçonnerie" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Zone d'intervention">
          <TextInput value={a.zone || ''} onChange={(v) => setA({ ...a, zone: v })} />
        </Field>
        <Field label="Fourchette de montants">
          <TextInput value={a.fourchette || ''} onChange={(v) => setA({ ...a, fourchette: v })} placeholder="50 k€ – 400 k€" />
        </Field>
        <Field label="Décennale valide jusqu'au">
          <DateInput value={a.decennaleFin || null} onChange={(v) => setA({ ...a, decennaleFin: v })} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Contact chiffrage">
          <TextInput value={a.contactNom || ''} onChange={(v) => setA({ ...a, contactNom: v })} />
        </Field>
        <Field label="E-mail">
          <TextInput value={a.contactEmail || ''} onChange={(v) => setA({ ...a, contactEmail: v })} />
        </Field>
        <Field label="Téléphone">
          <TextInput value={a.tel || ''} onChange={(v) => setA({ ...a, tel: v })} />
        </Field>
      </div>
      <Field label="Notes qualitatives (issues des chantiers)">
        <TextArea value={a.notes || ''} onChange={(v) => setA({ ...a, notes: v })} rows={3} />
      </Field>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn
          kind="primary"
          disabled={!a.nom.trim()}
          onClick={() => onSave({ ...a, lots: lots.split(',').map((l) => l.trim()).filter(Boolean) })}
        >
          Enregistrer
        </Btn>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
// Matériaux
// ------------------------------------------------------------------

function materiauVide(): Materiau {
  return { id: uid('ma'), nom: '', fournisseur: '', coutM2: null, lienFDES: '', tags: [], notes: '' }
}

function OngletMateriaux() {
  const { state, update } = useStore()
  const [recherche, setRecherche] = useState('')
  const [filtreTag, setFiltreTag] = useState('')
  const [edition, setEdition] = useState<Materiau | null>(null)
  const [creation, setCreation] = useState(false)
  const [importJSON, setImportJSON] = useState('')
  const [messageImport, setMessageImport] = useState('')

  const tags = useMemo(
    () => [...new Set(state.materiaux.flatMap((m) => m.tags))].sort((a, b) => a.localeCompare(b)),
    [state.materiaux],
  )

  const materiaux = useMemo(() => {
    const q = fold(recherche)
    return state.materiaux
      .filter((m) => {
        if (filtreTag && !m.tags.includes(filtreTag)) return false
        if (!q) return true
        return fold([m.nom, m.fournisseur, m.notes, ...(m.tags || [])].filter(Boolean).join(' ')).includes(q)
      })
      .sort((a, b) => a.nom.localeCompare(b.nom))
  }, [state.materiaux, recherche, filtreTag])

  const gabaritTagging = state.prompts.find((t) => t.id === 'tpl-tagging-photos')

  const importerTags = () => {
    setMessageImport('')
    let data: unknown
    try {
      const bloc = importJSON.match(/```(?:json)?\s*([\s\S]*?)```/)
      data = JSON.parse(bloc ? bloc[1] : importJSON)
    } catch (e) {
      setMessageImport(`JSON invalide : ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    if (!Array.isArray(data)) {
      setMessageImport('Attendu : un tableau d’objets {fichier, materiaux, teintes, style, vue, planche}.')
      return
    }
    let crees = 0
    let ignores = 0
    update((d) => {
      for (const raw of data as Record<string, unknown>[]) {
        const fichier = typeof raw?.fichier === 'string' ? raw.fichier : ''
        const mats = Array.isArray(raw?.materiaux) ? (raw.materiaux as unknown[]).filter((x) => typeof x === 'string') as string[] : []
        const styles = Array.isArray(raw?.style) ? (raw.style as unknown[]).filter((x) => typeof x === 'string') as string[] : []
        for (const nom of mats) {
          const propre = nom.replace(/^\?\s*/, '')
          const doute = nom.startsWith('?')
          if (d.materiaux.some((m) => fold(m.nom) === fold(propre))) {
            ignores++
            continue
          }
          d.materiaux.push({
            id: uid('ma'),
            nom: propre,
            fournisseur: '',
            coutM2: null,
            lienFDES: '',
            tags: [...new Set(['à trier', ...(doute ? ['à confirmer'] : []), ...styles.map(fold)])],
            notes: `Importé du tagging photos${fichier ? ` — fichier ${fichier}` : ''} (${todayISO()}).`,
          })
          crees++
        }
      }
    })
    setMessageImport(`${crees} matériau(x) créé(s) « à trier », ${ignores} déjà connu(s) ignoré(s).`)
    if (crees > 0) setImportJSON('')
  }

  return (
    <>
      <div className="pill-note">
        L'argument carbone dès l'esquisse : chaque matériau pointe vers sa FDES (base INIES) — vrai
        différenciateur pour un positionnement biosourcé.
      </div>

      <div className="toolbar">
        <TextInput value={recherche} onChange={setRecherche} placeholder="Rechercher (nom, fournisseur, tag…)" />
        <Select
          value={filtreTag}
          onChange={setFiltreTag}
          options={[{ value: '', label: 'Tous les tags' }, ...tags.map((t) => ({ value: t, label: t }))]}
        />
        <span className="spacer" />
        <Btn kind="primary" onClick={() => setCreation(true)}>
          Nouveau matériau
        </Btn>
      </div>

      <Card>
        {materiaux.length === 0 ? (
          <EmptyState>Aucun matériau. Le tagging à l'ingestion commence dès maintenant — il prépare la recherche future.</EmptyState>
        ) : (
          <Table head={['Matériau', 'Fournisseur', 'Coût €/m²', 'FDES', 'Tags', 'Notes', '']}>
            {materiaux.map((m) => (
              <tr key={m.id} className="clickable" onClick={() => setEdition(structuredClone(m))}>
                <td>
                  <strong>{m.nom}</strong>
                </td>
                <td>{m.fournisseur || '—'}</td>
                <td className="right num">{m.coutM2 != null ? `${m.coutM2} €` : '—'}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {m.lienFDES ? (
                    <a href={m.lienFDES} target="_blank" rel="noreferrer">
                      FDES ↗
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {m.tags.map((t) => (
                    <Badge key={t} tone={t === 'à trier' || t === 'à confirmer' ? 'warn' : 'muted'}>
                      {t}
                    </Badge>
                  ))}
                </td>
                <td className="small">{m.notes || ''}</td>
                <td className="right" onClick={(e) => e.stopPropagation()}>
                  <Btn
                    small
                    kind="danger"
                    onClick={() => {
                      if (confirm(`Supprimer ${m.nom} ?`))
                        update((d) => {
                          d.materiaux = d.materiaux.filter((x) => x.id !== m.id)
                        })
                    }}
                  >
                    Suppr.
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card titre="Tagging par lots (photos → Projet Claude « Matériauthèque »)">
        <p className="small muted">
          1. Copier le pré-prompt · 2. Le coller dans le Projet Claude avec les photos de la semaine ·
          3. Coller le bloc JSON du retour ci-dessous : les matériaux inconnus arrivent « à trier ».
        </p>
        <div className="toolbar" style={{ marginTop: 8 }}>
          {gabaritTagging ? (
            <CopyBtn
              text={() => assemble(gabaritTagging.corps, { date: fmtDate(todayISO()) })}
              label={`Copier le prompt de tagging → « ${gabaritTagging.projetClaude} »`}
            />
          ) : (
            <Btn disabled title="Gabarit « tpl-tagging-photos » supprimé de la bibliothèque">
              Gabarit de tagging introuvable
            </Btn>
          )}
        </div>
        <TextArea
          value={importJSON}
          onChange={setImportJSON}
          rows={5}
          mono
          placeholder='Collez le retour JSON du tagging ici — tableau d’objets {"fichier", "materiaux", "teintes", "style", "vue", "planche"}…'
        />
        <div className="form-foot">
          <Btn kind="primary" onClick={importerTags} disabled={!importJSON.trim()}>
            Importer les tags
          </Btn>
        </div>
        {messageImport && <p className="small" style={{ marginTop: 6 }}>{messageImport}</p>}
      </Card>

      {(edition || creation) && (
        <FicheMateriau
          initiale={edition || materiauVide()}
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

function FicheMateriau({
  initiale,
  creation,
  onClose,
}: {
  initiale: Materiau
  creation: boolean
  onClose: () => void
}) {
  const { update } = useStore()
  const [m, setM] = useState<Materiau>(initiale)
  const [tags, setTags] = useState(initiale.tags.join(', '))

  return (
    <Modal titre={creation ? 'Nouveau matériau' : m.nom} onClose={onClose}>
      <Field label="Nom">
        <TextInput value={m.nom} onChange={(v) => setM({ ...m, nom: v })} />
      </Field>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Fournisseur">
          <TextInput value={m.fournisseur || ''} onChange={(v) => setM({ ...m, fournisseur: v })} />
        </Field>
        <Field label="Coût moyen €/m²">
          <NumInput value={m.coutM2 ?? null} onChange={(v) => setM({ ...m, coutM2: v })} />
        </Field>
      </div>
      <Field label="Lien FDES (base INIES)">
        <TextInput value={m.lienFDES || ''} onChange={(v) => setM({ ...m, lienFDES: v })} placeholder="https://www.base-inies.fr/…" />
      </Field>
      <Field label="Tags (virgules)">
        <TextInput value={tags} onChange={setTags} placeholder="biosourcé, façade, bois" />
      </Field>
      <Field label="Notes">
        <TextArea value={m.notes || ''} onChange={(v) => setM({ ...m, notes: v })} rows={3} />
      </Field>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn
          kind="primary"
          disabled={!m.nom.trim()}
          onClick={() => {
            const propre = { ...m, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }
            update((d) => {
              const i = d.materiaux.findIndex((x) => x.id === propre.id)
              if (i >= 0) d.materiaux[i] = propre
              else d.materiaux.push(propre)
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
