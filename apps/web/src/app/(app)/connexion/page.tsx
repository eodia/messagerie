'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Where an identity provider's refusal lands (`?erreur=`): signed out, the sign-in screen
 * reads it; signed in, there is nothing to see here — the inbox.
 */
export default function SignInPage() {
  const router = useRouter()
  useEffect(() => router.replace('/'), [router])
  return null
}
