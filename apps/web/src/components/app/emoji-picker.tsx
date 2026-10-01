'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Hint } from '@/components/ui/tooltip'
import { $t, msg } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Clock, Hand, Heart, Package, Smile } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'

/**
 * A palette of emoji, the ones a customer service uses — no library, no download: the
 * system draws them. The last ones chosen come first, kept in this browser.
 */

const GROUPS = [
  {
    key: 'smileys',
    label: msg('Visages'),
    icon: Smile,
    emoji:
      '😀 😃 😄 😁 😊 🙂 😉 😍 🥰 😘 😎 🤗 🤔 😅 😂 🤣 😇 🙃 😌 🤩 🥳 😴 😢 😭 😤 😡 😱 😳 🥲 😬 🙄 😏 🫠 🤐 🤓 😷',
  },
  {
    key: 'hands',
    label: msg('Gestes'),
    icon: Hand,
    emoji: '👍 👎 👌 ✌️ 🤞 👏 🙌 🙏 👋 💪 🤝 ☝️ 👉 👈 👆 👇 ✋ 🫶 👀 🤷',
  },
  {
    key: 'symbols',
    label: msg('Symboles'),
    icon: Heart,
    emoji: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💯 ✅ ☑️ ❌ ⚠️ ❗ ❓ ⭐ ✨ 🔥 🎉 🎁 💡 📌 🔔 ⏳',
  },
  {
    key: 'objects',
    label: msg('Objets'),
    icon: Package,
    emoji: '📄 📎 📷 📞 📱 💻 ✉️ 📦 🏠 🚗 🔑 💶 💳 📅 ⏰ 🛠️ 🩺 ☔ 🌧️ ❄️ ☀️ 🌍 ☕ 🍀',
  },
] as const

const RECENT_KEY = 'chat.emoji.recent'

function readRecent(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(stored) ? stored.filter((e): e is string => typeof e === 'string') : []
  } catch {
    return []
  }
}

function keepRecent(emoji: string): void {
  try {
    const next = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, 16)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Forgotten next time, nothing more.
  }
}

export function EmojiPicker({
  onPick,
  children,
  side = 'top',
}: {
  readonly onPick: (emoji: string) => void
  /** The button that opens it. */
  readonly children: ReactNode
  readonly side?: 'top' | 'bottom'
}) {
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [group, setGroup] = useState<string>('recent')

  useEffect(() => {
    if (!open) return
    const stored = readRecent()
    setRecent(stored)
    setGroup((current) => (current === 'recent' && stored.length === 0 ? 'smileys' : current))
  }, [open])

  const tabs = [
    ...(recent.length > 0
      ? [{ key: 'recent', label: $t('Récents'), icon: Clock, list: recent }]
      : []),
    ...GROUPS.map((g) => ({
      key: g.key,
      label: $t(g.label),
      icon: g.icon,
      list: g.emoji.split(' '),
    })),
  ]
  const current = tabs.find((t) => t.key === group) ?? tabs[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        className="w-72 p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center gap-0.5 border-b px-1.5 py-1">
          {tabs.map((tab) => (
            <Hint key={tab.key} label={tab.label}>
              <button
                type="button"
                aria-pressed={tab.key === current?.key}
                aria-label={tab.label}
                onClick={() => setGroup(tab.key)}
                className={cn(
                  'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  tab.key === current?.key && 'bg-accent text-foreground',
                )}
              >
                <tab.icon className="size-4" />
              </button>
            </Hint>
          ))}
        </div>
        <div className="px-2 pt-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {current?.label}
        </div>
        <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto p-1.5 scroll-discret">
          {current?.list.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                keepRecent(emoji)
                onPick(emoji)
                setOpen(false)
              }}
              className="flex aspect-square items-center justify-center rounded-md text-xl transition-transform hover:scale-110 hover:bg-accent"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
