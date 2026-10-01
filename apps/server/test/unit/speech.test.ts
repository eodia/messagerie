import { describe, expect, it } from 'vitest'
import { spokenText } from '../../src/ai/speech.js'

/** What the AI voice is given to read: the words, never the marks around them. */

describe('a message, as a voice says it', () => {
  it('drops the little Markdown’s marks', () => {
    expect(
      spokenText(
        '> Votre question\n**Bonjour** *Léa*, <u>voici</u> <span color="red">le lien</span> : [le site](https://acme.fr)\n- un\n2. deux',
      ),
    ).toBe('Votre question\nBonjour Léa, voici le lien : le site\nun\ndeux')
  })

  it('does not spell an address out', () => {
    expect(spokenText('Voyez https://acme.fr/aide')).toBe('Voyez')
  })
})
