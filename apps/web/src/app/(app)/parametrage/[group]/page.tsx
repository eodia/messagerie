'use client'

import { SettingsScreen } from '@/components/settings/settings-screen'
import { use } from 'react'

export default function SettingsPage({ params }: { params: Promise<{ group: string }> }) {
  const { group } = use(params)
  return <SettingsScreen key={group} group={group} />
}
