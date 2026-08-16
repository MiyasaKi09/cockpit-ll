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
// ==========================================================================
// TRANCHE 3 DE LA REFONTE — SITUATIONS EST DEVENU UNE VUE DE CET ÉCRAN.
// (docs/REFONTE_NAVIGATION.md §2.3, §3.2, §5)
// ==========================================================================
//
// Le plan l'établissait, l'analyse l'a vérifié : les quatre onglets de
// Situations répondaient déjà à ce que CET écran affiche. « Attendues » est la
// statistique « Situations attendues » ; « Retenues de garantie » est la
// colonne « RG à libérer » ; « Historique — par projet » portait dans son
// titre l'aveu qu'il appartenait au chantier.
//
// CE QUI DISPARAÎT : la destination `#/situations` et ses quatre onglets.
// CE QUI N'EST PAS AJOUTÉ ICI : aucun onglet. Entreprises n'en a jamais eu et
// n'en gagne aucun — c'eût été rendre d'une main ce que l'autre retirait, et
// le compte n'aurait pas bougé d'un endroit.
//
// LA FORME RETENUE, la plus économe des trois essayées :
//
//   1. « Attendues » et « Retenues de garantie » deviennent des FILTRES DE LA
//      LISTE QUI EXISTE DÉJÀ. La ligne d'une entreprise porte déjà « 2
//      situations non reçues » et « RG échue 5 500 € » dans sa colonne « Ce
//      qui crie aujourd'hui » : filtrer la liste sur ce motif rend exactement
//      la vue de l'onglet, dans le tableau qu'on lisait déjà. Zéro endroit.
//   2. Les quatre cartes restent atteignables en REPLI (`<details>`), parce
//      qu'elles portent des gestes que la ligne d'une liste ne peut pas
//      porter : valider / rejeter une situation, copier le prompt de relance,
//      saisir la date de réception d'un marché, marquer une RG libérée. Un
//      repli n'est pas un endroit (§6 du plan : « on replie, on regroupe ») et
//      le contrôle de surface ne le compte pas — à raison : il ne s'impose pas
//      à l'œil, il s'ouvre quand on le demande.
//   3. L'HISTORIQUE quitte le niveau transverse : la fiche d'une entreprise
//      monte le SIEN, tous ses chantiers, là où le certificat et le décompte
//      se réimpriment. `#/situations/historique/chercher/<nom>` — écrite par
//      l'onglet Chantier et par la palette — ouvre donc cette fiche.
//
// routes servies par ce module (le `switch` d'App.tsx en route DEUX sections) :
//
//   · `#/entreprises`                              → la liste
//   · `#/entreprises/<clé>`                        → la fiche EN PAGE
//   · `#/entreprises/situations/<vue>[/…]`         → la liste, vue dépliée
//   · `#/situations[/<vue>[/…]]`                   → L'ANCIENNE ADRESSE, servie
//     telle quelle : `ALIAS_SECTION` allume « Entreprises », et pas un seul
//     émetteur (alerts.ts, la palette, la fiche entreprise, l'onglet Chantier)
//     n'a eu à être réécrit. Une route qui cesse de répondre est une
//     régression ; celle-ci répond, et mène là où le contenu vit désormais.
//
// ORDRE D'AFFICHAGE : ce qui demande une action d'abord, jamais l'ordre
// alphabétique. Le barème vit dans `POIDS_MOTIF` (src/entreprise.ts) pour
// qu'il se discute au même endroit que ce qu'il classe.

import { useState } from 'react'
import type { ReactNode } from 'react'
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
// TRANCHE 3 — les quatre vues de situation sont MONTÉES, pas recopiées : un
// second « Valider » ou un second « Marquer libérée » écrits ici feraient deux
// chemins pour la même écriture, et le figement du décompte n'a qu'un auteur.
import {
  CarteAVerifier,
  CarteAttendues,
  CarteHistorique,
  CarteImport,
  CarteRetenues,
  SEGMENT_SITUATIONS,
  adresseFicheEntreprise,
  cleEntreprise,
  estVueSituation,
  type VueSituation,
} from './Situations'

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
// Le filtre de la liste — deux des quatre ex-onglets tiennent ici
// ------------------------------------------------------------

/** ce sur quoi la liste se restreint. Ce n'est PAS un jeu d'onglets : c'est
 *  une bascule sur les lignes du même tableau, dans les mêmes colonnes — le
 *  filtre déjà présent (« Seulement ce qui demande une action ») gagne deux
 *  valeurs, il ne se dédouble pas.
 *
 *   · `situation` = l'ancien onglet « Attendues » (la statistique du même nom) ;
 *   · `rg`        = l'ancien onglet « Retenues de garantie » (la colonne du
 *                   même nom). */
type Motif = '' | 'action' | 'situation' | 'rg'

const FILTRES: { valeur: Motif; label: string; titre: string }[] = [
  { valeur: '', label: 'Toutes', titre: 'Toutes les entreprises suivies, action ou pas' },
  {
    valeur: 'action',
    label: 'Qui demandent une action',
    titre: 'Visa en retard, situation attendue, RG échue, pénalité à décider, désordre GPA',
  },
  {
    valeur: 'situation',
    label: 'Situation attendue',
    titre: 'L’ancien onglet « Attendues » — la situation du mois n’est pas arrivée (critère du 10 du mois)',
  },
  {
    valeur: 'rg',
    label: 'RG à libérer',
    titre: 'L’ancien onglet « Retenues de garantie » — garantie de parfait achèvement échue, l’argent est à l’entreprise',
  },
]

/** la vue portée par la route décide du filtre : arriver par
 *  `#/situations/attendues` (alerte « situation attendue non reçue ») doit
 *  montrer les entreprises concernées, pas la liste entière. */
const MOTIF_DE_VUE: Partial<Record<VueSituation, Motif>> = { attendues: 'situation', rg: 'rg' }

const retenuParMotif = (l: LigneEntreprise, motif: Motif): boolean =>
  motif === ''
    ? true
    : motif === 'action'
      ? l.poids > 0
      : motif === 'situation'
        ? l.urgences.situationsAttendues > 0
        : l.urgences.rgALibererHT > 0

// ------------------------------------------------------------
// Un repli — pas un endroit
// ------------------------------------------------------------

/** `<details>` dont le contenu ne se MONTE qu'ouvert : quatre cartes de
 *  situation rendues en permanence sous un pli fermé coûteraient le calcul de
 *  quatre écrans pour rien. L'état est local et le repli répond au clic —
 *  `open` piloté sans `onToggle` ferait un pli qui se rouvre tout seul. */
function Repli({
  resume,
  ouvertInitial,
  children,
}: {
  resume: ReactNode
  ouvertInitial: boolean
  children: ReactNode
}) {
  const [ouvert, setOuvert] = useState(ouvertInitial)
  return (
    <details
      open={ouvert}
      onToggle={(e) => setOuvert((e.currentTarget as HTMLDetailsElement).open)}
      style={{ marginTop: 8 }}
    >
      <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
        {resume}
      </summary>
      {ouvert && <div style={{ marginTop: 8 }}>{children}</div>}
    </details>
  )
}

// ------------------------------------------------------------
// La liste
// ------------------------------------------------------------

function ListeEntreprises({
  vue,
  cibleId,
  entrepriseInitiale,
}: {
  /** la vue de situation demandée par l'adresse, `null` sur `#/entreprises` */
  vue: VueSituation | null
  /** `#/situations/verifier/<id>` : la situation à mettre en évidence */
  cibleId: string
  /** `#/situations/<vue>/chercher/<entreprise>` : le filtre pré-rempli */
  entrepriseInitiale: string
}) {
  const { state } = useStore()
  const today = useToday()
  const lignes = entreprisesSuivies(state, today)
  const [recherche, setRecherche] = useState('')
  const [motif, setMotif] = useState<Motif>((vue && MOTIF_DE_VUE[vue]) || '')

  const q = fold(recherche)
  const visibles = lignes.filter((l) => {
    if (!retenuParMotif(l, motif)) return false
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
  /** combien de lignes chaque filtre laisserait — un filtre dont on ne sait
   *  pas s'il rendra quelque chose se clique pour rien */
  const compte = (m: Motif) => lignes.filter((l) => retenuParMotif(l, m)).length

  // les compteurs des replis : lus ici pour que le pli FERMÉ dise déjà ce qui
  // attend derrière — un repli muet est un repli qu'on n'ouvre jamais
  const aVerifier = state.situations.filter((s) => s.statut === 'a_verifier').length
  const traitees = state.situations.length - aVerifier

  return (
    <Page
      titre="Entreprises"
      sousTitre="Tous chantiers confondus : ce que chaque titulaire nous doit, et ce que nous lui devons — situations comprises."
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
          {/* le filtre de la liste — et non une rangée d'onglets : c'est le
              MÊME tableau, les mêmes colonnes, moins de lignes */}
          {FILTRES.map((f) => (
            <Btn
              key={f.valeur || 'tout'}
              small
              kind={motif === f.valeur ? 'primary' : 'default'}
              onClick={() => setMotif(f.valeur)}
              title={f.titre}
            >
              {motif === f.valeur ? '✓ ' : ''}
              {f.label}
              {f.valeur !== '' && ` (${compte(f.valeur)})`}
            </Btn>
          ))}
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
                  {...ligneActivable(() => navigate(adresseFicheEntreprise(l.cle)))}
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

      {/* ───────────── les quatre vues de situation, en repli ─────────────
          Elles portent les GESTES que la ligne d'une liste ne peut pas porter.
          Fermées, elles ne coûtent qu'une ligne ; ouvertes, elles sont mot
          pour mot les cartes de l'ancien écran Situations — même code, même
          « Valider », même certificat. L'adresse décide de celle qui s'ouvre. */}
      <Repli
        ouvertInitial={vue === 'verifier' || Boolean(cibleId)}
        resume={
          aVerifier > 0
            ? `Situations à vérifier (${aVerifier}) — valider, rejeter, imprimer le décompte`
            : 'Situations à vérifier — aucune en attente'
        }
      >
        <div className="pill-note">
          La maîtrise d'œuvre porte le risque sur le délai de paiement : la date limite de
          vérification est calculée d'après le délai du marché (15 j par défaut).
        </div>
        {/* `key` : arriver depuis une AUTRE alerte (ou une autre entreprise)
            repose le filtre et la mise en évidence — sans lui, le second
            lien laisserait l'état du premier en place */}
        <CarteAVerifier
          key={`${cibleId}|${entrepriseInitiale}`}
          cibleId={cibleId}
          entrepriseInitiale={vue === 'verifier' ? entrepriseInitiale : ''}
        />
        <details style={{ marginTop: 8 }}>
          <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
            Dépannage — coller à la main le retour JSON de la routine
          </summary>
          <div style={{ marginTop: 8 }}>
            <CarteImport />
          </div>
        </details>
      </Repli>

      <Repli
        ouvertInitial={vue === 'attendues'}
        resume={
          situations > 0
            ? `Situations attendues du mois (${situations}) — relancer, marché par marché`
            : 'Situations attendues du mois — tout est arrivé'
        }
      >
        <CarteAttendues />
      </Repli>

      <Repli
        ouvertInitial={vue === 'rg'}
        resume={
          rgTotale > 0
            ? `Retenues de garantie — ${fmtMoney(rgTotale)} échus à rendre`
            : 'Retenues de garantie — réception, type de garantie, levée'
        }
      >
        <CarteRetenues />
      </Repli>

      {/* l'historique COMPLET : il ne sert plus que l'adresse qui ne porte
          aucun filtre. Dès qu'un nom d'entreprise voyage avec elle, c'est la
          FICHE de cette entreprise qui s'ouvre — l'historique y vit désormais,
          à côté des marchés qu'il certifie. */}
      <Repli
        ouvertInitial={vue === 'historique'}
        resume={`Historique des situations, tous chantiers (${traitees}) — réimpression du décompte et du certificat`}
      >
        <CarteHistorique />
      </Repli>
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
      {/* TRANCHE 3 — « Historique — par projet » rejoint le titulaire : c'est
          ici que le décompte figé se réimprime et que le certificat de
          paiement s'émet (`ModalCertificat`, un seul auteur). La carte est
          celle de Situations.tsx, restreinte à cette entreprise par
          `marchesDe` — aucun rapprochement réécrit.
          Sans marché, aucune situation n'est possible : la carte ne s'affiche
          pas plutôt que de dire « rien » sous une fiche qui le dit déjà. */}
      {syn.marches.length > 0 && <CarteHistorique entrepriseCle={cle} />}
    </Page>
  )
}

// ------------------------------------------------------------
// Le découpage de l'adresse
// ------------------------------------------------------------

/** les segments qui suivent `situations`, quelle que soit la porte empruntée :
 *  `#/situations/<vue>/…` (ancienne adresse, toujours servie) ou
 *  `#/entreprises/situations/<vue>/…` (la nouvelle). `null` = ce n'est pas une
 *  vue de situation, `route[1]` est donc une clé d'entreprise. */
function segmentsDeSituation(route: string[]): string[] | null {
  if (route[0] === SEGMENT_SITUATIONS) return route.slice(1)
  if (route[1] === SEGMENT_SITUATIONS) return route.slice(2)
  return null
}

export default function Entreprises() {
  const route = useRoute()
  const { state } = useStore()
  const segments = segmentsDeSituation(route)

  if (segments) {
    // une adresse de situation sans vue lisible vaut « À vérifier », comme
    // l'ancien écran : `#/situations` tout court y déposait déjà
    const vue: VueSituation = estVueSituation(segments[0]) ? segments[0] : 'verifier'
    // Deux routes profondes, distinguées par le SEUL segment qui suit la vue —
    // et elles ne peuvent pas se confondre : aucun identifiant ne vaut
    // « chercher ». Cette lecture est celle de l'ancien écran, déplacée d'un
    // fichier, pas réécrite.
    //   · `<vue>/chercher/<entreprise>` (palette « / ») : le filtre arrive
    //     pré-rempli ;
    //   · `<vue>/<id>` (alerte « situation à vérifier », alerts.ts) : la ligne
    //     est mise en évidence et ramenée à l'écran.
    const entrepriseRoute = segments[1] === 'chercher' ? segments[2] || '' : ''
    const idRoute = segments[1] && segments[1] !== 'chercher' ? segments[1] : ''

    // L'HISTORIQUE D'UNE ENTREPRISE NOMMÉE EST SA FICHE. C'est le déménagement
    // du §3.2 : le titre « Historique — par projet » disait que ces lignes
    // appartenaient au chantier et au titulaire, pas à une liste transverse.
    // L'onglet Chantier et la palette écrivent tous deux cette adresse.
    if (vue === 'historique' && entrepriseRoute) {
      const cle = cleEntreprise(state, entrepriseRoute)
      return <PageFiche key={cle} cle={cle} />
    }

    return (
      <ListeEntreprises
        key={`${vue}|${idRoute}|${entrepriseRoute}`}
        vue={vue}
        cibleId={idRoute}
        entrepriseInitiale={entrepriseRoute}
      />
    )
  }

  const cle = route[1] || ''
  // `key` : passer d'une entreprise à l'autre par la barre d'adresse ou la
  // recherche « / » doit REMONTER la fiche, pas garder l'état ouvert de la
  // précédente (même précaution que les cartes de Situations.tsx)
  return cle ? (
    <PageFiche key={cle} cle={cle} />
  ) : (
    <ListeEntreprises vue={null} cibleId="" entrepriseInitiale="" />
  )
}
