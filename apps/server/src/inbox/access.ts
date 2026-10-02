import type { InboxDirectory, SiteItem, TeamItem } from '@chat/contracts'
import { type SQL, eq, inArray, isNull, or } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { agents, conversations } from '../db/schema.js'
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

/** `canSee`, in SQL: the conversations of the inboxes one sees — and those of no inbox. */
export function inVisible(visible: Visible): SQL | undefined {
  if (visible === null) return undefined
  return visible.size === 0
    ? isNull(conversations.inboxId)
    : or(isNull(conversations.inboxId), inArray(conversations.inboxId, [...visible]))
}

export class Access {
  constructor(private readonly settings: Settings | null) {}

  /** The inboxes `agent` sees. */
  async visibleTo(agent: {
    readonly id: string
    readonly role: 'agent' | 'supervisor'
  }): Promise<Visible> {
    if (!this.settings || agent.role === 'supervisor') return null
    const entry = await this.settings.agent(agent.id)
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
      .select({ id: agents.id, role: agents.role })
      .from(agents)
      .where(eq(agents.active, true))
    if (!this.settings || (inboxId === null && teamId === null)) return rows.map((r) => r.id)
    const teamsOf = new Map((await this.settings.agents()).map((a) => [a.id, a.teamIds]))
    const inbox = inboxId ? (await this.settings.inboxes()).find((i) => i.id === inboxId) : null
    return rows
      .filter((row) => {
        if (row.role === 'supervisor') return true
        const teams = teamsOf.get(row.id) ?? []
        if (teamId !== null) return teams.includes(teamId)
        return !inbox || teams.some((t) => inbox.teamIds.includes(t))
      })
      .map((row) => row.id)
  }
}

/**
 * The sites whose conversations `visible` reaches: an active site whose conversations
 * arrive in one of these inboxes, and any site of a conversation found in one — moved
 * there, or from before the inboxes.
 */
async function sitesSeen(db: Db, settings: Settings, visible: Visible): Promise<SiteItem[]> {
  const [sites, seen] = await Promise.all([
    settings.sites(),
    db
      .selectDistinct({ siteId: conversations.siteId })
      .from(conversations)
      .where(inVisible(visible)),
  ])
  const met = new Set(seen.map((row) => row.siteId))
  const reached = await Promise.all(
    sites.map(
      async (site) =>
        met.has(site.id) ||
        (site.active && canSee(visible, (await settings.routeOf(site)).inboxId)),
    ),
  )
  return sites
    .filter((_, i) => reached[i])
    .map((site) => ({ id: site.id, name: site.name, color: site.color }))
}

/**
 * The inboxes an agent sees, with their teams — the inbox's menu and transfer choices —
 * and the sites they may narrow it to.
 */
export async function inboxDirectory(
  db: Db,
  settings: Settings | null,
  access: Access,
  agent: { readonly id: string; readonly role: 'agent' | 'supervisor' },
): Promise<InboxDirectory> {
  if (!settings) return { inboxes: [], teams: [], sites: [] }
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
        icon: i.icon,
        image: i.image,
        teams: i.teamIds.flatMap((id) => byId.get(id) ?? []),
        defaultTeamId: i.defaultTeamId,
      })),
    teams: teamItems,
    sites: await sitesSeen(db, settings, visible),
  }
}
