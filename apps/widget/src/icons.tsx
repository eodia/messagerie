/** The widget's few icons, drawn inline: nothing to load from elsewhere. Lucide's shapes. */

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

export const SendIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="m5 12 7-7 7 7" />
    <path d="M12 19V5" />
  </svg>
)

/**
 * The AI, drawn as an orb in the site's colour and the AI's violet — still while it waits,
 * turning while it writes. The one mark of the AI in the widget, next to the « IA » word.
 */
export const Orb = ({ busy = false, size = 28 }: { busy?: boolean; size?: number }) => (
  <span
    class={busy ? 'orb busy' : 'orb'}
    style={{ width: `${size}px`, height: `${size}px` }}
    aria-hidden="true"
  >
    <span class="orb-core" />
  </span>
)
