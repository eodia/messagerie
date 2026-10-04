import { describe, expect, it } from 'vitest'
import { iconsOf } from '../../src/settings/site-icon.js'

/** The icons a site's home page declares, as the site menu takes them. */

describe('a home page’s icons', () => {
  it('come Apple’s first, then an SVG, then the largest — as absolute addresses', () => {
    const html = `<head>
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel='icon' type='image/png' href='/favicon-96.png' sizes='96x96'>
      <link rel="icon" href="/logo.svg" type="image/svg+xml">
      <link href="https://cdn.acme.fr/apple.png" rel="apple-touch-icon" sizes="180x180">
      <link rel="stylesheet" href="/site.css">
    </head>`
    expect(iconsOf(html, 'https://acme.fr/accueil')).toEqual([
      'https://cdn.acme.fr/apple.png',
      'https://acme.fr/logo.svg',
      'https://acme.fr/favicon-96.png',
      'https://acme.fr/favicon-16.png',
    ])
  })

  it('take « shortcut icon », and nothing from a page that declares none', () => {
    expect(iconsOf('<link rel="shortcut icon" href="favicon.ico">', 'https://acme.fr/a/')).toEqual([
      'https://acme.fr/a/favicon.ico',
    ])
    expect(iconsOf('<html><body>Bonjour</body></html>', 'https://acme.fr/')).toEqual([])
  })
})
