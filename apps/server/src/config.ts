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
   * Development only: the login (e-mail) every request of the inbox is made as when it
   * carries no session — no sign-in on a developer's machine. Ignored in production.
   */
  readonly devAgent: string | null
  /** Where the server is reached from outside — the address an identity provider calls back. */
  readonly publicUrl: string
  /** Signing in with an identity provider (D19), besides the password. */
  readonly oidc: OidcConfig | null
  /** Signs the visitors' tokens. Required in production; a fixed one in development. */
  readonly secret: string
  /**
   * Behind a proxy that sets `X-Forwarded-For`: the visitor's address is read there.
   * Without one, that header is anyone's to write, and only the socket's address counts.
   */
  readonly trustProxy: boolean
  /** GIPHY's key, for the agents' GIFs — none, no GIF. Never in the settings (D5). */
  readonly giphyKey: string | null
  /** The SMTP server the chat writes through (D23) — none, no e-mail. */
  readonly mail: MailConfig | null
  /**
   * Who sends the agents' phone alerts, as the push services want it (VAPID's `sub`): a
   * `mailto:` or an https address they may write to.
   */
  readonly pushSubject: string
}

export interface MailConfig {
  /** `smtp://user:password@host:587`, or `smtps://…:465` — nodemailer's. */
  readonly url: string
  /** `Messagerie <support@exemple.fr>`. */
  readonly from: string
}

/** The configuration cannot run: said once, at start, rather than at the first request. */
export class ConfigError extends Error {}

/**
 * An OpenID Connect provider — Microsoft Entra, Google, Keycloak… : its issuer, and the
 * client the chat is registered as. The agent it signs in is the one of the same e-mail.
 */
export interface OidcConfig {
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret: string
  /** What the sign-in button says: « Se connecter avec {name} ». */
  readonly name: string
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production'
  // `||`, not `??`: an empty variable in a `.env` file means unset.
  const issuer = env.CHAT_OIDC_ISSUER || ''
  const clientId = env.CHAT_OIDC_CLIENT_ID || ''
  const oidc =
    issuer && clientId
      ? {
          issuer,
          clientId,
          clientSecret: env.CHAT_OIDC_CLIENT_SECRET || '',
          name: env.CHAT_OIDC_NAME || 'SSO',
        }
      : null
  const port = Number(env.CHAT_PORT || 8810)
  const secret = env.CHAT_SECRET || (production ? '' : 'development-only-secret-of-the-chat')
  if (secret.length < 32) {
    throw new ConfigError(
      'CHAT_SECRET est requis en production, 32 caractères au moins (openssl rand -base64 32).',
    )
  }
  const smtp = env.CHAT_SMTP_URL || ''
  if (smtp && !/^smtps?:\/\//.test(smtp)) {
    throw new ConfigError('CHAT_SMTP_URL commence par smtp:// ou smtps://.')
  }
  const from = env.CHAT_MAIL_FROM || ''
  if (smtp && production && !from) {
    throw new ConfigError(
      'CHAT_MAIL_FROM est requis avec CHAT_SMTP_URL : « Support <support@exemple.fr> ».',
    )
  }
  const mail = smtp ? { url: smtp, from: from || 'Messagerie <messagerie@localhost>' } : null
  const webOrigin = env.CHAT_WEB_ORIGIN || 'http://localhost:3210'
  const sender = /<([^>]+)>/.exec(mail?.from ?? '')?.[1] ?? mail?.from
  return {
    secret,
    mail,
    pushSubject:
      env.CHAT_PUSH_SUBJECT ||
      (webOrigin.startsWith('https://')
        ? webOrigin
        : `mailto:${sender?.includes('@') ? sender : 'messagerie@localhost'}`),
    trustProxy: env.CHAT_TRUST_PROXY === '1',
    giphyKey: env.GIPHY_API_KEY || null,
    port,
    databaseUrl: env.DATABASE_URL || 'postgres://chat:chat@127.0.0.1:55440/chat',
    webOrigin,
    filesDir: resolve(env.CHAT_FILES_DIR || '.files'),
    production,
    devAgent: production ? null : env.CHAT_DEV_AGENT?.toLowerCase() || null,
    publicUrl: (env.CHAT_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    oidc,
  }
}
