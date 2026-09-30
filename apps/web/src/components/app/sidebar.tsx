'use client'

import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Hint } from '@/components/ui/tooltip'
import { $t, msg } from '@/lib/i18n'
import { PRODUCT_NAME } from '@/lib/product'
import { useInbox, waitingCount } from '@/lib/store/inbox'
import { useSidebar } from '@/lib/store/sidebar'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  ChartColumn,
  ChevronsUpDown,
  ExternalLink,
  Globe,
  Headset,
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
import { UserMenu } from './user-menu'

interface Screen {
  readonly href: string
  readonly label: string
  readonly icon: LucideIcon
}

const SCREENS: readonly Screen[] = [
  { href: '/conversations', label: msg('Conversations'), icon: MessagesSquare },
  { href: '/contacts', label: msg('Contacts'), icon: UsersRound },
  { href: '/connaissance', label: msg('Connaissance'), icon: BookOpen },
  { href: '/statistiques', label: msg('Statistiques'), icon: ChartColumn },
  { href: '/outils', label: msg('Outils IA'), icon: Wrench },
  { href: '/widget', label: msg('Widget'), icon: Palette },
]

/**
 * What is set up in basedb, not here — the « Messagerie » base
 * (docs/architecture/00-decisions-structurantes.md, D1). Each entry opens basedb.
 */
const SETTINGS: readonly { readonly label: string; readonly icon: LucideIcon }[] = [
  { label: msg('Sites et horaires'), icon: Globe },
  { label: msg('Équipes et conseillers'), icon: Headset },
  { label: msg('Réponses types'), icon: MessageSquareText },
  { label: msg('Garde-fous et outils IA'), icon: ShieldAlert },
]

export function Sidebar({ basedbUrl }: { readonly basedbUrl: string }) {
  const collapsed = useSidebar((s) => s.collapsed)
  const pathname = usePathname()
  const waiting = useInbox(waitingCount)

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

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1 scroll-discret">
        {SCREENS.map((screen) => (
          <NavRow
            key={screen.href}
            screen={screen}
            active={pathname.startsWith(screen.href)}
            collapsed={collapsed}
            count={screen.href === '/conversations' ? waiting : 0}
          />
        ))}
      </nav>

      <div className="p-2">
        {collapsed ? (
          <Hint label={$t('Paramétrage dans basedb')} side="right">
            <a
              href={basedbUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent"
            >
              <ExternalLink className="size-4" />
            </a>
          </Hint>
        ) : (
          <Card className="p-1.5">
            <div className="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {$t('Paramétrage')}
              <span className="text-muted-foreground/60">·</span>
              <span className="normal-case tracking-normal">basedb</span>
            </div>
            {SETTINGS.map(({ label, icon: Icon }) => (
              <a
                key={label}
                href={basedbUrl}
                target="_blank"
                rel="noreferrer"
                className="group flex h-8 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors hover:bg-sidebar-accent"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{$t(label)}</span>
                <ExternalLink className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100" />
              </a>
            ))}
          </Card>
        )}
      </div>

      <Separator />
      <div className="p-2">
        <UserMenu collapsed={collapsed} basedbUrl={basedbUrl} />
      </div>
    </aside>
  )
}

function NavRow({
  screen,
  active,
  collapsed,
  count,
}: {
  readonly screen: Screen
  readonly active: boolean
  readonly collapsed: boolean
  readonly count: number
}) {
  const Icon = screen.icon
  const row = (
    <Link
      href={screen.href}
      className={cn(
        'relative flex h-8 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors hover:bg-sidebar-accent',
        active && 'bg-sidebar-accent font-medium',
        collapsed && 'h-9 justify-center px-0',
      )}
    >
      <Icon
        className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')}
      />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{$t(screen.label)}</span>}
      {count > 0 &&
        (collapsed ? (
          <span className="absolute top-1.5 right-2 size-2 rounded-full bg-primary" />
        ) : (
          <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary tabular-nums">
            {count}
          </span>
        ))}
    </Link>
  )
  return collapsed ? (
    <Hint label={$t(screen.label)} side="right">
      {row}
    </Hint>
  ) : (
    row
  )
}
