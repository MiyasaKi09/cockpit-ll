// Génération de PDF côté client, sans dépendance : une vue
// imprimable propre s'ouvre et le navigateur « Enregistre en
// PDF » (Ctrl+P). Déterministe, zéro service externe.

import type { AppState, Facture, Situation } from './types'
import {
  analyserPeriode,
  caCible,
  caParMois,
  caRealiseAnnee,
  coutJourObjectif,
  decompteSituation,
  encaissementPrevu,
  nomProjet,
  projetById,
  tempsParPersonne,
  ttc,
} from './derive'
import { fmtDate, fmtMois, fmtMoney, fmtPct } from './util'

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
    <div class="muted">Architecture — maîtrise d'œuvre<br>${echapper(s.personnes.join(' · '))}${s.adresseAgence ? `<br>${echapper(s.adresseAgence)}` : ''}${s.siretAgence ? `<br>SIRET ${echapper(s.siretAgence)}` : ''}${s.numeroTVA ? ` · TVA ${echapper(s.numeroTVA)}` : ''}</div>
  </div>
  <div style="text-align:right">
    <h1>Facture ${echapper(f.id)}</h1>
    <div class="muted">Émise le ${fmtDate(f.emission)}<br>Échéance : ${fmtDate(encaissementPrevu(f))} (${f.delaiJours} jours)</div>
  </div>
</header>

<div class="bloc">
  <strong>Maître d'ouvrage</strong><br>
  ${echapper(p?.moa || '—')}${p?.siretClient ? `<br><span class="muted">SIRET ${echapper(p.siretClient)}</span>` : ''}${p?.emailMOA ? `<br><span class="muted">${echapper(p.emailMOA)}</span>` : ''}
</div>

<div class="bloc">
  <strong>Opération</strong><br>
  ${echapper(p ? `${p.id} — ${p.nom}` : f.projetId)}${p?.adresse ? `<br><span class="muted">${echapper(p.adresse)}</span>` : ''}${p?.objetFacture ? `<br><span class="muted">${echapper(p.objetFacture)}</span>` : ''}${p?.numeroEngagement ? `<br><span class="muted">N° d'engagement / marché : ${echapper(p.numeroEngagement)}</span>` : ''}
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

${s.iban ? `<div class="bloc"><strong>Règlement par virement</strong><br>
  ${s.banque ? `${echapper(s.banque)}<br>` : ''}IBAN ${echapper(s.iban)}${s.bic ? ` · BIC ${echapper(s.bic)}` : ''}</div>` : ''}

<div class="mentions">
  TVA sur les encaissements (prestations de services). Paiement à ${f.delaiJours} jours.
  Tout retard de paiement entraîne de plein droit des pénalités au taux légal en vigueur ainsi
  qu'une indemnité forfaitaire de recouvrement de 40 € (art. L441-10 du Code de commerce) pour
  les professionnels. Escompte pour paiement anticipé : néant.<br>
  ${[echapper(s.nomAgence), s.capitalSocial ? `SAS au capital de ${echapper(s.capitalSocial)}` : '', s.rcs ? `RCS ${echapper(s.rcs)}` : '', s.siretAgence ? `SIRET ${echapper(s.siretAgence)}` : ''].filter(Boolean).join(' · ')}
  ${!s.iban ? '<br>Coordonnées bancaires à compléter dans Paramètres.' : ''}
</div>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

/** ouvre le décompte / certificat de paiement d'une situation (→ PDF via Ctrl+P).
 *  Document que la MOE remet à l'entreprise : net à payer = cumul (+ révision)
 *  − retenue de garantie − déjà réglé. Tout est calculé en dur. */
export function ouvrirDecompteSituationPDF(state: AppState, sit: Situation): void {
  const s = state.settings
  const d = decompteSituation(state, sit)
  const p = projetById(state, sit.projetId)
  const num = sit.numero != null ? `n° ${sit.numero}` : ''
  const ligne = (libelle: string, montant: number, opts: { fort?: boolean; retrait?: boolean } = {}) =>
    `<tr${opts.fort ? ' class="fort"' : ''}><td${opts.retrait ? ' style="padding-left:24px"' : ''}>${libelle}</td><td class="r">${fmtMoney(montant, true)}</td></tr>`

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Décompte situation — ${echapper(sit.entreprise)} ${echapper(fmtMois(sit.mois))}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1a2233; margin: 48px; font-size: 14px; }
  header { display: flex; justify-content: space-between; margin-bottom: 30px; }
  h1 { font-size: 21px; margin: 0 0 4px; }
  .muted { color: #5a6478; }
  .bloc { margin: 18px 0; }
  table.dc { width: 100%; border-collapse: collapse; margin-top: 12px; }
  table.dc td { padding: 9px 6px; border-bottom: 1px solid #e3e6ec; }
  table.dc td.r { text-align: right; font-variant-numeric: tabular-nums; }
  table.dc tr.fort td { font-weight: 700; border-bottom: 2px solid #1a2233; }
  .net { margin-top: 18px; padding: 14px 16px; background: #f2f6ff; border-radius: 8px; display: flex; justify-content: space-between; align-items: baseline; }
  .net .v { font-size: 22px; font-weight: 800; }
  .warn { margin-top: 16px; padding: 10px 12px; background: #fff5f5; border-left: 3px solid #bb2233; color: #922; font-size: 12px; border-radius: 4px; }
  .sign { margin-top: 44px; display: flex; justify-content: space-between; font-size: 12px; color: #5a6478; }
  .sign .box { width: 44%; }
  .sign .line { margin-top: 40px; border-top: 1px solid #97a0b0; padding-top: 4px; }
  .impression { position: fixed; top: 12px; right: 12px; }
  @media print { .impression { display: none; } body { margin: 24px; } }
</style></head><body>
<button class="impression" onclick="window.print()">Imprimer / PDF</button>
<header>
  <div>
    <h1>${echapper(s.nomAgence)}</h1>
    <div class="muted">Maîtrise d'œuvre — vérification des situations<br>${echapper(s.personnes.join(' · '))}${s.siretAgence ? `<br>SIRET ${echapper(s.siretAgence)}` : ''}</div>
  </div>
  <div style="text-align:right">
    <h1>Décompte de situation ${echapper(num)}</h1>
    <div class="muted">Mois ${echapper(fmtMois(sit.mois))}<br>Établi le ${fmtDate(sit.dateReception)}</div>
  </div>
</header>

<div class="bloc">
  <strong>Entreprise</strong> — ${echapper(sit.entreprise)}${sit.lot ? ` · ${echapper(sit.lot)}` : ''}${d.marche ? `<br><span class="muted">Marché : ${fmtMoney(d.marche.montantInitialHT + d.marche.avenantsHT, false)} HT (RG ${fmtPct(d.tauxRG, 0)}${d.marche.revision ? ' · révisable' : ''})</span>` : '<br><span class="muted">Situation non rattachée à un marché — RG à 0 %.</span>'}
</div>
<div class="bloc">
  <strong>Opération</strong> — ${echapper(p ? `${p.id} — ${p.nom}` : nomProjet(state, sit.projetId))}${p?.adresse ? `<br><span class="muted">${echapper(p.adresse)}</span>` : ''}
</div>

<table class="dc">
  ${ligne('Travaux exécutés cumulés HT', d.travauxCumulHT)}
  ${d.revisionHT ? ligne('Révision de prix HT', d.revisionHT) : ''}
  ${ligne('Montant cumulé HT (base)', d.baseHT, { fort: true })}
  ${ligne(`Retenue de garantie (${fmtPct(d.tauxRG, 0)})`, -d.retenueGarantieHT, { retrait: true })}
  ${ligne('Cumul net de RG HT', d.cumulNetHT, { fort: true })}
  ${ligne('À déduire : situations précédentes (net)', -d.precedentNetHT, { retrait: true })}
  ${ligne('Net à payer ce mois HT', d.netAPayerHT, { fort: true })}
  ${ligne(`TVA (${fmtPct(d.tauxTVA, 0)})`, d.netAPayerTTC - d.netAPayerHT, { retrait: true })}
</table>

<div class="net"><span>Net à payer ce mois <strong>TTC</strong></span><span class="v">${fmtMoney(d.netAPayerTTC, true)}</span></div>

${d.coherences.length > 0 ? `<div class="warn"><strong>Points à vérifier :</strong><br>${d.coherences.map((c) => echapper(c)).join('<br>')}</div>` : ''}

<div class="sign">
  <div class="box">Situation présentée par l'entreprise<div class="line">Date & signature</div></div>
  <div class="box">Certifié par la maîtrise d'œuvre — ${echapper(s.nomAgence)}<div class="line">Date & signature</div></div>
</div>
<div class="muted" style="margin-top:24px;font-size:11px">Document indicatif établi par la maîtrise d'œuvre pour proposition de paiement au maître d'ouvrage. La retenue de garantie est libérée à la levée des réserves (délai de garantie de parfait achèvement), sauf caution de substitution.</div>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

const MOIS_PDF = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/** Revue de pilotage imprimable (→ PDF via Ctrl+P) : synthèse CA / marge / temps sur une période. */
export function ouvrirRevuePDF(state: AppState, debut: string, fin: string): void {
  const s = state.settings
  const syn = analyserPeriode(state, debut, fin)
  const tpp = tempsParPersonne(state, debut, fin)
  const annee = Number(debut.slice(0, 4))
  const cam = caParMois(state, annee)
  const caRealise = caRealiseAnnee(state, annee)
  const cible = caCible(state)
  const objectif = coutJourObjectif(state)
  const encaisse = state.factures
    .filter((f) => f.statut === 'encaissee' && f.encaissementReel && f.encaissementReel >= debut && f.encaissementReel <= fin)
    .reduce((acc, f) => acc + f.montantHT, 0)
  const marge = syn.totalCA - syn.totalCoutTemps - syn.totalCoutExterne
  const euroJour = syn.parJourMoyen

  const cell = (v: number) => `<td class="r">${v > 0 ? fmtMoney(v) : '·'}</td>`
  const kpi = (label: string, valeur: string) =>
    `<div class="kpi"><div class="kl">${echapper(label)}</div><div class="kv">${valeur}</div></div>`

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Revue de pilotage — ${fmtDate(debut)} au ${fmtDate(fin)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1a2233; margin: 40px; font-size: 13px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  h1 { font-size: 21px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 26px 0 8px; text-transform: uppercase; letter-spacing: .05em; border-bottom: 2px solid #1a2233; padding-bottom: 4px; }
  .muted { color: #5a6478; }
  .kpis { display: flex; gap: 12px; margin-top: 8px; }
  .kpi { flex: 1; border: 2px solid #1a2233; padding: 10px 12px; }
  .kpi .kl { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #5a6478; }
  .kpi .kv { font-size: 19px; font-weight: 800; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
  th { text-align: left; border-bottom: 2px solid #1a2233; padding: 6px 5px; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  td { padding: 6px 5px; border-bottom: 1px solid #e3e6ec; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  tr.tot td { font-weight: 700; }
  .impression { position: fixed; top: 12px; right: 12px; }
  @media print { .impression { display: none; } body { margin: 18px; } }
</style></head><body>
<button class="impression" onclick="window.print()">Imprimer / PDF</button>
<header>
  <div><h1>Revue de pilotage — ${echapper(s.nomAgence)}</h1>
    <div class="muted">Période du ${fmtDate(debut)} au ${fmtDate(fin)} · ${echapper(s.personnes.join(' · '))}</div>
  </div>
  <div class="muted" style="text-align:right">Éditée le ${fmtDate(fin)}</div>
</header>

<div class="kpis">
  ${kpi('CA émis (période)', fmtMoney(syn.totalCA))}
  ${kpi('Encaissé (période)', fmtMoney(encaisse))}
  ${kpi('Marge réelle', fmtMoney(marge))}
  ${kpi('€ / jour réel', euroJour !== null ? `${fmtMoney(euroJour)} <span style="font-size:11px;font-weight:400" class="muted">/ obj. ${fmtMoney(objectif)}</span>` : '—')}
</div>
${cible > 0 ? `<p class="muted" style="margin-top:10px">Objectif ${annee} : ${fmtMoney(caRealise)} / ${fmtMoney(cible)} HT (${fmtPct(cible > 0 ? caRealise / cible : 0, 0)}) — reste ${fmtMoney(Math.max(0, cible - caRealise))}.</p>` : ''}

<h2>Marge par mission (période)</h2>
${
    syn.lignes.length === 0
      ? '<p class="muted">Aucune facture émise ni heure pointée sur la période.</p>'
      : `<table><thead><tr><th>Mission</th><th class="r">CA HT</th><th class="r">Coût temps</th><th class="r">Marge</th><th class="r">Jours</th><th class="r">€/jour</th></tr></thead><tbody>
    <tr class="tot"><td>Total / moyenne</td><td class="r">${fmtMoney(syn.totalCA)}</td><td class="r">${fmtMoney(syn.totalCoutTemps)}</td><td class="r">${fmtMoney(marge)}</td><td class="r">${Math.round(syn.totalJours)}</td><td class="r">${euroJour !== null ? fmtMoney(euroJour) : '—'}</td></tr>
    ${syn.lignes
      .map(
        (l) =>
          `<tr><td>${echapper(nomProjet(state, l.projetId))}</td><td class="r">${fmtMoney(l.ca)}</td><td class="r">${fmtMoney(l.coutTemps)}</td><td class="r">${fmtMoney(l.margeReelle)}</td><td class="r">${Math.round(l.jours * 10) / 10}</td><td class="r">${l.parJour !== null ? fmtMoney(l.parJour) : '—'}</td></tr>`,
      )
      .join('')}
  </tbody></table>`
  }

<h2>Temps pointé par personne (période)</h2>
${
    tpp.length === 0
      ? '<p class="muted">Aucune heure pointée sur la période.</p>'
      : `<table><thead><tr><th>Personne</th><th class="r">Heures</th><th class="r">Jours</th><th class="r">Coût réel</th></tr></thead><tbody>
    ${tpp.map((l) => `<tr><td>${echapper(l.personne)}</td><td class="r">${Math.round(l.heures)} h</td><td class="r">${Math.round(l.jours * 10) / 10}</td><td class="r">${fmtMoney(l.cout)}</td></tr>`).join('')}
  </tbody></table>`
  }

<h2>CA facturé par mois — ${annee}</h2>
<table><thead><tr><th>Mission</th>${MOIS_PDF.map((m) => `<th class="r">${m}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
  <tr class="tot"><td>Total émis HT</td>${cam.emisParMois.map(cell).join('')}<td class="r">${fmtMoney(cam.emisParMois.reduce((a, x) => a + x, 0))}</td></tr>
  <tr class="muted"><td>dont encaissé</td>${cam.encaisseParMois.map(cell).join('')}<td class="r">${fmtMoney(cam.encaisseParMois.reduce((a, x) => a + x, 0))}</td></tr>
  <tr class="muted"><td>à venir (prévu)</td>${cam.prevuParMois.map(cell).join('')}<td class="r">${fmtMoney(cam.prevuParMois.reduce((a, x) => a + x, 0))}</td></tr>
  ${cam.lignes.map((l) => `<tr><td>${echapper(nomProjet(state, l.projetId))}</td>${l.mois.map(cell).join('')}<td class="r">${fmtMoney(l.total)}</td></tr>`).join('')}
</tbody></table>

<p class="muted" style="margin-top:22px;font-size:11px">Synthèse déterministe des données du cockpit (facturé par date d'émission, temps pointé, coûts réels par personne). Document interne de pilotage.</p>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}
