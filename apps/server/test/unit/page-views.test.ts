import { describe, expect, it } from 'vitest'
import { cleanPageTitle, cleanPageUrl } from '../../src/page/views.js'

/** The pages a widget says: kept without what could be a secret or a person. */

describe('a page’s address', () => {
  it('keeps the page and its harmless parameters, not its fragment', () => {
    expect(cleanPageUrl('https://acme.fr/devis/auto?etape=2#formule')).toBe(
      'https://acme.fr/devis/auto?etape=2',
    )
  })

  it('drops what looks private: a token, a password, an e-mail, a code, credentials', () => {
    expect(
      cleanPageUrl(
        'https://jean:secret@acme.fr/reset?token=abc&password=x&email=a%40b.fr&code=123&produit=clio',
      ),
    ).toBe('https://acme.fr/reset?produit=clio')
  })

  it('refuses anything but http and https, and what is not an address', () => {
    expect(cleanPageUrl('javascript:alert(1)')).toBeNull()
    expect(cleanPageUrl('file:///etc/passwd')).toBeNull()
    expect(cleanPageUrl('pas une adresse')).toBeNull()
    expect(cleanPageUrl(42)).toBeNull()
  })

  it('is cut at a thousand characters', () => {
    expect(cleanPageUrl(`https://acme.fr/${'a'.repeat(3000)}`)?.length).toBe(1000)
  })
})

describe('a page’s title', () => {
  it('is one line, two hundred characters at most', () => {
    expect(cleanPageTitle('  Devis\n  auto  ')).toBe('Devis auto')
    expect(cleanPageTitle('x'.repeat(300))).toHaveLength(200)
    expect(cleanPageTitle(null)).toBe('')
  })
})
