/**
 * The server's configuration, read once from the environment. Every value has a default
 * that works on a developer's machine with `docker compose up -d`.
 */
export interface Config {
  readonly port: number
  readonly databaseUrl: string
  /** The inbox's origin, allowed by CORS. */
  readonly webOrigin: string
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
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production'
  // `||`, not `??`: an empty variable in a `.env` file means unset.
  const url = env.BASEDB_API_URL || ''
  const tenant = env.BASEDB_TENANT || ''
  const base = env.BASEDB_BASE || ''
  const token = env.BASEDB_TOKEN || ''
  const basedb =
    url && tenant && base && token ? { url: url.replace(/\/+$/, ''), tenant, base, token } : null
  const secret = env.CHAT_SECRET || (production ? '' : 'development-only-secret-of-the-chat')
  if (secret.length < 32) {
    throw new ConfigError(
      'CHAT_SECRET est requis en production, 32 caractères au moins (openssl rand -base64 32).',
    )
  }
  return {
    secret,
    trustProxy: env.CHAT_TRUST_PROXY === '1',
    port: Number(env.CHAT_PORT || 8810),
    databaseUrl: env.DATABASE_URL || 'postgres://chat:chat@127.0.0.1:55440/chat',
    webOrigin: env.CHAT_WEB_ORIGIN || 'http://localhost:3210',
    production,
    devAgent: production ? null : env.CHAT_DEV_AGENT || null,
    basedb,
  }
}
