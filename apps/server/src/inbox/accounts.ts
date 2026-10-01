import type { InviteBody, Invited, PasswordReset } from '@chat/contracts'
import { type BasedbClient, BasedbFailure } from '../basedb/client.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'
import type { AgentRow } from './read.js'
import { createRow } from './settings-screen.js'

/**
 * Agents' accounts, from the inbox: a supervisor invites someone by their address — the
 * basedb account is created then and there, and its temporary password shown once — or
 * gives an agent a new temporary password. basedb keeps the accounts (D4): it asks for an
 * administrator, elevated minutes ago, and the inbox relays its answers as codes.
 */

const EMAIL = /^[^\s@]+@[^\s@]+$/

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

/** basedb's refusals about accounts, in the chat's codes. */
function accountRefusal(error: unknown): never {
  if (!(error instanceof BasedbFailure)) throw error
  if (error.code === 'ELEVATION_REQUIRED') throw new Refusal('ELEVATION_REQUIRED', 403)
  if (error.status === 401 || error.status === 403) {
    throw new Refusal('ACCOUNTS_ADMIN_REQUIRED', 403)
  }
  if (error.status === 404) throw new Refusal('ROW_NOT_FOUND', 404)
  if (error.status === 400 || error.status === 422) {
    throw new Refusal('INVALID_REQUEST', 400, { reason: error.code })
  }
  throw new Refusal('BASEDB_UNREACHABLE', 502)
}

function needs(basedb: BasedbClient | null, token: string | null): [BasedbClient, string] {
  if (!basedb || !token) throw new Refusal('BASEDB_UNREACHABLE', 503)
  return [basedb, token]
}

/**
 * Invites an agent: their account — created, or the one their address already has — and
 * their row in « Conseillers », active.
 */
export async function inviteAgent(
  settings: Settings,
  basedb: BasedbClient | null,
  agent: AgentRow,
  token: string | null,
  raw: unknown,
): Promise<Invited> {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
  const [client, bearer] = needs(basedb, token)
  const invite = readInvite(raw)

  const group = client.supervisorsGroup
  const groups = invite.role === 'supervisor' && group ? [group] : []
  let account: { id: string; temporaryPassword: string | null }
  try {
    account = await client.createAccount(bearer, { ...invite, groups })
  } catch (error) {
    if (!(error instanceof BasedbFailure) || error.code !== 'EMAIL_TAKEN') accountRefusal(error)
    // The address has an account already: it is the one the agent signs in with.
    const known = (await client.users(bearer)).find(
      (u) => u.email?.toLowerCase() === invite.email.toLowerCase(),
    )
    if (!known) throw new Refusal('INVALID_REQUEST', 400, { reason: 'EMAIL_TAKEN' })
    account = { id: known.id, temporaryPassword: null }
    if (groups.length > 0) await supervise(client, bearer, known.id, true)
  }

  if (await settings.agent(account.id)) throw new Refusal('AGENT_EXISTS', 409)
  const row = await createRow(settings, agent, token, 'conseillers', {
    Nom: invite.name,
    'Compte basedb': account.id,
    Rôle: invite.role === 'supervisor' ? 'Superviseur' : 'Conseiller',
    Équipes: invite.teamIds,
    Actif: true,
  })
  return { row, temporaryPassword: account.temporaryPassword }
}

/**
 * Puts a supervisor's account in the group that may edit the « Messagerie » base, or takes
 * an agent's out of it — so that the role chosen in the inbox is the right in basedb.
 */
async function supervise(
  client: BasedbClient,
  token: string,
  userId: string,
  supervisor: boolean,
): Promise<void> {
  const group = client.supervisorsGroup
  if (!group) return
  try {
    await client.setGroupMember(token, group, userId, supervisor)
  } catch (error) {
    // Out of a group one was not in: nothing to undo.
    if (!supervisor && error instanceof BasedbFailure && error.status === 404) return
    accountRefusal(error)
  }
}

/**
 * Before an agent's row is written: when its role or its account changes, the basedb group
 * follows. Done first, so that a refusal — a password to confirm — leaves the row as it was.
 */
export async function followRole(
  settings: Settings,
  basedb: BasedbClient | null,
  agent: AgentRow,
  token: string | null,
  rowId: string | null,
  raw: unknown,
): Promise<void> {
  if (agent.role !== 'supervisor' || !basedb?.supervisorsGroup || !token) return
  const values = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (!('Rôle' in values) && !('Compte basedb' in values)) return
  const before = rowId
    ? (await settings.rowsOf('Conseillers')).find((r) => r.id === rowId)?.values
    : undefined
  const idOf = (v: unknown) => (Array.isArray(v) ? v[0] : v)
  const account = idOf(
    'Compte basedb' in values ? values['Compte basedb'] : before?.['Compte basedb'],
  )
  if (typeof account !== 'string' || account === '') return
  const role = 'Rôle' in values ? values.Rôle : before?.Rôle
  const was = before?.Rôle === 'Superviseur' && idOf(before?.['Compte basedb']) === account
  const is = role === 'Superviseur'
  // A new agent joins the group if a supervisor; an existing one when the role changes.
  if (rowId === null ? !is : was === is) return
  await supervise(basedb, token, account, is)
}

/** A new temporary password for an agent's account; the agent chooses theirs at sign-in. */
export async function resetAgentPassword(
  settings: Settings,
  basedb: BasedbClient | null,
  agent: AgentRow,
  token: string | null,
  rowId: string,
): Promise<PasswordReset> {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
  const [client, bearer] = needs(basedb, token)
  const row = (await settings.rowsOf('Conseillers')).find((r) => r.id === rowId)
  const account = row?.values['Compte basedb']
  const userId = Array.isArray(account) ? account[0] : account
  if (typeof userId !== 'string' || userId === '') throw new Refusal('ROW_NOT_FOUND', 404)
  try {
    return { temporaryPassword: await client.resetPassword(bearer, userId) }
  } catch (error) {
    accountRefusal(error)
  }
}
