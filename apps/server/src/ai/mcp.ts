import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { type McpServerDefinition, resolveHeaders } from '../settings/settings.js'

/**
 * The MCP servers the settings declare (« Serveurs MCP »): the chat is their client, over
 * Streamable HTTP, and offers their tools to the AI next to its own. A server that does
 * not answer costs its tools, never the conversation: the AI answers without them.
 *
 * One connection per server, opened at first use and kept; the list of its tools is read
 * again after five minutes. The token is read from the environment variable the row names.
 */

export interface McpTool {
  readonly server: McpServerDefinition
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

const TOOLS_KEEP_MS = 5 * 60_000
const CALL_TIMEOUT_MS = 15_000

interface Connection {
  readonly key: string
  client: Promise<Client>
  tools: { list: McpTool[]; until: number } | null
}

function keyOf(server: McpServerDefinition): string {
  return `${server.url}\n${server.tokenEnv ?? ''}\n${JSON.stringify(server.headers)}`
}

export class McpConnections {
  private readonly connections = new Map<string, Connection>()

  private connection(server: McpServerDefinition): Connection {
    const key = keyOf(server)
    let connection = this.connections.get(key)
    if (!connection) {
      const token = server.tokenEnv ? process.env[server.tokenEnv] : undefined
      const client = new Client({ name: 'messagerie', version: '0.1.0' })
      const headers = {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...resolveHeaders(server.headers),
      }
      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
      })
      const opened = client.connect(transport).then(() => client)
      connection = { key, client: opened, tools: null }
      this.connections.set(key, connection)
      // A failed connection is forgotten: the next use tries again.
      opened.catch(() => this.connections.delete(key))
    }
    return connection
  }

  /** A server's tools, those its row allows; none when it does not answer. */
  async tools(server: McpServerDefinition): Promise<McpTool[]> {
    const connection = this.connection(server)
    if (connection.tools && connection.tools.until > Date.now()) return connection.tools.list
    try {
      const client = await connection.client
      const { tools } = await client.listTools(undefined, { timeout: CALL_TIMEOUT_MS })
      const list = tools
        .filter((tool) => server.allowed.length === 0 || server.allowed.includes(tool.name))
        .map((tool) => ({
          server,
          name: tool.name,
          description: tool.description ?? tool.name,
          inputSchema: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<
            string,
            unknown
          >,
        }))
      connection.tools = { list, until: Date.now() + TOOLS_KEEP_MS }
      return list
    } catch {
      this.connections.delete(connection.key)
      return []
    }
  }

  /** Calls a tool; its text content, joined — what the model reads back. */
  async call(
    tool: McpTool,
    args: Record<string, unknown>,
  ): Promise<{ text: string; failed: boolean }> {
    const connection = this.connection(tool.server)
    try {
      const client = await connection.client
      const result = await client.callTool({ name: tool.name, arguments: args }, undefined, {
        timeout: CALL_TIMEOUT_MS,
      })
      const content = Array.isArray(result.content) ? result.content : []
      const text = content
        .map((part) =>
          typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text'
            ? String((part as { text?: unknown }).text ?? '')
            : '',
        )
        .filter(Boolean)
        .join('\n')
      return { text: text.slice(0, 4000) || '(réponse vide)', failed: result.isError === true }
    } catch (error) {
      this.connections.delete(connection.key)
      return { text: `Le serveur n’a pas répondu : ${String(error).slice(0, 200)}`, failed: true }
    }
  }

  async close(): Promise<void> {
    const clients = [...this.connections.values()].map((c) => c.client)
    this.connections.clear()
    await Promise.allSettled(clients.map(async (c) => (await c).close()))
  }
}
