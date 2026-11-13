/**
 * 바깥 AI(MCP canvas_* 도구)가 캔버스 문서를 읽고 고치는 순수 함수들.
 *
 * 입력은 도구 인자 그대로(snake_case)다. PDF 발췌·그림처럼 파일을 읽어야 하는 블록은 부르는 쪽이
 * 미리 `excerpt`/`image` 로 풀어 넘긴다. 결과 문서는 항상 `parseCanvasDocument` 를 통과시켜,
 * 앱이 읽지 못하는 캔버스를 만들지 않는다.
 */
import {
  createDefaultTextBlockStyle,
  isCanvasShapeKind,
  normalizeCanvasBlockSize,
  normalizeCanvasNodePosition,
  parseCanvasDocument,
  type CanvasBlockData,
  type CanvasDocumentV2,
  type PersistedCanvasEdge,
  type PersistedCanvasNode,
  type TextBlockLevel,
  type TextBlockStyle,
} from './canvasDocument'
import { createPdfExcerptBlock, type PdfExcerptCrop, type PdfExcerptSelection } from './pdfExcerpt'
import type { PageTextIndex } from './textIndex'
import { t } from '../i18n'

export interface CanvasOpStyleInput {
  readonly background?: string
  readonly border_color?: string
  readonly border_width?: number
  readonly color?: string
  readonly bold?: boolean
  readonly font_size?: number
  readonly list?: 'none' | 'bullet' | 'number'
}

export interface CanvasBlockInput extends CanvasOpStyleInput {
  readonly type: 'title' | 'heading' | 'text' | 'code' | 'pdf_excerpt' | 'rectangle' | 'ellipse' | 'image'
  readonly ref?: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly text?: string
  readonly level?: 'h1' | 'h2' | 'h3' | 'h4'
  readonly doc_id?: string
  readonly page?: number
  readonly rect?: PdfExcerptCrop
  readonly from_text?: string
  readonly to_text?: string
  readonly padding?: number
  readonly full_width?: boolean
  readonly path?: string
  readonly alt?: string
}

/** 파일을 읽어 풀어 둔 블록(발췌·그림) */
export interface ResolvedCanvasBlockInput extends CanvasBlockInput {
  readonly excerpt?: { readonly selection: PdfExcerptSelection; readonly sourceTitle: string }
  readonly image?: { readonly src: string; readonly width: number; readonly height: number }
}

export interface CanvasEdgeInput {
  readonly from: string
  readonly to: string
  readonly arrow?: boolean
}

export interface CanvasUpdateInput extends CanvasOpStyleInput {
  readonly id: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly text?: string
}

export interface CanvasBlockSummary {
  readonly id: string
  readonly kind: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly text?: string
  readonly source?: { readonly docId: string; readonly page: number; readonly quote: string; readonly title: string }
  readonly background: string
  readonly borderColor: string
}

const DEFAULT_GAP = 24
const TEXT_WIDTH = 420

function round(value: number): number {
  return Math.round(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 캔버스를 바깥에 보이는 요약으로 */
export function summarizeCanvas(document: CanvasDocumentV2): { blocks: CanvasBlockSummary[]; edges: { id: string; from: string; to: string }[] } {
  return {
    blocks: document.nodes.map((node) => {
      const block = node.data.block
      const base = {
        id: node.id,
        kind: block.kind,
        x: round(node.position.x),
        y: round(node.position.y),
        width: round(block.width),
        height: round(block.height),
        background: block.style.background,
        borderColor: block.style.borderColor,
      }
      if (block.kind === 'pdfExcerpt') {
        const anchor = block.source.anchor
        return {
          ...base,
          text: anchor.quote.slice(0, 400),
          source: { docId: anchor.docId, page: anchor.page + 1, quote: anchor.quote.slice(0, 200), title: block.excerpt.sourceTitle },
        }
      }
      if ('text' in block && typeof block.text === 'string') return { ...base, text: block.text }
      if (block.kind === 'image') return { ...base, text: block.alt }
      return base
    }),
    edges: document.edges.map((edge) => ({ id: edge.id, from: edge.source, to: edge.target })),
  }
}

/** 모든 블록을 감싸는 상자. 빈 캔버스면 null */
function contentBounds(nodes: readonly PersistedCanvasNode[]): { left: number; top: number; right: number; bottom: number } | null {
  if (nodes.length === 0) return null
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    left = Math.min(left, node.position.x)
    top = Math.min(top, node.position.y)
    right = Math.max(right, node.position.x + node.data.block.width)
    bottom = Math.max(bottom, node.position.y + node.data.block.height)
  }
  return { left, top, right, bottom }
}

/** 글 블록 높이 어림. 화면에 그리면 앱이 글 높이에 맞춰 다시 늘린다 */
function estimateTextHeight(text: string, width: number, fontSize: number): number {
  const usable = Math.max(width - 28, 40)
  const lineHeight = fontSize * 1.5
  let lines = 0
  for (const line of text.split('\n')) {
    let units = 0
    for (const character of line) units += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/u.test(character) ? fontSize : fontSize * 0.56
    lines += Math.max(1, Math.ceil(units / usable))
  }
  return Math.ceil(lines * lineHeight + 26)
}

function applyStyle(style: TextBlockStyle, input: CanvasOpStyleInput): TextBlockStyle {
  return {
    ...style,
    ...(input.background === undefined ? {} : { background: input.background }),
    ...(input.border_color === undefined ? {} : { borderColor: input.border_color }),
    ...(isFiniteNumber(input.border_width) && input.border_width >= 0 && input.border_width <= 24 ? { borderWidth: input.border_width } : {}),
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(input.bold === undefined ? {} : { bold: input.bold }),
    ...(isFiniteNumber(input.font_size) && input.font_size > 4 ? { fontSize: input.font_size } : {}),
    ...(input.list === undefined ? {} : { list: input.list }),
  }
}

function nodeType(block: CanvasBlockData): string {
  if (block.kind === 'pdfExcerpt') return 'pdfExcerpt'
  if (block.kind === 'image') return 'imageBlock'
  if (isCanvasShapeKind(block.kind)) return 'presetBlock'
  return 'textBlock'
}

function newId(kind: string, taken: Set<string>): string {
  for (let attempt = 0; ; attempt += 1) {
    const id = `mcp-${kind}-${Date.now().toString(36)}${attempt === 0 ? '' : `-${attempt}`}-${Math.random().toString(36).slice(2, 6)}`
    if (!taken.has(id)) {
      taken.add(id)
      return id
    }
  }
}

function buildBlock(input: ResolvedCanvasBlockInput, id: string): CanvasBlockData {
  const width = isFiniteNumber(input.width) && input.width > 0 ? input.width : undefined
  switch (input.type) {
    case 'title':
    case 'heading':
    case 'text':
    case 'code': {
      const level: TextBlockLevel = input.type === 'title' ? 'h2' : input.type === 'heading' ? (input.level ?? 'h2') : 'paragraph'
      let style = createDefaultTextBlockStyle(level)
      if (input.type === 'code') style = { ...style, code: true }
      style = applyStyle(style, input)
      let text = input.text ?? ''
      // 글 블록의 목록 표시는 블록 전체에 글머리표 하나다. 여러 줄이면 줄마다 표시를 글로 붙인다
      if (style.list !== 'none' && text.includes('\n')) {
        const lines = text.split('\n').filter((line) => line.trim() !== '')
        text = lines.map((line, index) => `${style.list === 'number' ? `${index + 1}.` : '•'} ${line.trim()}`).join('\n')
        style = { ...style, list: 'none' }
      }
      const blockWidth = width ?? (input.type === 'title' ? 560 : TEXT_WIDTH)
      const height = isFiniteNumber(input.height) && input.height > 0 ? input.height : estimateTextHeight(text, blockWidth, style.fontSize)
      const block: CanvasBlockData = {
        kind: input.type === 'title' ? 'title' : input.type === 'code' ? 'code' : 'paragraph',
        width: blockWidth,
        height,
        style,
        text,
      }
      return { ...block, ...normalizeCanvasBlockSize(block, block) }
    }
    case 'rectangle':
    case 'ellipse': {
      const style = applyStyle({ ...createDefaultTextBlockStyle(), background: 'transparent', borderColor: '#ef4444' }, input)
      const block: CanvasBlockData = { kind: input.type, width: width ?? 200, height: input.height ?? 120, style }
      return { ...block, ...normalizeCanvasBlockSize(block, block) }
    }
    case 'image': {
      if (input.image === undefined) throw new Error(t('그림 블록에는 path가 필요합니다.'))
      const blockWidth = width ?? Math.min(input.image.width, 640)
      return {
        kind: 'image',
        width: blockWidth,
        height: blockWidth * (input.image.height / input.image.width),
        style: applyStyle(createDefaultTextBlockStyle(), input),
        src: input.image.src,
        alt: input.alt ?? '',
      }
    }
    case 'pdf_excerpt': {
      if (input.excerpt === undefined) throw new Error(t('PDF 발췌에는 doc_id, page와 rect 또는 from_text가 필요합니다.'))
      const { crop } = input.excerpt.selection
      // 기본 폭: 원문 크기(1pt = 96/72 px)를 640px 안에서
      const blockWidth = width ?? Math.min(Math.max(crop.w * (96 / 72), 240), 640)
      const blockHeight = blockWidth * (crop.h / crop.w)
      const excerpt = createPdfExcerptBlock({
        id,
        selection: input.excerpt.selection,
        sourceTitle: input.excerpt.sourceTitle,
        geometry: { x: 0, y: 0, width: blockWidth, height: blockHeight },
      })
      return {
        kind: 'pdfExcerpt',
        width: blockWidth,
        height: blockHeight,
        visualAspectRatio: blockWidth / blockHeight,
        style: applyStyle(createDefaultTextBlockStyle(), input),
        excerpt,
        source: { relation: 'excerpt', anchor: excerpt.iwae.anchor },
      }
    }
    default:
      throw new Error(t('알 수 없는 블록 종류입니다: {type}', { type: String((input as { type?: unknown }).type) }))
  }
}

function side(from: { x: number; y: number; w: number; h: number }, to: { x: number; y: number; w: number; h: number }): ['top' | 'right' | 'bottom' | 'left', 'top' | 'right' | 'bottom' | 'left'] {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2)
  const dy = to.y + to.h / 2 - (from.y + from.h / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

function connect(
  nodes: readonly PersistedCanvasNode[],
  edges: readonly PersistedCanvasEdge[],
  inputs: readonly CanvasEdgeInput[],
  resolve: (key: string) => string | undefined,
): { edges: PersistedCanvasEdge[]; created: string[] } {
  const next = [...edges]
  const created: string[] = []
  const box = (id: string) => {
    const node = nodes.find((candidate) => candidate.id === id)
    if (node === undefined) throw new Error(t('없는 블록입니다: {id}', { id }))
    return { x: node.position.x, y: node.position.y, w: node.data.block.width, h: node.data.block.height }
  }
  for (const input of inputs) {
    const source = resolve(input.from)
    const target = resolve(input.to)
    if (source === undefined) throw new Error(t('없는 블록입니다: {id}', { id: input.from }))
    if (target === undefined) throw new Error(t('없는 블록입니다: {id}', { id: input.to }))
    if (source === target) continue
    const [sourceHandle, targetHandle] = side(box(source), box(target))
    const id = `mcp-edge-${source}-${target}`
    if (next.some((edge) => edge.id === id)) continue
    next.push({ id, source, target, sourceHandle, targetHandle, startMarker: 'none', endMarker: input.arrow === false ? 'none' : 'arrow' })
    created.push(id)
  }
  return { edges: next, created }
}

/** 블록 위에 절반 이상 올라가 있는 도형(블록을 옮기면 같이 옮긴다) */
function ridersOf(base: PersistedCanvasNode, nodes: readonly PersistedCanvasNode[]): PersistedCanvasNode[] {
  if (isCanvasShapeKind(base.data.block.kind)) return []
  const left = base.position.x
  const top = base.position.y
  const right = left + base.data.block.width
  const bottom = top + base.data.block.height
  return nodes.filter((node) => {
    if (node.id === base.id || !isCanvasShapeKind(node.data.block.kind)) return false
    const { width, height } = node.data.block
    const overlapX = Math.min(right, node.position.x + width) - Math.max(left, node.position.x)
    const overlapY = Math.min(bottom, node.position.y + height) - Math.max(top, node.position.y)
    return overlapX > 0 && overlapY > 0 && overlapX * overlapY >= (width * height) / 2
  })
}

/** 블록들을 옮긴다. 블록 위의 도형도 같이 */
function moveNodes(nodes: readonly PersistedCanvasNode[], moves: ReadonlyMap<string, { x: number; y: number }>): PersistedCanvasNode[] {
  const shifts = new Map<string, { x: number; y: number }>()
  for (const [id, position] of moves) {
    const node = nodes.find((candidate) => candidate.id === id)
    if (node === undefined) continue
    const next = normalizeCanvasNodePosition(node.data.block, position)
    shifts.set(id, next)
    const dx = next.x - node.position.x
    const dy = next.y - node.position.y
    for (const rider of ridersOf(node, nodes)) {
      if (moves.has(rider.id) || shifts.has(rider.id)) continue
      shifts.set(rider.id, { x: rider.position.x + dx, y: rider.position.y + dy })
    }
  }
  return nodes.map((node) => {
    const position = shifts.get(node.id)
    return position === undefined ? node : { ...node, position }
  })
}

function finish(document: CanvasDocumentV2, nodes: readonly PersistedCanvasNode[], edges: readonly PersistedCanvasEdge[]): CanvasDocumentV2 {
  return parseCanvasDocument({ ...document, nodes, edges })
}

export function addCanvasBlocks(
  document: CanvasDocumentV2,
  blocks: readonly ResolvedCanvasBlockInput[],
  edgeInputs: readonly CanvasEdgeInput[] = [],
  options: { readonly origin?: { x: number; y: number }; readonly gap?: number } = {},
): { document: CanvasDocumentV2; created: { ref?: string; id: string; kind: string; x: number; y: number; width: number; height: number }[]; edges: string[] } {
  const taken = new Set(document.nodes.map((node) => node.id))
  const bounds = contentBounds(document.nodes)
  const gap = isFiniteNumber(options.gap) && options.gap >= 0 ? options.gap : DEFAULT_GAP
  const cursor = {
    x: options.origin?.x ?? bounds?.left ?? 80,
    y: options.origin?.y ?? (bounds === null ? 80 : bounds.bottom + gap * 2),
  }
  const refs = new Map<string, string>()
  const nodes = [...document.nodes]
  const created: { ref?: string; id: string; kind: string; x: number; y: number; width: number; height: number }[] = []
  blocks.forEach((input, index) => {
    const id = newId(input.type.replace('_', '-'), taken)
    let block: CanvasBlockData
    try {
      block = buildBlock(input, id)
    } catch (cause) {
      throw new Error(`blocks[${index}]: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    const placed = isFiniteNumber(input.x) && isFiniteNumber(input.y)
    const position = normalizeCanvasNodePosition(block, placed ? { x: input.x!, y: input.y! } : cursor)
    if (!placed) cursor.y = position.y + block.height + gap
    nodes.push({ id, type: nodeType(block), position, data: { block }, ...(isCanvasShapeKind(block.kind) ? {} : { className: 'note-canvas-node' }) })
    if (input.ref !== undefined) refs.set(input.ref, id)
    created.push({ ...(input.ref === undefined ? {} : { ref: input.ref }), id, kind: block.kind, x: position.x, y: position.y, width: round(block.width), height: round(block.height) })
  })
  const resolve = (key: string) => refs.get(key) ?? (nodes.some((node) => node.id === key) ? key : undefined)
  const linked = connect(nodes, document.edges, edgeInputs, resolve)
  return { document: finish(document, nodes, linked.edges), created, edges: linked.created }
}

export function updateCanvasBlocks(document: CanvasDocumentV2, updates: readonly CanvasUpdateInput[]): { document: CanvasDocumentV2; updated: string[] } {
  let nodes = [...document.nodes]
  const moves = new Map<string, { x: number; y: number }>()
  for (const update of updates) {
    const index = nodes.findIndex((node) => node.id === update.id)
    if (index < 0) throw new Error(t('없는 블록입니다: {id}', { id: update.id }))
    const node = nodes[index]!
    let block: CanvasBlockData = { ...node.data.block, style: applyStyle(node.data.block.style, update) } as CanvasBlockData
    if (update.text !== undefined) {
      if (!('text' in block)) throw new Error(t('글이 없는 블록입니다: {id}', { id: update.id }))
      block = { ...block, text: update.text } as CanvasBlockData
    }
    if (isFiniteNumber(update.width) || isFiniteNumber(update.height)) {
      const requested = {
        width: isFiniteNumber(update.width) ? update.width : block.width,
        height: isFiniteNumber(update.height) ? update.height : block.height,
      }
      const size = normalizeCanvasBlockSize(block, requested)
      block = block.kind === 'pdfExcerpt'
        ? { ...block, ...size, excerpt: { ...block.excerpt, ...size } }
        : { ...block, ...size, ...('text' in block && isFiniteNumber(update.height) ? { manualHeight: true as const } : {}) } as CanvasBlockData
    }
    nodes[index] = { ...node, data: { block } }
    if (isFiniteNumber(update.x) || isFiniteNumber(update.y)) {
      moves.set(update.id, { x: isFiniteNumber(update.x) ? update.x : node.position.x, y: isFiniteNumber(update.y) ? update.y : node.position.y })
    }
  }
  nodes = moveNodes(nodes, moves)
  return { document: finish(document, nodes, document.edges), updated: updates.map(({ id }) => id) }
}

/**
 * 겹친 블록을 아래로 밀어 푼다. 위에서부터 차례로 보며, 앞서 놓인 블록과 가로로 겹치고 세로로
 * 겹치거나 gap 보다 가까우면 그 아래로 내린다. 가로 위치는 그대로라 여러 단 배치가 유지된다.
 * 블록 위에 그린 도형은 블록과 함께 움직인다. `ids` 를 주면 그 블록들만 움직인다(나머지는 기준).
 */
export function tidyCanvasOverlaps(
  document: CanvasDocumentV2,
  options: { readonly gap?: number; readonly ids?: readonly string[] } = {},
): { document: CanvasDocumentV2; moved: { id: string; x: number; y: number }[] } {
  const gap = isFiniteNumber(options.gap) && options.gap >= 0 ? options.gap : 16
  const movable = options.ids === undefined ? null : new Set(options.ids)
  const blocks = document.nodes
    .filter((node) => !isCanvasShapeKind(node.data.block.kind))
    .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x)
  const placed: { id: string; left: number; right: number; top: number; bottom: number }[] = []
  const moves = new Map<string, { x: number; y: number }>()
  for (const node of blocks) {
    const left = node.position.x
    const right = left + node.data.block.width
    let top = node.position.y
    const height = node.data.block.height
    if (movable === null || movable.has(node.id)) {
      // 겹치는 것이 없어질 때까지 내린다
      for (let guard = 0; guard < placed.length + 1; guard += 1) {
        const blocker = placed.find((other) => other.left < right && other.right > left && other.top < top + height + gap && other.bottom + gap > top)
        if (blocker === undefined) break
        top = blocker.bottom + gap
      }
      if (top !== node.position.y) moves.set(node.id, { x: left, y: top })
    }
    placed.push({ id: node.id, left, right, top, bottom: top + height })
  }
  const nodes = moveNodes(document.nodes, moves)
  return {
    document: moves.size === 0 ? document : finish(document, nodes, document.edges),
    moved: [...moves.keys()].map((id) => {
      const node = nodes.find((candidate) => candidate.id === id)!
      return { id, x: node.position.x, y: node.position.y }
    }),
  }
}

export function arrangeCanvasBlocks(
  document: CanvasDocumentV2,
  options: { readonly ids?: readonly string[]; readonly layout: 'grid' | 'column' | 'row' | 'stack'; readonly columns?: number; readonly gap?: number; readonly x?: number; readonly y?: number },
): { document: CanvasDocumentV2; arranged: { id: string; x: number; y: number }[] } {
  if (options.layout === 'stack') {
    const tidied = tidyCanvasOverlaps(document, { gap: options.gap, ids: options.ids })
    return { document: tidied.document, arranged: tidied.moved }
  }
  const gap = isFiniteNumber(options.gap) && options.gap >= 0 ? options.gap : 32
  const ordered = options.ids === undefined
    ? [...document.nodes]
        .filter((node) => !isCanvasShapeKind(node.data.block.kind))
        .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x)
    : options.ids.map((id) => {
        const node = document.nodes.find((candidate) => candidate.id === id)
        if (node === undefined) throw new Error(t('없는 블록입니다: {id}', { id }))
        return node
      })
  if (ordered.length === 0) return { document, arranged: [] }
  const first = ordered[0]!
  const startX = options.x ?? Math.min(...ordered.map((node) => node.position.x))
  const startY = options.y ?? first.position.y
  const columns = options.layout === 'column' ? 1 : options.layout === 'row' ? ordered.length : Math.max(1, Math.floor(options.columns ?? 2))
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(...ordered.filter((_, index) => index % columns === column).map((node) => node.data.block.width)))
  const moves = new Map<string, { x: number; y: number }>()
  let rowTop = startY
  for (let rowStart = 0; rowStart < ordered.length; rowStart += columns) {
    const row = ordered.slice(rowStart, rowStart + columns)
    let x = startX
    row.forEach((node, column) => {
      moves.set(node.id, { x, y: rowTop })
      x += (columnWidths[column] ?? node.data.block.width) + gap
    })
    rowTop += Math.max(...row.map((node) => node.data.block.height)) + gap
  }
  const nodes = moveNodes(document.nodes, moves)
  return {
    document: finish(document, nodes, document.edges),
    arranged: ordered.map((node) => {
      const moved = nodes.find((candidate) => candidate.id === node.id)!
      return { id: node.id, x: moved.position.x, y: moved.position.y }
    }),
  }
}

export function connectCanvasBlocks(document: CanvasDocumentV2, inputs: readonly CanvasEdgeInput[]): { document: CanvasDocumentV2; edges: string[] } {
  const resolve = (key: string) => (document.nodes.some((node) => node.id === key) ? key : undefined)
  const linked = connect(document.nodes, document.edges, inputs, resolve)
  return { document: finish(document, document.nodes, linked.edges), edges: linked.created }
}

export function deleteCanvasBlocks(document: CanvasDocumentV2, ids: readonly string[]): { document: CanvasDocumentV2; deleted: string[] } {
  const remove = new Set(ids)
  const missing = ids.filter((id) => !document.nodes.some((node) => node.id === id))
  if (missing.length > 0) throw new Error(t('없는 블록입니다: {id}', { id: missing.join(', ') }))
  return {
    document: finish(
      document,
      document.nodes.filter((node) => !remove.has(node.id)),
      document.edges.filter((edge) => !remove.has(edge.source) && !remove.has(edge.target)),
    ),
    deleted: [...remove],
  }
}

/** 공백·대소문자를 무시하고 찾을 수 있게: 접은 글과, 접은 글 위치 → 원래 위치 */
function foldText(text: string): { folded: string; origin: number[] } {
  let folded = ''
  const origin: number[] = []
  let pendingSpace = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (/\s/u.test(character)) {
      pendingSpace = folded.length > 0
      continue
    }
    if (pendingSpace) {
      folded += ' '
      origin.push(index)
      pendingSpace = false
    }
    folded += character.toLowerCase()
    origin.push(index)
  }
  return { folded, origin }
}

function foldNeedle(text: string): string {
  return text.trim().replace(/\s+/gu, ' ').toLowerCase()
}

/** 쪽 글에서 from_text … to_text 를 찾아 그 글자들을 감싸는 영역(pt, 왼쪽 위 원점) */
/**
 * 쪽 글에서 from_text(…to_text 까지)가 있는 글자 범위 [시작, 끝). 공백·대소문자는 가리지 않는다.
 * 글자 형광펜(메모)을 MCP 로 만들 때도 쓴다.
 */
export function findTextRange(index: PageTextIndex, fromText: string, toText?: string): [number, number] {
  const { folded, origin } = foldText(index.text)
  const from = foldNeedle(fromText)
  if (from === '') throw new Error(t('from_text가 비어 있습니다.'))
  const start = folded.indexOf(from)
  if (start < 0) throw new Error(t('쪽에서 from_text를 찾지 못했습니다: "{text}". read_page로 쪽 글을 확인하세요.', { text: fromText.slice(0, 60) }))
  let end = start + from.length
  if (toText !== undefined && toText.trim() !== '') {
    const to = foldNeedle(toText)
    const found = folded.indexOf(to, start)
    if (found < 0) throw new Error(t('from_text 뒤에서 to_text를 찾지 못했습니다: "{text}"', { text: toText.slice(0, 60) }))
    end = found + to.length
  }
  const first = origin[start] ?? 0
  const last = origin[end - 1] ?? first
  return [first, last + 1]
}

export function findTextRegion(
  index: PageTextIndex,
  fromText: string,
  toText: string | undefined,
  options: { readonly padding?: number; readonly fullWidth?: boolean; readonly pageSize: readonly [number, number] },
): PdfExcerptCrop {
  const [first, endChar] = findTextRange(index, fromText, toText)
  const last = endChar - 1
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (let charIndex = first; charIndex <= last; charIndex += 1) {
    const box = index.chars[charIndex]
    if (box === undefined || box.w <= 0 || box.h <= 0) continue
    left = Math.min(left, box.x)
    top = Math.min(top, box.y)
    right = Math.max(right, box.x + box.w)
    bottom = Math.max(bottom, box.y + box.h)
  }
  if (!Number.isFinite(left)) throw new Error(t('찾은 글자에 위치 정보가 없습니다. 스캔본일 수 있으니 rect로 영역을 지정하세요.'))
  if (options.fullWidth === true) {
    const boxes = index.chars.filter((box) => box.w > 0 && box.h > 0 && box.c.trim() !== '')
    left = Math.min(left, ...boxes.map((box) => box.x))
    right = Math.max(right, ...boxes.map((box) => box.x + box.w))
  }
  const padding = isFiniteNumber(options.padding) ? Math.max(0, options.padding) : 6
  const [pageWidth, pageHeight] = options.pageSize
  const x = Math.max(0, left - padding)
  const y = Math.max(0, top - padding)
  return {
    x,
    y,
    w: Math.min(pageWidth, right + padding) - x,
    h: Math.min(pageHeight, bottom + padding) - y,
  }
}

/** canvas 인자(경로 또는 제목)로 캔버스를 고른다 */
export function resolveCanvasTarget<T extends { readonly path: string; readonly title: string }>(canvases: readonly T[], query: string): T {
  const normalized = query.replaceAll('\\', '/').trim()
  const byPath = canvases.find((canvas) => canvas.path === normalized)
  if (byPath !== undefined) return byPath
  const lower = normalized.toLowerCase()
  const byTitle = canvases.filter((canvas) => canvas.title.toLowerCase() === lower)
  if (byTitle.length === 1) return byTitle[0]!
  if (byTitle.length > 1) throw new Error(t('같은 제목의 캔버스가 여럿입니다. 경로로 지정하세요: {paths}', { paths: byTitle.map((canvas) => canvas.path).join(', ') }))
  // 파일 이름(확장자 뺀)으로도 찾는다
  const stem = (path: string) => (path.split('/').pop() ?? path).replace(/\.canvas$/iu, '').toLowerCase()
  const byStem = canvases.filter((canvas) => stem(canvas.path) === lower.replace(/\.canvas$/iu, ''))
  if (byStem.length === 1) return byStem[0]!
  throw new Error(t('캔버스를 찾지 못했습니다: {query}. canvas_list로 확인하세요.', { query }))
}
