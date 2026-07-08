// Onglet DCE & CCTP de l'espace projet : le site LIT les pièces
// écrites du DCE (CCTP par lot) — depuis le dossier Drive du projet
// (04_PRO-DCE) ou un fichier déposé — en extrait les lots et les
// éléments d'ouvrage, puis les pose sur le planning travaux avec
// une date. Analyse 100 % déterministe dans le navigateur ; en
// secours, un Projet Claude structure le document (contrat JSON,
// toujours relu avant import).

import { useCallback, useEffect, useState } from 'react'
import type { LotDCE, Projet, TacheChantier } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  CopyBtn,
  EmptyState,
  Field,
  Modal,
  Select,
  Table,
  TextArea,
  TextInput,
  confirmer,
  toast,
} from '../ui'
import { fmtDate, fold, todayISO, uid } from '../util'
import {
  analyserCCTP,
  extraireTexteFichier,
  fenetreLot,
  genererTaches,
  libelleLot,
  parseRetourCCTP,
  promptExtractionCCTP,
  rapprocherMarcheLot,
  repartirDates,
  versElements,
  type LotAnalyse,
} from '../cctp'
import {
  lireRacine,
  listerFichiersProjet,
  nomConforme,
  rangerFichier,
  slugProjet,
  supporteFS,
  verifierPermission,
  type FSDirHandle,
  type FSFileHandle,
} from '../fsdrive'

/** sous-dossier normalisé du DCE dans l'arborescence projet */
const DOSSIER_DCE = '04_PRO-DCE'

/** numéro de lot normalisé : « 2 » et « 02 » désignent le même lot */
function numeroNormalise(n: string): string {
  const t = n.trim()
  return /^\d+$/.test(t) ? t.padStart(2, '0') : t
}

// ============================================================
// Aperçu avant import — l'humain valide ce que le site a compris
// ============================================================

interface LotApercu extends LotAnalyse {
  inclus: boolean
  marcheId: string
  /** chemin ou nom du fichier d'origine (traçabilité) */
  fichier?: string
  dejaImporte: boolean
}

function ModalApercu({
  projet: p,
  lots,
  source,
  onClose,
}: {
  projet: Projet
  lots: LotApercu[]
  source: 'analyse' | 'claude'
  onClose: () => void
}) {
  const { state, update, replace } = useStore()
  const [liste, setListe] = useState<LotApercu[]>(lots)
  const marches = state.marches.filter((m) => m.projetId === p.id)

  const maj = (i: number, champs: Partial<LotApercu>) =>
    setListe((prev) => prev.map((l, j) => (j === i ? { ...l, ...champs } : l)))

  const nbInclus = liste.filter((l) => l.inclus).length

  const importer = () => {
    const snap = state
    // tout est calculé AVANT la mutation (le producteur du store peut être
    // rejoué par React : il ne doit faire que pousser des objets déjà prêts)
    const nouveauxLots: LotDCE[] = []
    const nouvellesTaches: TacheChantier[] = []
    const dejaAuPlanning = [...state.tachesChantier]
    let sansDate = false
    for (const l of liste) {
      if (!l.inclus || l.elements.length === 0) continue
      const lot: LotDCE = {
        id: uid('lotdce'),
        projetId: p.id,
        numero: numeroNormalise(l.numero),
        intitule: l.intitule.trim() || 'Lot sans intitulé',
        marcheId: l.marcheId || null,
        fichier: l.fichier,
        source,
        importeLe: todayISO(),
        elements: versElements(l.elements),
      }
      nouveauxLots.push(lot)
      const res = genererTaches(p, lot, state.marches, dejaAuPlanning)
      nouvellesTaches.push(...res.taches)
      dejaAuPlanning.push(...res.taches)
      if (res.sansDate) sansDate = true
    }
    update((d) => {
      d.lotsDce.push(...nouveauxLots)
      d.tachesChantier.push(...nouvellesTaches)
    })
    toast(
      `${nouveauxLots.length} lot(s) et ${nouvellesTaches.length} tâche(s) ajoutés au planning travaux` +
        (sansDate
          ? ' — certaines tâches sont « à dater » : datez le marché du lot (onglet Chantier) ou la phase DET, puis « Replanifier ».'
          : '.'),
      { tone: 'ok', undo: () => replace(snap) },
    )
    onClose()
  }

  return (
    <Modal titre={`Aperçu — ce que le site a compris (${liste.length} lot(s))`} onClose={onClose} large>
      <p className="small muted" style={{ marginTop: 0 }}>
        Relisez avant d'importer : ajustez le numéro et l'intitulé de chaque lot, rattachez le marché
        signé (les dates d'intervention datent alors les tâches), décochez ce qui ne doit pas entrer
        au planning.
      </p>
      {liste.map((l, i) => (
        <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 10, marginBottom: 10 }}>
          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <Field label="Importer">
              <input
                type="checkbox"
                checked={l.inclus}
                onChange={(e) => maj(i, { inclus: e.target.checked })}
                style={{ width: 18, height: 18 }}
              />
            </Field>
            <Field label="N° de lot">
              <TextInput value={l.numero} onChange={(v) => maj(i, { numero: v })} placeholder="02" />
            </Field>
            <Field label="Intitulé">
              <TextInput value={l.intitule} onChange={(v) => maj(i, { intitule: v })} />
            </Field>
            <Field label="Marché rattaché" hint="ses dates d'intervention datent les tâches">
              <Select
                value={l.marcheId}
                onChange={(v) => maj(i, { marcheId: v })}
                options={[
                  { value: '', label: '— aucun (pas encore attribué)' },
                  ...marches.map((m) => ({ value: m.id, label: `${m.lot} — ${m.entreprise}` })),
                ]}
              />
            </Field>
          </div>
          <p className="small" style={{ margin: '4px 0' }}>
            <Badge tone="info">{l.elements.length} élément(s)</Badge>
            {l.dejaImporte && (
              <>
                {' '}
                <Badge tone="warn">un lot identique existe déjà</Badge>
              </>
            )}
            {l.fichier && <span className="muted"> · source : {l.fichier}</span>}
          </p>
          <div style={{ maxHeight: 180, overflowY: 'auto', background: 'var(--bg-soft)', borderRadius: 4, padding: '6px 10px' }}>
            {l.elements.map((e, j) => (
              <div key={j} className="small" style={{ padding: '2px 0' }}>
                {e.article && <span className="mono muted">{e.article}</span>} {e.designation}
                {e.localisation && <span className="muted"> · {e.localisation}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={importer} disabled={nbInclus === 0}>
          Importer {nbInclus} lot(s) → planning travaux
        </Btn>
      </div>
    </Modal>
  )
}

// ============================================================
// Import — Drive (04_PRO-DCE), fichier déposé, secours Claude
// ============================================================

function CarteImportCCTP({ projet: p }: { projet: Projet }) {
  const { state } = useStore()
  const [racine, setRacine] = useState<FSDirHandle | null>(null)
  const [fichiersDrive, setFichiersDrive] = useState<FSFileHandle[] | null>(null)
  const [permissionRequise, setPermissionRequise] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [message, setMessage] = useState('')
  const [rangerAuDrive, setRangerAuDrive] = useState(true)
  const [retourClaude, setRetourClaude] = useState('')
  const [apercu, setApercu] = useState<{ lots: LotApercu[]; source: 'analyse' | 'claude' } | null>(null)

  useEffect(() => {
    if (supporteFS) void lireRacine().then(setRacine)
  }, [])

  // le scan ne dépend que du dossier visé (slug) — pas de l'identité de
  // l'objet projet, qui change à chaque écriture du store (re-scan inutile)
  const slug = slugProjet(p)
  const scanner = useCallback(async () => {
    if (!racine) return
    try {
      // pas de demande de permission au chargement (Chrome exige un geste) :
      // on lit si c'est déjà accordé, sinon on propose un bouton
      const perm = (await racine.queryPermission?.({ mode: 'readwrite' })) || 'granted'
      if (perm !== 'granted') {
        setPermissionRequise(true)
        return
      }
      setPermissionRequise(false)
      setFichiersDrive(await listerFichiersProjet(racine, slug, DOSSIER_DCE))
    } catch (e) {
      setMessage(`Lecture du Drive impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [racine, slug])

  useEffect(() => {
    void scanner()
  }, [scanner])

  const dejaImporte = (l: LotAnalyse): boolean =>
    state.lotsDce.some(
      (x) =>
        x.projetId === p.id &&
        numeroNormalise(x.numero) === numeroNormalise(l.numero || '') &&
        fold(x.intitule) === fold(l.intitule),
    )

  const ouvrirApercu = (lots: LotAnalyse[], source: 'analyse' | 'claude', fichier?: string) => {
    const marches = state.marches.filter((m) => m.projetId === p.id)
    setApercu({
      source,
      lots: lots.map((l) => {
        const deja = dejaImporte(l)
        return {
          ...l,
          inclus: !deja,
          marcheId: rapprocherMarcheLot(l, marches)?.id || '',
          fichier,
          dejaImporte: deja,
        }
      }),
    })
  }

  const analyserFichier = async (file: File, cheminDrive?: string) => {
    setMessage('')
    setEnCours(true)
    try {
      const texte = await extraireTexteFichier(file)
      if (texte.length < 300) {
        setMessage(
          `« ${file.name} » : texte illisible (PDF scanné ou protégé) — passez par le secours Claude ci-dessous.`,
        )
        return
      }
      const lots = analyserCCTP(texte, file.name)
      if (lots.length === 0) {
        setMessage(
          `« ${file.name} » : aucun article numéroté détecté — document atypique ? Passez par le secours Claude ci-dessous.`,
        )
        return
      }
      let chemin = cheminDrive
      if (!chemin && rangerAuDrive && racine) {
        try {
          chemin = await rangerFichier(racine, p, DOSSIER_DCE, file, nomConforme(p, 'CCTP', '', file.name))
          await scanner()
        } catch {
          // rangement impossible (permission) : l'analyse reste valable
        }
      }
      ouvrirApercu(lots, 'analyse', chemin || file.name)
    } catch (e) {
      setMessage(`Analyse impossible : ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setEnCours(false)
    }
  }

  const analyserDrive = async (fh: FSFileHandle) => {
    try {
      const file = await fh.getFile()
      await analyserFichier(file, `${slugProjet(p)}/${DOSSIER_DCE}/${fh.name}`)
    } catch (e) {
      setMessage(`Lecture de « ${fh.name} » impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const analyserRetourClaude = () => {
    setMessage('')
    const { lots, erreur } = parseRetourCCTP(retourClaude)
    if (erreur || !lots) {
      setMessage(`Retour illisible : ${erreur}`)
      return
    }
    ouvrirApercu(lots, 'claude')
  }

  const candidatsDrive = (fichiersDrive || []).filter((f) => /\.(pdf|txt)$/i.test(f.name))

  return (
    <Card titre="Lire un CCTP — le site comprend les pièces écrites du DCE">
      <div className="pill-note">
        Déposez les CCTP du DCE (un par lot, ou un document global) : le site détecte les lots et les
        articles d'ouvrages, vous relisez l'aperçu, et <strong>chaque élément prévu entre au planning
        travaux avec une date</strong> (dates du marché rattaché, sinon phase DET). Tout se passe dans
        le navigateur — le document ne quitte pas le poste.
      </div>

      {/* --- depuis le Drive du projet --- */}
      {supporteFS && racine && (
        <div style={{ marginTop: 12 }}>
          <strong className="small">Depuis le Drive du projet — {slugProjet(p)}/{DOSSIER_DCE}</strong>
          {permissionRequise && (
            <p className="small" style={{ margin: '4px 0' }}>
              <Btn
                small
                onClick={() => {
                  void (async () => {
                    if (await verifierPermission(racine)) await scanner()
                  })()
                }}
              >
                Autoriser la lecture du Drive
              </Btn>
            </p>
          )}
          {fichiersDrive === null ? null : candidatsDrive.length === 0 ? (
            <p className="muted small" style={{ margin: '4px 0' }}>
              Aucun PDF dans {DOSSIER_DCE} — déposez-y les CCTP (ci-dessous ou via l'onglet Documents),
              le dossier du projet évolue avec le DCE.
            </p>
          ) : (
            <Table compact head={['Fichier', '']}>
              {candidatsDrive.map((f) => (
                <tr key={f.name}>
                  <td className="small mono">{f.name}</td>
                  <td className="right">
                    <Btn small kind="primary" disabled={enCours} onClick={() => void analyserDrive(f)}>
                      Analyser
                    </Btn>
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <Btn small kind="ghost" onClick={() => void scanner()}>Actualiser</Btn>
        </div>
      )}
      {supporteFS && !racine && (
        <p className="muted small" style={{ marginTop: 10 }}>
          Configurez le dossier Drive dans l'onglet <strong>Documents</strong> pour analyser directement
          les CCTP rangés dans {DOSSIER_DCE} — et ranger automatiquement ceux déposés ici.
        </p>
      )}

      {/* --- fichier déposé --- */}
      <div className="form-row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
        <Field label="Ou déposer un CCTP (PDF ou texte)">
          <input
            className="input"
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            disabled={enCours}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void analyserFichier(f)
              e.target.value = ''
            }}
          />
        </Field>
        {racine && (
          <Field label="Rangement" hint={`copie le fichier dans ${DOSSIER_DCE} à la nomenclature`}>
            <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', height: 34 }}>
              <input
                type="checkbox"
                checked={rangerAuDrive}
                onChange={(e) => setRangerAuDrive(e.target.checked)}
              />
              ranger aussi dans le Drive
            </label>
          </Field>
        )}
      </div>
      {enCours && <p className="small"><Badge tone="info">analyse en cours…</Badge></p>}
      {message && <p className="small warn-text" style={{ marginTop: 6 }}>{message}</p>}

      {/* --- secours Claude --- */}
      <details style={{ marginTop: 12 }}>
        <summary className="small">Secours — CCTP scanné ou atypique : faire structurer par Claude</summary>
        <p className="small muted" style={{ margin: '8px 0 6px' }}>
          Copiez le prompt, collez-le dans un Projet Claude <strong>avec les fichiers CCTP joints</strong>,
          puis rapportez sa réponse ci-dessous : l'aperçu de relecture reste le même — rien n'entre
          sans validation humaine.
        </p>
        <div className="toolbar">
          <CopyBtn text={() => promptExtractionCCTP(p)} label="Copier le prompt d'extraction CCTP" />
        </div>
        <TextArea
          value={retourClaude}
          onChange={setRetourClaude}
          rows={4}
          mono
          placeholder="Collez ici la réponse complète de Claude (le bloc JSON est détecté tout seul)…"
        />
        <div className="toolbar" style={{ marginTop: 6 }}>
          <Btn kind="primary" small disabled={!retourClaude.trim()} onClick={analyserRetourClaude}>
            Analyser le retour
          </Btn>
        </div>
      </details>

      {apercu && (
        <ModalApercu
          projet={p}
          lots={apercu.lots}
          source={apercu.source}
          onClose={() => setApercu(null)}
        />
      )}
    </Card>
  )
}

// ============================================================
// Lots du DCE — bibliothèque structurée, reliée aux marchés
// ============================================================

function ModalElements({ lot, onClose }: { lot: LotDCE; onClose: () => void }) {
  const { state, update } = useStore()
  const courant = state.lotsDce.find((l) => l.id === lot.id) || lot
  const [article, setArticle] = useState('')
  const [designation, setDesignation] = useState('')
  const [localisation, setLocalisation] = useState('')

  const ajouter = () => {
    if (!designation.trim()) return
    update((d) => {
      const l = d.lotsDce.find((x) => x.id === lot.id)
      if (!l) return
      l.elements.push({
        id: uid('elt'),
        article: article.trim() || undefined,
        designation: designation.trim(),
        localisation: localisation.trim() || undefined,
      })
    })
    setArticle('')
    setDesignation('')
    setLocalisation('')
  }

  const retirer = (id: string) =>
    update((d) => {
      const l = d.lotsDce.find((x) => x.id === lot.id)
      if (l) l.elements = l.elements.filter((e) => e.id !== id)
    })

  return (
    <Modal titre={`Éléments — ${libelleLot(courant)}`} onClose={onClose} large>
      {courant.elements.length === 0 ? (
        <EmptyState>Aucun élément — ajoutez les ouvrages du lot ci-dessous.</EmptyState>
      ) : (
        <Table compact head={['Article', 'Désignation', 'Localisation', '']}>
          {courant.elements.map((e) => (
            <tr key={e.id}>
              <td className="mono small">{e.article || '—'}</td>
              <td>{e.designation}</td>
              <td className="small muted">{e.localisation || ''}</td>
              <td className="right">
                <Btn small kind="danger" onClick={() => retirer(e.id)}>Retirer</Btn>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className="form-row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
        <Field label="Article">
          <TextInput value={article} onChange={setArticle} placeholder="2.3.1" />
        </Field>
        <Field label="Désignation">
          <TextInput value={designation} onChange={setDesignation} placeholder="Voiles béton armé…" />
        </Field>
        <Field label="Localisation">
          <TextInput value={localisation} onChange={setLocalisation} placeholder="RDC" />
        </Field>
        <Btn kind="primary" onClick={ajouter} disabled={!designation.trim()}>Ajouter</Btn>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        Retirer un élément ne supprime pas sa tâche du planning (onglet Planning pour les tâches).
        « Envoyer au planning » depuis la liste des lots crée les tâches des nouveaux éléments.
      </p>
      <div className="form-foot">
        <Btn onClick={onClose}>Fermer</Btn>
      </div>
    </Modal>
  )
}

function CarteLotsDCE({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const [elementsDe, setElementsDe] = useState<LotDCE | null>(null)
  const [modalLot, setModalLot] = useState(false)
  const [numero, setNumero] = useState('')
  const [intitule, setIntitule] = useState('')

  const lots = state.lotsDce
    .filter((l) => l.projetId === p.id)
    .sort((a, b) => (a.numero || '99').localeCompare(b.numero || '99') || a.intitule.localeCompare(b.intitule))
  const marches = state.marches.filter((m) => m.projetId === p.id)

  const nbTaches = (lotId: string) => state.tachesChantier.filter((t) => t.lotDceId === lotId).length

  const rattacherMarche = (lot: LotDCE, marcheId: string) =>
    update((d) => {
      const l = d.lotsDce.find((x) => x.id === lot.id)
      if (!l) return
      l.marcheId = marcheId || null
      // les tâches du lot suivent le rattachement (traçabilité situations/CR)
      for (const t of d.tachesChantier) if (t.lotDceId === lot.id) t.marcheId = marcheId || null
    })

  const envoyerAuPlanning = (lot: LotDCE) => {
    const l = state.lotsDce.find((x) => x.id === lot.id) || lot
    const res = genererTaches(p, l, state.marches, state.tachesChantier)
    if (res.taches.length === 0) {
      toast('Rien à ajouter : tous les éléments du lot sont déjà au planning.', { tone: 'warn' })
      return
    }
    update((d) => {
      d.tachesChantier.push(...res.taches)
    })
    toast(
      `${res.taches.length} tâche(s) ajoutée(s) au planning travaux${
        res.sansDate ? ' — « à dater » : datez le marché ou la phase DET puis « Replanifier »' : ''
      }.`,
      { tone: 'ok' },
    )
  }

  const replanifier = async (lot: LotDCE) => {
    if (
      !(await confirmer({
        message: `Replanifier les dates des tâches de « ${libelleLot(lot)} » sur la fenêtre actuelle (marché rattaché, sinon phase DET) ? Les dates ajustées à la main seront recalculées.`,
        confirmerLabel: 'Replanifier',
      }))
    )
      return
    const fenetre = fenetreLot(state.lotsDce.find((x) => x.id === lot.id) || lot, state.marches, p)
    if (!fenetre) {
      toast('Pas de fenêtre de dates : datez le marché rattaché (onglet Chantier) ou la phase DET.', { tone: 'warn' })
      return
    }
    update((d) => {
      const l = d.lotsDce.find((x) => x.id === lot.id)
      if (!l) return
      const ordre = new Map(l.elements.map((e, i) => [e.id, i]))
      const taches = d.tachesChantier
        .filter((t) => t.lotDceId === lot.id)
        .sort((a, b) => (ordre.get(a.elementId || '') ?? 999) - (ordre.get(b.elementId || '') ?? 999))
      const creneaux = repartirDates(fenetre, taches.length)
      taches.forEach((t, i) => {
        t.debut = creneaux[i].debut
        t.fin = creneaux[i].fin
      })
    })
    toast('Dates replanifiées sur la fenêtre du lot.', { tone: 'ok' })
  }

  const supprimer = async (lot: LotDCE) => {
    const snap = state
    const nb = nbTaches(lot.id)
    if (
      !(await confirmer({
        message: `Supprimer « ${libelleLot(lot)} » ?${nb > 0 ? `\n${nb} tâche(s) de planning issues de ce lot seront supprimées aussi.` : ''}`,
        danger: true,
        confirmerLabel: 'Supprimer',
      }))
    )
      return
    update((d) => {
      d.lotsDce = d.lotsDce.filter((x) => x.id !== lot.id)
      d.tachesChantier = d.tachesChantier.filter((t) => t.lotDceId !== lot.id)
    })
    toast('Lot supprimé.', { undo: () => replace(snap) })
  }

  const creerLot = () => {
    if (!intitule.trim()) return
    update((d) => {
      d.lotsDce.push({
        id: uid('lotdce'),
        projetId: p.id,
        numero: numeroNormalise(numero),
        intitule: intitule.trim(),
        marcheId: null,
        source: 'manuel',
        importeLe: todayISO(),
        elements: [],
      })
    })
    setNumero('')
    setIntitule('')
    setModalLot(false)
    toast('Lot créé — ajoutez ses éléments (« Éléments »).', { tone: 'ok' })
  }

  return (
    <Card
      titre="Lots du DCE — ce qui est prévu aux pièces écrites"
      actions={<Btn small onClick={() => setModalLot(true)}>Ajouter un lot à la main</Btn>}
    >
      {lots.length === 0 ? (
        <EmptyState>
          Aucun lot pour l'instant — analysez les CCTP ci-dessus : chaque lot arrive avec ses éléments
          d'ouvrage, et le planning travaux se remplit tout seul.
        </EmptyState>
      ) : (
        <Table compact head={['Lot', 'Éléments', 'Au planning', 'Marché rattaché', 'Source', '']}>
          {lots.map((l) => (
            <tr key={l.id}>
              <td>
                <strong>{libelleLot(l)}</strong>
              </td>
              <td className="num">{l.elements.length}</td>
              <td className="num">{nbTaches(l.id)}</td>
              <td>
                <Select
                  value={l.marcheId || ''}
                  onChange={(v) => rattacherMarche(l, v)}
                  options={[
                    { value: '', label: '— aucun' },
                    ...marches.map((m) => ({ value: m.id, label: `${m.lot} — ${m.entreprise}` })),
                  ]}
                />
              </td>
              <td className="small muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.fichier || ''}>
                {l.fichier || (l.source === 'manuel' ? 'saisie manuelle' : l.source === 'claude' ? 'retour Claude' : '—')}
                <div>{fmtDate(l.importeLe)}</div>
              </td>
              <td className="right">
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Btn small onClick={() => setElementsDe(l)}>Éléments</Btn>
                  <Btn small kind="primary" onClick={() => envoyerAuPlanning(l)}>Envoyer au planning</Btn>
                  <Btn small onClick={() => void replanifier(l)} title="Recalcule les dates des tâches du lot sur la fenêtre actuelle">
                    Replanifier
                  </Btn>
                  <Btn small kind="danger" onClick={() => void supprimer(l)}>Suppr.</Btn>
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>
        Rattacher un marché (onglet Chantier) donne au lot ses dates d'intervention — les tâches
        générées se calent dessus. Les tâches se consultent et s'ajustent dans l'onglet{' '}
        <a href={`#/projets/${p.id}/planning`}>Planning</a>.
      </p>

      {elementsDe && <ModalElements lot={elementsDe} onClose={() => setElementsDe(null)} />}
      {modalLot && (
        <Modal titre="Nouveau lot (saisie manuelle)" onClose={() => setModalLot(false)}>
          <div className="form-row">
            <Field label="N° de lot">
              <TextInput value={numero} onChange={setNumero} placeholder="02" />
            </Field>
            <Field label="Intitulé">
              <TextInput value={intitule} onChange={setIntitule} placeholder="Gros œuvre" />
            </Field>
          </div>
          <div className="form-foot">
            <Btn onClick={() => setModalLot(false)}>Annuler</Btn>
            <Btn kind="primary" onClick={creerLot} disabled={!intitule.trim()}>Créer le lot</Btn>
          </div>
        </Modal>
      )}
    </Card>
  )
}

export default function ProjetDCE({ projet }: { projet: Projet }) {
  return (
    <>
      <CarteImportCCTP projet={projet} />
      <CarteLotsDCE projet={projet} />
    </>
  )
}
