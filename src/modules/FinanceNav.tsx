// Sous-navigation de Finance — UNE entrée dans la barre latérale (audit
// §3.2), NEUF vues à l'intérieur. Décision du 04/08 (docs/
// INVENTAIRE_FINANCE.md) : la barre se HIÉRARCHISE sans rien retirer —
// quatre vues portent le quotidien (L'essentiel · Ventes · Achats & frais ·
// Banque), les cinq autres restent accessibles sur un rang discret.
// ZÉRO suppression : l'inventaire 5.17 n'est pas coché, on ne masque
// aucun accès tant que les deux associées n'ont pas tranché ensemble.

import { Tabs, navigate } from '../ui'

export type VueFinance =
  | 'ensemble'
  | 'contrats'
  | 'ventes'
  | 'achats'
  | 'banque'
  | 'comptable'
  | 'revue'
  | 'previsions'
  | 'connecteurs'

const VUES: { id: VueFinance; label: string; route: string; rang: 'principal' | 'secondaire' }[] = [
  // rang principal — le quotidien : entrer, vendre, acheter, vérifier le compte
  { id: 'ensemble', label: "L'essentiel", route: '/finance', rang: 'principal' },
  { id: 'ventes', label: 'Ventes', route: '/facturation', rang: 'principal' },
  { id: 'achats', label: 'Achats & frais', route: '/finance/achats', rang: 'principal' },
  { id: 'banque', label: 'Banque', route: '/finance/banque', rang: 'principal' },
  // rang secondaire — moins fréquent, jamais supprimé ni replié derrière un menu
  { id: 'contrats', label: 'Contrats', route: '/contrats', rang: 'secondaire' },
  { id: 'comptable', label: 'Comptable', route: '/finance/comptable', rang: 'secondaire' },
  { id: 'revue', label: 'Revue', route: '/finance/revue', rang: 'secondaire' },
  { id: 'previsions', label: 'Prévisions', route: '/finance/previsions', rang: 'secondaire' },
  { id: 'connecteurs', label: 'Connecteurs', route: '/finance/connecteurs', rang: 'secondaire' },
]

export default function FinanceNav({ actif }: { actif: VueFinance }) {
  const principales = VUES.filter((v) => v.rang === 'principal')
  const secondaires = VUES.filter((v) => v.rang === 'secondaire')
  const aller = (id: string) => navigate(VUES.find((v) => v.id === id)!.route)
  return (
    <div>
      <Tabs
        tabs={principales.map((v) => ({ id: v.id, label: v.label }))}
        actif={actif}
        onSelect={aller}
      />
      <nav className="tabs-secondaires" aria-label="Autres vues de la Finance">
        {secondaires.map((v) => (
          <button
            key={v.id}
            className={`tab-secondaire ${v.id === actif ? 'tab-secondaire-actif' : ''}`}
            onClick={() => aller(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
