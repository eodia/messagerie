import type { Redactor, ToolCall, ToolSpec } from '@chat/ai'
import type { BasedbClient } from '../basedb/client.js'
import type { Db } from '../db/client.js'
import { type contacts, conversationTags, messages } from '../db/schema.js'
import { signalChange } from '../realtime/signals.js'
import { type Settings, type ToolDefinition, resolveHeaders } from '../settings/settings.js'
import type { McpConnections, McpTool } from './mcp.js'

/**
 * The only actions the AI may take: basedb's « Outils IA », and the tools of its « Serveurs
 * MCP » — « un outil qui n'est pas ici n'existe pas pour elle ». Each call leaves an event
 * in the conversation, which the agents see and the visitor does not (D9).
 */

export interface ToolContext {
  readonly db: Db
  readonly settings: Settings
  readonly basedb: BasedbClient | null
  readonly mcp: McpConnections
  /** Null outside a conversation — a test from the tools screen: nothing is traced. */
  readonly conversationId: string | null
  readonly contact: typeof contacts.$inferSelect | null
  readonly redactor: Redactor
}

/** What the model may call a tool: letters, digits, underscores, 64 at most. */
function slug(name: string, max: number): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, max)
}

const fold = (text: string) => slug(text, 200).replace(/_/g, '')

type Entry =
  | { readonly kind: 'own'; readonly definition: ToolDefinition }
  | { readonly kind: 'mcp'; readonly tool: McpTool }

export interface ToolRun {
  /** What the model reads back — masked like everything it reads. */
  readonly content: string
  /** The tool as the agents read it: « Météo », « Agences Acme › trouver_agence ». */
  readonly tool: string
  readonly detail: string
}

/** The tools for the AI in the first line, or for the copilot — own and MCP, as allowed. */
export async function toolBoxFor(
  context: ToolContext,
  audience: 'agent' | 'copilot',
): Promise<ToolBox> {
  const own = (await context.settings.tools()).filter((t) => t[audience])
  const servers = (await context.settings.mcpServers()).filter((s) => s[audience])
  const discovered = await Promise.all(servers.map((server) => context.mcp.tools(server)))
  return new ToolBox(own, discovered.flat(), context)
}

export class ToolBox {
  private readonly entries = new Map<string, Entry>()

  constructor(
    own: readonly ToolDefinition[],
    mcp: readonly McpTool[],
    private readonly context: ToolContext,
  ) {
    own.forEach((definition, index) => {
      this.entries.set(`${slug(definition.name, 48) || 'outil'}_${index + 1}`, {
        kind: 'own',
        definition,
      })
    })
    mcp.forEach((tool, index) => {
      const name = `mcp_${slug(tool.server.name, 20)}_${slug(tool.name, 30)}_${index + 1}`
      this.entries.set(name.slice(0, 64), { kind: 'mcp', tool })
    })
  }

  specs(): ToolSpec[] {
    return [...this.entries].map(([name, entry]) =>
      entry.kind === 'own'
        ? {
            name,
            description: entry.definition.description,
            parameters: entry.definition.parameters,
          }
        : {
            name,
            description: `${entry.tool.description} (${entry.tool.server.name}${entry.tool.server.description ? ` — ${entry.tool.server.description}` : ''})`,
            parameters: entry.tool.inputSchema,
          },
    )
  }

  /** Runs a call: what the model reads back, and what the agents see. */
  async run(call: ToolCall): Promise<ToolRun> {
    const entry = this.entries.get(call.name)
    if (!entry) return { content: 'Outil inconnu.', tool: call.name, detail: 'outil inconnu' }
    let args: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(call.arguments || '{}')
      if (typeof parsed === 'object' && parsed !== null) args = parsed as Record<string, unknown>
    } catch {
      // A model's malformed arguments: the tool runs without them, and says so.
    }
    // The model saw placeholders: the tool gets the real values.
    const values = Object.fromEntries(
      Object.entries(args).map(([k, v]) => [
        k,
        typeof v === 'string' ? this.context.redactor.unmask(v) : v,
      ]),
    )
    const tool =
      entry.kind === 'own'
        ? entry.definition.name
        : `${entry.tool.server.name} › ${entry.tool.name}`
    let outcome: { content: string; detail: string }
    try {
      if (entry.kind === 'mcp') {
        const answer = await this.context.mcp.call(entry.tool, values)
        outcome = {
          content: answer.text,
          detail: `${summary(values)}${answer.failed ? ' — échec' : ''}`,
        }
      } else {
        const { definition } = entry
        outcome =
          definition.type === 'http'
            ? await this.http(definition, values)
            : definition.type === 'callback'
              ? await this.callback(values)
              : await this.read(definition, values)
      }
    } catch (error) {
      outcome = {
        content: 'L’outil n’a pas répondu.',
        detail: `échec : ${String(error).slice(0, 120)}`,
      }
    }
    await this.trace(tool, outcome.detail)
    return { ...outcome, content: this.context.redactor.mask(outcome.content), tool }
  }

  private async trace(tool: string, detail: string): Promise<void> {
    const { db, conversationId } = this.context
    if (conversationId === null) return
    await db.transaction(async (tx) => {
      await tx.insert(messages).values({
        conversationId,
        author: 'system',
        kind: 'event',
        meta: { event: { type: 'tool', tool, detail } },
      })
      await signalChange(tx, conversationId)
    })
  }

  /** A reading: the customer's record as the site signed it, or rows of a basedb table. */
  private async read(
    definition: ToolDefinition,
    values: Record<string, unknown>,
  ): Promise<{ content: string; detail: string }> {
    const target = definition.target ?? 'Fiche du visiteur'
    const { contact, basedb } = this.context
    if (fold(target) === fold('Fiche du visiteur')) {
      if (!contact?.identified) {
        return {
          content: 'Visiteur anonyme : aucune fiche.',
          detail: 'fiche du client — visiteur anonyme',
        }
      }
      const lines = contact.attributes.map((a) => `${a.label} : ${a.value}`)
      return {
        content: lines.length > 0 ? lines.join('\n') : 'Aucune information transmise par le site.',
        detail: `fiche du client ${contact.externalId ?? contact.name}`,
      }
    }
    if (!basedb) return { content: 'Données indisponibles.', detail: `${target} — basedb absent` }
    const base = await basedb.describe()
    const table = base.tables.find((t) => fold(t.label) === fold(target))
    if (!table) {
      return { content: 'Données indisponibles.', detail: `${target} — table introuvable` }
    }
    // Each parameter filters the field of the same name: « numero » → « Numéro ».
    const filters = Object.entries(values).flatMap(([key, value]) => {
      const field = table.fields.find(
        (f) => fold(f.label) === fold(key) || fold(f.name) === fold(key),
      )
      return field && (typeof value === 'string' || typeof value === 'number')
        ? [`${field.name} eq ${JSON.stringify(String(value))}`]
        : []
    })
    const rows = (await basedb.rows(table.name, filters.join(' and ') || undefined)).slice(0, 5)
    const readable = rows.map((row) =>
      table.fields
        .filter((f) => row[f.name] !== null && row[f.name] !== undefined && !f.name.startsWith('_'))
        .map((f) => `${f.label} : ${JSON.stringify(row[f.name])}`)
        .join('\n'),
    )
    return {
      content: readable.length > 0 ? readable.join('\n---\n') : 'Aucune ligne ne correspond.',
      detail: `${table.label} — ${rows.length} ligne(s)`,
    }
  }

  /**
   * An HTTP call. `{paramètre}` in the address is replaced by the value the model gave;
   * GET sends nothing else, POST sends the parameters and the customer as JSON. The token
   * comes from the environment variable the row names.
   */
  private async http(
    definition: ToolDefinition,
    values: Record<string, unknown>,
  ): Promise<{ content: string; detail: string }> {
    if (!definition.target) return { content: 'Outil mal déclaré.', detail: 'adresse manquante' }
    const url = fillUrl(definition.target, values)
    const token = definition.tokenEnv ? process.env[definition.tokenEnv] : undefined
    const { contact } = this.context
    const response = await fetch(url, {
      method: definition.method,
      headers: {
        accept: 'application/json, text/plain;q=0.9',
        ...(definition.method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...resolveHeaders(definition.headers),
      },
      body:
        definition.method === 'POST'
          ? JSON.stringify({
              parameters: values,
              contact: contact
                ? { externalId: contact.externalId, name: contact.name, email: contact.email }
                : null,
            })
          : undefined,
      signal: AbortSignal.timeout(8000),
    })
    const text = (await response.text()).slice(0, 4000)
    return {
      content: response.ok ? text : `Erreur ${response.status}.`,
      detail: `${summary(values)} — ${new URL(url).host} ${response.status}`,
    }
  }

  /** A callback: said in the conversation, and tagged « À rappeler » when the tag exists. */
  private async callback(
    values: Record<string, unknown>,
  ): Promise<{ content: string; detail: string }> {
    const phone = typeof values.telephone === 'string' ? values.telephone : null
    const when = typeof values.creneau === 'string' ? values.creneau : null
    const tag = (await this.context.settings.tags()).find(
      (t) => fold(t.name) === fold('À rappeler'),
    )
    if (tag && this.context.conversationId) {
      await this.context.db
        .insert(conversationTags)
        .values({
          conversationId: this.context.conversationId,
          label: tag.name,
          color: tag.color,
          origin: 'ai',
        })
        .onConflictDoNothing()
    }
    return {
      content: 'Rappel enregistré : un conseiller rappellera le client.',
      detail: `rappel${phone ? ` au ${phone}` : ''}${when ? ` — ${when}` : ''}`,
    }
  }
}

/** `https://…?ville={ville}` with the values in place, each one encoded. */
export function fillUrl(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_all, name: string) => {
    const value = values[name]
    return value === undefined || value === null ? '' : encodeURIComponent(String(value))
  })
}

/** The arguments as the agents read them in the event: « ville : Lyon ». */
function summary(values: Record<string, unknown>): string {
  const parts = Object.entries(values)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k} : ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  return parts.length > 0 ? parts.join(', ').slice(0, 160) : 'sans paramètre'
}
