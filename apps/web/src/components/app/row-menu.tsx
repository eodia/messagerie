'use client'

import { afterMenus } from '@/components/inbox/assign-picker'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { $t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { LoaderCircle, Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'

/**
 * A row of a list, deleted from its context menu — a right click, as the messages of the
 * thread: « Supprimer », then a dialog that says what goes, and asks, when there is a way
 * to choose, how. The choice first offered is the one that keeps the most.
 */

export interface DeleteChoice {
  readonly id: string
  readonly label: string
  readonly description?: string
}

export function RowMenu({
  children,
  title,
  description,
  choices,
  disabled = false,
  onDelete,
}: {
  /** The row: what the right click opens on. */
  readonly children: ReactNode
  /** « Supprimer la catégorie « Contrat » ? » */
  readonly title: string
  readonly description?: string
  /** Ways to delete, one to pick; the first is chosen to begin with. */
  readonly choices?: readonly DeleteChoice[]
  /** No menu: the reader may not delete it. */
  readonly disabled?: boolean
  /** Deletes it, the way chosen — what the dialog waits for. */
  readonly onDelete: (choice: string | null) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<string | null>(choices?.[0]?.id ?? null)
  const [busy, setBusy] = useState(false)
  if (disabled) return <>{children}</>

  const confirm = async () => {
    setBusy(true)
    try {
      await onDelete(choice)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            variant="destructive"
            onSelect={() =>
              afterMenus(() => {
                setChoice(choices?.[0]?.id ?? null)
                setOpen(true)
              })
            }
          >
            <Trash2 />
            {$t('Supprimer')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {choices && choices.length > 0 && (
            <fieldset className="grid gap-2">
              <legend className="sr-only">{title}</legend>
              {choices.map((option) => {
                const on = option.id === choice
                return (
                  <label
                    key={option.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/25',
                      on ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/50',
                    )}
                  >
                    <input
                      type="radio"
                      name="delete-choice"
                      value={option.id}
                      checked={on}
                      onChange={() => setChoice(option.id)}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{option.label}</span>
                      {option.description && (
                        <span className="block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </label>
                )
              })}
            </fieldset>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              {$t('Annuler')}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
              {$t('Supprimer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
