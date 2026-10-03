/**
 * The image's health check: the server and the inbox answer. The worker has no port — its
 * process stopping stops the container (docker/start.mjs).
 */
import { readFileSync } from 'node:fs'

let mode = 'all'
try {
  mode = readFileSync('/tmp/messagerie-mode', 'utf8')
} catch {
  // Not started yet.
}
if (mode === 'worker') process.exit(0)

const ok = async (url) => {
  try {
    return (await fetch(url, { redirect: 'manual' })).status < 500
  } catch {
    return false
  }
}
const server = await ok(`http://127.0.0.1:${process.env.CHAT_PORT || 8810}/health`)
const inbox = server && (await ok('http://127.0.0.1:3210/'))
process.exit(server && inbox ? 0 : 1)
