// Recherche globale — les liens dans tous les sens : un produit,
// une entreprise, un contact, un mot du journal… → tout ce qui y
// touche, avec le chemin vers chaque fiche. Réponse notamment à
// « sur quels projets a-t-on utilisé tel matériau / telle
// entreprise ? » via les rattachements de l'espace projet.

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import type { AppState } from '../types'
import { Badge, Card, EmptyState, Page, TextInput } from '../ui'
import { fmtDate, fmtMoney, fold } from '../util'

interface Resultat {
  groupe: string
  titre: string
  detail?: string
  lien: string
  /** projets reliés (les liens inverses) */
  projets?: string[]
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
        lien: '#/references',
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
        lien: '#/ao',
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

export default function Recherche() {
  const { state } = useStore()
  const [q, setQ] = useState('')

  const resultats = useMemo(() => (q.trim().length >= 2 ? chercher(state, q) : []), [state, q])
  const groupes = useMemo(() => {
    const map = new Map<string, Resultat[]>()
    for (const r of resultats) {
      map.set(r.groupe, [...(map.get(r.groupe) || []), r])
    }
    return [...map.entries()]
  }, [resultats])

  return (
    <Page
      titre="Recherche"
      sousTitre="Cherchez un matériau, une entreprise, un contact… et retrouvez les projets liés."
    >
      <div className="toolbar">
        <TextInput
          value={q}
          onChange={setQ}
          placeholder="Ex. « chanvre », « Martin BTP », « acrotère »…"
          style={{ width: 420, fontSize: 15 }}
        />
        {q.trim().length >= 2 && (
          <span className="muted small">
            {resultats.length} résultat{resultats.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {q.trim().length < 2 ? (
        <Card>
          <EmptyState>Tapez au moins 2 caractères.</EmptyState>
        </Card>
      ) : resultats.length === 0 ? (
        <Card>
          <EmptyState>Aucun résultat pour « {q} ».</EmptyState>
        </Card>
      ) : (
        groupes.map(([groupe, items]) => (
          <Card key={groupe} titre={`${groupe} (${items.length})`}>
            {items.map((r, i) => (
              <div key={i} className="alert-item">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="alert-titre">
                    <a href={r.lien}>{r.titre}</a>
                  </div>
                  {r.detail && <div className="alert-detail">{r.detail}</div>}
                </div>
                {r.projets && r.projets.length > 0 && (
                  <div className="alert-actions" style={{ flexWrap: 'wrap', maxWidth: 220, justifyContent: 'flex-end' }}>
                    {r.projets.map((pid) => (
                      <a key={pid} href={`#/projets/${pid}`} className="badge badge-info">
                        {pid}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Card>
        ))
      )}
    </Page>
  )
}
