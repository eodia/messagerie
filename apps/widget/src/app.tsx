import type { VisitorConversation, WidgetMessage, WidgetSession } from '@chat/contracts'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { type WidgetApi, WidgetFailure } from './api'
import { clock, setLanguage, t, when } from './i18n'
import { BotIcon, ChatIcon, CloseIcon, SendIcon } from './icons'

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

const OPEN_KEY = 'messagerie:open'

function wasOpen(): boolean {
  try {
    return window.sessionStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

export interface Controls {
  open: () => void
  close: () => void
}

export function App({
  api,
  identity,
  poweredBy,
  bind,
}: {
  readonly api: WidgetApi
  readonly identity: string | null
  readonly poweredBy: string
  /** Hands the page `window.MessagerieChat.open()` and `.close()`. */
  readonly bind: (controls: Controls) => void
}) {
  const [session, setSession] = useState<WidgetSession | null>(null)
  const [conversation, setConversation] = useState<VisitorConversation | null>(null)
  const [open, setOpen] = useState(wasOpen)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [unread, setUnread] = useState(0)
  const [following, setFollowing] = useState(false)
  const seen = useRef(new Set<string>())
  const thread = useRef<HTMLDivElement>(null)
  const openRef = useRef(open)
  openRef.current = open

  // A conversation read again: what the team or the AI said while the panel was closed counts.
  const apply = (next: VisitorConversation | null) => {
    setConversation(next)
    if (!next) return
    let fresh = 0
    for (const message of next.messages) {
      if (seen.current.has(message.id)) continue
      seen.current.add(message.id)
      if (message.from === 'ai' || message.from === 'agent') {
        fresh++
        setTyping(false)
      }
    }
    if (!openRef.current && fresh > 0) setUnread((count) => count + fresh)
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
      else if (event.type === 'typing') {
        setTyping(true)
        setTimeout(() => setTyping(false), 12_000)
      }
    })
  }, [api, following])

  useEffect(() => {
    bind({ open: () => show(true), close: () => show(false) })
  }, [bind])

  // The newest message in view — after each message, the typing dots, and on opening.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers
  useLayoutEffect(() => {
    const element = thread.current
    if (element) element.scrollTop = element.scrollHeight
  }, [conversation, typing, open])

  function show(next: boolean) {
    setOpen(next)
    if (next) setUnread(0)
    try {
      window.sessionStorage.setItem(OPEN_KEY, next ? '1' : '0')
    } catch {
      // The panel forgets it was open, nothing more.
    }
  }

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      const next = await api.send(body)
      setDraft('')
      apply(next)
      setFollowing(true)
      // The AI is writing — until its answer arrives, or half a minute has passed.
      if (next.answeredBy === 'ai') {
        setTyping(true)
        setTimeout(() => setTyping(false), 30_000)
      }
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
  const { site, availability } = session
  const style = { '--accent': site.color, '--accent-text': textOn(site.color) }
  const answeredBy = conversation?.answeredBy ?? (site.ai ? 'ai' : 'team')
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

  return (
    <div class="root" style={style}>
      {open && (
        <dialog class="panel" open aria-label={site.name}>
          <header class="head">
            <span class="mark">{initials(site.name)}</span>
            <div>
              <div class="title">{site.name}</div>
              <div class="status">
                <span class={availability.open || answeredBy === 'ai' ? 'dot' : 'dot away'} />
                {status}
              </div>
            </div>
            <button
              type="button"
              class="close"
              aria-label={t('Fermer la conversation')}
              onClick={() => show(false)}
            >
              <CloseIcon />
            </button>
          </header>

          {availability.closureMessage && <div class="notice">{availability.closureMessage}</div>}

          <div class="thread" ref={thread} aria-live="polite">
            <Incoming
              from="ai"
              body={site.welcome ?? t('Bonjour ! Comment pouvons-nous vous aider ?')}
            />
            {conversation?.messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
            {typing && (
              <div class="row">
                <span class="avatar">
                  <BotIcon />
                </span>
                <div class="bubble typing" aria-label="…">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          {error && <div class="error">{error}</div>}
          <form
            class="composer"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <textarea
              rows={1}
              value={draft}
              maxLength={4000}
              placeholder={t('Écrivez votre message…')}
              aria-label={t('Écrivez votre message…')}
              onInput={(event) => {
                const field = event.currentTarget
                setDraft(field.value)
                field.style.height = 'auto'
                field.style.height = `${Math.min(field.scrollHeight, 120)}px`
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
          </form>
          <div class="foot">{t('Propulsé par {name}', { name: poweredBy })}</div>
        </dialog>
      )}

      <button
        type="button"
        class={open ? 'launcher open' : 'launcher'}
        aria-label={open ? t('Fermer la conversation') : t('Ouvrir la conversation')}
        aria-expanded={open}
        onClick={() => show(!open)}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
        {!open && unread > 0 && <span class="badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
    </div>
  )
}

function Incoming({
  from,
  body,
  author,
  at,
}: {
  readonly from: 'ai' | 'agent'
  readonly body: string
  readonly author?: string
  readonly at?: string
}) {
  return (
    <div class="row">
      <span class="avatar">{from === 'ai' ? <BotIcon /> : initials(author ?? '?')}</span>
      <div>
        <div class="who">
          {from === 'ai' ? t('Assistant IA') : author}
          {from === 'ai' && (
            <span class="ai-tag" title={t('Réponse générée par une IA')}>
              IA
            </span>
          )}
        </div>
        <div class="bubble">{body}</div>
        {at && <div class="time">{clock(at)}</div>}
      </div>
    </div>
  )
}

function Message({ message }: { readonly message: WidgetMessage }) {
  switch (message.from) {
    case 'visitor':
      return (
        <div class="row mine">
          <div>
            <div class="bubble">{message.body}</div>
            <div class="time">{clock(message.at)}</div>
          </div>
        </div>
      )
    case 'ai':
      return <Incoming from="ai" body={message.body} at={message.at} />
    case 'agent':
      return <Incoming from="agent" body={message.body} author={message.author} at={message.at} />
    case 'event':
      return (
        <div class="event">
          {message.event === 'joined'
            ? message.author
              ? t('{name} a rejoint la conversation', { name: message.author })
              : t('Un conseiller a rejoint la conversation')
            : message.event === 'handoff'
              ? t('Un conseiller va reprendre votre demande')
              : t('Conversation terminée')}
        </div>
      )
  }
}
