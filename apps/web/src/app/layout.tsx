import { PRODUCT_NAME } from '@/lib/product'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '../styles/globals.css'

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: 'La messagerie client, avec un agent IA en première ligne et un copilote.',
}

/**
 * The theme before the first paint: without it, a dark-mode reader sees the page flash
 * white while the application loads. Same storage key and same rule as `lib/theme.ts`.
 */
const THEME_SCRIPT = `try{var p=localStorage.getItem('chat.theme');var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}}catch(e){}`

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant, run before paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
