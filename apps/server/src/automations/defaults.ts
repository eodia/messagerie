import { randomUUID } from 'node:crypto'
import type { AutomationDefinition } from '@chat/contracts'
import type { Db } from '../db/client.js'
import { agents, automations } from '../db/schema.js'

/**
 * What a new messaging starts with (D20): automations the supervisors read, change, start
 * or stop like any other — one on, one ready to be. Written once, while there is none.
 */

const DEFAULTS: readonly (AutomationDefinition & { readonly active: boolean })[] = [
  {
    name: 'Demander l’e-mail quand la réponse tarde',
    description:
      'Cinq minutes sans réponse : le widget propose au visiteur de laisser son adresse, pour lui répondre plus tard.',
    trigger: { kind: 'no_reply', minutes: 5 },
    condition: { match: 'all', rules: [] },
    steps: [
      {
        id: 's1',
        kind: 'ask_email',
        text: 'Nos conseillers sont occupés. Laissez votre e-mail : nous vous répondons dès que possible.',
      },
    ],
    active: true,
  },
  {
    name: 'Enquête de satisfaction à la résolution',
    description:
      'Une conversation résolue : le widget demande au visiteur une note de 1 à 5, et un mot s’il le souhaite. À allumer quand vous le voulez.',
    trigger: { kind: 'resolved' },
    condition: { match: 'all', rules: [] },
    steps: [{ id: 's1', kind: 'survey', scale: 'csat', text: '' }],
    active: false,
  },
]

export async function installDefaultAutomations(db: Db, createdBy: string): Promise<void> {
  const [any] = await db.select({ id: automations.id }).from(automations).limit(1)
  if (any) return
  for (const { active, ...definition } of DEFAULTS) {
    const id = randomUUID()
    await db.transaction(async (tx) => {
      const [actor] = await tx
        .insert(agents)
        .values({ login: `automation:${id}`, name: definition.name, role: 'agent', active: false })
        .returning({ id: agents.id })
      if (!actor) throw new Error('automation agent not inserted')
      await tx.insert(automations).values({
        id,
        ...definition,
        isActive: active,
        activatedAt: active ? new Date() : null,
        agentId: actor.id,
        createdBy,
      })
    })
  }
}
