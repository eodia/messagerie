import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

/**
 * The inbox speaks HTTP and WebSocket to the chat server — never PostgreSQL. No server
 * action opens a connection: the permissions live behind the API.
 */
const config: NextConfig = {
  transpilePackages: ['@chat/contracts'],
  // Development only: Next's badge sits bottom-left by default — on the profile menu.
  devIndicators: { position: 'bottom-right' },
  // The Docker image serves a self-contained server: `next build` then traces what it
  // needs into `.next/standalone`, from the root of the monorepo so that the workspace
  // packages come along. Off elsewhere: `next start` does not serve a standalone build.
  ...(process.env.CHAT_WEB_STANDALONE === '1'
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
      }
    : {}),
  // No `env` block for CHAT_API_URL: Next would freeze its build-time value into the
  // image. The layouts read it at each request and hand it to the browser.
}

export default config
