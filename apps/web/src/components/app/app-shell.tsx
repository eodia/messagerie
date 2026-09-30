'use client'

import { TooltipProvider } from '@/components/ui/tooltip'
import { showWaiting, unlockSound } from '@/lib/alerts'
import { configureApi } from '@/lib/api'
import { configureBasedbSession } from '@/lib/basedb-session'
import { useAlertSettings } from '@/lib/store/alert-settings'
import { useInbox, waitingCount } from '@/lib/store/inbox'
import { useSidebar } from '@/lib/store/sidebar'
import { useTheme } from '@/lib/theme'
import { useRouter } from 'next/navigation'
import { type ReactNode, createContext, useContext, useEffect, useSyncExternalStore } from 'react'
import { Sidebar } from './sidebar'

const never = () => () => undefined

/** Where basedb answers — the « Messagerie » base and its settings live there. */
const BasedbUrl = createContext('')

export const useBasedbUrl = (): string => useContext(BasedbUrl)

/**
 * The frame of every screen: the sidebar, and the screen beside it.
 *
 * Drawn in the browser only, as basedb draws its application: times are shown in the
 * reader's time zone and the theme comes from their storage, neither of which the server
 * knows — anything it drew would have to be redrawn.
 *
 * It runs what every screen shares: the live stream of the inbox, the alerts, and the
 * count on the tab.
 */
export function AppShell({
  apiUrl,
  basedbUrl,
  basedbApiUrl,
  children,
}: {
  readonly apiUrl: string
  readonly basedbUrl: string
  /** basedb's API, where the agent's session gives a token; null runs without basedb. */
  readonly basedbApiUrl: string | null
  readonly children: ReactNode
}) {
  // Before any child renders: their first request goes to the right address.
  configureApi(apiUrl)
  configureBasedbSession(basedbApiUrl)
  const router = useRouter()
  const inBrowser = useSyncExternalStore(
    never,
    () => true,
    () => false,
  )

  useEffect(() => {
    useSidebar.getState().initialize()
    useAlertSettings.getState().initialize()
    const stopTheme = useTheme.getState().initialize()
    const stopUnlock = unlockSound()
    // The live stream runs on every screen: the sidebar counts what waits, the bell rings.
    const stopInbox = useInbox.getState().start()
    const stopBadge = useInbox.subscribe((state) => showWaiting(waitingCount(state)))
    return () => {
      stopTheme()
      stopUnlock()
      stopInbox()
      stopBadge()
    }
  }, [])

  useEffect(() => {
    useInbox.getState().setNavigator((path) => {
      if (!window.location.pathname.startsWith(path)) router.push(path)
    })
  }, [router])

  if (!inBrowser) return null
  return (
    <BasedbUrl.Provider value={basedbUrl}>
      <TooltipProvider delayDuration={300}>
        <div className="flex h-screen overflow-hidden bg-background">
          <Sidebar basedbUrl={basedbUrl} />
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>
      </TooltipProvider>
    </BasedbUrl.Provider>
  )
}
