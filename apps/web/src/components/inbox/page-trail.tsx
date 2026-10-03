'use client'

import { Chip } from '@/components/app/chip'
import { Hint } from '@/components/ui/tooltip'
import { $t, intlLocale } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { cn } from '@/lib/utils'
import type { Conversation, PageVisit } from '@chat/contracts'
import { ExternalLink } from 'lucide-react'

/**
 * Where the visitor is on the site (D21): the page open in their browser now, and the ones
 * they went through while the conversation lived — as their widget says it, never checked.
 */

/** The page the visitor has open now — the newest, when they have several tabs. */
export const pageNow = (conversation: Pick<Conversation, 'pages'>): PageVisit | null =>
  conversation.pages.find((p) => p.leftAt === null) ?? null

/** `/devis/auto?etape=2`, the address without its site — or the site, for its home. */
function pathOf(url: string): string {
  try {
    const { host, pathname, search } = new URL(url)
    const path = `${pathname}${search}`
    return path === '/' ? host : path
  } catch {
    return url
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** How long: « 40 s », « 6 min », « 2 h ». */
function lasted(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return $t('{count} s', { count: seconds })
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return $t('{count} min', { count: minutes })
  return $t('{count} h', { count: Math.round(minutes / 60) })
}

const clock = (iso: string) =>
  new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )

/** The page, as a link that opens it in a new tab: its title, else its address. */
function PageLink({ page, className }: { readonly page: PageVisit; readonly className?: string }) {
  return (
    <Hint label={page.url}>
      <a
        href={page.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'group/link inline-flex min-w-0 items-center gap-1 hover:underline',
          className,
        )}
      >
        <span className="truncate">{page.title || pathOf(page.url)}</span>
        <ExternalLink className="size-3 shrink-0 opacity-0 group-hover/link:opacity-60" />
      </a>
    </Hint>
  )
}

/**
 * Under the contact: where they are now — or where they were last, and since when.
 * Nothing for a conversation whose visitor's widget never said a page.
 */
export function PageNowLine({ conversation }: { readonly conversation: Conversation }) {
  const now = useInbox((s) => s.now)
  const open = pageNow(conversation)
  const last = conversation.pages[0]
  if (!open && !last) return null
  return (
    <div className="-mx-1.5 flex h-7 items-center gap-2.5 rounded-md px-1.5 text-[13px]">
      <span
        className={cn(
          'relative flex size-3.5 shrink-0 items-center justify-center',
          !open && 'opacity-60',
        )}
        aria-hidden="true"
      >
        {open && <span className="absolute size-2.5 animate-ping rounded-full bg-emerald-500/40" />}
        <span
          className={cn('size-2 rounded-full', open ? 'bg-emerald-500' : 'bg-muted-foreground/50')}
        />
      </span>
      {open ? (
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="shrink-0 text-muted-foreground">{$t('Sur')}</span>
          <PageLink page={open} className="font-medium" />
        </span>
      ) : last ? (
        <span className="flex min-w-0 flex-1 items-center gap-1 text-muted-foreground">
          <span className="shrink-0">
            {$t('Dernière page, il y a {time} :', {
              time: lasted(now.getTime() - new Date(last.leftAt ?? last.at).getTime()),
            })}
          </span>
          <PageLink page={last} />
        </span>
      ) : null}
    </div>
  )
}

/** The pages the visitor went through, newest first: when, which, how long. */
export function PageTrail({ conversation }: { readonly conversation: Conversation }) {
  const pages = conversation.pages
  if (pages.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        {$t(
          'Le widget dit ici les pages que le visiteur ouvre, une fois la conversation commencée.',
        )}
      </p>
    )
  }
  return (
    <ol className="space-y-0.5">
      {pages.map((page) => (
        <li
          key={`${page.at}-${page.url}`}
          className="-mx-1.5 flex items-start gap-2.5 rounded-md px-1.5 py-1 text-xs hover:bg-muted/60"
        >
          <span className="mt-px w-10 shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {clock(page.at)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <PageLink page={page} className="font-medium" />
            <span className="truncate text-[11px] text-muted-foreground">
              {hostOf(page.url)}
              {pathOf(page.url) !== hostOf(page.url) && pathOf(page.url)}
            </span>
          </span>
          {page.leftAt === null ? (
            <Chip tint="emerald" className="mt-px">
              {$t('maintenant')}
            </Chip>
          ) : (
            <span className="mt-px shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {lasted(new Date(page.leftAt).getTime() - new Date(page.at).getTime())}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}
