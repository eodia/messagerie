import { AppShell } from '@/components/app/app-shell'
import type { ReactNode } from 'react'

/** Read at each request, not frozen at build time: the image serves any instance. */
export const dynamic = 'force-dynamic'

export default function AppLayout({ children }: { readonly children: ReactNode }) {
  // `||`, not `??`: an empty variable in a `.env` file means unset.
  const basedbUrl = process.env.BASEDB_URL || 'http://localhost:3000'
  const apiUrl = process.env.CHAT_API_URL || 'http://localhost:8810'
  // basedb's API, where the agent's session yields a token (D4). Unset: no basedb, the
  // chat server's development identity answers.
  const basedbApiUrl = process.env.BASEDB_API_URL || null
  return (
    <AppShell apiUrl={apiUrl} basedbUrl={basedbUrl} basedbApiUrl={basedbApiUrl}>
      {children}
    </AppShell>
  )
}
