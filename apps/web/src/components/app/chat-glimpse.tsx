'use client'

import { Chip } from '@/components/app/chip'
import { ConversationRow } from '@/components/inbox/conversation-list'
import { ContactAvatar } from '@/components/inbox/labels'
import {
  AgentBubble,
  AiAnswer,
  AiTyping,
  EventLine,
  HandoffCard,
  VisitorBubble,
} from '@/components/inbox/messages'
import { $t } from '@/lib/i18n'
import { PRODUCT_NAME } from '@/lib/product'
import { cn } from '@/lib/utils'
import type { ConversationSummary, Feedback } from '@chat/contracts'
import {
  ArrowRightLeft,
  BookOpen,
  ChartColumn,
  ChevronRight,
  type LucideIcon,
  MessagesSquare,
  PanelLeft,
  Search,
  Sparkles,
  UsersRound,
  WandSparkles,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

/**
 * A window onto the messaging app, beside the sign-in form — basedb's glimpse, for the chat.
 *
 * Drawn with the inbox's own pieces — its rows, its bubbles, the AI's answer card, the
 * handoff card — so it follows the theme and looks like what opens next. Its people are the
 * demonstration's, never the reader's: nobody is signed in yet.
 *
 * Three small scenes play in a loop, named by the tabs above the window; a click plays one
 * from its beginning:
 * - the AI answers a question from the knowledge, with its confidence and its sources, and
 *   an agent accepts the answer;
 * - a guardrail hands an angry customer to the team, with a summary, and an agent takes over;
 * - the copilot proposes replies, the agent picks one and sends it.
 * Asked for less motion, it shows the first scene's end, still.
 */

type SceneId = 'ai' | 'handoff' | 'copilot'

/** Each scene: its tab, how long it lasts, and when its steps happen (ms from its start). */
const SCENES: ReadonlyArray<{
  readonly id: SceneId
  readonly label: string
  readonly Icon: LucideIcon
  readonly ms: number
  readonly steps: readonly number[]
}> = [
  {
    id: 'ai',
    label: $t('L’IA répond'),
    Icon: Sparkles,
    ms: 11000,
    steps: [500, 1400, 3400, 6600],
  },
  {
    id: 'handoff',
    label: $t('Elle passe la main'),
    Icon: ArrowRightLeft,
    ms: 11500,
    steps: [500, 1400, 3200, 5800, 7200],
  },
  {
    id: 'copilot',
    label: $t('Le copilote aide'),
    Icon: WandSparkles,
    ms: 10500,
    steps: [500, 1600, 3300, 6800],
  },
]

/** Which conversation each scene opens. */
const OPEN: Readonly<Record<SceneId, number>> = { ai: 0, handoff: 1, copilot: 2 }

const PEOPLE = [
  { name: 'Sophie Leroy', email: 'sophie.leroy@exemple.fr' },
  { name: 'Thomas Bernard', email: 'thomas.bernard@exemple.fr' },
  { name: 'Julie Martin', email: 'julie.martin@exemple.fr' },
  { name: 'Emma Richard', email: 'emma.richard@exemple.fr' },
] as const

const QUESTION = $t('Bonjour, quel est le délai de remboursement après un sinistre ?')
const ANSWER = $t(
  'Une fois votre dossier complet, le remboursement est versé sous 5 à 10 jours ouvrés, par virement. Vous suivez chaque étape dans votre espace client.',
)
const ANGRY = $t('Je conteste le montant proposé. Je veux parler à quelqu’un.')
const JULIE = $t('Je déménage le mois prochain : que dois-je faire pour mon contrat ?')
const SUGGESTIONS = [
  $t('Bonne nouvelle : le changement d’adresse se fait en ligne, en deux minutes.'),
  $t('Je m’en occupe : quelle est votre nouvelle adresse et la date du déménagement ?'),
  $t('Votre contrat vous suit : seule la prime peut changer selon le logement.'),
]
const PICKED = 1
const SENT = SUGGESTIONS[PICKED] ?? ''

function useScenes() {
  const [from, setFrom] = useState<{ readonly scene: SceneId; readonly asked: number }>({
    scene: 'ai',
    asked: 0,
  })
  const [scene, setScene] = useState<SceneId>('ai')
  const [step, setStep] = useState(0)
  const [cycle, setCycle] = useState(0)
  const [still, setStill] = useState(false)
  const play = useCallback(
    (next: SceneId) => setFrom((f) => ({ scene: next, asked: f.asked + 1 })),
    [],
  )

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStill(true)
      setScene(from.scene)
      setStep(99)
      return
    }
    const timers: number[] = []
    let index = Math.max(
      0,
      SCENES.findIndex((s) => s.id === from.scene),
    )
    const run = () => {
      const current = SCENES[index]
      if (!current) return
      setScene(current.id)
      setStep(0)
      setCycle((c) => c + 1)
      current.steps.forEach((at, i) => {
        timers.push(window.setTimeout(() => setStep(i + 1), at))
      })
      timers.push(
        window.setTimeout(() => {
          index = (index + 1) % SCENES.length
          run()
        }, current.ms),
      )
    }
    run()
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [from])

  return { scene, step, cycle, still, play }
}

/** The text, letter by letter, once `active` — whole at once when motion is unwelcome. */
function useTyped(text: string, active: boolean, still: boolean): string {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (!active) {
      setShown(0)
      return
    }
    if (still) {
      setShown(text.length)
      return
    }
    const timer = window.setInterval(() => setShown((n) => Math.min(n + 2, text.length)), 32)
    return () => window.clearInterval(timer)
  }, [text, active, still])
  return text.slice(0, shown)
}

/** Each new piece of the thread arrives rising, as the inbox shows a new message. */
function Arrive({ children }: { readonly children: ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both">
      {children}
    </div>
  )
}

const noop = () => {}

export function ChatGlimpse() {
  const { scene, step, cycle, still, play } = useScenes()
  const now = useRef(new Date()).current
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString()
  const clock = (minutesAgo: number) =>
    new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(now.getTime() - minutesAgo * 60_000),
    )

  const typed = useTyped(SENT, scene === 'copilot' && step >= 3, still)
  const open = OPEN[scene]
  const person = PEOPLE[open] ?? PEOPLE[0]

  // The rows, as the scenes leave them.
  const summary = (index: number, rest: Partial<ConversationSummary>): ConversationSummary => ({
    id: `glimpse-${index}`,
    contact: {
      id: `contact-${index}`,
      name: PEOPLE[index]?.name ?? '',
      email: PEOPLE[index]?.email ?? null,
      identified: index !== 3,
    },
    site: 'Acme Assurances',
    inboxId: null,
    teamId: null,
    status: 'ai',
    assignee: null,
    assigneeId: null,
    unread: false,
    handedOff: false,
    preview: '',
    previewAuthor: 'visitor',
    previewAgent: null,
    previewFiles: 0,
    lastMessageAt: at(index * 7),
    priority: 'normal',
    sentiment: null,
    tags: [],
    ...rest,
  })
  const handedOver = scene === 'handoff' && step >= 3
  const takenOver = scene === 'handoff' && step >= 4
  const rows = [
    summary(0, {
      status: 'ai',
      unread: scene === 'ai' && step >= 1 && step < 3,
      preview: scene === 'ai' && step >= 3 ? ANSWER : QUESTION,
      previewAuthor: scene === 'ai' && step >= 3 ? 'ai' : 'visitor',
    }),
    summary(1, {
      status: takenOver ? 'open' : handedOver ? 'open' : 'ai',
      handedOff: handedOver,
      assignee: takenOver ? 'Marc' : null,
      unread: handedOver && !takenOver,
      preview: ANGRY,
    }),
    summary(2, {
      status: 'open',
      assignee: 'Marc',
      preview: scene === 'copilot' && step >= 4 ? SENT : JULIE,
      previewAuthor: scene === 'copilot' && step >= 4 ? 'agent' : 'visitor',
      previewAgent: 'Marc',
    }),
    summary(3, {
      status: 'open',
      unread: true,
      preview: $t('Comment changer d’adresse ? Je n’arrive pas à me connecter.'),
    }),
  ]

  const accepted: Feedback | null = scene === 'ai' && step >= 4 ? 'accepted' : null
  const waiting = handedOver && !takenOver ? 2 : 1

  return (
    <div className="relative hidden flex-col overflow-hidden border-l bg-surface lg:flex">
      <div className="px-[12%] pt-[max(2.5rem,7vh)] pb-8 short:pb-6">
        <h2 className="max-w-lg animate-in fade-in slide-in-from-bottom-2 text-[1.75rem] leading-tight font-semibold tracking-tight text-balance duration-500 fill-mode-both [animation-delay:120ms]">
          {$t('Chaque client a sa réponse, à toute heure.')}
        </h2>
        <p className="mt-3 max-w-lg animate-in fade-in slide-in-from-bottom-2 text-[15px] leading-relaxed text-muted-foreground duration-500 fill-mode-both [animation-delay:220ms]">
          {$t(
            'L’IA répond à partir de vos articles et passe la main dès qu’elle doute, avec un résumé. Vos conseillers reprennent, transfèrent, et le copilote leur souffle la suite.',
          )}
        </p>
        <div className="mt-6 flex flex-wrap gap-2 short:mt-4">
          {SCENES.map((s, i) => {
            const on = s.id === scene
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => play(s.id)}
                className={cn(
                  'relative flex cursor-pointer animate-in fade-in slide-in-from-bottom-1 items-center gap-1.5 overflow-hidden rounded-full border px-3 py-1.5 text-xs font-medium outline-none transition-colors duration-300 fill-mode-both focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  on
                    ? 'border-primary/30 bg-background text-foreground shadow-xs'
                    : 'border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground',
                )}
                style={{ animationDelay: `${320 + i * 70}ms` }}
              >
                <s.Icon className={cn('size-3.5', on && 'text-primary')} />
                {s.label}
                {on && !still && <Progress key={cycle} ms={s.ms} />}
              </button>
            )
          })}
        </div>
      </div>

      {/* The window: it runs off the right edge, as a glimpse does — and stops at the bottom,
          where the reply field and its suggestions are. */}
      <div aria-hidden="true" inert className="relative flex-1">
        <div className="absolute top-0 -right-12 -bottom-px left-[12%] flex animate-in fade-in slide-in-from-bottom-10 overflow-hidden rounded-tl-xl border bg-background shadow-[0_32px_80px_-24px_rgb(0_0_0/0.28)] duration-700 ease-out fill-mode-both [animation-delay:250ms]">
          <nav className="hidden w-44 shrink-0 flex-col border-r bg-sidebar text-[13px] 2xl:flex">
            <div className="flex items-center gap-2.5 p-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 ring-1 ring-primary/10 ring-inset">
                <MessagesSquare
                  className="size-4"
                  style={{ color: 'color-mix(in oklab, var(--primary) 65%, var(--foreground))' }}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{PRODUCT_NAME}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {$t('Tous les sites')}
                </span>
              </span>
            </div>
            <div className="flex flex-col gap-0.5 px-2">
              <NavLine icon={MessagesSquare} label={$t('Conversations')} count={waiting} active />
              {(
                [
                  [$t('Service client'), '#2563EB', 1],
                  [$t('Sinistres'), '#EA580C', 0],
                  [$t('Réclamations'), '#DB2777', handedOver && !takenOver ? 1 : 0],
                ] as const
              ).map(([label, color, count]) => (
                <div
                  key={label}
                  className="flex h-7 items-center gap-2.5 rounded-lg pr-2 pl-7 text-muted-foreground"
                >
                  <span className="size-2 rounded-full" style={{ background: color }} />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {count > 0 && (
                    <span
                      key={`${label}-${count}`}
                      className="animate-in zoom-in-50 rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary tabular-nums duration-300"
                    >
                      {count}
                    </span>
                  )}
                </div>
              ))}
              <NavLine icon={UsersRound} label={$t('Contacts')} />
              <NavLine icon={BookOpen} label={$t('Connaissance')} />
              <NavLine icon={ChartColumn} label={$t('Statistiques')} />
            </div>
          </nav>

          <div className="flex w-64 shrink-0 flex-col border-r">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
              <span className="flex h-8 flex-1 items-center gap-2 rounded-lg border bg-muted/40 px-2.5 text-xs text-muted-foreground">
                <Search className="size-3.5" />
                {$t('Rechercher une conversation…')}
              </span>
            </div>
            {rows.map((row, index) => (
              <ConversationRow
                key={row.id}
                summary={row}
                me={null}
                selected={index === open}
                time={clock(index * 7)}
                onSelect={noop}
              />
            ))}
          </div>

          <div className="flex min-w-[24rem] flex-1 flex-col bg-surface">
            <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-5 text-[13px]">
              <PanelLeft className="size-4 text-muted-foreground 2xl:hidden" />
              <ContactAvatar name={person.name} online />
              <span key={scene} className="min-w-0 animate-in fade-in duration-300">
                <span className="block font-semibold">{person.name}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: handedOver ? '#DB2777' : '#2563EB' }}
                  />
                  {handedOver ? $t('Réclamations') : $t('Service client')}
                  <ChevronRight className="size-3" />
                  {$t('Support')}
                </span>
              </span>
              <span className="shrink-0">
                {scene === 'ai' || (scene === 'handoff' && !handedOver) ? (
                  <Chip tint="violet">
                    <Sparkles />
                    {$t('IA en cours')}
                  </Chip>
                ) : handedOver && !takenOver ? (
                  <Chip tint="amber">{$t('Transférée')}</Chip>
                ) : (
                  <Chip tint="sky">{$t('Ouverte')}</Chip>
                )}
              </span>
            </header>

            <div key={`${scene}-${cycle}`} className="flex-1 space-y-4 overflow-hidden px-5 py-5">
              {scene === 'ai' && (
                <>
                  {step >= 1 && (
                    <Arrive>
                      <VisitorBubble
                        name={person.name}
                        message={{
                          id: 'q',
                          at: at(1),
                          kind: 'visitor',
                          body: QUESTION,
                          attachments: [],
                        }}
                      />
                    </Arrive>
                  )}
                  {step === 2 && <AiTyping />}
                  {step >= 3 && (
                    <Arrive>
                      <AiAnswer
                        onFeedback={noop}
                        message={{
                          id: 'a',
                          at: at(0),
                          kind: 'ai',
                          body: ANSWER,
                          confidence: 0.92,
                          feedback: accepted,
                          sources: [
                            {
                              title: $t('Délai de remboursement d’un sinistre'),
                              origin: 'article',
                              detail: $t('Article · Remboursements'),
                            },
                            {
                              title: $t('Conversations similaires'),
                              origin: 'conversation',
                              detail: $t('3 réponses promues'),
                              validated: true,
                            },
                          ],
                        }}
                      />
                    </Arrive>
                  )}
                </>
              )}

              {scene === 'handoff' && (
                <>
                  {step >= 1 && (
                    <Arrive>
                      <VisitorBubble
                        name={person.name}
                        message={{
                          id: 'q',
                          at: at(2),
                          kind: 'visitor',
                          body: ANGRY,
                          attachments: [],
                        }}
                      />
                    </Arrive>
                  )}
                  {step === 2 && <AiTyping />}
                  {step >= 3 && (
                    <Arrive>
                      <HandoffCard
                        message={{
                          id: 'h',
                          at: at(1),
                          kind: 'handoff',
                          reason: $t('Garde-fou : Litiges et réclamations'),
                          summary: $t(
                            'Conteste le montant d’indemnisation proposé pour le sinistre du 12 septembre. Souhaite un échange avec un conseiller.',
                          ),
                          confidence: 0.41,
                          assignee: '',
                          team: $t('Support'),
                        }}
                      />
                    </Arrive>
                  )}
                  {step >= 4 && (
                    <Arrive>
                      <EventLine
                        message={{
                          id: 't',
                          at: at(0),
                          kind: 'event',
                          event: { type: 'takeover', agent: 'Marc' },
                        }}
                      />
                    </Arrive>
                  )}
                  {step >= 5 && (
                    <Arrive>
                      <AgentBubble
                        message={{
                          id: 'r',
                          at: at(0),
                          kind: 'agent',
                          author: 'Marc',
                          body: $t(
                            'Bonjour Thomas, je reprends votre dossier : regardons ensemble le montant proposé.',
                          ),
                          attachments: [],
                        }}
                      />
                    </Arrive>
                  )}
                </>
              )}

              {scene === 'copilot' && (
                <>
                  <VisitorBubble
                    name={person.name}
                    message={{ id: 'q', at: at(3), kind: 'visitor', body: JULIE, attachments: [] }}
                  />
                  {step >= 4 && (
                    <Arrive>
                      <AgentBubble
                        message={{
                          id: 'r',
                          at: at(0),
                          kind: 'agent',
                          author: 'Marc',
                          body: SENT,
                          attachments: [],
                        }}
                      />
                    </Arrive>
                  )}
                </>
              )}
            </div>

            <Composer
              suggestions={scene === 'copilot' && step >= 2 && step < 4}
              picked={scene === 'copilot' && step >= 3 ? PICKED : null}
              text={scene === 'copilot' && step < 4 ? typed : ''}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function NavLine({
  icon: Icon,
  label,
  count = 0,
  active = false,
}: {
  readonly icon: LucideIcon
  readonly label: string
  readonly count?: number
  readonly active?: boolean
}) {
  return (
    <div
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-lg px-2',
        active && 'bg-sidebar-accent font-medium',
      )}
    >
      <Icon
        className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && (
        <span
          key={count}
          className="animate-in zoom-in-50 rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary tabular-nums duration-300"
        >
          {count}
        </span>
      )}
    </div>
  )
}

/** The reply field, as the inbox draws it: the copilot's proposals above it, when there are. */
function Composer({
  suggestions,
  picked,
  text,
}: {
  readonly suggestions: boolean
  readonly picked: number | null
  readonly text: string
}) {
  return (
    <div className="shrink-0 border-t bg-background">
      <div className="flex h-10 items-center gap-5 px-5 text-[13px]">
        <span className="relative flex h-full items-center font-medium after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary">
          {$t('Répondre')}
        </span>
        <span className="text-muted-foreground">{$t('Note interne')}</span>
      </div>
      {suggestions && (
        <div className="animate-in fade-in slide-in-from-bottom-1 px-5 pb-2 duration-300">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-violet-700 uppercase dark:text-violet-300">
            <WandSparkles className="size-3.5" />
            {$t('Suggestions du copilote')}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {SUGGESTIONS.map((suggestion, index) => (
              <span
                key={suggestion}
                className={cn(
                  'rounded-lg border px-2.5 py-2 text-[11px] leading-snug transition-colors duration-300',
                  index === picked
                    ? 'border-primary/50 bg-primary/5 text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                <span className="line-clamp-3">{suggestion}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="mx-5 mb-4 min-h-16 rounded-xl border px-3 py-2.5 text-sm">
        {text ? (
          <span>
            {text}
            <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-foreground" />
          </span>
        ) : (
          <span className="text-muted-foreground">
            {$t('Écrire au visiteur — « / » pour une réponse type…')}
          </span>
        )}
      </div>
    </div>
  )
}

function Progress({ ms }: { readonly ms: number }) {
  const bar = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const animation = bar.current?.animate(
      [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: ms, easing: 'linear', fill: 'forwards' },
    )
    return () => animation?.cancel()
  }, [ms])
  return (
    <span
      ref={bar}
      className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-primary/60"
    />
  )
}
