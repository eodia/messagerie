'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Hint } from '@/components/ui/tooltip'
import { $t } from '@/lib/i18n'
import { draftHtml, draftMarkdown, safeHref } from '@/lib/rich-text'
import { cn } from '@/lib/utils'
import { Placeholder } from '@tiptap/extensions'
import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Check,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Strikethrough,
  Type,
} from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { afterMenus } from './assign-picker'
import { Proofreading, correctionsOf } from './proofreading'

/**
 * The agent's draft, in a rich field: bold, italic, struck, code, links, lists — written as
 * the little Markdown the widget reads (`lib/rich-text.ts`). With `onSubmit`, Enter sends and
 * Shift+Enter goes to the line; in a list, Enter starts the next item. Without, Enter goes to
 * the line — a canned reply being written. A file pasted goes with the message.
 */
export function useDraftEditor({
  value,
  placeholder,
  onChange,
  onKey,
  onSubmit,
  onFiles,
  onCorrections,
}: {
  /** The draft, as the store keeps it — Markdown. */
  readonly value: string
  readonly placeholder: string
  readonly onChange: (markdown: string) => void
  /** Keys for what the composer opens over the field — its canned replies. `true`: taken. */
  readonly onKey?: (event: KeyboardEvent) => boolean
  readonly onSubmit?: () => void
  readonly onFiles?: (files: readonly File[]) => void
  readonly onCorrections?: (count: number) => void
}): Editor | null {
  // The editor keeps the callbacks it was created with: it reads the latest through these.
  const latest = useRef({ placeholder, onChange, onKey, onSubmit, onFiles, onCorrections })
  latest.current = { placeholder, onChange, onKey, onSubmit, onFiles, onCorrections }
  /** The Markdown the editor last gave: a value that differs came from elsewhere. */
  const emitted = useRef(value)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        underline: false,
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: 'https',
          protocols: ['http', 'https', 'mailto'],
        },
      }),
      Placeholder.configure({ placeholder: () => latest.current.placeholder }),
      Proofreading,
    ],
    content: draftHtml(value),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'draft-field max-h-48 min-h-16 overflow-y-auto px-3 pt-2.5 pb-1 text-sm outline-none scroll-discret',
        role: 'textbox',
        'aria-multiline': 'true',
      },
      handleKeyDown: (view, event) => {
        const { onKey, onSubmit } = latest.current
        if (onKey?.(event)) return true
        if (!onSubmit || event.key !== 'Enter' || event.isComposing) return false
        // Ctrl+Enter sends from anywhere, a list included.
        if (event.ctrlKey || event.metaKey) {
          onSubmit()
          return true
        }
        if (event.shiftKey) return false
        const { $from } = view.state.selection
        for (let depth = $from.depth; depth > 0; depth--) {
          if ($from.node(depth).type.name === 'listItem') return false
        }
        onSubmit()
        return true
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])]
        const { onFiles } = latest.current
        if (files.length === 0 || !onFiles) return false
        onFiles(files)
        return true
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = draftMarkdown(current.getJSON())
      emitted.current = markdown
      latest.current.onChange(markdown)
    },
    onTransaction: ({ editor: current }) => {
      latest.current.onCorrections?.(correctionsOf(current.state).length)
    },
  })

  // A draft set from elsewhere — a suggestion, a canned reply, a rewording: in the field.
  useEffect(() => {
    if (!editor || value === emitted.current) return
    emitted.current = value
    editor.commands.setContent(draftHtml(value), { emitUpdate: false })
    editor.commands.setTextSelection(editor.state.doc.content.size)
  }, [editor, value])

  // Another placeholder (a note, a reply): drawn again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the placeholder is the trigger
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr)
  }, [editor, placeholder])

  return editor
}

/**
 * A text written in the little Markdown — a canned reply's —, in the same rich field, its
 * format buttons below. `onEditor` gives the editor, to insert at the caret.
 */
export function MarkdownField({
  id,
  value,
  onChange,
  placeholder,
  onEditor,
}: {
  readonly id?: string
  readonly value: string
  readonly onChange: (markdown: string) => void
  readonly placeholder: string
  readonly onEditor?: (editor: Editor | null) => void
}) {
  const editor = useDraftEditor({ value, placeholder, onChange })
  useEffect(() => onEditor?.(editor), [editor, onEditor])
  useEffect(() => {
    if (editor && id) editor.view.dom.id = id
  }, [editor, id])
  return (
    <div className="rounded-md border bg-background shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25">
      <EditorContent editor={editor} />
      {editor && (
        <div className="flex border-t px-1 py-0.5">
          <FormatButtons editor={editor} />
        </div>
      )}
    </div>
  )
}

/**
 * Bold, italic, struck, code, a link, the lists — as the field stands. `compact`: bold and
 * italic in view, the rest in a menu — the composer's toolbar has little room.
 */
export function FormatButtons({
  editor,
  compact = false,
}: {
  readonly editor: Editor
  readonly compact?: boolean
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
    }),
  })
  const [linking, setLinking] = useState(false)
  const chain = () => editor.chain().focus()
  const marks = [
    {
      key: 'strike',
      label: $t('Barré'),
      icon: Strikethrough,
      active: state.strike,
      run: () => chain().toggleStrike().run(),
    },
    {
      key: 'code',
      label: $t('Code'),
      icon: Code,
      active: state.code,
      run: () => chain().toggleCode().run(),
    },
  ]
  const lists = [
    {
      key: 'bullets',
      label: $t('Liste à puces'),
      icon: List,
      active: state.bullets,
      run: () => chain().toggleBulletList().run(),
    },
    {
      key: 'numbers',
      label: $t('Liste numérotée'),
      icon: ListOrdered,
      active: state.numbers,
      run: () => chain().toggleOrderedList().run(),
    },
  ]
  const folded = state.link || [...marks, ...lists].some((m) => m.active)

  return (
    <span className="flex items-center gap-0.5">
      <Tool
        label={$t('Gras')}
        keys="Ctrl B"
        active={state.bold}
        onClick={() => chain().toggleBold().run()}
      >
        <Bold />
      </Tool>
      <Tool
        label={$t('Italique')}
        keys="Ctrl I"
        active={state.italic}
        onClick={() => chain().toggleItalic().run()}
      >
        <Italic />
      </Tool>
      {compact ? (
        // The link's form opens where the menu was, once the menu has gone.
        <Popover open={linking} onOpenChange={setLinking}>
          <DropdownMenu>
            <Hint label={$t('Plus de mise en forme')}>
              <DropdownMenuTrigger asChild>
                <PopoverAnchor asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={$t('Plus de mise en forme')}
                    onMouseDown={(event) => event.preventDefault()}
                    className={cn(
                      'size-7 text-muted-foreground [&_svg]:size-3.5',
                      folded && 'bg-accent text-foreground',
                    )}
                  >
                    <Type />
                  </Button>
                </PopoverAnchor>
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent
              side="top"
              align="start"
              className="min-w-48"
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              {marks.map((item) => (
                <FormatItem
                  key={item.key}
                  label={item.label}
                  icon={item.icon}
                  active={item.active}
                  run={item.run}
                />
              ))}
              <DropdownMenuItem onSelect={() => afterMenus(() => setLinking(true))}>
                <Link2 />
                {state.link ? $t('Modifier le lien…') : $t('Lien…')}
                {state.link && <Check className="ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {lists.map((item) => (
                <FormatItem
                  key={item.key}
                  label={item.label}
                  icon={item.icon}
                  active={item.active}
                  run={item.run}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <PopoverContent side="top" align="start" className="w-80 p-2">
            <LinkForm editor={editor} active={state.link} onDone={() => setLinking(false)} />
          </PopoverContent>
        </Popover>
      ) : (
        <>
          {marks.map((item) => (
            <Tool key={item.key} label={item.label} active={item.active} onClick={item.run}>
              <item.icon />
            </Tool>
          ))}
          <LinkTool editor={editor} active={state.link} />
          {lists.map((item) => (
            <Tool key={item.key} label={item.label} active={item.active} onClick={item.run}>
              <item.icon />
            </Tool>
          ))}
        </>
      )}
    </span>
  )
}

/** A format in the menu: its icon, its name, a check when the selection has it. */
function FormatItem({
  label,
  icon: Icon,
  active,
  run,
}: {
  readonly label: string
  readonly icon: LucideIcon
  readonly active: boolean
  readonly run: () => void
}) {
  return (
    <DropdownMenuItem onSelect={run}>
      <Icon />
      {label}
      {active && <Check className="ml-auto" />}
    </DropdownMenuItem>
  )
}

function Tool({
  label,
  keys,
  active,
  onClick,
  children,
}: {
  readonly label: string
  readonly keys?: string
  readonly active: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <Hint label={keys ? `${label} · ${keys}` : label}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-pressed={active}
        // The field keeps its selection: the button acts on it.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        className={cn(
          'size-7 text-muted-foreground [&_svg]:size-3.5',
          active && 'bg-accent text-foreground',
        )}
      >
        {children}
      </Button>
    </Hint>
  )
}

/** The link button: its form in a popover above it. */
function LinkTool({ editor, active }: { readonly editor: Editor; readonly active: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label={$t('Lien')}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={$t('Lien')}
            aria-pressed={active}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              'size-7 text-muted-foreground [&_svg]:size-3.5',
              active && 'bg-accent text-foreground',
            )}
          >
            <Link2 />
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent side="top" align="start" className="w-80 p-2">
        <LinkForm editor={editor} active={active} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

/** A link on the words chosen — or the address itself, when none are; emptied, removed. */
function LinkForm({
  editor,
  active,
  onDone,
}: {
  readonly editor: Editor
  readonly active: boolean
  readonly onDone: () => void
}) {
  // Read when the form opens: the link the caret is in.
  const [href, setHref] = useState(
    () => (editor.getAttributes('link').href as string | undefined) ?? '',
  )

  function apply(event: FormEvent) {
    event.preventDefault()
    const typed = href.trim()
    const address = typed === '' || /^[a-z]+:/i.test(typed) ? typed : `https://${typed}`
    const chain = editor.chain().focus().extendMarkRange('link')
    if (address === '') chain.unsetLink().run()
    else if (safeHref(address)) {
      if (editor.state.selection.empty && !active) {
        chain
          .insertContent({
            type: 'text',
            text: address,
            marks: [{ type: 'link', attrs: { href: address } }],
          })
          .run()
      } else chain.setLink({ href: address }).run()
    }
    onDone()
  }

  return (
    <form onSubmit={apply} className="flex items-center gap-1.5">
      <Input
        autoFocus
        value={href}
        onChange={(event) => setHref(event.target.value)}
        placeholder="https://…"
        aria-label={$t('Adresse du lien')}
        className="h-8 text-xs"
      />
      <Button type="submit" size="sm" className="h-8">
        {active && href.trim() === '' ? $t('Retirer') : $t('Lier')}
      </Button>
    </form>
  )
}
