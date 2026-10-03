'use client'

import { RowsSkeleton, ScreenSkeletonFor } from '@/components/app/skeletons'
import { NewMessageDialog } from '@/components/inbox/new-message'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { showWaiting, unlockSound } from '@/lib/alerts'
import { configureApi } from '@/lib/api'
import { useAlertSettings } from '@/lib/store/alert-settings'
import { useInbox, waitingCount } from '@/lib/store/inbox'
import { isPaletteKey, usePalette } from '@/lib/store/palette'
import { useSession } from '@/lib/store/session'
import { useSidebar } from '@/lib/store/sidebar'
import { useTheme } from '@/lib/theme'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useSyncExternalStore } from 'react'
import { CommandPalette } from './command-palette'
import { Sidebar } from './sidebar'
import { SignInScreen } from './sign-in'

const never = () => () => undefined

/**
 * The frame of every screen: the sidebar, and the screen beside it.
 *
 * Drawn in the browser only: times are shown in the
 * reader's time zone and the theme comes from their storage, neither of which the server
 * knows — anything it drew would have to be redrawn.
 *
 * It runs what every screen shares: the live stream of the inbox, the alerts, and the
 * count on the tab — once someone is signed in; until then, the sign-in (D19).
 */
export function AppShell({
  apiUrl,
  children,
}: {
  readonly apiUrl: string
  readonly children: ReactNode
}) {
  // Before any child renders: their first request goes to the right address.
  configureApi(apiUrl)
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
    void useAlertSettings.getState().loadChannels()
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
      // On its screen already: the screen writes its address as it changes.
      const section = `/${path.split('/')[1] ?? ''}`
      const here = window.location.pathname
      if (here === section || here.startsWith(`${section}/`)) return
      router.push(path)
    })
  }, [router])

  if (!inBrowser) return null
  if (status === 'checking') {
    return (
      <div className="flex h-screen bg-background">
        <div className="w-64 shrink-0 space-y-4 border-r p-3">
          <Skeleton className="h-10 w-full" />
          <RowsSkeleton rows={6} avatar={false} className="p-0" />
        </div>
        <ScreenSkeletonFor pathname={window.location.pathname} />
      </div>
    )
  }
  if (status === 'signed-out') {
    // The sign-in screen's glimpse of the inbox draws its rows, hints included.
    return (
      <TooltipProvider delayDuration={300}>
        <SignInScreen />
      </TooltipProvider>
    )
  }
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
      <CommandPalette />
      <NewMessageDialog />
    </TooltipProvider>
  )
}
