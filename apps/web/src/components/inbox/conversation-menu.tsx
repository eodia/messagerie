'use client'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { conversationsAddress } from '@/lib/address'
import { api } from '@/lib/api'
import { $t } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { snoozeChoices, wakeLabel } from '@/lib/time'
import type { ConversationSummary } from '@chat/contracts'
import {
  AlarmClock,
  ArrowRightLeft,
  CheckCheck,
  ExternalLink,
  Link2,
  MailOpen,
  SquareCheck,
  UserRoundCheck,
  UserRoundPlus,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { afterMenus } from './assign-picker'

/**
 * A conversation of the list, right-clicked: what its thread offers, without opening it —
 * to read it elsewhere, take it, give it, move it, put it on hold, resolve it, or tick it
 * for the bar that acts on many.
 */
export function ConversationMenu({
  summary,
  onTick,
  children,
}: {
  readonly summary: ConversationSummary
  /** Ticks it, with the others: the bar that acts on many. */
  readonly onTick: () => void
  readonly children: ReactNode
}) {
  const me = useInbox((s) => s.me)
  const inboxes = useInbox((s) => s.directory.inboxes)
  const { select, ask, assign, resolve, snooze } = useInbox.getState()
  const id = summary.id
  const address = conversationsAddress(
    summary.inboxId,
    'all',
    { id, name: summary.contact.name },
    inboxes,
  )
  const now = new Date()
  const open = summary.status !== 'resolved'
  // On hold: only a conversation agents answer — not the AI's, not a resolved one.
  const holdable = summary.status === 'open' || summary.status === 'pending'
  /** Opens it, then the thread's own dialog: whom to give it to, where to move it. */
  const openWith = (dialog: 'assign' | 'transfer') => {
    select(id)
    afterMenus(() => ask(dialog))
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem onSelect={() => window.open(address, '_blank', 'noopener')}>
          <ExternalLink />
          {$t('Ouvrir dans un nouvel onglet')}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            void navigator.clipboard.writeText(new URL(address, window.location.origin).href)
          }
        >
          <Link2 />
          {$t('Copier le lien')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {summary.unread && (
          <ContextMenuItem onSelect={() => void api.markRead(id).catch(() => {})}>
            <MailOpen />
            {$t('Marquer comme lue')}
          </ContextMenuItem>
        )}
        {me && summary.assigneeId !== me.id && (
          <ContextMenuItem onSelect={() => void assign(id, me.id)}>
            <UserRoundCheck />
            {$t('Me l’attribuer')}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => openWith('assign')}>
          <UserRoundPlus />
          {$t('Attribuer…')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => openWith('transfer')}>
          <ArrowRightLeft />
          {$t('Transférer…')}
        </ContextMenuItem>
        {holdable && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <AlarmClock />
              {$t('Mettre en attente')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-56">
              {snoozeChoices(now).map((choice) => (
                <ContextMenuItem
                  key={choice.key}
                  onSelect={() => void snooze(id, choice.until.toISOString())}
                >
                  {choice.label}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {wakeLabel(choice.until.toISOString(), now)}
                  </span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {open && (
          <ContextMenuItem onSelect={() => void resolve(id)}>
            <CheckCheck />
            {$t('Résoudre')}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onTick}>
          <SquareCheck />
          {$t('Sélectionner')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
