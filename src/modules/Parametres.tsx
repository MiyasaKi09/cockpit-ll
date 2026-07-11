// Paramètres & données — réglages de l'agence, trésorerie,
// import mensuel des totaux de l'Excel maître (source de vérité
// financière la première année), sauvegarde/restauration JSON.

import { useEffect, useRef, useState } from 'react'
import type { AppState, ModeRemu, StatutRemu, TypeMO } from '../types'
import { useStore } from '../store'
import { seedState } from '../seed'
import { computeAlertes } from '../alerts'
import {
  Badge,
  Btn,
  Card,
  Field,
  Money,
  navigate,
  NumInput,
  PctInput,
  Page,
  Select,
  Table,
  Tabs,
  TextInput,
  confirmer,
  toast,
  useRoute,
  useToday, RowMenu } from '../ui'
import { download, fmtDate, fmtMoney, fmtPct, fold, todayISO, uid } from '../util'
import { coefSuggere, coutAgenceAnnuel, coutAnnuelPersonne, coutHorairePersonne, coutHoraireMoyen, coutJourObjectif, objectifCA, tauxVente, tauxVenteObjectif } from '../derive'
import { connecterGoogle, deconnecter, estConnecte } from '../google'
import { connecterSync, deconnecterSync, envoyerLienMagique, pousserEtat, syncActif, syncEtat, tirerEtat } from '../sync'
import { deconnecterIngestion, lireStatutIngestion, majConfigIngestion, type StatutIngestion } from '../entrants'
import { SanteContenu } from './Sante'
import { BienDemarrerContenu } from './BienDemarrer'

const ONGLETS: { id: string; label: string }[] = [
  { id: 'agence', label: 'Agence & coûts' },
  { id: 'branchements', label: 'Branchements' },
  { id: 'donnees', label: 'Sauvegarde & données' },
  { id: 'demarrer', label: 'Bien démarrer' },
]

const TYPES_MO: TypeMO[] = ['Public', 'Privé pro', 'Particulier']

/** L'équipe avec rémunérations réelles : le coût horaire de chacun
 *  se calcule tout seul — plus de forfait approximatif. */
function CarteEquipe() {
  const { state, update, replace } = useStore()
  const eq = state.settings.equipe

  const majPersonne = (id: string, champ: 'nom' | 'remuMensuelle' | 'coefCharges' | 'heuresAnnuelles' | 'facturablePct', v: string | number | null) =>
    update((d) => {
      const p = d.settings.equipe.find((x) => x.id === id)
      if (!p) return
      if (champ === 'nom') p.nom = String(v ?? '')
      else (p as unknown as Record<string, number>)[champ] = typeof v === 'number' ? v : 0
      d.settings.personnes = d.settings.equipe.map((x) => x.nom).filter(Boolean)
    })

  /** changer Net/Brut ou le statut recale le coefficient sur la
   *  suggestion SAS — sinon le coût serait silencieusement faux */
  const majProfil = (id: string, champ: 'modeRemu' | 'statut', v: string) =>
    update((d) => {
      const p = d.settings.equipe.find((x) => x.id === id)
      if (!p) return
      if (champ === 'modeRemu') p.modeRemu = v as ModeRemu
      else p.statut = v as StatutRemu
      p.coefCharges = coefSuggere(p.statut, p.modeRemu)
    })

  const ajouter = () =>
    update((d) => {
      d.settings.equipe.push({ id: uid('pers'), nom: 'Nouveau', remuMensuelle: 2500, modeRemu: 'brut', statut: 'salarie', coefCharges: coefSuggere('salarie', 'brut'), heuresAnnuelles: 1720, facturablePct: 0.6 })
      d.settings.personnes = d.settings.equipe.map((x) => x.nom)
    })

  const retirer = async (id: string) => {
    const p = eq.find((x) => x.id === id)
    if (!p) return
    const snap = state
    if (!(await confirmer({ message: `Retirer ${p.nom} de l'équipe ? (ses heures pointées restent, valorisées au coût moyen)`, danger: true, confirmerLabel: 'Retirer' }))) return
    update((d) => {
      d.settings.equipe = d.settings.equipe.filter((x) => x.id !== id)
      d.settings.personnes = d.settings.equipe.map((x) => x.nom)
    })
    toast('Personne retirée.', { undo: () => replace(snap) })
  }

  return (
    <Card titre="Équipe & coûts réels — le cœur du calcul de marge">
      <p className="small muted" style={{ marginBottom: 10 }}>
        Chaque heure pointée est valorisée au coût réel de la personne (rémunération chargée ÷ heures
        annuelles). La marge d'un projet et le <a href="#/pilotage/missions">Pilotage (Missions)</a> reposent sur ces
        chiffres — pas sur un forfait.
      </p>
      <Table compact head={['Personne', 'Statut (SAS)', 'Saisie', <span key="b" className="right">€ / mois</span>, <span key="c" className="right">Coef. charges</span>, <span key="h" className="right">Heures / an</span>, <span key="f" className="right">% facturable</span>, <span key="ch" className="right">Coût horaire</span>, <span key="ca" className="right">Coût annuel chargé</span>, '']}>
        {eq.map((p) => (
          <tr key={p.id}>
            <td><TextInput value={p.nom} onChange={(v) => majPersonne(p.id, 'nom', v)} style={{ width: 100 }} /></td>
            <td>
              <Select
                value={p.statut}
                onChange={(v) => majProfil(p.id, 'statut', v)}
                options={[
                  { value: 'dirigeant', label: 'Président·e' },
                  { value: 'salarie', label: 'Salarié·e' },
                ]}
                style={{ width: 110 }}
              />
            </td>
            <td>
              <Select
                value={p.modeRemu}
                onChange={(v) => majProfil(p.id, 'modeRemu', v)}
                options={[
                  { value: 'brut', label: 'Brut' },
                  { value: 'net', label: 'Net' },
                ]}
                style={{ width: 74 }}
              />
            </td>
            <td className="right"><NumInput value={p.remuMensuelle} onChange={(v) => majPersonne(p.id, 'remuMensuelle', v)} style={{ width: 84 }} /></td>
            <td className="right"><NumInput value={p.coefCharges} onChange={(v) => majPersonne(p.id, 'coefCharges', v)} style={{ width: 64 }} /></td>
            <td className="right"><NumInput value={p.heuresAnnuelles} onChange={(v) => majPersonne(p.id, 'heuresAnnuelles', v)} style={{ width: 72 }} /></td>
            <td className="right"><PctInput value={p.facturablePct} onChange={(v) => majPersonne(p.id, 'facturablePct', v)} style={{ width: 80 }} ariaLabel={`Part facturable de ${p.nom} en pourcentage`} /></td>
            <td className="right num"><strong>{fmtMoney(coutHorairePersonne(p), true)}</strong></td>
            <td className="right num">{fmtMoney(coutAnnuelPersonne(p))}</td>
            <td className="right"><RowMenu items={[{ label: "Retirer de l'équipe", onClick: () => void retirer(p.id), danger: true }]} /></td>
          </tr>
        ))}
      </Table>
      <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
        Saisissez le <strong>net versé</strong> ou le <strong>brut</strong>, au choix : le coefficient
        transforme le montant en coût employeur complet et se recale tout seul quand vous changez le
        statut ou la saisie. Indicatifs SAS — sur le brut : ×1,55 président·e · ×1,42 salarié·e ; sur
        le net : ×2,05 président·e · ×1,82 salarié·e. Affinez-le avec les chiffres de votre expert-comptable.
      </p>
      <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
        <Btn small onClick={ajouter}>+ Ajouter une personne</Btn>
        <span className="spacer" />
        <Field label="Frais généraux annuels HT (€)" hint="loyer, logiciels, assurances, compta…">
          <NumInput
            value={state.settings.fraisGenerauxAnnuels}
            onChange={(v) => update((d) => void (d.settings.fraisGenerauxAnnuels = v ?? 0))}
            style={{ width: 110 }}
          />
        </Field>
      </div>
      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>Coût d'agence annuel (équipe + FG)</dt>
        <dd><strong>{fmtMoney(coutAgenceAnnuel(state))}</strong></dd>
        <dt>Seuil de rentabilité par jour facturable</dt>
        <dd><strong>{fmtMoney(coutJourObjectif(state))}</strong> <span className="muted small">— l'objectif €/jour du Pilotage</span></dd>
        <dt>Coût horaire moyen pondéré</dt>
        <dd>{fmtMoney(coutHoraireMoyen(state), true)} <span className="muted small">(rémunérations chargées ÷ heures annuelles de l'équipe)</span></dd>
      </dl>
    </Card>
  )
}

/** Gmail & Agenda en direct — API Google gratuites, lecture seule */
function CarteSurveillance() {
  const { state, update } = useStore()
  const sv = state.settings.surveillance || { email: '', clientId: '' }
  const [message, setMessage] = useState('')
  const [, forcer] = useState(0)

  const majSv = (champ: 'email' | 'clientId', v: string) =>
    update((d) => {
      d.settings.surveillance = { ...(d.settings.surveillance || { email: '', clientId: '' }), [champ]: v }
    })

  const connecter = async () => {
    setMessage('')
    if (!sv.clientId.trim()) {
      setMessage('Renseignez d’abord le Client ID Google (guide ci-dessous).')
      return
    }
    try {
      await connecterGoogle(sv.clientId.trim())
      setMessage('Connecté — le Cockpit surveille maintenant Gmail et l’Agenda tant qu’un onglet est ouvert (~1 min de latence).')
      forcer((x) => x + 1)
    } catch (e) {
      setMessage(`Connexion impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <Card titre="Surveillance en direct — Gmail & Agenda (onglet ouvert)">
      <p className="small" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 8px' }}>
        {estConnecte() ? <Badge tone="ok">connecté</Badge> : <Badge tone="muted">non connecté</Badge>}
        <span className="muted">Mails → « À traiter » et agenda sur Aujourd'hui, tant qu'un onglet est ouvert.</span>
        <span className="spacer" />
        {estConnecte() ? (
          <Btn small onClick={() => { deconnecter(); forcer((x) => x + 1) }}>Déconnecter</Btn>
        ) : (
          <Btn small kind="primary" onClick={connecter}>Connecter Google</Btn>
        )}
      </p>
      <details open={!sv.clientId.trim()}>
      <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>Détails & réglages</summary>
      <p className="small muted" style={{ margin: '8px 0 10px' }}>
        Lecture seule, toutes les ~60 secondes. Le jeton reste dans le navigateur — rien ne transite
        ailleurs, et les quotas gratuits de Google sont sans commune mesure avec l'usage de l'agence.
      </p>
      <div className="form-row">
        <Field label="Adresse surveillée" hint="vide = toute la boîte de réception du compte connecté">
          <TextInput value={sv.email} onChange={(v) => majSv('email', v)} placeholder="situations@agence-ll.fr" />
        </Field>
        <Field label="Client ID Google (OAuth)" hint="création gratuite en ~5 min, guide ci-dessous">
          <TextInput value={sv.clientId} onChange={(v) => majSv('clientId', v)} placeholder="1234…apps.googleusercontent.com" />
        </Field>
      </div>
      {message && <p className="small" style={{ marginTop: 8 }}>{message}</p>}
      <details style={{ marginTop: 10 }}>
        <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
          Guide : créer le Client ID Google (une fois, gratuit)
        </summary>
        <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.8 }}>
          <li>console.cloud.google.com → créer un projet « Cockpit LL » (compte Google de l’agence).</li>
          <li>« API et services » → activer <strong>Gmail API</strong> et <strong>Google Calendar API</strong>.</li>
          <li>« Écran de consentement OAuth » : type Externe, mode <strong>Test</strong>, ajoutez vos deux adresses comme utilisateurs test (pas besoin de validation Google pour un outil interne).</li>
          <li>« Identifiants » → « Créer des identifiants » → <strong>ID client OAuth</strong>, type « Application Web » ; dans « Origines JavaScript autorisées », ajoutez les adresses du site (ex. http://localhost:5173 et votre URL vercel.app).</li>
          <li>Copiez l’ID client ci-dessus, « Connecter Google », choisissez le compte : c’est fini.</li>
        </ol>
      </details>
      </details>
    </Card>
  )
}

/** Ingestion Gmail côté serveur — l'agence reçoit ses pièces jointes
 *  dans la boîte d'arrivée même onglet fermé (Edge Functions Supabase).
 *  Les identifiants OAuth vivent dans une table privée côté serveur :
 *  ils ne passent ici qu'au moment de l'enregistrement, jamais relus. */
function CarteIngestionServeur() {
  const [statut, setStatut] = useState<StatutIngestion | null>(null)
  const [message, setMessage] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [compteEmail, setCompteEmail] = useState('')
  const [occupe, setOccupe] = useState(false)

  const charger = async () => {
    if (!syncActif()) {
      setStatut(null)
      return
    }
    try {
      const s = await lireStatutIngestion()
      setStatut(s)
      if (s) setCompteEmail((prev) => prev || s.compteEmail)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void charger()
    const t = setTimeout(() => void charger(), 2500) // la session s'ouvre en asynchrone
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enregistrer = async () => {
    setOccupe(true)
    setMessage('')
    try {
      await majConfigIngestion({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), compteEmail: compteEmail.trim() })
      setClientSecret('')
      setMessage('Identifiants enregistrés côté serveur — cliquez « Connecter Gmail ».')
      await charger()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setOccupe(false)
    }
  }

  const deconnecterGmail = async () => {
    if (!(await confirmer('Déconnecter Gmail ? Le scan serveur s’arrête (les pièces déjà proposées restent).'))) return
    try {
      await deconnecterIngestion()
      await charger()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Card titre="Ingestion serveur — pièces jointes Gmail → boîte d'arrivée">
      <p className="small muted" style={{ marginBottom: 10 }}>
        Contrairement à la surveillance ci-dessus (onglet ouvert), l'ingestion tourne <strong>côté
        serveur toutes les 10 minutes</strong> : chaque pièce jointe reçue est proposée dans{' '}
        <a href="#/documents">Documents → Boîte d'arrivée</a>, pré-classée avec ses raisons. Lecture
        seule, rien n'est classé sans validation, et les identifiants restent côté serveur (jamais
        dans les données partagées).
      </p>
      {!syncActif() ? (
        <p className="small">
          <Badge tone="warn">espace partagé non connecté</Badge> — connectez d'abord la synchronisation
          ci-dessus (l'ingestion s'appuie sur le même projet Supabase).
        </p>
      ) : statut === null ? (
        <p className="small muted">Lecture du statut…</p>
      ) : (
        <>
          <p className="small" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            {statut.connecte ? (
              <Badge tone="ok">Gmail connecté — {statut.compteEmail}</Badge>
            ) : statut.configure ? (
              <>
                <Badge tone="warn">identifiants en place</Badge>
                <a className="btn btn-small btn-primary" href={statut.urlOauth} target="_blank" rel="noreferrer">
                  Connecter Gmail
                </a>
              </>
            ) : (
              <Badge tone="muted">pas encore configuré</Badge>
            )}
            {statut.dernierScan && (
              <span className="muted"> · dernier scan {fmtDate(statut.dernierScan.slice(0, 10))}</span>
            )}
            {statut.dernierResultat && <span className="muted"> · {statut.dernierResultat}</span>}
          </p>
          <details open={!statut.configure} style={{ marginTop: 4 }}>
          <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>Détails & réglages</summary>
          <div className="form-row" style={{ marginTop: 8 }}>
            <Field label="Compte Gmail à lire" hint="seul ce compte pourra se connecter">
              <TextInput value={compteEmail} onChange={setCompteEmail} placeholder="agence.ll@gmail.com" />
            </Field>
            <Field label="Client ID Google (OAuth)" hint="le même que la surveillance ci-dessus">
              <TextInput value={clientId} onChange={setClientId} placeholder="1234…apps.googleusercontent.com" />
            </Field>
            <Field label="Secret client" hint="enregistré côté serveur, jamais relu ici">
              <TextInput value={clientSecret} onChange={setClientSecret} type="password" placeholder="GOCSPX-…" />
            </Field>
          </div>
          <div className="toolbar" style={{ marginTop: 8, marginBottom: 0, flexWrap: 'wrap' }}>
            <Btn small kind="primary" disabled={occupe || !compteEmail.trim() || (!statut.configure && (!clientId.trim() || !clientSecret.trim()))} onClick={() => void enregistrer()}>
              Enregistrer côté serveur
            </Btn>
            {statut.configure && (
              <a className="btn btn-small" href={statut.urlOauth} target="_blank" rel="noreferrer">
                {statut.connecte ? 'Reconnecter Gmail' : 'Connecter Gmail'}
              </a>
            )}
            {statut.connecte && (
              <Btn small onClick={() => void deconnecterGmail()}>Déconnecter Gmail</Btn>
            )}
            <Btn small kind="ghost" onClick={() => void charger()}>Actualiser</Btn>
          </div>
          <details style={{ marginTop: 10 }}>
            <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
              Guide : compléter le Client ID Google pour l'ingestion (une fois)
            </summary>
            <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.8 }}>
              <li>console.cloud.google.com → « Identifiants » → ouvrez l'ID client OAuth déjà créé pour la surveillance (ou créez-en un, type « Application Web »).</li>
              <li>Dans <strong>« URI de redirection autorisés »</strong>, ajoutez : <code style={{ userSelect: 'all' }}>{statut.urlOauth}</code></li>
              <li>Copiez l'<strong>ID client</strong> et le <strong>secret client</strong> (bouton « Afficher le secret ») dans les champs ci-dessus, « Enregistrer côté serveur ».</li>
              <li>« Connecter Gmail » : choisissez le compte à lire ({compteEmail || 'celui renseigné ci-dessus'}) et acceptez la lecture seule. C'est fini — premier scan sous 10 minutes.</li>
            </ol>
          </details>
          </details>
        </>
      )}
      {message && <p className="small" style={{ marginTop: 8 }}>{message}</p>}
    </Card>
  )
}

/** Synchronisation 2 postes via Supabase (offre gratuite) — opt-in, local-first préservé */
function CarteSync() {
  const { state, replace } = useStore()
  const cfg = state.settings.sync || { url: '', anonKey: '', workspaceId: 'agence-ll', email: '' }
  const [message, setMessage] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [, forcer] = useState(0)
  const etat = syncEtat()

  const majSync = (champ: 'url' | 'anonKey' | 'workspaceId' | 'email', v: string) =>
    replace({
      ...state,
      settings: {
        ...state.settings,
        sync: { ...(state.settings.sync || { url: '', anonKey: '', workspaceId: 'agence-ll' }), [champ]: v },
      },
    })

  const connecterEtReconcilier = async () => {
    setMessage('')
    setOccupe(true)
    try {
      await connecterSync(cfg.url, cfg.anonKey, cfg.workspaceId)
      if (!syncEtat().connecte) {
        setMessage('Projet relié. Envoyez le lien magique, ouvrez-le sur ce poste, puis revenez « Synchroniser ».')
        forcer((x) => x + 1)
        return
      }
      const remote = await tirerEtat()
      if (remote) {
        // l'espace partagé fait foi à la connexion (on garde la config locale)
        replace({ ...remote.data, settings: { ...remote.data.settings, sync: state.settings.sync } })
        setMessage('Données de l’espace partagé récupérées — les 2 postes sont alignés.')
      } else {
        await pousserEtat(state)
        setMessage('Espace partagé vide : vos données locales viennent de l’initialiser.')
      }
      forcer((x) => x + 1)
    } catch (e) {
      setMessage(`Impossible : ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setOccupe(false)
    }
  }

  const envoyer = async () => {
    setMessage('')
    try {
      if (!syncEtat().connecte && (!cfg.url || !cfg.anonKey)) {
        setMessage('Renseignez d’abord l’URL et la clé, puis « Relier le projet ».')
        return
      }
      await connecterSync(cfg.url, cfg.anonKey, cfg.workspaceId)
      await envoyerLienMagique(cfg.email || '')
      setMessage(`Lien magique envoyé à ${cfg.email} — ouvrez-le depuis CE poste pour vous connecter.`)
    } catch (e) {
      setMessage(`Envoi impossible : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const pousserMaintenant = async () => {
    setOccupe(true)
    try {
      await pousserEtat(state)
      setMessage('Vos données locales ont été poussées vers l’espace partagé (elles font foi).')
      forcer((x) => x + 1)
    } finally {
      setOccupe(false)
    }
  }

  const deconnecter = async () => {
    await deconnecterSync()
    setMessage('Déconnecté — ce poste repasse en mode local (localStorage).')
    forcer((x) => x + 1)
  }

  return (
    <Card titre="Synchronisation 2 postes — Supabase">
      <p className="small" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 8px' }}>
        {etat.connecte ? (
          <Badge tone="ok">connecté{etat.email ? ` — ${etat.email}` : ''}</Badge>
        ) : (
          <Badge tone="muted">non connecté — données locales</Badge>
        )}
        <span className="muted">Les 2 postes voient les mêmes données, sauvegardées hors du navigateur.</span>
        <span className="spacer" />
        {etat.connecte ? (
          <Btn small kind="primary" onClick={connecterEtReconcilier} disabled={occupe}>Synchroniser maintenant</Btn>
        ) : (
          <Btn small kind="primary" onClick={connecterEtReconcilier} disabled={occupe}>Relier / synchroniser</Btn>
        )}
      </p>
      <details open={!etat.connecte && !cfg.url}>
      <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>Détails & réglages</summary>
      <p className="small muted" style={{ margin: '8px 0 10px' }}>
        Optionnel et local-first : sans connexion, tout continue en localStorage. La clé « publique »
        se colle ici sans risque — l’accès est verrouillé à vos 2 adresses.
      </p>
      <div className="form-row">
        <Field label="URL du projet Supabase">
          <TextInput value={cfg.url} onChange={(v) => majSync('url', v)} placeholder="https://xxxx.supabase.co" />
        </Field>
        <Field label="Clé publique (anon / publishable)">
          <TextInput value={cfg.anonKey} onChange={(v) => majSync('anonKey', v)} placeholder="eyJhbGciOi…" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Identifiant d’espace" hint="le même sur les 2 postes (ex. agence-ll)">
          <TextInput value={cfg.workspaceId} onChange={(v) => majSync('workspaceId', v)} placeholder="agence-ll" />
        </Field>
        <Field label="Votre e-mail (lien magique)" hint="julenglet@gmail.com ou zoefhebert@gmail.com">
          <TextInput value={cfg.email || ''} onChange={(v) => majSync('email', v)} placeholder="julenglet@gmail.com" />
        </Field>
      </div>
      <div className="toolbar" style={{ marginTop: 8, marginBottom: 0, flexWrap: 'wrap' }}>
        {etat.connecte ? (
          <>
            <Badge tone="ok">connecté{etat.email ? ` — ${etat.email}` : ''}</Badge>
            <Btn small kind="primary" onClick={connecterEtReconcilier} disabled={occupe}>Synchroniser maintenant</Btn>
            <Btn small onClick={pousserMaintenant} disabled={occupe} title="Écrase l’espace partagé avec les données de CE poste">Pousser mes données</Btn>
            <Btn small onClick={deconnecter}>Déconnecter</Btn>
          </>
        ) : (
          <>
            <Btn kind="primary" onClick={envoyer} disabled={occupe || !cfg.email}>Envoyer le lien magique</Btn>
            <Btn small onClick={connecterEtReconcilier} disabled={occupe || !cfg.url || !cfg.anonKey}>Relier / synchroniser</Btn>
          </>
        )}
        {etat.derniereSync && <span className="small muted">dernière synchro : {fmtDate(etat.derniereSync)}</span>}
        {message && <span className="small">{message}</span>}
      </div>
      {etat.erreur && <p className="small danger-text" style={{ marginTop: 6 }}>Synchro : {etat.erreur}</p>}
      <details style={{ marginTop: 10 }}>
        <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
          Guide : créer le projet Supabase gratuit (une fois, ~5 min)
        </summary>
        <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.8 }}>
          <li>supabase.com → « New project » (offre gratuite, région <strong>West EU / Frankfurt</strong>).</li>
          <li>« SQL Editor » → collez le script fourni (table <code>workspace</code> + règles d’accès restreintes à vos 2 e-mails + temps réel) → Run.</li>
          <li>« Authentication » → Providers → activez <strong>Email</strong> (lien magique) ; désactivez les inscriptions publiques (« Allow new users to sign up » off) — vos 2 comptes suffisent.</li>
          <li>« Project Settings » → « API » : copiez <strong>Project URL</strong> et la clé <strong>anon / publishable</strong> ci-dessus.</li>
          <li>« Envoyer le lien magique », ouvrez-le sur ce poste, puis « Synchroniser ». Faites de même sur le 2ᵉ poste avec le même identifiant d’espace.</li>
        </ol>
      </details>
      </details>
    </Card>
  )
}

export default function Parametres({ ongletInitial = 'agence' }: { ongletInitial?: string }) {
  const route = useRoute()
  const { state, update, replace } = useStore()
  const s = state.settings
  const today = useToday()
  const segment = route[0] === 'parametres' ? route[1] : ongletInitial
  const onglet = ONGLETS.some((o) => o.id === segment) ? segment! : 'agence'
  const [messageExcel, setMessageExcel] = useState('')
  const [messageJSON, setMessageJSON] = useState('')
  const fichierExcel = useRef<HTMLInputElement>(null)
  const fichierJSON = useRef<HTMLInputElement>(null)

  // ---------- import Excel maître ----------

  const importerExcel = async (file: File) => {
    setMessageExcel('')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
      const ws = wb.Sheets['Dashboard']
      if (!ws) throw new Error('Onglet « Dashboard » introuvable dans ce classeur.')
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }) as unknown[][]

      // balayage par libellé : la première valeur numérique/date à droite du libellé
      const valeur = (libelle: string): unknown => {
        const cible = fold(libelle)
        for (const row of rows) {
          const i = row.findIndex((c) => typeof c === 'string' && fold(c).startsWith(cible))
          if (i >= 0) {
            for (let j = i + 1; j < row.length; j++) {
              const v = row[j]
              if (typeof v === 'number' || v instanceof Date) return v
            }
          }
        }
        return null
      }
      const nombre = (l: string): number | null => {
        const v = valeur(l)
        return typeof v === 'number' ? Math.round(v * 100) / 100 : null
      }
      const carnetHT = nombre('Carnet signé + en cours')
      const factureHT = nombre('Facturé HT (cumul)')
      const resteAFacturerHT = nombre('Reste à facturer HT')
      const pointBas = nombre('Point bas de trésorerie')
      const brutMois = valeur('Mois du point bas')
      const pointBasMois =
        brutMois instanceof Date
          ? brutMois.toISOString().slice(0, 7)
          : typeof brutMois === 'number'
            ? XLSX.SSF.format('yyyy-mm', brutMois)
            : null

      if (carnetHT === null && factureHT === null && resteAFacturerHT === null)
        throw new Error('Aucun total reconnu — est-ce bien le classeur « Pilotage_Agence_LL » ?')

      update((d) => {
        d.settings.dernierImportExcel = {
          fichier: file.name,
          date: todayISO(),
          carnetHT,
          factureHT,
          resteAFacturerHT,
          pointBas,
          pointBasMois,
        }
      })
      setMessageExcel(`Import réussi : ${file.name}.`)
    } catch (e) {
      setMessageExcel(`Échec de l'import : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ---------- sauvegarde / restauration ----------

  const exporterJSON = () => {
    // l'horodatage part AVEC l'export : le fichier sait qu'il est la dernière sauvegarde
    const copie = structuredClone(state)
    copie.settings.derniereSauvegarde = todayISO()
    download(`cockpit-ll-${todayISO()}.json`, JSON.stringify(copie, null, 2))
    update((d) => {
      d.settings.derniereSauvegarde = todayISO()
    })
    toast('Sauvegarde exportée.', { tone: 'ok' })
  }

  const importerJSON = async (file: File) => {
    setMessageJSON('')
    try {
      const data = JSON.parse(await file.text()) as AppState
      if (typeof data !== 'object' || data === null || !Array.isArray(data.projets) || typeof data.version !== 'number')
        throw new Error('Ce fichier ne ressemble pas à une sauvegarde du Cockpit.')
      if (
        !(await confirmer({
          message: `Remplacer TOUTES les données actuelles par « ${file.name} » (${data.projets.length} projets, ${data.factures?.length ?? 0} factures) ?`,
          danger: true,
        }))
      )
        return
      replace(data)
      setMessageJSON('Sauvegarde restaurée.')
    } catch (e) {
      setMessageJSON(`Échec : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const reinitialiser = async () => {
    if (await confirmer({ message: 'Réinitialiser sur les données d’exemple ? Toutes les données actuelles seront perdues (pensez à exporter avant).', danger: true }))
      replace(seedState())
  }

  // ---------- snoozes ----------

  const snoozes = Object.entries(s.snoozes).filter(([, until]) => until > today)
  const titreAlerte = (id: string) =>
    computeAlertes(state, today).find((a) => a.id === id)?.titre || id

  const maj = (fn: (d: AppState) => void) => update(fn)

  return (
    <Page titre="Paramètres" sousTitre="Réglages de l'agence, branchements, sauvegarde et prise en main.">
      <Tabs tabs={ONGLETS} actif={onglet} onSelect={(id) => navigate(`/parametres/${id}`)} />

      {onglet === 'agence' && (
        <>
      <div className="grid2">
        <Card titre="Trésorerie disponible (météo financière)">
          <div className="form-row">
            <Field label="Solde disponible (€)" hint="source : relevé bancaire ou Excel maître">
              <NumInput
                value={s.tresorerieDispo}
                onChange={(v) => maj((d) => void (d.settings.tresorerieDispo = v))}
              />
            </Field>
            <Field label="Mise à jour">
              <div className="toolbar" style={{ marginBottom: 0 }}>
                <span className="small muted">{s.tresorerieMajLe ? fmtDate(s.tresorerieMajLe) : 'jamais'}</span>
                <Btn small onClick={() => maj((d) => void (d.settings.tresorerieMajLe = todayISO()))}>
                  MAJ aujourd'hui
                </Btn>
              </div>
            </Field>
          </div>
        </Card>

        <Card titre="Excel maître (import mensuel)">
          <p className="small muted" style={{ marginBottom: 8 }}>
            L'Excel de pilotage (honoraires MIQCP + trésorerie) reste la source maître la première année :
            le Cockpit lit ses totaux, sans double saisie.
          </p>
          {s.dernierImportExcel ? (
            <dl className="kv">
              <dt>Dernier import</dt>
              <dd>
                {s.dernierImportExcel.fichier} — {fmtDate(s.dernierImportExcel.date)}
              </dd>
              <dt>Carnet signé + en cours</dt>
              <dd>{fmtMoney(s.dernierImportExcel.carnetHT)}</dd>
              <dt>Facturé HT (cumul)</dt>
              <dd>{fmtMoney(s.dernierImportExcel.factureHT)}</dd>
              <dt>Reste à facturer HT</dt>
              <dd>{fmtMoney(s.dernierImportExcel.resteAFacturerHT)}</dd>
              <dt>Point bas de trésorerie</dt>
              <dd>
                {fmtMoney(s.dernierImportExcel.pointBas)}
                {s.dernierImportExcel.pointBasMois ? ` (${s.dernierImportExcel.pointBasMois})` : ''}
              </dd>
            </dl>
          ) : (
            <p className="small muted">Aucun import pour l'instant.</p>
          )}
          <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
            <input
              ref={fichierExcel}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importerExcel(f)
                e.target.value = ''
              }}
            />
            <Btn kind="primary" onClick={() => fichierExcel.current?.click()}>
              Importer Pilotage_Agence_LL.xlsx
            </Btn>
            {messageExcel && <span className="small">{messageExcel}</span>}
          </div>
        </Card>
      </div>

      <CarteEquipe />

      <Card titre="Agence & calculs">
        <div className="form-row">
          <Field label="Nom de l'agence">
            <TextInput value={s.nomAgence} onChange={(v) => maj((d) => void (d.settings.nomAgence = v))} />
          </Field>
          <Field label="Équipe" hint="source unique : la carte « Équipe & coûts réels » ci-dessus">
            <div className="input input-ro">{s.personnes.join(', ') || '—'}</div>
          </Field>
          <Field
            label="Marge nette visée"
            hint="bénéfice après s'être payés — laissez vide pour saisir le CA cible à la main"
          >
            <PctInput
              value={s.margeCiblePct ?? null}
              onChange={(v) => maj((d) => void (d.settings.margeCiblePct = v))}
              placeholder="ex. 20"
              ariaLabel="Marge nette visée en pourcentage"
            />
          </Field>
        </div>
        {(() => {
          const o = objectifCA(state)
          return (
            <div style={{ margin: '2px 0 12px', padding: '10px 12px', background: 'var(--bg-soft, #f6f7fa)', borderRadius: 8 }}>
              <div className="form-row" style={{ alignItems: 'flex-end' }}>
                <Field
                  label="CA annuel cible HT (€)"
                  hint={o.auto ? 'calculé automatiquement depuis la marge visée' : 'saisi à la main (aucune marge visée)'}
                >
                  {o.auto ? (
                    <div className="input input-ro" style={{ fontWeight: 700 }}>{fmtMoney(o.caCible)}</div>
                  ) : (
                    <NumInput value={s.caCibleHT} onChange={(v) => maj((d) => void (d.settings.caCibleHT = v ?? 0))} />
                  )}
                </Field>
                <div className="muted small" style={{ flex: 1, minWidth: 240, paddingBottom: 6 }}>
                  {o.auto ? (
                    <>
                      Coûts d'agence <strong>{fmtMoney(o.coutsAnnuels)}</strong> ÷ (1 − {fmtPct(o.marge!, 0)}) ={' '}
                      <strong>{fmtMoney(o.caCible)}</strong> de CA à facturer pour dégager{' '}
                      <strong>{fmtMoney(o.resultatVise)}</strong> de résultat ({fmtPct(o.marge!, 0)} du CA).
                    </>
                  ) : (
                    <>
                      Renseignez une <strong>marge nette visée</strong> pour que le CA cible se calcule tout seul
                      (CA = coûts ÷ (1 − marge)). Coûts d'agence actuels : <strong>{fmtMoney(o.coutsAnnuels)}</strong>.
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })()}
        {(() => {
          const t = tauxVenteObjectif(state)
          const auto = !!s.tauxHoraireAuto
          return (
            <div style={{ margin: '2px 0 12px', padding: '10px 12px', background: 'var(--bg-soft, #f6f7fa)', borderRadius: 8 }}>
              <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginBottom: 8 }}>
                <input type="checkbox" checked={auto} onChange={(e) => maj((d) => void (d.settings.tauxHoraireAuto = e.target.checked))} />
                Calculer le <strong>&nbsp;taux horaire de vente&nbsp;</strong> automatiquement (frais fixes + salaires + marges)
              </label>
              <div className="form-row" style={{ alignItems: 'flex-end' }}>
                <Field
                  label="Taux horaire de vente (€)"
                  hint={auto ? 'calculé depuis les coûts et les marges' : 'prix d\'une heure vendue — saisi à la main'}
                >
                  {auto ? (
                    <div className="input input-ro" style={{ fontWeight: 700 }}>{fmtMoney(tauxVente(state), true)} / h</div>
                  ) : (
                    <NumInput value={s.tauxHoraireVente} onChange={(v) => maj((d) => void (d.settings.tauxHoraireVente = v ?? 0))} />
                  )}
                </Field>
                {auto && (
                  <Field label="Marge supplémentaire" hint="coussin au-delà de la marge nette (négo, imprévus, non-facturable)">
                    <PctInput
                      value={s.margeSecuritePct ?? null}
                      onChange={(v) => maj((d) => void (d.settings.margeSecuritePct = v))}
                      placeholder="ex. 10"
                      ariaLabel="Marge supplémentaire en pourcentage"
                    />
                  </Field>
                )}
                <div className="muted small" style={{ flex: 1, minWidth: 260, paddingBottom: 6 }}>
                  {auto ? (
                    <>
                      Au seuil <strong>{fmtMoney(t.base, true)}/h</strong> (coûts ÷ {Math.round(t.heuresFac)} h facturables/an)
                      {t.marge > 0 ? <> ÷ (1 − {fmtPct(t.marge, 0)})</> : null}
                      {t.margeSupp > 0 ? <> × (1 + {fmtPct(t.margeSupp, 0)})</> : null} ={' '}
                      <strong>{fmtMoney(t.taux, true)}/h</strong>.
                      {t.marge === 0 && ' Renseignez une marge nette visée ci-dessus pour viser un bénéfice.'}
                    </>
                  ) : (
                    <>
                      Cochez pour déduire le taux des coûts et des marges. Au seuil actuel :{' '}
                      <strong>{fmtMoney(t.base, true)}/h</strong> (couvre salaires + frais, sans marge).
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })()}
        <div className="form-row">
          <Field label="Coût horaire de revient" hint="ce qu'une heure coûte réellement (calculé depuis l'équipe) — l'écart avec le taux de vente = votre marge horaire">
            <div className="input input-ro">{fmtMoney(coutHoraireMoyen(state), true)} / h</div>
          </Field>
          <Field label="Heures / jour">
            <NumInput value={s.heuresParJour} onChange={(v) => maj((d) => void (d.settings.heuresParJour = v ?? 7.8))} />
          </Field>
          <Field label="Seuil de dérive heures" hint="90 % = alerte quand 90 % du budget d'heures est consommé">
            <PctInput
              value={s.seuilDeriveHeures}
              onChange={(v) => maj((d) => void (d.settings.seuilDeriveHeures = v ?? 0.9))}
              ariaLabel="Seuil de dérive heures en pourcentage"
            />
          </Field>
        </div>
        <div className="form-row">
          {TYPES_MO.map((t) => (
            <Field key={t} label={`Délai de paiement — ${t} (jours)`}>
              <NumInput
                value={s.delaisPaiement[t]}
                onChange={(v) => maj((d) => void (d.settings.delaisPaiement[t] = v ?? 30))}
              />
            </Field>
          ))}
        </div>
        <div className="form-row">
          <Field
            label="Indice BT01 actuel"
            hint="dernier connu : 137,5 (avril 2026, JO du 14/06/2026) — série Insee 001710986, ~2 mois de décalage. Réf. avril 1994 = 60,989."
          >
            <NumInput value={s.bt01Actuel} onChange={(v) => maj((d) => void (d.settings.bt01Actuel = v ?? 137.5))} />
          </Field>
          <Field label="Nomenclature documentaire" hint="à figer avant septembre">
            <TextInput value={s.nomenclature} onChange={(v) => maj((d) => void (d.settings.nomenclature = v))} />
          </Field>
        </div>
        <p className="small muted">
          Le barème MIQCP n'a aucune valeur réglementaire (interdiction des barèmes depuis 2016) : c'est une
          référence de négociation. Sous ~{fmtMoney((457347.05 * s.bt01Actuel) / s.bt01Ref1994)} de travaux
          actualisés, le guide renvoie au chiffrage en temps passé.
        </p>
      </Card>

      <Card titre="Coordonnées légales & bancaires — imprimées sur les factures">
        <p className="small muted" style={{ marginBottom: 10 }}>
          Ces informations apparaissent automatiquement sur les factures PDF (en-tête, pied de page,
          bloc de règlement). À renseigner une fois.
        </p>
        <div className="form-row">
          <Field label="Adresse de l'agence">
            <TextInput value={s.adresseAgence || ''} onChange={(v) => maj((d) => void (d.settings.adresseAgence = v))} />
          </Field>
          <Field label="SIRET">
            <TextInput value={s.siretAgence || ''} onChange={(v) => maj((d) => void (d.settings.siretAgence = v))} />
          </Field>
          <Field label="N° TVA intracom.">
            <TextInput value={s.numeroTVA || ''} onChange={(v) => maj((d) => void (d.settings.numeroTVA = v))} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="RCS">
            <TextInput value={s.rcs || ''} onChange={(v) => maj((d) => void (d.settings.rcs = v))} placeholder="ex. Beauvais 900 123 456" />
          </Field>
          <Field label="Capital social">
            <TextInput value={s.capitalSocial || ''} onChange={(v) => maj((d) => void (d.settings.capitalSocial = v))} placeholder="ex. 5 000 €" />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Banque">
            <TextInput value={s.banque || ''} onChange={(v) => maj((d) => void (d.settings.banque = v))} />
          </Field>
          <Field label="IBAN">
            <TextInput value={s.iban || ''} onChange={(v) => maj((d) => void (d.settings.iban = v))} />
          </Field>
          <Field label="BIC">
            <TextInput value={s.bic || ''} onChange={(v) => maj((d) => void (d.settings.bic = v))} />
          </Field>
        </div>
      </Card>
        </>
      )}

      {onglet === 'donnees' && (
        <>
      <div className="grid2">
        <Card titre="Sauvegarde des données">
          <p className="small muted" style={{ marginBottom: 10 }}>
            Stockage local (navigateur, clé <code>cockpit-ll-v1</code>). En cible : Supabase hébergée en
            région UE. En attendant : export JSON régulier, déposé dans le Drive de l'agence.
          </p>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <Btn kind="primary" onClick={exporterJSON}>
              Exporter les données (JSON)
            </Btn>
            <input
              ref={fichierJSON}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importerJSON(f)
                e.target.value = ''
              }}
            />
            <Btn onClick={() => fichierJSON.current?.click()}>Restaurer une sauvegarde</Btn>
            <Btn kind="danger" onClick={reinitialiser}>
              Réinitialiser (exemples)
            </Btn>
          </div>
          {messageJSON && <p className="small" style={{ marginTop: 8 }}>{messageJSON}</p>}
        </Card>

        <Card titre="Alertes en sommeil">
          {snoozes.length === 0 ? (
            <p className="small muted">Aucune alerte en sommeil.</p>
          ) : (
            <Table head={['Alerte', 'Jusqu’au', '']} compact>
              {snoozes.map(([id, until]) => (
                <tr key={id}>
                  <td className="small">{titreAlerte(id)}</td>
                  <td>
                    <Badge tone="muted">{fmtDate(until)}</Badge>
                  </td>
                  <td className="right">
                    <Btn
                      small
                      kind="ghost"
                      onClick={() => maj((d) => void delete d.settings.snoozes[id])}
                    >
                      Réveiller
                    </Btn>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
        </>
      )}

      {onglet === 'branchements' && (
        <>
      <CarteSurveillance />
      <CarteSync />
      <CarteIngestionServeur />
      <SanteContenu />
        </>
      )}

      {onglet === 'demarrer' && <BienDemarrerContenu />}
    </Page>
  )
}
