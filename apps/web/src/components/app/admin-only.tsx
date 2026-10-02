'use client'

import { EmptyState } from '@/components/app/empty-state'
import { ScreenHeader } from '@/components/app/screen-header'
import { $t } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { useTitle } from '@/lib/title'
import { ShieldCheck } from 'lucide-react'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/** What is not the administration's, though its address says `/parametrage`. */
const NOT_ADMINISTRATION = ['/parametrage/connaissance']

/**
 * The administration's screens, for supervisors alone. The server refuses an agent their
 * writes and the reading of their tables; this says so plainly to one who comes by an
 * address, rather than a screen of errors. Nothing shows until the reader is known.
 */
export function AdminOnly({ children }: { readonly children: ReactNode }) {
  const role = useInbox((s) => s.me?.role ?? null)
  const pathname = usePathname()
  if (NOT_ADMINISTRATION.some((path) => pathname.startsWith(path))) return children
  if (role === null) return null
  if (role !== 'supervisor') return <Refused />
  return children
}

function Refused() {
  useTitle([$t('Administration')])
  return (
    <>
      <ScreenHeader>
        <span className="font-medium">{$t('Administration')}</span>
      </ScreenHeader>
      <EmptyState icon={ShieldCheck} title={$t('Réservé aux superviseurs')}>
        {$t(
          'Les boîtes, les équipes, les sites, le widget, les outils de l’IA et les accès des programmes se règlent par les superviseurs.',
        )}
      </EmptyState>
    </>
  )
}
