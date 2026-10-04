'use client'

import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { type CSSProperties, useId } from 'react'
import styles from './empty-scene.module.css'

/**
 * The empty states, drawn — eodia-insights' scenes, in the messaging's colours: a small
 * window of the application, a glow, a grid of dots, what is missing floating beside it.
 * Decorative: the title and the sentence under it say what to do.
 */

export type EmptySceneVariant =
  | 'no-channel'
  | 'no-conversations'
  | 'no-articles'
  | 'pick-article'
  | 'pick-row'

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
  glyph,
  className,
}: {
  readonly variant: EmptySceneVariant
  /** `pick-row`: the section's icon, on the tile that floats beside the form. */
  readonly glyph?: LucideIcon
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

      {variant === 'no-conversations' ? (
        <NoConversations shadow={shadow} />
      ) : variant === 'no-articles' ? (
        <NoArticles shadow={shadow} />
      ) : variant === 'pick-article' ? (
        <PickArticle shadow={shadow} />
      ) : variant === 'pick-row' ? (
        <PickRow shadow={shadow} glyph={glyph} />
      ) : (
        <NoChannel shadow={shadow} />
      )}

      <path d="M18 64v7m-3.5-3.5h7" className={styles.spark} />
      <circle cx="226" cy="146" r="2.2" className={styles.sparkDot} />
      <circle cx="16" cy="140" r="1.6" className={styles.soft} />
    </svg>
  )
}

/** The list of conversations, its rows waiting — and a bubble that says all is answered. */
function NoConversations({ shadow }: { readonly shadow: string }) {
  return (
    <>
      <Window x={30} y={36} w={152} h={124} shadow={shadow} />
      {/* Its tabs, the first one chosen. */}
      <rect x="40" y="62" width="22" height="4" rx="2" className={styles.inkStrong} />
      <path d="M40 71.5h22" className={styles.tab} />
      <rect x="70" y="62" width="16" height="4" rx="2" className={styles.ink} />
      <rect x="94" y="62" width="26" height="4" rx="2" className={styles.ink} />
      <path d="M30 75.5h152" className={styles.divider} />
      {/* Three rows, none there: an avatar and two lines, dashed. */}
      {[84, 108, 132].map((y) => (
        <g key={y}>
          <rect x="38" y={y} width="136" height="20" rx="6" className={styles.slot} />
          <circle cx="49" cy={y + 10} r="5" className={styles.slot} />
          <rect x="60" y={y + 5.5} width="44" height="3.5" rx="1.75" className={styles.soft} />
          <rect x="60" y={y + 11.5} width="70" height="3" rx="1.5" className={styles.ghost} />
        </g>
      ))}

      {/* Nothing waiting: a bubble, ticked. */}
      <g className={styles.float}>
        <g className={styles.sms}>
          <path
            d="M182 28h34a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8h-20l-9 8v-8h-5a8 8 0 0 1-8-8V36a8 8 0 0 1 8-8Z"
            className={styles.window}
            filter={`url(#${shadow})`}
          />
          <circle cx="199" cy="46" r="10" className={styles.tileBack} />
          <path d="m194.5 46 3.2 3.2 6-6.4" className={styles.tick} />
        </g>
      </g>
      <g className={styles.floatSlow}>
        <circle cx="206" cy="112" r="11" className={styles.window} filter={`url(#${shadow})`} />
        <path d="M208.5 105.5a7 7 0 1 0 5.5 10.5 5.5 5.5 0 0 1-5.5-10.5Z" className={styles.zz} />
      </g>
    </>
  )
}

/** A shelf of the knowledge base with no article: a page to write, and the pen for it. */
function NoArticles({ shadow }: { readonly shadow: string }) {
  return (
    <>
      <Window x={34} y={34} w={140} h={126} shadow={shadow} />
      {/* The article: its title, a chip, its paragraphs — still to write. */}
      <rect x="46" y="62" width="62" height="6" rx="3" className={styles.inkStrong} />
      <rect x="46" y="74" width="30" height="7" rx="3.5" className={styles.chipBack} />
      <path d="M46 90.5h116" className={styles.divider} />
      <rect x="46" y="98" width="116" height="52" rx="6" className={styles.slot} />
      <rect x="54" y="106" width="88" height="3.5" rx="1.75" className={styles.ink} />
      <rect x="54" y="114" width="70" height="3.5" rx="1.75" className={styles.ghost} />
      <rect x="54" y="122" width="80" height="3.5" rx="1.75" className={styles.ghost} />
      <rect x="54" y="130" width="46" height="3.5" rx="1.75" className={styles.ghost} />

      {/* A new one, on its way: a page and its « + »… */}
      <g className={styles.float}>
        <g transform="rotate(6 196 52)">
          <path
            d="M178 26h26l10 10v34a4 4 0 0 1-4 4h-32a4 4 0 0 1-4-4V30a4 4 0 0 1 4-4Z"
            className={styles.window}
            filter={`url(#${shadow})`}
          />
          <path d="M204 26v10h10" className={styles.divider} />
          <circle cx="194" cy="52" r="8" className={styles.plugBack} />
          <path d="M194 48v8m-4-4h8" className={styles.plug} />
        </g>
      </g>
      {/* …and the pen that writes it. */}
      <g className={styles.floatSlow}>
        <g transform="rotate(-38 204 118)">
          <rect x="198" y="96" width="12" height="36" rx="3" className={styles.pen} />
          <path d="M198 132h12l-6 9Z" className={styles.penTip} />
          <rect x="198" y="96" width="12" height="6" rx="2" className={styles.penCap} />
        </g>
      </g>
      <path d="M176 96c-4 6-6 12-6 18" className={styles.path} />
    </>
  )
}

/** No article chosen: the list, one of its articles under the cursor, and the page it opens. */
function PickArticle({ shadow }: { readonly shadow: string }) {
  return (
    <>
      {/* The list, its second article chosen… */}
      <rect
        x="18"
        y="50"
        width="82"
        height="98"
        rx="10"
        className={styles.window}
        filter={`url(#${shadow})`}
      />
      <rect x="22" y="78" width="74" height="20" rx="6" className={styles.selected} />
      {[60, 82, 104, 126].map((y, i) => (
        <g key={y}>
          <rect
            x="28"
            y={y + 2}
            width="9"
            height="11"
            rx="2"
            className={i === 1 ? styles.docChosen : styles.field}
          />
          <rect
            x="42"
            y={y + 5.5}
            width={[42, 36, 46, 30][i]}
            height="4"
            rx="2"
            className={i === 1 ? styles.inkStrong : styles.ink}
          />
        </g>
      ))}
      <path d="M80 92v15.5l4.2-3.9 3 6.6 2.8-1.2-3-6.5h5.8Z" className={styles.cursor} />

      {/* …and its page, open. */}
      <g className={styles.float}>
        <Window x={108} y={30} w={116} h={124} shadow={shadow} />
        <rect x="118" y="58" width="58" height="6" rx="3" className={styles.inkStrong} />
        <rect x="118" y="70" width="28" height="7" rx="3.5" className={styles.chipBack} />
        <rect x="186" y="56" width="28" height="10" rx="5" className={styles.button} />
        <path d="M118 86.5h96" className={styles.divider} />
        {[94, 102, 110, 122, 130, 138].map((y, i) => (
          <rect
            key={y}
            x="118"
            y={y}
            width={[90, 74, 84, 88, 62, 78][i]}
            height="3.5"
            rx="1.75"
            className={i % 3 === 0 ? styles.ink : styles.ghost}
          />
        ))}
      </g>
    </>
  )
}

/**
 * A settings screen with nothing open: its list, a row under the cursor, the form it opens —
 * and the section's own icon, floating.
 */
function PickRow({
  shadow,
  glyph: Glyph,
}: { readonly shadow: string; readonly glyph: LucideIcon | undefined }) {
  return (
    <>
      <rect
        x="18"
        y="46"
        width="78"
        height="104"
        rx="10"
        className={styles.window}
        filter={`url(#${shadow})`}
      />
      <rect x="26" y="54" width="62" height="12" rx="4" className={styles.slot} />
      <rect x="22" y="94" width="70" height="20" rx="6" className={styles.selected} />
      {[74, 98, 122].map((y, i) => (
        <g key={y}>
          <circle cx="33" cy={y + 6} r="4" className={i === 1 ? styles.docChosen : styles.field} />
          <rect
            x="41"
            y={y + 4}
            width={[38, 32, 42][i]}
            height="4"
            rx="2"
            className={i === 1 ? styles.inkStrong : styles.ink}
          />
        </g>
      ))}
      <path d="M78 106v15.5l4.2-3.9 3 6.6 2.8-1.2-3-6.5h5.8Z" className={styles.cursor} />

      {/* The form it opens: a title, a switch, its fields. */}
      <g className={styles.float}>
        <Window x={104} y={34} w={118} h={122} shadow={shadow} />
        <rect x="114" y="62" width="56" height="6" rx="3" className={styles.inkStrong} />
        <rect x="196" y="60.5" width="16" height="9" rx="4.5" className={styles.button} />
        <circle cx="207.5" cy="65" r="3" className={styles.knob} />
        {[80, 104, 128].map((y) => (
          <g key={y}>
            <rect x="114" y={y} width="30" height="3.5" rx="1.75" className={styles.soft} />
            <rect x="114" y={y + 7} width="98" height="10" rx="3.5" className={styles.field} />
          </g>
        ))}
      </g>

      {Glyph && (
        <g className={styles.floatSlow}>
          <rect
            x="186"
            y="14"
            width="34"
            height="34"
            rx="10"
            className={styles.window}
            filter={`url(#${shadow})`}
          />
          <rect x="191" y="19" width="24" height="24" rx="7" className={styles.plugBack} />
          <foreignObject x="195" y="23" width="16" height="16">
            <Glyph className={styles.glyph} width={16} height={16} strokeWidth={2} />
          </foreignObject>
        </g>
      )}
    </>
  )
}

/** « Nouveau message » with nothing to write through yet. */
function NoChannel({ shadow }: { readonly shadow: string }) {
  return (
    <>
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
    </>
  )
}
