/** The widget's few icons, drawn inline: nothing to load from elsewhere. Lucide's shapes. */

import { useId } from 'preact/hooks'

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const

export const ChatIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
  </svg>
)

export const SparkIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M9.94 14.06 4 20M14 4l1.5 3.5L19 9l-3.5 1.5L14 14l-1.5-3.5L9 9l3.5-1.5Z" />
  </svg>
)

export const MailIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
)

export const StarIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M11.53 2.3a.53.53 0 0 1 .94 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.02a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z" />
  </svg>
)

export const ChevronDownIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
)

export const PaperclipIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />
  </svg>
)

export const SmileIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <line x1="9" x2="9.01" y1="9" y2="9" />
    <line x1="15" x2="15.01" y1="9" y2="9" />
  </svg>
)

export const FileIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </svg>
)

export const SendIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="m5 12 7-7 7 7" />
    <path d="M12 19V5" />
  </svg>
)

/**
 * A continuous pearlescent ribbon. Each instance owns its SVG gradients so several
 * avatars can share the shadow root. Only the current mark moves.
 */
export const Orb = ({
  active = false,
  busy = false,
  size = 28,
}: { active?: boolean; busy?: boolean; size?: number }) => {
  const id = useId()
  const ribbon = `${id}-ribbon`
  const sheen = `${id}-sheen`
  const loop =
    'M32 10C42 10 44 20 49 28C55 38 50 48 39 48C28 48 19 55 13 45C7 35 15 27 19 19C22 13 25 10 32 10Z'
  return (
    <span
      class={['orb', (active || busy) && 'active', busy && 'busy'].filter(Boolean).join(' ')}
      style={{ width: `${size}px`, height: `${size}px` }}
      aria-hidden="true"
    >
      <svg class="orb-ribbon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <defs>
          <linearGradient
            id={ribbon}
            x1="14"
            y1="12"
            x2="48"
            y2="51"
            gradientUnits="userSpaceOnUse"
          >
            <stop stop-color="#a5f3fc" />
            <stop offset=".22" stop-color="#38bdf8" />
            <stop offset=".46" stop-color="#6366f1" />
            <stop offset=".7" stop-color="#a78bfa" />
            <stop offset="1" stop-color="#f9a8d4" />
          </linearGradient>
          <linearGradient id={sheen} x1="20" y1="9" x2="42" y2="53" gradientUnits="userSpaceOnUse">
            <stop stop-color="#fff" stop-opacity=".95" />
            <stop offset=".28" stop-color="#e0f2fe" stop-opacity=".1" />
            <stop offset=".52" stop-color="#312e81" stop-opacity=".55" />
            <stop offset=".76" stop-color="#fff" stop-opacity=".7" />
            <stop offset="1" stop-color="#fff" stop-opacity="0" />
          </linearGradient>
        </defs>
        <g class="orb-flow" stroke-linecap="round" stroke-linejoin="round">
          <path
            d={loop}
            stroke="#4338ca"
            stroke-opacity=".12"
            stroke-width="11"
            transform="translate(0 1)"
          />
          <path d={loop} stroke={`url(#${ribbon})`} stroke-width="9" />
          <path d={loop} stroke={`url(#${sheen})`} stroke-width="4.5" />
          <path
            d="M20 17C23 11 27 9 32 9C39 9 42 16 45 21"
            stroke="#fff"
            stroke-opacity=".75"
            stroke-width="1.2"
          />
          <path
            d="M17 42C20 47 27 43 34 43C42 44 48 39 46 34"
            stroke="#f5e8ff"
            stroke-opacity=".7"
            stroke-width="1"
          />
        </g>
      </svg>
    </span>
  )
}
