'use client'

import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/tooltip'
import {
  END_NODE,
  type FlowEdge,
  type FlowNode,
  GAP_Y,
  type Slot,
  TRIGGER_NODE,
  layoutFlow,
  mergeOf,
} from '@/lib/automation-layout'
import {
  type Draft,
  STEP_LABELS,
  TRIGGER_LABELS,
  allSteps,
  conditionText,
  findPath,
  problemText,
  stepProblem,
  stepRecordText,
  stepSummary,
  triggerSummary,
} from '@/lib/automations'
import { $t } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type {
  AutomationChoices,
  AutomationRun,
  AutomationStep,
  AutomationStepKind,
  AutomationTriggerKind,
  BranchPath,
  RunStepRecord,
} from '@chat/contracts'
import {
  Background,
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import './flow.css'
import {
  AtSign,
  Bell,
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  Database,
  Flag,
  Forward,
  Hourglass,
  Inbox,
  type LucideIcon,
  Maximize,
  MessageSquareReply,
  MessageSquareText,
  MousePointerClick,
  Plus,
  RotateCcw,
  Smile,
  Sparkles,
  Split,
  Star,
  StickyNote,
  Tag,
  TimerOff,
  TriangleAlert,
  UserRoundPlus,
  Webhook,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { createContext, useContext, useEffect, useMemo } from 'react'

/**
 * An automation's flow, drawn — basedb's canvas: the trigger on top, each step a card
 * below it, a condition opening its paths side by side and having them meet again. A « + »
 * on an edge asks the editor's picker for a step there; a card opens its settings. A run
 * chosen in the list is laid over the flow: each step says how it went, the way it took is
 * drawn, the rest is dimmed.
 */

export const STEP_ICONS: Readonly<Record<AutomationStepKind, LucideIcon>> = {
  assign: UserRoundPlus,
  transfer: Forward,
  tag: Tag,
  priority: Flag,
  status: CircleCheck,
  reply: MessageSquareReply,
  note: StickyNote,
  ask_email: AtSign,
  survey: Star,
  notify: Bell,
  webhook: Webhook,
  ai: Sparkles,
  data: Database,
  branch: Split,
  wait: Hourglass,
}

const ACTION = 'bg-sky-500/12 text-sky-700 dark:text-sky-300'
const WRITE = 'bg-teal-500/12 text-teal-700 dark:text-teal-300'
const FLOW = 'bg-amber-500/15 text-amber-700 dark:text-amber-300'

/**
 * What acts on the conversation in one tone, what writes in another, the AI in its own,
 * what shapes the flow in a fourth.
 */
export const STEP_TONES: Readonly<Record<AutomationStepKind, string>> = {
  assign: ACTION,
  transfer: ACTION,
  tag: ACTION,
  priority: ACTION,
  status: ACTION,
  data: ACTION,
  reply: WRITE,
  note: WRITE,
  ask_email: WRITE,
  survey: WRITE,
  notify: WRITE,
  webhook: WRITE,
  ai: 'bg-violet-500/12 text-violet-700 dark:text-violet-300',
  branch: FLOW,
  wait: FLOW,
}

export const TRIGGER_ICONS: Readonly<Record<AutomationTriggerKind, LucideIcon>> = {
  conversation_created: Zap,
  visitor_message: MessageSquareText,
  handed_off: Sparkles,
  assigned: UserRoundPlus,
  transferred: Inbox,
  resolved: CircleCheck,
  reopened: RotateCcw,
  sentiment_changed: Smile,
  survey_answered: Star,
  no_reply: TimerOff,
  schedule: Clock,
  button: MousePointerClick,
  webhook: Webhook,
}

/** A trigger in the accent: what sets the flow off. */
export const TRIGGER_TONE = 'bg-primary/12 text-primary'

// ── What the canvas asks of the editor ──────────────────────────────────────

interface FlowActions {
  readonly select: (id: string) => void
  readonly pick: (slot: Slot) => void
}

const Actions = createContext<FlowActions>({ select: () => undefined, pick: () => undefined })

// ── Nodes ───────────────────────────────────────────────────────────────────

interface CardData extends Record<string, unknown> {
  readonly width: number
  readonly height: number
  readonly selected: boolean
  readonly dimmed: boolean
}

interface TriggerData extends CardData {
  readonly title: string
  readonly summary: string
  readonly condition: string
  readonly icon: LucideIcon
}

interface StepData extends CardData {
  readonly step: AutomationStep
  readonly summary: string
  readonly problem: string | null
  readonly run: RunStepRecord | null
}

interface PathData extends CardData {
  readonly path: BranchPath
  readonly summary: string
  readonly taken: boolean
}

type TriggerNode = Node<TriggerData, 'trigger'>
type StepNode = Node<StepData, 'step'>
type PathNode = Node<PathData, 'path'>
type BareNode = Node<CardData & { readonly append?: number }, 'merge' | 'end'>

/** The edges of a card: in on top, out below — drawn by the edges, not by the card. */
function Ports() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!pointer-events-none !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!pointer-events-none !opacity-0"
      />
    </>
  )
}

const cardClass = (selected: boolean, dimmed: boolean) =>
  cn(
    'flex w-full items-center gap-3 rounded-xl border bg-card px-3 text-left shadow-xs transition-[box-shadow,opacity,border-color]',
    'hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    selected && 'border-primary ring-2 ring-primary/25 hover:border-primary',
    dimmed && 'opacity-40',
  )

function TriggerCard({ id, data }: NodeProps<TriggerNode>) {
  const { select } = useContext(Actions)
  const Icon = data.icon
  return (
    <div style={{ width: data.width, height: data.height }}>
      <Ports />
      <button
        type="button"
        onClick={() => select(id)}
        className={cardClass(data.selected, data.dimmed)}
        style={{ height: data.height }}
      >
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            TRIGGER_TONE,
          )}
        >
          <Icon className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {$t('Quand')}
          </span>
          <span className="block truncate text-sm font-medium">{data.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {data.condition === ''
              ? data.summary
              : $t('si {condition}', { condition: data.condition })}
          </span>
        </span>
      </button>
    </div>
  )
}

function RunMark({ run }: { readonly run: RunStepRecord }) {
  // A wait passed holds the run until it goes on: an hourglass, not a tick.
  const waits = run.kind === 'wait' && run.status === 'succeeded'
  const Icon = waits
    ? Hourglass
    : run.status === 'succeeded'
      ? CircleCheck
      : run.status === 'failed'
        ? CircleX
        : CircleSlash
  return (
    <Hint label={stepRecordText(run)}>
      <span
        className={cn(
          'flex items-center gap-1 text-[11px]',
          waits
            ? 'text-sky-600 dark:text-sky-400'
            : run.status === 'succeeded'
              ? 'text-emerald-600 dark:text-emerald-400'
              : run.status === 'failed'
                ? 'text-destructive'
                : 'text-muted-foreground',
        )}
      >
        <Icon className="size-4" />
        {run.ms !== undefined && (
          <span className="tabular-nums">{$t('{ms} ms', { ms: run.ms })}</span>
        )}
      </span>
    </Hint>
  )
}

function StepCard({ id, data }: NodeProps<StepNode>) {
  const { select } = useContext(Actions)
  const Icon = STEP_ICONS[data.step.kind]
  return (
    <div style={{ width: data.width, height: data.height }}>
      <Ports />
      <button
        type="button"
        onClick={() => select(id)}
        className={cn(
          cardClass(data.selected, data.dimmed),
          data.run?.status === 'failed' && 'border-destructive/60',
        )}
        style={{ height: data.height }}
      >
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            STEP_TONES[data.step.kind],
          )}
        >
          <Icon className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{$t(STEP_LABELS[data.step.kind])}</span>
            {data.problem !== null && data.run === null && (
              <TriangleAlert
                className="size-3.5 shrink-0 text-amber-500"
                aria-label={data.problem}
              />
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {data.run === null ? (data.problem ?? data.summary) : stepRecordText(data.run)}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1 self-stretch py-2">
          <span className="font-mono text-[10px] text-muted-foreground/80">{data.step.id}</span>
          {data.run !== null && <RunMark run={data.run} />}
        </span>
      </button>
    </div>
  )
}

function PathChip({ id, data }: NodeProps<PathNode>) {
  const { select } = useContext(Actions)
  return (
    <div style={{ width: data.width, height: data.height }} className="flex justify-center">
      <Ports />
      <Hint label={data.summary || $t('Toujours')}>
        <button
          type="button"
          onClick={() => select(id)}
          className={cn(
            'flex h-full max-w-full items-center gap-1.5 rounded-full border bg-card px-3 text-xs shadow-xs transition-[opacity,border-color]',
            'hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            data.path.otherwise && 'border-dashed',
            data.taken && 'border-primary text-primary',
            data.selected && 'border-primary ring-2 ring-primary/25',
            data.dimmed && 'opacity-40',
          )}
        >
          <span className="shrink-0 font-medium">{data.path.label || $t('Chemin')}</span>
          {!data.path.otherwise && data.summary !== '' && (
            <span className="truncate text-[11px] text-muted-foreground">{data.summary}</span>
          )}
        </button>
      </Hint>
    </div>
  )
}

function MergeDot({ data }: NodeProps<BareNode>) {
  return (
    <div
      style={{ width: data.width, height: data.height }}
      className={cn('rounded-full bg-border', data.dimmed && 'opacity-40')}
    >
      <Ports />
    </div>
  )
}

function EndButton({ data }: NodeProps<BareNode>) {
  const { pick } = useContext(Actions)
  return (
    <div style={{ width: data.width, height: data.height }} className="flex justify-center">
      <Ports />
      <Button
        variant="outline"
        size="sm"
        onClick={() => pick({ path: null, index: data.append ?? 0 })}
        className={cn(
          'nodrag h-9 gap-1.5 rounded-full bg-card shadow-xs',
          data.dimmed && 'opacity-40',
        )}
      >
        <Plus className="size-4" />
        {$t('Ajouter une étape')}
      </Button>
    </div>
  )
}

const NODE_TYPES = {
  trigger: TriggerCard,
  step: StepCard,
  path: PathChip,
  merge: MergeDot,
  end: EndButton,
}

// ── Edges ───────────────────────────────────────────────────────────────────

interface LinkData extends Record<string, unknown> {
  readonly insert: Slot | null
  readonly bend: FlowEdge['bend']
  readonly taken: boolean
  readonly dimmed: boolean
}

type LinkEdge = Edge<LinkData, 'link'>

function Link({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<LinkEdge>) {
  const { pick } = useContext(Actions)
  const centerY =
    data?.bend === 'source'
      ? sourceY + GAP_Y / 2
      : data?.bend === 'target'
        ? targetY - GAP_Y / 2
        : undefined
  // The « + » sits on the stretch that leaves the source: halfway down it, before a turn.
  const plusY = data?.bend === 'target' ? (sourceY + targetY - GAP_Y / 2) / 2 : sourceY + GAP_Y / 2
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
    ...(centerY === undefined ? {} : { centerY }),
  })
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={cn(
          'automation-flow__link',
          data?.taken && 'automation-flow__link--taken',
          data?.dimmed && 'opacity-40',
        )}
      />
      {data?.insert !== null && data?.insert !== undefined && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${sourceX}px, ${plusY}px)`,
              pointerEvents: 'all',
            }}
          >
            <Hint label={$t('Ajouter une étape ici')}>
              <button
                type="button"
                aria-label={$t('Ajouter une étape ici')}
                onClick={() => data.insert !== null && pick(data.insert)}
                className="flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-3" />
              </button>
            </Hint>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const EDGE_TYPES = { link: Link }

// ── The canvas ──────────────────────────────────────────────────────────────

export interface FlowCanvasProps {
  readonly draft: Draft
  readonly choices: AutomationChoices | null
  readonly selected: string
  readonly onSelect: (id: string) => void
  readonly onPick: (slot: Slot) => void
  /** The run laid over the flow, if any. */
  readonly run: AutomationRun | null
  /** A piece to bring into view — a step just added. */
  readonly focus: string | null
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

function Canvas({ draft, choices, selected, onSelect, onPick, run, focus }: FlowCanvasProps) {
  const theme = useTheme((s) => s.theme)
  const flow = useReactFlow()
  const layout = useMemo(() => layoutFlow(draft.steps), [draft.steps])

  // What a run laid over the flow reached: the steps it passed, the paths it took.
  const overlay = useMemo(() => {
    if (run === null) return null
    const steps = new Map(run.steps.map((r) => [r.id, r]))
    const reached = new Set<string>([TRIGGER_NODE, ...steps.keys()])
    for (const [id, record] of steps) {
      if (record.kind !== 'branch') continue
      reached.add(mergeOf(id))
      if (record.path) reached.add(record.path)
    }
    if (run.status === 'succeeded') reached.add(END_NODE)
    return { steps, reached }
  }, [run])

  const nodes = useMemo((): Node[] => {
    const steps = new Map(allSteps(draft.steps).map((s) => [s.id, s]))
    const dimmed = (id: string) => overlay !== null && !overlay.reached.has(id)
    return layout.nodes.map((n: FlowNode): Node => {
      const common = { id: n.id, position: { x: n.x, y: n.y }, draggable: false, selectable: false }
      const card = { width: n.w, height: n.h, selected: selected === n.id, dimmed: dimmed(n.id) }
      switch (n.kind) {
        case 'trigger':
          return {
            ...common,
            type: 'trigger',
            data: {
              ...card,
              title: $t(TRIGGER_LABELS[draft.trigger.kind]),
              summary: triggerSummary(draft.trigger),
              condition: conditionText(draft.condition, choices),
              icon: TRIGGER_ICONS[draft.trigger.kind],
            } satisfies TriggerData,
          }
        case 'step': {
          const step = steps.get(n.id) as AutomationStep
          const problem = stepProblem(step, draft)
          return {
            ...common,
            type: 'step',
            data: {
              ...card,
              step,
              summary: stepSummary(step, choices),
              problem: problem === null ? null : problemText(problem),
              run: overlay?.steps.get(n.id) ?? null,
            } satisfies StepData,
          }
        }
        case 'path': {
          const found = findPath(draft.steps, n.id)
          const path = found?.path as BranchPath
          return {
            ...common,
            type: 'path',
            data: {
              ...card,
              path,
              summary: path.otherwise ? '' : conditionText(path.condition, choices),
              taken: overlay?.reached.has(n.id) ?? false,
            } satisfies PathData,
          }
        }
        default:
          // The button at the end adds after the last step of the first level.
          return { ...common, type: n.kind, data: { ...card, append: draft.steps.length } }
      }
    })
  }, [layout, draft, choices, selected, overlay])

  const edges = useMemo(
    (): LinkEdge[] =>
      layout.edges.map((e) => {
        const taken = overlay?.reached.has(e.source) === true && overlay.reached.has(e.target)
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'link',
          selectable: false,
          focusable: false,
          data: {
            // Over a run, the flow is read, not edited.
            insert: overlay === null ? e.insert : null,
            bend: e.bend,
            taken,
            dimmed: overlay !== null && !taken,
          },
        }
      }),
    [layout, overlay],
  )

  // A step just added comes into view, at the zoom the person chose.
  useEffect(() => {
    if (focus === null) return
    const node = layout.nodes.find((n) => n.id === focus)
    if (node === undefined) return
    const timer = setTimeout(() => {
      void flow.setCenter(node.x + node.w / 2, node.y + node.h / 2, {
        zoom: flow.getZoom(),
        duration: 250,
      })
    }, 30)
    return () => clearTimeout(timer)
  }, [focus, layout, flow])

  const actions = useMemo(() => ({ select: onSelect, pick: onPick }), [onSelect, onPick])

  return (
    <Actions.Provider value={actions}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        minZoom={0.3}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ maxZoom: 1, minZoom: 0.6, padding: 0.12 }}
        colorMode={theme}
        className="automation-flow"
        aria-label={$t('Le flux de l’automatisation')}
      >
        <Background gap={20} size={1.2} />
        <Panel position="bottom-left" className="flex gap-1">
          <Hint label={$t('Zoom avant')}>
            <Button
              variant="outline"
              size="icon-sm"
              className="bg-card"
              aria-label={$t('Zoom avant')}
              onClick={() => void flow.zoomIn({ duration: 150 })}
            >
              <ZoomIn className="size-4" />
            </Button>
          </Hint>
          <Hint label={$t('Zoom arrière')}>
            <Button
              variant="outline"
              size="icon-sm"
              className="bg-card"
              aria-label={$t('Zoom arrière')}
              onClick={() => void flow.zoomOut({ duration: 150 })}
            >
              <ZoomOut className="size-4" />
            </Button>
          </Hint>
          <Hint label={$t('Tout voir')}>
            <Button
              variant="outline"
              size="icon-sm"
              className="bg-card"
              aria-label={$t('Tout voir')}
              onClick={() => void flow.fitView({ maxZoom: 1, padding: 0.12, duration: 200 })}
            >
              <Maximize className="size-4" />
            </Button>
          </Hint>
        </Panel>
      </ReactFlow>
    </Actions.Provider>
  )
}
