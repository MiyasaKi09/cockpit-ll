// ============================================================
// Contrats & budgets — audit finance F1 : le contrat est la racine
// du chiffre d'affaires (client) et des budgets (heures, externes).
// · le total signé = lignes ACTIVES uniquement (option non levée
//   hors du signé) ;
// · un contrat PROVISOIRE (migré des phases) s'édite librement
//   jusqu'à sa VALIDATION face au document signé ;
// · un contrat validé ne se réécrit jamais : l'AVENANT désactive
//   des lignes et en ajoute, l'historique reste lisible ;
// · le budget externe reste un BUDGET tant qu'aucune facture
//   fournisseur ne le justifie (lot F2).
// ============================================================

import { useState } from 'react'
import type { AppState, Contrat, LigneContrat, NatureLigneContrat, Projet } from '../types'
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
  NATURES_LIGNE,
  appliquerAvenant,
  budgetExterneHT,
  budgetHeures,
  contratProvisoireDepuisProjet,
  ecartContratProjet,
  factureSurContrat,
  leverOption,
  totalAvenantsHT,
  totalContratHT,
} from '../contrats'
import type { ModificationAvenant } from '../contrats'
import { projetById } from '../derive'
import { fmtDate, fmtMoney, uid } from '../util'
import FinanceNav from './FinanceNav'

const LIBELLE_NATURE = Object.fromEntries(NATURES_LIGNE.map((n) => [n.id, n.label])) as Record<
  NatureLigneContrat,
  string
>

function BadgeContrat({ c }: { c: Contrat }) {
  if (c.provisoire) return <Badge tone="warn">provisoire — à contrôler</Badge>
  return <Badge tone="ok">validé</Badge>
}

// ---------- modal d'avenant (avant/après, jamais de réécriture) ----------

function AvenantModal({
  contrat,
  today,
  onClose,
  onConfirm,
}: {
  contrat: Contrat
  today: string
  onClose: () => void
  onConfirm: (motif: string, date: string, modif: ModificationAvenant) => void
}) {
  const [motif, setMotif] = useState('')
  const [date, setDate] = useState<string | null>(today)
  const [desactiver, setDesactiver] = useState<Set<string>>(new Set())
  const [ajouts, setAjouts] = useState<
    { cle: string; nature: NatureLigneContrat; designation: string; montantHT: number | null; heures: number | null; externe: number | null }[]
  >([])

  const actives = contrat.lignes.filter((l) => l.etat === 'active' || l.etat === 'option')
  const basculer = (id: string) =>
    setDesactiver((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const ajouterLigne = () =>
    setAjouts((prev) => [...prev, { cle: uid('aj'), nature: 'complementaire', designation: '', montantHT: null, heures: null, externe: null }])
  const majAjout = (cle: string, patch: Partial<(typeof ajouts)[number]>) =>
    setAjouts((prev) => prev.map((a) => (a.cle === cle ? { ...a, ...patch } : a)))

  const valider = () => {
    if (!motif.trim()) return toast("Indiquer le motif de l'avenant (traçabilité).", { tone: 'danger' })
    if (!date) return toast("Indiquer la date de l'avenant.", { tone: 'danger' })
    const lignesAjoutees = ajouts
      .filter((a) => a.designation.trim() && a.montantHT !== null)
      .map((a) => ({
        nature: a.nature,
        designation: a.designation.trim(),
        quantite: 1,
        unite: 'forfait',
        prixUnitaireHT: a.montantHT!,
        heuresBudget: a.heures,
        coutExterneBudgetHT: a.externe,
        etat: 'active' as const,
      }))
    if (desactiver.size === 0 && lignesAjoutees.length === 0)
      return toast('Un avenant désactive ou ajoute au moins une ligne.', { tone: 'danger' })
    onConfirm(motif.trim(), date, { desactiver: [...desactiver], ajouter: lignesAjoutees })
  }

  return (
    <Modal titre={`Avenant — ${contrat.intitule}`} onClose={onClose} large>
      <p className="muted small" style={{ margin: '0 0 12px' }}>
        L'avenant ne réécrit jamais une ligne : il la désactive et en crée une nouvelle — l'avant et
        l'après restent lisibles, l'événement trace l'écart de total.
      </p>
      <div className="form-row">
        <Field label="Motif (obligatoire)">
          <TextInput value={motif} onChange={setMotif} placeholder="ex. avenant n°2 signé le… — extension mission OPC" />
        </Field>
        <Field label="Date">
          <DateInput value={date} onChange={setDate} />
        </Field>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="small" style={{ fontWeight: 650, marginBottom: 6 }}>Lignes à désactiver</div>
        {actives.length === 0 ? (
          <p className="muted small">Aucune ligne active.</p>
        ) : (
          actives.map((l) => (
            <label key={l.id} className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
              <input type="checkbox" checked={desactiver.has(l.id)} onChange={() => basculer(l.id)} />
              <span style={{ textDecoration: desactiver.has(l.id) ? 'line-through' : undefined }}>
                {l.designation} — {fmtMoney(l.quantite * l.prixUnitaireHT)} HT
                {l.etat === 'option' && ' (option)'}
              </span>
            </label>
          ))
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="small" style={{ fontWeight: 650, marginBottom: 6 }}>Lignes à ajouter</div>
        {ajouts.map((a) => (
          <div key={a.cle} className="form-row" style={{ marginBottom: 6 }}>
            <Field label="Nature">
              <Select
                value={a.nature}
                onChange={(n) => majAjout(a.cle, { nature: n as NatureLigneContrat })}
                options={NATURES_LIGNE.map((n) => ({ value: n.id, label: n.label }))}
              />
            </Field>
            <Field label="Désignation">
              <TextInput value={a.designation} onChange={(designation) => majAjout(a.cle, { designation })} />
            </Field>
            <Field label="Montant HT (€)">
              <NumInput value={a.montantHT} onChange={(montantHT) => majAjout(a.cle, { montantHT })} />
            </Field>
            <Field label="Budget heures">
              <NumInput value={a.heures} onChange={(heures) => majAjout(a.cle, { heures })} />
            </Field>
            <Field label="Budget externe HT">
              <NumInput value={a.externe} onChange={(externe) => majAjout(a.cle, { externe })} />
            </Field>
          </div>
        ))}
        <Btn small onClick={ajouterLigne}>+ Ajouter une ligne</Btn>
      </div>

      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={valider}>
          Appliquer l'avenant
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- fiche contrat ----------

function FicheContrat({ contrat: c }: { contrat: Contrat }) {
  const { state, update } = useStore()
  const today = useToday()
  const [avenantOuvert, setAvenantOuvert] = useState(false)
  const projet = c.projetId ? projetById(state, c.projetId) : undefined

  const total = totalContratHT(c)
  const avenants = totalAvenantsHT(c)
  const facture = factureSurContrat(state, c)
  const heures = budgetHeures(c)
  const externe = budgetExterneHT(c)
  const ecart = projet ? ecartContratProjet(c, projet) : 0

  const remplacer = (suivant: Contrat) =>
    update((d) => {
      d.contrats = d.contrats.map((x) => (x.id === suivant.id ? suivant : x))
    })

  const valider = async () => {
    if (
      !(await confirmer({
        message:
          `Valider le contrat « ${c.intitule} » ?\n\nConfirmez que les lignes correspondent au document signé (acte d'engagement, contrat de MOE). ` +
          `Après validation, toute modification passera par un avenant tracé.`,
        confirmerLabel: 'Valider le contrat',
      }))
    )
      return
    // nouvel objet calculé AVANT la mutation (producteur rejouable)
    const suivant: Contrat = {
      ...c,
      provisoire: false,
      evenements: [...(c.evenements || []), { date: today, type: 'validation', detail: `Contrôlé face au document signé — total ${fmtMoney(total)} HT.` }],
    }
    remplacer(suivant)
    toast('Contrat validé — les modifications passent désormais par avenant.', { tone: 'ok' })
  }

  const lever = async (l: LigneContrat) => {
    if (!(await confirmer({ message: `Lever l'option « ${l.designation} » (${fmtMoney(l.quantite * l.prixUnitaireHT)} HT) ?\nElle entre dans le total signé.`, confirmerLabel: 'Lever l’option' }))) return
    remplacer(leverOption(c, l.id))
    toast('Option levée — elle compte dans le signé.', { tone: 'ok' })
  }

  const majLigne = (id: string, patch: Partial<LigneContrat>) =>
    update((d) => {
      const x = d.contrats.find((y) => y.id === c.id)
      const l = x?.lignes.find((y) => y.id === id)
      if (l) Object.assign(l, patch)
    })

  const ajouterLigneProvisoire = () => {
    const nouvelle: LigneContrat = {
      id: uid('lc'),
      nature: 'base',
      designation: '',
      quantite: 1,
      unite: 'forfait',
      prixUnitaireHT: 0,
      etat: 'active',
    }
    update((d) => {
      d.contrats.find((y) => y.id === c.id)?.lignes.push(nouvelle)
    })
  }

  const retirerLigneProvisoire = (id: string) =>
    update((d) => {
      const x = d.contrats.find((y) => y.id === c.id)
      if (x) x.lignes = x.lignes.filter((l) => l.id !== id)
    })

  const appliquer = (motif: string, date: string, modif: ModificationAvenant) => {
    // appliquerAvenant calculé AVANT la mutation (uid dans les lignes ajoutées)
    const suivant = appliquerAvenant(c, { id: uid('av'), date, motif }, modif)
    remplacer(suivant)
    setAvenantOuvert(false)
    toast(`Avenant appliqué — total ${fmtMoney(totalContratHT(suivant))} HT.`, { tone: 'ok' })
  }

  const lignesVisibles = [...c.lignes].sort((a, b) => (a.etat === 'supprimee' ? 1 : 0) - (b.etat === 'supprimee' ? 1 : 0))

  return (
    <Page
      titre={c.intitule}
      sousTitre={
        <>
          <a href="#/contrats">← Contrats</a> · {c.tiers || 'tiers à préciser'}
          {projet ? ` · projet ${projet.id}` : ''}
        </>
      }
    >
      <div className="grid4" style={{ marginBottom: 16 }}>
        <Stat label="Total signé HT" value={<Money v={total} />} sub={avenants !== 0 ? `dont avenants ${fmtMoney(avenants)}` : 'lignes actives uniquement'} />
        <Stat
          label="Facturé HT"
          value={<Money v={facture} />}
          sub={<>reste {fmtMoney(Math.max(0, total - facture))}</>}
          tone={facture > total + 0.01 ? 'danger' : undefined}
        />
        <Stat label="Budget heures" value={heures > 0 ? `${Math.round(heures)} h` : '—'} sub="production interne (lignes actives)" />
        <Stat label="Budget externe (saisi)" value={externe > 0 ? fmtMoney(externe) : '—'} sub="un budget, pas un coût réel (lot F2)" />
      </div>

      {c.provisoire && (
        <div className="pill-note" style={{ marginBottom: 12 }}>
          Contrat <strong>provisoire</strong>, construit depuis les phases du projet — contrôlez les lignes face au
          document signé{projet && Math.abs(ecart) > 0.01 ? ` (écart de ${fmtMoney(ecart)} HT avec la fiche projet)` : ''},
          puis <Btn small kind="primary" onClick={() => void valider()}>Valider le contrat</Btn>
        </div>
      )}

      <Card
        titre={`Lignes du contrat (${c.lignes.filter((l) => l.etat !== 'supprimee').length})`}
        actions={
          c.provisoire ? (
            <Btn small onClick={ajouterLigneProvisoire}>+ Ligne</Btn>
          ) : (
            <Btn small kind="primary" onClick={() => setAvenantOuvert(true)}>Avenant…</Btn>
          )
        }
      >
        {c.lignes.length === 0 ? (
          <EmptyState>Aucune ligne — {c.provisoire ? 'ajoutez les lignes du document signé.' : 'passez un avenant pour en ajouter.'}</EmptyState>
        ) : (
          <Table
            compact
            head={[
              'Nature',
              'Désignation',
              <span key="ht" className="right">Montant HT</span>,
              <span key="h" className="right">Heures</span>,
              <span key="ext" className="right">Externe HT</span>,
              'État',
              '',
            ]}
          >
            {lignesVisibles.map((l) => {
              const supprimee = l.etat === 'supprimee'
              const avenant = l.avenantId ? c.avenants.find((a) => a.id === l.avenantId) : undefined
              return (
                <tr key={l.id} style={supprimee ? { opacity: 0.55 } : undefined}>
                  <td className="small">{LIBELLE_NATURE[l.nature]}{l.phase ? ` · ${l.phase}` : ''}</td>
                  <td style={supprimee ? { textDecoration: 'line-through' } : undefined}>
                    {c.provisoire && !supprimee ? (
                      <TextInput value={l.designation} onChange={(designation) => majLigne(l.id, { designation })} />
                    ) : (
                      l.designation
                    )}
                    {avenant && (
                      <div className="muted small" title={avenant.motif}>
                        {supprimee ? 'désactivée par' : 'créée par'} avenant du {fmtDate(avenant.date)}
                      </div>
                    )}
                  </td>
                  <td className="right">
                    {c.provisoire && !supprimee ? (
                      <NumInput value={l.prixUnitaireHT} onChange={(v) => majLigne(l.id, { prixUnitaireHT: v ?? 0 })} style={{ width: 100 }} />
                    ) : (
                      <Money v={l.quantite * l.prixUnitaireHT} />
                    )}
                  </td>
                  <td className="right">
                    {c.provisoire && !supprimee ? (
                      <NumInput value={l.heuresBudget ?? null} onChange={(v) => majLigne(l.id, { heuresBudget: v })} style={{ width: 70 }} />
                    ) : l.heuresBudget ? (
                      `${Math.round(l.heuresBudget)} h`
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="right">
                    {c.provisoire && !supprimee ? (
                      <NumInput value={l.coutExterneBudgetHT ?? null} onChange={(v) => majLigne(l.id, { coutExterneBudgetHT: v })} style={{ width: 90 }} />
                    ) : l.coutExterneBudgetHT ? (
                      <Money v={l.coutExterneBudgetHT} />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {l.etat === 'active' && <Badge tone="ok">active</Badge>}
                    {l.etat === 'option' && <Badge tone="muted">option (hors signé)</Badge>}
                    {supprimee && <Badge tone="danger">désactivée</Badge>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {l.etat === 'option' && !c.provisoire && (
                        <Btn small onClick={() => void lever(l)}>Lever l'option</Btn>
                      )}
                      {c.provisoire && !supprimee && (
                        <RowMenu
                          items={[
                            {
                              label: l.etat === 'option' ? 'Marquer active' : 'Marquer en option',
                              onClick: () => majLigne(l.id, { etat: l.etat === 'option' ? 'active' : 'option' }),
                            },
                            { label: 'Retirer la ligne', onClick: () => retirerLigneProvisoire(l.id), danger: true },
                          ]}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
        <p className="muted small" style={{ margin: '10px 2px 0' }}>
          Total signé = lignes actives uniquement. {c.provisoire ? 'Édition libre tant que le contrat est provisoire.' : 'Contrat validé : toute modification passe par un avenant.'}
        </p>
      </Card>

      {(c.avenants.length > 0 || (c.evenements || []).length > 0) && (
        <Card titre="Historique">
          {c.avenants.map((a) => (
            <p key={a.id} className="small" style={{ margin: '4px 0' }}>
              <Badge tone="info">avenant</Badge> {fmtDate(a.date)} — {a.motif}
            </p>
          ))}
          {(c.evenements || []).map((e, i) => (
            <p key={i} className="small muted" style={{ margin: '4px 0' }}>
              {fmtDate(e.date)} · {e.type} — {e.detail}
            </p>
          ))}
        </Card>
      )}

      {projet && (
        <p className="small" style={{ margin: '4px 2px' }}>
          <a href={`#/projets/${projet.id}`}>Fiche projet {projet.id} →</a> ·{' '}
          <a href="#/facturation">Facturation →</a>
        </p>
      )}

      {avenantOuvert && (
        <AvenantModal contrat={c} today={today} onClose={() => setAvenantOuvert(false)} onConfirm={appliquer} />
      )}
    </Page>
  )
}

// ---------- liste ----------

function projetsSansContrat(state: AppState): Projet[] {
  return state.projets.filter(
    (p) =>
      ['Signé', 'En cours', 'Livré'].includes(p.statut) &&
      !state.contrats.some((c) => c.type === 'client' && c.projetId === p.id),
  )
}

export default function Contrats() {
  const { state, update } = useStore()
  const route = useRoute()

  const contratRoute = route[1] ? state.contrats.find((c) => c.id === route[1]) : undefined
  if (route[1] && !contratRoute) navigate('/contrats')
  if (contratRoute) return <FicheContrat contrat={contratRoute} />

  const clients = state.contrats
    .filter((c) => c.type === 'client')
    .sort((a, b) => (a.projetId || '').localeCompare(b.projetId || ''))
  const agence = state.contrats.filter((c) => c.type === 'agence')
  const sansContrat = projetsSansContrat(state)

  const totalSigne = clients.reduce((s, c) => s + totalContratHT(c), 0)
  const totalFacture = clients.reduce((s, c) => s + factureSurContrat(state, c), 0)
  const nbProvisoires = clients.filter((c) => c.provisoire).length

  const creerDepuisProjet = (p: Projet) => {
    // contrat calculé AVANT la mutation (producteur rejouable)
    const c = contratProvisoireDepuisProjet(p)
    update((d) => {
      d.contrats.push(c)
    })
    toast(`Contrat provisoire créé depuis les phases de ${p.id} — à contrôler puis valider.`, { tone: 'ok' })
    navigate(`/contrats/${c.id}`)
  }

  return (
    <Page titre="Finance" sousTitre="Contrats & budgets — le contrat signé est la racine du chiffre, les avenants s'y tracent.">
      <FinanceNav actif="contrats" />
      <div className="grid4" style={{ marginBottom: 16 }}>
        <Stat label="Signé HT (contrats clients)" value={<Money v={totalSigne} />} sub="lignes actives uniquement" />
        <Stat label="Facturé HT" value={<Money v={totalFacture} />} sub={<>reste {fmtMoney(Math.max(0, totalSigne - totalFacture))}</>} />
        <Stat
          label="Provisoires à contrôler"
          value={nbProvisoires}
          tone={nbProvisoires > 0 ? 'warn' : 'ok'}
          sub="migrés des phases — à valider"
        />
        <Stat label="Contrats d'agence" value={agence.length} sub={<a href="#/agenda">échéances agence →</a>} />
      </div>

      {sansContrat.length > 0 && (
        <div className="pill-note" style={{ marginBottom: 12 }}>
          Projet(s) sans contrat :{' '}
          {sansContrat.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ' · '}
              {p.id} <Btn small onClick={() => creerDepuisProjet(p)}>créer depuis les phases</Btn>
            </span>
          ))}
        </div>
      )}

      <Card titre={`Contrats clients (${clients.length})`}>
        {clients.length === 0 ? (
          <EmptyState>Aucun contrat client — ils se créent depuis les projets signés (bandeau ci-dessus).</EmptyState>
        ) : (
          <Table
            compact
            head={[
              'Projet',
              'Intitulé',
              'Tiers',
              <span key="s" className="right">Signé HT</span>,
              <span key="f" className="right">Facturé</span>,
              <span key="r" className="right">Reste</span>,
              'État',
            ]}
          >
            {clients.map((c) => {
              const total = totalContratHT(c)
              const facture = factureSurContrat(state, c)
              return (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/contrats/${c.id}`)}>
                  <td>{c.projetId || '—'}</td>
                  <td>{c.intitule}</td>
                  <td className="small">{c.tiers || '—'}</td>
                  <td className="right"><Money v={total} /></td>
                  <td className={`right${facture > total + 0.01 ? ' danger-text' : ''}`}><Money v={facture} /></td>
                  <td className="right"><Money v={Math.max(0, total - facture)} /></td>
                  <td><BadgeContrat c={c} /></td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>

      <Card titre={`Contrats de l'agence (${agence.length})`}>
        {agence.length === 0 ? (
          <EmptyState>
            Aucun contrat d'agence — cochez « contrat » sur une échéance de l'<a href="#/agenda">agenda agence</a>{' '}
            (bail, assurance, licences…), il apparaîtra ici.
          </EmptyState>
        ) : (
          <Table
            compact
            head={['Intitulé', 'Tiers', <span key="m" className="right">Attendu / période</span>, 'Périodicité', 'Renouvellement']}
          >
            {agence.map((c) => (
              <tr key={c.id}>
                <td>{c.intitule}</td>
                <td className="small">{c.tiers || '—'}</td>
                <td className="right">{c.montantAttenduHT != null ? <Money v={c.montantAttenduHT} /> : '—'}</td>
                <td className="small">{c.periodiciteMois ? `${c.periodiciteMois} mois` : '—'}</td>
                <td className="small">{c.dateRenouvellement ? <DateF d={c.dateRenouvellement} /> : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="muted small" style={{ margin: '10px 2px 0' }}>
          Le rapprochement automatique avec les dépenses réelles (détection d'oubli, de dérive de prix) arrive
          avec le lot Achats (F2).
        </p>
      </Card>
    </Page>
  )
}
