'use client'

import { CopyButton } from '@/components/app/copy-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { $t } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { Link2, LoaderCircle } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { codeOf } from '../kit/data'

/**
 * An action on an account — an invitation, a new password (D19) — in two steps: the form,
 * then the link, shown this once, where the person chooses their password.
 */
export function AccountDialog({
  title,
  description,
  action,
  run,
  ready = true,
  children,
  onClose,
  done,
}: {
  readonly title: string
  readonly description: string
  /** The button that runs it: « Inviter », « Créer le lien »… */
  readonly action: string
  /** The link to hand over. */
  readonly run: () => Promise<string>
  readonly ready?: boolean
  readonly children?: ReactNode
  readonly onClose: () => void
  /** What the last step says, besides the link. */
  readonly done: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)

  async function attempt() {
    setBusy(true)
    setError(null)
    try {
      setLink(await run())
    } catch (failure) {
      setError(messageFor(codeOf(failure)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          // A grid's child: without it, a long link would widen the dialog.
          className="min-w-0"
          onSubmit={(event) => {
            event.preventDefault()
            if (link === null) void attempt()
            else onClose()
          }}
        >
          <div className="space-y-4 px-6 pb-5">
            {link === null && children}

            {link !== null && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    <Link2 className="size-3.5" />
                    {$t('Lien à transmettre')}
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-2 pr-2 pl-3">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs">{link}</code>
                    <CopyButton text={link} label={$t('Copier le lien')}>
                      {$t('Copier')}
                    </CopyButton>
                  </div>
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {$t(
                      'Il ne s’affichera plus, et vaut sept jours, une seule fois : transmettez-le maintenant.',
                    )}
                  </p>
                </div>
                {done}
              </div>
            )}

            {error && <p className="animate-shake text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="border-t px-6 py-3">
            {link === null && (
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                {$t('Annuler')}
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              className="gap-1.5"
              disabled={busy || (link === null && !ready)}
            >
              {busy && <LoaderCircle className="size-3.5 animate-spin" />}
              {link === null ? action : $t('Terminé')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
