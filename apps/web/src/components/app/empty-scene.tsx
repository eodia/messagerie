'use client'

import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { type CSSProperties, useId } from 'react'
import styles from './empty-scene.module.css'

/**
 * The empty states, drawn — eodia-insights' scenes, in the messaging's colours: a small
 * window of the application, a glow, a grid of dots, what is missing floating beside it.
 * Decorative: the title and the sentence under it say what to do.
 */

export type EmptySceneVariant = 'no-channel'

/** The window every scene is drawn in: three dots and a bar. */
function Window({
  x,
  y,
  w,
  h,
  shadow,
}: {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly shadow: string
}) {
  return (
    <>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="11"
        className={styles.window}
        filter={`url(#${shadow})`}
      />
      <circle cx={x + 10} cy={y + 9} r="2" className={styles.dotRed} />
      <circle cx={x + 17} cy={y + 9} r="2" className={styles.dotYellow} />
      <circle cx={x + 24} cy={y + 9} r="2" className={styles.dotGreen} />
      <path d={`M${x} ${y + 18.5}h${w}`} className={styles.divider} />
    </>
  )
}

export function EmptyScene({
  variant,
  className,
}: {
  readonly variant: EmptySceneVariant
  readonly className?: string
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const shadow = `${id}-shadow`
  const dark = useTheme((s) => s.theme) === 'dark'
  const tones = dark
    ? ({
        '--ill-shadow': 'rgb(0 0 0 / 0.55)',
        '--ill-ink': 'color-mix(in oklab, var(--foreground) 18%, var(--card))',
      } as CSSProperties)
    : undefined
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 240 180"
      width="240"
      height="180"
      fill="none"
      className={cn(styles.scene, className)}
      style={tones}
      data-variant={variant}
    >
      <defs>
        <radialGradient id={`${id}-glow`}>
          <stop className={styles.glowCenter} />
          <stop offset="1" className={styles.glowEdge} />
        </radialGradient>
        <radialGradient id={`${id}-fade`}>
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-grid-mask`}>
          <ellipse cx="120" cy="92" rx="118" ry="86" fill={`url(#${id}-fade)`} />
        </mask>
        <pattern id={`${id}-grid`} width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="6" cy="6" r="0.75" className={styles.gridDot} />
        </pattern>
        <filter id={shadow} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="5" stdDeviation="6" className={styles.shadowColor} />
        </filter>
      </defs>

      <ellipse cx="120" cy="96" rx="112" ry="80" fill={`url(#${id}-glow)`} />
      <rect width="240" height="180" fill={`url(#${id}-grid)`} mask={`url(#${id}-grid-mask)`} />

      {/* « Nouveau message »: who to, what to say — and its send button, unlit. */}
      <Window x={22} y={40} w={146} h={116} shadow={shadow} />
      <rect x="34" y="68" width="40" height="5" rx="2.5" className={styles.inkStrong} />
      <rect x="34" y="80" width="122" height="13" rx="4.5" className={styles.field} />
      <rect x="40" y="85" width="34" height="3.5" rx="1.75" className={styles.soft} />
      <rect x="34" y="99" width="122" height="34" rx="5" className={styles.slot} />
      <rect x="40" y="106" width="70" height="3.5" rx="1.75" className={styles.ink} />
      <rect x="40" y="114" width="52" height="3.5" rx="1.75" className={styles.ink} />
      <rect x="126" y="139" width="30" height="11" rx="5.5" className={styles.sendOff} />
      <path d="M136.5 144.5h8m-3-3 3 3-3 3" className={styles.sendGlyph} />

      {/* The ways out, not plugged in yet: an e-mail, an SMS… */}
      <g className={styles.float}>
        <g className={styles.email}>
          <rect
            x="176"
            y="34"
            width="44"
            height="34"
            rx="9"
            className={styles.window}
            filter={`url(#${shadow})`}
          />
          <rect x="184" y="41" width="28" height="20" rx="5" className={styles.tileBack} />
          <path d="M188 46h20v10h-20Zm0 0 10 6 10-6" className={styles.tileGlyph} />
        </g>
      </g>
      <g className={styles.floatSlow}>
        <g className={styles.sms}>
          <rect
            x="182"
            y="92"
            width="40"
            height="34"
            rx="9"
            className={styles.window}
            filter={`url(#${shadow})`}
          />
          <path
            d="M190 100h24a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-15l-5 4v-4h-4a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Z"
            className={styles.tileBack}
          />
          <circle cx="196" cy="107.5" r="1.4" className={styles.tileFill} />
          <circle cx="202" cy="107.5" r="1.4" className={styles.tileFill} />
          <circle cx="208" cy="107.5" r="1.4" className={styles.tileFill} />
        </g>
      </g>

      {/* …and the dashed way that will join them to the window. */}
      <path d="M176 56c-8 4-12 14-12 24" className={styles.path} />
      <path d="M182 108c-6 0-12-6-16-14" className={styles.path} />
      <circle cx="166" cy="84" r="6.5" className={styles.plugBack} />
      <path d="M163.5 81.5v-2m5 2v-2M162 82h8v2a4 4 0 0 1-8 0Zm4 6v2" className={styles.plug} />

      <path d="M18 64v7m-3.5-3.5h7" className={styles.spark} />
      <circle cx="226" cy="146" r="2.2" className={styles.sparkDot} />
      <circle cx="16" cy="140" r="1.6" className={styles.soft} />
    </svg>
  )
}
