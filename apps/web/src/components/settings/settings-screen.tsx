'use client'

import { Chip } from '@/components/app/chip'
import { ScreenHeader, Slash } from '@/components/app/screen-header'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { $t, $tp } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { useTitle } from '@/lib/title'
import type { SettingsField, SettingsOverview, SettingsRow, SettingsTable } from '@chat/contracts'
import { Check, LoaderCircle, Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Choice, Choices } from './field-input'
import { RowEditor } from './row-editor'
import { GROUPS, isColorField, viewOf } from './views'

/**
 * A settings screen: the tables of one group — « Équipes et conseillers », « Sites et
 * horaires »… — each in a tab, its rows in a list, a row in a form. Read from basedb and
 * written there by the server, with the supervisor's own token (D10).
 */

let overviewCache: Promise<SettingsOverview> | null = null

/** What names a row in a list or a menu: its first text — « Nom », « Titre »… */
function titleOf(table: SettingsTable | undefined, row: SettingsRow): string {
  const field = table?.fields.find((f) => f.kind === 'short_text')
  const value = field ? row.values[field.label] : null
  return typeof value === 'string' && value.trim() !== '' ? value : $t('(sans nom)')
}

export function SettingsScreen({ group: key }: { readonly group: string }) {
  const group = GROUPS[key]
  useTitle([group ? $t(group.title) : null])
  const [overview, setOverview] = useState<SettingsOverview | null>(null)
  const [rows, setRows] = useState<Readonly<Record<string, readonly SettingsRow[]>>>({})
  const [active, setActive] = useState(group?.tables[0] ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<{ row: SettingsRow | null } | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const tables = useMemo(
    () => (group?.tables ?? []).flatMap((k) => overview?.tables.find((t) => t.key === k) ?? []),
    [group, overview],
  )
  const table = tables.find((t) => t.key === active) ?? tables[0]

  // The group's tables, and those their relations point at — to name the rows they hold.
  const load = useCallback(async () => {
    if (!group) return
    setLoading(true)
    try {
      overviewCache ??= api.settings()
      const next = await overviewCache
      setOverview(next)
      const needed = new Set(group.tables)
      for (const t of next.tables.filter((t) => group.tables.includes(t.key))) {
        for (const f of t.fields) if (f.target) needed.add(f.target)
      }
      const loaded = await Promise.all(
        [...needed].map(async (k) => [k, await api.settingsRows(k)] as const),
      )
      setRows(Object.fromEntries(loaded))
      setError(null)
    } catch (failure) {
      overviewCache = null
      setError((failure as { code?: string }).code ?? 'INTERNAL_ERROR')
    } finally {
      setLoading(false)
    }
  }, [group])

  useEffect(() => {
    void load()
  }, [load])

  const choices: Choices = useMemo(
    () => ({
      rowsOf: (target: string): Choice[] =>
        (rows[target] ?? []).map((row) => ({
          id: row.id,
          label: titleOf(
            overview?.tables.find((t) => t.key === target),
            row,
          ),
        })),
      users: (overview?.users ?? []).map((u) => ({ id: u.id, label: u.name })),
    }),
    [rows, overview],
  )

  if (!group) {
    return (
      <ScreenHeader>
        <span className="font-medium">{$t('Paramétrage')}</span>
      </ScreenHeader>
    )
  }

  const canEdit = overview?.canEdit ?? false
  const list = table ? (rows[table.key] ?? []) : []
  const view = table ? viewOf(table.key) : null
  const columns = table
    ? (view?.columns ?? [])
        .map((label) => table.fields.find((f) => f.label === label))
        .filter((f): f is SettingsField => f !== undefined)
    : []

  return (
    <>
      <ScreenHeader
        tools={
          <>
            {savedAt !== null && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="size-3.5 text-primary" />
                {$t('Enregistré')}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              className="h-8 gap-1.5 text-xs"
            >
              <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
              {$t('Actualiser')}
            </Button>
            {canEdit && table && (
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => setEditing({ row: null })}
              >
                <Plus className="size-3.5" />
                {$t('Ajouter')}
              </Button>
            )}
          </>
        }
      >
        <span className="text-muted-foreground">{$t('Paramétrage')}</span>
        <Slash />
        <span className="font-medium">{$t(group.title)}</span>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-discret">
        <div className="mx-auto max-w-5xl space-y-4 px-6 py-5">
          {tables.length > 1 && (
            <Tabs value={table?.key ?? ''} onValueChange={setActive}>
              <TabsList>
                {tables.map((t) => (
                  <TabsTrigger key={t.key} value={t.key}>
                    {t.label}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {(rows[t.key] ?? []).length}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {table?.description && (
            <p className="max-w-3xl text-sm text-muted-foreground">{table.description}</p>
          )}
          {overview && !canEdit && (
            <p className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {$t('Lecture seule : le paramétrage est réservé aux superviseurs.')}
            </p>
          )}
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {messageFor(error)}
            </p>
          )}
          {!overview && !error && (
            <div className="flex justify-center py-12">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {table && overview && (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    {columns.map((field) => (
                      <th key={field.label} className="px-3 py-2 text-left font-medium">
                        {field.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setEditing({ row })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') setEditing({ row })
                      }}
                      tabIndex={0}
                      className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:outline-none"
                    >
                      {columns.map((field, index) => (
                        <td
                          key={field.label}
                          className={
                            index === 0
                              ? 'max-w-64 px-3 py-2.5 font-medium'
                              : 'max-w-72 px-3 py-2.5 text-muted-foreground'
                          }
                        >
                          <Cell field={field} value={row.values[field.label]} choices={choices} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {canEdit
                    ? $t('Aucune ligne pour l’instant : « Ajouter » en crée une.')
                    : $t('Aucune ligne pour l’instant.')}
                </p>
              )}
            </div>
          )}
          {table && list.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {$tp(list.length, '{count} ligne', '{count} lignes')}
            </p>
          )}
        </div>
      </div>

      {editing && table && (
        <RowEditor
          table={table}
          row={editing.row}
          title={editing.row ? titleOf(table, editing.row) : $t('Nouvelle ligne')}
          choices={choices}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setSavedAt(Date.now())
            void load()
          }}
        />
      )}
    </>
  )
}

/** A value, as the list shows it: a chip for a choice, names for a relation. */
function Cell({
  field,
  value,
  choices,
}: {
  readonly field: SettingsField
  readonly value: unknown
  readonly choices: Choices
}) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return <span className="text-muted-foreground/60">—</span>
  }
  switch (field.kind) {
    case 'boolean':
      return value === true ? (
        <Check className="size-4 text-primary" aria-label={$t('Oui')} />
      ) : (
        <span className="text-muted-foreground/60">—</span>
      )
    case 'select':
      return <Chip tint="zinc">{String(value)}</Chip>
    case 'multi_select':
      return <span className="truncate">{(value as string[]).join(', ')}</span>
    case 'link':
    case 'multi_link': {
      const ids = Array.isArray(value) ? (value as string[]) : [String(value)]
      const named = choices.rowsOf(field.target ?? '')
      return (
        <span className="line-clamp-1">
          {ids.map((id) => named.find((c) => c.id === id)?.label ?? '?').join(', ')}
        </span>
      )
    }
    case 'user':
      return <span>{choices.users.find((u) => u.id === value)?.label ?? $t('Personne')}</span>
    default: {
      const text = String(value)
      if (isColorField(field.label) && /^#[0-9a-f]{6}$/i.test(text)) {
        return (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs">
            <span className="size-3 rounded-full border" style={{ background: text }} />
            {text.toUpperCase()}
          </span>
        )
      }
      return (
        <span className="line-clamp-1 whitespace-pre-line">{text.split('\n').join(' · ')}</span>
      )
    }
  }
}
