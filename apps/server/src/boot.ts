import type { Llm } from '@chat/ai'
import { readAi } from './ai/config.js'
import { type AiJobs, startJobs } from './ai/jobs.js'
import { Knowledge } from './ai/knowledge.js'
import { McpConnections } from './ai/mcp.js'
import { sweepCredentials } from './auth/credentials.js'
import { type Config, ConfigError, readConfig } from './config.js'
import { type Db, connect, migrateDatabase } from './db/client.js'
import { DiskStore } from './files/store.js'
import { startWaking } from './inbox/snooze.js'
import { DatabaseSource, settingsEmpty } from './settings/database.js'
import { loadDemoSettings } from './settings/demo.js'
import { Settings, TABLES } from './settings/settings.js'
import { startWebhooks } from './webhooks/dispatch.js'

/**
 * What the server and the worker both start with: the configuration, the schema up to
 * date, the settings (the demonstration's at a first start in development), and the AI with its
 * queues. The server works the queues itself unless `CHAT_WORKER=separate` gives them to
 * `worker.ts` (D7: the model's calls away from the WebSocket's process) — and so do the
 * webhooks' calls (D17).
 */

export interface Booted {
  readonly config: Config
  readonly db: Db
  readonly settings: Settings
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

  // A first start in development: Acme Assurances, the demonstration, to work with.
  if (!config.production && (await settingsEmpty(db))) {
    await loadDemoSettings(db)
    console.log('chat : paramétrage de démonstration (Acme Assurances) écrit dans la base')
  }
  const source = new DatabaseSource(db, config.databaseUrl)
  const settings = new Settings(source)
  const stopFollowing = settings.follow((error) =>
    console.error('chat : écoute du paramétrage', error),
  )
  const sweep = setInterval(
    () => void sweepCredentials(db).catch((e) => console.error('chat : sessions', e)),
    3600_000,
  )

  const setup = readAi()
  let ai: Booted['ai'] = null
  let stopJobs = async () => {}
  const mcp = new McpConnections()
  if (setup) {
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

  // The webhooks' postman (D17) and the clock of conversations on hold, with the queues:
  // in the server, or in the worker alone.
  const clockwork = role === 'worker' || process.env.CHAT_WORKER !== 'separate'
  const postman = clockwork ? startWebhooks(db, config.secret) : null
  const waking = clockwork ? startWaking(db) : null

  return {
    config,
    db,
    settings,
    ai,
    mcp,
    stop: async () => {
      stopFollowing()
      clearInterval(sweep)
      await source.close()
      await postman?.stop()
      await waking?.stop()
      await stopJobs()
      await mcp.close()
      await pool.end()
    },
  }
}
