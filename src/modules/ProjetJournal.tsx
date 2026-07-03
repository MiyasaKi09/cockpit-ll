// Onglet Journal de l'espace projet : notes datées et taggées —
// détails, solutions, décisions, échanges. Chaque note s'exporte
// en Markdown (frontmatter + tags), prêt pour un vault Obsidian.

import { useMemo, useState } from 'react'
import type { NoteJournal, Projet } from '../types'
import { useStore } from '../store'
import { Badge, Btn, Card, CopyBtn, EmptyState, Field, Select, TextArea, TextInput } from '../ui'
import { fmtDate, fold, todayISO, uid } from '../util'

function noteEnMarkdown(p: Projet, n: NoteJournal): string {
  return [
    '---',
    `projet: ${p.id}`,
    `titre_projet: "${p.nom}"`,
    `date: ${n.date}`,
    n.auteur ? `auteur: ${n.auteur}` : null,
    `tags: [${n.tags.join(', ')}]`,
    '---',
    '',
    n.texte,
  ]
    .filter((x) => x !== null)
    .join('\n')
}

export default function ProjetJournal({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const [texte, setTexte] = useState('')
  const [tags, setTags] = useState('')
  const [auteur, setAuteur] = useState(state.settings.personnes[0] || '')
  const [filtreTag, setFiltreTag] = useState('')

  const maj = (fn: (pr: Projet) => void) =>
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (pr) fn(pr)
    })

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
    maj((pr) => {
      pr.journal.push({
        id: uid('note'),
        date: todayISO(),
        auteur: auteur || undefined,
        texte: texte.trim(),
        tags: tags
          .split(',')
          .map((t) => fold(t).replace(/\s+/g, '-'))
          .filter(Boolean),
      })
    })
    setTexte('')
    setTags('')
  }

  return (
    <>
      <Card titre="Nouvelle note (détail, solution, décision, échange…)">
        <TextArea
          value={texte}
          onChange={setTexte}
          rows={4}
          placeholder="Ex. Solution retenue pour l'étanchéité de l'acrotère : relevé zinc + bavette, validée avec le BET le …"
        />
        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <TextInput value={tags} onChange={setTags} placeholder="tags, séparés, par, virgules" style={{ width: 260 }} />
          <Select
            value={auteur}
            onChange={setAuteur}
            options={state.settings.personnes.map((x) => ({ value: x, label: x }))}
            style={{ width: 120 }}
          />
          <Btn kind="primary" onClick={ajouter} disabled={!texte.trim()}>
            Ajouter au journal
          </Btn>
          <span className="muted small">
            Astuce : en fin de discussion Claude, demandez « résume en une note de journal » et collez-la ici.
          </span>
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
            <div key={n.id} className="alert-item" style={{ alignItems: 'stretch' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="small muted">
                  {fmtDate(n.date)}
                  {n.auteur ? ` · ${n.auteur}` : ''}{' '}
                  {n.tags.map((t) => (
                    <Badge key={t} tone="muted">#{t}</Badge>
                  ))}
                </div>
                <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{n.texte}</div>
              </div>
              <div className="alert-actions">
                <CopyBtn small kind="ghost" text={() => noteEnMarkdown(p, n)} label="Copier .md" />
                <Btn
                  small
                  kind="danger"
                  onClick={() => {
                    if (confirm('Supprimer cette note ?'))
                      maj((pr) => { pr.journal = pr.journal.filter((x) => x.id !== n.id) })
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
              text={() => p.journal.slice().sort((a, b) => a.date.localeCompare(b.date)).map((n) => noteEnMarkdown(p, n)).join('\n\n---\n\n')}
              label="Copier tout le journal (Markdown / Obsidian)"
            />
            <span className="muted small">frontmatter + tags : prêt à coller dans un vault Obsidian.</span>
          </div>
        )}
      </Card>
    </>
  )
}
