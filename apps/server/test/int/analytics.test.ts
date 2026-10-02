import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type AnalyticsDeps,
  createDashboard,
  defaultCards,
  filterValues,
  getDashboard,
  listDashboards,
  runCard,
  runDraft,
  runQuestion,
  saveDashboard,
} from '../../src/analytics/dashboards.js'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import { agents, contacts, conversations, messages } from '../../src/db/schema.js'
import type { AgentRow } from '../../src/inbox/read.js'

/**
 * The dashboards (D22), against a real PostgreSQL: the builder's questions, SQL ones read
 * as `chat_analytics` — the views and nothing else —, the default dashboard, who sees what.
 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let deps: AnalyticsDeps
let marc: AgentRow
let julie: AgentRow

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)
  deps = { db, pool, llm: null }
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
  const now = Date.now()
  for (const [index, status] of (['ai', 'open', 'resolved', 'resolved'] as const).entries()) {
    const [contact] = await db
      .insert(contacts)
      .values({ siteId: 'acme', name: `C${index}` })
      .returning()
    const [row] = await db
      .insert(conversations)
      .values({
        contactId: contact?.id ?? '',
        siteId: 'acme',
        siteName: 'Acme',
        status,
        sentiment: index === 1 ? 'negative' : 'neutral',
        createdAt: new Date(now - index * 3600_000),
      })
      .returning()
    const id = row?.id ?? ''
    await db.insert(messages).values([
      {
        conversationId: id,
        author: 'contact',
        body: 'Bonjour',
        createdAt: new Date(now - index * 3600_000),
      },
      {
        conversationId: id,
        author: index === 1 ? 'agent' : 'ai',
        agentId: index === 1 ? julie.id : null,
        body: 'Réponse',
        createdAt: new Date(now - index * 3600_000 + 30_000),
      },
    ])
  }
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe('a question', () => {
  it('built by choosing: counted, grouped, shared, its median', async () => {
    const byStatus = await runQuestion(
      deps,
      {
        mode: 'builder',
        query: {
          source: 'conversations',
          filters: [{ column: 'created_at', op: 'last', values: ['7', 'days'] }],
          aggregations: [],
          breakouts: [{ column: 'status' }],
        },
        viz: { type: 'bar' },
      },
      'Europe/Paris',
    )
    expect(byStatus.columns.map((c) => c.name)).toEqual(['status', 'count'])
    expect(Object.fromEntries(byStatus.rows.map((r) => [r[0], r[1]]))).toEqual({
      ai: 1,
      open: 1,
      resolved: 2,
    })
    const ai = await runQuestion(
      deps,
      {
        mode: 'builder',
        query: {
          source: 'conversations',
          filters: [{ column: 'ai_answered', op: 'true', values: [] }],
          aggregations: [
            { fn: 'share', column: 'resolved_by_ai' },
            { fn: 'median', column: 'first_response_seconds' },
          ],
          breakouts: [],
        },
        viz: { type: 'number' },
      },
      'Europe/Paris',
    )
    expect(ai.rows[0]).toEqual([100, 30])
  })

  it('written in SQL: the views, and nothing else', async () => {
    const counted = await runQuestion(
      deps,
      { mode: 'sql', sql: 'select count(*) as n from conversations;', viz: { type: 'number' } },
      null,
    )
    expect(counted.rows).toEqual([[4]])
    for (const forbidden of [
      'select * from chat.agent',
      'select password_hash from chat.agent',
      'select 1; reset role; select * from chat.agent',
      'select 1) q; select * from chat.session --',
      'delete from chat.message',
      'with gone as (delete from chat.message returning 1) select * from gone',
    ]) {
      await expect(
        runQuestion(deps, { mode: 'sql', sql: forbidden, viz: { type: 'table' } }, null),
      ).rejects.toMatchObject({ code: 'QUERY_INVALID' })
    }
    // Nothing was touched.
    const [left] = await db.select().from(messages).limit(1)
    expect(left).toBeDefined()
  })
})

describe('a dashboard', () => {
  it('starts as « Vue d’ensemble », every card of which runs', async () => {
    const [first] = await listDashboards(db, marc)
    expect(first?.name).toBe('Vue d’ensemble')
    expect(first?.cards.length).toBe(defaultCards().length)
    for (const card of first?.cards ?? []) {
      const result = await runCard(deps, julie, first?.id ?? '', card.id, 'Europe/Paris')
      expect(result.columns.length).toBeGreaterThan(0)
    }
    expect((await listDashboards(db, marc)).length).toBe(1)
  })

  it('is changed by supervisors; an agent sees the shared ones, and runs their cards only', async () => {
    const made = await createDashboard(db, marc, {
      name: 'Équipe',
      description: '',
      shared: false,
      cards: [
        {
          id: 'c1',
          x: 0,
          y: 0,
          w: 6,
          h: 4,
          title: 'Total',
          kind: 'question',
          question: { mode: 'sql', sql: 'select count(*) from messages', viz: { type: 'number' } },
        },
      ],
    })
    expect((await listDashboards(db, julie)).map((d) => d.name)).toEqual(['Vue d’ensemble'])
    await expect(getDashboard(db, julie, made.id)).rejects.toMatchObject({
      code: 'DASHBOARD_NOT_FOUND',
    })
    await expect(createDashboard(db, julie, { name: 'x', cards: [] })).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    })
    await expect(
      runDraft(deps, julie, { question: { mode: 'sql', sql: 'select 1', viz: { type: 'table' } } }),
    ).rejects.toMatchObject({ code: 'NOT_ALLOWED' })
    const shared = await saveDashboard(db, marc, made.id, { ...made, shared: true })
    expect(shared.shared).toBe(true)
    const result = await runCard(deps, julie, made.id, 'c1', 'Europe/Paris')
    expect(result.rows).toEqual([[8]])
  })

  it('follows its filters, on the cards tied to them only', async () => {
    const made = await createDashboard(db, marc, {
      name: 'Filtré',
      shared: true,
      filters: [
        {
          id: 'statut',
          label: 'Statut',
          kind: 'choice',
          source: 'conversations',
          column: 'status',
          default: [],
        },
        { id: 'periode', label: 'Période', kind: 'period', default: ['30', 'days'] },
        { id: 'faux', label: 'Mal fait', kind: 'nope', default: [] },
      ],
      cards: [
        {
          id: 'lie',
          x: 0,
          y: 0,
          w: 6,
          h: 4,
          title: 'Lié',
          kind: 'question',
          question: {
            mode: 'builder',
            query: {
              source: 'conversations',
              filters: [],
              aggregations: [{ fn: 'count' }],
              breakouts: [],
            },
            viz: { type: 'number' },
          },
          links: [
            { filter: 'statut', column: 'status' },
            { filter: 'periode', column: 'created_at' },
            // A text column for a period: refused.
            { filter: 'periode', column: 'inbox' },
          ],
        },
        {
          id: 'libre',
          x: 6,
          y: 0,
          w: 6,
          h: 4,
          title: 'Libre',
          kind: 'question',
          question: {
            mode: 'builder',
            query: {
              source: 'conversations',
              filters: [],
              aggregations: [{ fn: 'count' }],
              breakouts: [],
            },
            viz: { type: 'number' },
          },
        },
      ],
    })
    expect(made.filters.map((f) => f.id)).toEqual(['statut', 'periode'])
    expect(made.cards[0]?.links).toEqual([
      { filter: 'statut', column: 'status' },
      { filter: 'periode', column: 'created_at' },
    ])
    expect((await runCard(deps, julie, made.id, 'lie', 'Europe/Paris', {})).rows).toEqual([[4]])
    expect(
      (await runCard(deps, julie, made.id, 'lie', 'Europe/Paris', { statut: ['resolved'] })).rows,
    ).toEqual([[2]])
    expect(
      (await runCard(deps, julie, made.id, 'libre', 'Europe/Paris', { statut: ['resolved'] })).rows,
    ).toEqual([[4]])
    expect(await filterValues(deps, { source: 'conversations', column: 'status' })).toEqual([
      'ai',
      'open',
      'resolved',
    ])
  })
})
