'use client'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Hint } from '@/components/ui/tooltip'
import { $t, $tp, formatCount } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { cn } from '@/lib/utils'
import type { BulkAction, ConversationSummary } from '@chat/contracts'
import { ArrowRightLeft, CheckCheck, MailOpen, Tag, UserRoundPlus, X } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { AssignPicker } from './assign-picker'
import { SnoozeMenu } from './snooze-menu'
import { TagPicker } from './tag-picker'
import { TransferDialog } from './transfer-dialog'

/**
 * The conversations ticked in the list, acted on at once: resolved, given to someone,
 * tagged, moved, put on hold, read. Each goes through on its own — the server says which
 * were refused, and why. In place of the search, while some are ticked.
 */

/** A box to tick — basedb's: ticked, empty, or, for all of them, some. */
export function TickBox({
  state,
  label,
  onToggle,
  className,
}: {
  readonly state: boolean | 'some'
  readonly label: string
  /** The click itself: Shift ticks a range. */
  readonly onToggle: (event: MouseEvent) => void
  readonly className?: string
}) {
  return (
    <Checkbox
      checked={state === 'some' ? 'indeterminate' : state}
      aria-label={label}
      onClick={onToggle}
      className={cn('bg-background', className)}
    />
  )
}

/** The value all the ticked conversations share, or `null` when they differ. */
function shared<T>(
  rows: readonly ConversationSummary[],
  of: (s: ConversationSummary) => T,
): T | null {
  const [first, ...rest] = rows
  if (!first) return null
  const value = of(first)
  return rest.every((r) => of(r) === value) ? value : null
}

export function BulkBar({
  rows,
  all,
  onAll,
  onClear,
}: {
  /** The ticked conversations. */
  readonly rows: readonly ConversationSummary[]
  /** Whether every conversation listed is ticked: true, some, or none. */
  readonly all: boolean | 'some'
  readonly onAll: () => void
  readonly onClear: () => void
}) {
  const actOnMany = useInbox((s) => s.actOnMany)
  const [busy, setBusy] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [moving, setMoving] = useState(false)
  const ids = rows.map((r) => r.id)

  async function run(action: BulkAction): Promise<boolean> {
    setBusy(true)
    const result = await actOnMany(ids, action)
    setBusy(false)
    const done = (result?.done.length ?? 0) > 0
    if (done) onClear()
    return done
  }

  const tool = 'size-7 text-muted-foreground hover:text-foreground'
  return (
    // As tall as the tabs it stands in for; its box over the rows' boxes.
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-b bg-primary/5 pr-2 pl-[26px]">
      <TickBox
        state={all}
        label={all === true ? $t('Tout désélectionner') : $t('Tout sélectionner')}
        onToggle={all === true ? onClear : onAll}
        className="mr-2"
      />
      <Hint
        label={$tp(
          rows.length,
          '{count} conversation sélectionnée',
          '{count} conversations sélectionnées',
        )}
      >
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold tabular-nums"
          aria-live="polite"
        >
          <span className="sr-only">
            {$tp(
              rows.length,
              '{count} conversation sélectionnée',
              '{count} conversations sélectionnées',
            )}
          </span>
          <span aria-hidden="true">{formatCount(rows.length)}</span>
        </span>
      </Hint>

      <Hint label={$t('Résoudre')}>
        <Button
          variant="ghost"
          size="icon-sm"
          className={tool}
          disabled={busy}
          aria-label={$t('Résoudre')}
          onClick={() => void run({ type: 'resolve' })}
        >
          <CheckCheck />
        </Button>
      </Hint>

      <AssignPicker
        conversation={{
          id: '',
          // « Remettre dans la file » when one of them has someone.
          assigneeId: rows.some((r) => r.assigneeId !== null) ? 'some' : null,
          teamId: shared(rows, (r) => r.teamId),
        }}
        open={assigning}
        onOpenChange={setAssigning}
        hint={$t('Attribuer')}
        onAssign={(assigneeId) => void run({ type: 'assign', assigneeId })}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className={tool}
          disabled={busy}
          aria-label={$t('Attribuer')}
        >
          <UserRoundPlus />
        </Button>
      </AssignPicker>

      <TagPicker
        applied={[]}
        labelled={false}
        hint={$t('Étiqueter')}
        align="end"
        onPick={(label) => void run({ type: 'tag', label })}
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            className={tool}
            disabled={busy}
            aria-label={$t('Étiqueter')}
          >
            <Tag />
          </Button>
        }
      />

      <Hint label={$t('Transférer')}>
        <Button
          variant="ghost"
          size="icon-sm"
          className={tool}
          disabled={busy}
          aria-label={$t('Transférer')}
          onClick={() => setMoving(true)}
        >
          <ArrowRightLeft />
        </Button>
      </Hint>

      <SnoozeMenu
        conversationId=""
        variant="ghost"
        onSnooze={(until) => void run({ type: 'snooze', until })}
      />

      <Hint label={$t('Marquer comme lues')}>
        <Button
          variant="ghost"
          size="icon-sm"
          className={tool}
          disabled={busy}
          aria-label={$t('Marquer comme lues')}
          onClick={() => void run({ type: 'read' })}
        >
          <MailOpen />
        </Button>
      </Hint>

      <Hint label={$t('Annuler la sélection (Échap)')}>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(tool, 'ml-0.5')}
          aria-label={$t('Annuler la sélection')}
          onClick={onClear}
        >
          <X />
        </Button>
      </Hint>

      <TransferDialog
        conversation={{
          id: '',
          inboxId: shared(rows, (r) => r.inboxId),
          teamId: shared(rows, (r) => r.teamId),
        }}
        count={rows.length}
        open={moving}
        onClose={() => setMoving(false)}
        onTransfer={(body) => run({ type: 'transfer', ...body })}
      />
    </div>
  )
}
