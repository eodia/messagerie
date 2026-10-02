import { randomUUID } from 'node:crypto'
import { type Llm, readJson } from '@chat/ai'
import type {
  BuilderQuery,
  Dashboard,
  DashboardCard,
  QueryResult,
  Question,
  QuestionDraft,
  Visualization,
} from '@chat/contracts'
import { asc, desc, eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import type { Db } from '../db/client.js'
import { agents, dashboards } from '../db/schema.js'
import type { AgentRow } from '../inbox/read.js'
import { Refusal } from '../refusal.js'
import { SOURCES } from './catalog.js'
import { compile, inlined, readQuestion } from './query.js'
import { runRead } from './run.js'

/**
 * The dashboards (D22): supervisors make them, agents see the shared ones. A card's
 * question runs as it was saved — an agent never sends SQL, only the card to run.
 */

export interface AnalyticsDeps {
  readonly db: Db
  /** None in some tests: questions are then refused. */
  readonly pool: pg.Pool | null
  readonly llm: Llm | null
}

function poolOf(deps: AnalyticsDeps): pg.Pool {
  if (deps.pool === null) throw new Refusal('SQL_UNAVAILABLE', 503)
  return deps.pool
}

type Row = typeof dashboards.$inferSelect

const MAX_CARDS = 40
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function supervisor(agent: AgentRow): void {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const within = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

function readCard(raw: unknown): DashboardCard {
  const value = record(raw)
  const kind = value.kind === 'text' ? 'text' : 'question'
  const id = typeof value.id === 'string' && value.id.length <= 40 ? value.id : randomUUID()
  const card = {
    id,
    x: within(value.x, 0, 11, 0),
    y: within(value.y, 0, 500, 0),
    w: within(value.w, 1, 12, 4),
    h: within(value.h, 2, 30, 6),
    title: typeof value.title === 'string' ? value.title.trim().slice(0, 120) : '',
    kind,
  } as const
  if (kind === 'text') {
    return { ...card, text: typeof value.text === 'string' ? value.text.slice(0, 4000) : '' }
  }
  return { ...card, question: readQuestion(value.question) }
}

function readBody(raw: unknown) {
  const value = record(raw)
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 120) : ''
  if (name === '') throw new Refusal('INVALID_REQUEST', 400, { field: 'name' })
  const cards = Array.isArray(value.cards) ? value.cards : []
  if (cards.length > MAX_CARDS) throw new Refusal('INVALID_REQUEST', 400, { field: 'cards' })
  return {
    name,
    description: typeof value.description === 'string' ? value.description.slice(0, 500) : '',
    cards: cards.map(readCard),
    shared: value.shared !== false,
  }
}

async function present(db: Db, row: Row): Promise<Dashboard> {
  const [creator] = row.createdBy
    ? await db.select({ name: agents.name }).from(agents).where(eq(agents.id, row.createdBy))
    : []
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    cards: row.cards,
    shared: row.shared,
    createdBy: creator?.name ?? '—',
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function rowOf(db: Db, agent: AgentRow, id: string): Promise<Row> {
  if (!UUID.test(id)) throw new Refusal('DASHBOARD_NOT_FOUND', 404)
  const [row] = await db.select().from(dashboards).where(eq(dashboards.id, id))
  // Not shared: for an agent, it does not exist.
  if (!row || (!row.shared && agent.role !== 'supervisor')) {
    throw new Refusal('DASHBOARD_NOT_FOUND', 404)
  }
  return row
}

export async function listDashboards(db: Db, agent: AgentRow): Promise<Dashboard[]> {
  let rows = await db
    .select()
    .from(dashboards)
    .orderBy(desc(dashboards.isDefault), asc(dashboards.name))
  if (rows.length === 0) {
    await installDefaultDashboard(db, agent.role === 'supervisor' ? agent.id : null)
    rows = await db.select().from(dashboards)
  }
  const shown = agent.role === 'supervisor' ? rows : rows.filter((r) => r.shared)
  return Promise.all(shown.map((row) => present(db, row)))
}

export async function getDashboard(db: Db, agent: AgentRow, id: string): Promise<Dashboard> {
  return present(db, await rowOf(db, agent, id))
}

export async function createDashboard(db: Db, agent: AgentRow, raw: unknown): Promise<Dashboard> {
  supervisor(agent)
  const [row] = await db
    .insert(dashboards)
    .values({ ...readBody(raw), createdBy: agent.id })
    .returning()
  return present(db, row as Row)
}

export async function saveDashboard(
  db: Db,
  agent: AgentRow,
  id: string,
  raw: unknown,
): Promise<Dashboard> {
  supervisor(agent)
  await rowOf(db, agent, id)
  const [row] = await db
    .update(dashboards)
    .set({ ...readBody(raw), updatedAt: new Date() })
    .where(eq(dashboards.id, id))
    .returning()
  return present(db, row as Row)
}

export async function deleteDashboard(db: Db, agent: AgentRow, id: string): Promise<void> {
  supervisor(agent)
  await rowOf(db, agent, id)
  await db.delete(dashboards).where(eq(dashboards.id, id))
}

const zoneOf = (raw: unknown): string => {
  const zone = typeof raw === 'string' ? raw : 'Europe/Paris'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return 'Europe/Paris'
  }
}

/** Runs a question: its SQL — the reading role required — or the builder's. */
export async function runQuestion(
  deps: AnalyticsDeps,
  question: Question,
  timeZone: unknown,
): Promise<QueryResult> {
  if (question.mode === 'sql') {
    return runRead(poolOf(deps), { text: question.sql, values: [] }, { authored: true })
  }
  const compiled = compile(question.query, zoneOf(timeZone))
  const result = await runRead(poolOf(deps), compiled, { authored: false })
  return { ...result, sql: inlined(compiled) }
}

/** A supervisor's question, being written. */
export async function runDraft(
  deps: AnalyticsDeps,
  agent: AgentRow,
  raw: unknown,
): Promise<QueryResult> {
  supervisor(agent)
  const body = record(raw)
  return runQuestion(deps, readQuestion(body.question), body.timeZone)
}

/** A card of a dashboard the agent sees, run as it was saved. */
export async function runCard(
  deps: AnalyticsDeps,
  agent: AgentRow,
  id: string,
  cardId: string,
  timeZone: unknown,
): Promise<QueryResult> {
  const row = await rowOf(deps.db, agent, id)
  const card = row.cards.find((c) => c.id === cardId)
  if (!card?.question) throw new Refusal('DASHBOARD_NOT_FOUND', 404)
  return runQuestion(deps, card.question, timeZone)
}

// ── Asked in words ──────────────────────────────────────────────────────────

/** The views, as the model reads them. */
function schemaText(): string {
  return SOURCES.map(
    (s) =>
      `analytics.${s.key} — ${s.description}\n${s.columns
        .map(
          (c) =>
            `  ${c.name} (${c.type}) : ${c.label}${c.values ? ` — valeurs : ${c.values.map((v) => `'${v.value}' (${v.label})`).join(', ')}` : ''}`,
        )
        .join('\n')}`,
  ).join('\n\n')
}

const VIZ = ['number', 'table', 'bar', 'row', 'line', 'area', 'pie']

/** A question said in words, made SQL by the AI — tried once before it is proposed. */
export async function assistQuestion(
  deps: AnalyticsDeps,
  agent: AgentRow,
  raw: unknown,
): Promise<QuestionDraft> {
  supervisor(agent)
  if (deps.llm === null) throw new Refusal('AI_UNAVAILABLE', 503)
  const body = record(raw)
  const asked = typeof body.request === 'string' ? body.request.trim().slice(0, 1000) : ''
  if (asked === '') throw new Refusal('INVALID_REQUEST', 400, { field: 'request' })
  const timeZone = zoneOf(body.timeZone)
  const system = [
    'Tu écris des requêtes SQL PostgreSQL pour les tableaux de bord d’une messagerie client.',
    `Tu ne lis QUE ces vues (schéma analytics), avec ces colonnes :\n\n${schemaText()}`,
    `Les dates sont des timestamptz ; le lecteur est dans le fuseau ${timeZone} : pour grouper par jour, date_trunc('day', created_at AT TIME ZONE '${timeZone}').`,
    'Une seule requête SELECT, sans point-virgule, sans commentaire. Nomme les colonnes en snake_case lisible (jour, conversations, taux_ia…).',
    `Choisis un graphique parmi ${VIZ.join(', ')} : number pour une seule valeur, line ou bar pour une évolution, row pour un classement, pie pour une répartition de moins de 7 parts, table sinon.`,
    'Réponds UNIQUEMENT en JSON : {"sql": "…", "viz": "…", "unit": "" | "%" | "s" | "€", "title": "titre court en français"}',
  ].join('\n\n')
  let feedback = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await deps.llm.complete({
      json: true,
      temperature: 0,
      maxTokens: 900,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: asked + feedback },
      ],
    })
    const json = readJson(completion.text)
    const sql = typeof json?.sql === 'string' ? json.sql.trim().replace(/;+\s*$/, '') : ''
    const type = VIZ.includes(String(json?.viz)) ? (json?.viz as Visualization['type']) : 'table'
    const unit = ['%', 's', '€'].includes(String(json?.unit))
      ? (json?.unit as Visualization['unit'])
      : ''
    const draft: QuestionDraft = {
      sql,
      viz: { type, ...(unit ? { unit } : {}) },
      title: typeof json?.title === 'string' ? json.title.slice(0, 120) : asked.slice(0, 120),
    }
    if (sql === '') continue
    try {
      await runRead(poolOf(deps), { text: sql, values: [] }, { authored: true })
      return draft
    } catch (error) {
      if (error instanceof Refusal && error.code === 'SQL_UNAVAILABLE') throw error
      const reason = error instanceof Refusal ? String(error.details?.reason ?? error.code) : ''
      feedback = `\n\n(Ta requête précédente a échoué : ${reason}. Corrige-la.)\n${sql}`
      if (attempt === 1) return draft
    }
  }
  throw new Refusal('QUERY_INVALID', 400, { reason: 'ai' })
}

// ── The one every messaging starts with ─────────────────────────────────────

const LAST_7: BuilderQuery['filters'][number] = {
  column: 'created_at',
  op: 'last',
  values: ['7', 'days'],
}
const LAST_30: BuilderQuery['filters'][number] = {
  column: 'created_at',
  op: 'last',
  values: ['30', 'days'],
}

const builder = (
  query: Partial<BuilderQuery> & { source: string },
  viz: Visualization,
): Question => ({
  mode: 'builder',
  query: { filters: [], aggregations: [], breakouts: [], ...query },
  viz,
})

const card = (
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  question: Question,
): DashboardCard => ({ id: randomUUID(), x, y, w, h, title, kind: 'question', question })

/** « Vue d'ensemble »: what the statistics screen said, and more — on the default grid. */
export function defaultCards(): DashboardCard[] {
  return [
    card(
      0,
      0,
      3,
      3,
      'Conversations, 7 derniers jours',
      builder(
        { source: 'conversations', filters: [LAST_7], aggregations: [{ fn: 'count' }] },
        { type: 'number' },
      ),
    ),
    card(
      3,
      0,
      3,
      3,
      'Résolues par l’IA',
      builder(
        {
          source: 'conversations',
          filters: [LAST_7, { column: 'ai_answered', op: 'true', values: [] }],
          aggregations: [{ fn: 'share', column: 'resolved_by_ai' }],
        },
        { type: 'number', unit: '%' },
      ),
    ),
    card(
      6,
      0,
      3,
      3,
      'Première réponse (médiane)',
      builder(
        {
          source: 'conversations',
          filters: [LAST_7],
          aggregations: [{ fn: 'median', column: 'first_response_seconds' }],
        },
        { type: 'number', unit: 's' },
      ),
    ),
    card(
      9,
      0,
      3,
      3,
      'Transférées par l’IA',
      builder(
        {
          source: 'conversations',
          filters: [LAST_7, { column: 'handed_off', op: 'true', values: [] }],
          aggregations: [{ fn: 'count' }],
        },
        { type: 'number' },
      ),
    ),
    card(
      0,
      3,
      8,
      7,
      'Conversations par jour',
      builder(
        {
          source: 'conversations',
          filters: [LAST_30],
          breakouts: [{ column: 'created_at', unit: 'day' }, { column: 'status' }],
        },
        { type: 'bar', stacked: true },
      ),
    ),
    card(
      8,
      3,
      4,
      7,
      'Par boîte de réception',
      builder(
        { source: 'conversations', filters: [LAST_30], breakouts: [{ column: 'inbox' }] },
        { type: 'pie' },
      ),
    ),
    card(
      0,
      10,
      4,
      7,
      'Humeur des visiteurs',
      builder(
        {
          source: 'conversations',
          filters: [LAST_30, { column: 'sentiment', op: 'not_empty', values: [] }],
          breakouts: [{ column: 'sentiment' }],
        },
        { type: 'pie' },
      ),
    ),
    card(
      4,
      10,
      4,
      7,
      'Étiquettes les plus posées',
      builder(
        { source: 'tags', filters: [LAST_30], breakouts: [{ column: 'label' }], limit: 10 },
        { type: 'row' },
      ),
    ),
    card(
      8,
      10,
      4,
      7,
      'Avis des conseillers sur l’IA',
      builder(
        { source: 'ai_feedback', filters: [LAST_30], breakouts: [{ column: 'verdict' }] },
        { type: 'bar' },
      ),
    ),
    card(
      0,
      17,
      6,
      7,
      'Conversations par conseiller',
      builder(
        {
          source: 'conversations',
          filters: [LAST_30, { column: 'assignee', op: 'not_empty', values: [] }],
          breakouts: [{ column: 'assignee' }],
          limit: 15,
        },
        { type: 'row' },
      ),
    ),
    card(
      6,
      17,
      6,
      7,
      'Heures où les visiteurs écrivent',
      builder(
        {
          source: 'messages',
          filters: [LAST_30, { column: 'author', op: 'is', values: ['contact'] }],
          breakouts: [{ column: 'created_at', unit: 'hour_of_day' }],
        },
        { type: 'bar' },
      ),
    ),
  ]
}

/** Written once, while there is no dashboard: two screens opened at once make one. */
export async function installDefaultDashboard(db: Db, createdBy: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('messagerie.dashboard.default'))`)
    const [any] = await tx.select({ id: dashboards.id }).from(dashboards).limit(1)
    if (any) return
    await tx.insert(dashboards).values({
      name: 'Vue d’ensemble',
      description: 'Ce qui se passe dans les conversations : volume, IA, délais, humeur, équipe.',
      cards: defaultCards(),
      shared: true,
      isDefault: true,
      createdBy,
    })
  })
}
