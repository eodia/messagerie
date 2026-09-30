import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merges class names, letting a later utility win over an earlier one.
 *
 * `clsx` handles the conditionals, `tailwind-merge` resolves the conflicts: without the
 * second, `cn('p-2', 'p-4')` would emit both and the winner would depend on the order
 * Tailwind happened to generate them in.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
