// Bien démarrer — le parcours de prise en main : 8 étapes, ~1 h,
// cases cochées persistées. Objectif : une personne qui ne
// connaît rien à l'outil est opérationnelle en une heure.

import type { ReactNode } from 'react'
import { useStore } from '../store'
import { ROUTINES } from '../routines'
import { Badge, Btn, Card } from '../ui'

interface Etape {
  id: string
  titre: string
  duree: string
  contenu: ReactNode
}

export function BienDemarrerContenu() {
  const { state, update } = useStore()
  const coche = state.settings.onboarding || {}

  const basculer = (id: string) =>
    update((d) => {
      const o = d.settings.onboarding || {}
      o[id] = !o[id]
      d.settings.onboarding = o
    })

  const etapes: Etape[] = [
    {
      id: 'parametres',
      titre: 'Régler les paramètres de l’agence',
      duree: '5 min',
      contenu: (
        <>
          Équipe, taux horaire, trésorerie disponible, délais de paiement — tout le reste se calcule à
          partir de là. <a href="#/parametres">Ouvrir les Paramètres →</a>
        </>
      ),
    },
    {
      id: 'projets-claude',
      titre: 'Créer les 4 Projets Claude',
      duree: '15 min',
      contenu: (
        <>
          Dans Claude (claude.ai), créez 4 Projets avec leurs instructions permanentes :{' '}
          <strong>« CR de chantier »</strong> (votre template de CR + liste type d'intervenants),{' '}
          <strong>« Analyse AO »</strong> (vos critères Go/No-Go), <strong>« Secrétariat »</strong> (ton,
          signature, coordonnées) et <strong>« Matériauthèque »</strong> (vocabulaire de tags). Le contexte
          n'est plus jamais retapé : les boutons du Cockpit copient des prompts « prêts à coller » vers ces
          Projets.
        </>
      ),
    },
    {
      id: 'routines',
      titre: 'Programmer les 3 routines',
      duree: '10 min',
      contenu: (
        <>
          Dans Claude, créez trois tâches programmées en collant les prompts de la page{' '}
          <a href="#/routines">Routines</a> (accès Gmail autorisé) :{' '}
          {ROUTINES.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ' · '}
              <em>{r.titre}</em>
            </span>
          ))}
          . Elles tourneront seules ; leurs résultats se collent dans la boîte « À traiter ».
        </>
      ),
    },
    {
      id: 'gmail',
      titre: 'Côté Gmail : situations@ et les filtres',
      duree: '10 min',
      contenu: (
        <>
          Ouvrez l'adresse dédiée <strong>situations@agence-ll.fr</strong> (à imposer dans les marchés de
          travaux) et posez 3 filtres natifs : Administratif / Chantier / Client. C'est tout — le tri fin,
          c'est la routine du matin qui le fait.
        </>
      ),
    },
    {
      id: 'premier-projet',
      titre: 'Créer votre premier vrai projet',
      duree: '5 min',
      contenu: (
        <>
          <a href="#/projets">Projets → Nouveau projet</a> : 3 étapes. Nom et montant de travaux → les
          honoraires se calculent (barème MIQCP actualisé) → trois dates → les phases ET l'échéancier de
          facturation sont générés automatiquement. Écrasez ensuite les projets d'exemple P01/P02.
        </>
      ),
    },
    {
      id: 'espace-projet',
      titre: 'Faire vivre l’espace projet',
      duree: '10 min',
      contenu: (
        <>
          Dans la fiche du projet, tout se rattache au fil de l'eau : les <em>marchés de travaux</em> à la
          signature (onglet Chantier), les <em>matériaux, artisans et liens</em> (onglet Ressources), les{' '}
          <em>notes et décisions</em> (onglet Journal). Une saisie, visible partout.
        </>
      ),
    },
    {
      id: 'temps',
      titre: 'Pointer les heures de la semaine',
      duree: '2 min / semaine',
      contenu: (
        <>
          <a href="#/temps">Saisie des temps</a> : une ligne par projet, les dérives contre le budget
          d'heures s'affichent seules — et ces données calibreront vos prochains devis d'honoraires.
        </>
      ),
    },
    {
      id: 'sauvegarde',
      titre: 'Exporter une première sauvegarde',
      duree: '1 min',
      contenu: (
        <>
          <a href="#/parametres">Paramètres → Exporter les données (JSON)</a>, à déposer dans le Drive.
          En local, les données vivent dans ce navigateur : l'export régulier est votre filet.
        </>
      ),
    },
  ]

  const faites = etapes.filter((e) => coche[e.id]).length
  const pct = Math.round((faites / etapes.length) * 100)

  return (
    <>
      <div className="toolbar" style={{ alignItems: 'baseline' }}>
        <p className="small muted" style={{ margin: 0, maxWidth: '70ch' }}>
          Le circuit complet en une heure. Après ça, le quotidien tient en trois gestes : regarder
          « À traiter », cliquer, coller.
        </p>
        <span className="spacer" />
        <Badge tone={pct === 100 ? 'ok' : 'info'}>
          {faites}/{etapes.length} étapes · {pct} %
        </Badge>
      </div>

      <div className="pill-note">
        Le principe de l'outil : <strong>l'intranet calcule, Claude rédige, l'humain valide.</strong>{' '}
        Aucune IA dans le site — les chiffres sont toujours justes. Les boutons « Copier » assemblent des
        prompts complets avec les données de la base : on ne colle plus jamais le contexte, seulement les
        résultats.
      </div>

      {etapes.map((e, i) => (
        <Card key={e.id} className={coche[e.id] ? '' : ''}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <Btn
              small
              kind={coche[e.id] ? 'primary' : 'default'}
              onClick={() => basculer(e.id)}
              title={coche[e.id] ? 'Marquer à refaire' : 'Marquer comme faite'}
            >
              {coche[e.id] ? '✓' : `${i + 1}`}
            </Btn>
            <div style={{ minWidth: 0, opacity: coche[e.id] ? 0.55 : 1 }}>
              <div style={{ fontWeight: 650 }}>
                {e.titre} <Badge tone="muted">{e.duree}</Badge>
              </div>
              <p className="small" style={{ marginTop: 4, maxWidth: '80ch' }}>
                {e.contenu}
              </p>
            </div>
          </div>
        </Card>
      ))}

      <Card titre="Et chaque matin ? Le rituel en 3 gestes (10 minutes)">
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
          <li>
            Lire le <strong>digest du matin</strong> dans Claude (il a déjà trié la boîte mail — priorités,
            brouillons de réponse préparés).
          </li>
          <li>
            Si une routine a produit un bloc JSON : le coller dans <a href="#/routines">Routines → Import</a>{' '}
            (10 secondes).
          </li>
          <li>
            Ouvrir le <a href="#/">Cockpit</a> : la boîte <strong>« À traiter »</strong> et le fil
            d'urgences disent quoi faire, dans l'ordre, avec le bon bouton à côté. Les mails, eux, peuvent
            attendre.
          </li>
        </ol>
      </Card>
    </>
  )
}
