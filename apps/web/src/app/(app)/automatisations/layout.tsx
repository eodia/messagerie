'use client'

import { AdminOnly } from '@/components/app/admin-only'
import type { ReactNode } from 'react'

/** The automations: supervisors only (D20). */
export default function AutomationsLayout({ children }: { readonly children: ReactNode }) {
  return <AdminOnly>{children}</AdminOnly>
}
