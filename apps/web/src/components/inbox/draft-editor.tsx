'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Hint } from '@/components/ui/tooltip'
import { $t } from '@/lib/i18n'
import { draftHtml, draftMarkdown, safeHref } from '@/lib/rich-text'
import { cn } from '@/lib/utils'
import { Placeholder } from '@tiptap/extensions'
import { type Editor, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Code, Italic, Link2, List, ListOrdered, Strikethrough } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { Proofreading, correctionsOf } from './proofreading'

/**
 * The agent's draft, in a rich field: bold, italic, struck, code, links, lists — written as
 * the little Markdown the widget reads (`lib/rich-text.ts`). Enter sends, Shift+Enter goes
 * to the line; in a list, Enter starts the next item. A file pasted goes with the message.
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
  readonly onKey: (event: KeyboardEvent) => boolean
  readonly onSubmit: () => void
  readonly onFiles: (files: readonly File[]) => void
  readonly onCorrections: (count: number) => void
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
        if (latest.current.onKey(event)) return true
        if (event.key !== 'Enter' || event.isComposing) return false
        // Ctrl+Enter sends from anywhere, a list included.
        if (event.ctrlKey || event.metaKey) {
          latest.current.onSubmit()
          return true
        }
        if (event.shiftKey) return false
        const { $from } = view.state.selection
        for (let depth = $from.depth; depth > 0; depth--) {
          if ($from.node(depth).type.name === 'listItem') return false
        }
        latest.current.onSubmit()
        return true
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])]
        if (files.length === 0) return false
        latest.current.onFiles(files)
        return true
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = draftMarkdown(current.getJSON())
      emitted.current = markdown
      latest.current.onChange(markdown)
    },
    onTransaction: ({ editor: current }) => {
      latest.current.onCorrections(correctionsOf(current.state).length)
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

/** Bold, italic, struck, code, a link, the lists — as the field stands. */
export function FormatButtons({ editor }: { readonly editor: Editor }) {
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
  const chain = () => editor.chain().focus()
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
      <Tool label={$t('Barré')} active={state.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough />
      </Tool>
      <Tool label={$t('Code')} active={state.code} onClick={() => chain().toggleCode().run()}>
        <Code />
      </Tool>
      <LinkTool editor={editor} active={state.link} />
      <Tool
        label={$t('Liste à puces')}
        active={state.bullets}
        onClick={() => chain().toggleBulletList().run()}
      >
        <List />
      </Tool>
      <Tool
        label={$t('Liste numérotée')}
        active={state.numbers}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered />
      </Tool>
    </span>
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

/** A link on the words chosen — or the address itself, when none are. */
function LinkTool({ editor, active }: { readonly editor: Editor; readonly active: boolean }) {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState('')

  function opened(next: boolean) {
    if (next) setHref((editor.getAttributes('link').href as string | undefined) ?? '')
    setOpen(next)
  }

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
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={opened}>
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
      </PopoverContent>
    </Popover>
  )
}
