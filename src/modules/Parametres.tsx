// Paramètres & données — réglages de l'agence, trésorerie,
// import mensuel des totaux de l'Excel maître (source de vérité
// financière la première année), sauvegarde/restauration JSON.

import { useRef, useState } from 'react'
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
  NumInput,
  Page,
  Select,
  Table,
  TextInput,
  useToday,
} from '../ui'
import { download, fmtDate, fmtMoney, fmtPct, fold, todayISO, uid } from '../util'
import { coefSuggere, coutAgenceAnnuel, coutAnnuelPersonne, coutHorairePersonne, coutHoraireMoyen, coutJourObjectif } from '../derive'
import { connecterGoogle, deconnecter, estConnecte } from '../google'

const TYPES_MO: TypeMO[] = ['Public', 'Privé pro', 'Particulier']

/** L'équipe avec rémunérations réelles : le coût horaire de chacun
 *  se calcule tout seul — plus de forfait approximatif. */
function CarteEquipe() {
  const { state, update } = useStore()
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

  const retirer = (id: string) => {
    const p = eq.find((x) => x.id === id)
    if (!p) return
    if (!confirm(`Retirer ${p.nom} de l'équipe ? (ses heures pointées restent, valorisées au coût moyen)`)) return
    update((d) => {
      d.settings.equipe = d.settings.equipe.filter((x) => x.id !== id)
      d.settings.personnes = d.settings.equipe.map((x) => x.nom)
    })
  }

  return (
    <Card titre="Équipe & coûts réels — le cœur du calcul de marge">
      <p className="small muted" style={{ marginBottom: 10 }}>
        Chaque heure pointée est valorisée au coût réel de la personne (rémunération chargée ÷ heures
        annuelles). La marge d'un projet et l'<a href="#/analyse">Analyse €/jour</a> reposent sur ces
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
            <td className="right"><NumInput value={p.facturablePct} onChange={(v) => majPersonne(p.id, 'facturablePct', v)} style={{ width: 60 }} /></td>
            <td className="right num"><strong>{fmtMoney(coutHorairePersonne(p), true)}</strong></td>
            <td className="right num">{fmtMoney(coutAnnuelPersonne(p))}</td>
            <td className="right"><Btn small kind="danger" onClick={() => retirer(p.id)}>✕</Btn></td>
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
        <dd><strong>{fmtMoney(coutJourObjectif(state))}</strong> <span className="muted small">— l'objectif de l'Analyse €/jour</span></dd>
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
    <Card titre="Surveillance en direct — Gmail & Agenda (API Google gratuites)">
      <p className="small muted" style={{ marginBottom: 10 }}>
        Onglet ouvert, le Cockpit interroge Gmail et Google Agenda toutes les ~60 secondes en lecture
        seule : chaque nouveau mail vers l’adresse surveillée arrive dans « À traiter », les prochains
        événements s’affichent sur le Cockpit. Complète la routine du matin (qui, elle, trie et résume).
        Le jeton reste dans le navigateur — rien ne transite ailleurs, et les quotas gratuits de Google
        sont sans commune mesure avec l’usage d’une agence de deux personnes.
      </p>
      <div className="form-row">
        <Field label="Adresse surveillée" hint="vide = toute la boîte de réception du compte connecté">
          <TextInput value={sv.email} onChange={(v) => majSv('email', v)} placeholder="situations@agence-ll.fr" />
        </Field>
        <Field label="Client ID Google (OAuth)" hint="création gratuite en ~5 min, guide ci-dessous">
          <TextInput value={sv.clientId} onChange={(v) => majSv('clientId', v)} placeholder="1234…apps.googleusercontent.com" />
        </Field>
      </div>
      <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
        {estConnecte() ? (
          <>
            <Badge tone="ok">connecté — surveillance active</Badge>
            <Btn small onClick={() => { deconnecter(); forcer((x) => x + 1) }}>Déconnecter</Btn>
          </>
        ) : (
          <Btn kind="primary" onClick={connecter}>Connecter Google</Btn>
        )}
        {message && <span className="small">{message}</span>}
      </div>
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
    </Card>
  )
}

export default function Parametres() {
  const { state, update, replace } = useStore()
  const s = state.settings
  const today = useToday()
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
    download(`cockpit-ll-${todayISO()}.json`, JSON.stringify(state, null, 2))
  }

  const importerJSON = async (file: File) => {
    setMessageJSON('')
    try {
      const data = JSON.parse(await file.text()) as AppState
      if (typeof data !== 'object' || data === null || !Array.isArray(data.projets) || typeof data.version !== 'number')
        throw new Error('Ce fichier ne ressemble pas à une sauvegarde du Cockpit.')
      if (
        !confirm(
          `Remplacer TOUTES les données actuelles par « ${file.name} » (${data.projets.length} projets, ${data.factures?.length ?? 0} factures) ?`,
        )
      )
        return
      replace(data)
      setMessageJSON('Sauvegarde restaurée.')
    } catch (e) {
      setMessageJSON(`Échec : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const reinitialiser = () => {
    if (confirm('Réinitialiser sur les données d’exemple ? Toutes les données actuelles seront perdues (pensez à exporter avant).'))
      replace(seedState())
  }

  // ---------- snoozes ----------

  const snoozes = Object.entries(s.snoozes).filter(([, until]) => until > today)
  const titreAlerte = (id: string) =>
    computeAlertes(state, today).find((a) => a.id === id)?.titre || id

  const maj = (fn: (d: AppState) => void) => update(fn)

  return (
    <Page
      titre="Paramètres & données"
      sousTitre="Réglages de l'agence, trésorerie, Excel maître et sauvegardes. En local, les données vivent dans ce navigateur : exportez régulièrement."
    >
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
          <Field label="Équipe (virgules)">
            <TextInput
              value={s.personnes.join(', ')}
              onChange={(v) =>
                maj((d) => void (d.settings.personnes = v.split(',').map((x) => x.trim()).filter(Boolean)))
              }
            />
          </Field>
          <Field label="CA annuel cible HT (€)">
            <NumInput value={s.caCibleHT} onChange={(v) => maj((d) => void (d.settings.caCibleHT = v ?? 0))} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Taux horaire de vente (€)">
            <NumInput value={s.tauxHoraireVente} onChange={(v) => maj((d) => void (d.settings.tauxHoraireVente = v ?? 0))} />
          </Field>
          <Field label="Coût horaire de revient" hint="calculé depuis l'équipe réelle (carte ci-dessus)">
            <div className="input" style={{ background: '#f7f8fa' }}>{fmtMoney(coutHoraireMoyen(state), true)} / h</div>
          </Field>
          <Field label="Heures / jour">
            <NumInput value={s.heuresParJour} onChange={(v) => maj((d) => void (d.settings.heuresParJour = v ?? 7.8))} />
          </Field>
          <Field label="Seuil de dérive heures" hint="0,9 = alerte à 90 % du budget">
            <NumInput value={s.seuilDeriveHeures} onChange={(v) => maj((d) => void (d.settings.seuilDeriveHeures = v ?? 0.9))} />
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

      <CarteSurveillance />

      <Card titre="Données & confidentialité">
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Une seule source de vérité par donnée : la double saisie tue l'adoption.</li>
          <li>Minimisation de ce qui est collé dans Claude : pas de données personnelles inutiles.</li>
          <li>Réglages de confidentialité Claude vérifiés ; politique de rétention pour les e-mails traités.</li>
          <li>Un module inutilisé pendant un mois se coupe sans état d'âme — maintenance plafonnée à ~1 j/mois.</li>
        </ul>
      </Card>
    </Page>
  )
}
