'use client'

import { InboxGlyph } from '@/components/app/look'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { $t } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { cn } from '@/lib/utils'
import type { Conversation } from '@chat/contracts'
import { Check, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Moves a conversation: to another inbox, another team of its inbox, or both — with a
 * note for whoever picks it up. It goes back to their queue: it leaves its assignee.
 */
export function TransferDialog({
  conversation,
  open,
  onClose,
}: {
  readonly conversation: Conversation
  readonly open: boolean
  readonly onClose: () => void
}) {
  const directory = useInbox((s) => s.directory)
  const transfer = useInbox((s) => s.transfer)
  const [inboxId, setInboxId] = useState<string | null>(conversation.inboxId)
  const [teamId, setTeamId] = useState<string | null>(conversation.teamId)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Opened again: from where the conversation is now.
  useEffect(() => {
    if (!open) return
    setInboxId(conversation.inboxId)
    setTeamId(conversation.teamId)
    setNote('')
  }, [open, conversation.inboxId, conversation.teamId])

  const inbox = directory.inboxes.find((i) => i.id === inboxId) ?? null
  // The teams of the chosen inbox — every team when it names none.
  const teams = inbox && inbox.teams.length > 0 ? inbox.teams : directory.teams
  const moves = inboxId !== conversation.inboxId || teamId !== conversation.teamId

  function chooseInbox(id: string) {
    setInboxId(id)
    const next = directory.inboxes.find((i) => i.id === id)
    // Its default team, unless the current one answers there too.
    if (next && !next.teams.some((t) => t.id === teamId)) setTeamId(next.defaultTeamId)
  }

  async function submit() {
    setBusy(true)
    const done = await transfer(conversation.id, {
      ...(inboxId !== conversation.inboxId && inboxId !== null ? { inboxId } : {}),
      ...(teamId !== conversation.teamId || inboxId !== conversation.inboxId ? { teamId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    })
    setBusy(false)
    if (done) onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{$t('Transférer la conversation')}</DialogTitle>
          <DialogDescription>
            {$t(
              'Elle revient dans la file de l’équipe choisie, qui en est prévenue. Elle quitte la personne qui l’avait.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-foreground">{$t('Boîte de réception')}</Label>
          <div className="space-y-1.5">
            {directory.inboxes.map((option) => {
              const chosen = option.id === inboxId
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => chooseInbox(option.id)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                    chosen ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/50',
                  )}
                >
                  <span className="flex h-5 shrink-0 items-center">
                    <InboxGlyph look={option} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {option.name}
                      {option.id === conversation.inboxId && (
                        <span className="text-xs font-normal text-muted-foreground">
                          {$t('actuelle')}
                        </span>
                      )}
                    </span>
                    {option.description && (
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {chosen && <Check className="mt-0.5 size-4 text-primary" />}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-foreground">{$t('Équipe')}</Label>
          <div className="flex flex-wrap gap-1.5">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                aria-pressed={team.id === teamId}
                onClick={() => setTeamId(team.id)}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors',
                  team.id === teamId
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {team.id === teamId && <Check className="size-3" />}
                {team.name}
                {team.id === inbox?.defaultTeamId && (
                  <span className="text-muted-foreground">· {$t('par défaut')}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="transfer-note" className="text-foreground">
            {$t('Note pour l’équipe')}
          </Label>
          <Textarea
            id="transfer-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={$t('Facultatif : ce qu’il faut savoir pour reprendre.')}
            rows={3}
            maxLength={4000}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {$t('Annuler')}
          </Button>
          <Button
            size="sm"
            disabled={!moves || busy}
            onClick={() => void submit()}
            className="gap-1.5"
          >
            {busy && <LoaderCircle className="size-3.5 animate-spin" />}
            {$t('Transférer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
