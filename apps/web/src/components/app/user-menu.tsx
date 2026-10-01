'use client'

import { initials } from '@/components/inbox/labels'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usesBasedb } from '@/lib/basedb-session'
import { $t } from '@/lib/i18n'
import { useAlertSettings } from '@/lib/store/alert-settings'
import { useInbox } from '@/lib/store/inbox'
import { useSession } from '@/lib/store/session'
import { type ThemePreference, useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { BellRing, ChevronsUpDown, Database, LogOut, Volume2 } from 'lucide-react'
import { useState } from 'react'

type Presence = 'available' | 'away'

/**
 * Who is signed in — with a basedb account (D4) — whether they take new conversations,
 * and the theme. Opens upwards, as basedb's does.
 */
export function UserMenu({
  collapsed,
  basedbUrl,
}: {
  readonly collapsed: boolean
  readonly basedbUrl: string
}) {
  const me = useInbox((s) => s.me)
  const { sound, desktop, permission, setSound, setDesktop } = useAlertSettings()
  const preference = useTheme((s) => s.preference)
  const setPreference = useTheme((s) => s.setPreference)
  const [presence, setPresence] = useState<Presence>('available')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent',
            collapsed && 'justify-center',
          )}
        >
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {me ? initials(me.name) : ''}
            <span
              className={cn(
                'absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-sidebar',
                presence === 'available' ? 'bg-emerald-500' : 'bg-amber-500',
              )}
            />
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{me?.name ?? '…'}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {me?.role === 'supervisor' ? $t('Superviseur') : $t('Conseiller')}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel>{$t('Disponibilité')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={presence}
          onValueChange={(value) => setPresence(value as Presence)}
        >
          <DropdownMenuRadioItem value="available">
            <span className="size-2 rounded-full bg-emerald-500" />
            {$t('Disponible')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="away">
            <span className="size-2 rounded-full bg-amber-500" />
            {$t('Absent : aucune nouvelle conversation')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{$t('Alertes')}</DropdownMenuLabel>
        {/* A toggle keeps the menu open: the agent sees what they just changed. */}
        <DropdownMenuCheckboxItem
          checked={sound}
          onCheckedChange={(on) => setSound(on === true)}
          onSelect={(event) => event.preventDefault()}
        >
          <Volume2 />
          {$t('Son à chaque nouveau message')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={desktop}
          disabled={permission === 'denied' || permission === 'unsupported'}
          onCheckedChange={(on) => void setDesktop(on === true)}
          onSelect={(event) => event.preventDefault()}
        >
          <BellRing />
          {permission === 'denied'
            ? $t('Notifications bloquées par le navigateur')
            : $t('Notifications du bureau')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{$t('Thème')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => setPreference(value as ThemePreference)}
        >
          <DropdownMenuRadioItem value="system">{$t('Suivre le système')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">{$t('Clair')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{$t('Sombre')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={basedbUrl} target="_blank" rel="noreferrer">
            <Database />
            {$t('Ouvrir basedb')}
          </a>
        </DropdownMenuItem>
        {usesBasedb() && (
          <DropdownMenuItem onSelect={() => void useSession.getState().signOut()}>
            <LogOut />
            {$t('Se déconnecter')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
