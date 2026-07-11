// Onglet DCE & CCTP de l'espace projet : le site LIT les pièces
// écrites du DCE (CCTP par lot) — depuis le dossier Drive du projet
// (04_PRO-DCE) ou un fichier déposé — en extrait les lots et les
// éléments d'ouvrage, puis les pose sur le planning travaux avec
// une date. Analyse 100 % déterministe dans le navigateur ; en
// secours, un Projet Claude structure le document (contrat JSON,
// toujours relu avant import).

import { useCallback, useEffect, useState } from 'react'
import type { DpgfLot, LotDCE, Projet, TacheChantier } from '../types'
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
  toast, RowMenu } from '../ui'
import { fmtDate, fmtMoney, fold, todayISO, uid } from '../util'
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
  analyserDpgfTexte,
  analyserDpgfXlsx,
  elementsDepuisLignes,
  parseRetourDPGF,
  promptExtractionDPGF,
  sommeLignes,
  versLignes,
  type DpgfAnalyse,
} from '../dpgf'
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
import { ajouterEvenement, creerDocument, empreinteSha256, enregistrerDocument } from '../registre'

/** sous-dossier normalisé du DCE dans l'arborescence projet */
const DOSSIER_DCE = '04_PRO-DCE'

/** descripteur du fichier analysé — de quoi créer l'entrée du registre
 *  documentaire au moment de l'import (validation humaine) */
interface FichierSource {
  nomOriginal: string
  /** chemin dans le Drive quand le fichier y est (ou vient d'y être rangé) */
  chemin?: string
  empreinte: string
  taille: number
  typeMime?: string
  source: 'drive' | 'depot'
}

/** entrée de registre prête à pousser pour le fichier analysé (calculée
 *  AVANT la mutation — le producteur clonera pour rester rejouable) */
function documentDepuisSource(p: Projet, f: FichierSource, categorie: string) {
  return creerDocument({
    titre: f.chemin?.split('/').pop() || f.nomOriginal,
    nomOriginal: f.nomOriginal,
    source: f.source,
    categorie,
    typeMime: f.typeMime,
    taille: f.taille,
    empreinteSha256: f.empreinte || undefined,
    cheminDrive: f.chemin,
    projetId: p.id,
    statut: 'exploite', // les données extraites entrent au DCE/planning
  })
}

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
  fichierSource,
  onClose,
}: {
  projet: Projet
  lots: LotApercu[]
  source: 'analyse' | 'claude'
  fichierSource?: FichierSource
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
    const docPret = fichierSource ? documentDepuisSource(p, fichierSource, 'CCTP') : null
    update((d) => {
      // registre : le clone garde le producteur rejouable (docPret intact),
      // et enregistrerDocument dédoublonne par empreinte dans le brouillon
      let docId: string | null = null
      if (docPret) {
        const res = enregistrerDocument(d, structuredClone(docPret))
        if (res.doublon) {
          res.doc.statut = 'exploite'
          ajouterEvenement(res.doc, 'action', `Ré-analysé : ${nouveauxLots.length} lot(s) importé(s) au DCE.`)
        }
        docId = res.doc.id
      }
      d.lotsDce.push(...nouveauxLots.map((l) => ({ ...l, cctpDocumentId: docId })))
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
  const [apercu, setApercu] = useState<{
    lots: LotApercu[]
    source: 'analyse' | 'claude'
    fichierSource?: FichierSource
  } | null>(null)

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

  const ouvrirApercu = (
    lots: LotAnalyse[],
    source: 'analyse' | 'claude',
    fichier?: string,
    fichierSource?: FichierSource,
  ) => {
    const marches = state.marches.filter((m) => m.projetId === p.id)
    setApercu({
      source,
      fichierSource,
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
          chemin = (await rangerFichier(racine, p, DOSSIER_DCE, file, nomConforme(p, 'CCTP', '', file.name))).chemin
          await scanner()
        } catch {
          // rangement impossible (permission) : l'analyse reste valable
        }
      }
      ouvrirApercu(lots, 'analyse', chemin || file.name, {
        nomOriginal: file.name,
        chemin,
        empreinte: await empreinteSha256(file),
        taille: file.size,
        typeMime: file.type || undefined,
        source: cheminDrive ? 'drive' : 'depot',
      })
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
          fichierSource={apercu.fichierSource}
          onClose={() => setApercu(null)}
        />
      )}
    </Card>
  )
}

// ============================================================
// DPGF — les prix du DCE : import, aperçu validé, vue chiffrée
// ============================================================

interface DpgfApercu extends DpgfAnalyse {
  inclus: boolean
  /** lot DCE existant à chiffrer — '' = créer un nouveau lot */
  lotId: string
  fichier?: string
}

function ModalApercuDpgf({
  projet: p,
  lots,
  fichierSource,
  onClose,
}: {
  projet: Projet
  lots: DpgfApercu[]
  fichierSource?: FichierSource
  onClose: () => void
}) {
  const { state, update, replace } = useStore()
  const [liste, setListe] = useState<DpgfApercu[]>(lots)
  const lotsProjet = state.lotsDce.filter((l) => l.projetId === p.id)

  const maj = (i: number, champs: Partial<DpgfApercu>) =>
    setListe((prev) => prev.map((l, j) => (j === i ? { ...l, ...champs } : l)))

  const nbInclus = liste.filter((l) => l.inclus).length

  const importer = () => {
    const snap = state
    // calculé AVANT la mutation (le producteur du store peut être rejoué)
    const chiffrages: { lotId: string; dpgf: DpgfLot }[] = []
    const nouveauxLots: LotDCE[] = []
    const nouvellesTaches: TacheChantier[] = []
    const dejaAuPlanning = [...state.tachesChantier]
    let sansDate = false
    for (const l of liste) {
      if (!l.inclus || l.lignes.length === 0) continue
      const dpgf: DpgfLot = {
        fichier: l.fichier,
        importeLe: todayISO(),
        totalHT: l.totalHT ?? null,
        lignes: versLignes(l.lignes),
      }
      if (l.lotId) {
        chiffrages.push({ lotId: l.lotId, dpgf })
      } else {
        const lot: LotDCE = {
          id: uid('lotdce'),
          projetId: p.id,
          numero: numeroNormalise(l.numero),
          intitule: l.intitule.trim() || 'Lot sans intitulé',
          marcheId: rapprocherMarcheLot(
            { numero: l.numero, intitule: l.intitule },
            state.marches.filter((m) => m.projetId === p.id),
          )?.id || null,
          fichier: l.fichier,
          source: 'dpgf',
          importeLe: todayISO(),
          elements: elementsDepuisLignes(dpgf.lignes),
          dpgf,
        }
        nouveauxLots.push(lot)
        const res = genererTaches(p, lot, state.marches, dejaAuPlanning)
        nouvellesTaches.push(...res.taches)
        dejaAuPlanning.push(...res.taches)
        if (res.sansDate) sansDate = true
      }
    }
    const docPret = fichierSource ? documentDepuisSource(p, fichierSource, 'DPGF') : null
    update((d) => {
      // registre : clone → producteur rejouable ; dédoublonnage par empreinte
      let docId: string | null = null
      if (docPret) {
        const res = enregistrerDocument(d, structuredClone(docPret))
        if (res.doublon) {
          res.doc.statut = 'exploite'
          ajouterEvenement(res.doc, 'action', 'Ré-analysé : chiffrage DPGF ré-importé.')
        }
        docId = res.doc.id
      }
      for (const c of chiffrages) {
        const lot = d.lotsDce.find((x) => x.id === c.lotId)
        if (lot) lot.dpgf = { ...c.dpgf, documentId: docId }
      }
      d.lotsDce.push(
        ...nouveauxLots.map((l) => ({ ...l, dpgf: l.dpgf ? { ...l.dpgf, documentId: docId } : l.dpgf })),
      )
      d.tachesChantier.push(...nouvellesTaches)
    })
    const morceaux = [
      chiffrages.length > 0 ? `${chiffrages.length} lot(s) chiffré(s)` : '',
      nouveauxLots.length > 0 ? `${nouveauxLots.length} lot(s) créé(s)` : '',
      nouvellesTaches.length > 0 ? `${nouvellesTaches.length} tâche(s) au planning` : '',
    ].filter(Boolean)
    toast(
      `DPGF importée — ${morceaux.join(', ')}${sansDate ? ' (tâches « à dater » : datez le marché ou la phase DET puis « Replanifier »)' : ''}.`,
      { tone: 'ok', undo: () => replace(snap) },
    )
    onClose()
  }

  return (
    <Modal titre={`Aperçu DPGF — ${liste.length} lot(s) chiffré(s)`} onClose={onClose} large>
      <p className="small muted" style={{ marginTop: 0 }}>
        Relisez avant d'importer : rattachez chaque DPGF à son lot du DCE (le chiffrage s'ajoute au
        lot), ou laissez « créer un nouveau lot » — ses ouvrages entreront aussi au planning travaux.
      </p>
      {liste.map((l, i) => {
        const somme = sommeLignes(l.lignes)
        const ecart = l.totalHT != null ? somme - l.totalHT : null
        const cible = l.lotId ? lotsProjet.find((x) => x.id === l.lotId) : null
        return (
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
              <Field label="Lot du DCE à chiffrer" hint="« créer » dérive aussi les ouvrages du planning">
                <Select
                  value={l.lotId}
                  onChange={(v) => maj(i, { lotId: v })}
                  options={[
                    { value: '', label: '— créer un nouveau lot —' },
                    ...lotsProjet.map((x) => ({ value: x.id, label: libelleLot(x) })),
                  ]}
                />
              </Field>
            </div>
            <p className="small" style={{ margin: '4px 0' }}>
              <Badge tone="info">{l.lignes.length} ligne(s) · {fmtMoney(somme)}</Badge>{' '}
              {l.totalHT != null && (
                <Badge tone={ecart !== null && Math.abs(ecart) > 1 ? 'warn' : 'ok'}>
                  total document {fmtMoney(l.totalHT)}
                  {ecart !== null && Math.abs(ecart) > 1 ? ` · écart ${fmtMoney(ecart)}` : ' · cohérent'}
                </Badge>
              )}{' '}
              {cible?.dpgf && <Badge tone="warn">remplace la DPGF existante du lot</Badge>}
              {l.fichier && <span className="muted"> · source : {l.fichier}</span>}
            </p>
            <div style={{ maxHeight: 180, overflowY: 'auto', background: 'var(--bg-soft)', borderRadius: 4, padding: '6px 10px' }}>
              {l.lignes.map((x, j) => (
                <div key={j} className="small" style={{ padding: '2px 0' }}>
                  {x.article && <span className="mono muted">{x.article}</span>} {x.designation}
                  <span className="muted">
                    {x.unite ? ` · ${x.unite}` : ''}
                    {x.quantite != null ? ` · ${x.quantite}` : ''}
                    {x.prixUnitaireHT != null ? ` × ${fmtMoney(x.prixUnitaireHT, true)}` : ''}
                  </span>
                  {x.totalHT != null && <strong> = {fmtMoney(x.totalHT, true)}</strong>}
                </div>
              ))}
            </div>
          </div>
        )
      })}
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={importer} disabled={nbInclus === 0}>
          Importer {nbInclus} DPGF
        </Btn>
      </div>
    </Modal>
  )
}

/** vue chiffrée d'un lot : la DPGF formatée, comparée au document et au marché */
function ModalDpgf({ lot, onClose }: { lot: LotDCE; onClose: () => void }) {
  const { state, update, replace } = useStore()
  const courant = state.lotsDce.find((l) => l.id === lot.id) || lot
  const dpgf = courant.dpgf
  const marche = courant.marcheId ? state.marches.find((m) => m.id === courant.marcheId) : null

  if (!dpgf) return null
  const somme = sommeLignes(dpgf.lignes)
  const ecartDoc = dpgf.totalHT != null ? somme - dpgf.totalHT : null
  const montantMarche = marche ? marche.montantInitialHT + marche.avenantsHT : null
  const ecartMarche = montantMarche !== null ? montantMarche - somme : null

  const retirer = async () => {
    const snap = state
    if (!(await confirmer({ message: `Retirer la DPGF de « ${libelleLot(courant)} » ? (les éléments et tâches du lot sont conservés)`, danger: true, confirmerLabel: 'Retirer' }))) return
    update((d) => {
      const l = d.lotsDce.find((x) => x.id === lot.id)
      if (l) l.dpgf = null
    })
    toast('DPGF retirée.', { undo: () => replace(snap) })
    onClose()
  }

  return (
    <Modal titre={`DPGF — ${libelleLot(courant)}`} onClose={onClose} large>
      <p className="small" style={{ marginTop: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="info">{dpgf.lignes.length} ligne(s) · somme {fmtMoney(somme)}</Badge>
        {dpgf.totalHT != null && (
          <Badge tone={ecartDoc !== null && Math.abs(ecartDoc) > 1 ? 'warn' : 'ok'}>
            total document {fmtMoney(dpgf.totalHT)}
            {ecartDoc !== null && Math.abs(ecartDoc) > 1 ? ` · écart ${fmtMoney(ecartDoc)}` : ''}
          </Badge>
        )}
        {marche && montantMarche !== null && (
          <Badge tone={ecartMarche !== null && Math.abs(ecartMarche) > montantMarche * 0.05 ? 'warn' : 'muted'}>
            marché {marche.entreprise} : {fmtMoney(montantMarche)}
            {ecartMarche !== null ? ` (${ecartMarche >= 0 ? '+' : ''}${fmtMoney(ecartMarche)} vs DPGF)` : ''}
          </Badge>
        )}
        {dpgf.fichier && <span className="muted">source : {dpgf.fichier} · importée le {fmtDate(dpgf.importeLe)}</span>}
      </p>
      <Table
        compact
        head={[
          'Article',
          'Désignation',
          'U',
          <span key="q" className="right">Qté</span>,
          <span key="pu" className="right">PU HT</span>,
          <span key="t" className="right">Total HT</span>,
        ]}
      >
        {dpgf.lignes.map((x) => (
          <tr key={x.id}>
            <td className="mono small">{x.article || '—'}</td>
            <td>{x.designation}</td>
            <td className="small muted">{x.unite || ''}</td>
            <td className="right num">{x.quantite ?? ''}</td>
            <td className="right num">{x.prixUnitaireHT != null ? fmtMoney(x.prixUnitaireHT, true) : ''}</td>
            <td className="right num">{x.totalHT != null ? fmtMoney(x.totalHT, true) : ''}</td>
          </tr>
        ))}
        <tr style={{ fontWeight: 700 }}>
          <td colSpan={5}>Total des lignes</td>
          <td className="right num">{fmtMoney(somme, true)}</td>
        </tr>
      </Table>
      <div className="form-foot">
        <Btn kind="danger" onClick={() => void retirer()}>Retirer la DPGF</Btn>
        <span className="spacer" />
        <Btn onClick={onClose}>Fermer</Btn>
      </div>
    </Modal>
  )
}

function CarteDpgf({ projet: p }: { projet: Projet }) {
  const { state } = useStore()
  const [racine, setRacine] = useState<FSDirHandle | null>(null)
  const [fichiersDrive, setFichiersDrive] = useState<FSFileHandle[] | null>(null)
  const [permissionRequise, setPermissionRequise] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [message, setMessage] = useState('')
  const [rangerAuDrive, setRangerAuDrive] = useState(true)
  const [retourClaude, setRetourClaude] = useState('')
  const [apercu, setApercu] = useState<{ lots: DpgfApercu[]; fichierSource?: FichierSource } | null>(null)

  useEffect(() => {
    if (supporteFS) void lireRacine().then(setRacine)
  }, [])

  const slug = slugProjet(p)
  const scanner = useCallback(async () => {
    if (!racine) return
    try {
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

  const ouvrirApercu = (lots: DpgfAnalyse[], fichier?: string, fichierSource?: FichierSource) => {
    const lotsProjet = state.lotsDce.filter((l) => l.projetId === p.id)
    setApercu({
      fichierSource,
      lots: lots.map((l) => {
        // rattachement automatique au lot DCE de même numéro / intitulé
        const cible =
          lotsProjet.find((x) => l.numero && numeroNormalise(x.numero) === numeroNormalise(l.numero)) ||
          lotsProjet.find((x) => fold(x.intitule) === fold(l.intitule))
        return { ...l, inclus: true, lotId: cible?.id || '', fichier }
      }),
    })
  }

  const analyserFichier = async (file: File, cheminDrive?: string) => {
    setMessage('')
    setEnCours(true)
    try {
      let lots: DpgfAnalyse[]
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        lots = await analyserDpgfXlsx(file)
      } else {
        const texte = await extraireTexteFichier(file)
        lots = texte.length >= 200 ? analyserDpgfTexte(texte, file.name) : []
      }
      if (lots.length === 0) {
        setMessage(
          `« ${file.name} » : aucune ligne de prix détectée (scan, mise en page atypique ?) — passez par le secours Claude ci-dessous.`,
        )
        return
      }
      let chemin = cheminDrive
      if (!chemin && rangerAuDrive && racine) {
        try {
          chemin = (await rangerFichier(racine, p, DOSSIER_DCE, file, nomConforme(p, 'DPGF', '', file.name))).chemin
          await scanner()
        } catch {
          // rangement impossible (permission) : l'analyse reste valable
        }
      }
      ouvrirApercu(lots, chemin || file.name, {
        nomOriginal: file.name,
        chemin,
        empreinte: await empreinteSha256(file),
        taille: file.size,
        typeMime: file.type || undefined,
        source: cheminDrive ? 'drive' : 'depot',
      })
    } catch (e) {
      setMessage(`Analyse impossible : ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setEnCours(false)
    }
  }

  const analyserDrive = async (fh: FSFileHandle) => {
    try {
      const file = await fh.getFile()
      await analyserFichier(file, `${slug}/${DOSSIER_DCE}/${fh.name}`)
    } catch (e) {
      setMessage(`Lecture de « ${fh.name} » impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const analyserRetourClaude = () => {
    setMessage('')
    const { lots, erreur } = parseRetourDPGF(retourClaude)
    if (erreur || !lots) {
      setMessage(`Retour illisible : ${erreur}`)
      return
    }
    ouvrirApercu(lots)
  }

  const candidatsDrive = (fichiersDrive || []).filter((f) => /\.(xlsx|xls|pdf|txt)$/i.test(f.name))

  return (
    <Card titre="Lire une DPGF — les prix du DCE, récupérés et mis en forme">
      <div className="pill-note">
        Déposez les DPGF (Excel ou PDF, un lot par feuille ou un classeur complet) : le site détecte
        les colonnes (désignation, unité, quantité, PU, total), rattache chaque chiffrage à son lot du
        DCE et <strong>rapporte les montants sur le planning travaux</strong>. Contrôles intégrés :
        somme des lignes vs total du document, DPGF vs montant du marché signé.
      </div>

      {/* --- depuis le Drive du projet --- */}
      {supporteFS && racine && (
        <div style={{ marginTop: 12 }}>
          <strong className="small">Depuis le Drive du projet — {slug}/{DOSSIER_DCE}</strong>
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
              Aucun fichier Excel ou PDF dans {DOSSIER_DCE} — déposez-y les DPGF, le dossier du projet
              évolue avec le DCE.
            </p>
          ) : (
            <Table compact head={['Fichier', '']}>
              {candidatsDrive.map((f) => (
                <tr key={f.name}>
                  <td className="small mono">{f.name}</td>
                  <td className="right">
                    <Btn small kind="primary" disabled={enCours} onClick={() => void analyserDrive(f)}>
                      Analyser (DPGF)
                    </Btn>
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <Btn small kind="ghost" onClick={() => void scanner()}>Actualiser</Btn>
        </div>
      )}

      {/* --- fichier déposé --- */}
      <div className="form-row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
        <Field label="Ou déposer une DPGF (Excel ou PDF)">
          <input
            className="input"
            type="file"
            accept=".xlsx,.xls,.pdf,.txt"
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
        <summary className="small">Secours — DPGF scannée ou atypique : faire structurer par Claude</summary>
        <p className="small muted" style={{ margin: '8px 0 6px' }}>
          Copiez le prompt, collez-le dans un Projet Claude <strong>avec les fichiers DPGF joints</strong>,
          puis rapportez sa réponse ci-dessous : l'aperçu de relecture reste le même — rien n'entre
          sans validation humaine.
        </p>
        <div className="toolbar">
          <CopyBtn text={() => promptExtractionDPGF(p)} label="Copier le prompt d'extraction DPGF" />
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
        <ModalApercuDpgf
          projet={p}
          lots={apercu.lots}
          fichierSource={apercu.fichierSource}
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
  const [dpgfDe, setDpgfDe] = useState<LotDCE | null>(null)
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
        <Table compact head={['Lot', 'Éléments', 'Au planning', 'DPGF HT', 'Marché rattaché', 'Source', '']}>
          {lots.map((l) => (
            <tr key={l.id}>
              <td>
                <strong>{libelleLot(l)}</strong>
              </td>
              <td className="num">{l.elements.length}</td>
              <td className="num">{nbTaches(l.id)}</td>
              <td className="right">
                {l.dpgf ? (
                  <Btn small kind="ghost" onClick={() => setDpgfDe(l)} title="Voir la DPGF formatée">
                    {fmtMoney(sommeLignes(l.dpgf.lignes))}
                  </Btn>
                ) : (
                  <span className="muted small">—</span>
                )}
              </td>
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
                  <RowMenu
                    items={[
                      { label: 'Replanifier les tâches du lot', onClick: () => void replanifier(l) },
                      { label: 'Supprimer le lot', onClick: () => void supprimer(l), danger: true },
                    ]}
                  />
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
      {dpgfDe && <ModalDpgf lot={dpgfDe} onClose={() => setDpgfDe(null)} />}
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
      <CarteDpgf projet={projet} />
      <CarteLotsDCE projet={projet} />
    </>
  )
}
