import { useCallback, useRef } from 'react'

/**
 * 늘 같은 함수(렌더가 바뀌어도 동일한 참조)이면서 부를 때는 가장 새 렌더의 함수를 부른다.
 * 메모(React.memo)한 큰 목록에 이벤트 처리 함수를 넘길 때 쓴다 — 함수가 렌더마다 새로 만들어져
 * 목록 전체가 다시 그려지는 것을 막고, 오래된 값을 잡고 있는 함수가 불리는 일도 없다.
 * 렌더 도중에 부르는 함수에는 쓰지 않는다(이벤트·효과·콜백 전용).
 */
export function useEvent<Args extends unknown[], Result>(handler: (...args: Args) => Result): (...args: Args) => Result {
  const latest = useRef(handler)
  latest.current = handler
  return useCallback((...args: Args) => latest.current(...args), [])
}
