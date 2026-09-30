import { type ChatMessage, Redactor } from '@chat/ai'
import { desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agents, contacts, conversations, messages } from '../db/schema.js'
import { type Availability, availability } from '../settings/hours.js'
import type { Settings, Site } from '../settings/settings.js'
import type { Found, Knowledge } from './knowledge.js'

/**
 * What the AI knows of a conversation when it is asked something: the site and its rules,
 * the customer as the site signed them, the hours, what was said, and the passages of the
 * knowledge base closest to the question. Masked, when the model is hosted elsewhere.
 */

export interface Context {
  readonly conversation: typeof conversations.$inferSelect
  readonly site: Site
  readonly contact: typeof contacts.$inferSelect
  readonly hours: Availability
  readonly redactor: Redactor
  /** The thread as chat messages: the visitor is the user, the AI and agents the assistant. */
  readonly history: ChatMessage[]
  /** What the visitor wrote last — what the search is made from. */
  readonly question: string
  readonly sources: readonly Found[]
}

const HISTORY = 20
const MIN_SIMILARITY = Number(process.env.CHAT_AI_MIN_SIMILARITY || 0.7)

export async function loadContext(
  db: Db,
  settings: Settings,
  knowledge: Knowledge,
  conversationId: string,
  redact: boolean,
): Promise<Context | null> {
  const [row] = await db
    .select({ conversation: conversations, contact: contacts })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(conversations.id, conversationId))
  if (!row) return null
  const site = await settings.site(row.conversation.siteId)
  if (!site) return null

  const [slots, closures] = await Promise.all([
    settings.openingSlots(site.id),
    settings.closures(site.id),
  ])
  const recent = await db
    .select({ message: messages, agent: agents.name })
    .from(messages)
    .leftJoin(agents, eq(agents.id, messages.agentId))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(HISTORY * 2)
  const thread = recent.reverse().filter(({ message }) => message.kind === 'text')

  const redactor = new Redactor(redact)
  const history: ChatMessage[] = thread.slice(-HISTORY).map(({ message, agent }) =>
    message.author === 'contact'
      ? { role: 'user', content: redactor.mask(message.body) }
      : {
          role: 'assistant',
          content: redactor.mask(
            message.author === 'agent'
              ? `[${agent ?? 'Conseiller'}] ${message.body}`
              : message.body,
          ),
        },
  )
  // The visitor's last words, all of them since the last answer: they may have written twice.
  const lastAnswer = thread.map((t) => t.message.author).lastIndexOf('ai')
  const lastAgent = thread.map((t) => t.message.author).lastIndexOf('agent')
  const question = thread
    .slice(Math.max(lastAnswer, lastAgent) + 1)
    .filter(({ message }) => message.author === 'contact')
    .map(({ message }) => message.body)
    .join('\n')

  const sources = question ? await knowledge.search(redactor.mask(question), site.id, 5) : []
  return {
    conversation: row.conversation,
    site,
    contact: row.contact,
    hours: availability(slots, closures, site.timezone),
    redactor,
    history,
    question,
    // mistral-embed's similarities sit between 0.75 and 0.9: below 0.7, nothing related.
    sources: sources.filter((s) => s.similarity >= MIN_SIMILARITY),
  }
}

const LOCALES: Readonly<Record<string, string>> = {
  Français: 'fr-FR',
  English: 'en-GB',
  Deutsch: 'de-DE',
  Español: 'es-ES',
}

/** The site's language as `Intl` names it. */
export const siteLocale = (site: Site): string => LOCALES[site.language] ?? 'fr-FR'

/** « lundi 5 octobre à 09:00 », in the site's language and time zone. */
export function whenLabel(at: Date, site: Site): string {
  return new Intl.DateTimeFormat(siteLocale(site), {
    timeZone: site.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at)
}

/** The sources, numbered, as the prompts cite them. */
export function numbered(sources: readonly Found[]): string {
  if (sources.length === 0) return '(aucune source ne correspond)'
  return sources.map((s, index) => `[${index + 1}] ${s.title}\n${s.text}`).join('\n\n')
}

/** What the site signed about the customer, masked. */
export function customer(context: Context): string {
  const { contact, redactor } = context
  if (!contact.identified) return 'Visiteur anonyme : le site ne l’a pas identifié.'
  const lines = [
    `Client identifié par le site : ${redactor.mask(contact.name)}`,
    ...(contact.email ? [`E-mail : ${redactor.mask(contact.email)}`] : []),
    ...contact.attributes.map((a) => `${a.label} : ${redactor.mask(a.value)}`),
  ]
  return lines.join('\n')
}
