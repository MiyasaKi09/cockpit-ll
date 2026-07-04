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
import { navigate, useRoute } from '../ui'

/** liens inverses : projets où l'artisan intervient (rattachement ou marché) */
function projetsArtisan(state: ReturnType<typeof useStore>['state'], id: string, nom: string): string[] {
  const parRattachement = state.projets.filter((p) => p.artisanIds.includes(id)).map((p) => p.id)
  const parMarche = state.marches.filter((m) => fold(m.entreprise) === fold(nom)).map((m) => m.projetId)
  return [...new Set([...parRattachement, ...parMarche])].sort()
}

/** liens inverses : projets où le matériau est employé */
function projetsMateriau(state: ReturnType<typeof useStore>['state'], id: string): string[] {
  return state.projets.filter((p) => p.materiauxIds.includes(id)).map((p) => p.id).sort()
}

function BadgesProjets({ ids }: { ids: string[] }) {
  if (ids.length === 0) return <span className="muted">—</span>
  return (
    <>
      {ids.map((pid) => (
        <a key={pid} href={`#/projets/${pid}`} className="badge badge-info" onClick={(e) => e.stopPropagation()}>
          {pid}
        </a>
      ))}
    </>
  )
}

export default function Ressources() {
  const route = useRoute()
  if (route[1] === 'materiau' && route[2]) return <FicheMateriauPage id={route[2]} />
  if (route[1] === 'artisan' && route[2]) return <FicheArtisanPage id={route[2]} />
  return <ListeRessources ongletInitial={route[1] === 'materiaux' ? 'materiaux' : 'artisans'} />
}

function ListeRessources({ ongletInitial }: { ongletInitial: string }) {
  const [onglet, setOnglet] = useState(ongletInitial)
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
// Fiches dédiées — chaque matériau / artisan a sa page, avec ses
// infos, ses projets et son édition. La recherche pointe ici.
// ------------------------------------------------------------------

function FicheMateriauPage({ id }: { id: string }) {
  const { state, update } = useStore()
  const [edition, setEdition] = useState(false)
  const m = state.materiaux.find((x) => x.id === id)

  if (!m)
    return (
      <Page titre="Matériau introuvable">
        <Card><EmptyState>Fiche inconnue. <a href="#/ressources">← Matériaux & artisans</a></EmptyState></Card>
      </Page>
    )

  const projets = projetsMateriau(state, m.id)
  const refs = state.references.filter((r) => (r.motsCles || []).some((k) => fold(m.nom).includes(fold(k)) || fold(k).includes(fold(m.nom))))

  return (
    <Page
      titre={m.nom}
      sousTitre={<>{m.tags.map((t) => <Badge key={t} tone="muted">{t}</Badge>)}</>}
      actions={
        <>
          {m.lienFDES && (
            <a className="btn" href={m.lienFDES} target="_blank" rel="noreferrer">FDES (INIES) ↗</a>
          )}
          <Btn onClick={() => setEdition(true)}>Modifier</Btn>
          <Btn
            kind="danger"
            onClick={() => {
              if (confirm(`Supprimer ${m.nom} ?`)) {
                update((d) => {
                  d.materiaux = d.materiaux.filter((x) => x.id !== m.id)
                  for (const pr of d.projets) pr.materiauxIds = pr.materiauxIds.filter((x) => x !== m.id)
                })
                navigate('/ressources/materiaux')
              }
            }}
          >
            Supprimer
          </Btn>
        </>
      }
    >
      <p className="small" style={{ marginTop: -10, marginBottom: 14 }}>
        <a href="#/ressources/materiaux">← Tous les matériaux</a>
      </p>
      <div className="grid2">
        <Card titre="Fiche">
          <dl className="kv">
            <dt>Fournisseur</dt><dd>{m.fournisseur || '—'}</dd>
            <dt>Coût moyen</dt><dd>{m.coutM2 != null ? `${m.coutM2} €/m²` : '—'}</dd>
            <dt>FDES</dt><dd>{m.lienFDES ? <a href={m.lienFDES} target="_blank" rel="noreferrer">{m.lienFDES.slice(0, 50)}… ↗</a> : '—'}</dd>
            <dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{m.notes || '—'}</dd>
          </dl>
        </Card>
        <Card titre={`Employé sur ${projets.length} projet${projets.length > 1 ? 's' : ''}`}>
          {projets.length === 0 ? (
            <EmptyState>Pas encore rattaché à un projet — cela se fait depuis l'espace projet (Ressources) ou le journal.</EmptyState>
          ) : (
            projets.map((pid) => {
              const pr = state.projets.find((x) => x.id === pid)
              return (
                <div key={pid} className="alert-item">
                  <div>
                    <a href={`#/projets/${pid}/ressources`} className="alert-titre">{pid} — {pr?.nom || ''}</a>
                    {pr && <div className="alert-detail">{pr.statut}{pr.moa ? ` · ${pr.moa}` : ''}</div>}
                  </div>
                </div>
              )
            })
          )}
          {refs.length > 0 && (
            <p className="small muted" style={{ marginTop: 8 }}>
              Références liées : {refs.map((r) => r.nom).join(' · ')} (<a href="#/references">base de références</a>)
            </p>
          )}
        </Card>
      </div>
      {edition && (
        <FicheMateriau initiale={structuredClone(m)} creation={false} onClose={() => setEdition(false)} />
      )}
    </Page>
  )
}

function FicheArtisanPage({ id }: { id: string }) {
  const { state, update } = useStore()
  const today = useToday()
  const [edition, setEdition] = useState(false)
  const a = state.artisans.find((x) => x.id === id)

  if (!a)
    return (
      <Page titre="Artisan introuvable">
        <Card><EmptyState>Fiche inconnue. <a href="#/ressources">← Matériaux & artisans</a></EmptyState></Card>
      </Page>
    )

  const projets = projetsArtisan(state, a.id, a.nom)
  const marches = state.marches.filter((m) => fold(m.entreprise) === fold(a.nom))

  return (
    <Page
      titre={a.nom}
      sousTitre={<>{a.lots.map((l) => <Badge key={l} tone="muted">{l}</Badge>)} {badgeDecennale(a.decennaleFin, today)}</>}
      actions={
        <>
          <Btn onClick={() => setEdition(true)}>Modifier</Btn>
          <Btn
            kind="danger"
            onClick={() => {
              if (confirm(`Supprimer ${a.nom} ?`)) {
                update((d) => {
                  d.artisans = d.artisans.filter((x) => x.id !== a.id)
                  for (const pr of d.projets) pr.artisanIds = pr.artisanIds.filter((x) => x !== a.id)
                })
                navigate('/ressources')
              }
            }}
          >
            Supprimer
          </Btn>
        </>
      }
    >
      <p className="small" style={{ marginTop: -10, marginBottom: 14 }}>
        <a href="#/ressources">← Tous les artisans</a>
      </p>
      <div className="grid2">
        <Card titre="Fiche">
          <dl className="kv">
            <dt>Zone d'intervention</dt><dd>{a.zone || '—'}</dd>
            <dt>Fourchette</dt><dd>{a.fourchette || '—'}</dd>
            <dt>Décennale</dt><dd>{badgeDecennale(a.decennaleFin, today)}</dd>
            <dt>Contact chiffrage</dt><dd>{[a.contactNom, a.contactEmail, a.tel].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Notes de chantier</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{a.notes || '—'}</dd>
          </dl>
        </Card>
        <Card titre={`Présent sur ${projets.length} projet${projets.length > 1 ? 's' : ''}`}>
          {projets.length === 0 ? (
            <EmptyState>Aucun projet ni marché rattaché pour l'instant.</EmptyState>
          ) : (
            projets.map((pid) => {
              const pr = state.projets.find((x) => x.id === pid)
              const marchesProjet = marches.filter((m) => m.projetId === pid)
              return (
                <div key={pid} className="alert-item">
                  <div style={{ minWidth: 0 }}>
                    <a href={`#/projets/${pid}/chantier`} className="alert-titre">{pid} — {pr?.nom || ''}</a>
                    <div className="alert-detail">
                      {marchesProjet.length > 0
                        ? marchesProjet.map((m) => `${m.lot} (${fmtMoneyLocal(m.montantInitialHT + m.avenantsHT)})`).join(' · ')
                        : 'consulté / pressenti'}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </Card>
      </div>
      {edition && (
        <FicheArtisan
          initiale={structuredClone(a)}
          creation={false}
          onClose={() => setEdition(false)}
          onSave={(maj) => {
            update((d) => {
              const i = d.artisans.findIndex((x) => x.id === maj.id)
              if (i >= 0) d.artisans[i] = maj
            })
            setEdition(false)
          }}
        />
      )}
    </Page>
  )
}

const fmtMoneyLocal = (v: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)

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
          <Table head={['Entreprise', 'Lots', 'Projets', 'Zone', 'Fourchette', 'Décennale', 'Contact', 'Notes', '']}>
            {artisans.map((a) => (
              <tr key={a.id} className="clickable" onClick={() => navigate(`/ressources/artisan/${a.id}`)}>
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
                <td><BadgesProjets ids={projetsArtisan(state, a.id, a.nom)} /></td>
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
          <Table head={['Matériau', 'Fournisseur', 'Projets', 'Coût €/m²', 'FDES', 'Tags', 'Notes', '']}>
            {materiaux.map((m) => (
              <tr key={m.id} className="clickable" onClick={() => navigate(`/ressources/materiau/${m.id}`)}>
                <td>
                  <strong>{m.nom}</strong>
                </td>
                <td>{m.fournisseur || '—'}</td>
                <td><BadgesProjets ids={projetsMateriau(state, m.id)} /></td>
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
