import type { ChatMessage, Completion, Llm } from '@chat/ai'
import { readJson } from '@chat/ai'
import type { Source } from '@chat/contracts'
import { eq } from 'drizzle-orm'
import type { BasedbClient } from '../basedb/client.js'
import type { Db } from '../db/client.js'
import { conversations, messages } from '../db/schema.js'
import type { FileStore } from '../files/store.js'
import { Access } from '../inbox/access.js'
import { handOff } from '../inbox/incoming.js'
import { signalChange, signalTyping } from '../realtime/signals.js'
import type { Settings } from '../settings/settings.js'
import { type Context, customer, loadContext, numbered, siteLocale, whenLabel } from './context.js'
import type { Knowledge } from './knowledge.js'
import type { McpConnections } from './mcp.js'
import { recordRun } from './runs.js'
import { toolBoxFor } from './tools.js'

/**
 * The AI in the first line (framing, phase 4): it answers the visitor from the knowledge
 * base and the customer's record, calls the tools basedb declares, and hands over — with a
 * summary — when a guardrail says so, when the visitor asks for a person, or when it is not
 * sure enough by the site's threshold. It never answers in a conversation an agent took.
 */

export interface AiDeps {
  readonly db: Db
  readonly settings: Settings
  readonly knowledge: Knowledge
  readonly llm: Llm
  readonly redact: boolean
  readonly basedb: BasedbClient | null
  readonly mcp: McpConnections
  /** Where the conversations' files are, for the purge. */
  readonly files: FileStore | null
}

interface Decision {
  readonly action: 'answer' | 'handoff'
  readonly answer: string
  readonly confidence: number
  readonly sources: readonly number[]
  readonly guardrail: string | null
  readonly reason: string | null
  readonly summary: string | null
}

const TOOL_ROUNDS = 3

function decisionOf(json: Record<string, unknown> | null): Decision | null {
  if (!json) return null
  const text = (key: string) =>
    typeof json[key] === 'string' && (json[key] as string).trim()
      ? (json[key] as string).trim()
      : null
  const confidence =
    typeof json.confidence === 'number' ? Math.min(Math.max(json.confidence, 0), 1) : 0
  return {
    action: json.action === 'handoff' ? 'handoff' : 'answer',
    answer: text('answer') ?? '',
    confidence,
    sources: Array.isArray(json.sources)
      ? json.sources.filter((n): n is number => typeof n === 'number')
      : [],
    guardrail: text('guardrail'),
    reason: text('reason'),
    summary: text('summary'),
  }
}

async function systemPrompt(deps: AiDeps, context: Context): Promise<string> {
  const guardrails = await deps.settings.guardrails()
  const { site, hours } = context
  const availability = hours.open
    ? 'Des conseillers sont disponibles en ce moment.'
    : hours.nextOpening
      ? `Aucun conseiller n’est disponible avant ${whenLabel(hours.nextOpening, site)}. Si tu transfères, dis-le au visiteur avec ces mots-là (« ${whenLabel(hours.nextOpening, site)} »), sans les changer en date complète.`
      : 'Aucun conseiller n’est disponible pour le moment. Si tu transfères, dis-le au visiteur.'
  return [
    `Tu es l’assistant virtuel de ${site.name}, dans la messagerie de son site. Tu réponds au visiteur dans sa langue (par défaut : ${site.language}).`,
    site.instructions ? `Consignes de ${site.name} :\n${site.instructions}` : '',
    'Règles :',
    '- Réponds à partir des SOURCES, de la fiche du client et de ce que les outils te renvoient. Dès que les sources contiennent la réponse, même en partie, réponds : c’est leur rôle. Cite les numéros des sources utilisées.',
    '- Une règle générale des sources (un délai habituel, une démarche, une garantie) se donne telle quelle. Ce qui ne se promet jamais, c’est ce qui touche le dossier particulier du client : son montant, la date précise de son paiement, une décision sur son sinistre.',
    '- Transfère à un conseiller seulement si les sources ne répondent pas, si un garde-fou s’applique, ou si le visiteur demande une personne. N’invente rien.',
    '- Les valeurs entre crochets, comme [EMAIL_1], sont masquées : reprends-les telles quelles si besoin.',
    guardrails.length > 0
      ? `- Garde-fous : si la demande relève de l’un de ces sujets, transfère sans répondre sur le fond et indique son nom dans "guardrail".\n${guardrails.map((g) => `  • ${g.name} : ${g.topic}`).join('\n')}`
      : '',
    `- ${availability}`,
    '',
    'Quand tu as fini, réponds UNIQUEMENT par un objet JSON :',
    '{"action": "answer" ou "handoff", "answer": "ton message au visiteur (si tu transfères : l’annonce du transfert)", "confidence": nombre de 0 à 1 — ta certitude que la réponse est juste et complète d’après les sources, "sources": [numéros des sources utilisées], "guardrail": nom du garde-fou ou null, "reason": "pourquoi tu transfères, en une phrase" ou null, "summary": "la demande du visiteur, en deux phrases, pour le conseiller"}',
    '',
    `SOURCES :\n${numbered(context.sources)}`,
    '',
    `FICHE DU CLIENT :\n${customer(context)}`,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** Whether the conversation is still the AI's — an agent may have taken it meanwhile. */
async function stillMine(db: Db, id: string): Promise<boolean> {
  const [row] = await db
    .select({ status: conversations.status })
    .from(conversations)
    .where(eq(conversations.id, id))
  return row?.status === 'ai'
}

/** The words that announce a handoff the model did not write: in the site's language. */
function handoffNotice(context: Context): string {
  const english = siteLocale(context.site).startsWith('en')
  const later = !context.hours.open && context.hours.nextOpening
  if (english) {
    return later
      ? `I am passing your request to an advisor, who will answer you from ${whenLabel(context.hours.nextOpening as Date, context.site)}.`
      : 'I am passing your request to an advisor, who will answer you shortly.'
  }
  return later
    ? `Je transmets votre demande à un conseiller, qui vous répondra à partir de ${whenLabel(context.hours.nextOpening as Date, context.site)}.`
    : 'Je transmets votre demande à un conseiller, qui vous répond dans quelques instants.'
}

export async function answerVisitor(deps: AiDeps, conversationId: string): Promise<void> {
  const { db, settings, llm } = deps
  if (!(await stillMine(db, conversationId))) return
  const context = await loadContext(db, settings, deps.knowledge, conversationId, deps.redact)
  if (!context || !context.question) return
  if (!context.site.aiEnabled) return
  await signalTyping(db, conversationId)

  const tools = await toolBoxFor(
    {
      db,
      settings,
      basedb: deps.basedb,
      mcp: deps.mcp,
      conversationId,
      contact: context.contact,
      redactor: context.redactor,
    },
    'agent',
  )
  const conversation: ChatMessage[] = [
    { role: 'system', content: await systemPrompt(deps, context) },
    ...context.history,
  ]
  const usage = { promptTokens: 0, completionTokens: 0 }
  let latency = 0
  const tally = (c: Completion): Completion => {
    latency += c.latencyMs
    usage.promptTokens += c.usage?.promptTokens ?? 0
    usage.completionTokens += c.usage?.completionTokens ?? 0
    return c
  }

  // The tools first, if the model wants them; then its decision, in JSON.
  const specs = tools.specs()
  let last: Completion | null = null
  for (let round = 0; round < TOOL_ROUNDS && specs.length > 0; round++) {
    const step = tally(await llm.complete({ messages: conversation, tools: specs }))
    last = step
    if (step.toolCalls.length === 0) break
    conversation.push({ role: 'assistant', content: step.text || null, toolCalls: step.toolCalls })
    for (const call of step.toolCalls) {
      const ran = await tools.run(call)
      conversation.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: ran.content,
      })
    }
    await signalTyping(db, conversationId)
  }
  let decision = last && last.toolCalls.length === 0 ? decisionOf(readJson(last.text)) : null
  if (!decision) {
    const closing: ChatMessage[] = last
      ? [{ role: 'user', content: 'Donne maintenant ta décision, en JSON seulement.' }]
      : []
    last = tally(await llm.complete({ messages: [...conversation, ...closing], json: true }))
    decision = decisionOf(readJson(last.text))
  }
  if (!decision) {
    decision = {
      action: 'handoff',
      answer: '',
      confidence: 0,
      sources: [],
      guardrail: null,
      reason: 'Réponse illisible du modèle',
      summary: null,
    }
  }

  const threshold = context.site.threshold
  const guardrail = decision.guardrail
    ? (await settings.guardrails()).find(
        (g) => g.name.toLowerCase() === decision.guardrail?.toLowerCase(),
      )
    : undefined
  const handingOver =
    decision.action === 'handoff' || decision.guardrail !== null || decision.confidence < threshold
  const answer = context.redactor.unmask(decision.answer)
  const used: Source[] = decision.sources
    .map((n) => context.sources[n - 1])
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .filter((s, i, all) => all.findIndex((o) => o.sourceId === s.sourceId) === i)
    .map((s) => ({
      title: s.title.split(' — ')[0] ?? s.title,
      origin: s.source,
      detail: s.source === 'article' ? 'Article' : 'Conversation promue',
      ...(s.source === 'conversation' ? { validated: true } : {}),
    }))

  const runId = await recordRun(db, {
    conversationId,
    kind: 'answer',
    completion: { model: last?.model ?? llm.model, usage, latencyMs: latency },
    input: {
      question: context.redactor.mask(context.question),
      sources: context.sources.map((s) => ({ title: s.title, similarity: s.similarity })),
      tools: specs.map((s) => s.name),
    },
    output: { ...decision, threshold, handingOver },
    confidence: decision.confidence,
  })

  // An agent took the conversation while the model was writing: its answer stays unsent.
  if (!(await stillMine(db, conversationId))) return

  if (!handingOver) {
    await db.transaction(async (tx) => {
      const at = new Date()
      await tx.insert(messages).values({
        conversationId,
        author: 'ai',
        body: answer,
        meta: { sources: used },
        aiRunId: runId,
        createdAt: at,
      })
      await tx
        .update(conversations)
        .set({ lastMessageAt: at, updatedAt: at })
        .where(eq(conversations.id, conversationId))
      await signalChange(tx, conversationId)
    })
    return
  }

  // Handing over: the visitor is told, in words the model wrote or the site's language.
  const notice =
    guardrail?.message ??
    (decision.action === 'handoff' && answer ? answer : handoffNotice(context))
  await db.insert(messages).values({ conversationId, author: 'ai', body: notice, aiRunId: runId })
  // A guardrail's team, or the one the conversation's inbox gave it, or the site's.
  const teams = await settings.teams()
  const [current] = await db
    .select({ teamId: conversations.teamId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  const team = teams.find(
    (t) => t.id === (guardrail?.teamId ?? current?.teamId ?? context.site.defaultTeamId),
  )
  await handOff(
    db,
    conversationId,
    {
      reason: guardrail
        ? `Garde-fou : ${guardrail.name}`
        : decision.action === 'handoff'
          ? (decision.reason ?? 'Transfert demandé')
          : `Confiance insuffisante (${Math.round(decision.confidence * 100)} % < ${Math.round(threshold * 100)} %)`,
      summary: context.redactor.unmask(decision.summary ?? context.question),
      confidence: decision.confidence,
      assigneeId: null,
      team: team?.name ?? 'Support',
      teamId: team?.id ?? null,
      model: last?.model ?? llm.model,
      runId,
    },
    new Access(settings),
  )
}
