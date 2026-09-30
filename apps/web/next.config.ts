import type { NextConfig } from 'next'

/**
 * The inbox speaks HTTP and WebSocket to the chat server, and HTTP to basedb — never
 * PostgreSQL. No server action opens a connection: the permissions live behind the API.
 */
const config: NextConfig = {
  transpilePackages: ['@chat/contracts'],
  // Development only: Next's badge sits bottom-left by default — on the profile menu.
  devIndicators: { position: 'bottom-right' },
}

export default config
