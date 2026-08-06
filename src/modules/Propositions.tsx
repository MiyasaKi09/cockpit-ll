// ============================================================
// La PORTE du moteur de détection (§8.7) — livrables B.10 / B.11.
//
// Les détecteurs tournent depuis A.10 et remplissent `public.propositions` ;
// la couche d'accès (`src/propositions.ts`) et les quatre gestes
// (`src/revuePropositions.ts`) sont livrés ET testés. Il ne manquait que
// ceci : un écran. Sans lui, la promesse centrale de l'outil — « la machine
// a déjà lu vos mails » — n'existait qu'en base, et on retraitait à la main
// ce qui était déjà trouvé.
//
// CE QUE CET ÉCRAN NE FAIT PAS
// -----------------------------
// Il ne détecte rien, ne calcule rien, et n'accepte rien tout seul. La
// machine PROPOSE, l'humain DÉCIDE (§15) : chaque geste part d'un clic, et
// chaque clic laisse un « Annuler ». L'écran ne fabrique pas non plus la
// tâche qu'il crée — `accepterTache` (src/revuePropositions.ts) en est
// l'auteur, `accepter` (src/propositions.ts) écrit la signature. Deux
// autorités, aucune recopie.
//
// LA FORME EST CELLE DE LA REVUE DOCUMENTAIRE
// --------------------------------------------
// Une proposition à la fois, son motif visible (l'extrait cité, la
// confiance, les raisons), les gestes en pied, les flèches pour avancer.
// C'est le domaine le plus abouti de l'outil ; on ne réinvente pas sa
// grammaire, on la réemploie.
//
// « Accepter » ne se confond pas avec « faire disparaître » : ce qui est
// tranché reste lisible dans l'onglet « Tranchées », avec de quoi rouvrir
// ce qui a été écarté par erreur.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  DateInput,
  EmptyState,
  Field,
  LienGmail,
  Page,
  Select,
  Tabs,
  TextInput,
  toast,
  useToday,
} from '../ui'
import type { Proposition } from '../propositions'
import {
  LIBELLES_GENRE,
  LIBELLES_NATURE_RISQUE,
  LIBELLES_OBJET_PROPOSE,
  LIBELLES_STATUT,
  accepter as signerAcceptation,
  ignorer as signerRefus,
  rouvrir as rouvrirProposition,
  usePropositions,
} from '../propositions'
import type { GesteRevue, PropositionARevoir } from '../revuePropositions'
import {
  GESTES_REVUE,
  accepterTache,
  brouillonDepuis,
  cibleEcheance,
  dateEcheance,
  ignorer as motifDuRefus,
} from '../revuePropositions'
import { useMoi } from '../moi'
import { estOuverte } from '../taches'
import { nomProjet } from '../derive'
import { fmtDate } from '../util'

/** la file de revue du §8.7. Constante de module : reconstruit à chaque
 *  rendu, le filtre ferait repaginer la couche d'accès en boucle. */
const FILTRE_A_REVOIR = { statut: 'proposee' as const }

/** l'historique : tout, filtré ensuite sur « déjà tranché » — la couche
 *  d'accès ne sait filtrer que sur UN statut, et « acceptée ou ignorée »
 *  en fait deux */
const FILTRE_TOUT = {}

/** ce que chacun des quatre gestes du §8.7 veut dire ici. La liste elle-même
 *  vient de `GESTES_REVUE` : la réécrire donnerait deux inventaires qui
 *  divergent au premier ajout. */
const AIDE_GESTE: Record<GesteRevue, string> = {
  accepter: 'crée l’objet proposé, puis signe la proposition — elle le DÉSIGNE, elle ne le devient pas',
  modifier: 'corrigez les champs du formulaire : rien n’est créé tant que vous n’avez pas cliqué',
  attribuer: 'choisissez le responsable — aucune machine ne décide qui est prévenu (§3.15)',
  ignorer: 'écarte la détection avec un motif court ; elle reste lisible, elle ne revient plus',
}

/** motifs courts proposés au clic — les mêmes reviennent tout le temps, et
 *  « pas une tâche » n'apprend pas la même chose que « déjà fait » */
const MOTIFS_FREQUENTS = ['Pas une tâche', 'Déjà fait', 'Hors sujet', 'Doublon']

function BadgeConfiance({ confiance }: { confiance: number | null }) {
  // « null n'est pas 0 » : sans confiance annoncée, on ne fabrique pas un
  // pourcentage — on dit que la détection n'en donne pas.
  if (confiance === null) return <Badge tone="muted">confiance non annoncée</Badge>
  const pct = Math.round(confiance * 100)
  return <Badge tone={confiance >= 0.6 ? 'ok' : confiance >= 0.3 ? 'warn' : 'muted'}>confiance {pct} %</Badge>
}

/**
 * `Proposition` (couche d'accès) → `PropositionARevoir` (couche de revue).
 *
 * Les deux modules sont volontairement indépendants : celui de la revue ne
 * sait rien de Supabase, et c'est ce qui le rend vérifiable en CI. Le pont
 * vit donc ici, à l'écran, et nulle part ailleurs.
 */
function aRevoir(p: Proposition): PropositionARevoir {
  return {
    id: p.id,
    genre: p.genre,
    // les charges utiles sont des interfaces typées par genre : elles n'ont
    // pas d'index de chaîne. La conversion ne transforme aucune donnée.
    chargeUtile: { ...p.chargeUtile } as unknown as Record<string, unknown>,
    extrait: p.extrait,
    confiance: p.confiance,
    raisons: p.raisons,
    projetId: p.message.projetId,
  }
}

/** le message d'où sort la détection — §4.2 : une proposition sans sa source
 *  est une affirmation invérifiable */
function EnTeteMessage({ p }: { p: Proposition }) {
  const { state } = useStore()
  return (
    <div className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <Badge tone="info">{LIBELLES_GENRE[p.genre]}</Badge>
      <BadgeConfiance confiance={p.confiance} />
      <span className="muted">
        {p.origine === 'modele' ? 'lu par un modèle' : 'marqueur reconnu'}
        {p.message.envoyeLe ? ` · message du ${fmtDate(p.message.envoyeLe.slice(0, 10))}` : ''}
      </span>
      {p.message.projetId ? (
        <a href={`#/projets/${p.message.projetId}`} className="badge badge-muted">
          {p.message.projetId} — {nomProjet(state, p.message.projetId)}
        </a>
      ) : (
        <span className="badge badge-warn" title="Le message n’est rattaché à aucun projet : corrigez-le à l’accueil ou dans Documents">
          projet ?
        </span>
      )}
      <LienGmail source={p.message.gmailMessageId} />
    </div>
  )
}

/** l'extrait cité, les raisons : le MOTIF, toujours visible avant les gestes */
function Motif({ p }: { p: Proposition }) {
  return (
    <>
      <blockquote
        className="pill-note"
        style={{ margin: '8px 0', fontStyle: 'italic', borderLeft: '3px solid var(--accent)' }}
      >
        « {p.extrait} »
        <div className="muted small" style={{ fontStyle: 'normal', marginTop: 4 }}>
          {p.message.objet || '(message sans objet)'}
        </div>
      </blockquote>
      {p.raisons.length > 0 && (
        <details>
          <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
            Voir pourquoi ({p.raisons.length})
          </summary>
          <ul className="small muted" style={{ margin: '4px 0 8px 18px' }}>
            {p.raisons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

/** le pied « Ignorer… » : le motif est OBLIGATOIRE, `ignorer()` l'impose */
function PiedIgnorer({ onIgnorer, occupe }: { onIgnorer: (motif: string) => void; occupe: boolean }) {
  const [ouvert, setOuvert] = useState(false)
  const [motif, setMotif] = useState('')

  if (!ouvert)
    return (
      <Btn kind="ghost" disabled={occupe} onClick={() => setOuvert(true)}>
        Ignorer…
      </Btn>
    )

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <TextInput
        value={motif}
        onChange={setMotif}
        placeholder="Motif court — ce qui n’allait pas"
        ariaLabel="Motif de l’oubli"
        style={{ width: 240 }}
      />
      {MOTIFS_FREQUENTS.map((m) => (
        <Btn key={m} small kind="ghost" onClick={() => setMotif(m)}>
          {m}
        </Btn>
      ))}
      <Btn
        small
        kind="danger"
        disabled={!motif.trim() || occupe}
        onClick={() => {
          setOuvert(false)
          onIgnorer(motif)
        }}
      >
        Écarter
      </Btn>
      <Btn small kind="ghost" onClick={() => setOuvert(false)}>
        Annuler
      </Btn>
      {/* dire ce qu'il advient du motif plutôt que le laisser croire :
          « pas une tâche » et « déjà fait » n'apprennent pas la même chose
          au détecteur, mais la table des propositions ne porte pas encore
          de colonne pour le conserver. Il nomme ce qui a raté, et il part
          avec la décision. */}
      <span className="muted small" style={{ flexBasis: '100%' }}>
        Le motif est demandé pour nommer ce que la détection a raté. Il n’est pas encore conservé : la table
        ne porte pas de colonne pour lui.
      </span>
    </span>
  )
}

// ------------------------------------------------------------
// La carte d'UNE proposition — montée avec `key={p.id}`, donc remise à
// neuf à chaque décision : les champs de la précédente ne débordent pas
// sur la suivante.
// ------------------------------------------------------------

function CarteProposition({
  p,
  personnes,
  moi,
  apres,
}: {
  p: Proposition
  personnes: string[]
  moi: string | null
  /** à appeler quand la proposition a changé de statut : la file se relit */
  apres: () => void
}) {
  const { state, update, replace } = useStore()
  const today = useToday()
  const revue = useMemo(() => aRevoir(p), [p])
  const brouillon = useMemo(() => brouillonDepuis(revue), [revue])

  const [titre, setTitre] = useState(brouillon.titre)
  const [responsable, setResponsable] = useState('')
  const [echeance, setEcheance] = useState<string | null>(brouillon.echeance)
  const [cibleId, setCibleId] = useState('')
  const [occupe, setOccupe] = useState(false)

  const cible = cibleEcheance(revue)
  const dateProposee = dateEcheance(revue)
  const [dateChoisie, setDateChoisie] = useState<string | null>(dateProposee)

  /** les tâches datables : celles du projet du message d'abord */
  const tachesOuvertes = useMemo(
    () =>
      (state.taches || [])
        .filter(estOuverte)
        .sort(
          (a, b) =>
            Number(b.projetId === p.message.projetId) - Number(a.projetId === p.message.projetId) ||
            a.titre.localeCompare(b.titre),
        ),
    [state.taches, p.message.projetId],
  )

  const echouer = (e: unknown) => toast(e instanceof Error ? e.message : String(e), { tone: 'warn' })

  /** Accepter : l'objet est créé PUIS la proposition le désigne.
   *
   *  L'ordre compte. La signature part la première : si elle est refusée
   *  (pas d'espace partagé, pas d'identité), rien n'a été créé et il n'y a
   *  rien à défaire. L'inverse laisserait une tâche orpheline et une
   *  proposition encore « à revoir » — le même travail deux fois. */
  const accepterEnTache = async () => {
    if (!moi) return
    setOccupe(true)
    try {
      // l'auteur de la tâche est `accepterTache` (src/revuePropositions.ts) :
      // il pose la source, le projet hérité du message et le statut. La
      // signature qu'il rend est ignorée à dessein — c'est `accepter` qui
      // écrit, par la file hors ligne, et deux écritures diraient deux fois
      // la même chose.
      const { tache } = accepterTache(revue, {
        titre,
        responsable: responsable || null,
        echeance,
        par: moi,
      })
      await signerAcceptation(p, { type: 'tache', id: tache.id }, moi)
      const snap = state
      update((d) => {
        d.taches.push(tache)
      })
      apres()
      toast(`Tâche créée${tache.projetId ? ` sur ${tache.projetId}` : ''} — proposition acceptée.`, {
        undo: () => {
          replace(snap)
          void rouvrirProposition(p, moi).then(apres).catch(echouer)
        },
      })
    } catch (e) {
      echouer(e)
    } finally {
      setOccupe(false)
    }
  }

  /** Accepter une ÉCHÉANCE : elle se POSE sur un objet existant, elle n'en
   *  crée aucun. `TacheInterne.echeance` ou `Contact.dateProchaineAction`,
   *  jamais une obligation ni une échéance de facturation (§3.14). */
  const accepterEcheance = async () => {
    if (!moi || !cible || !cibleId || !dateChoisie) return
    setOccupe(true)
    try {
      await signerAcceptation(p, { type: cible, id: cibleId }, moi)
      const snap = state
      update((d) => {
        if (cible === 'tache') {
          const t = d.taches.find((x) => x.id === cibleId)
          if (t) {
            t.echeance = dateChoisie
            t.majLe = new Date().toISOString()
          }
        } else {
          const c = d.contacts.find((x) => x.id === cibleId)
          if (c) c.dateProchaineAction = dateChoisie
        }
      })
      apres()
      toast(`Échéance du ${fmtDate(dateChoisie)} posée — proposition acceptée.`, {
        undo: () => {
          replace(snap)
          void rouvrirProposition(p, moi).then(apres).catch(echouer)
        },
      })
    } catch (e) {
      echouer(e)
    } finally {
      setOccupe(false)
    }
  }

  const ignorer = async (saisi: string) => {
    if (!moi) return
    // le motif est validé par l'autorité, pas par l'écran : `ignorer()`
    // refuse le vide, et c'est lui qui dit pourquoi
    const refus = motifDuRefus(saisi, moi)
    if ('erreur' in refus) {
      toast(refus.erreur, { tone: 'warn' })
      return
    }
    setOccupe(true)
    try {
      await signerRefus(p, moi)
      apres()
      toast(`Détection écartée — « ${refus.motif} ».`, {
        undo: () => void rouvrirProposition(p, moi).then(apres).catch(echouer),
      })
    } catch (e) {
      echouer(e)
    } finally {
      setOccupe(false)
    }
  }

  const optionsResponsable = [
    { value: '', label: '— à deux (aucun responsable) —' },
    ...personnes.map((n) => ({ value: n, label: n === moi ? `${n} (moi)` : n })),
  ]

  // ----- ce que la charge utile dit, genre par genre -----

  // la charge utile déjà convertie par l'adaptateur : aucune seconde
  // conversion, aucune seconde lecture de la même donnée
  const charge = revue.chargeUtile
  const suggere = p.genre === 'tache' ? (charge.responsable as string | null) : null

  return (
    <>
      <EnTeteMessage p={p} />
      <Motif p={p} />

      {p.genre === 'echeance' ? (
        <>
          <p className="small" style={{ margin: '0 0 6px' }}>
            Échéance détectée : <strong>{dateProposee ? fmtDate(dateProposee) : 'date illisible'}</strong>
            {typeof charge.libelle === 'string' && charge.libelle ? ` — ${charge.libelle}` : ''} · à poser sur{' '}
            <strong>{cible ? LIBELLES_OBJET_PROPOSE[cible].toLowerCase() : '?'}</strong>
          </p>
          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <Field
              label={cible === 'contact' ? 'Contact à dater' : 'Tâche à dater'}
              hint="L’échéance se pose sur un objet qui existe déjà : elle n’en crée aucun."
            >
              <Select
                value={cibleId}
                onChange={setCibleId}
                options={
                  cible === 'contact'
                    ? [
                        { value: '', label: '— choisir un contact —' },
                        ...state.contacts.map((c) => ({
                          value: c.id,
                          label: `${c.nom}${c.organisme ? ` (${c.organisme})` : ''}`,
                        })),
                      ]
                    : [
                        { value: '', label: '— choisir une tâche —' },
                        ...tachesOuvertes.map((t) => ({
                          value: t.id,
                          label: `${t.projetId ? `${t.projetId} · ` : ''}${t.titre}`,
                        })),
                      ]
                }
              />
            </Field>
            <Field label="Date">
              <DateInput value={dateChoisie} onChange={setDateChoisie} />
            </Field>
          </div>
          {cible === 'tache' && tachesOuvertes.length === 0 && (
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Aucune tâche ouverte à dater. Créez-la d’abord dans <a href="#/taches">Tâches</a> — ou écartez la
              détection avec son motif.
            </p>
          )}
          {cible === 'contact' && state.contacts.length === 0 && (
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Aucun contact à dater. Créez-le d’abord dans <a href="#/ressources/contacts">Contacts</a> — ou
              écartez la détection avec son motif.
            </p>
          )}
        </>
      ) : (
        <>
          {p.genre === 'decision' && (
            <p className="small" style={{ margin: '0 0 6px' }}>
              Décision repérée : <strong>{String(charge.objet || '')}</strong>
              {typeof charge.validee_par === 'string' && charge.validee_par ? ` — par ${charge.validee_par}` : ''}
              {typeof charge.date === 'string' && charge.date ? ` le ${fmtDate(charge.date)}` : ''}
            </p>
          )}
          {p.genre === 'risque' && (
            <p className="small" style={{ margin: '0 0 6px' }}>
              Risque repéré :{' '}
              <strong>{LIBELLES_NATURE_RISQUE[charge.nature as keyof typeof LIBELLES_NATURE_RISQUE]}</strong>
              {typeof charge.detail === 'string' && charge.detail ? ` — ${charge.detail}` : ''}
            </p>
          )}
          {(p.genre === 'decision' || p.genre === 'risque') && (
            <p className="muted small" style={{ margin: '0 0 6px' }}>
              Les décisions et les risques n’ont pas encore de fiche à eux dans l’outil (phase 2). En attendant,
              une détection utile devient une <strong>tâche de suivi</strong> qui garde le lien vers le message ;
              sinon elle s’écarte avec son motif. Rien n’est perdu : la détection reste lisible dans « Tranchées ».
            </p>
          )}
          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <Field label={p.genre === 'tache' ? 'Tâche proposée' : 'Tâche de suivi'}>
              <TextInput value={titre} onChange={setTitre} style={{ minWidth: 260 }} />
            </Field>
            <Field
              label="Responsable"
              hint={suggere ? `Suggéré par la détection : ${suggere} — à confirmer` : 'Personne n’est pré-rempli'}
            >
              <Select value={responsable} onChange={setResponsable} options={optionsResponsable} />
            </Field>
            <Field label="Échéance">
              <DateInput value={echeance} onChange={setEcheance} />
            </Field>
          </div>
        </>
      )}

      <div className="form-foot" style={{ flexWrap: 'wrap' }}>
        <PiedIgnorer onIgnorer={(m) => void ignorer(m)} occupe={occupe} />
        <span className="spacer" />
        {p.genre === 'echeance' ? (
          <Btn
            kind="primary"
            disabled={occupe || !moi || !cible || !cibleId || !dateChoisie}
            onClick={() => void accepterEcheance()}
          >
            {dateChoisie ? `Accepter — poser l’échéance du ${fmtDate(dateChoisie)}` : 'Accepter — poser l’échéance'}
          </Btn>
        ) : (
          <Btn kind="primary" disabled={occupe || !moi || !titre.trim()} onClick={() => void accepterEnTache()}>
            {p.genre === 'tache' ? 'Accepter — créer la tâche' : 'Accepter — créer la tâche de suivi'}
          </Btn>
        )}
      </div>
      {echeance && echeance < today && p.genre !== 'echeance' && (
        <p className="small" style={{ margin: '4px 0 0' }}>
          <span className="badge badge-warn">échéance déjà passée</span> la date détectée est antérieure à
          aujourd’hui : corrigez-la avant d’accepter si elle n’a plus de sens.
        </p>
      )}
    </>
  )
}

// ------------------------------------------------------------
// L'onglet « Tranchées » — ce qui a été accepté ou écarté reste lisible
// ------------------------------------------------------------

function CarteTranchees({ apres }: { apres: () => void }) {
  const moi = useMoi()
  const { lignes, source, erreur, chargement, suite, chargerSuite, recharger } = usePropositions(FILTRE_TOUT)
  const tranchees = (lignes || []).filter((p) => p.statut !== 'proposee')

  const rouvrir = async (p: Proposition) => {
    if (!moi.nom) return
    try {
      await rouvrirProposition(p, moi.nom)
      recharger()
      apres()
      toast('Proposition remise dans la file de revue.', { tone: 'ok' })
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { tone: 'warn' })
    }
  }

  return (
    <Card titre="Déjà tranchées">
      {erreur ? (
        <EmptyState>Les propositions sont illisibles : {erreur}</EmptyState>
      ) : lignes === null ? (
        <EmptyState>
          {chargement
            ? 'Lecture en cours…'
            : 'Ni le réseau ni le cache n’ont répondu : ce poste ne sait pas ce qui a été tranché. Aucune conclusion n’est tirée d’une absence de réponse.'}
        </EmptyState>
      ) : tranchees.length === 0 ? (
        <EmptyState>Rien n’a encore été tranché.</EmptyState>
      ) : (
        <>
          {source === 'cache' && (
            <p className="small muted" style={{ margin: '0 0 8px' }}>
              Lecture depuis le cache de ce poste : la liste peut être en retard sur le serveur.
            </p>
          )}
          {tranchees.map((p) => (
            <div key={p.id} className="alert-item">
              <span className="gmk gmk-circle" aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <div className="alert-titre">
                  <Badge tone={p.statut === 'acceptee' ? 'ok' : 'muted'}>{LIBELLES_STATUT[p.statut]}</Badge>{' '}
                  {LIBELLES_GENRE[p.genre]} — {p.extrait.slice(0, 120)}
                  {p.extrait.length > 120 ? '…' : ''}
                </div>
                <div className="alert-detail">
                  {p.traitePar ? `par ${p.traitePar}` : 'signature inconnue'}
                  {p.traiteLe ? ` le ${fmtDate(p.traiteLe.slice(0, 10))}` : ''}
                  {p.objetCreeId ? ` · ${LIBELLES_OBJET_PROPOSE[p.objetCreeType || 'tache'].toLowerCase()} créé` : ''}
                </div>
              </div>
              <div className="alert-actions">
                <LienGmail source={p.message.gmailMessageId} bouton />
                <Btn small kind="ghost" disabled={!moi.nom} onClick={() => void rouvrir(p)} title="La remettre dans la file de revue">
                  Rouvrir
                </Btn>
              </div>
            </div>
          ))}
          {suite && (
            <p className="small" style={{ margin: '6px 2px' }}>
              <Btn small kind="ghost" onClick={chargerSuite} disabled={chargement}>
                {chargement ? 'Chargement…' : 'Charger la suite'}
              </Btn>
            </p>
          )}
        </>
      )}
    </Card>
  )
}

// ------------------------------------------------------------
// L'écran
// ------------------------------------------------------------

export default function Propositions() {
  const { state } = useStore()
  const moi = useMoi()
  const [onglet, setOnglet] = useState('revoir')
  const [index, setIndex] = useState(0)
  const { lignes, source, erreur, chargement, illisibles, suite, chargerSuite, recharger } =
    usePropositions(FILTRE_A_REVOIR)

  const personnes = useMemo(() => {
    const tous = [
      ...(state.settings.personnes || []),
      ...(state.settings.equipe || []).map((p) => p.nom),
    ].filter(Boolean)
    // la personne devant l'écran d'abord : c'est elle qui prend la tâche
    // neuf fois sur dix
    return [...new Set(moi.nom ? [moi.nom, ...tous] : tous)]
  }, [state.settings.personnes, state.settings.equipe, moi.nom])

  const file = lignes || []
  // la liste raccourcit à chaque décision : l'index pointe alors tout seul
  // sur la suivante, comme dans la revue documentaire
  const idx = Math.min(index, Math.max(0, file.length - 1))
  const courante = file[idx]

  // ← → : la revue au clavier, sans toucher aux champs de saisie
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const cible = ev.target as HTMLElement | null
      if (cible && (['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName) || cible.isContentEditable)) return
      if (ev.key === 'ArrowRight') setIndex(Math.min(idx + 1, file.length - 1))
      else if (ev.key === 'ArrowLeft') setIndex(Math.max(0, idx - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idx, file.length])

  return (
    <Page
      titre="Propositions"
      sousTitre="Ce que la machine a repéré dans les messages. Elle propose, vous décidez — rien ne s’accepte tout seul."
    >
      {!moi.nom && (
        <div className="pill-note" style={{ marginBottom: 12 }}>
          L’application ne sait pas qui vous êtes : aucune décision ne peut être signée. Choisissez « je suis… »
          dans les <a href="#/parametres">Paramètres</a>.
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'revoir', label: lignes ? `À revoir (${file.length})` : 'À revoir' },
          { id: 'tranchees', label: 'Tranchées' },
        ]}
        actif={onglet}
        onSelect={setOnglet}
      />

      {onglet === 'tranchees' ? (
        <CarteTranchees apres={recharger} />
      ) : (
        <Card
          titre={courante ? `Proposition ${idx + 1} / ${file.length}` : 'File de revue'}
          actions={
            file.length > 1 ? (
              <>
                <Btn small onClick={() => setIndex(Math.max(0, idx - 1))} disabled={idx === 0}>
                  ‹ Précédente
                </Btn>
                <Btn
                  small
                  onClick={() => setIndex(Math.min(idx + 1, file.length - 1))}
                  disabled={idx >= file.length - 1}
                >
                  Suivante ›
                </Btn>
              </>
            ) : undefined
          }
        >
          {erreur ? (
            <EmptyState>Les propositions sont illisibles : {erreur}</EmptyState>
          ) : lignes === null ? (
            <EmptyState>
              {chargement
                ? 'Lecture en cours…'
                : 'Ni le réseau ni le cache n’ont répondu : ce poste ne sait pas s’il y a des propositions. « Rien à revoir » serait un mensonge sur lequel on organise sa journée.'}
            </EmptyState>
          ) : !courante ? (
            <EmptyState>
              Rien à revoir. Les détections arrivent au fil de l’ingestion des messages — tâches, échéances,
              décisions et risques repérés dans le courrier.
            </EmptyState>
          ) : (
            <>
              {source === 'cache' && (
                <p className="small muted" style={{ margin: '0 0 8px' }}>
                  Lecture depuis le cache de ce poste : d’autres propositions peuvent attendre sur le serveur.
                </p>
              )}
              <CarteProposition
                key={courante.id}
                p={courante}
                personnes={personnes}
                moi={moi.nom}
                apres={recharger}
              />
              <p className="muted small" style={{ margin: '10px 0 0' }}>
                ← → pour passer d’une proposition à l’autre. Une décision à la fois ; chaque geste laisse un
                « Annuler ».
              </p>
              <details style={{ marginTop: 8 }}>
                <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
                  Les quatre gestes du §8.7
                </summary>
                <ul className="small muted" style={{ margin: '4px 0 0 18px' }}>
                  {GESTES_REVUE.map((g) => (
                    <li key={g}>
                      <strong>{g}</strong> — {AIDE_GESTE[g]}
                    </li>
                  ))}
                </ul>
              </details>
              {suite && (
                <p className="small" style={{ margin: '6px 2px' }}>
                  <Btn small kind="ghost" onClick={chargerSuite} disabled={chargement}>
                    {chargement ? 'Chargement…' : 'Charger la suite de la file'}
                  </Btn>{' '}
                  <span className="muted">la file s’affiche par pages — d’autres propositions attendent derrière</span>
                </p>
              )}
              {illisibles > 0 && (
                <p className="small" style={{ margin: '6px 2px' }}>
                  <span className="badge badge-warn">{illisibles} détection(s) illisibles</span> reçues du serveur
                  mais incomplètes (genre ou charge inconnus) : elles ne sont pas escamotées, elles ne sont pas
                  affichées — les trancher sur un contenu partiel serait pire.
                </p>
              )}
            </>
          )}
        </Card>
      )}
    </Page>
  )
}
