'use client'

import { OptionGlyph, hasLook } from '@/components/app/look'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Hint } from '@/components/ui/tooltip'
import { $t } from '@/lib/i18n'
import { MAX_IMAGE_CHARS, PRESET_COLORS, normalizeHex, shrinkImage } from '@/lib/look'
import { OPTION_ICONS } from '@/lib/option-icons'
import { cn } from '@/lib/utils'
import { ImageUp, Palette, Pipette, Search, X } from 'lucide-react'
import { useRef, useState } from 'react'

/**
 * How a thing looks, and the button that edits it — basedb's (`components/app/look-picker.tsx`),
 * so that dressing an inbox is the gesture already learnt on a base or a table there.
 *
 * A colour of any hue, and either a pictogram of the interface's library or a small
 * picture, never both.
 */

/** The three keys of a look, as they travel: `null` when unset. */
export interface LookValue {
  readonly color: string | null
  readonly icon: string | null
  readonly image: string | null
}

/**
 * The look of anything that carries one — `?? null` because a catalog served by an API
 * older than this screen has no such keys, and that is a plain look, not an undefined one.
 */
export const lookOf = (thing: {
  readonly color?: string | null
  readonly icon?: string | null
  readonly image?: string | null
}): LookValue => ({
  color: thing.color ?? null,
  icon: thing.icon ?? null,
  image: thing.image ?? null,
})

export const sameLook = (a: LookValue, b: LookValue) =>
  a.color === b.color && a.icon === b.icon && a.image === b.image

/** The fold that lets `ete` find `Été`: the same one the combobox uses. */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function LookButton({
  look: draft,
  label,
  onChange,
  disabled = false,
  className,
}: {
  readonly look: LookValue
  /** What the button dresses, for a screen reader: « Apparence de la boîte Sinistres ». */
  readonly label: string
  readonly onChange: (patch: Partial<LookValue>) => void
  readonly disabled?: boolean
  readonly className?: string
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'icon' | 'image'>('icon')

  return (
    <Popover
      // Modal: its pictograms scroll, and from a dialog a non-modal popover sits outside the
      // dialog's scroll lock — the wheel would do nothing over them.
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Opens on what the choice has: a picture shows the picture pane.
        if (next) setMode(draft.image !== null ? 'image' : 'icon')
      }}
    >
      <Hint label={$t('Couleur, pictogramme ou image')}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={label}
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent',
              !hasLook(draft) && 'border-dashed',
              className,
            )}
          >
            {hasLook(draft) ? (
              <OptionGlyph look={draft} className="size-5" />
            ) : (
              <Palette className="size-4" />
            )}
          </button>
        </PopoverTrigger>
      </Hint>

      <PopoverContent
        className="w-80 space-y-3"
        // Inside a dialog, the wheel over a portal is swallowed by the dialog's scroll lock:
        // without this the pictogram grid would not scroll.
        onWheel={(e) => e.stopPropagation()}
      >
        <ColorPane color={draft.color} onChange={(color) => onChange({ color })} />

        <div className="space-y-2">
          <fieldset className="inline-flex rounded-md border p-0.5 text-xs">
            <legend className="sr-only">{$t('Pictogramme ou image')}</legend>
            {(['icon', 'image'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'rounded px-2.5 py-1 transition-colors',
                  mode === m
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'icon' ? $t('Pictogramme') : $t('Image')}
              </button>
            ))}
          </fieldset>

          {mode === 'icon' ? (
            <IconPane
              icon={draft.icon}
              color={draft.color}
              onChange={(icon) => onChange({ icon, image: null })}
            />
          ) : (
            <ImagePane image={draft.image} onChange={(image) => onChange({ image, icon: null })} />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ColorPane({
  color,
  onChange,
}: {
  readonly color: string | null
  readonly onChange: (color: string | null) => void
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{$t('Couleur')}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-label={$t('Aucune couleur')}
          aria-pressed={color === null}
          onClick={() => onChange(null)}
          className="flex size-6 items-center justify-center rounded-full border text-muted-foreground aria-pressed:ring-2 aria-pressed:ring-ring aria-pressed:ring-offset-1"
        >
          <X className="size-3" />
        </button>
        {PRESET_COLORS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-label={$t('Couleur {preset}', { preset })}
            aria-pressed={color === preset}
            onClick={() => onChange(preset)}
            style={{ backgroundColor: preset }}
            className="size-6 rounded-full aria-pressed:ring-2 aria-pressed:ring-ring aria-pressed:ring-offset-1"
          />
        ))}
        {/* Any other colour: the browser's own picker, which also takes a typed hex. */}
        <Hint label={$t('Une autre couleur')}>
          <label
            className={cn(
              'relative flex size-6 cursor-pointer items-center justify-center rounded-full border text-muted-foreground',
              color !== null && !PRESET_COLORS.includes(color) && 'ring-2 ring-ring ring-offset-1',
            )}
            style={
              color !== null && !PRESET_COLORS.includes(color)
                ? { backgroundColor: color }
                : undefined
            }
          >
            <input
              type="color"
              aria-label={$t('Choisir une autre couleur')}
              value={color ?? '#6b7280'}
              onChange={(e) => onChange(normalizeHex(e.target.value))}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
            <Pipette className="size-3" />
          </label>
        </Hint>
      </div>
      {color !== null && <p className="font-mono text-[11px] text-muted-foreground">{color}</p>}
    </div>
  )
}

function IconPane({
  icon,
  color,
  onChange,
}: {
  readonly icon: string | null
  readonly color: string | null
  readonly onChange: (icon: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const needle = fold(query.trim())
  const shown =
    needle === ''
      ? OPTION_ICONS
      : OPTION_ICONS.filter((i) => fold(`${i.label} ${i.name}`).includes(needle))

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md border px-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={$t('Chercher un pictogramme…')}
          aria-label={$t('Chercher un pictogramme')}
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="scroll-discret grid max-h-44 grid-cols-7 gap-1 overflow-y-auto">
        {shown.map(({ name, label, Icon }) => (
          <Hint key={name} label={label}>
            <button
              type="button"
              aria-label={label}
              aria-pressed={icon === name}
              onClick={() => onChange(name)}
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-ring"
            >
              <Icon
                className="size-4"
                style={icon === name && color !== null ? { color } : undefined}
              />
            </button>
          </Hint>
        ))}
        {shown.length === 0 && (
          <p className="col-span-7 py-4 text-center text-xs text-muted-foreground">
            {$t('Aucun pictogramme.')}
          </p>
        )}
      </div>

      {icon !== null && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          <X className="size-3.5" />
          {$t('Retirer le pictogramme')}
        </Button>
      )}
    </div>
  )
}

function ImagePane({
  image,
  onChange,
}: {
  readonly image: string | null
  readonly onChange: (image: string | null) => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (picked: File | undefined) => {
    if (picked === undefined) return
    setBusy(true)
    setError(null)
    try {
      onChange(await shrinkImage(picked))
    } catch (e) {
      setError(e instanceof Error ? e.message : $t('Image illisible.'))
    } finally {
      setBusy(false)
      // The same file can be chosen twice in a row.
      if (file.current !== null) file.current.value = ''
    }
  }

  const useUrl = () => {
    const text = url.trim()
    if (!/^https:\/\/\S+$/i.test(text)) return setError($t('Une adresse https://… est attendue.'))
    if (text.length > MAX_IMAGE_CHARS) return setError($t('Adresse trop longue.'))
    setError(null)
    onChange(text)
    setUrl('')
  }

  return (
    <div className="space-y-2">
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => file.current?.click()}
      >
        <ImageUp className="size-4" />
        {busy ? $t('Traitement…') : $t('Choisir un fichier')}
      </Button>

      <div className="flex gap-1.5">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              useUrl()
            }
          }}
          placeholder={$t('ou une adresse https://…')}
          aria-label={$t('Adresse de l’image')}
          className="h-8 text-xs"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={useUrl}
          disabled={url.trim() === ''}
        >
          {$t('Utiliser')}
        </Button>
      </div>

      {error !== null && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {image !== null && (
        <div className="flex items-center gap-2">
          <OptionGlyph look={{ image }} className="size-8" />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X className="size-3.5" />
            {$t('Retirer l’image')}
          </Button>
        </div>
      )}
    </div>
  )
}
