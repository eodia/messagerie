import { type Llm, OpenAiCompatible, PROVIDERS } from '@chat/ai'

/**
 * The model the chat uses (D7), from the environment:
 *
 *   CHAT_AI_PROVIDER   mistral (default), openai, ollama, or any compatible server with
 *   CHAT_AI_BASE_URL   its address — Azure, vLLM…
 *   CHAT_AI_MODEL      mistral-small-latest by default
 *   CHAT_AI_API_KEY
 *   CHAT_AI_EMBEDDING_MODEL   mistral-embed by default: 1024 dimensions, the schema's
 *   CHAT_AI_VISION_MODEL   the model that looks at images (attachments); CHAT_AI_MODEL
 *                      by default — mistral-small-latest does
 *   CHAT_AI_OCR_MODEL  reads PDF attachments: mistral-ocr-latest with Mistral, none
 *                      elsewhere (`off` to do without)
 *   CHAT_AI_SPEECH_MODEL   reads messages aloud in audio mode: voxtral-mini-tts-latest with
 *                      Mistral, none elsewhere — the browser's voice then (`off`)
 *   CHAT_AI_SPEECH_VOICE   its voice: fr_marie_neutral by default
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
    visionModel: env.CHAT_AI_VISION_MODEL || undefined,
    ocrModel:
      env.CHAT_AI_OCR_MODEL === 'off'
        ? undefined
        : env.CHAT_AI_OCR_MODEL || (provider === 'mistral' ? 'mistral-ocr-latest' : undefined),
    speechModel:
      env.CHAT_AI_SPEECH_MODEL === 'off'
        ? undefined
        : env.CHAT_AI_SPEECH_MODEL ||
          (provider === 'mistral' ? 'voxtral-mini-tts-latest' : undefined),
    speechVoice:
      env.CHAT_AI_SPEECH_VOICE || (provider === 'mistral' ? 'fr_marie_neutral' : undefined),
    timeoutMs: 45_000,
  })
  return { llm, redact: env.CHAT_AI_REDACT === '0' ? false : llm.external }
}
