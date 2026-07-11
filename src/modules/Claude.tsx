import { Page, Tabs, navigate, useRoute } from '../ui'
import { PromptsContenu } from './Prompts'
import { RoutinesContenu } from './Routines'

export default function Claude({ ongletInitial = 'prompts' }: { ongletInitial?: 'prompts' | 'routines' }) {
  // deux vraies routes (#/prompts et #/routines) : le retour navigateur suit
  const route = useRoute()
  const tab = route[0] === 'routines' ? 'routines' : route[0] === 'prompts' ? 'prompts' : ongletInitial
  return (
    <Page titre="Automatisations" sousTitre="Ce qui tourne tout seul — et les gabarits/imports qui restent manuels.">
      <Tabs
        tabs={[
          { id: 'prompts', label: 'Prompts' },
          { id: 'routines', label: 'Routines & imports' },
        ]}
        actif={tab}
        onSelect={(id) => navigate(`/${id}`)}
      />
      {tab === 'prompts' ? <PromptsContenu /> : <RoutinesContenu />}
    </Page>
  )
}
