import { cn } from '@/lib/utils'

/**
 * The Messagerie's mark — the site's `brand/mark.svg`: a bubble on dark green, light green
 * on the dark theme, as `mark-light.svg`.
 */
export function ProductMark({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn('shrink-0', className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="16" className="fill-[#143D2B] dark:fill-[#D9F5B5]" />
      <path
        d="M20 16h24a7 7 0 0 1 7 7v14a7 7 0 0 1-7 7H32l-10 8v-8h-2a7 7 0 0 1-7-7V23a7 7 0 0 1 7-7z"
        className="fill-[#D9F5B5] dark:fill-[#143D2B]"
      />
      <rect
        x="22"
        y="28"
        width="20"
        height="5"
        rx="2.5"
        className="fill-[#72CA89] dark:fill-[#36734B]"
      />
    </svg>
  )
}
