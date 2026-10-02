import type { AutomationStep, BranchPath } from '@chat/contracts'

/**
 * Where each piece of a flow sits on the canvas — basedb's layout, by arithmetic: the
 * trigger on top, each step below it, a condition opening its paths side by side and
 * having them meet again below it. A tree needs no general graph layout.
 */

type Branch = Extract<AutomationStep, { kind: 'branch' }>

export const STEP_SIZE = { w: 280, h: 68 } as const
export const PATH_SIZE = { w: 200, h: 34 } as const
export const END_SIZE = { w: 200, h: 36 } as const
export const MERGE_SIZE = 10
/** Between two pieces stacked: room for the edge and its « + ». */
export const GAP_Y = 56
/** Between two paths side by side. */
export const GAP_X = 36
/** Above the point where paths meet: room for each path's « + » before its edge turns. */
export const MERGE_GAP = GAP_Y + 24

export const TRIGGER_NODE = '__trigger'
export const END_NODE = '__end'
export const mergeOf = (branch: string) => `${branch}__merge`

export type FlowNodeKind = 'trigger' | 'step' | 'path' | 'merge' | 'end'

export interface FlowNode {
  readonly id: string
  readonly kind: FlowNodeKind
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Where a step inserted by an edge's « + » goes: a sequence — the root, a path — and a place. */
export interface Slot {
  readonly path: string | null
  readonly index: number
}

export interface FlowEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly insert: Slot | null
  /** Where the edge turns: just below its source (a branch opening), just above its target (paths meeting). */
  readonly bend: 'source' | 'target' | null
}

interface Size {
  readonly w: number
  readonly h: number
}

function sequenceSize(steps: readonly AutomationStep[]): Size {
  if (steps.length === 0) return { w: 0, h: 0 }
  const sizes = steps.map(blockSize)
  return {
    w: Math.max(...sizes.map((s) => s.w)),
    h: sizes.reduce((n, s) => n + s.h, 0) + GAP_Y * (steps.length - 1),
  }
}

function columnSize(path: BranchPath): Size {
  const steps = sequenceSize(path.steps)
  return {
    w: Math.max(PATH_SIZE.w, steps.w),
    h: PATH_SIZE.h + (steps.h === 0 ? 0 : GAP_Y + steps.h),
  }
}

function blockSize(step: AutomationStep): Size {
  if (step.kind !== 'branch') return STEP_SIZE
  const columns = step.paths.map(columnSize)
  return {
    w: Math.max(STEP_SIZE.w, columns.reduce((n, c) => n + c.w, 0) + GAP_X * (columns.length - 1)),
    h: STEP_SIZE.h + GAP_Y + Math.max(0, ...columns.map((c) => c.h)) + MERGE_GAP + MERGE_SIZE,
  }
}

interface Out {
  readonly nodes: FlowNode[]
  readonly edges: FlowEdge[]
}

const edge = (
  source: string,
  target: string,
  insert: Slot | null,
  bend: FlowEdge['bend'] = null,
): FlowEdge => ({ id: `${source}->${target}`, source, target, insert, bend })

/** A sequence down from `top`, centred on `cx`, hanging from `from`; returns its last piece. */
function placeSequence(
  steps: readonly AutomationStep[],
  path: string | null,
  cx: number,
  top: number,
  from: string,
  out: Out,
): string {
  let previous = from
  let y = top
  steps.forEach((step, index) => {
    out.edges.push(edge(previous, step.id, { path, index }))
    previous = placeBlock(step, cx, y, out)
    y += blockSize(step).h + GAP_Y
  })
  return previous
}

/** A step — or a branch, its paths and where they meet; returns the piece to go on from. */
function placeBlock(step: AutomationStep, cx: number, y: number, out: Out): string {
  out.nodes.push({ id: step.id, kind: 'step', x: cx - STEP_SIZE.w / 2, y, ...STEP_SIZE })
  if (step.kind !== 'branch') return step.id
  return placePaths(step, cx, y, out)
}

function placePaths(step: Branch, cx: number, y: number, out: Out): string {
  const columns = step.paths.map(columnSize)
  const width = columns.reduce((n, c) => n + c.w, 0) + GAP_X * (columns.length - 1)
  const top = y + STEP_SIZE.h + GAP_Y
  const merge = mergeOf(step.id)
  let left = cx - width / 2
  step.paths.forEach((path, i) => {
    const column = columns[i] as Size
    const center = left + column.w / 2
    out.nodes.push({ id: path.id, kind: 'path', x: center - PATH_SIZE.w / 2, y: top, ...PATH_SIZE })
    out.edges.push(edge(step.id, path.id, null, 'source'))
    const last = placeSequence(path.steps, path.id, center, top + PATH_SIZE.h + GAP_Y, path.id, out)
    out.edges.push(edge(last, merge, { path: path.id, index: path.steps.length }, 'target'))
    left += column.w + GAP_X
  })
  const bottom = top + Math.max(0, ...columns.map((c) => c.h)) + MERGE_GAP
  out.nodes.push({
    id: merge,
    kind: 'merge',
    x: cx - MERGE_SIZE / 2,
    y: bottom,
    w: MERGE_SIZE,
    h: MERGE_SIZE,
  })
  return merge
}

/** The whole flow: the trigger on top, its steps below, the button that adds one at the end. */
export function layoutFlow(steps: readonly AutomationStep[]): Out {
  const out: Out = { nodes: [], edges: [] }
  out.nodes.push({ id: TRIGGER_NODE, kind: 'trigger', x: -STEP_SIZE.w / 2, y: 0, ...STEP_SIZE })
  const top = STEP_SIZE.h + GAP_Y
  const last = placeSequence(steps, null, 0, top, TRIGGER_NODE, out)
  const height = sequenceSize(steps).h
  out.nodes.push({
    id: END_NODE,
    kind: 'end',
    x: -END_SIZE.w / 2,
    y: top + (height === 0 ? 0 : height + GAP_Y),
    ...END_SIZE,
  })
  out.edges.push(edge(last, END_NODE, null))
  return out
}
