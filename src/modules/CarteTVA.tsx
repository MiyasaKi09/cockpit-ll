// ============================================================
// Carte TVA — « ce qu'on doit à l'État », lisible en un regard.
// Carte AUTONOME (un import, aucune prop) : posée en tête de
// l'onglet Comptable en attendant son montage dans l'écran
// Finance. Tout le calcul vit dans src/tva.ts (pur) ; la carte
// affiche, et porte UN geste : « Marquer déclarée », qui fige le
// solde d'un mois échu (§15 — la machine calcule, l'humain
// déclare). La convention affichée vient de libelleConvention —
// une seule source, réglée par settings.regimeTVA, à valider avec
// le cabinet (docs/QUESTIONS_CABINET_TVA.md).
// ============================================================

import { useMemo } from 'react'
import { useStore } from '../store'
import { Badge, Btn, Card, Stat, Table, confirmer, toast, useToday } from '../ui'
import {
  declarationDuMois,
  libelleConvention,
  positionTVA,
  regimeTVAEffectif,
  type MoisTVA,
} from '../tva'
import { fmtDate, fmtMois, fmtMoney, monthKey, uid } from '../util'

export default function CarteTVA() {
  const { state, update } = useStore()
  const today = useToday()
  const moisCourant = monthKey(today)
  const position = useMemo(() => positionTVA(state, { moisCourant }), [state, moisCourant])
  const regime = regimeTVAEffectif(state.settings)

  // les 3 derniers mois jusqu'au mois courant — toujours présents dans la
  // position, même à zéro (un mois vide est une information, pas un trou)
  const affiches = position.mois.filter((m) => m.mois <= moisCourant).slice(-3)
  // mois échus plus anciens, non déclarés, à solde non nul : hors du tableau
  // mais DANS le dû — sans cette ligne, le grand chiffre semblerait faux
  const anciens = position.mois.filter(
    (m) =>
      m.mois < moisCourant &&
      (affiches.length === 0 || m.mois < affiches[0].mois) &&
      !declarationDuMois(state, m.mois) &&
      Math.abs(m.solde) > 0.004,
  )
  const credit = position.duALEtat < -0.004

  const marquerDeclaree = async (m: MoisTVA) => {
    if (
      !(await confirmer({
        message:
          `Marquer ${fmtMois(m.mois)} déclarée ?\n\n` +
          `Le solde de ${fmtMoney(m.solde, true)} (collectée ${fmtMoney(m.collectee, true)} − ` +
          `déductible ${fmtMoney(m.deductible, true)}) sera figé et sortira du « dû à l'État ». ` +
          `Si une pièce du mois bouge ensuite, l'écart restera visible ici.`,
        confirmerLabel: 'Marquer déclarée',
      }))
    )
      return
    update((d) => {
      // garde anti-doublon : deux clics (ou les deux postes) ne figent qu'une fois
      if (d.tvaDeclarations.some((x) => x.mois === m.mois)) return
      d.tvaDeclarations.push({ id: uid('tvadecl'), mois: m.mois, montant: m.solde, declareLe: today })
    })
    toast(`${fmtMois(m.mois)} marquée déclarée — solde figé à ${fmtMoney(m.solde, true)}.`, { tone: 'ok' })
  }

  return (
    <Card titre="TVA — ce qu'on doit à l'État">
      <div className="grid4" style={{ marginBottom: 10 }}>
        <Stat
          label="Dû à l'État — mois échus non déclarés"
          value={fmtMoney(position.duALEtat, true)}
          tone={credit ? 'ok' : undefined}
          sub={credit ? 'crédit de TVA — report ou remboursement, à voir avec le cabinet' : undefined}
        />
      </div>
      <Table
        compact
        head={[
          'Mois',
          <span key="c" className="right">Collectée</span>,
          <span key="d" className="right">Déductible</span>,
          <span key="s" className="right">Solde</span>,
          'Déclaration',
        ]}
      >
        {affiches.map((m) => {
          const decl = declarationDuMois(state, m.mois)
          const enCours = m.mois === moisCourant
          return (
            <tr key={m.mois}>
              <td>{fmtMois(m.mois)}</td>
              <td className="right num">{fmtMoney(m.collectee, true)}</td>
              <td className="right num">{fmtMoney(m.deductible, true)}</td>
              <td className="right num" style={{ fontWeight: 650 }}>
                {fmtMoney(m.solde, true)}
              </td>
              <td>
                {enCours ? (
                  <Badge tone="muted">mois en cours</Badge>
                ) : decl ? (
                  <span className="small">
                    <Badge tone="ok">déclarée le {fmtDate(decl.declareLe)}</Badge>
                    {Math.abs(decl.montant - m.solde) > 0.004 && (
                      <div className="warn-text small">
                        figée à {fmtMoney(decl.montant, true)} — le mois a bougé depuis (solde
                        recalculé : {fmtMoney(m.solde, true)})
                      </div>
                    )}
                  </span>
                ) : (
                  <Btn small onClick={() => void marquerDeclaree(m)}>
                    Marquer déclarée
                  </Btn>
                )}
              </td>
            </tr>
          )
        })}
      </Table>
      {anciens.length > 0 && (
        <p className="small" style={{ margin: '8px 2px 0' }}>
          … et {anciens.length} mois plus ancien(s) non déclaré(s) pour{' '}
          <strong>{fmtMoney(anciens.reduce((s, m) => s + m.solde, 0), true)}</strong> — compris dans
          le dû ci-dessus.
        </p>
      )}
      <p className="muted small" style={{ margin: '10px 2px 0' }}>
        Convention : {libelleConvention(regime)} (docs/QUESTIONS_CABINET_TVA.md). La prévision de
        trésorerie garde son forfait TVA paramétré avec le cabinet — cette position calculée ne le
        remplace pas.
      </p>
    </Card>
  )
}
