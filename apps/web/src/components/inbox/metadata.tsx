'use client'

import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Hint } from '@/components/ui/tooltip'
import { $t, formatCount } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { Metadata, MetadataValue } from '@chat/contracts'
import { Plus, X } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'

/**
 * Metadata, as a list of keys and values an agent reads, corrects and completes: what the
 * page attached (`MessagerieChat.setConversationData`…) or a colleague noted. Never
 * checked — the inbox says so where it shows them.
 *
 * The panel is narrow: a value is edited where it is, on the whole width, and a new one is
 * written in two stacked fields — never two cramped inputs side by side.
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

const input =
  'w-full min-w-0 rounded-md border bg-background px-2.5 py-1.5 text-[13px] outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25'

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
  const [busy, setBusy] = useState(false)
  const entries = Object.entries(data)

  async function saveEdit(name: string) {
    if (draft.trim() === '') return
    setBusy(true)
    if (await onChange({ [name]: parsed(draft, data[name]) })) setEditing(null)
    setBusy(false)
  }

  async function add() {
    const name = key.trim()
    if (!name || !value.trim()) return
    setBusy(true)
    if (await onChange({ [name]: parsed(value, data[name]) })) {
      setKey('')
      setValue('')
      setAdding(false)
    }
    setBusy(false)
  }

  /** Enter saves, Shift+Enter goes to the line, Escape gives up. */
  const onKeys = (save: () => void, cancel: () => void) => (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  return (
    <div className="space-y-1.5">
      {entries.length === 0 && !adding && <p className="text-xs text-muted-foreground">{empty}</p>}

      {entries.length > 0 && (
        <ul className="-mx-1.5 space-y-0.5">
          {entries.map(([name, current]) =>
            editing === name ? (
              <li key={name} className="space-y-1.5 rounded-lg border bg-muted/30 p-2">
                <div className="truncate px-0.5 text-[11px] font-medium text-muted-foreground">
                  {name}
                </div>
                <textarea
                  // biome-ignore lint/a11y/noAutofocus: the value the agent just asked to edit
                  autoFocus
                  rows={1}
                  aria-label={name}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onKeys(
                    () => void saveEdit(name),
                    () => setEditing(null),
                  )}
                  onFocus={(event) => event.currentTarget.select()}
                  maxLength={500}
                  className={cn(input, 'field-sizing-content max-h-40 resize-none')}
                />
                <Actions
                  busy={busy}
                  disabled={draft.trim() === ''}
                  onSave={() => void saveEdit(name)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li
                key={name}
                className="group flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50"
              >
                <span className="w-2/5 shrink-0 truncate pt-px text-xs text-muted-foreground">
                  <Hint label={name}>
                    <span>{name}</span>
                  </Hint>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false)
                    setEditing(name)
                    setDraft(typeof current === 'boolean' ? shown(current) : String(current))
                  }}
                  aria-label={$t('Modifier {name}', { name })}
                  className="min-w-0 flex-1 cursor-text rounded-sm text-left text-xs break-words hover:underline hover:decoration-muted-foreground/40 hover:underline-offset-4"
                >
                  {shown(current)}
                </button>
                <Hint label={$t('Retirer')}>
                  <button
                    type="button"
                    aria-label={$t('Retirer {name}', { name })}
                    onClick={() => void onChange({ [name]: null })}
                    className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </Hint>
              </li>
            ),
          )}
        </ul>
      )}

      {adding ? (
        <div className="space-y-1.5 rounded-lg border bg-muted/30 p-2">
          <input
            // biome-ignore lint/a11y/noAutofocus: the field the agent just asked to fill
            autoFocus
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={onKeys(
              () => void add(),
              () => setAdding(false),
            )}
            placeholder={$t('Nom — « Numéro de contrat »')}
            aria-label={$t('Nom de la donnée')}
            maxLength={60}
            className={input}
          />
          <textarea
            rows={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeys(
              () => void add(),
              () => setAdding(false),
            )}
            placeholder={$t('Valeur')}
            aria-label={$t('Valeur')}
            maxLength={500}
            className={cn(input, 'field-sizing-content max-h-40 resize-none')}
          />
          {key.trim() !== '' && data[key.trim()] !== undefined && (
            <p className="px-0.5 text-[11px] text-amber-700 dark:text-amber-400">
              {$t('Cette donnée existe : sa valeur sera remplacée.')}
            </p>
          )}
          <Actions
            busy={busy}
            disabled={!key.trim() || !value.trim()}
            label={$t('Ajouter')}
            onSave={() => void add()}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditing(null)
            setAdding(true)
          }}
          className="-mx-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
          {$t('Ajouter une donnée')}
        </button>
      )}
    </div>
  )
}

function Actions({
  busy,
  disabled,
  label = $t('Enregistrer'),
  onSave,
  onCancel,
}: {
  readonly busy: boolean
  readonly disabled: boolean
  readonly label?: string
  readonly onSave: () => void
  readonly onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex flex-1 items-center gap-1 truncate px-0.5 text-[10px] text-muted-foreground">
        <Kbd>↵</Kbd>
        {$t('valider')}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={onCancel}
      >
        {$t('Annuler')}
      </Button>
      <Button
        type="button"
        size="sm"
        className="h-7 px-2.5 text-xs"
        disabled={busy || disabled}
        onClick={onSave}
      >
        {label}
      </Button>
    </div>
  )
}
