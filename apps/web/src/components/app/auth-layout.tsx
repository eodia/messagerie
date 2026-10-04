'use client'

import { ProductMark } from '@/components/app/product-mark'
import { Input } from '@/components/ui/input'
import { $t } from '@/lib/i18n'
import { PRODUCT_NAME } from '@/lib/product'
import { cn } from '@/lib/utils'
import { CircleAlert, Eye, EyeOff } from 'lucide-react'
import type { CSSProperties, ComponentProps, ReactNode } from 'react'
import { ChatGlimpse } from './chat-glimpse'

/**
 * The screens before a session — the sign-in, the choice of a password — laid out as
 * basedb lays out its own: the form on the left, a window onto the product on the right.
 * The same tokens, the same motion, so that basedb's agents recognise the door; but the
 * window shows the messaging app, its conversations and its AI.
 */

/** How a piece of these screens arrives: rising a little, one after the other. */
export const REVEAL = 'animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both'

/** The delay of the `order`-th piece to arrive, after the title and its line. */
export const revealAt = (order: number): CSSProperties => ({
  animationDelay: `${180 + order * 60}ms`,
})

/** The button's hover, press and release: it lifts, and gives under the finger. */
export const PRESSABLE =
  'transition-[translate,scale,box-shadow,background-color] hover:-translate-y-px hover:shadow-md hover:shadow-primary/20 active:translate-y-0 active:scale-[0.99] disabled:translate-y-0 disabled:shadow-none'

/** The product's mark and name: the sidebar's tile, larger. */
export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5 leading-none">
      <ProductMark className="size-8" />
      <span className="text-lg font-bold tracking-[-0.035em]" translate="no">
        {PRODUCT_NAME}
      </span>
    </span>
  )
}

export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  readonly title: string
  readonly description: string
  readonly children: ReactNode
  readonly footer?: ReactNode
}) {
  return (
    <main className="grid min-h-svh bg-background text-foreground lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="flex min-w-0 flex-col px-6 py-7 sm:px-12 lg:px-16">
        <header className={REVEAL}>
          <Brand />
        </header>

        <div className="flex flex-1 items-center">
          <div className="w-full max-w-sm py-12">
            <h1
              className={cn('text-3xl font-semibold tracking-tight text-balance', REVEAL)}
              style={{ animationDelay: '60ms' }}
            >
              {title}
            </h1>
            <p
              className={cn('mt-2.5 text-sm leading-relaxed text-muted-foreground', REVEAL)}
              style={{ animationDelay: '120ms' }}
            >
              {description}
            </p>
            <div className="mt-8">{children}</div>
          </div>
        </div>

        {footer !== undefined && (
          <footer
            className={cn('text-sm text-muted-foreground', REVEAL)}
            style={{ animationDelay: '600ms' }}
          >
            {footer}
          </footer>
        )}
      </section>

      <ChatGlimpse />
    </main>
  )
}

/** A password field with its show / hide control. */
export function PasswordInput({
  visible,
  onVisibleChange,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, 'type'> & {
  readonly visible: boolean
  readonly onVisibleChange: (visible: boolean) => void
}) {
  const Icon = visible ? EyeOff : Eye
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} />
      <button
        type="button"
        className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => onVisibleChange(!visible)}
        aria-label={visible ? $t('Masquer le mot de passe') : $t('Afficher le mot de passe')}
        aria-pressed={visible}
        aria-controls={props.id}
      >
        {/* A new icon for the new state: it turns into place. */}
        <Icon
          key={String(visible)}
          className="size-4 animate-in spin-in-45 zoom-in-75 duration-200"
          aria-hidden="true"
        />
      </button>
    </div>
  )
}

/**
 * The refusal of a form, where a screen reader announces it. It shakes once as it
 * appears; give it a new `key` for each refusal and it shakes again.
 */
export function FormError({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  return (
    <div
      id={id}
      role="alert"
      className="flex animate-shake items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

/** A short pause before leaving, so a success is seen — none when motion is unwelcome. */
export function pauseOnSuccess(): Promise<void> {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return new Promise((resolve) => setTimeout(resolve, still ? 0 : 550))
}
