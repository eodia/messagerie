'use client'

import { Chip, ColorBadge } from '@/components/app/chip'
import { CopyButton } from '@/components/app/copy-button'
import { Flag } from '@/components/app/flag'
import { InboxGlyph } from '@/components/app/look'
import { ResizablePanel } from '@/components/app/resizable-panel'
import { ToolDialog, type ToolTarget } from '@/components/app/tool-dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Hint } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { $t, $tp, msg } from '@/lib/i18n'
import { clockOf, whereInFull } from '@/lib/place'
import { type BlockId, useDetailsLayout } from '@/lib/store/details-layout'
import { useInbox } from '@/lib/store/inbox'
import { dayLabel } from '@/lib/time'
import { cn } from '@/lib/utils'
import type {
  Contact,
  ContactAttribute,
  Conversation,
  PastConversation,
  ToolsOverview,
} from '@chat/contracts'
import {
  ArrowDown,
  ArrowUp,
  Braces,
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  Compass,
  FileText,
  Globe,
  GripVertical,
  Inbox,
  LayoutList,
  type LucideIcon,
  Mail,
  MapPin,
  MessagesSquare,
  NotebookPen,
  Phone,
  Plug,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  UserRound,
  UsersRound,
  Wrench,
} from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useState } from 'react'
import { AssignPicker } from './assign-picker'
import { ContactAvatar, PriorityChip, SentimentChip, StatusChip, conversationState } from './labels'
import { MetadataList } from './metadata'
import { PageNowLine, PageTrail, pageNow } from './page-trail'
import { Tags } from './tag-picker'

/**
 * The details beside the thread: who the customer is, what the AI made of the conversation,
 * where it stands, what the site and the page said, and what the agent can run. The AI's
 * summary comes first, with a button to copy it — what an agent picking the conversation up
 * reads, and pastes elsewhere. Each section folds, and stays as the agent left it.
 */

// ── Sections that fold, remembered in this browser ──────────────────────────────────────

const CLOSED_KEY = 'chat.details.closed'

function readClosed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(CLOSED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function useFolded(id: string): readonly [boolean, () => void] {
  const [open, setOpen] = useState(() => !readClosed().has(id))
  const toggle = () => {
    setOpen((was) => {
      const closed = readClosed()
      if (was) closed.add(id)
      else closed.delete(id)
      try {
        window.localStorage.setItem(CLOSED_KEY, JSON.stringify([...closed]))
      } catch {
        // Forgotten at the next visit, nothing more.
      }
      return !was
    })
  }
  return [open, toggle]
}

function Section({
  id,
  title,
  icon: Icon,
  count = 0,
  aside,
  children,
}: {
  readonly id: string
  readonly title: string
  readonly icon: LucideIcon
  readonly count?: number
  readonly aside?: ReactNode
  readonly children: ReactNode
}) {
  const [open, toggle] = useFolded(id)
  return (
    <section className="border-t">
      <div className="flex h-11 items-center gap-2 px-5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
          <h3 className="truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase transition-colors group-hover:text-foreground">
            {title}
          </h3>
          {count > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
          <ChevronDown
            className={cn(
              'ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
              !open && '-rotate-90',
            )}
          />
        </button>
        {aside}
      </div>
      {open && (
        <div className="animate-in fade-in slide-in-from-top-1 px-5 pb-4 duration-200">
          {children}
        </div>
      )}
    </section>
  )
}

/** A line of facts: an icon and a label on the left, the value beside. */
function Row({
  icon: Icon,
  label,
  children,
}: {
  readonly icon: LucideIcon
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-h-8 items-center gap-3 text-[13px]">
      <span className="flex w-[6.75rem] shrink-0 items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">{children}</span>
    </div>
  )
}

const quiet = <span className="text-muted-foreground/70">—</span>

// ── The panel ───────────────────────────────────────────────────────────────────────────

export function DetailsPanel({ conversation }: { readonly conversation: Conversation }) {
  const me = useInbox((s) => s.me)
  const directory = useInbox((s) => s.directory)
  const setData = useInbox((s) => s.setData)
  const { contact } = conversation
  const inbox = directory.inboxes.find((i) => i.id === conversation.inboxId)
  const team = directory.teams.find((t) => t.id === conversation.teamId)
  const declared = Object.keys(contact.data).length
  const attached = Object.keys(conversation.data).length
  const { order, hidden, arranging } = useDetailsLayout()
  const [assigning, setAssigning] = useState(false)
  // The arrangement, from storage, before the first paint.
  useLayoutEffect(() => useDetailsLayout.getState().initialize(), [])

  // Each block of the panel, by its id: the agent orders them and hides some.
  const blocks: Record<BlockId, ReactNode> = {
    summary: conversation.summary ? <Summary text={conversation.summary} /> : null,
    conversation: (
      <Section id="conversation" title={$t(TITLES.conversation)} icon={MessagesSquare}>
        <div className="space-y-0.5">
          <Row icon={Inbox} label={$t('Boîte')}>
            {inbox ? (
              <>
                <InboxGlyph look={inbox} />
                <span className="truncate">{inbox.name}</span>
              </>
            ) : (
              quiet
            )}
          </Row>
          <Row icon={UsersRound} label={$t('Équipe')}>
            {team ? <span className="truncate">{team.name}</span> : quiet}
          </Row>
          <Row icon={UserRound} label={$t('Affectée à')}>
            <AssignPicker
              conversation={conversation}
              open={assigning}
              onOpenChange={setAssigning}
              align="start"
            >
              <button
                type="button"
                aria-label={$t('Changer le conseiller')}
                className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-accent"
              >
                {conversation.assignee !== null ? (
                  <>
                    <ContactAvatar name={conversation.assignee} className="size-5 text-[9px]" />
                    <span className="truncate">
                      {conversation.assignee === me?.name ? $t('Vous') : conversation.assignee}
                    </span>
                  </>
                ) : conversation.status === 'ai' ? (
                  <Chip tint="violet">
                    <Sparkles />
                    {$t('L’IA')}
                  </Chip>
                ) : (
                  <span className="text-muted-foreground">{$t('Personne, en file')}</span>
                )}
                <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              </button>
            </AssignPicker>
          </Row>
          <Row icon={Globe} label={$t('Site')}>
            <span className="truncate">{conversation.site}</span>
          </Row>
          {conversation.channel !== 'web' && (
            <Row icon={Smartphone} label={$t('Canal')}>
              <span className="truncate">
                {conversation.channel === 'rcs' ? $t('RCS') : $t('SMS')}
                {conversation.contact.phone && (
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                    {conversation.contact.phone}
                  </span>
                )}
              </span>
            </Row>
          )}
          <Row icon={Target} label={$t('Intention')}>
            {conversation.intent ? (
              <>
                <Hint label={$t('Détectée par l’IA')}>
                  <Sparkles className="size-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
                </Hint>
                <span className="truncate">{conversation.intent}</span>
              </>
            ) : (
              quiet
            )}
          </Row>
        </div>
        <div className="mt-3">
          <Tags conversation={conversation} />
        </div>
      </Section>
    ),
    pages: (
      <Section
        id="pages"
        title={$t(TITLES.pages)}
        icon={Compass}
        count={conversation.pages.length}
        aside={
          <Hint label={$t('Dit par le widget du visiteur : rien n’en est vérifié.')}>
            <CircleAlert className="size-3.5 text-muted-foreground" />
          </Hint>
        }
      >
        <PageTrail conversation={conversation} />
      </Section>
    ),
    site: (
      <Section
        id="site"
        title={$t(TITLES.site)}
        icon={ShieldCheck}
        count={contact.attributes.length}
        aside={
          contact.identified && (
            <Hint label={$t('Ces informations viennent d’une identité signée par le site.')}>
              <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            </Hint>
          )
        }
      >
        {contact.attributes.length > 0 ? (
          <div className="space-y-0.5">
            {contact.attributes.map((attribute) => (
              <Attribute key={attribute.label} attribute={attribute} />
            ))}
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {contact.identified
              ? $t('Le site n’a transmis aucun attribut pour ce visiteur.')
              : $t('Visiteur anonyme : le site n’a transmis aucune identité signée.')}
          </p>
        )}
      </Section>
    ),
    declared: (
      <Section
        id="declared"
        title={$t(TITLES.declared)}
        icon={NotebookPen}
        count={declared}
        aside={
          <Hint label={$t('Dit par la page du site ou par un conseiller : rien n’en est vérifié.')}>
            <CircleAlert className="size-3.5 text-muted-foreground" />
          </Hint>
        }
      >
        <MetadataList
          data={contact.data}
          empty={$t('Rien pour l’instant.')}
          onChange={(patch) =>
            setData({ contact: contact.id, conversation: conversation.id }, patch)
          }
        />
      </Section>
    ),
    data: (
      <Section id="data" title={$t(TITLES.data)} icon={Braces} count={attached}>
        <MetadataList
          data={conversation.data}
          empty={$t('Ni la page ni un conseiller n’y a joint de donnée.')}
          onChange={(patch) => setData({ conversation: conversation.id }, patch)}
        />
      </Section>
    ),
    tools: <CopilotTools conversationId={conversation.id} />,
  }

  return (
    <ResizablePanel
      panel="details"
      side="right"
      label={$t('le panneau de détails')}
      className="hidden bg-background xl:flex"
    >
      <Tabs defaultValue="details" className="min-h-0 flex-1">
        <div className="flex shrink-0 items-center border-b pr-3">
          <TabsList className="flex-1 justify-start border-b-0 px-5">
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
          <Hint label={arranging ? $t('Terminer') : $t('Organiser le panneau')}>
            <Button
              variant={arranging ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-pressed={arranging}
              onClick={() => useDetailsLayout.getState().setArranging(!arranging)}
            >
              {arranging ? <Check /> : <LayoutList className="text-muted-foreground" />}
            </Button>
          </Hint>
        </div>

        <TabsContent value="details" className="min-h-0 overflow-y-auto scroll-discret">
          <ContactHero conversation={conversation} />
          {arranging ? (
            <Arrange titles={TITLES} />
          ) : (
            order
              .filter((id) => !hidden.includes(id))
              .map((id) => <Fragment key={id}>{blocks[id]}</Fragment>)
          )}
        </TabsContent>

        <TabsContent value="history" className="min-h-0 overflow-y-auto px-5 py-5 scroll-discret">
          <History conversation={conversation} />
        </TabsContent>
      </Tabs>
    </ResizablePanel>
  )
}

// ── Arranging the panel ─────────────────────────────────────────────────────────────────

const TITLES: Readonly<Record<BlockId, string>> = {
  summary: msg('Résumé de l’IA'),
  conversation: msg('Conversation'),
  pages: msg('Pages vues'),
  site: msg('Transmis par le site'),
  declared: msg('Déclaré sur le contact'),
  data: msg('Données de la conversation'),
  tools: msg('Outils IA'),
}

const ICONS: Readonly<Record<BlockId, LucideIcon>> = {
  summary: Sparkles,
  conversation: MessagesSquare,
  pages: Compass,
  site: ShieldCheck,
  declared: NotebookPen,
  data: Braces,
  tools: Wrench,
}

/**
 * The panel's blocks as a list to arrange: dragged into place, or moved with the arrows;
 * shown or hidden by their switch. Kept in this browser.
 */
function Arrange({ titles }: { readonly titles: Readonly<Record<BlockId, string>> }) {
  const { order, hidden, move, toggle, reset } = useDetailsLayout()
  const [dragging, setDragging] = useState<BlockId | null>(null)
  const [over, setOver] = useState<number | null>(null)

  return (
    <div className="border-t px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
          {$t('Glissez les blocs dans l’ordre voulu, et masquez ceux qui ne vous servent pas.')}
        </p>
      </div>
      <ol
        className="space-y-1.5"
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null)
        }}
      >
        {order.map((id, index) => {
          const Icon = ICONS[id]
          const shown = !hidden.includes(id)
          return (
            <li
              key={id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', id)
                setDragging(id)
              }}
              onDragEnd={() => {
                setDragging(null)
                setOver(null)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setOver(index)
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragging) move(dragging, index)
                setDragging(null)
                setOver(null)
              }}
              className={cn(
                'flex h-10 items-center gap-2 rounded-lg border bg-background pr-1.5 pl-1 transition-[opacity,box-shadow,border-color]',
                dragging === id && 'opacity-40',
                over === index && dragging !== id && 'border-primary/50 ring-2 ring-primary/15',
                !shown && 'bg-muted/40',
              )}
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" />
              <Icon
                className={cn(
                  'size-3.5 shrink-0',
                  shown ? 'text-foreground' : 'text-muted-foreground',
                )}
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[13px]',
                  !shown && 'text-muted-foreground line-through decoration-muted-foreground/40',
                )}
              >
                {$t(titles[id])}
              </span>
              <Hint label={$t('Monter')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  disabled={index === 0}
                  onClick={() => move(id, index - 1)}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
              </Hint>
              <Hint label={$t('Descendre')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  disabled={index === order.length - 1}
                  onClick={() => move(id, index + 1)}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </Hint>
              <Switch
                checked={shown}
                onCheckedChange={() => toggle(id)}
                aria-label={
                  shown
                    ? $t('Masquer {block}', { block: $t(titles[id]) })
                    : $t('Afficher {block}', { block: $t(titles[id]) })
                }
                className="ml-1"
              />
            </li>
          )
        })}
      </ol>
      <div className="mt-3 flex items-center justify-between">
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={reset}>
          <RotateCcw className="size-3.5" />
          {$t('Réinitialiser')}
        </Button>
        <Button
          size="sm"
          className="h-8 text-xs"
          onClick={() => useDetailsLayout.getState().setArranging(false)}
        >
          {$t('Terminé')}
        </Button>
      </div>
    </div>
  )
}

// ── The customer ────────────────────────────────────────────────────────────────────────

function ContactHero({ conversation }: { readonly conversation: Conversation }) {
  const { contact } = conversation
  return (
    <div className="bg-surface/60 px-5 pt-5 pb-4">
      <div className="flex items-start gap-3.5">
        <ContactAvatar
          name={contact.name}
          online={pageNow(conversation) !== null}
          className="size-12 text-sm"
        />
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="truncate text-base font-semibold tracking-tight">{contact.name}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {contact.identified ? (
              <Hint label={$t('Le site a signé qui est ce client.')}>
                <span className="inline-flex">
                  <Chip tint="emerald">
                    <ShieldCheck />
                    {$t('Client identifié')}
                  </Chip>
                </span>
              </Hint>
            ) : (
              <Chip tint="zinc">{$t('Visiteur anonyme')}</Chip>
            )}
            {contact.segment && <Chip tint="zinc">{contact.segment}</Chip>}
          </div>
        </div>
      </div>

      <ContactLines contact={contact} />
      <PageNowLine conversation={conversation} />

      <dl className="mt-4 grid grid-cols-3 divide-x overflow-hidden rounded-lg border bg-background">
        <Stat label={$t('Échanges')}>
          <span className="text-sm font-semibold tabular-nums">
            {conversation.history.length + 1}
          </span>
        </Stat>
        <Stat label={$t('Sentiment')}>
          {conversation.sentiment ? <SentimentChip value={conversation.sentiment} /> : quiet}
        </Stat>
        <Stat label={$t('Priorité')}>
          <PriorityChip value={conversation.priority} />
        </Stat>
      </dl>
    </div>
  )
}

function ContactLines({ contact }: { readonly contact: Contact }) {
  const now = useInbox((s) => s.now)
  const where = whereInFull(contact)
  const clock = contact.timeZone ? clockOf(contact.timeZone, now) : null
  const lines: {
    icon: LucideIcon
    value: string
    copy: boolean
    label: string
    flag?: string | null
  }[] = [
    ...(contact.email
      ? [{ icon: Mail, value: contact.email, copy: true, label: $t('Copier l’adresse') }]
      : []),
    ...(contact.phone
      ? [{ icon: Phone, value: contact.phone, copy: true, label: $t('Copier le numéro') }]
      : []),
    ...(where
      ? [
          {
            icon: MapPin,
            value: clock ? `${where} · ${clock}` : where,
            copy: false,
            label: '',
            flag: contact.country,
          },
        ]
      : []),
  ]
  if (lines.length === 0) return null
  return (
    <ul className="mt-3.5 space-y-0.5">
      {lines.map(({ icon: Icon, value, copy, label, flag }) => (
        <li
          key={value}
          className="group -mx-1.5 flex h-7 items-center gap-2.5 rounded-md px-1.5 text-[13px] transition-colors hover:bg-muted/60"
        >
          {flag ? (
            <Flag country={flag} className="text-[10.5px]" />
          ) : (
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate tabular-nums">{value}</span>
          {copy && (
            <CopyButton
              text={value}
              label={label}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            />
          )}
        </li>
      ))}
    </ul>
  )
}

function Stat({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5 px-3 py-2.5">
      <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="flex min-h-5 items-center">{children}</dd>
    </div>
  )
}

/** What the AI made of the conversation — first, and copied in one click. */
function Summary({ text }: { readonly text: string }) {
  return (
    <div className="border-t px-5 py-4">
      <article className="overflow-hidden rounded-xl border border-violet-500/20 bg-violet-500/[0.04] dark:bg-violet-500/[0.07]">
        <header className="flex items-center gap-2 py-2 pr-2 pl-3.5">
          <span className="flex size-6 items-center justify-center rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-300">
            <Sparkles className="size-3.5" />
          </span>
          <span className="text-xs font-semibold">{$t('Résumé de l’IA')}</span>
          <CopyButton text={text} label={$t('Copier le résumé')} className="ml-auto">
            {$t('Copier')}
          </CopyButton>
        </header>
        <p className="px-3.5 pb-3.5 text-[13px] leading-relaxed whitespace-pre-line">{text}</p>
      </article>
    </div>
  )
}

function Attribute({ attribute }: { readonly attribute: ContactAttribute }) {
  let value: ReactNode = <span className="truncate">{attribute.value}</span>
  if (attribute.kind === 'code') {
    value = (
      <span className="group inline-flex min-w-0 items-center gap-1">
        <span className="truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">
          {attribute.value}
        </span>
        <CopyButton
          text={attribute.value}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        />
      </span>
    )
  } else if (attribute.kind === 'status') {
    value = <Chip tint="sky">{attribute.value}</Chip>
  } else if (attribute.kind === 'date') {
    value = <span className="tabular-nums">{dayLabel(attribute.value)}</span>
  }
  return (
    <div className="flex min-h-8 items-center gap-3 text-[13px]">
      <span className="w-[6.75rem] shrink-0 py-1 leading-snug text-muted-foreground">
        {attribute.label}
      </span>
      <span className="flex min-w-0 flex-1 items-center">{value}</span>
    </div>
  )
}

// ── History ─────────────────────────────────────────────────────────────────────────────

/** The customer's conversations, this one first, on a line. */
function History({ conversation }: { readonly conversation: Conversation }) {
  const now = conversationState({
    ...conversation,
    handedOff: conversation.messages.some((m) => m.kind === 'handoff'),
  })
  return (
    <ol className="relative space-y-5 border-l pl-5">
      <li className="relative">
        <span className="absolute top-1 -left-[1.6875rem] size-3 rounded-full border-2 border-background bg-primary ring-1 ring-primary/40" />
        <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {$t('En cours')}
        </div>
        <div className="mt-1 text-sm font-medium">
          {conversation.intent ?? $t('Cette conversation')}
        </div>
        <div className="mt-1.5">
          <Chip tint={now.tint}>{now.label}</Chip>
        </div>
      </li>
      {conversation.history.map((past) => (
        <PastRow key={`${past.at}-${past.subject}`} past={past} />
      ))}
      {conversation.history.length === 0 && (
        <li className="text-xs text-muted-foreground">
          {$t('Première conversation de ce contact.')}
        </li>
      )}
    </ol>
  )
}

function PastRow({ past }: { readonly past: PastConversation }) {
  return (
    <li className="relative">
      <span className="absolute top-1 -left-[1.6875rem] size-3 rounded-full border-2 border-background bg-muted-foreground/40" />
      <div className="text-[11px] text-muted-foreground tabular-nums">{dayLabel(past.at)}</div>
      <div className="mt-1 text-sm">{past.subject}</div>
      <div className="mt-1.5">
        <StatusChip status={past.status} />
      </div>
    </li>
  )
}

// ── The copilot's tools ─────────────────────────────────────────────────────────────────

/** The copilot's tools — basedb's « Outils IA » and its MCP servers' — read once per page. */
let toolsOnce: Promise<ToolsOverview> | null = null
function loadTools(): Promise<ToolsOverview> {
  toolsOnce ??= api.tools().catch(() => {
    toolsOnce = null
    return { tools: [], mcp: [] }
  })
  return toolsOnce
}

interface CopilotTool extends ToolTarget {
  readonly key: string
  readonly tool: string
  readonly server?: string
  /** The MCP server's name, for a tool of one. */
  readonly source?: string
  readonly name: string
  readonly icon: LucideIcon
}

/**
 * The tools an agent may run from here: those basedb gives the copilot. Each runs with the
 * conversation's customer, and leaves its trace in the thread, as when the AI calls it.
 */
function CopilotTools({ conversationId }: { readonly conversationId: string }) {
  const [tools, setTools] = useState<CopilotTool[] | null>(null)
  const [open, setOpen] = useState<CopilotTool | null>(null)

  useEffect(() => {
    void loadTools().then((overview) =>
      setTools([
        ...overview.tools
          .filter((t) => t.copilot)
          .map((t) => ({
            key: t.id,
            tool: t.id,
            name: t.name,
            title: t.name,
            description: t.description,
            parameters: t.parameters,
            icon: t.type === 'http' ? Globe : t.type === 'callback' ? CalendarClock : FileText,
          })),
        ...overview.mcp
          .filter((m) => m.copilot)
          .flatMap((m) =>
            m.tools.map((t) => ({
              key: `${m.id}/${t.name}`,
              tool: t.name,
              server: m.id,
              source: m.name,
              name: t.name.replace(/_/g, ' '),
              title: `${m.name} › ${t.name}`,
              description: t.description,
              parameters: t.parameters,
              icon: Plug,
            })),
          ),
      ]),
    )
  }, [])

  return (
    <Section id="tools" title={$t('Outils IA')} icon={Wrench} count={tools?.length ?? 0}>
      {tools === null ? (
        <p className="text-xs text-muted-foreground">{$t('Chargement…')}</p>
      ) : tools.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {$t(
            'Aucun outil pour le copilote : ils se déclarent dans le paramétrage, « Outils IA » et « Serveurs MCP ».',
          )}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {tools.map((tool) => {
            const Icon = tool.icon
            return (
              <Hint key={tool.key} label={tool.description || tool.title}>
                <button
                  type="button"
                  onClick={() => setOpen(tool)}
                  className="group flex min-w-0 flex-col items-start gap-2 rounded-lg border bg-background p-2.5 text-left transition-[translate,box-shadow,border-color] hover:-translate-y-px hover:border-primary/30 hover:shadow-sm"
                >
                  <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                    <Icon className="size-3.5" />
                  </span>
                  <span className="w-full min-w-0">
                    <span className="line-clamp-2 text-xs leading-snug font-medium first-letter:uppercase">
                      {tool.name}
                    </span>
                    {tool.source && (
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                        {tool.source}
                      </span>
                    )}
                  </span>
                </button>
              </Hint>
            )
          })}
        </div>
      )}
      {tools && tools.length > 0 && (
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          {$tp(
            tools.length,
            '{count} outil, lancé pour ce client ; sa trace reste dans le fil.',
            '{count} outils, lancés pour ce client ; leur trace reste dans le fil.',
          )}
        </p>
      )}
      <ToolDialog
        tool={open}
        onClose={() => setOpen(null)}
        note={$t(
          'L’appel se fait pour le client de cette conversation, et reste dans son fil — visible de l’équipe seulement.',
        )}
        run={(args) =>
          api.runTool(conversationId, {
            tool: open?.tool ?? '',
            ...(open?.server ? { server: open.server } : {}),
            arguments: args,
          })
        }
      />
    </Section>
  )
}
