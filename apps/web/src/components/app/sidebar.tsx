'use client'

import { InboxGlyph } from '@/components/app/look'
import { Separator } from '@/components/ui/separator'
import { Hint } from '@/components/ui/tooltip'
import { $t, msg } from '@/lib/i18n'
import { PRODUCT_NAME } from '@/lib/product'
import { useInbox, waitingByInbox, waitingCount } from '@/lib/store/inbox'
import { useSidebar } from '@/lib/store/sidebar'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  ChartColumn,
  ChevronsUpDown,
  ExternalLink,
  Globe,
  Headset,
  Inbox,
  KeyRound,
  type LucideIcon,
  MessageSquareText,
  MessagesSquare,
  Palette,
  ShieldAlert,
  UsersRound,
  Wrench,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { UserMenu } from './user-menu'

interface Screen {
  readonly href: string
  readonly label: string
  readonly icon: LucideIcon
}

/** After the conversations and their inboxes: the screens an agent works in. */
const SCREENS: readonly Screen[] = [
  { href: '/contacts', label: msg('Contacts'), icon: UsersRound },
  { href: '/connaissance', label: msg('Connaissance'), icon: BookOpen },
  { href: '/statistiques', label: msg('Statistiques'), icon: ChartColumn },
]

/**
 * What a supervisor sets up. The data lives in basedb, base « Messagerie » (D1, D10): these
 * screens read and write it there.
 */
const SETTINGS: readonly Screen[] = [
  { href: '/parametrage/boites', label: msg('Boîtes de réception'), icon: Inbox },
  { href: '/parametrage/equipes', label: msg('Équipes et conseillers'), icon: Headset },
  { href: '/parametrage/sites', label: msg('Sites et horaires'), icon: Globe },
  { href: '/parametrage/reponses', label: msg('Réponses types'), icon: MessageSquareText },
  { href: '/parametrage/garde-fous', label: msg('Garde-fous'), icon: ShieldAlert },
  { href: '/outils', label: msg('Outils IA'), icon: Wrench },
  { href: '/widget', label: msg('Widget'), icon: Palette },
  { href: '/parametrage/api', label: msg('API et MCP'), icon: KeyRound },
]

export function Sidebar({ basedbUrl }: { readonly basedbUrl: string }) {
  const collapsed = useSidebar((s) => s.collapsed)
  const pathname = usePathname()
  const waiting = useInbox(waitingCount)
  const byInbox = useInbox(useShallow(waitingByInbox))
  const inboxes = useInbox((s) => s.directory.inboxes)
  const current = useInbox((s) => s.inbox)
  const showInbox = useInbox((s) => s.showInbox)
  const onConversations = pathname.startsWith('/conversations')

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground',
        collapsed ? 'w-14' : 'w-64',
      )}
    >
      <div className="p-2">
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-accent',
            collapsed && 'justify-center',
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/10 ring-inset">
            <MessagesSquare
              className="size-4.5"
              style={{ color: 'color-mix(in oklab, var(--primary) 65%, var(--foreground))' }}
            />
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{PRODUCT_NAME}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {$t('Tous les sites')}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-1 scroll-discret">
        <div className="space-y-0.5">
          <NavRow
            label={$t('Conversations')}
            icon={MessagesSquare}
            active={onConversations && current === null}
            collapsed={collapsed}
            count={waiting}
            onClick={() => showInbox(null)}
          />
          {!collapsed &&
            inboxes.map((inbox) => (
              <button
                key={inbox.id}
                type="button"
                onClick={() => showInbox(inbox.id)}
                className={cn(
                  'flex h-7 w-full items-center gap-2.5 rounded-lg pr-2 pl-8 text-left text-[13px] transition-colors hover:bg-sidebar-accent',
                  onConversations && current === inbox.id
                    ? 'bg-sidebar-accent font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <InboxGlyph look={inbox} />
                <span className="min-w-0 flex-1 truncate">{inbox.name}</span>
                <Count value={byInbox.get(inbox.id) ?? 0} />
              </button>
            ))}
          {SCREENS.map((screen) => (
            <NavRow
              key={screen.href}
              href={screen.href}
              label={$t(screen.label)}
              icon={screen.icon}
              active={pathname.startsWith(screen.href)}
              collapsed={collapsed}
            />
          ))}
        </div>

        <div className="mt-5 space-y-0.5">
          {collapsed ? (
            <Separator className="mb-2" />
          ) : (
            <div className="flex h-7 items-center gap-1.5 px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              <span className="flex-1">{$t('Paramétrage')}</span>
              <Hint label={$t('Ouvrir la base dans basedb')}>
                <a
                  href={basedbUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded px-1 normal-case tracking-normal hover:text-foreground"
                >
                  basedb
                  <ExternalLink className="size-3" />
                </a>
              </Hint>
            </div>
          )}
          {SETTINGS.map((screen) => (
            <NavRow
              key={screen.href}
              href={screen.href}
              label={$t(screen.label)}
              icon={screen.icon}
              active={pathname.startsWith(screen.href)}
              collapsed={collapsed}
            />
          ))}
        </div>
      </nav>

      <Separator />
      <div className="p-2">
        <UserMenu collapsed={collapsed} basedbUrl={basedbUrl} />
      </div>
    </aside>
  )
}

function Count({
  value,
  collapsed = false,
}: { readonly value: number; readonly collapsed?: boolean }) {
  if (value <= 0) return null
  return collapsed ? (
    <span className="absolute top-1.5 right-2 size-2 rounded-full bg-primary" />
  ) : (
    <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary tabular-nums">
      {value}
    </span>
  )
}

function NavRow({
  href,
  onClick,
  label,
  icon: Icon,
  active,
  collapsed,
  count = 0,
}: {
  readonly href?: string
  readonly onClick?: () => void
  readonly label: string
  readonly icon: LucideIcon
  readonly active: boolean
  readonly collapsed: boolean
  readonly count?: number
}) {
  const className = cn(
    'relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors hover:bg-sidebar-accent',
    active && 'bg-sidebar-accent font-medium',
    collapsed && 'h-9 justify-center px-0',
  )
  const content: ReactNode = (
    <>
      <Icon
        className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')}
      />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      <Count value={count} collapsed={collapsed} />
    </>
  )
  const row = href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  )
  return collapsed ? (
    <Hint label={label} side="right">
      {row}
    </Hint>
  ) : (
    row
  )
}
