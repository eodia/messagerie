import { boot } from './boot.js'

/**
 * The AI's worker, alone (D7): the queues of `ai/jobs.ts` — answers, suggestions, tags,
 * summaries, the knowledge base, the retention — in a process of their own, so that a slow
 * model never slows the WebSocket. Run it with `CHAT_WORKER=separate` on the server.
 */
const { ai, stop } = await boot('worker')
if (!ai) {
  console.error('worker : aucune IA configurée (CHAT_AI_API_KEY) — rien à faire.')
  await stop()
  process.exit(1)
}
console.log('worker : au travail')

const quit = async () => {
  await stop()
  process.exit(0)
}
process.on('SIGINT', quit)
process.on('SIGTERM', quit)
