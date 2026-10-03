/**
 * The messaging in one container (Dockerfile): the server on 8810, the inbox on 3210 —
 * or, given `worker`, the worker alone (`command: worker` in docker-compose.yml).
 *
 * The server starts first: it applies the migrations of the `chat` schema. If either
 * process stops, the other is stopped too and the container exits: the restart policy
 * starts it again whole, rather than half of it running.
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const env = process.env
const SERVER = '/app/server/apps/server'
// Stopping gracefully first; after this, whatever still runs is killed.
const GRACE_MS = 10_000

const children = new Map()
let stopping = false
let exitCode = 0

function run(name, command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const [stream, out] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    createInterface({ input: stream }).on('line', (line) => out.write(`[${name}] ${line}\n`))
  }
  child.on('error', (error) => {
    console.error(`[messagerie] ${name} : démarrage impossible — ${error.message}`)
    stop(1)
  })
  child.on('exit', (code, signal) => {
    children.delete(name)
    if (!stopping) {
      console.error(
        `[messagerie] ${name} arrêté (${signal ?? `code ${code}`}) : arrêt du conteneur`,
      )
      stop(1)
    }
    if (children.size === 0) process.exit(exitCode)
  })
  children.set(name, child)
}

function stop(code) {
  if (stopping) return
  stopping = true
  exitCode = code
  if (children.size === 0) process.exit(exitCode)
  for (const child of children.values()) child.kill('SIGTERM')
  setTimeout(() => {
    for (const child of children.values()) child.kill('SIGKILL')
  }, GRACE_MS).unref()
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0))

/** What the inbox needs, and nothing more: it holds no secret. */
function inboxEnv() {
  const keep = ['PATH', 'HOME', 'TZ', 'NODE_ENV', 'NEXT_TELEMETRY_DISABLED', 'CHAT_API_URL']
  return {
    ...Object.fromEntries(keep.filter((k) => env[k] !== undefined).map((k) => [k, env[k]])),
    PORT: '3210',
    HOSTNAME: '0.0.0.0',
  }
}

const mode = process.argv[2] ?? 'all'

if (mode === 'worker') {
  // The health check (docker/health.mjs) has no port to ask: it reads this.
  writeFileSync('/tmp/messagerie-mode', 'worker')
  run('worker', 'node', ['dist/worker.js'], { cwd: SERVER, env })
} else if (mode === 'all') {
  writeFileSync('/tmp/messagerie-mode', 'all')
  run('serveur', 'node', ['dist/main.js'], { cwd: SERVER, env })
  run('inbox', 'node', ['apps/web/server.js'], { cwd: '/app/web', env: inboxEnv() })
} else {
  console.error(`[messagerie] commande inconnue « ${mode} » : rien, ou « worker »`)
  process.exit(2)
}
