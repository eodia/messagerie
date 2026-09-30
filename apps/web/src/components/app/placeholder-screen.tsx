'use client'

import { Button } from '@/components/ui/button'
import { $t } from '@/lib/i18n'
import { ExternalLink, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useBasedbUrl } from './app-shell'
import { EmptyState } from './empty-state'
import { ScreenHeader } from './screen-header'

/** A screen still to come, which says what it will hold and where that lives meanwhile. */
export function PlaceholderScreen({
  title,
  icon,
  heading,
  children,
  inBasedb = false,
}: {
  readonly title: string
  readonly icon: LucideIcon
  readonly heading: string
  readonly children: ReactNode
  /** What the screen shows is already set up in basedb: offer to go there. */
  readonly inBasedb?: boolean
}) {
  const basedbUrl = useBasedbUrl()
  return (
    <>
      <ScreenHeader>
        <span className="font-medium">{title}</span>
      </ScreenHeader>
      <EmptyState
        icon={icon}
        title={heading}
        actions={
          inBasedb && (
            <Button variant="outline" asChild>
              <a href={basedbUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                {$t('Ouvrir dans basedb')}
              </a>
            </Button>
          )
        }
      >
        {children}
      </EmptyState>
    </>
  )
}
