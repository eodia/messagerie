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
   * Development only: the basedb user every request is made as, until basedb can vouch
   * for an identity (dependency B2). Ignored in production.
   */
  readonly devAgent: string | null
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production'
  // `||`, not `??`: an empty variable in a `.env` file means unset.
  return {
    port: Number(env.CHAT_PORT || 8810),
    databaseUrl: env.DATABASE_URL || 'postgres://chat:chat@127.0.0.1:55440/chat',
    webOrigin: env.CHAT_WEB_ORIGIN || 'http://localhost:3210',
    production,
    devAgent: production ? null : env.CHAT_DEV_AGENT || null,
  }
}
