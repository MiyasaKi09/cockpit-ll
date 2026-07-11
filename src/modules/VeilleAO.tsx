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
import { ligneActivable,
  Badge,
  Btn,
  Card,
  CopyBtn,
  DateF,
  DateInput,
  EmptyState,
  Field,
  Icon,
  Modal,
  Money,
  NumInput,
  Page,
  Select,
  Table,
  Tabs,
  TextArea,
  TextInput,
  confirmer,
  navigate,
  toast,
  useRoute,
  useToday,
} from '../ui'
import type { Tone } from '../ui'
import { PipelineContenu } from './Developpement'
import { ReferencesContenu } from './References'
import { diffDays, fmtPct, fold, todayISO, uid } from '../util'
import { CRITERES_GO_NOGO, evaluerGoNoGo } from '../derive'
import { assemble, contexteConsultation } from '../prompts'
import { importerConsultations, parseRetourRoutine } from '../importRoutines'
import type { RetourConsultation } from '../importRoutines'
import { CRITERES_DEFAUT, rechercherBoamp, rechercherEvenementsBoamp, type EvenementBoamp } from '../boamp'
import type { AnnonceExterne, CriteresBoamp } from '../boamp'
import { rechercherTed } from '../ted'
import { scorerAnnonce, toneScore } from '../radar'
import { relaisDisponible } from '../relais'
import { creerProjetDepuisConsultation } from '../consultations'
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
  const [noteEvenements, setNoteEvenements] = useState('')
  const [enCours, setEnCours] = useState(false)
  const lanceAuto = useRef(false)
  /** décisions du Radar (écartée / surveillée) — partagées entre les 2 postes */
  const decisions = state.settings.veilleDecisions || {}
  const decider = (idweb: string, decision: 'ignoree' | 'surveillee' | null) =>
    update((d) => {
      const suivantes = { ...(d.settings.veilleDecisions || {}) }
      if (decision) suivantes[idweb] = decision
      else delete suivantes[idweb]
      d.settings.veilleDecisions = suivantes
    })

  /** rattache rectificatifs / annulations / résultats aux consultations
   *  suivies : un événement, JAMAIS un doublon (calculé avant mutation) */
  const appliquerEvenements = (evts: EvenementBoamp[]): number => {
    const prepares: { consultationId: string; ev: { date: string; type: string; detail: string }; nouvelleDateLimite: string | null }[] = []
    for (const e of evts) {
      const cible = state.consultations.find(
        (c) =>
          (c.sourceId && e.annoncesLiees.includes(c.sourceId)) ||
          cleConsultation(c.intitule, c.acheteur) === cleConsultation(e.objet, e.acheteur),
      )
      if (!cible) continue
      if (cible.evenements?.some((x) => x.detail?.includes(e.idweb))) continue // déjà rattaché
      prepares.push({
        consultationId: cible.id,
        ev: {
          date: e.dateParution || todayISO(),
          type: e.type,
          detail: `${e.objet.slice(0, 80)} — avis ${e.idweb} (${e.url})`,
        },
        nouvelleDateLimite: e.type === 'rectificatif' || e.type === 'modification' ? e.nouvelleDateLimite : null,
      })
    }
    if (prepares.length === 0) return 0
    update((d) => {
      for (const pmaj of prepares) {
        const c = d.consultations.find((x) => x.id === pmaj.consultationId)
        if (!c) continue
        c.evenements = [...(c.evenements || []), pmaj.ev]
        if (pmaj.nouvelleDateLimite) c.dateLimite = pmaj.nouvelleDateLimite
      }
    })
    return prepares.length
  }

  const majCriteres = (patch: Partial<CriteresBoamp>) =>
    update((d) => {
      d.settings.veilleBoamp = { ...criteres, ...patch }
    })

  const rechercher = async (c: CriteresBoamp) => {
    setEnCours(true)
    setErreur('')
    setNoteTed('')
    const [boamp, ted, evenements] = await Promise.allSettled([
      rechercherBoamp(c, todayISO()),
      relaisDisponible().then((d) =>
        d ? rechercherTed(c, todayISO()) : Promise.reject(new Error('relais indisponible (site déployé uniquement)')),
      ),
      rechercherEvenementsBoamp(c, todayISO()),
    ])
    const liste: AnnonceExterne[] = []
    if (boamp.status === 'fulfilled') liste.push(...boamp.value)
    else setErreur(boamp.reason instanceof Error ? boamp.reason.message : 'Recherche BOAMP impossible.')
    if (ted.status === 'fulfilled') liste.push(...ted.value)
    else setNoteTed(`TED non interrogé — ${ted.reason instanceof Error ? ted.reason.message : 'erreur inconnue'}.`)
    // dédoublonnage par identifiant de source (un avis présent 2 fois = 1 carte)
    const vues = new Set<string>()
    const dedoublonnee = liste.filter((x) => {
      const cle = `${x.plateforme}:${x.idweb}`
      if (vues.has(cle)) return false
      vues.add(cle)
      return true
    })
    dedoublonnee.sort((a, b) => b.dateParution.localeCompare(a.dateParution))
    setAnnonces(boamp.status === 'fulfilled' || ted.status === 'fulfilled' ? dedoublonnee : null)
    if (evenements.status === 'fulfilled' && evenements.value.length > 0) {
      const nb = appliquerEvenements(evenements.value)
      if (nb > 0)
        setNoteEvenements(
          `${nb} rectificatif(s)/résultat(s) rattaché(s) aux consultations suivies — dates limites mises à jour.`,
        )
    }
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
      const radar = scorerAnnonce(d, a, todayISO())
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
        sourceId: a.idweb,
        sourceUrl: a.url,
        typeAvis: a.typeAvis,
        notes: `Avis officiel : ${a.url}\nRadar ${radar.score}/100 — ${radar.raisons.slice(0, 3).join(' · ') || 'sans raison notée'}${radar.inconnues.length ? `\nÀ vérifier : ${radar.inconnues.join(' · ')}` : ''}`,
      })
    })

  return (
    <Card titre="Radar — BOAMP + TED, trié par pertinence pour l’agence">
      <p className="small muted" style={{ marginBottom: 10 }}>
        Marchés <strong>et concours</strong> en cours sur vos départements, notés par des règles
        lisibles (références, mission, délai, zone) — chaque carte dit pourquoi. Les rectificatifs et
        résultats se rattachent tout seuls aux consultations suivies, jamais en doublon.
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
      {noteEvenements && <p className="small ok-text">{noteEvenements}</p>}
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
      {annonces &&
        annonces.length > 0 &&
        (() => {
          // le Radar : cartes notées et triées, décisions mémorisées entre les 2 postes
          const notees = annonces
            .map((x) => ({ a: x, s: scorerAnnonce(state, x, today) }))
            .sort((x, y) => y.s.score - x.s.score)
          const actives = notees.filter(({ a }) => !decisions[a.idweb])
          const surveillees = notees.filter(({ a }) => decisions[a.idweb] === 'surveillee')
          const ignorees = notees.filter(({ a }) => decisions[a.idweb] === 'ignoree')

          const rendreCarte = ({ a, s: sc }: (typeof notees)[number], enSurveillance = false) => {
            const suivie = dejaSuivie(state, a)
            const dj = a.dateLimite ? diffDays(today, a.dateLimite) : null
            return (
              <div
                key={`${a.plateforme}:${a.idweb}`}
                style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 10, marginBottom: 10 }}
              >
                <p className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: 0 }}>
                  <Badge tone={toneScore(sc.score)}>score {sc.score}</Badge>
                  <span className="muted">confiance {sc.confiance}</span>
                  {a.typeAvis === 'concours' && <Badge tone="warn">CONCOURS</Badge>}
                  <Badge tone={a.plateforme === 'TED' ? 'info' : 'muted'}>{a.plateforme}</Badge>
                  {dj !== null && <Badge tone={dj < 10 ? 'danger' : 'muted'}>J−{dj}</Badge>}
                  <span className="spacer" />
                  <span className="muted"><DateF d={a.dateParution} /></span>
                </p>
                <p style={{ margin: '6px 0 2px' }}>
                  <a href={a.url} target="_blank" rel="noreferrer" title="Ouvrir l'avis officiel">
                    <strong>{a.objet.length > 140 ? a.objet.slice(0, 140) + '…' : a.objet}</strong>
                  </a>
                </p>
                <p className="small muted" style={{ margin: '0 0 6px' }}>
                  {a.acheteur || 'acheteur non identifié'}
                  {a.departements.length > 0 && <> · dép. {a.departements.join(', ')}</>}
                  {a.dateLimite && <> · limite <DateF d={a.dateLimite} /></>}
                  {a.procedure && <> · {a.procedure}</>}
                </p>
                {sc.raisons.length > 0 && (
                  <p className="small" style={{ margin: '0 0 2px' }}>
                    {sc.raisons.slice(0, 3).map((r, i) => (
                      <span key={i} style={{ display: 'block' }}>✓ {r}</span>
                    ))}
                  </p>
                )}
                {sc.risque && <p className="small warn-text" style={{ margin: '0 0 2px' }}>! {sc.risque}</p>}
                {sc.inconnues.length > 0 && (
                  <p className="small muted" style={{ margin: '0 0 6px' }}>? {sc.inconnues.join(' · ')}</p>
                )}
                <div className="toolbar" style={{ marginBottom: 0 }}>
                  {suivie ? (
                    <Badge tone="ok">déjà suivie</Badge>
                  ) : (
                    <Btn small kind="primary" onClick={() => suivre(a)} title="Crée la consultation préremplie (source, score, raisons) en « À étudier »">
                      Valider — à étudier
                    </Btn>
                  )}
                  {!suivie &&
                    (enSurveillance ? (
                      <Btn small kind="ghost" onClick={() => decider(a.idweb, null)}>Ne plus surveiller</Btn>
                    ) : (
                      <Btn small kind="ghost" onClick={() => decider(a.idweb, 'surveillee')}>Surveiller</Btn>
                    ))}
                  {!suivie && (
                    <Btn small kind="ghost" onClick={() => decider(a.idweb, 'ignoree')}>Ignorer</Btn>
                  )}
                </div>
              </div>
            )
          }

          return (
            <>
              {actives.map((x) => rendreCarte(x))}
              {actives.length === 0 && (
                <EmptyState>Tout le Radar est traité — les éléments écartés ou surveillés sont ci-dessous.</EmptyState>
              )}
              {surveillees.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
                    Sous surveillance ({surveillees.length})
                  </summary>
                  <div style={{ marginTop: 8 }}>{surveillees.map((x) => rendreCarte(x, true))}</div>
                </details>
              )}
              {ignorees.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
                    Écartées ({ignorees.length}) — chaque exclusion reste réversible
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    {ignorees.map(({ a, s: sc }) => (
                      <p key={`${a.plateforme}:${a.idweb}`} className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Badge tone="muted">score {sc.score}</Badge>
                        <a href={a.url} target="_blank" rel="noreferrer">
                          {a.objet.length > 90 ? a.objet.slice(0, 90) + '…' : a.objet}
                        </a>
                        <Btn small kind="ghost" onClick={() => decider(a.idweb, null)}>Restaurer</Btn>
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </>
          )
        })()}
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
          const { chemin, dejaPresent } = await ecrireFichierRacine(
            racine,
            '0_CANDIDATURES',
            new File([blob], nom, { type: blob.type }),
          )
          setMessage({
            ok: true,
            texte: dejaPresent
              ? `Déjà dans le Drive à l'identique : ${chemin} — rien n'a été réécrit.`
              : `Dossier écrit dans le Drive : ${chemin} — à relire et compléter.`,
          })
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
            aucune en base — <a href="#/ao/references">alimentez l'onglet Références</a>
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
        {enCours ? (
          'Génération…'
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="file" size={14} /> Générer le dossier de candidature (DOCX)
          </span>
        )}
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

const NOTES_GO_NOGO: { value: string; label: string }[] = [
  { value: '', label: '— à noter —' },
  { value: '0', label: '0 · rédhibitoire' },
  { value: '1', label: '1 · défavorable' },
  { value: '2', label: '2 · neutre' },
  { value: '3', label: '3 · favorable' },
  { value: '4', label: '4 · idéal' },
]

function GrilleGoNoGo({ c, maj }: { c: Consultation; maj: (patch: Partial<Consultation>) => void }) {
  const scores = c.scoresGoNoGo || {}
  const evalu = evaluerGoNoGo(scores)
  const noter = (code: string, v: string) => {
    const suivant = { ...scores }
    if (v === '') delete suivant[code]
    else suivant[code] = Number(v)
    maj({ scoresGoNoGo: suivant })
  }
  return (
    <Card titre="Grille Go / No-Go (aide à la décision)">
      <p className="small muted" style={{ marginTop: 0, marginBottom: 8 }}>
        Notez chaque critère : le score pondéré donne une reco — la décision reste humaine.
      </p>
      <table className="table table-compact">
        <tbody>
          {CRITERES_GO_NOGO.map((cr) => (
            <tr key={cr.code}>
              <td>
                {cr.label} <span className="muted small">×{cr.poids}</span>
                <div className="muted small">{cr.aide}</div>
              </td>
              <td className="right" style={{ width: 170 }}>
                <Select
                  value={scores[cr.code] != null ? String(scores[cr.code]) : ''}
                  onChange={(v) => noter(cr.code, v)}
                  options={NOTES_GO_NOGO}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {evalu.note !== null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <Badge tone={evalu.tone}>{evalu.reco}</Badge>
          <span className="small">
            Score <strong>{fmtPct(evalu.note, 0)}</strong>
            {!evalu.complet && <span className="muted"> · grille incomplète</span>}
          </span>
        </div>
      ) : (
        <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>Aucun critère noté pour l'instant.</p>
      )}
    </Card>
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
  const { state, update, replace } = useStore()
  const [c, setC] = useState<Consultation>({ ...initial })
  const maj = (patch: Partial<Consultation>) => setC((prev) => ({ ...prev, ...patch }))

  const enregistrer = () => {
    const intitule = c.intitule.trim()
    if (!intitule) {
      toast("L'intitulé de la consultation est obligatoire.", { tone: 'danger' })
      return
    }
    const propre: Consultation = { ...c, intitule }
    let projetCree: string | null = null
    update((d) => {
      let finale = propre
      // gagnée et pas encore de projet → il se crée tout seul
      if (propre.statut === 'gagnee' && !propre.projetId) {
        projetCree = creerProjetDepuisConsultation(d, propre)
        finale = { ...propre, projetId: projetCree }
      }
      const i = d.consultations.findIndex((x) => x.id === finale.id)
      if (i >= 0) d.consultations[i] = finale
      else d.consultations.push(finale)
    })
    onClose()
    if (projetCree) navigate(`/projets/${projetCree}`)
  }

  const supprimer = async () => {
    const snap = state
    if (!(await confirmer({ message: `Supprimer la consultation « ${c.intitule || 'sans intitulé'} » ?`, danger: true, confirmerLabel: 'Supprimer' }))) return
    update((d) => {
      d.consultations = d.consultations.filter((x) => x.id !== c.id)
    })
    toast('Consultation supprimée.', { undo: () => replace(snap) })
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

      {/* création RAPIDE : 4 champs suffisent — budget, typologie, scores
          et avis se complètent pendant la qualification (fiche) */}
      <Field label="Intitulé">
        <TextInput value={c.intitule} onChange={(v) => maj({ intitule: v })} placeholder="Restructuration du groupe scolaire…" />
      </Field>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Acheteur">
          <TextInput value={c.acheteur || ''} onChange={(v) => maj({ acheteur: v })} />
        </Field>
        <Field label="Date limite de remise">
          <DateInput value={c.dateLimite ?? null} onChange={(v) => maj({ dateLimite: v })} />
        </Field>
        <Field label="Source" hint="BOAMP, TED, alerte, bouche à oreille…">
          <TextInput value={c.source || ''} onChange={(v) => maj({ source: v })} />
        </Field>
      </div>
      {nouveau && (
        <p className="muted small" style={{ marginTop: 8 }}>
          C'est tout pour créer — lieu, typologie, budget, grille Go/No-Go et avis se remplissent
          ensuite, pendant la qualification, en rouvrant la fiche.
        </p>
      )}
      {!nouveau && (
        <>
          <div className="form-row" style={{ marginTop: 10 }}>
            <Field label="Lieu">
              <TextInput value={c.lieu || ''} onChange={(v) => maj({ lieu: v })} />
            </Field>
            <Field label="Typologie">
              <TextInput value={c.typologie || ''} onChange={(v) => maj({ typologie: v })} placeholder="Enseignement, logement, réhabilitation…" />
            </Field>
            <Field label="Budget travaux HT">
              <NumInput value={c.budgetTravaux ?? null} onChange={(v) => maj({ budgetTravaux: v })} />
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
          </div>
          <div style={{ marginTop: 12 }}>
            <GrilleGoNoGo c={c} maj={maj} />
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="Avis Go / No-Go" hint="Avis préparé avec Claude puis relu et collé ici — la décision reste humaine.">
              <TextArea rows={4} value={c.avisGoNoGo || ''} onChange={(v) => maj({ avisGoNoGo: v })} />
            </Field>
          </div>
        </>
      )}
      {resultatConnu && (
        <>
          {c.statut === 'gagnee' && (
            <p className="small" style={{ marginTop: 10 }}>
              {c.projetId ? (
                <>
                  <Badge tone="ok">projet créé</Badge>{' '}
                  <a href={`#/projets/${c.projetId}`}>ouvrir l'espace projet {c.projetId} →</a>
                </>
              ) : (
                <span className="muted">
                  🎉 À l'enregistrement, l'espace projet sera créé automatiquement (nom, MOA, budget,
                  phases d'honoraires) — vous y serez amené directement.
                </span>
              )}
            </p>
          )}
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
      {!nouveau && (
        <div style={{ marginTop: 10 }}>
          <Field label="Notes">
            <TextArea rows={2} value={c.notes || ''} onChange={(v) => maj({ notes: v })} />
          </Field>
        </div>
      )}

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

// ---------- onglet Consultations ----------

function ConsultationsContenu() {
  const { state } = useStore()
  const today = useToday()
  const [q, setQ] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [filtreTypologie, setFiltreTypologie] = useState('')
  const [filtreBudget, setFiltreBudget] = useState('')
  const [filtreEcheance, setFiltreEcheance] = useState('')
  const [tri, setTri] = useState('defaut')
  const [fiche, setFiche] = useState<{ c: Consultation; nouveau: boolean } | null>(null)

  const consultations = state.consultations
  const fq = fold(q)

  // typologies réellement présentes — le filtre suit les données, pas un référentiel figé
  const typologies = [...new Set(consultations.map((c) => (c.typologie || '').trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  )

  const passeBudget = (c: Consultation): boolean => {
    if (!filtreBudget) return true
    const b = c.budgetTravaux
    if (filtreBudget === 'sans') return b == null
    if (b == null) return false
    if (filtreBudget === 'moins500') return b < 500_000
    if (filtreBudget === '500a2000') return b >= 500_000 && b < 2_000_000
    return b >= 2_000_000
  }

  const passeEcheance = (c: Consultation): boolean => {
    if (!filtreEcheance) return true
    if (filtreEcheance === 'sans') return !c.dateLimite
    if (!c.dateLimite) return false
    const dj = diffDays(today, c.dateLimite)
    if (filtreEcheance === 'depassee') return dj < 0
    if (filtreEcheance === 'j10') return dj >= 0 && dj <= 10
    return dj >= 0 && dj <= 30
  }

  /** note 0–1 pour le tri ; les consultations non notées passent en fin */
  const noteGoNoGo = (c: Consultation): number => evaluerGoNoGo(c.scoresGoNoGo).note ?? -1

  const visibles = consultations
    .filter((c) => !filtreStatut || c.statut === filtreStatut)
    .filter((c) => !filtreTypologie || (c.typologie || '').trim() === filtreTypologie)
    .filter(passeBudget)
    .filter(passeEcheance)
    .filter(
      (c) =>
        !fq ||
        fold(
          `${c.intitule} ${c.acheteur || ''} ${c.lieu || ''} ${c.typologie || ''} ${c.source || ''}`,
        ).includes(fq),
    )
    .sort((a, b) => {
      if (tri === 'gonogo')
        return noteGoNoGo(b) - noteGoNoGo(a) || (a.dateLimite || '9999').localeCompare(b.dateLimite || '9999')
      if (tri === 'limite')
        return (a.dateLimite || '9999').localeCompare(b.dateLimite || '9999') || a.intitule.localeCompare(b.intitule)
      if (tri === 'budget') return (b.budgetTravaux ?? -1) - (a.budgetTravaux ?? -1) || a.intitule.localeCompare(b.intitule)
      return (
        ORDRE_STATUTS[a.statut] - ORDRE_STATUTS[b.statut] ||
        (a.dateLimite || '9999').localeCompare(b.dateLimite || '9999') ||
        a.intitule.localeCompare(b.intitule)
      )
    })

  const optionsStatut = [
    { value: '', label: `Tous les statuts (${consultations.length})` },
    ...STATUTS.map((s) => ({
      value: s.value,
      label: `${s.label} (${consultations.filter((c) => c.statut === s.value).length})`,
    })),
  ]
  const optionsTypologie = [
    { value: '', label: 'Toutes typologies' },
    ...typologies.map((t) => ({ value: t, label: t })),
  ]
  const optionsBudget = [
    { value: '', label: 'Tous budgets' },
    { value: 'moins500', label: 'Travaux < 500 k€' },
    { value: '500a2000', label: '500 k€ – 2 M€' },
    { value: 'plus2000', label: '> 2 M€' },
    { value: 'sans', label: 'Budget non renseigné' },
  ]
  const optionsEcheance = [
    { value: '', label: 'Toutes échéances' },
    { value: 'j10', label: 'Limite sous 10 j' },
    { value: 'j30', label: 'Limite sous 30 j' },
    { value: 'depassee', label: 'Limite dépassée' },
    { value: 'sans', label: 'Sans date limite' },
  ]
  const optionsTri = [
    { value: 'defaut', label: 'Tri : statut puis limite' },
    { value: 'gonogo', label: 'Tri : score Go/No-Go' },
    { value: 'limite', label: 'Tri : date limite' },
    { value: 'budget', label: 'Tri : budget travaux' },
  ]
  const filtresActifs = Boolean(q || filtreStatut || filtreTypologie || filtreBudget || filtreEcheance)
  const reinitialiser = () => {
    setQ('')
    setFiltreStatut('')
    setFiltreTypologie('')
    setFiltreBudget('')
    setFiltreEcheance('')
  }

  const ouvrir = (c: Consultation) => setFiche({ c: { ...c }, nouveau: false })

  return (
    <>
      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <Btn kind="primary" onClick={() => setFiche({ c: nouvelleConsultation(), nouveau: true })}>
          Nouvelle consultation
        </Btn>
      </div>

      <Card titre="Toutes les consultations">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <TextInput
            value={q}
            onChange={setQ}
            placeholder="Rechercher (intitulé, acheteur, lieu / zone…)"
            style={{ minWidth: 240 }}
          />
          <Select value={filtreStatut} onChange={setFiltreStatut} options={optionsStatut} />
          {typologies.length > 0 && (
            <Select value={filtreTypologie} onChange={setFiltreTypologie} options={optionsTypologie} />
          )}
          <Select value={filtreBudget} onChange={setFiltreBudget} options={optionsBudget} />
          <Select value={filtreEcheance} onChange={setFiltreEcheance} options={optionsEcheance} />
          <Select value={tri} onChange={setTri} options={optionsTri} />
          {filtresActifs && (
            <Btn small kind="ghost" onClick={reinitialiser}>
              Réinitialiser
            </Btn>
          )}
          <span className="spacer" />
          <span className="muted small">
            {visibles.length} / {consultations.length} consultation(s)
          </span>
        </div>
        {consultations.length === 0 ? (
          <EmptyState>
            Aucune consultation — la veille l'alimente (onglet Veille), ou créez-en une manuellement.
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
              'Go/No-Go',
              '',
            ]}
          >
            {visibles.map((c) => (
              <tr key={c.id} className="clickable" {...ligneActivable(() => ouvrir(c))}>
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
                <td>
                  {(() => {
                    const e = evaluerGoNoGo(c.scoresGoNoGo)
                    if (!e.reco) return <span className="muted">—</span>
                    return (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Badge tone={e.tone}>{e.reco}</Badge>
                        {e.note !== null && <span className="muted small num">{fmtPct(e.note, 0)}</span>}
                      </span>
                    )
                  })()}
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
    </>
  )
}

// ---------- module ----------

const ONGLETS_AO: { id: string; label: string }[] = [
  { id: 'veille', label: 'Radar' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'consultations', label: 'Consultations' },
  { id: 'references', label: 'Références' },
]

export default function VeilleAO({ ongletInitial = 'veille' }: { ongletInitial?: string }) {
  const route = useRoute()
  const segment = route[0] === 'ao' ? route[1] : ongletInitial
  const onglet = ONGLETS_AO.some((o) => o.id === segment) ? segment! : 'veille'

  return (
    <Page
      titre="Développement"
      sousTitre="Le Radar des opportunités, le pipeline, les candidatures et les références."
    >
      <Tabs tabs={ONGLETS_AO} actif={onglet} onSelect={(id) => navigate(`/ao/${id}`)} />

      {onglet === 'veille' && (
        <>
          <CarteBoamp />
          <ImportVeille />
        </>
      )}
      {onglet === 'pipeline' && <PipelineContenu />}
      {onglet === 'consultations' && <ConsultationsContenu />}
      {onglet === 'references' && <ReferencesContenu />}
    </Page>
  )
}
