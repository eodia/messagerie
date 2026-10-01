import type { InboxEvent } from '@chat/contracts'
import type { WSContext } from 'hono/ws'

/**
 * The agents' open sockets in this process. Each change signal from PostgreSQL becomes one
 * message to each of them; a socket that cannot take it is dropped, and its inbox will
 * reconnect and read the list again.
 */
export class InboxHub {
  /** Each socket, and the agent it was opened for. */
  private readonly sockets = new Map<WSContext, string>()

  add(socket: WSContext, agentId: string): void {
    this.sockets.set(socket, agentId)
  }

  remove(socket: WSContext): void {
    this.sockets.delete(socket)
  }

  get size(): number {
    return this.sockets.size
  }

  broadcast(event: InboxEvent): void {
    this.send(event, () => true)
  }

  /** To the sockets of the agents `to` accepts — those who see the conversation's inbox. */
  sendWhere(event: InboxEvent, to: (agentId: string) => boolean): void {
    this.send(event, to)
  }

  /** To the sockets of one agent only — a notification is theirs. */
  sendTo(agentId: string, event: InboxEvent): void {
    this.send(event, (owner) => owner === agentId)
  }

  private send(event: InboxEvent, to: (agentId: string) => boolean): void {
    const data = JSON.stringify(event)
    for (const [socket, owner] of this.sockets) {
      if (!to(owner)) continue
      try {
        socket.send(data)
      } catch {
        this.sockets.delete(socket)
      }
    }
  }
}
