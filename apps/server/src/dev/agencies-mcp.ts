import { type Server as HttpServer, type IncomingMessage, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pathToFileURL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

/**
 * Development: an MCP server of Acme Assurances' agencies, for the demonstration's
 * « Serveurs MCP » row — what a company's own service would be. Stateless Streamable HTTP
 * on `/mcp`, fixed data, no network.
 *
 *   pnpm --filter @chat/server mcp-demo        (port 8820, or CHAT_MCP_DEMO_PORT)
 */

const AGENCIES = [
  {
    city: 'Paris',
    name: 'Acme Paris Opéra',
    address: '12 rue Auber, 75009 Paris',
    phone: '01 40 00 12 12',
  },
  {
    city: 'Lyon',
    name: 'Acme Lyon Part-Dieu',
    address: '5 rue Servient, 69003 Lyon',
    phone: '04 72 00 34 34',
  },
  {
    city: 'Lille',
    name: 'Acme Lille Centre',
    address: '8 place du Théâtre, 59800 Lille',
    phone: '03 20 00 56 56',
  },
  {
    city: 'Nantes',
    name: 'Acme Nantes Commerce',
    address: '3 place du Commerce, 44000 Nantes',
    phone: '02 40 00 78 78',
  },
  {
    city: 'Marseille',
    name: 'Acme Marseille Prado',
    address: '40 avenue du Prado, 13006 Marseille',
    phone: '04 91 00 90 90',
  },
] as const

const HOURS = 'Du lundi au vendredi, 9 h – 12 h 30 et 14 h – 18 h ; le samedi, 9 h – 12 h.'

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

function nearest(city: string) {
  return AGENCIES.find((a) => fold(a.city) === fold(city)) ?? AGENCIES[0]
}

function mcpServer(): Server {
  const server = new Server(
    { name: 'agences-acme', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'trouver_agence',
        description:
          'Trouve l’agence Acme Assurances la plus proche d’une ville : nom, adresse, téléphone.',
        inputSchema: {
          type: 'object',
          properties: { ville: { type: 'string', description: 'La ville du client' } },
          required: ['ville'],
        },
      },
      {
        name: 'horaires_agence',
        description: 'Les horaires d’ouverture d’une agence Acme Assurances.',
        inputSchema: {
          type: 'object',
          properties: { agence: { type: 'string', description: 'Le nom de l’agence' } },
          required: ['agence'],
        },
      },
    ],
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    if (request.params.name === 'trouver_agence') {
      const city = typeof args.ville === 'string' ? args.ville : ''
      const agency = nearest(city)
      const exact = fold(agency.city) === fold(city)
      return {
        content: [
          {
            type: 'text',
            text: `${exact ? 'Agence' : `Pas d’agence à ${city} ; la plus proche`} : ${agency.name}, ${agency.address}. Téléphone : ${agency.phone}.`,
          },
        ],
      }
    }
    if (request.params.name === 'horaires_agence') {
      return { content: [{ type: 'text', text: HOURS }] }
    }
    return { content: [{ type: 'text', text: 'Outil inconnu.' }], isError: true }
  })
  return server
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : undefined
}

/** Starts the server; `port` 0 takes a free one. Returns it, and what stops it. */
export async function startAgenciesMcp(
  port: number,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const http: HttpServer = createServer(async (request, response) => {
    if (!request.url?.startsWith('/mcp')) {
      response.writeHead(404).end()
      return
    }
    // Stateless: a server and a transport per request, as the SDK recommends for it.
    const server = mcpServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    response.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(
        request,
        response,
        request.method === 'POST' ? await body(request) : undefined,
      )
    } catch {
      if (!response.headersSent) response.writeHead(400).end()
    }
  })
  await new Promise<void>((ready) => http.listen(port, '127.0.0.1', ready))
  const { port: actual } = http.address() as AddressInfo
  return {
    url: `http://localhost:${actual}/mcp`,
    stop: () => new Promise((done) => http.close(() => done())),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startAgenciesMcp(Number(process.env.CHAT_MCP_DEMO_PORT || 8820))
  console.log(`mcp-demo : agences Acme sur ${url}`)
}
