// ============================================================
// Santé des branchements — LA page pour répondre à « est-ce que
// tout marche ? ». Chaque interconnexion (Gmail, Agenda, BOAMP,
// Drive local, Whisper, routines Claude, sauvegarde) montre son
// état réel et se teste en un clic, avec le journal de ce qui a
// été capté. Aucun test n'envoie de données ailleurs.
// ============================================================

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '../store'
import { Badge, Btn, Card, EmptyState } from '../ui'
import { diffDays, fmtDate, todayISO } from '../util'
import { estConnecte } from '../google'
import { syncEtat } from '../sync'
import { dernierScan, journalSurveillance, scannerUneFois } from '../surveillance'
import { CRITERES_DEFAUT, derniereRechercheBoamp, rechercherBoamp } from '../boamp'
import { relaisDisponible } from '../relais'
import { rechercherTed } from '../ted'
import { choisirRacine, lireRacine, supporteFS, testerEcriture, verifierPermission } from '../fsdrive'
import type { FSDirHandle } from '../fsdrive'
import { MODELES_WHISPER, testerModele } from '../transcription'

// ---------- briques ----------

type Etat = 'ok' | 'attention' | 'coupe'

function Pastille({ etat }: { etat: Etat }) {
  const c = etat === 'ok' ? 'var(--ok)' : etat === 'attention' ? 'var(--warn)' : 'var(--danger)'
  return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: c, marginRight: 8 }} />
}

function Branchement({
  etat,
  titre,
  children,
  actions,
}: {
  etat: Etat
  titre: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <Card
      titre={
        <>
          <Pastille etat={etat} />
          {titre}
        </>
      }
      actions={actions}
    >
      {children}
    </Card>
  )
}

function Verdict({ v }: { v: { ok: boolean; texte: string } | null }) {
  if (!v) return null
  return (
    <p className={`small ${v.ok ? 'ok-text' : 'danger-text'}`} style={{ marginTop: 8 }}>
      {v.ok ? '✓ ' : '✗ '}
      {v.texte}
    </p>
  )
}

function CommentTester({ children }: { children: ReactNode }) {
  return (
    <p className="muted small" style={{ marginTop: 8 }}>
      <strong>Test grandeur nature :</strong> {children}
    </p>
  )
}

const fmtInstant = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// ---------- Gmail & Agenda ----------

function SanteGoogle() {
  const { state, update } = useStore()
  const sv = state.settings.surveillance
  const connecte = estConnecte()
  const [verdict, setVerdict] = useState<{ ok: boolean; texte: string } | null>(null)
  const [enCours, setEnCours] = useState(false)
  const journal = journalSurveillance()
  const scan = dernierScan()

  const etat: Etat = !sv?.clientId ? 'coupe' : connecte ? 'ok' : 'attention'

  const scanner = async () => {
    setEnCours(true)
    setVerdict(null)
    try {
      const r = await scannerUneFois(state, update)
      setVerdict({
        ok: true,
        texte: `Scan réussi : ${r.totalMails} mail(s) sur 48 h, ${r.nouveauxMails} nouveau(x) rangé(s), ${r.evenements.length} événement(s) d'agenda sous 72 h.`,
      })
    } catch (e) {
      setVerdict({ ok: false, texte: e instanceof Error ? e.message : 'Échec du scan.' })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Branchement
      etat={etat}
      titre="Gmail & Google Agenda — mails rangés automatiquement"
      actions={
        <Btn small kind="primary" onClick={scanner} disabled={!connecte || enCours}>
          {enCours ? 'Scan…' : 'Scanner maintenant'}
        </Btn>
      }
    >
      {!sv?.clientId ? (
        <p className="small">
          Pas encore configuré — le Client ID Google se crée en 10 minutes (guide dans le réglage{' '}
          <a href="#/parametres/branchements">Surveillance</a> ci-dessus). Ensuite, chaque mail reçu
          apparaît dans « À traiter », rattaché au bon projet.
        </p>
      ) : (
        <>
          <p className="small">
            {connecte ? (
              <Badge tone="ok">connecté — scan automatique toutes les 60 s tant qu'un onglet est ouvert</Badge>
            ) : (
              <>
                <Badge tone="warn">session coupée</Badge>{' '}
                <a href="#/parametres/branchements">se reconnecter</a> (réglage ci-dessus ; la session Google dure ~1 h)
              </>
            )}
            {scan && <span className="muted"> · dernier scan : {fmtInstant(scan)}</span>}
            {sv.email && <span className="muted"> · adresse surveillée : {sv.email}</span>}
          </p>
          <Verdict v={verdict} />
          <CommentTester>
            envoyez-vous un mail avec « {state.projets[0]?.id || 'P01'} » dans l'objet, puis cliquez
            « Scanner maintenant » : il doit apparaître dans le journal ci-dessous et dans la boîte
            « À traiter » du Cockpit, rattaché au projet.
          </CommentTester>
          <div style={{ marginTop: 10 }}>
            <div className="muted small" style={{ fontWeight: 700, marginBottom: 4 }}>
              Journal — ce que la surveillance a réellement capté
            </div>
            {journal.length === 0 ? (
              <EmptyState>Rien capté pour l'instant — le journal se remplit au premier mail reçu.</EmptyState>
            ) : (
              journal.slice(0, 12).map((e, i) => (
                <div key={i} className="small" style={{ padding: '3px 0', borderBottom: '1px solid var(--line)' }}>
                  <span className="muted">{fmtInstant(e.ts)}</span>{' '}
                  {e.type === 'erreur' ? <span className="danger-text">{e.message}</span> : e.message}{' '}
                  {e.projetId && <a href={`#/projets/${e.projetId}`}>ouvrir {e.projetId}</a>}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </Branchement>
  )
}

// ---------- BOAMP ----------

function SanteBoamp() {
  const { state } = useStore()
  const criteres = state.settings.veilleBoamp || CRITERES_DEFAUT
  const derniere = derniereRechercheBoamp()
  const [verdict, setVerdict] = useState<{ ok: boolean; texte: string } | null>(null)
  const [enCours, setEnCours] = useState(false)

  const etat: Etat = derniere?.erreur ? 'attention' : 'ok'

  const tester = async () => {
    setEnCours(true)
    setVerdict(null)
    const debut = performance.now()
    try {
      const annonces = await rechercherBoamp(criteres, todayISO(), 5)
      setVerdict({
        ok: true,
        texte: `BOAMP répond en ${Math.round(performance.now() - debut)} ms — ${annonces.length} annonce(s) récente(s) pour vos critères (« ${criteres.motsCles} », dép. ${criteres.departements || 'France'}).`,
      })
    } catch (e) {
      setVerdict({ ok: false, texte: e instanceof Error ? e.message : 'Échec BOAMP.' })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Branchement
      etat={etat}
      titre="Veille BOAMP — appels d'offres officiels, sans routine"
      actions={
        <Btn small kind="primary" onClick={tester} disabled={enCours}>
          {enCours ? 'Test…' : 'Tester la connexion'}
        </Btn>
      }
    >
      <p className="small">
        Le site interroge directement l'API ouverte du BOAMP (DILA) — gratuite, sans clé, sans
        compte. Les annonces s'ajoutent en un clic dans la page <a href="#/ao">Appels d'offres</a>.
        {derniere && (
          <span className="muted">
            {' '}
            Dernière recherche : {fmtInstant(derniere.date)}{' '}
            {derniere.erreur ? `(échec : ${derniere.erreur})` : `(${derniere.nb} annonce(s))`}.
          </span>
        )}
      </p>
      <Verdict v={verdict} />
      <CommentTester>
        cliquez « Tester la connexion » — un résultat en moins d'une seconde confirme que la veille
        marchera aussi depuis la page Appels d'offres.
      </CommentTester>
    </Branchement>
  )
}

// ---------- relais Vercel (TED & sources sans CORS) ----------

function SanteRelais() {
  const { state } = useStore()
  const [dispo, setDispo] = useState<boolean | null>(null)
  const [verdict, setVerdict] = useState<{ ok: boolean; texte: string } | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    void relaisDisponible().then(setDispo)
  }, [])

  const tester = async () => {
    setEnCours(true)
    setVerdict(null)
    const debut = performance.now()
    try {
      const criteres = state.settings.veilleBoamp || CRITERES_DEFAUT
      const annonces = await rechercherTed(criteres, todayISO(), 3)
      setVerdict({
        ok: true,
        texte: `TED répond via le relais en ${Math.round(performance.now() - debut)} ms — ${annonces.length} avis européen(s) récent(s) pour vos mots-clés.`,
      })
    } catch (e) {
      setVerdict({ ok: false, texte: e instanceof Error ? e.message : 'Échec du test TED.' })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Branchement
      etat={dispo === null ? 'attention' : dispo ? 'ok' : 'attention'}
      titre="Relais du site — TED & plateformes sans accès navigateur"
      actions={
        <Btn small kind="primary" onClick={tester} disabled={!dispo || enCours}>
          {enCours ? 'Test…' : 'Tester TED via le relais'}
        </Btn>
      }
    >
      <p className="small">
        {dispo === null ? (
          'Vérification…'
        ) : dispo ? (
          <Badge tone="ok">relais actif — TED alimente la veille Appels d'offres</Badge>
        ) : (
          <Badge tone="warn">relais injoignable</Badge>
        )}{' '}
        <span className="muted">
          Une seule petite fonction gratuite hébergée avec le site (Vercel) : elle va chercher les
          plateformes fermées aux navigateurs (TED — marchés européens). Rien n'est stocké, domaines
          en liste blanche. En local (hors site déployé), il est normal qu'elle soit injoignable.
        </span>
      </p>
      <Verdict v={verdict} />
      <CommentTester>
        cliquez le test : quelques avis européens doivent remonter. Ensuite, page Appels d'offres →
        « Rechercher » : les lignes marquées TED viennent du relais.
      </CommentTester>
    </Branchement>
  )
}

// ---------- Drive local ----------

function SanteDrive() {
  const [racine, setRacine] = useState<FSDirHandle | null>(null)
  const [charge, setCharge] = useState(false)
  const [verdict, setVerdict] = useState<{ ok: boolean; texte: string } | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    void lireRacine().then((h) => {
      setRacine(h)
      setCharge(true)
    })
  }, [])

  const etat: Etat = !supporteFS ? 'coupe' : racine ? 'ok' : 'attention'

  const choisir = async () => {
    const h = await choisirRacine()
    if (h) {
      setRacine(h)
      setVerdict({ ok: true, texte: `Dossier « ${h.name} » branché et mémorisé.` })
    }
  }

  const tester = async () => {
    if (!racine) return
    setEnCours(true)
    setVerdict(null)
    try {
      await verifierPermission(racine)
      await testerEcriture(racine)
      setVerdict({
        ok: true,
        texte: `Écriture, relecture et suppression d'un fichier témoin réussies dans « ${racine.name} » — le rangement automatique (documents, photos, CR) fonctionnera.`,
      })
    } catch (e) {
      setVerdict({ ok: false, texte: e instanceof Error ? e.message : "Échec du test d'écriture." })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Branchement
      etat={etat}
      titre="Drive local — rangement automatique des fichiers"
      actions={
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <Btn small onClick={choisir} disabled={!supporteFS}>
            {racine ? 'Changer de dossier' : 'Choisir le dossier'}
          </Btn>
          <Btn small kind="primary" onClick={tester} disabled={!racine || enCours}>
            {enCours ? 'Test…' : "Tester l'écriture"}
          </Btn>
        </span>
      }
    >
      {!supporteFS ? (
        <p className="small">
          Ce navigateur ne permet pas d'écrire dans un dossier local (il faut Chrome ou Edge).
          Les documents restent téléchargeables un par un.
        </p>
      ) : (
        <p className="small">
          {charge && racine ? (
            <>
              <Badge tone="ok">dossier branché : {racine.name}</Badge>{' '}
              <span className="muted">
                — visez le dossier « Google Drive » du poste : ce qui y est écrit se synchronise tout seul.
              </span>
            </>
          ) : charge ? (
            <>
              <Badge tone="warn">aucun dossier branché</Badge>{' '}
              <span className="muted">— choisissez le dossier Drive local pour activer le rangement automatique.</span>
            </>
          ) : (
            'Vérification…'
          )}
        </p>
      )}
      <Verdict v={verdict} />
      <CommentTester>
        après le test, déposez une photo dans le journal d'un projet : elle doit apparaître dans
        le dossier du projet, sous 10_PHOTOS, avec un nom normé.
      </CommentTester>
    </Branchement>
  )
}

// ---------- Whisper ----------

function SanteWhisper() {
  const [verdict, setVerdict] = useState<{ ok: boolean; texte: string } | null>(null)
  const [progres, setProgres] = useState('')
  const [enCours, setEnCours] = useState(false)
  const webgpu = 'gpu' in navigator

  const tester = async () => {
    setEnCours(true)
    setVerdict(null)
    const debut = performance.now()
    try {
      await testerModele(MODELES_WHISPER[0].id, (p) => setProgres(p.pct != null ? `${p.etape} ${p.pct} %` : p.etape))
      setVerdict({
        ok: true,
        texte: `Modèle opérationnel (${Math.round((performance.now() - debut) / 1000)} s) — la transcription des réunions de chantier fonctionnera, entièrement sur cette machine.`,
      })
    } catch (e) {
      setVerdict({ ok: false, texte: e instanceof Error ? e.message : 'Échec du chargement du modèle.' })
    } finally {
      setEnCours(false)
      setProgres('')
    }
  }

  return (
    <Branchement
      etat={webgpu ? 'ok' : 'attention'}
      titre="Transcription Whisper — réunions de chantier"
      actions={
        <Btn small kind="primary" onClick={tester} disabled={enCours}>
          {enCours ? 'Test…' : 'Précharger & tester le modèle'}
        </Btn>
      }
    >
      <p className="small">
        {webgpu ? (
          <Badge tone="ok">WebGPU disponible — transcription rapide</Badge>
        ) : (
          <Badge tone="warn">pas de WebGPU — la transcription marchera, mais lentement (WASM)</Badge>
        )}{' '}
        <span className="muted">
          Modèle par défaut : {MODELES_WHISPER[0].label}. Le test télécharge le modèle une fois
          (~250 Mo), le met en cache, et vérifie une inférence — à faire une fois au calme.
        </span>
      </p>
      {progres && <p className="small muted" style={{ marginTop: 8 }}>{progres}</p>}
      <Verdict v={verdict} />
      <CommentTester>
        pour juger la qualité réelle : onglet Chantier d'un projet → « Déposer l'enregistrement »
        avec 2 minutes d'audio de réunion — comptez ~1 min de calcul par 5 min d'audio en WebGPU.
      </CommentTester>
    </Branchement>
  )
}

// ---------- routines Claude & données ----------

function LigneImport({ libelle, date, lien, aide }: { libelle: string; date?: string; lien: string; aide: string }) {
  const today = todayISO()
  const age = date ? diffDays(date, today) : null
  return (
    <div className="small" style={{ padding: '4px 0' }}>
      <a href={lien}>{libelle}</a>{' '}
      {date ? (
        <Badge tone={age !== null && age > 7 ? 'warn' : 'ok'}>
          dernier import {age === 0 ? "aujourd'hui" : `il y a ${age} j`}
        </Badge>
      ) : (
        <Badge tone="muted">jamais importé</Badge>
      )}
      <span className="muted"> — {aide}</span>
    </div>
  )
}

function SanteRoutines() {
  const { state } = useStore()
  const di = state.settings.derniersImports || {}
  const etat: Etat = Object.keys(di).length > 0 ? 'ok' : 'attention'

  return (
    <Branchement etat={etat} titre="Routines Claude — ce qui passe encore par un collage">
      <p className="small muted" style={{ marginBottom: 6 }}>
        Trois flux passent par une routine Claude programmée (page <a href="#/routines">Routines</a>) :
        la date du dernier collage dit si le circuit vit ou s'il est à relancer.
      </p>
      <LigneImport
        libelle="Situations de travaux (quotidienne)"
        date={di['situations']}
        lien="#/situations"
        aide="la routine lit la boîte situations@ et dépose un JSON à coller dans Situations"
      />
      <LigneImport
        libelle="Tri du matin — courriers (quotidienne)"
        date={di['courriers']}
        lien="#/routines"
        aide="utile en complément de la surveillance directe : classement des mails en dossiers Gmail"
      />
      <LigneImport
        libelle="Veille AO complémentaire (hebdo — TED, sources privées)"
        date={di['consultations']}
        lien="#/ao"
        aide="le BOAMP est maintenant automatique ; la routine reste pour le reste"
      />
    </Branchement>
  )
}

function SanteDonnees() {
  const { state } = useStore()
  const s = state.settings
  const today = todayISO()
  const age = s.derniereSauvegarde ? diffDays(s.derniereSauvegarde, today) : null
  const etat: Etat = age === null ? 'attention' : age > 14 ? 'attention' : 'ok'

  return (
    <Branchement etat={etat} titre="Vos données — sauvegarde & source Excel">
      <p className="small">
        Tout vit dans ce navigateur (localStorage) : un export JSON régulier est votre ceinture de
        sécurité.{' '}
        {s.derniereSauvegarde ? (
          <Badge tone={age !== null && age > 14 ? 'warn' : 'ok'}>
            dernière sauvegarde : {fmtDate(s.derniereSauvegarde)}
          </Badge>
        ) : (
          <Badge tone="warn">aucune sauvegarde JSON pour l'instant</Badge>
        )}{' '}
        <a href="#/parametres/donnees">exporter maintenant (30 s)</a>
      </p>
      <p className="small muted" style={{ marginTop: 6 }}>
        Excel maître :{' '}
        {s.dernierImportExcel
          ? `importé le ${fmtDate(s.dernierImportExcel.date)} (${s.dernierImportExcel.fichier})`
          : 'jamais importé — utile la première année pour caler les totaux'}
        .
      </p>
    </Branchement>
  )
}

function SanteSync() {
  const { state } = useStore()
  const cfg = state.settings.sync
  const etat_ = syncEtat()
  const etat: Etat = !cfg?.url || !cfg.anonKey ? 'coupe' : etat_.connecte ? 'ok' : 'attention'

  return (
    <Branchement etat={etat} titre="Synchronisation 2 postes — Supabase (temps réel + sauvegarde)">
      {!cfg?.url || !cfg.anonKey ? (
        <p className="small">
          Pas encore configurée — optionnelle. Reliez un projet Supabase gratuit dans le réglage{' '}
          <a href="#/parametres/branchements">Synchronisation</a> ci-dessus pour partager l’état entre Julien et
          Zoé en temps réel (et l’avoir sauvegardé hors du navigateur). Sans elle, tout reste en local.
        </p>
      ) : (
        <p className="small">
          {etat_.connecte ? (
            <Badge tone="ok">connecté{etat_.email ? ` — ${etat_.email}` : ''} · les 2 postes convergent en ~1–2 s</Badge>
          ) : (
            <>
              <Badge tone="warn">session non connectée</Badge>{' '}
              <a href="#/parametres/branchements">se connecter (lien magique, réglage ci-dessus)</a>
            </>
          )}
          {etat_.derniereSync && <span className="muted"> · dernière synchro : {fmtInstant(etat_.derniereSync)}</span>}
          {etat_.erreur && <span className="danger-text"> · {etat_.erreur}</span>}
        </p>
      )}
    </Branchement>
  )
}

// ---------- contenu (onglet Branchements de Paramètres) ----------

export function SanteContenu() {
  return (
    <>
      <p className="small muted" style={{ margin: '0 0 4px' }}>
        Un bouton pour tester chaque branchement. Vert = ça tourne.
      </p>
      <SanteGoogle />
      <SanteBoamp />
      <SanteRelais />
      <SanteDrive />
      <SanteWhisper />
      <SanteRoutines />
      <SanteSync />
      <SanteDonnees />
    </>
  )
}
