'use client'

import { TooltipProvider } from '@/components/ui/tooltip'
import { configureApi } from '@/lib/api'
import { useInbox } from '@/lib/store/inbox'
import { useSidebar } from '@/lib/store/sidebar'
import { useTheme } from '@/lib/theme'
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
 */
export function AppShell({
  apiUrl,
  basedbUrl,
  children,
}: {
  readonly apiUrl: string
  readonly basedbUrl: string
  readonly children: ReactNode
}) {
  // Before any child renders: their first request goes to the right address.
  configureApi(apiUrl)
  const inBrowser = useSyncExternalStore(
    never,
    () => true,
    () => false,
  )

  useEffect(() => {
    useSidebar.getState().initialize()
    const stopTheme = useTheme.getState().initialize()
    // The live stream runs on every screen: the sidebar counts what waits.
    const stopInbox = useInbox.getState().start()
    return () => {
      stopTheme()
      stopInbox()
    }
  }, [])

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
