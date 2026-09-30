import { describe, expect, it } from 'vitest'
import { passages } from '../src/chunk.js'
import { readJson } from '../src/json.js'
import { Redactor } from '../src/redact.js'

describe('masking personal data', () => {
  it('hides e-mails, phones and IBANs, the same value under the same placeholder', () => {
    const redactor = new Redactor(true)
    const masked = redactor.mask(
      'Écrivez à sophie.leroy@gmail.com ou au 06 12 34 56 78 ; IBAN FR76 3000 6000 0112 3456 7890 189. Encore sophie.leroy@gmail.com.',
    )
    expect(masked).not.toMatch(/sophie|06 12|FR76/)
    expect(masked.match(/\[EMAIL_1\]/g)).toHaveLength(2)
    expect(masked).toContain('[TÉLÉPHONE_1]')
    expect(masked).toContain('[IBAN_1]')
  })

  it('gives the values back in the answer', () => {
    const redactor = new Redactor(true)
    redactor.mask('Mon adresse : a.b@exemple.fr')
    expect(redactor.unmask('Je vous écris à [EMAIL_1].')).toBe('Je vous écris à a.b@exemple.fr.')
  })

  it('leaves everything alone when off — a model hosted in-house', () => {
    const redactor = new Redactor(false)
    expect(redactor.mask('a.b@exemple.fr')).toBe('a.b@exemple.fr')
  })

  it('does not take a contract number for a phone', () => {
    expect(new Redactor(true).mask('Contrat A123456, client CLI-458732')).toBe(
      'Contrat A123456, client CLI-458732',
    )
  })
})

describe('cutting an article', () => {
  it('gives one passage per heading, named after the article and the heading', () => {
    const cut = passages(
      'Délais',
      '## Délai habituel\n\nCinq à dix jours.\n\n## Suivre\n\nDans l’espace client.',
    )
    expect(cut).toEqual([
      { title: 'Délais — Délai habituel', text: 'Cinq à dix jours.' },
      { title: 'Délais — Suivre', text: 'Dans l’espace client.' },
    ])
  })

  it('cuts a long section between paragraphs', () => {
    const long = Array.from({ length: 6 }, (_, i) => `${i} `.repeat(150)).join('\n\n')
    const cut = passages('Long', long)
    expect(cut.length).toBeGreaterThan(1)
    expect(cut.every((p) => p.text.length <= 1200)).toBe(true)
  })
})

describe('reading a model’s JSON', () => {
  it('finds the object inside a fence or a sentence', () => {
    expect(readJson('Voici :\n```json\n{"a": {"b": "}"}}\n```')).toEqual({ a: { b: '}' } })
  })

  it('refuses what is not an object', () => {
    expect(readJson('[1, 2]')).toBeNull()
    expect(readJson('rien')).toBeNull()
  })
})
