// Assistant « Nouveau projet » — 3 étapes, 2 minutes :
// 1. le projet et son équipe · 2. les honoraires (calculés seuls) ·
// 3. le planning.
// À la fin : phases datées + échéancier de facturation + arborescence
// documentaire dans le Drive, tout reste ajustable dans la fiche.
//
// L'équipe se règle ICI et pas « plus tard dans la fiche » (CDC §19.1
// points 2 et 4). Sans responsable, un projet neuf n'appartient à
// personne : `equipeDuProjet()` rend une liste vide, sa charge planifiée
// vaut 0 pour tout le monde, et il n'apparaît sur aucun tableau de temps.
// Rien ne le signale — le projet est simplement absent des écrans où on
// l'aurait cherché. Le responsable est donc OBLIGATOIRE dès l'étape 1.
//
// Ce bloc désigne un responsable et une équipe ; il ne crée AUCUN droit
// d'accès (§12.1 point 12), auquel le plan renonce explicitement.

import { useEffect, useMemo, useState } from 'react'
import type { Projet, StatutProjet, TypeMO } from '../types'
import { useStore } from '../store'
import { OUVRAGES, calculHonoraires, phasesParDefaut, seuilPlancherActualise } from '../miqcp'
import { baselineDepuisPhases, equipeDuProjet, tauxVente } from '../derive'
// Le rapprochement nom → organisation a DÉJÀ son autorité (le CRM,
// src/organisations.ts) : la datalist du maître d'ouvrage la réutilise au
// lieu d'en écrire une seconde — sinon « OPAC de l'Oise » et « OPAC de
// l'OISE » deviendraient deux relations dans le radar, en silence.
import { trouverOrganisation } from '../organisations'
import { useMoi } from '../moi'
import { daterPhases, echeancesParDefaut } from '../echeancier'
import {
  ARBORESCENCE,
  choisirRacine as choisirRacineFS,
  creerArborescenceProjet,
  lireRacine,
  slugProjet,
  supporteFS,
  type FSDirHandle,
} from '../fsdrive'
import { Badge, Btn, Field, Modal, NumInput, PctInput, Select, TextInput, navigate, toast } from '../ui'
import { addDays, adresseProjetProposee, codeExternePropose, fmtMoney, fmtPct, fold, todayISO, uid } from '../util'

const TYPES_MO: TypeMO[] = ['Public', 'Privé pro', 'Particulier']
const STATUTS: StatutProjet[] = ['Prospect', 'Offre remise', 'Signé', 'En cours']

function prochainId(ids: string[]): string {
  let max = 0
  for (const id of ids) {
    const m = /^P(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `P${String(max + 1).padStart(2, '0')}`
}

export default function ProjetNouveau({ onClose }: { onClose: () => void }) {
  const { state, update } = useStore()
  const moi = useMoi()
  const [etape, setEtape] = useState(1)

  // — étape 1 : le projet
  const [nom, setNom] = useState('')
  const [typeMO, setTypeMO] = useState<string>('Public')
  const [statut, setStatut] = useState<string>('Signé')
  const [moa, setMoa] = useState('')
  const [adresse, setAdresse] = useState('')
  const [ouvrage, setOuvrage] = useState('')
  const [montant, setMontant] = useState<number | null>(null)

  // — étape 1 : l'équipe (CDC §19.1 pts 2 et 4)
  const personnes = useMemo(
    () => state.settings.personnes.map((n) => n.trim()).filter(Boolean),
    [state.settings.personnes],
  )
  const [codeExterne, setCodeExterne] = useState(() =>
    codeExternePropose(
      state.projets.map((p) => p.codeExterne),
      todayISO().slice(0, 4),
    ),
  )
  const [responsable, setResponsable] = useState(moi.nom ?? '')
  // l'identité peut arriver après le premier rendu (la session Supabase se
  // résout de façon asynchrone) : sans ce rattrapage, ouvrir l'assistant
  // trop vite laisserait le champ vide alors que le Cockpit sait qui est là.
  // Dès que la personne y touche, l'assistant cesse de proposer.
  const [responsableTouche, setResponsableTouche] = useState(false)
  useEffect(() => {
    if (!responsableTouche && moi.nom) setResponsable(moi.nom)
  }, [moi.nom, responsableTouche])
  const [coResponsable, setCoResponsable] = useState('')
  const [equipeProjet, setEquipeProjet] = useState<string[]>([])

  /** options d'un Select de personne — un nom hors `settings.personnes`
   *  (identité de session non encore ajoutée à l'agence) reste visible
   *  plutôt que de disparaître silencieusement du champ */
  const optionsPersonne = (valeur: string) => [
    { value: '', label: '— aucun —' },
    ...personnes.map((n) => ({ value: n, label: n })),
    ...(valeur && !personnes.includes(valeur) ? [{ value: valeur, label: `${valeur} (hors liste)` }] : []),
  ]

  // — étape 2 : les honoraires
  const [tauxRetenu, setTauxRetenu] = useState<number | null>(null)
  const [missionsCompl, setMissionsCompl] = useState<number | null>(0)

  // — étape 3 : le planning
  const [debutEtudes, setDebutEtudes] = useState(addDays(todayISO(), 30).slice(0, 8) + '01')
  const [dureeEtudes, setDureeEtudes] = useState<number | null>(8)
  const [dureeChantier, setDureeChantier] = useState<number | null>(12)
  const [genererFactures, setGenererFactures] = useState(true)
  const [creerDossiers, setCreerDossiers] = useState(true)

  // dossier Drive déjà choisi sur ce poste (mémorisé dans IndexedDB par
  // l'onglet Documents) : l'arborescence n'est proposée que s'il existe —
  // l'assistant ne réclame pas un réglage de poste au milieu d'une saisie.
  const [racineDrive, setRacineDrive] = useState<FSDirHandle | null>(null)
  useEffect(() => {
    if (supporteFS) void lireRacine().then(setRacineDrive)
  }, [])

  const id = prochainId(state.projets.map((p) => p.id))

  const brouillon: Projet = useMemo(
    () => ({
      id,
      nom: nom.trim(),
      typeMO: typeMO as TypeMO,
      statut: statut as StatutProjet,
      moa: moa.trim() || undefined,
      adresse: adresse.trim() || undefined,
      ouvrage: ouvrage || null,
      montantTravauxHT: montant,
      notesComplexite: {},
      coefManuel: null,
      tauxRetenu,
      missionsComplHT: missionsCompl ?? 0,
      dureeEtudesMois: dureeEtudes,
      dureeChantierMois: dureeChantier,
      // l'équipe part AVEC le projet : c'est elle qui le fait exister dans
      // le plan de charge et dans les tableaux de temps
      codeExterne: codeExterne.trim() || undefined,
      responsable: responsable.trim() || undefined,
      coResponsable: coResponsable.trim() || undefined,
      equipeProjet,
      phases: [],
      liens: [],
      materiauxIds: [],
      artisanIds: [],
      journal: [],
    }),
    [
      id,
      nom,
      typeMO,
      statut,
      moa,
      adresse,
      ouvrage,
      montant,
      tauxRetenu,
      missionsCompl,
      dureeEtudes,
      dureeChantier,
      codeExterne,
      responsable,
      coResponsable,
      equipeProjet,
    ],
  )

  // Les maîtres d'ouvrage déjà connus : le CRM (`state.organisations`) ET les
  // MOA portés par les projets existants — un projet saisi avant le CRM doit
  // rester proposable, sinon on retape ce que l'outil sait déjà. Dédoublonnage
  // par `fold`, la même normalisation que `trouverOrganisation`.
  const moaConnus = useMemo(() => {
    const noms = new Map<string, string>()
    for (const o of state.organisations) if (o?.nom?.trim()) noms.set(fold(o.nom), o.nom.trim())
    for (const p of state.projets) {
      const n = p.moa?.trim()
      if (n && !noms.has(fold(n))) noms.set(fold(n), n)
    }
    return [...noms.values()].sort((a, b) => a.localeCompare(b))
  }, [state.organisations, state.projets])

  // l'organisation que le nom désigne — le rapprochement du CRM, pas un second
  const orgReconnue = trouverOrganisation(state, moa.trim())

  // qui travaillera sur le projet, selon la règle de derive.ts et elle seule
  // — la recopier ici ferait diverger l'aperçu de l'assistant du plan de
  // charge le jour où la règle bouge
  const equipe = equipeDuProjet(brouillon)

  const h = calculHonoraires(brouillon, state.settings)

  const creer = () => {
    const projet = structuredClone(brouillon)
    let phases = phasesParDefaut(h.honorairesBaseHT, tauxVente(state))
    if (missionsCompl && missionsCompl > 0) {
      const mc = phases.find((p) => p.code === 'MC')
      if (mc) mc.montantHT = missionsCompl
    }
    if (debutEtudes && dureeEtudes && dureeChantier) {
      phases = daterPhases(phases, debutEtudes, dureeEtudes, dureeChantier)
    }
    projet.phases = phases
    // la prévision d'heures est figée ICI, à la naissance du projet (CDC
    // §11.3, critère 15) : mesurée plus tard, elle aurait déjà bougé, et
    // « Recalculer la répartition » l'aurait écrasée entre-temps. Le champ
    // vit hors du tableau `phases`, qu'un recalcul remplace en entier.
    if (phases.some((ph) => ph.heuresPrevues > 0)) {
      projet.baselineHeures = baselineDepuisPhases(phases, {
        le: todayISO(),
        par: moi.nom,
        origine: statut === 'Signé' ? 'signature' : 'creation',
        honorairesBaseHT: h.honorairesBaseHT,
      })
    }

    // échéances calculées AVANT la mutation (producteur rejouable)
    const echeances = genererFactures && debutEtudes ? echeancesParDefaut(projet, state.settings) : []
    update((d) => {
      d.projets.push(projet)
      d.echeancesFacturation.push(...echeances)
    })

    // §12.1 points 6 et 7 : le dossier Drive du projet et son arborescence.
    // Lancé APRÈS l'enregistrement et jamais attendu : le Drive peut être
    // absent, la permission refusée, le disque plein. Aucun de ces échecs ne
    // doit empêcher la création du projet ni faire reperdre trois écrans de
    // saisie — il se signale, et le bouton de l'onglet Documents rattrape.
    if (racineDrive && creerDossiers) {
      void creerArborescenceProjet(racineDrive, projet)
        .then((r) =>
          toast(
            r.crees.length === 0
              ? `Dossier ${r.dossierProjet} déjà en place dans le Drive.`
              : `Arborescence créée dans le Drive : ${r.dossierProjet} (${r.crees.length} dossiers).`,
            { tone: 'ok' },
          ),
        )
        .catch((e: unknown) =>
          toast(
            `Projet créé, mais l'arborescence Drive n'a pas pu l'être : ${
              e instanceof Error ? e.message : String(e)
            } — à relancer depuis l'onglet Documents du projet.`,
            { tone: 'danger' },
          ),
        )
    }

    onClose()
    navigate(`/projets/${projet.id}`)
  }

  // Le responsable est exigé — sauf si l'agence n'a aucune personne
  // enregistrée : mieux vaut un projet sans responsable qu'un assistant
  // qu'on ne peut plus terminer.
  const responsableManquant = personnes.length > 0 && responsable.trim() === ''
  const projetComplet = nom.trim() !== '' && !responsableManquant
  const etapeValide = etape === 1 ? projetComplet : true

  return (
    <Modal titre={`Nouveau projet ${id} — étape ${etape}/3`} onClose={onClose} large>
      {/* fil d'ariane */}
      <div className="toolbar" style={{ marginBottom: 16 }}>
        {['Le projet & l’équipe', 'Les honoraires', 'Le planning'].map((label, i) => (
          <Badge key={label} tone={etape === i + 1 ? 'info' : etape > i + 1 ? 'ok' : 'muted'}>
            {etape > i + 1 ? '✓ ' : `${i + 1}. `}
            {label}
          </Badge>
        ))}
      </div>

      {etape === 1 && (
        <>
          <Field label="Nom du projet">
            <TextInput value={nom} onChange={setNom} placeholder="Ex. Réhabilitation 12 logements — Beauvais" />
          </Field>
          <div className="form-row" style={{ marginTop: 10 }}>
            <Field label="Type de maître d'ouvrage" hint="détermine délais de paiement et modèle de facturation">
              <Select value={typeMO} onChange={setTypeMO} options={TYPES_MO.map((t) => ({ value: t, label: t }))} />
            </Field>
            <Field label="Statut">
              <Select value={statut} onChange={setStatut} options={STATUTS.map((s) => ({ value: s, label: s }))} />
            </Field>
          </div>
          <div className="form-row">
            <Field
              label="Maître d'ouvrage"
              hint={
                orgReconnue
                  ? `Organisation « ${orgReconnue.nom} » reconnue : consultations, contacts et références se regrouperont dessus.`
                  : moa.trim()
                    ? 'Nouveau maître d’ouvrage — reprenez à l’identique le nom déjà utilisé ailleurs, sinon la fiche organisation se scinde en deux.'
                    : moaConnus.length > 0
                      ? `${moaConnus.length} maîtres d’ouvrage déjà connus vous sont proposés — la saisie reste libre.`
                      : 'aucun maître d’ouvrage connu pour l’instant'
              }
            >
              {/* la datalist PROPOSE ce que le CRM et les projets savent déjà ;
                  elle n'enferme pas (un nouveau MOA n'est encore nulle part).
                  `TextInput` (ui.tsx) ne porte pas d'attribut `list` : l'input
                  est écrit ici, aux mêmes classes. */}
              <input
                className="input"
                type="text"
                list="projet-moa-connus"
                value={moa}
                onChange={(e) => setMoa(e.target.value)}
                placeholder="Ex. OPAC de l'Oise"
                aria-label="Maître d’ouvrage"
              />
              <datalist id="projet-moa-connus">
                {moaConnus.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </Field>
            <Field label="Adresse / commune">
              <TextInput value={adresse} onChange={setAdresse} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Type d'ouvrage (MIQCP)" hint="sert au calcul du taux — modifiable ensuite">
              <Select
                value={ouvrage}
                onChange={setOuvrage}
                options={[{ value: '', label: '— choisir plus tard —' }, ...OUVRAGES.map((o) => ({ value: o.code, label: o.code }))]}
              />
            </Field>
            <Field label="Montant de travaux HT (€)">
              <NumInput value={montant} onChange={setMontant} placeholder="Ex. 1 400 000" />
            </Field>
          </div>
          <div className="form-row">
            <Field
              label="Code projet (côté client)"
              hint={
                codeExterne.trim()
                  ? `porté par les échanges — adresse projet proposée : ${adresseProjetProposee(codeExterne)}`
                  : 'code lisible porté par les échanges — l’identifiant interne reste ' + id
              }
            >
              <TextInput value={codeExterne} onChange={setCodeExterne} placeholder="2026-034" />
            </Field>
          </div>

          <p className="small" style={{ margin: '18px 0 2px', fontWeight: 600 }}>
            L’équipe
          </p>
          <p className="small muted" style={{ marginBottom: 8 }}>
            Sans responsable, le projet n’apparaît sur aucun plan de charge ni tableau de temps. Cela
            désigne qui porte le projet — aucun droit d’accès n’est créé.
          </p>
          {personnes.length === 0 && (
            <div className="pill-note" style={{ marginBottom: 8 }}>
              Aucune personne enregistrée dans les Paramètres : l’équipe se réglera dans la fiche du
              projet.
            </div>
          )}
          <div className="form-row">
            <Field
              label="Responsable *"
              hint={
                responsable && responsable === moi.nom
                  ? 'vous, par défaut — modifiable'
                  : 'obligatoire : qui porte ce projet'
              }
            >
              <Select
                value={responsable}
                onChange={(v) => {
                  setResponsableTouche(true)
                  setResponsable(v)
                }}
                options={optionsPersonne(responsable)}
              />
            </Field>
            <Field label="Co-responsable" hint="optionnel">
              <Select value={coResponsable} onChange={setCoResponsable} options={optionsPersonne(coResponsable)} />
            </Field>
          </div>
          {personnes.length > 0 && (
            <Field label="Travaillent aussi sur le projet" hint="pré-remplit leur tableau de temps et le plan de charge">
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', paddingTop: 7 }}>
                {personnes.map((n) => {
                  const dOffice = n === responsable || n === coResponsable
                  return (
                    <label
                      key={n}
                      className="small"
                      style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: dOffice ? 'default' : 'pointer' }}
                      title={dOffice ? 'compté d’office : responsable ou co-responsable' : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={dOffice || equipeProjet.includes(n)}
                        disabled={dOffice}
                        onChange={(e) =>
                          setEquipeProjet(e.target.checked ? [...equipeProjet, n] : equipeProjet.filter((x) => x !== n))
                        }
                      />
                      {n}
                    </label>
                  )
                })}
              </div>
            </Field>
          )}
          <p className="small muted" style={{ marginTop: 6 }}>
            {equipe.length > 0
              ? `Équipe du projet : ${equipe.join(', ')} — la charge des phases se répartira entre ${
                  equipe.length > 1 ? `ces ${equipe.length} personnes` : 'cette personne'
                }.`
              : 'Équipe du projet : personne pour l’instant.'}
          </p>
        </>
      )}

      {etape === 2 && (
        <>
          <p className="small muted" style={{ marginBottom: 12 }}>
            Calculés au barème MIQCP — ne renseignez un taux que s'il a été négocié.
          </p>
          <dl className="kv">
            <dt>Taux barème (actualisé BT01)</dt>
            <dd>{fmtPct(h.tauxBareme, 2)}</dd>
            <dt>Coefficient de complexité</dt>
            <dd>{h.coef !== null ? h.coef.toFixed(2).replace('.', ',') : '—'}</dd>
            <dt>Taux résultant</dt>
            <dd>{fmtPct(h.tauxAjuste, 2)}</dd>
            <dt>
              <strong>Honoraires mission de base</strong>
            </dt>
            <dd>
              <strong>{fmtMoney(h.honorairesBaseHT)}</strong> HT
            </dd>
          </dl>
          {h.sousPlancher && (
            <div className="pill-note" style={{ marginTop: 10 }}>
              Petit projet (sous ~{fmtMoney(seuilPlancherActualise(state.settings))}) : le barème n'est
              qu'un repère, saisissez plutôt un taux négocié.
            </div>
          )}
          <div className="form-row" style={{ marginTop: 12 }}>
            <Field label="Taux négocié (optionnel)" hint="vide = taux calculé — saisir 12 pour 12 %">
              <PctInput value={tauxRetenu} onChange={setTauxRetenu} placeholder="auto" ariaLabel="Taux d'honoraires négocié en pourcentage" />
            </Field>
            <Field label="Missions complémentaires HT (€)" hint="DIAG, OPC, EXE… (optionnel)">
              <NumInput value={missionsCompl} onChange={setMissionsCompl} />
            </Field>
          </div>
          <p className="small" style={{ marginTop: 8 }}>
            Honoraires totaux : <strong>{fmtMoney(h.honorairesTotauxHT)}</strong> HT
          </p>
        </>
      )}

      {etape === 3 && (
        <>
          <p className="small muted" style={{ marginBottom: 12 }}>
            Trois repères suffisent : phases datées et échéancier générés automatiquement, tout reste
            modifiable ensuite.
          </p>
          <div className="form-row">
            <Field label="Début des études">
              <input
                className="input"
                type="date"
                value={debutEtudes}
                onChange={(e) => setDebutEtudes(e.target.value)}
              />
            </Field>
            <Field label="Durée des études (mois)">
              <NumInput value={dureeEtudes} onChange={setDureeEtudes} />
            </Field>
            <Field label="Durée du chantier (mois)">
              <NumInput value={dureeChantier} onChange={setDureeChantier} />
            </Field>
          </div>
          <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={genererFactures} onChange={(e) => setGenererFactures(e.target.checked)} />
            Générer l'échéancier de facturation automatiquement (recommandé)
          </label>

          {supporteFS ? (
            racineDrive ? (
              <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={creerDossiers} onChange={(e) => setCreerDossiers(e.target.checked)} />
                <span>
                  Créer l'arborescence documentaire dans <strong>{racineDrive.name}</strong> —{' '}
                  {ARBORESCENCE.length} dossiers sous <code>{slugProjet(brouillon)}</code>
                </span>
              </label>
            ) : (
              <p className="small muted" style={{ marginTop: 10 }}>
                Aucun dossier Drive choisi sur ce poste : l'arborescence documentaire ne sera pas créée
                (elle reste disponible dans l'onglet Documents du projet).{' '}
                <Btn small onClick={() => void choisirRacineFS().then(setRacineDrive)}>
                  Choisir le dossier Drive
                </Btn>
              </p>
            )
          ) : (
            <p className="small muted" style={{ marginTop: 10 }}>
              Le rangement dans le Drive demande Chrome ou Edge sur ordinateur : l'arborescence
              documentaire ne sera pas créée depuis ce navigateur.
            </p>
          )}
        </>
      )}

      <div className="form-foot">
        {etape > 1 && <Btn onClick={() => setEtape(etape - 1)}>← Précédent</Btn>}
        <span className="spacer" />
        <Btn onClick={onClose}>Annuler</Btn>
        {etape < 3 ? (
          <Btn kind="primary" disabled={!etapeValide} onClick={() => setEtape(etape + 1)}>
            Continuer →
          </Btn>
        ) : (
          <Btn
            kind="primary"
            disabled={!projetComplet}
            title={responsableManquant ? 'Choisissez un responsable à l’étape 1' : undefined}
            onClick={creer}
          >
            Créer le projet
          </Btn>
        )}
      </div>
    </Modal>
  )
}
