import { randomBytes } from 'node:crypto'

/**
 * One-use tickets that open the inbox's WebSocket.
 *
 * A browser cannot put an `Authorization` header on a WebSocket, and a token in the URL
 * ends up in logs. So the inbox asks for a ticket over HTTP — authenticated as any
 * request — and opens the socket with it: good once, for thirty seconds, and worthless
 * to whoever reads it afterwards.
 *
 * Held in memory: a ticket is used within a second by the process that issued it — with
 * several instances behind a proxy, the proxy keeps a client on one (sticky sessions).
 */
const LIFETIME_MS = 30_000

export class TicketBook {
  private readonly tickets = new Map<string, { agentId: string; expires: number }>()

  issue(agentId: string): string {
    this.sweep()
    const ticket = randomBytes(24).toString('base64url')
    this.tickets.set(ticket, { agentId, expires: Date.now() + LIFETIME_MS })
    return ticket
  }

  /** The agent a ticket was issued to — once. */
  redeem(ticket: string | undefined): string | null {
    if (!ticket) return null
    const entry = this.tickets.get(ticket)
    this.tickets.delete(ticket)
    return entry && entry.expires > Date.now() ? entry.agentId : null
  }

  private sweep(): void {
    const now = Date.now()
    for (const [ticket, entry] of this.tickets)
      if (entry.expires <= now) this.tickets.delete(ticket)
  }
}
