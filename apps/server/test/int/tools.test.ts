import { type IncomingHttpHeaders, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Redactor } from '@chat/ai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { McpConnections } from '../../src/ai/mcp.js'
import { ToolBox, fillUrl } from '../../src/ai/tools.js'
import type { Db } from '../../src/db/client.js'
import { startAgenciesMcp } from '../../src/dev/agencies-mcp.js'
import {
  type McpServerDefinition,
  Settings,
  type ToolDefinition,
  resolveHeaders,
} from '../../src/settings/settings.js'
import type { LabeledRow, SettingsSource } from '../../src/settings/source.js'

/**
 * The AI's tools outside any conversation: an MCP server's, discovered and called; an HTTP
 * call, its address filled in, its token and headers from the environment.
 */

let mcpDemo: { url: string; stop: () => Promise<void> }
let echo: {
  url: string
  stop: () => Promise<void>
  last: { url: string; headers: IncomingHttpHeaders; body: string } | null
}
const mcp = new McpConnections()

beforeAll(async () => {
  mcpDemo = await startAgenciesMcp(0)
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      echo.last = { url: request.url ?? '', headers: request.headers, body }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ temperature: 21 }))
    })
  })
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  echo = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    stop: () => new Promise((done) => server.close(() => done())),
    last: null,
  }
})

afterAll(async () => {
  await mcp.close()
  await mcpDemo?.stop()
  await echo?.stop()
})

const noSettings = new Settings({
  kind: 'template',
  rows: async (): Promise<LabeledRow[]> => [],
  follow: () => null,
} satisfies SettingsSource)

const context = {
  db: null as unknown as Db,
  settings: noSettings,
  basedb: null,
  mcp,
  conversationId: null,
  contact: null,
  redactor: new Redactor(false),
}

const server = (over: Partial<McpServerDefinition> = {}): McpServerDefinition => ({
  id: 's1',
  name: 'Agences Acme (démo)',
  url: mcpDemo.url,
  description: null,
  tokenEnv: null,
  headers: {},
  allowed: [],
  agent: true,
  copilot: true,
  ...over,
})

describe('an MCP server', () => {
  it('offers its tools, and only those its row allows', async () => {
    expect((await mcp.tools(server())).map((t) => t.name)).toEqual([
      'trouver_agence',
      'horaires_agence',
    ])
    expect(
      (
        await mcp.tools(
          server({ id: 's2', allowed: ['horaires_agence'], headers: { 'X-Seul': '1' } }),
        )
      ).map((t) => t.name),
    ).toEqual(['horaires_agence'])
  })

  it('answers a call through the tool box, named for the model', async () => {
    const tools = await mcp.tools(server())
    const box = new ToolBox([], tools, context)
    const spec = box.specs().find((s) => s.name.includes('trouver_agence'))
    expect(spec?.name).toMatch(/^mcp_agences_acme_demo_trouver_agence_\d$/)
    const ran = await box.run({ id: 'c1', name: spec?.name ?? '', arguments: '{"ville":"Lyon"}' })
    expect(ran).toMatchObject({
      tool: 'Agences Acme (démo) › trouver_agence',
      detail: 'ville : Lyon',
    })
    expect(ran.content).toContain('Acme Lyon Part-Dieu')
  })

  it('costs nothing but its tools when it does not answer', async () => {
    const started = Date.now()
    expect(await mcp.tools(server({ id: 'dead', url: 'http://127.0.0.1:9/mcp' }))).toEqual([])
    expect(Date.now() - started).toBeLessThan(20_000)
  })
})

describe('an HTTP tool', () => {
  const tool = (over: Partial<ToolDefinition>): ToolDefinition => ({
    id: 't1',
    name: 'Météo',
    description: 'La météo',
    type: 'http',
    target: `${echo.url}/meteo?lat={latitude}&ville={ville}`,
    method: 'GET',
    tokenEnv: null,
    headers: {},
    parameters: { type: 'object', properties: {} },
    agent: true,
    copilot: true,
    ...over,
  })

  it('fills the address in, each value encoded', () => {
    expect(fillUrl('https://x.fr/?v={ville}&n={absent}', { ville: 'Saint-Étienne & co' })).toBe(
      'https://x.fr/?v=Saint-%C3%89tienne%20%26%20co&n=',
    )
  })

  it('sends GET with its token and its headers, secrets taken from the environment', async () => {
    process.env.TEST_METEO_TOKEN = 'secret-token'
    process.env.TEST_METEO_KEY = 'secret-key'
    const box = new ToolBox(
      [
        tool({
          tokenEnv: 'TEST_METEO_TOKEN',
          headers: {
            'X-Api-Key': '${TEST_METEO_KEY}',
            'X-Absent': '${NOT_SET_ANYWHERE}',
            'X-Clair': 'oui',
          },
        }),
      ],
      [],
      context,
    )
    const [spec] = box.specs()
    const ran = await box.run({
      id: 'c',
      name: spec?.name ?? '',
      arguments: '{"latitude":45.76,"ville":"Lyon"}',
    })
    expect(ran.content).toBe('{"temperature":21}')
    expect(echo.last?.url).toBe('/meteo?lat=45.76&ville=Lyon')
    expect(echo.last?.headers).toMatchObject({
      authorization: 'Bearer secret-token',
      'x-api-key': 'secret-key',
      'x-clair': 'oui',
    })
    expect(echo.last?.headers['x-absent']).toBeUndefined()
  })

  it('sends POST with the parameters as JSON', async () => {
    const box = new ToolBox([tool({ method: 'POST', target: `${echo.url}/rappel` })], [], context)
    const [spec] = box.specs()
    await box.run({ id: 'c', name: spec?.name ?? '', arguments: '{"telephone":"0600000000"}' })
    expect(JSON.parse(echo.last?.body ?? '{}')).toMatchObject({
      parameters: { telephone: '0600000000' },
    })
  })
})

describe('headers', () => {
  it('leave out one whose variable is not set, rather than send it empty', () => {
    expect(resolveHeaders({ A: '${SET_ONE}', B: 'x-${UNSET_ONE}' }, { SET_ONE: '1' })).toEqual({
      A: '1',
    })
  })
})
