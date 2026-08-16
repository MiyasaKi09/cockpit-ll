// Onglet Documents — rangement RÉEL des fichiers, sans API Google :
// le site écrit dans le dossier « Google Drive pour ordinateur »
// (ou tout dossier local) via l'API File System Access du
// navigateur (Chrome / Edge). Dépôt → renommage automatique selon
// la nomenclature → rangement dans le bon sous-dossier ; le suivi
// des dossiers donne une lecture déterministe de l'avancement.
//
// TRANCHE 3 DE LA REFONTE (docs/REFONTE_NAVIGATION.md §2.2, §3.2, §5).
// LE REGISTRE DOCUMENTAIRE A REJOINT LE PROJET, ET C'EST ICI.
//
// « Tous les documents » était un onglet de la destination Documents : le
// registre du projet avec un sélecteur de projet devant, qu'on réglait
// toujours sur le même projet — la signature du morceau exilé. L'onglet
// disparaît ; sa carte est MONTÉE ici, restreinte à ce chantier.
//
// Aucun onglet n'est ajouté pour l'accueillir : cette vue est déjà celle du
// sous-onglet « Tous les documents » de la fiche projet, et le plan exige d'en
// retirer, pas d'en ajouter.
//
// Ce qui disparaît AUSSI : `CarteRegistreProjet`, la carte que ce fichier
// portait en propre. C'était un second registre — même table, mais sans
// recherche, sans filtre catégorie/phase, sans bouton « Ouvrir » et sans
// fiche —, donc deux réponses possibles à « qu'a-t-on reçu sur ce chantier ».
// On monte désormais LA carte du registre (`CarteTous`, src/modules/
// Documents.tsx), avec tous ses gestes.

import { useCallback, useEffect, useState } from 'react'
import type { PhaseCode, Projet } from '../types'
import { useStore } from '../store'
import { useMoi } from '../moi'
import { Badge, Btn, Card, EmptyState, Field, Select, Table, TextInput } from '../ui'
import {
  CATEGORIES_DOC,
  DOSSIER_PAR_CATEGORIE,
  chercherDoublon,
  classerFichier,
  creerDocument,
  enregistrerDocument,
  type PropositionClassement,
} from '../registre'
import { LIBELLES_PHASES, PHASES_ORDRE } from '../miqcp'
// TRANCHE 3 — LE registre, importé : une seule table, un seul « Ouvrir », une
// seule fiche de document. Le `projetId` fait le périmètre, et le sélecteur de
// projet du registre transverse disparaît puisqu'on est dans le projet.
import { CarteTous } from './Documents'
import {
  ARBORESCENCE,
  choisirRacine as choisirRacineFS,
  creerArborescenceProjet,
  lireRacine,
  nomConforme as nomConformeFS,
  phaseDuDossier,
  rangerFichier,
  slugProjet,
  supporteFS,
  verifierPermission,
  type FSDirHandle,
} from '../fsdrive'

// Les catégories viennent de `CATEGORIES_DOC` (registre.ts) : la liste
// recopiée qui vivait ici (`TYPES_DOC`) en avait DIVERGÉ — ni DPGF, ni
// AUTRE — si bien que la même pièce déposée ici ou dans la boîte
// d'arrivée n'était pas classée pareil (R3). Les libellés se composent
// des mêmes autorités : la catégorie dit où elle range, le sous-dossier
// dit ce qu'il contient.
const OPTIONS_CATEGORIE = CATEGORIES_DOC.map((c) => ({
  value: c as string,
  label: `${c} → ${DOSSIER_PAR_CATEGORIE[c] || '00_ADMIN'}`,
}))

const OPTIONS_DOSSIER = ARBORESCENCE.map((a) => ({
  value: a.dossier,
  label: `${a.dossier} — ${a.description}`,
}))

const OPTIONS_PHASE = [
  { value: '', label: '— aucune —' },
  ...PHASES_ORDRE.map((c) => ({ value: c as string, label: `${c} — ${LIBELLES_PHASES[c]}` })),
]



interface EtatDossier {
  dossier: string
  nbFichiers: number
  dernier: string | null // nom du fichier le plus récent (préfixe date de la nomenclature)
}

export default function ProjetDocuments({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  // qui dépose : renseigné seulement si l'application sait qui est là
  const moi = useMoi()
  const [racine, setRacine] = useState<FSDirHandle | null>(null)
  const [etat, setEtat] = useState<EtatDossier[] | null>(null)
  const [message, setMessage] = useState('')
  const [categorie, setCategorie] = useState('CR')
  const [dossierCible, setDossierCible] = useState('07_CHANTIER')
  const [phase, setPhase] = useState('')
  const [objet, setObjet] = useState('')
  const [fichier, setFichier] = useState<File | null>(null)
  /** ce que le moteur de classement a proposé pour CE fichier (et pourquoi) */
  const [proposition, setProposition] = useState<PropositionClassement | null>(null)

  /**
   * Dépôt : le moteur PROPOSE, vous tranchez. C'est le même
   * `classerFichier` que la boîte d'arrivée — sans lui, cet écran
   * faisait tout retaper alors que le nom du fichier suffisait presque
   * toujours (R6). Le projet, lui, ne se propose pas : on est dans son
   * onglet.
   */
  const choisirFichier = (f: File | null) => {
    setFichier(f)
    if (!f) {
      setProposition(null)
      return
    }
    const prop = classerFichier(state, f.name, { typeMime: f.type || undefined })
    const dossier = DOSSIER_PAR_CATEGORIE[prop.categorie] || dossierCible
    setProposition(prop)
    setCategorie(prop.categorie)
    setDossierCible(dossier)
    setPhase(phaseDuDossier(dossier) || '')
  }

  /** la catégorie entraîne le sous-dossier, le sous-dossier entraîne la
   *  phase — une seule correspondance, celle d'`ARBORESCENCE` */
  const choisirCategorie = (v: string) => {
    const dossier = DOSSIER_PAR_CATEGORIE[v] || dossierCible
    setCategorie(v)
    setDossierCible(dossier)
    setPhase(phaseDuDossier(dossier) || '')
  }

  const choisirDossier = (v: string) => {
    setDossierCible(v)
    setPhase(phaseDuDossier(v) || '')
  }

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

  // même fonction que celle appelée à la fin de l'assistant « Nouveau
  // projet » : l'arborescence ne se crée qu'à un seul endroit du code.
  const creerArborescence = async () => {
    if (!racine) return
    try {
      const r = await creerArborescenceProjet(racine, p)
      setMessage(
        r.crees.length === 0
          ? `Arborescence déjà complète dans ${racine.name}/${r.dossierProjet} — rien à créer.`
          : `Arborescence complétée dans ${racine.name}/${r.dossierProjet} : ${r.crees.length} dossier(s) ajouté(s).`,
      )
      await scanner(racine)
    } catch (e) {
      setMessage(`Création impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const nomConforme = (f: File): string => nomConformeFS(p, categorie, objet, f.name)

  const deposer = async () => {
    if (!racine || !fichier) return
    try {
      const r = await rangerFichier(racine, p, dossierCible, fichier, nomConforme(fichier))
      // registre documentaire : dédoublonnage calculé AVANT la mutation
      const dejaConnu = Boolean(chercherDoublon(state, r.empreinte))
      const doc = creerDocument({
        titre: r.nomFinal,
        nomOriginal: fichier.name,
        source: 'depot',
        categorie,
        typeMime: fichier.type || undefined,
        taille: fichier.size,
        empreinteSha256: r.empreinte || undefined,
        cheminDrive: r.chemin,
        projetId: p.id,
        phase: phase ? (phase as PhaseCode) : null,
        // qui dépose ; vide si l'application ne sait pas qui est là
        auteur: moi.nom || undefined,
        confiance: proposition?.confiance ?? null,
        raisons: proposition?.raisons,
        statut: 'classe', // catégorie + dossier confirmés à la main
      })
      update((d) => {
        enregistrerDocument(d, doc)
      })
      setMessage(
        r.dejaPresent
          ? `Déjà dans le Drive à l'identique : ${r.chemin} — rien n'a été réécrit.`
          : r.version > 1
            ? `Rangé en nouvelle version : ${r.chemin} (un fichier du même nom au contenu différent existait déjà).`
            : `Rangé : ${r.chemin}${dejaConnu ? ' — document déjà connu du registre, pas de doublon créé.' : ' — ajouté au registre des documents.'}`,
      )
      setFichier(null)
      setObjet('')
      setProposition(null)
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
    // le rangement ne marche pas sur ce navigateur ; LE REGISTRE, lui, se lit
    // partout — le priver de sa lecture parce que le dépôt est indisponible
    // serait perdre l'endroit qu'on vient tout juste de lui donner
    return (
      <>
        <Card titre="Documents du projet">
          <div className="pill-note">
            Le rangement automatique nécessite Chrome ou Edge (API File System Access). En attendant :
            déposez les fichiers dans la <a href="#/documents">boîte d'arrivée</a> (le nom conforme est
            proposé) et rangez-les via le dossier Drive du projet (onglet Ressources).
          </div>
        </Card>
        <CarteTous projetId={p.id} />
      </>
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
              <Field label="Fichier à ranger" hint="la catégorie et la phase sont proposées d’après le nom">
                <input
                  className="input"
                  type="file"
                  onChange={(e) => choisirFichier(e.target.files?.[0] || null)}
                />
              </Field>
              <Field label="Catégorie">
                <Select value={categorie} onChange={choisirCategorie} options={OPTIONS_CATEGORIE} />
              </Field>
              <Field label="Sous-dossier">
                <Select value={dossierCible} onChange={choisirDossier} options={OPTIONS_DOSSIER} />
              </Field>
              <Field label="Phase" hint="proposée d’après le sous-dossier">
                <Select value={phase} onChange={setPhase} options={OPTIONS_PHASE} />
              </Field>
              <Field label="Objet (optionnel)" hint="sinon le nom du fichier est repris">
                <TextInput value={objet} onChange={setObjet} placeholder="cr-reunion-12" />
              </Field>
            </div>
            {fichier && proposition && proposition.raisons.length > 0 && (
              <details className="small" style={{ margin: '6px 0' }}>
                <summary>Voir pourquoi cette proposition</summary>
                <ul style={{ margin: '4px 0 0 18px' }}>
                  {proposition.raisons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </details>
            )}
            {fichier && proposition?.projetId && proposition.projetId !== p.id && (
              <p className="small warn-text" style={{ margin: '6px 0' }}>
                Ce fichier semble concerner {proposition.projetId} — vous êtes dans {p.id}.
              </p>
            )}
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

      {/* LE registre, restreint à ce chantier. Chaque import (CCTP, DPGF, CR,
          photo, dépôt) y laisse une entrée traçable — cherchable, filtrable par
          catégorie et par phase, ouvrable dans le Drive, et dont la fiche dit
          la source, la version et qui a validé. */}
      <CarteTous projetId={p.id} />
    </>
  )
}
