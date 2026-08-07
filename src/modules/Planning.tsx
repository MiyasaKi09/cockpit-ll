// ============================================================
// Planning — le Gantt vivant de l'agence : une barre par phase,
// 12 mois visibles, la ligne « aujourd'hui ». Pensé pour le réel
// du chantier : un retard ? deux clics (◀ ▶ ±1 semaine) et tout
// ce qui suit glisse avec. Bouton Imprimer/PDF → une page A4
// paysage propre à envoyer à tout le monde.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type { AppState, MarcheTravaux, PhaseCode, Projet } from '../types'
import { useStore } from '../store'
import { Badge, Btn, Card, confirmer, DateInput, EmptyState, Field, Icon, NumInput, navigate, Page, Select, Table, Tabs, TextInput, toast, useRoute, useToday } from '../ui'
import { addDays, diffDays, fmtDate, fmtHeures, mondayOf, todayISO, uid } from '../util'
import { LIBELLES_PHASES, PHASES_ORDRE } from '../miqcp'
import { daterPhases, echeancesParDefaut } from '../echeancier'
import { STATUTS_ACTIFS, capacitePersonneSemaine, capaciteSemaine, chargePlanifieeSemaine, heuresAbsenceSemaine } from '../derive'
import { EPSILON_HEURES, conflitsConges, propositionsReport, type ConflitConge } from '../conges'
import { simulerProjet, type VerdictPersonne } from '../chargeProspective'
import { personnesActives } from '../depart'
import { EcheancesContenu } from './Calendrier'
// LE GANTT CHANTIER : toute la géométrie et toutes les règles sont ICI,
// pures et vérifiables (src/planningTravaux.ts). Cet écran ne fait que
// rendre et capter les gestes — pas une date n'est calculée dans du JSX.
import {
  PAS_JOUR,
  PAS_SEMAINE,
  PIXELS_PAR_JOUR_MINIMUM,
  appliquerGeste,
  barreLot,
  chantiersDuPlanning,
  chevauchementsEntreprise,
  decalerFenetre,
  echelleSuggeree,
  etatLot,
  fenetrePlanning,
  fenetreSurLots,
  graduations,
  interventionDe,
  jalonsChantier,
  joursDepuisPixels,
  libelleFenetre,
  marchesEnConflit,
  pixelsParJour,
  pourcent,
  reportsDuGeste,
  type Echelle,
  type EtatLot,
  type FenetrePlanning,
  type GesteApplique,
  type Intervention,
  type Jalon,
  type Prise,
} from '../planningTravaux'

const COULEURS_PHASES = [
  '#0e7490', '#2563eb', '#7c3aed', '#0891b2', '#059669', '#ca8a04',
  '#ea580c', '#dc2626', '#9333ea', '#4f46e5', '#16a34a', '#b45309',
]

export function couleurPhase(code: PhaseCode): string {
  const i = PHASES_ORDRE.indexOf(code)
  return COULEURS_PHASES[(i === -1 ? PHASES_ORDRE.length : i) % COULEURS_PHASES.length]
}

const COULEURS_LOTS = [
  '#0e7490', '#2563eb', '#7c3aed', '#c026d3', '#db2777', '#e11d48',
  '#ea580c', '#ca8a04', '#65a30d', '#059669', '#0891b2', '#4f46e5',
  '#9333ea', '#be123c', '#b45309', '#15803d',
]

function couleurLot(i: number): string {
  return COULEURS_LOTS[i % COULEURS_LOTS.length]
}

/** premier jour du mois d'une date ISO */
function debutMois(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

/** ajoute n mois à un 1er du mois ISO */
function addMonths(premierDuMois: string, n: number): string {
  const a = Number(premierDuMois.slice(0, 4))
  const m = Number(premierDuMois.slice(5, 7)) - 1 + n
  const annee = a + Math.floor(m / 12)
  const mois = ((m % 12) + 12) % 12
  return `${annee}-${String(mois + 1).padStart(2, '0')}-01`
}

const NOMS_MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

interface Fenetre {
  debut: string // 1er du mois
  fin: string // exclusif
  total: number // jours
}

function fenetreDe(debut: string, nbMois: number): Fenetre {
  const fin = addMonths(debut, nbMois)
  return { debut, fin, total: diffDays(debut, fin) }
}

function pos(f: Fenetre, date: string): number {
  return Math.max(0, Math.min(100, (diffDays(f.debut, date) / f.total) * 100))
}

/** projets à montrer : actifs et dotés d'au moins une phase datée */
function projetsPlanifies(state: AppState): Projet[] {
  return state.projets.filter(
    (p) => STATUTS_ACTIFS.includes(p.statut) && p.phases.some((ph) => ph.debut && ph.fin),
  )
}

// ---------- barres d'un projet ----------

function PisteProjet({ projet: p, fenetre: f }: { projet: Projet; fenetre: Fenetre }) {
  const barres = p.phases.filter((ph) => ph.debut && ph.fin && ph.fin >= f.debut && ph.debut < f.fin)
  return (
    <div style={{ position: 'relative', height: 30, background: 'var(--bg-soft, #f6f7fa)', borderRadius: 6 }}>
      {barres.map((ph) => {
        const gauche = pos(f, ph.debut!)
        const largeur = Math.max(1.4, pos(f, addDays(ph.fin!, 1)) - gauche)
        return (
          <a
            key={ph.code}
            href={`#/projets/${p.id}`}
            title={`${ph.code} — ${LIBELLES_PHASES[ph.code]}\n${fmtDate(ph.debut)} → ${fmtDate(ph.fin)}`}
            style={{
              position: 'absolute',
              left: `${gauche}%`,
              width: `${largeur}%`,
              top: 4,
              bottom: 4,
              background: couleurPhase(ph.code),
              borderRadius: 4,
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              lineHeight: '22px',
              paddingLeft: 5,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textDecoration: 'none',
            }}
          >
            {ph.code}
          </a>
        )
      })}
    </div>
  )
}

// ---------- édition rapide des dates (le réel du chantier) ----------

/** Exporté depuis le lot d'usage : le geste le plus fréquent d'une phase de
 *  chantier — constater un retard et décaler — se faisait ICI, dans le
 *  Planning global, alors qu'on constate le retard dans la FICHE du projet.
 *  Le composant est autonome (il ne lit que le projet qu'on lui passe) ;
 *  l'onglet Planning de la fiche le monte tel quel, sans en écrire un
 *  second qui aurait divergé au premier changement de règle de propagation. */
export function EditionDates({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const [propager, setPropager] = useState(true)
  const [debutEtudes, setDebutEtudes] = useState<string | null>(
    p.dateLancement ?? p.phases.find((ph) => ph.debut)?.debut ?? todayISO(),
  )
  // durées mémorisées sur le projet (plus de valeur figée re-tapée à chaque fois)
  const [dureeEtudes, setDureeEtudes] = useState<number | null>(p.dureeEtudesMois ?? 8)
  const [dureeChantier, setDureeChantier] = useState<number | null>(p.dureeChantierMois ?? 12)

  const daterAuto = () => {
    if (!debutEtudes || !dureeEtudes || !dureeChantier) return
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (!pr) return
      pr.phases = daterPhases(pr.phases, debutEtudes, dureeEtudes, dureeChantier)
      // on mémorise pour la prochaine fois
      pr.dureeEtudesMois = dureeEtudes
      pr.dureeChantierMois = dureeChantier
    })
  }

  // Réaligne l'échéancier de facturation sur les dates actuelles des phases
  // (après un décalage). On ne touche jamais aux factures émises ou
  // encaissées — seules les ÉCHÉANCES (prévisions sans numéro) se régénèrent.
  const prevuesDuProjet = state.echeancesFacturation.filter((e) => e.projetId === p.id).length
  const realignerEcheancier = async () => {
    if (prevuesDuProjet > 0 && !(await confirmer({ message: `Régénérer l'échéancier prévisionnel de ${p.id} ?\n\nLes ${prevuesDuProjet} échéance(s) prévue(s) seront remplacées d'après les dates actuelles des phases. Les factures déjà émises ou encaissées ne bougent pas.`, danger: true }))) return
    // calculées AVANT la mutation : le producteur update() doit rester rejouable
    const nouvelles = echeancesParDefaut(p, state.settings)
    update((d) => {
      d.echeancesFacturation = [...d.echeancesFacturation.filter((e) => e.projetId !== p.id), ...nouvelles]
    })
  }

  const majDate = (code: PhaseCode, champ: 'debut' | 'fin', v: string | null) =>
    update((d) => {
      const ph = d.projets.find((x) => x.id === p.id)?.phases.find((x) => x.code === code)
      if (ph) ph[champ] = v
    })

  // décalage propagé par DATE réelle : une phase glisse, et toutes celles qui
  // démarrent à partir de sa date de début suivent (plus fiable que l'ordre
  // théorique des phases quand le réel du chantier bouscule le calendrier).
  const decaler = (code: PhaseCode, jours: number) =>
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (!pr) return
      const ref = pr.phases.find((x) => x.code === code)
      if (!ref) return
      const seuil = ref.debut || ref.fin || ''
      for (const ph of pr.phases) {
        const aDate = ph.debut || ph.fin || ''
        if (ph.code === code || (propager && seuil && aDate >= seuil)) {
          if (ph.debut) ph.debut = addDays(ph.debut, jours)
          if (ph.fin) ph.fin = addDays(ph.fin, jours)
        }
      }
    })

  const phases = p.phases.filter((ph) => ph.montantHT > 0 || ph.debut || ph.fin)

  return (
    <Card
      titre={`Ajuster les dates — ${p.id}`}
      actions={
        <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={propager} onChange={(e) => setPropager(e.target.checked)} />
          un décalage repousse aussi les phases suivantes
        </label>
      }
    >
      <div className="toolbar" style={{ background: 'var(--bg-soft, #f6f7fa)', padding: 10, borderRadius: 8, flexWrap: 'wrap' }}>
        <Field label="Début des études">
          <DateInput value={debutEtudes} onChange={setDebutEtudes} />
        </Field>
        <Field label="Durée études (mois)">
          <NumInput value={dureeEtudes} onChange={setDureeEtudes} style={{ width: 70 }} />
        </Field>
        <Field label="Durée chantier (mois)">
          <NumInput value={dureeChantier} onChange={setDureeChantier} style={{ width: 70 }} />
        </Field>
        <Field label=" ">
          <Btn kind="primary" onClick={daterAuto} disabled={!debutEtudes || !dureeEtudes || !dureeChantier}>
            Dater les phases automatiquement
          </Btn>
        </Field>
        <Field label=" ">
          <Btn onClick={realignerEcheancier} title="Régénère les factures prévisionnelles d'après les dates actuelles des phases (les factures émises ou encaissées ne bougent pas)">
            Réaligner l'échéancier{prevuesDuProjet > 0 ? ` (${prevuesDuProjet} prévue${prevuesDuProjet > 1 ? 's' : ''})` : ''}
          </Btn>
        </Field>
      </div>
      <p className="muted small" style={{ margin: '8px 0' }}>
        ◀ ▶ décale une phase d'une semaine ; case cochée = les phases suivantes suivent.
        « Réaligner l'échéancier » recale ensuite les factures prévues.
      </p>
      <Table compact head={['Phase', 'Début', 'Fin', 'Décaler']}>
        {phases.map((ph) => (
          <tr key={ph.code}>
            <td>
              <span
                style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: couleurPhase(ph.code), marginRight: 6 }}
              />
              <strong>{ph.code}</strong> <span className="muted small">{LIBELLES_PHASES[ph.code]}</span>
            </td>
            <td>
              <DateInput value={ph.debut ?? null} onChange={(v) => majDate(ph.code, 'debut', v)} />
            </td>
            <td>
              <DateInput value={ph.fin ?? null} onChange={(v) => majDate(ph.code, 'fin', v)} />
            </td>
            <td>
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <Btn small onClick={() => decaler(ph.code, -7)} title="Avancer d'une semaine">
                  ◀ 1 sem
                </Btn>
                <Btn small onClick={() => decaler(ph.code, 7)} title="Repousser d'une semaine">
                  1 sem ▶
                </Btn>
              </span>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  )
}

// ---------- export PDF (vue imprimable A4 paysage) ----------

function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function ouvrirPlanningPDF(state: AppState, projets: Projet[], f: Fenetre, today: string): void {
  const mois: string[] = []
  for (let m = f.debut; m < f.fin; m = addMonths(m, 1)) mois.push(m)

  const lignes = projets
    .map((p) => {
      const barres = p.phases
        .filter((ph) => ph.debut && ph.fin && ph.fin >= f.debut && ph.debut < f.fin)
        .map((ph) => {
          const gauche = pos(f, ph.debut!)
          const largeur = Math.max(1.2, pos(f, addDays(ph.fin!, 1)) - gauche)
          return `<div style="position:absolute;left:${gauche}%;width:${largeur}%;top:3px;bottom:3px;background:${couleurPhase(ph.code)};border-radius:3px;color:#fff;font-size:9px;font-weight:700;line-height:20px;padding-left:4px;overflow:hidden;white-space:nowrap">${ph.code}</div>`
        })
        .join('')
      return `<tr>
        <td style="width:220px;padding:4px 8px;border-bottom:1px solid #e3e6ec;font-size:11px"><strong>${echapper(p.id)}</strong> ${echapper(p.nom.slice(0, 46))}</td>
        <td style="padding:0;border-bottom:1px solid #e3e6ec"><div style="position:relative;height:26px;background:#f6f7fa">${barres}
          ${today >= f.debut && today < f.fin ? `<div style="position:absolute;left:${pos(f, today)}%;top:0;bottom:0;width:1.5px;background:#bb2233"></div>` : ''}
        </div></td>
      </tr>`
    })
    .join('')

  const enTetesMois = mois
    .map(
      (m) =>
        `<div style="position:absolute;left:${pos(f, m)}%;top:0;bottom:0;border-left:1px solid #e3e6ec;padding-left:4px;font-size:10px;color:#5a6478">${NOMS_MOIS_COURTS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}</div>`,
    )
    .join('')

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Planning — ${echapper(state.settings.nomAgence)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1a2233; margin: 24px; }
  h1 { font-size: 18px; margin: 0; }
  .muted { color: #5a6478; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  .impression { position: fixed; top: 12px; right: 12px; }
  @media print { .impression { display: none; } body { margin: 0; } }
</style></head><body>
<button class="impression" onclick="window.print()">Imprimer / PDF</button>
<h1>${echapper(state.settings.nomAgence)} — Planning prévisionnel</h1>
<div class="muted">Édité le ${fmtDate(today)} · fenêtre ${fmtDate(f.debut)} → ${fmtDate(addDays(f.fin, -1))} · trait rouge = aujourd'hui · document indicatif, susceptible d'ajustements</div>
<table>
  <tr><td style="width:220px"></td><td style="padding:0"><div style="position:relative;height:18px">${enTetesMois}</div></td></tr>
  ${lignes}
</table>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

// ============================================================
// Planning CHANTIER — LE GANTT. « Par chantier mais il faut une
// gestion plus fine de ce qu'on peut faire, UN VRAI GANTT ».
//
// Ce qui sépare un Gantt d'une frise : on AGIT dessus. On attrape
// la barre d'un lot, on la pousse, et la date du marché suit —
// avec « Annuler ». C'est le geste de la réunion de chantier :
// constater un retard et le reporter au planning sans aller le
// retaper ailleurs.
//
// Le groupement par chantier est CONSERVÉ (l'agence l'a demandé).
// Ce qui change, c'est qu'on peut s'en servir.
//
// AUCUNE géométrie ici : position, échelle, conversion d'un
// glissement en jours, retard, décrochage, chevauchement,
// prolongation par intempéries — tout vient de
// src/planningTravaux.ts, où c'est vérifiable.
// ============================================================

/** projets actifs ayant au moins un lot daté, dans l'ordre d'entrée en
 *  chantier (`chantiersDuPlanning`) */
function projetsAvecChantier(state: AppState): Projet[] {
  return chantiersDuPlanning(
    state.projets.filter((p) => STATUTS_ACTIFS.includes(p.statut)),
    state.marches,
  )
}

/** lots datés d'un chantier, dans l'ordre d'intervention — la couleur suit
 *  ce rang, et elle est la même à l'écran et sur le papier */
function lotsDuChantier(state: AppState, projetId: string): { marche: MarcheTravaux; couleur: string }[] {
  return state.marches
    .filter((m) => m.projetId === projetId)
    .map((m) => ({ marche: m, debut: interventionDe(m)?.debut }))
    .filter((x): x is { marche: MarcheTravaux; debut: string } => x.debut !== undefined)
    .sort((a, b) => a.debut.localeCompare(b.debut))
    .map((x, i) => ({ marche: x.marche, couleur: couleurLot(i) }))
}

// ---------- la barre : ce qu'on attrape ----------

/** Une barre de lot, avec ses trois prises : le corps (déplacer), la poignée
 *  gauche (début), la poignée droite (fin).
 *
 *  L'aperçu pendant le glissement est LOCAL : rien n'est écrit tant que le
 *  doigt n'est pas relâché. Écrire à chaque `pointermove` empilerait cent
 *  états dans l'historique et rendrait « Annuler » inutilisable — or c'est
 *  précisément le geste sur lequel on doit pouvoir revenir. */
function BarreGantt({
  marche: m,
  etat,
  couleur,
  fenetre: f,
  enConflit,
  onGeste,
  onOuvrir,
}: {
  marche: MarcheTravaux
  etat: EtatLot
  couleur: string
  fenetre: FenetrePlanning
  enConflit: boolean
  onGeste: (prise: Prise, geste: GesteApplique) => void
  onOuvrir: () => void
}) {
  const [glisse, setGlisse] = useState<{ prise: Prise; jours: number } | null>(null)
  const depart = useRef({ x: 0, largeur: 0 })

  const base = etat.intervention
  if (!base) {
    return (
      <div className="muted small" style={{ padding: '4px 0' }}>
        lot non daté
      </div>
    )
  }

  // pendant le glissement, on dessine la position VISÉE, pas la position
  // enregistrée : sans cet aperçu on lâche à l'aveugle
  const apercu: Intervention = glisse ? appliquerGeste(base, glisse.prise, glisse.jours) : base
  const b = barreLot(f, apercu)

  const commencer = (prise: Prise) => (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const piste = (e.currentTarget as HTMLElement).closest('[data-piste]') as HTMLElement | null
    if (!piste) return
    depart.current = { x: e.clientX, largeur: piste.getBoundingClientRect().width }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setGlisse({ prise, jours: 0 })
  }

  // stopPropagation sur les DEUX : avec `setPointerCapture` posé sur une
  // poignée, l'évènement remonte quand même l'arbre React jusqu'au corps de
  // la barre, dont les mêmes handlers sont montés. Sans cette coupure, un
  // relâchement sur une poignée exécute le geste DEUX fois — les dates
  // écrites sont absolues, donc identiques, mais l'écran affiche deux toasts
  // et deux « Annuler » pour un seul geste.
  const bouger = (e: React.PointerEvent<HTMLElement>) => {
    if (!glisse) return
    e.stopPropagation()
    const jours = joursDepuisPixels(f, e.clientX - depart.current.x, depart.current.largeur)
    if (jours !== glisse.jours) setGlisse({ ...glisse, jours })
  }

  const relacher = (e: React.PointerEvent<HTMLElement>) => {
    if (!glisse) return
    e.stopPropagation()
    const encours = glisse
    setGlisse(null)
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // le pointeur a pu être perdu (fenêtre défocalisée) : le geste se
      // termine quand même, on ne laisse pas la barre collée au doigt
    }
    // un clic net (aucun jour parcouru) OUVRE le lot au lieu de ne rien
    // faire : au doigt, viser une barre puis ne rien obtenir se lit comme
    // une panne
    if (encours.jours === 0) {
      onOuvrir()
      return
    }
    onGeste(encours.prise, appliquerGeste(base, encours.prise, encours.jours))
  }

  if (!b.visible) {
    return (
      <div className="muted small" style={{ padding: '4px 0', fontSize: 10 }}>
        hors fenêtre — {fmtDate(base.debut)} → {fmtDate(base.fin)}
      </div>
    )
  }

  // La barre reste PLEINE et son libellé blanc : c'est ce qui garde le nom de
  // l'entreprise lisible, y compris imprimé en noir et blanc. L'avancement se
  // lit sur un bandeau intérieur (convention des logiciels de planning), pas
  // en repeignant le fond — un fond clair rendrait le texte illisible dès que
  // le remplissage passe dessous.
  //
  // Avancement JAMAIS constaté = rayures blanches sur la barre. « null n'est
  // pas 0 » : sans marque distincte, une barre sans bandeau se lirait « rien
  // n'est fait », alors que la vérité est « personne n'a encore regardé ».
  const raye = etat.avancementPct === null

  const bordure = etat.enRetard
    ? '2px solid var(--danger)'
    : etat.decroche
      ? '2px solid var(--warn)'
      : enConflit
        ? '2px dashed var(--warn)'
        : `1px solid ${couleur}`

  const infobulle = [
    `${m.lot} — ${m.entreprise}`,
    `${fmtDate(apercu.debut)} → ${fmtDate(apercu.fin)}`,
    etat.avancementPct === null
      ? 'Avancement non constaté'
      : `Avancement ${etat.avancementPct} %${etat.tempsEcoulePct !== null ? ` · délai écoulé ${etat.tempsEcoulePct} %` : ''}`,
    ...etat.raisons,
    glisse ? '— relâcher pour enregistrer, Échap pour annuler —' : 'Glisser pour déplacer · bords pour allonger · clic pour ouvrir',
  ].join('\n')

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        title={infobulle}
        onPointerDown={commencer('deplacer')}
        onPointerMove={bouger}
        onPointerUp={relacher}
        onPointerCancel={relacher}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOuvrir()
          }
        }}
        style={{
          position: 'absolute',
          left: `${b.gauche}%`,
          width: `${b.largeur}%`,
          top: 3,
          bottom: 3,
          background: couleur,
          backgroundImage: raye
            ? 'repeating-linear-gradient(45deg, rgba(255,255,255,.24) 0 4px, transparent 4px 8px)'
            : undefined,
          border: bordure,
          borderRadius: 4,
          borderTopLeftRadius: b.coupeGauche ? 0 : 4,
          borderBottomLeftRadius: b.coupeGauche ? 0 : 4,
          borderTopRightRadius: b.coupeDroite ? 0 : 4,
          borderBottomRightRadius: b.coupeDroite ? 0 : 4,
          overflow: 'hidden',
          cursor: glisse ? 'grabbing' : 'grab',
          touchAction: 'none',
          boxShadow: glisse ? '0 0 0 2px var(--accent, #2563eb)' : undefined,
        }}
      >
        <span
          style={{
            position: 'relative',
            display: 'block',
            fontSize: 10,
            fontWeight: 700,
            lineHeight: '16px',
            paddingLeft: 5,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            color: '#fff',
          }}
        >
          {m.entreprise}
          {etat.avancementPct !== null ? ` · ${etat.avancementPct} %` : ''}
        </span>
        {/* bandeau d'avancement = avancementLot (src/chantier.ts), le chiffre
            constaté en réunion — jamais recalculé ici */}
        {etat.avancementPct !== null && (
          <span
            style={{
              position: 'absolute',
              left: 2,
              right: 2,
              bottom: 2,
              height: 4,
              borderRadius: 2,
              background: 'rgba(255,255,255,.3)',
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${etat.avancementPct}%`,
                borderRadius: 2,
                background: '#fff',
              }}
            />
          </span>
        )}
        {/* les deux poignées de bord — allonger / raccourcir */}
        <span
          onPointerDown={commencer('debut')}
          onPointerMove={bouger}
          onPointerUp={relacher}
          onPointerCancel={relacher}
          title="Tirer pour changer la date de début"
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', touchAction: 'none' }}
        />
        <span
          onPointerDown={commencer('fin')}
          onPointerMove={bouger}
          onPointerUp={relacher}
          onPointerCancel={relacher}
          title="Tirer pour changer la date de fin"
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', touchAction: 'none' }}
        />
      </div>

      {/* prolongation acquise par intempéries : hachures au-delà de la fin
          contractuelle — ce n'est pas du travail planifié, c'est du délai dû */}
      {etat.prolongationJours > 0 && etat.finDefendable && !glisse && (() => {
        const ext = barreLot(f, { debut: addDays(base.fin, 1), fin: etat.finDefendable })
        if (!ext.visible) return null
        return (
          <div
            title={`+${etat.prolongationJours} j d'intempéries reconnues — fin défendable le ${fmtDate(etat.finDefendable)}`}
            style={{
              position: 'absolute',
              left: `${ext.gauche}%`,
              width: `${ext.largeur}%`,
              top: 6,
              bottom: 6,
              background: 'repeating-linear-gradient(45deg, var(--warn) 0 3px, transparent 3px 7px)',
              opacity: 0.55,
              borderRadius: 3,
            }}
          />
        )
      })()}
    </>
  )
}

// ---------- les jalons : ce qui structure le chantier ----------

const FORME_JALON: Record<Jalon['genre'], { symbole: string; couleur: string }> = {
  reunion: { symbole: '◆', couleur: 'var(--accent, #2563eb)' },
  debut: { symbole: '▸', couleur: 'var(--ink-3)' },
  fin: { symbole: '▪', couleur: 'var(--ink-2)' },
  fin_defendable: { symbole: '▫', couleur: 'var(--warn)' },
  reception: { symbole: '▲', couleur: 'var(--ok)' },
}

/** `interactif` : sur la rangée du chantier, les jalons portent leur infobulle
 *  (rien d'autre ne s'y trouve). Sur une ligne de lot ils sont posés PAR-DESSUS
 *  la barre : les laisser capter le pointeur créerait des trous où le
 *  glissement ne démarre pas — un geste qui échoue une fois sur dix se lit
 *  comme une panne, et on cesse de s'en servir. Leur contenu reste accessible
 *  dans l'infobulle de la barre et dans le panneau du lot. */
function RangeeJalons({ jalons, interactif = true }: { jalons: Jalon[]; interactif?: boolean }) {
  return (
    <>
      {jalons
        .filter((j) => j.visible)
        .map((j) => (
          <span
            key={j.id}
            title={interactif ? `${fmtDate(j.date)} — ${j.libelle}` : undefined}
            style={{
              position: 'absolute',
              left: `${j.gauche}%`,
              top: 0,
              transform: 'translateX(-50%)',
              fontSize: 11,
              lineHeight: '16px',
              color: FORME_JALON[j.genre].couleur,
              pointerEvents: interactif ? 'auto' : 'none',
            }}
          >
            {FORME_JALON[j.genre].symbole}
          </span>
        ))}
    </>
  )
}

// ---------- la conduite d'un lot : le clavier, et le détail ----------

/** Le panneau qui s'ouvre sous un lot. Il porte la SAISIE AU CLAVIER des
 *  deux dates — « au doigt sur un téléphone, le glissement est imprécis, et
 *  l'outil sert SUR le chantier » — et il dit en clair ce que la barre ne
 *  peut que suggérer. */
function ConduiteLot({
  marche: m,
  etat,
  propager,
  onFermer,
}: {
  marche: MarcheTravaux
  etat: EtatLot
  propager: boolean
  onFermer: () => void
}) {
  const { state, update, replace } = useStore()

  const ecrire = (reports: ReturnType<typeof reportsDuGeste>, message: string) => {
    if (reports.length === 0) return
    const snap = state
    update((d) => {
      for (const r of reports) {
        const cible = d.marches.find((x) => x.id === r.marcheId)
        if (!cible) continue
        cible.dateDebut = r.debut
        cible.dateFin = r.fin
      }
    })
    toast(message, { undo: () => replace(snap) })
  }

  const decaler = (jours: number) => {
    if (!etat.intervention) return
    const geste = appliquerGeste(etat.intervention, 'deplacer', jours)
    const reports = reportsDuGeste(state.marches, m.id, 'deplacer', geste, propager)
    const suivants = reports.length - 1
    ecrire(
      reports,
      `${m.lot} : ${fmtDate(geste.debut)} → ${fmtDate(geste.fin)}` +
        (suivants > 0 ? ` · ${suivants} lot${suivants > 1 ? 's' : ''} suivant${suivants > 1 ? 's' : ''} décalé${suivants > 1 ? 's' : ''}` : ''),
    )
  }

  // la saisie directe d'une date ne propage jamais : on a tapé UNE date, on
  // n'a pas demandé à bouger le reste du chantier
  const saisir = (champ: 'dateDebut' | 'dateFin', v: string | null) => {
    const snap = state
    update((d) => {
      const cible = d.marches.find((x) => x.id === m.id)
      if (cible) cible[champ] = v
    })
    toast(`${m.lot} — ${champ === 'dateDebut' ? 'début' : 'fin'} au ${fmtDate(v)}.`, {
      undo: () => replace(snap),
    })
  }

  return (
    <div
      className="pill-note"
      style={{ margin: '4px 0 10px', display: 'grid', gap: 8 }}
    >
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <Field label="Début">
          <DateInput value={m.dateDebut ?? null} onChange={(v) => saisir('dateDebut', v)} />
        </Field>
        <Field label="Fin">
          <DateInput value={m.dateFin ?? null} onChange={(v) => saisir('dateFin', v)} />
        </Field>
        <Field label="Décaler l'intervention">
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <Btn small onClick={() => decaler(-PAS_SEMAINE)} disabled={!etat.intervention} title="Avancer d'une semaine">◀ 1 sem</Btn>
            <Btn small onClick={() => decaler(-PAS_JOUR)} disabled={!etat.intervention} title="Avancer d'un jour">◀ 1 j</Btn>
            <Btn small onClick={() => decaler(PAS_JOUR)} disabled={!etat.intervention} title="Repousser d'un jour">1 j ▶</Btn>
            <Btn small onClick={() => decaler(PAS_SEMAINE)} disabled={!etat.intervention} title="Repousser d'une semaine">1 sem ▶</Btn>
          </span>
        </Field>
        <span className="spacer" />
        <a className="small" href={`#/projets/${m.projetId}/chantier`}>fiche du lot →</a>
        <Btn small kind="ghost" onClick={onFermer}>fermer</Btn>
      </div>

      <div className="small" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span>
          <span className="muted">Avancement constaté </span>
          {etat.avancementPct === null ? (
            <span className="muted">non constaté</span>
          ) : (
            <strong>{etat.avancementPct} %</strong>
          )}
        </span>
        <span>
          <span className="muted">Délai écoulé </span>
          {etat.tempsEcoulePct === null ? <span className="muted">—</span> : <strong>{etat.tempsEcoulePct} %</strong>}
        </span>
        {etat.ecartPoints !== null && (
          <span className={etat.ecartPoints < 0 ? 'danger-text' : 'ok-text'}>
            {etat.ecartPoints > 0 ? '+' : ''}
            {etat.ecartPoints} points
          </span>
        )}
        {etat.prolongationJours > 0 && (
          <Badge tone="warn">+{etat.prolongationJours} j d'intempéries</Badge>
        )}
      </div>

      {etat.raisons.length > 0 && (
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          {etat.raisons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        L'avancement se constate en réunion de chantier, tâche par tâche (fiche projet → Planning) :
        c'est le même chiffre qui sert à vérifier les situations. Le planning ne l'invente pas.
      </p>
    </div>
  )
}

/** édition rapide des dates de chantier — un lot glisse, les suivants suivent.
 *  Exporté pour la même raison qu'`EditionDates` : l'onglet Planning de la
 *  fiche projet le monte, au lieu d'obliger à repasser par le Planning global.
 *
 *  La règle de propagation est celle du Gantt (`reportsDuGeste`), pas une
 *  seconde version : deux règles de décalage divergeraient au premier lot
 *  sans date de début, et personne ne saurait laquelle a écrit le planning. */
export function EditionChantier({ projet: p }: { projet: Projet }) {
  const { state, update, replace } = useStore()
  const [propager, setPropager] = useState(true)
  const lots = state.marches
    .filter((m) => m.projetId === p.id)
    .sort((a, b) => (a.dateDebut || '9999').localeCompare(b.dateDebut || '9999'))

  const majDate = (id: string, champ: 'dateDebut' | 'dateFin', v: string | null) => {
    const snap = state
    update((d) => {
      const m = d.marches.find((x) => x.id === id)
      if (m) m[champ] = v
    })
    toast(`Date ${champ === 'dateDebut' ? 'de début' : 'de fin'} au ${fmtDate(v)}.`, { undo: () => replace(snap) })
  }

  const decaler = (id: string, jours: number) => {
    const m = state.marches.find((x) => x.id === id)
    const inter = m ? interventionDe(m) : null
    if (!m || !inter) return
    const geste = appliquerGeste(inter, 'deplacer', jours)
    const reports = reportsDuGeste(state.marches, id, 'deplacer', geste, propager)
    if (reports.length === 0) return
    const snap = state
    update((d) => {
      for (const r of reports) {
        const cible = d.marches.find((x) => x.id === r.marcheId)
        if (!cible) continue
        cible.dateDebut = r.debut
        cible.dateFin = r.fin
      }
    })
    const suivants = reports.length - 1
    toast(
      `${m.lot} : ${fmtDate(geste.debut)} → ${fmtDate(geste.fin)}` +
        (suivants > 0 ? ` · ${suivants} lot${suivants > 1 ? 's' : ''} suivant${suivants > 1 ? 's' : ''} décalé${suivants > 1 ? 's' : ''}` : ''),
      { undo: () => replace(snap) },
    )
  }

  return (
    <Card
      titre={`Ajuster le planning chantier — ${p.id}`}
      actions={
        <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={propager} onChange={(e) => setPropager(e.target.checked)} />
          un décalage repousse aussi les lots suivants
        </label>
      }
    >
      {lots.length === 0 ? (
        <EmptyState>
          Aucun marché sur ce projet — ajoutez les lots dans l'onglet Chantier de la fiche projet,
          avec leurs dates d'intervention.
        </EmptyState>
      ) : (
        <>
          <p className="muted small" style={{ marginBottom: 8 }}>
            Un lot prend du retard ? ◀ ▶ décale son intervention d'une semaine — avec la case cochée,
            tous les lots qui démarrent après glissent aussi. Chaque geste laisse un « Annuler ».
          </p>
          <Table compact head={['Lot · entreprise', 'Début', 'Fin', 'Décaler']}>
            {lots.map((m, i) => (
              <tr key={m.id}>
                <td>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: couleurLot(i), marginRight: 6 }} />
                  <strong>{m.lot}</strong> <span className="muted small">{m.entreprise}</span>
                </td>
                <td>
                  <DateInput value={m.dateDebut ?? null} onChange={(v) => majDate(m.id, 'dateDebut', v)} />
                </td>
                <td>
                  <DateInput value={m.dateFin ?? null} onChange={(v) => majDate(m.id, 'dateFin', v)} />
                </td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    <Btn small onClick={() => decaler(m.id, -PAS_SEMAINE)}>◀ 1 sem</Btn>
                    <Btn small onClick={() => decaler(m.id, PAS_SEMAINE)}>1 sem ▶</Btn>
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Card>
  )
}

// ---------- l'impression : la MÊME chose, sur papier ----------

/** « Ce qu'on voit se regarde aussi sur papier. » Le gabarit lit exactement
 *  les mêmes fonctions pures que l'écran — même fenêtre, mêmes graduations,
 *  même avancement, mêmes jalons. Un PDF recalculé à sa façon sortirait
 *  « à l'heure » là où l'écran sort rouge, et c'est le PDF qu'on emporte
 *  en réunion. */
function ouvrirChantierPDF(
  state: AppState,
  projets: Projet[],
  f: FenetrePlanning,
  today: string,
): void {
  const grads = graduations(f)
  const traitJour =
    today >= f.debut && today < f.fin
      ? `<div style="position:absolute;left:${pourcent(f, today)}%;top:0;bottom:0;width:1.5px;background:#bb2233"></div>`
      : ''

  const enTetes = grads
    .map(
      (g) =>
        `<div style="position:absolute;left:${g.gauche}%;top:0;bottom:0;border-left:1px solid ${g.majeure ? '#b9c0cd' : '#e3e6ec'};padding-left:3px;font-size:9px;color:#5a6478;white-space:nowrap">${echapper(g.label)}</div>`,
    )
    .join('')

  const rangs = projets
    .map((p) => {
      const lots = lotsDuChantier(state, p.id)
      if (lots.length === 0) return ''
      const jalons = jalonsChantier(f, p.id, state.marches, state.reunions, state.intemperies)
      const marquesReunion = jalons
        .filter((j) => j.visible && j.genre === 'reunion')
        .map(
          (j) =>
            `<div style="position:absolute;left:${j.gauche}%;top:0;transform:translateX(-50%);font-size:9px;color:#2563eb">&#9670;</div>`,
        )
        .join('')

      const enTeteChantier = `<tr>
        <td colspan="2" style="padding:8px 8px 2px;border-bottom:1px solid #b9c0cd;font-size:11px;background:#f0f2f7">
          <strong>${echapper(p.id)}</strong> — ${echapper(p.nom)}
        </td></tr>
      <tr><td style="width:230px;padding:1px 8px;font-size:9px;color:#5a6478">réunions de chantier</td>
        <td style="padding:0"><div style="position:relative;height:12px">${marquesReunion}${traitJour}</div></td></tr>`

      const lignes = lots
        .map(({ marche: m, couleur }) => {
          const e = etatLot(m, state.tachesChantier, state.intemperies, today)
          const b = e.intervention ? barreLot(f, e.intervention) : null
          const bordure = e.enRetard ? '2px solid #bb2233' : e.decroche ? '2px solid #b7791f' : `1px solid ${couleur}`
          // même encodage qu'à l'écran, trait pour trait : barre pleine,
          // libellé blanc, bandeau d'avancement au pied, rayures quand
          // l'avancement n'a jamais été constaté
          const bandeau =
            e.avancementPct !== null
              ? `<span style="position:absolute;left:2px;right:2px;bottom:2px;height:4px;border-radius:2px;background:rgba(255,255,255,.3)"><span style="position:absolute;left:0;top:0;bottom:0;width:${e.avancementPct}%;border-radius:2px;background:#fff"></span></span>`
              : ''
          const rayures =
            e.avancementPct === null
              ? ';background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.24) 0 4px,transparent 4px 8px)'
              : ''
          const barre =
            b && b.visible
              ? `<div style="position:absolute;left:${b.gauche}%;width:${b.largeur}%;top:3px;bottom:3px;background:${couleur}${rayures};border:${bordure};border-radius:3px;overflow:hidden"><span style="position:relative;display:block;font-size:9px;font-weight:700;line-height:16px;padding-left:4px;white-space:nowrap;color:#fff">${echapper(m.entreprise)}${e.avancementPct !== null ? ` &middot; ${e.avancementPct} %` : ''}</span>${bandeau}</div>`
              : ''
          const prolongation =
            e.prolongationJours > 0 && e.finDefendable && e.intervention
              ? (() => {
                  const x = barreLot(f, { debut: addDays(e.intervention!.fin, 1), fin: e.finDefendable! })
                  return x.visible
                    ? `<div style="position:absolute;left:${x.gauche}%;width:${x.largeur}%;top:6px;bottom:6px;background:repeating-linear-gradient(45deg,#b7791f 0 3px,transparent 3px 7px);opacity:.55;border-radius:2px"></div>`
                    : ''
                })()
              : ''
          const reception =
            m.dateReception && m.dateReception >= f.debut && m.dateReception < f.fin
              ? `<div style="position:absolute;left:${pourcent(f, m.dateReception)}%;top:0;transform:translateX(-50%);font-size:9px;color:#1a7f4b">&#9650;</div>`
              : ''
          const etatTexte = e.enRetard
            ? ` <span style="color:#bb2233">retard ${e.joursDeRetard} j</span>`
            : e.decroche
              ? ' <span style="color:#b7791f">décroche</span>'
              : e.receptionne
                ? ' <span style="color:#1a7f4b">réceptionné</span>'
                : ''
          return `<tr>
        <td style="width:230px;padding:3px 8px;border-bottom:1px solid #e3e6ec;font-size:10px"><strong>${echapper(m.lot)}</strong> — ${echapper(m.entreprise)}${etatTexte}</td>
        <td style="padding:0;border-bottom:1px solid #e3e6ec"><div style="position:relative;height:24px;background:#f6f7fa">${barre}${prolongation}${reception}${traitJour}</div></td>
      </tr>`
        })
        .join('')

      return enTeteChantier + lignes
    })
    .join('')

  const conflits = chevauchementsEntreprise(
    state.marches.filter((m) => projets.some((p) => p.id === m.projetId)),
  )
  const blocConflits = conflits.length
    ? `<div class="muted" style="margin-top:10px"><strong>Entreprises attendues à deux endroits à la fois :</strong> ${echapper(
        conflits
          .map((c) => `${c.entreprise} (${fmtDate(c.debut)} → ${fmtDate(c.fin)}, ${c.jours} j)`)
          .join(' · '),
      )}</div>`
    : ''

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Planning chantier — ${echapper(state.settings.nomAgence)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1a2233; margin: 24px; }
  h1 { font-size: 18px; margin: 0; }
  .muted { color: #5a6478; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  .impression { position: fixed; top: 12px; right: 12px; }
  @media print { .impression { display: none; } body { margin: 0; } }
</style></head><body>
<button class="impression" onclick="window.print()">Imprimer / PDF</button>
<h1>${echapper(state.settings.nomAgence)} — Planning chantier</h1>
<div class="muted">${echapper(projets.map((p) => `${p.id} — ${p.nom}`).join(' · '))}<br>
Édité le ${fmtDate(today)} · fenêtre ${echapper(libelleFenetre(f))} · échelle ${f.echelle === 'semaine' ? 'semaines' : 'mois'} ·
trait rouge = aujourd'hui · &#9670; réunion de chantier · &#9650; réception ·
bandeau blanc au pied de la barre = avancement constaté en réunion · barre rayée = avancement jamais constaté ·
hachures orange après la barre = jours d'intempéries reconnus ·
document indicatif, ajusté au fil du chantier</div>
${blocConflits}
<table>
  <tr><td style="width:230px"></td><td style="padding:0"><div style="position:relative;height:16px">${enTetes}</div></td></tr>
  ${rangs}
</table>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

// ---------- l'écran ----------

const PAS_PAR_ECHELLE: Record<Echelle, { value: string; label: string }[]> = {
  semaine: [
    { value: '4', label: '4 semaines' },
    { value: '8', label: '8 semaines' },
    { value: '13', label: '13 semaines' },
    { value: '26', label: '26 semaines' },
  ],
  mois: [
    { value: '6', label: '6 mois' },
    { value: '12', label: '12 mois' },
    { value: '24', label: '24 mois' },
  ],
}

const PAS_DEFAUT: Record<Echelle, number> = { semaine: 13, mois: 12 }

function GanttChantier() {
  const { state, update, replace } = useStore()
  const today = useToday()
  const route = useRoute()

  const cibleRoute = route[0] === 'planning' && route[1] === 'chantier' ? route[2] : undefined
  const [filtre, setFiltre] = useState(cibleRoute || '')
  const [echelle, setEchelle] = useState<Echelle>(() => echelleSuggeree(state.marches))
  const [pas, setPas] = useState<number>(() => PAS_DEFAUT[echelleSuggeree(state.marches)])
  const [ancre, setAncre] = useState(todayISO())
  const [propager, setPropager] = useState(true)
  const [lotOuvert, setLotOuvert] = useState<string | null>(null)
  const [largeurPiste, setLargeurPiste] = useState(0)
  const pisteMesure = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (cibleRoute) setFiltre(cibleRoute)
  }, [cibleRoute])

  const tous = projetsAvecChantier(state)
  const projets = filtre ? tous.filter((p) => p.id === filtre) : tous
  const f = fenetrePlanning(ancre, echelle, pas)
  const grads = graduations(f)
  const jourVisible = today >= f.debut && today < f.fin

  const marchesAffiches = state.marches.filter(
    (m) => projets.some((p) => p.id === m.projetId) && interventionDe(m) !== null,
  )
  // les conflits se cherchent sur TOUS les marchés, pas sur les seuls
  // affichés : l'entreprise doublement attendue l'est presque toujours sur
  // un chantier que ce filtre vient de masquer — c'est exactement pour ça
  // qu'on ne le voyait pas
  const conflits = chevauchementsEntreprise(state.marches)
  const idsEnConflit = marchesEnConflit(conflits)

  const etats = new Map<string, EtatLot>()
  for (const m of marchesAffiches) etats.set(m.id, etatLot(m, state.tachesChantier, state.intemperies, today))

  const aSurveiller = marchesAffiches
    .map((m) => ({ marche: m, etat: etats.get(m.id)! }))
    .filter((x) => x.etat.gravite > 0)
    .sort((a, b) => b.etat.gravite - a.etat.gravite || b.etat.joursDeRetard - a.etat.joursDeRetard)

  // la largeur réelle d'une piste décide si le glissement est praticable —
  // elle se mesure, elle ne se suppose pas. Les dépendances couvrent tout ce
  // qui change la mise en page ; le redimensionnement de la fenêtre est
  // écouté, et l'écouteur n'est reposé qu'à ces changements-là.
  const nbLignes = marchesAffiches.length
  useEffect(() => {
    const mesurer = () => setLargeurPiste(pisteMesure.current?.getBoundingClientRect().width ?? 0)
    mesurer()
    window.addEventListener('resize', mesurer)
    return () => window.removeEventListener('resize', mesurer)
  }, [echelle, pas, filtre, nbLignes])

  const changerEchelle = (e: Echelle) => {
    setEchelle(e)
    setPas(PAS_DEFAUT[e])
  }

  const calerSurChantier = () => {
    const cadre = fenetreSurLots(marchesAffiches, echelle)
    if (!cadre) return
    setAncre(cadre.debut)
    setPas(cadre.pas)
  }

  const naviguer = (sens: number) => setAncre(decalerFenetre(f, sens).debut)

  const appliquerLeGeste = (m: MarcheTravaux, prise: Prise, geste: GesteApplique) => {
    const reports = reportsDuGeste(state.marches, m.id, prise, geste, propager)
    if (reports.length === 0) return
    const snap = state
    update((d) => {
      for (const r of reports) {
        const cible = d.marches.find((x) => x.id === r.marcheId)
        if (!cible) continue
        cible.dateDebut = r.debut
        cible.dateFin = r.fin
      }
    })
    const suivants = reports.length - 1
    const verbe = prise === 'deplacer' ? 'déplacé' : prise === 'debut' ? 'début ajusté' : 'fin ajustée'
    toast(
      `${m.lot} ${verbe} : ${fmtDate(geste.debut)} → ${fmtDate(geste.fin)}` +
        (suivants > 0 ? ` · ${suivants} lot${suivants > 1 ? 's' : ''} suivant${suivants > 1 ? 's' : ''} décalé${suivants > 1 ? 's' : ''}` : '') +
        (geste.bute ? ' (butée : un lot ne peut pas finir avant de commencer)' : ''),
      { undo: () => replace(snap) },
    )
  }

  const pxJour = pixelsParJour(f, largeurPiste)
  const glissementPraticable = pxJour >= PIXELS_PAR_JOUR_MINIMUM

  const vide = marchesAffiches.length === 0

  return (
    <>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <Btn onClick={() => naviguer(-1)} title="Fenêtre précédente">‹</Btn>
        <Btn onClick={() => naviguer(1)} title="Fenêtre suivante">›</Btn>
        <Btn onClick={() => setAncre(todayISO())}>Aujourd'hui</Btn>
        <Btn kind="ghost" onClick={calerSurChantier} disabled={vide}>Caler sur le chantier</Btn>
        <Select
          value={echelle}
          onChange={(v) => changerEchelle(v as Echelle)}
          options={[
            { value: 'semaine', label: 'Zoom : semaines' },
            { value: 'mois', label: 'Zoom : mois' },
          ]}
          style={{ maxWidth: 160 }}
        />
        <Select
          value={String(pas)}
          onChange={(v) => setPas(Number(v))}
          options={PAS_PAR_ECHELLE[echelle]}
          style={{ maxWidth: 150 }}
        />
        <Select
          value={filtre}
          onChange={setFiltre}
          options={[{ value: '', label: 'Tous les chantiers' }, ...tous.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` }))]}
          style={{ maxWidth: 280 }}
        />
        <span className="muted small">{libelleFenetre(f)}</span>
        <span className="spacer" />
        <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={propager} onChange={(e) => setPropager(e.target.checked)} />
          déplacer un lot repousse les suivants
        </label>
        <Btn kind="primary" onClick={() => ouvrirChantierPDF(state, projets, f, today)} disabled={vide}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="printer" size={14} /> Imprimer / PDF
          </span>
        </Btn>
      </div>

      {aSurveiller.length > 0 && (
        <Card titre="Ce qui ne va pas">
          <Table
            compact
            head={['Lot · entreprise', 'Chantier', 'État', 'Avancement / délai', 'Constat']}
          >
            {aSurveiller.map(({ marche: m, etat: e }) => (
              <tr key={m.id} className="clickable" onClick={() => setLotOuvert(m.id)}>
                <td>
                  <strong>{m.lot}</strong> <span className="muted small">{m.entreprise}</span>
                </td>
                <td>
                  <a href={`#/projets/${m.projetId}/chantier`}>{m.projetId}</a>
                </td>
                <td>
                  {e.enRetard ? (
                    <Badge tone="danger">retard {e.joursDeRetard} j</Badge>
                  ) : (
                    <Badge tone="warn">décroche</Badge>
                  )}
                </td>
                <td className="num">
                  {e.avancementPct === null ? <span className="muted">—</span> : `${e.avancementPct} %`}
                  <span className="muted"> / {e.tempsEcoulePct === null ? '—' : `${e.tempsEcoulePct} %`}</span>
                </td>
                <td className="small">{e.raisons[0] || '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {conflits.length > 0 && (
        <Card titre="Une entreprise, deux chantiers à la fois">
          <p className="muted small" style={{ marginTop: 0 }}>
            Une entreprise ne se dédouble pas. Ces interventions se chevauchent pour la même
            entreprise — c'est la promesse de délai qu'on donne en réunion qui est en jeu.
          </p>
          <Table compact head={['Entreprise', 'Période commune', 'Durée', 'Lots concernés']}>
            {conflits.map((c) => {
              const a = state.marches.find((m) => m.id === c.aId)
              const b = state.marches.find((m) => m.id === c.bId)
              return (
                <tr key={`${c.aId}-${c.bId}`}>
                  <td>
                    <strong>{c.entreprise}</strong>{' '}
                    {c.memeChantier ? (
                      <Badge tone="info">même chantier</Badge>
                    ) : (
                      <Badge tone="warn">deux chantiers</Badge>
                    )}
                  </td>
                  <td>
                    {fmtDate(c.debut)} → {fmtDate(c.fin)}
                  </td>
                  <td className="num">{c.jours} j</td>
                  <td className="small">
                    <a href={`#/projets/${a?.projetId}/chantier`}>
                      {a?.projetId} · {a?.lot}
                    </a>
                    {' — '}
                    <a href={`#/projets/${b?.projetId}/chantier`}>
                      {b?.projetId} · {b?.lot}
                    </a>
                  </td>
                </tr>
              )
            })}
          </Table>
        </Card>
      )}

      <Card>
        {vide ? (
          <EmptyState>
            Aucun lot de chantier daté — renseignez les dates d'intervention des marchés dans l'onglet
            Chantier d'un projet. Le Gantt se construit tout seul à partir de ces deux dates.
          </EmptyState>
        ) : (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>
              {glissementPraticable
                ? 'Glissez une barre pour déplacer l’intervention, ses bords pour l’allonger ou la raccourcir. Un clic ouvre le lot : les deux dates s’y saisissent au clavier. Chaque geste laisse un « Annuler ».'
                : 'À cette échelle un jour tient dans moins de trois pixels : le glissement viserait au hasard. Cliquez le lot et saisissez les dates au clavier — ou zoomez sur les semaines.'}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <div className="plan-frise plan-frise-chantier" style={{ rowGap: 4 }}>
                {/* graduations */}
                <div />
                <div ref={pisteMesure} style={{ position: 'relative', height: 20 }}>
                  {grads.map((g) => (
                    <div
                      key={g.date}
                      className="muted small"
                      style={{
                        position: 'absolute',
                        left: `${g.gauche}%`,
                        top: 0,
                        bottom: 0,
                        borderLeft: `1px solid ${g.majeure ? 'var(--ink-3)' : 'var(--line)'}`,
                        paddingLeft: 3,
                        fontSize: 10,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {g.label}
                    </div>
                  ))}
                  {jourVisible && (
                    <div
                      style={{ position: 'absolute', left: `${pourcent(f, today)}%`, top: 0, bottom: -2, width: 2, background: 'var(--danger)' }}
                      title={`aujourd'hui — ${fmtDate(today)}`}
                    />
                  )}
                </div>

                {projets.map((p) => {
                  const lots = lotsDuChantier(state, p.id)
                  const jalons = jalonsChantier(f, p.id, state.marches, state.reunions, state.intemperies)
                  const reunions = jalons.filter((j) => j.genre === 'reunion')
                  return (
                    <div key={p.id} style={{ display: 'contents' }}>
                      {/* en-tête du chantier — le groupement est conservé */}
                      <div className="small" style={{ paddingTop: 8 }}>
                        <a href={`#/projets/${p.id}/chantier`}>
                          <strong>{p.id}</strong>
                        </a>{' '}
                        <span className="muted" title={p.nom}>
                          {p.nom.length > 18 ? p.nom.slice(0, 18) + '…' : p.nom}
                        </span>
                      </div>
                      <div style={{ position: 'relative', height: 18, borderTop: '1px solid var(--line)', marginTop: 8 }}>
                        <RangeeJalons jalons={reunions} />
                        {jourVisible && (
                          <div style={{ position: 'absolute', left: `${pourcent(f, today)}%`, top: 0, bottom: 0, width: 2, background: 'var(--danger)', opacity: 0.5 }} />
                        )}
                      </div>

                      {lots.map(({ marche: m, couleur }) => {
                        const e = etats.get(m.id)!
                        const jalonsLot = jalons.filter((j) => j.marcheId === m.id && j.genre !== 'fin')
                        return (
                          <div key={m.id} style={{ display: 'contents' }}>
                            <div className="small" style={{ paddingRight: 8, overflow: 'hidden' }}>
                              <button
                                className="btn btn-small btn-ghost"
                                style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', textAlign: 'left' }}
                                onClick={() => setLotOuvert(lotOuvert === m.id ? null : m.id)}
                                title={`${m.lot} — ${m.entreprise}`}
                              >
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: couleur, marginRight: 5 }} />
                                <strong>{m.lot}</strong>
                              </button>
                              <span className="muted" style={{ fontSize: 10 }}>
                                {m.entreprise.length > 20 ? m.entreprise.slice(0, 20) + '…' : m.entreprise}
                              </span>
                              {e.gravite === 2 && <Badge tone="danger">retard</Badge>}
                              {e.gravite === 1 && <Badge tone="warn">décroche</Badge>}
                            </div>
                            <div
                              data-piste
                              style={{ position: 'relative', height: 26, background: 'var(--bg-soft, #f6f7fa)', borderRadius: 5 }}
                            >
                              <BarreGantt
                                marche={m}
                                etat={e}
                                couleur={couleur}
                                fenetre={f}
                                enConflit={idsEnConflit.has(m.id)}
                                onGeste={(prise, geste) => appliquerLeGeste(m, prise, geste)}
                                onOuvrir={() => setLotOuvert(lotOuvert === m.id ? null : m.id)}
                              />
                              <RangeeJalons jalons={jalonsLot} interactif={false} />
                              {jourVisible && (
                                <div
                                  style={{ position: 'absolute', left: `${pourcent(f, today)}%`, top: -2, bottom: -2, width: 2, background: 'var(--danger)', pointerEvents: 'none' }}
                                  title={`aujourd'hui — ${fmtDate(today)}`}
                                />
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>

            <p className="muted small" style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--accent, #2563eb)' }}>◆ réunion de chantier</span>
              <span style={{ color: 'var(--ok)' }}>▲ réception</span>
              <span style={{ color: 'var(--warn)' }}>▫ fin + intempéries</span>
              <span>bandeau au pied de la barre = avancement constaté en réunion</span>
              <span>barre rayée = avancement jamais constaté</span>
              <Badge tone="danger">bord rouge : fin dépassée</Badge>
              <Badge tone="warn">bord orange : avancement en retard sur le délai</Badge>
            </p>
          </>
        )}
      </Card>

      {lotOuvert && (() => {
        const m = state.marches.find((x) => x.id === lotOuvert)
        const e = m ? etats.get(m.id) : undefined
        if (!m || !e) return null
        return (
          <Card titre={`${m.lot} — ${m.entreprise}`}>
            <ConduiteLot marche={m} etat={e} propager={propager} onFermer={() => setLotOuvert(null)} />
          </Card>
        )
      })()}

      {filtre && (() => {
        const p = state.projets.find((x) => x.id === filtre)
        return p ? <EditionChantier projet={p} /> : null
      })()}
    </>
  )
}

// ============================================================
// Plan de charge — la vue « qui bosse sur quoi, quelle semaine »
// et surtout QUI EST EN SURCHARGE. Lignes = personnes, colonnes =
// semaines ; chaque cellule confronte les heures planifiées (issues
// des phases datées réparties dans le temps et entre l'équipe) à la
// capacité hebdo. Rouge = surcharge, à rééquilibrer.
// ============================================================

/** couleur d'une cellule à l'écran — tokens de thème (clair ET sombre) */
function couleurCharge(ratio: number): { bg: string; fg: string } {
  if (ratio <= 0.001) return { bg: 'transparent', fg: 'var(--ink-3)' }
  if (ratio > 1.001) return { bg: 'var(--danger-soft)', fg: 'var(--danger)' } // surcharge
  if (ratio >= 0.85) return { bg: 'var(--warn-soft)', fg: 'var(--warn)' } // presque plein
  return { bg: 'var(--ok-soft)', fg: 'var(--ok)' } // marge disponible
}

/** version impression : couleurs littérales, toujours sur fond blanc A4 */
function couleurChargePDF(ratio: number): { bg: string; fg: string } {
  if (ratio <= 0.001) return { bg: '#ffffff', fg: '#94a3b8' }
  if (ratio > 1.001) return { bg: '#fde0e0', fg: '#b91c1c' }
  if (ratio >= 0.85) return { bg: '#fdf3c6', fg: '#854d0e' }
  return { bg: '#dcf5e3', fg: '#166534' }
}

/** liste des lundis (ISO) de la fenêtre */
function lundisDe(debutLundi: string, nbSemaines: number): string[] {
  const l: string[] = []
  for (let i = 0; i < nbSemaines; i++) l.push(addDays(debutLundi, i * 7))
  return l
}

function PlanDeCharge({ debutLundi, nbSemaines }: { debutLundi: string; nbSemaines: number }) {
  const { state } = useStore()
  const today = useToday()
  const cap = capaciteSemaine(state)
  const equipe = state.settings.equipe
  const lundis = lundisDe(debutLundi, nbSemaines)
  const lundiCourant = mondayOf(today)

  // 5.12 — les congés confrontés aux heures planifiées : chaque conflit
  // (charge > capacité congés déduits) se voit, et un clic montre les
  // pistes de report. Le calcul vit dans src/conges.ts ; ici on AFFICHE,
  // et le report reste un geste humain sur le Gantt ou l'équipe du projet.
  const [conflitOuvert, setConflitOuvert] = useState<ConflitConge | null>(null)
  const tousConflits = equipe.flatMap((pers) => conflitsConges(state, pers.nom))
  const conflitsParCle = new Map(tousConflits.map((c) => [`${c.personne}|${c.lundi}`, c]))
  const basculerConflit = (c: ConflitConge) =>
    setConflitOuvert(conflitOuvert && conflitOuvert.personne === c.personne && conflitOuvert.lundi === c.lundi ? null : c)

  if (equipe.length === 0) {
    return (
      <EmptyState>
        Renseignez l'équipe et les rémunérations dans Paramètres pour afficher le plan de charge.
      </EmptyState>
    )
  }
  if (state.projets.every((p) => !STATUTS_ACTIFS.includes(p.statut) || !p.phases.some((ph) => ph.debut && ph.fin))) {
    return (
      <EmptyState>
        Aucun projet actif avec des phases datées — datez les phases (onglet Phases) pour voir la
        charge se répartir sur l'équipe.
      </EmptyState>
    )
  }

  const totalSemaine = (l: string) => equipe.reduce((s, pers) => s + chargePlanifieeSemaine(state, pers.nom, l), 0)

  return (
    <>
      {tousConflits.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
          <span className="muted small">Congés à confronter :</span>
          {tousConflits.map((c) => (
            <Btn small key={`${c.personne}|${c.lundi}`} kind={conflitOuvert && conflitOuvert.personne === c.personne && conflitOuvert.lundi === c.lundi ? 'danger' : 'default'} onClick={() => basculerConflit(c)} title={`${c.personne} · semaine du ${fmtDate(c.lundi)} — ${fmtHeures(c.planifie)} planifiées, capacité ${fmtHeures(c.capacite)} (${fmtHeures(c.absence)} de congé)`}>
              congé : {fmtHeures(c.excedent)} à replacer — {c.personne}, sem. du {fmtDate(c.lundi)}
            </Btn>
          ))}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
      <table className="table table-compact" style={{ minWidth: 620, borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            <th className="col-figee" style={{ textAlign: 'left' }}>
              Personne
            </th>
            {lundis.map((l) => (
              <th
                key={l}
                style={{
                  textAlign: 'center',
                  fontWeight: l === lundiCourant ? 800 : 600,
                  color: l === lundiCourant ? 'var(--danger)' : undefined,
                  whiteSpace: 'nowrap',
                  fontSize: 11,
                  minWidth: 46,
                  borderBottom: l === lundiCourant ? '2px solid var(--danger)' : undefined,
                }}
                title={`semaine du ${fmtDate(l)}`}
              >
                {Number(l.slice(8, 10))} {NOMS_MOIS_COURTS[Number(l.slice(5, 7)) - 1].slice(0, 4)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {equipe.map((pers) => (
            <tr key={pers.id}>
              <td className="col-figee" style={{ whiteSpace: 'nowrap' }}>
                <strong>{pers.nom}</strong>{' '}
                <span className="muted small">{Math.round(cap)} h/sem</span>
              </td>
              {lundis.map((l) => {
                const h = chargePlanifieeSemaine(state, pers.nom, l)
                const absH = heuresAbsenceSemaine(state, pers.nom, l)
                const capP = capacitePersonneSemaine(state, pers.nom, l)
                // 5.12 : la cellule en conflit se voit et s'ouvre — le badge
                // au-dessus dit la même chose, les deux mènent aux pistes
                const conflit = conflitsParCle.get(`${pers.nom}|${l}`)
                if (capP <= 0) {
                  // semaine entièrement en congé — s'il y restait des heures
                  // planifiées, TOUT est à replacer : c'est un conflit aussi
                  return (
                    <td
                      key={l}
                      style={{ textAlign: 'center', background: 'var(--bg-soft)', color: conflit ? 'var(--danger)' : 'var(--ink-3)', fontSize: 10, fontStyle: 'italic', fontWeight: conflit ? 800 : undefined, padding: '4px 2px', outline: conflit ? '2px solid var(--danger)' : undefined, outlineOffset: -2, cursor: conflit ? 'pointer' : undefined }}
                      title={`${pers.nom} · semaine du ${fmtDate(l)}\nCongé toute la semaine${conflit ? ` — congé : ${fmtHeures(conflit.excedent)} à replacer` : ''}`}
                      onClick={conflit ? () => basculerConflit(conflit) : undefined}
                    >
                      congé
                    </td>
                  )
                }
                const ratio = capP > 0 ? h / capP : 0
                const { bg, fg } = couleurCharge(ratio)
                const detail = `${pers.nom} · semaine du ${fmtDate(l)} — ${fmtHeures(h)} planifiées / ${Math.round(capP)} h capacité${absH > 0 ? ` (${Math.round(absH)} h de congé)` : ''} (${Math.round(ratio * 100)} %)${conflit ? ` — congé : ${fmtHeures(conflit.excedent)} à replacer` : ''}`
                return (
                  <td
                    key={l}
                    style={{ textAlign: 'center', background: bg, color: fg, fontSize: 11, fontWeight: ratio > 1.001 ? 800 : 600, padding: '4px 2px', boxShadow: absH > 0 ? 'inset 0 -3px 0 var(--ink-3)' : undefined, outline: conflit ? '2px solid var(--danger)' : undefined, outlineOffset: -2, cursor: 'pointer' }}
                    title={detail}
                    onClick={() => (conflit ? basculerConflit(conflit) : toast(detail))}
                  >
                    {h < 0.05 ? '·' : Math.round(h)}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr>
            <td className="col-figee">
              <span className="muted small">Équipe · {Math.round(cap * equipe.length)} h/sem</span>
            </td>
            {lundis.map((l) => {
              const t = totalSemaine(l)
              const capEquipe = equipe.reduce((s, pers) => s + capacitePersonneSemaine(state, pers.nom, l), 0)
              const ratio = capEquipe > 0 ? t / capEquipe : 0
              const { fg } = couleurCharge(ratio)
              return (
                <td key={l} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: fg, borderTop: '1px solid var(--line)' }} title={`total équipe · ${fmtHeures(t)} / ${Math.round(capEquipe)} h capacité (congés déduits)`}>
                  {t < 0.05 ? '·' : Math.round(t)}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
      </div>
      <p className="muted small" style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        Heures planifiées / semaine (phases datées réparties dans le temps et entre l'équipe affectée).
        <span><span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 2, background: 'var(--ok-soft)', marginRight: 4, verticalAlign: 'middle' }} />marge</span>
        <span><span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 2, background: 'var(--warn-soft)', marginRight: 4, verticalAlign: 'middle' }} />presque plein</span>
        <span><span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 2, background: 'var(--danger-soft)', marginRight: 4, verticalAlign: 'middle' }} />surcharge</span>
        <span className="muted"><em>congé</em> = semaine indisponible ; capacité réduite les semaines partiellement en congé ; liseré rouge = congé en conflit avec la charge, cliquer pour les pistes de report.</span>
      </p>
      {conflitOuvert && <PistesReport conflit={conflitOuvert} />}
    </>
  )
}

/** ce qui EST planifié cette semaine-là, ligne à ligne — « P03 · DCE — 12 h ».
 *
 *  Aucun calcul nouveau : `chargePlanifieeSemaine` (src/derive.ts) est
 *  REJOUÉE sur un état restreint à une seule phase d'un seul projet. La
 *  somme des lignes est donc, par construction, le total que la cellule
 *  affiche — refaire la boucle ici la ferait diverger au premier changement
 *  de la règle de répartition (constat R3 de l'audit d'usage). */
interface LigneChargeSemaine {
  projetId: string
  nomProjet: string
  phase: PhaseCode
  heures: number
}

function chargeParPhase(state: AppState, personne: string, lundi: string): LigneChargeSemaine[] {
  const lignes: LigneChargeSemaine[] = []
  for (const p of state.projets) {
    for (const ph of p.phases) {
      const heures = chargePlanifieeSemaine({ ...state, projets: [{ ...p, phases: [ph] }] }, personne, lundi)
      if (heures > EPSILON_HEURES) lignes.push({ projetId: p.id, nomProjet: p.nom, phase: ph.code, heures })
    }
  }
  return lignes.sort((a, b) => b.heures - a.heures || a.projetId.localeCompare(b.projetId))
}

/** 5.12 — les pistes de report d'un conflit congé × charge. Tout est
 *  calculé par src/conges.ts ; ce bloc MONTRE et n'écrit rien : décaler
 *  une phase (onglet Études) ou changer l'équipe du projet reste le geste
 *  de l'humain — la machine propose, elle n'applique pas (§15). */
function PistesReport({ conflit: c }: { conflit: ConflitConge }) {
  const { state } = useStore()
  const pistes = propositionsReport(state, c)
  // parcours 10 : la piste disait « 14 h à replacer » sans jamais dire
  // LESQUELLES — on repartait chercher la phase à décaler à la main
  const aDecaler = chargeParPhase(state, c.personne, c.lundi)
  return (
    <div style={{ marginTop: 12, border: '1px solid var(--danger)', borderRadius: 8, padding: '10px 12px' }}>
      <strong>Congé de {c.personne} — semaine du {fmtDate(c.lundi)}</strong>
      <p className="muted small" style={{ margin: '6px 0 8px' }}>
        {fmtHeures(c.planifie)} planifiées pour {fmtHeures(c.capacite)} de capacité ({fmtHeures(c.absence)} de
        congé) : <strong>{fmtHeures(c.excedent)} à replacer</strong>.
      </p>
      {aDecaler.length > 0 && (
        <>
          <p className="small" style={{ margin: '0 0 6px' }}>
            Ce qui est planifié cette semaine-là — c'est l'une de ces phases qu'il faut décaler :
          </p>
          <Table
            compact
            head={['Projet · phase', <span key="h" className="right">Heures</span>, '']}
          >
            {aDecaler.map((l) => (
              <tr key={`${l.projetId}|${l.phase}`}>
                <td>
                  <strong>{l.projetId}</strong> · {l.phase}{' '}
                  <span className="muted small" title={l.nomProjet}>
                    {LIBELLES_PHASES[l.phase]}
                  </span>
                </td>
                <td className="right num">{fmtHeures(l.heures)}</td>
                <td className="right">
                  <a
                    href={`#/planning/etudes/${l.projetId}`}
                    className="small"
                    title={`Ouvre « Ajuster les dates » de ${l.projetId} — la phase ${l.phase} et celles qui suivent`}
                  >
                    ajuster →
                  </a>
                </td>
              </tr>
            ))}
          </Table>
          <p className="small" style={{ margin: '8px 0 10px' }}>
            <strong>Où poser ces heures :</strong>
          </p>
        </>
      )}
      {pistes.length === 0 ? (
        <EmptyState>
          Aucune marge dans les semaines voisines ni chez l'autre personne — il faudra décaler une phase
          (onglet Études) ou revoir le congé.
        </EmptyState>
      ) : (
        <Table compact head={['Piste', 'Semaine', 'Capacité restante', 'Peut reprendre']}>
          {pistes.map((p) => (
            <tr key={`${p.cible}|${p.personne}|${p.lundi}`}>
              <td>
                {p.cible === 'semaine-voisine' ? (
                  <>
                    <strong>{p.personne}</strong> <span className="muted small">semaine {p.lundi < c.lundi ? 'd’avant' : 'd’après'}</span>
                  </>
                ) : (
                  <>
                    <strong>{p.personne}</strong> <span className="muted small">autre personne, même semaine</span>
                  </>
                )}
              </td>
              <td>{fmtDate(p.lundi)}</td>
              <td>{fmtHeures(p.capaciteRestante)}</td>
              <td><strong>{fmtHeures(p.heures)}</strong>{p.heures < c.excedent - 0.05 ? <span className="muted small"> sur {fmtHeures(c.excedent)}</span> : null}</td>
            </tr>
          ))}
        </Table>
      )}
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        Rien n'est appliqué automatiquement : pour reporter, décalez la phase (« ajuster » ci-dessus, ou
        onglet Planning de la fiche projet), ajustez ses heures prévues, ou modifiez l'équipe du projet.
      </p>
    </div>
  )
}

// ============================================================
// 5.13 — « Et si ? » : un projet de X heures sur une fenêtre,
// qui peut le prendre, et ça passe ? Tout le calcul vit dans
// src/chargeProspective.ts ; l'écran saisit trois chiffres et
// montre le verdict CHIFFRÉ par personne — jamais de
// recommandation d'attribution : décider reste humain (§15),
// et rien n'est écrit, simuler n'est pas engager.
// ============================================================

/** verdict d'une personne, en toutes lettres et en chiffres */
function BadgeVerdict({ v }: { v: VerdictPersonne }) {
  if (v.passeChaqueSemaine) return <Badge tone="ok">ça passe, semaine par semaine</Badge>
  if (v.passeAuTotal) {
    const serrees = v.semaines.filter((s) => s.solde < -0.05).length
    return <Badge tone="warn">passe en lissant — {serrees} semaine{serrees > 1 ? 's' : ''} trop courte{serrees > 1 ? 's' : ''}</Badge>
  }
  return <Badge tone="danger">ne passe pas : il manque {fmtHeures(v.manque)}</Badge>
}

function SimulateurEtSi() {
  const { state } = useStore()
  const [heures, setHeures] = useState<number | null>(null)
  const [debut, setDebut] = useState<string | null>(null)
  const [fin, setFin] = useState<string | null>(null)
  const [personne, setPersonne] = useState('')
  const [detailDe, setDetailDe] = useState('')

  const actives = personnesActives(state)
  const pret = heures != null && debut != null && fin != null
  const res = pret ? simulerProjet(state, { heures, debut, fin, personne: personne || null }) : null

  return (
    <Card titre="Et si ? — simuler un projet avant de s'engager">
      <p className="muted small" style={{ marginTop: 0, marginBottom: 8 }}>
        Un projet de X heures sur une fenêtre : capacité restante par personne, congés déduits, semaine
        par semaine. Des chiffres, pas une attribution — et rien n'est enregistré.
      </p>
      <div className="form-row" style={{ alignItems: 'flex-end' }}>
        <Field label="Heures du projet">
          <NumInput value={heures} onChange={setHeures} style={{ width: 90 }} />
        </Field>
        <Field label="Du">
          <DateInput value={debut} onChange={setDebut} />
        </Field>
        <Field label="Au">
          <DateInput value={fin} onChange={setFin} />
        </Field>
        <Field label="Personne">
          <Select value={personne} onChange={setPersonne} options={[{ value: '', label: 'Toute l’équipe active' }, ...actives.map((n) => ({ value: n, label: n }))]} />
        </Field>
      </div>
      {res && 'erreur' in res && <p className="small" style={{ color: 'var(--danger)', marginBottom: 0 }}>{res.erreur}</p>}
      {res && !('erreur' in res) && (
        <>
          <p className="muted small" style={{ margin: '10px 0 8px' }}>
            {res.lundis.length} semaine{res.lundis.length > 1 ? 's' : ''} ({fmtDate(res.lundis[0])} →{' '}
            {fmtDate(addDays(res.lundis[res.lundis.length - 1], 6))}) · le projet demande{' '}
            <strong>{fmtHeures(res.demandeParSemaine)}</strong> par semaine (réparti comme les phases réelles).
          </p>
          <Table compact head={['Personne', 'Libre sur la fenêtre', 'Demandé', 'Verdict', '']}>
            {res.parPersonne.map((v) => (
              <tr key={v.personne}>
                <td><strong>{v.personne}</strong></td>
                <td>{fmtHeures(v.heuresDisponibles)}</td>
                <td>{fmtHeures(v.heuresDemandees)}</td>
                <td><BadgeVerdict v={v} /></td>
                <td className="right">
                  <Btn small kind="ghost" onClick={() => setDetailDe(detailDe === v.personne ? '' : v.personne)}>
                    {detailDe === v.personne ? 'fermer' : 'semaine par semaine'}
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
          {res.parPersonne
            .filter((v) => v.personne === detailDe)
            .map((v) => (
              <div key={v.personne} style={{ marginTop: 10 }}>
                <p className="small" style={{ margin: '0 0 6px' }}>
                  <strong>{v.personne}</strong> — semaine par semaine :
                </p>
                <Table compact head={['Semaine', 'Capacité', 'Déjà planifié', 'Restant', 'Projet simulé', 'Solde']}>
                  {v.semaines.map((s) => (
                    <tr key={s.lundi}>
                      <td>{fmtDate(s.lundi)}</td>
                      <td>{fmtHeures(s.capacite)}</td>
                      <td>{fmtHeures(s.planifie)}</td>
                      <td>{fmtHeures(Math.max(0, s.restant))}</td>
                      <td>{fmtHeures(s.demande)}</td>
                      <td style={{ color: s.solde < -0.05 ? 'var(--danger)' : 'var(--ok)', fontWeight: 700 }}>
                        {s.solde < -0.05 ? `manque ${fmtHeures(-s.solde)}` : 'tient'}
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            ))}
        </>
      )}
    </Card>
  )
}

function GestionAbsences() {
  const { state, update, replace } = useStore()
  const equipe = state.settings.equipe
  const [personne, setPersonne] = useState(equipe[0]?.nom || '')
  const [debut, setDebut] = useState<string | null>(null)
  const [fin, setFin] = useState<string | null>(null)
  const [motif, setMotif] = useState('')

  const absences = [...state.absences].sort((a, b) => (b.debut || '').localeCompare(a.debut || ''))

  const ajouter = () => {
    if (!personne) return toast('Choisir une personne.', { tone: 'danger' })
    if (!debut || !fin) return toast('Indiquer les dates de début et de fin.', { tone: 'danger' })
    if (fin < debut) return toast('La fin est avant le début.', { tone: 'danger' })
    update((d) => {
      d.absences.push({ id: uid('abs'), personne, debut, fin, motif: motif.trim() || undefined })
    })
    toast('Congé ajouté.', { tone: 'ok' })
    setDebut(null)
    setFin(null)
    setMotif('')
  }

  const supprimer = async (id: string) => {
    const snap = state
    if (!(await confirmer({ message: 'Supprimer ce congé ?', danger: true, confirmerLabel: 'Supprimer' }))) return
    update((d) => {
      d.absences = d.absences.filter((a) => a.id !== id)
    })
    toast('Congé supprimé.', { undo: () => replace(snap) })
  }

  return (
    <Card titre="Congés & absences">
      <p className="small muted" style={{ marginTop: 0, marginBottom: 8 }}>
        Les congés réduisent la capacité de la personne dans le plan de charge ci-dessus.
      </p>
      {equipe.length === 0 ? (
        <EmptyState>Renseignez l'équipe dans Paramètres pour saisir des congés.</EmptyState>
      ) : (
        <>
          <div className="form-row" style={{ alignItems: 'flex-end' }}>
            <Field label="Personne">
              <Select value={personne} onChange={setPersonne} options={equipe.map((p) => ({ value: p.nom, label: p.nom }))} />
            </Field>
            <Field label="Du">
              <DateInput value={debut} onChange={setDebut} />
            </Field>
            <Field label="Au">
              <DateInput value={fin} onChange={setFin} />
            </Field>
            <Field label="Motif (optionnel)">
              <TextInput value={motif} onChange={setMotif} placeholder="Congés, formation…" />
            </Field>
            <Btn kind="primary" onClick={ajouter}>Ajouter</Btn>
          </div>
          {absences.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Table compact head={['Personne', 'Du', 'Au', 'Motif', '']}>
                {absences.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.personne}</strong></td>
                    <td>{fmtDate(a.debut)}</td>
                    <td>{fmtDate(a.fin)}</td>
                    <td className="muted small">{a.motif || '—'}</td>
                    <td className="right">
                      <Btn small kind="ghost" onClick={() => supprimer(a.id)}>Suppr.</Btn>
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function ouvrirChargePDF(state: AppState, debutLundi: string, nbSemaines: number, today: string): void {
  const equipe = state.settings.equipe
  const cap = capaciteSemaine(state)
  const lundis = lundisDe(debutLundi, nbSemaines)
  const lundiCourant = mondayOf(today)

  const enTete = lundis
    .map((l) => {
      const actuel = l === lundiCourant
      return `<th style="font-size:9px;padding:3px 2px;border-bottom:1px solid #e3e6ec;text-align:center;${actuel ? 'color:#bb2233;font-weight:800' : ''}">${Number(l.slice(8, 10))} ${NOMS_MOIS_COURTS[Number(l.slice(5, 7)) - 1].slice(0, 4)}</th>`
    })
    .join('')

  // S2 — le papier dit la MÊME capacité que l'écran : congés déduits
  // (`capacitePersonneSemaine`). Avec la capacité nominale, une semaine à
  // 2 jours de congé sortait « confortable » sur le PDF envoyé à tout le
  // monde et rouge à l'écran — c'est le PDF qu'on regarde en réunion.
  const lignes = equipe
    .map((pers) => {
      const cells = lundis
        .map((l) => {
          const h = chargePlanifieeSemaine(state, pers.nom, l)
          const capP = capacitePersonneSemaine(state, pers.nom, l)
          if (capP <= 0)
            return `<td style="text-align:center;font-size:8px;padding:3px 2px;background:#eef1f5;color:#5a6478;font-style:italic">congé</td>`
          const ratio = h / capP
          const { bg, fg } = couleurChargePDF(ratio)
          return `<td style="text-align:center;font-size:9px;padding:3px 2px;background:${bg};color:${fg};font-weight:${ratio > 1.001 ? 800 : 600}">${h < 0.05 ? '·' : Math.round(h)}</td>`
        })
        .join('')
      return `<tr><td style="padding:3px 6px;font-size:10px;white-space:nowrap;border-right:1px solid #e3e6ec"><strong>${echapper(pers.nom)}</strong> <span style="color:#5a6478">${Math.round(cap)} h</span></td>${cells}</tr>`
    })
    .join('')

  const totaux = lundis
    .map((l) => {
      const t = equipe.reduce((s, pers) => s + chargePlanifieeSemaine(state, pers.nom, l), 0)
      const capEquipe = equipe.reduce((s, pers) => s + capacitePersonneSemaine(state, pers.nom, l), 0)
      const ratio = capEquipe > 0 ? t / capEquipe : 0
      const { fg } = couleurChargePDF(ratio)
      return `<td style="text-align:center;font-size:9px;padding:3px 2px;font-weight:700;color:${fg};border-top:1px solid #cdd3dd">${t < 0.05 ? '·' : Math.round(t)}</td>`
    })
    .join('')

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Plan de charge — ${echapper(state.settings.nomAgence)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1a2233; margin: 24px; }
  h1 { font-size: 18px; margin: 0; }
  .muted { color: #5a6478; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  .impression { position: fixed; top: 12px; right: 12px; }
  @media print { .impression { display: none; } body { margin: 0; } }
</style></head><body>
<button class="impression" onclick="window.print()">Imprimer / PDF</button>
<h1>${echapper(state.settings.nomAgence)} — Plan de charge</h1>
<div class="muted">Édité le ${fmtDate(today)} · ${fmtDate(lundis[0])} → ${fmtDate(addDays(lundis[lundis.length - 1], 6))} · heures planifiées / semaine, comparées à la capacité <strong>congés déduits</strong> (semaine entièrement en congé : « congé ») · rouge = surcharge · document indicatif</div>
<table>
  <thead><tr><th style="text-align:left;font-size:10px;padding:3px 6px;border-bottom:1px solid #e3e6ec">Personne</th>${enTete}</tr></thead>
  <tbody>${lignes}<tr><td style="padding:3px 6px;font-size:10px;color:#5a6478;border-right:1px solid #e3e6ec">Total équipe</td>${totaux}</tr></tbody>
</table>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

// ---------- page ----------

// Le chantier a quitté cet aiguillage : il a son propre écran
// (`GanttChantier`), avec sa fenêtre à deux échelles, ses gestes sur les
// barres et ses règles pures. Le garder ici l'aurait condamné à la fenêtre
// en mois des phases d'études, dans laquelle une semaine de gel est
// invisible — et c'est exactement ce qu'on répare.
type Mode = 'phases' | 'charge'

function GanttEtCharge({ vue }: { vue: 'etudes' | 'charge' }) {
  const { state } = useStore()
  const today = useToday()
  const route = useRoute()
  /** une vue = un onglet — plus de bascule cachée à l'intérieur */
  const mode: Mode = vue === 'etudes' ? 'phases' : 'charge'
  const enCharge = mode === 'charge'
  // parcours 10 : « ajuster » depuis une piste de report dépose sur LE projet
  // à décaler — `#/planning/etudes/P03` ouvre sa fenêtre d'édition des dates
  const cibleRoute = route[0] === 'planning' && route[1] === 'etudes' ? route[2] : undefined
  const [filtre, setFiltre] = useState(cibleRoute || '')
  const [debutF, setDebutF] = useState(() => addMonths(debutMois(todayISO()), -1))
  const [nbMois, setNbMois] = useState(12)
  // S3 — la charge se lit en SEMAINES, et la question porte sur les 8 à 12
  // qui viennent : la fenêtre en mois affichait ~52 colonnes dont 4 passées.
  // Un trimestre par défaut, ancré sur la semaine en cours.
  const [ancreLundi, setAncreLundi] = useState(() => mondayOf(todayISO()))
  const [nbSemainesChoisi, setNbSemainesChoisi] = useState(13)

  useEffect(() => {
    if (cibleRoute) setFiltre(cibleRoute)
  }, [cibleRoute])

  const tousPhases = projetsPlanifies(state)
  const tous = tousPhases
  const projets = filtre ? tous.filter((p) => p.id === filtre) : tous
  const f = fenetreDe(debutF, nbMois)

  // fenêtre du plan de charge : en semaines, la sienne ; les frises gardent
  // la fenêtre en mois (lundis la couvrant)
  const debutLundi = enCharge ? ancreLundi : mondayOf(f.debut)
  const nbSemaines = enCharge ? nbSemainesChoisi : Math.max(1, Math.round(diffDays(f.debut, f.fin) / 7))

  const mois: string[] = []
  for (let m = f.debut; m < f.fin; m = addMonths(m, 1)) mois.push(m)

  const calerSurProjets = () => {
    const debuts = tousPhases.flatMap((p) => p.phases.filter((ph) => ph.debut).map((ph) => ph.debut!))
    if (debuts.length === 0) return
    const premier = debuts.sort()[0]
    setDebutF(debutMois(premier))
    setAncreLundi(mondayOf(premier))
  }

  const projetSelectionne = filtre ? state.projets.find((p) => p.id === filtre) : undefined

  const exporterPDF = () => {
    if (mode === 'phases') ouvrirPlanningPDF(state, projets, f, today)
    else ouvrirChargePDF(state, debutLundi, nbSemaines, today)
  }

  const vide = mode === 'phases' ? projets.length === 0 : state.settings.equipe.length === 0

  const boutonPDF = (
    <Btn kind="primary" onClick={exporterPDF} disabled={vide}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Icon name="printer" size={14} /> Imprimer / PDF
      </span>
    </Btn>
  )

  return (
    <>
      <div className="toolbar">
        <Btn onClick={() => (enCharge ? setAncreLundi(addDays(ancreLundi, -28)) : setDebutF(addMonths(debutF, -1)))}>‹</Btn>
        <Btn onClick={() => (enCharge ? setAncreLundi(addDays(ancreLundi, 28)) : setDebutF(addMonths(debutF, 1)))}>›</Btn>
        <Btn
          onClick={() => {
            setAncreLundi(mondayOf(todayISO()))
            setDebutF(addMonths(debutMois(todayISO()), -1))
          }}
        >
          Aujourd'hui
        </Btn>
        <Btn kind="ghost" onClick={calerSurProjets}>Caler sur les projets</Btn>
        {enCharge ? (
          <Select
            value={String(nbSemainesChoisi)}
            onChange={(v) => setNbSemainesChoisi(Number(v))}
            options={[
              { value: '8', label: '8 semaines' },
              { value: '13', label: '13 semaines (un trimestre)' },
              { value: '26', label: '26 semaines' },
              { value: '52', label: '52 semaines' },
            ]}
            style={{ maxWidth: 200 }}
          />
        ) : (
          <Select
            value={String(nbMois)}
            onChange={(v) => setNbMois(Number(v))}
            options={[{ value: '6', label: '6 mois' }, { value: '12', label: '12 mois' }, { value: '24', label: '24 mois' }]}
            style={{ maxWidth: 110 }}
          />
        )}
        {mode !== 'charge' && (
          <Select
            value={filtre}
            onChange={setFiltre}
            options={[{ value: '', label: 'Tous les projets actifs' }, ...tous.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` }))]}
            style={{ maxWidth: 280 }}
          />
        )}
        <span className="muted small">
          {enCharge
            ? `${fmtDate(debutLundi)} → ${fmtDate(addDays(debutLundi, nbSemaines * 7 - 1))}`
            : `${fmtDate(f.debut)} → ${fmtDate(addDays(f.fin, -1))}`}
        </span>
        <span className="spacer" />
        {boutonPDF}
      </div>

      <Card>
        {mode === 'charge' ? (
          <PlanDeCharge debutLundi={debutLundi} nbSemaines={nbSemaines} />
        ) : (
          projets.length === 0 ? (
            <EmptyState>
              Aucun projet actif avec des phases datées — utilisez « Dater les phases automatiquement »
              après avoir sélectionné un projet ci-dessous.
            </EmptyState>
          ) : (
            <div style={{ overflowX: 'auto' }}>
            <div className="plan-frise">
              <div />
              <div style={{ position: 'relative', height: 20 }}>
                {mois.map((m) => (
                  <div key={m} className="muted small" style={{ position: 'absolute', left: `${pos(f, m)}%`, top: 0, bottom: 0, borderLeft: '1px solid var(--line)', paddingLeft: 4 }}>
                    {NOMS_MOIS_COURTS[Number(m.slice(5, 7)) - 1]} {m.slice(2, 4)}
                  </div>
                ))}
              </div>
              {projets.map((p) => (
                <div key={p.id} style={{ display: 'contents' }}>
                  <div className="small" style={{ paddingRight: 8 }}>
                    <a href={`#/projets/${p.id}`}>
                      <strong>{p.id}</strong>
                    </a>{' '}
                    <span className="muted" title={p.nom}>{p.nom.length > 22 ? p.nom.slice(0, 22) + '…' : p.nom}</span>
                    <div>
                      <button className="btn btn-small btn-ghost" onClick={() => setFiltre(filtre === p.id ? '' : p.id)} title="Ajuster les dates de ce projet">
                        {filtre === p.id ? 'fermer' : 'ajuster'}
                      </button>
                    </div>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <PisteProjet projet={p} fenetre={f} />
                    {today >= f.debut && today < f.fin && (
                      <div style={{ position: 'absolute', left: `${pos(f, today)}%`, top: -4, bottom: -4, width: 2, background: 'var(--danger)' }} title={`aujourd'hui — ${fmtDate(today)}`} />
                    )}
                  </div>
                </div>
              ))}
            </div>
            </div>
          )
        )}
        {mode === 'phases' && (
          <p className="muted small" style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {PHASES_ORDRE.slice(0, 10).map((c) => (
              <span key={c}>
                <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: couleurPhase(c), marginRight: 3 }} />
                {c}
              </span>
            ))}
            <Badge tone="muted">barre cliquable → fiche projet</Badge>
          </p>
        )}
      </Card>

      {mode === 'charge' && <SimulateurEtSi />}
      {mode === 'charge' && <GestionAbsences />}
      {projetSelectionne && mode === 'phases' && <EditionDates projet={projetSelectionne} />}
    </>
  )
}

// ---------- module ----------

const ONGLETS_PLANNING: { id: string; label: string }[] = [
  { id: 'echeances', label: 'Échéances' },
  { id: 'etudes', label: 'Études' },
  { id: 'chantier', label: 'Chantier / OPC' },
  { id: 'charge', label: 'Charge & absences' },
]

export default function Planning({ ongletInitial = 'etudes' }: { ongletInitial?: string }) {
  const route = useRoute()
  let segment = route[0] === 'planning' ? route[1] : ongletInitial
  // compatibilité : l'ancien onglet « gantt » (bascule cachée) devient « études »
  if (segment === 'gantt') segment = 'etudes'
  const onglet = ONGLETS_PLANNING.some((o) => o.id === segment) ? segment! : 'etudes'

  return (
    <Page
      titre="Planning"
      sousTitre="Une vue par usage : échéances datées, phases d'études, conduite du chantier lot par lot (Gantt : les barres se déplacent), charge de l'équipe. La ligne rouge = aujourd'hui."
    >
      <Tabs tabs={ONGLETS_PLANNING} actif={onglet} onSelect={(id) => navigate(`/planning/${id}`)} />

      {onglet === 'echeances' && <EcheancesContenu />}
      {onglet === 'etudes' && <GanttEtCharge vue="etudes" />}
      {onglet === 'chantier' && <GanttChantier />}
      {onglet === 'charge' && <GanttEtCharge vue="charge" />}
    </Page>
  )
}
