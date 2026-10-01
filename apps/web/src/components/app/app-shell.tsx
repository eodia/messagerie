'use client'

import { TooltipProvider } from '@/components/ui/tooltip'
import { showWaiting, unlockSound } from '@/lib/alerts'
import { configureApi } from '@/lib/api'
import { configureBasedbSession } from '@/lib/basedb-session'
import { useAlertSettings } from '@/lib/store/alert-settings'
import { useInbox, waitingCount } from '@/lib/store/inbox'
import { isPaletteKey, usePalette } from '@/lib/store/palette'
import { useSession } from '@/lib/store/session'
import { useSidebar } from '@/lib/store/sidebar'
import { useTheme } from '@/lib/theme'
import { LoaderCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, createContext, useContext, useEffect, useSyncExternalStore } from 'react'
import { CommandPalette } from './command-palette'
import { Sidebar } from './sidebar'
import { SignInScreen } from './sign-in'

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
 * count on the tab — once someone is signed in; until then, the sign-in (basedb's).
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

  const status = useSession((s) => s.status)

  useEffect(() => {
    useSidebar.getState().initialize()
    useAlertSettings.getState().initialize()
    const stopTheme = useTheme.getState().initialize()
    const stopUnlock = unlockSound()
    void useSession.getState().check()
    return () => {
      stopTheme()
      stopUnlock()
    }
  }, [])

  // The live stream runs on every screen, once signed in: the sidebar counts what waits,
  // the bell rings.
  useEffect(() => {
    if (status !== 'signed-in') return
    const stopInbox = useInbox.getState().start()
    const stopBadge = useInbox.subscribe((state) => showWaiting(waitingCount(state)))
    return () => {
      stopInbox()
      stopBadge()
    }
  }, [status])

  // Ctrl+K (⌘K) opens the palette, on every screen — and closes it when open.
  useEffect(() => {
    if (status !== 'signed-in') return
    function onKey(event: KeyboardEvent) {
      if (!isPaletteKey(event)) return
      event.preventDefault()
      const palette = usePalette.getState()
      if (palette.open) palette.hide()
      else palette.show()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [status])

  useEffect(() => {
    useInbox.getState().setNavigator((path) => {
      if (!window.location.pathname.startsWith(path)) router.push(path)
    })
  }, [router])

  if (!inBrowser) return null
  if (status === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (status === 'signed-out' || status === 'must-change') {
    // The sign-in screen's glimpse of the inbox draws its rows, hints included.
    return (
      <TooltipProvider delayDuration={300}>
        <SignInScreen basedbUrl={basedbUrl} />
      </TooltipProvider>
    )
  }
  return (
    <BasedbUrl.Provider value={basedbUrl}>
      <TooltipProvider delayDuration={300}>
        <div className="flex h-screen overflow-hidden bg-background">
          <Sidebar basedbUrl={basedbUrl} />
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>
        <CommandPalette />
      </TooltipProvider>
    </BasedbUrl.Provider>
  )
}
