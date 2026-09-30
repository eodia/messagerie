'use client'

import { PlaceholderScreen } from '@/components/app/placeholder-screen'
import { $t } from '@/lib/i18n'
import { ChartColumn } from 'lucide-react'

export default function StatisticsPage() {
  return (
    <PlaceholderScreen
      title={$t('Statistiques')}
      icon={ChartColumn}
      heading={$t('Les compteurs arrivent')}
    >
      {$t(
        'Volume, taux de résolution par l’IA, délai de réponse. Les tableaux de bord complets seront ceux de basedb, sur les vues du schéma de la messagerie.',
      )}
    </PlaceholderScreen>
  )
}
