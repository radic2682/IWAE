/**
 * 노트 미니맵의 셈(DOM 없이). VS Code 의 미니맵처럼 노트 전체를 줄여 한 줄 띠로 보이고,
 * 지금 보이는 부분을 반투명 상자로 표시한다. 글자는 그리지 않는다(renderCharacters: false 와 같다) — 블록 높이만큼의 막대면 충분하다.
 */

/** 띠 폭(px) */
export const MINIMAP_WIDTH = 72
/** 노트 창이 이 폭(px) 아래면 켜 두어도 감춘다 */
export const MINIMAP_MIN_PANE = 360
/** 줄임 비율의 위쪽 한계: 짧은 노트가 띠를 가득 채우도록 늘어나지 않게 한다 */
export const MINIMAP_MAX_SCALE = 0.2
/** 막대 최소 높이(px): 아주 작은 블록도 보인다 */
export const MINIMAP_MIN_BAR = 2
/** 뷰포트 상자 최소 높이(px) */
export const MINIMAP_MIN_BOX = 8

export type MinimapBlockKind = 'section' | 'memo' | 'text'

/** 스크롤 칸 안쪽 좌표(scrollTop 과 같은 단위)의 블록 사각형 */
export interface MinimapBlock {
  readonly key: string
  readonly top: number
  readonly height: number
  readonly kind: MinimapBlockKind
  /** 메모 블록의 형광펜 색 id (data-hl) */
  readonly color?: string
  /** 노트 검색에 맞지 않아 흐려진 블록 */
  readonly dim: boolean
}

export interface MinimapBar {
  readonly key: string
  readonly top: number
  readonly height: number
  readonly kind: MinimapBlockKind
  readonly color?: string
  readonly dim: boolean
}

/** 줄임 비율: 노트 전체가 띠 높이에 들어가도록, 단 MINIMAP_MAX_SCALE 보다 크지 않게 */
export function minimapScale(scrollHeight: number, trackHeight: number): number {
  if (!(scrollHeight > 0) || !(trackHeight > 0)) return MINIMAP_MAX_SCALE
  return Math.min(MINIMAP_MAX_SCALE, trackHeight / scrollHeight)
}

/** 블록 사각형 → 띠 위의 막대. 막대 사이에 1px 틈을 두되(3px 넘을 때) 최소 높이는 지킨다 */
export function minimapBars(blocks: readonly MinimapBlock[], scale: number): readonly MinimapBar[] {
  return blocks.map((block) => {
    const raw = block.height * scale
    const height = Math.max(MINIMAP_MIN_BAR, raw > 3 ? raw - 1 : raw)
    return { key: block.key, top: block.top * scale, height, kind: block.kind, ...(block.color === undefined ? {} : { color: block.color }), dim: block.dim }
  })
}

/** 지금 보이는 부분을 나타내는 상자(띠 좌표) */
export function viewportBox(scrollTop: number, clientHeight: number, scrollHeight: number, scale: number): { readonly top: number; readonly height: number } {
  const max = Math.max(0, scrollHeight - clientHeight)
  const top = Math.min(Math.max(0, scrollTop), max) * scale
  return { top, height: Math.max(MINIMAP_MIN_BOX, clientHeight * scale) }
}

const clampScroll = (value: number, clientHeight: number, scrollHeight: number): number => Math.min(Math.max(0, value), Math.max(0, scrollHeight - clientHeight))

/** 띠의 y 를 눌렀다: 그 자리가 화면 가운데에 오는 scrollTop */
export function scrollTopForClick(y: number, scale: number, clientHeight: number, scrollHeight: number): number {
  return clampScroll(y / scale - clientHeight / 2, clientHeight, scrollHeight)
}

/** 상자를 잡고 끈다: 잡은 자리(상자 위에서 grab px 아래)가 포인터 y 를 따라가는 scrollTop */
export function scrollTopForDrag(y: number, grab: number, scale: number, clientHeight: number, scrollHeight: number): number {
  return clampScroll((y - grab) / scale, clientHeight, scrollHeight)
}
