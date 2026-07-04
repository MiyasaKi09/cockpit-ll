// Génération de PDF côté client, sans dépendance : une vue
// imprimable propre s'ouvre et le navigateur « Enregistre en
// PDF » (Ctrl+P). Déterministe, zéro service externe.

import type { AppState, Facture } from './types'
import { encaissementPrevu, projetById, ttc } from './derive'
import { fmtDate, fmtMoney } from './util'

function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** ouvre la facture dans une fenêtre imprimable (→ PDF via Ctrl+P) */
export function ouvrirFacturePDF(state: AppState, f: Facture): void {
  const p = projetById(state, f.projetId)
  const s = state.settings
  const tva = f.montantHT * f.tauxTVA
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Facture ${echapper(f.id)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1a2233; margin: 48px; font-size: 14px; }
  header { display: flex; justify-content: space-between; margin-bottom: 36px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .muted { color: #5a6478; }
  .bloc { margin: 22px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; border-bottom: 2px solid #1a2233; padding: 8px 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  td { padding: 10px 6px; border-bottom: 1px solid #e3e6ec; }
  td.r, th.r { text-align: right; }
  .total td { border-bottom: none; font-weight: 700; font-size: 16px; }
  .mentions { margin-top: 40px; font-size: 11px; color: #5a6478; line-height: 1.6; }
  .impression { position: fixed; top: 12px; right: 12px; }
  @media print { .impression { display: none; } body { margin: 24px; } }
</style></head><body>
<button class="impression" onclick="window.print()">Imprimer / PDF</button>
<header>
  <div>
    <h1>${echapper(s.nomAgence)}</h1>
    <div class="muted">Architecture — maîtrise d'œuvre<br>${echapper(s.personnes.join(' · '))}</div>
  </div>
  <div style="text-align:right">
    <h1>Facture ${echapper(f.id)}</h1>
    <div class="muted">Émise le ${fmtDate(f.emission)}<br>Échéance : ${fmtDate(encaissementPrevu(f))} (${f.delaiJours} jours)</div>
  </div>
</header>

<div class="bloc">
  <strong>Maître d'ouvrage</strong><br>
  ${echapper(p?.moa || '—')}${p?.emailMOA ? `<br><span class="muted">${echapper(p.emailMOA)}</span>` : ''}
</div>

<div class="bloc">
  <strong>Opération</strong><br>
  ${echapper(p ? `${p.id} — ${p.nom}` : f.projetId)}${p?.adresse ? `<br><span class="muted">${echapper(p.adresse)}</span>` : ''}
</div>

<table>
  <thead><tr><th>Désignation</th><th class="r">Montant HT</th><th class="r">TVA (${Math.round(f.tauxTVA * 100)} %)</th><th class="r">Montant TTC</th></tr></thead>
  <tbody>
    <tr>
      <td>${echapper(f.libelle)}<br><span class="muted">Phase ${echapper(f.phase)} — honoraires de maîtrise d'œuvre</span></td>
      <td class="r">${fmtMoney(f.montantHT, true)}</td>
      <td class="r">${fmtMoney(tva, true)}</td>
      <td class="r">${fmtMoney(ttc(f), true)}</td>
    </tr>
    <tr class="total">
      <td>Net à payer</td><td></td><td></td>
      <td class="r">${fmtMoney(ttc(f), true)}</td>
    </tr>
  </tbody>
</table>

<div class="mentions">
  TVA sur les encaissements (prestations de services). Paiement à ${f.delaiJours} jours.
  Tout retard de paiement entraîne de plein droit des pénalités au taux légal en vigueur ainsi
  qu'une indemnité forfaitaire de recouvrement de 40 € (art. L441-10 du Code de commerce) pour
  les professionnels. Escompte pour paiement anticipé : néant.<br>
  Document généré par le Cockpit ${echapper(s.nomAgence)} — à vérifier avant envoi (coordonnées
  bancaires et mentions légales complètes à ajouter selon votre papeterie).
</div>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}
