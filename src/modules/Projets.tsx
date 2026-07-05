// ============================================================
// Projets — liste + espace projet (hub à onglets).
// Tout ce qui concerne un projet se rattache ICI, au fil de
// l'eau : pilotage MIQCP, chantier (marchés, CR), ressources
// (matériaux, artisans, liens), journal, finances & temps.
// ============================================================

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Phase, PhaseCode, Projet, StatutProjet, TypeMO } from '../types'
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
  Tabs,
  TextArea,
  TextInput,
  navigate,
  useRoute,
  useToday,
} from '../ui'
import type { Tone } from '../ui'
import { fmtHeures, fmtMoney, fmtPct, fold, todayISO, uid } from '../util'
import {
  CRITERES_COMPLEXITE,
  LIBELLES_PHASES,
  OUVRAGES,
  calculHonoraires,
  coefComplexite,
  phasesParDefaut,
  plageOuvrage,
  seuilPlancherActualise,
  totalPointsComplexite,
} from '../miqcp'
import { coutJourObjectif, coutReelTemps, coutsExternes, encaissementPrevu, enJours, factureHT, heuresPrevues, heuresReelles, retardFacture, ttc } from '../derive'
import { assemble, contexteProjet } from '../prompts'
import { facturesParDefaut } from '../echeancier'
import ProjetNouveau from './ProjetNouveau'
import ProjetChantier from './ProjetChantier'
import ProjetRessources from './ProjetRessources'
import ProjetJournal from './ProjetJournal'
import ProjetDocuments from './ProjetDocuments'

// ---------- constantes & petits helpers ----------

const STATUTS: StatutProjet[] = ['Prospect', 'Offre remise', 'Signé', 'En cours', 'Livré', 'Perdu']
const TYPES_MO: TypeMO[] = ['Public', 'Privé pro', 'Particulier']

function toneStatut(s: StatutProjet): Tone {
  switch (s) {
    case 'Prospect':
      return 'muted'
    case 'Offre remise':
      return 'warn'
    case 'Signé':
      return 'info'
    case 'En cours':
      return 'ok'
    case 'Livré':
      return 'muted'
    case 'Perdu':
      return 'danger'
  }
}

function fmtCoef(c: number | null | undefined): string {
  return c === null || c === undefined ? '—' : c.toFixed(2).replace('.', ',')
}

/** badge d'écart heures réelles / prévues (cohérent avec le fil d'urgences) */
function EcartHeures({ reel, prevu, seuil }: { reel: number; prevu: number; seuil: number }) {
  if (reel <= 0) return <span className="muted">—</span>
  if (prevu <= 0) return <Badge tone="warn">sans budget</Badge>
  const ratio = reel / prevu
  const tone: Tone = ratio >= 1 ? 'danger' : ratio >= seuil ? 'warn' : 'ok'
  return <Badge tone={tone}>{fmtPct(ratio, 0)}</Badge>
}

// ============================================================
// Routage interne : #/projets = liste, #/projets/P01 = espace,
// #/projets/P01/<onglet> = onglet direct
// ============================================================

export default function Projets() {
  const route = useRoute()
  const id = route[1]
  if (id) return <EspaceProjet projetId={id} onglet={route[2]} />
  return <ListeProjets />
}

// ============================================================
// Liste des projets
// ============================================================

function ListeProjets() {
  const { state } = useStore()
  const [recherche, setRecherche] = useState('')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [wizard, setWizard] = useState(false)

  const projets = state.projets
    .filter((p) => {
      if (filtreStatut && p.statut !== filtreStatut) return false
      if (recherche.trim() === '') return true
      return fold(`${p.id} ${p.nom} ${p.moa || ''} ${p.adresse || ''}`).includes(fold(recherche))
    })
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))

  return (
    <Page
      titre="Projets"
      sousTitre="Un espace par projet : pilotage, chantier, ressources, journal — tout s'ajoute au fil de l'eau, tout est interconnecté."
      actions={<Btn kind="primary" onClick={() => setWizard(true)}>Nouveau projet</Btn>}
    >
      <div className="toolbar">
        <TextInput
          value={recherche}
          onChange={setRecherche}
          placeholder="Rechercher (nom, MO, adresse…)"
          style={{ width: 260 }}
        />
        <Select
          value={filtreStatut}
          onChange={setFiltreStatut}
          options={[{ value: '', label: 'Tous les statuts' }, ...STATUTS.map((s) => ({ value: s, label: s }))]}
        />
      </div>

      {projets.length === 0 ? (
        <Card>
          <EmptyState>
            {state.projets.length === 0
              ? 'Aucun projet — « Nouveau projet » : 3 étapes, 2 minutes, phases et factures générées automatiquement.'
              : 'Aucun projet ne correspond à la recherche ou au filtre.'}
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <Table
            head={[
              'ID',
              'Projet',
              'MO',
              'Statut',
              <span key="t" className="right">Travaux HT</span>,
              <span key="h" className="right">Honoraires HT</span>,
              <span key="f" className="right">Facturé HT</span>,
              <span key="r" className="right">Reste à facturer</span>,
              <span key="he" className="right">Heures réel / prévu</span>,
            ]}
          >
            {projets.map((p) => {
              const h = calculHonoraires(p, state.settings)
              const fact = factureHT(state, p.id)
              const reste = Math.max(0, h.honorairesTotauxHT - fact)
              return (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/projets/${p.id}`)}>
                  <td className="mono">{p.id}</td>
                  <td>
                    <strong>{p.nom}</strong>
                    {p.moa && <div className="muted small">{p.moa}</div>}
                  </td>
                  <td>{p.typeMO}</td>
                  <td><Badge tone={toneStatut(p.statut)}>{p.statut}</Badge></td>
                  <td className="right"><Money v={p.montantTravauxHT} /></td>
                  <td className="right"><Money v={h.honorairesTotauxHT} /></td>
                  <td className="right"><Money v={fact} /></td>
                  <td className="right"><Money v={reste} /></td>
                  <td className="right num">
                    {fmtHeures(heuresReelles(state, p.id))} / {fmtHeures(heuresPrevues(p))}
                  </td>
                </tr>
              )
            })}
          </Table>
        </Card>
      )}

      {wizard && <ProjetNouveau onClose={() => setWizard(false)} />}
    </Page>
  )
}

// ============================================================
// Espace projet — bandeau + onglets
// ============================================================

const ONGLETS = [
  { id: 'pilotage', label: 'Pilotage & honoraires' },
  { id: 'chantier', label: 'Chantier & CR' },
  { id: 'ressources', label: 'Ressources & liens' },
  { id: 'journal', label: 'Journal' },
  { id: 'documents', label: 'Documents (Drive)' },
  { id: 'finances', label: 'Factures & temps' },
]

function EspaceProjet({ projetId, onglet }: { projetId: string; onglet?: string }) {
  const { state, update } = useStore()
  const [modalEdition, setModalEdition] = useState(false)
  const p = state.projets.find((x) => x.id === projetId)
  const actif = ONGLETS.some((o) => o.id === onglet) ? onglet! : 'pilotage'

  if (!p) {
    return (
      <Page titre="Projet introuvable">
        <Card>
          <EmptyState>
            Aucun projet « {projetId} » dans la base. <a href="#/projets">← Retour à la liste des projets</a>
          </EmptyState>
        </Card>
      </Page>
    )
  }

  const promptsProjet = state.prompts.filter((t) => t.contexte === 'projet')

  const supprimer = () => {
    const nbFactures = state.factures.filter((f) => f.projetId === p.id).length
    const nbSituations = state.situations.filter((s) => s.projetId === p.id).length
    if (nbFactures > 0 || nbSituations > 0) {
      alert(
        `Suppression impossible : ${nbFactures} facture(s) et ${nbSituations} situation(s) sont liées à ${p.id}.\n` +
          'Supprimez ou réaffectez d’abord ces éléments (modules Facturation et Situations) — chaque donnée reste traçable.',
      )
      return
    }
    if (!confirm(`Supprimer définitivement le projet ${p.id} — ${p.nom} (et ses marchés, réunions, notes) ?`)) return
    update((d) => {
      d.projets = d.projets.filter((x) => x.id !== p.id)
      d.marches = d.marches.filter((m) => m.projetId !== p.id)
      d.temps = d.temps.filter((t) => t.projetId !== p.id)
      d.reunions = d.reunions.filter((r) => r.projetId !== p.id)
    })
    navigate('/projets')
  }

  return (
    <Page
      titre={`${p.id} — ${p.nom}`}
      sousTitre={
        <>
          <Badge tone={toneStatut(p.statut)}>{p.statut}</Badge> <Badge tone="info">{p.typeMO}</Badge>
          {p.responsable && <Badge tone="muted">resp. {p.responsable}</Badge>}
          {p.plaisir != null && <Badge tone={p.plaisir >= 4 ? 'ok' : p.plaisir <= 2 ? 'danger' : 'muted'}>{'★'.repeat(p.plaisir)}</Badge>}
          {p.moa && <> · {p.moa}</>}
          {p.adresse && <> · {p.adresse}</>}
          {p.numeroEngagement && <span className="muted small"> · engagement {p.numeroEngagement}</span>}
        </>
      }
      actions={
        <>
          {promptsProjet.map((t) => (
            <CopyBtn
              key={t.id}
              kind="default"
              text={() => assemble(t.corps, contexteProjet(state, p))}
              label={`${t.titre} → « ${t.projetClaude} »`}
            />
          ))}
          <Btn onClick={() => setModalEdition(true)}>Modifier</Btn>
          <Btn kind="danger" onClick={supprimer}>Supprimer</Btn>
        </>
      }
    >
      <p className="small" style={{ marginTop: -10, marginBottom: 14 }}>
        <a href="#/projets">← Tous les projets</a>
        {p.notes && <span className="muted"> — {p.notes}</span>}
      </p>

      <BandeauProjet projet={p} />
      <LigneIdentite projet={p} />

      <Tabs
        tabs={ONGLETS.map((o) => ({ id: o.id, label: o.label }))}
        actif={actif}
        onSelect={(id) => navigate(`/projets/${p.id}/${id}`)}
      />

      {actif === 'pilotage' && (
        <>
          <div className="grid2">
            <CarteHonoraires projet={p} />
            <CarteComplexite projet={p} />
          </div>
          <CartePhases projet={p} />
        </>
      )}
      {actif === 'chantier' && <ProjetChantier projet={p} />}
      {actif === 'ressources' && <ProjetRessources projet={p} />}
      {actif === 'journal' && <ProjetJournal projet={p} />}
      {actif === 'documents' && <ProjetDocuments projet={p} />}
      {actif === 'finances' && <OngletFinances projet={p} />}

      {modalEdition && <ModalEditionProjet projet={p} onClose={() => setModalEdition(false)} />}
    </Page>
  )
}

/** bandeau : les 4 chiffres qui résument le projet, toujours visibles */
function BandeauProjet({ projet: p }: { projet: Projet }) {
  const { state } = useStore()
  const today = useToday()
  const h = calculHonoraires(p, state.settings)
  const fact = factureHT(state, p.id)
  const reste = h.honorairesTotauxHT - fact
  const hReel = heuresReelles(state, p.id)
  const hPrev = heuresPrevues(p)

  const prochainePhase = p.phases
    .filter((ph) => ph.fin && ph.fin >= today && ph.montantHT > 0)
    .sort((a, b) => (a.fin || '').localeCompare(b.fin || ''))[0]
  const enRetard = state.factures.filter((f) => f.projetId === p.id && retardFacture(f, today) > 0)

  return (
    <div className="grid4" style={{ marginBottom: 8 }}>
      <Stat label="Honoraires totaux" value={<Money v={h.honorairesTotauxHT} />} sub={`taux ${fmtPct(h.tauxFinal, 2)}`} />
      <Stat
        label="Facturé / reste"
        value={<Money v={fact} />}
        sub={<>reste à facturer {fmtMoney(Math.max(0, reste))}</>}
        tone={enRetard.length > 0 ? 'danger' : undefined}
      />
      <Stat
        label="Heures réel / prévu"
        value={`${Math.round(hReel)} / ${Math.round(hPrev)} h`}
        tone={hPrev > 0 && hReel >= hPrev ? 'danger' : hPrev > 0 && hReel >= hPrev * state.settings.seuilDeriveHeures ? 'warn' : undefined}
        sub={<a href="#/temps">pointer les heures →</a>}
      />
      <Stat
        label="Prochaine échéance"
        value={prochainePhase ? prochainePhase.code : '—'}
        sub={
          enRetard.length > 0 ? (
            <span className="danger-text">{enRetard.length} facture(s) en retard — <a href="#/facturation">relancer</a></span>
          ) : prochainePhase ? (
            <>rendu le <DateF d={prochainePhase.fin} /></>
          ) : (
            'aucune phase datée à venir'
          )
        }
      />
    </div>
  )
}

/** ligne « carte d'identité » sous le bandeau (dates, équipe, accès commande…) */
function LigneIdentite({ projet: p }: { projet: Projet }) {
  const items: ReactNode[] = []
  if (p.dateLancement || p.dateCloture)
    items.push(
      <span key="dates">
        📅 <DateF d={p.dateLancement ?? null} /> → <DateF d={p.dateCloture ?? null} />
      </span>,
    )
  {
    const equipe = [...new Set([p.responsable, p.coResponsable, ...(p.equipeProjet || [])].filter(Boolean))]
    if (equipe.length > 0) items.push(<span key="resp">👤 {equipe.join(', ')}</span>)
  }
  if (p.chargeOperation) items.push(<span key="co">MOA : {p.chargeOperation}</span>)
  if (p.accesCommande) items.push(<span key="acces">{p.accesCommande}</span>)
  if (p.typologie || p.typeConstruction)
    items.push(<span key="typo">{[p.typologie, p.typeConstruction].filter(Boolean).join(' · ')}</span>)
  if (p.trajetAller) items.push(<span key="trajet">🚗 {p.trajetAller}</span>)
  if (p.plaisir) items.push(<span key="plaisir" title="plaisir /5">{'★'.repeat(p.plaisir)}</span>)
  if (items.length === 0) return null
  return (
    <p className="muted small" style={{ margin: '0 2px 16px', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {items}
    </p>
  )
}

// ============================================================
// Onglet Finances — factures du projet (auto) + temps
// ============================================================

function OngletFinances({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const today = useToday()

  const factures = state.factures
    .filter((f) => f.projetId === p.id)
    .sort((a, b) => a.emission.localeCompare(b.emission))

  const generer = () => {
    const nouvelles = facturesParDefaut(p, state.settings, state.factures)
    if (nouvelles.length === 0) {
      alert('Rien à générer : datez d’abord les phases (onglet Pilotage) — l’échéancier se construit sur les fins de phases.')
      return
    }
    if (
      !confirm(
        `Générer ${nouvelles.length} facture(s) prévisionnelle(s) selon le modèle « ${p.typeMO} » ?\n` +
          `Les ${factures.length} facture(s) existantes du projet ne sont pas touchées — attention aux doublons si l’échéancier a déjà été généré.`,
      )
    )
      return
    update((d) => {
      d.factures.push(...facturesParDefaut(p, d.settings, d.factures))
    })
  }

  const coutTemps = coutReelTemps(state, p.id)
  const externes = coutsExternes(state, p.id)
  const factTotal = factureHT(state, p.id)
  const margeReelle = factTotal - coutTemps - externes
  const joursPointes = enJours(state, heuresReelles(state, p.id))
  const objectifJour = coutJourObjectif(state)

  const heuresParPhase = p.phases
    .map((ph) => ({ code: ph.code, prevu: ph.heuresPrevues, reel: heuresReelles(state, p.id, ph.code) }))
    .filter((x) => x.prevu > 0 || x.reel > 0)

  return (
    <>
      <div className="grid4" style={{ marginBottom: 16 }}>
        <Stat
          label="Coût du temps (réel)"
          value={<Money v={coutTemps} />}
          sub="heures pointées × coût horaire de chaque personne"
        />
        <Stat label="Coûts externes" value={<Money v={externes} />} sub="BET, sous-traitance (onglet Pilotage, par phase)" />
        <Stat
          label="Marge réelle à date"
          value={<Money v={margeReelle} />}
          tone={margeReelle < 0 ? 'danger' : 'ok'}
          sub={<>facturé {fmtMoney(factTotal)} − coûts</>}
        />
        <Stat
          label="€ / jour réel"
          value={joursPointes > 0.05 ? fmtMoney(factTotal / joursPointes) : '—'}
          tone={joursPointes > 0.05 ? (factTotal / joursPointes >= objectifJour ? 'ok' : 'warn') : undefined}
          sub={<>objectif {fmtMoney(objectifJour)} · <a href="#/analyse">Analyse →</a></>}
        />
      </div>

      <Card
        titre={`Échéancier du projet (${factures.length} factures)`}
        actions={
          <>
            <a href="#/facturation" className="small">Module Facturation →</a>
            <Btn small kind="primary" onClick={generer}>(Re)générer l'échéancier</Btn>
          </>
        }
      >
        {factures.length === 0 ? (
          <EmptyState>
            Aucune facture — « (Re)générer l'échéancier » les crée automatiquement depuis les phases datées
            (modèle {p.typeMO}).
          </EmptyState>
        ) : (
          <Table
            compact
            head={['N°', 'Phase', 'Libellé', <span key="h" className="right">HT</span>, <span key="t" className="right">TTC</span>, 'Émission', 'Statut']}
          >
            {factures.map((f) => {
              const retard = retardFacture(f, today)
              return (
                <tr key={f.id}>
                  <td className="mono">{f.id}</td>
                  <td>{f.phase}</td>
                  <td>{f.libelle}</td>
                  <td className="right"><Money v={f.montantHT} /></td>
                  <td className="right"><Money v={ttc(f)} /></td>
                  <td><DateF d={f.emission} /></td>
                  <td>
                    {retard > 0 ? (
                      <Badge tone="danger">en retard {retard} j</Badge>
                    ) : f.statut === 'encaissee' ? (
                      <Badge tone="ok">encaissée</Badge>
                    ) : f.statut === 'emise' ? (
                      <Badge tone="info">émise · échéance {encaissementPrevu(f)}</Badge>
                    ) : (
                      <Badge tone="muted">prévue</Badge>
                    )}
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>

      <Card titre="Temps passé par phase" actions={<a href="#/temps" className="small">Saisie des temps →</a>}>
        {heuresParPhase.length === 0 ? (
          <EmptyState>Aucune heure prévue ni pointée.</EmptyState>
        ) : (
          <Table compact head={['Phase', <span key="p" className="right">Prévu</span>, <span key="r" className="right">Pointé</span>, 'Écart']}>
            {heuresParPhase.map((x) => (
              <tr key={x.code}>
                <td>{x.code} <span className="muted small">{LIBELLES_PHASES[x.code]}</span></td>
                <td className="right num">{fmtHeures(x.prevu)}</td>
                <td className="right num">{fmtHeures(x.reel)}</td>
                <td><EcartHeures reel={x.reel} prevu={x.prevu} seuil={state.settings.seuilDeriveHeures} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  )
}

// ============================================================
// Carte Honoraires (MIQCP)
// ============================================================

function CarteHonoraires({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const h = calculHonoraires(p, state.settings)
  const hPrev = heuresPrevues(p)
  const tempsPasseVente = hPrev * state.settings.tauxHoraireVente
  const coutPrevisionnel = hPrev * state.settings.coutHoraireRevient
  const marge = h.honorairesTotauxHT - coutPrevisionnel
  const margePct = h.honorairesTotauxHT > 0 ? marge / h.honorairesTotauxHT : null

  const maj = (fn: (pr: Projet) => void) =>
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (pr) fn(pr)
    })

  return (
    <Card titre="Honoraires (MIQCP)">
      {h.sousPlancher && (
        <div className="pill-note">
          Sous ~{fmtMoney(seuilPlancherActualise(state.settings))} de travaux, le guide MIQCP renvoie au
          chiffrage en temps passé — le barème n’est ici qu’un repère.
        </div>
      )}
      <dl className="kv">
        <dt>Montant de travaux HT</dt>
        <dd><Money v={p.montantTravauxHT} /></dd>

        <dt>Taux barème (actualisé BT01)</dt>
        <dd>{fmtPct(h.tauxBareme, 2)}</dd>

        <dt>Coefficient de complexité</dt>
        <dd>
          {fmtCoef(h.coef)}{' '}
          <span className="muted small">
            {p.coefManuel !== null && p.coefManuel !== undefined ? '(manuel)' : h.coef !== null ? '(calculé sur les 27 critères)' : '(choisir un type d’ouvrage ou saisir un coef manuel)'}
          </span>
        </dd>

        <dt>Taux ajusté (barème × coef)</dt>
        <dd>{fmtPct(h.tauxAjuste, 2)}</dd>

        <dt>Taux retenu</dt>
        <dd>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <NumInput
              value={p.tauxRetenu ?? null}
              onChange={(v) => maj((pr) => { pr.tauxRetenu = v })}
              placeholder="auto"
              style={{ width: 110 }}
            />
            <span className="muted small">
              {p.tauxRetenu !== null && p.tauxRetenu !== undefined
                ? `soit ${fmtPct(h.tauxFinal, 2)} (négocié)`
                : `vide = taux ajusté (${fmtPct(h.tauxFinal, 2)}) — ex. 0,12 pour 12 %`}
            </span>
          </span>
        </dd>

        <dt>Honoraires mission de base HT</dt>
        <dd><Money v={h.honorairesBaseHT} /></dd>

        <dt>Missions complémentaires HT</dt>
        <dd>
          <NumInput
            value={p.missionsComplHT ?? 0}
            onChange={(v) => maj((pr) => { pr.missionsComplHT = v ?? 0 })}
            style={{ width: 110 }}
          />
        </dd>

        <dt><strong>Honoraires totaux HT</strong></dt>
        <dd><strong><Money v={h.honorairesTotauxHT} /></strong></dd>

        {p.surfacePlancher != null && p.surfacePlancher > 0 && (
          <>
            <dt>Ratios (SP {p.surfacePlancher} m²)</dt>
            <dd className="muted small">
              travaux {p.montantTravauxHT ? fmtMoney(p.montantTravauxHT / p.surfacePlancher) : '—'}/m² ·
              honoraires {h.honorairesTotauxHT > 0 ? fmtMoney(h.honorairesTotauxHT / p.surfacePlancher) : '—'}/m²
            </dd>
          </>
        )}

        <dt>Équivalent temps passé (vente)</dt>
        <dd>
          <Money v={tempsPasseVente} />{' '}
          <span className="muted small">
            ({fmtHeures(hPrev)} prévues × {fmtMoney(state.settings.tauxHoraireVente)}/h)
          </span>
        </dd>

        <dt>Marge prévisionnelle</dt>
        <dd className={marge < 0 ? 'danger-text' : 'ok-text'}>
          {fmtMoney(marge)}
          {margePct !== null && <> ({fmtPct(margePct, 0)})</>}{' '}
          <span className="muted small">
            (honoraires − {fmtHeures(hPrev)} × {fmtMoney(state.settings.coutHoraireRevient)}/h de revient)
          </span>
        </dd>
      </dl>
    </Card>
  )
}

// ============================================================
// Carte Complexité — grille des 27 critères MIQCP (repliable)
// ============================================================

function CarteComplexite({ projet: p }: { projet: Projet }) {
  const { update } = useStore()
  const [ouverte, setOuverte] = useState(false)

  const plage = plageOuvrage(p.ouvrage)
  const total = totalPointsComplexite(p)
  const position = 0.5 + total / 108
  const coef = coefComplexite(p)
  const manuel = p.coefManuel !== null && p.coefManuel !== undefined

  const maj = (fn: (pr: Projet) => void) =>
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (pr) fn(pr)
    })

  const noter = (critere: string, note: number) =>
    maj((pr) => {
      if (note === 0) delete pr.notesComplexite[critere]
      else pr.notesComplexite[critere] = note
    })

  return (
    <Card
      titre="Complexité (27 critères MIQCP)"
      actions={
        <Btn small onClick={() => setOuverte(!ouverte)}>
          {ouverte ? 'Masquer la grille' : 'Noter les critères'}
        </Btn>
      }
    >
      <dl className="kv">
        <dt>Type d’ouvrage</dt>
        <dd>{p.ouvrage || <span className="muted">non renseigné (bouton « Modifier »)</span>}</dd>

        <dt>Plage de coefficient</dt>
        <dd>{plage ? `${fmtCoef(plage.bas)} – ${fmtCoef(plage.haut)}` : '—'}</dd>

        <dt>Total des notes</dt>
        <dd>{total > 0 ? `+${total}` : total} <span className="muted small">(de −54 à +54)</span></dd>

        <dt>Position dans la plage</dt>
        <dd>{fmtPct(position, 0)}</dd>

        <dt>Coefficient résultant</dt>
        <dd>
          <strong>{fmtCoef(coef)}</strong>{' '}
          {manuel && <span className="muted small">(coefficient manuel prioritaire)</span>}
        </dd>

        <dt>Coefficient manuel</dt>
        <dd>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <NumInput
              value={p.coefManuel ?? null}
              onChange={(v) => maj((pr) => { pr.coefManuel = v })}
              placeholder="auto"
              style={{ width: 90 }}
            />
            <span className="muted small">vide = calcul par critères</span>
          </span>
        </dd>
      </dl>

      {ouverte && (
        <div style={{ marginTop: 14 }}>
          {manuel && (
            <div className="pill-note">
              Un coefficient manuel est saisi : la grille reste consultable mais n’est pas utilisée
              tant qu’il n’est pas effacé.
            </div>
          )}
          {CRITERES_COMPLEXITE.map((g) => (
            <div key={g.groupe} style={{ marginBottom: 12 }}>
              <div className="small" style={{ fontWeight: 650, margin: '8px 0 6px' }}>{g.groupe}</div>
              {g.criteres.map((c) => (
                <div
                  key={c}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}
                >
                  <span className="small" style={{ flex: 1 }}>{c}</span>
                  <NoteCritere value={p.notesComplexite[c] ?? 0} onChange={(n) => noter(c, n)} />
                </div>
              ))}
            </div>
          ))}
          <p className="muted small">−2 = très favorable · 0 = neutre · +2 = très défavorable.</p>
        </div>
      )}
    </Card>
  )
}

function NoteCritere({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, flexShrink: 0 }}>
      {[-2, -1, 0, 1, 2].map((n) => (
        <button
          key={n}
          type="button"
          className={`btn btn-small ${n === value ? 'btn-primary' : ''}`}
          style={{ minWidth: 32, padding: '2px 5px' }}
          onClick={() => onChange(n)}
        >
          {n > 0 ? `+${n}` : n}
        </button>
      ))}
    </span>
  )
}

// ============================================================
// Carte Phases — tableau éditable en place
// ============================================================

function CartePhases({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const seuil = state.settings.seuilDeriveHeures

  const majPhase = (code: PhaseCode, fn: (ph: Phase) => void) =>
    update((d) => {
      const ph = d.projets.find((x) => x.id === p.id)?.phases.find((x) => x.code === code)
      if (ph) fn(ph)
    })

  const recalculer = () => {
    const h = calculHonoraires(p, state.settings)
    if (
      !confirm(
        `Recalculer la répartition des phases sur ${fmtMoney(h.honorairesBaseHT)} d’honoraires de base ?\n` +
          'Attention : montants, dates et heures prévues saisis sur les phases seront écrasés (DIAG et MC remis à zéro).',
      )
    )
      return
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (pr) pr.phases = phasesParDefaut(h.honorairesBaseHT, d.settings.tauxHoraireVente)
    })
  }

  const encaissePhase = (code: PhaseCode) =>
    state.factures
      .filter((f) => f.projetId === p.id && f.phase === code && f.statut === 'encaissee')
      .reduce((s2, f) => s2 + f.montantHT, 0)

  const totaux = p.phases.reduce(
    (t, ph) => {
      const fact = factureHT(state, p.id, ph.code)
      return {
        montant: t.montant + ph.montantHT,
        facture: t.facture + fact,
        reste: t.reste + (ph.montantHT - fact),
        hPrev: t.hPrev + ph.heuresPrevues,
        hReel: t.hReel + heuresReelles(state, p.id, ph.code),
        externe: t.externe + (ph.coutExterneHT || 0),
      }
    },
    { montant: 0, facture: 0, reste: 0, hPrev: 0, hReel: 0, externe: 0 },
  )

  return (
    <Card
      titre="Phases de la mission"
      actions={<Btn small onClick={recalculer}>Recalculer la répartition</Btn>}
    >
      {p.phases.length === 0 ? (
        <EmptyState>Aucune phase — « Recalculer la répartition » pour générer la mission de base.</EmptyState>
      ) : (
        <Table
          compact
          head={[
            'Phase',
            '% base',
            <span key="m" className="right">Montant HT</span>,
            'Début',
            'Fin',
            <span key="hp" className="right">H. prévues</span>,
            <span key="ce" className="right" title="BET cotraitants, sous-traitance, débours — vient en moins de la marge">Coût ext. HT</span>,
            <span key="f" className="right">% fact.</span>,
            <span key="pay" className="right">% payé</span>,
            <span key="r" className="right">Reste HT</span>,
            <span key="hr" className="right">H. réelles</span>,
            'Écart heures',
          ]}
        >
          {p.phases.map((ph) => {
            const fact = factureHT(state, p.id, ph.code)
            const reste = ph.montantHT - fact
            const hReel = heuresReelles(state, p.id, ph.code)
            return (
              <tr key={ph.code}>
                <td>
                  <strong>{ph.code}</strong>
                  <div className="muted small">{LIBELLES_PHASES[ph.code]}</div>
                </td>
                <td className="muted small">{ph.pctBase !== null ? fmtPct(ph.pctBase, 1) : '—'}</td>
                <td className="right">
                  <NumInput
                    value={ph.montantHT}
                    onChange={(v) => majPhase(ph.code, (x) => { x.montantHT = v ?? 0 })}
                    style={{ width: 96 }}
                  />
                </td>
                <td>
                  <DateInput
                    value={ph.debut}
                    onChange={(v) => majPhase(ph.code, (x) => { x.debut = v })}
                    style={{ width: 138 }}
                  />
                </td>
                <td>
                  <DateInput
                    value={ph.fin}
                    onChange={(v) => majPhase(ph.code, (x) => { x.fin = v })}
                    style={{ width: 138 }}
                  />
                </td>
                <td className="right">
                  <NumInput
                    value={ph.heuresPrevues}
                    onChange={(v) => majPhase(ph.code, (x) => { x.heuresPrevues = v ?? 0 })}
                    style={{ width: 64 }}
                  />
                  {ph.montantHT > 0 && coutJourObjectif(state) > 0 && (
                    <div className="muted small" title="jours objectif = budget de phase ÷ seuil de rentabilité par jour">
                      obj. {Math.round((ph.montantHT / coutJourObjectif(state)) * 10) / 10} j
                    </div>
                  )}
                </td>
                <td className="right">
                  <NumInput
                    value={ph.coutExterneHT ?? null}
                    onChange={(v) => majPhase(ph.code, (x) => { x.coutExterneHT = v ?? undefined })}
                    style={{ width: 80 }}
                  />
                </td>
                <td className="right num" title={fmtMoney(fact) + ' facturés'}>
                  {ph.montantHT > 0 ? fmtPct(fact / ph.montantHT, 0) : '—'}
                </td>
                <td className="right num">
                  {ph.montantHT > 0 ? fmtPct(encaissePhase(ph.code) / ph.montantHT, 0) : '—'}
                </td>
                <td className={`right ${reste < 0 ? 'danger-text' : ''}`}><Money v={reste} /></td>
                <td className="right num">{fmtHeures(hReel)}</td>
                <td><EcartHeures reel={hReel} prevu={ph.heuresPrevues} seuil={seuil} /></td>
              </tr>
            )
          })}
          <tr>
            <td><strong>Total</strong></td>
            <td />
            <td className="right"><strong><Money v={totaux.montant} /></strong></td>
            <td />
            <td />
            <td className="right"><strong>{fmtHeures(totaux.hPrev)}</strong></td>
            <td className="right"><strong><Money v={totaux.externe} /></strong></td>
            <td className="right num"><strong>{totaux.montant > 0 ? fmtPct(totaux.facture / totaux.montant, 0) : '—'}</strong></td>
            <td />
            <td className={`right ${totaux.reste < 0 ? 'danger-text' : ''}`}>
              <strong><Money v={totaux.reste} /></strong>
            </td>
            <td className="right"><strong>{fmtHeures(totaux.hReel)}</strong></td>
            <td><EcartHeures reel={totaux.hReel} prevu={totaux.hPrev} seuil={seuil} /></td>
          </tr>
        </Table>
      )}
    </Card>
  )
}

// ============================================================
// Modal d'édition (l'identité du projet — la création passe par
// l'assistant ProjetNouveau)
// ============================================================

function ModalEditionProjet({ projet, onClose }: { projet: Projet; onClose: () => void }) {
  const { state, update } = useStore()

  const [nom, setNom] = useState(projet.nom)
  const [typeMO, setTypeMO] = useState<string>(projet.typeMO)
  const [statut, setStatut] = useState<string>(projet.statut)
  const [moa, setMoa] = useState(projet.moa || '')
  const [emailMOA, setEmailMOA] = useState(projet.emailMOA || '')
  const [adresse, setAdresse] = useState(projet.adresse || '')
  const [ouvrage, setOuvrage] = useState(projet.ouvrage || '')
  const [montant, setMontant] = useState<number | null>(projet.montantTravauxHT ?? null)
  const [surface, setSurface] = useState<number | null>(projet.surfacePlancher ?? null)
  const [surfaceExt, setSurfaceExt] = useState<number | null>(projet.surfaceExterieure ?? null)
  const [responsable, setResponsable] = useState(projet.responsable || '')
  const [coResponsable, setCoResponsable] = useState(projet.coResponsable || '')
  const [equipeProjet, setEquipeProjet] = useState<string[]>(projet.equipeProjet || [])
  const [plaisir, setPlaisir] = useState<number | null>(projet.plaisir ?? null)
  const [numEng, setNumEng] = useState(projet.numeroEngagement || '')
  const [notes, setNotes] = useState(projet.notes || '')
  const [dateLancement, setDateLancement] = useState<string | null>(projet.dateLancement ?? null)
  const [dateCloture, setDateCloture] = useState<string | null>(projet.dateCloture ?? null)
  const [objetFacture, setObjetFacture] = useState(projet.objetFacture || '')
  const [siretClient, setSiretClient] = useState(projet.siretClient || '')
  const [chargeOperation, setChargeOperation] = useState(projet.chargeOperation || '')
  const [accesCommande, setAccesCommande] = useState(projet.accesCommande || '')
  const [typologie, setTypologie] = useState(projet.typologie || '')
  const [typeConstruction, setTypeConstruction] = useState(projet.typeConstruction || '')
  const [trajetAller, setTrajetAller] = useState(projet.trajetAller || '')

  const enregistrer = () => {
    if (nom.trim() === '') return
    const livraison = statut === 'Livré' && projet.statut !== 'Livré'
    update((d) => {
      const pr = d.projets.find((x) => x.id === projet.id)
      if (!pr) return
      pr.nom = nom.trim()
      pr.typeMO = typeMO as TypeMO
      pr.statut = statut as StatutProjet
      pr.moa = moa.trim() || undefined
      pr.emailMOA = emailMOA.trim() || undefined
      pr.adresse = adresse.trim() || undefined
      pr.ouvrage = ouvrage || null
      pr.montantTravauxHT = montant
      pr.surfacePlancher = surface
      pr.surfaceExterieure = surfaceExt
      pr.responsable = responsable || undefined
      pr.coResponsable = coResponsable || undefined
      pr.equipeProjet = equipeProjet
      pr.plaisir = plaisir
      pr.numeroEngagement = numEng.trim() || undefined
      pr.notes = notes.trim() || undefined
      pr.dateLancement = dateLancement
      pr.dateCloture = dateCloture
      pr.objetFacture = objetFacture.trim() || undefined
      pr.siretClient = siretClient.trim() || undefined
      pr.chargeOperation = chargeOperation.trim() || undefined
      pr.accesCommande = accesCommande || undefined
      pr.typologie = typologie.trim() || undefined
      pr.typeConstruction = typeConstruction || undefined
      pr.trajetAller = trajetAller.trim() || undefined

      // à la livraison, le projet devient automatiquement une référence
      if (livraison && !d.references.some((r) => fold(r.nom) === fold(pr.nom))) {
        const finAOR = pr.phases.find((ph) => ph.code === 'AOR')?.fin
        const tagsJournal = [...new Set(pr.journal.flatMap((n) => n.tags))]
          .filter((t) => !['a-faire', 'mail', 'photo'].includes(t))
          .slice(0, 4)
        d.references.push({
          id: uid('ref'),
          nom: pr.nom,
          lieu: pr.adresse,
          annee: Number((finAOR || todayISO()).slice(0, 4)),
          typeMO: pr.typeMO,
          moa: pr.moa,
          montantTravauxHT: pr.montantTravauxHT,
          surfaceM2: null,
          mission: pr.missionsComplHT > 0 ? 'Base + missions compl.' : 'Base',
          motsCles: [...new Set([...(pr.ouvrage ? [fold(pr.ouvrage.replace(/^\d+-\s*/, '')).split(' ')[0]] : []), ...tagsJournal])],
          attestation: false,
          notes: `Référence créée automatiquement à la livraison de ${pr.id} — compléter surface et photos, réclamer l'attestation de bonne exécution.`,
        })
      }
    })
    if (livraison)
      alert(
        `${projet.id} livré : la référence « ${nom.trim()} » a été créée dans la base (surface et attestation à compléter).`,
      )
    onClose()
  }

  const Section = ({ titre }: { titre: string }) => (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--ink-3)',
        borderBottom: '1px solid var(--line)',
        padding: '14px 0 4px',
        marginBottom: 8,
      }}
    >
      {titre}
    </div>
  )

  return (
    <Modal titre={`Modifier ${projet.id}`} onClose={onClose} large>
      <Section titre="Identité" />
      <div className="form-row">
        <Field label="Nom du projet">
          <TextInput value={nom} onChange={setNom} />
        </Field>
        <Field label="Statut">
          <Select value={statut} onChange={setStatut} options={STATUTS.map((s) => ({ value: s, label: s }))} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Lancement">
          <DateInput value={dateLancement} onChange={setDateLancement} />
        </Field>
        <Field label="Clôture (prévue ou réelle)">
          <DateInput value={dateCloture} onChange={setDateCloture} />
        </Field>
        <Field label="Adresse du projet">
          <TextInput value={adresse} onChange={setAdresse} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Objet pour les factures" hint="rappelé sur chaque facture (ex. « Création d'une pension de famille au 19 rue… »)">
          <TextInput value={objetFacture} onChange={setObjetFacture} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Type de maître d’ouvrage">
          <Select value={typeMO} onChange={setTypeMO} options={TYPES_MO.map((t) => ({ value: t, label: t }))} />
        </Field>
        <Field label="Maître d’ouvrage">
          <TextInput value={moa} onChange={setMoa} />
        </Field>
        <Field label="SIRET client">
          <TextInput value={siretClient} onChange={setSiretClient} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Chargé·e d’opération client" hint="votre interlocuteur chez le MOA">
          <TextInput value={chargeOperation} onChange={setChargeOperation} placeholder="ex. Thibaut Feuga" />
        </Field>
        <Field label="E-mail MOA (facturation)" hint="pré-remplit les e-mails sortants">
          <TextInput value={emailMOA} onChange={setEmailMOA} />
        </Field>
        <Field label="N° marché / engagement">
          <TextInput value={numEng} onChange={setNumEng} placeholder="ex. 220216" />
        </Field>
      </div>

      <Section titre="Interne agence" />
      <div className="form-row">
        <Field label="Responsable">
          <Select
            value={responsable}
            onChange={setResponsable}
            options={[{ value: '', label: '—' }, ...state.settings.personnes.map((x) => ({ value: x, label: x }))]}
          />
        </Field>
        <Field label="Co-responsable">
          <Select
            value={coResponsable}
            onChange={setCoResponsable}
            options={[{ value: '', label: '—' }, ...state.settings.personnes.map((x) => ({ value: x, label: x }))]}
          />
        </Field>
        <Field label="Plaisir (note /5)" hint="oui, ça compte">
          <Select
            value={plaisir === null ? '' : String(plaisir)}
            onChange={(v) => setPlaisir(v === '' ? null : Number(v))}
            options={[{ value: '', label: '—' }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: '★'.repeat(n) }))]}
          />
        </Field>
        <Field label="Travaillent sur le projet" hint="pré-remplit leur tableau de temps">
          <div style={{ display: 'flex', gap: 14, paddingTop: 7 }}>
            {state.settings.personnes.map((n) => (
              <label key={n} className="small" style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={equipeProjet.includes(n)}
                  onChange={(e) =>
                    setEquipeProjet(e.target.checked ? [...equipeProjet, n] : equipeProjet.filter((x) => x !== n))
                  }
                />
                {n}
              </label>
            ))}
          </div>
        </Field>
      </div>
      <div className="form-row">
        <Field label="Accès à la commande">
          <Select
            value={accesCommande}
            onChange={setAccesCommande}
            options={[
              { value: '', label: '—' },
              { value: 'AO', label: 'Appel d’offres' },
              { value: 'Concours', label: 'Concours' },
              { value: 'Gré à gré', label: 'Gré à gré' },
              { value: 'Bouche à oreille', label: 'Bouche à oreille' },
              { value: 'Client fidèle', label: 'Client fidèle' },
            ]}
          />
        </Field>
        <Field label="Typologie">
          <TextInput value={typologie} onChange={setTypologie} placeholder="Logement, enseignement…" />
        </Field>
        <Field label="Type de construction">
          <Select
            value={typeConstruction}
            onChange={setTypeConstruction}
            options={[
              { value: '', label: '—' },
              { value: 'Neuf', label: 'Neuf' },
              { value: 'Réhabilitation', label: 'Réhabilitation' },
              { value: 'Extension', label: 'Extension' },
              { value: 'Mixte', label: 'Mixte' },
            ]}
          />
        </Field>
        <Field label="Trajet aller" hint="repère logistique">
          <TextInput value={trajetAller} onChange={setTrajetAller} placeholder="ex. 1 h 10 — A16" />
        </Field>
      </div>

      <Section titre="Budget & surfaces" />
      <div className="form-row">
        <Field label="Type d’ouvrage (référentiel MIQCP)" hint="Détermine la plage du coefficient de complexité.">
          <Select
            value={ouvrage}
            onChange={setOuvrage}
            options={[
              { value: '', label: '— non renseigné —' },
              ...OUVRAGES.map((o) => ({ value: o.code, label: o.code })),
            ]}
          />
        </Field>
        <Field label="Montant de travaux HT (€)">
          <NumInput value={montant} onChange={setMontant} />
        </Field>
        <Field label="Surface plancher (m²)" hint="active les ratios €/m²">
          <NumInput value={surface} onChange={setSurface} />
        </Field>
        <Field label="Surface extérieure (m²)">
          <NumInput value={surfaceExt} onChange={setSurfaceExt} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Notes">
          <TextArea value={notes} onChange={setNotes} rows={3} />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={enregistrer} disabled={nom.trim() === ''}>
          Enregistrer
        </Btn>
      </div>
    </Modal>
  )
}
