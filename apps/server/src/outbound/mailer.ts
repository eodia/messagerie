import nodemailer from 'nodemailer'
import type { MailConfig } from '../config.js'

/**
 * What the chat writes by e-mail (D23) — invitations, new passwords, a reply to a visitor
 * who left, an alert to an agent away — through one SMTP server (`CHAT_SMTP_URL`). Without
 * one, nothing is written by e-mail: the links are handed over by hand, as before.
 */

export interface Mail {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
  /** Where an answer goes, when not to the sender. */
  readonly replyTo?: string
  /** The thread it belongs to (D24): the message it answers, and those before. */
  readonly inReplyTo?: string
  readonly references?: readonly string[]
  readonly attachments?: readonly {
    readonly filename: string
    readonly content: Uint8Array
    readonly contentType: string
  }[]
}

export interface Mailer {
  /** Sends; the server's id of the message. Throws `MailFailure` when it cannot. */
  send(mail: Mail): Promise<string>
}

/** Why a mail did not go: `retry` — the server may take it later —, or not. */
export class MailFailure extends Error {
  constructor(
    readonly code: string,
    readonly retry: boolean,
  ) {
    super(code)
  }
}

/**
 * Short waits, unless the address says others (`?connectionTimeout=…`): an invitation waits
 * for its e-mail, and nodemailer would wait two minutes for a server that does not answer.
 */
const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 }

/** Checks the server answers and takes the account, sending nothing. */
export async function verifyMailer(config: MailConfig): Promise<true | string> {
  const url = new URL(config.url)
  for (const [name, ms] of Object.entries(TIMEOUTS)) {
    if (!url.searchParams.has(name)) url.searchParams.set(name, String(ms))
  }
  try {
    await nodemailer.createTransport(url.toString()).verify()
    return true
  } catch (error) {
    const code = (error as { responseCode?: number; code?: string }).responseCode
    return code ? `SMTP_${code}` : `SMTP_${(error as { code?: string }).code ?? 'UNAVAILABLE'}`
  }
}

export function smtpMailer(config: MailConfig): Mailer {
  const url = new URL(config.url)
  for (const [name, ms] of Object.entries(TIMEOUTS)) {
    if (!url.searchParams.has(name)) url.searchParams.set(name, String(ms))
  }
  const transport = nodemailer.createTransport(url.toString())
  return {
    async send(mail) {
      try {
        const sent = await transport.sendMail({
          from: config.from,
          ...mail,
          references: mail.references ? [...mail.references] : undefined,
          attachments: mail.attachments?.map((a) => ({ ...a, content: Buffer.from(a.content) })),
        })
        return sent.messageId
      } catch (error) {
        // 5xx: the server refused this mail for good — an address, a size. The rest: later.
        const code = (error as { responseCode?: number }).responseCode
        throw new MailFailure(
          code ? `SMTP_${code}` : 'SMTP_UNAVAILABLE',
          code === undefined || code < 500,
        )
      }
    },
  }
}
