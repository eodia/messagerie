'use client'

import { EmojiPicker } from '@/components/app/emoji-picker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Hint } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { $t, $tp, msg } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { cn } from '@/lib/utils'
import type { CannedReply, Contact, Conversation, Rewording } from '@chat/contracts'
import {
  BookText,
  ChevronDown,
  CircleCheck,
  LoaderCircle,
  MessageSquare,
  Paperclip,
  RefreshCw,
  SendHorizontal,
  SmilePlus,
  Sparkles,
  StickyNote,
  WandSparkles,
  X,
} from 'lucide-react'
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { iconOf, sizeLabel } from './attachments'

type Mode = 'reply' | 'note'

/** basedb's « Réponses types », read once per page: they change seldom. */
let cannedOnce: Promise<CannedReply[]> | null = null
function loadCanned(): Promise<CannedReply[]> {
  cannedOnce ??= api.canned().catch(() => {
    cannedOnce = null
    return []
  })
  return cannedOnce
}

/** {prénom}, {nom}, {email} — the contact as the site signed them. */
function fill(body: string, contact: Contact): string {
  const [first = '', ...rest] = contact.identified ? contact.name.split(/\s+/) : []
  return body
    .replaceAll('{prénom}', first)
    .replaceAll('{nom}', rest.join(' '))
    .replaceAll('{email}', contact.email ?? '')
    .replace(/ {2,}/g, ' ')
    .replace(/ ,/g, ',')
}

/** The `/raccourci` being typed at the end of the draft, if any. */
const SLASH = /(^|\s)\/([\p{L}\p{N}_-]*)$/u

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

const REWORDINGS: readonly { readonly how: Rewording; readonly label: string }[] = [
  { how: 'clearer', label: msg('Plus clair') },
  { how: 'shorter', label: msg('Plus court') },
  { how: 'warmer', label: msg('Plus chaleureux') },
  { how: 'correct', label: msg('Corriger l’orthographe') },
]

/**
 * Where an agent writes: an answer to the visitor, or a note only the team reads. The
 * copilot's suggestions sit above the field; one click puts a suggestion in it, where the
 * agent reads it and sends it — never straight to the visitor. « / » brings the canned
 * replies; the wand rewords the draft.
 */
export function Composer({
  conversation,
  inputRef,
}: {
  readonly conversation: Conversation
  readonly inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  const draft = useInbox((s) => s.drafts[conversation.id] ?? '')
  const sending = useInbox((s) => s.sending)
  const { setDraft, send, fail } = useInbox.getState()
  const [mode, setMode] = useState<Mode>('reply')
  const [suggestionsOpen, setSuggestionsOpen] = useState(true)
  /** The field holds what the copilot wrote: it glows until it is sent. */
  const [fromCopilot, setFromCopilot] = useState(false)
  const [canned, setCanned] = useState<CannedReply[]>([])
  const [browsing, setBrowsing] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [rewording, setRewording] = useState(false)
  const [asking, setAsking] = useState(false)
  /** Files to send with the next message, and why the last ones were refused. */
  const [files, setFiles] = useState<File[]>([])
  const [refused, setRefused] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const typedAt = useRef(0)

  const suggestions = conversation.suggestions
  const canSend = (draft.trim() !== '' || files.length > 0) && !sending

  // Another conversation: the files chosen for this one are not carried over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the conversation is the trigger
  useEffect(() => {
    setFiles([])
    setRefused(null)
  }, [conversation.id])

  function addFiles(chosen: readonly File[]) {
    if (chosen.length === 0) return
    const tooBig = chosen.filter((f) => f.size > MAX_BYTES)
    const fitting = chosen.filter((f) => f.size <= MAX_BYTES)
    const next = [...files, ...fitting].slice(0, MAX_FILES)
    setFiles(next)
    setRefused(
      tooBig.length > 0
        ? $t('« {name} » dépasse 10 Mo.', { name: tooBig[0]?.name ?? '' })
        : files.length + fitting.length > MAX_FILES
          ? $t('Cinq fichiers au plus par message.')
          : null,
    )
    inputRef.current?.focus()
  }

  /** The visitor sees three dots while a reply is written — said every few seconds. */
  function typing(text: string) {
    if (mode !== 'reply' || text.trim() === '' || conversation.status === 'resolved') return
    const now = Date.now()
    if (now - typedAt.current < 2500) return
    typedAt.current = now
    api.typing(conversation.id).catch(() => {})
  }

  function addEmoji(emoji: string) {
    const field = inputRef.current
    const at = field?.selectionStart ?? draft.length
    const end = field?.selectionEnd ?? at
    setDraft(conversation.id, draft.slice(0, at) + emoji + draft.slice(end))
    requestAnimationFrame(() => {
      field?.focus()
      field?.setSelectionRange(at + emoji.length, at + emoji.length)
    })
  }

  useEffect(() => {
    void loadCanned().then(setCanned)
  }, [])

  // New suggestions arrived: the copilot is done thinking.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the suggestions are the trigger
  useEffect(() => setAsking(false), [suggestions.join('\n')])

  const typed = SLASH.exec(draft)
  const query = typed ? (typed[2] ?? '') : ''
  const listing = mode === 'reply' && (browsing || typed !== null)
  const matches = useMemo(() => {
    const needle = fold(query)
    return canned
      .filter((c) => !needle || fold(`${c.shortcut ?? ''} ${c.title}`).includes(needle))
      .slice(0, 8)
  }, [canned, query])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search starts at the top
  useEffect(() => setHighlight(0), [query, browsing])

  async function submit(andResolve = false) {
    if (!canSend) return
    // A refused send keeps the draft and the files; the inbox says why.
    if (await send(conversation.id, draft.trim(), mode, andResolve, files)) {
      setFromCopilot(false)
      setFiles([])
      setRefused(null)
    }
  }

  function take(suggestion: string) {
    setMode('reply')
    setDraft(conversation.id, suggestion)
    setFromCopilot(true)
    inputRef.current?.focus()
  }

  function insert(reply: CannedReply) {
    const text = fill(reply.body, conversation.contact)
    const next = typed
      ? draft.replace(SLASH, (_all, lead: string) => `${lead}${text}`)
      : draft
        ? `${draft} ${text}`
        : text
    setDraft(conversation.id, next)
    setBrowsing(false)
    inputRef.current?.focus()
  }

  async function reword(how: Rewording) {
    if (!draft.trim()) return
    setRewording(true)
    try {
      const { text } = await api.rephrase(conversation.id, draft, how)
      setDraft(conversation.id, text)
      setFromCopilot(true)
    } catch (error) {
      fail(error)
    } finally {
      setRewording(false)
    }
  }

  async function askCopilot() {
    setAsking(true)
    setSuggestionsOpen(true)
    try {
      await api.suggest(conversation.id)
      // They arrive by the live stream; if nothing comes, the button is back in a while.
      setTimeout(() => setAsking(false), 25_000)
    } catch (error) {
      setAsking(false)
      fail(error)
    }
  }

  return (
    <div className="shrink-0 border-t bg-background">
      <div className="flex h-10 items-center gap-5 border-b px-4" role="tablist">
        <ModeTab active={mode === 'reply'} onClick={() => setMode('reply')} icon={MessageSquare}>
          {$t('Répondre')}
        </ModeTab>
        <ModeTab active={mode === 'note'} onClick={() => setMode('note')} icon={StickyNote}>
          {$t('Note interne')}
        </ModeTab>
        {mode === 'reply' && (suggestions.length === 0 || !suggestionsOpen) && (
          <button
            type="button"
            disabled={asking}
            onClick={() => (suggestions.length > 0 ? setSuggestionsOpen(true) : void askCopilot())}
            className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {asking ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5 text-violet-600 dark:text-violet-300" />
            )}
            {asking
              ? $t('Le copilote réfléchit…')
              : suggestions.length > 0
                ? $tp(suggestions.length, '{count} suggestion', '{count} suggestions')
                : $t('Demander au copilote')}
          </button>
        )}
      </div>

      {mode === 'reply' && suggestions.length > 0 && suggestionsOpen && (
        <div className="px-4 pt-3 pb-1">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <Sparkles className="size-3 text-violet-600 dark:text-violet-300" />
            {$t('Suggestions du copilote')}
            <span className="ml-auto flex items-center gap-0.5">
              <Hint label={$t('D’autres suggestions')}>
                <button
                  type="button"
                  disabled={asking}
                  onClick={() => void askCopilot()}
                  className="rounded p-0.5 hover:bg-accent hover:text-foreground disabled:opacity-60"
                >
                  <RefreshCw className={cn('size-3.5', asking && 'animate-spin')} />
                </button>
              </Hint>
              <Hint label={$t('Masquer les suggestions')}>
                <button
                  type="button"
                  onClick={() => setSuggestionsOpen(false)}
                  className="rounded p-0.5 hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </Hint>
            </span>
          </div>
          <div className={cn('grid grid-cols-1 gap-2 lg:grid-cols-3', asking && 'opacity-50')}>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => take(suggestion)}
                className="rounded-lg border bg-background p-2.5 text-left text-xs leading-snug text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
              >
                <span className="line-clamp-3">{suggestion}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className="relative p-3"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDropping(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return
          event.preventDefault()
          setDropping(false)
          addFiles([...event.dataTransfer.files])
        }}
      >
        {dropping && (
          <div className="pointer-events-none absolute inset-3 top-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/60 bg-background/90 text-sm font-medium">
            <Paperclip className="mr-2 size-4" />
            {$t('Déposez les fichiers ici')}
          </div>
        )}
        {listing && (
          <div className="absolute inset-x-3 bottom-full z-20 mb-1 overflow-hidden rounded-lg border bg-popover shadow-lg">
            <div className="flex items-center gap-2 border-b px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              <BookText className="size-3.5" />
              {$t('Réponses types')}
              <span className="ml-auto flex items-center gap-1 normal-case tracking-normal">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <Kbd>↵</Kbd>
              </span>
            </div>
            {matches.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                {canned.length === 0
                  ? $t(
                      'Aucune réponse type : elles se rédigent dans basedb, table « Réponses types ».',
                    )
                  : $t('Aucune réponse type ne correspond.')}
              </div>
            ) : (
              <ul className="max-h-64 overflow-y-auto p-1 scroll-discret">
                {matches.map((reply, index) => (
                  <li key={reply.id}>
                    <button
                      type="button"
                      aria-current={index === highlight}
                      onMouseEnter={() => setHighlight(index)}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        insert(reply)
                      }}
                      className={cn(
                        'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left',
                        index === highlight && 'bg-accent',
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm">
                        {reply.title}
                        {reply.shortcut && (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            /{reply.shortcut}
                          </span>
                        )}
                      </span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {fill(reply.body, conversation.contact)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div
          className={cn(
            'rounded-xl p-px',
            fromCopilot && mode === 'reply' ? 'animate-ai-turn bg-ai-edge' : 'bg-border',
          )}
        >
          <div className={cn('rounded-[11px]', mode === 'note' ? 'bg-note' : 'bg-background')}>
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
                {files.map((file, index) => (
                  <PendingFile
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    file={file}
                    onRemove={() => setFiles(files.filter((_, i) => i !== index))}
                  />
                ))}
              </ul>
            )}
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => {
                setDraft(conversation.id, event.target.value)
                typing(event.target.value)
              }}
              onPaste={(event) => {
                const pasted = [...event.clipboardData.files]
                if (pasted.length === 0) return
                event.preventDefault()
                addFiles(pasted)
              }}
              onBlur={() => setBrowsing(false)}
              onKeyDown={(event) => {
                if (listing && matches.length > 0) {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    const step = event.key === 'ArrowDown' ? 1 : -1
                    setHighlight((at) => (at + step + matches.length) % matches.length)
                    return
                  }
                  if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault()
                    const chosen = matches[highlight]
                    if (chosen) insert(chosen)
                    return
                  }
                }
                if (listing && event.key === 'Escape') {
                  event.preventDefault()
                  setBrowsing(false)
                  if (typed)
                    setDraft(
                      conversation.id,
                      draft.replace(SLASH, (_all, lead: string) => lead),
                    )
                  return
                }
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void submit()
                }
              }}
              rows={2}
              placeholder={
                mode === 'reply'
                  ? $t('Écrire au visiteur — « / » pour une réponse type…')
                  : $t('Une note pour l’équipe : le visiteur ne la verra pas.')
              }
              className="field-sizing-content block max-h-48 min-h-16 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            {refused && (
              <p className="px-3 pb-1 text-xs text-destructive" role="alert">
                {refused}
              </p>
            )}
            <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                accept={ACCEPT}
                onChange={(event) => {
                  addFiles([...(event.target.files ?? [])])
                  event.target.value = ''
                }}
              />
              <Hint label={$t('Joindre des fichiers — ou glissez-les, ou collez une image')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={$t('Joindre des fichiers')}
                  className="size-7 text-muted-foreground"
                  onClick={() => picker.current?.click()}
                >
                  <Paperclip className="size-4" />
                </Button>
              </Hint>
              <EmojiPicker onPick={addEmoji}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={$t('Emoji')}
                  className="size-7 text-muted-foreground"
                >
                  <SmilePlus className="size-4" />
                </Button>
              </EmojiPicker>
              {mode === 'reply' && (
                <Hint label={$t('Réponses types — ou « / » dans le texte')}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn('size-7 text-muted-foreground', browsing && 'bg-accent')}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setBrowsing((open) => !open)
                      inputRef.current?.focus()
                    }}
                  >
                    <BookText className="size-4" />
                  </Button>
                </Hint>
              )}
              <DropdownMenu>
                <Hint label={$t('Reformuler avec l’IA')}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!draft.trim() || rewording}
                      className="size-7 text-muted-foreground"
                    >
                      {rewording ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <WandSparkles className="size-4" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                </Hint>
                <DropdownMenuContent side="top" align="start">
                  <DropdownMenuLabel>{$t('Reformuler le brouillon')}</DropdownMenuLabel>
                  {REWORDINGS.map(({ how, label }) => (
                    <DropdownMenuItem key={how} onSelect={() => void reword(how)}>
                      {$t(label)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="ml-auto hidden items-center gap-1 pr-2 text-[11px] text-muted-foreground md:flex">
                <Kbd>↵</Kbd> {$t('envoyer')}
                <span className="mx-1 text-muted-foreground/50">·</span>
                <Kbd>Maj</Kbd>
                <Kbd>↵</Kbd> {$t('à la ligne')}
              </span>
              {mode === 'reply' ? (
                <div className="flex">
                  <Button
                    size="sm"
                    disabled={!canSend}
                    onClick={() => void submit()}
                    className="rounded-r-none"
                  >
                    <SendHorizontal />
                    {$t('Envoyer')}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        disabled={!canSend}
                        aria-label={$t('Autres façons d’envoyer')}
                        className="rounded-l-none border-l border-primary-foreground/25 px-2"
                      >
                        <ChevronDown />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="top">
                      <DropdownMenuItem onSelect={() => void submit(true)}>
                        <CircleCheck />
                        {$t('Envoyer et résoudre')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canSend}
                  onClick={() => void submit()}
                >
                  <StickyNote />
                  {$t('Ajouter la note')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** What the composer takes: what the server keeps (images, PDF, text, Word, Excel). */
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,.txt,.csv,.md,.docx,.xlsx'
const MAX_BYTES = 10 * 1024 * 1024
const MAX_FILES = 5

/** A file waiting to go: a thumbnail for an image, a card for the rest. */
function PendingFile({ file, onRemove }: { readonly file: File; readonly onRemove: () => void }) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const Icon = iconOf(file.type)
  return (
    <li className="group relative flex h-12 max-w-56 items-center gap-2 rounded-lg border bg-muted/40 pr-7 pl-1.5">
      {preview ? (
        <img src={preview} alt="" className="size-9 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background">
          <Icon className="size-4 text-muted-foreground" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{file.name}</span>
        <span className="block text-[10px] text-muted-foreground">{sizeLabel(file.size)}</span>
      </span>
      <button
        type="button"
        aria-label={$t('Retirer {name}', { name: file.name })}
        onClick={onRemove}
        className="absolute top-1 right-1 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </li>
  )
}

function ModeTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  readonly active: boolean
  readonly onClick: () => void
  readonly icon: typeof MessageSquare
  readonly children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-10 items-center gap-1.5 text-sm font-medium transition-colors',
        active
          ? "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:content-['']"
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  )
}
