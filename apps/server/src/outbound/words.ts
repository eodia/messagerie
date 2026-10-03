import type { AlertKind } from '@chat/contracts'

/**
 * The words of what leaves the chat (D23). What reaches a visitor — an e-mail, an SMS —
 * speaks the site's language, as the widget does; French is the source and the key. What
 * reaches an agent speaks the inbox's, French. The server stores no sentence (D9 bis): these
 * are written at sending, from data.
 */

export type Language = 'fr' | 'en' | 'de' | 'es'

const VISITOR: Readonly<Record<Exclude<Language, 'fr'>, Readonly<Record<string, string>>>> = {
  en: {
    '{site} vous écrit': '{site} writes to you',
    '{site} vous a répondu': '{site} replied to you',
    'Bonjour,': 'Hello,',
    'Voici la réponse à votre message :': 'Here is the answer to your message:',
    'Voici les réponses à votre message :': 'Here are the answers to your message:',
    'Reprendre la conversation': 'Continue the conversation',
    'Pour nous répondre, revenez sur notre site.': 'To answer us, come back to our website.',
    'Vous recevez cet e-mail parce que vous avez laissé votre adresse dans une conversation avec {site}.':
      'You receive this e-mail because you left your address in a conversation with {site}.',
    'Assistant IA': 'AI assistant',
    'Pièce jointe : {name}': 'Attachment: {name}',
  },
  de: {
    '{site} vous écrit': '{site} schreibt Ihnen',
    '{site} vous a répondu': '{site} hat Ihnen geantwortet',
    'Bonjour,': 'Guten Tag,',
    'Voici la réponse à votre message :': 'Hier ist die Antwort auf Ihre Nachricht:',
    'Voici les réponses à votre message :': 'Hier sind die Antworten auf Ihre Nachricht:',
    'Reprendre la conversation': 'Unterhaltung fortsetzen',
    'Pour nous répondre, revenez sur notre site.':
      'Um uns zu antworten, kehren Sie auf unsere Website zurück.',
    'Vous recevez cet e-mail parce que vous avez laissé votre adresse dans une conversation avec {site}.':
      'Sie erhalten diese E-Mail, weil Sie Ihre Adresse in einer Unterhaltung mit {site} hinterlassen haben.',
    'Assistant IA': 'KI-Assistent',
    'Pièce jointe : {name}': 'Anhang: {name}',
  },
  es: {
    '{site} vous écrit': '{site} le escribe',
    '{site} vous a répondu': '{site} le ha respondido',
    'Bonjour,': 'Hola:',
    'Voici la réponse à votre message :': 'Esta es la respuesta a su mensaje:',
    'Voici les réponses à votre message :': 'Estas son las respuestas a su mensaje:',
    'Reprendre la conversation': 'Continuar la conversación',
    'Pour nous répondre, revenez sur notre site.': 'Para respondernos, vuelva a nuestro sitio web.',
    'Vous recevez cet e-mail parce que vous avez laissé votre adresse dans une conversation avec {site}.':
      'Recibe este correo porque dejó su dirección en una conversación con {site}.',
    'Assistant IA': 'Asistente de IA',
    'Pièce jointe : {name}': 'Archivo adjunto: {name}',
  },
}

const fill = (text: string, values: Readonly<Record<string, string>>) =>
  text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all)

/** A visitor's words: `source` in `language`, its `{values}` filled. */
export function visitorWords(
  language: Language,
  source: string,
  values: Readonly<Record<string, string>> = {},
): string {
  const translated = language === 'fr' ? source : (VISITOR[language][source] ?? source)
  return fill(translated, values)
}

/** What an agent's alert says, by its cause — the inbox's bell, in a sentence. */
export function alertTitle(
  kind: AlertKind,
  contact: string,
  by: string | null,
  text: string | null,
): string {
  switch (kind) {
    case 'visitor_message':
      return `${contact} vous a écrit`
    case 'handoff':
      return `L’IA a transmis la conversation avec ${contact}`
    case 'assigned':
      return by
        ? `${by} vous a confié la conversation avec ${contact}`
        : `La conversation avec ${contact} vous est confiée`
    case 'transferred':
      return `La conversation avec ${contact} est transférée à votre équipe`
    case 'woke':
      return `La conversation avec ${contact} est de retour`
    case 'automation':
      return text ? `${contact} : ${text}` : `Une automatisation vous signale ${contact}`
  }
}

/** A text as an address says it — the inbox's `slugOf`, for the links the chat writes. */
function slugOf(text: string, max: number): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')
}

/** Where the inbox opens a conversation (D15): `/conversations/toutes/lea-martin-a9ce42ba3084`. */
export const conversationPath = (id: string, contact: string): string =>
  `/conversations/toutes/${slugOf(contact, 40) || 'conversation'}-${id.replace(/-/g, '').toLowerCase().slice(-12)}`

/**
 * An answer as plain words: what a phone shows, what an e-mail's text part says. The
 * markdown the AI writes — emphasis, links, lists, titles — read as it would be said.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[a-z]*\n?([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '$2')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_all, label: string, url: string) =>
      label === url ? url : `${label} (${url})`,
    )
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
