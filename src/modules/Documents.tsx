// Page « Documents » — le registre documentaire central.
// Trois vues : la boîte d'arrivée (dépôt + _A_CLASSER du Drive, avec
// proposition de classement DÉTERMINISTE et « Voir pourquoi »), la file
// « à vérifier » (rien n'entre dans les données sans validation), et
// l'inventaire complet — cherchable, filtrable, traçable (événements).

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DocumentRecord, Projet } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  Field,
  Modal,
  Page,
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
import { fmtDate, fold } from '../util'
import {
  CATEGORIES_DOC,
  DOSSIER_PAR_CATEGORIE,
  LIBELLES_STATUT,
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
  rangerFichier,
  supprimerFichierRacine,
  supporteFS,
  type FSDirHandle,
} from '../fsdrive'

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
  const [racine, setRacine] = useState<FSDirHandle | null>(null)
  const [entrants, setEntrants] = useState<Entrant[]>([])
  const [message, setMessage] = useState('')
  const [scanEnCours, setScanEnCours] = useState(false)
  const projetsActifs = state.projets.filter((p) => !['Livré', 'Perdu'].includes(p.statut))

  useEffect(() => {
    if (supporteFS) void lireRacine().then(setRacine)
  }, [])

  const preparer = useCallback(
    async (file: File, depuisDrive?: boolean): Promise<Entrant> => {
      const proposition = classerFichier(state, file.name, { typeMime: file.type || undefined })
      const categorie = proposition.categorie
      return {
        cle: `${depuisDrive ? 'drive' : 'depot'}:${file.name}:${file.size}`,
        file,
        depuisDrive,
        empreinte: await empreinteSha256(file),
        proposition,
        projetId: proposition.projetId || '',
        categorie,
        dossier: DOSSIER_PAR_CATEGORIE[categorie] || '00_ADMIN',
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
    setEntrants((prev) => prev.map((e) => (e.cle === cle ? { ...e, ...champs } : e)))

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
                    options={CATEGORIES_DOC.map((c) => ({ value: c, label: c }))}
                  />
                </Field>
                <Field label="Sous-dossier">
                  <Select
                    value={e.dossier}
                    onChange={(v) => majEntrant(e.cle, { dossier: v })}
                    options={ARBORESCENCE.map((a) => ({ value: a.dossier, label: a.dossier }))}
                  />
                </Field>
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
    </Card>
  )
}

// ============================================================
// À vérifier — les entrées du registre en attente de validation
// ============================================================

function CarteAVerifier() {
  const { state, update } = useStore()
  const aVerifier = state.registreDocuments.filter((d) =>
    ['recu', 'a_classer', 'a_valider'].includes(d.statut),
  )

  const valider = (doc: DocumentRecord) =>
    update((d) => {
      const x = d.registreDocuments.find((y) => y.id === doc.id)
      if (x) validerDocument(x, state.settings.personnes[0])
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

function ModalDocument({ doc, onClose }: { doc: DocumentRecord; onClose: () => void }) {
  const { state } = useStore()
  const projet = state.projets.find((p) => p.id === doc.projetId)
  const entreprise = state.entreprises.find((e) => e.id === doc.entrepriseId)
  const remplace = documentParId(state, doc.remplaceDocumentId)
  const remplacePar = state.registreDocuments.find((d) => d.remplaceDocumentId === doc.id)
  const lignes: { label: string; valeur: string }[] = [
    { label: 'Nom d’origine', valeur: doc.nomOriginal },
    { label: 'Catégorie', valeur: doc.categorie },
    { label: 'Statut', valeur: LIBELLES_STATUT[doc.statut] },
    { label: 'Version', valeur: `v${doc.version}` },
    { label: 'Source', valeur: doc.source },
    { label: 'Projet', valeur: projet ? `${projet.id} — ${projet.nom}` : '—' },
    { label: 'Entreprise', valeur: entreprise?.raisonSociale || '—' },
    { label: 'Reçu le', valeur: fmtDate(doc.recuLe) },
    { label: 'Chemin Drive', valeur: doc.cheminDrive || '— (non copié dans le Drive)' },
    { label: 'Empreinte SHA-256', valeur: doc.empreinteSha256 ? `${doc.empreinteSha256.slice(0, 16)}…` : '—' },
  ]
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

function CarteTous() {
  const { state } = useStore()
  const [recherche, setRecherche] = useState('')
  const [filtreProjet, setFiltreProjet] = useState('')
  const [filtreCategorie, setFiltreCategorie] = useState('')
  const [ouvert, setOuvert] = useState<DocumentRecord | null>(null)

  const docs = useMemo(() => {
    const cle = fold(recherche)
    return state.registreDocuments
      .filter((d) => !filtreProjet || d.projetId === filtreProjet)
      .filter((d) => !filtreCategorie || d.categorie === filtreCategorie)
      .filter((d) => !cle || fold(`${d.titre} ${d.nomOriginal} ${d.cheminDrive || ''}`).includes(cle))
      .slice()
      .sort((a, b) => b.recuLe.localeCompare(a.recuLe) || b.id.localeCompare(a.id))
  }, [state.registreDocuments, recherche, filtreProjet, filtreCategorie])

  const projetDe = (d: DocumentRecord): Projet | undefined =>
    state.projets.find((p) => p.id === d.projetId)

  return (
    <Card titre={`Tous les documents — ${state.registreDocuments.length} au registre`}>
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
                </td>
                <td>{d.categorie}</td>
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
      {ouvert && <ModalDocument doc={ouvert} onClose={() => setOuvert(null)} />}
    </Card>
  )
}

// ============================================================
// Page
// ============================================================

const ONGLETS = [
  { id: 'entrants', label: "Boîte d'arrivée" },
  { id: 'verifier', label: 'À vérifier' },
  { id: 'tous', label: 'Tous les documents' },
] as const

export default function Documents() {
  const route = useRoute()
  const { state } = useStore()
  const nbAVerifier = state.registreDocuments.filter((d) =>
    ['recu', 'a_classer', 'a_valider'].includes(d.statut),
  ).length
  const tab = ONGLETS.some((o) => o.id === route[1]) ? route[1] : 'entrants'
  return (
    <Page
      titre="Documents"
      sousTitre="Chaque fichier qui compte, tracé : source, projet, version, validation."
    >
      <Tabs
        tabs={ONGLETS.map((o) => ({
          id: o.id,
          label: o.id === 'verifier' && nbAVerifier > 0 ? `${o.label} (${nbAVerifier})` : o.label,
        }))}
        actif={tab}
        onSelect={(id) => navigate(`/documents/${id}`)}
      />
      {tab === 'entrants' && <CarteEntrants />}
      {tab === 'verifier' && <CarteAVerifier />}
      {tab === 'tous' && <CarteTous />}
    </Page>
  )
}
