// ============================================================
// References.tsx — base de références de l'agence.
// CRUD complet, recherche plein texte, filtres MO / attestation,
// export texte prêt à coller dans un Projet Claude (candidatures).
// ============================================================

import { useState } from 'react'
import type { Reference, TypeMO } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  CopyBtn,
  EmptyState,
  Field,
  Modal,
  Money,
  NumInput,
  Page,
  Select,
  Table,
  TextArea,
  TextInput,
  useToday,
} from '../ui'
import { fmtDate, fmtMoney, fold, uid } from '../util'

// ---------- helpers locaux ----------

const TYPES_MO: TypeMO[] = ['Public', 'Privé pro', 'Particulier']

/** ligne d'export — même format que contexteConsultation().references */
function ligneReference(r: Reference): string {
  return `  - ${r.nom}${r.lieu ? ` (${r.lieu})` : ''}${r.annee ? `, ${r.annee}` : ''}${
    r.montantTravauxHT ? `, ${fmtMoney(r.montantTravauxHT)} HT` : ''
  }${r.mission ? `, mission ${r.mission}` : ''}${r.attestation ? ', attestation OK' : ''}`
}

function fmtSurface(m2: number | null | undefined): string {
  if (m2 === null || m2 === undefined || Number.isNaN(m2)) return '—'
  return `${m2.toLocaleString('fr-FR')} m²`
}

// ---------- formulaire (création / édition) ----------

interface FormRef {
  nom: string
  lieu: string
  annee: number | null
  typeMO: TypeMO | ''
  moa: string
  montantTravauxHT: number | null
  surfaceM2: number | null
  mission: string
  motsCles: string
  attestation: 'oui' | 'non'
  photosDossier: string
  notes: string
}

function formDepuis(r: Reference | null): FormRef {
  return {
    nom: r?.nom || '',
    lieu: r?.lieu || '',
    annee: r?.annee ?? null,
    typeMO: r?.typeMO || '',
    moa: r?.moa || '',
    montantTravauxHT: r?.montantTravauxHT ?? null,
    surfaceM2: r?.surfaceM2 ?? null,
    mission: r?.mission || '',
    motsCles: r ? r.motsCles.join(', ') : '',
    attestation: r?.attestation ? 'oui' : 'non',
    photosDossier: r?.photosDossier || '',
    notes: r?.notes || '',
  }
}

function ModalReference({
  initiale,
  onClose,
  onSave,
}: {
  initiale: Reference | null
  onClose: () => void
  onSave: (r: Reference) => void
}) {
  const [f, setF] = useState<FormRef>(() => formDepuis(initiale))
  const set = (patch: Partial<FormRef>) => setF((prev) => ({ ...prev, ...patch }))

  const enregistrer = () => {
    if (!f.nom.trim()) return
    onSave({
      id: initiale ? initiale.id : uid('ref'),
      nom: f.nom.trim(),
      lieu: f.lieu.trim() || undefined,
      annee: f.annee,
      typeMO: f.typeMO || undefined,
      moa: f.moa.trim() || undefined,
      montantTravauxHT: f.montantTravauxHT,
      surfaceM2: f.surfaceM2,
      mission: f.mission.trim() || undefined,
      motsCles: f.motsCles.split(',').map((m) => m.trim()).filter(Boolean),
      attestation: f.attestation === 'oui',
      photosDossier: f.photosDossier.trim() || undefined,
      notes: f.notes.trim() || undefined,
    })
  }

  return (
    <Modal
      titre={initiale ? `Modifier la référence — ${initiale.nom}` : 'Nouvelle référence'}
      onClose={onClose}
      large
    >
      <div className="form-row">
        <Field label="Nom de l'opération">
          <TextInput value={f.nom} onChange={(v) => set({ nom: v })} placeholder="Ex. Groupe scolaire des Tilleuls" />
        </Field>
        <Field label="Lieu">
          <TextInput value={f.lieu} onChange={(v) => set({ lieu: v })} placeholder="Ville (dép.)" />
        </Field>
        <Field label="Année de livraison">
          <NumInput value={f.annee} onChange={(v) => set({ annee: v })} placeholder="AAAA" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Type de MO">
          <Select
            value={f.typeMO}
            onChange={(v) => set({ typeMO: v as TypeMO | '' })}
            options={[
              { value: '', label: '— non renseigné —' },
              ...TYPES_MO.map((t) => ({ value: t, label: t })),
            ]}
          />
        </Field>
        <Field label="Maître d'ouvrage">
          <TextInput value={f.moa} onChange={(v) => set({ moa: v })} />
        </Field>
        <Field label="Mission" hint="Ex. Base + EXE, Base + OPC…">
          <TextInput value={f.mission} onChange={(v) => set({ mission: v })} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Montant de travaux HT (€)">
          <NumInput value={f.montantTravauxHT} onChange={(v) => set({ montantTravauxHT: v })} />
        </Field>
        <Field label="Surface (m²)">
          <NumInput value={f.surfaceM2} onChange={(v) => set({ surfaceM2: v })} />
        </Field>
        <Field label="Attestation de bonne exécution">
          <Select
            value={f.attestation}
            onChange={(v) => set({ attestation: v as 'oui' | 'non' })}
            options={[
              { value: 'non', label: 'Non (à réclamer)' },
              { value: 'oui', label: 'Oui' },
            ]}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Mots-clés" hint="Séparés par des virgules — ex. logement, réhabilitation, bois">
          <TextInput value={f.motsCles} onChange={(v) => set({ motsCles: v })} />
        </Field>
        <Field label="Dossier photos (chemin Drive)">
          <TextInput value={f.photosDossier} onChange={(v) => set({ photosDossier: v })} placeholder="Drive/References/…" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Notes">
          <TextArea value={f.notes} onChange={(v) => set({ notes: v })} rows={3} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer} disabled={!f.nom.trim()} title={!f.nom.trim() ? 'Le nom de l’opération est requis' : undefined}>
          {initiale ? 'Enregistrer' : 'Ajouter la référence'}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- module ----------

export default function References() {
  const { state, update } = useStore()
  const today = useToday()

  const [recherche, setRecherche] = useState('')
  const [filtreMO, setFiltreMO] = useState('')
  const [filtreAtt, setFiltreAtt] = useState('')
  const [modal, setModal] = useState<{ ouvert: boolean; ref: Reference | null }>({
    ouvert: false,
    ref: null,
  })

  const q = fold(recherche)
  const filtrees = state.references
    .filter((r) => {
      if (filtreMO && r.typeMO !== filtreMO) return false
      if (filtreAtt === 'avec' && !r.attestation) return false
      if (filtreAtt === 'sans' && r.attestation) return false
      if (q) {
        const texte = fold([r.nom, r.lieu || '', r.moa || '', r.motsCles.join(' ')].join(' '))
        if (!texte.includes(q)) return false
      }
      return true
    })
    .sort((a, b) => (b.annee || 0) - (a.annee || 0))

  const exportTexte = () => {
    const n = filtrees.length
    const entete = `Références ${state.settings.nomAgence} — export du ${fmtDate(today)} (${n} référence${n > 1 ? 's' : ''}) :`
    const corps = n ? filtrees.map(ligneReference).join('\n') : '  (aucune référence pour ces filtres)'
    return `${entete}\n${corps}`
  }

  const supprimer = (r: Reference) => {
    if (!confirm(`Supprimer la référence « ${r.nom} » ?`)) return
    update((d) => {
      d.references = d.references.filter((x) => x.id !== r.id)
    })
  }

  const enregistrer = (ref: Reference) => {
    update((d) => {
      const i = d.references.findIndex((x) => x.id === ref.id)
      if (i >= 0) d.references[i] = ref
      else d.references.push(ref)
    })
    setModal({ ouvert: false, ref: null })
  }

  return (
    <Page
      titre="Références"
      sousTitre="Carburant des candidatures, du Go/No-Go et des futures planches."
      actions={<Btn kind="primary" onClick={() => setModal({ ouvert: true, ref: null })}>Nouvelle référence</Btn>}
    >
      <Card>
        <div className="toolbar">
          <TextInput
            value={recherche}
            onChange={setRecherche}
            placeholder="Rechercher (nom, lieu, MO, mots-clés)…"
            style={{ minWidth: 240 }}
          />
          <Select
            value={filtreMO}
            onChange={setFiltreMO}
            options={[
              { value: '', label: 'Tous types de MO' },
              ...TYPES_MO.map((t) => ({ value: t, label: t })),
            ]}
          />
          <Select
            value={filtreAtt}
            onChange={setFiltreAtt}
            options={[
              { value: '', label: 'Attestation : toutes' },
              { value: 'avec', label: 'Avec attestation' },
              { value: 'sans', label: 'Sans attestation' },
            ]}
          />
          <span className="muted small">
            {filtrees.length} / {state.references.length} référence{state.references.length > 1 ? 's' : ''}
          </span>
          <span className="spacer" />
          <CopyBtn
            text={exportTexte}
            label="Export texte pour candidature"
            kind="default"
          />
        </div>
        <p className="muted small">
          L'export reprend les références filtrées ci-dessous, au format des candidatures — à coller
          dans le Projet Claude « Analyse AO » (gabarit « Sélectionner les références »).
        </p>

        {state.references.length === 0 ? (
          <EmptyState>
            Aucune référence pour l'instant. Ajoutez la première avec « Nouvelle référence » —
            chaque fiche servira les candidatures et les avis Go/No-Go.
          </EmptyState>
        ) : filtrees.length === 0 ? (
          <EmptyState>Aucune référence ne correspond à la recherche ou aux filtres.</EmptyState>
        ) : (
          <Table
            head={[
              'Nom',
              'Lieu',
              'Année',
              'MO',
              'Montant travaux HT',
              'Surface',
              'Mission',
              'Mots-clés',
              'Attestation',
              'Notes',
              '',
            ]}
            compact
          >
            {filtrees.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.nom}</strong>
                  {r.photosDossier && (
                    <div className="muted small" title={r.photosDossier}>
                      Photos : {r.photosDossier}
                    </div>
                  )}
                </td>
                <td>{r.lieu || '—'}</td>
                <td className="num">{r.annee ?? '—'}</td>
                <td>{r.typeMO ? <Badge tone="info">{r.typeMO}</Badge> : '—'}</td>
                <td className="right">
                  <Money v={r.montantTravauxHT} />
                </td>
                <td className="right num">{fmtSurface(r.surfaceM2)}</td>
                <td>{r.mission || '—'}</td>
                <td>
                  {r.motsCles.length
                    ? r.motsCles.map((m) => (
                        <Badge key={m} tone="muted">
                          {m}
                        </Badge>
                      ))
                    : '—'}
                </td>
                <td>
                  {r.attestation ? (
                    <span className="ok-text" title="Attestation de bonne exécution disponible">✓</span>
                  ) : (
                    <span className="muted" title="Attestation à réclamer">—</span>
                  )}
                </td>
                <td className="muted small" title={r.notes || undefined}>
                  {r.notes || ''}
                </td>
                <td className="right">
                  <Btn small kind="ghost" onClick={() => setModal({ ouvert: true, ref: r })}>
                    Modifier
                  </Btn>{' '}
                  <Btn small kind="danger" onClick={() => supprimer(r)}>
                    Supprimer
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {modal.ouvert && (
        <ModalReference
          initiale={modal.ref}
          onClose={() => setModal({ ouvert: false, ref: null })}
          onSave={enregistrer}
        />
      )}
    </Page>
  )
}
