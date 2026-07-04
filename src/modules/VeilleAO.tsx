// ============================================================
// Veille AO — consultations & Go/No-Go.
// Circuit : routine hebdo Claude (page Routines) → import JSON
// « à étudier » → analyse RC / avis Go-No-Go via pré-prompts →
// dépôt → résultat tracé (classement, motifs) pour affiner les
// avis suivants. Claude propose, l'humain décide.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppState, Consultation, StatutConsultation } from '../types'
import { useStore } from '../store'
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
  Money,
  NumInput,
  Page,
  Select,
  Table,
  TextArea,
  TextInput,
  useToday,
} from '../ui'
import type { Tone } from '../ui'
import { diffDays, fmtPct, fold, todayISO, uid } from '../util'
import { assemble, contexteConsultation } from '../prompts'
import { importerConsultations, parseRetourRoutine } from '../importRoutines'
import type { RetourConsultation } from '../importRoutines'
import { CRITERES_DEFAUT, rechercherBoamp } from '../boamp'
import type { AnnonceExterne, CriteresBoamp } from '../boamp'
import { rechercherTed } from '../ted'
import { relaisDisponible } from '../relais'
import { genererDocxCandidature, nomFichierCandidature, referencesPertinentes } from '../candidature'
import { ecrireFichierRacine, lireRacine } from '../fsdrive'

// ---------- référentiel des statuts ----------

const STATUTS: { value: StatutConsultation; label: string; tone: Tone }[] = [
  { value: 'a_etudier', label: 'À étudier', tone: 'info' },
  { value: 'go', label: 'Go', tone: 'ok' },
  { value: 'no_go', label: 'No-Go', tone: 'muted' },
  { value: 'deposee', label: 'Déposée', tone: 'warn' },
  { value: 'gagnee', label: 'Gagnée', tone: 'ok' },
  { value: 'perdue', label: 'Perdue', tone: 'danger' },
]

const ORDRE_STATUTS: Record<StatutConsultation, number> = {
  a_etudier: 0,
  go: 1,
  no_go: 2,
  deposee: 3,
  gagnee: 4,
  perdue: 5,
}

function BadgeStatut({ statut }: { statut: StatutConsultation }) {
  const i = STATUTS.find((s) => s.value === statut)
  return <Badge tone={i?.tone || 'muted'}>{i?.label || statut}</Badge>
}

// ---------- petites cellules ----------

/** date limite + badge danger si < 10 j et consultation encore ouverte */
function CelluleEcheance({ c, today }: { c: Consultation; today: string }) {
  if (!c.dateLimite) return <span className="muted">—</span>
  const dj = diffDays(today, c.dateLimite)
  const urgente = (c.statut === 'a_etudier' || c.statut === 'go') && dj < 10
  return (
    <span>
      <DateF d={c.dateLimite} />{' '}
      {urgente && <Badge tone="danger">{dj < 0 ? `dépassée de ${-dj} j` : `J−${dj}`}</Badge>}
    </span>
  )
}

/** source tronquée, texte complet dans le title (traçabilité) */
function CelluleSource({ source }: { source?: string }) {
  if (!source) return <span className="muted">—</span>
  return (
    <span
      className="muted small"
      title={source}
      style={{
        display: 'inline-block',
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        verticalAlign: 'bottom',
      }}
    >
      {source}
    </span>
  )
}

// ---------- pré-prompts ----------

/** CopyBtn d'un gabarit de contexte « consultation », avec rappel du Projet Claude cible */
function PromptConsultation({
  tplId,
  consultation,
  small,
}: {
  tplId: string
  consultation: Consultation
  small?: boolean
}) {
  const { state } = useStore()
  const t = state.prompts.find((x) => x.id === tplId)
  if (!t) {
    return (
      <Btn small={small} disabled title={`Gabarit « ${tplId} » introuvable dans la bibliothèque de prompts.`}>
        Gabarit manquant
      </Btn>
    )
  }
  return (
    <CopyBtn
      small={small}
      kind="default"
      label={`${t.titre} → coller dans « ${t.projetClaude} »`}
      text={() => assemble(t.corps, contexteConsultation(state, consultation))}
    />
  )
}

// ---------- veille BOAMP intégrée (API officielle gratuite) ----------

/** l'annonce est-elle déjà dans le pipeline ? (idweb tracé dans la source, sinon intitulé+acheteur) */
function dejaSuivie(state: AppState, a: AnnonceExterne): boolean {
  return state.consultations.some(
    (c) =>
      (c.source || '').includes(a.idweb) ||
      (fold(c.intitule) === fold(a.objet) && fold(c.acheteur || '') === fold(a.acheteur || '')),
  )
}

function CarteBoamp() {
  const { state, update } = useStore()
  const today = useToday()
  const criteres: CriteresBoamp = { ...CRITERES_DEFAUT, ...(state.settings.veilleBoamp || {}) }
  const [annonces, setAnnonces] = useState<AnnonceExterne[] | null>(null)
  const [erreur, setErreur] = useState('')
  const [noteTed, setNoteTed] = useState('')
  const [enCours, setEnCours] = useState(false)
  const lanceAuto = useRef(false)

  const majCriteres = (patch: Partial<CriteresBoamp>) =>
    update((d) => {
      d.settings.veilleBoamp = { ...criteres, ...patch }
    })

  const rechercher = async (c: CriteresBoamp) => {
    setEnCours(true)
    setErreur('')
    setNoteTed('')
    const [boamp, ted] = await Promise.allSettled([
      rechercherBoamp(c, todayISO()),
      relaisDisponible().then((d) =>
        d ? rechercherTed(c, todayISO()) : Promise.reject(new Error('relais indisponible (site déployé uniquement)')),
      ),
    ])
    const liste: AnnonceExterne[] = []
    if (boamp.status === 'fulfilled') liste.push(...boamp.value)
    else setErreur(boamp.reason instanceof Error ? boamp.reason.message : 'Recherche BOAMP impossible.')
    if (ted.status === 'fulfilled') liste.push(...ted.value)
    else setNoteTed(`TED non interrogé — ${ted.reason instanceof Error ? ted.reason.message : 'erreur inconnue'}.`)
    liste.sort((a, b) => b.dateParution.localeCompare(a.dateParution))
    setAnnonces(boamp.status === 'fulfilled' || ted.status === 'fulfilled' ? liste : null)
    setEnCours(false)
  }

  // critères déjà réglés → la veille se lance toute seule à l'ouverture de la page
  useEffect(() => {
    if (lanceAuto.current || !state.settings.veilleBoamp) return
    lanceAuto.current = true
    void rechercher(criteres)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const suivre = (a: AnnonceExterne) =>
    update((d) => {
      if (dejaSuivie(d, a)) return
      d.consultations.push({
        id: uid('ao'),
        intitule: a.objet,
        acheteur: a.acheteur,
        lieu: a.departements.join(', '),
        typologie: a.typeMarche,
        budgetTravaux: null,
        dateLimite: a.dateLimite,
        statut: 'a_etudier',
        source: `${a.plateforme} ${a.idweb}`,
        notes: `Avis officiel : ${a.url}`,
      })
    })

  return (
    <Card titre="Veille automatique — BOAMP + TED, les avis officiels arrivent tout seuls">
      <p className="small muted" style={{ marginBottom: 10 }}>
        BOAMP (national) interrogé en direct, TED (marchés européens, France entière) via le relais du
        site — uniquement les <strong>avis de marché en cours</strong> : résultats, rectificatifs et avis
        expirés sont filtrés, mots-clés cherchés dans l'objet. Un clic met l'annonce « À étudier ».
      </p>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <Field label="Mots-clés (OU entre chaque, virgules)">
          <TextInput
            value={criteres.motsCles}
            onChange={(v) => majCriteres({ motsCles: v })}
            placeholder="maîtrise d'oeuvre, réhabilitation…"
            style={{ minWidth: 280 }}
          />
        </Field>
        <Field label="Départements">
          <TextInput
            value={criteres.departements}
            onChange={(v) => majCriteres({ departements: v })}
            placeholder="60, 80, 02 (vide = France)"
            style={{ width: 140 }}
          />
        </Field>
        <Field label="Type">
          <Select
            value={criteres.typeMarche}
            onChange={(v) => majCriteres({ typeMarche: v })}
            options={[
              { value: 'Services', label: 'Services (MOE)' },
              { value: 'Travaux', label: 'Travaux' },
              { value: '', label: 'Tous' },
            ]}
          />
        </Field>
        <Field label="Parution">
          <Select
            value={String(criteres.depuisJours)}
            onChange={(v) => majCriteres({ depuisJours: Number(v) || 30 })}
            options={[
              { value: '15', label: '15 derniers jours' },
              { value: '30', label: '30 derniers jours' },
              { value: '60', label: '60 derniers jours' },
              { value: '90', label: '90 derniers jours' },
            ]}
          />
        </Field>
        <Field label=" ">
          <Btn kind="primary" onClick={() => rechercher(criteres)} disabled={enCours}>
            {enCours ? 'Recherche…' : 'Rechercher'}
          </Btn>
        </Field>
      </div>
      {erreur && <p className="small danger-text">{erreur}</p>}
      {noteTed && <p className="small muted">{noteTed}</p>}
      {annonces && annonces.length === 0 && (
        <EmptyState>Aucune annonce récente pour ces critères — élargissez les mots-clés ou la période.</EmptyState>
      )}
      <p className="muted small" style={{ marginBottom: 10 }}>
        Chercher aussi sur{' '}
        <a href="https://www.marches-publics.info/" target="_blank" rel="noreferrer">
          AWS / marches-publics.info
        </a>{' '}
        (pas de flux exploitable — lien direct ou routine Claude hebdo). TED ne s'affiche que sur le site
        déployé : c'est le relais du site qui l'interroge.
      </p>
      {annonces && annonces.length > 0 && (
        <Table compact head={['Parution', 'Objet', 'Acheteur', 'Dép.', 'Date limite', '']}>
          {annonces.map((a) => {
            const suivie = dejaSuivie(state, a)
            const dj = a.dateLimite ? diffDays(today, a.dateLimite) : null
            return (
              <tr key={a.idweb}>
                <td className="small">
                  <DateF d={a.dateParution} />
                </td>
                <td>
                  <Badge tone={a.plateforme === 'TED' ? 'info' : 'muted'}>{a.plateforme}</Badge>{' '}
                  <a href={a.url} target="_blank" rel="noreferrer" title="Ouvrir l'avis officiel">
                    {a.objet.length > 110 ? a.objet.slice(0, 110) + '…' : a.objet}
                  </a>
                </td>
                <td className="small">{a.acheteur || '—'}</td>
                <td className="small">{a.departements.join(', ') || '—'}</td>
                <td className="small">
                  {a.dateLimite ? (
                    <>
                      <DateF d={a.dateLimite} />{' '}
                      {dj !== null && dj >= 0 && dj < 10 && <Badge tone="danger">J−{dj}</Badge>}
                      {dj !== null && dj < 0 && <Badge tone="muted">close</Badge>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="right">
                  {suivie ? (
                    <Badge tone="ok">déjà suivie</Badge>
                  ) : (
                    <Btn small kind="primary" onClick={() => suivre(a)} title="Ajouter au pipeline en « À étudier »">
                      + À étudier
                    </Btn>
                  )}
                </td>
              </tr>
            )
          })}
        </Table>
      )}
    </Card>
  )
}

// ---------- import du retour de routine ----------

function cleConsultation(intitule: string, acheteur?: string): string {
  return `${fold(intitule)}|${fold(acheteur || '')}`
}

/** marque les doublons exactement comme le fera importerConsultations (intitulé + acheteur) */
function marquerDoublons(state: AppState, items: RetourConsultation[]): boolean[] {
  const vus = new Set(state.consultations.map((c) => cleConsultation(c.intitule, c.acheteur)))
  return items.map((it) => {
    const k = cleConsultation(it.intitule, it.acheteur)
    if (vus.has(k)) return true
    vus.add(k)
    return false
  })
}

function ImportVeille() {
  const { state, update } = useStore()
  const [brut, setBrut] = useState('')
  const [erreur, setErreur] = useState<ReactNode | null>(null)
  const [apercu, setApercu] = useState<RetourConsultation[] | null>(null)
  const [resultat, setResultat] = useState<{ ajoutes: number; doublons: number } | null>(null)

  const flagsDoublons = apercu ? marquerDoublons(state, apercu) : []
  const nbNouvelles = flagsDoublons.filter((d) => !d).length

  const analyser = () => {
    setResultat(null)
    setApercu(null)
    const { retour, erreur: err } = parseRetourRoutine(brut)
    if (err || !retour) {
      setErreur(err || 'Analyse impossible.')
      return
    }
    if (retour.type !== 'consultations') {
      setErreur(
        <>
          Ce retour est de type « situations » — à importer dans le module{' '}
          <a href="#/situations">Situations</a>.
        </>,
      )
      return
    }
    setErreur(null)
    setApercu(retour.items)
  }

  const importer = () => {
    if (!apercu) return
    const items = apercu
    const ajoutes = nbNouvelles
    update((d) => {
      importerConsultations(d, items)
    })
    setResultat({ ajoutes, doublons: items.length - ajoutes })
    setApercu(null)
    setBrut('')
  }

  return (
    <Card titre="Importer le retour de la routine « Veille AO hebdomadaire »">
      <p className="small muted" style={{ marginBottom: 10 }}>
        Chaque lundi, la routine Claude filtre les alertes BOAMP / TED selon les critères de
        l'agence et termine par un bloc JSON (prompt à copier depuis la page Routines). Collez
        ici sa réponse complète : l'import est déterministe, dédoublonné, et tout arrive en
        « À étudier » — rien n'est décidé sans relecture humaine.
      </p>
      <TextArea
        mono
        rows={5}
        value={brut}
        onChange={(v) => setBrut(v)}
        placeholder="Collez ici la réponse de la routine (le bloc ```json``` est détecté automatiquement, le texte autour est ignoré)."
      />
      {erreur && <p className="small danger-text" style={{ marginTop: 8 }}>{erreur}</p>}
      {resultat && (
        <p className="small ok-text" style={{ marginTop: 8 }}>
          Import terminé : {resultat.ajoutes} consultation(s) ajoutée(s) en « À étudier »,{' '}
          {resultat.doublons} doublon(s) ignoré(s).
        </p>
      )}
      {!apercu && (
        <div className="form-foot">
          <Btn kind="primary" onClick={analyser} disabled={!brut.trim()}>
            Analyser
          </Btn>
        </div>
      )}
      {apercu && (
        <div style={{ marginTop: 12 }}>
          <p className="small" style={{ marginBottom: 8 }}>
            {apercu.length} consultation(s) détectée(s) — {nbNouvelles} nouvelle(s),{' '}
            {apercu.length - nbNouvelles} doublon(s) déjà en base.
          </p>
          <Table compact head={['Import', 'Intitulé', 'Acheteur', 'Lieu', 'Date limite', 'Budget HT']}>
            {apercu.map((it, i) => (
              <tr key={i}>
                <td>
                  {flagsDoublons[i] ? <Badge tone="muted">doublon</Badge> : <Badge tone="ok">nouvelle</Badge>}
                </td>
                <td>{it.intitule}</td>
                <td>{it.acheteur || '—'}</td>
                <td>{it.lieu || '—'}</td>
                <td>
                  <DateF d={it.dateLimite} />
                </td>
                <td className="right">
                  <Money v={it.budgetTravaux} />
                </td>
              </tr>
            ))}
          </Table>
          <div className="form-foot">
            <Btn onClick={() => setApercu(null)}>Annuler</Btn>
            <Btn
              kind="primary"
              onClick={importer}
              disabled={nbNouvelles === 0}
              title={nbNouvelles === 0 ? 'Toutes les lignes sont déjà en base.' : undefined}
            >
              Importer {nbNouvelles} consultation(s)
            </Btn>
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------- fiche / édition (Modal) ----------

function nouvelleConsultation(): Consultation {
  return {
    id: uid('ao'),
    intitule: '',
    acheteur: '',
    lieu: '',
    typologie: '',
    source: 'saisie manuelle',
    budgetTravaux: null,
    dateLimite: null,
    statut: 'a_etudier',
    avisGoNoGo: '',
    classement: null,
    motifsResultat: '',
    notes: '',
  }
}

/** l'en-tête qui répond en 5 secondes à « c'est quoi, pour qui, pour quand ? » */
function ResumeConsultation({ c }: { c: Consultation }) {
  const today = useToday()
  const dj = c.dateLimite ? diffDays(today, c.dateLimite) : null
  const urlAvis = `${c.notes || ''} ${c.source || ''}`.match(/https?:\/\/\S+/)?.[0]

  return (
    <div className="grid3" style={{ marginBottom: 14 }}>
      <div>
        <div className="muted small">Remise des offres</div>
        <div style={{ fontWeight: 700 }}>
          {c.dateLimite ? (
            <>
              <DateF d={c.dateLimite} />{' '}
              {dj !== null &&
                (dj < 0 ? (
                  <Badge tone="muted">dépassée</Badge>
                ) : (
                  <Badge tone={dj <= 7 ? 'danger' : dj <= 15 ? 'warn' : 'ok'}>J−{dj}</Badge>
                ))}
            </>
          ) : (
            '—'
          )}
        </div>
      </div>
      <div>
        <div className="muted small">Budget travaux HT</div>
        <div style={{ fontWeight: 700 }}>
          <Money v={c.budgetTravaux ?? null} />
        </div>
      </div>
      <div>
        <div className="muted small">Avis officiel</div>
        <div style={{ fontWeight: 700 }}>
          {urlAvis ? (
            <a href={urlAvis} target="_blank" rel="noreferrer">
              ouvrir l'annonce ↗
            </a>
          ) : (
            <span className="muted">lien non renseigné</span>
          )}
        </div>
      </div>
    </div>
  )
}

/** la réponse à l'AO en mode semi-automatique : trame DOCX + références auto */
function BlocReponse({ c }: { c: Consultation }) {
  const { state } = useStore()
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null)
  const [enCours, setEnCours] = useState(false)
  const refs = useMemo(
    () => referencesPertinentes(state, c),
    [state, c.intitule, c.typologie, c.notes], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const generer = async () => {
    setEnCours(true)
    setMessage(null)
    try {
      const blob = await genererDocxCandidature(state, c, refs)
      const nom = nomFichierCandidature(c)
      const racine = await lireRacine()
      if (racine) {
        try {
          const chemin = await ecrireFichierRacine(
            racine,
            '0_CANDIDATURES',
            new File([blob], nom, { type: blob.type }),
          )
          setMessage({ ok: true, texte: `Dossier écrit dans le Drive : ${chemin} — à relire et compléter.` })
          setEnCours(false)
          return
        } catch {
          // dossier inaccessible → repli téléchargement
        }
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nom
      a.click()
      URL.revokeObjectURL(url)
      setMessage({ ok: true, texte: `Dossier téléchargé (${nom}) — branchez le Drive dans Santé pour l'y ranger tout seul.` })
    } catch (e) {
      setMessage({ ok: false, texte: e instanceof Error ? e.message : 'Génération impossible.' })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="card" style={{ padding: 12, marginBottom: 14, background: 'var(--bg-soft, #f6f7fa)' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Préparer la réponse — semi-automatique</div>
      <p className="small muted" style={{ marginBottom: 8 }}>
        Le site assemble la trame du dossier de candidature (mise en page agence) : rappel de la
        consultation, présentation & moyens, <strong>références choisies automatiquement</strong> par
        proximité avec l'objet, et checklist des pièces (DC1, DC2, MAF…). Le mémoire technique
        s'écrit ensuite avec le pré-prompt « Références & candidature » ci-dessus.
      </p>
      <p className="small" style={{ marginBottom: 10 }}>
        Références retenues :{' '}
        {refs.length === 0 ? (
          <span className="muted">
            aucune en base — <a href="#/references">alimentez la page Références</a>
          </span>
        ) : (
          refs.map((r) => (
            <span key={r.id} className="badge badge-info" style={{ marginRight: 4 }}>
              {r.nom}
              {r.annee ? ` (${r.annee})` : ''}
            </span>
          ))
        )}
      </p>
      <Btn kind="primary" onClick={generer} disabled={enCours || !c.intitule.trim()}>
        {enCours ? 'Génération…' : '📄 Générer le dossier de candidature (DOCX)'}
      </Btn>
      {message && (
        <p className={`small ${message.ok ? 'ok-text' : 'danger-text'}`} style={{ marginTop: 8 }}>
          {message.ok ? '✓ ' : '✗ '}
          {message.texte}
        </p>
      )}
    </div>
  )
}

function FicheModal({
  initial,
  nouveau,
  onClose,
}: {
  initial: Consultation
  nouveau: boolean
  onClose: () => void
}) {
  const { update } = useStore()
  const [c, setC] = useState<Consultation>({ ...initial })
  const maj = (patch: Partial<Consultation>) => setC((prev) => ({ ...prev, ...patch }))

  const enregistrer = () => {
    const intitule = c.intitule.trim()
    if (!intitule) {
      alert("L'intitulé de la consultation est obligatoire.")
      return
    }
    const propre: Consultation = { ...c, intitule }
    update((d) => {
      const i = d.consultations.findIndex((x) => x.id === propre.id)
      if (i >= 0) d.consultations[i] = propre
      else d.consultations.push(propre)
    })
    onClose()
  }

  const supprimer = () => {
    if (!confirm(`Supprimer la consultation « ${c.intitule || 'sans intitulé'} » ?`)) return
    update((d) => {
      d.consultations = d.consultations.filter((x) => x.id !== c.id)
    })
    onClose()
  }

  const resultatConnu = c.statut === 'gagnee' || c.statut === 'perdue'

  return (
    <Modal titre={nouveau ? 'Nouvelle consultation' : 'Fiche consultation — Go / No-Go'} onClose={onClose} large>
      {!nouveau && (
        <>
          <ResumeConsultation c={c} />
          <p className="small muted" style={{ marginBottom: 8 }}>
            Pré-prompts : un clic copie le prompt assemblé (fiche + références + charge
            actuelle) — à coller dans le Projet Claude indiqué sur le bouton. L'avis rendu se
            colle ensuite ci-dessous après relecture.
          </p>
          <div className="toolbar">
            <PromptConsultation tplId="tpl-analyse-rc" consultation={c} />
            <PromptConsultation tplId="tpl-go-nogo" consultation={c} />
            <PromptConsultation tplId="tpl-references-candidature" consultation={c} />
          </div>
          <BlocReponse c={c} />
        </>
      )}

      <Field label="Intitulé">
        <TextInput value={c.intitule} onChange={(v) => maj({ intitule: v })} placeholder="Restructuration du groupe scolaire…" />
      </Field>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Acheteur">
          <TextInput value={c.acheteur || ''} onChange={(v) => maj({ acheteur: v })} />
        </Field>
        <Field label="Lieu">
          <TextInput value={c.lieu || ''} onChange={(v) => maj({ lieu: v })} />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Typologie">
          <TextInput value={c.typologie || ''} onChange={(v) => maj({ typologie: v })} placeholder="Enseignement, logement, réhabilitation…" />
        </Field>
        <Field label="Budget travaux HT">
          <NumInput value={c.budgetTravaux ?? null} onChange={(v) => maj({ budgetTravaux: v })} />
        </Field>
        <Field label="Date limite de remise">
          <DateInput value={c.dateLimite ?? null} onChange={(v) => maj({ dateLimite: v })} />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Statut">
          <Select
            value={c.statut}
            onChange={(v) => maj({ statut: v as StatutConsultation })}
            options={STATUTS.map((s) => ({ value: s.value, label: s.label }))}
          />
        </Field>
        <Field label="Source" hint="Traçabilité : BOAMP, TED, alerte, routine du…">
          <TextInput value={c.source || ''} onChange={(v) => maj({ source: v })} />
        </Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Avis Go / No-Go" hint="Avis préparé avec Claude puis relu et collé ici — la décision reste humaine.">
          <TextArea rows={4} value={c.avisGoNoGo || ''} onChange={(v) => maj({ avisGoNoGo: v })} />
        </Field>
      </div>
      {resultatConnu && (
        <>
          <div className="form-row" style={{ marginTop: 10 }}>
            <Field label="Classement" hint="Rang obtenu (1 = lauréat).">
              <NumInput value={c.classement ?? null} onChange={(v) => maj({ classement: v })} />
            </Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="Motifs du résultat" hint="Motifs notifiés / analyse à froid — nourrit les prochains avis Go / No-Go.">
              <TextArea rows={3} value={c.motifsResultat || ''} onChange={(v) => maj({ motifsResultat: v })} />
            </Field>
          </div>
        </>
      )}
      <div style={{ marginTop: 10 }}>
        <Field label="Notes">
          <TextArea rows={2} value={c.notes || ''} onChange={(v) => maj({ notes: v })} />
        </Field>
      </div>

      <div className="form-foot">
        {!nouveau && (
          <Btn kind="danger" onClick={supprimer}>
            Supprimer
          </Btn>
        )}
        <span className="spacer" />
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer}>
          {nouveau ? 'Créer' : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- bilan gagné / perdu ----------

function Bilan({ consultations }: { consultations: Consultation[] }) {
  const deposees = consultations.filter((c) =>
    ['deposee', 'gagnee', 'perdue'].includes(c.statut),
  )
  const gagnees = consultations.filter((c) => c.statut === 'gagnee')
  const perdues = consultations.filter((c) => c.statut === 'perdue')
  const decidees = gagnees.length + perdues.length
  const enAttente = deposees.length - decidees
  const resultats = [...gagnees, ...perdues]

  return (
    <Card titre="Bilan gagné / perdu">
      <p className="small muted" style={{ marginBottom: 10 }}>
        Chaque résultat est tracé (classement, motifs) : c'est la matière première des
        prochains avis Go / No-Go.
      </p>
      {deposees.length === 0 ? (
        <EmptyState>Aucune candidature déposée pour l'instant.</EmptyState>
      ) : (
        <>
          <dl className="kv">
            <dt>Candidatures déposées</dt>
            <dd>
              {deposees.length}
              {enAttente > 0 && <span className="muted"> — dont {enAttente} en attente de résultat</span>}
            </dd>
            <dt>Gagnées / perdues</dt>
            <dd>
              {gagnees.length} / {perdues.length}
            </dd>
            <dt>Taux de réussite</dt>
            <dd>
              {decidees > 0 ? (
                <>
                  {fmtPct(gagnees.length / decidees, 0)}{' '}
                  <span className="muted">sur {decidees} résultat(s) connu(s)</span>
                </>
              ) : (
                <span className="muted">aucun résultat connu pour l'instant</span>
              )}
            </dd>
          </dl>
          {resultats.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Table compact head={['Consultation', 'Acheteur', 'Résultat', 'Classement', 'Motifs']}>
                {resultats.map((c) => (
                  <tr key={c.id}>
                    <td>{c.intitule}</td>
                    <td>{c.acheteur || '—'}</td>
                    <td>
                      <BadgeStatut statut={c.statut} />
                    </td>
                    <td className="right num">{c.classement ?? '—'}</td>
                    <td className="small muted">{c.motifsResultat || '—'}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

// ---------- module ----------

export default function VeilleAO() {
  const { state } = useStore()
  const today = useToday()
  const [q, setQ] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [fiche, setFiche] = useState<{ c: Consultation; nouveau: boolean } | null>(null)

  const consultations = state.consultations
  const fq = fold(q)
  const visibles = consultations
    .filter((c) => !filtreStatut || c.statut === filtreStatut)
    .filter(
      (c) =>
        !fq ||
        fold(
          `${c.intitule} ${c.acheteur || ''} ${c.lieu || ''} ${c.typologie || ''} ${c.source || ''}`,
        ).includes(fq),
    )
    .sort(
      (a, b) =>
        ORDRE_STATUTS[a.statut] - ORDRE_STATUTS[b.statut] ||
        (a.dateLimite || '9999').localeCompare(b.dateLimite || '9999') ||
        a.intitule.localeCompare(b.intitule),
    )

  const optionsStatut = [
    { value: '', label: `Tous les statuts (${consultations.length})` },
    ...STATUTS.map((s) => ({
      value: s.value,
      label: `${s.label} (${consultations.filter((c) => c.statut === s.value).length})`,
    })),
  ]

  const ouvrir = (c: Consultation) => setFiche({ c: { ...c }, nouveau: false })

  return (
    <Page
      titre="Appels d'offres"
      sousTitre="Le BOAMP arrive tout seul (API officielle gratuite) ; la routine hebdo complète avec TED et les sources privées. Avis Go / No-Go outillés par Claude — décision et bilan restent humains."
      actions={
        <Btn kind="primary" onClick={() => setFiche({ c: nouvelleConsultation(), nouveau: true })}>
          Nouvelle consultation
        </Btn>
      }
    >
      <CarteBoamp />
      <ImportVeille />

      <Card titre="Pipeline des consultations">
        <div className="toolbar">
          <TextInput
            value={q}
            onChange={setQ}
            placeholder="Rechercher (intitulé, acheteur, lieu, typologie…)"
            style={{ minWidth: 260 }}
          />
          <Select value={filtreStatut} onChange={setFiltreStatut} options={optionsStatut} />
          <span className="spacer" />
          <span className="muted small">
            {visibles.length} / {consultations.length} consultation(s)
          </span>
        </div>
        {consultations.length === 0 ? (
          <EmptyState>
            Aucune consultation — collez le retour de la routine « Veille AO hebdomadaire »
            ci-dessus, ou créez une consultation manuellement.
          </EmptyState>
        ) : visibles.length === 0 ? (
          <EmptyState>Aucune consultation ne correspond à la recherche ou au filtre.</EmptyState>
        ) : (
          <Table
            head={[
              'Intitulé',
              'Acheteur',
              'Lieu',
              'Typologie',
              'Budget HT',
              'Date limite',
              'Source',
              'Statut',
              '',
            ]}
          >
            {visibles.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => ouvrir(c)}>
                <td>
                  <strong>{c.intitule}</strong>
                </td>
                <td>{c.acheteur || '—'}</td>
                <td>{c.lieu || '—'}</td>
                <td>{c.typologie || '—'}</td>
                <td className="right">
                  <Money v={c.budgetTravaux} />
                </td>
                <td>
                  <CelluleEcheance c={c} today={today} />
                </td>
                <td>
                  <CelluleSource source={c.source} />
                </td>
                <td>
                  <BadgeStatut statut={c.statut} />
                </td>
                <td className="right">
                  <Btn small kind="ghost" onClick={() => ouvrir(c)}>
                    Fiche
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Bilan consultations={consultations} />

      {fiche && (
        <FicheModal
          key={fiche.c.id}
          initial={fiche.c}
          nouveau={fiche.nouveau}
          onClose={() => setFiche(null)}
        />
      )}
    </Page>
  )
}
