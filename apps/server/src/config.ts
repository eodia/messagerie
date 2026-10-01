import { resolve } from 'node:path'
/**
 * The server's configuration, read once from the environment. Every value has a default
 * that works on a developer's machine with `docker compose up -d`.
 */
export interface Config {
  readonly port: number
  readonly databaseUrl: string
  /** The inbox's origin, allowed by CORS. */
  readonly webOrigin: string
  /** Where the files sent in conversations are kept, outside the database. */
  readonly filesDir: string
  readonly production: boolean
  /**
   * Development only: the basedb user every request is made as when it carries no token
   * — the inbox without basedb. Ignored in production.
   */
  readonly devAgent: string | null
  /** basedb, once the « Messagerie » base exists and the chat has its token (D2, D4). */
  readonly basedb: BasedbConfig | null
  /** Signs the visitors' tokens. Required in production; a fixed one in development. */
  readonly secret: string
  /**
   * Behind a proxy that sets `X-Forwarded-For`: the visitor's address is read there.
   * Without one, that header is anyone's to write, and only the socket's address counts.
   */
  readonly trustProxy: boolean
  /** GIPHY's key, for the agents' GIFs — none, no GIF. Never in basedb (D5). */
  readonly giphyKey: string | null
}

/** The configuration cannot run: said once, at start, rather than at the first request. */
export class ConfigError extends Error {}

export interface BasedbConfig {
  /** Where basedb's API answers: `/auth/…` and `/api/v1/…` are under it. */
  readonly url: string
  readonly tenant: string
  /** The « Messagerie » base, by the name its creation returned (`b_…_messagerie`). */
  readonly base: string
  /** An integration token of that base, issued for `rest`: reads, introspects, follows. */
  readonly token: string
  /**
   * The basedb group that may edit the base: an agent made a supervisor in the inbox joins
   * it, and may then change the settings. Null: rights are given in basedb.
   */
  readonly supervisorsGroup: string | null
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production'
  // `||`, not `??`: an empty variable in a `.env` file means unset.
  const url = env.BASEDB_API_URL || ''
  const tenant = env.BASEDB_TENANT || ''
  const base = env.BASEDB_BASE || ''
  const token = env.BASEDB_TOKEN || ''
  const basedb =
    url && tenant && base && token
      ? {
          url: url.replace(/\/+$/, ''),
          tenant,
          base,
          token,
          supervisorsGroup: env.BASEDB_SUPERVISORS_GROUP || null,
        }
      : null
  const secret = env.CHAT_SECRET || (production ? '' : 'development-only-secret-of-the-chat')
  if (secret.length < 32) {
    throw new ConfigError(
      'CHAT_SECRET est requis en production, 32 caractères au moins (openssl rand -base64 32).',
    )
  }
  return {
    secret,
    trustProxy: env.CHAT_TRUST_PROXY === '1',
    giphyKey: env.GIPHY_API_KEY || null,
    port: Number(env.CHAT_PORT || 8810),
    databaseUrl: env.DATABASE_URL || 'postgres://chat:chat@127.0.0.1:55440/chat',
    webOrigin: env.CHAT_WEB_ORIGIN || 'http://localhost:3210',
    filesDir: resolve(env.CHAT_FILES_DIR || '.files'),
    production,
    devAgent: production ? null : env.CHAT_DEV_AGENT || null,
    basedb,
  }
}
