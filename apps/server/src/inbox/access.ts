import type { InboxDirectory, TeamItem } from '@chat/contracts'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agents } from '../db/schema.js'
import type { Settings } from '../settings/settings.js'

/**
 * Who sees what, by « Boîtes de réception »: a supervisor sees every inbox; an agent, the
 * inboxes one of their teams serves (« Conseillers » › Équipes, « Boîtes de réception » ›
 * Équipes). A conversation without an inbox — from before the inboxes — is everyone's,
 * and without settings to tell, so is every conversation.
 */

/** The inboxes someone sees; `null`: all of them. */
export type Visible = ReadonlySet<string> | null

export const canSee = (visible: Visible, inboxId: string | null): boolean =>
  visible === null || inboxId === null || visible.has(inboxId)

export class Access {
  constructor(private readonly settings: Settings | null) {}

  /** The inboxes `agent` sees. */
  async visibleTo(agent: {
    readonly basedbUserId: string
    readonly role: 'agent' | 'supervisor'
  }): Promise<Visible> {
    if (!this.settings || agent.role === 'supervisor') return null
    const entry = await this.settings.agent(agent.basedbUserId)
    if (!entry) return new Set()
    const teams = new Set(entry.teamIds)
    const inboxes = await this.settings.inboxes()
    return new Set(inboxes.filter((i) => i.teamIds.some((t) => teams.has(t))).map((i) => i.id))
  }

  /**
   * The active agents a conversation concerns: those who see its inbox — narrowed to the
   * members of `teamId` when given — and the supervisors. Whom the inbox rings for, and
   * whose sockets hear of it.
   */
  async audience(db: Db, inboxId: string | null, teamId: string | null = null): Promise<string[]> {
    const rows = await db
      .select({ id: agents.id, basedbUserId: agents.basedbUserId, role: agents.role })
      .from(agents)
      .where(eq(agents.active, true))
    if (!this.settings || (inboxId === null && teamId === null)) return rows.map((r) => r.id)
    const teamsOf = new Map((await this.settings.agents()).map((a) => [a.basedbUserId, a.teamIds]))
    const inbox = inboxId ? (await this.settings.inboxes()).find((i) => i.id === inboxId) : null
    return rows
      .filter((row) => {
        if (row.role === 'supervisor') return true
        const teams = teamsOf.get(row.basedbUserId) ?? []
        if (teamId !== null) return teams.includes(teamId)
        return !inbox || teams.some((t) => inbox.teamIds.includes(t))
      })
      .map((row) => row.id)
  }
}

/** The inboxes an agent sees, with their teams — the inbox's menu and transfer choices. */
export async function inboxDirectory(
  settings: Settings | null,
  access: Access,
  agent: { readonly basedbUserId: string; readonly role: 'agent' | 'supervisor' },
): Promise<InboxDirectory> {
  if (!settings) return { inboxes: [], teams: [] }
  const [inboxes, teams, visible] = await Promise.all([
    settings.inboxes(),
    settings.teams(),
    access.visibleTo(agent),
  ])
  const teamItems: TeamItem[] = teams.map((t) => ({ id: t.id, name: t.name }))
  const byId = new Map(teamItems.map((t) => [t.id, t]))
  return {
    inboxes: inboxes
      .filter((i) => i.active && canSee(visible, i.id))
      .map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        color: i.color,
        teams: i.teamIds.flatMap((id) => byId.get(id) ?? []),
        defaultTeamId: i.defaultTeamId,
      })),
    teams: teamItems,
  }
}
