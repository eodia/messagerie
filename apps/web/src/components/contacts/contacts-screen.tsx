'use client'

import { Chip } from '@/components/app/chip'
import { EmptyState } from '@/components/app/empty-state'
import { Flag } from '@/components/app/flag'
import { ScreenHeader } from '@/components/app/screen-header'
import { ContactAvatar, StatusChip } from '@/components/inbox/labels'
import { Hint } from '@/components/ui/tooltip'
import { addressOf, wordOf, wordsAfter } from '@/lib/address'
import { api } from '@/lib/api'
import { $t, $tp } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { clockOf, whereInFull, whereOf } from '@/lib/place'
import { useInbox } from '@/lib/store/inbox'
import { dayLabel, inboxTime } from '@/lib/time'
import { useTitle } from '@/lib/title'
import { useAddressBar } from '@/lib/use-address-bar'
import { cn } from '@/lib/utils'
import type { ContactDetail, ContactListItem } from '@chat/contracts'
import { LoaderCircle, MapPin, Search, ShieldCheck, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ContactsMap, type MapPoint } from './contacts-map'

const BASE = '/contacts'
/** The map left visible above a contact's sheet. */
const BAND = 184

/** The contact the address names — its word, or an id as the palette once wrote it. */
function contactInAddress(): string | null {
  return wordsAfter(BASE)?.[0] ?? new URLSearchParams(window.location.search).get('contact') ?? null
}

/**
 * The visitors, anonymous then signed in by their site: who they are, where they are, what
 * the site says of them, their conversations — one click away from each. Behind, the map
 * of where they are (D18), which flies to the contact one opens.
 */
export function ContactsScreen() {
  const now = useInbox((s) => s.now)
  const site = useInbox((s) => s.site)
  const [query, setQuery] = useState('')
  const [contacts, setContacts] = useState<ContactListItem[] | null>(null)
  // The contact the address names, open: its id, or its word until the server answers.
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : contactInAddress(),
  )
  const [detail, setDetail] = useState<ContactDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shownId = useRef<string | null>(null)

  const address =
    selected === null
      ? BASE
      : detail?.contact.id === selected
        ? addressOf(BASE, wordOf(selected, detail.contact.name, 'contact'))
        : null
  useAddressBar(address, async () => setSelected(contactInAddress()))

  const points = useMemo<MapPoint[]>(
    () =>
      (contacts ?? []).flatMap((c) => (c.place ? [{ id: c.id, name: c.name, ...c.place }] : [])),
    [contacts],
  )
  const shown = detail?.contact.id === selected ? detail : null
  const focus = useMemo<MapPoint | null>(
    () =>
      shown?.contact.place
        ? { id: shown.contact.id, name: shown.contact.name, ...shown.contact.place }
        : null,
    [shown],
  )
  useTitle([selected !== null ? detail?.contact.name : null, $t('Contacts')])

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .contacts(query, site)
        .then((list) => {
          setContacts(list)
          setError(null)
        })
        .catch((failure: { code?: string }) => setError(failure.code ?? 'INTERNAL_ERROR'))
    }, 200)
    return () => clearTimeout(timer)
  }, [query, site])

  useEffect(() => {
    if (selected === null || shownId.current === selected) return
    let stale = false
    setDetail(null)
    api
      .contact(selected)
      .then((found) => {
        if (stale) return
        // Named by its word: from now on, by its id.
        shownId.current = found.contact.id
        setDetail(found)
        setSelected(found.contact.id)
      })
      .catch((failure: { code?: string }) => {
        if (stale) return
        setError(failure.code ?? 'INTERNAL_ERROR')
        setSelected(null)
      })
    return () => {
      stale = true
    }
  }, [selected])

  return (
    <>
      <ScreenHeader>
        <span className="font-medium">{$t('Contacts')}</span>
      </ScreenHeader>
      <div className="flex min-h-0 flex-1">
        <section className="flex w-96 shrink-0 flex-col border-r">
          <div className="flex h-11 shrink-0 items-center border-b px-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={$t('Nom, e-mail ou identifiant client…')}
                className="h-8 w-full rounded-lg border bg-muted/40 pr-2 pl-8 text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
              />
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto scroll-discret">
            {contacts === null && !error && (
              <li className="flex justify-center p-8">
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              </li>
            )}
            {error && <li className="p-4 text-sm text-destructive">{messageFor(error)}</li>}
            {contacts?.map((contact) => (
              <li key={contact.id}>
                <button
                  type="button"
                  onClick={() => setSelected(contact.id)}
                  className={cn(
                    'relative flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors',
                    selected === contact.id ? 'bg-accent' : 'hover:bg-muted/50',
                  )}
                >
                  {selected === contact.id && (
                    <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
                  )}
                  <ContactAvatar name={contact.name} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{contact.name}</span>
                      {contact.country && (
                        <Hint label={whereOf(contact)}>
                          <Flag country={contact.country} className="text-[11px]" />
                        </Hint>
                      )}
                      {contact.identified && (
                        <ShieldCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {contact.email ?? (contact.identified ? '—' : $t('Visiteur anonyme'))}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {contact.lastMessageAt && (
                      <span className="block">{inboxTime(contact.lastMessageAt, now)}</span>
                    )}
                    <span className="block">
                      {$tp(contact.conversations, '{count} conversation', '{count} conversations')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {contacts?.length === 0 && (
              <li className="px-6 py-12 text-center text-sm text-muted-foreground">
                {query ? $t('Aucun contact ne correspond.') : $t('Aucun contact pour l’instant.')}
              </li>
            )}
          </ul>
        </section>

        <div className="relative min-w-0 flex-1 overflow-hidden">
          <ContactsMap
            points={points}
            focus={focus}
            band={selected === null ? null : BAND}
            onPick={setSelected}
          />
          {selected === null ? (
            <>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                <div className="pointer-events-auto rounded-xl border bg-background/90 backdrop-blur-sm">
                  <EmptyState icon={UsersRound} title={$t('Choisissez un contact')}>
                    {$t('Sa fiche, ce que son site a transmis, et ses conversations.')}
                  </EmptyState>
                </div>
              </div>
              {points.length > 0 && (
                <p className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur-sm">
                  <MapPin className="size-3" />
                  {$tp(
                    points.length,
                    '{count} contact sur la carte',
                    '{count} contacts sur la carte',
                  )}
                </p>
              )}
            </>
          ) : shown === null ? (
            <div
              className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-background"
              style={{ top: BAND }}
            >
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ContactPanel detail={shown} />
          )}
        </div>
      </div>
    </>
  )
}

function ContactPanel({ detail }: { readonly detail: ContactDetail }) {
  const { contact } = detail
  const open = useInbox((s) => s.open)
  const now = useInbox((s) => s.now)
  const clock = contact.timeZone ? clockOf(contact.timeZone, now) : null
  const where = whereInFull(contact)
  return (
    <div className="absolute inset-0 overflow-y-auto scroll-discret">
      {/* The band of map above the sheet: it lets the clicks through to the pins. */}
      <div
        className="pointer-events-none bg-linear-to-b from-transparent from-40% to-background"
        style={{ height: BAND }}
      />
      <div className="bg-background" style={{ minHeight: `calc(100% - ${BAND}px)` }}>
        <div className="mx-auto max-w-3xl space-y-6 px-6 pb-6">
          {/* The avatar on the edge of the map; the words below it. */}
          <div className="flex items-start gap-4">
            <ContactAvatar
              name={contact.name}
              className="-mt-8 size-16 shrink-0 text-lg ring-4 ring-background"
            />
            <div className="min-w-0 pt-1">
              <h1 className="truncate text-lg font-semibold tracking-tight">{contact.name}</h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
                {where && (
                  <span className="flex items-center gap-1.5">
                    {contact.country ? (
                      <Flag country={contact.country} className="text-xs" />
                    ) : (
                      <MapPin className="size-3.5" />
                    )}
                    {where}
                  </span>
                )}
                {clock && (
                  <span className="tabular-nums">
                    · {$t('{time}, heure locale', { time: clock })}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {contact.email && <span>{contact.email}</span>}
                {detail.site && <span>· {detail.site}</span>}
              </div>
              <div className="mt-2 flex gap-1.5">
                {contact.identified ? (
                  <Chip tint="emerald">
                    <ShieldCheck />
                    {$t('Identifié par le site')}
                  </Chip>
                ) : (
                  <Chip tint="zinc">{$t('Anonyme')}</Chip>
                )}
                {contact.segment && <Chip tint="zinc">{contact.segment}</Chip>}
              </div>
            </div>
          </div>

          <section className="rounded-lg border">
            <h2 className="border-b px-4 py-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {$t('Transmis par le site')}
            </h2>
            {contact.attributes.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                {contact.identified
                  ? $t('Le site n’a transmis aucun attribut.')
                  : $t('Visiteur anonyme : le site n’a transmis aucune identité signée.')}
              </p>
            ) : (
              <dl className="grid grid-cols-[minmax(0,12rem)_1fr] gap-x-4 gap-y-2 px-4 py-3 text-sm">
                {contact.attributes.map((a) => (
                  <div key={a.label} className="contents">
                    <dt className="text-muted-foreground">{a.label}</dt>
                    <dd className={cn(a.kind === 'code' && 'font-mono text-xs')}>
                      {a.kind === 'date' ? dayLabel(a.value) : a.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border">
            <h2 className="border-b px-4 py-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {$tp(detail.conversations.length, '{count} conversation', '{count} conversations')}
            </h2>
            <ul className="divide-y">
              {detail.conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{c.subject || '—'}</span>
                    <StatusChip status={c.status} />
                    <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {dayLabel(c.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
