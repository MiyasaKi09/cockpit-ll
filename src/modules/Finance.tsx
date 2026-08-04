// ============================================================
// Finance — « L'essentiel » (commande du 04/08) : clair et simple
// VISUELLEMENT, précis dans ce que ça montre. Six tuiles — un
// chiffre en grand, un mot dessous — et RIEN d'autre : pas de
// tableau-fleuve, pas de graphique décoratif. Chaque tuile répond
// à une question que les deux associées se posent vraiment et la
// tuile ENTIÈRE est un lien vers l'onglet où l'on agit.
//
// AUCUN calcul local : chaque chiffre vient du sélecteur que le
// reste de l'application lit déjà (financeActions, derive, tva,
// banque, tresorerie). Deux chiffres différents pour la même
// question — ici et dans l'onglet de détail — détruiraient la
// confiance dans l'écran entier.
// `scripts/test-finance-essentiel.cjs` verrouille cette règle.
// ============================================================

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '../store'
import { Money, Page, Stat, useToday } from '../ui'
import type { Tone } from '../ui'
import FinanceNav from './FinanceNav'
import { soldeBancaire } from '../banque'
import { prevision13Semaines } from '../tresorerie'
import { aEncaisser, aFacturer, achatsAPayer } from '../financeActions'
import { analyserPeriode, meteoFinanciere } from '../derive'
import { positionTVA } from '../tva'
import { fmtDate, fmtMoney, monthKey } from '../util'

/** une tuile de L'essentiel : la carte entière est le lien vers le détail */
function Tuile({
  href,
  label,
  value,
  sub,
  tone,
}: {
  href: string
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
}) {
  return (
    <a className="tuile-lien" href={href}>
      <Stat label={label} value={value} sub={sub} tone={tone} />
    </a>
  )
}

export default function Finance() {
  const { state } = useStore()
  const today = useToday()

  // (1) trésorerie : le solde bancaire importé fait foi ; sinon le solde
  // manuel — via meteoFinanciere, le sélecteur que le Cockpit lit déjà
  const banque = soldeBancaire(state)
  const meteo = meteoFinanciere(state, today)
  const tresorerie = banque ? banque.solde : meteo.tresorerie
  const prevision = useMemo(() => prevision13Semaines(state, today, 'probable'), [state, today])
  const seuil = state.settings.seuilTresorerie ?? 0

  // (2)-(4) : les définitions partagées avec Ventes et Achats & frais
  const encaisser = useMemo(() => aEncaisser(state, today), [state, today])
  const facturer = useMemo(() => aFacturer(state, today), [state, today])
  const achats = useMemo(() => achatsAPayer(state, today), [state, today])

  // (5) TVA : LE chiffre de la carte TVA (positionTVA) — la carte elle-même
  // vit en tête de la vue Comptable, le clic y mène
  const moisCourant = monthKey(today)
  const tva = useMemo(() => positionTVA(state, { moisCourant }), [state, moisCourant])
  const creditTVA = tva.duALEtat < -0.004

  // (6) marge de l'année — même définition que Pilotage (Synthèse) et la
  // Revue / PDF : CA facturé − coût du temps pointé (coûts DIRECTS datés,
  // audit finance §12 — un budget n'est pas un coût)
  const annee = today.slice(0, 4)
  const syntheseAnnee = useMemo(
    () => analyserPeriode(state, `${annee}-01-01`, today),
    [state, annee, today],
  )
  const marge = syntheseAnnee.totalCA - syntheseAnnee.totalCoutTemps

  return (
    <Page titre="Finance" sousTitre="L'essentiel — six chiffres ; chaque tuile ouvre la vue où l'on agit.">
      <FinanceNav actif="ensemble" />

      <div className="grid3">
        <Tuile
          href="#/finance/banque"
          label="Trésorerie disponible"
          value={tresorerie != null ? <Money v={tresorerie} /> : '—'}
          sub={
            tresorerie == null
              ? 'importer un relevé (Banque) ou saisir le solde (Paramètres)'
              : `point bas prévu ${fmtMoney(prevision.pointBas.solde)} · semaine du ${fmtDate(prevision.pointBas.lundi)}`
          }
          tone={
            tresorerie != null && (tresorerie < 0 || prevision.pointBas.solde < seuil)
              ? 'danger'
              : undefined
          }
        />
        <Tuile
          href="#/facturation"
          label="À encaisser"
          value={<Money v={encaisser.totalTTC} />}
          sub={
            encaisser.nbRetard > 0
              ? `dont ${fmtMoney(encaisser.retardTTC)} en retard (${encaisser.nbRetard} facture${encaisser.nbRetard > 1 ? 's' : ''}) — relancer`
              : `${encaisser.nb} facture${encaisser.nb > 1 ? 's' : ''} émise${encaisser.nb > 1 ? 's' : ''} non soldée${encaisser.nb > 1 ? 's' : ''} · aucun retard`
          }
          tone={encaisser.nbRetard > 0 ? 'warn' : undefined}
        />
        <Tuile
          href="#/facturation"
          label="À facturer"
          value={<Money v={facturer.totalHT} />}
          sub={
            facturer.nb > 0
              ? `${facturer.nb} échéance${facturer.nb > 1 ? 's' : ''} due${facturer.nb > 1 ? 's' : ''} (HT) — émettre dans Ventes`
              : 'aucune échéance due aujourd’hui'
          }
          tone={facturer.nb > 0 ? 'warn' : undefined}
        />
        <Tuile
          href="#/finance/achats"
          label="Achats à payer"
          value={<Money v={achats.totalTTC} />}
          sub={
            achats.nbAValider > 0
              ? `+ ${fmtMoney(achats.aValiderTTC)} à valider (boîte d'arrivée)`
              : achats.nbRetard > 0
                ? `dont ${fmtMoney(achats.retardTTC)} au-delà de l'échéance`
                : 'fournisseurs validés non payés (TTC)'
          }
          tone={achats.nbRetard > 0 ? 'danger' : achats.nbAValider > 0 ? 'warn' : undefined}
        />
        <Tuile
          href="#/finance/comptable"
          label="TVA due à l'État"
          value={<Money v={tva.duALEtat} cents />}
          sub={
            creditTVA
              ? 'crédit de TVA — à voir avec le cabinet (carte TVA, vue Comptable)'
              : 'mois échus non déclarés — carte TVA dans la vue Comptable'
          }
          tone={creditTVA ? 'ok' : undefined}
        />
        <Tuile
          href="#/pilotage"
          label={`Marge ${annee}`}
          value={<Money v={marge} />}
          sub="CA facturé − temps pointé valorisé (coûts directs) — détail dans Pilotage"
          tone={marge < 0 ? 'danger' : undefined}
        />
      </div>
    </Page>
  )
}
