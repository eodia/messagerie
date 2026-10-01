/**
 * One interface for every model (D7): the chat asks for a completion or embeddings, and
 * never knows whose model answers — hosted in-house, a European provider, another. A
 * provider is a class that implements `Llm`.
 */

/** A file shown to the model: an image with a user's words, or a document to read. */
export interface FilePart {
  readonly mime: string
  readonly data: Uint8Array
}

export type ChatMessage =
  | {
      readonly role: 'system' | 'user'
      readonly content: string
      /** Images the model looks at with these words — a vision model's. */
      readonly images?: readonly FilePart[]
    }
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
  /** Another model than the provider's default — the one that sees images. */
  readonly model?: string
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
  /** The model that looks at images; the default one when it does. */
  readonly visionModel?: string
  complete(request: CompletionRequest): Promise<Completion>
  embed(texts: readonly string[]): Promise<number[][]>
  /** A document's text, read by the provider's OCR — when it has one (Mistral). */
  ocr?(document: FilePart): Promise<string>
  /** The model that reads a text aloud — when the provider has one. */
  readonly speechModel?: string
  /** A text, spoken: an MP3 (Mistral's Voxtral TTS). */
  speak?(text: string): Promise<FilePart>
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
