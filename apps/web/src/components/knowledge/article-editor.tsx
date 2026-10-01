'use client'

import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Hint } from '@/components/ui/tooltip'
import { $t, msg } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { type Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Minus,
  Pilcrow,
  Quote,
  SquareCode,
  Strikethrough,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * An article's body, written as one reads it: headings, lists, quotes, code, links — and
 * kept as Markdown, which is what basedb stores and what the AI's index cuts by headings.
 * The toolbar gives each form; « / » at the start of a line offers them by name.
 */

interface Block {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly icon: LucideIcon
  readonly apply: (editor: Editor) => void
  readonly active: (editor: Editor) => boolean
}

const BLOCKS: readonly Block[] = [
  {
    id: 'paragraph',
    label: msg('Texte'),
    hint: msg('Un paragraphe'),
    icon: Pilcrow,
    apply: (e) => e.chain().focus().setParagraph().run(),
    active: (e) => e.isActive('paragraph'),
  },
  {
    id: 'h2',
    label: msg('Titre'),
    hint: msg('Un sujet : l’IA cite l’article par ses titres'),
    icon: Heading2,
    apply: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    active: (e) => e.isActive('heading', { level: 2 }),
  },
  {
    id: 'h3',
    label: msg('Sous-titre'),
    hint: msg('Une partie d’un sujet'),
    icon: Heading3,
    apply: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    active: (e) => e.isActive('heading', { level: 3 }),
  },
  {
    id: 'bullets',
    label: msg('Liste à puces'),
    hint: msg('Des éléments sans ordre'),
    icon: List,
    apply: (e) => e.chain().focus().toggleBulletList().run(),
    active: (e) => e.isActive('bulletList'),
  },
  {
    id: 'numbers',
    label: msg('Liste numérotée'),
    hint: msg('Des étapes, dans l’ordre'),
    icon: ListOrdered,
    apply: (e) => e.chain().focus().toggleOrderedList().run(),
    active: (e) => e.isActive('orderedList'),
  },
  {
    id: 'quote',
    label: msg('Citation'),
    hint: msg('Un passage mis en avant'),
    icon: Quote,
    apply: (e) => e.chain().focus().toggleBlockquote().run(),
    active: (e) => e.isActive('blockquote'),
  },
  {
    id: 'code',
    label: msg('Bloc de code'),
    hint: msg('Du code, ou un texte à recopier tel quel'),
    icon: SquareCode,
    apply: (e) => e.chain().focus().toggleCodeBlock().run(),
    active: (e) => e.isActive('codeBlock'),
  },
  {
    id: 'rule',
    label: msg('Séparateur'),
    hint: msg('Une ligne entre deux parties'),
    icon: Minus,
    apply: (e) => e.chain().focus().setHorizontalRule().run(),
    active: () => false,
  },
]

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

interface Slash {
  /** Where the « / » is, to replace it by the block chosen. */
  readonly from: number
  readonly query: string
  readonly top: number
  readonly left: number
}

export function ArticleEditor({
  markdown,
  editable,
  onChange,
}: {
  /** The article's body, when it opens — the editor is keyed by the article. */
  readonly markdown: string
  readonly editable: boolean
  readonly onChange: (markdown: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [slash, setSlash] = useState<Slash | null>(null)
  const [active, setActive] = useState(0)
  // The slash menu's state, for the editor's key handler — set once, read each time.
  const menu = useRef<{ slash: Slash | null; choices: readonly Block[]; active: number }>({
    slash: null,
    choices: BLOCKS,
    active: 0,
  })
  // The latest `apply` and `onChange`: the editor keeps the callbacks it was created with.
  const applyRef = useRef<(block: Block) => void>(() => {})
  const changed = useRef(onChange)
  changed.current = onChange

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        underline: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Markdown,
      Placeholder.configure({
        placeholder: $t('Écrivez, ou tapez « / » pour choisir un titre, une liste, une citation…'),
      }),
    ],
    content: markdown,
    contentType: 'markdown',
    editable,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class:
          'prose-article min-h-[50vh] max-w-none pb-24 outline-none text-[15px] leading-7 text-foreground',
      },
      handleKeyDown: (_view, event) => {
        const { slash: open, choices, active: index } = menu.current
        if (!open || choices.length === 0) return false
        if (event.key === 'ArrowDown') {
          setActive((index + 1) % choices.length)
          return true
        }
        if (event.key === 'ArrowUp') {
          setActive((index - 1 + choices.length) % choices.length)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const choice = choices[index]
          if (choice) applyRef.current(choice)
          return true
        }
        if (event.key === 'Escape') {
          setSlash(null)
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: current }) => {
      changed.current(current.getMarkdown())
      watchSlash(current)
    },
    onSelectionUpdate: ({ editor: current }) => watchSlash(current),
  })

  // Without an update event: it would read as a change, and save the article untouched.
  useEffect(() => {
    editor?.setEditable(editable, false)
  }, [editor, editable])

  /** « / » typed at the start of an empty line opens the menu; what follows filters it. */
  function watchSlash(current: Editor) {
    const { $from, empty } = current.state.selection
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
    const found = /^\/([\p{L}\d ]{0,20})$/u.exec(before)
    if (!empty || !found || $from.parent.type.name !== 'paragraph' || !box.current) {
      if (menu.current.slash) setSlash(null)
      return
    }
    const at = current.view.coordsAtPos($from.pos)
    const frame = box.current.getBoundingClientRect()
    setSlash({
      from: $from.pos - before.length,
      query: found[1] ?? '',
      top: at.bottom - frame.top + 6,
      left: at.left - frame.left,
    })
    setActive(0)
  }

  const choices = slash
    ? BLOCKS.filter((b) => fold($t(b.label)).includes(fold(slash.query.trim())))
    : BLOCKS
  menu.current = { slash, choices, active }

  function apply(block: Block) {
    if (!editor) return
    const open = menu.current.slash
    if (open) {
      editor.chain().focus().deleteRange({ from: open.from, to: editor.state.selection.from }).run()
    }
    block.apply(editor)
    setSlash(null)
  }
  applyRef.current = apply

  if (!editor) return null

  return (
    <div ref={box} className="relative">
      {editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
      {slash && choices.length > 0 && (
        <div
          className="absolute z-20 w-72 animate-in fade-in zoom-in-95 overflow-hidden rounded-xl border bg-popover p-1 shadow-lg duration-150"
          style={{ top: slash.top, left: Math.max(0, slash.left - 8) }}
        >
          <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {$t('Blocs')}
          </div>
          {choices.map((block, index) => (
            <button
              key={block.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault()
                apply(block)
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left',
                index === active && 'bg-accent',
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
                <block.icon className="size-4 text-muted-foreground" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{$t(block.label)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {$t(block.hint)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Tool({
  label,
  icon: Icon,
  on = false,
  onClick,
  disabled = false,
}: {
  readonly label: string
  readonly icon: LucideIcon
  readonly on?: boolean
  readonly onClick: () => void
  readonly disabled?: boolean
}) {
  return (
    <Hint label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        className={cn(
          'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40',
          on && 'bg-accent text-foreground',
        )}
      >
        <Icon className="size-4" />
      </button>
    </Hint>
  )
}

function Group({ children }: { readonly children: ReactNode }) {
  return <div className="flex items-center gap-0.5 border-r pr-1.5 last:border-r-0">{children}</div>
}

/** The forms of a text, at hand above it — sticky while one writes. */
function Toolbar({ editor }: { readonly editor: Editor }) {
  return (
    <div className="sticky top-0 z-10 -mx-1 mb-6 flex flex-wrap items-center gap-1.5 rounded-xl border bg-background/95 px-1.5 py-1 shadow-xs backdrop-blur">
      <Group>
        <Tool
          label={$t('Gras')}
          icon={Bold}
          on={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <Tool
          label={$t('Italique')}
          icon={Italic}
          on={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <Tool
          label={$t('Barré')}
          icon={Strikethrough}
          on={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <Tool
          label={$t('Code')}
          icon={Code}
          on={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
        />
      </Group>
      <Group>
        {BLOCKS.filter((b) => b.id !== 'paragraph').map((block) => (
          <Tool
            key={block.id}
            label={$t(block.label)}
            icon={block.icon}
            on={block.active(editor)}
            onClick={() => block.apply(editor)}
          />
        ))}
      </Group>
      <Group>
        <LinkTool editor={editor} />
      </Group>
    </div>
  )
}

function LinkTool({ editor }: { readonly editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState('')
  const current = editor.getAttributes('link').href as string | undefined

  useEffect(() => {
    if (open) setHref(current ?? '')
  }, [open, current])

  function save() {
    const value = href.trim()
    if (value === '') editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else {
      const full = /^(https?:|mailto:)/i.test(value) ? value : `https://${value}`
      editor.chain().focus().extendMarkRange('link').setLink({ href: full }).run()
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={$t('Lien')}
          aria-pressed={editor.isActive('link')}
          onMouseDown={(event) => event.preventDefault()}
          className={cn(
            'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            editor.isActive('link') && 'bg-accent text-foreground',
          )}
        >
          <Link2 className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
          className="flex items-center gap-1.5"
        >
          <Input
            autoFocus
            value={href}
            onChange={(event) => setHref(event.target.value)}
            placeholder="https://"
            aria-label={$t('Adresse du lien')}
            className="h-8 text-sm"
          />
          <button
            type="submit"
            className="h-8 shrink-0 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
          >
            {current ? $t('Modifier') : $t('Lier')}
          </button>
        </form>
        {current && (
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run()
              setOpen(false)
            }}
            className="mt-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {$t('Retirer le lien')}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
