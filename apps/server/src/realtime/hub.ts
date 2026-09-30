import type { InboxEvent } from '@chat/contracts'
import type { WSContext } from 'hono/ws'

/**
 * The agents' open sockets in this process. Each change signal from PostgreSQL becomes one
 * message to each of them; a socket that cannot take it is dropped, and its inbox will
 * reconnect and read the list again.
 */
export class InboxHub {
  private readonly sockets = new Set<WSContext>()

  add(socket: WSContext): void {
    this.sockets.add(socket)
  }

  remove(socket: WSContext): void {
    this.sockets.delete(socket)
  }

  get size(): number {
    return this.sockets.size
  }

  broadcast(event: InboxEvent): void {
    const data = JSON.stringify(event)
    for (const socket of this.sockets) {
      try {
        socket.send(data)
      } catch {
        this.sockets.delete(socket)
      }
    }
  }
}
