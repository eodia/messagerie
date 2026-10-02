import type { MetadataValue, PageActionDeclaration, PageSnapshot } from '@chat/contracts'

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
 *   MessagerieChat.reset()                               — a new conversation
 *   MessagerieChat.reset({ visitor: true })              — and a new visitor: a sign-out
 *   MessagerieChat.on('message:received', (message) => …)  → a function that stops it
 *
 * What the page can do for the AI (D21) — declared, run when the AI asks and a supervisor
 * allows it, what it returns told back to the AI:
 *
 *   MessagerieChat.registerAction('tarifer', {
 *     label: 'Calculer un tarif',
 *     description: 'Le prix mensuel pour une valeur de véhicule',
 *     parameters: { type: 'object', properties: { valeur: { type: 'number' } } },
 *     kind: 'read',                          // 'read' looks up, 'do' changes the page
 *     confirm: false,                        // true: the visitor accepts it first
 *     handler: ({ valeur }) => ({ mensuel: tarif(valeur) }),
 *   })
 *   MessagerieChat.unregisterAction('tarifer')
 *   MessagerieChat.setPageContext(() => ({ etape, panier }))  — read when the visitor writes
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

export type PageEvent = 'ready' | 'open' | 'close' | 'message:sent' | 'message:received' | 'reset'

/** `reset()`: a new conversation — and with `visitor`, a new visitor too. */
export interface ResetOptions {
  /**
   * Forget the visitor as well: the next one is a stranger, as after a sign-out on a
   * shared computer. Without it, they keep their name, their data, their history.
   */
  readonly visitor?: boolean
}

/** An action the page offers the AI, with what runs it. */
export interface ActionDefinition {
  readonly label?: string
  readonly description?: string
  readonly parameters?: Readonly<Record<string, unknown>>
  readonly kind?: 'read' | 'do'
  readonly confirm?: boolean
  readonly handler: (args: Record<string, unknown>) => unknown
}

/** What the widget reads of the page, and asks of it (D21). */
export interface PageBridge {
  /** The page as it is now: its address, what it says of itself, its actions. */
  snapshot(): PageSnapshot
  /** Runs an action the AI asked for: its result, or a refusal — ten seconds at most. */
  run(name: string, args: Record<string, unknown>): Promise<unknown>
  /** Whether the page still offers it. */
  has(name: string): boolean
}

const ACTION_MS = 10_000

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
  reset(options?: ResetOptions): void
}

export type PageApi = Commands & {
  on(event: PageEvent, handler: (detail: unknown) => void): () => void
  off(event: PageEvent, handler: (detail: unknown) => void): void
  push(call: readonly unknown[]): void
  /** The signed identity, when the page sets it here rather than on the script tag. */
  identity?: string
  registerAction(name: string, definition: ActionDefinition): void
  unregisterAction(name: string): void
  /** An object, or a function that gives one: read each time the visitor writes. */
  setPageContext(context: unknown): void
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
  'reset',
]

/**
 * The page's object, ready before the widget: what is called early waits in a queue, run
 * in order once the widget hands its commands over.
 */
export function createPageApi(previous: unknown): {
  readonly api: PageApi
  readonly ready: (commands: Commands) => void
  readonly emit: (event: PageEvent, detail?: unknown) => void
  readonly page: PageBridge
} {
  let commands: Commands | null = null
  // The page's actions and context: kept here, at once — not queued for the widget.
  const actions = new Map<string, ActionDefinition>()
  let pageContext: unknown = null
  const waiting: (readonly unknown[])[] = []
  const handlers = new Map<PageEvent, Set<(detail: unknown) => void>>()

  const run = (call: readonly unknown[]): unknown => {
    const [name, ...args] = call
    if (name === 'registerAction' || name === 'unregisterAction' || name === 'setPageContext') {
      const method = api[name] as (...values: unknown[]) => unknown
      return method(...args)
    }
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
    registerAction(name: string, definition: ActionDefinition) {
      if (typeof name !== 'string' || !/^[A-Za-z][\w-]{0,47}$/.test(name)) {
        console.warn('Messagerie : nom d’action invalide', name)
        return
      }
      if (typeof definition?.handler !== 'function') {
        console.warn('Messagerie : l’action doit avoir un handler', name)
        return
      }
      actions.set(name, definition)
    },
    unregisterAction(name: string) {
      actions.delete(name)
    },
    setPageContext(context: unknown) {
      pageContext = context
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

  const page: PageBridge = {
    snapshot() {
      let context: unknown = null
      try {
        context = typeof pageContext === 'function' ? (pageContext as () => unknown)() : pageContext
      } catch (error) {
        console.warn('Messagerie : setPageContext', error)
      }
      return {
        url: window.location.href,
        title: document.title,
        context: context ?? null,
        actions: [...actions].map(
          ([name, a]): PageActionDeclaration => ({
            name,
            label: a.label ?? name,
            description: a.description ?? '',
            parameters: a.parameters ?? { type: 'object', properties: {} },
            kind: a.kind === 'do' ? 'do' : 'read',
            confirm: a.confirm === true,
          }),
        ),
      }
    },
    has: (name) => actions.has(name),
    async run(name, args) {
      const action = actions.get(name)
      if (!action) throw new Error('unknown_action')
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          Promise.resolve().then(() => action.handler(args)),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), ACTION_MS)
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    },
  }

  return {
    api,
    page,
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
