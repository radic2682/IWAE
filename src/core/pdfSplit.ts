/**
 * PDF 한 창 안을 여러 칸으로 나눠 같은 PDF 의 다른 쪽을 함께 본다.
 * 칸 배치는 2×2(또는 3×1) 격자 위에 칸을 놓는 것으로 적는다. 칸 크기는 줄·열 비율로 끌어서 바꾼다.
 */
import { t } from '../i18n'

export type PdfSplitLayoutId =
  | 'single'
  | 'cols2'
  | 'rows2'
  | 'cols3'
  | 'top2-bottom1'
  | 'top1-bottom2'
  | 'left1-right2'
  | 'left2-right1'
  | 'grid4'

export interface PdfSplitCell {
  readonly col: number
  readonly row: number
  readonly colSpan: number
  readonly rowSpan: number
}

export interface PdfSplitLayout {
  readonly id: PdfSplitLayoutId
  readonly label: string
  readonly cols: number
  readonly rows: number
  readonly cells: readonly PdfSplitCell[]
}

const cell = (col: number, row: number, colSpan = 1, rowSpan = 1): PdfSplitCell => ({ col, row, colSpan, rowSpan })

export const PDF_SPLIT_LAYOUTS: readonly PdfSplitLayout[] = [
  { id: 'single', get label() { return t('한 화면') }, cols: 1, rows: 1, cells: [cell(0, 0)] },
  { id: 'cols2', get label() { return t('좌우 둘') }, cols: 2, rows: 1, cells: [cell(0, 0), cell(1, 0)] },
  { id: 'rows2', get label() { return t('위아래 둘') }, cols: 1, rows: 2, cells: [cell(0, 0), cell(0, 1)] },
  { id: 'cols3', get label() { return t('좌우 셋') }, cols: 3, rows: 1, cells: [cell(0, 0), cell(1, 0), cell(2, 0)] },
  { id: 'top2-bottom1', get label() { return t('위 둘 · 아래 하나') }, cols: 2, rows: 2, cells: [cell(0, 0), cell(1, 0), cell(0, 1, 2)] },
  { id: 'top1-bottom2', get label() { return t('위 하나 · 아래 둘') }, cols: 2, rows: 2, cells: [cell(0, 0, 2), cell(0, 1), cell(1, 1)] },
  { id: 'left1-right2', get label() { return t('왼쪽 하나 · 오른쪽 둘') }, cols: 2, rows: 2, cells: [cell(0, 0, 1, 2), cell(1, 0), cell(1, 1)] },
  { id: 'left2-right1', get label() { return t('왼쪽 둘 · 오른쪽 하나') }, cols: 2, rows: 2, cells: [cell(0, 0), cell(0, 1), cell(1, 0, 1, 2)] },
  { id: 'grid4', get label() { return t('넷(2×2)') }, cols: 2, rows: 2, cells: [cell(0, 0), cell(1, 0), cell(0, 1), cell(1, 1)] },
]

export function pdfSplitLayout(id: PdfSplitLayoutId): PdfSplitLayout {
  return PDF_SPLIT_LAYOUTS.find((layout) => layout.id === id) ?? PDF_SPLIT_LAYOUTS[0]!
}

export function isPdfSplitLayoutId(value: unknown): value is PdfSplitLayoutId {
  return typeof value === 'string' && PDF_SPLIT_LAYOUTS.some((layout) => layout.id === value)
}

/** 칸 하나가 이 비율보다 좁아지지 않게 한다 */
export const PDF_SPLIT_MIN_FRACTION = 0.15

export function evenFractions(count: number): number[] {
  return Array.from({ length: Math.max(count, 1) }, () => 1 / Math.max(count, 1))
}

/** 줄·열 경계 b(앞 칸 b-1 과 뒤 칸 b 사이)를 비율 at(0–1, 처음부터 잰 자리)으로 옮긴다. 두 칸만 바뀐다 */
export function moveSplitBoundary(fractions: readonly number[], boundary: number, at: number): number[] {
  if (boundary <= 0 || boundary >= fractions.length) return [...fractions]
  const before = fractions.slice(0, boundary - 1).reduce((sum, value) => sum + value, 0)
  const pair = fractions[boundary - 1]! + fractions[boundary]!
  const min = Math.min(PDF_SPLIT_MIN_FRACTION, pair / 2)
  const first = Math.min(Math.max(at - before, min), pair - min)
  const next = [...fractions]
  next[boundary - 1] = first
  next[boundary] = pair - first
  return next
}

/** 칸 사이 구분선 한 토막. axis 'col' 은 세로선(열 경계), 'row' 는 가로선(줄 경계) */
export interface PdfSplitDivider {
  readonly axis: 'col' | 'row'
  /** 경계 번호(1 부터). 열 경계 1 = 0열과 1열 사이 */
  readonly boundary: number
  /** 선이 걸친 다른 축의 칸 범위 [start, end) */
  readonly start: number
  readonly end: number
}

/** 배치에서 칸을 가르는 구분선들. 칸 하나가 경계를 가로지르는 줄(열)에서는 선이 끊긴다 */
export function splitDividers(layout: PdfSplitLayout): PdfSplitDivider[] {
  const out: PdfSplitDivider[] = []
  const collect = (axis: 'col' | 'row', count: number, across: number) => {
    for (let boundary = 1; boundary < count; boundary += 1) {
      let start: number | null = null
      for (let index = 0; index <= across; index += 1) {
        const crossed = index < across && layout.cells.some((item) => axis === 'col'
          ? item.row <= index && index < item.row + item.rowSpan && item.col < boundary && boundary < item.col + item.colSpan
          : item.col <= index && index < item.col + item.colSpan && item.row < boundary && boundary < item.row + item.rowSpan)
        const open = index < across && !crossed
        if (open && start === null) start = index
        if (!open && start !== null) {
          out.push({ axis, boundary, start, end: index })
          start = null
        }
      }
    }
  }
  collect('col', layout.cols, layout.rows)
  collect('row', layout.rows, layout.cols)
  return out
}

/** 비율 목록에서 칸 index 가 시작하는 자리(0–1) */
export function fractionOffset(fractions: readonly number[], index: number): number {
  return fractions.slice(0, index).reduce((sum, value) => sum + value, 0)
}

/**
 * 칸 하나를 닫은 뒤의 배치: 남은 칸 수에 맞는 배치와, 새 배치의 칸마다 옛 칸 번호(keep).
 * 남은 칸들이 놓였던 모양(위·아래·좌·우)을 되도록 지킨다.
 */
export function closeSplitCell(id: PdfSplitLayoutId, index: number): { readonly layout: PdfSplitLayoutId; readonly keep: readonly number[] } {
  const layout = pdfSplitLayout(id)
  if (layout.cells.length <= 1 || index < 0 || index >= layout.cells.length) return { layout: id, keep: layout.cells.map((_, i) => i) }
  const keep = layout.cells.map((_, i) => i).filter((i) => i !== index)
  switch (id) {
    case 'cols2':
    case 'rows2':
      return { layout: 'single', keep }
    case 'cols3':
      return { layout: 'cols2', keep }
    // 3칸: 큰 칸을 닫으면 작은 두 칸이 그 방향으로 나란히, 작은 칸을 닫으면 남은 둘이 큰 칸과 위아래·좌우로
    case 'top2-bottom1':
      return index === 2 ? { layout: 'cols2', keep } : { layout: 'rows2', keep }
    case 'top1-bottom2':
      return index === 0 ? { layout: 'cols2', keep } : { layout: 'rows2', keep }
    case 'left1-right2':
      return index === 0 ? { layout: 'rows2', keep } : { layout: 'cols2', keep }
    case 'left2-right1':
      return index === 2 ? { layout: 'rows2', keep } : { layout: 'cols2', keep }
    // 넷: 위 칸을 닫으면 위 하나·아래 둘, 아래 칸을 닫으면 위 둘·아래 하나
    case 'grid4':
      return index < 2 ? { layout: 'top1-bottom2', keep } : { layout: 'top2-bottom1', keep }
    default:
      return { layout: 'single', keep: keep.slice(0, 1) }
  }
}
