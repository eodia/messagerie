import { type Llm, OpenAiCompatible, PROVIDERS } from '@chat/ai'

/**
 * The model the chat uses (D7), from the environment:
 *
 *   CHAT_AI_PROVIDER   mistral (default), openai, ollama, or any compatible server with
 *   CHAT_AI_BASE_URL   its address — Azure, vLLM…
 *   CHAT_AI_MODEL      mistral-small-latest by default
 *   CHAT_AI_API_KEY
 *   CHAT_AI_EMBEDDING_MODEL   mistral-embed by default: 1024 dimensions, the schema's
 *   CHAT_AI_REDACT     0 to send personal data as it is; masked by default when the model
 *                      is hosted elsewhere (framing)
 *
 * Without a key — and without a local provider — there is no AI: conversations go straight
 * to the agents.
 */
export interface AiSetup {
  readonly llm: Llm
  readonly redact: boolean
}

export function readAi(env: NodeJS.ProcessEnv = process.env): AiSetup | null {
  const provider = env.CHAT_AI_PROVIDER || 'mistral'
  const baseUrl = env.CHAT_AI_BASE_URL || PROVIDERS[provider]
  if (!baseUrl) return null
  const apiKey = env.CHAT_AI_API_KEY || null
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(baseUrl)
  if (!apiKey && !local) return null
  const llm = new OpenAiCompatible({
    baseUrl,
    apiKey,
    model: env.CHAT_AI_MODEL || 'mistral-small-latest',
    embeddingModel: env.CHAT_AI_EMBEDDING_MODEL || 'mistral-embed',
    timeoutMs: 45_000,
  })
  return { llm, redact: env.CHAT_AI_REDACT === '0' ? false : llm.external }
}
