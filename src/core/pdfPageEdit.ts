/**
 * PDF 쪽 편집(순서 바꾸기·돌리기·다른 PDF 쪽 끼워 넣기·빼기)의 계획과, 편집 뒤에 형광펜·책갈피·
 * 노트 출처를 새 쪽으로 옮기는 계산. 순수 함수만 둔다.
 *
 * 좌표는 PDFium 쪽 좌표(포인트, 원점 왼쪽 위, 이미 /Rotate 가 적용된 화면 방향)다. 쪽을 돌리면
 * 같은 글자의 좌표가 바뀌므로 그 쪽의 상자도 함께 돌린다.
 */
import type { Anchor, AnchorRect } from './anchor'

export type PageRotation = 0 | 90 | 180 | 270

/** 편집 화면의 쪽 하나 */
export interface PageEditItem {
  /** 화면 안에서만 쓰는 고유 키 */
  readonly key: string
  /** 없으면 편집 중인 문서. 있으면 끼워 넣을 다른 PDF 경로 */
  readonly source?: string
  /** 그 문서의 0-기반 쪽 */
  readonly page: number
  /** 지금보다 더 돌릴 각도 */
  readonly rotate: PageRotation
  /** 끼워 넣은 쪽의 출처 이름(화면 표시용) */
  readonly sourceTitle?: string
}

export function initialPageItems(pageCount: number): PageEditItem[] {
  return Array.from({ length: pageCount }, (_, page) => ({ key: `self:${page}`, page, rotate: 0 }))
}

export function rotateItem(item: PageEditItem, by: 90 | -90): PageEditItem {
  return { ...item, rotate: (((item.rotate + by) % 360 + 360) % 360) as PageRotation }
}

/** 0-기반 from 자리의 쪽들을 to 자리로 옮긴다(to 는 옮긴 뒤 기준이 아니라 지금 목록 기준) */
export function moveItems<T>(items: readonly T[], indexes: readonly number[], to: number): T[] {
  const picked = new Set(indexes)
  const moving = items.filter((_, index) => picked.has(index))
  const rest = items.filter((_, index) => !picked.has(index))
  const before = items.slice(0, to).filter((_, index) => !picked.has(index)).length
  return [...rest.slice(0, before), ...moving, ...rest.slice(before)]
}

export function isUnchanged(items: readonly PageEditItem[], pageCount: number): boolean {
  return items.length === pageCount
    && items.every((item, index) => item.source === undefined && item.page === index && item.rotate === 0)
}

/** 원본 쪽 → 새 자리와 더 돌린 각도. 뺀 쪽은 없다(형광펜도 함께 빠진다) */
export interface PageMove {
  readonly to: number
  readonly rotate: PageRotation
}

export function pageMoves(items: readonly PageEditItem[]): Map<number, PageMove> {
  const moves = new Map<number, PageMove>()
  items.forEach((item, index) => {
    // 같은 원본 쪽이 두 번 들어가면(복제) 첫 자리를 따른다
    if (item.source === undefined && !moves.has(item.page)) moves.set(item.page, { to: index, rotate: item.rotate })
  })
  return moves
}

/** 시계 방향으로 rotate 만큼 돌린 쪽에서의 상자. size 는 돌리기 전 쪽의 [폭, 높이] */
export function rotateRect(rect: AnchorRect, rotate: PageRotation, size: readonly [number, number]): AnchorRect {
  const [width, height] = size
  switch (rotate) {
    case 90: return { x: height - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w }
    case 180: return { x: width - rect.x - rect.w, y: height - rect.y - rect.h, w: rect.w, h: rect.h }
    case 270: return { x: rect.y, y: width - rect.x - rect.w, w: rect.h, h: rect.w }
    default: return rect
  }
}

/** 앵커를 새 쪽으로 옮긴다. 원본 쪽을 뺐으면 null */
export function remapAnchor(
  anchor: Anchor,
  moves: ReadonlyMap<number, PageMove>,
  pageSizes: readonly (readonly [number, number])[],
): Anchor | null {
  const move = moves.get(anchor.page)
  if (move === undefined) return null
  const size = pageSizes[anchor.page] ?? [612, 792]
  return {
    ...anchor,
    page: move.to,
    rects: anchor.rects.map((rect) => rotateRect(rect, move.rotate, size)),
  }
}

/**
 * 노트(.canvas) JSON 안의 이 문서 출처를 모두 옮긴다. 노트 형식을 몰라도 되도록
 * `docId` 와 숫자 `page` 를 함께 가진 객체를 찾아 쪽을 바꾸고, 같은 객체의 rects·crop 도 돌린다.
 * 바뀐 것이 있으면 새 값을, 없으면 null 을 돌려준다.
 */
export function remapDocumentReferences(
  value: unknown,
  docId: string,
  moves: ReadonlyMap<number, PageMove>,
  pageSizes: readonly (readonly [number, number])[],
): unknown | null {
  let changed = false
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit)
    if (typeof node !== 'object' || node === null) return node
    const record = node as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(record)) next[key] = visit(child)
    if (next.docId === docId && typeof next.page === 'number') {
      const move = moves.get(next.page)
      if (move !== undefined) {
        const size = pageSizes[next.page] ?? [612, 792]
        if (move.to !== next.page || move.rotate !== 0) changed = true
        if (Array.isArray(next.rects)) next.rects = (next.rects as AnchorRect[]).map((rect) => rotateRect(rect, move.rotate, size))
        if (isRect(next.crop)) next.crop = rotateRect(next.crop, move.rotate, size)
        next.page = move.to
      }
    }
    return next
  }
  const result = visit(value)
  return changed ? result : null
}

function isRect(value: unknown): value is AnchorRect {
  return typeof value === 'object' && value !== null
    && ['x', 'y', 'w', 'h'].every((key) => typeof (value as Record<string, unknown>)[key] === 'number')
}
