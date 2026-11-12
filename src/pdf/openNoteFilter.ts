/**
 * 「열린 노트 표시만 보기」: 같은 색 창에 보이는 노트의 형광펜·영역 메모만 PDF 에 보이게 거르는 순수 함수.
 * 보기 필터일 뿐이라 데이터를 고치지 않고, 되돌리기에도 남지 않는다.
 */
export interface OpenNoteFilterOptions {
  /** 켜져 있는가. 꺼져 있으면 모두 그대로 */
  readonly enabled: boolean
  /** 깨끗이 보기(표시 모두 감추기). 켜져 있으면 모두 감춘 채로 둔다 — 이쪽이 이긴다 */
  readonly clean?: boolean
  /** 열려 있는 노트들의 경로: 같은 색 창에서 지금 보이는 메모 노트 탭들 */
  readonly tabPaths: readonly string[]
  /** 형광펜 id → 그 형광펜을 담은 노트들의 경로 */
  readonly notesOf: (highlightId: string) => readonly string[]
  /** 늘 보이는 것: 만드는 중인 메모·방금 만든 형광펜·깜빡이는 것·고치는 중인 것 */
  readonly isExempt?: (highlightId: string) => boolean
}

/** 열린 노트에 속하거나 예외인 형광펜만 남긴다. 켜져 있지 않으면 같은 배열을 그대로 돌려준다 */
export function filterToOpenNotes<T extends { readonly id: string }>(highlights: readonly T[], options: OpenNoteFilterOptions): readonly T[] {
  if (options.clean === true) return []
  if (!options.enabled) return highlights
  const tabs = new Set(options.tabPaths)
  return highlights.filter(({ id }) => {
    if (options.isExempt?.(id) === true) return true
    return options.notesOf(id).some((path) => tabs.has(path))
  })
}
