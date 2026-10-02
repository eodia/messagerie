/**
 * Where the chat reads its settings (D19): rows keyed by FIELD LABELS — the labels of
 * `model.json`, which the screens and `Settings` speak. A choice reads as its label, a
 * relation as the id of the row it points at (a list for a multiple one), a person as
 * their agent id.
 *
 * The chat's own tables give them (`database.ts`); the tests, rows held in memory
 * (`memory.ts`).
 */

export interface LabeledRow {
  readonly id: string
  readonly values: Readonly<Record<string, unknown>>
}

export interface SettingsSource {
  readonly kind: 'database' | 'memory'
  /** The rows of a table, by its label. */
  rows(table: string): Promise<LabeledRow[]>
  /** Calls `onChange` when the table changes; null when this source cannot tell. */
  follow(
    table: string,
    onChange: () => void,
    onError: (error: unknown) => void,
  ): (() => void) | null
  /** Changes a row's values, by field label — a choice by its label. */
  update(table: string, id: string, values: Readonly<Record<string, unknown>>): Promise<void>
  /** Creates a row, by field label; returns its id. */
  create(table: string, values: Readonly<Record<string, unknown>>): Promise<string>
  remove(table: string, id: string): Promise<void>
}

/**
 * A write the settings refused: `ROW_NOT_FOUND`, or `INVALID` with the field at fault —
 * which `settings-screen.ts` turns into the codes the inbox reads.
 */
export class SettingsFailure extends Error {
  constructor(
    readonly code: 'ROW_NOT_FOUND' | 'INVALID' | 'TABLE_UNKNOWN',
    readonly field?: string,
  ) {
    super(field ? `${code}: ${field}` : code)
  }
}
