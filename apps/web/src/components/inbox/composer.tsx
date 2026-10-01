'use client'

import { EmojiPicker } from '@/components/app/emoji-picker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Hint } from '@/components/ui/tooltip'
import { ApiFailure, api } from '@/lib/api'
import { $t, $tp, msg } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { cn } from '@/lib/utils'
import type { CannedReply, Contact, Conversation, Rewording } from '@chat/contracts'
import { EditorContent } from '@tiptap/react'
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
  SpellCheck,
  StickyNote,
  WandSparkles,
  X,
} from 'lucide-react'
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { iconOf, sizeLabel } from './attachments'
import { FormatButtons, useDraftEditor } from './draft-editor'
import { accept, correctionsOf, forget, propose, textOf } from './proofreading'

/** What the thread asks of the composer: the field, focused. */
export interface ComposerHandle {
  focus: () => void
}

const PROOF_KEY = 'chat.proofreading'

/** Whether the AI reads the draft over after a pause — the agent's choice, in this browser. */
function proofreadingOn(): boolean {
  try {
    return window.localStorage.getItem(PROOF_KEY) !== 'off'
  } catch {
    return true
  }
}

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
  readonly inputRef: RefObject<ComposerHandle | null>
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
  /** The AI's proofreading: how many corrections it offers, whether it is reading. */
  const [corrections, setCorrections] = useState(0)
  const [checking, setChecking] = useState(false)
  const [clean, setClean] = useState(false)
  const [autoProof, setAutoProof] = useState(proofreadingOn)
  /** No AI on this server: not asked again. */
  const proofless = useRef(false)
  const lastRead = useRef('')

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
    editor?.commands.focus()
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
    editor?.chain().focus().insertContent(emoji).run()
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

  /** Keys over the field while the canned replies are open: they choose one. */
  function cannedKey(event: KeyboardEvent): boolean {
    if (listing && matches.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1
        setHighlight((at) => (at + step + matches.length) % matches.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const chosen = matches[highlight]
        if (chosen) insert(chosen)
        return true
      }
    }
    if (listing && event.key === 'Escape') {
      setBrowsing(false)
      if (typed)
        setDraft(
          conversation.id,
          draft.replace(SLASH, (_all, lead: string) => lead),
        )
      return true
    }
    return false
  }

  const editor = useDraftEditor({
    value: draft,
    placeholder:
      mode === 'reply'
        ? $t('Écrire au visiteur — « / » pour une réponse type…')
        : $t('Une note pour l’équipe : le visiteur ne la verra pas.'),
    onChange: (markdown) => {
      setDraft(conversation.id, markdown)
      typing(markdown)
      setClean(false)
    },
    onKey: cannedKey,
    onSubmit: () => void submit(),
    onFiles: addFiles,
    onCorrections: setCorrections,
  })

  useImperativeHandle(inputRef, () => ({ focus: () => editor?.commands.focus('end') }), [editor])

  /** Once the draft set elsewhere is in the field. */
  function focusSoon() {
    setTimeout(() => editor?.commands.focus('end'), 0)
  }

  /**
   * The AI reads the draft over and offers its corrections in it — after a pause, or now
   * when asked. Only if the draft is still what it read.
   */
  async function proofread(now = false) {
    if (!editor || proofless.current) return
    const basis = textOf(editor.state.doc).text
    const words = basis.trim() === '' ? 0 : basis.trim().split(/\s+/).length
    if (words < (now ? 1 : 3) || (!now && basis === lastRead.current)) return
    lastRead.current = basis
    setChecking(true)
    try {
      const { text } = await api.rephrase(conversation.id, basis, 'correct')
      if (editor.isDestroyed || textOf(editor.state.doc).text !== basis) return
      propose(editor.view, text)
      setClean(correctionsOf(editor.state).length === 0)
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'AI_UNAVAILABLE') proofless.current = true
      if (now) fail(error)
    } finally {
      setChecking(false)
    }
  }

  // After a pause in the typing, if the agent wants it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft is the trigger
  useEffect(() => {
    if (!autoProof || !editor) return
    const timer = setTimeout(() => void proofread(), 1800)
    return () => clearTimeout(timer)
  }, [draft, autoProof, editor])

  function chooseAutoProof(on: boolean) {
    setAutoProof(on)
    try {
      window.localStorage.setItem(PROOF_KEY, on ? 'on' : 'off')
    } catch {
      // Kept for this page only.
    }
    if (!on && editor) forget(editor.view)
  }

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
    focusSoon()
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
    focusSoon()
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
            'relative rounded-xl border shadow-xs transition-[border-color,box-shadow]',
            mode === 'note'
              ? 'border-note-border bg-note'
              : 'bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20',
            fromCopilot &&
              mode === 'reply' &&
              'ai-frame border-transparent focus-within:border-transparent',
          )}
        >
          <div>
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
            <EditorContent editor={editor} onBlur={() => setBrowsing(false)} />
            {corrections > 0 && editor && (
              <div className="mx-2 mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs">
                <SpellCheck className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                <span className="font-medium">
                  {$tp(corrections, '{count} correction proposée', '{count} corrections proposées')}
                </span>
                <span className="text-muted-foreground">
                  {$t('un clic sur le mot en vert l’accepte')}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => forget(editor.view)}
                  >
                    {$t('Ignorer')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => accept(editor.view)}
                  >
                    {$t('Tout accepter')}
                  </Button>
                </span>
              </div>
            )}
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
              <EmojiPicker onPick={addEmoji} onGif={(file) => addFiles([file])}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={$t('Emoji')}
                  className="size-7 text-muted-foreground"
                >
                  <SmilePlus className="size-4" />
                </Button>
              </EmojiPicker>
              {editor && (
                <>
                  <span className="mx-1 h-4 w-px bg-border" />
                  <FormatButtons editor={editor} />
                  <span className="mx-1 h-4 w-px bg-border" />
                </>
              )}
              {mode === 'reply' && (
                <Hint label={$t('Réponses types — ou « / » dans le texte')}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn('size-7 text-muted-foreground', browsing && 'bg-accent')}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setBrowsing((open) => !open)
                      editor?.commands.focus()
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
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void proofread(true)}>
                    <SpellCheck />
                    {$t('Relire l’orthographe maintenant')}
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem
                    checked={autoProof}
                    onCheckedChange={(on) => chooseAutoProof(on === true)}
                  >
                    {$t('Relire après chaque pause')}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {(checking || clean) && (
                <span className="ml-2 hidden items-center gap-1 text-[11px] text-muted-foreground lg:flex">
                  {checking ? (
                    <LoaderCircle className="size-3 animate-spin" />
                  ) : (
                    <SpellCheck className="size-3" />
                  )}
                  {checking ? $t('Relecture…') : $t('Aucune faute')}
                </span>
              )}
              <span className="ml-auto hidden items-center gap-1 pr-2 text-[11px] text-muted-foreground 2xl:flex">
                <Kbd>↵</Kbd> {$t('envoyer')}
                <span className="mx-1 text-muted-foreground/50">·</span>
                <Kbd>Maj</Kbd>
                <Kbd>↵</Kbd> {$t('à la ligne')}
              </span>
              {mode === 'reply' ? (
                <div className="ml-auto flex 2xl:ml-0">
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
                  className="ml-auto 2xl:ml-0"
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
