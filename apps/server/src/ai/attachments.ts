import { type Llm, LlmFailure, Redactor } from '@chat/ai'
import type { Attachment } from '@chat/contracts'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { attachments, conversations, messages } from '../db/schema.js'
import { forInbox } from '../files/attachments.js'
import type { FileStore } from '../files/store.js'
import { type Visible, canSee } from '../inbox/access.js'
import type { AgentRow } from '../inbox/read.js'
import { signalChange } from '../realtime/signals.js'
import { Refusal } from '../refusal.js'
import { recordRun } from './runs.js'

/**
 * A file read by the AI, at an agent's request: an image looked at by the vision model, a
 * PDF read by the provider's OCR, a text file as it is — then what it is, what it says
 * that matters for the request, and what is missing or illegible, in a few lines. Kept on
 * the attachment for the whole team, traced as every call to a model (D9).
 *
 * The agent asks: a file is not sent to a model because it arrived. A text is masked as
 * any other when the model is hosted elsewhere; an image or a PDF cannot be — the inbox
 * says where it goes before the agent asks.
 */

const MAX_TEXT = 30_000

const SYSTEM = `Tu aides le conseiller d'un service client à traiter une demande. Il te montre une pièce jointe envoyée dans la conversation.
Décris-la de façon factuelle et utile : de quoi il s'agit (type de document, photo de quoi), les informations qui comptent pour la demande (dates, montants, références, noms, adresses, dommages visibles), et ce qui manque, paraît illisible ou incohérent.
N'invente rien : ce que tu ne vois pas, dis que tu ne le vois pas. Réponds en français, en cinq à huit puces courtes commençant par « - », puis, si besoin, une ligne « À vérifier : … ». Texte simple : pas de Markdown, ni astérisques ni titres.`

/** The model knows no date: today's, for « Est-ce récent ? ». */
const today = () =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Europe/Paris' }).format(
    new Date(),
  )

export async function analyzeAttachment(
  deps: { readonly db: Db; readonly llm: Llm; readonly redact: boolean; readonly store: FileStore },
  agent: AgentRow,
  visible: Visible,
  id: string,
): Promise<Attachment> {
  const [found] = await deps.db
    .select({
      attachment: attachments,
      conversationId: messages.conversationId,
      inboxId: conversations.inboxId,
    })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(eq(attachments.id, id))
  if (!found || !canSee(visible, found.inboxId)) throw new Refusal('ATTACHMENT_NOT_FOUND', 404)
  const { attachment, conversationId } = found

  let bytes: Buffer
  try {
    bytes = await deps.store.read(attachment.storageKey)
  } catch {
    throw new Refusal('ATTACHMENT_NOT_FOUND', 404)
  }
  const file = { mime: attachment.mime, data: new Uint8Array(bytes) }
  const redactor = new Redactor(deps.redact)
  const intro = `Nous sommes le ${today()}. Pièce jointe : « ${attachment.name} » (${attachment.mime}).`

  let completion: Awaited<ReturnType<Llm['complete']>>
  let read: 'image' | 'ocr' | 'text'
  try {
    if (attachment.mime.startsWith('image/')) {
      read = 'image'
      completion = await deps.llm.complete({
        model: deps.llm.visionModel,
        maxTokens: 700,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: intro, images: [file] },
        ],
      })
    } else {
      let text: string
      if (attachment.mime === 'application/pdf') {
        if (!deps.llm.ocr) throw new Refusal('ATTACHMENT_NOT_ANALYZABLE', 422, { reason: 'ocr' })
        read = 'ocr'
        text = await deps.llm.ocr(file)
      } else if (attachment.mime.startsWith('text/')) {
        read = 'text'
        text = bytes.toString('utf8')
      } else {
        throw new Refusal('ATTACHMENT_NOT_ANALYZABLE', 422, { reason: 'type' })
      }
      if (text.trim() === '') {
        throw new Refusal('ATTACHMENT_NOT_ANALYZABLE', 422, { reason: 'empty' })
      }
      completion = await deps.llm.complete({
        maxTokens: 700,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `${intro}\n\nSon texte :\n\n${redactor.mask(text.slice(0, MAX_TEXT))}`,
          },
        ],
      })
    }
  } catch (error) {
    if (error instanceof LlmFailure) {
      // A provider that does not take images, or this one: said as such.
      if (error.status === 400 || error.status === 422) {
        throw new Refusal('ATTACHMENT_NOT_ANALYZABLE', 422, { reason: 'model' })
      }
      throw new Refusal('AI_UNAVAILABLE', 503)
    }
    throw error
  }

  // Plain text, whatever the model chose: its emphasis would show as asterisks.
  const summary = redactor
    .unmask(completion.text.trim())
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2')
    .replace(/^#+\s*/gm, '')
  if (summary === '') throw new Refusal('INTERNAL_ERROR', 502)
  const analysis = {
    summary,
    model: completion.model,
    at: new Date().toISOString(),
    by: agent.name,
  }

  const row = await deps.db.transaction(async (tx) => {
    await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update')
    const [updated] = await tx
      .update(attachments)
      .set({ analysis })
      .where(eq(attachments.id, id))
      .returning()
    await recordRun(tx, {
      conversationId,
      kind: 'attachment',
      completion,
      input: {
        attachment: id,
        mime: attachment.mime,
        size: attachment.size,
        read,
        agent: agent.id,
      },
      output: { length: summary.length },
    })
    await signalChange(tx, conversationId)
    return updated
  })
  if (!row) throw new Refusal('ATTACHMENT_NOT_FOUND', 404)
  return forInbox(row)
}
