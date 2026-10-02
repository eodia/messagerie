import type { InviteBody, Invited, PasswordReset } from '@chat/contracts'
import { and, eq } from 'drizzle-orm'
import { issueLink } from '../auth/credentials.js'
import type { Db } from '../db/client.js'
import { agents } from '../db/schema.js'
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

/** Invites an agent: their row, active, and the link to hand over. */
export async function inviteAgent(
  db: Db,
  settings: Settings,
  webOrigin: string,
  agent: AgentRow,
  raw: unknown,
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
  return { row, link: linkOf(webOrigin, token) }
}

/** A link for an agent to choose a new password; the previous link is void. */
export async function resetAgentPassword(
  db: Db,
  webOrigin: string,
  agent: AgentRow,
  rowId: string,
): Promise<PasswordReset> {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
  const [target] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, rowId), person(agents.login)))
  if (!target) throw new Refusal('ROW_NOT_FOUND', 404)
  const token = await issueLink(db, target.id, 'reset', agent.id)
  return { link: linkOf(webOrigin, token) }
}
