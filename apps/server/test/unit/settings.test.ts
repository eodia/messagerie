import { describe, expect, it } from 'vitest'
import { availability } from '../../src/settings/hours.js'
import { type OpeningSlot, Settings, minutesOf } from '../../src/settings/settings.js'
import { TemplateSource } from '../../src/settings/source.js'

/** The settings as the demonstration gives them, and the hours computed from them. */

const demo = new Settings(new TemplateSource('dev-marc', true))

describe('the demonstration settings', () => {
  it('give Acme Assurances, its domains and its threshold', async () => {
    const [site] = await demo.sites()
    expect(site).toMatchObject({
      id: 'acme',
      name: 'Acme Assurances',
      domains: ['localhost', '127.0.0.1'],
      timezone: 'Europe/Paris',
      aiEnabled: true,
      threshold: 0.7,
      defaultTeamId: 'support',
    })
  })

  it('make the development agent a supervisor', async () => {
    expect(await demo.agent('dev-marc')).toMatchObject({ role: 'supervisor', active: true })
    expect(await demo.agent('somebody-else')).toBeNull()
  })

  it('read the slots in minutes and weekdays', async () => {
    const slots = await demo.openingSlots('acme')
    expect(slots).toContainEqual(
      expect.objectContaining({ days: [1, 2, 3, 4, 5], opens: 540, closes: 1080 }),
    )
  })

  it('keep only published articles, and active guardrails and tools', async () => {
    expect((await demo.articles()).length).toBe(8)
    // Two of the three promoted conversations are published; the third waits for review.
    expect(await demo.promotedConversations()).toHaveLength(2)
    expect((await demo.guardrails()).every((g) => g.action === 'handoff')).toBe(true)
    expect((await demo.tools()).map((t) => t.type)).toEqual(['basedb', 'callback', 'http'])
  })

  it('read the weather tool as a GET with its headers, and the MCP server', async () => {
    const weather = (await demo.tools()).find((t) => t.name === 'Météo')
    expect(weather).toMatchObject({
      method: 'GET',
      headers: { 'User-Agent': 'Messagerie-Acme/1.0' },
    })
    expect(await demo.mcpServers()).toMatchObject([
      { name: 'Agences Acme (démo)', url: 'http://localhost:8820/mcp', agent: true, allowed: [] },
    ])
  })

  it('offer the site’s suggested questions', async () => {
    const [site] = await demo.sites()
    expect(site?.suggestions).toContain('Quel est le délai de remboursement ?')
  })

  it('read canned replies with their shortcut', async () => {
    expect(await demo.cannedReplies()).toContainEqual(
      expect.objectContaining({ shortcut: 'delai-remboursement' }),
    )
  })
})

describe('hours', () => {
  it('read « 09:00 », « 9h », « 9h30 », and refuse the rest', () => {
    expect([minutesOf('09:00'), minutesOf('9h'), minutesOf('9h30'), minutesOf('neuf')]).toEqual([
      540,
      540,
      570,
      null,
    ])
  })

  const week: OpeningSlot[] = [
    { siteId: null, name: 'Semaine', days: [1, 2, 3, 4, 5], opens: 540, closes: 1080 },
  ]
  const paris = 'Europe/Paris'

  it('are open on a Wednesday at 10:00 in Paris', () => {
    // 2026-09-30 is a Wednesday; 08:00 UTC is 10:00 in Paris (summer time).
    expect(availability(week, [], paris, new Date('2026-09-30T08:00:00Z')).open).toBe(true)
  })

  it('open again on Monday at 9:00, Paris time, after a Friday evening', () => {
    // Friday 2026-10-02, 19:00 in Paris.
    const at = availability(week, [], paris, new Date('2026-10-02T17:00:00Z'))
    expect(at.open).toBe(false)
    expect(at.nextOpening?.toISOString()).toBe('2026-10-05T07:00:00.000Z')
  })

  it('follow the change of hour: 9:00 in Paris is 8:00 UTC in winter', () => {
    // Friday 2026-10-23 evening; the clocks go back on Sunday the 25th.
    const at = availability(week, [], paris, new Date('2026-10-23T18:00:00Z'))
    expect(at.nextOpening?.toISOString()).toBe('2026-10-26T08:00:00.000Z')
  })

  it('are closed on an exceptional closure, and open after it', () => {
    const closures = [
      { siteId: null, reason: 'Noël', from: '2026-12-25', to: '2026-12-25', message: 'Fermé' },
    ]
    // Friday 2026-12-25 at 10:00 in Paris.
    const at = availability(week, closures, paris, new Date('2026-12-25T09:00:00Z'))
    expect(at).toMatchObject({ open: false, closure: { reason: 'Noël' } })
    expect(at.nextOpening?.toISOString()).toBe('2026-12-28T08:00:00.000Z')
  })

  it('without any slot, answer at all times', () => {
    expect(availability([], [], paris).open).toBe(true)
  })
})
