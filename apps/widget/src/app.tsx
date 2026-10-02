import type {
  PageCallStatus,
  VisitorConversation,
  WidgetAppearance,
  WidgetAttachment,
  WidgetMessage,
  WidgetSession,
  WidgetSite,
} from '@chat/contracts'
import { Fragment } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { type Backend, WidgetFailure } from './api'
import { clock, setLanguage, t, when } from './i18n'
import {
  ChatIcon,
  ChevronDownIcon,
  CloseIcon,
  FileIcon,
  MailIcon,
  Orb,
  PaperclipIcon,
  SendIcon,
  SmileIcon,
  SparkIcon,
} from './icons'
import { Markdown } from './markdown'
import type { Commands, Data, PageBridge, PageEvent } from './page-api'
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
  readonly attachments?: readonly WidgetAttachment[]
  /** Deleted for everyone: said so, in its place. */
  readonly deleted?: true
}

/** What the widget sends: what the server keeps — images, PDF, text and office files. */
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,.txt,.csv,.md,.docx,.xlsx'
const MAX_BYTES = 10 * 1024 * 1024
const MAX_FILES = 5

/** The emoji a visitor reaches for: the system draws them, nothing is loaded. */
const EMOJI =
  '😀 😊 🙂 😉 😍 🥰 😎 🤗 🤔 😅 😂 😇 🙃 😌 😢 😭 😤 😡 😱 😳 🙄 😴 👍 👎 👌 🙏 👏 🙌 👋 💪 🤝 ❤️ 💯 ✅ ❌ ⚠️ ❓ ⭐ 🎉 🔥 📄 📎 📷 📞 🏠 🚗 🔑 💶 📅'.split(
    ' ',
  )

const sizeOf = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 })} Mo`
    : `${Math.max(1, Math.round(bytes / 1024))} Ko`

type Item =
  | {
      readonly kind: 'group'
      readonly key: string
      readonly from: Speaker
      readonly author: string | null
      readonly lines: Line[]
    }
  | { readonly kind: 'event'; readonly key: string; readonly text: string }
  | {
      readonly kind: 'action'
      readonly key: string
      readonly call: string
      readonly name: string
      readonly label: string
      readonly args: Readonly<Record<string, unknown>>
      readonly status: PageCallStatus
    }
  | {
      readonly kind: 'email'
      readonly key: string
      readonly text: string | null
      readonly email: string | null
    }

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
    if (message.from === 'action') {
      items.push({
        kind: 'action',
        key: message.id,
        call: message.call,
        name: message.name,
        label: message.label,
        args: message.args,
        status: message.status,
      })
      continue
    }
    if (message.from === 'email') {
      items.push({ kind: 'email', key: message.id, text: message.text, email: message.email })
      continue
    }
    const author = message.from === 'agent' ? message.author : null
    const line = {
      id: message.id,
      body: message.body,
      at: message.at,
      ...(message.attachments ? { attachments: message.attachments } : {}),
      ...(message.deleted ? { deleted: true as const } : {}),
    }
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

export function App({
  api,
  identity,
  poweredBy,
  pageFont,
  bind,
  emit,
  watch,
  page,
}: {
  readonly api: Backend
  readonly identity: string | null
  readonly poweredBy: string
  /** The page's own font, for a site that keeps it. */
  readonly pageFont: string | null
  /** Hands the page its commands (`window.MessagerieChat`), once the session is open. */
  readonly bind: (commands: Commands) => void
  /** Tells the page what happened: opened, closed, a message sent or received. */
  readonly emit: (event: PageEvent, detail?: unknown) => void
  /** In the inbox's editor: the site as it is edited, and the scene to show. */
  readonly watch?: (onChange: (session: WidgetSession, scene: Scene) => void) => () => void
  /** The page's actions and context (D21) — none in the editor. */
  readonly page?: PageBridge
}) {
  const inEditor = watch !== undefined
  const [session, setSession] = useState<WidgetSession | null>(null)
  const [conversation, setConversation] = useState<VisitorConversation | null>(null)
  const [open, setOpen] = useState(() => !inEditor && wasOpen())
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  /** Files to send with the next message. */
  const [files, setFiles] = useState<File[]>([])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [dropping, setDropping] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [typing, setTyping] = useState<'ai' | 'agent' | null>(null)
  const [unread, setUnread] = useState(0)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [following, setFollowing] = useState(false)
  /** `MessagerieChat.hide()`: nothing on the page until `show()`. */
  const [hidden, setHidden] = useState(false)
  /** Metadata the page set before the conversation began: sent with its first message. */
  const pendingData = useRef<Record<string, Data[string]>>({})
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {})
  const resetRef = useRef<(forget: boolean) => Promise<void>>(async () => {})
  const conversationRef = useRef<VisitorConversation | null>(null)
  conversationRef.current = conversation
  const seen = useRef(new Set<string>())
  const thread = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** The first name of the agent typing, when the server said it. */
  const typingName = useRef<string | null>(null)
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
      if (message.from === 'ai' || message.from === 'agent' || message.from === 'site') {
        count++
        fresh = {
          from: message.from,
          author: message.from === 'agent' ? message.author : null,
          body: message.body,
        }
        emit('message:received', {
          from: message.from,
          author: message.from === 'agent' ? message.author : null,
          body: message.body,
          at: message.at,
        })
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
      // An agent says it every few seconds while they write: their silence is soon read.
      else if (event.type === 'typing') {
        typingName.current = event.name ?? null
        showTyping(event.who, event.who === 'agent' ? 6000 : 12_000)
      }
    })
  }, [api, following])

  // The page's commands, once the session is open: what it called earlier runs now.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the commands read refs, the session is the trigger
  useEffect(() => {
    if (!session || inEditor) return
    const failed = (failure: unknown) =>
      console.warn('Messagerie :', failure instanceof WidgetFailure ? failure.code : failure)
    bind({
      open: () => show(true),
      close: () => show(false),
      toggle: () => show(!openRef.current),
      isOpen: () => openRef.current,
      show: () => setHidden(false),
      hide: () => {
        setHidden(true)
        show(false)
      },
      setMessage: (text) => setDraft(String(text ?? '')),
      send: (text) => void sendRef.current(String(text ?? '')),
      setUser: (profile) => void api.updateContact({ ...profile }).catch(failed),
      setContactData: (data) => void api.updateContact({ data }).catch(failed),
      setConversationData: (data) => {
        if (conversationRef.current) void api.updateConversation(data).catch(failed)
        else pendingData.current = { ...pendingData.current, ...data }
      },
      reset: (options) => void resetRef.current(options?.visitor === true).catch(failed),
    })
    emit('ready')
  }, [session === null])

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
    if (next !== openRef.current) emit(next ? 'open' : 'close')
    setOpen(next)
    if (next) {
      setUnread(0)
      setPreview(null)
      focusOnOpen.current = true
    }
    // The panel remembers it was open, from page to page — not in the editor.
    if (!inEditor) remember(OPEN_KEY, next ? '1' : '0')
  }

  function addFiles(chosen: readonly File[]) {
    if (chosen.length === 0) return
    const fitting = chosen.filter((file) => file.size <= MAX_BYTES)
    setFiles((current) => [...current, ...fitting].slice(0, MAX_FILES))
    setError(
      fitting.length < chosen.length
        ? t('Fichier refusé : images, PDF ou documents, 10 Mo au plus.')
        : files.length + fitting.length > MAX_FILES
          ? t('Cinq fichiers au plus par message.')
          : null,
    )
    field.current?.focus()
  }

  function addEmoji(emoji: string) {
    const element = field.current
    const at = element?.selectionStart ?? draft.length
    const end = element?.selectionEnd ?? at
    setDraft(draft.slice(0, at) + emoji + draft.slice(end))
    setEmojiOpen(false)
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(at + emoji.length, at + emoji.length)
    })
  }

  // ── The page's actions (D21) ──────────────────────────────────────────────
  /** This tab, among the visitor's: the one that takes a call runs it. */
  const tab = useRef(Math.random().toString(36).slice(2, 12))
  /** Calls this tab has taken up already. */
  const handled = useRef(new Set<string>())

  /** Takes the call, runs it on the page, says how it went. */
  async function runAction(call: string, name: string, args: Readonly<Record<string, unknown>>) {
    if (!page || handled.current.has(call)) return
    handled.current.add(call)
    try {
      if (!(await api.claimAction(call, tab.current))) return
      let answer: { ok: boolean; result?: unknown; error?: string }
      try {
        answer = { ok: true, result: (await page.run(name, { ...args })) ?? null }
      } catch (failure) {
        answer = { ok: false, error: failure instanceof Error ? failure.message : String(failure) }
      }
      await api.answerAction(call, tab.current, answer)
      apply(await api.conversation())
    } catch (failure) {
      console.warn('Messagerie : action de la page', failure)
    }
  }

  // What the AI asked of the page and needs no accord: run at once, by one tab.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on what the thread says
  useEffect(() => {
    if (!page || inEditor) return
    for (const message of conversation?.messages ?? []) {
      if (message.from === 'action' && message.status === 'pending' && page.has(message.name)) {
        void runAction(message.call, message.name, message.args)
      }
    }
  }, [conversation])

  async function send(text = draft) {
    const body = text.trim()
    const sendingFiles = text === draft ? files : []
    if ((!body && sendingFiles.length === 0) || sending) return
    setSending(true)
    setError(null)
    try {
      const data = pendingData.current
      const next =
        sendingFiles.length > 0
          ? await api.sendFiles(sendingFiles, body)
          : await api.send(body, Object.keys(data).length > 0 ? data : undefined, page?.snapshot())
      if (sendingFiles.length === 0) pendingData.current = {}
      emit('message:sent', { body })
      setDraft('')
      setFiles([])
      if (field.current) field.current.style.height = 'auto'
      apply(next)
      setFollowing(true)
      // The AI is writing — until its answer arrives, or half a minute has passed.
      if (next.answeredBy === 'ai') showTyping('ai', 30_000)
    } catch (failure) {
      setError(
        failure instanceof WidgetFailure && failure.code === 'RATE_LIMITED'
          ? t('Trop de messages d’un coup : patientez un instant.')
          : failure instanceof WidgetFailure && failure.code === 'ATTACHMENT_REFUSED'
            ? t('Fichier refusé : images, PDF ou documents, 10 Mo au plus.')
            : t('Le message n’est pas parti. Réessayez.'),
      )
    } finally {
      setSending(false)
    }
  }

  // The page's `send` reaches the latest `send`, whatever render bound it.
  sendRef.current = send

  /**
   * `MessagerieChat.reset()`: the conversation left for the team, the panel back to its
   * welcome — the next message opens a new one. With `visitor`, a new session too: the
   * next visitor is a stranger.
   */
  async function reset(forget: boolean) {
    if (conversationRef.current) await api.resetConversation()
    pendingData.current = {}
    setFollowing(false)
    setConversation(null)
    setDraft('')
    setFiles([])
    setError(null)
    setUnread(0)
    setPreview(null)
    showTyping(null)
    if (forget) {
      api.forgetVisitor()
      const opened = await api.session(identity)
      for (const message of opened.conversation?.messages ?? []) seen.current.add(message.id)
      setSession(opened)
      setConversation(opened.conversation)
      if (opened.conversation) setFollowing(true)
    }
    emit('reset', { visitor: forget })
  }
  resetRef.current = reset

  if (!session || hidden) return null
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
              ) : item.kind === 'action' ? (
                <ActionLine
                  key={item.key}
                  label={item.label}
                  args={item.args}
                  status={item.status}
                  onAccept={() => void runAction(item.call, item.name, item.args)}
                  onDecline={() =>
                    void api.refuseAction(item.call).then(
                      async () => apply(await api.conversation()),
                      () => undefined,
                    )
                  }
                />
              ) : item.kind === 'email' ? (
                <EmailCard
                  key={item.key}
                  text={item.text}
                  email={item.email}
                  onLeave={async (email) => {
                    await api.leaveEmail(email)
                    apply(await api.conversation())
                  }}
                />
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
                  fileUrl={(path) => api.fileUrl(path)}
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
                    : avatarOf(
                        'agent',
                        typingName.current ??
                          (lastAgent?.from === 'agent' ? lastAgent.author : null),
                      )}
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
            class={dropping ? 'composer dropping' : 'composer'}
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer?.types.includes('Files')) return
              event.preventDefault()
              setDropping(true)
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={(event) => {
              const dropped = [...(event.dataTransfer?.files ?? [])]
              if (dropped.length === 0) return
              event.preventDefault()
              setDropping(false)
              addFiles(dropped)
            }}
          >
            {dropping && <div class="drop">{t('Déposez vos fichiers ici')}</div>}
            {error && <div class="error">{error}</div>}
            {emojiOpen && (
              <fieldset class="emoji" aria-label={t('Emoji')}>
                {EMOJI.map((emoji) => (
                  <button key={emoji} type="button" onClick={() => addEmoji(emoji)}>
                    {emoji}
                  </button>
                ))}
              </fieldset>
            )}
            {files.length > 0 && (
              <ul class="pending">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                    <PendingFile file={file} />
                    <span class="pending-name">{file.name}</span>
                    <button
                      type="button"
                      aria-label={t('Retirer {name}', { name: file.name })}
                      onClick={() => setFiles(files.filter((_, i) => i !== index))}
                    >
                      <CloseIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              accept={ACCEPT}
              onChange={(event) => {
                addFiles([...(event.currentTarget.files ?? [])])
                event.currentTarget.value = ''
              }}
            />
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
                  if (conversation && element.value.trim() !== '') api.typing()
                  element.style.height = 'auto'
                  element.style.height = `${Math.min(element.scrollHeight, 128)}px`
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                    event.preventDefault()
                    void send()
                  }
                }}
                onPaste={(event) => {
                  const pasted = [...(event.clipboardData?.files ?? [])]
                  if (pasted.length === 0) return
                  event.preventDefault()
                  addFiles(pasted)
                }}
              />
              <button
                type="button"
                class="tool"
                aria-label={t('Emoji')}
                aria-expanded={emojiOpen}
                onClick={() => setEmojiOpen((open) => !open)}
              >
                <SmileIcon />
              </button>
              <button
                type="button"
                class="tool"
                aria-label={t('Joindre un fichier')}
                onClick={() => picker.current?.click()}
              >
                <PaperclipIcon />
              </button>
              <button
                type="submit"
                class="send"
                aria-label={t('Envoyer')}
                disabled={(!draft.trim() && files.length === 0) || sending}
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

/** A file about to go: its picture, or its icon. */
function PendingFile({ file }: { readonly file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file.type.startsWith('image/')) return
    const made = URL.createObjectURL(file)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [file])
  return url ? (
    <img class="pending-thumb" src={url} alt="" />
  ) : (
    <span class="pending-thumb">
      <FileIcon />
    </span>
  )
}

/** The files of a message: pictures to open, the rest to download. */
function Files({
  items,
  fileUrl,
}: {
  readonly items: readonly WidgetAttachment[]
  readonly fileUrl: (path: string) => string
}) {
  return (
    <div class="files">
      {items.map((file) =>
        file.mime.startsWith('image/') ? (
          <a
            key={file.id}
            class="shot"
            href={fileUrl(file.url)}
            target="_blank"
            rel="noreferrer"
            aria-label={t('Ouvrir {name}', { name: file.name })}
          >
            <img src={fileUrl(file.url)} alt={file.name} loading="lazy" />
          </a>
        ) : (
          <a
            key={file.id}
            class="file"
            href={fileUrl(file.url)}
            target="_blank"
            rel="noreferrer"
            download={file.name}
          >
            <span class="file-icon">
              <FileIcon />
            </span>
            <span class="file-text">
              <span class="file-name">{file.name}</span>
              <span class="file-size">{sizeOf(file.size)}</span>
            </span>
          </a>
        ),
      )}
    </div>
  )
}

const SHOWN_ARGS = 4

/** An action the AI asked of the page: a line once done, a card to accept or decline before. */
function ActionLine({
  label,
  args,
  status,
  onAccept,
  onDecline,
}: {
  readonly label: string
  readonly args: Readonly<Record<string, unknown>>
  readonly status: PageCallStatus
  readonly onAccept: () => void
  readonly onDecline: () => void
}) {
  const [busy, setBusy] = useState(false)
  if (status === 'confirming') {
    const shown = Object.entries(args)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .slice(0, SHOWN_ARGS)
    return (
      <div class="action-card">
        <p class="action-ask">
          <SparkIcon />
          <span>{t('L’assistant propose : {label}', { label })}</span>
        </p>
        {shown.length > 0 && (
          <dl class="action-args">
            {shown.map(([key, value]) => (
              <Fragment key={key}>
                <dt>{key}</dt>
                <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
              </Fragment>
            ))}
          </dl>
        )}
        <div class="action-buttons">
          <button
            type="button"
            class="action-no"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              onDecline()
            }}
          >
            {t('Non merci')}
          </button>
          <button
            type="button"
            class="action-yes"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              onAccept()
            }}
          >
            {t('Accepter')}
          </button>
        </div>
      </div>
    )
  }
  const text =
    status === 'done'
      ? t('{label} : fait', { label })
      : status === 'refused'
        ? t('{label} : refusé', { label })
        : status === 'failed' || status === 'expired'
          ? t('{label} : n’a pas pu être fait', { label })
          : t('{label}…', { label })
  return <div class={`action-line ${status}`}>{text}</div>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * « Laissez-nous votre e-mail »: nobody can answer soon — the visitor leaves an address to
 * be answered later, and is thanked once it is kept.
 */
function EmailCard({
  text,
  email,
  onLeave,
}: {
  readonly text: string | null
  readonly email: string | null
  readonly onLeave: (email: string) => Promise<void>
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)
  if (email !== null) {
    return (
      <output class="email-card done">
        <MailIcon />
        <p>{t('Merci ! Nous vous répondrons à {email}.', { email })}</p>
      </output>
    )
  }
  const submit = async (event: Event) => {
    event.preventDefault()
    const value = typed.trim()
    if (!EMAIL.test(value)) {
      setWrong(true)
      return
    }
    setBusy(true)
    try {
      await onLeave(value)
    } catch {
      setWrong(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form class="email-card" onSubmit={(e) => void submit(e)}>
      <p class="email-why">
        <MailIcon />
        <span>
          {text ??
            t(
              'Personne ne peut vous répondre tout de suite. Laissez votre e-mail : nous vous répondrons dès que possible.',
            )}
        </span>
      </p>
      <div class="email-row">
        <input
          type="email"
          autocomplete="email"
          inputMode="email"
          required
          value={typed}
          placeholder={t('votre@adresse.fr')}
          aria-label={t('Votre adresse e-mail')}
          aria-invalid={wrong}
          onInput={(e) => {
            setTyped((e.target as HTMLInputElement).value)
            setWrong(false)
          }}
        />
        <button type="submit" disabled={busy || typed.trim() === ''}>
          {t('Envoyer')}
        </button>
      </div>
      {wrong && <p class="email-wrong">{t('Cette adresse ne semble pas valable.')}</p>}
    </form>
  )
}

function Group({
  from,
  name,
  avatar,
  lines,
  fileUrl = (path) => path,
}: {
  readonly from: Speaker
  readonly name: string | null
  readonly avatar: preact.ComponentChild
  readonly lines: readonly Line[]
  readonly fileUrl?: (path: string) => string
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
          <Fragment key={line.id}>
            {line.deleted && (
              <div class={index === lines.length - 1 ? 'bubble tail deleted' : 'bubble deleted'}>
                {t('Ce message a été supprimé')}
              </div>
            )}
            {line.body && (
              <div class={index === lines.length - 1 ? 'bubble tail' : 'bubble'}>
                {mine ? line.body : <Markdown text={line.body} />}
              </div>
            )}
            {line.attachments && line.attachments.length > 0 && (
              <Files items={line.attachments} fileUrl={fileUrl} />
            )}
          </Fragment>
        ))}
        {at && <div class="time">{clock(at)}</div>}
      </div>
    </div>
  )
}
