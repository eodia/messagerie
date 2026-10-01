'use client'

import { api } from '@/lib/api'
import type { SettingsOverview, SettingsRow, SettingsTable } from '@chat/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * The rows a settings screen works on: its tables, and those their relations point at — to
 * name an inbox's teams, a site's inbox… Read from basedb through the chat server, which
 * writes there too (D10).
 */

export type Values = Readonly<Record<string, unknown>>

let overviewOnce: Promise<SettingsOverview> | null = null

/** The accounts changed (an invitation): read the overview again next time. */
export function forgetOverview(): void {
  overviewOnce = null
}

export interface SettingsData {
  readonly overview: SettingsOverview | null
  readonly error: string | null
  readonly setError: (code: string | null) => void
  readonly loading: boolean
  readonly rows: (key: string) => readonly SettingsRow[]
  readonly table: (key: string) => SettingsTable | undefined
  /** Reads tables again — those given, or all of the screen's. */
  readonly reload: (keys?: readonly string[]) => Promise<void>
  readonly canEdit: boolean
  /** False: the template's rows, changed in memory only. */
  readonly persistent: boolean
}

export const codeOf = (failure: unknown): string =>
  (failure as { code?: string } | null)?.code ?? 'INTERNAL_ERROR'

export function useSettingsData(keys: readonly string[]): SettingsData {
  const wanted = keys.join(',')
  const [overview, setOverview] = useState<SettingsOverview | null>(null)
  const [tables, setTables] = useState<Readonly<Record<string, readonly SettingsRow[]>>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(
    async (only?: readonly string[]) => {
      setLoading(true)
      try {
        overviewOnce ??= api.settings()
        const next = await overviewOnce
        setOverview(next)
        const own = wanted.split(',').filter(Boolean)
        const needed = new Set(only ?? own)
        if (!only) {
          for (const table of next.tables.filter((t) => own.includes(t.key))) {
            for (const field of table.fields) if (field.target) needed.add(field.target)
          }
        }
        const loaded = await Promise.all(
          [...needed].map(async (key) => [key, await api.settingsRows(key)] as const),
        )
        setTables((all) => ({ ...all, ...Object.fromEntries(loaded) }))
      } catch (failure) {
        overviewOnce = null
        setError(codeOf(failure))
      } finally {
        setLoading(false)
      }
    },
    [wanted],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return useMemo(
    () => ({
      overview,
      error,
      setError,
      loading,
      rows: (key: string) => tables[key] ?? [],
      table: (key: string) => overview?.tables.find((t) => t.key === key),
      reload,
      canEdit: overview?.canEdit ?? false,
      persistent: overview?.persistent ?? true,
    }),
    [overview, error, loading, tables, reload],
  )
}

// ── Reading a value as its field holds it ─────────────────────────────────────────────

export const text = (value: unknown): string => (typeof value === 'string' ? value : '')
export const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string' && value !== ''
      ? [value]
      : []
export const one = (value: unknown): string | null => list(value)[0] ?? null
export const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
export const bool = (value: unknown): boolean => value === true

/** A row's name: its « Nom », « Titre », « Créneau »… — the first text that names it. */
export function nameOf(table: SettingsTable | undefined, values: Values): string {
  const field = table?.fields.find((f) => f.kind === 'short_text')
  return field ? text(values[field.label]).trim() : ''
}
