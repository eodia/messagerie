'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Hint } from '@/components/ui/tooltip'
import { $t } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { snoozeChoices, wakeLabel } from '@/lib/time'
import { AlarmClock, CalendarClock } from 'lucide-react'
import { useState } from 'react'

/** `2026-10-05T09:00` — a date for `<input type="datetime-local">`, in local time. */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * « Mettre en attente »: the conversation leaves the queue until a time,
 * and comes back by itself, or sooner when the visitor writes. A few usual times, each
 * with the hour it means; or a date of one's own.
 */
export function SnoozeMenu({
  conversationId,
  onSnooze,
  variant = 'outline',
}: {
  readonly conversationId: string
  /** What choosing a time does, instead of putting `conversationId` on hold. */
  readonly onSnooze?: (until: string) => void
  readonly variant?: 'outline' | 'ghost'
}) {
  const snoozeOne = useInbox((s) => s.snooze)
  const snooze = (id: string, until: string) =>
    onSnooze ? onSnooze(until) : void snoozeOne(id, until)
  const [choosing, setChoosing] = useState(false)
  const now = new Date()
  const choices = snoozeChoices(now)
  const [chosen, setChosen] = useState(() => localInput(choices[1]?.until ?? now))
  const until = new Date(chosen)
  const valid = !Number.isNaN(until.getTime()) && until.getTime() > Date.now() + 60_000

  return (
    <>
      <DropdownMenu>
        <Hint label={$t('Mettre en attente')}>
          <DropdownMenuTrigger asChild>
            <Button variant={variant} size="icon-sm" aria-label={$t('Mettre en attente')}>
              <AlarmClock className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {$t('En attente jusqu’à…')}
          </DropdownMenuLabel>
          {choices.map((choice) => (
            <DropdownMenuItem
              key={choice.key}
              onSelect={() => snooze(conversationId, choice.until.toISOString())}
            >
              {choice.label}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {wakeLabel(choice.until.toISOString(), now)}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setChoosing(true)}>
            <CalendarClock />
            {$t('Choisir une date…')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={choosing} onOpenChange={setChoosing}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{$t('Mettre en attente')}</DialogTitle>
            <DialogDescription>
              {$t(
                'La conversation quitte la file et revient à cette heure — plus tôt si le visiteur écrit.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="snooze-until">{$t('Jusqu’au')}</Label>
            <Input
              id="snooze-until"
              type="datetime-local"
              value={chosen}
              min={localInput(now)}
              onChange={(event) => setChosen(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChoosing(false)}>
              {$t('Annuler')}
            </Button>
            <Button
              disabled={!valid}
              onClick={() => {
                setChoosing(false)
                snooze(conversationId, until.toISOString())
              }}
            >
              {$t('Mettre en attente')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
