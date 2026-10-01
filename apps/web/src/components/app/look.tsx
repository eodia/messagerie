'use client'

import { optionIcon } from '@/lib/option-icons'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

/**
 * How a thing looks — basedb's glyphs (`components/app/option-badge.tsx`): a colour of any
 * hue, and either a pictogram or a picture.
 *
 * The keys are read with `?? null`: a row written before the inbox had a look carries
 * none, and that is a plain look, not one with an `undefined` colour to trip over.
 */
export interface OptionLook {
  readonly color?: string | null
  readonly icon?: string | null
  readonly image?: string | null
}

export const hasLook = (option: OptionLook) =>
  (option.color ?? null) !== null ||
  (option.icon ?? null) !== null ||
  (option.image ?? null) !== null

/**
 * The pictogram, the picture, or — with a colour and nothing else — a dot.
 *
 * A pictogram this build does not know draws nothing rather than a placeholder: the name
 * survives in the row, and a look set in basedb is not broken by it.
 */
export function OptionGlyph({
  look,
  className,
}: {
  readonly look: OptionLook
  readonly className?: string
}) {
  const image = look.image ?? null
  const color = look.color ?? null
  if (image !== null) {
    // A plain <img>: a data URL or an arbitrary host leaves nothing for an image optimiser.
    return (
      <img
        src={image}
        alt=""
        draggable={false}
        className={cn('size-4 shrink-0 rounded-sm object-cover', className)}
      />
    )
  }

  const icon = optionIcon(look.icon)
  if (icon !== undefined) {
    return (
      <icon.Icon
        aria-hidden
        className={cn('size-3.5 shrink-0', className)}
        style={color === null ? undefined : { color }}
      />
    )
  }

  if (color !== null) {
    return (
      <span
        aria-hidden
        className={cn('size-2 shrink-0 rounded-full', className)}
        style={{ backgroundColor: color }}
      />
    )
  }
  return null
}

/**
 * A thing as a list draws it: its picture, else its pictogram, else the glyph of its kind
 * — a pictogram and a kind's glyph both wearing the colour, when there is one. Unlike
 * `OptionGlyph`, it never draws nothing: a line of a menu needs an icon.
 */
export function LookIcon({
  look,
  fallback: Fallback,
  className,
}: {
  readonly look: OptionLook
  readonly fallback: LucideIcon
  readonly className?: string
}) {
  const image = look.image ?? null
  if (image !== null) {
    return (
      <img
        src={image}
        alt=""
        draggable={false}
        className={cn('size-4 shrink-0 rounded-sm object-cover', className)}
      />
    )
  }
  const color = look.color ?? null
  const Icon = optionIcon(look.icon)?.Icon ?? Fallback
  const style: CSSProperties | undefined = color === null ? undefined : { color }
  return <Icon aria-hidden className={cn('size-4 shrink-0', className)} style={style} />
}

/**
 * An inbox's mark, wherever inboxes are listed: its picture or its pictogram, in the size
 * of the line — or the coloured dot it always had, grey without a colour.
 */
export function InboxGlyph({
  look,
  className,
  dot = 'size-2',
}: {
  readonly look: OptionLook
  /** The pictogram's or the picture's size. */
  readonly className?: string
  /** The dot's, when there is only a colour. */
  readonly dot?: string
}) {
  if ((look.image ?? null) !== null || optionIcon(look.icon) !== undefined) {
    return <OptionGlyph look={look} className={cn('size-3.5', className)} />
  }
  return (
    <span
      aria-hidden
      className={cn('shrink-0 rounded-full bg-muted-foreground/40', dot)}
      style={look.color ? { backgroundColor: look.color } : undefined}
    />
  )
}
