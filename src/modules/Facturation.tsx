// ============================================================
// Facturation — audit finance F0 : la PRÉVISION n'est pas la PIÈCE.
// · Les ÉCHÉANCES (prévisions sans numéro) se créent, se modifient
//   et se suppriment librement ;
// · l'ÉMISSION est un parcours contrôlé : contrôles bloquants,
//   numéro légal attribué à l'instant même, copie figée + empreinte ;
// · une facture émise ne se modifie ni ne se supprime — la
//   correction passe par un AVOIR qui référence l'origine ;
// · le statut de paiement se DÉRIVE des paiements enregistrés
//   (partiels compris), il ne se choisit pas.
// Règle d'or : Claude propose, l'humain valide — les relances
// sont des brouillons à relire avant tout envoi.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, EcheanceFacturation, EvenementTransmission, Facture, LigneFacture, PhaseCode, TypeMO } from '../types'
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
  navigate,
  toast,
  useRoute,
  useToday,
} from '../ui'
import {
  delaiMoyenPaiement,
  encaissementPrevu,
  encaissementPrevuEcheance,
  nomProjet,
  projetById,
  retardFacture,
  ttc,
} from '../derive'
// le TEXTE de la relance d'impayé a UN propriétaire (src/alerts.ts) : le fil
// d'urgences et cet écran relancent avec les mêmes mots — jamais deux
// rédactions concurrentes du même courrier au client (constat R3).
import { corpsRelanceImpaye, sujetRelanceImpaye } from '../alerts'
import {
  brouillonAvoir,
  construireFigee,
  controlerAvantEmission,
  derniereTransmission,
  empreinteFigee,
  erreurInsertionFacture,
  erreurRapprochementHistorique,
  estADeposer,
  etatPaiement,
  montantRestantAnnulableHT,
  nouveauPaiement,
  prochainNumero,
  regleSurFacture,
  soldeFacture,
  totauxAvoirPourEmission,
  totauxLignes,
  trousNumerotation,
  validerAvoir,
  validerPaiement,
} from '../facture'
import type { BrouillonFacture } from '../facture'
import { LIBELLES_PHASES, PHASES_ORDRE } from '../miqcp'
import { assemble, contexteFacture, copier } from '../prompts'
import { download, fmtDate, fmtMoney, fold, ouvrirGmail, uid } from '../util'
import { ouvrirFacturePDF } from '../pdf'
import { genererCII, nomFichierCII } from '../facturx'
import FinanceNav from './FinanceNav'

// ---------- helpers locaux ----------

const TYPES_MO: TypeMO[] = ['Public', 'Privé pro', 'Particulier']

interface ResultatMutation {
  ok: boolean
  erreur?: string
}

/** niveaux de relance graduée, du plus doux au plus ferme */
const NIVEAUX_RELANCE: { tplId: string; label: string }[] = [
  { tplId: 'tpl-relance-courtoise', label: 'Courtoise' },
  { tplId: 'tpl-relance-ferme', label: 'Ferme' },
  { tplId: 'tpl-relance-med', label: 'Mise en demeure' },
]

/** niveau conseillé selon le retard (indicatif : l'humain choisit) */
function niveauConseille(retardJours: number): number {
  if (retardJours >= 35) return 2
  if (retardJours >= 15) return 1
  return 0
}

/** statut DÉRIVÉ du solde (audit F0) — jamais choisi à la main */
function BadgeEtat({ state, f, today }: { state: AppState; f: Facture; today: string }) {
  if (f.type === 'avoir') return <Badge tone="warn">avoir</Badge>
  const etat = etatPaiement(state, f)
  if (etat === 'payee') return <Badge tone="ok">payée</Badge>
  const retard = retardFacture(state, f, today)
  if (retard > 0) return <Badge tone="danger">en retard {retard} j</Badge>
  if (etat === 'partielle') return <Badge tone="warn">partiellement réglée</Badge>
  return <Badge tone="info">émise</Badge>
}

// ---------- cycle de vie portail (5.16) : le statut REMONTE dans l'écran ----------

/** libellés français des statuts RÉELS du type EvenementTransmission —
 *  jamais réinterprétés : le badge dit ce que la plateforme a dit */
const LIBELLES_TRANSMISSION: Record<EvenementTransmission['statut'], string> = {
  deposee: 'déposée',
  rejetee: 'rejetée',
  mise_a_disposition: 'mise à disposition',
  approuvee: 'approuvée',
  payee: 'payée (plateforme)',
}

/** badge du DERNIER statut portail (le plus récent par date — un import CSV
 *  rejoué peut ajouter un événement ancien en fin de tableau) */
function BadgeTransmission({ t }: { t: EvenementTransmission }) {
  const tone = t.statut === 'rejetee' ? 'danger' : t.statut === 'approuvee' || t.statut === 'payee' ? 'ok' : 'info'
  return (
    <Badge tone={tone}>
      {t.plateforme} · {LIBELLES_TRANSMISSION[t.statut]}
    </Badge>
  )
}

// ---------- modal d'échéance (prévision libre, sans numéro) ----------

interface ValeursEcheance {
  projetId: string
  phase: PhaseCode
  libelle: string
  montantHT: number | null
  tvaPct: number | null
  datePrevue: string | null
  delaiJours: number | null
}

function EcheanceModal({
  titre,
  initial,
  creation,
  state,
  onClose,
  onSave,
}: {
  titre: string
  initial: ValeursEcheance
  creation: boolean
  state: AppState
  onClose: () => void
  onSave: (v: ValeursEcheance) => void
}) {
  const [v, setV] = useState(initial)
  const set = (patch: Partial<ValeursEcheance>) => setV((prev) => ({ ...prev, ...patch }))
  /** création guidée : l'échéance part d'une phase (pré-remplie) ou reste libre */
  const [source, setSource] = useState<'phase' | 'libre'>('phase')

  // au changement de projet, le délai de paiement se pré-remplit selon le type de MO
  const changerProjet = (projetId: string) => {
    const p = projetById(state, projetId)
    set({ projetId, delaiJours: p ? state.settings.delaisPaiement[p.typeMO] : v.delaiJours })
  }

  const projetSel = projetById(state, v.projetId)
  /** reste à facturer d'une phase = honoraires − factures et échéances déjà posées dessus */
  const resteDePhase = (code: PhaseCode): number => {
    const ph = projetSel?.phases.find((x) => x.code === code)
    if (!ph) return 0
    const deja =
      state.factures
        .filter((f) => f.projetId === v.projetId && f.phase === code)
        .reduce((sum, f) => sum + f.montantHT, 0) +
      state.echeancesFacturation
        .filter((e) => e.projetId === v.projetId && e.phase === code)
        .reduce((sum, e) => sum + e.montantHT, 0)
    return Math.max(0, ph.montantHT - deja)
  }
  const choisirPhase = (code: PhaseCode) => {
    if (creation && source === 'phase') {
      const reste = resteDePhase(code)
      set({
        phase: code,
        montantHT: reste > 0 ? Math.round(reste * 100) / 100 : v.montantHT,
        libelle: v.libelle.trim() ? v.libelle : `${code} — ${LIBELLES_PHASES[code]}`,
      })
    } else {
      set({ phase: code })
    }
  }

  const valider = () => {
    if (!v.projetId) return toast('Choisir un projet.', { tone: 'danger' })
    if (!v.libelle.trim()) return toast('Indiquer un libellé.', { tone: 'danger' })
    if (v.montantHT === null) return toast('Indiquer le montant HT.', { tone: 'danger' })
    if (!v.datePrevue) return toast('Indiquer la date de facturation prévue.', { tone: 'danger' })
    if (v.delaiJours === null) return toast('Indiquer le délai de paiement (jours).', { tone: 'danger' })
    onSave({ ...v, libelle: v.libelle.trim() })
    toast(creation ? 'Échéance créée — l’émission (numéro, gel) se fera au moment voulu.' : 'Échéance modifiée.', { tone: 'ok' })
  }

  return (
    <Modal titre={titre} onClose={onClose}>
      {creation && (
        <div className="form-row">
          <Field label="Source" hint="une phase pré-remplit montant et libellé">
            <Select
              value={source}
              onChange={(x) => setSource(x as 'phase' | 'libre')}
              options={[
                { value: 'phase', label: 'Depuis une phase du projet' },
                { value: 'libre', label: 'Échéance libre' },
              ]}
            />
          </Field>
          <Field label="Projet">
            <Select
              value={v.projetId}
              onChange={changerProjet}
              options={[
                { value: '', label: '— choisir —' },
                ...state.projets.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
              ]}
            />
          </Field>
        </div>
      )}
      {creation && source === 'phase' && (
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          Les situations de travaux validées se facturent depuis <a href="#/situations">Situations</a>{' '}
          (« Facturer les honoraires DET ») — ici, on prévoit une phase de mission.
        </p>
      )}
      {!creation && (
        <div className="form-row">
          <Field label="Projet">
            <Select
              value={v.projetId}
              onChange={changerProjet}
              options={[
                { value: '', label: '— choisir —' },
                ...state.projets.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
              ]}
            />
          </Field>
        </div>
      )}
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Phase" hint={creation && source === 'phase' ? 'choisir la phase remplit le reste' : undefined}>
          <Select
            value={v.phase}
            onChange={(phase) => choisirPhase(phase as PhaseCode)}
            options={(creation && source === 'phase' && projetSel
              ? projetSel.phases.map((ph) => ph.code)
              : PHASES_ORDRE
            ).map((c) => ({
              value: c,
              label:
                creation && source === 'phase' && projetSel
                  ? `${c} — reste à facturer ${fmtMoney(resteDePhase(c))}`
                  : `${c} — ${LIBELLES_PHASES[c]}`,
            }))}
          />
        </Field>
        <Field label="Libellé">
          <TextInput value={v.libelle} onChange={(libelle) => set({ libelle })} placeholder="ex. APS — remise" />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Montant HT (€)">
          <NumInput value={v.montantHT} onChange={(montantHT) => set({ montantHT })} />
        </Field>
        <Field label="Facturation prévue le" hint="simple prévision — le numéro n'existera qu'à l'émission">
          <DateInput value={v.datePrevue} onChange={(datePrevue) => set({ datePrevue })} />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="TVA (%)">
          <NumInput value={v.tvaPct} onChange={(tvaPct) => set({ tvaPct })} placeholder="20" />
        </Field>
        <Field label="Délai de paiement (jours)" hint="pré-rempli selon le type de MO du projet">
          <NumInput value={v.delaiJours} onChange={(delaiJours) => set({ delaiJours })} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={valider}>
          {creation ? "Créer l'échéance" : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- modal d'ÉMISSION (le cœur F0 : contrôles, numéro, gel) ----------

function EmissionModal({
  echeance,
  state,
  today,
  onClose,
  onEmettre,
}: {
  echeance: EcheanceFacturation
  state: AppState
  today: string
  onClose: () => void
  onEmettre: (
    nouvelle: Facture,
    adresseFacturation: string,
    echeanceAttendue: EcheanceFacturation,
    brouillonAttendu: BrouillonFacture,
  ) => Promise<ResultatMutation>
}) {
  const projet = projetById(state, echeance.projetId)
  const [dateEmission, setDateEmission] = useState<string | null>(today)
  const [clientNom, setClientNom] = useState(projet?.moa || '')
  const [clientAdresse, setClientAdresse] = useState(projet?.adresseFacturation || '')
  const [numeroEngagement, setNumeroEngagement] = useState(projet?.numeroEngagement || '')
  const [horsContrat, setHorsContrat] = useState('')
  const [emissionEnCours, setEmissionEnCours] = useState(false)
  const verrouEmission = useRef(false)
  const [lignes, setLignes] = useState<LigneFacture[]>([
    {
      id: uid('lig'),
      designation: echeance.libelle,
      quantite: 1,
      unite: 'forfait',
      prixUnitaireHT: echeance.montantHT,
      tauxTVA: echeance.tauxTVA,
      phase: echeance.phase,
    },
  ])

  const majLigne = (id: string, patch: Partial<LigneFacture>) =>
    setLignes((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  const ajouterLigne = () =>
    setLignes((prev) => [
      ...prev,
      { id: uid('lig'), designation: '', quantite: 1, unite: 'forfait', prixUnitaireHT: 0, tauxTVA: echeance.tauxTVA },
    ])
  const retirerLigne = (id: string) => setLignes((prev) => prev.filter((l) => l.id !== id))

  const brouillon: BrouillonFacture = useMemo(
    () => ({
      projetId: echeance.projetId,
      clientNom,
      clientAdresse,
      dateEmission: dateEmission || '',
      lignes,
      numeroEngagement: numeroEngagement || undefined,
      horsContratJustifie: horsContrat || undefined,
    }),
    [echeance.projetId, clientNom, clientAdresse, dateEmission, lignes, numeroEngagement, horsContrat],
  )
  const controle = useMemo(() => controlerAvantEmission(state, projet, brouillon), [state, projet, brouillon])
  const totaux = totauxLignes(lignes)
  const numeroPrevu = dateEmission ? prochainNumero(state, dateEmission) : '—'
  const fermerSiLibre = () => {
    if (!verrouEmission.current) onClose()
  }

  const emettre = async () => {
    if (controle.bloquants.length > 0 || !dateEmission) return
    // Le ref ferme la fenêtre entre le clic et le prochain rendu React.
    if (verrouEmission.current) return
    verrouEmission.current = true
    setEmissionEnCours(true)
    let terminee = false
    try {
      const numero = prochainNumero(state, dateEmission)
      const figee = construireFigee(state, brouillon, numero, projet?.objetFacture || undefined, echeance.delaiJours)
      figee.empreinte = await empreinteFigee(figee)
      const nouvelle: Facture = {
        // l'id INTERNE de l'échéance est conservé : les liens (situation…) restent valides
        id: echeance.id,
        projetId: echeance.projetId,
        phase: echeance.phase,
        libelle: echeance.libelle,
        montantHT: totaux.ht,
        tauxTVA: totaux.ht !== 0 ? Math.round((totaux.tva / totaux.ht) * 10000) / 10000 : echeance.tauxTVA,
        emission: dateEmission,
        delaiJours: echeance.delaiJours,
        statut: 'emise',
        situationId: echeance.situationId ?? null,
        contratLigneId: echeance.contratLigneId ?? null,
        numero,
        type: 'facture',
        lignes: lignes.map((l) => ({ ...l })),
        figee,
        evenements: [
          {
            date: dateEmission,
            type: 'emission',
            detail: `Numéro ${numero} attribué, pièce figée${figee.empreinte ? ` (empreinte ${figee.empreinte.slice(0, 12)}…)` : ''}.`,
          },
        ],
      }
      const resultat = await onEmettre(nouvelle, clientAdresse, echeance, brouillon)
      if (!resultat.ok) {
        toast(resultat.erreur || 'La facture n’a pas pu être émise.', { tone: 'danger' })
        return
      }
      terminee = true
      // pas de toast ici : la fin d'émission ouvre la confirmation qui PORTE
      // les deux gestes suivants (PDF, e-mail) — audit T8, action n° 20
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'La facture n’a pas pu être émise.', { tone: 'danger' })
    } finally {
      if (!terminee) {
        verrouEmission.current = false
        setEmissionEnCours(false)
      }
    }
  }

  return (
    <Modal
      titre={`Émettre la facture — ${echeance.projetId} · ${echeance.libelle}`}
      onClose={fermerSiLibre}
      large
    >
      <p className="muted small" style={{ margin: '0 0 12px' }}>
        L'émission attribue le numéro <strong className="mono">{numeroPrevu}</strong> et FIGE la pièce
        (copie complète + empreinte) : elle ne sera plus modifiable — toute correction passera par un avoir.
      </p>
      <div className="form-row">
        <Field label="Client facturé (mention légale)">
          <TextInput value={clientNom} onChange={setClientNom} placeholder="ex. OPAC de l'Oise" />
        </Field>
        <Field label="Date d'émission" hint="le numéro suit la séquence de cette année">
          <DateInput value={dateEmission} onChange={setDateEmission} />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Adresse de facturation" hint="mémorisée sur la fiche projet">
          <TextInput value={clientAdresse} onChange={setClientAdresse} placeholder="n°, rue, CP, ville" />
        </Field>
        {projet?.typeMO === 'Public' && (
          <Field label="N° d'engagement / marché" hint="exigé par la plupart des payeurs publics (Chorus)">
            <TextInput value={numeroEngagement} onChange={setNumeroEngagement} />
          </Field>
        )}
      </div>

      {/* ----- lignes de la facture ----- */}
      <div style={{ marginTop: 14 }}>
        <Table
          compact
          head={[
            'Désignation',
            <span key="q" className="right">Qté</span>,
            'Unité',
            <span key="pu" className="right">PU HT</span>,
            <span key="tva" className="right">TVA %</span>,
            <span key="ht" className="right">HT</span>,
            '',
          ]}
        >
          {lignes.map((l) => (
            <tr key={l.id}>
              <td style={{ minWidth: 220 }}>
                <TextInput value={l.designation} onChange={(designation) => majLigne(l.id, { designation })} placeholder="désignation précise" />
              </td>
              <td style={{ width: 70 }}>
                <NumInput value={l.quantite} onChange={(q) => majLigne(l.id, { quantite: q ?? 1 })} />
              </td>
              <td style={{ width: 90 }}>
                <TextInput value={l.unite} onChange={(unite) => majLigne(l.id, { unite })} />
              </td>
              <td style={{ width: 110 }}>
                <NumInput value={l.prixUnitaireHT} onChange={(pu) => majLigne(l.id, { prixUnitaireHT: pu ?? 0 })} />
              </td>
              <td style={{ width: 80 }}>
                <NumInput
                  value={Math.round(l.tauxTVA * 10000) / 100}
                  onChange={(pct) => majLigne(l.id, { tauxTVA: (pct ?? 20) / 100 })}
                />
              </td>
              <td className="right num">{fmtMoney(l.quantite * l.prixUnitaireHT)}</td>
              <td>
                {lignes.length > 1 && (
                  <Btn small onClick={() => retirerLigne(l.id)} title="Retirer la ligne">✕</Btn>
                )}
              </td>
            </tr>
          ))}
        </Table>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <Btn small onClick={ajouterLigne}>+ Ajouter une ligne</Btn>
          <div className="spacer" />
          <span className="small">
            HT <strong>{fmtMoney(totaux.ht, true)}</strong> · TVA {fmtMoney(totaux.tva, true)} · TTC{' '}
            <strong>{fmtMoney(totaux.ttc, true)}</strong>
          </span>
        </div>
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          Mention TVA : « {state.settings.mentionTVA || 'TVA sur les encaissements'} » (réglable dans Paramètres) ·
          paiement à {echeance.delaiJours} jours.
        </p>
      </div>

      {/* ----- contrôles avant émission ----- */}
      {controle.bloquants.length > 0 && (
        <div className="pill-note" style={{ marginTop: 12, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          <strong>Émission bloquée :</strong>
          <ul style={{ margin: '4px 0 0 18px' }}>
            {controle.bloquants.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {controle.alertes.length > 0 && (
        <div className="pill-note" style={{ marginTop: 10 }}>
          {controle.alertes.map((a, i) => (
            <div key={i}>⚠ {a}</div>
          ))}
        </div>
      )}
      {controle.bloquants.some((b) => b.includes('contrat')) && (
        <Field label="Justification « hors contrat » (débloque l'émission en la traçant)">
          <TextInput value={horsContrat} onChange={setHorsContrat} placeholder="ex. mission complémentaire commandée par courriel du…" />
        </Field>
      )}

      <div className="form-foot">
        <Btn disabled={emissionEnCours} onClick={fermerSiLibre}>Annuler</Btn>
        <Btn
          kind="primary"
          disabled={emissionEnCours || controle.bloquants.length > 0}
          onClick={() => void emettre()}
        >
          {emissionEnCours ? 'Émission en cours…' : `Émettre (${numeroPrevu})`}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- fin d'émission : la confirmation PORTE les deux gestes suivants ----------
// Audit T8 (action n° 20) : émettre n'est pas la fin du geste — il reste à
// sortir le PDF et à préparer l'e-mail. Les renvoyer « au menu de la ligne »
// obligeait à retrouver la facture en bas d'une liste triée à l'envers :
// 3 à 4 gestes de trop sur le geste central du mois. Les deux fonctions
// existent déjà (ouvrirFacturePDF, emailFacture) — elles sont ici.

function EmiseModal({ f, state, onClose }: { f: Facture; state: AppState; onClose: () => void }) {
  const projet = projetById(state, f.projetId)
  return (
    <Modal titre={`Facture ${f.numero || f.id} émise`} onClose={onClose}>
      <p className="muted small" style={{ margin: '0 0 12px' }}>
        Pièce figée{f.figee?.empreinte ? ` (empreinte ${f.figee.empreinte.slice(0, 12)}…)` : ''} : elle n'est plus
        modifiable — toute correction passera par un avoir. Il reste deux gestes, ils sont ici.
      </p>
      <dl className="kv" style={{ marginBottom: 14 }}>
        <dt>Projet</dt>
        <dd>
          {f.projetId} — {nomProjet(state, f.projetId)}
        </dd>
        <dt>Libellé</dt>
        <dd>{f.libelle}</dd>
        <dt>Montant TTC</dt>
        <dd>
          <strong>{fmtMoney(ttc(f), true)}</strong> ({fmtMoney(f.figee?.totalHT ?? f.montantHT, true)} HT)
        </dd>
        <dt>Paiement attendu</dt>
        <dd>{fmtDate(encaissementPrevu(f))}</dd>
        <dt>Destinataire</dt>
        <dd>{projet?.emailMOA || <span className="muted">adresse inconnue — à compléter dans la fiche projet</span>}</dd>
      </dl>
      <div className="form-foot">
        <Btn onClick={onClose}>Fermer</Btn>
        <Btn onClick={() => ouvrirFacturePDF(state, f)} title="Vue imprimable de la copie figée — jamais un recalcul">
          Ouvrir le PDF
        </Btn>
        <Btn kind="primary" onClick={() => emailFacture(state, f)} title="Ouvre un brouillon Gmail pré-rempli — l'envoi reste votre clic">
          Préparer l'e-mail
        </Btn>
      </div>
      <p className="muted small" style={{ margin: '10px 2px 0' }}>
        Les deux gestes restent disponibles plus tard dans le menu de la ligne.
      </p>
    </Modal>
  )
}

// ---------- modal de paiement (le statut se dérive du solde) ----------

function PaiementModal({
  f,
  state,
  today,
  onClose,
  onConfirm,
}: {
  f: Facture
  state: AppState
  today: string
  onClose: () => void
  onConfirm: (date: string, montant: number, moyen: string, reference: string) => Promise<ResultatMutation>
}) {
  const solde = soldeFacture(state, f)
  const regle = regleSurFacture(state, f.id)
  const [date, setDate] = useState<string | null>(today)
  const [montant, setMontant] = useState<number | null>(solde)
  const [moyen, setMoyen] = useState('virement')
  const [reference, setReference] = useState('')
  const [enregistrementEnCours, setEnregistrementEnCours] = useState(false)
  const verrouPaiement = useRef(false)
  const controlePaiement = validerPaiement(
    state,
    montant ?? 0,
    [{ factureId: f.id, montant: montant ?? 0 }],
  )
  const erreurPaiement = montant !== null && !controlePaiement.valide ? controlePaiement.erreurs[0] : null
  const fermerSiLibre = () => {
    if (!verrouPaiement.current) onClose()
  }

  const confirmerPaiement = async () => {
    if (!date) return toast('Indiquer la date du paiement.', { tone: 'danger' })
    if (montant === null) return toast('Indiquer le montant reçu.', { tone: 'danger' })
    if (!controlePaiement.valide) return toast(controlePaiement.erreurs[0], { tone: 'danger' })
    if (verrouPaiement.current) return
    verrouPaiement.current = true
    setEnregistrementEnCours(true)
    let termine = false
    try {
      const resultat = await onConfirm(date, montant, moyen, reference)
      if (!resultat.ok) {
        toast(resultat.erreur || 'Le paiement n’a pas pu être enregistré.', { tone: 'danger' })
        return
      }
      termine = true
      toast('Paiement enregistré — le statut découle du solde.', { tone: 'ok' })
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Le paiement n’a pas pu être enregistré.', { tone: 'danger' })
    } finally {
      if (!termine) {
        verrouPaiement.current = false
        setEnregistrementEnCours(false)
      }
    }
  }

  return (
    <Modal
      titre={`Paiement reçu — facture ${f.numero || f.id}`}
      onClose={fermerSiLibre}
    >
      <dl className="kv" style={{ marginBottom: 14 }}>
        <dt>Libellé</dt>
        <dd>{f.libelle}</dd>
        <dt>Montant TTC</dt>
        <dd>
          <Money v={ttc(f)} cents />
        </dd>
        {regle > 0 && (
          <>
            <dt>Déjà réglé</dt>
            <dd>{fmtMoney(regle, true)}</dd>
          </>
        )}
        <dt>Solde</dt>
        <dd>
          <strong>{fmtMoney(solde, true)}</strong>
        </dd>
        <dt>Échéance prévue</dt>
        <dd>{fmtDate(encaissementPrevu(f))}</dd>
      </dl>
      <div className="form-row">
        <Field label="Date du paiement">
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label="Montant reçu (TTC)" hint="un paiement partiel laisse la facture « partiellement réglée »">
          <NumInput value={montant} onChange={setMontant} />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Moyen">
          <Select
            value={moyen}
            onChange={setMoyen}
            options={['virement', 'chèque', 'espèces', 'autre'].map((m) => ({ value: m, label: m }))}
          />
        </Field>
        <Field label="Référence (relevé, chèque…)">
          <TextInput value={reference} onChange={setReference} />
        </Field>
      </div>
      {erreurPaiement && (
        <div className="pill-note" style={{ marginTop: 10, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {erreurPaiement}
        </div>
      )}
      <div className="form-foot">
        <Btn disabled={enregistrementEnCours} onClick={fermerSiLibre}>Annuler</Btn>
        <Btn
          kind="primary"
          disabled={enregistrementEnCours || !date || montant === null || !controlePaiement.valide}
          onClick={() => void confirmerPaiement()}
        >
          {enregistrementEnCours ? 'Enregistrement…' : 'Enregistrer le paiement'}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- modal d'avoir (la correction traçable) ----------

function AvoirModal({
  f,
  state,
  today,
  onClose,
  onConfirm,
}: {
  f: Facture
  state: AppState
  today: string
  onClose: () => void
  onConfirm: (avoir: Facture) => Promise<ResultatMutation>
}) {
  const [mode, setMode] = useState<'total' | 'partiel'>('total')
  const [montantPartiel, setMontantPartiel] = useState<number | null>(null)
  const [date, setDate] = useState<string | null>(today)
  const [emissionEnCours, setEmissionEnCours] = useState(false)
  const verrouEmission = useRef(false)
  const numeroPrevu = date ? prochainNumero(state, date) : '—'
  const htOrigine = f.figee?.totalHT ?? f.montantHT
  const montantRestantHT = montantRestantAnnulableHT(state, f)
  const montantDemandeHT = mode === 'total' ? montantRestantHT : montantPartiel ?? 0
  const controleAvoir = validerAvoir(state, f, montantDemandeHT)
  const erreursVisibles =
    mode === 'total' || montantPartiel !== null
      ? controleAvoir.erreurs
      : controleAvoir.erreurs.filter((e) => !e.includes('strictement positif'))
  const fermerSiLibre = () => {
    if (!verrouEmission.current) onClose()
  }

  const creer = async () => {
    if (!date) return toast("Indiquer la date d'émission de l'avoir.", { tone: 'danger' })
    if (!controleAvoir.valide) return toast(controleAvoir.erreurs[0], { tone: 'danger' })
    // Le ref rend le verrou effectif dès le premier clic, avant le rendu disabled.
    if (verrouEmission.current) return
    verrouEmission.current = true
    setEmissionEnCours(true)
    let terminee = false
    try {
      // Un avoir partiel est réparti sur tous les taux encore annulables.
      // En mode total, le moteur reprend exactement le solde de chaque taux.
      const lignes = brouillonAvoir(
        state,
        f,
        mode === 'partiel' ? montantDemandeHT : undefined,
      )
      const totaux = totauxAvoirPourEmission(state, f, lignes, mode === 'total')
      const numero = prochainNumero(state, date)
      const brouillon: BrouillonFacture = {
        projetId: f.projetId,
        clientNom: f.figee?.clientNom || projetById(state, f.projetId)?.moa || '',
        clientAdresse: f.figee?.clientAdresse || projetById(state, f.projetId)?.adresseFacturation || '',
        dateEmission: date,
        lignes,
        numeroEngagement: f.figee?.numeroEngagement,
      }
      const figee = construireFigee(state, brouillon, numero, `Avoir sur facture ${f.numero || f.id}`, f.delaiJours)
      figee.totalHT = totaux.ht
      figee.totalTVA = totaux.tva
      figee.totalTTC = totaux.ttc
      figee.ventilationTVA = totaux.ventilationTVA
      figee.empreinte = await empreinteFigee(figee)
      const avoir: Facture = {
        id: uid('fac'),
        projetId: f.projetId,
        phase: f.phase,
        libelle: `Avoir sur facture ${f.numero || f.id}`,
        montantHT: totaux.ht, // négatif
        tauxTVA: f.tauxTVA,
        emission: date,
        delaiJours: f.delaiJours,
        statut: 'emise',
        numero,
        type: 'avoir',
        factureOrigineId: f.id,
        lignes,
        figee,
        evenements: [{ date, type: 'emission', detail: `Avoir ${numero} sur la facture ${f.numero || f.id}.` }],
      }
      const resultat = await onConfirm(avoir)
      if (!resultat.ok) {
        toast(resultat.erreur || 'L’avoir n’a pas pu être émis.', { tone: 'danger' })
        return
      }
      terminee = true
      toast(`Avoir ${avoir.numero} émis — il référence la facture d'origine.`, { tone: 'ok' })
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'L’avoir n’a pas pu être émis.', { tone: 'danger' })
    } finally {
      if (!terminee) {
        verrouEmission.current = false
        setEmissionEnCours(false)
      }
    }
  }

  return (
    <Modal
      titre={`Créer un avoir — facture ${f.numero || f.id}`}
      onClose={fermerSiLibre}
    >
      <p className="muted small" style={{ margin: '0 0 12px' }}>
        Une facture émise ne se corrige jamais en silence : l'avoir <strong className="mono">{numeroPrevu}</strong>{' '}
        (numéroté dans la même séquence) annule tout ou partie de la pièce d'origine, les deux restent lisibles.
      </p>
      <div className="pill-note" style={{ marginBottom: 10 }}>
        Montant d’origine : <strong>{fmtMoney(htOrigine, true)} HT</strong> · encore annulable :{' '}
        <strong>{fmtMoney(montantRestantHT, true)} HT</strong>.
      </div>
      <div className="form-row">
        <Field label="Portée">
          <Select
            value={mode}
            onChange={(m) => setMode(m as 'total' | 'partiel')}
            options={[
              { value: 'total', label: `Annuler le solde restant (${fmtMoney(montantRestantHT, true)} HT)` },
              { value: 'partiel', label: 'Avoir partiel (montant HT à saisir)' },
            ]}
          />
        </Field>
        <Field label="Date d'émission de l'avoir">
          <DateInput value={date} onChange={setDate} />
        </Field>
      </div>
      {mode === 'partiel' && (
        <div className="form-row" style={{ marginTop: 10 }}>
          <Field label="Montant HT de l'avoir (positif)" hint={`maximum ${fmtMoney(montantRestantHT, true)} HT`}>
            <NumInput value={montantPartiel} onChange={setMontantPartiel} />
          </Field>
        </div>
      )}
      {erreursVisibles.length > 0 && (
        <div className="pill-note" style={{ marginTop: 10, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {erreursVisibles[0]}
        </div>
      )}
      <div className="form-foot">
        <Btn disabled={emissionEnCours} onClick={fermerSiLibre}>Annuler</Btn>
        <Btn
          kind="primary"
          disabled={emissionEnCours || !date || !controleAvoir.valide}
          onClick={() => void creer()}
        >
          {emissionEnCours ? 'Émission en cours…' : `Émettre l’avoir (${numeroPrevu})`}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- modal de rapprochement (factures HISTORIQUES, jamais gelées) ----------

interface ValeursHistorique {
  libelle: string
  montantHT: number | null
  tvaPct: number | null
  emission: string | null
  delaiJours: number | null
}

function HistoriqueModal({
  f,
  onClose,
  onSave,
}: {
  f: Facture
  onClose: () => void
  onSave: (v: ValeursHistorique) => Promise<ResultatMutation>
}) {
  const [v, setV] = useState<ValeursHistorique>({
    libelle: f.libelle,
    montantHT: f.montantHT,
    tvaPct: Math.round(f.tauxTVA * 10000) / 100,
    emission: f.emission,
    delaiJours: f.delaiJours,
  })
  const [enregistrementEnCours, setEnregistrementEnCours] = useState(false)
  const verrouEnregistrement = useRef(false)
  const set = (patch: Partial<ValeursHistorique>) => setV((prev) => ({ ...prev, ...patch }))
  const enregistrer = async () => {
    if (
      !v.libelle.trim() ||
      v.montantHT === null ||
      !Number.isFinite(v.montantHT) ||
      v.montantHT <= 0 ||
      v.tvaPct === null ||
      !Number.isFinite(v.tvaPct) ||
      v.tvaPct < 0 ||
      v.tvaPct > 100 ||
      !v.emission ||
      v.delaiJours === null ||
      !Number.isFinite(v.delaiJours) ||
      v.delaiJours < 0
    ) {
      toast('Indiquer un montant HT positif, une TVA entre 0 et 100 %, une date et un délai positif ou nul.', {
        tone: 'danger',
      })
      return
    }
    if (verrouEnregistrement.current) return
    verrouEnregistrement.current = true
    setEnregistrementEnCours(true)
    let terminee = false
    try {
      const resultat = await onSave({ ...v, libelle: v.libelle.trim() })
      if (!resultat.ok) {
        toast(resultat.erreur || 'Cette facture historique ne peut pas être rapprochée.', {
          tone: 'danger',
        })
        return
      }
      terminee = true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Cette facture historique ne peut pas être rapprochée.', {
        tone: 'danger',
      })
    } finally {
      if (!terminee) {
        verrouEnregistrement.current = false
        setEnregistrementEnCours(false)
      }
    }
  }
  return (
    <Modal
      titre={`Rapprocher la facture historique ${f.numero || f.id}`}
      onClose={() => {
        if (!verrouEnregistrement.current) onClose()
      }}
    >
      <p className="muted small" style={{ margin: '0 0 12px' }}>
        Facture migrée, jamais gelée : alignez-la sur le PDF réellement envoyé. Les factures émises par le
        nouveau parcours ne sont, elles, plus modifiables.
      </p>
      <Field label="Libellé">
        <TextInput value={v.libelle} onChange={(libelle) => set({ libelle })} />
      </Field>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Montant HT (€)">
          <NumInput value={v.montantHT} onChange={(montantHT) => set({ montantHT })} />
        </Field>
        <Field label="TVA (%)">
          <NumInput value={v.tvaPct} onChange={(tvaPct) => set({ tvaPct })} />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Date d'émission">
          <DateInput value={v.emission} onChange={(emission) => set({ emission })} />
        </Field>
        <Field label="Délai de paiement (jours)">
          <NumInput value={v.delaiJours} onChange={(delaiJours) => set({ delaiJours })} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn disabled={enregistrementEnCours} onClick={onClose}>Annuler</Btn>
        <Btn
          kind="primary"
          disabled={enregistrementEnCours}
          onClick={() => void enregistrer()}
        >
          {enregistrementEnCours ? 'Enregistrement…' : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- suivi de transmission (F5 — Chorus Pro / PDP, audit §11.4) ----------

function TransmissionModal({
  f,
  today,
  onClose,
  onAjouter,
}: {
  f: Facture
  today: string
  onClose: () => void
  onAjouter: (e: EvenementTransmission) => void
}) {
  const [plateforme, setPlateforme] = useState<EvenementTransmission['plateforme']>('chorus')
  const [statut, setStatut] = useState<EvenementTransmission['statut']>('deposee')
  const [date, setDate] = useState<string | null>(today)
  const [reference, setReference] = useState('')
  const [motif, setMotif] = useState('')
  return (
    <Modal titre={`Transmission — facture ${f.numero || f.id}`} onClose={onClose}>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        Le cycle de vie (dépôt, rejet, mise à disposition, paiement) est MÉMORISÉ ici tant que la
        plateforme n'est pas branchée — un rejet devient une action précise avec son motif.
      </p>
      {(f.transmissions || []).length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {(f.transmissions || []).map((t, i) => (
            <div key={i} className="small" style={{ padding: '2px 0' }}>
              {fmtDate(t.date)} · <Badge tone={t.statut === 'rejetee' ? 'danger' : t.statut === 'payee' ? 'ok' : 'info'}>{t.statut.replace(/_/g, ' ')}</Badge> {t.plateforme}
              {t.reference ? ` · réf ${t.reference}` : ''}
              {t.motif ? ` — ${t.motif}` : ''}
            </div>
          ))}
        </div>
      )}
      <div className="form-row">
        <Field label="Plateforme">
          <Select
            value={plateforme}
            onChange={(v) => setPlateforme(v as EvenementTransmission['plateforme'])}
            options={[
              { value: 'chorus', label: 'Chorus Pro (client public)' },
              { value: 'pdp', label: 'Plateforme agréée (PDP)' },
              { value: 'email', label: 'E-mail (PDF)' },
              { value: 'autre', label: 'Autre' },
            ]}
          />
        </Field>
        <Field label="Statut">
          <Select
            value={statut}
            onChange={(v) => setStatut(v as EvenementTransmission['statut'])}
            options={[
              { value: 'deposee', label: 'Déposée' },
              { value: 'rejetee', label: 'Rejetée' },
              { value: 'mise_a_disposition', label: 'Mise à disposition' },
              { value: 'approuvee', label: 'Approuvée' },
              { value: 'payee', label: 'Payée (côté plateforme)' },
            ]}
          />
        </Field>
        <Field label="Date">
          <DateInput value={date} onChange={setDate} />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Référence plateforme">
          <TextInput value={reference} onChange={setReference} placeholder="n° de dépôt / d'engagement" />
        </Field>
        <Field label="Motif (obligatoire si rejet)">
          <TextInput value={motif} onChange={setMotif} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Fermer</Btn>
        <Btn
          kind="primary"
          onClick={() => {
            if (!date) return toast('Indiquer la date.', { tone: 'danger' })
            if (statut === 'rejetee' && !motif.trim()) return toast('Un rejet porte toujours son motif.', { tone: 'danger' })
            onAjouter({ date, plateforme, statut, reference: reference.trim() || undefined, motif: motif.trim() || undefined })
          }}
        >
          Enregistrer l'événement
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- carte « Relances à faire » ----------

function CarteRelances({ state, today }: { state: AppState; today: string }) {
  const { update } = useStore()
  const enRetard = state.factures
    .filter((f) => f.type !== 'avoir' && retardFacture(state, f, today) > 0)
    .sort((a, b) => retardFacture(state, b, today) - retardFacture(state, a, today))

  // trace la relance au clic (date + niveau + historique) et RENVOIE de quoi
  // l'annuler : un geste tracé reste un geste rattrapable (patron ui.tsx)
  const marquerRelance = (f: Facture, niveau: number): (() => void) => {
    const avant = {
      derniereRelance: f.derniereRelance ?? null,
      niveauRelance: f.niveauRelance ?? null,
      relances: f.relances ? f.relances.map((r) => ({ ...r })) : undefined,
    }
    update((d) => {
      const x = d.factures.find((y) => y.id === f.id)
      if (!x) return
      x.derniereRelance = today
      x.niveauRelance = niveau
      x.relances = [...(x.relances || []), { date: today, niveau }]
    })
    return () =>
      update((d) => {
        const x = d.factures.find((y) => y.id === f.id)
        if (!x) return
        x.derniereRelance = avant.derniereRelance
        x.niveauRelance = avant.niveauRelance
        x.relances = avant.relances
      })
  }

  /** Le geste courant : un brouillon Gmail PRÊT (destinataire, sujet, corps),
   *  relance de niveau 1 — factuelle, celle qu'on envoie neuf fois sur dix.
   *  Le texte vient de src/alerts.ts, la trace est posée au clic comme avant,
   *  et l'envoi reste un clic humain (§15). */
  const relancerParEmail = (f: Facture, retard: number) => {
    const email = projetById(state, f.projetId)?.emailMOA || ''
    ouvrirGmail(
      email,
      sujetRelanceImpaye(f),
      corpsRelanceImpaye(f, encaissementPrevu(f), retard, nomProjet(state, f.projetId), state.settings.nomAgence),
    )
    const annuler = marquerRelance(f, 0)
    toast(
      email
        ? `Brouillon de relance ouvert pour ${email} — relance tracée (courtoise). L'envoi reste votre clic.`
        : "Brouillon ouvert — aucune adresse connue pour ce maître d'ouvrage : le destinataire est à compléter (fiche projet).",
      { tone: email ? 'ok' : 'warn', undo: annuler },
    )
  }

  /** Les rédactions plus fermes restent des brouillons Claude à relire : un
   *  fil d'actions ne doit pas pouvoir durcir le ton d'un courrier au client
   *  d'un seul clic. */
  const copierBrouillon = async (f: Facture, niveau: number, corps: string, projetClaude: string) => {
    if (!(await copier(assemble(corps, contexteFacture(state, f))))) {
      toast('La copie dans le presse-papier a échoué.', { tone: 'danger' })
      return
    }
    const annuler = marquerRelance(f, niveau)
    toast(
      `Brouillon « ${NIVEAUX_RELANCE[niveau].label} » copié — à coller dans le Projet Claude « ${projetClaude} ». Relance tracée.`,
      { tone: 'ok', undo: annuler },
    )
  }

  return (
    <Card titre="Relances à faire">
      {enRetard.length === 0 ? (
        <EmptyState>Aucun retard.</EmptyState>
      ) : (
        <>
          <p className="muted small" style={{ marginBottom: 10 }}>
            « Relancer par e-mail » ouvre un brouillon Gmail déjà rempli (destinataire, objet, corps) — relance
            courtoise, envoi humain. Les niveaux plus fermes restent des brouillons à faire rédiger et relire.
          </p>
          <Table
            compact
            head={['N°', 'Projet', 'Libellé', <span key="ttc" style={{ display: 'block', textAlign: 'right' }}>Solde TTC</span>, 'Retard', 'Dernière relance', 'Relancer']}
          >
            {enRetard.map((f) => {
              const retard = retardFacture(state, f, today)
              const conseille = niveauConseille(retard)
              return (
                <tr key={f.id}>
                  <td className="mono">{f.numero || f.id}</td>
                  <td>
                    <a href={`#/projets/${f.projetId}`} title={nomProjet(state, f.projetId)}>
                      {f.projetId}
                    </a>
                  </td>
                  <td>{f.libelle}</td>
                  <td className="right">
                    <Money v={soldeFacture(state, f)} cents />
                  </td>
                  <td>
                    <Badge tone="danger">{retard} j</Badge>
                  </td>
                  <td className="small muted">
                    {f.derniereRelance ? (
                      <span title={(f.relances || []).map((r) => `${fmtDate(r.date)} — ${NIVEAUX_RELANCE[r.niveau]?.label ?? 'relance'}`).join('\n')}>
                        {fmtDate(f.derniereRelance)}
                        {f.niveauRelance != null && ` · ${NIVEAUX_RELANCE[f.niveauRelance]?.label ?? ''}`}
                        {(f.relances?.length ?? 0) > 1 && ` (${f.relances!.length})`}
                      </span>
                    ) : (
                      '— jamais'
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                      <Btn
                        small
                        kind="primary"
                        onClick={() => relancerParEmail(f, retard)}
                        title="Ouvre Gmail avec la relance déjà rédigée (destinataire, objet, corps) — l'envoi reste votre clic"
                      >
                        Relancer par e-mail…
                      </Btn>
                      <RowMenu
                        label="Brouillon Claude"
                        items={NIVEAUX_RELANCE.map((n, i) => {
                          const t = state.prompts.find((x) => x.id === n.tplId)
                          return {
                            label: `${n.label}${i === conseille ? ' · conseillé' : ''}${t ? '' : ' (gabarit absent)'}`,
                            title: t
                              ? `Copie le brouillon à faire rédiger dans le Projet Claude « ${t.projetClaude} » — relu avant envoi`
                              : `Gabarit « ${n.tplId} » introuvable dans la bibliothèque de prompts`,
                            onClick: () => {
                              if (!t) {
                                toast(`Gabarit « ${n.tplId} » introuvable dans la bibliothèque de prompts.`, { tone: 'danger' })
                                return
                              }
                              void copierBrouillon(f, i, t.corps, t.projetClaude)
                            },
                          }
                        })}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </Table>
        </>
      )}
    </Card>
  )
}

/** e-mail d'envoi de facture, prêt dans Gmail — l'envoi reste un clic humain */
function emailFacture(state: AppState, f: Facture): void {
  const p = projetById(state, f.projetId)
  const numero = f.numero || f.id
  const sujet = `${state.settings.nomAgence} — ${f.type === 'avoir' ? 'avoir' : 'facture'} ${numero} · ${p ? p.nom : f.projetId}`
  const corps = [
    'Bonjour,',
    '',
    `Veuillez trouver ci-joint notre ${f.type === 'avoir' ? 'avoir' : 'facture'} n° ${numero} — ${f.libelle} —`,
    `d'un montant de ${fmtMoney(ttc(f), true)} TTC (${fmtMoney(f.figee?.totalHT ?? f.montantHT, true)} HT),`,
    `payable au ${fmtDate(encaissementPrevu(f))}.`,
    '',
    'Nous restons à votre disposition,',
    `${state.settings.nomAgence}`,
    '',
    '⚠ Pense-bête : joindre le PDF de la facture (bouton PDF du Cockpit) avant envoi.',
  ].join('\n')
  ouvrirGmail(p?.emailMOA || '', sujet, corps)
}

// ---------- module ----------

export default function Facturation() {
  const { state, update, replace } = useStore()
  const today = useToday()
  const route = useRoute()

  const [filtreProjet, setFiltreProjet] = useState('')
  const [filtreEtat, setFiltreEtat] = useState('')
  const [recherche, setRecherche] = useState('')
  const [creation, setCreation] = useState(false)
  const [editionEcheance, setEditionEcheance] = useState<EcheanceFacturation | null>(null)
  const [emissionLocale, setEmissionLocale] = useState<EcheanceFacturation | null>(null)
  const [paiement, setPaiement] = useState<Facture | null>(null)
  const [avoir, setAvoir] = useState<Facture | null>(null)
  const [rapprochement, setRapprochement] = useState<Facture | null>(null)
  const [transmission, setTransmission] = useState<Facture | null>(null)
  /** facture qui vient d'être émise : sa confirmation porte les deux gestes
   *  suivants (PDF, e-mail) au lieu de renvoyer au menu de la ligne (T8) */
  const [emise, setEmise] = useState<Facture | null>(null)

  // route profonde `#/facturation/emettre/<id>` (Cockpit, alertes) → parcours d'émission
  const emissionRouteId = route[1] === 'emettre' ? route[2] : null

  // route profonde `#/facturation/chercher/<terme>` (palette « / ») : le terme
  // cherché voyage dans le lien et se dépose dans la recherche de la liste —
  // il était retapé à l'arrivée (T6, parcours 9). Le champ reste modifiable :
  // la route PROPOSE le filtre, elle ne le verrouille pas.
  const termeRoute = route[1] === 'chercher' ? route[2] || '' : ''
  useEffect(() => {
    if (termeRoute) setRecherche(termeRoute)
  }, [termeRoute])
  const echeanceEmission =
    emissionLocale ?? (emissionRouteId ? state.echeancesFacturation.find((e) => e.id === emissionRouteId) ?? null : null)
  const fermerEmission = () => {
    setEmissionLocale(null)
    if (emissionRouteId) navigate('/facturation')
  }

  // ----- stats de tête -----
  const enRetard = state.factures.filter((f) => f.type !== 'avoir' && retardFacture(state, f, today) > 0)
  const montantRetardTTC = enRetard.reduce((s, f) => s + soldeFacture(state, f), 0)
  // cumuls bornés à l'ANNÉE en cours : « depuis toujours » ne se compare à
  // rien (ni à l'objectif de CA, ni à la déclaration) et gonfle chaque année
  const annee = today.slice(0, 4)
  const factureCumulHT = state.factures
    .filter((f) => f.emission.slice(0, 4) === annee)
    .reduce((s, f) => s + f.montantHT, 0)
  const encaisseCumulTTC = state.paiements
    .filter((p) => p.date.slice(0, 4) === annee)
    .reduce((s, p) => s + p.montant, 0)
  const delaiGlobal = delaiMoyenPaiement(state)
  const delaisParMO = TYPES_MO.map((t) => ({ t, v: delaiMoyenPaiement(state, t) })).filter(
    (x) => x.v !== null,
  )
  const trous = trousNumerotation(state, today.slice(0, 4))
  const aControler = state.factures.filter((f) => f.historiqueAControler)
  // 5.16 — cycle de vie portail : un rejet est une action urgente (corriger,
  // redéposer), une facture publique jamais déposée est un encaissement qui
  // n'arrivera pas — les deux doivent se voir SANS ouvrir chaque ligne.
  const rejetees = state.factures.filter((f) => derniereTransmission(f)?.statut === 'rejetee')
  const aDeposer = state.factures.filter((f) => estADeposer(f, projetById(state, f.projetId)))

  // ----- échéances (prévisions), triées par date prévue -----
  const echeances = useMemo(
    () =>
      state.echeancesFacturation
        .filter((e) => !filtreProjet || e.projetId === filtreProjet)
        .sort((a, b) => a.datePrevue.localeCompare(b.datePrevue) || a.id.localeCompare(b.id)),
    [state.echeancesFacturation, filtreProjet],
  )

  // ----- factures (pièces), filtrées, cherchées, triées par émission DÉCROISSANTE -----
  // la pièce qu'on cherche est presque toujours la plus récente (T5) ; passé
  // quelques dizaines de lignes, la recherche numéro/libellé prend le relais
  const factures = useMemo(
    () => {
      const q = fold(recherche.trim())
      return state.factures
        .filter((f) => !filtreProjet || f.projetId === filtreProjet)
        .filter((f) => !q || fold(`${f.numero || f.id} ${f.libelle}`).includes(q))
        .filter((f) => {
          if (!filtreEtat) return true
          if (filtreEtat === 'retard') return f.type !== 'avoir' && retardFacture(state, f, today) > 0
          if (filtreEtat === 'avoir') return f.type === 'avoir'
          if (filtreEtat === 'controler') return !!f.historiqueAControler
          const etat = etatPaiement(state, f)
          if (filtreEtat === 'payee') return f.type !== 'avoir' && etat === 'payee'
          return f.type !== 'avoir' && etat !== 'payee' // 'attente'
        })
        .sort((a, b) => b.emission.localeCompare(a.emission) || (b.numero || b.id).localeCompare(a.numero || a.id))
    },
    [state, filtreProjet, filtreEtat, recherche, today],
  )

  // ----- actions -----
  const creerEcheance = (v: ValeursEcheance) => {
    // id calculé AVANT la mutation (producteur rejouable)
    const nouvelle: EcheanceFacturation = {
      id: uid('ech'),
      projetId: v.projetId,
      phase: v.phase,
      libelle: v.libelle,
      montantHT: v.montantHT!,
      tauxTVA: (v.tvaPct ?? 20) / 100,
      datePrevue: v.datePrevue!,
      delaiJours: v.delaiJours!,
    }
    update((d) => {
      d.echeancesFacturation.push(nouvelle)
    })
    setCreation(false)
  }

  const modifierEcheance = (id: string, v: ValeursEcheance) => {
    update((d) => {
      const x = d.echeancesFacturation.find((y) => y.id === id)
      if (!x) return
      x.projetId = v.projetId
      x.phase = v.phase
      x.libelle = v.libelle
      x.montantHT = v.montantHT!
      x.tauxTVA = (v.tvaPct ?? 20) / 100
      x.datePrevue = v.datePrevue!
      x.delaiJours = v.delaiJours!
    })
    setEditionEcheance(null)
  }

  const supprimerEcheance = async (e: EcheanceFacturation) => {
    const snap = state
    if (!(await confirmer({ message: `Supprimer l'échéance « ${e.libelle} » (${fmtMoney(e.montantHT)} HT) ?\nC'est une simple prévision : aucun numéro n'est perdu.`, danger: true, confirmerLabel: 'Supprimer' }))) return
    update((d) => {
      d.echeancesFacturation = d.echeancesFacturation.filter((y) => y.id !== e.id)
    })
    toast('Échéance supprimée.', { undo: () => replace(snap) })
  }

  const emettreDepuisEcheance = async (
    nouvelle: Facture,
    adresseFacturation: string,
    echeanceAttendue: EcheanceFacturation,
    brouillonAttendu: BrouillonFacture,
  ): Promise<ResultatMutation> => {
    const resultat = await new Promise<ResultatMutation>((resolve) => {
      const echeanceId = nouvelle.id
      update((d) => {
        const echeanceCourante = d.echeancesFacturation.find((e) => e.id === echeanceId)
        if (!echeanceCourante) {
          resolve({
            ok: false,
            erreur: 'Cette échéance a été supprimée ou déjà facturée sur un autre poste.',
          })
          return
        }
        const empreinteEcheance = (e: EcheanceFacturation) =>
          JSON.stringify([
            e.id,
            e.projetId,
            e.phase,
            e.libelle,
            e.montantHT,
            e.tauxTVA,
            e.datePrevue,
            e.delaiJours,
            e.situationId ?? null,
            e.contratLigneId ?? null,
          ])
        if (empreinteEcheance(echeanceCourante) !== empreinteEcheance(echeanceAttendue)) {
          resolve({
            ok: false,
            erreur:
              'Cette échéance a changé pendant la préparation de la facture. Fermez puis rouvrez l’émission pour contrôler les nouvelles valeurs.',
          })
          return
        }
        const erreur = erreurInsertionFacture(d, nouvelle)
        if (erreur) {
          resolve({ ok: false, erreur })
          return
        }
        const projetCourant = d.projets.find((p) => p.id === nouvelle.projetId)
        const controleCourant = controlerAvantEmission(d, projetCourant, brouillonAttendu)
        if (controleCourant.bloquants.length > 0) {
          resolve({ ok: false, erreur: controleCourant.bloquants[0] })
          return
        }
        if (!nouvelle.figee || !nouvelle.numero) {
          resolve({ ok: false, erreur: 'La copie légale figée de la facture est absente.' })
          return
        }
        const figeeCourante = construireFigee(
          d,
          brouillonAttendu,
          nouvelle.numero,
          projetCourant?.objetFacture || undefined,
          echeanceCourante.delaiJours,
        )
        const { empreinte: _empreinte, ...figeeCandidate } = nouvelle.figee
        if (JSON.stringify(figeeCourante) !== JSON.stringify(figeeCandidate)) {
          resolve({
            ok: false,
            erreur:
              'Les mentions légales, le projet ou les montants ont changé pendant le calcul de l’empreinte. Relancez l’émission.',
          })
          return
        }
        d.factures.push(nouvelle)
        d.echeancesFacturation = d.echeancesFacturation.filter((e) => e.id !== echeanceId)
        const pr = d.projets.find((x) => x.id === nouvelle.projetId)
        if (pr && adresseFacturation.trim()) pr.adresseFacturation = adresseFacturation.trim()
        resolve({ ok: true })
      })
    })
    // la pièce est en base : la confirmation prend le relais avec ses deux gestes
    if (resultat.ok) setEmise(nouvelle)
    return resultat
  }

  const enregistrerPaiement = (
    f: Facture,
    date: string,
    montant: number,
    moyen: string,
    reference: string,
  ): Promise<ResultatMutation> => {
    // paiement construit AVANT la mutation (producteur rejouable)
    let p: ReturnType<typeof nouveauPaiement>
    try {
      p = nouveauPaiement(
        state,
        date,
        montant,
        [{ factureId: f.id, montant }],
        reference || undefined,
        moyen || undefined,
      )
    } catch (e) {
      return Promise.resolve({
        ok: false,
        erreur: e instanceof Error ? e.message : 'Le paiement est invalide.',
      })
    }
    return new Promise((resolve) => {
      update((d) => {
        const controle = validerPaiement(d, p.montant, p.affectations)
        if (!controle.valide) {
          resolve({ ok: false, erreur: controle.erreurs[0] })
          return
        }
        d.paiements.push(p)
        const x = d.factures.find((y) => y.id === f.id)
        if (!x) {
          // Cette branche est normalement impossible après validerPaiement,
          // mais évite de journaliser un paiement orphelin si l'état est altéré.
          d.paiements = d.paiements.filter((paiement) => paiement.id !== p.id)
          resolve({ ok: false, erreur: `La facture ${f.numero || f.id} est introuvable.` })
          return
        }
        // le statut matérialisé suit le solde — jamais édité ailleurs
        const solde = soldeFacture(d, x)
        if (solde <= 0.01) {
          x.statut = 'encaissee'
          x.encaissementReel = date
        }
        x.evenements = [
          ...(x.evenements || []),
          { date, type: 'paiement', detail: `${fmtMoney(montant, true)} TTC${moyen ? ` (${moyen})` : ''}${solde > 0.01 ? ` — solde restant ${fmtMoney(solde, true)}` : ' — facture soldée'}` },
        ]
        resolve({ ok: true })
      })
    })
  }

  const emettreAvoir = (a: Facture): Promise<ResultatMutation> =>
    new Promise((resolve) => {
      update((d) => {
        const erreurIdentite = erreurInsertionFacture(d, a)
        if (erreurIdentite) {
          resolve({ ok: false, erreur: erreurIdentite })
          return
        }
        const origine = d.factures.find((y) => y.id === a.factureOrigineId)
        if (!origine) {
          resolve({ ok: false, erreur: 'La facture d’origine de cet avoir est introuvable.' })
          return
        }
        const montantAvoirHT = Math.abs(a.figee?.totalHT ?? a.montantHT)
        const controle = validerAvoir(
          d,
          origine,
          montantAvoirHT,
          a.figee?.lignes || a.lignes,
          a.figee
            ? {
                ht: a.figee.totalHT,
                tva: a.figee.totalTVA,
                ttc: a.figee.totalTTC,
                ventilationTVA: a.figee.ventilationTVA,
              }
            : undefined,
        )
        if (!controle.valide) {
          resolve({ ok: false, erreur: controle.erreurs[0] })
          return
        }
        d.factures.push(a)
        const soldeOrigine = soldeFacture(d, origine)
        origine.evenements = [
          ...(origine.evenements || []),
          {
            date: a.emission,
            type: 'avoir',
            detail:
              `Avoir ${a.numero} émis (${fmtMoney(a.montantHT, true)} HT).` +
              (soldeOrigine <= 0.01 ? ' Créance soldée par avoir, sans encaissement.' : ''),
          },
        ]
        resolve({ ok: true })
      })
    })

  const rapprocherHistorique = async (
    f: Facture,
    v: ValeursHistorique,
  ): Promise<ResultatMutation> => {
    const resultat = await new Promise<ResultatMutation>((resolve) => {
      update((d) => {
        const x = d.factures.find((y) => y.id === f.id)
        if (!x) {
          resolve({ ok: false, erreur: 'Cette facture historique est introuvable.' })
          return
        }
        if (x.figee) {
          resolve({ ok: false, erreur: 'Une pièce déjà figée ne peut plus être modifiée.' })
          return
        }
        const erreurDependance = erreurRapprochementHistorique(d, x.id)
        if (erreurDependance) {
          resolve({ ok: false, erreur: erreurDependance })
          return
        }
        if (
          v.montantHT === null ||
          !Number.isFinite(v.montantHT) ||
          v.montantHT <= 0 ||
          v.tvaPct === null ||
          !Number.isFinite(v.tvaPct) ||
          v.tvaPct < 0 ||
          v.tvaPct > 100 ||
          !v.emission ||
          v.delaiJours === null ||
          !Number.isFinite(v.delaiJours) ||
          v.delaiJours < 0
        ) {
          resolve({ ok: false, erreur: 'Les montants, la TVA, la date ou le délai sont invalides.' })
          return
        }
        x.libelle = v.libelle
        x.montantHT = v.montantHT
        x.tauxTVA = v.tvaPct / 100
        x.emission = v.emission
        x.delaiJours = v.delaiJours
        // réaligne le paiement de reprise (créé par la migration) sur le nouveau TTC
        const pay = d.paiements.find((p) => p.id === `pay-migr-${x.id}`)
        if (pay && pay.affectations.length === 1) {
          const nouveauTTC = Math.round(x.montantHT * (1 + x.tauxTVA) * 100) / 100
          pay.montant = nouveauTTC
          pay.affectations[0].montant = nouveauTTC
        }
        resolve({ ok: true })
      })
    })
    if (resultat.ok) {
      setRapprochement(null)
      toast('Facture historique rapprochée.', { tone: 'ok' })
    }
    return resultat
  }

  const exporterCII = (f: Facture) => {
    if (!f.figee) return
    try {
      download(nomFichierCII(f.figee), genererCII(f), 'application/xml')
      toast('XML Factur-X (CII, EN 16931) généré depuis la copie figée — à valider avec le cabinet/PDP.', { tone: 'ok' })
    } catch (e) {
      toast(String(e), { tone: 'danger' })
    }
  }

  const ajouterTransmission = (f: Facture, e: EvenementTransmission) => {
    update((d) => {
      const x = d.factures.find((y) => y.id === f.id)
      if (!x) return
      x.transmissions = [...(x.transmissions || []), e]
      x.evenements = [
        ...(x.evenements || []),
        { date: e.date, type: 'transmission', detail: `${e.plateforme} : ${e.statut}${e.motif ? ` — ${e.motif}` : ''}` },
      ]
    })
    setTransmission(null)
    toast(e.statut === 'rejetee' ? 'Rejet enregistré — il apparaît dans « à traiter » avec son motif.' : 'Événement de transmission enregistré.', { tone: 'ok' })
  }

  const marquerControlee = (f: Facture) =>
    update((d) => {
      const x = d.factures.find((y) => y.id === f.id)
      if (x) x.historiqueAControler = false
    })

  return (
    <Page
      titre="Finance"
      sousTitre="Ventes — échéances à facturer, pièces émises (figées), paiements et relances."
    >
      <FinanceNav actif="ventes" />
      {/* ----- stats ----- */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Stat
          label="Solde en retard (TTC)"
          value={<Money v={montantRetardTTC} />}
          tone={enRetard.length > 0 ? 'danger' : 'ok'}
        />
        <Stat
          label="Factures en retard"
          value={enRetard.length}
          tone={enRetard.length > 0 ? 'danger' : 'ok'}
        />
        <Stat label={`Facturé HT net ${annee}`} value={<Money v={factureCumulHT} />} sub="factures émises cette année, avoirs déduits" />
        <Stat label={`Encaissé TTC ${annee}`} value={<Money v={encaisseCumulTTC} />} sub="paiements enregistrés cette année" />
        <Stat
          label="Délai moyen de paiement"
          value={delaiGlobal !== null ? `${delaiGlobal} j` : '—'}
          sub={
            delaisParMO.length > 0
              ? delaisParMO.map((x) => `${x.t} : ${x.v} j`).join(' · ')
              : 'aucune facture soldée pour l’instant'
          }
        />
      </div>

      {/* ----- contrôles d'intégrité (audit F0) ----- */}
      {trous.length > 0 && (
        <div className="pill-note" style={{ marginBottom: 12 }}>
          ⚠ Trou dans la numérotation {today.slice(0, 4)} : {trous.join(', ')} — la séquence légale doit rester
          continue (vérifier les pièces manquantes chez le comptable).
        </div>
      )}
      {aControler.length > 0 && (
        <div className="pill-note" style={{ marginBottom: 12 }}>
          {aControler.length} facture(s) migrée(s) « à contrôler » : leur numéro provient de l'ancien identifiant
          et le PDF envoyé n'a jamais été gelé — rapprochez-les (menu de la ligne) puis marquez-les contrôlées.
        </div>
      )}
      {rejetees.length > 0 && (
        <div className="pill-note" style={{ marginBottom: 12, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          ⚠ {rejetees.length} facture(s) rejetée(s) sur le portail :{' '}
          {rejetees
            .map((f) => `${f.numero || f.id}${derniereTransmission(f)?.motif ? ` (${derniereTransmission(f)!.motif})` : ''}`)
            .join(' · ')}{' '}
          — corriger puis redéposer, et tracer le nouveau dépôt (« Suivi de transmission… », menu de la ligne).
        </div>
      )}
      {aDeposer.length > 0 && (
        <div className="pill-note" style={{ marginBottom: 12 }}>
          {aDeposer.length} facture(s) émise(s) à un client public sans dépôt suivi (badge « à déposer ») —
          déposer sur Chorus Pro, puis tracer le dépôt via « Suivi de transmission… » ou l'import CSV
          (<a href="#/finance/connecteurs">Connecteurs</a>).
        </div>
      )}

      {/* ----- relances graduées ----- */}
      <CarteRelances state={state} today={today} />

      {/* ----- échéances : les PRÉVISIONS ----- */}
      <Card
        titre={`À facturer — échéances (${echeances.length})`}
        actions={
          <Btn kind="primary" onClick={() => setCreation(true)}>
            Nouvelle échéance
          </Btn>
        }
      >
        {echeances.length === 0 ? (
          <EmptyState>
            Aucune échéance — créez-en une, ou générez l'échéancier d'un projet depuis sa fiche (onglet Finances).
          </EmptyState>
        ) : (
          <Table
            compact
            head={[
              'Projet',
              'Phase',
              'Libellé',
              <span key="ht" style={{ display: 'block', textAlign: 'right' }}>HT</span>,
              'Prévue le',
              'Encaissement estimé',
              '',
            ]}
          >
            {echeances.map((e) => {
              const enRetardEmission = e.datePrevue <= today
              return (
                <tr key={e.id}>
                  <td>
                    <a href={`#/projets/${e.projetId}`} title={nomProjet(state, e.projetId)}>
                      {e.projetId}
                    </a>
                  </td>
                  <td>
                    <span title={LIBELLES_PHASES[e.phase]}>{e.phase}</span>
                  </td>
                  <td>
                    {e.libelle}
                    {e.situationId && (
                      <a href="#/situations" className="muted small" title="Issue d'une situation de travaux validée" style={{ marginLeft: 6 }}>
                        · situation
                      </a>
                    )}
                  </td>
                  <td className="right">
                    <Money v={e.montantHT} />
                  </td>
                  <td className={enRetardEmission ? 'danger-text' : undefined}>
                    <DateF d={e.datePrevue} />
                  </td>
                  <td className="muted">
                    <DateF d={encaissementPrevuEcheance(e)} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                      <Btn small kind="primary" onClick={() => setEmissionLocale(e)} title="Parcours d'émission : contrôles, numéro légal, gel de la pièce">
                        Émettre…
                      </Btn>
                      <RowMenu
                        items={[
                          { label: 'Modifier', onClick: () => setEditionEcheance(e) },
                          { label: 'Supprimer', onClick: () => supprimerEcheance(e), danger: true },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>

      {/* ----- factures : les PIÈCES ----- */}
      <Card titre="Factures émises">
        <div className="toolbar">
          <Select
            value={filtreProjet}
            onChange={setFiltreProjet}
            options={[
              { value: '', label: 'Tous les projets' },
              ...state.projets.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` })),
            ]}
          />
          <Select
            value={filtreEtat}
            onChange={setFiltreEtat}
            options={[
              { value: '', label: 'Toutes' },
              { value: 'attente', label: 'À encaisser' },
              { value: 'retard', label: 'En retard' },
              { value: 'payee', label: 'Payées' },
              { value: 'avoir', label: 'Avoirs' },
              { value: 'controler', label: 'À contrôler (migrées)' },
            ]}
          />
          <TextInput value={recherche} onChange={setRecherche} placeholder="Chercher un n° ou un libellé…" />
          <div className="spacer" />
          <span className="small muted">
            {factures.length} pièce(s) · plus récente en tête
          </span>
        </div>

        {state.factures.length === 0 ? (
          <EmptyState>Aucune facture émise — tout commence par une échéance, puis « Émettre… ».</EmptyState>
        ) : factures.length === 0 ? (
          <EmptyState>
            Aucune facture ne correspond {recherche.trim() ? `à « ${recherche.trim()} »` : 'aux filtres'}.
          </EmptyState>
        ) : (
          <Table
            compact
            head={[
              'N°',
              'Projet',
              'Libellé',
              <span key="ht" style={{ display: 'block', textAlign: 'right' }}>HT</span>,
              <span key="ttc" style={{ display: 'block', textAlign: 'right' }}>TTC</span>,
              'Émission',
              'Échéance',
              'Statut',
              '',
            ]}
          >
            {factures.map((f) => {
              const retard = f.type !== 'avoir' ? retardFacture(state, f, today) : 0
              const solde = soldeFacture(state, f)
              const origine = f.factureOrigineId ? state.factures.find((x) => x.id === f.factureOrigineId) : undefined
              const transmission = derniereTransmission(f)
              const rappelDepot = estADeposer(f, projetById(state, f.projetId))
              return (
                <tr key={f.id}>
                  <td className="mono">
                    {f.numero || f.id}
                    {f.historiqueAControler && (
                      <span title="Facture migrée : numéro hérité, PDF jamais gelé — à rapprocher"> ⚠</span>
                    )}
                  </td>
                  <td>
                    <a href={`#/projets/${f.projetId}`} title={nomProjet(state, f.projetId)}>
                      {f.projetId}
                    </a>
                  </td>
                  <td>
                    {f.libelle}
                    {f.situationId && (
                      <a href="#/situations" className="muted small" title="Issue d'une situation de travaux validée" style={{ marginLeft: 6 }}>
                        · situation
                      </a>
                    )}
                    {origine && (
                      <span className="muted small" style={{ marginLeft: 6 }}>
                        (origine : {origine.numero || origine.id})
                      </span>
                    )}
                  </td>
                  <td className="right">
                    <Money v={f.figee?.totalHT ?? f.montantHT} />
                  </td>
                  <td className="right">
                    <Money v={ttc(f)} />
                  </td>
                  <td>
                    <DateF d={f.emission} />
                  </td>
                  <td className={retard > 0 ? 'danger-text' : undefined}>
                    <DateF d={encaissementPrevu(f)} />
                  </td>
                  <td>
                    <BadgeEtat state={state} f={f} today={today} />
                    {f.statut === 'encaissee' && f.encaissementReel && (
                      <div className="muted small">le {fmtDate(f.encaissementReel)}</div>
                    )}
                    {etatPaiement(state, f) === 'partielle' && (
                      <div className="muted small">solde {fmtMoney(solde, true)}</div>
                    )}
                    {transmission && (
                      <div style={{ marginTop: 2 }}>
                        <BadgeTransmission t={transmission} />
                        {transmission.statut === 'rejetee' && transmission.motif && (
                          <div className="danger-text small">{transmission.motif}</div>
                        )}
                      </div>
                    )}
                    {rappelDepot && (
                      <div style={{ marginTop: 2 }} title="Client public : dépôt sur le portail attendu — aucune transmission suivie sur cette pièce">
                        <Badge tone="warn">à déposer</Badge>
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                      {f.type !== 'avoir' && solde > 0.01 && (
                        <Btn small kind="primary" onClick={() => setPaiement(f)} title="Enregistrer un paiement reçu (partiel ou total)">
                          Paiement…
                        </Btn>
                      )}
                      <RowMenu
                        items={[
                          { label: 'Vue imprimable (PDF)', onClick: () => ouvrirFacturePDF(state, f) },
                          { label: 'Préparer l’e-mail', onClick: () => emailFacture(state, f) },
                          ...(f.type !== 'avoir'
                            ? [{ label: 'Créer un avoir…', onClick: () => setAvoir(f) }]
                            : []),
                          ...(f.figee
                            ? [
                                { label: 'Export Factur-X (XML)', onClick: () => exporterCII(f) },
                                { label: 'Suivi de transmission…', onClick: () => setTransmission(f) },
                              ]
                            : []),
                          ...(!f.figee
                            ? [{ label: 'Rapprocher (historique)…', onClick: () => setRapprochement(f) }]
                            : []),
                          ...(f.historiqueAControler
                            ? [{ label: '✓ Marquer contrôlée', onClick: () => marquerControlee(f) }]
                            : []),
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
        <p className="muted small" style={{ margin: '10px 2px 0' }}>
          Une facture émise est figée : ni modification ni suppression — la correction passe par un avoir
          (menu de la ligne). Le statut découle des paiements enregistrés.
        </p>
      </Card>

      {/* ----- modales ----- */}
      {creation && (
        <EcheanceModal
          titre="Nouvelle échéance de facturation"
          creation
          initial={{
            projetId: filtreProjet || '',
            phase: 'DIAG',
            libelle: '',
            montantHT: null,
            tvaPct: 20,
            datePrevue: today,
            delaiJours: null,
          }}
          state={state}
          onClose={() => setCreation(false)}
          onSave={creerEcheance}
        />
      )}
      {editionEcheance && (
        <EcheanceModal
          titre="Modifier l'échéance"
          creation={false}
          initial={{
            projetId: editionEcheance.projetId,
            phase: editionEcheance.phase,
            libelle: editionEcheance.libelle,
            montantHT: editionEcheance.montantHT,
            tvaPct: Math.round(editionEcheance.tauxTVA * 10000) / 100,
            datePrevue: editionEcheance.datePrevue,
            delaiJours: editionEcheance.delaiJours,
          }}
          state={state}
          onClose={() => setEditionEcheance(null)}
          onSave={(v) => modifierEcheance(editionEcheance.id, v)}
        />
      )}
      {echeanceEmission && (
        <EmissionModal
          echeance={echeanceEmission}
          state={state}
          today={today}
          onClose={fermerEmission}
          onEmettre={emettreDepuisEcheance}
        />
      )}
      {paiement && (
        <PaiementModal
          f={paiement}
          state={state}
          today={today}
          onClose={() => setPaiement(null)}
          onConfirm={(date, montant, moyen, reference) => enregistrerPaiement(paiement, date, montant, moyen, reference)}
        />
      )}
      {avoir && (
        <AvoirModal
          f={avoir}
          state={state}
          today={today}
          onClose={() => setAvoir(null)}
          onConfirm={emettreAvoir}
        />
      )}
      {rapprochement && (
        <HistoriqueModal
          f={rapprochement}
          onClose={() => setRapprochement(null)}
          onSave={(v) => rapprocherHistorique(rapprochement, v)}
        />
      )}
      {transmission && (
        <TransmissionModal
          f={transmission}
          today={today}
          onClose={() => setTransmission(null)}
          onAjouter={(e) => ajouterTransmission(transmission, e)}
        />
      )}
      {emise && <EmiseModal f={emise} state={state} onClose={() => setEmise(null)} />}
    </Page>
  )
}
