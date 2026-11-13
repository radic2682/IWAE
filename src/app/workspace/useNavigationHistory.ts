import { useCallback, useRef, useState } from 'react'
import { EMPTY_HISTORY, goBack, goForward, pushLocation, type NavHistory, type NavLocation } from '../../core/navigationHistory'

interface NavigationHistoryOptions {
  /** 지금 보고 있는 자리. 열린 PDF 가 없으면 null */
  readonly current: () => NavLocation | null
  /** 실제로 그 자리로 간다(탭을 열고 쪽을 요청한다) */
  readonly navigate: (location: NavLocation) => void
  /** 문서가 아직 있는가. 없는 자리는 뒤로/앞으로가 건너뛴다 */
  readonly exists?: (location: NavLocation) => boolean
}

/**
 * 점프할 때마다 출발점을 쌓고, 뒤로/앞으로로 되돌아간다.
 *
 * 기록은 ref 와 state 에 같이 둔다. 단축키·마우스 버튼 핸들러가 같은 렌더 안에서
 * 두 번 불려도(빠른 연타) 두 번째가 첫 번째 결과를 보도록 ref 를 읽고, 버튼의
 * 활성 여부는 state 로 다시 그린다.
 */
export function useNavigationHistory({ current, navigate, exists = () => true }: NavigationHistoryOptions) {
  const historyRef = useRef<NavHistory>(EMPTY_HISTORY)
  const [history, setHistory] = useState<NavHistory>(EMPTY_HISTORY)

  const commit = useCallback((next: NavHistory) => {
    historyRef.current = next
    setHistory(next)
  }, [])

  const jump = useCallback((to: NavLocation) => {
    const from = current()
    if (from !== null) commit(pushLocation(historyRef.current, from, to))
    navigate(to)
  }, [commit, current, navigate])

  const back = useCallback(() => {
    const here = current()
    if (here === null) return
    const result = goBack(historyRef.current, here, exists)
    commit(result.history)
    if (result.target !== null) navigate(result.target)
  }, [commit, current, exists, navigate])

  const forward = useCallback(() => {
    const here = current()
    if (here === null) return
    const result = goForward(historyRef.current, here, exists)
    commit(result.history)
    if (result.target !== null) navigate(result.target)
  }, [commit, current, exists, navigate])

  return {
    jump,
    back,
    forward,
    canBack: history.past.some(exists),
    canForward: history.future.some(exists),
  }
}
