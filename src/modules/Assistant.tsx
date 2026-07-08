// ============================================================
// Assistant IA — pose des questions au corpus réglementaire,
// cherche dans les comptes-rendus de chantier, rédige des
// brouillons de documents depuis un modèle + la fiche projet.
//
// Principes non négociables :
//   - la clé API vit sur le serveur (api/assistant.js), jamais ici ;
//   - l'assistant ne répond QU'À PARTIR des documents fournis ;
//   - tout ce qui sort est un BROUILLON que l'architecte relit ;
//   - corpus : Légifrance (Licence Ouverte, source + version notées),
//     JAMAIS de texte AFNOR / CSTB (DTU, NF, Eurocodes) — protégés.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { Badge, Btn, Card, CopyBtn, EmptyState, Field, Page, Select, Table, Tabs, TextArea, TextInput, toast, useToday } from '../ui'
import { assistantDisponible, interrogerAssistant } from '../assistant'
import type { DocPourAssistant } from '../assistant'
import { texteVersDocx } from '../crdocx'
import { contexteProjet } from '../prompts'
import { fmtDate, todayISO, uid } from '../util'
import type { DocumentCorpus } from '../types'

const ONGLETS = [
  { id: 'qa', label: 'Question réglementaire' },
  { id: 'cr', label: 'Chercher dans les CR' },
  { id: 'doc', label: 'Générer un document' },
  { id: 'corpus', label: 'Corpus' },
]

/** téléchargement d'un Blob (DOCX) sous un nom de fichier donné */
function telechargerBlob(blob: Blob, nomFichier: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier
  a.click()
  URL.revokeObjectURL(url)
}

export function AssistantPage() {
  const [actif, setActif] = useState('qa')
  const [dispo, setDispo] = useState<boolean | null>(null)
  useEffect(() => {
    void assistantDisponible().then(setDispo)
  }, [])

  return (
    <Page
      titre="Assistant"
      sousTitre="Questions au corpus, recherche dans les CR, brouillons de documents. Tout est brouillon : vous relisez, vous signez."
    >
      {dispo === false && (
        <div className="pill-note" style={{ marginBottom: 12, borderColor: 'var(--warn)' }}>
          Assistant indisponible ici. Il fonctionne sur le site déployé (Vercel) avec la variable
          d’environnement <span className="mono">ANTHROPIC_API_KEY</span> — la clé ne passe jamais
          par le navigateur. Vous pouvez déjà préparer le corpus dans l’onglet dédié.
        </div>
      )}
      <Tabs tabs={ONGLETS} actif={actif} onSelect={setActif} />
      {actif === 'qa' && <OngletQuestion dispo={dispo === true} />}
      {actif === 'cr' && <OngletCR dispo={dispo === true} />}
      {actif === 'doc' && <OngletDocument dispo={dispo === true} />}
      {actif === 'corpus' && <OngletCorpus />}
    </Page>
  )
}

/** affichage d'une réponse : mention brouillon + texte + copie */
function BlocReponse({ reponse, modele }: { reponse: string; modele?: string }) {
  return (
    <Card
      titre={
        <>
          Réponse <Badge tone="warn">brouillon — à vérifier</Badge>
        </>
      }
      actions={<CopyBtn text={reponse} small kind="default" />}
    >
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{reponse}</div>
      {modele && (
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          Généré par {modele} — relecture humaine obligatoire avant tout usage.
        </p>
      )}
    </Card>
  )
}

// ---------- Onglet 1 : question réglementaire sur le corpus ----------

function OngletQuestion({ dispo }: { dispo: boolean }) {
  const { state } = useStore()
  const reglementaires = state.documents.filter((d) => d.type === 'reglementaire')
  // rien de coché par défaut : on ne paie (et n'envoie) que les textes utiles à la question
  const [coches, setCoches] = useState<Set<string>>(() => new Set())
  const [question, setQuestion] = useState('')
  const [difficile, setDifficile] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [reponse, setReponse] = useState<{ reponse: string; modele?: string } | null>(null)

  const basculer = (id: string) => {
    setCoches((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  const poser = async () => {
    const docs: DocPourAssistant[] = reglementaires
      .filter((d) => coches.has(d.id))
      .map((d) => ({ titre: d.titre, source: d.source, texte: d.texte }))
    if (docs.length === 0) {
      toast('Cochez au moins un texte du corpus — l’assistant ne répond qu’à partir de sources.', { tone: 'warn' })
      return
    }
    setEnCours(true)
    setReponse(null)
    try {
      const r = await interrogerAssistant({
        mode: 'qa',
        question,
        documents: docs,
        niveau: difficile ? 'difficile' : 'standard',
      })
      setReponse(r)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur inattendue.', { tone: 'danger' })
    } finally {
      setEnCours(false)
    }
  }

  if (reglementaires.length === 0) {
    return (
      <Card titre="Question réglementaire">
        <EmptyState>
          Le corpus ne contient encore aucun texte réglementaire. Ajoutez d’abord un texte (onglet
          « Corpus ») — par exemple les articles utiles du Code de la commande publique depuis
          Légifrance, avec leur source et leur version.
        </EmptyState>
      </Card>
    )
  }

  return (
    <>
      <Card titre="Question réglementaire">
        <p className="muted" style={{ marginTop: 0 }}>
          L’assistant répond uniquement à partir des textes cochés, avec citation des passages.
          Si la réponse n’y est pas, il le dit — il n’invente pas. Cochez seulement les textes
          utiles à la question : plus la sélection est courte, plus la réponse est précise et
          économe.
        </p>
        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          {reglementaires.map((d) => (
            <label key={d.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={coches.has(d.id)} onChange={() => basculer(d.id)} />
              <span>
                {d.titre} <span className="muted small">({Math.max(1, Math.round(d.texte.length / 1000))} k)</span>
                {d.source && <span className="muted small"> — {d.source}</span>}
              </span>
            </label>
          ))}
        </div>
        {(() => {
          const poids = reglementaires.filter((d) => coches.has(d.id)).reduce((s, d) => s + d.texte.length, 0)
          if (poids <= 400_000) return null
          return (
            <div className="pill-note" style={{ marginBottom: 10, borderColor: 'var(--warn)' }}>
              Sélection très volumineuse ({Math.round(poids / 1000)} k caractères) — l’assistant
              risque de refuser ou de coûter cher. Gardez les textes du thème de la question.
            </div>
          )
        })()}
        <Field label="Votre question">
          <TextArea
            value={question}
            onChange={setQuestion}
            rows={3}
            placeholder="Ex. : quel est le délai de paiement maximal d’un acompte pour un marché public d’une commune ?"
          />
        </Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Btn kind="primary" onClick={() => void poser()} disabled={!dispo || enCours || !question.trim()}>
            {enCours ? 'Recherche…' : 'Poser la question'}
          </Btn>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={difficile} onChange={(e) => setDifficile(e.target.checked)} />
            <span className="muted">Question difficile (modèle renforcé, plus cher)</span>
          </label>
        </div>
      </Card>
      {reponse && <BlocReponse reponse={reponse.reponse} modele={reponse.modele} />}
    </>
  )
}

// ---------- Onglet 2 : recherche dans les comptes-rendus ----------

function OngletCR({ dispo }: { dispo: boolean }) {
  const { state } = useStore()
  const [projetId, setProjetId] = useState('tous')
  const [question, setQuestion] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [reponse, setReponse] = useState<{ reponse: string; modele?: string } | null>(null)

  const avecCR = useMemo(
    () =>
      state.reunions
        .filter((r) => r.cr && r.cr.trim() !== '')
        .filter((r) => projetId === 'tous' || r.projetId === projetId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [state.reunions, projetId],
  )
  const projetsAvecCR = useMemo(() => {
    const ids = new Set(state.reunions.filter((r) => r.cr && r.cr.trim() !== '').map((r) => r.projetId))
    return state.projets.filter((p) => ids.has(p.id))
  }, [state.reunions, state.projets])

  const chercher = async () => {
    const docs: DocPourAssistant[] = avecCR.map((r) => {
      const p = state.projets.find((x) => x.id === r.projetId)
      return {
        titre: `${p ? p.id : r.projetId} · ${r.titre} (${fmtDate(r.date)})`,
        texte: r.cr || '',
      }
    })
    setEnCours(true)
    setReponse(null)
    try {
      const r = await interrogerAssistant({ mode: 'cr', question, documents: docs })
      setReponse(r)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur inattendue.', { tone: 'danger' })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <>
      <Card titre="Chercher dans les comptes-rendus">
        <p className="muted" style={{ marginTop: 0 }}>
          « Qu’a-t-on décidé sur les menuiseries ? » « Depuis quand attend-on le DOE du lot 03 ? » —
          l’assistant lit les CR conservés sur les réunions et cite le CR source.
        </p>
        {avecCR.length === 0 ? (
          <EmptyState>
            Aucun compte-rendu conservé{projetId !== 'tous' ? ' sur ce projet' : ''}. Les CR se
            créent depuis la fiche projet (onglet Chantier) — le texte est gardé sur chaque réunion.
          </EmptyState>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <Select
                value={projetId}
                onChange={setProjetId}
                options={[
                  { value: 'tous', label: `Tous les projets (${avecCR.length} CR)` },
                  ...projetsAvecCR.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
                ]}
              />
            </div>
            <Field label="Votre question">
              <TextArea
                value={question}
                onChange={setQuestion}
                rows={2}
                placeholder="Ex. : où en est la reprise de la fissure du voile B2 ?"
              />
            </Field>
            <Btn kind="primary" onClick={() => void chercher()} disabled={!dispo || enCours || !question.trim()}>
              {enCours ? 'Recherche…' : `Chercher dans ${avecCR.length} CR`}
            </Btn>
          </>
        )}
      </Card>
      {reponse && <BlocReponse reponse={reponse.reponse} modele={reponse.modele} />}
    </>
  )
}

// ---------- Onglet 3 : générer un document depuis un modèle ----------

function OngletDocument({ dispo }: { dispo: boolean }) {
  const { state } = useStore()
  const today = useToday()
  const modeles = state.documents.filter((d) => d.type === 'modele')
  const [modeleId, setModeleId] = useState('')
  const [projetId, setProjetId] = useState('')
  const [instructions, setInstructions] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [reponse, setReponse] = useState<{ reponse: string; modele?: string } | null>(null)

  const modele = modeles.find((d) => d.id === modeleId)
  const projet = state.projets.find((p) => p.id === projetId)

  const generer = async () => {
    if (!modele || !projet) return
    setEnCours(true)
    setReponse(null)
    try {
      const r = await interrogerAssistant({
        mode: 'doc',
        question: instructions.trim() || 'Rédige le document en suivant le modèle, adapté à ce projet.',
        documents: [{ titre: modele.titre, source: modele.source, texte: modele.texte }],
        contexte: `FICHE DU PROJET (données réelles du Cockpit, au ${fmtDate(today)}) :\n${contexteProjet(state, projet).fiche}`,
      })
      setReponse(r)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur inattendue.', { tone: 'danger' })
    } finally {
      setEnCours(false)
    }
  }

  const telecharger = async () => {
    if (!reponse || !modele) return
    const blob = await texteVersDocx(`${modele.titre}${projet ? ` — ${projet.nom}` : ''}`, reponse.reponse)
    telechargerBlob(blob, `BROUILLON_${(modele.titre + (projet ? `_${projet.id}` : '')).replace(/[^\wÀ-ÿ-]+/g, '_')}.docx`)
    toast('DOCX brouillon téléchargé — à relire avant envoi.', { tone: 'ok' })
  }

  if (modeles.length === 0) {
    return (
      <Card titre="Générer un document">
        <EmptyState>
          Aucun modèle dans le corpus. Ajoutez d’abord un document de type « modèle » (onglet
          « Corpus ») : un courrier type, une trame d’OS, une note MOA… L’assistant en suivra la
          structure avec les données du projet choisi.
        </EmptyState>
      </Card>
    )
  }

  return (
    <>
      <Card titre="Générer un document">
        <p className="muted" style={{ marginTop: 0 }}>
          L’assistant suit la structure du modèle et remplit avec la fiche du projet. Ce qui manque
          est marqué « à compléter » — jamais inventé.
        </p>
        <div className="form-row">
          <Field label="Modèle">
            <Select
              value={modeleId}
              onChange={setModeleId}
              options={[{ value: '', label: '— choisir —' }, ...modeles.map((d) => ({ value: d.id, label: d.titre }))]}
            />
          </Field>
          <Field label="Projet">
            <Select
              value={projetId}
              onChange={setProjetId}
              options={[
                { value: '', label: '— choisir —' },
                ...state.projets.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
              ]}
            />
          </Field>
        </div>
        <Field label="Instructions (facultatif)">
          <TextArea
            value={instructions}
            onChange={setInstructions}
            rows={2}
            placeholder="Ex. : destinataire = le maire ; objet = retard du lot charpente ; ton ferme mais courtois."
          />
        </Field>
        <Btn kind="primary" onClick={() => void generer()} disabled={!dispo || enCours || !modele || !projet}>
          {enCours ? 'Rédaction…' : 'Rédiger le brouillon'}
        </Btn>
      </Card>
      {reponse && (
        <>
          <BlocReponse reponse={reponse.reponse} modele={reponse.modele} />
          <div style={{ marginTop: 10 }}>
            <Btn onClick={() => void telecharger()}>Télécharger en DOCX (brouillon)</Btn>
          </div>
        </>
      )}
    </>
  )
}

// ---------- Onglet 4 : corpus (textes réglementaires + modèles) ----------

const TYPES_CORPUS = [
  { value: 'reglementaire', label: 'Texte réglementaire (Légifrance…)' },
  { value: 'modele', label: 'Modèle de document' },
]

// ---------- bibliothèque : packs officiels pré-curatés (public/corpus) ----------

/** entrée du catalogue public/corpus/index.json */
interface PackCatalogue {
  fichier: string
  id: string
  titre: string
  description: string
  version: string
  nbDocs: number
  taille: number
  docIds: string[]
}

/** contenu d'un pack public/corpus/<id>.json */
interface PackCorpus {
  id: string
  docs: { id: string; titre: string; type: 'reglementaire' | 'modele'; source?: string; url?: string; texte: string }[]
}

/** au-delà de ce poids de corpus, la synchro et le stockage local ralentissent */
const SEUIL_POIDS_CORPUS = 2_000_000

/** packs Légifrance prêts à l'emploi, générés par scripts/recolte-corpus.py
 *  (données DILA / Licence Ouverte, version de consolidation affichée) */
function CarteBibliotheque() {
  const { state, update, replace } = useStore()
  const [catalogue, setCatalogue] = useState<PackCatalogue[] | null>(null)
  const [erreur, setErreur] = useState(false)
  const [chargement, setChargement] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/corpus/index.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => setCatalogue(j as PackCatalogue[]))
      .catch(() => setErreur(true))
  }, [])

  const idsPresents = useMemo(() => new Set(state.documents.map((d) => d.id)), [state.documents])

  const ajouter = async (entree: PackCatalogue) => {
    setChargement(entree.id)
    try {
      const r = await fetch(`/corpus/${entree.fichier}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const pack = (await r.json()) as PackCorpus
      const snap = state
      update((d) => {
        for (const doc of pack.docs) {
          const nouveau = { ...doc, ajouteLe: todayISO() }
          const i = d.documents.findIndex((x) => x.id === doc.id)
          if (i >= 0) d.documents[i] = nouveau
          else d.documents.push(nouveau)
        }
      })
      toast(`Pack « ${entree.titre} » ajouté au corpus (${pack.docs.length} document(s)).`, {
        undo: () => replace(snap),
      })
    } catch {
      toast('Pack introuvable — la bibliothèque n’est disponible que sur le site déployé.', { tone: 'danger' })
    } finally {
      setChargement(null)
    }
  }

  if (erreur || catalogue === null) return null

  return (
    <Card titre="Bibliothèque — textes officiels prêts à l'emploi">
      <p className="muted" style={{ marginTop: 0 }}>
        Packs extraits de Légifrance (données DILA, Licence Ouverte) avec leur date de
        consolidation — sécurité incendie, accessibilité, marchés, garanties, urbanisme. Un clic
        les ajoute au corpus ; re-cliquer remplace par la version du pack.
      </p>
      <Table head={['Pack', 'Version consolidée', 'Contenu', '']}>
        {catalogue.map((p) => {
          const dansCorpus = p.docIds.filter((id) => idsPresents.has(id)).length
          const dejaTout = p.docIds.length > 0 && dansCorpus === p.docIds.length
          return (
            <tr key={p.id}>
              <td>
                <strong>{p.titre}</strong>
                <div className="muted small">{p.description}</div>
              </td>
              <td className="small">{fmtDate(p.version)}</td>
              <td className="small muted">
                {p.nbDocs} doc(s) · {Math.round(p.taille / 1000)} k car.
              </td>
              <td className="right">
                <Btn small kind={dejaTout ? 'default' : 'primary'} onClick={() => void ajouter(p)} disabled={chargement !== null}>
                  {chargement === p.id ? 'Ajout…' : dejaTout ? 'Remplacer' : dansCorpus > 0 ? 'Mettre à jour' : 'Ajouter au corpus'}
                </Btn>
              </td>
            </tr>
          )
        })}
      </Table>
    </Card>
  )
}

function OngletCorpus() {
  const { state, update } = useStore()
  const [ajout, setAjout] = useState(false)
  const [titre, setTitre] = useState('')
  const [type, setType] = useState<'reglementaire' | 'modele'>('reglementaire')
  const [source, setSource] = useState('')
  const [url, setUrl] = useState('')
  const [texte, setTexte] = useState('')

  const enregistrer = () => {
    const doc: DocumentCorpus = {
      id: uid('doc'),
      titre: titre.trim(),
      type,
      source: source.trim() || undefined,
      url: url.trim() || undefined,
      texte: texte.trim(),
      ajouteLe: todayISO(),
    }
    update((d) => {
      d.documents.push(doc)
    })
    setAjout(false)
    setTitre('')
    setSource('')
    setUrl('')
    setTexte('')
    toast('Document ajouté au corpus.', { tone: 'ok' })
  }

  const supprimer = (doc: DocumentCorpus) => {
    update((d) => {
      d.documents = d.documents.filter((x) => x.id !== doc.id)
    })
    toast(`« ${doc.titre} » retiré du corpus.`, {
      undo: () => {
        update((d) => {
          d.documents.push(doc)
        })
      },
    })
  }

  const poidsCorpus = state.documents.reduce((somme, d) => somme + d.texte.length, 0)

  return (
    <>
    <Card
      titre="Corpus de l’assistant"
      actions={
        !ajout && (
          <Btn kind="primary" small onClick={() => setAjout(true)}>
            + Ajouter un document
          </Btn>
        )
      }
    >
      <div className="pill-note" style={{ marginBottom: 12, borderColor: 'var(--danger)' }}>
        Ligne rouge : ne JAMAIS coller ici de DTU, norme NF, Eurocode ou document CSTB — ces textes
        sont protégés (AFNOR/CSTB). Les textes Légifrance sont sous Licence Ouverte : notez toujours
        la source exacte et la date de version dans le champ « Source ».
      </div>
      {ajout && (
        <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
          <div className="form-row">
            <Field label="Titre">
              <TextInput value={titre} onChange={setTitre} placeholder="Ex. : CCP — délais de paiement (art. R2192-10 à 36)" />
            </Field>
            <Field label="Type">
              <Select value={type} onChange={(v) => setType(v === 'modele' ? 'modele' : 'reglementaire')} options={TYPES_CORPUS} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Source (obligatoire pour un texte de loi)" hint="Nom du texte, identifiant Légifrance, date de version.">
              <TextInput value={source} onChange={setSource} placeholder="Ex. : Code de la commande publique, Légifrance, version au 01/07/2026" />
            </Field>
            <Field label="Lien (facultatif)">
              <TextInput value={url} onChange={setUrl} placeholder="https://www.legifrance.gouv.fr/…" />
            </Field>
          </div>
          <Field label="Texte intégral">
            <TextArea value={texte} onChange={setTexte} rows={10} mono placeholder="Collez ici le texte (articles complets) ou le modèle de document." />
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn kind="primary" onClick={enregistrer} disabled={!titre.trim() || !texte.trim() || (type === 'reglementaire' && !source.trim())}>
              Enregistrer
            </Btn>
            <Btn kind="ghost" onClick={() => setAjout(false)}>
              Annuler
            </Btn>
          </div>
        </div>
      )}
      {state.documents.length === 0 ? (
        !ajout && (
          <EmptyState>
            Corpus vide. Deux usages : les textes réglementaires (l’assistant y répond avec
            citations) et les modèles de documents (il en suit la structure pour rédiger).
          </EmptyState>
        )
      ) : (
        <Table head={['Titre', 'Type', 'Source', 'Ajouté le', 'Taille', '']}>
          {state.documents.map((d) => (
            <tr key={d.id}>
              <td>
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer">
                    {d.titre}
                  </a>
                ) : (
                  d.titre
                )}
              </td>
              <td>
                <Badge tone={d.type === 'reglementaire' ? 'info' : 'muted'}>
                  {d.type === 'reglementaire' ? 'Réglementaire' : 'Modèle'}
                </Badge>
              </td>
              <td className="muted">{d.source || '—'}</td>
              <td>{fmtDate(d.ajouteLe)}</td>
              <td className="muted">{Math.max(1, Math.round(d.texte.length / 1000))} k car.</td>
              <td style={{ textAlign: 'right' }}>
                <Btn small kind="ghost" onClick={() => supprimer(d)}>
                  Retirer
                </Btn>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {state.documents.length > 0 && (
        <p className="small" style={{ marginTop: 10, marginBottom: 0 }}>
          Poids total du corpus : <strong>{Math.round(poidsCorpus / 1000)} k caractères</strong>
          {poidsCorpus > SEUIL_POIDS_CORPUS && (
            <span className="muted">
              {' '}
              — corpus volumineux : la sauvegarde locale et la synchro ralentissent, retirez les
              packs que vous n’utilisez pas.
            </span>
          )}
        </p>
      )}
    </Card>
    <CarteBibliotheque />
    </>
  )
}
