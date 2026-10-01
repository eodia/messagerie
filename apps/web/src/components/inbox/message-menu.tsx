'use client'

import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
import { plainOf } from '@/lib/rich-text'
import { useInbox } from '@/lib/store/inbox'
import type { Agent, Message } from '@chat/contracts'
import { Copy, EyeOff, Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { afterMenus } from './assign-picker'

/** What can be done to what was said: a visitor's message, an answer, a note. */
export const hasMenu = (message: Message): boolean =>
  message.kind === 'visitor' ||
  message.kind === 'agent' ||
  message.kind === 'ai' ||
  message.kind === 'note'

/**
 * Whether the reader may delete a message for everyone — their own reply or note; a
 * supervisor, any message. The server says the same (`mayDeleteForAll`).
 */
export function mayDeleteForAll(message: Message, me: Agent | null): boolean {
  if (me === null || message.deleted || !hasMenu(message)) return false
  if (me.role === 'supervisor') return true
  return (message.kind === 'agent' || message.kind === 'note') && message.authorId === me.id
}

/**
 * A message's right click, as in a messaging app: copy its words, delete it for oneself —
 * gone from one's own thread — or, asked once more, for everyone.
 */
export function MessageMenu({
  conversationId,
  message,
  children,
}: {
  readonly conversationId: string
  readonly message: Message
  readonly children: ReactNode
}) {
  const me = useInbox((s) => s.me)
  const [confirming, setConfirming] = useState(false)
  const { hideMessage, deleteMessage } = useInbox.getState()
  const body = 'body' in message && !message.deleted ? message.body : ''
  const forAll = mayDeleteForAll(message, me)

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>{children}</div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {body !== '' && (
            <>
              <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(plainOf(body))}>
                <Copy />
                {$t('Copier le texte')}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onSelect={() => void hideMessage(conversationId, message.id)}>
            <EyeOff />
            {$t('Supprimer pour moi')}
          </ContextMenuItem>
          {forAll && (
            <ContextMenuItem
              variant="destructive"
              onSelect={() => afterMenus(() => setConfirming(true))}
            >
              <Trash2 />
              {$t('Supprimer pour tout le monde')}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{$t('Supprimer ce message pour tout le monde ?')}</DialogTitle>
            <DialogDescription>
              {message.kind === 'note'
                ? $t('L’équipe verra « Ce message a été supprimé » à sa place.')
                : $t(
                    'Le visiteur et l’équipe verront « Ce message a été supprimé » à sa place, et l’IA ne le lira plus. Ses fichiers sont effacés.',
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {$t('Annuler')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false)
                void deleteMessage(conversationId, message.id)
              }}
            >
              <Trash2 />
              {$t('Supprimer pour tout le monde')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
