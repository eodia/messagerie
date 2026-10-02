/**
 * The dashboards (D22): questions on what the conversations say — built by choosing, or
 * written in SQL — drawn as charts on a grid. Read through the views of the `analytics`
 * schema, never the tables themselves: nothing of the accounts, sessions or secrets.
 */

export type ColumnType = 'text' | 'number' | 'date' | 'boolean'

export interface SourceColumn {
  readonly name: string
  readonly label: string
  readonly type: ColumnType
  /** The values it takes, when they are few: statuses, priorities. */
  readonly values?: readonly { readonly value: string; readonly label: string }[]
}

/** What a question reads: a view of the `analytics` schema. */
export interface AnalyticsSource {
  readonly key: string
  readonly label: string
  readonly description: string
  readonly columns: readonly SourceColumn[]
}

export type FilterOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'empty'
  | 'not_empty'
  | 'gt'
  | 'lt'
  | 'between'
  /** The last N units, up to now: `values` = [N, 'days' | 'weeks' | 'months']. */
  | 'last'
  | 'true'
  | 'false'

export interface QueryFilter {
  readonly column: string
  readonly op: FilterOperator
  readonly values: readonly string[]
}

export type AggregateFunction =
  | 'count'
  | 'distinct'
  | 'sum'
  | 'avg'
  | 'median'
  | 'min'
  | 'max'
  /** The share of rows where a yes/no column is yes, in %. */
  | 'share'

export interface QueryAggregation {
  readonly fn: AggregateFunction
  /** None for `count`. */
  readonly column?: string
}

export type TimeUnit = 'hour' | 'day' | 'week' | 'month' | 'year' | 'weekday' | 'hour_of_day'

export interface QueryBreakout {
  readonly column: string
  /** A date grouped by. */
  readonly unit?: TimeUnit
}

/** A question built by choosing: a source, filters, what to count, by what. */
export interface BuilderQuery {
  readonly source: string
  readonly filters: readonly QueryFilter[]
  readonly aggregations: readonly QueryAggregation[]
  readonly breakouts: readonly QueryBreakout[]
  /** A result column's name, and the order. */
  readonly sort?: { readonly column: string; readonly desc: boolean }
  readonly limit?: number
}

export type VisualizationType = 'number' | 'table' | 'bar' | 'row' | 'line' | 'area' | 'pie'

export interface Visualization {
  readonly type: VisualizationType
  /** Bars: one stacked on the other, by the second breakout. */
  readonly stacked?: boolean
  /** A number's unit: `%`, `s` (said as a duration), `€`. */
  readonly unit?: '%' | 's' | '€' | ''
}

export type Question =
  | { readonly mode: 'builder'; readonly query: BuilderQuery; readonly viz: Visualization }
  | { readonly mode: 'sql'; readonly sql: string; readonly viz: Visualization }

export interface ResultColumn {
  readonly name: string
  readonly type: ColumnType
}

export interface QueryResult {
  readonly columns: readonly ResultColumn[]
  readonly rows: readonly (readonly unknown[])[]
  /** More rows than shown: cut at two thousand. */
  readonly truncated: boolean
  readonly ms: number
  /** The SQL that ran — the builder's, for whoever wants to start from it. */
  readonly sql: string
}

/**
 * A filter of a dashboard (basedb's parameters): a control above the cards — a period, values
 * to pick, a text — tied, or not, to each card on a column of its question.
 */
export type DashboardFilterKind = 'period' | 'choice' | 'text'

export interface DashboardFilter {
  readonly id: string
  readonly label: string
  readonly kind: DashboardFilterKind
  /** `choice`: where its values come from — a column of a source. */
  readonly source?: string
  readonly column?: string
  /** Its value when the dashboard opens: `['30', 'days']`, values, a text. Empty: none. */
  readonly default: readonly string[]
}

/** A filter tied to a card: the column of the card's question it bears on. */
export interface CardLink {
  readonly filter: string
  readonly column: string
}

/** The filters' values, as chosen above the cards. */
export type FilterValues = Readonly<Record<string, readonly string[]>>

/** A card of a dashboard, on a twelve-column grid. */
export interface DashboardCard {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly title: string
  readonly kind: 'question' | 'text'
  readonly question?: Question
  /** A text card's Markdown. */
  readonly text?: string
  /** The dashboard's filters it follows; none, it follows none. */
  readonly links?: readonly CardLink[]
}

export interface Dashboard {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly cards: readonly DashboardCard[]
  readonly filters: readonly DashboardFilter[]
  /** Agents see it too; only supervisors change it. */
  readonly shared: boolean
  readonly createdBy: string
  readonly updatedAt: string
}

export interface DashboardBody {
  readonly name: string
  readonly description: string
  readonly cards: readonly DashboardCard[]
  readonly filters: readonly DashboardFilter[]
  readonly shared: boolean
}

/** What the AI proposes for a question said in words. */
export interface QuestionDraft {
  readonly sql: string
  readonly viz: Visualization
  readonly title: string
}
