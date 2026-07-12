// ============================================================
// Banque & trésorerie — audit finance F3.
// - import de relevés CSV avec mapping mémorisé, IDEMPOTENT ;
// - rapprochement PROPOSÉ (montant, référence, tiers), validé à la
//   main — jamais appliqué silencieusement ;
// - le solde manuel devient « solde d'ouverture manuel » dès qu'un
//   relevé existe (écart affiché) ;
// - prévision 13 semaines, 3 scénarios, chaque point EXPLICABLE.
// ============================================================

import { useMemo, useRef, useState } from 'react'
import type { AppState, Facture, MappingBancaire, TransactionBancaire } from '../types'
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
  Select,
  Stat,
  Table,
  TextInput,
  toast,
  useToday,
} from '../ui'
import FinanceNav from './FinanceNav'
import {
  decouperLigneCSV,
  devinerMapping,
  ecartSoldeManuel,
  lireReleve,
  preparerImport,
  soldeBancaire,
  suggestionsPourCredit,
} from '../banque'
import { contratsPourDebit, suggestionsAchatPourDebit } from '../achats'
import { prevision13Semaines, type Prevision13, type Scenario } from '../tresorerie'
import { nouveauPaiement, soldeFacture } from '../facture'
import { nomProjet } from '../derive'
import { fmtDate, fmtMoney, uid } from '../util'

// ------------------------------------------------------------------
// Courbe de trésorerie 13 semaines (partagée avec la Vue d'ensemble)
// ------------------------------------------------------------------

export function CourbeTresorerie({ prevision, seuil }: { prevision: Prevision13; seuil: number }) {
  const largeur = 520
  const hauteur = 120
  const soldes = [prevision.soldeDepart, ...prevision.semaines.map((s) => s.solde)]
  const min = Math.min(...soldes, seuil, 0)
  const max = Math.max(...soldes, 1)
  const y = (v: number) => hauteur - ((v - min) / (max - min || 1)) * (hauteur - 14) - 7
  const xPas = largeur / (soldes.length - 1)
  const points = soldes.map((v, i) => `${Math.round(i * xPas)},${Math.round(y(v))}`).join(' ')
  const yZero = y(0)
  return (
    <svg
      viewBox={`0 0 ${largeur} ${hauteur}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label="Courbe de trésorerie prévisionnelle sur 13 semaines"
    >
      {min < 0 && <line x1={0} y1={yZero} x2={largeur} y2={yZero} stroke="var(--danger)" strokeDasharray="4 4" strokeWidth={1} />}
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {soldes.map((v, i) => (
        <circle key={i} cx={Math.round(i * xPas)} cy={Math.round(y(v))} r={2.5} fill={v < seuil ? 'var(--danger)' : 'var(--accent)'} />
      ))}
    </svg>
  )
}

// ------------------------------------------------------------------
// Import de relevé (mapping ajustable, aperçu, idempotence)
// ------------------------------------------------------------------

function ImportModal({ texte, nomFichier, onClose }: { texte: string; nomFichier: string; onClose: () => void }) {
  const { state, update } = useStore()
  const [mapping, setMapping] = useState<MappingBancaire>(() => state.settings.banqueMapping || devinerMapping(texte))
  const [soldeFinal, setSoldeFinal] = useState<number | null>(null)
  const [dateSolde, setDateSolde] = useState<string | null>(null)
  const set = (patch: Partial<MappingBancaire>) => setMapping((m) => ({ ...m, ...patch }))

  const lecture = useMemo(() => lireReleve(texte, mapping), [texte, mapping])
  const colonnes = useMemo(() => {
    const premiere = texte.split(/\r?\n/).find((l) => l.trim()) || ''
    return decouperLigneCSV(premiere, mapping.separateur)
  }, [texte, mapping.separateur])
  const optionsColonnes = colonnes.map((c, i) => ({ value: String(i), label: `${i + 1} — ${c.slice(0, 24) || '(vide)'}` }))

  const importer = () => {
    if (lecture.lignes.length === 0) return toast('Aucune ligne lisible avec ce mapping.', { tone: 'danger' })
    // tout est calculé AVANT la mutation (producteur rejouable)
    const importId = uid('imp')
    const { nouvelles, doublons } = preparerImport(state, lecture.lignes, importId)
    const meta = {
      id: importId,
      date: new Date().toISOString().slice(0, 10),
      nomFichier,
      nbLignes: lecture.lignes.length,
      nbNouvelles: nouvelles.length,
      soldeFinal,
      dateSolde: soldeFinal != null ? dateSolde || lecture.lignes.map((l) => l.date).sort().pop() || null : null,
    }
    update((d) => {
      d.transactionsBancaires.push(...nouvelles)
      d.importsBancaires.push(meta)
      d.settings.banqueMapping = mapping
    })
    toast(
      `${nouvelles.length} mouvement(s) importé(s), ${doublons} déjà connu(s)${lecture.ignorées ? `, ${lecture.ignorées} ligne(s) illisible(s)` : ''}.`,
      { tone: 'ok' },
    )
    onClose()
  }

  return (
    <Modal titre={`Importer le relevé — ${nomFichier}`} onClose={onClose} large>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        Le mapping est mémorisé pour les prochains imports. Réimporter le même relevé n'ajoutera aucune
        ligne (identifiant date + montant + libellé).
      </p>
      <div className="form-row">
        <Field label="Séparateur">
          <Select
            value={mapping.separateur === '\t' ? 'tab' : mapping.separateur}
            onChange={(v) => set({ separateur: v === 'tab' ? '\t' : v })}
            options={[{ value: ';', label: '; (point-virgule)' }, { value: ',', label: ', (virgule)' }, { value: 'tab', label: 'tabulation' }]}
          />
        </Field>
        <Field label="Format de date">
          <Select
            value={mapping.formatDate}
            onChange={(v) => set({ formatDate: v as MappingBancaire['formatDate'] })}
            options={[{ value: 'JJ/MM/AAAA', label: 'JJ/MM/AAAA' }, { value: 'AAAA-MM-JJ', label: 'AAAA-MM-JJ' }]}
          />
        </Field>
        <Field label="Première ligne">
          <Select
            value={mapping.entete ? 'oui' : 'non'}
            onChange={(v) => set({ entete: v === 'oui' })}
            options={[{ value: 'oui', label: 'en-têtes (ignorée)' }, { value: 'non', label: 'données' }]}
          />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Colonne date">
          <Select value={String(mapping.colDate)} onChange={(v) => set({ colDate: Number(v) })} options={optionsColonnes} />
        </Field>
        <Field label="Colonne libellé">
          <Select value={String(mapping.colLibelle)} onChange={(v) => set({ colLibelle: Number(v) })} options={optionsColonnes} />
        </Field>
        <Field label="Montant (signé)" hint="ou débit/crédit séparés ci-dessous">
          <Select
            value={mapping.colMontant == null ? '' : String(mapping.colMontant)}
            onChange={(v) => set({ colMontant: v === '' ? null : Number(v) })}
            options={[{ value: '', label: '— débit/crédit séparés —' }, ...optionsColonnes]}
          />
        </Field>
      </div>
      {mapping.colMontant == null && (
        <div className="form-row" style={{ marginTop: 10 }}>
          <Field label="Colonne débit">
            <Select value={String(mapping.colDebit ?? '')} onChange={(v) => set({ colDebit: v === '' ? null : Number(v) })} options={[{ value: '', label: '—' }, ...optionsColonnes]} />
          </Field>
          <Field label="Colonne crédit">
            <Select value={String(mapping.colCredit ?? '')} onChange={(v) => set({ colCredit: v === '' ? null : Number(v) })} options={[{ value: '', label: '—' }, ...optionsColonnes]} />
          </Field>
        </div>
      )}
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Solde de fin de relevé (€)" hint="optionnel — cale le solde bancaire affiché">
          <NumInput value={soldeFinal} onChange={setSoldeFinal} />
        </Field>
        <Field label="Date du solde">
          <DateInput value={dateSolde} onChange={setDateSolde} />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="small" style={{ fontWeight: 650, marginBottom: 4 }}>
          Aperçu : {lecture.lignes.length} ligne(s) lisible(s){lecture.ignorées ? ` · ${lecture.ignorées} ignorée(s)` : ''}
        </div>
        {lecture.lignes.slice(0, 4).map((l, i) => (
          <div key={i} className="small muted">
            {l.date} · {fmtMoney(l.montant, true)} · {l.libelle.slice(0, 60)}
          </div>
        ))}
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={importer}>
          Importer {lecture.lignes.length} mouvement(s)
        </Btn>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
// Rapprochement d'un mouvement
// ------------------------------------------------------------------

function LigneMouvement({ t }: { t: TransactionBancaire }) {
  const { state, update } = useStore()
  const today = useToday()
  const [ouvert, setOuvert] = useState(false)

  const validerPaiementClient = (factures: Facture[], montants: number[]) => {
    // calculé AVANT la mutation (producteur rejouable)
    const p = nouveauPaiement(
      t.date,
      t.montant,
      factures.map((f, i) => ({ factureId: f.id, montant: montants[i] })),
      t.libelle.slice(0, 60),
      'virement',
    )
    update((d) => {
      d.paiements.push(p)
      for (const f of factures) {
        const x = d.factures.find((y) => y.id === f.id)
        if (!x) continue
        const solde = soldeFacture(d, x)
        if (solde <= 0.01) {
          x.statut = 'encaissee'
          x.encaissementReel = t.date
        }
        x.evenements = [...(x.evenements || []), { date: t.date, type: 'paiement', detail: `Rapproché du relevé — ${t.libelle.slice(0, 60)}` }]
      }
      const tx = d.transactionsBancaires.find((y) => y.id === t.id)
      if (tx) tx.rapprochement = { type: 'paiement_client', paiementId: p.id, valideLe: today }
    })
    toast('Encaissement rapproché — paiement créé, statut dérivé du solde.', { tone: 'ok' })
  }

  const payerAchat = (achatId: string) => {
    update((d) => {
      const f = d.facturesAchat.find((y) => y.id === achatId)
      if (f) {
        f.payeLe = t.date
        f.transactionId = t.id
        // le rapprochement bancaire est la PREUVE du paiement (audit F6)
        f.paiementAConfirmer = false
        f.evenements = [...(f.evenements || []), { date: t.date, type: 'paiement', detail: `Rapproché du relevé (${fmtMoney(Math.abs(t.montant), true)}).` }]
      }
      const tx = d.transactionsBancaires.find((y) => y.id === t.id)
      if (tx) tx.rapprochement = { type: 'facture_achat', factureAchatId: achatId, valideLe: today }
    })
    toast('Débit rapproché de la facture fournisseur.', { tone: 'ok' })
  }

  const rembourserNoteFrais = (noteId: string) => {
    update((d) => {
      const n = d.notesFrais.find((y) => y.id === noteId)
      if (n) n.statut = 'remboursee'
      const tx = d.transactionsBancaires.find((y) => y.id === t.id)
      if (tx) tx.rapprochement = { type: 'note_frais', noteFraisId: noteId, valideLe: today }
    })
    toast('Débit rapproché du remboursement de note de frais.', { tone: 'ok' })
  }

  const justifier = (type: 'interne' | 'justifie', detail?: string) =>
    update((d) => {
      const tx = d.transactionsBancaires.find((y) => y.id === t.id)
      if (tx) tx.rapprochement = { type, detail, valideLe: today }
    })

  const suggestionsCredit = t.montant > 0 && !t.rapprochement ? suggestionsPourCredit(state, t) : []
  const suggestionsDebit = t.montant < 0 && !t.rapprochement ? suggestionsAchatPourDebit(state, t) : []
  const contrats = t.montant < 0 && !t.rapprochement ? contratsPourDebit(state, t) : []
  const notesCandidates =
    t.montant < 0 && !t.rapprochement
      ? state.notesFrais.filter((n) => n.statut === 'a_rembourser' && Math.abs(n.montantTTC - Math.abs(t.montant)) < 0.01)
      : []

  return (
    <tr>
      <td>
        <DateF d={t.date} />
      </td>
      <td>
        {t.libelle.slice(0, 70)}
        {ouvert && !t.rapprochement && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {suggestionsCredit.map((s, i) => (
              <Btn key={i} small kind={i === 0 ? 'primary' : 'default'} onClick={() => validerPaiementClient(s.factures, s.montants)} title={s.raisons.join(' · ')}>
                Paiement {s.factures.map((f) => f.numero || f.id).join(' + ')} — {s.raisons[0]}
              </Btn>
            ))}
            {suggestionsDebit.map((s, i) => (
              <Btn key={i} small kind={i === 0 ? 'primary' : 'default'} onClick={() => payerAchat(s.f.id)} title={s.raisons.join(' · ')}>
                Fournisseur {s.f.fournisseur}{s.f.numeroFournisseur ? ` (${s.f.numeroFournisseur})` : ''} — {s.raisons[0]}
              </Btn>
            ))}
            {notesCandidates.map((n) => (
              <Btn key={n.id} small onClick={() => rembourserNoteFrais(n.id)}>
                Remboursement note de frais {n.personne} ({fmtMoney(n.montantTTC, true)})
              </Btn>
            ))}
            {contrats.map((c) => (
              <span key={c.id} className="small muted">
                Ressemble au contrat « {c.intitule} » — saisir la facture dans <a href="#/finance/achats">Achats & frais</a>
              </span>
            ))}
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Btn small onClick={() => justifier('interne', 'virement interne / mouvement d’épargne')}>
                Mouvement interne
              </Btn>
              <Btn
                small
                onClick={() => {
                  const motif = window.prompt('Justification (sans pièce) :')
                  if (motif) justifier('justifie', motif)
                }}
              >
                Justifier sans pièce…
              </Btn>
            </span>
            {suggestionsCredit.length === 0 && suggestionsDebit.length === 0 && notesCandidates.length === 0 && (
              <span className="small muted">Aucune correspondance automatique — le Cockpit ne rapproche jamais de force.</span>
            )}
          </div>
        )}
      </td>
      <td className={`right num ${t.montant < 0 ? '' : 'ok-text'}`}>{fmtMoney(t.montant, true)}</td>
      <td>
        {t.rapprochement ? (
          <Badge tone="ok">
            {t.rapprochement.type === 'paiement_client'
              ? 'encaissement'
              : t.rapprochement.type === 'facture_achat'
                ? 'fournisseur'
                : t.rapprochement.type === 'note_frais'
                  ? 'note de frais'
                  : t.rapprochement.type === 'interne'
                    ? 'interne'
                    : 'justifié'}
          </Badge>
        ) : (
          <Btn small kind="primary" onClick={() => setOuvert((o) => !o)}>
            {ouvert ? 'Fermer' : 'Rapprocher…'}
          </Btn>
        )}
      </td>
    </tr>
  )
}

// ------------------------------------------------------------------
// Prévision 13 semaines (détaillée)
// ------------------------------------------------------------------

function CartePrevision({ state, today }: { state: AppState; today: string }) {
  const [scenario, setScenario] = useState<Scenario>('probable')
  const prevision = useMemo(() => prevision13Semaines(state, today, scenario), [state, today, scenario])
  const seuil = state.settings.seuilTresorerie ?? 0
  return (
    <Card titre="Prévision de trésorerie — 13 semaines">
      <div className="toolbar" style={{ marginBottom: 10 }}>
        {(['prudent', 'probable', 'favorable'] as Scenario[]).map((s) => (
          <Btn key={s} small kind={scenario === s ? 'primary' : 'default'} onClick={() => setScenario(s)}>
            {s}
          </Btn>
        ))}
        <div className="spacer" />
        <span className="small muted">
          départ {fmtMoney(prevision.soldeDepart)} ({prevision.sourceSolde === 'banque' ? 'solde bancaire importé' : prevision.sourceSolde === 'manuel' ? 'solde d’ouverture manuel' : 'aucun solde connu'})
        </span>
      </div>
      {prevision.pointBas.solde < seuil && (
        <div className="pill-note" style={{ marginBottom: 10, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          Point bas : <strong>{fmtMoney(prevision.pointBas.solde)}</strong> la semaine du {fmtDate(prevision.pointBas.lundi)}
          {seuil > 0 ? ` (seuil d'alerte ${fmtMoney(seuil)})` : ''} — anticiper (relances, décalage de décaissements).
        </div>
      )}
      <CourbeTresorerie prevision={prevision} seuil={seuil} />
      <Table
        compact
        head={['Semaine', <span key="e" className="right">Entrées</span>, <span key="s" className="right">Sorties</span>, <span key="so" className="right">Solde</span>, '']}
      >
        {prevision.semaines.map((s) => {
          const totalE = s.entrees.reduce((x, f) => x + f.montant, 0)
          const totalS = s.sorties.reduce((x, f) => x + f.montant, 0)
          return (
            <tr key={s.lundi}>
              <td>{fmtDate(s.lundi)}</td>
              <td className="right num ok-text">{totalE > 0 ? fmtMoney(totalE) : '·'}</td>
              <td className="right num">{totalS < 0 ? fmtMoney(totalS) : '·'}</td>
              <td className={`right num ${s.solde < seuil ? 'danger-text' : ''}`} style={{ fontWeight: 600 }}>
                {fmtMoney(s.solde)}
              </td>
              <td>
                {(s.entrees.length > 0 || s.sorties.length > 0) && (
                  <details>
                    <summary className="small" style={{ cursor: 'pointer' }}>
                      {s.entrees.length + s.sorties.length} flux
                    </summary>
                    {[...s.entrees, ...s.sorties].map((f, i) => (
                      <div key={i} className="small" style={{ padding: '2px 0' }}>
                        <span className={f.montant < 0 ? '' : 'ok-text'}>{fmtMoney(f.montant)}</span> — {f.lien ? <a href={f.lien}>{f.libelle}</a> : f.libelle} <span className="muted">({fmtDate(f.date)})</span>
                      </div>
                    ))}
                  </details>
                )}
              </td>
            </tr>
          )
        })}
      </Table>
      <p className="muted small" style={{ margin: '10px 2px 0' }}>
        Scénarios : <strong>prudent</strong> retarde les encaissements de 15 j et pondère les échéances non émises à
        70 % · <strong>probable</strong> utilise le délai de paiement réellement constaté · <strong>favorable</strong>{' '}
        suppose le paiement à l'échéance. Salaires, contrats récurrents et TVA paramétrée inclus.
      </p>
    </Card>
  )
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function Banque() {
  const { state } = useStore()
  const today = useToday()
  const refFichier = useRef<HTMLInputElement>(null)
  const [importEnCours, setImportEnCours] = useState<{ texte: string; nom: string } | null>(null)
  const [voirTout, setVoirTout] = useState(false)

  const banque = soldeBancaire(state)
  const ecart = ecartSoldeManuel(state)
  const nonRapprochees = state.transactionsBancaires.filter((t) => !t.rapprochement)
  const mouvements = useMemo(
    () =>
      [...state.transactionsBancaires]
        .filter((t) => voirTout || !t.rapprochement)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 120),
    [state.transactionsBancaires, voirTout],
  )

  const chargerFichier = (file: File) => {
    const lecteur = new FileReader()
    lecteur.onload = () => setImportEnCours({ texte: String(lecteur.result || ''), nom: file.name })
    lecteur.readAsText(file, 'utf-8')
  }

  return (
    <Page titre="Finance" sousTitre="Banque & trésorerie — mouvements réels, rapprochement et prévision.">
      <FinanceNav actif="banque" />

      <div className="grid4" style={{ marginBottom: 16 }}>
        <Stat
          label={banque ? 'Solde bancaire (importé)' : 'Solde d’ouverture manuel'}
          value={banque ? <Money v={banque.solde} /> : state.settings.tresorerieDispo != null ? <Money v={state.settings.tresorerieDispo} /> : '—'}
          sub={
            banque
              ? `relevé + mouvements depuis le ${fmtDate(banque.date)}`
              : 'saisi dans Paramètres — importez un relevé pour le solde réel'
          }
        />
        <Stat
          label="Écart avec le solde manuel"
          value={ecart != null ? fmtMoney(ecart) : '—'}
          tone={ecart != null && Math.abs(ecart) > 1 ? 'warn' : undefined}
          sub={ecart != null ? 'solde importé − solde saisi' : 'visible dès qu’un relevé est importé'}
        />
        <Stat
          label="À rapprocher"
          value={nonRapprochees.length}
          tone={nonRapprochees.length > 0 ? 'warn' : 'ok'}
          sub="mouvements sans pièce ni justification"
        />
        <Stat label="Relevés importés" value={state.importsBancaires.length} sub="réimporter un relevé ne crée aucun doublon" />
      </div>

      <Card
        titre={`Mouvements (${voirTout ? state.transactionsBancaires.length : nonRapprochees.length}${voirTout ? '' : ' à rapprocher'})`}
        actions={
          <>
            <Btn small onClick={() => setVoirTout((v) => !v)}>{voirTout ? 'À rapprocher seulement' : 'Tout afficher'}</Btn>
            <Btn small kind="primary" onClick={() => refFichier.current?.click()}>
              Importer un relevé (CSV)
            </Btn>
            <input
              ref={refFichier}
              type="file"
              accept=".csv,.txt,.tsv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) chargerFichier(f)
                e.target.value = ''
              }}
            />
          </>
        }
      >
        {state.transactionsBancaires.length === 0 ? (
          <EmptyState>
            Aucun mouvement — exportez un relevé CSV depuis votre banque et importez-le ici. Le mapping des
            colonnes est mémorisé, l'import est idempotent (OFX/CAMT et connexion directe : plus tard).
          </EmptyState>
        ) : mouvements.length === 0 ? (
          <EmptyState>Tout est rapproché ✓</EmptyState>
        ) : (
          <Table compact head={['Date', 'Libellé / rapprochement', <span key="m" className="right">Montant</span>, 'État']}>
            {mouvements.map((t) => (
              <LigneMouvement key={t.id} t={t} />
            ))}
          </Table>
        )}
      </Card>

      <CartePrevision state={state} today={today} />

      {importEnCours && (
        <ImportModal texte={importEnCours.texte} nomFichier={importEnCours.nom} onClose={() => setImportEnCours(null)} />
      )}
    </Page>
  )
}
