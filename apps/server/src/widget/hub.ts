import type { WidgetEvent } from '@chat/contracts'
import type { WSContext } from 'hono/ws'

/**
 * The visitors' open sockets in this process, by contact: a visitor follows their own
 * conversation — whichever it is, even one created after the socket opened — and nobody
 * else's.
 */
export class WidgetHub {
  private readonly byContact = new Map<string, Set<WSContext>>()

  add(contactId: string, socket: WSContext): void {
    let sockets = this.byContact.get(contactId)
    if (!sockets) {
      sockets = new Set()
      this.byContact.set(contactId, sockets)
    }
    sockets.add(socket)
  }

  remove(contactId: string, socket: WSContext): void {
    const sockets = this.byContact.get(contactId)
    sockets?.delete(socket)
    if (sockets?.size === 0) this.byContact.delete(contactId)
  }

  has(contactId: string): boolean {
    return this.byContact.has(contactId)
  }

  get size(): number {
    return this.byContact.size
  }

  send(contactId: string, event: WidgetEvent): void {
    const data = JSON.stringify(event)
    for (const socket of this.byContact.get(contactId) ?? []) {
      try {
        socket.send(data)
      } catch {
        this.remove(contactId, socket)
      }
    }
  }

  broadcast(event: WidgetEvent): void {
    for (const contactId of this.byContact.keys()) this.send(contactId, event)
  }
}

/** A fixed window per key — enough to stop a script flooding a conversation. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - this.windowMs)
    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    if (this.hits.size > 10_000) {
      for (const [k, list] of this.hits)
        if (!list.some((at) => at > now - this.windowMs)) this.hits.delete(k)
    }
    return true
  }
}
