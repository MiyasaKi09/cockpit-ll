// Sous-navigation de Finance — audit §3.2 : UNE entrée dans la barre
// latérale, six vues à l'intérieur (sélecteur défilant sur téléphone).

import { Tabs, navigate } from '../ui'

export type VueFinance = 'ensemble' | 'contrats' | 'ventes' | 'achats' | 'banque' | 'comptable'

const VUES: { id: VueFinance; label: string; route: string }[] = [
  { id: 'ensemble', label: "Vue d'ensemble", route: '/finance' },
  { id: 'contrats', label: 'Contrats & budgets', route: '/contrats' },
  { id: 'ventes', label: 'Ventes', route: '/facturation' },
  { id: 'achats', label: 'Achats & frais', route: '/finance/achats' },
  { id: 'banque', label: 'Banque & trésorerie', route: '/finance/banque' },
  { id: 'comptable', label: 'Comptable', route: '/finance/comptable' },
]

export default function FinanceNav({ actif }: { actif: VueFinance }) {
  return (
    <Tabs
      tabs={VUES.map((v) => ({ id: v.id, label: v.label }))}
      actif={actif}
      onSelect={(id) => navigate(VUES.find((v) => v.id === id)!.route)}
    />
  )
}
