import type { Completion } from '@chat/ai'
import type { Db } from '../db/client.js'
import { aiRuns } from '../db/schema.js'

/**
 * Every call to a model leaves a trace (D9): what went in — masked as it was sent — what
 * came out, how sure the model was, how long it took, and the tokens it cost.
 */
export async function recordRun(
  db: Db,
  run: {
    readonly conversationId: string
    readonly kind:
      | 'answer'
      | 'suggestion'
      | 'tag'
      | 'summary'
      | 'rephrase'
      | 'attachment'
      | 'speech'
      | 'automation'
      | 'translation'
    readonly completion: Pick<Completion, 'model' | 'usage' | 'latencyMs'>
    readonly input: unknown
    readonly output: Record<string, unknown>
    readonly confidence?: number | null
  },
): Promise<string> {
  const [row] = await db
    .insert(aiRuns)
    .values({
      conversationId: run.conversationId,
      kind: run.kind,
      model: run.completion.model,
      input: run.input as object,
      output: { ...run.output, usage: run.completion.usage },
      confidence: run.confidence ?? null,
      latencyMs: run.completion.latencyMs,
    })
    .returning({ id: aiRuns.id })
  if (!row) throw new Error('ai run not recorded')
  return row.id
}
