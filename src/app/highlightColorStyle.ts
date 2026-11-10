import { useSyncExternalStore } from 'react'
import { highlightCssRules, type HighlightColorDef } from '../core/highlightColors'
import { getAppPrefs, subscribeAppPrefs } from './appPrefs'

export const HIGHLIGHT_STYLE_ID = 'iwae-highlight-colors'

/** <style id="iwae-highlight-colors"> 한 개를 목록에 맞춰 다시 쓴다. [data-hl="id"] 규칙이 색 변수(--hlc-*)를 정한다 */
export function applyHighlightColors(colors: readonly HighlightColorDef[], doc: Document = document): void {
  let style = doc.getElementById(HIGHLIGHT_STYLE_ID)
  if (style === null) {
    style = doc.createElement('style')
    style.id = HIGHLIGHT_STYLE_ID
    doc.head.appendChild(style)
  }
  const css = highlightCssRules(colors)
  if (style.textContent !== css) style.textContent = css
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

/** React 밖(내보내기·검증)에서 읽는 목록 */
export function getHighlightColors(): readonly HighlightColorDef[] {
  return getAppPrefs().highlightColors
}
