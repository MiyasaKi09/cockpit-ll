// ============================================================
// Planning — le Gantt vivant de l'agence : une barre par phase,
// 12 mois visibles, la ligne « aujourd'hui ». Pensé pour le réel
// du chantier : un retard ? deux clics (◀ ▶ ±1 semaine) et tout
// ce qui suit glisse avec. Bouton Imprimer/PDF → une page A4
// paysage propre à envoyer à tout le monde.
// ============================================================

import { useState } from 'react'
import type { AppState, MarcheTravaux, PhaseCode, Projet } from '../types'
import { useStore } from '../store'
import { Badge, Btn, Card, DateInput, EmptyState, Field, NumInput, Page, Select, useToday } from '../ui'
import { addDays, diffDays, fmtDate, todayISO } from '../util'
import { LIBELLES_PHASES, PHASES_ORDRE } from '../miqcp'
import { daterPhases } from '../echeancier'
import { STATUTS_ACTIFS } from '../derive'

const COULEURS_PHASES = [
  '#0e7490', '#2563eb', '#7c3aed', '#0891b2', '#059669', '#ca8a04',
  '#ea580c', '#dc2626', '#9333ea', '#4f46e5', '#16a34a', '#b45309',
]

function couleurPhase(code: PhaseCode): string {
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

function EditionDates({ projet: p }: { projet: Projet }) {
  const { update } = useStore()
  const [propager, setPropager] = useState(true)
  const [debutEtudes, setDebutEtudes] = useState<string | null>(
    p.dateLancement ?? p.phases.find((ph) => ph.debut)?.debut ?? todayISO(),
  )
  const [dureeEtudes, setDureeEtudes] = useState<number | null>(8)
  const [dureeChantier, setDureeChantier] = useState<number | null>(12)

  const indexDe = (code: PhaseCode) => {
    const i = PHASES_ORDRE.indexOf(code)
    return i === -1 ? PHASES_ORDRE.length : i
  }

  const daterAuto = () => {
    if (!debutEtudes || !dureeEtudes || !dureeChantier) return
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (!pr) return
      pr.phases = daterPhases(pr.phases, debutEtudes, dureeEtudes, dureeChantier)
    })
  }

  const majDate = (code: PhaseCode, champ: 'debut' | 'fin', v: string | null) =>
    update((d) => {
      const ph = d.projets.find((x) => x.id === p.id)?.phases.find((x) => x.code === code)
      if (ph) ph[champ] = v
    })

  const decaler = (code: PhaseCode, jours: number) =>
    update((d) => {
      const pr = d.projets.find((x) => x.id === p.id)
      if (!pr) return
      const idx = indexDe(code)
      for (const ph of pr.phases) {
        if (ph.code === code || (propager && indexDe(ph.code) > idx)) {
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
      </div>
      <p className="muted small" style={{ margin: '8px 0' }}>
        Toutes les phases se placent d'un coup à partir de ces 3 repères (réparties au prorata des
        honoraires) — le projet tient sur une seule ligne. Ensuite, ◀ ▶ décale une phase d'une
        semaine ; avec la case cochée, tout ce qui suit glisse d'autant. Planning et échéancier de
        facturation restent alignés sur ces dates.
      </p>
      <table className="table table-compact">
        <thead>
          <tr>
            <th>Phase</th>
            <th>Début</th>
            <th>Fin</th>
            <th>Décaler</th>
          </tr>
        </thead>
        <tbody>
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
        </tbody>
      </table>
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
// Planning CHANTIER — une barre par lot / entreprise sur sa
// période d'intervention. Le vrai planning travaux, à envoyer
// aux entreprises et à faire glisser au fil du chantier.
// ============================================================

interface LigneChantier {
  marche: MarcheTravaux
  projet: Projet
  couleur: string
}

/** lots datés des projets retenus, triés par projet puis début d'intervention */
function lignesChantier(state: AppState, projets: Projet[]): LigneChantier[] {
  const lignes: LigneChantier[] = []
  for (const p of projets) {
    const lots = state.marches
      .filter((m) => m.projetId === p.id && (m.dateDebut || m.dateFin))
      .sort((a, b) => (a.dateDebut || a.dateFin || '').localeCompare(b.dateDebut || b.dateFin || ''))
    lots.forEach((m, i) => lignes.push({ marche: m, projet: p, couleur: couleurLot(i) }))
  }
  return lignes
}

/** projets actifs ayant au moins un lot daté */
function projetsAvecChantier(state: AppState): Projet[] {
  return state.projets.filter(
    (p) => STATUTS_ACTIFS.includes(p.statut) && state.marches.some((m) => m.projetId === p.id && (m.dateDebut || m.dateFin)),
  )
}

function BarreChantier({ ligne, fenetre: f }: { ligne: LigneChantier; fenetre: Fenetre }) {
  const { marche: m } = ligne
  const debut = m.dateDebut || m.dateFin!
  const fin = m.dateFin || m.dateDebut!
  if (fin < f.debut || debut >= f.fin) return <div style={{ height: 26 }} />
  const gauche = pos(f, debut)
  const largeur = Math.max(1.4, pos(f, addDays(fin, 1)) - gauche)
  return (
    <div style={{ position: 'relative', height: 26, background: 'var(--bg-soft, #f6f7fa)', borderRadius: 5 }}>
      <div
        title={`${m.lot} — ${m.entreprise}\n${fmtDate(debut)} → ${fmtDate(fin)}`}
        style={{
          position: 'absolute',
          left: `${gauche}%`,
          width: `${largeur}%`,
          top: 3,
          bottom: 3,
          background: ligne.couleur,
          borderRadius: 4,
          color: '#fff',
          fontSize: 10,
          fontWeight: 700,
          lineHeight: '20px',
          paddingLeft: 5,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {m.entreprise}
      </div>
    </div>
  )
}

/** édition rapide des dates de chantier — un lot glisse, les suivants suivent */
function EditionChantier({ projet: p }: { projet: Projet }) {
  const { state, update } = useStore()
  const [propager, setPropager] = useState(true)
  const lots = state.marches
    .filter((m) => m.projetId === p.id)
    .sort((a, b) => (a.dateDebut || '9999').localeCompare(b.dateDebut || '9999'))

  const majDate = (id: string, champ: 'dateDebut' | 'dateFin', v: string | null) =>
    update((d) => {
      const m = d.marches.find((x) => x.id === id)
      if (m) m[champ] = v
    })

  const decaler = (id: string, jours: number) =>
    update((d) => {
      const ref = d.marches.find((x) => x.id === id)
      if (!ref) return
      const seuil = ref.dateDebut || ref.dateFin || ''
      for (const m of d.marches) {
        if (m.projetId !== p.id) continue
        const aDate = m.dateDebut || m.dateFin || ''
        if (m.id === id || (propager && aDate >= seuil)) {
          if (m.dateDebut) m.dateDebut = addDays(m.dateDebut, jours)
          if (m.dateFin) m.dateFin = addDays(m.dateFin, jours)
        }
      }
    })

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
            tous les lots qui démarrent après glissent aussi. Les dates se saisissent aussi dans la
            fiche marché (onglet Chantier).
          </p>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Lot · entreprise</th>
                <th>Début</th>
                <th>Fin</th>
                <th>Décaler</th>
              </tr>
            </thead>
            <tbody>
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
                      <Btn small onClick={() => decaler(m.id, -7)}>◀ 1 sem</Btn>
                      <Btn small onClick={() => decaler(m.id, 7)}>1 sem ▶</Btn>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  )
}

function ouvrirChantierPDF(state: AppState, lignes: LigneChantier[], f: Fenetre, today: string): void {
  const mois: string[] = []
  for (let m = f.debut; m < f.fin; m = addMonths(m, 1)) mois.push(m)

  const rangs = lignes
    .map((l) => {
      const m = l.marche
      const debut = m.dateDebut || m.dateFin!
      const fin = m.dateFin || m.dateDebut!
      const visible = fin >= f.debut && debut < f.fin
      const gauche = pos(f, debut)
      const largeur = Math.max(1.2, pos(f, addDays(fin, 1)) - gauche)
      const barre = visible
        ? `<div style="position:absolute;left:${gauche}%;width:${largeur}%;top:3px;bottom:3px;background:${l.couleur};border-radius:3px;color:#fff;font-size:9px;font-weight:700;line-height:20px;padding-left:4px;overflow:hidden;white-space:nowrap">${echapper(m.entreprise)}</div>`
        : ''
      const contact = m.contactNom || m.contactEmail ? `<div style="font-size:9px;color:#5a6478">${echapper([m.contactNom, m.contactEmail].filter(Boolean).join(' · '))}</div>` : ''
      return `<tr>
        <td style="width:240px;padding:4px 8px;border-bottom:1px solid #e3e6ec;font-size:11px"><strong>${echapper(m.lot)}</strong> — ${echapper(m.entreprise)}${contact}</td>
        <td style="padding:0;border-bottom:1px solid #e3e6ec"><div style="position:relative;height:26px;background:#f6f7fa">${barre}
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

  const projets = [...new Set(lignes.map((l) => `${l.projet.id} — ${l.projet.nom}`))].join(' · ')

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
<div class="muted">${echapper(projets)}<br>Édité le ${fmtDate(today)} · fenêtre ${fmtDate(f.debut)} → ${fmtDate(addDays(f.fin, -1))} · trait rouge = aujourd'hui · document indicatif, ajusté au fil du chantier</div>
<table>
  <tr><td style="width:240px"></td><td style="padding:0"><div style="position:relative;height:18px">${enTetesMois}</div></td></tr>
  ${rangs}
</table>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

// ---------- page ----------

type Mode = 'phases' | 'chantier'

export default function Planning() {
  const { state } = useStore()
  const today = useToday()
  const [mode, setMode] = useState<Mode>('phases')
  const [filtre, setFiltre] = useState('')
  const [debutF, setDebutF] = useState(() => addMonths(debutMois(todayISO()), -1))

  const tousPhases = projetsPlanifies(state)
  const tousChantier = projetsAvecChantier(state)
  const tous = mode === 'phases' ? tousPhases : tousChantier
  const projets = filtre ? tous.filter((p) => p.id === filtre) : tous
  const f = fenetreDe(debutF, 12)

  const lignesCh = mode === 'chantier' ? lignesChantier(state, projets) : []

  const mois: string[] = []
  for (let m = f.debut; m < f.fin; m = addMonths(m, 1)) mois.push(m)

  const calerSurProjets = () => {
    const debuts =
      mode === 'phases'
        ? tousPhases.flatMap((p) => p.phases.filter((ph) => ph.debut).map((ph) => ph.debut!))
        : state.marches.filter((m) => tousChantier.some((p) => p.id === m.projetId) && m.dateDebut).map((m) => m.dateDebut!)
    if (debuts.length > 0) setDebutF(debutMois(debuts.sort()[0]))
  }

  const projetSelectionne = filtre ? state.projets.find((p) => p.id === filtre) : undefined

  const exporterPDF = () =>
    mode === 'phases' ? ouvrirPlanningPDF(state, projets, f, today) : ouvrirChantierPDF(state, lignesCh, f, today)

  const changerMode = (m: Mode) => {
    setMode(m)
    setFiltre('')
  }

  const vide = mode === 'phases' ? projets.length === 0 : lignesCh.length === 0

  return (
    <Page
      titre="Planning"
      sousTitre="Le Gantt vivant de l'agence — phases de conception ou lots de chantier. La ligne rouge marque aujourd'hui, tout glisse en deux clics, Imprimer/PDF pour diffuser."
      actions={
        <Btn kind="primary" onClick={exporterPDF} disabled={vide}>
          🖨 Imprimer / PDF
        </Btn>
      }
    >
      <div className="toolbar" style={{ marginBottom: 4 }}>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <button className={`btn btn-small ${mode === 'phases' ? 'btn-primary' : ''}`} onClick={() => changerMode('phases')}>
            Phases (conception)
          </button>
          <button className={`btn btn-small ${mode === 'chantier' ? 'btn-primary' : ''}`} onClick={() => changerMode('chantier')}>
            Chantier (entreprises)
          </button>
        </span>
      </div>

      <div className="toolbar">
        <Btn onClick={() => setDebutF(addMonths(debutF, -1))}>‹</Btn>
        <Btn onClick={() => setDebutF(addMonths(debutF, 1))}>›</Btn>
        <Btn onClick={() => setDebutF(addMonths(debutMois(todayISO()), -1))}>Aujourd'hui</Btn>
        <Btn kind="ghost" onClick={calerSurProjets}>Caler sur les projets</Btn>
        <Select
          value={filtre}
          onChange={setFiltre}
          options={[{ value: '', label: mode === 'phases' ? 'Tous les projets actifs' : 'Tous les chantiers' }, ...tous.map((p) => ({ value: p.id, label: `${p.id} — ${p.nom}` }))]}
          style={{ maxWidth: 280 }}
        />
        <span className="muted small">
          {fmtDate(f.debut)} → {fmtDate(addDays(f.fin, -1))}
        </span>
      </div>

      <Card>
        {mode === 'phases' ? (
          projets.length === 0 ? (
            <EmptyState>
              Aucun projet actif avec des phases datées — utilisez « Dater les phases automatiquement »
              après avoir sélectionné un projet ci-dessous.
            </EmptyState>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', rowGap: 8, alignItems: 'center' }}>
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
          )
        ) : lignesCh.length === 0 ? (
          <EmptyState>
            Aucun lot de chantier daté — renseignez les dates d'intervention des marchés dans l'onglet
            Chantier d'un projet, ou via « Ajuster le planning chantier » après avoir choisi un projet.
          </EmptyState>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', rowGap: 6, alignItems: 'center' }}>
            <div />
            <div style={{ position: 'relative', height: 20 }}>
              {mois.map((m) => (
                <div key={m} className="muted small" style={{ position: 'absolute', left: `${pos(f, m)}%`, top: 0, bottom: 0, borderLeft: '1px solid var(--line)', paddingLeft: 4 }}>
                  {NOMS_MOIS_COURTS[Number(m.slice(5, 7)) - 1]} {m.slice(2, 4)}
                </div>
              ))}
            </div>
            {lignesCh.map((l) => (
              <div key={l.marche.id} style={{ display: 'contents' }}>
                <div className="small" style={{ paddingRight: 8 }}>
                  {!filtre && <span className="muted">{l.projet.id} · </span>}
                  <strong>{l.marche.lot}</strong>
                  <div className="muted" title={l.marche.entreprise}>
                    {l.marche.entreprise.length > 24 ? l.marche.entreprise.slice(0, 24) + '…' : l.marche.entreprise}
                    {' '}
                    <button className="btn btn-small btn-ghost" onClick={() => setFiltre(filtre === l.projet.id ? '' : l.projet.id)} title="Ajuster le planning de ce chantier">
                      {filtre === l.projet.id ? 'fermer' : 'ajuster'}
                    </button>
                  </div>
                </div>
                <div style={{ position: 'relative' }}>
                  <BarreChantier ligne={l} fenetre={f} />
                  {today >= f.debut && today < f.fin && (
                    <div style={{ position: 'absolute', left: `${pos(f, today)}%`, top: -3, bottom: -3, width: 2, background: 'var(--danger)' }} title={`aujourd'hui — ${fmtDate(today)}`} />
                  )}
                </div>
              </div>
            ))}
          </div>
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

      {projetSelectionne && mode === 'phases' && <EditionDates projet={projetSelectionne} />}
      {projetSelectionne && mode === 'chantier' && <EditionChantier projet={projetSelectionne} />}
    </Page>
  )
}
