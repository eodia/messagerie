import type { AutomationStep } from '@chat/contracts'
import { describe, expect, it } from 'vitest'
import {
  continuationAfter,
  nextOccurrence,
  problemOf,
  readDefinition,
} from '../../src/automations/model.js'
import {
  EMPTY_SUBJECT,
  type Subject,
  holds,
  jsonEscape,
  render,
} from '../../src/automations/subject.js'

const paris = (every: 'hour' | 'day' | 'weekdays' | 'week', at: string, weekday = 1) => ({
  every,
  at,
  weekday,
  timezone: 'Europe/Paris',
})

describe('a schedule', () => {
  it('goes off at its time in its time zone, summer and winter alike', () => {
    // Wednesday 1 July 2026, 10:00 in Paris (UTC+2).
    expect(
      nextOccurrence(paris('day', '09:00'), new Date('2026-07-01T08:00:00Z')).toISOString(),
    ).toBe('2026-07-02T07:00:00.000Z')
    expect(
      nextOccurrence(paris('day', '11:30'), new Date('2026-07-01T08:00:00Z')).toISOString(),
    ).toBe('2026-07-01T09:30:00.000Z')
    // In winter, UTC+1.
    expect(
      nextOccurrence(paris('day', '09:00'), new Date('2026-12-01T12:00:00Z')).toISOString(),
    ).toBe('2026-12-02T08:00:00.000Z')
  })

  it('skips the weekend on weekdays, and keeps to its day for a week', () => {
    // Friday 3 July 2026, 18:00 in Paris.
    const friday = new Date('2026-07-03T16:00:00Z')
    expect(nextOccurrence(paris('weekdays', '09:00'), friday).toISOString()).toBe(
      '2026-07-06T07:00:00.000Z',
    )
    expect(nextOccurrence(paris('week', '09:00', 3), friday).toISOString()).toBe(
      '2026-07-08T07:00:00.000Z',
    )
  })

  it('goes off every hour at its minute', () => {
    expect(
      nextOccurrence(paris('hour', '00:15'), new Date('2026-07-01T08:20:30Z')).toISOString(),
    ).toBe('2026-07-01T09:15:00.000Z')
    expect(
      nextOccurrence(paris('hour', '00:15'), new Date('2026-07-01T08:15:00Z')).toISOString(),
    ).toBe('2026-07-01T09:15:00.000Z')
  })
})

describe('a wait', () => {
  const steps: AutomationStep[] = [
    { id: 's1', kind: 'note', body: 'a' },
    {
      id: 's2',
      kind: 'branch',
      paths: [
        {
          id: 'p1',
          label: '',
          otherwise: false,
          condition: { match: 'all', rules: [] },
          steps: [
            { id: 's3', kind: 'wait', amount: 1, unit: 'hours', unlessReply: false },
            { id: 's4', kind: 'note', body: 'b' },
          ],
        },
      ],
    },
    { id: 's5', kind: 'note', body: 'c' },
  ]

  it('goes on with the rest of its path, then with what follows the branch', () => {
    expect(continuationAfter(steps, 's3')?.map((seq) => seq.map((s) => s.id))).toEqual([
      ['s4'],
      ['s5'],
    ])
    expect(continuationAfter(steps, 's9')).toBeNull()
  })
})

describe('a definition', () => {
  it('is read bounded, and refused with what is wrong', () => {
    expect(() => readDefinition({ name: '', trigger: { kind: 'button' } })).toThrow()
    expect(() =>
      readDefinition({
        name: 'x',
        trigger: { kind: 'button' },
        steps: [{ id: 's1', kind: 'rm -rf' }],
      }),
    ).toThrow()
    expect(() =>
      readDefinition({
        name: 'x',
        trigger: { kind: 'button' },
        steps: [
          { id: 's1', kind: 'note', body: 'a' },
          { id: 's1', kind: 'note', body: 'b' },
        ],
      }),
    ).toThrow()
    const read = readDefinition({
      name: '  Relance  ',
      trigger: { kind: 'no_reply' },
      steps: [{ id: 's1', kind: 'wait' }],
    })
    expect(read.name).toBe('Relance')
    expect(read.trigger).toEqual({ kind: 'no_reply', minutes: 15 })
    expect(read.steps[0]).toEqual({
      id: 's1',
      kind: 'wait',
      amount: 1,
      unit: 'hours',
      unlessReply: false,
    })
  })

  it('says what keeps it from running', () => {
    const base = { name: 'x', description: '', condition: { match: 'all' as const, rules: [] } }
    expect(problemOf({ ...base, trigger: { kind: 'button' }, steps: [] })).toEqual({
      problem: 'no_steps',
    })
    expect(
      problemOf({
        ...base,
        trigger: { kind: 'schedule', forEach: false, schedule: paris('day', '09:00') },
        steps: [{ id: 's1', kind: 'note', body: 'a' }],
      }),
    ).toEqual({ problem: 'needs_conversation', step: 's1' })
    expect(
      problemOf({
        ...base,
        trigger: { kind: 'button' },
        steps: [
          { id: 's1', kind: 'ai', mode: 'classify', prompt: 'Le sujet ?', choices: ['Auto'] },
        ],
      }),
    ).toEqual({ problem: 'choices_missing', step: 's1' })
  })
})

const subject = (over: Partial<NonNullable<Subject['conversation']>> = {}): Subject => ({
  ...EMPTY_SUBJECT,
  conversation: {
    id: 'c1',
    status: 'open',
    inboxId: 'service-client',
    teamId: null,
    siteId: 'acme',
    siteName: 'Acme',
    channel: 'web',
    priority: 'normal',
    sentiment: 'negative',
    assigneeId: null,
    assignee: null,
    summary: null,
    lastMessageAt: new Date(Date.now() - 30 * 60_000),
    data: { contrat: 'A123' },
    ...over,
  },
  tags: ['Sinistre'],
  message: 'Mon véhicule est en PANNE',
  open: false,
})

describe('a condition', () => {
  it('reads the conversation, its words without accents nor case, and the hours', () => {
    const s = subject()
    const rule = (r: object) => ({ match: 'all' as const, rules: [r as never] })
    expect(
      holds(rule({ field: 'message', op: 'contains', values: ['vehicule', 'panne'] }), s),
    ).toBe(true)
    expect(holds(rule({ field: 'tags', op: 'has', values: ['sinistre'] }), s)).toBe(true)
    expect(holds(rule({ field: 'assignee', op: 'empty', values: [] }), s)).toBe(true)
    expect(holds(rule({ field: 'hours', op: 'closed', values: [] }), s)).toBe(true)
    expect(holds(rule({ field: 'idle', op: 'more_than', values: ['20'] }), s)).toBe(true)
    expect(holds(rule({ field: 'data', key: 'contrat', op: 'equals', values: ['a123'] }), s)).toBe(
      true,
    )
    expect(holds(rule({ field: 'inbox', op: 'is_not', values: ['service-client'] }), s)).toBe(false)
    expect(
      holds(
        {
          match: 'any',
          rules: [
            { field: 'priority', op: 'is', values: ['urgent'] },
            { field: 'sentiment', op: 'is', values: ['negative'] },
          ],
        },
        s,
      ),
    ).toBe(true)
    // Without a conversation, a rule on it never holds.
    expect(
      holds(rule({ field: 'status', op: 'is_not', values: ['resolved'] }), EMPTY_SUBJECT),
    ).toBe(false)
  })
})

describe('a citation', () => {
  it('is replaced by what it names, or by nothing', () => {
    const scope = { contact: { prenom: 'Léa' }, etape: { s1: 'Auto' }, webhook: { a: { b: 2 } } }
    expect(
      render('Bonjour {{ contact.prenom }} ({{etape.s1}}, {{webhook.a.b}}){{inconnu.x}}', scope),
    ).toBe('Bonjour Léa (Auto, 2)')
    expect(render('{"t": "{{x}}"}', { x: 'il a dit "oui"\n' }, jsonEscape)).toBe(
      '{"t": "il a dit \\"oui\\"\\n"}',
    )
  })
})
