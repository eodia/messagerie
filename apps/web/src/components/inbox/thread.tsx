'use client'

import { Chip } from '@/components/app/chip'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Hint } from '@/components/ui/tooltip'
import { $t } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { dayLabel } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { Conversation, Feedback, Message } from '@chat/contracts'
import {
  BookmarkPlus,
  CircleCheck,
  Ellipsis,
  Hand,
  MapPin,
  PanelRight,
  ShieldCheck,
  Undo2,
  UserRoundPlus,
} from 'lucide-react'
import { Fragment, useEffect, useRef } from 'react'
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
} from './messages'

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
  const me = useInbox((s) => s.me)
  const agents = useInbox((s) => s.agents)
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

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-surface">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b bg-background px-5 py-2">
        <ContactAvatar name={contact.name} online={status !== 'resolved'} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{contact.name}</h2>
            {contact.identified ? (
              <Hint label={$t('Identité signée par le site : ce visiteur est bien connecté.')}>
                <span>
                  <Chip tint="emerald">
                    <ShieldCheck />
                    {$t('Identifié')}
                  </Chip>
                </span>
              </Hint>
            ) : (
              <Chip tint="zinc">{$t('Anonyme')}</Chip>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
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
          <StateChip conversation={{ ...conversation, handedOff }} />
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
          <DropdownMenu>
            <Hint label={$t('Plus d’actions')}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <Ellipsis className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <UserRoundPlus />
                  {$t('Affecter à')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  <DropdownMenuRadioGroup
                    value={conversation.assigneeId ?? ''}
                    onValueChange={(id) => void assign(conversation.id, id)}
                  >
                    {agents.map((agent) => (
                      <DropdownMenuRadioItem key={agent.id} value={agent.id}>
                        {agent.id === me?.id
                          ? $t('{name} (vous)', { name: agent.name })
                          : agent.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={conversation.assigneeId === null}
                    onSelect={() => void assign(conversation.id, null)}
                  >
                    <Undo2 />
                    {$t('Remettre dans la file')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={status !== 'resolved'}>
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
        </div>
      </div>

      <Composer key={conversation.id} conversation={conversation} inputRef={inputRef} />
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
