/**
 * One interface for every model (D7): the chat asks for a completion or embeddings, and
 * never knows whose model answers — hosted in-house, a European provider, another. A
 * provider is a class that implements `Llm`.
 */

export type ChatMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | {
      readonly role: 'assistant'
      readonly content: string | null
      readonly toolCalls?: readonly ToolCall[]
    }
  | {
      readonly role: 'tool'
      readonly toolCallId: string
      readonly name: string
      readonly content: string
    }

/** A function the model may call — one of basedb's « Outils IA », to the model. */
export interface ToolSpec {
  readonly name: string
  readonly description: string
  /** A JSON schema of an object. */
  readonly parameters: Readonly<Record<string, unknown>>
}

export interface ToolCall {
  readonly id: string
  readonly name: string
  /** As the model wrote it; the caller parses and checks. */
  readonly arguments: string
}

export interface CompletionRequest {
  readonly messages: readonly ChatMessage[]
  readonly tools?: readonly ToolSpec[]
  /** Ask for a JSON object; ignored while tools are offered. */
  readonly json?: boolean
  readonly temperature?: number
  readonly maxTokens?: number
}

export interface Usage {
  readonly promptTokens: number
  readonly completionTokens: number
}

export interface Completion {
  readonly text: string
  readonly toolCalls: readonly ToolCall[]
  readonly model: string
  readonly usage: Usage | null
  readonly latencyMs: number
}

export interface Llm {
  /** The model that answers — written with every trace (D9). */
  readonly model: string
  readonly embeddingModel: string
  /** Whether what is sent leaves the organisation's infrastructure. */
  readonly external: boolean
  complete(request: CompletionRequest): Promise<Completion>
  embed(texts: readonly string[]): Promise<number[][]>
}

/** The provider refused, failed, or took too long. */
export class LlmFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
