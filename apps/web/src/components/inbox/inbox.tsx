'use client'

import { Chip } from '@/components/app/chip'
import { EmptyState } from '@/components/app/empty-state'
import { ScreenHeader, Slash } from '@/components/app/screen-header'
import { Button } from '@/components/ui/button'
import { Kbd, useModKey } from '@/components/ui/kbd'
import { Hint } from '@/components/ui/tooltip'
import { apiAddress } from '@/lib/api'
import { $t } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { useInbox } from '@/lib/store/inbox'
import { Bell, LoaderCircle, MessagesSquare, RefreshCw, Search, Unplug, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ConversationList } from './conversation-list'
import { DetailsPanel } from './details-panel'
import { Thread } from './thread'

/** The agents' inbox: the conversations, the one open, and what is known of it. */
export function Inbox() {
  const loading = useInbox((s) => s.loading)
  const loadError = useInbox((s) => s.loadError)
  const live = useInbox((s) => s.live)
  const selectedId = useInbox((s) => s.selectedId)
  const detail = useInbox((s) => s.detail)
  const summary = useInbox((s) => s.summaries.find((c) => c.id === s.selectedId))
  const error = useInbox((s) => s.error)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const searchRef = useRef<HTMLInputElement>(null)
  const mod = useModKey()

  // Ctrl+K (⌘K) goes to the search, by the physical key so that it works on any layout.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyK' || event.key === 'k')) {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  const header = (
    <ScreenHeader
      tools={
        <>
          {live !== 'open' && !loadError && (
            <Hint label={$t('Les nouveaux messages arriveront dès la reconnexion.')}>
              <span>
                <Chip tint="amber">
                  <Unplug />
                  {$t('Reconnexion…')}
                </Chip>
              </span>
            </Hint>
          )}
          <button
            type="button"
            onClick={() => searchRef.current?.focus()}
            className="hidden h-8 w-64 items-center gap-2 rounded-lg border bg-muted/40 px-2.5 text-xs text-muted-foreground shadow-xs transition-colors hover:bg-muted md:flex"
          >
            <Search className="size-3.5" />
            <span className="flex-1 text-left">{$t('Rechercher…')}</span>
            <Kbd>{mod}</Kbd>
            <Kbd>K</Kbd>
          </button>
          <Hint label={$t('Notifications')}>
            <Button variant="ghost" size="icon-sm">
              <Bell className="text-muted-foreground" />
            </Button>
          </Hint>
        </>
      }
    >
      <span className="font-medium">{$t('Conversations')}</span>
      {summary && (
        <>
          <Slash />
          <span className="truncate text-muted-foreground">{summary.contact.name}</span>
        </>
      )}
    </ScreenHeader>
  )

  if (loading || loadError) {
    return (
      <>
        {header}
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {$t('Chargement des conversations…')}
          </div>
        ) : (
          <EmptyState
            icon={Unplug}
            title={$t('La messagerie est injoignable')}
            actions={
              <Button variant="outline" onClick={() => void useInbox.getState().reload()}>
                <RefreshCw />
                {$t('Réessayer')}
              </Button>
            }
          >
            <p>{messageFor(loadError ?? '')}</p>
            <p className="mt-2 font-mono text-xs">{apiAddress()}</p>
          </EmptyState>
        )}
      </>
    )
  }

  return (
    <>
      {header}
      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          <span className="flex-1">{messageFor(error)}</span>
          <Hint label={$t('Fermer')}>
            <button
              type="button"
              onClick={() => useInbox.getState().dismissError()}
              className="rounded p-0.5 hover:bg-destructive/10"
            >
              <X className="size-4" />
            </button>
          </Hint>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ConversationList searchRef={searchRef} />
        {detail ? (
          <>
            <Thread
              conversation={detail}
              detailsOpen={detailsOpen}
              onToggleDetails={() => setDetailsOpen((open) => !open)}
            />
            {detailsOpen && <DetailsPanel conversation={detail} />}
          </>
        ) : selectedId ? (
          <div className="flex flex-1 items-center justify-center bg-surface">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <EmptyState icon={MessagesSquare} title={$t('Aucune conversation ouverte')}>
            {$t('Choisissez une conversation dans la liste pour la lire et y répondre.')}
          </EmptyState>
        )}
      </div>
    </>
  )
}
