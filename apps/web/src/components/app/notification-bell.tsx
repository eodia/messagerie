'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Hint } from '@/components/ui/tooltip'
import { $t, $tp } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { inboxTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { AlertKind, Notification } from '@chat/contracts'
import {
  AlarmClock,
  ArrowRightLeft,
  Bell,
  Forward,
  type LucideIcon,
  MessageCircle,
  UserRoundPlus,
} from 'lucide-react'

const KINDS: Record<AlertKind, { readonly icon: LucideIcon; readonly tint: string }> = {
  visitor_message: {
    icon: MessageCircle,
    tint: 'bg-sky-500/15 text-sky-800 dark:text-sky-300',
  },
  handoff: {
    icon: ArrowRightLeft,
    tint: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  },
  assigned: {
    icon: UserRoundPlus,
    tint: 'bg-violet-500/15 text-violet-800 dark:text-violet-300',
  },
  transferred: {
    icon: Forward,
    tint: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
  },
  woke: {
    icon: AlarmClock,
    tint: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  },
}

function sentence(notification: Notification): string {
  const name = notification.contactName
  switch (notification.kind) {
    case 'visitor_message':
      return $t('{name} vous a écrit', { name })
    case 'handoff':
      return $t('L’IA a transféré la conversation de {name}', { name })
    case 'assigned':
      return $t('{by} vous a confié la conversation de {name}', {
        by: notification.by ?? '—',
        name,
      })
    case 'transferred':
      return $t('{by} a transféré à votre équipe la conversation de {name}', {
        by: notification.by ?? '—',
        name,
      })
    case 'woke':
      return $t('La conversation de {name} revient de l’attente', { name })
  }
}

/**
 * The agent's bell, on every screen: what called for them, kept by the server until they
 * open the conversation. The count on it is the unread lines.
 */
export function NotificationBell() {
  const list = useInbox((s) => s.notifications)
  const now = useInbox((s) => s.now)
  const { open, readAllNotifications } = useInbox.getState()

  return (
    <DropdownMenu>
      <Hint label={$t('Notifications')}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            aria-label={$tp(
              list.unread,
              '{count} notification non lue',
              '{count} notifications non lues',
            )}
          >
            <Bell className="text-muted-foreground" />
            {list.unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums ring-2 ring-background">
                {list.unread > 99 ? '99+' : list.unread}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <span className="text-sm font-semibold">{$t('Notifications')}</span>
          {list.unread > 0 && (
            <button
              type="button"
              onClick={() => void readAllNotifications()}
              className="text-xs font-medium text-primary hover:underline"
            >
              {$t('Tout marquer comme lu')}
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto p-1.5 scroll-discret">
          {list.items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {$t('Aucune notification.')}
            </div>
          ) : (
            list.items.map((notification) => {
              const { icon: Icon, tint } = KINDS[notification.kind]
              return (
                <DropdownMenuItem
                  key={notification.id}
                  onSelect={() => open(notification.conversationId)}
                  className="items-start gap-3 py-2"
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
                      tint,
                    )}
                  >
                    <Icon className="size-3.5 text-current!" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-sm leading-snug',
                        notification.read ? 'text-muted-foreground' : 'font-medium',
                      )}
                    >
                      {sentence(notification)}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground tabular-nums">
                      {inboxTime(notification.at, now)}
                    </span>
                  </span>
                  {!notification.read && (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  )}
                </DropdownMenuItem>
              )
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
