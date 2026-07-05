import { useState } from 'react'
import { Page, Tabs } from '../ui'
import { PromptsContenu } from './Prompts'
import { RoutinesContenu } from './Routines'

export default function Claude({ ongletInitial = 'prompts' }: { ongletInitial?: 'prompts' | 'routines' }) {
  const [tab, setTab] = useState<'prompts' | 'routines'>(ongletInitial)
  return (
    <Page titre="Claude" sousTitre="Gabarits de prompts et routines d'import.">
      <Tabs
        tabs={[
          { id: 'prompts', label: 'Prompts' },
          { id: 'routines', label: 'Routines & imports' },
        ]}
        actif={tab}
        onSelect={(id) => setTab(id as 'prompts' | 'routines')}
      />
      {tab === 'prompts' ? <PromptsContenu /> : <RoutinesContenu />}
    </Page>
  )
}
