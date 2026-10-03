import type { InviteBody, Invited, PasswordReset } from '@chat/contracts'
import { and, eq } from 'drizzle-orm'
import { issueLink } from '../auth/credentials.js'
import type { Db } from '../db/client.js'
import { agents } from '../db/schema.js'
import type { Mailer } from '../outbound/mailer.js'
import { linkMail } from '../outbound/mails.js'
import { PRODUCT_NAME } from '../product.js'
import { person } from '../programs.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'
import type { AgentRow } from './read.js'
import { createRow } from './settings-screen.js'

/**
 * Agents' accounts, from the inbox (D19): a supervisor invites someone by their address —
 * their row in « Conseillers », and a link, shown once, where they choose their password —
 * or hands an agent a link to choose a new one. An identity provider signs them in as
 * well, by the same address.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function readInvite(raw: unknown): InviteBody {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (name === '' || name.length > 120) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'name' })
  }
  if (!EMAIL.test(email) || email.length > 254) {
    throw new Refusal('INVALID_REQUEST', 400, { field: 'email' })
  }
  const role = body.role === 'supervisor' ? 'supervisor' : 'agent'
  const teamIds = Array.isArray(body.teamIds)
    ? body.teamIds.filter((id): id is string => typeof id === 'string' && id !== '')
    : []
  return { name, email, role, teamIds }
}

const linkOf = (webOrigin: string, token: string) => `${webOrigin}/invitation/${token}`

/**
 * The link, by e-mail too, when the chat writes e-mails (D23) — still shown once: a mail
 * may be late, or land in spam. Whether it left.
 */
export async function mailLink(
  mailer: Mailer | null,
  to: string | null,
  input: { purpose: 'invite' | 'reset'; name: string; by: string | null; link: string },
): Promise<boolean> {
  if (!mailer || !to) return false
  try {
    await mailer.send(linkMail({ to, ...input, product: PRODUCT_NAME }))
    return true
  } catch (error) {
    console.error('chat : e-mail du lien', error)
    return false
  }
}

/** Invites an agent: their row, active, and the link to hand over. */
export async function inviteAgent(
  db: Db,
  settings: Settings,
  webOrigin: string,
  agent: AgentRow,
  raw: unknown,
  mailer: Mailer | null = null,
): Promise<Invited> {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
  const invite = readInvite(raw)
  const [taken] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.login, invite.email.toLowerCase()))
  if (taken) throw new Refusal('AGENT_EXISTS', 409)
  const row = await createRow(settings, agent, 'conseillers', {
    Nom: invite.name,
    'E-mail': invite.email,
    Rôle: invite.role === 'supervisor' ? 'Superviseur' : 'Conseiller',
    Équipes: invite.teamIds,
    Actif: true,
  })
  const token = await issueLink(db, row.id, 'invite', agent.id)
  const link = linkOf(webOrigin, token)
  const emailed = await mailLink(mailer, invite.email, {
    purpose: 'invite',
    name: invite.name,
    by: agent.name,
    link,
  })
  return { row, link, emailed }
}

/** A link for an agent to choose a new password; the previous link is void. */
export async function resetAgentPassword(
  db: Db,
  webOrigin: string,
  agent: AgentRow,
  rowId: string,
  mailer: Mailer | null = null,
): Promise<PasswordReset> {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
  const [target] = await db
    .select({ id: agents.id, name: agents.name, email: agents.email, login: agents.login })
    .from(agents)
    .where(and(eq(agents.id, rowId), person(agents.login)))
  if (!target) throw new Refusal('ROW_NOT_FOUND', 404)
  const token = await issueLink(db, target.id, 'reset', agent.id)
  const link = linkOf(webOrigin, token)
  const emailed = await mailLink(mailer, target.email ?? target.login, {
    purpose: 'reset',
    name: target.name,
    by: agent.name,
    link,
  })
  return { link, emailed }
}
