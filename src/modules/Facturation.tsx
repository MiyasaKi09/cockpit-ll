// ============================================================
// Facturation — honoraires & relances : échéancier des factures,
// passage de statut (émettre / encaisser), stats de retard et
// relances graduées (3 gabarits assemblés depuis la base).
// Règle d'or : Claude propose, l'humain valide — les relances
// sont des brouillons à relire avant tout envoi.
// ============================================================

import { useMemo, useState } from 'react'
import type { AppState, Facture, PhaseCode, TypeMO } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  CopyBtn,
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
  useToday,
} from '../ui'
import { delaiMoyenPaiement, encaissementPrevu, nomProjet, projetById, retardFacture, ttc } from '../derive'
import { LIBELLES_PHASES, PHASES_ORDRE } from '../miqcp'
import { assemble, contexteFacture } from '../prompts'
import { fmtDate, fmtMoney, ouvrirGmail } from '../util'
import { ouvrirFacturePDF } from '../pdf'

// ---------- helpers locaux ----------

const TYPES_MO: TypeMO[] = ['Public', 'Privé pro', 'Particulier']

/** prochain numéro « AAAA-NNN » : année d'émission + suite du compteur global */
function prochainNumero(factures: Facture[], emissionISO: string): string {
  let max = 0
  for (const f of factures) {
    const m = /^\d{4}-(\d+)$/.exec(f.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${emissionISO.slice(0, 4)}-${String(max + 1).padStart(3, '0')}`
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

function BadgeStatut({ f, today }: { f: Facture; today: string }) {
  const retard = retardFacture(f, today)
  if (retard > 0) return <Badge tone="danger">en retard {retard} j</Badge>
  if (f.statut === 'prevue') return <Badge tone="muted">prévue</Badge>
  if (f.statut === 'emise') return <Badge tone="info">émise</Badge>
  return <Badge tone="ok">encaissée</Badge>
}

// ---------- modal de création / édition ----------

interface ValeursFacture {
  numero: string
  projetId: string
  phase: PhaseCode
  libelle: string
  montantHT: number | null
  tvaPct: number | null
  emission: string | null
  delaiJours: number | null
  encaissementReel: string | null
}

function FactureModal({
  titre,
  initial,
  creation,
  state,
  onClose,
  onSave,
}: {
  titre: string
  initial: ValeursFacture
  creation: boolean
  state: AppState
  onClose: () => void
  onSave: (v: ValeursFacture) => void
}) {
  const [v, setV] = useState(initial)
  const set = (patch: Partial<ValeursFacture>) => setV((prev) => ({ ...prev, ...patch }))

  // au changement de projet, le délai de paiement se pré-remplit selon le type de MO
  const changerProjet = (projetId: string) => {
    const p = projetById(state, projetId)
    set({ projetId, delaiJours: p ? state.settings.delaisPaiement[p.typeMO] : v.delaiJours })
  }

  const valider = () => {
    const numero = v.numero.trim()
    if (creation && !numero) {
      alert('Indiquer un numéro de facture.')
      return
    }
    if (creation && state.factures.some((f) => f.id === numero)) {
      alert(`Le numéro ${numero} existe déjà.`)
      return
    }
    if (!v.projetId) {
      alert('Choisir un projet.')
      return
    }
    if (!v.libelle.trim()) {
      alert('Indiquer un libellé.')
      return
    }
    if (v.montantHT === null) {
      alert('Indiquer le montant HT.')
      return
    }
    if (!v.emission) {
      alert("Indiquer la date d'émission.")
      return
    }
    if (v.delaiJours === null) {
      alert('Indiquer le délai de paiement (jours).')
      return
    }
    onSave({ ...v, numero, libelle: v.libelle.trim() })
  }

  return (
    <Modal titre={titre} onClose={onClose}>
      <div className="form-row">
        {creation && (
          <Field label="Numéro" hint="proposé automatiquement, modifiable">
            <TextInput value={v.numero} onChange={(numero) => set({ numero })} />
          </Field>
        )}
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
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Phase">
          <Select
            value={v.phase}
            onChange={(phase) => set({ phase: phase as PhaseCode })}
            options={PHASES_ORDRE.map((c) => ({ value: c, label: `${c} — ${LIBELLES_PHASES[c]}` }))}
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
        <Field label="TVA (%)">
          <NumInput value={v.tvaPct} onChange={(tvaPct) => set({ tvaPct })} placeholder="20" />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Émission" hint="prévisionnelle tant que la facture n'est pas émise">
          <DateInput value={v.emission} onChange={(emission) => set({ emission })} />
        </Field>
        <Field label="Délai de paiement (jours)" hint="pré-rempli selon le type de MO du projet">
          <NumInput value={v.delaiJours} onChange={(delaiJours) => set({ delaiJours })} />
        </Field>
      </div>
      {!creation && v.encaissementReel !== null && (
        <div className="form-row" style={{ marginTop: 10 }}>
          <Field label="Encaissement réel">
            <DateInput
              value={v.encaissementReel}
              onChange={(d) => set({ encaissementReel: d || v.encaissementReel })}
            />
          </Field>
        </div>
      )}
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={valider}>
          {creation ? 'Créer la facture' : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- modal d'encaissement ----------

function EncaisserModal({
  f,
  today,
  onClose,
  onConfirm,
}: {
  f: Facture
  today: string
  onClose: () => void
  onConfirm: (dateISO: string) => void
}) {
  const [date, setDate] = useState<string | null>(today)
  return (
    <Modal titre={`Encaisser la facture ${f.id}`} onClose={onClose}>
      <dl className="kv" style={{ marginBottom: 14 }}>
        <dt>Libellé</dt>
        <dd>{f.libelle}</dd>
        <dt>Montant TTC</dt>
        <dd>
          <Money v={ttc(f)} cents />
        </dd>
        <dt>Échéance prévue</dt>
        <dd>{fmtDate(encaissementPrevu(f))}</dd>
      </dl>
      <Field label="Date d'encaissement réel">
        <DateInput value={date} onChange={setDate} />
      </Field>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn
          kind="primary"
          onClick={() => {
            if (!date) {
              alert("Indiquer la date d'encaissement.")
              return
            }
            onConfirm(date)
          }}
        >
          Marquer encaissée
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- carte « Relances à faire » ----------

function CarteRelances({ state, today }: { state: AppState; today: string }) {
  const enRetard = state.factures
    .filter((f) => retardFacture(f, today) > 0)
    .sort((a, b) => retardFacture(b, today) - retardFacture(a, today))

  const projetClaude = state.prompts.find((t) => NIVEAUX_RELANCE.some((n) => n.tplId === t.id))?.projetClaude

  return (
    <Card titre="Relances à faire">
      {enRetard.length === 0 ? (
        <EmptyState>Aucune facture en retard — rien à relancer.</EmptyState>
      ) : (
        <>
          <p className="muted small" style={{ marginBottom: 10 }}>
            Trois niveaux gradués — le niveau conseillé est en bleu. Chaque clic copie un brouillon
            complet à coller dans le Projet Claude {projetClaude ? `« ${projetClaude} »` : 'dédié'} ;
            relecture humaine avant tout envoi.
          </p>
          <Table
            compact
            head={['N°', 'Projet', 'Libellé', <span key="ttc" style={{ display: 'block', textAlign: 'right' }}>TTC</span>, 'Retard', 'Relance (brouillon)']}
          >
            {enRetard.map((f) => {
              const retard = retardFacture(f, today)
              const conseille = niveauConseille(retard)
              return (
                <tr key={f.id}>
                  <td className="mono">{f.id}</td>
                  <td>
                    <a href={`#/projets/${f.projetId}`} title={nomProjet(state, f.projetId)}>
                      {f.projetId}
                    </a>
                  </td>
                  <td>{f.libelle}</td>
                  <td className="right">
                    <Money v={ttc(f)} cents />
                  </td>
                  <td>
                    <Badge tone="danger">{retard} j</Badge>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {NIVEAUX_RELANCE.map((n, i) => {
                        const t = state.prompts.find((x) => x.id === n.tplId)
                        if (!t) {
                          return (
                            <Btn key={n.tplId} small disabled title={`Gabarit « ${n.tplId} » introuvable dans la bibliothèque de prompts`}>
                              {n.label}
                            </Btn>
                          )
                        }
                        return (
                          <CopyBtn
                            key={n.tplId}
                            small
                            kind={i === conseille ? 'primary' : 'default'}
                            label={n.label}
                            text={() => assemble(t.corps, contexteFacture(state, f))}
                          />
                        )
                      })}
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
  const sujet = `${state.settings.nomAgence} — facture ${f.id} · ${p ? p.nom : f.projetId}`
  const corps = [
    'Bonjour,',
    '',
    `Veuillez trouver ci-joint notre facture n° ${f.id} — ${f.libelle} —`,
    `d'un montant de ${fmtMoney(ttc(f), true)} TTC (${fmtMoney(f.montantHT, true)} HT),`,
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
  const { state, update } = useStore()
  const today = useToday()

  const [filtreProjet, setFiltreProjet] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [creation, setCreation] = useState(false)
  const [edition, setEdition] = useState<Facture | null>(null)
  const [encaissement, setEncaissement] = useState<Facture | null>(null)

  // ----- stats de tête -----
  const enRetard = state.factures.filter((f) => retardFacture(f, today) > 0)
  const montantRetardTTC = enRetard.reduce((s, f) => s + ttc(f), 0)
  const factureCumulHT = state.factures
    .filter((f) => f.statut !== 'prevue')
    .reduce((s, f) => s + f.montantHT, 0)
  const encaisseCumulTTC = state.factures
    .filter((f) => f.statut === 'encaissee')
    .reduce((s, f) => s + ttc(f), 0)
  const delaiGlobal = delaiMoyenPaiement(state)
  const delaisParMO = TYPES_MO.map((t) => ({ t, v: delaiMoyenPaiement(state, t) })).filter(
    (x) => x.v !== null,
  )

  // ----- échéancier filtré, trié par émission -----
  const factures = useMemo(
    () =>
      state.factures
        .filter((f) => !filtreProjet || f.projetId === filtreProjet)
        .filter((f) => {
          if (!filtreStatut) return true
          if (filtreStatut === 'retard') return retardFacture(f, today) > 0
          return f.statut === filtreStatut
        })
        .sort((a, b) => a.emission.localeCompare(b.emission) || a.id.localeCompare(b.id)),
    [state.factures, filtreProjet, filtreStatut, today],
  )

  // ----- actions -----
  const emettre = (f: Facture) =>
    update((d) => {
      const x = d.factures.find((y) => y.id === f.id)
      if (x && x.statut === 'prevue') x.statut = 'emise'
    })

  const encaisser = (f: Facture, dateISO: string) =>
    update((d) => {
      const x = d.factures.find((y) => y.id === f.id)
      if (x) {
        x.statut = 'encaissee'
        x.encaissementReel = dateISO
      }
    })

  const supprimer = (f: Facture) => {
    if (!confirm(`Supprimer la facture ${f.id} — ${f.libelle} ?`)) return
    update((d) => {
      d.factures = d.factures.filter((y) => y.id !== f.id)
    })
  }

  const creer = (v: ValeursFacture) => {
    update((d) => {
      d.factures.push({
        id: v.numero,
        projetId: v.projetId,
        phase: v.phase,
        libelle: v.libelle,
        montantHT: v.montantHT!,
        tauxTVA: (v.tvaPct ?? 20) / 100,
        emission: v.emission!,
        delaiJours: v.delaiJours!,
        statut: 'prevue',
      })
    })
    setCreation(false)
  }

  const modifier = (id: string, v: ValeursFacture) => {
    update((d) => {
      const x = d.factures.find((y) => y.id === id)
      if (!x) return
      x.projetId = v.projetId
      x.phase = v.phase
      x.libelle = v.libelle
      x.montantHT = v.montantHT!
      x.tauxTVA = (v.tvaPct ?? 20) / 100
      x.emission = v.emission!
      x.delaiJours = v.delaiJours!
      if (x.statut === 'encaissee' && v.encaissementReel) x.encaissementReel = v.encaissementReel
    })
    setEdition(null)
  }

  const valeursInitiales = (f?: Facture): ValeursFacture =>
    f
      ? {
          numero: f.id,
          projetId: f.projetId,
          phase: f.phase,
          libelle: f.libelle,
          montantHT: f.montantHT,
          tvaPct: Math.round(f.tauxTVA * 10000) / 100,
          emission: f.emission,
          delaiJours: f.delaiJours,
          encaissementReel: f.encaissementReel ?? null,
        }
      : {
          numero: prochainNumero(state.factures, today),
          projetId: '',
          phase: 'DIAG',
          libelle: '',
          montantHT: null,
          tvaPct: 20,
          emission: today,
          delaiJours: null,
          encaissementReel: null,
        }

  return (
    <Page
      titre="Facturation"
      sousTitre="Échéancier des honoraires, encaissements et relances graduées — les brouillons de relance sont toujours relus avant envoi."
    >
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
          label="Montant en retard (TTC)"
          value={<Money v={montantRetardTTC} />}
          tone={enRetard.length > 0 ? 'danger' : 'ok'}
        />
        <Stat
          label="Factures en retard"
          value={enRetard.length}
          tone={enRetard.length > 0 ? 'danger' : 'ok'}
        />
        <Stat label="Facturé HT (cumul)" value={<Money v={factureCumulHT} />} sub="factures émises ou encaissées" />
        <Stat label="Encaissé TTC (cumul)" value={<Money v={encaisseCumulTTC} />} />
        <Stat
          label="Délai moyen de paiement"
          value={delaiGlobal !== null ? `${delaiGlobal} j` : '—'}
          sub={
            delaisParMO.length > 0
              ? delaisParMO.map((x) => `${x.t} : ${x.v} j`).join(' · ')
              : 'aucune facture encaissée pour l’instant'
          }
        />
      </div>

      {/* ----- relances graduées ----- */}
      <CarteRelances state={state} today={today} />

      {/* ----- échéancier ----- */}
      <Card titre="Échéancier des factures">
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
            value={filtreStatut}
            onChange={setFiltreStatut}
            options={[
              { value: '', label: 'Tous les statuts' },
              { value: 'prevue', label: 'Prévues (à émettre)' },
              { value: 'emise', label: 'Émises' },
              { value: 'retard', label: 'En retard' },
              { value: 'encaissee', label: 'Encaissées' },
            ]}
          />
          <div className="spacer" />
          <Btn kind="primary" onClick={() => setCreation(true)}>
            Nouvelle facture
          </Btn>
        </div>

        {state.factures.length === 0 ? (
          <EmptyState>Aucune facture pour l’instant — créez la première avec « Nouvelle facture ».</EmptyState>
        ) : factures.length === 0 ? (
          <EmptyState>Aucune facture ne correspond aux filtres.</EmptyState>
        ) : (
          <Table
            compact
            head={[
              'N°',
              'Projet',
              'Phase',
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
              const retard = retardFacture(f, today)
              return (
                <tr key={f.id}>
                  <td className="mono">{f.id}</td>
                  <td>
                    <a href={`#/projets/${f.projetId}`} title={nomProjet(state, f.projetId)}>
                      {f.projetId}
                    </a>
                  </td>
                  <td>
                    <span title={LIBELLES_PHASES[f.phase]}>{f.phase}</span>
                  </td>
                  <td>{f.libelle}</td>
                  <td className="right">
                    <Money v={f.montantHT} />
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
                    <BadgeStatut f={f} today={today} />
                    {f.statut === 'encaissee' && f.encaissementReel && (
                      <div className="muted small">le {fmtDate(f.encaissementReel)}</div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {f.statut === 'prevue' && (
                        <Btn small onClick={() => emettre(f)} title="Passer la facture au statut « émise » (la date d'émission est conservée)">
                          Émettre
                        </Btn>
                      )}
                      {f.statut === 'emise' && (
                        <Btn small onClick={() => setEncaissement(f)} title="Enregistrer l'encaissement réel">
                          Encaisser
                        </Btn>
                      )}
                      <Btn small kind="ghost" onClick={() => ouvrirFacturePDF(state, f)} title="Vue imprimable — Ctrl+P pour enregistrer en PDF">
                        PDF
                      </Btn>
                      <Btn small kind="ghost" onClick={() => emailFacture(state, f)} title="Ouvre Gmail avec l'e-mail pré-rempli — l'envoi reste votre clic">
                        E-mail
                      </Btn>
                      <Btn small kind="ghost" onClick={() => setEdition(f)}>
                        Modifier
                      </Btn>
                      <Btn small kind="danger" onClick={() => supprimer(f)}>
                        Supprimer
                      </Btn>
                    </div>
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>

      {/* ----- modales ----- */}
      {creation && (
        <FactureModal
          titre="Nouvelle facture"
          creation
          initial={valeursInitiales()}
          state={state}
          onClose={() => setCreation(false)}
          onSave={creer}
        />
      )}
      {edition && (
        <FactureModal
          titre={`Modifier la facture ${edition.id}`}
          creation={false}
          initial={valeursInitiales(edition)}
          state={state}
          onClose={() => setEdition(null)}
          onSave={(v) => modifier(edition.id, v)}
        />
      )}
      {encaissement && (
        <EncaisserModal
          f={encaissement}
          today={today}
          onClose={() => setEncaissement(null)}
          onConfirm={(d) => {
            encaisser(encaissement, d)
            setEncaissement(null)
          }}
        />
      )}
    </Page>
  )
}
