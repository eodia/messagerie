import type { MetadataValue } from '@chat/contracts'

/**
 * What the page may ask of the widget, as `window.MessagerieChat`:
 *
 *   MessagerieChat.open()  .close()  .toggle()  .isOpen()
 *   MessagerieChat.show()  .hide()                      — the whole widget
 *   MessagerieChat.setMessage('Bonjour, je…')            — prefilled, not sent
 *   MessagerieChat.send('Bonjour')                       — sent as the visitor
 *   MessagerieChat.setUser({ name, email, phone })       — an anonymous visitor's
 *   MessagerieChat.setContactData({ Abonnement: 'Pro' })
 *   MessagerieChat.setConversationData({ Commande: 'A-1042' })
 *   MessagerieChat.on('message:received', (message) => …)  → a function that stops it
 *
 * Before the script has loaded, the page queues the same calls:
 *
 *   window.MessagerieChat = window.MessagerieChat || []
 *   MessagerieChat.push(['setUser', { name: 'Léa Martin' }])
 *
 * Every call waits for the widget to be ready, then runs in its order. A value `null`
 * removes a key of the metadata. A customer the site signed (`data-identity`) keeps the
 * name and e-mail of its signature.
 */

export type Data = Readonly<Record<string, MetadataValue | null>>

export interface Profile {
  readonly name?: string
  readonly email?: string
  readonly phone?: string
}

export type PageEvent = 'ready' | 'open' | 'close' | 'message:sent' | 'message:received'

/** What the widget does for the page — given by the widget once its session is open. */
export interface Commands {
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  show(): void
  hide(): void
  setMessage(text: string): void
  send(text: string): void
  setUser(profile: Profile): void
  setContactData(data: Data): void
  setConversationData(data: Data): void
}

export type PageApi = Commands & {
  on(event: PageEvent, handler: (detail: unknown) => void): () => void
  off(event: PageEvent, handler: (detail: unknown) => void): void
  push(call: readonly unknown[]): void
  /** The signed identity, when the page sets it here rather than on the script tag. */
  identity?: string
}

const METHODS: readonly (keyof Commands)[] = [
  'open',
  'close',
  'toggle',
  'isOpen',
  'show',
  'hide',
  'setMessage',
  'send',
  'setUser',
  'setContactData',
  'setConversationData',
]

/**
 * The page's object, ready before the widget: what is called early waits in a queue, run
 * in order once the widget hands its commands over.
 */
export function createPageApi(previous: unknown): {
  readonly api: PageApi
  readonly ready: (commands: Commands) => void
  readonly emit: (event: PageEvent, detail?: unknown) => void
} {
  let commands: Commands | null = null
  const waiting: (readonly unknown[])[] = []
  const handlers = new Map<PageEvent, Set<(detail: unknown) => void>>()

  const run = (call: readonly unknown[]): unknown => {
    const [name, ...args] = call
    if (name === 'on' || name === 'off') {
      const [event, handler] = args as [PageEvent, (detail: unknown) => void]
      if (typeof handler !== 'function') return undefined
      return name === 'on' ? api.on(event, handler) : api.off(event, handler)
    }
    if (typeof name !== 'string' || !METHODS.includes(name as keyof Commands)) {
      console.warn('Messagerie : commande inconnue', name)
      return undefined
    }
    if (!commands) {
      waiting.push(call)
      return undefined
    }
    const method = commands[name as keyof Commands] as (...values: unknown[]) => unknown
    return method(...args)
  }

  const api = {
    on(event: PageEvent, handler: (detail: unknown) => void) {
      const set = handlers.get(event) ?? new Set()
      set.add(handler)
      handlers.set(event, set)
      return () => {
        set.delete(handler)
      }
    },
    off(event: PageEvent, handler: (detail: unknown) => void) {
      handlers.get(event)?.delete(handler)
    },
    push(call: readonly unknown[]) {
      if (Array.isArray(call)) run(call)
    },
    ...Object.fromEntries(
      METHODS.map((name) => [name, (...args: unknown[]) => run([name, ...args])]),
    ),
  } as unknown as PageApi

  // What the page queued, or set, before the script ran.
  if (Array.isArray(previous)) {
    for (const call of previous) if (Array.isArray(call)) run(call)
  } else if (typeof previous === 'object' && previous !== null) {
    const identity = (previous as { identity?: unknown }).identity
    if (typeof identity === 'string') api.identity = identity
  }

  return {
    api,
    ready(next) {
      commands = next
      for (const call of waiting.splice(0)) run(call)
    },
    emit(event, detail) {
      for (const handler of handlers.get(event) ?? []) {
        try {
          handler(detail)
        } catch (error) {
          console.error('Messagerie :', error)
        }
      }
    },
  }
}
