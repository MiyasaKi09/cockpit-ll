// ============================================================
// Finance — Connecteurs (audit F10). Diagnostic consolidé
// (banque, mail, Drive, cabinet, Chorus, PDP) et imports :
// - banque : connexion directe (lecture seule) OU CAMT.053, OFX/QFX,
//   QIF, CSV — un seul écran les intègre, tous idempotents ;
// - achats : lecture CII/UBL ligne par ligne, TVA par taux,
//   conservation du XML source ;
// - Chorus/PDP : import CSV du cycle de vie, rattaché par numéro
//   de facture ;
// - connecteurs directs : URL de passerelle serveur HTTPS +
//   healthcheck ; AUCUN secret dans le navigateur ni AppState.
// ============================================================

import { useMemo, useRef, useState } from 'react'
import type { Connecteur, FactureAchat, TypeConnecteur } from '../types'
import { useStore } from '../store'
import { Badge, Btn, Card, Field, Page, Select, Stat, Table, TextInput, navigate, toast, useToday } from '../ui'
import FinanceNav from './FinanceNav'
import { soldeBancaire } from '../banque'
// L'état d'un consentement bancaire et la fraîcheur d'une synchronisation ont
// UN propriétaire (src/banqueApi.ts) : le diagnostic les IMPORTE. Les
// recompter ici les ferait diverger de ce qu'annonce Banque & trésorerie, et
// de ce qu'annonce le fil d'urgences — trois comptes du même délai.
import { etatConsentement, etatSynchronisation } from '../banqueApi'
import { lireCycleVieCSV } from '../imports'
import { lireFactureXMLDetail } from '../facturx'
import { fmtDate, fmtMoney, fold, uid } from '../util'

// ---------- diagnostic consolidé ----------

interface Diagnostic {
  type: TypeConnecteur
  libelle: string
  etat: 'ok' | 'partiel' | 'absent'
  detail: string
}

function diagnostics(state: ReturnType<typeof useStore>['state'], today: string): Diagnostic[] {
  const banque = soldeBancaire(state)
  // Connexion directe : c'est le seul connecteur du tableau qui puisse
  // s'éteindre TOUT SEUL, à date fixe (DSP2, 90 jours). Un diagnostic qui ne
  // le dirait pas afficherait « ✓ connecté » sur une trésorerie figée.
  const connexions = Array.isArray(state.connexionsBancaires) ? state.connexionsBancaires : []
  const aReconnecter = connexions.filter((c) => etatConsentement(c, today).alerter)
  const muettes = connexions.filter((c) => etatSynchronisation(c, today).alerter)
  const detailConnexion =
    connexions.length === 0
      ? null
      : aReconnecter.length > 0
        ? `${aReconnecter.length} connexion(s) à reconnecter`
        : muettes.length > 0
          ? `${muettes.length} connexion(s) sans synchronisation récente`
          : `${connexions.length} connexion(s) directe(s) actives`
  const derCompta = [...state.lotsComptables].sort((a, b) => a.dateExport.localeCompare(b.dateExport)).pop()
  const transmissions = state.factures.filter((f) => (f.transmissions || []).length > 0).length
  const chorusVus = state.factures.some((f) => (f.transmissions || []).some((t) => t.plateforme === 'chorus'))
  const pdpVus = state.factures.some((f) => (f.transmissions || []).some((t) => t.plateforme === 'pdp'))
  const conn = (t: TypeConnecteur) => state.connecteurs.find((c) => c.type === t)
  const sante = (t: TypeConnecteur, base: Diagnostic): Diagnostic => {
    const c = conn(t)
    if (c?.urlPasserelle && c.dernierHealthcheck) return { ...base, etat: c.dernierHealthcheck.ok ? 'ok' : 'partiel', detail: `passerelle ${c.dernierHealthcheck.ok ? 'OK' : 'KO'} au ${fmtDate(c.dernierHealthcheck.date)}${base.detail ? ' · ' + base.detail : ''}` }
    return base
  }
  return [
    sante('banque', {
      type: 'banque',
      libelle: 'Banque',
      etat:
        aReconnecter.length > 0
          ? 'partiel'
          : banque
            ? 'ok'
            : state.transactionsBancaires.length
              ? 'partiel'
              : 'absent',
      detail: [
        banque
          ? `solde ${fmtMoney(banque.solde)} au ${fmtDate(banque.date)}`
          : state.transactionsBancaires.length
            ? `${state.transactionsBancaires.length} mouvements importés`
            : 'aucun relevé',
        detailConnexion,
      ]
        .filter(Boolean)
        .join(' · '),
    }),
    sante('mail', { type: 'mail', libelle: 'Mail (Gmail)', etat: state.settings.surveillance?.clientId ? 'ok' : 'absent', detail: state.settings.surveillance?.email || 'non branché (Paramètres → Branchements)' }),
    sante('drive', { type: 'drive', libelle: 'Drive', etat: state.registreDocuments.length ? 'partiel' : 'absent', detail: `${state.registreDocuments.length} pièce(s) au registre` }),
    sante('cabinet', { type: 'cabinet', libelle: 'Cabinet comptable', etat: state.settings.profilComptable ? (derCompta ? 'ok' : 'partiel') : 'absent', detail: derCompta ? `dernier lot ${derCompta.periode} v${derCompta.version}` : state.settings.profilComptable ? 'profil configuré, aucun export' : 'profil non configuré' }),
    sante('chorus', { type: 'chorus', libelle: 'Chorus Pro', etat: chorusVus ? 'ok' : 'absent', detail: chorusVus ? 'cycle de vie suivi' : 'aucun statut Chorus' }),
    sante('pdp', { type: 'pdp', libelle: 'Plateforme agréée (PDP)', etat: pdpVus ? 'ok' : transmissions ? 'partiel' : 'absent', detail: pdpVus ? 'cycle de vie suivi' : 'aucun statut PDP' }),
  ]
}

// ---------- import bancaire : RENVOI vers le point unique (lot D2) ----------
//
// Cette carte importait elle aussi les relevés, mais elle enregistrait
// `soldeFinal: null` : un OFX déposé ici entrait bien en mouvements et ne
// mettait JAMAIS à jour la trésorerie — sans un mot à l'écran (constat R3,
// « la même notion codée deux fois, avec deux résultats possibles »). L'import
// vit maintenant dans Banque & trésorerie, avec son champ « solde de fin ».
// La carte reste : c'est ici qu'on vient chercher les imports, et un écran qui
// perd une entrée sans la remplacer fait chercher longtemps.
//
// La CONNEXION DIRECTE (lecture seule) arrive au même endroit et par le même
// chemin — `preparerImport`, le solde de fin, le rapprochement proposé. Le
// renvoi la mentionne pour la même raison qu'il mentionnait l'import : ce qui
// n'est pas nommé ici se cherche ailleurs.

function CarteImportBancaire() {
  const { state } = useStore()
  const today = useToday()
  const dernier = [...state.importsBancaires].sort((a, b) => a.date.localeCompare(b.date)).pop()
  const solde = soldeBancaire(state)
  const connexions = Array.isArray(state.connexionsBancaires) ? state.connexionsBancaires : []
  const aReconnecter = connexions.filter((c) => etatConsentement(c, today).alerter)
  return (
    <Card
      titre="Import bancaire — CAMT.053 · OFX/QFX · QIF · CSV (et connexion directe)"
      actions={
        <Btn small kind="primary" onClick={() => navigate('/finance/banque')}>
          Aller à l'import de relevé
        </Btn>
      }
    >
      <p className="small" style={{ margin: '0 0 8px' }}>
        La connexion bancaire directe (lecture seule) et les quatre formats de fichier arrivent en UN SEUL
        endroit : <a href="#/finance/banque">Banque &amp; trésorerie</a>. C'est le seul point qui porte le{' '}
        <strong>solde de fin de relevé</strong> — celui qui cale la trésorerie affichée. Le rapprochement suit,
        proposé, jamais appliqué sans validation.
      </p>
      <p className="muted small" style={{ margin: 0 }}>
        {dernier
          ? `Dernier relevé : ${dernier.nomFichier} du ${fmtDate(dernier.date)} — ${dernier.nbNouvelles} mouvement(s) nouveaux.`
          : 'Aucun relevé importé pour l’instant.'}
        {solde ? ` Solde bancaire connu : ${fmtMoney(solde.solde)} au ${fmtDate(solde.date)}.` : ' Aucun solde de fin saisi : le solde bancaire reste inconnu.'}
        {connexions.length > 0
          ? ` ${connexions.length} connexion(s) directe(s)${aReconnecter.length > 0 ? ` — ${aReconnecter.length} à reconnecter (autorisation DSP2 de 90 jours)` : ''}.`
          : ' Aucune connexion directe : l’import de fichier reste le chemin hors ligne.'}
      </p>
    </Card>
  )
}

// ---------- import CII/UBL ligne par ligne ----------

function CarteImportAchatXml() {
  const { state, update } = useStore()
  const today = useToday()
  const ref = useRef<HTMLInputElement>(null)
  const [detail, setDetail] = useState<ReturnType<typeof lireFactureXMLDetail>>(null)

  const charger = (file: File) => {
    const lecteur = new FileReader()
    lecteur.onload = () => {
      const d = lireFactureXMLDetail(String(lecteur.result || ''))
      if (!d) return toast('XML non reconnu (CII ou UBL attendu).', { tone: 'danger' })
      setDetail(d)
    }
    lecteur.readAsText(file, 'utf-8')
  }

  const creerAchat = () => {
    if (!detail) return
    const achat: FactureAchat = {
      id: uid('fa'),
      fournisseur: detail.fournisseur || 'Fournisseur',
      numeroFournisseur: detail.numero,
      dateFacture: detail.dateFacture || today,
      dateEcheance: detail.dateEcheance || null,
      montantHT: detail.totalHT ?? detail.lignes.reduce((s, l) => s + l.montantHT, 0),
      montantTVA: detail.totalTVA ?? detail.tvaParTaux.reduce((s, t) => s + t.tva, 0),
      montantTTC: detail.totalTTC ?? 0,
      ventilations: detail.lignes.map((l) => ({ id: uid('va'), montantHT: l.montantHT, categorie: 'Autre', projetId: null, phase: null })),
      statut: 'a_valider',
      source: 'xml',
      confiance: 0.85,
      raisons: [`Facture ${detail.syntaxe.toUpperCase()} lue ligne par ligne`, 'XML source conservé'],
      notes: `XML source (${detail.syntaxe.toUpperCase()}) conservé :\n${detail.xmlSource.slice(0, 4000)}`,
    }
    update((s) => {
      s.facturesAchat.push(achat)
    })
    toast('Facture d’achat créée « à valider » — ventilations à préciser dans Achats & frais.', { tone: 'ok' })
    setDetail(null)
  }

  return (
    <Card
      titre="Import achat électronique — CII / UBL (ligne par ligne)"
      actions={
        <>
          <Btn small kind="primary" onClick={() => ref.current?.click()}>Importer un XML</Btn>
          <input ref={ref} type="file" accept=".xml" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) charger(f); e.target.value = '' }} />
        </>
      }
    >
      {detail ? (
        <>
          <p className="small" style={{ margin: '0 0 6px' }}>
            <strong>{detail.syntaxe.toUpperCase()}</strong> — {detail.fournisseur || 'fournisseur ?'} · {detail.numero || 'n° ?'} · {detail.lignes.length} ligne(s)
          </p>
          <Table compact head={['Désignation', <span key="q" className="right">Qté</span>, <span key="ht" className="right">HT</span>, <span key="t" className="right">TVA</span>]}>
            {detail.lignes.map((l, i) => (
              <tr key={i}>
                <td>{l.designation}</td>
                <td className="right num">{l.quantite ?? '—'}</td>
                <td className="right num">{fmtMoney(l.montantHT, true)}</td>
                <td className="right num">{Math.round(l.tauxTVA * 1000) / 10} %</td>
              </tr>
            ))}
          </Table>
          <p className="small" style={{ marginTop: 6 }}>
            TVA par taux : {detail.tvaParTaux.map((t) => `${Math.round(t.taux * 1000) / 10} % → ${fmtMoney(t.tva, true)}`).join(' · ') || '—'}
          </p>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <Btn small onClick={() => setDetail(null)}>Annuler</Btn>
            <Btn small kind="primary" onClick={creerAchat}>Créer la facture d’achat (à valider)</Btn>
          </div>
        </>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>Le XML source est conservé sur la pièce ; la validation se fait dans <a href="#/finance/achats">Achats & frais</a>.</p>
      )}
    </Card>
  )
}

// ---------- import cycle de vie Chorus/PDP ----------

function CarteCycleVie() {
  const { state, update } = useStore()
  const ref = useRef<HTMLInputElement>(null)

  const charger = (file: File) => {
    const lecteur = new FileReader()
    lecteur.onload = () => {
      const evenements = lireCycleVieCSV(String(lecteur.result || ''))
      if (evenements.length === 0) return toast('Aucun événement lisible (colonnes : numéro, statut, date, motif).', { tone: 'danger' })
      const parNumero = new Map(state.factures.map((f) => [fold(f.numero || f.id), f.id]))
      let rattaches = 0
      let orphelins = 0
      update((s) => {
        for (const ev of evenements) {
          const factureId = parNumero.get(fold(ev.numeroFacture))
          if (!factureId) {
            orphelins++
            continue
          }
          const f = s.factures.find((x) => x.id === factureId)
          if (!f) continue
          const existe = (f.transmissions || []).some((t) => t.statut === ev.statut && t.date === ev.date)
          if (existe) continue
          f.transmissions = [...(f.transmissions || []), { date: ev.date || '', plateforme: 'chorus', statut: ev.statut, motif: ev.motif }]
          rattaches++
        }
      })
      toast(`${rattaches} événement(s) rattaché(s) par numéro de facture${orphelins ? `, ${orphelins} sans facture` : ''}.`, { tone: 'ok' })
    }
    lecteur.readAsText(file, 'utf-8')
  }

  return (
    <Card
      titre="Cycle de vie Chorus / PDP — import CSV"
      actions={
        <>
          <Btn small kind="primary" onClick={() => ref.current?.click()}>Importer le CSV</Btn>
          <input ref={ref} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) charger(f); e.target.value = '' }} />
        </>
      }
    >
      <p className="muted small" style={{ margin: 0 }}>
        Colonnes attendues : numéro de facture, statut (déposée / rejetée / mise à disposition / approuvée / payée),
        date, motif. Chaque ligne est rattachée à sa facture par son numéro ; un rejet remonte dans « à traiter » avec
        son motif.
      </p>
    </Card>
  )
}

// ---------- connecteurs directs (passerelle serveur, sans secret) ----------

const TYPES: { id: TypeConnecteur; label: string }[] = [
  { id: 'banque', label: 'Banque' },
  { id: 'mail', label: 'Mail' },
  { id: 'drive', label: 'Drive' },
  { id: 'cabinet', label: 'Cabinet' },
  { id: 'chorus', label: 'Chorus' },
  { id: 'pdp', label: 'PDP' },
]

function CartePasserelles() {
  const { state, update } = useStore()
  const today = useToday()
  const [type, setType] = useState<TypeConnecteur>('banque')
  const [libelle, setLibelle] = useState('')
  const [url, setUrl] = useState('')
  const [enCours, setEnCours] = useState<string | null>(null)

  const ajouter = () => {
    if (!url.trim().startsWith('https://')) return toast('Une URL de passerelle HTTPS est requise (aucun secret ici).', { tone: 'danger' })
    const c: Connecteur = { id: uid('conn'), type, libelle: libelle.trim() || TYPES.find((t) => t.id === type)!.label, urlPasserelle: url.trim(), actif: true, dernierHealthcheck: null }
    update((s) => {
      s.connecteurs.push(c)
    })
    setLibelle('')
    setUrl('')
    toast('Passerelle enregistrée (URL seule — les secrets restent côté serveur).', { tone: 'ok' })
  }

  const healthcheck = async (c: Connecteur) => {
    if (!c.urlPasserelle) return
    setEnCours(c.id)
    let ok = false
    let detail = ''
    try {
      const rep = await fetch(c.urlPasserelle, { method: 'GET' })
      ok = rep.ok
      detail = `HTTP ${rep.status}`
    } catch (e) {
      detail = String(e).slice(0, 80)
    }
    update((s) => {
      const x = s.connecteurs.find((y) => y.id === c.id)
      if (x) x.dernierHealthcheck = { date: today, ok, detail }
    })
    setEnCours(null)
    toast(ok ? 'Passerelle joignable.' : `Passerelle injoignable (${detail}).`, { tone: ok ? 'ok' : 'danger' })
  }

  const supprimer = (id: string) =>
    update((s) => {
      s.connecteurs = s.connecteurs.filter((x) => x.id !== id)
    })

  return (
    <Card titre="Connecteurs directs — passerelles serveur HTTPS">
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        On enregistre uniquement l'URL HTTPS d'une passerelle serveur et son état de santé. Aucun identifiant, jeton
        ou secret n'est stocké dans le navigateur ni dans les données de l'application.
      </p>
      <div className="form-row">
        <Field label="Type">
          <Select value={type} onChange={(v) => setType(v as TypeConnecteur)} options={TYPES.map((t) => ({ value: t.id, label: t.label }))} />
        </Field>
        <Field label="Libellé">
          <TextInput value={libelle} onChange={setLibelle} placeholder="ex. Passerelle banque" />
        </Field>
        <Field label="URL de passerelle (HTTPS)">
          <TextInput value={url} onChange={setUrl} placeholder="https://passerelle.exemple/healthz" />
        </Field>
        <Field label="&nbsp;">
          <Btn kind="primary" onClick={ajouter}>Enregistrer</Btn>
        </Field>
      </div>
      {state.connecteurs.length > 0 && (
        <Table compact head={['Type', 'Libellé', 'Passerelle', 'Dernier contrôle', '']}>
          {state.connecteurs.map((c) => (
            <tr key={c.id}>
              <td>{TYPES.find((t) => t.id === c.type)?.label || c.type}</td>
              <td>{c.libelle}</td>
              <td className="small mono">{c.urlPasserelle}</td>
              <td>{c.dernierHealthcheck ? <Badge tone={c.dernierHealthcheck.ok ? 'ok' : 'danger'}>{c.dernierHealthcheck.ok ? 'OK' : 'KO'} · {fmtDate(c.dernierHealthcheck.date)}</Badge> : <Badge tone="muted">jamais</Badge>}</td>
              <td>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Btn small onClick={() => void healthcheck(c)} disabled={enCours === c.id}>{enCours === c.id ? '…' : 'Tester'}</Btn>
                  <Btn small onClick={() => supprimer(c.id)}>Retirer</Btn>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  )
}

export default function Connecteurs() {
  const { state } = useStore()
  const today = useToday()
  const diag = useMemo(() => diagnostics(state, today), [state, today])
  return (
    <Page titre="Finance" sousTitre="Connecteurs — diagnostic consolidé et imports.">
      <FinanceNav actif="connecteurs" />
      <Card titre="Diagnostic">
        <div className="grid3">
          {diag.map((d) => (
            <Stat
              key={d.type}
              label={d.libelle}
              value={d.etat === 'ok' ? '✓ connecté' : d.etat === 'partiel' ? '~ partiel' : '— absent'}
              tone={d.etat === 'ok' ? 'ok' : d.etat === 'partiel' ? 'warn' : undefined}
              sub={d.detail}
            />
          ))}
        </div>
      </Card>
      <CarteImportBancaire />
      <CarteImportAchatXml />
      <CarteCycleVie />
      <CartePasserelles />
    </Page>
  )
}
