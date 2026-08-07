// 5.21 — L'ENTREPRISE A UNE MAISON.
//
// Le diagnostic, mot pour mot : « je ne vois pas la gestion améliorée du
// planning des entreprises, la gestion simplifiée des situations,
// certificats de paiement ». Les briques existaient toutes. Ce qui manquait
// était l'ADRESSE : `syntheseEntreprise` agrégeait déjà les marchés tous
// chantiers, la RG retenue et à libérer, les pénalités encourues, les
// désordres GPA, les visas en attente, les situations manquantes et le
// dernier certificat — et ne s'ouvrait que dans une MODALE, qu'on ne pouvait
// atteindre qu'en étant DÉJÀ dans un projet. Autrement dit : pour savoir ce
// que HORIZONS nous doit sur les quatre chantiers, il fallait d'abord
// choisir un chantier.
//
// Cet écran est la destination manquante. Il ne calcule RIEN : il affiche
// `entreprisesSuivies` (src/entreprise.ts), qui appelle `syntheseEntreprise`
// par entreprise et se contente de compter ce qu'elle rend. La liste et la
// fiche disent donc littéralement la même chose — impossible qu'elles
// divergent, elles lisent le même objet.
//
// routes_requises (à câbler dans src/App.tsx, hors de portée de ce module) :
//
//     case 'entreprises':
//       page = <Entreprises />
//       break
//
//   · `#/entreprises`        → la liste (route[1] absent)
//   · `#/entreprises/<id>`   → la fiche EN PAGE (route[1] = clé)
//
//   Un SEUL `case` suffit : le découpage se fait ici, sur `route[1]`, comme
//   `#/projets/<id>` dans Projets.tsx. La clé est l'id du registre quand il
//   existe, sinon le nom plié (`fold`) — `useRoute()` décode déjà les
//   segments, et `navigate` encode : un nom à espaces voyage intact.
//
//   Entrée de MENU souhaitée : « Entreprises », près de « Situations » —
//   ce sont les deux faces du même suivi (le mois d'un chantier / le
//   portefeuille d'un titulaire).
//
// ORDRE D'AFFICHAGE : ce qui demande une action d'abord, jamais l'ordre
// alphabétique. Le barème vit dans `POIDS_MOTIF` (src/entreprise.ts) pour
// qu'il se discute au même endroit que ce qu'il classe.

import { useState } from 'react'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  Money,
  Page,
  Stat,
  Table,
  TextInput,
  ligneActivable,
  navigate,
  useRoute,
  useToday,
} from '../ui'
import { fmtMoney, fold } from '../util'
import { entreprisesSuivies, syntheseEntreprise, type LigneEntreprise } from '../entreprise'
import { CorpsFicheEntreprise } from './FicheEntreprise'

/** l'adresse d'une entreprise — encodée, parce qu'une clé de repli est un
 *  NOM (« sarl martin btp ») et qu'un nom porte des espaces */
const adresseFiche = (cle: string) => `/entreprises/${encodeURIComponent(cle)}`

// ------------------------------------------------------------
// « Ce qui crie aujourd'hui » — une colonne, pas six
// ------------------------------------------------------------

/** les motifs d'une ligne, du plus pressant au moins pressant. L'ordre suit
 *  celui de POIDS_MOTIF : ce qu'on lit en premier est ce qui pèse le plus. */
function motifsDe(l: LigneEntreprise): { tone: 'danger' | 'warn' | 'info'; texte: string; titre: string }[] {
  const u = l.urgences
  const out: { tone: 'danger' | 'warn' | 'info'; texte: string; titre: string }[] = []
  if (u.visasEnRetard > 0) {
    out.push({
      tone: 'danger',
      texte: `${u.visasEnRetard} visa${u.visasEnRetard > 1 ? 's' : ''} en retard`,
      titre: 'Le délai du CCAP est dépassé : c’est la responsabilité de la MOE qui court, pas celle de l’entreprise.',
    })
  }
  if (u.situationsAttendues > 0) {
    out.push({
      tone: u.graviteSituation === 3 ? 'danger' : 'warn',
      texte: `${u.situationsAttendues} situation${u.situationsAttendues > 1 ? 's' : ''} non reçue${u.situationsAttendues > 1 ? 's' : ''}`,
      titre:
        u.graviteSituation === 3
          ? 'Passé le 20 : la vérification puis le paiement se décalent d’autant. La fiche ouvre le brouillon de relance.'
          : 'Attendue depuis le 10 du mois — à surveiller.',
    })
  }
  if (u.rgALibererHT > 0) {
    out.push({
      tone: 'danger',
      texte: `RG échue ${fmtMoney(u.rgALibererHT)}`,
      titre: 'Garantie de parfait achèvement échue : cet argent est à l’entreprise. La fiche porte le bouton « Lever la RG ».',
    })
  }
  if (u.penalitesADecider > 0) {
    out.push({
      tone: 'warn',
      texte: `${u.penalitesADecider} pénalité${u.penalitesADecider > 1 ? 's' : ''} à décider (${fmtMoney(u.penalitesADeciderHT)})`,
      titre: 'Une exposition encourue qu’aucune décision humaine n’a figée — ni appliquée, ni abandonnée.',
    })
  }
  if (u.desordresGPA > 0) {
    out.push({
      tone: 'warn',
      texte: `${u.desordresGPA} désordre${u.desordresGPA > 1 ? 's' : ''} GPA`,
      titre: 'Désordre signalé pendant la garantie de parfait achèvement, pas encore levé.',
    })
  }
  const visasDansLesDelais = u.visasEnAttente - u.visasEnRetard
  if (visasDansLesDelais > 0) {
    out.push({
      tone: 'info',
      texte: `${visasDansLesDelais} visa${visasDansLesDelais > 1 ? 's' : ''} à viser`,
      titre: 'Document d’exécution reçu, encore dans le délai du CCAP.',
    })
  }
  return out
}

// ------------------------------------------------------------
// La liste
// ------------------------------------------------------------

function ListeEntreprises() {
  const { state } = useStore()
  const today = useToday()
  const lignes = entreprisesSuivies(state, today)
  const [recherche, setRecherche] = useState('')
  const [seulementAction, setSeulementAction] = useState(false)

  const q = fold(recherche)
  const visibles = lignes.filter((l) => {
    if (seulementAction && l.poids === 0) return false
    if (!q) return true
    // le nom, mais aussi les lots et les chantiers : on cherche autant
    // « Dubois » que « menuiseries » ou le code du chantier
    return (
      fold(l.nom).includes(q) ||
      l.lots.some(
        (lot) =>
          fold(lot.lot).includes(q) ||
          fold(lot.projetId).includes(q) ||
          fold(lot.projetNom || '').includes(q),
      )
    )
  })

  const quiCrient = lignes.filter((l) => l.poids > 0).length
  const rgTotale = lignes.reduce((s, l) => s + l.urgences.rgALibererHT, 0)
  const situations = lignes.reduce((s, l) => s + l.urgences.situationsAttendues, 0)
  const engagement = lignes.reduce((s, l) => s + l.montantMarchesHT, 0)

  return (
    <Page
      titre="Entreprises"
      sousTitre="Tous chantiers confondus : ce que chaque titulaire nous doit, et ce que nous lui devons."
    >
      <div className="grid4" style={{ marginBottom: 12 }}>
        <Stat
          label="Suivies"
          value={lignes.length}
          sub={`${lignes.filter((l) => l.lots.length > 0).length} avec un marché`}
        />
        <Stat
          label="Qui demandent une action"
          value={quiCrient}
          tone={quiCrient > 0 ? 'warn' : 'ok'}
          sub={quiCrient > 0 ? 'en tête de liste' : 'rien ne crie aujourd’hui'}
        />
        <Stat
          label="RG à libérer"
          value={<Money v={rgTotale} />}
          tone={rgTotale > 0 ? 'danger' : undefined}
          sub={rgTotale > 0 ? 'GPA échue — argent des entreprises' : 'rien d’échu'}
        />
        <Stat
          label="Situations attendues"
          value={situations}
          tone={situations > 0 ? 'warn' : 'ok'}
          sub={<>engagement total <Money v={engagement} /> HT</>}
        />
      </div>

      <Card>
        <div className="form-row" style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <TextInput
              value={recherche}
              onChange={setRecherche}
              placeholder="Entreprise, lot ou chantier…"
              ariaLabel="Filtrer les entreprises"
            />
          </div>
          <Btn
            small
            kind={seulementAction ? 'primary' : 'default'}
            onClick={() => setSeulementAction(!seulementAction)}
            title="N’afficher que les entreprises qui demandent un geste aujourd’hui"
          >
            {seulementAction ? '✓ ' : ''}Seulement ce qui demande une action
          </Btn>
        </div>

        {visibles.length === 0 ? (
          <EmptyState>
            {lignes.length === 0
              ? 'Aucune entreprise : la liste se remplit toute seule dès qu’un marché de travaux nomme un titulaire (fiche projet, carte « Marchés de travaux »).'
              : 'Aucune entreprise ne correspond à ce filtre.'}
          </EmptyState>
        ) : (
          <Table
            head={[
              'Entreprise',
              'Lots et chantiers',
              <span key="m" className="right">Marchés HT</span>,
              'Ce qui crie aujourd’hui',
              <span key="r" className="right">RG à libérer</span>,
            ]}
          >
            {visibles.map((l) => {
              const motifs = motifsDe(l)
              const actifs = l.lots.filter((x) => x.actif)
              const montres = actifs.length > 0 ? actifs : l.lots
              return (
                <tr
                  key={l.cle}
                  {...ligneActivable(() => navigate(adresseFiche(l.cle)))}
                  title={`Ouvrir la fiche de ${l.nom}`}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <strong>{l.nom}</strong>
                    <div className="muted small">
                      {l.lots.length === 0
                        ? 'au registre, sans marché'
                        : `${l.lots.length} marché${l.lots.length > 1 ? 's' : ''} · ${l.nbProjets} chantier${l.nbProjets > 1 ? 's' : ''}`}
                    </div>
                  </td>
                  <td className="small">
                    {montres.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      montres.slice(0, 4).map((lot) => (
                        <div key={lot.marcheId}>
                          {lot.lot}{' '}
                          <span className="muted">
                            — {lot.projetNom || lot.projetId}
                            {lot.actif ? '' : ' (clos)'}
                          </span>
                        </div>
                      ))
                    )}
                    {montres.length > 4 && (
                      <div className="muted">+ {montres.length - 4} autre(s)</div>
                    )}
                  </td>
                  <td className="right">
                    <Money v={l.montantMarchesHT} />
                  </td>
                  <td className="small">
                    {motifs.length === 0 ? (
                      <span className="muted">rien à faire aujourd’hui</span>
                    ) : (
                      motifs.map((m, i) => (
                        <div key={i} style={{ marginBottom: 2 }}>
                          <span title={m.titre}>
                            <Badge tone={m.tone}>{m.texte}</Badge>
                          </span>
                        </div>
                      ))
                    )}
                  </td>
                  <td className="right">
                    {l.urgences.rgALibererHT > 0 ? (
                      <strong>{fmtMoney(l.urgences.rgALibererHT)}</strong>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          Tri : ce qui demande une action d’abord (visa en retard, situation attendue, RG échue,
          pénalité à décider, désordre GPA, visa dans les délais), puis le montant de marché.
          L’argent départage, il ne classe pas — sinon le gros lot silencieux passerait devant le
          petit lot qui bloque le chantier.
        </p>
      </Card>
    </Page>
  )
}

// ------------------------------------------------------------
// La fiche, en page (adressable)
// ------------------------------------------------------------

function PageFiche({ cle }: { cle: string }) {
  const { state } = useStore()
  const today = useToday()
  const syn = syntheseEntreprise(state, cle, today)
  return (
    <Page
      titre={syn.nom}
      sousTitre="Fiche entreprise — tous chantiers confondus."
      actions={
        <Btn small kind="ghost" onClick={() => navigate('/entreprises')} title="Retour à la liste">
          ← Toutes les entreprises
        </Btn>
      }
    >
      <Card>
        <CorpsFicheEntreprise nomOuId={cle} enPage />
      </Card>
    </Page>
  )
}

export default function Entreprises() {
  const route = useRoute()
  const cle = route[1] || ''
  // `key` : passer d'une entreprise à l'autre par la barre d'adresse ou la
  // recherche « / » doit REMONTER la fiche, pas garder l'état ouvert de la
  // précédente (même précaution que les cartes de Situations.tsx)
  return cle ? <PageFiche key={cle} cle={cle} /> : <ListeEntreprises />
}
