import type {
  VisitorConversation,
  WidgetEvent,
  WidgetMessage,
  WidgetSession,
  WidgetSite,
} from '@chat/contracts'
import type { Backend } from './api'
import { t } from './i18n'

/**
 * The widget in the inbox's editor: the real widget, fed by the editor instead of the chat
 * server. The editor — and only it, by its origin — posts the site as it is being edited
 * and the scene to show; nothing reaches the server, no conversation is created, and a
 * message typed in the preview is answered by a sample.
 */

export type Scene = 'closed' | 'nudge' | 'welcome' | 'conversation'

export interface PreviewMessage {
  readonly type: 'messagerie:preview'
  readonly site: WidgetSite
  readonly scene: Scene
  /** The visitor signed in to the site: the greeting says their first name. */
  readonly identified: boolean
}

let sequence = 0
const at = () => new Date().toISOString()
const said = (from: 'visitor' | 'ai', body: string): WidgetMessage => ({
  id: `preview-${++sequence}`,
  at: at(),
  from,
  body,
})

function sampleConversation(site: WidgetSite): VisitorConversation {
  const agent = site.team[0] ?? 'Camille'
  const question = site.suggestions[0] ?? t('Quel est le délai de remboursement ?')
  return {
    id: 'preview',
    answeredBy: 'team',
    messages: [
      said('visitor', question),
      said(
        'ai',
        t(
          'Une fois votre dossier complet, le remboursement est versé sous **5 à 10 jours ouvrés**. Vous pouvez suivre son avancement dans votre espace client.',
        ),
      ),
      said('visitor', t('Merci ! Et si c’est plus long ?')),
      { id: `preview-${++sequence}`, at: at(), from: 'event', event: 'handoff', author: null },
      { id: `preview-${++sequence}`, at: at(), from: 'event', event: 'joined', author: agent },
      {
        id: `preview-${++sequence}`,
        at: at(),
        from: 'agent',
        author: agent,
        body: t('Bonjour, je regarde votre dossier tout de suite.'),
      },
    ],
  }
}

export class PreviewBackend implements Backend {
  private message: PreviewMessage | null = null
  private conversationNow: VisitorConversation | null = null
  private readonly waiting: ((session: WidgetSession) => void)[] = []
  private readonly listeners = new Set<(event: WidgetEvent) => void>()
  private readonly watchers = new Set<(session: WidgetSession, scene: Scene) => void>()

  constructor(private readonly parent: string) {
    window.addEventListener('message', (event) => {
      if (event.origin !== this.parent) return
      const data = event.data as Partial<PreviewMessage> | null
      if (data?.type === 'messagerie:preview' && data.site) this.apply(data as PreviewMessage)
    })
    window.parent.postMessage({ type: 'messagerie:ready' }, this.parent)
  }

  private sessionOf(message: PreviewMessage): WidgetSession {
    return {
      visitor: 'preview',
      contact: message.identified
        ? { name: 'Sophie Leroy', identified: true }
        : { name: null, identified: false },
      site: message.site,
      availability: { open: true, nextOpening: null, closureMessage: null },
      conversation: this.conversationNow,
    }
  }

  private apply(message: PreviewMessage): void {
    const sceneChanged = this.message?.scene !== message.scene
    this.message = message
    if (sceneChanged)
      this.conversationNow =
        message.scene === 'conversation' ? sampleConversation(message.site) : null
    const session = this.sessionOf(message)
    for (const resolve of this.waiting.splice(0)) resolve(session)
    for (const watcher of this.watchers) watcher(session, message.scene)
  }

  session(): Promise<WidgetSession> {
    const message = this.message
    if (message) return Promise.resolve(this.sessionOf(message))
    return new Promise((resolve) => this.waiting.push(resolve))
  }

  /** The editor's changes, as they come: the site, and the scene to show. */
  watch(onChange: (session: WidgetSession, scene: Scene) => void): () => void {
    this.watchers.add(onChange)
    if (this.message) onChange(this.sessionOf(this.message), this.message.scene)
    return () => this.watchers.delete(onChange)
  }

  conversation(): Promise<VisitorConversation | null> {
    return Promise.resolve(this.conversationNow)
  }

  async send(body: string): Promise<VisitorConversation> {
    const before = this.conversationNow?.messages ?? []
    const ai = this.message?.site.ai ?? true
    this.conversationNow = {
      id: 'preview',
      answeredBy: ai ? 'ai' : 'team',
      messages: [...before, said('visitor', body)],
    }
    const current = this.conversationNow
    setTimeout(() => {
      if (this.conversationNow !== current) return
      this.conversationNow = {
        ...current,
        messages: [
          ...current.messages,
          ai
            ? said('ai', t('Ceci est un aperçu : dans votre site, l’assistant répondrait ici.'))
            : {
                id: `preview-${++sequence}`,
                at: at(),
                from: 'agent',
                author: this.message?.site.team[0] ?? 'Camille',
                body: t('Ceci est un aperçu : dans votre site, un conseiller répondrait ici.'),
              },
        ],
      }
      for (const listener of this.listeners) listener({ type: 'conversation' })
    }, 1400)
    return current
  }

  follow(onEvent: (event: WidgetEvent) => void): () => void {
    this.listeners.add(onEvent)
    return () => this.listeners.delete(onEvent)
  }

  /** The preview keeps no visitor: what the page would say of one goes nowhere. */
  async updateContact(): Promise<void> {}

  async updateConversation(): Promise<void> {}
}
