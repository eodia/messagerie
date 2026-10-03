import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AutomationDefinition } from '@chat/contracts'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { and, eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type EngineDeps,
  automationPass,
  fireSchedules,
  scanNoReply,
} from '../../src/automations/engine.js'
import {
  type ManageDeps,
  automationRunList,
  buttonsFor,
  createAutomation,
  hookCalled,
  pressButton,
  setAutomationActive,
  updateAutomation,
} from '../../src/automations/manage.js'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import {
  agents,
  automationRuns,
  automations,
  changeEvents,
  contacts,
  conversationTags,
  conversations,
  messages,
  notifications,
  surveys,
} from '../../src/db/schema.js'
import { Access } from '../../src/inbox/access.js'
import type { AgentRow } from '../../src/inbox/read.js'
import { answerSurvey } from '../../src/inbox/surveys.js'
import { assign } from '../../src/inbox/write.js'
import { Refusal } from '../../src/refusal.js'
import { MemorySource } from '../../src/settings/demo.js'
import { Settings } from '../../src/settings/settings.js'

/**
 * The automations (D20), against a real PostgreSQL: what sets them off, what they do,
 * a wait, a schedule, a visitor left waiting, a button, a call from another system — and
 * the chains they must not start.
 */

const KEY = 'a-secret-for-the-tests-of-the-chat-server'

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let marc: AgentRow
let julie: AgentRow
let settings: Settings
let engine: EngineDeps
let manage: ManageDeps

let received: { body: string; headers: Record<string, unknown> }[] = []
let receiver: Server
let target = ''

async function conversation(values: Partial<typeof conversations.$inferInsert> = {}) {
  const [contact] = await db
    .insert(contacts)
    .values({ siteId: 'acme', name: 'Léa Martin' })
    .returning()
  const [row] = await db
    .insert(conversations)
    .values({
      contactId: contact?.id ?? '',
      siteId: 'acme',
      siteName: 'Acme Assurances',
      inboxId: 'service-client',
      status: 'open',
      ...values,
    })
    .returning()
  return row?.id ?? ''
}

const visitorSays = (conversationId: string, body: string, createdAt = new Date()) =>
  db.insert(messages).values({ conversationId, author: 'contact', body, createdAt })

const definition = (over: Partial<AutomationDefinition>): AutomationDefinition => ({
  name: 'Remboursements',
  description: '',
  trigger: { kind: 'visitor_message' },
  condition: { match: 'all', rules: [] },
  steps: [],
  ...over,
})

async function automation(over: Partial<AutomationDefinition>) {
  const made = await createAutomation(manage, marc, definition(over))
  return setAutomationActive(manage, marc, made.id, true)
}

async function runsOf(id: string) {
  return (await automationRunList(manage, marc, id)).items
}

const thread = async (id: string) =>
  db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt)

beforeAll(async () => {
  process.env.CHAT_WEBHOOK_DEV = '1'
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)
  const [boss, colleague] = await db
    .insert(agents)
    .values([
      { login: 'marc@exemple.fr', name: 'Marc', role: 'supervisor' },
      { login: 'julie@exemple.fr', name: 'Julie', role: 'agent' },
    ])
    .returning()
  if (!boss || !colleague) throw new Error('agents not inserted')
  marc = boss
  julie = colleague
  // Marc is the demonstration's agent: teams « support » and « auto ».
  settings = new Settings(new MemorySource(marc.id))
  engine = {
    db,
    settings,
    access: new Access(settings),
    llm: null,
    redact: true,
    webOrigin: 'http://inbox.test',
  }
  manage = { db, settings, secret: KEY, publicUrl: 'http://chat.test', poke: () => {} }

  receiver = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      received.push({ body, headers: request.headers })
      response.setHeader('content-type', 'application/json')
      response.end('{"ticket":"T-42"}')
    })
  })
  await new Promise<void>((done) => receiver.listen(0, '127.0.0.1', done))
  target = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/crm`
}, 180_000)

beforeEach(async () => {
  received = []
  await db.execute(sql`delete from chat.automation_run`)
  await db.execute(sql`delete from chat.automation`)
  await db.execute(sql`delete from chat.change_event`)
})

afterAll(async () => {
  receiver?.close()
  await pool?.end()
  await container?.stop()
  Reflect.deleteProperty(process.env, 'CHAT_WEBHOOK_DEV')
})

describe('an automation', () => {
  it('acts on what the visitor writes, when the condition holds, and signs it', async () => {
    const made = await automation({
      condition: {
        match: 'all',
        rules: [{ field: 'message', op: 'contains', values: ['remboursement'] }],
      },
      steps: [
        { id: 's1', kind: 'tag', add: ['Remboursement'], remove: [] },
        { id: 's2', kind: 'priority', priority: 'high' },
        {
          id: 's3',
          kind: 'note',
          body: '{{contact.prenom}} attend un remboursement : {{message.texte}}',
        },
      ],
    })
    const id = await conversation()
    await visitorSays(id, 'Bonjour, où en est mon Remboursement ?')
    const other = await conversation()
    await visitorSays(other, 'Bonjour, une question sur mon contrat')
    await automationPass(engine)

    const runs = await runsOf(made.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('succeeded')
    expect(runs[0]?.conversationId).toBe(id)
    expect(runs[0]?.steps.map((s) => s.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])

    const tags = await db
      .select()
      .from(conversationTags)
      .where(eq(conversationTags.conversationId, id))
    expect(tags.map((t) => t.label)).toEqual(['Remboursement'])
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(row?.priority).toBe('high')
    const said = await thread(id)
    const note = said.find((m) => m.kind === 'note')
    expect(note?.body).toBe('Léa attend un remboursement : Bonjour, où en est mon Remboursement ?')
    // Signed by the automation's own row — never an agent who signs in.
    const [actor] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, note?.agentId ?? ''))
    expect(actor?.name).toBe('Remboursements')
    expect(actor?.active).toBe(false)
    expect(actor?.login).toBe(`automation:${made.id}`)
    expect(
      said.some(
        (m) =>
          m.kind === 'event' &&
          (m.meta as { event?: { type?: string } }).event?.type === 'priority',
      ),
    ).toBe(true)
  })

  it('is never set off by what its own run did, and stops a chain at three', async () => {
    // Moving a conversation sets « transferred » off: the same automation must not answer it.
    const loop = await automation({
      name: 'Aller-retour',
      trigger: { kind: 'transferred' },
      steps: [{ id: 's1', kind: 'transfer', inboxId: 'sinistres' }],
    })
    const id = await conversation()
    await assign(db, marc, id, julie.id)
    await db.update(conversations).set({ inboxId: 'reclamations' }).where(eq(conversations.id, id))
    for (let i = 0; i < 4; i++) await automationPass(engine)
    expect(await runsOf(loop.id)).toHaveLength(1)
    const events = await db.select().from(changeEvents).where(eq(changeEvents.conversationId, id))
    const caused = events.filter((e) => e.causedBy !== null)
    expect(caused.length).toBeGreaterThan(0)
  })

  it('waits, then goes on — unless the visitor wrote meanwhile', async () => {
    const made = await automation({
      name: 'Relance',
      trigger: { kind: 'conversation_created' },
      steps: [
        { id: 's1', kind: 'wait', amount: 2, unit: 'hours', unlessReply: true },
        { id: 's2', kind: 'reply', body: 'Avez-vous trouvé votre réponse, {{contact.prenom}} ?' },
      ],
    })
    const quiet = await conversation()
    const talkative = await conversation()
    await automationPass(engine)
    let runs = await runsOf(made.id)
    expect(runs.map((r) => r.status)).toEqual(['waiting', 'waiting'])
    expect(runs[0]?.resumeAt).not.toBeNull()

    await visitorSays(talkative, 'Ah, et encore une chose')
    await db.execute(sql`update chat.automation_run set resume_at = now() - interval '1 second'`)
    await automationPass(engine)
    runs = await runsOf(made.id)
    const byConversation = new Map(runs.map((r) => [r.conversationId, r]))
    expect(byConversation.get(quiet)?.status).toBe('succeeded')
    expect(byConversation.get(talkative)?.status).toBe('stopped')
    expect(byConversation.get(talkative)?.error).toBe('VISITOR_REPLIED')
    const reply = (await thread(quiet)).find((m) => m.kind === 'text')
    expect(reply?.body).toBe('Avez-vous trouvé votre réponse, Léa ?')
  })

  it('takes a path of a branch, by what an earlier step gave', async () => {
    const made = await automation({
      trigger: { kind: 'conversation_created' },
      steps: [
        { id: 's1', kind: 'data', key: 'canal', value: 'téléphone' },
        {
          id: 's2',
          kind: 'branch',
          paths: [
            {
              id: 'p1',
              label: 'Téléphone',
              otherwise: false,
              condition: {
                match: 'all',
                rules: [{ field: 'step', key: 's1', op: 'equals', values: ['Telephone'] }],
              },
              steps: [{ id: 's3', kind: 'tag', add: ['À rappeler'], remove: [] }],
            },
            {
              id: 'p2',
              label: 'Sinon',
              otherwise: true,
              condition: { match: 'all', rules: [] },
              steps: [{ id: 's4', kind: 'tag', add: ['Contrat'], remove: [] }],
            },
          ],
        },
      ],
    })
    const id = await conversation()
    await automationPass(engine)
    const [run] = await runsOf(made.id)
    expect(run?.steps.find((s) => s.id === 's2')?.path).toBe('p1')
    const tags = await db
      .select()
      .from(conversationTags)
      .where(eq(conversationTags.conversationId, id))
    expect(tags.map((t) => t.label)).toEqual(['À rappeler'])
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(row?.data).toEqual({ canal: 'téléphone' })
  })

  it('finds the visitor left waiting, once per message', async () => {
    const made = await automation({
      name: 'Sans réponse',
      trigger: { kind: 'no_reply', minutes: 10 },
      steps: [
        {
          id: 's1',
          kind: 'notify',
          to: 'supervisors',
          text: '{{contact.nom}} attend depuis 10 minutes',
        },
        { id: 's2', kind: 'ask_email', text: '' },
      ],
    })
    const long = new Date(Date.now() - 15 * 60_000)
    // On since before the visitor wrote: since after, the message is not its business.
    await db
      .update(automations)
      .set({ activatedAt: new Date(Date.now() - 3600_000) })
      .where(eq(automations.id, made.id))
    const waiting = await conversation({ lastMessageAt: long })
    await visitorSays(waiting, 'Il y a quelqu’un ?', long)
    const answered = await conversation({ lastMessageAt: long })
    await visitorSays(answered, 'Bonjour', new Date(long.getTime() - 1000))
    await db.insert(messages).values({
      conversationId: answered,
      author: 'agent',
      agentId: julie.id,
      body: 'Je regarde',
      createdAt: long,
    })

    expect(await scanNoReply(engine)).toBe(1)
    expect(await scanNoReply(engine)).toBe(0)
    await automationPass(engine)
    const [run] = await runsOf(made.id)
    expect(run?.status).toBe('succeeded')
    const bell = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.agentId, marc.id), eq(notifications.conversationId, waiting)))
    expect(bell[0]?.kind).toBe('automation')
    expect(bell[0]?.text).toBe('Léa Martin attend depuis 10 minutes')
    const asked = (await thread(waiting)).filter(
      (m) => (m.meta as { event?: { type?: string } }).event?.type === 'email_requested',
    )
    expect(asked).toHaveLength(1)
  })

  it('asks the visitor how it went once resolved, and tells of a bad score', async () => {
    const asking = await automation({
      name: 'Enquête',
      trigger: { kind: 'resolved' },
      steps: [
        { id: 's1', kind: 'survey', scale: 'csat', text: 'Votre avis, {{contact.prenom}} ?' },
      ],
    })
    const alerting = await automation({
      name: 'Mauvaise note',
      trigger: { kind: 'survey_answered' },
      condition: { match: 'all', rules: [{ field: 'score', op: 'less_than', values: ['3'] }] },
      steps: [
        {
          id: 's1',
          kind: 'notify',
          to: 'supervisors',
          text: '{{contact.nom}} : {{enquete.note}}/{{enquete.sur}} — {{enquete.commentaire}}',
        },
      ],
    })
    const id = await conversation({ assigneeId: julie.id })
    await db.update(conversations).set({ status: 'resolved' }).where(eq(conversations.id, id))
    await automationPass(engine)
    expect((await runsOf(asking.id))[0]?.status).toBe('succeeded')
    const [survey] = await db.select().from(surveys).where(eq(surveys.conversationId, id))
    expect(survey).toMatchObject({
      scale: 'csat',
      question: 'Votre avis, Léa ?',
      askedBy: 'Enquête',
      agentId: julie.id,
      score: null,
    })

    // Reopened and resolved again: not asked twice.
    await db.update(conversations).set({ status: 'open' }).where(eq(conversations.id, id))
    await db.update(conversations).set({ status: 'resolved' }).where(eq(conversations.id, id))
    await automationPass(engine)
    const [second] = await runsOf(asking.id)
    expect(second?.steps[0]).toMatchObject({ status: 'skipped' })

    const [row] = await db.select().from(conversations).where(eq(conversations.id, id))
    await answerSurvey(db, row?.contactId ?? '', survey?.id ?? '', {
      score: 2,
      comment: 'Trop long',
    })
    await automationPass(engine)
    expect((await runsOf(alerting.id))[0]?.status).toBe('succeeded')
    const bell = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.agentId, marc.id), eq(notifications.conversationId, id)))
    expect(bell.map((b) => b.text)).toContain('Léa Martin : 2/5 — Trop long')

    // A good score is no alert.
    const happy = await conversation({ assigneeId: julie.id })
    await db.update(conversations).set({ status: 'resolved' }).where(eq(conversations.id, happy))
    await automationPass(engine)
    const [asked] = await db.select().from(surveys).where(eq(surveys.conversationId, happy))
    const [happyRow] = await db.select().from(conversations).where(eq(conversations.id, happy))
    await answerSurvey(db, happyRow?.contactId ?? '', asked?.id ?? '', { score: 5 })
    await automationPass(engine)
    expect(await runsOf(alerting.id)).toHaveLength(1)
  })

  it('goes off on its schedule, for each conversation its condition keeps', async () => {
    const made = await automation({
      name: 'Clôture',
      trigger: {
        kind: 'schedule',
        forEach: true,
        schedule: { every: 'day', at: '08:00', weekday: 1, timezone: 'Europe/Paris' },
      },
      condition: {
        match: 'all',
        rules: [
          { field: 'status', op: 'is', values: ['pending'] },
          { field: 'idle', op: 'more_than', values: ['10080'] },
        ],
      },
      steps: [{ id: 's1', kind: 'status', status: 'resolved' }],
    })
    const [row] = await db.select().from(automations).where(eq(automations.id, made.id))
    expect(row?.nextRunAt?.getTime()).toBeGreaterThan(Date.now())
    const old = new Date(Date.now() - 8 * 86_400_000)
    const stale = await conversation({ status: 'pending', lastMessageAt: old })
    const fresh = await conversation({ status: 'pending' })
    await db
      .update(automations)
      .set({ nextRunAt: new Date(Date.now() - 1000) })
      .where(eq(automations.id, made.id))
    expect(await fireSchedules(engine)).toBe(1)
    expect(await fireSchedules(engine)).toBe(0)
    await automationPass(engine)
    const statuses = await db
      .select({ id: conversations.id, status: conversations.status })
      .from(conversations)
      .where(sql`${conversations.id} in (${stale}, ${fresh})`)
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({
      [stale]: 'resolved',
      [fresh]: 'pending',
    })
  })

  it('is started by an agent, from a conversation it fits', async () => {
    const made = await automation({
      name: 'Escalader au responsable',
      trigger: { kind: 'button' },
      condition: {
        match: 'all',
        rules: [{ field: 'inbox', op: 'is', values: ['service-client'] }],
      },
      steps: [{ id: 's1', kind: 'assign', to: 'least_busy', teamId: 'support' }],
    })
    const id = await conversation()
    const elsewhere = await conversation({ inboxId: 'sinistres' })
    expect((await buttonsFor(manage, id)).map((b) => b.name)).toEqual(['Escalader au responsable'])
    expect(await buttonsFor(manage, elsewhere)).toEqual([])
    await expect(pressButton(manage, julie, elsewhere, made.id)).rejects.toThrow(Refusal)
    await pressButton(manage, julie, id, made.id)
    await automationPass(engine)
    const [run] = await runsOf(made.id)
    expect(run?.cause).toBe('button:Julie')
    expect(run?.steps[0]?.detail).toBe('Marc')
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(row?.assigneeId).toBe(marc.id)
  })

  it('is called by another system at its address, with its key, and calls one back', async () => {
    const made = await automation({
      name: 'Depuis le CRM',
      trigger: { kind: 'webhook' },
      steps: [
        {
          id: 's1',
          kind: 'webhook',
          url: target,
          headers: [{ name: 'x-source', value: 'messagerie' }],
          body: '{"dossier": "{{webhook.dossier}}", "contact": "{{contact.nom}}"}',
        },
        { id: 's2', kind: 'note', body: 'Ticket {{etape.s1}}' },
      ],
    })
    expect(made.webhookUrl).toMatch(
      /^http:\/\/chat\.test\/api\/automations\/[0-9a-f-]+\/hook\?key=ahk_/,
    )
    const key = new URL(made.webhookUrl ?? '').searchParams.get('key') ?? ''
    await expect(hookCalled(manage, made.id, 'ahk_wrong', {})).rejects.toThrow(Refusal)
    const id = await conversation()
    await hookCalled(manage, made.id, key, { conversationId: id, dossier: 'Sinistre "auto" 12' })
    await automationPass(engine)
    expect(received).toHaveLength(1)
    expect(JSON.parse(received[0]?.body ?? '')).toEqual({
      dossier: 'Sinistre "auto" 12',
      contact: 'Léa Martin',
    })
    expect(received[0]?.headers['x-source']).toBe('messagerie')
    const note = (await thread(id)).find((m) => m.kind === 'note')
    expect(note?.body).toBe('Ticket {"ticket":"T-42"}')
  })

  it('is switched on only when nothing keeps it from running', async () => {
    const made = await createAutomation(
      manage,
      marc,
      definition({ steps: [{ id: 's1', kind: 'assign', to: 'agent' }] }),
    )
    await expect(setAutomationActive(manage, marc, made.id, true)).rejects.toMatchObject({
      code: 'AUTOMATION_INVALID',
      details: { problem: 'agent_missing', step: 's1' },
    })
    await expect(createAutomation(manage, julie, definition({}))).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    })
    const fixed = await updateAutomation(
      manage,
      marc,
      made.id,
      definition({
        name: 'Pour Julie',
        steps: [{ id: 's1', kind: 'assign', to: 'agent', agentId: julie.id }],
      }),
    )
    expect((await setAutomationActive(manage, marc, fixed.id, true)).active).toBe(true)
    const [actor] = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.login, `automation:${made.id}`))
    expect(actor?.name).toBe('Pour Julie')
    // On, it cannot be saved broken.
    await expect(
      updateAutomation(manage, marc, made.id, definition({ steps: [] })),
    ).rejects.toMatchObject({ code: 'AUTOMATION_INVALID', details: { problem: 'no_steps' } })
  })

  it('hears the mood the AI reads after the message', async () => {
    const made = await automation({
      name: 'Mécontents',
      trigger: { kind: 'sentiment_changed' },
      condition: { match: 'all', rules: [{ field: 'sentiment', op: 'is', values: ['negative'] }] },
      steps: [{ id: 's1', kind: 'priority', priority: 'urgent' }],
    })
    const calm = await conversation()
    const upset = await conversation()
    await db.update(conversations).set({ sentiment: 'neutral' }).where(eq(conversations.id, calm))
    await db.update(conversations).set({ sentiment: 'negative' }).where(eq(conversations.id, upset))
    await automationPass(engine)
    const runs = await runsOf(made.id)
    expect(runs.map((r) => r.conversationId)).toEqual([upset])
    const [row] = await db.select().from(conversations).where(eq(conversations.id, upset))
    expect(row?.priority).toBe('urgent')
  })

  it('fails a run on a step that fails, and says why', async () => {
    const made = await automation({
      trigger: { kind: 'conversation_created' },
      steps: [
        { id: 's1', kind: 'status', status: 'snoozed', hours: 2 },
        { id: 's2', kind: 'note', body: 'jamais écrite' },
      ],
    })
    const id = await conversation({ status: 'ai' })
    await automationPass(engine)
    const [run] = await runsOf(made.id)
    expect(run?.status).toBe('failed')
    expect(run?.error).toBe('NOT_SNOOZABLE')
    expect(run?.steps).toHaveLength(1)
    expect((await thread(id)).some((m) => m.kind === 'note')).toBe(false)
    const [stored] = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.id, run?.id ?? ''))
    expect(stored?.finishedAt).not.toBeNull()
  })
})
