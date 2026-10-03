import type { SurveyScale } from '@chat/contracts'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agents, conversations, messages, surveys } from '../db/schema.js'
import { person } from '../programs.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'

/**
 * « Enquête de satisfaction »: at the end of a conversation, an automation (D20) asks the
 * visitor for a score — CSAT, 1 to 5, or NPS, 0 to 10 — and a word if they like. Asked
 * once a conversation; the answer judges the agent who had it then, or the AI alone, and
 * the dashboards read it (`analytics.surveys`, D22).
 */

/** The scores each scale takes. */
export const SCALES: Readonly<Record<SurveyScale, { readonly min: number; readonly max: number }>> =
  {
    csat: { min: 1, max: 5 },
    nps: { min: 0, max: 10 },
  }

const COMMENT_MAX = 1000

/**
 * Asks, inside the caller's transaction; whether it did — not twice in a conversation, nor
 * in one the visitor left for another.
 */
export async function requestSurvey(
  tx: Db,
  conversationId: string,
  scale: SurveyScale,
  question: string | null,
  by: string | null,
  at: Date = new Date(),
): Promise<boolean> {
  const [row] = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .for('update')
  if (!row || row.visitorLeftAt !== null) return false
  const [asked] = await tx
    .select({ id: surveys.id })
    .from(surveys)
    .where(eq(surveys.conversationId, conversationId))
  if (asked) return false
  // Who is judged: the agent who has it — or, back in the queue, the last one who answered.
  const [last] = row.assigneeId
    ? [{ id: row.assigneeId }]
    : await tx
        .select({ id: agents.id })
        .from(messages)
        .innerJoin(agents, eq(agents.id, messages.agentId))
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.author, 'agent'),
            eq(messages.kind, 'text'),
            isNull(messages.deletedAt),
            person(agents.login),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(1)
  const [survey] = await tx
    .insert(surveys)
    .values({
      conversationId,
      scale,
      question: question || null,
      askedBy: by,
      agentId: last?.id ?? null,
      createdAt: at,
    })
    .returning({ id: surveys.id })
  if (!survey) throw new Error('survey not inserted')
  await tx.insert(messages).values({
    conversationId,
    author: 'system',
    kind: 'event',
    meta: { event: { type: 'survey_requested', survey: survey.id, scale, by } },
    createdAt: at,
  })
  await signalChange(tx, conversationId)
  return true
}

/**
 * The visitor answers the card: their score, and their word. Once — the second answer is
 * refused, the card thanks them already.
 */
export async function answerSurvey(
  db: Db,
  contactId: string,
  surveyId: string,
  raw: Readonly<Record<string, unknown>>,
): Promise<void> {
  const [found] = await db
    .select({ survey: surveys })
    .from(surveys)
    .innerJoin(conversations, eq(conversations.id, surveys.conversationId))
    .where(and(eq(surveys.id, surveyId), eq(conversations.contactId, contactId)))
  if (!found) throw new Refusal('SURVEY_NOT_FOUND', 404)
  const { survey } = found
  const { min, max } = SCALES[survey.scale]
  const score = raw.score
  if (typeof score !== 'number' || !Number.isInteger(score) || score < min || score > max) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'score', min, max })
  }
  if (raw.comment !== undefined && raw.comment !== null && typeof raw.comment !== 'string') {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'comment' })
  }
  const comment = typeof raw.comment === 'string' ? raw.comment.trim() : ''
  if (comment.length > COMMENT_MAX) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'comment', max: COMMENT_MAX })
  }

  await db.transaction(async (tx) => {
    await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, survey.conversationId))
      .for('update')
    const [answered] = await tx
      .update(surveys)
      .set({ score, comment: comment || null, answeredAt: new Date() })
      .where(and(eq(surveys.id, survey.id), isNull(surveys.score)))
      .returning({ id: surveys.id })
    if (!answered) throw new Refusal('SURVEY_ANSWERED', 409)
    await tx.insert(messages).values({
      conversationId: survey.conversationId,
      author: 'system',
      kind: 'event',
      meta: {
        event: {
          type: 'survey_answered',
          survey: survey.id,
          scale: survey.scale,
          score,
          comment: comment || null,
        },
      },
    })
    await signalChange(tx, survey.conversationId)
  })
}
