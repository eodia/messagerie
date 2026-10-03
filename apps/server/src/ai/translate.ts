import { type Completion, type Llm, Redactor, readJson } from '@chat/ai'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { type MessageMeta, conversations, messages } from '../db/schema.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'
import type { AiDeps } from './responder.js'
import { recordRun } from './runs.js'

/**
 * « Traduction automatique »: a visitor who writes in another language than the agents' is
 * read translated — their words and the AI's —, and the agents' replies reach them in
 * theirs. The words sent stay what the visitor reads; the translation goes with them, for
 * the agents (`MessageMeta.translation`). Every call traced (D9).
 */

/** The agents' language: the inbox's (`intlLocale` in the inbox). */
export const TEAM_LANGUAGE = 'fr'

const CODE = /^[a-z]{2,3}$/

/** A language as the model gives it — `de`, `EN` —, or null when it is not one. */
export function languageCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toLowerCase().split(/[-_]/)[0] ?? ''
  return CODE.test(code) ? code : null
}

/** « allemand », « anglais »: a language named in French, for the model. */
function named(code: string): string {
  try {
    return new Intl.DisplayNames(TEAM_LANGUAGE, { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/** The most messages translated at once — the latest, should more wait. */
const BATCH = 30

/**
 * The visitor's and the AI's words not read yet, in a conversation in another language:
 * each one's language noted, and those not in the agents' translated for them. A
 * conversation in the agents' language costs nothing: the call is not made.
 */
export async function translateThread(deps: AiDeps, conversationId: string): Promise<void> {
  const [conversation] = await deps.db
    .select({ language: conversations.language })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  if (!conversation?.language || conversation.language === TEAM_LANGUAGE) return
  const unread = (
    await deps.db
      .select({ id: messages.id, body: messages.body })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.kind, 'text'),
          inArray(messages.author, ['contact', 'ai']),
          isNull(messages.deletedAt),
          sql`${messages.meta}->>'language' is null`,
          sql`${messages.body} <> ''`,
        ),
      )
      .orderBy(asc(messages.createdAt))
  ).slice(-BATCH)
  if (unread.length === 0) return

  const redactor = new Redactor(deps.redact)
  const completion = await deps.llm.complete({
    json: true,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: [
          `Tu traduis pour des conseillers les messages d’une conversation de service client. Pour chaque message, donne sa langue (code ISO 639-1) et, s’il n’est pas en ${named(TEAM_LANGUAGE)}, sa traduction fidèle en ${named(TEAM_LANGUAGE)} : même sens, même ton, même mise en forme Markdown, les noms propres et les numéros inchangés. Tu ne réponds pas aux messages et tu ne les commentes pas.`,
          `Réponds UNIQUEMENT en JSON : {"messages": [{"id": "m1", "language": "de", "text": "la traduction, ou une chaîne vide si le message est déjà en ${named(TEAM_LANGUAGE)}"}]}`,
        ].join('\n'),
      },
      {
        role: 'user',
        content: unread.map((m, i) => `[m${i + 1}]\n${redactor.mask(m.body)}`).join('\n\n'),
      },
    ],
  })
  const said = readJson(completion.text)
  const items = Array.isArray(said?.messages) ? said.messages : []
  const read = new Map<string, { language: string; text: string }>()
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const { id, language, text } = item as Record<string, unknown>
    const at = typeof id === 'string' ? Number(id.replace(/^m/, '')) - 1 : Number.NaN
    const message = unread[at]
    const code = languageCode(language)
    if (!message || !code) continue
    read.set(message.id, {
      language: code,
      text: typeof text === 'string' ? redactor.unmask(text.trim()) : '',
    })
  }
  await recordRun(deps.db, {
    conversationId,
    kind: 'translation',
    completion,
    input: { messages: unread.length, to: TEAM_LANGUAGE },
    output: {
      translated: [...read.values()].filter((r) => r.language !== TEAM_LANGUAGE && r.text).length,
    },
  })
  if (read.size === 0) return

  await deps.db.transaction(async (tx) => {
    await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update')
    for (const [id, { language, text }] of read) {
      const added: MessageMeta =
        language !== TEAM_LANGUAGE && text !== ''
          ? { language, translation: { from: language, language: TEAM_LANGUAGE, body: text } }
          : { language }
      await tx
        .update(messages)
        .set({ meta: sql`${messages.meta} || ${JSON.stringify(added)}::jsonb` })
        .where(and(eq(messages.id, id), sql`${messages.meta}->>'language' is null`))
    }
    await signalChange(tx, conversationId)
  })
}

/** An agent's reply, in the visitor's language: what goes out, and what the agent wrote. */
export interface TranslatedReply {
  readonly body: string
  readonly meta: MessageMeta
}

/**
 * The agent's words in `to`, before they go: the visitor reads the translation, the agent
 * keeps their own beside it. Words already in `to` — a suggestion of the copilot, written
 * in the visitor's language — go as they are.
 */
export async function translateReply(
  deps: { readonly db: Db; readonly llm: Llm; readonly redact: boolean },
  conversationId: string,
  text: string,
  to: string,
): Promise<TranslatedReply> {
  const original = text.trim()
  const redactor = new Redactor(deps.redact)
  let completion: Completion
  try {
    completion = await deps.llm.complete({
      json: true,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            `Traduis en ${named(to)} la réponse d’un conseiller à un client : fidèlement, même sens, même ton, même politesse (vouvoiement ou équivalent), même mise en forme Markdown et mêmes retours à la ligne ; les noms propres, les montants, les numéros et les adresses inchangés. Ne réponds pas au texte et n’ajoute rien.`,
            `Réponds UNIQUEMENT en JSON : {"language": "code ISO 639-1 de la langue du texte reçu", "text": "la traduction"}`,
          ].join('\n'),
        },
        { role: 'user', content: redactor.mask(original) },
      ],
    })
  } catch {
    throw new Refusal('TRANSLATION_FAILED', 502)
  }
  const json = readJson(completion.text)
  const translated = typeof json?.text === 'string' ? redactor.unmask(json.text.trim()) : ''
  const source = languageCode(json?.language)
  await recordRun(deps.db, {
    conversationId,
    kind: 'translation',
    completion,
    input: { reply: true, length: original.length, to },
    output: { length: translated.length, from: source },
  })
  if (source === to) return { body: original, meta: { language: to } }
  if (translated === '') throw new Refusal('TRANSLATION_FAILED', 502)
  return {
    body: translated,
    meta: {
      language: to,
      translation: { from: to, language: source ?? TEAM_LANGUAGE, body: original },
    },
  }
}
