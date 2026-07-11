// Pilotage — la fusion Analyse + Revue (audit simplification) : une
// seule destination pour « comment va l'agence ». Quatre vues :
// Synthèse (l'essentiel + une recommandation), Missions (€/jour réel),
// Équipe (temps, coûts, périodes comparables), Revue / PDF (le bilan
// daté imprimable). #/analyse et #/revue restent des alias.

import { useMemo } from 'react'
import { useStore } from '../store'
import { Badge, Card, EmptyState, Page, Progress, Stat, Table, Tabs, navigate, useRoute, useToday } from '../ui'
import { fmtMoney, fmtPct, todayISO } from '../util'
import {
  analyserPeriode,
  caCible,
  caRealiseAnnee,
  coutJourObjectif,
  nomProjet,
  tempsParPersonne,
} from '../derive'
import { alertesActives } from '../alerts'
import { CarteComparaison, MissionsContenu } from './Analyse'
import { RevueContenu } from './Revue'

const VUES = [
  { id: 'synthese', label: 'Synthèse' },
  { id: 'missions', label: 'Missions' },
  { id: 'equipe', label: 'Équipe' },
  { id: 'revue', label: 'Revue / PDF' },
] as const

type Vue = (typeof VUES)[number]['id']

// ------------------------------------------------------------
// Synthèse — l'essentiel, puis UNE recommandation concrète
// ------------------------------------------------------------

function SyntheseContenu() {
  const { state } = useStore()
  const today = useToday()
  const annee = Number(today.slice(0, 4))
  const objectif = coutJourObjectif(state)
  const cible = caCible(state)
  const caRealise = caRealiseAnnee(state, annee)

  // le mois courant donne la température ; l'année donne le cap
  const debutMois = `${today.slice(0, 7)}-01`
  const mois = useMemo(() => analyserPeriode(state, debutMois, today), [state, debutMois, today])
  const anneeSyn = useMemo(() => analyserPeriode(state, `${annee}-01-01`, today), [state, annee, today])
  const margeMois = mois.totalCA - mois.totalCoutTemps - mois.totalCoutExterne

  // missions à surveiller : sous l'objectif €/jour avec du temps réellement posé
  const aSurveiller = anneeSyn.lignes
    .filter((l) => l.parJour !== null && l.jours >= 1 && l.parJour < objectif)
    .sort((a, b) => (a.parJour ?? 0) - (b.parJour ?? 0))
    .slice(0, 3)

  // UNE recommandation : l'alerte la plus grave, sinon la pire mission
  const alertes = alertesActives(state, today)
  const urgente = alertes.find((a) => a.gravite === 3) || alertes.find((a) => a.gravite === 2)
  const reco = urgente
    ? { texte: urgente.titre, lien: urgente.lien, detail: urgente.detail }
    : aSurveiller[0]
      ? {
          texte: `Surveiller ${nomProjet(state, aSurveiller[0].projetId)} — ${fmtMoney(aSurveiller[0].parJour)} / jour, sous l'objectif de ${fmtMoney(objectif)}.`,
          lien: `#/projets/${aSurveiller[0].projetId}`,
          detail: undefined,
        }
      : null

  const treso = state.settings.tresorerieDispo

  return (
    <>
      {cible > 0 && (
        <Card titre={`Objectif de chiffre d'affaires ${annee}`}>
          <Progress
            value={caRealise}
            max={cible}
            header={
              <>
                <span>
                  {fmtMoney(caRealise)} <span className="muted">/ {fmtMoney(cible)} HT</span>
                </span>
                <Badge tone={caRealise >= cible ? 'ok' : caRealise >= cible * 0.6 ? 'warn' : 'danger'}>
                  {fmtPct(cible > 0 ? caRealise / cible : 0, 0)}
                </Badge>
              </>
            }
          />
          <p className="muted small" style={{ marginTop: 8 }}>
            Reste à facturer pour tenir la cible : <strong>{fmtMoney(Math.max(0, cible - caRealise))}</strong>.
          </p>
        </Card>
      )}

      <div className="grid3" style={{ marginBottom: 16 }}>
        <Stat
          label="Trésorerie disponible"
          value={treso != null ? fmtMoney(treso) : '—'}
          sub={treso != null ? 'saisie dans Paramètres' : <a href="#/parametres">à renseigner dans Paramètres</a>}
        />
        <Stat
          label="Marge réelle du mois"
          value={fmtMoney(margeMois)}
          tone={margeMois < 0 ? 'danger' : undefined}
          sub="CA émis − coût du temps pointé − coûts externes"
        />
        <Stat
          label="€ / jour moyen du mois"
          value={mois.parJourMoyen !== null ? fmtMoney(mois.parJourMoyen) : '—'}
          tone={mois.parJourMoyen !== null && mois.parJourMoyen < objectif ? 'warn' : undefined}
          sub={`objectif ${fmtMoney(objectif)}`}
        />
      </div>

      {reco && (
        <Card titre="La prochaine meilleure action">
          <p style={{ margin: 0 }}>
            <strong>{reco.texte}</strong>
            {reco.detail && <span className="muted"> — {reco.detail}</span>}{' '}
            <a href={reco.lien}>ouvrir →</a>
          </p>
        </Card>
      )}

      <Card titre="Missions à surveiller — sous l'objectif €/jour (année en cours)">
        {aSurveiller.length === 0 ? (
          <EmptyState>Toutes les missions actives paient leur journée — rien à surveiller.</EmptyState>
        ) : (
          <Table
            compact
            head={[
              'Mission',
              <span key="pj" className="right">€ / jour</span>,
              <span key="j" className="right">Jours</span>,
              <span key="ca" className="right">CA HT</span>,
            ]}
          >
            {aSurveiller.map((l) => (
              <tr key={l.projetId}>
                <td>
                  <a href={`#/projets/${l.projetId}`}>{nomProjet(state, l.projetId)}</a>
                </td>
                <td className="right num warn-text">{l.parJour !== null ? fmtMoney(l.parJour) : '—'}</td>
                <td className="right num">{Math.round(l.jours * 10) / 10}</td>
                <td className="right num">{fmtMoney(l.ca)}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="muted small" style={{ marginTop: 8 }}>
          Le détail complet et les causes : vue <a href="#/pilotage/missions">Missions</a>.
        </p>
      </Card>
    </>
  )
}

// ------------------------------------------------------------
// Équipe — temps pointé, coûts réels, périodes comparables
// ------------------------------------------------------------

function EquipeContenu() {
  const { state } = useStore()
  const today = useToday()
  const annee = Number(today.slice(0, 4))
  const tpp = useMemo(() => tempsParPersonne(state, `${annee}-01-01`, today), [state, annee, today])

  return (
    <>
      <Card titre={`Temps pointé par personne — année ${annee}`}>
        {tpp.length === 0 ? (
          <EmptyState>Aucune heure pointée cette année.</EmptyState>
        ) : (
          <Table
            compact
            head={[
              'Personne',
              <span key="h" className="right">Heures</span>,
              <span key="j" className="right">Jours</span>,
              <span key="c" className="right">Coût réel</span>,
            ]}
          >
            {tpp.map((l) => (
              <tr key={l.personne}>
                <td>{l.personne}</td>
                <td className="right num">{Math.round(l.heures)} h</td>
                <td className="right num">{Math.round(l.jours * 10) / 10}</td>
                <td className="right num">{fmtMoney(l.cout)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <CarteComparaison />
    </>
  )
}

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

export default function Pilotage({ ongletInitial = 'synthese' }: { ongletInitial?: Vue }) {
  // vraies routes : #/pilotage/<vue> — #/analyse et #/revue restent des alias
  const route = useRoute()
  const vue: Vue =
    route[0] === 'pilotage' && (VUES as readonly { id: string }[]).some((v) => v.id === route[1])
      ? (route[1] as Vue)
      : ongletInitial
  return (
    <Page
      titre="Pilotage"
      sousTitre="Comment va l'agence — et la prochaine meilleure action."
    >
      <Tabs
        tabs={VUES.map((v) => ({ id: v.id, label: v.label }))}
        actif={vue}
        onSelect={(id) => navigate(`/pilotage/${id}`)}
      />
      {vue === 'synthese' && <SyntheseContenu />}
      {vue === 'missions' && <MissionsContenu />}
      {vue === 'equipe' && <EquipeContenu />}
      {vue === 'revue' && <RevueContenu />}
    </Page>
  )
}
