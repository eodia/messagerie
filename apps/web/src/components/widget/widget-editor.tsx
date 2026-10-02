'use client'

import { ScreenHeader, Slash } from '@/components/app/screen-header'
import { FormSkeleton } from '@/components/app/skeletons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { addressOf, idOfWord, wordOf, wordsAfter } from '@/lib/address'
import { api, apiAddress } from '@/lib/api'
import { $t } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { useTitle } from '@/lib/title'
import { useAddressBar } from '@/lib/use-address-bar'
import { cn } from '@/lib/utils'
import type { WidgetEditor, WidgetSettings } from '@chat/contracts'
import { Check, ChevronDown, LoaderCircle, Monitor, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasProblems, normalize, previewSite, problemsOf } from './settings'
import { WidgetForm } from './widget-form'

const BASE = '/widget'

/** The site the address names, among those given. */
const siteInAddress = (ids: readonly string[]): string | null => {
  const word = wordsAfter(BASE)?.[0]
  return word ? idOfWord(word, ids) : null
}

type Scene = 'closed' | 'nudge' | 'welcome' | 'conversation'

/**
 * The widget editor: a site's widget as it will look — its colour, its side, its font, its
 * words — with the real widget beside the fields, in preview mode. Settings are the site's
 * row in « Sites »: this screen reads them, and a supervisor saves them there.
 */
export function WidgetEditorScreen() {
  const [editor, setEditor] = useState<WidgetEditor | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Readonly<Record<string, WidgetSettings>>>({})
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [scene, setScene] = useState<Scene>('welcome')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [identified, setIdentified] = useState(false)
  const [ready, setReady] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const server = apiAddress()
  const serverOrigin = useMemo(() => new URL(server).origin, [server])

  useEffect(() => {
    api
      .widget()
      .then((loaded) => {
        setEditor(loaded)
        // The site the address names, else the first.
        const named = siteInAddress(loaded.sites.map((s) => s.id))
        setSiteId((current) => current ?? named ?? loaded.sites[0]?.id ?? null)
      })
      .catch((failure: { code?: string }) => setError(failure.code ?? 'INTERNAL_ERROR'))
  }, [])

  const site = editor?.sites.find((s) => s.id === siteId) ?? null

  // The address: the site whose widget is shown.
  const address =
    editor === null
      ? null
      : site
        ? addressOf(BASE, wordOf(site.id, site.settings.name, 'site'))
        : BASE
  useTitle([site?.settings.name, $t('Widget')])
  useAddressBar(address, async () => {
    const named = siteInAddress(editor?.sites.map((s) => s.id) ?? [])
    if (named) setSiteId(named)
  })
  const draft = site ? (drafts[site.id] ?? site.settings) : null
  const problems = draft ? problemsOf(draft) : null
  const dirty =
    site !== null &&
    draft !== null &&
    JSON.stringify(normalize(draft)) !== JSON.stringify(site.settings)
  const anyDirty =
    editor?.sites.some((s) => {
      const d = drafts[s.id]
      return d !== undefined && JSON.stringify(normalize(d)) !== JSON.stringify(s.settings)
    }) ?? false

  // Leaving with changes not saved asks first.
  useEffect(() => {
    if (!anyDirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [anyDirty])

  // The preview says when it listens; from then on, every change reaches it.
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.origin !== serverOrigin || event.source !== frame.current?.contentWindow) return
      if ((event.data as { type?: unknown } | null)?.type === 'messagerie:ready') setReady(true)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [serverOrigin])

  const post = useCallback(() => {
    if (!ready || !site || !draft) return
    frame.current?.contentWindow?.postMessage(
      { type: 'messagerie:preview', site: previewSite(site, draft), scene, identified },
      serverOrigin,
    )
  }, [ready, site, draft, scene, identified, serverOrigin])

  useEffect(() => {
    post()
  }, [post])

  const change = (update: (draft: WidgetSettings) => WidgetSettings) => {
    if (!site) return
    setDrafts((all) => ({ ...all, [site.id]: update(all[site.id] ?? site.settings) }))
    setSavedAt(null)
  }

  const save = async () => {
    if (!site || !draft || !editor) return
    setSaving(true)
    setError(null)
    try {
      const saved = await api.saveWidget(site.id, normalize(draft))
      setEditor({
        ...editor,
        sites: editor.sites.map((s) => (s.id === saved.id ? saved : s)),
      })
      setDrafts(({ [site.id]: _, ...others }) => others)
      setSavedAt(Date.now())
    } catch (failure) {
      setError((failure as { code?: string }).code ?? 'INTERNAL_ERROR')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <ScreenHeader
        tools={
          editor &&
          site && (
            <>
              {savedAt !== null && !dirty && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5 text-primary" />
                  {$t('Enregistré')}
                </span>
              )}
              {dirty && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setDrafts(({ [site.id]: _, ...others }) => others)}
                >
                  {$t('Annuler les modifications')}
                </Button>
              )}
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={
                  !editor.canEdit ||
                  !dirty ||
                  saving ||
                  (problems !== null && hasProblems(problems))
                }
                onClick={() => void save()}
              >
                {saving && <LoaderCircle className="size-3.5 animate-spin" />}
                {$t('Enregistrer')}
              </Button>
            </>
          )
        }
      >
        <span className="font-medium">{$t('Widget')}</span>
        {editor && site && (
          <>
            <Slash />
            {editor.sites.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-sm">
                    {site.settings.name}
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {editor.sites.map((s) => (
                    <DropdownMenuItem key={s.id} onSelect={() => setSiteId(s.id)}>
                      {s.settings.name}
                      {s.id === site.id && <Check className="ml-auto size-3.5" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="truncate text-muted-foreground">{site.settings.name}</span>
            )}
          </>
        )}
      </ScreenHeader>

      {!editor && !error && (
        <div className="flex min-h-0 flex-1">
          <div className="w-[380px] shrink-0 border-r">
            <FormSkeleton fields={6} />
          </div>
          <div className="flex min-w-0 flex-1 items-end justify-end bg-surface p-8">
            <Skeleton className="h-[520px] w-[360px] rounded-2xl" />
          </div>
        </div>
      )}
      {editor && !site && (
        <p className="p-6 text-sm text-muted-foreground">
          {$t('Aucun site : ajoutez-en un dans « Sites et horaires ».')}
        </p>
      )}

      {editor && site && draft && problems && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <div className="scroll-discret shrink-0 border-b lg:w-[440px] lg:overflow-y-auto lg:border-r lg:border-b-0">
            {(error || !editor.canEdit) && (
              <div className="space-y-2 px-5 pt-4">
                {error && (
                  <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {messageFor(error)}
                  </p>
                )}
                {!editor.canEdit && (
                  <p className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    {$t(
                      'Réservé aux superviseurs : essayez des réglages dans l’aperçu, sans les enregistrer.',
                    )}
                  </p>
                )}
              </div>
            )}
            <WidgetForm
              site={site}
              draft={draft}
              problems={problems}
              onChange={change}
              server={server}
            />
          </div>

          <div className="flex min-h-[720px] min-w-0 flex-1 flex-col bg-muted/40 lg:min-h-0">
            <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
              <Segmented
                aria-label={$t('Ce que montre l’aperçu')}
                value={scene}
                onValueChange={setScene}
                options={[
                  { value: 'closed', label: $t('Fermé') },
                  { value: 'nudge', label: $t('Bulle d’accueil') },
                  { value: 'welcome', label: $t('Accueil') },
                  { value: 'conversation', label: $t('Conversation') },
                ]}
              />
              <Segmented
                aria-label={$t('Visiteur')}
                value={identified ? 'signed' : 'anonymous'}
                onValueChange={(v) => setIdentified(v === 'signed')}
                options={[
                  { value: 'anonymous', label: $t('Anonyme') },
                  { value: 'signed', label: $t('Client connecté') },
                ]}
              />
              <Segmented
                aria-label={$t('Écran')}
                value={device}
                onValueChange={setDevice}
                className="ml-auto"
                options={[
                  {
                    value: 'desktop',
                    label: <Monitor className="size-3.5" aria-label={$t('Ordinateur')} />,
                  },
                  {
                    value: 'mobile',
                    label: <Smartphone className="size-3.5" aria-label={$t('Mobile')} />,
                  },
                ]}
              />
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center p-5">
              <div
                className={cn(
                  'overflow-hidden border bg-background shadow-sm transition-[width,height,border-radius] duration-300',
                  device === 'desktop'
                    ? 'h-full w-full rounded-xl'
                    : 'h-[min(760px,100%)] w-[380px] rounded-[32px] border-[6px] border-foreground/80',
                )}
              >
                <iframe
                  ref={frame}
                  title={$t('Aperçu du widget')}
                  src={`${server}/widget/preview`}
                  onLoad={() => post()}
                  className="size-full"
                />
              </div>
            </div>
          </div>
        </div>
      )}
      {!editor && error && (
        <p className="m-6 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {messageFor(error)}
        </p>
      )}
    </>
  )
}
