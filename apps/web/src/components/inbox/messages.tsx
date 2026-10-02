'use client'

import { Chip } from '@/components/app/chip'
import { CopyButton } from '@/components/app/copy-button'
import { Button } from '@/components/ui/button'
import { $t, $tp, intlLocale, msg } from '@/lib/i18n'
import { useSpeech } from '@/lib/speech'
import { clockTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type {
  AgentMessage,
  AiMessage,
  ConversationEvent,
  EventMessage,
  Feedback,
  HandoffMessage,
  Message,
  NoteMessage,
  Source,
  VisitorMessage,
} from '@chat/contracts'
import {
  AlarmClock,
  AlarmClockOff,
  ArrowRightLeft,
  AtSign,
  Ban,
  Bot,
  Check,
  ChevronRight,
  CircleCheck,
  FileText,
  Flag,
  Forward,
  Hand,
  Inbox,
  MessagesSquare,
  Pencil,
  RotateCcw,
  Square,
  StickyNote,
  UserRoundPlus,
  Volume2,
  Wrench,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { AttachmentList } from './attachments'
import { ConfidenceChip, ContactAvatar } from './labels'
import { RichText } from './rich-text'

function Meta({
  children,
  align = 'left',
}: { readonly children: ReactNode; readonly align?: 'left' | 'right' }) {
  return (
    <div
      className={cn(
        'mt-1 px-1 text-[11px] text-muted-foreground tabular-nums',
        align === 'right' && 'text-right',
      )}
    >
      {children}
    </div>
  )
}

/** A message deleted for everyone: said so where it was, with who deleted it and when. */
export function DeletedBubble({
  message,
  side,
}: {
  readonly message: Message
  readonly side: 'left' | 'right'
}) {
  const { deleted } = message
  if (!deleted) return null
  return (
    <div className={cn('flex', side === 'right' ? 'justify-end' : 'pl-[38px]')}>
      <div className={cn('flex max-w-[75%] flex-col', side === 'right' && 'items-end')}>
        <div className="inline-flex items-center gap-1.5 rounded-2xl border border-dashed px-3.5 py-2 text-sm text-muted-foreground italic">
          <Ban className="size-3.5" />
          {$t('Ce message a été supprimé')}
        </div>
        <Meta align={side}>
          {deleted.by
            ? $t('Supprimé par {name} · {time}', { name: deleted.by, time: clockTime(deleted.at) })
            : $t('Supprimé · {time}', { time: clockTime(deleted.at) })}
        </Meta>
      </div>
    </div>
  )
}

/** In audio mode, reads a message aloud — again, it stops. */
export function SpeakButton({ id, text }: { readonly id: string; readonly text: string }) {
  const speaking = useSpeech((s) => s.speaking === id)
  const audioMode = useSpeech((s) => s.audioMode)
  if (!audioMode || text.trim() === '') return null
  const { speak, stop } = useSpeech.getState()
  return (
    <button
      type="button"
      aria-label={speaking ? $t('Arrêter la lecture') : $t('Écouter le message')}
      onClick={() => (speaking ? stop() : speak(id, text))}
      className={cn(
        'inline-flex size-5 items-center justify-center rounded align-middle text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground',
        speaking
          ? 'text-foreground opacity-100'
          : 'opacity-0 group-hover/message:opacity-100 focus-visible:opacity-100',
      )}
    >
      {speaking ? <Square className="size-3 fill-current" /> : <Volume2 className="size-3.5" />}
    </button>
  )
}

export function VisitorBubble({
  message,
  name,
}: {
  readonly message: VisitorMessage
  readonly name: string
}) {
  return (
    <div className="group/message flex items-end gap-2.5">
      <ContactAvatar name={name} className="mb-5 size-7 text-[10px]" />
      <div className="max-w-[75%]">
        {message.body && (
          <div className="whitespace-pre-line rounded-2xl rounded-bl-md border bg-background px-3.5 py-2 text-sm shadow-xs">
            {message.body}
          </div>
        )}
        <AttachmentList items={message.attachments} />
        <Meta>
          {clockTime(message.at)} <SpeakButton id={message.id} text={message.body} />
        </Meta>
      </div>
    </div>
  )
}

export function AgentBubble({ message }: { readonly message: AgentMessage }) {
  return (
    <div className="group/message flex justify-end">
      <div className="flex max-w-[75%] flex-col items-end">
        {message.body && (
          <RichText
            text={message.body}
            className="rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground"
          />
        )}
        <AttachmentList items={message.attachments} align="right" />
        <Meta align="right">
          <SpeakButton id={message.id} text={message.body} /> {message.author} ·{' '}
          {clockTime(message.at)}
        </Meta>
      </div>
    </div>
  )
}

export function NoteCard({ message }: { readonly message: NoteMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-xl border border-note-border bg-note px-3.5 py-2.5">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
          <StickyNote className="size-3" />
          {$t('Note interne · invisible pour le visiteur')}
        </div>
        {message.body && <RichText text={message.body} className="text-sm" />}
        <AttachmentList items={message.attachments} />
        <div className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
          {message.author} · {clockTime(message.at)}
        </div>
      </div>
    </div>
  )
}

const EVENT_ICONS = {
  tool: Wrench,
  takeover: Hand,
  resolved: CircleCheck,
  reopened: RotateCcw,
  assigned: UserRoundPlus,
  transferred: Forward,
  snoozed: AlarmClock,
  woke: AlarmClockOff,
  restarted: RotateCcw,
  queued: Inbox,
  priority: Flag,
  email_requested: AtSign,
  email_given: AtSign,
} as const

const PRIORITIES = {
  low: msg('basse'),
  normal: msg('normale'),
  high: msg('haute'),
  urgent: msg('urgente'),
} as const

const priorityLabel = (priority: keyof typeof PRIORITIES) => $t(PRIORITIES[priority])

/** An event, said in the reader's language: the server stores what happened, not words. */
function eventText(event: ConversationEvent): string {
  switch (event.type) {
    case 'takeover':
      return $t('{agent} a repris la main : l’IA ne répond plus ici.', { agent: event.agent })
    case 'resolved':
      return $t('{agent} a résolu la conversation.', { agent: event.agent })
    case 'reopened':
      return $t('{agent} a rouvert la conversation.', { agent: event.agent })
    case 'assigned':
      if (event.agent === null) {
        return $t('{by} a remis la conversation dans la file.', { by: event.by })
      }
      if (event.agent === event.by) return $t('{by} a pris la conversation.', { by: event.by })
      return $t('{by} a confié la conversation à {agent}.', { by: event.by, agent: event.agent })
    case 'tool':
      return $t('L’IA a utilisé l’outil « {tool} » : {detail}.', {
        tool: event.tool,
        detail: event.detail,
      })
    case 'transferred':
      if (event.inbox && event.team) {
        return $t('{by} a transféré la conversation dans « {inbox} », à l’équipe {team}.', {
          by: event.by,
          inbox: event.inbox,
          team: event.team,
        })
      }
      if (event.inbox) {
        return $t('{by} a transféré la conversation dans « {inbox} ».', {
          by: event.by,
          inbox: event.inbox,
        })
      }
      return $t('{by} a confié la conversation à l’équipe {team}.', {
        by: event.by,
        team: event.team ?? '—',
      })
    case 'snoozed':
      return $t('{agent} a mis la conversation en attente jusqu’au {date}.', {
        agent: event.agent,
        date: new Intl.DateTimeFormat(intlLocale(), {
          dateStyle: 'long',
          timeStyle: 'short',
        }).format(new Date(event.until)),
      })
    case 'woke':
      return event.agent === null
        ? $t('La conversation revient : son attente est finie.')
        : $t('{agent} a sorti la conversation de l’attente.', { agent: event.agent })
    case 'restarted':
      return $t('Le visiteur a commencé une nouvelle conversation depuis la page.')
    case 'queued':
      return $t('« {by} » a confié la conversation aux conseillers.', { by: event.by })
    case 'priority':
      return $t('« {by} » a passé la priorité à « {priority} ».', {
        by: event.by,
        priority: priorityLabel(event.priority),
      })
    case 'email_requested':
      return event.by === null
        ? $t('Le widget a proposé au visiteur de laisser son e-mail : personne n’est disponible.')
        : $t('« {by} » a proposé au visiteur de laisser son e-mail.', { by: event.by })
    case 'email_given':
      return $t('Le visiteur a laissé son e-mail : {email}.', { email: event.email })
  }
}

export function EventLine({ message }: { readonly message: EventMessage }) {
  const Icon = EVENT_ICONS[message.event.type]
  return (
    <div className="flex justify-center">
      <div className="inline-flex max-w-[85%] items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground shadow-xs">
        <Icon className="size-3.5 shrink-0" />
        <span>{eventText(message.event)}</span>
        <span className="shrink-0 text-[11px] tabular-nums opacity-70">
          {clockTime(message.at)}
        </span>
      </div>
    </div>
  )
}

export function HandoffCard({ message }: { readonly message: HandoffMessage }) {
  return (
    <div className="flex justify-center">
      <article className="w-full max-w-xl rounded-xl border border-amber-500/30 bg-amber-500/5">
        <header className="flex items-center gap-2 border-b border-amber-500/20 px-3.5 py-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300">
            <ArrowRightLeft className="size-3.5" />
          </span>
          <span className="text-xs font-semibold">{$t('Transférée à un conseiller')}</span>
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {clockTime(message.at)}
          </span>
        </header>
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 px-3.5 py-3 text-xs">
          <dt className="text-muted-foreground">{$t('Motif')}</dt>
          <dd className="font-medium">{message.reason}</dd>
          <dt className="text-muted-foreground">{$t('Résumé de l’IA')}</dt>
          <dd className="group flex items-start gap-1.5 leading-relaxed">
            <span className="min-w-0 flex-1">{message.summary}</span>
            <CopyButton
              text={message.summary}
              label={$t('Copier le résumé')}
              className="-mt-0.5 opacity-60 group-hover:opacity-100"
            />
          </dd>
          <dt className="text-muted-foreground">{$t('Confiance')}</dt>
          <dd>
            <ConfidenceChip value={message.confidence} bare />
          </dd>
          <dt className="text-muted-foreground">{$t('Affectée à')}</dt>
          <dd>
            {message.assignee || $t('L’équipe')}{' '}
            <span className="text-muted-foreground">· {message.team}</span>
          </dd>
        </dl>
      </article>
    </div>
  )
}

const FEEDBACK: readonly {
  readonly value: Feedback
  readonly label: string
  readonly icon: typeof Check
  readonly on: string
}[] = [
  {
    value: 'accepted',
    label: 'Accepter',
    icon: Check,
    on: 'bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/20 dark:text-emerald-300',
  },
  {
    value: 'edited',
    label: 'Modifier',
    icon: Pencil,
    on: 'bg-sky-500/15 text-sky-800 hover:bg-sky-500/20 dark:text-sky-300',
  },
  {
    value: 'rejected',
    label: 'Rejeter',
    icon: X,
    on: 'bg-rose-500/15 text-rose-800 hover:bg-rose-500/20 dark:text-rose-300',
  },
]

/**
 * An answer the AI sent to the visitor, with what it answered from and how sure it was —
 * and the agent's verdict on it, which is what the evaluation set is made of.
 */
export function AiAnswer({
  message,
  onFeedback,
}: {
  readonly message: AiMessage
  readonly onFeedback: (feedback: Feedback) => void
}) {
  const [sourcesOpen, setSourcesOpen] = useState(true)
  return (
    <div className="group/message flex justify-end">
      <article className="w-full max-w-[75%] overflow-hidden rounded-xl border bg-card shadow-xs">
        <header className="flex items-center gap-2 border-b px-3.5 py-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-violet-500/15 text-violet-800 dark:text-violet-300">
            <Bot className="size-3.5" />
          </span>
          <span className="text-xs font-semibold">{$t('Réponse de l’IA')}</span>
          <ConfidenceChip value={message.confidence} />
          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
            <SpeakButton id={message.id} text={message.body} />
            {$t('Envoyée · {time}', { time: clockTime(message.at) })}
          </span>
        </header>

        <RichText text={message.body} className="px-3.5 py-3 text-sm leading-relaxed" />

        {message.sources.length > 0 && (
          <div className="border-t px-3.5 py-2.5">
            <button
              type="button"
              onClick={() => setSourcesOpen((open) => !open)}
              className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
            >
              <ChevronRight
                className={cn('size-3.5 transition-transform', sourcesOpen && 'rotate-90')}
              />
              {$tp(message.sources.length, '{count} source', '{count} sources')}
            </button>
            {sourcesOpen && (
              <ul className="mt-2 space-y-1.5">
                {message.sources.map((source) => (
                  <SourceRow key={source.title} source={source} />
                ))}
              </ul>
            )}
          </div>
        )}

        <footer className="flex items-center gap-1 border-t bg-muted/30 px-2 py-1.5">
          <span className="px-1.5 text-[11px] text-muted-foreground">{$t('Votre avis')}</span>
          {FEEDBACK.map(({ value, label, icon: Icon, on }) => (
            <Button
              key={value}
              variant="ghost"
              size="sm"
              aria-pressed={message.feedback === value}
              onClick={() => onFeedback(value)}
              className={cn('h-7 gap-1.5 px-2 text-xs', message.feedback === value && on)}
            >
              <Icon className="size-3.5" />
              {$t(label)}
            </Button>
          ))}
        </footer>
      </article>
    </div>
  )
}

function SourceRow({ source }: { readonly source: Source }) {
  const Icon = source.origin === 'article' ? FileText : MessagesSquare
  return (
    <li className="flex items-center gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
        <Icon className="size-3.5 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{source.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{source.detail}</span>
      </span>
      {source.validated && (
        <Chip tint="emerald">
          <CircleCheck />
          {$t('Relue')}
        </Chip>
      )}
    </li>
  )
}

/** Three dots bouncing in turn — someone is writing. */
export function TypingDots({ className }: { readonly className?: string }) {
  return (
    <span className={cn('flex shrink-0 gap-0.5', className)} aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1 animate-bounce rounded-full bg-current"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  )
}

/** The AI is writing: three dots, as a person typing would show. */
export function AiTyping() {
  return (
    <div className="flex justify-end">
      <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-xs">
        <Bot className="size-3.5 text-violet-600 dark:text-violet-300" />
        {$t('L’IA rédige une réponse')}
        <TypingDots />
      </div>
    </div>
  )
}

/** The visitor is writing: their next bubble, still empty, where it will appear. */
export function VisitorTyping({ name }: { readonly name: string }) {
  return (
    <output className="flex items-center gap-2.5">
      <ContactAvatar name={name} className="size-7 text-[10px]" />
      <div className="flex h-8 items-center rounded-2xl rounded-bl-md border bg-background px-3.5 text-muted-foreground shadow-xs">
        <TypingDots className="gap-1 [&>span]:size-1.5" />
      </div>
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        {$t('{name} est en train d’écrire…', { name })}
      </span>
    </output>
  )
}
