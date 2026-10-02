import { randomUUID } from 'node:crypto'
import type { AutomationDefinition } from '@chat/contracts'
import type { Db } from '../db/client.js'
import { agents, automations } from '../db/schema.js'

/**
 * What a new messaging starts with (D20): an automation already on, which the supervisors
 * read, change or stop like any other. Written once, while there is none.
 */

const DEFAULTS: readonly AutomationDefinition[] = [
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
  },
]

export async function installDefaultAutomations(db: Db, createdBy: string): Promise<void> {
  const [any] = await db.select({ id: automations.id }).from(automations).limit(1)
  if (any) return
  for (const definition of DEFAULTS) {
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
        isActive: true,
        activatedAt: new Date(),
        agentId: actor.id,
        createdBy,
      })
    })
  }
}
