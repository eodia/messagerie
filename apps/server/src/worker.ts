import { boot } from './boot.js'

/**
 * The AI's worker, alone (D7): the queues of `ai/jobs.ts` — answers, suggestions, tags,
 * summaries, the knowledge base, the retention — and the webhooks' calls (D17), in a
 * process of their own, so that a slow model or a slow receiver never slows the WebSocket.
 * Run it with `CHAT_WORKER=separate` on the server.
 */
const { ai, stop } = await boot('worker')
console.log(ai ? 'worker : au travail' : 'worker : au travail, webhooks seulement (aucune IA)')

const quit = async () => {
  await stop()
  process.exit(0)
}
process.on('SIGINT', quit)
process.on('SIGTERM', quit)
