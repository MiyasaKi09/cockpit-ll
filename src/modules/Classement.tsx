// Classement documentaire — sans API, pas d'indexation silencieuse :
// le type se choisit en deux clics, le renommage suit la nomenclature
// de l'agence. En appoint, un pré-prompt « batch » fait suggérer le
// classement de la semaine par Claude (validation humaine avant tout
// renommage).

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { STATUTS_ACTIFS } from '../derive'
import { Btn, Card, CopyBtn, Field, NumInput, Page, Select, TextArea, TextInput } from '../ui'
import { fold, todayISO } from '../util'

const TYPES_DOC = ['ADM', 'PC', 'CR', 'DCE', 'PLAN', 'FACT', 'DEVIS', 'PHOTO', 'MAIL', 'NOTE', 'CCTP', 'SITU']

/** normalise l'objet : minuscules, sans accents, tirets */
function normaliserObjet(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function Classement() {
  const { state } = useStore()
  const [date, setDate] = useState(todayISO())
  const [projet, setProjet] = useState('AGENCE')
  const [type, setType] = useState('CR')
  const [objet, setObjet] = useState('')
  const [version, setVersion] = useState<number | null>(1)
  const [liste, setListe] = useState('')

  const projetsOptions = [
    { value: 'AGENCE', label: 'AGENCE (hors projet)' },
    ...state.projets.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
  ]

  const nom = useMemo(() => {
    const d = (date || todayISO()).replaceAll('-', '')
    const o = normaliserObjet(objet) || 'objet'
    const v = String(Math.max(1, Math.round(version ?? 1))).padStart(2, '0')
    return `${d}_${projet}_${type}_${o}_v${v}`
  }, [date, projet, type, objet, version])

  const gabaritBatch = state.prompts.find((t) => t.id === 'tpl-classement-batch')

  const promptBatch = useMemo(() => {
    if (!gabaritBatch) return ''
    const codes = state.projets
      .filter((p) => STATUTS_ACTIFS.includes(p.statut))
      .map((p) => `${p.id} = ${p.nom}`)
      .join(' ; ')
    let corps = gabaritBatch.corps.replace('{{date}}', todayISO())
    corps = corps.replace('« ⟦coller la liste ici⟧ »', liste.trim() || '« ⟦coller la liste ici⟧ »')
    corps = corps.replace('Codes projets actifs : voir la liste du Projet.', `Codes projets actifs : ${codes || 'aucun projet actif'}.`)
    return corps
  }, [gabaritBatch, liste, state.projets])

  return (
    <Page
      titre="Classement documentaire"
      sousTitre={`Nomenclature de l'agence : ${state.settings.nomenclature} — à figer avant septembre, modifiable dans Paramètres.`}
    >
      <Card titre="Générer un nom de fichier conforme">
        <div className="form-row">
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO())} />
          </Field>
          <Field label="Projet">
            <Select value={projet} onChange={setProjet} options={projetsOptions} />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={setType} options={TYPES_DOC.map((t) => ({ value: t, label: t }))} />
          </Field>
          <Field label="Objet" hint="minuscules-sans-accents automatique">
            <TextInput value={objet} onChange={setObjet} placeholder="reunion chantier lot 3" />
          </Field>
          <Field label="Version">
            <NumInput value={version} onChange={setVersion} />
          </Field>
        </div>
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <code style={{ fontSize: 14 }}>{nom}</code>
          <CopyBtn text={nom} label="Copier le nom" small />
        </div>
      </Card>

      <Card titre="Batch hebdo — faire suggérer le classement par Claude">
        <p className="small muted" style={{ marginBottom: 8 }}>
          Collez la liste des fichiers du dossier « à classer » (un nom par ligne) : le pré-prompt complet
          est assemblé avec la nomenclature et les codes projets actifs, à coller dans le Projet Claude
          « {gabaritBatch?.projetClaude || 'Secrétariat'} ». Vous validez avant tout renommage.
        </p>
        <TextArea
          value={liste}
          onChange={setListe}
          rows={7}
          mono
          placeholder={'IMG_4521.jpg\nscan chantier mardi.pdf\nfacture edf mars.pdf\n…'}
        />
        <div className="form-foot">
          {gabaritBatch ? (
            <CopyBtn
              text={() => promptBatch}
              label={`Copier le pré-prompt batch → « ${gabaritBatch.projetClaude} »`}
            />
          ) : (
            <Btn disabled title="Le gabarit « tpl-classement-batch » a été supprimé de la bibliothèque">
              Gabarit batch introuvable
            </Btn>
          )}
        </div>
      </Card>
    </Page>
  )
}
