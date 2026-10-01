'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SWATCHES } from '@/components/widget/widget-form'
import { $t, msg } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Check, Plus, X } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'

/**
 * The settings forms' pieces, in the widget editor's manner: a labelled field with its
 * hint, a switch with what it does, swatches, days as pills, a value on a slider, lines
 * as chips. Each says what it changes in words a supervisor uses, not basedb's.
 */

export function FormSection({
  title,
  hint,
  aside,
  children,
}: {
  readonly title: string
  readonly hint?: string
  readonly aside?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className="space-y-5 border-t px-6 py-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {title}
          </h3>
          {aside}
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </header>
      {children}
    </section>
  )
}

export function Field({
  label,
  hint,
  warn = false,
  required = false,
  children,
}: {
  readonly label: string
  readonly hint?: ReactNode
  readonly warn?: boolean
  readonly required?: boolean
  readonly children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-foreground">
        {label}
        {required && <span className="text-muted-foreground">*</span>}
      </Label>
      {children(id)}
      {hint && (
        <p
          className={cn(
            'text-xs leading-relaxed',
            warn ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        >
          {hint}
        </p>
      )}
    </div>
  )
}

export function ToggleField({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
  children,
}: {
  readonly label: string
  readonly hint: ReactNode
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly disabled?: boolean
  readonly children?: ReactNode
}) {
  const id = useId()
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={id} className="text-foreground">
            {label}
          </Label>
          <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          className="mt-0.5"
        />
      </div>
      {checked && children}
    </div>
  )
}

const HEX = /^#[0-9a-f]{6}$/i

export function ColorField({
  id,
  value,
  onChange,
  disabled = false,
}: {
  readonly id: string
  readonly value: string
  readonly onChange: (color: string) => void
  readonly disabled?: boolean
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((color) => {
          const chosen = value.toUpperCase() === color
          return (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={chosen}
              disabled={disabled}
              onClick={() => onChange(color)}
              className={cn(
                'flex size-7 items-center justify-center rounded-full border border-foreground/10 ring-offset-2 ring-offset-background transition-shadow disabled:opacity-50',
                chosen ? 'ring-2 ring-foreground/70' : 'hover:ring-2 hover:ring-border',
              )}
              style={{ background: color }}
            >
              {chosen && <Check className="size-3.5 text-white" strokeWidth={3} />}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={$t('Choisir une autre couleur')}
          value={HEX.test(value) ? value : '#64748b'}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
        />
        <Input
          id={id}
          value={value}
          disabled={disabled}
          placeholder="#2563EB"
          onChange={(event) => onChange(event.target.value.trim())}
          aria-invalid={value !== '' && !HEX.test(value)}
          className="w-32 font-mono uppercase"
          maxLength={7}
        />
      </div>
    </div>
  )
}

export const DAYS = [
  { value: 'Lundi', label: msg('Lundi'), short: msg('L') },
  { value: 'Mardi', label: msg('Mardi'), short: msg('M') },
  { value: 'Mercredi', label: msg('Mercredi'), short: msg('M') },
  { value: 'Jeudi', label: msg('Jeudi'), short: msg('J') },
  { value: 'Vendredi', label: msg('Vendredi'), short: msg('V') },
  { value: 'Samedi', label: msg('Samedi'), short: msg('S') },
  { value: 'Dimanche', label: msg('Dimanche'), short: msg('D') },
] as const

export function DayPicker({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: readonly string[]
  readonly onChange: (days: string[]) => void
  readonly disabled?: boolean
}) {
  const order = (days: string[]) => DAYS.map((d) => d.value).filter((d) => days.includes(d))
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {DAYS.map((day) => {
          const on = value.includes(day.value)
          return (
            <button
              key={day.value}
              type="button"
              aria-pressed={on}
              aria-label={$t(day.label)}
              disabled={disabled}
              onClick={() =>
                onChange(order(on ? value.filter((d) => d !== day.value) : [...value, day.value]))
              }
              className={cn(
                'flex size-9 items-center justify-center rounded-full border text-xs font-medium transition-colors disabled:opacity-50',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {$t(day.short)}
            </button>
          )
        })}
      </div>
      <div className="flex gap-3 text-xs">
        {(
          [
            [msg('En semaine'), ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']],
            [msg('Week-end'), ['Samedi', 'Dimanche']],
            [msg('Tous les jours'), DAYS.map((d) => d.value)],
          ] as const
        ).map(([label, days]) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => onChange([...days])}
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
          >
            {$t(label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A number on a slider, its value said beside it. */
export function RangeField({
  id,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  disabled = false,
}: {
  readonly id: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step?: number
  readonly onChange: (value: number) => void
  readonly format: (value: number) => string
  readonly disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-4">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 flex-1 cursor-pointer accent-primary disabled:cursor-default"
      />
      <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">
        {format(value)}
      </span>
    </div>
  )
}

/**
 * Lines of text — domains, tool names — as chips: typed and confirmed by Enter or a comma,
 * taken off by their cross. The value stays one line per item, as basedb keeps it.
 */
export function LinesField({
  id,
  value,
  onChange,
  placeholder,
  check,
  disabled = false,
}: {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder: string
  /** Turns what was typed into an item, or null when it is not one. */
  readonly check?: (item: string) => string | null
  readonly disabled?: boolean
}) {
  const items = value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const [typed, setTyped] = useState('')
  const [wrong, setWrong] = useState(false)

  function add() {
    const raw = typed.trim()
    if (raw === '') return
    const item = check ? check(raw) : raw
    if (item === null) {
      setWrong(true)
      return
    }
    if (!items.includes(item)) onChange([...items, item].join('\n'))
    setTyped('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      add()
    } else if (event.key === 'Backspace' && typed === '' && items.length > 0) {
      onChange(items.slice(0, -1).join('\n'))
    }
  }

  return (
    <div
      className={cn(
        'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 transition-[box-shadow,border-color] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25',
        wrong && 'border-destructive',
      )}
    >
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex h-6 items-center gap-1 rounded-md bg-muted px-2 font-mono text-xs"
        >
          {item}
          {!disabled && (
            <button
              type="button"
              aria-label={$t('Retirer {item}', { item })}
              onClick={() => onChange(items.filter((i) => i !== item).join('\n'))}
              className="-mr-0.5 rounded-sm text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        value={typed}
        disabled={disabled}
        onChange={(event) => {
          setTyped(event.target.value)
          setWrong(false)
        }}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder={items.length === 0 ? placeholder : ''}
        className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {typed.trim() !== '' && (
        <button
          type="button"
          aria-label={$t('Ajouter')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={add}
          className="rounded-sm text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** A choice among a few, drawn as cards: an icon, a name, what it does. */
export function CardChoice<T extends string>({
  value,
  onChange,
  options,
  disabled = false,
}: {
  readonly value: T
  readonly onChange: (value: T) => void
  readonly options: readonly {
    readonly value: T
    readonly label: string
    readonly hint: string
    readonly icon: ReactNode
  }[]
  readonly disabled?: boolean
}) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors disabled:opacity-60',
              on ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-muted/60',
            )}
          >
            <span
              className={cn(
                'flex size-7 items-center justify-center rounded-md [&>svg]:size-4',
                on ? 'bg-primary/15 text-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {option.icon}
            </span>
            <span className="text-sm font-medium">{option.label}</span>
            <span className="text-[11px] leading-snug text-muted-foreground">{option.hint}</span>
          </button>
        )
      })}
    </div>
  )
}
