import { useContext, useLayoutEffect, useState } from 'react'
import { t } from '../i18n'
import { PaneIdContext, useWorkspaceLink } from './workspaceContext'

/** 칸 너비가 이보다 좁으면 칩을 숨긴다(좁은 칸의 도구줄을 밀지 않는다) */
export const MEMO_TARGET_CHIP_MIN_PANE_PX = 420

/** 이 칸(card)의 지금 너비가 min 보다 좁은가. 칸 요소를 못 찾으면(시험 · 단독) 좁지 않은 것으로 본다 */
function usePaneNarrow(pane: string | null, min: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    if (pane === null) return undefined
    const card = Array.from(document.querySelectorAll<HTMLElement>('.pane-card[data-card-pane]')).find((element) => element.dataset.cardPane === pane) ?? null
    if (card === null) { setNarrow(false); return undefined }
    const measure = () => setNarrow(card.getBoundingClientRect().width < min)
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    return () => observer.disconnect()
  }, [pane, min])
  return narrow
}

/**
 * PDF · Markdown 도구줄 맨 끝(앱 묶음 앞)의 작은 흐린 칩 「→ 노트 이름」: 지금 이 문서 칸에서 새 메모가 갈 노트(같은 색 칸 중 가장 최근에 만진
 * 노트 칸의 보이는 노트). 같은 색에 보이는 노트 칸이 없으면 아무것도 그리지 않는다(예전처럼 옆에 노트를 연다).
 * 약 160px 에서 말줄임, 전체 이름은 title. 칸이 약 420px 보다 좁으면 숨긴다.
 */
export function MemoTargetChip() {
  const pane = useContext(PaneIdContext)
  const workspace = useWorkspaceLink()
  const narrow = usePaneNarrow(pane, MEMO_TARGET_CHIP_MIN_PANE_PX)
  const path = pane === null ? null : workspace.memoNoteTargetFor(pane)
  if (path === null || narrow) return null
  const name = workspace.memoNoteTitleOf?.(path) ?? path.split(/[\/]/u).at(-1)?.replace(/\.iwnote$/iu, '') ?? path
  return (
    <span className="pane-memo-target" title={name} data-memo-target="">
      <span className="pane-memo-target-text">{t('→ {name}', { name })}</span>
    </span>
  )
}
