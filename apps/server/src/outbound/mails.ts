import type { Mail } from './mailer.js'
import { type Language, plainText, visitorWords } from './words.js'

/**
 * The e-mails the chat writes (D23), each in two parts: plain text, and a sober HTML of
 * the same — one column, the site's colour on the one button. Everything written into
 * the HTML is escaped: the words are visitors', agents', the AI's.
 */

const escaped = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const paragraphs = (text: string) =>
  escaped(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')

function page(content: string, footer: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:24px;font-size:14px;line-height:1.55">${content}</div>
<p style="margin:16px 4px 0;font-size:12px;line-height:1.5;color:#71717a">${footer}</p>
</div></body></html>`
}

const button = (label: string, href: string, color: string) =>
  `<p style="margin:20px 0 4px"><a href="${escaped(href)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:8px">${escaped(label)}</a></p>`

/** A colour safe to write into a style: `#RRGGBB`, or the chat's green. */
const safeColor = (color: string | null) =>
  color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#2da31e'

export interface ReplyLine {
  /** Who wrote: an agent's first name, « Assistant IA », or the site. */
  readonly author: string
  readonly body: string
  readonly files: readonly string[]
}

/** To a visitor who left: the answers they did not see, and the way back to the site. */
export function visitorReplyMail(input: {
  readonly to: string
  readonly language: Language
  readonly site: string
  readonly color: string | null
  readonly lines: readonly ReplyLine[]
  /** The page they last wrote from, when it reads as an https address. */
  readonly link: string | null
}): Mail {
  const w = (source: string, values: Readonly<Record<string, string>> = {}) =>
    visitorWords(input.language, source, values)
  const intro = w(
    input.lines.length > 1
      ? 'Voici les réponses à votre message :'
      : 'Voici la réponse à votre message :',
  )
  const footer = w(
    'Vous recevez cet e-mail parce que vous avez laissé votre adresse dans une conversation avec {site}.',
    { site: input.site },
  )
  const bodyOf = (line: ReplyLine) =>
    [plainText(line.body), ...line.files.map((name) => w('Pièce jointe : {name}', { name }))]
      .filter(Boolean)
      .join('\n')
  const text = [
    w('Bonjour,'),
    '',
    intro,
    '',
    ...input.lines.flatMap((line) => [`${line.author} :`, bodyOf(line), '']),
    input.link
      ? `${w('Reprendre la conversation')} : ${input.link}`
      : w('Pour nous répondre, revenez sur notre site.'),
    '',
    '—',
    footer,
  ].join('\n')
  const html = page(
    [
      `<p style="margin:0 0 12px">${escaped(w('Bonjour,'))}</p>`,
      `<p style="margin:0 0 16px">${escaped(intro)}</p>`,
      ...input.lines.map(
        (line) =>
          `<div style="margin:0 0 12px;padding:12px 14px;border-radius:10px;background:#f4f4f5">
<p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#52525b">${escaped(line.author)}</p>${paragraphs(bodyOf(line))}</div>`,
      ),
      input.link
        ? button(w('Reprendre la conversation'), input.link, safeColor(input.color))
        : `<p style="margin:16px 0 0;color:#52525b">${escaped(w('Pour nous répondre, revenez sur notre site.'))}</p>`,
    ].join('\n'),
    escaped(footer),
  )
  return { to: input.to, subject: w('{site} vous a répondu', { site: input.site }), text, html }
}

/** To an agent away from the inbox: what stayed unread in their bell. */
export function agentAlertMail(input: {
  readonly to: string
  readonly title: string
  readonly site: string
  /** The visitor's last words, when they wrote. */
  readonly excerpt: string | null
  readonly link: string
  readonly product: string
}): Mail {
  const footer = `Vous recevez cet e-mail parce que vous avez demandé, dans ${input.product}, les alertes par e-mail de ce qui reste non lu dix minutes. Le menu de votre compte les arrête.`
  const text = [
    input.title,
    `${input.site}`,
    '',
    ...(input.excerpt ? [`« ${input.excerpt} »`, ''] : []),
    `Ouvrir la conversation : ${input.link}`,
    '',
    '—',
    footer,
  ].join('\n')
  const html = page(
    [
      `<p style="margin:0 0 4px;font-size:16px;font-weight:600">${escaped(input.title)}</p>`,
      `<p style="margin:0 0 16px;font-size:12px;color:#71717a">${escaped(input.site)}</p>`,
      input.excerpt
        ? `<div style="margin:0 0 12px;padding:12px 14px;border-radius:10px;background:#f4f4f5">${paragraphs(input.excerpt)}</div>`
        : '',
      button('Ouvrir la conversation', input.link, '#2da31e'),
    ].join('\n'),
    escaped(footer),
  )
  return { to: input.to, subject: input.title, text, html }
}

/** An invitation, or a new password: the link a supervisor would otherwise hand over. */
export function linkMail(input: {
  readonly to: string
  readonly purpose: 'invite' | 'reset'
  readonly name: string
  /** Who invited them; null when they asked for a new password themselves. */
  readonly by: string | null
  readonly link: string
  readonly product: string
}): Mail {
  const invite = input.purpose === 'invite'
  const subject = invite
    ? `Votre accès à ${input.product}`
    : `Choisissez un nouveau mot de passe — ${input.product}`
  const lead = invite
    ? `${input.by ? `${input.by} vous invite` : 'Vous êtes invité'} à répondre aux conversations dans ${input.product}. Choisissez votre mot de passe pour entrer :`
    : input.by
      ? `${input.by} vous envoie un lien pour choisir un nouveau mot de passe :`
      : 'Vous avez demandé à choisir un nouveau mot de passe :'
  const action = invite ? 'Choisir mon mot de passe' : 'Choisir un nouveau mot de passe'
  const note = invite
    ? 'Ce lien vaut sept jours, une seule fois.'
    : 'Ce lien vaut sept jours, une seule fois. Si vous n’avez rien demandé, ignorez cet e-mail : votre mot de passe ne change pas.'
  const text = [`Bonjour ${input.name},`, '', lead, input.link, '', note].join('\n')
  const html = page(
    [
      `<p style="margin:0 0 12px">${escaped(`Bonjour ${input.name},`)}</p>`,
      `<p style="margin:0">${escaped(lead)}</p>`,
      button(action, input.link, '#2da31e'),
    ].join('\n'),
    escaped(note),
  )
  return { to: input.to, subject, text, html }
}
