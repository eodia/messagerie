'use client'

import { Chip } from '@/components/app/chip'
import { InboxGlyph } from '@/components/app/look'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Hint } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { $t } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { THREAD_MIN } from '@/lib/store/panels'
import { dayLabel } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { Conversation, Feedback, Message } from '@chat/contracts'
import {
  BookmarkPlus,
  ChevronRight,
  CircleCheck,
  Ellipsis,
  Forward,
  Hand,
  MapPin,
  PanelRight,
  ShieldCheck,
  Undo2,
  UserRoundPlus,
} from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { AssignPicker, afterMenus } from './assign-picker'
import { Composer } from './composer'
import { ContactAvatar, StateChip } from './labels'
import {
  AgentBubble,
  AiAnswer,
  AiTyping,
  EventLine,
  HandoffCard,
  NoteCard,
  VisitorBubble,
  VisitorTyping,
} from './messages'
import { TransferDialog } from './transfer-dialog'

function dayOf(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function daySeparator(iso: string, now: Date): string {
  const key = dayOf(iso)
  if (key === dayOf(now.toISOString())) return $t('Aujourd’hui')
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (key === dayOf(yesterday.toISOString())) return $t('Hier')
  return dayLabel(iso)
}

export function Thread({
  conversation,
  detailsOpen,
  onToggleDetails,
}: {
  readonly conversation: Conversation
  readonly detailsOpen: boolean
  readonly onToggleDetails: () => void
}) {
  const now = useInbox((s) => s.now)
  const directory = useInbox((s) => s.directory)
  const [transferring, setTransferring] = useState(false)
  const [assigning, setAssigning] = useState(false)
  // A dialog asked from the palette: opened here, once whatever asked has closed.
  const asked = useInbox((s) => s.asked)
  useEffect(() => {
    if (asked === null) return
    useInbox.getState().ask(null)
    const open = asked === 'assign' ? () => setAssigning(true) : () => setTransferring(true)
    setTimeout(open, 60)
  }, [asked])
  const { takeOver, resolve, assign, giveFeedback, setDraft } = useInbox.getState()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { scroller, content } = useStickToBottom(conversation.id)
  const { contact, messages, status } = conversation

  function feedback(message: Message, value: Feedback) {
    if (message.kind !== 'ai') return
    // A second click on the verdict given withdraws it.
    void giveFeedback(conversation.id, message.id, message.feedback === value ? null : value)
    // Correcting an answer starts from it: its text goes to the field, to be reworked.
    if (value === 'edited' && message.feedback !== 'edited') {
      setDraft(conversation.id, message.body)
      inputRef.current?.focus()
    }
  }

  const code = contact.attributes.find((a) => a.kind === 'code' && a.label.includes('contrat'))
  const handedOff = messages.some((m) => m.kind === 'handoff')
  const last = messages[messages.length - 1]
  const aiWriting = status === 'ai' && last !== undefined && last.kind !== 'ai'
  const visitorWriting = useInbox((s) => s.typing[conversation.id] === true)
  const inbox = directory.inboxes.find((i) => i.id === conversation.inboxId)
  const team = directory.teams.find((t) => t.id === conversation.teamId)

  return (
    <section
      className="flex flex-1 flex-col bg-surface"
      // The room the panes beside it leave, however wide they were made; in a narrow window,
      // a share of it rather than more than there is.
      style={{ minWidth: `min(${THREAD_MIN}px, 40%)` }}
    >
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b bg-background px-5 py-2">
        <ContactAvatar name={contact.name} online={status !== 'resolved'} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <h2 className="min-w-[5rem] truncate text-sm font-semibold">{contact.name}</h2>
            {contact.identified ? (
              <Hint label={$t('Identité signée par le site : ce visiteur est bien connecté.')}>
                <span className="shrink-0">
                  <Chip tint="emerald">
                    <ShieldCheck />
                    <span className="hidden 2xl:inline">{$t('Identifié')}</span>
                  </Chip>
                </span>
              </Hint>
            ) : (
              <span className="shrink-0">
                <Chip tint="zinc">{$t('Anonyme')}</Chip>
              </span>
            )}
            {/* The list says it too: in a narrow thread, the name keeps the room. */}
            <span className="hidden shrink-0 2xl:inline-flex">
              <StateChip conversation={{ ...conversation, handedOff }} />
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
            {(inbox || team) && (
              <Hint label={$t('Boîte de réception et équipe')}>
                <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                  {inbox && <InboxGlyph look={inbox} className="size-3" />}
                  {inbox?.name}
                  {inbox && team && <ChevronRight className="size-3" />}
                  {team?.name}
                </span>
              </Hint>
            )}
            {contact.email && <span className="truncate">{contact.email}</span>}
            {code && <span className="font-mono">{code.value}</span>}
            {contact.location && (
              <span className="hidden items-center gap-1 whitespace-nowrap 2xl:inline-flex">
                <MapPin className="size-3" />
                {contact.location}
              </span>
            )}
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {status === 'ai' ? (
            <Button size="sm" onClick={() => void takeOver(conversation.id)}>
              <Hand />
              {$t('Reprendre la main')}
            </Button>
          ) : status !== 'resolved' ? (
            <Button size="sm" variant="outline" onClick={() => void resolve(conversation.id)}>
              <CircleCheck />
              {$t('Résoudre')}
            </Button>
          ) : null}
          <AssignPicker
            conversation={conversation}
            open={assigning}
            onOpenChange={setAssigning}
            hint={$t('Affecter à un conseiller')}
          >
            <Button variant="outline" size="icon-sm" aria-label={$t('Affecter à un conseiller')}>
              <UserRoundPlus className="text-muted-foreground" />
            </Button>
          </AssignPicker>
          {directory.inboxes.length > 0 && (
            <Hint label={$t('Transférer à une autre boîte ou une autre équipe')}>
              <Button variant="outline" size="icon-sm" onClick={() => setTransferring(true)}>
                <Forward className="text-muted-foreground" />
              </Button>
            </Hint>
          )}
          <DropdownMenu>
            <Hint label={$t('Plus d’actions')}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <Ellipsis className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={() => afterMenus(() => setAssigning(true))}>
                <UserRoundPlus />
                {$t('Affecter à…')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={conversation.assigneeId === null}
                onSelect={() => void assign(conversation.id, null)}
              >
                <Undo2 />
                {$t('Remettre dans la file')}
              </DropdownMenuItem>
              {directory.inboxes.length > 0 && (
                <DropdownMenuItem onSelect={() => setTransferring(true)}>
                  <Forward />
                  {$t('Transférer…')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={status !== 'resolved'}
                onSelect={() =>
                  api
                    .promote(conversation.id)
                    .then(() =>
                      useInbox
                        .getState()
                        .say(
                          $t(
                            'Conversation envoyée à la relecture, dans basedb (« Conversations promues »).',
                          ),
                        ),
                    )
                    .catch(useInbox.getState().fail)
                }
              >
                <BookmarkPlus />
                {$t('Promouvoir en source pour l’IA')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Hint label={detailsOpen ? $t('Masquer le panneau') : $t('Afficher le panneau')}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleDetails}
              className={cn(detailsOpen && 'bg-accent')}
            >
              <PanelRight className="text-muted-foreground" />
            </Button>
          </Hint>
        </div>
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto scroll-discret">
        <div ref={content} className="mx-auto max-w-3xl space-y-4 px-6 py-6">
          {messages.map((message, index) => {
            const previous = messages[index - 1]
            const newDay = previous === undefined || dayOf(previous.at) !== dayOf(message.at)
            return (
              <Fragment key={message.id}>
                {newDay && (
                  <div className="flex items-center gap-3 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    <span className="h-px flex-1 bg-border" />
                    {daySeparator(message.at, now)}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                <MessageView
                  message={message}
                  contactName={contact.name}
                  onFeedback={(value) => feedback(message, value)}
                />
              </Fragment>
            )
          })}
          {aiWriting && <AiTyping />}
          {visitorWriting && <VisitorTyping name={contact.name} />}
        </div>
      </div>

      <Composer key={conversation.id} conversation={conversation} inputRef={inputRef} />
      <TransferDialog
        conversation={conversation}
        open={transferring}
        onClose={() => setTransferring(false)}
      />
    </section>
  )
}

/**
 * Keeps the newest message in view, as a chat does: on opening a conversation, and then
 * whenever the thread or its frame changes size — a message arriving, the composer
 * growing, the copilot's suggestions appearing — as long as the agent was at the bottom.
 * Scrolled up to read, the agent stays where they are.
 */
function useStickToBottom(conversationId: string) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new conversation starts at its bottom — the id is the trigger
  useEffect(() => {
    const frame = scroller.current
    const inner = content.current
    if (!frame || !inner) return
    atBottom.current = true
    const toBottom = () => {
      if (atBottom.current) frame.scrollTop = frame.scrollHeight
    }
    const onScroll = () => {
      atBottom.current = frame.scrollHeight - frame.scrollTop - frame.clientHeight < 48
    }
    toBottom()
    const observer = new ResizeObserver(toBottom)
    observer.observe(frame)
    observer.observe(inner)
    frame.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      frame.removeEventListener('scroll', onScroll)
    }
  }, [conversationId])

  return { scroller, content }
}

function MessageView({
  message,
  contactName,
  onFeedback,
}: {
  readonly message: Message
  readonly contactName: string
  readonly onFeedback: (feedback: Feedback) => void
}) {
  switch (message.kind) {
    case 'visitor':
      return <VisitorBubble message={message} name={contactName} />
    case 'agent':
      return <AgentBubble message={message} />
    case 'ai':
      return <AiAnswer message={message} onFeedback={onFeedback} />
    case 'note':
      return <NoteCard message={message} />
    case 'event':
      return <EventLine message={message} />
    case 'handoff':
      return <HandoffCard message={message} />
  }
}
