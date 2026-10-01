import { Redactor } from '@chat/ai'
import { describe, expect, it } from 'vitest'
import { type Context, customer } from '../../src/ai/context.js'
import { isGeneratedName } from '../../src/inbox/contact-name.js'

/** What the AI is told of the customer — and never a name that is no one's. */

const contextOf = (contact: Partial<Context['contact']>) =>
  ({
    contact: {
      name: 'Visiteur 9F0C',
      identified: false,
      email: null,
      phone: null,
      attributes: [],
      data: {},
      ...contact,
    },
    conversation: { data: {} },
    redactor: new Redactor(false),
  }) as unknown as Context

describe('the customer, as the AI reads them', () => {
  it('knows a generated label from a name', () => {
    expect(isGeneratedName('Visiteur 9F0C')).toBe(true)
    expect(isGeneratedName('')).toBe(true)
    expect(isGeneratedName('Léa Martin')).toBe(false)
    expect(isGeneratedName('Visiteur du site')).toBe(false)
  })

  it('never hands « Visiteur 9F0C » over as a name, and says the name is unknown', () => {
    const told = customer(contextOf({}))
    expect(told).not.toContain('9F0C')
    expect(told).toContain('Son nom n’est pas connu')
  })

  it('passes on the name an anonymous visitor gave', () => {
    const told = customer(contextOf({ name: 'Léa Martin' }))
    expect(told).toContain('Nom : Léa Martin')
    expect(told).not.toContain('Son nom n’est pas connu')
  })
})
