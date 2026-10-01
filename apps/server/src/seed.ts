import type { ContactAttribute, ConversationEvent, Source } from '@chat/contracts'
import { sql } from 'drizzle-orm'
import { BasedbClient } from './basedb/client.js'
import { readConfig } from './config.js'
import { connect, migrateDatabase } from './db/client.js'
import {
  agents,
  aiFeedback,
  aiRuns,
  contacts,
  conversationTags,
  conversations,
  messages,
} from './db/schema.js'
import { Settings } from './settings/settings.js'
import { sourceFor } from './settings/source.js'

/**
 * Development data: the conversations of the mockup, in the `chat` schema.
 *
 *   pnpm --filter @chat/server seed
 *
 * It EMPTIES the schema first, and refuses to run in production. The mockup's times are
 * kept relative to one another and moved to now, so that « il y a 5 minutes » stays true
 * whatever day it runs.
 */
const config = readConfig()
if (config.production) {
  console.error('seed : refusé en production — il vide le schéma chat.')
  process.exit(1)
}

const MOCKUP_NOW = new Date('2026-09-30T10:30:00').getTime()
const shift = Date.now() - MOCKUP_NOW
const at = (mockupTime: string) => new Date(new Date(mockupTime).getTime() + shift)

/**
 * The demonstration site, Acme Assurances: the first active site of the settings — of the
 * chat's basedb, or of the template's demonstration rows.
 */
const source = sourceFor(
  config.basedb ? new BasedbClient(config.basedb) : null,
  false,
  config.devAgent,
)
const found = source ? (await new Settings(source).sites()).find((s) => s.active) : undefined
const SITE = { id: found?.id ?? 'acme', name: found?.name ?? 'Acme Assurances' }

/**
 * The demonstration's inboxes, by name: a claim goes to « Sinistres », an unhappy customer
 * to « Réclamations », the rest to « Service client » — with its inbox's default team.
 */
const inboxes = source ? await new Settings(source).inboxes() : []
const inboxNamed = (name: string) => inboxes.find((i) => i.name === name) ?? inboxes[0] ?? null
function routeOf(demo: {
  readonly tags: readonly { label: string }[]
  readonly sentiment: string
}) {
  const inbox =
    demo.sentiment === 'negative'
      ? inboxNamed('Réclamations')
      : demo.tags.some((t) => t.label === TAGS.claim.label)
        ? inboxNamed('Sinistres')
        : inboxNamed('Service client')
  return { inboxId: inbox?.id ?? null, teamId: inbox?.defaultTeamId ?? null }
}
/** The person running the demonstration: `CHAT_DEV_AGENT`, basedb's administrator once linked. */
const ME_ACCOUNT = config.devAgent ?? 'dev-marc'
const MODEL = 'demo'

const TAGS = {
  refund: { label: 'Remboursement', color: '#f59e0b' },
  claim: { label: 'Sinistre', color: '#3b82f6' },
  car: { label: 'Auto', color: '#8b5cf6' },
  home: { label: 'Habitation', color: '#10b981' },
  contract: { label: 'Contrat', color: '#0ea5e9' },
  callback: { label: 'À rappeler', color: '#ef4444' },
}

type Line =
  | { readonly t: string; readonly visitor: string }
  | { readonly t: string; readonly agent: string; readonly by: string }
  | { readonly t: string; readonly note: string; readonly by: string }
  | {
      readonly t: string
      readonly ai: string
      readonly confidence: number
      readonly sources: readonly Source[]
      readonly feedback?: {
        readonly by: string
        readonly action: 'accepted' | 'edited' | 'rejected'
      }
    }
  | { readonly t: string; readonly event: ConversationEvent }
  | {
      readonly t: string
      readonly handoff: {
        readonly reason: string
        readonly summary: string
        readonly confidence: number
        readonly assignee: string
        readonly team: string
      }
    }

interface Demo {
  readonly contact: {
    readonly name: string
    readonly email: string | null
    readonly externalId: string | null
    readonly location?: string
    readonly attributes?: readonly ContactAttribute[]
  }
  readonly status: 'ai' | 'open' | 'pending' | 'resolved'
  readonly assignee: string | null
  readonly unread: boolean
  readonly intent: string
  readonly tags: readonly {
    readonly label: string
    readonly color: string
    readonly byAi?: boolean
  }[]
  readonly sentiment: 'positive' | 'neutral' | 'negative'
  readonly priority: 'low' | 'normal' | 'high'
  readonly summary?: string
  readonly suggestions?: readonly string[]
  readonly lines: readonly Line[]
}

const ME = 'Marc JAMAIN'

const DEMOS: readonly Demo[] = [
  {
    contact: {
      name: 'Sophie Leroy',
      email: 'sophie.leroy@gmail.com',
      externalId: 'CLI-458732',
      location: 'Paris, France',
      attributes: [
        { label: 'Numéro de client', value: 'CLI-458732', kind: 'code' },
        { label: 'Numéro de contrat', value: 'A123456', kind: 'code' },
        { label: 'Produit', value: 'Assurance Auto' },
        { label: 'Garanties', value: 'Tiers étendu' },
        { label: 'Statut du dossier', value: 'En cours', kind: 'status' },
        { label: 'Dernier sinistre', value: '2026-09-12', kind: 'date' },
      ],
    },
    status: 'ai',
    assignee: null,
    unread: true,
    intent: 'Suivi de remboursement',
    tags: [TAGS.refund, TAGS.claim, TAGS.car],
    sentiment: 'positive',
    priority: 'low',
    suggestions: [
      'Je viens de consulter votre dossier : il est complet et en cours de traitement depuis le 14 septembre. Le remboursement est prévu d’ici 5 jours ouvrés.',
      'Votre dossier est bien en cours de traitement. Le remboursement est prévu d’ici 5 jours ouvrés.',
      'Je vous confirme que votre dossier est en cours. Souhaitez-vous être prévenue par e-mail dès le versement ?',
    ],
    lines: [
      {
        t: '2026-09-30T10:23:00',
        visitor: 'Bonjour, quel est le délai de remboursement après un sinistre ?',
      },
      {
        t: '2026-09-30T10:24:00',
        ai: 'Bonjour Sophie ! Le délai de remboursement est généralement de 5 à 10 jours ouvrés après réception de tous les documents nécessaires. Vous pouvez suivre l’avancement de votre dossier depuis votre espace client.\n\nSouhaitez-vous que je consulte votre dossier ?',
        confidence: 0.92,
        sources: [
          {
            title: 'Délai de remboursement d’un sinistre auto',
            origin: 'article',
            detail: 'Article · Remboursement',
          },
          {
            title: 'Conversations similaires',
            origin: 'conversation',
            detail: '3 réponses promues',
            validated: true,
          },
        ],
      },
      { t: '2026-09-30T10:24:30', visitor: 'Oui, consultez mon dossier.' },
      {
        t: '2026-09-30T10:25:00',
        event: {
          type: 'tool',
          tool: 'Consulter le contrat',
          detail: 'Statut du dossier A123456',
        },
      },
    ],
  },
  {
    contact: {
      name: 'Julie Martin',
      email: 'julie.martin@orange.fr',
      externalId: 'CLI-771204',
      location: 'Lyon, France',
    },
    status: 'ai',
    assignee: null,
    unread: true,
    intent: 'Déclaration de sinistre',
    tags: [TAGS.claim, TAGS.home],
    sentiment: 'neutral',
    priority: 'normal',
    lines: [
      {
        t: '2026-09-30T09:40:00',
        visitor: 'Bonjour, je voudrais déclarer un sinistre : dégât des eaux dans ma cuisine.',
      },
      {
        t: '2026-09-30T09:41:00',
        ai: 'Bonjour Julie, je suis désolé pour ce dégât des eaux. Vous pouvez le déclarer directement depuis votre espace client, rubrique « Mes sinistres ». Pensez à joindre des photos et, si un voisin est concerné, le constat amiable dégât des eaux.',
        confidence: 0.81,
        sources: [
          { title: 'Déclarer un dégât des eaux', origin: 'article', detail: 'Article · Sinistre' },
        ],
      },
    ],
  },
  {
    contact: {
      name: 'Thomas Bernard',
      email: 'thomas.bernard@free.fr',
      externalId: 'CLI-208814',
      location: 'Nantes, France',
      attributes: [
        { label: 'Numéro de contrat', value: 'A208814', kind: 'code' },
        { label: 'Produit', value: 'Assurance Auto' },
        { label: 'Garanties', value: 'Tiers étendu' },
      ],
    },
    status: 'open',
    assignee: 'Marc Dupuis',
    unread: false,
    intent: 'Modification de contrat',
    tags: [TAGS.contract, TAGS.car],
    sentiment: 'neutral',
    priority: 'normal',
    summary:
      'Le client veut ajouter sa conjointe comme conductrice secondaire et savoir si la garantie tiers étendu la couvre. Les conditions générales ne suffisent pas : il faut vérifier son contrat.',
    suggestions: [
      'Bonne nouvelle : l’ajout d’un conducteur secondaire est possible sur votre contrat. La garantie tiers étendu la couvrira dans les mêmes conditions que vous.',
      'Pour l’ajouter, il me faut sa date de naissance et la date d’obtention de son permis.',
    ],
    lines: [
      {
        t: '2026-09-30T09:05:00',
        visitor:
          'Bonjour, puis-je ajouter ma conjointe comme conductrice secondaire sur mon contrat auto ?',
      },
      {
        t: '2026-09-30T09:06:00',
        visitor: 'Et est-ce que la garantie tiers étendu la couvrira aussi ?',
      },
      {
        t: '2026-09-30T09:07:00',
        handoff: {
          reason: 'Demande spécifique sur les garanties',
          summary:
            'Le client veut ajouter sa conjointe comme conductrice secondaire et savoir si la garantie tiers étendu la couvre. Les conditions générales ne suffisent pas : il faut vérifier son contrat.',
          confidence: 0.62,
          assignee: 'Marc Dupuis',
          team: 'Équipe Auto',
        },
      },
      {
        t: '2026-09-30T09:12:00',
        by: 'Marc Dupuis',
        agent:
          'Bonjour Thomas, je prends la suite de votre demande. Je vérifie les garanties de votre contrat et je reviens vers vous rapidement.',
      },
    ],
  },
  {
    contact: {
      name: 'Camille Dubois',
      email: 'camille.dubois@gmail.com',
      externalId: 'CLI-330981',
    },
    status: 'ai',
    assignee: null,
    unread: false,
    intent: 'Échéance de contrat',
    tags: [TAGS.contract],
    sentiment: 'neutral',
    priority: 'low',
    lines: [
      {
        t: '2026-09-30T08:45:00',
        visitor: 'Mon contrat arrive à échéance, est-ce qu’il est renouvelé automatiquement ?',
      },
      {
        t: '2026-09-30T08:46:00',
        ai: 'Oui : votre contrat est reconduit chaque année par tacite reconduction. Vous recevez un avis d’échéance au moins 15 jours avant, et vous pouvez le résilier à tout moment après un an.',
        confidence: 0.88,
        sources: [
          {
            title: 'Renouvellement et résiliation',
            origin: 'article',
            detail: 'Article · Contrat',
          },
        ],
        feedback: { by: ME, action: 'accepted' },
      },
    ],
  },
  {
    contact: {
      name: 'Lucas Petit',
      email: 'lucas.petit@outlook.fr',
      externalId: 'CLI-118420',
      location: 'Lille, France',
    },
    status: 'open',
    assignee: ME,
    unread: false,
    intent: 'Dommages sur véhicule',
    tags: [TAGS.claim, TAGS.car, { ...TAGS.callback, byAi: false }],
    sentiment: 'negative',
    priority: 'high',
    summary: 'Accrochage sur un parking, véhicule immobilisé. Le client attend l’expertise.',
    lines: [
      {
        t: '2026-09-29T16:20:00',
        visitor:
          'On m’a embouti sur un parking, ma voiture ne démarre plus. Qu’est-ce que je dois faire ?',
      },
      {
        t: '2026-09-29T16:24:00',
        by: ME,
        agent:
          'Bonjour Lucas, je m’en occupe. Pouvez-vous m’envoyer des photos du véhicule et le constat si vous en avez un ?',
      },
      {
        t: '2026-09-29T16:40:00',
        by: ME,
        note: 'Photos reçues par e-mail. Expertise demandée au garage Martin, attendre son retour avant de rappeler.',
      },
    ],
  },
  {
    contact: {
      name: 'Antoine Moreau',
      email: 'antoine.moreau@gmail.com',
      externalId: 'CLI-902117',
    },
    status: 'resolved',
    assignee: 'Nadia Benali',
    unread: false,
    intent: 'Question sur les garanties',
    tags: [TAGS.home],
    sentiment: 'positive',
    priority: 'low',
    lines: [
      {
        t: '2026-09-29T11:02:00',
        visitor: 'Ma garantie habitation couvre-t-elle le vol de mon vélo dans la cave ?',
      },
      {
        t: '2026-09-29T11:10:00',
        by: 'Nadia Benali',
        agent:
          'Oui, s’il y a eu effraction de la cave et dans la limite de 1 500 €. Il faudra un dépôt de plainte.',
      },
      { t: '2026-09-29T11:15:00', event: { type: 'resolved', agent: 'Nadia Benali' } },
    ],
  },
  {
    contact: { name: 'Emma Richard', email: null, externalId: null },
    status: 'open',
    assignee: null,
    unread: true,
    intent: 'Changement d’adresse',
    tags: [],
    sentiment: 'neutral',
    priority: 'normal',
    lines: [
      {
        t: '2026-09-29T17:48:00',
        visitor: 'Comment changer d’adresse ? Je n’arrive pas à me connecter à mon espace.',
      },
    ],
  },
  {
    contact: { name: 'Hugo Lambert', email: 'hugo.lambert@gmail.com', externalId: 'CLI-450092' },
    status: 'pending',
    assignee: ME,
    unread: false,
    intent: 'Suivi de sinistre',
    tags: [TAGS.claim],
    sentiment: 'neutral',
    priority: 'normal',
    lines: [
      { t: '2026-09-28T14:30:00', visitor: 'Où en est mon dossier sinistre ?' },
      {
        t: '2026-09-28T14:41:00',
        by: ME,
        agent:
          'Il nous manque la facture de réparation. Dès réception, le dossier passe en paiement.',
      },
    ],
  },
]

/** Sophie's earlier conversations — what the « Historique » tab shows. */
const SOPHIE_HISTORY = [
  {
    intent: 'Déclaration du sinistre du 12 septembre',
    question: 'On a percuté l’arrière de ma voiture à un feu rouge, comment je déclare ?',
    t: '2026-09-12T18:04:00',
  },
  {
    intent: 'Attestation d’assurance',
    question: 'Pouvez-vous m’envoyer une attestation d’assurance pour mon nouveau bail ?',
    t: '2026-06-03T09:15:00',
  },
]

const { pool, db } = connect(config.databaseUrl)
await migrateDatabase(db)

await db.transaction(async (tx) => {
  await tx.execute(
    sql`truncate chat.access_log, chat.attachment, chat.ai_feedback, chat.conversation_tag, chat.message, chat.ai_run, chat.kb_chunk, chat.conversation, chat.contact, chat.agent, chat.site_secret cascade`,
  )

  const agentRows = await tx
    .insert(agents)
    .values([
      { basedbUserId: ME_ACCOUNT, name: ME, email: 'marc.jamain@exemple.fr', role: 'supervisor' },
      { basedbUserId: 'dev-mdupuis', name: 'Marc Dupuis', email: 'marc.dupuis@exemple.fr' },
      { basedbUserId: 'dev-nbenali', name: 'Nadia Benali', email: 'nadia.benali@exemple.fr' },
    ])
    .returning()
  const agentId = new Map(agentRows.map((a) => [a.name, a.id]))
  const idOf = (name: string) => {
    const id = agentId.get(name)
    if (id === undefined) throw new Error(`seed: unknown agent ${name}`)
    return id
  }

  for (const demo of DEMOS) {
    const [contact] = await tx
      .insert(contacts)
      .values({
        siteId: SITE.id,
        externalId: demo.contact.externalId,
        name: demo.contact.name,
        email: demo.contact.email,
        identified: demo.contact.externalId !== null,
        location: demo.contact.location ?? null,
        segment: demo.contact.externalId !== null ? 'Particulier' : null,
        attributes: [...(demo.contact.attributes ?? [])],
      })
      .returning()
    if (!contact) throw new Error('seed: contact not inserted')

    const first = demo.lines[0]?.t ?? '2026-09-30T10:00:00'
    const lastText = [...demo.lines].reverse().find((l) => !('event' in l) && !('note' in l))
    const [conversation] = await tx
      .insert(conversations)
      .values({
        contactId: contact.id,
        siteId: SITE.id,
        siteName: SITE.name,
        ...routeOf(demo),
        status: demo.status,
        assigneeId: demo.assignee ? idOf(demo.assignee) : null,
        priority: demo.priority,
        sentiment: demo.sentiment,
        intent: demo.intent,
        summary: demo.summary ?? null,
        agentUnread: demo.unread,
        lastMessageAt: at(lastText?.t ?? first),
        createdAt: at(first),
        updatedAt: at(demo.lines[demo.lines.length - 1]?.t ?? first),
      })
      .returning()
    if (!conversation) throw new Error('seed: conversation not inserted')
    const conversationId = conversation.id

    for (const line of demo.lines) {
      const createdAt = at(line.t)
      if ('visitor' in line) {
        await tx
          .insert(messages)
          .values({ conversationId, author: 'contact', body: line.visitor, createdAt })
      } else if ('agent' in line) {
        await tx.insert(messages).values({
          conversationId,
          author: 'agent',
          agentId: idOf(line.by),
          body: line.agent,
          createdAt,
        })
      } else if ('note' in line) {
        await tx.insert(messages).values({
          conversationId,
          author: 'agent',
          kind: 'note',
          agentId: idOf(line.by),
          body: line.note,
          createdAt,
        })
      } else if ('ai' in line) {
        const [run] = await tx
          .insert(aiRuns)
          .values({
            conversationId,
            kind: 'answer',
            model: MODEL,
            output: { text: line.ai },
            confidence: line.confidence,
            latencyMs: 1400,
            createdAt,
          })
          .returning()
        if (!run) throw new Error('seed: run not inserted')
        await tx.insert(messages).values({
          conversationId,
          author: 'ai',
          body: line.ai,
          meta: { sources: line.sources },
          aiRunId: run.id,
          createdAt,
        })
        if (line.feedback) {
          await tx.insert(aiFeedback).values({
            aiRunId: run.id,
            agentId: idOf(line.feedback.by),
            action: line.feedback.action,
          })
        }
      } else if ('event' in line) {
        await tx.insert(messages).values({
          conversationId,
          author: 'system',
          kind: 'event',
          meta: { event: line.event },
          createdAt,
        })
      } else {
        const [run] = await tx
          .insert(aiRuns)
          .values({
            conversationId,
            kind: 'answer',
            model: MODEL,
            output: { handoff: line.handoff.reason },
            confidence: line.handoff.confidence,
            createdAt,
          })
          .returning()
        await tx.insert(messages).values({
          conversationId,
          author: 'ai',
          kind: 'handoff',
          meta: { handoff: line.handoff },
          aiRunId: run?.id ?? null,
          createdAt,
        })
      }
    }

    if (demo.suggestions) {
      const lastAt = at(demo.lines[demo.lines.length - 1]?.t ?? first)
      await tx.insert(aiRuns).values({
        conversationId,
        kind: 'suggestion',
        model: MODEL,
        output: { suggestions: demo.suggestions },
        createdAt: new Date(lastAt.getTime() + 1000),
      })
    }

    if (demo.tags.length > 0) {
      await tx.insert(conversationTags).values(
        demo.tags.map((tag) => ({
          conversationId,
          label: tag.label,
          color: tag.color,
          origin: tag.byAi === false ? ('agent' as const) : ('ai' as const),
        })),
      )
    }

    if (demo.contact.name === 'Sophie Leroy') {
      for (const past of SOPHIE_HISTORY) {
        const [earlier] = await tx
          .insert(conversations)
          .values({
            contactId: contact.id,
            siteId: SITE.id,
            siteName: SITE.name,
            ...routeOf({ tags: [TAGS.claim], sentiment: 'neutral' }),
            status: 'resolved',
            intent: past.intent,
            agentUnread: false,
            lastMessageAt: new Date(past.t),
            createdAt: new Date(past.t),
            updatedAt: new Date(past.t),
          })
          .returning()
        if (!earlier) throw new Error('seed: conversation not inserted')
        await tx.insert(messages).values({
          conversationId: earlier.id,
          author: 'contact',
          body: past.question,
          createdAt: new Date(past.t),
        })
      }
    }
  }
})

const [counts] = (
  await db.execute<{ conversations: number; messages: number }>(
    sql`select (select count(*) from chat.conversation)::int as conversations, (select count(*) from chat.message)::int as messages`,
  )
).rows
console.log(
  `seed: ${counts?.conversations} conversations, ${counts?.messages} messages — agent de développement : ${ME_ACCOUNT}`,
)
await pool.end()
