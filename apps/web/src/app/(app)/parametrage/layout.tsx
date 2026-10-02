'use client'

import { AdminOnly } from '@/components/app/admin-only'
import type { ReactNode } from 'react'

/** The administration's screens: supervisors only. */
export default function AdministrationLayout({ children }: { readonly children: ReactNode }) {
  return <AdminOnly>{children}</AdminOnly>
}
