'use client'

import { Button } from '@/components/ui/button'
import { $t } from '@/lib/i18n'
import { useAlertSettings } from '@/lib/store/alert-settings'
import { BellRing, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const DISMISSED = 'chat.desktop-invite'

/**
 * The desktop's notifications, offered once: off by default — a browser asks only after a
 * click —, and found in the account menu by those who look. Hidden for good once answered,
 * in this browser.
 */
export function DesktopInvite() {
  const { desktop, permission, setDesktop } = useAlertSettings()
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED) === '1')
    } catch {
      setDismissed(false)
    }
  }, [])
  if (dismissed || desktop || permission === 'denied' || permission === 'unsupported') return null
  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(DISMISSED, '1')
    } catch {
      // A blocked storage asks again next time, nothing worse.
    }
  }
  return (
    <div className="flex shrink-0 items-start gap-2.5 border-t bg-muted/40 px-3 py-2.5">
      <BellRing className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-xs">
          {$t(
            'Être prévenu par Windows ou macOS quand un visiteur écrit, même dans un autre onglet.',
          )}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => void setDesktop(true).finally(dismiss)}
        >
          {$t('Activer les notifications')}
        </Button>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6"
        aria-label={$t('Plus tard')}
        onClick={dismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}
