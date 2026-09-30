import { Chip, type Tint } from '@/components/app/chip'
import { $t, intlLocale, msg } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ConversationSummary, Priority, Sentiment } from '@chat/contracts'
import { Sparkles } from 'lucide-react'

type StateOf = Pick<ConversationSummary, 'status' | 'assignee' | 'handedOff'>

/** How a conversation's state reads in a row and in its header. */
export function conversationState(conversation: StateOf): { label: string; tint: Tint } {
  switch (conversation.status) {
    case 'ai':
      return { label: $t('IA en cours'), tint: 'violet' }
    case 'pending':
      return { label: $t('En attente'), tint: 'amber' }
    case 'resolved':
      return { label: $t('Résolue'), tint: 'emerald' }
    case 'open':
      if (conversation.assignee === null) return { label: $t('Non assignée'), tint: 'zinc' }
      return conversation.handedOff
        ? { label: $t('Transférée'), tint: 'amber' }
        : { label: $t('Ouverte'), tint: 'sky' }
  }
}

export function StateChip({
  conversation,
  className,
}: {
  readonly conversation: StateOf
  readonly className?: string
}) {
  const { label, tint } = conversationState(conversation)
  return (
    <Chip tint={tint} className={className}>
      {conversation.status === 'ai' && <Sparkles />}
      {label}
    </Chip>
  )
}

/** A confidence score, coloured by how far it clears the site's threshold. */
export function ConfidenceChip({
  value,
  bare = false,
}: {
  readonly value: number
  /** The number alone, where « Confiance » is already written beside it. */
  readonly bare?: boolean
}) {
  const tint: Tint = value >= 0.8 ? 'emerald' : value >= 0.65 ? 'amber' : 'rose'
  const percent = new Intl.NumberFormat(intlLocale(), { style: 'percent' }).format(value)
  return <Chip tint={tint}>{bare ? percent : $t('Confiance {value}', { value: percent })}</Chip>
}

const SENTIMENTS: Record<Sentiment, { label: string; tint: Tint }> = {
  positive: { label: msg('Positif'), tint: 'emerald' },
  neutral: { label: msg('Neutre'), tint: 'zinc' },
  negative: { label: msg('Négatif'), tint: 'rose' },
}

export function SentimentChip({ value }: { readonly value: Sentiment }) {
  const { label, tint } = SENTIMENTS[value]
  return (
    <Chip tint={tint}>
      <span className="size-1.5 rounded-full bg-current" />
      {$t(label)}
    </Chip>
  )
}

const PRIORITIES: Record<Priority, { label: string; tint: Tint }> = {
  low: { label: msg('Basse'), tint: 'zinc' },
  normal: { label: msg('Normale'), tint: 'sky' },
  high: { label: msg('Haute'), tint: 'amber' },
  urgent: { label: msg('Urgente'), tint: 'rose' },
}

export function PriorityChip({ value }: { readonly value: Priority }) {
  const { label, tint } = PRIORITIES[value]
  return <Chip tint={tint}>{$t(label)}</Chip>
}

/**
 * A contact's initials on a tint of their own, stable from one screen to the next: the
 * name picks the colour, so Sophie is the same colour in the list and in the thread.
 */
const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#ef4444']

function colorOf(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? '#64748b'
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

export function ContactAvatar({
  name,
  online = false,
  className,
}: {
  readonly name: string
  readonly online?: boolean
  readonly className?: string
}) {
  const color = colorOf(name)
  return (
    <span
      className={cn(
        'relative inline-flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        className,
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        color: `color-mix(in oklab, ${color} 70%, var(--foreground))`,
      }}
    >
      {initials(name)}
      {online && (
        <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
      )}
    </span>
  )
}
