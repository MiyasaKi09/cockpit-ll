// Onglet Chantier de l'espace projet : marchés de travaux +
// réunions de chantier avec l'assistant CR (audio → transcription
// sans API → CR au style de l'agence → relecture → diffusion).

import { useEffect, useRef, useState } from 'react'
import type { MarcheTravaux, Projet, ReunionChantier, StatutReunion } from '../types'
import { useStore } from '../store'
import { assemble, contexteProjet } from '../prompts'
import {
  Badge,
  Btn,
  Card,
  CopyBtn,
  EmptyState,
  DateInput,
  Field,
  Modal,
  Money,
  NumInput,
  PctInput,
  Select,
  Table,
  TextArea,
  TextInput,
  confirmer,
  toast, RowMenu } from '../ui'
import type { Tone } from '../ui'
import { fmtDate, fmtMoney, fmtPct, todayISO, uid } from '../util'
import { MODELES_WHISPER, transcrireFichier, type ProgresTranscription } from '../transcription'
import { CONTRAT_CR, genererDocxCR, parseRetourCR, retourVersTexte } from '../crdocx'
import { lireRacine, nomConforme, rangerFichier, supporteFS, type ResultatRangement } from '../fsdrive'
import { creerDocument, empreinteSha256, enregistrerDocument, remplacerDocument } from '../registre'
import { copier } from '../prompts'

// ============================================================
// Marchés de travaux
// ============================================================

export function CarteMarches({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const [modal, setModal] = useState<{ marche?: MarcheTravaux } | null>(null)

  const marches = state.marches.filter((m) => m.projetId === p.id)

  const supprimer = async (m: MarcheTravaux) => {
    const snap = state
    const nbSits = state.situations.filter((s) => s.marcheId === m.id).length
    const question =
      nbSits > 0
        ? `Supprimer le marché « ${m.lot} — ${m.entreprise} » ?\n${nbSits} situation(s) y sont rattachées : elles seront conservées mais détachées du marché.`
        : `Supprimer le marché « ${m.lot} — ${m.entreprise} » ?`
    if (!(await confirmer({ message: question, danger: true, confirmerLabel: 'Supprimer' }))) return
    update((d) => {
      d.marches = d.marches.filter((x) => x.id !== m.id)
      for (const s of d.situations) if (s.marcheId === m.id) s.marcheId = null
      // les lots DCE et tâches du planning travaux se détachent aussi
      for (const l of d.lotsDce) if (l.marcheId === m.id) l.marcheId = null
      for (const t of d.tachesChantier) if (t.marcheId === m.id) t.marcheId = null
    })
    toast('Marché supprimé.', { undo: () => replace(snap) })
  }

  return (
    <Card
      titre="Marchés de travaux"
      actions={
        <>
          <a href="#/situations" className="small">Situations de travaux →</a>
          <Btn small kind="primary" onClick={() => setModal({})}>Ajouter un marché</Btn>
        </>
      }
    >
      {marches.length === 0 ? (
        <EmptyState>
          Aucun marché — ajoutez chaque lot à la signature : c'est le support du suivi des situations,
          des relances et des CR.
        </EmptyState>
      ) : (
        <Table
          compact
          head={[
            'Lot',
            'Entreprise',
            <span key="m" className="right">Montant HT (avenants inclus)</span>,
            'RG',
            'Révision',
            'Intervention',
            'Chantier',
            'Contact',
            'Délai vérif.',
            '',
          ]}
        >
          {marches.map((m) => (
            <tr key={m.id}>
              <td><strong>{m.lot}</strong></td>
              <td>
                {m.entreprise}
                {m.notes && <div className="muted small">{m.notes}</div>}
              </td>
              <td className="right">
                <Money v={m.montantInitialHT + m.avenantsHT} />
                {m.avenantsHT !== 0 && (
                  <div className="muted small">dont avenants {fmtMoney(m.avenantsHT)}</div>
                )}
              </td>
              <td className="num">{fmtPct(m.tauxRG, 0)}</td>
              <td>{m.revision ? 'oui' : '—'}</td>
              <td className="small">
                {m.dateDebut || m.dateFin ? (
                  <>{m.dateDebut ? fmtDate(m.dateDebut) : '?'} → {m.dateFin ? fmtDate(m.dateFin) : '?'}</>
                ) : (
                  <a href="#/planning" className="muted">à planifier</a>
                )}
              </td>
              <td>{m.actif ? <Badge tone="ok">en cours</Badge> : <span className="muted">—</span>}</td>
              <td className="small">
                {m.contactNom || <span className="muted">—</span>}
                {m.contactEmail && <div className="muted">{m.contactEmail}</div>}
              </td>
              <td className="num">{m.delaiVerifJours} j</td>
              <td className="right">
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <Btn small onClick={() => setModal({ marche: m })}>Modifier</Btn>
                  <RowMenu items={[{ label: 'Supprimer le marché', onClick: () => supprimer(m), danger: true }]} />
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {modal && <ModalMarche projetId={p.id} marche={modal.marche} onClose={() => setModal(null)} />}
    </Card>
  )
}

function ModalMarche({
  projetId,
  marche,
  onClose,
}: {
  projetId: string
  marche?: MarcheTravaux
  onClose: () => void
}) {
  const { update } = useStore()
  const creation = !marche

  const [lot, setLot] = useState(marche?.lot || '')
  const [entreprise, setEntreprise] = useState(marche?.entreprise || '')
  const [montantInitial, setMontantInitial] = useState<number | null>(marche?.montantInitialHT ?? null)
  const [avenants, setAvenants] = useState<number | null>(marche?.avenantsHT ?? 0)
  const [tauxRG, setTauxRG] = useState<number | null>(marche?.tauxRG ?? 0.05)
  const [revision, setRevision] = useState(marche?.revision ? 'oui' : 'non')
  const [delaiVerif, setDelaiVerif] = useState<number | null>(marche?.delaiVerifJours ?? 15)
  const [contactNom, setContactNom] = useState(marche?.contactNom || '')
  const [contactEmail, setContactEmail] = useState(marche?.contactEmail || '')
  const [actif, setActif] = useState(marche?.actif ? 'oui' : 'non')
  const [dateDebut, setDateDebut] = useState<string | null>(marche?.dateDebut ?? null)
  const [dateFin, setDateFin] = useState<string | null>(marche?.dateFin ?? null)
  const [notes, setNotes] = useState(marche?.notes || '')

  const valide = lot.trim() !== '' && entreprise.trim() !== ''

  const enregistrer = () => {
    if (!valide) return
    update((d) => {
      const champs = {
        lot: lot.trim(),
        entreprise: entreprise.trim(),
        montantInitialHT: montantInitial ?? 0,
        avenantsHT: avenants ?? 0,
        tauxRG: tauxRG ?? 0.05,
        revision: revision === 'oui',
        delaiVerifJours: delaiVerif ?? 15,
        contactNom: contactNom.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        actif: actif === 'oui',
        dateDebut,
        dateFin,
        notes: notes.trim() || undefined,
      }
      if (creation) {
        d.marches.push({ id: uid('marche'), projetId, ...champs })
      } else {
        const m = d.marches.find((x) => x.id === marche.id)
        if (m) Object.assign(m, champs)
      }
    })
    onClose()
  }

  return (
    <Modal titre={creation ? 'Nouveau marché de travaux' : `Modifier ${marche.lot}`} onClose={onClose}>
      <div className="form-row">
        <Field label="Lot">
          <TextInput value={lot} onChange={setLot} placeholder="Ex. Lot 01 — Gros œuvre" />
        </Field>
        <Field label="Entreprise">
          <TextInput value={entreprise} onChange={setEntreprise} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Montant initial HT (€)">
          <NumInput value={montantInitial} onChange={setMontantInitial} />
        </Field>
        <Field label="Avenants HT (€)">
          <NumInput value={avenants} onChange={setAvenants} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Retenue de garantie" hint="5 % par défaut sur les marchés publics">
          <PctInput value={tauxRG} onChange={setTauxRG} ariaLabel="Taux de retenue de garantie en pourcentage" />
        </Field>
        <Field label="Révision de prix">
          <Select
            value={revision}
            onChange={setRevision}
            options={[{ value: 'non', label: 'Non' }, { value: 'oui', label: 'Oui' }]}
          />
        </Field>
        <Field label="Délai de vérification (j)" hint="Délai contractuel MOE sur les situations.">
          <NumInput value={delaiVerif} onChange={setDelaiVerif} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Contact">
          <TextInput value={contactNom} onChange={setContactNom} />
        </Field>
        <Field label="E-mail du contact">
          <TextInput value={contactEmail} onChange={setContactEmail} />
        </Field>
        <Field label="Chantier en cours" hint="Oui = une situation mensuelle est attendue.">
          <Select
            value={actif}
            onChange={setActif}
            options={[{ value: 'non', label: 'Non' }, { value: 'oui', label: 'Oui' }]}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Intervention chantier — début" hint="alimente le planning travaux">
          <DateInput value={dateDebut} onChange={setDateDebut} />
        </Field>
        <Field label="Intervention chantier — fin">
          <DateInput value={dateFin} onChange={setDateFin} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Notes">
          <TextArea value={notes} onChange={setNotes} rows={2} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer} disabled={!valide}>
          {creation ? 'Ajouter le marché' : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  )
}

// ============================================================
// Réunions de chantier & assistant CR
// ============================================================

const LIBELLE_STATUT: Record<StatutReunion, { label: string; tone: Tone }> = {
  a_preparer: { label: 'à venir', tone: 'muted' },
  cr_a_generer: { label: 'CR à générer', tone: 'warn' },
  cr_a_relire: { label: 'CR à relire', tone: 'warn' },
  diffuse: { label: 'CR diffusé', tone: 'ok' },
}

function participantsParDefaut(state: ReturnType<typeof useStore>['state'], p: Projet): string {
  const lignes = [
    `MOE : ${state.settings.nomAgence} (${state.settings.personnes.join(', ')})`,
    p.moa ? `MOA : ${p.moa}` : null,
    ...state.marches
      .filter((m) => m.projetId === p.id)
      .map((m) => `${m.lot} : ${m.entreprise}${m.contactNom ? ` (${m.contactNom})` : ''}`),
  ]
  return lignes.filter(Boolean).join('\n')
}

export function CarteReunions({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const [assistant, setAssistant] = useState<{ reunion: ReunionChantier; fichier?: File } | null>(null)
  const [reprog, setReprog] = useState<ReunionChantier | null>(null)
  const [lectureCR, setLectureCR] = useState<ReunionChantier | null>(null)

  const reunions = state.reunions
    .filter((r) => r.projetId === p.id)
    .sort((a, b) => b.date.localeCompare(a.date))

  const creer = (fichier?: File) => {
    const n = reunions.length + 1
    const reunion: ReunionChantier = {
      id: uid('reu'),
      projetId: p.id,
      date: todayISO(),
      heure: '14:00',
      titre: `Réunion de chantier n°${n}`,
      participants: participantsParDefaut(state, p),
      statut: 'cr_a_generer',
    }
    update((d) => {
      d.reunions.push(reunion)
    })
    setAssistant({ reunion, fichier })
  }

  return (
    <Card
      titre="Réunions de chantier & comptes-rendus"
      actions={
        <>
          <label className="btn btn-small btn-primary" style={{ cursor: 'pointer' }}>
            🎙 Déposer l'enregistrement
            <input
              type="file"
              accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) creer(f)
                e.target.value = ''
              }}
            />
          </label>
          <Btn small onClick={() => creer()}>Nouvelle réunion</Btn>
        </>
      }
    >
      {reunions.length === 0 ? (
        <EmptyState>
          Après chaque réunion, un seul geste : « 🎙 Déposer l'enregistrement » — la réunion se crée, la
          transcription démarre, le prompt se copie tout seul, et le DOCX final part dans le Drive.
        </EmptyState>
      ) : (
        <Table compact head={['Réunion', 'Quand', 'Statut', 'CR', '']}>
          {reunions.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.titre}</strong>
                {r.notes && <div className="muted small">{r.notes}</div>}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {fmtDate(r.date)}
                {r.heure && <span className="mono"> · {r.heure}</span>}
              </td>
              <td><Badge tone={LIBELLE_STATUT[r.statut].tone}>{LIBELLE_STATUT[r.statut].label}</Badge></td>
              <td>
                {r.cr ? (
                  <Btn small kind="ghost" onClick={() => setLectureCR(r)}>Voir le CR</Btn>
                ) : (
                  <span className="muted small">—</span>
                )}
              </td>
              <td className="right">
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Btn small onClick={() => setReprog(r)} title="Changer la date ou l'heure en un geste">
                    Reprogrammer
                  </Btn>
                  <Btn small kind={r.statut === 'diffuse' ? 'default' : 'primary'} onClick={() => setAssistant({ reunion: r })}>
                    {r.statut === 'diffuse' ? 'Rouvrir' : 'Assistant CR'}
                  </Btn>
                  <Btn
                    small
                    kind="danger"
                    onClick={async () => {
                      const snap = state
                      if (await confirmer({ message: `Supprimer « ${r.titre} » ?`, danger: true, confirmerLabel: 'Supprimer' })) {
                        update((d) => {
                          d.reunions = d.reunions.filter((x) => x.id !== r.id)
                        })
                        toast('Réunion supprimée.', { undo: () => replace(snap) })
                      }
                    }}
                  >
                    Suppr.
                  </Btn>
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {assistant && (
        <AssistantCR
          projet={p}
          reunion={state.reunions.find((r) => r.id === assistant.reunion.id) || assistant.reunion}
          fichierInitial={assistant.fichier}
          onClose={() => setAssistant(null)}
        />
      )}
      {reprog && <ModalReprogrammation reunion={reprog} onClose={() => setReprog(null)} />}
      {lectureCR && (
        <ModalCR
          reunion={state.reunions.find((r) => r.id === lectureCR.id) || lectureCR}
          onClose={() => setLectureCR(null)}
        />
      )}
    </Card>
  )
}

/** reprogrammation « dernière minute » : date + heure, rien d'autre */
function ModalReprogrammation({ reunion, onClose }: { reunion: ReunionChantier; onClose: () => void }) {
  const { update } = useStore()
  const [date, setDate] = useState<string | null>(reunion.date)
  const [heure, setHeure] = useState(reunion.heure || '')

  const enregistrer = () => {
    if (!date) return toast('Indiquer la date.', { tone: 'danger' })
    update((d) => {
      const r = d.reunions.find((x) => x.id === reunion.id)
      if (!r) return
      r.date = date
      r.heure = heure || undefined
    })
    toast(`« ${reunion.titre} » reprogrammée au ${fmtDate(date)}${heure ? ` à ${heure}` : ''}.`, { tone: 'ok' })
    onClose()
  }

  return (
    <Modal titre={`Reprogrammer — ${reunion.titre}`} onClose={onClose}>
      <div className="form-row">
        <Field label="Date">
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label="Heure">
          <input className="input" type="time" value={heure} onChange={(e) => setHeure(e.target.value)} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer}>Reprogrammer</Btn>
      </div>
    </Modal>
  )
}

/** le CR vit sur la réunion : lisible, corrigeable, copiable — jamais perdu */
function ModalCR({ reunion, onClose }: { reunion: ReunionChantier; onClose: () => void }) {
  const { update } = useStore()
  const [texte, setTexte] = useState(reunion.cr || '')

  const enregistrer = () => {
    update((d) => {
      const r = d.reunions.find((x) => x.id === reunion.id)
      if (r) r.cr = texte.trim() || undefined
    })
    toast('CR enregistré sur la réunion.', { tone: 'ok' })
    onClose()
  }

  return (
    <Modal titre={`CR — ${reunion.titre} (${fmtDate(reunion.date)}${reunion.heure ? ` · ${reunion.heure}` : ''})`} onClose={onClose} large>
      <TextArea rows={16} mono value={texte} onChange={setTexte} />
      <div className="form-foot">
        <CopyBtn text={() => texte} label="Copier le CR" kind="default" />
        <span className="spacer" />
        <Btn onClick={onClose}>Fermer</Btn>
        <Btn kind="primary" onClick={enregistrer}>Enregistrer</Btn>
      </div>
    </Modal>
  )
}

/** Assistant CR — 4 étapes guidées, de l'audio au CR diffusé */

/** le circuit CR en 4 étapes lisibles — dérivé du statut persistant de la
 *  réunion : fermer et rouvrir la modale reprend exactement où on en était */
function EtapesCR({ statut }: { statut: StatutReunion }) {
  const etapes: { id: StatutReunion; label: string }[] = [
    { id: 'a_preparer', label: '1 · Réunion & convocation' },
    { id: 'cr_a_generer', label: '2 · Audio → CR' },
    { id: 'cr_a_relire', label: '3 · Relecture du DOCX' },
    { id: 'diffuse', label: '4 · Diffusion' },
  ]
  const courant = etapes.findIndex((e) => e.id === statut)
  return (
    <p className="small" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 0 10px' }}>
      {etapes.map((e, i) => (
        <span
          key={e.id}
          className={`badge ${i < courant ? 'badge-ok' : i === courant ? 'badge-info' : 'badge-muted'}`}
          aria-current={i === courant ? 'step' : undefined}
        >
          {i < courant ? '✓ ' : ''}{e.label}
        </span>
      ))}
    </p>
  )
}

function AssistantCR({
  projet: p,
  reunion,
  fichierInitial,
  onClose,
}: {
  projet: Projet
  reunion: ReunionChantier
  fichierInitial?: File
  onClose: () => void
}) {
  const { state, update } = useStore()
  const [transcript, setTranscript] = useState('')
  const [modele, setModele] = useState(MODELES_WHISPER[0].id)
  const [progres, setProgres] = useState<ProgresTranscription | null>(null)
  const [erreurAudio, setErreurAudio] = useState('')
  const [retourClaude, setRetourClaude] = useState('')
  const [messageDocx, setMessageDocx] = useState('')
  const enCours = progres !== null
  const fichierLance = useRef(false)

  useEffect(() => {
    if (fichierInitial && !fichierLance.current) {
      fichierLance.current = true
      void transcrire(fichierInitial)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const transcrire = async (file: File) => {
    setErreurAudio('')
    const dureeSuspecte = file.size > 250 * 1024 * 1024
    if (
      dureeSuspecte &&
      !(await confirmer({
        message:
          'Fichier volumineux : pour une réunion de plus de ~1 h 30, préférez un enregistrement mono compressé (m4a) ou coupez le fichier en deux. Tenter quand même ?',
        danger: true,
        confirmerLabel: 'Tenter quand même',
      }))
    )
      return
    setProgres({ etape: 'Préparation…' })
    try {
      const texte = await transcrireFichier(file, modele, setProgres)
      const complet = (transcript.trim() ? transcript + '\n\n' : '') + texte
      setTranscript(complet)
      if (reunion.statut === 'a_preparer') maj((r) => { r.statut = 'cr_a_generer' })
      // le prompt complet part tout seul dans le presse-papier : il ne reste qu'à le coller dans Claude
      if (await copier(construirePrompt(complet))) {
        setMessageDocx('Transcription terminée — le prompt CR est DÉJÀ dans votre presse-papier : collez-le dans le Projet Claude, puis rapportez sa réponse ci-dessous.')
      }
    } catch (e) {
      setErreurAudio(
        `Transcription impossible : ${e instanceof Error ? e.message : String(e)} — vous pouvez transcrire avec un outil local (MacWhisper, Vibe) et coller le texte ci-dessous.`,
      )
    } finally {
      setProgres(null)
    }
  }

  const maj = (fn: (r: ReunionChantier) => void) =>
    update((d) => {
      const r = d.reunions.find((x) => x.id === reunion.id)
      if (r) fn(r)
    })

  const gabarit = state.prompts.find((t) => t.id === 'tpl-cr-chantier')

  const construirePrompt = (texteTranscript?: string): string => {
    const t = (texteTranscript ?? transcript).trim()
    const ctx = contexteProjet(state, p)
    let corps = gabarit
      ? assemble(gabarit.corps, ctx)
      : `Compte-rendu de la réunion de chantier — ${p.nom} (${p.id}).\n\n${ctx.fiche}\n\nDictée brute :\n« ⟦coller ou dicter ici⟧ »`
    const blocReunion = [
      `Réunion : ${reunion.titre} du ${fmtDate(reunion.date)}.`,
      `Convoqués :`,
      reunion.participants,
      '',
    ].join('\n')
    corps = blocReunion + '\n' + corps
    if (t) corps = corps.replace('« ⟦coller ou dicter ici⟧ »', t)
    corps += `\n\nIMPORTANT — la transcription est automatique et peut contenir des erreurs : corrige les noms propres d'après la liste des convoqués et le contexte. La mise en page est gérée par le Cockpit : termine ta réponse par UN SEUL bloc de code json strictement conforme à ce format (le Cockpit fabriquera le DOCX officiel) :\n\n\`\`\`json\n${CONTRAT_CR}\n\`\`\``
    return corps
  }

  const fabriquerDocx = async () => {
    setMessageDocx('')
    const { retour, erreur } = parseRetourCR(retourClaude)
    if (erreur || !retour) {
      setMessageDocx(`Impossible de lire le retour : ${erreur}`)
      return
    }
    try {
      const blob = await genererDocxCR(state.settings, p, reunion, retour)
      const nom = nomConforme(p, 'CR', reunion.titre, 'cr.docx')
      const file = new File([blob], nom, { type: blob.type })
      let rangement: ResultatRangement | null = null
      if (supporteFS) {
        const racine = await lireRacine()
        if (racine) rangement = await rangerFichier(racine, p, '07_CHANTIER', file, nom)
      }
      const chemin = rangement?.chemin || ''
      if (!chemin) {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = nom
        a.click()
        URL.revokeObjectURL(url)
      }
      // registre documentaire : le CR généré devient traçable (calculé
      // AVANT la mutation — le producteur clone pour rester rejouable)
      const docPret = creerDocument({
        titre: rangement?.nomFinal || nom,
        nomOriginal: nom,
        source: 'genere',
        categorie: 'CR',
        typeMime: file.type || undefined,
        taille: file.size,
        empreinteSha256: rangement?.empreinte || (await empreinteSha256(file)) || undefined,
        cheminDrive: chemin || undefined,
        projetId: p.id,
        reunionId: reunion.id,
        dateDocument: reunion.date,
        statut: 'classe',
      })
      const texteCR = retourVersTexte(retour)
      update((d) => {
        const { doc, doublon } = enregistrerDocument(d, structuredClone(docPret))
        const r = d.reunions.find((x) => x.id === reunion.id)
        if (r) {
          // un CR régénéré REMPLACE le précédent (versions sûres, rien d'écrasé)
          const ancien = r.crDocumentId ? d.registreDocuments.find((x) => x.id === r.crDocumentId) : undefined
          if (ancien && ancien.id !== doc.id && !doublon) remplacerDocument(ancien, doc)
          r.statut = 'cr_a_relire'
          // le texte du CR reste sur la réunion : relisible et cherchable plus tard
          r.cr = texteCR
          r.crDocumentId = doc.id
        }
      })
      setRetourClaude('')
      setMessageDocx(
        chemin
          ? `DOCX fabriqué et rangé dans le Drive : ${chemin} — relisez avant diffusion.`
          : 'DOCX fabriqué et téléchargé (configurez le Drive dans l’onglet Documents pour le rangement automatique) — relisez avant diffusion.',
      )
    } catch (e) {
      setMessageDocx(`Fabrication impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <Modal titre={`Assistant CR — ${reunion.titre} (${p.id})`} onClose={onClose} large>
      {/* le circuit en étapes : l'avancement vit sur la RÉUNION (statut),
          donc fermer la modale ne perd rien — on reprend où on s'était arrêté */}
      <EtapesCR statut={reunion.statut} />
      <div className="form-row">
        <Field label="Titre">
          <TextInput value={reunion.titre} onChange={(v) => maj((r) => { r.titre = v })} />
        </Field>
        <Field label="Date de la réunion">
          <input
            className="input"
            type="date"
            value={reunion.date}
            onChange={(e) => maj((r) => { r.date = e.target.value || todayISO() })}
          />
        </Field>
        <Field label="Heure">
          <input
            className="input"
            type="time"
            value={reunion.heure || ''}
            onChange={(e) => maj((r) => { r.heure = e.target.value || undefined })}
          />
        </Field>
      </div>
      <Field label="Convoqués (pré-rempli depuis les marchés — ajustez)">
        <TextArea value={reunion.participants} onChange={(v) => maj((r) => { r.participants = v })} rows={4} />
      </Field>

      <div className="pill-note" style={{ marginTop: 12 }}>
        <strong>1 · Capturer.</strong> Enregistrez la réunion (téléphone / dictaphone), même 1 à 2 h.
        <br />
        <strong>2 · Transcrire ICI.</strong> Importez le fichier audio ci-dessous : la transcription
        (Whisper) tourne <em>dans le navigateur</em>, gratuitement — l'audio ne quitte pas votre machine.
        <br />
        <strong>3 · Un aller-retour Claude.</strong> À la fin de la transcription, le prompt complet est
        copié automatiquement : collez-le dans « {gabarit?.projetClaude || 'CR de chantier'} », puis
        rapportez la réponse ci-dessous.
        <br />
        <strong>4 · Le site fabrique le DOCX.</strong> Mise en page de l'agence, codée en dur, et
        rangement direct dans 07_CHANTIER du Drive. Relecture humaine, diffusion, terminé.
      </div>

      <Field label="Fichier audio de la réunion (m4a, mp3, wav…)">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <input
            className="input"
            type="file"
            accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac"
            disabled={enCours}
            style={{ maxWidth: 320 }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void transcrire(f)
              e.target.value = ''
            }}
          />
          <Select
            value={modele}
            onChange={setModele}
            options={MODELES_WHISPER.map((m) => ({ value: m.id, label: m.label }))}
            style={{ maxWidth: 300 }}
          />
        </div>
      </Field>
      {progres && (
        <p className="small" style={{ marginTop: 6 }}>
          <Badge tone="info">en cours</Badge> {progres.etape}
          {progres.pct != null ? ` — ${progres.pct} %` : ''}
        </p>
      )}
      {erreurAudio && <p className="danger-text small" style={{ marginTop: 6 }}>{erreurAudio}</p>}

      <Field label="Transcription / dictée brute (collée ici, elle est intégrée au prompt — rien n'est stocké)">
        <TextArea
          value={transcript}
          onChange={setTranscript}
          rows={8}
          mono
          placeholder="Collez ici la transcription de la réunion (ou laissez vide : le prompt gardera un emplacement à compléter)…"
        />
      </Field>

      <div className="toolbar" style={{ marginTop: 10 }}>
        <CopyBtn
          text={construirePrompt}
          label={`Copier le prompt CR → « ${gabarit?.projetClaude || 'CR de chantier'} »`}
        />
        {reunion.statut !== 'cr_a_relire' && reunion.statut !== 'diffuse' && (
          <Btn small onClick={() => maj((r) => { r.statut = 'cr_a_relire' })}>
            Prompt collé — CR en relecture
          </Btn>
        )}
        {reunion.statut === 'cr_a_relire' && (
          <Btn small kind="primary" onClick={() => { maj((r) => { r.statut = 'diffuse' }); onClose() }}>
            ✓ CR relu et diffusé
          </Btn>
        )}
        {reunion.statut === 'diffuse' && <Badge tone="ok">CR diffusé</Badge>}
      </div>

      <Field label="Retour de Claude (collez sa réponse — le bloc JSON est détecté tout seul)">
        <TextArea
          value={retourClaude}
          onChange={setRetourClaude}
          rows={4}
          mono
          placeholder="Collez ici la réponse complète de Claude…"
        />
      </Field>
      <div className="toolbar" style={{ marginTop: 6 }}>
        <Btn kind="primary" onClick={fabriquerDocx} disabled={!retourClaude.trim()}>
          Fabriquer le DOCX → Drive (07_CHANTIER)
        </Btn>
        {messageDocx && <span className="small">{messageDocx}</span>}
      </div>

      <Field label="Notes (points en attente, absents…)">
        <TextArea value={reunion.notes || ''} onChange={(v) => maj((r) => { r.notes = v })} rows={2} />
      </Field>

      <div className="form-foot">
        <Btn onClick={onClose}>Fermer</Btn>
      </div>
    </Modal>
  )
}

export default function ProjetChantier({ projet }: { projet: Projet }) {
  return (
    <>
      <CarteReunions projet={projet} />
      <CarteMarches projet={projet} />
    </>
  )
}
