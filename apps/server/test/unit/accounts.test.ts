import { describe, expect, it } from 'vitest'
import { type BasedbClient, BasedbFailure } from '../../src/basedb/client.js'
import { followRole, inviteAgent } from '../../src/inbox/accounts.js'
import type { AgentRow } from '../../src/inbox/read.js'
import { Settings } from '../../src/settings/settings.js'
import { TemplateSource } from '../../src/settings/source.js'

/** Agents invited from the inbox: their basedb account, their row, the supervisors' group. */

const supervisor = { id: 'a1', role: 'supervisor', basedbUserId: 'dev-marc' } as AgentRow
const fresh = () => new Settings(new TemplateSource('dev-marc', true))

interface Calls {
  created: { email: string; name: string; groups: readonly string[] }[]
  memberships: { userId: string; member: boolean }[]
}

/** basedb's account API, as far as the inbox uses it. */
function fakeBasedb(
  options: { taken?: boolean; elevation?: boolean; group?: string | null } = {},
): BasedbClient & { calls: Calls } {
  const calls: Calls = { created: [], memberships: [] }
  return {
    calls,
    supervisorsGroup: options.group === undefined ? 'g-sup' : options.group,
    async createAccount(_token: string, account: Calls['created'][number]) {
      if (options.elevation) throw new BasedbFailure(403, 'ELEVATION_REQUIRED')
      if (options.taken) throw new BasedbFailure(409, 'EMAIL_TAKEN')
      calls.created.push(account)
      return { id: 'u-new', temporaryPassword: 'Temp-1234-abcd' }
    },
    async users() {
      return [{ id: 'u-old', name: 'Camille', email: 'Camille@Exemple.fr' }]
    },
    async setGroupMember(_token: string, _group: string, userId: string, member: boolean) {
      calls.memberships.push({ userId, member })
    },
  } as unknown as BasedbClient & { calls: Calls }
}

const invite = { name: 'Camille Durand', email: 'camille@exemple.fr', role: 'agent', teamIds: [] }

describe('inviting an agent', () => {
  it('creates the account, then the row with it, active', async () => {
    const settings = fresh()
    const basedb = fakeBasedb()
    const invited = await inviteAgent(settings, basedb, supervisor, 'tok', invite)
    expect(invited.temporaryPassword).toBe('Temp-1234-abcd')
    expect(invited.row.values).toMatchObject({
      Nom: 'Camille Durand',
      'Compte basedb': 'u-new',
      Rôle: 'Conseiller',
      Actif: true,
    })
    expect(basedb.calls.created[0]?.groups).toEqual([])
    expect(await settings.agent('u-new')).toMatchObject({ role: 'agent', active: true })
  })

  it('puts a supervisor in the group that may edit the base', async () => {
    const basedb = fakeBasedb()
    await inviteAgent(fresh(), basedb, supervisor, 'tok', { ...invite, role: 'supervisor' })
    expect(basedb.calls.created[0]?.groups).toEqual(['g-sup'])
  })

  it('keeps the account an address already has, with no password to hand over', async () => {
    const basedb = fakeBasedb({ taken: true })
    const invited = await inviteAgent(fresh(), basedb, supervisor, 'tok', {
      ...invite,
      role: 'supervisor',
    })
    expect(invited.temporaryPassword).toBeNull()
    expect(invited.row.values['Compte basedb']).toBe('u-old')
    expect(basedb.calls.memberships).toEqual([{ userId: 'u-old', member: true }])
  })

  it('says when basedb wants the password again', async () => {
    await expect(
      inviteAgent(fresh(), fakeBasedb({ elevation: true }), supervisor, 'tok', invite),
    ).rejects.toMatchObject({ code: 'ELEVATION_REQUIRED' })
  })

  it('refuses an agent, a bad address, and an account that is an agent already', async () => {
    const settings = fresh()
    const agent = { ...supervisor, role: 'agent' } as AgentRow
    await expect(inviteAgent(settings, fakeBasedb(), agent, 'tok', invite)).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    })
    await expect(
      inviteAgent(settings, fakeBasedb(), supervisor, 'tok', { ...invite, email: 'camille' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await inviteAgent(settings, fakeBasedb(), supervisor, 'tok', invite)
    await expect(
      inviteAgent(settings, fakeBasedb(), supervisor, 'tok', invite),
    ).rejects.toMatchObject({ code: 'AGENT_EXISTS' })
  })
})

describe('the role, followed in basedb', () => {
  it('joins the group when an agent becomes a supervisor, and leaves it when not', async () => {
    const settings = fresh()
    const basedb = fakeBasedb()
    const { row } = await inviteAgent(settings, basedb, supervisor, 'tok', invite)
    await followRole(settings, basedb, supervisor, 'tok', row.id, { Rôle: 'Superviseur' })
    expect(basedb.calls.memberships).toEqual([{ userId: 'u-new', member: true }])
  })

  it('does nothing for another field, a new agent, or without a group', async () => {
    const settings = fresh()
    const basedb = fakeBasedb()
    const { row } = await inviteAgent(settings, basedb, supervisor, 'tok', invite)
    await followRole(settings, basedb, supervisor, 'tok', row.id, { Nom: 'Camille D.' })
    await followRole(settings, basedb, supervisor, 'tok', null, {
      Nom: 'Lou',
      'Compte basedb': 'u-lou',
      Rôle: 'Conseiller',
    })
    const none = fakeBasedb({ group: null })
    await followRole(settings, none, supervisor, 'tok', row.id, { Rôle: 'Superviseur' })
    expect([...basedb.calls.memberships, ...none.calls.memberships]).toEqual([])
  })
})
