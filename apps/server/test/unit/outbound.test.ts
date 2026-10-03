import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify,
} from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { phoneOf } from '../../src/channels/provider.js'
import { smsmode } from '../../src/channels/smsmode.js'
import { twilio, twilioSignature, validTwilioSignature } from '../../src/channels/twilio.js'
import { partsOf } from '../../src/outbound/dispatch.js'
import { linkMail, visitorReplyMail } from '../../src/outbound/mails.js'
import {
  encryptPayload,
  knownPushService,
  vapidAuthorization,
  vapidKeys,
} from '../../src/outbound/push.js'
import { conversationPath, plainText, visitorWords } from '../../src/outbound/words.js'

/**
 * What leaves the chat (D23), without a network: Twilio's signatures, Web Push's keys and
 * encryption — decrypted here as a phone would —, the parts of a long SMS, the words.
 */

describe('SMS Mode', () => {
  it('reads a reply under the names it may give', () => {
    expect(
      smsmode.inbound({ messageId: 'a1', from: '33612345678', body: { text: 'Oui' } }),
    ).toEqual({
      from: '+33612345678',
      rcs: false,
      body: 'Oui',
      providerId: 'a1',
      media: [],
    })
    expect(
      smsmode.inbound({ data: { id: 'a2', originator: '+33612345678', text: 'Non' } }),
    ).toMatchObject({
      providerId: 'a2',
      body: 'Non',
    })
    expect(
      smsmode.inbound({ smsID: 'a3', numero: '0033612345678', message: 'Peut-être' }),
    ).toMatchObject({
      from: '+33612345678',
      body: 'Peut-être',
    })
    // Who wrote cannot be told: refused, not guessed.
    expect(smsmode.inbound({ messageId: 'a4', body: { text: 'x' } })).toBeNull()
    expect(smsmode.inbound({ from: '33612345678', body: { text: 'x' } })).toBeNull()
  })

  it('reads how a message went, and says why one failed', () => {
    expect(smsmode.status({ messageId: 'm1', status: { value: 'DELIVERED' } })).toEqual({
      providerId: 'm1',
      status: 'delivered',
      error: null,
      rcs: false,
    })
    expect(smsmode.status({ messageId: 'm2', status: 'undeliverable' })).toEqual({
      providerId: 'm2',
      status: 'failed',
      error: 'SMSMODE_UNDELIVERABLE',
      rcs: false,
    })
    expect(smsmode.status({ messageId: 'm3', status: { value: 'SOMETHING_NEW' } })).toBeNull()
  })

  it('carries a key in its addresses, which a call must bring', () => {
    const number = {
      id: 'n1',
      name: 'SMS',
      provider: 'smsmode' as const,
      phone: '+33600000001',
      accountSid: null,
      tokenEnv: 'K',
      messagingServiceSid: null,
      sender: null,
      rcs: false,
      siteId: null,
      active: true,
    }
    const { inbound, status } = smsmode.addresses('https://chat.exemple.fr', number, 'secret')
    expect(status).toBe(`${inbound}/status`)
    const key = inbound.split('/').pop() ?? ''
    const call = (k: string | null) => ({ url: inbound, payload: {}, headers: {}, key: k })
    const credentials = { accountId: null, secret: 'api-key' }
    expect(smsmode.authentic(call(key), credentials, number, 'secret')).toBe(true)
    expect(smsmode.authentic(call(`${key.slice(0, -1)}x`), credentials, number, 'secret')).toBe(
      false,
    )
    expect(smsmode.authentic(call(null), credentials, number, 'secret')).toBe(false)
    expect(smsmode.authentic(call(key), credentials, { ...number, id: 'n2' }, 'secret')).toBe(false)
  })
  it('writes by RCS first when the number says so, by SMS when RCS is refused', async () => {
    const number = {
      id: 'n1',
      name: 'SMS',
      provider: 'smsmode' as const,
      phone: '+33600000001',
      accountSid: null,
      tokenEnv: 'K',
      messagingServiceSid: null,
      sender: 'ACME',
      rcs: true,
      siteId: null,
      active: true,
    }
    const credentials = { accountId: null, secret: 'api-key' }
    const addresses = { inbound: 'https://chat/in', status: 'https://chat/in/status' }
    const message = { to: '+33612345678', body: 'Bonjour', mediaUrls: [] }
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const answering =
      (rcs: number) =>
      async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
        const status = String(url).includes('/rcs/') ? rcs : 201
        return new Response(
          JSON.stringify(status < 300 ? { messageId: `id-${calls.length}` } : {}),
          {
            status,
          },
        )
      }

    // RCS taken.
    expect(await smsmode.send(credentials, number, message, addresses, answering(201))).toEqual({
      providerId: 'id-1',
      rcs: true,
    })
    expect(calls[0]?.url).toBe('https://rest.smsmode.com/rcs/v1/messages')
    expect(calls[0]?.body).toMatchObject({
      recipient: { to: '33612345678' },
      body: { type: 'TEXT', text: 'Bonjour' },
      callbackUrlStatus: addresses.status,
    })

    // RCS refused: the same words by SMS, from the sender's name.
    calls.length = 0
    expect(await smsmode.send(credentials, number, message, addresses, answering(400))).toEqual({
      providerId: 'id-2',
      rcs: false,
    })
    expect(calls.map((c) => c.url)).toEqual([
      'https://rest.smsmode.com/rcs/v1/messages',
      'https://rest.smsmode.com/sms/v1/messages',
    ])
    expect(calls[1]?.body).toMatchObject({ body: { text: 'Bonjour' }, from: 'ACME' })

    // RCS unavailable for a moment: tried again later, never by SMS meanwhile.
    calls.length = 0
    await expect(
      smsmode.send(credentials, number, message, addresses, answering(503)),
    ).rejects.toMatchObject({ code: 'SMSMODE_503', retry: true })
    expect(calls).toHaveLength(1)

    // A number without RCS: SMS only.
    calls.length = 0
    await smsmode.send(credentials, { ...number, rcs: false }, message, addresses, answering(201))
    expect(calls.map((c) => c.url)).toEqual(['https://rest.smsmode.com/sms/v1/messages'])
  })

  it('says a message went or came by RCS', () => {
    expect(smsmode.status({ messageId: 'm1', status: 'DELIVERED', channel: 'RCS' })?.rcs).toBe(true)
    expect(smsmode.status({ messageId: 'm1', status: 'DELIVERED' })?.rcs).toBe(false)
    expect(
      smsmode.inbound({ messageId: 'm2', from: '33612345678', channel: 'rcs', text: 'Oui' })?.rcs,
    ).toBe(true)
  })
})

describe('Twilio', () => {
  it('signs as its documentation says', () => {
    const params = {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+12349013030',
      Digits: '1234',
      From: '+12349013030',
      To: '+18005551212',
    }
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2'
    expect(twilioSignature('12345', url, params)).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=')
    expect(validTwilioSignature('12345', url, params, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')).toBe(true)
    expect(
      validTwilioSignature(
        '12345',
        url,
        { ...params, Digits: '9' },
        '0/KCTR6DLpKmkAf8muzZqo1nDgQ=',
      ),
    ).toBe(false)
    expect(validTwilioSignature('12345', url, params, undefined)).toBe(false)
  })

  it('says a message went by RCS, from its RCS sender', () => {
    const said = (From: string) =>
      twilio.status({ MessageSid: 'SM1', MessageStatus: 'delivered', From })
    expect(said('rcs:acme_agent')?.rcs).toBe(true)
    expect(said('+33600000001')?.rcs).toBe(false)
  })

  it('reads a number, by SMS or by RCS', () => {
    expect(phoneOf('+33612345678')).toEqual({ phone: '+33612345678', rcs: false })
    expect(phoneOf('rcs:+33612345678')).toEqual({ phone: '+33612345678', rcs: true })
    expect(phoneOf('+33 6 12 34 56 78')).toEqual({ phone: '+33612345678', rcs: false })
    expect(phoneOf('0612345678')).toBeNull()
    expect(phoneOf('33612345678')).toEqual({ phone: '+33612345678', rcs: false })
    expect(phoneOf('whatsapp:hello')).toBeNull()
  })

  it('cuts a long answer at a word, never in the middle of one', () => {
    const text = `${'mot '.repeat(500)}fin`
    const parts = partsOf(text, 100)
    expect(parts.every((p) => p.length <= 100)).toBe(true)
    expect(parts.join(' ')).toBe(text)
    expect(partsOf('court')).toEqual(['court'])
    expect(partsOf('   ')).toEqual([])
  })
})

/** RFC 8291, the phone's side: what `encryptPayload` sealed, opened with its keys. */
function decrypt(body: Buffer, device: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16)
  const keyLength = body.readUInt8(20)
  const serverKey = body.subarray(21, 21 + keyLength)
  const sealed = body.subarray(21 + keyLength)
  const shared = device.computeSecret(serverKey)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), device.getPublicKey(), serverKey])
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32))
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
  )
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
  )
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(sealed.subarray(sealed.length - 16))
  const plain = Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - 16)),
    decipher.final(),
  ])
  expect(plain.at(-1)).toBe(2)
  return plain.subarray(0, plain.length - 1).toString('utf8')
}

describe('Web Push', () => {
  it('draws one VAPID key from the secret, the same every time', () => {
    const a = vapidKeys('a-secret-for-the-tests-of-the-chat-server')
    const b = vapidKeys('a-secret-for-the-tests-of-the-chat-server')
    const c = vapidKeys('another-secret-for-the-tests-of-the-chat')
    expect(a.publicKey).toBe(b.publicKey)
    expect(a.publicKey).not.toBe(c.publicKey)
    expect(Buffer.from(a.publicKey, 'base64url')).toHaveLength(65)
  })

  it('signs a JWT for the push service’s origin, that its public key verifies', () => {
    const keys = vapidKeys('a-secret-for-the-tests-of-the-chat-server')
    const header = vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc',
      keys,
      'mailto:a@b.fr',
      0,
    )
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header) ?? []
    expect(key).toBe(keys.publicKey)
    const [h, c, s] = (token ?? '').split('.')
    expect(JSON.parse(Buffer.from(c ?? '', 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 12 * 3600,
      sub: 'mailto:a@b.fr',
    })
    const raw = Buffer.from(keys.publicKey, 'base64url')
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: raw.subarray(1, 33).toString('base64url'),
        y: raw.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    })
    const good = verify(
      'sha256',
      Buffer.from(`${h}.${c}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s ?? '', 'base64url'),
    )
    expect(good).toBe(true)
  })

  it('encrypts an alert that the device alone opens', () => {
    const device = createECDH('prime256v1')
    device.generateKeys()
    const auth = randomBytes(16)
    const target = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      p256dh: device.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    }
    const payload = JSON.stringify({ title: 'Léa Martin vous a écrit', body: '« Bonjour »' })
    const body = encryptPayload(target, Buffer.from(payload))
    expect(body.readUInt32BE(16)).toBe(4096)
    expect(decrypt(body, device, auth)).toBe(payload)
    const stranger = createECDH('prime256v1')
    stranger.generateKeys()
    expect(() => decrypt(body, stranger, auth)).toThrow()
  })

  it('calls the browsers’ push services, and nothing else', () => {
    expect(knownPushService('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
    expect(knownPushService('https://web.push.apple.com/QGx')).toBe(true)
    expect(knownPushService('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
    expect(knownPushService('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true)
    expect(knownPushService('http://fcm.googleapis.com/fcm/send/abc')).toBe(false)
    expect(knownPushService('https://169.254.169.254/latest')).toBe(false)
    expect(knownPushService('https://evil.example/push.apple.com')).toBe(false)
    expect(knownPushService('https://push.apple.com.evil.example/x')).toBe(false)
  })
})

describe('the words that leave', () => {
  it('say an answer as plain text', () => {
    expect(plainText('**Oui** : voyez [la page](https://acme.fr/sinistre).\n\n- un\n- deux')).toBe(
      'Oui : voyez la page (https://acme.fr/sinistre).\n\n• un\n• deux',
    )
    expect(plainText('## Titre\n_doux_ et `code`')).toBe('Titre\ndoux et code')
  })

  it('speak the site’s language to the visitor, French by default', () => {
    expect(visitorWords('en', '{site} vous a répondu', { site: 'Acme' })).toBe(
      'Acme replied to you',
    )
    expect(visitorWords('fr', '{site} vous a répondu', { site: 'Acme' })).toBe(
      'Acme vous a répondu',
    )
    expect(visitorWords('de', 'Une phrase inconnue')).toBe('Une phrase inconnue')
  })

  it('link to a conversation as the inbox writes its address', () => {
    expect(conversationPath('3f9a2c1e-0000-4000-8000-a9ce42ba3084', 'Léa Martin')).toBe(
      '/conversations/toutes/lea-martin-a9ce42ba3084',
    )
  })

  it('escape what people wrote, in the HTML of an e-mail', () => {
    const mail = visitorReplyMail({
      to: 'lea@exemple.fr',
      language: 'fr',
      site: 'Acme <Assurances>',
      color: 'red;background:url(x)',
      lines: [{ author: 'Paul', body: '<script>alert(1)</script>', files: ['devis.pdf'] }],
      link: 'https://acme.fr/?a="b"',
    })
    expect(mail.subject).toBe('Acme <Assurances> vous a répondu')
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;')
    expect(mail.html).toContain('#2da31e')
    expect(mail.html).not.toContain('url(x)')
    expect(mail.html).toContain('href="https://acme.fr/?a=&quot;b&quot;"')
    expect(mail.text).toContain('Pièce jointe : devis.pdf')
    expect(mail.text).toContain('Reprendre la conversation : https://acme.fr/?a="b"')
  })

  it('write the link of an invitation, or of a new password', () => {
    const input = {
      to: 'paul@exemple.fr',
      purpose: 'invite' as const,
      name: 'Paul',
      by: 'Marc',
      link: 'https://support.exemple.fr/invitation/inv_x',
      product: 'Messagerie',
    }
    const invite = linkMail(input)
    expect(invite.subject).toBe('Votre accès à Messagerie')
    expect(invite.text).toContain('Marc vous invite')
    expect(invite.text).toContain('https://support.exemple.fr/invitation/inv_x')
    const reset = linkMail({ ...input, purpose: 'reset', by: null })
    expect(reset.text).toContain('Si vous n’avez rien demandé')
  })
})
