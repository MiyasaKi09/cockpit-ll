// 5.20 → 5.21 — la FICHE ENTREPRISE : « où en est-on avec HORIZONS ? » en un
// seul endroit au lieu de six écrans. Tout ce qui est CHIFFRÉ vient de
// l'agrégat pur `syntheseEntreprise` (src/entreprise.ts), qui réutilise les
// autorités existantes (RG 5.1, pénalités 5.2/5.3, visas 5.8, GPA 5.9,
// certificat 5.19) — rien n'est recalculé ici, jamais.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI A CHANGÉ EN 5.21, ET POURQUOI — À LIRE AVANT DE TOUCHER AU TEST
// ─────────────────────────────────────────────────────────────────────────
//
// `scripts/test-entreprise.cjs` (§4) impose encore : « la fiche est en
// LECTURE : aucun appel d'écriture du store », vérifié par l'absence de
// `update(` et `replace(` dans ce fichier. CE FICHIER LES CONTIENT
// DÉSORMAIS : l'assertion est INVALIDÉE, sciemment, et il faut la réécrire
// plutôt que la supprimer.
//
// La raison d'origine était juste et TIENT TOUJOURS — mais elle porte sur
// les CALCULS, pas sur les gestes :
//
//   · un CALCUL ne peut avoir qu'une autorité. Un écran de synthèse qui
//     recalculerait la RG, une pénalité ou le net à payer d'un certificat
//     ferait DEUX VÉRITÉS pour le même marché, libres de diverger sans que
//     rien ne le signale. Cette interdiction-là est absolue et ce fichier
//     s'y tient : pas une soustraction de montant n'est écrite ici, tout
//     passe par les fonctions importées.
//
//   · un GESTE, lui, est une ÉCRITURE DE CHAMP. Deux boutons qui posent le
//     même champ à partir du même calcul ne peuvent pas produire deux
//     vérités : ils produisent la même, depuis deux endroits. Interdire le
//     second bouton n'a jamais protégé une donnée — ça a seulement forcé
//     l'agence à sauter d'onglet en onglet, ce qu'elle a fini par dire :
//     « je ne vois pas la gestion améliorée […] la gestion simplifiée des
//     situations, certificats de paiement ».
//
// L'assertion à écrire n'est donc pas « pas d'écriture » mais « pas de
// calcul » :
//   — INTERDIT ici : arithmétique sur des montants, re-dérivation d'un
//     statut de RG / d'un encouru / d'un net à payer, construction ou
//     figement d'un document contractuel (décompte, certificat) ;
//   — PERMIS ici : écrire un champ dont la valeur vient d'une autorité
//     importée, avec sa trace (date, signature) et son « Annuler ».
//
// ─────────────────────────────────────────────────────────────────────────
// LE CYCLE MENSUEL DE L'ARGENT SE FAIT ICI — SANS SECONDE IMPLÉMENTATION
// ─────────────────────────────────────────────────────────────────────────
//
// Saisir la situation reçue, puis émettre le certificat de paiement : ces
// deux gestes CONSTRUISENT des documents contractuels.
//   · `ModalEdition`   (src/modules/Situations.tsx) — fige le décompte
//     (`figerDecompte` + `empreinteDecompte`) au passage à « validée » ;
//   · `ModalCertificat`(src/modules/Situations.tsx) — numérote, construit
//     (`construireCertificat`), fige (`figerCertificat`) et avance le
//     compteur de résorption de l'avance du marché.
//
// Ils étaient enfermés dans leur écran, et la fiche ne pouvait qu'emmener
// vers eux. Ils sont désormais EXPORTÉS et montés ici tels quels. La
// distinction qui gouverne ce choix :
//   — RÉÉCRIRE l'un des deux serait la faute : deux chemins d'émission, donc
//     deux numérotations et deux papiers possibles pour le même mois, sur un
//     document qu'on remet à l'entreprise et qui déclenche un paiement ;
//   — l'OUVRIR depuis un second endroit n'en fait pas un second document. Le
//     geste reste unique ; c'est sa PORTE qui se dédouble, et c'est
//     exactement ce que l'agence demandait (« gérer AUSSI sur chaque
//     chantier », « la gestion simplifiée des situations, certificats de
//     paiement »).
//
// Ce que la fiche ne fait toujours pas elle-même : aucun montant n'y est
// calculé. Le net à payer vient de `decompteSituation`, le net certifié de
// `construireCertificat` ou du certificat FIGÉ. Elle montre, elle ouvre la
// bonne modale, et elle emmène (`#/situations/verifier/<id>`, porte lue par
// `cibleId`) quand il n'y a rien à faire d'autre que relire.
//
// ─────────────────────────────────────────────────────────────────────────
// DEUX POINTS D'ENTRÉE, LES DEUX CONSERVÉS
// ─────────────────────────────────────────────────────────────────────────
//   · `FicheEntreprise` (défaut) — la MODALE historique, ouverte depuis
//     ProjetChantier.tsx et Situations.tsx. Signature inchangée.
//   · `CorpsFicheEntreprise` — le même contenu EN PAGE, monté par
//     `#/entreprises/<id>` (src/modules/Entreprises.tsx).
// Les cartes d'action empruntées au chantier (visas, pénalités) ne se
// montent QU'EN PAGE : ce sont des composants qui ouvrent leurs propres
// modales, et une modale dans une modale se disputerait le piège à focus et
// la touche Échap (ui.tsx pose les deux sur `window`). En modale, la fiche
// propose l'adresse de la page.

import { useState } from 'react'
import { useStore } from '../store'
import { Badge, Btn, BtnLien, EmptyState, Modal, Money, Stat, Table, toast, useToday } from '../ui'
import { fmtDate, fmtMois, fmtMoney, ouvrirGmail, uid } from '../util'
import { LIBELLE_GARANTIE, decompteSituation } from '../derive'
import { LIBELLE_STATUT_VISA, echeanceVisa } from '../visas'
import { LIBELLE_STATUT_DESORDRE } from '../gpa'
import { avancementLot } from '../chantier'
import { certificatDeSituation, construireCertificat } from '../certificat'
import {
  corpsRelanceSituation,
  situationDuMois,
  sujetRelanceSituation,
  syntheseEntreprise,
} from '../entreprise'
// Les GESTES du chantier ne sont pas réécrits : ce sont les cartes de
// l'onglet Chantier, montées telles quelles. `viser un document` et
// `décider d'une pénalité` n'ont donc qu'UNE implémentation dans le dépôt,
// celle de ProjetChantier.tsx, avec ses confirmations, sa signature et son
// « Annuler ». (Import circulaire assumé : ProjetChantier importe cette
// fiche, cette fiche importe deux de ses cartes. Les deux sont des
// déclarations `export function`, hissées avant toute évaluation, et aucune
// n'est appelée au niveau module — le cycle se résout au rendu.)
import { CartePenalites, CarteVisas } from './ProjetChantier'
// 5.21 — la saisie d'une situation et l'émission d'un certificat, montées EN
// PAGE depuis leur écran d'origine. Elles ne sont pas réécrites : `ModalEdition`
// fige le décompte, `ModalCertificat` numérote, fige et avance la résorption
// de l'avance. Deux versions de l'une ou de l'autre feraient deux papiers
// possibles pour le même mois — ce sont des documents contractuels.
import { ModalCertificat, ModalEdition, prochainNumeroSituation } from './Situations'
import type { StatutRG } from '../derive'
import type { LigneMarcheFiche } from '../entreprise'
import type { AppState, Projet, Situation } from '../types'

const LIBELLE_RG_COURT: Record<StatutRG, { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted' }> = {
  en_cours: { label: 'chantier en cours', tone: 'muted' },
  retenue: { label: 'retenue', tone: 'info' },
  a_liberer: { label: 'à libérer', tone: 'danger' },
  liberee: { label: 'libérée', tone: 'ok' },
}

/** lien vers l'onglet Chantier du projet — c'est LÀ que vit la carte
 *  complète (marchés, intempéries, réunions, GPA) */
function LienChantier({ projetId, children }: { projetId: string; children?: string }) {
  return (
    <a href={`#/projets/${projetId}/chantier`} title={`Ouvrir l'onglet Chantier de ${projetId}`}>
      {children || projetId}
    </a>
  )
}

// ------------------------------------------------------------
// Le cycle mensuel de l'argent, en une ligne par marché actif
// ------------------------------------------------------------

type EtapeCycle = {
  /** où en est le mois : ce que la personne doit faire ensuite */
  etat: 'attendue' | 'a_verifier' | 'validee' | 'certifie' | 'inactif'
  situation: Situation | undefined
  /** net à payer PROPOSÉ par l'autorité 5.19 — jamais recalculé ici.
   *  null quand rien n'est certifiable (pas de situation, pas de marché) */
  netProposeTTC: number | null
}

/** LIT l'étape du cycle mensuel d'un marché. Aucune arithmétique : le
 *  rapprochement vient de `situationDuMois` (src/entreprise.ts), le montant
 *  proposé de `construireCertificat` (src/certificat.ts), l'existence d'un
 *  certificat de `certificatDeSituation`. */
function etapeCycle(state: AppState, ligne: LigneMarcheFiche, moisCourant: string): EtapeCycle {
  if (!ligne.marche.actif) {
    return { etat: 'inactif', situation: undefined, netProposeTTC: null }
  }
  const situation = situationDuMois(state, ligne.marche, moisCourant)
  if (!situation) {
    return { etat: 'attendue', situation: undefined, netProposeTTC: null }
  }
  // un certificat ÉMIS ne se recalcule jamais : son net figé prime, et on
  // ne construit même pas la proposition (5.19)
  const dejaEmis = certificatDeSituation(state, situation.id)
  if (dejaEmis) {
    return { etat: 'certifie', situation, netProposeTTC: dejaEmis.netAPayerTTC }
  }
  const construit = construireCertificat(state, situation.id)
  return {
    etat: situation.statut === 'validee' ? 'validee' : 'a_verifier',
    situation,
    netProposeTTC: construit ? construit.lignes.netAPayerTTC : null,
  }
}

const LIBELLE_ETAPE: Record<EtapeCycle['etat'], { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted' }> = {
  attendue: { label: 'situation non reçue', tone: 'warn' },
  a_verifier: { label: 'reçue — à vérifier', tone: 'info' },
  validee: { label: 'validée — à certifier', tone: 'danger' },
  certifie: { label: 'certificat émis', tone: 'ok' },
  inactif: { label: 'marché clos', tone: 'muted' },
}

// ------------------------------------------------------------
// Le corps de la fiche — le même en page et en modale
// ------------------------------------------------------------

export function CorpsFicheEntreprise({
  nomOuId,
  enPage,
}: {
  nomOuId: string
  /** en page : les cartes d'action du chantier se montent (pas de modale
   *  imbriquée à craindre) et l'invitation à ouvrir la page disparaît */
  enPage?: boolean
}) {
  const { state, update, replace } = useStore()
  const today = useToday()
  const syn = syntheseEntreprise(state, nomOuId, today)
  const actifs = syn.marches.filter((l) => l.marche.actif).length
  const nomAgence = state.settings.nomAgence
  const moisCourant = today.slice(0, 7)
  /** quel chantier a ouvert son plan de travail (visas / pénalités) */
  const [chantierOuvert, setChantierOuvert] = useState<string | null>(null)
  /** 5.21 — les deux gestes du cycle, EN PAGE seulement (une modale ne
   *  s'ouvre pas dans une modale : `ui.tsx` pose le piège à focus et Échap
   *  sur `window`, les deux se disputeraient). Ils ne sont pas réécrits :
   *  `ModalEdition` et `ModalCertificat` sont importées de Situations.tsx,
   *  seule implémentation du figeage du décompte et de l'émission. */
  const [saisie, setSaisie] = useState<Situation | null>(null)
  const [certifierId, setCertifierId] = useState<string | null>(null)

  /** brouillon pré-rempli pour `ModalEdition` : les cinq champs que la fiche
   *  connaît déjà, plus le n° PROPOSÉ par `prochainNumeroSituation` — la
   *  même proposition que fait la fiche de saisie quand on y choisit le
   *  marché à la main. Les montants restent `null` : ils se lisent sur le
   *  papier remis, ils ne s'inventent pas. */
  const ouvrirSaisie = (marcheId: string, mois: string) => {
    const m = syn.marches.find((l) => l.marche.id === marcheId)?.marche
    if (!m) return
    setSaisie({
      id: uid('sit'),
      projetId: m.projetId,
      marcheId: m.id,
      entreprise: m.entreprise,
      lot: m.lot || undefined,
      mois,
      numero: prochainNumeroSituation(state, m.id),
      montantMoisHT: null,
      montantCumulHT: null,
      statut: 'a_verifier',
      confiance: null,
      source: `saisie manuelle du ${fmtDate(today)} depuis la fiche entreprise`,
      dateReception: today,
    })
  }

  const relancer = (marcheId: string, mois: string) => {
    const m = syn.marches.find((l) => l.marche.id === marcheId)?.marche
    if (!m) return
    ouvrirGmail(
      m.contactEmail || syn.contactEmail || '',
      sujetRelanceSituation(m, mois),
      corpsRelanceSituation(m, mois, nomAgence),
    )
  }

  /** GESTE — lever la retenue de garantie échue.
   *
   *  C'est une ÉCRITURE DE DRAPEAU, pas un calcul : le bouton n'apparaît que
   *  si `rg.statut === 'a_liberer'`, verdict rendu par `retenueGarantieMarche`
   *  (autorité 5.1, lue via la synthèse), et il pose `rgLibere = true`, rien
   *  d'autre. Le montant, la date de levée et le statut restent calculés au
   *  même endroit qu'avant : deux boutons ne peuvent pas en faire deux
   *  versions.
   *
   *  ⇒ `CarteRetenues` (src/modules/Situations.tsx, onglet « Retenues de
   *     garantie ») porte le MÊME geste et n'est pas exportée. Si elle
   *     l'était, cette fonction disparaîtrait au profit de la carte. En
   *     l'état elle poserait un tableau de TOUS les marchés du cabinet dans
   *     une fiche d'entreprise, ce qui n'aiderait personne. */
  const leverRG = (marcheId: string, lot: string, montantHT: number) => {
    const snap = state
    update((d) => {
      const m = d.marches.find((x) => x.id === marcheId)
      if (m) m.rgLibere = true
    })
    toast(`Retenue de garantie levée — ${lot} (${fmtMoney(montantHT)}).`, {
      tone: 'ok',
      undo: () => replace(snap),
    })
  }

  /** les chantiers où cette entreprise a quelque chose à traiter : c'est là
   *  qu'on propose le plan de travail emprunté à l'onglet Chantier */
  const chantiersAAgir: { projet: Projet; visas: number; penalites: number }[] = []
  for (const l of syn.marches) {
    if (!l.projet) continue
    if (chantiersAAgir.some((c) => c.projet.id === l.projet!.id)) continue
    const visas = syn.visasEnAttente.filter((v) => v.projetId === l.projet!.id).length
    const penalites = syn.penalitesEncourues.filter(
      (p) => p.marche.projetId === l.projet!.id && p.encouruHT > p.appliqueHT,
    ).length
    if (visas > 0 || penalites > 0) chantiersAAgir.push({ projet: l.projet, visas, penalites })
  }

  if (syn.marches.length === 0) {
    return (
      <>
        <Contact syn={syn} />
        <EmptyState>
          Aucun marché rattaché à cette entreprise — la fiche se remplit toute seule dès qu'un
          marché la nomme (fiche projet, carte « Marchés de travaux »).
        </EmptyState>
      </>
    )
  }

  return (
    <>
      <Contact syn={syn} />

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
          sub={syn.totaux.aLibererHT > 0 ? 'GPA échue — le bouton est au tableau' : 'rien d’échu'}
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

      {/* ---------------- le cycle mensuel de l'argent ---------------- */}
      <h3 className="small" style={{ margin: '14px 0 6px' }}>
        Cycle du mois — {fmtMois(moisCourant)}
      </h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Situation reçue → vérifiée → certificat émis. La saisie et l’émission restent à l’écran
        Situations, qui fige le décompte et numérote l’état : <strong>un seul chemin</strong> pour
        un document qu’on remet à l’entreprise. Le lien ci-dessous ouvre la <em>ligne</em>
        {' '}concernée, pas la liste.
      </p>
      <Table
        compact
        head={[
          'Lot',
          'Chantier',
          'Avancement',
          'État du mois',
          <span key="n" className="right">Net à payer</span>,
          '',
        ]}
      >
        {syn.marches
          .filter((l) => l.marche.actif)
          .map((l) => {
            const c = etapeCycle(state, l, moisCourant)
            const lib = LIBELLE_ETAPE[c.etat]
            const avancement = avancementLot(state.tachesChantier, l.marche.id)
            return (
              <tr key={l.marche.id}>
                <td>{l.marche.lot}</td>
                <td>
                  <LienChantier projetId={l.marche.projetId} />
                  {l.projet && <div className="muted small">{l.projet.nom}</div>}
                </td>
                <td>
                  {/* « null n'est pas 0 » : sans tâche de chantier rattachée
                      au marché, l'avancement est INCONNU, pas nul */}
                  {avancement === null ? (
                    <span className="muted small" title="Aucune tâche de chantier rattachée à ce lot">
                      —
                    </span>
                  ) : (
                    `${avancement} %`
                  )}
                </td>
                <td>
                  <Badge tone={lib.tone}>{lib.label}</Badge>
                </td>
                <td className="right">
                  {c.netProposeTTC === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      {fmtMoney(c.netProposeTTC, true)}
                      <div className="muted small">
                        {c.etat === 'certifie' ? 'TTC certifié' : 'TTC proposé'}
                      </div>
                    </>
                  )}
                </td>
                <td className="right small">
                  {c.etat === 'attendue' ? (
                    <>
                      <BtnLien
                        title="Ouvre un brouillon Gmail pré-rempli — l'envoi reste votre clic"
                        onClick={() => relancer(l.marche.id, moisCourant)}
                      >
                        relancer →
                      </BtnLien>
                      {/* 5.21 — une situation remise en main propre ou reçue
                          par courrier se saisit ICI, pré-remplie. En modale on
                          ne le propose pas : ce serait une modale dans une
                          modale. */}
                      {enPage && (
                        <>
                          {' · '}
                          <BtnLien
                            title={`Ouvre LA fiche de saisie de l'écran Situations, pré-remplie sur ${l.marche.lot} — ${fmtMois(moisCourant)}. Il ne reste que les montants du papier.`}
                            onClick={() => ouvrirSaisie(l.marche.id, moisCourant)}
                          >
                            saisir ↗
                          </BtnLien>
                        </>
                      )}
                    </>
                  ) : enPage && c.etat === 'validee' && c.situation ? (
                    // 5.21 — l'émission depuis la fiche : c'est la modale de
                    // Situations.tsx qui s'ouvre, seul chemin d'émission du
                    // dépôt (numérotation, figeage, PDF, résorption).
                    <BtnLien
                      title="Ouvre la modale d'émission : chaque ligne reste corrigeable, « Émettre » fige le document et ouvre le PDF"
                      onClick={() => setCertifierId(c.situation!.id)}
                    >
                      émettre le certificat ↗
                    </BtnLien>
                  ) : c.situation ? (
                    // porte réelle : `cibleId` (Situations.tsx) met CETTE
                    // ligne en évidence — pas un dépôt en haut de liste
                    <a
                      href={`#/situations/verifier/${c.situation.id}`}
                      title={
                        c.etat === 'certifie'
                          ? 'Ouvrir la situation — le certificat se rouvre en réimpression'
                          : c.etat === 'validee'
                            ? 'Ouvrir la situation pour émettre son certificat de paiement'
                            : 'Ouvrir la situation pour la vérifier'
                      }
                    >
                      {c.etat === 'certifie'
                        ? 'réimprimer →'
                        : c.etat === 'validee'
                          ? 'certificat →'
                          : 'vérifier →'}
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        {actifs === 0 && (
          <tr>
            <td colSpan={6} className="muted small">
              Aucun marché actif — plus aucune situation n’est attendue.
            </td>
          </tr>
        )}
      </Table>

      {/* Le DÉCOMPTE de la situation en cours, lu tel quel : c'est le même
          objet que l'écran Situations affiche, au centime près (autorité 5.1).
          Il vit ici parce que les incohérences de cumul se voient AVANT
          d'ouvrir la situation — c'est ce qui décide si on la vérifie
          maintenant ou si on rappelle l'entreprise. */}
      {syn.marches
        .filter((l) => l.marche.actif)
        .map((l) => {
          const s = situationDuMois(state, l.marche, moisCourant)
          if (!s) return null
          const d = decompteSituation(state, s)
          return (
            <p key={l.marche.id} className="small muted" style={{ margin: '4px 0' }}>
              {l.marche.lot} — cumul {fmtMoney(d.travauxCumulHT)} HT, retenue de garantie{' '}
              {fmtMoney(d.retenueGarantieHT)}, net du mois {fmtMoney(d.netAPayerHT)} HT.
              {d.coherences.length > 0 && (
                <>
                  {' '}
                  <span title={d.coherences.join('\n')}>
                    <Badge tone="warn">{d.coherences.length} incohérence(s)</Badge>
                  </span>
                </>
              )}
            </p>
          )
        })}

      {/* ---------------- les marchés, tous projets ---------------- */}
      <h3 className="small" style={{ margin: '14px 0 6px' }}>Marchés — tous projets</h3>
      <Table
        compact
        head={[
          'Projet',
          'Lot',
          <span key="m" className="right">Montant HT</span>,
          'Retenue de garantie',
          'Dernier certificat',
          '',
        ]}
      >
        {syn.marches.map(({ marche: m, projet, rg, dernierCertificat }) => (
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
                  {LIBELLE_GARANTIE[rg.garantie]}
                </span>
              ) : (
                <>
                  <Money v={rg.retenueHT} />{' '}
                  <Badge tone={LIBELLE_RG_COURT[rg.statut].tone}>{LIBELLE_RG_COURT[rg.statut].label}</Badge>
                  {rg.dateLevee && (
                    <div className="muted small">levée au {fmtDate(rg.dateLevee)}</div>
                  )}
                </>
              )}
            </td>
            <td className="small">
              {dernierCertificat ? (
                <a href="#/situations/historique" title="Historique des situations — réimpression du certificat figé">
                  n° {dernierCertificat.numero} · {fmtMois(dernierCertificat.mois)} ·{' '}
                  {fmtMoney(dernierCertificat.netAPayerTTC, true)} TTC
                </a>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
            <td className="right small">
              {rg.statut === 'a_liberer' ? (
                <Btn
                  small
                  onClick={() => leverRG(m.id, m.lot, rg.retenueHT)}
                  title="La garantie de parfait achèvement est échue : marquer la retenue rendue à l'entreprise"
                >
                  Lever la RG
                </Btn>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
          </tr>
        ))}
      </Table>

      {/* ---------------- pénalités ---------------- */}
      {syn.penalitesEncourues.length > 0 && (
        <>
          <h3 className="small" style={{ margin: '14px 0 6px' }}>Pénalités</h3>
          <Table
            compact
            head={[
              'Marché',
              <span key="e" className="right">Encouru HT</span>,
              <span key="a" className="right">Appliqué HT</span>,
              'Décision',
            ]}
          >
            {syn.penalitesEncourues.map(({ marche: m, encouruHT, appliqueHT }) => (
              <tr key={m.id}>
                <td>
                  {m.lot} <span className="muted small">({m.projetId})</span>
                </td>
                <td className="right">{fmtMoney(encouruHT, true)}</td>
                <td className="right">{fmtMoney(appliqueHT, true)}</td>
                <td className="small">
                  {encouruHT > appliqueHT ? (
                    <Badge tone="warn">à décider</Badge>
                  ) : (
                    <Badge tone="ok">décidée</Badge>
                  )}{' '}
                  {enPage ? (
                    <BtnLien
                      title="Ouvrir le plan de travail de ce chantier, plus bas"
                      onClick={() => setChantierOuvert(m.projetId)}
                    >
                      décider ↓
                    </BtnLien>
                  ) : (
                    <LienChantier projetId={m.projetId}>décider →</LienChantier>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {/* ---------------- désordres GPA ---------------- */}
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
                  {/* la levée d'un désordre vit dans `CarteGPA`
                      (ProjetChantier.tsx) : elle est EXPORTÉE, mais c'est la
                      plus lourde des cartes du chantier (mise en demeure,
                      relances, modèles de courrier). L'embarquer ici
                      alourdirait la fiche pour un geste rare — le lien reste
                      le bon compromis. */}
                  <LienChantier projetId={d.projetId}>relancer / lever →</LienChantier>
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {/* ---------------- visas ---------------- */}
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
                    {enPage ? (
                      <BtnLien
                        title="Ouvrir le plan de travail de ce chantier, plus bas"
                        onClick={() => setChantierOuvert(v.projetId)}
                      >
                        viser ↓
                      </BtnLien>
                    ) : (
                      <LienChantier projetId={v.projetId}>viser →</LienChantier>
                    )}
                  </td>
                </tr>
              )
            })}
          </Table>
        </>
      )}

      {/* ---------------- le plan de travail, emprunté au chantier ----------------
          Ce ne sont PAS des tableaux réécrits : ce sont les cartes de
          l'onglet Chantier, montées ici. Elles montrent donc TOUS les lots du
          chantier, pas seulement ceux de cette entreprise — un second tableau
          filtré serait une seconde vérité sur les mêmes visas. */}
      {enPage && chantiersAAgir.length > 0 && (
        <>
          <h3 className="small" style={{ margin: '18px 0 6px' }}>Agir sans quitter la fiche</h3>
          {chantiersAAgir.map(({ projet, visas, penalites }) => (
            <div key={projet.id} style={{ marginBottom: 10 }}>
              <Btn
                small
                kind={chantierOuvert === projet.id ? 'primary' : 'default'}
                onClick={() => setChantierOuvert(chantierOuvert === projet.id ? null : projet.id)}
                title="Monte les cartes Visas et Pénalités de l'onglet Chantier — les mêmes, pas des copies"
              >
                {chantierOuvert === projet.id ? '▾' : '▸'} {projet.nom}
                {visas > 0 ? ` · ${visas} visa(s) à viser` : ''}
                {penalites > 0 ? ` · ${penalites} pénalité(s) à décider` : ''}
              </Btn>
              {chantierOuvert === projet.id && (
                <div style={{ marginTop: 8 }}>
                  <p className="small muted" style={{ marginTop: 0 }}>
                    Cartes de l’onglet Chantier de <LienChantier projetId={projet.id}>{projet.id}</LienChantier>,
                    montées telles quelles : elles listent <strong>tous les lots</strong> du chantier.
                  </p>
                  {visas > 0 && <CarteVisas projet={projet} />}
                  {penalites > 0 && <CartePenalites projet={projet} />}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* 5.21 — les deux modales du cycle, montées EN PAGE. `certifierId`
          garde l'IDENTIFIANT et relit la situation sur l'état frais : après
          émission, la modale doit voir le certificat qu'elle vient de poser
          et refuser le doublon — une copie capturée le lui cacherait. */}
      {enPage && saisie && <ModalEdition sit={saisie} creation onClose={() => setSaisie(null)} />}
      {enPage &&
        certifierId &&
        (() => {
          const sit = state.situations.find((x) => x.id === certifierId)
          return sit ? <ModalCertificat sit={sit} onClose={() => setCertifierId(null)} /> : null
        })()}
    </>
  )
}

function Contact({ syn }: { syn: ReturnType<typeof syntheseEntreprise> }) {
  return (
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
        </>
      ) : (
        <>Aucun contact au registre — il se remplit depuis le marché ou la fiche entreprise.</>
      )}
    </p>
  )
}

/** point d'entrée MODALE — inchangé pour ProjetChantier.tsx et Situations.tsx */
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
  // l'adresse de la PAGE : l'id du registre quand il existe, sinon le nom —
  // la même clé que la liste (`entreprisesSuivies`) transporte
  const cle = syn.entreprise ? syn.entreprise.id : nomOuId
  return (
    <Modal titre={`Entreprise — ${syn.nom}`} onClose={onClose} large>
      <p className="pill-note" style={{ marginTop: 0 }}>
        <a
          href={`#/entreprises/${encodeURIComponent(cle)}`}
          title="La fiche en pleine page : les cartes Visas et Pénalités du chantier s'y montent, ce qu'une modale ne peut pas faire (modale dans modale)"
        >
          Ouvrir la fiche complète →
        </a>{' '}
        <span className="muted small">
          — en page, on vise et on décide sans quitter la fiche.
        </span>
      </p>
      <CorpsFicheEntreprise nomOuId={nomOuId} />
    </Modal>
  )
}
