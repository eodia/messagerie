import type { Redactor, ToolCall, ToolSpec } from '@chat/ai'
import type { BasedbClient } from '../basedb/client.js'
import type { Db } from '../db/client.js'
import { type contacts, conversationTags, messages } from '../db/schema.js'
import { signalChange } from '../realtime/signals.js'
import type { Settings, ToolDefinition } from '../settings/settings.js'

/**
 * The only actions the AI may take: basedb's « Outils IA » — « un outil qui n'est pas ici
 * n'existe pas pour elle ». Each call leaves an event in the conversation, which the agents
 * see and the visitor does not (D9).
 */

export interface ToolContext {
  readonly db: Db
  readonly settings: Settings
  readonly basedb: BasedbClient | null
  readonly conversationId: string
  readonly contact: typeof contacts.$inferSelect
  readonly redactor: Redactor
}

/** What the model may call a tool: letters, digits, underscores, 64 at most. */
function slug(name: string, index: number): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
  return base ? `${base}_${index + 1}` : `outil_${index + 1}`
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

export class ToolBox {
  private readonly byName: Map<string, ToolDefinition>

  constructor(
    definitions: readonly ToolDefinition[],
    private readonly context: ToolContext,
  ) {
    this.byName = new Map(definitions.map((d, i) => [slug(d.name, i), d]))
  }

  specs(): ToolSpec[] {
    return [...this.byName].map(([name, d]) => ({
      name,
      description: d.description,
      parameters: d.parameters,
    }))
  }

  /** Runs a call: what the model reads back, and what the agents see. */
  async run(call: ToolCall): Promise<{ content: string; tool: string; detail: string }> {
    const definition = this.byName.get(call.name)
    if (!definition) return { content: 'Outil inconnu.', tool: call.name, detail: 'outil inconnu' }
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
    let outcome: { content: string; detail: string }
    try {
      outcome =
        definition.type === 'http'
          ? await this.http(definition, values)
          : definition.type === 'callback'
            ? await this.callback(values)
            : await this.read(definition, values)
    } catch (error) {
      outcome = {
        content: 'L’outil n’a pas répondu.',
        detail: `échec : ${String(error).slice(0, 120)}`,
      }
    }
    await this.trace(definition.name, outcome.detail)
    return {
      ...outcome,
      content: this.context.redactor.mask(outcome.content),
      tool: definition.name,
    }
  }

  private async trace(tool: string, detail: string): Promise<void> {
    const { db, conversationId } = this.context
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
      if (!contact.identified) {
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
    if (!table)
      return { content: 'Données indisponibles.', detail: `${target} — table introuvable` }
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

  private async http(
    definition: ToolDefinition,
    values: Record<string, unknown>,
  ): Promise<{ content: string; detail: string }> {
    if (!definition.target) return { content: 'Outil mal déclaré.', detail: 'adresse manquante' }
    const { contact } = this.context
    const response = await fetch(definition.target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        parameters: values,
        contact: { externalId: contact.externalId, name: contact.name, email: contact.email },
      }),
      signal: AbortSignal.timeout(5000),
    })
    const text = (await response.text()).slice(0, 2000)
    return {
      content: response.ok ? text : `Erreur ${response.status}.`,
      detail: `${new URL(definition.target).host} — ${response.status}`,
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
    if (tag) {
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
