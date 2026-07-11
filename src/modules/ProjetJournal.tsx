// Onglet Journal — la mémoire du projet, avec l'intelligence
// locale : tags suggérés automatiquement pendant la frappe
// (lexique métier + entreprises/matériaux connus), détection des
// « penser à » (→ boîte À traiter), photos reconnues en local
// (CLIP dans le navigateur) et rangées dans le Drive.
// Chaque note s'exporte en Markdown (frontmatter), prêt Obsidian.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { NoteJournal, Projet } from '../types'
import { useStore } from '../store'
import { suggererTags, taggerImage } from '../tagging'
import { lireRacine, nomConforme, rangerFichier, supporteFS, type ResultatRangement } from '../fsdrive'
import { creerDocument, empreinteSha256, enregistrerDocument } from '../registre'
import { Badge, Btn, Card, CopyBtn, EmptyState, Select, TextArea, TextInput, confirmer, toast } from '../ui'
import { fmtDate, fold, todayISO, uid } from '../util'

function noteEnMarkdown(p: Projet, n: NoteJournal): string {
  return [
    '---',
    `projet: ${p.id}`,
    `titre_projet: "${p.nom}"`,
    `date: ${n.date}`,
    n.auteur ? `auteur: ${n.auteur}` : null,
    `tags: [${n.tags.join(', ')}]`,
    n.fichier ? `fichier: "${n.fichier}"` : null,
    '---',
    '',
    n.texte,
  ]
    .filter((x) => x !== null)
    .join('\n')
}

export default function ProjetJournal({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const [texte, setTexte] = useState('')
  const [tagsManuels, setTagsManuels] = useState('')
  const [tagsRetires, setTagsRetires] = useState<string[]>([])
  const [auteur, setAuteur] = useState(state.settings.personnes[0] || '')
  const [filtreTag, setFiltreTag] = useState('')
  const [etatImage, setEtatImage] = useState('')
  const imageEnCours = useRef(false)

  const maj = (fn: (pr: Projet) => void) =>
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (pr) fn(pr)
    })

  // — intelligence locale : suggestions pendant la frappe
  const suggestion = useMemo(() => suggererTags(texte, state, p.id), [texte, state, p.id])
  const tagsAuto = suggestion.tags.filter((t) => !tagsRetires.includes(t))

  useEffect(() => {
    // les tags retirés à la main ne reviennent que si le texte change vraiment
    setTagsRetires((prev) => prev.filter((t) => suggestion.tags.includes(t)))
  }, [suggestion.tags.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const tousTags = useMemo(
    () => [...new Set(p.journal.flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b)),
    [p.journal],
  )

  const notes = p.journal
    .filter((n) => !filtreTag || n.tags.includes(filtreTag))
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))

  const ajouter = () => {
    if (!texte.trim()) return
    const manuels = tagsManuels
      .split(',')
      .map((t) => fold(t).replace(/\s+/g, '-'))
      .filter(Boolean)
    maj((pr) => {
      pr.journal.push({
        id: uid('note'),
        date: todayISO(),
        auteur: auteur || undefined,
        texte: texte.trim(),
        tags: [...new Set([...tagsAuto, ...manuels])],
        fait: suggestion.action ? false : undefined,
      })
    })
    setTexte('')
    setTagsManuels('')
    setTagsRetires([])
  }

  const importerImage = async (file: File) => {
    if (imageEnCours.current) return
    imageEnCours.current = true
    setEtatImage('Analyse de la photo…')
    try {
      const { tags, via } = await taggerImage(file, setEtatImage)
      let rangement: ResultatRangement | null = null
      if (supporteFS) {
        const racine = await lireRacine()
        if (racine) {
          setEtatImage('Rangement dans le Drive (10_PHOTOS)…')
          try {
            rangement = await rangerFichier(racine, p, '10_PHOTOS', file, nomConforme(p, 'PHOTO', '', file.name))
          } catch {
            rangement = null
          }
        }
      }
      const chemin = rangement?.chemin
      // registre documentaire : la photo devient traçable (calculée AVANT
      // la mutation — le producteur clone pour rester rejouable)
      const docPret = creerDocument({
        titre: rangement?.nomFinal || file.name,
        nomOriginal: file.name,
        source: 'depot',
        categorie: 'PHOTO',
        typeMime: file.type || undefined,
        taille: file.size,
        empreinteSha256: rangement?.empreinte || (await empreinteSha256(file)) || undefined,
        cheminDrive: chemin,
        projetId: p.id,
        statut: 'classe',
      })
      const noteId = uid('note')
      update((d) => {
        const { doc } = enregistrerDocument(d, structuredClone(docPret))
        const pr = d.projets.find((x) => x.id === p.id)
        pr?.journal.push({
          id: noteId,
          date: todayISO(),
          auteur: auteur || undefined,
          texte: `Photo — ${file.name}${chemin ? `\nRangée : ${chemin}` : '\n(non rangée : configurez le Drive dans l’onglet Documents pour le rangement automatique)'}`,
          tags,
          fichier: chemin,
          documentIds: [doc.id],
        })
      })
      setEtatImage(
        via === 'clip'
          ? `Photo analysée en local (${tags.filter((t) => t !== 'photo').join(', ') || 'aucun motif sûr'})${chemin ? ' et rangée dans le Drive' : ''}.`
          : `Modèle indisponible — tags déduits du nom de fichier${chemin ? ', photo rangée dans le Drive' : ''}.`,
      )
    } finally {
      imageEnCours.current = false
    }
  }

  const basculerFait = (n: NoteJournal) =>
    maj((pr) => {
      const note = pr.journal.find((x) => x.id === n.id)
      if (note) note.fait = !note.fait
    })

  return (
    <>
      <Card titre="Nouvelle note — les tags se posent tout seuls">
        <TextArea
          value={texte}
          onChange={setTexte}
          rows={3}
          placeholder="Ex. « penser à gérer l'ascenseur sud » — le tag à-faire et les bons mots-clés sont détectés automatiquement…"
        />
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
          {tagsAuto.length > 0 ? (
            <span className="small">
              {tagsAuto.map((t) => (
                <button
                  key={t}
                  className={`badge ${t === 'a-faire' ? 'badge-warn' : 'badge-info'}`}
                  style={{ marginRight: 4, border: 'none', cursor: 'pointer' }}
                  title="Cliquer pour retirer ce tag"
                  onClick={() => setTagsRetires((prev) => [...prev, t])}
                >
                  #{t} ✕
                </button>
              ))}
            </span>
          ) : (
            texte.trim() && <span className="muted small">aucun tag détecté — ajoutez-en à droite</span>
          )}
          <span className="spacer" />
          <TextInput value={tagsManuels} onChange={setTagsManuels} placeholder="+ tags manuels (virgules)" style={{ width: 200 }} />
          <Select
            value={auteur}
            onChange={setAuteur}
            options={state.settings.personnes.map((x) => ({ value: x, label: x }))}
            style={{ width: 110 }}
          />
          <Btn kind="primary" onClick={ajouter} disabled={!texte.trim()}>
            Ajouter
          </Btn>
        </div>
        {suggestion.action && (
          <p className="small warn-text" style={{ marginTop: 6 }}>
            Détecté comme « à faire » : la note apparaîtra dans la boîte À traiter du Cockpit jusqu'à ce
            qu'elle soit cochée.
          </p>
        )}
        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <label className="btn btn-small" style={{ cursor: 'pointer' }}>
            📷 Importer une photo (reconnue en local, rangée dans le Drive)
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importerImage(f)
                e.target.value = ''
              }}
            />
          </label>
          {texte.trim() && (
            <CopyBtn
              small
              kind="ghost"
              label="Améliorer la rédaction via Claude"
              text={() =>
                `Reformule cette note de journal de projet d'architecture en 1 à 3 phrases claires et factuelles (sans rien inventer), puis propose une ligne de tags :\n\n« ${texte.trim()} »\n\nContexte : projet ${p.id} — ${p.nom}.`
              }
            />
          )}
          {etatImage && <span className="small muted">{etatImage}</span>}
        </div>
      </Card>

      <Card
        titre={`Journal (${p.journal.length})`}
        actions={
          tousTags.length > 0 ? (
            <Select
              value={filtreTag}
              onChange={setFiltreTag}
              options={[{ value: '', label: 'Tous les tags' }, ...tousTags.map((t) => ({ value: t, label: `#${t}` }))]}
            />
          ) : undefined
        }
      >
        {notes.length === 0 ? (
          <EmptyState>Le journal est vide — la mémoire du projet se construit note après note.</EmptyState>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="alert-item" style={{ alignItems: 'stretch', opacity: n.fait ? 0.55 : 1 }}>
              {n.tags.includes('a-faire') && (
                <input
                  type="checkbox"
                  checked={!!n.fait}
                  onChange={() => basculerFait(n)}
                  title={n.fait ? 'Rouvrir' : 'Marquer comme réglé'}
                  style={{ marginTop: 6 }}
                />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="small muted">
                  {fmtDate(n.date)}
                  {n.auteur ? ` · ${n.auteur}` : ''}{' '}
                  {n.tags.map((t) => (
                    <Badge key={t} tone={t === 'a-faire' ? (n.fait ? 'muted' : 'warn') : 'muted'}>
                      #{t}
                    </Badge>
                  ))}
                </div>
                <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', textDecoration: n.fait ? 'line-through' : undefined }}>
                  {n.texte}
                </div>
              </div>
              <div className="alert-actions">
                <CopyBtn small kind="ghost" text={() => noteEnMarkdown(p, n)} label=".md" />
                <Btn
                  small
                  kind="danger"
                  onClick={async () => {
                    const snap = state
                    if (await confirmer({ message: 'Supprimer cette note ?', danger: true, confirmerLabel: 'Supprimer' })) {
                      maj((pr) => {
                        pr.journal = pr.journal.filter((x) => x.id !== n.id)
                      })
                      toast('Note supprimée.', { undo: () => replace(snap) })
                    }
                  }}
                >
                  ✕
                </Btn>
              </div>
            </div>
          ))
        )}
        {p.journal.length > 0 && (
          <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
            <CopyBtn
              kind="default"
              text={() =>
                p.journal
                  .slice()
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((n) => noteEnMarkdown(p, n))
                  .join('\n\n---\n\n')
              }
              label="Copier tout le journal (Markdown / Obsidian)"
            />
            <span className="muted small">frontmatter + tags : prêt à coller dans un vault Obsidian.</span>
          </div>
        )}
      </Card>
    </>
  )
}
