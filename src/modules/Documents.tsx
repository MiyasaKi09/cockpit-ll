// Page « Documents » — le registre documentaire central.
// Trois vues : la boîte d'arrivée (dépôt + _A_CLASSER du Drive, avec
// proposition de classement DÉTERMINISTE et « Voir pourquoi »), la file
// « à vérifier » (rien n'entre dans les données sans validation), et
// l'inventaire complet — cherchable, filtrable, traçable (événements).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentRecord, PhaseCode, Projet } from '../types'
import { useStore } from '../store'
import { useMoi } from '../moi'
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  Field,
  LienGmail,
  Modal,
  Page,
  AxesMessage,
  ResumeMessage,
  Select,
  Table,
  Tabs,
  TextInput,
  confirmer,
  ligneActivable,
  navigate,
  toast,
  useRoute,
} from '../ui'
import { fmtDate, fold, lienGmail, todayISO } from '../util'
import {
  CATEGORIES_DOC,
  DOSSIER_PAR_CATEGORIE,
  LIBELLES_STATUT,
  ajouterEvenement,
  chercherDoublon,
  classerFichier,
  creerDocument,
  documentParId,
  empreinteSha256,
  enregistrerDocument,
  validerDocument,
  type PropositionClassement,
} from '../registre'
import {
  ARBORESCENCE,
  DOSSIER_ENTRANTS,
  choisirRacine,
  lireRacine,
  listerFichiersRacine,
  nomConforme,
  phaseDuDossier,
  rangerFichier,
  supprimerFichierRacine,
  supporteFS,
  type FSDirHandle,
} from '../fsdrive'
import { LIBELLES_PHASES, PHASES_ORDRE } from '../miqcp'
// le triplet de statuts « en attente d'un geste humain » se déclare une
// seule fois, dans derive.ts : recopié, il diverge du compteur du menu
// et du bloc « validations attendues » de l'accueil
import { documentsATraiter } from '../derive'
import { syncActif } from '../sync'
import {
  listerEntrantsDistants,
  marquerEntrant,
  scannerMaintenant,
  telechargerEntrant,
  type EntrantDistant,
} from '../entrants'
import {
  corrigerAxes,
  corrigerRattachement,
  useCommunications,
  type Communication,
  type EtatCommunications,
} from '../communications'
import {
  LIBELLES_IMPORTANCE,
  LIBELLES_PHASE_ECHANGE,
  LIBELLES_TYPE_ECHANGE,
  NIVEAUX_IMPORTANCE,
  PHASES_ECHANGE,
  TYPES_ECHANGE,
  normaliserImportance,
  normaliserPhaseEchange,
  normaliserTypeEchange,
} from '../categorisation'
import {
  basculerRegle,
  courriersARattacher,
  enregistrerRegle,
  libelleProposition,
  libelleRegle,
  projetsCorrigibles,
  rattacher,
  regleProposee,
  reperesDe,
  reglesRattachement,
  supprimerRegle,
} from '../rattachement'

// ============================================================
// Phase du document (CDC §7.3) — AUCUN référentiel nouveau : ce
// sont les phases de la mission (miqcp.ts), et la correspondance
// avec le sous-dossier de rangement existe depuis l'origine dans
// ARBORESCENCE. On la lit pour PROPOSER, l'utilisateur tranche.
// ============================================================

const OPTIONS_PHASE = [
  { value: '', label: '— aucune —' },
  ...PHASES_ORDRE.map((c) => ({ value: c, label: `${c} — ${LIBELLES_PHASES[c]}` })),
]

function ChampPhase({
  value,
  onChange,
  hint = 'proposée d’après le sous-dossier',
}: {
  value: string
  onChange: (v: string) => void
  hint?: string
}) {
  return (
    <Field label="Phase" hint={hint}>
      <Select value={value} onChange={onChange} options={OPTIONS_PHASE} />
    </Field>
  )
}

/** la valeur du formulaire (chaîne) rangée telle que l'état l'attend */
const phaseChoisie = (v: string): PhaseCode | null => (v ? (v as PhaseCode) : null)

// ============================================================
// Libellés composés des deux Selects du classement (S4). Un code nu
// (« PC », « 03_APS-APD_PC ») ne dit rien à qui remplace l'agence une
// semaine — et il ne dit pas non plus la CONSÉQUENCE du choix. Aucun
// référentiel nouveau : la catégorie affiche le sous-dossier où elle
// range (`DOSSIER_PAR_CATEGORIE`), le sous-dossier affiche sa
// description (`ARBORESCENCE`). Déclarés une fois : les trois surfaces
// de classement montrent exactement les mêmes libellés.
// ============================================================

const OPTIONS_CATEGORIE = CATEGORIES_DOC.map((c) => ({
  value: c as string,
  label: `${c} → ${DOSSIER_PAR_CATEGORIE[c] || '00_ADMIN'}`,
}))

const OPTIONS_DOSSIER = ARBORESCENCE.map((a) => ({
  value: a.dossier,
  label: `${a.dossier} — ${a.description}`,
}))

// ============================================================
// Arrivées automatiques — les pièces captées côté serveur (Gmail)
// et proposées ici : l'index partagé « entrants » du Supabase de
// l'agence. Validation humaine obligatoire, comme pour le dépôt.
// ============================================================

/** ce que l'humain a retenu pour une pièce arrivée, plus les raisons que
 *  CE POSTE ajoute à celles du serveur (voir `charger`) */
interface ChoixEntrant {
  projetId: string
  categorie: string
  dossier: string
  phase: string
  /** raisons du rejeu local — vides quand le poste n'a rien à ajouter */
  raisons?: string[]
}

function CarteArriveesServeur() {
  const { state, update } = useStore()
  // qui signe le classement : la personne reconnue si l'application sait qui
  // est là, et seulement à défaut le premier de la liste — le raccourci
  // historique faisait signer toutes les validations par la même personne
  const moi = useMoi()
  const signataire = moi.nom ?? state.settings.personnes[0]
  const [liste, setListe] = useState<EntrantDistant[] | null>(null)
  const [choix, setChoix] = useState<Record<string, ChoixEntrant>>({})
  const [message, setMessage] = useState('')
  const [occupe, setOccupe] = useState('')
  const [racine, setRacine] = useState<FSDirHandle | null>(null)
  const projetsActifs = state.projets.filter((p) => !['Livré', 'Perdu'].includes(p.statut))
  // l'état est lu au moment du chargement, pas suivi : le mettre dans les
  // dépendances de `charger` relancerait une lecture du serveur à chaque
  // frappe au clavier ailleurs dans l'application
  const etatRef = useRef(state)
  etatRef.current = state

  const charger = useCallback(async () => {
    if (!syncActif()) {
      setListe(null)
      return
    }
    try {
      const l = await listerEntrantsDistants()
      setListe(l)
      setChoix((prev) => {
        const c = { ...prev }
        for (const e of l) {
          if (!c[e.id]) {
            // la cascade est REJOUÉE ici, comme le fait la file « à rattacher »
            // d'à côté : le poste peut en savoir plus que le serveur au moment
            // de l'ingestion (une règle mémorisée depuis, un contact ajouté, un
            // marché signé). Le serveur reste la proposition de tête ; le poste
            // complète ce qu'il n'avait pas vu, et le désaccord se dit.
            const locale = classerFichier(etatRef.current, e.nomFichier, {
              typeMime: e.typeMime || undefined,
              expediteur: e.expediteur,
              objet: e.objet,
            })
            const categorie = e.categorieProposee || locale.categorie
            const dossier = DOSSIER_PAR_CATEGORIE[categorie] || '00_ADMIN'
            const raisons: string[] = []
            if (!e.projetIdPropose && locale.projetId) raisons.push(...locale.raisons)
            else if (e.projetIdPropose && locale.projetId && locale.projetId !== e.projetIdPropose)
              raisons.push(
                `Ce poste, lui, désigne ${locale.projetId} — il connaît des éléments plus récents que l'ingestion : vérifiez avant de classer.`,
              )
            if (!e.categorieProposee && locale.categorie !== 'AUTRE')
              raisons.push(`Catégorie ${locale.categorie} proposée d'après le nom du fichier.`)
            c[e.id] = {
              projetId: e.projetIdPropose || locale.projetId || '',
              categorie,
              dossier,
              phase: phaseDuDossier(dossier) || '',
              raisons,
            }
          }
        }
        return c
      })
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    if (supporteFS) void lireRacine().then(setRacine)
    void charger()
    // la session du lien magique s'ouvre en asynchrone au démarrage :
    // on retente une fois, puis le bouton « Actualiser » prend le relais
    const t = setTimeout(() => void charger(), 2500)
    return () => clearTimeout(t)
  }, [charger])

  const majChoix = (id: string, champs: Partial<ChoixEntrant>) =>
    setChoix((prev) => {
      const courant = prev[id]
      const suivant = { ...courant, ...champs }
      if (champs.categorie) suivant.dossier = DOSSIER_PAR_CATEGORIE[champs.categorie] || courant.dossier
      // le sous-dossier porte la correspondance de phase : quand il change,
      // la proposition suit (et disparaît si le dossier est ambigu)
      if (champs.phase === undefined && suivant.dossier !== courant.dossier)
        suivant.phase = phaseDuDossier(suivant.dossier) || ''
      return { ...prev, [id]: suivant }
    })

  const classer = async (e: EntrantDistant) => {
    const c = choix[e.id]
    const projet = state.projets.find((p) => p.id === c?.projetId)
    if (!c || !projet) return
    setOccupe(e.id)
    setMessage('')
    try {
      const file = await telechargerEntrant(e)
      let chemin: string | undefined
      let nomFinal = e.nomFichier
      if (racine) {
        const r = await rangerFichier(racine, projet, c.dossier, file, nomConforme(projet, c.categorie, '', file.name))
        chemin = r.chemin
        nomFinal = r.nomFinal
      }
      const docPret = creerDocument({
        titre: nomFinal,
        nomOriginal: e.nomFichier,
        source: 'gmail',
        sourceId: e.id,
        // le chemin de retour vers l'échange d'origine (critère 10) : sans lui,
        // une pièce classée perd le contexte qui explique pourquoi elle existe
        sourceUrl: lienGmail(e.sourceMessageId) || undefined,
        categorie: c.categorie,
        typeMime: e.typeMime || undefined,
        taille: e.taille || undefined,
        empreinteSha256: e.empreinte || undefined,
        cheminDrive: chemin,
        projetId: projet.id,
        phase: phaseChoisie(c.phase),
        // qui classe la pièce ; vide si l'application ne sait pas qui est
        // là — mieux vaut pas d'auteur qu'un auteur pris au hasard
        auteur: moi.nom || undefined,
        confiance: e.confiance,
        // `raisons` porte la proposition du SERVEUR, intacte : c'est la
        // trace qui doit survivre à la validation. Ce que le poste a
        // ajouté part dans l'histoire du document, juste dessous.
        raisons: e.raisons,
        statut: 'classe',
      })
      update((d) => {
        const { doc } = enregistrerDocument(d, structuredClone(docPret))
        ajouterEvenementMail(doc, e, c.raisons)
      })
      await marquerEntrant(e.id, 'classe', signataire)
      setListe((prev) => (prev || []).filter((x) => x.id !== e.id))
      toast(
        chemin
          ? `Classé dans ${chemin} — ajouté au registre.`
          : `Ajouté au registre (${projet.id} · ${c.categorie}) — Drive non configuré, fichier non copié.`,
        { tone: 'ok' },
      )
    } catch (err) {
      setMessage(`Classement impossible : ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setOccupe('')
    }
  }

  const rejeter = async (e: EntrantDistant) => {
    if (!(await confirmer(`Rejeter « ${e.nomFichier} » ? La pièce reste tracée côté serveur mais ne sera plus proposée.`)))
      return
    try {
      await marquerEntrant(e.id, 'rejete', signataire)
      setListe((prev) => (prev || []).filter((x) => x.id !== e.id))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const scanner = async () => {
    setOccupe('scan')
    setMessage('')
    try {
      const r = await scannerMaintenant()
      if (r.statut === 'ok') {
        setMessage(
          r.nouvelles
            ? `${r.nouvelles} nouvelle(s) pièce(s) — ${r.messages} message(s) examiné(s).`
            : `Rien de nouveau (${r.messages ?? 0} message(s) examiné(s)).`,
        )
        await charger()
      } else if (r.statut === 'non-connecte') {
        setMessage('Gmail n’est pas connecté — Paramètres → Branchements → Ingestion serveur.')
      } else {
        setMessage(`Scan : ${r.statut}.`)
      }
    } catch (err) {
      setMessage(`Scan impossible : ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setOccupe('')
    }
  }

  return (
    <Card
      titre="Arrivées automatiques — pièces jointes Gmail"
      actions={
        liste !== null ? (
          <>
            <Btn small disabled={occupe === 'scan'} onClick={() => void scanner()}>
              {occupe === 'scan' ? 'Scan en cours…' : 'Scanner maintenant'}
            </Btn>
            <Btn small kind="ghost" onClick={() => void charger()}>Actualiser</Btn>
          </>
        ) : undefined
      }
    >
      {liste === null ? (
        <p className="small muted" style={{ margin: 0 }}>
          Le serveur de l'agence lit les pièces jointes Gmail toutes les 10 minutes et les propose ici,
          déjà classées avec leurs raisons. Pour l'activer : connectez l'espace partagé puis l'ingestion
          Gmail dans <a href="#/sante">Paramètres → Branchements</a>.
        </p>
      ) : liste.length === 0 ? (
        <EmptyState>Rien en attente côté serveur — le scan tourne toutes les 10 minutes.</EmptyState>
      ) : (
        liste.map((e) => {
          const c = choix[e.id] || { projetId: '', categorie: 'AUTRE', dossier: '00_ADMIN', phase: '' }
          const projet = state.projets.find((p) => p.id === c.projetId)
          return (
            <div key={e.id} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 10, marginBottom: 10 }}>
              <p className="small" style={{ margin: '0 0 2px' }}>
                <strong className="mono">{e.nomFichier}</strong>{' '}
                {e.confiance != null && <BadgeConfiance confiance={e.confiance} />}
              </p>
              <p className="small muted" style={{ margin: '0 0 6px' }}>
                {e.expediteur} · « {e.objet} » · {fmtDate(e.recuLe.slice(0, 10))} ·{' '}
                {/* le classement se décide sur le message, pas sur son nom de
                    fichier : sans ce lien il faut retrouver l'échange à la main
                    dans Gmail avant de choisir un projet */}
                <LienGmail source={e.sourceMessageId} />
              </p>
              {[...e.raisons, ...(c.raisons || [])].length > 0 && (
                <details className="small" style={{ marginBottom: 6 }}>
                  <summary>Voir pourquoi cette proposition</summary>
                  <ul style={{ margin: '4px 0 0 18px' }}>
                    {[...e.raisons, ...(c.raisons || [])].map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="form-row" style={{ alignItems: 'flex-end' }}>
                <Field label="Projet">
                  <Select
                    value={c.projetId}
                    onChange={(v) => majChoix(e.id, { projetId: v })}
                    options={[
                      { value: '', label: '— choisir un projet —' },
                      ...projetsActifs.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
                    ]}
                  />
                </Field>
                <Field label="Catégorie">
                  <Select
                    value={c.categorie}
                    onChange={(v) => majChoix(e.id, { categorie: v })}
                    options={OPTIONS_CATEGORIE}
                  />
                </Field>
                <Field label="Sous-dossier">
                  <Select
                    value={c.dossier}
                    onChange={(v) => majChoix(e.id, { dossier: v })}
                    options={OPTIONS_DOSSIER}
                  />
                </Field>
                <ChampPhase value={c.phase} onChange={(v) => majChoix(e.id, { phase: v })} />
              </div>
              <div className="toolbar" style={{ marginTop: 6, marginBottom: 0 }}>
                <Btn small kind="primary" disabled={!projet || occupe === e.id} onClick={() => void classer(e)}>
                  {occupe === e.id
                    ? 'Classement…'
                    : projet
                      ? `Classer dans ${projet.id} › ${c.dossier}`
                      : 'Classer (choisir un projet)'}
                </Btn>
                <Btn small kind="ghost" onClick={() => void rejeter(e)}>
                  Rejeter
                </Btn>
              </div>
            </div>
          )
        })
      )}
      {message && <p className="small" style={{ marginTop: 8 }}>{message}</p>}
    </Card>
  )
}

/** journalise la provenance mail sur le document (dans le producteur), et
 *  ce que le rejeu local de la cascade a ajouté à la proposition du serveur */
function ajouterEvenementMail(doc: DocumentRecord, e: EntrantDistant, raisonsPoste?: string[]): void {
  const lien = lienGmail(e.sourceMessageId)
  doc.evenements.push({
    date: todayISO(),
    type: 'source',
    detail:
      `Pièce jointe Gmail — de ${e.expediteur}, objet « ${e.objet} ».` +
      (lien ? '' : ' Message d’origine non identifié : pas de lien de retour.'),
  })
  if (raisonsPoste && raisonsPoste.length > 0)
    doc.evenements.push({
      date: todayISO(),
      type: 'classement',
      detail: `Ce poste a complété la proposition du serveur : ${raisonsPoste.join(' ')}`,
    })
}

// ============================================================
// Boîte d'arrivée — fichiers à classer (dépôt ou _A_CLASSER)
// ============================================================

/** un fichier en attente de classement, avec la proposition du moteur
 *  et les choix (modifiables) de l'utilisateur */
interface Entrant {
  cle: string
  file: File
  /** présent quand le fichier vient du dossier _A_CLASSER du Drive */
  depuisDrive?: boolean
  empreinte: string
  proposition: PropositionClassement
  // choix courants (pré-remplis par la proposition)
  projetId: string
  categorie: string
  dossier: string
  /** phase de la mission — proposée par le sous-dossier, '' = aucune */
  phase: string
}

function BadgeConfiance({ confiance }: { confiance: number }) {
  const pct = Math.round(confiance * 100)
  return (
    <Badge tone={confiance >= 0.6 ? 'ok' : confiance >= 0.3 ? 'warn' : 'muted'}>
      proposition {pct} %
    </Badge>
  )
}

function CarteEntrants() {
  const { state, update } = useStore()
  // qui dépose : renseigné seulement si l'application sait qui est là
  const moi = useMoi()
  const [racine, setRacine] = useState<FSDirHandle | null>(null)
  const [entrants, setEntrants] = useState<Entrant[]>([])
  const [message, setMessage] = useState('')
  const [scanEnCours, setScanEnCours] = useState(false)
  /** revue séquentielle au clavier : index dans `entrants` (null = fermée) */
  const [revue, setRevue] = useState<number | null>(null)
  const projetsActifs = state.projets.filter((p) => !['Livré', 'Perdu'].includes(p.statut))

  useEffect(() => {
    if (supporteFS) void lireRacine().then(setRacine)
  }, [])

  const preparer = useCallback(
    async (file: File, depuisDrive?: boolean): Promise<Entrant> => {
      const proposition = classerFichier(state, file.name, { typeMime: file.type || undefined })
      const categorie = proposition.categorie
      const dossier = DOSSIER_PAR_CATEGORIE[categorie] || '00_ADMIN'
      return {
        cle: `${depuisDrive ? 'drive' : 'depot'}:${file.name}:${file.size}`,
        file,
        depuisDrive,
        empreinte: await empreinteSha256(file),
        proposition,
        projetId: proposition.projetId || '',
        categorie,
        dossier,
        phase: phaseDuDossier(dossier) || '',
      }
    },
    [state],
  )

  const ajouterFichiers = async (fichiers: FileList | null) => {
    if (!fichiers?.length) return
    const prepares = await Promise.all([...fichiers].map((f) => preparer(f)))
    setEntrants((prev) => [...prev, ...prepares.filter((e) => !prev.some((x) => x.cle === e.cle))])
  }

  const scannerDrive = async () => {
    if (!racine) return
    setScanEnCours(true)
    setMessage('')
    try {
      const fichiers = await listerFichiersRacine(racine, DOSSIER_ENTRANTS)
      if (fichiers.length === 0) {
        setMessage(`Rien à classer : le dossier ${DOSSIER_ENTRANTS} du Drive est vide (ou absent).`)
      }
      const prepares = await Promise.all(
        fichiers.map(async (fh) => preparer(await fh.getFile(), true)),
      )
      setEntrants((prev) => [...prev, ...prepares.filter((e) => !prev.some((x) => x.cle === e.cle))])
    } catch (e) {
      setMessage(`Lecture du Drive impossible : ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setScanEnCours(false)
    }
  }

  const majEntrant = (cle: string, champs: Partial<Entrant>) =>
    setEntrants((prev) =>
      prev.map((e) => {
        if (e.cle !== cle) return e
        const suivant = { ...e, ...champs }
        // même règle qu'aux arrivées serveur : le sous-dossier propose la
        // phase, un choix explicite de phase prime toujours
        if (champs.phase === undefined && suivant.dossier !== e.dossier)
          suivant.phase = phaseDuDossier(suivant.dossier) || ''
        return suivant
      }),
    )

  const classer = async (e: Entrant) => {
    const projet = state.projets.find((p) => p.id === e.projetId)
    if (!projet) return
    try {
      // 1. rangement sûr dans le Drive (si configuré) — jamais d'écrasement
      let chemin: string | undefined
      let nomFinal = e.file.name
      let empreinte = e.empreinte
      if (racine) {
        const r = await rangerFichier(racine, projet, e.dossier, e.file, nomConforme(projet, e.categorie, '', e.file.name))
        chemin = r.chemin
        nomFinal = r.nomFinal
        empreinte = r.empreinte || empreinte
        if (e.depuisDrive) await supprimerFichierRacine(racine, DOSSIER_ENTRANTS, e.file.name)
      }
      // 2. entrée du registre (dédoublonnée par empreinte)
      const dejaConnu = Boolean(chercherDoublon(state, empreinte))
      const docPret = creerDocument({
        titre: nomFinal,
        nomOriginal: e.file.name,
        source: e.depuisDrive ? 'drive' : 'depot',
        categorie: e.categorie,
        typeMime: e.file.type || undefined,
        taille: e.file.size,
        empreinteSha256: empreinte || undefined,
        cheminDrive: chemin,
        projetId: e.projetId,
        phase: phaseChoisie(e.phase),
        auteur: moi.nom || undefined,
        confiance: e.proposition.confiance,
        raisons: e.proposition.raisons,
        statut: 'classe',
      })
      update((d) => {
        enregistrerDocument(d, structuredClone(docPret))
      })
      setEntrants((prev) => prev.filter((x) => x.cle !== e.cle))
      toast(
        chemin
          ? `Classé dans ${chemin}${dejaConnu ? ' — contenu déjà connu du registre, pas de doublon.' : '.'}`
          : `Ajouté au registre (${projet.id} · ${e.categorie}) — Drive non configuré, fichier non copié.`,
        { tone: 'ok' },
      )
    } catch (err) {
      setMessage(`Classement impossible : ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const ecarter = (e: Entrant) => setEntrants((prev) => prev.filter((x) => x.cle !== e.cle))

  return (
    <Card
      titre="Boîte d'arrivée — proposer, vérifier, classer"
      actions={
        supporteFS ? (
          racine ? (
            <Btn small disabled={scanEnCours} onClick={() => void scannerDrive()}>
              {scanEnCours ? 'Scan en cours…' : `Scanner ${DOSSIER_ENTRANTS} (Drive)`}
            </Btn>
          ) : (
            <Btn small onClick={() => void choisirRacine().then(setRacine)}>Choisir le dossier Drive</Btn>
          )
        ) : undefined
      }
    >
      <p className="small muted" style={{ marginTop: 0, marginBottom: 10 }}>
        Déposez des fichiers (ou jetez-les dans le dossier <code>{DOSSIER_ENTRANTS}</code> à la racine
        du Drive) : le site propose un classement — projet, catégorie, sous-dossier — en expliquant
        pourquoi. Rien n'est rangé sans votre validation, et rien n'écrase jamais un fichier existant.
      </p>
      <Field label="Déposer des fichiers à classer">
        <input
          className="input"
          type="file"
          multiple
          onChange={(e) => {
            void ajouterFichiers(e.target.files)
            e.target.value = ''
          }}
        />
      </Field>
      {message && <p className="small warn-text">{message}</p>}
      {entrants.length > 1 && (
        <p className="small" style={{ margin: '0 0 10px' }}>
          <Btn small kind="primary" onClick={() => setRevue(0)}>
            Passer en revue — un fichier à la fois
          </Btn>{' '}
          <span className="muted">Entrée = classer · → suivant · ← précédent · E = écarter</span>
        </p>
      )}
      {entrants.length === 0 ? (
        <EmptyState>Aucun fichier en attente — déposez-en ci-dessus ou scannez le Drive.</EmptyState>
      ) : (
        entrants.map((e) => {
          const projet = state.projets.find((p) => p.id === e.projetId)
          return (
            <div
              key={e.cle}
              style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 10, marginBottom: 10 }}
            >
              <p className="small" style={{ margin: '0 0 6px' }}>
                <strong className="mono">{e.file.name}</strong>{' '}
                {e.depuisDrive && <Badge tone="info">depuis {DOSSIER_ENTRANTS}</Badge>}{' '}
                <BadgeConfiance confiance={e.proposition.confiance} />
              </p>
              <details className="small" style={{ marginBottom: 6 }}>
                <summary>Voir pourquoi cette proposition</summary>
                <ul style={{ margin: '4px 0 0 18px' }}>
                  {e.proposition.raisons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </details>
              <div className="form-row" style={{ alignItems: 'flex-end' }}>
                <Field label="Projet">
                  <Select
                    value={e.projetId}
                    onChange={(v) => majEntrant(e.cle, { projetId: v })}
                    options={[
                      { value: '', label: '— choisir un projet —' },
                      ...projetsActifs.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
                    ]}
                  />
                </Field>
                <Field label="Catégorie">
                  <Select
                    value={e.categorie}
                    onChange={(v) =>
                      majEntrant(e.cle, { categorie: v, dossier: DOSSIER_PAR_CATEGORIE[v] || e.dossier })
                    }
                    options={OPTIONS_CATEGORIE}
                  />
                </Field>
                <Field label="Sous-dossier">
                  <Select
                    value={e.dossier}
                    onChange={(v) => majEntrant(e.cle, { dossier: v })}
                    options={OPTIONS_DOSSIER}
                  />
                </Field>
                <ChampPhase value={e.phase} onChange={(v) => majEntrant(e.cle, { phase: v })} />
              </div>
              <div className="toolbar" style={{ marginTop: 6, marginBottom: 0 }}>
                <Btn small kind="primary" disabled={!e.projetId} onClick={() => void classer(e)}>
                  {projet ? `Classer dans ${projet.id} › ${e.dossier}` : 'Classer (choisir un projet)'}
                </Btn>
                <Btn small kind="ghost" onClick={() => ecarter(e)}>
                  Écarter (ne pas classer)
                </Btn>
              </div>
            </div>
          )
        })
      )}

      {revue !== null && (
        <ModalRevueEntrants
          entrants={entrants}
          index={revue}
          setIndex={setRevue}
          projetsActifs={projetsActifs}
          majEntrant={majEntrant}
          classer={classer}
          ecarter={ecarter}
          occupe={false}
        />
      )}
    </Card>
  )
}

/** revue séquentielle au clavier : un fichier à la fois — Entrée classe
 *  avec la proposition affichée, E écarte, ← → naviguent. Quand un fichier
 *  est traité, la liste se raccourcit : l'index pointe sur le suivant. */
function ModalRevueEntrants({
  entrants,
  index,
  setIndex,
  projetsActifs,
  majEntrant,
  classer,
  ecarter,
}: {
  entrants: Entrant[]
  index: number
  setIndex: (i: number | null) => void
  projetsActifs: Projet[]
  majEntrant: (cle: string, champs: Partial<Entrant>) => void
  classer: (e: Entrant) => Promise<void>
  ecarter: (e: Entrant) => void
  occupe: boolean
}) {
  const { state } = useStore()
  const idx = Math.min(index, entrants.length - 1)
  const e = entrants[idx]
  const projet = state.projets.find((p) => p.id === e?.projetId)

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const cible = ev.target as HTMLElement | null
      const dansChamp = cible && ['INPUT', 'TEXTAREA'].includes(cible.tagName)
      if (!e || dansChamp) return
      if (ev.key === 'Enter' && cible?.tagName !== 'SELECT' && projet) {
        ev.preventDefault()
        void classer(e)
      } else if (ev.key === 'ArrowRight') {
        setIndex(Math.min(idx + 1, entrants.length - 1))
      } else if (ev.key === 'ArrowLeft') {
        setIndex(Math.max(0, idx - 1))
      } else if (ev.key === 'e' || ev.key === 'E') {
        ecarter(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [e, projet, idx, entrants.length, classer, ecarter, setIndex])

  if (!e) {
    return (
      <Modal titre="Revue terminée" onClose={() => setIndex(null)}>
        <p>Tous les fichiers en attente ont été traités.</p>
        <div className="form-foot">
          <Btn kind="primary" onClick={() => setIndex(null)}>Fermer</Btn>
        </div>
      </Modal>
    )
  }

  return (
    <Modal titre={`Revue — fichier ${idx + 1} / ${entrants.length}`} onClose={() => setIndex(null)}>
      <p className="small" style={{ margin: '0 0 2px' }}>
        <strong className="mono">{e.file.name}</strong> <BadgeConfiance confiance={e.proposition.confiance} />
      </p>
      {e.proposition.raisons.length > 0 && (
        <ul className="small muted" style={{ margin: '4px 0 8px 18px' }}>
          {e.proposition.raisons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <div className="form-row" style={{ alignItems: 'flex-end' }}>
        <Field label="Projet">
          <Select
            value={e.projetId}
            onChange={(v) => majEntrant(e.cle, { projetId: v })}
            options={[
              { value: '', label: '— choisir un projet —' },
              ...projetsActifs.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
            ]}
          />
        </Field>
        <Field label="Catégorie">
          <Select
            value={e.categorie}
            // même geste qu'en liste : la catégorie entraîne le sous-dossier,
            // sinon la revue au clavier range dans le dossier du fichier
            // précédent sans le dire
            onChange={(v) =>
              majEntrant(e.cle, { categorie: v, dossier: DOSSIER_PAR_CATEGORIE[v] || e.dossier })
            }
            options={OPTIONS_CATEGORIE}
          />
        </Field>
        <Field label="Sous-dossier">
          <Select
            value={e.dossier}
            onChange={(v) => majEntrant(e.cle, { dossier: v })}
            options={OPTIONS_DOSSIER}
          />
        </Field>
        <ChampPhase value={e.phase} onChange={(v) => majEntrant(e.cle, { phase: v })} />
      </div>
      {projet && (
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Conséquence : copié dans <code>{projet.id} › {e.dossier}</code> sous{' '}
          <code>{nomConforme(projet, e.categorie, '', e.file.name)}</code> + entrée au registre. Rien
          n'est écrasé (versions _v02 si besoin).
        </p>
      )}
      <div className="form-foot" style={{ flexWrap: 'wrap' }}>
        <Btn onClick={() => setIndex(Math.max(0, idx - 1))} disabled={idx === 0}>‹</Btn>
        <Btn onClick={() => setIndex(Math.min(idx + 1, entrants.length - 1))} disabled={idx >= entrants.length - 1}>›</Btn>
        <span className="spacer" />
        <Btn kind="ghost" onClick={() => ecarter(e)}>Écarter (E)</Btn>
        <Btn kind="primary" disabled={!projet} onClick={() => void classer(e)}>
          {projet ? `Classer dans ${projet.id} › ${e.dossier} (Entrée)` : 'Classer (choisir un projet)'}
        </Btn>
      </div>
    </Modal>
  )
}

// ============================================================
// À vérifier — les entrées du registre en attente de validation
// ============================================================

function CarteAVerifier() {
  const { state, update } = useStore()
  // même règle qu'à la boîte d'arrivée : on ne signe pas au nom d'un autre
  const moi = useMoi()
  const signataire = moi.nom ?? state.settings.personnes[0]
  const aVerifier = documentsATraiter(state)

  const valider = (doc: DocumentRecord) =>
    update((d) => {
      const x = d.registreDocuments.find((y) => y.id === doc.id)
      if (x) validerDocument(x, signataire)
    })

  const rejeter = async (doc: DocumentRecord) => {
    if (!(await confirmer(`Rejeter « ${doc.titre} » ? Le document reste tracé mais ne sera plus proposé.`)))
      return
    update((d) => {
      const x = d.registreDocuments.find((y) => y.id === doc.id)
      if (x) x.statut = 'rejete'
    })
  }

  if (aVerifier.length === 0) {
    return (
      <Card titre="À vérifier">
        <EmptyState>
          Rien à vérifier — les documents importés à la main sont validés par le geste d'import.
          Cette file se remplira quand les arrivées automatiques (Gmail, Drive) seront branchées.
        </EmptyState>
      </Card>
    )
  }
  return (
    <Card titre={`À vérifier — ${aVerifier.length} document(s)`}>
      <Table compact head={['Document', 'Proposition', 'Confiance', 'Reçu le', '']}>
        {aVerifier.map((doc) => {
          const projet = state.projets.find((p) => p.id === doc.projetId)
          return (
            <tr key={doc.id}>
              <td>
                <strong>{doc.titre}</strong>
                {doc.raisons && doc.raisons.length > 0 && (
                  <details className="small muted">
                    <summary>Voir pourquoi</summary>
                    <ul style={{ margin: '4px 0 0 18px' }}>
                      {doc.raisons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </td>
              <td className="small">
                {doc.categorie}
                {projet ? ` · ${projet.id} — ${projet.nom}` : ' · aucun projet'}
              </td>
              <td>{doc.confiance != null ? <BadgeConfiance confiance={doc.confiance} /> : <Badge tone="muted">manuel</Badge>}</td>
              <td className="small muted">{fmtDate(doc.recuLe)}</td>
              <td className="right">
                <Btn small kind="primary" onClick={() => valider(doc)}>
                  Valider le classement
                </Btn>{' '}
                <Btn small kind="ghost" onClick={() => void rejeter(doc)}>
                  Rejeter
                </Btn>
              </td>
            </tr>
          )
        })}
      </Table>
    </Card>
  )
}

// ============================================================
// Tous les documents — inventaire cherchable + fiche détaillée
// ============================================================

function ModalDocument({ doc: docInitial, onClose }: { doc: DocumentRecord; onClose: () => void }) {
  const { state, update } = useStore()
  // relu dans l'état : la fiche doit montrer la correction faite ici même
  const doc = state.registreDocuments.find((d) => d.id === docInitial.id) || docInitial
  const projet = state.projets.find((p) => p.id === doc.projetId)
  const entreprise = state.entreprises.find((e) => e.id === doc.entrepriseId)
  const remplace = documentParId(state, doc.remplaceDocumentId)
  const remplacePar = state.registreDocuments.find((d) => d.remplaceDocumentId === doc.id)
  const lignes: { label: string; valeur: string }[] = [
    { label: 'Nom d’origine', valeur: doc.nomOriginal },
    { label: 'Catégorie', valeur: doc.categorie },
    { label: 'Phase', valeur: doc.phase ? `${doc.phase} — ${LIBELLES_PHASES[doc.phase]}` : '—' },
    { label: 'Statut', valeur: LIBELLES_STATUT[doc.statut] },
    { label: 'Version', valeur: `v${doc.version}` },
    { label: 'Source', valeur: doc.source },
    { label: 'Projet', valeur: projet ? `${projet.id} — ${projet.nom}` : '—' },
    { label: 'Entreprise', valeur: entreprise?.raisonSociale || '—' },
    { label: 'Déposé par', valeur: doc.auteur || '—' },
    { label: 'Reçu le', valeur: fmtDate(doc.recuLe) },
    { label: 'Chemin Drive', valeur: doc.cheminDrive || '— (non copié dans le Drive)' },
    ...(doc.driveFileId ? [{ label: 'Fichier Drive', valeur: doc.driveFileId }] : []),
    { label: 'Empreinte SHA-256', valeur: doc.empreinteSha256 ? `${doc.empreinteSha256.slice(0, 16)}…` : '—' },
  ]

  /** corriger la phase après coup — le classement d'un document se relit
   *  parfois des mois plus tard, et l'événement en garde la trace */
  const changerPhase = (v: string) =>
    update((d) => {
      const x = d.registreDocuments.find((y) => y.id === doc.id)
      if (!x) return
      const phase = phaseChoisie(v)
      if (x.phase === phase) return
      x.phase = phase
      ajouterEvenement(x, 'phase', phase ? `Rattaché à la phase ${phase}.` : 'Phase retirée.')
    })

  return (
    <Modal titre={doc.titre} onClose={onClose}>
      <Table compact head={['', '']}>
        {lignes.map((l) => (
          <tr key={l.label}>
            <td className="muted small" style={{ width: 150 }}>{l.label}</td>
            <td className="small mono">{l.valeur}</td>
          </tr>
        ))}
      </Table>
      <div className="form-row" style={{ marginTop: 8 }}>
        <ChampPhase
          value={doc.phase || ''}
          onChange={changerPhase}
          hint="corrige le rattachement — la modification est journalisée ci-dessous"
        />
      </div>
      {/* la mention est portée par la SOURCE du document, pas par la présence
          de l'URL : une pièce venue de Gmail dont le lien manque doit le dire,
          un fichier déposé à la main n'a rien à dire du tout */}
      {doc.source === 'gmail' && (
        <p className="small" style={{ margin: '8px 0' }}>
          <LienGmail source={doc.sourceUrl} />{' '}
          <span className="muted">— l’e-mail qui a apporté cette pièce reste la source de vérité.</span>
        </p>
      )}
      {(remplace || remplacePar) && (
        <p className="small" style={{ margin: '8px 0' }}>
          {remplace && <>Remplace : <strong>{remplace.titre}</strong> (v{remplace.version}). </>}
          {remplacePar && <>Remplacé par : <strong>{remplacePar.titre}</strong> (v{remplacePar.version}).</>}
        </p>
      )}
      {doc.raisons && doc.raisons.length > 0 && (
        <>
          <h4 style={{ margin: '10px 0 4px' }}>Pourquoi ce classement</h4>
          <ul className="small" style={{ margin: '0 0 0 18px' }}>
            {doc.raisons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
      <h4 style={{ margin: '10px 0 4px' }}>Histoire du document</h4>
      {doc.evenements.length === 0 ? (
        <p className="small muted">Aucun événement enregistré.</p>
      ) : (
        <ul className="small" style={{ margin: '0 0 0 18px' }}>
          {doc.evenements.map((ev, i) => (
            <li key={i}>
              {fmtDate(ev.date)} — <strong>{ev.type}</strong>
              {ev.detail ? ` : ${ev.detail}` : ''}
              {ev.auteur ? ` (${ev.auteur})` : ''}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

function CarteTous({ docId }: { docId?: string }) {
  const { state } = useStore()
  const [recherche, setRecherche] = useState('')
  const [filtreProjet, setFiltreProjet] = useState('')
  const [filtreCategorie, setFiltreCategorie] = useState('')
  const [filtrePhase, setFiltrePhase] = useState('')
  const [ouvert, setOuvert] = useState<DocumentRecord | null>(null)
  // atterrissage sur L'ÉLÉMENT : `#/documents/tous/<id>` ouvre la fiche
  // (palette « / », liens d'alerte). Le registre reste dessous, filtres
  // intacts : fermer la fiche rend la liste, pas une page blanche.
  const cible = docId ? documentParId(state, docId) : undefined
  const fiche = ouvert ?? cible ?? null
  const fermerFiche = () => {
    setOuvert(null)
    // l'adresse profonde se retire, sinon la fiche se rouvrirait aussitôt
    if (docId) navigate('/documents/tous')
  }

  const docs = useMemo(() => {
    const cle = fold(recherche)
    return state.registreDocuments
      .filter((d) => !filtreProjet || d.projetId === filtreProjet)
      .filter((d) => !filtreCategorie || d.categorie === filtreCategorie)
      .filter((d) => !filtrePhase || d.phase === filtrePhase)
      .filter((d) => !cle || fold(`${d.titre} ${d.nomOriginal} ${d.cheminDrive || ''}`).includes(cle))
      .slice()
      .sort((a, b) => b.recuLe.localeCompare(a.recuLe) || b.id.localeCompare(a.id))
  }, [state.registreDocuments, recherche, filtreProjet, filtreCategorie, filtrePhase])

  const projetDe = (d: DocumentRecord): Projet | undefined =>
    state.projets.find((p) => p.id === d.projetId)

  return (
    <Card titre={`Tous les documents — ${state.registreDocuments.length} au registre`}>
      {docId && !cible && (
        <div className="pill-note" style={{ marginBottom: 10, borderColor: 'var(--warn)' }}>
          Le document demandé par ce lien n'est plus au registre (supprimé, ou registre d'un autre
          poste). Le voici cherchable ci-dessous.
        </div>
      )}
      <div className="form-row">
        <Field label="Rechercher">
          <TextInput value={recherche} onChange={setRecherche} placeholder="nom, chemin…" />
        </Field>
        <Field label="Projet">
          <Select
            value={filtreProjet}
            onChange={setFiltreProjet}
            options={[
              { value: '', label: 'Tous' },
              ...state.projets.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
            ]}
          />
        </Field>
        <Field label="Catégorie">
          <Select
            value={filtreCategorie}
            onChange={setFiltreCategorie}
            options={[{ value: '', label: 'Toutes' }, ...CATEGORIES_DOC.map((c) => ({ value: c, label: c }))]}
          />
        </Field>
        <Field label="Phase">
          <Select
            value={filtrePhase}
            onChange={setFiltrePhase}
            options={[
              { value: '', label: 'Toutes' },
              ...PHASES_ORDRE.map((c) => ({ value: c, label: `${c} — ${LIBELLES_PHASES[c]}` })),
            ]}
          />
        </Field>
      </div>
      {docs.length === 0 ? (
        <EmptyState>
          {state.registreDocuments.length === 0
            ? 'Le registre est vide — il se remplit à chaque import : CCTP et DPGF analysés, CR générés, photos du journal, dépôts de la boîte d’arrivée.'
            : 'Aucun document ne correspond à ces filtres.'}
        </EmptyState>
      ) : (
        <Table compact head={['Document', 'Catégorie', 'Projet', 'Statut', 'Version', 'Reçu le']}>
          {docs.map((d) => {
            const projet = projetDe(d)
            return (
              <tr key={d.id} className="clickable" {...ligneActivable(() => setOuvert(d))}>
                <td>
                  <a
                    href="#/documents"
                    onClick={(ev) => {
                      ev.preventDefault()
                      setOuvert(d)
                    }}
                  >
                    {d.titre}
                  </a>
                  {d.cheminDrive && <div className="small muted mono">{d.cheminDrive}</div>}
                  {d.source === 'gmail' && (
                    <div className="small">
                      {/* `muet` : dans un tableau de tout le registre, dire
                          l'absence d'un lien ligne après ligne serait du bruit
                          — la fiche, elle, le dit */}
                      <LienGmail source={d.sourceUrl} muet />
                    </div>
                  )}
                </td>
                <td>
                  {d.categorie}
                  {d.phase && <div className="small muted">{d.phase}</div>}
                </td>
                <td className="small">{projet ? `${projet.id} — ${projet.nom}` : '—'}</td>
                <td>
                  <Badge
                    tone={
                      d.statut === 'rejete'
                        ? 'danger'
                        : d.statut === 'remplace'
                          ? 'muted'
                          : ['valide', 'exploite', 'classe'].includes(d.statut)
                            ? 'ok'
                            : 'warn'
                    }
                  >
                    {LIBELLES_STATUT[d.statut]}
                  </Badge>
                </td>
                <td className="right">v{d.version}</td>
                <td className="small muted">{fmtDate(d.recuLe)}</td>
              </tr>
            )
          })}
        </Table>
      )}
      {fiche && <ModalDocument doc={fiche} onClose={fermerFiche} />}
    </Card>
  )
}

// ============================================================
// À RATTACHER — la file du §5.1, livrable A.4.
//
// Pourquoi cette file existe : la cascade de rattachement REFUSE de
// deviner. Deux projets à égalité, ou aucun signal, et elle rend `null`
// plutôt que le premier de la liste. Ce refus n'a de valeur que s'il
// débouche quelque part — sinon il produit exactement ce qu'il évite,
// du courrier rangé nulle part que personne ne voit.
//
// Pourquoi ici : cet onglet est le seul écran du dépôt dont l'objet est
// « ce qui est arrivé et qu'on n'a pas su ranger ». La boîte d'arrivée
// le fait pour les fichiers avec le même geste — proposition, raisons
// dépliables, Select, validation humaine. Le §3.12 réserve la file
// quotidienne du Cockpit à A.7 : la doubler ici ferait traiter le même
// message à deux endroits, ce que ce même paragraphe interdit.
//
// DEUX MÉMOIRES, ET C'EST VOULU jusqu'à B.15 : `communications` (le
// serveur) et `state.courriers` (l'onglet ouvert, `surveillance.ts`).
// N'en montrer qu'une viderait la file de la moitié de son contenu sans
// que rien ne le signale.
// ============================================================

/** un rattachement corrigé à la main mémorise une règle — case cochée par
 *  défaut, parce que c'est tout l'intérêt, et TOUJOURS visible, parce
 *  qu'une règle implicite ne se retrouve plus le jour où elle se trompe */
function ChoixRattachement({
  adresse,
  valeur,
  onValeur,
  memoriser,
  onMemoriser,
  projets,
}: {
  adresse: string
  valeur: string
  onValeur: (v: string) => void
  memoriser: boolean
  onMemoriser: (v: boolean) => void
  projets: Projet[]
}) {
  return (
    <div className="form-row" style={{ alignItems: 'flex-end' }}>
      <Field label="Projet">
        <Select
          value={valeur}
          onChange={onValeur}
          options={[
            { value: '', label: '— choisir un projet —' },
            ...projets.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
          ]}
        />
      </Field>
      {adresse && (
        <Field label="Mémoriser" hint="les prochains messages de cette adresse seront proposés au même projet">
          <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={memoriser} onChange={(e) => onMemoriser(e.target.checked)} />
            <span className="mono">{adresse}</span> → projet
          </label>
        </Field>
      )}
    </div>
  )
}

/**
 * Corriger à la main les trois axes du §5.2 d'un message (livrable A.8).
 *
 * Le classifieur PROPOSE ; c'est ici que l'humain tranche, et le §5.1 comme le
 * critère 11 l'exigent — « acceptées, MODIFIÉES ou refusées ». Trois `Select`
 * pré-remplis par la valeur effective, et l'option vide qui rend le refus
 * possible : vider un axe est une réponse, pas une absence de réponse.
 *
 * Les trois axes partent ENSEMBLE, par `corrigerAxes`, parce que
 * `categorise_par` les commande tous les trois à la fois : signer en n'écrivant
 * qu'une colonne viderait les deux autres, sans erreur ni trace. C'est écrit
 * dans l'en-tête de `src/communications.ts`, et cela ne se devine pas.
 */
function ChoixAxes({ message, onCorrige }: { message: Communication; onCorrige: () => void }) {
  const moi = useMoi()
  const [phase, setPhase] = useState(message.phase || '')
  const [type, setType] = useState(message.typeEchange || '')
  const [importance, setImportance] = useState(message.importance || '')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState('')

  const enregistrer = async () => {
    setOccupe(true)
    setErreur('')
    try {
      await corrigerAxes(
        message,
        {
          phase: normaliserPhaseEchange(phase),
          typeEchange: normaliserTypeEchange(type),
          importance: normaliserImportance(importance),
        },
        moi.nom || '',
      )
      toast('Classement enregistré.', { tone: 'ok' })
      onCorrige()
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setOccupe(false)
    }
  }

  return (
    <details className="small" style={{ marginBottom: 6 }}>
      <summary>Corriger le classement</summary>
      <div className="grid3" style={{ marginTop: 6 }}>
        <Field label="Phase de l'échange">
          <Select
            value={phase}
            onChange={setPhase}
            options={[
              { value: '', label: '— à choisir —' },
              ...PHASES_ECHANGE.map((p) => ({ value: p, label: LIBELLES_PHASE_ECHANGE[p] })),
            ]}
          />
        </Field>
        <Field label="Type d'échange">
          <Select
            value={type}
            onChange={setType}
            options={[
              { value: '', label: '— à choisir —' },
              ...TYPES_ECHANGE.map((t) => ({ value: t, label: LIBELLES_TYPE_ECHANGE[t] })),
            ]}
          />
        </Field>
        <Field label="Importance">
          <Select
            value={importance}
            onChange={setImportance}
            options={[
              { value: '', label: '— à choisir —' },
              ...NIVEAUX_IMPORTANCE.map((n) => ({ value: n, label: LIBELLES_IMPORTANCE[n] })),
            ]}
          />
        </Field>
      </div>
      <p className="small muted" style={{ margin: '0 0 6px' }}>
        Le classement porte sur ce message, pas sur tout le fil : l'importance d'une réponse n'est
        pas celle de la question. Enregistrer signe les trois axes à la fois.
      </p>
      <Btn small disabled={occupe} onClick={() => void enregistrer()}>
        {occupe ? 'Enregistrement…' : 'Enregistrer le classement'}
      </Btn>
      {erreur && <p className="small danger-text" style={{ marginBottom: 0 }}>{erreur}</p>}
    </details>
  )
}

/** La lecture est faite UNE FOIS, par la page : le compteur de l'onglet et
 *  la file lisent la même chose. Deux `useCommunications` côte à côte, c'est
 *  deux requêtes et deux vérités possibles à l'écran. */
function CarteMessagesARattacher({ etat }: { etat: EtatCommunications }) {
  const { state, update } = useStore()
  const moi = useMoi()
  const { lignes, source, erreur, suite, chargerSuite, recharger } = etat
  const [choix, setChoix] = useState<Record<string, { projetId: string; memoriser: boolean }>>({})
  const [occupe, setOccupe] = useState('')
  const [message, setMessage] = useState('')
  const projets = projetsCorrigibles(state)
  // les repères se construisent une fois par rendu, pas une fois par ligne :
  // la cascade est rejouée ICI parce que le poste peut en savoir plus que le
  // serveur au moment de l'ingestion — une règle mémorisée depuis, un contact
  // ajouté, un marché signé
  const reperes = useMemo(() => reperesDe(state), [state])

  // Les messages sont groupés PAR FIL : le §3.7 fait du fil le signal le plus
  // fort, et corriger un message d'un fil sans corriger ses frères laisserait
  // la moitié d'une conversation dans la file.
  const fils = useMemo(() => {
    const parFil = new Map<string, Communication[]>()
    for (const c of lignes || []) {
      const groupe = parFil.get(c.gmailThreadId)
      if (groupe) groupe.push(c)
      else parFil.set(c.gmailThreadId, [c])
    }
    return [...parFil.values()]
  }, [lignes])

  const appliquer = async (groupe: Communication[]) => {
    const tete = groupe[0]
    const c = choix[tete.id]
    if (!c?.projetId) return
    setOccupe(tete.id)
    setMessage('')
    try {
      for (const msg of groupe) await corrigerRattachement(msg, c.projetId, moi.nom || '')
      if (c.memoriser) {
        const regle = regleProposee(state, tete.expediteurAdresse, c.projetId, moi.nom || undefined)
        if (regle) update((d) => enregistrerRegle(d, regle))
      }
      toast(
        groupe.length > 1
          ? `${groupe.length} messages du fil rattachés à ${c.projetId}.`
          : `Message rattaché à ${c.projetId}.`,
        { tone: 'ok' },
      )
      recharger()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setOccupe('')
    }
  }

  return (
    <Card
      titre="Messages sans projet"
      actions={<Btn small kind="ghost" onClick={recharger}>Actualiser</Btn>}
    >
      {erreur && <p className="small danger-text" style={{ marginTop: 0 }}>{erreur}</p>}
      {lignes === null ? (
        // `null` n'est pas `[]` : « on ne sait pas » ne s'affiche pas
        // « aucun message », c'est la règle que A.3 rend opposable
        <p className="small muted" style={{ margin: 0 }}>
          L'index des messages vit dans l'espace partagé. Connectez-le pour voir ce qui reste à
          rattacher (<a href="#/sante">Paramètres → Branchements</a>).
        </p>
      ) : lignes.length === 0 ? (
        <EmptyState>Aucun message en attente de projet.</EmptyState>
      ) : (
        <>
          {source === 'cache' && (
            <p className="small muted" style={{ marginTop: 0 }}>
              Hors ligne : voici ce que ce poste connaît (90 derniers jours), pas forcément tout.
            </p>
          )}
          {fils.map((groupe) => {
            const tete = groupe[0]
            const proposition = rattacher(reperes, {
              objet: tete.objet,
              expediteur: tete.expediteurAdresse || tete.expediteur,
              destinataires: [...tete.destinataires, ...tete.copies],
            })
            const c = choix[tete.id] || {
              projetId: proposition.projetId || '',
              memoriser: true,
            }
            const raisons = [...proposition.raisons, ...tete.propose.raisonsRattachement]
            return (
              <div
                key={tete.id}
                style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 10, marginBottom: 10 }}
              >
                <p className="small" style={{ margin: '0 0 2px' }}>
                  <strong>{tete.objet || '(sans objet)'}</strong>{' '}
                  {proposition.projetId && <BadgeConfiance confiance={proposition.confiance} />}{' '}
                  {groupe.length > 1 && <Badge tone="info">{groupe.length} messages du fil</Badge>}
                </p>
                <p className="small muted" style={{ margin: '0 0 6px' }}>
                  {tete.expediteur || tete.expediteurAdresse} ·{' '}
                  {tete.envoyeLe ? fmtDate(tete.envoyeLe.slice(0, 10)) : '—'} ·{' '}
                  {libelleProposition(proposition)} · <LienGmail source={tete.urlGmail} />
                </p>
                {raisons.length > 0 && (
                  <details className="small" style={{ marginBottom: 6 }}>
                    <summary>Voir pourquoi cette proposition</summary>
                    <ul style={{ margin: '4px 0 0 18px' }}>
                      {raisons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {/* Le résumé du §5.3 quand il y en a un — c'est-à-dire quand
                    ce message a DÉJÀ été rattaché puis détaché à la main :
                    l'Edge Function A.6 ne résume que les messages rattachés.
                    Le cas est rare et il est exactement celui où la mention
                    « brouillon » compte : on rouvre un message dont une
                    machine a écrit trois lignes, et c'est d'après lui, pas
                    d'après elles, qu'on choisit le projet. A.7 montera le
                    même composant dans `LigneCourrier`, où il servira tous
                    les jours. */}
                <ResumeMessage resume={tete.resume} le={tete.resumeLe} />
                {/* Les trois axes du §5.2 (A.8) : proposés par le lexique
                    déterministe du serveur, corrigeables ici même. Ils sont
                    montrés AVANT le rattachement parce qu'ils aident à le
                    choisir — savoir qu'un message vient d'un BET en phase VISA
                    dit souvent de quel projet il parle. */}
                <AxesMessage
                  phase={tete.phase}
                  typeEchange={tete.typeEchange}
                  importance={tete.importance}
                  confiance={tete.propose.confianceCategorisation}
                  raisons={tete.propose.raisonsCategorisation}
                  signePar={tete.categorisePar}
                />
                <ChoixAxes message={tete} onCorrige={recharger} />
                <ChoixRattachement
                  adresse={tete.expediteurAdresse}
                  valeur={c.projetId}
                  onValeur={(v) => setChoix((p) => ({ ...p, [tete.id]: { ...c, projetId: v } }))}
                  memoriser={c.memoriser}
                  onMemoriser={(v) => setChoix((p) => ({ ...p, [tete.id]: { ...c, memoriser: v } }))}
                  projets={projets}
                />
                <div className="toolbar" style={{ marginTop: 6, marginBottom: 0 }}>
                  <Btn
                    small
                    kind="primary"
                    disabled={!c.projetId || occupe === tete.id}
                    onClick={() => void appliquer(groupe)}
                  >
                    {occupe === tete.id
                      ? 'Rattachement…'
                      : groupe.length > 1
                        ? `Rattacher le fil (${groupe.length})`
                        : 'Rattacher'}
                  </Btn>
                </div>
              </div>
            )
          })}
          {suite && (
            <Btn small kind="ghost" onClick={chargerSuite}>
              Charger la suite
            </Btn>
          )}
        </>
      )}
      {message && <p className="small danger-text" style={{ marginTop: 8 }}>{message}</p>}
    </Card>
  )
}

/** la seconde mémoire, alimentée par l'onglet ouvert (`surveillance.ts`)
 *  jusqu'à B.15 — la carte disparaîtra avec elle */
function CarteCourriersARattacher() {
  const { state, update } = useStore()
  const moi = useMoi()
  const [choix, setChoix] = useState<Record<string, { projetId: string; memoriser: boolean }>>({})
  const enAttente = courriersARattacher(state)
  const projets = projetsCorrigibles(state)
  if (enAttente.length === 0) return null

  const appliquer = (id: string) => {
    const c = choix[id]
    if (!c?.projetId) return
    const ligne = enAttente.find((x) => x.id === id)
    const regle = c.memoriser && ligne ? regleProposee(state, ligne.adresse, c.projetId, moi.nom || undefined) : null
    update((d) => {
      const courrier = d.courriers.find((x) => x.id === id)
      if (courrier) courrier.projetId = c.projetId
      if (regle) enregistrerRegle(d, regle)
    })
    toast(`Courrier rattaché à ${c.projetId}.`, { tone: 'ok' })
  }

  return (
    <Card titre="Courriers captés par l'onglet ouvert, sans projet">
      <p className="small muted" style={{ marginTop: 0 }}>
        Seconde mémoire, alimentée tant que la surveillance Gmail du navigateur tourne. Elle
        disparaîtra quand l'ingestion serveur aura fait ses preuves ; d'ici là, l'ignorer laisserait
        la moitié de la file invisible.
      </p>
      {enAttente.map((ligne) => {
        const c = choix[ligne.id] || { projetId: ligne.proposition.projetId || '', memoriser: true }
        return (
          <div
            key={ligne.id}
            style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 10, marginBottom: 10 }}
          >
            <p className="small" style={{ margin: '0 0 2px' }}>
              <strong>{ligne.objet || '(sans objet)'}</strong>{' '}
              {ligne.proposition.projetId && <BadgeConfiance confiance={ligne.proposition.confiance} />}
            </p>
            <p className="small muted" style={{ margin: '0 0 6px' }}>
              {ligne.expediteur} · {ligne.date ? fmtDate(ligne.date) : '—'} ·{' '}
              {libelleProposition(ligne.proposition)} · <LienGmail source={ligne.source} />
            </p>
            {ligne.proposition.raisons.length > 0 && (
              <details className="small" style={{ marginBottom: 6 }}>
                <summary>Voir pourquoi cette proposition</summary>
                <ul style={{ margin: '4px 0 0 18px' }}>
                  {ligne.proposition.raisons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </details>
            )}
            <ChoixRattachement
              adresse={ligne.adresse}
              valeur={c.projetId}
              onValeur={(v) => setChoix((p) => ({ ...p, [ligne.id]: { ...c, projetId: v } }))}
              memoriser={c.memoriser}
              onMemoriser={(v) => setChoix((p) => ({ ...p, [ligne.id]: { ...c, memoriser: v } }))}
              projets={projets}
            />
            <div className="toolbar" style={{ marginTop: 6, marginBottom: 0 }}>
              <Btn small kind="primary" disabled={!c.projetId} onClick={() => appliquer(ligne.id)}>
                Rattacher
              </Btn>
            </div>
          </div>
        )
      })}
    </Card>
  )
}

/** Les règles apprises, listées, désactivables, supprimables — jamais
 *  implicites. Une règle qu'on ne peut pas retrouver est une règle qu'on
 *  ne peut pas corriger, et elle se trompera un jour. */
function CarteRegles() {
  const { state, update } = useStore()
  const regles = reglesRattachement(state)
  return (
    <Card titre="Corrections mémorisées">
      <p className="small muted" style={{ marginTop: 0 }}>
        Chaque correction apprend une règle « adresse → projet ». Elle PROPOSE le projet des
        messages suivants — l'ingestion serveur les applique aussi — et ne valide jamais rien à
        votre place : la proposition reste corrigible.
      </p>
      {regles.length === 0 ? (
        <EmptyState>Aucune règle pour l'instant — elles naissent des corrections ci-dessus.</EmptyState>
      ) : (
        <Table head={['Règle', 'Depuis', 'Par', 'État', '']}>
          {regles.map((r) => (
            <tr key={r.id}>
              <td>{libelleRegle(state, r)}</td>
              <td className="small muted">{fmtDate(r.creeLe)}</td>
              <td className="small muted">{r.creePar || '—'}</td>
              <td>
                <Badge tone={r.actif ? 'ok' : 'muted'}>{r.actif ? 'active' : 'en pause'}</Badge>
              </td>
              <td className="right">
                <Btn small kind="ghost" onClick={() => update((d) => basculerRegle(d, r.id, !r.actif))}>
                  {r.actif ? 'Désactiver' : 'Réactiver'}
                </Btn>{' '}
                <Btn
                  small
                  kind="ghost"
                  onClick={() => {
                    void (async () => {
                      if (await confirmer(`Supprimer la règle « ${libelleRegle(state, r)} » ?`))
                        update((d) => supprimerRegle(d, r.id))
                    })()
                  }}
                >
                  Supprimer
                </Btn>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  )
}

function OngletRattacher({ etat }: { etat: EtatCommunications }) {
  return (
    <>
      <CarteMessagesARattacher etat={etat} />
      <CarteCourriersARattacher />
      <CarteRegles />
    </>
  )
}

// ============================================================
// Page
// ============================================================

const ONGLETS = [
  { id: 'entrants', label: "Boîte d'arrivée" },
  { id: 'verifier', label: 'À vérifier' },
  { id: 'rattacher', label: 'À rattacher' },
  { id: 'tous', label: 'Tous les documents' },
] as const

export default function Documents() {
  const route = useRoute()
  const { state } = useStore()
  const nbAVerifier = documentsATraiter(state).length
  const tab = ONGLETS.some((o) => o.id === route[1]) ? route[1] : 'entrants'
  // La file « à rattacher » est lue ICI, quel que soit l'onglet ouvert :
  // sans compteur, un message sans projet attendait des jours en silence
  // (R5). `null` = espace partagé non connecté — « on ne sait pas » ne
  // s'affiche pas « 0 ».
  const filesMessages = useCommunications({ sansProjet: true })
  const nbCourriers = courriersARattacher(state).length
  const nbMessages = filesMessages.lignes?.length ?? null
  const nbARattacher = nbMessages === null && nbCourriers === 0 ? null : (nbMessages ?? 0) + nbCourriers
  const libelleOnglet = (o: (typeof ONGLETS)[number]): string => {
    if (o.id === 'verifier' && nbAVerifier > 0) return `${o.label} (${nbAVerifier})`
    // « + » : une page de messages est chargée, il en reste derrière
    if (o.id === 'rattacher' && nbARattacher)
      return `${o.label} (${nbARattacher}${filesMessages.suite ? '+' : ''})`
    return o.label
  }
  return (
    <Page
      titre="Documents & arrivées"
      sousTitre="Tout ce qui arrive — fichiers et messages — tracé : source, projet, version, validation."
    >
      <Tabs
        tabs={ONGLETS.map((o) => ({ id: o.id, label: libelleOnglet(o) }))}
        actif={tab}
        onSelect={(id) => navigate(`/documents/${id}`)}
      />
      {tab === 'entrants' && (
        <>
          <CarteArriveesServeur />
          <CarteEntrants />
        </>
      )}
      {tab === 'verifier' && <CarteAVerifier />}
      {tab === 'rattacher' && <OngletRattacher etat={filesMessages} />}
      {/* `#/documents/tous/<id>` ouvre la fiche du document (palette « / ») */}
      {tab === 'tous' && <CarteTous docId={route[2]} />}
    </Page>
  )
}
