/**
 * PDF 위에 직접 쓰는 편집(글 상자·선). 원본 PDF 는 건드리지 않고 덮개 층으로 따로 저장한다(`.iwae/pdf-overlays.json`, 문서(판)별).
 * 좌표는 모두 쪽 좌표(points, 왼쪽 위 기준)라서 확대·축소에도 쪽의 같은 자리에 남는다. 눈 단추(깨끗이 보기)로 감출 수 있다.
 */

/** 색: 기본 일곱 가지 또는 직접 고른 #rrggbb */
export type OverlayColor = string
export const OVERLAY_COLORS: readonly OverlayColor[] = ['#111111', '#d9363e', '#1a73e8', '#188038', '#f29900', '#7b1fa2', '#ffffff']
/** #rrggbb 인가 */
export function isOverlayColor(value: unknown): value is OverlayColor {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value)
}

export interface PdfTextBox {
  readonly id: string
  readonly kind: 'text'
  /** 0 부터 */
  readonly page: number
  readonly x: number
  readonly y: number
  /** 너비(points). 높이는 글에 따라 자란다 */
  readonly w: number
  readonly text: string
  /** 글자 크기(points) */
  readonly size: number
  readonly color: OverlayColor
  readonly bold?: boolean
  /** 배경: 없으면 투명, 'white' 는 흰 바탕(원문 글자를 가릴 때), 'yellow' 는 옅은 노랑 */
  readonly fill?: 'white' | 'yellow'
  /** 테두리를 그릴까 */
  readonly border?: boolean
}

export interface PdfLine {
  readonly id: string
  readonly kind: 'line'
  readonly page: number
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly color: OverlayColor
  /** 선 굵기(points) */
  readonly width: number
  /** 끝에 화살촉 */
  readonly arrow?: boolean
  /** 시작에도 화살촉(양쪽 화살표) */
  readonly arrowStart?: boolean
  readonly dashed?: boolean
  /** 짧은 점선(dashed 보다 먼저 본다) */
  readonly dotted?: boolean
}

/** 펜으로 자유롭게 그린 선(쪽 좌표 점들) */
export interface PdfInk {
  readonly id: string
  readonly kind: 'ink'
  readonly page: number
  readonly points: readonly (readonly [number, number])[]
  readonly color: OverlayColor
  /** 선 굵기(points) */
  readonly width: number
}

/**
 * 도형(네모·동그라미·가리기). x, y 는 왼쪽 위, w, h 는 크기(쪽 좌표).
 * 'redact'(가리기)는 화면에서는 검은 상자로 덮어 보이고, 「가린 사본」을 만들 때 그 자리의 글자·그림을 정말로 지운다.
 */
export interface PdfShape {
  readonly id: string
  readonly kind: 'shape'
  readonly shape: 'rect' | 'ellipse' | 'redact'
  readonly page: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly color: OverlayColor
  /** 선 굵기(points) */
  readonly width: number
  /** 안을 옅게 칠할까 */
  readonly fill?: boolean
  readonly dashed?: boolean
  readonly dotted?: boolean
}

export type PdfOverlay = PdfTextBox | PdfLine | PdfInk | PdfShape
/** 덮개 하나를 고칠 때 넘기는 값 */
export type OverlayPatch = Partial<PdfTextBox> | Partial<PdfLine> | Partial<PdfInk> | Partial<PdfShape>

/** 도형이 이보다 작으면(그냥 눌렀을 뿐이면) 만들지 않는다 */
export const SHAPE_MIN_SIZE = 4

/** 두 점(끈 시작·끝)으로 도형을 만든다. Shift 면 정사각형·원 */
export function createShape(page: number, shape: PdfShape['shape'], from: { x: number; y: number }, to: { x: number; y: number }, init: Partial<Pick<PdfShape, 'color' | 'width' | 'fill' | 'dashed' | 'dotted'>> = {}): PdfShape {
  return {
    id: newOverlayId(),
    kind: 'shape',
    shape,
    page,
    ...shapeBox(from, to),
    color: init.color ?? '#d9363e',
    width: init.width ?? 2,
    ...(init.fill === true ? { fill: true } : {}),
    ...(init.dotted === true ? { dotted: true } : init.dashed === true ? { dashed: true } : {}),
  }
}

/** 선 모양: 실선·점선·짧은 점선 */
export type OverlayDash = 'solid' | 'dash' | 'dot'
export function dashOf(item: { readonly dashed?: boolean; readonly dotted?: boolean }): OverlayDash {
  return item.dotted === true ? 'dot' : item.dashed === true ? 'dash' : 'solid'
}
export function dashPatch(dash: OverlayDash): { dashed?: boolean; dotted?: boolean } {
  return { dashed: dash === 'dash' ? true : undefined, dotted: dash === 'dot' ? true : undefined }
}
/** SVG stroke-dasharray(굵기 w 화면 px 기준). 짧은 점선은 둥근 끝과 같이 쓴다 */
export function dashArray(dash: OverlayDash, w: number): string | undefined {
  if (dash === 'dash') return `${w * 3} ${w * 2}`
  if (dash === 'dot') return `0.01 ${w * 2.2}`
  return undefined
}

/** 끈 두 점 → 왼쪽 위·크기 */
export function shapeBox(from: { x: number; y: number }, to: { x: number; y: number }, square = false): { x: number; y: number; w: number; h: number } {
  let w = Math.abs(to.x - from.x)
  let h = Math.abs(to.y - from.y)
  if (square) w = h = Math.max(w, h)
  return { x: to.x < from.x ? from.x - w : from.x, y: to.y < from.y ? from.y - h : from.y, w, h }
}

export interface PdfOverlaysFile {
  readonly version: 1
  readonly overlays: Readonly<Record<string, readonly PdfOverlay[]>>
}

export const EMPTY_PDF_OVERLAYS: PdfOverlaysFile = { version: 1, overlays: {} }

export const TEXT_BOX_MIN_WIDTH = 40
export const TEXT_BOX_DEFAULT_WIDTH = 180
export const TEXT_SIZES: readonly number[] = [7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 32]
export const LINE_WIDTHS: readonly number[] = [1, 2, 3, 5]

let counter = 0
export function newOverlayId(): string {
  counter += 1
  return `o${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

export function createTextBox(page: number, x: number, y: number, init: Partial<Omit<PdfTextBox, 'id' | 'kind' | 'page' | 'x' | 'y'>> = {}): PdfTextBox {
  return {
    id: newOverlayId(),
    kind: 'text',
    page,
    x,
    y,
    w: init.w ?? TEXT_BOX_DEFAULT_WIDTH,
    text: init.text ?? '',
    size: init.size ?? 9,
    color: init.color ?? '#d9363e',
    ...(init.bold === true ? { bold: true } : {}),
    ...(init.fill === undefined ? {} : { fill: init.fill }),
    ...(init.border === true ? { border: true } : {}),
  }
}

export function createLine(page: number, from: { x: number; y: number }, to: { x: number; y: number }, init: Partial<Pick<PdfLine, 'color' | 'width' | 'arrow' | 'arrowStart' | 'dashed' | 'dotted'>> = {}): PdfLine {
  return {
    id: newOverlayId(),
    kind: 'line',
    page,
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
    color: init.color ?? '#d9363e',
    width: init.width ?? 2,
    ...(init.arrow === true ? { arrow: true } : {}),
    ...(init.arrowStart === true ? { arrowStart: true } : {}),
    ...(init.dotted === true ? { dotted: true } : init.dashed === true ? { dashed: true } : {}),
  }
}

/**
 * 펜 획 줄이기: 앞 점과 너무 가까운 점(minGap points 미만)은 뺀다(마지막 점은 남긴다). 저장 크기와 그리기 부담을 줄인다.
 */
export function simplifyInk(points: readonly (readonly [number, number])[], minGap = 0.8): [number, number][] {
  const out: [number, number][] = []
  for (const [x, y] of points) {
    const last = out[out.length - 1]
    if (last === undefined || Math.hypot(x - last[0], y - last[1]) >= minGap) out.push([x, y])
  }
  const end = points[points.length - 1]
  const tail = out[out.length - 1]
  if (end !== undefined && tail !== undefined && (end[0] !== tail[0] || end[1] !== tail[1])) out.push([end[0], end[1]])
  return out
}

export function createInk(page: number, points: readonly (readonly [number, number])[], init: Partial<Pick<PdfInk, 'color' | 'width'>> = {}): PdfInk {
  return {
    id: newOverlayId(),
    kind: 'ink',
    page,
    points: simplifyInk(points).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const),
    color: init.color ?? '#d9363e',
    width: init.width ?? 2,
  }
}

/** 펜 획을 SVG path 로(쪽 좌표 → 화면 좌표 변환 함수를 받는다) */
export function inkPath(points: readonly (readonly [number, number])[], toScreen: (x: number, y: number) => [number, number] = (x, y) => [x, y]): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points.map(([x, y]) => toScreen(x, y))
  if (rest.length === 0) return `M ${first![0]} ${first![1]} l 0.01 0`
  return `M ${first![0]} ${first![1]} ` + rest.map(([x, y]) => `L ${x} ${y}`).join(' ')
}

/** 선이 너무 짧으면(그냥 눌렀을 뿐이면) 만들지 않는다 */
export function isMeaningfulLine(from: { x: number; y: number }, to: { x: number; y: number }, minLength = 6): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= minLength
}

/** Shift 를 누르고 그리면 수평·수직·45° 로 맞춘다 */
export function snapLineEnd(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return to
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length }
}

type Overlays = Readonly<Record<string, readonly PdfOverlay[]>>

export function addOverlay(all: Overlays, docId: string, overlay: PdfOverlay): Overlays {
  return { ...all, [docId]: [...(all[docId] ?? []), overlay] }
}

export function updateOverlay(all: Overlays, docId: string, id: string, patch: OverlayPatch): Overlays {
  const list = all[docId]
  if (list === undefined) return all
  return { ...all, [docId]: list.map((item) => item.id === id ? { ...item, ...patch } as PdfOverlay : item) }
}

export function removeOverlay(all: Overlays, docId: string, id: string): Overlays {
  const list = all[docId]
  if (list === undefined) return all
  const next = list.filter((item) => item.id !== id)
  if (next.length === list.length) return all
  if (next.length === 0) {
    const { [docId]: _gone, ...rest } = all
    return rest
  }
  return { ...all, [docId]: next }
}

/** 쪽 편집(순서·회전·끼움)으로 쪽이 옮겨졌을 때. moves: 옛 쪽 → 새 쪽(없으면 그 쪽이 사라진 것이라 덮개도 뺀다) */
export function remapOverlayPages(all: Overlays, docId: string, moves: ReadonlyMap<number, number>): Overlays {
  const list = all[docId]
  if (list === undefined) return all
  const next = list.flatMap((item): PdfOverlay[] => {
    const to = moves.get(item.page)
    return to === undefined ? [] : [{ ...item, page: to }]
  })
  if (next.length === 0) {
    const { [docId]: _gone, ...rest } = all
    return rest
  }
  return { ...all, [docId]: next }
}


function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parsePdfOverlays(value: unknown): PdfOverlaysFile {
  if (typeof value !== 'object' || value === null) return EMPTY_PDF_OVERLAYS
  const raw = (value as { overlays?: unknown }).overlays
  if (typeof raw !== 'object' || raw === null) return EMPTY_PDF_OVERLAYS
  const overlays: Record<string, PdfOverlay[]> = {}
  for (const [docId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue
    const seen = new Set<string>()
    const items = list.flatMap((entry: unknown): PdfOverlay[] => {
      if (typeof entry !== 'object' || entry === null) return []
      const item = entry as Record<string, unknown>
      const id = typeof item.id === 'string' && item.id !== '' && !seen.has(item.id) ? item.id : null
      const page = num(item.page)
      const color = isOverlayColor(item.color) ? item.color.toLowerCase() : '#d9363e'
      if (id === null || page === null || page < 0 || !Number.isInteger(page)) return []
      seen.add(id)
      if (item.kind === 'text') {
        const x = num(item.x)
        const y = num(item.y)
        const w = num(item.w)
        const size = num(item.size)
        // 빈 글 상자는 남기지 않는다(예전 판이 글을 쓰기 전에 저장해 둔 것)
        if (x === null || y === null || typeof item.text !== 'string' || item.text.trim() === '') return []
        return [{
          id, kind: 'text', page, x, y,
          w: Math.max(w ?? TEXT_BOX_DEFAULT_WIDTH, TEXT_BOX_MIN_WIDTH),
          text: item.text.slice(0, 4000),
          size: Math.min(Math.max(size ?? 12, 4), 96),
          color,
          ...(item.bold === true ? { bold: true } : {}),
          ...(item.fill === 'white' || item.fill === 'yellow' ? { fill: item.fill } : {}),
          ...(item.border === true ? { border: true } : {}),
        }]
      }
      if (item.kind === 'shape') {
        const x = num(item.x)
        const y = num(item.y)
        const w = num(item.w)
        const h = num(item.h)
        const width = num(item.width)
        if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return []
        return [{
          id, kind: 'shape', shape: item.shape === 'ellipse' ? 'ellipse' : item.shape === 'redact' ? 'redact' : 'rect', page, x, y, w, h, color,
          width: Math.min(Math.max(width ?? 2, 0.5), 20),
          ...(item.fill === true ? { fill: true } : {}),
          ...(item.dotted === true ? { dotted: true } : item.dashed === true ? { dashed: true } : {}),
        }]
      }
      if (item.kind === 'ink') {
        const width = num(item.width)
        if (!Array.isArray(item.points)) return []
        const points = item.points.flatMap((point: unknown): [number, number][] => {
          if (!Array.isArray(point)) return []
          const x = num(point[0])
          const y = num(point[1])
          return x === null || y === null ? [] : [[x, y]]
        }).slice(0, 20000)
        if (points.length === 0) return []
        return [{ id, kind: 'ink', page, points, color, width: Math.min(Math.max(width ?? 2, 0.5), 20) }]
      }
      if (item.kind === 'line') {
        const x1 = num(item.x1)
        const y1 = num(item.y1)
        const x2 = num(item.x2)
        const y2 = num(item.y2)
        const width = num(item.width)
        if (x1 === null || y1 === null || x2 === null || y2 === null) return []
        return [{
          id, kind: 'line', page, x1, y1, x2, y2, color,
          width: Math.min(Math.max(width ?? 2, 0.5), 20),
          ...(item.arrow === true ? { arrow: true } : {}),
          ...(item.arrowStart === true ? { arrowStart: true } : {}),
          ...(item.dotted === true ? { dotted: true } : item.dashed === true ? { dashed: true } : {}),
        }]
      }
      return []
    })
    if (items.length > 0) overlays[docId] = items
  }
  return { version: 1, overlays }
}

/** 가리기 상자인가 */
export function isRedaction(overlay: PdfOverlay): overlay is PdfShape {
  return overlay.kind === 'shape' && overlay.shape === 'redact'
}
