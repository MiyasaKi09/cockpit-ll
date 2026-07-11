// Recherche globale — palette de commandes (overlay « / »).
// Un matériau, une entreprise, un contact, un mot du journal… →
// tout ce qui y touche, avec le chemin vers chaque fiche et les
// projets reliés. Clavier : ↑ ↓ pour naviguer, Entrée pour ouvrir,
// Échap pour fermer. Les résultats sont de VRAIS liens (clavier,
// lecteur d'écran, clic molette) et les derniers éléments ouverts
// s'affichent avant la saisie.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { AppState } from '../types'
import { navigate } from '../ui'
import { LIBELLES_STATUT } from '../registre'
import { fmtDate, fmtMoney, fold } from '../util'

interface Resultat {
  groupe: string
  titre: string
  detail?: string
  lien: string
  /** projets reliés (les liens inverses) */
  projets?: string[]
}

// ---------- récents (localStorage, jamais synchronisé) ----------

const CLE_RECENTS = 'cockpit-ll-recherche-recents'

function lireRecents(): Resultat[] {
  try {
    const brut = localStorage.getItem(CLE_RECENTS)
    const liste = brut ? (JSON.parse(brut) as Resultat[]) : []
    return Array.isArray(liste) ? liste.filter((r) => r && typeof r.lien === 'string' && typeof r.titre === 'string') : []
  } catch {
    return []
  }
}

function pousserRecent(r: Resultat): void {
  try {
    const liste = [{ ...r, groupe: 'Récents' }, ...lireRecents().filter((x) => x.lien !== r.lien || x.titre !== r.titre)]
    localStorage.setItem(CLE_RECENTS, JSON.stringify(liste.slice(0, 8)))
  } catch {
    // stockage plein : les récents sont un confort, jamais bloquants
  }
}

function projetsUtilisantMateriau(state: AppState, id: string): string[] {
  return state.projets.filter((p) => p.materiauxIds.includes(id)).map((p) => p.id)
}

function projetsUtilisantArtisan(state: AppState, id: string, nom: string): string[] {
  const parRattachement = state.projets.filter((p) => p.artisanIds.includes(id)).map((p) => p.id)
  const parMarche = state.marches.filter((m) => fold(m.entreprise) === fold(nom)).map((m) => m.projetId)
  return [...new Set([...parRattachement, ...parMarche])]
}

function chercher(state: AppState, q: string): Resultat[] {
  const cible = fold(q)
  const hit = (...champs: (string | undefined | null)[]) =>
    fold(champs.filter(Boolean).join(' ')).includes(cible)
  const res: Resultat[] = []

  for (const p of state.projets) {
    if (hit(p.id, p.nom, p.moa, p.adresse, p.notes))
      res.push({
        groupe: 'Projets',
        titre: `${p.id} — ${p.nom}`,
        detail: [p.moa, p.statut].filter(Boolean).join(' · '),
        lien: `#/projets/${p.id}`,
      })
  }

  for (const d of state.registreDocuments) {
    if (d.statut === 'rejete') continue
    if (hit(d.titre, d.nomOriginal, d.cheminDrive, d.categorie))
      res.push({
        groupe: 'Documents',
        titre: d.titre,
        detail: [d.categorie, `v${d.version}`, LIBELLES_STATUT[d.statut]].join(' · '),
        lien: '#/documents/tous',
        projets: d.projetId ? [d.projetId] : undefined,
      })
  }

  for (const m of state.marches) {
    if (hit(m.entreprise, m.lot, m.contactNom, m.notes))
      res.push({
        groupe: 'Entreprises (marchés)',
        titre: `${m.entreprise} — ${m.lot}`,
        detail: `${fmtMoney(m.montantInitialHT + m.avenantsHT)} HT`,
        lien: `#/projets/${m.projetId}/chantier`,
        projets: [m.projetId],
      })
  }

  for (const a of state.artisans) {
    if (hit(a.nom, a.zone, a.notes, ...a.lots))
      res.push({
        groupe: 'Artisans',
        titre: a.nom,
        detail: a.lots.join(', '),
        lien: `#/ressources/artisan/${a.id}`,
        projets: projetsUtilisantArtisan(state, a.id, a.nom),
      })
  }

  for (const m of state.materiaux) {
    if (hit(m.nom, m.fournisseur, m.notes, ...m.tags))
      res.push({
        groupe: 'Matériaux',
        titre: m.nom,
        detail: m.tags.join(', '),
        lien: `#/ressources/materiau/${m.id}`,
        projets: projetsUtilisantMateriau(state, m.id),
      })
  }

  for (const c of state.contacts) {
    if (hit(c.nom, c.organisme, c.email, c.notes, c.role))
      res.push({
        groupe: 'Contacts',
        titre: `${c.nom}${c.organisme ? ` (${c.organisme})` : ''}`,
        detail: c.email,
        lien: '#/agenda',
      })
  }

  for (const r of state.references) {
    if (hit(r.nom, r.lieu, r.moa, r.mission, r.notes, ...(r.motsCles || [])))
      res.push({
        groupe: 'Références',
        titre: r.nom,
        detail: [r.lieu, r.annee ? String(r.annee) : null].filter(Boolean).join(' · '),
        lien: '#/ao/references',
      })
  }

  for (const p of state.projets) {
    for (const n of p.journal) {
      if (hit(n.texte, ...n.tags))
        res.push({
          groupe: 'Journal (notes)',
          titre: `${p.id} · ${fmtDate(n.date)} — ${n.texte.slice(0, 80)}${n.texte.length > 80 ? '…' : ''}`,
          detail: n.tags.map((t) => `#${t}`).join(' '),
          lien: `#/projets/${p.id}/journal`,
          projets: [p.id],
        })
    }
  }

  for (const f of state.factures) {
    if (hit(f.id, f.libelle))
      res.push({
        groupe: 'Factures',
        titre: `${f.id} — ${f.libelle}`,
        detail: `${f.projetId} · ${fmtMoney(f.montantHT)} HT`,
        lien: '#/facturation',
        projets: [f.projetId],
      })
  }

  for (const s of state.situations) {
    if (hit(s.entreprise, s.lot, s.notes))
      res.push({
        groupe: 'Situations',
        titre: `${s.entreprise} — ${s.mois}`,
        detail: s.montantMoisHT !== null ? `${fmtMoney(s.montantMoisHT)} HT` : undefined,
        lien: '#/situations',
        projets: s.projetId ? [s.projetId] : [],
      })
  }

  for (const c of state.consultations) {
    if (hit(c.intitule, c.acheteur, c.lieu, c.typologie, c.notes))
      res.push({
        groupe: 'Consultations (AO)',
        titre: c.intitule,
        detail: c.acheteur,
        lien: '#/ao/consultations',
      })
  }

  for (const c of state.courriers) {
    if (hit(c.de, c.objet, c.resume))
      res.push({
        groupe: 'Courriers',
        titre: c.objet,
        detail: `de ${c.de}${c.statut === 'traite' ? ' · traité' : ''}`,
        lien: c.projetId ? `#/projets/${c.projetId}` : '#/',
        projets: c.projetId ? [c.projetId] : [],
      })
  }

  return res
}

export default function RechercheOverlay({ onClose }: { onClose: () => void }) {
  const { state } = useStore()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [recents] = useState<Resultat[]>(lireRecents)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const enSaisie = q.trim().length >= 2
  const resultats = useMemo(() => (enSaisie ? chercher(state, q) : []), [state, q, enSaisie])
  const groupes = useMemo(() => {
    if (!enSaisie) return recents.length > 0 ? ([['Récents', recents]] as [string, Resultat[]][]) : []
    const map = new Map<string, Resultat[]>()
    for (const r of resultats) map.set(r.groupe, [...(map.get(r.groupe) || []), r])
    return [...map.entries()]
  }, [resultats, enSaisie, recents])
  // liste à plat, dans l'ordre d'affichage, pour la navigation clavier
  const plat = useMemo(() => groupes.flatMap(([, items]) => items), [groupes])

  useEffect(() => {
    setSel(0)
  }, [q])

  const ouvrir = (r: Resultat) => {
    pousserRecent(r)
    navigate(r.lien)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, plat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && plat[sel]) {
      e.preventDefault()
      ouvrir(plat[sel])
    }
  }

  // garder l'élément sélectionné visible
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.cmdk-item.sel')
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  let index = -1

  return (
    <div className="cmdk-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="cmdk-panel"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Recherche globale"
      >
        <div className="cmdk-head">
          <input
            ref={inputRef}
            className="cmdk-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Rechercher — « chanvre », « Martin BTP », « acrotère »…"
            aria-label="Terme de recherche"
            role="combobox"
            aria-expanded={plat.length > 0}
            aria-controls="cmdk-liste"
            aria-activedescendant={plat[sel] ? `cmdk-opt-${sel}` : undefined}
          />
          {enSaisie && (
            <span className="cmdk-count">
              {resultats.length} résultat{resultats.length > 1 ? 's' : ''}
            </span>
          )}
          <button className="cmdk-fermer" onClick={onClose} aria-label="Fermer la recherche">
            ✕
          </button>
        </div>

        <div className="cmdk-results" ref={listRef} id="cmdk-liste" role="listbox" aria-label="Résultats">
          {groupes.length === 0 ? (
            <div className="cmdk-empty">
              {enSaisie
                ? `Aucun résultat pour « ${q} ».`
                : 'Tapez au moins 2 caractères. ↑ ↓ pour naviguer, Entrée pour ouvrir, Échap pour fermer.'}
            </div>
          ) : (
            groupes.map(([groupe, items]) => (
              <div key={groupe} className="cmdk-group">
                <div className="cmdk-group-titre">
                  {groupe} <span className="cmdk-group-nb">{items.length}</span>
                </div>
                {items.map((r) => {
                  index += 1
                  const i = index
                  return (
                    <a
                      key={i}
                      id={`cmdk-opt-${i}`}
                      href={r.lien}
                      role="option"
                      aria-selected={i === sel}
                      className={`cmdk-item ${i === sel ? 'sel' : ''}`}
                      onMouseEnter={() => setSel(i)}
                      onClick={(e) => {
                        e.preventDefault()
                        ouvrir(r)
                      }}
                    >
                      <div className="cmdk-item-main">
                        <div className="cmdk-item-titre">{r.titre}</div>
                        {r.detail && <div className="cmdk-item-detail">{r.detail}</div>}
                      </div>
                      {r.projets && r.projets.length > 0 && (
                        <div className="cmdk-item-projets">
                          {r.projets.map((pid) => (
                            <span key={pid} className="badge badge-info">
                              {pid}
                            </span>
                          ))}
                        </div>
                      )}
                    </a>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
