'use client'

import { Chip } from '@/components/app/chip'
import { RowsSkeleton } from '@/components/app/skeletons'
import { Switch } from '@/components/ui/switch'
import { Hint } from '@/components/ui/tooltip'
import { ApiFailure, api } from '@/lib/api'
import { $t, intlLocale } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import type { PageAction } from '@chat/contracts'
import { MousePointerClick } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * What the site's pages declared they can do (D21), and what the AI may ask of them: off
 * until allowed here; « Accord du visiteur » asks the visitor first — on by default for
 * what changes the page.
 */
export function PageActions({ siteId }: { readonly siteId: string }) {
  const [actions, setActions] = useState<readonly PageAction[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setActions(null)
    api.pageActions(siteId).then(
      (list) => alive && setActions(list),
      (failure) =>
        alive &&
        setError(messageFor(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR')),
    )
    return () => {
      alive = false
    }
  }, [siteId])

  const change = async (action: PageAction, patch: { enabled?: boolean; confirm?: boolean }) => {
    try {
      const saved = await api.setPageAction(action.id, patch)
      setActions((list) => list?.map((a) => (a.id === saved.id ? saved : a)) ?? null)
    } catch (failure) {
      setError(messageFor(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR'))
    }
  }

  const seen = new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' })

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">{$t('Ce que les pages du site savent faire')}</div>
        <p className="text-xs text-muted-foreground">
          {$t(
            'Déclarées par les pages avec registerAction. L’IA ne s’en sert qu’une fois l’action autorisée, et seulement sur la page qui la déclare.',
          )}
        </p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {actions === null && !error && <RowsSkeleton rows={3} avatar={false} />}
      {actions?.length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
          <MousePointerClick className="mt-0.5 size-4 shrink-0" />
          {$t(
            'Aucune pour l’instant : elles apparaissent ici quand une page du site en déclare, au premier message d’un visiteur.',
          )}
        </div>
      )}
      <ul className="divide-y rounded-lg border">
        {actions?.map((action) => (
          <li key={action.id} className="space-y-2 px-3 py-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{action.label}</span>
                  <Chip tint={action.kind === 'read' ? 'sky' : 'violet'}>
                    {action.kind === 'read' ? $t('Lecture') : $t('Change la page')}
                  </Chip>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">{action.name}</div>
              </div>
              <Hint
                label={action.enabled ? $t('L’IA peut la demander') : $t('L’IA ne la voit pas')}
              >
                <Switch
                  checked={action.enabled}
                  onCheckedChange={(enabled) => void change(action, { enabled })}
                  aria-label={$t('Autoriser « {label} »', { label: action.label })}
                />
              </Hint>
            </div>
            {action.description && (
              <p className="text-xs text-muted-foreground">{action.description}</p>
            )}
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <label className="flex items-center gap-2" htmlFor={`confirm-${action.id}`}>
                <Switch
                  id={`confirm-${action.id}`}
                  checked={action.confirm}
                  onCheckedChange={(confirm) => void change(action, { confirm })}
                  className="scale-90"
                />
                {$t('Accord du visiteur avant d’agir')}
              </label>
              <span>{$t('Vue le {date}', { date: seen.format(new Date(action.lastSeenAt)) })}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
