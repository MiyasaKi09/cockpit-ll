// ============================================================
// Banque & trésorerie — audit finance F3.
// - POINT D'IMPORT UNIQUE des relevés (CAMT.053, OFX/QFX, QIF, CSV),
//   mapping mémorisé pour le CSV, idempotent, avec le SOLDE DE FIN :
//   une seconde carte d'import vivait dans Connecteurs et enregistrait
//   `soldeFinal: null` — un relevé importé par là ne mettait jamais à
//   jour la trésorerie, sans un mot (lot D2, constat R3) ;
// - CONNEXION BANCAIRE DIRECTE (GoCardless, lecture seule) : le même
//   point d'entrée, le même `preparerImport`, le même solde de fin.
//   L'import de fichier RESTE — il marche hors ligne, sans contrat, et
//   c'est le repli quand le consentement DSP2 expire (tous les 90 jours) ;
// - rapprochement PROPOSÉ (montant, référence, tiers), validé à la
//   main — jamais appliqué silencieusement ;
// - le solde manuel devient « solde d'ouverture manuel » dès qu'un
//   relevé existe (écart affiché) ;
// - prévision 13 semaines, 3 scénarios, chaque point EXPLICABLE.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppState,
  ConnexionBancaire,
  Facture,
  ImportBancaire,
  MappingBancaire,
  TransactionBancaire,
} from '../types'
import { useStore } from '../store'
import {
  Badge,
  Btn,
  Card,
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
  TextInput,
  confirmer,
  toast,
  useRoute,
  useToday,
} from '../ui'
import FinanceNav from './FinanceNav'
import { clientSupabase } from '../sync'
import {
  decouperLigneCSV,
  devinerMapping,
  ecartSoldeManuel,
  lireReleve,
  preparerImport,
  soldeBancaire,
  suggestionsPourCredit,
} from '../banque'
import {
  choisirSolde,
  confirmerSynchronisation,
  deconnecterBanque,
  demarrerConnexionBancaire,
  etatConsentement,
  etatSynchronisation,
  finaliserConnexions,
  fusionnerConnexions,
  libelleStatutConnexion,
  listerBanques,
  lireStatutBanque,
  operationsVersLignes,
  reconnecterBanque,
  synchroniserBanque,
  type BanqueDisponible,
  type ConnexionDistante,
  type ResultatConnexion,
} from '../banqueApi'
import {
  detecterFormatBancaire,
  lireCAMT053,
  lireOFX,
  lireQIF,
  type FormatBancaire,
} from '../imports'
import {
  contratsPourDebit,
  erreurRapprochementAchat,
  suggestionsAchatPourDebit,
} from '../achats'
import { prevision13Semaines, type Prevision13, type Scenario } from '../tresorerie'
import { nouveauPaiement, soldeFacture, validerPaiement } from '../facture'
import { nomProjet } from '../derive'
import { fmtDate, fmtMoney, fold, uid } from '../util'

// ------------------------------------------------------------------
// Courbe de trésorerie 13 semaines (partagée avec la Vue d'ensemble)
// ------------------------------------------------------------------

export function CourbeTresorerie({ prevision, seuil }: { prevision: Prevision13; seuil: number }) {
  const largeur = 520
  const hauteur = 120
  const soldes = [prevision.soldeDepart, ...prevision.semaines.map((s) => s.solde)]
  const min = Math.min(...soldes, seuil, 0)
  const max = Math.max(...soldes, 1)
  const y = (v: number) => hauteur - ((v - min) / (max - min || 1)) * (hauteur - 14) - 7
  const xPas = largeur / (soldes.length - 1)
  const points = soldes.map((v, i) => `${Math.round(i * xPas)},${Math.round(y(v))}`).join(' ')
  const yZero = y(0)
  return (
    <svg
      viewBox={`0 0 ${largeur} ${hauteur}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label="Courbe de trésorerie prévisionnelle sur 13 semaines"
    >
      {min < 0 && <line x1={0} y1={yZero} x2={largeur} y2={yZero} stroke="var(--danger)" strokeDasharray="4 4" strokeWidth={1} />}
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {soldes.map((v, i) => (
        <circle key={i} cx={Math.round(i * xPas)} cy={Math.round(y(v))} r={2.5} fill={v < seuil ? 'var(--danger)' : 'var(--accent)'} />
      ))}
    </svg>
  )
}

// ------------------------------------------------------------------
// Import de relevé — POINT UNIQUE, quatre formats (D2)
// ------------------------------------------------------------------

const LIBELLES_FORMAT: Record<FormatBancaire, string> = {
  camt: 'CAMT.053 (ISO 20022)',
  ofx: 'OFX / QFX',
  qif: 'QIF',
  csv: 'CSV',
}

function ImportModal({ texte, nomFichier, onClose }: { texte: string; nomFichier: string; onClose: () => void }) {
  const { state, update } = useStore()
  const format = useMemo(() => detecterFormatBancaire(texte, nomFichier), [texte, nomFichier])
  // le mapping de colonnes ne sert QU'au CSV — les trois formats structurés se
  // lisent seuls et n'y touchent pas (ni en lecture, ni en mémorisation)
  const [mapping, setMapping] = useState<MappingBancaire>(() => state.settings.banqueMapping || devinerMapping(texte))
  const [soldeFinal, setSoldeFinal] = useState<number | null>(null)
  const [dateSolde, setDateSolde] = useState<string | null>(null)
  const set = (patch: Partial<MappingBancaire>) => setMapping((m) => ({ ...m, ...patch }))

  // les trois formats structurés se lisent seuls ; seul le CSV a besoin d'un
  // mapping de colonnes, et lui seul le mémorise
  const lecture = useMemo(() => {
    if (format === 'camt') return { lignes: lireCAMT053(texte), ignorées: 0 }
    if (format === 'ofx') return { lignes: lireOFX(texte), ignorées: 0 }
    if (format === 'qif') return { lignes: lireQIF(texte), ignorées: 0 }
    return lireReleve(texte, mapping)
  }, [format, texte, mapping])
  const colonnes = useMemo(() => {
    if (format !== 'csv') return []
    const premiere = texte.split(/\r?\n/).find((l) => l.trim()) || ''
    return decouperLigneCSV(premiere, mapping.separateur)
  }, [format, texte, mapping.separateur])
  const optionsColonnes = colonnes.map((c, i) => ({ value: String(i), label: `${i + 1} — ${c.slice(0, 24) || '(vide)'}` }))
  const derniereDate = useMemo(() => [...lecture.lignes].map((l) => l.date).sort().pop() || null, [lecture.lignes])

  const importer = () => {
    if (lecture.lignes.length === 0)
      return toast(format === 'csv' ? 'Aucune ligne lisible avec ce mapping.' : `Aucune ligne lisible (${format.toUpperCase()}).`, { tone: 'danger' })
    // tout est calculé AVANT la mutation (producteur rejouable)
    const importId = uid('imp')
    const { nouvelles, doublons } = preparerImport(state, lecture.lignes, importId)
    const meta = {
      id: importId,
      date: new Date().toISOString().slice(0, 10),
      nomFichier,
      nbLignes: lecture.lignes.length,
      nbNouvelles: nouvelles.length,
      soldeFinal,
      dateSolde: soldeFinal != null ? dateSolde || derniereDate : null,
    }
    update((d) => {
      d.transactionsBancaires.push(...nouvelles)
      d.importsBancaires.push(meta)
      if (format === 'csv') d.settings.banqueMapping = mapping
    })
    toast(
      `${format.toUpperCase()} : ${nouvelles.length} mouvement(s) importé(s), ${doublons} déjà connu(s)${lecture.ignorées ? `, ${lecture.ignorées} ligne(s) illisible(s)` : ''}${soldeFinal == null ? ' — sans solde de fin, la trésorerie affichée ne bouge pas' : ''}.`,
      { tone: 'ok' },
    )
    onClose()
  }

  return (
    <Modal titre={`Importer le relevé — ${nomFichier}`} onClose={onClose} large>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        Format reconnu : <strong>{LIBELLES_FORMAT[format]}</strong>. Réimporter le même relevé n'ajoutera aucune
        ligne (identifiant date + montant + libellé)
        {format === 'csv' ? ' — et le mapping des colonnes est mémorisé pour les prochains imports.' : '.'}
      </p>
      {format === 'csv' && (
        <>
          <div className="form-row">
            <Field label="Séparateur">
              <Select
                value={mapping.separateur === '\t' ? 'tab' : mapping.separateur}
                onChange={(v) => set({ separateur: v === 'tab' ? '\t' : v })}
                options={[{ value: ';', label: '; (point-virgule)' }, { value: ',', label: ', (virgule)' }, { value: 'tab', label: 'tabulation' }]}
              />
            </Field>
            <Field label="Format de date">
              <Select
                value={mapping.formatDate}
                onChange={(v) => set({ formatDate: v as MappingBancaire['formatDate'] })}
                options={[{ value: 'JJ/MM/AAAA', label: 'JJ/MM/AAAA' }, { value: 'AAAA-MM-JJ', label: 'AAAA-MM-JJ' }]}
              />
            </Field>
            <Field label="Première ligne">
              <Select
                value={mapping.entete ? 'oui' : 'non'}
                onChange={(v) => set({ entete: v === 'oui' })}
                options={[{ value: 'oui', label: 'en-têtes (ignorée)' }, { value: 'non', label: 'données' }]}
              />
            </Field>
          </div>
          <div className="form-row" style={{ marginTop: 10 }}>
            <Field label="Colonne date">
              <Select value={String(mapping.colDate)} onChange={(v) => set({ colDate: Number(v) })} options={optionsColonnes} />
            </Field>
            <Field label="Colonne libellé">
              <Select value={String(mapping.colLibelle)} onChange={(v) => set({ colLibelle: Number(v) })} options={optionsColonnes} />
            </Field>
            <Field label="Montant (signé)" hint="ou débit/crédit séparés ci-dessous">
              <Select
                value={mapping.colMontant == null ? '' : String(mapping.colMontant)}
                onChange={(v) => set({ colMontant: v === '' ? null : Number(v) })}
                options={[{ value: '', label: '— débit/crédit séparés —' }, ...optionsColonnes]}
              />
            </Field>
          </div>
          {mapping.colMontant == null && (
            <div className="form-row" style={{ marginTop: 10 }}>
              <Field label="Colonne débit">
                <Select value={String(mapping.colDebit ?? '')} onChange={(v) => set({ colDebit: v === '' ? null : Number(v) })} options={[{ value: '', label: '—' }, ...optionsColonnes]} />
              </Field>
              <Field label="Colonne crédit">
                <Select value={String(mapping.colCredit ?? '')} onChange={(v) => set({ colCredit: v === '' ? null : Number(v) })} options={[{ value: '', label: '—' }, ...optionsColonnes]} />
              </Field>
            </div>
          )}
        </>
      )}
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Solde de fin de relevé (€)" hint="c'est LUI qui cale la trésorerie affichée — le relevé le porte en dernière page">
          <NumInput value={soldeFinal} onChange={setSoldeFinal} />
        </Field>
        <Field label="Date du solde" hint={derniereDate ? `à défaut, la dernière ligne du relevé (${fmtDate(derniereDate)})` : undefined}>
          <DateInput value={dateSolde} onChange={setDateSolde} />
        </Field>
      </div>
      {/* « null n'est pas 0 » : sans solde de fin on importe des mouvements,
          pas un solde — et on le DIT plutôt que d'afficher une trésorerie fausse */}
      {soldeFinal == null && (
        <p className="pill-note" style={{ marginTop: 10 }}>
          Sans le solde de fin, les mouvements entrent mais le solde bancaire affiché ne bouge pas : la trésorerie
          restera celle du dernier relevé soldé.
        </p>
      )}
      <div style={{ marginTop: 12 }}>
        <div className="small" style={{ fontWeight: 650, marginBottom: 4 }}>
          Aperçu : {lecture.lignes.length} ligne(s) lisible(s){lecture.ignorées ? ` · ${lecture.ignorées} ignorée(s)` : ''}
        </div>
        {lecture.lignes.slice(0, 4).map((l, i) => (
          <div key={i} className="small muted">
            {l.date} · {fmtMoney(l.montant, true)} · {l.libelle.slice(0, 60)}
          </div>
        ))}
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" onClick={importer}>
          Importer {lecture.lignes.length} mouvement(s)
        </Btn>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------
// Connexion bancaire directe — GoCardless Bank Account Data, LECTURE SEULE
// ------------------------------------------------------------------
//
// CE QUI PASSE PAR LÀ, ET CE QUI N'Y PASSE PAS
// ---------------------------------------------
// Les identifiants GoCardless vivent dans les secrets de la fonction Edge
// `banque-sync` : le navigateur ne connaît ni clé, ni jeton, ni identifiant
// de compte GoCardless. Il demande, il reçoit des opérations et des soldes,
// et c'est TOUT.
//
// Les opérations reçues entrent par `preparerImport` — le même producteur
// que les quatre formats de fichier, déjà idempotent sur date + montant +
// libellé. C'est pour ça que `operationsVersLignes` (src/banqueApi.ts) copie
// champ par champ la lecture du CAMT.053 : synchroniser le matin et importer
// le relevé de la même banque l'après-midi ne doit rien dupliquer.
//
// LE SOLDE EST ÉCRIT. C'était le défaut du lot D2 : une carte d'import
// enregistrait `soldeFinal: null` et la trésorerie ne bougeait jamais, sans
// un mot. Ici le solde de fin part dans la trace d'import — et quand la
// banque n'en publie aucun d'exploitable, on écrit l'absence ET on la dit.

/** Fenêtre rapatriée à chaque synchronisation.
 *
 *  Elle est FIXE, et c'est important : `idsTransactions` numérote les lignes
 *  identiques d'un même lot (deux paiements du même montant le même jour).
 *  Une fenêtre glissante couperait la paire en deux lots et le second
 *  mouvement passerait pour un doublon. Une fenêtre constante rejoue toujours
 *  le même ensemble — et rattrape au passage les trous. */
const FENETRE_SYNCHRO_JOURS = 90

function LigneConnexion({
  connexion,
  cible,
  occupe,
  onSynchroniser,
  onReconnecter,
  onRetirer,
}: {
  connexion: ConnexionBancaire
  cible: string | null
  occupe: string | null
  onSynchroniser: () => void
  onReconnecter: () => void
  onRetirer: () => void
}) {
  const today = useToday()
  const consentement = etatConsentement(connexion, today)
  const synchro = etatSynchronisation(connexion, today)
  const enCours = occupe === connexion.id
  const vise = cible === connexion.id
  return (
    <tr style={vise ? { outline: '2px solid var(--accent)' } : undefined}>
      <td>
        <strong>{connexion.banque}</strong>
        {connexion.comptes.length > 0 && (
          <div className="small muted">
            {connexion.comptes
              .map((c) => [c.libelle, c.ibanMasque].filter(Boolean).join(' ') || 'compte')
              .join(' · ')}
          </div>
        )}
      </td>
      <td>
        <Badge
          tone={
            connexion.statut === 'liee' ? 'ok' : connexion.statut === 'en_attente' ? 'warn' : 'danger'
          }
        >
          {libelleStatutConnexion(connexion.statut)}
        </Badge>
        {connexion.statut === 'en_attente' && (
          <div className="small muted">terminez le parcours chez votre banque, puis « Finaliser »</div>
        )}
      </td>
      <td>
        {/* « null n'est pas 0 » : une expiration inconnue se dit, elle ne se
            remplace pas par une date rassurante. */}
        {!consentement.connu ? (
          <span className="muted small">inconnue — elle se lira au premier retour de la banque</span>
        ) : consentement.expire ? (
          <span className="danger-text small">expirée — reconnexion nécessaire</span>
        ) : (
          <span className={consentement.alerter ? 'danger-text small' : 'small'}>
            {fmtDate(connexion.consentementExpireLe?.slice(0, 10) || today)} (J−{consentement.jours})
          </span>
        )}
      </td>
      <td>
        {/* L'état que le lot voulait rendre impossible à manquer : une
            synchronisation morte depuis trois semaines. */}
        {connexion.derniereSyncLe ? (
          <span className={synchro.alerter ? 'danger-text small' : 'small'}>
            {fmtDate(connexion.derniereSyncLe)}
            {synchro.jours != null && synchro.jours > 0 ? ` (il y a ${synchro.jours} j)` : ''}
          </span>
        ) : (
          <span className="muted small">jamais</span>
        )}
        {connexion.derniereSyncResultat && (
          <div className="muted small">{connexion.derniereSyncResultat}</div>
        )}
      </td>
      <td className="right num">
        {connexion.comptes.map((c) => (
          <div key={c.id} className="small">
            {c.dernierSolde != null ? (
              <>
                {fmtMoney(c.dernierSolde, true)}
                <span className="muted"> {c.dernierSoldeType || 'type inconnu'}</span>
              </>
            ) : (
              <span className="muted">
                aucun solde publié{c.typesSoldeVus.length > 0 ? ` (types vus : ${c.typesSoldeVus.join(', ')})` : ''}
              </span>
            )}
          </div>
        ))}
        {connexion.comptes.length === 0 && <span className="muted small">—</span>}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {connexion.statut === 'liee' && (
            <Btn small kind="primary" disabled={enCours} onClick={onSynchroniser}>
              {enCours ? '…' : 'Synchroniser'}
            </Btn>
          )}
          <Btn
            small
            kind={consentement.alerter ? 'primary' : 'default'}
            disabled={enCours}
            onClick={onReconnecter}
            title="Refaire le parcours d'authentification chez la banque — la DSP2 n'offre aucune prolongation"
          >
            Reconnecter
          </Btn>
          <Btn small disabled={enCours} onClick={onRetirer}>
            Retirer
          </Btn>
        </div>
      </td>
    </tr>
  )
}

function ModalChoixBanque({
  banques,
  onChoisir,
  onClose,
}: {
  banques: BanqueDisponible[]
  onChoisir: (b: BanqueDisponible) => void
  onClose: () => void
}) {
  const [filtre, setFiltre] = useState('')
  const [choisie, setChoisie] = useState('')
  const visibles = useMemo(() => {
    const f = fold(filtre)
    return banques.filter((b) => !f || fold(b.nom).includes(f)).slice(0, 300)
  }, [banques, filtre])
  const banque = banques.find((b) => b.id === choisie) || null
  return (
    <Modal titre="Connecter un compte bancaire (lecture seule)" onClose={onClose}>
      <p className="small" style={{ margin: '0 0 10px' }}>
        Vous serez renvoyé vers votre banque pour autoriser la <strong>lecture</strong> des opérations et du
        solde. Aucun ordre ne peut être émis. L'autorisation vaut <strong>90 jours</strong> (règle DSP2) : le
        Cockpit préviendra une semaine avant l'échéance.
      </p>
      <div className="form-row">
        <Field label="Chercher">
          <TextInput value={filtre} onChange={setFiltre} placeholder="nom de la banque" />
        </Field>
        <Field label={`Banque (${visibles.length})`}>
          <Select
            value={choisie}
            onChange={setChoisie}
            options={[{ value: '', label: '— choisir —' }, ...visibles.map((b) => ({ value: b.id, label: b.nom }))]}
          />
        </Field>
      </div>
      <div className="form-foot">
        <Btn onClick={onClose}>Annuler</Btn>
        <Btn kind="primary" disabled={!banque} onClick={() => banque && onChoisir(banque)}>
          Ouvrir la page de ma banque
        </Btn>
      </div>
    </Modal>
  )
}

function CarteConnexionBancaire({ cible }: { cible: string | null }) {
  const { state, update } = useStore()
  const today = useToday()
  const sb = clientSupabase()
  const [configure, setConfigure] = useState<boolean | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [occupe, setOccupe] = useState<string | null>(null)
  const [banques, setBanques] = useState<BanqueDisponible[] | null>(null)

  const connexions = state.connexionsBancaires
  const enAttente = connexions.some((c) => c.statut === 'en_attente')

  /** le miroir local se rafraîchit, il ne s'écrase pas : `derniereSyncLe`
   *  reste la date d'INTÉGRATION au Cockpit, pas celle de la réponse banque */
  const memoriser = (distantes: ConnexionDistante[]) =>
    update((d) => {
      d.connexionsBancaires = fusionnerConnexions(d.connexionsBancaires, distantes, today)
    })

  // Au chargement : l'état des connexions, puis la relecture des demandes en
  // attente — c'est le retour de la banque. On ne dépend d'aucun paramètre
  // d'adresse : GoCardless ramène la personne dans le Cockpit, et le reste se
  // relit côté serveur par l'identifiant de la demande.
  useEffect(() => {
    if (!sb) return
    let vivant = true
    void (async () => {
      try {
        const statut = await lireStatutBanque(sb)
        if (!vivant) return
        setConfigure(statut.configure)
        memoriser(statut.connexions)
        if (statut.connexions.some((c) => c.statut === 'en_attente')) {
          const suite = await finaliserConnexions(sb)
          if (vivant) memoriser(suite.connexions)
        }
      } catch (e) {
        if (vivant) setErreur(e instanceof Error ? e.message : 'Statut bancaire illisible.')
      }
    })()
    return () => {
      vivant = false
    }
    // une seule fois par montage : l'état vit ensuite dans le miroir local
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Intègre UN résultat de synchronisation. Tout est calculé AVANT la
   *  mutation (producteur rejouable), et rien ne passe à côté de
   *  `preparerImport` : c'est lui qui garantit qu'un réimport n'ajoute rien. */
  const integrer = (resultat: ResultatConnexion): string => {
    let vue: AppState = state
    const nouvelles: TransactionBancaire[] = []
    const metas: ImportBancaire[] = []
    const soldes: { id: string; solde: number | null; type: string | null; date: string | null }[] = []
    let doublons = 0
    let illisibles = 0
    let sansSolde = 0
    const typesVus = new Set<string>()

    for (const compte of resultat.comptes) {
      if (compte.genre !== 'ok') continue
      const lecture = operationsVersLignes(compte.operations)
      illisibles += lecture.ignorées
      const importId = uid('imp')
      const prepare = preparerImport(vue, lecture.lignes, importId)
      doublons += prepare.doublons
      nouvelles.push(...prepare.nouvelles)
      // la vue avance : deux comptes du même lot ne peuvent pas se
      // dédoublonner l'un contre un état périmé
      vue = { ...vue, transactionsBancaires: [...vue.transactionsBancaires, ...prepare.nouvelles] }

      const choisi = choisirSolde(compte.soldes)
      for (const s of compte.soldes) typesVus.add(s.type)
      if (!choisi) sansSolde++
      // « null n'est pas 0 » : sans solde publié on écrit l'absence, et on la
      // dit — c'est exactement le silence que le lot D2 a payé.
      const soldeFinal = choisi ? choisi.montant : null
      const dateSolde = choisi ? choisi.date || compte.fenetre?.fin || today : null
      soldes.push({ id: compte.id, solde: soldeFinal, type: choisi ? choisi.type : null, date: dateSolde })
      metas.push({
        id: importId,
        date: today,
        nomFichier: `${resultat.banque}${compte.ibanMasque ? ` ${compte.ibanMasque}` : ''} — synchronisation`,
        nbLignes: lecture.lignes.length,
        nbNouvelles: prepare.nouvelles.length,
        soldeFinal,
        dateSolde,
      })
    }

    // AUCUN compte lu = AUCUNE synchronisation réussie. Poser malgré tout la
    // date du jour afficherait « synchronisé aujourd'hui » sur une trésorerie
    // qui n'a rien reçu — précisément le silence que ce lot ferme.
    if (metas.length === 0) {
      const rien = 'aucun compte lisible — rien n’a été intégré'
      update((d) => {
        const c = d.connexionsBancaires.find((x) => x.id === resultat.connexionId)
        if (c) c.derniereSyncResultat = rien
      })
      toast(`${resultat.banque} — ${rien}.`, { tone: 'danger' })
      return rien
    }

    const resume =
      `${nouvelles.length} mouvement(s) intégré(s), ${doublons} déjà connu(s)` +
      (illisibles ? `, ${illisibles} ligne(s) illisible(s)` : '') +
      (sansSolde > 0
        ? ` — ${sansSolde} compte(s) SANS solde publié${typesVus.size ? ` (types reçus : ${[...typesVus].join(', ')})` : ''} : la trésorerie affichée ne bouge pas pour eux`
        : '')

    const idsTx = new Set(nouvelles.map((t) => t.id))
    const idsImports = new Set(metas.map((m) => m.id))
    update((d) => {
      d.transactionsBancaires.push(...nouvelles)
      d.importsBancaires.push(...metas)
      const c = d.connexionsBancaires.find((x) => x.id === resultat.connexionId)
      if (c) {
        c.derniereSyncLe = today
        c.derniereSyncResultat = resume
        for (const s of soldes) {
          const compte = c.comptes.find((x) => x.id === s.id)
          if (!compte) continue
          compte.dernierSolde = s.solde
          compte.dernierSoldeType = s.type
          compte.dernierSoldeDate = s.date
        }
      }
    })

    toast(`${resultat.banque} — ${resume}.`, {
      tone: sansSolde > 0 ? 'warn' : 'ok',
      // Chaque geste laisse un « Annuler » : on retire EXACTEMENT ce qu'on
      // vient d'ajouter, jamais ce qui était déjà là.
      undo: () =>
        update((d) => {
          d.transactionsBancaires = d.transactionsBancaires.filter((t) => !idsTx.has(t.id))
          d.importsBancaires = d.importsBancaires.filter((m) => !idsImports.has(m.id))
        }),
    })

    if (sb) {
      // Le serveur note ce qui est RÉELLEMENT entré : « dernière
      // synchronisation réussie » ne doit pas vouloir dire « la banque a
      // répondu ». L'échec de cette confirmation n'est pas bloquant — le
      // miroir local, lui, est déjà juste.
      void confirmerSynchronisation(sb, resultat.connexionId, resume, soldes)
        .then((x) => memoriser(x.connexions))
        .catch(() => undefined)
    }
    return resume
  }

  const synchroniser = async (connexionId: string) => {
    if (!sb) return
    setOccupe(connexionId)
    setErreur(null)
    try {
      const reponse = await synchroniserBanque(sb, connexionId, FENETRE_SYNCHRO_JOURS)
      memoriser(reponse.connexions)
      for (const resultat of reponse.resultats) {
        if (resultat.genre !== 'ok') {
          toast(resultat.message || `${resultat.banque} : synchronisation impossible.`, { tone: 'danger' })
          continue
        }
        const bloques = resultat.comptes.filter((c) => c.genre !== 'ok')
        for (const c of bloques) toast(`${resultat.banque} — ${c.message}`, { tone: 'danger' })
        integrer(resultat)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Synchronisation impossible.'
      setErreur(message)
      toast(message, { tone: 'danger' })
    } finally {
      setOccupe(null)
    }
  }

  const ouvrirBanque = (lien: string) => {
    // `noopener` : la page de la banque ne doit jamais garder la main sur
    // l'onglet du Cockpit.
    window.open(lien, '_blank', 'noopener,noreferrer')
  }

  const demarrer = async (banque: BanqueDisponible) => {
    if (!sb) return
    setBanques(null)
    setOccupe('nouvelle')
    setErreur(null)
    try {
      const reponse = await demarrerConnexionBancaire(sb, banque, 90)
      memoriser(reponse.connexions)
      ouvrirBanque(reponse.lien)
      toast(
        `Autorisez la lecture chez ${banque.nom}, puis revenez ici et cliquez « Finaliser la connexion ».`,
        { tone: 'ok' },
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Connexion impossible.'
      setErreur(message)
      toast(message, { tone: 'danger' })
    } finally {
      setOccupe(null)
    }
  }

  const reconnecter = async (connexion: ConnexionBancaire) => {
    if (!sb) return
    setOccupe(connexion.id)
    setErreur(null)
    try {
      const reponse = await reconnecterBanque(sb, connexion.id, 90)
      memoriser(reponse.connexions)
      ouvrirBanque(reponse.lien)
      toast(`Reprenez l'authentification chez ${connexion.banque}, puis « Finaliser la connexion ».`, {
        tone: 'ok',
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Reconnexion impossible.'
      setErreur(message)
      toast(message, { tone: 'danger' })
    } finally {
      setOccupe(null)
    }
  }

  const finaliser = async () => {
    if (!sb) return
    setOccupe('finalisation')
    setErreur(null)
    try {
      const reponse = await finaliserConnexions(sb)
      memoriser(reponse.connexions)
      const liees = reponse.connexions.filter((c) => c.statut === 'liee').length
      toast(
        liees > 0
          ? `${liees} connexion(s) établie(s) — vous pouvez synchroniser.`
          : 'La banque n’a pas encore rendu les comptes : réessayez dans un instant.',
        { tone: liees > 0 ? 'ok' : 'warn' },
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Finalisation impossible.'
      setErreur(message)
      toast(message, { tone: 'danger' })
    } finally {
      setOccupe(null)
    }
  }

  const retirer = async (connexion: ConnexionBancaire) => {
    if (!sb) return
    const ok = await confirmer({
      titre: `Retirer la connexion ${connexion.banque} ?`,
      message:
        'L’autorisation est supprimée chez GoCardless. Les mouvements déjà importés RESTENT dans le Cockpit — seule la connexion disparaît. Il faudra refaire le parcours bancaire pour la rétablir.',
      danger: true,
    })
    if (!ok) return
    setOccupe(connexion.id)
    try {
      const reponse = await deconnecterBanque(sb, connexion.id)
      update((d) => {
        d.connexionsBancaires = d.connexionsBancaires.filter((c) => c.id !== connexion.id)
      })
      memoriser(reponse.connexions)
      toast('Connexion retirée. L’import de relevé reste disponible.', { tone: 'ok' })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Déconnexion impossible.', { tone: 'danger' })
    } finally {
      setOccupe(null)
    }
  }

  const ouvrirChoix = async () => {
    if (!sb) return
    setOccupe('nouvelle')
    setErreur(null)
    try {
      const reponse = await listerBanques(sb, 'FR')
      setBanques(reponse.banques)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Liste des banques indisponible.'
      setErreur(message)
      toast(message, { tone: 'danger' })
    } finally {
      setOccupe(null)
    }
  }

  return (
    <Card
      titre="Connexion bancaire directe — lecture seule"
      actions={
        sb ? (
          <>
            {enAttente && (
              <Btn small kind="primary" disabled={occupe !== null} onClick={() => void finaliser()}>
                Finaliser la connexion
              </Btn>
            )}
            <Btn small disabled={occupe !== null} onClick={() => void ouvrirChoix()}>
              {occupe === 'nouvelle' ? '…' : 'Connecter un compte'}
            </Btn>
          </>
        ) : undefined
      }
    >
      {!sb ? (
        <p className="muted small" style={{ margin: 0 }}>
          La connexion directe passe par l'espace partagé (les identifiants bancaires restent côté serveur, jamais
          dans ce navigateur) : connectez-vous dans <a href="#/parametres">Paramètres</a>. L'import de relevé
          ci-dessous fonctionne, lui, sans rien de tout cela.
        </p>
      ) : (
        <>
          {configure === false && (
            <div className="pill-note" style={{ marginBottom: 10 }}>
              Identifiants GoCardless absents des secrets de la fonction <code>banque-sync</code> (
              <code>GOCARDLESS_SECRET_ID</code>, <code>GOCARDLESS_SECRET_KEY</code>,{' '}
              <code>BANQUE_REDIRECT_URL</code>). Tant qu'ils n'y sont pas, seule l'import de relevé fonctionne — et
              c'est très bien ainsi.
            </div>
          )}
          {erreur && (
            <div className="pill-note" style={{ marginBottom: 10, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
              {erreur}
            </div>
          )}
          {connexions.length === 0 ? (
            <EmptyState>
              Aucun compte connecté. La connexion directe rapatrie les mouvements ET le solde ; elle demande une
              ré-authentification tous les 90 jours (DSP2), annoncée une semaine avant. L'import de relevé reste
              le chemin hors ligne et le repli.
            </EmptyState>
          ) : (
            <Table
              compact
              head={[
                'Banque',
                'État',
                'Consentement',
                'Dernière synchro',
                <span key="s" className="right">
                  Solde relevé
                </span>,
                '',
              ]}
            >
              {connexions.map((c) => (
                <LigneConnexion
                  key={c.id}
                  connexion={c}
                  cible={cible}
                  occupe={occupe}
                  onSynchroniser={() => void synchroniser(c.id)}
                  onReconnecter={() => void reconnecter(c)}
                  onRetirer={() => void retirer(c)}
                />
              ))}
            </Table>
          )}
          <p className="muted small" style={{ margin: '10px 2px 0' }}>
            Lecture seule : aucun ordre ne peut être émis. Les mouvements rapatriés passent par le même
            rapprochement idempotent que les fichiers — synchroniser deux fois, ou synchroniser puis importer le
            relevé du même jour, n'ajoute aucune ligne. Fenêtre rapatriée : {FENETRE_SYNCHRO_JOURS} jours. Les
            banques limitent les appels (jusqu'à 4 par jour et par compte) : une à deux synchronisations
            quotidiennes suffisent.
          </p>
        </>
      )}
      {banques && (
        <ModalChoixBanque banques={banques} onChoisir={(b) => void demarrer(b)} onClose={() => setBanques(null)} />
      )}
    </Card>
  )
}

// ------------------------------------------------------------------
// Rapprochement d'un mouvement
// ------------------------------------------------------------------

function LigneMouvement({ t }: { t: TransactionBancaire }) {
  const { state, update } = useStore()
  const today = useToday()
  const [ouvert, setOuvert] = useState(false)
  const [saisieMotif, setSaisieMotif] = useState(false)
  const [motif, setMotif] = useState('')

  const validerPaiementClient = async (factures: Facture[], montants: number[]) => {
    // calculé AVANT la mutation (producteur rejouable)
    let p: ReturnType<typeof nouveauPaiement>
    try {
      p = nouveauPaiement(
        state,
        t.date,
        t.montant,
        factures.map((f, i) => ({ factureId: f.id, montant: montants[i] })),
        t.libelle.slice(0, 60),
        'virement',
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ce rapprochement créerait un paiement invalide.', { tone: 'danger' })
      return
    }
    const resultat = await new Promise<{ ok: boolean; erreur?: string }>((resolve) => {
      update((d) => {
        const tx = d.transactionsBancaires.find((y) => y.id === t.id)
        if (!tx || tx.rapprochement) {
          resolve({ ok: false, erreur: 'Ce mouvement bancaire a déjà été rapproché.' })
          return
        }
        const controle = validerPaiement(d, p.montant, p.affectations)
        if (!controle.valide) {
          resolve({ ok: false, erreur: controle.erreurs[0] })
          return
        }
        d.paiements.push(p)
        for (const f of factures) {
          const x = d.factures.find((y) => y.id === f.id)
          if (!x) continue
          const solde = soldeFacture(d, x)
          if (solde <= 0.01) {
            x.statut = 'encaissee'
            x.encaissementReel = t.date
          }
          x.evenements = [...(x.evenements || []), { date: t.date, type: 'paiement', detail: `Rapproché du relevé — ${t.libelle.slice(0, 60)}` }]
        }
        tx.rapprochement = { type: 'paiement_client', paiementId: p.id, valideLe: today }
        resolve({ ok: true })
      })
    })
    if (!resultat.ok) {
      toast(resultat.erreur || 'Ce rapprochement n’a pas pu être enregistré.', { tone: 'danger' })
      return
    }
    toast('Encaissement rapproché — paiement créé, statut dérivé du solde.', { tone: 'ok' })
  }

  const payerAchat = async (achatId: string) => {
    const resultat = await new Promise<{ ok: boolean; erreur?: string }>((resolve) => {
      update((d) => {
        // La garde est dans la même mutation que les deux écritures : deux
        // clics concurrents ne peuvent jamais consommer le même mouvement.
        const erreur = erreurRapprochementAchat(d, t.id, achatId)
        if (erreur) {
          resolve({ ok: false, erreur })
          return
        }
        const tx = d.transactionsBancaires.find((y) => y.id === t.id)!
        const f = d.facturesAchat.find((y) => y.id === achatId)!
        f.payeLe = t.date
        f.transactionId = t.id
        // le rapprochement bancaire est la PREUVE du paiement (audit F6)
        f.paiementAConfirmer = false
        f.evenements = [...(f.evenements || []), { date: t.date, type: 'paiement', detail: `Rapproché du relevé (${fmtMoney(Math.abs(t.montant), true)}).` }]
        tx.rapprochement = { type: 'facture_achat', factureAchatId: achatId, valideLe: today }
        resolve({ ok: true })
      })
    })
    if (!resultat.ok) {
      toast(resultat.erreur || 'Ce rapprochement n’a pas pu être enregistré.', { tone: 'danger' })
      return
    }
    toast('Débit rapproché de la facture fournisseur.', { tone: 'ok' })
  }

  const rembourserNoteFrais = async (noteId: string) => {
    const resultat = await new Promise<{ ok: boolean; erreur?: string }>((resolve) => {
      update((d) => {
        const tx = d.transactionsBancaires.find((y) => y.id === t.id)
        if (!tx || tx.rapprochement) {
          resolve({ ok: false, erreur: 'Ce mouvement bancaire a déjà été rapproché.' })
          return
        }
        const n = d.notesFrais.find((y) => y.id === noteId)
        if (!n) {
          resolve({ ok: false, erreur: 'La note de frais est introuvable.' })
          return
        }
        if (n.statut === 'remboursee') {
          resolve({ ok: false, erreur: 'Cette note de frais est déjà remboursée.' })
          return
        }
        n.statut = 'remboursee'
        tx.rapprochement = { type: 'note_frais', noteFraisId: noteId, valideLe: today }
        resolve({ ok: true })
      })
    })
    if (!resultat.ok) {
      toast(resultat.erreur || 'Ce rapprochement n’a pas pu être enregistré.', { tone: 'danger' })
      return
    }
    toast('Débit rapproché du remboursement de note de frais.', { tone: 'ok' })
  }

  const justifier = async (type: 'interne' | 'justifie', detail?: string) => {
    const resultat = await new Promise<{ ok: boolean; erreur?: string }>((resolve) => {
      update((d) => {
        const tx = d.transactionsBancaires.find((y) => y.id === t.id)
        if (!tx || tx.rapprochement) {
          resolve({ ok: false, erreur: 'Ce mouvement bancaire a déjà été rapproché.' })
          return
        }
        tx.rapprochement = { type, detail, valideLe: today }
        resolve({ ok: true })
      })
    })
    if (!resultat.ok) {
      toast(resultat.erreur || 'Ce rapprochement n’a pas pu être enregistré.', { tone: 'danger' })
      return
    }
    toast(
      type === 'interne'
        ? 'Mouvement marqué interne — il sort de la file « à rapprocher ».'
        : `Mouvement justifié sans pièce${detail ? ` : ${detail}` : ''}.`,
      {
        tone: 'ok',
        undo: () =>
          update((d) => {
            const tx = d.transactionsBancaires.find((y) => y.id === t.id)
            if (tx) tx.rapprochement = null
          }),
      },
    )
  }

  const suggestionsCredit = t.montant > 0 && !t.rapprochement ? suggestionsPourCredit(state, t) : []
  const suggestionsDebit = t.montant < 0 && !t.rapprochement ? suggestionsAchatPourDebit(state, t) : []
  const contrats = t.montant < 0 && !t.rapprochement ? contratsPourDebit(state, t) : []
  const notesCandidates =
    t.montant < 0 && !t.rapprochement
      ? state.notesFrais.filter((n) => n.statut === 'a_rembourser' && Math.abs(n.montantTTC - Math.abs(t.montant)) < 0.01)
      : []

  return (
    <tr>
      <td>
        <DateF d={t.date} />
      </td>
      <td>
        {t.libelle.slice(0, 70)}
        {ouvert && !t.rapprochement && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {suggestionsCredit.map((s, i) => (
              <Btn key={i} small kind={i === 0 ? 'primary' : 'default'} onClick={() => void validerPaiementClient(s.factures, s.montants)} title={s.raisons.join(' · ')}>
                Paiement {s.factures.map((f) => f.numero || f.id).join(' + ')} — {s.raisons[0]}
              </Btn>
            ))}
            {suggestionsDebit.map((s, i) => (
              <Btn key={i} small kind={i === 0 ? 'primary' : 'default'} onClick={() => void payerAchat(s.f.id)} title={s.raisons.join(' · ')}>
                Fournisseur {s.f.fournisseur}{s.f.numeroFournisseur ? ` (${s.f.numeroFournisseur})` : ''} — {s.raisons[0]}
              </Btn>
            ))}
            {notesCandidates.map((n) => (
              <Btn key={n.id} small onClick={() => void rembourserNoteFrais(n.id)}>
                Remboursement note de frais {n.personne} ({fmtMoney(n.montantTTC, true)})
              </Btn>
            ))}
            {contrats.map((c) => (
              <span key={c.id} className="small muted">
                Ressemble au contrat « {c.intitule} » — saisir la facture dans <a href="#/finance/achats">Achats & frais</a>
              </span>
            ))}
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Btn small onClick={() => void justifier('interne', 'virement interne / mouvement d’épargne')}>
                Mouvement interne
              </Btn>
              {saisieMotif ? (
                // S4 — la justification se tape DANS l'écran : une boîte système
                // ne montre ni le mouvement, ni ce qu'on est en train d'écrire
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <TextInput
                    value={motif}
                    onChange={setMotif}
                    placeholder="Justification (sans pièce) : ex. frais bancaires trimestriels"
                  />
                  <Btn
                    small
                    kind="primary"
                    disabled={!motif.trim()}
                    onClick={() => {
                      const m = motif.trim()
                      if (!m) return
                      setSaisieMotif(false)
                      setMotif('')
                      void justifier('justifie', m)
                    }}
                  >
                    Enregistrer la justification
                  </Btn>
                  <Btn
                    small
                    onClick={() => {
                      setSaisieMotif(false)
                      setMotif('')
                    }}
                  >
                    Annuler
                  </Btn>
                </span>
              ) : (
                <Btn small onClick={() => setSaisieMotif(true)}>
                  Justifier sans pièce…
                </Btn>
              )}
            </span>
            {suggestionsCredit.length === 0 && suggestionsDebit.length === 0 && notesCandidates.length === 0 && (
              <span className="small muted">Aucune correspondance automatique — le Cockpit ne rapproche jamais de force.</span>
            )}
          </div>
        )}
      </td>
      <td className={`right num ${t.montant < 0 ? '' : 'ok-text'}`}>{fmtMoney(t.montant, true)}</td>
      <td>
        {t.rapprochement ? (
          <Badge tone="ok">
            {t.rapprochement.type === 'paiement_client'
              ? 'encaissement'
              : t.rapprochement.type === 'facture_achat'
                ? 'fournisseur'
                : t.rapprochement.type === 'note_frais'
                  ? 'note de frais'
                  : t.rapprochement.type === 'interne'
                    ? 'interne'
                    : 'justifié'}
          </Badge>
        ) : (
          <Btn small kind="primary" onClick={() => setOuvert((o) => !o)}>
            {ouvert ? 'Fermer' : 'Rapprocher…'}
          </Btn>
        )}
      </td>
    </tr>
  )
}

// ------------------------------------------------------------------
// Prévision 13 semaines (détaillée)
// ------------------------------------------------------------------

function CartePrevision({ state, today }: { state: AppState; today: string }) {
  const [scenario, setScenario] = useState<Scenario>('probable')
  const prevision = useMemo(() => prevision13Semaines(state, today, scenario), [state, today, scenario])
  const seuil = state.settings.seuilTresorerie ?? 0
  return (
    <Card titre="Prévision de trésorerie — 13 semaines">
      <div className="toolbar" style={{ marginBottom: 10 }}>
        {(['prudent', 'probable', 'favorable'] as Scenario[]).map((s) => (
          <Btn key={s} small kind={scenario === s ? 'primary' : 'default'} onClick={() => setScenario(s)}>
            {s}
          </Btn>
        ))}
        <div className="spacer" />
        <span className="small muted">
          départ {fmtMoney(prevision.soldeDepart)} ({prevision.sourceSolde === 'banque' ? 'solde bancaire importé' : prevision.sourceSolde === 'manuel' ? 'solde d’ouverture manuel' : 'aucun solde connu'})
        </span>
      </div>
      {prevision.pointBas.solde < seuil && (
        <div className="pill-note" style={{ marginBottom: 10, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          Point bas : <strong>{fmtMoney(prevision.pointBas.solde)}</strong> la semaine du {fmtDate(prevision.pointBas.lundi)}
          {seuil > 0 ? ` (seuil d'alerte ${fmtMoney(seuil)})` : ''} — anticiper (relances, décalage de décaissements).
        </div>
      )}
      <CourbeTresorerie prevision={prevision} seuil={seuil} />
      <Table
        compact
        head={['Semaine', <span key="e" className="right">Entrées</span>, <span key="s" className="right">Sorties</span>, <span key="so" className="right">Solde</span>, '']}
      >
        {prevision.semaines.map((s) => {
          const totalE = s.entrees.reduce((x, f) => x + f.montant, 0)
          const totalS = s.sorties.reduce((x, f) => x + f.montant, 0)
          return (
            <tr key={s.lundi}>
              <td>{fmtDate(s.lundi)}</td>
              <td className="right num ok-text">{totalE > 0 ? fmtMoney(totalE) : '·'}</td>
              <td className="right num">{totalS < 0 ? fmtMoney(totalS) : '·'}</td>
              <td className={`right num ${s.solde < seuil ? 'danger-text' : ''}`} style={{ fontWeight: 600 }}>
                {fmtMoney(s.solde)}
              </td>
              <td>
                {(s.entrees.length > 0 || s.sorties.length > 0) && (
                  <details>
                    <summary className="small" style={{ cursor: 'pointer' }}>
                      {s.entrees.length + s.sorties.length} flux
                    </summary>
                    {[...s.entrees, ...s.sorties].map((f, i) => (
                      <div key={i} className="small" style={{ padding: '2px 0' }}>
                        <span className={f.montant < 0 ? '' : 'ok-text'}>{fmtMoney(f.montant)}</span> — {f.lien ? <a href={f.lien}>{f.libelle}</a> : f.libelle} <span className="muted">({fmtDate(f.date)})</span>
                      </div>
                    ))}
                  </details>
                )}
              </td>
            </tr>
          )
        })}
      </Table>
      <p className="muted small" style={{ margin: '10px 2px 0' }}>
        Scénarios : <strong>prudent</strong> retarde les encaissements de 15 j et pondère les échéances non émises à
        70 % · <strong>probable</strong> utilise le délai de paiement réellement constaté · <strong>favorable</strong>{' '}
        suppose le paiement à l'échéance. Salaires, contrats récurrents et TVA paramétrée inclus.
      </p>
    </Card>
  )
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function Banque() {
  const { state, update } = useStore()
  const today = useToday()
  // `#/finance/banque/<id>` — c'est par là qu'arrive l'alerte de reconnexion :
  // elle dépose sur LA connexion concernée, pas en haut d'une liste.
  const route = useRoute()
  const cibleConnexion = route[0] === 'finance' && route[1] === 'banque' ? route[2] || null : null
  const refFichier = useRef<HTMLInputElement>(null)
  const [importEnCours, setImportEnCours] = useState<{ texte: string; nom: string } | null>(null)
  const [voirTout, setVoirTout] = useState(false)

  const banque = soldeBancaire(state)
  const ecart = ecartSoldeManuel(state)

  /** S1 — la carte montrait l'écart sans offrir le geste qui le règle : le
   *  solde manuel (météo financière, Pilotage) se recopiait à la main alors
   *  que le relevé importé est là. La machine propose, le clic est humain. */
  const reprendreSoldeImporte = () => {
    if (!banque) return
    const avantSolde = state.settings.tresorerieDispo
    const avantMaj = state.settings.tresorerieMajLe
    update((d) => {
      d.settings.tresorerieDispo = banque.solde
      d.settings.tresorerieMajLe = today
    })
    toast(`Solde manuel aligné sur le relevé : ${fmtMoney(banque.solde, true)} au ${fmtDate(banque.date)}.`, {
      tone: 'ok',
      undo: () =>
        update((d) => {
          d.settings.tresorerieDispo = avantSolde
          d.settings.tresorerieMajLe = avantMaj
        }),
    })
  }
  const nonRapprochees = state.transactionsBancaires.filter((t) => !t.rapprochement)
  const mouvements = useMemo(
    () =>
      [...state.transactionsBancaires]
        .filter((t) => voirTout || !t.rapprochement)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 120),
    [state.transactionsBancaires, voirTout],
  )

  const chargerFichier = (file: File) => {
    const lecteur = new FileReader()
    lecteur.onload = () => setImportEnCours({ texte: String(lecteur.result || ''), nom: file.name })
    lecteur.readAsText(file, 'utf-8')
  }

  return (
    <Page titre="Finance" sousTitre="Banque & trésorerie — mouvements réels, rapprochement et prévision.">
      <FinanceNav actif="banque" />

      <div className="grid4" style={{ marginBottom: 16 }}>
        <Stat
          label={banque ? 'Solde bancaire (importé)' : 'Solde d’ouverture manuel'}
          value={banque ? <Money v={banque.solde} /> : state.settings.tresorerieDispo != null ? <Money v={state.settings.tresorerieDispo} /> : '—'}
          sub={
            banque
              ? `relevé + mouvements depuis le ${fmtDate(banque.date)}`
              : state.importsBancaires.length > 0
                ? // D2 : c'est le silence qui coûtait cher — des relevés importés
                  // sans solde de fin laissaient la trésorerie sur une valeur
                  // manuelle sans que rien ne le dise
                  `${state.importsBancaires.length} relevé(s) importé(s) mais AUCUN ne porte de solde de fin : le solde réel reste inconnu`
                : 'saisi dans Paramètres — importez un relevé pour le solde réel'
          }
        />
        <Stat
          label="Écart avec le solde manuel"
          value={ecart != null ? fmtMoney(ecart) : '—'}
          tone={ecart != null && Math.abs(ecart) > 1 ? 'warn' : undefined}
          sub={
            ecart == null ? (
              'visible dès qu’un relevé est importé'
            ) : Math.abs(ecart) <= 0.01 ? (
              'solde importé − solde saisi : aligné ✓'
            ) : (
              <>
                <div>solde importé − solde saisi (météo financière, Pilotage)</div>
                <Btn
                  small
                  onClick={reprendreSoldeImporte}
                  title="Recopie le solde du relevé dans le solde manuel des Paramètres — annulable"
                >
                  Reprendre le solde importé
                </Btn>
              </>
            )
          }
        />
        <Stat
          label="À rapprocher"
          value={nonRapprochees.length}
          tone={nonRapprochees.length > 0 ? 'warn' : 'ok'}
          sub="mouvements sans pièce ni justification"
        />
        <Stat label="Relevés importés" value={state.importsBancaires.length} sub="réimporter un relevé ne crée aucun doublon" />
      </div>

      <CarteConnexionBancaire cible={cibleConnexion} />

      <Card
        titre={`Mouvements (${voirTout ? state.transactionsBancaires.length : nonRapprochees.length}${voirTout ? '' : ' à rapprocher'})`}
        actions={
          <>
            <Btn small onClick={() => setVoirTout((v) => !v)}>{voirTout ? 'À rapprocher seulement' : 'Tout afficher'}</Btn>
            <Btn
              small
              kind="primary"
              onClick={() => refFichier.current?.click()}
              title="CAMT.053, OFX/QFX, QIF ou CSV — le format est reconnu tout seul"
            >
              Importer un relevé
            </Btn>
            <input
              ref={refFichier}
              type="file"
              accept=".csv,.txt,.tsv,.xml,.ofx,.qfx,.qif"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) chargerFichier(f)
                e.target.value = ''
              }}
            />
          </>
        }
      >
        {state.transactionsBancaires.length === 0 ? (
          <EmptyState>
            Aucun mouvement — deux chemins, le même rapprochement idempotent : la connexion bancaire directe
            ci-dessus (lecture seule, opérations et solde), ou l'export d'un relevé depuis votre banque à
            importer ici (CAMT.053, OFX/QFX, QIF ou CSV — le format est reconnu tout seul, le mapping des
            colonnes du CSV est mémorisé). Réimporter le même fichier n'ajoute aucune ligne, et synchroniser
            après avoir importé non plus.
          </EmptyState>
        ) : mouvements.length === 0 ? (
          <EmptyState>Tout est rapproché ✓</EmptyState>
        ) : (
          <Table compact head={['Date', 'Libellé / rapprochement', <span key="m" className="right">Montant</span>, 'État']}>
            {mouvements.map((t) => (
              <LigneMouvement key={t.id} t={t} />
            ))}
          </Table>
        )}
      </Card>

      <CartePrevision state={state} today={today} />

      {importEnCours && (
        <ImportModal texte={importEnCours.texte} nomFichier={importEnCours.nom} onClose={() => setImportEnCours(null)} />
      )}
    </Page>
  )
}
