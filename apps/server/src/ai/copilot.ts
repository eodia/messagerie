import { type Llm, Redactor, readJson } from '@chat/ai'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { conversationTags, conversations } from '../db/schema.js'
import type { AgentRow } from '../inbox/read.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'
import { type Context, customer, loadContext, numbered } from './context.js'
import type { AiDeps } from './responder.js'
import { recordRun } from './runs.js'
import { languageCode } from './translate.js'

/**
 * The agent's copilot (framing, phase 3): what to answer, with its sources; the
 * conversation's intent, tags, mood and priority; its summary; a draft reworded. Every
 * call traced (D9); the verdicts of agents on the suggestions are the evaluation set.
 */

const transcript = (context: Context) =>
  context.history
    .map(
      (m) =>
        `${m.role === 'user' ? 'Visiteur' : 'Nous'} : ${'content' in m ? (m.content ?? '') : ''}`,
    )
    .join('\n')

/** One to three replies the agent may send, drawn from the knowledge base. */
export async function suggest(deps: AiDeps, conversationId: string): Promise<void> {
  const context = await loadContext(
    deps.db,
    deps.settings,
    deps.knowledge,
    conversationId,
    deps.redact,
  )
  if (!context || !context.question) return
  if (context.conversation.status !== 'open' && context.conversation.status !== 'pending') return

  const completion = await deps.llm.complete({
    json: true,
    messages: [
      {
        role: 'system',
        content: [
          `Tu aides un conseiller de ${context.site.name} à répondre à un client. Propose de une à trois réponses qu’il pourra envoyer telles quelles : courtes, polies, dans la langue du client, fondées sur les SOURCES et la fiche du client. Si les sources ne suffisent pas, propose de demander la précision qui manque. N’invente rien.`,
          context.site.instructions
            ? `Consignes de ${context.site.name} :\n${context.site.instructions}`
            : '',
          `SOURCES :\n${numbered(context.sources)}`,
          `FICHE DU CLIENT :\n${customer(context)}`,
          'Mise en forme : du Markdown léger quand il aide à lire — **gras** pour l’essentiel, *italique*, une liste « - » pour des étapes ; ni titres, ni tableaux. Un retour à la ligne s’écrit \\n.',
          'Réponds UNIQUEMENT en JSON : {"suggestions": [{"text": "…", "sources": [numéros]}]}',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
      { role: 'user', content: `Conversation :\n${transcript(context)}` },
    ],
  })
  const json = readJson(completion.text)
  const suggestions = (Array.isArray(json?.suggestions) ? json.suggestions : [])
    .map((s) => (typeof s === 'object' && s !== null ? (s as { text?: unknown }).text : s))
    .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    .slice(0, 3)
    .map((t) => context.redactor.unmask(t.trim()))
  if (suggestions.length === 0) return
  await recordRun(deps.db, {
    conversationId,
    kind: 'suggestion',
    completion,
    input: {
      question: context.redactor.mask(context.question),
      sources: context.sources.map((s) => s.title),
    },
    output: { suggestions },
  })
  // The inbox reads the thread again, and finds them.
  await signalChange(deps.db, conversationId)
}

const SENTIMENTS = ['positive', 'neutral', 'negative'] as const
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

/**
 * What the conversation is about, as each visitor message makes it clearer: its intent,
 * the tags the AI may set, the visitor's mood, a priority — and their language, where
 * the site translates. The agents' own tags are never touched.
 *
 * It reads the whole conversation, answered or not: the AI answers within a second or two,
 * and the visitor's words are no less angry for having been answered.
 */
export async function enrich(deps: AiDeps, conversationId: string): Promise<void> {
  const context = await loadContext(
    deps.db,
    deps.settings,
    deps.knowledge,
    conversationId,
    deps.redact,
  )
  if (!context || !context.history.some((m) => m.role === 'user')) return
  const tags = (await deps.settings.tags()).filter((t) => t.byAi)
  const completion = await deps.llm.complete({
    json: true,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: [
          'Tu classes une conversation de service client. Réponds UNIQUEMENT en JSON :',
          '{"intent": "l’intention du visiteur, en quatre mots au plus, en français", "tags": [étiquettes qui s’appliquent, prises dans la liste], "sentiment": "positive" | "neutral" | "negative", "priority": "low" | "normal" | "high" | "urgent", "language": "la langue dans laquelle le visiteur écrit, code ISO 639-1 (fr, en, de…)"}',
          'La priorité est haute quand le client est bloqué ou mécontent, urgente en cas de danger ou de délai légal.',
          `ÉTIQUETTES :\n${tags.map((t) => `- ${t.name}${t.when ? ` : ${t.when}` : ''}`).join('\n') || '(aucune)'}`,
        ].join('\n'),
      },
      { role: 'user', content: transcript(context) },
    ],
  })
  const json = readJson(completion.text) ?? {}
  const chosen = (Array.isArray(json.tags) ? json.tags : [])
    .filter((t): t is string => typeof t === 'string')
    .map((name) => tags.find((t) => t.name.toLowerCase() === name.toLowerCase()))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
  const intent =
    typeof json.intent === 'string' && json.intent.trim() ? json.intent.trim().slice(0, 80) : null
  const sentiment = SENTIMENTS.find((s) => s === json.sentiment) ?? null
  const priority = PRIORITIES.find((p) => p === json.priority) ?? null
  // Kept where the site translates: a conversation with a language is read translated.
  const language = context.site.translate ? languageCode(json.language) : null

  await recordRun(deps.db, {
    conversationId,
    kind: 'tag',
    completion,
    input: { messages: context.history.length },
    output: { intent, tags: chosen.map((t) => t.name), sentiment, priority, language },
  })
  await deps.db.transaction(async (tx) => {
    await tx
      .update(conversations)
      .set({
        ...(intent ? { intent } : {}),
        ...(sentiment ? { sentiment } : {}),
        ...(priority ? { priority } : {}),
        ...(language ? { language } : {}),
      })
      .where(eq(conversations.id, conversationId))
    // The AI's tags are replaced; an agent's stay.
    await tx
      .delete(conversationTags)
      .where(
        and(eq(conversationTags.conversationId, conversationId), eq(conversationTags.origin, 'ai')),
      )
    if (chosen.length > 0) {
      await tx
        .insert(conversationTags)
        .values(
          chosen.map((t) => ({
            conversationId,
            label: t.name,
            color: t.color,
            origin: 'ai' as const,
          })),
        )
        .onConflictDoNothing()
    }
    await signalChange(tx, conversationId)
  })
}

/**
 * The conversation in a few sentences — for the agent who picks it up, and at its close,
 * with how it ended.
 */
export async function summarize(
  deps: AiDeps,
  conversationId: string,
  closing: boolean,
): Promise<void> {
  const context = await loadContext(
    deps.db,
    deps.settings,
    deps.knowledge,
    conversationId,
    deps.redact,
  )
  if (!context || context.history.length === 0) return
  const completion = await deps.llm.complete({
    json: true,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: closing
          ? 'Résume cette conversation de service client, close, en trois phrases au plus : la demande, ce qui a été fait, comment elle s’est terminée. Réponds UNIQUEMENT en JSON : {"summary": "…", "resolution": "répondue" | "transférée" | "sans suite" | "autre"}'
          : 'Résume cette conversation de service client en deux phrases, pour le conseiller qui la reprend : ce que veut le client et ce qui a déjà été dit. Réponds UNIQUEMENT en JSON : {"summary": "…"}',
      },
      { role: 'user', content: transcript(context) },
    ],
  })
  const json = readJson(completion.text)
  const summary =
    typeof json?.summary === 'string' ? context.redactor.unmask(json.summary.trim()) : null
  if (!summary) return
  await recordRun(deps.db, {
    conversationId,
    kind: 'summary',
    completion,
    input: { closing, messages: context.history.length },
    output: { summary, resolution: json?.resolution ?? null },
  })
  await deps.db.transaction(async (tx) => {
    await tx.update(conversations).set({ summary }).where(eq(conversations.id, conversationId))
    await signalChange(tx, conversationId)
  })
}

export type Rewording = 'clearer' | 'shorter' | 'warmer' | 'correct'

const REWORDINGS: Readonly<Record<Rewording, string>> = {
  clearer: 'Reformule ce brouillon pour qu’il soit plus clair, sans en changer le sens.',
  shorter: 'Raccourcis ce brouillon en gardant l’essentiel.',
  warmer: 'Rends ce brouillon plus chaleureux et plus empathique, sans en changer le sens.',
  correct:
    'Relis ce brouillon et corrige seulement l’orthographe, les accords, la conjugaison, la ponctuation et la typographie. Ne reformule rien : garde les mêmes mots quand ils sont justes, le même ordre, et exactement les mêmes retours à la ligne. S’il n’y a rien à corriger, rends le texte tel quel.',
}

/** An agent's draft, reworded — never sent: the agent reads it and sends it. */
export async function rephrase(
  deps: { readonly db: Db; readonly llm: Llm; readonly redact: boolean },
  agent: AgentRow,
  conversationId: string,
  draft: string,
  how: Rewording,
): Promise<string> {
  const text = draft.trim()
  if (text === '') throw new Refusal('EMPTY_MESSAGE', 400)
  const redactor = new Redactor(deps.redact)
  const completion = await deps.llm.complete({
    json: true,
    messages: [
      {
        role: 'system',
        content: `${REWORDINGS[how]} Le texte est la réponse d’un conseiller à un client ; garde sa langue et le vouvoiement. Réponds UNIQUEMENT en JSON : {"text": "…"}`,
      },
      { role: 'user', content: redactor.mask(text) },
    ],
  })
  const json = readJson(completion.text)
  const reworded = typeof json?.text === 'string' ? redactor.unmask(json.text.trim()) : ''
  await recordRun(deps.db, {
    conversationId,
    kind: 'rephrase',
    completion,
    input: { how, length: text.length, agent: agent.id },
    output: { length: reworded.length },
  })
  if (!reworded) throw new Refusal('INTERNAL_ERROR', 502)
  return reworded
}
