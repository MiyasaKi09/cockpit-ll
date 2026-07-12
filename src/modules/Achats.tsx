// ============================================================
// Achats & frais — audit finance F2 : boîte d'arrivée unique
// (Valider / Répartir / Ce n'est pas une facture), ventilation
// contrôlée (somme = HT), notes de frais, attendus financiers
// (une absence devient une exception à confirmer), balance
// fournisseurs et échéancier de décaissement.
// ============================================================

import { useMemo, useRef, useState } from 'react'
import type { AppState, FactureAchat, NoteFrais, PhaseCode, VentilationAchat } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  DateF,
  DateInput,
  EmptyState,
  Field,
  Modal,
  Money,
  NumInput,
  Page,
  RowMenu,
  Select,
  Stat,
  Table,
  TextInput,
  confirmer,
  toast,
  useToday,
} from '../ui'
import FinanceNav from './FinanceNav'
import {
  CATEGORIES_ACHAT,
  attendusOuverts,
  balanceFournisseurs,
  controlerAchat,
  doublonProbable,
  sommeVentilations,
} from '../achats'
import type { AttenduOuvert, BrouillonAchat } from '../achats'
import { lireFactureXML } from '../facturx'
import { PHASES_ORDRE } from '../miqcp'
import { addDays, fmtDate, fmtMoney, uid } from '../util'

const CATEGORIES_OPTIONS = CATEGORIES_ACHAT.map((c) => ({ value: c, label: c }))

// ------------------------------------------------------------------
// Modal facture fournisseur (création / validation / répartition)
// ------------------------------------------------------------------

interface ValeursAchat {
  fournisseur: string
  numeroFournisseur: string
  dateFacture: string | null
  dateEcheance: string | null
  montantHT: number | null
  montantTVA: number | null
  contratId: string
  ventilations: VentilationAchat[]
}

function depuisFacture(f: FactureAchat): ValeursAchat {
  return {
    fournisseur: f.fournisseur,
    numeroFournisseur: f.numeroFournisseur || '',
    dateFacture: f.dateFacture,
    dateEcheance: f.dateEcheance || null,
    montantHT: f.montantHT,
    montantTVA: f.montantTVA ?? null,
    contratId: f.contratId || '',
    ventilations: f.ventilations.map((v) => ({ ...v })),
  }
}

function AchatModal({
  titre,
  initial,
  empreinte,
  idEnCours,
  onClose,
  onValider,
}: {
  titre: string
  initial: ValeursAchat
  empreinte?: string
  idEnCours?: string
  onClose: () => void
  onValider: (v: ValeursAchat, ttc: number) => void
}) {
  const { state } = useStore()
  const [v, setV] = useState<ValeursAchat>(initial)
  const set = (patch: Partial<ValeursAchat>) => setV((prev) => ({ ...prev, ...patch }))
  const majVentilation = (id: string, patch: Partial<VentilationAchat>) =>
    setV((prev) => ({ ...prev, ventilations: prev.ventilations.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))

  const ttc = (v.montantHT ?? 0) + (v.montantTVA ?? 0)
  const brouillon: BrouillonAchat = {
    fournisseur: v.fournisseur,
    numeroFournisseur: v.numeroFournisseur || undefined,
    dateFacture: v.dateFacture || '',
    montantHT: v.montantHT ?? 0,
    montantTVA: v.montantTVA,
    montantTTC: Math.round(ttc * 100) / 100,
    ventilations: v.ventilations,
    empreinte,
  }
  const controle = useMemo(() => controlerAchat(state, brouillon, idEnCours), [state, brouillon, idEnCours])
  const doublon = useMemo(() => doublonProbable(state, brouillon, idEnCours), [state, brouillon, idEnCours])
  const somme = sommeVentilations(v.ventilations)
  const contratsCandidats = state.contrats.filter((c) => c.type === 'agence' || c.type === 'fournisseur')

  return (
    <Modal titre={titre} onClose={onClose} large>
      <div className="form-row">
        <Field label="Fournisseur">
          <TextInput value={v.fournisseur} onChange={(fournisseur) => set({ fournisseur })} placeholder="ex. BET Structure Nord" />
        </Field>
        <Field label="N° de facture fournisseur" hint="l'unicité tiers + numéro est contrôlée">
          <TextInput value={v.numeroFournisseur} onChange={(numeroFournisseur) => set({ numeroFournisseur })} />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Date de facture">
          <DateInput value={v.dateFacture} onChange={(dateFacture) => set({ dateFacture })} />
        </Field>
        <Field label="Échéance de paiement">
          <DateInput value={v.dateEcheance} onChange={(dateEcheance) => set({ dateEcheance })} />
        </Field>
        <Field label="Contrat / engagement" hint="récurrent (logiciel, assurance…) ou engagement projet">
          <Select
            value={v.contratId}
            onChange={(contratId) => set({ contratId })}
            options={[{ value: '', label: '— aucun —' }, ...contratsCandidats.map((c) => ({ value: c.id, label: c.intitule }))]}
          />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Montant HT (€)">
          <NumInput value={v.montantHT} onChange={(montantHT) => set({ montantHT })} />
        </Field>
        <Field label="TVA (€)">
          <NumInput value={v.montantTVA} onChange={(montantTVA) => set({ montantTVA })} />
        </Field>
        <Field label="TTC (calculé)">
          <div className="input" style={{ display: 'flex', alignItems: 'center' }}>{fmtMoney(ttc, true)}</div>
        </Field>
      </div>

      {/* ----- répartition (ventilations) ----- */}
      <div style={{ marginTop: 14 }}>
        <div className="small" style={{ fontWeight: 650, marginBottom: 6 }}>
          Répartition — {fmtMoney(somme, true)} ventilés / {fmtMoney(v.montantHT ?? 0, true)} HT
        </div>
        <Table
          compact
          head={[<span key="m" className="right">Montant HT</span>, 'Projet', 'Phase', 'Catégorie', 'Refacturable', '']}
        >
          {v.ventilations.map((vent) => (
            <tr key={vent.id}>
              <td style={{ width: 110 }}>
                <NumInput value={vent.montantHT} onChange={(m) => majVentilation(vent.id, { montantHT: m ?? 0 })} />
              </td>
              <td style={{ minWidth: 130 }}>
                <Select
                  value={vent.projetId || ''}
                  onChange={(p) => majVentilation(vent.id, { projetId: p || null, phase: p ? vent.phase : null })}
                  options={[{ value: '', label: 'Agence' }, ...state.projets.map((p) => ({ value: p.id, label: p.id }))]}
                />
              </td>
              <td style={{ width: 100 }}>
                <Select
                  value={vent.phase || ''}
                  onChange={(ph) => majVentilation(vent.id, { phase: (ph || null) as PhaseCode | null })}
                  options={[{ value: '', label: '—' }, ...PHASES_ORDRE.map((c) => ({ value: c, label: c }))]}
                />
              </td>
              <td style={{ minWidth: 170 }}>
                <Select value={vent.categorie} onChange={(categorie) => majVentilation(vent.id, { categorie })} options={CATEGORIES_OPTIONS} />
              </td>
              <td style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={!!vent.refacturable}
                  onChange={(e) => majVentilation(vent.id, { refacturable: e.target.checked })}
                  aria-label="Refacturable au client"
                />
              </td>
              <td>
                {v.ventilations.length > 1 && (
                  <Btn small onClick={() => set({ ventilations: v.ventilations.filter((x) => x.id !== vent.id) })}>✕</Btn>
                )}
              </td>
            </tr>
          ))}
        </Table>
        <div style={{ marginTop: 6 }}>
          <Btn
            small
            onClick={() =>
              set({
                ventilations: [
                  ...v.ventilations,
                  { id: uid('va'), montantHT: Math.max(0, Math.round(((v.montantHT ?? 0) - somme) * 100) / 100), categorie: CATEGORIES_ACHAT[0], projetId: null, phase: null },
                ],
              })
            }
          >
            + Répartir sur une autre ligne
          </Btn>
        </div>
      </div>

      {doublon && (
        <div className="pill-note" style={{ marginTop: 10 }}>
          ⚠ Doublon possible : {doublon.fournisseur} · {fmtMoney(doublon.montantTTC, true)} TTC le {fmtDate(doublon.dateFacture)}
          {doublon.empreinte && empreinte && doublon.empreinte === empreinte ? ' (MÊME fichier déjà déposé)' : ''} — comparer avant de valider.
        </div>
      )}
      {controle.bloquants.length > 0 && (
        <div className="pill-note" style={{ marginTop: 10, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          <ul style={{ margin: '0 0 0 18px' }}>
            {controle.bloquants.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn
          kind="primary"
          disabled={controle.bloquants.length > 0}
          onClick={() => onValider({ ...v, fournisseur: v.fournisseur.trim() }, Math.round(ttc * 100) / 100)}
        >
          Valider la facture
        </Btn>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
// Modal note de frais (parcours allégé)
// ------------------------------------------------------------------

function NoteFraisModal({ onClose, onSave }: { onClose: () => void; onSave: (n: Omit<NoteFrais, 'id'>) => void }) {
  const { state } = useStore()
  const today = useToday()
  const [personne, setPersonne] = useState(state.settings.personnes[0] || '')
  const [date, setDate] = useState<string | null>(today)
  const [fournisseur, setFournisseur] = useState('')
  const [libelle, setLibelle] = useState('')
  const [montantTTC, setMontantTTC] = useState<number | null>(null)
  const [moyen, setMoyen] = useState<'perso' | 'agence'>('perso')
  const [projetId, setProjetId] = useState('')
  const [phase, setPhase] = useState('')
  const [categorie, setCategorie] = useState('Déplacements / hébergement')
  const [kilometres, setKilometres] = useState<number | null>(null)
  return (
    <Modal titre="Note de frais" onClose={onClose}>
      <div className="form-row">
        <Field label="Qui a payé ?">
          <Select value={personne} onChange={setPersonne} options={state.settings.personnes.map((p) => ({ value: p, label: p }))} />
        </Field>
        <Field label="Moyen">
          <Select
            value={moyen}
            onChange={(m) => setMoyen(m as 'perso' | 'agence')}
            options={[{ value: 'perso', label: 'payé personnellement (à rembourser)' }, { value: 'agence', label: 'carte agence' }]}
          />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Date">
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label="Fournisseur">
          <TextInput value={fournisseur} onChange={setFournisseur} placeholder="SNCF, restaurant…" />
        </Field>
        <Field label="TTC (€)">
          <NumInput value={montantTTC} onChange={setMontantTTC} />
        </Field>
      </div>
      <Field label="Libellé">
        <TextInput value={libelle} onChange={setLibelle} placeholder="ex. AR réunion de chantier P03" />
      </Field>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Projet (ou agence)">
          <Select value={projetId} onChange={setProjetId} options={[{ value: '', label: 'Agence' }, ...state.projets.map((p) => ({ value: p.id, label: p.id }))]} />
        </Field>
        <Field label="Phase">
          <Select value={phase} onChange={setPhase} options={[{ value: '', label: '—' }, ...PHASES_ORDRE.map((c) => ({ value: c, label: c }))]} />
        </Field>
        <Field label="Catégorie">
          <Select value={categorie} onChange={setCategorie} options={CATEGORIES_OPTIONS} />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Kilométrage (km)" hint="indemnités km — séparées d'une facture classique">
          <NumInput value={kilometres} onChange={setKilometres} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn
          kind="primary"
          onClick={() => {
            if (!libelle.trim() || montantTTC == null || !date) return toast('Libellé, date et montant TTC obligatoires.', { tone: 'danger' })
            onSave({
              personne,
              date,
              fournisseur: fournisseur.trim() || undefined,
              libelle: libelle.trim(),
              montantTTC,
              moyen,
              projetId: projetId || null,
              phase: (phase || null) as PhaseCode | null,
              categorie,
              kilometres,
              statut: 'a_rembourser',
            })
          }}
        >
          Enregistrer
        </Btn>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
// Attendus (exceptions à confirmer)
// ------------------------------------------------------------------

function LigneAttendu({ a, onSaisir }: { a: AttenduOuvert; onSaisir: (a: AttenduOuvert) => void }) {
  const { update } = useStore()
  const today = useToday()
  const decider = (exception: 'non_recue' | 'contrat_termine' | 'reporte' | 'justifie') => {
    // objet calculé AVANT la mutation (producteur rejouable)
    const decision = {
      id: uid('att'),
      type: a.type === 'justificatif_banque' ? ('justificatif_banque' as const) : ('facture_fournisseur' as const),
      contratId: a.contratId || null,
      periode: a.periode || null,
      transactionId: a.transactionId || null,
      libelle: a.libelle,
      exception,
      date: today,
    }
    update((d) => {
      d.attendusFinanciers.push(decision)
    })
    toast('Exception confirmée — l’attendu est réglé.', { tone: 'ok' })
  }
  return (
    <tr>
      <td>
        {a.libelle}
        <div className="muted small">{a.detail}</div>
      </td>
      <td className="right num">{a.montant != null ? fmtMoney(a.montant) : '—'}</td>
      <td>
        <DateF d={a.date} />
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {a.type === 'facture_fournisseur' && (
            <>
              <Btn small kind="primary" onClick={() => onSaisir(a)}>
                Saisir la facture…
              </Btn>
              <RowMenu
                items={[
                  { label: 'Non reçue (à relancer)', onClick: () => decider('non_recue') },
                  { label: 'Contrat terminé / résilié', onClick: () => decider('contrat_termine') },
                  { label: 'Prélèvement reporté', onClick: () => decider('reporte') },
                ]}
              />
            </>
          )}
          {a.type === 'justificatif_banque' && (
            <a href="#/finance/banque" className="small">
              Rapprocher en banque →
            </a>
          )}
          {a.type === 'montant_anormal' && (
            <Btn small onClick={() => decider('justifie')}>
              C'est normal
            </Btn>
          )}
        </div>
      </td>
    </tr>
  )
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function Achats() {
  const { state, update, replace } = useStore()
  const today = useToday()
  const refXml = useRef<HTMLInputElement>(null)
  const [creation, setCreation] = useState<{ initial: ValeursAchat; source: FactureAchat['source']; contratId?: string } | null>(null)
  const [validation, setValidation] = useState<FactureAchat | null>(null)
  const [noteOuverte, setNoteOuverte] = useState(false)

  const aValider = state.facturesAchat.filter((f) => f.statut === 'a_valider')
  const validees = useMemo(
    () => state.facturesAchat.filter((f) => f.statut === 'validee').sort((a, b) => b.dateFacture.localeCompare(a.dateFacture)),
    [state.facturesAchat],
  )
  const aPayer = validees.filter((f) => !f.payeLe)
  const totalAPayer = aPayer.reduce((s, f) => s + f.montantTTC, 0)
  const enRetard = aPayer.filter((f) => (f.dateEcheance || f.dateFacture) < today)
  const attendus = useMemo(() => attendusOuverts(state, today), [state, today])
  const balance = useMemo(() => balanceFournisseurs(state, today), [state, today])
  const frais = [...state.notesFrais].sort((a, b) => b.date.localeCompare(a.date))
  const fraisARembourser = frais.filter((n) => n.statut === 'a_rembourser' && n.moyen === 'perso')

  const vide: ValeursAchat = {
    fournisseur: '',
    numeroFournisseur: '',
    dateFacture: today,
    dateEcheance: addDays(today, 30),
    montantHT: null,
    montantTVA: null,
    contratId: '',
    ventilations: [{ id: uid('va'), montantHT: 0, categorie: CATEGORIES_ACHAT[0], projetId: null, phase: null }],
  }

  const enregistrer = (id: string | null, v: ValeursAchat, ttc: number, source: FactureAchat['source']) => {
    // pièce construite AVANT la mutation (producteur rejouable)
    const nouvelle: FactureAchat = {
      id: id || uid('fa'),
      fournisseur: v.fournisseur,
      numeroFournisseur: v.numeroFournisseur || undefined,
      dateFacture: v.dateFacture!,
      dateEcheance: v.dateEcheance,
      montantHT: v.montantHT!,
      montantTVA: v.montantTVA,
      montantTTC: ttc,
      ventilations: v.ventilations,
      statut: 'validee',
      source,
      contratId: v.contratId || null,
      evenements: [{ date: today, type: 'validation', detail: `Validée (${fmtMoney(ttc, true)} TTC).` }],
    }
    update((d) => {
      const existante = id ? d.facturesAchat.find((f) => f.id === id) : undefined
      if (existante) {
        Object.assign(existante, nouvelle, {
          source: existante.source,
          documentId: existante.documentId,
          empreinte: existante.empreinte,
          raisons: existante.raisons,
          confiance: existante.confiance,
          evenements: [...(existante.evenements || []), ...nouvelle.evenements!],
        })
      } else {
        d.facturesAchat.push(nouvelle)
      }
    })
    setCreation(null)
    setValidation(null)
    toast('Facture fournisseur validée — elle compte au FACTURÉ (le payé viendra de la banque).', { tone: 'ok' })
  }

  const ecarter = async (f: FactureAchat) => {
    const snap = state
    if (!(await confirmer({ message: `« Ce n'est pas une facture » : écarter la proposition ${f.fournisseur} (${fmtMoney(f.montantTTC, true)} TTC) ?`, confirmerLabel: 'Écarter' }))) return
    update((d) => {
      const x = d.facturesAchat.find((y) => y.id === f.id)
      if (x) x.statut = 'ecartee'
    })
    toast('Proposition écartée.', { undo: () => replace(snap) })
  }

  const marquerPayee = (f: FactureAchat, date: string) =>
    update((d) => {
      const x = d.facturesAchat.find((y) => y.id === f.id)
      if (x) {
        x.payeLe = date
        x.evenements = [...(x.evenements || []), { date, type: 'paiement', detail: 'Marquée payée à la main (hors rapprochement bancaire).' }]
      }
    })

  const importerXml = (file: File) => {
    const lecteur = new FileReader()
    lecteur.onload = () => {
      const lu = lireFactureXML(String(lecteur.result || ''))
      if (!lu) {
        toast('Fichier non reconnu — un XML Factur-X (CII) ou UBL est attendu.', { tone: 'danger' })
        return
      }
      setCreation({
        source: 'xml',
        initial: {
          ...vide,
          fournisseur: lu.fournisseur || '',
          numeroFournisseur: lu.numero || '',
          dateFacture: lu.dateFacture || today,
          dateEcheance: lu.dateEcheance || addDays(today, 30),
          montantHT: lu.totalHT ?? null,
          montantTVA: lu.totalTVA ?? null,
          ventilations: [{ id: uid('va'), montantHT: lu.totalHT ?? 0, categorie: CATEGORIES_ACHAT[0], projetId: null, phase: null }],
        },
      })
      toast(`Facture ${lu.syntaxe.toUpperCase()} lue — vérifier et répartir avant validation.`, { tone: 'ok' })
    }
    lecteur.readAsText(file, 'utf-8')
  }

  return (
    <Page titre="Finance" sousTitre="Achats & frais — charges réelles, notes de frais et détection de ce qui manque.">
      <FinanceNav actif="achats" />

      <div className="grid4" style={{ marginBottom: 16 }}>
        <Stat label="À valider" value={aValider.length} tone={aValider.length > 0 ? 'warn' : 'ok'} sub="boîte d'arrivée — décision humaine" />
        <Stat label="À payer (TTC)" value={<Money v={totalAPayer} />} tone={enRetard.length > 0 ? 'danger' : undefined} sub={enRetard.length > 0 ? `dont ${enRetard.length} échéance(s) dépassée(s)` : 'factures validées non payées'} />
        <Stat label="Attendus ouverts" value={attendus.length} tone={attendus.length > 0 ? 'warn' : 'ok'} sub="récurrents absents · justificatifs · anomalies" />
        <Stat label="Notes de frais" value={fraisARembourser.length} sub={`à rembourser (${fmtMoney(fraisARembourser.reduce((s, n) => s + n.montantTTC, 0))})`} />
      </div>

      {/* ----- boîte d'arrivée ----- */}
      <Card
        titre={`Boîte d'arrivée (${aValider.length})`}
        actions={
          <>
            <Btn small onClick={() => refXml.current?.click()} title="Réception structurée : Factur-X (CII) ou UBL">
              Importer un XML
            </Btn>
            <input
              ref={refXml}
              type="file"
              accept=".xml"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importerXml(f)
                e.target.value = ''
              }}
            />
            <Btn small kind="primary" onClick={() => setCreation({ initial: vide, source: 'manuel' })}>
              Nouvelle dépense
            </Btn>
          </>
        }
      >
        {aValider.length === 0 ? (
          <EmptyState>
            Rien à valider — les pièces arrivent par Gmail/Drive (boîte d'arrivée <a href="#/documents">Documents</a>),
            par dépôt manuel ou par XML structuré.
          </EmptyState>
        ) : (
          <Table compact head={['Fournisseur', 'Reçue', <span key="t" className="right">TTC</span>, 'Proposition', '']}>
            {aValider.map((f) => (
              <tr key={f.id}>
                <td>
                  {f.fournisseur}
                  {f.numeroFournisseur && <span className="muted small"> · {f.numeroFournisseur}</span>}
                </td>
                <td>
                  <DateF d={f.dateFacture} />
                </td>
                <td className="right">
                  <Money v={f.montantTTC} cents />
                </td>
                <td className="small muted" title={(f.raisons || []).join('\n')}>
                  {f.confiance != null ? `confiance ${Math.round(f.confiance * 100)} %` : 'saisie à vérifier'}
                  {f.raisons?.length ? ' · voir pourquoi' : ''}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <Btn small kind="primary" onClick={() => setValidation(f)}>
                      Valider / répartir…
                    </Btn>
                    <Btn small onClick={() => void ecarter(f)}>
                      Ce n'est pas une facture
                    </Btn>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ----- attendus ----- */}
      <Card titre={`Ce qui manque (${attendus.length})`}>
        {attendus.length === 0 ? (
          <EmptyState>Rien d'attendu sans réponse — contrats récurrents honorés, aucun débit sans pièce.</EmptyState>
        ) : (
          <Table compact head={['Attendu', <span key="m" className="right">Montant</span>, 'Depuis', '']}>
            {attendus.map((a) => (
              <LigneAttendu
                key={a.cle}
                a={a}
                onSaisir={(x) =>
                  setCreation({
                    source: 'manuel',
                    contratId: x.contratId,
                    initial: {
                      ...vide,
                      fournisseur: state.contrats.find((c) => c.id === x.contratId)?.tiers || '',
                      contratId: x.contratId || '',
                      montantHT: x.montant ?? null,
                      ventilations: [{ id: uid('va'), montantHT: x.montant ?? 0, categorie: 'Logiciels & abonnements', projetId: null, phase: null }],
                    },
                  })
                }
              />
            ))}
          </Table>
        )}
      </Card>

      {/* ----- échéancier de décaissement ----- */}
      <Card titre={`À payer — échéancier de décaissement (${aPayer.length})`}>
        {aPayer.length === 0 ? (
          <EmptyState>Aucune facture fournisseur en attente de paiement.</EmptyState>
        ) : (
          <Table compact head={['Échéance', 'Fournisseur', 'Affectation', <span key="t" className="right">TTC</span>, '']}>
            {[...aPayer]
              .sort((a, b) => (a.dateEcheance || a.dateFacture).localeCompare(b.dateEcheance || b.dateFacture))
              .map((f) => (
                <tr key={f.id}>
                  <td className={(f.dateEcheance || f.dateFacture) < today ? 'danger-text' : undefined}>
                    <DateF d={f.dateEcheance || f.dateFacture} />
                  </td>
                  <td>
                    {f.fournisseur}
                    {f.numeroFournisseur && <span className="muted small"> · {f.numeroFournisseur}</span>}
                  </td>
                  <td className="small">
                    {f.ventilations.map((v) => (v.projetId ? `${v.projetId}${v.phase ? '/' + v.phase : ''}` : 'agence')).join(' · ')}
                  </td>
                  <td className="right">
                    <Money v={f.montantTTC} cents />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Btn
                        small
                        onClick={() => marquerPayee(f, today)}
                        title="Le rapprochement bancaire fait ça tout seul — bouton de secours"
                      >
                        Payée
                      </Btn>
                      <RowMenu items={[{ label: 'Modifier / répartir…', onClick: () => setValidation(f) }]} />
                    </div>
                  </td>
                </tr>
              ))}
          </Table>
        )}
        <p className="muted small" style={{ margin: '10px 2px 0' }}>
          Budget ≠ engagé ≠ facturé ≠ payé : ici tout est FACTURÉ ; le « payé » vient du rapprochement bancaire
          (<a href="#/finance/banque">Banque</a>) ; les budgets et engagements vivent dans <a href="#/contrats">Contrats</a>.
        </p>
      </Card>

      {/* ----- balance fournisseurs ----- */}
      {balance.length > 0 && (
        <Card titre="Balance fournisseurs (dettes)">
          <Table compact head={['Fournisseur', 'Pièces', <span key="t" className="right">Dû TTC</span>, <span key="r" className="right">Dont en retard</span>, 'Prochaine échéance']}>
            {balance.map((b) => (
              <tr key={b.fournisseur}>
                <td>{b.fournisseur}</td>
                <td>{b.nb}</td>
                <td className="right num">{fmtMoney(b.totalTTC, true)}</td>
                <td className={`right num ${b.enRetardTTC > 0 ? 'danger-text' : ''}`}>{b.enRetardTTC > 0 ? fmtMoney(b.enRetardTTC, true) : '·'}</td>
                <td>{b.prochaineEcheance ? fmtDate(b.prochaineEcheance) : '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {/* ----- notes de frais ----- */}
      <Card
        titre={`Notes de frais (${frais.length})`}
        actions={
          <Btn small kind="primary" onClick={() => setNoteOuverte(true)}>
            Nouvelle note de frais
          </Btn>
        }
      >
        {frais.length === 0 ? (
          <EmptyState>Aucune note de frais — le parcours est volontairement court (date, montant, projet).</EmptyState>
        ) : (
          <Table compact head={['Date', 'Personne', 'Libellé', 'Affectation', <span key="t" className="right">TTC</span>, 'Statut', '']}>
            {frais.map((n) => (
              <tr key={n.id}>
                <td>
                  <DateF d={n.date} />
                </td>
                <td>{n.personne}</td>
                <td>
                  {n.libelle}
                  {n.kilometres ? <span className="muted small"> · {n.kilometres} km</span> : null}
                </td>
                <td className="small">{n.projetId ? `${n.projetId}${n.phase ? '/' + n.phase : ''}` : 'agence'}</td>
                <td className="right">
                  <Money v={n.montantTTC} cents />
                </td>
                <td>
                  {n.statut === 'remboursee' ? (
                    <Badge tone="ok">remboursée</Badge>
                  ) : n.moyen === 'agence' ? (
                    <Badge tone="muted">carte agence</Badge>
                  ) : (
                    <Badge tone="warn">à rembourser</Badge>
                  )}
                </td>
                <td>
                  {n.statut === 'a_rembourser' && n.moyen === 'perso' && (
                    <Btn
                      small
                      onClick={() =>
                        update((d) => {
                          const x = d.notesFrais.find((y) => y.id === n.id)
                          if (x) x.statut = 'remboursee'
                        })
                      }
                    >
                      Remboursée
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ----- modales ----- */}
      {creation && (
        <AchatModal
          titre="Facture fournisseur"
          initial={creation.initial}
          onClose={() => setCreation(null)}
          onValider={(v, ttc) => enregistrer(null, v, ttc, creation.source)}
        />
      )}
      {validation && (
        <AchatModal
          titre={`Valider — ${validation.fournisseur}`}
          initial={depuisFacture(validation)}
          empreinte={validation.empreinte}
          idEnCours={validation.id}
          onClose={() => setValidation(null)}
          onValider={(v, ttc) => enregistrer(validation.id, v, ttc, validation.source)}
        />
      )}
      {noteOuverte && (
        <NoteFraisModal
          onClose={() => setNoteOuverte(false)}
          onSave={(n) => {
            const nouvelle: NoteFrais = { ...n, id: uid('nf') }
            update((d) => {
              d.notesFrais.push(nouvelle)
            })
            setNoteOuverte(false)
            toast('Note de frais enregistrée.', { tone: 'ok' })
          }}
        />
      )}
    </Page>
  )
}
