// Paramètres & données — réglages de l'agence, trésorerie,
// import mensuel des totaux de l'Excel maître (source de vérité
// financière la première année), sauvegarde/restauration JSON.

import { useRef, useState } from 'react'
import type { AppState, TypeMO } from '../types'
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
  Table,
  TextInput,
  useToday,
} from '../ui'
import { download, fmtDate, fmtMoney, fold, todayISO } from '../util'

const TYPES_MO: TypeMO[] = ['Public', 'Privé pro', 'Particulier']

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
          <Field label="Coût horaire de revient (€)">
            <NumInput value={s.coutHoraireRevient} onChange={(v) => maj((d) => void (d.settings.coutHoraireRevient = v ?? 0))} />
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
