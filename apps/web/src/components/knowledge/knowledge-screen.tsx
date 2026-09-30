'use client'

import { useBasedbUrl } from '@/components/app/app-shell'
import { ScreenHeader } from '@/components/app/screen-header'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { $t, $tp } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { dayLabel } from '@/lib/time'
import type { KnowledgeItem } from '@chat/contracts'
import { BookOpen, ExternalLink, FileText, LoaderCircle, MessagesSquare } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * What the AI answers from, as it is indexed now: basedb's published articles and promoted
 * conversations. They are written and reviewed in basedb; here, the agents see what counts.
 */
export function KnowledgeScreen() {
  const basedbUrl = useBasedbUrl()
  const [items, setItems] = useState<KnowledgeItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .knowledge()
      .then(setItems)
      .catch((failure: { code?: string }) => setError(failure.code ?? 'INTERNAL_ERROR'))
  }, [])

  const groups = [
    { source: 'article' as const, title: $t('Articles publiés'), icon: FileText },
    { source: 'conversation' as const, title: $t('Conversations promues'), icon: MessagesSquare },
  ]

  return (
    <>
      <ScreenHeader
        tools={
          <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs">
            <a href={basedbUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              {$t('Rédiger dans basedb')}
            </a>
          </Button>
        }
      >
        <span className="font-medium">{$t('Connaissance')}</span>
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-discret">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
          <div className="flex items-start gap-3 rounded-lg border bg-surface px-4 py-3">
            <BookOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {$t(
                'L’IA répond à partir de ce qui suit, et le cite. Les articles se rédigent et se publient dans basedb ; une conversation bien résolue se promeut depuis son menu ⋯, puis se relit dans basedb avant de compter. Un article dépublié quitte l’index dans la minute.',
              )}
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {messageFor(error)}
            </div>
          )}
          {items === null && !error && (
            <div className="flex justify-center py-12">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {items &&
            groups.map(({ source, title, icon: Icon }) => {
              const of = items.filter((i) => i.source === source)
              return (
                <section key={source} className="overflow-hidden rounded-lg border">
                  <header className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5">
                    <Icon className="size-4 text-muted-foreground" />
                    <h2 className="text-sm font-medium">{title}</h2>
                    <span className="text-xs text-muted-foreground">{of.length}</span>
                  </header>
                  {of.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted-foreground">
                      {items.length === 0
                        ? $t(
                            'Rien n’est indexé : sans modèle d’IA configuré, ou sans article publié.',
                          )
                        : $t('Aucun pour l’instant.')}
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {of.map((item) => (
                        <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                          <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {$tp(item.passages, '{count} passage', '{count} passages')}
                          </span>
                          <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                            {item.indexedAt ? dayLabel(item.indexedAt) : '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
        </div>
      </div>
    </>
  )
}
