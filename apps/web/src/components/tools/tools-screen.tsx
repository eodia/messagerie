'use client'

import { useBasedbUrl } from '@/components/app/app-shell'
import { Chip } from '@/components/app/chip'
import { ScreenHeader } from '@/components/app/screen-header'
import { ToolDialog, type ToolTarget } from '@/components/app/tool-dialog'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { $t, $tp, msg } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { useInbox } from '@/lib/store/inbox'
import type { ToolsOverview } from '@chat/contracts'
import {
  CalendarClock,
  ExternalLink,
  FileText,
  Globe,
  LoaderCircle,
  type LucideIcon,
  Pencil,
  Play,
  Plug,
  RefreshCw,
  Wrench,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

const TYPES: Record<
  ToolsOverview['tools'][number]['type'],
  { readonly label: string; readonly icon: LucideIcon }
> = {
  basedb: { label: msg('Lecture dans basedb'), icon: FileText },
  http: { label: msg('Appel HTTP'), icon: Globe },
  callback: { label: msg('Rappel'), icon: CalendarClock },
}

interface Testing extends ToolTarget {
  readonly tool: string
  readonly server?: string
}

/**
 * What the AI may do: the tools basedb declares — its own calls and its MCP servers' —
 * whether each server answers, and a test by a supervisor before the AI relies on one.
 */
export function ToolsScreen() {
  const basedbUrl = useBasedbUrl()
  const me = useInbox((s) => s.me)
  const [overview, setOverview] = useState<ToolsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState<Testing | null>(null)
  const supervisor = me?.role === 'supervisor'

  const load = useCallback(() => {
    setLoading(true)
    api
      .tools()
      .then((next) => {
        setOverview(next)
        setError(null)
      })
      .catch((failure: { code?: string }) => setError(failure.code ?? 'INTERNAL_ERROR'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [])

  const testButton = (target: Testing) => (
    <Hint label={supervisor ? $t('Essayer l’outil') : $t('Réservé aux superviseurs')}>
      <span>
        <Button
          variant="outline"
          size="sm"
          disabled={!supervisor}
          onClick={() => setTesting(target)}
          className="h-7 gap-1.5 px-2 text-xs"
        >
          <Play className="size-3" />
          {$t('Tester')}
        </Button>
      </span>
    </Hint>
  )

  return (
    <>
      <ScreenHeader
        tools={
          <>
            <Button variant="ghost" size="sm" onClick={load} className="h-8 gap-1.5 text-xs">
              <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
              {$t('Actualiser')}
            </Button>
            <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs">
              <a href={basedbUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                {$t('Ouvrir dans basedb')}
              </a>
            </Button>
            <Button size="sm" asChild className="h-8 gap-1.5 text-xs">
              <Link href="/parametrage/outils">
                <Pencil className="size-3.5" />
                {$t('Modifier les outils')}
              </Link>
            </Button>
          </>
        }
      >
        <span className="font-medium">{$t('Outils IA')}</span>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-discret">
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
          <p className="max-w-3xl text-sm text-muted-foreground">
            {$t(
              'Les seules actions que l’IA peut mener. Elles se déclarent dans basedb, tables « Outils IA » et « Serveurs MCP ». Un secret ne s’y écrit jamais : un jeton ou un en-tête le cite comme ${VARIABLE}, lue dans l’environnement du serveur de la messagerie.',
            )}
          </p>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {messageFor(error)}
            </div>
          )}
          {overview === null && !error && (
            <div className="flex justify-center py-12">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {overview && (
            <>
              <section className="overflow-hidden rounded-lg border">
                <header className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5">
                  <Wrench className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-medium">{$t('Outils déclarés')}</h2>
                  <span className="text-xs text-muted-foreground">{overview.tools.length}</span>
                </header>
                {overview.tools.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    {$t('Aucun outil actif.')}
                  </p>
                ) : (
                  <ul className="divide-y">
                    {overview.tools.map((tool) => {
                      const { label, icon: Icon } = TYPES[tool.type]
                      return (
                        <li key={tool.id} className="flex items-start gap-3 px-4 py-3">
                          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
                            <Icon className="size-4 text-muted-foreground" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{tool.name}</span>
                              <Chip tint="zinc">{$t(label)}</Chip>
                              {tool.agent && <Chip tint="violet">{$t('Agent IA')}</Chip>}
                              {tool.copilot && <Chip tint="sky">{$t('Copilote')}</Chip>}
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {tool.description}
                            </p>
                            {tool.target && (
                              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                                {tool.type === 'http' ? `${tool.method} ` : ''}
                                {tool.target}
                              </p>
                            )}
                          </div>
                          {testButton({
                            tool: tool.id,
                            title: tool.name,
                            description: tool.description,
                            parameters: tool.parameters,
                          })}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Plug className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-medium">{$t('Serveurs MCP')}</h2>
                  <span className="text-xs text-muted-foreground">{overview.mcp.length}</span>
                </div>
                {overview.mcp.length === 0 && (
                  <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                    {$t(
                      'Aucun serveur MCP actif. Un serveur MCP ajouté dans basedb offre ses outils à l’IA, sans une ligne de code.',
                    )}
                  </p>
                )}
                {overview.mcp.map((server) => (
                  <article key={server.id} className="overflow-hidden rounded-lg border">
                    <header className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2.5">
                      <span className="text-sm font-medium">{server.name}</span>
                      {server.reachable ? (
                        <Chip tint="emerald">
                          <span className="size-1.5 rounded-full bg-current" />
                          {$tp(server.tools.length, '{count} outil', '{count} outils')}
                        </Chip>
                      ) : (
                        <Chip tint="rose">
                          <span className="size-1.5 rounded-full bg-current" />
                          {$t('Ne répond pas')}
                        </Chip>
                      )}
                      {server.agent && <Chip tint="violet">{$t('Agent IA')}</Chip>}
                      {server.copilot && <Chip tint="sky">{$t('Copilote')}</Chip>}
                      <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">
                        {server.url}
                      </span>
                    </header>
                    {server.tools.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-muted-foreground">
                        {server.reachable
                          ? $t('Le serveur ne propose aucun outil autorisé.')
                          : $t(
                              'Injoignable : l’IA répond sans ses outils. Vérifiez son adresse, son jeton et ses en-têtes.',
                            )}
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {server.tools.map((tool) => (
                          <li key={tool.name} className="flex items-center gap-3 px-4 py-2.5">
                            <span className="font-mono text-xs">{tool.name}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                              {tool.description}
                            </span>
                            {testButton({
                              tool: tool.name,
                              server: server.id,
                              title: `${server.name} › ${tool.name}`,
                              description: tool.description,
                              parameters: tool.parameters,
                            })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
              </section>
            </>
          )}
        </div>
      </div>

      <ToolDialog
        tool={testing}
        onClose={() => setTesting(null)}
        note={$t('Un essai : hors de toute conversation, sans client et sans trace dans un fil.')}
        run={(args) =>
          api.testTool({
            tool: testing?.tool ?? '',
            ...(testing?.server ? { server: testing.server } : {}),
            arguments: args,
          })
        }
      />
    </>
  )
}
