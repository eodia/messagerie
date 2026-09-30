'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Hint } from '@/components/ui/tooltip'
import { $t, $tp } from '@/lib/i18n'
import { useInbox } from '@/lib/store/inbox'
import { cn } from '@/lib/utils'
import type { Conversation } from '@chat/contracts'
import {
  BookText,
  ChevronDown,
  CircleCheck,
  MessageSquare,
  Paperclip,
  SendHorizontal,
  Smile,
  Sparkles,
  StickyNote,
  WandSparkles,
  X,
} from 'lucide-react'
import { type ReactNode, type RefObject, useState } from 'react'

type Mode = 'reply' | 'note'

/**
 * Where an agent writes: an answer to the visitor, or a note only the team reads. The
 * copilot's suggestions sit above the field; one click puts a suggestion in it, where the
 * agent reads it and sends it — never straight to the visitor.
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
  const { setDraft, send } = useInbox.getState()
  const [mode, setMode] = useState<Mode>('reply')
  const [suggestionsOpen, setSuggestionsOpen] = useState(true)
  /** The field holds what the copilot wrote: it glows until it is sent. */
  const [fromCopilot, setFromCopilot] = useState(false)

  const suggestions = conversation.suggestions
  const canSend = draft.trim() !== '' && !sending

  async function submit(andResolve = false) {
    if (!canSend) return
    // A refused send keeps the draft; the inbox says why.
    if (await send(conversation.id, draft.trim(), mode, andResolve)) setFromCopilot(false)
  }

  function take(suggestion: string) {
    setMode('reply')
    setDraft(conversation.id, suggestion)
    setFromCopilot(true)
    inputRef.current?.focus()
  }

  return (
    <div className="shrink-0 border-t bg-background">
      <div className="flex h-10 items-center gap-5 px-4" role="tablist">
        <ModeTab active={mode === 'reply'} onClick={() => setMode('reply')} icon={MessageSquare}>
          {$t('Répondre')}
        </ModeTab>
        <ModeTab active={mode === 'note'} onClick={() => setMode('note')} icon={StickyNote}>
          {$t('Note interne')}
        </ModeTab>
        {mode === 'reply' && suggestions.length > 0 && !suggestionsOpen && (
          <button
            type="button"
            onClick={() => setSuggestionsOpen(true)}
            className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Sparkles className="size-3.5 text-violet-600 dark:text-violet-300" />
            {$tp(suggestions.length, '{count} suggestion', '{count} suggestions')}
          </button>
        )}
      </div>

      {mode === 'reply' && suggestions.length > 0 && suggestionsOpen && (
        <div className="px-4 pb-1">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <Sparkles className="size-3 text-violet-600 dark:text-violet-300" />
            {$t('Suggestions du copilote')}
            <Hint label={$t('Masquer les suggestions')}>
              <button
                type="button"
                onClick={() => setSuggestionsOpen(false)}
                className="ml-auto rounded p-0.5 hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </Hint>
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
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

      <div className="p-3 pt-2">
        <div
          className={cn(
            'rounded-xl p-px',
            fromCopilot && mode === 'reply' ? 'animate-ai-turn bg-ai-edge' : 'bg-border',
          )}
        >
          <div className={cn('rounded-[11px]', mode === 'note' ? 'bg-note' : 'bg-background')}>
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(conversation.id, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void submit()
                }
              }}
              rows={2}
              placeholder={
                mode === 'reply'
                  ? $t('Écrire au visiteur, ou choisir une suggestion…')
                  : $t('Une note pour l’équipe : le visiteur ne la verra pas.')
              }
              className="field-sizing-content block max-h-48 min-h-16 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
              <ToolButton label={$t('Joindre un fichier')} icon={Paperclip} />
              <ToolButton label={$t('Émoji')} icon={Smile} />
              <ToolButton label={$t('Réponses types — ou « / » dans le texte')} icon={BookText} />
              <ToolButton label={$t('Reformuler avec l’IA')} icon={WandSparkles} />
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

function ToolButton({
  label,
  icon: Icon,
}: { readonly label: string; readonly icon: typeof Paperclip }) {
  return (
    <Hint label={label}>
      <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground">
        <Icon className="size-4" />
      </Button>
    </Hint>
  )
}
