'use client'

import { PlaceholderScreen } from '@/components/app/placeholder-screen'
import { $t } from '@/lib/i18n'
import { BookOpen } from 'lucide-react'

export default function KnowledgePage() {
  return (
    <PlaceholderScreen
      title={$t('Connaissance')}
      icon={BookOpen}
      heading={$t('La base de connaissance vit dans basedb')}
      inBasedb
    >
      {$t(
        'Les articles et les conversations promues se rédigent et se relisent dans basedb. Ici viendra la vue des conseillers : chercher un article, le citer, promouvoir une conversation.',
      )}
    </PlaceholderScreen>
  )
}
