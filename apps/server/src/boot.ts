import type { Llm } from '@chat/ai'
import { readAi } from './ai/config.js'
import { type AiJobs, startJobs } from './ai/jobs.js'
import { Knowledge } from './ai/knowledge.js'
import { McpConnections } from './ai/mcp.js'
import { BasedbClient } from './basedb/client.js'
import { type Config, ConfigError, readConfig } from './config.js'
import { type Db, connect, migrateDatabase } from './db/client.js'
import { DiskStore } from './files/store.js'
import { Settings, TABLES } from './settings/settings.js'
import { sourceFor } from './settings/source.js'

/**
 * What the server and the worker both start with: the configuration, the schema up to
 * date, the settings (basedb, or the demonstration in development), and the AI with its
 * queues. The server works the queues itself unless `CHAT_WORKER=separate` gives them to
 * `worker.ts` (D7: the model's calls away from the WebSocket's process).
 */

export interface Booted {
  readonly config: Config
  readonly db: Db
  readonly basedb: BasedbClient | null
  readonly settings: Settings | null
  readonly settingsKind: 'basedb' | 'template' | null
  readonly ai: { readonly llm: Llm; readonly redact: boolean; readonly jobs: AiJobs } | null
  /** The MCP servers' connections — shared by the AI and the tools screen. */
  readonly mcp: McpConnections
  stop(): Promise<void>
}

export async function boot(role: 'server' | 'worker'): Promise<Booted> {
  let config: Config
  try {
    config = readConfig()
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(`chat : ${error.message}`)
    process.exit(1)
  }
  const { pool, db } = connect(config.databaseUrl)
  await migrateDatabase(db)

  const basedb = config.basedb ? new BasedbClient(config.basedb) : null
  const source = sourceFor(basedb, config.production, config.devAgent)
  const settings = source ? new Settings(source) : null
  const stopFollowing =
    settings?.follow((error) => console.error('chat : flux basedb', error)) ?? (() => {})

  const setup = readAi()
  let ai: Booted['ai'] = null
  let stopJobs = async () => {}
  const mcp = new McpConnections()
  if (setup && settings) {
    const knowledge = new Knowledge(db, settings, setup.llm)
    const work = role === 'worker' || process.env.CHAT_WORKER !== 'separate'
    const started = await startJobs(
      config.databaseUrl,
      {
        db,
        settings,
        knowledge,
        llm: setup.llm,
        redact: setup.redact,
        basedb,
        mcp,
        files: new DiskStore(config.filesDir),
      },
      { work },
    )
    stopJobs = started.stop
    ai = { ...setup, jobs: started.jobs }
    settings.onChange((table) => {
      if (table === TABLES.articles || table === TABLES.promoted || table === '*') {
        started.jobs.knowledgeChanged()
      }
    })
    console.log(
      `chat : IA ${setup.llm.model}${setup.redact ? ', données personnelles masquées' : ''}${work ? '' : ' (tâches confiées au worker)'}`,
    )
  } else {
    console.log(
      'chat : IA désactivée — CHAT_AI_API_KEY absent ; les conversations vont aux conseillers',
    )
  }

  return {
    config,
    db,
    basedb,
    settings,
    settingsKind: source?.kind ?? null,
    ai,
    mcp,
    stop: async () => {
      stopFollowing()
      await stopJobs()
      await mcp.close()
      await pool.end()
    },
  }
}
