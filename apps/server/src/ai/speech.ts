import { type Llm, LlmFailure } from '@chat/ai'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { conversations, messages } from '../db/schema.js'
import { type Visible, canSee } from '../inbox/access.js'
import type { AgentRow } from '../inbox/read.js'
import { Refusal } from '../refusal.js'
import { recordRun } from './runs.js'

/**
 * A message read aloud by the provider's voice — Mistral's Voxtral TTS by default
 * (`CHAT_AI_SPEECH_MODEL`, `CHAT_AI_SPEECH_VOICE`) —, for an agent in audio mode. The
 * message's words go to the model as they are: a voice cannot read masked words. The
 * sound is not kept; the call is traced (D9).
 */

/** What the model says the most at once: a long message is read in its beginning. */
const LONGEST = 1500

/** A message's words as a voice says them: the little Markdown's marks gone. */
export function spokenText(markdown: string): string {
  return markdown
    .replace(/<\/?u>|<span color="\w+">|<\/span>/g, '')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/(\*\*\*|\*\*|~~|`)(.+?)\1/g, '$2')
    .replace(/\*([^*\s][^*]*)\*/g, '$1')
    .replace(/^\s*(?:>|[-*•]|\d+[.)])\s+/gm, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim()
    .slice(0, LONGEST)
}

export async function speakMessage(
  deps: { readonly db: Db; readonly llm: Llm },
  agent: AgentRow,
  visible: Visible,
  messageId: string,
): Promise<Uint8Array> {
  const speak = deps.llm.speak?.bind(deps.llm)
  if (!speak) throw new Refusal('SPEECH_UNAVAILABLE', 503)
  const [row] = await deps.db
    .select({
      body: messages.body,
      conversationId: messages.conversationId,
      inboxId: conversations.inboxId,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(eq(messages.id, messageId))
  if (!row || !canSee(visible, row.inboxId)) throw new Refusal('MESSAGE_NOT_FOUND', 404)
  const text = spokenText(row.body)
  if (text === '') throw new Refusal('MESSAGE_NOT_FOUND', 404)
  const started = Date.now()
  let audio: Uint8Array
  try {
    audio = (await speak(text)).data
  } catch (error) {
    if (error instanceof LlmFailure) throw new Refusal('AI_UNAVAILABLE', 503)
    throw error
  }
  await recordRun(deps.db, {
    conversationId: row.conversationId,
    kind: 'speech',
    completion: {
      model: deps.llm.speechModel ?? 'speech',
      usage: null,
      latencyMs: Date.now() - started,
    },
    input: { agent: agent.id, message: messageId, length: text.length },
    output: { bytes: audio.length },
  })
  return audio
}
