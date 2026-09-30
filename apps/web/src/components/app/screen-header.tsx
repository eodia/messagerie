'use client'

import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/tooltip'
import { $t } from '@/lib/i18n'
import { useSidebar } from '@/lib/store/sidebar'
import { PanelLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { NotificationBell } from './notification-bell'

/**
 * The bar at the top of every screen, as basedb draws its own: the sidebar's toggle at the
 * far left, where the thumb finds it on every screen, then where one is, then the tools —
 * and the bell, on every screen, since an alert does not wait for the inbox to be open.
 */
export function ScreenHeader({
  children,
  tools,
}: {
  readonly children: ReactNode
  readonly tools?: ReactNode
}) {
  const toggle = useSidebar((s) => s.toggle)
  const collapsed = useSidebar((s) => s.collapsed)
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
      <Hint label={collapsed ? $t('Déplier la barre latérale') : $t('Replier la barre latérale')}>
        <Button variant="ghost" size="icon-sm" onClick={toggle}>
          <PanelLeft className="text-muted-foreground" />
        </Button>
      </Hint>
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">{children}</div>
      <div className="flex shrink-0 items-center gap-1.5">
        {tools}
        <NotificationBell />
      </div>
    </header>
  )
}

/** A breadcrumb separator. */
export function Slash() {
  return <span className="text-muted-foreground/60">/</span>
}
