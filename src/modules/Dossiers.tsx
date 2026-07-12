// ============================================================
// Dossiers de poursuite — audit V3 lots 3 & 4. La page ne montre
// QUE les affaires où l'agence a décidé d'investir du temps
// (Go / déposées). Chaque dossier : en-tête opérationnel,
// checklist DYNAMIQUE issue du RC (chaque exigence garde sa
// source), documents du registre, temps pointé → coût réel,
// valeur attendue transparente, et un « prêt à déposer » contrôlé.
// Le concours suit ses propres étapes (candidature → sélection →
// rendu → jury) sans détourner les statuts d'un AO classique.
// ============================================================

import { useMemo, useRef, useState } from 'react'
import type {
  CategorieExigence,
  Consultation,
  DocumentRecord,
  EtapeConcours,
  ExigenceDossier,
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
  Money,
  NumInput,
  Progress,
  Select,
  Stat,
  TextArea,
  TextInput,
  navigate,
  toast,
  useRoute,
  useToday,
} from '../ui'
import { diffDays, fmtHeures, fold, mondayOf, todayISO, uid } from '../util'
import { probaConsultation } from '../derive'
import { unzipSync } from 'fflate'
import { extraireTexteFichier } from '../cctp'
import {
  CATEGORIES_EXIGENCE,
  ETAPES_CONCOURS,
  avancementDossier,
  checklistDeBase,
  controleAvantDepot,
  coutDossier,
  extraireExigencesRC,
  piecesAdminReutilisables,
  statutPourEtapeConcours,
  valeurAttendue,
  type ExtractionRC,
} from '../dossier'

// ---------- liste ----------

export function DossiersContenu() {
  const { state } = useStore()
  const route = useRoute()
  const today = useToday()
  const id = route[0] === 'ao' && route[1] === 'dossiers' ? route[2] : undefined
  const dossier = id ? state.consultations.find((c) => c.id === id) : undefined
  if (dossier) return <FicheDossier c={dossier} />

  const actifs = state.consultations
    .filter((c) => c.statut === 'go' || c.statut === 'deposee')
    .sort((a, b) => (a.dateLimite || '9999').localeCompare(b.dateLimite || '9999'))

  return (
    <>
      <Card titre="Dossiers en cours">
        <p className="small muted" style={{ marginTop: 0, marginBottom: 10 }}>
          Ici, uniquement les affaires décidées <strong>Go</strong> ou déposées — le tri se fait
          dans le Radar et le pipeline. Chaque dossier porte sa checklist issue du RC, ses
          documents, son temps passé et son contrôle avant dépôt.
        </p>
        {actifs.length === 0 ? (
          <EmptyState>
            Aucun dossier en cours. Passez une consultation en « Go » (pipeline ou fiche) : elle
            apparaîtra ici avec sa checklist de réponse.
          </EmptyState>
        ) : (
          <div className="grid2">
            {actifs.map((c) => (
              <CarteDossier key={c.id} c={c} today={today} />
            ))}
          </div>
        )}
      </Card>
    </>
  )
}

function CarteDossier({ c, today }: { c: Consultation; today: string }) {
  const { state } = useStore()
  const av = avancementDossier(c)
  const { heures } = coutDossier(state, c.id)
  const dj = c.dateLimite ? diffDays(today, c.dateLimite) : null
  const etapeConcours = c.typeAvis === 'concours' ? ETAPES_CONCOURS.find((e) => e.id === (c.concours?.etape || 'candidature')) : null
  return (
    <div
      className="card clickable"
      style={{ padding: 12 }}
      onClick={() => navigate(`/ao/dossiers/${c.id}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate(`/ao/dossiers/${c.id}`)
      }}
    >
      <div style={{ fontWeight: 700, lineHeight: 1.3 }}>{c.intitule}</div>
      <div className="muted small" style={{ marginTop: 2 }}>{c.acheteur || 'acheteur à renseigner'}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
        <Badge tone={c.typeAvis === 'concours' ? 'info' : 'muted'}>
          {c.typeAvis === 'concours' ? 'Concours' : 'Appel d’offres'}
        </Badge>
        {etapeConcours && <Badge tone="info">{etapeConcours.label}</Badge>}
        {c.statut === 'deposee' && <Badge tone="warn">Déposé — en attente</Badge>}
        {dj !== null && (
          <Badge tone={dj < 0 ? 'muted' : dj <= 7 ? 'danger' : dj <= 15 ? 'warn' : 'ok'}>
            {dj < 0 ? 'limite passée' : `J−${dj}`}
          </Badge>
        )}
        {c.pour && <span className="muted small">{c.pour}</span>}
      </div>
      <div style={{ marginTop: 10 }}>
        <Progress
          value={av.faits}
          max={Math.max(1, av.total)}
          header={
            <>
              <span>Checklist</span>
              <span>
                {av.total === 0 ? 'à générer' : `${av.faits} / ${av.total}`}
                {heures > 0 && ` · ${fmtHeures(heures)} pointées`}
              </span>
            </>
          }
        />
      </div>
    </div>
  )
}

// ---------- fiche dossier ----------

function FicheDossier({ c }: { c: Consultation }) {
  const { state, update } = useStore()
  const today = useToday()

  const maj = (patch: Partial<Consultation>) => {
    const propre = structuredClone(patch)
    update((d) => {
      const x = d.consultations.find((y) => y.id === c.id)
      if (x) Object.assign(x, propre)
    })
  }

  const av = avancementDossier(c)
  const cout = coutDossier(state, c.id)
  const controle = controleAvantDepot(state, c, today)
  const concours = c.typeAvis === 'concours'
  const etape = c.concours?.etape || 'candidature'
  const echeance = c.dateLimite || (concours ? c.concours?.dateJury || null : null)

  // action principale = la porte contrôlée du dépôt
  const labelDepot = concours
    ? etape === 'selectionne'
      ? 'Marquer le projet rendu'
      : etape === 'candidature'
        ? 'Marquer la candidature déposée'
        : null
    : c.statut === 'go'
      ? 'Marquer le dossier déposé'
      : null

  const deposer = () => {
    if (!controle.pret) {
      toast('Dépôt bloqué : ' + controle.bloquants[0], { tone: 'danger' })
      return
    }
    if (concours) {
      const suivante: EtapeConcours = etape === 'candidature' ? 'candidature_deposee' : 'rendu'
      maj({
        concours: { ...(c.concours || { etape: 'candidature' }), etape: suivante },
        statut: statutPourEtapeConcours(suivante),
        dernierMouvement: todayISO(),
      })
    } else {
      maj({ statut: 'deposee', dernierMouvement: todayISO() })
    }
    toast('Dossier marqué déposé — le résultat se saisit dans la fiche consultation.')
  }

  return (
    <>
      <div className="toolbar">
        <Btn small kind="ghost" onClick={() => navigate('/ao/dossiers')}>
          ← Tous les dossiers
        </Btn>
        <span className="spacer" />
        <Btn small kind="ghost" onClick={() => navigate('/ao/consultations')}>
          Fiche consultation (Go/No-Go, résultat)
        </Btn>
      </div>

      <Card titre={c.intitule}>
        <div className="muted small" style={{ marginTop: -6, marginBottom: 10 }}>
          {c.acheteur || 'acheteur à renseigner'}
          {' · '}
          <Badge tone={concours ? 'info' : 'muted'}>{concours ? 'Concours' : 'Appel d’offres'}</Badge>
          {c.sourceUrl && (
            <>
              {' · '}
              <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                avis officiel ↗
              </a>
            </>
          )}
        </div>
        {/* en-tête opérationnel : répondre en 5 s à « où en est-on ? » */}
        <div className="grid4">
          <Stat
            label="Prochaine échéance"
            value={echeance ? <DateF d={echeance} /> : '—'}
            sub={
              echeance
                ? (() => {
                    const dj = diffDays(today, echeance)
                    return dj >= 0 ? `J−${dj}` : `dépassée de ${-dj} j`
                  })()
                : 'date limite à renseigner'
            }
            tone={echeance && diffDays(today, echeance) <= 7 && diffDays(today, echeance) >= 0 ? 'danger' : undefined}
          />
          <Stat
            label="Complétude"
            value={av.total === 0 ? '—' : `${av.faits} / ${av.total}`}
            sub={av.total === 0 ? 'checklist à générer' : `${Math.round(av.pct * 100)} % de la checklist`}
          />
          <Stat
            label="Coût engagé"
            value={<Money v={cout.cout} />}
            sub={cout.heures > 0 ? `${fmtHeures(cout.heures)} pointées` : 'aucune heure pointée'}
          />
          <Stat
            label="État"
            value={
              controle.pret ? <Badge tone="ok">prêt à déposer</Badge> : <Badge tone="warn">en préparation</Badge>
            }
            sub={controle.bloquants.length > 0 ? `${controle.bloquants.length} point(s) bloquant(s)` : 'contrôles passés'}
          />
        </div>
        <div className="form-row" style={{ marginTop: 12 }}>
          <Field label="Responsable du dossier">
            <Select
              value={c.pour || ''}
              onChange={(v) => maj({ pour: v || undefined })}
              options={[{ value: '', label: '— à désigner —' }, ...state.settings.personnes.map((p) => ({ value: p, label: p }))]}
            />
          </Field>
          <Field label="Date limite (phase en cours)">
            <DateInput value={c.dateLimite ?? null} onChange={(v) => maj({ dateLimite: v })} />
          </Field>
          <Field label="Type de parcours">
            <Select
              value={c.typeAvis || 'marche'}
              onChange={(v) =>
                maj({
                  typeAvis: v as 'marche' | 'concours',
                  concours: v === 'concours' ? c.concours || { etape: 'candidature' } : c.concours,
                })
              }
              options={[
                { value: 'marche', label: 'Appel d’offres classique' },
                { value: 'concours', label: 'Concours (2 phases)' },
              ]}
            />
          </Field>
        </div>
      </Card>

      {concours && <CarteConcours c={c} maj={maj} />}
      <CarteChecklist c={c} maj={maj} />
      <CarteDocumentsDossier c={c} today={today} />
      <div className="grid2">
        <CarteTempsDossier c={c} />
        <CarteValeurDossier c={c} />
      </div>
      <CarteDepot controle={controle} labelDepot={labelDepot} onDeposer={deposer} />
    </>
  )
}

// ---------- volet concours (Lot 4) ----------

function CarteConcours({ c, maj }: { c: Consultation; maj: (p: Partial<Consultation>) => void }) {
  const v = c.concours || { etape: 'candidature' as EtapeConcours }
  const majConcours = (patch: Partial<typeof v>) => maj({ concours: { ...v, ...patch } })
  const changerEtape = (etape: EtapeConcours) =>
    maj({
      concours: { ...v, etape },
      statut: statutPourEtapeConcours(etape),
      dernierMouvement: todayISO(),
    })
  const idx = ETAPES_CONCOURS.findIndex((e) => e.id === v.etape)

  return (
    <Card titre="Parcours concours">
      <p className="small muted" style={{ marginTop: 0, marginBottom: 8 }}>
        Le concours suit ses propres étapes — candidature, sélection, projet, jury — sans
        détourner les statuts d'un appel d'offres. Changer d'étape met le pipeline à jour tout
        seul.
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {ETAPES_CONCOURS.map((e, i) => (
          <button
            key={e.id}
            type="button"
            className={`badge ${e.id === v.etape ? 'badge-info' : i < idx ? 'badge-ok' : 'badge-muted'}`}
            style={{ cursor: 'pointer', border: 'none' }}
            title={e.aide}
            onClick={() => changerEtape(e.id)}
          >
            {i + 1}. {e.label}
          </button>
        ))}
      </div>
      <div className="form-row">
        <Field label="Prime (indemnité concurrent)" hint="Versée aux non-lauréats admis à concourir — à lire au règlement.">
          <NumInput value={v.prime ?? null} onChange={(x) => majConcours({ prime: x })} />
        </Field>
        <Field label="Nombre de candidats admis">
          <NumInput value={v.nbCandidats ?? null} onChange={(x) => majConcours({ nbCandidats: x })} />
        </Field>
        <Field label="Date du jury">
          <DateInput value={v.dateJury ?? null} onChange={(x) => majConcours({ dateJury: x })} />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <Field label="Remise des candidatures (phase 1)">
          <DateInput value={v.dateCandidature ?? null} onChange={(x) => majConcours({ dateCandidature: x })} />
        </Field>
        <Field label="Anonymat du rendu">
          <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 34 }}>
            <input
              type="checkbox"
              checked={Boolean(v.anonymat)}
              onChange={(e) => majConcours({ anonymat: e.target.checked })}
            />
            rendu anonyme (aucun signe distinctif)
          </label>
        </Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Livrables demandés" hint="Planches, notice, maquette… — recopiés du règlement, jamais devinés.">
          <TextArea rows={2} value={v.livrables || ''} onChange={(x) => majConcours({ livrables: x })} />
        </Field>
      </div>
    </Card>
  )
}

// ---------- checklist dynamique (Lot 3) ----------

const STATUT_SUIVANT: Record<ExigenceDossier['statut'], ExigenceDossier['statut']> = {
  a_faire: 'fait',
  en_cours: 'fait',
  fait: 'a_faire',
  sans_objet: 'a_faire',
}

function CarteChecklist({ c, maj }: { c: Consultation; maj: (p: Partial<Consultation>) => void }) {
  const { state } = useStore()
  const [rcOuvert, setRcOuvert] = useState(false)
  const [texteRC, setTexteRC] = useState('')
  const [extraction, setExtraction] = useState<ExtractionRC | null>(null)
  const [analyseEnCours, setAnalyseEnCours] = useState(false)
  const refFichierRC = useRef<HTMLInputElement>(null)
  const [retenues, setRetenues] = useState<Set<string>>(new Set())
  const [ajouts, setAjouts] = useState<Record<string, string>>({})
  const exigences = c.exigences || []

  const genererBase = () => {
    const base = checklistDeBase(c)
    maj({ exigences: [...exigences, ...base] })
    toast(`${base.length} éléments ajoutés (base agence — ${c.typeAvis === 'concours' ? 'concours' : 'appel d’offres'}).`)
  }

  /** 0 ter D : le RC arrive en FICHIER (ou dans le ZIP du DCE téléchargé
   *  par le serveur) — il est identifié par son nom, son texte est extrait
   *  (pdf.js/docx déjà embarqués) et alimente le MÊME flux de propositions
   *  que le collage manuel. Rien n'est deviné : l'humain accepte toujours. */
  const analyserFichierRC = async (fichier: File) => {
    setAnalyseEnCours(true)
    try {
      let cible: File = fichier
      if (/\.zip$/i.test(fichier.name)) {
        const entrees = unzipSync(new Uint8Array(await fichier.arrayBuffer()))
        const noms = Object.keys(entrees).filter((n) => !n.endsWith('/') && /\.(pdf|docx?|txt)$/i.test(n))
        // le RC s'identifie par son nom : « RC », « règlement de (la) consultation/concours »
        const nomRc = noms.find(
          (n) => /(^|[\/_\-. ])rc([\/_\-. ])/i.test(n) || /r[eè]glement/i.test(n),
        )
        if (!nomRc) {
          toast(`RC introuvable dans le ZIP (${noms.length} document(s)) — ouvrez le fichier du règlement directement.`, { tone: 'warn' })
          return
        }
        const nomCourt = nomRc.split('/').pop() || nomRc
        cible = new File([entrees[nomRc].slice().buffer as ArrayBuffer], nomCourt, {
          type: /\.pdf$/i.test(nomCourt) ? 'application/pdf' : '',
        })
        toast(`RC identifié dans le DCE : ${nomCourt}`)
      }
      const texte = await extraireTexteFichier(cible)
      if (!texte.trim()) {
        toast('Aucun texte lisible dans ce fichier (scan ? protégé ?).', { tone: 'warn' })
        return
      }
      setTexteRC(texte)
      setRcOuvert(true)
      const r = extraireExigencesRC(texte)
      setExtraction(r)
      setRetenues(new Set(r.exigences.map((e) => e.id)))
      if (r.exigences.length === 0 && r.criteres.length === 0) {
        toast('Rien d’extractible avec certitude dans ce RC — ajoutez les exigences à la main.', { tone: 'warn' })
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Analyse du fichier impossible.', { tone: 'danger' })
    } finally {
      setAnalyseEnCours(false)
    }
  }

  const analyserRC = () => {
    const r = extraireExigencesRC(texteRC)
    setExtraction(r)
    setRetenues(new Set(r.exigences.map((e) => e.id)))
    if (r.exigences.length === 0 && r.criteres.length === 0 && r.reperes.length === 0) {
      toast('Rien d’extractible avec certitude — ajoutez les exigences à la main.', { tone: 'warn' })
    }
  }

  const ajouterExtraction = () => {
    if (!extraction) return
    // pas de doublon : une exigence déjà présente (même texte normalisé) est ignorée
    const dejaLa = new Set(exigences.map((e) => fold(e.texte)))
    const nouvelles = extraction.exigences.filter((e) => retenues.has(e.id) && !dejaLa.has(fold(e.texte)))
    maj({ exigences: [...exigences, ...nouvelles] })
    setExtraction(null)
    setTexteRC('')
    setRcOuvert(false)
    toast(`${nouvelles.length} exigence(s) ajoutée(s) depuis le RC — chacune garde sa ligne d’origine.`)
  }

  const majExigence = (id: string, patch: Partial<ExigenceDossier>) => {
    maj({ exigences: exigences.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  }
  const retirer = (id: string) => maj({ exigences: exigences.filter((e) => e.id !== id) })
  const ajouterManuelle = (categorie: CategorieExigence) => {
    const texte = (ajouts[categorie] || '').trim()
    if (!texte) return
    maj({
      exigences: [
        ...exigences,
        { id: uid('exi'), categorie, texte, source: 'manuel', obligatoire: false, statut: 'a_faire' },
      ],
    })
    setAjouts((prev) => ({ ...prev, [categorie]: '' }))
  }

  const documentsOptions = [
    { value: '', label: '— document lié —' },
    ...state.registreDocuments
      .filter((d) => d.statut !== 'remplace' && d.statut !== 'rejete')
      .map((d) => ({ value: d.id, label: `${d.categorie} · ${d.titre.slice(0, 40)}` })),
  ]

  return (
    <Card titre="Checklist du dossier">
      <p className="small muted" style={{ marginTop: 0, marginBottom: 8 }}>
        Pas de liste générique : la base agence + les exigences <strong>extraites du RC</strong>,
        chacune avec sa source. Une exigence obligatoire non faite bloque « prêt à déposer ».
      </p>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <Btn small onClick={genererBase}>
          {exigences.length === 0 ? 'Générer la checklist de base' : 'Ajouter la base du parcours en cours'}
        </Btn>
        <Btn small kind={rcOuvert ? 'ghost' : 'default'} onClick={() => setRcOuvert(!rcOuvert)}>
          {rcOuvert ? 'Fermer l’extraction RC' : 'Coller le RC → extraire les exigences'}
        </Btn>
        <Btn
          small
          onClick={() => refFichierRC.current?.click()}
          disabled={analyseEnCours}
          title="Ouvre le RC (PDF/DOCX/TXT) ou le ZIP du DCE : le règlement y est identifié tout seul et ses exigences sont proposées."
        >
          {analyseEnCours ? 'Analyse…' : 'Analyser le RC (fichier ou DCE .zip)'}
        </Btn>
        <input
          ref={refFichierRC}
          type="file"
          accept=".pdf,.docx,.doc,.txt,.zip"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void analyserFichierRC(f)
          }}
        />
      </div>

      {rcOuvert && (
        <div className="card" style={{ padding: 12, marginBottom: 12, background: 'var(--bg-soft, #f6f7fa)' }}>
          <Field
            label="Texte du règlement de consultation"
            hint="Collez le texte (copié du PDF). L’extraction est déterministe et conservatrice : elle ne propose que des lignes explicites, à accepter une par une."
          >
            <TextArea rows={6} value={texteRC} onChange={setTexteRC} placeholder="4.1 Pièces de la candidature : DC1, DC2…" />
          </Field>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <Btn small kind="primary" onClick={analyserRC} disabled={!texteRC.trim()}>
              Analyser le texte
            </Btn>
            {extraction && (
              <span className="muted small">
                {extraction.lignesLues} lignes lues → {extraction.exigences.length} exigence(s) proposée(s)
              </span>
            )}
          </div>
          {extraction && extraction.exigences.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {extraction.exigences.map((e) => (
                <label key={e.id} className="small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={retenues.has(e.id)}
                    onChange={(ev) => {
                      const s = new Set(retenues)
                      if (ev.target.checked) s.add(e.id)
                      else s.delete(e.id)
                      setRetenues(s)
                    }}
                  />
                  <span>
                    {e.texte}{' '}
                    <Badge tone="muted">{CATEGORIES_EXIGENCE.find((cat) => cat.id === e.categorie)?.label}</Badge>{' '}
                    {e.obligatoire && <Badge tone="warn">obligatoire</Badge>}
                  </span>
                </label>
              ))}
              <Btn small kind="primary" onClick={ajouterExtraction} disabled={retenues.size === 0}>
                Ajouter les {retenues.size} exigence(s) retenue(s)
              </Btn>
            </div>
          )}
          {extraction && extraction.criteres.length > 0 && (
            <p className="small" style={{ marginTop: 10, marginBottom: 0 }}>
              Critères de jugement repérés :{' '}
              {extraction.criteres.map((cr, i) => (
                <span key={i} className="badge badge-info" style={{ marginRight: 4 }}>
                  {cr.libelle} — {cr.poids} %
                </span>
              ))}
              <span className="muted"> (à reporter dans l’avis Go/No-Go)</span>
            </p>
          )}
          {extraction && extraction.reperes.length > 0 && (
            <p className="small muted" style={{ marginTop: 6, marginBottom: 0 }}>
              Repères de calendrier : {extraction.reperes.join(' · ')}
            </p>
          )}
        </div>
      )}

      {exigences.length === 0 ? (
        <EmptyState>Checklist vide — générez la base puis complétez-la depuis le RC.</EmptyState>
      ) : (
        CATEGORIES_EXIGENCE.map((cat) => {
          const items = exigences.filter((e) => e.categorie === cat.id)
          return (
            <div key={cat.id} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                {cat.label}{' '}
                <span className="muted small">
                  {items.filter((e) => e.statut === 'fait').length}/{items.filter((e) => e.statut !== 'sans_objet').length || 0}
                </span>
              </div>
              {items.map((e) => (
                <div
                  key={e.id}
                  className="small"
                  style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0', opacity: e.statut === 'sans_objet' ? 0.5 : 1 }}
                >
                  <input
                    type="checkbox"
                    checked={e.statut === 'fait'}
                    disabled={e.statut === 'sans_objet'}
                    onChange={() => majExigence(e.id, { statut: STATUT_SUIVANT[e.statut] })}
                    aria-label={`Fait : ${e.texte}`}
                  />
                  <span
                    title={`Source : ${e.source}`}
                    style={{ flex: '1 1 240px', textDecoration: e.statut === 'fait' ? 'line-through' : undefined }}
                  >
                    {e.texte}
                    {e.obligatoire && (
                      <>
                        {' '}
                        <Badge tone={e.statut === 'fait' ? 'ok' : 'warn'}>obligatoire</Badge>
                      </>
                    )}
                    {e.source !== 'base agence' && e.source !== 'manuel' && (
                      <>
                        {' '}
                        <Badge tone="info">RC</Badge>
                      </>
                    )}
                  </span>
                  <Select
                    value={e.documentId || ''}
                    onChange={(v) => majExigence(e.id, { documentId: v || null })}
                    options={documentsOptions}
                    style={{ maxWidth: 210, fontSize: 12 }}
                  />
                  <Btn
                    small
                    kind="ghost"
                    title="Basculer « sans objet » (l'élément ne compte plus dans la complétude)"
                    onClick={() => majExigence(e.id, { statut: e.statut === 'sans_objet' ? 'a_faire' : 'sans_objet' })}
                  >
                    {e.statut === 'sans_objet' ? 'réactiver' : 'sans objet'}
                  </Btn>
                  <Btn small kind="ghost" title="Retirer l'exigence" onClick={() => retirer(e.id)}>
                    ✕
                  </Btn>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <TextInput
                  value={ajouts[cat.id] || ''}
                  onChange={(v) => setAjouts((prev) => ({ ...prev, [cat.id]: v }))}
                  placeholder={`Ajouter à « ${cat.label} »…`}
                  style={{ maxWidth: 340, fontSize: 12 }}
                />
                <Btn small onClick={() => ajouterManuelle(cat.id)} disabled={!(ajouts[cat.id] || '').trim()}>
                  Ajouter
                </Btn>
              </div>
            </div>
          )
        })
      )}
    </Card>
  )
}

// ---------- documents du dossier (registre) ----------

function CarteDocumentsDossier({ c, today }: { c: Consultation; today: string }) {
  const { state, update } = useStore()
  const [aRattacher, setARattacher] = useState('')
  const lies = state.registreDocuments.filter((d) => d.consultationId === c.id)
  const reutilisables = useMemo(() => piecesAdminReutilisables(state, today), [state, today])

  const rattacher = (docId: string) => {
    if (!docId) return
    update((d) => {
      const doc = d.registreDocuments.find((x) => x.id === docId)
      if (!doc) return
      doc.consultationId = c.id
      doc.evenements.push({ date: todayISO(), type: 'action', detail: `Rattaché au dossier « ${c.intitule} »` })
    })
    setARattacher('')
    toast('Document rattaché au dossier.')
  }

  const detacher = (docId: string) =>
    update((d) => {
      const doc = d.registreDocuments.find((x) => x.id === docId)
      if (doc) doc.consultationId = null
    })

  const candidats = state.registreDocuments.filter(
    (d) => d.consultationId !== c.id && d.statut !== 'remplace' && d.statut !== 'rejete',
  )

  return (
    <Card titre="Documents du dossier">
      <p className="small muted" style={{ marginTop: 0, marginBottom: 8 }}>
        Le registre documentaire reste la seule source : un DCE reçu par mail ou déposé dans
        « Documents » se rattache ici.{' '}
        {c.sourceUrl ? (
          <a href={c.sourceUrl} target="_blank" rel="noreferrer">
            Retirer le DCE sur la plateforme ↗
          </a>
        ) : (
          <span>Renseignez le lien de l’avis pour retrouver la plateforme de retrait.</span>
        )}
      </p>
      {lies.length === 0 ? (
        <EmptyState>Aucun document rattaché pour l’instant.</EmptyState>
      ) : (
        lies.map((d) => <LigneDocument key={d.id} d={d} onDetacher={() => detacher(d.id)} />)
      )}
      <div className="toolbar" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <Select
          value={aRattacher}
          onChange={setARattacher}
          options={[
            { value: '', label: '— rattacher un document du registre —' },
            ...candidats.map((d) => ({ value: d.id, label: `${d.categorie} · ${d.titre.slice(0, 48)}` })),
          ]}
          style={{ maxWidth: 340 }}
        />
        <Btn small onClick={() => rattacher(aRattacher)} disabled={!aRattacher}>
          Rattacher
        </Btn>
      </div>
      {reutilisables.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="small" style={{ cursor: 'pointer' }}>
            Pièces administratives réutilisables ({reutilisables.length}) — DC1/DC2, assurances, attestations
          </summary>
          <div style={{ marginTop: 6 }}>
            {reutilisables.map(({ document: d, ageJours, aVerifier }) => (
              <div key={d.id} className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                <span style={{ flex: 1 }}>{d.titre}</span>
                <Badge tone={aVerifier ? 'warn' : 'ok'}>
                  {aVerifier ? `${Math.round(ageJours / 30)} mois — à re-vérifier` : `${ageJours} j`}
                </Badge>
                {d.consultationId === c.id ? (
                  <Badge tone="ok">rattachée</Badge>
                ) : (
                  <Btn small kind="ghost" onClick={() => rattacher(d.id)}>
                    Rattacher
                  </Btn>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  )
}

function LigneDocument({ d, onDetacher }: { d: DocumentRecord; onDetacher: () => void }) {
  return (
    <div className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
      <Badge tone="muted">{d.categorie}</Badge>
      <span style={{ flex: 1 }}>{d.titre}</span>
      <span className="muted">reçu le {d.recuLe.slice(0, 10)}</span>
      <Btn small kind="ghost" title="Détacher du dossier" onClick={onDetacher}>
        ✕
      </Btn>
    </div>
  )
}

// ---------- temps pointé sur le dossier (Lot 4 : coût réel) ----------

function CarteTempsDossier({ c }: { c: Consultation }) {
  const { state, update } = useStore()
  const today = useToday()
  const [personne, setPersonne] = useState(state.settings.personnes[0] || '')
  const [heures, setHeures] = useState<number | null>(null)
  const cout = coutDossier(state, c.id)
  const entrees = state.tempsHorsProjet.filter((t) => t.consultationId === c.id)

  const pointer = () => {
    if (!personne || !heures || heures <= 0) return
    const entree = {
      id: uid('thp'),
      semaine: mondayOf(today),
      personne,
      categorie: 'Prospection / AO',
      heures,
      consultationId: c.id,
    }
    update((d) => {
      d.tempsHorsProjet.push(structuredClone(entree))
    })
    setHeures(null)
    toast(`${heures} h pointées sur le dossier (Prospection / AO, semaine du ${mondayOf(today)}).`)
  }

  return (
    <Card titre="Temps passé sur ce dossier">
      <p className="small muted" style={{ marginTop: 0, marginBottom: 8 }}>
        Pointé en « Prospection / AO » et rattaché au dossier : c’est le coût réel de la
        réponse, la base du bilan gagné/perdu.
      </p>
      <dl className="kv">
        <dt>Heures pointées</dt>
        <dd>{fmtHeures(cout.heures)}</dd>
        <dt>Coût (au coût horaire réel)</dt>
        <dd>
          <Money v={cout.cout} />
        </dd>
      </dl>
      <div className="toolbar" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <Select
          value={personne}
          onChange={setPersonne}
          options={state.settings.personnes.map((p) => ({ value: p, label: p }))}
          style={{ maxWidth: 130 }}
        />
        <NumInput value={heures} onChange={setHeures} placeholder="heures" ariaLabel="Heures à pointer" style={{ maxWidth: 90 }} />
        <Btn small kind="primary" onClick={pointer} disabled={!heures || heures <= 0}>
          Pointer cette semaine
        </Btn>
      </div>
      {entrees.length > 0 && (
        <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
          {entrees.length} pointage(s) — visibles aussi dans « Temps » (activités hors projet).
        </p>
      )}
    </Card>
  )
}

// ---------- valeur attendue transparente (Lot 4) ----------

function CarteValeurDossier({ c }: { c: Consultation }) {
  const { state, update } = useStore()
  const proba = probaConsultation(c)
  const va = valeurAttendue(state, c, proba)

  const majHonoraires = (v: number | null) =>
    update((d) => {
      const x = d.consultations.find((y) => y.id === c.id)
      if (x) x.honorairesEstimes = v
    })

  return (
    <Card titre="Valeur attendue">
      <p className="small muted" style={{ marginTop: 0, marginBottom: 8 }}>
        Chaque terme est affiché — pas de formule cachée. La probabilité vient de l’étape du
        pipeline (ou de votre saisie sur la fiche).
      </p>
      <Field label="Honoraires estimés si gagné (HT)" hint="Votre estimation — jamais déduite automatiquement du budget.">
        <NumInput value={c.honorairesEstimes ?? null} onChange={majHonoraires} />
      </Field>
      <dl className="kv" style={{ marginTop: 10 }}>
        {va.lignes.map((l, i) => (
          <SafeLigne key={i} libelle={l.libelle} valeur={l.valeur} />
        ))}
        <dt style={{ fontWeight: 700 }}>Solde pondéré</dt>
        <dd style={{ fontWeight: 700 }}>{va.solde === null ? <span className="muted">renseignez les honoraires</span> : <Money v={va.solde} />}</dd>
      </dl>
    </Card>
  )
}

function SafeLigne({ libelle, valeur }: { libelle: string; valeur: number | null }) {
  return (
    <>
      <dt>{libelle}</dt>
      <dd>{valeur === null ? <span className="muted">non renseigné</span> : <Money v={valeur} />}</dd>
    </>
  )
}

// ---------- contrôle avant dépôt (la porte) ----------

function CarteDepot({
  controle,
  labelDepot,
  onDeposer,
}: {
  controle: { pret: boolean; bloquants: string[]; avertissements: string[] }
  labelDepot: string | null
  onDeposer: () => void
}) {
  return (
    <Card titre="Contrôle avant dépôt">
      {controle.bloquants.length === 0 ? (
        <p className="small ok-text" style={{ marginTop: 0 }}>✓ Aucun point bloquant — le dossier peut être déposé.</p>
      ) : (
        <ul className="small" style={{ marginTop: 0, paddingLeft: 18 }}>
          {controle.bloquants.map((b, i) => (
            <li key={i} className="danger-text">
              {b}
            </li>
          ))}
        </ul>
      )}
      {controle.avertissements.length > 0 && (
        <ul className="small" style={{ paddingLeft: 18 }}>
          {controle.avertissements.map((a, i) => (
            <li key={i} className="muted">
              ⚠ {a}
            </li>
          ))}
        </ul>
      )}
      {labelDepot && (
        <Btn
          kind="primary"
          onClick={onDeposer}
          disabled={!controle.pret}
          title={controle.pret ? undefined : `Bloqué : ${controle.bloquants[0] || ''}`}
        >
          {labelDepot}
        </Btn>
      )}
      {!labelDepot && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          Dossier déposé — le résultat (sélection, classement, motifs) se saisit sur la fiche
          consultation ou via les étapes du concours ci-dessus.
        </p>
      )}
    </Card>
  )
}
