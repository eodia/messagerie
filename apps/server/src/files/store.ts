import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

/**
 * Where the files sent in conversations are kept: a directory of the server, outside the
 * database — the bytes would bloat it, and a purge is a deletion. One file per key; a key
 * is the chat's (`conversation/attachment`), never a name the sender chose.
 */
export interface FileStore {
  put(key: string, bytes: Uint8Array): Promise<void>
  read(key: string): Promise<Buffer>
  remove(key: string): Promise<void>
  /** Every file of a conversation — its folder — for a purge. */
  removeConversation(conversationId: string): Promise<void>
}

export class DiskStore implements FileStore {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  /** The key's path — inside the root, whatever the key says. */
  private path(key: string): string {
    const path = resolve(join(this.root, key))
    if (!path.startsWith(this.root + sep)) throw new Error(`clé hors du dossier : ${key}`)
    return path
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.path(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.path(key))
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }

  async removeConversation(conversationId: string): Promise<void> {
    await rm(this.path(conversationId), { recursive: true, force: true })
  }
}

/** In memory: the tests'. */
export class MemoryStore implements FileStore {
  readonly files = new Map<string, Buffer>()

  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.files.set(key, Buffer.from(bytes))
  }

  async read(key: string): Promise<Buffer> {
    const bytes = this.files.get(key)
    if (!bytes) throw Object.assign(new Error('absent'), { code: 'ENOENT' })
    return bytes
  }

  async remove(key: string): Promise<void> {
    this.files.delete(key)
  }

  async removeConversation(conversationId: string): Promise<void> {
    for (const key of this.files.keys()) {
      if (key.startsWith(`${conversationId}/`)) this.files.delete(key)
    }
  }
}
