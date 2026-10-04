'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Hint } from '@/components/ui/tooltip'
import { $t } from '@/lib/i18n'
import { PRODUCT_NAME } from '@/lib/product'
import { useInbox, waitingBySite, waitingCount } from '@/lib/store/inbox'
import { cn } from '@/lib/utils'
import { Check, ChevronsUpDown, Globe, MessagesSquare, Settings2 } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { SiteLogo } from './site-logo'

/**
 * The site switcher, top of the sidebar — basedb's project switcher, for the sites. It
 * offers the sites whose conversations the reader sees (D12), and narrows the screens to
 * the one chosen: the conversations and their counts, the contacts, the articles, the
 * counters. A view, not a right; the choice is this browser's.
 */
export function SiteMenu({ collapsed }: { readonly collapsed: boolean }) {
  const sites = useInbox((s) => s.directory.sites)
  const chosen = useInbox((s) => s.directory.sites.find((site) => site.id === s.site) ?? null)
  const supervisor = useInbox((s) => s.me?.role === 'supervisor')
  const bySite = useInbox(useShallow(waitingBySite))
  const waiting = useInbox(waitingCount)
  const { showSite } = useInbox.getState()

  // One site, or none: nothing to choose — the menu says which it is.
  const choosing = sites.length > 1
  // The site the screens show: its logo stands for it; for all of them, the product's.
  const shown = chosen ?? (sites.length === 1 ? (sites[0] ?? null) : null)
  const label = chosen?.name ?? (sites.length === 1 ? sites[0]?.name : null) ?? $t('Tous les sites')
  // A site chosen, another one waiting: the trigger says so.
  const elsewhere = chosen !== null && waiting > (bySite.get(chosen.id) ?? 0)

  const look = cn(
    'flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left',
    collapsed && 'justify-center',
  )
  const face = (
    <>
      {shown ? (
        <SiteLogo site={shown} className="size-9 rounded-lg p-0.5 text-sm ring-1 ring-border" />
      ) : (
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/10 ring-inset">
          <MessagesSquare
            className="size-4.5"
            style={{ color: 'color-mix(in oklab, var(--primary) 65%, var(--foreground))' }}
          />
        </span>
      )}
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{PRODUCT_NAME}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="truncate">{label}</span>
              {elsewhere && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
            </span>
          </span>
          {choosing && <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />}
        </>
      )}
    </>
  )

  // Nothing to choose: the same face, which does not pretend to be a button.
  if (!choosing) {
    const still = (
      <div className={look} aria-label={collapsed ? label : undefined}>
        {face}
      </div>
    )
    return collapsed ? (
      <Hint label={label} side="right">
        {still}
      </Hint>
    ) : (
      still
    )
  }

  const trigger = (
    <button
      type="button"
      aria-label={collapsed ? label : undefined}
      className={cn(
        look,
        'transition-colors hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent',
      )}
    >
      {face}
    </button>
  )

  return (
    <DropdownMenu>
      {collapsed ? (
        <Hint label={label} side="right">
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        </Hint>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent side={collapsed ? 'right' : 'bottom'} align="start" className="w-64">
        <DropdownMenuLabel>{$t('Sites')}</DropdownMenuLabel>
        <SiteItem
          label={$t('Tous les sites')}
          count={waiting}
          on={chosen === null}
          onSelect={() => showSite(null)}
        >
          <Globe className="size-4 text-muted-foreground" />
        </SiteItem>
        {sites.map((site) => (
          <SiteItem
            key={site.id}
            label={site.name}
            count={bySite.get(site.id) ?? 0}
            on={chosen?.id === site.id}
            onSelect={() => showSite(site.id)}
          >
            <SiteLogo site={site} className="size-4 rounded-[4px] text-[9px]" />
          </SiteItem>
        ))}
        {supervisor && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/parametrage/sites">
                <Settings2 className="size-4" />
                {$t('Sites et horaires')}
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SiteItem({
  label,
  count,
  on,
  onSelect,
  children,
}: {
  readonly label: string
  readonly count: number
  readonly on: boolean
  readonly onSelect: () => void
  readonly children: ReactNode
}) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      {children}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && (
        <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary tabular-nums">
          {count}
        </span>
      )}
      {on && <Check className="size-4 text-primary" />}
    </DropdownMenuItem>
  )
}
