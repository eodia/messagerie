import {
  type ChatMessage,
  type Completion,
  type CompletionRequest,
  type FilePart,
  type Llm,
  LlmFailure,
  type ToolCall,
} from './llm.js'

/**
 * The chat/completions and embeddings wire format that Mistral, OpenAI, Azure, Ollama and
 * vLLM all speak. One class, a base URL: choosing a provider is configuration, not code.
 */

export interface ProviderConfig {
  readonly baseUrl: string
  readonly apiKey: string | null
  readonly model: string
  readonly embeddingModel: string
  readonly headers?: Readonly<Record<string, string>>
  readonly timeoutMs?: number
  /** The model that looks at images; `model` when unset. */
  readonly visionModel?: string
  /** The provider's OCR model for documents (Mistral's `/ocr`); none when unset. */
  readonly ocrModel?: string
  /** The provider's text-to-speech model (`/audio/speech`); none when unset. */
  readonly speechModel?: string
  /** The voice it speaks with — one of the provider's (`fr_marie_neutral` at Mistral). */
  readonly speechVoice?: string
}

/** Mistral's API unless told otherwise. */
export const PROVIDERS: Readonly<Record<string, string>> = {
  mistral: 'https://api.mistral.ai/v1',
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
}

type WireMessage = Record<string, unknown>

const dataUrl = (part: FilePart) =>
  `data:${part.mime};base64,${Buffer.from(part.data).toString('base64')}`

function toWire(message: ChatMessage): WireMessage {
  switch (message.role) {
    case 'system':
    case 'user':
      if (!message.images?.length) return { role: message.role, content: message.content }
      return {
        role: message.role,
        content: [
          { type: 'text', text: message.content },
          ...message.images.map((image) => ({
            type: 'image_url',
            image_url: { url: dataUrl(image) },
          })),
        ],
      }
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content ?? '',
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      }
    case 'tool':
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        name: message.name,
        content: message.content,
      }
  }
}

export class OpenAiCompatible implements Llm {
  readonly model: string
  readonly embeddingModel: string
  readonly visionModel: string
  readonly speechModel?: string
  readonly external: boolean

  constructor(
    private readonly config: ProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.model = config.model
    this.embeddingModel = config.embeddingModel
    this.visionModel = config.visionModel ?? config.model
    if (config.ocrModel) {
      const ocrModel = config.ocrModel
      this.ocr = (document) => this.readDocument(ocrModel, document)
    }
    if (config.speechModel) {
      const model = config.speechModel
      this.speechModel = model
      this.speak = (text) => this.voice(model, config.speechVoice, text)
    }
    const host = new URL(config.baseUrl).hostname
    this.external = !['localhost', '127.0.0.1', '::1'].includes(host) && !host.endsWith('.internal')
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 60_000)
    let response: Response
    try {
      response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, '')}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
          ...this.config.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      throw new LlmFailure(0, controller.signal.aborted ? 'timeout' : String(error))
    } finally {
      clearTimeout(timer)
    }
    const text = await response.text()
    if (!response.ok) throw new LlmFailure(response.status, text.slice(0, 500))
    try {
      return JSON.parse(text)
    } catch {
      throw new LlmFailure(response.status, 'not JSON')
    }
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const started = Date.now()
    const tools = request.tools?.length ? request.tools : undefined
    const answer = (await this.post('/chat/completions', {
      model: request.model ?? this.model,
      messages: request.messages.map(toWire),
      temperature: request.temperature ?? 0.2,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(tools
        ? {
            tools: tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            tool_choice: 'auto',
          }
        : request.json
          ? { response_format: { type: 'json_object' } }
          : {}),
    })) as {
      model?: string
      choices?: {
        message?: {
          content?: string | null
          tool_calls?: { id: string; function: { name: string; arguments: string | object } }[]
        }
      }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const message = answer.choices?.[0]?.message
    const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments:
        typeof call.function.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call.function.arguments),
    }))
    return {
      text: message?.content ?? '',
      toolCalls,
      model: answer.model ?? this.model,
      usage: answer.usage
        ? {
            promptTokens: answer.usage.prompt_tokens ?? 0,
            completionTokens: answer.usage.completion_tokens ?? 0,
          }
        : null,
      latencyMs: Date.now() - started,
    }
  }

  ocr?: (document: FilePart) => Promise<string>
  speak?: (text: string) => Promise<FilePart>

  /** `/audio/speech`, as Mistral takes it: the text and a voice; an MP3 back. */
  private async voice(model: string, voice: string | undefined, text: string): Promise<FilePart> {
    const answer = (await this.post('/audio/speech', {
      model,
      input: text,
      response_format: 'mp3',
      ...(voice ? { voice } : {}),
    })) as { audio_data?: string }
    if (!answer.audio_data) throw new LlmFailure(502, 'no audio')
    return { mime: 'audio/mpeg', data: new Uint8Array(Buffer.from(answer.audio_data, 'base64')) }
  }

  /** Mistral's `/ocr`: a PDF or an image, read page by page into Markdown. */
  private async readDocument(model: string, document: FilePart): Promise<string> {
    const answer = (await this.post('/ocr', {
      model,
      document:
        document.mime === 'application/pdf'
          ? { type: 'document_url', document_url: dataUrl(document) }
          : { type: 'image_url', image_url: dataUrl(document) },
      include_image_base64: false,
    })) as { pages?: { markdown?: string }[] }
    return (answer.pages ?? [])
      .map((page) => page.markdown ?? '')
      .join('\n\n')
      .trim()
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const vectors: number[][] = []
    // Providers cap a request's inputs: in batches of 32.
    for (let at = 0; at < texts.length; at += 32) {
      const answer = (await this.post('/embeddings', {
        model: this.embeddingModel,
        input: texts.slice(at, at + 32),
      })) as { data?: { embedding: number[]; index?: number }[] }
      const batch = [...(answer.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      vectors.push(...batch.map((item) => item.embedding))
    }
    return vectors
  }
}
