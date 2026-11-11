import { useSyncExternalStore } from 'react'
import { highlightCssRules, type HighlightColorDef } from '../core/highlightColors'
import { getAppPrefs, subscribeAppPrefs, type OtherNoteHighlights } from './appPrefs'
import { setRuntimeSheet } from './runtimeStyle'

export const HIGHLIGHT_STYLE_ID = 'iwae-highlight-colors'

/**
 * 형광펜 색 규칙([data-hl="id"] 가 --hlc-* 색 변수를 정한다)을 문서에 한 벌 단다.
 * <style> 요소는 제품 빌드의 CSP(nonce)에 막혀 적용되지 않으므로 constructable stylesheet(CSSOM)로 넣는다.
 */
export function applyHighlightColors(colors: readonly HighlightColorDef[], doc: Document = document): void {
  setRuntimeSheet(HIGHLIGHT_STYLE_ID, highlightCssRules(colors), doc)
}

let installed = false

/** 앱을 그리기 전에 한 번 부른다. 설정이 바뀌면(이 창이든 다른 창이든) 바로 따라간다 */
export function installHighlightColorStyle(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  applyHighlightColors(getAppPrefs().highlightColors)
  subscribeAppPrefs(() => applyHighlightColors(getAppPrefs().highlightColors))
}

/** 지금 형광펜 색 목록. 바뀌면 다시 그려진다 */
export function useHighlightColors(): readonly HighlightColorDef[] {
  return useSyncExternalStore(subscribeAppPrefs, () => getAppPrefs().highlightColors, () => getAppPrefs().highlightColors)
}

/** 노트 바에 없는 메모의 형광펜을 어떻게 그리는가(설정). 바뀌면 다시 그려진다 */
export function useOtherNoteHighlights(): OtherNoteHighlights {
  return useSyncExternalStore(subscribeAppPrefs, () => getAppPrefs().otherNoteHighlights, () => getAppPrefs().otherNoteHighlights)
}

/** React 밖(내보내기·검증)에서 읽는 목록 */
export function getHighlightColors(): readonly HighlightColorDef[] {
  return getAppPrefs().highlightColors
}
