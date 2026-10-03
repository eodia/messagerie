import { PRODUCT_NAME } from '@/lib/product'
import type { MetadataRoute } from 'next'

/**
 * The inbox, installable (D23): on a phone's home screen, it opens as an application —
 * and an iPhone delivers the alerts of an installed web application only.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT_NAME,
    short_name: PRODUCT_NAME,
    description: 'La messagerie client, avec un agent IA en première ligne et un copilote.',
    start_url: '/conversations',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#143D2B',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  }
}
