// ============================================================
// Finance — Vue d'ensemble (audit §5.1) : répondre en trente
// secondes à « que faut-il faire aujourd'hui, et l'agence est-elle
// financièrement en sécurité ? ». Quatre indicateurs, la liste
// « à traiter maintenant », la courbe 13 semaines, la santé des
// projets et l'état de la clôture. Jamais dix ratios sans action.
// ============================================================

import { useMemo } from 'react'
import { useStore } from '../store'
import { Badge, Btn, Card, EmptyState, Money, Page, Stat, Table, navigate, useToday } from '../ui'
import FinanceNav from './FinanceNav'
import { CourbeTresorerie } from './Banque'
import { actionsATraiter } from '../financeActions'
import { prevision13Semaines } from '../tresorerie'
import { soldeBancaire } from '../banque'
import { achatsProjetPeriode, cinqMontantsProjet } from '../achats'
import { controlesCloture } from '../comptable'
import { STATUTS_ACTIFS, coutReelTemps, factureHT, nomProjet } from '../derive'
import { soldeFacture } from '../facture'
import { retardFacture } from '../derive'
import { addMonths, fmtDate, fmtMoney, monthKey } from '../util'

export default function Finance() {
  const { state } = useStore()
  const today = useToday()

  const banque = soldeBancaire(state)
  const prevision = useMemo(() => prevision13Semaines(state, today, 'probable'), [state, today])
  const seuil = state.settings.seuilTresorerie ?? 0

  // à encaisser : soldes des factures émises (dont retard)
  let aEncaisser = 0
  let dontRetard = 0
  for (const f of state.factures) {
    if (f.type === 'avoir') continue
    const solde = soldeFacture(state, f)
    if (solde <= 0.01) continue
    aEncaisser += solde
    if (retardFacture(f, today) > 0) dontRetard += solde
  }
  // à décaisser : achats validés non payés (dont non validés / sans pièce)
  const aPayer = state.facturesAchat.filter((f) => f.statut === 'validee' && !f.payeLe)
  const aDecaisser = aPayer.reduce((s, f) => s + f.montantTTC, 0)
  const nonValide = state.facturesAchat.filter((f) => f.statut === 'a_valider').reduce((s, f) => s + f.montantTTC, 0)

  const actions = useMemo(() => actionsATraiter(state, today), [state, today])

  // santé économique des projets actifs : marge sur coûts DIRECTS à date
  const sante = state.projets
    .filter((p) => STATUTS_ACTIFS.includes(p.statut))
    .map((p) => {
      const ca = factureHT(state, p.id)
      const coutTemps = coutReelTemps(state, p.id)
      const achats = achatsProjetPeriode(state, p.id, '0000-01-01', '9999-12-31')
      const cinq = cinqMontantsProjet(state, p.id)
      return { p, ca, marge: ca - coutTemps - achats, cinq }
    })
    .sort((a, b) => a.marge - b.marge)

  const moisACloturer = addMonths(monthKey(today), -1)
  const cloture = useMemo(() => controlesCloture(state, moisACloturer, today), [state, moisACloturer, today])
  const lotExiste = state.lotsComptables.some((l) => l.periode === moisACloturer)

  return (
    <Page titre="Finance" sousTitre="Que faut-il faire aujourd'hui — et l'agence est-elle en sécurité ?">
      <FinanceNav actif="ensemble" />

      {/* ----- les quatre indicateurs (§5.1) ----- */}
      <div className="grid4" style={{ marginBottom: 16 }}>
        <Stat
          accent="yellow"
          label="Banque disponible"
          value={banque ? <Money v={banque.solde} /> : state.settings.tresorerieDispo != null ? <Money v={state.settings.tresorerieDispo} /> : <a href="#/finance/banque" style={{ fontSize: 15, color: 'inherit' }}>importer un relevé →</a>}
          sub={banque ? `relevé du ${fmtDate(banque.date)} + mouvements` : state.settings.tresorerieMajLe ? `solde MANUEL du ${fmtDate(state.settings.tresorerieMajLe)}` : 'solde d’ouverture manuel (Paramètres)'}
          tone={banque && banque.solde < 0 ? 'danger' : undefined}
        />
        <Stat
          accent="red"
          label="Point bas à 13 semaines"
          value={<Money v={prevision.pointBas.solde} />}
          sub={`semaine du ${fmtDate(prevision.pointBas.lundi)} · scénario probable`}
          tone={prevision.pointBas.solde < seuil ? 'danger' : 'ok'}
        />
        <Stat
          accent="blue"
          label="À encaisser"
          value={<Money v={aEncaisser} />}
          sub={dontRetard > 0 ? `dont ${fmtMoney(dontRetard)} en retard` : 'aucun retard client'}
          tone={dontRetard > 0 ? 'warn' : undefined}
        />
        <Stat
          label="À décaisser"
          value={<Money v={aDecaisser} />}
          sub={nonValide > 0 ? `+ ${fmtMoney(nonValide)} non validés (boîte d'arrivée)` : 'fournisseurs validés non payés'}
          tone={nonValide > 0 ? 'warn' : undefined}
        />
      </div>

      {/* ----- à traiter maintenant ----- */}
      <Card titre={`À traiter maintenant (${actions.length})`}>
        {actions.length === 0 ? (
          <EmptyState>Rien qui demande une décision — la chaîne finance est à jour ✓</EmptyState>
        ) : (
          <>
            {actions.slice(0, 8).map((a) => (
              <div key={a.id} className={`alert-item ${a.gravite === 3 ? 'alert-3' : ''}`}>
                <span className={`gmk gmk-circle`} aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                  <div className="alert-titre">{a.titre}</div>
                  <div className="alert-detail">{a.detail}</div>
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  <Btn small kind="primary" onClick={() => navigate(a.lien.replace(/^#/, ''))}>
                    Traiter
                  </Btn>
                </div>
              </div>
            ))}
            {actions.length > 8 && (
              <p className="muted small" style={{ margin: '8px 2px 0' }}>
                … et {actions.length - 8} autre(s) dans les vues Achats, Banque et Ventes.
              </p>
            )}
          </>
        )}
      </Card>

      {/* ----- courbe 13 semaines ----- */}
      <Card
        titre="Trésorerie — 13 semaines (probable)"
        actions={<a href="#/finance/banque" className="small">scénarios & détail des flux →</a>}
      >
        <CourbeTresorerie prevision={prevision} seuil={seuil} />
        <p className="muted small" style={{ margin: '6px 2px 0' }}>
          départ {fmtMoney(prevision.soldeDepart)} ({prevision.sourceSolde === 'banque' ? 'solde bancaire importé' : 'solde d’ouverture manuel'}) — chaque point s'explique par ses flux dans la vue Banque.
        </p>
      </Card>

      {/* ----- santé des projets ----- */}
      <Card titre="Santé économique des projets actifs">
        {sante.length === 0 ? (
          <EmptyState>Aucun projet actif.</EmptyState>
        ) : (
          <Table
            compact
            head={[
              'Projet',
              <span key="ca" className="right">Facturé HT</span>,
              <span key="m" className="right">Marge coûts directs</span>,
              <span key="b" className="right">Budget ext.</span>,
              <span key="f" className="right">Facturé fourn.</span>,
              '',
            ]}
          >
            {sante.map(({ p, ca, marge, cinq }) => (
              <tr key={p.id}>
                <td>
                  <a href={`#/projets/${p.id}/finances`} title={nomProjet(state, p.id)}>
                    {p.id}
                  </a>{' '}
                  <span className="muted small">{p.nom.slice(0, 34)}</span>
                </td>
                <td className="right num">{fmtMoney(ca)}</td>
                <td className={`right num ${marge < 0 ? 'danger-text' : 'ok-text'}`}>{fmtMoney(marge)}</td>
                <td className="right num">{cinq.budget > 0 ? fmtMoney(cinq.budget) : '·'}</td>
                <td className={`right num ${cinq.facture > cinq.budget && cinq.budget > 0 ? 'warn-text' : ''}`}>
                  {cinq.facture > 0 ? fmtMoney(cinq.facture) : '·'}
                </td>
                <td>
                  <a href={`#/projets/${p.id}/finances`} className="small">
                    détail →
                  </a>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="muted small" style={{ margin: '10px 2px 0' }}>
          Marge sur coûts directs = facturé HT − temps pointé valorisé − achats fournisseurs affectés (des coûts
          DATÉS, jamais des budgets).
        </p>
      </Card>

      {/* ----- état de la clôture ----- */}
      <Card titre={`Clôture ${moisACloturer}`} actions={<a href="#/finance/comptable" className="small">vue Comptable →</a>}>
        {lotExiste ? (
          <p className="small" style={{ margin: 0 }}>
            <Badge tone="ok">exportée</Badge> — le lot est chez le comptable ; importer son retour depuis la vue
            Comptable.
          </p>
        ) : (
          <p className="small" style={{ margin: 0 }}>
            <strong>{cloture.pctPret} % prêt</strong> · {cloture.bloquants} bloquant(s) · {cloture.aVerifier} à
            vérifier — la checklist guide la clôture pas à pas.
          </p>
        )}
      </Card>
    </Page>
  )
}
