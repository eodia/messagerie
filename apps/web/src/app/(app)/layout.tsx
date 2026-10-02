import { AppShell } from '@/components/app/app-shell'
import type { ReactNode } from 'react'

/** Read at each request, not frozen at build time: the image serves any instance. */
export const dynamic = 'force-dynamic'

export default function AppLayout({ children }: { readonly children: ReactNode }) {
  // `||`, not `??`: an empty variable in a `.env` file means unset.
  const apiUrl = process.env.CHAT_API_URL || 'http://localhost:8810'
  return <AppShell apiUrl={apiUrl}>{children}</AppShell>
}
