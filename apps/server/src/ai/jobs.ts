import { PgBoss } from 'pg-boss'
import type { Db } from '../db/client.js'
import { copilotAvailable } from './available.js'
import { enrich, suggest, summarize } from './copilot.js'
import { type AiDeps, answerVisitor } from './responder.js'
import { purgeExpired } from './retention.js'
import { translateThread } from './translate.js'

/**
 * The AI's work, off the request path (D7, D8): queues in PostgreSQL (pg-boss), worked by
 * this process or by `worker.ts` alone. A visitor who writes three times in a row gets one
 * answer that reads all three: each conversation has at most one job waiting per queue
 * (`stately`, keyed by conversation).
 */

export interface AiJobs {
  /** A visitor wrote: the AI answers if it has the conversation; the copilot reads it. */
  visitorMessage(conversationId: string): void
  /** An agent took the conversation: a summary to pick it up, and suggestions. */
  takenOver(conversationId: string): void
  resolved(conversationId: string): void
  /** The agent asks for new suggestions. */
  suggest(conversationId: string): void
  /** The articles or promoted conversations changed. */
  knowledgeChanged(): void
  /** The visitor answered an action the AI asked of their page (D21): the AI goes on. */
  pageAnswered(conversationId: string): void
}

const QUEUES = {
  answer: 'ai-answer',
  enrich: 'ai-enrich',
  suggest: 'ai-suggest',
  summary: 'ai-summary',
  knowledge: 'kb-sync',
  retention: 'retention',
} as const

interface ConversationJob {
  readonly conversationId: string
  readonly closing?: boolean
  readonly continuing?: boolean
}

export async function startJobs(
  databaseUrl: string,
  deps: AiDeps,
  options: { readonly work: boolean },
): Promise<{ jobs: AiJobs; stop: () => Promise<void> }> {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: 'pgboss',
    application_name: 'chat',
  })
  boss.on('error', (error) => console.error('chat : tâches de fond', error))
  await boss.start()
  for (const name of [QUEUES.answer, QUEUES.enrich, QUEUES.suggest, QUEUES.summary]) {
    await boss.createQueue(name, {
      policy: 'stately',
      retryLimit: 2,
      retryDelay: 5,
      expireInSeconds: 120,
    })
  }
  await boss.createQueue(QUEUES.knowledge, { policy: 'stately', retryLimit: 3, retryDelay: 30 })
  await boss.createQueue(QUEUES.retention, { policy: 'stately' })

  const send = (queue: string, data: object, key: string, delaySeconds = 0) => {
    boss
      .send(queue, data, {
        singletonKey: key,
        ...(delaySeconds ? { startAfter: delaySeconds } : {}),
      })
      .catch((error: unknown) => console.error(`chat : tâche ${queue}`, error))
  }

  // A translation that fails is not the answer's failure: the job is not tried again for it.
  const translating = (conversationId: string) =>
    translateThread(deps, conversationId).catch((error: unknown) =>
      console.error('chat : traduction', error),
    )

  if (options.work) {
    const each =
      (handler: (job: ConversationJob) => Promise<void>) =>
      async (jobs: { data: ConversationJob }[]) => {
        for (const job of jobs) await handler(job.data)
      }
    await boss.work<ConversationJob>(
      QUEUES.answer,
      { localConcurrency: 4 },
      each(async ({ conversationId, continuing }) => {
        await answerVisitor(deps, conversationId, continuing === true)
        // The AI answered in the visitor's language: the agents read it translated.
        await translating(conversationId)
      }),
    )
    await boss.work<ConversationJob>(
      QUEUES.enrich,
      { localConcurrency: 2 },
      each(async ({ conversationId }) => {
        await enrich(deps, conversationId)
        // The visitor's language read: their words translated for the agents, if need be.
        await translating(conversationId)
      }),
    )
    await boss.work<ConversationJob>(
      QUEUES.suggest,
      { localConcurrency: 2 },
      each(async ({ conversationId }) => {
        if (await copilotAvailable(deps.db, conversationId)) await suggest(deps, conversationId)
      }),
    )
    await boss.work<ConversationJob>(
      QUEUES.summary,
      { localConcurrency: 2 },
      each(({ conversationId, closing }) => summarize(deps, conversationId, closing === true)),
    )
    await boss.work(QUEUES.knowledge, async () => {
      const done = await deps.knowledge.sync()
      if (done.indexed || done.removed) {
        console.log(
          `chat : connaissances — ${done.indexed} indexée(s), ${done.removed} extrait(s) retiré(s)`,
        )
      }
    })
    await boss.work(QUEUES.retention, async () => {
      const purged = await purgeExpired(deps.db as Db, deps.settings, new Date(), deps.files)
      if (purged > 0) console.log(`chat : rétention — ${purged} conversation(s) purgée(s)`)
    })
    // Every night at three, in the server's time zone.
    await boss.schedule(QUEUES.retention, '0 3 * * *')
  }

  const jobs: AiJobs = {
    visitorMessage: (conversationId) => {
      send(QUEUES.answer, { conversationId }, conversationId, 1)
      // The visitor's mood, at once: it is the agents' first sign of a conversation going wrong.
      send(QUEUES.enrich, { conversationId }, conversationId, 1)
      send(QUEUES.suggest, { conversationId }, conversationId, 2)
    },
    takenOver: (conversationId) => {
      send(QUEUES.summary, { conversationId }, conversationId)
      send(QUEUES.suggest, { conversationId }, conversationId)
    },
    resolved: (conversationId) =>
      send(QUEUES.summary, { conversationId, closing: true }, conversationId, 2),
    suggest: (conversationId) => send(QUEUES.suggest, { conversationId }, conversationId),
    knowledgeChanged: () => send(QUEUES.knowledge, {}, 'all', 2),
    pageAnswered: (conversationId) =>
      send(QUEUES.answer, { conversationId, continuing: true }, conversationId),
  }
  // What is indexed may lag behind the articles since the last start.
  jobs.knowledgeChanged()
  return { jobs, stop: () => boss.stop({ graceful: true, timeout: 10_000 }) }
}
