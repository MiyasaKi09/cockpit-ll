// ============================================================
// Comptable — audit finance F4 : l'échange mensuel devient un
// parcours contrôlé et reproductible. Le Cockpit prépare un
// paquet d'import pour le LOGICIEL DU CABINET (jamais un « FEC »),
// versionne chaque lot avec son empreinte, et importe le retour
// (acceptées / rejetées) sans écraser les pièces opérationnelles.
// ============================================================

import { useMemo, useState } from 'react'
import type { LotComptable, ProfilComptable } from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  Field,
  Modal,
  Page,
  Select,
  Stat,
  Table,
  TextInput,
  confirmer,
  toast,
  useToday,
} from '../ui'
import FinanceNav from './FinanceNav'
import {
  PROFIL_DEFAUT,
  construirePaquet,
  controlesCloture,
  dejaExportees,
  diffLots,
  genererEcritures,
  lireRetourCabinet,
  piecesPeriode,
  telechargerOctets,
} from '../comptable'
import { addMonths, fmtDate, fmtMoney, monthKey, uid } from '../util'

// ------------------------------------------------------------------
// Profil comptable (configuré une fois, avec le cabinet)
// ------------------------------------------------------------------

function CarteProfil() {
  const { state, update } = useStore()
  const profil = state.settings.profilComptable || PROFIL_DEFAUT
  const [ouvert, setOuvert] = useState(false)
  const maj = (patch: Partial<ProfilComptable>) =>
    update((d) => {
      d.settings.profilComptable = { ...(d.settings.profilComptable || PROFIL_DEFAUT), ...patch }
    })
  const majJournal = (cle: keyof ProfilComptable['journaux'], v: string) =>
    update((d) => {
      const p = d.settings.profilComptable || (d.settings.profilComptable = structuredClone(PROFIL_DEFAUT))
      p.journaux = { ...p.journaux, [cle]: v }
    })
  const majCompte = (cle: keyof ProfilComptable['comptes'], v: string) =>
    update((d) => {
      const p = d.settings.profilComptable || (d.settings.profilComptable = structuredClone(PROFIL_DEFAUT))
      p.comptes = { ...p.comptes, [cle]: v }
    })
  return (
    <Card
      titre="Profil comptable — à caler UNE fois avec le cabinet"
      actions={<Btn small onClick={() => setOuvert((o) => !o)}>{ouvert ? 'Replier' : 'Configurer'}</Btn>}
    >
      <p className="small muted" style={{ margin: 0 }}>
        {profil.logiciel ? `Logiciel : ${profil.logiciel} · ` : ''}journaux {profil.journaux.ventes}/{profil.journaux.achats}/
        {profil.journaux.banque}/{profil.journaux.od} · dates {profil.formatDate} · séparateur « {profil.separateur} » ·
        analytique {profil.analytique ? 'projet/phase' : 'désactivée'} — les comptes sont des PROPOSITIONS à confirmer
        (le plan réel appartient au cabinet, audit §11.7).
      </p>
      {ouvert && (
        <>
          <div className="form-row" style={{ marginTop: 10 }}>
            <Field label="Logiciel du cabinet">
              <TextInput value={profil.logiciel || ''} onChange={(v) => maj({ logiciel: v })} placeholder="ex. Cegid, ACD, Pennylane…" />
            </Field>
            <Field label="Séparateur CSV">
              <Select value={profil.separateur} onChange={(v) => maj({ separateur: v as ProfilComptable['separateur'] })} options={[{ value: ';', label: '; (point-virgule)' }, { value: ',', label: ', (virgule)' }, { value: 'tab', label: 'tabulation' }]} />
            </Field>
            <Field label="Format de date">
              <Select value={profil.formatDate} onChange={(v) => maj({ formatDate: v as ProfilComptable['formatDate'] })} options={[{ value: 'JJ/MM/AAAA', label: 'JJ/MM/AAAA' }, { value: 'AAAA-MM-JJ', label: 'AAAA-MM-JJ' }]} />
            </Field>
            <Field label="Analytique projet/phase">
              <Select value={profil.analytique ? 'oui' : 'non'} onChange={(v) => maj({ analytique: v === 'oui' })} options={[{ value: 'oui', label: 'exportée' }, { value: 'non', label: 'non exportée' }]} />
            </Field>
          </div>
          <div className="form-row" style={{ marginTop: 10 }}>
            {(
              [
                ['ventes', 'Journal ventes'],
                ['achats', 'Journal achats'],
                ['banque', 'Journal banque'],
                ['od', 'Journal OD'],
              ] as const
            ).map(([cle, label]) => (
              <Field key={cle} label={label}>
                <TextInput value={profil.journaux[cle]} onChange={(v) => majJournal(cle, v)} />
              </Field>
            ))}
          </div>
          <div className="form-row" style={{ marginTop: 10 }}>
            {(
              [
                ['produits', 'Produits (70x)'],
                ['clients', 'Clients (411)'],
                ['fournisseurs', 'Fournisseurs (401)'],
                ['tvaCollectee', 'TVA collectée'],
              ] as const
            ).map(([cle, label]) => (
              <Field key={cle} label={label}>
                <TextInput value={profil.comptes[cle]} onChange={(v) => majCompte(cle, v)} />
              </Field>
            ))}
          </div>
          <div className="form-row" style={{ marginTop: 10 }}>
            {(
              [
                ['tvaDeductible', 'TVA déductible'],
                ['banque', 'Banque (512)'],
                ['notesFrais', 'Notes de frais (421/467)'],
                ['chargesDefaut', 'Charges par défaut (60x)'],
              ] as const
            ).map(([cle, label]) => (
              <Field key={cle} label={label}>
                <TextInput value={profil.comptes[cle]} onChange={(v) => majCompte(cle, v)} />
              </Field>
            ))}
          </div>
          <div className="form-row" style={{ marginTop: 10 }}>
            <Field label="Régime de TVA (confirmé par le cabinet)">
              <TextInput value={profil.regimeTVA || ''} onChange={(v) => maj({ regimeTVA: v })} placeholder="ex. réel normal, TVA sur les encaissements" />
            </Field>
          </div>
        </>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------
// Retour du cabinet
// ------------------------------------------------------------------

function RetourModal({ lot, onClose }: { lot: LotComptable; onClose: () => void }) {
  const { state, update } = useStore()
  const today = useToday()
  const [texte, setTexte] = useState('')
  const lignes = useMemo(() => lireRetourCabinet(texte), [texte])
  const idsConnus = new Set([...lot.factureIds, ...lot.achatIds, ...lot.fraisIds, ...lot.paiementIds])
  const inconnues = lignes.filter((l) => !idsConnus.has(l.pieceId)).length

  const appliquer = () => {
    if (lignes.length === 0) return toast('Rien de lisible — colonnes attendues : source_id ; statut ; motif.', { tone: 'danger' })
    const rejets = lignes.filter((l) => l.statut === 'rejetee').map((l) => ({ pieceId: l.pieceId, motif: l.motif || 'motif non précisé' }))
    const acceptees = lignes.filter((l) => l.statut === 'acceptee').length
    update((d) => {
      for (const l of lignes) {
        const vente = d.factures.find((f) => f.id === l.pieceId)
        if (vente) {
          vente.statutComptable = l.statut === 'acceptee' ? 'comptabilise' : 'rejete'
          vente.motifRejetComptable = l.statut === 'rejetee' ? l.motif : undefined
        }
        const achat = d.facturesAchat.find((f) => f.id === l.pieceId)
        if (achat) {
          achat.statutComptable = l.statut === 'acceptee' ? 'comptabilise' : 'rejete'
          achat.motifRejetComptable = l.statut === 'rejetee' ? l.motif : undefined
        }
        const frais = d.notesFrais.find((f) => f.id === l.pieceId)
        if (frais) frais.statutComptable = l.statut === 'acceptee' ? 'comptabilise' : 'rejete'
        const paiement = d.paiements.find((f) => f.id === l.pieceId)
        if (paiement) paiement.statutComptable = l.statut === 'acceptee' ? 'comptabilise' : 'rejete'
      }
      const x = d.lotsComptables.find((y) => y.id === lot.id)
      if (x) {
        x.statut = 'retour_recu'
        x.retour = { date: today, acceptees, rejets }
      }
    })
    toast(`Retour appliqué : ${acceptees} acceptée(s), ${rejets.length} rejet(s) — chaque rejet devient une action précise.`, { tone: 'ok' })
    onClose()
  }

  return (
    <Modal titre={`Retour du cabinet — lot ${lot.periode} v${lot.version}`} onClose={onClose} large>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        Collez le fichier renvoyé par le cabinet (CSV : <code>source_id;statut;motif</code> — statut «
        acceptée/importée » ou « rejetée »). Les statuts COMPTABLES sont mis à jour, les pièces opérationnelles ne
        bougent pas.
      </p>
      <textarea
        className="input"
        style={{ width: '100%', minHeight: 140, fontFamily: 'monospace' }}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        placeholder={'source_id;statut;motif\n2026-003;acceptee;\nfa-p03-bet;rejetee;compte 604 inconnu'}
      />
      <p className="small" style={{ margin: '8px 0 0' }}>
        {lignes.length} ligne(s) lue(s)
        {inconnues > 0 && <span className="warn-text"> · {inconnues} identifiant(s) hors de ce lot (appliqués quand même s'ils existent)</span>}
      </p>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={appliquer}>
          Appliquer le retour
        </Btn>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function Comptable() {
  const { state, update } = useStore()
  const today = useToday()
  const [periode, setPeriode] = useState(() => addMonths(monthKey(today), -1))
  const [apercu, setApercu] = useState(false)
  const [retourPour, setRetourPour] = useState<LotComptable | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)

  const cloture = useMemo(() => controlesCloture(state, periode, today), [state, periode, today])
  const pieces = useMemo(() => piecesPeriode(state, periode), [state, periode])
  const ecritures = useMemo(
    () => (apercu ? genererEcritures(state, periode, state.settings.profilComptable || PROFIL_DEFAUT) : []),
    [apercu, state, periode],
  )
  const lotsPeriode = state.lotsComptables.filter((l) => l.periode === periode).sort((a, b) => a.version - b.version)
  const lotsTous = [...state.lotsComptables].sort((a, b) => b.periode.localeCompare(a.periode) || b.version - a.version)

  const idsCandidats = {
    factureIds: pieces.ventes.map((f) => f.id),
    achatIds: pieces.achats.map((f) => f.id),
    fraisIds: pieces.frais.map((f) => f.id),
    paiementIds: pieces.paiements.map((f) => f.id),
  }
  // pièces déjà présentes dans un lot d'une AUTRE période (jamais réexportées
  // sans alerte) — les versions de la période courante ont leur propre diff
  const rejouees = dejaExportees(
    state,
    [...idsCandidats.factureIds, ...idsCandidats.achatIds, ...idsCandidats.fraisIds, ...idsCandidats.paiementIds],
    periode,
  )

  const options: { value: string; label: string }[] = []
  for (let n = 0; n < 14; n++) {
    const m = addMonths(monthKey(today), -n)
    options.push({ value: m, label: m })
  }

  const exporter = async () => {
    if (cloture.bloquants > 0) {
      if (!(await confirmer({ message: `${cloture.bloquants} contrôle(s) BLOQUANT(S) restent ouverts sur ${periode}.\n\nExporter quand même ? Le cabinet recevra un paquet incomplet.`, danger: true, confirmerLabel: 'Exporter malgré tout' }))) return
    }
    const precedent = lotsPeriode[lotsPeriode.length - 1]
    if (precedent) {
      const diff = diffLots(precedent, idsCandidats)
      if (!(await confirmer({
        message: `La période ${periode} a déjà été exportée (v${precedent.version}).\n\nCe nouvel export créera la version ${precedent.version + 1} :\n· ${diff.ajoutes.length} pièce(s) ajoutée(s)\n· ${diff.retires.length} retirée(s)\n· ${diff.communs} inchangée(s) — le cabinet doit être prévenu pour ne rien saisir deux fois.`,
        danger: true,
        confirmerLabel: `Créer la version ${precedent.version + 1}`,
      }))) return
    }
    setExportEnCours(true)
    try {
      const version = precedent ? precedent.version + 1 : 1
      const paquet = await construirePaquet(state, periode, version, today)
      // lot construit AVANT la mutation (producteur rejouable)
      const lot: LotComptable = {
        id: uid('lot'),
        periode,
        version,
        dateExport: today,
        empreinte: paquet.empreinte,
        nomFichier: paquet.nomFichier,
        ...idsCandidats,
        controles: cloture.controles.map((c) => `${c.niveau}: ${c.libelle}${c.detail ? ` — ${c.detail}` : ''}`),
        statut: 'exporte',
      }
      telechargerOctets(paquet.nomFichier, paquet.octets)
      update((d) => {
        d.lotsComptables.push(lot)
        // statut comptable « exporté » posé sur chaque pièce, sans toucher au reste
        for (const id of lot.factureIds) {
          const f = d.factures.find((x) => x.id === id)
          if (f) {
            f.statutComptable = f.statutComptable === 'comptabilise' ? 'comptabilise' : 'exporte'
            f.lotComptableId = lot.id
          }
        }
        for (const id of lot.achatIds) {
          const f = d.facturesAchat.find((x) => x.id === id)
          if (f) {
            f.statutComptable = f.statutComptable === 'comptabilise' ? 'comptabilise' : 'exporte'
            f.lotComptableId = lot.id
          }
        }
        for (const id of lot.fraisIds) {
          const f = d.notesFrais.find((x) => x.id === id)
          if (f) {
            f.statutComptable = f.statutComptable === 'comptabilise' ? 'comptabilise' : 'exporte'
            f.lotComptableId = lot.id
          }
        }
        for (const id of lot.paiementIds) {
          const f = d.paiements.find((x) => x.id === id)
          if (f) {
            f.statutComptable = f.statutComptable === 'comptabilise' ? 'comptabilise' : 'exporte'
            f.lotComptableId = lot.id
          }
        }
      })
      toast(`Lot ${periode} v${version} exporté et verrouillé (empreinte ${paquet.empreinte.slice(0, 12)}…).`, { tone: 'ok' })
    } finally {
      setExportEnCours(false)
    }
  }

  return (
    <Page titre="Finance" sousTitre="Comptable — clôture mensuelle guidée et paquet d'import pour le cabinet.">
      <FinanceNav actif="comptable" />

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <Select value={periode} onChange={setPeriode} options={options} />
        <span style={{ fontWeight: 650 }}>
          {periode} — {cloture.pctPret} % prêt
        </span>
        <span className="small muted">
          {cloture.bloquants} bloquant(s) · {cloture.aVerifier} à vérifier
        </span>
        <div className="spacer" />
        <Btn small onClick={() => setApercu((a) => !a)}>
          {apercu ? "Fermer l'aperçu" : "Prévisualiser l'export"}
        </Btn>
        <Btn kind="primary" onClick={() => void exporter()} disabled={exportEnCours}>
          {exportEnCours ? 'Export…' : 'Exporter et verrouiller'}
        </Btn>
      </div>

      <div className="grid4" style={{ marginBottom: 16 }}>
        <Stat label="Ventes" value={pieces.ventes.length} sub={fmtMoney(pieces.ventes.reduce((s, f) => s + (f.figee?.totalHT ?? f.montantHT), 0)) + ' HT'} />
        <Stat label="Achats" value={pieces.achats.length} sub={fmtMoney(pieces.achats.reduce((s, f) => s + f.montantHT, 0)) + ' HT'} />
        <Stat label="Notes de frais" value={pieces.frais.length} sub={fmtMoney(pieces.frais.reduce((s, f) => s + f.montantTTC, 0)) + ' TTC'} />
        <Stat label="Paiements" value={pieces.paiements.length} sub={fmtMoney(pieces.paiements.reduce((s, f) => s + f.montant, 0)) + ' TTC'} />
      </div>

      {rejouees.length > 0 && (
        <div className="pill-note" style={{ marginBottom: 12 }}>
          ⚠ {rejouees.length} pièce(s) de cette sélection figurent déjà dans un lot d'une AUTRE période — jamais
          réexportées sans cette alerte (vérifier avec le cabinet).
        </div>
      )}

      <Card titre="Checklist de clôture">
        <Table compact head={['Contrôle', 'État', '']}>
          {cloture.controles.map((c, i) => (
            <tr key={i}>
              <td>
                {c.libelle}
                {c.detail && <div className="muted small">{c.detail}</div>}
              </td>
              <td>
                {c.niveau === 'ok' ? <Badge tone="ok">ok</Badge> : c.niveau === 'bloquant' ? <Badge tone="danger">bloquant</Badge> : <Badge tone="warn">à vérifier</Badge>}
              </td>
              <td>{c.lien && c.niveau !== 'ok' && <a href={c.lien} className="small">corriger →</a>}</td>
            </tr>
          ))}
        </Table>
      </Card>

      {apercu && (
        <Card titre={`Aperçu des écritures (${ecritures.length})`}>
          {ecritures.length === 0 ? (
            <EmptyState>Aucune écriture sur {periode}.</EmptyState>
          ) : (
            <>
              <Table compact head={['Journal', 'Date', 'Pièce', 'Compte', 'Tiers', 'Libellé', <span key="d" className="right">Débit</span>, <span key="c" className="right">Crédit</span>]}>
                {ecritures.slice(0, 80).map((e, i) => (
                  <tr key={i}>
                    <td className="mono small">{e.journal}</td>
                    <td className="small">{fmtDate(e.datePiece)}</td>
                    <td className="mono small">{e.numeroPiece}</td>
                    <td className="mono small">{e.compteGeneral}</td>
                    <td className="mono small">{e.compteTiers || ''}</td>
                    <td className="small">{e.libelle.slice(0, 44)}</td>
                    <td className="right num">{e.debit ? fmtMoney(e.debit, true) : ''}</td>
                    <td className="right num">{e.credit ? fmtMoney(e.credit, true) : ''}</td>
                  </tr>
                ))}
              </Table>
              <p className="small" style={{ margin: '8px 2px 0' }}>
                {ecritures.length > 80 && `… ${ecritures.length - 80} ligne(s) de plus dans l'export · `}
                Totaux : débit <strong>{fmtMoney(ecritures.reduce((s, e) => s + e.debit, 0), true)}</strong> · crédit{' '}
                <strong>{fmtMoney(ecritures.reduce((s, e) => s + e.credit, 0), true)}</strong>
              </p>
            </>
          )}
        </Card>
      )}

      <CarteProfil />

      <Card titre={`Lots exportés (${lotsTous.length})`}>
        {lotsTous.length === 0 ? (
          <EmptyState>
            Aucun lot — le premier export produira <code>{monthKey(today)}_Cockpit-LL_Comptabilite_v1.zip</code>{' '}
            (manifeste, contrôles, tiers, ventes, achats, notes de frais, paiements).
          </EmptyState>
        ) : (
          <Table compact head={['Période', 'V', 'Exporté le', 'Contenu', 'Empreinte', 'Retour', '']}>
            {lotsTous.map((l) => {
              const precedent = state.lotsComptables.find((x) => x.periode === l.periode && x.version === l.version - 1)
              const diff = precedent ? diffLots(precedent, l) : null
              return (
                <tr key={l.id}>
                  <td className="mono">{l.periode}</td>
                  <td>
                    v{l.version}
                    {diff && (
                      <div className="muted small" title={`vs v${l.version - 1}`}>
                        +{diff.ajoutes.length} / −{diff.retires.length}
                      </div>
                    )}
                  </td>
                  <td>
                    <DateFmt d={l.dateExport} />
                  </td>
                  <td className="small">
                    {l.factureIds.length} ventes · {l.achatIds.length} achats · {l.fraisIds.length} NDF · {l.paiementIds.length} paiements
                  </td>
                  <td className="mono small" title={l.empreinte}>
                    {(l.empreinte || '').slice(0, 12) || '—'}
                  </td>
                  <td>
                    {l.retour ? (
                      <span className="small">
                        <Badge tone={l.retour.rejets.length > 0 ? 'warn' : 'ok'}>
                          {l.retour.acceptees} ok · {l.retour.rejets.length} rejet(s)
                        </Badge>
                        {l.retour.rejets.slice(0, 2).map((r) => (
                          <div key={r.pieceId} className="danger-text small">
                            {r.pieceId} — {r.motif}
                          </div>
                        ))}
                      </span>
                    ) : (
                      <Badge tone="muted">en attente</Badge>
                    )}
                  </td>
                  <td>
                    <Btn small onClick={() => setRetourPour(l)}>
                      Importer le retour…
                    </Btn>
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
        <p className="muted small" style={{ margin: '10px 2px 0' }}>
          Après export, le lot est figé (empreinte SHA-256) et chaque pièce porte son statut comptable. Une
          correction passe par une nouvelle version, jamais par une modification silencieuse. Le FEC officiel est
          produit par le logiciel du cabinet, pas par le Cockpit.
        </p>
      </Card>

      {retourPour && <RetourModal lot={retourPour} onClose={() => setRetourPour(null)} />}
    </Page>
  )
}

function DateFmt({ d }: { d: string }) {
  return <>{fmtDate(d)}</>
}
