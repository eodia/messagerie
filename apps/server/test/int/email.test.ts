import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { and, eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { automationPass, drainEvents } from '../../src/automations/engine.js'
import {
  automationRunList,
  createAutomation,
  setAutomationActive,
} from '../../src/automations/manage.js'
import {
  type Mailbox,
  type MailboxDeps,
  readMailbox,
  receiveEmail,
  replyText,
} from '../../src/channels/email.js'
import { type Db, connect, migrateDatabase } from '../../src/db/client.js'
import {
  agents,
  type attachments,
  contacts,
  conversations,
  messages,
  outbound,
} from '../../src/db/schema.js'
import { signLinksWith } from '../../src/files/attachments.js'
import { MemoryStore } from '../../src/files/store.js'
import { Access } from '../../src/inbox/access.js'
import { startConversation } from '../../src/inbox/outreach.js'
import type { AgentRow } from '../../src/inbox/read.js'
import { sendMessage } from '../../src/inbox/write.js'
import { deliverDue } from '../../src/outbound/dispatch.js'
import type { Mail, Mailer } from '../../src/outbound/mailer.js'
import { DatabaseSource } from '../../src/settings/database.js'
import { loadDemoSettings } from '../../src/settings/demo.js'
import { type EmailAddress, Settings } from '../../src/settings/settings.js'

/**
 * The e-mail channel (D24), against a real PostgreSQL: a mail that arrives becomes a
 * conversation, once; the answers go back in its thread, by the address's server; the
 * customer's reply finds its conversation — one of the widget's too —; a mailbox is read
 * and marked.
 */

const SECRET = 'a-secret-for-the-tests-of-the-chat-server'
const ENV = { SUPPORT_PASSWORD: 'mot-de-passe' }

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Db
let source: DatabaseSource
let settings: Settings
let supervisor: AgentRow
let siteId: string
let address: EmailAddress
const files = new MemoryStore()

/** What the address's server was given. */
const sent: Mail[] = []
let next = 0
const mailer: Mailer = {
  async send(mail) {
    sent.push(mail)
    next += 1
    return `<sent-${next}@acme.example>`
  },
}

const deps = (): MailboxDeps => ({ db, settings, files, aiAvailable: false, env: ENV })
const postman = () =>
  deliverDue({
    db,
    settings,
    config: {
      secret: SECRET,
      publicUrl: 'https://chat.exemple.fr',
      webOrigin: 'http://localhost:3210',
      pushSubject: 'mailto:a@b.fr',
    },
    mailer: null,
    files,
    env: ENV,
    addressMailer: () => mailer,
  })

function mail(fields: {
  from: string
  subject: string
  body: string
  id: string
  inReplyTo?: string
  headers?: string
}): string {
  return [
    `From: ${fields.from}`,
    'To: support@acme.example',
    `Subject: ${fields.subject}`,
    `Message-ID: ${fields.id}`,
    ...(fields.inReplyTo
      ? [`In-Reply-To: ${fields.inReplyTo}`, `References: ${fields.inReplyTo}`]
      : []),
    ...(fields.headers ? [fields.headers] : []),
    'Date: Fri, 2 Oct 2026 09:00:00 +0200',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    fields.body,
  ].join('\r\n')
}

const conversationOf = async (email: string) => {
  const [row] = await db
    .select({ conversation: conversations })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(contacts.email, email))
    .orderBy(sql`${conversations.createdAt} desc`)
    .limit(1)
  return row?.conversation
}

beforeAll(async () => {
  signLinksWith(SECRET)
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  ;({ pool, db } = connect(container.getConnectionUri()))
  await migrateDatabase(db)
  await loadDemoSettings(db)
  source = new DatabaseSource(db, container.getConnectionUri())
  settings = new Settings(source)
  const [site] = await settings.sites()
  siteId = site?.id ?? ''
  const id = await source.create('Adresses e-mail', {
    Nom: 'Support',
    Adresse: 'Support@Acme.example',
    'Serveur IMAP': 'imap.acme.example',
    'Serveur SMTP': 'smtp.acme.example:587',
    "Mot de passe (variable d'environnement)": 'SUPPORT_PASSWORD',
    'Lire la boîte': true,
    Site: siteId,
    Actif: true,
  })
  const found = await settings.emailAddress(id)
  if (!found) throw new Error('no address')
  address = found
  const [me] = await db.select().from(agents).where(eq(agents.role, 'supervisor'))
  if (!me) throw new Error('no supervisor')
  supervisor = me
}, 180_000)

afterAll(async () => {
  await source?.close()
  await pool?.end()
  await container?.stop()
})

beforeEach(() => {
  sent.length = 0
})

describe('an address of « Adresses e-mail »', () => {
  it('reads its servers and account as written', () => {
    expect(address).toMatchObject({
      address: 'support@acme.example',
      login: 'support@acme.example',
      imap: { host: 'imap.acme.example', port: 993 },
      smtp: { host: 'smtp.acme.example', port: 587 },
      receive: true,
    })
  })
})

describe('a mail that arrives', () => {
  it('becomes a conversation by e-mail, once — without what it quoted', async () => {
    const raw = mail({
      from: 'Léa Martin <lea@exemple.fr>',
      subject: 'Mon sinistre du 28',
      id: '<lea-1@exemple.fr>',
      body: 'Bonjour,\r\nOù en est mon dossier ?\r\n\r\nLe 1 oct. 2026, Acme a écrit :\r\n> Bonjour Léa',
    })
    expect(await receiveEmail(deps(), address, raw)).toBe('written')
    expect(await receiveEmail(deps(), address, raw)).toBe('duplicate')
    const conversation = await conversationOf('lea@exemple.fr')
    expect(conversation).toMatchObject({ channel: 'email', emailAddressId: address.id, siteId })
    const said = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation?.id ?? ''))
    expect(said.map((m) => m.body)).toEqual(['Bonjour,\nOù en est mon dossier ?'])
    expect(said[0]?.meta).toEqual({
      providerId: '<lea-1@exemple.fr>',
      email: { subject: 'Mon sinistre du 28' },
    })
    const [contact] = await db.select().from(contacts).where(eq(contacts.email, 'lea@exemple.fr'))
    expect(contact?.name).toBe('Léa Martin')
  })

  it('leaves out what no person wrote, and what the address sent itself', async () => {
    const auto = mail({
      from: 'lea@exemple.fr',
      subject: 'Absence',
      id: '<auto-1@exemple.fr>',
      body: 'Je suis absente.',
      headers: 'Auto-Submitted: auto-replied',
    })
    expect(await receiveEmail(deps(), address, auto)).toBe('ignored')
    const self = mail({ from: 'support@acme.example', subject: 'x', id: '<self@acme>', body: 'x' })
    expect(await receiveEmail(deps(), address, self)).toBe('ignored')
    const daemon = mail({ from: 'MAILER-DAEMON@mx.example', subject: 'x', id: '<d@mx>', body: 'x' })
    expect(await receiveEmail(deps(), address, daemon)).toBe('ignored')
  })

  it('is answered in its thread, by the address — and the answer to that, in the same conversation', async () => {
    const conversation = await conversationOf('lea@exemple.fr')
    const id = conversation?.id ?? ''
    await files.put(`${id}/f1`, new Uint8Array(Buffer.from('%PDF-1.4 devis')))
    await sendMessage(
      db,
      supervisor,
      id,
      { body: '**Bonjour Léa** : il est complet.', kind: 'reply' },
      (messageId) => [
        {
          id: '00000000-0000-4000-8000-0000000000f1',
          messageId,
          storageKey: `${id}/f1`,
          name: 'devis.pdf',
          mime: 'application/pdf',
          size: 14,
        },
      ],
    )
    const [queued] = await db.select().from(outbound).where(eq(outbound.conversationId, id))
    expect(queued).toMatchObject({ channel: 'email', purpose: 'message', status: 'pending' })
    await postman()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: 'lea@exemple.fr',
      subject: 'Re: Mon sinistre du 28',
      inReplyTo: '<lea-1@exemple.fr>',
      references: ['<lea-1@exemple.fr>'],
    })
    expect(sent[0]?.text).toContain('Bonjour Léa : il est complet.')
    expect(sent[0]?.text).toContain('Marc — Acme Assurances')
    expect(sent[0]?.attachments?.map((a) => a.filename)).toEqual(['devis.pdf'])

    const reply = mail({
      from: 'lea@exemple.fr',
      subject: 'Re: Mon sinistre du 28',
      id: '<lea-2@exemple.fr>',
      inReplyTo: '<sent-1@acme.example>',
      body: 'Merci beaucoup !',
    })
    expect(await receiveEmail(deps(), address, reply)).toBe('written')
    const said = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, id), eq(messages.author, 'contact')))
    expect(said.map((m) => m.body)).toEqual([
      'Bonjour,\nOù en est mon dossier ?',
      'Merci beaucoup !',
    ])
  })

  it('brings a visitor of the widget back to their conversation, which goes on by e-mail', async () => {
    const [contact] = await db
      .insert(contacts)
      .values({ siteId, name: 'Paul', email: 'paul@exemple.fr' })
      .returning()
    const [web] = await db
      .insert(conversations)
      .values({ contactId: contact?.id ?? '', siteId, siteName: 'Acme Assurances', status: 'open' })
      .returning()
    const id = web?.id ?? ''
    await sendMessage(db, supervisor, id, { body: 'Votre devis est prêt.', kind: 'reply' })
    await db.execute(sql`update chat.outbound set next_attempt_at = now()`)
    await postman()
    // Sent by the site's own address: what Paul answers comes back here.
    expect(sent.map((m) => m.to)).toEqual(['paul@exemple.fr'])
    const [row] = await db.select().from(outbound).where(eq(outbound.conversationId, id))
    const answer = mail({
      from: 'paul@exemple.fr',
      subject: 'Re: Acme Assurances vous a répondu',
      id: '<paul-1@exemple.fr>',
      inReplyTo: row?.providerId ?? '',
      body: 'Parfait, je signe.',
    })
    expect(await receiveEmail(deps(), address, answer)).toBe('written')
    const [now] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(now).toMatchObject({ channel: 'email', emailAddressId: address.id })
  })
})

describe('a mailbox', () => {
  it('is read: what is unread written, all of it marked read', async () => {
    const box = {
      mails: new Map<number, string>([
        [
          7,
          mail({
            from: 'ines@exemple.fr',
            subject: 'Bonjour',
            id: '<ines-1@exemple.fr>',
            body: 'Une question.',
          }),
        ],
        [
          8,
          mail({
            from: 'ines@exemple.fr',
            subject: 'Absence',
            id: '<ines-2@exemple.fr>',
            body: 'x',
            headers: 'Precedence: auto_reply',
          }),
        ],
      ]),
      read: [] as number[],
      closed: false,
    }
    const fake: Mailbox = {
      unread: async () => [...box.mails.keys()],
      source: async (uid) => Buffer.from(box.mails.get(uid) ?? ''),
      markRead: async (uid) => {
        box.read.push(uid)
      },
      close: async () => {
        box.closed = true
      },
    }
    expect(await readMailbox(deps(), address, async () => fake)).toBe(1)
    expect(box.read).toEqual([7, 8])
    expect(box.closed).toBe(true)
    expect((await conversationOf('ines@exemple.fr'))?.channel).toBe('email')
    // Without its password, the box is not opened.
    expect(await readMailbox({ ...deps(), env: {} }, address, async () => fake)).toBe(0)
  })
})

describe('writing first by e-mail, with the site’s address', () => {
  it('opens a conversation by e-mail, which leaves at once by the address', async () => {
    const started = await startConversation(
      { db, settings, email: false, env: ENV },
      supervisor,
      null,
      { channel: 'email', email: 'noe@exemple.fr', name: 'Noé', siteId, body: 'Bonjour Noé.' },
    )
    expect(started).toMatchObject({ channel: 'email' })
    await postman()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: 'noe@exemple.fr', subject: 'Acme Assurances vous écrit' })
  })
})

describe('an automation, when an SMS does not reach the customer', () => {
  it('writes to them by e-mail — the SMS conversations only', async () => {
    const manage = {
      db,
      settings,
      secret: SECRET,
      publicUrl: 'https://chat.exemple.fr',
      poke: () => {},
    }
    const made = await createAutomation(manage, supervisor, {
      name: 'SMS non remis : un e-mail',
      description: '',
      trigger: { kind: 'undelivered' },
      condition: { match: 'all', rules: [{ field: 'channel', op: 'is', values: ['sms', 'rcs'] }] },
      steps: [
        {
          id: 's1',
          kind: 'send',
          channel: 'email',
          body: 'Bonjour {{contact.prenom}}, notre SMS ne vous est pas parvenu : votre dossier est complet.',
        },
      ],
    })
    await setAutomationActive(manage, supervisor, made.id, true)

    const [contact] = await db
      .insert(contacts)
      .values({ siteId, name: 'Hugo Lambert', phone: '+33655555555', email: 'hugo@exemple.fr' })
      .returning()
    const [sms] = await db
      .insert(conversations)
      .values({
        contactId: contact?.id ?? '',
        siteId,
        siteName: 'Acme Assurances',
        status: 'open',
        channel: 'sms',
      })
      .returning()
    await sendMessage(db, supervisor, sms?.id ?? '', {
      body: 'Votre dossier est complet.',
      kind: 'reply',
    })
    // The provider refused it for good.
    await db
      .update(outbound)
      .set({ status: 'failed', error: 'TWILIO_30006' })
      .where(eq(outbound.conversationId, sms?.id ?? ''))

    const engine = {
      db,
      settings,
      access: new Access(settings),
      llm: null,
      redact: true,
      webOrigin: 'http://localhost:3210',
      email: false,
    }
    await drainEvents(engine)
    await automationPass(engine)
    const runs = (await automationRunList(manage, supervisor, made.id)).items
    expect(runs.map((r) => r.status)).toEqual(['succeeded'])
    expect(runs[0]?.steps[0]).toMatchObject({
      kind: 'send',
      status: 'succeeded',
      detail: 'hugo@exemple.fr',
    })

    await postman()
    expect(sent.map((m) => m.to)).toEqual(['hugo@exemple.fr'])
    expect(sent[0]?.text).toContain('Bonjour Hugo, notre SMS ne vous est pas parvenu')
    const mailed = await conversationOf('hugo@exemple.fr')
    expect(mailed).toMatchObject({ channel: 'email', status: 'open', assigneeId: null })
  })
})

describe('what the customer wrote', () => {
  it('stops at the quote and the signature', () => {
    expect(replyText('Oui.\n\nOn Fri, Oct 2, 2026 at 9:00 AM Acme <a@b.fr> wrote:\n> old')).toBe(
      'Oui.',
    )
    expect(replyText('Merci\n-- \nLéa, 06 12 34 56 78')).toBe('Merci')
    expect(replyText('> tout est cité')).toBe('> tout est cité')
  })
})
