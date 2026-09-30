import type {
  VisitorConversation,
  WidgetAppearance,
  WidgetMessage,
  WidgetSession,
  WidgetSite,
} from '@chat/contracts'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { type Backend, WidgetFailure } from './api'
import { clock, setLanguage, t, when } from './i18n'
import { ChatIcon, ChevronDownIcon, CloseIcon, Orb, SendIcon } from './icons'
import { Markdown } from './markdown'
import type { Scene } from './preview'

/** Black or white words on the site's colour, whichever reads. */
function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * lin(r ?? 0) + 0.7152 * lin(g ?? 0) + 0.0722 * lin(b ?? 0)
  return luminance > 0.45 ? '#18181b' : '#ffffff'
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

/** A message's words without its Markdown marks, for a one-line preview. */
const plain = (body: string) => body.replace(/[*`#]|\[([^\]]*)\]\([^)]*\)/g, '$1').trim()

const OPEN_KEY = 'messagerie:open'
const NUDGED_KEY = 'messagerie:nudged'

const STACKS = {
  system:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", Quicksand, system-ui, sans-serif',
  serif: 'ui-serif, "Iowan Old Style", Charter, Georgia, "Times New Roman", serif',
} as const

/** The font the site chose — never one the widget loads: the page's, or one it has. */
function fontOf(look: WidgetAppearance, pageFont: string | null): string | undefined {
  if (look.font === 'site') return pageFont ?? undefined
  if (look.font === 'custom')
    return look.customFont ? `"${look.customFont}", ${STACKS.system}` : undefined
  return STACKS[look.font]
}

function remember(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    // Forgotten at the next page, nothing more.
  }
}

function wasOpen(): boolean {
  try {
    return window.sessionStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

/** Who says a run of messages: the visitor, the AI, an agent, or the site (its welcome). */
type Speaker = 'visitor' | 'ai' | 'agent' | 'site'

interface Line {
  readonly id: string
  readonly body: string
  readonly at: string | null
}

type Item =
  | {
      readonly kind: 'group'
      readonly key: string
      readonly from: Speaker
      readonly author: string | null
      readonly lines: Line[]
    }
  | { readonly kind: 'event'; readonly key: string; readonly text: string }

function eventText(message: Extract<WidgetMessage, { from: 'event' }>): string {
  if (message.event === 'joined')
    return message.author
      ? t('{name} a rejoint la conversation', { name: message.author })
      : t('Un conseiller a rejoint la conversation')
  if (message.event === 'handoff') return t('Un conseiller va reprendre votre demande')
  return t('Conversation terminée')
}

/** Messages in runs: one avatar, one name, one time for what a speaker says in a row. */
function itemsOf(welcome: Line & { from: Speaker }, messages: readonly WidgetMessage[]): Item[] {
  const items: Item[] = [
    { kind: 'group', key: welcome.id, from: welcome.from, author: null, lines: [welcome] },
  ]
  for (const message of messages) {
    if (message.from === 'event') {
      items.push({ kind: 'event', key: message.id, text: eventText(message) })
      continue
    }
    const author = message.from === 'agent' ? message.author : null
    const line = { id: message.id, body: message.body, at: message.at }
    const last = items[items.length - 1]
    if (last?.kind === 'group' && last.from === message.from && last.author === author)
      last.lines.push(line)
    else items.push({ kind: 'group', key: message.id, from: message.from, author, lines: [line] })
  }
  return items
}

interface Preview {
  readonly from: 'ai' | 'agent' | 'site'
  readonly author: string | null
  readonly body: string
}

const welcomeOf = (site: WidgetSite) =>
  site.welcome ?? t('Bonjour ! Comment pouvons-nous vous aider ?')

/** The welcome, beside the launcher: the site's nudge. */
const nudgeOf = (site: WidgetSite): Preview => ({
  from: site.ai ? 'ai' : 'site',
  author: site.ai ? null : site.name,
  body: welcomeOf(site),
})

export interface Controls {
  open: () => void
  close: () => void
}

export function App({
  api,
  identity,
  poweredBy,
  pageFont,
  bind,
  watch,
}: {
  readonly api: Backend
  readonly identity: string | null
  readonly poweredBy: string
  /** The page's own font, for a site that keeps it. */
  readonly pageFont: string | null
  /** Hands the page `window.MessagerieChat.open()` and `.close()`. */
  readonly bind: (controls: Controls) => void
  /** In the inbox's editor: the site as it is edited, and the scene to show. */
  readonly watch?: (onChange: (session: WidgetSession, scene: Scene) => void) => () => void
}) {
  const inEditor = watch !== undefined
  const [session, setSession] = useState<WidgetSession | null>(null)
  const [conversation, setConversation] = useState<VisitorConversation | null>(null)
  const [open, setOpen] = useState(() => !inEditor && wasOpen())
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typing, setTyping] = useState<'ai' | 'agent' | null>(null)
  const [unread, setUnread] = useState(0)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [following, setFollowing] = useState(false)
  const seen = useRef(new Set<string>())
  const thread = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const focusOnOpen = useRef(false)
  const scene = useRef<Scene | null>(null)
  const openRef = useRef(open)
  openRef.current = open

  const showTyping = (who: 'ai' | 'agent' | null, ms = 12_000) => {
    clearTimeout(typingTimer.current)
    setTyping(who)
    if (who) typingTimer.current = setTimeout(() => setTyping(null), ms)
  }

  // A conversation read again: what the team or the AI said while the panel was closed counts.
  const apply = (next: VisitorConversation | null) => {
    setConversation(next)
    if (!next) return
    let fresh: Preview | null = null
    let count = 0
    for (const message of next.messages) {
      if (seen.current.has(message.id)) continue
      seen.current.add(message.id)
      if (message.from === 'ai' || message.from === 'agent') {
        count++
        fresh = {
          from: message.from,
          author: message.from === 'agent' ? message.author : null,
          body: message.body,
        }
      }
    }
    if (count > 0) showTyping(null)
    if (!openRef.current && fresh) {
      setUnread((unread) => unread + count)
      setPreview(fresh)
    }
  }

  useEffect(() => {
    api
      .session(identity)
      .then((opened) => {
        setLanguage(opened.site.language)
        for (const message of opened.conversation?.messages ?? []) seen.current.add(message.id)
        setSession(opened)
        setConversation(opened.conversation)
        if (opened.conversation) setFollowing(true)
      })
      .catch((failure: unknown) => {
        // A site that does not allow this page shows nothing; the page's console says why.
        console.warn('Messagerie :', failure instanceof WidgetFailure ? failure.code : failure)
      })
  }, [api, identity])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `apply` reads refs and setters only
  useEffect(() => {
    if (!following) return
    return api.follow((event) => {
      if (event.type === 'conversation')
        api
          .conversation()
          .then(apply)
          .catch(() => {})
      else if (event.type === 'typing') showTyping(event.who)
    })
  }, [api, following])

  useEffect(() => {
    bind({ open: () => show(true), close: () => show(false) })
  }, [bind])

  // The editor's site, as it changes; a new scene opens or closes the panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setters and refs only
  useEffect(() => {
    if (!watch) return
    return watch((next, nextScene) => {
      setLanguage(next.site.language)
      for (const message of next.conversation?.messages ?? []) seen.current.add(message.id)
      setSession(next)
      setConversation(next.conversation)
      setFollowing(true)
      if (scene.current === nextScene) return
      scene.current = nextScene
      showTyping(null)
      setError(null)
      setOpen(nextScene === 'welcome' || nextScene === 'conversation')
      setPreview(nextScene === 'nudge' ? nudgeOf(next.site) : null)
    })
  }, [watch])

  // The site's nudge: its welcome beside the launcher, once a visit, to a visitor who has
  // not written yet.
  useEffect(() => {
    const after = session?.site.appearance.nudgeAfter
    if (!session || inEditor || after == null || session.conversation) return
    try {
      if (window.sessionStorage.getItem(NUDGED_KEY) === '1') return
    } catch {
      // Without storage, the nudge may show on every page: still once per page.
    }
    const timer = setTimeout(() => {
      if (openRef.current) return
      setPreview(nudgeOf(session.site))
      remember(NUDGED_KEY, '1')
    }, after * 1000)
    return () => clearTimeout(timer)
  }, [session, inEditor])

  // The newest message in view — after each message, the typing dots, and on opening.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers
  useLayoutEffect(() => {
    const element = thread.current
    if (element) element.scrollTop = element.scrollHeight
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false
      field.current?.focus()
    }
  }, [conversation, typing, open])

  function show(next: boolean) {
    setOpen(next)
    if (next) {
      setUnread(0)
      setPreview(null)
      focusOnOpen.current = true
    }
    // The panel remembers it was open, from page to page — not in the editor.
    if (!inEditor) remember(OPEN_KEY, next ? '1' : '0')
  }

  async function send(text = draft) {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      const next = await api.send(body)
      setDraft('')
      if (field.current) field.current.style.height = 'auto'
      apply(next)
      setFollowing(true)
      // The AI is writing — until its answer arrives, or half a minute has passed.
      if (next.answeredBy === 'ai') showTyping('ai', 30_000)
    } catch (failure) {
      setError(
        failure instanceof WidgetFailure && failure.code === 'RATE_LIMITED'
          ? t('Trop de messages d’un coup : patientez un instant.')
          : t('Le message n’est pas parti. Réessayez.'),
      )
    } finally {
      setSending(false)
    }
  }

  if (!session) return null
  const { site, availability, contact } = session
  const look = site.appearance
  const messages = conversation?.messages ?? []
  // Nobody to answer, and the site would rather show nothing then.
  if (look.hideWhenAway && !inEditor && !site.ai && !availability.open && messages.length === 0)
    return null
  const font = fontOf(look, pageFont)
  const style = {
    '--accent': site.color,
    '--accent-ink': textOn(site.color),
    '--x': `${look.offsetX}px`,
    '--y': `${look.offsetY}px`,
    ...(font ? { '--font': font } : {}),
  }
  const classes = [
    'root',
    look.position === 'left' && 'left',
    look.theme !== 'auto' && look.theme,
    look.corners !== 'round' && look.corners,
    look.hideOnMobile && !inEditor && 'hide-mobile',
  ]
    .filter(Boolean)
    .join(' ')
  const labelled = look.launcher === 'label' && look.launcherLabel !== null && !open
  const started = messages.some((message) => message.from === 'visitor')
  const answeredBy = conversation?.answeredBy ?? (site.ai ? 'ai' : 'team')
  const lastAgent = [...messages].reverse().find((message) => message.from === 'agent')
  const status =
    answeredBy === 'ai'
      ? t('L’assistant répond tout de suite')
      : !availability.open
        ? availability.nextOpening
          ? t('Conseillers de retour {when}', { when: when(availability.nextOpening) })
          : t('Conseillers absents pour le moment')
        : answeredBy === 'team' && conversation
          ? t('Un conseiller vous répond')
          : t('Nos conseillers répondent en quelques minutes')
  const firstName = contact.identified ? contact.name?.split(/\s+/)[0] : undefined
  const title = site.title
    ? site.title.replace(/\s*\{prénom\}/gu, firstName ? ` ${firstName}` : '').trim()
    : firstName
      ? t('Bonjour {name}', { name: firstName })
      : t('Comment pouvons-nous vous aider ?')
  const tagline =
    site.tagline ??
    (site.ai
      ? t('Notre assistant IA répond tout de suite. Un conseiller prend le relais si besoin.')
      : status)
  const items = itemsOf(
    { id: 'welcome', from: site.ai ? 'ai' : 'site', body: welcomeOf(site), at: null },
    messages,
  )
  const avatarOf = (from: Speaker, author: string | null, busy = false) =>
    from === 'ai' ? (
      <Orb busy={busy} />
    ) : from === 'site' && look.logo ? (
      <img class="person-avatar" src={look.logo} alt="" />
    ) : (
      <span class="person-avatar">{initials(author ?? site.name)}</span>
    )

  return (
    <div class={classes} style={style}>
      {open && (
        <dialog
          class="panel"
          open
          aria-label={site.name}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              show(false)
              launcher.current?.focus()
            }
          }}
        >
          <header class={started ? 'head compact' : 'head'}>
            <div class="bar">
              <div class="people">
                {look.logo && <img class="logo" src={look.logo} alt="" />}
                {site.ai && <Orb busy={typing === 'ai'} size={30} />}
                {site.team.map((name) => (
                  <span key={name} class="person" title={name}>
                    {initials(name)}
                  </span>
                ))}
                {!site.ai && site.team.length === 0 && !look.logo && (
                  <span class="person">{initials(site.name)}</span>
                )}
              </div>
              <div>
                <div class="name">{site.name}</div>
                {started && (
                  <div class="status">
                    <span class={availability.open || answeredBy === 'ai' ? 'dot' : 'dot away'} />
                    {status}
                  </div>
                )}
              </div>
              <button
                type="button"
                class="close"
                aria-label={t('Fermer la conversation')}
                onClick={() => show(false)}
              >
                <ChevronDownIcon />
              </button>
            </div>
            {!started && (
              <div class="greeting">
                <h2>{title}</h2>
                <p>{tagline}</p>
              </div>
            )}
          </header>

          {availability.closureMessage && <div class="notice">{availability.closureMessage}</div>}

          <div class="thread" ref={thread} aria-live="polite">
            {items.map((item) =>
              item.kind === 'event' ? (
                <div key={item.key} class="event">
                  {item.text}
                </div>
              ) : (
                <Group
                  key={item.key}
                  from={item.from}
                  name={
                    item.from === 'ai'
                      ? t('Assistant')
                      : item.from === 'site'
                        ? site.name
                        : item.author
                  }
                  avatar={avatarOf(item.from, item.author)}
                  lines={item.lines}
                />
              ),
            )}
            {!started && site.suggestions.length > 0 && (
              <div class="replies" aria-label={t('Questions fréquentes')}>
                {site.suggestions.map((question, index) => (
                  <button
                    key={question}
                    type="button"
                    class="reply"
                    style={{ animationDelay: `${120 + index * 60}ms` }}
                    disabled={sending}
                    onClick={() => void send(question)}
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}
            {typing && (
              <div class="group">
                <span class="avatar-slot">
                  {typing === 'ai'
                    ? avatarOf('ai', null, true)
                    : avatarOf('agent', lastAgent?.from === 'agent' ? lastAgent.author : null)}
                </span>
                <div class="stack">
                  <output class="bubble tail typing" aria-label={t('En train d’écrire…')}>
                    <span />
                    <span />
                    <span />
                  </output>
                </div>
              </div>
            )}
          </div>

          <form
            class="composer"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            {error && <div class="error">{error}</div>}
            <div class="field">
              <textarea
                ref={field}
                rows={1}
                value={draft}
                maxLength={4000}
                placeholder={t('Écrivez votre message…')}
                aria-label={t('Écrivez votre message…')}
                onInput={(event) => {
                  const element = event.currentTarget
                  setDraft(element.value)
                  element.style.height = 'auto'
                  element.style.height = `${Math.min(element.scrollHeight, 128)}px`
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <button
                type="submit"
                class="send"
                aria-label={t('Envoyer')}
                disabled={!draft.trim() || sending}
              >
                <SendIcon />
              </button>
            </div>
            {look.branding && (
              <div class="foot">{t('Propulsé par {name}', { name: poweredBy })}</div>
            )}
          </form>
        </dialog>
      )}

      {!open && preview && (
        <div class="preview" aria-live="polite">
          <button type="button" class="preview-body" onClick={() => show(true)}>
            <span class="avatar-slot">{avatarOf(preview.from, preview.author)}</span>
            <span>
              <span class="who">{preview.from === 'ai' ? t('Assistant IA') : preview.author}</span>
              <span class="text">{plain(preview.body)}</span>
            </span>
          </button>
          <button
            type="button"
            class="dismiss"
            aria-label={t('Masquer')}
            onClick={() => {
              setPreview(null)
              if (!inEditor) remember(NUDGED_KEY, '1')
            }}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      <button
        ref={launcher}
        type="button"
        class={['launcher', open && 'open', labelled && 'labelled'].filter(Boolean).join(' ')}
        aria-label={open ? t('Fermer la conversation') : t('Ouvrir la conversation')}
        aria-expanded={open}
        onClick={() => show(!open)}
      >
        <span class="icon when-closed">
          <ChatIcon />
        </span>
        <span class="icon when-open">
          <ChevronDownIcon />
        </span>
        {labelled && <span class="label">{look.launcherLabel}</span>}
        {!open && unread > 0 && <span class="badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
    </div>
  )
}

function Group({
  from,
  name,
  avatar,
  lines,
}: {
  readonly from: Speaker
  readonly name: string | null
  readonly avatar: preact.ComponentChild
  readonly lines: readonly Line[]
}) {
  const mine = from === 'visitor'
  const at = lines[lines.length - 1]?.at ?? null
  const classes = ['group', mine && 'mine', at && 'timed'].filter(Boolean).join(' ')
  return (
    <div class={classes}>
      {!mine && <span class="avatar-slot">{avatar}</span>}
      <div class="stack">
        {!mine && name && (
          <div class="author">
            {name}
            {from === 'ai' && (
              <span class="ai-tag" title={t('Réponse générée par une IA')}>
                IA
              </span>
            )}
          </div>
        )}
        {lines.map((line, index) => (
          <div key={line.id} class={index === lines.length - 1 ? 'bubble tail' : 'bubble'}>
            {mine ? line.body : <Markdown text={line.body} />}
          </div>
        ))}
        {at && <div class="time">{clock(at)}</div>}
      </div>
    </div>
  )
}
