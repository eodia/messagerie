import { Redactor } from '@chat/ai'
import type { ToolTestBody, ToolTestResult, ToolsOverview } from '@chat/contracts'
import type { McpConnections } from '../ai/mcp.js'
import { ToolBox } from '../ai/tools.js'
import type { BasedbClient } from '../basedb/client.js'
import type { Db } from '../db/client.js'
import { Refusal } from '../refusal.js'
import type { Settings } from '../settings/settings.js'
import type { AgentRow } from './read.js'

/**
 * The tools screen: what basedb declares — « Outils IA » and « Serveurs MCP » — whether
 * each server answers and what it offers; and a tool tried by a supervisor, outside any
 * conversation, to check a configuration before the AI relies on it.
 */

export async function toolsOverview(
  settings: Settings | null,
  mcp: McpConnections,
): Promise<ToolsOverview> {
  if (!settings) return { tools: [], mcp: [] }
  const [tools, servers] = await Promise.all([settings.tools(), settings.mcpServers()])
  return {
    tools: tools.map(
      ({ id, name, description, type, target, method, agent, copilot, parameters }) => ({
        id,
        name,
        description,
        type,
        target,
        method,
        agent,
        copilot,
        parameters,
      }),
    ),
    mcp: await Promise.all(
      servers.map(async (server) => {
        const offered = await mcp.tools(server)
        return {
          id: server.id,
          name: server.name,
          url: server.url,
          agent: server.agent,
          copilot: server.copilot,
          reachable: offered.length > 0,
          tools: offered.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        }
      }),
    ),
  }
}

export async function testTool(
  deps: {
    readonly db: Db
    readonly settings: Settings | null
    readonly basedb: BasedbClient | null
    readonly mcp: McpConnections
  },
  agent: AgentRow,
  body: ToolTestBody,
): Promise<ToolTestResult> {
  if (agent.role !== 'supervisor') throw new Refusal('NOT_ALLOWED', 403)
  const { settings } = deps
  if (!settings) throw new Refusal('TOOL_NOT_FOUND', 404)
  const context = {
    db: deps.db,
    settings,
    basedb: deps.basedb,
    mcp: deps.mcp,
    conversationId: null,
    contact: null,
    redactor: new Redactor(false),
  }
  let box: ToolBox
  if (body.server) {
    const server = (await settings.mcpServers()).find((s) => s.id === body.server)
    const tool = server
      ? (await deps.mcp.tools(server)).find((t) => t.name === body.tool)
      : undefined
    if (!tool) throw new Refusal('TOOL_NOT_FOUND', 404)
    box = new ToolBox([], [tool], context)
  } else {
    const definition = (await settings.tools()).find((t) => t.id === body.tool)
    if (!definition) throw new Refusal('TOOL_NOT_FOUND', 404)
    box = new ToolBox([definition], [], context)
  }
  const [spec] = box.specs()
  if (!spec) throw new Refusal('TOOL_NOT_FOUND', 404)
  const ran = await box.run({
    id: 'test',
    name: spec.name,
    arguments: JSON.stringify(body.arguments),
  })
  return { content: ran.content, detail: ran.detail }
}
