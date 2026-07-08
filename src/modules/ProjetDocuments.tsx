// Onglet Documents — rangement RÉEL des fichiers, sans API Google :
// le site écrit dans le dossier « Google Drive pour ordinateur »
// (ou tout dossier local) via l'API File System Access du
// navigateur (Chrome / Edge). Dépôt → renommage automatique selon
// la nomenclature → rangement dans le bon sous-dossier ; le suivi
// des dossiers donne une lecture déterministe de l'avancement.

import { useCallback, useEffect, useState } from 'react'
import type { Projet } from '../types'
import { useStore } from '../store'
import { Badge, Btn, Card, EmptyState, Field, Select, Table, TextInput } from '../ui'
import { todayISO } from '../util'
import {
  choisirRacine as choisirRacineFS,
  lireRacine,
  nomConforme as nomConformeFS,
  rangerFichier,
  slugProjet,
  supporteFS,
  verifierPermission,
  type FSDirHandle,
} from '../fsdrive'

// ---------- arborescence normalisée de l'agence ----------

const ARBORESCENCE: { dossier: string; description: string; phases?: string[] }[] = [
  { dossier: '00_ADMIN', description: 'contrat, assurances, courriers officiels' },
  { dossier: '01_DIAG', description: 'diagnostics, relevés, existant', phases: ['DIAG'] },
  { dossier: '02_ESQ', description: 'esquisse', phases: ['ESQ'] },
  { dossier: '03_APS-APD_PC', description: 'avant-projets, dossier PC', phases: ['APS', 'APD'] },
  { dossier: '04_PRO-DCE', description: 'projet, CCTP, DCE', phases: ['PRO', 'ACT-DCE'] },
  { dossier: '05_ACT_MARCHES', description: 'offres, analyses, marchés signés', phases: ['ACT-DCE'] },
  { dossier: '06_EXE-VISA', description: 'plans EXE, visas', phases: ['VISA'] },
  { dossier: '07_CHANTIER', description: 'CR de chantier, situations, OS', phases: ['DET'] },
  { dossier: '08_AOR', description: 'réception, réserves, DOE', phases: ['AOR'] },
  { dossier: '09_FACTURES', description: 'factures émises et justificatifs' },
  { dossier: '10_PHOTOS', description: 'photos chantier et références' },
]

const TYPES_DOC = ['ADM', 'PC', 'CR', 'DCE', 'PLAN', 'FACT', 'DEVIS', 'PHOTO', 'MAIL', 'NOTE', 'CCTP', 'SITU']



interface EtatDossier {
  dossier: string
  nbFichiers: number
  dernier: string | null // nom du fichier le plus récent (préfixe date de la nomenclature)
}

export default function ProjetDocuments({ projet: p }: { projet: Projet }) {
  const { state } = useStore()
  const [racine, setRacine] = useState<FSDirHandle | null>(null)
  const [etat, setEtat] = useState<EtatDossier[] | null>(null)
  const [message, setMessage] = useState('')
  const [type, setType] = useState('CR')
  const [dossierCible, setDossierCible] = useState('07_CHANTIER')
  const [objet, setObjet] = useState('')
  const [fichier, setFichier] = useState<File | null>(null)

  useEffect(() => {
    void lireRacine().then(async (h) => {
      if (!h) return
      const perm = (await h.queryPermission?.({ mode: 'readwrite' })) || 'granted'
      if (perm === 'granted') setRacine(h)
      else setRacine(h) // la permission sera redemandée au premier accès
    })
  }, [])

  const scanner = useCallback(async (h: FSDirHandle) => {
    try {
      if (!(await verifierPermission(h))) {
        setMessage('Accès au dossier refusé.')
        return
      }
      const dossierProjet = await h.getDirectoryHandle(slugProjet(p), { create: false }).catch(() => null)
      if (!dossierProjet) {
        setEtat([])
        return
      }
      const resultats: EtatDossier[] = []
      for (const a of ARBORESCENCE) {
        const sous = await dossierProjet.getDirectoryHandle(a.dossier, { create: false }).catch(() => null)
        if (!sous) {
          resultats.push({ dossier: a.dossier, nbFichiers: -1, dernier: null })
          continue
        }
        let nb = 0
        let dernier: string | null = null
        for await (const entree of sous.values()) {
          if (entree.kind === 'file') {
            nb++
            if (!dernier || entree.name > dernier) dernier = entree.name
          }
        }
        resultats.push({ dossier: a.dossier, nbFichiers: nb, dernier })
      }
      setEtat(resultats)
    } catch (e) {
      setMessage(`Lecture impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [p])

  useEffect(() => {
    if (racine) void scanner(racine)
  }, [racine, scanner])

  const choisirRacine = async () => {
    const h = await choisirRacineFS()
    if (h) {
      setRacine(h)
      setMessage('')
    }
  }

  const creerArborescence = async () => {
    if (!racine) return
    try {
      const dossierProjet = await racine.getDirectoryHandle(slugProjet(p), { create: true })
      for (const a of ARBORESCENCE) await dossierProjet.getDirectoryHandle(a.dossier, { create: true })
      setMessage(`Arborescence créée dans ${racine.name}/${slugProjet(p)}.`)
      await scanner(racine)
    } catch (e) {
      setMessage(`Création impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const nomConforme = (f: File): string => nomConformeFS(p, type, objet, f.name)

  const deposer = async () => {
    if (!racine || !fichier) return
    try {
      const chemin = await rangerFichier(racine, p, dossierCible, fichier, nomConforme(fichier))
      setMessage(`Rangé : ${chemin}`)
      setFichier(null)
      setObjet('')
      await scanner(racine)
    } catch (e) {
      setMessage(`Dépôt impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // lecture déterministe de l'avancement : dossier au fichier le plus récent
  const actif = etat
    ?.filter((x) => x.nbFichiers > 0 && x.dernier)
    .sort((a, b) => (b.dernier || '').localeCompare(a.dernier || ''))[0]

  if (!supporteFS) {
    return (
      <Card titre="Documents du projet">
        <div className="pill-note">
          Le rangement automatique nécessite Chrome ou Edge (API File System Access). En attendant :
          utilisez le générateur de noms du module <a href="#/classement">Classement</a> et le dossier
          Drive du projet (onglet Ressources).
        </div>
      </Card>
    )
  }

  return (
    <>
      <Card
        titre="Documents — rangement automatique dans le Drive"
        actions={
          racine ? (
            <>
              <Badge tone="ok">racine : {racine.name}</Badge>
              <Btn small onClick={choisirRacine}>Changer</Btn>
            </>
          ) : undefined
        }
      >
        <p className="small muted" style={{ marginBottom: 10 }}>
          Choisissez une fois le dossier <strong>« Google Drive » synchronisé sur l'ordinateur</strong>{' '}
          (Drive pour ordinateur) — le site y range alors réellement les fichiers, nommés à la
          nomenclature, dans l'arborescence du projet. Drive synchronise ensuite tout seul. Aucune API
          Google, aucun envoi : tout se passe entre le navigateur et le disque.
        </p>
        {!racine ? (
          <Btn kind="primary" onClick={choisirRacine}>
            Choisir le dossier racine (Drive pour ordinateur)
          </Btn>
        ) : (
          <>
            <div className="toolbar">
              <Btn onClick={creerArborescence}>Créer / compléter l'arborescence {slugProjet(p)}</Btn>
              <Btn kind="ghost" small onClick={() => racine && scanner(racine)}>
                Actualiser
              </Btn>
            </div>

            <div className="form-row" style={{ marginTop: 8 }}>
              <Field label="Fichier à ranger">
                <input
                  className="input"
                  type="file"
                  onChange={(e) => setFichier(e.target.files?.[0] || null)}
                />
              </Field>
              <Field label="Type">
                <Select value={type} onChange={setType} options={TYPES_DOC.map((t) => ({ value: t, label: t }))} />
              </Field>
              <Field label="Sous-dossier">
                <Select
                  value={dossierCible}
                  onChange={setDossierCible}
                  options={ARBORESCENCE.map((a) => ({ value: a.dossier, label: a.dossier }))}
                />
              </Field>
              <Field label="Objet (optionnel)" hint="sinon le nom du fichier est repris">
                <TextInput value={objet} onChange={setObjet} placeholder="cr-reunion-12" />
              </Field>
            </div>
            {fichier && (
              <p className="small" style={{ margin: '6px 0' }}>
                Sera rangé sous : <code>{slugProjet(p)}/{dossierCible}/{nomConforme(fichier)}</code>
              </p>
            )}
            <div className="form-foot">
              <Btn kind="primary" onClick={deposer} disabled={!fichier}>
                Ranger dans le Drive
              </Btn>
            </div>
          </>
        )}
        {message && <p className="small" style={{ marginTop: 8 }}>{message}</p>}
      </Card>

      {racine && etat && (
        <Card
          titre="État du dossier projet (lu depuis le Drive)"
          actions={
            actif ? (
              <Badge tone="info">
                activité récente : {actif.dossier}
              </Badge>
            ) : undefined
          }
        >
          {etat.length === 0 ? (
            <EmptyState>
              Le dossier {slugProjet(p)} n'existe pas encore — « Créer l'arborescence » ci-dessus.
            </EmptyState>
          ) : (
            <Table compact head={['Dossier', 'Contenu', 'Fichiers', 'Dernier fichier']}>
              {ARBORESCENCE.map((a) => {
                const e = etat.find((x) => x.dossier === a.dossier)
                return (
                  <tr key={a.dossier}>
                    <td style={{ width: 170 }}>
                      <strong>{a.dossier}</strong>
                    </td>
                    <td className="muted small">{a.description}</td>
                    <td className="right" style={{ width: 130 }}>
                      {!e || e.nbFichiers < 0 ? (
                        <Badge tone="muted">absent</Badge>
                      ) : e.nbFichiers === 0 ? (
                        <Badge tone="muted">vide</Badge>
                      ) : (
                        <Badge tone="ok">{e.nbFichiers} fichier{e.nbFichiers > 1 ? 's' : ''}</Badge>
                      )}
                    </td>
                    <td className="small muted" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e?.dernier || ''}
                    </td>
                  </tr>
                )
              })}
            </Table>
          )}
          <p className="muted small" style={{ marginTop: 8 }}>
            Lecture 100 % déterministe : le dossier le plus récemment alimenté indique où en est le projet
            (la nomenclature datée AAAAMMJJ fait le tri). Les CR diffusés vont dans 07_CHANTIER, les
            factures PDF dans 09_FACTURES.
          </p>
        </Card>
      )}
    </>
  )
}
