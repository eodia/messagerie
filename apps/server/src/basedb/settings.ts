import { type BasedbClient, BasedbFailure, type Row, type TableDescription } from './client.js'

/**
 * The chat's settings, read from the « Messagerie » base (D1, D2).
 *
 * Tables and fields are found by their LABELS — the ones `messagerie.json` gives them,
 * which are the contract — and addressed by the physical names basedb reports for them.
 * A table renamed in basedb breaks that contract: the chat then says which label it could
 * not find, rather than reading the wrong column.
 *
 * What is read is kept until basedb signals a change of the table (B3); a failed read is
 * not kept, the next request tries again.
 */

export interface AgentEntry {
  /** The basedb account — introspection's `sub`. */
  readonly basedbUserId: string
  readonly name: string
  readonly role: 'agent' | 'supervisor'
  readonly active: boolean
}

const AGENTS = {
  table: 'Conseillers',
  name: 'Nom',
  account: 'Compte basedb',
  role: 'Rôle',
  active: 'Actif',
  supervisor: 'Superviseur',
} as const

interface AgentsLayout {
  readonly table: string
  readonly name: string
  readonly account: string
  readonly role: string
  readonly active: string
  /** What the « Rôle » column stores for « Superviseur ». */
  readonly supervisor: string | null
}

function fieldName(table: TableDescription, label: string): string {
  const field = table.fields.find((f) => f.label === label)
  if (!field) throw new BasedbFailure(0, `TEMPLATE_MISMATCH: ${table.label} › ${label}`)
  return field.name
}

/** A « Personne » value: the account's identifier, however basedb spells it. */
function accountOf(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id: unknown }).id
    return typeof id === 'string' ? id : null
  }
  return null
}

export class MessagerieSettings {
  private layout: Promise<AgentsLayout> | null = null
  private agents: Promise<Map<string, AgentEntry>> | null = null

  constructor(readonly client: BasedbClient) {}

  private resolve(): Promise<AgentsLayout> {
    this.layout ??= this.client.describe().then((base) => {
      const table = base.tables.find((t) => t.label === AGENTS.table)
      if (!table) throw new BasedbFailure(0, `TEMPLATE_MISMATCH: ${AGENTS.table}`)
      const role = table.fields.find((f) => f.label === AGENTS.role)
      return {
        table: table.name,
        name: fieldName(table, AGENTS.name),
        account: fieldName(table, AGENTS.account),
        role: fieldName(table, AGENTS.role),
        active: fieldName(table, AGENTS.active),
        supervisor: role?.options?.find((o) => o.label === AGENTS.supervisor)?.value ?? null,
      }
    })
    this.layout.catch(() => {
      this.layout = null
    })
    return this.layout
  }

  private async loadAgents(): Promise<Map<string, AgentEntry>> {
    const layout = await this.resolve()
    const rows: Row[] = await this.client.rows(layout.table)
    const agents = new Map<string, AgentEntry>()
    for (const row of rows) {
      const account = accountOf(row[layout.account])
      if (account === null) continue
      agents.set(account, {
        basedbUserId: account,
        name: typeof row[layout.name] === 'string' ? (row[layout.name] as string) : '',
        role:
          layout.supervisor !== null && row[layout.role] === layout.supervisor
            ? 'supervisor'
            : 'agent',
        active: row[layout.active] === true,
      })
    }
    return agents
  }

  /** The « Conseillers » row of an account, or null when it has none. */
  async agent(basedbUserId: string): Promise<AgentEntry | null> {
    this.agents ??= this.loadAgents()
    const loading = this.agents
    loading.catch(() => {
      if (this.agents === loading) this.agents = null
    })
    return (await loading).get(basedbUserId) ?? null
  }

  /** Forgets what was read: the next request reads it again. */
  invalidate(): void {
    this.agents = null
  }

  /** Follows « Conseillers » in basedb, forgetting it at each change. Returns what stops it. */
  follow(onError: (error: unknown) => void): () => void {
    let stop = () => {}
    let stopped = false
    this.resolve()
      .then((layout) => {
        if (!stopped) stop = this.client.follow(layout.table, () => this.invalidate(), onError)
      })
      .catch(onError)
    return () => {
      stopped = true
      stop()
    }
  }
}
