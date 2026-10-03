import { createHash } from 'node:crypto'
import type { Completion, CompletionRequest, Llm } from '@chat/ai'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { and, eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { enrich, suggest } from '../../src/ai/copilot.js'
import { Knowledge } from '../../src/ai/knowledge.js'
import { McpConnections } from '../../src/ai/mcp.js'
import { type AiDeps, answerVisitor } from '../../src/ai/responder.js'
import { purgeExpired } from '../../src/ai/retention.js'
import { translateReply, translateThread } from '../../src/ai/translate.js'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import {
  agents,
  aiRuns,
  contacts,
  conversationTags,
  conversations,
  kbChunks,
  messages,
  notifications,
} from '../../src/db/schema.js'
import { createConversation, receiveVisitorMessage } from '../../src/inbox/incoming.js'
import { loadConversation } from '../../src/inbox/read.js'
import { sendMessage } from '../../src/inbox/write.js'
import { MemorySource } from '../../src/settings/demo.js'
import { Settings } from '../../src/settings/settings.js'

/**
 * The AI's decisions, against a real PostgreSQL and a scripted model: what it answers,
 * when it hands over, what it never sends. The model is not what is tested — the chat's
 * handling of what a model says is.
 */

type Script = (request: CompletionRequest) => Partial<Completion> | Promise<Partial<Completion>>

class ScriptedLlm implements Llm {
  readonly model = 'scripted'
  readonly embeddingModel = 'scripted-embed'
  readonly external = false
  script: Script = () => ({ text: '{}' })
  readonly requests: CompletionRequest[] = []

  async complete(request: CompletionRequest): Promise<Completion> {
    this.requests.push(request)
    const part = await this.script(request)
    return { text: '', toolCalls: [], model: this.model, usage: null, latencyMs: 5, ...part }
  }

  /** A vector per text, stable and spread: the same text, the same point. */
  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((text) => {
      const seed = createHash('sha256').update(text).digest()
      const vector = Array.from(
        { length: 1024 },
        (_, i) => ((seed[i % 32] ?? 0) - 128) / 128 + Math.sin(i),
      )
      const norm = Math.hypot(...vector)
      return vector.map((v) => v / norm)
    })
  }
}

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let deps: AiDeps
const llm = new ScriptedLlm()
const settings = new Settings(new MemorySource('dev-marc'))

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)
  await db.insert(agents).values({ login: 'dev-marc', name: 'Marc JAMAIN', role: 'supervisor' })
  deps = {
    db,
    settings,
    knowledge: new Knowledge(db, settings, llm),
    llm,
    redact: true,
    mcp: new McpConnections(),
    files: null,
  }
  await deps.knowledge.sync()
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

const SITE = { id: 'acme', name: 'Acme Assurances', aiEnabled: true, defaultTeamId: 'support' }

async function visitorAsks(text: string, identified = false): Promise<string> {
  const [contact] = await db
    .insert(contacts)
    .values({
      siteId: 'acme',
      name: identified ? 'Sophie Leroy' : 'Visiteur',
      identified,
      email: identified ? 'sophie@exemple.fr' : null,
      attributes: identified ? [{ label: 'Statut du dossier', value: 'En cours' }] : [],
    })
    .returning()
  const id = await createConversation(db, contact?.id ?? '', SITE)
  await receiveVisitorMessage(db, id, text)
  return id
}

const thread = (id: string) =>
  db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt)
const statusOf = async (id: string) =>
  (await db.select().from(conversations).where(eq(conversations.id, id)))[0]?.status

const decide =
  (decision: Record<string, unknown>): Script =>
  () => ({ text: JSON.stringify(decision) })

describe('the index', () => {
  it('holds the published articles and promoted conversations, and embeds nothing twice', async () => {
    const chunks = await db.select().from(kbChunks)
    expect(new Set(chunks.filter((c) => c.source === 'article').map((c) => c.sourceId)).size).toBe(
      8,
    )
    expect(
      new Set(chunks.filter((c) => c.source === 'conversation').map((c) => c.sourceId)).size,
    ).toBe(2)
    expect(await deps.knowledge.sync()).toMatchObject({ indexed: 0, removed: 0, kept: 10 })
  })
})

describe('the AI in the first line', () => {
  it('answers from its sources, and says which', async () => {
    llm.script = decide({
      action: 'answer',
      answer: 'Sous 5 à 10 jours ouvrés.',
      confidence: 0.92,
      sources: [1],
    })
    const id = await visitorAsks('Quel est le délai de remboursement ?')
    await answerVisitor(deps, id)
    const said = (await thread(id)).at(-1)
    expect(said).toMatchObject({ author: 'ai', kind: 'text', body: 'Sous 5 à 10 jours ouvrés.' })
    expect(said?.meta.sources?.length).toBe(1)
    expect(await statusOf(id)).toBe('ai')
    const [run] = await db
      .select()
      .from(aiRuns)
      .where(eq(aiRuns.id, said?.aiRunId ?? ''))
    expect(run).toMatchObject({ kind: 'answer', confidence: 0.92, model: 'scripted' })
  })

  it('never sends the model personal data: it sees placeholders, the visitor the values', async () => {
    llm.script = (request) => {
      const seen = JSON.stringify(request.messages)
      expect(seen).not.toContain('sophie@exemple.fr')
      return {
        text: JSON.stringify({
          action: 'answer',
          answer: 'Je vous écris à [EMAIL_1].',
          confidence: 0.9,
        }),
      }
    }
    const id = await visitorAsks('Écrivez-moi à sophie@exemple.fr')
    await answerVisitor(deps, id)
    expect((await thread(id)).at(-1)?.body).toBe('Je vous écris à sophie@exemple.fr.')
  })

  it('hands over below the site’s threshold, and tells the visitor when an agent is back', async () => {
    llm.script = decide({
      action: 'answer',
      answer: 'Peut-être ?',
      confidence: 0.4,
      summary: 'Question floue.',
    })
    const id = await visitorAsks('Et pour les bateaux ?')
    await answerVisitor(deps, id)
    // Outside the site's hours, the widget's request for an address follows: not said here.
    const spoken = async () => (await thread(id)).filter((m) => m.kind !== 'event')
    const kinds = (await spoken()).map((m) => `${m.author}:${m.kind}`)
    expect(kinds.slice(-2)).toEqual(['ai:text', 'ai:handoff'])
    const said = (await spoken()).at(-2)?.body ?? ''
    expect(said).not.toContain('Peut-être')
    expect(said).toMatch(/conseiller/)
    expect(await statusOf(id)).toBe('open')
    const handoff = (await spoken()).at(-1)?.meta.handoff
    expect(handoff?.reason).toMatch(/Confiance insuffisante \(40 % < 70 %\)/)
    // Nobody in particular has it: every active agent is told.
    expect(
      await db.select().from(notifications).where(eq(notifications.conversationId, id)),
    ).toHaveLength(1)
  })

  it('follows a guardrail, with the guardrail’s own words', async () => {
    llm.script = decide({
      action: 'handoff',
      answer: 'x',
      confidence: 0.9,
      guardrail: 'Litiges et réclamations',
    })
    const id = await visitorAsks('Je vais porter plainte !')
    await answerVisitor(deps, id)
    const [said, handoff] = (await thread(id)).filter((m) => m.kind !== 'event').slice(-2)
    expect(said?.body).toBe(
      'Je transmets votre demande à un conseiller, qui la reprend personnellement.',
    )
    expect(handoff?.meta.handoff?.reason).toBe('Garde-fou : Litiges et réclamations')
  })

  it('sends nothing once an agent took the conversation while it was writing', async () => {
    let id = ''
    llm.script = async () => {
      await db.update(conversations).set({ status: 'open' }).where(eq(conversations.id, id))
      return { text: JSON.stringify({ action: 'answer', answer: 'Trop tard', confidence: 0.99 }) }
    }
    id = await visitorAsks('Bonjour ?')
    await answerVisitor(deps, id)
    expect((await thread(id)).map((m) => m.body)).not.toContain('Trop tard')
  })

  it('calls a declared tool, and leaves its trace for the agents', async () => {
    let step = 0
    llm.script = (request) => {
      step++
      if (step === 1) {
        expect(request.tools?.map((t) => t.name)).toContain('consulter_la_fiche_du_client_1')
        return {
          toolCalls: [{ id: 'call1', name: 'consulter_la_fiche_du_client_1', arguments: '{}' }],
        }
      }
      const toolResult = request.messages.find((m) => m.role === 'tool')
      expect(toolResult && 'content' in toolResult ? toolResult.content : '').toContain('En cours')
      return {
        text: JSON.stringify({
          action: 'answer',
          answer: 'Votre dossier est en cours.',
          confidence: 0.9,
        }),
      }
    }
    const id = await visitorAsks('Où en est mon dossier ?', true)
    await answerVisitor(deps, id)
    const events = (await thread(id)).filter((m) => m.kind === 'event')
    expect(events.map((e) => e.meta.event)).toEqual([
      {
        type: 'tool',
        tool: 'Consulter la fiche du client',
        detail: expect.stringContaining('fiche du client'),
      },
    ])
    expect((await thread(id)).at(-1)?.body).toBe('Votre dossier est en cours.')
  })

  it('hands over when the model answers nothing readable', async () => {
    llm.script = () => ({ text: 'je ne sais pas' })
    const id = await visitorAsks('???')
    await answerVisitor(deps, id)
    expect(await statusOf(id)).toBe('open')
  })
})

describe('the copilot', () => {
  it('suggests replies for an agent’s conversation', async () => {
    llm.script = () => ({
      text: JSON.stringify({ suggestions: [{ text: 'Bonjour, je regarde.' }, 'Un instant.'] }),
    })
    const id = await visitorAsks('Allô ?')
    await db.update(conversations).set({ status: 'open' }).where(eq(conversations.id, id))
    await suggest(deps, id)
    const [run] = await db
      .select()
      .from(aiRuns)
      .where(and(eq(aiRuns.conversationId, id), eq(aiRuns.kind, 'suggestion')))
    expect(run?.output).toMatchObject({ suggestions: ['Bonjour, je regarde.', 'Un instant.'] })
  })

  it('tags with the tags the AI may set, and leaves the agents’ own', async () => {
    llm.script = decide({
      intent: 'Suivi de remboursement',
      tags: ['Remboursement', 'Inventée'],
      sentiment: 'negative',
      priority: 'high',
    })
    const id = await visitorAsks('Toujours pas remboursé !')
    await db
      .insert(conversationTags)
      .values({ conversationId: id, label: 'À rappeler', color: '#ef4444', origin: 'agent' })
    await enrich(deps, id)
    const tags = await db
      .select()
      .from(conversationTags)
      .where(eq(conversationTags.conversationId, id))
    expect(tags.map((t) => `${t.label}/${t.origin}`).sort()).toEqual([
      'Remboursement/ai',
      'À rappeler/agent',
    ])
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(row).toMatchObject({
      intent: 'Suivi de remboursement',
      sentiment: 'negative',
      priority: 'high',
    })
  })
})

describe('the reading of a conversation', () => {
  it('reads the visitor’s mood even once the AI has answered them', async () => {
    llm.script = decide({ intent: 'Insulte', tags: [], sentiment: 'negative', priority: 'high' })
    const id = await visitorAsks('Hého vous êtes con ou quoi ?')
    await db.insert(messages).values({ conversationId: id, author: 'ai', body: 'Je comprends.' })
    await enrich(deps, id)
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(row).toMatchObject({ sentiment: 'negative', priority: 'high', intent: 'Insulte' })
  })
})

describe('the automatic translation', () => {
  const agent = async () => {
    const [row] = await db.select().from(agents).where(eq(agents.login, 'dev-marc'))
    if (!row) throw new Error('no agent')
    return row
  }

  it('reads the visitor’s language, and translates their words and the AI’s for the agents', async () => {
    llm.script = decide({ intent: 'Remboursement', tags: [], sentiment: 'neutral', language: 'DE' })
    const id = await visitorAsks('Wann werde ich erstattet?')
    await db
      .insert(messages)
      .values({ conversationId: id, author: 'ai', body: 'Innerhalb von 5 bis 10 Werktagen.' })
    await enrich(deps, id)
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(row?.language).toBe('de')

    llm.script = (request) => {
      const asked = String(request.messages[1]?.content ?? '')
      expect(asked).toContain('[m1]\nWann werde ich erstattet?')
      return {
        text: JSON.stringify({
          messages: [
            { id: 'm1', language: 'de', text: 'Quand serai-je remboursé ?' },
            { id: 'm2', language: 'de', text: 'Sous 5 à 10 jours ouvrés.' },
          ],
        }),
      }
    }
    await translateThread(deps, id)
    const seen = await loadConversation(db, id, await agent())
    expect(seen.language).toBe('de')
    const [visitor, ai] = seen.messages
    expect(visitor).toMatchObject({
      kind: 'visitor',
      body: 'Wann werde ich erstattet?',
      translation: { from: 'de', language: 'fr', body: 'Quand serai-je remboursé ?' },
    })
    expect(ai).toMatchObject({
      kind: 'ai',
      translation: { from: 'de', language: 'fr', body: 'Sous 5 à 10 jours ouvrés.' },
    })

    // Read once: the model is not asked again for the same words.
    const asked = llm.requests.length
    await translateThread(deps, id)
    expect(llm.requests.length).toBe(asked)
    const [run] = await db
      .select()
      .from(aiRuns)
      .where(and(eq(aiRuns.conversationId, id), eq(aiRuns.kind, 'translation')))
    expect(run?.output).toMatchObject({ translated: 2 })
  })

  it('costs nothing in the agents’ language', async () => {
    llm.script = decide({ intent: 'Attestation', tags: [], sentiment: 'neutral', language: 'fr' })
    const id = await visitorAsks('Où trouver mon attestation ?')
    await enrich(deps, id)
    const asked = llm.requests.length
    await translateThread(deps, id)
    expect(llm.requests.length).toBe(asked)
    const seen = await loadConversation(db, id, await agent())
    expect(seen.messages[0]).not.toHaveProperty('translation')
  })

  it('sends the agent’s reply in the visitor’s language, and keeps the agent’s words', async () => {
    const id = await visitorAsks('Where is my certificate?')
    await db.update(conversations).set({ language: 'en' }).where(eq(conversations.id, id))
    llm.script = (request) => {
      expect(String(request.messages[0]?.content)).toContain('anglais')
      return {
        text: JSON.stringify({ language: 'fr', text: 'It is in your customer area.' }),
      }
    }
    const reply = await translateReply(
      { db, llm, redact: true },
      id,
      'Elle est dans votre espace client.',
      'en',
    )
    expect(reply).toEqual({
      body: 'It is in your customer area.',
      meta: {
        language: 'en',
        translation: { from: 'en', language: 'fr', body: 'Elle est dans votre espace client.' },
      },
    })
    const sent = await sendMessage(
      db,
      await agent(),
      id,
      { body: reply.body, kind: 'reply' },
      undefined,
      reply.meta,
    )
    expect(sent.messages.at(-1)).toMatchObject({
      kind: 'agent',
      body: 'It is in your customer area.',
      translation: { body: 'Elle est dans votre espace client.' },
    })

    // Words already in the visitor's language — a suggestion of the copilot — go as they are.
    llm.script = decide({ language: 'en', text: 'Hello there.' })
    expect(await translateReply({ db, llm, redact: true }, id, 'Hello!', 'en')).toEqual({
      body: 'Hello!',
      meta: { language: 'en' },
    })
  })
})

describe('retention', () => {
  it('purges what has been quiet longer than the site keeps it', async () => {
    const id = await visitorAsks('Vieille question')
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(Date.now() - 400 * 86_400_000) })
      .where(eq(conversations.id, id))
    expect(await purgeExpired(db, settings)).toBeGreaterThanOrEqual(1)
    expect(await statusOf(id)).toBeUndefined()
  })
})
