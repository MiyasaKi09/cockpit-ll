// 5.20 — la FICHE ENTREPRISE transverse : « où en est-on avec HORIZONS ? »
// en UNE modale au lieu de six écrans. Tout vient de l'agrégat pur
// syntheseEntreprise (src/entreprise.ts), qui réutilise les autorités
// existantes (RG 5.1, pénalités 5.2/5.3, visas 5.8, GPA 5.9, certificat
// 5.19) — rien n'est recalculé ici.
//
// FICHE EN LECTURE, par construction : ce composant n'appelle JAMAIS la
// fonction d'écriture du store — un doublon d'écriture ferait deux vérités,
// exactement la complexification que l'agence refuse. Les seuls gestes sont la
// NAVIGATION (liens vers l'écran où l'on agit : chantier du projet,
// situations, retenues) et le BROUILLON de relance (ouvrirGmail →
// gmailComposeUrl, l'envoi reste un clic humain, §15).
// scripts/test-entreprise.cjs verrouille cette lecture seule.

import { useStore } from '../store'
import { Badge, BtnLien, EmptyState, Modal, Money, Stat, Table, useToday } from '../ui'
import { fmtDate, fmtMois, fmtMoney, ouvrirGmail } from '../util'
import { LIBELLE_GARANTIE } from '../derive'
import { LIBELLE_STATUT_VISA, echeanceVisa } from '../visas'
import { LIBELLE_STATUT_DESORDRE } from '../gpa'
import {
  corpsRelanceSituation,
  sujetRelanceSituation,
  syntheseEntreprise,
} from '../entreprise'
import type { StatutRG } from '../derive'

const LIBELLE_RG_COURT: Record<StatutRG, { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted' }> = {
  en_cours: { label: 'chantier en cours', tone: 'muted' },
  retenue: { label: 'retenue', tone: 'info' },
  a_liberer: { label: 'à libérer', tone: 'danger' },
  liberee: { label: 'libérée', tone: 'ok' },
}

/** lien vers l'onglet Chantier du projet — c'est LÀ que l'on agit sur les
 *  marchés, pénalités, visas et désordres GPA de ce projet */
function LienChantier({ projetId, children }: { projetId: string; children?: string }) {
  return (
    <a href={`#/projets/${projetId}/chantier`} title={`Ouvrir l'onglet Chantier de ${projetId} — c'est là que l'on agit`}>
      {children || projetId}
    </a>
  )
}

export default function FicheEntreprise({
  nomOuId,
  onClose,
}: {
  nomOuId: string
  onClose: () => void
}) {
  const { state } = useStore()
  const today = useToday()
  const syn = syntheseEntreprise(state, nomOuId, today)
  const actifs = syn.marches.filter((l) => l.marche.actif).length
  const nomAgence = state.settings.nomAgence

  const relancer = (marcheId: string, mois: string) => {
    const m = syn.marches.find((l) => l.marche.id === marcheId)?.marche
    if (!m) return
    ouvrirGmail(
      m.contactEmail || syn.contactEmail || '',
      sujetRelanceSituation(m, mois),
      corpsRelanceSituation(m, mois, nomAgence),
    )
  }

  return (
    <Modal titre={`Entreprise — ${syn.nom}`} onClose={onClose} large>
      <p className="small muted" style={{ marginTop: 0 }}>
        {syn.contactNom || syn.contactEmail ? (
          <>
            Contact : {syn.contactNom || '—'}
            {syn.contactEmail && (
              <>
                {' · '}
                <BtnLien
                  title="Ouvre un brouillon Gmail — l'envoi reste votre clic"
                  onClick={() => ouvrirGmail(syn.contactEmail || '', '', '')}
                >
                  {syn.contactEmail}
                </BtnLien>
              </>
            )}
            {' — '}
          </>
        ) : null}
        fiche en <strong>lecture</strong> : chaque ligne renvoie vers l’écran où l’on agit.
      </p>

      {syn.marches.length === 0 ? (
        <EmptyState>
          Aucun marché rattaché à cette entreprise — la fiche se remplit toute seule dès qu'un
          marché la nomme (fiche projet, carte « Marchés de travaux »).
        </EmptyState>
      ) : (
        <>
          <div className="grid4" style={{ marginBottom: 12 }}>
            <Stat label="Marchés actifs" value={`${actifs} / ${syn.marches.length}`} sub="tous projets confondus" />
            <Stat
              label="RG retenue"
              value={<Money v={syn.totaux.rgRetenueHT} />}
              sub={<>sur <Money v={syn.totaux.montantMarchesHT} /> HT de marchés</>}
            />
            <Stat
              label="À libérer"
              value={<Money v={syn.totaux.aLibererHT} />}
              tone={syn.totaux.aLibererHT > 0 ? 'danger' : undefined}
              sub={
                syn.totaux.aLibererHT > 0 ? (
                  <a href="#/situations" title="Onglet Retenues de garantie — c'est là que la levée se constate">GPA échue — lever la RG →</a>
                ) : (
                  'rien d’échu'
                )
              }
            />
            <Stat
              label="Situation du mois"
              value={syn.situationsAttendues.length === 0 ? '✓' : syn.situationsAttendues.length}
              tone={syn.situationsAttendues.length > 0 ? 'warn' : 'ok'}
              sub={syn.situationsAttendues.length === 0 ? 'rien en attente' : 'attendue(s) non reçue(s)'}
            />
          </div>

          {syn.situationsAttendues.map(({ marche: m, mois, gravite }) => (
            <p key={m.id} className="pill-note" style={{ marginTop: 0 }}>
              <Badge tone={gravite === 3 ? 'danger' : 'warn'}>
                situation de {fmtMois(mois)} non reçue
              </Badge>{' '}
              {m.lot} ({m.projetId}) —{' '}
              <BtnLien
                title="Ouvre un brouillon Gmail pré-rempli — même relance que l'onglet Situations, l'envoi reste votre clic"
                onClick={() => relancer(m.id, mois)}
              >
                relancer
              </BtnLien>
            </p>
          ))}

          <h3 className="small" style={{ margin: '10px 0 6px' }}>Marchés — tous projets</h3>
          <Table
            compact
            head={[
              'Projet',
              'Lot',
              <span key="m" className="right">Montant HT</span>,
              'RG',
              'Dernier certificat',
              'Situation du mois',
            ]}
          >
            {syn.marches.map(({ marche: m, projet, rg, dernierCertificat, situationDuMoisRecue }) => (
              <tr key={m.id}>
                <td>
                  <LienChantier projetId={m.projetId} />
                  {projet && <div className="muted small">{projet.nom}</div>}
                </td>
                <td>
                  {m.lot}
                  {m.actif ? (
                    <>
                      {' '}
                      <Badge tone="ok">en cours</Badge>
                    </>
                  ) : null}
                </td>
                <td className="right">
                  <Money v={m.montantInitialHT + m.avenantsHT} />
                </td>
                <td>
                  {rg.garantie !== 'retenue' ? (
                    <span className="muted small" title={`RG 0 % — ${LIBELLE_GARANTIE[rg.garantie]} fournie`}>
                      {rg.garantie === 'caution' ? 'caution' : 'GPD'}
                    </span>
                  ) : (
                    <>
                      <Money v={rg.retenueHT} />{' '}
                      <Badge tone={LIBELLE_RG_COURT[rg.statut].tone}>{LIBELLE_RG_COURT[rg.statut].label}</Badge>
                    </>
                  )}
                </td>
                <td className="small">
                  {dernierCertificat ? (
                    <a href="#/situations" title="Historique des situations — réimpression du certificat figé">
                      n° {dernierCertificat.numero} · {fmtMois(dernierCertificat.mois)} ·{' '}
                      {fmtMoney(dernierCertificat.netAPayerTTC, true)} TTC
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {situationDuMoisRecue === null ? (
                    <span className="muted">—</span>
                  ) : situationDuMoisRecue ? (
                    <Badge tone="ok">reçue ✓</Badge>
                  ) : (
                    <a href="#/situations" title="Onglet Attendues — relance et suivi">
                      <Badge tone="warn">non reçue</Badge>
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </Table>

          {syn.penalitesEncourues.length > 0 && (
            <>
              <h3 className="small" style={{ margin: '14px 0 6px' }}>Pénalités</h3>
              <Table
                compact
                head={[
                  'Marché',
                  <span key="e" className="right">Encouru HT</span>,
                  <span key="a" className="right">Appliqué HT</span>,
                  '',
                ]}
              >
                {syn.penalitesEncourues.map(({ marche: m, encouruHT, appliqueHT }) => (
                  <tr key={m.id}>
                    <td>
                      {m.lot} <span className="muted small">({m.projetId})</span>
                    </td>
                    <td className="right">{fmtMoney(encouruHT, true)}</td>
                    <td className="right">{fmtMoney(appliqueHT, true)}</td>
                    <td className="right small">
                      <LienChantier projetId={m.projetId}>décider →</LienChantier>
                    </td>
                  </tr>
                ))}
              </Table>
            </>
          )}

          {syn.desordresGPAOuverts.length > 0 && (
            <>
              <h3 className="small" style={{ margin: '14px 0 6px' }}>Désordres GPA ouverts</h3>
              <Table compact head={['Projet', 'Désordre', 'Signalé le', 'Statut', '']}>
                {syn.desordresGPAOuverts.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <LienChantier projetId={d.projetId} />
                    </td>
                    <td>{d.description}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(d.signaleLe)}</td>
                    <td>
                      <Badge tone={d.statut === 'conteste' ? 'danger' : 'warn'}>
                        {LIBELLE_STATUT_DESORDRE[d.statut]}
                      </Badge>
                    </td>
                    <td className="right small">
                      <LienChantier projetId={d.projetId}>relancer / lever →</LienChantier>
                    </td>
                  </tr>
                ))}
              </Table>
            </>
          )}

          {syn.visasEnAttente.length > 0 && (
            <>
              <h3 className="small" style={{ margin: '14px 0 6px' }}>Visas en attente</h3>
              <Table compact head={['Projet', 'Document', 'Reçu le', 'Échéance CCAP', '']}>
                {syn.visasEnAttente.map((v) => {
                  const echeance = echeanceVisa(v)
                  return (
                    <tr key={v.id}>
                      <td>
                        <LienChantier projetId={v.projetId} />
                      </td>
                      <td>
                        {v.document} <span className="muted small">({LIBELLE_STATUT_VISA[v.statut]})</span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(v.recuLe)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {echeance ? (
                          echeance < today ? (
                            <Badge tone="danger">dépassée ({fmtDate(echeance)})</Badge>
                          ) : (
                            fmtDate(echeance)
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="right small">
                        <LienChantier projetId={v.projetId}>viser →</LienChantier>
                      </td>
                    </tr>
                  )
                })}
              </Table>
            </>
          )}
        </>
      )}
    </Modal>
  )
}
