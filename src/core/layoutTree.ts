import type { PdfSplitLayoutId } from './pdfSplit'

/**
 * 칸 나누기 트리(docs/design/workspace-tmux.md 4). 정해진 배치(PdfSplitLayoutId)와 고정된 칸 이름 대신,
 * 칸(pane)을 잎으로 하고 나누기(split)를 마디로 하는 이진 트리다. DOM·React 를 모르는 순수 함수만 둔다.
 *
 * - dir 'h' 는 좌우로 나눈다(a 가 왼쪽, b 가 오른쪽), 'v' 는 위아래로 나눈다(a 가 위, b 가 아래). tmux 의 split-window -h / -v 와 같다.
 * - ratio 는 a 가 차지하는 몫(0–1)이다.
 * - 칸 번호(0, 1, 2 …)는 저장하지 않고, 트리를 왼쪽 위부터 차례로 센 값(leaves 의 차례)이다.
 */
export type SplitDir = 'h' | 'v'

export interface PaneNode {
  readonly kind: 'pane'
  readonly paneId: string
}

export interface SplitNode {
  readonly kind: 'split'
  readonly id: string
  readonly dir: SplitDir
  readonly ratio: number
  readonly a: LayoutNode
  readonly b: LayoutNode
}

export type LayoutNode = PaneNode | SplitNode

/** 한 화면의 칸 상한 */
export const MAX_PANES = 8
/** 칸 최소 크기(px). 나눌 때 이보다 작아지면 막는다 */
export const MIN_PANE_WIDTH = 240
export const MIN_PANE_HEIGHT = 160

/** 칸을 나눌 수 없는 까닭: 칸이 이미 상한이다 / 나누면 칸이 너무 작아진다 */
export type SplitRefusal = 'max' | 'small'

export const paneNode = (paneId: string): PaneNode => ({ kind: 'pane', paneId })

export const isPane = (node: LayoutNode): node is PaneNode => node.kind === 'pane'

/** 칸 id 들(왼쪽 위부터 차례로). 칸 번호는 이 차례의 index */
export function leaves(node: LayoutNode): string[] {
  const out: string[] = []
  const walk = (current: LayoutNode) => {
    if (current.kind === 'pane') out.push(current.paneId)
    else { walk(current.a); walk(current.b) }
  }
  walk(node)
  return out
}

export function paneCount(node: LayoutNode): number {
  return node.kind === 'pane' ? 1 : paneCount(node.a) + paneCount(node.b)
}

export function hasPane(node: LayoutNode, paneId: string): boolean {
  return node.kind === 'pane' ? node.paneId === paneId : hasPane(node.a, paneId) || hasPane(node.b, paneId)
}

/** 칸 번호 → 칸 id. 범위 밖이면 null */
export function paneAtIndex(node: LayoutNode, index: number): string | null {
  return leaves(node)[index] ?? null
}

/** 칸 id → 칸 번호. 없으면 -1 */
export function indexOfPane(node: LayoutNode, paneId: string): number {
  return leaves(node).indexOf(paneId)
}

/** id(칸 id 또는 나누기 id)가 가리키는 마디 */
export function findNode(root: LayoutNode, id: string): LayoutNode | null {
  if (root.kind === 'pane') return root.paneId === id ? root : null
  if (root.id === id) return root
  return findNode(root.a, id) ?? findNode(root.b, id)
}

/** id 마디의 부모와 그 안의 자리. 뿌리거나 없으면 null */
export function findParent(root: LayoutNode, id: string): { readonly parent: SplitNode; readonly side: 'a' | 'b' } | null {
  if (root.kind === 'pane') return null
  const matches = (node: LayoutNode) => (node.kind === 'pane' ? node.paneId === id : node.id === id)
  if (matches(root.a)) return { parent: root, side: 'a' }
  if (matches(root.b)) return { parent: root, side: 'b' }
  return findParent(root.a, id) ?? findParent(root.b, id)
}

/** id 마디를 next 로 바꾼 새 트리. id 가 없으면 같은 객체 */
export function replaceNode(root: LayoutNode, id: string, next: LayoutNode): LayoutNode {
  if (root.kind === 'pane') return root.paneId === id ? next : root
  if (root.id === id) return next
  const a = replaceNode(root.a, id, next)
  const b = replaceNode(root.b, id, next)
  return a === root.a && b === root.b ? root : { ...root, a, b }
}

/**
 * 칸 하나를 뺀다: 그 형제가 부모의 자리를 차지한다. 하나뿐인 칸이거나 없는 칸이면 null.
 */
export function removeLeaf(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.kind === 'pane' || !hasPane(root, paneId)) return null
  const found = findParent(root, paneId)
  if (found === null) return null
  const sibling = found.side === 'a' ? found.parent.b : found.parent.a
  return replaceNode(root, found.parent.id, sibling)
}

let splitSequence = 0

/** 트리에서 안 쓰는 나누기 id */
export function newSplitId(root: LayoutNode | null): string {
  const used = new Set<string>()
  const walk = (node: LayoutNode) => {
    if (node.kind === 'split') { used.add(node.id); walk(node.a); walk(node.b) }
  }
  if (root !== null) walk(root)
  let id: string
  do { splitSequence += 1; id = `s${splitSequence}` } while (used.has(id))
  return id
}

let paneSequence = 0

/**
 * 새 칸 id. 이번 실행에서 한 번도 쓰지 않았고 used 에도 없는 값이다 —
 * 닫힌 칸의 id 가 다시 나오면 그 칸의 보기 상태(docViews 등)가 새 칸에 묻어 오므로 늘 새 번호를 쓴다.
 */
export function newPaneId(used: Iterable<string> = []): string {
  const taken = new Set(used)
  let id: string
  do { paneSequence += 1; id = `p${paneSequence}` } while (taken.has(id))
  return id
}

export interface SplitOptions {
  /** 새 칸을 앞(왼쪽·위)에 둔다. 기본은 뒤(오른쪽·아래) */
  readonly before?: boolean
  /** 앞쪽(a) 몫. 기본 0.5 */
  readonly ratio?: number
  /** 새 나누기 id(시험에서 정한다) */
  readonly splitId?: string
}

/** 칸 하나를 나눈다: 그 자리에 나누기 마디가 들어서고 새 칸이 옆에 놓인다. 없는 칸이면 같은 객체 */
export function splitLeaf(root: LayoutNode, paneId: string, dir: SplitDir, newPane: string, options: SplitOptions = {}): LayoutNode {
  if (!hasPane(root, paneId)) return root
  const old = paneNode(paneId)
  const fresh = paneNode(newPane)
  const before = options.before === true
  const split: SplitNode = {
    kind: 'split',
    id: options.splitId ?? newSplitId(root),
    dir,
    ratio: clampRatio(options.ratio ?? 0.5),
    a: before ? fresh : old,
    b: before ? old : fresh,
  }
  return replaceNode(root, paneId, split)
}

/** 비율을 0.05–0.95 안에 둔다 */
export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5
  return Math.min(Math.max(ratio, 0.05), 0.95)
}

/** 나누기 하나의 비율을 바꾼 새 트리 */
export function setRatio(root: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (root.kind === 'pane') return root
  if (root.id === splitId) {
    const next = clampRatio(ratio)
    return next === root.ratio ? root : { ...root, ratio: next }
  }
  const a = setRatio(root.a, splitId, ratio)
  const b = setRatio(root.b, splitId, ratio)
  return a === root.a && b === root.b ? root : { ...root, a, b }
}

/** 여러 나누기의 비율을 한 번에(끌기 중의 임시 값을 확정할 때) */
export function applyRatios(root: LayoutNode, ratios: Readonly<Record<string, number>>): LayoutNode {
  if (root.kind === 'pane') return root
  const a = applyRatios(root.a, ratios)
  const b = applyRatios(root.b, ratios)
  const ratio = ratios[root.id] === undefined ? root.ratio : clampRatio(ratios[root.id]!)
  return ratio === root.ratio && a === root.a && b === root.b ? root : { ...root, ratio, a, b }
}

/** 두 칸의 자리를 맞바꾼다(칸 내용·색은 칸 id 에 붙어 있어 따라간다). 없는 칸이 있으면 같은 객체 */
export function swapLeaves(root: LayoutNode, a: string, b: string): LayoutNode {
  if (a === b || !hasPane(root, a) || !hasPane(root, b)) return root
  const map = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'pane') return node.paneId === a ? paneNode(b) : node.paneId === b ? paneNode(a) : node
    return { ...node, a: map(node.a), b: map(node.b) }
  }
  return map(root)
}

/** 나누기 하나의 두 쪽(a·b)을 맞바꾼다(칸막이 「양쪽 바꾸기」). 비율은 뒤집는다 */
export function swapChildren(root: LayoutNode, splitId: string): LayoutNode {
  if (root.kind === 'pane') return root
  if (root.id === splitId) return { ...root, ratio: clampRatio(1 - root.ratio), a: root.b, b: root.a }
  const a = swapChildren(root.a, splitId)
  const b = swapChildren(root.b, splitId)
  return a === root.a && b === root.b ? root : { ...root, a, b }
}

/** 칸 id 를 바꾼다(없으면 같은 객체) */
export function renamePane(root: LayoutNode, from: string, to: string): LayoutNode {
  if (root.kind === 'pane') return root.paneId === from ? paneNode(to) : root
  const a = renamePane(root.a, from, to)
  const b = renamePane(root.b, from, to)
  return a === root.a && b === root.b ? root : { ...root, a, b }
}

// ── select-layout ──────────────────────────────────────────────────────────────

export type RelayoutKind = 'even-horizontal' | 'even-vertical' | 'main-vertical' | 'main-horizontal' | 'tiled'

export const RELAYOUT_KINDS: readonly RelayoutKind[] = ['even-horizontal', 'even-vertical', 'main-vertical', 'main-horizontal', 'tiled']

/** main-vertical·main-horizontal 에서 큰 칸이 차지하는 몫 */
export const MAIN_RATIO = 0.6

/** ids 를 dir 방향으로 한 줄로 늘어놓는다(같은 몫). 오른쪽으로 기우는 사슬 */
function chain(dir: SplitDir, ids: readonly string[], nextId: () => string): LayoutNode {
  if (ids.length === 1) return paneNode(ids[0]!)
  return { kind: 'split', id: nextId(), dir, ratio: 1 / ids.length, a: paneNode(ids[0]!), b: chain(dir, ids.slice(1), nextId) }
}

/**
 * select-layout: 칸 차례를 지키며 트리를 다시 짠다. 나누기 id 는 s1, s2 … 로 새로 붙는다.
 * - even-horizontal: 좌우로 같은 폭, even-vertical: 위아래로 같은 높이
 * - main-vertical: 첫 칸이 왼쪽에 크게(MAIN_RATIO), 나머지는 오른쪽에 위아래로
 * - main-horizontal: 첫 칸이 위에 크게, 나머지는 아래에 좌우로
 * - tiled: 격자(열 = 올림(√n), 줄은 위에서 채운다)
 */
export function relayout(root: LayoutNode, kind: RelayoutKind): LayoutNode {
  const ids = leaves(root)
  let counter = 0
  const nextId = () => { counter += 1; return `s${counter}` }
  if (ids.length <= 1) return root
  switch (kind) {
    case 'even-horizontal':
      return chain('h', ids, nextId)
    case 'even-vertical':
      return chain('v', ids, nextId)
    case 'main-vertical':
      return { kind: 'split', id: nextId(), dir: 'h', ratio: MAIN_RATIO, a: paneNode(ids[0]!), b: chain('v', ids.slice(1), nextId) }
    case 'main-horizontal':
      return { kind: 'split', id: nextId(), dir: 'v', ratio: MAIN_RATIO, a: paneNode(ids[0]!), b: chain('h', ids.slice(1), nextId) }
    case 'tiled': {
      const cols = Math.ceil(Math.sqrt(ids.length))
      const rows: string[][] = []
      for (let index = 0; index < ids.length; index += cols) rows.push(ids.slice(index, index + cols))
      const build = (remaining: readonly (readonly string[])[]): LayoutNode => {
        if (remaining.length === 1) return chain('h', remaining[0]!, nextId)
        return { kind: 'split', id: nextId(), dir: 'v', ratio: 1 / remaining.length, a: chain('h', remaining[0]!, nextId), b: build(remaining.slice(1)) }
      }
      return build(rows)
    }
  }
}

/** 저장된 값·명령줄에서 온 이름. 모르면 null */
export function parseRelayoutKind(value: unknown): RelayoutKind | null {
  return RELAYOUT_KINDS.find((kind) => kind === value) ?? null
}

// ── 크기 ───────────────────────────────────────────────────────────────────────

export interface Size {
  readonly width: number
  readonly height: number
}

/** 이 마디가 최소한 필요로 하는 크기(px): 칸마다 MIN_PANE_WIDTH × MIN_PANE_HEIGHT */
export function minSize(node: LayoutNode): Size {
  if (node.kind === 'pane') return { width: MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT }
  const a = minSize(node.a)
  const b = minSize(node.b)
  return node.dir === 'h'
    ? { width: a.width + b.width, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height }
}

/**
 * paneId 칸을 dir 로 나눌 수 있는가. size 는 그 칸의 지금 크기(px) — 모르면(재지 못함) 크기는 따지지 않는다.
 * 'max': 칸이 상한(MAX_PANES)이다. 'small': 나누면 새 칸·옛 칸이 최소 크기(240×160)보다 작아진다.
 */
export function splitRefusal(root: LayoutNode, paneId: string, dir: SplitDir, size?: Size | null): SplitRefusal | null {
  if (!hasPane(root, paneId)) return null
  if (paneCount(root) >= MAX_PANES) return 'max'
  if (size === undefined || size === null || size.width <= 0 || size.height <= 0) return null
  return dir === 'h'
    ? (size.width / 2 < MIN_PANE_WIDTH ? 'small' : null)
    : (size.height / 2 < MIN_PANE_HEIGHT ? 'small' : null)
}

/** 끌기: 나누기 하나의 비율을 두 쪽이 최소 크기를 지키는 범위로 가둔다. total 은 그 나누기가 차지한 길이(px, dir 방향) */
export function clampRatioForSize(node: SplitNode, ratio: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return clampRatio(ratio)
  const need = (child: LayoutNode) => (node.dir === 'h' ? minSize(child).width : minSize(child).height)
  const low = need(node.a) / total
  const high = 1 - need(node.b) / total
  // 자리가 모자라면(최소 크기를 다 지킬 수 없다) 가운데 근처로만 가둔다
  if (low >= high) return clampRatio(Math.min(Math.max(ratio, 0.2), 0.8))
  return clampRatio(Math.min(Math.max(ratio, low), high))
}

// ── 그리기용 사각형 ───────────────────────────────────────────────────────────

/** 작업 영역(0–1)에서 한 마디가 차지하는 사각형 */
export interface UnitRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface SplitRect extends UnitRect {
  readonly id: string
  readonly dir: SplitDir
  readonly ratio: number
  readonly node: SplitNode
}

/** 칸마다 사각형, 나누기마다 사각형(경계선을 그린다) */
export function layoutRects(root: LayoutNode): { readonly panes: ReadonlyMap<string, UnitRect>; readonly splits: readonly SplitRect[] } {
  const panes = new Map<string, UnitRect>()
  const splits: SplitRect[] = []
  const walk = (node: LayoutNode, rect: UnitRect) => {
    if (node.kind === 'pane') { panes.set(node.paneId, rect); return }
    splits.push({ ...rect, id: node.id, dir: node.dir, ratio: node.ratio, node })
    if (node.dir === 'h') {
      walk(node.a, { x: rect.x, y: rect.y, w: rect.w * node.ratio, h: rect.h })
      walk(node.b, { x: rect.x + rect.w * node.ratio, y: rect.y, w: rect.w * (1 - node.ratio), h: rect.h })
    } else {
      walk(node.a, { x: rect.x, y: rect.y, w: rect.w, h: rect.h * node.ratio })
      walk(node.b, { x: rect.x, y: rect.y + rect.h * node.ratio, w: rect.w, h: rect.h * (1 - node.ratio) })
    }
  }
  walk(root, { x: 0, y: 0, w: 1, h: 1 })
  return { panes, splits }
}

// ── 예전 배치(10가지)와의 대응 ────────────────────────────────────────────────

/**
 * 예전 정해진 배치를 같은 모양의 트리로 만든다. ids 는 칸 차례(예전 left → right → third → fourth)대로의 새 칸 id 들이고,
 * leftFrac 은 좌우 둘일 때 왼쪽 몫(예전 세션의 leftFrac).
 */
export function layoutForLegacyId(id: PdfSplitLayoutId, ids: readonly string[], leftFrac = 0.5): LayoutNode {
  const p = (index: number) => paneNode(ids[index] ?? ids[ids.length - 1]!)
  let counter = 0
  const split = (dir: SplitDir, ratio: number, a: LayoutNode, b: LayoutNode): SplitNode => { counter += 1; return { kind: 'split', id: `s${counter}`, dir, ratio, a, b } }
  switch (id) {
    case 'single': return p(0)
    case 'cols2': return split('h', clampRatio(leftFrac), p(0), p(1))
    case 'rows2': return split('v', 0.5, p(0), p(1))
    case 'cols3': return split('h', 1 / 3, p(0), split('h', 0.5, p(1), p(2)))
    case 'top2-bottom1': return split('v', 0.5, split('h', 0.5, p(0), p(1)), p(2))
    case 'top1-bottom2': return split('v', 0.5, p(0), split('h', 0.5, p(1), p(2)))
    case 'left1-right2': return split('h', 0.5, p(0), split('v', 0.5, p(1), p(2)))
    case 'left2-right1': return split('h', 0.5, split('v', 0.5, p(0), p(1)), p(2))
    case 'grid4': return split('v', 0.5, split('h', 0.5, p(0), p(1)), split('h', 0.5, p(2), p(3)))
    default: return p(0)
  }
}

/** 그 배치가 가진 칸 수 */
export function legacyPaneCount(id: PdfSplitLayoutId): number {
  switch (id) {
    case 'single': return 1
    case 'cols2': case 'rows2': return 2
    case 'cols3': case 'top2-bottom1': case 'top1-bottom2': case 'left1-right2': case 'left2-right1': return 3
    case 'grid4': return 4
    default: return 1
  }
}

/** 마디의 모양(비율·id 를 빼고 나누기 방향만) */
export function shapeOf(node: LayoutNode): string {
  return node.kind === 'pane' ? 'P' : `${node.dir}(${shapeOf(node.a)},${shapeOf(node.b)})`
}

const LEGACY_IDS: readonly PdfSplitLayoutId[] = ['single', 'cols2', 'rows2', 'cols3', 'top2-bottom1', 'top1-bottom2', 'left1-right2', 'left2-right1', 'grid4']

/** 이 트리가 예전 배치 중 하나와 같은 모양인가(칸 차례·방향만 본다). 아니면 null(내 손으로 짠 배치) */
export function matchLegacyLayout(root: LayoutNode): PdfSplitLayoutId | null {
  const shape = shapeOf(root)
  return LEGACY_IDS.find((id) => shapeOf(layoutForLegacyId(id, ['a', 'b', 'c', 'd'])) === shape) ?? null
}

/** 칸 수만 정해서 한 줄로: 1 한 칸, 그 밖에는 좌우 같은 폭. 예전 setPaneCount 와 같은 모양(4 는 2×2) */
export function layoutForCount(count: number, ids: readonly string[]): LayoutNode {
  if (count <= 1) return paneNode(ids[0]!)
  if (count === 2) return layoutForLegacyId('cols2', ids)
  if (count === 3) return layoutForLegacyId('cols3', ids)
  if (count === 4) return layoutForLegacyId('grid4', ids)
  return chain('h', ids.slice(0, count), (() => { let n = 0; return () => { n += 1; return `s${n}` } })())
}

// ── 저장 ───────────────────────────────────────────────────────────────────────

/** 저장된 값에서 트리를 읽는다. 모양이 틀리면 null. 칸 id 가 겹치거나 깊이가 지나치면 틀린 것으로 본다 */
export function parseLayoutTree(raw: unknown): LayoutNode | null {
  const seen = new Set<string>()
  const seenSplits = new Set<string>()
  const read = (value: unknown, depth: number): LayoutNode | null => {
    if (depth > MAX_PANES + 1 || typeof value !== 'object' || value === null) return null
    const record = value as Record<string, unknown>
    if (record.kind === 'pane') {
      if (typeof record.paneId !== 'string' || record.paneId === '' || seen.has(record.paneId)) return null
      seen.add(record.paneId)
      return paneNode(record.paneId)
    }
    if (record.kind !== 'split') return null
    if ((record.dir !== 'h' && record.dir !== 'v') || typeof record.id !== 'string' || seenSplits.has(record.id)) return null
    if (typeof record.ratio !== 'number' || !Number.isFinite(record.ratio)) return null
    seenSplits.add(record.id)
    const a = read(record.a, depth + 1)
    const b = read(record.b, depth + 1)
    if (a === null || b === null) return null
    return { kind: 'split', id: record.id, dir: record.dir, ratio: clampRatio(record.ratio), a, b }
  }
  const root = read(raw, 0)
  return root === null || paneCount(root) > MAX_PANES ? null : root
}
