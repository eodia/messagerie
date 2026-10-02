'use client'

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { $t } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import type { AutomationButton } from '@chat/contracts'
import { Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * The « button » automations this conversation fits (D20), in its menu — read when the
 * menu opens; nothing shown when there are none.
 */
export function AutomationItems({ conversationId }: { readonly conversationId: string }) {
  const [buttons, setButtons] = useState<readonly AutomationButton[]>([])
  useEffect(() => {
    let alive = true
    api.conversationAutomations(conversationId).then(
      (list) => alive && setButtons(list),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [conversationId])
  if (buttons.length === 0) return null
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {$t('Automatisations')}
      </DropdownMenuLabel>
      {buttons.map((button) => (
        <DropdownMenuItem
          key={button.id}
          onSelect={() =>
            api
              .runConversationAutomation(conversationId, button.id)
              .then(() =>
                useInbox.getState().say($t('« {name} » est lancée.', { name: button.name })),
              )
              .catch(useInbox.getState().fail)
          }
          className="items-start"
        >
          <Workflow className="mt-0.5" />
          <span className="min-w-0">
            <span className="block">{button.name}</span>
            {button.description && (
              <span className="block text-xs text-muted-foreground">{button.description}</span>
            )}
          </span>
        </DropdownMenuItem>
      ))}
    </>
  )
}
