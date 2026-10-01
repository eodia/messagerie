'use client'

import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/tooltip'
import { $t, formatCount } from '@/lib/i18n'
import type { Metadata, MetadataValue } from '@chat/contracts'
import { Check, Pencil, Plus, X } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'

/**
 * Metadata, as a list of keys and values an agent reads, corrects and completes: what the
 * page attached (`MessagerieChat.setConversationData`…) or a colleague noted. Never
 * checked — the inbox says so where it shows them.
 */

const shown = (value: MetadataValue): string =>
  typeof value === 'boolean'
    ? value
      ? $t('Oui')
      : $t('Non')
    : typeof value === 'number'
      ? formatCount(value)
      : value

/** An edited value keeps its kind: a number stays one, yes or no stays one. */
function parsed(text: string, before: MetadataValue | undefined): MetadataValue {
  const trimmed = text.trim()
  if (typeof before === 'number') {
    const number = Number(trimmed.replace(',', '.'))
    return Number.isFinite(number) ? number : trimmed
  }
  if (typeof before === 'boolean') return /^(oui|true|1|yes)$/i.test(trimmed)
  return trimmed
}

const field =
  'h-7 w-full min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25'

export function MetadataList({
  data,
  onChange,
  empty,
}: {
  readonly data: Metadata
  /** A key with a value is set, a key with null removed; resolves false when refused. */
  readonly onChange: (patch: Readonly<Record<string, MetadataValue | null>>) => Promise<boolean>
  readonly empty: string
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const entries = Object.entries(data)

  async function saveEdit(name: string) {
    if (await onChange({ [name]: parsed(draft, data[name]) })) setEditing(null)
  }

  async function add() {
    const name = key.trim()
    if (!name || !value.trim()) return
    if (await onChange({ [name]: parsed(value, undefined) })) {
      setKey('')
      setValue('')
      setAdding(false)
    }
  }

  const onKeys = (save: () => void, cancel: () => void) => (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      save()
    } else if (event.key === 'Escape') cancel()
  }

  return (
    <div className="space-y-2">
      {entries.length === 0 && !adding && <p className="text-xs text-muted-foreground">{empty}</p>}
      {entries.length > 0 && (
        <dl className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
          {entries.map(([name, current]) => (
            <div key={name} className="group contents">
              <dt className="truncate text-muted-foreground" title={name}>
                {name}
              </dt>
              <dd className="flex min-w-0 items-center gap-1">
                {editing === name ? (
                  <>
                    <input
                      // biome-ignore lint/a11y/noAutofocus: the field the agent just asked to edit
                      autoFocus
                      aria-label={name}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={onKeys(
                        () => void saveEdit(name),
                        () => setEditing(null),
                      )}
                      className={field}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      aria-label={$t('Enregistrer')}
                      onClick={() => void saveEdit(name)}
                    >
                      <Check className="size-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 break-words">{shown(current)}</span>
                    <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                      <Hint label={$t('Modifier')}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-6"
                          onClick={() => {
                            setEditing(name)
                            setDraft(
                              typeof current === 'boolean' ? shown(current) : String(current),
                            )
                          }}
                        >
                          <Pencil className="size-3 text-muted-foreground" />
                        </Button>
                      </Hint>
                      <Hint label={$t('Retirer')}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-6"
                          onClick={() => void onChange({ [name]: null })}
                        >
                          <X className="size-3 text-muted-foreground" />
                        </Button>
                      </Hint>
                    </span>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {adding ? (
        <div className="flex items-center gap-1.5">
          <input
            // biome-ignore lint/a11y/noAutofocus: the field the agent just asked to fill
            autoFocus
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={onKeys(
              () => void add(),
              () => setAdding(false),
            )}
            placeholder={$t('Donnée')}
            aria-label={$t('Nom de la donnée')}
            maxLength={60}
            className={`${field} w-28 flex-none`}
          />
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeys(
              () => void add(),
              () => setAdding(false),
            )}
            placeholder={$t('Valeur')}
            aria-label={$t('Valeur')}
            maxLength={500}
            className={field}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={$t('Ajouter')}
            onClick={() => void add()}
          >
            <Check className="size-3.5" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
          {$t('Ajouter une donnée')}
        </button>
      )}
    </div>
  )
}
