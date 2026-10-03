'use client'

import { GuardrailsScreen } from '@/components/settings/screens/guardrails'
import { InboxesScreen } from '@/components/settings/screens/inboxes'
import { RepliesScreen } from '@/components/settings/screens/replies'
import { SitesScreen } from '@/components/settings/screens/sites'
import { SmsNumbersScreen } from '@/components/settings/screens/sms'
import { TeamsScreen } from '@/components/settings/screens/teams'
import { TokensScreen } from '@/components/settings/screens/tokens'
import { ToolsStudio } from '@/components/settings/screens/tools'
import { SettingsScreen } from '@/components/settings/settings-screen'
import { redirect } from 'next/navigation'
import { type ComponentType, use } from 'react'

/** Each group of settings has its own screen; one without falls back on the generic list. */
const SCREENS: Readonly<Record<string, ComponentType>> = {
  boites: InboxesScreen,
  equipes: TeamsScreen,
  sites: SitesScreen,
  reponses: RepliesScreen,
  'garde-fous': GuardrailsScreen,
  sms: SmsNumbersScreen,
  outils: ToolsStudio,
  api: TokensScreen,
}

export default function SettingsPage({ params }: { params: Promise<{ group: string }> }) {
  const { group } = use(params)
  // The knowledge base has its own screen, with its editor.
  if (group === 'connaissance') redirect('/connaissance')
  const Screen = SCREENS[group]
  return Screen ? <Screen key={group} /> : <SettingsScreen key={group} group={group} />
}
