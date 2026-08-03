// ============================================================
// B.18 — l'écran qui mesure la parité des deux mémoires.
//
// B.15 coupe l'ingestion navigateur sous condition de « sept jours
// consécutifs en production sans écart ». Le plan cite cette phrase trois
// fois comme non négociable, et rien ne la mesurait : sans cet écran,
// c'est une intention, et elle cède le jour où quelqu'un est pressé.
//
// Écran d'EXPLOITATION : il ne se range pas dans le menu, il s'atteint par
// son adresse (`#/parite`). Il n'a d'intérêt que pendant la transition et
// disparaîtra avec `src/boite.ts`.
//
// Aucun calcul ici : `comparerMemoires` et `joursConsecutifsSansEcart`
// vivent dans `src/boite.ts` et sont exercés en CI.
// ============================================================

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { Card, EmptyState, Page, Stat, Table, useToday } from '../ui'
import {
  ECARTS_BLOQUANTS,
  JOURS_DE_PARITE_EXIGES,
  LIBELLES_ECART,
  comparerMemoires,
  joursConsecutifsSansEcart,
} from '../boite'
import { useCommunications } from '../communications'
import { addDays } from '../util'

/** on regarde un mois : assez pour voir une tendance, assez peu pour que
 *  la lecture paginée de la couche d'accès suffise */
const JOURS_OBSERVES = 30

export default function Parite() {
  const { state } = useStore()
  const today = useToday()
  const [debut, setDebut] = useState(addDays(today, -JOURS_OBSERVES))

  // Sans filtre : la parité se juge sur TOUT le courrier, pas sur ce qui
  // reste à traiter. Filtrer ici mesurerait autre chose que ce que B.15
  // exige, et le dirait quand même avec assurance.
  const { lignes, source, erreur } = useCommunications({}, 200)

  const parite = useMemo(
    () => (lignes ? comparerMemoires(state.courriers, lignes, { debut, fin: today }) : null),
    [state.courriers, lignes, debut, today],
  )
  const consecutifs = parite ? joursConsecutifsSansEcart(parite) : 0
  const bloquants = parite
    ? parite.reduce((n, j) => n + j.ecarts.filter((e) => ECARTS_BLOQUANTS.has(e.genre)).length, 0)
    : 0

  return (
    <Page
      titre="Parité des deux mémoires"
      sousTitre="Condition de coupure de l’ingestion navigateur (livrable B.15)"
    >
      <Card titre="Où en est-on">
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Stat
            label="Jours consécutifs sans écart"
            value={`${consecutifs} / ${JOURS_DE_PARITE_EXIGES}`}
            tone={consecutifs >= JOURS_DE_PARITE_EXIGES ? 'ok' : 'warn'}
          />
          <Stat label="Écarts bloquants sur la période" value={String(bloquants)} />
          <label className="small">
            Depuis le{' '}
            <input type="date" value={debut} max={today} onChange={(e) => setDebut(e.target.value || debut)} />
          </label>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          Un jour sans aucun message des deux côtés n’est pas « sans écart » : il est sans information, et
          le compteur s’y arrête. Sept jours de congés ne prouvent rien.
          {source === 'cache' && ' — lecture depuis le cache local : la mesure peut être en retard sur le serveur.'}
        </p>
      </Card>

      <Card titre="Jour par jour">
        {erreur ? (
          <EmptyState>La table des messages est illisible : {erreur}</EmptyState>
        ) : !parite ? (
          <EmptyState>
            Lecture en cours — ni le réseau ni le cache n’ont encore répondu. Aucune conclusion n’est tirée
            d’une absence de réponse.
          </EmptyState>
        ) : parite.length === 0 ? (
          <EmptyState>
            Aucun message dans cette fenêtre, d’aucune des deux mémoires. Il n’y a rien à comparer — ce
            n’est pas une parité.
          </EmptyState>
        ) : (
          <Table head={['Jour', 'Navigateur', 'Serveur', 'Écarts']}>
            {parite.map((j) => (
              <tr key={j.jour}>
                <td>{j.jour}</td>
                <td>{j.nbAncien}</td>
                <td>{j.nbRelationnel}</td>
                <td>
                  {j.ecarts.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {j.ecarts.map((e, i) => (
                        <li key={`${e.gmailId}-${i}`} className="small">
                          <span className={ECARTS_BLOQUANTS.has(e.genre) ? 'badge badge-warn' : 'badge badge-muted'}>
                            {LIBELLES_ECART[e.genre]}
                          </span>{' '}
                          {e.objet} — <span className="muted">{e.detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </Page>
  )
}
