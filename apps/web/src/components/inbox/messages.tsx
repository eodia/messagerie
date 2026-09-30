'use client'

import { Chip } from '@/components/app/chip'
import { Button } from '@/components/ui/button'
import { $t, $tp } from '@/lib/i18n'
import { clockTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type {
  AgentMessage,
  AiMessage,
  ConversationEvent,
  EventMessage,
  Feedback,
  HandoffMessage,
  NoteMessage,
  Source,
  VisitorMessage,
} from '@chat/contracts'
import {
  ArrowRightLeft,
  Bot,
  Check,
  ChevronRight,
  CircleCheck,
  FileText,
  Hand,
  MessagesSquare,
  Pencil,
  RotateCcw,
  StickyNote,
  Wrench,
  X,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ConfidenceChip, ContactAvatar } from './labels'

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

export function VisitorBubble({
  message,
  name,
}: {
  readonly message: VisitorMessage
  readonly name: string
}) {
  return (
    <div className="flex items-end gap-2.5">
      <ContactAvatar name={name} className="mb-5 size-7 text-[10px]" />
      <div className="max-w-[75%]">
        <div className="whitespace-pre-line rounded-2xl rounded-bl-md border bg-background px-3.5 py-2 text-sm shadow-xs">
          {message.body}
        </div>
        <Meta>{clockTime(message.at)}</Meta>
      </div>
    </div>
  )
}

export function AgentBubble({ message }: { readonly message: AgentMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%]">
        <div className="whitespace-pre-line rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
          {message.body}
        </div>
        <Meta align="right">
          {message.author} · {clockTime(message.at)}
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
        <p className="whitespace-pre-line text-sm">{message.body}</p>
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
} as const

/** An event, said in the reader's language: the server stores what happened, not words. */
function eventText(event: ConversationEvent): string {
  switch (event.type) {
    case 'takeover':
      return $t('{agent} a repris la main : l’IA ne répond plus ici.', { agent: event.agent })
    case 'resolved':
      return $t('{agent} a résolu la conversation.', { agent: event.agent })
    case 'reopened':
      return $t('{agent} a rouvert la conversation.', { agent: event.agent })
    case 'tool':
      return $t('L’IA a utilisé l’outil « {tool} » : {detail}.', {
        tool: event.tool,
        detail: event.detail,
      })
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
          <dd className="leading-relaxed">{message.summary}</dd>
          <dt className="text-muted-foreground">{$t('Confiance')}</dt>
          <dd>
            <ConfidenceChip value={message.confidence} bare />
          </dd>
          <dt className="text-muted-foreground">{$t('Affectée à')}</dt>
          <dd>
            {message.assignee} <span className="text-muted-foreground">· {message.team}</span>
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
    <div className="flex justify-end">
      <article className="w-full max-w-[75%] overflow-hidden rounded-xl border bg-card shadow-xs">
        <header className="flex items-center gap-2 border-b px-3.5 py-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-violet-500/15 text-violet-800 dark:text-violet-300">
            <Bot className="size-3.5" />
          </span>
          <span className="text-xs font-semibold">{$t('Réponse de l’IA')}</span>
          <ConfidenceChip value={message.confidence} />
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {$t('Envoyée · {time}', { time: clockTime(message.at) })}
          </span>
        </header>

        <p className="whitespace-pre-line px-3.5 py-3 text-sm leading-relaxed">{message.body}</p>

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

/** The AI is writing: three dots, as a person typing would show. */
export function AiTyping() {
  return (
    <div className="flex justify-end">
      <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-xs">
        <Bot className="size-3.5 text-violet-600 dark:text-violet-300" />
        {$t('L’IA rédige une réponse')}
        <span className="flex gap-0.5">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="size-1 animate-bounce rounded-full bg-current"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  )
}
