// Assistant « Nouveau projet » — 3 étapes, 2 minutes :
// 1. le projet · 2. les honoraires (calculés seuls) · 3. le planning.
// À la fin : phases datées + échéancier de facturation générés
// automatiquement, tout reste ajustable dans la fiche.

import { useMemo, useState } from 'react'
import type { Projet, StatutProjet, TypeMO } from '../types'
import { useStore } from '../store'
import { OUVRAGES, calculHonoraires, phasesParDefaut, seuilPlancherActualise } from '../miqcp'
import { tauxVente } from '../derive'
import { daterPhases, facturesParDefaut } from '../echeancier'
import { Badge, Btn, Field, Modal, NumInput, PctInput, Select, TextInput, navigate } from '../ui'
import { addDays, fmtMoney, fmtPct, todayISO, uid } from '../util'

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
  const [etape, setEtape] = useState(1)

  // — étape 1 : le projet
  const [nom, setNom] = useState('')
  const [typeMO, setTypeMO] = useState<string>('Public')
  const [statut, setStatut] = useState<string>('Signé')
  const [moa, setMoa] = useState('')
  const [adresse, setAdresse] = useState('')
  const [ouvrage, setOuvrage] = useState('')
  const [montant, setMontant] = useState<number | null>(null)

  // — étape 2 : les honoraires
  const [tauxRetenu, setTauxRetenu] = useState<number | null>(null)
  const [missionsCompl, setMissionsCompl] = useState<number | null>(0)

  // — étape 3 : le planning
  const [debutEtudes, setDebutEtudes] = useState(addDays(todayISO(), 30).slice(0, 8) + '01')
  const [dureeEtudes, setDureeEtudes] = useState<number | null>(8)
  const [dureeChantier, setDureeChantier] = useState<number | null>(12)
  const [genererFactures, setGenererFactures] = useState(true)

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
      phases: [],
      liens: [],
      materiauxIds: [],
      artisanIds: [],
      journal: [],
    }),
    [id, nom, typeMO, statut, moa, adresse, ouvrage, montant, tauxRetenu, missionsCompl, dureeEtudes, dureeChantier],
  )

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

    update((d) => {
      d.projets.push(projet)
      if (genererFactures && debutEtudes) {
        const nouvelles = facturesParDefaut(projet, d.settings, d.factures)
        d.factures.push(...nouvelles)
      }
    })
    onClose()
    navigate(`/projets/${projet.id}`)
  }

  const etapeValide = etape === 1 ? nom.trim() !== '' : true

  return (
    <Modal titre={`Nouveau projet ${id} — étape ${etape}/3`} onClose={onClose} large>
      {/* fil d'ariane */}
      <div className="toolbar" style={{ marginBottom: 16 }}>
        {['Le projet', 'Les honoraires', 'Le planning'].map((label, i) => (
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
            <Field label="Maître d'ouvrage">
              <TextInput value={moa} onChange={setMoa} placeholder="Ex. OPAC de l'Oise" />
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
          <Btn kind="primary" disabled={nom.trim() === ''} onClick={creer}>
            Créer le projet
          </Btn>
        )}
      </div>
    </Modal>
  )
}
