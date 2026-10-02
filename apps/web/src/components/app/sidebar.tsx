'use client'

import { InboxGlyph } from '@/components/app/look'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Hint } from '@/components/ui/tooltip'
import { $t, msg } from '@/lib/i18n'
import { useInbox, waitingByInbox, waitingHere } from '@/lib/store/inbox'
import { useSidebar } from '@/lib/store/sidebar'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  ChartColumn,
  ChevronDown,
  ChevronsUpDown,
  Globe,
  Headset,
  Inbox,
  KeyRound,
  LoaderCircle,
  type LucideIcon,
  MessageSquareText,
  MessagesSquare,
  Palette,
  Settings,
  ShieldAlert,
  UsersRound,
  Workflow,
  Wrench,
} from 'lucide-react'
import Link, { useLinkStatus } from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { SiteMenu } from './site-menu'
import { UserMenu } from './user-menu'

interface Screen {
  readonly href: string
  readonly label: string
  readonly icon: LucideIcon
}

/** After the conversations and their inboxes: the screens an agent works in. */
const SCREENS: readonly Screen[] = [
  { href: '/contacts', label: msg('Contacts'), icon: UsersRound },
  { href: '/connaissance', label: msg('Connaissances'), icon: BookOpen },
  { href: '/tableaux-de-bord', label: msg('Tableaux de bord'), icon: ChartColumn },
]

/**
 * What a supervisor sets up — « Administration », folded at the foot of the sidebar, shown
 * to supervisors alone. The data lives in the chat's own tables (D19).
 */
const SETTINGS: readonly Screen[] = [
  { href: '/parametrage/boites', label: msg('Boîtes de réception'), icon: Inbox },
  { href: '/parametrage/equipes', label: msg('Équipes et conseillers'), icon: Headset },
  { href: '/parametrage/sites', label: msg('Sites et horaires'), icon: Globe },
  {
    href: '/parametrage/reponses',
    label: msg('Réponses types et étiquettes'),
    icon: MessageSquareText,
  },
  { href: '/parametrage/garde-fous', label: msg('Garde-fous'), icon: ShieldAlert },
  { href: '/outils', label: msg('Outils IA'), icon: Wrench },
  { href: '/automatisations', label: msg('Automatisations'), icon: Workflow },
  { href: '/widget', label: msg('Widget'), icon: Palette },
  { href: '/parametrage/api', label: msg('API et MCP'), icon: KeyRound },
]

export function Sidebar() {
  const collapsed = useSidebar((s) => s.collapsed)
  const pathname = usePathname()
  const waiting = useInbox(waitingHere)
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
        <SiteMenu collapsed={collapsed} />
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
      </nav>

      <Administration collapsed={collapsed} pathname={pathname} />
      <Separator />
      <div className="p-2">
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  )
}

/**
 * « Administration »: the screens a supervisor sets up, folded like an accordion — open
 * by itself on arrival at one of them, and as left otherwise. Reduced to its icon, the
 * sidebar lists them in a menu. An agent sees none of it: the server refuses them its
 * writes, and the reading of its tables.
 */
function Administration({
  collapsed,
  pathname,
}: {
  readonly collapsed: boolean
  readonly pathname: string
}) {
  const supervisor = useInbox((s) => s.me?.role === 'supervisor')
  const open = useSidebar((s) => s.adminOpen)
  const setOpen = useSidebar((s) => s.setAdminOpen)
  const here = SETTINGS.some((screen) => pathname.startsWith(screen.href))

  useEffect(() => {
    if (here) setOpen(true)
  }, [here, setOpen])

  if (!supervisor) return null

  if (collapsed) {
    return (
      <div className="border-t p-2">
        <DropdownMenu>
          <Hint label={$t('Administration')} side="right">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={$t('Administration')}
                className={cn(
                  'flex h-9 w-full items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent',
                  here && 'bg-sidebar-accent',
                )}
              >
                <Settings
                  className={cn('size-4', here ? 'text-foreground' : 'text-muted-foreground')}
                />
              </button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent side="right" align="end" className="w-64">
            <DropdownMenuLabel className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {$t('Administration')}
            </DropdownMenuLabel>
            {SETTINGS.map((screen) => (
              <DropdownMenuItem key={screen.href} asChild>
                <Link href={screen.href}>
                  <screen.icon />
                  {$t(screen.label)}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <div className="border-t px-2 py-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors hover:bg-sidebar-accent',
          here && !open && 'bg-sidebar-accent font-medium',
        )}
      >
        <Settings
          className={cn('size-4 shrink-0', here ? 'text-foreground' : 'text-muted-foreground')}
        />
        <span className="min-w-0 flex-1 truncate">{$t('Administration')}</span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            inert={!open}
            className="max-h-[45vh] space-y-0.5 overflow-y-auto pt-0.5 scroll-discret"
          >
            {SETTINGS.map((screen) => (
              <NavRow
                key={screen.href}
                href={screen.href}
                label={$t(screen.label)}
                icon={screen.icon}
                active={pathname.startsWith(screen.href)}
                collapsed={false}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
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

/**
 * A row's insides. Inside a link, it shows the click taken at once — the row selected, a
 * spinner once it lasts — while the screen is on its way: in development, a screen being
 * compiled takes seconds, and a click that shows nothing is a click made again.
 */
function NavContent({
  label,
  icon: Icon,
  active,
  collapsed,
  count,
}: {
  readonly label: string
  readonly icon: LucideIcon
  readonly active: boolean
  readonly collapsed: boolean
  readonly count: number
}) {
  const { pending } = useLinkStatus()
  return (
    <>
      {pending && <span aria-hidden className="absolute inset-0 rounded-lg bg-sidebar-accent" />}
      <Icon
        className={cn(
          'relative size-4 shrink-0',
          active || pending ? 'text-foreground' : 'text-muted-foreground',
        )}
      />
      {!collapsed && (
        <span className={cn('relative min-w-0 flex-1 truncate', pending && 'font-medium')}>
          {label}
        </span>
      )}
      {pending && !collapsed ? (
        <span aria-hidden className="nav-pending relative">
          <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
        </span>
      ) : (
        <Count value={count} collapsed={collapsed} />
      )}
    </>
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
  const row = href ? (
    <Link href={href} className={className}>
      <NavContent label={label} icon={Icon} active={active} collapsed={collapsed} count={count} />
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      <NavContent label={label} icon={Icon} active={active} collapsed={collapsed} count={count} />
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
