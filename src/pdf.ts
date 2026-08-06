// Génération de PDF côté client, sans dépendance : une vue
// imprimable propre s'ouvre et le navigateur « Enregistre en
// PDF » (Ctrl+P). Déterministe, zéro service externe.

import type {
  AppState,
  CertificatPaiement,
  Facture,
  FactureFigee,
  Projet,
  ReunionChantier,
  Situation,
} from './types'
// 5.15 — la mention d'exigibilité TVA est un RÉGLAGE (à confirmer avec le
// cabinet), jamais une phrase codée en dur : la coder ici imprimerait un
// régime fiscal faux le jour où le cabinet confirme l'option sur les débits.
import { MENTION_TVA_DEFAUT } from './facture'
// S6 — le certificat ÉMIS est la pièce figée de la situation. Le décompte le
// LIT (jamais ne le refait) pour dire lequel des deux engage.
import { certificatDeSituation } from './certificat'
import {
  LIBELLE_GARANTIE,
  analyserPeriode,
  caCible,
  caParMois,
  caRealiseAnnee,
  coutJourObjectif,
  decompteSituation,
  encaisseHTPeriode,
  encaissementPrevu,
  nomProjet,
  projetById,
  tempsParPersonne,
  ttc,
} from './derive'
// C1 — le dossier de séance ne définit aucune règle : il relit les sélecteurs
// qui font autorité, les MÊMES que le bloc « Préparer la réunion » à l'écran.
import { avancementLot, tacheAConfirmer } from './chantier'
import { LIBELLE_EVENEMENT, penaliteEncourue, prolongationDelai } from './penalites'
import { LIBELLE_STATUT_VISA, echeanceVisa, visasEnAttente, visasEnRetard } from './visas'
import { LIBELLE_STATUT_DESORDRE, desordresOuverts, finGPA } from './gpa'
import { diffDays, fmtDate, fmtMois, fmtMoney, fmtPct, todayISO } from './util'

function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** ouvre la facture dans une fenêtre imprimable (→ PDF via Ctrl+P).
 *  Pièce ÉMISE : le document se régénère depuis la copie FIGÉE — l'état
 *  courant (adresse du client, réglages) ne compte plus (audit F0). */
export function ouvrirFacturePDF(state: AppState, f: Facture): void {
  if (f.figee) return ouvrirFactureFigee(f, f.figee)
  ouvrirFactureHistorique(state, f)
}

/** rendu depuis le bloc figé — la seule vérité de la pièce émise */
function ouvrirFactureFigee(f: Facture, fg: FactureFigee): void {
  const titre = f.type === 'avoir' ? 'Avoir' : 'Facture'
  const a = fg.agence
  const lignesHtml = fg.lignes
    .map((l) => {
      const ht = Math.round(l.quantite * l.prixUnitaireHT * 100) / 100
      return `<tr>
      <td>${echapper(l.designation)}</td>
      <td class="r">${l.quantite === 1 && l.unite === 'forfait' ? 'forfait' : `${l.quantite} ${echapper(l.unite)}`}</td>
      <td class="r">${fmtMoney(l.prixUnitaireHT, true)}</td>
      <td class="r">${Math.round(l.tauxTVA * 1000) / 10} %</td>
      <td class="r">${fmtMoney(ht, true)}</td>
    </tr>`
    })
    .join('\n')
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${titre} ${echapper(fg.numero)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1a2233; margin: 48px; font-size: 14px; }
  header { display: flex; justify-content: space-between; margin-bottom: 36px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .muted { color: #5a6478; }
  .bloc { margin: 22px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; border-bottom: 2px solid #1a2233; padding: 8px 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  td { padding: 10px 6px; border-bottom: 1px solid #e3e6ec; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  .totaux td { border-bottom: none; padding: 6px; }
  .totaux .net td { font-weight: 700; font-size: 16px; border-top: 2px solid #1a2233; }
  .mentions { margin-top: 40px; font-size: 11px; color: #5a6478; line-height: 1.6; }
  .impression { position: fixed; top: 12px; right: 12px; }
  @media print { .impression { display: none; } body { margin: 24px; } }
</style></head><body>
<button class="impression" onclick="window.print()">Imprimer / PDF</button>
<header>
  <div>
    <h1>${echapper(a.nom)}</h1>
    <div class="muted">Architecture — maîtrise d'œuvre${a.adresse ? `<br>${echapper(a.adresse)}` : ''}${a.siret ? `<br>SIRET ${echapper(a.siret)}` : ''}${a.tva ? ` · TVA ${echapper(a.tva)}` : ''}</div>
  </div>
  <div style="text-align:right">
    <h1>${titre} ${echapper(fg.numero)}</h1>
    <div class="muted">Émis${f.type === 'avoir' ? '' : 'e'} le ${fmtDate(fg.dateEmission)}${fg.datePrestation ? `<br>Prestation : ${fmtDate(fg.datePrestation)}` : ''}<br>Échéance : ${fmtDate(encaissementPrevu(f))} (${fg.delaiJours} jours)</div>
  </div>
</header>

<div class="bloc">
  <strong>Client</strong><br>
  ${echapper(fg.clientNom)}${fg.clientAdresse ? `<br><span class="muted">${echapper(fg.clientAdresse).replace(/\n/g, '<br>')}</span>` : ''}${fg.clientSiret ? `<br><span class="muted">SIRET ${echapper(fg.clientSiret)}</span>` : ''}
</div>

${fg.objet || fg.numeroEngagement ? `<div class="bloc">
  <strong>Objet</strong><br>
  ${fg.objet ? echapper(fg.objet) : ''}${fg.numeroEngagement ? `<br><span class="muted">N° d'engagement / marché : ${echapper(fg.numeroEngagement)}</span>` : ''}
</div>` : ''}

<table>
  <thead><tr><th>Désignation</th><th class="r">Quantité</th><th class="r">PU HT</th><th class="r">TVA</th><th class="r">Montant HT</th></tr></thead>
  <tbody>
    ${lignesHtml}
  </tbody>
</table>
<table class="totaux" style="width: 46%; margin-left: auto;">
  <tbody>
    <tr><td>Total HT</td><td class="r">${fmtMoney(fg.totalHT, true)}</td></tr>
    <tr><td>TVA</td><td class="r">${fmtMoney(fg.totalTVA, true)}</td></tr>
    <tr class="net"><td>Net à payer TTC</td><td class="r">${fmtMoney(fg.totalTTC, true)}</td></tr>
  </tbody>
</table>

${a.iban ? `<div class="bloc"><strong>Règlement par virement</strong><br>
  ${a.banque ? `${echapper(a.banque)}<br>` : ''}IBAN ${echapper(a.iban)}${a.bic ? ` · BIC ${echapper(a.bic)}` : ''}</div>` : ''}

<div class="mentions">
  ${echapper(fg.mentionTVA)}. Paiement à ${fg.delaiJours} jours.
  Tout retard de paiement entraîne de plein droit des pénalités au taux légal en vigueur ainsi
  qu'une indemnité forfaitaire de recouvrement de 40 € (art. L441-10 du Code de commerce) pour
  les professionnels. Escompte pour paiement anticipé : néant.<br>
  ${[echapper(a.nom), a.capital ? `SAS au capital de ${echapper(a.capital)}` : '', a.rcs ? `RCS ${echapper(a.rcs)}` : '', a.siret ? `SIRET ${echapper(a.siret)}` : ''].filter(Boolean).join(' · ')}
  ${fg.empreinte ? `<br>Empreinte de la pièce (SHA-256) : ${echapper(fg.empreinte)}` : ''}
</div>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

/** rendu de repli pour les factures HISTORIQUES migrées (jamais gelées) —
 *  document reconstitué depuis l'état courant, à rapprocher du PDF envoyé */
function ouvrirFactureHistorique(state: AppState, f: Facture): void {
  const p = projetById(state, f.projetId)
  const s = state.settings
  const tva = f.montantHT * f.tauxTVA
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Facture ${echapper(f.numero || f.id)}</title>
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
    <h1>Facture ${echapper(f.numero || f.id)}</h1>
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
  ${echapper(s.mentionTVA || MENTION_TVA_DEFAUT)}. Paiement à ${f.delaiJours} jours.
  Tout retard de paiement entraîne de plein droit des pénalités au taux légal en vigueur ainsi
  qu'une indemnité forfaitaire de recouvrement de 40 € (art. L441-10 du Code de commerce) pour
  les professionnels. Escompte pour paiement anticipé : néant.<br>
  ${[echapper(s.nomAgence), s.capitalSocial ? `SAS au capital de ${echapper(s.capitalSocial)}` : '', s.rcs ? `RCS ${echapper(s.rcs)}` : '', s.siretAgence ? `SIRET ${echapper(s.siretAgence)}` : ''].filter(Boolean).join(' · ')}
  ${!s.iban ? '<br>Coordonnées bancaires à compléter dans Paramètres.' : ''}
  <br>Document reconstitué depuis l'état courant (facture migrée, jamais gelée) — à rapprocher du PDF réellement envoyé.
</div>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

/** ouvre le DÉCOMPTE DE VÉRIFICATION d'une situation (→ PDF via Ctrl+P).
 *  Document interne que la MOE remet à l'entreprise : net à payer = cumul
 *  (+ révision) − retenue de garantie − déjà réglé.
 *
 *  S6 — deux régimes de vérité cohabitaient dans la même famille de PDF : la
 *  facture et le certificat se réimpriment depuis leur COPIE FIGÉE, ce
 *  décompte-ci se RECALCULE à chaque impression, et rien ne le disait. Deux
 *  impressions du même décompte peuvent donc différer si le marché, la
 *  garantie, la révision ou une situation antérieure ont bougé entretemps.
 *  Tant que la situation ne porte pas son propre bloc figé (patron :
 *  `figerCertificat`, src/certificat.ts — copie profonde, le PDF ne lirait
 *  plus que ce bloc), l'impression PORTE LA MENTION au lieu de laisser
 *  croire à une pièce stable. Un document qui engage doit dire ce qu'il est.
 *
 *  `editeLe` est la VRAIE date d'édition — l'écran passe son `useToday()`.
 *  La date de réception de la situation n'en a jamais été une : elle dit
 *  quand l'entreprise a envoyé sa demande, pas quand la feuille est sortie. */
export function ouvrirDecompteSituationPDF(
  state: AppState,
  sit: Situation,
  editeLe: string = todayISO(),
): void {
  const s = state.settings
  const d = decompteSituation(state, sit)
  const p = projetById(state, sit.projetId)
  const num = sit.numero != null ? `n° ${sit.numero}` : ''
  // le certificat ÉMIS, s'il existe, est la pièce FIGÉE de cette situation :
  // c'est lui qui engage vis-à-vis du maître d'ouvrage. Le décompte le dit et
  // donne son net, au lieu de laisser deux chiffres se contredire en silence.
  const cert = certificatDeSituation(state, sit.id)
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
  .rappel { margin-top: 16px; padding: 10px 12px; border: 1px solid #c8cdd8; border-left: 3px solid #97a0b0; border-radius: 4px; font-size: 11.5px; color: #3d4658; line-height: 1.6; }
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
    <div class="muted">Mois ${echapper(fmtMois(sit.mois))}<br>Situation reçue le ${fmtDate(sit.dateReception)}<br>Édité le ${fmtDate(editeLe)}</div>
  </div>
</header>

<div class="bloc">
  <strong>Entreprise</strong> — ${echapper(sit.entreprise)}${sit.lot ? ` · ${echapper(sit.lot)}` : ''}${d.marche ? `<br><span class="muted">Marché : ${fmtMoney(d.marche.montantInitialHT + d.marche.avenantsHT, false)} HT (RG ${fmtPct(d.tauxRG, 0)}${d.garantie !== 'retenue' ? ` — ${LIBELLE_GARANTIE[d.garantie]} fournie` : ''}${d.marche.revision ? ' · révisable' : ''})</span>` : '<br><span class="muted">Situation non rattachée à un marché — RG à 0 %.</span>'}
</div>
<div class="bloc">
  <strong>Opération</strong> — ${echapper(p ? `${p.id} — ${p.nom}` : nomProjet(state, sit.projetId))}${p?.adresse ? `<br><span class="muted">${echapper(p.adresse)}</span>` : ''}
</div>

<table class="dc">
  ${ligne('Travaux exécutés cumulés HT', d.travauxCumulHT)}
  ${d.revisionHT ? ligne('Révision de prix HT', d.revisionHT) : ''}
  ${ligne('Montant cumulé HT (base)', d.baseHT, { fort: true })}
  ${ligne(`Retenue de garantie (${d.garantie !== 'retenue' ? `0 % — ${LIBELLE_GARANTIE[d.garantie]}` : fmtPct(d.tauxRG, 0)})`, -d.retenueGarantieHT, { retrait: true })}
  ${ligne('Cumul net de RG HT', d.cumulNetHT, { fort: true })}
  ${ligne('À déduire : situations précédentes (net)', -d.precedentNetHT, { retrait: true })}
  ${ligne('Net à payer ce mois HT', d.netAPayerHT, { fort: true })}
  ${ligne(`TVA (${fmtPct(d.tauxTVA, 0)})`, d.netAPayerTTC - d.netAPayerHT, { retrait: true })}
</table>

<div class="net"><span>Net à payer ce mois <strong>TTC</strong></span><span class="v">${fmtMoney(d.netAPayerTTC, true)}</span></div>

${d.coherences.length > 0 ? `<div class="warn"><strong>Points à vérifier :</strong><br>${d.coherences.map((c) => echapper(c)).join('<br>')}</div>` : ''}

<div class="rappel">
  <strong>Document reconstitué depuis l'état courant</strong>, édité le ${fmtDate(editeLe)}.
  Ce décompte de vérification n'est pas une pièce figée : ses montants se recalculent à chaque
  impression d'après le marché, la garantie, la révision et les situations antérieures tels
  qu'ils sont aujourd'hui. Deux impressions faites à deux dates peuvent donc différer.
  ${
    cert
      ? `Certificat de paiement n° ${cert.numero} émis le ${fmtDate(cert.emisLe)} par ${echapper(cert.emisPar)} — net à payer certifié ${fmtMoney(cert.netAPayerTTC, true)} TTC : en cas d'écart avec le tableau ci-dessus, <strong>c'est le certificat qui fait foi</strong>, lui seul est figé.`
      : `Aucun certificat de paiement n'a encore été émis pour cette situation : rien n'est certifié au maître d'ouvrage à ce jour.`
  }
</div>

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

/** 5.19 — certificat de paiement (état d'acompte) vers le maître d'ouvrage.
 *  Le rendu part du bloc FIGÉ et de lui seul — aucune lecture de l'état
 *  courant, aucun recalcul : réimprimer dans deux ans, avec d'autres indices
 *  et un autre cumul, doit redonner le document signé (même règle que
 *  ouvrirFactureFigee, audit F0). Rubriques A-E du document réel, colonnes
 *  « présent état » / « cumulés depuis l'origine », cartouche « BON À PAYER LE ». */
export function ouvrirCertificatPaiementPDF(cert: CertificatPaiement): void {
  const e = cert.entete
  const l = cert.lignes
  const m = (v: number) => fmtMoney(v, true)
  const cell = (v: number | null) => `<td class="r">${v === null ? '·' : m(v)}</td>`
  const ligne = (
    libelle: string,
    present: number | null,
    cumule: number | null,
    opts: { fort?: boolean; retrait?: boolean; section?: boolean } = {},
  ) =>
    `<tr${opts.fort ? ' class="fort"' : opts.section ? ' class="section"' : ''}><td${opts.retrait ? ' style="padding-left:24px"' : ''}>${libelle}</td>${cell(present)}${cell(cumule)}</tr>`
  const garantieLibelle =
    e.garantie === 'retenue' ? 'Retenue de garantie' : `Retenue de garantie (${LIBELLE_GARANTIE[e.garantie]} fournie)`

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Certificat de paiement n° ${cert.numero} — ${echapper(e.titulaire)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1a2233; margin: 44px; font-size: 13px; }
  header { display: flex; justify-content: space-between; margin-bottom: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #5a6478; }
  .bloc { margin: 14px 0; }
  .entete { display: flex; gap: 24px; flex-wrap: wrap; border: 1px solid #c8cdd8; border-radius: 6px; padding: 12px 14px; }
  .entete > div { min-width: 180px; }
  .entete .kl { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #5a6478; }
  table.dc { width: 100%; border-collapse: collapse; margin-top: 12px; }
  table.dc th { text-align: left; border-bottom: 2px solid #1a2233; padding: 7px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  table.dc th.r { text-align: right; }
  table.dc td { padding: 7px 6px; border-bottom: 1px solid #e3e6ec; }
  table.dc td.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.dc tr.fort td { font-weight: 700; border-bottom: 2px solid #1a2233; }
  table.dc tr.section td { font-weight: 700; background: #f2f4f9; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; }
  table.av { border-collapse: collapse; margin-top: 8px; }
  table.av td { padding: 4px 14px 4px 0; }
  table.av td.r { text-align: right; font-variant-numeric: tabular-nums; }
  .net { margin-top: 16px; padding: 13px 16px; background: #f2f6ff; border-radius: 8px; display: flex; justify-content: space-between; align-items: baseline; }
  .net .v { font-size: 21px; font-weight: 800; }
  .sign { margin-top: 36px; display: flex; justify-content: space-between; gap: 20px; font-size: 12px; color: #5a6478; }
  .sign .box { flex: 1; border: 1px solid #c8cdd8; border-radius: 6px; padding: 10px 12px; min-height: 110px; }
  .sign .box strong { color: #1a2233; }
  .sign .line { margin-top: 46px; border-top: 1px solid #97a0b0; padding-top: 4px; }
  .impression { position: fixed; top: 12px; right: 12px; }
  @media print { .impression { display: none; } body { margin: 20px; } }
</style></head><body>
<button class="impression" onclick="window.print()">Imprimer / PDF</button>
<header>
  <div>
    <h1>${echapper(e.agence.nom)}</h1>
    <div class="muted">Maîtrise d'œuvre${e.agence.adresse ? `<br>${echapper(e.agence.adresse)}` : ''}${e.agence.siret ? `<br>SIRET ${echapper(e.agence.siret)}` : ''}</div>
  </div>
  <div style="text-align:right">
    <h1>Certificat de paiement n° ${cert.numero}</h1>
    <div class="muted">État d'acompte — mois ${echapper(fmtMois(cert.mois))}<br>Émis le ${fmtDate(cert.emisLe)} par ${echapper(cert.emisPar)}</div>
  </div>
</header>

<div class="entete">
  <div><div class="kl">Maître d'ouvrage</div>${echapper(e.moa || '—')}</div>
  <div><div class="kl">Opération</div>${echapper(e.objet)}</div>
  <div><div class="kl">Marché n°</div>${echapper(e.marcheNumero || '—')}</div>
  <div><div class="kl">Lot</div>${echapper(e.lot || '—')}</div>
  <div><div class="kl">Titulaire</div>${echapper(e.titulaire)}</div>
</div>

<div class="bloc">
  <table class="av">
    <tr><td>Montant du marché (base) HT</td><td class="r">${m(l.baseHT)}</td>
        <td style="padding-left:32px">Avance forfaitaire initiale HT</td><td class="r">${m(l.avanceInitialeHT)}</td></tr>
    <tr><td>Avenants HT</td><td class="r">${m(l.avenantsHT)}</td>
        <td style="padding-left:32px">Avance remboursée HT</td><td class="r">${m(l.avanceRembourseeTotaleHT)}</td></tr>
    <tr><td><strong>Total marché HT</strong></td><td class="r"><strong>${m(l.totalMarcheHT)}</strong></td>
        <td style="padding-left:32px">Reste à rembourser HT</td><td class="r">${m(l.avanceResteHT)}</td></tr>
  </table>
</div>

<table class="dc">
  <thead><tr><th>Rubrique</th><th class="r">Présent état</th><th class="r">Cumulés depuis l'origine</th></tr></thead>
  <tbody>
  ${ligne('A — Acompte en prix de base', null, null, { section: true })}
  ${ligne('Avance forfaitaire versée', l.avanceVerseePresentHT, l.avanceInitialeHT)}
  ${ligne(`Décompte n° ${cert.numero} — travaux exécutés HT`, null, l.cumulHT)}
  ${ligne('À déduire : décompte antérieur HT', null, l.anterieurHT, { retrait: true })}
  ${ligne('Résorption de l’avance forfaitaire', -l.resorptionHT, -l.avanceRembourseeTotaleHT, { retrait: true })}
  ${ligne('Acompte en prix de base HT (cumulé − antérieur)', l.acompteHT, null, { fort: true })}
  ${ligne('B — Révision de prix', null, null, { section: true })}
  ${ligne('Révision du présent état HT', l.revisionHT, null)}
  ${ligne('Révisions antérieures HT', null, l.revisionAnterieureHT, { retrait: true })}
  ${ligne('Révision depuis l’origine HT', null, l.revisionOrigineHT, { fort: true })}
  ${ligne(`C — TVA (${fmtPct(l.tauxTVA, 0)})`, null, null, { section: true })}
  ${ligne('TVA sur avance', l.tvaAvanceHT, l.tvaAvanceCumulHT)}
  ${ligne('TVA sur acompte', l.tvaAcompteHT, l.tvaAcompteCumulHT)}
  ${ligne('TVA sur révision', l.tvaRevisionHT, l.tvaRevisionCumulHT)}
  ${ligne('Total acompte TTC', l.totalTTC, l.acompteTTCCumul, { fort: true })}
  ${ligne('D — Pénalités appliquées à déduire', -l.penalitesHT, null)}
  ${ligne(`E — ${garantieLibelle}`, -l.retenueGarantieTTC, null)}
  </tbody>
</table>

<div class="net"><span><strong>NET À PAYER</strong> au titulaire — présent état TTC</span><span class="v">${m(l.netAPayerTTC)}</span></div>

<p class="muted" style="margin-top:12px">Reste à exécuter HT (marché avenants compris − travaux cumulés) : <strong>${m(l.resteHT)}</strong></p>

<div class="sign">
  <div class="box"><strong>Certifié exact par la maîtrise d'œuvre</strong><br>${echapper(e.agence.nom)}<div class="line">Le ${fmtDate(cert.emisLe)} — signature</div></div>
  <div class="box"><strong>Le maître d'ouvrage</strong><br>${echapper(e.moa || '')}<div class="line">BON À PAYER LE&nbsp;: ......................... — signature</div></div>
</div>
<div class="muted" style="margin-top:20px;font-size:11px">Certificat établi depuis la situation de travaux n° ${cert.numero} vérifiée par la maîtrise d'œuvre. Chiffres figés à l'émission ; toute correction ultérieure passe par un état rectificatif, jamais par la réédition de celui-ci.</div>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

const MOIS_PDF = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/** Revue de pilotage imprimable (→ PDF via Ctrl+P) : synthèse CA / marge / temps sur une période.
 *
 *  S6 — `editeeLe` est la vraie date d'édition. La fin de PÉRIODE en tenait
 *  lieu : une revue du 1er trimestre sortie en août s'imprimait « Éditée le
 *  31 mars », et le lecteur datait de mars des chiffres arrêtés en août.
 *  L'écran passe son `useToday()` ; à défaut, le jour de l'impression. */
export function ouvrirRevuePDF(
  state: AppState,
  debut: string,
  fin: string,
  editeeLe: string = todayISO(),
): void {
  const s = state.settings
  const syn = analyserPeriode(state, debut, fin)
  const tpp = tempsParPersonne(state, debut, fin)
  const annee = Number(debut.slice(0, 4))
  const cam = caParMois(state, annee)
  const caRealise = caRealiseAnnee(state, annee)
  const cible = caCible(state)
  const objectif = coutJourObjectif(state)
  // encaissé dérivé des PAIEMENTS ; marge sur coûts DIRECTS (audit F0)
  const encaisse = encaisseHTPeriode(state, debut, fin)
  const marge = syn.totalCA - syn.totalCoutTemps
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
  <div class="muted" style="text-align:right">Éditée le ${fmtDate(editeeLe)}</div>
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


// ==================================================================
// C1 — « Préparer la réunion » : le dossier de séance qu'on emporte
// sur le chantier (R1, S3 — parcours 6 : 12 gestes sur 4 écrans et une
// synthèse de tête → une page).
//
// UNE SEULE AUTORITÉ : ce gabarit ne définit AUCUNE règle. Il relit les
// sélecteurs qui font autorité — `avancementLot` (src/chantier.ts),
// `penaliteEncourue` + `prolongationDelai` (src/penalites.ts),
// `visasEnAttente` / `visasEnRetard` / `echeanceVisa` (src/visas.ts),
// `desordresOuverts` + `finGPA` (src/gpa.ts), `tacheAConfirmer`
// (src/chantier.ts) — exactement ceux que le bloc « Préparer la réunion »
// de l'onglet Chantier lit à l'écran (ProjetChantier.tsx). Deux lectures
// de la même autorité ne peuvent pas diverger ; deux calculs, si (R3).
//
// La page imprimée DÉTAILLE ce que l'écran synthétise : à l'écran une
// ligne par lot suffit pour décider d'y aller, en séance il faut le nom
// du document à viser, la date du désordre et le téléphone à appeler.
// Les totaux, eux, sont les mêmes des deux côtés — c'est la promesse du
// bouton « mêmes chiffres que ci-dessous ».
//
// C'est une PRÉPARATION, jamais un compte rendu : elle rassemble ce qu'il
// y a à dire, elle ne décide rien. Les pénalités y sont ENCOURUES, jamais
// appliquées — appliquer reste un geste humain, tracé, sur le marché.
// ==================================================================

/** « null n'est pas 0 » : une donnée absente s'imprime « ? ». Un « 0 € »
 *  affirmerait qu'on a lu le CCAP et que la pénalité est nulle. */
const euros = (v: number | null | undefined): string =>
  v === null || v === undefined ? '?' : fmtMoney(v, true)

/** accord du pluriel — la feuille passe de main en main en séance, elle
 *  s'écrit en français, pas en « (s) » */
const pluriel = (n: number): string => (n > 1 ? 's' : '')

/** un délai se lit en mots : le signe d'un nombre de jours se lit mal, et
 *  c'est justement celui-là qu'on ne doit pas manquer en séance. */
const delai = (j: number | null | undefined): string =>
  j === null || j === undefined
    ? '?'
    : j < 0
      ? `en retard de ${-j} j`
      : j === 0
        ? "aujourd'hui"
        : `dans ${j} j`

/** ouvre le dossier de séance imprimable (→ PDF via Ctrl+P).
 *
 *  `today` vient de l'écran (jamais d'une horloge lue ici) : c'est lui qui
 *  date les retards de visa comme la fenêtre de confirmation, et c'est lui
 *  qui s'imprime en date d'édition — la feuille dit de quel jour elle parle.
 *  `reunion` est la prochaine séance programmée, ou null : une préparation
 *  se fait AUSSI quand la date n'est pas encore posée. */
export function ouvrirPreparationReunionPDF(
  state: AppState,
  projet: Projet,
  today: string,
  reunion: ReunionChantier | null,
): void {
  const s = state.settings
  const marches = state.marches.filter((m) => m.projetId === projet.id)
  const visasProjet = state.visas.filter((v) => v.projetId === projet.id)
  const aViser = visasEnAttente(visasProjet)
  const enRetard = visasEnRetard(visasProjet, today)
  const desordres = desordresOuverts(state.desordresGPA.filter((d) => d.projetId === projet.id))
  // une pénalité APPLIQUÉE est une décision déjà signifiée : elle n'a plus
  // sa place dans un ordre du jour, on n'annonce que ce qui reste ouvert
  const evenements = state.evenementsMarche.filter(
    (e) => e.projetId === projet.id && !e.penaliteAppliquee,
  )
  const marcheDeTache = (marcheId: string | null | undefined) =>
    marcheId ? marches.find((m) => m.id === marcheId) ?? null : null
  const aConfirmer = state.tachesChantier.filter(
    (t) => t.projetId === projet.id && tacheAConfirmer(t, marcheDeTache(t.marcheId), today),
  )
  /** « lot — entreprise » d'une pièce rattachée à un marché ; à défaut le lot
   *  écrit à la main (un document peut arriver avant la signature du marché),
   *  et sinon la vérité : ce n'est rattaché à rien, quelqu'un doit le dire. */
  const rattachement = (marcheId: string | null | undefined, lotTexte?: string) => {
    const m = marches.find((x) => x.id === marcheId)
    const parts = [m?.lot || lotTexte || '', m?.entreprise || ''].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : 'lot non rattaché'
  }

  const lignes = marches
    .map((m) => {
      const visasLot = aViser.filter((v) => v.marcheId === m.id)
      const evLot = evenements.filter((e) => e.marcheId === m.id)
      // MÊME déduction d'intempéries que le journal des pénalités et que le
      // bloc à l'écran : une seule source (`prolongationDelai`), sinon la
      // feuille annoncerait un montant que l'écran de décision dément
      const deduction = prolongationDelai(m, state.intemperies)
      const chiffres = evLot.map((e) => penaliteEncourue(e, m.penalites, deduction))
      const chiffrables = chiffres.filter((c) => c !== null)
      return {
        m,
        avancement: avancementLot(state.tachesChantier, m.id),
        visasLot,
        retardLot: enRetard.filter((v) => v.marcheId === m.id),
        evLot,
        // l'événement ET son chiffre calculés UNE fois : la ligne de détail
        // ne recalcule pas ce que le total a déjà compté
        details: evLot.map((e, i) => ({ e, calcul: chiffres[i] })),
        chiffrables: chiffrables.length,
        totalEncouruHT: chiffrables.reduce((t, c) => t + c!.montantHT, 0),
        tauxManquant: chiffres.some((c) => c === null),
        desordresLot: desordres.filter((d) => d.marcheId === m.id),
        confirmerLot: aConfirmer.filter((t) => t.marcheId === m.id),
      }
    })
    // hors phase : un marché soldé qui n'a plus rien à dire ne prend pas une
    // ligne de l'ordre du jour — MÊME tri qu'à l'écran, sinon la feuille et
    // le bloc ne montreraient pas les mêmes lots
    .filter(
      (l) =>
        l.m.actif ||
        l.visasLot.length > 0 ||
        l.evLot.length > 0 ||
        l.desordresLot.length > 0 ||
        l.confirmerLot.length > 0,
    )

  const sansLot = (id: string | null | undefined) => !id || !marches.some((m) => m.id === id)
  const visasSansLot = aViser.filter((v) => sansLot(v.marcheId))
  const desordresSansLot = desordres.filter((d) => sansLot(d.marcheId))

  /** un titre de rubrique qui porte son compte, et un corps qui dit « rien »
   *  au lieu de disparaître : une rubrique absente laisserait croire à un
   *  oubli, une rubrique vide dit qu'on a regardé. */
  const rubrique = (titre: string, n: number, corps: string, rien: string) =>
    `<h2>${echapper(titre)}${n > 0 ? ` <span class="n">${n}</span>` : ''}</h2>
${n > 0 ? corps : `<p class="rien">${echapper(rien)}</p>`}`

  const lignesSynthese = lignes
    .map(
      (l) => `<tr>
      <td><strong>${echapper(l.m.lot)}</strong><div class="muted">${echapper(l.m.entreprise)}</div></td>
      <td class="r">${l.avancement === null ? '?' : `${l.avancement} %`}</td>
      <td>${l.visasLot.length === 0 ? '<span class="muted">—</span>' : `${l.visasLot.length} à viser${l.retardLot.length > 0 ? ` <span class="retard">dont ${l.retardLot.length} en retard</span>` : ''}`}</td>
      <td class="r">${
        l.evLot.length === 0
          ? '<span class="muted">—</span>'
          : l.chiffrables === 0
            ? '<span class="retard">taux CCAP ?</span>'
            : `${fmtMoney(l.totalEncouruHT, true)}<div class="muted">${l.evLot.length} événement${pluriel(l.evLot.length)} non décidé${pluriel(l.evLot.length)}${l.tauxManquant ? ', dont taux CCAP manquant' : ''}</div>`
      }</td>
      <td>${l.confirmerLot.length === 0 ? '<span class="muted">—</span>' : `${l.confirmerLot.length} à confirmer`}</td>
      <td>${
        l.desordresLot.length > 0
          ? `${l.desordresLot.length} désordre${pluriel(l.desordresLot.length)} ouvert${pluriel(l.desordresLot.length)}`
          : l.m.dateReception
            ? `<span class="muted">aucun désordre — GPA jusqu'au ${fmtDate(finGPA(l.m.dateReception))}</span>`
            : '<span class="muted">—</span>'
      }</td>
    </tr>`,
    )
    .join('\n')

  const lignesVisas = aViser
    .slice()
    .sort((a, b) => (echeanceVisa(a) || '9999').localeCompare(echeanceVisa(b) || '9999'))
    .map((v) => {
      const echeance = echeanceVisa(v)
      const restant = echeance === null ? null : diffDays(today, echeance)
      return `<tr>
      <td><strong>${echapper(v.document)}</strong><div class="muted">${echapper(rattachement(v.marcheId, v.lot))} · reçu le ${fmtDate(v.recuLe)}</div></td>
      <td>${echeance ? fmtDate(echeance) : '<span class="muted">réception illisible</span>'}</td>
      <td class="${restant !== null && restant < 0 ? 'retard' : ''}">${delai(restant)}</td>
      <td>${echapper(LIBELLE_STATUT_VISA[v.statut] || v.statut)}</td>
    </tr>`
    })
    .join('\n')

  const lignesPenalites = lignes
    .flatMap((l) =>
      l.details.map(({ e, calcul }) => {
        return `<tr>
      <td><strong>${echapper(l.m.lot)}</strong><div class="muted">${echapper(l.m.entreprise)}</div></td>
      <td>${echapper(LIBELLE_EVENEMENT[e.type] || e.type)}<div class="muted">${fmtDate(e.date)}${e.document ? ` · ${echapper(e.document)}` : ''}${e.commentaire ? ` — ${echapper(e.commentaire)}` : ''}</div></td>
      <td class="r">${calcul === null || calcul.joursRetenus === null ? '<span class="muted">—</span>' : `${calcul.joursRetenus} j`}${calcul && calcul.joursDeduits > 0 ? `<div class="muted">− ${calcul.joursDeduits} j d'intempéries</div>` : ''}</td>
      <td class="r">${euros(calcul === null ? null : calcul.montantHT)}</td>
    </tr>`
      }),
    )
    .join('\n')

  const lignesDesordres = desordres
    .slice()
    .sort((a, b) => a.signaleLe.localeCompare(b.signaleLe))
    .map((d) => {
      const m = marches.find((x) => x.id === d.marcheId)
      return `<tr>
      <td><strong>${echapper(d.description)}</strong><div class="muted">${echapper(rattachement(d.marcheId, d.lot))}</div></td>
      <td>${fmtDate(d.signaleLe)}${d.signalePar ? `<div class="muted">${echapper(d.signalePar)}</div>` : ''}</td>
      <td>${m && m.dateReception ? fmtDate(finGPA(m.dateReception)) : '<span class="muted">réception non saisie</span>'}</td>
      <td>${echapper(LIBELLE_STATUT_DESORDRE[d.statut] || d.statut)}${Array.isArray(d.relances) && d.relances.length > 0 ? `<div class="muted">${d.relances.length} relance${pluriel(d.relances.length)} tracée${pluriel(d.relances.length)}</div>` : ''}</td>
    </tr>`
    })
    .join('\n')

  const lignesConfirmations = aConfirmer
    .slice()
    .sort((a, b) => (a.debut || '9999').localeCompare(b.debut || '9999'))
    .map((t) => {
      const m = marcheDeTache(t.marcheId)
      return `<tr>
      <td><strong>${echapper(t.lot)}</strong><div class="muted">${echapper(m?.entreprise || 'entreprise à identifier')}</div></td>
      <td>${echapper(t.designation)}</td>
      <td>${t.debut ? fmtDate(t.debut) : '<span class="muted">non datée</span>'}</td>
      <td>${delai(t.debut ? diffDays(today, t.debut) : null)}</td>
      <td>${m?.contactNom ? echapper(m.contactNom) : ''}${m?.contactEmail ? `<div class="muted">${echapper(m.contactEmail)}</div>` : ''}${!m?.contactNom && !m?.contactEmail ? '<span class="muted">contact à compléter au marché</span>' : ''}</td>
    </tr>`
    })
    .join('\n')

  const restes = [
    visasSansLot.length > 0
      ? `${visasSansLot.length} visa${pluriel(visasSansLot.length)} à rendre`
      : '',
    desordresSansLot.length > 0
      ? `${desordresSansLot.length} désordre${pluriel(desordresSansLot.length)} GPA ouvert${pluriel(desordresSansLot.length)}`
      : '',
  ].filter(Boolean)

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Préparer la réunion — ${echapper(projet.id)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1a2233; margin: 40px; font-size: 13px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
  h1 { font-size: 21px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 24px 0 6px; text-transform: uppercase; letter-spacing: .05em; border-bottom: 2px solid #1a2233; padding-bottom: 4px; }
  h2 .n { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 9px; background: #1a2233; color: #fff; font-size: 11px; letter-spacing: 0; }
  .muted { color: #5a6478; font-size: 11px; }
  .entete { display: flex; gap: 22px; flex-wrap: wrap; border: 1px solid #c8cdd8; border-radius: 6px; padding: 11px 14px; }
  .entete > div { min-width: 150px; }
  .entete .kl { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #5a6478; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 12px; }
  th { text-align: left; border-bottom: 2px solid #1a2233; padding: 6px 5px; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
  th.r { text-align: right; }
  td { padding: 7px 5px; border-bottom: 1px solid #e3e6ec; vertical-align: top; }
  td.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .retard { color: #bb2233; font-weight: 700; }
  .rien { color: #5a6478; font-size: 12px; margin: 6px 0 0; }
  .note { margin-top: 8px; padding: 9px 12px; background: #f2f6ff; border-radius: 6px; font-size: 11.5px; line-height: 1.6; }
  .lignes div { border-bottom: 1px solid #c8cdd8; height: 26px; }
  .pied { margin-top: 26px; font-size: 10.5px; color: #5a6478; line-height: 1.6; }
  .impression { position: fixed; top: 12px; right: 12px; }
  @media print { .impression { display: none; } body { margin: 18px; } h2 { page-break-after: avoid; } tr { page-break-inside: avoid; } }
</style></head><body>
<button class="impression" onclick="window.print()">Imprimer / PDF</button>
<header>
  <div>
    <h1>Préparer la réunion de chantier</h1>
    <div class="muted">${echapper(s.nomAgence)} — maîtrise d'œuvre${s.personnes.length > 0 ? ` · ${echapper(s.personnes.join(' · '))}` : ''}</div>
  </div>
  <div style="text-align:right" class="muted">
    ${
      reunion
        ? `${echapper(reunion.titre)}<br>Séance du ${fmtDate(reunion.date)}${reunion.heure ? ` à ${echapper(reunion.heure)}` : ''}`
        : 'Aucune séance programmée'
    }<br>Édité le ${fmtDate(today)}
  </div>
</header>

<div class="entete">
  <div><div class="kl">Opération</div>${echapper(projet.id)} — ${echapper(projet.nom)}</div>
  ${projet.adresse ? `<div><div class="kl">Adresse</div>${echapper(projet.adresse)}</div>` : ''}
  ${projet.moa ? `<div><div class="kl">Maître d'ouvrage</div>${echapper(projet.moa)}</div>` : ''}
</div>

${rubrique(
    'Par lot — ce qu\'il y a à dire',
    lignes.length,
    `<table>
  <thead><tr><th>Lot / entreprise</th><th class="r">Avancement</th><th>Visas à rendre</th><th class="r">Pénalités encourues</th><th>À confirmer</th><th>Parfait achèvement</th></tr></thead>
  <tbody>
${lignesSynthese}
  </tbody>
</table>${restes.length > 0 ? `<p class="muted">Sans lot rattaché : ${echapper(restes.join(' · '))}.</p>` : ''}`,
    'Aucun lot à porter à l\'ordre du jour : aucun marché en cours, aucun visa en attente, aucune pénalité encourue non décidée, aucun désordre ouvert, aucune intervention à confirmer.',
  )}

${rubrique(
    'Visas à rendre',
    aViser.length,
    `<table>
  <thead><tr><th>Document</th><th>Échéance du CCAP</th><th>Délai</th><th>Statut</th></tr></thead>
  <tbody>
${lignesVisas}
  </tbody>
</table>
<p class="muted">Un visa en retard engage la maîtrise d'œuvre : l'entreprise exécute sans visa, et le retard du visa devient l'excuse de tous les retards du lot.</p>`,
    'Aucun document en attente de visa.',
  )}

${rubrique(
    'Pénalités encourues — à annoncer, non décidées',
    lignes.reduce((n, l) => n + l.evLot.length, 0),
    `<table>
  <thead><tr><th>Lot / entreprise</th><th>Fait générateur</th><th class="r">Jours retenus</th><th class="r">Montant HT encouru</th></tr></thead>
  <tbody>
${lignesPenalites}
  </tbody>
</table>
<div class="note">Ces montants sont <strong>encourus</strong> : rien n'est retenu tant que la pénalité n'a pas été appliquée, et l'appliquer est une décision qui se signe. Appliquée, elle est proposée en déduction au prochain certificat de paiement (ligne D) — ne la déduisez pas aussi de la situation, l'entreprise la paierait deux fois.</div>`,
    'Aucun fait générateur de pénalité en attente de décision.',
  )}

${rubrique(
    'Désordres en garantie de parfait achèvement',
    desordres.length,
    `<table>
  <thead><tr><th>Désordre</th><th>Signalé le</th><th>Fin de GPA</th><th>Statut</th></tr></thead>
  <tbody>
${lignesDesordres}
  </tbody>
</table>
<p class="muted">Un désordre contesté reste ouvert : seule la levée constatée le ferme.</p>`,
    'Aucun désordre ouvert.',
  )}

${rubrique(
    'Entreprises à confirmer',
    aConfirmer.length,
    `<table>
  <thead><tr><th>Lot / entreprise</th><th>Intervention</th><th>Début prévu</th><th>Délai</th><th>Contact</th></tr></thead>
  <tbody>
${lignesConfirmations}
  </tbody>
</table>
<p class="muted">Une entreprise qui découvre sa date deux semaines avant ne vient pas : l'appel se passe en séance, la confirmation se note sur la tâche du planning.</p>`,
    'Aucune intervention à confirmer dans le mois qui vient.',
  )}

<h2>Notes de séance</h2>
<div class="lignes"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>

<div class="pied">
  « ? » signale une donnée absente, jamais un zéro : un avancement sans tâche de planning rattachée, un montant sans taux de CCAP saisi, une échéance sans date de réception restent à renseigner.<br>
  Dossier de PRÉPARATION rassemblé par la maîtrise d'œuvre depuis les registres du cockpit, à la date d'édition. Il ne vaut ni ordre de service, ni compte rendu, ni décision : viser, appliquer une pénalité, confirmer une entreprise ou lever un désordre reste un geste, tracé, dans sa carte.
</div>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
}
