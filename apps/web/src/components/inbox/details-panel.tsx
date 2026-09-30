'use client'

import { Chip, ColorBadge } from '@/components/app/chip'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Hint } from '@/components/ui/tooltip'
import { $t, msg } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { dayLabel } from '@/lib/time'
import type { Contact, ContactAttribute, Conversation, PastConversation } from '@chat/contracts'
import {
  CalendarClock,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  type LucideIcon,
  Plus,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { ContactAvatar, PriorityChip, SentimentChip, conversationState } from './labels'

/**
 * The tools an agent may launch from here — in the product, the rows of the « Outils IA »
 * table of basedb whose « Copilote » box is ticked.
 */
const TOOLS: readonly { readonly label: string; readonly icon: LucideIcon }[] = [
  { label: msg('Consulter le contrat'), icon: FileText },
  { label: msg('Voir le dossier sinistre'), icon: FolderOpen },
  { label: msg('Créer un rappel'), icon: CalendarClock },
]

function Section({
  title,
  aside,
  children,
}: {
  readonly title: string
  readonly aside?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className="border-t px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

export function DetailsPanel({ conversation }: { readonly conversation: Conversation }) {
  const me = useInbox((s) => s.me)
  const { contact } = conversation
  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l bg-background xl:flex">
      <Tabs defaultValue="details" className="min-h-0 flex-1">
        <TabsList className="w-full shrink-0 justify-start px-5">
          <TabsTrigger value="details">{$t('Détails')}</TabsTrigger>
          <TabsTrigger value="history">
            {$t('Historique')}
            {conversation.history.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
                {conversation.history.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="min-h-0 overflow-y-auto scroll-discret">
          <ContactBlock contact={contact} />

          <Section
            title={$t('Transmis par le site')}
            aside={
              contact.identified && (
                <Hint label={$t('Ces informations viennent d’une identité signée par le site.')}>
                  <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                </Hint>
              )
            }
          >
            {contact.attributes.length > 0 ? (
              <dl className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-x-3 gap-y-2.5 text-xs">
                {contact.attributes.map((attribute) => (
                  <Attribute key={attribute.label} attribute={attribute} />
                ))}
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground">
                {contact.identified
                  ? $t('Le site n’a transmis aucun attribut pour ce visiteur.')
                  : $t('Visiteur anonyme : le site n’a transmis aucune identité signée.')}
              </p>
            )}
          </Section>

          <Section title={$t('Outils IA')}>
            <div className="space-y-1.5">
              {TOOLS.map(({ label, icon: Icon }) => (
                <Button
                  key={label}
                  variant="outline"
                  size="sm"
                  className="h-8 w-full justify-start gap-2.5 text-xs font-normal"
                >
                  <Icon className="size-3.5 text-muted-foreground" />
                  {$t(label)}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-start gap-2.5 text-xs font-normal text-muted-foreground"
              >
                <ExternalLink className="size-3.5" />
                {$t('Ouvrir dans l’outil métier')}
              </Button>
            </div>
          </Section>

          <Section title={$t('Intention et étiquettes')}>
            {conversation.intent && (
              <div className="mb-2.5 flex items-center gap-1.5 text-sm">
                <Hint label={$t('Détectée par l’IA')}>
                  <Sparkles className="size-3.5 text-violet-600 dark:text-violet-300" />
                </Hint>
                {conversation.intent}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {conversation.tags.map((tag) => (
                <ColorBadge key={tag.label} color={tag.color}>
                  {tag.byAi && <Sparkles />}
                  {tag.label}
                </ColorBadge>
              ))}
              <Hint label={$t('Ajouter une étiquette')}>
                <button
                  type="button"
                  className="inline-flex size-6 items-center justify-center rounded-md border border-dashed text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
              </Hint>
            </div>
          </Section>

          <Section title={$t('Conversation')}>
            <dl className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-x-3 gap-y-2.5 text-xs">
              <dt className="text-muted-foreground">{$t('Sentiment')}</dt>
              <dd>
                {conversation.sentiment ? (
                  <SentimentChip value={conversation.sentiment} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
              <dt className="text-muted-foreground">{$t('Priorité')}</dt>
              <dd>
                <PriorityChip value={conversation.priority} />
              </dd>
              <dt className="text-muted-foreground">{$t('Affectée à')}</dt>
              <dd>
                {conversation.assignee === null
                  ? conversation.status === 'ai'
                    ? $t('L’IA')
                    : $t('Personne')
                  : conversation.assignee === me?.name
                    ? $t('Vous')
                    : conversation.assignee}
              </dd>
              <dt className="text-muted-foreground">{$t('Site')}</dt>
              <dd>{conversation.site}</dd>
            </dl>
          </Section>

          {conversation.summary && (
            <Section title={$t('Résumé de l’IA')}>
              <p className="text-xs leading-relaxed">{conversation.summary}</p>
            </Section>
          )}
        </TabsContent>

        <TabsContent value="history" className="min-h-0 overflow-y-auto px-5 py-4 scroll-discret">
          {conversation.history.length > 0 ? (
            <ul className="space-y-2">
              {conversation.history.map((past) => (
                <PastRow key={past.subject} past={past} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {$t('Première conversation de ce contact.')}
            </p>
          )}
        </TabsContent>
      </Tabs>
    </aside>
  )
}

function ContactBlock({ contact }: { readonly contact: Contact }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <ContactAvatar name={contact.name} className="size-11 text-sm" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{contact.name}</div>
        {contact.email && (
          <div className="truncate text-xs text-muted-foreground">{contact.email}</div>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {contact.identified ? (
            <Chip tint="emerald">{$t('Client')}</Chip>
          ) : (
            <Chip tint="zinc">{$t('Visiteur')}</Chip>
          )}
          {contact.segment && <Chip tint="zinc">{contact.segment}</Chip>}
        </div>
      </div>
    </div>
  )
}

function Attribute({ attribute }: { readonly attribute: ContactAttribute }) {
  let value: ReactNode = attribute.value
  if (attribute.kind === 'code') {
    value = (
      <span className="group inline-flex items-center gap-1.5">
        <span className="font-mono">{attribute.value}</span>
        <Hint label={$t('Copier')}>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(attribute.value)}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground [@media(hover:none)]:opacity-100"
          >
            <Copy className="size-3" />
          </button>
        </Hint>
      </span>
    )
  } else if (attribute.kind === 'status') {
    value = <Chip tint="sky">{attribute.value}</Chip>
  } else if (attribute.kind === 'date') {
    value = dayLabel(attribute.value)
  }
  return (
    <>
      <dt className="text-muted-foreground">{attribute.label}</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </>
  )
}

function PastRow({ past }: { readonly past: PastConversation }) {
  const state = conversationState({ status: past.status, assignee: null, handedOff: false })
  return (
    <li className="rounded-lg border p-3">
      <div className="text-sm">{past.subject}</div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
        {dayLabel(past.at)}
        <Chip tint={state.tint}>{state.label}</Chip>
      </div>
    </li>
  )
}
