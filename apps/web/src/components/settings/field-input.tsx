'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { $t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { SettingsField } from '@chat/contracts'
import { Check, ChevronDown } from 'lucide-react'
import { isColorField } from './views'

/** A row another field may point at, by its id, as the form names it. */
export interface Choice {
  readonly id: string
  readonly label: string
}

/** What the form knows beyond the field: the rows a relation offers, the accounts. */
export interface Choices {
  readonly rowsOf: (table: string) => readonly Choice[]
  readonly users: readonly Choice[]
}

const NONE = '__none__'

/**
 * One choice among many, in a menu — never a native `<select>`: its popup is drawn by the
 * system, ignores the theme and reads as a white box in the dark (basedb's rule).
 */
function ChoiceMenu({
  id,
  value,
  choices,
  onChange,
  allowNone,
  disabled,
}: {
  readonly id: string
  readonly value: string | null
  readonly choices: readonly Choice[]
  readonly onChange: (value: string | null) => void
  readonly allowNone: boolean
  readonly disabled: boolean
}) {
  const chosen = choices.find((c) => c.id === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="h-9 w-full justify-between px-3 font-normal"
        >
          <span className={cn('truncate', !chosen && 'text-muted-foreground')}>
            {chosen?.label ?? (value ? value : $t('Aucun'))}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        <DropdownMenuRadioGroup
          value={value ?? NONE}
          onValueChange={(next) => onChange(next === NONE ? null : next)}
        >
          {allowNone && <DropdownMenuRadioItem value={NONE}>{$t('Aucun')}</DropdownMenuRadioItem>}
          {choices.map((choice) => (
            <DropdownMenuRadioItem key={choice.id} value={choice.id}>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Several choices, all in view: pills that toggle. */
function Toggles({
  value,
  choices,
  onChange,
  disabled,
}: {
  readonly value: readonly string[]
  readonly choices: readonly Choice[]
  readonly onChange: (value: string[]) => void
  readonly disabled: boolean
}) {
  if (choices.length === 0) {
    return <p className="text-xs text-muted-foreground">{$t('Rien à choisir pour l’instant.')}</p>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {choices.map((choice) => {
        const on = value.includes(choice.id)
        return (
          <button
            key={choice.id}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() =>
              onChange(on ? value.filter((v) => v !== choice.id) : [...value, choice.id])
            }
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors disabled:opacity-50',
              on
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {on && <Check className="size-3" />}
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}

const asText = (value: unknown) => (typeof value === 'string' ? value : '')
const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

export function FieldInput({
  id,
  field,
  value,
  onChange,
  choices,
  disabled,
}: {
  readonly id: string
  readonly field: SettingsField
  readonly value: unknown
  readonly onChange: (value: unknown) => void
  readonly choices: Choices
  readonly disabled: boolean
}) {
  switch (field.kind) {
    case 'long_text':
      return (
        <Textarea
          id={id}
          value={asText(value)}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          rows={/Contenu|Consignes|Description pour|Paramètres/.test(field.label) ? 8 : 3}
          className={/Paramètres|En-têtes/.test(field.label) ? 'font-mono text-xs' : undefined}
        />
      )
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : Number(event.target.value))
          }
          disabled={disabled}
          className="w-40"
        />
      )
    case 'boolean':
      return (
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
          disabled={disabled}
        />
      )
    case 'date':
      return (
        <Input
          id={id}
          type="date"
          value={asText(value)}
          onChange={(event) => onChange(event.target.value || null)}
          disabled={disabled}
          className="w-48"
        />
      )
    case 'select': {
      const options = field.options.map((o) => ({ id: o, label: o }))
      const short = options.length <= 4 && options.every((o) => o.label.length <= 24)
      return short && field.required ? (
        <Segmented
          aria-label={field.label}
          value={asText(value)}
          onValueChange={(next) => onChange(next)}
          options={options.map((o) => ({ value: o.id, label: o.label }))}
          disabled={disabled}
          className="w-full"
        />
      ) : (
        <ChoiceMenu
          id={id}
          value={asText(value) || null}
          choices={options}
          onChange={onChange}
          allowNone={!field.required}
          disabled={disabled}
        />
      )
    }
    case 'multi_select':
      return (
        <Toggles
          value={asList(value)}
          choices={field.options.map((o) => ({ id: o, label: o }))}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'link':
      return (
        <ChoiceMenu
          id={id}
          value={asText(value) || null}
          choices={choices.rowsOf(field.target ?? '')}
          onChange={onChange}
          allowNone
          disabled={disabled}
        />
      )
    case 'multi_link':
      return (
        <Toggles
          value={asList(value)}
          choices={choices.rowsOf(field.target ?? '')}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'user':
      return (
        <ChoiceMenu
          id={id}
          value={asText(value) || null}
          choices={choices.users}
          onChange={onChange}
          allowNone
          disabled={disabled}
        />
      )
    default:
      return isColorField(field.label) ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={$t('Choisir la couleur')}
            value={/^#[0-9a-f]{6}$/i.test(asText(value)) ? asText(value) : '#000000'}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            disabled={disabled}
            className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
          />
          <Input
            id={id}
            value={asText(value)}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            className="w-32 font-mono uppercase"
            maxLength={7}
          />
        </div>
      ) : (
        <Input
          id={id}
          type={field.kind === 'url' ? 'url' : 'text'}
          value={asText(value)}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
      )
  }
}
