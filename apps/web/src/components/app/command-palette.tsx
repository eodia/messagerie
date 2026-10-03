'use client'

import { ColorBadge } from '@/components/app/chip'
import { Lit } from '@/components/app/lit'
import { InboxGlyph } from '@/components/app/look'
import { afterMenus } from '@/components/inbox/assign-picker'
import { ContactAvatar, StateChip } from '@/components/inbox/labels'
import { loadOptions } from '@/components/inbox/tag-picker'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { addressOf, wordOf } from '@/lib/address'
import { api } from '@/lib/api'
import { $t, $tp, msg } from '@/lib/i18n'
import {
  type Prepared,
  excerpt,
  frecency,
  prepare,
  remember,
  scoreOf,
  tokensOf,
  visits,
} from '@/lib/search'
import { concernsMe, useInbox } from '@/lib/store/inbox'
import { useListFilters } from '@/lib/store/list-filters'
import { usePalette } from '@/lib/store/palette'
import { useSession } from '@/lib/store/session'
import { useTheme } from '@/lib/theme'
import { inboxTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type {
  ContactListItem,
  ConversationSummary,
  MessageHit,
  SettingsRow,
  TagOption,
} from '@chat/contracts'
import {
  AlarmClock,
  ArrowRightLeft,
  BookOpen,
  ChartColumn,
  CircleCheck,
  Clock,
  CornerDownLeft,
  FileText,
  Forward,
  Globe,
  Hand,
  Headset,
  Inbox,
  KeyRound,
  ListFilter,
  LogOut,
  type LucideIcon,
  MessageSquareText,
  MessagesSquare,
  Monitor,
  Moon,
  Palette as PaletteIcon,
  Plus,
  Search,
  ShieldAlert,
  Smartphone,
  Sparkles,
  StickyNote,
  Sun,
  Tag,
  Undo2,
  UserPlus,
  UserRound,
  UserRoundPlus,
  UsersRound,
  Workflow,
  Wrench,
} from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

/**
 * The command palette — Ctrl+K anywhere, or the search field of the top bar; basedb's way
 * of finding, for the inbox.
 *
 * One field for everything the inbox can reach: its conversations, its contacts (asked to
 * the server as one types), the very words of the messages, the knowledge articles, the
 * tags, inboxes and agents to filter the list by, every screen and setting, and the
 * commands — of the open conversation first. What is typed is matched as basedb matches
 * it, without accents nor case, by word starts, initials and slips (`lib/search.ts`); what
 * was opened often and lately comes first.
 *
 * Prefixes narrow it: `>` the commands, `#` the tags, `@` the people.
 */

type Mode = 'all' | 'commands' | 'tags' | 'people'

type Group =
  | 'suggest'
  | 'recent'
  | 'conversations'
  | 'contacts'
  | 'messages'
  | 'agents'
  | 'tags'
  | 'commands'
  | 'inboxes'
  | 'articles'
  | 'pages'

const GROUPS: readonly { readonly key: Group; readonly label: string; readonly cap: number }[] = [
  { key: 'suggest', label: msg('Pour cette conversation'), cap: 8 },
  { key: 'recent', label: msg('Récents'), cap: 6 },
  { key: 'conversations', label: msg('Conversations'), cap: 6 },
  { key: 'contacts', label: msg('Contacts'), cap: 4 },
  { key: 'messages', label: msg('Dans les messages'), cap: 5 },
  { key: 'agents', label: msg('Conseillers'), cap: 4 },
  { key: 'tags', label: msg('Étiquettes'), cap: 6 },
  { key: 'commands', label: msg('Commandes'), cap: 8 },
  { key: 'inboxes', label: msg('Boîtes de réception'), cap: 4 },
  { key: 'articles', label: msg('Base de connaissance'), cap: 4 },
  { key: 'pages', label: msg('Aller à'), cap: 8 },
]

/** What a group answers to, by prefix. */
const MODES: Readonly<Record<Mode, readonly Group[]>> = {
  all: GROUPS.map((g) => g.key),
  commands: ['suggest', 'commands'],
  tags: ['tags'],
  people: ['conversations', 'contacts', 'agents'],
}

interface Entry {
  readonly key: string
  readonly group: Group
  readonly title: string
  readonly subtitle?: string
  readonly keywords?: string
  readonly context?: string
  readonly icon: ReactNode
  /** Where it leads — what « Récents » goes back to. */
  readonly href?: string
  readonly run: () => void
  readonly preview?: Preview
  /** A row the server found for this text — matched already, kept whatever the scoring. */
  readonly found?: boolean
}

type Preview =
  | { readonly kind: 'conversation'; readonly summary: ConversationSummary }
  | { readonly kind: 'contact'; readonly contact: ContactListItem }
  | { readonly kind: 'message'; readonly hit: MessageHit }
  | { readonly kind: 'text'; readonly text: string }

const ICON = 'size-4 text-muted-foreground'

let articlesOnce: Promise<SettingsRow[]> | null = null
const loadArticles = () => {
  articlesOnce ??= api.settingsRows('articles').catch(() => {
    articlesOnce = null
    return []
  })
  return articlesOnce
}

export function CommandPalette() {
  const open = usePalette((s) => s.open)
  const seed = usePalette((s) => s.seed)
  const { hide } = usePalette.getState()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && hide()}>
      {open && (
        <DialogContent
          showCloseButton={false}
          className="top-[12vh] flex max-w-3xl translate-y-0 flex-col gap-0 overflow-hidden p-0"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{$t('Rechercher ou lancer une commande')}</DialogTitle>
          <Palette seed={seed} onClose={hide} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function Palette({ seed, onClose }: { readonly seed: string; readonly onClose: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const summaries = useInbox((s) => s.summaries)
  const me = useInbox((s) => s.me)
  const agents = useInbox((s) => s.agents)
  const inboxes = useInbox((s) => s.directory.inboxes)
  const detail = useInbox((s) => s.detail)
  const now = useInbox((s) => s.now)
  const [query, setQuery] = useState(seed)
  const [active, setActive] = useState(0)
  const [articles, setArticles] = useState<SettingsRow[]>([])
  const [tagOptions, setTagOptions] = useState<TagOption[]>([])
  const [contacts, setContacts] = useState<ContactListItem[]>([])
  const [hits, setHits] = useState<MessageHit[]>([])
  const [searching, setSearching] = useState(false)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadArticles().then(setArticles)
    void loadOptions().then(setTagOptions)
  }, [])

  const mode: Mode = query.startsWith('>')
    ? 'commands'
    : query.startsWith('#')
      ? 'tags'
      : query.startsWith('@')
        ? 'people'
        : 'all'
  const text = mode === 'all' ? query : query.slice(1)
  const tokens = useMemo(() => tokensOf(text), [text])

  // The server's part, once the typing pauses: contacts by name, messages by their words.
  useEffect(() => {
    const typed = text.trim()
    if (typed.length < 2 || (mode !== 'all' && mode !== 'people')) {
      setContacts([])
      setHits([])
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      void Promise.all([
        api.contacts(typed).catch(() => [] as ContactListItem[]),
        mode === 'all' && typed.length >= 3
          ? api.search(typed).catch(() => [] as MessageHit[])
          : Promise.resolve([] as MessageHit[]),
      ]).then(([foundContacts, foundHits]) => {
        setContacts(foundContacts)
        setHits(foundHits)
        setSearching(false)
      })
    }, 220)
    return () => clearTimeout(timer)
  }, [text, mode])

  const go = (path: string) => router.push(path)
  const toList = () => {
    if (!pathname.startsWith('/conversations')) go('/conversations')
  }

  // ── Everything the palette can offer ──────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: `go` and `toList` follow the router
  const entries = useMemo((): Entry[] => {
    const out: Entry[] = []
    const filters = useListFilters.getState()
    const inbox = useInbox.getState()

    // The open conversation's commands — on the conversations' screen.
    if (detail && pathname.startsWith('/conversations')) {
      const name = detail.contact.name
      const suggest = (
        key: string,
        title: string,
        icon: LucideIcon,
        run: () => void,
        keywords = '',
      ) =>
        out.push({
          key: `suggest:${key}`,
          group: 'suggest',
          title,
          context: name,
          keywords,
          icon: <IconBox icon={icon} />,
          run,
        })
      if (detail.assigneeId !== me?.id && me) {
        suggest(
          'me',
          $t('Me l’attribuer'),
          Hand,
          () => void inbox.assign(detail.id, me.id),
          'prendre affecter moi',
        )
      }
      suggest(
        'assign',
        $t('Affecter à…'),
        UserRoundPlus,
        () => afterMenus(() => inbox.ask('assign')),
        'conseiller attribuer',
      )
      if (detail.assigneeId !== null) {
        suggest(
          'queue',
          $t('Remettre dans la file'),
          Undo2,
          () => void inbox.assign(detail.id, null),
          'désaffecter',
        )
      }
      if (detail.status === 'ai') {
        suggest(
          'takeover',
          $t('Reprendre la main'),
          Hand,
          () => void inbox.takeOver(detail.id),
          'ia arrêter',
        )
      } else if (detail.status !== 'resolved') {
        suggest(
          'resolve',
          $t('Résoudre la conversation'),
          CircleCheck,
          () => void inbox.resolve(detail.id),
          'fermer terminer',
        )
      }
      if (inboxes.length > 0) {
        suggest(
          'transfer',
          $t('Transférer…'),
          Forward,
          () => afterMenus(() => inbox.ask('transfer')),
          'boîte équipe',
        )
      }
    }

    // Conversations, newest first among equals.
    for (const s of summaries) {
      const box = inboxes.find((i) => i.id === s.inboxId)
      out.push({
        key: `conversation:${s.id}`,
        group: 'conversations',
        title: s.contact.name,
        subtitle: s.preview || $t('Pas encore de message'),
        keywords: [s.contact.email ?? '', ...s.tags.map((t) => t.label), s.assignee ?? ''].join(
          ' ',
        ),
        context: [s.site, box?.name ?? ''].join(' '),
        icon: <ContactAvatar name={s.contact.name} className="size-7 text-[10px]" />,
        href: '/conversations',
        run: () => inbox.open(s.id),
        preview: { kind: 'conversation', summary: s },
      })
    }

    for (const c of contacts) {
      out.push({
        key: `contact:${c.id}`,
        group: 'contacts',
        title: c.name,
        subtitle: c.email ?? c.site ?? undefined,
        icon: <ContactAvatar name={c.name} className="size-7 text-[10px]" />,
        href: addressOf('/contacts', wordOf(c.id, c.name, 'contact')),
        run: () => go(addressOf('/contacts', wordOf(c.id, c.name, 'contact'))),
        preview: { kind: 'contact', contact: c },
        found: true,
      })
    }

    for (const hit of hits) {
      out.push({
        key: `message:${hit.messageId}`,
        group: 'messages',
        title: hit.contactName,
        subtitle: hit.body,
        icon: <IconBox icon={hit.author === 'note' ? StickyNote : MessageSquareText} />,
        run: () => inbox.open(hit.conversationId),
        preview: { kind: 'message', hit },
        found: true,
      })
    }

    // People: an agent's conversations.
    for (const agent of agents) {
      out.push({
        key: `agent:${agent.id}`,
        group: 'agents',
        title:
          agent.id === me?.id
            ? $t('Mes conversations')
            : $t('Conversations de {name}', { name: agent.name }),
        keywords: `${agent.name} ${agent.email ?? ''}`,
        icon: <ContactAvatar name={agent.name} className="size-7 text-[10px]" />,
        run: () => {
          filters.set({ assignees: [agent.id === me?.id ? 'me' : agent.id] })
          inbox.setFilter('all')
          toList()
        },
      })
    }

    // Tags: the list narrowed to one.
    for (const tag of tagOptions) {
      out.push({
        key: `tag:${tag.name}`,
        group: 'tags',
        title: tag.name,
        subtitle: tag.when ?? undefined,
        keywords: 'étiquette filtrer',
        icon: (
          <span className="flex size-7 items-center justify-center">
            <span className="size-3 rounded-full" style={{ background: tag.color }} />
          </span>
        ),
        run: () => {
          filters.set({ tags: [tag.name], tagMode: 'any' })
          inbox.setFilter('all')
          toList()
        },
      })
    }

    // Commands of the list, of creation, of the interface.
    const command = (
      key: string,
      title: string,
      icon: LucideIcon,
      run: () => void,
      keywords = '',
      href?: string,
    ) =>
      out.push({
        key: `command:${key}`,
        group: 'commands',
        title,
        keywords,
        icon: <IconBox icon={icon} />,
        run,
        ...(href ? { href } : {}),
      })
    const show = (filter: Parameters<typeof inbox.setFilter>[0]) => () => {
      inbox.setFilter(filter)
      toList()
    }
    command(
      'queue',
      $t('Voir la file : non assignées'),
      ListFilter,
      show('unassigned'),
      'en file attente personne',
    )
    command('ai', $t('Voir les conversations de l’IA'), Sparkles, show('ai'), 'ia robot')
    command(
      'snoozed',
      $t('Voir les conversations en attente'),
      AlarmClock,
      show('snoozed'),
      'attente plus tard snooze report rappel',
    )
    command(
      'resolved',
      $t('Voir les conversations résolues'),
      CircleCheck,
      show('resolved'),
      'fermées terminées archives',
    )
    command(
      'unread',
      $t('Filtrer : non lues'),
      ListFilter,
      () => {
        filters.set({ unread: true })
        toList()
      },
      'nouveaux messages',
    )
    command(
      'urgent',
      $t('Filtrer : urgentes'),
      ListFilter,
      () => {
        filters.set({ priorities: ['urgent', 'high'] })
        toList()
      },
      'priorité haute',
    )
    command(
      'waiting',
      $t('Filtrer : attendent depuis 5 min'),
      Clock,
      () => {
        filters.set({ waiting: 5, sort: 'waiting' })
        toList()
      },
      'attente retard',
    )
    command(
      'clear',
      $t('Effacer les filtres'),
      ListFilter,
      () => filters.clear(),
      'réinitialiser tout',
    )
    command(
      'new-article',
      $t('Écrire un article'),
      Plus,
      () => go('/connaissance?nouveau=1'),
      'nouvel article connaissance',
      '/connaissance',
    )
    // The administration's, for supervisors alone (`AdminOnly`).
    if (me?.role === 'supervisor') {
      command(
        'invite',
        $t('Inviter un conseiller'),
        UserPlus,
        () => go('/parametrage/equipes?inviter=1'),
        'nouveau compte agent',
      )
      command(
        'new-inbox',
        $t('Nouvelle boîte de réception'),
        Plus,
        () => go('/parametrage/boites?nouveau=1'),
        'créer',
      )
      command(
        'new-team',
        $t('Nouvelle équipe'),
        Plus,
        () => go('/parametrage/equipes?nouveau=1'),
        'créer',
      )
      command(
        'new-reply',
        $t('Nouvelle réponse type'),
        Plus,
        () => go('/parametrage/reponses?nouveau=1'),
        'créer modèle',
      )
      command(
        'new-guardrail',
        $t('Nouveau garde-fou'),
        Plus,
        () => go('/parametrage/garde-fous?nouveau=1'),
        'créer sujet sensible',
      )
      command('new-tool', $t('Nouvel outil IA'), Plus, () => go('/outils?nouveau=1'), 'créer api')
      command(
        'new-sms-number',
        $t('Nouveau numéro SMS'),
        Plus,
        () => go('/parametrage/sms?nouveau=1'),
        'créer téléphone rcs twilio',
      )
    }
    const theme = useTheme.getState()
    command('light', $t('Thème clair'), Sun, () => theme.setPreference('light'), 'apparence jour')
    command(
      'dark',
      $t('Thème sombre'),
      Moon,
      () => theme.setPreference('dark'),
      'apparence nuit noir',
    )
    command(
      'system',
      $t('Thème du système'),
      Monitor,
      () => theme.setPreference('system'),
      'apparence automatique',
    )
    command(
      'sign-out',
      $t('Se déconnecter'),
      LogOut,
      () => void useSession.getState().signOut(),
      'quitter déconnexion',
    )

    for (const box of inboxes) {
      out.push({
        key: `inbox:${box.id}`,
        group: 'inboxes',
        title: box.name,
        subtitle: box.teams.map((t) => t.name).join(', ') || undefined,
        keywords: 'boîte réception',
        icon: (
          <span className="flex size-7 items-center justify-center">
            <InboxGlyph look={box} className="size-4" dot="size-2.5" />
          </span>
        ),
        href: '/conversations',
        run: () => {
          inbox.showInbox(box.id)
          toList()
        },
      })
    }

    for (const article of articles) {
      const title = typeof article.values.Titre === 'string' ? article.values.Titre : ''
      const status = typeof article.values.Statut === 'string' ? article.values.Statut : ''
      const body = typeof article.values.Contenu === 'string' ? article.values.Contenu : ''
      out.push({
        key: `article:${article.id}`,
        group: 'articles',
        title: title || $t('Sans titre'),
        subtitle: status,
        keywords: body.slice(0, 400),
        icon: <IconBox icon={FileText} />,
        href: addressOf('/connaissance', wordOf(article.id, title, 'article')),
        run: () => go(addressOf('/connaissance', wordOf(article.id, title, 'article'))),
        preview: { kind: 'text', text: body.replace(/[#*_`>]/g, '').slice(0, 600) },
      })
    }

    const page = (href: string, title: string, icon: LucideIcon, keywords = '') =>
      out.push({
        key: `page:${href}`,
        group: 'pages',
        title,
        keywords,
        icon: <IconBox icon={icon} />,
        href,
        run: () => go(href),
      })
    page('/conversations', $t('Conversations'), MessagesSquare, 'inbox messagerie')
    page('/contacts', $t('Contacts'), UsersRound, 'clients visiteurs')
    page('/connaissance', $t('Connaissances'), BookOpen, 'articles base faq')
    page(
      '/tableaux-de-bord',
      $t('Tableaux de bord'),
      ChartColumn,
      'statistiques chiffres graphiques',
    )
    if (me?.role === 'supervisor') {
      page('/parametrage/boites', $t('Boîtes de réception'), Inbox, 'paramétrage')
      page(
        '/parametrage/equipes',
        $t('Équipes et conseillers'),
        Headset,
        'paramétrage agents comptes',
      )
      page(
        '/parametrage/sites',
        $t('Sites et horaires'),
        Globe,
        'paramétrage ouverture fermetures domaines',
      )
      page(
        '/parametrage/reponses',
        $t('Réponses types et étiquettes'),
        MessageSquareText,
        'paramétrage modèles tags',
      )
      page('/parametrage/garde-fous', $t('Garde-fous'), ShieldAlert, 'paramétrage sujets sensibles')
      page('/outils', $t('Outils IA et serveurs MCP'), Wrench, 'paramétrage api')
      page('/automatisations', $t('Automatisations'), Workflow, 'règles relances flux déclencheurs')
      page('/widget', $t('Widget'), PaletteIcon, 'paramétrage apparence couleur installation')
      page('/parametrage/sms', $t('Numéros SMS'), Smartphone, 'paramétrage téléphone rcs twilio')
      page('/parametrage/api', $t('API et MCP'), KeyRound, 'paramétrage jetons webhooks')
    }
    return out
  }, [detail, pathname, me, summaries, inboxes, contacts, hits, agents, tagOptions, articles])

  const prepared = useMemo(
    () => new Map<string, Prepared>(entries.map((e) => [e.key, prepare(e)])),
    [entries],
  )

  // ── What answers what was typed, by group ─────────────────────────────────────────
  const sections = useMemo(() => {
    const known = visits()
    const visitOf = new Map(known.map((v) => [v.key, v]))
    const wanted = MODES[mode]
    const empty = tokens.length === 0
    return GROUPS.filter((g) => wanted.includes(g.key))
      .map((group) => {
        let items: { entry: Entry; score: number }[]
        if (group.key === 'recent') {
          items = empty
            ? known
                .map((v) => entries.find((e) => e.key === v.key))
                .filter((e): e is Entry => e !== undefined && e.group !== 'suggest')
                .slice(0, group.cap)
                .map((entry) => ({ entry, score: 0 }))
            : []
        } else {
          const own = entries.filter((e) => e.group === group.key)
          if (empty) {
            // Nothing typed: what is useful at once — what waits for the reader, the open
            // conversation's commands, the screens; not every contact.
            const waiting = (entry: Entry) =>
              entry.preview?.kind === 'conversation' && concernsMe(entry.preview.summary, me)
            items =
              mode !== 'all' || group.key === 'suggest' || group.key === 'pages'
                ? own.map((entry) => ({ entry, score: frecency(visitOf.get(entry.key)) }))
                : group.key === 'conversations'
                  ? own.filter(waiting).map((entry) => ({ entry, score: 0 }))
                  : []
            if (group.key === 'conversations') items = items.slice(0, mode === 'all' ? 4 : 8)
          } else {
            items = own
              .map((entry) => {
                const base = scoreOf(tokens, prepared.get(entry.key) as Prepared)
                const score = entry.found ? Math.max(base, 50) : base
                return { entry, score: score > 0 ? score + frecency(visitOf.get(entry.key)) : 0 }
              })
              .filter((i) => i.score > 0)
          }
          // Stable for equal scores: conversations stay newest first.
          items.sort((a, b) => b.score - a.score)
        }
        const cap = mode === 'all' ? group.cap : 40
        return { ...group, items: items.slice(0, cap).map((i) => i.entry) }
      })
      .filter((g) => g.items.length > 0)
  }, [entries, prepared, tokens, mode, me])

  const flat = sections.flatMap((s) => s.items)
  const current = flat[Math.min(active, flat.length - 1)]

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new search starts at the top
  useEffect(() => setActive(0), [query])

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function run(entry: Entry | undefined) {
    if (!entry) return
    if (entry.group !== 'suggest') {
      remember({
        key: entry.key,
        title: entry.title,
        subtitle: entry.subtitle ?? null,
        kind: entry.group,
        href: entry.href ?? null,
      })
    }
    onClose()
    entry.run()
  }

  let index = -1
  return (
    <div className="flex max-h-[min(34rem,76vh)] min-w-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4">
        <Search
          className={cn('size-4 shrink-0 text-muted-foreground', searching && 'animate-pulse')}
        />
        <input
          // biome-ignore lint/a11y/noAutofocus: the palette is this field
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((a) => Math.min(a + 1, flat.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              run(current)
            }
          }}
          placeholder={
            mode === 'commands'
              ? $t('Une commande…')
              : mode === 'tags'
                ? $t('Une étiquette…')
                : mode === 'people'
                  ? $t('Un visiteur, un contact, un conseiller…')
                  : $t('Rechercher une conversation, un contact, un message, une commande…')
          }
          aria-label={$t('Rechercher ou lancer une commande')}
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        {mode !== 'all' && (
          <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium">
            {mode === 'commands'
              ? $t('Commandes')
              : mode === 'tags'
                ? $t('Étiquettes')
                : $t('Personnes')}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={list} className="min-w-0 flex-1 overflow-y-auto p-1.5 scroll-discret">
          {sections.map((section) => (
            <section key={section.key} className="pb-1">
              <h3 className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {$t(section.label)}
              </h3>
              {section.items.map((entry) => {
                index += 1
                const at = index
                return (
                  <Row
                    key={entry.key}
                    entry={entry}
                    index={at}
                    active={at === active}
                    tokens={tokens}
                    now={now}
                    onHover={() => setActive(at)}
                    onRun={() => run(entry)}
                  />
                )
              })}
            </section>
          ))}
          {flat.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
              <Search className="size-5" />
              {searching
                ? $t('Recherche…')
                : $t('Rien ne répond à « {text} ».', { text: text.trim() })}
            </div>
          )}
        </div>
        {current?.preview && (
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-l bg-muted/20 p-4 scroll-discret md:block">
            <PreviewPane preview={current.preview} tokens={tokens} now={now} />
          </aside>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          {$t('naviguer')}
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd>
          {$t('ouvrir')}
        </span>
        <span className="ml-auto flex items-center gap-3">
          <Prefix sign=">" label={$t('commandes')} onPick={() => setQuery('>')} />
          <Prefix sign="#" label={$t('étiquettes')} onPick={() => setQuery('#')} />
          <Prefix sign="@" label={$t('personnes')} onPick={() => setQuery('@')} />
        </span>
      </footer>
    </div>
  )
}

function Prefix({
  sign,
  label,
  onPick,
}: {
  readonly sign: string
  readonly label: string
  readonly onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex items-center gap-1 hover:text-foreground"
    >
      <Kbd>{sign}</Kbd>
      {label}
    </button>
  )
}

function IconBox({ icon: Icon }: { readonly icon: LucideIcon }) {
  return (
    <span className="flex size-7 items-center justify-center rounded-md border bg-background">
      <Icon className={ICON} />
    </span>
  )
}

function Row({
  entry,
  index,
  active,
  tokens,
  now,
  onHover,
  onRun,
}: {
  readonly entry: Entry
  readonly index: number
  readonly active: boolean
  readonly tokens: readonly string[]
  readonly now: Date
  readonly onHover: () => void
  readonly onRun: () => void
}) {
  const said =
    entry.group === 'messages' && entry.subtitle ? excerpt(entry.subtitle, tokens, 80) : null
  const summary = entry.preview?.kind === 'conversation' ? entry.preview.summary : null
  return (
    <button
      type="button"
      data-index={index}
      onMouseMove={onHover}
      onClick={onRun}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left',
        active && 'bg-accent',
      )}
    >
      {entry.icon}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm">
            <Lit text={entry.title} tokens={tokens} />
          </span>
          {entry.context && entry.group === 'suggest' && (
            <span className="truncate text-xs text-muted-foreground">{entry.context}</span>
          )}
        </span>
        {said ? (
          <span className="block truncate text-xs text-muted-foreground">
            <Lit text={said.text} lit={said.lit} />
          </span>
        ) : (
          entry.subtitle && (
            <span className="block truncate text-xs text-muted-foreground">{entry.subtitle}</span>
          )
        )}
      </span>
      {summary && (
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {inboxTime(summary.lastMessageAt, now)}
        </span>
      )}
      {active && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
    </button>
  )
}

function PreviewPane({
  preview,
  tokens,
  now,
}: {
  readonly preview: Preview
  readonly tokens: readonly string[]
  readonly now: Date
}) {
  if (preview.kind === 'conversation') {
    const s = preview.summary
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <ContactAvatar name={s.contact.name} className="size-10" />
          <div className="min-w-0">
            <div className="truncate font-medium">{s.contact.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {s.contact.email ?? s.site}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StateChip conversation={s} />
          {s.tags.map((t) => (
            <ColorBadge key={t.label} color={t.color}>
              {t.label}
            </ColorBadge>
          ))}
        </div>
        <p className="rounded-lg border bg-background p-3 text-xs leading-relaxed">
          {s.preview || $t('Pas encore de message')}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{$t('Dernier message')}</dt>
          <dd>{inboxTime(s.lastMessageAt, now)}</dd>
          <dt className="text-muted-foreground">{$t('Affectée à')}</dt>
          <dd>{s.assignee ?? $t('Personne')}</dd>
          <dt className="text-muted-foreground">{$t('Site')}</dt>
          <dd className="truncate">{s.site}</dd>
        </dl>
      </div>
    )
  }
  if (preview.kind === 'contact') {
    const c = preview.contact
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <ContactAvatar name={c.name} className="size-10" />
          <div className="min-w-0">
            <div className="truncate font-medium">{c.name}</div>
            <div className="truncate text-xs text-muted-foreground">{c.email ?? '—'}</div>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{$t('Conversations')}</dt>
          <dd>{$tp(c.conversations, '{count} conversation', '{count} conversations')}</dd>
          <dt className="text-muted-foreground">{$t('Site')}</dt>
          <dd className="truncate">{c.site ?? '—'}</dd>
          <dt className="text-muted-foreground">{$t('Identifié')}</dt>
          <dd>{c.identified ? $t('Oui') : $t('Non')}</dd>
        </dl>
      </div>
    )
  }
  if (preview.kind === 'message') {
    const { hit } = preview
    const said = excerpt(hit.body, tokens, 400)
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {hit.author === 'ai' ? (
            <Sparkles className="size-3.5 text-violet-600 dark:text-violet-300" />
          ) : hit.author === 'note' ? (
            <StickyNote className="size-3.5" />
          ) : hit.author === 'agent' ? (
            <UserRound className="size-3.5" />
          ) : (
            <ArrowRightLeft className="size-3.5" />
          )}
          {hit.author === 'ai'
            ? $t('Réponse de l’IA')
            : hit.author === 'note'
              ? $t('Note interne')
              : hit.author === 'agent'
                ? $t('Réponse d’un conseiller')
                : $t('Message du visiteur')}
          <span className="ml-auto tabular-nums">{inboxTime(hit.at, now)}</span>
        </div>
        <p className="rounded-lg border bg-background p-3 text-xs leading-relaxed whitespace-pre-line">
          <Lit text={said.text} lit={said.lit} />
        </p>
        <div className="flex items-center gap-2 text-xs">
          <ContactAvatar name={hit.contactName} className="size-6 text-[9px]" />
          {hit.contactName}
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <Tag className="size-3.5" />
        {$t('Aperçu')}
      </div>
      <p className="text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
        {preview.text || $t('Vide pour l’instant.')}
      </p>
    </div>
  )
}
