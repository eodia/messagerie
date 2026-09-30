import {
  type ChatMessage,
  type Completion,
  type CompletionRequest,
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
}

/** Mistral's API unless told otherwise. */
export const PROVIDERS: Readonly<Record<string, string>> = {
  mistral: 'https://api.mistral.ai/v1',
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
}

type WireMessage = Record<string, unknown>

function toWire(message: ChatMessage): WireMessage {
  switch (message.role) {
    case 'system':
    case 'user':
      return { role: message.role, content: message.content }
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
  readonly external: boolean

  constructor(
    private readonly config: ProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.model = config.model
    this.embeddingModel = config.embeddingModel
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
      model: this.model,
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
