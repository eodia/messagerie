'use client'

import { ColorBadge } from '@/components/app/chip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Hint } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { $t } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { cn } from '@/lib/utils'
import type { Conversation, TagOption } from '@chat/contracts'
import { Check, Plus, Search, Sparkles, X } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from 'react'

/**
 * A conversation's tags: each one taken off by its cross, others put on from the list
 * « Étiquettes » defines — searched as one types — or a new one, typed and confirmed.
 */

let optionsOnce: Promise<TagOption[]> | null = null
export function loadOptions(): Promise<TagOption[]> {
  optionsOnce ??= api.tags().catch(() => {
    optionsOnce = null
    return []
  })
  return optionsOnce
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export function Tags({ conversation }: { readonly conversation: Conversation }) {
  const { addTag, removeTag } = useInbox.getState()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {conversation.tags.map((tag) => (
        <span key={tag.label} className="group inline-flex">
          <ColorBadge color={tag.color}>
            {tag.byAi && (
              <Hint label={$t('Posée par l’IA')}>
                <Sparkles />
              </Hint>
            )}
            {tag.label}
            <button
              type="button"
              aria-label={$t('Retirer l’étiquette {label}', { label: tag.label })}
              onClick={() => void removeTag(conversation.id, tag.label)}
              className="-mr-1 ml-0.5 hidden rounded-sm opacity-70 hover:opacity-100 group-hover:inline-flex group-focus-within:inline-flex [@media(hover:none)]:inline-flex"
            >
              <X className="size-3" />
            </button>
          </ColorBadge>
        </span>
      ))}
      <TagPicker
        applied={conversation.tags.map((t) => t.label)}
        onPick={(label) => void addTag(conversation.id, label)}
        labelled={conversation.tags.length === 0}
      />
    </div>
  )
}

export function TagPicker({
  applied,
  onPick,
  labelled,
  trigger,
  hint = $t('Ajouter une étiquette'),
  align = 'start',
}: {
  readonly applied: readonly string[]
  readonly onPick: (label: string) => void
  readonly labelled: boolean
  /** What opens it, instead of the dashed « + » — a button of a toolbar. */
  readonly trigger?: ReactNode
  readonly hint?: string
  readonly align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<TagOption[]>([])
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (open) void loadOptions().then(setOptions)
    else setQuery('')
  }, [open])

  const typed = query.trim()
  const shown = useMemo(
    () => options.filter((o) => fold(o.name).includes(fold(typed))),
    [options, typed],
  )
  const exists = options.some((o) => fold(o.name) === fold(typed))
  // The list, then « Créer … » for a name it does not have.
  const choices = [
    ...shown.map((o) => o.name),
    ...(typed && !exists && !applied.includes(typed) ? [typed] : []),
  ]

  function pick(label: string) {
    if (!applied.includes(label)) onPick(label)
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((a) => Math.min(a + 1, choices.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const choice = choices[active]
      if (choice) pick(choice)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label={hint}>
        <PopoverTrigger asChild>
          {trigger ?? (
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3" />
              {labelled && $t('Étiquette')}
            </button>
          )}
        </PopoverTrigger>
      </Hint>
      <PopoverContent align={align} className="w-64 p-0">
        <div className="flex items-center gap-2 border-b px-2.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            // biome-ignore lint/a11y/noAutofocus: the field the agent just opened the list for
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={$t('Chercher ou créer…')}
            aria-label={$t('Chercher ou créer une étiquette')}
            maxLength={40}
            className="h-9 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1 scroll-discret">
          {choices.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {$t('Aucune étiquette définie : tapez un nom pour en créer une.')}
            </p>
          )}
          {choices.map((name, index) => {
            const option = options.find((o) => o.name === name)
            const on = applied.includes(name)
            return (
              <button
                key={name}
                type="button"
                onClick={() => pick(name)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-xs',
                  index === active && 'bg-accent',
                )}
              >
                <span
                  className="mt-1 size-2 shrink-0 rounded-full"
                  style={{ background: option?.color ?? '#64748b' }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {option ? name : $t('Créer « {name} »', { name })}
                  </span>
                  {option?.when && (
                    <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">
                      {option.when}
                    </span>
                  )}
                </span>
                {on && <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
