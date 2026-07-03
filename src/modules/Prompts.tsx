// Bibliothèque de prompts contextualisée — la pièce maîtresse du
// sans-API : un clic assemble gabarit + données de la base, copie
// dans le presse-papier, à coller dans le bon Projet Claude.
// Gabarits versionnés : quand un prompt s'améliore, toute
// l'agence en profite immédiatement.

import { useMemo, useState } from 'react'
import type { ContextePrompt, PromptTemplate } from '../types'
import { useStore } from '../store'
import { assemble, contextePourTemplate } from '../prompts'
import {
  Badge,
  Btn,
  Card,
  CopyBtn,
  EmptyState,
  Field,
  Modal,
  Page,
  Select,
  TextArea,
  TextInput,
} from '../ui'
import { fmtDate, todayISO, uid } from '../util'

const CONTEXTES: { value: ContextePrompt; label: string }[] = [
  { value: 'projet', label: 'Projet' },
  { value: 'marche', label: 'Marché de travaux' },
  { value: 'facture', label: 'Facture' },
  { value: 'consultation', label: 'Consultation (AO)' },
  { value: 'libre', label: 'Libre (sans cible)' },
]

/** aide-mémoire des placeholders par contexte (cohérent avec prompts.ts) */
const PLACEHOLDERS: Record<ContextePrompt, string[]> = {
  projet: [
    '{{fiche}}', '{{projet_id}}', '{{projet_nom}}', '{{moa}}', '{{type_mo}}', '{{adresse}}',
    '{{montant_travaux}}', '{{honoraires}}', '{{phase_en_cours}}', '{{heures_pointees}}',
    '{{heures_prevues}}', '{{date}}',
  ],
  marche: [
    '{{fiche}}', '{{fiche_marche}}', '{{entreprise}}', '{{lot}}', '{{montant_marche}}',
    '{{contact_entreprise}}', '{{email_entreprise}}', '{{mois_situation}}',
    '{{montant_situation}}', '{{date}}',
  ],
  facture: [
    '{{fiche}}', '{{facture_numero}}', '{{facture_libelle}}', '{{facture_ht}}', '{{facture_ttc}}',
    '{{facture_emission}}', '{{facture_echeance}}', '{{retard_jours}}', '{{delai_moyen_client}}',
    '{{type_mo}}', '{{date}}',
  ],
  consultation: [
    '{{consultation}}', '{{references}}', '{{charge_actuelle}}', '{{date_limite}}',
    '{{acheteur}}', '{{date}}',
  ],
  libre: ['{{date}}'],
}

function gabaritVide(): PromptTemplate {
  return {
    id: uid('tpl'),
    titre: '',
    domaine: 'Divers',
    projetClaude: 'Secrétariat',
    contexte: 'libre',
    corps: '',
    version: 1,
    majLe: todayISO(),
  }
}

export default function Prompts() {
  const { state, update } = useStore()
  const [utilise, setUtilise] = useState<PromptTemplate | null>(null)
  const [edite, setEdite] = useState<PromptTemplate | null>(null)
  const [creation, setCreation] = useState(false)

  const parDomaine = useMemo(() => {
    const map = new Map<string, PromptTemplate[]>()
    for (const t of state.prompts) {
      const list = map.get(t.domaine) || []
      list.push(t)
      map.set(t.domaine, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [state.prompts])

  const dupliquer = (t: PromptTemplate) => {
    update((d) => {
      d.prompts.push({ ...t, id: uid('tpl'), titre: `${t.titre} (copie)`, version: 1, majLe: todayISO() })
    })
  }

  const supprimer = (t: PromptTemplate) => {
    if (!confirm(`Supprimer le gabarit « ${t.titre} » ?`)) return
    update((d) => {
      d.prompts = d.prompts.filter((x) => x.id !== t.id)
    })
  }

  return (
    <Page
      titre="Bibliothèque de prompts"
      sousTitre="Un clic assemble le gabarit avec les données de la base et le copie — il ne reste qu'à le coller dans le bon Projet Claude. Les gabarits sont versionnés : une amélioration profite immédiatement à toute l'agence."
      actions={
        <Btn kind="primary" onClick={() => setCreation(true)}>
          Nouveau gabarit
        </Btn>
      }
    >
      {state.prompts.length === 0 && <EmptyState>Aucun gabarit — créez le premier.</EmptyState>}

      {parDomaine.map(([domaine, gabarits]) => (
        <Card key={domaine} titre={domaine}>
          <table className="table">
            <tbody>
              {gabarits.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.titre}</strong>
                    <div className="muted small">
                      contexte : {CONTEXTES.find((c) => c.value === t.contexte)?.label} · v{t.version} · MAJ{' '}
                      {fmtDate(t.majLe)}
                    </div>
                  </td>
                  <td>
                    <Badge tone="info">→ Projet Claude « {t.projetClaude} »</Badge>
                  </td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <Btn small kind="primary" onClick={() => setUtilise(t)}>
                      Utiliser
                    </Btn>{' '}
                    <Btn small onClick={() => setEdite(structuredClone(t))}>
                      Modifier
                    </Btn>{' '}
                    <Btn small kind="ghost" onClick={() => dupliquer(t)}>
                      Dupliquer
                    </Btn>{' '}
                    <Btn small kind="danger" onClick={() => supprimer(t)}>
                      Suppr.
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {utilise && <UtiliserGabarit t={utilise} onClose={() => setUtilise(null)} />}
      {(edite || creation) && (
        <EditerGabarit
          initiale={edite || gabaritVide()}
          creation={creation}
          onClose={() => {
            setEdite(null)
            setCreation(false)
          }}
        />
      )}
    </Page>
  )
}

function UtiliserGabarit({ t, onClose }: { t: PromptTemplate; onClose: () => void }) {
  const { state } = useStore()
  const [cibleId, setCibleId] = useState('')

  const options = useMemo(() => {
    switch (t.contexte) {
      case 'projet':
        return state.projets.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` }))
      case 'marche':
        return state.marches.map((m) => ({
          value: m.id,
          label: `${m.projetId} · ${m.lot} — ${m.entreprise}`,
        }))
      case 'facture':
        return state.factures.map((f) => ({ value: f.id, label: `${f.id} · ${f.projetId} — ${f.libelle}` }))
      case 'consultation':
        return state.consultations.map((c) => ({ value: c.id, label: c.intitule }))
      case 'libre':
        return []
    }
  }, [t.contexte, state])

  const cible = useMemo(() => {
    switch (t.contexte) {
      case 'projet':
        return { projet: state.projets.find((p) => p.id === cibleId) }
      case 'marche':
        return { marche: state.marches.find((m) => m.id === cibleId) }
      case 'facture':
        return { facture: state.factures.find((f) => f.id === cibleId) }
      case 'consultation':
        return { consultation: state.consultations.find((c) => c.id === cibleId) }
      case 'libre':
        return {}
    }
  }, [t.contexte, cibleId, state])

  const cibleManquante = t.contexte !== 'libre' && !cibleId
  const texte = cibleManquante ? '' : assemble(t.corps, contextePourTemplate(state, t, cible))

  return (
    <Modal titre={`Utiliser — ${t.titre}`} onClose={onClose} large>
      {t.contexte !== 'libre' && (
        <Field label={`Cible (${CONTEXTES.find((c) => c.value === t.contexte)?.label})`}>
          <Select
            value={cibleId}
            onChange={setCibleId}
            options={[{ value: '', label: '— choisir —' }, ...options]}
          />
        </Field>
      )}
      {cibleManquante ? (
        <EmptyState>Choisissez la cible : le prompt sera assemblé avec ses données.</EmptyState>
      ) : (
        <>
          <p className="small muted" style={{ margin: '10px 0 6px' }}>
            Aperçu assemblé — à coller dans le Projet Claude <strong>« {t.projetClaude} »</strong> :
          </p>
          <pre style={{ maxHeight: 340, overflowY: 'auto' }}>{texte}</pre>
          <div className="form-foot">
            <Btn onClick={onClose}>Fermer</Btn>
            <CopyBtn text={texte} label={`Copier → « ${t.projetClaude} »`} />
          </div>
        </>
      )}
    </Modal>
  )
}

function EditerGabarit({
  initiale,
  creation,
  onClose,
}: {
  initiale: PromptTemplate
  creation: boolean
  onClose: () => void
}) {
  const { update } = useStore()
  const [t, setT] = useState<PromptTemplate>(initiale)

  const enregistrer = () => {
    update((d) => {
      const i = d.prompts.findIndex((x) => x.id === t.id)
      const maj = { ...t, majLe: todayISO(), version: creation ? 1 : t.version + 1 }
      if (i >= 0) d.prompts[i] = maj
      else d.prompts.push(maj)
    })
    onClose()
  }

  return (
    <Modal titre={creation ? 'Nouveau gabarit' : `Modifier — ${initiale.titre} (v${initiale.version} → v${initiale.version + 1})`} onClose={onClose} large>
      <div className="form-row">
        <Field label="Titre">
          <TextInput value={t.titre} onChange={(v) => setT({ ...t, titre: v })} />
        </Field>
        <Field label="Domaine">
          <TextInput value={t.domaine} onChange={(v) => setT({ ...t, domaine: v })} placeholder="Chantier, Honoraires…" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Projet Claude cible" hint="où coller le prompt assemblé">
          <TextInput value={t.projetClaude} onChange={(v) => setT({ ...t, projetClaude: v })} />
        </Field>
        <Field label="Contexte">
          <Select
            value={t.contexte}
            onChange={(v) => setT({ ...t, contexte: v as ContextePrompt })}
            options={CONTEXTES.map((c) => ({ value: c.value, label: c.label }))}
          />
        </Field>
      </div>
      <Field label="Corps du gabarit">
        <TextArea value={t.corps} onChange={(v) => setT({ ...t, corps: v })} rows={16} mono />
      </Field>
      <p className="small muted" style={{ marginTop: 8 }}>
        Placeholders disponibles ({CONTEXTES.find((c) => c.value === t.contexte)?.label}) :{' '}
        {PLACEHOLDERS[t.contexte].map((p) => (
          <code key={p} style={{ marginRight: 6 }}>
            {p}
          </code>
        ))}
      </p>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" disabled={!t.titre.trim() || !t.corps.trim()} onClick={enregistrer}>
          Enregistrer {creation ? '' : `(v${initiale.version + 1})`}
        </Btn>
      </div>
    </Modal>
  )
}
