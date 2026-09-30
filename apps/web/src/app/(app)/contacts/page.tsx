'use client'

import { PlaceholderScreen } from '@/components/app/placeholder-screen'
import { $t } from '@/lib/i18n'
import { UsersRound } from 'lucide-react'

export default function ContactsPage() {
  return (
    <PlaceholderScreen
      title={$t('Contacts')}
      icon={UsersRound}
      heading={$t('Les contacts arrivent')}
    >
      {$t(
        'La fiche de chaque visiteur, anonyme puis identifié par le site, avec ses conversations. Prévue avec l’inbox complète.',
      )}
    </PlaceholderScreen>
  )
}
